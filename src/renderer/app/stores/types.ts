/**
 * 스토어 슬라이스 합성 타입 (app/stores/types).
 *
 * 각 슬라이스는 StateCreator 로 정의되고 rootStore 가 합성한다(ADR-002 §5.2).
 * 슬라이스 간 상호 호출이 필요하면 get() 으로 전체 상태에 접근한다.
 */
import type { StateCreator } from 'zustand'
import type { PanelsSlice } from './panelsSlice'
import type { SelectionSlice } from './selectionSlice'
import type { TabsSlice } from './tabsSlice'
import type { SidebarSlice } from './sidebarSlice'
import type { UiSlice } from './uiSlice'
import type { OperationsSlice } from './operationsSlice'
import type { AnalyzeSlice } from './analyzeSlice'

/** 전체 스토어 상태 = 모든 슬라이스의 교집합. */
export type AppStore = PanelsSlice &
  SelectionSlice &
  TabsSlice &
  SidebarSlice &
  UiSlice &
  OperationsSlice &
  AnalyzeSlice

/** 슬라이스 생성자 시그니처(immer 미들웨어 가정 — set 은 mutate 가능). */
export type SliceCreator<T> = StateCreator<
  AppStore,
  [['zustand/immer', never]],
  [],
  T
>
