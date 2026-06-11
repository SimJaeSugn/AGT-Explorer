/**
 * uiSlice — 테마·설정·전역 UI 상태 (SA §5.2, 저빈도).
 *
 * P2/P3 범위: 활성 입력 컨텍스트(주소 편집/검색/이름편집/다이얼로그)와
 * 파일 실행 실패 등 사용자 안내 토스트. theme·showHidden·showExtensions 의
 * 본격 영속(settings:set)은 P5 이지만 상태 자리는 여기 둔다.
 */
import type { KeyContext } from '@renderer/domain/keybindings'
import type { SettingsSnapshot, ThemeMode } from '@shared/dto'
import type { SliceCreator } from './types'

/** 설정 화면 카테고리(좌측 네비게이션·딥링크 대상). */
export type SettingsCategory = 'layout' | 'system' | 'workspace' | 'shortcuts'

/** 유효 카테고리만 통과(이벤트 객체 등 비문자열 인자 방어). */
const SETTINGS_CATEGORIES: ReadonlySet<SettingsCategory> = new Set<SettingsCategory>([
  'layout',
  'system',
  'workspace',
  'shortcuts'
])

/** 사용자 안내 토스트 1개. */
export interface Toast {
  readonly id: string
  readonly kind: 'info' | 'error'
  readonly message: string
}

let toastSeq = 0

/**
 * 영구삭제 확인 모달 상태(P4). 자체 모달로 표시하며 확인 시 onConfirm 콜백을
 * usecase 가 실행한다. paths 표시·취소/확인 버튼을 ConfirmDialog 가 렌더.
 */
export interface ConfirmDeleteState {
  /** 삭제 대상 경로. */
  readonly paths: string[]
  /** 영구삭제 사유 안내(예: 휴지통 실패 폴백). 없으면 일반 영구삭제(Shift+Delete). */
  readonly reason?: string
}

/**
 * 컨텍스트 메뉴(우클릭) 상태(P4). 열려 있으면 좌표·대상 패널·대상 경로를 보유한다.
 * x/y 는 뷰포트 기준 클라이언트 좌표(ContextMenu 가 화면 경계 보정 후 배치).
 * targetPath=null 이면 패널 빈 영역 우클릭(대상 없음 — 붙여넣기/새 폴더/새로고침).
 */
export interface ContextMenuState {
  /** 우클릭 클라이언트 X(뷰포트 기준). */
  readonly x: number
  /** 우클릭 클라이언트 Y(뷰포트 기준). */
  readonly y: number
  /** 메뉴가 속한 패널 id(명령은 활성 패널 기준이므로 열기 전 활성화 보장). */
  readonly panelId: string
  /** 우클릭한 항목 경로(빈 영역이면 null). */
  readonly targetPath: string | null
}

/**
 * 폴더 비교 미러 확인 모달 상태(§P1). 파괴적 동기화(복사 덮어쓰기·삭제 포함)는
 * 확정 전 변경 미리보기(복사 N·덮어쓰기 M·삭제 K)를 보여주고 사용자가 확인한다.
 * 삭제 동기화는 휴지통 경유·K1 undo 보장. confirm 콜백은 usecase 가 실행한다.
 */
export interface CompareMirrorConfirmState {
  /** 미러 방향(좌→우 / 우→좌). */
  readonly direction: 'l2r' | 'r2l'
  /** 복사(없는 것/다른 것) 항목 수. */
  readonly copyCount: number
  /** 덮어쓰기가 되는 항목 수(복사 중 dest 동명 존재). */
  readonly overwriteCount: number
  /** 삭제 동기화 항목 수(휴지통 경유). 삭제 미포함이면 0. */
  readonly deleteCount: number
  /** 삭제 동기화 포함 여부(사용자가 명시 선택). */
  readonly includeDeletes: boolean
}

/**
 * 인라인 이름변경 대상(P4). F2/새 항목 생성 직후 진입.
 * FileListView 가 panelId·path 가 일치하는 행을 input 으로 렌더한다.
 */
export interface RenameTarget {
  readonly panelId: string
  /** 편집 대상 항목 경로. */
  readonly path: string
  /** 입력 초기값(현재 이름). */
  readonly initialName: string
  /** true 면 방금 만든 새 항목(취소 시 별도 처리 가능). */
  readonly isNew: boolean
}

export interface UiSlice {
  /** 현재 활성 입력 컨텍스트(단축키 디스패처가 스코프 판정에 사용). */
  readonly inputContext: KeyContext
  /** 주소 표시줄 편집 모드 여부(Ctrl+L 로 진입). */
  readonly addressEditing: boolean
  /** 사용자 안내 토스트 목록. */
  readonly toasts: Toast[]
  /** 단축키 도움말 패널 표시(P5 설정 화면 전 임시 확인용). */
  readonly shortcutHelpOpen: boolean

  // P4 다이얼로그/인라인 편집 상태 ────────────────────────────────────────
  /** 영구삭제 확인 모달(열려 있으면 객체, 닫혀 있으면 null). */
  readonly confirmDelete: ConfirmDeleteState | null
  /** 인라인 이름변경 대상(없으면 null). */
  readonly renameTarget: RenameTarget | null
  /** 컨텍스트 메뉴(우클릭) 상태(없으면 null). */
  readonly contextMenu: ContextMenuState | null

  // 설정(P5 영속 — settings:get/set 연동) ────────────────────────────────
  /** 숨김/시스템 파일 표시(기본 false → fs:list showHidden 으로 연동). */
  readonly showHidden: boolean
  /** 확장자 표시(기본 true → FileListView 이름 표기). */
  readonly showExtensions: boolean
  /** 테마(라이트/다크/시스템). */
  readonly theme: ThemeMode
  /** 기본 시작 위치(빈 문자열이면 "내 PC"). */
  readonly startLocation: string
  /** 최근 목록 보관 개수. */
  readonly recentLimit: number
  /** 텔레메트리 옵트인(기본 false, D5). SettingsSnapshot 와 분리 채널. */
  readonly telemetryOptIn: boolean
  /** settings:get 로 1회 로드 완료 여부(부팅 동기화 가드). */
  readonly settingsLoaded: boolean
  /** 설정 화면 열림 여부. */
  readonly settingsOpen: boolean
  /** 설정 화면 현재 카테고리(좌측 네비·딥링크). 기본 'layout'. */
  readonly settingsCategory: SettingsCategory
  /** 사용량 대시보드 모달 열림 여부(I장 §4.1). */
  readonly dashboardOpen: boolean
  /** 휴지통 관리 모달 열림 여부(K장 K2). */
  readonly trashOpen: boolean
  /** 원격 연결 다이얼로그 열림 여부(§M M3). */
  readonly remoteDialogOpen: boolean
  /** 고급 일괄 이름변경 다이얼로그 열림 여부(§R1·다중선택). */
  readonly batchRenameOpen: boolean
  /** 자동링크 다이얼로그 대상 폴더 경로(열려 있으면 set, 아니면 null). V10. */
  readonly autoLinkSource: string | null
  /** 자동링크 일괄 다이얼로그 대상 폴더들(열려 있으면 배열, 아니면 null). V(일괄). */
  readonly autoLinkBatchSources: readonly string[] | null
  /** 새 탭 시작 위치 피커 열림(기본 시작 위치 미설정 + 워크스페이스 존재 시). I6. */
  readonly newTabPickerOpen: boolean
  /** 폴더 비교 미러 확인 모달(파괴적 동기화 확정 전·없으면 null, §P1). */
  readonly compareMirrorConfirm: CompareMirrorConfirmState | null
  /** 중복 파일 찾기 다이얼로그 열림 여부(§R2·US-17.2). */
  readonly dedupOpen: boolean
  /** 전송 큐 매니저 패널 열림 여부(§R3·US-17.3). */
  readonly queuePanelOpen: boolean
  /** 프로그램 시작 시 용량 대시보드 자동 표시(설정 영속, I장 §4.4). */
  readonly showDashboardOnStartup: boolean
  /** 복사 후 체크섬 검증(설정 영속, §R4·US-17.4). 기본 off. */
  readonly verifyOnCopy: boolean
  /** 상단 아이콘바에서 숨긴 명령 id(단축아이콘 설정·영속). 기본 빈 배열=전부 표시. */
  readonly iconBarHidden: readonly string[]
  /** 상단 아이콘바 명령 id 표시 순서(드래그 재배열·영속). 기본 빈 배열=정의 순서. */
  readonly iconBarOrder: readonly string[]

  // P6 미리보기 / 워크스페이스 ────────────────────────────────────────────
  /** 미리보기 패널 열림 여부(기본 false, Ctrl+P 토글, US-4.3). 세션 복원 대상. */
  readonly previewOpen: boolean
  /** 미리보기 패널 폭(px, 기본 320, 클램프 240~720, J7). 세션 복원 대상. */
  readonly previewWidth: number
  /** 워크스페이스 관리 다이얼로그 열림 여부(US-5.8). */
  readonly workspaceOpen: boolean
  /**
   * 현재 선택된 워크스페이스 이름(US-5.8 확장 — null=미선택). 불러오기/저장 시 설정되며,
   * 선택 중이면 세션 자동저장이 같은 스냅샷을 해당 워크스페이스 파일에도 기록한다(자동 저장).
   * 세션 복원 대상(SessionSnapshot.currentWorkspace).
   */
  readonly currentWorkspace: string | null

  // S2 명령 팔레트 / U1 퀵룩(Should, M8) ────────────────────────────────────
  /** 명령 팔레트 오버레이 열림 여부(Ctrl+Shift+P, S2·US-18.2). */
  readonly paletteOpen: boolean
  /** 퀵룩(미리보기 오버레이) 열림 시 대상 경로(닫혀 있으면 null, U1·US-20.1). */
  readonly quickLookPath: string | null

  // H-4b 클립보드 동기 상태(붙여넣기 활성조건) ──────────────────────────────
  /**
   * OS 클립보드에 붙여넣을 파일이 있는지(경량 동기 플래그). 붙여넣기 버튼
   * 활성조건용. 휘발 런타임 상태(영속 제외) — OS 클립보드가 진실 출처.
   */
  readonly clipboardHasFiles: boolean

  /** 입력 컨텍스트 설정. */
  setInputContext(ctx: KeyContext): void
  /** 주소 편집 모드 토글. */
  setAddressEditing(editing: boolean): void
  /** 토스트 추가/제거. */
  pushToast(kind: Toast['kind'], message: string): void
  dismissToast(id: string): void
  /** 단축키 도움말 토글. */
  toggleShortcutHelp(): void

  // P5 설정 액션(영속 반영은 usecase/settings 가 settings:set 으로 수행) ──
  /**
   * settings:get 스냅샷(또는 세션 ui.theme)을 슬라이스에 일괄 반영.
   * 부팅 동기화·재시작 복원에 쓰인다. telemetryOptIn 은 별도 인자.
   */
  applySettings(snapshot: SettingsSnapshot, telemetryOptIn: boolean): void
  /** 숨김 파일 표시 설정(목록 재요청은 usecase 가 처리). */
  setShowHidden(v: boolean): void
  /** 확장자 표시 설정. */
  setShowExtensions(v: boolean): void
  /** 테마 설정(즉시 적용은 usecase/구독이 applyTheme 로 처리). */
  setTheme(theme: ThemeMode): void
  /** 기본 시작 위치 설정. */
  setStartLocation(path: string): void
  /** 최근 목록 보관 개수 설정(1~1000 클램프). */
  setRecentLimit(n: number): void
  /** 텔레메트리 옵트인 설정. */
  setTelemetryOptIn(v: boolean): void
  /**
   * 설정 화면 열기(열림 시 inputContext='dialog'). category 를 주면 그 카테고리로
   * 바로 진입(딥링크 — 예: 워크스페이스 아이콘 → 워크스페이스 페이지). 미지정/무효
   * 인자(이벤트 객체 등)는 'layout' 으로 안전 폴백.
   */
  openSettings(category?: SettingsCategory): void
  closeSettings(): void
  /** 설정 카테고리 전환(좌측 네비 클릭). */
  setSettingsCategory(category: SettingsCategory): void
  /** 사용량 대시보드 모달 열기(inputContext='dialog'). */
  openDashboard(): void
  /** 사용량 대시보드 모달 닫기(다른 모달 없으면 inputContext='list' 복귀). */
  closeDashboard(): void
  /** 시작 시 대시보드 표시 설정(영속은 usecase/settings 가 처리). */
  setShowDashboardOnStartup(v: boolean): void
  /** 복사 후 체크섬 검증 설정(영속은 usecase/settings 가 처리, §R4). */
  setVerifyOnCopy(v: boolean): void
  /** 아이콘바 숨김 명령 id 설정(영속은 usecase/settings 가 처리). */
  setIconBarHidden(ids: readonly string[]): void
  /** 아이콘바 표시 순서 설정(영속은 usecase/settings 가 처리). */
  setIconBarOrder(ids: readonly string[]): void
  /** 휴지통 모달이 열릴 때 inputContext='dialog' 전환(trashSlice.openTrash 와 함께 호출). */
  openTrash(): void
  /** 휴지통 모달 닫힘 시 다른 모달 없으면 inputContext='list' 복귀(trashSlice.closeTrash 와 함께). */
  closeTrash(): void
  /** 원격 연결 다이얼로그 열기(inputContext='dialog'). */
  openRemoteDialog(): void
  /** 원격 연결 다이얼로그 닫힘 시 다른 모달 없으면 inputContext='list' 복귀. */
  closeRemoteDialog(): void
  /** 고급 일괄 이름변경 다이얼로그 열기(inputContext='dialog', §R1). */
  openBatchRename(): void
  /** 자동링크 다이얼로그 열기(대상 폴더 경로). V10. */
  openAutoLink(sourceDir: string): void
  /** 자동링크 다이얼로그 닫기. */
  closeAutoLink(): void
  /** 자동링크 일괄 다이얼로그 열기(대상 폴더들). V(일괄). */
  openAutoLinkBatch(dirs: string[]): void
  /** 자동링크 일괄 다이얼로그 닫기. */
  closeAutoLinkBatch(): void
  /** 새 탭 시작 위치 피커 열기/닫기(I6). */
  openNewTabPicker(): void
  closeNewTabPicker(): void
  /** 일괄 이름변경 다이얼로그 닫힘 시 다른 모달 없으면 inputContext='list' 복귀. */
  closeBatchRename(): void
  /** 폴더 비교 미러 확인 모달 열기(inputContext='dialog', §P1). */
  openCompareMirrorConfirm(state: CompareMirrorConfirmState): void
  /** 미러 확인 모달 닫기(다른 모달 없으면 inputContext='list' 복귀). */
  closeCompareMirrorConfirm(): void
  /** 중복 파일 찾기 다이얼로그 열기(inputContext='dialog', §R2). */
  openDedup(): void
  /** 중복 파일 찾기 다이얼로그 닫힘 시 다른 모달 없으면 inputContext='list' 복귀. */
  closeDedup(): void
  /** 전송 큐 매니저 패널 열기(inputContext='dialog', §R3). */
  openQueuePanel(): void
  /** 전송 큐 매니저 패널 닫힘 시 다른 모달 없으면 inputContext='list' 복귀. */
  closeQueuePanel(): void

  // P6 미리보기 / 워크스페이스 액션 ────────────────────────────────────────
  /** 미리보기 패널 토글(Ctrl+P). */
  togglePreview(): void
  /** 미리보기 패널 열림 상태 직접 설정(세션 복원). */
  setPreviewOpen(v: boolean): void
  /** 미리보기 패널 폭 설정(클램프 240~720, J7). 세션 복원·드래그·더블클릭 복귀. */
  setPreviewWidth(px: number): void
  // 워크스페이스 관리는 설정 화면 워크스페이스 페이지로 통합(독립 팝업 폐지) —
  // openWorkspace/closeWorkspace 액션 제거. 진입은 openSettings('workspace').
  /** 현재 선택 워크스페이스 설정/해제(null·빈 문자열=해제 — 자동 저장 중단). */
  setCurrentWorkspace(name: string | null): void

  // S2 명령 팔레트 / U1 퀵룩 액션(Should, M8) ───────────────────────────────
  /** 명령 팔레트 열기(inputContext='dialog' — 전역 단축키 차단·자체 키 처리, S2). */
  openPalette(): void
  /** 명령 팔레트 닫힘 시 다른 모달 없으면 inputContext='list' 복귀. */
  closePalette(): void
  /** 퀵룩 오버레이 열기(대상 경로 지정·inputContext='dialog', U1). */
  openQuickLook(path: string): void
  /** 퀵룩 오버레이 닫힘 시 다른 모달 없으면 inputContext='list' 복귀. */
  closeQuickLook(): void

  // H-4b 클립보드 동기 상태 액션 ───────────────────────────────────────────
  /** 클립보드에 붙여넣을 파일 존재 여부 설정(syncClipboardState·copy/cut 성공). */
  setClipboardHasFiles(v: boolean): void

  // P4 액션 ──────────────────────────────────────────────────────────────
  /** 영구삭제 확인 모달 열기(inputContext='dialog'). reason 은 폴백 사유 안내(선택). */
  openConfirmDelete(paths: string[], reason?: string): void
  /** 영구삭제 확인 모달 닫기(inputContext='list' 복귀). */
  closeConfirmDelete(): void
  /** 인라인 이름변경 시작(inputContext='rename'). */
  startRename(target: RenameTarget): void
  /** 인라인 이름변경 종료(inputContext='list' 복귀). */
  endRename(): void
  /**
   * 컨텍스트 메뉴 열기(inputContext='dialog' — 전역 단축키 차단, 메뉴가 직접 키 처리).
   * 다른 다이얼로그가 열려 있으면 무시(모달 우선).
   */
  openContextMenu(menu: ContextMenuState): void
  /** 컨텍스트 메뉴 닫기(다른 다이얼로그/편집이 없으면 inputContext='list' 복귀). */
  closeContextMenu(): void
}

export const createUiSlice: SliceCreator<UiSlice> = (set) => ({
  inputContext: 'list',
  addressEditing: false,
  toasts: [],
  shortcutHelpOpen: false,
  confirmDelete: null,
  renameTarget: null,
  contextMenu: null,
  showHidden: false,
  showExtensions: true,
  theme: 'system',
  startLocation: '',
  recentLimit: 10,
  telemetryOptIn: false,
  settingsLoaded: false,
  settingsOpen: false,
  settingsCategory: 'layout',
  dashboardOpen: false,
  trashOpen: false,
  remoteDialogOpen: false,
  batchRenameOpen: false,
  autoLinkSource: null,
  autoLinkBatchSources: null,
  newTabPickerOpen: false,
  compareMirrorConfirm: null,
  dedupOpen: false,
  queuePanelOpen: false,
  showDashboardOnStartup: true,
  verifyOnCopy: false,
  iconBarHidden: [],
  iconBarOrder: [],
  previewOpen: false,
  previewWidth: 320,
  workspaceOpen: false,
  currentWorkspace: null,
  paletteOpen: false,
  quickLookPath: null,
  clipboardHasFiles: false,

  applySettings(snapshot, telemetryOptIn) {
    set((s) => {
      s.theme = snapshot.theme
      s.startLocation = snapshot.startLocation
      s.showHidden = snapshot.showHidden
      s.showExtensions = snapshot.showExtensions
      s.recentLimit = Math.min(1000, Math.max(1, Math.trunc(snapshot.recentLimit)))
      s.showDashboardOnStartup = snapshot.showDashboardOnStartup
      // §R4: 비파괴 — 구버전 스냅샷(undefined)은 false 폴백.
      s.verifyOnCopy = snapshot.verifyOnCopy ?? false
      // 단축아이콘: 구버전 스냅샷(undefined)은 빈 배열 폴백(전부 표시·기본 순서).
      s.iconBarHidden = [...(snapshot.iconBarHidden ?? [])]
      s.iconBarOrder = [...(snapshot.iconBarOrder ?? [])]
      s.telemetryOptIn = telemetryOptIn
      s.settingsLoaded = true
    })
  },

  setShowHidden(v) {
    set((s) => {
      s.showHidden = v
    })
  },

  setShowExtensions(v) {
    set((s) => {
      s.showExtensions = v
    })
  },

  setTheme(theme) {
    set((s) => {
      s.theme = theme
    })
  },

  setStartLocation(path) {
    set((s) => {
      s.startLocation = path
    })
  },

  setRecentLimit(n) {
    set((s) => {
      s.recentLimit = Math.min(1000, Math.max(1, Math.trunc(n)))
    })
  },

  setTelemetryOptIn(v) {
    set((s) => {
      s.telemetryOptIn = v
    })
  },

  openSettings(category) {
    set((s) => {
      s.settingsOpen = true
      // 유효 카테고리만 적용(비문자열/무효는 'layout' 폴백 — onClick 직접 바인딩 방어).
      s.settingsCategory =
        typeof category === 'string' && SETTINGS_CATEGORIES.has(category) ? category : 'layout'
      s.inputContext = 'dialog'
    })
  },

  setSettingsCategory(category) {
    set((s) => {
      if (SETTINGS_CATEGORIES.has(category)) s.settingsCategory = category
    })
  },

  closeSettings() {
    set((s) => {
      s.settingsOpen = false
      if (!s.confirmDelete && !s.renameTarget && !s.workspaceOpen && !s.dashboardOpen && !s.trashOpen) {
        s.inputContext = 'list'
      }
    })
  },

  openDashboard() {
    set((s) => {
      s.dashboardOpen = true
      s.inputContext = 'dialog'
    })
  },

  closeDashboard() {
    set((s) => {
      s.dashboardOpen = false
      if (!s.confirmDelete && !s.renameTarget && !s.workspaceOpen && !s.settingsOpen && !s.trashOpen) {
        s.inputContext = 'list'
      }
    })
  },

  setShowDashboardOnStartup(v) {
    set((s) => {
      s.showDashboardOnStartup = v
    })
  },

  setVerifyOnCopy(v) {
    set((s) => {
      s.verifyOnCopy = v
    })
  },

  setIconBarHidden(ids) {
    set((s) => {
      s.iconBarHidden = [...ids]
    })
  },

  setIconBarOrder(ids) {
    set((s) => {
      s.iconBarOrder = [...ids]
    })
  },

  openTrash() {
    set((s) => {
      s.trashOpen = true
      s.inputContext = 'dialog'
    })
  },

  closeTrash() {
    set((s) => {
      s.trashOpen = false
      if (
        !s.confirmDelete &&
        !s.renameTarget &&
        !s.settingsOpen &&
        !s.dashboardOpen &&
        !s.workspaceOpen &&
        !s.remoteDialogOpen
      ) {
        s.inputContext = 'list'
      }
    })
  },

  openRemoteDialog() {
    set((s) => {
      s.remoteDialogOpen = true
      s.inputContext = 'dialog'
    })
  },

  closeRemoteDialog() {
    set((s) => {
      s.remoteDialogOpen = false
      if (
        !s.confirmDelete &&
        !s.renameTarget &&
        !s.settingsOpen &&
        !s.dashboardOpen &&
        !s.workspaceOpen &&
        !s.trashOpen
      ) {
        s.inputContext = 'list'
      }
    })
  },

  openBatchRename() {
    set((s) => {
      s.batchRenameOpen = true
      s.inputContext = 'dialog'
    })
  },

  openAutoLink(sourceDir) {
    set((s) => {
      s.autoLinkSource = sourceDir
      s.inputContext = 'dialog'
    })
  },

  closeAutoLink() {
    set((s) => {
      s.autoLinkSource = null
      if (
        !s.confirmDelete &&
        !s.renameTarget &&
        !s.settingsOpen &&
        !s.dashboardOpen &&
        !s.workspaceOpen &&
        !s.trashOpen &&
        !s.remoteDialogOpen &&
        !s.batchRenameOpen &&
        !s.autoLinkBatchSources
      ) {
        s.inputContext = 'list'
      }
    })
  },

  openAutoLinkBatch(dirs) {
    set((s) => {
      s.autoLinkBatchSources = dirs
      s.inputContext = 'dialog'
    })
  },

  closeAutoLinkBatch() {
    set((s) => {
      s.autoLinkBatchSources = null
      if (
        !s.confirmDelete &&
        !s.renameTarget &&
        !s.settingsOpen &&
        !s.dashboardOpen &&
        !s.workspaceOpen &&
        !s.trashOpen &&
        !s.remoteDialogOpen &&
        !s.batchRenameOpen &&
        !s.autoLinkSource
      ) {
        s.inputContext = 'list'
      }
    })
  },

  openNewTabPicker() {
    set((s) => {
      s.newTabPickerOpen = true
      s.inputContext = 'dialog'
    })
  },

  closeNewTabPicker() {
    set((s) => {
      s.newTabPickerOpen = false
      if (
        !s.confirmDelete &&
        !s.renameTarget &&
        !s.settingsOpen &&
        !s.dashboardOpen &&
        !s.workspaceOpen &&
        !s.trashOpen &&
        !s.remoteDialogOpen &&
        !s.batchRenameOpen &&
        !s.autoLinkSource &&
        !s.autoLinkBatchSources
      ) {
        s.inputContext = 'list'
      }
    })
  },

  closeBatchRename() {
    set((s) => {
      s.batchRenameOpen = false
      if (
        !s.confirmDelete &&
        !s.renameTarget &&
        !s.settingsOpen &&
        !s.dashboardOpen &&
        !s.workspaceOpen &&
        !s.trashOpen &&
        !s.remoteDialogOpen
      ) {
        s.inputContext = 'list'
      }
    })
  },

  openCompareMirrorConfirm(state) {
    set((s) => {
      s.compareMirrorConfirm = state
      s.inputContext = 'dialog'
    })
  },

  closeCompareMirrorConfirm() {
    set((s) => {
      s.compareMirrorConfirm = null
      if (
        !s.confirmDelete &&
        !s.renameTarget &&
        !s.settingsOpen &&
        !s.dashboardOpen &&
        !s.workspaceOpen &&
        !s.trashOpen &&
        !s.remoteDialogOpen &&
        !s.batchRenameOpen
      ) {
        s.inputContext = 'list'
      }
    })
  },

  openDedup() {
    set((s) => {
      s.dedupOpen = true
      s.inputContext = 'dialog'
    })
  },

  closeDedup() {
    set((s) => {
      s.dedupOpen = false
      if (
        !s.confirmDelete &&
        !s.renameTarget &&
        !s.settingsOpen &&
        !s.dashboardOpen &&
        !s.workspaceOpen &&
        !s.trashOpen &&
        !s.remoteDialogOpen &&
        !s.batchRenameOpen &&
        !s.queuePanelOpen
      ) {
        s.inputContext = 'list'
      }
    })
  },

  openQueuePanel() {
    set((s) => {
      s.queuePanelOpen = true
      s.inputContext = 'dialog'
    })
  },

  closeQueuePanel() {
    set((s) => {
      s.queuePanelOpen = false
      if (
        !s.confirmDelete &&
        !s.renameTarget &&
        !s.settingsOpen &&
        !s.dashboardOpen &&
        !s.workspaceOpen &&
        !s.trashOpen &&
        !s.remoteDialogOpen &&
        !s.batchRenameOpen &&
        !s.dedupOpen
      ) {
        s.inputContext = 'list'
      }
    })
  },

  togglePreview() {
    set((s) => {
      s.previewOpen = !s.previewOpen
    })
  },

  setPreviewOpen(v) {
    set((s) => {
      s.previewOpen = v
    })
  },

  setPreviewWidth(px) {
    set((s) => {
      const clamped = Math.max(240, Math.min(720, Math.round(px)))
      s.previewWidth = Number.isFinite(clamped) ? clamped : 320
    })
  },

  setCurrentWorkspace(name) {
    set((s) => {
      // 빈/공백 이름은 해제와 동일(자동 저장 대상 없음).
      s.currentWorkspace = name && name.trim() !== '' ? name : null
    })
  },

  openPalette() {
    set((s) => {
      // 다른 모달이 떠 있으면 무시(모달 우선·중첩 방지).
      if (
        s.confirmDelete ||
        s.settingsOpen ||
        s.workspaceOpen ||
        s.dashboardOpen ||
        s.trashOpen ||
        s.remoteDialogOpen ||
        s.batchRenameOpen ||
        s.compareMirrorConfirm ||
        s.dedupOpen ||
        s.queuePanelOpen ||
        s.contextMenu ||
        s.renameTarget ||
        s.quickLookPath
      ) {
        return
      }
      s.paletteOpen = true
      s.inputContext = 'dialog'
    })
  },

  closePalette() {
    set((s) => {
      s.paletteOpen = false
      if (
        !s.confirmDelete &&
        !s.renameTarget &&
        !s.settingsOpen &&
        !s.dashboardOpen &&
        !s.workspaceOpen &&
        !s.trashOpen &&
        !s.remoteDialogOpen &&
        !s.batchRenameOpen &&
        !s.dedupOpen &&
        !s.queuePanelOpen &&
        !s.quickLookPath
      ) {
        s.inputContext = 'list'
      }
    })
  },

  openQuickLook(path) {
    set((s) => {
      // 다른 모달이 떠 있으면 무시(모달 우선). 빈 경로는 무동작.
      if (!path) return
      if (
        s.confirmDelete ||
        s.settingsOpen ||
        s.workspaceOpen ||
        s.dashboardOpen ||
        s.trashOpen ||
        s.remoteDialogOpen ||
        s.batchRenameOpen ||
        s.compareMirrorConfirm ||
        s.dedupOpen ||
        s.queuePanelOpen ||
        s.contextMenu ||
        s.renameTarget ||
        s.paletteOpen
      ) {
        return
      }
      s.quickLookPath = path
      s.inputContext = 'dialog'
    })
  },

  closeQuickLook() {
    set((s) => {
      s.quickLookPath = null
      if (
        !s.confirmDelete &&
        !s.renameTarget &&
        !s.settingsOpen &&
        !s.dashboardOpen &&
        !s.workspaceOpen &&
        !s.trashOpen &&
        !s.remoteDialogOpen &&
        !s.batchRenameOpen &&
        !s.dedupOpen &&
        !s.queuePanelOpen &&
        !s.paletteOpen
      ) {
        s.inputContext = 'list'
      }
    })
  },

  setClipboardHasFiles(v) {
    set((s) => {
      s.clipboardHasFiles = v
    })
  },

  setInputContext(ctx) {
    set((s) => {
      s.inputContext = ctx
    })
  },

  setAddressEditing(editing) {
    set((s) => {
      s.addressEditing = editing
      s.inputContext = editing ? 'addressEdit' : 'list'
    })
  },

  pushToast(kind, message) {
    toastSeq += 1
    const id = `toast-${toastSeq}`
    set((s) => {
      s.toasts.push({ id, kind, message })
      if (s.toasts.length > 4) s.toasts.shift()
    })
  },

  dismissToast(id) {
    set((s) => {
      s.toasts = s.toasts.filter((t) => t.id !== id)
    })
  },

  toggleShortcutHelp() {
    set((s) => {
      s.shortcutHelpOpen = !s.shortcutHelpOpen
    })
  },

  openConfirmDelete(paths, reason) {
    set((s) => {
      s.confirmDelete = { paths: [...paths], ...(reason ? { reason } : {}) }
      s.inputContext = 'dialog'
    })
  },

  closeConfirmDelete() {
    set((s) => {
      s.confirmDelete = null
      // 다른 다이얼로그가 없으면 list 로 복귀.
      if (!s.renameTarget) s.inputContext = 'list'
    })
  },

  startRename(target) {
    set((s) => {
      s.renameTarget = target
      s.inputContext = 'rename'
    })
  },

  endRename() {
    set((s) => {
      s.renameTarget = null
      if (!s.confirmDelete) s.inputContext = 'list'
    })
  },

  openContextMenu(menu) {
    set((s) => {
      // 모달(영구삭제 확인·설정·워크스페이스·대시보드·휴지통)·이름편집 중에는 컨텍스트 메뉴를 열지 않는다.
      if (
        s.confirmDelete ||
        s.settingsOpen ||
        s.workspaceOpen ||
        s.dashboardOpen ||
        s.trashOpen ||
        s.remoteDialogOpen ||
        s.batchRenameOpen ||
        s.compareMirrorConfirm ||
        s.dedupOpen ||
        s.queuePanelOpen ||
        s.renameTarget
      ) {
        return
      }
      s.contextMenu = menu
      s.inputContext = 'dialog'
    })
  },

  closeContextMenu() {
    set((s) => {
      s.contextMenu = null
      // 다른 다이얼로그/편집이 없으면 list 로 복귀.
      if (
        !s.confirmDelete &&
        !s.renameTarget &&
        !s.settingsOpen &&
        !s.workspaceOpen &&
        !s.dashboardOpen &&
        !s.trashOpen
      ) {
        s.inputContext = 'list'
      }
    })
  }
})
