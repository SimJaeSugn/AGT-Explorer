/**
 * navigate 유스케이스 — 주소창 입력 경로 검증 후 이동 (US-3.1).
 *
 * "내 PC"(빈 경로)는 검증 없이 이동. 실제 경로는 fs:validate-path 로
 * 존재·디렉토리 여부를 확인하고, 파일이면 그 파일을 열고, 없으면 인라인 오류.
 *
 * app → infra/api(fsApi.validatePath) 직접 호출(.eslintrc 허용).
 */
import { fsApi, shellApi } from '@renderer/infra/api'
import { isMyPc } from '@renderer/domain/paths'
import { isRemotePath, locationKindOf } from '@renderer/domain/rules/remoteLocation'
import { store } from '@renderer/app/stores/rootStore'

export interface NavOutcome {
  readonly ok: boolean
  readonly message: string
}

/**
 * 주소창에서 들어온 경로로 이동 시도.
 * - 폴더 → navigate
 * - 파일 → shell:open(실행)
 * - 없음 → 오류 메시지(인라인 표시용 반환)
 */
export async function validateAndNavigate(panelId: string, target: string): Promise<NavOutcome> {
  if (isMyPc(target)) {
    store.getState().navigate(panelId, '', true)
    return { ok: true, message: '' }
  }

  // 원격 URI(sftp://·ftp(s)://)는 로컬 fs:validate-path 대상이 아니다(원격 검증 채널
  // 없음). 그대로 navigate → load 가 remote:list 로 탐색하며, 잘못된 경로는 패널
  // 오류 상태로 표면화한다(인라인 검증 대신).
  if (isRemotePath(target)) {
    store.getState().navigate(panelId, target, true)
    return { ok: true, message: '' }
  }

  // 압축 URI(archive://zip!/inner)도 로컬 fs:validate-path 대상이 아니다(§Q1). 그대로
  // navigate → load 가 'archive' 분기로 archive:list(세션 없으면 archive:open 자기치유)로
  // 탐색하며, 손상/암호 zip 은 패널 오류 상태로 표면화한다.
  if (locationKindOf(target) === 'archive') {
    store.getState().navigate(panelId, target, true)
    return { ok: true, message: '' }
  }

  const res = await fsApi.validatePath({ path: target })
  if (!res.ok) {
    const code = res.error.code
    if (code === 'ESECURITY') return { ok: false, message: '차단된 경로입니다(상위 이탈/보호 경로).' }
    if (code === 'EACCES' || code === 'EPERM') return { ok: false, message: '접근 권한이 없습니다.' }
    return { ok: false, message: res.error.message || '경로를 확인할 수 없습니다.' }
  }

  const v = res.value
  if (!v.exists) {
    return { ok: false, message: '경로를 찾을 수 없습니다.' }
  }
  if (v.isDir) {
    store.getState().navigate(panelId, v.normalized, true)
    return { ok: true, message: '' }
  }
  // 파일: OS 연결 프로그램으로 실행.
  const open = await shellApi.open(v.normalized)
  if (!open.ok) {
    return { ok: false, message: '파일을 여는 데 실패했습니다.' }
  }
  return { ok: true, message: '' }
}
