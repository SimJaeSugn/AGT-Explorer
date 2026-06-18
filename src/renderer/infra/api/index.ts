/**
 * infra/api — Renderer 의 IPC 어댑터 (SA §3.1, directory-structure §2).
 *
 * Renderer 는 FS/OS 에 `window.api`(preload contextBridge) 로만 접근한다.
 * 이 모듈이 그 유일한 경계다. app(유스케이스/스토어)는 여기를 통해서만 호출하고,
 * ui 는 app 을 경유한다(.eslintrc: ui→infra 직접 import 금지).
 *
 * P1: fs 읽기 메서드 + fs:list 스트림 이벤트→콜백 브리지를 제공한다.
 */
import type { ExplorerApi, Unsubscribe } from '../../../preload/api'
import type {
  ConflictPolicy,
  DirListResult,
  DriveDTO,
  FileEntryDTO,
  KnownFoldersDTO,
  ListStreamChunk,
  ListStreamDone,
  ListStreamStart,
  PathValidation,
  PreviewData,
  RemoteProfileDTO,
  SessionSnapshot,
  SettingsSnapshot,
  TabSnapshot,
  TrashItemDTO,
  WorkspaceInfo
} from '@shared/dto'
import type {
  AppOpenPathEvt,
  ClipboardFilesReadRes,
  ClipboardHasFilesRes,
  ClipboardReadRes,
  DialogConfirmRes,
  DialogPickDirectoryRes,
  FsLinkFinalizeReq,
  FileOpError,
  RemoteConnectReq,
  RemoteConnectRes,
  RemoteCredSaveReq,
  RemoteDownloadReq,
  RemoteError,
  RemoteHostKeyEvt,
  RemoteListRes,
  RemoteProfileUpsertReq,
  RemoteSecret,
  RemoteSessionErrorEvt,
  RemoteTransferRes,
  RemoteUploadReq,
  DndStartDragReq,
  DndStartDragRes,
  FsCreateFileReq,
  FsListReq,
  FsListStartReq,
  FsMkdirReq,
  FsRenameReq,
  FsStatReq,
  FsTreeChildrenReq,
  FsValidatePathReq,
  FsWatchStartReq,
  FsWatchStartRes,
  FsWatchEvt,
  FsWatchErrorEvt,
  OpConflictEvt,
  OpDoneEvt,
  OpProgressEvt,
  OpResolveReq,
  OpRobocopyStartReq,
  OpStartReq,
  OpStartRes,
  AnalyzeScanStartReq,
  AnalyzeScanStartRes,
  ScanProgressEvt,
  ScanDoneEvt,
  ScanErrorEvt,
  HashCompareStartReq,
  HashDupStartReq,
  HashVerifyStartReq,
  HashJobStartRes,
  HashProgressEvt,
  HashCompareDoneEvt,
  HashDupDoneEvt,
  HashVerifyDoneEvt,
  HashErrorEvt,
  QueueListRes,
  QueueStateEvt,
  SearchContentStartReq,
  SearchContentStartRes,
  SearchContentProgressEvt,
  SearchContentMatchEvt,
  SearchContentDoneEvt,
  ArchiveOpenRes,
  ArchiveListRes,
  ArchiveTransferRes,
  WindowInitRes,
  WindowMode,
  Result,
  ShellContextVerbsRes,
  ShellIconReq,
  ShellIconRes,
  ShellNewCreateRes,
  ShellNewListRes,
  ThumbnailRes,
  TelemetryGetOptInRes,
  AgentRunReq,
  AgentRunRes,
  AgentConfirmReq,
  AgentConfirmRes,
  AgentProviderGetRes,
  AgentProviderModelsRes,
  AgentProviderProbeRes,
  AgentKeyHasRes,
  AgentEvent,
  ProviderConfig,
  ProviderId
} from '@shared/ipc/contracts'

/** contextBridge 로 노출된 API. (테스트/모킹 시 교체 가능하도록 게터 경유) */
function bridge(): ExplorerApi {
  const api = (globalThis as unknown as { api?: ExplorerApi }).api
  if (!api) {
    throw new Error('[infra/api] window.api 가 없습니다 — preload 미로딩(테스트는 모킹 필요).')
  }
  return api
}

// ── fs 읽기 어댑터 ──────────────────────────────────────────────────────
export const fsApi = {
  list: (req: FsListReq): Promise<Result<DirListResult>> => bridge().fs.list(req),
  stat: (req: FsStatReq): Promise<Result<FileEntryDTO>> => bridge().fs.stat(req),
  drives: (): Promise<Result<DriveDTO[]>> => bridge().fs.drives(),
  knownFolders: (): Promise<Result<KnownFoldersDTO>> => bridge().fs.knownFolders(),
  treeChildren: (req: FsTreeChildrenReq): Promise<Result<FileEntryDTO[]>> =>
    bridge().fs.treeChildren(req),
  validatePath: (req: FsValidatePathReq): Promise<Result<PathValidation>> =>
    bridge().fs.validatePath(req),
  listStart: (req: FsListStartReq): Promise<Result<ListStreamStart>> =>
    bridge().fs.listStart(req),
  listCancel: (streamId: string): Promise<Result<void>> =>
    bridge().fs.listCancel({ streamId }),

  // ── 단발 기본조작 (P4 활성화) ──────────────────────────────────────
  mkdir: (req: FsMkdirReq): Promise<Result<FileEntryDTO>> => bridge().fs.mkdir(req),
  createFile: (req: FsCreateFileReq): Promise<Result<FileEntryDTO>> =>
    bridge().fs.createFile(req),
  rename: (req: FsRenameReq): Promise<Result<FileEntryDTO>> => bridge().fs.rename(req),
  /** fs:link-finalize — 자동링크 마무리(원본 rename + 원본자리 정션, V10). */
  linkFinalize: (req: FsLinkFinalizeReq): Promise<Result<void>> => bridge().fs.linkFinalize(req),

  // ── fs:watch:* 디렉토리 실시간 감시 (J2 — 핸들러 impl: J장 다음 단계) ──────
  /** fs:watch:start — 현재 디렉토리 1개 non-recursive 감시 시작(watchId 발급). */
  watchStart: (req: FsWatchStartReq): Promise<Result<FsWatchStartRes>> =>
    bridge().fs.watchStart(req),
  /** fs:watch:stop — 경로 이동·언마운트 시 감시 중지. */
  watchStop: (watchId: string): Promise<Result<void>> => bridge().fs.watchStop({ watchId })
}

/**
 * fs:list 스트림 구독 묶음. 특정 streamId 의 chunk/done/error 만 콜백으로 라우팅한다.
 * 반환된 dispose 를 호출하면 세 구독을 모두 해제한다(누수 방지, ADR-003 라이프사이클).
 */
export interface ListStreamHandlers {
  onChunk: (entries: FileEntryDTO[]) => void
  onDone: (total: number, truncated: boolean) => void
  onError: (error: FileOpError) => void
}

export function subscribeListStream(streamId: string, h: ListStreamHandlers): Unsubscribe {
  const api = bridge()
  const offChunk = api.fs.onListChunk((evt: ListStreamChunk) => {
    if (evt.streamId === streamId) h.onChunk(evt.entries)
  })
  const offDone = api.fs.onListDone((evt: ListStreamDone) => {
    if (evt.streamId === streamId) h.onDone(evt.total, evt.truncated)
  })
  const offError = api.fs.onListError((evt: { streamId: string; error: FileOpError }) => {
    if (evt.streamId === streamId) h.onError(evt.error)
  })
  return () => {
    offChunk()
    offDone()
    offError()
  }
}

// ── shell 어댑터 (P2: open, P4: showProperties, P6: openWith) ────────────
export const shellApi = {
  /** shell:open — OS 연결 프로그램으로 실행(폴더는 진입 로직이 별도 처리). */
  open: (path: string): Promise<Result<void>> => bridge().shell.open({ path }),
  /** shell:open-with — OS "연결 프로그램으로 열기" 대화상자 호출(컨텍스트 메뉴 "연결 프로그램으로 열기"). */
  openWith: (path: string): Promise<Result<void>> => bridge().shell.openWith({ path }),
  /** shell:show-properties — OS 속성창 호출(컨텍스트 메뉴 "속성"). */
  showProperties: (path: string): Promise<Result<void>> =>
    bridge().shell.showProperties({ path }),
  /** shell:icon — OS 파일 아이콘 dataUrl 조회(확장자/폴더/드라이브 캐시, H6). */
  icon: (req: ShellIconReq): Promise<Result<ShellIconRes>> => bridge().shell.icon(req),
  /** shell:open-terminal — 해당 경로에서 터미널 실행(wt.exe→PowerShell, H4). */
  openTerminal: (cwd: string): Promise<Result<void>> => bridge().shell.openTerminal({ cwd }),
  /** shell:open-external — 검증된 http/https URL 을 OS 기본 브라우저로 연다(V1). */
  openExternal: (url: string): Promise<Result<void>> => bridge().shell.openExternal({ url }),
  /**
   * shell:context-verbs — 로컬 항목(들)의 셸 컨텍스트 verb 조회(§Y1). 1개=단일·2개+=다중
   * 선택(선택 전체를 하나로 처리). 빈 verbs 는 "Windows 메뉴" 섹션 비노출을 의미한다
   * (빈목록·실패·타임아웃 포괄 — empty).
   */
  contextVerbs: (paths: string[]): Promise<Result<ShellContextVerbsRes>> =>
    bridge().shell.contextVerbs({ paths }),
  /** shell:invoke-verb — 셸 verb 실행(fire-and-forget·DoIt/InvokeCommand). 실패만 err(EVERB/ENOENT/EUNKNOWN, §Y1). */
  invokeVerb: (paths: string[], verbId: string): Promise<Result<void>> =>
    bridge().shell.invokeVerb({ paths, verbId }),
  /** shell:new:list — "새로 만들기" ShellNew 형식 목록 조회(레지스트리, §Y2). 빈 배열=없음·실패·비-Windows. */
  newList: (): Promise<Result<ShellNewListRes>> => bridge().shell.newList({}),
  /** shell:new:create — ShellNew 형식 파일 생성(§Y2). 성공 시 최종 파일명 반환. */
  newCreate: (dir: string, id: string, label: string): Promise<Result<ShellNewCreateRes>> =>
    bridge().shell.newCreate({ dir, id, label })
}

// ── op:* 어댑터 (P4: 파일 작업 시작/취소/충돌해소) ──────────────────────
export const opApi = {
  start: (req: OpStartReq): Promise<Result<OpStartRes>> => bridge().op.start(req),
  /** op:robocopy:start — 폴더 비교 고속 미러(robocopy 복사 전용, V3). */
  robocopyStart: (req: OpRobocopyStartReq): Promise<Result<OpStartRes>> =>
    bridge().op.robocopyStart(req),
  resolve: (req: OpResolveReq): Promise<Result<void>> => bridge().op.resolve(req),
  cancel: (operationId: string): Promise<Result<void>> => bridge().op.cancel({ operationId })
}

/**
 * op:* 진행률/충돌/완료 이벤트 구독 묶음(operationId 상관 라우팅).
 * subscribeListStream 의 op 버전 — operationsSlice 가 이벤트→액션을 브리지하기 위해
 * App 부팅 시 1회 전역 구독하고, 콜백에서 operationId 로 분기한다.
 *
 * 반환된 dispose 로 세 구독을 모두 해제한다(누수 방지).
 */
export interface OpStreamHandlers {
  onProgress: (evt: OpProgressEvt) => void
  onConflict: (evt: OpConflictEvt) => void
  onDone: (evt: OpDoneEvt) => void
}

export function subscribeOpStream(h: OpStreamHandlers): Unsubscribe {
  const api = bridge()
  const offProgress = api.op.onProgress((evt) => h.onProgress(evt))
  const offConflict = api.op.onConflict((evt) => h.onConflict(evt))
  const offDone = api.op.onDone((evt) => h.onDone(evt))
  return () => {
    offProgress()
    offConflict()
    offDone()
  }
}

// ── analyze:scan:* 어댑터 (I장: 디렉토리 사용량 Top10 스캔) ──────────────
// 핸들러/Worker impl 은 I장 다음 단계. 여기서는 invoke 래퍼 + raw 이벤트 구독만 노출한다.
export const analyzeApi = {
  /** analyze:scan:start — 루트 폴더/드라이브 스캔 시작(scanId 발급). */
  scanStart: (req: AnalyzeScanStartReq): Promise<Result<AnalyzeScanStartRes>> =>
    bridge().analyze.scanStart(req),
  /** analyze:scan:cancel — 진행 중 스캔 협조취소(SharedArrayBuffer 플래그). */
  scanCancel: (scanId: string): Promise<Result<void>> => bridge().analyze.scanCancel({ scanId })
}

/**
 * analyze:scan:* 진행률/완료/오류 이벤트 구독 묶음.
 * subscribeOpStream 의 scan 버전 — raw 이벤트를 그대로 콜백에 전달하며,
 * scanId 상관(필터)은 소비측(analyzeSlice/usecase)에서 수행한다.
 *
 * 반환된 dispose 로 세 구독을 모두 해제한다(누수 방지).
 */
export interface ScanStreamHandlers {
  onProgress: (evt: ScanProgressEvt) => void
  onDone: (evt: ScanDoneEvt) => void
  onError: (evt: ScanErrorEvt) => void
}

export function subscribeScanStream(h: ScanStreamHandlers): Unsubscribe {
  const api = bridge()
  const offProgress = api.analyze.onScanProgress((evt) => h.onProgress(evt))
  const offDone = api.analyze.onScanDone((evt) => h.onDone(evt))
  const offError = api.analyze.onScanError((evt) => h.onError(evt))
  return () => {
    offProgress()
    offDone()
    offError()
  }
}

// ── fs:watch:* 어댑터 (J2: 패널 현재 디렉토리 실시간 감시) ────────────────
// 핸들러/WatchService impl 은 J장 다음 단계. 여기서는 raw 이벤트 구독만 노출하고,
// watchId 상관(필터)·panelId 매핑은 소비측(watchBridge)에서 수행한다(subscribeScanStream 동형).
export interface WatchStreamHandlers {
  onEvent: (evt: FsWatchEvt) => void
  onError: (evt: FsWatchErrorEvt) => void
}

export function subscribeWatchStream(h: WatchStreamHandlers): Unsubscribe {
  const api = bridge()
  const offEvent = api.fs.onWatchEvent((evt) => h.onEvent(evt))
  const offError = api.fs.onWatchError((evt) => h.onError(evt))
  return () => {
    offEvent()
    offError()
  }
}

// ── app:* 어댑터 (V2: 탐색기 "AGT-Finder로 열기" 경로 푸시 구독) ──────────
/** Main 이 argv/second-instance 로 받은 경로를 푸시하면 콜백. 반환값으로 구독 해제. */
export function subscribeOpenPath(cb: (evt: AppOpenPathEvt) => void): Unsubscribe {
  return bridge().app.onOpenPath(cb)
}

// ── window:* 어댑터 (U3: 멀티 윈도우 — 탭 분리(새 창), US-20.3) ──────────
export const windowApi = {
  /**
   * window:split-tab — 탭 1개(TabSnapshot)를 새 창으로 분리한다.
   * mode='compact' 면 탐색기 전용 경량 창(툴바·좌우 패널·사이드바 없음).
   */
  splitTab: (tab: TabSnapshot, mode?: WindowMode): Promise<Result<void>> =>
    bridge().window.splitTab(mode ? { tab, mode } : { tab }),
  /** window:get-init — 부팅 시 이 창의 초기 상태({primary, initialTab, mode})를 끌어온다. */
  getInit: (): Promise<Result<WindowInitRes>> => bridge().window.getInit()
}

// ── trash:* 어댑터 (K장 K2: 휴지통 관리 — 핸들러/recycleBin impl: K장 다음 단계) ──
// analyzeApi 동형. confirmed=true 는 empty() 래퍼에서 고정 주입(확인 모달 통과 표식).
export const trashApi = {
  /** trash:list — 휴지통 항목 열거(이름·원래경로·삭제일·크기). */
  list: (): Promise<Result<TrashItemDTO[]>> => bridge().trash.list(),
  /** trash:restore — 선택 항목($R 토큰 id) 원위치 복원. */
  restore: (ids: string[]): Promise<Result<void>> => bridge().trash.restore({ ids }),
  /** trash:empty — 전체 비우기. Renderer 확인 모달 통과 후에만 confirmed=true 로 호출. */
  empty: (confirmed: boolean): Promise<Result<void>> => bridge().trash.empty({ confirmed })
}

// ── clipboard:* 어댑터 (P4: OS 클립보드 파일 연동 / §M M2: CF_HDROP 양방향) ──
export const clipboardApi = {
  copyFiles: (paths: string[]): Promise<Result<void>> => bridge().clipboard.copyFiles({ paths }),
  cutFiles: (paths: string[]): Promise<Result<void>> => bridge().clipboard.cutFiles({ paths }),
  // BUG-001: paste-target 응답은 OpStartRes(operationId). 렌더러가 이 id 로
  // registerOperation 하여 진행률/충돌/완료를 op:start 와 동일하게 추적한다.
  pasteTarget: (destDir: string): Promise<Result<OpStartRes>> =>
    bridge().clipboard.pasteTarget({ destDir }),
  read: (): Promise<Result<ClipboardReadRes>> => bridge().clipboard.read(),

  // ── §M M2: 시스템 클립보드(CF_HDROP) 양방향 — 타 앱 연계 ──────────────
  /** clipboard:write-files — 선택 파일을 CF_HDROP+Preferred DropEffect 로 시스템 클립보드에. */
  writeFiles: (paths: string[], effect: 'copy' | 'cut'): Promise<Result<void>> =>
    bridge().clipboard.writeFiles({ paths, effect }),
  /** clipboard:read-files — 시스템 클립보드의 파일 목록·DropEffect(copy/move/none) 읽기. */
  readFiles: (): Promise<Result<ClipboardFilesReadRes>> => bridge().clipboard.readFiles(),
  /** clipboard:has-files — 시스템 클립보드에 파일(CF_HDROP)이 있는지(붙여넣기 활성 판정). */
  hasFiles: (): Promise<Result<ClipboardHasFilesRes>> => bridge().clipboard.hasFiles()
}

// ── dnd:* 어댑터 (§M M1: 외부(OS/타 앱)로의 파일 드래그 시작) ───────────────
// paths 는 로컬 절대경로만(원격 항목은 호출 전 필터링·main 도 2중 방어).
export const dndApi = {
  /** dnd:start-drag — 검증된 로컬 절대경로 묶음으로 OS 드래그 시작 위임. */
  startDrag: (req: DndStartDragReq): Promise<Result<DndStartDragRes>> =>
    bridge().dnd.startDrag(req)
}

// ── remote:* 어댑터 (§M M3: FTP/SFTP 원격 연결·탐색·전송) ───────────────────
// 비밀(secret)은 credSave/connect 요청 본문으로만 전달되며 응답에는 수록되지 않는다(ADR-007 ③⑥).
export const remoteApi = {
  /** remote:cred:save — 자격증명(비밀) safeStorage 저장(사용자 "저장" 게이트). */
  credSave: (req: RemoteCredSaveReq): Promise<Result<void>> => bridge().remote.credSave(req),
  /** remote:cred:has — 프로필에 저장된 비밀 존재 여부. */
  credHas: (profileId: string): Promise<Result<ClipboardHasFilesRes>> =>
    bridge().remote.credHas({ profileId }),
  /** remote:cred:delete — 저장된 자격증명 삭제. */
  credDelete: (profileId: string): Promise<Result<void>> =>
    bridge().remote.credDelete({ profileId }),
  /** remote:profile:list — 저장된 원격 프로필 목록(비밀 제외 메타). */
  profileList: (): Promise<Result<RemoteProfileDTO[]>> => bridge().remote.profileList(),
  /** remote:profile:upsert — 프로필 저장/갱신(비밀 미포함). */
  profileUpsert: (req: RemoteProfileUpsertReq): Promise<Result<RemoteProfileDTO>> =>
    bridge().remote.profileUpsert(req),
  /** remote:profile:delete — 프로필 삭제(연동: 자격증명·known_hosts 정리는 main). */
  profileDelete: (profileId: string): Promise<Result<void>> =>
    bridge().remote.profileDelete({ profileId }),
  /** remote:connect — 연결 수립(미저장 1회용 secret·hostKeyDecision 회신 포함). */
  connect: (req: RemoteConnectReq): Promise<Result<RemoteConnectRes, RemoteError>> =>
    bridge().remote.connect(req),
  /** remote:disconnect — 세션 종료. */
  disconnect: (sessionId: string): Promise<Result<void>> =>
    bridge().remote.disconnect({ sessionId }),
  /** remote:list — 원격 디렉토리 목록(entries 는 FileEntryDTO 재사용). */
  list: (sessionId: string, path: string): Promise<Result<RemoteListRes, RemoteError>> =>
    bridge().remote.list({ sessionId, path }),
  /** remote:stat — 원격 단일 항목 메타. */
  stat: (sessionId: string, path: string): Promise<Result<FileEntryDTO, RemoteError>> =>
    bridge().remote.stat({ sessionId, path }),
  /** remote:mkdir — 원격 새 폴더. */
  mkdir: (sessionId: string, path: string, name: string): Promise<Result<void, RemoteError>> =>
    bridge().remote.mkdir({ sessionId, path, name }),
  /** remote:rename — 원격 이름변경. */
  rename: (sessionId: string, path: string, newName: string): Promise<Result<void, RemoteError>> =>
    bridge().remote.rename({ sessionId, path, newName }),
  /** remote:delete — 원격 삭제. */
  delete: (sessionId: string, path: string): Promise<Result<void, RemoteError>> =>
    bridge().remote.delete({ sessionId, path }),
  /** remote:download — 원격→로컬 다운로드(operationId 반환, 진행률은 op:* 재사용). */
  download: (req: RemoteDownloadReq): Promise<Result<RemoteTransferRes, RemoteError>> =>
    bridge().remote.download(req),
  /** remote:upload — 로컬→원격 업로드(operationId 반환, 진행률은 op:* 재사용). */
  upload: (req: RemoteUploadReq): Promise<Result<RemoteTransferRes, RemoteError>> =>
    bridge().remote.upload(req)
}

/**
 * remote:* 푸시 evt 구독 묶음(호스트키 확인 요청·세션 격리 오류).
 * App 부팅 시 1회 전역 구독하고, 콜백에서 connectId/sessionId 상관(remoteSlice 브리지).
 * 반환된 dispose 로 두 구독을 모두 해제한다(누수 방지).
 */
export interface RemoteEventHandlers {
  onHostKey: (evt: RemoteHostKeyEvt) => void
  onSessionError: (evt: RemoteSessionErrorEvt) => void
}

export function subscribeRemoteEvents(h: RemoteEventHandlers): Unsubscribe {
  const api = bridge()
  const offHostKey = api.remote.onHostKey((evt) => h.onHostKey(evt))
  const offSessionError = api.remote.onSessionError((evt) => h.onSessionError(evt))
  return () => {
    offHostKey()
    offSessionError()
  }
}

/** RemoteSecret 재노출(usecase 가 connect/credSave 요청 본문 타입으로 사용 — 영속 금지). */
export type { RemoteSecret }

// ── hash:* 어댑터 (M7 — ADR-009: 공용 해시·비교 엔진) ────────────────────
// analyzeApi 동형 — invoke 래퍼 + raw 이벤트 구독. jobId 상관(필터)은 소비측 usecase.
export const hashApi = {
  /** hash:compare:start — P1 폴더 비교 시작(jobId 발급, useHash/recursive 옵션). */
  compareStart: (req: HashCompareStartReq): Promise<Result<HashJobStartRes>> =>
    bridge().hash.compareStart(req),
  /** hash:dup:start — R2 중복 탐지 시작(크기→해시 2단계). */
  dupStart: (req: HashDupStartReq): Promise<Result<HashJobStartRes>> =>
    bridge().hash.dupStart(req),
  /** hash:verify:start — R4 체크섬 검증 시작(원본·사본 쌍). */
  verifyStart: (req: HashVerifyStartReq): Promise<Result<HashJobStartRes>> =>
    bridge().hash.verifyStart(req),
  /** hash:cancel — 진행 중 해시 잡 협조취소(SharedArrayBuffer 플래그). */
  cancel: (jobId: string): Promise<Result<void>> => bridge().hash.cancel({ jobId })
}

/**
 * hash:compare:* 진행률/완료 + 공용 hash:error 구독 묶음(jobId 상관은 소비측).
 * subscribeScanStream 동형 — raw 이벤트를 그대로 콜백에 전달한다.
 */
export interface HashCompareStreamHandlers {
  onProgress: (evt: HashProgressEvt) => void
  onDone: (evt: HashCompareDoneEvt) => void
  onError: (evt: HashErrorEvt) => void
}
export function subscribeHashCompareStream(h: HashCompareStreamHandlers): Unsubscribe {
  const api = bridge()
  const offP = api.hash.onCompareProgress((evt) => h.onProgress(evt))
  const offD = api.hash.onCompareDone((evt) => h.onDone(evt))
  const offE = api.hash.onError((evt) => h.onError(evt))
  return () => {
    offP()
    offD()
    offE()
  }
}

/** hash:dup:* 진행률/완료 + 공용 hash:error 구독 묶음. */
export interface HashDupStreamHandlers {
  onProgress: (evt: HashProgressEvt) => void
  onDone: (evt: HashDupDoneEvt) => void
  onError: (evt: HashErrorEvt) => void
}
export function subscribeHashDupStream(h: HashDupStreamHandlers): Unsubscribe {
  const api = bridge()
  const offP = api.hash.onDupProgress((evt) => h.onProgress(evt))
  const offD = api.hash.onDupDone((evt) => h.onDone(evt))
  const offE = api.hash.onError((evt) => h.onError(evt))
  return () => {
    offP()
    offD()
    offE()
  }
}

/** hash:verify:* 진행률/완료 + 공용 hash:error 구독 묶음. */
export interface HashVerifyStreamHandlers {
  onProgress: (evt: HashProgressEvt) => void
  onDone: (evt: HashVerifyDoneEvt) => void
  onError: (evt: HashErrorEvt) => void
}
export function subscribeHashVerifyStream(h: HashVerifyStreamHandlers): Unsubscribe {
  const api = bridge()
  const offP = api.hash.onVerifyProgress((evt) => h.onProgress(evt))
  const offD = api.hash.onVerifyDone((evt) => h.onDone(evt))
  const offE = api.hash.onError((evt) => h.onError(evt))
  return () => {
    offP()
    offD()
    offE()
  }
}

// ── queue:* 어댑터 (M7 — ADR-011: 전송 큐, 큐 핸들러 impl: W2) ────────────
// W0 에서 어댑터 표면만 동결한다(usecases/queue·queueBridge 는 R3 단계에서 사용).
export const queueApi = {
  /** queue:list — 현재 큐 항목 스냅샷. */
  list: (): Promise<Result<QueueListRes>> => bridge().queue.list(),
  /** queue:pause — 큐 항목 일시정지(operationId). */
  pause: (operationId: string): Promise<Result<void>> => bridge().queue.pause({ operationId }),
  /** queue:resume — 큐 항목 재개. */
  resume: (operationId: string): Promise<Result<void>> => bridge().queue.resume({ operationId }),
  /** queue:retry — 실패 항목 재시도. */
  retry: (operationId: string): Promise<Result<void>> => bridge().queue.retry({ operationId }),
  /** queue:set-concurrency — 동시성 한도 설정. */
  setConcurrency: (maxConcurrent: number): Promise<Result<void>> =>
    bridge().queue.setConcurrency({ maxConcurrent })
}

/**
 * queue:state 구독(디바운스 큐 스냅샷). App 부팅 시 1회 전역 구독(queueBridge — R3).
 */
export function subscribeQueueStream(cb: (evt: QueueStateEvt) => void): Unsubscribe {
  return bridge().queue.onState(cb)
}

// ── search:content:* 어댑터 (M8 — ADR-010: 내용 검색 grep) ───────────────
// hashApi/analyzeApi 동형 — invoke 래퍼 + raw 이벤트 구독. jobId 상관(필터)은 소비측 usecase.
export const searchApi = {
  /** search:content:start — 현재 폴더(+하위 토글) 내용 grep 시작(jobId 발급). */
  contentStart: (req: SearchContentStartReq): Promise<Result<SearchContentStartRes>> =>
    bridge().search.contentStart(req),
  /** search:content:cancel — 진행 중 grep 잡 협조취소(jobId 멱등). */
  contentCancel: (jobId: string): Promise<Result<void>> =>
    bridge().search.contentCancel({ jobId })
}

/**
 * search:content:* 진행률/증분 결과/완료 구독 묶음(jobId 상관은 소비측).
 * subscribeScanStream 동형 — raw 이벤트를 그대로 콜백에 전달한다.
 * 반환된 dispose 로 세 구독을 모두 해제한다(누수 방지).
 */
export interface ContentSearchStreamHandlers {
  onProgress: (evt: SearchContentProgressEvt) => void
  onMatch: (evt: SearchContentMatchEvt) => void
  onDone: (evt: SearchContentDoneEvt) => void
}
export function subscribeContentSearchStream(h: ContentSearchStreamHandlers): Unsubscribe {
  const api = bridge()
  const offP = api.search.onContentProgress((evt) => h.onProgress(evt))
  const offM = api.search.onContentMatch((evt) => h.onMatch(evt))
  const offD = api.search.onContentDone((evt) => h.onDone(evt))
  return () => {
    offP()
    offM()
    offD()
  }
}

// ── archive:* 어댑터 (M9 — ADR-008: 압축파일 archive:// 어댑터) ───────────
// remoteApi 동형 — invoke 래퍼. 신규 진행률 채널 없음(extract/add 는 operationId 만
// 반환하고 진행률/충돌/완료/취소는 기존 op:* 스트림 재사용). 모든 경로는 main 이 검증한다.
export const archiveApi = {
  /** archive:open — zip central directory 열기·세션 발급. 암호 zip 이면 EUNSUPPORTED. */
  open: (archivePath: string): Promise<Result<ArchiveOpenRes>> =>
    bridge().archive.open({ archivePath }),
  /** archive:list — innerPath 디렉토리의 직속 엔트리(정규화 FileEntryDTO). */
  list: (sessionId: string, innerPath: string): Promise<Result<ArchiveListRes>> =>
    bridge().archive.list({ sessionId, innerPath }),
  /** archive:close — 세션·임시물 정리(패널 이탈/탭 닫기). */
  close: (sessionId: string): Promise<Result<void>> => bridge().archive.close({ sessionId }),
  /** archive:extract — 압축→로컬 추출(operationId 반환, 진행률은 op:* 재사용·Zip Slip 차단). */
  extract: (
    sessionId: string,
    innerPaths: string[],
    destDir: string,
    conflictPolicy?: ConflictPolicy
  ): Promise<Result<ArchiveTransferRes>> =>
    bridge().archive.extract({
      sessionId,
      innerPaths,
      destDir,
      ...(conflictPolicy ? { conflictPolicy } : {})
    }),
  /** archive:add — 로컬→압축 추가(재작성·operationId 반환, 진행률은 op:* 재사용). */
  add: (
    sessionId: string,
    localPaths: string[],
    innerDir: string,
    conflictPolicy?: ConflictPolicy
  ): Promise<Result<ArchiveTransferRes>> =>
    bridge().archive.add({
      sessionId,
      localPaths,
      innerDir,
      ...(conflictPolicy ? { conflictPolicy } : {})
    })
}

// ── dialog:* 어댑터 (P4: 영구삭제 확인 모달) ────────────────────────────
export const dialogApi = {
  confirmPermanentDelete: (paths: string[]): Promise<Result<DialogConfirmRes>> =>
    bridge().dialog.confirmPermanentDelete({ paths }),
  /** dialog:pick-directory — 네이티브 폴더 선택(자동링크 목표 디렉토리, V10). */
  pickDirectory: (defaultPath?: string): Promise<Result<DialogPickDirectoryRes>> =>
    bridge().dialog.pickDirectory(defaultPath ? { defaultPath } : {})
}

// ── session:* / settings:* / telemetry 어댑터 (P5) ──────────────────────
export const sessionApi = {
  /** session:load — 저장된 세션(없으면 폴백 스냅샷). */
  load: (): Promise<Result<SessionSnapshot>> => bridge().session.load(),
  /** session:save — 디바운스 저장(Main 측 디바운스+원자적 쓰기). */
  save: (snapshot: SessionSnapshot): Promise<Result<void>> => bridge().session.save({ snapshot })
}

export const settingsApi = {
  /** settings:get — 현재 설정 스냅샷. */
  get: (): Promise<Result<SettingsSnapshot>> => bridge().settings.get(),
  /** settings:set — 부분 패치 영속 후 갱신본 반환. */
  set: (patch: Partial<SettingsSnapshot>): Promise<Result<SettingsSnapshot>> =>
    bridge().settings.set({ patch })
}

export const telemetryApi = {
  /** telemetry:set-opt-in — 옵트인 플래그 영속(기본 false). */
  setOptIn: (enabled: boolean): Promise<Result<void>> => bridge().telemetry.setOptIn({ enabled }),
  /** telemetry:get-opt-in — 부팅 재수화용 옵트인 실제 값 조회(P6, [중대-3]). */
  getOptIn: (): Promise<Result<TelemetryGetOptInRes>> => bridge().telemetry.getOptIn()
}

// ── preview:* 어댑터 (P6: 미리보기 데이터 읽기) ──────────────────────────
export const previewApi = {
  /** preview:read — 단일 경로의 미리보기 데이터(이미지/텍스트/메타/미지원). */
  read: (path: string): Promise<Result<PreviewData>> => bridge().preview.read({ path }),
  /** preview:thumbnail — 그리드 이미지 썸네일 dataUrl(미지원/실패 시 dataUrl=null → OS 아이콘 폴백, L1). */
  thumbnail: (path: string, size: number, mtime?: number): Promise<Result<ThumbnailRes>> =>
    bridge().preview.thumbnail(mtime === undefined ? { path, size } : { path, size, mtime })
}

// ── workspace:* 어댑터 (P6c: 명시적 워크스페이스 저장/복원) ───────────────
export const workspaceApi = {
  /** workspace:save — 이름 붙여 현재 세션 스냅샷 저장. */
  save: (name: string, snapshot: SessionSnapshot): Promise<Result<void>> =>
    bridge().workspace.save({ name, snapshot }),
  /** workspace:list — 저장된 워크스페이스 목록(name·savedAt). */
  list: (): Promise<Result<WorkspaceInfo[]>> => bridge().workspace.list(),
  /** workspace:load — 이름으로 세션 스냅샷 로드. */
  load: (name: string): Promise<Result<SessionSnapshot>> => bridge().workspace.load({ name }),
  /** workspace:delete — 이름으로 삭제. */
  delete: (name: string): Promise<Result<void>> => bridge().workspace.delete({ name })
}

// ── agent:* 어댑터 (§Z — ADR-014·ADR-015: 자연어 파일 에이전트) ────────────
// preload.agent 동형. 비밀(apiKey)은 keySet 요청 인자로만 흐르고 응답/이벤트엔 미수록.
// jobId 대신 runId 로 agent:event 스트림을 상관(소비측 AgentPanel usecase).
export const agentApi = {
  /** agent:run — 읽기 루프 시작(runId 발급, 진행은 subscribeAgentEvents 스트림). */
  run: (req: AgentRunReq): Promise<Result<AgentRunRes>> => bridge().agent.run(req),
  /** agent:cancel — 진행 중 run 협조취소(runId 멱등). */
  cancel: (runId: string): Promise<Result<void>> => bridge().agent.cancel({ runId }),
  /** agent:confirm — 쓰기 ops 확정(Z3 — 현재 EUNSUPPORTED). */
  confirm: (req: AgentConfirmReq): Promise<Result<AgentConfirmRes>> => bridge().agent.confirm(req),
  /** agent:provider:set — 활성 제공자 설정(비-비밀·internal baseUrl SSRF 등록). */
  providerSet: (config: ProviderConfig): Promise<Result<void>> => bridge().agent.providerSet({ config }),
  /**
   * agent:provider:set(hostOp) — 내부 SSRF 화이트리스트에 호스트 추가(validateRegister 통과 시).
   * 신규 채널 0 — providerSet 채널 재사용. 목록 조회는 providerGet().allowedInternalHosts.
   */
  internalHostAdd: (url: string): Promise<Result<void>> =>
    bridge().agent.providerSet({ hostOp: { action: 'add', host: url } }),
  /** agent:provider:set(hostOp) — 내부 화이트리스트에서 호스트 삭제(URL/정규화 키 둘 다 수용). */
  internalHostRemove: (host: string): Promise<Result<void>> =>
    bridge().agent.providerSet({ hostOp: { action: 'remove', host } }),
  /** agent:provider:get — 활성 설정·키 보유 제공자·내부 화이트리스트(키 미포함). */
  providerGet: (): Promise<Result<AgentProviderGetRes>> => bridge().agent.providerGet(),
  /** agent:provider:list-models — 제공자별 모델 목록. */
  providerModels: (id: ProviderId): Promise<Result<AgentProviderModelsRes>> =>
    bridge().agent.providerModels({ id }),
  /** agent:provider:probe — 도구 호출 지원 여부. */
  providerProbe: (id: ProviderId): Promise<Result<AgentProviderProbeRes>> =>
    bridge().agent.providerProbe({ id }),
  /** agent:key:set — 제공자별 API 키 저장(safeStorage·평문 0·응답에 키 미수록). */
  keySet: (provider: ProviderId, apiKey: string): Promise<Result<void>> =>
    bridge().agent.keySet({ provider, apiKey }),
  /** agent:key:has — 제공자 키 보유 여부(값 미노출). */
  keyHas: (provider: ProviderId): Promise<Result<AgentKeyHasRes>> =>
    bridge().agent.keyHas({ provider })
}

/**
 * agent:event 구독(thinking/tool-call/plan-ready/error). runId 상관(필터)은 소비측에서.
 * type 별 핸들러로 분기 — 미지정 type 은 무시. 반환 dispose 로 해제(누수 방지).
 */
export interface AgentEventHandlers {
  onThinking?: (runId: string, text: string) => void
  onToolCall?: (evt: Extract<AgentEvent, { type: 'tool-call' }>) => void
  onAction?: (evt: Extract<AgentEvent, { type: 'action' }>) => void
  onPlanReady?: (evt: Extract<AgentEvent, { type: 'plan-ready' }>) => void
  onPlanAdd?: (evt: Extract<AgentEvent, { type: 'plan-add' }>) => void
  /** 추론 계획 수립/재계획(다단계 질의 — ADR-016). 단순 질의에선 미발생. */
  onPlan?: (evt: Extract<AgentEvent, { type: 'plan' }>) => void
  /** 추론 스텝 진행(start/done/failed — ADR-016). plan 과 함께 다단계 질의에서만. */
  onStep?: (evt: Extract<AgentEvent, { type: 'step' }>) => void
  /**
   * 장시간 도구(트리 워크) 진행 피드백(§Z 프리징 완화). 패널이 현재 도구 호출 라인을 라이브
   * 갱신할 표면("🔧 search_content: N개 검색 · M 일치 · 현재경로"). 스로틀된 누적 진행이며
   * 결과/제어와 무관(놓쳐도 안전). 다단계 질의면 stepId 부기.
   */
  onToolProgress?: (evt: Extract<AgentEvent, { type: 'tool-progress' }>) => void
  onError?: (evt: Extract<AgentEvent, { type: 'error' }>) => void
}
export function subscribeAgentEvents(h: AgentEventHandlers): Unsubscribe {
  return bridge().agent.onEvent((evt: AgentEvent) => {
    switch (evt.type) {
      case 'thinking':
        h.onThinking?.(evt.runId, evt.text)
        break
      case 'tool-call':
        h.onToolCall?.(evt)
        break
      case 'action':
        h.onAction?.(evt)
        break
      case 'plan-ready':
        h.onPlanReady?.(evt)
        break
      case 'plan-add':
        h.onPlanAdd?.(evt)
        break
      case 'plan':
        h.onPlan?.(evt)
        break
      case 'step':
        h.onStep?.(evt)
        break
      case 'tool-progress':
        h.onToolProgress?.(evt)
        break
      case 'error':
        h.onError?.(evt)
        break
    }
  })
}

/** 직접 API 접근이 필요한 경우의 escape hatch(테스트·고급 사용). */
export { bridge as explorerApi }
