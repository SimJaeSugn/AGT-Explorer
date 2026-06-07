/**
 * 스캔 Worker ↔ Main 통신 프로토콜 (I장 — Top10 디스크 사용량 스캔).
 *
 * ScanManager(Main) 와 scanWorker(Worker Thread) 사이의 메시지 타입을 단일
 * 출처로 둔다. protocol.ts(파일작업) 와 동형 — IPC(Renderer) 계약이 아니라
 * **Main 내부** 스레드 경계 전용이므로 shared/ipc 가 아니라 main/workers 에 둔다.
 *
 * 전송 규칙: worker_threads 의 postMessage 는 구조화 복제(structured clone)를
 * 쓰므로 순수 직렬화 가능 객체만 주고받는다(함수·클래스 금지).
 *
 * 취소: 협조적 취소를 위해 SharedArrayBuffer(Int32Array[0]) 1워드를 공유한다.
 * Main 이 Atomics.store(cancelFlag, CANCEL_FLAG_INDEX, 1) 로 세팅하면 Worker 가
 * 디렉토리/항목 경계에서 즉시 감지(메시지 큐 지연 없이) → canceled 부분결과 반환.
 *
 * 추적성: 계획서 §2.4 · ADR-005(Worker 실행 모델) · protocol.ts 선례.
 */
import type { FileOpErrorCode, ScanResult } from '@shared/dto'

/** Worker 시작 시 1회 전달되는 스캔 명세(Main → Worker). */
export interface ScanJob {
  readonly scanId: string
  /** 스캔 루트(폴더 또는 드라이브). 핸들러에서 정규화·존재/디렉토리 검증 완료. */
  readonly rootPath: string
  /** 취소 플래그용 SharedArrayBuffer(Int32 1워드). */
  readonly cancelBuffer: SharedArrayBuffer
}

// ── Worker → Main 메시지 ────────────────────────────────────────────────

/** 진행 보고(누적 항목/바이트 + 현재 경로). Main 이 200ms 스로틀로 중계. */
export interface ScanProgressMsg {
  readonly type: 'progress'
  readonly scannedItems: number
  readonly scannedBytes: number
  readonly currentPath: string
}

/** 스캔 종료(Top10 + 요약 결과). */
export interface ScanDoneMsg {
  readonly type: 'done'
  readonly result: ScanResult
}

/** 치명적 오류(스캔 자체 시작 불가 등 — 항목 단위 오류는 skipped 로 격리됨). */
export interface ScanFatalMsg {
  readonly type: 'fatal'
  readonly code: FileOpErrorCode
  readonly message: string
  readonly path?: string
}

export type ScanOutMsg = ScanProgressMsg | ScanDoneMsg | ScanFatalMsg

/** 취소 플래그 인덱스(Int32Array). protocol.ts 와 동일 규약. */
export const CANCEL_FLAG_INDEX = 0
