/* P2/P3 스토어(tabs/panels/selection/layout) 동작 검증 하니스. window.api 모킹. */

// ── window.api 모킹(infra/api bridge 가 참조) ─────────────────────────
const fakeApi = {
  version: 'test',
  fs: {
    list: async () => ({ ok: true, value: { entries: [], truncated: false } }),
    stat: async () => ({ ok: false, error: { code: 'ENOENT', message: 'x' } }),
    drives: async () => ({
      ok: true,
      value: [
        {
          path: 'C:\\',
          label: '로컬 디스크 (C:)',
          letter: 'C',
          kind: 'fixed',
          totalBytes: null,
          freeBytes: null,
          ready: true
        }
      ]
    }),
    treeChildren: async () => ({ ok: true, value: [] }),
    validatePath: async () => ({ ok: true, value: { exists: true, isDir: true, normalized: 'C:\\' } }),
    listStart: async () => ({ ok: true, value: { streamId: 'sid-1' } }),
    listCancel: async () => ({ ok: true, value: undefined }),
    onListChunk: () => () => undefined,
    onListDone: () => () => undefined,
    onListError: () => () => undefined,
    mkdir: async () => ({ ok: false, error: { code: 'EINVAL', message: '' } }),
    createFile: async () => ({ ok: false, error: { code: 'EINVAL', message: '' } }),
    rename: async () => ({ ok: false, error: { code: 'EINVAL', message: '' } })
  },
  shell: {
    open: async () => ({ ok: true, value: undefined }),
    openWith: async () => ({ ok: true, value: undefined }),
    showProperties: async () => ({ ok: true, value: undefined }),
    icon: async () => ({ ok: false, error: { code: 'EUNKNOWN', message: '' } })
  }
}
;(globalThis as unknown as { api: unknown }).api = fakeApi
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
  observe(): void {}
  disconnect(): void {}
}

import { useRootStore } from '../src/renderer/app/stores/rootStore'
import { ratioFromPoint } from '../src/renderer/ui/layout/splitMath'
import type { WindowSnapshot } from '../src/shared/dto'

let pass = 0
let fail = 0
function ok(label: string, cond: boolean): void {
  if (cond) pass++
  else {
    fail++
    console.log('FAIL', label)
  }
}

const s = () => useRootStore.getState()

// ── 부트: 기본 탭 1개("내 PC") ───────────────────────────────────────
s().initDefaultTab()
ok('기본 탭 1개', s().tabOrder.length === 1)
const tab1 = s().activeTab()!
ok('기본 탭 단일 레이아웃', tab1.layout === 'single' && tab1.panelIds.length === 1)
ok('기본 패널 경로 내 PC', s().panels[tab1.panelIds[0]!]!.path === '')
ok('활성 패널 정확히 하나', !!s().activePanelId())

// ── 새 탭 ─────────────────────────────────────────────────────────────
s().newTab('C:\\')
ok('탭 2개', s().tabOrder.length === 2)
ok('새 탭이 활성', s().panels[s().activePanelId()!]!.path === 'C:\\')

// ── 탭 전환(Ctrl+Tab) ─────────────────────────────────────────────────
const beforeNext = s().activeTabId
s().nextTab()
ok('nextTab 전환', s().activeTabId !== beforeNext)
s().prevTab()
ok('prevTab 복귀', s().activeTabId === beforeNext)

// ── 탭 복제(Ctrl+D) ──────────────────────────────────────────────────
s().activateTab(s().tabOrder[1]!) // C:\ 탭
s().duplicateTab()
ok('복제 후 탭 3개', s().tabOrder.length === 3)
ok('복제 탭 동일 경로', s().panels[s().activePanelId()!]!.path === 'C:\\')

// ── 2분할 토글(Ctrl+\) ───────────────────────────────────────────────
const dupTab = s().activeTabId
s().toggleSplit2()
const splitTab = s().tabs[dupTab]!
ok('2분할 레이아웃', splitTab.layout === 'split-2-h' && splitTab.panelIds.length === 2)
ok('분할 두 패널 독립 id', splitTab.panelIds[0] !== splitTab.panelIds[1])

// ── 패널 포커스 순환(Tab) / 방향(Ctrl+←·→) ──────────────────────────
const firstPanel = splitTab.activePanelId
s().focusNextPanel()
ok('focusNext 순환', s().tabs[dupTab]!.activePanelId !== firstPanel)
s().focusPanelDir('left')
ok('focusDir left = 첫 패널', s().tabs[dupTab]!.activePanelId === splitTab.panelIds[0])
s().focusPanelDir('right')
ok('focusDir right = 둘째 패널', s().tabs[dupTab]!.activePanelId === splitTab.panelIds[1])
// 불변식: 활성 패널은 분할 패널 집합에 속함.
ok('활성 패널 불변식', splitTab.panelIds.includes(s().tabs[dupTab]!.activePanelId))

// ── 2분할 → 단일 복귀 ────────────────────────────────────────────────
s().toggleSplit2()
ok('단일 복귀', s().tabs[dupTab]!.layout === 'single' && s().tabs[dupTab]!.panelIds.length === 1)

// ── 탭 닫기 + 복원(Ctrl+W / Ctrl+Shift+T) ────────────────────────────
const closeTarget = s().tabOrder[1]!
const pathOfClosed = s().panels[s().tabs[closeTarget]!.activePanelId]!.path
s().closeTab(closeTarget)
ok('닫기 후 탭 2개', s().tabOrder.length === 2)
ok('closedHistory 적재', s().closedHistory.length >= 1)
s().reopenTab()
ok('복원 후 탭 3개', s().tabOrder.length === 3)
ok('복원 경로 일치', s().panels[s().activePanelId()!]!.path === pathOfClosed)

// ── 마지막 탭 닫으면 기본 탭 유지 ─────────────────────────────────────
for (const t of [...s().tabOrder]) s().closeTab(t)
ok('마지막 탭 닫아도 1개 유지', s().tabOrder.length === 1)
ok('유지 탭은 내 PC', s().panels[s().activePanelId()!]!.path === '')

// ── 정렬/보기 액션 ────────────────────────────────────────────────────
const pid = s().activePanelId()!
s().setViewMode(pid, 'list')
ok('viewMode list', s().panels[pid]!.view.viewMode === 'list')
s().setSort(pid, 'size')
ok('sort size asc', s().panels[pid]!.view.sortKey === 'size' && s().panels[pid]!.view.sortDir === 'asc')
s().setSort(pid, 'size')
ok('sort 재클릭 desc 토글', s().panels[pid]!.view.sortDir === 'desc')
s().toggleFolderFirst(pid)
ok('folderFirst 토글', s().panels[pid]!.view.folderFirst === false)

// ── 스트림 청크 적재 시뮬레이션 ──────────────────────────────────────
// navigate 가 listStart(streamId='sid-1') 를 호출한 패널에 _onChunk 주입.
s().navigate(pid, 'D:\\demo', true)
// listStart 는 async — 마이크로태스크 후 streamId 설정됨. 약식 대기.
await Promise.resolve()
await Promise.resolve()
const sid = s().panels[pid]!.directory.streamId
ok('navigate 히스토리 적재', s().panels[pid]!.nav.back.length >= 1)
if (sid) {
  s()._onChunk(pid, sid, [
    {
      name: 'a.txt',
      path: 'D:\\demo\\a.txt',
      isDir: false,
      size: 1,
      mtime: 0,
      ctime: 0,
      ext: 'txt',
      attrs: { hidden: false, readonly: false, system: false, symlink: false }
    }
  ])
  ok('청크 적재 entries', s().panels[pid]!.directory.entries.length === 1)
  s()._onDone(pid, sid, 1, false)
  ok('done 상태 ready', s().panels[pid]!.directory.status === 'ready')
} else {
  ok('스트림 streamId 설정', false)
}

// ── H-5: setSplitRatio 클램프(0.15~0.85, 축별) ───────────────────────
{
  // 2분할 탭 하나 준비(split-2-h → col 축 사용).
  s().newTab('C:\\')
  const t = s().activeTabId
  s().toggleSplit2()
  ok('분할 준비(split-2-h)', s().tabs[t]!.layout === 'split-2-h')

  // 하한 클램프: 범위밖(0.02) → 0.15.
  s().setSplitRatio(t, 'col', 0.02)
  ok('setSplitRatio col 하한 클램프 0.15', s().tabs[t]!.splitRatios!.col === 0.15)
  // 상한 클램프: 범위밖(0.98) → 0.85.
  s().setSplitRatio(t, 'col', 0.98)
  ok('setSplitRatio col 상한 클램프 0.85', s().tabs[t]!.splitRatios!.col === 0.85)
  // 범위 내(0.42)는 그대로.
  s().setSplitRatio(t, 'col', 0.42)
  ok('setSplitRatio col 범위내 보존', s().tabs[t]!.splitRatios!.col === 0.42)
  // 축 격리: row 변경이 col 을 건드리지 않는다.
  s().setSplitRatio(t, 'row', 0.99)
  ok('setSplitRatio row 상한 클램프 0.85', s().tabs[t]!.splitRatios!.row === 0.85)
  ok('setSplitRatio 축 격리(col 유지)', s().tabs[t]!.splitRatios!.col === 0.42)
  // 더블클릭 복귀(0.5 전달).
  s().setSplitRatio(t, 'col', 0.5)
  ok('setSplitRatio 0.5 복귀', s().tabs[t]!.splitRatios!.col === 0.5)
}

// ── H-6: restoreWindows 의 splitRatios 주입 ──────────────────────────
{
  const snap: WindowSnapshot[] = [
    {
      activeTabId: 'rt1',
      tabs: [
        {
          id: 'rt1',
          activePanelId: 'rp1',
          layout: 'split-2-h',
          splitRatios: { col: 0.3, row: 0.7 },
          panels: [
            {
              id: 'rp1',
              path: 'C:\\',
              sortKey: 'name',
              sortDir: 'asc',
              viewMode: 'details',
              history: { back: [], forward: [] },
              scrollTop: 0
            },
            {
              id: 'rp2',
              path: 'D:\\',
              sortKey: 'name',
              sortDir: 'asc',
              viewMode: 'details',
              history: { back: [], forward: [] },
              scrollTop: 0
            }
          ]
        }
      ]
    }
  ]
  const okRestore = s().restoreWindows(snap)
  ok('restoreWindows 성공', okRestore)
  const restored = s().activeTab()!
  ok('restoreWindows splitRatios 주입(col)', restored.splitRatios?.col === 0.3)
  ok('restoreWindows splitRatios 주입(row)', restored.splitRatios?.row === 0.7)
  ok('restoreWindows 레이아웃 복원', restored.layout === 'split-2-h' && restored.panelIds.length === 2)
}

// ── H-1: toggleSidebar ───────────────────────────────────────────────
{
  const before = s().sidebarCollapsed
  s().toggleSidebar()
  ok('toggleSidebar 반전', s().sidebarCollapsed === !before)
  s().toggleSidebar()
  ok('toggleSidebar 재반전 복귀', s().sidebarCollapsed === before)
}

// ── H-4b: clipboardHasFiles setter ───────────────────────────────────
{
  s().setClipboardHasFiles(true)
  ok('setClipboardHasFiles true', s().clipboardHasFiles === true)
  s().setClipboardHasFiles(false)
  ok('setClipboardHasFiles false', s().clipboardHasFiles === false)
}

// ── H-5 순수함수: ratioFromPoint(클램프 없음, 경계·중앙·범위밖) ────────
{
  const rect = { left: 100, top: 50, width: 200, height: 400 }
  // vertical(=width 축).
  ok('ratioFromPoint vertical 중앙', ratioFromPoint(rect, 200, 0, 'vertical') === 0.5)
  ok('ratioFromPoint vertical 좌경계 0', ratioFromPoint(rect, 100, 0, 'vertical') === 0)
  ok('ratioFromPoint vertical 우경계 1', ratioFromPoint(rect, 300, 0, 'vertical') === 1)
  // 범위밖(클램프 안 함 → raw).
  ok('ratioFromPoint vertical 범위밖 음수', ratioFromPoint(rect, 50, 0, 'vertical') === -0.25)
  ok('ratioFromPoint vertical 범위밖 초과', ratioFromPoint(rect, 400, 0, 'vertical') === 1.5)
  // horizontal(=height 축).
  ok('ratioFromPoint horizontal 중앙', ratioFromPoint(rect, 0, 250, 'horizontal') === 0.5)
  ok('ratioFromPoint horizontal 상경계 0', ratioFromPoint(rect, 0, 50, 'horizontal') === 0)
  ok('ratioFromPoint horizontal 하경계 1', ratioFromPoint(rect, 0, 450, 'horizontal') === 1)
  // 측정 불가(축 크기 0) → null.
  ok(
    'ratioFromPoint width 0 → null',
    ratioFromPoint({ left: 0, top: 0, width: 0, height: 100 }, 10, 10, 'vertical') === null
  )
  ok(
    'ratioFromPoint height 0 → null',
    ratioFromPoint({ left: 0, top: 0, width: 100, height: 0 }, 10, 10, 'horizontal') === null
  )
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
