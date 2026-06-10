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

/** 빈 새 창을 연다(현재 탭은 그대로 유지). 활성 탭 스냅샷으로 main 에 새 창을 요청한다. */
export async function openEmptyWindow(): Promise<void> {
  // "새 빈 창"은 별도 채널 없이, 활성 탭과 동일 위치의 새 창을 띄우는 것으로 흡수한다
  // (신규 채널 최소화). 소스 탭은 닫지 않는다(분리가 아니라 복제 창).
  const s = store.getState()
  const snapshot = buildTabSnapshot(s.activeTabId)
  if (!snapshot) return
  const res = await windowApi.splitTab(snapshot)
  if (!res.ok) store.getState().pushToast('error', '새 창을 열지 못했습니다.')
}
