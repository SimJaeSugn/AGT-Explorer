/**
 * 선택 집합 연산 (renderer/domain/rules/selection) — 순수 함수.
 *
 * 다중 선택(Ctrl/Shift/전체)의 규칙을 도메인에 둔다. UI 는 마우스/키 이벤트를
 * 이 함수 호출로 변환만 한다. Set<string>(경로) 기반.
 *
 * SA §2.1(Selection: anchorIndex·selectedPaths). US-5.1 다중 선택.
 */

export interface SelectionState {
  /** Shift 범위 선택 기준 인덱스(-1 이면 없음). */
  readonly anchorIndex: number
  /**
   * 선택된 경로 집합. 불변(연산마다 새 Set 생성)이지만 immer draft 호환을 위해
   * Set 타입으로 둔다 — 직접 mutate 하지 않고 통째로 교체한다(ADR-002 selection).
   */
  readonly selectedPaths: Set<string>
}

export const emptySelection: SelectionState = {
  anchorIndex: -1,
  selectedPaths: new Set<string>()
}

/** 정렬·필터 적용 후 화면에 보이는 순서대로의 경로 배열을 받아 연산한다. */

/** 단일 클릭: 해당 항목만 선택, anchor 갱신. */
export function selectSingle(visiblePaths: readonly string[], index: number): SelectionState {
  const p = visiblePaths[index]
  return {
    anchorIndex: index,
    selectedPaths: p !== undefined ? new Set([p]) : new Set()
  }
}

/** Ctrl+클릭: 토글(있으면 제거, 없으면 추가). anchor 를 이 항목으로. */
export function toggle(
  prev: SelectionState,
  visiblePaths: readonly string[],
  index: number
): SelectionState {
  const p = visiblePaths[index]
  if (p === undefined) return prev
  const next = new Set(prev.selectedPaths)
  if (next.has(p)) next.delete(p)
  else next.add(p)
  return { anchorIndex: index, selectedPaths: next }
}

/** Shift+클릭: anchor~index 범위를 선택(anchor 없으면 단일). */
export function selectRange(
  prev: SelectionState,
  visiblePaths: readonly string[],
  index: number
): SelectionState {
  const anchor = prev.anchorIndex >= 0 ? prev.anchorIndex : index
  const lo = Math.min(anchor, index)
  const hi = Math.max(anchor, index)
  const next = new Set<string>()
  for (let i = lo; i <= hi; i++) {
    const p = visiblePaths[i]
    if (p !== undefined) next.add(p)
  }
  return { anchorIndex: anchor, selectedPaths: next }
}

/** Ctrl+Shift+클릭: 기존 선택 유지 + anchor~index 범위 추가. */
export function addRange(
  prev: SelectionState,
  visiblePaths: readonly string[],
  index: number
): SelectionState {
  const anchor = prev.anchorIndex >= 0 ? prev.anchorIndex : index
  const lo = Math.min(anchor, index)
  const hi = Math.max(anchor, index)
  const next = new Set(prev.selectedPaths)
  for (let i = lo; i <= hi; i++) {
    const p = visiblePaths[i]
    if (p !== undefined) next.add(p)
  }
  return { anchorIndex: index, selectedPaths: next }
}

/** Ctrl+A: 전체 선택. */
export function selectAll(visiblePaths: readonly string[]): SelectionState {
  return {
    anchorIndex: visiblePaths.length > 0 ? 0 : -1,
    selectedPaths: new Set(visiblePaths)
  }
}

/** 선택 해제. */
export function clear(): SelectionState {
  return emptySelection
}

/** 마우스/키 수정자에서 적용할 선택 모드 결정. */
export type SelectMode = 'single' | 'toggle' | 'range' | 'addRange'

export function modeFromModifiers(ctrl: boolean, shift: boolean): SelectMode {
  if (ctrl && shift) return 'addRange'
  if (shift) return 'range'
  if (ctrl) return 'toggle'
  return 'single'
}

/** 모드를 받아 적절한 연산을 적용하는 디스패처. */
export function applySelect(
  prev: SelectionState,
  visiblePaths: readonly string[],
  index: number,
  mode: SelectMode
): SelectionState {
  switch (mode) {
    case 'single':
      return selectSingle(visiblePaths, index)
    case 'toggle':
      return toggle(prev, visiblePaths, index)
    case 'range':
      return selectRange(prev, visiblePaths, index)
    case 'addRange':
      return addRange(prev, visiblePaths, index)
    default:
      return prev
  }
}
