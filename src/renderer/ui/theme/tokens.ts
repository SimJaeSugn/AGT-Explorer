/**
 * 디자인 토큰 (renderer/ui/theme) — 색/간격 상수.
 *
 * P5(다크모드): 색 토큰을 **CSS 변수 참조**(`var(--c-*)`)로 바꿔, 실제 색은
 * palette.ts 가 라이트/다크 팔레트로 주입한다. 기존 컴포넌트들이 모두
 * `tokens.color.bg` 형태로 참조하고 있으므로, 토큰의 "값"만 CSS 변수로 바꾸면
 * 컴포넌트 코드 수정 없이 테마가 즉시 전환된다(다이얼로그·DragOverlay·드롭
 * 하이라이트 포함 전 컴포넌트가 같은 변수를 본다).
 *
 * 색 외 토큰(rowHeight·gridCell·font)은 테마 불변이므로 상수 유지.
 */
export const tokens = {
  color: {
    bg: 'var(--c-bg)',
    bgAlt: 'var(--c-bg-alt)',
    bgHover: 'var(--c-bg-hover)',
    bgSelected: 'var(--c-bg-selected)',
    bgSelectedInactive: 'var(--c-bg-selected-inactive)',
    border: 'var(--c-border)',
    borderStrong: 'var(--c-border-strong)',
    text: 'var(--c-text)',
    textMuted: 'var(--c-text-muted)',
    accent: 'var(--c-accent)',
    accentBorder: 'var(--c-accent-border)',
    danger: 'var(--c-danger)',
    folder: 'var(--c-folder)',
    file: 'var(--c-file)',
    /** 검색어 하이라이트 배경(P5). */
    highlight: 'var(--c-highlight)'
  },
  rowHeight: 26,
  /**
   * 아이콘 그리드 셀 크기(J4 보기 5종). 보기별 셀 폭·높이·아이콘 픽셀.
   * medium 은 기존 단일 gridCell(104×96) 호환값.
   */
  gridCell: {
    large: { w: 128, h: 120, icon: 64 },
    medium: { w: 104, h: 96, icon: 48 },
    small: { w: 80, h: 72, icon: 32 }
  },
  font: 'system-ui, "Segoe UI", sans-serif'
} as const

/** ViewMode(icons-*) → 그리드 셀 크기. 비그리드는 호출 안 함. */
export function gridCellFor(viewMode: string): { w: number; h: number; icon: number } {
  if (viewMode === 'icons-large') return tokens.gridCell.large
  if (viewMode === 'icons-small') return tokens.gridCell.small
  return tokens.gridCell.medium
}
