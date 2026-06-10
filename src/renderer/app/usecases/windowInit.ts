/**
 * windowInit 유스케이스 (U3 — 멀티 윈도우 부팅 분기, US-20.3 Could).
 *
 * 각 창의 렌더러는 부팅 시 window:get-init 으로 자기 초기 상태를 끌어온다:
 *  - primary 창: 기존과 100% 동일 — 세션 복원(restoreSession) + 자동저장 구독.
 *  - split  창: 넘겨받은 탭 1개로 부팅(restoreWindows 재사용) + **자동저장 미참여**
 *               (공유 session.json 클로버 방지 → 분리 창은 재시작 시 복원 안 됨).
 *
 * window:get-init 호출 자체가 실패하면(이론상 불가) 안전하게 primary 로 폴백한다
 * (기본 부트 — 단일 창 경험 무손상). 즉 분리(payload) 가 없을 때 동작은 오늘과
 * 바이트 동일하다.
 *
 * @returns 자동저장 중단 함수(primary 창만 등록 — split 창은 no-op).
 */
import { windowApi } from '@renderer/infra/api'
import { store } from '@renderer/app/stores/rootStore'
import { restoreSession, startSessionAutosave } from '@renderer/app/usecases/session'

export async function bootWindow(): Promise<() => void> {
  let init: { primary: boolean; initialTab: import('@shared/dto').TabSnapshot | null } = {
    primary: true,
    initialTab: null
  }
  try {
    const res = await windowApi.getInit()
    if (res.ok) init = res.value
  } catch {
    // 폴백: primary 취급(기본 부트 — 단일 창 경험 무손상).
    init = { primary: true, initialTab: null }
  }

  if (init.primary || !init.initialTab) {
    // primary(또는 폴백): 기존 부팅 경로 — 세션 복원 + 자동저장.
    await restoreSession()
    return startSessionAutosave()
  }

  // split 창: 넘겨받은 탭 1개로 부팅(restoreWindows 단일 경로 재사용). 패널/뷰/
  // 히스토리/메타 복원은 restoreWindows 가 담당한다. 실패(빈 탭)면 기본 탭 폴백.
  const adopted = store.getState().restoreWindows([
    { tabs: [init.initialTab], activeTabId: init.initialTab.id }
  ])
  if (!adopted) {
    const start = store.getState().startLocation
    if (start) store.getState().newTab(start)
    else store.getState().initDefaultTab()
  }
  // 분리 창은 세션 자동저장에 참여하지 않는다(no-op 해제 함수).
  return () => undefined
}
