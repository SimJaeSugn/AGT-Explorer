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

  // ── shell:* 쉘/OS 통합 ─ 계약만 동결 ─────────────────────────────────
  SHELL_OPEN: 'shell:open', // impl: P2
  SHELL_OPEN_WITH: 'shell:open-with', // impl: P6 (Should)
  SHELL_SHOW_PROPERTIES: 'shell:show-properties', // impl: P4
  SHELL_ICON: 'shell:icon', // impl: H6 (OS 파일 아이콘·확장자 캐시)
  SHELL_OPEN_TERMINAL: 'shell:open-terminal', // impl: H4 (wt.exe→PowerShell)

  // ── op:* 파일 작업(비동기·취소·진행률) ─ 계약만 동결, impl: P4 ────────
  OP_START: 'op:start', // impl: P4
  OP_PROGRESS: 'op:progress', // 푸시 evt · impl: P4
  OP_CONFLICT: 'op:conflict', // 푸시 evt · impl: P4
  OP_RESOLVE: 'op:resolve', // impl: P4
  OP_DONE: 'op:done', // 푸시 evt · impl: P4
  OP_CANCEL: 'op:cancel', // impl: P4

  // ── clipboard:* OS 클립보드 파일 연동 ─ 계약만 동결, impl: P4 ─────────
  CLIPBOARD_COPY_FILES: 'clipboard:copy-files', // impl: P4
  CLIPBOARD_CUT_FILES: 'clipboard:cut-files', // impl: P4
  CLIPBOARD_PASTE_TARGET: 'clipboard:paste-target', // impl: P4
  CLIPBOARD_READ: 'clipboard:read', // impl: P4 (클립보드에 담긴 파일 조회)

  // ── dialog:* Main 모달 ─ 계약만 동결, impl: P4 ───────────────────────
  DIALOG_CONFIRM_PERMANENT_DELETE: 'dialog:confirm-permanent-delete', // impl: P4

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
  FS_WATCH_ERROR: 'fs:watch:error' // 푸시 evt (권한·네트워크·미지원 드라이브 감시 실패 격리)
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
  CHANNELS.FS_WATCH_ERROR
] as const

export type EventChannelName = (typeof EVENT_CHANNELS)[number]
