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
  AppOpenPathEvt,
  ClipboardFilesReadRes,
  ClipboardFilesReq,
  ClipboardHasFilesRes,
  ClipboardPasteTargetReq,
  ClipboardReadRes,
  ClipboardWriteFilesReq,
  DialogConfirmPermanentDeleteReq,
  DialogConfirmRes,
  DialogPickDirectoryReq,
  DialogPickDirectoryRes,
  FsLinkFinalizeReq,
  DndStartDragReq,
  DndStartDragRes,
  FsCreateFileReq,
  FsListCancelReq,
  FsListReq,
  FsListStartReq,
  FsMkdirReq,
  FsRenameReq,
  FsStatReq,
  FsTreeChildrenReq,
  FsValidatePathReq,
  FsWatchStartReq,
  FsWatchStartRes,
  FsWatchStopReq,
  FsWatchEvt,
  FsWatchErrorEvt,
  OpCancelReq,
  OpConflictEvt,
  OpDoneEvt,
  OpProgressEvt,
  OpResolveReq,
  OpRobocopyStartReq,
  OpStartReq,
  OpStartRes,
  RemoteConnectReq,
  RemoteConnectRes,
  RemoteCredDeleteReq,
  RemoteCredHasReq,
  RemoteCredSaveReq,
  RemoteDeleteReq,
  RemoteDisconnectReq,
  RemoteDownloadReq,
  RemoteError,
  RemoteHostKeyEvt,
  RemoteListReq,
  RemoteListRes,
  RemoteMkdirReq,
  RemoteProfileDeleteReq,
  RemoteProfileUpsertReq,
  RemoteRenameReq,
  RemoteSessionErrorEvt,
  RemoteStatReq,
  RemoteTransferRes,
  RemoteUploadReq,
  AnalyzeScanStartReq,
  AnalyzeScanStartRes,
  AnalyzeScanCancelReq,
  ScanProgressEvt,
  ScanDoneEvt,
  ScanErrorEvt,
  HashCompareStartReq,
  HashDupStartReq,
  HashVerifyStartReq,
  HashCancelReq,
  HashJobStartRes,
  HashProgressEvt,
  HashCompareDoneEvt,
  HashDupDoneEvt,
  HashVerifyDoneEvt,
  HashErrorEvt,
  QueueListRes,
  QueuePauseReq,
  QueueResumeReq,
  QueueRetryReq,
  QueueSetConcurrencyReq,
  QueueStateEvt,
  TrashRestoreReq,
  TrashEmptyReq,
  PreviewReadReq,
  ThumbnailReq,
  ThumbnailRes,
  Result,
  SessionSaveReq,
  SettingsSetReq,
  ShellIconReq,
  ShellIconRes,
  ShellOpenExternalReq,
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
  RemoteProfileDTO,
  SessionSnapshot,
  SettingsSnapshot,
  TrashItemDTO,
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

  // ── app:* (V2 — 탐색기 "AGT-Finder로 열기" 경로 푸시 수신) ──────
  readonly app: {
    onOpenPath(cb: (evt: AppOpenPathEvt) => void): Unsubscribe
  }

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
    linkFinalize(req: FsLinkFinalizeReq): Promise<Result<void>>

    // ── fs:watch:* 디렉토리 실시간 감시 (타입만 노출, 핸들러 impl: J장 다음 단계) ─
    watchStart(req: FsWatchStartReq): Promise<Result<FsWatchStartRes>>
    watchStop(req: FsWatchStopReq): Promise<Result<void>>
    onWatchEvent(cb: (evt: FsWatchEvt) => void): Unsubscribe
    onWatchError(cb: (evt: FsWatchErrorEvt) => void): Unsubscribe
  }

  // ── shell:* (타입만 노출, impl: P2/P4/P6) ──────────────────────
  readonly shell: {
    open(req: ShellOpenReq): Promise<Result<void>>
    openWith(req: ShellOpenWithReq): Promise<Result<void>>
    showProperties(req: ShellShowPropertiesReq): Promise<Result<void>>
    icon(req: ShellIconReq): Promise<Result<ShellIconRes>>
    openTerminal(req: ShellOpenTerminalReq): Promise<Result<void>>
    openExternal(req: ShellOpenExternalReq): Promise<Result<void>>
  }

  // ── op:* (타입만 노출, impl: P4) ───────────────────────────────
  readonly op: {
    start(req: OpStartReq): Promise<Result<OpStartRes>>
    robocopyStart(req: OpRobocopyStartReq): Promise<Result<OpStartRes>>
    resolve(req: OpResolveReq): Promise<Result<void>>
    cancel(req: OpCancelReq): Promise<Result<void>>
    onProgress(cb: (evt: OpProgressEvt) => void): Unsubscribe
    onConflict(cb: (evt: OpConflictEvt) => void): Unsubscribe
    onDone(cb: (evt: OpDoneEvt) => void): Unsubscribe
  }

  // ── clipboard:* (타입만 노출, impl: P4 / §M M2 MP2) ────────────
  readonly clipboard: {
    copyFiles(req: ClipboardFilesReq): Promise<Result<void>>
    cutFiles(req: ClipboardFilesReq): Promise<Result<void>>
    // BUG-001: paste-target 은 effect(copy/cut)에 따라 op 를 시작하고
    // 그 operationId 를 반환한다(op:start 와 동일 shape — OpStartRes).
    pasteTarget(req: ClipboardPasteTargetReq): Promise<Result<OpStartRes>>
    read(): Promise<Result<ClipboardReadRes>>
    // ── CF_HDROP 양방향 (신규 §M M2 — 기존 메서드와 병존, impl: MP2) ─
    writeFiles(req: ClipboardWriteFilesReq): Promise<Result<void>>
    readFiles(): Promise<Result<ClipboardFilesReadRes>>
    hasFiles(): Promise<Result<ClipboardHasFilesRes>>
  }

  // ── dnd:* 외부 드래그 (타입만 노출, 신규 §M M1, impl: MP3) ──────
  readonly dnd: {
    startDrag(req: DndStartDragReq): Promise<Result<DndStartDragRes>>
  }

  // ── remote:* FTP/SFTP (타입만 노출, 신규 §M M3, impl: MP4) ──────
  // 비밀(secret)은 credSave/connect 요청 본문으로만 전달되며 응답에는 수록되지 않는다.
  readonly remote: {
    credSave(req: RemoteCredSaveReq): Promise<Result<void>>
    credHas(req: RemoteCredHasReq): Promise<Result<ClipboardHasFilesRes>>
    credDelete(req: RemoteCredDeleteReq): Promise<Result<void>>
    profileList(): Promise<Result<RemoteProfileDTO[]>>
    profileUpsert(req: RemoteProfileUpsertReq): Promise<Result<RemoteProfileDTO>>
    profileDelete(req: RemoteProfileDeleteReq): Promise<Result<void>>
    connect(req: RemoteConnectReq): Promise<Result<RemoteConnectRes, RemoteError>>
    disconnect(req: RemoteDisconnectReq): Promise<Result<void>>
    list(req: RemoteListReq): Promise<Result<RemoteListRes, RemoteError>>
    stat(req: RemoteStatReq): Promise<Result<FileEntryDTO, RemoteError>>
    mkdir(req: RemoteMkdirReq): Promise<Result<void, RemoteError>>
    rename(req: RemoteRenameReq): Promise<Result<void, RemoteError>>
    delete(req: RemoteDeleteReq): Promise<Result<void, RemoteError>>
    download(req: RemoteDownloadReq): Promise<Result<RemoteTransferRes, RemoteError>>
    upload(req: RemoteUploadReq): Promise<Result<RemoteTransferRes, RemoteError>>
    onHostKey(cb: (evt: RemoteHostKeyEvt) => void): Unsubscribe
    onSessionError(cb: (evt: RemoteSessionErrorEvt) => void): Unsubscribe
  }

  // ── dialog:* (타입만 노출, impl: P4 / V10) ─────────────────────
  readonly dialog: {
    confirmPermanentDelete(
      req: DialogConfirmPermanentDeleteReq
    ): Promise<Result<DialogConfirmRes>>
    pickDirectory(req: DialogPickDirectoryReq): Promise<Result<DialogPickDirectoryRes>>
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
    thumbnail(req: ThumbnailReq): Promise<Result<ThumbnailRes>>
  }

  // ── analyze:scan:* (타입만 노출, 핸들러 impl: I장 다음 단계) ────
  readonly analyze: {
    scanStart(req: AnalyzeScanStartReq): Promise<Result<AnalyzeScanStartRes>>
    scanCancel(req: AnalyzeScanCancelReq): Promise<Result<void>>
    onScanProgress(cb: (evt: ScanProgressEvt) => void): Unsubscribe
    onScanDone(cb: (evt: ScanDoneEvt) => void): Unsubscribe
    onScanError(cb: (evt: ScanErrorEvt) => void): Unsubscribe
  }

  // ── trash:* (타입만 노출, 핸들러/recycleBin impl: K장 다음 단계) ─
  readonly trash: {
    list(): Promise<Result<TrashItemDTO[]>>
    restore(req: TrashRestoreReq): Promise<Result<void>>
    empty(req: TrashEmptyReq): Promise<Result<void>>
  }

  // ── hash:* 공용 해시·비교 엔진 (신규 M7, 핸들러 impl: W1) ───────
  readonly hash: {
    compareStart(req: HashCompareStartReq): Promise<Result<HashJobStartRes>>
    dupStart(req: HashDupStartReq): Promise<Result<HashJobStartRes>>
    verifyStart(req: HashVerifyStartReq): Promise<Result<HashJobStartRes>>
    cancel(req: HashCancelReq): Promise<Result<void>>
    onCompareProgress(cb: (evt: HashProgressEvt) => void): Unsubscribe
    onCompareDone(cb: (evt: HashCompareDoneEvt) => void): Unsubscribe
    onDupProgress(cb: (evt: HashProgressEvt) => void): Unsubscribe
    onDupDone(cb: (evt: HashDupDoneEvt) => void): Unsubscribe
    onVerifyProgress(cb: (evt: HashProgressEvt) => void): Unsubscribe
    onVerifyDone(cb: (evt: HashVerifyDoneEvt) => void): Unsubscribe
    onError(cb: (evt: HashErrorEvt) => void): Unsubscribe
  }

  // ── queue:* 전송 큐 (타입만 노출, 큐 핸들러 impl: W2) ───────────
  readonly queue: {
    list(): Promise<Result<QueueListRes>>
    pause(req: QueuePauseReq): Promise<Result<void>>
    resume(req: QueueResumeReq): Promise<Result<void>>
    retry(req: QueueRetryReq): Promise<Result<void>>
    setConcurrency(req: QueueSetConcurrencyReq): Promise<Result<void>>
    onState(cb: (evt: QueueStateEvt) => void): Unsubscribe
  }
}

export const api: ExplorerApi = {
  version: '0.1.0',

  app: {
    onOpenPath: (cb) => subscribe(CHANNELS.APP_OPEN_PATH, cb)
  },

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
    rename: (req) => invoke(CHANNELS.FS_RENAME, req),
    linkFinalize: (req) => invoke(CHANNELS.FS_LINK_FINALIZE, req),

    watchStart: (req) => invoke(CHANNELS.FS_WATCH_START, req),
    watchStop: (req) => invoke(CHANNELS.FS_WATCH_STOP, req),
    onWatchEvent: (cb) => subscribe(CHANNELS.FS_WATCH_EVENT, cb),
    onWatchError: (cb) => subscribe(CHANNELS.FS_WATCH_ERROR, cb)
  },

  shell: {
    open: (req) => invoke(CHANNELS.SHELL_OPEN, req),
    openWith: (req) => invoke(CHANNELS.SHELL_OPEN_WITH, req),
    showProperties: (req) => invoke(CHANNELS.SHELL_SHOW_PROPERTIES, req),
    icon: (req) => invoke(CHANNELS.SHELL_ICON, req),
    openTerminal: (req) => invoke(CHANNELS.SHELL_OPEN_TERMINAL, req),
    openExternal: (req) => invoke(CHANNELS.SHELL_OPEN_EXTERNAL, req)
  },

  op: {
    start: (req) => invoke(CHANNELS.OP_START, req),
    robocopyStart: (req) => invoke(CHANNELS.OP_ROBOCOPY_START, req),
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
    read: () => invoke(CHANNELS.CLIPBOARD_READ),
    writeFiles: (req) => invoke(CHANNELS.CLIPBOARD_WRITE_FILES, req),
    readFiles: () => invoke(CHANNELS.CLIPBOARD_READ_FILES),
    hasFiles: () => invoke(CHANNELS.CLIPBOARD_HAS_FILES)
  },

  dnd: {
    startDrag: (req) => invoke(CHANNELS.DND_START_DRAG, req)
  },

  remote: {
    credSave: (req) => invoke(CHANNELS.REMOTE_CRED_SAVE, req),
    credHas: (req) => invoke(CHANNELS.REMOTE_CRED_HAS, req),
    credDelete: (req) => invoke(CHANNELS.REMOTE_CRED_DELETE, req),
    profileList: () => invoke(CHANNELS.REMOTE_PROFILE_LIST),
    profileUpsert: (req) => invoke(CHANNELS.REMOTE_PROFILE_UPSERT, req),
    profileDelete: (req) => invoke(CHANNELS.REMOTE_PROFILE_DELETE, req),
    connect: (req) => invoke(CHANNELS.REMOTE_CONNECT, req),
    disconnect: (req) => invoke(CHANNELS.REMOTE_DISCONNECT, req),
    list: (req) => invoke(CHANNELS.REMOTE_LIST, req),
    stat: (req) => invoke(CHANNELS.REMOTE_STAT, req),
    mkdir: (req) => invoke(CHANNELS.REMOTE_MKDIR, req),
    rename: (req) => invoke(CHANNELS.REMOTE_RENAME, req),
    delete: (req) => invoke(CHANNELS.REMOTE_DELETE, req),
    download: (req) => invoke(CHANNELS.REMOTE_DOWNLOAD, req),
    upload: (req) => invoke(CHANNELS.REMOTE_UPLOAD, req),
    onHostKey: (cb) => subscribe(CHANNELS.REMOTE_HOST_KEY, cb),
    onSessionError: (cb) => subscribe(CHANNELS.REMOTE_SESSION_ERROR, cb)
  },

  dialog: {
    confirmPermanentDelete: (req) => invoke(CHANNELS.DIALOG_CONFIRM_PERMANENT_DELETE, req),
    pickDirectory: (req) => invoke(CHANNELS.DIALOG_PICK_DIRECTORY, req)
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
    read: (req) => invoke(CHANNELS.PREVIEW_READ, req),
    thumbnail: (req) => invoke(CHANNELS.PREVIEW_THUMBNAIL, req)
  },

  analyze: {
    scanStart: (req) => invoke(CHANNELS.ANALYZE_SCAN_START, req),
    scanCancel: (req) => invoke(CHANNELS.ANALYZE_SCAN_CANCEL, req),
    onScanProgress: (cb) => subscribe(CHANNELS.ANALYZE_SCAN_PROGRESS, cb),
    onScanDone: (cb) => subscribe(CHANNELS.ANALYZE_SCAN_DONE, cb),
    onScanError: (cb) => subscribe(CHANNELS.ANALYZE_SCAN_ERROR, cb)
  },

  trash: {
    list: () => invoke(CHANNELS.TRASH_LIST),
    restore: (req) => invoke(CHANNELS.TRASH_RESTORE, req),
    empty: (req) => invoke(CHANNELS.TRASH_EMPTY, req)
  },

  hash: {
    compareStart: (req) => invoke(CHANNELS.HASH_COMPARE_START, req),
    dupStart: (req) => invoke(CHANNELS.HASH_DUP_START, req),
    verifyStart: (req) => invoke(CHANNELS.HASH_VERIFY_START, req),
    cancel: (req) => invoke(CHANNELS.HASH_CANCEL, req),
    onCompareProgress: (cb) => subscribe(CHANNELS.HASH_COMPARE_PROGRESS, cb),
    onCompareDone: (cb) => subscribe(CHANNELS.HASH_COMPARE_DONE, cb),
    onDupProgress: (cb) => subscribe(CHANNELS.HASH_DUP_PROGRESS, cb),
    onDupDone: (cb) => subscribe(CHANNELS.HASH_DUP_DONE, cb),
    onVerifyProgress: (cb) => subscribe(CHANNELS.HASH_VERIFY_PROGRESS, cb),
    onVerifyDone: (cb) => subscribe(CHANNELS.HASH_VERIFY_DONE, cb),
    onError: (cb) => subscribe(CHANNELS.HASH_ERROR, cb)
  },

  queue: {
    list: () => invoke(CHANNELS.QUEUE_LIST),
    pause: (req) => invoke(CHANNELS.QUEUE_PAUSE, req),
    resume: (req) => invoke(CHANNELS.QUEUE_RESUME, req),
    retry: (req) => invoke(CHANNELS.QUEUE_RETRY, req),
    setConcurrency: (req) => invoke(CHANNELS.QUEUE_SET_CONCURRENCY, req),
    onState: (cb) => subscribe(CHANNELS.QUEUE_STATE, cb)
  }
}

// 미사용 import 경고 방지를 위한 명시적 재노출(타입 전용).
export type { OpSummary }
