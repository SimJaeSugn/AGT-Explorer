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
 *     **현재 워크스페이스가 선택된 상태(currentWorkspace)면 같은 스냅샷을 해당
 *     워크스페이스 파일에도 기록한다(자동 저장, US-5.8 확장).**
 *     before-quit flush 는 Main(persistence) 책임(SA §5.3).
 *
 * app → infra/api 직접 호출(.eslintrc 허용).
 */
import type { PanelSnapshot, SessionSnapshot, TabSnapshot, WindowSnapshot } from '@shared/dto'
import { SESSION_SCHEMA_VERSION } from '@renderer/domain/session'
import { sessionApi, workspaceApi } from '@renderer/infra/api'
import { store } from '@renderer/app/stores/rootStore'

/**
 * 탭 1개를 직렬화 가능한 TabSnapshot 으로 추출한다(휘발 제외). buildSessionSnapshot
 * 의 탭 직렬화 로직과 동일 규약(단일 출처) — U3 탭 분리(window:split-tab)가 이
 * 헬퍼로 넘길 탭 1개를 만든다. 패널이 하나도 없으면 null(분리 불가).
 */
export function buildTabSnapshot(tabId: string): TabSnapshot | null {
  const s = store.getState()
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
    ...(tab.splitRatios ? { splitRatios: tab.splitRatios } : {}),
    // 탭 메타 직렬화(Feature A 이름 · US-20.3 색상/잠금). 미설정은 생략(스키마 미상향·비파괴).
    ...(tab.customName ? { customName: tab.customName } : {}),
    ...(tab.color ? { color: tab.color } : {}),
    ...(tab.locked ? { locked: true } : {}),
    ...(tab.locked && tab.lockedRoot ? { lockedRoot: tab.lockedRoot } : {})
  }
}

/** 현재 스토어 상태에서 직렬화 가능한 세션 스냅샷을 만든다(휘발 제외). */
export function buildSessionSnapshot(): SessionSnapshot {
  const s = store.getState()

  const tabs: TabSnapshot[] = s.tabOrder
    .map((tabId) => buildTabSnapshot(tabId))
    .filter((t): t is TabSnapshot => t !== null)

  const window: WindowSnapshot = { tabs, activeTabId: s.activeTabId }

  return {
    version: SESSION_SCHEMA_VERSION,
    windows: tabs.length > 0 ? [window] : [],
    // 현재 선택 워크스페이스(자동 저장 대상). 미선택은 키 생략(비파괴·구버전 호환).
    ...(s.currentWorkspace ? { currentWorkspace: s.currentWorkspace } : {}),
    sidebar: {
      favorites: [...s.favorites],
      favoriteLabels: { ...s.favoriteLabels },
      pinnedByDir: { ...s.pinnedByDir },
      // T1: 파일 태그 라벨(path→키 배열). coerce 가 폴백 보장(스키마 미상향).
      tagsByPath: { ...s.tagsByPath },
      recent: [...s.recent],
      width: s.sidebarWidth,
      collapsed: s.sidebarCollapsed
    },
    ui: {
      theme: s.theme,
      previewOpen: s.previewOpen,
      previewWidth: s.previewWidth,
      // 자세히 보기 열 너비(전역). 항상 직렬화(기본값과 동일해도 안정 — coerce 가 폴백 보장).
      detailsColumnWidths: { ...s.detailsColumnWidths }
    }
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
    ...(snap.sidebar.pinnedByDir ? { pinnedByDir: snap.sidebar.pinnedByDir } : {}),
    recent: snap.sidebar.recent,
    width: snap.sidebar.width,
    collapsed: snap.sidebar.collapsed
  })
  // T1: 파일 태그 라벨 복원(누락/손상은 hydrateTags 가 빈 맵 폴백 — 스키마 미상향).
  s.hydrateTags(snap.sidebar.tagsByPath)
  const restored = s.restoreWindows(snap.windows)
  // ui(previewOpen·previewWidth·열너비) 복원(테마는 settings 채널이 별도 관리).
  store.getState().setPreviewOpen(snap.ui.previewOpen)
  store.getState().setPreviewWidth(snap.ui.previewWidth ?? 320)
  // 자세히 보기 열 너비(전역). 누락/손상은 hydrateColumns 가 기본값 폴백(coerce).
  store.getState().hydrateColumns(snap.ui.detailsColumnWidths)
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
      // 선택 워크스페이스 복원(재시작 후에도 자동 저장 지속). 복원 실패 시 미선택
      // 유지 — 기본 탭 폴백 상태가 워크스페이스 파일을 덮어쓰지 않게 한다.
      if (restored) store.getState().setCurrentWorkspace(res.value.currentWorkspace ?? null)
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

// ── 워크스페이스 자동 저장 상태 (StatusBar 노출용 — US-5.8 확장) ──────────
// zustand 스토어에 넣으면 자동저장 구독(store.subscribe)이 상태 갱신으로 자기 자신을
// 다시 깨우는 루프가 생기므로, 구독 경로 밖의 경량 pub/sub(useSyncExternalStore 규약)로 둔다.

/** 워크스페이스 자동 저장 상태. idle=동기화됨(저장 이력 없음), dirty=변경 감지(디바운스 대기). */
export type WorkspaceSaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

/** StatusBar 가 구독하는 자동 저장 상태 스냅샷(불변 교체). */
export interface WorkspaceSaveStatus {
  readonly state: WorkspaceSaveState
  /** 마지막 저장 성공 시각(epoch ms, 없으면 null). */
  readonly savedAt: number | null
}

let wsSaveStatus: WorkspaceSaveStatus = { state: 'idle', savedAt: null }
const wsSaveListeners = new Set<() => void>()

function setWorkspaceSaveStatus(state: WorkspaceSaveState, savedAt?: number | null): void {
  const nextSavedAt = savedAt !== undefined ? savedAt : wsSaveStatus.savedAt
  if (wsSaveStatus.state === state && wsSaveStatus.savedAt === nextSavedAt) return
  wsSaveStatus = { state, savedAt: nextSavedAt }
  for (const l of wsSaveListeners) l()
}

/** 현재 자동 저장 상태(useSyncExternalStore getSnapshot). */
export function getWorkspaceSaveStatus(): WorkspaceSaveStatus {
  return wsSaveStatus
}

/** 자동 저장 상태 구독(useSyncExternalStore subscribe). @returns 해제 함수. */
export function subscribeWorkspaceSaveStatus(listener: () => void): () => void {
  wsSaveListeners.add(listener)
  return () => {
    wsSaveListeners.delete(listener)
  }
}

/** workspace 유스케이스의 명시 저장 결과 반영(저장 성공=saved+시각, 실패=error). */
export function noteWorkspaceSaved(ok: boolean): void {
  setWorkspaceSaveStatus(ok ? 'saved' : 'error', ok ? Date.now() : undefined)
}

/** 선택 직후(불러오기 성공 등) 동기화 상태로 초기화 — 저장 이력 없음(idle). */
export function resetWorkspaceSaveStatus(): void {
  setWorkspaceSaveStatus('idle', null)
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
    // 변경 감지(디바운스 대기) 표시 — 선택 워크스페이스가 있을 때만(StatusBar 노출).
    // 휘발 변경이어도 일단 dirty 로 표시하고, 타이머에서 직렬화 동일이면 복귀한다.
    if (store.getState().currentWorkspace) setWorkspaceSaveStatus('dirty')
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      const snapshot = buildSessionSnapshot()
      const serialized = JSON.stringify(snapshot)
      const current = store.getState().currentWorkspace
      if (serialized === lastSerialized) {
        // 휘발 변경만 있었음(저장 불필요) → 이전 동기화 상태로 복귀.
        if (current) setWorkspaceSaveStatus(wsSaveStatus.savedAt ? 'saved' : 'idle')
        return
      }
      lastSerialized = serialized
      void sessionApi.save(snapshot)
      // 현재 워크스페이스가 선택된 상태면 같은 스냅샷을 워크스페이스 파일에도
      // 기록한다(자동 저장, US-5.8 확장). 실패는 비차단(다음 디바운스에 재시도).
      if (current) {
        setWorkspaceSaveStatus('saving')
        void workspaceApi.save(current, snapshot).then((res) => {
          // 저장 중 새 변경(dirty 재진입)이면 결과를 덮어쓰지 않는다 — 후속 저장이 갱신.
          if (wsSaveStatus.state !== 'saving') return
          setWorkspaceSaveStatus(res.ok ? 'saved' : 'error', res.ok ? Date.now() : undefined)
        })
      } else {
        // 선택 해제 상태 → 표시 초기화(StatusBar 는 미선택이면 숨김).
        setWorkspaceSaveStatus('idle', null)
      }
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
