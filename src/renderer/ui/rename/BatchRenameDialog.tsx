/**
 * BatchRenameDialog — 고급 일괄 이름변경 (R1·US-17.1·§R·F22).
 *
 * 규칙 입력 폼(찾기/바꾸기·정규식·접두/접미·연번·대소문자·확장자 적용) + 실시간 미리보기
 * 표(원이름 → 새이름·충돌 강조) + 적용/취소. ConfirmDialog/PresetManageDialog 의 dialog
 * 패턴(overlay/panel·focus trap·Esc) 재사용. 열림 동안 inputContext='dialog'(전역 단축키
 * 차단)는 uiSlice.openBatchRename 가 설정한다.
 *
 * 모든 규칙은 로컬 state(useState)로 다루고 미리보기는 순수 규칙(domain/rules/batchRename)을
 * usecase 경유로 호출해 산출한다(부수효과 0). 적용만 applyBatchRename(fs:rename 반복).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRootStore } from '@renderer/app/stores/rootStore'
import { useFocusTrap } from '@renderer/ui/keyboard/useFocusTrap'
import { overlayStyle, panelStyle, titleStyle, btn } from '@renderer/ui/dialogs/dialogStyles'
import { tokens } from '@renderer/ui/theme/tokens'
import {
  applyBatchRename,
  getBatchRenameTargets,
  previewBatchRename
} from '@renderer/app/usecases/batchRename'
import {
  isApplicable,
  renameErrorLabel,
  type BatchRenameRule,
  type CaseMode
} from '@renderer/domain/rules/batchRename'

const EMPTY_RULE: RuleForm = {
  find: '',
  replace: '',
  useRegex: false,
  prefix: '',
  suffix: '',
  seqEnabled: false,
  seqStart: 1,
  seqStep: 1,
  seqPad: 0,
  seqPosition: 'suffix',
  caseMode: 'none',
  applyToExt: false
}

/** 다이얼로그 폼 상태(평탄화 — seq 는 개별 필드). */
interface RuleForm {
  find: string
  replace: string
  useRegex: boolean
  prefix: string
  suffix: string
  seqEnabled: boolean
  seqStart: number
  seqStep: number
  seqPad: number
  seqPosition: 'prefix' | 'suffix'
  caseMode: CaseMode
  applyToExt: boolean
}

/** 폼 → 도메인 규칙. */
function toRule(f: RuleForm): BatchRenameRule {
  return {
    find: f.find,
    replace: f.replace,
    useRegex: f.useRegex,
    prefix: f.prefix,
    suffix: f.suffix,
    seq: {
      enabled: f.seqEnabled,
      start: f.seqStart,
      step: f.seqStep,
      pad: f.seqPad,
      position: f.seqPosition
    },
    caseMode: f.caseMode,
    applyToExt: f.applyToExt
  }
}

const labelStyle: React.CSSProperties = { fontSize: 12, color: tokens.color.textMuted, marginBottom: 2 }
const inputStyle: React.CSSProperties = {
  height: 28,
  padding: '0 8px',
  borderRadius: 6,
  border: `1px solid ${tokens.color.border}`,
  background: tokens.color.bg,
  color: tokens.color.text,
  fontSize: 13,
  width: '100%',
  boxSizing: 'border-box'
}

export function BatchRenameDialog(): JSX.Element | null {
  const open = useRootStore((s) => s.batchRenameOpen)
  const close = useRootStore((s) => s.closeBatchRename)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const firstFieldRef = useRef<HTMLInputElement | null>(null)
  const [form, setForm] = useState<RuleForm>(EMPTY_RULE)

  useFocusTrap(open, panelRef, { initialFocus: firstFieldRef })

  // 열릴 때마다 폼 초기화(직전 규칙 잔존 방지).
  useEffect(() => {
    if (open) setForm(EMPTY_RULE)
  }, [open])

  // Esc 취소(전역 단축키 차단 상태이므로 직접 처리).
  useEffect(() => {
    if (!open) return undefined
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        close()
      }
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [open, close])

  // 미리보기(실시간): 폼이 바뀔 때마다 순수 규칙 재계산. open 일 때만.
  const ctx = useMemo(() => (open ? getBatchRenameTargets() : null), [open])
  const result = useMemo(() => {
    if (!open || !ctx) return null
    return previewBatchRename(ctx.panelId, toRule(form))
  }, [open, ctx, form])

  if (!open) return null

  if (!ctx || ctx.targets.length < 2) {
    // 방어: 선택이 사라진 경우.
    return (
      <div style={overlayStyle} onClick={close} role="dialog" aria-modal="true" aria-label="일괄 이름변경">
        <div ref={panelRef} style={{ ...panelStyle, width: 420 }} onClick={(e) => e.stopPropagation()}>
          <div style={titleStyle}>고급 일괄 이름변경</div>
          <p style={{ color: tokens.color.textMuted }}>두 개 이상 선택한 뒤 사용하세요.</p>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button style={btn('default')} onClick={close}>
              닫기
            </button>
          </div>
        </div>
      </div>
    )
  }

  const rows = result?.rows ?? []
  const invalidRegex = result?.invalidRegex ?? false
  const conflictCount = rows.filter((r) => r.error !== null).length
  const changedCount = rows.filter((r) => r.changed && r.error === null).length
  const canApply = result !== null && isApplicable(result)

  function setField<K extends keyof RuleForm>(key: K, value: RuleForm[K]): void {
    setForm((f) => ({ ...f, [key]: value }))
  }

  return (
    <div style={overlayStyle} onClick={close} role="dialog" aria-modal="true" aria-label="고급 일괄 이름변경">
      <div
        ref={panelRef}
        style={{ ...panelStyle, width: 720, maxWidth: '94vw', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
          <h2 style={{ ...titleStyle, margin: 0 }}>고급 일괄 이름변경</h2>
          <span style={{ marginLeft: 8, fontSize: 12, color: tokens.color.textMuted }}>
            대상 {ctx.targets.length}개
          </span>
          <button
            onClick={close}
            aria-label="닫기"
            style={{
              marginLeft: 'auto',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              fontSize: 18,
              color: tokens.color.text
            }}
          >
            ✕
          </button>
        </div>

        {/* ── 규칙 입력 폼 ─────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 8 }}>
          <div>
            <div style={labelStyle}>찾기</div>
            <input
              ref={firstFieldRef}
              style={inputStyle}
              value={form.find}
              onChange={(e) => setField('find', e.target.value)}
              placeholder={form.useRegex ? '정규식 (예: (\\d+))' : '찾을 문자열'}
            />
          </div>
          <div>
            <div style={labelStyle}>바꾸기</div>
            <input
              style={inputStyle}
              value={form.replace}
              onChange={(e) => setField('replace', e.target.value)}
              placeholder={form.useRegex ? '치환 (예: $1)' : '바꿀 문자열'}
            />
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center', marginBottom: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
            <input type="checkbox" checked={form.useRegex} onChange={(e) => setField('useRegex', e.target.checked)} />
            정규식 사용
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
            <input type="checkbox" checked={form.applyToExt} onChange={(e) => setField('applyToExt', e.target.checked)} />
            확장자 포함 적용
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
            대소문자
            <select
              value={form.caseMode}
              onChange={(e) => setField('caseMode', e.target.value as CaseMode)}
              style={{ ...inputStyle, width: 'auto', height: 26 }}
            >
              <option value="none">변환 없음</option>
              <option value="upper">대문자(UPPER)</option>
              <option value="lower">소문자(lower)</option>
              <option value="title">각 단어 첫글자(Title)</option>
            </select>
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 8 }}>
          <div>
            <div style={labelStyle}>접두(앞에 추가)</div>
            <input style={inputStyle} value={form.prefix} onChange={(e) => setField('prefix', e.target.value)} />
          </div>
          <div>
            <div style={labelStyle}>접미(뒤에 추가)</div>
            <input style={inputStyle} value={form.suffix} onChange={(e) => setField('suffix', e.target.value)} />
          </div>
        </div>

        {/* ── 연번 ─────────────────────────────────────────────────── */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 10,
            alignItems: 'flex-end',
            marginBottom: 10,
            padding: '8px 10px',
            border: `1px solid ${tokens.color.border}`,
            borderRadius: 6
          }}
        >
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
            <input type="checkbox" checked={form.seqEnabled} onChange={(e) => setField('seqEnabled', e.target.checked)} />
            연번
          </label>
          <NumField label="시작" value={form.seqStart} onChange={(v) => setField('seqStart', v)} disabled={!form.seqEnabled} />
          <NumField label="증가" value={form.seqStep} onChange={(v) => setField('seqStep', v)} disabled={!form.seqEnabled} />
          <NumField label="자릿수" value={form.seqPad} onChange={(v) => setField('seqPad', Math.max(0, v))} disabled={!form.seqEnabled} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
            위치
            <select
              value={form.seqPosition}
              onChange={(e) => setField('seqPosition', e.target.value as 'prefix' | 'suffix')}
              disabled={!form.seqEnabled}
              style={{ ...inputStyle, width: 'auto', height: 26 }}
            >
              <option value="prefix">앞</option>
              <option value="suffix">뒤</option>
            </select>
          </label>
        </div>

        {/* ── 미리보기 표 ─────────────────────────────────────────── */}
        {invalidRegex && (
          <div style={{ color: tokens.color.danger, fontSize: 12, marginBottom: 6 }}>
            정규식이 올바르지 않습니다 — 찾기/바꾸기가 적용되지 않습니다.
          </div>
        )}
        <div
          style={{
            flex: 1,
            minHeight: 120,
            overflowY: 'auto',
            border: `1px solid ${tokens.color.border}`,
            borderRadius: 6
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ position: 'sticky', top: 0, background: tokens.color.bgAlt }}>
                <th style={thStyle}>원래 이름</th>
                <th style={thStyle}>변경 후 이름</th>
                <th style={{ ...thStyle, width: 130 }}>상태</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const hasError = r.error !== null
                return (
                  <tr
                    key={r.path}
                    style={{
                      borderTop: `1px solid ${tokens.color.border}`,
                      background: hasError ? 'rgba(220,38,38,0.10)' : undefined
                    }}
                  >
                    <td style={tdStyle}>{r.oldName}</td>
                    <td style={{ ...tdStyle, fontWeight: r.changed ? 600 : 400, color: hasError ? tokens.color.danger : tokens.color.text }}>
                      {r.newName}
                    </td>
                    <td style={tdStyle}>
                      {hasError ? (
                        <span style={{ color: tokens.color.danger }}>⚠ {renameErrorLabel(r.error!)}</span>
                      ) : r.changed ? (
                        <span style={{ color: tokens.color.accent }}>변경</span>
                      ) : (
                        <span style={{ color: tokens.color.textMuted }}>변동 없음</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* ── 푸터(요약 + 버튼) ───────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
          <span style={{ fontSize: 12, color: conflictCount > 0 ? tokens.color.danger : tokens.color.textMuted }}>
            {conflictCount > 0
              ? `충돌/오류 ${conflictCount}건 — 해결 후 적용할 수 있습니다`
              : `변경 ${changedCount}건`}
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button style={btn('default')} onClick={close}>
              취소
            </button>
            <button
              style={{ ...btn('primary'), opacity: canApply ? 1 : 0.5, cursor: canApply ? 'pointer' : 'not-allowed' }}
              disabled={!canApply}
              onClick={() => {
                if (result) void applyBatchRename(ctx.panelId, result)
              }}
            >
              적용
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '6px 10px',
  fontWeight: 600,
  color: tokens.color.textMuted,
  borderBottom: `1px solid ${tokens.color.border}`
}
const tdStyle: React.CSSProperties = {
  padding: '5px 10px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  maxWidth: 280
}

/** 작은 숫자 입력 필드. */
function NumField(props: {
  label: string
  value: number
  onChange: (v: number) => void
  disabled?: boolean
}): JSX.Element {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12, gap: 2 }}>
      <span style={{ color: tokens.color.textMuted }}>{props.label}</span>
      <input
        type="number"
        value={props.value}
        disabled={props.disabled}
        onChange={(e) => {
          const n = Number(e.target.value)
          props.onChange(Number.isFinite(n) ? n : 0)
        }}
        style={{ ...inputStyle, width: 70, height: 26 }}
      />
    </label>
  )
}
