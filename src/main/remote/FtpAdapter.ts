/**
 * FtpAdapter — FTP/FTPS 어댑터 (§M M3 · ADR-007 결정④). `basic-ftp` 래핑.
 *
 * RemoteAdapter 를 구현해 list/stat/mkdir/rename/delete/download/upload 를 FTP 로 매핑한다.
 *  - 평문 FTP(`ftp`)는 `encrypted=false`(비암호화 경고 신호 — features §M3 보안표).
 *  - FTPS(`ftps`)는 명시적/암시적 TLS(`secure:'implicit'|true`) → `encrypted=true`.
 * basic-ftp 는 순수 JS(네이티브 빌드 0)·FTPS 는 Node 내장 `node:tls` 사용(이 디렉토리만 허용).
 *
 * FTP 는 호스트키 개념이 없다(verifyHostKey 무시). 인증은 password 만(privateKey 미지원).
 * 모든 메서드 throw 0 — RemoteError 정규화(비밀 미수록).
 */
import { createWriteStream, createReadStream } from 'node:fs'
import { posix } from 'node:path'
import { Client as FtpClient, FileType } from 'basic-ftp'
import type { FileInfo } from 'basic-ftp'
import type { FileEntryDTO } from '@shared/dto'
import type { Result } from '@shared/ipc/contracts'
import { err, ok } from '@shared/ipc/contracts'
import type {
  CancelSignal,
  ConnectOpts,
  ConnectResult,
  RemoteAdapter,
  RemoteError,
  TransferProgress
} from './RemoteService'
import { remoteError, toRemoteError } from './remoteErrors'

const CONNECT_TIMEOUT_MS = 20_000

function entryFromFileInfo(parentPath: string, fi: FileInfo): FileEntryDTO {
  const isDir = fi.type === FileType.Directory
  const isSymlink = fi.type === FileType.SymbolicLink
  const name = fi.name
  const dot = name.lastIndexOf('.')
  const ext = isDir || dot <= 0 || dot === name.length - 1 ? '' : name.slice(dot + 1).toLowerCase()
  const mtime = fi.modifiedAt instanceof Date ? fi.modifiedAt.getTime() : 0
  return {
    name,
    path: posix.join(parentPath, name),
    isDir,
    size: typeof fi.size === 'number' ? fi.size : 0,
    mtime,
    ctime: mtime,
    ext,
    attrs: { hidden: name.startsWith('.'), readonly: false, system: false, symlink: isSymlink }
  }
}

export class FtpAdapter implements RemoteAdapter {
  private client: FtpClient | null = null
  private encrypted = false

  async connect(opts: ConnectOpts): Promise<Result<ConnectResult, RemoteError>> {
    const client = new FtpClient(CONNECT_TIMEOUT_MS)
    // 평문 FTP=false, FTPS=true(implicit/explicit). secure:'implicit' 는 암시적 TLS.
    const secure: boolean | 'implicit' = opts.protocol === 'ftps' ? true : false
    try {
      await client.access({
        host: opts.host,
        port: opts.port,
        user: opts.username,
        password: opts.secret?.value ?? '',
        secure
      })
      this.client = client
      this.encrypted = opts.protocol === 'ftps'
      return ok({ encrypted: this.encrypted })
    } catch (e) {
      client.close()
      return err(toRemoteError(e))
    }
  }

  async disconnect(): Promise<Result<void>> {
    if (this.client) {
      this.client.close()
      this.client = null
    }
    return ok(undefined)
  }

  async list(path: string): Promise<Result<{ entries: FileEntryDTO[] }, RemoteError>> {
    if (!this.client) return err(remoteError('ECONNRESET'))
    try {
      const items = await this.client.list(path)
      const entries = items.map((fi) => entryFromFileInfo(path, fi))
      return ok({ entries })
    } catch (e) {
      return err(toRemoteError(e, undefined, path))
    }
  }

  async stat(path: string): Promise<Result<FileEntryDTO, RemoteError>> {
    if (!this.client) return err(remoteError('ECONNRESET'))
    // FTP 에는 단일 stat 표준이 약함 — 부모 list 에서 항목을 찾는다.
    try {
      const parent = posix.dirname(path)
      const base = posix.basename(path)
      const items = await this.client.list(parent)
      const match = items.find((fi) => fi.name === base)
      if (!match) return err(remoteError('ENOENT', path))
      return ok(entryFromFileInfo(parent, match))
    } catch (e) {
      return err(toRemoteError(e, undefined, path))
    }
  }

  async mkdir(parentPath: string, name: string): Promise<Result<void, RemoteError>> {
    if (!this.client) return err(remoteError('ECONNRESET'))
    try {
      await this.client.ensureDir(posix.join(parentPath, name))
      // ensureDir 는 cwd 를 바꾸므로 루트로 복귀(이후 절대경로 작업 정합).
      await this.client.cd('/')
      return ok(undefined)
    } catch (e) {
      return err(toRemoteError(e, undefined, parentPath))
    }
  }

  async rename(path: string, newName: string): Promise<Result<void, RemoteError>> {
    if (!this.client) return err(remoteError('ECONNRESET'))
    try {
      const target = posix.join(posix.dirname(path), newName)
      await this.client.rename(path, target)
      return ok(undefined)
    } catch (e) {
      return err(toRemoteError(e, undefined, path))
    }
  }

  async delete(path: string): Promise<Result<void, RemoteError>> {
    if (!this.client) return err(remoteError('ECONNRESET'))
    try {
      // 파일 시도 후 실패하면 디렉토리 제거 시도(FTP 는 타입 조회가 비용).
      try {
        await this.client.remove(path)
      } catch {
        await this.client.removeDir(path)
      }
      return ok(undefined)
    } catch (e) {
      return err(toRemoteError(e, undefined, path))
    }
  }

  async download(
    remotePath: string,
    localPath: string,
    onProgress: TransferProgress,
    cancel: CancelSignal
  ): Promise<Result<void, RemoteError>> {
    if (!this.client) return err(remoteError('ECONNRESET'))
    const client = this.client
    const dst = createWriteStream(localPath)
    client.trackProgress((info) => {
      if (cancel.aborted) client.close()
      else onProgress(info.bytes)
    })
    try {
      await client.downloadTo(dst, remotePath)
      client.trackProgress()
      if (cancel.aborted) return err({ code: 'ECANCELED', message: '취소됨', path: remotePath })
      return ok(undefined)
    } catch (e) {
      client.trackProgress()
      dst.destroy()
      if (cancel.aborted) return err({ code: 'ECANCELED', message: '취소됨', path: remotePath })
      return err(toRemoteError(e, undefined, remotePath))
    }
  }

  async upload(
    localPath: string,
    remotePath: string,
    onProgress: TransferProgress,
    cancel: CancelSignal
  ): Promise<Result<void, RemoteError>> {
    if (!this.client) return err(remoteError('ECONNRESET'))
    const client = this.client
    const src = createReadStream(localPath)
    client.trackProgress((info) => {
      if (cancel.aborted) client.close()
      else onProgress(info.bytes)
    })
    try {
      await client.uploadFrom(src, remotePath)
      client.trackProgress()
      if (cancel.aborted) return err({ code: 'ECANCELED', message: '취소됨', path: remotePath })
      return ok(undefined)
    } catch (e) {
      client.trackProgress()
      src.destroy()
      if (cancel.aborted) return err({ code: 'ECANCELED', message: '취소됨', path: remotePath })
      return err(toRemoteError(e, undefined, remotePath))
    }
  }
}
