/**
 * workspace:* IPC 핸들러 (P6c 구현 — 명시적 워크스페이스, US-5.8).
 *
 * - workspace:save   → 이름 붙여 현재 세션 스냅샷을 워크스페이스 JSON 에 원자 저장.
 * - workspace:list   → workspaces/ 의 워크스페이스 메타(name·savedAt) 목록.
 * - workspace:load   → 이름으로 로드해 SessionSnapshot 반환(손상/구버전 폴백).
 * - workspace:delete → 워크스페이스 파일 삭제(멱등).
 *
 * Store(WorkspaceStore)가 원자적 쓰기·정규화(coerceSession)·이름 새니타이즈를
 * 담당한다. 모든 핸들러 guard 통과(senderFrame·zod), 응답 Result<T>(throw 금지).
 * snapshot 본문 정규화는 persistence 계층에 위임(session.handlers 와 동일 정책).
 */
import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { CHANNELS } from '@shared/ipc/channels'
import type { Result } from '@shared/ipc/contracts'
import { err, ok } from '@shared/ipc/contracts'
import type { SessionSnapshot, WorkspaceInfo } from '@shared/dto'
import { workspaceStore } from '../persistence'
import { fileOpError, toFileOpError } from '../fs/errors'
import {
  isTrustedSender,
  parseArgs,
  untrustedSenderError,
  zWorkspaceDeleteReq,
  zWorkspaceLoadReq,
  zWorkspaceSaveReq
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

export function registerWorkspaceHandlers(): void {
  // ── workspace:save (이름 + 스냅샷 → 원자 저장) ──────────────────────
  handleGuarded(CHANNELS.WORKSPACE_SAVE, zWorkspaceSaveReq, async (req): Promise<Result<void>> => {
    try {
      // zod passthrough 로 형태만 통과 → Store 가 coerceSession 으로 정규화.
      await workspaceStore().save(req.name, req.snapshot as unknown as SessionSnapshot)
      return ok(undefined)
    } catch (e) {
      return err(toFileOpError(e))
    }
  })

  // ── workspace:list (인자 없음 → sender 검증만) ──────────────────────
  ipcMain.handle(CHANNELS.WORKSPACE_LIST, async (event): Promise<Result<WorkspaceInfo[]>> => {
    if (!isTrustedSender(event)) return err(untrustedSenderError())
    try {
      return ok(await workspaceStore().list())
    } catch (e) {
      return err(toFileOpError(e))
    }
  })

  // ── workspace:load (이름 → SessionSnapshot) ────────────────────────
  handleGuarded(CHANNELS.WORKSPACE_LOAD, zWorkspaceLoadReq, async (req): Promise<Result<SessionSnapshot>> => {
    try {
      const snap = await workspaceStore().load(req.name)
      if (!snap) {
        return err(fileOpError('ENOENT', `워크스페이스를 찾을 수 없습니다: ${req.name}`, req.name))
      }
      return ok(snap)
    } catch (e) {
      return err(toFileOpError(e))
    }
  })

  // ── workspace:delete (이름 → 파일 삭제) ────────────────────────────
  handleGuarded(CHANNELS.WORKSPACE_DELETE, zWorkspaceDeleteReq, async (req): Promise<Result<void>> => {
    try {
      await workspaceStore().delete(req.name)
      return ok(undefined)
    } catch (e) {
      return err(toFileOpError(e))
    }
  })
}
