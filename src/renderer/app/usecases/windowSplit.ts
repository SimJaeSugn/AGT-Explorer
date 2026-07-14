/**
 * windowSplit 유스케이스 (U3 — 탭 분리(새 창), US-20.3 Could).
 *
 * "새 창으로 분리": 현재 창의 탭 1개를 직렬화(buildTabSnapshot)해 main 에 넘기면
 * main 이 새 BrowserWindow 를 만들어 그 탭으로 부팅한다(window:split-tab). 성공하면
 * 소스 창에서 해당 탭을 닫는다(기존 closeTab 경로 재사용 — 탭이 양쪽에 중복되지 않게).
 *
 * 잠긴 탭(locked)은 분리하지 않는다(closeTab 가드와 일관 — 명시적 잠금 해제 후).
 * 분리가 실패하면 소스 탭을 닫지 않는다(데이터 유실 방지). 분리 창은 세션 자동저장에
 * 참여하지 않으므로 재시작 시 복원되지 않는다(정직 한계 — windowManager 참조).
 *
 * app → infra/api 직접 호출(.eslintrc 허용).
 */
import { windowApi } from '@renderer/infra/api'
import { store } from '@renderer/app/stores/rootStore'
import { buildTabSnapshot } from '@renderer/app/usecases/session'

/**
 * 탭을 새 창으로 분리한다. 성공 시 소스 탭을 닫는다.
 * @param tabId 분리할 탭(미지정 시 활성 탭).
 */
export async function splitTabToNewWindow(tabId?: string): Promise<void> {
  const s = store.getState()
  const id = tabId ?? s.activeTabId
  const tab = s.tabs[id]
  if (!tab) return

  // 잠긴 탭은 분리 거부(closeTab 가드와 일관) — 먼저 잠금 해제.
  if (tab.locked) {
    s.pushToast('info', '잠긴 탭입니다. 먼저 잠금을 해제하세요.')
    return
  }

  const snapshot = buildTabSnapshot(id)
  if (!snapshot) return

  const res = await windowApi.splitTab(snapshot)
  if (!res.ok) {
    store.getState().pushToast('error', '새 창으로 분리하지 못했습니다.')
    return
  }
  // 분리 성공 → 소스 창에서 탭 닫기(마지막 탭이면 closeTab 이 기본 탭 유지).
  store.getState().closeTab(id)
}

/**
 * 탭을 "탐색기 전용" 경량 창(compact)으로 분리한다 — 탭을 창 밖으로 드롭했을 때.
 * 기존 splitTabToNewWindow(풀 셸)와 별개로, 툴바·좌우 패널·사이드바 없이 단일
 * 파일 목록만 가진 창을 띄운다(mode='compact'). 성공 시 소스 탭을 닫는다.
 *
 * 잠긴 탭은 분리하지 않는다(splitTabToNewWindow 와 동일 가드). 실패 시 소스 탭을
 * 닫지 않는다(데이터 유실 방지). 분리 창은 세션 자동저장에 참여하지 않는다.
 */
export async function detachTabToCompactWindow(tabId?: string): Promise<void> {
  const s = store.getState()
  const id = tabId ?? s.activeTabId
  const tab = s.tabs[id]
  if (!tab) return

  if (tab.locked) {
    s.pushToast('info', '잠긴 탭입니다. 먼저 잠금을 해제하세요.')
    return
  }

  const snapshot = buildTabSnapshot(id)
  if (!snapshot) return

  const res = await windowApi.splitTab(snapshot, 'compact')
  if (!res.ok) {
    store.getState().pushToast('error', '탐색기 창으로 분리하지 못했습니다.')
    return
  }
  // 분리 성공 → 소스 창에서 탭 닫기(마지막 탭이면 closeTab 이 기본 탭 유지).
  store.getState().closeTab(id)
}

/**
 * 새 창을 연다 — Windows 탐색기 Ctrl+N 관례(commandId `window.new`).
 *
 * 현재 위치(활성 탭)를 그대로 가진 창을 하나 더 띄운다. 분리(split)와 달리 **소스 탭은
 * 닫지 않는다**(복제). 별도 채널 없이 window:split-tab 을 재사용한다(신규 채널 0).
 *
 * 잠긴 탭도 복제 대상이다(원본을 건드리지 않으므로 closeTab 가드가 필요 없다). 다만
 * 새 창의 탭은 잠금 상태를 그대로 물려받는다(스냅샷 충실 복원).
 * 분리 창과 동일하게 세션 자동저장에는 참여하지 않는다(재시작 시 복원 안 됨 — windowManager).
 */
export async function openEmptyWindow(): Promise<void> {
  const s = store.getState()
  const snapshot = buildTabSnapshot(s.activeTabId)
  if (!snapshot) return
  const res = await windowApi.splitTab(snapshot)
  if (!res.ok) store.getState().pushToast('error', '새 창을 열지 못했습니다.')
}
