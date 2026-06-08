/**
 * 외부 드래그 유스케이스 (app/usecases/externalDrag) — §M M1.
 *
 * 파일목록에서 OS/외부 앱으로 드래그 제스처가 시작되면 api.dnd.startDrag 로 위임한다.
 * **선택 항목이 모두 로컬일 때만** 호출하고(원격 항목 제외 — features §M1), 빈 선택은 무시.
 * 내부 패널 간 D&D(§A3)는 기존 경로(performDrop) 유지 — 본 함수는 외부 전용.
 *
 * 외부 드래그는 항상 "복사"(원본 보존, transferRoute.transferToExternal). icon 힌트는
 * 단일/다중/폴더로 backend 가 고스트 아이콘을 매핑한다.
 *
 * 경계: app → infra/api(dndApi) 직접 호출(.eslintrc 허용). 순수 판정은 domain 위임.
 */
import { dndApi } from '@renderer/infra/api'
import { store } from '@renderer/app/stores/rootStore'
import { locationKindOf } from '@renderer/domain/rules/remoteLocation'
import { isExternalDragAllowed } from '@renderer/domain/rules/transferRoute'
import type { DndStartDragReq } from '@shared/ipc/contracts'

/** 선택 경로 묶음 → 아이콘 힌트(단일 파일/폴더/다중). */
function iconHintFor(paths: readonly string[], anyFolder: boolean): DndStartDragReq['iconHint'] {
  if (paths.length > 1) return 'multi'
  return anyFolder ? 'folder' : 'single'
}

/**
 * 외부(앱 바깥) 드래그 시작. paths 는 드래그 소스(로컬 절대경로) 묶음.
 * 원격 항목이 하나라도 섞이면(또는 빈 선택) 호출하지 않는다(로컬 한정·main 도 2중 방어).
 *
 * @param paths      드래그 소스 경로(로컬 절대경로 기대).
 * @param anyFolder  소스에 폴더가 포함되는지(아이콘 힌트).
 * @returns startDrag 위임을 호출했으면 true.
 */
export async function startExternalDrag(paths: string[], anyFolder = false): Promise<boolean> {
  const s = store.getState()
  const kinds = paths.map((p) => locationKindOf(p))
  if (!isExternalDragAllowed(kinds)) {
    // 원격 항목 포함 또는 빈 선택 → 외부 드래그 불가(조용히 무시, 내부 D&D 는 별도 경로).
    return false
  }
  const hint = iconHintFor(paths, anyFolder)
  const res = await dndApi.startDrag(hint ? { paths, iconHint: hint } : { paths })
  if (!res.ok) {
    s.pushToast('error', `드래그를 시작할 수 없습니다: ${res.error.message}`)
    return false
  }
  return res.value.started
}
