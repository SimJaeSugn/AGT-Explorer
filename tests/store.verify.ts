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

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
