/**
 * ConfirmDialog — 영구 삭제 확인 (US-2.2 Shift+Delete, roadmap P4).
 *
 * uiSlice.confirmDelete 가 열려 있으면 대상 경로를 보여주고 확인/취소를 받는다.
 * 확인 시 confirmPermanentDelete() → op:start(delete). 자체 모달이며 열림 동안
 * inputContext='dialog' 로 전역 단축키가 차단된다(uiSlice.openConfirmDelete).
 *
 * (Main 모달 dialog.confirmPermanentDelete 계약도 존재하나, 1차는 Renderer 자체
 *  모달로 일관된 UX·키보드 포커스 트랩을 제공한다.)
 */
import { useEffect, useRef } from 'react'
import { useRootStore } from '@renderer/app/stores/rootStore'
import { confirmPermanentDelete } from '@renderer/app/usecases/fileOps'
import { baseName } from '@renderer/domain/paths'
import { tokens } from '@renderer/ui/theme/tokens'
import { useFocusTrap } from '@renderer/ui/keyboard/useFocusTrap'
import { btn, overlayStyle, panelStyle, titleStyle } from './dialogStyles'

export function ConfirmDialog(): JSX.Element | null {
  const confirmDelete = useRootStore((s) => s.confirmDelete)
  const closeConfirmDelete = useRootStore((s) => s.closeConfirmDelete)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null)

  // 포커스 트랩: 첫 포커스(확인 버튼)·Tab 순환 가둠·닫힐 때 opener 복귀(P7-A).
  useFocusTrap(!!confirmDelete, panelRef, { initialFocus: confirmBtnRef })

  // Esc 취소(다이얼로그 전역 단축키 차단 상태이므로 직접 처리).
  useEffect(() => {
    if (!confirmDelete) return undefined
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeConfirmDelete()
      }
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [confirmDelete, closeConfirmDelete])

  if (!confirmDelete) return null

  const paths = confirmDelete.paths
  const count = paths.length

  return (
    <div style={overlayStyle} role="dialog" aria-modal="true" aria-label="영구 삭제 확인">
      <div ref={panelRef} style={panelStyle}>
        <div style={titleStyle}>영구 삭제</div>
        <p style={{ marginTop: 0 }}>
          {count === 1 ? (
            <>
              <strong>{baseName(paths[0] as string)}</strong> 을(를) 영구적으로 삭제할까요?
            </>
          ) : (
            <>
              선택한 <strong>{count}개 항목</strong>을 영구적으로 삭제할까요?
            </>
          )}
        </p>
        <p style={{ color: tokens.color.danger, fontSize: 12, marginTop: 4 }}>
          이 작업은 휴지통을 거치지 않으며 되돌릴 수 없습니다.
        </p>

        {count > 1 && (
          <ul
            style={{
              margin: '8px 0 0',
              paddingLeft: 18,
              maxHeight: 120,
              overflowY: 'auto',
              fontSize: 12,
              color: tokens.color.textMuted
            }}
          >
            {paths.slice(0, 8).map((p) => (
              <li key={p}>{baseName(p)}</li>
            ))}
            {paths.length > 8 && <li>외 {paths.length - 8}개…</li>}
          </ul>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
          <button style={btn('default')} onClick={() => closeConfirmDelete()}>
            취소
          </button>
          <button
            ref={confirmBtnRef}
            style={btn('danger')}
            onClick={() => void confirmPermanentDelete()}
          >
            영구 삭제
          </button>
        </div>
      </div>
    </div>
  )
}
