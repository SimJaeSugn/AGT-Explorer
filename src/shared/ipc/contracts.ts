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
  ClipboardEffectKind,
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
  RemoteProfileDTO,
  ScanResult,
  SessionSnapshot,
  SettingsSnapshot,
  TrashItemDTO,
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

/**
 * 원격(§M M3) 오류 — **별도 타입이 아니라 FileOpError 그 자체**(ADR-007 결정⑥).
 * code 유니온만 RemoteErrorCode 로 확장되며(EAUTH·ETIMEDOUT·…) 직렬화 형태는 동일하다.
 * 비밀 필드 없음(FileOpError 구조 그대로 — 컴파일 타임 보장). remote:connect/list/…
 * 핸들러는 `Result<T, RemoteError>` 를 반환하나 `Result<T, FileOpError>` 와 호환된다.
 */
export type RemoteError = FileOpError

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
export interface ShellOpenTerminalReq {
  /** 터미널 작업 디렉토리(검증된 실존 폴더). */
  readonly cwd: string
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
/** preview:thumbnail (L1) — 그리드 이미지 썸네일 요청. size=긴 변 px(버킷 화이트리스트). */
export interface ThumbnailReq {
  readonly path: string
  readonly size: number
}
/** 썸네일 결과. dataUrl=null 이면 폴백(미지원/손상/대용량) → 렌더러가 OS 아이콘 표시. */
export interface ThumbnailRes {
  readonly dataUrl: string | null
}

// ── fs:watch:* (신규 J장 J2 — 디렉토리 실시간 감시, 계약만 동결) ───────
/** 패널이 현재 보고 있는 디렉토리 1개를 non-recursive 로 감시. */
export interface FsWatchStartReq {
  readonly path: string
}
export interface FsWatchStartRes {
  /** 이후 event/error 이벤트를 묶는 감시 ID(streamId 동형). */
  readonly watchId: string
}
export interface FsWatchStopReq {
  readonly watchId: string
}

// ── trash:* (신규 K장 K2 — 휴지통 관리, 계약만 동결) ───────────────────
/** trash:restore 요청 — 복원할 항목의 토큰 id 목록(TrashItemDTO.id = $R 실경로). */
export interface TrashRestoreReq {
  readonly ids: string[]
}
/**
 * trash:empty 요청 — 전체 비우기 확인 게이트.
 * Renderer 확인 모달을 통과했음을 나타내는 표식으로, `confirmed === true` 일 때만
 * 핸들러가 실제 비우기를 실행한다(미확인 호출은 거부).
 */
export interface TrashEmptyReq {
  readonly confirmed: boolean
}

// ── analyze:scan:* (신규 I장 — Top10 스캔, 계약만 동결) ────────────────
export interface AnalyzeScanStartReq {
  /** 스캔 대상 폴더 또는 드라이브 경로(루트). */
  readonly root: string
}
export interface AnalyzeScanStartRes {
  /** 이후 progress/done/error/cancel 이벤트를 묶는 스캔 ID. */
  readonly scanId: string
}
export interface AnalyzeScanCancelReq {
  readonly scanId: string
}

// ── dnd:* 외부 드래그 (신규 §M M1 — 계약만 동결, impl: MP3) ─────────────
/** 외부(앱 바깥)로의 파일 드래그 시작 요청. paths 는 로컬 절대경로(핸들러가 guardPath·존재·원격 prefix 검증). */
export interface DndStartDragReq {
  readonly paths: string[]
  /** 드래그 고스트 아이콘 힌트(단일 파일/다중/폴더). 미지정 시 backend 기본. */
  readonly iconHint?: 'single' | 'multi' | 'folder'
}
export interface DndStartDragRes {
  /** startDrag 위임 성공 여부(wc 파괴·빈 경로 등은 false). */
  readonly started: boolean
}

// ── clipboard:* CF_HDROP (신규 §M M2 — 기존 텍스트 폴백 채널과 병존, impl: MP2) ─
/** 시스템 클립보드에 파일 목록을 CF_HDROP+Preferred DropEffect 로 쓴다. */
export interface ClipboardWriteFilesReq {
  readonly paths: string[]
  readonly effect: 'copy' | 'cut'
}
/** clipboard:read-files 결과 — CF_HDROP 파싱 경로 + DropEffect 해석(copy/move/none). */
export interface ClipboardFilesReadRes {
  readonly paths: string[]
  readonly effect: ClipboardEffectKind
}
/** clipboard:has-files 결과 — 클립보드에 파일(CF_HDROP)이 있는지. */
export interface ClipboardHasFilesRes {
  readonly has: boolean
}

// ── remote:* FTP/SFTP (신규 §M M3 — 계약만 동결, impl: MP4) ─────────────
/**
 * 자격증명 비밀 본문 — **요청 본문 전용**(영속·응답 DTO 에는 절대 없음).
 * cred:save / connect 요청으로만 main 에 1회 전달되어 즉시 safeStorage 로 가며,
 * 응답·로그·Error 에는 포함되지 않는다(ADR-007 ③⑥). DTO 레이어(shared/dto)에는
 * 두지 않고 IPC 요청 계약에만 둔다(구조적 격리).
 */
export interface RemoteSecret {
  readonly kind: 'password' | 'passphrase' | 'privateKey'
  readonly value: string
}
export interface RemoteCredSaveReq {
  readonly profileId: string
  readonly secret: RemoteSecret
}
export interface RemoteCredHasReq {
  readonly profileId: string
}
export interface RemoteCredDeleteReq {
  readonly profileId: string
}
export interface RemoteProfileUpsertReq {
  readonly profile: RemoteProfileDTO
}
export interface RemoteProfileDeleteReq {
  readonly profileId: string
}
export interface RemoteConnectReq {
  readonly profile: RemoteProfileDTO
  /** 미저장 1회용 비밀(저장 안 함). 없으면 핸들러가 credentialStore.load(profileId). */
  readonly secret?: RemoteSecret
  /** TOFU 호스트키 회신(remote:host-key 푸시에 대한 사용자 결정). */
  readonly hostKeyDecision?: 'accept' | 'reject'
}
export interface RemoteConnectRes {
  readonly sessionId: string
  /** 암호화 연결 여부(평문 FTP=false → 비암호화 경고 신호). */
  readonly encrypted: boolean
}
export interface RemoteDisconnectReq {
  readonly sessionId: string
}
export interface RemoteListReq {
  readonly sessionId: string
  /** 원격 절대경로(POSIX). 정규화·traversal 방어는 어댑터가 POSIX 기준으로 수행(MP4). */
  readonly path: string
}
export interface RemoteStatReq {
  readonly sessionId: string
  readonly path: string
}
export interface RemoteMkdirReq {
  readonly sessionId: string
  readonly path: string
  readonly name: string
}
export interface RemoteRenameReq {
  readonly sessionId: string
  readonly path: string
  readonly newName: string
}
export interface RemoteDeleteReq {
  readonly sessionId: string
  readonly path: string
}
/** 원격 목록 결과 — entries 는 기존 FileEntryDTO 재사용(원격 절대경로·attrs.symlink). */
export interface RemoteListRes {
  readonly entries: FileEntryDTO[]
}
export interface RemoteDownloadReq {
  readonly sessionId: string
  readonly remotePaths: string[]
  /** 로컬 도착 디렉토리(핸들러가 guardPath 로 검증·Zip Slip 차단). */
  readonly destDir: string
  readonly conflictPolicy?: ConflictPolicy
}
export interface RemoteUploadReq {
  readonly sessionId: string
  /** 로컬 소스 경로(핸들러가 guardPath 로 검증). */
  readonly localPaths: string[]
  readonly remoteDir: string
  readonly conflictPolicy?: ConflictPolicy
}
/** download/upload 응답 — operationId 만 반환(진행률·충돌·완료·취소는 기존 op:* 스트림 재사용). */
export interface RemoteTransferRes {
  readonly operationId: string
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
  [CHANNELS.SHELL_OPEN_TERMINAL]: { req: ShellOpenTerminalReq; res: Result<void> }

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
  [CHANNELS.PREVIEW_THUMBNAIL]: { req: ThumbnailReq; res: Result<ThumbnailRes> }

  // analyze:scan:* (신규 I장 — 계약만 동결)
  [CHANNELS.ANALYZE_SCAN_START]: { req: AnalyzeScanStartReq; res: Result<AnalyzeScanStartRes> }
  [CHANNELS.ANALYZE_SCAN_CANCEL]: { req: AnalyzeScanCancelReq; res: Result<void> }

  // fs:watch:* (신규 J장 J2 — 계약만 동결, 핸들러 impl: 다음 단계)
  [CHANNELS.FS_WATCH_START]: { req: FsWatchStartReq; res: Result<FsWatchStartRes> }
  [CHANNELS.FS_WATCH_STOP]: { req: FsWatchStopReq; res: Result<void> }

  // trash:* (신규 K장 K2 — 계약만 동결, 핸들러/recycleBin impl: 다음 단계)
  [CHANNELS.TRASH_LIST]: { req: void; res: Result<TrashItemDTO[]> }
  [CHANNELS.TRASH_RESTORE]: { req: TrashRestoreReq; res: Result<void> }
  [CHANNELS.TRASH_EMPTY]: { req: TrashEmptyReq; res: Result<void> }

  // dnd:* (신규 §M M1 — 계약만 동결, impl: MP3)
  [CHANNELS.DND_START_DRAG]: { req: DndStartDragReq; res: Result<DndStartDragRes> }

  // clipboard:* CF_HDROP (신규 §M M2 — 기존 채널과 병존, impl: MP2)
  [CHANNELS.CLIPBOARD_WRITE_FILES]: { req: ClipboardWriteFilesReq; res: Result<void> }
  [CHANNELS.CLIPBOARD_READ_FILES]: { req: void; res: Result<ClipboardFilesReadRes> }
  [CHANNELS.CLIPBOARD_HAS_FILES]: { req: void; res: Result<ClipboardHasFilesRes> }

  // remote:* FTP/SFTP (신규 §M M3 — 계약만 동결, impl: MP4)
  // cred/profile/disconnect 는 FileOpError, 연결·탐색·전송은 RemoteError(직렬화 동일).
  [CHANNELS.REMOTE_CRED_SAVE]: { req: RemoteCredSaveReq; res: Result<void> }
  [CHANNELS.REMOTE_CRED_HAS]: { req: RemoteCredHasReq; res: Result<ClipboardHasFilesRes> }
  [CHANNELS.REMOTE_CRED_DELETE]: { req: RemoteCredDeleteReq; res: Result<void> }
  [CHANNELS.REMOTE_PROFILE_LIST]: { req: void; res: Result<RemoteProfileDTO[]> }
  [CHANNELS.REMOTE_PROFILE_UPSERT]: { req: RemoteProfileUpsertReq; res: Result<RemoteProfileDTO> }
  [CHANNELS.REMOTE_PROFILE_DELETE]: { req: RemoteProfileDeleteReq; res: Result<void> }
  [CHANNELS.REMOTE_CONNECT]: { req: RemoteConnectReq; res: Result<RemoteConnectRes, RemoteError> }
  [CHANNELS.REMOTE_DISCONNECT]: { req: RemoteDisconnectReq; res: Result<void> }
  [CHANNELS.REMOTE_LIST]: { req: RemoteListReq; res: Result<RemoteListRes, RemoteError> }
  [CHANNELS.REMOTE_STAT]: { req: RemoteStatReq; res: Result<FileEntryDTO, RemoteError> }
  [CHANNELS.REMOTE_MKDIR]: { req: RemoteMkdirReq; res: Result<void, RemoteError> }
  [CHANNELS.REMOTE_RENAME]: { req: RemoteRenameReq; res: Result<void, RemoteError> }
  [CHANNELS.REMOTE_DELETE]: { req: RemoteDeleteReq; res: Result<void, RemoteError> }
  [CHANNELS.REMOTE_DOWNLOAD]: { req: RemoteDownloadReq; res: Result<RemoteTransferRes, RemoteError> }
  [CHANNELS.REMOTE_UPLOAD]: { req: RemoteUploadReq; res: Result<RemoteTransferRes, RemoteError> }
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

// ── analyze:scan:* 진행률/완료/오류 이벤트 (신규 I장, 계약만 동결) ─────
/** 진행률(200ms 스로틀) — 누적 항목/바이트 + 현재 경로. */
export interface ScanProgressEvt {
  readonly scanId: string
  readonly scannedItems: number
  readonly scannedBytes: number
  readonly currentPath: string
}
export interface ScanDoneEvt {
  readonly scanId: string
  readonly result: ScanResult
}
export interface ScanErrorEvt {
  readonly scanId: string
  readonly error: FileOpError
}

// ── fs:watch:* 변경/오류 이벤트 (신규 J장 J2, 계약만 동결) ─────────────
/** 디바운스·병합된 변경 알림. 증분 항목 목록은 보내지 않고 "변경됨" 신호만 — 렌더러가 해당 패널 re-list. */
export interface FsWatchEvt {
  readonly watchId: string
  /** 감시 대상(현재) 경로(상관·검증용). 소비측은 watchId 상관으로 해당 패널 refresh. */
  readonly path: string
}
export interface FsWatchErrorEvt {
  readonly watchId: string
  /** EACCES/EPERM/ENOENT/ENOTSUP/EUNKNOWN — 감시 불가(격리, 수동 새로고침 유지). */
  readonly error: FileOpError
}

// ── remote:* 푸시 evt (신규 §M M3, 계약만 동결) ────────────────────────
/**
 * TOFU 호스트키 확인 요청(remote:host-key). main 이 연결 중 미신뢰/변경 호스트키를
 * 만나면 푸시하고, 렌더러는 사용자 결정을 다음 remote:connect 의 hostKeyDecision 으로
 * 회신한다. 지문(fingerprint)만 노출 — 비밀 없음.
 */
export interface RemoteHostKeyEvt {
  /** 진행 중 연결 상관 ID(connect 호출과 매칭). */
  readonly connectId: string
  readonly fingerprint: string
  readonly algo: string
  /** unknown=최초 접속(미등록), changed=known_hosts 와 불일치(경고 강화). */
  readonly status: 'unknown' | 'changed'
}
/** 세션 격리 오류(remote:session-error) — 한 세션의 끊김/타임아웃이 다른 패널·Main 을 중단시키지 않음. */
export interface RemoteSessionErrorEvt {
  readonly sessionId: string
  readonly error: RemoteError
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

  // analyze:scan:* 스트림 (신규 I장, 계약만 동결)
  [CHANNELS.ANALYZE_SCAN_PROGRESS]: ScanProgressEvt
  [CHANNELS.ANALYZE_SCAN_DONE]: ScanDoneEvt
  [CHANNELS.ANALYZE_SCAN_ERROR]: ScanErrorEvt

  // fs:watch:* 푸시 evt (신규 J장 J2, 계약만 동결)
  [CHANNELS.FS_WATCH_EVENT]: FsWatchEvt
  [CHANNELS.FS_WATCH_ERROR]: FsWatchErrorEvt

  // remote:* 푸시 evt (신규 §M M3, 계약만 동결)
  [CHANNELS.REMOTE_HOST_KEY]: RemoteHostKeyEvt
  [CHANNELS.REMOTE_SESSION_ERROR]: RemoteSessionErrorEvt
}

export type EventChannel = keyof IpcEventMap
export type PayloadOf<C extends EventChannel> = IpcEventMap[C]
