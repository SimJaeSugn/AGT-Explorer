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
import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import * as fsp from 'node:fs/promises'
import { win32 } from 'node:path'
import { CHANNELS } from '@shared/ipc/channels'
import type {
  DialogConfirmRes,
  DialogPickDirectoryRes,
  OpStartRes,
  Result
} from '@shared/ipc/contracts'
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
  zDialogPickDirectoryReq,
  zFsCreateFileReq,
  zFsLinkFinalizeReq,
  zFsMkdirReq,
  zFsRenameReq,
  zOpCancelReq,
  zOpResolveReq,
  zOpRobocopyStartReq,
  zOpStartReq
} from './guard'
import { fileOpError, toFileOpError } from '../fs/errors'

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

  // ── fs:link-finalize (자동링크 마무리 — 원본 rename + 원본자리 정션, V10) ──
  // 복사(op:* )가 끝난 뒤 호출: ① 원본을 백업명으로 rename → ② 원본 자리에 linkTarget 을
  // 가리키는 **정션(junction)** 생성. 정션은 관리자 권한 불필요(심볼릭 링크와 달리). 정션
  // 생성 실패 시 백업을 원래 이름으로 되돌려(롤백) 원본을 보존한다. throw 금지·Result 전파.
  handleGuarded(CHANNELS.FS_LINK_FINALIZE, zFsLinkFinalizeReq, async (req): Promise<Result<void>> => {
    const gs = guardPath(req.sourceDir)
    if (!gs.ok) return gs as Result<void>
    const gt = guardPath(req.linkTarget)
    if (!gt.ok) return gt as Result<void>
    const source = gs.value
    const linkTarget = gt.value
    // 백업명은 단일 폴더명만(경로 분리자·금지문자·상위 참조 차단).
    if (/[\\/:*?"<>|]/.test(req.backupName) || req.backupName === '.' || req.backupName === '..') {
      return err(fileOpError('EINVAL', '백업 이름에 사용할 수 없는 문자가 있습니다.', req.backupName))
    }
    // 원본은 실존 디렉토리여야 한다.
    try {
      const st = await fsp.lstat(source)
      if (!st.isDirectory()) return err(fileOpError('ENOTDIR', '원본이 폴더가 아닙니다.', source))
    } catch (e) {
      const fe = toFileOpError(e, source)
      return err(fe.code === 'EUNKNOWN' ? fileOpError('ENOENT', '원본을 찾을 수 없습니다.', source) : fe)
    }
    // 링크 대상(복사된 목적지)은 실존 디렉토리여야 한다.
    try {
      const lt = await fsp.stat(linkTarget)
      if (!lt.isDirectory()) return err(fileOpError('ENOTDIR', '링크 대상이 폴더가 아닙니다.', linkTarget))
    } catch (e) {
      const fe = toFileOpError(e, linkTarget)
      return err(fe.code === 'EUNKNOWN' ? fileOpError('ENOENT', '링크 대상을 찾을 수 없습니다.', linkTarget) : fe)
    }
    const backupPath = win32.join(win32.dirname(source), req.backupName)
    // 백업 이름이 이미 있으면 거부(덮어쓰기 방지).
    try {
      await fsp.access(backupPath)
      return err(fileOpError('EEXIST', '백업 이름이 이미 존재합니다.', backupPath))
    } catch {
      /* 없음 — 정상 */
    }
    // ① 원본 → 백업 rename(원본자리 이름 비움). 읽기전용 속성은 미리 해제(EACCES 완화).
    //    단, 폴더가 다른 프로그램에서 **사용 중**이면 rename 은 실패한다(EACCES/EPERM/EBUSY) —
    //    이는 Windows 제약이라 사용 중 프로그램 종료 후 재시도해야 한다(에러로 정직 전파).
    await fsp.chmod(source, 0o666).catch(() => undefined)
    try {
      await fsp.rename(source, backupPath)
    } catch (e) {
      return err(toFileOpError(e, source))
    }
    // ② 원본 자리에 정션 생성. 실패 시 백업을 원래 이름으로 롤백.
    try {
      await fsp.symlink(linkTarget, source, 'junction')
    } catch (e) {
      try {
        await fsp.rename(backupPath, source)
      } catch {
        /* 롤백 실패 — 백업은 backupPath 에 보존됨(데이터 손실 없음) */
      }
      return err(toFileOpError(e, source))
    }
    return ok(undefined)
  })

  // ── dialog:pick-directory (네이티브 폴더 선택, V10) ──────────────────
  handleGuarded(
    CHANNELS.DIALOG_PICK_DIRECTORY,
    zDialogPickDirectoryReq,
    async (req): Promise<Result<DialogPickDirectoryRes>> => {
      const win = BrowserWindow.getFocusedWindow()
      const opts: Electron.OpenDialogOptions = {
        properties: ['openDirectory', 'createDirectory'],
        ...(req.defaultPath ? { defaultPath: req.defaultPath } : {})
      }
      const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
      const picked = r.canceled || r.filePaths.length === 0 ? null : (r.filePaths[0] ?? null)
      return ok({ path: picked })
    }
  )

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
    let baseDir: string | undefined
    if (req.baseDir !== undefined) {
      const gb = guardPath(req.baseDir)
      if (!gb.ok) return gb as Result<OpStartRes>
      baseDir = gb.value
    }
    return operationManager.start(
      req.kind,
      sources,
      destDir,
      req.conflictPolicy,
      event.sender,
      baseDir
    )
  })

  // ── op:robocopy:start (폴더 비교 고속 미러 — robocopy 복사, V3) ────
  handleGuarded(CHANNELS.OP_ROBOCOPY_START, zOpRobocopyStartReq, async (req, event) => {
    const gs = guardPath(req.srcDir)
    if (!gs.ok) return gs as Result<OpStartRes>
    const gd = guardPath(req.dstDir)
    if (!gd.ok) return gd as Result<OpStartRes>
    // 양쪽 모두 실존 디렉토리 검증(파일/미존재 거부 — robocopy 오용 방지).
    for (const p of [gs.value, gd.value]) {
      try {
        const st = await fsp.stat(p)
        if (!st.isDirectory()) return err(fileOpError('ENOTDIR', '폴더가 아닙니다.', p))
      } catch {
        return err(fileOpError('ENOENT', '대상을 찾을 수 없습니다.', p))
      }
    }
    return operationManager.startRobocopyMirror(
      gs.value,
      gd.value,
      req.expectedItems ?? 0,
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
