/**
 * AgentSettings — 설정 화면 "AI 에이전트" 카테고리 (§Z Z1·US-24.5·SG-4).
 *
 * 제공자 선택(anthropic/openai/internal)·제공자별 API 키 입력(keySet·입력 후 값 비표시·
 * keyHas 로 ●설정됨 표시)·모델 선택(providerModels)·internal 은 base URL+modelId 입력
 * (허용 호스트 안내)·providerProbe 결과(tool-use 지원) 표시. 저장은 providerSet(비밀 제외)·
 * 키는 keySet. 외부 전송/BYO 키·과금 사용자 책임 고지 + 내용 전송 동의 토글(SG-4).
 *
 * 보안: API 키는 입력 즉시 keySet 으로만 전달되고 화면/스토어에 평문을 남기지 않는다
 * (입력란은 저장 후 비운다·값 재표시 0·보유 여부만 ● 표기).
 *
 * 경계: ui → app(usecases/agent)·SDK/네트워크 직접 import 0.
 */
import { useEffect, useRef, useState } from 'react'
import type { ModelInfo, ProviderConfig, ProviderId } from '@shared/dto'
import { useRootStore } from '@renderer/app/stores/rootStore'
import {
  addInternalHost,
  getProvider,
  hasApiKey,
  listModels,
  probeProvider,
  removeInternalHost,
  setApiKey,
  setProvider
} from '@renderer/app/usecases/agent'
import { tokens } from '@renderer/ui/theme/tokens'
import { btn } from '@renderer/ui/dialogs/dialogStyles'

const labelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '7px 0',
  borderBottom: `1px solid ${tokens.color.border}`
}
const fieldLabel: React.CSSProperties = { flex: '0 0 140px', fontWeight: 500 }
const selectStyle: React.CSSProperties = {
  height: 28,
  border: `1px solid ${tokens.color.border}`,
  borderRadius: 5,
  fontSize: 13,
  background: tokens.color.bg,
  color: tokens.color.text,
  padding: '0 6px'
}
const inputStyle: React.CSSProperties = {
  flex: 1,
  height: 28,
  border: `1px solid ${tokens.color.border}`,
  borderRadius: 5,
  fontSize: 13,
  padding: '0 8px',
  background: tokens.color.bg,
  color: tokens.color.text,
  boxSizing: 'border-box'
}

const PROVIDER_LABEL: Record<ProviderId, string> = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI (GPT)',
  internal: '내부(사내 호환 엔드포인트)'
}

/** probe 결과(상세) — source/reason 포함. `agentApi.providerProbe` 응답 shape. */
interface ProbeResult {
  readonly toolUse: boolean
  readonly source?: 'probe' | 'static'
  readonly reason?: string
}

export function AgentSettings(): JSX.Element {
  const consent = useRootStore((s) => s.agentContentConsent)
  const setConsent = useRootStore((s) => s.setAgentContentConsent)

  const [loaded, setLoaded] = useState(false)
  const [active, setActive] = useState<ProviderConfig>({ id: 'anthropic' })
  const [available, setAvailable] = useState<readonly ProviderId[]>([])
  const [allowedHosts, setAllowedHosts] = useState<readonly string[]>([])
  const [models, setModels] = useState<readonly ModelInfo[]>([])
  const [probe, setProbe] = useState<ProbeResult | null>(null)
  const [probing, setProbing] = useState(false)
  const [keyDraft, setKeyDraft] = useState('')
  const [hasKey, setHasKey] = useState(false)
  const [saving, setSaving] = useState(false)
  // internal 화이트리스트 관리(추가 입력·인라인 오류·진행 가드).
  const [hostDraft, setHostDraft] = useState('')
  const [hostError, setHostError] = useState<string | null>(null)
  const [hostBusy, setHostBusy] = useState(false)
  const reqSeq = useRef(0)

  // 활성 제공자별 모델·키 보유 재조회(probe 는 명시 버튼으로만 — 외부 호출 최소화).
  async function refreshFor(id: ProviderId): Promise<void> {
    const seq = ++reqSeq.current
    const [m, k] = await Promise.all([listModels(id), hasApiKey(id)])
    if (seq !== reqSeq.current) return
    setModels(m.ok ? m.value.models : [])
    setHasKey(k)
    setProbe(null)
  }

  // 화이트리스트 새로고침(추가/삭제 후 providerGet 으로 최신 목록 반영).
  async function refreshHosts(): Promise<void> {
    const res = await getProvider()
    if (res.ok) setAllowedHosts(res.value.allowedInternalHosts)
  }

  // 최초 1회 활성 설정 로드.
  useEffect(() => {
    let alive = true
    void (async () => {
      const res = await getProvider()
      if (!alive) return
      if (res.ok) {
        setActive(res.value.active)
        setAvailable(res.value.available)
        setAllowedHosts(res.value.allowedInternalHosts)
        await refreshFor(res.value.active.id)
      }
      setLoaded(true)
    })()
    return () => {
      alive = false
    }
  }, [])

  function patchActive(patch: Partial<ProviderConfig>): ProviderConfig {
    const next = { ...active, ...patch }
    setActive(next)
    return next
  }

  // 제공자 전환: 비-비밀 설정만 즉시 저장 + 모델/키 재조회(probe·호스트 입력 리셋).
  async function onChangeProvider(id: ProviderId): Promise<void> {
    const next = patchActive({ id })
    setKeyDraft('')
    setHostDraft('')
    setHostError(null)
    await setProvider(next)
    await refreshFor(id)
  }

  async function persist(next: ProviderConfig): Promise<void> {
    setSaving(true)
    await setProvider(next)
    setSaving(false)
  }

  // API 키 저장(keySet) — 저장 후 입력란 비움·보유 표기 갱신(값 재표시 0).
  // 키가 바뀌면 직전 probe 결과는 무효 → null 로 비우고 사용자가 다시 확인하도록 한다.
  async function onSaveKey(): Promise<void> {
    const k = keyDraft.trim()
    if (k === '') return
    setSaving(true)
    const ok = await setApiKey(active.id, k)
    setSaving(false)
    setKeyDraft('')
    if (ok) {
      setHasKey(true)
      setProbe(null)
    }
  }

  // probe 실행 — 활성 제공자의 tool-use 지원을 실제로 확인(source/reason 표시).
  async function onProbe(): Promise<void> {
    setProbing(true)
    const res = await probeProvider(active.id)
    setProbing(false)
    setProbe(res.ok ? res.value : { toolUse: false, source: 'static', reason: '확인 중 오류' })
  }

  // 화이트리스트 추가 — 입력 URL 을 internalHostAdd. 거부(SSRF 등)는 인라인 오류.
  async function onAddHost(): Promise<void> {
    const url = hostDraft.trim()
    if (url === '' || hostBusy) return
    setHostBusy(true)
    setHostError(null)
    const res = await addInternalHost(url)
    setHostBusy(false)
    if (res.ok) {
      setHostDraft('')
      await refreshHosts()
    } else {
      setHostError(res.error.message ?? '호스트를 추가할 수 없습니다(허용되지 않는 주소).')
    }
  }

  // 화이트리스트 삭제 — internalHostRemove 후 목록 새로고침.
  async function onRemoveHost(host: string): Promise<void> {
    if (hostBusy) return
    setHostBusy(true)
    setHostError(null)
    const res = await removeInternalHost(host)
    setHostBusy(false)
    if (res.ok) await refreshHosts()
    else setHostError(res.error.message ?? '호스트를 삭제할 수 없습니다.')
  }

  const isInternal = active.id === 'internal'

  return (
    <div>
      <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 8px' }}>AI 에이전트</h3>
      <span style={{ color: tokens.color.textMuted, fontSize: 12, lineHeight: 1.6 }}>
        자연어로 현재 폴더를 질문하는 읽기 전용 에이전트입니다. 질문·컨텍스트는 선택한 제공자에게
        외부로 전송되며, API 키 발급·요청 과금은 사용자(BYO 키) 책임입니다.
      </span>

      {!loaded ? (
        <div style={{ marginTop: 12, color: tokens.color.textMuted, fontSize: 13 }}>불러오는 중…</div>
      ) : (
        <div style={{ marginTop: 12 }}>
          {/* 제공자 선택 */}
          <div style={labelStyle}>
            <span style={fieldLabel}>제공자</span>
            <select
              value={active.id}
              onChange={(e) => void onChangeProvider(e.target.value as ProviderId)}
              aria-label="AI 제공자"
              style={selectStyle}
            >
              {(['anthropic', 'openai', 'internal'] as ProviderId[]).map((id) => (
                <option key={id} value={id}>
                  {PROVIDER_LABEL[id]}
                  {available.includes(id) ? ' ●' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* API 키(anthropic/openai=필수 · internal=선택 — 로컬 서버는 키 불필요) */}
          <div style={labelStyle}>
            <span style={fieldLabel}>
              API 키{isInternal ? <span style={{ color: tokens.color.textMuted, fontWeight: 400 }}> (선택)</span> : ''}{' '}
              {hasKey ? <span style={{ color: tokens.color.accent }}>● 설정됨</span> : ''}
            </span>
            <input
              type="password"
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              placeholder={
                isInternal
                  ? '로컬 서버는 불필요 · 키가 필요한 경우만 입력'
                  : hasKey
                    ? '재입력 시 새 키로 교체'
                    : '키 붙여넣기 후 저장'
              }
              aria-label="API 키"
              autoComplete="off"
              style={inputStyle}
            />
            <button
              onClick={() => void onSaveKey()}
              disabled={keyDraft.trim() === '' || saving}
              style={{ ...btn('default'), opacity: keyDraft.trim() === '' || saving ? 0.5 : 1 }}
            >
              저장
            </button>
          </div>

          {/* 모델 선택(anthropic/openai = planModel 사용) */}
          {!isInternal && (
            <div style={labelStyle}>
              <span style={fieldLabel}>모델</span>
              <select
                value={active.planModel ?? ''}
                onChange={(e) => void persist(patchActive({ planModel: e.target.value }))}
                aria-label="모델"
                style={selectStyle}
                disabled={models.length === 0}
              >
                {models.length === 0 ? (
                  <option value="">기본값</option>
                ) : (
                  <>
                    <option value="">기본값</option>
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                        {m.tier ? ` (${m.tier})` : ''}
                      </option>
                    ))}
                  </>
                )}
              </select>
            </div>
          )}

          {/* internal: base URL + modelId(허용 호스트 화이트리스트 관리) */}
          {isInternal && (
            <>
              <div style={labelStyle}>
                <span style={fieldLabel}>Base URL</span>
                <input
                  value={active.baseUrl ?? ''}
                  onChange={(e) => setActive({ ...active, baseUrl: e.target.value })}
                  onBlur={() => void persist(active)}
                  placeholder="https://llm.사내.예시/v1"
                  aria-label="Base URL"
                  style={inputStyle}
                />
              </div>
              <div style={labelStyle}>
                <span style={fieldLabel}>모델 ID</span>
                <input
                  value={active.modelId ?? ''}
                  onChange={(e) => setActive({ ...active, modelId: e.target.value })}
                  onBlur={() => void persist(active)}
                  placeholder="예: internal-llm-v1"
                  aria-label="모델 ID"
                  style={inputStyle}
                />
              </div>

              {/* 내부 엔드포인트 화이트리스트 관리(목록·추가·삭제) */}
              <div style={{ padding: '8px 0', borderBottom: `1px solid ${tokens.color.border}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={fieldLabel}>허용 호스트</span>
                  <input
                    value={hostDraft}
                    onChange={(e) => setHostDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        void onAddHost()
                      }
                    }}
                    placeholder="https://llm.사내.예시 추가"
                    aria-label="허용 호스트 추가"
                    style={inputStyle}
                  />
                  <button
                    onClick={() => void onAddHost()}
                    disabled={hostDraft.trim() === '' || hostBusy}
                    style={{
                      ...btn('default'),
                      opacity: hostDraft.trim() === '' || hostBusy ? 0.5 : 1
                    }}
                  >
                    추가
                  </button>
                </div>

                {hostError !== null && (
                  <div
                    role="alert"
                    style={{
                      marginTop: 6,
                      marginLeft: 140,
                      fontSize: 12,
                      color: tokens.color.danger
                    }}
                  >
                    {hostError}
                  </div>
                )}

                <ul
                  aria-label="허용된 내부 호스트 목록"
                  style={{ listStyle: 'none', margin: '8px 0 0', padding: 0 }}
                >
                  {allowedHosts.length === 0 ? (
                    <li style={{ fontSize: 12, color: tokens.color.textMuted, marginLeft: 140 }}>
                      등록된 호스트가 없습니다. Base URL 은 아래 목록에 있는 호스트만 사용할 수
                      있습니다.
                    </li>
                  ) : (
                    allowedHosts.map((host) => (
                      <li
                        key={host}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          marginLeft: 140,
                          padding: '3px 0',
                          fontSize: 13
                        }}
                      >
                        <span
                          style={{
                            flex: 1,
                            fontFamily: 'monospace',
                            wordBreak: 'break-all'
                          }}
                        >
                          {host}
                        </span>
                        <button
                          onClick={() => void onRemoveHost(host)}
                          disabled={hostBusy}
                          aria-label={`${host} 삭제`}
                          title="화이트리스트에서 삭제"
                          style={{ ...btn('default'), opacity: hostBusy ? 0.5 : 1 }}
                        >
                          삭제
                        </button>
                      </li>
                    ))
                  )}
                </ul>

                <div
                  style={{
                    marginTop: 6,
                    marginLeft: 140,
                    fontSize: 12,
                    color: tokens.color.textMuted,
                    lineHeight: 1.5
                  }}
                >
                  보안을 위해 사설/loopback/링크로컬 등 내부망 외 주소는 추가가 거부됩니다. Base
                  URL 은 이 목록에 있는 호스트만 유효합니다.
                </div>
              </div>
            </>
          )}

          {/* 도구 호출 지원(probe) — 버튼으로 실제 확인 + 결과/출처/사유 표기 */}
          <div style={{ padding: '8px 0', borderBottom: `1px solid ${tokens.color.border}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={fieldLabel}>도구 호출 지원</span>
              <button
                onClick={() => void onProbe()}
                disabled={probing}
                style={{ ...btn('default'), opacity: probing ? 0.5 : 1 }}
              >
                {probing ? '확인 중…' : 'tool-use 지원 확인'}
              </button>
              {probe !== null && (
                <span style={{ fontSize: 13 }}>
                  {probe.toolUse ? (
                    <span style={{ color: tokens.color.accent }}>✅ 지원함</span>
                  ) : (
                    <span style={{ color: tokens.color.danger }}>
                      ⚠️ 이 모델은 에이전트(도구 호출) 미지원
                    </span>
                  )}
                </span>
              )}
            </div>
            {probe !== null && (probe.source !== undefined || probe.reason !== undefined) && (
              <div
                style={{
                  marginTop: 6,
                  marginLeft: 140,
                  fontSize: 12,
                  color: tokens.color.textMuted,
                  lineHeight: 1.5
                }}
              >
                {probe.source !== undefined &&
                  (probe.source === 'probe' ? '실제 확인(probe)' : '정적 판정(폴백)')}
                {probe.source !== undefined && probe.reason !== undefined ? ' · ' : ''}
                {probe.reason}
              </div>
            )}
          </div>

          {/* SG-4 내용 전송 동의 */}
          <label style={labelStyle}>
            <span style={fieldLabel}>파일 내용 전송</span>
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              aria-label="파일 내용 포함 전송 동의"
            />
            <span style={{ color: tokens.color.textMuted, fontSize: 12 }}>
              켜면 질문에 필요한 파일의 실제 내용을 제공자에게 전송합니다(기본 꺼짐 — 경로·메타만).
            </span>
          </label>
        </div>
      )}
    </div>
  )
}
