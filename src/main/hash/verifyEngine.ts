/**
 * R4 체크섬 검증 엔진 (M7 — ADR-009 결정③, UQ-H2).
 *
 * 복사 후 원본(src)·사본(dst) 쌍을 해시 비교해 무결성을 검증한다.
 *   - 크기 다름 → 'size-mismatch'(해시 회피·즉시 불일치).
 *   - 둘 중 하나라도 읽기 실패(해시 null) → 'read-error'.
 *   - 해시 다름 → 'hash-mismatch'.
 *   - 해시 같음 → verified++(일치).
 *
 * 환경 비의존: 크기 조회(statSize)·해시(hashFile)를 deps 로 주입 → 헤드리스 verify 가능.
 * throw 금지(ADR-003): 항목 단위 실패는 mismatch 로 격리(임의 무시 0 — features §R4).
 *
 * 추적성: ADR-009 §결정③·UQ-H2 · features §R4.
 */
import type { HashAlgo, VerifyMismatchDTO } from '@shared/dto'
import type { HashHooks } from './hashEngine'

/** 검증 대상 쌍 1건(정규화된 절대경로). */
export interface VerifyPair {
  readonly src: string
  readonly dst: string
}

/** verifyEngine 이 fs/해시와 결합하는 의존(주입형). */
export interface VerifyEngineDeps {
  /** 파일 바이트 크기(실패 시 null — read-error 처리). */
  statSize(path: string): Promise<number | null>
  /** 단일 파일 해시(취소/읽기실패 null). */
  hashFile(path: string, algo: HashAlgo, hooks: HashHooks): Promise<string | null>
}

/**
 * 쌍 목록을 검증한다.
 * @returns mismatches=불일치 목록, verified=일치 수, canceled=취소 여부.
 */
export async function verifyPairs(
  pairs: readonly VerifyPair[],
  algo: HashAlgo,
  hooks: HashHooks,
  deps: VerifyEngineDeps
): Promise<{ mismatches: VerifyMismatchDTO[]; verified: number; canceled: boolean }> {
  const mismatches: VerifyMismatchDTO[] = []
  let verified = 0
  let scannedItems = 0
  let scannedBytes = 0

  for (const pair of pairs) {
    if (hooks.shouldCancel()) {
      return { mismatches, verified, canceled: true }
    }
    scannedItems++

    const srcSize = await deps.statSize(pair.src)
    const dstSize = await deps.statSize(pair.dst)
    if (srcSize === null || dstSize === null) {
      mismatches.push({ src: pair.src, dst: pair.dst, reason: 'read-error' })
      hooks.onProgress(scannedItems, scannedBytes, pair.dst)
      continue
    }
    if (srcSize !== dstSize) {
      mismatches.push({ src: pair.src, dst: pair.dst, reason: 'size-mismatch' })
      hooks.onProgress(scannedItems, scannedBytes, pair.dst)
      continue
    }

    const hs = await deps.hashFile(pair.src, algo, hooks)
    const hd = await deps.hashFile(pair.dst, algo, hooks)
    scannedBytes += srcSize + dstSize
    if (hooks.shouldCancel()) {
      return { mismatches, verified, canceled: true }
    }
    if (hs === null || hd === null) {
      mismatches.push({ src: pair.src, dst: pair.dst, reason: 'read-error' })
    } else if (hs !== hd) {
      mismatches.push({ src: pair.src, dst: pair.dst, reason: 'hash-mismatch' })
    } else {
      verified++
    }
    hooks.onProgress(scannedItems, scannedBytes, pair.dst)
  }

  return { mismatches, verified, canceled: false }
}
