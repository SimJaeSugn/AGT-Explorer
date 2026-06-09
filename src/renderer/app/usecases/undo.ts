/**
 * undo 유스케이스 (K장 K1) — Ctrl+Z 진입. 스택 top 을 pop 해 kind 별 역연산을 수행한다.
 *
 * 충돌 선검증 원칙: 역연산 전 항상 대상 상태를 확인한다. 동명 항목이 새로 생겼으면
 * **덮어쓰지 않고** 안내 토스트 후 중단한다(임의 덮어쓰기 금지). 영구삭제(delete)는
 * 애초에 엔트리를 만들지 않으므로 여기 분기가 없다. 빈 스택이면 안내한다.
 *
 * app → infra/api(fsApi·trashApi) + startOperation(fileOps) 경유. 역연산도 op:start 를
 * 쓰는 경우(create→trash, move 역방향, copy→trash) 진행률/충돌/완료 브리지가 동작한다.
 * (역연산 op 에는 undoMeta 를 주지 않아 undo 의 undo 가 스택을 오염시키지 않는다.)
 */
import { fsApi, trashApi } from '@renderer/infra/api'
import { store } from '@renderer/app/stores/rootStore'
import { baseName, joinPath, parentOf } from '@renderer/domain/paths'
import type { UndoEntry } from '@renderer/app/stores/undoSlice'
import { startOperation } from './fileOps'

/** 경로가 실제 존재하는지(validatePath.exists). 조회 실패 시 보수적으로 true(중단 우선). */
async function pathExists(path: string): Promise<boolean> {
  const res = await fsApi.validatePath({ path })
  if (!res.ok) return true
  return res.value.exists
}

/** Ctrl+Z 진입. 스택 top 을 꺼내 kind 별 역연산. */
export async function performUndo(): Promise<void> {
  const s = store.getState()
  const entry = s.popUndo()
  if (!entry) {
    s.pushToast('info', '되돌릴 작업이 없습니다.')
    return
  }
  switch (entry.kind) {
    case 'rename':
      await undoRename(entry)
      return
    case 'create':
      await undoCreate(entry)
      return
    case 'move':
      await undoMove(entry)
      return
    case 'copy':
      await undoCopy(entry)
      return
    case 'trash':
      await undoTrash(entry)
      return
    case 'batchRename':
      await undoBatchRename(entry)
      return
  }
}

/**
 * batchRename 역연산(R1·§R·F22): 각 item 을 newPath → oldName 으로 되돌린다.
 *
 * - 충돌 선검증(undoRename 원칙 재사용): newPath 부재면 그 항목 건너뜀,
 *   oldName 자리에 동명 항목이 새로 생겼으면 덮어쓰지 않고 그 항목만 건너뜀.
 * - **순환(A→B, B→A) 회피**: 묶음 내 복원 목표 이름끼리 또는 현재 이름과 충돌하면
 *   2단계 rename(임시명 경유)으로 안전 처리(applyBatchRename 과 동일 원칙).
 * - 부분 복원 가능(fs 비원자) → 결과를 정직 안내(은폐 금지·계획서 §6.2·§10.3).
 */
async function undoBatchRename(entry: Extract<UndoEntry, { kind: 'batchRename' }>): Promise<void> {
  const s = store.getState()
  if (entry.items.length === 0) {
    s.pushToast('info', '되돌릴 항목이 없습니다.')
    return
  }

  // 복원 목표 이름 집합(대소문자 무시)·현재 이름 집합. 둘이 겹치면 순환 → 2단계 필요.
  const targetNames = new Set(entry.items.map((it) => it.oldName.toLowerCase()))
  const currentNames = new Set(entry.items.map((it) => baseName(it.newPath).toLowerCase()))
  let cyclic = false
  for (const n of targetNames) {
    if (currentNames.has(n)) {
      cyclic = true
      break
    }
  }

  let done = 0
  let skipped = 0
  const tempSuffix = `.agtundo-${Date.now()}`

  if (cyclic) {
    // 1단계: 전부 임시명으로. 2단계: 임시명 → oldName.
    const staged: { tempPath: string; oldName: string; parent: string }[] = []
    for (const it of entry.items) {
      const parent = parentOf(it.newPath)
      if (parent === null || !(await pathExists(it.newPath))) {
        skipped++
        continue
      }
      const tempName = `${baseName(it.newPath)}${tempSuffix}`
      const r1 = await fsApi.rename({ path: it.newPath, newName: tempName })
      if (!r1.ok) {
        skipped++
        continue
      }
      staged.push({ tempPath: r1.value.path, oldName: it.oldName, parent })
    }
    for (const st of staged) {
      // oldName 자리에 비대상 동명이 새로 있으면 중단(건너뜀·덮어쓰기 금지).
      const finalPath = joinPath(st.parent, st.oldName)
      if (finalPath.toLowerCase() !== st.tempPath.toLowerCase() && (await pathExists(finalPath))) {
        skipped++
        continue
      }
      const r2 = await fsApi.rename({ path: st.tempPath, newName: st.oldName })
      if (r2.ok) done++
      else skipped++
    }
  } else {
    for (const it of entry.items) {
      const parent = parentOf(it.newPath)
      if (parent === null || !(await pathExists(it.newPath))) {
        skipped++
        continue
      }
      const oldPath = joinPath(parent, it.oldName)
      if (await pathExists(oldPath)) {
        // 원래 이름 자리에 동명 항목 → 덮어쓰지 않고 건너뜀.
        skipped++
        continue
      }
      const res = await fsApi.rename({ path: it.newPath, newName: it.oldName })
      if (res.ok) done++
      else skipped++
    }
  }

  refreshDirs([entry.dir])
  if (done > 0 && skipped === 0) {
    s.pushToast('info', `일괄 이름변경을 되돌렸습니다(${done}건).`)
  } else if (done > 0 && skipped > 0) {
    s.pushToast('info', `일부만 되돌렸습니다 — 복원 ${done}건, 건너뜀 ${skipped}건(충돌/부재).`)
  } else {
    s.pushToast('error', '되돌리지 못했습니다 — 대상이 없거나 같은 이름이 이미 있습니다.')
  }
}

/** rename 역연산: newPath 를 oldName 으로 되돌린다. oldName 자리에 동명 존재 시 중단. */
async function undoRename(entry: Extract<UndoEntry, { kind: 'rename' }>): Promise<void> {
  const s = store.getState()
  const parent = parentOf(entry.newPath)
  if (parent === null) {
    s.pushToast('error', '되돌릴 수 없습니다 — 대상 위치를 확인할 수 없습니다.')
    return
  }
  // 변경 후 항목이 사라졌으면 중단.
  if (!(await pathExists(entry.newPath))) {
    s.pushToast('error', '되돌릴 수 없습니다 — 대상 항목이 더 이상 없습니다.')
    return
  }
  // 원래 이름 자리에 다른 항목이 새로 생겼으면 덮어쓰지 않고 중단.
  const oldPath = joinPath(parent, entry.oldName)
  if (await pathExists(oldPath)) {
    s.pushToast('error', '되돌릴 수 없습니다 — 같은 이름의 항목이 이미 있습니다.')
    return
  }
  const res = await fsApi.rename({ path: entry.newPath, newName: entry.oldName })
  if (!res.ok) {
    s.pushToast('error', '이름변경을 되돌리지 못했습니다.')
    return
  }
  // 영향 받은 폴더 새로고침.
  refreshDirs([parent])
  s.pushToast('info', '이름변경을 되돌렸습니다.')
}

/** create 역연산: 생성물을 휴지통으로. 이미 사라졌으면 안내(중단). */
async function undoCreate(entry: Extract<UndoEntry, { kind: 'create' }>): Promise<void> {
  const s = store.getState()
  if (!(await pathExists(entry.path))) {
    s.pushToast('info', '되돌릴 항목이 더 이상 없습니다.')
    return
  }
  const parent = parentOf(entry.path)
  const id = await startOperation('trash', [entry.path], undefined, [parent ?? ''])
  if (id !== null) s.pushToast('info', '새 항목 생성을 되돌렸습니다.')
}

/** move 역연산: toDir 의 항목들을 fromDir 로 되돌린다. fromDir 동명 존재 시 중단. */
async function undoMove(entry: Extract<UndoEntry, { kind: 'move' }>): Promise<void> {
  const s = store.getState()
  // 현재 위치(toDir\basename)와 복귀 위치(fromDir\basename) 산출.
  const names = entry.sources.map((p) => baseName(p))
  const movedPaths = names.map((n) => joinPath(entry.toDir, n))
  // 이동된 항목이 모두 toDir 에 있어야 한다(없으면 위치가 또 바뀜 → 중단).
  for (const mp of movedPaths) {
    if (!(await pathExists(mp))) {
      s.pushToast('error', '되돌릴 수 없습니다 — 이동된 항목을 찾을 수 없습니다.')
      return
    }
  }
  // fromDir 에 동명 항목이 새로 생겼으면 덮어쓰지 않고 중단.
  for (const n of names) {
    if (await pathExists(joinPath(entry.fromDir, n))) {
      s.pushToast('error', '되돌릴 수 없습니다 — 원래 위치에 같은 이름의 항목이 있습니다.')
      return
    }
  }
  const id = await startOperation('move', movedPaths, entry.fromDir, [entry.fromDir, entry.toDir])
  if (id !== null) s.pushToast('info', '이동을 되돌립니다.')
}

/** copy 역연산: 생성된 사본들을 휴지통으로. 사본이 없으면 안내. */
async function undoCopy(entry: Extract<UndoEntry, { kind: 'copy' }>): Promise<void> {
  const s = store.getState()
  const existing: string[] = []
  for (const p of entry.createdPaths) {
    if (await pathExists(p)) existing.push(p)
  }
  if (existing.length === 0) {
    s.pushToast('info', '되돌릴 사본이 더 이상 없습니다.')
    return
  }
  const refreshTargets = new Set<string>()
  for (const p of existing) {
    const parent = parentOf(p)
    if (parent !== null) refreshTargets.add(parent)
  }
  const id = await startOperation('trash', existing, undefined, [...refreshTargets])
  if (id !== null) s.pushToast('info', '복사를 되돌립니다.')
}

/** trash 역연산: 휴지통에서 originalPath 로 항목을 매칭해 복원(trash:restore). */
async function undoTrash(entry: Extract<UndoEntry, { kind: 'trash' }>): Promise<void> {
  const s = store.getState()
  const list = await trashApi.list()
  if (!list.ok) {
    s.pushToast('error', '휴지통을 조회할 수 없어 되돌리지 못했습니다.')
    return
  }
  // originalPath 매칭(동명 다수면 deletedAt 최신 우선). 원위치 동명 충돌은 중단.
  const targets = new Set(entry.originalPaths.map((p) => p.toLowerCase()))
  const candidates = list.value
    .filter((i) => targets.has(i.originalPath.toLowerCase()))
    .sort((a, b) => b.deletedAt - a.deletedAt)
  // 원래경로별 최신 1건만 선택.
  const seen = new Set<string>()
  const picked = candidates.filter((i) => {
    const key = i.originalPath.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  if (picked.length === 0) {
    s.pushToast('info', '휴지통에서 항목을 찾지 못했습니다(이미 비워졌을 수 있습니다).')
    return
  }
  // 원위치에 동명 항목이 다시 생겼으면 중단(덮어쓰기 금지).
  for (const item of picked) {
    if (item.originalPath && (await pathExists(item.originalPath))) {
      s.pushToast('error', '되돌릴 수 없습니다 — 원래 위치에 같은 이름의 항목이 있습니다.')
      return
    }
  }
  const res = await trashApi.restore(picked.map((i) => i.id))
  if (!res.ok) {
    s.pushToast('error', '휴지통 복원에 실패했습니다.')
    return
  }
  const dirs = new Set<string>()
  for (const i of picked) {
    const parent = parentOf(i.originalPath)
    if (parent !== null) dirs.add(parent)
  }
  refreshDirs([...dirs])
  s.pushToast('info', '삭제를 되돌렸습니다(휴지통에서 복원).')
}

/** 지정 디렉토리를 보고 있는 패널들을 새로고침. */
function refreshDirs(dirs: readonly string[]): void {
  const s = store.getState()
  const set = new Set(dirs)
  for (const [id, panel] of Object.entries(s.panels)) {
    if (panel && set.has(panel.path)) s.refresh(id)
  }
}
