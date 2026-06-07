/**
 * shortcuts (ui/keyboard) — KeyBindingRegistry 읽기 → 표시용 그룹/표기 헬퍼.
 *
 * 설정 화면 단축키 섹션·ShortcutHelp 가 공유한다. PRD §8 단일 출처
 * (domain/keybindings)를 KeyBindingRegistry.listBindings() 로 읽어 그룹핑한다.
 */
import type { KeyBinding } from '@renderer/domain/keybindings'
import { keyBindingRegistry } from './registry'

/** chord 를 사람친화 표기로(ctrl+shift+t → Ctrl+Shift+T, arrowleft → ←). */
export function prettyChord(chord: string): string {
  return chord
    .split('+')
    .map((p) => {
      if (p === 'arrowleft') return '←'
      if (p === 'arrowright') return '→'
      if (p === 'arrowup') return '↑'
      if (p === 'arrowdown') return '↓'
      if (p.length === 1) return p.toUpperCase()
      return p.charAt(0).toUpperCase() + p.slice(1)
    })
    .join('+')
}

export interface ShortcutGroup {
  readonly group: string
  readonly items: readonly KeyBinding[]
}

/** PRD §8 단축키를 그룹(영역)별로 모아 반환(선언 순서 보존). */
export function listShortcutGroups(): ShortcutGroup[] {
  const bindings = keyBindingRegistry.listBindings()
  const order: string[] = []
  const map = new Map<string, KeyBinding[]>()
  for (const b of bindings) {
    if (!map.has(b.group)) {
      map.set(b.group, [])
      order.push(b.group)
    }
    map.get(b.group)?.push(b)
  }
  return order.map((group) => ({ group, items: map.get(group) ?? [] }))
}
