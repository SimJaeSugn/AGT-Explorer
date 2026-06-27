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
    /** accent 채움(버튼·배지) 위에 얹는 글자/아이콘 대비색(accent 가 밝으면 어둡게). */
    accentContrast: 'var(--c-accent-contrast)',
    danger: 'var(--c-danger)',
    /** 상/하단 크롬 바(탭바·아이콘바·패널 툴바·상태바) 표면색. */
    chrome: 'var(--c-chrome)',
    /** 살짝 떠 있는 표면(입력칸·필 그룹·열 헤더·검색창). */
    elevated: 'var(--c-elevated)',
    /** 패널/카드 본문 표면색(파일 영역 카드 배경). */
    surface: 'var(--c-surface)',
    folder: 'var(--c-folder)',
    file: 'var(--c-file)',
    /** 검색어 하이라이트 배경(P5). */
    highlight: 'var(--c-highlight)',
    /** N1 즐겨찾기 워터마크 글자색(테마별·저대비 장식). */
    watermark: 'var(--c-watermark-color)'
  },
  /** N1 즐겨찾기 워터마크 반투명도(4테마별 토큰·본문 위 비중첩 장식). */
  watermarkOpacity: 'var(--c-watermark-opacity)',
  rowHeight: 26,
  /**
   * 아이콘 그리드 셀 크기(J4 보기 5종). 보기별 셀 폭·높이·아이콘 픽셀.
   * 높이는 아이콘 + 2줄 라벨(파일명 줄바꿈)이 잘리지 않도록 책정한다:
   *   h ≥ 6(상단패딩) + icon + 4(gap) + 34(2줄 라벨·lineHeight 1.3×12 + 여유) + 6(하단패딩).
   * 이전 small(72)/medium(96)은 2줄 라벨 하단이 셀 밖으로 넘쳐 둘째 줄이 세로로 잘렸다(회귀 수정).
   */
  gridCell: {
    large: { w: 128, h: 124, icon: 64 },
    medium: { w: 104, h: 100, icon: 48 },
    small: { w: 80, h: 84, icon: 32 }
  },
  /**
   * 본문 폰트 — Pretendard 가변 폰트(main.tsx 에서 @font-face 번들 로드) 우선,
   * 미로드/폴백 시 system-ui 체인. 모든 테마 공통(폰트는 테마 불변).
   */
  font: '"Pretendard Variable", Pretendard, system-ui, "Segoe UI", sans-serif'
} as const

/** ViewMode(icons-*) → 그리드 셀 크기. 비그리드는 호출 안 함. */
export function gridCellFor(viewMode: string): { w: number; h: number; icon: number } {
  if (viewMode === 'icons-large') return tokens.gridCell.large
  if (viewMode === 'icons-small') return tokens.gridCell.small
  return tokens.gridCell.medium
}
