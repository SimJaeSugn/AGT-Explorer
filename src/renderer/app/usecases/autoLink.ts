/**
 * autoLink 유스케이스 (V10) — "자동링크": 폴더를 다른 위치로 복사하고, 원본을 백업명으로
 * 바꾼 뒤 원본 자리에 **정션(junction)** 을 걸어 원래 경로를 유지한다.
 *
 * 흐름: ① 원본 → 목표디렉토리 복사(op:* · 진행률/취소는 작업패널) → ② 복사 성공 시
 * fs:link-finalize 로 원본 rename + 원본자리 정션 생성(권한 불필요·실패 시 롤백).
 * 원본은 백업으로 보존되므로(삭제 안 함) 데이터 손실 위험이 없다 — 사용자가 확인 후 수동 정리.
 *
 * 권한: 정션은 관리자 권한이 필요 없다(심볼릭 링크와 달리). 단 원본이 사용 중이거나 보호된
 * 위치면 복사/rename 단계에서 실패할 수 있고, 그 경우 토스트로 안내하며 원본은 보존된다.
 *
 * V(일괄): 복수의 선택된 디렉토리를 한 번에 처리하되 **잠겨있거나 권한이 없는 폴더는
 * 자동으로 제외(스킵)** 한다. 잠김/권한 판정의 권위 있는 기준은 **rename 왕복 프로브**
 * (원본을 백업명으로 바꿔보고 즉시 원복) — 실패하면 사용 중/보호됨으로 보고 스킵한다.
 * 코어 1폴더 처리를 linkOneFolder 로 추출하고(토스트 없음·구조화 결과 반환),
 * 단일(runAutoLink)·일괄(runAutoLinkBatch)이 이를 공유한다.
 *
 * app → infra/api·usecases·store. UI 는 이 usecase 경유로만 호출.
 */
import { fsApi, dialogApi } from '@renderer/infra/api'
import { store } from '@renderer/app/stores/rootStore'
import { baseName, joinPath, parentOf } from '@renderer/domain/paths'
import { startOperation } from './fileOps'
import { waitForOperation } from './opCompletion'

/** 기본 백업 접미사(원본 → "<이름>.원본" 으로 보존). 일괄 다이얼로그 기본값. */
export const DEFAULT_BACKUP_SUFFIX = '.원본'

/** 한 폴더 자동링크의 결과 분류(토스트 없이 구조화 반환). */
export type LinkStatus = 'ok' | 'skipped' | 'failed' | 'canceled'

/** 스킵 사유: 'locked'=사용 중/권한 없음/잠김, 'conflict'=목표 동명·백업명 충돌. */
export type LinkSkipReason = 'locked' | 'conflict'

/** linkOneFolder 결과(상태 + 사유/메시지). */
export interface LinkOneResult {
  readonly status: LinkStatus
  /** skipped 일 때 사유 분류. */
  readonly reason?: LinkSkipReason
  /** 사람이 읽을 보조 메시지(실패/스킵 상세 — 요약·토스트용). */
  readonly message?: string
}

/** 백업 이름 합성: baseName(source) + suffix. 순수 함수(검증 격리용). */
export function composeBackupName(source: string, suffix: string): string {
  return `${baseName(source)}${suffix}`
}

/** 자동링크 다이얼로그 열기(대상 폴더). */
export function openAutoLink(sourceDir: string): void {
  store.getState().openAutoLink(sourceDir)
}

/** 자동링크 일괄 다이얼로그 열기(대상 폴더들). */
export function openAutoLinkBatch(dirs: string[]): void {
  store.getState().openAutoLinkBatch(dirs)
}

/** 네이티브 폴더 선택(목표 디렉토리). 취소면 null. */
export async function pickAutoLinkTarget(defaultPath?: string): Promise<string | null> {
  const res = await dialogApi.pickDirectory(defaultPath)
  return res.ok ? res.value.path : null
}

/**
 * 코어: 한 폴더를 자동링크한다(토스트 없음·구조화 결과 반환). 단일·일괄이 공유한다.
 *
 * 분류:
 *  - rename 왕복 프로브 실패 → skipped/'locked'(사용 중·권한 없음·잠김).
 *  - 목표에 동명 존재 또는 백업명 존재 → skipped/'conflict'.
 *  - 복사 취소 → canceled. 복사 실패(failedItems>0)·linkFinalize 실패 → failed.
 *  - 전부 성공 → ok.
 *
 * 안전: 어떤 경로에서도 원본은 삭제하지 않는다(백업 보존). 스킵 폴더는 손대지 않는다.
 */
export async function linkOneFolder(
  source: string,
  targetDir: string,
  backupName: string
): Promise<LinkOneResult> {
  const name = baseName(source)
  const linkTarget = joinPath(targetDir, name)
  const parent = parentOf(source)

  try {
    // 사전 검증 1: 목표에 동일 이름이 이미 있으면 충돌로 스킵(섞임 방지).
    const destCheck = await fsApi.validatePath({ path: linkTarget })
    if (destCheck.ok && destCheck.value.exists) {
      return { status: 'skipped', reason: 'conflict', message: `목표에 이미 "${name}" 존재` }
    }
    // 사전 검증 2: 백업 이름이 원본 부모에 이미 있으면 충돌로 스킵.
    if (parent) {
      const backupCheck = await fsApi.validatePath({ path: joinPath(parent, backupName) })
      if (backupCheck.ok && backupCheck.value.exists) {
        return { status: 'skipped', reason: 'conflict', message: `백업명 "${backupName}" 충돌` }
      }
    }

    // 사전 검증 3(잠김/권한 권위 판정): 실제 복사 전에 **원본 rename 을 시도→원복** 해 본다.
    // 원본이 사용 중·권한 없음이면 여기서 실패 → 'locked' 로 스킵(불필요한 복사를 막는다).
    const probe = await fsApi.rename({ path: source, newName: backupName })
    if (!probe.ok) {
      return {
        status: 'skipped',
        reason: 'locked',
        message: `사용 중/권한 없음: ${probe.error.message}`
      }
    }
    // 원래 이름으로 즉시 원복. 실패(드묾)하면 원본이 백업명으로 남으므로 실패로 보고.
    const restore = await fsApi.rename({ path: probe.value.path, newName: name })
    if (!restore.ok) {
      return {
        status: 'failed',
        message: `이름 복구 실패 — 원본이 "${backupName}" 로 남음(수동 확인 필요)`
      }
    }

    // ① 복사(진행률/취소는 작업패널). undoMeta 없음(자동링크 복사분은 undo 미제공).
    const opId = await startOperation('copy', [source], targetDir, [targetDir, parent ?? ''])
    if (!opId) return { status: 'failed', message: '복사 시작 실패' }

    const summary = await waitForOperation(opId)
    if (summary.canceled) return { status: 'canceled', message: '복사 취소됨' }
    if (summary.failedItems > 0) return { status: 'failed', message: '복사 실패' }

    // ② 마무리: 원본 rename + 원본자리 정션(권한 불필요·실패 시 롤백).
    const res = await fsApi.linkFinalize({ sourceDir: source, backupName, linkTarget })
    if (!res.ok) return { status: 'failed', message: `링크 마무리 실패: ${res.error.message}` }

    return { status: 'ok' }
  } catch (e) {
    return { status: 'failed', message: e instanceof Error ? e.message : String(e) }
  }
}

/** 원본 부모를 보던 패널들 새로고침(정션·백업 반영). */
function refreshParentPanels(parents: ReadonlySet<string>): void {
  const st = store.getState()
  for (const [pid, p] of Object.entries(st.panels)) {
    if (p && parents.has(p.path)) st.refresh(pid)
  }
}

/**
 * 자동링크 실행(단일). source(원본 폴더)를 targetDir 로 복사 → 원본을 backupName 으로 rename →
 * 원본 자리에 정션 생성. 코어 linkOneFolder 위에 단계 토스트를 입혀 기존 동작을 유지한다.
 */
export async function runAutoLink(
  source: string,
  targetDir: string,
  backupName: string
): Promise<void> {
  const s = store.getState()
  const name = baseName(source)
  const linkTarget = joinPath(targetDir, name)
  const parent = parentOf(source)

  s.pushToast('info', `자동링크: "${name}" 복사 시작…`)
  const result = await linkOneFolder(source, targetDir, backupName)

  switch (result.status) {
    case 'ok':
      s.pushToast('info', `자동링크 완료: "${name}" → ${linkTarget} · 원본 백업 "${backupName}"`)
      if (parent) refreshParentPanels(new Set([parent]))
      return
    case 'canceled':
      s.pushToast('error', '자동링크 취소됨 — 원본은 그대로입니다.')
      return
    case 'skipped':
      if (result.reason === 'locked') {
        s.pushToast('error', `자동링크 불가 — 원본 사용 중/권한 없음 (복사하지 않음)`)
      } else {
        // conflict: 목표 동명·백업명 충돌.
        s.pushToast('error', result.message ?? '자동링크 불가 — 이름 충돌')
      }
      return
    case 'failed':
    default:
      s.pushToast('error', `자동링크 실패: ${result.message ?? '알 수 없는 오류'} (원본 보존)`)
      return
  }
}

/** 일괄 자동링크 누적 카운트(요약 표기용). */
export interface BatchTally {
  ok: number
  /** 잠김/권한 없음으로 제외. */
  locked: number
  /** 목표 동명·백업명 충돌로 제외. */
  conflict: number
  failed: number
  /** 사용자가 중간 취소해 처리하지 않은 폴더 수. */
  remaining: number
}

/** 빈 누적값. */
export function emptyTally(): BatchTally {
  return { ok: 0, locked: 0, conflict: 0, failed: 0, remaining: 0 }
}

/** 단일 결과를 누적값에 반영(순수 함수·검증 격리용). canceled 는 누적하지 않음(중단 신호). */
export function tallyResult(tally: BatchTally, status: LinkStatus, reason?: LinkSkipReason): void {
  if (status === 'ok') tally.ok++
  else if (status === 'failed') tally.failed++
  else if (status === 'skipped') {
    if (reason === 'locked') tally.locked++
    else tally.conflict++
  }
}

/** 누적값 → 사람이 읽을 요약 문구(순수 함수·검증 격리용). */
export function summarizeBatch(tally: BatchTally): string {
  const skipped = tally.locked + tally.conflict
  let msg = `일괄 자동링크 완료 — 성공 ${tally.ok} · 제외(잠김/권한) ${tally.locked} · 충돌 ${tally.conflict} · 실패 ${tally.failed}`
  if (tally.remaining > 0) {
    msg = `일괄 자동링크 중단 — 성공 ${tally.ok} · 제외(잠김/권한) ${tally.locked} · 충돌 ${tally.conflict} · 실패 ${tally.failed} · 미처리 ${tally.remaining}`
  }
  void skipped
  return msg
}

/**
 * 일괄 자동링크 실행. 선택된 여러 폴더를 **순차** 처리(작업 경합 회피)하며,
 * 잠겨있거나 권한이 없는 폴더는 자동 제외(스킵)하고 결과에 보고한다.
 *
 * - backupName = baseName(source) + backupSuffix(기본 '.원본').
 * - 사용자가 복사 중간 취소하면 그 시점에서 일괄을 중단하고 처리한 내역을 보고(나머지는 미처리).
 * - 끝에 영향받은 부모 패널들을 새로고침하고 요약 토스트를 띄운다.
 */
export async function runAutoLinkBatch(
  sources: string[],
  targetDir: string,
  backupSuffix: string
): Promise<void> {
  const s = store.getState()
  if (sources.length === 0) return

  s.pushToast('info', `일괄 자동링크 시작 — 대상 ${sources.length}개 폴더 (잠김/권한 없는 폴더는 자동 제외)`)

  const tally = emptyTally()
  const affectedParents = new Set<string>()
  // 스킵/실패한 폴더 이름 모음(요약 보조 — 토스트 2차).
  const excluded: string[] = []
  const failedNames: string[] = []
  let canceled = false

  for (let i = 0; i < sources.length; i++) {
    const source = sources[i]
    const name = baseName(source)
    const backupName = `${name}${backupSuffix}`
    const parent = parentOf(source)
    if (parent) affectedParents.add(parent)

    const result = await linkOneFolder(source, targetDir, backupName)
    if (result.status === 'canceled') {
      canceled = true
      // 이 폴더 포함 이후 미처리(현재 인덱스부터 끝까지).
      tally.remaining = sources.length - i
      break
    }
    tallyResult(tally, result.status, result.reason)
    if (result.status === 'skipped') excluded.push(`${name}(${result.reason === 'locked' ? '잠김/권한' : '충돌'})`)
    else if (result.status === 'failed') failedNames.push(name)
  }

  // 영향받은 부모 패널 새로고침(정션·백업 반영).
  refreshParentPanels(affectedParents)

  // 요약 토스트.
  const summaryMsg = summarizeBatch(tally)
  s.pushToast(tally.failed > 0 || canceled ? 'error' : 'info', summaryMsg)

  // 제외·실패 상세(있으면 2차 토스트로 이름 안내 — 사용자가 후속 처리 가능).
  if (excluded.length > 0) {
    s.pushToast('info', `제외된 폴더: ${excluded.join(', ')}`)
  }
  if (failedNames.length > 0) {
    s.pushToast('error', `실패한 폴더: ${failedNames.join(', ')}`)
  }
}
