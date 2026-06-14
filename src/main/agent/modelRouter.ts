/**
 * src/main/agent/modelRouter.ts — 추상 티어 라우팅(ADR-014 ⑤·ADR-015 G7).
 *
 * **제공자 무지**: `route(turn, intent) → Tier` 만 반환한다. Tier→실모델 ID 해석은 각
 * provider 가 models.ts 로 수행한다. 순수 함수(IO·SDK import 0) → 헤드리스 verify 대상.
 *
 * 라우팅 규칙(초안·튜닝 가능):
 *   - 첫 턴(계획 수립)·명시적 plan 의도 → 'plan'(고성능·다단계 추론).
 *   - 후속 도구 결과 요약·분류·이름 후보 → 'light'(요약·저비용).
 *   - 사용자 비용 모드('always-light') → 항상 'light'.
 */
import type { ModelTier } from './provider/LLMProvider'

export type RouteIntent = 'plan' | 'summarize' | 'name-suggest'
export type CostMode = 'auto' | 'always-light'

export interface RouteCtx {
  /** 0부터 시작하는 루프 턴 인덱스. */
  readonly turn: number
  readonly intent?: RouteIntent
  readonly costMode?: CostMode
}

/** 턴/의도/비용모드 → 추상 티어(제공자 무지). */
export function route(ctx: RouteCtx): ModelTier {
  if (ctx.costMode === 'always-light') return 'light'
  if (ctx.intent === 'summarize' || ctx.intent === 'name-suggest') return 'light'
  // 첫 턴 또는 명시 plan 의도는 고성능 티어.
  if (ctx.turn === 0 || ctx.intent === 'plan') return 'plan'
  // 이후 턴은 기본 light(비용 절감) — 단, plan 의도 명시 시 위에서 plan.
  return 'light'
}
