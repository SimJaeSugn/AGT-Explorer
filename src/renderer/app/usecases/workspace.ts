/**
 * workspace 유스케이스 (P6c, US-5.8) — 명시적 워크스페이스 저장/복원.
 *
 * - saveWorkspace(name): 현재 세션 스냅샷(buildSessionSnapshot 재사용)을 이름 붙여 저장.
 * - **선택 상태(자동 저장)**: 저장/불러오기 성공 시 해당 워크스페이스가 "현재 선택"
 *     (uiSlice.currentWorkspace)이 되고, 이후 세션 자동저장이 같은 스냅샷을 워크스페이스
 *     파일에도 기록한다(startSessionAutosave). 삭제/이름변경 시 선택을 추적 갱신한다.
 * - listWorkspaces(): 저장된 목록(name·savedAt).
 * - loadWorkspace(name): resetWorkspace()로 기존 탭/패널 전부 정리 후 applySnapshot()로
 *     복원 → restoreSession(부팅)과 **동일 경로**([중대-2], 중복 구현 금지).
 * - deleteWorkspace(name) / renameWorkspace(old,new): rename 채널이 없어 load+save+delete 조합.
 *
 * 영속/IO 실패는 토스트 안내(비차단). app → infra/api 직접 호출(.eslintrc 허용).
 */
import type { WorkspaceInfo } from '@shared/dto'
import { workspaceApi } from '@renderer/infra/api'
import { store } from '@renderer/app/stores/rootStore'
import {
  applySnapshot,
  buildSessionSnapshot,
  noteWorkspaceSaved,
  resetWorkspaceSaveStatus
} from './session'

/** 현재 상태를 이름 붙여 저장. @returns 성공 여부. */
export async function saveWorkspace(name: string): Promise<boolean> {
  const s = store.getState()
  const trimmed = name.trim()
  if (trimmed === '') {
    s.pushToast('info', '워크스페이스 이름을 입력하세요.')
    return false
  }
  const snapshot = buildSessionSnapshot()
  const res = await workspaceApi.save(trimmed, snapshot)
  if (!res.ok) {
    s.pushToast('error', `워크스페이스 저장에 실패했습니다: ${res.error.message}`)
    return false
  }
  // 저장한 워크스페이스를 "현재 선택"으로 — 이후 변경은 자동 저장된다(US-5.8 확장).
  store.getState().setCurrentWorkspace(trimmed)
  noteWorkspaceSaved(true) // StatusBar: 저장됨 + 시각
  s.pushToast('info', `"${trimmed}" 워크스페이스를 저장했습니다. 이후 변경은 자동 저장됩니다.`)
  return true
}

/** 워크스페이스 목록 조회(실패 시 빈 배열). */
export async function listWorkspaces(): Promise<WorkspaceInfo[]> {
  const res = await workspaceApi.list()
  if (!res.ok) {
    store.getState().pushToast('error', '워크스페이스 목록을 불러올 수 없습니다.')
    return []
  }
  return res.value
}

/**
 * 워크스페이스 로드 — 기존 탭/패널 전부 정리(resetWorkspace) 후 applySnapshot 으로
 * 복원(부팅 세션 복원과 동일 경로). @returns 성공 여부.
 */
export async function loadWorkspace(name: string): Promise<boolean> {
  const s = store.getState()
  const res = await workspaceApi.load(name)
  if (!res.ok) {
    s.pushToast('error', `워크스페이스를 불러올 수 없습니다: ${res.error.message}`)
    return false
  }
  // (1) 기존 탭/패널 정리 → (2) 공통 복원 경로.
  store.getState().resetWorkspace()
  const restored = applySnapshot(res.value)
  if (!restored) {
    // 빈/손상 스냅샷 폴백: 기본 "내 PC" 탭으로 복귀(크래시 프리).
    store.getState().initDefaultTab()
  }
  // 복원 성공 시 이 워크스페이스를 "현재 선택"으로 — 이후 변경은 자동 저장(US-5.8 확장).
  // 실패(손상 폴백) 시 선택 해제 — 기본 탭 상태가 워크스페이스 파일을 덮어쓰지 않게 한다.
  store.getState().setCurrentWorkspace(restored ? name : null)
  resetWorkspaceSaveStatus() // StatusBar: 파일과 동기화된 직후(저장 이력 없음)
  return restored
}

/** 워크스페이스 삭제. 현재 선택 중인 워크스페이스면 선택도 해제한다. @returns 성공 여부. */
export async function deleteWorkspace(name: string): Promise<boolean> {
  const res = await workspaceApi.delete(name)
  if (!res.ok) {
    store.getState().pushToast('error', `삭제에 실패했습니다: ${res.error.message}`)
    return false
  }
  // 선택 중이던 워크스페이스 삭제 → 선택 해제(자동 저장이 파일을 되살리는 것 방지).
  if (store.getState().currentWorkspace === name) store.getState().setCurrentWorkspace(null)
  return true
}

/**
 * 워크스페이스 이름변경 — rename 채널이 없어 load→save(new)→delete(old) 조합(UI 편의).
 * 현재 열린 탭을 건드리지 않도록 저장 파일만 옮긴다(load 한 스냅샷을 새 이름으로 재저장).
 * @returns 성공 여부.
 */
export async function renameWorkspace(oldName: string, newName: string): Promise<boolean> {
  const s = store.getState()
  const trimmed = newName.trim()
  if (trimmed === '' || trimmed === oldName) return false
  const loaded = await workspaceApi.load(oldName)
  if (!loaded.ok) {
    s.pushToast('error', '이름을 변경할 워크스페이스를 찾을 수 없습니다.')
    return false
  }
  const saved = await workspaceApi.save(trimmed, loaded.value)
  if (!saved.ok) {
    s.pushToast('error', `이름 변경에 실패했습니다: ${saved.error.message}`)
    return false
  }
  const removed = await workspaceApi.delete(oldName)
  // 선택 중이던 워크스페이스 이름변경 → 선택 이름 추적(자동 저장이 새 파일로 이어짐).
  if (store.getState().currentWorkspace === oldName) store.getState().setCurrentWorkspace(trimmed)
  if (!removed.ok) {
    // 새 이름 저장은 됐으나 원본 삭제 실패 → 중복 존재(비치명적) 안내.
    s.pushToast('error', '이전 이름 삭제에 실패해 두 개가 남았습니다.')
    return false
  }
  return true
}
