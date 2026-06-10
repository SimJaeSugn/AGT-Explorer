/**
 * opCompletion — 특정 op:* 작업의 완료(op:done)를 Promise 로 기다리는 소형 레지스트리.
 *
 * 여러 단계를 op 완료에 이어 실행해야 하는 흐름(예: 자동링크 = 복사 op 완료 후 정션 마무리)이
 * "이 operationId 가 끝날 때까지" 기다릴 수 있게 한다. operationsBridge 가 op:done 수신 시
 * notifyOperationComplete 로 대기 중 Promise 를 resolve 한다.
 *
 * 레이스 처리(중요): 작은 폴더 복사는 op:done 이 waitForOperation 등록 **전에** 도착할 수
 * 있다. 그 경우 대기자가 없어 통지를 잃으면 Promise 가 영영 resolve 되지 않는다(복사만 되고
 * 후속 단계 미실행). 이를 막기 위해 대기자가 없을 때 완료 요약을 짧은 TTL 로 캐시해, 직후
 * 등록되는 waitForOperation 이 즉시 받게 한다. 함수는 스토어 비대상(휘발 모듈 전역).
 */
import type { OpSummary } from '@shared/dto'

const waiters = new Map<string, (summary: OpSummary) => void>()
/** op:done 이 대기 등록보다 먼저 도착한 경우의 짧은 캐시(레이스 방지). */
const recent = new Map<string, OpSummary>()
const RECENT_TTL_MS = 60_000

/** operationId 의 op:done 을 기다린다. 이미 완료(레이스)면 캐시에서 즉시 resolve. */
export function waitForOperation(operationId: string): Promise<OpSummary> {
  const cached = recent.get(operationId)
  if (cached) {
    recent.delete(operationId)
    return Promise.resolve(cached)
  }
  return new Promise<OpSummary>((resolve) => {
    waiters.set(operationId, resolve)
  })
}

/** op:done 수신 시 호출(operationsBridge). 대기자가 있으면 resolve, 없으면 짧게 캐시. */
export function notifyOperationComplete(operationId: string, summary: OpSummary): void {
  const w = waiters.get(operationId)
  if (w) {
    waiters.delete(operationId)
    w(summary)
    return
  }
  // 대기자 미등록(레이스): 직후 waitForOperation 이 받도록 TTL 캐시.
  recent.set(operationId, summary)
  setTimeout(() => recent.delete(operationId), RECENT_TTL_MS)
}
