/**
 * useFavoriteReorder — 사이드바 즐겨찾기 전용 경량 드래그 재정렬 (§N N2·US-13.2·F18).
 *
 * 설계 결정(SW §12.2): 파일 D&D(ui/dnd/useDrag·dragState)는 "파일 경로 묶음 →
 * 드롭 폴더 → 복사/이동" 전용 모델이라 의미가 전혀 다르다(드롭 대상=폴더 아님·
 * 전송 아님). 억지 재사용 대신 **사이드바 전용 경량 구현**을 둔다 — 파일 dragState
 * 패턴(외부 pub/sub + useSyncExternalStore)을 *형태만* 모방한 별개 인스턴스.
 *
 * 상태: 드래그 중인 즐겨찾기 인덱스(fromIndex)·삽입 위치 인디케이터(insertIndex).
 * 포인터 이벤트로 즐겨찾기 컨테이너 경계 안에서만 추적하고, 타 섹션은 무영향.
 * 드롭 시 reorderFavorite(from, to) 호출(인덱스 환산은 Sidebar 가 수행).
 *
 * 부수효과: 외부 스토어(이 모듈 지역)·window 포인터 리스너만. React 외부 경량 스토어.
 */
import { useSyncExternalStore } from 'react'

/** 즐겨찾기 재정렬 진행 상태(파일 dragState 와 별개 인스턴스). */
export interface FavoriteReorderState {
  /** 드래그 활성 여부. */
  readonly active: boolean
  /** 드래그 시작 항목의 즐겨찾기 인덱스(비활성 -1). */
  readonly fromIndex: number
  /**
   * 삽입 위치 인디케이터 인덱스(행 사이 선). 0..length 범위.
   * 예: 0=첫 항목 앞, length=마지막 항목 뒤. 비활성·무효 -1.
   */
  readonly insertIndex: number
}

const initial: FavoriteReorderState = { active: false, fromIndex: -1, insertIndex: -1 }

let state: FavoriteReorderState = initial
const listeners = new Set<() => void>()

function emit(): void {
  for (const l of listeners) l()
}

/** 현재 재정렬 상태(읽기). */
export function getFavoriteReorderState(): FavoriteReorderState {
  return state
}

/** 상태 구독(useSyncExternalStore 용). */
export function subscribeFavoriteReorder(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 드래그 시작(fromIndex 항목을 잡음). insertIndex 초기값=fromIndex. */
export function beginFavoriteReorder(fromIndex: number): void {
  state = { active: true, fromIndex, insertIndex: fromIndex }
  emit()
}

/** 삽입 위치 갱신(행 사이 인디케이터). 0..length. */
export function setFavoriteInsertIndex(insertIndex: number): void {
  if (!state.active || state.insertIndex === insertIndex) return
  state = { ...state, insertIndex }
  emit()
}

/** 드래그 종료(리셋). 드롭 성공/취소 공통. */
export function endFavoriteReorder(): void {
  if (state === initial) return
  state = initial
  emit()
}

/**
 * insertIndex(0..length, 행 사이 위치)를 reorderFavorite(from, to) 의 to 인덱스로 환산.
 * 항목을 from 에서 제거 후 insert 위치에 넣으므로, insert > from 이면 -1 보정.
 * @returns 유효 이동이면 to 인덱스, 무동작(같은 자리)이면 null.
 */
export function resolveDropTarget(from: number, insertIndex: number, length: number): number | null {
  if (from < 0 || from >= length) return null
  if (insertIndex < 0 || insertIndex > length) return null
  // 제거 후 삽입 기준으로 환산.
  let to = insertIndex > from ? insertIndex - 1 : insertIndex
  if (to < 0) to = 0
  if (to > length - 1) to = length - 1
  return to === from ? null : to
}

/** React 컴포넌트용 구독 훅. */
export function useFavoriteReorder(): FavoriteReorderState {
  return useSyncExternalStore(subscribeFavoriteReorder, getFavoriteReorderState, getFavoriteReorderState)
}
