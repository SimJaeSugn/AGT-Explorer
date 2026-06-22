/**
 * 앱 기본 정보 유스케이스 — 설정 "소프트웨어 정보"용 (app:get-info).
 *
 * ui(SettingsDialog)는 infra 를 직접 import 하지 않으므로(.eslintrc: ui→infra 금지),
 * appApi.getInfo 를 감싸는 얇은 유스케이스로 위임한다. 신규 IPC 채널은 app:get-info 1종.
 *
 * app → infra/api(appApi.getInfo) 직접 호출(.eslintrc 허용).
 */
import type { AppInfoDTO } from '@shared/ipc/contracts'
import { appApi } from '@renderer/infra/api'

/** 앱·런타임 기본 정보 조회. 실패 시 null. */
export async function getAppInfo(): Promise<AppInfoDTO | null> {
  const r = await appApi.getInfo()
  return r.ok ? r.value : null
}
