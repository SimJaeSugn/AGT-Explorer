/**
 * trashSlice — 휴지통 관리 화면 상태 (K장 K2).
 *
 * Immer 슬라이스(고빈도 아님). analyzeSlice/uiSlice 모달 패턴 참고.
 * trash:list 결과·선택 집합·로딩/에러 상태를 보유한다. 실제 IPC 호출은
 * usecases/trash 가 담당하고, 이 슬라이스는 데이터·선택만 다룬다.
 *
 * 모달 열림(trashOpen)·열고닫기 액션은 uiSlice 가 보유한다(dashboardOpen 동형 —
 * inputContext='dialog' 게이트 합류). 이 슬라이스는 목록 데이터·선택만 다룬다.
 */
import type { TrashItemDTO } from '@shared/dto'
import type { SliceCreator } from './types'

export type TrashStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface TrashSlice {
  /** 목록 로드 상태. */
  readonly trashStatus: TrashStatus
  /** trash:list 결과 항목(정렬은 소비측에서). */
  readonly trashItems: TrashItemDTO[]
  /** 선택된 항목 id 집합(복원 대상). */
  readonly trashSelected: Set<string>
  /** 오류 메시지(없으면 null). */
  readonly trashError: string | null

  // usecase 브리지(loadTrash/restoreSelected 가 호출) ──────────────────────
  /** 로드 시작(status=loading, 에러 초기화). */
  _trashLoading(): void
  /** 목록 반영(status=ready, 사라진 선택 정리). */
  _setTrashItems(items: TrashItemDTO[]): void
  /** 로드/복원/비우기 오류(status=error). */
  _trashError(message: string): void

  // 선택 ────────────────────────────────────────────────────────────────
  /** 항목 선택 토글. */
  toggleTrashSelect(id: string): void
  /** 전체 선택/해제(현재 목록 기준). */
  setAllTrashSelected(selected: boolean): void
  /** 선택 비우기. */
  clearTrashSelection(): void
}

export const createTrashSlice: SliceCreator<TrashSlice> = (set) => ({
  trashStatus: 'idle',
  trashItems: [],
  trashSelected: new Set<string>(),
  trashError: null,

  _trashLoading() {
    set((s) => {
      s.trashStatus = 'loading'
      s.trashError = null
    })
  },

  _setTrashItems(items) {
    set((s) => {
      s.trashItems = items
      s.trashStatus = 'ready'
      s.trashError = null
      // 사라진 항목은 선택에서 제거.
      const live = new Set(items.map((i) => i.id))
      const next = new Set<string>()
      for (const id of s.trashSelected) if (live.has(id)) next.add(id)
      s.trashSelected = next
    })
  },

  _trashError(message) {
    set((s) => {
      s.trashStatus = 'error'
      s.trashError = message
    })
  },

  toggleTrashSelect(id) {
    set((s) => {
      if (s.trashSelected.has(id)) s.trashSelected.delete(id)
      else s.trashSelected.add(id)
    })
  },

  setAllTrashSelected(selected) {
    set((s) => {
      if (selected) s.trashSelected = new Set(s.trashItems.map((i) => i.id))
      else s.trashSelected = new Set<string>()
    })
  },

  clearTrashSelection() {
    set((s) => {
      s.trashSelected = new Set<string>()
    })
  }
})
