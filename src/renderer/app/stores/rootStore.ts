/**
 * 루트 Zustand 스토어 — 슬라이스 합성 (ADR-002 §5.2).
 *
 * immer 미들웨어로 중첩 갱신을 간결화하되, selection/operations 처럼
 * 초고빈도·평탄 교체가 필요한 슬라이스는 객체를 통째로 교체한다(ADR-002 기준).
 *
 * Set 을 immer draft 안에서 다루기 위해 enableMapSet 을 켠다.
 */
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { enableMapSet } from 'immer'
import { createPanelsSlice } from './panelsSlice'
import { createSelectionSlice } from './selectionSlice'
import { createTabsSlice } from './tabsSlice'
import { createSidebarSlice } from './sidebarSlice'
import { createUiSlice } from './uiSlice'
import { createOperationsSlice } from './operationsSlice'
import { createAnalyzeSlice } from './analyzeSlice'
import { createTrashSlice } from './trashSlice'
import { createUndoSlice } from './undoSlice'
import type { AppStore } from './types'

enableMapSet()

export const useRootStore = create<AppStore>()(
  immer((...a) => ({
    ...createPanelsSlice(...a),
    ...createSelectionSlice(...a),
    ...createTabsSlice(...a),
    ...createSidebarSlice(...a),
    ...createUiSlice(...a),
    ...createOperationsSlice(...a),
    ...createAnalyzeSlice(...a),
    ...createTrashSlice(...a),
    ...createUndoSlice(...a)
  }))
)

/** 비-React 컨텍스트(유스케이스·디스패처)에서 스토어 접근. */
export const store = useRootStore
