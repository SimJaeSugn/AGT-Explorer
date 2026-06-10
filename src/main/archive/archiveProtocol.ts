/**
 * 압축 추출/추가 Worker ↔ Main 통신 프로토콜 (§Q1 M9 · ADR-008 결정③).
 *
 * ArchiveService(Main)가 new Worker(...) 로 띄우고 workerData=ArchiveJob 을 준다. 워커는
 * inflate(추출)/deflate(추가)를 **메인 스레드 밖에서** 실행하고 진행/완료/실패/스킵을
 * parentPort.postMessage 로 보고한다(hashProtocol.ts 동형 — Main 내부 스레드 경계 전용이라
 * shared/ipc 가 아니라 main/archive 에 둔다).
 *
 * 전송 규칙: postMessage 는 구조화 복제(순수 직렬화 객체만). 취소는 SharedArrayBuffer(Int32[0])
 * 1워드(scanProtocol/hashProtocol 동형).
 */
import type { FileOpErrorCode } from '@shared/dto'

/** 잡 종류. */
export type ArchiveJobKind = 'extract' | 'add'

/** 추가(add) 신규 항목 1개(워커가 zip 에 deflate). */
export interface ArchiveAddItem {
  /** zip 내부 엔트리명(POSIX · 핸들러/서비스가 safeArchiveEntryName 통과). */
  readonly entryName: string
  /** 로컬 소스 파일 절대경로(guardPath 통과 · 파일만). */
  readonly localPath: string
  /** 소스 크기(진행률 분모). */
  readonly size: number
}

/** Worker 시작 시 1회 전달되는 압축 잡 명세(Main → Worker). 경로는 정규화 완료. */
export interface ArchiveJob {
  readonly jobId: string
  readonly kind: ArchiveJobKind
  /** 대상 zip 로컬 절대경로(추출=읽기, 추가=재작성). */
  readonly archivePath: string
  // ── extract 전용 ──
  /** 추출 대상 내부 경로(zip 내부 POSIX 상대 — 파일/폴더 prefix). */
  readonly innerPaths?: readonly string[]
  /** 로컬 도착 디렉토리(guardPath 통과). 추출 전용. */
  readonly destDir?: string
  // ── add 전용 ──
  /** 추가할 신규 항목(파일 단위로 전개 완료). */
  readonly addItems?: readonly ArchiveAddItem[]
  /** 덮어쓰기로 제외할 기존 zip 엔트리명 집합(add 전용 · overwrite 정책 결과). */
  readonly skipExisting?: readonly string[]
  /** 취소 플래그용 SharedArrayBuffer(Int32 1워드). */
  readonly cancelBuffer: SharedArrayBuffer
}

// ── Worker → Main 메시지 ────────────────────────────────────────────────

/** 진행 보고(누적 항목/바이트 + 현재 경로). Main 이 op:* 스로틀로 중계. */
export interface ArchiveProgressMsg {
  readonly type: 'progress'
  readonly processedItems: number
  readonly totalItems: number
  readonly processedBytes: number
  readonly totalBytes: number
  readonly currentName: string
}

/** 개별 항목 격리(Zip Slip 이탈·심볼릭·암호·읽기 실패 — 잡은 계속). */
export interface ArchiveSkipMsg {
  readonly type: 'skip'
  readonly entryName: string
  readonly code: FileOpErrorCode
  readonly message: string
}

/** 잡 완료(성공/실패/취소 집계). */
export interface ArchiveDoneMsg {
  readonly type: 'done'
  readonly succeededItems: number
  readonly canceled: boolean
}

/** 치명적 오류(잡 자체 실패 — 손상·암호·디스크). */
export interface ArchiveFatalMsg {
  readonly type: 'fatal'
  readonly code: FileOpErrorCode
  readonly message: string
  readonly path?: string
}

export type ArchiveOutMsg =
  | ArchiveProgressMsg
  | ArchiveSkipMsg
  | ArchiveDoneMsg
  | ArchiveFatalMsg

/** 취소 플래그 인덱스(Int32Array). scanProtocol/hashProtocol 과 동일 규약. */
export const CANCEL_FLAG_INDEX = 0
