/**
 * update:* IPC 핸들러 — 사용자 주도 자동 업데이트(설정 "소프트웨어 정보").
 *
 * 전부 인자 없는 invoke(window:get-init 선례 동형) → guard 는 isTrustedSender 만.
 * 실제 동작은 os/autoUpdate 모듈에 위임(autoUpdater 캡슐화). 응답 Result<T>(throw 0).
 * 진행률·완료·오류는 autoUpdate 모듈이 update:status 푸시로 브로드캐스트한다.
 */
import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { CHANNELS } from '@shared/ipc/channels'
import type { Result, UpdateCheckRes } from '@shared/ipc/contracts'
import { err } from '@shared/ipc/contracts'
import { checkForUpdate, downloadUpdate, quitAndInstallUpdate } from '../os/autoUpdate'
import { isTrustedSender, untrustedSenderError } from './guard'

export function registerUpdateHandlers(): void {
  ipcMain.handle(
    CHANNELS.UPDATE_CHECK,
    async (event: IpcMainInvokeEvent): Promise<Result<UpdateCheckRes>> => {
      if (!isTrustedSender(event)) return err(untrustedSenderError())
      return checkForUpdate()
    }
  )

  ipcMain.handle(
    CHANNELS.UPDATE_DOWNLOAD,
    async (event: IpcMainInvokeEvent): Promise<Result<void>> => {
      if (!isTrustedSender(event)) return err(untrustedSenderError())
      return downloadUpdate()
    }
  )

  ipcMain.handle(
    CHANNELS.UPDATE_INSTALL,
    async (event: IpcMainInvokeEvent): Promise<Result<void>> => {
      if (!isTrustedSender(event)) return err(untrustedSenderError())
      return quitAndInstallUpdate()
    }
  )
}
