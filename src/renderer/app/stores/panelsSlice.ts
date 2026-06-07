/**
 * panelsSlice — 패널별 경로·내비게이션·뷰·디렉토리 목록 상태 (SA §5.2).
 *
 * Immer 적용(중첩 깊은 갱신). 스트림 청크는 entries 배열에 append 한다.
 * 디렉토리 로딩(스트리밍)은 navigate() 가 fs:list:start + subscribeListStream 으로
 * 수행한다 → app 계층이 infra/api 를 직접 호출(.eslintrc 허용).
 *
 * 셀렉터 격리(SA §5.2): FileListView 는 자기 panelId 의 directory/view 만 구독한다.
 */
import type {
  DirectoryView,
  NavHistory,
  Panel,
  ViewState
} from '@renderer/domain/entities'
import type { SortKey, ViewMode } from '@shared/dto'
import {
  fsApi,
  subscribeListStream,
  type ListStreamHandlers
} from '@renderer/infra/api'
import { isMyPc, parentOf } from '@renderer/domain/paths'
import type { SliceCreator } from './types'

/** 패널 기본 뷰 상태. */
function defaultView(): ViewState {
  return { viewMode: 'details', sortKey: 'name', sortDir: 'asc', folderFirst: true }
}

/** 빈 디렉토리 뷰(idle). */
function idleDirectory(): DirectoryView {
  return {
    status: 'idle',
    entries: [],
    streamId: null,
    total: 0,
    truncated: false,
    error: null
  }
}

/** 새 패널 1개 생성. */
export function createPanel(id: string, path: string): Panel {
  return {
    id,
    path,
    nav: { back: [], forward: [] },
    view: defaultView(),
    directory: idleDirectory(),
    filter: { query: '', open: false },
    scrollTop: 0
  }
}

/** 스트림 구독 해제 함수 보관(슬라이스 외부 — 비직렬화 자원). */
const streamDisposers = new Map<string, () => void>()

export interface PanelsSlice {
  /** panelId → Panel. */
  readonly panels: Record<string, Panel>

  // 액션 ───────────────────────────────────────────────────────────────
  /** 패널 추가(레이아웃 토글/탭 생성 시 호출). */
  addPanel(id: string, path: string): void
  /** 패널 제거(탭/분할 닫기 시). 진행 스트림도 정리. */
  removePanel(id: string): void
  /**
   * 경로로 이동. pushHistory=true 면 현재 경로를 back 에 적재(forward 비움).
   * fs:list:start → 스트림 구독으로 증분 적재한다.
   */
  navigate(panelId: string, path: string, pushHistory?: boolean): void
  /** 뒤로(back pop). */
  navBack(panelId: string): void
  /** 앞으로(forward pop). */
  navForward(panelId: string): void
  /** 위로(상위 폴더). */
  navUp(panelId: string): void
  /** 현재 경로 새로고침(히스토리 미적재). */
  refresh(panelId: string): void
  /** 모든 패널 재스캔(숨김 파일 토글 등 전역 설정 변경 시). */
  refreshAll(): void
  /** 보기 모드 변경. */
  setViewMode(panelId: string, mode: ViewMode): void
  /** 정렬 변경(같은 키 재클릭 시 방향 토글). */
  setSort(panelId: string, key: SortKey): void
  /** 폴더 우선 토글. */
  toggleFolderFirst(panelId: string): void
  /** 검색창 열기/닫기(P5 본격 사용). */
  setSearchOpen(panelId: string, open: boolean): void
  setSearchQuery(panelId: string, query: string): void
  /** 스크롤 위치 기억. */
  setScrollTop(panelId: string, top: number): void
  /**
   * 세션 복원: 패널의 뷰(정렬·보기)·히스토리·스크롤을 일괄 주입.
   * directory(스트림/엔트리)는 휘발이므로 복원하지 않는다(addPanel 이 재스캔).
   */
  applyPanelState(
    panelId: string,
    state: {
      view: ViewState
      nav: NavHistory
      scrollTop: number
    }
  ): void

  // 스트림 이벤트 진입(infra 브리지가 호출) ──────────────────────────────
  _onChunk(panelId: string, streamId: string, entries: Panel['directory']['entries']): void
  _onDone(panelId: string, streamId: string, total: number, truncated: boolean): void
  _onError(panelId: string, streamId: string, code: string, message: string): void
}

export const createPanelsSlice: SliceCreator<PanelsSlice> = (set, get) => {
  /** 진행 중 스트림을 취소·정리한다. */
  function disposeStream(panelId: string): void {
    const d = streamDisposers.get(panelId)
    if (d) {
      d()
      streamDisposers.delete(panelId)
    }
    const sid = get().panels[panelId]?.directory.streamId
    if (sid) void fsApi.listCancel(sid)
  }

  /** "내 PC"(빈 경로)는 드라이브 목록을 fs:drives 로 적재한다. */
  async function loadMyPc(panelId: string): Promise<void> {
    set((s) => {
      const p = s.panels[panelId]
      if (p) {
        p.directory = {
          status: 'loading',
          entries: [],
          streamId: null,
          total: 0,
          truncated: false,
          error: null
        }
      }
    })
    const res = await fsApi.drives()
    set((s) => {
      const p = s.panels[panelId]
      if (!p || p.path !== '') return
      if (res.ok) {
        const entries = res.value.map((d) => ({
          name: d.label,
          path: d.path,
          isDir: true,
          size: 0,
          mtime: 0,
          ctime: 0,
          ext: '',
          attrs: { hidden: false, readonly: false, system: false, symlink: false }
        }))
        p.directory = {
          status: entries.length === 0 ? 'empty' : 'ready',
          entries,
          streamId: null,
          total: entries.length,
          truncated: false,
          error: null
        }
      } else {
        p.directory = {
          status: 'error',
          entries: [],
          streamId: null,
          total: 0,
          truncated: false,
          error: { code: res.error.code, message: res.error.message }
        }
      }
    })
  }

  /** 실제 디렉토리를 스트리밍으로 적재한다. */
  async function startStream(panelId: string, path: string): Promise<void> {
    set((s) => {
      const p = s.panels[panelId]
      if (p) {
        p.directory = {
          status: 'loading',
          entries: [],
          streamId: null,
          total: 0,
          truncated: false,
          error: null
        }
      }
    })

    // 숨김 파일 표시는 사용자 설정(uiSlice.showHidden)을 따른다(P5, F장).
    const startRes = await fsApi.listStart({ path, showHidden: get().showHidden })
    // 이동 중 경로가 또 바뀌었으면 이 응답은 폐기.
    if (get().panels[panelId]?.path !== path) {
      if (startRes.ok) void fsApi.listCancel(startRes.value.streamId)
      return
    }
    if (!startRes.ok) {
      const code = startRes.error.code
      set((s) => {
        const p = s.panels[panelId]
        if (!p) return
        p.directory = {
          status: code === 'EACCES' || code === 'EPERM' ? 'denied' : 'error',
          entries: [],
          streamId: null,
          total: 0,
          truncated: false,
          error: { code, message: startRes.error.message }
        }
      })
      return
    }

    const streamId = startRes.value.streamId
    set((s) => {
      const p = s.panels[panelId]
      if (p) {
        p.directory.streamId = streamId
        p.directory.status = 'streaming'
      }
    })

    const handlers: ListStreamHandlers = {
      onChunk: (entries) => get()._onChunk(panelId, streamId, entries),
      onDone: (total, truncated) => get()._onDone(panelId, streamId, total, truncated),
      onError: (e) => get()._onError(panelId, streamId, e.code, e.message)
    }
    const dispose = subscribeListStream(streamId, handlers)
    streamDisposers.set(panelId, dispose)
  }

  /** 경로 적재 디스패치(내 PC vs 실제 디렉토리). */
  function load(panelId: string, path: string): void {
    disposeStream(panelId)
    if (isMyPc(path)) {
      void loadMyPc(panelId)
    } else {
      void startStream(panelId, path)
    }
  }

  return {
    panels: {},

    addPanel(id, path) {
      set((s) => {
        s.panels[id] = createPanel(id, path)
      })
      load(id, path)
    },

    removePanel(id) {
      disposeStream(id)
      set((s) => {
        delete s.panels[id]
      })
    },

    navigate(panelId, path, pushHistory = true) {
      const cur = get().panels[panelId]
      if (!cur) return
      set((s) => {
        const p = s.panels[panelId]
        if (!p) return
        if (pushHistory && p.path !== path) {
          p.nav.back.push(p.path)
          p.nav.forward = []
        }
        p.path = path
        p.scrollTop = 0
      })
      // 최근 방문 기록(사용자 주도 진입만 — 뒤로/앞으로는 제외, P5b).
      get().recordRecent(path)
      load(panelId, path)
    },

    navBack(panelId) {
      const cur = get().panels[panelId]
      if (!cur || cur.nav.back.length === 0) return
      let target = ''
      set((s) => {
        const p = s.panels[panelId]
        if (!p || p.nav.back.length === 0) return
        const prev = p.nav.back.pop() as string
        p.nav.forward.push(p.path)
        p.path = prev
        p.scrollTop = 0
        target = prev
      })
      load(panelId, target)
    },

    navForward(panelId) {
      const cur = get().panels[panelId]
      if (!cur || cur.nav.forward.length === 0) return
      let target = ''
      set((s) => {
        const p = s.panels[panelId]
        if (!p || p.nav.forward.length === 0) return
        const next = p.nav.forward.pop() as string
        p.nav.back.push(p.path)
        p.path = next
        p.scrollTop = 0
        target = next
      })
      load(panelId, target)
    },

    navUp(panelId) {
      const cur = get().panels[panelId]
      if (!cur) return
      const parent = parentOf(cur.path)
      if (parent === null) return
      get().navigate(panelId, parent, true)
    },

    refresh(panelId) {
      const cur = get().panels[panelId]
      if (!cur) return
      load(panelId, cur.path)
    },

    refreshAll() {
      for (const id of Object.keys(get().panels)) {
        const cur = get().panels[id]
        if (cur) load(id, cur.path)
      }
    },

    setViewMode(panelId, mode) {
      set((s) => {
        const p = s.panels[panelId]
        if (p) p.view.viewMode = mode
      })
    },

    setSort(panelId, key) {
      set((s) => {
        const p = s.panels[panelId]
        if (!p) return
        if (p.view.sortKey === key) {
          p.view.sortDir = p.view.sortDir === 'asc' ? 'desc' : 'asc'
        } else {
          p.view.sortKey = key
          p.view.sortDir = 'asc'
        }
      })
    },

    toggleFolderFirst(panelId) {
      set((s) => {
        const p = s.panels[panelId]
        if (p) p.view.folderFirst = !p.view.folderFirst
      })
    },

    setSearchOpen(panelId, open) {
      set((s) => {
        const p = s.panels[panelId]
        if (p) {
          p.filter.open = open
          if (!open) p.filter.query = ''
        }
      })
    },

    setSearchQuery(panelId, query) {
      set((s) => {
        const p = s.panels[panelId]
        if (p) p.filter.query = query
      })
    },

    setScrollTop(panelId, top) {
      set((s) => {
        const p = s.panels[panelId]
        if (p) p.scrollTop = top
      })
    },

    applyPanelState(panelId, state) {
      set((s) => {
        const p = s.panels[panelId]
        if (!p) return
        p.view = { ...state.view }
        p.nav = { back: [...state.nav.back], forward: [...state.nav.forward] }
        p.scrollTop = state.scrollTop
      })
    },

    _onChunk(panelId, streamId, entries) {
      set((s) => {
        const p = s.panels[panelId]
        if (!p || p.directory.streamId !== streamId) return
        for (const e of entries) p.directory.entries.push(e)
        if (p.directory.status === 'loading') p.directory.status = 'streaming'
        p.directory.total = p.directory.entries.length
      })
    },

    _onDone(panelId, streamId, total, truncated) {
      streamDisposers.get(panelId)?.()
      streamDisposers.delete(panelId)
      set((s) => {
        const p = s.panels[panelId]
        if (!p || p.directory.streamId !== streamId) return
        p.directory.streamId = null
        p.directory.total = total
        p.directory.truncated = truncated
        p.directory.status = total === 0 ? 'empty' : 'ready'
      })
    },

    _onError(panelId, streamId, code, message) {
      streamDisposers.get(panelId)?.()
      streamDisposers.delete(panelId)
      set((s) => {
        const p = s.panels[panelId]
        if (!p || p.directory.streamId !== streamId) return
        p.directory.streamId = null
        p.directory.status = code === 'EACCES' || code === 'EPERM' ? 'denied' : 'error'
        p.directory.error = { code, message }
      })
    }
  }
}

// 미사용 NavHistory import 가드(타입 재노출).
export type { NavHistory }
