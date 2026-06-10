/**
 * CompareMirrorDialog — 폴더 비교 미러 확인 모달 (§P1·F20·계획서 §10 데이터 안전).
 *
 * 미러는 **파괴적**(복사 덮어쓰기·선택 시 삭제)이므로 확정 전 변경 미리보기
 * (복사 N·덮어쓰기 M·삭제 K)를 보여주고 사용자가 확인한다. 삭제 동기화는
 * 휴지통 경유·K1 undo 보장(은폐 금지). 확정 시 applyMirrorConfirmed → 기존 op:*.
 *
 * 자체 모달·focus trap·Esc 취소(기존 ConfirmDialog 패턴 재사용).
 */
import { useEffect, useRef } from 'react'
import { useRootStore } from '@renderer/app/stores/rootStore'
import { applyMirrorConfirmed } from '@renderer/app/usecases/compare'
import { tokens } from '@renderer/ui/theme/tokens'
import { useFocusTrap } from '@renderer/ui/keyboard/useFocusTrap'
import { btn, overlayStyle, panelStyle, titleStyle } from '@renderer/ui/dialogs/dialogStyles'

export function CompareMirrorDialog(): JSX.Element | null {
  const state = useRootStore((s) => s.compareMirrorConfirm)
  const close = useRootStore((s) => s.closeCompareMirrorConfirm)
  // 고속 미러(robocopy) 적용 여부: 토글 on + 메타 모드(해시 비교 아님). 해시 모드면 폴백.
  const fastMirror = useRootStore(
    (s) => s.compareFastMirror && s.compareOptions.useHash !== true && s.compareOptions.recursive !== true
  )
  const panelRef = useRef<HTMLDivElement | null>(null)
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null)

  useFocusTrap(!!state, panelRef, { initialFocus: confirmBtnRef })

  useEffect(() => {
    if (!state) return undefined
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
      }
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [state, close])

  if (!state) return null

  const dirLabel = state.direction === 'l2r' ? '왼쪽 → 오른쪽' : '오른쪽 → 왼쪽'
  const hasDeletes = state.deleteCount > 0

  return (
    <div style={overlayStyle} role="dialog" aria-modal="true" aria-label="폴더 미러 확인">
      <div ref={panelRef} style={panelStyle}>
        <div style={titleStyle}>폴더 동기화 미러 — {dirLabel}</div>
        <p style={{ marginTop: 0, fontSize: 13 }}>이 동기화로 다음 변경이 적용됩니다:</p>
        <ul style={{ margin: '8px 0', paddingLeft: 18, fontSize: 13, lineHeight: 1.7 }}>
          <li>
            복사 <strong>{state.copyCount}개</strong>
            {state.overwriteCount > 0 && (
              <span style={{ color: tokens.color.danger }}> (덮어쓰기 {state.overwriteCount}개)</span>
            )}
          </li>
          {hasDeletes && (
            <li style={{ color: tokens.color.danger }}>
              삭제 <strong>{state.deleteCount}개</strong> (휴지통으로 이동)
            </li>
          )}
        </ul>
        <p style={{ fontSize: 12, color: tokens.color.textMuted, marginTop: 4 }}>
          복사 중 같은 이름이 있으면 충돌 처리(덮어쓰기/건너뛰기)를 묻습니다.
          {hasDeletes
            ? ' 삭제는 휴지통을 거치며 되돌리기(Ctrl+Z)로 복구할 수 있습니다.'
            : ' 이 미러는 복사만 하며 항목을 삭제하지 않습니다.'}
        </p>
        {fastMirror && (
          <p style={{ fontSize: 12, color: 'rgba(245,124,0,0.95)', marginTop: 4 }}>
            ⚡ 고속 미러(robocopy): 복사를 Windows robocopy 로 가속합니다. 복사분은 실행취소(Ctrl+Z)가
            지원되지 않습니다{hasDeletes ? '(삭제분은 휴지통·복구 가능)' : ''}.
          </p>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
          <button style={btn('default')} onClick={() => close()}>
            취소
          </button>
          <button
            ref={confirmBtnRef}
            style={btn(hasDeletes ? 'danger' : 'primary')}
            onClick={() => void applyMirrorConfirmed()}
          >
            미러 실행
          </button>
        </div>
      </div>
    </div>
  )
}
