/* P4 파일작업(operationsSlice·fileOps·drag intent) 검증 하니스. window.api 모킹. */

// ── 가변 모킹 상태(테스트가 동작을 바꾼다) ───────────────────────────────
interface Captured {
  opStart: Array<{ kind: string; sources: string[]; destDir?: string; conflictPolicy?: string }>
  opResolve: Array<{ operationId: string; conflictId: string; resolution: string; applyToAll: boolean }>
  opCancel: string[]
  clipCopy: string[][]
  clipCut: string[][]
  paste: string[]
  mkdir: Array<{ parentDir: string; name: string }>
  rename: Array<{ path: string; newName: string }>
}
const cap: Captured = {
  opStart: [],
  opResolve: [],
  opCancel: [],
  clipCopy: [],
  clipCut: [],
  paste: [],
  mkdir: [],
  rename: []
}
// mkdir/rename 가 EEXIST 를 낼지 제어. clipRead: clipboard:read 가 돌려줄 effect/paths.
const ctrl = {
  mkdirExistsTimes: 0,
  renameError: '' as '' | 'EEXIST' | 'EINVAL',
  clipRead: { paths: [] as string[], effect: 'none' as 'copy' | 'cut' | 'none' }
}

let opSeq = 0
const fakeApi = {
  version: 'test',
  fs: {
    list: async () => ({ ok: true, value: { entries: [], truncated: false } }),
    stat: async () => ({ ok: false, error: { code: 'ENOENT', message: 'x' } }),
    drives: async () => ({ ok: true, value: [] }),
    treeChildren: async () => ({ ok: true, value: [] }),
    validatePath: async () => ({ ok: true, value: { exists: true, isDir: true, normalized: 'C:\\' } }),
    listStart: async () => ({ ok: true, value: { streamId: `sid-${++opSeq}` } }),
    listCancel: async () => ({ ok: true, value: undefined }),
    onListChunk: () => () => undefined,
    onListDone: () => () => undefined,
    onListError: () => () => undefined,
    mkdir: async (req: { parentDir: string; name: string }) => {
      cap.mkdir.push(req)
      if (ctrl.mkdirExistsTimes > 0) {
        ctrl.mkdirExistsTimes -= 1
        return { ok: false, error: { code: 'EEXIST', message: '' } }
      }
      return {
        ok: true,
        value: {
          name: req.name,
          path: `${req.parentDir}\\${req.name}`,
          isDir: true,
          size: 0,
          mtime: 0,
          ctime: 0,
          ext: '',
          attrs: { hidden: false, readonly: false, system: false, symlink: false }
        }
      }
    },
    createFile: async () => ({ ok: false, error: { code: 'EINVAL', message: '' } }),
    rename: async (req: { path: string; newName: string }) => {
      cap.rename.push(req)
      if (ctrl.renameError) return { ok: false, error: { code: ctrl.renameError, message: '' } }
      return {
        ok: true,
        value: {
          name: req.newName,
          path: `C:\\x\\${req.newName}`,
          isDir: false,
          size: 0,
          mtime: 0,
          ctime: 0,
          ext: '',
          attrs: { hidden: false, readonly: false, system: false, symlink: false }
        }
      }
    }
  },
  shell: {
    open: async () => ({ ok: true, value: undefined }),
    openWith: async () => ({ ok: true, value: undefined }),
    showProperties: async () => ({ ok: true, value: undefined }),
    icon: async () => ({ ok: false, error: { code: 'EUNKNOWN', message: '' } })
  },
  op: {
    start: async (req: { kind: string; sources: string[]; destDir?: string }) => {
      cap.opStart.push(req)
      return { ok: true, value: { operationId: `op-${++opSeq}` } }
    },
    resolve: async (req: { operationId: string; conflictId: string; resolution: string; applyToAll: boolean }) => {
      cap.opResolve.push(req)
      return { ok: true, value: undefined }
    },
    cancel: async (req: { operationId: string }) => {
      cap.opCancel.push(req.operationId)
      return { ok: true, value: undefined }
    },
    onProgress: () => () => undefined,
    onConflict: () => () => undefined,
    onDone: () => () => undefined
  },
  clipboard: {
    copyFiles: async (req: { paths: string[] }) => {
      cap.clipCopy.push(req.paths)
      return { ok: true, value: undefined }
    },
    cutFiles: async (req: { paths: string[] }) => {
      cap.clipCut.push(req.paths)
      return { ok: true, value: undefined }
    },
    pasteTarget: async (req: { destDir: string }) => {
      cap.paste.push(req.destDir)
      // BUG-001: paste-target 은 op 를 시작하고 operationId 를 반환한다(OpStartRes).
      return { ok: true, value: { operationId: `op-${++opSeq}` } }
    },
    read: async () => ({
      ok: true,
      value: { paths: [...ctrl.clipRead.paths], effect: ctrl.clipRead.effect }
    })
  },
  dialog: {
    confirmPermanentDelete: async () => ({ ok: true, value: { confirmed: true } })
  }
}
;(globalThis as unknown as { api: unknown }).api = fakeApi
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
  observe(): void {}
  disconnect(): void {}
}

import { useRootStore } from '../src/renderer/app/stores/rootStore'
import {
  panelPaths,
  clipboardCopy,
  clipboardCut,
  clipboardPaste,
  trashSelected,
  requestPermanentDelete,
  confirmPermanentDelete,
  resolveConflict,
  cancelOperation,
  createNewFolder,
  startRenameSelected,
  commitRename,
  performDrop
} from '../src/renderer/app/usecases/fileOps'
import {
  resolveDragIntent,
  decideDrop,
  driveOf,
  sameDrive,
  isInsideOrEqual
} from '../src/renderer/domain/rules/dragIntent'
import type { FileEntryDTO, OpSummary } from '../src/shared/dto'

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
const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await Promise.resolve()
}
function reset(): void {
  cap.opStart = []
  cap.opResolve = []
  cap.opCancel = []
  cap.clipCopy = []
  cap.clipCut = []
  cap.paste = []
  cap.mkdir = []
  cap.rename = []
}

const mkEntry = (name: string, isDir: boolean, path: string): FileEntryDTO => ({
  name,
  path,
  isDir,
  size: isDir ? 0 : 100,
  mtime: 0,
  ctime: 0,
  ext: isDir ? '' : (name.split('.').pop() as string),
  attrs: { hidden: false, readonly: false, system: false, symlink: false }
})

// ════════════════════════════════════════════════════════════════════════
// 1) drag intent 순수 함수 (같은/다른 드라이브 · 수정키 · 순환 차단)
// ════════════════════════════════════════════════════════════════════════
ok('driveOf C:\\a\\b = C', driveOf('C:\\a\\b') === 'C')
ok('driveOf 소문자 정규화', driveOf('d:\\x') === 'D')
ok('driveOf UNC', driveOf('\\\\srv\\share\\x') === '\\\\SRV\\SHARE')
ok('driveOf 내 PC = 빈', driveOf('') === '')
ok('sameDrive C vs C', sameDrive('C:\\a', 'C:\\b') === true)
ok('sameDrive C vs D', sameDrive('C:\\a', 'D:\\b') === false)
ok('sameDrive 미상이면 false', sameDrive('', 'C:\\b') === false)

const noMod = { ctrl: false, shift: false }
ok('같은 드라이브=이동', resolveDragIntent('C:\\a', 'C:\\b', noMod) === 'move')
ok('다른 드라이브=복사', resolveDragIntent('C:\\a', 'D:\\b', noMod) === 'copy')
ok('Ctrl=복사 강제(같은 드라이브)', resolveDragIntent('C:\\a', 'C:\\b', { ctrl: true, shift: false }) === 'copy')
ok('Shift=이동 강제(다른 드라이브)', resolveDragIntent('C:\\a', 'D:\\b', { ctrl: false, shift: true }) === 'move')
ok('Ctrl+Shift 동시면 복사 우선', resolveDragIntent('C:\\a', 'C:\\b', { ctrl: true, shift: true }) === 'copy')

ok('isInsideOrEqual 자기자신', isInsideOrEqual('C:\\a', 'C:\\a') === true)
ok('isInsideOrEqual 자손', isInsideOrEqual('C:\\a', 'C:\\a\\b\\c') === true)
ok('isInsideOrEqual 형제 아님', isInsideOrEqual('C:\\a', 'C:\\ab') === false)
ok('isInsideOrEqual 상위는 false', isInsideOrEqual('C:\\a\\b', 'C:\\a') === false)

// decideDrop: 순환 차단
const dCircular = decideDrop(['C:\\a'], 'C:\\', 'C:\\a\\sub', noMod)
ok('decideDrop 조상→자손 차단', !dCircular.allowed && dCircular.reason === 'into-descendant')
// decideDrop: 동일 폴더 무시
const dSame = decideDrop(['C:\\a\\x.txt'], 'C:\\a', 'C:\\a', noMod)
ok('decideDrop 동일 폴더 무시', !dSame.allowed && dSame.reason === 'same-folder')
// decideDrop: 동일 폴더 + Ctrl 강제 복사 = 허용
const dSameCtrl = decideDrop(['C:\\a\\x.txt'], 'C:\\a', 'C:\\a', { ctrl: true, shift: false })
ok('decideDrop 동일 폴더+Ctrl=복사 허용', dSameCtrl.allowed && dSameCtrl.intent === 'copy')
// decideDrop: 정상 이동
const dMove = decideDrop(['C:\\a\\x.txt'], 'C:\\a', 'C:\\b', noMod)
ok('decideDrop 정상 이동 허용', dMove.allowed && dMove.intent === 'move')
const dCopy = decideDrop(['C:\\a\\x.txt'], 'C:\\a', 'D:\\b', noMod)
ok('decideDrop 다른 드라이브=복사 허용', dCopy.allowed && dCopy.intent === 'copy')

// ════════════════════════════════════════════════════════════════════════
// 2) 스토어 부트 + 2분할로 F5/F6 대상 경로 산출
// ════════════════════════════════════════════════════════════════════════
s().initDefaultTab()
const pid0 = s().activePanelId()!
s().navigate(pid0, 'C:\\src', true)
await flush()
s().toggleSplit2() // 2분할: 둘째 패널 동일 경로
const tab = s().activeTab()!
const left = tab.panelIds[0]!
const right = tab.panelIds[1]!
s().setActivePanel(tab.id, left)
s().navigate(left, 'C:\\src', false)
s().navigate(right, 'D:\\dst', false)
await flush()

const pp = panelPaths()
ok('panelPaths 활성=left', pp.activePanelId === left)
ok('panelPaths 활성 경로 C:\\src', pp.activePath === 'C:\\src')
ok('panelPaths other=right', pp.otherPanelId === right)
ok('panelPaths other 경로 D:\\dst', pp.otherPath === 'D:\\dst')

// 활성 패널에 엔트리·선택 주입.
const sid = s().panels[left]!.directory.streamId
if (sid) s()._onChunk(left, sid, [mkEntry('a.txt', false, 'C:\\src\\a.txt'), mkEntry('b.txt', false, 'C:\\src\\b.txt')])
s().selectAll(left, ['C:\\src\\a.txt', 'C:\\src\\b.txt'])
ok('선택 2개', s().selection[left]!.selectedPaths.size === 2)

// (J3) F5/F6 다른 패널 복사·이동은 제거됨 — 클립보드/D&D 경로만 유지.

// ════════════════════════════════════════════════════════════════════════
// 3) 클립보드 copy/cut/paste
// ════════════════════════════════════════════════════════════════════════
reset()
await clipboardCopy()
ok('Ctrl+C clipboard.copyFiles', cap.clipCopy.length === 1 && cap.clipCopy[0]!.length === 2)
await clipboardCut()
ok('Ctrl+X clipboard.cutFiles', cap.clipCut.length === 1)

// ── BUG-001: copy 붙여넣기 → registerOperation 으로 op 등록(진행률/충돌 추적) ──
// 활성=left(C:\src). 클립보드 effect=copy → kind=copy, refresh=대상 폴더(left)만.
reset()
const beforeCopyOps = s().operationOrder.length
ctrl.clipRead = { paths: ['D:\\dst\\p.txt'], effect: 'copy' }
await clipboardPaste()
ok('Ctrl+V(copy) pasteTarget = 활성 경로', cap.paste.length === 1 && cap.paste[0] === 'C:\\src')
ok('Ctrl+V(copy) op 등록됨(BUG-001 핵심)', s().operationOrder.length === beforeCopyOps + 1)
const copyOpId = s().operationOrder[s().operationOrder.length - 1]!
ok('Ctrl+V(copy) kind=copy', s().operations[copyOpId]!.kind === 'copy')
// copy: 대상 폴더(C:\src=left)만 새로고침. 원본 부모(D:\dst=right)는 포함 안 함.
ok('Ctrl+V(copy) refresh=대상 패널만', JSON.stringify(s().operations[copyOpId]!.refreshPaths.slice().sort()) === JSON.stringify([left]))

// progress → ProgressDialog 표시 경로(활성 작업 존재 = 다이얼로그 표시 조건)
s()._opProgress({
  operationId: copyOpId,
  processedBytes: 30,
  totalBytes: 100,
  processedItems: 1,
  totalItems: 1,
  currentName: 'p.txt'
})
ok('Ctrl+V(copy) progress → 진행 작업 존재(ProgressDialog 조건)', s().activeOperations().some((o) => o.operationId === copyOpId && o.progress.processedBytes === 30))
// done → 등록 패널 새로고침 경로(refreshPaths 에 left 포함 = 새로고침 대상)
s()._opDone(copyOpId, { operationId: copyOpId, kind: 'copy', succeededItems: 1, failedItems: 0, canceled: false, failures: [] })
ok('Ctrl+V(copy) done', s().operations[copyOpId]!.status === 'done')
s().dismissOperation(copyOpId)

// ── BUG-001: cut 붙여넣기 → kind=move, 양쪽 패널 새로고침 + 충돌 resolve(hang 없음) ──
// 원본 D:\dst\q.txt(부모 D:\dst=right) 를 활성 C:\src(left) 로 cut-paste.
reset()
const beforeCutOps = s().operationOrder.length
ctrl.clipRead = { paths: ['D:\\dst\\q.txt'], effect: 'cut' }
await clipboardPaste()
ok('Ctrl+V(cut) op 등록됨', s().operationOrder.length === beforeCutOps + 1)
const cutOpId = s().operationOrder[s().operationOrder.length - 1]!
ok('Ctrl+V(cut) kind=move', s().operations[cutOpId]!.kind === 'move')
// cut: 원본 부모(D:\dst=right) + 대상(C:\src=left) 둘 다 → 양쪽 패널.
ok('Ctrl+V(cut) refresh=양쪽 패널(원본+대상)', JSON.stringify(s().operations[cutOpId]!.refreshPaths.slice().sort()) === JSON.stringify([left, right].sort()))

// 충돌 발생 → ConflictDialog 큐 적재 → resolve(hang 없이 진행)
s()._opConflict({
  operationId: cutOpId,
  conflictId: 'cc1',
  source: mkEntry('q.txt', false, 'D:\\dst\\q.txt'),
  target: mkEntry('q.txt', false, 'C:\\src\\q.txt')
})
ok('Ctrl+V(cut) 충돌 큐 적재(ConflictDialog 표시)', s().headConflict()?.operationId === cutOpId)
ok('Ctrl+V(cut) 충돌 시 status=conflict', s().operations[cutOpId]!.status === 'conflict')
await resolveConflict(cutOpId, 'cc1', 'overwrite', false)
ok('Ctrl+V(cut) resolve 호출(hang 없음)', cap.opResolve.length === 1 && cap.opResolve[0]!.operationId === cutOpId)
ok('Ctrl+V(cut) resolve 후 running 복귀(진행 재개)', s().conflictQueue.length === 0 && s().operations[cutOpId]!.status === 'running')
// done → 양쪽 패널 refreshPaths 보존(새로고침 대상)
s()._opDone(cutOpId, { operationId: cutOpId, kind: 'move', succeededItems: 1, failedItems: 0, canceled: false, failures: [] })
ok('Ctrl+V(cut) done', s().operations[cutOpId]!.status === 'done')
s().dismissOperation(cutOpId)
ctrl.clipRead = { paths: [], effect: 'none' }

// 빈 클립보드(effect=none)면 op 시작 안 함.
reset()
const beforeEmpty = s().operationOrder.length
await clipboardPaste()
ok('Ctrl+V 빈 클립보드 → op 미등록·paste 미호출', cap.paste.length === 0 && s().operationOrder.length === beforeEmpty)

// ════════════════════════════════════════════════════════════════════════
// 4) 휴지통 / 영구삭제(확인 모달)
// ════════════════════════════════════════════════════════════════════════
reset()
await trashSelected()
ok('Delete op:start trash', cap.opStart.length === 1 && cap.opStart[0]!.kind === 'trash')

reset()
requestPermanentDelete()
ok('Shift+Delete 확인모달 오픈', s().confirmDelete !== null && s().inputContext === 'dialog')
ok('확인모달 대상 2개', s().confirmDelete!.paths.length === 2)
await confirmPermanentDelete()
ok('확인 후 op:start delete', cap.opStart.length === 1 && cap.opStart[0]!.kind === 'delete')
ok('확인모달 닫힘 + 컨텍스트 복귀', s().confirmDelete === null && s().inputContext === 'list')

// ════════════════════════════════════════════════════════════════════════
// 5) op 진행률 반영 → done(부분실패) → 충돌 큐 → resolve → 취소
// ════════════════════════════════════════════════════════════════════════
reset()
s().registerOperation('op-X', 'copy', [left])
ok('register status running', s().operations['op-X']!.status === 'running')
s()._opProgress({
  operationId: 'op-X',
  processedBytes: 50,
  totalBytes: 100,
  processedItems: 1,
  totalItems: 2,
  currentName: 'a.txt'
})
ok('progress 반영(50/100)', s().operations['op-X']!.progress.processedBytes === 50)

// 충돌 큐
s()._opConflict({
  operationId: 'op-X',
  conflictId: 'c1',
  source: mkEntry('a.txt', false, 'C:\\src\\a.txt'),
  target: mkEntry('a.txt', false, 'D:\\dst\\a.txt')
})
ok('충돌 큐 적재', s().conflictQueue.length === 1 && s().operations['op-X']!.status === 'conflict')
ok('headConflict = c1', s().headConflict()!.conflictId === 'c1')
// 중복 푸시 무시
s()._opConflict({
  operationId: 'op-X',
  conflictId: 'c1',
  source: mkEntry('a.txt', false, 'C:\\src\\a.txt'),
  target: mkEntry('a.txt', false, 'D:\\dst\\a.txt')
})
ok('충돌 중복 무시', s().conflictQueue.length === 1)

await resolveConflict('op-X', 'c1', 'rename', false)
ok('resolve op:resolve 호출', cap.opResolve.length === 1 && cap.opResolve[0]!.resolution === 'rename')
ok('resolve 후 큐 비움 + running 복귀', s().conflictQueue.length === 0 && s().operations['op-X']!.status === 'running')

// 취소
reset()
await cancelOperation('op-X')
ok('cancel op:cancel 호출', cap.opCancel.length === 1 && cap.opCancel[0] === 'op-X')
ok('cancel status=cancelling', s().operations['op-X']!.status === 'cancelling')

// done(부분 실패)
const summary: OpSummary = {
  operationId: 'op-X',
  kind: 'copy',
  succeededItems: 1,
  failedItems: 1,
  canceled: true,
  failures: [{ path: 'D:\\dst\\b.txt', code: 'EBUSY', message: '사용 중' }]
}
s()._opDone('op-X', summary)
ok('done partial-failed', s().operations['op-X']!.status === 'partial-failed')
ok('done summary 보존', s().operations['op-X']!.summary!.failedItems === 1)
s().dismissOperation('op-X')
ok('dismiss 후 목록 제거', s().operations['op-X'] === undefined)

// applyToAll 큐 비우기
s()._opConflict({ operationId: 'op-Y', conflictId: 'a', source: mkEntry('x', false, 'C:\\x'), target: mkEntry('x', false, 'D:\\x') })
s()._opConflict({ operationId: 'op-Y', conflictId: 'b', source: mkEntry('y', false, 'C:\\y'), target: mkEntry('y', false, 'D:\\y') })
ok('op-Y 충돌 2개', s().conflictQueue.filter((c) => c.operationId === 'op-Y').length === 2)
s().registerOperation('op-Y', 'copy', [])
s().popConflict('op-Y', true)
ok('applyToAll → op-Y 큐 전부 제거', s().conflictQueue.filter((c) => c.operationId === 'op-Y').length === 0)

// ════════════════════════════════════════════════════════════════════════
// 6) mkdir 자동 증가(EEXIST) + 이름변경 오류 처리
// ════════════════════════════════════════════════════════════════════════
reset()
ctrl.mkdirExistsTimes = 2 // "새 폴더", "새 폴더 (2)" 가 충돌, "새 폴더 (3)" 성공
await createNewFolder()
ok('mkdir 3회 시도(2회 EEXIST)', cap.mkdir.length === 3)
ok('mkdir 최종 이름 "새 폴더 (3)"', cap.mkdir[2]!.name === '새 폴더 (3)')
ok('새 폴더 후 인라인 이름편집 진입', s().renameTarget !== null && s().inputContext === 'rename')
s().endRename()
ok('endRename 후 컨텍스트 복귀', s().renameTarget === null && s().inputContext === 'list')

// 이름변경: 단일 선택 → 편집 시작 → 커밋 성공/실패
// (createNewFolder 가 left 패널을 refresh 해 엔트리를 비웠으므로 재주입)
reset()
await flush()
const sid2 = s().panels[left]!.directory.streamId
if (sid2) {
  s()._onChunk(left, sid2, [mkEntry('a.txt', false, 'C:\\src\\a.txt'), mkEntry('b.txt', false, 'C:\\src\\b.txt')])
  s()._onDone(left, sid2, 2, false)
}
s().clearSelection(left)
s().clickSelect(left, ['C:\\src\\a.txt', 'C:\\src\\b.txt'], 0, false, false)
ok('단일 선택', s().selection[left]!.selectedPaths.size === 1)
startRenameSelected()
ok('F2 인라인 편집 진입', s().renameTarget !== null && s().renameTarget!.path === 'C:\\src\\a.txt')

ctrl.renameError = 'EEXIST'
const r1 = await commitRename(left, 'C:\\src\\a.txt', 'b.txt')
ok('rename EEXIST → 실패(편집 유지)', r1 === false && s().renameTarget !== null)
ctrl.renameError = ''
const r2 = await commitRename(left, 'C:\\src\\a.txt', 'c.txt')
ok('rename 성공 → 커밋', r2 === true && s().renameTarget === null)
ok('rename req 전달', cap.rename.some((r) => r.newName === 'c.txt'))

// ════════════════════════════════════════════════════════════════════════
// 7) performDrop (decideDrop 통과 시 op:start / 차단 시 무동작)
// ════════════════════════════════════════════════════════════════════════
reset()
const okDrop = await performDrop({
  sources: ['C:\\src\\a.txt'],
  sourcePanelId: left,
  sourceDir: 'C:\\src',
  destDir: 'D:\\dst',
  mods: noMod
})
ok('performDrop 다른 드라이브 → copy op:start', okDrop && cap.opStart.length === 1 && cap.opStart[0]!.kind === 'copy')

reset()
const blocked = await performDrop({
  sources: ['C:\\src'],
  sourcePanelId: left,
  sourceDir: 'C:\\',
  destDir: 'C:\\src\\sub',
  mods: noMod
})
ok('performDrop 순환 차단 → 무동작', blocked === false && cap.opStart.length === 0)

reset()
const sameFolder = await performDrop({
  sources: ['C:\\src\\a.txt'],
  sourcePanelId: left,
  sourceDir: 'C:\\src',
  destDir: 'C:\\src',
  mods: noMod
})
ok('performDrop 동일 폴더 → 무시', sameFolder === false && cap.opStart.length === 0)

reset()
const sameDrop = await performDrop({
  sources: ['C:\\src\\a.txt'],
  sourcePanelId: left,
  sourceDir: 'C:\\src',
  destDir: 'C:\\dst2',
  mods: noMod
})
ok('performDrop 같은 드라이브 → move op:start', sameDrop && cap.opStart[0]!.kind === 'move')

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
