/**
 * iconBarItems — 상단 전역 아이콘바 버튼 정의 테이블(H-3, 데이터).
 *
 * keybindings/index.ts 가 단축키를 데이터로 선언한 패턴과 동형. 각 항목은
 * commandId·라벨·글리프·그룹과 enabled/active 셀렉터를 선언한다. IconBar 는
 * 이 테이블을 렌더하고 클릭은 무조건 execCommand(commandId) 로 수렴한다(D-1).
 *
 * 활성조건(enabled)·눌림표시(active)는 RootState 를 받아 파생 — IconBar 는
 * 셀렉터 격리를 위해 항목별 최소 상태만 구독한다.
 */
import type { AppStore } from '@renderer/app/stores/types'
import { isMyPc } from '@renderer/domain/paths'
import { KEYBINDINGS } from '@renderer/domain/keybindings'
import { prettyChord } from '@renderer/ui/keyboard/shortcuts'

/** 아이콘바 버튼 1개의 선언. */
export interface IconBarItem {
  /** 발행할 commandId(execCommand 수렴). */
  readonly id: string
  /** title·aria-label 표시명. */
  readonly label: string
  /** 임시 텍스트 글리프(P7 아이콘셋 전). */
  readonly icon: string
  /** 구분선 그룹. */
  readonly group: 'layout' | 'file' | 'nav' | 'tool'
  /** 활성 여부(false 면 disabled + 흐림). 미지정 시 항상 활성. */
  enabled?(s: AppStore): boolean
  /** 토글형 눌림표시(aria-pressed). */
  active?(s: AppStore): boolean
}

/**
 * commandId → 대표 단축키 표기(US-7.1). 단축키 단일 출처(domain/keybindings)에서
 * 파생한다 — 중복 정의 없이 매핑만 참조한다. 한 commandId 에 복수 chord 가 있으면
 * 선언 순서상 첫 바인딩(주 단축키)을 쓴다. 단축키 없는 명령은 undefined.
 */
const SHORTCUT_BY_COMMAND: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>()
  for (const b of KEYBINDINGS) {
    if (!m.has(b.commandId)) m.set(b.commandId, prettyChord(b.chord))
  }
  return m
})()

/**
 * 아이콘바 항목의 툴팁/aria-label 표시명(US-7.1 수용기준). 단축키가 있는 명령은
 * "동작명 (Ctrl+B)" 형식으로, 없으면 동작명만 반환한다.
 */
export function iconBarItemTitle(item: IconBarItem): string {
  const sc = SHORTCUT_BY_COMMAND.get(item.id)
  return sc ? `${item.label} (${sc})` : item.label
}

/**
 * 사용자 설정(순서 override·숨김 집합)을 적용해 실제로 렌더할 아이콘바 항목을 해석한다.
 *
 * - `order`: 명령 id 순서 override. 존재하는 항목만 그 순서로 앞에 배치하고, order 에
 *   없는(신규/누락) 항목은 기본 정의 순서로 뒤에 덧붙인다(버전 간 비파괴).
 * - `hidden`: 숨김 명령 id 집합. 마지막에 제외한다.
 * 결과는 항상 ICON_BAR_ITEMS 의 유효 항목만 포함한다(알 수 없는 id 무시).
 */
export function resolveIconBarItems(
  order: readonly string[],
  hidden: readonly string[]
): IconBarItem[] {
  const byId = new Map(ICON_BAR_ITEMS.map((it) => [it.id, it]))
  const hiddenSet = new Set(hidden)
  const seen = new Set<string>()
  const ordered: IconBarItem[] = []
  // 1) order 가 지정한 순서대로(유효·미중복 항목만).
  for (const id of order) {
    const it = byId.get(id)
    if (it && !seen.has(id)) {
      ordered.push(it)
      seen.add(id)
    }
  }
  // 2) order 에 없던 항목은 기본 정의 순서로 뒤에 덧붙임(신규 버전 추가 항목 포함).
  for (const it of ICON_BAR_ITEMS) {
    if (!seen.has(it.id)) ordered.push(it)
  }
  // 3) 숨김 제외.
  return ordered.filter((it) => !hiddenSet.has(it.id))
}

/** 활성 패널 헬퍼. */
function activePanel(s: AppStore) {
  const pid = s.activePanelId()
  return pid ? s.panels[pid] : undefined
}

/** 활성 패널 선택 개수. */
function selectionCount(s: AppStore): number {
  const pid = s.activePanelId()
  if (!pid) return 0
  return s.selection[pid]?.selectedPaths.size ?? 0
}

/** 활성 패널이 실제 폴더("내 PC" 아님)인지. */
function activeIsRealFolder(s: AppStore): boolean {
  const p = activePanel(s)
  return p !== undefined && !isMyPc(p.path)
}

/** 활성 탭이 존재하는지. */
function hasActiveTab(s: AppStore): boolean {
  return s.activeTab() !== undefined
}

/**
 * 아이콘바 버튼 정의 테이블(4그룹). 그룹 경계마다 구분선을 둔다(IconBar).
 */
export const ICON_BAR_ITEMS: readonly IconBarItem[] = [
  // ── 레이아웃 / 뷰 ──────────────────────────────────────────────────────
  {
    id: 'sidebar.toggle',
    label: '사이드바 토글',
    icon: '☰',
    group: 'layout',
    active: (s) => !s.sidebarCollapsed
  },
  {
    id: 'layout.toggleSplit2',
    label: '2분할',
    icon: '◫',
    group: 'layout',
    enabled: hasActiveTab,
    active: (s) => {
      const t = s.activeTab()
      return t?.layout === 'split-2-h' || t?.layout === 'split-2-v'
    }
  },
  {
    id: 'layout.toggleGrid4',
    label: '4분할',
    icon: '田',
    group: 'layout',
    enabled: hasActiveTab,
    active: (s) => s.activeTab()?.layout === 'grid-4'
  },
  {
    id: 'preview.toggle',
    label: '미리보기',
    icon: '◰',
    group: 'layout',
    active: (s) => s.previewOpen
  },
  {
    // §P1: 폴더 비교 토글(좌우 2분할일 때만 활성). 두 패널 폴더를 메타 4상태로 diff.
    id: 'compare.toggle',
    label: '폴더 비교',
    icon: '⇄',
    group: 'layout',
    enabled: (s) => {
      const t = s.activeTab()
      return (t?.layout === 'split-2-h' || t?.layout === 'split-2-v') && (t?.panelIds.length ?? 0) >= 2
    },
    active: (s) => s.compareActive
  },
  {
    id: 'view.setMode.details',
    label: '상세 보기',
    icon: '☰',
    group: 'layout',
    enabled: (s) => activePanel(s) !== undefined,
    active: (s) => activePanel(s)?.view.viewMode === 'details'
  },
  {
    id: 'view.setMode.list',
    label: '리스트 보기',
    icon: '≣',
    group: 'layout',
    enabled: (s) => activePanel(s) !== undefined,
    active: (s) => activePanel(s)?.view.viewMode === 'list'
  },

  // ── 파일 작업 ──────────────────────────────────────────────────────────
  {
    id: 'file.newFolder',
    label: '새 폴더',
    icon: '🗀',
    group: 'file',
    enabled: activeIsRealFolder
  },
  {
    id: 'file.copy',
    label: '복사',
    icon: '⧉',
    group: 'file',
    enabled: (s) => selectionCount(s) >= 1
  },
  {
    id: 'file.cut',
    label: '잘라내기',
    icon: '✂',
    group: 'file',
    enabled: (s) => selectionCount(s) >= 1
  },
  {
    id: 'file.paste',
    label: '붙여넣기',
    icon: '📋',
    group: 'file',
    enabled: (s) => s.clipboardHasFiles
  },
  {
    id: 'file.rename',
    label: '이름바꾸기',
    icon: '✎',
    group: 'file',
    enabled: (s) => selectionCount(s) === 1
  },
  {
    id: 'file.trash',
    label: '삭제',
    icon: '🗑',
    group: 'file',
    enabled: (s) => selectionCount(s) >= 1
  },

  // ── 탐색 ────────────────────────────────────────────────────────────────
  {
    id: 'nav.back',
    label: '뒤로',
    icon: '←',
    group: 'nav',
    enabled: (s) => (activePanel(s)?.nav.back.length ?? 0) > 0
  },
  {
    id: 'nav.forward',
    label: '앞으로',
    icon: '→',
    group: 'nav',
    enabled: (s) => (activePanel(s)?.nav.forward.length ?? 0) > 0
  },
  {
    id: 'nav.up',
    label: '위로',
    icon: '↑',
    group: 'nav',
    enabled: activeIsRealFolder
  },
  {
    id: 'panel.refresh',
    label: '새로고침',
    icon: '⟳',
    group: 'nav',
    enabled: (s) => activePanel(s) !== undefined
  },
  {
    id: 'search.open',
    label: '검색',
    icon: '🔍',
    group: 'nav',
    enabled: activeIsRealFolder
  },

  // ── 도구 ────────────────────────────────────────────────────────────────
  {
    id: 'dashboard.open',
    label: '사용량 대시보드',
    icon: '📊',
    group: 'tool',
    active: (s) => s.dashboardOpen
  },
  {
    id: 'trash.open',
    label: '휴지통',
    icon: '🗑',
    group: 'tool',
    active: (s) => s.trashOpen
  },
  {
    // §R2: 중복 파일 찾기(활성 패널 실폴더에서만). 크기→해시 2단계 탐지.
    id: 'dedup.open',
    label: '중복 파일 찾기',
    icon: '⧉',
    group: 'tool',
    enabled: activeIsRealFolder,
    active: (s) => s.dedupOpen
  },
  {
    // §R3: 전송 큐 매니저(진행/대기 작업 목록·일시정지/재개·동시성).
    id: 'queue.open',
    label: '전송 큐',
    icon: '⇅',
    group: 'tool',
    active: (s) => s.queuePanelOpen
  },
  {
    id: 'app.settings',
    label: '설정',
    icon: '⚙',
    group: 'tool'
  },
  {
    // 단축키 도움말(F1 과 동일). 설정에서 분리해 별도 ? 아이콘으로 노출(I7).
    id: 'help.shortcuts',
    label: '단축키 도움말',
    icon: '❓',
    group: 'tool',
    active: (s) => s.shortcutHelpOpen
  },
  {
    id: 'workspace.manage',
    label: '워크스페이스',
    icon: '🗂',
    group: 'tool'
  },
  {
    id: 'theme.toggle',
    label: '테마 토글',
    icon: '◐',
    group: 'tool'
  }
]
