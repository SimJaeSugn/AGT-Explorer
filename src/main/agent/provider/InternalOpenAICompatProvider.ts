/**
 * src/main/agent/provider/InternalOpenAICompatProvider.ts — 내부 OpenAI 호환 제공자(ADR-015 G4).
 *
 * openai SDK 의 baseURL 재사용 + **ssrfGuard 통과 fetch 주입**. 사용자 등록 내부 호스트로만
 * 나가며, **매 요청 직전 assertRequestAllowed(1~6단계·DNS 리바인딩)** 를 통과해야 송신한다.
 * capability(toolUse)는 설정 플래그(degradation·G3) — 미지원이면 capabilities.toolUse=false →
 * Orchestrator 가 비활성/안내. SDK 클라이언트·fetch 는 주입(verify 스텁).
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
  type OpenAIResponse
} from './normalize/openai'
import type { OpenAIClientLike } from './OpenAIProvider'
import { resolveModelId } from '../models'
import type { DnsLookup } from './ssrfGuard'
import { assertRequestAllowed } from './ssrfGuard'

export interface InternalProviderDeps {
  readonly config: ProviderConfig
  readonly client: OpenAIClientLike
  /** SSRF 검증에 쓰는 허용 호스트 목록(비-비밀·등록됨). */
  readonly allowList: readonly string[]
  /** DNS lookup(주입 가능·verify 스텁). 기본은 ssrfGuard 내부 node:dns. */
  readonly lookup?: DnsLookup
}

export function createInternalProvider(deps: InternalProviderDeps): LLMProvider {
  const caps: ProviderCapabilities = {
    toolUse: deps.config.supportsToolUse === true,
    streaming: true
  }
  return {
    id: 'internal',
    capabilities: caps,
    async createCompletion(
      req: NormalizedCompletionReq,
      onDelta: (d: ThinkingDelta) => void
    ): Promise<LLMTurnResult> {
      // 요청 직전 SSRF 재검증(TOCTOU·DNS 리바인딩 방어). 실패 시 throw → Orchestrator 가 error 이벤트.
      const baseUrl = deps.config.baseUrl ?? ''
      const guard = await assertRequestAllowed(baseUrl, deps.allowList, deps.lookup)
      if (!guard.ok) {
        throw new Error(`SSRF 차단: ${guard.error.message}`)
      }
      const model = resolveModelId(deps.config, req.tier)
      const params = {
        model,
        max_tokens: req.maxTokens,
        messages: toOpenAIMessages(req.messages),
        tools: toOpenAITools(req.tools)
      }
      const options = req.signal ? { signal: req.signal } : undefined

      if (typeof deps.client.chat.completions.createStream === 'function') {
        try {
          const assembler = createOpenAIStreamAssembler((t) => onDelta({ text: t }))
          const iter = deps.client.chat.completions.createStream(
            { ...params, stream: true, stream_options: { include_usage: true } },
            options
          )
          for await (const chunk of iter) assembler.push(chunk)
          return assembler.result()
        } catch (e) {
          if (req.signal?.aborted) throw e
          // 비스트리밍 폴백(내부 호환 서버가 스트림 미지원일 수 있음).
        }
      }
      const resp: OpenAIResponse = await deps.client.chat.completions.create(params, options)
      return fromOpenAIResponse(resp)
    }
  }
}
