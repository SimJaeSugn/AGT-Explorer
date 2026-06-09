/**
 * 해시 Worker ↔ Main 통신 프로토콜 (M7 — 공용 해시·비교 엔진).
 *
 * HashManager(Main) 와 hashWorker(Worker Thread) 사이의 메시지 타입을 단일 출처로
 * 둔다. scanProtocol.ts 와 동형 — IPC(Renderer) 계약이 아니라 **Main 내부** 스레드
 * 경계 전용이므로 shared/ipc 가 아니라 main/workers 에 둔다.
 *
 * 전송 규칙: worker_threads postMessage 는 구조화 복제(structured clone) — 순수
 * 직렬화 가능 객체만(함수·클래스 금지). 취소는 SharedArrayBuffer(Int32[0]) 1워드.
 *
 * 추적성: ADR-009 §결정② · scanProtocol.ts 선례.
 */
import type {
  CompareResultDTO,
  DupGroupDTO,
  FileOpErrorCode,
  HashAlgo,
  VerifyMismatchDTO
} from '@shared/dto'
import type {
  HashCompareStartReq,
  HashDupStartReq,
  HashVerifyStartReq
} from '@shared/ipc/contracts'

/** 잡 종류(잡별 페이로드/완료 메시지 분기). */
export type HashJobKind = 'compare' | 'dup' | 'verify'

/** Worker 시작 시 1회 전달되는 해시 잡 명세(Main → Worker). 경로는 정규화 완료. */
export interface HashJob {
  readonly jobId: string
  readonly kind: HashJobKind
  /** 잡별 요청(핸들러가 guardPath 정규화 완료). */
  readonly payload: HashCompareStartReq | HashDupStartReq | HashVerifyStartReq
  readonly algo: HashAlgo
  /** 취소 플래그용 SharedArrayBuffer(Int32 1워드 — scanProtocol 동형). */
  readonly cancelBuffer: SharedArrayBuffer
}

// ── Worker → Main 메시지 ────────────────────────────────────────────────

/** 진행 보고(누적 항목/바이트 + 현재 경로). Main 이 200ms 스로틀로 중계. */
export interface HashProgressMsg {
  readonly type: 'progress'
  readonly scannedItems: number
  readonly scannedBytes: number
  readonly currentPath: string
}

/** P1 비교 완료. */
export interface HashCompareDoneMsg {
  readonly type: 'compare-done'
  readonly result: CompareResultDTO
}

/** R2 중복 탐지 완료. */
export interface HashDupDoneMsg {
  readonly type: 'dup-done'
  readonly groups: DupGroupDTO[]
  readonly truncated: boolean
}

/** R4 체크섬 검증 완료. */
export interface HashVerifyDoneMsg {
  readonly type: 'verify-done'
  readonly mismatches: VerifyMismatchDTO[]
  readonly verified: number
}

/** 치명적 오류(잡 자체 실패 — 항목 단위 오류는 엔진이 격리). */
export interface HashFatalMsg {
  readonly type: 'fatal'
  readonly code: FileOpErrorCode
  readonly message: string
  readonly path?: string
}

export type HashOutMsg =
  | HashProgressMsg
  | HashCompareDoneMsg
  | HashDupDoneMsg
  | HashVerifyDoneMsg
  | HashFatalMsg

/** 취소 플래그 인덱스(Int32Array). scanProtocol 과 동일 규약. */
export const CANCEL_FLAG_INDEX = 0
