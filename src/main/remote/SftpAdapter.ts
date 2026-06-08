/**
 * SftpAdapter — SFTP(SSH) 어댑터 (§M M3 · ADR-007 결정④). `ssh2-sftp-client` 래핑.
 *
 * RemoteAdapter 를 구현해 list/stat/mkdir/rename/delete/download/upload 를 SFTP 로 매핑한다.
 * **호스트키 검증(hostVerifier·TOFU)** 은 connect 의 verifyHostKey 콜백으로 상위에 위임한다.
 * password/privateKey 인증을 지원(authMethod 기준). secret 은 connect 메모리에만 존재한다.
 *
 * 네트워크 import 는 이 디렉토리(`src/main/remote/`)에서만 허용된다(ESLint 화이트리스트).
 * ssh2 가속 모듈(cpu-features 등)은 optional — 순수 JS 모드로 동작(코드서명/패키징 영향 0).
 * 모든 메서드는 throw 0 — RemoteError 로 정규화(비밀 미수록).
 */
import { createWriteStream, createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import SftpClient from 'ssh2-sftp-client'
import type { FileInfo, SftpStats } from 'ssh2-sftp-client'
import type { FileEntryDTO } from '@shared/dto'
import type { Result } from '@shared/ipc/contracts'
import { err, ok } from '@shared/ipc/contracts'
import { posix } from 'node:path'
import type {
  CancelSignal,
  ConnectOpts,
  ConnectResult,
  RemoteAdapter,
  RemoteError,
  TransferProgress
} from './RemoteService'
import { remoteError, toRemoteError } from './remoteErrors'

/** 연결 타임아웃(ms). */
const READY_TIMEOUT_MS = 20_000

function entryFromFileInfo(parentPath: string, fi: FileInfo): FileEntryDTO {
  const isDir = fi.type === 'd'
  const isSymlink = fi.type === 'l'
  const name = fi.name
  const dot = name.lastIndexOf('.')
  const ext = isDir || dot <= 0 || dot === name.length - 1 ? '' : name.slice(dot + 1).toLowerCase()
  return {
    name,
    path: posix.join(parentPath, name),
    isDir,
    size: typeof fi.size === 'number' ? fi.size : 0,
    // ssh2-sftp-client modifyTime 은 ms epoch.
    mtime: typeof fi.modifyTime === 'number' ? fi.modifyTime : 0,
    ctime: typeof fi.modifyTime === 'number' ? fi.modifyTime : 0,
    ext,
    attrs: { hidden: name.startsWith('.'), readonly: false, system: false, symlink: isSymlink }
  }
}

function entryFromStats(remotePath: string, st: SftpStats): FileEntryDTO {
  const name = posix.basename(remotePath)
  const isDir = st.isDirectory
  const dot = name.lastIndexOf('.')
  const ext = isDir || dot <= 0 || dot === name.length - 1 ? '' : name.slice(dot + 1).toLowerCase()
  return {
    name,
    path: remotePath,
    isDir,
    size: typeof st.size === 'number' ? st.size : 0,
    mtime: typeof st.modifyTime === 'number' ? st.modifyTime : 0,
    ctime: typeof st.modifyTime === 'number' ? st.modifyTime : 0,
    ext,
    attrs: {
      hidden: name.startsWith('.'),
      readonly: false,
      system: false,
      symlink: st.isSymbolicLink
    }
  }
}

export class SftpAdapter implements RemoteAdapter {
  private client: SftpClient | null = null

  async connect(opts: ConnectOpts): Promise<Result<ConnectResult, RemoteError>> {
    const client = new SftpClient()
    // ⚠ 호스트키 TOFU 는 **연결 후** 상위(RemoteSessionManager)가 판정한다 — 어댑터는 거부하지
    // 않는다. ssh2-sftp-client 의 hostVerifier 가 false/cb(false) 로 거부하면 Electron 런타임에서
    // connect() 가 resolve/reject 둘 다 안 되고 **무한 hang**한다(실측 확인 — "연결중..." 멈춤의
    // 원인). 따라서 hostVerifier 는 **항상 true** 를 반환하되 서버 호스트키 지문만 캡처해
    // ConnectResult.fingerprint 로 올리고, 신뢰/거부/prompt 판정은 매니저가 연결 성립 후 수행한다.
    // ssh2 는 hostHash 옵션이 없으면 호스트키 raw bytes(Buffer)를 넘기므로 SHA256 으로 정규화한다.
    let fingerprint = ''
    const connectOptions: Record<string, unknown> = {
      host: opts.host,
      port: opts.port,
      username: opts.username,
      readyTimeout: READY_TIMEOUT_MS,
      hostVerifier: (keyHash: Buffer | string): boolean => {
        fingerprint = formatFingerprint(keyHash)
        return true // 항상 신뢰(거부는 매니저가 연결 후 처리 — hang 회피).
      }
    }
    // 인증 비밀(메모리 한정).
    if (opts.secret) {
      if (opts.authMethod === 'privateKey') {
        connectOptions['privateKey'] = opts.secret.kind === 'privateKey' ? opts.secret.value : ''
        if (opts.secret.kind === 'passphrase') connectOptions['passphrase'] = opts.secret.value
      } else {
        connectOptions['password'] = opts.secret.value
      }
    }

    try {
      await client.connect(connectOptions as never)
      this.client = client
      // SFTP 는 항상 암호화. 캡처한 지문을 상위 TOFU 판정용으로 반환.
      return ok({ encrypted: true, fingerprint, algo: 'ssh' })
    } catch (e) {
      await client.end().catch(() => undefined)
      return err(toRemoteError(e))
    }
  }

  async disconnect(): Promise<Result<void>> {
    if (this.client) {
      await this.client.end().catch(() => undefined)
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
    try {
      const st = await this.client.stat(path)
      return ok(entryFromStats(path, st))
    } catch (e) {
      return err(toRemoteError(e, undefined, path))
    }
  }

  async mkdir(parentPath: string, name: string): Promise<Result<void, RemoteError>> {
    if (!this.client) return err(remoteError('ECONNRESET'))
    try {
      await this.client.mkdir(posix.join(parentPath, name), false)
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
      // 디렉토리/파일 구분 — stat 후 분기.
      const st = await this.client.stat(path)
      if (st.isDirectory) await this.client.rmdir(path, true)
      else await this.client.delete(path)
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
    const dst = createWriteStream(localPath)
    try {
      await this.client.get(remotePath, dst, {
        step: (transferred: number): void => {
          if (cancel.aborted) dst.destroy()
          else onProgress(transferred)
        }
      })
      if (cancel.aborted) return err({ code: 'ECANCELED', message: '취소됨', path: remotePath })
      return ok(undefined)
    } catch (e) {
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
    const src = createReadStream(localPath)
    try {
      await this.client.put(src, remotePath, {
        step: (transferred: number): void => {
          if (cancel.aborted) src.destroy()
          else onProgress(transferred)
        }
      })
      if (cancel.aborted) return err({ code: 'ECANCELED', message: '취소됨', path: remotePath })
      return ok(undefined)
    } catch (e) {
      src.destroy()
      if (cancel.aborted) return err({ code: 'ECANCELED', message: '취소됨', path: remotePath })
      return err(toRemoteError(e, undefined, remotePath))
    }
  }
}

/**
 * ssh2 hostVerifier 인자 → 표시·저장용 지문(`SHA256:<base64>`)으로 정규화. 비밀 아님(공개키 해시).
 *
 * ssh2 는 `hostHash` 옵션을 주지 않으면 **호스트키 raw bytes 를 Buffer 로** 넘긴다(문자열 아님).
 * 그 Buffer 를 SHA256 해시해 OpenSSH 표준 형식(`SHA256:` + base64, 패딩 제거)으로 만든다.
 * 방어적으로 문자열 입력(이미 hex/base64 해시이거나 SHA256: 접두 포함)도 처리한다.
 */
export function formatFingerprint(keyHash: Buffer | string): string {
  if (Buffer.isBuffer(keyHash)) {
    if (keyHash.length === 0) return 'unknown'
    const b64 = createHash('sha256').update(keyHash).digest('base64').replace(/=+$/, '')
    return `SHA256:${b64}`
  }
  if (typeof keyHash === 'string' && keyHash.length > 0) {
    // 이미 지문 문자열이면 그대로, 아니면 SHA256: 접두만 부여(지문은 비밀 아님).
    return keyHash.startsWith('SHA256:') ? keyHash : `SHA256:${keyHash}`
  }
  return 'unknown'
}
