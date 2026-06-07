/**
 * ShortcutHelp — KeyBindingRegistry 읽기 API 표시 (roadmap P3 DoD).
 *
 * P3 에서는 레지스트리 노출까지만 — 임시 도움말 패널로 단축키 목록을 확인한다.
 * 실제 표시 호스트(설정 화면 단축키 섹션)는 P5a 에서 이 읽기 API 를 재사용한다.
 *
 * registry.listBindings() 가 PRD §8 단일 출처(domain/keybindings)를 그대로 노출.
 */
import { useRootStore } from '@renderer/app/stores/rootStore'
import { listShortcutGroups, prettyChord } from './shortcuts'
import { tokens } from '@renderer/ui/theme/tokens'

export function ShortcutHelp(): JSX.Element | null {
  const open = useRootStore((s) => s.shortcutHelpOpen)
  const toggle = useRootStore((s) => s.toggleShortcutHelp)
  if (!open) return null

  const groups = listShortcutGroups()

  return (
    <div
      onClick={toggle}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.35)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1100
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 560,
          maxHeight: '80vh',
          overflowY: 'auto',
          background: tokens.color.bg,
          borderRadius: 8,
          padding: 20,
          fontSize: 13,
          boxShadow: '0 8px 32px rgba(0,0,0,0.25)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>단축키</h2>
          <button
            onClick={toggle}
            style={{ marginLeft: 'auto', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 16 }}
            aria-label="닫기"
          >
            ✕
          </button>
        </div>
        {groups.map(({ group, items }) => (
          <div key={group} style={{ marginBottom: 14 }}>
            <div style={{ fontWeight: 600, color: tokens.color.textMuted, marginBottom: 4 }}>{group}</div>
            {items.map((b) => (
              <div
                key={`${b.context}-${b.chord}`}
                style={{ display: 'flex', padding: '2px 0', alignItems: 'center' }}
              >
                <span style={{ flex: 1 }}>{b.label}</span>
                <kbd
                  style={{
                    fontFamily: 'monospace',
                    fontSize: 12,
                    background: tokens.color.bgAlt,
                    border: `1px solid ${tokens.color.border}`,
                    borderRadius: 4,
                    padding: '1px 6px'
                  }}
                >
                  {prettyChord(b.chord)}
                </kbd>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
