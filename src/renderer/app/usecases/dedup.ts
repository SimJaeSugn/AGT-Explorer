/**
 * 중복 파일 찾기 유스케이스 (app/usecases/dedup) — 탐지 시작·구독·선택 정리 (§R2·US-17.2·F23).
 *
 * 백엔드 `hash:dup:*`(크기→해시 2단계 탐지)로 중복 그룹을 구하고, 사용자가 고른
 * "중복 중 보존 1개 외" 파일을 **휴지통**(기존 op:trash 재사용)으로 정리한다. 정리는
 * 파괴적이므로 확인 모달(ConfirmDialog)·휴지통 경유·K1 undo 자동(은폐 금지).
 *
 * 범위(roots): 활성 패널의 현재 폴더 1개(계획서 §4.1 — "현재 패널 폴더"). "내 PC"·
 * 원격 경로는 거부(로컬 폴더 한정·ADR-005). 진행률/취소는 hash:dup:progress / hash:cancel.
 *
 * 경계: app → infra/api(hashApi·subscribeHashDupStream) 직접 호출(.eslintrc 허용).
 * 도메인 순수 보조(원본 보존·전체삭제 경고)는 domain/rules/dupGroup 에 위임.
 */
import { hashApi, subscribeHashDupStream } from '@renderer/infra/api'
import { store } from '@renderer/app/stores/rootStore'
import { isMyPc } from '@renderer/domain/paths'
import { isRemotePath } from '@renderer/domain/rules/remoteLocation'
import { anyFullySelected, countSelected } from '@renderer/domain/rules/dupGroup'
import { startOperation } from './fileOps'

/** 활성 패널의 현재 폴더(탐지 범위). "내 PC"·원격이면 null. */
function activeScopeRoot(): string | null {
  const s = store.getState()
  const pid = s.activePanelId()
  if (!pid) return null
  const path = s.panels[pid]?.path
  if (path === undefined || path === '' || isMyPc(path) || isRemotePath(path)) return null
  return path
}

/**
 * 중복 찾기 시작 — 활성 패널 폴더를 범위로 hash:dup:start. 다이얼로그를 열고
 * jobId 를 보관(beginDedup)해 이후 progress/done 을 상관시킨다.
 * 진행 중 잡이 있으면 먼저 취소(중복 방지).
 */
export async function startDedup(): Promise<void> {
  const s = store.getState()
  const root = activeScopeRoot()
  if (!root) {
    s.pushToast('info', '중복 찾기는 로컬 폴더에서만 사용할 수 있습니다.')
    return
  }
  // 진행 중 잡 선취소.
  if (s.dedupJobId && s.dedupStatus === 'scanning') {
    await hashApi.cancel(s.dedupJobId)
  }
  s.openDedup()
  const res = await hashApi.dupStart({ roots: [root] })
  if (!res.ok) {
    store.getState()._dedupError(res.error.message ?? '중복 찾기를 시작하지 못했습니다.')
    return
  }
  store.getState().beginDedup(res.value.jobId, [root])
}

/** 같은 범위로 재탐지(다이얼로그 내 "다시 찾기"). roots 유지. */
export async function rescanDedup(): Promise<void> {
  const s = store.getState()
  const roots = s.dedupRoots.length > 0 ? s.dedupRoots : (() => {
    const r = activeScopeRoot()
    return r ? [r] : []
  })()
  if (roots.length === 0) {
    s.pushToast('info', '탐지할 폴더가 없습니다.')
    return
  }
  if (s.dedupJobId && s.dedupStatus === 'scanning') {
    await hashApi.cancel(s.dedupJobId)
  }
  const res = await hashApi.dupStart({ roots })
  if (!res.ok) {
    store.getState()._dedupError(res.error.message ?? '중복 찾기를 시작하지 못했습니다.')
    return
  }
  store.getState().beginDedup(res.value.jobId, roots)
}

/** 진행 중 탐지 협조취소. jobId 없으면 무시. */
export async function cancelDedup(): Promise<void> {
  const s = store.getState()
  if (!s.dedupJobId || s.dedupStatus !== 'scanning') return
  const jobId = s.dedupJobId
  s.markDedupCanceling()
  await hashApi.cancel(jobId)
}

/**
 * 정리 확정 — 선택된 중복 파일을 휴지통으로(op:trash 재사용·K1 undo 자동).
 * 삭제 후 그룹/선택에서 제거(removeDedupPaths). 빈 그룹은 자동 해소.
 */
export async function confirmCleanup(): Promise<void> {
  const s = store.getState()
  const paths = [...s.dedupSelected]
  if (paths.length === 0) return
  // 정리 대상이 속한 패널 폴더(새로고침 대상) — roots 첫 항목.
  const refreshDir = s.dedupRoots[0] ?? ''
  const id = await startOperation('trash', paths, undefined, [refreshDir], {
    kind: 'trash',
    originalPaths: [...paths]
  })
  if (id !== null) {
    // 낙관적 제거(실패 항목은 op:done 후에도 그룹이 남지 않을 수 있으나, 휴지통 정리는
    // 통상 성공 — 보수적으로는 op:done 에서 재검증 가능. 1차는 즉시 반영).
    store.getState().removeDedupPaths(paths)
  }
}

/** 정리 확인 모달에 보일 데이터 손실 경고 필요 여부(그룹 전부 선택 = 보존 0). */
export function cleanupHasDataLossRisk(): boolean {
  const s = store.getState()
  return anyFullySelected(s.dedupGroups, s.dedupSelected)
}

/** 현재 선택된 정리 대상 파일 수(확인 모달 표시용). */
export function selectedCleanupCount(): number {
  const s = store.getState()
  return countSelected(s.dedupGroups, s.dedupSelected)
}

let disposer: (() => void) | null = null

/**
 * hash:dup:* 전역 구독 시작(중복 호출 무시). jobId 가 현재 활성 잡과 일치하는
 * 이벤트만 슬라이스에 반영(상관 필터) — 취소·교체된 잡의 잔여 이벤트 격리(scanBridge 동형).
 */
export function initDedupBridge(): void {
  if (disposer) return
  disposer = subscribeHashDupStream({
    onProgress: (evt) => {
      const s = store.getState()
      if (evt.jobId !== s.dedupJobId) return
      s._dedupProgress(evt.scannedItems, evt.scannedBytes, evt.currentPath)
    },
    onDone: (evt) => {
      const s = store.getState()
      if (evt.jobId !== s.dedupJobId) return
      s._dedupDone(evt.groups, evt.truncated)
    },
    onError: (evt) => {
      const s = store.getState()
      if (evt.jobId !== s.dedupJobId) return
      s._dedupError(evt.error.message ?? '중복 찾기 중 오류가 발생했습니다.')
    }
  })
}

/** 구독 해제(테스트·HMR). */
export function disposeDedupBridge(): void {
  if (disposer) {
    disposer()
    disposer = null
  }
}
