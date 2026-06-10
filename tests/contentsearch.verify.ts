/* S1 내용 검색(grep) 결과 표현 순수 로직 검증(임시 하니스).
 * domain.verify.ts / palette.verify.ts 와 동일한 eq()/summary 구조. esbuild 번들 가능. */
import {
  relativizePath,
  splitHighlight,
  flattenResults,
  countRows,
  nextRowIndex
} from '../src/renderer/domain/rules/contentSearch'
import type { GrepMatchDTO } from '../src/shared/dto'

let pass = 0
let fail = 0
function eq(label: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got)
  const w = JSON.stringify(want)
  if (g === w) pass++
  else {
    fail++
    console.log('FAIL', label, '| got', g, '| want', w)
  }
}

// ── relativizePath: 루트 기준 상대경로 ─────────────────────────────────────
eq(
  'S1 rel 하위파일',
  relativizePath('C:\\proj', 'C:\\proj\\src\\a.ts'),
  'src\\a.ts'
)
eq('S1 rel 직속파일', relativizePath('C:\\proj', 'C:\\proj\\a.ts'), 'a.ts')
eq('S1 rel 끝슬래시 루트', relativizePath('C:\\proj\\', 'C:\\proj\\a.ts'), 'a.ts')
eq(
  'S1 rel 대소문자 무시',
  relativizePath('C:\\Proj', 'c:\\proj\\Sub\\B.txt'),
  'Sub\\B.txt'
)
eq('S1 rel 슬래시 정규화', relativizePath('C:/proj', 'C:/proj/x/y.md'), 'x\\y.md')
// 루트 밖(방어) → 절대경로 그대로.
eq('S1 rel 루트밖 절대유지', relativizePath('C:\\proj', 'D:\\other\\z.txt'), 'D:\\other\\z.txt')
// 빈 루트 → 절대경로 그대로.
eq('S1 rel 빈루트', relativizePath('', 'C:\\a\\b.txt'), 'C:\\a\\b.txt')
// 접두 유사(proj vs project) 오매칭 방지 — 구분자 경계.
eq(
  'S1 rel 접두유사 오매칭 방지',
  relativizePath('C:\\proj', 'C:\\project\\a.txt'),
  'C:\\project\\a.txt'
)

// ── splitHighlight: end-exclusive ranges → 세그먼트 ────────────────────────
eq('S1 hl 단일 일치', splitHighlight('hello world', [[0, 5]]), [
  { text: 'hello', hit: true },
  { text: ' world', hit: false }
])
eq('S1 hl 중간 일치', splitHighlight('abcde', [[1, 3]]), [
  { text: 'a', hit: false },
  { text: 'bc', hit: true },
  { text: 'de', hit: false }
])
eq('S1 hl 끝 일치', splitHighlight('abcde', [[3, 5]]), [
  { text: 'abc', hit: false },
  { text: 'de', hit: true }
])
eq('S1 hl 다중 일치', splitHighlight('a x a x', [[0, 1], [4, 5]]), [
  { text: 'a', hit: true },
  { text: ' x ', hit: false },
  { text: 'a', hit: true },
  { text: ' x', hit: false }
])
// 범위 없음 → 전체 일반.
eq('S1 hl 범위없음', splitHighlight('plain', []), [{ text: 'plain', hit: false }])
// 빈 텍스트.
eq('S1 hl 빈텍스트', splitHighlight('', []), [])
// 정렬 안 된 입력도 정렬 처리.
eq('S1 hl 미정렬 입력 정렬', splitHighlight('abcde', [[3, 5], [0, 1]]), [
  { text: 'a', hit: true },
  { text: 'bc', hit: false },
  { text: 'de', hit: true }
])
// 중첩/인접 병합.
eq('S1 hl 중첩 병합', splitHighlight('abcdef', [[0, 3], [2, 5]]), [
  { text: 'abcde', hit: true },
  { text: 'f', hit: false }
])
eq('S1 hl 인접 병합', splitHighlight('abcdef', [[0, 2], [2, 4]]), [
  { text: 'abcd', hit: true },
  { text: 'ef', hit: false }
])
// 텍스트 밖 범위 클램프 + 무효(start>=end) 무시.
eq('S1 hl 범위 클램프', splitHighlight('abc', [[1, 99]]), [
  { text: 'a', hit: false },
  { text: 'bc', hit: true }
])
eq('S1 hl 무효범위 무시', splitHighlight('abc', [[2, 2], [1, 0]]), [{ text: 'abc', hit: false }])
// 무손실: 세그먼트 이어붙이면 원본.
{
  const text = 'TODO fix this TODO later'
  const segs = splitHighlight(text, [[0, 4], [14, 18]])
  eq('S1 hl 무손실 재조합', segs.map((s) => s.text).join(''), text)
}

// ── flattenResults / countRows ─────────────────────────────────────────────
const results: GrepMatchDTO[] = [
  {
    file: 'C:\\proj\\a.ts',
    lines: [
      { lineNo: 3, text: 'const TODO = 1', ranges: [[6, 10]] },
      { lineNo: 9, text: 'x // TODO', ranges: [[5, 9]] }
    ]
  },
  {
    file: 'C:\\proj\\sub\\b.ts',
    lines: [{ lineNo: 1, text: 'TODO', ranges: [[0, 4]] }]
  }
]

{
  const rows = flattenResults('C:\\proj', results)
  // 헤더2 + 줄3 = 5행.
  eq('S1 flat 행수', rows.length, 5)
  eq('S1 flat 첫행 파일헤더', rows[0]?.kind, 'file')
  eq('S1 flat 첫헤더 상대경로', (rows[0] as { relPath: string }).relPath, 'a.ts')
  eq('S1 flat 둘째행 줄', rows[1]?.kind, 'line')
  eq('S1 flat 줄 그룹인덱스', (rows[1] as { groupIndex: number }).groupIndex, 0)
  eq('S1 flat 4째행 두번째 헤더', rows[3]?.kind, 'file')
  eq('S1 flat 두번째 헤더 상대경로', (rows[3] as { relPath: string }).relPath, 'sub\\b.ts')
  eq('S1 flat 헤더 일치수', (rows[0] as { lineCount: number }).lineCount, 2)
  // 모든 행에 절대경로 file 보존(점프 키).
  eq('S1 flat 줄행 file 보존', (rows[4] as { file: string }).file, 'C:\\proj\\sub\\b.ts')
}

eq('S1 countRows', countRows(results), 5)
eq('S1 countRows 빈', countRows([]), 0)

// ── nextRowIndex: 키보드 이동 클램프 ───────────────────────────────────────
eq('S1 nav 첫 아래(미설정)', nextRowIndex(-1, 1, 5), 0)
eq('S1 nav 첫 위(미설정)', nextRowIndex(-1, -1, 5), 4)
eq('S1 nav 아래', nextRowIndex(0, 1, 5), 1)
eq('S1 nav 위', nextRowIndex(3, -1, 5), 2)
eq('S1 nav 상단 클램프', nextRowIndex(0, -1, 5), 0)
eq('S1 nav 하단 클램프', nextRowIndex(4, 1, 5), 4)
eq('S1 nav 빈 결과', nextRowIndex(0, 1, 0), -1)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
