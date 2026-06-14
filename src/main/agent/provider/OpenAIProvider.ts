/**
 * src/main/agent/provider/OpenAIProvider.ts — OpenAI 제공자(openai SDK·고정 api.openai.com·ADR-015).
 *
 * SDK 클라이언트는 **주입**(factory)된다(verify 스텁). 고정 공식 호스트라 base URL 입력 불가
 * (SSRF 무관). normalize/openai 어댑터로 공통 도구 정의→function.parameters·tool_calls→공통
 * 파싱(깨진 arguments→is_error)·finish_reason→stop 매핑.
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
  createOpenAIStreamAssembler,
  fromOpenAIResponse,
  toOpenAIMessages,
  toOpenAITools,
  type OpenAIResponse,
  type OpenAIStreamChunk
} from './normalize/openai'
import { resolveModelId } from '../models'

type OpenAICreateParams = {
  model: string
  max_tokens?: number
  messages: unknown[]
  tools?: unknown[]
  stream?: boolean
  stream_options?: { include_usage?: boolean }
}
type OpenAICreateOptions = { signal?: AbortSignal }

/**
 * OpenAI SDK 의 chat.completions 최소 표면(주입 가능·verify 스텁).
 * - `create`: 비스트리밍(폴백·기존).
 * - `createStream`(선택): stream:true 호출 → AsyncIterable<청크>. 미제공/throw 시 create 폴백.
 *   실 SDK 는 create({stream:true}) 가 async iterable 을 반환하나, 타입 단순화를 위해 별 메서드로
 *   분리(런타임 팩토리가 어댑트). 깨진 tool_calls arguments 는 조립 후 parseError(throw 0).
 */
export interface OpenAIClientLike {
  chat: {
    completions: {
      create(params: OpenAICreateParams, options?: OpenAICreateOptions): Promise<OpenAIResponse>
      createStream?(
        params: OpenAICreateParams,
        options?: OpenAICreateOptions
      ): AsyncIterable<OpenAIStreamChunk>
    }
  }
}

const CAPS: ProviderCapabilities = { toolUse: true, streaming: true }

export function createOpenAIProvider(
  config: ProviderConfig,
  client: OpenAIClientLike
): LLMProvider {
  return {
    id: 'openai',
    capabilities: CAPS,
    async createCompletion(
      req: NormalizedCompletionReq,
      onDelta: (d: ThinkingDelta) => void
    ): Promise<LLMTurnResult> {
      const model = resolveModelId(config, req.tier)
      const params: OpenAICreateParams = {
        model,
        max_tokens: req.maxTokens,
        messages: toOpenAIMessages(req.messages),
        tools: toOpenAITools(req.tools)
      }
      const options: OpenAICreateOptions | undefined = req.signal ? { signal: req.signal } : undefined

      if (typeof client.chat.completions.createStream === 'function') {
        try {
          const assembler = createOpenAIStreamAssembler((t) => onDelta({ text: t }))
          const iter = client.chat.completions.createStream(
            { ...params, stream: true, stream_options: { include_usage: true } },
            options
          )
          for await (const chunk of iter) assembler.push(chunk)
          return assembler.result()
        } catch (e) {
          if (req.signal?.aborted) throw e
          // 비스트리밍 폴백.
        }
      }
      const resp = await client.chat.completions.create(params, options)
      return fromOpenAIResponse(resp)
    }
  }
}
