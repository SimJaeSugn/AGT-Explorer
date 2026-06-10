/**
 * 내용 검색(grep) 결과 표현 순수 로직 (renderer/domain/rules/contentSearch) — 순수 TS,
 * 부수효과 없음 (S1·US-18.1·ADR-010).
 *
 * 백엔드 `search:content:*` 가 푸시한 파일 단위 결과(GrepMatchDTO)를 UI 가 그리기 위한
 * 순수 변환만 담는다: ① 결과의 상대경로 표시, ② 일치 구간(ranges, end-exclusive) 으로
 * 줄 텍스트를 하이라이트 세그먼트로 분해, ③ 그룹(파일헤더+줄) 결과를 가상 스크롤·키보드
 * 이동을 위해 평탄한 행(row) 목록으로 펼침.
 *
 * React/DOM 비의존 → 헤드리스 verify(tests/contentsearch.verify) 로 검증 가능.
 */
import type { GrepLineDTO, GrepMatchDTO } from '@shared/dto'

/** 경로 구분자 정규화('/' → '\\') — paths.toBackslash 와 동일 규칙(의존 최소화). */
function toBackslash(p: string): string {
  return p.replace(/\//g, '\\')
}

/**
 * 결과 파일의 검색 루트 기준 상대경로(표시용). root 하위면 선행 구분자를 떼고,
 * root 와 무관하거나(방어) root 가 빈 경우 절대경로를 그대로 돌려준다.
 * 대소문자 무시 비교(Windows FS) — 단 표시는 원래 file 문자열을 보존한다.
 */
export function relativizePath(root: string, file: string): string {
  if (root === '') return file
  const r = toBackslash(root).replace(/\\+$/, '')
  const f = toBackslash(file)
  const rl = r.toLowerCase()
  const fl = f.toLowerCase()
  // root 자기 자신이면 파일명만(이 경우는 사실상 없음 — 방어).
  if (fl === rl) {
    const idx = f.lastIndexOf('\\')
    return idx >= 0 ? f.slice(idx + 1) : f
  }
  const prefix = rl + '\\'
  if (fl.startsWith(prefix)) {
    return f.slice(prefix.length)
  }
  return file
}

/** 하이라이트 분해 세그먼트: 일반 텍스트 또는 일치 구간. */
export interface HighlightSeg {
  readonly text: string
  readonly hit: boolean
}

/**
 * 줄 텍스트를 ranges([start,end) end-exclusive) 로 하이라이트 세그먼트 배열로 분해한다.
 * - 범위는 정렬·클램프·중첩 병합으로 견고화(엔진이 정렬해 보내더라도 방어).
 * - 빈/무효 범위는 무시. 텍스트 밖 범위는 길이로 클램프.
 * - 결과를 이어붙이면 원본 text 와 동일(무손실).
 */
export function splitHighlight(
  text: string,
  ranges: ReadonlyArray<readonly [number, number]>
): HighlightSeg[] {
  const len = text.length
  // 유효 범위만 추려 [start,end) 정규화(클램프·start<end).
  const norm: Array<[number, number]> = []
  for (const r of ranges) {
    const start = Math.max(0, Math.min(len, Math.trunc(r[0])))
    const end = Math.max(0, Math.min(len, Math.trunc(r[1])))
    if (end > start) norm.push([start, end])
  }
  if (norm.length === 0) {
    return text === '' ? [] : [{ text, hit: false }]
  }
  // 시작 기준 정렬 후 중첩/인접 병합.
  norm.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const merged: Array<[number, number]> = []
  for (const cur of norm) {
    const last = merged[merged.length - 1]
    if (last && cur[0] <= last[1]) {
      if (cur[1] > last[1]) last[1] = cur[1]
    } else {
      merged.push([cur[0], cur[1]])
    }
  }
  // 병합 범위로 일반/일치 세그먼트를 교대 생성.
  const out: HighlightSeg[] = []
  let cursor = 0
  for (const [s, e] of merged) {
    if (s > cursor) out.push({ text: text.slice(cursor, s), hit: false })
    out.push({ text: text.slice(s, e), hit: true })
    cursor = e
  }
  if (cursor < len) out.push({ text: text.slice(cursor), hit: false })
  return out
}

/** 평탄화된 결과 행 종류: 파일 헤더(점프 대상) 또는 일치 줄(점프 대상). */
export type ResultRow =
  | {
      readonly kind: 'file'
      /** 결과 그룹 인덱스(results 배열 인덱스). */
      readonly groupIndex: number
      /** 절대경로(점프·미리보기 키). */
      readonly file: string
      /** 표시용 상대경로. */
      readonly relPath: string
      /** 이 파일의 일치 줄 수. */
      readonly lineCount: number
    }
  | {
      readonly kind: 'line'
      readonly groupIndex: number
      readonly file: string
      readonly relPath: string
      readonly line: GrepLineDTO
    }

/**
 * 그룹(파일별) 결과를 가상 스크롤·키보드 이동용 평탄한 행 목록으로 펼친다.
 * 각 파일마다 헤더 1행 + 일치 줄 N행. 파일 헤더와 줄 모두 점프 대상이므로
 * 모든 행이 선택(focus) 가능하다 — 인덱스가 곧 키보드 커서 위치.
 */
export function flattenResults(root: string, results: readonly GrepMatchDTO[]): ResultRow[] {
  const rows: ResultRow[] = []
  for (let g = 0; g < results.length; g++) {
    const m = results[g] as GrepMatchDTO
    const relPath = relativizePath(root, m.file)
    rows.push({
      kind: 'file',
      groupIndex: g,
      file: m.file,
      relPath,
      lineCount: m.lines.length
    })
    for (const line of m.lines) {
      rows.push({ kind: 'line', groupIndex: g, file: m.file, relPath, line })
    }
  }
  return rows
}

/** 평탄 결과 행 수(헤더 + 줄). 진행/표시 보조용. */
export function countRows(results: readonly GrepMatchDTO[]): number {
  let n = 0
  for (const m of results) n += 1 + m.lines.length
  return n
}

/**
 * 키보드 이동(↑/↓) 다음 인덱스 산출. 모든 행이 이동 대상이므로 단순 클램프 이동.
 * rowCount===0 이면 -1.
 */
export function nextRowIndex(current: number, delta: number, rowCount: number): number {
  if (rowCount <= 0) return -1
  if (current < 0) return delta > 0 ? 0 : rowCount - 1
  const n = current + delta
  if (n < 0) return 0
  if (n >= rowCount) return rowCount - 1
  return n
}
