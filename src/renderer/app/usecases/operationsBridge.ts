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
import type { OperationUndoMeta } from '@renderer/app/stores/operationsSlice'
import type { UndoEntry } from '@renderer/app/stores/undoSlice'
import { baseName, joinPath } from '@renderer/domain/paths'
import { verifyAfterCopy } from './checksum'
import type { OpSummary } from '@shared/dto'

let disposer: (() => void) | null = null

/**
 * op:done 의 undoMeta + 요약으로 undo 엔트리를 산출한다(K1). 되돌릴 수 없는 경우
 * undefined 를 반환한다(스택에 적재 안 함).
 *  - 취소/실패(failedItems>0)면 결과가 부정확/부분적 → undo 미생성(보수적).
 *  - copy 생성경로는 summary 에 없으므로 destDir + basename 으로 산출(충돌 rename 시
 *    부정확 가능 → 실패 0 인 경우만 생성).
 */
function deriveUndoEntry(meta: OperationUndoMeta, summary: OpSummary): UndoEntry | undefined {
  if (summary.canceled || summary.failedItems > 0) return undefined
  switch (meta.kind) {
    case 'move':
      return { kind: 'move', sources: [...meta.sources], fromDir: meta.fromDir, toDir: meta.toDir }
    case 'copy': {
      const createdPaths = meta.sources.map((src) => joinPath(meta.destDir, baseName(src)))
      return { kind: 'copy', createdPaths }
    }
    case 'trash':
      return { kind: 'trash', originalPaths: [...meta.originalPaths] }
    default:
      return undefined
  }
}

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
      // K1: 성공한 move/copy/trash 는 undo 엔트리 적재(_opDone 전에 op.undoMeta 참조).
      if (op?.undoMeta) {
        const entry = deriveUndoEntry(op.undoMeta, evt.summary)
        if (entry) s.pushUndo(entry)
        // §R4: 성공한 copy(실패/취소 0)이고 설정(verifyOnCopy) 켜졌으면 복사 후 체크섬 검증.
        // 사본 경로 산출(destDir+basename)이 충돌 rename 으로 어긋날 수 있어 실패 0 일 때만.
        if (
          op.undoMeta.kind === 'copy' &&
          !evt.summary.canceled &&
          evt.summary.failedItems === 0
        ) {
          void verifyAfterCopy(op.undoMeta)
        }
      }
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
