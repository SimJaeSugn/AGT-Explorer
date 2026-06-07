/**
 * 테마 팔레트 (renderer/ui/theme/palette) — 라이트/다크 색 값 정의.
 *
 * tokens.ts 의 CSS 변수(`--c-*`)에 주입할 실제 색을 라이트/다크로 둔다.
 * applyTheme 가 resolved 테마('light'|'dark')에 맞는 팔레트를 document
 * 루트의 CSS 변수로 set 한다. WCAG AA 대비를 지향한 값(SW §6.3 / P5 DoD).
 *
 * 순수 데이터 + DOM 주입 헬퍼. (ui 계층이므로 DOM 접근 허용)
 */

/** CSS 변수명 → 색 값 맵. */
export type Palette = Readonly<Record<string, string>>

export const LIGHT_PALETTE: Palette = {
  '--c-bg': '#ffffff',
  '--c-bg-alt': '#f6f7f9',
  '--c-bg-hover': '#eef1f5',
  '--c-bg-selected': '#d7e7ff',
  '--c-bg-selected-inactive': '#e6e9ee',
  '--c-border': '#dfe3e8',
  '--c-border-strong': '#c4cad2',
  '--c-text': '#1f2328',
  '--c-text-muted': '#6a737d',
  '--c-accent': '#2563eb',
  '--c-accent-border': '#2563eb',
  '--c-danger': '#d1242f',
  '--c-folder': '#dcb24a',
  '--c-file': '#8a94a6',
  '--c-highlight': '#fff1a8'
}

export const DARK_PALETTE: Palette = {
  '--c-bg': '#1e1f22',
  '--c-bg-alt': '#26282c',
  '--c-bg-hover': '#32353a',
  '--c-bg-selected': '#234876',
  '--c-bg-selected-inactive': '#383b41',
  '--c-border': '#3a3d42',
  '--c-border-strong': '#4b4f56',
  '--c-text': '#e6e8eb',
  '--c-text-muted': '#9aa1ab',
  '--c-accent': '#4f8cff',
  '--c-accent-border': '#4f8cff',
  '--c-danger': '#ff6b6b',
  '--c-folder': '#e3c06a',
  '--c-file': '#7f8794',
  '--c-highlight': '#6b5d1f'
}

/** resolved(light/dark) 테마의 팔레트 반환. */
export function paletteFor(resolved: 'light' | 'dark'): Palette {
  return resolved === 'dark' ? DARK_PALETTE : LIGHT_PALETTE
}
