/**
 * NewMenuButton — 패널 도구바 "새로 만들기" 드롭다운.
 *
 * 컨텍스트 메뉴(빈 영역) "새로 만들기" 하위 메뉴와 **동일 항목·동일 동작**을 도구바 버튼으로
 * 노출한다(buildNewMenuChildren 단일 출처): 폴더 + 고정 형식(텍스트/Markdown/JSON) +
 * 레지스트리 ShellNew 형식(설치 프로그램별, §Y2). 항목 동작은 모두 활성 패널 기준이므로
 * 실행 직전 이 패널을 활성화한다(activate). My PC·빈 경로에서는 비활성(생성 불가).
 *
 * 팝오버 동작(위치 클램프·바깥 클릭/Esc/스크롤 닫기·키보드 ↑/↓/Enter)은 BreadcrumbDropdown
 * 과 동일 패턴. 경계: ui → app(usecase). infra 직접 import 금지.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { buildNewMenuChildren, type MenuItem } from '@renderer/app/usecases/contextMenu'
import { Icon } from '@renderer/ui/icons/lucide'
import { tokens } from '@renderer/ui/theme/tokens'

interface Props {
  /** 생성 불가(내 PC·빈 경로) 면 비활성. */
  readonly disabled: boolean
  /** 실행 직전 이 패널을 활성화(동작이 활성 패널 기준이므로). */
  readonly activate: () => void
}

const MENU_MIN_W = 190
const MENU_MAX_W = 320
const MENU_MAX_H = 380
const MARGIN = 6

export function NewMenuButton({ disabled, activate }: Props): JSX.Element {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const [activeIdx, setActiveIdx] = useState(-1)

  const btnRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  // 항목은 열 때마다 새로 빌드(레지스트리 ShellNew 프리페치 캐시 최신 반영).
  const items: MenuItem[] = open ? buildNewMenuChildren() : []
  // 키보드 이동 대상(구분선 제외)의 인덱스 목록.
  const selectableIdx = items.map((it, i) => (it.separator ? -1 : i)).filter((i) => i >= 0)

  const close = useCallback((): void => {
    setOpen(false)
    setPos(null)
    setActiveIdx(-1)
    btnRef.current?.focus()
  }, [])

  function toggle(): void {
    if (open) {
      close()
      return
    }
    activate()
    setOpen(true)
    setActiveIdx(-1)
  }

  function runItem(it: MenuItem): void {
    if (it.separator || !it.run) return
    // 동작은 활성 패널 기준 — 실행 직전 이 패널을 활성화한다.
    activate()
    close()
    it.run()
  }

  // 팝오버 위치: 버튼 바로 아래, 뷰포트 경계 클램프.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    const anchor = btnRef.current?.getBoundingClientRect()
    if (!anchor) return
    const el = menuRef.current
    const vw = window.innerWidth
    const vh = window.innerHeight
    const w = el?.offsetWidth || MENU_MIN_W
    const h = Math.min(el?.offsetHeight || 160, MENU_MAX_H)
    let left = anchor.left
    let top = anchor.bottom + 2
    if (left + w > vw - MARGIN) left = Math.max(MARGIN, vw - w - MARGIN)
    if (top + h > vh - MARGIN) top = Math.max(MARGIN, anchor.top - h - 2) // 위로 뒤집기.
    left = Math.max(MARGIN, left)
    setPos({ left, top })
  }, [open])

  // 바깥 클릭(capture)·스크롤·리사이즈 시 닫힘.
  useEffect(() => {
    if (!open) return undefined
    function onPointerDown(e: PointerEvent): void {
      const t = e.target
      if (!(t instanceof Node)) return
      if (menuRef.current?.contains(t)) return
      if (btnRef.current?.contains(t)) return // 재클릭은 toggle 이 처리.
      close()
    }
    function onScroll(): void {
      close()
    }
    window.addEventListener('pointerdown', onPointerDown, { capture: true })
    window.addEventListener('wheel', onScroll, { capture: true, passive: true })
    window.addEventListener('scroll', onScroll, { capture: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, { capture: true })
      window.removeEventListener('wheel', onScroll, { capture: true })
      window.removeEventListener('scroll', onScroll, { capture: true })
      window.removeEventListener('resize', onScroll)
    }
  }, [open, close])

  // 열린 직후 메뉴 컨테이너 포커스(키보드 진입).
  useEffect(() => {
    if (open && pos) {
      const t = setTimeout(() => menuRef.current?.focus(), 0)
      return () => clearTimeout(t)
    }
    return undefined
  }, [open, pos])

  function moveActive(delta: number): void {
    if (selectableIdx.length === 0) return
    const curPos = selectableIdx.indexOf(activeIdx)
    const nextPos = curPos < 0 ? (delta > 0 ? 0 : selectableIdx.length - 1) : (curPos + delta + selectableIdx.length) % selectableIdx.length
    setActiveIdx(selectableIdx[nextPos]!)
  }

  function onMenuKeyDown(e: React.KeyboardEvent): void {
    switch (e.key) {
      case 'Escape':
        e.preventDefault()
        e.stopPropagation()
        close()
        break
      case 'ArrowDown':
        e.preventDefault()
        e.stopPropagation()
        moveActive(1)
        break
      case 'ArrowUp':
        e.preventDefault()
        e.stopPropagation()
        moveActive(-1)
        break
      case 'Home':
        e.preventDefault()
        if (selectableIdx.length) setActiveIdx(selectableIdx[0]!)
        break
      case 'End':
        e.preventDefault()
        if (selectableIdx.length) setActiveIdx(selectableIdx[selectableIdx.length - 1]!)
        break
      case 'Enter':
      case ' ': {
        e.preventDefault()
        e.stopPropagation()
        const it = items[activeIdx]
        if (it) runItem(it)
        break
      }
      case 'Tab':
        close()
        break
      default:
        break
    }
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center' }}>
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation()
          toggle()
        }}
        title="새로 만들기"
        aria-label="새로 만들기"
        aria-haspopup="menu"
        aria-expanded={open}
        className="agt-iconbtn"
        style={{
          border: 'none',
          // 열린 동안은 강조 유지(인라인). 닫혀 있으면 비워 .agt-iconbtn:hover 가 보이게 한다.
          background: open ? tokens.color.bgHover : undefined,
          borderRadius: 7,
          height: 27,
          padding: '0 5px',
          cursor: disabled ? 'default' : 'pointer',
          opacity: disabled ? 0.4 : 1,
          color: tokens.color.textMuted,
          flex: 'none',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 2
        }}
      >
        <Icon name="newFile" size={15} />
        <span style={{ fontSize: 8, lineHeight: 1 }}>▾</span>
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="새로 만들기"
          tabIndex={-1}
          onKeyDown={onMenuKeyDown}
          onContextMenu={(e) => e.preventDefault()}
          style={{
            position: 'fixed',
            left: pos?.left ?? -9999,
            top: pos?.top ?? -9999,
            visibility: pos ? 'visible' : 'hidden',
            minWidth: MENU_MIN_W,
            maxWidth: MENU_MAX_W,
            maxHeight: MENU_MAX_H,
            overflowY: 'auto',
            padding: '4px 0',
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
        >
          {items.map((it, idx) =>
            it.separator ? (
              <div
                key={it.id}
                role="separator"
                style={{ height: 1, margin: '4px 0', background: tokens.color.border }}
              />
            ) : (
              <div
                key={it.id}
                role="menuitem"
                data-idx={idx}
                tabIndex={-1}
                onMouseEnter={() => setActiveIdx(idx)}
                onClick={() => runItem(it)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  height: 28,
                  padding: '0 12px',
                  cursor: 'default',
                  whiteSpace: 'nowrap',
                  background: idx === activeIdx ? tokens.color.bgHover : 'transparent'
                }}
              >
                <span
                  aria-hidden
                  style={{ width: 15, flex: '0 0 auto', display: 'inline-flex', color: tokens.color.folder }}
                >
                  <Icon name={it.id === 'new-folder' ? 'newFolder' : 'newFile'} size={14} />
                </span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.label}</span>
              </div>
            )
          )}
        </div>
      )}
    </span>
  )
}
