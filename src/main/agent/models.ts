/**
 * src/main/agent/models.ts — 제공자별 티어→모델 ID 매핑 상수 단일 출처(ADR-015 G7).
 *
 * modelRouter 는 **추상 티어(plan/light)** 만 결정하고, provider 가 이 표로 실모델 ID 를 해석한다.
 * SDK·모델 ID 변경은 여기 한 곳에서 흡수(provider 구현체에 산재 0).
 * 순수 상수·매핑 함수(IO·SDK import 0) → 헤드리스 verify 직접 import 가능.
 */
import type { ModelInfo, ProviderConfig } from '@shared/ipc/contracts'
import type { ModelTier } from './provider/LLMProvider'

/** Anthropic 티어→모델(ADR-015 G7 표). */
export const ANTHROPIC_MODELS: Readonly<Record<ModelTier, string>> = {
  plan: 'claude-opus-4-8',
  light: 'claude-sonnet-4-6'
}

/** OpenAI 티어→모델 기본값(설정으로 덮어쓰기 가능). */
export const OPENAI_MODELS: Readonly<Record<ModelTier, string>> = {
  plan: 'gpt-4.1',
  light: 'gpt-4.1-mini'
}

/** 제공자별 목록(설정 UI 표시). 내부는 사용자 입력 ID 라 여기 미수록. */
export const PROVIDER_MODEL_CATALOG: Readonly<Record<'anthropic' | 'openai', readonly ModelInfo[]>> = {
  anthropic: [
    { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', tier: 'plan' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', tier: 'light' }
  ],
  openai: [
    { id: 'gpt-4.1', label: 'GPT-4.1', tier: 'plan' },
    { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini', tier: 'light' }
  ]
}

/**
 * ProviderConfig + 티어 → 실모델 ID 해석.
 * - anthropic/openai: 설정 planModel/lightModel 우선, 없으면 상수 기본.
 * - internal: 단일 modelId(티어 무관 — plan·light 동일 모델, 비용 절감만 없음).
 */
export function resolveModelId(config: ProviderConfig, tier: ModelTier): string {
  switch (config.id) {
    case 'anthropic':
      return (tier === 'plan' ? config.planModel : config.lightModel) ?? ANTHROPIC_MODELS[tier]
    case 'openai':
      return (tier === 'plan' ? config.planModel : config.lightModel) ?? OPENAI_MODELS[tier]
    case 'internal':
      return config.modelId ?? ''
  }
}
