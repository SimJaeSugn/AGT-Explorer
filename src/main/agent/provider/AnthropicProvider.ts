/**
 * src/main/agent/provider/AnthropicProvider.ts — Anthropic 제공자(@anthropic-ai/sdk·ADR-015).
 *
 * SDK 클라이언트는 **주입**(factory)된다 — 헤드리스 verify 가 스텁 클라이언트를 주입해 실 API
 * 없이 정규화·루프를 검증한다. 실 런타임은 createAnthropicProvider 가 키를 복호해 클라이언트를
 * 생성한다(키는 이 시점에만 메모리·DTO/config 미수록).
 *
 * normalize/anthropic 어댑터로 공통 도구 정의→input_schema·tool_use→공통 파싱·stop 매핑.
 */
import type { ProviderConfig } from '@shared/ipc/contracts'
import type {
  LLMProvider,
  LLMTurnResult,
  NormalizedCompletionReq,
  ProviderCapabilities,
  ThinkingDelta
} from './LLMProvider'
import {
  createAnthropicStreamAssembler,
  extractSystem,
  fromAnthropicResponse,
  toAnthropicMessages,
  toAnthropicTools,
  type AnthropicResponse,
  type AnthropicStreamEvent
} from './normalize/anthropic'
import { resolveModelId } from '../models'

type CreateParams = {
  model: string
  max_tokens: number
  system?: string
  messages: unknown[]
  tools?: unknown[]
  stream?: boolean
}
type CreateOptions = { signal?: AbortSignal }

/**
 * Anthropic SDK 의 messages 최소 표면(주입 가능·verify 스텁).
 * - `create`: 비스트리밍(폴백·기존).
 * - `stream`(선택): `messages.stream(...)` → AsyncIterable<이벤트>. 미제공/throw 시 create 폴백.
 */
export interface AnthropicClientLike {
  messages: {
    create(params: CreateParams, options?: CreateOptions): Promise<AnthropicResponse>
    stream?(params: CreateParams, options?: CreateOptions): AsyncIterable<AnthropicStreamEvent>
  }
}

const CAPS: ProviderCapabilities = { toolUse: true, streaming: true }

export function createAnthropicProvider(
  config: ProviderConfig,
  client: AnthropicClientLike
): LLMProvider {
  return {
    id: 'anthropic',
    capabilities: CAPS,
    async createCompletion(
      req: NormalizedCompletionReq,
      onDelta: (d: ThinkingDelta) => void
    ): Promise<LLMTurnResult> {
      const model = resolveModelId(config, req.tier)
      const system = extractSystem(req.messages)
      const params: CreateParams = {
        model,
        max_tokens: req.maxTokens,
        ...(system ? { system } : {}),
        messages: toAnthropicMessages(req.messages),
        tools: toAnthropicTools(req.tools)
      }
      const options: CreateOptions | undefined = req.signal ? { signal: req.signal } : undefined

      // 스트리밍 시도(주입 클라이언트가 stream 제공 시). 실패/미지원 → 비스트리밍 폴백.
      if (typeof client.messages.stream === 'function') {
        try {
          const assembler = createAnthropicStreamAssembler((t) => onDelta({ text: t }))
          const iter = client.messages.stream({ ...params, stream: true }, options)
          for await (const ev of iter) assembler.push(ev)
          return assembler.result()
        } catch (e) {
          // 취소는 폴백하지 않고 전파(루프가 aborted 처리).
          if (req.signal?.aborted) throw e
          // 그 외 스트림 실패는 비스트리밍으로 폴백.
        }
      }
      const resp = await client.messages.create(params, options)
      return fromAnthropicResponse(resp)
    }
  }
}
