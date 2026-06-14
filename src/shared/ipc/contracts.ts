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
  CompareResultDTO,
  ConfirmedOpDTO,
  AgentLocations,
  ConflictPolicy,
  ConflictResolution,
  DirListResult,
  DriveDTO,
  DupGroupDTO,
  FileEntryDTO,
  FileOpErrorCode,
  ModelInfo,
  PlannedOp,
  ProviderConfig,
  ProviderId,
  GrepMatchDTO,
  HashAlgo,
  KnownFoldersDTO,
  ListStreamChunk,
  ListStreamDone,
  ListStreamStart,
  OpKind,
  OpSummary,
  PathValidation,
  PreviewData,
  QueueItemDTO,
  RemoteProfileDTO,
  ScanResult,
  SessionSnapshot,
  SettingsSnapshot,
  ShellVerbDTO,
  TabSnapshot,
  TrashItemDTO,
  VerifyMismatchDTO,
  WorkspaceInfo
} from '../dto'

// agent:* DTO 재노출(provider 모듈이 @shared/ipc/contracts 에서 import).
export type {
  AgentLocationItem,
  AgentLocations,
  AgentPanelLocation,
  ConfirmedOpDTO,
  ModelInfo,
  PlannedOp,
  PlannedOpKind,
  ProviderConfig,
  ProviderId
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
// ── fs:link-finalize (자동링크 마무리 — 원본 rename + 원본자리 정션, V10) ──────
export interface FsLinkFinalizeReq {
  /** 원본 디렉토리(정션으로 대체될 자리). */
  readonly sourceDir: string
  /** 원본을 보존할 백업 이름(원본 부모 폴더 안의 새 이름·경로 분리자 불가). */
  readonly backupName: string
  /** 정션이 가리킬 대상(이미 복사된 목적지 디렉토리, 절대경로). */
  readonly linkTarget: string
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
export interface ShellOpenExternalReq {
  /** 외부 브라우저로 열 URL. http/https 만 — 핸들러가 프로토콜을 재검증한다(ADR-005). */
  readonly url: string
}
// ── op:robocopy:start (폴더 비교 고속 미러 — robocopy 복사 전용, V3) ──────────
export interface OpRobocopyStartReq {
  /** 복사 원본 디렉토리(미러 방향의 기준 폴더). */
  readonly srcDir: string
  /** 복사 대상 디렉토리. robocopy 가 srcDir 내용을 dstDir 로 복사(/PURGE 없음 — 삭제 미수행). */
  readonly dstDir: string
  /** 진행률 분모용 예상 복사 항목 수(앱 비교 계획 기준, 선택). */
  readonly expectedItems?: number
}
export interface ShellIconReq {
  /** 경로 또는 확장자 중 하나(아이콘 캐시 키). */
  readonly path?: string
  readonly ext?: string
}
export interface ShellIconRes {
  readonly dataUrl: string
}

// ── §Y1: shell:context-verbs / shell:invoke-verb (상주 PowerShell·COM Verbs) ──
export interface ShellContextVerbsReq {
  /**
   * 우클릭 대상 항목들의 절대 로컬 경로. 1개=단일 선택(COM `Verbs()`), 2개 이상=다중 선택
   * (Shell `IContextMenu` 다중 PIDL — 선택 전체를 하나로 처리: 압축·보내기 등).
   * 핸들러가 각 경로 guardPath·존재·로컬 한정 검증한다.
   */
  readonly paths: string[]
}
export interface ShellContextVerbsRes {
  /** 블랙리스트 필터 후의 표시용 verb 목록(빈 배열=섹션 비노출=빈목록·실패·타임아웃 포괄). */
  readonly verbs: ShellVerbDTO[]
}
export interface ShellInvokeVerbReq {
  /** 조회와 동일한 대상 경로 집합(단일=1개·다중=2개 이상). */
  readonly paths: string[]
  /** `"<index>:<정규화표시명>"` 합성키(조회 응답의 verbId 그대로). */
  readonly verbId: string
}

// ── op:* (계약만 동결, impl: P4) ──────────────────────────────────────
export interface OpStartReq {
  readonly kind: OpKind
  readonly sources: string[]
  /** copy/move 대상 디렉토리. */
  readonly destDir?: string
  /** 사전 일괄 충돌 규칙(없으면 충돌 시 op:conflict 질의). */
  readonly conflictPolicy?: ConflictPolicy
  /**
   * 구조 보존 기준 디렉토리(copy 전용, 선택). 지정 시 각 source 를 destDir 의
   * relative(baseDir, source) 위치에 복사한다(하위 폴더 구조 보존 — 미러 재귀 복사). 미지정이면
   * destDir/basename(source) 로 복사(기존 동작). 예: baseDir=D:\left, src=D:\left\sub\x.txt → destDir\sub\x.txt.
   */
  readonly baseDir?: string
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
// ── dialog:pick-directory (네이티브 폴더 선택, V10) ────────────────────────
export interface DialogPickDirectoryReq {
  /** 초기 경로(선택). */
  readonly defaultPath?: string
}
export interface DialogPickDirectoryRes {
  /** 선택한 폴더 절대경로. 취소면 null. */
  readonly path: string | null
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
  /** 파일 수정시각(ms). 캐시 키에 포함 — 파일 교체 시 stale 썸네일 방지(옵셔널·하위호환). */
  readonly mtime?: number
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
  /**
   * 접속 직후 서버가 보고한 초기 작업 디렉토리(FTP pwd·SFTP cwd, 보통 홈 폴더).
   * 미보고/조회 실패 시 미존재 → 호출측이 루트('/')로 폴백한다.
   */
  readonly initialPath?: string
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

// ── hash:* 공용 해시·비교 엔진 (신규 M7 — ADR-009) ──────────────────────
// 잡 시작 invoke → Result<{ jobId }>. 진행/완료/오류는 jobId 상관 푸시 evt.
// 모든 경로는 핸들러가 guardPath 로 정규화·상위이탈 차단·원격 prefix 거부(로컬 한정).

/** P1 폴더 비교 시작(메타 4상태 + 해시 옵션 + 재귀). */
export interface HashCompareStartReq {
  readonly leftDir: string
  readonly rightDir: string
  /** true=같은 이름·같은 크기 항목의 내용 해시 비교(같은 크기 아님=diff·해시 회피). */
  readonly useHash: boolean
  /** true=양쪽 동명 하위 폴더 재귀 비교(relPath 누적·순환차단). */
  readonly recursive: boolean
  readonly algo?: HashAlgo
}

/** R2 중복 탐지 시작(크기 그룹핑 → 해시 그룹 확정). */
export interface HashDupStartReq {
  /** 탐지 범위(폴더/드라이브/패널 경로). 핸들러가 각 디렉토리 검증. */
  readonly roots: string[]
  /** 이 크기 미만 무시(기본 1 — 0바이트 제외). */
  readonly minSize?: number
  readonly algo?: HashAlgo
}

/** R4 체크섬 검증 시작(원본·사본 쌍 비교). pairs 는 핸들러가 각 파일 검증. */
export interface HashVerifyStartReq {
  readonly pairs: { readonly src: string; readonly dst: string }[]
  readonly algo?: HashAlgo
}

/** 해시 잡 취소(jobId 협조취소). */
export interface HashCancelReq {
  readonly jobId: string
}

/** 잡 시작 응답 — 이후 progress/done/error 를 묶는 jobId. */
export interface HashJobStartRes {
  readonly jobId: string
}

// ── queue:* 전송 큐 (신규 M7 — ADR-011, 타입만 동결 / impl: W2) ──────────
/** queue:list 응답 — 현재 큐 항목 스냅샷. */
export interface QueueListRes {
  readonly items: QueueItemDTO[]
}
/** 큐 항목 일시정지/재개/재시도 요청(operationId 식별 — 기존 op 재사용). */
export interface QueuePauseReq {
  readonly operationId: string
}
export interface QueueResumeReq {
  readonly operationId: string
}
export interface QueueRetryReq {
  readonly operationId: string
}
/** 큐 동시성 한도 설정(스케줄러 한도 갱신 후 pump). */
export interface QueueSetConcurrencyReq {
  readonly maxConcurrent: number
}

// ── search:content:* 내용 검색 grep (신규 M8 — ADR-010 결정⑤) ──────────────
// root 는 핸들러가 guardPath 로 정규화·상위이탈 차단·디렉토리 검증·원격 prefix 거부(로컬 한정).
/** grep 시작 요청. query 는 문자열(부분 일치) 또는 정규식(isRegex). */
export interface SearchContentStartReq {
  /** 검색 루트 폴더(현재 패널 경로). 핸들러가 guardPath·디렉토리 검증. */
  readonly root: string
  /** 검색어(문자열 또는 정규식 소스). 빈 문자열 불가(핸들러 거부). */
  readonly query: string
  /** true=query 를 정규식으로 컴파일(실패 시 Result.err·throw 0). false=리터럴 부분 일치. */
  readonly isRegex: boolean
  /** true=하위 폴더 재귀 스캔. false=현재 폴더 1단계만. */
  readonly recursive: boolean
  /** true=숨김/시스템 파일 포함. 미지정=false(기본 제외). */
  readonly includeHidden?: boolean
  /** 파일 크기 상한(바이트). 초과 파일은 스캔 스킵. 미지정=엔진 기본 상한. */
  readonly maxFileBytes?: number
}
/** grep 시작 응답 — 이후 progress/match/done 을 묶는 jobId. */
export interface SearchContentStartRes {
  readonly jobId: string
}
/** grep 잡 취소(jobId 협조취소·멱등). */
export interface SearchContentCancelReq {
  readonly jobId: string
}

// archive:* 압축파일 어댑터 (M9 — ADR-008)
export interface ArchiveOpenReq {
  readonly archivePath: string
}
export interface ArchiveOpenRes {
  readonly sessionId: string
}
export interface ArchiveListReq {
  readonly sessionId: string
  readonly innerPath: string
}
export interface ArchiveListRes {
  readonly entries: FileEntryDTO[]
}
export interface ArchiveCloseReq {
  readonly sessionId: string
}
export interface ArchiveExtractReq {
  readonly sessionId: string
  readonly innerPaths: string[]
  readonly destDir: string
  readonly conflictPolicy?: ConflictPolicy
}
export interface ArchiveAddReq {
  readonly sessionId: string
  readonly localPaths: string[]
  readonly innerDir: string
  readonly conflictPolicy?: ConflictPolicy
}
export interface ArchiveTransferRes {
  readonly operationId: string
}

// ────────────────────────────────────────────────────────────────────────
// agent:* 자연어 파일 에이전트 (신규 §Z — ADR-014·ADR-015)
// 키(API 키) 는 어떤 요청/응답·이벤트에도 평문 미수록(safeStorage·G5).
// DTO(ProviderId·ProviderConfig·PlannedOp·ConfirmedOpDTO·ModelInfo)는 shared/dto.
// ────────────────────────────────────────────────────────────────────────

// 키 (값은 즉시 safeStorage — 응답/로그/DTO 어디에도 평문 미수록)
export interface AgentKeySetReq {
  readonly provider: ProviderId
  readonly apiKey: string
}
export interface AgentKeyHasReq {
  readonly provider: ProviderId
}
export interface AgentKeyHasRes {
  readonly has: boolean
}

// 제공자 설정 (비-비밀만)
// 단일 채널 agent:provider:set 으로 ① 활성 제공자 설정(config) ② 내부 SSRF 화이트리스트
// 추가/삭제(hostOp)를 모두 처리한다(신규 채널 0). 둘 중 하나만 지정한다.
export interface AgentProviderSetReq {
  readonly config?: ProviderConfig
  /**
   * 내부 호스트 화이트리스트 관리(선택). add 는 ssrfGuard.validateRegister 통과 시 등록,
   * remove 는 정규화 키/URL 로 삭제. config 와 동시 지정 시 config 가 우선.
   */
  readonly hostOp?: { readonly action: 'add' | 'remove'; readonly host: string }
}
export interface AgentProviderGetRes {
  readonly active: ProviderConfig // 키 미포함
  readonly available: readonly ProviderId[] // 키 보유 제공자
  readonly allowedInternalHosts: readonly string[] // 내부 화이트리스트(비-비밀)
}
export interface AgentProviderModelsReq {
  readonly id: ProviderId
}
export interface AgentProviderModelsRes {
  readonly models: readonly ModelInfo[]
}
export interface AgentProviderProbeReq {
  readonly id: ProviderId
}
export interface AgentProviderProbeRes {
  readonly toolUse: boolean
  /** 판정 출처: 'probe'=실 런타임 더미 도구 completion, 'static'=정적 capability 폴백. */
  readonly source?: 'probe' | 'static'
  /** 폴백/판정 사유(키 없음·probe 실패 등 — 정직 표기). */
  readonly reason?: string
}

// 실행 시작
export interface AgentRunReq {
  readonly prompt: string
  readonly context: {
    readonly cwd: string
    readonly selection: readonly string[]
    /**
     * 이름 있는 위치(즐겨찾기·빠른위치·최근·드라이브·패널 1~4) → 실경로 모음(§Z).
     * 비파괴 옵셔널 — 미제공 시 기존 동작과 동일(list_locations 빈 결과·스코프=cwd/selection만).
     * list_locations 도구가 패스스루로 반환하고, 로컬·비시스템 경로는 스코프 루트로 추가된다.
     */
    readonly locations?: AgentLocations
  }
  /** 파일 실내용(preview) 전송 동의(SG-4). 기본 false=경로·메타만. */
  readonly contentConsent?: boolean
}
export interface AgentRunRes {
  readonly runId: string
}

// 푸시 이벤트(단방향 스트림)
export type AgentEvent =
  | { readonly type: 'thinking'; readonly runId: string; readonly text: string }
  | {
      readonly type: 'tool-call'
      readonly runId: string
      readonly tool: string
      /** read=파일 읽기 / write=쓰기(Z2) / navigate=비파괴 내비(§Z open_tab). */
      readonly mode: 'read' | 'write' | 'navigate'
      readonly target?: string
    }
  | { readonly type: 'plan-add'; readonly runId: string; readonly op: PlannedOp }
  | {
      /**
       * 비파괴 내비게이션 액션(§Z open_tab — 파일 미변경·확인 불요). 렌더러가 받아 즉시
       * 실행한다(예: 'open-tab' → tabsSlice.newTab(path)). plan/confirm 흐름 밖이다.
       * 동결 후 비파괴 확장(기존 변형 무변·신규 IPC 채널 0·기존 agent:event 재사용).
       */
      readonly type: 'action'
      readonly runId: string
      /** 현재 'open-tab'만. 향후 비파괴 내비 액션 추가 시 유니온 확장. */
      readonly action: 'open-tab'
      /** 새 탭으로 열 정규화된 로컬 경로(핸들러가 guardPath+scope 통과시킨 값). */
      readonly path: string
    }
  | {
      readonly type: 'plan-ready'
      readonly runId: string
      readonly plan: readonly PlannedOp[]
      readonly summary: string
      readonly truncated: boolean
    }
  | {
      /**
       * 추론 계획 단계 목록(ADR-016 하이브리드 오케스트레이션·design §14.4). 패널이 받으면
       * 스텝 체크리스트를 thinking 위에 표시한다. 다단계 질의에서만 발생(단순 질의=plan 우회→미발생→
       * 현재와 동일 UI). ⚠️ 쓰기 PlannedOp(plan-ready)와 별개 — 읽기 전용 추론 계획이다.
       * 동결 후 비파괴 확장(기존 변형 무변·신규 IPC 채널 0·기존 agent:event 재사용).
       */
      readonly type: 'plan'
      readonly runId: string
      readonly steps: ReadonlyArray<{ readonly id: string; readonly goal: string }>
      /** 재계획 횟수(0=최초 계획). */
      readonly replanCount: number
    }
  | {
      /**
       * 추론 스텝 진행(ADR-016 §14.4). 패널이 받으면 해당 스텝의 진행 상태(진행중/완료/실패)를
       * 갱신한다. plan 변형과 함께 다단계 질의에서만 발생. 비파괴 확장(신규 IPC 채널 0).
       */
      readonly type: 'step'
      readonly runId: string
      readonly stepId: string
      readonly index: number
      readonly total: number
      readonly phase: 'start' | 'done' | 'failed'
    }
  | {
      /**
       * 장시간 도구(트리 워크) 진행 피드백(§Z 프리징 완화). search_content(및 scan/dup 보유 시)가
       * 큰 트리를 걷는 동안 스로틀된 누적 진행(스캔/일치 파일 + 현재 경로)을 푸시한다. 패널이 받으면
       * 현재 도구 호출 라인을 라이브 갱신한다("🔧 search_content: N개 검색 · M 일치 · 현재경로").
       * 다단계 질의의 stepId 부기(있을 때만). 비파괴 확장(기존 변형 무변·신규 IPC 채널 0·기존
       * agent:event 재사용). 진행 통지일 뿐 결과/제어와 무관(놓쳐도 안전).
       */
      readonly type: 'tool-progress'
      readonly runId: string
      readonly tool: string
      readonly stepId?: string
      /** 누적 스캔 파일 수. */
      readonly scanned: number
      /** 누적 일치 파일 수. */
      readonly matched: number
      /** 현재 처리 중 경로(길이 제한·새니타이즈됨). 없을 수 있음. */
      readonly current?: string
    }
  | { readonly type: 'error'; readonly runId: string; readonly error: FileOpError }

// 확정 실행(스코프 재검증·정규화)
export interface AgentConfirmReq {
  readonly runId: string
  readonly ops: readonly PlannedOp[] // 사용자가 부분 수용한 ops
  readonly conflictByOp?: Readonly<Record<string, ConflictResolution>>
}
export interface AgentConfirmRes {
  readonly confirmed: readonly ConfirmedOpDTO[] // 검증 통과·op:start 정규화형
}
export interface AgentCancelReq {
  readonly runId: string
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
  [CHANNELS.FS_KNOWN_FOLDERS]: { req: void; res: Result<KnownFoldersDTO> }
  [CHANNELS.FS_TREE_CHILDREN]: { req: FsTreeChildrenReq; res: Result<FileEntryDTO[]> }
  [CHANNELS.FS_VALIDATE_PATH]: { req: FsValidatePathReq; res: Result<PathValidation> }
  [CHANNELS.FS_LIST_START]: { req: FsListStartReq; res: Result<ListStreamStart> }
  [CHANNELS.FS_LIST_CANCEL]: { req: FsListCancelReq; res: Result<void> }

  // fs:* 단발 (P4)
  [CHANNELS.FS_MKDIR]: { req: FsMkdirReq; res: Result<FileEntryDTO> }
  [CHANNELS.FS_CREATE_FILE]: { req: FsCreateFileReq; res: Result<FileEntryDTO> }
  [CHANNELS.FS_RENAME]: { req: FsRenameReq; res: Result<FileEntryDTO> }
  [CHANNELS.FS_LINK_FINALIZE]: { req: FsLinkFinalizeReq; res: Result<void> }

  // shell:* (P2/P4/P6)
  [CHANNELS.SHELL_OPEN]: { req: ShellOpenReq; res: Result<void> }
  [CHANNELS.SHELL_OPEN_WITH]: { req: ShellOpenWithReq; res: Result<void> }
  [CHANNELS.SHELL_SHOW_PROPERTIES]: { req: ShellShowPropertiesReq; res: Result<void> }
  [CHANNELS.SHELL_ICON]: { req: ShellIconReq; res: Result<ShellIconRes> }
  [CHANNELS.SHELL_OPEN_TERMINAL]: { req: ShellOpenTerminalReq; res: Result<void> }
  [CHANNELS.SHELL_OPEN_EXTERNAL]: { req: ShellOpenExternalReq; res: Result<void> }
  // §Y1: 셸 컨텍스트 verb 조회/실행(상주 PowerShell·COM Verbs)
  [CHANNELS.SHELL_CONTEXT_VERBS]: { req: ShellContextVerbsReq; res: Result<ShellContextVerbsRes> }
  [CHANNELS.SHELL_INVOKE_VERB]: { req: ShellInvokeVerbReq; res: Result<void> }

  // op:* (P4)
  [CHANNELS.OP_START]: { req: OpStartReq; res: Result<OpStartRes> }
  [CHANNELS.OP_RESOLVE]: { req: OpResolveReq; res: Result<void> }
  [CHANNELS.OP_CANCEL]: { req: OpCancelReq; res: Result<void> }
  [CHANNELS.OP_ROBOCOPY_START]: { req: OpRobocopyStartReq; res: Result<OpStartRes> }

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
  [CHANNELS.DIALOG_PICK_DIRECTORY]: { req: DialogPickDirectoryReq; res: Result<DialogPickDirectoryRes> }

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

  // window:* 멀티 윈도우 (신규 U3 — 탭 분리(새 창), US-20.3)
  [CHANNELS.WINDOW_SPLIT_TAB]: { req: WindowSplitTabReq; res: Result<void> }
  [CHANNELS.WINDOW_GET_INIT]: { req: void; res: Result<WindowInitRes> }

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

  // hash:* (신규 M7 — ADR-009, 핸들러 impl: W1)
  [CHANNELS.HASH_COMPARE_START]: { req: HashCompareStartReq; res: Result<HashJobStartRes> }
  [CHANNELS.HASH_DUP_START]: { req: HashDupStartReq; res: Result<HashJobStartRes> }
  [CHANNELS.HASH_VERIFY_START]: { req: HashVerifyStartReq; res: Result<HashJobStartRes> }
  [CHANNELS.HASH_CANCEL]: { req: HashCancelReq; res: Result<void> }

  // queue:* (신규 M7 — ADR-011, 타입만 동결 / 큐 핸들러 impl: W2)
  [CHANNELS.QUEUE_LIST]: { req: void; res: Result<QueueListRes> }
  [CHANNELS.QUEUE_PAUSE]: { req: QueuePauseReq; res: Result<void> }
  [CHANNELS.QUEUE_RESUME]: { req: QueueResumeReq; res: Result<void> }
  [CHANNELS.QUEUE_RETRY]: { req: QueueRetryReq; res: Result<void> }
  [CHANNELS.QUEUE_SET_CONCURRENCY]: { req: QueueSetConcurrencyReq; res: Result<void> }

  // search:content:* (신규 M8 — ADR-010, 핸들러/GrepManager impl: S1)
  [CHANNELS.SEARCH_CONTENT_START]: { req: SearchContentStartReq; res: Result<SearchContentStartRes> }
  [CHANNELS.SEARCH_CONTENT_CANCEL]: { req: SearchContentCancelReq; res: Result<void> }

  // archive:* (신규 M9 — ADR-008, 핸들러 impl: Q1)
  [CHANNELS.ARCHIVE_OPEN]: { req: ArchiveOpenReq; res: Result<ArchiveOpenRes> }
  [CHANNELS.ARCHIVE_LIST]: { req: ArchiveListReq; res: Result<ArchiveListRes> }
  [CHANNELS.ARCHIVE_CLOSE]: { req: ArchiveCloseReq; res: Result<void> }
  [CHANNELS.ARCHIVE_EXTRACT]: { req: ArchiveExtractReq; res: Result<ArchiveTransferRes> }
  [CHANNELS.ARCHIVE_ADD]: { req: ArchiveAddReq; res: Result<ArchiveTransferRes> }

  // agent:* (신규 §Z — ADR-014·ADR-015, 핸들러/Orchestrator impl: Z0~Z4)
  [CHANNELS.AGENT_RUN]: { req: AgentRunReq; res: Result<AgentRunRes> }
  [CHANNELS.AGENT_CONFIRM]: { req: AgentConfirmReq; res: Result<AgentConfirmRes> }
  [CHANNELS.AGENT_CANCEL]: { req: AgentCancelReq; res: Result<void> }
  [CHANNELS.AGENT_PROVIDER_SET]: { req: AgentProviderSetReq; res: Result<void> }
  [CHANNELS.AGENT_PROVIDER_GET]: { req: void; res: Result<AgentProviderGetRes> }
  [CHANNELS.AGENT_PROVIDER_MODELS]: { req: AgentProviderModelsReq; res: Result<AgentProviderModelsRes> }
  [CHANNELS.AGENT_PROVIDER_PROBE]: { req: AgentProviderProbeReq; res: Result<AgentProviderProbeRes> }
  [CHANNELS.AGENT_KEY_SET]: { req: AgentKeySetReq; res: Result<void> }
  [CHANNELS.AGENT_KEY_HAS]: { req: AgentKeyHasReq; res: Result<AgentKeyHasRes> }
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

// ── hash:* 푸시 evt (신규 M7 — ADR-009, jobId 상관 — 소비측 필터) ────────
/** 진행률(200ms 스로틀) — 누적 항목/바이트 + 현재 경로. 3 잡 종류 공통. */
export interface HashProgressEvt {
  readonly jobId: string
  readonly scannedItems: number
  readonly scannedBytes: number
  readonly currentPath: string
}
/** P1 폴더 비교 완료 — 4상태 분류·짝지음 결과. */
export interface HashCompareDoneEvt {
  readonly jobId: string
  readonly result: CompareResultDTO
}
/** R2 중복 탐지 완료 — 중복 그룹 + 항목 상한 도달 여부. */
export interface HashDupDoneEvt {
  readonly jobId: string
  readonly groups: DupGroupDTO[]
  readonly truncated: boolean
}
/** R4 체크섬 검증 완료 — 불일치 목록 + 일치 수(verified). */
export interface HashVerifyDoneEvt {
  readonly jobId: string
  readonly mismatches: VerifyMismatchDTO[]
  readonly verified: number
}
/** 잡 치명 오류(hash:error) — analyze:scan:error 동형(잡 시작은 invoke Result.err). */
export interface HashErrorEvt {
  readonly jobId: string
  readonly error: FileOpError
}

// ── queue:* 푸시 evt (신규 M7 — ADR-011, 타입만 동결 / impl: W2) ─────────
/** 디바운스 큐 스냅샷(queue:state). 큐 변경 시 1건 푸시. */
export interface QueueStateEvt {
  readonly items: QueueItemDTO[]
}

// ── app:* 푸시 evt (신규 V2 — 탐색기 "AGT-Finder로 열기") ─────────────────
/** 탐색기 컨텍스트 메뉴로 전달된 경로(정규화된 로컬 폴더/드라이브/파일). 렌더러가 새 탭으로 연다. */
export interface AppOpenPathEvt {
  readonly path: string
}

// ── window:* 멀티 윈도우 (신규 U3 — 탭 분리(새 창), US-20.3) ────────────────
/**
 * 탭 분리 요청(window:split-tab). 소스 렌더러가 분리할 탭의 직렬화 스냅샷을
 * 그대로 넘기면(세션 TabSnapshot 과 동형) main 이 새 창을 만들어 그 탭으로 부팅한다.
 * 비밀·휘발 상태는 애초에 TabSnapshot 에 없다(세션 직렬화와 동일 규약).
 */
export interface WindowSplitTabReq {
  readonly tab: TabSnapshot
}
/**
 * 부팅 초기 상태(window:get-init). 각 창의 렌더러가 부팅 시 invoke 로 끌어간다.
 * primary=true 면 세션 복원·자동저장 담당(기본 부트), false 면 분리 창
 * (initialTab 으로 부팅·자동저장 미참여). initialTab 은 split 창만 채워진다.
 */
export interface WindowInitRes {
  readonly primary: boolean
  readonly initialTab: TabSnapshot | null
}

// ── search:content:* 푸시 evt (신규 M8 — ADR-010, jobId 상관 — 소비측 필터) ──
/** 진행률(200ms 스로틀) — 누적 스캔 파일/일치 파일 + 현재 경로. */
export interface SearchContentProgressEvt {
  readonly jobId: string
  /** 지금까지 스캔(텍스트 후보)한 파일 수. */
  readonly scannedFiles: number
  /** 지금까지 1건 이상 일치한 파일 수. */
  readonly matchedFiles: number
  readonly currentPath: string
}
/** 파일 단위 증분 결과 — 가상 스크롤이 적재. file=절대경로, lines=일치 줄(파일별 상한까지). */
export interface SearchContentMatchEvt {
  readonly jobId: string
  readonly file: GrepMatchDTO['file']
  readonly lines: GrepMatchDTO['lines']
}
/** grep 완료 — 총 일치 수 + 상한(파일/줄/총 결과) 도달로 잘렸는지(정직 표기). */
export interface SearchContentDoneEvt {
  readonly jobId: string
  readonly totalMatches: number
  readonly truncated: boolean
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

  // hash:* 푸시 evt (신규 M7 — ADR-009)
  [CHANNELS.HASH_COMPARE_PROGRESS]: HashProgressEvt
  [CHANNELS.HASH_COMPARE_DONE]: HashCompareDoneEvt
  [CHANNELS.HASH_DUP_PROGRESS]: HashProgressEvt
  [CHANNELS.HASH_DUP_DONE]: HashDupDoneEvt
  [CHANNELS.HASH_VERIFY_PROGRESS]: HashProgressEvt
  [CHANNELS.HASH_VERIFY_DONE]: HashVerifyDoneEvt
  [CHANNELS.HASH_ERROR]: HashErrorEvt

  // queue:* 푸시 evt (신규 M7 — ADR-011, 타입만 동결 / impl: W2)
  [CHANNELS.QUEUE_STATE]: QueueStateEvt

  // app:* 푸시 evt (신규 V2 — 탐색기 "AGT-Finder로 열기")
  [CHANNELS.APP_OPEN_PATH]: AppOpenPathEvt

  // search:content:* 푸시 evt (신규 M8 — ADR-010)
  [CHANNELS.SEARCH_CONTENT_PROGRESS]: SearchContentProgressEvt
  [CHANNELS.SEARCH_CONTENT_MATCH]: SearchContentMatchEvt
  [CHANNELS.SEARCH_CONTENT_DONE]: SearchContentDoneEvt

  // agent:* 푸시 evt (신규 §Z — ADR-014·ADR-015)
  [CHANNELS.AGENT_EVENT]: AgentEvent
}

export type EventChannel = keyof IpcEventMap
export type PayloadOf<C extends EventChannel> = IpcEventMap[C]
