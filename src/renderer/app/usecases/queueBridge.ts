/**
 * queueBridge — queue:state 푸시 → operationsSlice 큐 미러 브리지 (M7 W2 · ADR-011).
 *
 * App 부팅 시 1회 initQueueBridge() 를 호출해 전역 구독을 건다(operationsBridge 동형).
 *  - subscribeQueueStream(infra) 이 디바운스된 큐 스냅샷을 콜백으로 전달 → _queueState.
 *  - 부팅 시 queue:list 1회 로드로 초기 스냅샷을 채운다(이후는 푸시로 갱신).
 *
 * UI(R3 QueuePanel)·제어(usecases/queue.ts pause/resume/retry/set-concurrency)는
 * 후속 단계에서 이 미러(queueItems)를 소비한다. 본 단계는 상태 배선까지만.
 *
 * 경계: app → infra/api(subscribeQueueStream·queueApi) 직접 호출(.eslintrc 허용).
 */
import { queueApi, subscribeQueueStream } from '@renderer/infra/api'
import { store } from '@renderer/app/stores/rootStore'

let disposer: (() => void) | null = null

/** queue:state 전역 구독 시작 + 초기 queue:list 로드(중복 호출 무시). */
export function initQueueBridge(): void {
  if (disposer) return
  disposer = subscribeQueueStream((evt) => {
    store.getState()._queueState(evt.items)
  })
  // 부팅 초기 스냅샷 1회 로드(이후 변경은 queue:state 푸시로).
  void queueApi.list().then((res) => {
    if (res.ok) store.getState()._queueState(res.value.items)
  })
}

/** 구독 해제(테스트·HMR). */
export function disposeQueueBridge(): void {
  if (disposer) {
    disposer()
    disposer = null
  }
}
