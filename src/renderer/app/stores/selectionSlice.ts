/**
 * selectionSlice — 패널별 다중 선택 상태 (SA §5.2, Immer 제외 대상).
 *
 * 초고빈도 갱신이라 ADR-002 기준 "수동 set(Set 직접 조작)"을 따른다.
 * immer 미들웨어 안에서도 selection 객체를 **통째로 교체**하면 Set 구조공유
 * 비용을 피하고 셀렉터 리렌더를 선택 패널로 격리할 수 있다.
 *
 * 선택 연산 규칙은 domain/rules/selection 에 위임(순수 함수).
 */
import {
  applySelect,
  clear as clearSel,
  emptySelection,
  modeFromModifiers,
  selectAll as selectAllSel,
  type SelectionState
} from '@renderer/domain/rules/selection'
import type { SliceCreator } from './types'

export interface SelectionSlice {
  /** panelId → SelectionState. */
  readonly selection: Record<string, SelectionState>

  /** 패널의 선택 상태 초기화(패널 추가/경로 이동 시). */
  resetSelection(panelId: string): void
  /** 패널 선택 상태 제거(패널 삭제 시). */
  dropSelection(panelId: string): void
  /** 클릭(수정자 포함) → 선택 갱신. visiblePaths 는 화면 순서. */
  clickSelect(
    panelId: string,
    visiblePaths: readonly string[],
    index: number,
    ctrl: boolean,
    shift: boolean
  ): void
  /** Ctrl+A 전체 선택. */
  selectAll(panelId: string, visiblePaths: readonly string[]): void
  /** 키보드 이동(↑/↓)으로 단일 선택 이동. */
  moveSelect(panelId: string, visiblePaths: readonly string[], index: number): void
  /** 선택 해제. */
  clearSelection(panelId: string): void
}

export const createSelectionSlice: SliceCreator<SelectionSlice> = (set, get) => ({
  selection: {},

  resetSelection(panelId) {
    set((s) => {
      s.selection[panelId] = emptySelection
    })
  },

  dropSelection(panelId) {
    set((s) => {
      delete s.selection[panelId]
    })
  },

  clickSelect(panelId, visiblePaths, index, ctrl, shift) {
    const prev = get().selection[panelId] ?? emptySelection
    const mode = modeFromModifiers(ctrl, shift)
    const next = applySelect(prev, visiblePaths, index, mode)
    set((s) => {
      s.selection[panelId] = next
    })
  },

  selectAll(panelId, visiblePaths) {
    const next = selectAllSel(visiblePaths)
    set((s) => {
      s.selection[panelId] = next
    })
  },

  moveSelect(panelId, visiblePaths, index) {
    const prev = get().selection[panelId] ?? emptySelection
    const next = applySelect(prev, visiblePaths, index, 'single')
    set((s) => {
      s.selection[panelId] = next
    })
  },

  clearSelection(panelId) {
    set((s) => {
      s.selection[panelId] = clearSel()
    })
  }
})
