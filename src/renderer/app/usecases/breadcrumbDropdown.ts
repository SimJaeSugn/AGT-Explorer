/**
 * 브레드크럼 드롭다운 유스케이스 (U2) — 세그먼트 자식 폴더 온디맨드 조회.
 *
 * ui(PanelToolbar/BreadcrumbDropdown)는 infra 를 직접 import 하지 않으므로
 * (.eslintrc: ui→infra 금지), 기존 fs:tree-children 채널을 재사용하는 얇은
 * 유스케이스로 위임한다. 신규 IPC 채널 없음 — 사이드바 트리 지연확장과 동일 호출.
 *
 * 원격 경로는 로컬 fs:tree-children 대상이 아니므로(원격 형제 조회 채널 없음)
 * 호출 측에서 ▾ 자체를 비표시한다(이 함수는 로컬 경로만 받는 전제).
 *
 * app → infra/api(fsApi.treeChildren) 직접 호출(.eslintrc 허용).
 */
import { fsApi } from '@renderer/infra/api'
import {
  shapeBreadcrumbSiblings,
  type BreadcrumbSibling
} from '@renderer/domain/rules/breadcrumbSiblings'

export interface SiblingsOutcome {
  readonly ok: boolean
  readonly items: BreadcrumbSibling[]
  /** 실패 시 인라인 표시용 메시지(성공이면 ''). */
  readonly message: string
}

/**
 * segmentPath 의 자식 폴더 목록(= 다음 세그먼트의 형제들)을 조회·형상화한다.
 * @param segmentPath 드롭다운을 연 브레드크럼 세그먼트의 경로(로컬).
 * @param currentChildPath 현재 경로에서 거쳐온 자식 경로(없으면 null) — current 표식용.
 */
export async function fetchBreadcrumbSiblings(
  segmentPath: string,
  currentChildPath: string | null
): Promise<SiblingsOutcome> {
  const res = await fsApi.treeChildren({ path: segmentPath })
  if (!res.ok) {
    const code = res.error.code
    if (code === 'EACCES' || code === 'EPERM') {
      return { ok: false, items: [], message: '접근 권한이 없습니다.' }
    }
    return { ok: false, items: [], message: '하위 폴더를 불러올 수 없습니다.' }
  }
  return { ok: true, items: shapeBreadcrumbSiblings(res.value, currentChildPath), message: '' }
}
