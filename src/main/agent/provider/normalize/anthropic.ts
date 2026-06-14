/**
 * src/main/agent/provider/normalize/anthropic.ts — Anthropic function-calling 정규화(ADR-015 G2).
 *
 * 공통 도구 호출 표현 ↔ Anthropic Messages API 포맷 양방향 변환. **순수 함수(IO·SDK import 0)**
 * 이므로 헤드리스 verify 의 핵심 대상이다(양방향 라운드트립·멀티콜·stop 매핑).
 *
 * Anthropic 특이점:
 *   - 도구 정의: `{ name, description, input_schema }` (input_schema = JSON Schema).
 *   - 모델→호출: content 블록 `{ type:'tool_use', id, name, input(객체) }` — input 은 이미 파싱된 객체.
 *   - 도구 결과: user 메시지 `{ type:'tool_result', tool_use_id, content, is_error }`.
 *   - stop: `stop_reason` 그대로('tool_use'/'end_turn'/'max_tokens').
 *   - arguments 파싱 깨짐 경로 없음(input 이 객체).
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

// ── Anthropic 송신 포맷(타입 — SDK 타입 의존 없이 형태만 정의) ──────────────

export interface AnthropicToolDef {
  readonly name: string
  readonly description: string
  readonly input_schema: Readonly<Record<string, unknown>>
}

export type AnthropicContentBlock =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'tool_use'; readonly id: string; readonly name: string; readonly input: Record<string, unknown> }
  | {
      readonly type: 'tool_result'
      readonly tool_use_id: string
      readonly content: string
      readonly is_error?: boolean
    }

export interface AnthropicMessage {
  readonly role: 'user' | 'assistant'
  readonly content: string | readonly AnthropicContentBlock[]
}

/** Anthropic 응답(messages.create 결과 — 정규화 입력으로 쓸 최소 형태). */
export interface AnthropicResponse {
  readonly content: readonly AnthropicContentBlock[]
  readonly stop_reason: string | null
  readonly usage?: { readonly input_tokens?: number; readonly output_tokens?: number }
}

// ── 송신: 공통 → Anthropic ──────────────────────────────────────────────

/** 공통 도구 정의 → Anthropic tools. */
export function toAnthropicTools(tools: readonly NormalizedToolDef[]): AnthropicToolDef[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema
  }))
}

/** 공통 메시지 1건 → Anthropic 메시지(들). system 은 별도 파라미터라 여기서 제외. */
export function toAnthropicMessages(messages: readonly NormalizedMessage[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = []
  for (const m of messages) {
    if (m.role === 'system') continue // system 은 top-level system 파라미터로 분리
    if (m.role === 'tool') {
      // tool 결과 → user 메시지의 tool_result 블록 배열.
      const blocks: AnthropicContentBlock[] = (m.toolResults ?? []).map((r) => ({
        type: 'tool_result',
        tool_use_id: r.callId,
        content: r.content,
        ...(r.isError ? { is_error: true } : {})
      }))
      out.push({ role: 'user', content: blocks })
      continue
    }
    if (m.role === 'assistant') {
      const blocks: AnthropicContentBlock[] = []
      if (m.content) blocks.push({ type: 'text', text: m.content })
      for (const c of m.toolCalls ?? []) {
        blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: { ...c.input } })
      }
      out.push({ role: 'assistant', content: blocks.length ? blocks : (m.content ?? '') })
      continue
    }
    // user
    out.push({ role: 'user', content: m.content ?? '' })
  }
  return out
}

/** system 메시지들을 합쳐 top-level system 문자열로(없으면 undefined). */
export function extractSystem(messages: readonly NormalizedMessage[]): string | undefined {
  const sys = messages.filter((m) => m.role === 'system' && m.content).map((m) => m.content!)
  return sys.length ? sys.join('\n\n') : undefined
}

// ── 수신: Anthropic → 공통 ──────────────────────────────────────────────

/** Anthropic stop_reason → 공통 StopReason. */
export function fromAnthropicStop(stop: string | null): StopReason {
  switch (stop) {
    case 'tool_use':
      return 'tool_use'
    case 'end_turn':
      return 'end_turn'
    case 'max_tokens':
      return 'max_tokens'
    case 'stop_sequence':
      return 'stop'
    default:
      return stop ? 'end_turn' : 'error'
  }
}

/** Anthropic 응답 → 정규화 LLMTurnResult. input 은 이미 객체라 파싱 오류 경로 없음. */
export function fromAnthropicResponse(resp: AnthropicResponse): LLMTurnResult {
  let text = ''
  let toolCalls: NormalizedToolCall[] = []
  for (const block of resp.content) {
    if (block.type === 'text') {
      text += block.text
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        name: block.name,
        input: block.input && typeof block.input === 'object' ? block.input : {}
      })
    }
  }
  let stopReason = fromAnthropicStop(resp.stop_reason)

  // §Z 추론 분리: 인라인 <think>…</think> 제거(소형/호환 모델이 Anthropic 호환으로 누출 시·무해).
  if (text.length > 0) text = splitReasoning(text).content

  // §Z 폴백: 구조화 tool_use 가 비어 있고 text 에 텍스트형 호출이 있으면 복원(소형/호환 모델 대비).
  if (toolCalls.length === 0 && text.length > 0) {
    const extracted = extractTextToolCalls(text)
    if (extracted.toolCalls.length > 0) {
      toolCalls = extracted.toolCalls
      text = extracted.cleanedText
      stopReason = 'tool_use'
    }
  }

  return {
    text,
    toolCalls,
    stopReason,
    ...(resp.usage
      ? {
          usage: {
            inputTokens: resp.usage.input_tokens ?? 0,
            outputTokens: resp.usage.output_tokens ?? 0
          }
        }
      : {})
  }
}

// ── 스트리밍: messages.stream 이벤트 조립 ──────────────────────────────────

/**
 * Anthropic 스트림 이벤트 1건(messages.stream 의 SSE 이벤트 — 정규화에 쓸 최소 형태).
 *
 * - `content_block_start`: tool_use 블록 시작(id·name·index).
 * - `content_block_delta`: `text_delta`(텍스트 토큰) 또는 `input_json_delta`(도구 인자 JSON 조각).
 * - `message_delta`: stop_reason·누적 usage.
 */
export interface AnthropicStreamEvent {
  readonly type: string
  readonly index?: number
  readonly content_block?: {
    readonly type: string
    readonly id?: string
    readonly name?: string
  }
  readonly delta?: {
    readonly type?: string
    readonly text?: string
    readonly partial_json?: string
    readonly stop_reason?: string | null
  }
  readonly usage?: { readonly input_tokens?: number; readonly output_tokens?: number }
  readonly message?: { readonly usage?: { readonly input_tokens?: number; readonly output_tokens?: number } }
}

/** index별 누적 중인 tool_use 블록(input JSON 은 partial_json 조각 누적). */
interface ToolUseAccum {
  id: string
  name: string
  json: string
}

/**
 * Anthropic 스트림 이벤트들을 누적해 LLMTurnResult 로 조립하는 누산기(순수).
 *
 * - text_delta 텍스트 조각은 onDelta 로 흘려보낸다(thinking 토큰).
 * - tool_use 블록은 content_block_start 로 id·name 을 잡고, input_json_delta 의 partial_json
 *   을 index 별로 이어붙인 뒤 종료 시 JSON.parse(깨지면 input={}·throw 0).
 */
export function createAnthropicStreamAssembler(onDelta: (text: string) => void): {
  push(ev: AnthropicStreamEvent): void
  result(): LLMTurnResult
} {
  let text = ''
  let stop: string | null = null
  const byIndex = new Map<number, ToolUseAccum>()
  let inTokens = 0
  let outTokens = 0
  let sawUsage = false

  return {
    push(ev: AnthropicStreamEvent): void {
      if (ev.message?.usage) {
        sawUsage = true
        inTokens = ev.message.usage.input_tokens ?? inTokens
        outTokens = ev.message.usage.output_tokens ?? outTokens
      }
      if (ev.usage) {
        sawUsage = true
        if (ev.usage.input_tokens !== undefined) inTokens = ev.usage.input_tokens
        if (ev.usage.output_tokens !== undefined) outTokens = ev.usage.output_tokens
      }
      if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use') {
        byIndex.set(ev.index ?? byIndex.size, {
          id: ev.content_block.id ?? '',
          name: ev.content_block.name ?? '',
          json: ''
        })
        return
      }
      if (ev.type === 'content_block_delta' && ev.delta) {
        if (ev.delta.type === 'text_delta' && typeof ev.delta.text === 'string') {
          text += ev.delta.text
          onDelta(ev.delta.text)
        } else if (ev.delta.type === 'input_json_delta' && typeof ev.delta.partial_json === 'string') {
          const acc = byIndex.get(ev.index ?? -1)
          if (acc) acc.json += ev.delta.partial_json
        }
        return
      }
      if (ev.type === 'message_delta' && ev.delta?.stop_reason) {
        stop = ev.delta.stop_reason
      }
    },
    result(): LLMTurnResult {
      const ordered = [...byIndex.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v)
      let toolCalls: NormalizedToolCall[] = ordered.map((acc) => {
        let input: Record<string, unknown> = {}
        const raw = acc.json.trim()
        if (raw !== '') {
          try {
            const parsed = JSON.parse(raw) as unknown
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              input = parsed as Record<string, unknown>
            }
          } catch {
            input = {} // Anthropic input 깨짐(드묾) — 빈 객체로 흡수(throw 0).
          }
        }
        return { id: acc.id, name: acc.name, input }
      })
      let stopReason: StopReason = stop
        ? fromAnthropicStop(stop)
        : toolCalls.length > 0
          ? 'tool_use'
          : 'end_turn'

      // §Z 추론 분리: 조립 텍스트의 인라인 <think>…</think> 제거(에코 clean·무해).
      let outText = text.length > 0 ? splitReasoning(text).content : text
      // §Z 폴백: 구조화 tool_use 가 비어 있고 조립 텍스트에 텍스트형 호출이 있으면 복원.
      if (toolCalls.length === 0 && outText.length > 0) {
        const extracted = extractTextToolCalls(outText)
        if (extracted.toolCalls.length > 0) {
          toolCalls = extracted.toolCalls
          outText = extracted.cleanedText
          stopReason = 'tool_use'
        }
      }

      return {
        text: outText,
        toolCalls,
        stopReason,
        ...(sawUsage ? { usage: { inputTokens: inTokens, outputTokens: outTokens } } : {})
      }
    }
  }
}
