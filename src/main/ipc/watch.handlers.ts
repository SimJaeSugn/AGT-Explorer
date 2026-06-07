/**
 * fs:watch:* IPC 핸들러 (J장 J2 — 현재 디렉토리 실시간 감시).
 *
 * - fs:watch:start → guard(sender·zFsWatchStartReq·guardPath) + 디렉토리 검증 후
 *   WatchService.start. onEvent → fs:watch:event{watchId,path} 푸시(wc.isDestroyed 가드),
 *   onError → fs:watch:error{watchId,error} 푸시. → Result<{watchId}>.
 * - fs:watch:stop → WatchService.stop(watchId)(멱등). → Result<void>.
 * - 각 WebContents 의 watchId 를 추적해 destroyed/render-process-gone 시 일괄 중지(누수 방지).
 *
 * 모든 핸들러 guard 통과(senderFrame·zod·경로 정규화), 응답 Result<T,FileOpError>.
 * fs.handlers.ts 스트림 푸시 패턴(event.sender·wc.isDestroyed)을 복제한다.
 */
import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent, WebContents } from 'electron'
import { CHANNELS } from '@shared/ipc/channels'
import type { FsWatchStartRes, Result } from '@shared/ipc/contracts'
import { err, ok } from '@shared/ipc/contracts'
import { watchService } from '../fs/WatchService'
import {
  guardPath,
  isTrustedSender,
  parseArgs,
  untrustedSenderError,
  zFsWatchStartReq,
  zFsWatchStopReq
} from './guard'

function handleGuarded<TSchema extends import('zod').ZodTypeAny, TVal>(
  channel: string,
  schema: TSchema,
  fn: (
    req: import('zod').infer<TSchema>,
    event: IpcMainInvokeEvent
  ) => Promise<Result<TVal>> | Result<TVal>
): void {
  ipcMain.handle(channel, async (event, raw): Promise<Result<TVal>> => {
    if (!isTrustedSender(event)) return err(untrustedSenderError())
    const parsed = parseArgs(schema, raw)
    if (!parsed.ok) return parsed as Result<TVal>
    return fn(parsed.value, event)
  })
}

/** sender(WebContents) 별 발급한 watchId 집합 — wc 파괴 시 일괄 정리(누수 방지). */
const watchIdsByWc = new WeakMap<WebContents, Set<string>>()
/** destroyed 정리 리스너를 1회만 부착하기 위한 추적. */
const cleanupBound = new WeakSet<WebContents>()

function trackWatch(wc: WebContents, watchId: string): void {
  let set = watchIdsByWc.get(wc)
  if (!set) {
    set = new Set<string>()
    watchIdsByWc.set(wc, set)
  }
  set.add(watchId)

  // wc 파괴/렌더 프로세스 종료 시 해당 sender 의 모든 watch 중지(좀비 핸들 0).
  if (!cleanupBound.has(wc)) {
    cleanupBound.add(wc)
    const cleanup = (): void => {
      const ids = watchIdsByWc.get(wc)
      if (ids) {
        watchService.stopAllForSender(ids)
        watchIdsByWc.delete(wc)
      }
    }
    wc.once('destroyed', cleanup)
    wc.once('render-process-gone', cleanup)
  }
}

function untrackWatch(wc: WebContents, watchId: string): void {
  const set = watchIdsByWc.get(wc)
  if (set) set.delete(watchId)
}

export function registerWatchHandlers(): void {
  // ── fs:watch:start ───────────────────────────────────────────────
  handleGuarded(
    CHANNELS.FS_WATCH_START,
    zFsWatchStartReq,
    (req, event): Result<FsWatchStartRes> => {
      const g = guardPath(req.path)
      if (!g.ok) return g as Result<FsWatchStartRes>
      const wc: WebContents = event.sender
      const watchId = watchService.start(g.value, {
        onEvent: (p) => {
          if (!wc.isDestroyed()) wc.send(CHANNELS.FS_WATCH_EVENT, { watchId, path: p })
        },
        onError: (error) => {
          if (!wc.isDestroyed()) wc.send(CHANNELS.FS_WATCH_ERROR, { watchId, error })
        }
      })
      trackWatch(wc, watchId)
      return ok({ watchId })
    }
  )

  // ── fs:watch:stop (멱등) ─────────────────────────────────────────
  handleGuarded(CHANNELS.FS_WATCH_STOP, zFsWatchStopReq, (req, event) => {
    watchService.stop(req.watchId)
    untrackWatch(event.sender, req.watchId)
    return ok(undefined)
  })
}
