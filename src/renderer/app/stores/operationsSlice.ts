/**
 * operationsSlice — 파일 작업(op:*) 진행/충돌/요약 미러 (SA §2.1 FileOperation, §5.2).
 *
 * Immer 제외 대상(ADR-002): 200ms 초고빈도 progress 푸시라 평탄 교체로 다룬다.
 * op:onProgress/onConflict/onDone 이벤트를 infra(subscribeOpStream)에서 받아
 * 액션(_onProgress/_onConflict/_onDone)으로 브리지한다.
 *
 * 상태머신(SA §2.3): pending→running→(conflict→running)*→done|partial-failed.
 * 충돌은 큐(conflictQueue)로 모아 ConflictDialog 가 head 부터 해소한다.
 * 진행 op 가 1개 이상이면 ProgressDialog 가 표시된다.
 *
 * 다이얼로그 열림/닫힘에 따라 uiSlice.inputContext 를 'dialog' 로 전환하는 책임은
 * UI(다이얼로그 컴포넌트)에 둔다(슬라이스는 데이터만).
 */
import type {
  OpConflictEvt,
  OpProgressEvt
} from '@shared/ipc/contracts'
import type { FileEntryDTO, OpKind, OpSummary } from '@shared/dto'
import type { SliceCreator } from './types'

/** Renderer 측 작업 상태(SA §2.1 FileOperation status). */
export type OperationStatus =
  | 'pending'
  | 'running'
  | 'conflict'
  | 'cancelling'
  | 'done'
  | 'partial-failed'

/** 진행률 스냅샷(op:progress 미러). */
export interface OperationProgress {
  readonly processedBytes: number
  readonly totalBytes: number
  readonly processedItems: number
  readonly totalItems: number
  readonly currentName: string
  readonly bytesPerSec: number
}

/** 진행 중 작업 1개. */
export interface Operation {
  readonly operationId: string
  readonly kind: OpKind
  readonly status: OperationStatus
  readonly progress: OperationProgress
  /** 완료 후 요약(없으면 null). */
  readonly summary: OpSummary | null
  /** 시작 시각(경과·정렬용). */
  readonly startedAt: number
  /** 완료 후 패널 새로고침 대상 경로(있으면). */
  readonly refreshPaths: string[]
}

/** 충돌 큐 항목(op:conflict 미러). */
export interface ConflictItem {
  readonly operationId: string
  readonly conflictId: string
  readonly source: FileEntryDTO
  readonly target: FileEntryDTO
}

function emptyProgress(): OperationProgress {
  return {
    processedBytes: 0,
    totalBytes: 0,
    processedItems: 0,
    totalItems: 0,
    currentName: '',
    bytesPerSec: 0
  }
}

export interface OperationsSlice {
  /** operationId → Operation. */
  readonly operations: Record<string, Operation>
  /** 표시 순서(시작 순). */
  readonly operationOrder: string[]
  /** 미해소 충돌 큐(head 부터 ConflictDialog 표시). */
  readonly conflictQueue: ConflictItem[]

  // 시작/취소 등록(usecase 가 op.start 후 호출) ──────────────────────────
  /** 새 작업을 pending 으로 등록(op.start 직후). */
  registerOperation(
    operationId: string,
    kind: OpKind,
    refreshPaths: readonly string[]
  ): void
  /** 취소 요청 표시(op.cancel 호출 후 status=cancelling). */
  markCancelling(operationId: string): void
  /** 완료/요약 표시된 작업을 목록에서 제거(다이얼로그 닫기). */
  dismissOperation(operationId: string): void

  // op:* 이벤트 진입(infra 브리지가 호출) ────────────────────────────────
  // panelsSlice 의 _onChunk/_onDone 과 이름 충돌을 피해 _op 접두사를 쓴다.
  _opProgress(evt: OpProgressEvt): void
  _opConflict(evt: OpConflictEvt): void
  _opDone(operationId: string, summary: OpSummary): void

  // 충돌 큐 관리 ─────────────────────────────────────────────────────────
  /** head 충돌을 큐에서 제거(resolve 응답 후). applyToAll 이면 같은 op 의 큐도 비운다. */
  popConflict(operationId: string, applyToAll: boolean): void

  // 파생 헬퍼 ────────────────────────────────────────────────────────────
  /** 진행/대기 중(완료 아님) 작업 목록. */
  activeOperations(): Operation[]
  /** 현재 표시할 충돌(없으면 undefined). */
  headConflict(): ConflictItem | undefined
}

export const createOperationsSlice: SliceCreator<OperationsSlice> = (set, get) => ({
  operations: {},
  operationOrder: [],
  conflictQueue: [],

  registerOperation(operationId, kind, refreshPaths) {
    set((s) => {
      s.operations[operationId] = {
        operationId,
        kind,
        status: 'running',
        progress: emptyProgress(),
        summary: null,
        startedAt: Date.now(),
        refreshPaths: [...refreshPaths]
      }
      if (!s.operationOrder.includes(operationId)) s.operationOrder.push(operationId)
    })
  },

  markCancelling(operationId) {
    set((s) => {
      const op = s.operations[operationId]
      if (op && op.status !== 'done' && op.status !== 'partial-failed') {
        op.status = 'cancelling'
      }
    })
  },

  dismissOperation(operationId) {
    set((s) => {
      delete s.operations[operationId]
      s.operationOrder = s.operationOrder.filter((id) => id !== operationId)
      // 닫는 작업에 매달린 충돌도 정리.
      s.conflictQueue = s.conflictQueue.filter((c) => c.operationId !== operationId)
    })
  },

  _opProgress(evt) {
    set((s) => {
      const op = s.operations[evt.operationId]
      if (!op) return
      // cancelling 중에도 진행분은 반영(취소 지연 동안 카운터 갱신).
      if (op.status === 'running' || op.status === 'conflict') op.status = 'running'
      op.progress = {
        processedBytes: evt.processedBytes,
        totalBytes: evt.totalBytes,
        processedItems: evt.processedItems,
        totalItems: evt.totalItems,
        currentName: evt.currentName,
        bytesPerSec: evt.bytesPerSec ?? 0
      }
    })
  },

  _opConflict(evt) {
    set((s) => {
      const op = s.operations[evt.operationId]
      if (op) op.status = 'conflict'
      // 동일 conflictId 중복 푸시 방지.
      const dup = s.conflictQueue.some(
        (c) => c.operationId === evt.operationId && c.conflictId === evt.conflictId
      )
      if (!dup) {
        s.conflictQueue.push({
          operationId: evt.operationId,
          conflictId: evt.conflictId,
          source: evt.source,
          target: evt.target
        })
      }
    })
  },

  _opDone(operationId, summary) {
    set((s) => {
      const op = s.operations[operationId]
      if (!op) return
      op.summary = summary
      op.status = summary.failedItems > 0 ? 'partial-failed' : 'done'
      // 완료 작업의 남은 충돌은 정리.
      s.conflictQueue = s.conflictQueue.filter((c) => c.operationId !== operationId)
    })
  },

  popConflict(operationId, applyToAll) {
    set((s) => {
      if (applyToAll) {
        s.conflictQueue = s.conflictQueue.filter((c) => c.operationId !== operationId)
      } else {
        // head(해당 op 의 첫 충돌) 1개만 제거.
        const idx = s.conflictQueue.findIndex((c) => c.operationId === operationId)
        if (idx >= 0) s.conflictQueue.splice(idx, 1)
      }
      const op = s.operations[operationId]
      if (op && op.status === 'conflict') op.status = 'running'
    })
  },

  activeOperations() {
    const { operations, operationOrder } = get()
    return operationOrder
      .map((id) => operations[id])
      .filter((op): op is Operation => !!op)
  },

  headConflict() {
    return get().conflictQueue[0]
  }
})
