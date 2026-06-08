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
  // P7-B: bg-alt(#f6f7f9) 위 보조텍스트 AA(4.5:1) 보장 위해 #6a737d→#677078 미세 보정(4.49→4.70).
  '--c-text-muted': '#677078',
  '--c-accent': '#2563eb',
  '--c-accent-border': '#2563eb',
  '--c-danger': '#d1242f',
  '--c-folder': '#dcb24a',
  '--c-file': '#8a94a6',
  '--c-highlight': '#fff1a8',
  // N1 즐겨찾기 워터마크 반투명도(본문 위 비중첩 장식·저대비). 라이트는 약간 더 진하게.
  '--c-watermark-opacity': '0.06',
  // 워터마크 글자색(텍스트 토큰 재사용·opacity 로 저대비 조절).
  '--c-watermark-color': '#1f2328'
}

/**
 * 블루라이트 차단 팔레트(I장 §6.2). 배경 #FBF0D9(따뜻한 크림) 기반 저청색광.
 * 청색을 최소화한 따뜻한 갈/황 톤으로 13개 토큰 전부 채운다(미주입 시 색 깨짐).
 * 텍스트/배경 대비는 WCAG AA(4.5:1) 지향 — #3A3326 본문은 #FBF0D9 위에서 ≈10:1.
 */
export const BLUELIGHT_PALETTE: Palette = {
  '--c-bg': '#FBF0D9',
  '--c-bg-alt': '#F3E6C9',
  '--c-bg-hover': '#ECDCBA',
  '--c-bg-selected': '#E3CFA0',
  '--c-bg-selected-inactive': '#EADCC0',
  '--c-border': '#E0D0AE',
  '--c-border-strong': '#C9B488',
  '--c-text': '#3A3326',
  '--c-text-muted': '#6E6346',
  '--c-accent': '#9A6A1F',
  '--c-accent-border': '#9A6A1F',
  '--c-danger': '#B23A2E',
  '--c-folder': '#C79A3A',
  '--c-file': '#8A7B55',
  '--c-highlight': '#F2D98A',
  // N1 워터마크: 따뜻한 크림 배경에 갈색 톤 저대비 장식.
  '--c-watermark-opacity': '0.07',
  '--c-watermark-color': '#3A3326'
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
  // P7-B: danger 버튼 흰글자 대비 3:1 보장 위해 #ff6b6b→#e85d5d 보정(white-on 2.78→3.41, danger-on-bg 4.83).
  '--c-danger': '#e85d5d',
  '--c-folder': '#e3c06a',
  '--c-file': '#7f8794',
  '--c-highlight': '#6b5d1f',
  // N1 워터마크: 어두운 배경에 밝은 글자·약간 더 높은 불투명도로 가시성 균형.
  '--c-watermark-opacity': '0.08',
  '--c-watermark-color': '#e6e8eb'
}

/**
 * resolved 테마(light/dark/bluelight)의 팔레트 반환(I장 §6.3).
 * ResolvedTheme 은 applyTheme.ts 에서 정의(순환참조 회피 위해 여기선 리터럴 유니온).
 */
export function paletteFor(resolved: 'light' | 'dark' | 'bluelight'): Palette {
  if (resolved === 'dark') return DARK_PALETTE
  if (resolved === 'bluelight') return BLUELIGHT_PALETTE
  return LIGHT_PALETTE
}
