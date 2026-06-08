/**
 * remote:* IPC 핸들러 (§M M3 — FTP/SFTP, 실구현 MP4).
 *
 * 자격증명(safeStorage·os/credentials)·프로필(persistence/RemoteProfileStore)·세션(remote/
 * RemoteSessionManager)·전송(remote/remoteTransfer)을 연결한다. 본 파일은 **네트워크 라이브러리를
 * 직접 import 하지 않는다** — remote/ 배럴이 노출하는 매니저/전송 함수만 호출한다(어댑터·node:tls·
 * ssh2/basic-ftp 는 remote/ 안에 캡슐화 · ESLint 화이트리스트).
 *
 * 비밀 배제(ADR-007 ③⑥): cred:save/connect 요청 본문의 secret 은 즉시 safeStorage 또는 어댑터
 * 메모리로만 흐르고, 응답·로그·Error 에 절대 싣지 않는다(RemoteError = FileOpError, 직렬화 동일).
 * 모든 핸들러 guard 통과(senderFrame·zod), 응답 Result<T, FileOpError|RemoteError>. throw 0.
 */
import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import type { FileEntryDTO, RemoteProfileDTO } from '@shared/dto'
import { CHANNELS } from '@shared/ipc/channels'
import type {
  ClipboardHasFilesRes,
  RemoteConnectRes,
  RemoteListRes,
  RemoteTransferRes,
  Result
} from '@shared/ipc/contracts'
import { err, ok } from '@shared/ipc/contracts'
import { fileOpError } from '../fs/errors'
import { credentialStore } from '../os/credentials'
import { remoteProfileStore } from '../persistence/RemoteProfileStore'
import { operationManager } from '../operations/OperationManager'
import {
  remoteSessionManager,
  startDownload,
  startUpload,
  type RemoteSecretInput
} from '../remote'
import {
  guardPath,
  isTrustedSender,
  parseArgs,
  untrustedSenderError,
  zRemoteConnectReq,
  zRemoteCredDeleteReq,
  zRemoteCredHasReq,
  zRemoteCredSaveReq,
  zRemoteDeleteReq,
  zRemoteDisconnectReq,
  zRemoteDownloadReq,
  zRemoteListReq,
  zRemoteMkdirReq,
  zRemoteProfileDeleteReq,
  zRemoteProfileUpsertReq,
  zRemoteRenameReq,
  zRemoteStatReq,
  zRemoteUploadReq
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

export function registerRemoteHandlers(): void {
  // ── 자격증명 cred:* (safeStorage) ─────────────────────────────────────
  handleGuarded(CHANNELS.REMOTE_CRED_SAVE, zRemoteCredSaveReq, async (req): Promise<Result<void>> => {
    // isAvailable 게이트 + 암호화 저장. secret 은 저장 직후 폐기(여기서 참조 종료).
    return credentialStore().save(req.profileId, req.secret.value)
  })
  handleGuarded(
    CHANNELS.REMOTE_CRED_HAS,
    zRemoteCredHasReq,
    async (req): Promise<Result<ClipboardHasFilesRes>> => credentialStore().has(req.profileId)
  )
  handleGuarded(CHANNELS.REMOTE_CRED_DELETE, zRemoteCredDeleteReq, async (req): Promise<Result<void>> =>
    credentialStore().delete(req.profileId)
  )

  // ── 프로필 profile:* (RemoteProfileStore·비밀 배제) ────────────────────
  ipcMain.handle(CHANNELS.REMOTE_PROFILE_LIST, async (event): Promise<Result<RemoteProfileDTO[]>> => {
    if (!isTrustedSender(event)) return err(untrustedSenderError())
    return ok(await remoteProfileStore().list())
  })
  handleGuarded(
    CHANNELS.REMOTE_PROFILE_UPSERT,
    zRemoteProfileUpsertReq,
    async (req): Promise<Result<RemoteProfileDTO>> => {
      const saved = await remoteProfileStore().upsert(req.profile)
      if (!saved) return err(fileOpError('EINVAL', '잘못된 프로필입니다.'))
      return ok(saved)
    }
  )
  handleGuarded(
    CHANNELS.REMOTE_PROFILE_DELETE,
    zRemoteProfileDeleteReq,
    async (req): Promise<Result<void>> => {
      // 프로필 삭제 시 자격증명도 연동 삭제(고아 비밀 방지).
      await remoteProfileStore().delete(req.profileId)
      await credentialStore().delete(req.profileId)
      return ok(undefined)
    }
  )

  // ── 세션 connect/disconnect (RemoteSessionManager·TOFU) ────────────────
  handleGuarded(
    CHANNELS.REMOTE_CONNECT,
    zRemoteConnectReq,
    async (req, event): Promise<Result<RemoteConnectRes>> => {
      // secret: 요청 1회용 우선, 없으면 저장된 자격증명 로드(연결 시점에만 복호화).
      let secret: RemoteSecretInput | undefined
      if (req.secret) {
        secret = req.secret
      } else {
        const loaded = await credentialStore().load(req.profile.id)
        if (loaded.ok && loaded.value) {
          // 저장된 비밀의 kind 는 authMethod 로 환원(password|privateKey).
          const kind = req.profile.authMethod === 'privateKey' ? 'privateKey' : 'password'
          secret = { kind, value: loaded.value }
        }
      }
      const r = await remoteSessionManager().connect(
        {
          profile: req.profile,
          ...(secret ? { secret } : {}),
          ...(req.hostKeyDecision ? { hostKeyDecision: req.hostKeyDecision } : {})
        },
        event.sender
      )
      // secret 폐기는 GC 위임(여기서 참조 종료). 응답에 비밀 미수록.
      if (!r.ok) return err(r.error)
      return ok({ sessionId: r.value.sessionId, encrypted: r.value.encrypted })
    }
  )
  handleGuarded(CHANNELS.REMOTE_DISCONNECT, zRemoteDisconnectReq, async (req): Promise<Result<void>> =>
    remoteSessionManager().disconnect(req.sessionId)
  )

  // ── 탐색 list/stat/mkdir/rename/delete (어댑터·POSIX traversal 방어) ────
  handleGuarded(CHANNELS.REMOTE_LIST, zRemoteListReq, async (req): Promise<Result<RemoteListRes>> =>
    remoteSessionManager().list(req.sessionId, req.path)
  )
  handleGuarded(CHANNELS.REMOTE_STAT, zRemoteStatReq, async (req): Promise<Result<FileEntryDTO>> =>
    remoteSessionManager().stat(req.sessionId, req.path)
  )
  handleGuarded(CHANNELS.REMOTE_MKDIR, zRemoteMkdirReq, async (req): Promise<Result<void>> =>
    remoteSessionManager().mkdir(req.sessionId, req.path, req.name)
  )
  handleGuarded(CHANNELS.REMOTE_RENAME, zRemoteRenameReq, async (req): Promise<Result<void>> =>
    remoteSessionManager().rename(req.sessionId, req.path, req.newName)
  )
  handleGuarded(CHANNELS.REMOTE_DELETE, zRemoteDeleteReq, async (req): Promise<Result<void>> =>
    remoteSessionManager().delete(req.sessionId, req.path)
  )

  // ── 전송 download/upload (remoteTransfer·로컬 guardPath·op:* 재사용 CN-4) ─
  handleGuarded(
    CHANNELS.REMOTE_DOWNLOAD,
    zRemoteDownloadReq,
    async (req, event): Promise<Result<RemoteTransferRes>> => {
      // 로컬 도착지 guardPath(정규화·상위이탈 차단 — Zip Slip 1차 방어).
      const g = guardPath(req.destDir)
      if (!g.ok) return g as Result<RemoteTransferRes>
      const adapter = remoteSessionManager().getAdapter(req.sessionId)
      if (!adapter) return err(fileOpError('ECONNRESET', '세션이 유효하지 않습니다.'))
      return startDownload(adapter, req.remotePaths, g.value, event.sender, operationManager)
    }
  )
  handleGuarded(
    CHANNELS.REMOTE_UPLOAD,
    zRemoteUploadReq,
    async (req, event): Promise<Result<RemoteTransferRes>> => {
      // 로컬 소스 guardPath(정규화·상위이탈 차단).
      const localPaths: string[] = []
      for (const p of req.localPaths) {
        const g = guardPath(p)
        if (!g.ok) return g as Result<RemoteTransferRes>
        localPaths.push(g.value)
      }
      const adapter = remoteSessionManager().getAdapter(req.sessionId)
      if (!adapter) return err(fileOpError('ECONNRESET', '세션이 유효하지 않습니다.'))
      return startUpload(adapter, localPaths, req.remoteDir, event.sender, operationManager)
    }
  )
}
