/**
 * TabBar — 탭 추가/닫기/전환/드래그 순서/복제 (US-1.1).
 *
 * roadmap P3: Ctrl+T/W/Tab/1~9·가운데클릭 닫기·드래그 순서·Ctrl+D 복제·
 * Ctrl+Shift+T 복원(키는 디스패처). 여기서는 마우스 UI 와 액션 호출.
 * 탭 라벨은 사용자 지정 이름(customName) 또는 활성 패널 경로의 마지막 세그먼트.
 *
 * Feature A(사용자 지정 이름)·US-20.3(탭 색상/잠금):
 *  - 더블클릭 또는 컨텍스트 메뉴 "이름 바꾸기" → 인라인 입력(RenameInput 패턴 미러).
 *  - 우클릭 → 이름 바꾸기 / 색상(TAG_PALETTE 재사용) / 잠금·잠금 해제.
 *  - 색상 설정 시 좌측 색상 막대, 잠긴 탭은 자물쇠 글리프 + 닫기 가드(× 숨김).
 */
import { useEffect, useRef, useState } from 'react'
import { useRootStore } from '@renderer/app/stores/rootStore'
import { baseName, MY_PC_LABEL } from '@renderer/domain/paths'
import { resolveDriveLabel } from '@renderer/app/selectors/driveLabel'
import { requestNewTab } from '@renderer/app/usecases/newTab'
import { splitTabToNewWindow } from '@renderer/app/usecases/windowSplit'
import { TAG_PALETTE, tagColorOf } from '@renderer/domain/rules/tags'
import { tokens } from '@renderer/ui/theme/tokens'

/** 탭 컨텍스트 메뉴 위치(없으면 닫힘). */
interface TabMenuState {
  readonly tabId: string
  readonly x: number
  readonly y: number
}

export function TabBar(): JSX.Element {
  const tabOrder = useRootStore((s) => s.tabOrder)
  const activeTabId = useRootStore((s) => s.activeTabId)
  const openSettings = useRootStore((s) => s.openSettings)
  const [dragId, setDragId] = useState<string | null>(null)
  // 인라인 이름 편집 중인 탭 id(없으면 null) — 탭바 로컬 상태(파일 renameTarget 과 분리).
  const [editingId, setEditingId] = useState<string | null>(null)
  // 탭 컨텍스트 메뉴 상태(없으면 닫힘).
  const [menu, setMenu] = useState<TabMenuState | null>(null)

  return (
    <div
      role="tablist"
      aria-label="탭"
      style={{
        display: 'flex',
        alignItems: 'stretch',
        height: 32,
        background: tokens.color.bgAlt,
        borderBottom: `1px solid ${tokens.color.border}`,
        overflowX: 'auto'
      }}
    >
      {tabOrder.map((tabId, idx) => (
        <TabItem
          key={tabId}
          tabId={tabId}
          index={idx}
          active={tabId === activeTabId}
          dragId={dragId}
          setDragId={setDragId}
          editing={editingId === tabId}
          startEdit={() => setEditingId(tabId)}
          endEdit={() => setEditingId(null)}
          openMenu={(x, y) => setMenu({ tabId, x, y })}
        />
      ))}
      <button
        onClick={() => void requestNewTab()}
        title="새 탭 (Ctrl+T)"
        aria-label="새 탭"
        style={{
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          fontSize: 18,
          color: tokens.color.textMuted,
          width: 34,
          flex: '0 0 auto'
        }}
      >
        +
      </button>
      <button
        onClick={openSettings}
        title="설정 (Ctrl+,)"
        aria-label="설정"
        style={{
          marginLeft: 'auto',
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          fontSize: 16,
          color: tokens.color.textMuted,
          width: 36,
          flex: '0 0 auto'
        }}
      >
        ⚙
      </button>
      {menu && (
        <TabContextMenu
          state={menu}
          onClose={() => setMenu(null)}
          onRename={() => {
            setEditingId(menu.tabId)
            setMenu(null)
          }}
        />
      )}
    </div>
  )
}

function TabItem({
  tabId,
  index,
  active,
  dragId,
  setDragId,
  editing,
  startEdit,
  endEdit,
  openMenu
}: {
  tabId: string
  index: number
  active: boolean
  dragId: string | null
  setDragId: (id: string | null) => void
  editing: boolean
  startEdit: () => void
  endEdit: () => void
  openMenu: (x: number, y: number) => void
}): JSX.Element {
  // 자동 제목(폴더명) — 사용자 지정 이름이 있으면 그것을 우선한다.
  const derivedTitle = useRootStore((s) => {
    const tab = s.tabs[tabId]
    if (!tab) return '탭'
    const path = s.panels[tab.activePanelId]?.path ?? ''
    if (path === '') return MY_PC_LABEL
    // 드라이브 루트 탭은 볼륨 라벨 포함 표기("Windows (C:)")로 — 트리 label 재사용.
    return resolveDriveLabel(path, s.tree, baseName(path))
  })
  const customName = useRootStore((s) => s.tabs[tabId]?.customName)
  const colorKey = useRootStore((s) => s.tabs[tabId]?.color)
  const locked = useRootStore((s) => s.tabs[tabId]?.locked ?? false)
  const activateTab = useRootStore((s) => s.activateTab)
  const closeTab = useRootStore((s) => s.closeTab)
  const moveTab = useRootStore((s) => s.moveTab)

  const label = customName && customName.trim() !== '' ? customName : derivedTitle
  const swatch = colorKey ? tagColorOf(colorKey as never)?.color : undefined
  // 색상은 단독 정보가 아니므로 접근성 라벨은 이름 + 잠금 상태만 고지(색상 막대는 aria-hidden).
  const ariaLabel = locked ? `${label} (잠긴 탭)` : label

  return (
    <div
      role="tab"
      aria-selected={active}
      aria-label={ariaLabel}
      draggable={!editing}
      onDragStart={() => setDragId(tabId)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={() => {
        if (dragId && dragId !== tabId) moveTab(dragId, index)
        setDragId(null)
      }}
      onClick={() => {
        if (!editing) activateTab(tabId)
      }}
      onDoubleClick={(e) => {
        // 더블클릭 → 인라인 이름 편집(편집 중이 아닐 때만).
        if (editing) return
        e.preventDefault()
        startEdit()
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        // 우클릭 시 해당 탭 활성화 후 메뉴 열기(명령 일관성).
        activateTab(tabId)
        openMenu(e.clientX, e.clientY)
      }}
      onMouseDown={(e) => {
        // 가운데 클릭 = 닫기(잠긴 탭은 closeTab 내부 가드가 거부).
        if (e.button === 1) {
          e.preventDefault()
          closeTab(tabId)
        }
      }}
      title={label}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '0 8px 0 12px',
        minWidth: 90,
        maxWidth: 200,
        cursor: 'pointer',
        background: active ? tokens.color.bg : 'transparent',
        borderRight: `1px solid ${tokens.color.border}`,
        borderTop: active ? `2px solid ${tokens.color.accent}` : '2px solid transparent',
        fontSize: 13,
        color: active ? tokens.color.text : tokens.color.textMuted
      }}
    >
      {/* 색상 라벨 막대(좌측). 단독 정보 아님 → aria-hidden(이름이 접근 가능 라벨). */}
      {swatch && (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            left: 0,
            top: 4,
            bottom: 4,
            width: 3,
            borderRadius: 2,
            background: swatch
          }}
        />
      )}
      {/* 잠금 글리프(잠긴 탭). 상태는 aria-label 로 고지하므로 글리프는 aria-hidden. */}
      {locked && (
        <span aria-hidden style={{ flex: '0 0 auto', fontSize: 11, color: tokens.color.textMuted }}>
          🔒
        </span>
      )}
      {editing ? (
        <TabRenameInput tabId={tabId} initialName={label} onDone={endEdit} />
      ) : (
        <span
          style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {label}
        </span>
      )}
      {/* 닫기 버튼: 잠긴 탭은 숨긴다(가드 — 명시적 잠금 해제 후 닫기). */}
      {!editing && !locked && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            closeTab(tabId)
          }}
          title="탭 닫기 (Ctrl+W)"
          aria-label="탭 닫기"
          style={{
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            color: tokens.color.textMuted,
            fontSize: 13,
            borderRadius: 3,
            width: 18,
            height: 18
          }}
        >
          ✕
        </button>
      )}
    </div>
  )
}

/**
 * TabRenameInput — 탭 인라인 이름 편집(Feature A). FileListView 의 RenameInput 패턴 미러:
 * autofocus+select · Enter 커밋 · Esc 취소 · blur 커밋. 빈/공백 입력은 사용자 지정 이름을
 * 지워 자동 제목(폴더명)으로 복귀한다(setTabName 이 trim 후 빈값이면 clear).
 */
function TabRenameInput({
  tabId,
  initialName,
  onDone
}: {
  tabId: string
  initialName: string
  onDone: () => void
}): JSX.Element {
  const setTabName = useRootStore((s) => s.setTabName)
  const [value, setValue] = useState(initialName)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const committingRef = useRef(false)

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.focus()
    el.select()
  }, [])

  function commit(): void {
    if (committingRef.current) return
    committingRef.current = true
    // trim 후 빈값이면 자동 제목 복귀(setTabName 내부에서 clear).
    setTabName(tabId, value)
    onDone()
  }

  function cancel(): void {
    if (committingRef.current) return
    committingRef.current = true
    onDone()
  }

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') {
          e.preventDefault()
          commit()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          cancel()
        }
      }}
      onBlur={commit}
      spellCheck={false}
      aria-label="탭 이름 편집"
      style={{
        flex: 1,
        height: 20,
        minWidth: 0,
        boxSizing: 'border-box',
        border: `1px solid ${tokens.color.accentBorder}`,
        borderRadius: 3,
        padding: '0 4px',
        fontSize: 13,
        fontFamily: tokens.font
      }}
    />
  )
}

/**
 * TabContextMenu — 탭 우클릭 메뉴(이름 바꾸기 / 색상 / 잠금). 파일 컨텍스트 메뉴 infra 는
 * 패널/파일 컨텍스트에 결합되어 있어 탭 전용 경량 메뉴를 둔다(색상 팔레트는 TAG_PALETTE 재사용).
 * Esc·바깥 클릭·스크롤·항목 실행 시 닫힌다(파일 메뉴 동작 미러).
 */
function TabContextMenu({
  state,
  onClose,
  onRename
}: {
  state: TabMenuState
  onClose: () => void
  onRename: () => void
}): JSX.Element {
  const tabId = state.tabId
  const colorKey = useRootStore((s) => s.tabs[tabId]?.color)
  const locked = useRootStore((s) => s.tabs[tabId]?.locked ?? false)
  const setTabColor = useRootStore((s) => s.setTabColor)
  const toggleTabLock = useRootStore((s) => s.toggleTabLock)
  const menuRef = useRef<HTMLDivElement | null>(null)

  // 바깥 클릭·스크롤·리사이즈·Esc 시 닫힘(파일 ContextMenu 패턴 미러).
  useEffect(() => {
    function onPointerDown(e: PointerEvent): void {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) return
      onClose()
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('pointerdown', onPointerDown, { capture: true })
    window.addEventListener('keydown', onKey, { capture: true })
    window.addEventListener('wheel', onClose, { capture: true, passive: true })
    window.addEventListener('resize', onClose)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, { capture: true })
      window.removeEventListener('keydown', onKey, { capture: true })
      window.removeEventListener('wheel', onClose, { capture: true })
      window.removeEventListener('resize', onClose)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  // 화면 우측/하단 넘침 보정(간단 클램프).
  const left = Math.min(state.x, window.innerWidth - 200)
  const top = Math.min(state.y, window.innerHeight - 260)

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="탭 메뉴"
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'fixed',
        left: Math.max(6, left),
        top: Math.max(6, top),
        minWidth: 180,
        padding: '4px 0',
        background: tokens.color.bg,
        border: `1px solid ${tokens.color.borderStrong}`,
        borderRadius: 8,
        boxShadow: '0 8px 28px rgba(0,0,0,0.22)',
        fontSize: 13,
        color: tokens.color.text,
        zIndex: 1200,
        userSelect: 'none'
      }}
    >
      <TabMenuRow label="이름 바꾸기" onClick={onRename} />
      {/* U3: 탭을 새 창으로 분리(잠긴 탭은 비활성 — 먼저 잠금 해제). */}
      <TabMenuRow
        label="새 창으로 분리"
        disabled={locked}
        onClick={() => {
          if (locked) return
          void splitTabToNewWindow(tabId)
          onClose()
        }}
      />
      <TabMenuSep />
      {/* 색상 팔레트(TAG_PALETTE 재사용) — 현재 색상에 체크 표시. */}
      <div role="presentation" style={{ padding: '4px 14px 2px', color: tokens.color.textMuted, fontSize: 11 }}>
        색상
      </div>
      {TAG_PALETTE.map((c) => (
        <TabMenuRow
          key={c.key}
          label={c.name}
          dotColor={c.color}
          checked={colorKey === c.key}
          onClick={() => {
            setTabColor(tabId, c.key)
            onClose()
          }}
        />
      ))}
      <TabMenuRow
        label="색상 없음"
        checked={!colorKey}
        onClick={() => {
          setTabColor(tabId, undefined)
          onClose()
        }}
      />
      <TabMenuSep />
      <TabMenuRow
        label={locked ? '잠금 해제' : '잠금'}
        onClick={() => {
          toggleTabLock(tabId)
          onClose()
        }}
      />
    </div>
  )
}

function TabMenuSep(): JSX.Element {
  return <div role="separator" style={{ height: 1, margin: '4px 8px', background: tokens.color.border }} />
}

function TabMenuRow({
  label,
  onClick,
  checked,
  dotColor,
  disabled
}: {
  label: string
  onClick: () => void
  checked?: boolean
  dotColor?: string
  disabled?: boolean
}): JSX.Element {
  const [hover, setHover] = useState(false)
  return (
    <div
      role={checked !== undefined ? 'menuitemcheckbox' : 'menuitem'}
      aria-checked={checked !== undefined ? checked : undefined}
      aria-disabled={disabled || undefined}
      tabIndex={-1}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={disabled ? undefined : onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        height: 28,
        padding: '0 14px',
        cursor: 'default',
        whiteSpace: 'nowrap',
        opacity: disabled ? 0.45 : 1,
        background: hover && !disabled ? tokens.color.bgHover : 'transparent'
      }}
    >
      <span aria-hidden style={{ width: 12, textAlign: 'center', flex: '0 0 auto', fontSize: 12 }}>
        {checked ? '✓' : ''}
      </span>
      {dotColor && (
        <span
          aria-hidden
          style={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            flex: '0 0 auto',
            background: dotColor,
            boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.18)'
          }}
        />
      )}
      <span style={{ flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
    </div>
  )
}
