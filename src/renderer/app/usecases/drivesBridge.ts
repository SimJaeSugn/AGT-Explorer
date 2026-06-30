/**
 * drivesBridge 유스케이스 — 드라이브 연결/해제(USB 등) 자동 갱신.
 *
 * Main 이 WM_DEVICECHANGE 를 감지·디바운스해 fs:drives-changed 를 푸시하면, 드라이브
 * 목록을 보고 있는 모든 곳을 다시 읽는다:
 *   ① 사이드바 트리 루트(loadDrives — 살아있는 드라이브의 펼침 상태 보존·병합)
 *   ② "내 PC"(빈 경로)를 보고 있는 패널(refresh — 드라이브 목록 재적재)
 *   ③ 대시보드 디스크 사용량(loadDriveUsage — 열려 있으면 즉시 반영)
 *
 * app → infra/api 직접 호출(.eslintrc 허용). 전역 1회 구독(중복 호출 무시).
 */
import { subscribeDrivesChanged } from '@renderer/infra/api'
import { store } from '@renderer/app/stores/rootStore'
import { isMyPc } from '@renderer/domain/paths'
import { loadDriveUsage } from '@renderer/app/usecases/dashboard'

let disposer: (() => void) | null = null

/** 드라이브 토폴로지 변경 시 사이드바·"내 PC" 패널·대시보드를 재열거한다. */
function refreshDrives(): void {
  const s = store.getState()
  // ① 사이드바 트리 루트(병합 — 펼침/로드 상태 보존).
  s.loadDrives()
  // ② "내 PC"(빈 경로)를 보고 있는 패널만 재적재(다른 경로 패널은 건드리지 않음).
  for (const [id, p] of Object.entries(s.panels)) {
    if (p.path === '' || isMyPc(p.path)) s.refresh(id, { preserve: true })
  }
  // ③ 대시보드 디스크 사용량(열려 있으면 즉시 반영 — 닫혀 있어도 다음 열람 시 최신).
  void loadDriveUsage()
}

/** fs:drives-changed 전역 구독 시작(중복 호출 무시). App 부팅 시 1회. */
export function initDrivesBridge(): void {
  if (disposer) return
  disposer = subscribeDrivesChanged(() => refreshDrives())
}

/** 구독 해제(테스트·HMR). */
export function disposeDrivesBridge(): void {
  if (disposer) {
    disposer()
    disposer = null
  }
}
