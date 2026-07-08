/**
 * 자동 업데이트 유스케이스 — 설정 "소프트웨어 정보"의 사용자 주도 업데이트(update:*).
 *
 * ui(SettingsDialog)는 infra 를 직접 import 하지 않으므로(.eslintrc: ui→infra 금지),
 * updateApi(check/download/install/onStatus)를 감싸는 얇은 유스케이스로 위임한다.
 *
 * app → infra/api(updateApi) 직접 호출(.eslintrc 허용).
 */
import type { UpdateCheckRes, UpdateStatusEvt } from '@shared/ipc/contracts'
import { updateApi } from '@renderer/infra/api'
import { store } from '@renderer/app/stores/rootStore'

export type UpdateCheckOutcome =
  | { readonly ok: true; readonly result: UpdateCheckRes }
  | { readonly ok: false; readonly message: string }

/** 새 버전 확인(다운로드 안 함). 실패 시 사용자 메시지 포함. */
export async function checkForUpdate(): Promise<UpdateCheckOutcome> {
  const r = await updateApi.check()
  return r.ok ? { ok: true, result: r.value } : { ok: false, message: r.error.message }
}

/** 업데이트 다운로드 시작(진행률은 subscribeUpdateStatus). */
export async function downloadUpdate(): Promise<{ ok: boolean; message: string }> {
  const r = await updateApi.download()
  return r.ok ? { ok: true, message: '' } : { ok: false, message: r.error.message }
}

/** 지금 재시작하여 설치(다운로드 완료 후). */
export async function installUpdate(): Promise<{ ok: boolean; message: string }> {
  const r = await updateApi.install()
  return r.ok ? { ok: true, message: '' } : { ok: false, message: r.error.message }
}

/** 확인/다운로드 진행/완료/오류 구독. 반환값으로 구독 해제. */
export function subscribeUpdateStatus(cb: (evt: UpdateStatusEvt) => void): () => void {
  return updateApi.onStatus(cb)
}

/**
 * 시작 시 업데이트 확인 브리지(전역 1회) — 설정 아이콘·"소프트웨어 정보" 배지 구동.
 *
 * (a) update:status 푸시를 전역 구독해 uiSlice.updateAvailable 을 갱신한다
 *     (available/downloaded=배지 표시·not-available=해제·checking/downloading/error=유지).
 * (b) 프로그램 시작 시 1회 새 버전을 확인한다(다운로드는 하지 않음 — 정책 유지).
 *     설치본에서만 실제 확인되고, 개발 빌드는 EUNSUPPORTED 로 조용히 무시된다(배지 없음).
 */
export function initUpdateBridge(): void {
  subscribeUpdateStatus((evt) => {
    const s = store.getState()
    if (evt.phase === 'available' || evt.phase === 'downloaded') {
      s.setUpdateAvailable(true, evt.version)
    } else if (evt.phase === 'not-available') {
      s.setUpdateAvailable(false, null)
    }
    // checking/downloading/error 는 마지막 알려진 배지 상태를 유지한다.
  })
  // 시작 시 1회 확인(다운로드 없음). available/not-available 이벤트가 위 구독으로 배지에 반영되며,
  // 이벤트 타이밍 편차에 대비해 확인 결과로도 직접 배지 상태를 확정한다(설치본만 available 가능).
  void checkForUpdate().then((outcome) => {
    if (outcome.ok) store.getState().setUpdateAvailable(outcome.result.available, outcome.result.version)
  })
}
