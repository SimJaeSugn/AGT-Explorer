/**
 * TabBar — 탭 추가/닫기/전환/드래그 순서/복제 (US-1.1).
 *
 * roadmap P3: Ctrl+T/W/Tab/1~9·가운데클릭 닫기·드래그 순서·Ctrl+D 복제·
 * Ctrl+Shift+T 복원(키는 디스패처). 여기서는 마우스 UI 와 액션 호출.
 * 탭 라벨은 사용자 지정 이름(customName) 또는 활성 패널 경로의 마지막 세그먼트.
 *
 * Feature A(사용자 지정 이름)·US-20.3(탭 색상/잠금):
 *  - 더블클릭 또는 컨텍스트 메뉴 "이름 바꾸기" → 인라인 입력(RenameInput 패턴 미러).
 *  - 우클릭 → 이름 바꾸기 / 색상(TAB_COLOR_PALETTE 웜·쿨·중립 파스텔) / 잠금·잠금 해제.
 *  - 색상 설정 시 탭 영역 "전체"를 파스텔로 물들이고(tabTint), 활성 탭은 좀 더 진한
 *    틴트 + 상단 강조선. 잠긴 탭은 자물쇠 글리프 + 닫기 가드(× 숨김).
 */
import { useEffect, useRef, useState } from 'react'
import { useRootStore } from '@renderer/app/stores/rootStore'
import { baseName, MY_PC_LABEL } from '@renderer/domain/paths'
import { resolveDriveLabel } from '@renderer/app/selectors/driveLabel'
import { requestNewTab } from '@renderer/app/usecases/newTab'
import { splitTabToNewWindow, detachTabToCompactWindow } from '@renderer/app/usecases/windowSplit'
import {
  TAB_COLOR_PALETTE,
  TAB_COLOR_GROUP_LABEL,
  tabColorOf,
  tabTint,
  type TabColorGroup
} from '@renderer/domain/rules/tabColors'
import { tokens } from '@renderer/ui/theme/tokens'
import { PlusIcon, SettingsIcon, CloseIcon } from '@renderer/ui/icons/lucide'

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
        alignItems: 'center',
        gap: 4,
        height: 40,
        padding: '0 8px',
        background: tokens.color.chrome,
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
          color: tokens.color.textMuted,
          width: 30,
          height: 30,
          borderRadius: 8,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flex: '0 0 auto'
        }}
      >
        <PlusIcon size={15} />
      </button>
      <button
        onClick={() => openSettings()}
        title="설정 (Ctrl+,)"
        aria-label="설정"
        style={{
          marginLeft: 'auto',
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          color: tokens.color.textMuted,
          width: 30,
          height: 30,
          borderRadius: 8,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flex: '0 0 auto'
        }}
      >
        <SettingsIcon size={16} />
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
  const swatch = tabColorOf(colorKey)?.color
  // 색상은 단독 정보가 아니므로 접근성 라벨은 이름 + 잠금 상태만 고지(색상 틴트는 aria-hidden).
  const ariaLabel = locked ? `${label} (잠긴 탭)` : label
  // 탭 영역 전체 배경: 색상 미지정이면 기존 동작(활성=bg/비활성=투명), 지정 시 파스텔 틴트
  // (활성은 좀 더 진하게). 본문 텍스트 대비를 유지하도록 낮은 알파로 테마 배경 위에 합성.
  const tabBg = swatch
    ? tabTint(swatch, active ? 0.34 : 0.18)
    : active
      ? tokens.color.elevated
      : 'transparent'
  // 활성 탭 강조 점 색: 색상 지정 시 그 색, 아니면 accent(미지정 비활성은 숨김).
  const dotColor = swatch ?? tokens.color.accent

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
      onDragEnd={(e) => {
        // 드래그 종료 — 커서가 이 창 영역 밖이면 "탐색기 전용" 경량 창으로 분리한다.
        // 창 안에서 끝난 경우(탭 재정렬·파일영역 등)는 무시(기존 동작 유지).
        setDragId(null)
        const { screenX, screenY } = e
        // 일부 환경에서 dragend 좌표가 (0,0)로 비는 경우는 판정 불가 → 무시(오분리 방지).
        if (screenX === 0 && screenY === 0) return
        const outside =
          screenX < window.screenX ||
          screenX > window.screenX + window.outerWidth ||
          screenY < window.screenY ||
          screenY > window.screenY + window.outerHeight
        if (outside) void detachTabToCompactWindow(tabId)
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
        gap: 8,
        height: 30,
        margin: '0 1px',
        padding: '0 10px 0 12px',
        minWidth: 90,
        maxWidth: 200,
        borderRadius: 9,
        cursor: 'pointer',
        background: tabBg,
        border: `1px solid ${active ? tokens.color.border : 'transparent'}`,
        fontSize: 13,
        fontWeight: active ? 500 : 400,
        // 색상 지정 탭은 텍스트를 항상 본문색으로(파스텔 위 가독성), 미지정은 기존 활성/비활성 대비.
        color: swatch ? tokens.color.text : active ? tokens.color.text : tokens.color.textMuted
      }}
    >
      {/* 활성 탭 강조 점(색상 지정 시 그 색·아니면 accent). 비활성은 자리만 비워 정렬 유지. */}
      {active && (
        <span
          aria-hidden
          style={{
            flex: '0 0 auto',
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: dotColor
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
            borderRadius: 5,
            width: 18,
            height: 18,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            flex: '0 0 auto'
          }}
        >
          <CloseIcon size={13} />
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
 * 패널/파일 컨텍스트에 결합되어 있어 탭 전용 경량 메뉴를 둔다(색상은 TAB_COLOR_PALETTE
 * 웜·쿨·중립 파스텔을 그룹 헤더로 묶어 표시). Esc·바깥 클릭·스크롤·항목 실행 시 닫힌다.
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

  // 화면 우측/하단 넘침 보정(간단 클램프). 파스텔 12색 + 그룹 헤더로 메뉴가 길어 높이 여유 확대.
  const left = Math.min(state.x, window.innerWidth - 200)
  const top = Math.min(state.y, window.innerHeight - 460)

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
      {/* 색상 팔레트(파스텔·웜/쿨/중립 그룹) — 현재 색상에 체크 표시. */}
      <div role="presentation" style={{ padding: '4px 14px 2px', color: tokens.color.textMuted, fontSize: 11 }}>
        색상
      </div>
      {TAB_COLOR_PALETTE.map((c, i) => {
        const prevGroup: TabColorGroup | undefined = i > 0 ? TAB_COLOR_PALETTE[i - 1].group : undefined
        return (
          <div key={c.key} role="presentation">
            {c.group !== prevGroup && (
              <div
                role="presentation"
                style={{ padding: '3px 14px 1px 14px', color: tokens.color.textMuted, fontSize: 10, opacity: 0.85 }}
              >
                {TAB_COLOR_GROUP_LABEL[c.group]}
              </div>
            )}
            <TabMenuRow
              label={c.name}
              dotColor={c.color}
              checked={colorKey === c.key}
              onClick={() => {
                setTabColor(tabId, c.key)
                onClose()
              }}
            />
          </div>
        )
      })}
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
