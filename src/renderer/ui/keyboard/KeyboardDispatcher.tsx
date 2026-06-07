/**
 * KeyboardDispatcher — 전역 keydown 을 받아 컨텍스트 스코프로 디스패치 (SA §7.1).
 *
 * window keydown(capture) → chord 변환 → 활성 컨텍스트 판별 → registry.resolve
 * → CommandBus.execCommand. 텍스트 입력 컨텍스트(주소창/검색/이름편집)에서는
 * 해당 컨텍스트 매핑만 허용해 전역 단축키를 차단한다(SA §7.1).
 *
 * ui → app(commandBus·store) 경유, registry(ui/keyboard) 사용.
 */
import { useEffect } from 'react'
import type { KeyContext } from '@renderer/domain/keybindings'
import { useRootStore } from '@renderer/app/stores/rootStore'
import { execCommand } from '@renderer/app/usecases/commandBus'
import { chordFromEvent } from './chord'
import { keyBindingRegistry } from './registry'

/** 포커스가 텍스트 입력 요소에 있는지(브라우저 기본 입력 보존). */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (target.isContentEditable) return true
  return false
}

export function KeyboardDispatcher(): null {
  const inputContext = useRootStore((s) => s.inputContext)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      const chord = chordFromEvent(e)
      if (!chord) return

      // 활성 컨텍스트 결정: 스토어 inputContext 우선, DOM 포커스가 입력이면 텍스트.
      let ctx: KeyContext = inputContext
      if (isEditableTarget(e.target) && ctx === 'list') {
        // 입력 요소에 포커스가 있는데 컨텍스트가 list 면(브레드크럼 input 등),
        // 전역 단축키 대부분을 막되 일부 글로벌(Ctrl+T 등)은 허용한다.
        // 단순화: 입력 요소면 escape/tab 외 전역 차단 → 텍스트 컨텍스트로.
        ctx = 'addressEdit'
      }

      const commandId = keyBindingRegistry.resolve(ctx, chord)
      if (!commandId) return

      const handled = execCommand(commandId)
      if (handled) {
        e.preventDefault()
        e.stopPropagation()
      }
    }

    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [inputContext])

  return null
}
