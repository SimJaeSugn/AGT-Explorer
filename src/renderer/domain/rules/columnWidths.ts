/**
 * 자세히(details) 보기 열 너비 — 순수 규칙(renderer/domain/rules).
 *
 * 자세히 보기 헤더의 드래그 리사이즈 가능한 고정폭 열(크기/유형/수정한 날짜)의
 * 너비를 클램프·정규화한다. 이름(name) 열은 남은 공간을 flex 로 채우므로 저장 폭이
 * 없다(헤더/행 모두 동일 규칙으로 정렬). UI/슬라이스/coerce 가 공유하는 단일 출처라
 * 순수 함수로 분리해 헤드리스 단위 검증(verify:domain)이 직접 소비한다.
 *
 * 비파괴 영속: DetailsColumnWidths 는 세션 ui 에 optional 로 추가되며 스키마 버전을
 * 올리지 않는다(누락/손상 값은 coerce 가 기본값으로 폴백 — defaults.ts 미러).
 */

/** 리사이즈 가능한 고정폭 열 키(이름 열은 flex → 저장 폭 없음). */
export type DetailsColumn = 'size' | 'type' | 'mtime'

/** 자세히 보기 고정폭 열 너비(px). 이름 열은 남은 공간 flex. */
export interface DetailsColumnWidths {
  readonly size: number
  readonly type: number
  readonly mtime: number
}

/** 열 최소 너비(px) — 리사이즈/coerce 공통 하한. 라벨이 뭉개지지 않는 최소값. */
export const COLUMN_MIN_WIDTH = 48
/** 열 최대 너비(px) — 한 열이 패널을 독점하지 않게 하는 상한(과도값 방어·coerce 클램프). */
export const COLUMN_MAX_WIDTH = 600

/**
 * 기본 고정폭 열 너비(px). 헤더 도입 전 행에 하드코딩돼 있던 값과 동일하게 유지해
 * 기존 레이아웃을 보존한다(size 90 / type 60 / mtime 140).
 */
export const DEFAULT_DETAILS_COLUMN_WIDTHS: DetailsColumnWidths = {
  size: 90,
  type: 60,
  mtime: 140
}

/**
 * 열 너비 1개를 [min, max] 로 클램프한다(반올림·비유한수 방어).
 * 드래그 중 px 산출과 coerce 가 공유하는 순수 함수.
 * @param px   목표 너비(px). 비유한수(NaN/Infinity)면 min 폴백.
 * @param min  하한(기본 COLUMN_MIN_WIDTH).
 * @param max  상한(기본 COLUMN_MAX_WIDTH).
 */
export function clampColumnWidth(
  px: number,
  min: number = COLUMN_MIN_WIDTH,
  max: number = COLUMN_MAX_WIDTH
): number {
  if (!Number.isFinite(px)) return min
  const r = Math.round(px)
  if (r < min) return min
  if (r > max) return max
  return r
}

/**
 * raw(디스크/네트워크) 값을 완전·유효한 DetailsColumnWidths 로 정규화한다.
 * - 입력이 객체가 아니면(누락/null/배열/원시값) 전부 기본값 — 구버전 세션 호환.
 * - 각 열은 clampColumnWidth 로 클램프(비유한수/범위밖 방어). 누락 키는 기본값.
 * 비파괴: 구버전(필드 없음)은 기본값 round-trip 동등.
 */
export function coerceDetailsColumnWidths(raw: unknown): DetailsColumnWidths {
  const d = DEFAULT_DETAILS_COLUMN_WIDTHS
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return d
  const o = raw as Record<string, unknown>
  const pick = (v: unknown, fb: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? clampColumnWidth(v) : fb
  return {
    size: pick(o['size'], d.size),
    type: pick(o['type'], d.type),
    mtime: pick(o['mtime'], d.mtime)
  }
}
