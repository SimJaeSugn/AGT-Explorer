/**
 * src/main/agent/provider/createProvider.ts — ProviderConfig→LLMProvider 팩토리(ADR-015 G1·G5).
 *
 * config.id 로 구현체 3종을 선택한다. **키는 호출 직전 agentKeyStore 에서 복호**해 SDK 클라이언트
 * 생성 시점에만 주입(키는 config·DTO 에 없음). SDK 클라이언트 생성은 **주입 가능한 ClientFactory**
 * 뒤에 둔다 — 기본 구현은 @anthropic-ai/sdk·openai 를 지연 생성하고, 헤드리스 verify 는 스텁
 * 팩토리를 주입해 실 SDK·실 API 없이 팩토리 분기·degradation 을 검증한다.
 */
import type { ProviderConfig, ProviderId, Result } from '@shared/ipc/contracts'
import { err, ok } from '@shared/ipc/contracts'
import { fileOpError } from '../../fs/errors'
import type { LLMProvider } from './LLMProvider'
import type { AnthropicClientLike } from './AnthropicProvider'
import { createAnthropicProvider } from './AnthropicProvider'
import type { OpenAIClientLike } from './OpenAIProvider'
import { createOpenAIProvider } from './OpenAIProvider'
import { createInternalProvider } from './InternalOpenAICompatProvider'
import type { DnsLookup } from './ssrfGuard'

/** SDK 클라이언트 생성 추상(주입 가능·verify 스텁). 키는 여기로만 흘러든다(DTO 미수록). */
export interface ClientFactory {
  anthropic(apiKey: string): AnthropicClientLike
  openai(apiKey: string): OpenAIClientLike
  /** 내부: baseURL + ssrfGuard 통과 fetch 주입(런타임 구현이 fetch 게이트 배선). */
  internal(apiKey: string, baseUrl: string): OpenAIClientLike
}

export interface CreateProviderDeps {
  readonly config: ProviderConfig
  /** 키 복호 함수(agentKeyStore.get 동형 — provider→평문|null). */
  readonly getKey: (provider: ProviderId) => Promise<string | null>
  readonly clientFactory: ClientFactory
  /** 내부 provider SSRF 화이트리스트(비-비밀). */
  readonly allowList?: readonly string[]
  /** 내부 provider DNS lookup(주입·verify 스텁). */
  readonly lookup?: DnsLookup
}

/**
 * config → LLMProvider. anthropic/openai 키 미보유 시 EAUTH. internal 은 baseUrl+modelId 필수이며
 * 키는 선택(로컬 서버 무인증 — 미보유 시 플레이스홀더 키로 SDK 생성).
 */
export async function createProvider(deps: CreateProviderDeps): Promise<Result<LLMProvider>> {
  const { config } = deps
  const apiKey = await deps.getKey(config.id)
  // 로컬/내부 OpenAI 호환 서버(LM Studio·Ollama 등)는 Authorization 을 요구하지 않으므로 키를
  // 선택화한다(없거나 빈 문자열이면 플레이스홀더로 SDK 생성 — 서버가 무시). anthropic/openai 는
  // 키 필수(EAUTH 유지). 키가 있으면 그 키를 사용한다.
  if (!apiKey && config.id !== 'internal') {
    return err(fileOpError('EAUTH', `${config.id} 제공자의 API 키가 설정되지 않았습니다.`))
  }
  switch (config.id) {
    case 'anthropic':
      return ok(createAnthropicProvider(config, deps.clientFactory.anthropic(apiKey!)))
    case 'openai':
      return ok(createOpenAIProvider(config, deps.clientFactory.openai(apiKey!)))
    case 'internal': {
      if (!config.baseUrl || !config.modelId) {
        return err(fileOpError('EINVAL', '내부 제공자는 baseUrl 과 modelId 가 필요합니다.'))
      }
      // 로컬 서버는 키 불필요 — 키 미보유 시 플레이스홀더 사용(SDK 가 빈 문자열 거부할 수 있어).
      const client = deps.clientFactory.internal(apiKey || 'lm-studio', config.baseUrl)
      return ok(
        createInternalProvider({
          config,
          client,
          allowList: deps.allowList ?? [],
          ...(deps.lookup ? { lookup: deps.lookup } : {})
        })
      )
    }
    default:
      return err(fileOpError('EINVAL', `알 수 없는 제공자: ${String((config as ProviderConfig).id)}`))
  }
}

/**
 * 런타임 기본 ClientFactory — @anthropic-ai/sdk·openai 지연 생성.
 * 내부 provider 의 fetch 게이트(ssrfGuard 통과)는 Z1 핸들러 배선에서 주입한다(여기선 baseURL 세팅).
 */
export function createDefaultClientFactory(opts?: {
  /** 내부 provider 에 주입할 SSRF 통과 fetch(미지정 시 SDK 기본 fetch — assertRequestAllowed 가 1차 게이트). */
  readonly internalFetch?: typeof fetch
}): ClientFactory {
  return {
    anthropic(apiKey: string): AnthropicClientLike {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('@anthropic-ai/sdk') as {
        default: new (o: { apiKey: string }) => {
          messages: {
            create: AnthropicClientLike['messages']['create']
            stream(params: unknown, options?: unknown): AsyncIterable<unknown>
          }
        }
      }
      const sdk = new mod.default({ apiKey })
      return {
        messages: {
          create: (params, options) => sdk.messages.create(params, options),
          // SDK messages.stream(...) 은 raw 이벤트(content_block_delta 등)의 async iterable.
          stream(params, options) {
            return sdk.messages.stream(params, options) as never
          }
        }
      }
    },
    openai(apiKey: string): OpenAIClientLike {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('openai') as { default: new (o: { apiKey: string }) => RawOpenAI }
      return adaptOpenAI(new mod.default({ apiKey }))
    },
    internal(apiKey: string, baseUrl: string): OpenAIClientLike {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('openai') as {
        default: new (o: { apiKey: string; baseURL: string; fetch?: typeof fetch }) => RawOpenAI
      }
      return adaptOpenAI(
        new mod.default({
          apiKey,
          baseURL: baseUrl,
          ...(opts?.internalFetch ? { fetch: opts.internalFetch } : {})
        })
      )
    }
  }
}

/** openai SDK 의 chat.completions 표면(런타임만 — create({stream:true})→async iterable). */
interface RawOpenAI {
  chat: {
    completions: {
      create(params: unknown, options?: unknown): Promise<unknown> | AsyncIterable<unknown>
    }
  }
}

/**
 * openai SDK 를 OpenAIClientLike 로 어댑트. SDK 는 create({stream:true}) 가 async iterable 을
 * 반환하므로, 비스트리밍 create 와 스트리밍 createStream 두 표면으로 분리해 제공한다.
 */
function adaptOpenAI(sdk: RawOpenAI): OpenAIClientLike {
  return {
    chat: {
      completions: {
        create: (params, options) =>
          sdk.chat.completions.create(params, options) as never,
        createStream(params, options) {
          // create({stream:true}) → AsyncIterable<ChatCompletionChunk>.
          return sdk.chat.completions.create(params, options) as never
        }
      }
    }
  }
}
