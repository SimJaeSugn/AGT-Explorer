/**
 * WorkspaceDialog — 명시적 워크스페이스 저장/복원 UI (P6c, US-5.8).
 *
 * - 이름 입력 + "저장"(현재 세션 스냅샷을 이름 붙여 저장).
 * - 목록(name·savedAt) + 각 항목 "불러오기"/"이름변경"/"삭제".
 *   불러오기는 resetWorkspace()+applySnapshot() 단일 경로(기존 탭 정리 후 복원).
 *
 * SettingsDialog 다이얼로그 패턴(overlay/panel/title) 재사용. 열림 동안
 * inputContext='dialog'(전역 단축키 차단)는 uiSlice.openWorkspace 가 설정.
 */
import { useEffect, useState } from 'react'
import type { WorkspaceInfo } from '@shared/dto'
import { useRootStore } from '@renderer/app/stores/rootStore'
import {
  deleteWorkspace,
  listWorkspaces,
  loadWorkspace,
  renameWorkspace,
  saveWorkspace
} from '@renderer/app/usecases/workspace'
import { btn, overlayStyle, panelStyle, titleStyle } from '@renderer/ui/dialogs/dialogStyles'
import { tokens } from '@renderer/ui/theme/tokens'

function formatSavedAt(ms: number): string {
  try {
    return new Date(ms).toLocaleString()
  } catch {
    return '-'
  }
}

export function WorkspaceDialog(): JSX.Element | null {
  const open = useRootStore((s) => s.workspaceOpen)
  const close = useRootStore((s) => s.closeWorkspace)

  const [name, setName] = useState('')
  const [items, setItems] = useState<WorkspaceInfo[]>([])
  const [busy, setBusy] = useState(false)

  async function refresh(): Promise<void> {
    setItems(await listWorkspaces())
  }

  useEffect(() => {
    if (open) {
      setName('')
      void refresh()
    }
  }, [open])

  if (!open) return null

  async function onSave(): Promise<void> {
    setBusy(true)
    const ok = await saveWorkspace(name)
    if (ok) {
      setName('')
      await refresh()
    }
    setBusy(false)
  }

  async function onLoad(target: string): Promise<void> {
    setBusy(true)
    const ok = await loadWorkspace(target)
    setBusy(false)
    if (ok) close()
  }

  async function onDelete(target: string): Promise<void> {
    setBusy(true)
    const ok = await deleteWorkspace(target)
    if (ok) await refresh()
    setBusy(false)
  }

  async function onRename(target: string): Promise<void> {
    const next = window.prompt('새 이름을 입력하세요.', target)
    if (next === null) return
    setBusy(true)
    const ok = await renameWorkspace(target, next)
    if (ok) await refresh()
    setBusy(false)
  }

  return (
    <div
      style={overlayStyle}
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-label="워크스페이스 관리"
    >
      <div
        style={{ ...panelStyle, width: 520, maxWidth: '92vw', maxHeight: '80vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <h2 style={{ ...titleStyle, margin: 0 }}>워크스페이스</h2>
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

        {/* 현재 상태 저장 */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !busy) void onSave()
            }}
            placeholder="새 워크스페이스 이름"
            aria-label="워크스페이스 이름"
            style={{
              flex: 1,
              height: 30,
              border: `1px solid ${tokens.color.border}`,
              borderRadius: 5,
              fontSize: 13,
              padding: '0 8px',
              background: tokens.color.bg,
              color: tokens.color.text,
              outline: 'none',
              boxSizing: 'border-box'
            }}
          />
          <button
            onClick={() => void onSave()}
            disabled={busy || name.trim() === ''}
            style={btn('primary')}
          >
            현재 상태 저장
          </button>
        </div>

        {/* 목록 */}
        <h3 style={{ fontSize: 13, fontWeight: 600, margin: '0 0 6px', color: tokens.color.textMuted }}>
          저장된 워크스페이스
        </h3>
        {items.length === 0 ? (
          <div style={{ color: tokens.color.textMuted, fontSize: 13, padding: '10px 0' }}>
            저장된 워크스페이스가 없습니다.
          </div>
        ) : (
          items.map((w) => (
            <div
              key={w.name}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 0',
                borderBottom: `1px solid ${tokens.color.border}`
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {w.name}
                </div>
                <div style={{ fontSize: 11, color: tokens.color.textMuted }}>
                  {formatSavedAt(w.savedAt)}
                </div>
              </div>
              <button onClick={() => void onLoad(w.name)} disabled={busy} style={btn('default')}>
                불러오기
              </button>
              <button onClick={() => void onRename(w.name)} disabled={busy} style={btn('default')}>
                이름변경
              </button>
              <button onClick={() => void onDelete(w.name)} disabled={busy} style={btn('danger')}>
                삭제
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
