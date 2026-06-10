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
 * app → infra/api·usecases·store. UI 는 이 usecase 경유로만 호출.
 */
import { fsApi, dialogApi } from '@renderer/infra/api'
import { store } from '@renderer/app/stores/rootStore'
import { baseName, joinPath, parentOf } from '@renderer/domain/paths'
import { startOperation } from './fileOps'
import { waitForOperation } from './opCompletion'

/** 자동링크 다이얼로그 열기(대상 폴더). */
export function openAutoLink(sourceDir: string): void {
  store.getState().openAutoLink(sourceDir)
}

/** 네이티브 폴더 선택(목표 디렉토리). 취소면 null. */
export async function pickAutoLinkTarget(defaultPath?: string): Promise<string | null> {
  const res = await dialogApi.pickDirectory(defaultPath)
  return res.ok ? res.value.path : null
}

/**
 * 자동링크 실행. source(원본 폴더)를 targetDir 로 복사 → 원본을 backupName 으로 rename →
 * 원본 자리에 정션 생성. 사전 검증(대상 동명·백업 동명 존재)·복사 실패/취소 시 중단(원본 보존).
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

  try {
    // 사전 검증 1: 목표에 동일 이름이 이미 있으면 중단(섞임 방지).
    const destCheck = await fsApi.validatePath({ path: linkTarget })
    if (destCheck.ok && destCheck.value.exists) {
      s.pushToast('error', `목표 위치에 이미 "${name}" 이(가) 있습니다.`)
      return
    }
    // 사전 검증 2: 백업 이름이 원본 부모에 이미 있으면 중단.
    if (parent) {
      const backupCheck = await fsApi.validatePath({ path: joinPath(parent, backupName) })
      if (backupCheck.ok && backupCheck.value.exists) {
        s.pushToast('error', `백업 이름 "${backupName}" 이(가) 이미 존재합니다.`)
        return
      }
    }

    // 사전 검증 3(진행가능 여부 우선 판단): 실제 작업(복사) 전에 **원본 rename 을 시도→원복**
    // 해 본다. 원본이 사용 중·권한 없음·백업명 충돌이면 여기서 중단해 불필요한 복사를 막는다
    // (긴 복사 후 rename 실패로 헛수고하는 것을 방지). fs:rename 재사용(왕복).
    const probe = await fsApi.rename({ path: source, newName: backupName })
    if (!probe.ok) {
      s.pushToast('error', `자동링크 불가 — 원본 이름 변경 실패: ${probe.error.message} (복사하지 않음)`)
      return
    }
    // 원래 이름으로 즉시 원복. 실패(드묾)하면 원본이 백업명으로 남으므로 정직하게 안내.
    const restore = await fsApi.rename({ path: probe.value.path, newName: name })
    if (!restore.ok) {
      s.pushToast('error', `이름 복구 실패 — 원본이 "${backupName}" 로 남았습니다. 수동 확인이 필요합니다.`)
      return
    }

    s.pushToast('info', `자동링크: "${name}" 복사 시작…`)
    // ① 복사(진행률/취소는 작업패널). undoMeta 없음(자동링크 복사분은 undo 미제공).
    const opId = await startOperation('copy', [source], targetDir, [targetDir, parent ?? ''])
    if (!opId) return // 시작 실패 — startOperation 이 토스트.

    const summary = await waitForOperation(opId)
    if (summary.canceled) {
      s.pushToast('error', '자동링크 취소됨 — 원본은 그대로입니다.')
      return
    }
    if (summary.failedItems > 0) {
      s.pushToast('error', '복사 실패로 자동링크를 중단했습니다 — 원본은 그대로입니다.')
      return
    }

    // 복사 완료 → 마무리 진입을 명확히 알린다(단계 가시화).
    s.pushToast('info', `복사 완료 — "${name}" 원본 백업 후 링크 생성 중…`)

    // ② 마무리: 원본 rename + 원본자리 정션(권한 불필요·실패 시 롤백).
    const res = await fsApi.linkFinalize({ sourceDir: source, backupName, linkTarget })
    if (!res.ok) {
      s.pushToast('error', `자동링크 마무리 실패: ${res.error.message} (원본 보존)`)
      return
    }
    s.pushToast('info', `자동링크 완료: "${name}" → ${linkTarget} · 원본 백업 "${backupName}"`)

    // 원본 부모를 보던 패널들 새로고침(정션·백업 반영).
    if (parent) {
      const st = store.getState()
      for (const [pid, p] of Object.entries(st.panels)) {
        if (p && p.path === parent) st.refresh(pid)
      }
    }
  } catch (e) {
    // invoke 거부(예: 메인 핸들러 미등록 — dev 에서 메인 미재시작) 등 예외를 표면화한다
    // (과거엔 void 호출로 조용히 묻혀 "복사만 되고 멈춤"으로 보였다).
    s.pushToast('error', `자동링크 오류: ${e instanceof Error ? e.message : String(e)}`)
  }
}
