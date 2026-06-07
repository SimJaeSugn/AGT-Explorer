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
  DirListResult,
  DriveDTO,
  FileEntryDTO,
  ListStreamChunk,
  ListStreamDone,
  ListStreamStart,
  PathValidation,
  PreviewData,
  SessionSnapshot,
  SettingsSnapshot,
  WorkspaceInfo
} from '@shared/dto'
import type {
  ClipboardReadRes,
  DialogConfirmRes,
  FileOpError,
  FsCreateFileReq,
  FsListReq,
  FsListStartReq,
  FsMkdirReq,
  FsRenameReq,
  FsStatReq,
  FsTreeChildrenReq,
  FsValidatePathReq,
  OpConflictEvt,
  OpDoneEvt,
  OpProgressEvt,
  OpResolveReq,
  OpStartReq,
  OpStartRes,
  AnalyzeScanStartReq,
  AnalyzeScanStartRes,
  ScanProgressEvt,
  ScanDoneEvt,
  ScanErrorEvt,
  Result,
  ShellIconReq,
  ShellIconRes,
  TelemetryGetOptInRes
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
  rename: (req: FsRenameReq): Promise<Result<FileEntryDTO>> => bridge().fs.rename(req)
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
  openTerminal: (cwd: string): Promise<Result<void>> => bridge().shell.openTerminal({ cwd })
}

// ── op:* 어댑터 (P4: 파일 작업 시작/취소/충돌해소) ──────────────────────
export const opApi = {
  start: (req: OpStartReq): Promise<Result<OpStartRes>> => bridge().op.start(req),
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

// ── clipboard:* 어댑터 (P4: OS 클립보드 파일 연동) ──────────────────────
export const clipboardApi = {
  copyFiles: (paths: string[]): Promise<Result<void>> => bridge().clipboard.copyFiles({ paths }),
  cutFiles: (paths: string[]): Promise<Result<void>> => bridge().clipboard.cutFiles({ paths }),
  // BUG-001: paste-target 응답은 OpStartRes(operationId). 렌더러가 이 id 로
  // registerOperation 하여 진행률/충돌/완료를 op:start 와 동일하게 추적한다.
  pasteTarget: (destDir: string): Promise<Result<OpStartRes>> =>
    bridge().clipboard.pasteTarget({ destDir }),
  read: (): Promise<Result<ClipboardReadRes>> => bridge().clipboard.read()
}

// ── dialog:* 어댑터 (P4: 영구삭제 확인 모달) ────────────────────────────
export const dialogApi = {
  confirmPermanentDelete: (paths: string[]): Promise<Result<DialogConfirmRes>> =>
    bridge().dialog.confirmPermanentDelete({ paths })
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
  read: (path: string): Promise<Result<PreviewData>> => bridge().preview.read({ path })
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

/** 직접 API 접근이 필요한 경우의 escape hatch(테스트·고급 사용). */
export { bridge as explorerApi }
