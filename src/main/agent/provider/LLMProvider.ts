/**
 * src/main/agent/provider/LLMProvider.ts — 멀티 LLM 제공자 추상화(ADR-015 G1).
 *
 * AgentOrchestrator 는 이 인터페이스 하나에만 의존한다(제공자 무지). 제공자별 SDK·
 * 엔드포인트·function-calling 포맷 차이는 구현체(AnthropicProvider·OpenAIProvider·
 * InternalOpenAICompatProvider) + 정규화 어댑터(normalize/{anthropic,openai}.ts) 뒤로 숨긴다.
 *
 * 이 파일은 **타입·인터페이스만**(IO·SDK import 0) — 순수 타입 모듈이라 헤드리스 verify·
 * 어댑터·toolRegistry 가 자유롭게 import 한다. 키 필드는 어떤 타입에도 없다(평문 0·G5).
 */
import type { ProviderId } from '@shared/ipc/contracts'

/** 추상 모델 티어(ADR-015 G7). provider 가 티어→실모델 ID 로 해석. */
export type ModelTier = 'plan' | 'light'

/** 공통 도구 정의(JSON Schema 1벌 — toolRegistry 단일 출처). */
export interface NormalizedToolDef {
  readonly name: string
  readonly description: string
  /** JSON Schema(object). Anthropic input_schema / OpenAI function.parameters 로 직렬화. */
  readonly inputSchema: Readonly<Record<string, unknown>>
}

/** 공통 메시지 역할. */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool'

/** 모델→도구 호출(공통 표현 — G2). */
export interface NormalizedToolCall {
  readonly id: string // 제공자별 호출 ID(tool_result 상관용)
  readonly name: string
  readonly input: Readonly<Record<string, unknown>>
  /**
   * arguments JSON 파싱이 실패한 호출(OpenAI 계열). 어댑터가 표시 →
   * Orchestrator 는 도구 실행 대신 is_error tool_result 로 회신(throw 0·루프 계속).
   */
  readonly parseError?: string
}

/** 도구 결과 회신(공통 — 어댑터가 제공자 포맷으로 직렬화). */
export interface NormalizedToolResult {
  readonly callId: string
  readonly content: string
  readonly isError?: boolean
}

/** 공통 메시지(어댑터가 제공자 포맷으로 직렬화). */
export interface NormalizedMessage {
  readonly role: MessageRole
  /** 텍스트 본문(assistant 의 도구 호출 턴은 toolCalls 동반 가능). */
  readonly content?: string
  /** assistant 턴이 낸 도구 호출(있으면 tool_use/tool_calls 로 직렬화). */
  readonly toolCalls?: readonly NormalizedToolCall[]
  /** tool 역할 메시지의 도구 결과들(있으면 tool_result/role:tool 로 직렬화). */
  readonly toolResults?: readonly NormalizedToolResult[]
}

/** 공통 completion 요청. */
export interface NormalizedCompletionReq {
  readonly messages: readonly NormalizedMessage[]
  readonly tools: readonly NormalizedToolDef[]
  readonly tier: ModelTier
  readonly maxTokens: number
  /** AbortSignal — agent:cancel 시 in-flight 중단. */
  readonly signal?: AbortSignal
}

/** stop 이유(공통). 제공자별 stop_reason/finish_reason 을 정규화. */
export type StopReason = 'tool_use' | 'end_turn' | 'max_tokens' | 'stop' | 'error'

/** 정규화된 1턴 응답. */
export interface LLMTurnResult {
  readonly text: string
  readonly toolCalls: readonly NormalizedToolCall[]
  readonly stopReason: StopReason
  readonly usage?: { readonly inputTokens: number; readonly outputTokens: number }
}

/** 스트리밍 thinking/text 델타(→ agent:event(thinking)). */
export interface ThinkingDelta {
  readonly text: string
}

/** 제공자 능력(degradation 판정의 1차 근거 — G3). */
export interface ProviderCapabilities {
  readonly toolUse: boolean
  readonly streaming: boolean
}

/**
 * LLM 제공자 인터페이스. Orchestrator 는 createCompletion 1개만 본다(G1).
 */
export interface LLMProvider {
  readonly id: ProviderId
  readonly capabilities: ProviderCapabilities
  createCompletion(
    req: NormalizedCompletionReq,
    onDelta: (d: ThinkingDelta) => void
  ): Promise<LLMTurnResult>
}
