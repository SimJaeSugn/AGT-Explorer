/**
 * IPC 요청/응답·이벤트 TS 타입(계약) — 단일 출처
 * (directory-structure §2 shared/ipc/contracts.ts).
 *
 * P1 에서 **전 채널**(fs:* / shell:* / op:* / clipboard:* / session:* /
 * settings:* / workspace:*)의 요청/응답·이벤트 shape 와
 * Result<T, FileOpError> 판별유니온·FileOpError 코드를 **동결**한다.
 * 미구현 채널도 타입은 모두 존재 → frontend 가 모킹 위에서 P2/P4/P5 UI 를 선행.
 *
 * Main/Preload/Renderer 가 동일 타입을 import → 계약 위반을 컴파일 타임에 검출.
 * domain 은 이 파일을 import 하지 못한다(.eslintrc): dto 만 허용.
 *
 * 추적성: SA §3.1~3.2, ADR-003.
 */
import type { CHANNELS } from './channels'
import type {
  ConflictPolicy,
  ConflictResolution,
  DirListResult,
  DriveDTO,
  FileEntryDTO,
  FileOpErrorCode,
  ListStreamChunk,
  ListStreamDone,
  ListStreamStart,
  OpKind,
  OpSummary,
  PathValidation,
  PreviewData,
  SessionSnapshot,
  SettingsSnapshot,
  WorkspaceInfo
} from '../dto'

// ────────────────────────────────────────────────────────────────────────
// Result<T, FileOpError> — 판별 유니온(도메인 오류 1급 전파, ADR-003)
// ────────────────────────────────────────────────────────────────────────

/** 도메인 오류 객체. throw 대신 Result.err 로 전파(직렬화 가능). */
export interface FileOpError {
  readonly code: FileOpErrorCode
  /** 사용자/로그용 메시지. */
  readonly message: string
  /** 오류가 발생한 경로(있으면). */
  readonly path?: string
  /** 원본 errno 등 추가 진단(선택). */
  readonly cause?: string
}

export interface Ok<T> {
  readonly ok: true
  readonly value: T
}

export interface Err {
  readonly ok: false
  readonly error: FileOpError
}

/** 성공/실패 판별 유니온. `if (r.ok)` 로 좁혀 사용한다. */
export type Result<T, E = FileOpError> = Ok<T> | (E extends FileOpError ? Err : { ok: false; error: E })

// 생성 헬퍼(Main/Preload/Renderer 공용).
export const ok = <T>(value: T): Ok<T> => ({ ok: true, value })
export const err = (error: FileOpError): Err => ({ ok: false, error })

// ────────────────────────────────────────────────────────────────────────
// 채널별 요청/응답 계약 — invoke/handle (요청-응답)
// ────────────────────────────────────────────────────────────────────────

// ── fs:* 읽기 계열 (구현 P1) ──────────────────────────────────────────
export interface FsListReq {
  readonly path: string
  readonly showHidden: boolean
}
export interface FsStatReq {
  readonly path: string
}
export interface FsTreeChildrenReq {
  readonly path: string
}
export interface FsValidatePathReq {
  readonly path: string
}
export interface FsListStartReq {
  readonly path: string
  readonly showHidden: boolean
  /** 청크 1개당 항목 수(미지정 시 서비스 기본값). */
  readonly chunkSize?: number
}
export interface FsListCancelReq {
  readonly streamId: string
}

// ── fs:* 단발 기본조작 (계약만 동결, impl: P4) ────────────────────────
export interface FsMkdirReq {
  readonly parentDir: string
  readonly name: string
}
export interface FsCreateFileReq {
  readonly parentDir: string
  readonly name: string
  readonly template?: string
}
export interface FsRenameReq {
  readonly path: string
  readonly newName: string
}

// ── shell:* (계약만 동결) ─────────────────────────────────────────────
export interface ShellOpenReq {
  readonly path: string
}
export interface ShellOpenWithReq {
  readonly path: string
}
export interface ShellShowPropertiesReq {
  readonly path: string
}
export interface ShellIconReq {
  /** 경로 또는 확장자 중 하나(아이콘 캐시 키). */
  readonly path?: string
  readonly ext?: string
}
export interface ShellIconRes {
  readonly dataUrl: string
}

// ── op:* (계약만 동결, impl: P4) ──────────────────────────────────────
export interface OpStartReq {
  readonly kind: OpKind
  readonly sources: string[]
  /** copy/move 대상 디렉토리. */
  readonly destDir?: string
  /** 사전 일괄 충돌 규칙(없으면 충돌 시 op:conflict 질의). */
  readonly conflictPolicy?: ConflictPolicy
}
export interface OpStartRes {
  readonly operationId: string
}
export interface OpResolveReq {
  readonly operationId: string
  readonly conflictId: string
  readonly resolution: ConflictResolution
  readonly applyToAll: boolean
}
export interface OpCancelReq {
  readonly operationId: string
}

// ── clipboard:* (계약만 동결, impl: P4) ───────────────────────────────
export interface ClipboardFilesReq {
  readonly paths: string[]
}
export interface ClipboardPasteTargetReq {
  readonly destDir: string
}
/** 클립보드에 담긴 파일 작업 의도. */
export interface ClipboardReadRes {
  readonly paths: string[]
  /** 잘라내기(move)면 'cut', 복사면 'copy', 없으면 'none'. */
  readonly effect: 'copy' | 'cut' | 'none'
}

// ── dialog:* (계약만 동결, impl: P4) ──────────────────────────────────
export interface DialogConfirmPermanentDeleteReq {
  readonly paths: string[]
}
export interface DialogConfirmRes {
  readonly confirmed: boolean
}

// ── session:* / settings:* (계약만 동결, impl: P5) ────────────────────
export interface SessionSaveReq {
  readonly snapshot: SessionSnapshot
}
export interface SettingsSetReq {
  /** 부분 갱신(patch). 지정한 키만 반영. */
  readonly patch: Partial<SettingsSnapshot>
}
export interface TelemetrySetOptInReq {
  readonly enabled: boolean
}
/** telemetry:get-opt-in 응답 — 부팅 재수화용 옵트인 실제 값(신규 P6). */
export interface TelemetryGetOptInRes {
  readonly optIn: boolean
}

// ── workspace:* (계약만 동결, impl: P6) ───────────────────────────────
export interface WorkspaceSaveReq {
  readonly name: string
  readonly snapshot: SessionSnapshot
}
export interface WorkspaceLoadReq {
  readonly name: string
}
export interface WorkspaceDeleteReq {
  readonly name: string
}

// ── preview:* (신규 P6) ───────────────────────────────────────────────
export interface PreviewReadReq {
  readonly path: string
}

// ────────────────────────────────────────────────────────────────────────
// 전 채널 요청/응답 맵 — invoke/handle 채널의 단일 출처
// 각 항목: { req: 요청타입; res: 응답타입(Result 로 감쌈) }
// res 가 void 인 채널은 fire-and-forget(또는 Result<void>).
// ────────────────────────────────────────────────────────────────────────

export interface IpcRequestMap {
  // fs:* 읽기 (P1)
  [CHANNELS.FS_LIST]: { req: FsListReq; res: Result<DirListResult> }
  [CHANNELS.FS_STAT]: { req: FsStatReq; res: Result<FileEntryDTO> }
  [CHANNELS.FS_DRIVES]: { req: void; res: Result<DriveDTO[]> }
  [CHANNELS.FS_TREE_CHILDREN]: { req: FsTreeChildrenReq; res: Result<FileEntryDTO[]> }
  [CHANNELS.FS_VALIDATE_PATH]: { req: FsValidatePathReq; res: Result<PathValidation> }
  [CHANNELS.FS_LIST_START]: { req: FsListStartReq; res: Result<ListStreamStart> }
  [CHANNELS.FS_LIST_CANCEL]: { req: FsListCancelReq; res: Result<void> }

  // fs:* 단발 (P4)
  [CHANNELS.FS_MKDIR]: { req: FsMkdirReq; res: Result<FileEntryDTO> }
  [CHANNELS.FS_CREATE_FILE]: { req: FsCreateFileReq; res: Result<FileEntryDTO> }
  [CHANNELS.FS_RENAME]: { req: FsRenameReq; res: Result<FileEntryDTO> }

  // shell:* (P2/P4/P6)
  [CHANNELS.SHELL_OPEN]: { req: ShellOpenReq; res: Result<void> }
  [CHANNELS.SHELL_OPEN_WITH]: { req: ShellOpenWithReq; res: Result<void> }
  [CHANNELS.SHELL_SHOW_PROPERTIES]: { req: ShellShowPropertiesReq; res: Result<void> }
  [CHANNELS.SHELL_ICON]: { req: ShellIconReq; res: Result<ShellIconRes> }

  // op:* (P4)
  [CHANNELS.OP_START]: { req: OpStartReq; res: Result<OpStartRes> }
  [CHANNELS.OP_RESOLVE]: { req: OpResolveReq; res: Result<void> }
  [CHANNELS.OP_CANCEL]: { req: OpCancelReq; res: Result<void> }

  // clipboard:* (P4)
  [CHANNELS.CLIPBOARD_COPY_FILES]: { req: ClipboardFilesReq; res: Result<void> }
  [CHANNELS.CLIPBOARD_CUT_FILES]: { req: ClipboardFilesReq; res: Result<void> }
  // paste-target 은 effect(copy/cut)에 따라 OperationManager 로 op 를 시작하고
  // 그 operationId 를 반환한다(op:start 와 동일 라이프사이클 — BUG-001 수정).
  // 렌더러는 이 id 로 op:progress/conflict/done 을 상관(registerOperation)한다.
  [CHANNELS.CLIPBOARD_PASTE_TARGET]: { req: ClipboardPasteTargetReq; res: Result<OpStartRes> }
  [CHANNELS.CLIPBOARD_READ]: { req: void; res: Result<ClipboardReadRes> }

  // dialog:* (P4)
  [CHANNELS.DIALOG_CONFIRM_PERMANENT_DELETE]: {
    req: DialogConfirmPermanentDeleteReq
    res: Result<DialogConfirmRes>
  }

  // session:* / settings:* (P5)
  [CHANNELS.SESSION_LOAD]: { req: void; res: Result<SessionSnapshot> }
  [CHANNELS.SESSION_SAVE]: { req: SessionSaveReq; res: Result<void> }
  [CHANNELS.SETTINGS_GET]: { req: void; res: Result<SettingsSnapshot> }
  [CHANNELS.SETTINGS_SET]: { req: SettingsSetReq; res: Result<SettingsSnapshot> }
  [CHANNELS.TELEMETRY_SET_OPT_IN]: { req: TelemetrySetOptInReq; res: Result<void> }
  [CHANNELS.TELEMETRY_GET_OPT_IN]: { req: void; res: Result<TelemetryGetOptInRes> }

  // workspace:* (P6)
  [CHANNELS.WORKSPACE_SAVE]: { req: WorkspaceSaveReq; res: Result<void> }
  [CHANNELS.WORKSPACE_LIST]: { req: void; res: Result<WorkspaceInfo[]> }
  [CHANNELS.WORKSPACE_LOAD]: { req: WorkspaceLoadReq; res: Result<SessionSnapshot> }
  [CHANNELS.WORKSPACE_DELETE]: { req: WorkspaceDeleteReq; res: Result<void> }

  // preview:* (P6 — 신규 Should)
  [CHANNELS.PREVIEW_READ]: { req: PreviewReadReq; res: Result<PreviewData> }
}

/** invoke/handle 채널 키 집합. */
export type RequestChannel = keyof IpcRequestMap
export type RequestOf<C extends RequestChannel> = IpcRequestMap[C]['req']
export type ResponseOf<C extends RequestChannel> = IpcRequestMap[C]['res']

// ────────────────────────────────────────────────────────────────────────
// Main→Renderer 단방향 푸시 이벤트 맵 (스트림)
// ────────────────────────────────────────────────────────────────────────

// ── op:* 진행률/충돌/완료 이벤트 (계약만 동결, impl: P4) ───────────────
export interface OpProgressEvt {
  readonly operationId: string
  readonly processedBytes: number
  readonly totalBytes: number
  readonly processedItems: number
  readonly totalItems: number
  readonly currentName: string
  readonly bytesPerSec?: number
}
export interface OpConflictEvt {
  readonly operationId: string
  readonly conflictId: string
  readonly source: FileEntryDTO
  readonly target: FileEntryDTO
}
export interface OpDoneEvt {
  readonly operationId: string
  readonly summary: OpSummary
}

export interface IpcEventMap {
  // fs:list:* 스트림 (구현 P1)
  [CHANNELS.FS_LIST_CHUNK]: ListStreamChunk
  [CHANNELS.FS_LIST_DONE]: ListStreamDone
  [CHANNELS.FS_LIST_ERROR]: { readonly streamId: string; readonly error: FileOpError }

  // op:* 스트림 (계약만 동결, impl: P4)
  [CHANNELS.OP_PROGRESS]: OpProgressEvt
  [CHANNELS.OP_CONFLICT]: OpConflictEvt
  [CHANNELS.OP_DONE]: OpDoneEvt
}

export type EventChannel = keyof IpcEventMap
export type PayloadOf<C extends EventChannel> = IpcEventMap[C]
