/**
 * ContextMenu — 우클릭 컨텍스트 메뉴 (roadmap P4, SA §8 마우스/키보드 일관).
 *
 * uiSlice.contextMenu 가 열려 있을 때만 렌더(셀렉터 격리 — 닫혀 있으면 null).
 * 메뉴 항목은 app/usecases/contextMenu.buildMenuItems 가 컨텍스트(파일/폴더/다중/
 * 빈영역)별로 산출하며, 클릭/Enter 는 commandBus 또는 단일 전용 usecase 로 수렴한다.
 *
 * 동작:
 *  - 화면 경계 보정(오른쪽/아래 넘침 시 좌표 반전·클램프).
 *  - Esc·바깥 클릭(capture)·스크롤(휠/스크롤 이벤트)·항목 실행 시 닫힘.
 *  - 키보드: ↑/↓ 이동(구분선 건너뜀)·Enter/Space 실행·Esc 닫기·Tab 닫기.
 *  - 열림 동안 inputContext='dialog'(uiSlice.openContextMenu) 로 전역 단축키 차단.
 *
 * 경계: ui → app(store·usecases). infra 직접 import 금지(메뉴 동작은 usecase 경유).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useRootStore } from '@renderer/app/stores/rootStore'
import { buildMenuItems, type MenuItem } from '@renderer/app/usecases/contextMenu'
import { tokens } from '@renderer/ui/theme/tokens'

/** 메뉴 추정 크기(최초 배치 시 경계 보정용 — 측정 전 폴백). */
const EST_WIDTH = 220
const ITEM_H = 28
const SEP_H = 9
const PAD_Y = 4
const MARGIN = 6

export function ContextMenu(): JSX.Element | null {
  const contextMenu = useRootStore((s) => s.contextMenu)
  const closeContextMenu = useRootStore((s) => s.closeContextMenu)

  const menuRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const [activeIdx, setActiveIdx] = useState<number>(-1)
  // 열린 하위 메뉴(태그 등) 인덱스. -1=없음. hover/→ 로 열고 ←/다른 항목 hover 로 닫는다.
  const [openSub, setOpenSub] = useState<number>(-1)

  // 항목 산출: 메뉴 열림 시점의 panelId·targetPath 로 1회 계산(셀렉터 입력 고정).
  // 단일 선택 entry(파일/폴더 구분)는 buildMenuItems 가 visibleEntries 로 재해석한다.
  const items = useMemo<MenuItem[]>(() => {
    if (!contextMenu) return []
    return buildMenuItems(contextMenu.panelId, contextMenu.targetPath)
  }, [contextMenu])

  // 첫 번째 실행 가능한(구분선 아닌) 항목 인덱스.
  const firstSelectable = useMemo(() => items.findIndex((it) => !it.separator), [items])

  // 메뉴가 새로 열릴 때 활성 인덱스/하위 메뉴 초기화(키보드 진입 시 첫 항목).
  useEffect(() => {
    if (contextMenu) {
      setActiveIdx(-1)
      setOpenSub(-1)
    }
  }, [contextMenu])

  // 경계 보정: 실제 메뉴 크기를 측정해 뷰포트 안으로 클램프(오른쪽/아래 넘침 반전).
  useLayoutEffect(() => {
    if (!contextMenu) {
      setPos(null)
      return
    }
    const el = menuRef.current
    const vw = window.innerWidth
    const vh = window.innerHeight
    const w = el?.offsetWidth || EST_WIDTH
    const h = el?.offsetHeight || estHeight(items)

    let left = contextMenu.x
    let top = contextMenu.y
    // 오른쪽 넘침: 커서 왼쪽으로 펼침.
    if (left + w > vw - MARGIN) left = Math.max(MARGIN, contextMenu.x - w)
    // 아래 넘침: 커서 위쪽으로 펼침.
    if (top + h > vh - MARGIN) top = Math.max(MARGIN, contextMenu.y - h)
    // 최종 클램프(작은 화면 대비).
    left = Math.min(Math.max(MARGIN, left), Math.max(MARGIN, vw - w - MARGIN))
    top = Math.min(Math.max(MARGIN, top), Math.max(MARGIN, vh - h - MARGIN))
    setPos({ left, top })
  }, [contextMenu, items])

  // 바깥 클릭(capture) · 스크롤 · 리사이즈 시 닫힘.
  useEffect(() => {
    if (!contextMenu) return undefined
    function onPointerDown(e: PointerEvent): void {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) return
      closeContextMenu()
    }
    function onScroll(): void {
      closeContextMenu()
    }
    function onResize(): void {
      closeContextMenu()
    }
    // capture 로 어떤 핸들러보다 먼저 바깥 클릭을 잡는다.
    window.addEventListener('pointerdown', onPointerDown, { capture: true })
    window.addEventListener('wheel', onScroll, { capture: true, passive: true })
    window.addEventListener('scroll', onScroll, { capture: true })
    window.addEventListener('resize', onResize)
    window.addEventListener('blur', onResize)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, { capture: true })
      window.removeEventListener('wheel', onScroll, { capture: true })
      window.removeEventListener('scroll', onScroll, { capture: true })
      window.removeEventListener('resize', onResize)
      window.removeEventListener('blur', onResize)
    }
  }, [contextMenu, closeContextMenu])

  const run = useCallback(
    (item: MenuItem) => {
      if (item.separator) return
      // 하위 메뉴 보유 항목은 실행이 아니라 플라이아웃을 연다(닫지 않음).
      if (item.children && item.children.length > 0) {
        setOpenSub((cur) => (cur === items.indexOf(item) ? -1 : items.indexOf(item)))
        return
      }
      if (!item.run) return
      // 먼저 닫고 실행(실행이 새 inputContext 를 설정할 수 있으므로 순서 중요:
      // 예) file.rename → startRename 이 inputContext='rename' 설정. closeContextMenu
      // 는 다른 다이얼로그/편집 없을 때만 'list' 로 돌리므로 안전).
      closeContextMenu()
      item.run()
    },
    [closeContextMenu, items]
  )

  /** 하위 메뉴 항목 실행(태그 토글 등) — 토글류는 메뉴를 닫고 적용한다. */
  const runChild = useCallback(
    (child: MenuItem) => {
      if (child.separator || !child.run) return
      closeContextMenu()
      child.run()
    },
    [closeContextMenu]
  )

  // 다음/이전 선택 가능 인덱스(구분선 건너뜀, 순환).
  const step = useCallback(
    (from: number, dir: 1 | -1): number => {
      if (items.length === 0) return -1
      let i = from
      for (let n = 0; n < items.length; n++) {
        i = (i + dir + items.length) % items.length
        if (!items[i]?.separator) return i
      }
      return from
    },
    [items]
  )

  // 키보드 처리: capture 로 전역보다 먼저(메뉴 열림 동안 inputContext='dialog' 이지만
  // 방어적으로 stopPropagation 하여 다른 키 핸들러 간섭 차단).
  useEffect(() => {
    if (!contextMenu) return undefined
    function onKey(e: KeyboardEvent): void {
      switch (e.key) {
        case 'Escape':
          e.preventDefault()
          e.stopPropagation()
          closeContextMenu()
          break
        case 'ArrowDown':
          e.preventDefault()
          e.stopPropagation()
          setOpenSub(-1)
          setActiveIdx((cur) => step(cur < 0 ? -1 : cur, 1))
          break
        case 'ArrowUp':
          e.preventDefault()
          e.stopPropagation()
          setOpenSub(-1)
          setActiveIdx((cur) => step(cur < 0 ? 0 : cur, -1))
          break
        case 'ArrowRight': {
          // 하위 메뉴 보유 항목이면 플라이아웃 열기(첫 자식으로 진입은 마우스 hover 기준 유지).
          const idx = activeIdx >= 0 ? activeIdx : firstSelectable
          const it = items[idx]
          if (it?.children && it.children.length > 0) {
            e.preventDefault()
            e.stopPropagation()
            setOpenSub(idx)
          }
          break
        }
        case 'ArrowLeft':
          if (openSub >= 0) {
            e.preventDefault()
            e.stopPropagation()
            setOpenSub(-1)
          }
          break
        case 'Home':
          e.preventDefault()
          e.stopPropagation()
          setActiveIdx(firstSelectable)
          break
        case 'End':
          e.preventDefault()
          e.stopPropagation()
          setActiveIdx(step(0, -1))
          break
        case 'Enter':
        case ' ': {
          e.preventDefault()
          e.stopPropagation()
          const idx = activeIdx >= 0 ? activeIdx : firstSelectable
          const item = items[idx]
          if (item) run(item)
          break
        }
        case 'Tab':
          // 메뉴 밖으로 포커스 이동 의도 → 닫기.
          e.preventDefault()
          e.stopPropagation()
          closeContextMenu()
          break
        default:
          break
      }
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [contextMenu, items, activeIdx, firstSelectable, step, run, closeContextMenu, openSub])

  // 열린 직후 메뉴 컨테이너에 포커스(키보드 접근 — 스크린리더 menu 역할 인지).
  useEffect(() => {
    if (contextMenu && pos) {
      const t = setTimeout(() => menuRef.current?.focus(), 0)
      return () => clearTimeout(t)
    }
    return undefined
  }, [contextMenu, pos])

  if (!contextMenu) return null

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="컨텍스트 메뉴"
      tabIndex={-1}
      // pos 측정 전(첫 레이아웃)에는 화면 밖에 숨겨 깜빡임 방지.
      style={{
        position: 'fixed',
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        visibility: pos ? 'visible' : 'hidden',
        minWidth: 200,
        maxWidth: 320,
        padding: `${PAD_Y}px 0`,
        background: tokens.color.bg,
        border: `1px solid ${tokens.color.borderStrong}`,
        borderRadius: 8,
        boxShadow: '0 8px 28px rgba(0,0,0,0.22)',
        fontSize: 13,
        color: tokens.color.text,
        outline: 'none',
        zIndex: 1200,
        userSelect: 'none'
      }}
      // 메뉴 자체의 우클릭은 기본 메뉴 억제(중첩 방지).
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, idx) =>
        item.separator ? (
          <div
            key={item.id}
            role="separator"
            style={{
              height: 1,
              margin: '4px 8px',
              background: tokens.color.border
            }}
          />
        ) : (
          <div
            key={item.id}
            role="menuitem"
            tabIndex={-1}
            aria-disabled={item.disabled ? true : undefined}
            aria-haspopup={item.children && item.children.length > 0 ? 'menu' : undefined}
            aria-expanded={item.children && item.children.length > 0 ? openSub === idx : undefined}
            aria-checked={item.checked !== undefined ? item.checked : undefined}
            style={{ position: 'relative' }}
            onMouseEnter={() => {
              setActiveIdx(idx)
              // 하위 메뉴 보유 항목 hover 시 즉시 펼치고, 다른 항목 hover 시 닫는다.
              setOpenSub(item.children && item.children.length > 0 ? idx : -1)
            }}
            onClick={() => run(item)}
          >
            <MenuRow item={item} active={idx === activeIdx} hasSub={!!item.children?.length} />
            {item.children && item.children.length > 0 && openSub === idx && (
              <Flyout items={item.children} onRun={runChild} />
            )}
          </div>
        )
      )}
    </div>
  )
}

/** 메뉴 행 내용(점·체크·라벨·하위표식). 분리해 본문/플라이아웃이 공유. */
function MenuRow({
  item,
  active,
  hasSub
}: {
  item: MenuItem
  active: boolean
  hasSub: boolean
}): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        height: ITEM_H,
        padding: '0 14px',
        cursor: 'default',
        whiteSpace: 'nowrap',
        // 비활성(정보) 행은 흐리게 — 로딩 표시("Windows 메뉴 불러오는 중…", §Y1).
        color: item.disabled
          ? tokens.color.textMuted
          : item.danger
            ? tokens.color.danger
            : tokens.color.text,
        fontStyle: item.disabled ? 'italic' : 'normal',
        background: active && !item.disabled ? tokens.color.bgHover : 'transparent'
      }}
    >
      {/* 체크 마커(토글 항목) — 자리 고정(미체크도 폭 유지해 라벨 정렬). */}
      <span aria-hidden style={{ width: 12, textAlign: 'center', flex: '0 0 auto', fontSize: 12 }}>
        {item.checked ? '✓' : ''}
      </span>
      {/* 색상 점(태그 색상). */}
      {item.dotColor && (
        <span
          aria-hidden
          style={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            flex: '0 0 auto',
            background: item.dotColor,
            boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.18)'
          }}
        />
      )}
      <span style={{ flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {item.label}
      </span>
      {hasSub && (
        <span aria-hidden style={{ flex: '0 0 auto', color: tokens.color.textMuted }}>
          ▸
        </span>
      )}
    </div>
  )
}

/** 하위 메뉴 플라이아웃(태그 색상 목록 등). 부모 항목 우측에 펼친다. */
function Flyout({
  items,
  onRun
}: {
  items: MenuItem[]
  onRun: (child: MenuItem) => void
}): JSX.Element {
  const [activeIdx, setActiveIdx] = useState(-1)
  return (
    <div
      role="menu"
      aria-label="하위 메뉴"
      style={{
        position: 'absolute',
        top: -PAD_Y,
        left: '100%',
        minWidth: 160,
        maxWidth: 260,
        // 긴 목록(레지스트리 ShellNew 형식 수십 개)은 화면 밖으로 넘치지 않도록 스크롤(§Y2).
        maxHeight: '70vh',
        overflowY: 'auto',
        padding: `${PAD_Y}px 0`,
        background: tokens.color.bg,
        border: `1px solid ${tokens.color.borderStrong}`,
        borderRadius: 8,
        boxShadow: '0 8px 28px rgba(0,0,0,0.22)',
        zIndex: 1201
      }}
    >
      {items.map((child, i) =>
        child.separator ? (
          <div
            key={child.id}
            role="separator"
            style={{ height: 1, margin: '4px 8px', background: tokens.color.border }}
          />
        ) : (
          <div
            key={child.id}
            role="menuitemcheckbox"
            aria-checked={child.checked !== undefined ? child.checked : undefined}
            tabIndex={-1}
            onMouseEnter={() => setActiveIdx(i)}
            onClick={(e) => {
              e.stopPropagation()
              onRun(child)
            }}
          >
            <MenuRow item={child} active={i === activeIdx} hasSub={false} />
          </div>
        )
      )}
    </div>
  )
}

/** 항목 목록의 추정 높이(측정 전 폴백 — 경계 보정 초기값). */
function estHeight(items: MenuItem[]): number {
  let h = PAD_Y * 2
  for (const it of items) h += it.separator ? SEP_H : ITEM_H
  return h
}
