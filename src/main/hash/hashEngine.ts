/**
 * 공용 스트리밍 해시 코어 (M7 — ADR-009 결정①②③).
 *
 * 환경 비의존(environment-agnostic): node:crypto·node:fs 를 **주입**받아
 * (a) Worker Thread 안에서 실제 파일 해시로, (b) 검증 스크립트에서 메모리/임시파일
 * 스텁으로 동일하게 돌릴 수 있다(scanEngine 선례와 동형 — 헤드리스 verify 가능).
 *
 * 설계 포인트:
 *  - 1MB 청크 스트리밍 read → hash.update → 전체를 메모리에 올리지 않는다(대용량 안전).
 *  - 청크 경계마다 취소 폴링(shouldCancel) + 진행 바이트 보고(onProgress) → 거대 파일
 *    1개 해시 중에도 즉시 중단·진행 표시.
 *  - throw 금지(ADR-003): 취소·읽기 실패는 null 반환(호출측이 skipped/read-error 처리).
 *
 * 추적성: ADR-009 §결정②③ · scanEngine 환경 비의존 패턴.
 */
import type { HashAlgo } from '@shared/dto'

/** 엔진이 상위(Worker/검증)에 보고/질의하는 훅(scanEngine ScanHooks 동형). */
export interface HashHooks {
  /** 진행 보고(누적 항목/바이트 + 현재 경로). 상위에서 200ms 스로틀. */
  onProgress(scannedItems: number, scannedBytes: number, currentPath: string): void
  /** 협조적 취소 폴링. true 면 안전 지점(청크/항목 경계)에서 중단. */
  shouldCancel(): boolean
}

/** 1MB 청크(대용량 메모리 안전·청크 경계 취소/진행 폴링 단위). */
export const HASH_CHUNK_BYTES = 1 << 20

/**
 * 청크 단위 read 를 제공하는 파일 리더(주입형). Worker 는 node:fs 로,
 * verify 는 메모리/임시파일 스텁으로 구현한다.
 *
 * read(buf) 가 0 을 반환하면 EOF. 음수/throw 는 호출측 catch 로 read-error.
 */
export interface ChunkReader {
  /** 다음 청크를 buf 에 채우고 읽은 바이트 수 반환(0=EOF). */
  read(buf: Uint8Array): Promise<number>
  /** 리소스 정리(파일 핸들 close 등). 실패해도 throw 금지. */
  close(): Promise<void>
}

/** 해시 1건을 누적 계산하는 다이제스트(주입형 — node:crypto Hash 동형). */
export interface HashDigest {
  update(chunk: Uint8Array): void
  /** hex 다이제스트 문자열. */
  digestHex(): string
}

/** hashEngine 이 fs/crypto 와 결합하는 의존(주입형). */
export interface HashEngineDeps {
  /** path 의 청크 리더 생성(open). 실패 시 throw — hashFile 이 catch 해 null 반환. */
  openReader(path: string): Promise<ChunkReader>
  /** algo 용 다이제스트 생성(crypto.createHash). */
  createDigest(algo: HashAlgo): HashDigest
}

/**
 * 단일 파일을 스트리밍 해시한다.
 *  - 반환: hex 다이제스트(성공) | null(취소되었거나 읽기 실패 — throw 금지).
 *  - 청크 경계마다 shouldCancel 폴링 → 취소 시 null(부분 다이제스트 폐기).
 *  - 진행 바이트는 onProgress 로 누적 보고(scannedItems 는 호출측이 파일 단위로 관리하므로
 *    여기서는 0 을 넘기고, 호출측이 현재 누계를 합산해 다시 보고하는 형태가 일반적이나,
 *    단순화를 위해 currentBytes 누계만 보고한다 — 상위가 합산).
 */
export async function hashFile(
  path: string,
  algo: HashAlgo,
  hooks: HashHooks,
  deps: HashEngineDeps
): Promise<string | null> {
  if (hooks.shouldCancel()) return null

  let reader: ChunkReader
  try {
    reader = await deps.openReader(path)
  } catch {
    // 읽기 실패(권한·미존재 등) — throw 금지, null 로 격리.
    return null
  }

  const digest = deps.createDigest(algo)
  const buf = new Uint8Array(HASH_CHUNK_BYTES)
  let fileBytes = 0
  let canceled = false
  let readError = false

  try {
    for (;;) {
      if (hooks.shouldCancel()) {
        canceled = true
        break
      }
      let n: number
      try {
        n = await reader.read(buf)
      } catch {
        readError = true
        break
      }
      if (n <= 0) break // EOF
      // n 바이트만 update(마지막 청크는 buf 보다 짧을 수 있음).
      digest.update(n === buf.length ? buf : buf.subarray(0, n))
      fileBytes += n
      // 청크 경계 진행 보고(현재 파일 누적 바이트·경로). 상위가 전체 누계로 합산/스로틀.
      hooks.onProgress(0, fileBytes, path)
    }
  } finally {
    await reader.close().catch(() => undefined)
  }

  if (canceled || readError) return null
  return digest.digestHex()
}
