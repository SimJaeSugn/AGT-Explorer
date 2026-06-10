/**
 * BreadcrumbDropdown — 브레드크럼 세그먼트 ▾ 형제(자식 폴더) 드롭다운 (U2).
 *
 * 각 세그먼트 옆 ▾ 버튼을 누르면 그 세그먼트의 "자식 폴더" 목록(= 다음
 * 세그먼트의 형제들)을 기존 fs:tree-children 채널로 온디맨드 조회해 팝오버로
 * 띄운다(신규 IPC 채널 0 — 사이드바 트리 지연확장과 동일 호출). 항목 선택 시
 * 활성 패널을 해당 폴더로 이동(navigate 재사용).
 *
 * 원격 경로(sftp://·ftp://)는 로컬 fs:tree-children 대상이 아니므로 호출 측
 * (PanelToolbar)에서 ▾ 자체를 렌더하지 않는다 — 이 컴포넌트는 로컬 전제.
 *
 * UX: ↑/↓ 이동·Enter 선택·Esc 닫기·바깥 클릭 닫기(capture)·role=menu/menuitem·
 * 현재 거쳐온 자식 표식(✓)·로딩/빈/오류 상태. ▾ 바로 아래 배치(경계 클램프).
 *
 * 경계: ui → app(usecase fetchBreadcrumbSiblings). infra 직접 import 금지.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  fetchBreadcrumbSiblings,
  type SiblingsOutcome
} from '@renderer/app/usecases/breadcrumbDropdown'
import type { BreadcrumbSibling } from '@renderer/domain/rules/breadcrumbSiblings'
import { tokens } from '@renderer/ui/theme/tokens'

interface Props {
  /** 드롭다운을 여는 세그먼트의 경로(이 폴더의 자식들을 보여준다). */
  readonly segmentPath: string
  /** 현재 경로에서 이 세그먼트 다음에 거쳐온 자식 경로(없으면 null) — current 표식·초기 포커스. */
  readonly currentChildPath: string | null
  /** 항목 선택 시 이동 콜백(panelId 고정 navigate 래퍼). */
  readonly onNavigate: (path: string) => void
}

const MENU_MIN_W = 200
const MENU_MAX_W = 360
const MENU_MAX_H = 360
const MARGIN = 6

export function BreadcrumbDropdown({ segmentPath, currentChildPath, onNavigate }: Props): JSX.Element {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<BreadcrumbSibling[]>([])
  const [error, setError] = useState<string | null>(null)
  const [activeIdx, setActiveIdx] = useState(-1)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  const btnRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  // 비동기 조회 경합 방지(빠른 재오픈 시 이전 응답 무시).
  const reqIdRef = useRef(0)

  const close = useCallback(() => {
    setOpen(false)
    setActiveIdx(-1)
    setPos(null)
    // 닫을 때 ▾ 로 포커스 복귀(키보드 흐름 보존).
    btnRef.current?.focus()
  }, [])

  // 열기: 즉시 로딩 표시 + 형제 폴더 온디맨드 조회.
  const openDropdown = useCallback(() => {
    setOpen(true)
    setLoading(true)
    setError(null)
    setItems([])
    setActiveIdx(-1)
    const reqId = ++reqIdRef.current
    void fetchBreadcrumbSiblings(segmentPath, currentChildPath).then((out: SiblingsOutcome) => {
      if (reqId !== reqIdRef.current) return // 더 새 요청이 있으면 폐기.
      setLoading(false)
      if (out.ok) {
        setItems(out.items)
        // 현재 거쳐온 자식이 있으면 거기서 시작(없으면 첫 항목).
        const curIdx = out.items.findIndex((it) => it.current)
        setActiveIdx(out.items.length === 0 ? -1 : curIdx >= 0 ? curIdx : 0)
      } else {
        setError(out.message)
      }
    })
  }, [segmentPath, currentChildPath])

  function toggle(): void {
    if (open) close()
    else openDropdown()
  }

  // 팝오버 위치: ▾ 바로 아래, 뷰포트 경계 클램프(오른쪽/아래 넘침 보정).
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
    const h = Math.min(el?.offsetHeight || 120, MENU_MAX_H)
    let left = anchor.left
    let top = anchor.bottom + 2
    if (left + w > vw - MARGIN) left = Math.max(MARGIN, vw - w - MARGIN)
    if (top + h > vh - MARGIN) top = Math.max(MARGIN, anchor.top - h - 2) // 위로 뒤집기.
    left = Math.max(MARGIN, left)
    setPos({ left, top })
  }, [open, items, loading, error])

  // 바깥 클릭(capture)·스크롤·리사이즈 시 닫힘.
  useEffect(() => {
    if (!open) return undefined
    function onPointerDown(e: PointerEvent): void {
      const t = e.target
      if (!(t instanceof Node)) return
      if (menuRef.current?.contains(t)) return
      if (btnRef.current?.contains(t)) return // ▾ 재클릭은 toggle 이 처리.
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

  const selectAt = useCallback(
    (idx: number) => {
      const it = items[idx]
      if (!it) return
      close()
      onNavigate(it.path)
    },
    [items, onNavigate, close]
  )

  // 키보드: ↑/↓ 이동(순환)·Enter 선택·Esc/Tab 닫기·Home/End.
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
        if (items.length) setActiveIdx((cur) => (cur < 0 ? 0 : (cur + 1) % items.length))
        break
      case 'ArrowUp':
        e.preventDefault()
        e.stopPropagation()
        if (items.length) setActiveIdx((cur) => (cur <= 0 ? items.length - 1 : cur - 1))
        break
      case 'Home':
        e.preventDefault()
        e.stopPropagation()
        if (items.length) setActiveIdx(0)
        break
      case 'End':
        e.preventDefault()
        e.stopPropagation()
        if (items.length) setActiveIdx(items.length - 1)
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        e.stopPropagation()
        if (activeIdx >= 0) selectAt(activeIdx)
        break
      case 'Tab':
        // 메뉴 밖으로 포커스 이동 의도 → 닫기.
        close()
        break
      default:
        break
    }
  }

  // 열린 직후 메뉴 컨테이너 포커스(키보드 진입 — 스크린리더 menu 역할 인지).
  useEffect(() => {
    if (open && pos) {
      const t = setTimeout(() => menuRef.current?.focus(), 0)
      return () => clearTimeout(t)
    }
    return undefined
  }, [open, pos])

  // 활성 항목으로 스크롤 추종.
  useEffect(() => {
    if (!open || activeIdx < 0) return
    const el = menuRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIdx])

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center' }}>
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          toggle()
        }}
        title="하위 폴더로 이동"
        aria-label="하위 폴더 메뉴"
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          border: 'none',
          background: open ? tokens.color.bgHover : 'transparent',
          cursor: 'pointer',
          color: tokens.color.textMuted,
          fontSize: 9,
          lineHeight: 1,
          padding: '4px 2px',
          borderRadius: 3
        }}
      >
        ▾
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="하위 폴더"
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
          {loading && (
            <div style={{ padding: '6px 14px', color: tokens.color.textMuted }}>불러오는 중…</div>
          )}
          {!loading && error && (
            <div style={{ padding: '6px 14px', color: tokens.color.danger }}>{error}</div>
          )}
          {!loading && !error && items.length === 0 && (
            <div style={{ padding: '6px 14px', color: tokens.color.textMuted }}>하위 폴더 없음</div>
          )}
          {!loading &&
            !error &&
            items.map((it, idx) => (
              <div
                key={it.path}
                role="menuitem"
                data-idx={idx}
                tabIndex={-1}
                aria-current={it.current ? 'true' : undefined}
                onMouseEnter={() => setActiveIdx(idx)}
                onClick={() => selectAt(idx)}
                title={it.path}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  height: 28,
                  padding: '0 12px',
                  cursor: 'default',
                  whiteSpace: 'nowrap',
                  background: idx === activeIdx ? tokens.color.bgHover : 'transparent'
                }}
              >
                <span
                  aria-hidden
                  style={{ width: 14, flex: '0 0 auto', color: tokens.color.folder, fontSize: 13 }}
                >
                  {it.current ? '✓' : '📁'}
                </span>
                <span
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    fontWeight: it.current ? 600 : 400
                  }}
                >
                  {it.name}
                </span>
              </div>
            ))}
        </div>
      )}
    </span>
  )
}
