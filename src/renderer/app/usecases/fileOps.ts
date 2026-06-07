/**
 * 파일 작업 유스케이스 (app/usecases/fileOps) — op:* 시작·취소·충돌해소·생성·이름변경.
 *
 * roadmap P4(frontend): Ctrl+C/X/V·Delete/Shift+Delete·Ctrl+Shift+N·F2·D&D 가
 * 모두 여기를 거쳐 같은 op:start 경로로 진입한다(SA §8: 마우스/키보드 일관).
 *
 * 경계: app → infra/api(opApi·clipboardApi·dialogApi·fsApi) 직접 호출(.eslintrc 허용).
 * domain 순수 규칙(decideDrop·드라이브 판정)은 domain/rules/dragIntent 에 위임.
 * 완료 후 패널 새로고침은 op:onDone(operationsSlice 브리지)에서 트리거한다(commandBus 아님).
 */
import type { ConflictResolution, OpKind } from '@shared/dto'
import { clipboardApi, fsApi, opApi } from '@renderer/infra/api'
import { store } from '@renderer/app/stores/rootStore'
import type { OperationUndoMeta } from '@renderer/app/stores/operationsSlice'
import { decideDrop, type DragModifiers } from '@renderer/domain/rules/dragIntent'
import { baseName, isMyPc, joinPath, parentOf } from '@renderer/domain/paths'
import { visibleEntries } from './selectors'

/** 활성 탭의 패널 경로 묶음(활성/비활성). */
export interface PanelPaths {
  readonly activePanelId: string | undefined
  readonly activePath: string | undefined
  readonly otherPanelId: string | undefined
  readonly otherPath: string | undefined
}

/**
 * 활성 탭에서 활성 패널과 "다른 패널"의 경로를 산출한다.
 * clipboard/trash/delete/rename/newFolder 등 다수 호출처 공용(activePath 사용).
 * 2분할에서 다른 패널 = 활성 외 첫 패널. 단일 패널이면 other 는 undefined.
 * grid-4(2x2)에서는 결정성을 위해 **같은 행의 반대 열**(인덱스 activeIdx ^ 1:
 * 0↔1, 2↔3) 패널을 대상으로 한다([중대-1]). 비정상 상태면 활성 외 첫 패널로 폴백.
 */
export function panelPaths(): PanelPaths {
  const s = store.getState()
  const tab = s.activeTab()
  if (!tab) {
    return { activePanelId: undefined, activePath: undefined, otherPanelId: undefined, otherPath: undefined }
  }
  const activeId = tab.activePanelId
  let otherId: string | undefined
  if (tab.layout === 'grid-4' && tab.panelIds.length === 4) {
    const activeIdx = tab.panelIds.indexOf(activeId)
    otherId =
      activeIdx >= 0
        ? tab.panelIds[activeIdx ^ 1] ?? tab.panelIds.find((p) => p !== activeId)
        : tab.panelIds.find((p) => p !== activeId)
  } else {
    otherId = tab.panelIds.find((p) => p !== activeId)
  }
  return {
    activePanelId: activeId,
    activePath: s.panels[activeId]?.path,
    otherPanelId: otherId,
    otherPath: otherId ? s.panels[otherId]?.path : undefined
  }
}

/**
 * H-4b: OS 클립보드 상태를 읽어 붙여넣기 활성조건(clipboardHasFiles)을 동기화한다.
 * 마운트 1회 초기화·window focus·붙여넣기 후 재동기에서 호출(IconBar·이 모듈).
 * read 실패 시 보수적으로 false(붙여넣기 흐림) 처리.
 */
export async function syncClipboardState(): Promise<void> {
  const s = store.getState()
  const res = await clipboardApi.read()
  if (!res.ok) {
    s.setClipboardHasFiles(false)
    return
  }
  s.setClipboardHasFiles(res.value.effect !== 'none' && res.value.paths.length > 0)
}

/** 패널의 현재 선택 경로 배열(화면 순서 무관, 선택 집합). */
export function selectedPaths(panelId: string): string[] {
  const sel = store.getState().selection[panelId]
  if (!sel) return []
  return [...sel.selectedPaths]
}

/** 경로가 속한 패널 id 들(완료 후 새로고침 대상 산출). */
function panelsShowingDir(dir: string): string[] {
  const panels = store.getState().panels
  const out: string[] = []
  for (const [id, p] of Object.entries(panels)) {
    if (p.path === dir) out.push(id)
  }
  return out
}

/** 새로고침 대상 디렉토리 배열 → 그 폴더를 보고 있는 패널 id 집합(registerOperation 인자). */
function refreshPanelIds(refreshDirs: readonly string[]): string[] {
  const refreshPaths = new Set<string>()
  for (const d of refreshDirs) {
    if (d !== undefined && d !== '') for (const pid of panelsShowingDir(d)) refreshPaths.add(pid)
  }
  return [...refreshPaths]
}

/**
 * op:start 공통 진입. operationsSlice 에 등록하고 진행률/완료는 이벤트 브리지가 갱신.
 * @returns operationId(성공) 또는 null(시작 실패 — 토스트로 안내됨).
 */
export async function startOperation(
  kind: OpKind,
  sources: string[],
  destDir: string | undefined,
  refreshDirs: string[],
  undoMeta?: OperationUndoMeta
): Promise<string | null> {
  const s = store.getState()
  if (sources.length === 0) {
    s.pushToast('info', '선택된 항목이 없습니다.')
    return null
  }

  const res = await opApi.start(
    destDir !== undefined ? { kind, sources, destDir } : { kind, sources }
  )
  if (!res.ok) {
    s.pushToast('error', `작업을 시작할 수 없습니다: ${res.error.message}`)
    return null
  }
  s.registerOperation(res.value.operationId, kind, refreshPanelIds(refreshDirs), undoMeta)
  return res.value.operationId
}

/** Ctrl+C: 활성 패널 선택을 OS 클립보드에 복사. */
export async function clipboardCopy(): Promise<void> {
  const { activePanelId } = panelPaths()
  const s = store.getState()
  if (!activePanelId) return
  const sources = selectedPaths(activePanelId)
  if (sources.length === 0) return
  const res = await clipboardApi.copyFiles(sources)
  if (!res.ok) s.pushToast('error', `복사 실패: ${res.error.message}`)
  else s.setClipboardHasFiles(true) // H-4b: 복사 성공 → 붙여넣기 활성.
}

/** Ctrl+X: 활성 패널 선택을 잘라내기(클립보드 cut). */
export async function clipboardCut(): Promise<void> {
  const { activePanelId } = panelPaths()
  const s = store.getState()
  if (!activePanelId) return
  const sources = selectedPaths(activePanelId)
  if (sources.length === 0) return
  const res = await clipboardApi.cutFiles(sources)
  if (!res.ok) s.pushToast('error', `잘라내기 실패: ${res.error.message}`)
  else s.setClipboardHasFiles(true) // H-4b: 잘라내기 성공 → 붙여넣기 활성.
}

/**
 * Ctrl+V: 활성 패널 경로로 붙여넣기. Main 이 클립보드 effect(copy/cut)에 따라
 * op(copy|move)를 시작하고 operationId 를 반환한다(pasteTarget → OpStartRes).
 *
 * BUG-001: D&D 와 동일하게, 반환된 operationId 를 operationsSlice 에
 * registerOperation 으로 등록한다. 그래야 op:progress→ProgressDialog,
 * op:conflict→ConflictDialog, op:done→패널 새로고침 브리지가 작동한다
 * (등록 누락 시 충돌 다이얼로그가 안 떠 resolve 불가 → 무한 hang).
 *
 * kind 결정: paste 직전 clipboard:read 의 effect 로(copy→copy / cut→move).
 * refreshPaths: copy=대상 폴더만, cut=원본 부모 폴더 + 대상 폴더 둘 다(양쪽 패널).
 */
export async function clipboardPaste(): Promise<void> {
  const { activePanelId, activePath } = panelPaths()
  const s = store.getState()
  if (!activePanelId || activePath === undefined) return
  if (isMyPc(activePath)) {
    s.pushToast('info', '"내 PC" 에는 붙여넣을 수 없습니다.')
    return
  }

  // effect 로 op kind 와 cut 원본 부모(새로고침 대상) 를 결정한다.
  const clip = await clipboardApi.read()
  if (!clip.ok) {
    s.pushToast('error', `붙여넣기 실패: ${clip.error.message}`)
    return
  }
  if (clip.value.effect === 'none' || clip.value.paths.length === 0) {
    s.pushToast('info', '붙여넣을 항목이 없습니다.')
    return
  }
  const isCut = clip.value.effect === 'cut'
  const kind: OpKind = isCut ? 'move' : 'copy'
  // copy: 대상 폴더만. cut: 원본 부모 폴더들 + 대상 폴더(이동 후 양쪽 새로고침).
  const cutParents = isCut
    ? clip.value.paths.map((p) => parentOf(p)).filter((d): d is string => d !== null)
    : []
  const refreshDirs = isCut ? [...cutParents, activePath] : [activePath]

  const res = await clipboardApi.pasteTarget(activePath)
  if (!res.ok) {
    s.pushToast('error', `붙여넣기 실패: ${res.error.message}`)
    return
  }
  // K1 undo 메타: move=역방향 move(toDir→fromDir), copy=생성 사본 휴지통.
  // 잘라넣기 원본이 단일 폴더에서 온 경우만 move-undo 를 단순·안전하게 산출한다
  // (여러 부모에서 온 cut 은 역방향 일괄 move 가 부정확 → undo 미생성, 보수적).
  const srcPaths = clip.value.paths
  let undoMeta: OperationUndoMeta | undefined
  if (isCut) {
    const parents = new Set(cutParents)
    if (parents.size === 1) {
      undoMeta = { kind: 'move', sources: [...srcPaths], fromDir: [...parents][0] as string, toDir: activePath }
    }
  } else {
    undoMeta = { kind: 'copy', sources: [...srcPaths], destDir: activePath }
  }
  s.registerOperation(res.value.operationId, kind, refreshPanelIds(refreshDirs), undoMeta)
  // H-4b: 붙여넣기 후 재동기(cut 효과면 OS 가 클립보드를 비울 수 있음).
  void syncClipboardState()
}

/** Delete: 활성 패널 선택을 휴지통으로. */
export async function trashSelected(): Promise<void> {
  const { activePanelId, activePath } = panelPaths()
  if (!activePanelId) return
  const sources = selectedPaths(activePanelId)
  if (sources.length === 0) return
  await startOperation('trash', sources, undefined, [activePath ?? ''], {
    kind: 'trash',
    originalPaths: [...sources]
  })
}

/**
 * Shift+Delete: 영구삭제. 확인 모달(uiSlice.confirmDelete) 을 띄우고,
 * 사용자가 confirmPermanentDelete 로 확정하면 op:start(delete)를 수행한다.
 * Main 모달(dialog.confirmPermanentDelete) 대신 Renderer 자체 모달을 1차로 쓰되,
 * 확정 콜백을 confirmPermanentDelete() 에 둔다.
 */
export function requestPermanentDelete(): void {
  const { activePanelId } = panelPaths()
  const s = store.getState()
  if (!activePanelId) return
  const sources = selectedPaths(activePanelId)
  if (sources.length === 0) return
  s.openConfirmDelete(sources)
}

/** 영구삭제 확정(ConfirmDialog 확인 버튼). 모달을 닫고 op:start(delete). */
export async function confirmPermanentDelete(): Promise<void> {
  const s = store.getState()
  const cd = s.confirmDelete
  const { activePath } = panelPaths()
  s.closeConfirmDelete()
  if (!cd || cd.paths.length === 0) return
  await startOperation('delete', cd.paths, undefined, [activePath ?? ''])
}

/** ConflictDialog 응답 → op:resolve. applyToAll 이면 이후 동일 op 충돌 일괄 적용. */
export async function resolveConflict(
  operationId: string,
  conflictId: string,
  resolution: ConflictResolution,
  applyToAll: boolean
): Promise<void> {
  const s = store.getState()
  // 큐에서 먼저 제거(낙관적) — Main 응답 실패 시 done 이벤트로 정리됨.
  s.popConflict(operationId, applyToAll)
  const res = await opApi.resolve({ operationId, conflictId, resolution, applyToAll })
  if (!res.ok) s.pushToast('error', `충돌 처리 실패: ${res.error.message}`)
}

/** ProgressDialog 취소 버튼 → op:cancel. */
export async function cancelOperation(operationId: string): Promise<void> {
  const s = store.getState()
  s.markCancelling(operationId)
  const res = await opApi.cancel(operationId)
  if (!res.ok) s.pushToast('error', `취소 실패: ${res.error.message}`)
}

// ── 생성 / 이름변경 (fs:mkdir/create-file/rename) ───────────────────────

/** FileOpError 코드 → 생성/이름변경 사용자 안내. */
export function nameOpErrorMessage(code: string): string {
  switch (code) {
    case 'EEXIST':
      return '같은 이름의 항목이 이미 있습니다.'
    case 'EINVAL':
      return '이름에 사용할 수 없는 문자가 있거나 예약된 이름입니다.'
    case 'EACCES':
    case 'EPERM':
      return '권한이 없어 작업할 수 없습니다.'
    case 'ENOENT':
      return '대상 폴더를 찾을 수 없습니다.'
    default:
      return '작업에 실패했습니다.'
  }
}

/**
 * Ctrl+Shift+N: 활성 패널에 새 폴더 생성 후 즉시 인라인 이름편집 진입.
 * 기본명 "새 폴더" 가 중복이면 Main(fs:mkdir)이 EEXIST → 번호 부여는 호출측에서 재시도.
 */
export async function createNewFolder(): Promise<void> {
  const { activePanelId, activePath } = panelPaths()
  const s = store.getState()
  if (!activePanelId || activePath === undefined || isMyPc(activePath)) {
    s.pushToast('info', '이 위치에는 새 폴더를 만들 수 없습니다.')
    return
  }
  const baseName = '새 폴더'
  let name = baseName
  let res = await fsApi.mkdir({ parentDir: activePath, name })
  // 중복이면 "새 폴더 (n)" 으로 자동 증가(최대 50회).
  for (let n = 2; !res.ok && res.error.code === 'EEXIST' && n <= 50; n++) {
    name = `${baseName} (${n})`
    res = await fsApi.mkdir({ parentDir: activePath, name })
  }
  if (!res.ok) {
    s.pushToast('error', nameOpErrorMessage(res.error.code))
    return
  }
  // K1 undo: 새 폴더 생성 역연산 = 휴지통 보내기.
  s.pushUndo({ kind: 'create', path: res.value.path })
  s.refresh(activePanelId)
  // 즉시 이름편집(US-2.2).
  s.startRename({
    panelId: activePanelId,
    path: res.value.path,
    initialName: res.value.name,
    isNew: true
  })
}

/** 컨텍스트 메뉴 "새 파일": 빈 텍스트 파일 생성 후 이름편집. */
export async function createNewFile(): Promise<void> {
  const { activePanelId, activePath } = panelPaths()
  const s = store.getState()
  if (!activePanelId || activePath === undefined || isMyPc(activePath)) {
    s.pushToast('info', '이 위치에는 새 파일을 만들 수 없습니다.')
    return
  }
  const baseName = '새 파일.txt'
  let name = baseName
  let res = await fsApi.createFile({ parentDir: activePath, name })
  for (let n = 2; !res.ok && res.error.code === 'EEXIST' && n <= 50; n++) {
    name = `새 파일 (${n}).txt`
    res = await fsApi.createFile({ parentDir: activePath, name })
  }
  if (!res.ok) {
    s.pushToast('error', nameOpErrorMessage(res.error.code))
    return
  }
  // K1 undo: 새 파일 생성 역연산 = 휴지통 보내기.
  s.pushUndo({ kind: 'create', path: res.value.path })
  s.refresh(activePanelId)
  s.startRename({
    panelId: activePanelId,
    path: res.value.path,
    initialName: res.value.name,
    isNew: true
  })
}

/** F2: 활성 패널의 단일 선택 항목 인라인 이름편집 시작. */
export function startRenameSelected(): void {
  const { activePanelId } = panelPaths()
  const s = store.getState()
  if (!activePanelId) return
  const paths = selectedPaths(activePanelId)
  if (paths.length !== 1) {
    if (paths.length === 0) s.pushToast('info', '이름을 바꿀 항목을 선택하세요.')
    else s.pushToast('info', '한 번에 한 항목만 이름을 바꿀 수 있습니다.')
    return
  }
  const target = paths[0] as string
  const entry = visibleEntries(activePanelId).find((e) => e.path === target)
  if (!entry) return
  s.startRename({
    panelId: activePanelId,
    path: entry.path,
    initialName: entry.name,
    isNew: false
  })
}

/**
 * 인라인 이름편집 커밋(FileListView input 의 Enter/blur). EEXIST/EINVAL 처리.
 * @returns 커밋 성공 여부(실패 시 편집 유지하도록 false).
 */
export async function commitRename(
  panelId: string,
  path: string,
  newName: string
): Promise<boolean> {
  const s = store.getState()
  const trimmed = newName.trim()
  if (trimmed === '') {
    s.pushToast('info', '이름을 입력하세요.')
    return false
  }
  const oldName = baseName(path)
  const res = await fsApi.rename({ path, newName: trimmed })
  if (!res.ok) {
    s.pushToast('error', nameOpErrorMessage(res.error.code))
    return false
  }
  // K1 undo: 이름변경 역연산(newPath→oldName). 실제 이름이 바뀐 경우만 적재.
  if (res.value.name !== oldName) {
    s.pushUndo({ kind: 'rename', newPath: res.value.path, oldName, newName: res.value.name })
  }
  s.endRename()
  s.refresh(panelId)
  return true
}

// ── 패널 간 D&D 실행 (domain decideDrop → op:start) ─────────────────────

export interface DropRequest {
  readonly sources: string[]
  readonly sourcePanelId: string
  readonly sourceDir: string
  /** 드롭 대상 폴더(빈영역=패널 폴더, 폴더 항목 위=joinPath). */
  readonly destDir: string
  readonly mods: DragModifiers
}

/**
 * 드롭 실행 — 선검증(decideDrop) 통과 시 op:start(intent). 무시/차단은 안내.
 * @returns 실제 작업을 시작했으면 true.
 */
export async function performDrop(req: DropRequest): Promise<boolean> {
  const s = store.getState()
  const decision = decideDrop(req.sources, req.sourceDir, req.destDir, req.mods)
  if (!decision.allowed) {
    if (decision.reason === 'into-descendant') s.pushToast('error', decision.message)
    // same-folder/no-sources 는 조용히 무시(복사본 생성 안 함).
    return false
  }
  const kind: OpKind = decision.intent === 'copy' ? 'copy' : 'move'
  const undoMeta: OperationUndoMeta =
    kind === 'copy'
      ? { kind: 'copy', sources: [...req.sources], destDir: req.destDir }
      : { kind: 'move', sources: [...req.sources], fromDir: req.sourceDir, toDir: req.destDir }
  const id = await startOperation(kind, req.sources, req.destDir, [req.destDir, req.sourceDir], undoMeta)
  return id !== null
}

/** 드롭 대상 폴더 해석: 폴더 항목 위면 그 폴더, 아니면 패널 폴더(빈영역). */
export function resolveDropDir(panelDir: string, overEntryDir: string | null): string {
  if (overEntryDir === null) return panelDir
  return overEntryDir
}

/** joinPath 재노출(UI 가 폴더 항목 경로를 만들 때). */
export { joinPath }
