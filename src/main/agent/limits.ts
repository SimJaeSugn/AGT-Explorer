/**
 * src/main/agent/limits.ts — 에이전트 루프 상한 상수 단일 출처(§Z · ADR-014 비기능 §8).
 *
 * AgentOrchestrator 루프(읽기 자율·쓰기 스테이징)의 하드 가드 상한을 한 곳에 모은다.
 * 변경/튜닝은 여기서만 — 루프 코드에 매직 넘버 산재 0.
 *
 * 순수 상수 모듈(IO·SDK·electron import 0) → 헤드리스 verify 직접 import 가능.
 */

/** 한 run 의 LLM 왕복(턴) 최대 횟수. 초과 시 부분 plan 으로 break. */
export const MAX_TURNS = 24

/** 한 run 에 적재 가능한 staged 쓰기 op 최대 개수(zAgentConfirmReq 상한과 일치). */
export const MAX_STAGED_OPS = 50

/** 한 run 에 실행 가능한 누적 도구 호출(read+write) 최대 횟수. */
export const MAX_TOOL_CALLS = 120

/**
 * 한 run 의 누적 토큰(input+output) 예산. **해제(무제한·사용자 요청 2026-06-14)** —
 * 로컬 모델은 토큰 비용이 없어 토큰 한도로 중단하지 않는다. 폭주 방지는 turns·tool-calls 가 담당.
 * (다시 켜려면 유한값으로.)
 */
export const MAX_TOKENS = Number.POSITIVE_INFINITY

/**
 * 한 run 의 벽시계 시간 상한(ms). **해제(무제한·사용자 요청 2026-06-14)** —
 * 시간 한도로 중단하지 않는다(긴 탐색 허용). 폭주 방지는 turns·tool-calls 가 담당.
 */
export const MAX_WALL_MS = Number.POSITIVE_INFINITY

/** 한 도구 결과(tool_result content)의 최대 문자 길이(토큰 예산·UQ-Z1). 초과분 절단. */
export const MAX_TOOL_RESULT_CHARS = 16_000

/** 단일 LLM 턴 응답 토큰 상한(maxTokens 기본). */
export const DEFAULT_MAX_OUTPUT_TOKENS = 4_096

// ── 하이브리드(Plan-Execute + ReAct) 상한(ADR-016 §14.5·design §14.5) ─────────
// 전역 상한(MAX_TURNS·MAX_TOOL_CALLS·MAX_TOKENS·MAX_WALL_MS·MAX_TOOL_RESULT_CHARS)은
// 하이브리드 전체에 그대로 누적·항상 최종 차단한다. 아래는 plan/step/replan 단위 추가 가드.

/** ReasoningPlan 스텝 수 상한(plan 산출 시 절단). */
export const MAX_PLAN_STEPS = 8

/** 스텝당 미니루프(ReAct) 턴 상한. 전역 MAX_TURNS 가 항상 우선 차단(이건 스텝 무한루프 방지). */
export const MAX_STEP_TURNS = 6

/** 스텝 내 연속 is_error 임계(재계획 트리거). */
export const MAX_STEP_TOOL_ERRORS = 3

/** 재계획 횟수 상한(루프 가드·plan 해시 반복 감지도 종료). */
export const MAX_REPLANS = 2

/**
 * LLM 호출(createCompletion) 일시 오류 시 추가 재시도 최대 횟수(§Z 견고성).
 * 첫 시도 포함 총 (1 + MAX_LLM_RETRIES)회 시도한다. 일시 오류(429/5xx/네트워크 단절·타임아웃)만
 * 지수 백오프로 재시도하고, 영구 오류(인증 4xx·도구 파싱형·취소)는 재시도 없이 즉시 종료한다.
 */
export const MAX_LLM_RETRIES = 2

/** 전역 토큰/시간 임계 도달 비율 — 초과 시 재계획 금지·요약 종료(부분 답 보존). */
export const REPLAN_BUDGET_RATIO = 0.8

// ── 에이전트 search_content walk 바운드(§Z 프리징 근본·도구 적시 반환) ──────────
// 전역 grepEngine/verify:search 동작은 무변 — 아래는 **에이전트 어댑터 레벨**(readBackend)
// 에서만 적용하는 조기 종료/스킵 가드다(GUI 검색 패널은 영향 없음).

/**
 * 에이전트 search 결과 파일 상한(=readBackend MAX_GREP_FILES). 일치 파일이 이 수에 도달하면
 * 결과는 어차피 절단되므로 walk 를 더 진행하는 것은 낭비 → 즉시 중단(부분 결과 + "일부만" 표기).
 */
export const AGENT_SEARCH_MAX_MATCHED_FILES = 100

/** 에이전트 search 스캔 파일 캡 — 이 수만큼 텍스트 파일을 스캔하면 walk 중단(거대 트리 방어). */
export const AGENT_SEARCH_MAX_SCANNED_FILES = 20_000

/** 에이전트 search 시간 예산(ms) — 초과 시 walk 중단(도구가 적시에 반환). */
export const AGENT_SEARCH_TIME_BUDGET_MS = 15_000

/** tool-progress 푸시 스로틀(ms) — 이 간격 미만 진행은 합쳐 과도 푸시 방지. */
export const AGENT_TOOL_PROGRESS_THROTTLE_MS = 200

/** tool-progress 푸시 파일 간격 — 스캔 N파일마다도 푸시(첫 결과 빠른 피드백). */
export const AGENT_TOOL_PROGRESS_THROTTLE_FILES = 50

/** tool-progress current 경로 표시 최대 길이(토큰·로그 폭주 방지·새니타이즈 후 절단). */
export const AGENT_TOOL_PROGRESS_PATH_MAX = 240

/**
 * 에이전트 search 어댑터 한정 walk 제외 디렉토리(거대·노이즈 디렉토리 스킵·소문자 비교).
 * 전역 grep 동작은 무변 — readBackend/realReadDeps 의 에이전트 search 경로에서만 필터링한다.
 */
export const AGENT_SEARCH_SKIP_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  'dist',
  'out',
  '.cache'
])

/** 상한 종류(루프 중단 사유 보고용). */
export type LimitKind = 'turns' | 'staged-ops' | 'tool-calls' | 'tokens' | 'wall'

/** 누적 카운터에 대한 상한 초과 여부 판정(순수). */
export interface LoopCounters {
  readonly turns: number
  readonly stagedOps: number
  readonly toolCalls: number
  readonly tokens: number
  readonly elapsedMs: number
}

/**
 * 상한 초과 시 사유를, 아니면 null 을 반환(순수·verify 대상).
 * 루프는 매 턴 시작 전 이 함수로 break 여부를 판정한다.
 */
export function exceededLimit(c: LoopCounters): LimitKind | null {
  if (c.turns >= MAX_TURNS) return 'turns'
  if (c.stagedOps >= MAX_STAGED_OPS) return 'staged-ops'
  if (c.toolCalls >= MAX_TOOL_CALLS) return 'tool-calls'
  if (c.tokens >= MAX_TOKENS) return 'tokens'
  if (c.elapsedMs >= MAX_WALL_MS) return 'wall'
  return null
}

/**
 * 전역 토큰/시간/턴 예산이 REPLAN_BUDGET_RATIO 임계에 도달했는지(순수·verify 대상).
 * true 면 재계획을 금지하고 부분 답으로 요약 종료한다(상한 직전 추가 plan 호출 낭비 방지).
 */
export function nearBudget(c: LoopCounters, ratio: number = REPLAN_BUDGET_RATIO): boolean {
  return (
    c.turns >= MAX_TURNS * ratio ||
    c.toolCalls >= MAX_TOOL_CALLS * ratio ||
    c.tokens >= MAX_TOKENS * ratio ||
    c.elapsedMs >= MAX_WALL_MS * ratio
  )
}
