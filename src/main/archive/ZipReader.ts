/**
 * ZipReader — yauzl 기반 zip 읽기(중앙 디렉토리 열거 + 엔트리 단위 읽기 스트림) (§Q1 M9 · ADR-008).
 *
 * ⚠ `src/main/archive/` 는 **압축 라이브러리 특권 디렉토리**다(ADR-008 · ESLint 화이트리스트).
 *    이 디렉토리 안에서만 `yauzl`(읽기)·`yazl`(쓰기) import 가 `no-restricted-imports` 예외로
 *    허용된다(원격 `src/main/remote/` 의 네트워크 라이브러리 격리와 동일 모델). 그 외 main 전
 *    경로에서 yauzl/yazl import 는 lint 에러다.
 *
 * 책임:
 *  - openZip: zip 중앙 디렉토리를 **전체 메모리 적재 없이** 스트리밍 열거해 엔트리 테이블
 *    (이름·크기·압축여부·심볼릭·암호여부·mtime)을 만든다(목록·탐색용).
 *  - forEachEntryForExtract: 추출 시 zip 을 재오픈해 대상 엔트리만 순차로 읽기 스트림으로 꺼낸다
 *    (압축 해제 = inflate · Worker Thread 에서 호출).
 *
 * 보안: 엔트리명은 외부 입력(불신)이며, 경로 검증은 @shared/archive/safePath(순수규칙)가 추출
 * 시점에 강제한다. ZipReader 는 raw 엔트리명을 그대로 보존해 상위가 검증하게 한다(정보 손실 0).
 * 암호 zip 엔트리(isEncrypted)는 열거 시 감지해 표시(상위가 EUNSUPPORTED 판정).
 */
import { Readable } from 'node:stream'
// eslint-disable-next-line import/no-extraneous-dependencies
import { open as yauzlOpen, type Entry as YauzlEntry } from 'yauzl'
import { isDirEntry, isSymlinkEntry } from '@shared/archive/safePath'

/** 열거된 zip 엔트리 1개의 raw 메타(검증 전 — 이름 보존). */
export interface RawZipEntry {
  /** zip 내부 raw 엔트리명(불신 입력 — POSIX/win32 구분자 혼용 가능). */
  readonly entryName: string
  /** 압축 해제 크기(바이트). */
  readonly uncompressedSize: number
  /** 압축 저장 크기(바이트 — 압축비 폭탄 판정용). */
  readonly compressedSize: number
  /** 수정 시각(epoch ms, UTC). */
  readonly mtime: number
  /** 디렉토리 엔트리 여부(이름이 '/'로 끝남). */
  readonly isDir: boolean
  /** 심볼릭링크 엔트리 여부(추출 스킵 대상). */
  readonly isSymlink: boolean
  /** 암호화 엔트리 여부(EUNSUPPORTED 판정). */
  readonly isEncrypted: boolean
}

/** zip 핸들(세션 매니저가 보유). yauzl ZipFile 을 캡슐화. */
export interface ZipHandle {
  /** 열거된 엔트리 테이블(불변 스냅샷). */
  readonly entries: readonly RawZipEntry[]
  /** 암호화 엔트리가 하나라도 있는가(1차 EUNSUPPORTED 판정). */
  readonly hasEncrypted: boolean
  /** 핸들 닫기(파일 디스크립터 해제 · 멱등). */
  close(): Promise<void>
}

/** lastMod(dos date/time) → epoch ms(UTC). yauzl Entry.getLastModDate() 사용. */
function entryMtime(entry: YauzlEntry): number {
  try {
    return entry.getLastModDate().getTime()
  } catch {
    return Date.now()
  }
}

/** yauzl Entry → RawZipEntry 정규화. */
function toRaw(entry: YauzlEntry): RawZipEntry {
  return {
    entryName: entry.fileName,
    uncompressedSize: entry.uncompressedSize,
    compressedSize: entry.compressedSize,
    mtime: entryMtime(entry),
    isDir: isDirEntry(entry.fileName),
    isSymlink: isSymlinkEntry(entry.externalFileAttributes),
    isEncrypted: entry.isEncrypted()
  }
}

/**
 * zip 을 열어 중앙 디렉토리를 스트리밍 열거하고 ZipHandle 을 반환한다.
 * lazyEntries:true 로 메모리를 절약하며 엔트리를 하나씩 끌어온다(대용량 zip 대비).
 * 손상·암호·미지원은 reject(상위가 toArchiveError 로 정규화).
 */
export function openZip(archivePath: string): Promise<ZipHandle> {
  return new Promise<ZipHandle>((resolve, reject) => {
    yauzlOpen(
      archivePath,
      { lazyEntries: true, autoClose: false, decodeStrings: true, validateEntrySizes: false },
      (err, zipfile) => {
        if (err || !zipfile) {
          reject(err ?? new Error('zip 열기 실패'))
          return
        }

        const entries: RawZipEntry[] = []
        let hasEncrypted = false

        zipfile.on('entry', (entry: YauzlEntry) => {
          const raw = toRaw(entry)
          if (raw.isEncrypted) hasEncrypted = true
          entries.push(raw)
          zipfile.readEntry()
        })

        zipfile.on('end', () => {
          resolve({
            entries,
            hasEncrypted,
            close: () =>
              new Promise<void>((res) => {
                try {
                  zipfile.close()
                } catch {
                  /* 멱등 — 이미 닫힘 */
                }
                res()
              })
          })
        })

        zipfile.on('error', (e) => reject(e))
        zipfile.readEntry()
      }
    )
  })
}

/**
 * 추출 전용 순회 — zip 을 다시 열어 각 엔트리를 순회하며, 대상(shouldExtract)에 속하면
 * onEntry 콜백에 (raw entry, readStream factory) 를 넘긴다. lazyEntries 로 메모리 절약·순차
 * 처리(현재 엔트리 스트림을 소비 완료한 뒤 다음 readEntry). 취소(shouldCancel) 시 즉시 종료.
 *
 * @param archivePath zip 로컬 절대경로.
 * @param shouldExtract 엔트리 → 추출 대상 여부(워커가 innerPaths prefix 매칭).
 * @param onEntry 대상 엔트리마다 호출(await — 스트림 소비 완료까지 다음 readEntry 보류).
 * @param shouldCancel 협조 취소 폴링(true 면 순회 중단).
 */
export function forEachEntryForExtract(
  archivePath: string,
  shouldExtract: (entry: RawZipEntry) => boolean,
  onEntry: (entry: RawZipEntry, openStream: () => Promise<Readable>) => Promise<void>,
  shouldCancel: () => boolean
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    yauzlOpen(
      archivePath,
      { lazyEntries: true, autoClose: false, decodeStrings: true, validateEntrySizes: false },
      (err, zipfile) => {
        if (err || !zipfile) {
          reject(err ?? new Error('zip 열기 실패'))
          return
        }

        const finish = (e?: unknown): void => {
          try {
            zipfile.close()
          } catch {
            /* 멱등 */
          }
          if (e) reject(e)
          else resolve()
        }

        zipfile.on('entry', (entry: YauzlEntry) => {
          if (shouldCancel()) {
            finish()
            return
          }
          const raw = toRaw(entry)
          if (!shouldExtract(raw)) {
            zipfile.readEntry()
            return
          }
          const openStream = (): Promise<Readable> =>
            new Promise<Readable>((res, rej) => {
              zipfile.openReadStream(entry, (sErr, stream) => {
                if (sErr || !stream) rej(sErr ?? new Error('엔트리 스트림 열기 실패'))
                else res(stream)
              })
            })
          void onEntry(raw, openStream)
            .then(() => zipfile.readEntry())
            .catch((e2) => finish(e2))
        })

        zipfile.on('end', () => finish())
        zipfile.on('error', (e) => finish(e))
        zipfile.readEntry()
      }
    )
  })
}
