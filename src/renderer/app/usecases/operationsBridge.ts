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
import { notifyOperationComplete } from './opCompletion'
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
  if (summary.canceled || summary.failedItems > 0 || (summary.inUse?.length ?? 0) > 0) return undefined
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
      // op 완료 대기자(예: 자동링크 복사 단계) resolve — 후속 단계 진행.
      notifyOperationComplete(evt.operationId, evt.summary)
      // 결과를 목록에 반영: 등록된 패널 새로고침.
      for (const pid of refreshPanels) {
        if (s.panels[pid]) s.refresh(pid)
      }
      // 휴지통 실패 폴백: trash op 가 실패 항목을 남기면(사용 중·보호·대용량으로 휴지통
      // 이동 불가) 그 항목들의 영구 삭제를 확인 모달로 제안한다(확정 시 op:start(delete) —
      // engine 의 파일 단위 best-effort 삭제라 잠긴 일부만 실패로 보고). 사용자 결정 게이트.
      const trashFailedPaths =
        op?.kind === 'trash'
          ? evt.summary.failures.map((f) => f.path).filter((p): p is string => !!p)
          : []
      if (trashFailedPaths.length > 0) {
        // 폴백 제안 = 정상 흐름이므로, 실패로 표시된 trash op 를 작업패널에서 즉시 제거해
        // "오류처럼 보이는" 실패 로그를 남기지 않는다(영구삭제 확인 모달이 상황을 대신 안내).
        s.dismissOperation(evt.operationId)
        s.openConfirmDelete(
          trashFailedPaths,
          `${trashFailedPaths.length}개 항목을 휴지통으로 보내지 못했습니다(사용 중이거나 보호된 항목일 수 있습니다). 영구 삭제할까요?`
        )
      } else {
        // 사용 중(잠김)으로 건너뛴 항목은 오류가 아니라 별도 안내(info). 실패가 있을 때만 error.
        const inUseCount = evt.summary.inUse?.length ?? 0
        if (evt.summary.failedItems > 0) {
          s.pushToast(
            'error',
            `${evt.summary.succeededItems}개 완료, ${evt.summary.failedItems}개 실패` +
              (inUseCount > 0 ? `, ${inUseCount}개 사용 중(건너뜀)` : '') +
              '.'
          )
        } else if (inUseCount > 0) {
          s.pushToast(
            'info',
            `${evt.summary.succeededItems}개 완료 · ${inUseCount}개는 사용 중이라 건너뛰었습니다(해당 프로그램을 닫고 다시 시도).`
          )
        }
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
