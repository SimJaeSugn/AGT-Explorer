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
import { matchesTags, type TagKey } from '@renderer/domain/rules/tags'
import { store } from '@renderer/app/stores/rootStore'

interface MemoSlot {
  entries: readonly FileEntryDTO[]
  sortKey: string
  sortDir: string
  folderFirst: boolean
  query: string
  /** 이 패널 경로의 고정 항목 배열(참조 동일성으로 메모 무효화 판정). */
  pinned: readonly string[]
  /** 활성 태그 필터 Set(참조 동일성으로 메모 무효화 판정 — T1). */
  activeTags: ReadonlySet<TagKey>
  /** tagsByPath 맵 참조(태그 재할당 시 결과 무효화 — T1). */
  tagsByPath: Record<string, TagKey[]>
  result: FileEntryDTO[]
}

const memo = new Map<string, MemoSlot>()

/** 패널의 가시 엔트리(정렬+이름필터+태그필터). 메모 적중 시 동일 참조 반환. */
export function computeVisible(panel: Panel): FileEntryDTO[] {
  const { entries } = panel.directory
  const { sortKey, sortDir, folderFirst } = panel.view
  const query = panel.filter.open ? panel.filter.query : ''
  // 이 패널 경로에 고정된 항목(상단 고정 기능). 변경 시에만 새 배열 참조로 메모 무효화.
  const st = store.getState()
  const pinned = st.pinnedIn(panel.path)
  // T1: 활성 태그 필터(패널별)·태그 맵. 참조 동일성으로 메모 무효화(둘 다 변경 시 새 참조).
  const activeTags = st.activeTagsOf(panel.id)
  const tagsByPath = st.tagsByPath

  const slot = memo.get(panel.id)
  if (
    slot &&
    slot.entries === entries &&
    slot.sortKey === sortKey &&
    slot.sortDir === sortDir &&
    slot.folderFirst === folderFirst &&
    slot.query === query &&
    slot.pinned === pinned &&
    slot.activeTags === activeTags &&
    slot.tagsByPath === tagsByPath
  ) {
    return slot.result
  }

  // 이름 부분일치 필터(빈 쿼리면 원본 참조 그대로 반환 — 메모 친화).
  const named = filterEntries(entries, query)
  // T1: 태그 필터 합성(이름필터 AND 태그필터). 활성 태그 0개면 항등(matchesTags=true).
  const filtered =
    activeTags.size === 0 ? named : named.filter((e) => matchesTags(tagsByPath[e.path], activeTags))
  const sorted = sortEntries(filtered, sortKey, sortDir, folderFirst)
  const result = applyPins(sorted, new Set(pinned))
  memo.set(panel.id, {
    entries,
    sortKey,
    sortDir,
    folderFirst,
    query,
    pinned,
    activeTags,
    tagsByPath,
    result
  })
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
