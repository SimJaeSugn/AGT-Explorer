/**
 * 파일 태그/색상 라벨 — 순수 규칙(renderer/domain/rules) · T1(US-19.1, Should).
 *
 * 파일/폴더에 색상 라벨(태그)을 붙여 행에 표시하고 태그로 필터한다. 팔레트(고정 7색)·
 * 키 검증·태그 필터 술어를 순수 함수로 둔다(헤드리스 verify:domain 가 직접 소비).
 * 부수효과 없음 — store(tagsSlice)·selectors·UI·persistence(coerce)가 공유하는 단일 출처.
 *
 * 비파괴 영속: tagsByPath 는 세션 메타에 optional 로 추가되며 스키마 버전을 올리지 않는다
 * (누락/손상 값은 coerce 가 빈 맵으로 폴백 — defaults.ts coerceTagsByPath 미러).
 *
 * 설계 메모(ADR-012): ADR-012 의 프리셋·filterComposition 부분은 T3 폐기와 함께 제거됐고,
 * 태그/영속 의도만 남아 태그 필터 합성을 여기서 새로 설계한다(이름필터 AND 태그필터 — selectors).
 */

/** 고정 팔레트 색상 키(안정 키 — 영속/직렬화에 그대로 쓰인다). */
export type TagKey = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'gray'

/** 팔레트 1색의 표시 메타(한국어 이름 + 토큰 색상). */
export interface TagColor {
  /** 안정 키(영속/직렬화). */
  readonly key: TagKey
  /** 표시 이름(메뉴·aria-label, 예: "빨강"). */
  readonly name: string
  /** 행 배지/점 색상(CSS color). */
  readonly color: string
}

/**
 * 고정 색상 팔레트(7색). 순서가 메뉴/칩 표시 순서다. 색상은 라이트/다크 양쪽에서
 * 변별 가능한 채도/명도로 고정(테마 토큰과 무관한 라벨 고유색 — Finder/탐색기 라벨 관례).
 */
export const TAG_PALETTE: readonly TagColor[] = [
  { key: 'red', name: '빨강', color: '#e5484d' },
  { key: 'orange', name: '주황', color: '#f76b15' },
  { key: 'yellow', name: '노랑', color: '#f5d90a' },
  { key: 'green', name: '초록', color: '#46a758' },
  { key: 'blue', name: '파랑', color: '#3e63dd' },
  { key: 'purple', name: '보라', color: '#8e4ec6' },
  { key: 'gray', name: '회색', color: '#8b8d98' }
]

/** 빠른 키→메타 조회 맵(O(1)). */
const PALETTE_BY_KEY = new Map<TagKey, TagColor>(TAG_PALETTE.map((c) => [c.key, c]))

/** 유효한 태그 키인지(영속 raw·외부 입력 검증). 팔레트에 있는 키만 통과. */
export function isTagKey(v: unknown): v is TagKey {
  return typeof v === 'string' && PALETTE_BY_KEY.has(v as TagKey)
}

/** 키→색상 메타(없으면 undefined). */
export function tagColorOf(key: TagKey): TagColor | undefined {
  return PALETTE_BY_KEY.get(key)
}

/** 표시 이름(없으면 키 그대로 폴백 — 안전). */
export function tagDisplayName(key: TagKey): string {
  return PALETTE_BY_KEY.get(key)?.name ?? key
}

/**
 * 태그 키 배열을 정규화한다 — 유효 키만, 팔레트 순서로, 중복 제거.
 * raw(영속/외부) 입력을 안정적 표시·저장 형태로 만든다(순수).
 */
export function normalizeTags(raw: readonly unknown[]): TagKey[] {
  const present = new Set<TagKey>()
  for (const v of raw) if (isTagKey(v)) present.add(v)
  // 팔레트 순서로 정렬(표시 안정성·round-trip 동등).
  return TAG_PALETTE.filter((c) => present.has(c.key)).map((c) => c.key)
}

/**
 * 단일 항목이 활성 태그 필터에 매칭되는지(순수 술어).
 *  - 활성 태그가 비어 있으면 항상 true(태그 필터 비활성 — 전체 표시).
 *  - 활성 태그가 있으면 OR: 항목의 태그 중 하나라도 활성 집합에 들면 true.
 * @param entryTags  해당 항목(path)에 붙은 태그(없으면 빈 배열).
 * @param activeTags 현재 활성 태그 필터 집합.
 */
export function matchesTags(
  entryTags: readonly TagKey[] | undefined,
  activeTags: ReadonlySet<TagKey>
): boolean {
  if (activeTags.size === 0) return true
  if (!entryTags || entryTags.length === 0) return false
  for (const t of entryTags) if (activeTags.has(t)) return true
  return false
}
