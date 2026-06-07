/**
 * Sidebar — 즐겨찾기·최근 + 트리(내 PC·드라이브→폴더 lazy 확장) (US-3.2/US-3.3).
 *
 * roadmap P2: 드라이브 열거 → 노드, 폴더 펼침 시 fs:tree-children 지연 확장.
 * P5b: 즐겨찾기(고정/제거)·최근(자동기록·개별/전체 삭제·recentLimit) 섹션.
 * 노드 클릭 시 활성 패널 경로 변경. 토글/폭조절 지원.
 *
 * 셀렉터 격리: 트리 노드 평탄 맵에서 자기 노드만 구독.
 */
import { useEffect, useRef, useState } from 'react'
import { useRootStore } from '@renderer/app/stores/rootStore'
import { baseName, MY_PC_LABEL } from '@renderer/domain/paths'
import { tokens } from '@renderer/ui/theme/tokens'

const sectionHeader: React.CSSProperties = {
  padding: '6px 8px 2px',
  fontWeight: 600,
  color: tokens.color.textMuted,
  fontSize: 11,
  display: 'flex',
  alignItems: 'center'
}

export function Sidebar(): JSX.Element | null {
  const collapsed = useRootStore((s) => s.sidebarCollapsed)
  const width = useRootStore((s) => s.sidebarWidth)
  const treeRoots = useRootStore((s) => s.treeRoots)
  const loadDrives = useRootStore((s) => s.loadDrives)
  const favorites = useRootStore((s) => s.favorites)
  const recent = useRootStore((s) => s.recent)

  useEffect(() => {
    if (treeRoots.length === 0) loadDrives()
  }, [treeRoots.length, loadDrives])

  if (collapsed) return null

  return (
    <div
      style={{
        width,
        flex: `0 0 ${width}px`,
        borderRight: `1px solid ${tokens.color.border}`,
        background: tokens.color.bgAlt,
        overflowY: 'auto',
        overflowX: 'hidden',
        userSelect: 'none',
        fontSize: 13
      }}
      aria-label="사이드바"
    >
      {favorites.length > 0 && (
        <div aria-label="즐겨찾기">
          <div style={sectionHeader}>★ 즐겨찾기</div>
          {favorites.map((p) => (
            <FavoriteRow key={p} path={p} />
          ))}
        </div>
      )}

      {recent.length > 0 && (
        <div aria-label="최근">
          <div style={sectionHeader}>
            <span>최근</span>
            <button
              onClick={() => useRootStore.getState().clearRecent()}
              title="최근 목록 비우기"
              aria-label="최근 목록 비우기"
              style={clearBtnStyle}
            >
              지우기
            </button>
          </div>
          {recent.map((p) => (
            <RecentRow key={p} path={p} />
          ))}
        </div>
      )}

      <div style={sectionHeader}>탐색</div>
      <MyPcNode />
      {treeRoots.map((root) => (
        <TreeNodeView key={root} path={root} depth={1} />
      ))}
    </div>
  )
}

const clearBtnStyle: React.CSSProperties = {
  marginLeft: 'auto',
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  color: tokens.color.textMuted,
  fontSize: 10,
  textDecoration: 'underline'
}

/**
 * 즐겨찾기 항목 1개(클릭=이동, ✎/더블클릭=별칭 편집, ✕=제거, J8).
 * 표시 라벨 = 별칭(favoriteLabel) 우선, 없으면 basename. tooltip 은 fullPath 유지.
 */
function FavoriteRow({ path }: { path: string }): JSX.Element {
  const navigateActive = useNavigateActive()
  const removeFavorite = useRootStore((s) => s.removeFavorite)
  const label = useRootStore((s) => s.favoriteLabels[path])
  const setFavoriteLabel = useRootStore((s) => s.setFavoriteLabel)
  const activePath = useActivePanelPath()
  const selected = activePath === path
  const [editing, setEditing] = useState(false)
  const display = label && label.trim() !== '' ? label : baseName(path)

  if (editing) {
    return (
      <FavoriteLabelInput
        initial={label ?? ''}
        onCommit={(v) => {
          setFavoriteLabel(path, v)
          setEditing(false)
        }}
        onCancel={() => setEditing(false)}
      />
    )
  }

  return (
    <PinnedRow
      icon="📂"
      label={display}
      fullPath={path}
      selected={selected}
      onClick={() => navigateActive(path)}
      onDoubleClick={() => setEditing(true)}
      onRename={() => setEditing(true)}
      renameLabel="이름변경(별칭)"
      onRemove={() => removeFavorite(path)}
      removeLabel="즐겨찾기 제거"
    />
  )
}

/** 즐겨찾기 별칭 인라인 편집 input(Enter=커밋, Esc=취소, blur=커밋, J8). */
function FavoriteLabelInput({
  initial,
  onCommit,
  onCancel
}: {
  initial: string
  onCommit: (value: string) => void
  onCancel: () => void
}): JSX.Element {
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLInputElement | null>(null)
  const committedRef = useRef(false)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  function commit(): void {
    if (committedRef.current) return
    committedRef.current = true
    onCommit(value)
  }

  return (
    <div style={{ padding: '2px 8px' }}>
      <input
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            committedRef.current = true
            onCancel()
          }
        }}
        onBlur={commit}
        spellCheck={false}
        aria-label="즐겨찾기 별칭 편집"
        placeholder="별칭(빈 값=기본 이름)"
        style={{
          width: '100%',
          height: 22,
          boxSizing: 'border-box',
          border: `1px solid ${tokens.color.accentBorder}`,
          borderRadius: 3,
          padding: '0 6px',
          fontSize: 12,
          fontFamily: tokens.font
          // 키보드 포커스 가시성은 전역 :focus-visible(a11y CSS)에 위임.
        }}
      />
    </div>
  )
}

/** 최근 항목 1개(클릭=이동, ✕=제거). */
function RecentRow({ path }: { path: string }): JSX.Element {
  const navigateActive = useNavigateActive()
  const removeRecent = useRootStore((s) => s.removeRecent)
  const activePath = useActivePanelPath()
  const selected = activePath === path
  return (
    <PinnedRow
      icon="🕘"
      label={baseName(path)}
      fullPath={path}
      selected={selected}
      onClick={() => navigateActive(path)}
      onRemove={() => removeRecent(path)}
      removeLabel="최근에서 제거"
    />
  )
}

interface PinnedRowProps {
  icon: string
  label: string
  fullPath: string
  selected: boolean
  onClick: () => void
  onRemove: () => void
  removeLabel: string
  /** 더블클릭 핸들러(즐겨찾기 별칭 편집 진입, J8). 없으면 미설정. */
  onDoubleClick?: () => void
  /** ✎ 이름변경 버튼 핸들러(있으면 버튼 표시, J8). */
  onRename?: () => void
  renameLabel?: string
}

const rowIconBtnStyle: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  color: tokens.color.textMuted,
  fontSize: 11,
  flex: '0 0 auto'
}

function PinnedRow({
  icon,
  label,
  fullPath,
  selected,
  onClick,
  onRemove,
  removeLabel,
  onDoubleClick,
  onRename,
  renameLabel
}: PinnedRowProps): JSX.Element {
  return (
    <div
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      title={fullPath}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '3px 8px',
        cursor: 'pointer',
        background: selected ? tokens.color.bgSelected : 'transparent'
      }}
    >
      <span style={{ width: 14, textAlign: 'center' }}>{icon}</span>
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </span>
      {onRename && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onRename()
          }}
          aria-label={renameLabel ?? '이름변경'}
          title={renameLabel ?? '이름변경'}
          style={rowIconBtnStyle}
        >
          ✎
        </button>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }}
        aria-label={removeLabel}
        title={removeLabel}
        style={rowIconBtnStyle}
      >
        ✕
      </button>
    </div>
  )
}

function MyPcNode(): JSX.Element {
  const navigateActive = useNavigateActive()
  const activePath = useActivePanelPath()
  const selected = activePath === ''
  return (
    <div
      onClick={() => navigateActive('')}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '3px 8px',
        cursor: 'pointer',
        background: selected ? tokens.color.bgSelected : 'transparent'
      }}
    >
      <span style={{ width: 14 }} />
      <span>🖥️</span>
      <span>{MY_PC_LABEL}</span>
    </div>
  )
}

function TreeNodeView({ path, depth }: { path: string; depth: number }): JSX.Element | null {
  const node = useRootStore((s) => s.tree[path])
  const toggle = useRootStore((s) => s.toggleTreeNode)
  const navigateActive = useNavigateActive()
  const activePath = useActivePanelPath()

  if (!node) return null
  const hasChevron = node.kind === 'drive' || node.childPaths === null || (node.childPaths?.length ?? 0) > 0
  const selected = activePath === node.path

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '3px 8px',
          paddingLeft: 8 + depth * 12,
          cursor: 'pointer',
          background: selected ? tokens.color.bgSelected : 'transparent'
        }}
      >
        <span
          onClick={(e) => {
            e.stopPropagation()
            toggle(node.path)
          }}
          style={{ width: 14, display: 'inline-flex', justifyContent: 'center', color: tokens.color.textMuted }}
        >
          {hasChevron ? (node.loading ? '…' : node.expanded ? '▾' : '▸') : ''}
        </span>
        <span onClick={() => navigateActive(node.path)} style={{ display: 'flex', gap: 4, flex: 1, minWidth: 0 }}>
          <span>{node.kind === 'drive' ? '💽' : '📁'}</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {node.label}
          </span>
        </span>
      </div>
      {node.expanded &&
        node.childPaths &&
        node.childPaths.map((child) => <TreeNodeView key={child} path={child} depth={depth + 1} />)}
    </div>
  )
}

/** 활성 패널 경로 구독. */
function useActivePanelPath(): string {
  return useRootStore((s) => {
    const pid = s.tabs[s.activeTabId]?.activePanelId
    return pid ? (s.panels[pid]?.path ?? '') : ''
  })
}

/** 활성 패널로 경로 이동 액션. */
function useNavigateActive(): (path: string) => void {
  const navigate = useRootStore((s) => s.navigate)
  return (path: string) => {
    const st = useRootStore.getState()
    const pid = st.tabs[st.activeTabId]?.activePanelId
    if (pid) navigate(pid, path, true)
  }
}
