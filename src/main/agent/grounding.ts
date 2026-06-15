/**
 * src/main/agent/grounding.ts — §Z 경로 그라운딩(환각 경로 호출 완화·순수·IO 0).
 *
 * 문제(실 관찰): 모델이 Windows 환경인데 `/path/to/Projects`·`/Users/Username/...`·
 * `/Users/Alice/...` 같은 **Unix식 placeholder/창작 경로**로 도구를 연속 호출한다(존재하지 않는
 * 경로 → is_error → 다음 턴에도 또 창작). 근본 완화는 **모델이 실제 경로를 먼저 보고 그대로
 * 쓰도록 그라운딩**하는 것이다.
 *
 * 본 모듈은 두 가지를 만든다(둘 다 순수 문자열 빌드 — provider/IO/electron import 0 → 헤드리스
 * verify 대상):
 *   1) buildGroundingBlock(locations, cwd): 실제 존재하는 위치(드라이브·cwd·즐겨찾기·빠른위치·
 *      최근·패널)를 간결한 "사용 가능한 실제 경로" 블록으로 직렬화(상한으로 폭주 방지). Planner·
 *      Executor 시스템 프롬프트에 선주입한다. locations 가 비면 "먼저 list_locations 로 조회" 안내.
 *   2) GROUNDING_HARD_RULES: "경로를 추측·창작하지 말 것" 하드 규칙 텍스트(Windows·역슬래시·
 *      placeholder 금지·list_locations 우선). Planner/Executor 공통 상수.
 *
 * 안전: 읽기 전용·표시용 텍스트만 — 스코프/guardPath/실행 경로 불변. fs 접근 0(locations 는
 * 렌더러가 모아 패스스루한 메타데이터·main 은 검증/실행 시점에만 fs 접근).
 */
import type { AgentLocations } from '@shared/ipc/contracts'

/** 그라운딩 블록 분류별 표시 상한(프롬프트 토큰 폭주 방지). */
export const GROUNDING_MAX_PER_CATEGORY = 12

/**
 * 경로 거부형 에러를 식별하는 마커(리다이렉트 에러·open_tab 미존재 에러에 항상 포함).
 * 반복 환각 가드(연속 N회 경로 에러 → 강한 list_locations 힌트 주입)가 이 마커로 판정한다.
 */
export const PATH_ERROR_MARKER = 'list_locations'

/** 연속 경로 에러 임계 — 도달 시 1회 강한 list_locations 힌트 주입(반복 환각 가드). */
export const MAX_CONSECUTIVE_PATH_ERRORS = 3

/**
 * 힌트 주입 후에도 연속 경로 거부가 이 임계에 도달하면 루프를 중단한다(턴 낭비 방지·정직 종료).
 * 힌트로도 그라운딩에 실패하는 모델이 MAX_TURNS(24)까지 같은 창작 경로를 반복하는 것을 막는다.
 */
export const MAX_PATH_ERRORS_BEFORE_ABORT = 6

/** 반복 환각 가드 주입 힌트(실제 경로 조회 강제). */
export const REPEATED_PATH_ERROR_HINT =
  '[시스템 안내] 경로 인자가 연속으로 거부되었습니다. 더 이상 경로를 추측·창작하지 마세요. ' +
  '지금 즉시 list_locations 를 호출해 실제 경로 목록(드라이브·즐겨찾기·빠른위치·최근·패널)을 받은 뒤, ' +
  '거기서 반환된 path 문자열을 그대로 복사해 다음 도구를 호출하세요. 이 시스템은 Windows 입니다.'

/** 경로 그라운딩 반복 실패로 중단할 때 사용자에게 보일 정직한 요약(부분 답이 없을 때). */
export const PATH_ERROR_ABORT_NOTE =
  '요청한 위치의 실제 경로를 확인하지 못해 작업을 중단했습니다. ' +
  '폴더를 정확한 경로(예: E:\\03.프로젝트\\foo)로 다시 알려주시거나, 즐겨찾기·드라이브 이름으로 지정해 주세요.'

/** 반복 환각 가드의 단계적 조치(순수·verify 대상). */
export type PathGuardAction = 'none' | 'hint' | 'abort'

/**
 * 연속 경로 거부 횟수와 힌트 주입 여부로 다음 조치를 정한다(순수).
 * - 임계(MAX_PATH_ERRORS_BEFORE_ABORT) 도달 → 'abort'(힌트 여부 무관·중단 우선).
 * - 1차 임계(MAX_CONSECUTIVE_PATH_ERRORS) 도달·힌트 미주입 → 'hint'(1회 강한 안내).
 * - 그 외 → 'none'.
 */
export function pathGuardAction(consecutivePathErrors: number, hintInjected: boolean): PathGuardAction {
  if (consecutivePathErrors >= MAX_PATH_ERRORS_BEFORE_ABORT) return 'abort'
  if (consecutivePathErrors >= MAX_CONSECUTIVE_PATH_ERRORS && !hintInjected) return 'hint'
  return 'none'
}

/** content 가 경로 거부형 에러인지(반복 가드 판정·순수). */
export function isPathError(content: string): boolean {
  return typeof content === 'string' && content.includes(PATH_ERROR_MARKER)
}

/**
 * 경로 추측·창작 금지 하드 규칙(Planner/Executor 공통). 실제 관찰된 환각 패턴(Unix식 placeholder)을
 * 명시적으로 금지하고 list_locations 우선·Windows 역슬래시를 못박는다.
 */
export const GROUNDING_HARD_RULES =
  '경로 규칙(반드시 준수):\n' +
  '- 이 시스템은 Windows 입니다. 경로는 역슬래시와 드라이브 문자를 씁니다(예: E:\\03.프로젝트\\foo). ' +
  '`/path/to/...`, `/Users/Username/...`, `/Users/<이름>/...`, `/home/...` 같은 Unix식·예시·placeholder 경로는 ' +
  '이 시스템에 존재하지 않으므로 **절대 사용하지 마세요**.\n' +
  '- 경로를 **추측하거나 지어내지 마세요**. 반드시 list_locations 또는 list_directory 가 실제로 반환한 ' +
  'path 문자열을 **그대로 복사해서** 사용하세요.\n' +
  '- 어떤 위치의 실제 경로를 모르면, 도구 인자에 경로를 창작하지 말고 **먼저 list_locations 를 호출**해 ' +
  '실제 경로(드라이브·즐겨찾기·빠른위치·최근·패널)를 얻은 뒤 그 경로로 다음 도구를 호출하세요.\n' +
  '- 도구가 "존재하지 않음/스코프 밖" 으로 거부하면, 같은 경로를 다시 시도하지 말고 list_locations 로 ' +
  '실제 경로를 확인해 교정하세요.'

/** 한 항목을 "이름=경로" 로 직렬화(가상 경로는 표시만·탐색 불가 주석). 빈 경로 제외. */
function formatItem(it: { name: string; path: string }): string | null {
  const path = (it.path ?? '').trim()
  if (!path) return null
  const name = (it.name ?? '').trim()
  return name ? `${name}=${path}` : path
}

/** 분류 1개를 "라벨: a=p, b=q …(+N)" 한 줄로(상한 초과분은 +N 표기). */
function formatCategory(label: string, items: readonly { name: string; path: string }[] | undefined): string | null {
  if (!items || items.length === 0) return null
  const shown = items.slice(0, GROUNDING_MAX_PER_CATEGORY)
  const parts = shown.map(formatItem).filter((s): s is string => s !== null)
  if (parts.length === 0) return null
  const extra = items.length > shown.length ? `  …(외 ${items.length - shown.length}개)` : ''
  return `- ${label}: ${parts.join(' , ')}${extra}`
}

/**
 * 실제 존재하는 위치 + cwd 를 "사용 가능한 실제 경로" 블록으로 직렬화(순수).
 * - locations 가 모두 비고 cwd 도 없으면, 창작 대신 list_locations/list_directory 로 먼저 조회하라는
 *   안내만 반환한다(모델이 빈 컨텍스트에서 경로를 지어내는 것을 차단).
 * - 가상(remote/archive) 경로도 list 에는 그대로 나오지만(표시용), 그라운딩은 로컬/표시 구분 없이
 *   "실제 path 문자열을 그대로 써라"는 원칙만 강조한다(스코프/가상 판정은 실행 시 scope.ts 가 처리).
 */
export function buildGroundingBlock(locations: AgentLocations | undefined, cwd?: string): string {
  const lines: string[] = []
  const cwdTrim = (cwd ?? '').trim()
  if (cwdTrim) lines.push(`- 현재 폴더(cwd): ${cwdTrim}`)

  const cat = (label: string, items: readonly { name: string; path: string }[] | undefined): void => {
    const line = formatCategory(label, items)
    if (line) lines.push(line)
  }
  if (locations) {
    cat('드라이브', locations.drives)
    cat('즐겨찾기', locations.favorites)
    cat('빠른위치', locations.quickAccess)
    cat('최근 방문', locations.recent)
    // 패널은 index 라벨 부여(이름 필드 없음).
    if (locations.panels && locations.panels.length > 0) {
      const panelItems = locations.panels.map((p) => ({ name: `패널${p.index}${p.active ? '(활성)' : ''}`, path: p.path }))
      cat('열린 패널', panelItems)
    }
  }

  if (lines.length === 0) {
    return (
      '사용 가능한 실제 경로(그라운딩):\n' +
      '- (제공된 위치 없음) 경로를 창작하지 말고, 먼저 list_locations 로 실제 위치를 조회하거나 ' +
      'list_directory 로 드라이브 루트부터 탐색하세요.'
    )
  }
  return '사용 가능한 실제 경로(그라운딩 — 아래 path 문자열을 그대로 사용):\n' + lines.join('\n')
}

/**
 * base 시스템 프롬프트에 그라운딩 블록 + 하드 규칙을 덧붙인다(Planner/Executor 공통 헬퍼).
 * 비파괴: base 는 그대로 두고 뒤에 추가(기존 안전 레일·도구 지침 보존).
 */
export function withGrounding(base: string, locations: AgentLocations | undefined, cwd?: string): string {
  return base + '\n\n' + buildGroundingBlock(locations, cwd) + '\n\n' + GROUNDING_HARD_RULES
}
