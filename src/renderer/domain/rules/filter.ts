/**
 * 검색/필터 술어 + 하이라이트 (renderer/domain/rules/filter) — 순수 TS, 부수효과 없음.
 *
 * 현재 폴더 내 이름/확장자 필터(US-4.1/US-4.2). 패턴 규칙:
 *   - 와일드카드(`*`, `?`)가 있으면 글롭으로 해석한다.
 *       `*.png`   → 확장자 png 인 항목(이름 전체가 패턴에 매칭)
 *       `report*` → "report" 로 시작하는 이름
 *       `a?c.txt` → ? 는 한 글자
 *   - 와일드카드가 없으면 **부분 일치**(대소문자 무시)로 본다(빠른 점증 검색).
 *   - `.ext` 처럼 점으로 시작하면 확장자 필터로도 해석(이름 부분일치와 OR).
 *
 * UI(selectors)·검색바·상태바가 공유한다. 디바운스/가시영역 우선은 UI 책임.
 */
import type { FileEntryDTO } from '@shared/dto'

/** 패턴이 글롭(와일드카드 포함)인지. */
function isGlob(pattern: string): boolean {
  return pattern.includes('*') || pattern.includes('?')
}

/** 정규식 메타문자 이스케이프(글롭 변환용). */
function escapeRegex(s: string): string {
  return s.replace(/[.+^${}()|[\]\\]/g, '\\$&')
}

/** 글롭 패턴 → 앵커된 RegExp(대소문자 무시). `*`=임의, `?`=한 글자. */
export function globToRegExp(pattern: string): RegExp {
  const body = pattern
    .split('')
    .map((ch) => {
      if (ch === '*') return '.*'
      if (ch === '?') return '.'
      return escapeRegex(ch)
    })
    .join('')
  return new RegExp(`^${body}$`, 'i')
}

/**
 * 단일 항목이 쿼리에 매칭되는지(순수 술어).
 * 빈 쿼리는 항상 true(전체 표시). 글롭이면 글롭 매칭, 아니면 부분 일치.
 */
export function matchesQuery(entry: FileEntryDTO, rawQuery: string): boolean {
  const q = rawQuery.trim()
  if (q === '') return true
  const name = entry.name.toLowerCase()

  if (isGlob(q)) {
    return globToRegExp(q).test(entry.name)
  }

  const ql = q.toLowerCase()
  // ".png" 또는 "png" 형태는 확장자 일치도 허용(이름 부분일치와 OR).
  if (ql.startsWith('.')) {
    return entry.ext.toLowerCase() === ql.slice(1) || name.includes(ql)
  }
  return name.includes(ql)
}

/** 엔트리 목록을 쿼리로 필터(빈 쿼리면 동일 참조 반환 — 메모 친화). */
export function filterEntries(
  entries: readonly FileEntryDTO[],
  rawQuery: string
): readonly FileEntryDTO[] {
  if (rawQuery.trim() === '') return entries
  return entries.filter((e) => matchesQuery(e, rawQuery))
}

/** 하이라이트 구간 1개([start, end) 인덱스). */
export interface HighlightRange {
  readonly start: number
  readonly end: number
}

/**
 * 이름 안에서 부분일치 쿼리가 매칭된 첫 구간을 반환(하이라이트 표시용).
 * 글롭/빈/미매칭이면 null. 대소문자 무시.
 */
export function highlightRange(name: string, rawQuery: string): HighlightRange | null {
  const q = rawQuery.trim()
  if (q === '' || isGlob(q)) return null
  const idx = name.toLowerCase().indexOf(q.toLowerCase())
  if (idx < 0) return null
  return { start: idx, end: idx + q.length }
}
