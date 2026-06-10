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
import { getCachedIcon, iconKeyFor, isDriveFolder, isLinkFolder, requestIcon, subscribeIcon } from '@renderer/app/usecases/icons'
import { DriveGlyph, FolderGlyph } from '@renderer/ui/icons/glyphs'
import {
  getCachedThumbnail,
  requestThumbnail,
  subscribeThumbnail,
  thumbnailKeyFor
} from '@renderer/app/usecases/thumbnails'
import { isThumbnailableExt, thumbSizeFor } from '@renderer/domain/image'
import { commitRename } from '@renderer/app/usecases/fileOps'
import { openEmptyContextMenu, openRowContextMenu } from '@renderer/app/usecases/contextMenu'
import { highlightRange } from '@renderer/domain/rules/filter'
import { normalizeRect, indicesInRect } from '@renderer/domain/rules/boxSelect'
import type { SelectionState } from '@renderer/domain/rules/selection'
import { tokens, gridCellFor } from '@renderer/ui/theme/tokens'
import {
  useDragSource,
  useExternalDragSource,
  useDropTarget,
  useHtml5DropTarget,
  useDragState
} from '@renderer/ui/dnd/useDrag'
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
  // 상단 고정: 이 패널 경로의 고정 항목 배열(변경 시 재렌더 + computeVisible 재계산).
  const pinnedHere = useRootStore((s) => s.pinnedByDir[s.panels[panelId]?.path ?? ''])
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
  // HTML5 드롭(드롭 즉시 이동 — OS 드래그가 포인터를 점유해도 동작): 빈영역=패널 폴더.
  const emptyAreaHtml5 = useHtml5DropTarget({ panelId, destDir: panelPath, overEntryPath: null })
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
    // pinnedHere 는 고정 토글 시 참조가 바뀌어 재계산(applyPins)을 유발한다.
    [panel, directory?.entries, view, filter, pinnedHere]
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

  // 상단 고정 sticky 밴드(§O 변경): 고정 항목을 스크롤해도 목록 최상단에 고정 표시한다.
  // 목록/자세히(colCount=1) 전용 — 그리드는 wrapping 특성상 부분 행 점유로 레이아웃이
  // 깨지므로 기존 "정렬 최상단 유지"만 적용(밴드 비활성). applyPins 가 고정 항목을 visible
  // 앞쪽에 모으므로, 선두 연속 구간이 곧 고정 묶음이다(인덱스/선택/키보드 공간은 불변).
  const pinnedSet = useMemo(() => new Set(pinnedHere ?? []), [pinnedHere])
  const sticky = !isGrid && pinnedSet.size > 0
  let stickyCount = 0
  if (sticky) {
    while (stickyCount < visible.length) {
      const e = visible[stickyCount]
      if (!e || !pinnedSet.has(e.path)) break
      stickyCount++
    }
  }
  const stickyBandH = stickyCount * cellH

  // 행 mousedown → 선택 갱신. 단, 수정자 없이 **이미 다중 선택된** 항목을 누르면 단일
  // 붕괴를 mouseup(click)으로 미룬다 → 그래야 그 항목을 드래그할 때 선택 전체가 보존돼
  // 다중 이동이 된다(드래그가 일어나면 click 이 발화하지 않으므로 다중 유지). A3 다중 D&D.
  const onRowMouseDown = useCallback(
    (index: number, e: React.MouseEvent) => {
      // 우클릭(보조 버튼)은 선택 보정을 onContextMenu(openRowContextMenu) 가 전담한다.
      if (e.button !== 0) return
      if (!active) {
        const tabId = activeTabId
        setActivePanel(tabId, panelId)
      }
      const ctrl = e.ctrlKey || e.metaKey
      const shift = e.shiftKey
      if (!ctrl && !shift) {
        const path = visiblePaths[index]
        const cur = useRootStore.getState().selection[panelId]
        if (path && cur && cur.selectedPaths.has(path) && cur.selectedPaths.size > 1) {
          return // 미룸: 드래그면 다중 보존, 단순 클릭이면 onRowClickSelect 가 단일로 정리.
        }
      }
      clickSelect(panelId, visiblePaths, index, ctrl, shift)
    },
    [active, activeTabId, setActivePanel, panelId, clickSelect, visiblePaths]
  )

  // 행 click(= mouseup·드래그 아님) → 미뤄둔 단일 선택 적용. 드래그였다면 click 이 발화하지
  // 않아 호출되지 않는다(다중 보존). 수정자 클릭은 mousedown 이 이미 처리(중복 토글 방지).
  const onRowClickSelect = useCallback(
    (index: number, e: React.MouseEvent) => {
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return
      clickSelect(panelId, visiblePaths, index, false, false)
    },
    [panelId, clickSelect, visiblePaths]
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
          // sticky 고정 밴드가 상단 stickyBandH 만큼을 가리므로, 위로 스크롤 시 그만큼
          // 더 올려 대상 행이 밴드 뒤에 가리지 않게 한다(고정 행 자신은 max(0)로 0 → 밴드에 표시).
          if (top < el.scrollTop + stickyBandH) el.scrollTop = Math.max(0, top - stickyBandH)
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
      stickyBandH,
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
          // N1: 배경 투명(워터마크 노출·F17 비중첩). 패널 배경색은 Panel 외곽이 제공.
          background: 'transparent',
          color: tokens.color.textMuted,
          fontSize: 13,
          boxShadow: panelDropHighlight ? `inset 0 0 0 2px ${tokens.color.accent}` : undefined
        }}
      >
        {filtering ? '검색 결과가 없습니다.' : '이 폴더는 비어 있습니다.'}
      </div>
    )
  }

  // FileRow 1개 생성(윈도 본문 + sticky 밴드 공용).
  function renderRow(i: number, entry: FileEntryDTO): JSX.Element {
    const row = Math.floor(i / colCount)
    const col = i % colCount
    const top = row * cellH
    const selected = selection?.selectedPaths.has(entry.path) ?? false
    const pinned = pinnedHere?.includes(entry.path) ?? false
    const renaming = renameTarget?.panelId === panelId && renameTarget.path === entry.path
    const dropHi =
      drag.active &&
      entry.isDir &&
      drag.target?.panelId === panelId &&
      drag.target.overEntryPath === entry.path &&
      drag.allowed
    return (
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
        pinned={pinned}
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
        onMouseDownSelect={onRowMouseDown}
        onClickSelect={onRowClickSelect}
        onDouble={onRowDouble}
        onContext={onRowContext}
        dragSourcesFor={dragSourcesFor}
      />
    )
  }

  // sticky 고정 밴드 행(목록/자세히 전용·colCount=1·top=i*cellH 로컬=글로벌).
  const stickyRows: JSX.Element[] = []
  if (sticky) {
    for (let i = 0; i < stickyCount; i++) {
      const entry = visible[i]
      if (entry) stickyRows.push(renderRow(i, entry))
    }
  }

  // 렌더 윈도(가시 + 오버스캔). 고정 행(i<stickyCount)은 sticky 밴드에서 렌더하므로 본문에서 제외.
  const rows: JSX.Element[] = []
  for (let i = startIdx; i < endIdx; i++) {
    const entry = visible[i]
    if (!entry) continue
    if (sticky && i < stickyCount) continue
    rows.push(renderRow(i, entry))
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
      onDragOver={emptyAreaHtml5.onDragOver}
      onDragLeave={emptyAreaHtml5.onDragLeave}
      onDrop={emptyAreaHtml5.onDrop}
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
        // N1: 배경 투명(워터마크 노출). 패널 배경색은 Panel 외곽이 동일 tokens.color.bg 로 제공.
        background: 'transparent',
        boxShadow: panelDropHighlight ? `inset 0 0 0 2px ${tokens.color.accent}` : undefined
      }}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        {sticky && stickyCount > 0 && (
          <div
            style={{
              position: 'sticky',
              top: 0,
              zIndex: 3,
              height: stickyBandH,
              // 고정 영역을 본문과 구분되게: 대체 배경(bgAlt·헤더/툴바 색) + 강조 하단 구분선.
              // 스크롤되는 본문을 가리도록 불투명해야 한다.
              background: tokens.color.bgAlt,
              boxShadow: `inset 0 -2px 0 ${tokens.color.borderStrong}`
            }}
          >
            {stickyRows}
          </div>
        )}
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
  /** 상단 고정 여부(목록 최상단 배치 + 핀 표식). */
  pinned: boolean
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
  onMouseDownSelect: (index: number, e: React.MouseEvent) => void
  onClickSelect: (index: number, e: React.MouseEvent) => void
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
  pinned,
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
  onMouseDownSelect,
  onClickSelect,
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
  // 행 드래그는 native HTML5 dragstart 로 시작(§M M1: allLocal 은 OS 인계, 내부 드롭은
  // onDrop 이 즉시 처리). 드래그 컨텍스트(출발 패널/폴더)도 여기서 등록한다.
  const extDrag = useExternalDragSource(panelId, panelPath, () => dragSourcesFor(entry))
  const folderDrop = useDropTarget({
    panelId,
    destDir: entry.path,
    overEntryPath: entry.isDir ? entry.path : null
  })
  // 폴더 행 HTML5 드롭(드롭 즉시 이동). 파일 행은 드롭 타겟 아님(컨테이너로 버블 → 현재 폴더).
  const folderHtml5 = useHtml5DropTarget({
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
        onMouseDown={(e) => onMouseDownSelect(index, e)}
        onClick={(e) => onClickSelect(index, e)}
        onContextMenu={(e) => onContext(index, entry, e)}
        onPointerDown={renaming ? undefined : dragSrc.onPointerDown}
        draggable={renaming ? false : extDrag.draggable}
        onDragStart={renaming ? undefined : extDrag.onDragStart}
        onDragEnd={renaming ? undefined : extDrag.onDragEnd}
        onPointerEnter={entry.isDir ? folderDrop.onPointerEnter : undefined}
        onPointerLeave={entry.isDir ? folderDrop.onPointerLeave : undefined}
        onDragOver={entry.isDir ? folderHtml5.onDragOver : undefined}
        onDragLeave={entry.isDir ? folderHtml5.onDragLeave : undefined}
        onDrop={entry.isDir ? folderHtml5.onDrop : undefined}
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
        {pinned && (
          <span
            aria-label="상단 고정됨"
            title="상단 고정됨"
            style={{
              position: 'absolute',
              top: 2,
              left: 4,
              fontSize: 11,
              lineHeight: 1,
              pointerEvents: 'none'
            }}
          >
            📌
          </span>
        )}
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
          {/* 그리드 셀이고 이미지면 실제 내용 썸네일 시도, 아니면(또는 폴백) OSIcon. */}
          {!entry.isDir && isThumbnailableExt(entry.ext.toLowerCase()) ? (
            <ThumbnailIcon entry={entry} size={grid.icon} />
          ) : (
            <OSIcon entry={entry} size={grid.icon} />
          )}
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
      onMouseDown={(e) => onMouseDownSelect(index, e)}
      onClick={(e) => onClickSelect(index, e)}
      onContextMenu={(e) => onContext(index, entry, e)}
      onPointerDown={renaming ? undefined : dragSrc.onPointerDown}
      draggable={renaming ? false : extDrag.draggable}
      onDragStart={renaming ? undefined : extDrag.onDragStart}
      onDragEnd={renaming ? undefined : extDrag.onDragEnd}
      onPointerEnter={entry.isDir ? folderDrop.onPointerEnter : undefined}
      onPointerLeave={entry.isDir ? folderDrop.onPointerLeave : undefined}
      onDragOver={entry.isDir ? folderHtml5.onDragOver : undefined}
      onDragLeave={entry.isDir ? folderHtml5.onDragLeave : undefined}
      onDrop={entry.isDir ? folderHtml5.onDrop : undefined}
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
      {pinned && (
        <span
          aria-label="상단 고정됨"
          title="상단 고정됨"
          style={{ flex: '0 0 auto', fontSize: 11, lineHeight: 1, marginLeft: -2 }}
        >
          📌
        </span>
      )}
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
 * OSIcon — 항목 아이콘. **파일**은 OS 실제 아이콘(확장자 캐시, H6), **폴더/드라이브**는
 * 결정적 SVG 글리프(노란 폴더 / 회색 디스크 / 링크 폴더+화살표).
 *
 * 폴더/드라이브에 OS 아이콘을 쓰던 방식은 정션(재배치 AppData 등) 환경에서 공유 '__dir__'
 * 캐시가 디스크 아이콘으로 오염돼 일반 폴더가 디스크로 보이는 문제가 있어 글리프로 표준화했다.
 * 파일 OS 아이콘 캐시는 useSyncExternalStore 구독 유지(셀렉터 격리, SA §5.2).
 */
function OSIcon({ entry, size = 16 }: { entry: FileEntryDTO; size?: number }): JSX.Element {
  const isDir = entry.isDir
  const key = iconKeyFor(entry)
  const dataUrl = useSyncExternalStore(subscribeIcon, () => getCachedIcon(key))

  useEffect(() => {
    // 파일만 OS 아이콘 로드(폴더/드라이브는 결정적 SVG → 요청 불요).
    if (!isDir && !getCachedIcon(key)) void requestIcon(entry)
  }, [key, entry, isDir])

  if (isDir) {
    if (isDriveFolder(entry)) return <DriveGlyph size={size} />
    return <FolderGlyph size={size} link={isLinkFolder(entry)} />
  }

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
  return (
    <span aria-hidden style={{ fontSize: size > 16 ? size * 0.8 : undefined }}>
      📄
    </span>
  )
}

/**
 * 썸네일 요청 DPR — 셀 아이콘 px × DPR 로 버킷 size 를 산출(레티나에서 선명도 확보).
 * 상한 2 로 클램프해 4K/스케일 환경에서도 버킷이 [32,48,64,96,128] 범위를 넘지 않게 한다
 * (guard 의 size 화이트리스트 통과 보장 + 메모리/디코드 폭주 방지). 모듈 로드 시 1회 산출.
 */
const THUMB_DPR = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1)

/**
 * ThumbnailIcon — 그리드 셀의 이미지 entry 를 실제 내용 축소 썸네일로 표시(feat-L1, 계획서 §5.3).
 *
 * OSIcon 동형: 전역 썸네일 캐시(infra/icon/thumbnailCache, app/usecases/thumbnails 경유)를
 * useSyncExternalStore 로 구독한다. 같은 path+size 키는 IPC 1회만(in-flight 디듀프), 실패/미지원은
 * 음성 캐시로 재요청 억제. 가시 셀만 요청은 윈도잉 루프가 보장(가시범위 밖 셀은 언마운트).
 *
 *   (a) 썸네일 dataUrl 있음 → <img objectFit:contain>(비율 보존·레터박스, 정사각 셀에서 왜곡 없음).
 *   (b) 미로드/폴백(null) → OSIcon(기존 H6) — 로딩 중에도 OS 아이콘이 자연스러운 자리표시.
 * 비이미지(폴더·미지원 ext)는 호출측(그리드 분기)에서 곧장 OSIcon 으로 분기되어 여기 도달 안 함.
 */
function ThumbnailIcon({ entry, size }: { entry: FileEntryDTO; size: number }): JSX.Element {
  // 요청 size = 셀 아이콘 px × DPR → 버킷 스냅(THUMB_SIZE_BUCKETS, guard 화이트리스트와 동일).
  const px = thumbSizeFor(size, THUMB_DPR)
  const key = thumbnailKeyFor(entry.path, px)
  const dataUrl = useSyncExternalStore(subscribeThumbnail, () => getCachedThumbnail(key))

  useEffect(() => {
    // 미캐시(성공/음성 어느 쪽도 없음)면 1회 요청 — 캐시는 requestThumbnail 내부에서 디듀프.
    if (getCachedThumbnail(key) === undefined) void requestThumbnail(entry.path, px)
  }, [key, entry.path, px])

  if (dataUrl) {
    // 비율 보존(objectFit:contain) — 비정사각 이미지가 정사각 셀에서 왜곡되지 않고 레터박스.
    return (
      <img
        src={dataUrl}
        alt=""
        draggable={false}
        style={{ objectFit: 'contain', maxWidth: size, maxHeight: size }}
      />
    )
  }
  // 미로드/폴백(null=음성 캐시) → OSIcon 폴백(기존 H6).
  return <OSIcon entry={entry} size={size} />
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
