/**
 * src/main/agent/providerProbe.ts — 제공자 tool-use 실 런타임 판정(§Z 제공자 백엔드·G3).
 *
 * `agent:provider:probe` 가 정적 capability 플래그만 반환하던 것을, **활성 제공자/모델로 더미
 * 도구 1개를 준 최소 completion** 을 실제로 호출해 tool-use 지원 여부를 판정한다. provider 가
 * 생성된 경우 정적 capability 플래그(internal supportsToolUse 등) 값과 무관하게 실 probe 를
 * 시도하고(미지의 내부 모델 실측이 probe 의 존재 이유), provider 미생성(키/설정 미비)·요청
 * 실패만 정적 capability 로 폴백한다(사유 포함·정직 표기).
 *
 * **읽기 전용·쓰기 0**: probe completion 은 더미 도구 정의만 보내고 결과는 toolCalls 유무로만
 * 판정한다(실제 도구 실행·파일 접근 0). provider.createCompletion 1개만 호출(제공자 무지).
 * SDK·네트워크는 provider 구현체 뒤에 격리되며, 헤드리스 verify 는 스텁 provider 를 주입한다.
 */
import type { AgentProviderProbeRes } from '@shared/ipc/contracts'
import type { LLMProvider, NormalizedToolDef } from './provider/LLMProvider'

/** probe 용 최소 더미 도구(파일 접근 0 — 모델이 tool_use 를 낼 수 있는지만 본다). */
const PROBE_TOOL: NormalizedToolDef = {
  name: 'probe_capability',
  description: '연결 점검용 더미 도구입니다. 이 도구를 호출해 보세요.',
  inputSchema: {
    type: 'object',
    properties: { ok: { type: 'boolean', description: '항상 true' } },
    required: ['ok']
  }
}

const PROBE_PROMPT =
  '연결 점검 중입니다. 반드시 probe_capability 도구를 한 번 호출하세요(인자 ok=true).'

/** probe 의 in-flight 시간 상한(ms) — 멈춘 endpoint 로 핸들러가 묶이지 않게. */
const PROBE_TIMEOUT_MS = 15_000

export interface ProbeRuntimeDeps {
  /** 활성 제공자(이미 생성됨 — createProvider 산출). null 이면 키/설정 미비. */
  readonly provider: LLMProvider | null
  /** provider 생성 실패 사유(키 없음·EINVAL 등) — provider=null 일 때 정직 표기. */
  readonly providerError?: string
  /** probe completion 시간 상한(테스트 주입·기본 PROBE_TIMEOUT_MS). */
  readonly timeoutMs?: number
}

/**
 * 실 런타임 probe. provider 가 있으면 더미 도구 completion 을 시도해 toolCalls 유무로 판정.
 * 없거나 실패 시 정적 capability(provider.capabilities.toolUse)로 폴백(사유 포함).
 *
 * 결과 shape: `{ toolUse, source:'probe'|'static', reason? }`.
 */
export async function runProviderProbe(deps: ProbeRuntimeDeps): Promise<AgentProviderProbeRes> {
  const { provider } = deps
  if (!provider) {
    // 키/설정 미비 → 정적 폴백(가용 능력 불명 → false 가 안전 기본).
    return { toolUse: false, source: 'static', reason: deps.providerError ?? '제공자 설정/키가 없습니다.' }
  }

  // provider 가 있으면 capability 플래그(internal supportsToolUse 등)와 무관하게 **실제** 더미
  // 도구 completion 을 호출해 실측한다. probe 의 존재 이유는 미지의 내부 모델 실측이므로, 정적
  // capability=false 라도 단락하지 않는다(Anthropic/OpenAI 는 capability=true·어차피 실측·무해).
  // 실측 불가(provider=null) 와 요청 실패만 정적 폴백한다.
  const timeoutMs = deps.timeoutMs ?? PROBE_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const turn = await provider.createCompletion(
      {
        messages: [{ role: 'user', content: PROBE_PROMPT }],
        tools: [PROBE_TOOL],
        tier: 'light',
        maxTokens: 256,
        signal: controller.signal
      },
      () => {} // probe 는 델타 무시.
    )
    const toolUse = turn.toolCalls.length > 0
    return {
      toolUse,
      source: 'probe',
      ...(toolUse ? {} : { reason: '모델이 더미 도구를 호출하지 않았습니다(미지원 가능성).' })
    }
  } catch (e) {
    // 실 호출 실패(네트워크·인증·취소 등) → 정적 capability 폴백.
    return {
      toolUse: provider.capabilities.toolUse,
      source: 'static',
      reason: `probe 호출 실패(정적 폴백): ${e instanceof Error ? e.message : String(e)}`
    }
  } finally {
    clearTimeout(timer)
  }
}
