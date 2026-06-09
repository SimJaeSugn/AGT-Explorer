/**
 * dedupSlice — 중복 파일 찾기 상태 (§R2·US-17.2·F23·ADR-009).
 *
 * 백엔드 `hash:dup:*`(start/progress/done·hash:cancel)가 산출한 중복 그룹과
 * 탐지 진행률·선택(정리 대상)·다이얼로그 열림을 보유한다. 실제 IPC 호출·구독은
 * usecases/dedup 가 담당하고(app→infra 경계), 이 슬라이스는 데이터·선택만 다룬다
 * (analyzeSlice/trashSlice 동형 — Immer 슬라이스, 고빈도 아님).
 *
 * 상태머신: idle → scanning(jobId 보관·진행률) → ready(그룹 수용) | error | canceled.
 * 진행률은 200ms 스로틀된 hash:dup:progress 미러(스캔 항목·바이트·현재 경로).
 *
 * 모달 열림(dedupOpen)·inputContext 'dialog' 게이트는 uiSlice 가 보유한다
 * (trashOpen 동형). 이 슬라이스는 탐지 데이터·선택만 다룬다.
 */
import type { DupGroupDTO } from '@shared/dto'
import { selectAllButOneForAll } from '@renderer/domain/rules/dupGroup'
import type { SliceCreator } from './types'

export type DedupStatus = 'idle' | 'scanning' | 'ready' | 'error' | 'canceled'

export interface DedupSlice {
  /** 탐지 상태머신. */
  readonly dedupStatus: DedupStatus
  /** 진행 중 잡 식별(hash:dup:start 발급, progress/done 상관). 없으면 null. */
  readonly dedupJobId: string | null
  /** 탐지 범위(roots — 표시·재시도용). */
  readonly dedupRoots: string[]
  /** 탐지된 중복 그룹(ready 일 때). */
  readonly dedupGroups: DupGroupDTO[]
  /** 정리(삭제) 대상으로 선택된 파일 경로 집합. */
  readonly dedupSelected: Set<string>
  /** 진행률: 스캔한 항목 수. */
  readonly dedupScannedItems: number
  /** 진행률: 스캔한 바이트(해시 진행). */
  readonly dedupScannedBytes: number
  /** 진행률: 현재 처리 중 경로(표시용). */
  readonly dedupCurrentPath: string
  /** 결과 항목 상한 도달(정직 표기). */
  readonly dedupTruncated: boolean
  /** 오류 메시지(없으면 null). */
  readonly dedupError: string | null

  // usecase 브리지(usecases/dedup 가 호출) ─────────────────────────────────
  /** 탐지 시작(jobId·roots 보관·상태 scanning·이전 결과/선택 비움). */
  beginDedup(jobId: string, roots: readonly string[]): void
  /** 진행률 미러(hash:dup:progress). */
  _dedupProgress(scannedItems: number, scannedBytes: number, currentPath: string): void
  /** 그룹 수용(hash:dup:done) — status=ready, "원본 1개 보존" 기본 선택 자동 채움. */
  _dedupDone(groups: readonly DupGroupDTO[], truncated: boolean): void
  /** 탐지 오류(hash:error 또는 시작 실패). */
  _dedupError(message: string): void
  /** 취소 표시(hash:cancel 호출 후). */
  markDedupCanceling(): void

  // 선택 ────────────────────────────────────────────────────────────────
  /** 단일 파일 선택 토글(정리 대상). */
  toggleDedupSelect(path: string): void
  /** 경로 묶음 일괄 선택/해제(그룹 단위·"원본 외 전체"). */
  setDedupSelection(paths: readonly string[], selected: boolean): void
  /** 모든 그룹에 "원본 1개 보존" 추천 선택 적용. */
  selectRecommended(): void
  /** 선택 전체 해제. */
  clearDedupSelection(): void

  // 정리 후 제거(휴지통 보낸 경로 결과 반영) ───────────────────────────────
  /** 휴지통으로 보낸 경로를 그룹/선택에서 제거(2개 미만 남은 그룹은 해소 — 비파괴 재계산). */
  removeDedupPaths(paths: readonly string[]): void
}

export const createDedupSlice: SliceCreator<DedupSlice> = (set) => ({
  dedupStatus: 'idle',
  dedupJobId: null,
  dedupRoots: [],
  dedupGroups: [],
  dedupSelected: new Set<string>(),
  dedupScannedItems: 0,
  dedupScannedBytes: 0,
  dedupCurrentPath: '',
  dedupTruncated: false,
  dedupError: null,

  beginDedup(jobId, roots) {
    set((s) => {
      s.dedupStatus = 'scanning'
      s.dedupJobId = jobId
      s.dedupRoots = [...roots]
      s.dedupGroups = []
      s.dedupSelected = new Set<string>()
      s.dedupScannedItems = 0
      s.dedupScannedBytes = 0
      s.dedupCurrentPath = ''
      s.dedupTruncated = false
      s.dedupError = null
    })
  },

  _dedupProgress(scannedItems, scannedBytes, currentPath) {
    set((s) => {
      if (s.dedupStatus !== 'scanning') return
      s.dedupScannedItems = scannedItems
      s.dedupScannedBytes = scannedBytes
      s.dedupCurrentPath = currentPath
    })
  },

  _dedupDone(groups, truncated) {
    const recommended = selectAllButOneForAll(groups)
    set((s) => {
      s.dedupStatus = 'ready'
      s.dedupGroups = groups.map((g) => ({ ...g, files: [...g.files] }))
      s.dedupTruncated = truncated
      s.dedupCurrentPath = ''
      // 기본 추천 선택(원본 1개 보존 외 전체) — 사용자가 조정 가능.
      s.dedupSelected = new Set<string>(recommended)
    })
  },

  _dedupError(message) {
    set((s) => {
      s.dedupStatus = 'error'
      s.dedupError = message
      s.dedupJobId = null
    })
  },

  markDedupCanceling() {
    set((s) => {
      if (s.dedupStatus === 'scanning') {
        s.dedupStatus = 'canceled'
        s.dedupJobId = null
        s.dedupCurrentPath = ''
      }
    })
  },

  toggleDedupSelect(path) {
    set((s) => {
      if (s.dedupSelected.has(path)) s.dedupSelected.delete(path)
      else s.dedupSelected.add(path)
    })
  },

  setDedupSelection(paths, selected) {
    set((s) => {
      if (selected) for (const p of paths) s.dedupSelected.add(p)
      else for (const p of paths) s.dedupSelected.delete(p)
    })
  },

  selectRecommended() {
    set((s) => {
      s.dedupSelected = new Set<string>(selectAllButOneForAll(s.dedupGroups))
    })
  },

  clearDedupSelection() {
    set((s) => {
      s.dedupSelected = new Set<string>()
    })
  },

  removeDedupPaths(paths) {
    const gone = new Set(paths)
    set((s) => {
      // 그룹에서 삭제된 경로 제거 후 2개 미만(중복 아님)인 그룹은 드롭.
      s.dedupGroups = s.dedupGroups
        .map((g) => ({ ...g, files: g.files.filter((f) => !gone.has(f.path)) }))
        .filter((g) => g.files.length >= 2)
      // 선택에서도 제거.
      const next = new Set<string>()
      for (const p of s.dedupSelected) if (!gone.has(p)) next.add(p)
      // 그룹에 더 이상 없는 경로(드롭된 그룹의 잔여)도 정리.
      const live = new Set<string>()
      for (const g of s.dedupGroups) for (const f of g.files) live.add(f.path)
      const cleaned = new Set<string>()
      for (const p of next) if (live.has(p)) cleaned.add(p)
      s.dedupSelected = cleaned
    })
  }
})
