/**
 * session 유스케이스 (P5b, US-5.5) — 자동 세션복원 + 디바운스 저장.
 *
 * - buildSessionSnapshot(): 직렬화 가능한 상태만 모아 SessionSnapshot 생성.
 *     포함: 창/탭/레이아웃/패널(경로·정렬·보기·히스토리·스크롤), 사이드바
 *           (즐겨찾기·별칭·최근·폭·접힘), ui(theme·previewOpen·previewWidth).
 *     **휘발 제외(SA §5.1)**: selection, directory(스트림/엔트리), operations
 *           (진행 op), conflictQueue, closedHistory, dragOp, renameTarget,
 *           confirmDelete, toasts, inputContext, addressEditing.
 * - restoreSession(): 부팅 시 session:load → 탭/사이드바 복원. 스냅샷 없음/
 *     손상이면 기본 "내 PC" 탭(크래시 프리, Main coerce 가 1차 폴백).
 * - startSessionAutosave(): 스토어 구독 → 디바운스 후 session:save.
 *     before-quit flush 는 Main(persistence) 책임(SA §5.3).
 *
 * app → infra/api 직접 호출(.eslintrc 허용).
 */
import type { PanelSnapshot, SessionSnapshot, TabSnapshot, WindowSnapshot } from '@shared/dto'
import { SESSION_SCHEMA_VERSION } from '@renderer/domain/session'
import { sessionApi } from '@renderer/infra/api'
import { store } from '@renderer/app/stores/rootStore'

/** 현재 스토어 상태에서 직렬화 가능한 세션 스냅샷을 만든다(휘발 제외). */
export function buildSessionSnapshot(): SessionSnapshot {
  const s = store.getState()

  const tabs: TabSnapshot[] = s.tabOrder
    .map((tabId): TabSnapshot | null => {
      const tab = s.tabs[tabId]
      if (!tab) return null
      const panels: PanelSnapshot[] = tab.panelIds
        .map((pid): PanelSnapshot | null => {
          const p = s.panels[pid]
          if (!p) return null
          return {
            id: pid,
            path: p.path,
            sortKey: p.view.sortKey,
            sortDir: p.view.sortDir,
            viewMode: p.view.viewMode,
            history: { back: [...p.nav.back], forward: [...p.nav.forward] },
            scrollTop: p.scrollTop
          }
        })
        .filter((p): p is PanelSnapshot => p !== null)
      if (panels.length === 0) return null
      return {
        id: tabId,
        activePanelId: tab.activePanelId,
        layout: tab.layout,
        panels,
        // H-6: 분할 비율 직렬화(undefined 면 생략 → 직렬화 안정).
        ...(tab.splitRatios ? { splitRatios: tab.splitRatios } : {})
      }
    })
    .filter((t): t is TabSnapshot => t !== null)

  const window: WindowSnapshot = { tabs, activeTabId: s.activeTabId }

  return {
    version: SESSION_SCHEMA_VERSION,
    windows: tabs.length > 0 ? [window] : [],
    sidebar: {
      favorites: [...s.favorites],
      favoriteLabels: { ...s.favoriteLabels },
      recent: [...s.recent],
      width: s.sidebarWidth,
      collapsed: s.sidebarCollapsed
    },
    ui: { theme: s.theme, previewOpen: s.previewOpen, previewWidth: s.previewWidth }
  }
}

/**
 * 스냅샷을 현재 스토어에 적용하는 공통 복원 경로(P6c [중대-2]).
 * 사이드바 → 탭/패널(restoreWindows) → ui(previewOpen)를 순서대로 복원한다.
 * 부팅(restoreSession)과 워크스페이스 로드(loadWorkspace)가 **동일 경로**를
 * 타도록 단일화한다(중복 구현 금지). 정리(reset)는 호출자 책임이며,
 * 부팅은 빈 상태 전제라 reset 불필요, loadWorkspace 는 resetWorkspace() 선행.
 * @returns 탭 복원 성공 여부(restoreWindows 결과).
 */
export function applySnapshot(snap: SessionSnapshot): boolean {
  const s = store.getState()
  // 사이드바(즐겨찾기·최근·폭·접힘) 먼저 복원 → recentLimit 적용.
  s.hydrateSidebar({
    favorites: snap.sidebar.favorites,
    ...(snap.sidebar.favoriteLabels ? { favoriteLabels: snap.sidebar.favoriteLabels } : {}),
    recent: snap.sidebar.recent,
    width: snap.sidebar.width,
    collapsed: snap.sidebar.collapsed
  })
  const restored = s.restoreWindows(snap.windows)
  // ui(previewOpen·previewWidth) 복원(테마는 settings 채널이 별도 관리).
  store.getState().setPreviewOpen(snap.ui.previewOpen)
  store.getState().setPreviewWidth(snap.ui.previewWidth ?? 320)
  return restored
}

/**
 * 부팅 시 세션 복원. 저장된 스냅샷이 있으면 탭/사이드바를 복원하고,
 * 없거나 비정상이면 기본 "내 PC" 탭으로 부팅한다(크래시 프리).
 * @returns 복원 성공 여부.
 */
export async function restoreSession(): Promise<boolean> {
  let restored = false
  try {
    const res = await sessionApi.load()
    if (res.ok) {
      // 부팅은 빈 상태 전제 → reset 없이 공통 applySnapshot 경로로 복원.
      restored = applySnapshot(res.value)
    }
  } catch {
    restored = false
  }
  if (!restored) {
    // 스냅샷 없음/손상 → 첫 실행 기본 탭(내 PC 또는 설정 startLocation).
    const start = store.getState().startLocation
    if (start) store.getState().newTab(start)
    else store.getState().initDefaultTab()
  }
  return restored
}

/** 직전 저장 직렬화(중복 저장 억제용). */
let lastSerialized = ''
let saveTimer: ReturnType<typeof setTimeout> | null = null

/**
 * 스토어 변경을 구독해 디바운스(기본 800ms) 후 session:save.
 * 휘발 상태 변경(선택·스트림 청크·진행률)은 buildSessionSnapshot 이 제외하므로
 * 직렬화 결과가 동일하면 저장을 건너뛴다(불필요 IO 억제).
 * @returns 구독 해제 함수.
 */
export function startSessionAutosave(debounceMs = 800): () => void {
  const schedule = (): void => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      const snapshot = buildSessionSnapshot()
      const serialized = JSON.stringify(snapshot)
      if (serialized === lastSerialized) return
      lastSerialized = serialized
      void sessionApi.save(snapshot)
    }, debounceMs)
  }
  // 초기 직렬화 기준 설정(부팅 직후 불필요 저장 방지).
  lastSerialized = JSON.stringify(buildSessionSnapshot())
  const unsub = store.subscribe(schedule)
  return () => {
    if (saveTimer) clearTimeout(saveTimer)
    unsub()
  }
}
