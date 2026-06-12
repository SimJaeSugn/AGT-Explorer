/**
 * ZipWriter — yazl 기반 zip 쓰기(추가 = 재작성) (§Q1 M9 · ADR-008 결정②).
 *
 * ⚠ `src/main/archive/` 압축 라이브러리 특권 디렉토리(yauzl/yazl import 화이트리스트).
 *
 * zip 은 포맷 특성상 **항목 추가 = 기존 엔트리 + 신규 엔트리를 새 zip 으로 재작성**(in-place
 * append 미지원). 안전 절차(ADR-008 결정②):
 *   1) `<zip>.tmp-<rand>` 임시 파일에 새 zip 을 쓴다.
 *   2) 기존 zip 의 모든 엔트리를 그대로 복사(yauzl 읽기 스트림 → yazl addReadStream).
 *   3) 신규 로컬 항목을 addFile 로 추가(동명 충돌은 호출 워커가 conflictPolicy 로 사전 해소).
 *   4) end() 완료 후 **원자적 rename(tmp → 원본)**. 부분 실패 시 tmp 정리·원본 보존.
 *
 * 본 모듈은 deflate(CPU)를 Worker Thread 에서 실행하도록 워커(archiveWorker)가 호출한다.
 * 진행률은 바이트 누적 콜백으로 보고(워커가 op:* 로 중계).
 */
import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
// eslint-disable-next-line import/no-extraneous-dependencies
import { ZipFile as YazlZipFile } from 'yazl'
import { openZipForRewrite } from './ZipReader'

/** 추가할 신규 로컬 항목 1개(이미 새니타이즈된 zip 내부 엔트리명 + 로컬 소스 경로). */
export interface AddItem {
  /** zip 내부에 들어갈 엔트리명(POSIX · safeArchiveEntryName 통과). */
  readonly entryName: string
  /** 로컬 소스 파일 절대경로(핸들러 guardPath 통과 · 파일만 — 디렉토리는 워커가 전개). */
  readonly localPath: string
  /** 소스 파일 크기(진행률 분모용). */
  readonly size: number
}

/** 재작성 진행률 콜백(누적 처리 바이트). */
export type AddProgress = (processedBytes: number) => void

/**
 * 기존 zip 에 신규 항목을 추가한 새 zip 을 원자적으로 재작성한다.
 *  - skipExisting: 신규 엔트리명과 동명인 **기존** 엔트리를 제외(덮어쓰기 효과 — overwrite 정책).
 *    호출 워커가 conflictPolicy 로 결정한 "제외할 기존 엔트리명" 집합.
 * 반환: 추가 성공 항목 수. 실패 시 throw(워커가 정규화·tmp 정리는 본 함수가 보장).
 */
export async function addToZip(
  archivePath: string,
  items: readonly AddItem[],
  skipExisting: ReadonlySet<string>,
  onProgress: AddProgress,
  shouldCancel: () => boolean
): Promise<number> {
  const tmpPath = `${archivePath}.tmp-${randomBytes(6).toString('hex')}`
  const zip = new YazlZipFile()
  let processed = 0

  // tmp 출력 스트림 연결(쓰기 시작).
  const out = fs.createWriteStream(tmpPath)
  const outDone = new Promise<void>((resolve, reject) => {
    out.on('close', () => resolve())
    out.on('error', (e) => reject(e))
  })
  zip.outputStream.on('error', (e) => out.destroy(e))
  zip.outputStream.pipe(out)

  // 소스 zip 핸들 — yazl 이 등록된 읽기 스트림을 모두 소비(outDone)할 때까지 열어 둔다.
  // 조기 close 시 lazy 소비 스트림의 fd 가 끊겨 재작성본이 손상된다(§Q1 결함 수정).
  const reader = await openZipForRewrite(archivePath)
  try {
    // ── 1) 기존 엔트리 복사(동명 신규로 덮일 것은 제외) ──────────────────
    //   파일 엔트리는 읽기 스트림으로, 디렉토리(빈 폴더) 엔트리는 addEmptyDirectory 로 보존.
    await reader.pump(
      (entry) => !skipExisting.has(entry.entryName),
      (entry, stream) => {
        if (entry.isDir || stream === null) {
          zip.addEmptyDirectory(entry.entryName, { mtime: new Date(entry.mtime) }) // 빈 폴더 보존.
        } else {
          zip.addReadStream(stream, entry.entryName, { mtime: new Date(entry.mtime) })
        }
      },
      shouldCancel
    )

    if (shouldCancel()) throw new Error('취소됨')

    // ── 2) 신규 항목 추가(deflate) — addFile 은 yazl 이 파일을 직접 읽어 압축 ──
    for (const item of items) {
      if (shouldCancel()) throw new Error('취소됨')
      zip.addFile(item.localPath, item.entryName)
      processed += item.size
      onProgress(processed)
    }

    // ── 3) 마무리 + 출력 close 대기(yazl 이 소스 스트림 전부 소비할 때까지) ──
    zip.end()
    await outDone

    // 소스 핸들을 rename **전에** 닫는다 — yazl 소비가 끝난 뒤(outDone)이므로 스트림 절단
    // 위험이 없고, Windows 는 열린 파일 위로 rename 이 불가(EPERM)하므로 반드시 먼저 닫아야 한다.
    await reader.close()

    if (shouldCancel()) throw new Error('취소됨')

    // ── 4) 원자적 rename(tmp → 원본). 부분 실패 시 원본 보존 ──────────────
    await fsp.rename(tmpPath, archivePath)
    return items.length
  } catch (e) {
    // 실패/취소 — tmp 정리(원본 무손상). 출력 스트림 파기.
    try {
      out.destroy()
    } catch {
      /* 멱등 */
    }
    await fsp.rm(tmpPath, { force: true }).catch(() => undefined)
    throw e
  } finally {
    // outDone 이후(또는 실패 후)에만 소스 닫음 — 조기 close 로 인한 스트림 절단 방지.
    await reader.close()
  }
}
