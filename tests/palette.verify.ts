/* S2 명령 팔레트 퍼지 매칭(paletteMatch) 순수 로직 검증(임시 하니스).
 * domain.verify.ts 와 동일한 eq()/summary 구조. esbuild 번들 가능. */
import {
  scoreLabel,
  matchPalette,
  type PaletteCandidate
} from '../src/renderer/domain/rules/paletteMatch'

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

// ── scoreLabel: 부분열 매칭 성공/실패 ──────────────────────────────────────
eq('S2 부분열 매칭 성공', scoreLabel('Command Palette', 'cmd') !== null, true)
eq('S2 부분열 매칭 실패(없는 글자)', scoreLabel('Command Palette', 'xyz'), null)
eq('S2 순서 어긋나면 실패', scoreLabel('abc', 'cba'), null)
eq('S2 질의 길이 초과 실패', scoreLabel('ab', 'abc'), null)

// 빈 질의 → 점수 0·빈 인덱스.
eq('S2 빈 질의 점수0', scoreLabel('anything', ''), { score: 0, indices: [] })
eq('S2 공백 질의 점수0', scoreLabel('anything', '   '), { score: 0, indices: [] })

// 대소문자 무시.
eq('S2 대소문자 무시 매칭', scoreLabel('NewTab', 'nt') !== null, true)

// 매칭 인덱스(부분열 위치).
eq('S2 매칭 인덱스', scoreLabel('abcdef', 'ace')?.indices, [0, 2, 4])

// ── 점수 비교(상대 순위만 의미) ────────────────────────────────────────────
// 접두 매칭 > 중간 매칭.
{
  const prefix = scoreLabel('open settings', 'open')!.score
  const mid = scoreLabel('reopen tab', 'open')!.score
  eq('S2 접두 매칭이 중간 매칭보다 높음', prefix > mid, true)
}
// 연속(contiguous) 매칭 > 흩어진 매칭(같은 라벨).
{
  const contiguous = scoreLabel('abcxyz', 'abc')!.score
  const scattered = scoreLabel('axbxcx', 'abc')!.score
  eq('S2 연속 매칭이 흩어진 매칭보다 높음', contiguous > scattered, true)
}
// 단어 경계(약어) 매칭 가산: "co pa" → "Command Palette" 두 단어 시작.
{
  const boundary = scoreLabel('Command Palette', 'cp')!.score // C..P 둘 다 단어 시작
  const inWord = scoreLabel('accomplish', 'cp')!.score // 단어 내부
  eq('S2 단어 경계 약어 매칭 가산', boundary > inWord, true)
}

// ── matchPalette: 정렬·필터·안정성 ────────────────────────────────────────
const cand = (label: string, value: string): PaletteCandidate<string> => ({ label, value })

// 빈 질의 → 전부 통과·입력 순서 보존.
;{
  const list = [cand('Zeta', 'z'), cand('Alpha', 'a'), cand('Mid', 'm')]
  const r = matchPalette(list, '')
  eq('S2 빈 질의 전부 통과', r.length, 3)
  eq('S2 빈 질의 입력 순서 보존', r.map((m) => m.candidate.value), ['z', 'a', 'm'])
}

// 비매칭 후보 제외.
{
  const list = [cand('New Tab', 'tab.new'), cand('Close Tab', 'tab.close'), cand('Settings', 'app.settings')]
  const r = matchPalette(list, 'tab')
  eq('S2 비매칭 제외(Settings 빠짐)', r.map((m) => m.candidate.value).includes('app.settings'), false)
  eq('S2 매칭만 남음', r.length, 2)
}

// 점수 내림차순 정렬: 접두 매칭이 위로.
{
  const list = [cand('Reopen Closed Tab', 'reopen'), cand('Open Settings', 'open')]
  const r = matchPalette(list, 'open')
  eq('S2 접두 매칭이 상위', r[0]!.candidate.value, 'open')
}

// 동점 안정성: 같은 점수면 입력 순서 보존.
{
  const list = [cand('aa', 'first'), cand('aa', 'second')]
  const r = matchPalette(list, 'aa')
  eq('S2 동점 입력 순서 보존', r.map((m) => m.candidate.value), ['first', 'second'])
}

// value 패스스루(매칭에 미사용·그대로 반환).
{
  const r = matchPalette([cand('Command Palette', 'palette.open')], 'cmd pal')
  eq('S2 value 패스스루', r[0]?.candidate.value, 'palette.open')
  eq('S2 matchedIndices 노출', Array.isArray(r[0]?.matchedIndices), true)
}

// 즐겨찾기/드라이브 라벨도 동일 규칙으로 매칭(혼합 소스).
{
  const mixed = [
    cand('명령: 새 탭', 'cmd:tab.new'),
    cand('★ 프로젝트', 'fav:C:\\Projects'),
    cand('드라이브 C:', 'drive:C:\\')
  ]
  const r = matchPalette(mixed, '프로젝트')
  eq('S2 한글 즐겨찾기 매칭', r[0]?.candidate.value, 'fav:C:\\Projects')
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
