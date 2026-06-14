/**
 * src/main/agent/planner.ts — Plan-Execute 의 Planner 단계(ADR-016 결정 A·design §14.1~§14.3).
 *
 * LLM 이 사용자 지시 + ToolCatalog.describe()(쓸 수 있는 도구·스키마)를 컨텍스트로 받아
 * **ReasoningPlan**(순서 있는 추론 스텝 목록)을 산출한다. 산출은 **전용 `plan` 도구(JSON Schema
 * 강제)** 로 한다(자유텍스트 파싱보다 견고·ADR-015 정규화 어댑터 재사용·UQ-H3).
 *
 * ⚠️ **용어 분리(혼동 방지)**: 여기의 `ReasoningPlan`/`ReasoningStep`은 **추론 계획**이다.
 * §5.3의 쓰기 `PlannedOp`(파일쓰기 변경안·diff 게이트)와 **완전 별개**. 읽기 전용 Q&A 에는
 * PlannedOp 가 없다.
 *
 * **plan 산출물 = 신뢰 못 하는 데이터**: step.suggestedTools 는 힌트일 뿐. Executor 의
 * catalog.invoke 는 항상 화이트리스트·guardPath·scope 재검증을 통과한다(인젝션이 plan 을
 * 오염시켜도 읽기/navigate·scope 만 가능 → 상한이 흡수). ADR-014 결정⑦ 그대로.
 *
 * provider 호출만 격리(제공자 무지·createCompletion 1개). 순수 유틸(shouldPlan·plan 정규화)은
 * IO 0 → 헤드리스 verify 대상.
 */
import type { LLMProvider, NormalizedMessage, NormalizedToolDef } from './provider/LLMProvider'
import type { ToolCatalog, ToolDescriptor } from './ToolCatalog'
import { route } from './modelRouter'
import { DEFAULT_MAX_OUTPUT_TOKENS, MAX_PLAN_STEPS } from './limits'
import { buildGroundingBlock, GROUNDING_HARD_RULES } from './grounding'
import type { AgentLocations } from '@shared/ipc/contracts'

/** 추론 스텝 1개(§14.3 — PlannedOp 와 별개). */
export interface ReasoningStep {
  /** 'step-1' … (산출 순서). */
  readonly id: string
  /** 이 스텝이 달성할 하위 목표(사용자 표시). */
  readonly goal: string
  /** 왜 이 스텝인지(thinking 보조·내부). */
  readonly rationale?: string
  /** 힌트(비강제·invoke 는 항상 카탈로그 화이트리스트 통과). */
  readonly suggestedTools?: readonly string[]
}

/** 추론 계획(스텝 목록 + 재계획 횟수). */
export interface ReasoningPlan {
  /** MAX_PLAN_STEPS 상한. */
  readonly steps: readonly ReasoningStep[]
  /** 재계획 횟수(루프 가드·이벤트 노출). */
  readonly replanCount: number
}

/** 전용 `plan` 도구 정의(JSON Schema 로 plan 형태 강제). */
export const PLAN_TOOL: NormalizedToolDef = {
  name: 'plan',
  description:
    '사용자 지시를 달성하기 위한 추론 계획을 순서 있는 스텝 목록으로 제출한다. 각 스텝은 하위 목표(goal)와 ' +
    '근거(rationale), 사용할 도구 힌트(suggestedTools)를 갖는다. 도구를 실행하지 말고 계획만 세워라.',
  inputSchema: {
    type: 'object',
    properties: {
      steps: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            goal: { type: 'string' },
            rationale: { type: 'string' },
            suggestedTools: { type: 'array', items: { type: 'string' } }
          },
          required: ['goal'],
          additionalProperties: false
        }
      }
    },
    required: ['steps'],
    additionalProperties: false
  }
}

/**
 * 단순/다단계 질의 판정(순수·LLM 호출 0). true = plan 수립(다단계), false = plan 우회(단일 ReAct).
 *
 * **보수적 false-negative 안전**: 불확실하면 false(plan 우회). plan 미수립도 ReAct 로 답이 나오므로
 * 품질만 하락할 뿐 동작은 보존된다(ADR-016 리스크 ①). 다단계 신호(접속/순차 표현·복수 동사·
 * 긴 프롬프트)가 명확할 때만 true.
 */
export function shouldPlan(prompt: string): boolean {
  const p = (prompt ?? '').trim()
  if (p.length === 0) return false

  // ① 접속/순차/비교/분류 표현 — 다단계의 강한 신호.
  const SEQUENCE_HINTS: readonly RegExp[] = [
    /그\s*다음/,
    /그\s*후/,
    /그리고/,
    /그런\s*다음/,
    /\bthen\b/i,
    /\bafter that\b/i,
    /비교/,
    /분류/,
    /정리한\s*뒤/,
    /찾(아|은)\s*(뒤|후|다음)/,
    /->|→/,
    /,\s*그/
  ]
  if (SEQUENCE_HINTS.some((re) => re.test(p))) return true

  // ② "찾아서 …(열어|이동|복사 등)" — 탐색→행동 다단계 의도.
  //    예: "…프로젝트를 찾아 해당 폴더를 열어줘"(골든 시나리오).
  const FIND_THEN_ACT = /(찾|검색|식별|탐색)[가-힣\sA-Za-z]*?(열|이동|보여|정리|비교|분류|찾)/
  if (FIND_THEN_ACT.test(p)) return true

  // ③ 충분히 긴 지시(여러 절·복합 목표일 가능성) + 동사 다수.
  const verbCount = (p.match(/(해줘|하라|해라|보여줘|찾아|열어|이동|복사|정리|비교|분류|분석)/g) ?? []).length
  if (p.length >= 40 && verbCount >= 2) return true

  // 그 외(짧고 단일 의도)는 plan 우회 → 단일 ReAct(현 동작 동치).
  return false
}

/** describe() 결과를 Planner 시스템 프롬프트용 도구 카탈로그 텍스트로 직렬화(이름·mode·설명). */
export function describeToolsForPlanner(tools: readonly ToolDescriptor[]): string {
  return tools.map((t) => `- ${t.name} (${t.mode}): ${t.description}`).join('\n')
}

/** Planner 시스템 프롬프트(골든 다단계 탐색 전략 안내·읽기 전용 명시·§Z 경로 그라운딩). */
export function buildPlannerSystemPrompt(
  toolCatalogText: string,
  observations?: string,
  grounding?: { locations?: AgentLocations; cwd?: string }
): string {
  return (
    '당신은 로컬 파일 탐색기의 읽기 전용 어시스턴트의 **계획 수립기**입니다. ' +
    '사용자 지시를 달성하기 위한 추론 계획을 plan 도구로 제출하세요(도구를 실행하지 말고 계획만). ' +
    '\n\n쓸 수 있는 실행 도구(Executor 가 스텝마다 사용):\n' +
    toolCatalogText +
    // §Z 실제 경로 그라운딩 + 창작 금지 하드 규칙(환각 placeholder 경로 완화) — Executor 와 동일.
    '\n\n' + buildGroundingBlock(grounding?.locations, grounding?.cwd) +
    '\n\n' + GROUNDING_HARD_RULES +
    '\n\n다단계 탐색 전략 안내(읽기 전용·파일 미변경):\n' +
    '1) 사용자가 "E: 드라이브", "다운로드 폴더", "즐겨찾기 X" 처럼 이름/드라이브로 위치를 가리키면 ' +
    '먼저 list_locations 로 실제 경로(드라이브·이름있는 위치)를 해석하는 스텝을 둔다.\n' +
    '2) 해당 위치 하위를 list_directory(또는 폴더가 모호하면 search_content)로 재귀 탐색해 후보를 모은다.\n' +
    '3) 폴더명만으론 의미가 모호하면 read_preview 로 README·package.json·index.html 등 내용을 확인해 ' +
    '"브라우저 기반 ERD 설계 도구" 같은 의미를 식별한다.\n' +
    '4) 대상을 확정하면 open_tab 으로 그 폴더를 새 탭에서 연다(비파괴 내비게이션).\n' +
    `\n계획은 최대 ${MAX_PLAN_STEPS} 스텝으로 간결하게. 과탐색을 피하고 목표에 직결되는 스텝만 두세요. ` +
    '모든 경로 접근은 읽기 전용이며 스코프 안에서만 허용됩니다.' +
    (observations ? `\n\n지금까지의 관찰(재계획 컨텍스트):\n${observations}` : '')
  )
}

/** plan 도구 arguments → ReasoningPlan(MAX_PLAN_STEPS 절단·throw 0·빈 steps 면 빈 plan). */
export function normalizePlan(input: Record<string, unknown>, replanCount: number): ReasoningPlan {
  const rawSteps = Array.isArray(input['steps']) ? (input['steps'] as unknown[]) : []
  const steps: ReasoningStep[] = []
  for (let i = 0; i < rawSteps.length && steps.length < MAX_PLAN_STEPS; i++) {
    const s = rawSteps[i]
    if (!s || typeof s !== 'object') continue
    const obj = s as Record<string, unknown>
    const goal = typeof obj['goal'] === 'string' ? obj['goal'].trim() : ''
    if (!goal) continue
    const rationale = typeof obj['rationale'] === 'string' ? obj['rationale'] : undefined
    const suggested = Array.isArray(obj['suggestedTools'])
      ? (obj['suggestedTools'] as unknown[]).filter((x): x is string => typeof x === 'string')
      : undefined
    steps.push({
      id: `step-${steps.length + 1}`,
      goal,
      ...(rationale ? { rationale } : {}),
      ...(suggested && suggested.length > 0 ? { suggestedTools: suggested } : {})
    })
  }
  return { steps, replanCount }
}

/** plan 의 안정 해시(재계획 발산 감지용·순수). 스텝 goal 목록 기반. */
export function planHash(plan: ReasoningPlan): string {
  return plan.steps.map((s) => s.goal).join('||')
}

export interface BuildPlanOptions {
  readonly prompt: string
  readonly replanCount: number
  /** 재계획 시 지금까지의 관찰 요약(현 관찰로 남은 스텝 재구성). */
  readonly observations?: string
  /** §Z 이름 있는 위치(그라운딩 블록 선주입·환각 경로 완화). */
  readonly locations?: AgentLocations
  /** §Z 현재 폴더(그라운딩 "현재 폴더" 줄). */
  readonly cwd?: string
  readonly signal?: AbortSignal
}

/**
 * provider+catalog 로 ReasoningPlan 산출(plan 티어·`plan` 도구 JSON Schema 강제).
 * 깨진 arguments·plan 도구 미호출·throw 는 **빈 plan(steps=[])** 으로 폴백(호출자가 plan 우회 판단).
 */
export async function buildReasoningPlan(
  provider: LLMProvider,
  catalog: ToolCatalog,
  opts: BuildPlanOptions
): Promise<ReasoningPlan> {
  const toolText = describeToolsForPlanner(catalog.describe())
  const messages: NormalizedMessage[] = [
    {
      role: 'system',
      content: buildPlannerSystemPrompt(toolText, opts.observations, {
        ...(opts.locations ? { locations: opts.locations } : {}),
        ...(opts.cwd ? { cwd: opts.cwd } : {})
      })
    },
    { role: 'user', content: opts.prompt }
  ]
  try {
    const resp = await provider.createCompletion(
      {
        messages,
        tools: [PLAN_TOOL],
        tier: route({ turn: 0, intent: 'plan' }),
        maxTokens: DEFAULT_MAX_OUTPUT_TOKENS,
        ...(opts.signal ? { signal: opts.signal } : {})
      },
      () => {
        /* planner thinking 은 스텝 이벤트와 분리 — 노출 안 함(plan 이벤트로 대체). */
      }
    )
    const planCall = resp.toolCalls.find((c) => c.name === 'plan' && !c.parseError)
    if (!planCall) return { steps: [], replanCount: opts.replanCount }
    return normalizePlan(planCall.input as Record<string, unknown>, opts.replanCount)
  } catch {
    // throw 0 — 빈 plan 폴백(호출자가 단일 ReAct 로 진행).
    return { steps: [], replanCount: opts.replanCount }
  }
}
