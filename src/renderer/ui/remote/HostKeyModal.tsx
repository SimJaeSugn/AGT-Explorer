/**
 * HostKeyModal — 호스트키 TOFU 확인 모달 (§M M3, SR5).
 *
 * remote:host-key 푸시 수신 시 remoteSlice.hostKeyPrompt 가 채워지면 표시된다.
 * 지문(fingerprint)·알고리즘·상태(unknown=최초/changed=변경 경고)를 보여주고,
 * 사용자가 "신뢰"(accept) 또는 "거부"(reject)를 선택하면 usecases/remote 가
 * 다음 remote:connect 의 hostKeyDecision 으로 회신한다. 지문만 노출 — 비밀 없음.
 *
 * 모달 패턴(useFocusTrap·role=dialog·aria-modal·Esc=거부). changed 는 경고 강조.
 */
import { useEffect, useRef } from 'react'
import { useRootStore } from '@renderer/app/stores/rootStore'
import { acceptHostKey, rejectHostKey } from '@renderer/app/usecases/remote'
import { useFocusTrap } from '@renderer/ui/keyboard/useFocusTrap'
import { btn, overlayStyle, panelStyle, titleStyle } from '@renderer/ui/dialogs/dialogStyles'
import { tokens } from '@renderer/ui/theme/tokens'

export function HostKeyModal(): JSX.Element | null {
  const prompt = useRootStore((s) => s.hostKeyPrompt)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const rejectRef = useRef<HTMLButtonElement | null>(null)

  const open = prompt !== null
  // 안전 기본값: 거부 버튼에 초기 포커스(실수 신뢰 방지).
  useFocusTrap(open, panelRef, { initialFocus: rejectRef })

  // Esc = 거부(안전 우선).
  useEffect(() => {
    if (!open) return undefined
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        rejectHostKey()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open])

  if (!prompt) return null

  const changed = prompt.status === 'changed'

  return (
    <div
      style={overlayStyle}
      role="dialog"
      aria-modal="true"
      aria-label="호스트 키 확인"
      onClick={(e) => e.stopPropagation()}
    >
      <div ref={panelRef} style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ ...titleStyle, color: changed ? tokens.color.danger : tokens.color.text }}>
          {changed ? '⚠ 호스트 키가 변경되었습니다' : '호스트 키 확인'}
        </div>
        <p style={{ marginTop: 0, fontSize: 13 }}>
          {changed
            ? '이전에 신뢰한 호스트 키와 다릅니다. 중간자 공격일 수 있으니 주의하세요.'
            : '이 호스트에 처음 연결합니다. 호스트 키 지문을 확인하세요.'}
        </p>
        <div
          style={{
            background: tokens.color.bgAlt,
            border: `1px solid ${tokens.color.border}`,
            borderRadius: 6,
            padding: 10,
            fontSize: 12
          }}
        >
          <div style={{ color: tokens.color.textMuted }}>알고리즘: {prompt.algo}</div>
          <div style={{ fontFamily: 'monospace', wordBreak: 'break-all', marginTop: 4 }}>
            {prompt.fingerprint}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
          <button ref={rejectRef} style={btn('default')} onClick={() => rejectHostKey()}>
            거부
          </button>
          <button
            style={btn(changed ? 'danger' : 'primary')}
            onClick={() => void acceptHostKey()}
          >
            신뢰하고 연결
          </button>
        </div>
      </div>
    </div>
  )
}
