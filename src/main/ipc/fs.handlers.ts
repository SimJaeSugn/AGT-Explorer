/**
 * fs:* IPC 핸들러 등록 (P1 구현 = 읽기 계열).
 *
 * - ipcMain.handle 로 fs:list/stat/drives/tree-children/validate-path 등록.
 * - 응답은 모두 Result<T, FileOpError>(throw 금지, ADR-003).
 * - 모든 핸들러가 guard 통과(senderFrame·zod·경로 정규화).
 * - 스트리밍(fs:list:start/chunk/done/error/cancel)은 streamId 로 구독을 묶고
 *   event.sender 로 Main→Renderer 푸시한다.
 *
 * fs:mkdir/create-file/rename(impl: P4), op:*(impl: P4)는 본 파일에 추가하지 않는다.
 */
import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent, WebContents } from 'electron'
import { CHANNELS } from '@shared/ipc/channels'
import type { Result } from '@shared/ipc/contracts'
import { err, ok } from '@shared/ipc/contracts'
import type {
  DirListResult,
  DriveDTO,
  FileEntryDTO,
  ListStreamStart,
  PathValidation
} from '@shared/dto'
import { fileSystemService } from '../fs/FileSystemService'
import {
  guardPath,
  isTrustedSender,
  parseArgs,
  untrustedSenderError,
  zFsListCancelReq,
  zFsListReq,
  zFsListStartReq,
  zFsStatReq,
  zFsTreeChildrenReq,
  zFsValidatePathReq
} from './guard'

/**
 * invoke 핸들러를 sender 검증 + 인자검증으로 감싸는 래퍼.
 * 검증 실패 시 Result.err 를 즉시 반환(throw 금지).
 */
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

export function registerFsHandlers(): void {
  // ── fs:list (단발) ──────────────────────────────────────────────
  handleGuarded(CHANNELS.FS_LIST, zFsListReq, async (req) => {
    const g = guardPath(req.path)
    if (!g.ok) return g as Result<DirListResult>
    return fileSystemService.list(g.value, req.showHidden)
  })

  // ── fs:stat ─────────────────────────────────────────────────────
  handleGuarded(CHANNELS.FS_STAT, zFsStatReq, async (req) => {
    const g = guardPath(req.path)
    if (!g.ok) return g as Result<FileEntryDTO>
    return fileSystemService.stat(g.value)
  })

  // ── fs:tree-children ────────────────────────────────────────────
  handleGuarded(CHANNELS.FS_TREE_CHILDREN, zFsTreeChildrenReq, async (req) => {
    const g = guardPath(req.path)
    if (!g.ok) return g as Result<FileEntryDTO[]>
    return fileSystemService.treeChildren(g.value)
  })

  // ── fs:validate-path ────────────────────────────────────────────
  handleGuarded(CHANNELS.FS_VALIDATE_PATH, zFsValidatePathReq, async (req) => {
    const g = guardPath(req.path)
    if (!g.ok) return g as Result<PathValidation>
    return fileSystemService.validatePath(g.value)
  })

  // ── fs:drives (인자 없음 → sender 검증만) ────────────────────────
  ipcMain.handle(CHANNELS.FS_DRIVES, async (event): Promise<Result<DriveDTO[]>> => {
    if (!isTrustedSender(event)) return err(untrustedSenderError())
    return fileSystemService.drives()
  })

  // ── fs:list:start (스트리밍 시작) ───────────────────────────────
  handleGuarded(CHANNELS.FS_LIST_START, zFsListStartReq, async (req, event) => {
      const g = guardPath(req.path)
      if (!g.ok) return g as Result<ListStreamStart>
      const wc: WebContents = event.sender
      const streamId = fileSystemService.startListStream(
        g.value,
        req.showHidden,
        req.chunkSize ?? 0,
        {
          onChunk: (entries) => {
            if (!wc.isDestroyed()) wc.send(CHANNELS.FS_LIST_CHUNK, { streamId, entries })
          },
          onDone: (total, truncated) => {
            if (!wc.isDestroyed()) wc.send(CHANNELS.FS_LIST_DONE, { streamId, total, truncated })
          },
          onError: (error) => {
            if (!wc.isDestroyed()) wc.send(CHANNELS.FS_LIST_ERROR, { streamId, error })
          }
        }
      )
    return ok({ streamId })
  })

  // ── fs:list:cancel ──────────────────────────────────────────────
  handleGuarded(CHANNELS.FS_LIST_CANCEL, zFsListCancelReq, (req) => {
    fileSystemService.cancelStream(req.streamId)
    return ok(undefined)
  })
}
