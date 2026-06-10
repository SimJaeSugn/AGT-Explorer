/**
 * NewTabPickerDialog — 새 탭 시작 위치 피커 (I6).
 *
 * 기본 시작 위치(설정 startLocation)가 없고 저장된 워크스페이스가 있을 때 새 탭 생성 시 뜬다.
 * 워크스페이스를 고르면 그 주(활성) 경로에서 새 탭을 열고(세션 비파괴), "내 PC"를 고르면
 * 빈 내 PC 탭을 연다. 실제 동작은 usecases/newTab 에 위임.
 *
 * 자체 모달·focus trap·Esc 취소(ConfirmDialog 패턴 재사용).
 */
import { useEffect, useRef, useState } from 'react'
import type { WorkspaceInfo } from '@shared/dto'
import { useRootStore } from '@renderer/app/stores/rootStore'
import {
  listWorkspacesForPicker,
  loadProjectFromPicker,
  newTabAtMyPc
} from '@renderer/app/usecases/newTab'
import { tokens } from '@renderer/ui/theme/tokens'
import { useFocusTrap } from '@renderer/ui/keyboard/useFocusTrap'
import { btn, overlayStyle, panelStyle, titleStyle } from '@renderer/ui/dialogs/dialogStyles'

export function NewTabPickerDialog(): JSX.Element | null {
  const open = useRootStore((s) => s.newTabPickerOpen)
  const close = useRootStore((s) => s.closeNewTabPicker)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const firstRef = useRef<HTMLButtonElement | null>(null)
  const [items, setItems] = useState<WorkspaceInfo[]>([])

  useFocusTrap(open, panelRef, { initialFocus: firstRef })

  useEffect(() => {
    if (!open) return
    void listWorkspacesForPicker().then(setItems)
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
      }
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [open, close])

  if (!open) return null

  const rowBtn: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    textAlign: 'left',
    padding: '6px 8px',
    border: `1px solid ${tokens.color.border}`,
    borderRadius: 5,
    background: tokens.color.bg,
    color: tokens.color.text,
    cursor: 'pointer',
    fontSize: 13,
    marginBottom: 4
  }

  return (
    <div style={overlayStyle} role="dialog" aria-modal="true" aria-label="새 탭 시작 위치">
      <div ref={panelRef} style={{ ...panelStyle, width: 420, maxWidth: '92vw' }}>
        <div style={titleStyle}>새 탭 — 프로젝트 선택</div>
        <p style={{ marginTop: 0, fontSize: 12, color: tokens.color.textMuted }}>
          기본 시작 위치가 설정되지 않았습니다. 프로젝트(워크스페이스)를 선택하면 그 프로젝트를
          불러옵니다(현재 탭/레이아웃이 교체됩니다). "내 PC"는 빈 새 탭을 엽니다.
        </p>

        <button ref={firstRef} style={rowBtn} onClick={() => newTabAtMyPc()}>
          <span>🖥</span>
          <span>내 PC (빈 새 탭)</span>
        </button>

        <div
          style={{
            maxHeight: 260,
            overflowY: 'auto',
            marginTop: 4,
            borderTop: `1px solid ${tokens.color.border}`,
            paddingTop: 6
          }}
        >
          {items.length === 0 ? (
            <div style={{ fontSize: 12, color: tokens.color.textMuted, padding: '4px 2px' }}>
              저장된 프로젝트(워크스페이스)가 없습니다.
            </div>
          ) : (
            items.map((w) => (
              <button
                key={w.name}
                style={rowBtn}
                onClick={() => void loadProjectFromPicker(w.name)}
                title={`${w.name} 프로젝트 불러오기`}
              >
                <span>🗂</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {w.name}
                </span>
              </button>
            ))
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <button style={btn('default')} onClick={() => close()}>
            취소
          </button>
        </div>
      </div>
    </div>
  )
}
