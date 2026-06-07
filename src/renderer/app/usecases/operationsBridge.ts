/**
 * operationsBridge — op:* 이벤트 → operationsSlice 액션 브리지 (SA §3.2, infra→app).
 *
 * App 부팅 시 1회 initOperationsBridge() 를 호출해 전역 구독을 건다.
 * subscribeOpStream(infra)이 progress/conflict/done 페이로드를 콜백으로 전달하면
 * 여기서 operationId 로 분기해 슬라이스에 반영하고, done 시 등록된 패널을
 * 새로고침한다(작업 결과를 목록에 반영).
 *
 * 경계: app → infra/api(subscribeOpStream) 직접 호출(.eslintrc 허용).
 */
import { subscribeOpStream } from '@renderer/infra/api'
import { store } from '@renderer/app/stores/rootStore'

let disposer: (() => void) | null = null

/** op:* 전역 구독 시작(중복 호출 무시). */
export function initOperationsBridge(): void {
  if (disposer) return
  disposer = subscribeOpStream({
    onProgress: (evt) => {
      store.getState()._opProgress(evt)
    },
    onConflict: (evt) => {
      store.getState()._opConflict(evt)
    },
    onDone: (evt) => {
      const s = store.getState()
      const op = s.operations[evt.operationId]
      const refreshPanels = op?.refreshPaths ?? []
      s._opDone(evt.operationId, evt.summary)
      // 결과를 목록에 반영: 등록된 패널 새로고침.
      for (const pid of refreshPanels) {
        if (s.panels[pid]) s.refresh(pid)
      }
      // 부분 실패면 요약 토스트(다이얼로그도 표시되지만 즉시 안내).
      if (evt.summary.failedItems > 0) {
        s.pushToast(
          'error',
          `${evt.summary.succeededItems}개 완료, ${evt.summary.failedItems}개 실패.`
        )
      }
    }
  })
}

/** 구독 해제(테스트·HMR). */
export function disposeOperationsBridge(): void {
  if (disposer) {
    disposer()
    disposer = null
  }
}
