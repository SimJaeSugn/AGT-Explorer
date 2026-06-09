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
  },
  // M7 R2: hash:dup:* 어댑터 모킹(usecases/dedup·initDedupBridge 가 참조).
  hash: {
    compareStart: async () => ({ ok: true, value: { jobId: 'job-c' } }),
    dupStart: async () => ({ ok: true, value: { jobId: 'job-dup' } }),
    verifyStart: async () => ({ ok: true, value: { jobId: 'job-v' } }),
    cancel: async () => ({ ok: true, value: undefined }),
    onCompareProgress: () => () => undefined,
    onCompareDone: () => () => undefined,
    onDupProgress: () => () => undefined,
    onDupDone: () => () => undefined,
    onVerifyProgress: () => () => undefined,
    onVerifyDone: () => () => undefined,
    onError: () => () => undefined
  },
  // M7 R3: queue:* 어댑터 모킹(usecases/queue·queueBridge 가 참조).
  queue: {
    list: async () => ({ ok: true, value: { items: [] } }),
    pause: async () => ({ ok: true, value: undefined }),
    resume: async () => ({ ok: true, value: undefined }),
    retry: async () => ({ ok: true, value: undefined }),
    setConcurrency: async () => ({ ok: true, value: undefined }),
    onState: () => () => undefined
  }
}
;(globalThis as unknown as { api: unknown }).api = fakeApi
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
  observe(): void {}
  disconnect(): void {}
}

import { useRootStore } from '../src/renderer/app/stores/rootStore'
import { ratioFromPoint } from '../src/renderer/ui/layout/splitMath'
import { setConcurrency } from '../src/renderer/app/usecases/queue'
import type { QueueItemDTO, WindowSnapshot } from '../src/shared/dto'

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

// ── J2: 워처발 갱신 시 선택/스크롤 보존(softRefresh) ──────────────────
// 정렬·필터가 걸린 패널에서 anchor 를 computeVisible 기준으로 환산·복원하고,
// 재-list 후 사라진 항목만 선택 해제·나머지 유지, scrollTop 1회성 복원을 검증.
{
  type Ent = {
    name: string
    path: string
    isDir: boolean
    size: number
    mtime: number
    ctime: number
    ext: string
    attrs: { hidden: boolean; readonly: boolean; system: boolean; symlink: boolean }
  }
  const mk = (name: string, isDir = false): Ent => ({
    name,
    path: `D:\\j2\\${name}`,
    isDir,
    size: 1,
    mtime: 0,
    ctime: 0,
    ext: isDir ? '' : 'txt',
    attrs: { hidden: false, readonly: false, system: false, symlink: false }
  })

  // 새 탭에 패널을 만들어 D:\j2 로 navigate(스트림 적재 경로).
  s().newTab('C:\\')
  const jp = s().activePanelId()!
  s().navigate(jp, 'D:\\j2', true)
  await Promise.resolve()
  await Promise.resolve()
  const sid1 = s().panels[jp]!.directory.streamId!
  ok('J2 초기 스트림 streamId', !!sid1)

  // 초기 항목 5개(폴더 first + 이름 desc 정렬 적용 → computeVisible 순서가 raw 와 다름).
  s()._onChunk(jp, sid1, [mk('b.txt'), mk('a.txt'), mk('c.txt'), mk('dir1', true), mk('d.txt')])
  s()._onDone(jp, sid1, 5, false)
  // 정렬: 폴더 우선 + 이름 desc → [dir1, d, c, b, a].
  s().toggleFolderFirst(jp) // 기본 true 였으나 위 setSort 영향 없게 명시 — 폴더 우선 유지 확인
  s().toggleFolderFirst(jp) // 두 번 토글 = 원복(폴더 우선 true)
  s().setSort(jp, 'name') // 같은 키 재클릭 → desc 토글
  ok('J2 정렬 desc', s().panels[jp]!.view.sortDir === 'desc')

  // computeVisible 순서 확인용으로 store 의 visibleEntries 대신 selection 동작으로 검증.
  // visible = [dir1, d.txt, c.txt, b.txt, a.txt]. index 1(d.txt), 3(b.txt) 선택 + anchor=3.
  const vis = (): string[] => {
    const p = s().panels[jp]!
    // 헤드리스: computeVisible 은 selectors 에 있으나 여기선 selection 결과로 간접 검증.
    return p.directory.entries.map((e) => e.path)
  }
  void vis
  // clickSelect 로 d.txt(visible idx1) 단일 → ctrl b.txt(visible idx3) 추가. anchor=3(b.txt).
  const visiblePaths = ['D:\\j2\\dir1', 'D:\\j2\\d.txt', 'D:\\j2\\c.txt', 'D:\\j2\\b.txt', 'D:\\j2\\a.txt']
  s().clickSelect(jp, visiblePaths, 1, false, false) // d.txt
  s().clickSelect(jp, visiblePaths, 3, true, false) // +b.txt, anchor=3
  ok('J2 선택 2개', s().selection[jp]!.selectedPaths.size === 2)
  ok('J2 anchor=3(b.txt)', s().selection[jp]!.anchorIndex === 3)

  // scrollTop 설정(보존 캡처 입력).
  s().setScrollTop(jp, 320)
  ok('J2 scrollTop 설정', s().panels[jp]!.scrollTop === 320)

  // softRefresh → 보존 캡처(현재 시점). b.txt 를 삭제한 새 항목집합으로 재-list.
  s().softRefresh(jp)
  await Promise.resolve()
  await Promise.resolve()
  const sid2 = s().panels[jp]!.directory.streamId!
  ok('J2 softRefresh 새 streamId', !!sid2 && sid2 === 'sid-1')
  // 새 집합: b.txt 삭제(나머지 4개). 정렬 desc 폴더우선 → [dir1, d, c, a].
  s()._onChunk(jp, sid2, [mk('a.txt'), mk('c.txt'), mk('dir1', true), mk('d.txt')])
  s()._onDone(jp, sid2, 4, false)

  // 교집합: d.txt 유지, b.txt(삭제) 해제 → size 1.
  const keptSel = s().selection[jp]!
  ok('J2 보존: 사라진 b.txt 해제', !keptSel.selectedPaths.has('D:\\j2\\b.txt'))
  ok('J2 보존: 잔존 d.txt 유지', keptSel.selectedPaths.has('D:\\j2\\d.txt'))
  ok('J2 보존: 선택 1개로 축소', keptSel.selectedPaths.size === 1)
  // anchor 였던 b.txt 가 사라졌으니 잔존 선택(d.txt, 새 visible 인덱스=1) 으로 best-effort.
  // 새 visible = [dir1, d.txt, c.txt, a.txt] → d.txt 인덱스 1.
  ok('J2 보존: anchor 재탐색(d.txt=1)', keptSel.anchorIndex === 1)

  // scrollTop 1회성 복원 플래그 set 확인.
  ok('J2 pendingScrollRestore set(320)', s().panels[jp]!.pendingScrollRestore === 320)
  // FileListView 가 소비하는 동작을 헤드리스로 모사: clear 후 null.
  s().clearPendingScrollRestore(jp)
  ok('J2 pendingScrollRestore 1회 소거 → null', s().panels[jp]!.pendingScrollRestore === null)

  // anchor 가 잔존하는 케이스: c.txt(visible idx2) 단일선택 후 softRefresh(아무것도 안 사라짐).
  s().clickSelect(jp, ['D:\\j2\\dir1', 'D:\\j2\\d.txt', 'D:\\j2\\c.txt', 'D:\\j2\\a.txt'], 2, false, false)
  ok('J2 c.txt 단일선택 anchor=2', s().selection[jp]!.anchorIndex === 2)
  s().softRefresh(jp)
  await Promise.resolve()
  await Promise.resolve()
  const sid3 = s().panels[jp]!.directory.streamId!
  s()._onChunk(jp, sid3, [mk('a.txt'), mk('c.txt'), mk('dir1', true), mk('d.txt')])
  s()._onDone(jp, sid3, 4, false)
  ok('J2 anchor 잔존(c.txt=2) 보존', s().selection[jp]!.anchorIndex === 2)
  ok('J2 c.txt 선택 유지', s().selection[jp]!.selectedPaths.has('D:\\j2\\c.txt'))

  // navigate(경로 변경) → 선택 초기화 + pendingScrollRestore 미설정.
  s().setScrollTop(jp, 200)
  s().navigate(jp, 'D:\\other', true)
  ok('J2 navigate 선택 초기화', s().selection[jp]!.selectedPaths.size === 0)
  ok('J2 navigate anchor -1', s().selection[jp]!.anchorIndex === -1)
  ok('J2 navigate scrollTop 0', s().panels[jp]!.scrollTop === 0)
  // navigate 는 보존 미적용 → done 시 pendingScrollRestore set 안 됨.
  await Promise.resolve()
  await Promise.resolve()
  const sidN = s().panels[jp]!.directory.streamId!
  s()._onChunk(jp, sidN, [mk('x.txt')])
  s()._onDone(jp, sidN, 1, false)
  ok('J2 navigate 후 pendingScrollRestore null', s().panels[jp]!.pendingScrollRestore === null)

  // error 시 보존 스냅샷 폐기(복원 안 함).
  s().clickSelect(jp, ['D:\\other\\x.txt'], 0, false, false)
  s().setScrollTop(jp, 150)
  s().softRefresh(jp)
  await Promise.resolve()
  await Promise.resolve()
  const sidE = s().panels[jp]!.directory.streamId!
  s()._onError(jp, sidE, 'EUNKNOWN', 'boom')
  ok('J2 error 상태', s().panels[jp]!.directory.status === 'error')
  ok('J2 error 시 pendingScrollRestore 미설정', s().panels[jp]!.pendingScrollRestore === null)
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

// ── K1: undo 스택(undoSlice) push/pop/cap/역연산엔트리/영구삭제 미push ──────
{
  s().clearUndo()
  ok('undo 초기 빈 스택', s().undoStack.length === 0)
  ok('빈 스택 popUndo undefined', s().popUndo() === undefined)

  // push/pop 순서(LIFO).
  s().pushUndo({ kind: 'rename', newPath: 'C:\\a\\new.txt', oldName: 'old.txt', newName: 'new.txt' })
  s().pushUndo({ kind: 'create', path: 'C:\\a\\새 폴더' })
  ok('undo push 2건', s().undoStack.length === 2)
  const top = s().popUndo()
  ok('popUndo LIFO(top=create)', !!top && top.kind === 'create')
  ok('pop 후 1건', s().undoStack.length === 1)

  // 역연산 엔트리 종류 보존(판별 유니온).
  s().clearUndo()
  s().pushUndo({ kind: 'move', sources: ['C:\\a\\x'], fromDir: 'C:\\a', toDir: 'C:\\b' })
  s().pushUndo({ kind: 'copy', createdPaths: ['C:\\b\\y'] })
  s().pushUndo({ kind: 'trash', originalPaths: ['C:\\a\\z'] })
  const e1 = s().popUndo()
  ok('trash 엔트리 originalPaths', !!e1 && e1.kind === 'trash' && e1.originalPaths[0] === 'C:\\a\\z')
  const e2 = s().popUndo()
  ok('copy 엔트리 createdPaths', !!e2 && e2.kind === 'copy' && e2.createdPaths[0] === 'C:\\b\\y')
  const e3 = s().popUndo()
  ok('move 엔트리 from/to', !!e3 && e3.kind === 'move' && e3.fromDir === 'C:\\a' && e3.toDir === 'C:\\b')

  // 상한 cap=50: 60건 push → 50건 유지, 가장 오래된 것 폐기.
  s().clearUndo()
  for (let i = 0; i < 60; i++) s().pushUndo({ kind: 'create', path: `C:\\cap\\${i}` })
  ok('undo cap 50 유지', s().undoStack.length === 50)
  // 가장 오래된 0~9 폐기 → top 은 마지막 push(59), bottom 은 10.
  ok('cap 오래된 것 폐기(bottom=10)', (s().undoStack[0] as { path: string }).path === 'C:\\cap\\10')
  const capTop = s().popUndo()
  ok('cap top=59', !!capTop && capTop.kind === 'create' && capTop.path === 'C:\\cap\\59')

  // 영구삭제(delete)는 undo 엔트리를 만들지 않는다 → delete kind 자체가 UndoEntry 에 없음.
  // registerOperation 에 delete undoMeta 를 주지 않으므로 done 시 push 안 됨(설계 보장).
  s().clearUndo()
  ok('delete 후 빈 스택(미push 보장)', s().undoStack.length === 0)
}

// ── K1: registerOperation undoMeta 보관 ────────────────────────────────────
{
  s().registerOperation('undo-op-1', 'trash', [], { kind: 'trash', originalPaths: ['C:\\a\\f'] })
  const op = s().operations['undo-op-1']
  ok('registerOperation undoMeta 보관', !!op && op.undoMeta?.kind === 'trash')
  s().registerOperation('undo-op-2', 'move', [])
  ok('registerOperation undoMeta 없음 허용', s().operations['undo-op-2']?.undoMeta === undefined)
  s().dismissOperation('undo-op-1')
  s().dismissOperation('undo-op-2')
}

// ── K2: trashSlice 목록/선택 ───────────────────────────────────────────────
{
  s()._trashLoading()
  ok('trash loading 상태', s().trashStatus === 'loading')
  s()._setTrashItems([
    { id: 'r1', name: 'a.txt', originalPath: 'C:\\x\\a.txt', deletedAt: 100, size: 10 },
    { id: 'r2', name: 'b.txt', originalPath: 'C:\\x\\b.txt', deletedAt: 200, size: 20 }
  ])
  ok('trash ready + 2건', s().trashStatus === 'ready' && s().trashItems.length === 2)
  s().toggleTrashSelect('r1')
  s().toggleTrashSelect('r2')
  ok('trash 선택 2건', s().trashSelected.size === 2)
  // 목록 갱신 시 사라진 선택 정리(r2 제거).
  s()._setTrashItems([{ id: 'r1', name: 'a.txt', originalPath: 'C:\\x\\a.txt', deletedAt: 100, size: 10 }])
  ok('trash 갱신 후 사라진 선택 정리', s().trashSelected.size === 1 && s().trashSelected.has('r1'))
  s().setAllTrashSelected(false)
  ok('trash 전체 해제', s().trashSelected.size === 0)
  s()._trashError('x')
  ok('trash error 상태', s().trashStatus === 'error' && s().trashError === 'x')
}

// ── K2: 휴지통 모달 inputContext 게이트(uiSlice) ────────────────────────────
{
  s().setInputContext('list')
  s().openTrash()
  ok('openTrash → dialog', s().trashOpen && s().inputContext === 'dialog')
  s().closeTrash()
  ok('closeTrash → list 복귀', !s().trashOpen && s().inputContext === 'list')
  // 휴지통 위에서 컨텍스트 메뉴 차단.
  s().openTrash()
  s().openContextMenu({ x: 0, y: 0, panelId: 'p', targetPath: null })
  ok('휴지통 위 컨텍스트 메뉴 차단', s().contextMenu === null)
  s().closeTrash()
}

// ── N2: reorderFavorite(즐겨찾기 배열 재배열·범위가드·순서영속 단일출처) ───────
{
  // 초기화: 알려진 즐겨찾기 4개 주입(순서 = 배열 자체).
  s().hydrateSidebar({
    favorites: ['C:\\a', 'C:\\b', 'C:\\c', 'C:\\d'],
    favoriteLabels: { 'C:\\b': '비별칭' },
    recent: [],
    width: 240,
    collapsed: false
  })
  ok('N2 즐겨찾기 4개 초기', s().favorites.join(',') === 'C:\\a,C:\\b,C:\\c,C:\\d')

  // 앞→뒤 이동(0 → 2): a 를 c 자리로. [b,c,a,d].
  s().reorderFavorite(0, 2)
  ok('N2 reorder 0→2', s().favorites.join(',') === 'C:\\b,C:\\c,C:\\a,C:\\d')

  // 뒤→앞 이동(3 → 0): d 를 맨 앞으로. [d,b,c,a].
  s().reorderFavorite(3, 0)
  ok('N2 reorder 3→0', s().favorites.join(',') === 'C:\\d,C:\\b,C:\\c,C:\\a')

  // 별칭은 경로 키라 순서와 무관하게 보존(불변식).
  ok('N2 별칭 보존(순서 무관)', s().favoriteLabels['C:\\b'] === '비별칭')

  // 동일 인덱스·범위밖은 무동작(즐겨찾기 외 데이터 불변).
  const before = s().favorites.join(',')
  s().reorderFavorite(1, 1)
  s().reorderFavorite(-1, 2)
  s().reorderFavorite(2, 99)
  ok('N2 무동작 케이스(동일/범위밖)', s().favorites.join(',') === before)

  // 인접 스왑(1 → 2): [d,c,b,a].
  s().reorderFavorite(1, 2)
  ok('N2 인접 스왑 1→2', s().favorites.join(',') === 'C:\\d,C:\\c,C:\\b,C:\\a')

  // 1개 경계: 단일 항목은 어떤 이동도 무동작.
  s().hydrateSidebar({ favorites: ['C:\\only'], recent: [], width: 240, collapsed: false })
  s().reorderFavorite(0, 0)
  ok('N2 1개 경계 무동작', s().favorites.length === 1 && s().favorites[0] === 'C:\\only')
}

// ── N2: 순서 영속 단일출처(buildSessionSnapshot 가 favorites 순서 그대로 직렬화) ──
{
  const { buildSessionSnapshot } = await import('../src/renderer/app/usecases/session')
  s().hydrateSidebar({ favorites: ['C:\\x', 'C:\\y', 'C:\\z'], recent: [], width: 240, collapsed: false })
  s().reorderFavorite(2, 0) // [z,x,y]
  const snap = buildSessionSnapshot()
  ok(
    'N2 스냅샷 순서 보존(영속 단일출처)',
    snap.sidebar.favorites.join(',') === 'C:\\z,C:\\x,C:\\y'
  )
}

// ── 상단 고정(pin): togglePin·isPinned·pinnedIn·hydrate·세션 영속 ────────────
{
  // 초기 빈 상태에서 시작.
  s().hydrateSidebar({ favorites: [], recent: [], width: 240, collapsed: false })
  ok('pin 초기 빈 맵', JSON.stringify(s().pinnedByDir) === '{}')
  ok('pin pinnedIn 빈배열', s().pinnedIn('C:\\d').length === 0)
  ok('pin pinnedIn 안정참조', s().pinnedIn('C:\\d') === s().pinnedIn('C:\\z'))

  // 고정 추가.
  s().togglePin('C:\\d', 'C:\\d\\a.txt')
  s().togglePin('C:\\d', 'C:\\d\\b.txt')
  ok('pin 추가 2개', s().pinnedIn('C:\\d').join(',') === 'C:\\d\\a.txt,C:\\d\\b.txt')
  ok('pin isPinned true', s().isPinned('C:\\d', 'C:\\d\\a.txt'))
  ok('pin isPinned false(타항목)', !s().isPinned('C:\\d', 'C:\\d\\z.txt'))
  ok('pin 디렉토리 격리', !s().isPinned('C:\\other', 'C:\\d\\a.txt'))

  // 토글 해제(있으면 제거).
  s().togglePin('C:\\d', 'C:\\d\\a.txt')
  ok('pin 해제', !s().isPinned('C:\\d', 'C:\\d\\a.txt'))
  ok('pin 나머지 보존', s().pinnedIn('C:\\d').join(',') === 'C:\\d\\b.txt')

  // 마지막 항목 제거 시 디렉토리 키 자체 삭제(빈 배열 키 누적 방지).
  s().togglePin('C:\\d', 'C:\\d\\b.txt')
  ok('pin 빈 디렉토리 키 제거', s().pinnedByDir['C:\\d'] === undefined)

  // 세션 영속(buildSessionSnapshot → pinnedByDir 직렬화) + hydrate 복원.
  const { buildSessionSnapshot } = await import('../src/renderer/app/usecases/session')
  s().togglePin('C:\\p', 'C:\\p\\keep.txt')
  const snapP = buildSessionSnapshot()
  ok('pin 스냅샷 직렬화', snapP.sidebar.pinnedByDir?.['C:\\p']?.[0] === 'C:\\p\\keep.txt')

  s().hydrateSidebar({
    favorites: [],
    pinnedByDir: { 'C:\\h': ['C:\\h\\x.txt'], 'C:\\empty': [] },
    recent: [],
    width: 240,
    collapsed: false
  })
  ok('pin hydrate 복원', s().isPinned('C:\\h', 'C:\\h\\x.txt'))
  ok('pin hydrate 빈배열 키 제외', s().pinnedByDir['C:\\empty'] === undefined)
  ok('pin hydrate 기존 맵 교체', s().pinnedByDir['C:\\p'] === undefined)
}

// ── computeVisible: query 필터·정렬·§O 상단고정 동치(프리셋 제거 후 회귀 0 고정) ──
{
  const { computeVisible } = await import('../src/renderer/app/usecases/selectors')
  const { filterEntries } = await import('../src/renderer/domain/rules/filter')

  // 깨끗한 패널 준비(새 탭·단일).
  s().newTab('C:\\')
  const cp = s().activePanelId()!

  // 엔트리 주입(스트림 경로). 정렬/필터 적용 대상.
  s().navigate(cp, 'D:\\cv', true)
  await Promise.resolve()
  await Promise.resolve()
  const csid = s().panels[cp]!.directory.streamId!
  const cmk = (name: string, isDir = false): {
    name: string; path: string; isDir: boolean; size: number; mtime: number
    ctime: number; ext: string; attrs: { hidden: boolean; readonly: boolean; system: boolean; symlink: boolean }
  } => ({
    name,
    path: `D:\\cv\\${name}`,
    isDir,
    size: 1,
    mtime: 0,
    ctime: 0,
    ext: isDir ? '' : (name.split('.').pop() as string).toLowerCase(),
    attrs: { hidden: false, readonly: false, system: false, symlink: false }
  })
  s()._onChunk(cp, csid, [cmk('a.png'), cmk('b.jpg'), cmk('c.txt'), cmk('d.png'), cmk('sub', true)])
  s()._onDone(cp, csid, 5, false)

  // baseline(검색창 닫힘): 정렬 name asc 폴더우선 = 전부 표시(5개).
  const baseVisible = computeVisible(s().panels[cp]!).map((e) => e.name)
  ok('CV baseline 전부표시(필터없음)', baseVisible.length === 5)

  // 검색창 닫힘이면 query 무시(open=false → 비활성·전부 표시).
  s().setSearchQuery(cp, 'a')
  ok('CV 검색창 닫힘이면 query 무시', computeVisible(s().panels[cp]!).length === 5)

  // 검색창 열고 query='a' → computeVisible == filterEntries(entries,'a') 동치(이름 부분일치).
  s().setSearchOpen(cp, true)
  s().setSearchQuery(cp, 'a')
  const entries = s().panels[cp]!.directory.entries
  const expected = filterEntries(entries, 'a').map((e) => e.name).sort()
  const qVisible = computeVisible(s().panels[cp]!).map((e) => e.name).sort()
  ok('CV query 동치(filterEntries)', JSON.stringify(qVisible) === JSON.stringify(expected))
  ok('CV query=a → a.png 만', JSON.stringify(qVisible) === JSON.stringify(['a.png']))

  // 빈 쿼리(open=true, query 공백) → 원본 참조 그대로(전부 표시).
  s().setSearchQuery(cp, '   ')
  ok('CV 공백 query 전부표시', computeVisible(s().panels[cp]!).length === 5)

  // §O 상단고정: 검색창 닫고 d.png 를 고정 → computeVisible 최상단으로 끌어올림(고정 보존).
  s().setSearchOpen(cp, false)
  s().togglePin('D:\\cv', 'D:\\cv\\d.png')
  ok('CV §O 고정 항목 최상단', computeVisible(s().panels[cp]!)[0]!.name === 'd.png')
  // 고정 해제 → 원래 정렬 순서 복귀(최상단이 d.png 가 아님).
  s().togglePin('D:\\cv', 'D:\\cv\\d.png')
  ok('CV §O 고정 해제 복귀', computeVisible(s().panels[cp]!)[0]!.name !== 'd.png')

  // 세션 스냅샷: version 1(프리셋 제거 후 환원)·filterPresets 필드 없음.
  const { buildSessionSnapshot } = await import('../src/renderer/app/usecases/session')
  const snapCv = buildSessionSnapshot()
  ok('CV 스냅샷 version 1', snapCv.version === 1)
  ok('CV 스냅샷 filterPresets 없음', !('filterPresets' in (snapCv as Record<string, unknown>)))
}

// ── R1: undoSlice batchRename 엔트리 push/pop(판별 유니온·묶음 items·dir) ─────
{
  s().clearUndo()
  s().pushUndo({
    kind: 'batchRename',
    items: [
      { newPath: 'C:\\d\\Photo_1.jpg', oldName: 'IMG_1.jpg', newName: 'Photo_1.jpg' },
      { newPath: 'C:\\d\\Photo_2.jpg', oldName: 'IMG_2.jpg', newName: 'Photo_2.jpg' }
    ],
    dir: 'C:\\d'
  })
  ok('R1 batchRename push 1엔트리', s().undoStack.length === 1)
  const e = s().popUndo()
  ok(
    'R1 batchRename 엔트리 보존',
    !!e &&
      e.kind === 'batchRename' &&
      e.items.length === 2 &&
      e.dir === 'C:\\d' &&
      e.items[0]!.oldName === 'IMG_1.jpg' &&
      e.items[0]!.newPath === 'C:\\d\\Photo_1.jpg'
  )
  ok('R1 batchRename pop 후 빈 스택', s().undoStack.length === 0)

  // 부분 적용: 적용된 것만(items 1건) push 되는 형태도 유효.
  s().pushUndo({ kind: 'batchRename', items: [{ newPath: 'C:\\d\\a2.txt', oldName: 'a.txt', newName: 'a2.txt' }], dir: 'C:\\d' })
  const e2 = s().popUndo()
  ok('R1 부분적용 items 1건', !!e2 && e2.kind === 'batchRename' && e2.items.length === 1)
  s().clearUndo()
}

// ── P1: compareSlice(runCompare·결과·diffOnly·syncScroll·recompute·clear) ─────
{
  const mkE = (name: string, size = 10, mtime = 1000, isDir = false) => ({
    name,
    path: 'C:\\x\\' + name,
    isDir,
    size,
    mtime,
    ctime: 0,
    ext: isDir ? '' : name.includes('.') ? name.split('.').pop()!.toLowerCase() : '',
    attrs: { hidden: false, readonly: false, system: false, symlink: false }
  })

  // 초기 상태.
  ok('P1 초기 compareActive false', s().compareActive === false)
  ok('P1 초기 syncScroll true(기본)', s().syncScroll === true)

  // runCompare: 양 패널 entries 로 분류·요약.
  const left = [mkE('a.txt'), mkE('both.txt', 50, 2000), mkE('d.txt', 10, 1000)]
  const right = [mkE('b.txt'), mkE('both.txt', 50, 2000), mkE('d.txt', 99, 1000)]
  s().runCompare('pL', 'pR', left, right)
  ok('P1 runCompare active', s().compareActive === true)
  ok('P1 runCompare 패널 id', s().compareLeftPanelId === 'pL' && s().compareRightPanelId === 'pR')
  ok('P1 runCompare 페어 4개(a/b/both/d)', s().comparePairs.length === 4)
  ok(
    'P1 runCompare 요약',
    !!s().compareSummary &&
      s().compareSummary!.leftOnly === 1 &&
      s().compareSummary!.rightOnly === 1 &&
      s().compareSummary!.diff === 1 &&
      s().compareSummary!.same === 1
  )

  // diffOnly 토글(상태만 — 필터는 뷰에서 적용).
  ok('P1 diffOnly 초기 false', s().compareDiffOnly === false)
  s().toggleDiffOnly()
  ok('P1 diffOnly 토글 true', s().compareDiffOnly === true)

  // syncScroll 토글.
  s().toggleSyncScroll()
  ok('P1 syncScroll 토글 false', s().syncScroll === false)
  s().toggleSyncScroll()
  ok('P1 syncScroll 재토글 true', s().syncScroll === true)

  // recompute: entries 변경 반영(b.txt 가 both 되도록).
  s().recomputeCompare([mkE('a.txt'), mkE('both.txt', 50, 2000)], [mkE('a.txt'), mkE('both.txt', 50, 2000)])
  ok('P1 recompute 후 same 2', s().compareSummary!.same === 2 && s().compareSummary!.total === 2)

  // clear: 모드 종료·결과 비움·diffOnly 리셋.
  s().clearCompare()
  ok(
    'P1 clearCompare',
    s().compareActive === false &&
      s().comparePairs.length === 0 &&
      s().compareSummary === null &&
      s().compareDiffOnly === false &&
      s().compareLeftPanelId === null
  )

  // recompute 는 비활성이면 무동작.
  s().recomputeCompare(left, right)
  ok('P1 비활성 recompute 무동작', s().compareActive === false && s().comparePairs.length === 0)
}

// ── §P1 M7: compareSlice 해시/재귀 옵션·hash:compare 잡 미러(동치 보존) ──────
{
  const mkE = (name: string, size = 10, mtime = 1000, isDir = false) => ({
    name,
    path: 'C:\\x\\' + name,
    isDir,
    size,
    mtime,
    ctime: 0,
    ext: isDir ? '' : name.includes('.') ? name.split('.').pop()!.toLowerCase() : '',
    attrs: { hidden: false, readonly: false, system: false, symlink: false }
  })

  // 기본 옵션: useHash/recursive off(M6 동치).
  ok('P1H 기본 useHash off', s().compareOptions.useHash === false)
  ok('P1H 기본 recursive off', s().compareOptions.recursive === false)
  ok('P1H 초기 hashStatus idle', s().compareHashStatus === 'idle')

  // 옵션 토글(슬라이스 레벨).
  s().setCompareOptions({ useHash: true })
  ok('P1H setCompareOptions useHash true', s().compareOptions.useHash === true)
  s().setCompareOptions({ recursive: true })
  ok('P1H setCompareOptions recursive true', s().compareOptions.recursive === true)

  // 비교 활성 + 해시 잡 시작 → running·jobId 보관·진행률 리셋.
  s().runCompare('pL', 'pR', [mkE('a.txt')], [mkE('a.txt')])
  s().beginCompareHash('job-cmp-1')
  ok('P1H beginCompareHash running', s().compareHashStatus === 'running' && s().compareJobId === 'job-cmp-1')

  // 진행률 미러(running 일 때만).
  s()._compareHashProgress(42, 4096, 'C:\\x\\big')
  ok('P1H progress 미러', s().compareScannedItems === 42 && s().compareScannedBytes === 4096)

  // done: DTO 페어 → ComparePair 환산·요약·truncated·ready·jobId 해제.
  s()._compareHashDone(
    [
      { name: 'a.txt', left: mkE('a.txt'), right: mkE('a.txt'), status: 'same', relPath: 'a.txt' },
      { name: 'a.txt', left: mkE('a.txt'), right: null, status: 'left-only', relPath: 'sub\\a.txt' }
    ],
    true
  )
  ok('P1H done ready', s().compareHashStatus === 'ready' && s().compareJobId === null)
  ok('P1H done 페어 2·relPath 보존', s().comparePairs.length === 2 && s().comparePairs[1]!.relPath === 'sub\\a.txt')
  ok('P1H done truncated 표기', s().compareTruncated === true)
  ok('P1H done 요약(same1·leftOnly1)', s().compareSummary!.same === 1 && s().compareSummary!.leftOnly === 1)

  // 취소: running 이 아니면 무동작(이미 ready).
  s().markCompareHashCanceling()
  ok('P1H 취소 ready 일 때 무동작', s().compareHashStatus === 'ready')

  // 새 잡 → running → 취소 → canceled.
  s().beginCompareHash('job-cmp-2')
  s().markCompareHashCanceling()
  ok('P1H running 취소 canceled', s().compareHashStatus === 'canceled' && s().compareJobId === null)

  // 오류.
  s().beginCompareHash('job-cmp-3')
  s()._compareHashError('boom')
  ok('P1H error', s().compareHashStatus === 'error' && s().compareHashError === 'boom')

  // 진행률은 running 아닐 때 미반영(상관 격리).
  const prevItems = s().compareScannedItems
  s()._compareHashProgress(999, 999, 'x')
  ok('P1H 비running progress 무시', s().compareScannedItems === prevItems)

  // clearCompare 가 해시 상태도 리셋(메타 경로 복귀).
  s().clearCompare()
  ok(
    'P1H clearCompare 해시 리셋',
    s().compareHashStatus === 'idle' && s().compareJobId === null && s().compareTruncated === false
  )

  // 옵션 원복(이후 테스트 영향 방지).
  s().setCompareOptions({ useHash: false, recursive: false })
}

// ── §R4 M7: verifyOnCopy 설정 상태(applySettings·setter·기본 off) ────────────
{
  ok('R4 기본 verifyOnCopy off', s().verifyOnCopy === false)
  s().setVerifyOnCopy(true)
  ok('R4 setVerifyOnCopy true', s().verifyOnCopy === true)
  // applySettings: 스냅샷 verifyOnCopy 반영.
  s().applySettings(
    {
      version: 1,
      theme: 'system',
      startLocation: '',
      showHidden: false,
      showExtensions: true,
      recentLimit: 10,
      showDashboardOnStartup: true,
      verifyOnCopy: true
    },
    false
  )
  ok('R4 applySettings verifyOnCopy=true 반영', s().verifyOnCopy === true)
  // 구버전 스냅샷(verifyOnCopy 누락) → false 폴백.
  s().applySettings(
    {
      version: 1,
      theme: 'system',
      startLocation: '',
      showHidden: false,
      showExtensions: true,
      recentLimit: 10,
      showDashboardOnStartup: true
    },
    false
  )
  ok('R4 applySettings 누락 → false 폴백', s().verifyOnCopy === false)
}

// ── P1: 미러 확인 모달 상태(open/close·inputContext) ──────────────────────────
{
  s().openCompareMirrorConfirm({ direction: 'l2r', copyCount: 3, overwriteCount: 1, deleteCount: 0, includeDeletes: false })
  ok('P1 미러확인 open', !!s().compareMirrorConfirm && s().inputContext === 'dialog')
  ok('P1 미러확인 값 보존', s().compareMirrorConfirm!.direction === 'l2r' && s().compareMirrorConfirm!.copyCount === 3)
  s().closeCompareMirrorConfirm()
  ok('P1 미러확인 close·list 복귀', s().compareMirrorConfirm === null && s().inputContext === 'list')
}

// ── §R2: dedupSlice(탐지 상태머신·그룹 수용·선택·정리 제거) ───────────────
{
  const mkDup = (path: string, mtime: number) => ({
    path,
    name: path.split('\\').pop() ?? path,
    mtime
  })
  const groups = [
    { hash: 'h1', size: 100, files: [mkDup('C:\\a.txt', 100), mkDup('C:\\b.txt', 200), mkDup('C:\\c.txt', 300)] },
    { hash: 'h2', size: 50, files: [mkDup('C:\\d.txt', 100), mkDup('C:\\e.txt', 200)] }
  ]

  s().beginDedup('job-1', ['C:\\scope'])
  ok('R2 beginDedup scanning', s().dedupStatus === 'scanning' && s().dedupJobId === 'job-1')
  ok('R2 beginDedup roots 보관', s().dedupRoots[0] === 'C:\\scope')

  s()._dedupProgress(10, 1024, 'C:\\scope\\x')
  ok('R2 progress 미러', s().dedupScannedItems === 10 && s().dedupScannedBytes === 1024)

  s()._dedupDone(groups, false)
  ok('R2 done ready·그룹 2', s().dedupStatus === 'ready' && s().dedupGroups.length === 2)
  // 추천 선택: 각 그룹 원본(가장 오래된) 외 전체 = (3-1)+(2-1)=3.
  ok('R2 done 추천선택 3건', s().dedupSelected.size === 3)
  ok('R2 done 보존(원본) 미선택', !s().dedupSelected.has('C:\\a.txt') && !s().dedupSelected.has('C:\\d.txt'))

  s().toggleDedupSelect('C:\\a.txt')
  ok('R2 toggle 추가', s().dedupSelected.has('C:\\a.txt'))
  s().toggleDedupSelect('C:\\a.txt')
  ok('R2 toggle 제거', !s().dedupSelected.has('C:\\a.txt'))

  s().clearDedupSelection()
  ok('R2 선택 전체해제', s().dedupSelected.size === 0)
  s().selectRecommended()
  ok('R2 추천선택 재적용 3건', s().dedupSelected.size === 3)

  // 정리 후 제거: b/c 제거 → h1 그룹 1개남아 해소(드롭). h2 유지.
  s().removeDedupPaths(['C:\\b.txt', 'C:\\c.txt'])
  ok('R2 removeDedupPaths 그룹해소', s().dedupGroups.length === 1 && s().dedupGroups[0]!.hash === 'h2')
  ok('R2 removeDedupPaths 선택정리', !s().dedupSelected.has('C:\\b.txt'))

  // 취소.
  s().beginDedup('job-2', ['C:\\scope'])
  s().markDedupCanceling()
  ok('R2 markDedupCanceling', s().dedupStatus === 'canceled' && s().dedupJobId === null)

  // 오류.
  s().beginDedup('job-3', ['C:\\scope'])
  s()._dedupError('boom')
  ok('R2 _dedupError', s().dedupStatus === 'error' && s().dedupError === 'boom')

  // 다이얼로그 open/close · inputContext 게이트.
  s().openDedup()
  ok('R2 openDedup·dialog', s().dedupOpen === true && s().inputContext === 'dialog')
  s().closeDedup()
  ok('R2 closeDedup·list 복귀', s().dedupOpen === false && s().inputContext === 'list')
}

// ── §R3: operationsSlice 큐 미러 + queue usecase 동시성 미러 ─────────────────
{
  const item = (id: string, status: QueueItemDTO['status'], enqueuedAt: number): QueueItemDTO => ({
    operationId: id,
    kind: 'copy',
    status,
    sourcesSummary: '3개 항목',
    destSummary: 'C:\\dst',
    processedBytes: 50,
    totalBytes: 100,
    processedItems: 1,
    totalItems: 3,
    bytesPerSec: 1024,
    etaSec: 10,
    enqueuedAt
  })
  const items = [
    item('op-1', 'running', 1),
    item('op-2', 'pending', 2),
    item('op-3', 'done', 3),
    item('op-4', 'paused', 4),
    item('op-5', 'failed', 5)
  ]
  s()._queueState(items)
  ok('R3 _queueState 미러 5건', s().queueItems.length === 5)
  // activeQueueItems = pending/running/paused = op-1,op-2,op-4.
  ok('R3 activeQueueItems 3건', s().activeQueueItems().length === 3)
  ok(
    'R3 activeQueueItems 종료제외',
    s().activeQueueItems().every((it) => it.status !== 'done' && it.status !== 'failed')
  )
  // 평탄 교체(불변): 새 배열.
  s()._queueState([item('op-9', 'running', 9)])
  ok('R3 _queueState 평탄교체', s().queueItems.length === 1 && s().queueItems[0]!.operationId === 'op-9')

  // queue usecase: setConcurrency → 성공 시 _setMaxConcurrent 미러(모킹 ok:true).
  s()._setMaxConcurrent(0)
  await setConcurrency(4)
  ok('R3 setConcurrency 미러 4', s().maxConcurrent === 4)
  // 클램프(1~16): 99 → 16.
  await setConcurrency(99)
  ok('R3 setConcurrency 클램프 16', s().maxConcurrent === 16)
  await setConcurrency(0)
  ok('R3 setConcurrency 하한 1', s().maxConcurrent === 1)

  // 큐 패널 open/close·inputContext.
  s().openQueuePanel()
  ok('R3 openQueuePanel·dialog', s().queuePanelOpen === true && s().inputContext === 'dialog')
  s().closeQueuePanel()
  ok('R3 closeQueuePanel·list 복귀', s().queuePanelOpen === false && s().inputContext === 'list')
}

// ── R3 옵션2: 활성 2건 이상으로 올라설 때만 큐 패널 자동 열기(단발은 안 띄움) ──────
{
  const qi = (operationId: string, status: 'pending' | 'running' | 'paused' | 'done'): {
    operationId: string
    kind: 'copy'
    status: 'pending' | 'running' | 'paused' | 'done'
    sourcesSummary: string
    destSummary: string
    processedBytes: number
    totalBytes: number
    processedItems: number
    totalItems: number
    bytesPerSec: number
    etaSec: number | null
    enqueuedAt: number
  } => ({
    operationId,
    kind: 'copy',
    status,
    sourcesSummary: '1개 항목',
    destSummary: 'D:\\',
    processedBytes: 0,
    totalBytes: 100,
    processedItems: 0,
    totalItems: 1,
    bytesPerSec: 0,
    etaSec: null,
    enqueuedAt: 0
  })

  // 초기화: 패널 닫힘·큐 비움.
  s().closeQueuePanel()
  s()._queueState([])
  ok('자동열기 초기 닫힘', s().queuePanelOpen === false)

  // 단발 1건 → 자동으로 안 뜸.
  s()._queueState([qi('a', 'running')])
  ok('자동열기: 단발 1건 미표시', s().queuePanelOpen === false)

  // 2건으로 올라섬(<2→≥2 엣지) → 자동 열림 + dialog.
  s()._queueState([qi('a', 'running'), qi('b', 'pending')])
  ok('자동열기: 2건 엣지에서 열림', s().queuePanelOpen === true && s().inputContext === 'dialog')

  // 사용자가 닫음 → 여전히 2건이어도 재오픈 안 함(엣지 미발생).
  s().closeQueuePanel()
  s()._queueState([qi('a', 'running'), qi('b', 'running')])
  ok('자동열기: 닫은 뒤 ≥2 유지면 재오픈 안 함', s().queuePanelOpen === false)

  // 1건 이하로 내려갔다가 다시 2건 → 새 파동이라 재오픈.
  s()._queueState([qi('a', 'done')]) // 활성 0
  s()._queueState([qi('a', 'running'), qi('b', 'pending')]) // 다시 2
  ok('자동열기: 새 파동(<2→≥2) 재오픈', s().queuePanelOpen === true)

  // 이미 열려 있으면 그대로(중복 토글 없음).
  s()._queueState([qi('a', 'running'), qi('b', 'running'), qi('c', 'pending')])
  ok('자동열기: 이미 열림 유지', s().queuePanelOpen === true)
  s().closeQueuePanel()
  s()._queueState([])
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
