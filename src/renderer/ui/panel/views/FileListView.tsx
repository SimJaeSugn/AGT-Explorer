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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FileEntryDTO } from '@shared/dto'
import { useRootStore } from '@renderer/app/stores/rootStore'
import { computeVisible } from '@renderer/app/usecases/selectors'
import { activateEntry } from '@renderer/app/usecases/open'
import { commitRename } from '@renderer/app/usecases/fileOps'
import { openEmptyContextMenu, openRowContextMenu } from '@renderer/app/usecases/contextMenu'
import { highlightRange } from '@renderer/domain/rules/filter'
import { tokens } from '@renderer/ui/theme/tokens'
import { useDragSource, useDropTarget, useDragState } from '@renderer/ui/dnd/useDrag'

const OVERSCAN = 6

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

  const clickSelect = useRootStore((s) => s.clickSelect)
  const selectAll = useRootStore((s) => s.selectAll)
  const moveSelect = useRootStore((s) => s.moveSelect)
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

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop)
  }, [])

  const isGrid = false // grid 보기는 Should(P6). P2 는 list/details 만.
  const rowH = tokens.rowHeight

  // 윈도잉 계산.
  const colCount = isGrid ? Math.max(1, Math.floor(viewportW / tokens.gridCell.w)) : 1
  const cellH = isGrid ? tokens.gridCell.h : rowH
  const rowCount = Math.ceil(visible.length / colCount)
  const totalHeight = rowCount * cellH
  const startRow = Math.max(0, Math.floor(scrollTop / cellH) - OVERSCAN)
  const endRow = Math.min(rowCount, Math.ceil((scrollTop + viewportH) / cellH) + OVERSCAN)
  const startIdx = startRow * colCount
  const endIdx = Math.min(visible.length, endRow * colCount)

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
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const cur = selection && selection.anchorIndex >= 0 ? selection.anchorIndex : -1
        const delta = e.key === 'ArrowDown' ? 1 : -1
        const next = Math.max(0, Math.min(visible.length - 1, cur + delta))
        moveSelect(panelId, visiblePaths, next)
        // 가시 영역으로 스크롤.
        const el = scrollRef.current
        if (el) {
          const top = next * cellH
          if (top < el.scrollTop) el.scrollTop = top
          else if (top + cellH > el.scrollTop + el.clientHeight) {
            el.scrollTop = top + cellH - el.clientHeight
          }
        }
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault()
        selectAll(panelId, visiblePaths)
      }
    },
    [selection, visible.length, moveSelect, panelId, visiblePaths, cellH, selectAll]
  )

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
        top={top}
        left={isGrid ? col * tokens.gridCell.w : 0}
        width={isGrid ? tokens.gridCell.w : '100%'}
        height={cellH}
        selected={selected}
        active={active}
        details={view.viewMode === 'details'}
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
        outline: 'none',
        background: tokens.color.bg,
        boxShadow: panelDropHighlight ? `inset 0 0 0 2px ${tokens.color.accent}` : undefined
      }}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>{rows}</div>
      {directory.status === 'streaming' && (
        <div
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
  top: number
  left: number | string
  width: number | string
  height: number
  selected: boolean
  active: boolean
  details: boolean
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
  top,
  left,
  width,
  height,
  selected,
  active,
  details,
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
  const icon = entry.isDir ? '📁' : '📄'
  const dim = entry.attrs.hidden || entry.attrs.system ? 0.55 : 1

  // 드래그 소스(이 행에서 시작) + 폴더면 드롭 타겟(그 폴더 안).
  const dragSrc = useDragSource(panelId, panelPath, () => dragSourcesFor(entry))
  const folderDrop = useDropTarget({
    panelId,
    destDir: entry.path,
    overEntryPath: entry.isDir ? entry.path : null
  })

  return (
    <div
      role="row"
      aria-selected={selected}
      aria-label={`${name}${entry.isDir ? ', 폴더' : ', 파일'}`}
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
      <span style={{ flex: '0 0 auto' }}>{icon}</span>
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
        fontFamily: tokens.font,
        outline: 'none'
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
