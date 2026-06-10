/**
 * newTab 유스케이스 (I6) — 새 탭 시작 위치 결정.
 *
 * 규칙(ref.md 아이디어): 기본 시작 위치(설정 startLocation)가 있으면 그곳에서 새 탭을 연다.
 * 없고 저장된 워크스페이스(프로젝트)가 있으면 **피커**를 띄워, 고른 **프로젝트를 불러온다**
 * (워크스페이스 전체 로드 — 현재 세션/탭·레이아웃 교체). "내 PC"를 고르면 빈 새 탭. 워크스페이스가
 * 없으면 바로 내 PC.
 *
 * app → infra/api(workspaceApi)·usecases(workspace)·store. UI(TabBar·NewTabPickerDialog)는 이 usecase 경유.
 */
import type { WorkspaceInfo } from '@shared/dto'
import { workspaceApi } from '@renderer/infra/api'
import { store } from '@renderer/app/stores/rootStore'
import { MY_PC_PATH } from '@renderer/domain/paths'
import { loadWorkspace } from './workspace'

/** 새 탭 요청(+버튼·Ctrl+T). startLocation 있으면 즉시, 없고 워크스페이스 있으면 피커, 둘 다 없으면 내 PC. */
export async function requestNewTab(): Promise<void> {
  const s = store.getState()
  if (s.startLocation) {
    s.newTab() // newTab 이 startLocation 을 사용(없을 때만 이 분기 밖).
    return
  }
  const res = await workspaceApi.list()
  if (res.ok && res.value.length > 0) {
    s.openNewTabPicker()
    return
  }
  s.newTab() // 워크스페이스도 없음 → 내 PC.
}

/** 피커에서 고른 프로젝트(워크스페이스)를 불러온다 — 현재 세션/탭을 교체(전체 로드). */
export async function loadProjectFromPicker(name: string): Promise<void> {
  store.getState().closeNewTabPicker()
  await loadWorkspace(name) // 실패 토스트·폴백은 loadWorkspace 가 처리.
}

/** 피커에서 "내 PC" 선택 — 빈 새 탭. */
export function newTabAtMyPc(): void {
  const s = store.getState()
  s.closeNewTabPicker()
  s.newTab(MY_PC_PATH)
}

/** 피커 표시용 워크스페이스 목록(없으면 빈 배열). */
export async function listWorkspacesForPicker(): Promise<WorkspaceInfo[]> {
  const res = await workspaceApi.list()
  return res.ok ? res.value : []
}
