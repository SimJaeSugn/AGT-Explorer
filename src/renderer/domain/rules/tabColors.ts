/**
 * 탭 색상 팔레트 — 순수 규칙(renderer/domain/rules) · US-20.3(탭 색상).
 *
 * 상단 탭에 지정하는 색상은 파일 태그(TAG_PALETTE)와 의도가 다르다.
 *  - 파일 태그: 행에 찍는 작은 점/배지 → Finder 관례의 "선명한" 단색.
 *  - 탭 색상: 탭 영역 "전체"를 은은하게 물들이는 배경 → 눈이 편한 "파스텔" 톤.
 * 그래서 둘을 분리해, 여기서는 웜톤/쿨톤/중립으로 묶은 파스텔 팔레트를 둔다.
 *
 * 배경은 스와치 색을 낮은 알파로 덧입혀(tabTint) 라이트/다크/블루라이트 어느
 * 테마에서도 본문 텍스트 대비를 깨지 않고 은은하게 물든다(테마 토큰과 합성).
 *
 * 하위호환: 기존에 저장되던 7색 키(red·orange·yellow·green·blue·purple·gray)를
 * 그대로 포함하므로 이전 세션의 탭 색상은 마이그레이션 없이 그대로 복원된다.
 * (main 측 검증 화이트리스트는 persistence/defaults.ts TAB_COLOR_KEYS 가 미러)
 */

/** 탭 색상 그룹(메뉴 구분 헤더). */
export type TabColorGroup = 'warm' | 'cool' | 'neutral'

/** 고정 팔레트 색상 키(안정 키 — 영속/직렬화에 그대로 쓰인다). */
export type TabColorKey =
  // 웜톤
  | 'red'
  | 'coral'
  | 'orange'
  | 'amber'
  | 'yellow'
  // 쿨톤
  | 'green'
  | 'teal'
  | 'sky'
  | 'blue'
  | 'purple'
  | 'lavender'
  // 중립
  | 'gray'

/** 팔레트 1색의 표시 메타. */
export interface TabColor {
  /** 안정 키(영속/직렬화). */
  readonly key: TabColorKey
  /** 표시 이름(메뉴·aria-label, 예: "빨강"). */
  readonly name: string
  /** 그룹(웜/쿨/중립) — 메뉴 구분. */
  readonly group: TabColorGroup
  /** 스와치(메뉴 점)·탭 강조 테두리 색(CSS hex). 배경은 이 색을 알파로 덧입힌다. */
  readonly color: string
}

/**
 * 고정 탭 색상 팔레트(파스텔·웜/쿨/중립). 순서가 메뉴 표시 순서다.
 * 스와치는 점이 보일 정도의 중채도이고, 실제 탭 배경은 tabTint 가 낮은 알파로
 * 은은하게 물들여 "눈 아프지 않은" 파스텔이 된다.
 */
export const TAB_COLOR_PALETTE: readonly TabColor[] = [
  // ── 웜톤 ──
  { key: 'red', name: '빨강', group: 'warm', color: '#e0686c' },
  { key: 'coral', name: '코랄', group: 'warm', color: '#e98a6a' },
  { key: 'orange', name: '주황', group: 'warm', color: '#df9152' },
  { key: 'amber', name: '호박', group: 'warm', color: '#d6a83f' },
  { key: 'yellow', name: '노랑', group: 'warm', color: '#cdb83c' },
  // ── 쿨톤 ──
  { key: 'green', name: '초록', group: 'cool', color: '#5aa86b' },
  { key: 'teal', name: '청록', group: 'cool', color: '#3fa595' },
  { key: 'sky', name: '하늘', group: 'cool', color: '#4ea7d6' },
  { key: 'blue', name: '파랑', group: 'cool', color: '#5b86d6' },
  { key: 'purple', name: '보라', group: 'cool', color: '#9b6cc9' },
  { key: 'lavender', name: '라벤더', group: 'cool', color: '#b08ad8' },
  // ── 중립 ──
  { key: 'gray', name: '회색', group: 'neutral', color: '#8b8d98' }
]

/** 그룹 표시 이름(메뉴 헤더). */
export const TAB_COLOR_GROUP_LABEL: Readonly<Record<TabColorGroup, string>> = {
  warm: '웜톤',
  cool: '쿨톤',
  neutral: '중립'
}

/** 빠른 키→메타 조회 맵(O(1)). */
const PALETTE_BY_KEY = new Map<TabColorKey, TabColor>(TAB_COLOR_PALETTE.map((c) => [c.key, c]))

/** 유효한 탭 색상 키인지(영속 raw·외부 입력 검증). 팔레트에 있는 키만 통과. */
export function isTabColorKey(v: unknown): v is TabColorKey {
  return typeof v === 'string' && PALETTE_BY_KEY.has(v as TabColorKey)
}

/** 키→색상 메타(없으면 undefined). */
export function tabColorOf(key: string | undefined): TabColor | undefined {
  return key ? PALETTE_BY_KEY.get(key as TabColorKey) : undefined
}

/**
 * 스와치 hex(#rrggbb)를 알파를 덧입힌 rgba 문자열로 변환(순수).
 * 탭 배경 틴트에 쓴다 — 테마 배경 위에 합성되어 파스텔로 보인다.
 * 잘못된 입력은 'transparent' 폴백(안전).
 */
export function tabTint(hex: string, alpha: number): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex)
  if (!m) return 'transparent'
  const n = parseInt(m[1], 16)
  const r = (n >> 16) & 0xff
  const g = (n >> 8) & 0xff
  const b = n & 0xff
  const a = Math.max(0, Math.min(1, alpha))
  return `rgba(${r}, ${g}, ${b}, ${a})`
}
