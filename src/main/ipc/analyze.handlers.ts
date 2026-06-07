/**
 * analyze:scan:* IPC 핸들러 (I장 — Top10 디스크 사용량 스캔).
 *
 * - analyze:scan:start  → guardPath(root) + 존재/디렉토리 검증 후 ScanManager.start.
 * - analyze:scan:cancel → ScanManager.cancel(scanId).
 * - analyze:scan:progress/done/error 는 ScanManager 가 event.sender 로 직접 푸시.
 *
 * 모든 핸들러 guard 통과(senderFrame·zod·경로 정규화), 응답 Result<T,FileOpError>.
 * op.handlers.ts handleGuarded 패턴을 복제한다.
 */
import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import * as fsp from 'node:fs/promises'
import { CHANNELS } from '@shared/ipc/channels'
import type { AnalyzeScanStartRes, Result } from '@shared/ipc/contracts'
import { err } from '@shared/ipc/contracts'
import { fileOpError, toFileOpError } from '../fs/errors'
import { scanManager } from '../operations/ScanManager'
import {
  guardPath,
  isTrustedSender,
  parseArgs,
  untrustedSenderError,
  zAnalyzeScanCancelReq,
  zAnalyzeScanStartReq
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

export function registerAnalyzeHandlers(): void {
  // ── analyze:scan:start ───────────────────────────────────────────
  handleGuarded(
    CHANNELS.ANALYZE_SCAN_START,
    zAnalyzeScanStartReq,
    async (req, event): Promise<Result<AnalyzeScanStartRes>> => {
      const g = guardPath(req.root)
      if (!g.ok) return g as Result<AnalyzeScanStartRes>
      // 루트는 존재하는 디렉토리여야 한다(파일/미존재 거부).
      try {
        const st = await fsp.stat(g.value)
        if (!st.isDirectory()) {
          return err(fileOpError('ENOTDIR', '스캔 대상이 폴더가 아닙니다.', g.value))
        }
      } catch (e) {
        return err(toFileOpError(e, g.value))
      }
      return scanManager.start(g.value, event.sender)
    }
  )

  // ── analyze:scan:cancel ──────────────────────────────────────────
  handleGuarded(CHANNELS.ANALYZE_SCAN_CANCEL, zAnalyzeScanCancelReq, (req) =>
    scanManager.cancel(req.scanId)
  )
}
