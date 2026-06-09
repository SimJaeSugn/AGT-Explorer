/**
 * queue:* IPC 핸들러 (M7 W2 — 전송 큐 · ADR-011).
 *
 * OperationManager 의 통합 큐 위 요청-응답 + 큐 스냅샷 푸시(queue:state).
 *  - queue:list            → OperationManager.listQueue(snapshot + 변경 푸시 구독 등록).
 *  - queue:pause/resume    → 항목 일시정지/재개(operationId · 파일 경계).
 *  - queue:retry           → 실패 항목 재시도(같은 소스/대상으로 새 op 재기동).
 *  - queue:set-concurrency → 전역 동시성 한도 갱신 후 즉시 pump.
 *  - queue:state           → OperationManager 가 디바운스로 event.sender 에 직접 푸시.
 *
 * 취소는 기존 op:cancel, 항목별 진행률은 기존 op:progress 재사용(operationId 식별).
 * 모든 핸들러 guard 통과(senderFrame·zod), 응답 Result<T,FileOpError>.
 * analyze.handlers.ts / op.handlers.ts handleGuarded 패턴을 복제한다.
 */
import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { CHANNELS } from '@shared/ipc/channels'
import type { QueueListRes, Result } from '@shared/ipc/contracts'
import { err } from '@shared/ipc/contracts'
import { operationManager } from '../operations/OperationManager'
import {
  isTrustedSender,
  parseArgs,
  untrustedSenderError,
  zQueueOperationReq,
  zQueueSetConcurrencyReq
} from './guard'
import { z } from 'zod'

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

/** queue:list 는 인자 없음(void). 빈 스키마로 sender 만 검증한다. */
const zVoid = z.undefined().or(z.null()).optional()

export function registerQueueHandlers(): void {
  // ── queue:list (스냅샷 + 변경 푸시 구독 등록) ─────────────────────
  handleGuarded(
    CHANNELS.QUEUE_LIST,
    zVoid,
    (_req, event): Result<QueueListRes> => operationManager.listQueue(event.sender)
  )

  // ── queue:pause ──────────────────────────────────────────────────
  handleGuarded(CHANNELS.QUEUE_PAUSE, zQueueOperationReq, (req) =>
    operationManager.pauseQueueItem(req.operationId)
  )

  // ── queue:resume ─────────────────────────────────────────────────
  handleGuarded(CHANNELS.QUEUE_RESUME, zQueueOperationReq, (req) =>
    operationManager.resumeQueueItem(req.operationId)
  )

  // ── queue:retry ──────────────────────────────────────────────────
  handleGuarded(CHANNELS.QUEUE_RETRY, zQueueOperationReq, (req) =>
    operationManager.retryQueueItem(req.operationId)
  )

  // ── queue:set-concurrency ────────────────────────────────────────
  handleGuarded(CHANNELS.QUEUE_SET_CONCURRENCY, zQueueSetConcurrencyReq, (req) =>
    operationManager.setConcurrency(req.maxConcurrent)
  )
}
