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
import { execCommand } from '@renderer/app/usecases/commandBus'
import { baseName, MY_PC_LABEL } from '@renderer/domain/paths'
import { resolveDriveLabel } from '@renderer/app/selectors/driveLabel'
import { tokens } from '@renderer/ui/theme/tokens'
import { DriveGlyph, FolderGlyph } from '@renderer/ui/icons/glyphs'
import { SplitDivider } from '@renderer/ui/layout/SplitDivider'
import {
  beginFavoriteReorder,
  endFavoriteReorder,
  resolveDropTarget,
  setFavoriteInsertIndex,
  useFavoriteReorder
} from '@renderer/ui/sidebar/useFavoriteReorder'

const sectionHeader: React.CSSProperties = {
  padding: '6px 8px 2px',
  fontWeight: 600,
  color: tokens.color.textMuted,
  fontSize: 11,
  display: 'flex',
  alignItems: 'center'
}

interface SidebarProps {
  /** 폭 조절(SplitDivider)의 비율→px 환산 기준(App 본문 row 컨테이너). */
  readonly containerRef: React.RefObject<HTMLElement>
}

/** 사이드바 기본 폭(접기 핸들 더블클릭 복귀값·setSidebarWidth 클램프 160~560 내). */
const DEFAULT_SIDEBAR_WIDTH = 240

export function Sidebar({ containerRef }: SidebarProps): JSX.Element | null {
  const collapsed = useRootStore((s) => s.sidebarCollapsed)
  const width = useRootStore((s) => s.sidebarWidth)
  const treeRoots = useRootStore((s) => s.treeRoots)
  const loadDrives = useRootStore((s) => s.loadDrives)
  const favorites = useRootStore((s) => s.favorites)
  const recent = useRootStore((s) => s.recent)
  const toggleSidebar = useRootStore((s) => s.toggleSidebar)
  const setSidebarWidth = useRootStore((s) => s.setSidebarWidth)
  // 빠른 위치(다운로드 등 OS 알려진 폴더) — 부팅 시 1회 로드.
  const knownFolders = useRootStore((s) => s.knownFolders)
  const loadKnownFolders = useRootStore((s) => s.loadKnownFolders)

  useEffect(() => {
    if (treeRoots.length === 0) loadDrives()
  }, [treeRoots.length, loadDrives])

  useEffect(() => {
    if (!knownFolders) loadKnownFolders()
  }, [knownFolders, loadKnownFolders])

  // 접힘 상태: 좌측 가장자리에 얇은 세로 스트립(펼치기 핸들)을 남겨 패널 자체에서
  // 다시 펼 수 있게 한다(Ctrl+B·아이콘바 외 발견 가능한 토글 제공).
  if (collapsed) {
    return (
      <div
        style={{
          flex: '0 0 auto',
          width: 26,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          borderRight: `1px solid ${tokens.color.borderStrong}`,
          background: tokens.color.bgAlt
        }}
        aria-label="사이드바(접힘)"
      >
        <button
          onClick={toggleSidebar}
          title="사이드바 펼치기 (Ctrl+B)"
          aria-label="사이드바 펼치기"
          aria-expanded={false}
          style={{
            width: '100%',
            height: 28,
            border: 'none',
            borderBottom: `1px solid ${tokens.color.border}`,
            background: 'transparent',
            color: tokens.color.text,
            cursor: 'pointer',
            fontSize: 13
          }}
        >
          ›
        </button>
        <span
          style={{
            marginTop: 8,
            writingMode: 'vertical-rl',
            fontSize: 12,
            color: tokens.color.textMuted,
            userSelect: 'none'
          }}
        >
          탐색기
        </span>
      </div>
    )
  }

  // 폭 조절(SplitDivider, 우측 경계): 컨테이너 폭 기준 비율 → 사이드바는 좌측이므로 폭 = ratio*cw.
  function onDividerDrag(ratio: number): void {
    const el = containerRef.current
    const cw = el ? el.getBoundingClientRect().width : 0
    if (cw <= 0) return
    setSidebarWidth(ratio * cw)
  }

  return (
    <>
      <div
        style={{
          width,
          flex: `0 0 ${width}px`,
          borderRight: `1px solid ${tokens.color.border}`,
          background: tokens.color.bgAlt,
          display: 'flex',
          flexDirection: 'column',
          userSelect: 'none',
          fontSize: 13
        }}
        aria-label="사이드바"
      >
        {/* 상단 바: 접기 버튼(우측 정렬). 스크롤되지 않게 콘텐츠와 분리. */}
        <div
          style={{
            flex: '0 0 auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            padding: '2px 4px',
            borderBottom: `1px solid ${tokens.color.border}`
          }}
        >
          <button
            onClick={toggleSidebar}
            title="사이드바 접기 (Ctrl+B)"
            aria-label="사이드바 접기"
            aria-expanded={true}
            style={{
              width: 22,
              height: 22,
              border: 'none',
              borderRadius: 4,
              background: 'transparent',
              color: tokens.color.text,
              cursor: 'pointer',
              fontSize: 14,
              lineHeight: 1
            }}
          >
            ‹
          </button>
        </div>
        {/* 스크롤 콘텐츠 */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
          {favorites.length > 0 && <FavoritesSection favorites={favorites} />}

          {knownFolders && (knownFolders.desktop || knownFolders.downloads) && (
            <div aria-label="빠른 위치">
              <div style={sectionHeader}>빠른 위치</div>
              {knownFolders.desktop && (
                <QuickFolderNode icon="🖳" label="바탕화면" path={knownFolders.desktop} />
              )}
              {knownFolders.downloads && (
                <QuickFolderNode icon="⬇️" label="다운로드" path={knownFolders.downloads} />
              )}
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

          <div style={sectionHeader}>원격</div>
          <RemoteSection />

          <div style={sectionHeader}>도구</div>
          <TrashNode />
          <AgentNode />
        </div>
      </div>
      <SplitDivider
        orientation="vertical"
        containerRef={containerRef}
        onDrag={onDividerDrag}
        onReset={() => setSidebarWidth(DEFAULT_SIDEBAR_WIDTH)}
      />
    </>
  )
}

/**
 * 원격 섹션(§M M3) — 활성 세션 목록(클릭=해당 원격 루트로 이동) + "연결" 진입점.
 * 연결 다이얼로그는 commandBus 'remote.open' → uiSlice.openRemoteDialog.
 */
function RemoteSection(): JSX.Element {
  const sessions = useRootStore((s) => s.remoteSessions)
  const list = Object.values(sessions)
  return (
    <div aria-label="원격 연결">
      {list.map((sess) => {
        const rootUri = `${sess.profile.protocol}://${sess.profile.host}/`
        return (
          <div
            key={sess.sessionId}
            onClick={() => {
              const s = useRootStore.getState()
              const pid = s.activePanelId()
              if (pid) s.navigate(pid, rootUri, true)
            }}
            title={`${sess.profile.protocol}://${sess.profile.username}@${sess.profile.host}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '3px 8px',
              cursor: 'pointer',
              fontSize: 12,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            <span style={{ width: 14 }} />
            <span>{sess.encrypted ? '🔒' : '⚠'}</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {sess.profile.name || sess.profile.host}
            </span>
          </div>
        )
      })}
      <div
        onClick={() => execCommand('remote.open')}
        title="원격 서버 연결(FTP/SFTP)"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '3px 8px',
          cursor: 'pointer',
          color: tokens.color.textMuted
        }}
      >
        <span style={{ width: 14 }} />
        <span>🌐</span>
        <span>연결…</span>
      </div>
    </div>
  )
}

/** 휴지통 관리 화면 진입 노드(K장 K2). 클릭 → commandBus 'trash.open'. */
function TrashNode(): JSX.Element {
  const open = useRootStore((s) => s.trashOpen)
  return (
    <div
      onClick={() => execCommand('trash.open')}
      title="휴지통 관리"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '3px 8px',
        cursor: 'pointer',
        background: open ? tokens.color.bgSelected : 'transparent'
      }}
    >
      <span style={{ width: 14 }} />
      <span>🗑</span>
      <span>휴지통</span>
    </div>
  )
}

/** AI 에이전트 패널 진입 노드(§Z Z1). 클릭 → commandBus 'agent.ask'(읽기 전용 Q&A). */
function AgentNode(): JSX.Element {
  const open = useRootStore((s) => s.agentPanelOpen)
  return (
    <div
      onClick={() => execCommand('agent.ask')}
      title="에이전트에게 묻기(읽기 전용·Ctrl+Shift+A)"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '3px 8px',
        cursor: 'pointer',
        background: open ? tokens.color.bgSelected : 'transparent'
      }}
    >
      <span style={{ width: 14 }} />
      <span>✨</span>
      <span>에이전트에게 묻기</span>
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
 * 즐겨찾기 섹션(N2·US-13.2·F18) — 드래그 정렬·키보드 대체수단·정렬 ARIA.
 *
 * - 순서 = favorites 배열 자체(별도 order 필드 0). 재배열은 reorderFavorite.
 * - 드래그: HTML5 draggable + 경량 외부 스토어(useFavoriteReorder)로 삽입 위치 추적.
 *   섹션 컨테이너 안에서만 인덱스 계산 → 타 섹션(트리/최근/원격/휴지통) 무영향.
 * - 키보드: 항목 포커스(tabindex) 후 Alt+Shift+↑/↓ 로 위/아래 한 칸 이동
 *   (전역 KeyBindingRegistry 미배정 조합 → Sidebar 로컬 onKeyDown 정상 동작).
 * - ARIA: role="listbox" 유사·항목 aria-posinset/setsize·드래그 중 aria-grabbed.
 * - 0~1개 경계: 0개=섹션 미렌더(호출부 가드), 1개=드래그 시작 허용하되 원위치.
 */
function FavoritesSection({ favorites }: { favorites: string[] }): JSX.Element {
  const reorder = useFavoriteReorder()
  return (
    <div aria-label="즐겨찾기">
      <div style={sectionHeader}>★ 즐겨찾기</div>
      <div role="listbox" aria-label="즐겨찾기 목록" aria-orientation="vertical">
        {favorites.map((p, i) => (
          <FavoriteRow
            key={p}
            path={p}
            index={i}
            total={favorites.length}
            reorderActive={reorder.active}
            reorderFrom={reorder.fromIndex}
            insertIndex={reorder.insertIndex}
          />
        ))}
      </div>
    </div>
  )
}

/**
 * 즐겨찾기 항목 1개(클릭=이동, ✎/더블클릭=별칭 편집, ✕=제거, J8 + N2 정렬).
 * 표시 라벨 = 별칭(favoriteLabel) 우선, 없으면 basename. tooltip 은 fullPath 유지.
 */
function FavoriteRow({
  path,
  index,
  total,
  reorderActive,
  reorderFrom,
  insertIndex
}: {
  path: string
  index: number
  total: number
  reorderActive: boolean
  reorderFrom: number
  insertIndex: number
}): JSX.Element {
  const navigateActive = useNavigateActive()
  const removeFavorite = useRootStore((s) => s.removeFavorite)
  const label = useRootStore((s) => s.favoriteLabels[path])
  const setFavoriteLabel = useRootStore((s) => s.setFavoriteLabel)
  const activePath = useActivePanelPath()
  const selected = activePath === path
  const [editing, setEditing] = useState(false)
  // 별칭이 있으면 별칭, 없으면 드라이브 루트는 볼륨 라벨("Windows (C:)")·그 외 baseName.
  const driveOrBase = useRootStore((s) => resolveDriveLabel(path, s.tree, baseName(path)))
  const display = label && label.trim() !== '' ? label : driveOrBase
  const rowRef = useRef<HTMLDivElement | null>(null)

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

  // 키보드 한 칸 이동(Alt+Shift+↑/↓). 미배정 조합이라 전역 디스패처가 가로채지 않음.
  function onKeyDown(e: React.KeyboardEvent): void {
    if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey) return
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    const to = e.key === 'ArrowUp' ? index - 1 : index + 1
    if (to < 0 || to >= total) return // 유일 항목·경계는 무동작.
    e.preventDefault()
    e.stopPropagation()
    useRootStore.getState().reorderFavorite(index, to)
    // 포커스 추종: 다음 틱에 이동한 항목 위치로 포커스 복원.
    requestAnimationFrame(() => rowRef.current?.focus())
  }

  // 드래그 중 삽입 인디케이터: 이 행 위(insertIndex===index)·맨 끝(insertIndex===total).
  const showLineBefore = reorderActive && insertIndex === index && reorderFrom !== index
  const showLineAfter = reorderActive && index === total - 1 && insertIndex === total && reorderFrom !== index
  const isDragging = reorderActive && reorderFrom === index

  return (
    <div
      ref={rowRef}
      role="option"
      aria-selected={selected}
      aria-posinset={index + 1}
      aria-setsize={total}
      aria-grabbed={isDragging}
      aria-roledescription="정렬 가능한 즐겨찾기"
      tabIndex={0}
      draggable
      onKeyDown={onKeyDown}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        // 일부 브라우저는 데이터가 있어야 드래그 시작 — 더미 텍스트.
        e.dataTransfer.setData('text/plain', String(index))
        beginFavoriteReorder(index)
      }}
      onDragOver={(e) => {
        if (!reorderActive) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        // 행 상/하 절반으로 앞/뒤 삽입 위치 결정.
        const rect = e.currentTarget.getBoundingClientRect()
        const after = e.clientY - rect.top > rect.height / 2
        setFavoriteInsertIndex(after ? index + 1 : index)
      }}
      onDrop={(e) => {
        e.preventDefault()
        const to = resolveDropTarget(reorderFrom, insertIndex, total)
        if (to !== null) useRootStore.getState().reorderFavorite(reorderFrom, to)
        endFavoriteReorder()
      }}
      onDragEnd={() => endFavoriteReorder()}
      style={{ position: 'relative', opacity: isDragging ? 0.4 : 1 }}
    >
      {showLineBefore && <DropLine />}
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
      {showLineAfter && <DropLine />}
    </div>
  )
}

/** 드래그 중 삽입 위치 인디케이터(행 사이 선, N2). */
function DropLine(): JSX.Element {
  return (
    <div
      aria-hidden="true"
      style={{
        height: 2,
        margin: '0 6px',
        background: tokens.color.accent,
        borderRadius: 1,
        pointerEvents: 'none'
      }}
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
  // 드라이브 루트(C:\)는 볼륨 라벨("Windows (C:)")로 표시 — 트리 드라이브 노드의 label 재사용
  // (드라이브 열거 시 fs:drives 가 채움). 미로드/비-드라이브면 baseName 폴백(공용 해석기).
  const label = useRootStore((s) => resolveDriveLabel(path, s.tree, baseName(path)))
  return (
    <PinnedRow
      icon="🕘"
      label={label}
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

/** 빠른 위치 노드 1개(다운로드 등). 클릭 = 활성 패널을 그 폴더로 이동. */
function QuickFolderNode({
  icon,
  label,
  path
}: {
  icon: string
  label: string
  path: string
}): JSX.Element {
  const navigateActive = useNavigateActive()
  const activePath = useActivePanelPath()
  const selected = activePath === path
  return (
    <div
      onClick={() => navigateActive(path)}
      title={path}
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
        <span onClick={() => navigateActive(node.path)} style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, minWidth: 0 }}>
          <span style={{ display: 'inline-flex', flex: '0 0 auto' }}>
            {node.kind === 'drive' ? <DriveGlyph size={15} /> : <FolderGlyph size={15} />}
          </span>
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
