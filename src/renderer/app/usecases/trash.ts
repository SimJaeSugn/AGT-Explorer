/**
 * trash 유스케이스 (K장 K2) — 휴지통 목록 로드·선택 복원·전체 비우기.
 *
 * dashboard.ts 동형. app → infra/api(trashApi) 직접 호출(.eslintrc 허용).
 * 실패는 슬라이스 오류 필드/토스트로 안내(비차단). 복원 후 영향 받은 폴더를
 * 보고 있는 패널이 있으면 새로고침한다.
 */
import { trashApi } from '@renderer/infra/api'
import { store } from '@renderer/app/stores/rootStore'
import { parentOf } from '@renderer/domain/paths'

/** trash:list → 목록 반영. 실패 시 _trashError. */
export async function loadTrash(): Promise<void> {
  const s = store.getState()
  s._trashLoading()
  const res = await trashApi.list()
  if (res.ok) {
    store.getState()._setTrashItems(res.value)
  } else {
    store.getState()._trashError(res.error.message ?? '휴지통 목록을 불러오지 못했습니다.')
  }
}

/** 경로가 속한 부모 폴더를 보고 있는 패널들을 새로고침(복원/비우기 후 반영). */
function refreshAffectedPanels(originalPaths: readonly string[]): void {
  const s = store.getState()
  const parents = new Set<string>()
  for (const p of originalPaths) {
    const parent = parentOf(p)
    if (parent !== null) parents.add(parent)
  }
  for (const [id, panel] of Object.entries(s.panels)) {
    if (panel && parents.has(panel.path)) s.refresh(id)
  }
}

/** 선택 항목 복원(trash:restore) → 결과 토스트 + 목록 재조회 + 영향 패널 refresh. */
export async function restoreSelected(): Promise<void> {
  const s = store.getState()
  const ids = [...s.trashSelected]
  if (ids.length === 0) {
    s.pushToast('info', '복원할 항목을 선택하세요.')
    return
  }
  // 복원 후 새로고침 대상 산출용 원래경로(복원 전 목록 기준).
  const affected = s.trashItems.filter((i) => s.trashSelected.has(i.id)).map((i) => i.originalPath)
  const res = await trashApi.restore(ids)
  if (!res.ok) {
    store.getState()._trashError(res.error.message ?? '복원에 실패했습니다.')
    store.getState().pushToast('error', `복원 실패: ${res.error.message ?? ''}`.trim())
    return
  }
  store.getState().pushToast('info', `${ids.length}개 항목을 복원했습니다.`)
  refreshAffectedPanels(affected)
  await loadTrash()
}

/**
 * 전체 비우기(확인 모달 통과 후 호출) → trash:empty(true) → 토스트 + 목록 재조회.
 * 확인 UX(되돌릴 수 없음 안내·항목수/용량)는 TrashDialog 의 ConfirmDialog 재사용이 담당하고,
 * 이 함수는 실제 비우기만 수행한다(confirmed=true 는 trashApi 래퍼가 고정 주입).
 */
export async function emptyTrash(): Promise<void> {
  const res = await trashApi.empty(true)
  const s = store.getState()
  if (!res.ok) {
    s._trashError(res.error.message ?? '휴지통 비우기에 실패했습니다.')
    s.pushToast('error', `휴지통 비우기 실패: ${res.error.message ?? ''}`.trim())
    return
  }
  s.pushToast('info', '휴지통을 비웠습니다.')
  await loadTrash()
}
