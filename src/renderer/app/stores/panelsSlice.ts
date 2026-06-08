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
import { isRemotePath } from '@renderer/domain/rules/remoteLocation'
import { computeVisible } from '@renderer/app/usecases/selectors'
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
    scrollTop: 0,
    pendingScrollRestore: null
  }
}

/** 스트림 구독 해제 함수 보관(슬라이스 외부 — 비직렬화 자원). */
const streamDisposers = new Map<string, () => void>()

/**
 * 워처발/수동 재-list 보존 스냅샷(슬라이스 외부 — 비직렬화 자원, streamDisposers 동형).
 * 재-list 시작 직전에 capturePreserve 가 set, _onDone/_onError 가 소비/폐기한다.
 */
interface PreserveSnapshot {
  /** 갱신 전 선택 경로 집합(재-list 후 교집합으로 복원). */
  readonly selectedPaths: ReadonlySet<string>
  /** anchorIndex 대신 "경로"로 보존(computeVisible 순서에서 환산·재탐색). null=없음. */
  readonly anchorPath: string | null
  /** 갱신 전 스크롤 위치(복원 시 pendingScrollRestore 로 1회 적용). */
  readonly scrollTop: number
}
const preserveSnapshots = new Map<string, PreserveSnapshot>()

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
  /**
   * 현재 경로 새로고침(히스토리 미적재). 경로 동일 재-list 라 기본 보존(preserve:true).
   * 수동 새로고침(Ctrl+R)·컨텍스트 "새로고침"이 호출.
   */
  refresh(panelId: string, opts?: { preserve?: boolean }): void
  /** 모든 패널 재스캔(숨김 파일 토글 등 전역 설정 변경 시). 경로 동일이라 기본 보존. */
  refreshAll(opts?: { preserve?: boolean }): void
  /**
   * 워처발 전용 갱신 진입점(보존 강제) — watchBridge 가 호출.
   * refresh(panelId, { preserve:true }) 와 동치이나 의미 명시용 별도 진입점.
   */
  softRefresh(panelId: string): void
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

  /** 워처발 갱신 스크롤 복원 플래그 1회성 소거(FileListView 소비 직후 호출). */
  clearPendingScrollRestore(panelId: string): void

  // 원격 탐색(§M M3) — usecases/remote 가 remote:list 결과를 주입 ────────────
  /** 원격 디렉토리 로딩 시작(status=loading, 스트림 없음). */
  _remoteLoading(panelId: string, path: string): void
  /** 원격 디렉토리 목록 반영(status=ready/empty). path 가 현재와 다르면 폐기. */
  _setRemoteEntries(panelId: string, path: string, entries: Panel['directory']['entries']): void
  /** 원격 디렉토리 오류 반영(status=error/denied). code/message 표시. */
  _setRemoteError(panelId: string, path: string, code: string, message: string): void

  // 스트림 이벤트 진입(infra 브리지가 호출) ──────────────────────────────
  _onChunk(panelId: string, streamId: string, entries: Panel['directory']['entries']): void
  _onDone(panelId: string, streamId: string, total: number, truncated: boolean): void
  _onError(panelId: string, streamId: string, code: string, message: string): void
  /** 보존 스냅샷 적용(selection 교집합 + pendingScrollRestore set). _onDone 내부 사용. */
  _applyPreserve(panelId: string, snap: PreserveSnapshot): void
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

  /**
   * 재-list 시작 직전 보존 스냅샷 캡처(선택 경로 집합·anchorPath·scrollTop).
   * anchorIndex 는 computeVisible(정렬·필터 후 visible) 순서의 인덱스이므로
   * 같은 순서에서 경로로 환산한다(directory.entries[anchorIndex] 아님).
   */
  function capturePreserve(panelId: string): void {
    const p = get().panels[panelId]
    if (!p) return
    const sel = get().selection[panelId]
    const visible = computeVisible(p) // 메모 적중 시 동일 참조(추가 비용 0)
    const anchorPath =
      sel && sel.anchorIndex >= 0 ? (visible[sel.anchorIndex]?.path ?? null) : null
    preserveSnapshots.set(panelId, {
      selectedPaths: sel ? new Set(sel.selectedPaths) : new Set(),
      anchorPath,
      scrollTop: p.scrollTop
    })
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

  /** 실제 디렉토리를 스트리밍으로 적재한다. preserve=true 면 선택/스크롤을 _onDone 에서 복원. */
  async function startStream(panelId: string, path: string, preserve: boolean): Promise<void> {
    // 재-list 가 directory 를 리셋하기 직전에 보존 스냅샷 캡처(보존 모드만).
    if (preserve) capturePreserve(panelId)
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
      preserveSnapshots.delete(panelId) // 폐기 — 새 load 가 재캡처.
      return
    }
    if (!startRes.ok) {
      preserveSnapshots.delete(panelId) // start 실패 → 복원 안 함(안전).
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

  /** 경로 적재 디스패치(내 PC vs 실제 디렉토리). preserve=true 면 선택/스크롤 보존. */
  function load(panelId: string, path: string, opts?: { preserve?: boolean }): void {
    disposeStream(panelId)
    const preserve = opts?.preserve ?? false
    if (isMyPc(path)) {
      // 내 PC(드라이브 목록)는 _onDone 경로를 타지 않으므로 보존 스냅샷을 남기지 않는다(누수 방지).
      preserveSnapshots.delete(panelId)
      void loadMyPc(panelId)
    } else if (isRemotePath(path)) {
      // 원격 경로(sftp://·ftp(s)://): 로컬 스트림 대신 remote:list 로 탐색(§M M3).
      // 보존 스냅샷은 _onDone 경로를 타지 않으므로 남기지 않는다(누수 방지).
      preserveSnapshots.delete(panelId)
      void import('@renderer/app/usecases/remote').then((m) => m.listRemoteDir(panelId, path))
    } else {
      void startStream(panelId, path, preserve)
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
        p.pendingScrollRestore = null // 경로 변경 시 stale 1회성 복원 폐기.
      })
      // 경로 변경 = 컨텍스트 리셋 → 선택 초기화(J2: 잔존 선택 제거). preserve 미지정 load.
      get().resetSelection(panelId)
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
        p.pendingScrollRestore = null
        target = prev
      })
      // 경로 변경 → 선택 초기화(J2).
      get().resetSelection(panelId)
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
        p.pendingScrollRestore = null
        target = next
      })
      // 경로 변경 → 선택 초기화(J2).
      get().resetSelection(panelId)
      load(panelId, target)
    },

    navUp(panelId) {
      const cur = get().panels[panelId]
      if (!cur) return
      const parent = parentOf(cur.path)
      if (parent === null) return
      get().navigate(panelId, parent, true)
    },

    refresh(panelId, opts) {
      const cur = get().panels[panelId]
      if (!cur) return
      // 경로 동일 재-list → 기본 보존(선택/스크롤 유지).
      load(panelId, cur.path, { preserve: opts?.preserve ?? true })
    },

    refreshAll(opts) {
      const preserve = opts?.preserve ?? true
      for (const id of Object.keys(get().panels)) {
        const cur = get().panels[id]
        if (cur) load(id, cur.path, { preserve })
      }
    },

    softRefresh(panelId) {
      // 워처발 갱신 — 보존 강제(refresh 와 구현 공유).
      get().refresh(panelId, { preserve: true })
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

    clearPendingScrollRestore(panelId) {
      set((s) => {
        const p = s.panels[panelId]
        if (p) p.pendingScrollRestore = null
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

    _remoteLoading(panelId, path) {
      set((s) => {
        const p = s.panels[panelId]
        if (!p || p.path !== path) return
        p.directory = {
          status: 'loading',
          entries: [],
          streamId: null,
          total: 0,
          truncated: false,
          error: null
        }
      })
    },

    _setRemoteEntries(panelId, path, entries) {
      set((s) => {
        const p = s.panels[panelId]
        // 이동 중 경로가 또 바뀌었으면 이 응답은 폐기.
        if (!p || p.path !== path) return
        p.directory = {
          status: entries.length === 0 ? 'empty' : 'ready',
          entries: [...entries],
          streamId: null,
          total: entries.length,
          truncated: false,
          error: null
        }
      })
    },

    _setRemoteError(panelId, path, code, message) {
      set((s) => {
        const p = s.panels[panelId]
        if (!p || p.path !== path) return
        p.directory = {
          status: code === 'EACCES' || code === 'EPERM' ? 'denied' : 'error',
          entries: [],
          streamId: null,
          total: 0,
          truncated: false,
          error: { code, message }
        }
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
      let applied = false
      set((s) => {
        const p = s.panels[panelId]
        if (!p || p.directory.streamId !== streamId) return
        p.directory.streamId = null
        p.directory.total = total
        p.directory.truncated = truncated
        p.directory.status = total === 0 ? 'empty' : 'ready'
        applied = true
      })
      // 보존 복원은 새 entries 확정(set 완료) 직후 1회 적용. streamId 불일치(폐기)면 스킵.
      const snap = preserveSnapshots.get(panelId)
      if (snap) {
        preserveSnapshots.delete(panelId)
        if (applied) get()._applyPreserve(panelId, snap)
      }
    },

    _applyPreserve(panelId, snap) {
      const p = get().panels[panelId]
      if (!p) return
      // anchor·교집합 모두 새 패널의 computeVisible(정렬·필터 후 visible) 순서 기준으로 환산.
      const visible = computeVisible(p)
      const livePaths = new Set(visible.map((e) => e.path))
      // selection 교집합: 새 visible 에 여전히 존재하는 경로만 유지(사라진 항목만 해제).
      const kept = new Set<string>()
      for (const path of snap.selectedPaths) if (livePaths.has(path)) kept.add(path)
      let anchorIndex = -1
      if (snap.anchorPath && livePaths.has(snap.anchorPath)) {
        anchorIndex = visible.findIndex((e) => e.path === snap.anchorPath)
      } else if (kept.size > 0) {
        // anchor 가 사라졌으면 잔존 선택 중 visible 순서상 첫 항목을 anchor 로(best-effort).
        anchorIndex = visible.findIndex((e) => kept.has(e.path))
      }
      // selection 통째 교체(ADR-002).
      get().setSelection(panelId, { anchorIndex, selectedPaths: kept })
      // scrollTop 은 1회성 플래그로만 복원(store scrollTop=onScroll 미러는 덮어쓰지 않음).
      set((s) => {
        const pp = s.panels[panelId]
        if (pp) pp.pendingScrollRestore = snap.scrollTop
      })
    },

    _onError(panelId, streamId, code, message) {
      streamDisposers.get(panelId)?.()
      streamDisposers.delete(panelId)
      // 에러 시 보존 스냅샷 폐기(복원 시도 안 함 — 안전). pendingScrollRestore 도 set 안 함.
      preserveSnapshots.delete(panelId)
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
