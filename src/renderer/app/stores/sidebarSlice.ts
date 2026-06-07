/**
 * sidebarSlice — 트리(드라이브→폴더 lazy 확장)·폭·접힘 (SA §5.2).
 *
 * P2 범위: 드라이브 열거(fs:drives) → 노드, 폴더 노드 펼침 시 fs:tree-children
 * 으로 하위 폴더 지연 확장. 즐겨찾기/최근(favorites·recent)은 P5b 에서 채운다.
 *
 * Immer 적용(저빈도, 중첩). 트리는 path → TreeNode 평탄 맵으로 보유(재귀 갱신 회피).
 */
import type { TreeNode } from '@renderer/domain/entities'
import { fsApi } from '@renderer/infra/api'
import type { SliceCreator } from './types'

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
  /** 최근 방문 위치(최신 우선, recentLimit 적용, P5b). */
  readonly recent: string[]

  /** 드라이브 루트 노드 로드(App 부팅 시 1회). */
  loadDrives(): void
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
  /** 경로가 즐겨찾기인지. */
  isFavorite(path: string): boolean
  /**
   * 최근 방문 기록(맨 앞으로 이동·중복 제거·"내 PC" 제외).
   * recentLimit(uiSlice)로 잘라 보관한다.
   */
  recordRecent(path: string): void
  /** 최근 1개 제거. */
  removeRecent(path: string): void
  /** 최근 전체 비우기. */
  clearRecent(): void
  /** 세션 복원: 즐겨찾기·최근·폭·접힘 일괄 주입. */
  hydrateSidebar(data: {
    favorites: string[]
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
    recent: [],

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
      })
    },

    toggleFavorite(path) {
      if (path === '') return
      if (get().favorites.includes(path)) get().removeFavorite(path)
      else get().addFavorite(path)
    },

    isFavorite(path) {
      return get().favorites.includes(path)
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
        s.recent = data.recent.slice(0, limit)
        s.sidebarWidth = Math.max(160, Math.min(560, data.width))
        s.sidebarCollapsed = data.collapsed
      })
    }
  }
}
