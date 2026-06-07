/**
 * KeyboardEvent → 정규화된 chord 문자열 변환.
 *
 * 형식(소문자): 수정자 ctrl→alt→shift→meta 순 + '+' + 주 키.
 * 주 키: 단일 문자는 소문자, 특수키는 'arrowleft'/'enter'/'f5'/'\\' 등.
 *
 * domain/keybindings 의 chord 표기와 1:1 대응해야 한다.
 */

/** 주 키 정규화. event.key 를 chord 토큰으로. */
function normalizeKey(e: KeyboardEvent): string | null {
  const k = e.key
  // 수정자 단독 입력은 chord 가 아니다.
  if (k === 'Control' || k === 'Alt' || k === 'Shift' || k === 'Meta') return null

  // 기능키·방향키·특수키.
  if (/^F\d{1,2}$/.test(k)) return k.toLowerCase() // F2, F5...
  if (k === 'ArrowLeft') return 'arrowleft'
  if (k === 'ArrowRight') return 'arrowright'
  if (k === 'ArrowUp') return 'arrowup'
  if (k === 'ArrowDown') return 'arrowdown'
  if (k === 'Enter') return 'enter'
  if (k === 'Backspace') return 'backspace'
  if (k === 'Delete') return 'delete'
  if (k === 'Escape') return 'escape'
  if (k === 'Tab') return 'tab'
  if (k === ' ') return 'space'
  // 백슬래시 키: Shift 조합 시 일부 레이아웃이 '|'(파이프)를 보고하므로
  // 물리 키('\\')로 정규화한다(Ctrl+Shift+\ = layout.toggleGrid4 일관 매칭).
  if (k === '\\' || k === '|') return '\\'

  // 단일 가시 문자: 소문자로(Shift 는 수정자에서 표현).
  if (k.length === 1) return k.toLowerCase()
  return k.toLowerCase()
}

/** KeyboardEvent → chord. 변환 불가(수정자 단독 등)면 null. */
export function chordFromEvent(e: KeyboardEvent): string | null {
  const main = normalizeKey(e)
  if (main === null) return null
  const parts: string[] = []
  if (e.ctrlKey) parts.push('ctrl')
  if (e.altKey) parts.push('alt')
  if (e.shiftKey) parts.push('shift')
  if (e.metaKey) parts.push('meta')
  parts.push(main)
  return parts.join('+')
}
