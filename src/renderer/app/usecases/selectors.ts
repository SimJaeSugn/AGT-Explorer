/**
 * 파생 셀렉터 — 정렬·필터 적용된 가시 엔트리 (ADR-004 파생 메모이즈).
 *
 * 정렬/필터는 domain 순수 함수로 계산하고, 입력(entries·view·query)이 같으면
 * 재계산하지 않도록 패널별 1-슬롯 메모를 둔다(가상 스크롤 성능, SA §6.3).
 *
 * UI(FileListView)·CommandBus 가 공유한다.
 */
import type { FileEntryDTO } from '@shared/dto'
import type { Panel } from '@renderer/domain/entities'
import { applyPins, sortEntries } from '@renderer/domain/rules/sort'
import { filterEntries } from '@renderer/domain/rules/filter'
import { store } from '@renderer/app/stores/rootStore'

interface MemoSlot {
  entries: readonly FileEntryDTO[]
  sortKey: string
  sortDir: string
  folderFirst: boolean
  query: string
  /** 이 패널 경로의 고정 항목 배열(참조 동일성으로 메모 무효화 판정). */
  pinned: readonly string[]
  result: FileEntryDTO[]
}

const memo = new Map<string, MemoSlot>()

/** 패널의 가시 엔트리(정렬+필터). 메모 적중 시 동일 참조 반환. */
export function computeVisible(panel: Panel): FileEntryDTO[] {
  const { entries } = panel.directory
  const { sortKey, sortDir, folderFirst } = panel.view
  const query = panel.filter.open ? panel.filter.query : ''
  // 이 패널 경로에 고정된 항목(상단 고정 기능). 변경 시에만 새 배열 참조 → 메모 무효화.
  const pinned = store.getState().pinnedIn(panel.path)

  const slot = memo.get(panel.id)
  if (
    slot &&
    slot.entries === entries &&
    slot.sortKey === sortKey &&
    slot.sortDir === sortDir &&
    slot.folderFirst === folderFirst &&
    slot.query === query &&
    slot.pinned === pinned
  ) {
    return slot.result
  }

  const filtered = filterEntries(entries, query)
  const sorted = sortEntries(filtered, sortKey, sortDir, folderFirst)
  const result = applyPins(sorted, new Set(pinned))
  memo.set(panel.id, { entries, sortKey, sortDir, folderFirst, query, pinned, result })
  return result
}

/** panelId 로 가시 엔트리 조회(비-React 컨텍스트용). */
export function visibleEntries(panelId: string): FileEntryDTO[] {
  const panel = store.getState().panels[panelId]
  if (!panel) return []
  return computeVisible(panel)
}

/**
 * 필터가 활성(검색창 열림 + 비어있지 않은 쿼리)인지 + 결과/전체 개수.
 * 상태바 "필터 결과 N/M" 표기용 파생값.
 */
export interface FilterInfo {
  readonly active: boolean
  readonly matched: number
  readonly total: number
}

export function filterInfo(panel: Panel): FilterInfo {
  const total = panel.directory.entries.length
  const active = panel.filter.open && panel.filter.query.trim().length > 0
  if (!active) return { active: false, matched: total, total }
  return { active: true, matched: computeVisible(panel).length, total }
}
