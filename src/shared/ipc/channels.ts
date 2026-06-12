/**
 * IPC 채널명 상수 — 단일 출처 (directory-structure §2 shared/ipc/channels.ts).
 *
 * P1 에서 **전 채널**(fs:* / shell:* / op:* / clipboard:* / session:* /
 * settings:* / workspace:*)을 동결한다. 핸들러 실구현 범위는 Phase 별로 분리:
 *   - fs:* (읽기 계열)      → P1 (이 단계에서 구현)
 *   - fs:mkdir/create/rename → P4
 *   - shell:open            → P2,  shell:show-properties/open-with → P4/P6
 *   - op:*                  → P4
 *   - clipboard:*           → P4
 *   - session:* / settings:* → P5
 *   - workspace:*           → P6
 *
 * 명명 규칙: 도메인 네임스페이스 접두사(`fs:`, `shell:`, `op:`, ...) + 동사.
 * 스트림 하위 이벤트는 `:start/:chunk/:done/:error/:cancel` 서픽스.
 *
 * 추적성: SA §3.2 채널 카탈로그, ADR-003.
 */
export const CHANNELS = {
  // ── fs:* 디렉토리/메타 (요청-응답) ─ 구현 P1 ───────────────────────────
  FS_LIST: 'fs:list',
  FS_STAT: 'fs:stat',
  FS_DRIVES: 'fs:drives',
  FS_KNOWN_FOLDERS: 'fs:known-folders', // 빠른 위치(다운로드 등) → Result<KnownFoldersDTO>
  FS_TREE_CHILDREN: 'fs:tree-children',
  FS_VALIDATE_PATH: 'fs:validate-path',

  // ── fs:* 디렉토리 스트리밍 (대형 폴더) ─ 구현 P1 ──────────────────────
  FS_LIST_START: 'fs:list:start',
  FS_LIST_CHUNK: 'fs:list:chunk', // 푸시 evt
  FS_LIST_DONE: 'fs:list:done', // 푸시 evt
  FS_LIST_ERROR: 'fs:list:error', // 푸시 evt
  FS_LIST_CANCEL: 'fs:list:cancel',

  // ── fs:* 단발 기본조작 ─ 계약만 동결, impl: P4 ────────────────────────
  FS_MKDIR: 'fs:mkdir', // impl: P4
  FS_CREATE_FILE: 'fs:create-file', // impl: P4
  FS_RENAME: 'fs:rename', // impl: P4
  FS_LINK_FINALIZE: 'fs:link-finalize', // impl: V10 (자동링크 — 원본 rename + 원본자리 정션 생성, 롤백)

  // ── shell:* 쉘/OS 통합 ─ 계약만 동결 ─────────────────────────────────
  SHELL_OPEN: 'shell:open', // impl: P2
  SHELL_OPEN_WITH: 'shell:open-with', // impl: P6 (Should)
  SHELL_SHOW_PROPERTIES: 'shell:show-properties', // impl: P4
  SHELL_ICON: 'shell:icon', // impl: H6 (OS 파일 아이콘·확장자 캐시)
  SHELL_OPEN_TERMINAL: 'shell:open-terminal', // impl: H4 (wt.exe→PowerShell)
  SHELL_OPEN_EXTERNAL: 'shell:open-external', // impl: V1 (http/https 화이트리스트 → 외부 브라우저)
  SHELL_CONTEXT_VERBS: 'shell:context-verbs', // impl: §Y1 (셸 verb 조회 — 상주 PowerShell)
  SHELL_INVOKE_VERB: 'shell:invoke-verb', // impl: §Y1 (verb.DoIt 실행 — fire-and-forget)

  // ── op:* 파일 작업(비동기·취소·진행률) ─ 계약만 동결, impl: P4 ────────
  OP_START: 'op:start', // impl: P4
  OP_PROGRESS: 'op:progress', // 푸시 evt · impl: P4
  OP_CONFLICT: 'op:conflict', // 푸시 evt · impl: P4
  OP_RESOLVE: 'op:resolve', // impl: P4
  OP_DONE: 'op:done', // 푸시 evt · impl: P4
  OP_CANCEL: 'op:cancel', // impl: P4
  OP_ROBOCOPY_START: 'op:robocopy:start', // impl: V3 (폴더 비교 고속 미러 — robocopy 복사, 진행/취소/완료는 기존 op:* 재사용)

  // ── clipboard:* OS 클립보드 파일 연동 ─ 계약만 동결, impl: P4 ─────────
  CLIPBOARD_COPY_FILES: 'clipboard:copy-files', // impl: P4
  CLIPBOARD_CUT_FILES: 'clipboard:cut-files', // impl: P4
  CLIPBOARD_PASTE_TARGET: 'clipboard:paste-target', // impl: P4
  CLIPBOARD_READ: 'clipboard:read', // impl: P4 (클립보드에 담긴 파일 조회)

  // ── dialog:* Main 모달 ─ 계약만 동결, impl: P4 ───────────────────────
  DIALOG_CONFIRM_PERMANENT_DELETE: 'dialog:confirm-permanent-delete', // impl: P4
  DIALOG_PICK_DIRECTORY: 'dialog:pick-directory', // impl: V10 (네이티브 폴더 선택 — 자동링크 목표 디렉토리)

  // ── session:* / settings:* 영속화 ─ 계약만 동결, impl: P5 ────────────
  SESSION_LOAD: 'session:load', // impl: P5
  SESSION_SAVE: 'session:save', // impl: P5
  SETTINGS_GET: 'settings:get', // impl: P5
  SETTINGS_SET: 'settings:set', // impl: P5
  TELEMETRY_SET_OPT_IN: 'telemetry:set-opt-in', // impl: P6 (기본 false, D5)
  TELEMETRY_GET_OPT_IN: 'telemetry:get-opt-in', // impl: P6 (부팅 재수화, D5)

  // ── workspace:* 명시적 워크스페이스 ─ 계약만 동결, impl: P6 ───────────
  WORKSPACE_SAVE: 'workspace:save', // impl: P6
  WORKSPACE_LIST: 'workspace:list', // impl: P6
  WORKSPACE_LOAD: 'workspace:load', // impl: P6
  WORKSPACE_DELETE: 'workspace:delete', // impl: P6

  // ── preview:* 미리보기 데이터 읽기 ─ 신규(P6 Should) ──────────────────
  PREVIEW_READ: 'preview:read', // impl: P6 (텍스트 앞부분/이미지 바이트/메타)
  PREVIEW_THUMBNAIL: 'preview:thumbnail', // impl: L1 (그리드 이미지 썸네일 — nativeImage)

  // ── analyze:scan:* 디렉토리 사용량 Top10 스캔 ─ 신규(I장) ─────────────
  // op:* 스트림 패턴(streamId 상관·SharedArrayBuffer 협조취소·200ms 스로틀)을
  // 모사한 신규 스캔 서브시스템. 핸들러/Worker impl: I장 다음 단계.
  ANALYZE_SCAN_START: 'analyze:scan:start', // invoke → Result<{ scanId }>
  ANALYZE_SCAN_PROGRESS: 'analyze:scan:progress', // 푸시 evt
  ANALYZE_SCAN_DONE: 'analyze:scan:done', // 푸시 evt
  ANALYZE_SCAN_ERROR: 'analyze:scan:error', // 푸시 evt
  ANALYZE_SCAN_CANCEL: 'analyze:scan:cancel', // invoke → Result<void>

  // ── trash:* 휴지통 관리(열거·복원·비우기) ─ 신규(K장 K2, K1 공유) ────
  // Windows 휴지통 COM(recycleBin.ts) 위 요청-응답 채널. 전부 invoke(푸시 evt
  // 없음) → EVENT_CHANNELS 무변. 핸들러/recycleBin impl: K장 다음 단계(여기선
  // 계약 동결만). list=열거, restore=선택 복원, empty=전체 비우기(confirmed 게이트).
  TRASH_LIST: 'trash:list', // invoke → Result<TrashItemDTO[]>
  TRASH_RESTORE: 'trash:restore', // invoke → Result<void>
  TRASH_EMPTY: 'trash:empty', // invoke → Result<void> (confirmed=true 만 실행)

  // ── fs:watch:* 디렉토리 실시간 감시 ─ 신규(J장 J2) ───────────────────
  // 패널이 보는 **현재 디렉토리 1개**를 non-recursive 로 감시(watchId 상관).
  // 디바운스·병합된 "변경됨" 신호만 보내고 증분은 전송하지 않는다(렌더러 re-list).
  // 핸들러/WatchService impl: J장 다음 단계(여기선 계약 동결만).
  FS_WATCH_START: 'fs:watch:start', // invoke → Result<{ watchId }> (단일 디렉토리 감시 시작)
  FS_WATCH_EVENT: 'fs:watch:event', // 푸시 evt (디바운스·병합된 변경 알림)
  FS_WATCH_STOP: 'fs:watch:stop', // invoke → Result<void> (경로 이동·언마운트 시 중지)
  FS_WATCH_ERROR: 'fs:watch:error', // 푸시 evt (권한·네트워크·미지원 드라이브 감시 실패 격리)

  // ── dnd:* 외부 드래그 (M1, 신규 §M) ─ 계약만 동결, impl: MP3 ───────────
  // webContents.startDrag 위임(로컬 검증 경로만 외부로 노출). 원격 경로 거부.
  DND_START_DRAG: 'dnd:start-drag', // invoke → Result<{ started }>

  // ── clipboard:* CF_HDROP 양방향 (M2, 신규 §M) ─ 계약만 동결, impl: MP2 ─
  // 기존 clipboard:copy-files/cut-files/paste-target/read 채널과 **비파괴 병존**한다
  // (CN-1: 1차는 신규 3채널 추가만, 기존 채널·fileClipboard.ts 보존). 렌더러 호출부
  // 전환은 MP2/MP5. 전송 진행률은 신규 채널 없이 기존 op:* 스트림 재사용.
  CLIPBOARD_WRITE_FILES: 'clipboard:write-files', // invoke → Result<void>
  CLIPBOARD_READ_FILES: 'clipboard:read-files', // invoke → Result<ClipboardFilesReadRes>
  CLIPBOARD_HAS_FILES: 'clipboard:has-files', // invoke → Result<{ has }>

  // ── remote:* FTP/SFTP (M3, 신규 §M) ─ 계약만 동결, impl: MP4 ───────────
  // 자격증명(cred:*)·프로필(profile:*)·세션(connect/disconnect)·탐색(list/stat/
  // mkdir/rename/delete)·전송(download/upload). 전송 진행률·충돌·완료·취소는 신규
  // 채널 없이 기존 op:* 스트림 재사용(download/upload 는 operationId 만 반환).
  // 비밀(password/passphrase/privateKey)은 영속·전송 DTO·응답·로그·Error 에서
  // 구조적 배제 — cred:save/connect 요청 본문으로만 main 에 1회 전달(ADR-007 ③⑥).
  REMOTE_CRED_SAVE: 'remote:cred:save', // invoke → Result<void> (safeStorage 저장)
  REMOTE_CRED_HAS: 'remote:cred:has', // invoke → Result<{ has }>
  REMOTE_CRED_DELETE: 'remote:cred:delete', // invoke → Result<void>
  REMOTE_PROFILE_LIST: 'remote:profile:list', // invoke → Result<RemoteProfileDTO[]>
  REMOTE_PROFILE_UPSERT: 'remote:profile:upsert', // invoke → Result<RemoteProfileDTO>
  REMOTE_PROFILE_DELETE: 'remote:profile:delete', // invoke → Result<void>
  REMOTE_CONNECT: 'remote:connect', // invoke → Result<RemoteConnectRes, RemoteError>
  REMOTE_DISCONNECT: 'remote:disconnect', // invoke → Result<void>
  REMOTE_HOST_KEY: 'remote:host-key', // 푸시 evt (TOFU 호스트키 확인 요청)
  REMOTE_SESSION_ERROR: 'remote:session-error', // 푸시 evt (세션 격리 오류)
  REMOTE_LIST: 'remote:list', // invoke → Result<{ entries }, RemoteError>
  REMOTE_STAT: 'remote:stat', // invoke → Result<FileEntryDTO, RemoteError>
  REMOTE_MKDIR: 'remote:mkdir', // invoke → Result<void, RemoteError>
  REMOTE_RENAME: 'remote:rename', // invoke → Result<void, RemoteError>
  REMOTE_DELETE: 'remote:delete', // invoke → Result<void, RemoteError>
  REMOTE_DOWNLOAD: 'remote:download', // invoke → Result<{ operationId }, RemoteError>
  REMOTE_UPLOAD: 'remote:upload', // invoke → Result<{ operationId }, RemoteError>

  // ── hash:* 공용 해시·비교 엔진 (M7 — ADR-009, 신규) ───────────────────
  // P1 해시 옵션·R2 중복·R4 체크섬·P1 재귀가 공유하는 잡 단위 워커 작업.
  // analyze:scan:* 선례 동형(jobId 상관·SharedArrayBuffer 협조취소·200ms 스로틀·
  // 진행/완료/오류 푸시). 전부 로컬 한정(원격/archive prefix 거부 — ADR-005).
  // 잡 시작 실패는 invoke Result.err, 잡 도중 치명 오류는 hash:error 푸시
  // (analyze:scan:error 동형 — 정직 표면). W0 채널 동결, 핸들러 impl: W1.
  HASH_COMPARE_START: 'hash:compare:start', // invoke → Result<{ jobId }> (P1 폴더 비교)
  HASH_COMPARE_PROGRESS: 'hash:compare:progress', // 푸시 evt
  HASH_COMPARE_DONE: 'hash:compare:done', // 푸시 evt
  HASH_DUP_START: 'hash:dup:start', // invoke → Result<{ jobId }> (R2 중복 탐지)
  HASH_DUP_PROGRESS: 'hash:dup:progress', // 푸시 evt
  HASH_DUP_DONE: 'hash:dup:done', // 푸시 evt
  HASH_VERIFY_START: 'hash:verify:start', // invoke → Result<{ jobId }> (R4 체크섬 검증)
  HASH_VERIFY_PROGRESS: 'hash:verify:progress', // 푸시 evt
  HASH_VERIFY_DONE: 'hash:verify:done', // 푸시 evt
  HASH_ERROR: 'hash:error', // 푸시 evt (잡 치명 오류 — analyze:scan:error 동형)
  HASH_CANCEL: 'hash:cancel', // invoke → Result<void> (jobId 협조취소)

  // ── queue:* 전송 큐 (M7 — ADR-011, 신규) ──────────────────────────────
  // OperationManager 큐 확장 위 요청-응답 + 큐 스냅샷 푸시. 취소=기존 op:cancel,
  // 항목별 진행률=기존 op:progress 재사용(operationId 식별). W0 채널/타입 동결,
  // 큐 핸들러/스케줄러 impl: W2(후속). 여기서는 채널·타입만 등록한다.
  QUEUE_LIST: 'queue:list', // invoke → Result<{ items: QueueItemDTO[] }>
  QUEUE_STATE: 'queue:state', // 푸시 evt (디바운스 큐 스냅샷)
  QUEUE_PAUSE: 'queue:pause', // invoke → Result<void>
  QUEUE_RESUME: 'queue:resume', // invoke → Result<void>
  QUEUE_RETRY: 'queue:retry', // invoke → Result<void>
  QUEUE_SET_CONCURRENCY: 'queue:set-concurrency', // invoke → Result<void>

  // ── app:* 앱 연동 (신규 V2 — 탐색기 "AGT-Finder로 열기") ──────────────────
  // argv(최초 실행)·second-instance(중복 실행) 로 받은 탐색기 경로를 렌더러로 푸시한다.
  // Main→Renderer 단방향 이벤트(요청-응답 아님). 새 탭으로 해당 폴더/드라이브를 연다.
  APP_OPEN_PATH: 'app:open-path', // 푸시 evt (탐색기 컨텍스트 메뉴 경로 → 새 탭)

  // ── window:* 멀티 윈도우 (신규 U3 — 탭 분리(새 창), US-20.3 Could) ──────────
  // 둘 다 invoke(요청-응답) → EVENT_CHANNELS 무변(신규 푸시 evt 0).
  //  - split-tab: 소스 렌더러가 탭 1개를 분리(TabSnapshot 전달) → main 이 새 창 생성.
  //  - get-init : 각 창의 렌더러가 부팅 시 자기 초기 상태({primary, initialTab})를
  //               동기 invoke 로 끌어온다(푸시 경쟁 회피). main 은 event.sender 로 식별.
  WINDOW_SPLIT_TAB: 'window:split-tab', // invoke → Result<void> (탭 → 새 창 분리)
  WINDOW_GET_INIT: 'window:get-init', // invoke → Result<WindowInitRes> (부팅 초기 상태)

  // ── search:content:* 내용 검색 grep (M8 — ADR-010, 신규 §S S1) ─────────────
  // 현재 폴더(+하위 토글) 온디맨드 텍스트/정규식 grep. analyze:scan:*·hash:* 선례
  // 동형(jobId 상관·SharedArrayBuffer 협조취소·200ms 스로틀 진행률·증분 결과 푸시).
  // 전부 로컬 한정(원격/archive prefix 거부 — ADR-005). 외부 바이너리·spawn 없음
  // (내장 Worker 스트리밍 스캔 — ADR-010 결정①). 신규 npm 의존성 0.
  // 잡 시작 실패는 invoke Result.err, 진행/일치/완료는 jobId 상관 푸시 evt.
  // M8 채널 동결, 핸들러/GrepManager impl: 본 단계(S1).
  SEARCH_CONTENT_START: 'search:content:start', // invoke → Result<{ jobId }> (grep 시작)
  SEARCH_CONTENT_PROGRESS: 'search:content:progress', // 푸시 evt (200ms 스로틀)
  SEARCH_CONTENT_MATCH: 'search:content:match', // 푸시 evt (파일 단위 증분 결과)
  SEARCH_CONTENT_DONE: 'search:content:done', // 푸시 evt (총 일치 수·truncated)
  SEARCH_CONTENT_CANCEL: 'search:content:cancel', // invoke → Result<void> (jobId 협조취소)

  // ── archive:* 압축파일 어댑터 (M9 — ADR-008, 신규 §Q Q1) ──────────────────
  ARCHIVE_OPEN: 'archive:open',
  ARCHIVE_LIST: 'archive:list',
  ARCHIVE_CLOSE: 'archive:close',
  ARCHIVE_EXTRACT: 'archive:extract',
  ARCHIVE_ADD: 'archive:add'
} as const

export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS]

/**
 * Main→Renderer 단방향 푸시(이벤트 스트림) 채널 집합.
 * Preload 가 `on(...)` 구독을 노출하는 채널이며 invoke/handle 대상이 아니다.
 */
export const EVENT_CHANNELS = [
  CHANNELS.FS_LIST_CHUNK,
  CHANNELS.FS_LIST_DONE,
  CHANNELS.FS_LIST_ERROR,
  CHANNELS.OP_PROGRESS,
  CHANNELS.OP_CONFLICT,
  CHANNELS.OP_DONE,
  // analyze:scan:* 푸시 evt (신규 I장)
  CHANNELS.ANALYZE_SCAN_PROGRESS,
  CHANNELS.ANALYZE_SCAN_DONE,
  CHANNELS.ANALYZE_SCAN_ERROR,
  // fs:watch:* 푸시 evt (신규 J장 J2)
  CHANNELS.FS_WATCH_EVENT,
  CHANNELS.FS_WATCH_ERROR,
  // remote:* 푸시 evt (신규 §M M3 — TOFU 호스트키 확인·세션 격리 오류)
  CHANNELS.REMOTE_HOST_KEY,
  CHANNELS.REMOTE_SESSION_ERROR,
  // hash:* 푸시 evt (신규 M7 — ADR-009, jobId 상관 진행/완료/오류)
  CHANNELS.HASH_COMPARE_PROGRESS,
  CHANNELS.HASH_COMPARE_DONE,
  CHANNELS.HASH_DUP_PROGRESS,
  CHANNELS.HASH_DUP_DONE,
  CHANNELS.HASH_VERIFY_PROGRESS,
  CHANNELS.HASH_VERIFY_DONE,
  CHANNELS.HASH_ERROR,
  // queue:* 푸시 evt (신규 M7 — ADR-011, 디바운스 큐 스냅샷, impl: W2)
  CHANNELS.QUEUE_STATE,
  // app:* 푸시 evt (신규 V2 — 탐색기 "AGT-Finder로 열기" 경로 전달)
  CHANNELS.APP_OPEN_PATH,
  // search:content:* 푸시 evt (신규 M8 — ADR-010, jobId 상관 진행/일치/완료)
  CHANNELS.SEARCH_CONTENT_PROGRESS,
  CHANNELS.SEARCH_CONTENT_MATCH,
  CHANNELS.SEARCH_CONTENT_DONE
] as const

export type EventChannelName = (typeof EVENT_CHANNELS)[number]
