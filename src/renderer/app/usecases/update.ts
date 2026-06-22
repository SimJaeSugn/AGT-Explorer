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
