/**
 * applyTheme (renderer/ui/theme) — ThemeMode 를 실제 DOM CSS 변수로 적용.
 *
 * - ThemeMode: 'light' | 'dark' | 'system'.
 * - 'system' 은 `prefers-color-scheme` 미디어쿼리로 라이트/다크를 해석한다.
 * - resolveTheme() 는 순수 함수(테스트 가능), applyTheme() 가 DOM 주입을 한다.
 * - 'system' 일 때 OS 테마가 바뀌면 즉시 반영하도록 미디어쿼리 리스너를 건다.
 *
 * 모든 색 토큰이 CSS 변수를 참조하므로(tokens.ts), 변수 set 한 번으로
 * 전 컴포넌트(다이얼로그·DragOverlay·드롭 하이라이트 포함)가 즉시 전환된다.
 */
import type { ThemeMode } from '@shared/dto'
import { paletteFor } from './palette'

/**
 * 해석된 실제 테마(I장 §6.3). 'bluelight' 는 light 폴백이 아닌 **독립 resolved**다.
 * data-theme 속성·팔레트 분기 키로 쓰인다.
 */
export type ResolvedTheme = 'light' | 'dark' | 'bluelight'

/**
 * ThemeMode 를 실제 테마로 해석(순수). system 은 prefersDark 로 결정.
 * 'bluelight' 는 그대로 통과(독립 resolved) — light 폴백 아님.
 */
export function resolveTheme(mode: ThemeMode, prefersDark: boolean): ResolvedTheme {
  if (mode === 'system') return prefersDark ? 'dark' : 'light'
  return mode // 'light' | 'dark' | 'bluelight'
}

/** 현재 OS 가 다크를 선호하는지(미디어쿼리). 헤드리스/미지원 시 false. */
export function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

/** resolved 팔레트를 document 루트에 CSS 변수로 주입한다. */
function injectPalette(resolved: ResolvedTheme): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const palette = paletteFor(resolved)
  for (const [name, value] of Object.entries(palette)) {
    root.style.setProperty(name, value)
  }
  root.setAttribute('data-theme', resolved)
  // bluelight 는 밝은 크림 톤 → colorScheme 은 light 로 취급(폼 컨트롤·스크롤바 대비).
  root.style.colorScheme = resolved === 'dark' ? 'dark' : 'light'
}

let mql: MediaQueryList | null = null
let mqlListener: ((e: MediaQueryListEvent) => void) | null = null

/**
 * ThemeMode 를 적용한다. 'system' 이면 OS 변경을 구독해 자동 반영한다.
 * 호출 시마다 이전 system 리스너를 정리하고 새로 건다(중복 방지).
 * @returns 해석된 실제 테마('light'|'dark'|'bluelight').
 */
export function applyTheme(mode: ThemeMode): ResolvedTheme {
  // 이전 system 리스너 정리.
  if (mql && mqlListener) {
    mql.removeEventListener('change', mqlListener)
    mql = null
    mqlListener = null
  }

  const resolved = resolveTheme(mode, systemPrefersDark())
  injectPalette(resolved)

  if (mode === 'system' && typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    mql = window.matchMedia('(prefers-color-scheme: dark)')
    mqlListener = (e: MediaQueryListEvent): void => {
      injectPalette(e.matches ? 'dark' : 'light')
    }
    mql.addEventListener('change', mqlListener)
  }

  return resolved
}
