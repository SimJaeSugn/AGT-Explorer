/**
 * app:* IPC 핸들러 — 앱 기본 정보(설정 "소프트웨어 정보").
 *
 * app:get-info → 버전·런타임(Electron/Chrome/Node/V8)·플랫폼/아키텍처·packaged 여부.
 * 인자 없음(window:get-init 선례 동형) → guard 는 isTrustedSender 만. 전부 비-비밀·읽기.
 * 응답 Result<T>(throw 0). app:open-path 푸시(V2)는 index.ts 가 직접 보내므로 여기 없음.
 */
import { app, ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { CHANNELS } from '@shared/ipc/channels'
import type { AppInfoDTO, Result } from '@shared/ipc/contracts'
import { err, ok } from '@shared/ipc/contracts'
import { isTrustedSender, untrustedSenderError } from './guard'

export function registerAppHandlers(): void {
  ipcMain.handle(
    CHANNELS.APP_GET_INFO,
    async (event: IpcMainInvokeEvent): Promise<Result<AppInfoDTO>> => {
      if (!isTrustedSender(event)) return err(untrustedSenderError())
      return ok({
        name: app.getName(),
        version: app.getVersion(),
        electron: process.versions.electron ?? '',
        chrome: process.versions.chrome ?? '',
        node: process.versions.node ?? '',
        v8: process.versions.v8 ?? '',
        platform: process.platform,
        arch: process.arch,
        packaged: app.isPackaged
      })
    }
  )
}
