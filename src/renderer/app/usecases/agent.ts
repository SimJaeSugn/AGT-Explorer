/**
 * 자연어 파일 에이전트 유스케이스 (app/usecases/agent) — 실행·구독·취소·제공자 설정
 * (§Z Z1·US-24.x·ADR-014·ADR-015).
 *
 * 백엔드 `agent:run`(읽기 루프)으로 활성 패널 폴더(context.cwd)·선택(selection)을 컨텍스트로
 * 전달하고, agent:event 스트림(thinking·tool-call·plan-ready=최종 답변·error)을 runId 상관
 * 필터로 agentSlice 에 누적한다. Z1 은 **읽기 전용 Q&A** — plan diff·Confirm/Execute 없음
 * (plan 배열은 비고 plan-ready.summary 가 최종 답변).
 *
 * 경계: app → infra/api(agentApi·subscribeAgentEvents) 직접 호출(.eslintrc 허용). ui 는 이
 * 모듈을 경유하며 SDK/네트워크를 직접 import 하지 않는다(계층 경계).
 *
 * 보안: API 키는 keySet 인자로만 흐른다 — 렌더러 스토어/로그에 평문 보관 0(keyHas 로 보유
 * 여부만 조회). 제공자 비-비밀 설정은 providerSet 으로 backend providerConfigStore 에 영속
 * (신규 SESSION_SCHEMA 0).
 */
import { agentApi, fsApi, subscribeAgentEvents } from '@renderer/infra/api'
import { store } from '@renderer/app/stores/rootStore'
import { baseName } from '@renderer/domain/paths'
import type {
  AgentLocationItem,
  AgentLocations,
  AgentPanelLocation,
  ProviderConfig,
  ProviderId
} from '@shared/dto'

/** 활성 패널의 현재 폴더(context.cwd). 없으면 빈 문자열(backend 가 검증). */
function activeCwd(): string {
  const s = store.getState()
  const pid = s.activePanelId()
  if (!pid) return ''
  return s.panels[pid]?.path ?? ''
}

/** 활성 패널의 현재 선택 경로 배열(context.selection). 없으면 빈 배열. */
function activeSelection(): string[] {
  const s = store.getState()
  const pid = s.activePanelId()
  if (!pid) return []
  const sel = s.selection[pid]
  if (!sel) return []
  return [...sel.selectedPaths]
}

/**
 * 이름 있는 위치 모음 수집(§Z — `AgentRunReq.context.locations`). 순수 store 읽기로
 * 즐겨찾기·빠른위치·최근·드라이브·패널을 모은다(부수효과·신규 IPC 없음). 각 카테고리는
 * 비면 생략(undefined) — main 의 list_locations 가 패스스루로 반환한다. 경로는 원본
 * 그대로 전달(main 이 guardPath 정규화·가상경로 보존).
 *
 * drives 는 analyzeSlice 의 동기 캐시(s.drives)에서 읽는다. 호출 전 runAgent 가
 * ensureDrivesLoaded() 로 1회 prefetch 하므로(골든 "E: 드라이브" 전제), 정상 경로에서는
 * 항상 채워져 있다. prefetch 실패 시엔 비어 있을 수 있고, 그 경우 drives 를 생략한다(안전 폴백).
 */
function gatherLocations(): AgentLocations | undefined {
  const s = store.getState()
  const out: {
    favorites?: AgentLocationItem[]
    quickAccess?: AgentLocationItem[]
    recent?: AgentLocationItem[]
    drives?: AgentLocationItem[]
    panels?: AgentPanelLocation[]
  } = {}

  // 즐겨찾기: 별칭(favoriteLabels) 우선, 없으면 폴더명 폴백.
  if (s.favorites.length > 0) {
    out.favorites = s.favorites.map((p) => ({
      name: s.favoriteLabels[p] ?? baseName(p),
      path: p
    }))
  }

  // 빠른 위치: knownFolders(다운로드/바탕화면/문서/홈). 빈 문자열 경로는 스킵.
  const kf = s.knownFolders
  if (kf) {
    const quick = [
      { name: '다운로드', path: kf.downloads },
      { name: '바탕화면', path: kf.desktop },
      { name: '문서', path: kf.documents },
      { name: '홈', path: kf.home }
    ].filter((q) => q.path !== '')
    if (quick.length > 0) out.quickAccess = quick
  }

  // 최근 방문: 폴더명.
  if (s.recent.length > 0) {
    out.recent = s.recent.map((p) => ({ name: baseName(p), path: p }))
  }

  // 드라이브: 동기 캐시(runAgent 가 ensureDrivesLoaded 로 prefetch). 비면 생략(안전 폴백).
  if (s.drives.length > 0) {
    out.drives = s.drives.map((d) => ({ name: d.label, path: d.path }))
  }

  // 패널: 활성 탭의 panelIds 를 1-based 로(패널 1~4).
  const tab = s.tabs[s.activeTabId]
  if (tab) {
    const activePid = s.activePanelId()
    const panels = tab.panelIds
      .map((pid, i): AgentPanelLocation | null => {
        const panel = s.panels[pid]
        if (!panel) return null
        return { index: i + 1, path: panel.path, active: pid === activePid }
      })
      .filter((x): x is AgentPanelLocation => x !== null)
    if (panels.length > 0) out.panels = panels
  }

  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * 드라이브 캐시 보장(골든 "E: 드라이브" 전제) — 캐시(s.drives)가 비어 있으면 fs:drives 를
 * 1회 로드해 setDrives 로 캐시한다(이미 차 있으면 즉시 반환·재호출 없음). 모든 에이전트 run 의
 * context.locations.drives 에 드라이브 루트(E:\ 등)가 포함되어 backend buildScope 가 이를 스코프
 * 루트로 추가하게 한다. 로드 실패는 조용히 무시 — gatherLocations 가 drives 를 생략(안전 폴백).
 * 신규 IPC 없음(기존 fs:drives 재사용).
 */
async function ensureDrivesLoaded(): Promise<void> {
  if (store.getState().drives.length > 0) return
  const res = await fsApi.drives()
  if (res.ok && res.value.length > 0) store.getState().setDrives(res.value)
}

/**
 * 에이전트 패널 열기 — 키/도구 지원 안내는 패널 내부(AgentPanel)가 providerGet/keyHas/probe
 * 로 그때그때 판단한다(여기서는 패널만 띄운다).
 */
export function openAgentPanel(): void {
  store.getState().openAgentPanel()
}

/** 에이전트 패널 토글(명령 팔레트·사이드바 버튼 공용 진입점). */
export function toggleAgentPanel(): void {
  store.getState().toggleAgentPanel()
}

/**
 * 에이전트 실행 — 현재 입력 초안(또는 인자 prompt)으로 agent:run.
 * context.cwd=활성 패널 경로·selection=활성 패널 선택. contentConsent=동의 토글.
 * 진행 중 run 이 있으면 먼저 취소한다(중복 방지). 빈 프롬프트는 무시.
 */
export async function runAgent(promptArg?: string): Promise<void> {
  const s = store.getState()
  const prompt = (promptArg ?? s.agentDraft).trim()
  if (prompt === '') return

  // 진행 중 run 선취소(중복 방지).
  if (s.agentRunId && s.agentStatus === 'running') {
    await agentApi.cancel(s.agentRunId)
  }

  // 드라이브를 컨텍스트에 항상 제공(골든 "E: 드라이브" 전제) — 캐시 우선·비면 1회 prefetch.
  await ensureDrivesLoaded()

  const locations = gatherLocations()
  const res = await agentApi.run({
    prompt,
    context: { cwd: activeCwd(), selection: activeSelection(), ...(locations ? { locations } : {}) },
    contentConsent: s.agentContentConsent
  })
  if (!res.ok) {
    store.getState()._agentError(res.error.message ?? '에이전트를 시작하지 못했습니다.')
    return
  }
  store.getState().beginAgentRun(res.value.runId, prompt)
}

/** 진행 중 run 협조취소. runId 없으면 무시. */
export async function cancelAgent(): Promise<void> {
  const s = store.getState()
  if (!s.agentRunId || s.agentStatus !== 'running') return
  const runId = s.agentRunId
  s.markAgentCanceling()
  await agentApi.cancel(runId)
}

// ── 제공자/키 설정 헬퍼(ProviderSettings UI 가 호출) ───────────────────────────
// 모두 thin wrapper — 비밀(apiKey)은 keySet 인자로만 흐르고 응답/스토어에 미수록.

export async function getProvider(): ReturnType<typeof agentApi.providerGet> {
  return agentApi.providerGet()
}
export async function setProvider(config: ProviderConfig): Promise<boolean> {
  const res = await agentApi.providerSet(config)
  if (!res.ok) {
    store.getState().pushToast('error', res.error.message ?? '제공자 설정을 저장하지 못했습니다.')
    return false
  }
  return true
}
export async function listModels(id: ProviderId): ReturnType<typeof agentApi.providerModels> {
  return agentApi.providerModels(id)
}
export async function probeProvider(id: ProviderId): ReturnType<typeof agentApi.providerProbe> {
  return agentApi.providerProbe(id)
}
export async function setApiKey(provider: ProviderId, apiKey: string): Promise<boolean> {
  const res = await agentApi.keySet(provider, apiKey)
  if (!res.ok) {
    store.getState().pushToast('error', res.error.message ?? 'API 키를 저장하지 못했습니다.')
    return false
  }
  return true
}
export async function hasApiKey(provider: ProviderId): Promise<boolean> {
  const res = await agentApi.keyHas(provider)
  return res.ok ? res.value.has : false
}

// ── internal SSRF 화이트리스트 관리(AgentSettings UI 가 호출) ──────────────────
// 추가/삭제는 thin wrapper — 거부 사유(사설/loopback/링크로컬 등)는 Result.error 로
// 그대로 흐른다(UI 가 인라인 표시). 목록 새로고침은 getProvider().allowedInternalHosts.

/** internal 화이트리스트에 호스트(URL) 추가. 거부 시 err(메시지 포함). */
export async function addInternalHost(url: string): ReturnType<typeof agentApi.internalHostAdd> {
  return agentApi.internalHostAdd(url)
}
/** internal 화이트리스트에서 호스트 삭제(URL/정규화 키 둘 다 수용). 없으면 ENOENT. */
export async function removeInternalHost(
  host: string
): ReturnType<typeof agentApi.internalHostRemove> {
  return agentApi.internalHostRemove(host)
}

let disposer: (() => void) | null = null

/**
 * agent:event 전역 구독 시작(중복 호출 무시). runId 가 현재 활성 run 과 일치하는
 * 이벤트만 슬라이스에 반영(상관 필터) — 취소·교체된 run 의 잔여 이벤트 격리.
 * Z1 읽기 전용: plan-add(쓰기 op 적재)는 무시한다(diff UI 없음·Z2 인계).
 */
export function initAgentBridge(): void {
  if (disposer) return
  disposer = subscribeAgentEvents({
    onThinking: (runId, text) => {
      const s = store.getState()
      if (runId !== s.agentRunId) return
      s._agentThinking(text)
    },
    onToolCall: (evt) => {
      const s = store.getState()
      if (evt.runId !== s.agentRunId) return
      s._agentToolCall(evt.tool, evt.mode, evt.target)
    },
    onToolProgress: (evt) => {
      // §Z 라이브 진행: 장시간 도구(search_content 등)의 스로틀된 누적 진행을 현재 도구 호출
      // 라인에 반영한다("프리징" 오인 방지). runId 상관 필터로 취소/교체된 run 의 잔여 진행을
      // 격리. 놓쳐도 안전(통지일 뿐 — 결과/제어와 무관).
      const s = store.getState()
      if (evt.runId !== s.agentRunId) return
      s._agentToolProgress(evt.tool, {
        scanned: evt.scanned,
        matched: evt.matched,
        ...(evt.current !== undefined ? { current: evt.current } : {})
      })
    },
    onAction: (evt) => {
      // §Z open_tab: 비파괴 내비(파일 미변경·확인 불요). runId 상관 필터로 취소/교체된
      // run 의 잔여 액션을 격리한 뒤, 새 탭을 path 로 열고(이동) 타임라인에 표기한다.
      const s = store.getState()
      if (evt.runId !== s.agentRunId) return
      if (evt.action === 'open-tab') {
        s.newTab(evt.path)
        s._agentNav('open-tab', evt.path)
      }
    },
    onPlan: (evt) => {
      // 추론 계획 수립/재계획(다단계 질의 — ADR-016). 단순 질의에선 미발생.
      const s = store.getState()
      if (evt.runId !== s.agentRunId) return
      s._agentPlan(evt.steps, evt.replanCount)
    },
    onStep: (evt) => {
      // 추론 스텝 진행(start/done/failed). stepId 로 해당 스텝 phase 갱신.
      const s = store.getState()
      if (evt.runId !== s.agentRunId) return
      s._agentStep(evt.stepId, evt.phase)
    },
    onPlanReady: (evt) => {
      const s = store.getState()
      if (evt.runId !== s.agentRunId) return
      // Z1: 쓰기 plan 은 항상 빈 배열. summary 가 최종 답변(추론 plan 과 별개).
      s._agentDone(evt.summary, evt.truncated)
    },
    onError: (evt) => {
      const s = store.getState()
      if (evt.runId !== s.agentRunId) return
      s._agentError(evt.error.message ?? '에이전트 실행 중 오류가 발생했습니다.')
    }
  })
}

/** 구독 해제(테스트·HMR). */
export function disposeAgentBridge(): void {
  if (disposer) {
    disposer()
    disposer = null
  }
}
