/**
 * 폴더 비교 유스케이스 (app/usecases/compare) — 비교 시작·해시/재귀·미러 미리보기·실행 (§P1).
 *
 * **M6: 단일 깊이 메타 비교**(이름·크기·수정일·렌더러 순수·채널 0).
 * **M7 §P1 확장**: 해시(내용)·재귀 옵션 on 이면 백엔드 `hash:compare:*`(compareEngine·
 * 진행률·취소)로 계산하고, off 면 M6 메타 경로 그대로(동치·채널 0). 미러(파괴적)는
 * 기존 `op:*`(복사/휴지통) 재사용 → 휴지통 경유·K1 undo 자동 적재.
 *
 * 경계: app → store(액션)·domain/rules(compare)·infra/api(hashApi·구독)·usecases(fileOps).
 * UI 는 이 usecase 경유로만 호출(ui→infra 직접 import 금지).
 */
import { hashApi, subscribeHashCompareStream } from '@renderer/infra/api'
import { store } from '@renderer/app/stores/rootStore'
import { isMyPc } from '@renderer/domain/paths'
import { isRemotePath } from '@renderer/domain/rules/remoteLocation'
import { planMirror, type MirrorDirection, type MirrorPlan } from '@renderer/domain/rules/compare'
import { startOperation } from './fileOps'

/** 해시/재귀 옵션이 하나라도 켜져 있는지(백엔드 잡 사용 여부 판정). */
function hashModeEnabled(): boolean {
  const o = store.getState().compareOptions
  return o.useHash === true || o.recursive === true
}

/**
 * 활성 탭의 좌/우 2분할 패널 id·경로를 산출(좌=panelIds[0], 우=panelIds[1]).
 * 2분할(split-2-h/v)이 아니거나 패널이 2개 미만이면 null.
 */
export interface ComparePanels {
  readonly leftId: string
  readonly rightId: string
  readonly leftPath: string
  readonly rightPath: string
}

export function comparePanelsOf(): ComparePanels | null {
  const s = store.getState()
  const tab = s.activeTab()
  if (!tab) return null
  if (tab.layout !== 'split-2-h' && tab.layout !== 'split-2-v') return null
  if (tab.panelIds.length < 2) return null
  const leftId = tab.panelIds[0] as string
  const rightId = tab.panelIds[1] as string
  const left = s.panels[leftId]
  const right = s.panels[rightId]
  if (!left || !right) return null
  return { leftId, rightId, leftPath: left.path, rightPath: right.path }
}

/**
 * 비교 시작 — 좌/우 패널 entries 로 즉시 분류(메타·채널 0). 2분할 아니면 안내.
 * 토글: 이미 비교 중이면 종료. 해시/재귀 옵션이 켜져 있으면 시작 직후 백엔드 잡도 트리거.
 */
export function startCompare(): void {
  const s = store.getState()
  if (s.compareActive) {
    s.clearCompare()
    return
  }
  const panels = comparePanelsOf()
  if (!panels) {
    s.pushToast('info', '폴더 비교는 좌우 2분할 상태에서만 사용할 수 있습니다.')
    return
  }
  const left = s.panels[panels.leftId]
  const right = s.panels[panels.rightId]
  if (!left || !right) return
  // 먼저 메타 결과로 즉시 표시(빠른 피드백·해시 잡 진행 중에도 골격 노출).
  s.runCompare(panels.leftId, panels.rightId, left.directory.entries, right.directory.entries)
  // 해시/재귀 옵션이 켜져 있으면 백엔드 hash:compare 잡으로 정밀 비교(채널 사용).
  if (hashModeEnabled()) void runHashCompare()
}

/** 비교 종료(진행 중 해시 잡 있으면 취소). */
export function stopCompare(): void {
  const s = store.getState()
  if (s.compareJobId && s.compareHashStatus === 'running') {
    void hashApi.cancel(s.compareJobId)
  }
  s.clearCompare()
}

/**
 * §P1 해시/재귀 비교 잡 시작 — 좌/우 패널 폴더로 hash:compare:start(useHash/recursive 옵션).
 * 로컬 폴더 한정("내 PC"·원격 거부·ADR-005). 진행 중 잡이 있으면 선취소(중복 방지).
 * 백엔드 done 은 compareBridge 가 _compareHashDone 으로 미러한다.
 */
export async function runHashCompare(): Promise<void> {
  const s = store.getState()
  if (!s.compareActive) return
  const lid = s.compareLeftPanelId
  const rid = s.compareRightPanelId
  if (!lid || !rid) return
  const leftDir = s.panels[lid]?.path
  const rightDir = s.panels[rid]?.path
  if (leftDir === undefined || rightDir === undefined) return
  if (
    isMyPc(leftDir) ||
    isMyPc(rightDir) ||
    isRemotePath(leftDir) ||
    isRemotePath(rightDir)
  ) {
    s.pushToast('info', '내용/재귀 비교는 로컬 폴더에서만 사용할 수 있습니다.')
    return
  }
  // 진행 중 잡 선취소.
  if (s.compareJobId && s.compareHashStatus === 'running') {
    await hashApi.cancel(s.compareJobId)
  }
  const opts = s.compareOptions
  const res = await hashApi.compareStart({
    leftDir,
    rightDir,
    useHash: opts.useHash === true,
    recursive: opts.recursive === true
  })
  if (!res.ok) {
    store.getState()._compareHashError(res.error.message ?? '비교를 시작하지 못했습니다.')
    return
  }
  store.getState().beginCompareHash(res.value.jobId)
}

/** 진행 중 해시/재귀 비교 협조취소(메타 결과는 유지). */
export async function cancelHashCompare(): Promise<void> {
  const s = store.getState()
  if (!s.compareJobId || s.compareHashStatus !== 'running') return
  const jobId = s.compareJobId
  s.markCompareHashCanceling()
  await hashApi.cancel(jobId)
}

/**
 * "내용 비교(해시)" 토글. 변경 후 비교 중이면 재실행:
 *  - 켜짐(또는 재귀 켜짐 유지) → 백엔드 hash:compare 잡 재시작.
 *  - 둘 다 꺼짐 → M6 메타 경로로 즉시 재계산(채널 0·동치).
 */
export function toggleCompareUseHash(): void {
  const s = store.getState()
  s.setCompareOptions({ useHash: !(s.compareOptions.useHash === true) })
  applyCompareOptionsChange()
}

/** "하위 폴더 포함(재귀)" 토글. useHash 동형 재실행. */
export function toggleCompareRecursive(): void {
  const s = store.getState()
  s.setCompareOptions({ recursive: !(s.compareOptions.recursive === true) })
  applyCompareOptionsChange()
}

/**
 * 옵션 변경 후 재실행 분기(비교 중일 때만). 해시/재귀가 하나라도 켜지면 백엔드 잡,
 * 둘 다 꺼지면 M6 메타 경로로 즉시 복귀(채널 0). 진행 중 잡은 선취소.
 */
function applyCompareOptionsChange(): void {
  const s = store.getState()
  if (!s.compareActive) return
  if (hashModeEnabled()) {
    void runHashCompare()
    return
  }
  // 둘 다 off → 진행 중 잡 취소 + 메타 경로 복귀(동치).
  if (s.compareJobId && s.compareHashStatus === 'running') {
    void hashApi.cancel(s.compareJobId)
  }
  const lid = s.compareLeftPanelId
  const rid = s.compareRightPanelId
  if (!lid || !rid) return
  const left = s.panels[lid]
  const right = s.panels[rid]
  if (!left || !right) return
  // 상태를 idle 로 되돌리고 메타 결과로 재계산.
  s.markCompareHashCanceling()
  store.getState().recomputeCompare(left.directory.entries, right.directory.entries)
}

/**
 * 양 패널 entries 가 바뀌면(새로고침·워처·이동) 비교 결과를 재계산한다.
 * compareActive 가 아니면 무동작. 비교 패널이 사라졌으면 종료.
 */
export function refreshCompareIfActive(): void {
  const s = store.getState()
  if (!s.compareActive) return
  const lid = s.compareLeftPanelId
  const rid = s.compareRightPanelId
  if (!lid || !rid) return
  const left = s.panels[lid]
  const right = s.panels[rid]
  if (!left || !right) {
    s.clearCompare()
    return
  }
  // 해시/재귀 모드면 entries 변경 시 백엔드 잡을 재실행한다(메타 경로로 덮어쓰지 않음 —
  // 해시 결과 보존). off 면 M6 메타 경로 재계산(채널 0·동치).
  if (hashModeEnabled()) {
    void runHashCompare()
    return
  }
  s.recomputeCompare(left.directory.entries, right.directory.entries)
}

/**
 * 미러 미리보기 — 방향에 따라 복사/삭제 계획을 순수 산출(파괴 전 확인용).
 * @param direction 'l2r'=좌→우, 'r2l'=우→좌
 * @param includeDeletes 삭제 동기화 포함(기본 false = 안전한 복사 미러)
 */
export function previewMirror(direction: MirrorDirection, includeDeletes = false): MirrorPlan | null {
  const s = store.getState()
  if (!s.compareActive) return null
  const lid = s.compareLeftPanelId
  const rid = s.compareRightPanelId
  if (!lid || !rid) return null
  const destId = direction === 'l2r' ? rid : lid
  const destPath = s.panels[destId]?.path
  if (destPath === undefined) return null
  return planMirror(s.comparePairs, direction, destPath, includeDeletes)
}

/**
 * 미러 요청 — 미리보기 산출 후 **확인 모달**을 띄운다(파괴적이므로 즉시 실행 금지).
 * 원격/내 PC 대상은 1차 제외(채널 0·로컬 op 한정·정직 한계).
 */
export function requestMirror(direction: MirrorDirection, includeDeletes = false): void {
  const s = store.getState()
  const plan = previewMirror(direction, includeDeletes)
  if (!plan) {
    s.pushToast('info', '비교 모드에서만 미러를 실행할 수 있습니다.')
    return
  }
  if (isMyPc(plan.destDir) || isRemotePath(plan.destDir)) {
    s.pushToast('info', '이 위치로는 미러할 수 없습니다(로컬 폴더만 지원).')
    return
  }
  if (plan.copyPaths.length === 0 && plan.deletePaths.length === 0) {
    s.pushToast('info', '동기화할 차이가 없습니다.')
    return
  }
  s.openCompareMirrorConfirm({
    direction,
    copyCount: plan.copyPaths.length,
    overwriteCount: plan.overwriteCount,
    deleteCount: plan.deletePaths.length,
    includeDeletes
  })
}

/**
 * 미러 확정(확인 모달 "실행") — 기존 op:* 로 복사 + (선택)휴지통 삭제 수행.
 * 복사는 copy op(충돌은 D4 ConflictDialog 로 질의·K1 undo 자동), 삭제는 trash op
 * (휴지통 경유·K1 undo 자동). 신규 채널 0. 실행 후 양 패널 새로고침은 op:done 브리지가 처리.
 */
export async function applyMirrorConfirmed(): Promise<void> {
  const s = store.getState()
  const confirm = s.compareMirrorConfirm
  s.closeCompareMirrorConfirm()
  if (!confirm) return
  const plan = previewMirror(confirm.direction, confirm.includeDeletes)
  if (!plan) return

  const lid = s.compareLeftPanelId
  const rid = s.compareRightPanelId
  const sourceDir = confirm.direction === 'l2r' ? s.panels[lid ?? '']?.path : s.panels[rid ?? '']?.path

  // 복사 미러: 없는 것 + 다른 것을 dest 로 copy(충돌 시 D4 질의·K1 undo 자동 적재).
  if (plan.copyPaths.length > 0) {
    await startOperation('copy', plan.copyPaths, plan.destDir, [plan.destDir, sourceDir ?? ''], {
      kind: 'copy',
      sources: [...plan.copyPaths],
      destDir: plan.destDir
    })
  }
  // 삭제 동기화(명시 선택 시): 기준에 없는 dest 항목 → 휴지통(K1 undo 자동 적재).
  if (plan.deletePaths.length > 0) {
    await startOperation('trash', plan.deletePaths, undefined, [plan.destDir], {
      kind: 'trash',
      originalPaths: [...plan.deletePaths]
    })
  }
}

// ── §P1 해시/재귀 비교 브리지(hash:compare:* 푸시 → compareSlice 미러) ──────
let compareDisposer: (() => void) | null = null

/**
 * hash:compare:* 전역 구독 시작(중복 호출 무시). 현재 활성 잡(compareJobId)과 일치하는
 * 이벤트만 슬라이스에 반영(상관 필터 — 취소·교체된 잡의 잔여 이벤트 격리·dedupBridge 동형).
 */
export function initCompareBridge(): void {
  if (compareDisposer) return
  compareDisposer = subscribeHashCompareStream({
    onProgress: (evt) => {
      const s = store.getState()
      if (evt.jobId !== s.compareJobId) return
      s._compareHashProgress(evt.scannedItems, evt.scannedBytes, evt.currentPath)
    },
    onDone: (evt) => {
      const s = store.getState()
      if (evt.jobId !== s.compareJobId) return
      s._compareHashDone(evt.result.pairs, evt.result.truncated)
    },
    onError: (evt) => {
      const s = store.getState()
      if (evt.jobId !== s.compareJobId) return
      s._compareHashError(evt.error.message ?? '비교 중 오류가 발생했습니다.')
    }
  })
}

/** 구독 해제(테스트·HMR). */
export function disposeCompareBridge(): void {
  if (compareDisposer) {
    compareDisposer()
    compareDisposer = null
  }
}
