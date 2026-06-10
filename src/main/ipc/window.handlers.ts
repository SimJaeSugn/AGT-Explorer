/**
 * window:* IPC 핸들러 (U3 — 탭 분리(새 창), US-20.3 Could).
 *
 * - window:split-tab → 소스 렌더러가 넘긴 TabSnapshot 1개로 새(분리) 창을 만든다.
 *     소스 탭 제거는 렌더러 책임(closeTab 경로)이며 여기선 창 생성만 한다.
 * - window:get-init  → 각 창의 렌더러가 부팅 시 자기 초기 상태를 끌어간다
 *     (event.sender.id 로 어느 창인지 식별 → primary/initialTab 반환).
 *
 * 모든 핸들러 guard 통과(senderFrame·zod), 응답 Result<T,FileOpError>(throw 0).
 * 새 창은 windowManager.createSplitWindow 가 createMainWindow 와 동일 보안 옵션·
 * show-fallback·로드 로직을 재사용한다(ADR-005 — 보안 모델 모든 창 동일).
 */
import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { CHANNELS } from '@shared/ipc/channels'
import type { Result, WindowInitRes } from '@shared/ipc/contracts'
import { err, ok } from '@shared/ipc/contracts'
import type { TabSnapshot } from '@shared/dto'
import { createSplitWindow, getWindowInit } from '../windows/windowManager'
import {
  isTrustedSender,
  parseArgs,
  untrustedSenderError,
  zWindowSplitTabReq
} from './guard'

export function registerWindowHandlers(): void {
  // ── window:split-tab (탭 → 새 창 분리) ───────────────────────────────
  ipcMain.handle(
    CHANNELS.WINDOW_SPLIT_TAB,
    async (event: IpcMainInvokeEvent, raw): Promise<Result<void>> => {
      if (!isTrustedSender(event)) return err(untrustedSenderError())
      const parsed = parseArgs(zWindowSplitTabReq, raw)
      if (!parsed.ok) return parsed as Result<void>
      // 형태만 통과한 tab 을 TabSnapshot 으로 취급 — 새 창 렌더러의 coerceTab +
      // restoreWindows 가 본문/경로를 다시 정규화·검증한다(세션 복원과 동일 경로).
      createSplitWindow(parsed.value.tab as unknown as TabSnapshot)
      return ok(undefined)
    }
  )

  // ── window:get-init (부팅 초기 상태 — 인자 없음, sender 식별) ──────────
  ipcMain.handle(
    CHANNELS.WINDOW_GET_INIT,
    async (event: IpcMainInvokeEvent): Promise<Result<WindowInitRes>> => {
      if (!isTrustedSender(event)) return err(untrustedSenderError())
      const init = getWindowInit(event.sender.id)
      return ok({ primary: init.primary, initialTab: init.initialTab })
    }
  )
}
