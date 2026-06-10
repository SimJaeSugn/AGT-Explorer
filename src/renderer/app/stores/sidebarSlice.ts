/**
 * sidebarSlice — 트리(드라이브→폴더 lazy 확장)·폭·접힘 (SA §5.2).
 *
 * P2 범위: 드라이브 열거(fs:drives) → 노드, 폴더 노드 펼침 시 fs:tree-children
 * 으로 하위 폴더 지연 확장. 즐겨찾기/최근(favorites·recent)은 P5b 에서 채운다.
 *
 * Immer 적용(저빈도, 중첩). 트리는 path → TreeNode 평탄 맵으로 보유(재귀 갱신 회피).
 */
import type { TreeNode } from '@renderer/domain/entities'
import type { KnownFoldersDTO } from '@shared/dto'
import { fsApi } from '@renderer/infra/api'
import type { SliceCreator } from './types'

/** pinnedIn 미존재 시 반환할 안정 빈 배열(매 호출 새 배열 생성 방지 — 메모 안정). */
const EMPTY_PINNED: string[] = []

export interface SidebarSlice {
  /** path → TreeNode(평탄 맵). */
  readonly tree: Record<string, TreeNode>
  /** 루트(드라이브) 노드 경로 순서. */
  readonly treeRoots: string[]
  /** 사이드바 폭(px). */
  readonly sidebarWidth: number
  /** 접힘 여부. */
  readonly sidebarCollapsed: boolean
  /** 즐겨찾기 경로 목록(P5b, 사이드바 고정). */
  readonly favorites: string[]
  /** 즐겨찾기 별칭 맵(path → label, J8). 없으면 UI 가 basename 폴백. */
  readonly favoriteLabels: Record<string, string>
  /**
   * 디렉토리별 "상단 고정" 항목 맵(dirPath → 고정된 항목 경로 배열). 디렉토리 단위로
   * 고정 항목을 목록 맨 위에 표시한다(domain/rules/sort applyPins). 즐겨찾기와 동일한
   * per-위치 메타 패턴(favoriteLabels)을 따르고 세션에 영속한다.
   */
  readonly pinnedByDir: Record<string, string[]>
  /** 최근 방문 위치(최신 우선, recentLimit 적용, P5b). */
  readonly recent: string[]
  /** 빠른 위치(다운로드 등 OS 알려진 폴더). 부팅 시 1회 로드. 미로드 시 null. */
  readonly knownFolders: KnownFoldersDTO | null

  /** 드라이브 루트 노드 로드(App 부팅 시 1회). */
  loadDrives(): void
  /** 빠른 위치(알려진 폴더) 로드(App 부팅/사이드바 마운트 시 1회). */
  loadKnownFolders(): void
  /** 트리 노드 펼침/접힘 토글. 첫 펼침 시 자식 lazy 로드. */
  toggleTreeNode(path: string): void
  /** 사이드바 폭 조절. */
  setSidebarWidth(width: number): void
  /** 사이드바 접힘 토글. */
  toggleSidebar(): void

  // 즐겨찾기 / 최근 (P5b) ─────────────────────────────────────────────────
  /** 즐겨찾기 추가(중복·"내 PC" 무시). */
  addFavorite(path: string): void
  /** 즐겨찾기 제거. */
  removeFavorite(path: string): void
  /** 즐겨찾기 토글(있으면 제거, 없으면 추가). */
  toggleFavorite(path: string): void
  /**
   * 즐겨찾기 순서 재배열(N2·US-13.2). favorites 배열에서 from 인덱스 항목을 빼
   * to 인덱스에 삽입한다. 순서가 곧 단일 출처이므로 영속/복원은 기존 세션 경로가
   * 자동 처리(스키마 불변). 범위밖·동일 인덱스는 무동작(0~1개 경계 자연 충족).
   */
  reorderFavorite(from: number, to: number): void
  /** 경로가 즐겨찾기인지. */
  isFavorite(path: string): boolean
  /** 즐겨찾기 별칭 설정(빈 문자열이면 별칭 제거 → basename 표시, J8). */
  setFavoriteLabel(path: string, label: string): void
  /** 즐겨찾기 별칭 조회(없으면 undefined → UI 가 basename 폴백, J8). */
  favoriteLabelOf(path: string): string | undefined

  // 상단 고정(pin) ──────────────────────────────────────────────────────────
  /** dirPath 안에서 entryPath 의 고정 여부를 토글(없으면 추가·있으면 제거). */
  togglePin(dirPath: string, entryPath: string): void
  /** entryPath 가 dirPath 안에서 고정돼 있는지. */
  isPinned(dirPath: string, entryPath: string): boolean
  /** dirPath 의 고정 항목 경로 배열(없으면 빈 배열). 참조는 변경 시에만 새로 생성. */
  pinnedIn(dirPath: string): string[]
  /**
   * 최근 방문 기록(맨 앞으로 이동·중복 제거·"내 PC" 제외).
   * recentLimit(uiSlice)로 잘라 보관한다.
   */
  recordRecent(path: string): void
  /** 최근 1개 제거. */
  removeRecent(path: string): void
  /** 최근 전체 비우기. */
  clearRecent(): void
  /** 세션 복원: 즐겨찾기·별칭·고정·최근·폭·접힘 일괄 주입. */
  hydrateSidebar(data: {
    favorites: string[]
    favoriteLabels?: Record<string, string>
    pinnedByDir?: Record<string, string[]>
    recent: string[]
    width: number
    collapsed: boolean
  }): void
}

export const createSidebarSlice: SliceCreator<SidebarSlice> = (set, get) => {
  async function loadChildren(path: string): Promise<void> {
    set((s) => {
      const n = s.tree[path]
      if (n) n.loading = true
    })
    const res = await fsApi.treeChildren({ path })
    set((s) => {
      const n = s.tree[path]
      if (!n) return
      n.loading = false
      if (res.ok) {
        const childPaths: string[] = []
        for (const e of res.value) {
          childPaths.push(e.path)
          if (!s.tree[e.path]) {
            s.tree[e.path] = {
              path: e.path,
              label: e.name,
              kind: 'dir',
              expanded: false,
              loading: false,
              childPaths: null
            }
          }
        }
        n.childPaths = childPaths
      } else {
        n.childPaths = []
      }
    })
  }

  return {
    tree: {},
    treeRoots: [],
    sidebarWidth: 240,
    sidebarCollapsed: false,
    favorites: [],
    favoriteLabels: {},
    pinnedByDir: {},
    recent: [],
    knownFolders: null,

    loadKnownFolders() {
      void (async () => {
        const res = await fsApi.knownFolders()
        if (!res.ok) return
        set((s) => {
          s.knownFolders = res.value
        })
      })()
    },

    loadDrives() {
      void (async () => {
        const res = await fsApi.drives()
        if (!res.ok) return
        set((s) => {
          s.treeRoots = []
          for (const d of res.value) {
            s.tree[d.path] = {
              path: d.path,
              label: d.label,
              kind: 'drive',
              expanded: false,
              loading: false,
              childPaths: null
            }
            s.treeRoots.push(d.path)
          }
        })
      })()
    },

    toggleTreeNode(path) {
      const node = get().tree[path]
      if (!node) return
      const willExpand = !node.expanded
      set((s) => {
        const n = s.tree[path]
        if (n) n.expanded = willExpand
      })
      if (willExpand && node.childPaths === null && !node.loading) {
        void loadChildren(path)
      }
    },

    setSidebarWidth(width) {
      set((s) => {
        s.sidebarWidth = Math.max(160, Math.min(560, width))
      })
    },

    toggleSidebar() {
      set((s) => {
        s.sidebarCollapsed = !s.sidebarCollapsed
      })
    },

    addFavorite(path) {
      if (path === '') return // "내 PC" 는 즐겨찾기 대상 아님.
      set((s) => {
        if (!s.favorites.includes(path)) s.favorites.push(path)
      })
    },

    removeFavorite(path) {
      set((s) => {
        s.favorites = s.favorites.filter((p) => p !== path)
        // 고아 라벨 정리(J8).
        if (s.favoriteLabels[path] !== undefined) delete s.favoriteLabels[path]
      })
    },

    toggleFavorite(path) {
      if (path === '') return
      if (get().favorites.includes(path)) get().removeFavorite(path)
      else get().addFavorite(path)
    },

    reorderFavorite(from, to) {
      set((s) => {
        const n = s.favorites.length
        // 범위 가드(0~1개·동일 인덱스 무동작 — 즐겨찾기 외 데이터 불변).
        if (from < 0 || from >= n || to < 0 || to >= n || from === to) return
        const [moved] = s.favorites.splice(from, 1)
        if (moved === undefined) return
        s.favorites.splice(to, 0, moved)
      })
    },

    isFavorite(path) {
      return get().favorites.includes(path)
    },

    setFavoriteLabel(path, label) {
      const trimmed = label.trim()
      set((s) => {
        if (trimmed === '') delete s.favoriteLabels[path]
        else s.favoriteLabels[path] = trimmed
      })
    },

    favoriteLabelOf(path) {
      return get().favoriteLabels[path]
    },

    togglePin(dirPath, entryPath) {
      set((s) => {
        const cur = s.pinnedByDir[dirPath]
        if (cur && cur.includes(entryPath)) {
          const next = cur.filter((p) => p !== entryPath)
          if (next.length === 0) delete s.pinnedByDir[dirPath]
          else s.pinnedByDir[dirPath] = next
        } else {
          s.pinnedByDir[dirPath] = cur ? [...cur, entryPath] : [entryPath]
        }
      })
    },

    isPinned(dirPath, entryPath) {
      return get().pinnedByDir[dirPath]?.includes(entryPath) ?? false
    },

    pinnedIn(dirPath) {
      return get().pinnedByDir[dirPath] ?? EMPTY_PINNED
    },

    recordRecent(path) {
      if (path === '') return // "내 PC" 는 최근 기록 제외.
      const limit = Math.max(0, Math.trunc(get().recentLimit ?? 10))
      set((s) => {
        const next = [path, ...s.recent.filter((p) => p !== path)]
        s.recent = next.slice(0, limit)
      })
    },

    removeRecent(path) {
      set((s) => {
        s.recent = s.recent.filter((p) => p !== path)
      })
    },

    clearRecent() {
      set((s) => {
        s.recent = []
      })
    },

    hydrateSidebar(data) {
      const limit = Math.max(0, Math.trunc(get().recentLimit ?? 10))
      set((s) => {
        s.favorites = [...data.favorites]
        // 별칭 맵: favorites 에 존재하는 키만 보존(고아 제거).
        const labels: Record<string, string> = {}
        if (data.favoriteLabels) {
          const favSet = new Set(data.favorites)
          for (const [k, v] of Object.entries(data.favoriteLabels)) {
            if (favSet.has(k) && typeof v === 'string' && v.trim() !== '') labels[k] = v
          }
        }
        s.favoriteLabels = labels
        // 고정 맵: 값이 문자열 배열인 항목만 보존(빈 배열 키는 제외 — 무의미).
        const pinned: Record<string, string[]> = {}
        if (data.pinnedByDir) {
          for (const [dir, arr] of Object.entries(data.pinnedByDir)) {
            if (Array.isArray(arr)) {
              const clean = arr.filter((x): x is string => typeof x === 'string')
              if (clean.length > 0) pinned[dir] = clean
            }
          }
        }
        s.pinnedByDir = pinned
        s.recent = data.recent.slice(0, limit)
        s.sidebarWidth = Math.max(160, Math.min(560, data.width))
        s.sidebarCollapsed = data.collapsed
      })
    }
  }
}
