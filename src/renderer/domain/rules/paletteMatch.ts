/**
 * 명령 팔레트 퍼지 매칭/스코어링 (renderer/domain/rules/paletteMatch) — 순수 함수.
 *
 * S2(US-18.2): 사용자가 입력한 질의를 후보 항목 라벨에 대해 **부분열(subsequence)
 * 퍼지 매칭**하고, 점수가 높은 순으로 정렬한다. 점수 규칙(높을수록 우선):
 *   - 부분열 매칭 실패 → 후보 제외(점수 없음).
 *   - 연속(인접) 매칭 보너스: 직전 매칭 문자 바로 뒤에 이어지면 가산.
 *   - 접두(prefix) 보너스: 라벨 맨 앞에서 매칭이 시작되면 가산.
 *   - 단어 경계(공백·구분자 직후) 보너스: 약어 검색("co pa"→"Command Palette") 강화.
 *   - 매칭 위치가 앞쪽일수록 미세 가산(앞에서 매칭되는 후보 우대).
 * 대소문자 무시. 빈 질의는 "모두 매칭(점수 0, 입력 순서 보존)".
 *
 * 동점 시 입력(후보 배열) 순서를 보존하기 위해 안정 정렬을 사용하고, 동점은
 * 원래 인덱스로 타이브레이크한다(결정론). 부수효과 없음·react/infra 비의존(.eslintrc).
 */

/** 매칭 가능한 후보 1개(라벨만 매칭에 사용). value 는 호출측 식별자 패스스루. */
export interface PaletteCandidate<T = unknown> {
  /** 매칭 대상 표시 라벨(사람이 읽는 문자열). */
  readonly label: string
  /** 호출측 식별 데이터(commandId·경로 등). 매칭에는 쓰이지 않고 그대로 반환. */
  readonly value: T
}

/** 매칭 결과 1개(점수·원래 인덱스 포함). */
export interface PaletteMatch<T = unknown> {
  readonly candidate: PaletteCandidate<T>
  /** 매칭 점수(높을수록 우선). 빈 질의는 0. */
  readonly score: number
  /** 매칭된 문자들의 라벨 내 인덱스(하이라이트용·빈 질의면 빈 배열). */
  readonly matchedIndices: readonly number[]
}

// 점수 가중치(상대값만 의미 있음).
const SCORE_BASE = 1 // 매칭 문자당 기본 점수.
const BONUS_CONTIGUOUS = 8 // 직전 매칭에 이어진 연속 매칭.
const BONUS_PREFIX = 12 // 라벨 맨 앞에서 시작.
const BONUS_WORD_BOUNDARY = 6 // 단어 경계(공백/구분자 직후) 매칭.
const PENALTY_LEADING = 0.2 // 첫 매칭이 뒤쪽일수록 미세 감점(위치 패널티 계수).

/** 단어 경계 직전 문자(이 뒤 문자는 단어 시작으로 본다). */
function isBoundaryChar(ch: string): boolean {
  return ch === ' ' || ch === '_' || ch === '-' || ch === '/' || ch === '\\' || ch === '.' || ch === ':'
}

/**
 * 단일 후보에 대한 퍼지 매칭 점수.
 * @returns 매칭 실패면 null, 성공이면 { score, indices }.
 */
export function scoreLabel(
  label: string,
  query: string
): { readonly score: number; readonly indices: number[] } | null {
  const q = query.trim().toLowerCase()
  if (q === '') return { score: 0, indices: [] }
  const lower = label.toLowerCase()

  let score = 0
  let qi = 0
  let prevMatch = -2 // 직전 매칭 인덱스(연속 판정용). -2 로 초기화해 0 도 비연속.
  let firstMatch = -1
  const indices: number[] = []

  for (let i = 0; i < lower.length && qi < q.length; i++) {
    if (lower[i] !== q[qi]) continue
    // 매칭 1글자.
    indices.push(i)
    if (firstMatch === -1) firstMatch = i
    score += SCORE_BASE
    if (i === 0) {
      score += BONUS_PREFIX
    } else if (isBoundaryChar(lower[i - 1] as string)) {
      score += BONUS_WORD_BOUNDARY
    }
    if (i === prevMatch + 1) {
      score += BONUS_CONTIGUOUS
    }
    prevMatch = i
    qi++
  }

  // 질의 전부 소비 못 하면 부분열 매칭 실패.
  if (qi < q.length) return null

  // 첫 매칭 위치가 뒤쪽일수록 미세 감점(앞 매칭 우대·동점 분해).
  score -= firstMatch * PENALTY_LEADING

  return { score, indices }
}

/**
 * 후보 목록을 질의로 매칭·정렬한다.
 * - 빈 질의: 전부 통과(점수 0·입력 순서 보존).
 * - 비매칭 후보는 제외.
 * - 정렬: 점수 내림차순, 동점은 입력 순서(원래 인덱스) 보존(안정·결정론).
 */
export function matchPalette<T>(
  candidates: readonly PaletteCandidate<T>[],
  query: string
): PaletteMatch<T>[] {
  const q = query.trim()
  const scored: { match: PaletteMatch<T>; idx: number }[] = []
  for (let idx = 0; idx < candidates.length; idx++) {
    const c = candidates[idx] as PaletteCandidate<T>
    const r = scoreLabel(c.label, q)
    if (r === null) continue
    scored.push({
      match: { candidate: c, score: r.score, matchedIndices: r.indices },
      idx
    })
  }
  scored.sort((a, b) => {
    if (b.match.score !== a.match.score) return b.match.score - a.match.score
    return a.idx - b.idx // 동점 → 입력 순서 보존(안정 정렬 대체).
  })
  return scored.map((x) => x.match)
}
