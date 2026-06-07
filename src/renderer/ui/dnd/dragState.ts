/**
 * dragState — 패널 간 D&D 진행 상태 관찰 가능 스토어 (US-1.3, SA §8).
 *
 * HTML5 네이티브 DnD 는 드래그 중 수정키 변화를 실시간 반영하기 어렵고
 * 커서/툴팁 제어가 제한적이라, 포인터 이벤트 기반 커스텀 드래그를 쓴다.
 * 이 모듈은 React 외부의 경량 pub/sub 스토어로 드래그 상태를 보관하고,
 * useSyncExternalStore 로 컴포넌트가 구독한다.
 *
 * 상태만 보유(부수효과 없음에 가깝게). 의도 판정·실행은 domain/app 에 위임한다.
 */
import type { DragModifiers, DragIntent } from '@renderer/domain/rules/dragIntent'

/** 드롭 대상 후보(패널 빈영역 또는 폴더 항목). */
export interface DropTarget {
  readonly panelId: string
  /** 드롭 폴더 경로(빈영역=패널 폴더, 폴더 항목 위=그 폴더). */
  readonly destDir: string
  /** 폴더 항목 위면 그 항목 경로(하이라이트 표시용), 빈영역이면 null. */
  readonly overEntryPath: string | null
}

export interface DragState {
  readonly active: boolean
  readonly sources: string[]
  readonly sourcePanelId: string
  readonly sourceDir: string
  readonly mods: DragModifiers
  /** 커서 위치(툴팁 추종). */
  readonly cursor: { x: number; y: number }
  /** 현재 호버 중인 드롭 대상(없으면 null). */
  readonly target: DropTarget | null
  /** 현재 의도(표현용). drop 불가면 allowed=false. */
  readonly intent: DragIntent
  readonly allowed: boolean
  /** 차단/무시 사유 메시지(툴팁 보조). */
  readonly hint: string
}

const initial: DragState = {
  active: false,
  sources: [],
  sourcePanelId: '',
  sourceDir: '',
  mods: { ctrl: false, shift: false },
  cursor: { x: 0, y: 0 },
  target: null,
  intent: 'move',
  allowed: false,
  hint: ''
}

let state: DragState = initial
const listeners = new Set<() => void>()

function emit(): void {
  for (const l of listeners) l()
}

export function getDragState(): DragState {
  return state
}

export function subscribeDrag(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 상태 일부 갱신(불변 교체 → useSyncExternalStore 가 변화 감지). */
export function setDragState(patch: Partial<DragState>): void {
  state = { ...state, ...patch }
  emit()
}

/** 드래그 시작. */
export function beginDrag(
  sources: string[],
  sourcePanelId: string,
  sourceDir: string,
  mods: DragModifiers,
  cursor: { x: number; y: number }
): void {
  state = {
    active: true,
    sources,
    sourcePanelId,
    sourceDir,
    mods,
    cursor,
    target: null,
    intent: 'move',
    allowed: false,
    hint: ''
  }
  emit()
}

/** 드래그 종료(리셋). */
export function endDrag(): void {
  state = initial
  emit()
}
