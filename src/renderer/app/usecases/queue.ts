/**
 * 전송 큐 매니저 유스케이스 (app/usecases/queue) — 제어(일시정지/재개/재시도/동시성) (§R3·US-17.3·F24).
 *
 * 백엔드 queue:*(pause/resume/retry/set-concurrency)를 호출해 Main 의 TransferQueue
 * 스케줄러를 제어한다. 큐 항목 목록·진행률은 operationsSlice.queueItems(queueBridge 가
 * queue:state 푸시로 미러)에서 읽는다 — 본 모듈은 "제어 명령"만 담당한다.
 *
 * 취소는 기존 op:cancel(usecases/fileOps.cancelOperation) 재사용(operationId 동일).
 * 동시성 설정 성공 시 operationsSlice._setMaxConcurrent 로 즉시 미러(낙관·표시용).
 *
 * 경계: app → infra/api(queueApi) 직접 호출(.eslintrc 허용). 실패는 토스트(비차단).
 */
import { queueApi } from '@renderer/infra/api'
import { store } from '@renderer/app/stores/rootStore'

/** 큐 항목 일시정지(operationId). 진행 중 항목만 의미(스케줄러가 협조적 정지). */
export async function pauseQueueItem(operationId: string): Promise<void> {
  const res = await queueApi.pause(operationId)
  if (!res.ok) store.getState().pushToast('error', `일시정지 실패: ${res.error.message}`)
}

/** 큐 항목 재개(operationId). paused → running(스케줄러 한도 내). */
export async function resumeQueueItem(operationId: string): Promise<void> {
  const res = await queueApi.resume(operationId)
  if (!res.ok) store.getState().pushToast('error', `재개 실패: ${res.error.message}`)
}

/** 실패 항목 재시도(operationId). failed → pending 재큐. */
export async function retryQueueItem(operationId: string): Promise<void> {
  const res = await queueApi.retry(operationId)
  if (!res.ok) store.getState().pushToast('error', `재시도 실패: ${res.error.message}`)
}

/**
 * 진행/대기 중인 모든 항목 일시정지(전체 일시정지). 종료 상태 항목은 건너뛴다.
 * 항목별 pause 를 병렬 호출(실패는 개별 토스트로 안내).
 */
export async function pauseAll(): Promise<void> {
  const items = store.getState().queueItems
  const targets = items.filter((it) => it.status === 'running' || it.status === 'pending')
  await Promise.all(targets.map((it) => pauseQueueItem(it.operationId)))
}

/** 일시정지된 모든 항목 재개(전체 재개). */
export async function resumeAll(): Promise<void> {
  const items = store.getState().queueItems
  const targets = items.filter((it) => it.status === 'paused')
  await Promise.all(targets.map((it) => resumeQueueItem(it.operationId)))
}

/**
 * 전역 동시성 한도 설정(1~16 클램프). 성공 시 operationsSlice 에 즉시 미러(_setMaxConcurrent).
 * 실패면 토스트(미러 미반영 — 서버 진실 유지).
 */
export async function setConcurrency(maxConcurrent: number): Promise<void> {
  const clamped = Math.max(1, Math.min(16, Math.trunc(maxConcurrent)))
  if (!Number.isFinite(clamped)) return
  const res = await queueApi.setConcurrency(clamped)
  if (!res.ok) {
    store.getState().pushToast('error', `동시성 설정 실패: ${res.error.message}`)
    return
  }
  store.getState()._setMaxConcurrent(clamped)
}
