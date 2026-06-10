/**
 * grep Worker ↔ Main 통신 프로토콜 (M8 — 내용 검색 grep, ADR-010).
 *
 * GrepManager(Main) 와 grepWorker(Worker Thread) 사이의 메시지 타입을 단일 출처로
 * 둔다. scanProtocol.ts·hashProtocol.ts 와 동형 — IPC(Renderer) 계약이 아니라
 * **Main 내부** 스레드 경계 전용이므로 shared/ipc 가 아니라 main/workers 에 둔다.
 *
 * 전송 규칙: worker_threads postMessage 는 구조화 복제(structured clone) — 순수
 * 직렬화 가능 객체만(함수·클래스 금지). 취소는 SharedArrayBuffer(Int32[0]) 1워드.
 *
 * 추적성: ADR-010 §결정②④⑤ · scanProtocol.ts·hashProtocol.ts 선례.
 */
import type { FileOpErrorCode, GrepLineDTO } from '@shared/dto'
import type { SearchContentStartReq } from '@shared/ipc/contracts'

/** Worker 시작 시 1회 전달되는 grep 잡 명세(Main → Worker). 경로는 정규화 완료. */
export interface GrepJob {
  readonly jobId: string
  /** 핸들러가 guardPath 정규화·디렉토리 검증 완료한 요청(root 절대경로). */
  readonly payload: SearchContentStartReq
  /** 취소 플래그용 SharedArrayBuffer(Int32 1워드 — scanProtocol 동형). */
  readonly cancelBuffer: SharedArrayBuffer
}

// ── Worker → Main 메시지 ────────────────────────────────────────────────

/** 진행 보고(누적 스캔/일치 파일 + 현재 경로). Main 이 200ms 스로틀로 중계. */
export interface GrepProgressMsg {
  readonly type: 'progress'
  readonly scannedFiles: number
  readonly matchedFiles: number
  readonly currentPath: string
}

/** 파일 단위 증분 일치 결과. Main 이 그대로 search:content:match 로 중계. */
export interface GrepMatchMsg {
  readonly type: 'match'
  readonly file: string
  readonly lines: GrepLineDTO[]
}

/** grep 완료(총 일치 수 + truncated). */
export interface GrepDoneMsg {
  readonly type: 'done'
  readonly totalMatches: number
  readonly truncated: boolean
}

/** 치명적 오류(잡 자체 실패 — 파일 단위 오류는 엔진이 격리). 정규식 컴파일 실패 등. */
export interface GrepFatalMsg {
  readonly type: 'fatal'
  readonly code: FileOpErrorCode
  readonly message: string
  readonly path?: string
}

export type GrepOutMsg = GrepProgressMsg | GrepMatchMsg | GrepDoneMsg | GrepFatalMsg

/** 취소 플래그 인덱스(Int32Array). scanProtocol·hashProtocol 과 동일 규약. */
export const CANCEL_FLAG_INDEX = 0
