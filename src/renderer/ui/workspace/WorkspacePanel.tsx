/**
 * WorkspacePanel — 워크스페이스 저장/복원 관리 UI 본문 (US-5.8).
 *
 * 설정 화면의 "워크스페이스" 카테고리에 임베드된다(다이얼로그 크롬 없음 — 오버레이/
 * 패널/타이틀은 호스트가 제공). 기존 WorkspaceDialog 의 기능을 그대로 옮긴 것:
 * - 이름 입력 + "현재 상태 저장".
 * - 목록(name·savedAt) + 각 항목 불러오기/이름변경/삭제, 현재 선택 배지·선택 해제.
 * 불러오기는 resetWorkspace()+applySnapshot() 단일 경로(usecases/workspace).
 *
 * @param onLoaded 워크스페이스 불러오기 성공 후 콜백(호스트가 설정 화면을 닫는 등).
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
import { btn } from '@renderer/ui/dialogs/dialogStyles'
import { tokens } from '@renderer/ui/theme/tokens'

function formatSavedAt(ms: number): string {
  try {
    return new Date(ms).toLocaleString()
  } catch {
    return '-'
  }
}

export function WorkspacePanel({ onLoaded }: { onLoaded?: () => void }): JSX.Element {
  const currentWorkspace = useRootStore((s) => s.currentWorkspace)
  const setCurrentWorkspace = useRootStore((s) => s.setCurrentWorkspace)

  const [name, setName] = useState('')
  const [items, setItems] = useState<WorkspaceInfo[]>([])
  const [busy, setBusy] = useState(false)

  async function refresh(): Promise<void> {
    setItems(await listWorkspaces())
  }

  // 마운트(카테고리 진입) 시 목록 로드.
  useEffect(() => {
    void refresh()
  }, [])

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
    if (ok) onLoaded?.()
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
    <div>
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
            // 키보드 포커스 가시성은 전역 :focus-visible(a11y CSS)에 위임.
            boxSizing: 'border-box'
          }}
        />
        <button onClick={() => void onSave()} disabled={busy || name.trim() === ''} style={btn('primary')}>
          현재 상태 저장
        </button>
      </div>

      {/* 목록 */}
      <h4 style={{ fontSize: 13, fontWeight: 600, margin: '0 0 6px', color: tokens.color.textMuted }}>
        저장된 워크스페이스
      </h4>
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
                {w.name === currentWorkspace && (
                  <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 600, color: tokens.color.accent }}>
                    현재 선택 · 자동 저장
                  </span>
                )}
              </div>
              <div style={{ fontSize: 11, color: tokens.color.textMuted }}>{formatSavedAt(w.savedAt)}</div>
            </div>
            {w.name === currentWorkspace ? (
              <button
                onClick={() => setCurrentWorkspace(null)}
                disabled={busy}
                style={btn('default')}
                title="자동 저장을 중단합니다(저장된 내용은 유지)."
              >
                선택 해제
              </button>
            ) : (
              <button onClick={() => void onLoad(w.name)} disabled={busy} style={btn('default')}>
                불러오기
              </button>
            )}
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
  )
}
