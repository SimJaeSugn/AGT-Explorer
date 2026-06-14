/**
 * AgentPanel — 자연어 파일 에이전트 패널 (§Z Z1 — 읽기 전용 Q&A·US-24.x).
 *
 * 우측에 도킹되는 **비모달** 사이드 패널(앱 사용을 막지 않음). 자연어 입력창 +
 * 실행/취소 버튼 + 스트림 표시(thinking 텍스트·"🔧 도구: list_directory(경로)" 식 도구
 * 호출 로그·최종 답변)로 구성된다. **읽기 전용** 이라 plan diff·확인/실행 버튼이 없다
 * (Z2~Z3 인계 — 아래 "Z2 인계" 자리 주석 참조).
 *
 * 진입: 명령 팔레트 "✨ 에이전트에게 묻기"(commandId agent.ask·Ctrl+Shift+A) 또는
 * 사이드바 하단 버튼 → openAgentPanel. 실행 시 활성 패널 경로=context.cwd·선택=selection
 * 을 usecases/agent 가 자동 전달한다.
 *
 * 키/도구 안내: 마운트 시 providerGet/keyHas/probe 로 (1) 키 미보유 또는 (2) toolUse:false
 * 면 설정("AI 에이전트" 카테고리)으로 유도하는 배너를 띄운다(차단은 아님 — backend 가
 * 최종 검증).
 *
 * 경계: ui → app(usecases/agent)·SDK/네트워크 직접 import 0. 토큰/스타일은 기존 패널 일치.
 */
import { useEffect, useRef, useState } from 'react'
import type { ProviderId } from '@shared/dto'
import type { AgentPlanStep, AgentStepPhase, AgentTimelineItem } from '@renderer/app/stores/agentSlice'
import { useRootStore } from '@renderer/app/stores/rootStore'
import {
  cancelAgent,
  getProvider,
  hasApiKey,
  probeProvider,
  runAgent
} from '@renderer/app/usecases/agent'
import { tokens } from '@renderer/ui/theme/tokens'
import { btn } from '@renderer/ui/dialogs/dialogStyles'

/** 패널 폭(고정 — 미리보기와 별개 도킹). */
const PANEL_WIDTH = 360

/** 천단위 구분 정수 표기(라이브 진행 가독성 — 한국 로캘). */
function fmtCount(n: number): string {
  return n.toLocaleString('ko-KR')
}

/**
 * 인접한 thinking 델타를 한 문단으로 합친다(스트리밍 토큰 단편화 보정).
 * 도구 호출 항목은 그대로 두고 경계로 작동한다(새 thinking 블록 시작·라이브 progress 보존).
 * 순수 함수 — 입력 배열을 변형하지 않는다(슬라이스/계약 무변경, 렌더 계층 전용).
 */
function coalesceTimeline(items: readonly AgentTimelineItem[]): AgentTimelineItem[] {
  const out: AgentTimelineItem[] = []
  for (const item of items) {
    const last = out[out.length - 1]
    if (item.kind === 'thinking' && last?.kind === 'thinking') {
      out[out.length - 1] = { kind: 'thinking', text: last.text + item.text }
    } else {
      out.push(item)
    }
  }
  return out
}

/** 추론 스텝 진행 상태 → 표시 글리프(▢ 대기·⏳ 진행·✅ 완료·⚠️ 실패). */
const STEP_GLYPH: Record<AgentStepPhase, string> = {
  pending: '▢',
  start: '⏳',
  done: '✅',
  failed: '⚠️'
}

/**
 * 추론 계획 체크리스트(다단계 질의) — 스텝별 목표 + 진행 글리프. 타임라인 위에 표시한다.
 * 재계획 시 replanCount>0 면 "재계획 N회" 배지를 함께 보인다. 순수 표시 컴포넌트.
 */
function PlanChecklist({
  steps,
  replanCount
}: {
  readonly steps: readonly AgentPlanStep[]
  readonly replanCount: number
}): JSX.Element {
  const doneCount = steps.filter((s) => s.phase === 'done').length
  return (
    <div
      aria-label="추론 계획"
      style={{
        marginBottom: 10,
        padding: '8px 10px',
        border: `1px solid ${tokens.color.border}`,
        borderRadius: 8,
        background: tokens.color.bgAlt
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginBottom: 6,
          fontSize: 12,
          fontWeight: 600,
          color: tokens.color.text
        }}
      >
        <span aria-hidden>🧭</span>
        <span>
          계획 ({doneCount}/{steps.length})
        </span>
        {replanCount > 0 && (
          <span
            style={{
              marginLeft: 'auto',
              fontSize: 11,
              fontWeight: 400,
              color: tokens.color.textMuted
            }}
          >
            재계획 {replanCount}회
          </span>
        )}
      </div>
      <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {steps.map((step) => (
          <li
            key={step.id}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 6,
              fontSize: 12,
              lineHeight: 1.5,
              color: step.phase === 'failed' ? tokens.color.danger : tokens.color.text,
              opacity: step.phase === 'pending' ? 0.6 : 1
            }}
          >
            <span aria-hidden style={{ flex: '0 0 auto' }}>
              {STEP_GLYPH[step.phase]}
            </span>
            <span
              style={{
                wordBreak: 'break-word',
                textDecoration: step.phase === 'done' ? 'line-through' : 'none'
              }}
            >
              {step.goal}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}

/** 제공자 준비 상태(키·도구 지원 안내 판정). */
interface Readiness {
  readonly hasKey: boolean
  readonly toolUse: boolean
  readonly providerId: ProviderId
}

export function AgentPanel(): JSX.Element | null {
  const open = useRootStore((s) => s.agentPanelOpen)
  const close = useRootStore((s) => s.closeAgentPanel)
  const status = useRootStore((s) => s.agentStatus)
  const prompt = useRootStore((s) => s.agentPrompt)
  const draft = useRootStore((s) => s.agentDraft)
  const setDraft = useRootStore((s) => s.setAgentDraft)
  const consent = useRootStore((s) => s.agentContentConsent)
  const setConsent = useRootStore((s) => s.setAgentContentConsent)
  const timeline = useRootStore((s) => s.agentTimeline)
  const plan = useRootStore((s) => s.agentPlan)
  const replanCount = useRootStore((s) => s.agentReplanCount)
  const answer = useRootStore((s) => s.agentAnswer)
  const truncated = useRootStore((s) => s.agentTruncated)
  const error = useRootStore((s) => s.agentError)
  const clearAgent = useRootStore((s) => s.clearAgent)
  const openSettings = useRootStore((s) => s.openSettings)

  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const streamRef = useRef<HTMLDivElement | null>(null)
  const [readiness, setReadiness] = useState<Readiness | null>(null)

  const running = status === 'running'

  // 패널이 열릴 때마다 제공자 준비 상태(키·도구 지원) 재조회 + 입력 포커스.
  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    let alive = true
    void (async () => {
      const res = await getProvider()
      if (!alive || !res.ok) return
      const id = res.value.active.id
      const [hasKey, probe] = await Promise.all([hasApiKey(id), probeProvider(id)])
      if (!alive) return
      setReadiness({ hasKey, toolUse: probe.ok ? probe.value.toolUse : false, providerId: id })
    })()
    return () => {
      alive = false
    }
  }, [open])

  // 새 스트림 항목·답변 도착 시 자동 스크롤(맨 아래 추종).
  useEffect(() => {
    const el = streamRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [timeline.length, answer, error])

  if (!open) return null

  const canSend = draft.trim() !== '' && !running

  function submit(): void {
    if (!canSend) return
    void runAgent()
  }

  function onInputKeyDown(e: React.KeyboardEvent): void {
    // Esc = 패널 닫기. Enter = 전송(Shift+Enter 는 줄바꿈). 전역 단축키와 격리(stopPropagation).
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  // internal(OpenAI 호환·로컬 LLM, 예: LM Studio)은 API 키가 선택이다 — backend 가 키
  // 미보유 시 플레이스홀더로 동작하므로, 활성 제공자가 internal 이면 "키 미설정" 경고를
  // 띄우지 않는다(차단성 배너 오인 방지). anthropic/openai 는 기존대로 키 필수 → 경고 유지.
  // 도구 미지원(toolUse=false) 경고는 제공자 무관 정상 안내라 그대로 유지한다.
  const keyMissing = readiness !== null && !readiness.hasKey && readiness.providerId !== 'internal'
  const needsSetup = readiness !== null && (keyMissing || !readiness.toolUse)

  return (
    <aside
      aria-label="AI 에이전트"
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: PANEL_WIDTH,
        maxWidth: '92vw',
        zIndex: 1050,
        display: 'flex',
        flexDirection: 'column',
        background: tokens.color.bg,
        borderLeft: `1px solid ${tokens.color.borderStrong}`,
        boxShadow: '-8px 0 24px rgba(0,0,0,0.18)',
        color: tokens.color.text,
        fontFamily: tokens.font
      }}
      onKeyDown={(e) => {
        // 패널 내부의 키 입력이 전역 디스패처로 새지 않도록 격리(타이핑 보존).
        e.stopPropagation()
      }}
    >
      {/* 헤더 */}
      <div
        style={{
          flex: '0 0 auto',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 12px',
          borderBottom: `1px solid ${tokens.color.border}`
        }}
      >
        <span aria-hidden style={{ fontSize: 16 }}>
          ✨
        </span>
        <strong style={{ fontSize: 14 }}>에이전트에게 묻기</strong>
        <span style={{ fontSize: 11, color: tokens.color.textMuted }}>읽기 전용</span>
        <button
          onClick={() => openSettings('agent')}
          title="AI 에이전트 설정(제공자·키·모델)"
          aria-label="AI 에이전트 설정 열기"
          style={{
            marginLeft: 'auto',
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            fontSize: 15,
            color: tokens.color.textMuted
          }}
        >
          ⚙
        </button>
        <button
          onClick={close}
          aria-label="에이전트 패널 닫기"
          style={{
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            fontSize: 16,
            color: tokens.color.text
          }}
        >
          ✕
        </button>
      </div>

      {/* 키/도구 미충족 안내 배너 → 설정 유도 */}
      {needsSetup && (
        <div
          role="status"
          style={{
            flex: '0 0 auto',
            margin: '10px 12px 0',
            padding: '8px 10px',
            border: `1px solid ${tokens.color.accentBorder}`,
            borderRadius: 6,
            background: tokens.color.bgAlt,
            fontSize: 12,
            lineHeight: 1.5
          }}
        >
          {keyMissing
            ? 'API 키가 설정되어 있지 않습니다. '
            : '선택한 제공자/모델이 도구 호출(tool-use)을 지원하지 않습니다. '}
          <button
            onClick={() => openSettings('agent')}
            style={{
              border: 'none',
              background: 'transparent',
              color: tokens.color.accent,
              cursor: 'pointer',
              textDecoration: 'underline',
              fontSize: 12,
              padding: 0
            }}
          >
            설정 열기
          </button>
        </div>
      )}

      {/* 스트림(thinking·도구 호출·최종 답변) */}
      <div
        ref={streamRef}
        aria-live="polite"
        aria-label="에이전트 응답"
        style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '10px 12px', fontSize: 13 }}
      >
        {/* 추론 계획 체크리스트(다단계 질의 — ADR-016). plan 미수신(단순 질의)이면 비노출(비파괴). */}
        {plan.length > 0 && (
          <PlanChecklist steps={plan} replanCount={replanCount} />
        )}

        {status === 'idle' && timeline.length === 0 && answer === null && error === null && (
          <div style={{ color: tokens.color.textMuted, fontSize: 12, lineHeight: 1.6 }}>
            현재 폴더와 선택 항목에 대해 자연어로 물어보세요. 예: &ldquo;이 폴더에서 가장 큰 파일
            5개는?&rdquo;, &ldquo;이름에 report 가 들어간 파일을 찾아줘&rdquo;. 읽기 전용이라 파일을
            변경하지 않습니다.
          </div>
        )}

        {prompt !== '' && (
          <div
            style={{
              alignSelf: 'flex-end',
              marginBottom: 10,
              padding: '6px 10px',
              borderRadius: 8,
              background: tokens.color.bgSelected,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word'
            }}
          >
            {prompt}
          </div>
        )}

        {/* thinking·도구 호출 타임라인.
            백엔드 thinking 은 토큰(text_delta) 단위로 스트리밍되므로, 인접한 thinking
            조각은 하나의 흐르는 문단으로 합쳐 렌더한다(델타마다 줄바꿈/박스 분리 방지 —
            버퍼링/단편화 보정). 도구 호출은 경계가 되어 새 thinking 블록을 시작한다. */}
        {coalesceTimeline(timeline).map((item, i) => {
          if (item.kind === 'thinking') {
            return (
              <div
                key={i}
                style={{
                  marginBottom: 6,
                  color: tokens.color.textMuted,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word'
                }}
              >
                {item.text}
              </div>
            )
          }
          if (item.kind === 'nav') {
            // §Z open_tab — 비파괴 내비 액션(새 탭 열기). 도구 호출과 시간순 일관되게,
            // 그러나 별도 표기로 구분(파일 변경 아님을 사용자에게 명확히).
            return (
              <div
                key={i}
                style={{
                  marginBottom: 6,
                  fontSize: 12,
                  fontFamily: 'monospace',
                  color: tokens.color.accent
                }}
                title={item.path}
              >
                🗂 새 탭: {item.path}
              </div>
            )
          }
          // 라이브 진행(tool-progress)이 있으면 도구 라인을 "N개 검색 · M 일치 · 현재경로"
          // 로 갱신한다 — 장시간 도구가 "멈춘 게 아님"을 보여준다(스로틀 누적값이라 자연스러움).
          const prog = item.progress
          return (
            <div
              key={i}
              style={{
                marginBottom: 6,
                fontSize: 12,
                fontFamily: 'monospace',
                color: item.mode === 'write' ? tokens.color.danger : tokens.color.textMuted
              }}
              title={prog?.current ?? item.target}
            >
              🔧 도구: {item.tool}
              {prog !== undefined ? (
                <>
                  : {fmtCount(prog.scanned)}개 검색 · {fmtCount(prog.matched)} 일치
                  {prog.current !== undefined && prog.current !== '' && (
                    <span
                      style={{
                        display: 'block',
                        marginTop: 2,
                        color: tokens.color.textMuted,
                        opacity: 0.85,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      ↳ {prog.current}
                    </span>
                  )}
                </>
              ) : item.target !== undefined ? (
                `(${item.target})`
              ) : (
                '()'
              )}
            </div>
          )
        })}

        {running && (
          <div style={{ color: tokens.color.textMuted, fontSize: 12, marginTop: 4 }}>
            생각하는 중…
          </div>
        )}

        {/* 최종 답변(plan-ready.summary) */}
        {answer !== null && (
          <div
            style={{
              marginTop: 10,
              padding: '8px 10px',
              borderRadius: 8,
              border: `1px solid ${tokens.color.border}`,
              background: tokens.color.bgAlt,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              lineHeight: 1.6
            }}
          >
            {answer}
            {truncated && (
              <div style={{ marginTop: 6, fontSize: 11, color: tokens.color.textMuted }}>
                ⚠ 답변이 길이 제한으로 일부 잘렸습니다.
              </div>
            )}
          </div>
        )}

        {status === 'canceled' && (
          <div style={{ marginTop: 8, fontSize: 12, color: tokens.color.textMuted }}>
            실행을 취소했습니다.
          </div>
        )}

        {error !== null && (
          <div
            role="alert"
            style={{
              marginTop: 10,
              padding: '8px 10px',
              borderRadius: 8,
              border: `1px solid ${tokens.color.danger}`,
              color: tokens.color.danger,
              fontSize: 12,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word'
            }}
          >
            {error}
          </div>
        )}

        {/* ── Z2 인계 자리 ──────────────────────────────────────────────────
            쓰기 에이전트(Z2~Z3)에서는 여기 아래에 PlannedOp diff 목록 + 부분 수용
            체크박스 + "확정 실행" 버튼을 배치한다. Z1 은 읽기 전용이라 plan 이 항상
            비어 있어(plan-ready.plan=[]) 렌더링하지 않는다(agentSlice 미보유). */}
      </div>

      {/* 입력 영역 */}
      <div
        style={{
          flex: '0 0 auto',
          borderTop: `1px solid ${tokens.color.border}`,
          padding: '10px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8
        }}
      >
        {/* SG-4 내용 전송 동의 토글(기본 off=경로·메타만) */}
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12,
            color: tokens.color.textMuted
          }}
          title="켜면 질문에 필요한 파일의 실제 내용을 제공자에게 전송할 수 있습니다(외부 전송·BYO 키·과금은 사용자 책임)."
        >
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            aria-label="파일 내용 포함 전송 동의"
          />
          파일 내용 포함(기본: 경로·메타만)
        </label>

        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onInputKeyDown}
          placeholder="현재 폴더에 대해 물어보세요… (Enter 전송 · Shift+Enter 줄바꿈)"
          aria-label="에이전트 질문 입력"
          rows={3}
          spellCheck={false}
          style={{
            resize: 'vertical',
            minHeight: 56,
            border: `1px solid ${tokens.color.border}`,
            borderRadius: 6,
            background: tokens.color.bg,
            color: tokens.color.text,
            fontSize: 13,
            fontFamily: tokens.font,
            padding: '8px 10px',
            outline: 'none',
            boxSizing: 'border-box'
          }}
        />

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            onClick={clearAgent}
            disabled={running || (timeline.length === 0 && answer === null && error === null)}
            style={{
              ...btn('default'),
              opacity:
                running || (timeline.length === 0 && answer === null && error === null) ? 0.5 : 1
            }}
          >
            지우기
          </button>
          <div style={{ flex: 1 }} />
          {running ? (
            <button onClick={() => void cancelAgent()} style={btn('danger')}>
              취소
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={!canSend}
              style={{ ...btn('primary'), opacity: canSend ? 1 : 0.5 }}
            >
              실행
            </button>
          )}
        </div>
      </div>
    </aside>
  )
}
