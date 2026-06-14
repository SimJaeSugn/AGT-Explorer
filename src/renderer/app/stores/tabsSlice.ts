/**
 * tabsSlice — 창→탭→레이아웃→패널 계층 상태 (SA §2.1, §5.2).
 *
 * - 탭 추가/닫기/전환/복제/복원(closedHistory), N번째 탭 선택.
 * - 레이아웃 단일/2분할 토글, 활성 패널 포커스 이동(순환·방향).
 * - 패널 생성/삭제는 panelsSlice·selectionSlice 와 협력(get() 으로 호출).
 *
 * 불변식: 탭 N개에서 activePanelId 는 정확히 하나(SA §2.2). 마지막 탭을
 * 닫으면 "내 PC" 기본 탭을 유지한다(roadmap P3 DoD).
 *
 * Immer 적용(중첩 깊음). closedHistory 는 휘발(세션 비직렬화, SA §5.1).
 */
import type { ClosedTabRecord, Tab } from '@renderer/domain/entities'
import { SPLIT_MIN_RATIO } from '@renderer/domain/entities'
import type { LayoutKind, WindowSnapshot } from '@shared/dto'
import { MY_PC_PATH, isMyPc, normalizeDisplay } from '@renderer/domain/paths'
import type { SliceCreator } from './types'

let idCounter = 0
function nextId(prefix: string): string {
  idCounter += 1
  return `${prefix}-${idCounter}-${Date.now().toString(36)}`
}

export interface TabsSlice {
  /** tabId → Tab. */
  readonly tabs: Record<string, Tab>
  /** 탭 순서(탭바 렌더·Ctrl+1~9·드래그 순서). */
  readonly tabOrder: string[]
  /** 활성 탭. */
  readonly activeTabId: string
  /** 닫은 탭 복원 스택(휘발). */
  readonly closedHistory: ClosedTabRecord[]

  // 부트스트랩 ───────────────────────────────────────────────────────────
  /** 최초 기본 탭("내 PC") 생성. App 부팅 시 1회. */
  initDefaultTab(): void
  /**
   * 워크스페이스 로드 전 정리(P6c [중대-2]). 모든 탭/패널/선택 엔트리를 비운다.
   * restoreWindows(누적형, 부팅 전제)가 깨끗한 상태 위에 복원하도록 보장하는
   * 정리 액션. loadWorkspace 가 applySnapshot 직전에 호출한다(부팅은 빈 상태라 불필요).
   */
  resetWorkspace(): void
  /**
   * 세션 복원: WindowSnapshot 의 탭/패널/레이아웃/정렬·보기·히스토리를 재구성.
   * 첫 창(windows[0])만 단일 창 모델에 매핑한다(MVP 단일 창). 휘발 상태
   * (선택·진행작업·closedHistory·스트림)는 복원하지 않는다(SA §5.1).
   * @returns 복원 성공 여부(스냅샷이 비었으면 false → 호출자가 기본 탭).
   */
  restoreWindows(windows: WindowSnapshot[]): boolean

  // 탭 ──────────────────────────────────────────────────────────────────
  /** 새 탭(기본 "내 PC" 단일 레이아웃). */
  newTab(path?: string): void
  /** 탭 닫기(현재 탭 기본). 마지막 탭이면 기본 탭으로 리셋. */
  closeTab(tabId?: string): void
  /** 닫은 탭 복원(Ctrl+Shift+T). */
  reopenTab(): void
  /** 탭 복제(동일 경로·레이아웃 새 탭). */
  duplicateTab(tabId?: string): void
  /** 탭 활성화. */
  activateTab(tabId: string): void
  /** 다음/이전 탭(Ctrl+Tab). */
  nextTab(): void
  prevTab(): void
  /** N번째 탭(1-base, Ctrl+1~9). 없으면 무시. */
  selectTabByIndex(n: number): void
  /** 탭 순서 이동(드래그). */
  moveTab(tabId: string, toIndex: number): void

  // 탭 메타(Feature A 이름 · US-20.3 색상/잠금) ─────────────────────────────
  /**
   * 사용자 지정 탭 이름 설정(Feature A). trim 후 빈 문자열이면 clearTabName 과
   * 동일하게 자동 제목(폴더명)으로 복귀시킨다. 신규 채널 0(렌더러 store 전용).
   */
  setTabName(tabId: string, name: string): void
  /** 사용자 지정 이름 제거 → 자동 제목 복귀. */
  clearTabName(tabId: string): void
  /** 탭 색상 라벨 설정(TAG_PALETTE 키). undefined 면 색상 제거. */
  setTabColor(tabId: string, key: string | undefined): void
  /** 탭 잠금 토글(US-20.3). 잠긴 탭은 closeTab 가드. */
  toggleTabLock(tabId: string): void

  // 레이아웃 / 포커스 ────────────────────────────────────────────────────
  /** 2분할 토글(single ↔ split-2-h). */
  toggleSplit2(tabId?: string): void
  /**
   * 4분할 토글(single/split-2 ↔ grid-4, P6a US-1.4). grid-4 진입 시 부족한
   * 패널을 활성 패널 경로로 채워 panelIds 를 4개로 맞춘다(row-major:
   * 0=패널1/좌상,1=패널2/우상,2=패널3/좌하,3=패널4/우하). grid-4 에서 호출하면 single 로 복귀한다.
   */
  toggleGrid4(tabId?: string): void
  /** 활성 패널을 다음 패널로 순환(Tab). */
  focusNextPanel(): void
  /**
   * 방향 패널 포커스(Ctrl+←/→). 2분할에서 left=첫째, right=둘째.
   * grid-4(2x2)에서는 같은 행 내 수평 이동(left=현재 행의 좌열, right=우열).
   */
  focusPanelDir(dir: 'left' | 'right' | 'up' | 'down'): void
  /**
   * 번호로 패널 활성화(Alt+1~4). n 은 1-based 위치(패널 1=panelIds[0]/좌상 …).
   * 해당 번호의 패널이 없으면(단일 레이아웃·범위 밖) 무시한다.
   */
  focusPanelByIndex(n: number): void
  /** 특정 패널을 활성으로(클릭 포커스). */
  setActivePanel(tabId: string, panelId: string): void

  /**
   * 분할 비율 설정(H-4, 클램프 0.15~0.85). axis 별 1축 갱신, 더블클릭 복귀는
   * 0.5 를 전달한다. 미설정 탭은 {col:0.5,row:0.5} 기본에서 시작.
   */
  setSplitRatio(tabId: string, axis: 'col' | 'row', ratio: number): void

  // 파생 셀렉터 헬퍼 ─────────────────────────────────────────────────────
  /** 현재 활성 탭. */
  activeTab(): Tab | undefined
  /** 현재 활성 패널 id. */
  activePanelId(): string | undefined
}

export const createTabsSlice: SliceCreator<TabsSlice> = (set, get) => {
  /** 새 탭 1개를 만들어 패널까지 구성한다(공통). */
  function buildTab(layout: LayoutKind, panelPaths: string[], activeIdx: number): Tab {
    const tabId = nextId('tab')
    const panelIds = panelPaths.map(() => nextId('panel'))
    // 패널 슬라이스에 등록(스트림 적재 시작).
    panelPaths.forEach((p, i) => {
      get().addPanel(panelIds[i] as string, p)
      get().resetSelection(panelIds[i] as string)
    })
    return {
      id: tabId,
      layout,
      panelIds,
      activePanelId: panelIds[Math.min(activeIdx, panelIds.length - 1)] as string
    }
  }

  function insertTab(tab: Tab, activate: boolean): void {
    set((s) => {
      s.tabs[tab.id] = tab
      s.tabOrder.push(tab.id)
      if (activate) s.activeTabId = tab.id
    })
  }

  /** 탭의 패널들을 슬라이스에서 정리한다. */
  function disposeTabPanels(tab: Tab): void {
    for (const pid of tab.panelIds) {
      get().removePanel(pid)
      get().dropSelection(pid)
    }
  }

  return {
    tabs: {},
    tabOrder: [],
    activeTabId: '',
    closedHistory: [],

    initDefaultTab() {
      if (get().tabOrder.length > 0) return
      const tab = buildTab('single', [MY_PC_PATH], 0)
      insertTab(tab, true)
    },

    resetWorkspace() {
      // 모든 탭의 패널/선택 슬라이스 엔트리 정리 후 탭 상태 비우기.
      const tabs = get().tabs
      for (const tab of Object.values(tabs)) {
        disposeTabPanels(tab)
      }
      set((s) => {
        s.tabs = {}
        s.tabOrder = []
        s.activeTabId = ''
      })
    },

    restoreWindows(windows) {
      const win = windows[0]
      if (!win || win.tabs.length === 0) return false

      let activeTabId = ''
      for (const tabSnap of win.tabs) {
        if (tabSnap.panels.length === 0) continue
        const tabId = nextId('tab')
        const panelIds = tabSnap.panels.map(() => nextId('panel'))
        // 패널 생성(재스캔 시작) 후 저장된 뷰/히스토리 주입.
        tabSnap.panels.forEach((pn, i) => {
          const pid = panelIds[i] as string
          get().addPanel(pid, pn.path)
          get().resetSelection(pid)
          get().applyPanelState(pid, {
            view: {
              viewMode: pn.viewMode,
              sortKey: pn.sortKey,
              sortDir: pn.sortDir,
              folderFirst: true
            },
            nav: { back: [...pn.history.back], forward: [...pn.history.forward] },
            scrollTop: pn.scrollTop
          })
        })
        // 저장된 activePanelId 의 인덱스를 새 panelId 로 매핑.
        const activeIdx = Math.max(
          0,
          tabSnap.panels.findIndex((p) => p.id === tabSnap.activePanelId)
        )
        const tab: Tab = {
          id: tabId,
          layout: tabSnap.layout,
          panelIds,
          activePanelId: panelIds[Math.min(activeIdx, panelIds.length - 1)] as string,
          // H-6: 분할 비율 복원(있으면). 누락/손상은 main coerce 가 1차 정규화.
          ...(tabSnap.splitRatios ? { splitRatios: tabSnap.splitRatios } : {}),
          // 탭 메타 복원(Feature A 이름 · US-20.3 색상/잠금). 누락은 main coerce 가 생략.
          ...(tabSnap.customName ? { customName: tabSnap.customName } : {}),
          ...(tabSnap.color ? { color: tabSnap.color } : {}),
          ...(tabSnap.locked ? { locked: true } : {}),
          ...(tabSnap.locked && tabSnap.lockedRoot ? { lockedRoot: tabSnap.lockedRoot } : {})
        }
        insertTab(tab, false)
        if (tabSnap.id === win.activeTabId) activeTabId = tabId
      }

      if (get().tabOrder.length === 0) return false
      set((s) => {
        s.activeTabId = activeTabId || (s.tabOrder[0] as string)
      })
      return true
    },

    newTab(path) {
      // 인자 없이 호출(새 탭 버튼·Ctrl+T)되면 설정된 기본 시작 위치를 쓴다(없으면 내 PC).
      // "E:" 같은 드라이브 루트 입력은 normalizeDisplay 로 "E:\\" 보정해 load 가 인식하게 한다.
      const raw = path !== undefined ? path : get().startLocation || MY_PC_PATH
      const target = raw && !isMyPc(raw) ? normalizeDisplay(raw) : MY_PC_PATH
      const tab = buildTab('single', [target], 0)
      insertTab(tab, true)
    },

    closeTab(tabId) {
      const id = tabId ?? get().activeTabId
      const tab = get().tabs[id]
      if (!tab) return

      // US-20.3 닫기 가드: 잠긴 탭은 실수 닫기 방지(거부 + 안내 토스트).
      // 먼저 잠금을 해제해야 닫을 수 있다(가운데클릭·×·Ctrl+W·close others 공통 경로).
      if (tab.locked) {
        get().pushToast('info', '잠긴 탭입니다. 먼저 잠금을 해제하세요.')
        return
      }

      // 닫은 탭 스냅샷을 복원 스택에 적재(휘발).
      const panels = get().panels
      const record: ClosedTabRecord = {
        layout: tab.layout,
        activePanelIndex: Math.max(0, tab.panelIds.indexOf(tab.activePanelId)),
        panels: tab.panelIds.map((pid) => {
          const p = panels[pid]
          return {
            path: p?.path ?? MY_PC_PATH,
            view: p?.view ?? {
              viewMode: 'details',
              sortKey: 'name',
              sortDir: 'asc',
              folderFirst: true
            }
          }
        })
      }

      disposeTabPanels(tab)

      const order = get().tabOrder
      const idx = order.indexOf(id)
      const isLast = order.length === 1

      set((s) => {
        s.closedHistory.push(record)
        if (s.closedHistory.length > 20) s.closedHistory.shift()
        delete s.tabs[id]
        s.tabOrder = s.tabOrder.filter((t) => t !== id)
      })

      if (isLast) {
        // 마지막 탭: "내 PC" 기본 탭 유지(roadmap P3 DoD).
        const tab2 = buildTab('single', [MY_PC_PATH], 0)
        insertTab(tab2, true)
      } else if (get().activeTabId === id) {
        // 인접 탭으로 활성 이동.
        const newOrder = get().tabOrder
        const nextActive = newOrder[Math.min(idx, newOrder.length - 1)] as string
        set((s) => {
          s.activeTabId = nextActive
        })
      }
    },

    reopenTab() {
      const rec = get().closedHistory[get().closedHistory.length - 1]
      if (!rec) return
      set((s) => {
        s.closedHistory.pop()
      })
      const tabId = nextId('tab')
      const panelIds = rec.panels.map(() => nextId('panel'))
      rec.panels.forEach((pn, i) => {
        const pid = panelIds[i] as string
        get().addPanel(pid, pn.path)
        get().resetSelection(pid)
        // 복원된 뷰 상태 전체 반영(viewMode 뿐 아니라 sortKey/sortDir/folderFirst — 캡처값 보존).
        get().applyPanelState(pid, {
          view: { ...pn.view },
          nav: { back: [], forward: [] },
          scrollTop: 0
        })
      })
      const tab: Tab = {
        id: tabId,
        layout: rec.layout,
        panelIds,
        activePanelId: panelIds[
          Math.min(rec.activePanelIndex, panelIds.length - 1)
        ] as string
      }
      insertTab(tab, true)
    },

    duplicateTab(tabId) {
      const id = tabId ?? get().activeTabId
      const tab = get().tabs[id]
      if (!tab) return
      const panels = get().panels
      const paths = tab.panelIds.map((pid) => panels[pid]?.path ?? MY_PC_PATH)
      const activeIdx = Math.max(0, tab.panelIds.indexOf(tab.activePanelId))
      const dup = buildTab(tab.layout, paths, activeIdx)
      insertTab(dup, true)
    },

    activateTab(tabId) {
      if (!get().tabs[tabId]) return
      set((s) => {
        s.activeTabId = tabId
      })
    },

    nextTab() {
      const order = get().tabOrder
      if (order.length <= 1) return
      const idx = order.indexOf(get().activeTabId)
      const next = order[(idx + 1) % order.length] as string
      set((s) => {
        s.activeTabId = next
      })
    },

    prevTab() {
      const order = get().tabOrder
      if (order.length <= 1) return
      const idx = order.indexOf(get().activeTabId)
      const prev = order[(idx - 1 + order.length) % order.length] as string
      set((s) => {
        s.activeTabId = prev
      })
    },

    selectTabByIndex(n) {
      const order = get().tabOrder
      const target = order[n - 1]
      if (!target) return
      set((s) => {
        s.activeTabId = target
      })
    },

    moveTab(tabId, toIndex) {
      set((s) => {
        const from = s.tabOrder.indexOf(tabId)
        if (from < 0) return
        s.tabOrder.splice(from, 1)
        const clamped = Math.max(0, Math.min(toIndex, s.tabOrder.length))
        s.tabOrder.splice(clamped, 0, tabId)
      })
    },

    setTabName(tabId, name) {
      const trimmed = name.trim()
      set((s) => {
        const t = s.tabs[tabId]
        if (!t) return
        // 빈/공백 입력은 사용자 지정 이름 제거(자동 제목 복귀).
        if (trimmed === '') delete t.customName
        else t.customName = trimmed
      })
    },

    clearTabName(tabId) {
      set((s) => {
        const t = s.tabs[tabId]
        if (!t) return
        delete t.customName
      })
    },

    setTabColor(tabId, key) {
      set((s) => {
        const t = s.tabs[tabId]
        if (!t) return
        // undefined/빈값이면 색상 제거(키 자체 삭제 — 직렬화 안정).
        if (!key) delete t.color
        else t.color = key
      })
    },

    toggleTabLock(tabId) {
      // 잠글 때 그 시점 활성 패널 경로를 루트로 고정(백로그 ①). 해제 시 루트도 함께 제거.
      const tabNow = get().tabs[tabId]
      const rootAtLock = tabNow ? get().panels[tabNow.activePanelId]?.path : undefined
      set((s) => {
        const t = s.tabs[tabId]
        if (!t) return
        // true 일 때만 보관(false 는 키 삭제 → 직렬화 안정·미잠금 동치).
        if (t.locked) {
          delete t.locked
          delete t.lockedRoot
        } else {
          t.locked = true
          // 활성 패널 경로를 루트로 고정(없으면 미설정 = 제약 없음).
          if (rootAtLock) t.lockedRoot = rootAtLock
        }
      })
    },

    toggleSplit2(tabId) {
      const id = tabId ?? get().activeTabId
      const tab = get().tabs[id]
      if (!tab) return
      // §P1: 레이아웃이 바뀌면 폴더 비교 모드 종료(2분할 전제가 깨짐).
      if (get().compareActive) get().clearCompare()

      if (tab.layout === 'single') {
        // 2분할로: 둘째 패널을 첫째와 같은 경로로 생성.
        const firstPanel = get().panels[tab.panelIds[0] as string]
        const newPath = firstPanel?.path ?? MY_PC_PATH
        const newPanelId = nextId('panel')
        get().addPanel(newPanelId, newPath)
        get().resetSelection(newPanelId)
        set((s) => {
          const t = s.tabs[id]
          if (!t) return
          t.layout = 'split-2-h'
          t.panelIds.push(newPanelId)
        })
      } else if (tab.layout === 'split-2-h' || tab.layout === 'split-2-v') {
        // 단일로: 활성 패널만 남기고 나머지 정리.
        const keep = tab.activePanelId
        const drop = tab.panelIds.filter((p) => p !== keep)
        for (const pid of drop) {
          get().removePanel(pid)
          get().dropSelection(pid)
        }
        set((s) => {
          const t = s.tabs[id]
          if (!t) return
          t.layout = 'single'
          t.panelIds = [keep]
          t.activePanelId = keep
        })
      }
    },

    toggleGrid4(tabId) {
      const id = tabId ?? get().activeTabId
      const tab = get().tabs[id]
      if (!tab) return
      // §P1: 레이아웃이 바뀌면 폴더 비교 모드 종료(2분할 전제가 깨짐).
      if (get().compareActive) get().clearCompare()

      if (tab.layout === 'grid-4') {
        // 단일로 복귀: 활성 패널만 남기고 나머지 정리(toggleSplit2 와 동일).
        const keep = tab.activePanelId
        const drop = tab.panelIds.filter((p) => p !== keep)
        for (const pid of drop) {
          get().removePanel(pid)
          get().dropSelection(pid)
        }
        set((s) => {
          const t = s.tabs[id]
          if (!t) return
          t.layout = 'single'
          t.panelIds = [keep]
          t.activePanelId = keep
        })
        return
      }

      // grid-4 진입: 부족한 패널을 활성 패널 경로로 복제해 4개로 맞춘다.
      const activePath = get().panels[tab.activePanelId]?.path ?? MY_PC_PATH
      const need = 4 - tab.panelIds.length
      const added: string[] = []
      for (let i = 0; i < need; i++) {
        const newPanelId = nextId('panel')
        get().addPanel(newPanelId, activePath)
        get().resetSelection(newPanelId)
        added.push(newPanelId)
      }
      set((s) => {
        const t = s.tabs[id]
        if (!t) return
        t.layout = 'grid-4'
        t.panelIds = [...t.panelIds, ...added]
      })
    },

    focusNextPanel() {
      const tab = get().activeTab()
      if (!tab || tab.panelIds.length <= 1) return
      const idx = tab.panelIds.indexOf(tab.activePanelId)
      const next = tab.panelIds[(idx + 1) % tab.panelIds.length] as string
      set((s) => {
        const t = s.tabs[tab.id]
        if (t) t.activePanelId = next
      })
    },

    focusPanelDir(dir) {
      const tab = get().activeTab()
      if (!tab || tab.panelIds.length <= 1) return

      let target: string | undefined
      if (tab.layout === 'grid-4' && tab.panelIds.length === 4) {
        // 2x2 row-major: 인덱스 i → (row=⌊i/2⌋, col=i%2). 같은 행 내 수평 이동.
        const i = Math.max(0, tab.panelIds.indexOf(tab.activePanelId))
        const row = Math.floor(i / 2)
        let col = i % 2
        if (dir === 'left') col = 0
        else if (dir === 'right') col = 1
        else if (dir === 'up') return // 상/하 키는 미도입(PRD §8) — 무변.
        else if (dir === 'down') return
        target = tab.panelIds[row * 2 + col]
      } else {
        // 2분할: 좌=index0, 우=마지막. up/down 은 무변.
        if (dir === 'up' || dir === 'down') return
        target = dir === 'left' ? tab.panelIds[0] : tab.panelIds[tab.panelIds.length - 1]
      }
      if (!target) return
      set((s) => {
        const t = s.tabs[tab.id]
        if (t) t.activePanelId = target
      })
    },

    focusPanelByIndex(n) {
      const tab = get().activeTab()
      if (!tab || tab.panelIds.length <= 1) return
      const target = tab.panelIds[n - 1]
      if (!target || target === tab.activePanelId) return
      set((s) => {
        const t = s.tabs[tab.id]
        if (t) t.activePanelId = target
      })
    },

    setActivePanel(tabId, panelId) {
      const tab = get().tabs[tabId]
      if (!tab || !tab.panelIds.includes(panelId)) return
      set((s) => {
        const t = s.tabs[tabId]
        if (t && t.activePanelId !== panelId) {
          t.activePanelId = panelId
          // 패널이 실제로 바뀌면 주소 편집 모드를 해제한다 — addressEditing 은 전역 플래그라
          // 새로 활성화된 패널이 자동으로 주소창 편집/포커스 상태가 되는 것을 막는다(수동 진입만 허용).
          s.addressEditing = false
        }
      })
    },

    setSplitRatio(tabId, axis, ratio) {
      const clamped = Math.max(SPLIT_MIN_RATIO, Math.min(1 - SPLIT_MIN_RATIO, ratio))
      set((s) => {
        const t = s.tabs[tabId]
        if (!t) return
        const cur = t.splitRatios ?? { col: 0.5, row: 0.5 }
        t.splitRatios = { ...cur, [axis]: clamped }
      })
    },

    activeTab() {
      return get().tabs[get().activeTabId]
    },

    activePanelId() {
      return get().activeTab()?.activePanelId
    }
  }
}
