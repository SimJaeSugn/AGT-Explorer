/**
 * tagsSlice — 파일 태그/색상 라벨 상태 (T1·US-19.1, SA §5.2 저빈도·전역 메타).
 *
 * 두 축을 보유한다:
 *  (1) tagsByPath: path → TagKey[] — 항목별 태그 할당(다중 가능). 세션 메타에 영속.
 *  (2) activeTagsByPanel: panelId → Set<TagKey> — 패널별 활성 태그 필터(휘발 — 미영속).
 *
 * favoriteLabels/pinnedByDir 와 동일한 per-경로 메타 패턴을 따른다(Immer·저빈도 갱신).
 * 영속: buildSessionSnapshot 이 ui/sidebar 와 함께 tagsByPath 를 직렬화하고 applySnapshot
 * 이 hydrate 한다(스키마 버전 미상향 — coerce 폴백). 클램프/정규화 단일 출처는
 * domain/rules/tags(normalizeTags·isTagKey).
 *
 * 활성 태그 필터(activeTagsByPanel)는 selection 처럼 휘발이라 세션에 넣지 않는다.
 */
import { normalizeTags, type TagKey } from '@renderer/domain/rules/tags'
import type { SliceCreator } from './types'

/** tagsFor 미존재 시 반환할 안정 빈 배열(매 호출 새 배열 방지 — 메모/렌더 안정). */
const EMPTY_TAGS: TagKey[] = []
/** 활성 태그 미존재 시 반환할 안정 빈 Set(참조 안정). */
const EMPTY_ACTIVE: ReadonlySet<TagKey> = new Set<TagKey>()

export interface TagsSlice {
  /** path → 태그 키 배열(다중). 빈 배열 키는 보존하지 않는다(없음과 동일). */
  readonly tagsByPath: Record<string, TagKey[]>
  /** panelId → 활성 태그 필터 집합(휘발 — 세션 미영속). */
  readonly activeTagsByPanel: Record<string, Set<TagKey>>

  /** path 의 태그 키 배열(없으면 안정 빈 배열). 참조는 변경 시에만 새로 생성. */
  tagsFor(path: string): TagKey[]
  /** path 에서 key 태그를 토글(있으면 제거·없으면 추가). 빈 배열이면 키 삭제. */
  toggleTag(path: string, key: TagKey): void
  /** path 의 태그를 일괄 설정(정규화 후 적용·빈 배열이면 키 삭제). */
  setTags(path: string, keys: readonly TagKey[]): void
  /** path 의 태그를 전부 제거. */
  clearTags(path: string): void

  /** panelId 의 활성 태그 필터 집합(없으면 안정 빈 Set). */
  activeTagsOf(panelId: string): ReadonlySet<TagKey>
  /** panelId 에서 key 활성 태그 필터를 토글(필터 칩 on/off). */
  toggleActiveTag(panelId: string, key: TagKey): void
  /** panelId 의 활성 태그 필터를 전부 해제. */
  clearActiveTags(panelId: string): void

  /** 세션 복원: tagsByPath 일괄 주입(정규화 후 적용). */
  hydrateTags(tagsByPath: unknown): void
}

export const createTagsSlice: SliceCreator<TagsSlice> = (set, get) => ({
  tagsByPath: {},
  activeTagsByPanel: {},

  tagsFor(path) {
    return get().tagsByPath[path] ?? EMPTY_TAGS
  },

  toggleTag(path, key) {
    set((s) => {
      const cur = s.tagsByPath[path]
      if (cur && cur.includes(key)) {
        const next = cur.filter((k) => k !== key)
        if (next.length === 0) delete s.tagsByPath[path]
        else s.tagsByPath[path] = next
      } else {
        // 추가 후 팔레트 순서로 정규화(표시 안정).
        s.tagsByPath[path] = normalizeTags(cur ? [...cur, key] : [key])
      }
    })
  },

  setTags(path, keys) {
    const next = normalizeTags(keys)
    set((s) => {
      if (next.length === 0) delete s.tagsByPath[path]
      else s.tagsByPath[path] = next
    })
  },

  clearTags(path) {
    set((s) => {
      delete s.tagsByPath[path]
    })
  },

  activeTagsOf(panelId) {
    return get().activeTagsByPanel[panelId] ?? EMPTY_ACTIVE
  },

  toggleActiveTag(panelId, key) {
    set((s) => {
      const cur = s.activeTagsByPanel[panelId]
      if (cur && cur.has(key)) {
        cur.delete(key)
        if (cur.size === 0) delete s.activeTagsByPanel[panelId]
      } else if (cur) {
        cur.add(key)
      } else {
        s.activeTagsByPanel[panelId] = new Set<TagKey>([key])
      }
    })
  },

  clearActiveTags(panelId) {
    set((s) => {
      delete s.activeTagsByPanel[panelId]
    })
  },

  hydrateTags(tagsByPath) {
    // raw(디스크) → 경로별 정규화된 태그 배열만 보존(빈 배열 키 제외).
    const out: Record<string, TagKey[]> = {}
    if (tagsByPath && typeof tagsByPath === 'object' && !Array.isArray(tagsByPath)) {
      for (const [path, arr] of Object.entries(tagsByPath as Record<string, unknown>)) {
        if (!Array.isArray(arr)) continue
        const clean = normalizeTags(arr)
        if (clean.length > 0) out[path] = clean
      }
    }
    set((s) => {
      s.tagsByPath = out
    })
  }
})
