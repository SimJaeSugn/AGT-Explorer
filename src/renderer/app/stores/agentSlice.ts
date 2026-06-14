/**
 * agentSlice — 자연어 파일 에이전트 실행 상태 (§Z Z1·US-24.x·ADR-014·ADR-015).
 *
 * 백엔드 `agent:run`(읽기 루프)이 발급한 runId 의 스트림 이벤트(thinking 텍스트·도구
 * 호출 로그·plan-ready=최종 답변·error)를 누적한다. Z1 은 **읽기 전용 Q&A** 라 plan
 * 배열은 비어 있고(plan diff·Confirm UI 없음), plan-ready 의 summary 가 최종 답변이다.
 *
 * 실제 IPC 호출·구독은 usecases/agent 가 담당하고(app→infra 경계), 이 슬라이스는
 * 데이터만 다룬다(searchSlice 동형 — Immer 슬라이스, 고빈도 아님). runId 상관 필터는
 * usecases/agent 가 수행하므로 슬라이스 액션은 "현재 활성 run" 만 반영한다.
 *
 * 보안: API 키는 이 슬라이스(렌더러 스토어)에 절대 보관하지 않는다 — 키는 keySet 호출
 * 인자로만 흐르고, 보유 여부는 keyHas 로 그때그때 조회한다(영속/로그 0).
 *
 * 상태머신: idle → running(runId·이벤트 적재) → done(summary) | error | canceled.
 */
import type { SliceCreator } from './types'

export type AgentRunStatus = 'idle' | 'running' | 'done' | 'error' | 'canceled'

/**
 * 장시간 도구의 라이브 진행(§Z 프리징 완화 — tool-progress). 스로틀된 누적 값이라
 * 자연스럽게 흐른다. 결과/제어와 무관(놓쳐도 안전).
 */
export interface AgentToolProgress {
  /** 누적 스캔 파일 수. */
  readonly scanned: number
  /** 누적 일치 파일 수. */
  readonly matched: number
  /** 현재 처리 중 경로(있을 때만). */
  readonly current?: string
}

/** 누적 스트림 항목 1개(타임라인 표시 — thinking 텍스트 또는 도구 호출 로그). */
export type AgentTimelineItem =
  | { readonly kind: 'thinking'; readonly text: string }
  | {
      readonly kind: 'tool'
      readonly tool: string
      readonly mode: 'read' | 'write' | 'navigate'
      readonly target?: string
      /** 라이브 진행(tool-progress 수신 시 갱신 — "멈춘 게 아님"을 표시). 도구 완료와 무관. */
      readonly progress?: AgentToolProgress
    }
  /** 비파괴 내비게이션 액션(§Z open_tab) — "🗂 새 탭: <path>" 표기. */
  | { readonly kind: 'nav'; readonly action: 'open-tab'; readonly path: string }

/** 추론 스텝 1개의 진행 상태(다단계 질의 체크리스트 — ADR-016). */
export type AgentStepPhase = 'pending' | 'start' | 'done' | 'failed'

/** 추론 계획의 스텝 1개(목표 + 진행 상태). */
export interface AgentPlanStep {
  readonly id: string
  readonly goal: string
  readonly phase: AgentStepPhase
}

export interface AgentSlice {
  /** 에이전트 패널 열림 여부(Z1 — 비모달 사이드 패널). */
  readonly agentPanelOpen: boolean
  /** 실행 상태머신. */
  readonly agentStatus: AgentRunStatus
  /** 진행 중 run 식별(agent:run 발급, 이벤트 상관). 없으면 null. */
  readonly agentRunId: string | null
  /** 사용자가 마지막으로 보낸 프롬프트(표시·재시도 기준). */
  readonly agentPrompt: string
  /** 입력창 초안(전송 전 편집 텍스트). */
  readonly agentDraft: string
  /** 파일 실내용 전송 동의(SG-4·기본 false=경로/메타만). */
  readonly agentContentConsent: boolean
  /** 스트림 타임라인(thinking·도구 호출 누적, 시간순). */
  readonly agentTimeline: AgentTimelineItem[]
  /** 최종 답변(plan-ready.summary). 없으면 null. */
  readonly agentAnswer: string | null
  /** 답변이 길이 한계로 잘렸는지(정직 표기·plan-ready.truncated). */
  readonly agentTruncated: boolean
  /** 오류 메시지(없으면 null). */
  readonly agentError: string | null
  /**
   * 추론 계획 스텝 목록(다단계 질의 — ADR-016). 빈 배열=plan 미수신(단순 질의·기존 UI 유지).
   * plan 이벤트 수신 시 채워지고, step 이벤트로 각 스텝 phase 가 갱신된다.
   */
  readonly agentPlan: AgentPlanStep[]
  /** 재계획 횟수(0=최초 계획). plan 이벤트의 replanCount. */
  readonly agentReplanCount: number

  // 패널 열기/닫기 ───────────────────────────────────────────────────────────
  /** 에이전트 패널 토글(비모달 — inputContext 미관여). */
  toggleAgentPanel(): void
  /** 에이전트 패널 열기. */
  openAgentPanel(): void
  /** 에이전트 패널 닫기. */
  closeAgentPanel(): void

  // 입력 폼 ─────────────────────────────────────────────────────────────────
  setAgentDraft(text: string): void
  setAgentContentConsent(v: boolean): void

  // usecase 브리지(usecases/agent 가 호출) ───────────────────────────────────
  /** 실행 시작(runId·prompt 보관·상태 running·이전 결과 비움). */
  beginAgentRun(runId: string, prompt: string): void
  /** thinking 텍스트 누적(agent:event thinking). */
  _agentThinking(text: string): void
  /** 도구 호출 로그 누적(agent:event tool-call). */
  _agentToolCall(tool: string, mode: 'read' | 'write' | 'navigate', target?: string): void
  /**
   * 장시간 도구 라이브 진행 반영(agent:event tool-progress). 가장 최근의 일치하는
   * 도구 호출 항목에 progress 를 갱신한다 — 패널이 "N개 검색·M 일치·현재경로" 로 라이브
   * 표시("프리징" 오인 방지). 스로틀된 누적 값(놓쳐도 안전).
   */
  _agentToolProgress(tool: string, progress: AgentToolProgress): void
  /** 내비게이션 액션 로그 누적(agent:event action — open-tab). */
  _agentNav(action: 'open-tab', path: string): void
  /** 계획 수립/재계획(agent:event plan) — 스텝 목록을 pending 으로 세팅·replanCount 갱신. */
  _agentPlan(steps: ReadonlyArray<{ id: string; goal: string }>, replanCount: number): void
  /** 스텝 진행(agent:event step) — 해당 stepId 의 phase 갱신(start/done/failed). */
  _agentStep(stepId: string, phase: 'start' | 'done' | 'failed'): void
  /** 완료(agent:event plan-ready) — status=done·최종 답변·절단 표기. */
  _agentDone(summary: string, truncated: boolean): void
  /** 오류(시작 실패 또는 agent:event error). */
  _agentError(message: string): void
  /** 취소 표시(agent:cancel 호출 후). */
  markAgentCanceling(): void
  /** 결과/타임라인 초기화(패널 내 "지우기"). 폼/동의는 유지. */
  clearAgent(): void
}

export const createAgentSlice: SliceCreator<AgentSlice> = (set) => ({
  agentPanelOpen: false,
  agentStatus: 'idle',
  agentRunId: null,
  agentPrompt: '',
  agentDraft: '',
  agentContentConsent: false,
  agentTimeline: [],
  agentAnswer: null,
  agentTruncated: false,
  agentError: null,
  agentPlan: [],
  agentReplanCount: 0,

  toggleAgentPanel() {
    set((s) => {
      s.agentPanelOpen = !s.agentPanelOpen
    })
  },
  openAgentPanel() {
    set((s) => {
      s.agentPanelOpen = true
    })
  },
  closeAgentPanel() {
    set((s) => {
      s.agentPanelOpen = false
    })
  },

  setAgentDraft(text) {
    set((s) => {
      s.agentDraft = text
    })
  },
  setAgentContentConsent(v) {
    set((s) => {
      s.agentContentConsent = v
    })
  },

  beginAgentRun(runId, prompt) {
    set((s) => {
      s.agentStatus = 'running'
      s.agentRunId = runId
      s.agentPrompt = prompt
      s.agentTimeline = []
      s.agentAnswer = null
      s.agentTruncated = false
      s.agentError = null
      s.agentPlan = []
      s.agentReplanCount = 0
    })
  },

  _agentThinking(text) {
    set((s) => {
      if (s.agentStatus !== 'running') return
      s.agentTimeline.push({ kind: 'thinking', text })
    })
  },

  _agentToolCall(tool, mode, target) {
    set((s) => {
      if (s.agentStatus !== 'running') return
      s.agentTimeline.push(
        target === undefined ? { kind: 'tool', tool, mode } : { kind: 'tool', tool, mode, target }
      )
    })
  },

  _agentToolProgress(tool, progress) {
    set((s) => {
      if (s.agentStatus !== 'running') return
      // 가장 최근의 일치하는 도구 호출 항목을 뒤에서 찾아 progress 갱신(같은 tool 의
      // 진행을 그 호출 라인에 반영). 일치 항목이 없으면 무시(놓쳐도 안전 — 통지일 뿐).
      for (let i = s.agentTimeline.length - 1; i >= 0; i--) {
        const item = s.agentTimeline[i]
        if (item.kind === 'tool' && item.tool === tool) {
          item.progress = progress
          return
        }
      }
    })
  },

  _agentNav(action, path) {
    set((s) => {
      if (s.agentStatus !== 'running') return
      s.agentTimeline.push({ kind: 'nav', action, path })
    })
  },

  _agentPlan(steps, replanCount) {
    set((s) => {
      if (s.agentStatus !== 'running') return
      // 재계획 시 기존 스텝의 진행 상태는 버리고 새 계획으로 교체(전부 pending).
      s.agentPlan = steps.map((st) => ({ id: st.id, goal: st.goal, phase: 'pending' }))
      s.agentReplanCount = replanCount
    })
  },

  _agentStep(stepId, phase) {
    set((s) => {
      if (s.agentStatus !== 'running') return
      const step = s.agentPlan.find((st) => st.id === stepId)
      if (step) step.phase = phase
    })
  },

  _agentDone(summary, truncated) {
    set((s) => {
      if (s.agentStatus !== 'running') return
      s.agentStatus = 'done'
      s.agentRunId = null
      s.agentAnswer = summary
      s.agentTruncated = truncated
    })
  },

  _agentError(message) {
    set((s) => {
      s.agentStatus = 'error'
      s.agentRunId = null
      s.agentError = message
    })
  },

  markAgentCanceling() {
    set((s) => {
      if (s.agentStatus === 'running') {
        s.agentStatus = 'canceled'
        s.agentRunId = null
      }
    })
  },

  clearAgent() {
    set((s) => {
      s.agentStatus = 'idle'
      s.agentRunId = null
      s.agentPrompt = ''
      s.agentTimeline = []
      s.agentAnswer = null
      s.agentTruncated = false
      s.agentError = null
      s.agentPlan = []
      s.agentReplanCount = 0
    })
  }
})
