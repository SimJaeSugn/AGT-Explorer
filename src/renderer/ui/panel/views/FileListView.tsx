/**
 * FileListView — 가상 스크롤 파일 목록 (ADR-004, SA §6).
 *
 * 자체 윈도잉(고정 행높이): 가시 영역 + 오버스캔 행만 DOM 에 렌더한다.
 * 1만 행이어도 실제 DOM 노드는 수십 개로 일정.
 *   - details/list: 고정 행높이 윈도잉.
 *   - grid: 열 수 × 셀 높이 그리드 윈도잉.
 *
 * 다중 선택(Ctrl/Shift/Ctrl+A)·더블클릭/Enter 활성화·키보드 이동을 처리한다.
 * 정렬/필터는 app/usecases/selectors(computeVisible)가 계산한 결과만 그린다.
 *
 * 셀렉터 격리(SA §5.2): 자기 panelId 의 directory/view/selection 만 구독.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { FileEntryDTO } from '@shared/dto'
import { useRootStore } from '@renderer/app/stores/rootStore'
import { computeVisible } from '@renderer/app/usecases/selectors'
import { activateEntry } from '@renderer/app/usecases/open'
import { getCachedIcon, iconKeyFor, requestIcon, subscribeIcon } from '@renderer/app/usecases/icons'
import { commitRename } from '@renderer/app/usecases/fileOps'
import { openEmptyContextMenu, openRowContextMenu } from '@renderer/app/usecases/contextMenu'
import { highlightRange } from '@renderer/domain/rules/filter'
import { normalizeRect, indicesInRect } from '@renderer/domain/rules/boxSelect'
import type { SelectionState } from '@renderer/domain/rules/selection'
import { tokens, gridCellFor } from '@renderer/ui/theme/tokens'
import { useDragSource, useDropTarget, useDragState } from '@renderer/ui/dnd/useDrag'
import { computeWindow } from './windowing'

const OVERSCAN = 6
/** 박스 선택 시작 임계(클릭과 구분). DnD threshold 와 동일. */
const BOX_THRESHOLD = 5
/** 자동 스크롤 임계 영역(뷰포트 상/하단 px). */
const AUTOSCROLL_EDGE = 24
/** 자동 스크롤 1프레임당 이동 px. */
const AUTOSCROLL_STEP = 12

interface Props {
  readonly panelId: string
  readonly active: boolean
}

/** 크기 사람친화 표기. */
function formatSize(entry: FileEntryDTO): string {
  if (entry.isDir) return ''
  const b = entry.size
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`
  return `${(b / 1024 / 1024 / 1024).toFixed(1)} GB`
}

function formatMtime(ms: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`
}

/** 확장자 표시 토글에 따른 이름 표기. */
function displayName(entry: FileEntryDTO, showExt: boolean): string {
  if (showExt || entry.isDir || entry.ext === '') return entry.name
  // 확장자 숨김: 마지막 ".ext" 제거.
  const dot = entry.name.lastIndexOf('.')
  return dot > 0 ? entry.name.slice(0, dot) : entry.name
}

export function FileListView({ panelId, active }: Props): JSX.Element {
  const directory = useRootStore((s) => s.panels[panelId]?.directory)
  const view = useRootStore((s) => s.panels[panelId]?.view)
  const filter = useRootStore((s) => s.panels[panelId]?.filter)
  const panelPath = useRootStore((s) => s.panels[panelId]?.path ?? '')
  const selection = useRootStore((s) => s.selection[panelId])
  const showExtensions = useRootStore((s) => s.showExtensions)
  const renameTarget = useRootStore((s) => s.renameTarget)
  // J2: 워처발 갱신 시 1회성 스크롤 복원 플래그(보존). null=평상시 no-op.
  const pendingScrollRestore = useRootStore((s) => s.panels[panelId]?.pendingScrollRestore ?? null)
  const setStoreScroll = useRootStore((s) => s.setScrollTop)
  const clearPendingScrollRestore = useRootStore((s) => s.clearPendingScrollRestore)

  const clickSelect = useRootStore((s) => s.clickSelect)
  const selectAll = useRootStore((s) => s.selectAll)
  const moveSelect = useRootStore((s) => s.moveSelect)
  const boxSelect = useRootStore((s) => s.boxSelect)
  const setActivePanel = useRootStore((s) => s.setActivePanel)
  const activeTabId = useRootStore((s) => s.activeTabId)

  // D&D: 패널 빈영역 드롭 타겟 + 드래그 상태(하이라이트 판정).
  const drag = useDragState()
  const emptyAreaDrop = useDropTarget({ panelId, destDir: panelPath, overEntryPath: null })
  const panelDropHighlight =
    drag.active &&
    drag.target?.panelId === panelId &&
    drag.target.overEntryPath === null &&
    drag.allowed

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const roRef = useRef<ResizeObserver | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(400)
  const [viewportW, setViewportW] = useState(600)

  // 스크롤 컨테이너 콜백 ref: 노드가 실제로 마운트/언마운트되는 시점에
  // ResizeObserver 를 부착·해제하고 즉시 측정한다.
  //
  // (버그 이력) 과거에는 `useEffect(..., [])` 로 마운트 시 1회만 측정했는데,
  // 디렉토리가 '로딩' 상태일 때는 스크롤 컨테이너가 렌더되지 않아
  // scrollRef.current 가 null → 옵저버 미부착 → viewportH 가 초기값(400)에
  // 고정됐다. 그 결과 윈도잉이 ~400px 분량의 행만 그려 목록이 패널 높이보다
  // 짧게 보였다(특히 디렉토리를 늦게 로드하는 우측 패널). 콜백 ref 는
  // 컨테이너가 준비된 직후 정확히 측정하므로 이 문제를 없앤다.
  const attachScroll = useCallback((el: HTMLDivElement | null) => {
    scrollRef.current = el
    if (roRef.current) {
      roRef.current.disconnect()
      roRef.current = null
    }
    if (el) {
      const ro = new ResizeObserver(() => {
        setViewportH(el.clientHeight)
        setViewportW(el.clientWidth)
      })
      ro.observe(el)
      roRef.current = ro
      setViewportH(el.clientHeight)
      setViewportW(el.clientWidth)
    }
  }, [])

  // computeVisible 은 패널 객체로 메모. 셀렉터 입력 변화에만 재계산.
  const panel = useRootStore((s) => s.panels[panelId])
  const visible = useMemo(
    () => (panel ? computeVisible(panel) : []),
    // directory.entries/view/filter 가 바뀌면 panel 참조도 immer 로 갱신됨.
    [panel, directory?.entries, view, filter]
  )
  const visiblePaths = useMemo(() => visible.map((e) => e.path), [visible])

  // store scrollTop 미러(보존 캡처·세션 복원 출처). rAF 디바운스로 immer 과갱신 억제.
  const scrollMirrorRef = useRef<{ raf: number | null; pending: number }>({ raf: null, pending: 0 })
  const onScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const top = e.currentTarget.scrollTop
      setScrollTop(top) // 윈도잉용 로컬(즉시)
      // store 반영(rAF 1프레임 병합) → capturePreserve 가 최신 scrollTop 을 읽는다.
      const m = scrollMirrorRef.current
      m.pending = top
      if (m.raf === null) {
        m.raf = requestAnimationFrame(() => {
          m.raf = null
          setStoreScroll(panelId, m.pending)
        })
      }
    },
    [panelId, setStoreScroll]
  )

  const viewMode = view?.viewMode ?? 'details'
  const isGrid = viewMode.startsWith('icons-')
  const rowH = tokens.rowHeight
  const gridCell = isGrid ? gridCellFor(viewMode) : null

  // 윈도잉 계산. 그리드는 보기별 셀 폭/높이, 비그리드는 1열·rowHeight.
  // cellH/colCount/cellW 는 키보드 스크롤(L246)·박스선택 geomRef 가 재사용하므로 보존.
  const cellW = gridCell ? gridCell.w : viewportW
  const colCount = gridCell ? Math.max(1, Math.floor(viewportW / gridCell.w)) : 1
  const cellH = gridCell ? gridCell.h : rowH
  // 윈도잉 산식은 순수 함수(windowing.ts)로 추출(qa verify-perf 가 동일 함수 소비).
  const { startIdx, endIdx, totalHeight } = computeWindow({
    scrollTop,
    viewportH,
    cellH,
    colCount,
    count: visible.length,
    overscan: OVERSCAN
  })

  const onRowClick = useCallback(
    (index: number, e: React.MouseEvent) => {
      // 우클릭(보조 버튼)은 선택 보정을 onContextMenu(openRowContextMenu) 가 전담한다.
      // 여기서 처리하면 이미 다중 선택된 항목을 우클릭할 때 단일 선택으로 무너진다.
      if (e.button !== 0) return
      if (!active) {
        const tabId = activeTabId
        setActivePanel(tabId, panelId)
      }
      clickSelect(panelId, visiblePaths, index, e.ctrlKey || e.metaKey, e.shiftKey)
    },
    [active, activeTabId, setActivePanel, panelId, clickSelect, visiblePaths]
  )

  const onRowDouble = useCallback(
    (entry: FileEntryDTO) => {
      void activateEntry(panelId, entry)
    },
    [panelId]
  )

  // 행 우클릭 → 활성 패널 전환 + 선택 보정(선택 밖이면 단일 선택) + 컨텍스트 메뉴.
  const onRowContext = useCallback(
    (index: number, entry: FileEntryDTO, e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      openRowContextMenu(panelId, entry, visiblePaths, index, e.clientX, e.clientY)
    },
    [panelId, visiblePaths]
  )

  // 빈 영역(행 밖) 우클릭 → 활성 패널 전환 + (대상 없음) 컨텍스트 메뉴.
  const onEmptyContext = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      if (!active) setActivePanel(activeTabId, panelId)
      openEmptyContextMenu(panelId, e.clientX, e.clientY)
    },
    [panelId, active, setActivePanel, activeTabId]
  )

  // 드래그 소스 산출: 클릭 항목이 선택에 포함되면 전체 선택을, 아니면 해당 항목만.
  const dragSourcesFor = useCallback(
    (entry: FileEntryDTO): string[] => {
      const sel = selection?.selectedPaths
      if (sel && sel.has(entry.path) && sel.size > 0) return [...sel]
      return [entry.path]
    },
    [selection]
  )

  // 키보드: ↑/↓ 이동, Ctrl+A(전역 디스패처도 처리하지만 list 포커스 시 직접도 허용).
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const isArrow =
        e.key === 'ArrowDown' ||
        e.key === 'ArrowUp' ||
        ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && colCount > 1)
      if (isArrow) {
        e.preventDefault()
        const cur = selection && selection.anchorIndex >= 0 ? selection.anchorIndex : -1
        // 그리드는 ↑↓ ±colCount, ←→ ±1. list/details(colCount=1)는 ↑↓ ±1만.
        let delta = 0
        if (e.key === 'ArrowDown') delta = colCount
        else if (e.key === 'ArrowUp') delta = -colCount
        else if (e.key === 'ArrowRight') delta = 1
        else if (e.key === 'ArrowLeft') delta = -1
        const next = Math.max(0, Math.min(visible.length - 1, cur + delta))
        moveSelect(panelId, visiblePaths, next)
        // 가시 영역으로 스크롤(그리드는 행 단위).
        const el = scrollRef.current
        if (el) {
          const top = Math.floor(next / colCount) * cellH
          if (top < el.scrollTop) el.scrollTop = top
          else if (top + cellH > el.scrollTop + el.clientHeight) {
            el.scrollTop = top + cellH - el.clientHeight
          }
        }
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault()
        selectAll(panelId, visiblePaths)
      } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
        // 키보드 컨텍스트 메뉴 호출(WCAG 2.1.1): 활성 행 기준 위치에 메뉴를 연다.
        // 활성 행이 없으면(선택 없음) 빈 영역 메뉴를 패널 좌상단 부근에 연다.
        e.preventDefault()
        e.stopPropagation()
        const el = scrollRef.current
        const idx = selection && selection.anchorIndex >= 0 ? selection.anchorIndex : -1
        const entry = idx >= 0 ? visible[idx] : undefined
        if (el && entry) {
          // 활성 행의 화면 좌표(콘텐츠 top - scrollTop + 컨테이너 top)에서 약간 안쪽.
          const rect = el.getBoundingClientRect()
          const row = Math.floor(idx / colCount)
          const col = idx % colCount
          const x = rect.left + Math.min(rect.width - 8, col * cellW + 24)
          const y = rect.top + (row * cellH - el.scrollTop) + Math.min(cellH, cellH / 2 + 8)
          openRowContextMenu(panelId, entry, visiblePaths, idx, x, y)
        } else if (el) {
          const rect = el.getBoundingClientRect()
          if (!active) setActivePanel(activeTabId, panelId)
          openEmptyContextMenu(panelId, rect.left + 16, rect.top + 16)
        }
      }
    },
    [
      selection,
      visible,
      moveSelect,
      panelId,
      visiblePaths,
      cellH,
      cellW,
      colCount,
      selectAll,
      active,
      setActivePanel,
      activeTabId
    ]
  )

  // ── 박스 선택(러버밴드, J1) ─────────────────────────────────────────────
  // 오버레이 렌더용 상태(콘텐츠 좌표계 사각형). 드래그 중에만 non-null.
  const [boxRect, setBoxRect] = useState<{
    top: number
    left: number
    width: number
    height: number
  } | null>(null)
  // 드래그 세션(시작점·수정자·base 선택·자동스크롤 rAF). useState 리렌더 회피.
  const dragRef = useRef<{
    startX: number // 콘텐츠 좌표(scrollTop 포함)
    startY: number
    curClientX: number // 뷰포트 좌표(자동스크롤 임계 판정)
    curClientY: number
    mode: 'replace' | 'add' | 'toggle'
    base: SelectionState
    started: boolean // BOX_THRESHOLD 초과로 실제 시작했는지
    rafId: number | null
  } | null>(null)

  // 최신 윈도잉 파라미터를 리스너에서 참조하기 위한 ref(이벤트는 closure 고정).
  const geomRef = useRef({ colCount, cellH, cellW, count: visible.length })
  geomRef.current = { colCount, cellH, cellW, count: visible.length }
  const visiblePathsRef = useRef(visiblePaths)
  visiblePathsRef.current = visiblePaths

  const applyBox = useCallback(() => {
    const d = dragRef.current
    const el = scrollRef.current
    if (!d || !el) return
    const rect = el.getBoundingClientRect()
    // 현재 포인터의 콘텐츠 좌표(스크롤 포함).
    const curX = d.curClientX - rect.left + el.scrollLeft
    const curY = d.curClientY - rect.top + el.scrollTop
    const r = normalizeRect(d.startX, d.startY, curX, curY)
    setBoxRect({ top: r.top, left: r.left, width: r.right - r.left, height: r.bottom - r.top })
    const g = geomRef.current
    const indices = indicesInRect(r, g)
    boxSelect(panelId, visiblePathsRef.current, indices, d.mode, d.base)
  }, [boxSelect, panelId])

  const stopBox = useCallback(() => {
    const d = dragRef.current
    if (d?.rafId !== null && d?.rafId !== undefined) cancelAnimationFrame(d.rafId)
    dragRef.current = null
    setBoxRect(null)
    window.removeEventListener('pointermove', onBoxPointerMove)
    window.removeEventListener('pointerup', onBoxPointerUp)
  }, [])

  // 자동 스크롤 rAF 루프: 커서가 뷰포트 상/하단 임계 안이면 스크롤 후 박스 재계산.
  const autoScrollTick = useCallback(() => {
    const d = dragRef.current
    const el = scrollRef.current
    if (!d || !el) return
    const rect = el.getBoundingClientRect()
    let dy = 0
    if (d.curClientY < rect.top + AUTOSCROLL_EDGE) dy = -AUTOSCROLL_STEP
    else if (d.curClientY > rect.bottom - AUTOSCROLL_EDGE) dy = AUTOSCROLL_STEP
    if (dy !== 0) {
      const before = el.scrollTop
      el.scrollTop = Math.max(0, Math.min(el.scrollHeight - el.clientHeight, before + dy))
      if (el.scrollTop !== before) {
        setScrollTop(el.scrollTop)
        applyBox()
      }
    }
    d.rafId = requestAnimationFrame(autoScrollTick)
  }, [applyBox])

  const onBoxPointerMove = useCallback(
    (e: PointerEvent) => {
      const d = dragRef.current
      const el = scrollRef.current
      if (!d || !el) return
      d.curClientX = e.clientX
      d.curClientY = e.clientY
      if (!d.started) {
        const rect = el.getBoundingClientRect()
        const curX = e.clientX - rect.left + el.scrollLeft
        const curY = e.clientY - rect.top + el.scrollTop
        if (Math.abs(curX - d.startX) < BOX_THRESHOLD && Math.abs(curY - d.startY) < BOX_THRESHOLD) {
          return
        }
        d.started = true
        d.rafId = requestAnimationFrame(autoScrollTick)
      }
      applyBox()
    },
    [applyBox, autoScrollTick]
  )

  const onBoxPointerUp = useCallback(() => {
    stopBox()
  }, [stopBox])

  const onContainerPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // 좌클릭·빈 영역(행/리네임/버튼이 아닌)에서만 박스 선택 시작.
      if (e.button !== 0) return
      const target = e.target as HTMLElement
      // 행(role=row)·input·button 위에서 시작한 포인터는 무시(기존 클릭/D&D/리네임 우선).
      if (target.closest('[role="row"]') || target.closest('input') || target.closest('button')) {
        return
      }
      const el = scrollRef.current
      if (!el) return
      if (!active) setActivePanel(activeTabId, panelId)
      const rect = el.getBoundingClientRect()
      const startX = e.clientX - rect.left + el.scrollLeft
      const startY = e.clientY - rect.top + el.scrollTop
      const cur = useRootStore.getState().selection[panelId]
      const base: SelectionState = cur ?? { anchorIndex: -1, selectedPaths: new Set() }
      const mode = e.ctrlKey || e.metaKey ? 'add' : e.shiftKey ? 'toggle' : 'replace'
      dragRef.current = {
        startX,
        startY,
        curClientX: e.clientX,
        curClientY: e.clientY,
        mode,
        base,
        started: false,
        rafId: null
      }
      window.addEventListener('pointermove', onBoxPointerMove)
      window.addEventListener('pointerup', onBoxPointerUp)
    },
    [active, activeTabId, panelId, setActivePanel, onBoxPointerMove, onBoxPointerUp]
  )

  // 언마운트 시 리스너·rAF 누수 방지(박스 선택 + 스크롤 미러 rAF).
  useEffect(() => {
    return () => {
      const d = dragRef.current
      if (d?.rafId !== null && d?.rafId !== undefined) cancelAnimationFrame(d.rafId)
      const m = scrollMirrorRef.current
      if (m.raf !== null) cancelAnimationFrame(m.raf)
      window.removeEventListener('pointermove', onBoxPointerMove)
      window.removeEventListener('pointerup', onBoxPointerUp)
    }
  }, [onBoxPointerMove, onBoxPointerUp])

  // J2: 워처발 갱신 스크롤 복원 — pendingScrollRestore 1회성 플래그 기반.
  // status==='ready' + totalHeight 확정일 때만 클램프 적용 후 즉시 소거(휴리스틱 없음).
  // Hooks 규칙 준수: early return 이전에 선언(내부에서 status/높이 가드).
  useEffect(() => {
    if (pendingScrollRestore == null) return // 평상시 no-op(수동 스크롤·navigate 무간섭)
    const el = scrollRef.current
    if (!el || directory?.status !== 'ready') return // 높이 미확정이면 다음 status/height 변화에서 재시도
    const max = Math.max(0, el.scrollHeight - el.clientHeight)
    const clamped = Math.min(pendingScrollRestore, max) // 콘텐츠 축소 시 클램프(빈 공간 0)
    el.scrollTop = clamped
    setScrollTop(clamped) // 로컬 윈도잉 동기화
    setStoreScroll(panelId, clamped) // store 미러도 일치
    clearPendingScrollRestore(panelId) // 즉시 1회성 소거
  }, [
    pendingScrollRestore,
    directory?.status,
    totalHeight,
    panelId,
    setStoreScroll,
    clearPendingScrollRestore
  ])

  if (!directory || !view) return <div />

  // 상태별 표시.
  if (directory.status === 'loading') {
    return <CenterMsg text="불러오는 중…" muted />
  }
  if (directory.status === 'denied') {
    return <CenterMsg text="접근 권한이 없습니다." error />
  }
  if (directory.status === 'error') {
    return <CenterMsg text={`오류: ${directory.error?.message ?? '알 수 없음'}`} error />
  }
  if (directory.status === 'empty' || (directory.status === 'ready' && visible.length === 0)) {
    const filtering = !!filter?.open && filter.query.trim().length > 0
    return (
      <div
        onPointerEnter={emptyAreaDrop.onPointerEnter}
        onPointerLeave={emptyAreaDrop.onPointerLeave}
        onContextMenu={onEmptyContext}
        data-testid={`filelist-${panelId}`}
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: tokens.color.bg,
          color: tokens.color.textMuted,
          fontSize: 13,
          boxShadow: panelDropHighlight ? `inset 0 0 0 2px ${tokens.color.accent}` : undefined
        }}
      >
        {filtering ? '검색 결과가 없습니다.' : '이 폴더는 비어 있습니다.'}
      </div>
    )
  }

  // 렌더 윈도(가시 + 오버스캔).
  const rows: JSX.Element[] = []
  for (let i = startIdx; i < endIdx; i++) {
    const entry = visible[i]
    if (!entry) continue
    const row = Math.floor(i / colCount)
    const col = i % colCount
    const top = row * cellH
    const selected = selection?.selectedPaths.has(entry.path) ?? false
    const renaming = renameTarget?.panelId === panelId && renameTarget.path === entry.path
    // 폴더 항목 드롭 하이라이트: 드래그 중 이 폴더가 대상이고 허용일 때.
    const dropHi =
      drag.active &&
      entry.isDir &&
      drag.target?.panelId === panelId &&
      drag.target.overEntryPath === entry.path &&
      drag.allowed
    rows.push(
      <FileRow
        key={entry.path}
        entry={entry}
        index={i}
        setSize={visible.length}
        top={top}
        left={gridCell ? col * gridCell.w : 0}
        width={gridCell ? gridCell.w : '100%'}
        height={cellH}
        selected={selected}
        active={active}
        details={view.viewMode === 'details'}
        grid={gridCell ? { icon: gridCell.icon } : null}
        showExt={showExtensions}
        query={filter?.open ? filter.query : ''}
        panelId={panelId}
        panelPath={panelPath}
        dropHighlight={dropHi}
        renaming={renaming}
        initialName={renaming ? renameTarget.initialName : ''}
        onClick={onRowClick}
        onDouble={onRowDouble}
        onContext={onRowContext}
        dragSourcesFor={dragSourcesFor}
      />
    )
  }

  return (
    <div
      ref={attachScroll}
      onScroll={onScroll}
      onKeyDown={onKeyDown}
      onContextMenu={onEmptyContext}
      onPointerDown={onContainerPointerDown}
      onPointerEnter={emptyAreaDrop.onPointerEnter}
      onPointerLeave={emptyAreaDrop.onPointerLeave}
      tabIndex={0}
      role="grid"
      aria-label="파일 목록"
      data-testid={`filelist-${panelId}`}
      style={{
        position: 'relative',
        flex: 1,
        overflowY: 'auto',
        overflowX: 'hidden',
        // outline 은 전역 a11y CSS(:focus-visible)가 키보드 포커스에만 표시.
        // 인라인 outline:'none' 을 두면 CSS 를 이겨 키보드 포커스가 안 보이므로 제거.
        background: tokens.color.bg,
        boxShadow: panelDropHighlight ? `inset 0 0 0 2px ${tokens.color.accent}` : undefined
      }}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        {rows}
        {boxRect && (
          <div
            aria-hidden
            style={{
              position: 'absolute',
              top: boxRect.top,
              left: boxRect.left,
              width: boxRect.width,
              height: boxRect.height,
              background: tokens.color.bgSelected,
              opacity: 0.35,
              border: `1px solid ${tokens.color.accent}`,
              pointerEvents: 'none',
              zIndex: 2
            }}
          />
        )}
      </div>
      {directory.status === 'streaming' && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'sticky',
            bottom: 0,
            padding: '2px 8px',
            fontSize: 11,
            color: tokens.color.textMuted,
            background: tokens.color.bgAlt,
            borderTop: `1px solid ${tokens.color.border}`
          }}
        >
          불러오는 중… {visible.length}개
        </div>
      )}
    </div>
  )
}

interface RowProps {
  entry: FileEntryDTO
  index: number
  /** 전체 항목 수(가상 스크롤 aria-setsize 고지용). */
  setSize: number
  top: number
  left: number | string
  width: number | string
  height: number
  selected: boolean
  active: boolean
  details: boolean
  /** 아이콘 그리드 셀 모드(J4). null 이면 list/details 행. icon=아이콘 px. */
  grid: { icon: number } | null
  showExt: boolean
  query: string
  panelId: string
  panelPath: string
  dropHighlight: boolean
  renaming: boolean
  initialName: string
  onClick: (index: number, e: React.MouseEvent) => void
  onDouble: (entry: FileEntryDTO) => void
  onContext: (index: number, entry: FileEntryDTO, e: React.MouseEvent) => void
  dragSourcesFor: (entry: FileEntryDTO) => string[]
}

function FileRow({
  entry,
  index,
  setSize,
  top,
  left,
  width,
  height,
  selected,
  active,
  details,
  grid,
  showExt,
  query,
  panelId,
  panelPath,
  dropHighlight,
  renaming,
  initialName,
  onClick,
  onDouble,
  onContext,
  dragSourcesFor
}: RowProps): JSX.Element {
  const bg = dropHighlight
    ? tokens.color.bgHover
    : selected
      ? active
        ? tokens.color.bgSelected
        : tokens.color.bgSelectedInactive
      : 'transparent'
  const name = displayName(entry, showExt)
  const dim = entry.attrs.hidden || entry.attrs.system ? 0.55 : 1

  // 드래그 소스(이 행에서 시작) + 폴더면 드롭 타겟(그 폴더 안).
  const dragSrc = useDragSource(panelId, panelPath, () => dragSourcesFor(entry))
  const folderDrop = useDropTarget({
    panelId,
    destDir: entry.path,
    overEntryPath: entry.isDir ? entry.path : null
  })

  // ── 아이콘 그리드 셀(J4): 아이콘 위·이름 아래(2줄 ellipsis·중앙정렬) ──────
  if (grid) {
    return (
      <div
        role="row"
        aria-selected={selected}
        aria-label={`${name}${entry.isDir ? ', 폴더' : ', 파일'}`}
        aria-posinset={index + 1}
        aria-setsize={setSize}
        onMouseDown={(e) => onClick(index, e)}
        onContextMenu={(e) => onContext(index, entry, e)}
        onPointerDown={renaming ? undefined : dragSrc.onPointerDown}
        onPointerEnter={entry.isDir ? folderDrop.onPointerEnter : undefined}
        onPointerLeave={entry.isDir ? folderDrop.onPointerLeave : undefined}
        onDoubleClick={() => onDouble(entry)}
        title={entry.path}
        style={{
          position: 'absolute',
          top,
          left,
          width,
          height,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'flex-start',
          gap: 4,
          padding: 6,
          boxSizing: 'border-box',
          fontSize: 12,
          color: tokens.color.text,
          opacity: dim,
          background: bg,
          borderRadius: 4,
          outline: dropHighlight ? `2px solid ${tokens.color.accent}` : undefined,
          outlineOffset: -2,
          cursor: 'default',
          userSelect: 'none',
          textAlign: 'center'
        }}
      >
        <span
          style={{
            flex: '0 0 auto',
            width: grid.icon,
            height: grid.icon,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <OSIcon entry={entry} size={grid.icon} />
        </span>
        {renaming ? (
          <RenameInput panelId={panelId} path={entry.path} initialName={initialName} />
        ) : (
          <span
            style={{
              width: '100%',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              wordBreak: 'break-word',
              lineHeight: 1.3
            }}
          >
            <HighlightedName name={name} query={query} />
          </span>
        )}
      </div>
    )
  }

  return (
    <div
      role="row"
      aria-selected={selected}
      aria-label={`${name}${entry.isDir ? ', 폴더' : ', 파일'}`}
      aria-posinset={index + 1}
      aria-setsize={setSize}
      onMouseDown={(e) => onClick(index, e)}
      onContextMenu={(e) => onContext(index, entry, e)}
      onPointerDown={renaming ? undefined : dragSrc.onPointerDown}
      onPointerEnter={entry.isDir ? folderDrop.onPointerEnter : undefined}
      onPointerLeave={entry.isDir ? folderDrop.onPointerLeave : undefined}
      onDoubleClick={() => onDouble(entry)}
      title={entry.path}
      style={{
        position: 'absolute',
        top,
        left,
        width,
        height,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '0 8px',
        boxSizing: 'border-box',
        fontSize: 13,
        color: tokens.color.text,
        opacity: dim,
        background: bg,
        outline: dropHighlight ? `2px solid ${tokens.color.accent}` : undefined,
        outlineOffset: -2,
        cursor: 'default',
        userSelect: 'none',
        whiteSpace: 'nowrap'
      }}
    >
      <span
        style={{
          flex: '0 0 auto',
          width: 16,
          height: 16,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        <OSIcon entry={entry} />
      </span>
      {renaming ? (
        <RenameInput panelId={panelId} path={entry.path} initialName={initialName} />
      ) : (
        <span
          style={{
            flex: details ? '1 1 40%' : '1 1 auto',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}
        >
          <HighlightedName name={name} query={query} />
        </span>
      )}
      {details && (
        <>
          <span
            style={{
              flex: '0 0 90px',
              textAlign: 'right',
              color: tokens.color.textMuted,
              fontVariantNumeric: 'tabular-nums'
            }}
          >
            {formatSize(entry)}
          </span>
          <span
            style={{
              flex: '0 0 60px',
              textAlign: 'left',
              color: tokens.color.textMuted
            }}
          >
            {entry.isDir ? '폴더' : entry.ext ? entry.ext.toUpperCase() : '파일'}
          </span>
          <span
            style={{
              flex: '0 0 140px',
              textAlign: 'left',
              color: tokens.color.textMuted,
              fontVariantNumeric: 'tabular-nums'
            }}
          >
            {formatMtime(entry.mtime)}
          </span>
        </>
      )}
    </div>
  )
}

/**
 * OSIcon — 항목의 OS 실제 아이콘(있으면 <img>, 로드 전/실패 시 이모지 폴백, H6).
 *
 * 전역 아이콘 캐시(infra/icon, app/usecases/icons 경유)를 useSyncExternalStore 로
 * 구독한다. 같은 키(확장자/폴더/드라이브)는 IPC 1회만(가상 스크롤 1만개 정합) —
 * in-flight 디듀프. 캐시는 패널 store 무관 전역이라 셀렉터 격리(SA §5.2)를 지킨다.
 * 아이콘 크기는 rowHeight(26) 안의 16×16 박스에 정합한다.
 */
function OSIcon({ entry, size = 16 }: { entry: FileEntryDTO; size?: number }): JSX.Element {
  const key = iconKeyFor(entry)
  const dataUrl = useSyncExternalStore(subscribeIcon, () => getCachedIcon(key))

  useEffect(() => {
    if (!getCachedIcon(key)) void requestIcon(entry)
    // key 변화(행 재사용으로 다른 항목 매핑)마다 미캐시면 로드 트리거.
  }, [key, entry])

  if (dataUrl) {
    // OS 아이콘은 저해상도(16/32)일 수 있으나 그리드 셀 크기에 맞춰 확대 렌더.
    return (
      <img
        src={dataUrl}
        width={size}
        height={size}
        alt=""
        draggable={false}
        style={{ imageRendering: size > 32 ? 'auto' : undefined }}
      />
    )
  }
  return <span aria-hidden style={{ fontSize: size > 16 ? size * 0.8 : undefined }}>{entry.isDir ? '📁' : '📄'}</span>
}

/**
 * 인라인 이름편집 input (F2·새 항목). Enter=커밋, Esc=취소, blur=커밋.
 * 확장자 앞부분만 선택(파일명 편집 편의). 커밋 실패(EEXIST/EINVAL) 시 편집 유지.
 */
function RenameInput({
  panelId,
  path,
  initialName
}: {
  panelId: string
  path: string
  initialName: string
}): JSX.Element {
  const [value, setValue] = useState(initialName)
  const endRename = useRootStore((s) => s.endRename)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const committingRef = useRef(false)

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.focus()
    // 확장자 앞 이름 부분만 선택.
    const dot = initialName.lastIndexOf('.')
    if (dot > 0) el.setSelectionRange(0, dot)
    else el.select()
  }, [initialName])

  async function commit(): Promise<void> {
    if (committingRef.current) return
    committingRef.current = true
    if (value.trim() === initialName) {
      endRename()
      return
    }
    const ok = await commitRename(panelId, path, value)
    if (!ok) {
      committingRef.current = false
      inputRef.current?.focus()
    }
  }

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') {
          e.preventDefault()
          void commit()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          endRename()
        }
      }}
      onBlur={() => void commit()}
      spellCheck={false}
      aria-label="이름 편집"
      style={{
        flex: '1 1 40%',
        height: 20,
        minWidth: 0,
        boxSizing: 'border-box',
        border: `1px solid ${tokens.color.accentBorder}`,
        borderRadius: 3,
        padding: '0 4px',
        fontSize: 13,
        fontFamily: tokens.font
        // 키보드 포커스 가시성은 전역 :focus-visible(a11y CSS)에 위임(인라인 outline 제거).
      }}
    />
  )
}

/** 검색어 매칭 구간을 하이라이트해 이름을 렌더(부분일치 쿼리만). */
function HighlightedName({ name, query }: { name: string; query: string }): JSX.Element {
  const range = highlightRange(name, query)
  if (!range) return <>{name}</>
  return (
    <>
      {name.slice(0, range.start)}
      <mark
        style={{
          background: tokens.color.highlight,
          color: 'inherit',
          borderRadius: 2,
          padding: '0 1px'
        }}
      >
        {name.slice(range.start, range.end)}
      </mark>
      {name.slice(range.end)}
    </>
  )
}

function CenterMsg({
  text,
  muted,
  error
}: {
  text: string
  muted?: boolean
  error?: boolean
}): JSX.Element {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: error ? tokens.color.danger : muted ? tokens.color.textMuted : tokens.color.text,
        fontSize: 13,
        background: tokens.color.bg
      }}
    >
      {text}
    </div>
  )
}
