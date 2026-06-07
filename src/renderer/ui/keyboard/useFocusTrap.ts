/**
 * useFocusTrap — 모달 공용 포커스 트랩 훅 (WCAG 2.4.3 포커스 순서 · 2.1.2 키보드 함정 없음).
 *
 * P7-A 접근성: 모달이 열려 있는 동안:
 *   (a) 마운트(active 전이) 시 컨테이너 내 첫 포커스 가능 요소(또는 initialFocus)로 포커스.
 *   (b) Tab/Shift+Tab 이 컨테이너 밖으로 나가지 않게 첫↔끝 래핑(capture keydown).
 *   (c) 언마운트/비활성 전이 시 opener(직전 활성 요소)로 포커스 복귀.
 *
 * Esc 닫기는 **호출측에 위임**한다(트랩은 Tab 순환만 담당). 기존 모달의 Esc·오버레이
 * 클릭 닫기·`inputContext='dialog'` 전역 단축키 차단과 독립적으로 공존한다.
 *
 * SettingsDialog 처럼 오버레이 클릭 닫기를 가진 모달은 **내부 패널 div** 를 컨테이너로
 * 전달한다(오버레이는 트랩 밖 → 클릭 닫기 보존).
 *
 * 경계: ui 계층 훅(DOM 접근 허용). store/usecase 비의존(순수 DOM 포커스 관리).
 */
import { useEffect } from 'react'
import type { RefObject } from 'react'

/** 컨테이너 내부의 키보드 포커스 가능 요소 셀렉터(비활성·숨김 제외는 런타임 필터). */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

/** 가시(렌더되고 display:none/visibility:hidden 아님)인지. offsetParent 또는 크기로 판정. */
function isVisible(el: HTMLElement): boolean {
  if (el.hidden) return false
  // position:fixed 요소는 offsetParent 가 null 일 수 있어 rect 폴백.
  if (el.offsetParent !== null) return true
  const r = el.getClientRects()
  return r.length > 0
}

/** 컨테이너 내 현재 포커스 가능한 요소 목록(문서 순서). */
function focusableWithin(container: HTMLElement): HTMLElement[] {
  const nodes = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
  const out: HTMLElement[] = []
  nodes.forEach((n) => {
    if (n.getAttribute('aria-hidden') === 'true') return
    if (isVisible(n)) out.push(n)
  })
  return out
}

/**
 * 모달 포커스 트랩. `active && containerRef.current` 일 때만 동작.
 *
 * @param active        모달 열림 여부.
 * @param containerRef  트랩 컨테이너(모달 패널) ref.
 * @param opts.initialFocus  열림 시 우선 포커스할 요소 ref(없으면 첫 포커서블).
 */
export function useFocusTrap(
  active: boolean,
  containerRef: RefObject<HTMLElement | null>,
  opts?: { readonly initialFocus?: RefObject<HTMLElement | null> }
): void {
  const initialFocus = opts?.initialFocus

  useEffect(() => {
    if (!active) return undefined
    const container = containerRef.current
    if (!container) return undefined

    // opener 저장(복귀 대상). HTMLElement 가 아니면 복귀 생략.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null

    // 첫 포커스: initialFocus 우선, 없으면 첫 포커서블, 그것도 없으면 컨테이너 자체.
    // setTimeout(0): 모달 마운트 직후 레이아웃 확정 후 포커스(다른 첫포커스 effect 와 경합 회피).
    const focusTimer = window.setTimeout(() => {
      const target = initialFocus?.current ?? focusableWithin(container)[0] ?? null
      if (target) {
        target.focus()
      } else {
        // 포커서블이 없으면 컨테이너에 임시 tabindex 부여 후 포커스(스크린리더 진입점).
        if (!container.hasAttribute('tabindex')) container.setAttribute('tabindex', '-1')
        container.focus()
      }
    }, 0)

    // Tab 순환 가둠(capture: 자식 핸들러보다 먼저). Esc 는 호출측 위임이라 미처리.
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key !== 'Tab') return
      const cont = containerRef.current
      if (!cont) return
      const focusables = focusableWithin(cont)
      if (focusables.length === 0) {
        // 포커서블이 없으면 컨테이너 밖으로 못 나가게 차단.
        e.preventDefault()
        return
      }
      const first = focusables[0] as HTMLElement
      const last = focusables[focusables.length - 1] as HTMLElement
      const activeEl = document.activeElement as HTMLElement | null

      if (e.shiftKey) {
        // Shift+Tab: 첫 요소(또는 컨테이너 밖)에서 마지막으로 래핑.
        if (activeEl === first || !cont.contains(activeEl)) {
          e.preventDefault()
          last.focus()
        }
      } else {
        // Tab: 마지막 요소(또는 컨테이너 밖)에서 첫 요소로 래핑.
        if (activeEl === last || !cont.contains(activeEl)) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    document.addEventListener('keydown', onKeyDown, { capture: true })

    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener('keydown', onKeyDown, { capture: true })
      // opener 복귀(여전히 문서에 연결되어 있고 포커스 가능할 때만).
      if (opener && opener.isConnected) {
        opener.focus()
      }
    }
  }, [active, containerRef, initialFocus])
}
