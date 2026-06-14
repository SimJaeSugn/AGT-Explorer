/**
 * agent:* IPC 핸들러 (§Z — 자연어 파일 에이전트, ADR-014·ADR-015).
 *
 * Z0 범위: **계약 + 키/제공자 설정 store 배선 + 오케스트레이터 호출 골격**.
 *   - agent:key:set/has        → agentKeyStore(제공자별 safeStorage·평문 0).
 *   - agent:provider:set/get/  → providerConfigStore(비-비밀·SSRF 화이트리스트 등록).
 *     list-models/probe
 *   - agent:run/confirm/cancel → run 레코드·AbortController 골격. **실 루프 launch·agent:event
 *     푸시·plan→op:start 정규화는 Z1(frontend 배선)** — 여기서는 계약·스코프 구성·취소 핸들까지.
 *
 * 모든 핸들러 guard 통과(senderFrame·zod). 경로(cwd·selection·PlannedOp)는 guardPath + scope
 * 재검증. baseUrl 은 ssrfGuard.validateRegister 추가 통과. 응답 Result<T,FileOpError>(throw 0).
 * handleGuarded 패턴은 hash.handlers.ts 를 복제한다.
 */
import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { CHANNELS } from '@shared/ipc/channels'
import type {
  AgentConfirmRes,
  AgentEvent,
  AgentKeyHasRes,
  AgentLocationItem,
  AgentLocations,
  AgentPanelLocation,
  AgentProviderGetRes,
  AgentProviderModelsRes,
  AgentProviderProbeRes,
  AgentRunRes,
  ProviderConfig,
  ProviderId,
  Result
} from '@shared/ipc/contracts'
import { err, ok } from '@shared/ipc/contracts'
import { fileOpError, toFileOpError } from '../fs/errors'
import { agentKeyStore } from '../agent/agentKeyStore'
import { createProviderConfigStore } from '../agent/providerConfigStore'
import { PROVIDER_MODEL_CATALOG } from '../agent/models'
import { createProvider, createDefaultClientFactory } from '../agent/provider/createProvider'
import { createGuardedFetch } from '../agent/provider/guardedFetch'
import { runProviderProbe } from '../agent/providerProbe'
import { runHybrid, type OrchestratorEvent } from '../agent/AgentOrchestrator'
import { mapServerError } from '../agent/provider/normalize/reasoning'
import { buildScope } from '../agent/scope'
import { createReadBackend } from '../agent/readBackend'
import { createRealReadDeps } from '../agent/realReadDeps'
import {
  guardPath,
  isTrustedSender,
  parseArgs,
  untrustedSenderError,
  zAgentCancelReq,
  zAgentConfirmReq,
  zAgentKeyHasReq,
  zAgentKeySetReq,
  zAgentProviderModelsReq,
  zAgentProviderProbeReq,
  zAgentProviderSetReq,
  zAgentRunReq
} from './guard'

function handleGuarded<TSchema extends import('zod').ZodTypeAny, TVal>(
  channel: string,
  schema: TSchema,
  fn: (req: import('zod').infer<TSchema>, event: IpcMainInvokeEvent) => Promise<Result<TVal>> | Result<TVal>
): void {
  ipcMain.handle(channel, async (event, raw): Promise<Result<TVal>> => {
    if (!isTrustedSender(event)) return err(untrustedSenderError())
    const parsed = parseArgs(schema, raw)
    if (!parsed.ok) return parsed as Result<TVal>
    return fn(parsed.value, event)
  })
}

/** void 요청(인자 없음) 핸들러 — agent:provider:get. */
function handleVoid<TVal>(channel: string, fn: () => Promise<Result<TVal>> | Result<TVal>): void {
  ipcMain.handle(channel, async (event): Promise<Result<TVal>> => {
    if (!isTrustedSender(event)) return err(untrustedSenderError())
    return fn()
  })
}

const PROVIDERS: readonly ProviderId[] = ['anthropic', 'openai', 'internal']

/** zod 추론형(optional=undefined 포함) → ProviderConfig(exactOptionalPropertyTypes — undefined 키 제거). */
function toProviderConfig(c: {
  id: ProviderId
  planModel?: string | undefined
  lightModel?: string | undefined
  baseUrl?: string | undefined
  modelId?: string | undefined
  supportsToolUse?: boolean | undefined
}): ProviderConfig {
  return {
    id: c.id,
    ...(c.planModel !== undefined ? { planModel: c.planModel } : {}),
    ...(c.lightModel !== undefined ? { lightModel: c.lightModel } : {}),
    ...(c.baseUrl !== undefined ? { baseUrl: c.baseUrl } : {}),
    ...(c.modelId !== undefined ? { modelId: c.modelId } : {}),
    ...(c.supportsToolUse !== undefined ? { supportsToolUse: c.supportsToolUse } : {})
  }
}

/** 진행 중 run 의 취소 핸들(runId → AbortController). */
const activeRuns = new Map<string, AbortController>()
let runSeq = 0

/**
 * §Z 이름 있는 위치를 guardPath 정규화한다(가상 경로 remote://·archive:// 등은 그대로 보존 —
 * list_locations 표시용, 스코프 제외는 scope.ts 가 처리). 잘못된 로컬 경로 항목은 드롭(throw 0).
 * 반환: ① 정규화된 locations(list_locations 패스스루용) ② 스코프 후보 경로 배열(로컬 정규화분).
 */
function normalizeLocations(
  raw:
    | {
        favorites?: readonly AgentLocationItem[] | undefined
        quickAccess?: readonly AgentLocationItem[] | undefined
        recent?: readonly AgentLocationItem[] | undefined
        drives?: readonly AgentLocationItem[] | undefined
        panels?: readonly AgentPanelLocation[] | undefined
      }
    | undefined
): { locations: AgentLocations; paths: string[] } {
  if (!raw) return { locations: {}, paths: [] }
  const paths: string[] = []
  const normItem = (it: AgentLocationItem): AgentLocationItem => {
    // 가상 경로는 검증 우회(list_directory 대상 아님 — 표시만). 로컬은 guardPath 정규화·실패 시 원문 유지.
    if (/^(remote|archive|sftp|ftp):\/\//i.test(it.path.trim())) return it
    const g = guardPath(it.path)
    if (g.ok) {
      paths.push(g.value)
      return { name: it.name, path: g.value }
    }
    return it // 정규화 실패분도 목록엔 표시(스코프엔 미포함 — 자연 거부).
  }
  const normPanel = (p: AgentPanelLocation): AgentPanelLocation => {
    if (/^(remote|archive|sftp|ftp):\/\//i.test(p.path.trim())) return p
    const g = guardPath(p.path)
    if (g.ok) {
      paths.push(g.value)
      return { index: p.index, path: g.value, active: p.active }
    }
    return p
  }
  const locations: AgentLocations = {
    ...(raw.favorites ? { favorites: raw.favorites.map(normItem) } : {}),
    ...(raw.quickAccess ? { quickAccess: raw.quickAccess.map(normItem) } : {}),
    ...(raw.recent ? { recent: raw.recent.map(normItem) } : {}),
    ...(raw.drives ? { drives: raw.drives.map(normItem) } : {}),
    ...(raw.panels ? { panels: raw.panels.map(normPanel) } : {})
  }
  return { locations, paths }
}

/**
 * OrchestratorEvent(루프 내부) → AgentEvent(IPC 푸시 DTO·runId 부여). 읽기 전용이라 plan-ready 의
 * plan 은 항상 빈 배열(쓰기 ops 0). plan/step 은 ADR-016 하이브리드 비파괴 추가(추론 계획·신규 채널 0).
 * thinking/tool-call 의 stepId(스텝 부기)는 IPC 노출 안 함(기존 변형 shape 보존·패널은 plan/step 으로 진행 추적).
 */
function toAgentEvent(runId: string, e: OrchestratorEvent): AgentEvent | null {
  switch (e.type) {
    case 'thinking':
      return { type: 'thinking', runId, text: e.text }
    case 'tool-call':
      return {
        type: 'tool-call',
        runId,
        tool: e.tool,
        mode: e.mode,
        ...(e.target ? { target: e.target } : {})
      }
    case 'finish':
      // 읽기 전용: plan 비어 있음 → plan-ready 로 요약·종료 통지(쓰기 ops 0).
      return { type: 'plan-ready', runId, plan: [], summary: e.summary, truncated: e.truncated }
    case 'plan':
      // 추론 계획 단계 목록(다단계 질의·재계획 시). 패널 스텝 체크리스트 표시용.
      return { type: 'plan', runId, steps: e.steps, replanCount: e.replanCount }
    case 'step':
      // 추론 스텝 진행(start/done/failed).
      return { type: 'step', runId, stepId: e.stepId, index: e.index, total: e.total, phase: e.phase }
    case 'tool-progress':
      // 장시간 도구(트리 워크) 진행 피드백(§Z 프리징 완화). 패널이 현재 도구 라인을 라이브 갱신.
      return {
        type: 'tool-progress',
        runId,
        tool: e.tool,
        scanned: e.scanned,
        matched: e.matched,
        ...(e.stepId ? { stepId: e.stepId } : {}),
        ...(e.current ? { current: e.current } : {})
      }
    case 'limit':
      return { type: 'error', runId, error: fileOpError('EUNSUPPORTED', `에이전트 한도 초과(${e.kind})로 중단되었습니다.`) }
    case 'error':
      return { type: 'error', runId, error: fileOpError('EUNKNOWN', e.message) }
    default:
      return null
  }
}

export function registerAgentHandlers(): void {
  const configStore = createProviderConfigStore()

  // 내부 provider 의 SSRF 게이트 fetch(요청 직전 재검증 + redirect:'error') — allowList 는
  // configStore 화이트리스트를 동적으로 캡처(등록 갱신 반영). 외부 송신 격리: 이 fetch 만 SDK 주입.
  const guardedFetch = createGuardedFetch(() => configStore.allowedInternalHosts())
  const clientFactory = createDefaultClientFactory({ internalFetch: guardedFetch })

  /** 활성 설정 + 키 복호 → provider 생성(공통 — run/probe 공유). 키 미보유/internal 누락은 err. */
  const buildActiveProvider = (): ReturnType<typeof createProvider> =>
    createProvider({
      config: configStore.getActive(),
      getKey: (p) => agentKeyStore().get(p).then((r) => (r.ok ? r.value : null)),
      clientFactory,
      allowList: configStore.allowedInternalHosts()
    })

  // ── 키 (제공자별 safeStorage·평문 0) ──────────────────────────────────
  handleGuarded(CHANNELS.AGENT_KEY_SET, zAgentKeySetReq, (req): Promise<Result<void>> =>
    agentKeyStore().set(req.provider, req.apiKey)
  )
  handleGuarded(CHANNELS.AGENT_KEY_HAS, zAgentKeyHasReq, (req): Promise<Result<AgentKeyHasRes>> =>
    agentKeyStore().has(req.provider)
  )

  // ── 제공자 설정 (비-비밀·SSRF 검증) ───────────────────────────────────
  // 단일 채널로 ① 활성 제공자 설정(config) ② 내부 화이트리스트 add/remove(hostOp)를 처리.
  // 신규 채널 0. config 우선(둘 다 오면 config 적용). add 는 validateRegister 통과 시 등록.
  handleGuarded(CHANNELS.AGENT_PROVIDER_SET, zAgentProviderSetReq, (req): Result<void> => {
    if (req.config) {
      return configStore.setActive(toProviderConfig(req.config))
    }
    if (req.hostOp) {
      return req.hostOp.action === 'add'
        ? configStore.registerInternalHost(req.hostOp.host)
        : configStore.removeInternalHost(req.hostOp.host)
    }
    return err(fileOpError('EINVAL', 'config 또는 hostOp 중 하나가 필요합니다.'))
  })
  handleVoid(CHANNELS.AGENT_PROVIDER_GET, async (): Promise<Result<AgentProviderGetRes>> => {
    const available: ProviderId[] = []
    for (const p of PROVIDERS) {
      const h = await agentKeyStore().has(p)
      if (h.ok && h.value.has) available.push(p)
    }
    return ok({
      active: configStore.getActive(),
      available,
      allowedInternalHosts: configStore.allowedInternalHosts()
    })
  })
  handleGuarded(CHANNELS.AGENT_PROVIDER_MODELS, zAgentProviderModelsReq, (req): Result<AgentProviderModelsRes> => {
    if (req.id === 'internal') {
      // 내부는 사용자 입력 모델 ID 에코(없으면 빈 목록).
      const cfg = configStore.getActive()
      const models = cfg.id === 'internal' && cfg.modelId ? [{ id: cfg.modelId, label: cfg.modelId }] : []
      return ok({ models })
    }
    return ok({ models: PROVIDER_MODEL_CATALOG[req.id] })
  })
  handleGuarded(CHANNELS.AGENT_PROVIDER_PROBE, zAgentProviderProbeReq, async (req): Promise<Result<AgentProviderProbeRes>> => {
    // 실 런타임 probe: 요청 id 가 활성 제공자면 더미 도구 completion 으로 tool-use 실제 판정.
    // 키 없음/생성 실패/호출 실패는 정적 capability 폴백(사유 포함·정직 표기).
    const active = configStore.getActive()
    if (req.id !== active.id) {
      // 비활성 제공자는 실 호출 불가(설정·키가 활성 기준) → 정적 capability.
      const staticToolUse =
        req.id === 'anthropic' || req.id === 'openai'
          ? true
          : active.id === 'internal'
            ? active.supportsToolUse === true
            : false
      return ok({ toolUse: staticToolUse, source: 'static', reason: '비활성 제공자(정적 capability).' })
    }
    const created = await buildActiveProvider()
    const res = await runProviderProbe({
      provider: created.ok ? created.value : null,
      ...(created.ok ? {} : { providerError: created.error.message })
    })
    // 실 probe 결과(source:'probe')는 활성 config 의 supportsToolUse 로 영속한다 — 이후
    // agent:run capability 게이트가 (특히 internal 에서) 통과되도록. 정적 폴백은 저장하지 않는다
    // (실측이 아니므로). anthropic/openai 는 capabilities 가 하드 true 라 no-op 이어도 무방.
    if (res.source === 'probe') {
      configStore.setActive({ ...active, supportsToolUse: res.toolUse })
    }
    return ok(res)
  })

  // ── 실행 (루프 launch + agent:event 푸시) ─────────────────────────────
  handleGuarded(CHANNELS.AGENT_RUN, zAgentRunReq, async (req, event): Promise<Result<AgentRunRes>> => {
    // 1) 활성 제공자 설정 + 키 복호 → provider 생성. 키 미보유/internal 설정 누락은 Result err.
    const created = await buildActiveProvider()
    if (!created.ok) return created as Result<AgentRunRes>
    const provider = created.value

    // 2) tool-use 미지원 degradation(요청 즉시 거부 — 루프 시작 전 명확한 안내).
    if (!provider.capabilities.toolUse) {
      return err(
        fileOpError('EUNSUPPORTED', '이 모델은 도구 호출(function-calling)을 지원하지 않아 에이전트를 쓸 수 없습니다.')
      )
    }

    // 3) cwd·selection 을 guardPath 정규화 → 스코프 구성(스코프 밖은 도구 호출 시 거부).
    const guardedCwd = guardPath(req.context.cwd)
    if (!guardedCwd.ok) return guardedCwd as Result<AgentRunRes>
    const selection: string[] = []
    for (const s of req.context.selection) {
      const g = guardPath(s)
      if (g.ok) selection.push(g.value) // 잘못된 선택 항목은 스코프에서 제외(throw 0).
    }
    // 이름 있는 위치(§Z) 정규화 → 로컬 경로는 스코프 추가 루트(가상/시스템은 scope.ts 가 제외).
    const { locations, paths: locationPaths } = normalizeLocations(req.context.locations)
    const scope = buildScope(guardedCwd.value, selection, locationPaths)

    // 4) runId 발급 + 취소 핸들 등록 + 읽기 백엔드(실서비스) 구성.
    const runId = `agent-${Date.now()}-${runSeq++}`
    const controller = new AbortController()
    activeRuns.set(runId, controller)
    const sender = event.sender
    const backend = createReadBackend(createRealReadDeps(), controller.signal)

    const emit = (oe: OrchestratorEvent): void => {
      if (sender.isDestroyed()) return
      const ae = toAgentEvent(runId, oe)
      if (ae) sender.send(CHANNELS.AGENT_EVENT, ae)
    }

    // §Z open_tab — 비파괴 내비 액션을 렌더러로 디스패치(파일 미변경·확인 불요). 신규 채널 0
    // (기존 agent:event 재사용). 경로는 toolRegistry 가 guardPath+scope 통과시킨 정규화 로컬 경로.
    const dispatchAction = (action: { readonly action: 'open-tab'; readonly path: string }): void => {
      if (sender.isDestroyed()) return
      sender.send(CHANNELS.AGENT_EVENT, {
        type: 'action',
        runId,
        action: action.action,
        path: action.path
      } satisfies AgentEvent)
    }

    // 5) 하이브리드 루프를 비동기로 launch(요청은 runId 만 즉시 반환 — 진행은 agent:event 스트림).
    //    단순 질의는 내부에서 plan 우회(단일 ReAct·현 동작 동치)·다단계는 plan/step 이벤트 발생.
    void runHybrid(
      provider,
      {
        prompt: req.prompt,
        scope,
        contentConsent: req.contentConsent === true,
        backend,
        guardPath,
        locations,
        cwd: guardedCwd.value, // §Z 그라운딩 "현재 폴더" 줄(시스템 프롬프트 선주입·환각 경로 완화).
        dispatchAction,
        signal: controller.signal
      },
      emit
    )
      .catch((e: unknown) => {
        if (!sender.isDestroyed()) {
          // §Z 루프 밖으로 새는 예외도 정제 메시지로(추론 400 raw <think> 덤프 UI 비노출).
          // eslint-disable-next-line no-console
          console.error('[agent] run loop uncaught error:', e)
          const error = { ...toFileOpError(e), message: mapServerError(e) }
          sender.send(CHANNELS.AGENT_EVENT, { type: 'error', runId, error } satisfies AgentEvent)
        }
      })
      .finally(() => {
        activeRuns.delete(runId)
      })

    return ok({ runId })
  })
  handleGuarded(CHANNELS.AGENT_CONFIRM, zAgentConfirmReq, (): Result<AgentConfirmRes> =>
    // PlannedOp→ConfirmedOpDTO 정규화·confirm 재검증은 Z3(쓰기 스테이징 후) 배선.
    err(fileOpError('EUNSUPPORTED', '에이전트 확정 실행은 아직 배선되지 않았습니다(Z3).'))
  )
  handleGuarded(CHANNELS.AGENT_CANCEL, zAgentCancelReq, (req): Result<void> => {
    const ctrl = activeRuns.get(req.runId)
    if (ctrl) {
      ctrl.abort()
      activeRuns.delete(req.runId)
    }
    return ok(undefined)
  })
}
