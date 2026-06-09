/**
 * 체크섬 검증 판정 규칙 (renderer/domain/rules/checksumVerdict) — 순수 TS, 부수효과 0.
 *
 * §R4·US-17.4·F25·ADR-009. **R4 복사 후 무결성 검증**의 결과(VerifyMismatchDTO[]·
 * verified 수)를 사용자 안내용 요약·판정으로 환산한다. 실제 해시 비교(원본↔사본)는
 * 백엔드 hash:verify 잡(공용 해시 엔진)이 수행하고, 이 모듈은 그 산출을 해석만 한다.
 *
 * 경계 규칙(.eslintrc): domain 은 react/zustand/infra/shared-ipc import 금지.
 * shared/dto 타입 전용 import만 허용. throw 금지(ADR-003) — 손상 입력은 안전 폴백.
 */
import type { VerifyMismatchDTO } from '@shared/dto'

/** 검증 판정 — ok=전부 일치, mismatch=불일치 1건 이상. */
export type ChecksumVerdictKind = 'ok' | 'mismatch'

/** 검증 결과 요약(토스트·다이얼로그 표시 단일 출처). */
export interface ChecksumVerdict {
  readonly kind: ChecksumVerdictKind
  /** 검증한 쌍 총 수(일치 + 불일치). */
  readonly total: number
  /** 일치 수(verified). */
  readonly matched: number
  /** 불일치 수(=mismatches.length). */
  readonly mismatched: number
  /** 사유별 카운트(표시 보조). */
  readonly byReason: Readonly<Record<VerifyMismatchDTO['reason'], number>>
  /** 불일치 상세(원본/사본/사유). 표시 상한은 UI 가 적용. */
  readonly mismatches: readonly VerifyMismatchDTO[]
}

/**
 * hash:verify:done 산출(mismatches·verified)을 판정·요약으로 환산(순수).
 * - kind: 불일치 0 → 'ok', 1건 이상 → 'mismatch'.
 * - total: verified(일치 수) + mismatches.length(불일치 수). 음수 verified 는 0 클램프(방어).
 * @param mismatches 불일치 목록(hash:verify:done.mismatches)
 * @param verified 일치한 쌍 수(hash:verify:done.verified)
 */
export function summarizeVerify(
  mismatches: readonly VerifyMismatchDTO[],
  verified: number
): ChecksumVerdict {
  const matched = Number.isFinite(verified) && verified > 0 ? Math.trunc(verified) : 0
  const list = Array.isArray(mismatches) ? mismatches : []
  const byReason: Record<VerifyMismatchDTO['reason'], number> = {
    'hash-mismatch': 0,
    'size-mismatch': 0,
    'read-error': 0
  }
  for (const m of list) {
    if (!m) continue
    const reason: VerifyMismatchDTO['reason'] = m.reason
    if (reason === 'hash-mismatch' || reason === 'size-mismatch' || reason === 'read-error') {
      byReason[reason] += 1
    }
  }
  return {
    kind: list.length === 0 ? 'ok' : 'mismatch',
    total: matched + list.length,
    matched,
    mismatched: list.length,
    byReason,
    mismatches: list
  }
}

/** 사용자 안내 메시지(토스트/다이얼로그 본문) — 정직 표기(일치/불일치·사유). */
export function verifyMessage(v: ChecksumVerdict): string {
  if (v.kind === 'ok') {
    return v.total === 0
      ? '검증할 파일이 없습니다.'
      : `체크섬 검증 완료 — ${v.matched}개 항목 모두 일치합니다.`
  }
  const parts: string[] = []
  if (v.byReason['hash-mismatch'] > 0) parts.push(`내용 다름 ${v.byReason['hash-mismatch']}`)
  if (v.byReason['size-mismatch'] > 0) parts.push(`크기 다름 ${v.byReason['size-mismatch']}`)
  if (v.byReason['read-error'] > 0) parts.push(`읽기 실패 ${v.byReason['read-error']}`)
  const detail = parts.length > 0 ? ` (${parts.join(', ')})` : ''
  return `체크섬 검증 — ${v.matched}개 일치, ${v.mismatched}개 불일치${detail}. 복사본이 원본과 다릅니다.`
}
