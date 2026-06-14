/**
 * src/main/agent/provider/normalize/openai.ts — OpenAI(및 내부 OpenAI 호환) 정규화(ADR-015 G2).
 *
 * 공통 도구 호출 표현 ↔ OpenAI Chat Completions 포맷 양방향 변환. **순수 함수(IO·SDK import 0).**
 * 내부 OpenAI 호환 provider 도 이 어댑터를 공유한다.
 *
 * OpenAI 특이점:
 *   - 도구 정의: `{ type:'function', function:{ name, description, parameters } }`.
 *   - 모델→호출: `message.tool_calls[].{ id, function:{ name, arguments(JSON 문자열) } }`
 *     → arguments 는 **JSON 문자열**(모델이 깨진 JSON 을 낼 수 있음).
 *   - 도구 결과: role:'tool' 메시지 `{ tool_call_id, content }`(오류는 content 표기).
 *   - stop: `finish_reason:'tool_calls'→tool_use` / `'stop'→end_turn` / `'length'→max_tokens`.
 *
 * **arguments 견고성**: JSON.parse 실패 시 throw 0 — NormalizedToolCall.parseError 로 표시.
 * Orchestrator 가 이 호출을 도구 실행 대신 is_error tool_result 로 회신(루프 계속).
 */
import type {
  LLMTurnResult,
  NormalizedMessage,
  NormalizedToolCall,
  NormalizedToolDef,
  StopReason
} from '../LLMProvider'
import { extractTextToolCalls } from './textToolCalls'
import { splitReasoning } from './reasoning'

// ── OpenAI 송신 포맷(타입 — SDK 타입 의존 없이 형태만 정의) ──────────────

export interface OpenAIToolDef {
  readonly type: 'function'
  readonly function: {
    readonly name: string
    readonly description: string
    readonly parameters: Readonly<Record<string, unknown>>
  }
}

export interface OpenAIToolCallWire {
  readonly id: string
  readonly type?: 'function'
  readonly function: { readonly name: string; readonly arguments: string }
}

export interface OpenAIMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool'
  readonly content: string | null
  readonly tool_calls?: readonly OpenAIToolCallWire[]
  readonly tool_call_id?: string
}

/** OpenAI 응답(chat.completions 결과 — 정규화 입력으로 쓸 최소 형태). */
export interface OpenAIResponse {
  readonly choices: ReadonlyArray<{
    readonly message: {
      readonly content?: string | null
      readonly tool_calls?: readonly OpenAIToolCallWire[]
      /**
       * §Z 비표준 추론 필드(qwen3 등 추론 모델). 있으면 thinking 으로만 취급하고 content/tool
       * 처리에 포함하지 않는다(오염 방지·다음 턴 에코에서 제외).
       */
      readonly reasoning_content?: string | null
    }
    readonly finish_reason: string | null
  }>
  readonly usage?: { readonly prompt_tokens?: number; readonly completion_tokens?: number }
}

// ── 송신: 공통 → OpenAI ──────────────────────────────────────────────────

/** 공통 도구 정의 → OpenAI tools. */
export function toOpenAITools(tools: readonly NormalizedToolDef[]): OpenAIToolDef[] {
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.inputSchema }
  }))
}

/** 공통 메시지 → OpenAI 메시지(들). tool 결과는 결과별 role:'tool' 메시지로 펼친다. */
export function toOpenAIMessages(messages: readonly NormalizedMessage[]): OpenAIMessage[] {
  const out: OpenAIMessage[] = []
  for (const m of messages) {
    if (m.role === 'tool') {
      for (const r of m.toolResults ?? []) {
        out.push({ role: 'tool', tool_call_id: r.callId, content: r.content })
      }
      continue
    }
    if (m.role === 'assistant') {
      const wire: OpenAIToolCallWire[] = (m.toolCalls ?? []).map((c) => ({
        id: c.id,
        type: 'function',
        function: { name: c.name, arguments: JSON.stringify(c.input ?? {}) }
      }))
      out.push({
        role: 'assistant',
        content: m.content ?? null,
        ...(wire.length ? { tool_calls: wire } : {})
      })
      continue
    }
    // system | user
    out.push({ role: m.role, content: m.content ?? '' })
  }
  return out
}

// ── 수신: OpenAI → 공통 ──────────────────────────────────────────────────

/** OpenAI finish_reason → 공통 StopReason. */
export function fromOpenAIFinish(reason: string | null): StopReason {
  switch (reason) {
    case 'tool_calls':
    case 'function_call':
      return 'tool_use'
    case 'stop':
      return 'end_turn'
    case 'length':
      return 'max_tokens'
    default:
      return reason ? 'end_turn' : 'error'
  }
}

/**
 * OpenAI tool_call(arguments=JSON 문자열) → NormalizedToolCall.
 * JSON.parse 실패 시 throw 0 — parseError 표시(input={}). Orchestrator 가 is_error 회신.
 */
export function parseOpenAIToolCall(call: OpenAIToolCallWire): NormalizedToolCall {
  const raw = call.function.arguments ?? ''
  if (raw.trim() === '') {
    return { id: call.id, name: call.function.name, input: {} }
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { id: call.id, name: call.function.name, input: parsed as Record<string, unknown> }
    }
    return {
      id: call.id,
      name: call.function.name,
      input: {},
      parseError: 'arguments 가 JSON 객체가 아닙니다.'
    }
  } catch (e) {
    return {
      id: call.id,
      name: call.function.name,
      input: {},
      parseError: `arguments JSON 파싱 실패: ${e instanceof Error ? e.message : String(e)}`
    }
  }
}

/**
 * §Z 텍스트형 tool_call 폴백 공통 헬퍼. content 에 텍스트형 호출이 있으면 복원·정리,
 * 없으면 null(호출 측은 기존 동작 유지 — 회귀 0). 호출 측에서 "구조화 호출이 비어 있을 때"
 * 만 부른다(우선순위 보장).
 */
function applyTextToolCallFallback(
  text: string
): { toolCalls: NormalizedToolCall[]; cleanedText: string } | null {
  const extracted = extractTextToolCalls(text)
  return extracted.toolCalls.length > 0 ? extracted : null
}

/** OpenAI 응답 → 정규화 LLMTurnResult(멀티콜·깨진 arguments 흡수). */
export function fromOpenAIResponse(resp: OpenAIResponse): LLMTurnResult {
  const choice = resp.choices[0]
  // §Z 추론 분리: reasoning_content(비표준)는 thinking 으로만 — content/tool 처리에서 제외.
  // 인라인 <think>…</think> 는 content 에서 추출·제거(에코 clean·다음 턴 서버 파싱 위험 감소).
  const rawContent = choice?.message.content ?? ''
  let text = typeof rawContent === 'string' && rawContent.length > 0 ? splitReasoning(rawContent).content : rawContent
  let toolCalls: NormalizedToolCall[] = (choice?.message.tool_calls ?? []).map(parseOpenAIToolCall)
  let stopReason = fromOpenAIFinish(choice?.finish_reason ?? null)

  // §Z 폴백: 구조화 tool_calls 가 비어 있고 content 에 텍스트형 호출이 있으면 복원.
  // 구조화 호출이 이미 있으면 그걸 우선(폴백 미적용·정상 경로).
  if (toolCalls.length === 0 && typeof text === 'string' && text.length > 0) {
    const extracted = applyTextToolCallFallback(text)
    if (extracted) {
      toolCalls = extracted.toolCalls
      text = extracted.cleanedText
      stopReason = 'tool_use'
    }
  }

  return {
    text: text ?? '',
    toolCalls,
    stopReason,
    ...(resp.usage
      ? {
          usage: {
            inputTokens: resp.usage.prompt_tokens ?? 0,
            outputTokens: resp.usage.completion_tokens ?? 0
          }
        }
      : {})
  }
}

// ── 스트리밍: chat.completions delta 조립(UQ-G3) ──────────────────────────

/**
 * OpenAI 스트림 1청크 형태(chat.completions create({stream:true}) 의 SSE 조각).
 * `choices[].delta` 에 텍스트 또는 tool_calls 조각이 index 로 쪼개져 도착한다.
 */
export interface OpenAIStreamChunk {
  readonly choices?: ReadonlyArray<{
    readonly delta?: {
      readonly content?: string | null
      /** §Z 비표준 추론 델타(qwen3 등). thinking 으로만 흘리고 content 누적엔 제외. */
      readonly reasoning_content?: string | null
      readonly tool_calls?: ReadonlyArray<{
        readonly index: number
        readonly id?: string
        readonly type?: 'function'
        readonly function?: { readonly name?: string; readonly arguments?: string }
      }>
    }
    readonly finish_reason?: string | null
  }>
  readonly usage?: { readonly prompt_tokens?: number; readonly completion_tokens?: number } | null
}

/** index별 누적 중인 tool_call 조각(id·name 은 첫 조각에, arguments 는 누적). */
interface ToolCallAccum {
  id: string
  name: string
  args: string
}

/**
 * OpenAI 스트림 청크들을 누적해 NormalizedToolCall[] 로 조립하는 누산기(순수·UQ-G3).
 *
 * - `delta.content` 텍스트 조각은 onDelta 로 흘려보낸다(thinking 토큰).
 * - `delta.tool_calls[].function.arguments` 조각은 **index 별로 이어붙인다**(쪼개진 JSON).
 * - finish_reason·usage 는 마지막에 result() 로 정규화한다.
 *
 * 누적된 arguments 가 깨진 JSON 이면 parseOpenAIToolCall 이 parseError 로 표시(throw 0).
 */
export function createOpenAIStreamAssembler(onDelta: (text: string) => void): {
  push(chunk: OpenAIStreamChunk): void
  result(): LLMTurnResult
} {
  let text = ''
  let finish: string | null = null
  const byIndex = new Map<number, ToolCallAccum>()
  let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined

  return {
    push(chunk: OpenAIStreamChunk): void {
      if (chunk.usage) usage = chunk.usage
      const choice = chunk.choices?.[0]
      if (!choice) return
      if (choice.finish_reason) finish = choice.finish_reason
      const delta = choice.delta
      if (!delta) return
      // §Z reasoning_content 델타 → thinking 으로만 흘려보낸다(text 누적·tool 처리 제외).
      if (typeof delta.reasoning_content === 'string' && delta.reasoning_content.length > 0) {
        onDelta(delta.reasoning_content)
      }
      if (typeof delta.content === 'string' && delta.content.length > 0) {
        text += delta.content
        onDelta(delta.content)
      }
      for (const tc of delta.tool_calls ?? []) {
        const cur = byIndex.get(tc.index) ?? { id: '', name: '', args: '' }
        if (tc.id) cur.id = tc.id
        if (tc.function?.name) cur.name = tc.function.name
        if (typeof tc.function?.arguments === 'string') cur.args += tc.function.arguments
        byIndex.set(tc.index, cur)
      }
    },
    result(): LLMTurnResult {
      const ordered = [...byIndex.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v)
      let toolCalls: NormalizedToolCall[] = ordered.map((acc, i) =>
        parseOpenAIToolCall({
          id: acc.id || `call_${i}`,
          function: { name: acc.name, arguments: acc.args }
        })
      )
      // finish_reason 이 없으면(스트림 끊김) tool_calls 유무로 추론.
      let stop: StopReason = finish
        ? fromOpenAIFinish(finish)
        : toolCalls.length > 0
          ? 'tool_use'
          : 'end_turn'

      // §Z 추론 분리: 조립된 content 안의 인라인 <think>…</think> 제거(에코 clean).
      // reasoning_content 델타는 누적하지 않았으므로 여기엔 content 인라인 think 만 대상.
      let outText = text.length > 0 ? splitReasoning(text).content : text
      // §Z 폴백: 구조화 tool_calls 가 비어 있고 조립 텍스트에 텍스트형 호출이 있으면 복원.
      if (toolCalls.length === 0 && outText.length > 0) {
        const extracted = applyTextToolCallFallback(outText)
        if (extracted) {
          toolCalls = extracted.toolCalls
          outText = extracted.cleanedText
          stop = 'tool_use'
        }
      }

      return {
        text: outText,
        toolCalls,
        stopReason: stop,
        ...(usage
          ? {
              usage: {
                inputTokens: usage.prompt_tokens ?? 0,
                outputTokens: usage.completion_tokens ?? 0
              }
            }
          : {})
      }
    }
  }
}
