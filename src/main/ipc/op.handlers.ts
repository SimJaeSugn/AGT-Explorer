/**
 * op:* + fs 단발 + dialog:* IPC 핸들러 (P4 구현).
 *
 * - op:start/resolve/cancel → OperationManager 위임(Worker copy/move/delete + trash).
 * - op:progress/conflict/done 은 OperationManager 가 event.sender 로 직접 푸시.
 * - fs:mkdir/create-file/rename → FileSystemService 단발 조작.
 * - dialog:confirm-permanent-delete → Main 모달(영구삭제 확인, SA §4.2).
 *
 * 모든 핸들러 guard 통과(senderFrame·zod·경로 정규화), 응답 Result<T,FileOpError>.
 */
import { dialog, ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { CHANNELS } from '@shared/ipc/channels'
import type { DialogConfirmRes, OpStartRes, Result } from '@shared/ipc/contracts'
import { err, ok } from '@shared/ipc/contracts'
import type { FileEntryDTO } from '@shared/dto'
import { fileSystemService } from '../fs/FileSystemService'
import { operationManager } from '../operations/OperationManager'
import {
  guardPath,
  isTrustedSender,
  parseArgs,
  untrustedSenderError,
  zDialogConfirmPermanentDeleteReq,
  zFsCreateFileReq,
  zFsMkdirReq,
  zFsRenameReq,
  zOpCancelReq,
  zOpResolveReq,
  zOpStartReq
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

export function registerOpHandlers(): void {
  // ── fs:mkdir ─────────────────────────────────────────────────────
  handleGuarded(CHANNELS.FS_MKDIR, zFsMkdirReq, async (req) => {
    const g = guardPath(req.parentDir)
    if (!g.ok) return g as Result<FileEntryDTO>
    return fileSystemService.mkdir(g.value, req.name)
  })

  // ── fs:create-file ───────────────────────────────────────────────
  handleGuarded(CHANNELS.FS_CREATE_FILE, zFsCreateFileReq, async (req) => {
    const g = guardPath(req.parentDir)
    if (!g.ok) return g as Result<FileEntryDTO>
    return fileSystemService.createFile(g.value, req.name, req.template)
  })

  // ── fs:rename ────────────────────────────────────────────────────
  handleGuarded(CHANNELS.FS_RENAME, zFsRenameReq, async (req) => {
    const g = guardPath(req.path)
    if (!g.ok) return g as Result<FileEntryDTO>
    return fileSystemService.rename(g.value, req.newName)
  })

  // ── op:start ─────────────────────────────────────────────────────
  handleGuarded(CHANNELS.OP_START, zOpStartReq, async (req, event) => {
    // 소스 경로 전부 정규화·검증.
    const sources: string[] = []
    for (const s of req.sources) {
      const g = guardPath(s)
      if (!g.ok) return g as Result<OpStartRes>
      sources.push(g.value)
    }
    let destDir: string | undefined
    if (req.destDir !== undefined) {
      const gd = guardPath(req.destDir)
      if (!gd.ok) return gd as Result<OpStartRes>
      destDir = gd.value
    }
    return operationManager.start(
      req.kind,
      sources,
      destDir,
      req.conflictPolicy,
      event.sender
    )
  })

  // ── op:resolve ───────────────────────────────────────────────────
  handleGuarded(CHANNELS.OP_RESOLVE, zOpResolveReq, (req) =>
    operationManager.resolve(req.operationId, req.conflictId, req.resolution, req.applyToAll)
  )

  // ── op:cancel ────────────────────────────────────────────────────
  handleGuarded(CHANNELS.OP_CANCEL, zOpCancelReq, (req) =>
    operationManager.cancel(req.operationId)
  )

  // ── dialog:confirm-permanent-delete (Main 모달, SA §4.2) ──────────
  handleGuarded(
    CHANNELS.DIALOG_CONFIRM_PERMANENT_DELETE,
    zDialogConfirmPermanentDeleteReq,
    async (req): Promise<Result<DialogConfirmRes>> => {
      const count = req.paths.length
      const detail =
        count === 1
          ? `'${req.paths[0]}' 을(를) 영구히 삭제합니다.`
          : `선택한 ${count}개 항목을 영구히 삭제합니다.`
      const r = await dialog.showMessageBox({
        type: 'warning',
        buttons: ['영구 삭제', '취소'],
        defaultId: 1,
        cancelId: 1,
        title: '영구 삭제 확인',
        message: '이 작업은 되돌릴 수 없습니다. 계속하시겠습니까?',
        detail
      })
      return ok({ confirmed: r.response === 0 })
    }
  )
}
