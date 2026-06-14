/**
 * src/main/agent/providerConfigStore.ts — 활성 제공자 설정·내부 SSRF 화이트리스트 보관(비-비밀).
 *
 * 키가 아닌 **비-비밀 설정**(활성 제공자·모델 ID·내부 허용 호스트)만 다룬다. 키는 agentKeyStore.
 * Z0 은 인메모리(프로세스 수명) — 비-비밀 설정의 세션 영속(SCHEMA 무변 옵셔널 필드)은 Z4 배선.
 * 화이트리스트 등록 시 ssrfGuard.validateRegister(1~4단계)를 통과해야 추가된다.
 */
import type { ProviderConfig, Result } from '@shared/ipc/contracts'
import { err, ok } from '@shared/ipc/contracts'
import { fileOpError } from '../fs/errors'
import { normalizeUrl, validateRegister } from './provider/ssrfGuard'

export interface ProviderConfigStore {
  getActive(): ProviderConfig
  setActive(config: ProviderConfig): Result<void>
  allowedInternalHosts(): readonly string[]
  /** 내부 호스트 화이트리스트 등록(SSRF 1~4단계 통과 시). */
  registerInternalHost(url: string): Result<void>
  /**
   * 내부 호스트 화이트리스트 삭제. host 는 URL 또는 정규화 키(`host:port`/`host`) 둘 다 허용.
   * 정규화 가능한 입력은 정규화 키로, 아니면 입력 문자열을 그대로(trim·소문자) 키로 본다.
   * 목록에 없으면 ENOENT(throw 0).
   */
  removeInternalHost(host: string): Result<void>
}

// 기본값: 내부(OpenAI 호환) 로컬 LLM — LM Studio `http://127.0.0.1:1234/v1`·qwen/qwen3-1.7b.
// 해당 모델은 function-calling(tool_calls) 지원 확인됨 → supportsToolUse:true 로 바로 사용 가능
// (모델 변경 시 "도구 호출 지원 확인"(probe)이 재판정·재저장). baseUrl 호스트는 아래에서 화이트리스트 선등록.
const DEFAULT_CONFIG: ProviderConfig = {
  id: 'internal',
  baseUrl: 'http://127.0.0.1:1234/v1',
  modelId: 'qwen/qwen3-1.7b',
  supportsToolUse: true
}

export function createProviderConfigStore(): ProviderConfigStore {
  let active: ProviderConfig = DEFAULT_CONFIG
  const allowed = new Set<string>()
  // 기본 내부 엔드포인트 호스트를 SSRF 화이트리스트에 선등록(loopback — B 정책 허용).
  if (DEFAULT_CONFIG.id === 'internal' && DEFAULT_CONFIG.baseUrl) {
    const reg = validateRegister(DEFAULT_CONFIG.baseUrl)
    if (reg.ok) allowed.add(reg.value.key)
  }

  return {
    getActive: () => active,

    setActive(config): Result<void> {
      if (config.id === 'internal') {
        if (!config.baseUrl || !config.modelId) {
          return err(fileOpError('EINVAL', '내부 제공자는 baseUrl 과 modelId 가 필요합니다.'))
        }
        // 활성화 전 화이트리스트 등록(SSRF 1~4 형식 검증).
        const reg = this.registerInternalHost(config.baseUrl)
        if (!reg.ok) return reg
      }
      active = config
      return ok(undefined)
    },

    allowedInternalHosts: () => [...allowed],

    registerInternalHost(url): Result<void> {
      const v = validateRegister(url)
      if (!v.ok) return v
      allowed.add(v.value.key)
      return ok(undefined)
    },

    removeInternalHost(host): Result<void> {
      // URL/정규화 키 둘 다 수용. 정규화 키와 입력 그대로(trim·소문자) 양쪽을 시도 삭제.
      const norm = normalizeUrl(host)
      const candidates = new Set<string>()
      if (norm) candidates.add(norm.key)
      candidates.add(host.trim().toLowerCase())
      let removed = false
      for (const k of candidates) {
        if (allowed.delete(k)) removed = true
      }
      if (!removed) {
        return err(fileOpError('ENOENT', '화이트리스트에 없는 호스트입니다.', host))
      }
      return ok(undefined)
    }
  }
}

/** 정규화 키 노출(핸들러가 요청 직전 검증에 allowList 로 전달). */
export function normalizeHostKey(url: string): string | null {
  const n = normalizeUrl(url)
  return n ? n.key : null
}
