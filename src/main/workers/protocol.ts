/**
 * Worker ↔ Main 통신 프로토콜 (P4, SPK-Worker 결정 = Worker Threads).
 *
 * OperationManager(Main) 와 fileOpWorker(Worker Thread) 사이의 메시지 타입을
 * 단일 출처로 둔다. 이 타입들은 IPC(Renderer) 계약이 아니라 **Main 내부**
 * 프로세스(스레드) 경계 전용이다 → shared/ipc 가 아니라 main/workers 에 둔다.
 *
 * 전송 규칙: worker_threads 의 postMessage 는 구조화 복제(structured clone)를
 * 쓰므로 순수 직렬화 가능 객체만 주고받는다(함수·클래스 금지).
 *
 * 취소: 협조적 취소를 위해 SharedArrayBuffer(Int32Array) 를 공유한다.
 * Main 이 Atomics.store(view, CANCEL_FLAG_INDEX, 1) 로 세팅하면 Worker 가 안전
 * 지점에서 즉시 감지(메시지 큐 지연 없이). 충돌 해소 응답은 메시지로 전달한다.
 *
 * 일시정지(M7 W2 · ADR-011): 같은 SharedArrayBuffer 를 **2워드**로 확장해
 * Int32Array[PAUSE_FLAG_INDEX(=1)] 에 일시정지 플래그를 둔다. Worker 는 파일 경계
 * 에서 이 플래그를 폴링해 1 이면 현재 파일 완료 후 재개(0)까지 대기한다(파일 경계
 * 일시정지·ADR-011 결정②). **취소 인덱스(0) 의미·동작은 불변**(회귀 0): cancel 만
 * 쓰는 단발 경로는 인덱스 0 만 set/load 하므로 2워드화는 비파괴이다.
 *
 * 추적성: SA §4.1, ADR-005(Worker 실행 모델), roadmap SPK-Worker, ADR-011.
 */
import type { ConflictResolution, FileOpErrorCode, OpFailure, OpKind } from '@shared/dto'

/** Worker 시작 시 1회 전달되는 작업 명세(Main → Worker). */
export interface WorkerJob {
  readonly operationId: string
  /** 'copy' | 'move' | 'delete'. trash 는 Main 에서 직접 처리(Worker 미사용). */
  readonly kind: Exclude<OpKind, 'trash'>
  readonly sources: string[]
  /** copy/move 대상 디렉토리(delete 는 미사용). */
  readonly destDir?: string
  /** 사전 일괄 충돌 정책(없으면 충돌 시 질의). */
  readonly conflictPolicy?: ConflictResolution
  /**
   * 협조 플래그용 SharedArrayBuffer(Int32 2워드): [0]=cancel(불변), [1]=pause(M7).
   * 단발 경로는 cancel(0)만 쓰고 pause(1)는 항상 0 → 기존 동작 동치.
   */
  readonly cancelBuffer: SharedArrayBuffer
}

// ── Worker → Main 메시지 ────────────────────────────────────────────────

/** 사전 집계 완료(총 항목/총 바이트 확정 → 진행률 분모). */
export interface WorkerTotalsMsg {
  readonly type: 'totals'
  readonly totalItems: number
  readonly totalBytes: number
}

/** 진행 보고(누적 바이트/항목). Main 이 200ms 스로틀로 합산·중계. */
export interface WorkerProgressMsg {
  readonly type: 'progress'
  readonly processedBytes: number
  readonly processedItems: number
  readonly currentName: string
}

/** 충돌 질의(대상에 동명 존재 → Main 이 op:conflict 로 Renderer 에 묻는다). */
export interface WorkerConflictMsg {
  readonly type: 'conflict'
  readonly conflictId: string
  readonly sourcePath: string
  readonly targetPath: string
  /** 비교 표시용 메타. */
  readonly sourceSize: number
  readonly sourceMtime: number
  readonly sourceIsDir: boolean
  readonly targetSize: number
  readonly targetMtime: number
  readonly targetIsDir: boolean
}

/** 개별 실패 보고(부분 실패 누적). */
export interface WorkerFailureMsg {
  readonly type: 'failure'
  readonly failure: OpFailure
}

/** 작업 종료(성공/실패/취소 요약). */
export interface WorkerDoneMsg {
  readonly type: 'done'
  readonly succeededItems: number
  readonly failedItems: number
  readonly canceled: boolean
  readonly failures: OpFailure[]
}

/** 치명적 오류(작업 자체 시작 불가 등). */
export interface WorkerFatalMsg {
  readonly type: 'fatal'
  readonly code: FileOpErrorCode
  readonly message: string
  readonly path?: string
}

export type WorkerOutMsg =
  | WorkerTotalsMsg
  | WorkerProgressMsg
  | WorkerConflictMsg
  | WorkerFailureMsg
  | WorkerDoneMsg
  | WorkerFatalMsg

// ── Main → Worker 메시지 ────────────────────────────────────────────────

/** 충돌 해소 응답(Renderer → Main → Worker). */
export interface ResolveConflictMsg {
  readonly type: 'resolve'
  readonly conflictId: string
  readonly resolution: ConflictResolution
  /** 이후 동일 유형 충돌에 자동 적용. */
  readonly applyToAll: boolean
}

export type WorkerInMsg = ResolveConflictMsg

/** 취소 플래그 인덱스(Int32Array). 불변 — 단발/큐 공통 취소 동치. */
export const CANCEL_FLAG_INDEX = 0

/** 일시정지 플래그 인덱스(Int32Array, M7 W2 · ADR-011). 1=일시정지, 0=실행/재개. */
export const PAUSE_FLAG_INDEX = 1

/** 협조 플래그 버퍼 워드 수(cancel + pause). */
export const FLAG_WORD_COUNT = 2
