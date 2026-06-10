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

/**
 * U1: 포커스가 **파일 목록 그리드(role="grid")** 안에 있는지.
 * Space 퀵룩은 목록 포커스에서만 가로채야 한다 — 버튼/체크박스/링크 등 다른
 * 포커서블에서의 Space(클릭·스크롤)를 보존하기 위한 추가 게이트(컨텍스트만으로는
 * 비-편집 요소를 구분하지 못함). 목록 그리드 자신 또는 그 내부면 true.
 */
function isInFileListGrid(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.closest('[role="grid"]') !== null
}

/** 개발 모드 여부(devtools·리로드 등은 dev 에서 허용). */
const IS_DEV = import.meta.env.DEV

/**
 * 앱이 쓰지 않는 **브라우저 기본 단축키**(전체화면·개발자도구·리로드·인쇄·줌·찾기)인지.
 * 앱 명령으로 매핑된 chord 는 호출부에서 먼저 처리하므로 여기 도달하지 않는다(= 앱 우선).
 * dev 에서는 개발자도구/리로드를 허용해 디버깅을 방해하지 않는다.
 */
function isBrowserDefaultToBlock(e: KeyboardEvent): boolean {
  const k = e.key
  const ctrl = e.ctrlKey || e.metaKey
  if (k === 'F11') return true // 전체화면
  if (k === 'F3') return true // 브라우저 찾기(다음)
  if (ctrl && (k === 'p' || k === 'P')) return true // 인쇄
  if (ctrl && (k === '+' || k === '=' || k === '-' || k === '_' || k === '0')) return true // 줌
  if (!IS_DEV) {
    if (k === 'F5' || (ctrl && (k === 'r' || k === 'R'))) return true // 리로드(상태 손실 방지)
    if (k === 'F12') return true // 개발자도구
    if (ctrl && e.shiftKey && 'IiJjCc'.includes(k)) return true // 개발자도구(Ctrl+Shift+I/J/C)
  }
  return false
}

export function KeyboardDispatcher(): null {
  const inputContext = useRootStore((s) => s.inputContext)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      const chord = chordFromEvent(e)
      if (chord) {
        // 활성 컨텍스트 결정: 스토어 inputContext 우선, DOM 포커스가 입력이면 텍스트.
        let ctx: KeyContext = inputContext
        if (isEditableTarget(e.target) && ctx === 'list') {
          // 입력 요소에 포커스가 있는데 컨텍스트가 list 면(브레드크럼 input 등),
          // 전역 단축키 대부분을 막되 일부 글로벌(Ctrl+T 등)은 허용한다.
          // 단순화: 입력 요소면 escape/tab 외 전역 차단 → 텍스트 컨텍스트로.
          ctx = 'addressEdit'
        }
        const commandId = keyBindingRegistry.resolve(ctx, chord)
        if (commandId) {
          // U1: Space 퀵룩은 목록 그리드 포커스에서만 가로챈다(버튼/체크박스/스크롤
          // 등 다른 포커서블의 Space 보존). 오버레이/입력 컨텍스트는 위 ctx 분기로
          // 이미 차단됨(dialog/addressEdit/...). 목록 밖 Space 면 네이티브에 양보.
          if (chord === 'space' && !isInFileListGrid(e.target)) {
            return
          }
          // 앱이 쓰는 단축키 → 앱이 처리(브라우저 기본은 자동으로 막힘).
          if (execCommand(commandId)) {
            e.preventDefault()
            e.stopPropagation()
          }
          return
        }
      }
      // 앱이 쓰지 않는 브라우저 기본 단축키(F11/F12/리로드/인쇄/줌/찾기) 차단.
      if (isBrowserDefaultToBlock(e)) e.preventDefault()
    }

    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [inputContext])

  return null
}
