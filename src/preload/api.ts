/**
 * Renderer 에 노출하는 안전 API 표면 (preload 신뢰 게이트, ADR-005).
 *
 * 채널마다 래퍼 함수 1개씩만 노출하고, ipcRenderer 통째 노출은 금지한다.
 * shared/ipc 계약(IpcRequestMap·IpcEventMap)을 그대로 import 해 타입을 공유한다
 * → Main·Renderer 와 동일 타입이므로 계약 위반을 컴파일 타임에 검출.
 *
 * P1 구현: fs:* 읽기 메서드 + fs:list 스트림 이벤트 구독.
 * 나머지 채널(shell/op/clipboard/session/settings/workspace)은 타입만 노출하고
 * 호출부 실사용은 각 Phase(P2/P4/P5/P6)에서 활성화한다.
 */
import { ipcRenderer } from 'electron'
import { CHANNELS } from '@shared/ipc/channels'
import type {
  ClipboardFilesReq,
  ClipboardPasteTargetReq,
  ClipboardReadRes,
  DialogConfirmPermanentDeleteReq,
  DialogConfirmRes,
  FsCreateFileReq,
  FsListCancelReq,
  FsListReq,
  FsListStartReq,
  FsMkdirReq,
  FsRenameReq,
  FsStatReq,
  FsTreeChildrenReq,
  FsValidatePathReq,
  OpCancelReq,
  OpConflictEvt,
  OpDoneEvt,
  OpProgressEvt,
  OpResolveReq,
  OpStartReq,
  OpStartRes,
  AnalyzeScanStartReq,
  AnalyzeScanStartRes,
  AnalyzeScanCancelReq,
  ScanProgressEvt,
  ScanDoneEvt,
  ScanErrorEvt,
  PreviewReadReq,
  Result,
  SessionSaveReq,
  SettingsSetReq,
  ShellIconReq,
  ShellIconRes,
  ShellOpenReq,
  ShellOpenTerminalReq,
  ShellOpenWithReq,
  ShellShowPropertiesReq,
  TelemetryGetOptInRes,
  TelemetrySetOptInReq,
  WorkspaceDeleteReq,
  WorkspaceLoadReq,
  WorkspaceSaveReq,
  FileOpError
} from '@shared/ipc/contracts'
import type {
  DirListResult,
  DriveDTO,
  FileEntryDTO,
  ListStreamChunk,
  ListStreamDone,
  ListStreamStart,
  OpSummary,
  PathValidation,
  PreviewData,
  SessionSnapshot,
  SettingsSnapshot,
  WorkspaceInfo
} from '@shared/dto'

/** 구독 해제 함수. */
export type Unsubscribe = () => void

function invoke<TRes>(channel: string, req?: unknown): Promise<TRes> {
  return ipcRenderer.invoke(channel, req) as Promise<TRes>
}

/** 이벤트 채널 구독 헬퍼(payload 만 콜백으로 전달, IpcRendererEvent 누출 방지). */
function subscribe<T>(channel: string, cb: (payload: T) => void): Unsubscribe {
  const listener = (_e: unknown, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

// ── fs 스트림 에러 페이로드 형태(contracts IpcEventMap 와 동일) ─────────
interface ListStreamErrorEvt {
  readonly streamId: string
  readonly error: FileOpError
}

export interface ExplorerApi {
  /** 빌드 식별용. */
  readonly version: string

  readonly fs: {
    // ── 읽기 계열 (구현 P1) ──────────────────────────────────────
    list(req: FsListReq): Promise<Result<DirListResult>>
    stat(req: FsStatReq): Promise<Result<FileEntryDTO>>
    drives(): Promise<Result<DriveDTO[]>>
    treeChildren(req: FsTreeChildrenReq): Promise<Result<FileEntryDTO[]>>
    validatePath(req: FsValidatePathReq): Promise<Result<PathValidation>>

    // ── 스트리밍 (구현 P1) ───────────────────────────────────────
    listStart(req: FsListStartReq): Promise<Result<ListStreamStart>>
    listCancel(req: FsListCancelReq): Promise<Result<void>>
    onListChunk(cb: (evt: ListStreamChunk) => void): Unsubscribe
    onListDone(cb: (evt: ListStreamDone) => void): Unsubscribe
    onListError(cb: (evt: ListStreamErrorEvt) => void): Unsubscribe

    // ── 단발 기본조작 (타입만 노출, 호출부 impl: P4) ─────────────
    mkdir(req: FsMkdirReq): Promise<Result<FileEntryDTO>>
    createFile(req: FsCreateFileReq): Promise<Result<FileEntryDTO>>
    rename(req: FsRenameReq): Promise<Result<FileEntryDTO>>
  }

  // ── shell:* (타입만 노출, impl: P2/P4/P6) ──────────────────────
  readonly shell: {
    open(req: ShellOpenReq): Promise<Result<void>>
    openWith(req: ShellOpenWithReq): Promise<Result<void>>
    showProperties(req: ShellShowPropertiesReq): Promise<Result<void>>
    icon(req: ShellIconReq): Promise<Result<ShellIconRes>>
    openTerminal(req: ShellOpenTerminalReq): Promise<Result<void>>
  }

  // ── op:* (타입만 노출, impl: P4) ───────────────────────────────
  readonly op: {
    start(req: OpStartReq): Promise<Result<OpStartRes>>
    resolve(req: OpResolveReq): Promise<Result<void>>
    cancel(req: OpCancelReq): Promise<Result<void>>
    onProgress(cb: (evt: OpProgressEvt) => void): Unsubscribe
    onConflict(cb: (evt: OpConflictEvt) => void): Unsubscribe
    onDone(cb: (evt: OpDoneEvt) => void): Unsubscribe
  }

  // ── clipboard:* (타입만 노출, impl: P4) ────────────────────────
  readonly clipboard: {
    copyFiles(req: ClipboardFilesReq): Promise<Result<void>>
    cutFiles(req: ClipboardFilesReq): Promise<Result<void>>
    // BUG-001: paste-target 은 effect(copy/cut)에 따라 op 를 시작하고
    // 그 operationId 를 반환한다(op:start 와 동일 shape — OpStartRes).
    pasteTarget(req: ClipboardPasteTargetReq): Promise<Result<OpStartRes>>
    read(): Promise<Result<ClipboardReadRes>>
  }

  // ── dialog:* (타입만 노출, impl: P4) ───────────────────────────
  readonly dialog: {
    confirmPermanentDelete(
      req: DialogConfirmPermanentDeleteReq
    ): Promise<Result<DialogConfirmRes>>
  }

  // ── session:* / settings:* (타입만 노출, impl: P5) ─────────────
  readonly session: {
    load(): Promise<Result<SessionSnapshot>>
    save(req: SessionSaveReq): Promise<Result<void>>
  }
  readonly settings: {
    get(): Promise<Result<SettingsSnapshot>>
    set(req: SettingsSetReq): Promise<Result<SettingsSnapshot>>
  }
  readonly telemetry: {
    setOptIn(req: TelemetrySetOptInReq): Promise<Result<void>>
    /** telemetry:get-opt-in — 부팅 재수화용 옵트인 실제 값 조회(impl: P6). */
    getOptIn(): Promise<Result<TelemetryGetOptInRes>>
  }

  // ── workspace:* (타입만 노출, impl: P6) ────────────────────────
  readonly workspace: {
    save(req: WorkspaceSaveReq): Promise<Result<void>>
    list(): Promise<Result<WorkspaceInfo[]>>
    load(req: WorkspaceLoadReq): Promise<Result<SessionSnapshot>>
    delete(req: WorkspaceDeleteReq): Promise<Result<void>>
  }

  // ── preview:* (타입만 노출, impl: P6) ──────────────────────────
  readonly preview: {
    read(req: PreviewReadReq): Promise<Result<PreviewData>>
  }

  // ── analyze:scan:* (타입만 노출, 핸들러 impl: I장 다음 단계) ────
  readonly analyze: {
    scanStart(req: AnalyzeScanStartReq): Promise<Result<AnalyzeScanStartRes>>
    scanCancel(req: AnalyzeScanCancelReq): Promise<Result<void>>
    onScanProgress(cb: (evt: ScanProgressEvt) => void): Unsubscribe
    onScanDone(cb: (evt: ScanDoneEvt) => void): Unsubscribe
    onScanError(cb: (evt: ScanErrorEvt) => void): Unsubscribe
  }
}

export const api: ExplorerApi = {
  version: '0.1.0',

  fs: {
    list: (req) => invoke(CHANNELS.FS_LIST, req),
    stat: (req) => invoke(CHANNELS.FS_STAT, req),
    drives: () => invoke(CHANNELS.FS_DRIVES),
    treeChildren: (req) => invoke(CHANNELS.FS_TREE_CHILDREN, req),
    validatePath: (req) => invoke(CHANNELS.FS_VALIDATE_PATH, req),

    listStart: (req) => invoke(CHANNELS.FS_LIST_START, req),
    listCancel: (req) => invoke(CHANNELS.FS_LIST_CANCEL, req),
    onListChunk: (cb) => subscribe(CHANNELS.FS_LIST_CHUNK, cb),
    onListDone: (cb) => subscribe(CHANNELS.FS_LIST_DONE, cb),
    onListError: (cb) => subscribe(CHANNELS.FS_LIST_ERROR, cb),

    mkdir: (req) => invoke(CHANNELS.FS_MKDIR, req),
    createFile: (req) => invoke(CHANNELS.FS_CREATE_FILE, req),
    rename: (req) => invoke(CHANNELS.FS_RENAME, req)
  },

  shell: {
    open: (req) => invoke(CHANNELS.SHELL_OPEN, req),
    openWith: (req) => invoke(CHANNELS.SHELL_OPEN_WITH, req),
    showProperties: (req) => invoke(CHANNELS.SHELL_SHOW_PROPERTIES, req),
    icon: (req) => invoke(CHANNELS.SHELL_ICON, req),
    openTerminal: (req) => invoke(CHANNELS.SHELL_OPEN_TERMINAL, req)
  },

  op: {
    start: (req) => invoke(CHANNELS.OP_START, req),
    resolve: (req) => invoke(CHANNELS.OP_RESOLVE, req),
    cancel: (req) => invoke(CHANNELS.OP_CANCEL, req),
    onProgress: (cb) => subscribe(CHANNELS.OP_PROGRESS, cb),
    onConflict: (cb) => subscribe(CHANNELS.OP_CONFLICT, cb),
    onDone: (cb) => subscribe(CHANNELS.OP_DONE, cb)
  },

  clipboard: {
    copyFiles: (req) => invoke(CHANNELS.CLIPBOARD_COPY_FILES, req),
    cutFiles: (req) => invoke(CHANNELS.CLIPBOARD_CUT_FILES, req),
    pasteTarget: (req) => invoke(CHANNELS.CLIPBOARD_PASTE_TARGET, req),
    read: () => invoke(CHANNELS.CLIPBOARD_READ)
  },

  dialog: {
    confirmPermanentDelete: (req) => invoke(CHANNELS.DIALOG_CONFIRM_PERMANENT_DELETE, req)
  },

  session: {
    load: () => invoke(CHANNELS.SESSION_LOAD),
    save: (req) => invoke(CHANNELS.SESSION_SAVE, req)
  },
  settings: {
    get: () => invoke(CHANNELS.SETTINGS_GET),
    set: (req) => invoke(CHANNELS.SETTINGS_SET, req)
  },
  telemetry: {
    setOptIn: (req) => invoke(CHANNELS.TELEMETRY_SET_OPT_IN, req),
    getOptIn: () => invoke(CHANNELS.TELEMETRY_GET_OPT_IN)
  },

  workspace: {
    save: (req) => invoke(CHANNELS.WORKSPACE_SAVE, req),
    list: () => invoke(CHANNELS.WORKSPACE_LIST),
    load: (req) => invoke(CHANNELS.WORKSPACE_LOAD, req),
    delete: (req) => invoke(CHANNELS.WORKSPACE_DELETE, req)
  },

  preview: {
    read: (req) => invoke(CHANNELS.PREVIEW_READ, req)
  },

  analyze: {
    scanStart: (req) => invoke(CHANNELS.ANALYZE_SCAN_START, req),
    scanCancel: (req) => invoke(CHANNELS.ANALYZE_SCAN_CANCEL, req),
    onScanProgress: (cb) => subscribe(CHANNELS.ANALYZE_SCAN_PROGRESS, cb),
    onScanDone: (cb) => subscribe(CHANNELS.ANALYZE_SCAN_DONE, cb),
    onScanError: (cb) => subscribe(CHANNELS.ANALYZE_SCAN_ERROR, cb)
  }
}

// 미사용 import 경고 방지를 위한 명시적 재노출(타입 전용).
export type { OpSummary }
