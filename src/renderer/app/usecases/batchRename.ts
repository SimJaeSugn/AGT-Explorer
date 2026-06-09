/**
 * 고급 일괄 이름변경 유스케이스 (app/usecases/batchRename) — 진입·미리보기·실행 브리지.
 *
 * R1·US-17.1·§R·F22. 다중 선택(2+) 항목에 규칙을 적용해 다이얼로그에서 실시간 미리보기 →
 * 적용 시 기존 `fs:rename` 을 반복 호출하고(신규 채널 0·ADR-005), 성공분을 한 묶음으로
 * undoSlice 에 `kind:'batchRename'` push 한다(K1 Ctrl+Z 한 번에 되돌리기).
 *
 * 비원자성 정직 처리(계획서 §10.3): fs:rename N건은 비원자 → 부분 적용 가능. 진행/실패
 * 결과를 토스트로 정직 안내한다(은폐 금지). 순환 충돌(A→B, B→A)은 2단계 rename(임시명)으로
 * 회피하되 완전 롤백은 불가하다는 한계를 명시한다.
 *
 * 경계: app → store(액션)·domain(순수 규칙)·infra/api(fsApi). UI 는 이 usecase 경유로만 호출.
 */
import { fsApi } from '@renderer/infra/api'
import { store } from '@renderer/app/stores/rootStore'
import { baseName, isMyPc, parentOf } from '@renderer/domain/paths'
import {
  computeBatchRename,
  isApplicable,
  type BatchRenameResult,
  type BatchRenameRule,
  type RenamePreviewRow
} from '@renderer/domain/rules/batchRename'
import { panelPaths, selectedPaths } from './fileOps'
import { visibleEntries } from './selectors'

/** 다이얼로그가 다룰 대상 1건(원본 절대경로·이름·디렉토리 여부). */
export interface BatchRenameTarget {
  readonly path: string
  readonly name: string
  readonly isDir: boolean
}

/**
 * 활성 패널 2+ 선택 → 일괄 이름변경 다이얼로그 열기(uiSlice 플래그).
 * 0~1개 선택은 안내(단일은 F2 인라인 사용)·"내 PC" 는 불가.
 */
export function openBatchRename(): void {
  const { activePanelId, activePath } = panelPaths()
  const s = store.getState()
  if (!activePanelId || activePath === undefined || isMyPc(activePath)) {
    s.pushToast('info', '이 위치에서는 일괄 이름변경을 할 수 없습니다.')
    return
  }
  const sel = selectedPaths(activePanelId)
  if (sel.length < 2) {
    s.pushToast('info', '두 개 이상 선택한 뒤 일괄 이름변경을 사용하세요.')
    return
  }
  s.openBatchRename()
}

/**
 * 다이얼로그가 쓰는 현재 대상 목록(활성 패널 선택). 화면(정렬) 순서로 반환해
 * 연번이 사용자가 보는 순서대로 매겨지도록 한다. selectedPaths(집합)와 visibleEntries(순서)를
 * 교차해 순서 보존.
 */
export function getBatchRenameTargets(): { panelId: string; targets: BatchRenameTarget[] } | null {
  const { activePanelId } = panelPaths()
  if (!activePanelId) return null
  const selected = new Set(selectedPaths(activePanelId))
  if (selected.size === 0) return null
  const ordered = visibleEntries(activePanelId).filter((e) => selected.has(e.path))
  const targets: BatchRenameTarget[] = ordered.map((e) => ({ path: e.path, name: e.name, isDir: e.isDir }))
  return { panelId: activePanelId, targets }
}

/**
 * 미리보기 산출(순수 규칙 위임). 같은 폴더 내 **비대상** 기존 이름을 충돌검사 입력으로 모은다
 * (대상 자신은 제외 — 대상은 어차피 이름이 바뀌므로 기존 충돌로 보지 않음).
 */
export function previewBatchRename(panelId: string, rule: BatchRenameRule): BatchRenameResult {
  const targets = getBatchRenameTargets()?.targets ?? []
  const targetPaths = new Set(targets.map((t) => t.path.toLowerCase()))
  const all = store.getState().panels[panelId]?.directory.entries ?? []
  const existing = new Set<string>()
  for (const e of all) {
    if (!targetPaths.has(e.path.toLowerCase())) existing.add(e.name)
  }
  return computeBatchRename(targets, rule, existing)
}

/**
 * 적용: rows 를 fs:rename 반복 실행 + undo 한 묶음 push. 충돌 회피 2단계 rename.
 *
 * @returns 적용 시도 여부(true=실행함). 충돌/비적용이면 false(다이얼로그 유지).
 */
export async function applyBatchRename(panelId: string, result: BatchRenameResult): Promise<boolean> {
  const s = store.getState()
  if (!isApplicable(result)) {
    s.pushToast('error', '충돌·오류가 있어 적용할 수 없습니다. 규칙을 조정하세요.')
    return false
  }
  const rows = result.rows.filter((r) => r.changed && r.error === null)
  if (rows.length === 0) {
    s.pushToast('info', '변경되는 항목이 없습니다.')
    return false
  }

  const dir = store.getState().panels[panelId]?.path ?? ''

  // 순환 충돌 판정: 새 이름 집합과 (변경되는) 원래 이름 집합이 겹치면 2단계 필요.
  const newNames = new Set(rows.map((r) => r.newName.toLowerCase()))
  const oldNames = new Set(rows.map((r) => r.oldName.toLowerCase()))
  let cyclic = false
  for (const n of newNames) {
    if (oldNames.has(n)) {
      cyclic = true
      break
    }
  }

  const appliedItems: { newPath: string; oldName: string; newName: string }[] = []
  let done = 0
  let failed = 0

  if (cyclic) {
    // 1단계: 전부 임시명 → 2단계: 임시명 → 최종 이름(순환 회피·완전 롤백 불가 한계).
    const tempSuffix = `.agtbr-${Date.now()}`
    const staged: { tempPath: string; oldName: string; newName: string }[] = []
    for (const r of rows) {
      const tempName = `${baseName(r.path)}${tempSuffix}`
      const r1 = await fsApi.rename({ path: r.path, newName: tempName })
      if (!r1.ok) {
        failed++
        continue
      }
      staged.push({ tempPath: r1.value.path, oldName: r.oldName, newName: r.newName })
    }
    for (const st of staged) {
      const r2 = await fsApi.rename({ path: st.tempPath, newName: st.newName })
      if (r2.ok) {
        done++
        appliedItems.push({ newPath: r2.value.path, oldName: st.oldName, newName: r2.value.name })
      } else {
        failed++
      }
    }
  } else {
    for (const r of rows) {
      const res = await fsApi.rename({ path: r.path, newName: r.newName })
      if (res.ok) {
        done++
        appliedItems.push({ newPath: res.value.path, oldName: r.oldName, newName: res.value.name })
      } else {
        failed++
      }
    }
  }

  // 성공분만 한 묶음으로 undo push(K1·부분 적용 시 적용된 것만 역연산).
  if (appliedItems.length > 0) {
    s.pushUndo({ kind: 'batchRename', items: appliedItems, dir })
  }

  // 영향 폴더를 보고 있는 패널 새로고침.
  refreshPanelsShowingDir(dir)

  if (done > 0 && failed === 0) {
    s.pushToast('info', `${done}개 항목의 이름을 변경했습니다(Ctrl+Z 로 한 번에 되돌리기).`)
  } else if (done > 0 && failed > 0) {
    s.pushToast(
      'info',
      `일부만 적용했습니다 — 성공 ${done}건, 실패 ${failed}건(부분 적용·완전 롤백 불가).`
    )
  } else {
    s.pushToast('error', '이름변경에 실패했습니다.')
  }

  s.closeBatchRename()
  return true
}

/** 지정 디렉토리를 보고 있는 패널들 새로고침(워처 미연계 환경 대비 명시 갱신). */
function refreshPanelsShowingDir(dir: string): void {
  const s = store.getState()
  for (const [id, panel] of Object.entries(s.panels)) {
    if (panel && (panel.path === dir || parentOf(panel.path) === dir)) s.refresh(id)
  }
}

/** UI 가 미리보기 행 타입을 import 하기 위한 재노출. */
export type { RenamePreviewRow }
