/**
 * RemoteSessionManager — 원격 세션 수명·격리·TOFU 호스트키 관리 (§M M3 · ADR-007 결정⑤⑥).
 *
 * 책임:
 *  - sessionId 별 어댑터(SftpAdapter/FtpAdapter) 인스턴스 격리. 한 세션의 끊김/타임아웃/오류가
 *    다른 세션·Main 을 중단시키지 않는다(throw 0 격리 · remote:session-error 푸시).
 *  - connect: 프로토콜별 어댑터 선택 + 비밀(secret) 1회 주입 + **TOFU 호스트키 검증**:
 *      · SFTP 호스트키 지문을 known_hosts(RemoteProfileStore)와 대조.
 *      · 미등록(unknown)/불일치(changed) 시 사용자 결정(hostKeyDecision) 없으면 **연결 보류**하고
 *        `remote:host-key` 푸시 → 사용자가 accept/reject 를 다음 connect 의 hostKeyDecision 으로 회신.
 *      · accept 시 지문 저장 후 연결. reject/불일치 거부 → EHOSTKEY.
 *  - list/stat/mkdir/rename/delete 를 RemoteService 로 노출(원격 경로 POSIX traversal 방어).
 *  - 어댑터 접근(getAdapter)으로 remoteTransfer 가 download/upload 스트림을 구동.
 *  - disconnect·앱 종료 시 전 세션 정리.
 *
 * 네트워크 표면은 어댑터(같은 디렉토리)에 캡슐화 — 본 매니저는 라이브러리를 직접 import 하지 않는다.
 */
import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import type { FileEntryDTO, RemoteProfileDTO } from '@shared/dto'
import { CHANNELS } from '@shared/ipc/channels'
import type { Result } from '@shared/ipc/contracts'
import { err, ok } from '@shared/ipc/contracts'
import type {
  ConnectOpts,
  RemoteAdapter,
  RemoteError,
  RemoteSecretInput,
  RemoteService
} from './RemoteService'
import { remoteError } from './remoteErrors'
import { normalizeRemotePath } from './remotePath'
import { SftpAdapter } from './SftpAdapter'
import { FtpAdapter } from './FtpAdapter'

/** 호스트키 지문 저장소 추상(RemoteProfileStore 가 구현 — 주입으로 헤드리스 검증). */
export interface KnownHostsStore {
  getKnownHostKey(host: string, port: number): Promise<string | undefined>
  setKnownHostKey(host: string, port: number, fingerprint: string): Promise<void>
}

/** 어댑터 팩토리(프로토콜 → 어댑터). 주입으로 verify 가 스텁 어댑터 대체. */
export type AdapterFactory = (protocol: RemoteProfileDTO['protocol']) => RemoteAdapter

interface Session {
  readonly sessionId: string
  readonly adapter: RemoteAdapter
  readonly profile: RemoteProfileDTO
  readonly wc: WebContents | null
}

/** connect 입력(핸들러 → 매니저). secret 은 1회용. */
export interface ConnectRequest {
  readonly profile: RemoteProfileDTO
  readonly secret?: RemoteSecretInput
  readonly hostKeyDecision?: 'accept' | 'reject'
}

export class RemoteSessionManager implements RemoteService {
  private readonly sessions = new Map<string, Session>()

  constructor(
    private readonly makeAdapter: AdapterFactory,
    private readonly knownHosts: KnownHostsStore
  ) {}

  /**
   * 연결 수립 + **연결 후 TOFU 호스트키 판정**.
   *
   * ⚠ 어댑터(SftpAdapter)는 호스트키를 **거부하지 않는다** — ssh2-sftp-client 가 hostVerifier
   * 거부 시 Electron 런타임에서 connect() 가 hang 하기 때문(실측). 대신 항상 신뢰해 연결을
   * 수립하고 서버 호스트키 **지문**을 ConnectResult.fingerprint 로 올린다. 여기서 그 지문을
   * known_hosts 와 대조해 신뢰 여부를 판정한다:
   *  - 일치(known): 세션 유지.
   *  - 미등록(unknown)/불일치(changed):
   *      · hostKeyDecision==='accept' → 지문 저장 후 세션 유지(사용자가 모달에서 신뢰함).
   *      · hostKeyDecision==='reject' → 세션 끊고 EHOSTKEY(사용자 거부).
   *      · 미지정 → 세션 끊고 `remote:host-key` 푸시 + EHOSTKEY(렌더러가 모달 표시 후 재연결).
   *
   * TOFU 절충(정직 표기): 미승인 호스트도 **판정 전에 핸드셰이크·인증이 완료**된다(거부 경로가
   * hang 하므로 불가피). 첫 사용 시 호스트키를 학습하는 TOFU 모델의 통상적 절충이며, 미승인이면
   * 세션을 즉시 끊어 어떤 파일 작업도 수행하지 않는다.
   */
  async connect(
    req: ConnectRequest,
    wc: WebContents | null,
    connectId: string = randomUUID()
  ): Promise<Result<{ sessionId: string; encrypted: boolean; initialPath?: string }, RemoteError>> {
    const { profile } = req
    const adapter = this.makeAdapter(profile.protocol)

    // SFTP 만 known_hosts 사전 조회(연결 후 대조용).
    const knownFingerprint =
      profile.protocol === 'sftp'
        ? await this.knownHosts.getKnownHostKey(profile.host, profile.port)
        : undefined

    const opts: ConnectOpts = {
      protocol: profile.protocol,
      host: profile.host,
      port: profile.port,
      username: profile.username,
      authMethod: profile.authMethod,
      ...(req.secret ? { secret: req.secret } : {})
    }

    const r = await adapter.connect(opts)
    if (!r.ok) {
      await adapter.disconnect().catch(() => undefined)
      return err(r.error)
    }

    // ── 연결 후 TOFU 판정(SFTP·지문 존재 시) ──────────────────────────────
    const fingerprint = r.value.fingerprint
    if (profile.protocol === 'sftp' && fingerprint) {
      const matches = knownFingerprint !== undefined && knownFingerprint === fingerprint
      if (!matches) {
        const status: 'unknown' | 'changed' =
          knownFingerprint === undefined ? 'unknown' : 'changed'
        if (req.hostKeyDecision === 'accept') {
          // 사용자가 모달에서 신뢰 → 지문 저장(TOFU 등록) 후 세션 유지.
          await this.knownHosts
            .setKnownHostKey(profile.host, profile.port, fingerprint)
            .catch(() => undefined)
        } else {
          // 미승인 — 세션 끊고 호스트키 확인 요청(또는 사용자 거부 시 EHOSTKEY).
          await adapter.disconnect().catch(() => undefined)
          if (req.hostKeyDecision === undefined && wc && !wc.isDestroyed()) {
            wc.send(CHANNELS.REMOTE_HOST_KEY, {
              connectId,
              fingerprint,
              algo: r.value.algo ?? 'ssh',
              status
            })
          }
          return err(remoteError('EHOSTKEY'))
        }
      }
    }

    const sessionId = randomUUID()
    this.sessions.set(sessionId, { sessionId, adapter, profile, wc })
    return ok({
      sessionId,
      encrypted: r.value.encrypted,
      ...(r.value.initialPath ? { initialPath: r.value.initialPath } : {})
    })
  }

  async disconnect(sessionId: string): Promise<Result<void>> {
    const s = this.sessions.get(sessionId)
    if (!s) return ok(undefined) // idempotent.
    this.sessions.delete(sessionId)
    await s.adapter.disconnect().catch(() => undefined)
    return ok(undefined)
  }

  /** 앱 종료 시 전 세션 정리. */
  async disconnectAll(): Promise<void> {
    const all = [...this.sessions.values()]
    this.sessions.clear()
    await Promise.all(all.map((s) => s.adapter.disconnect().catch(() => undefined)))
  }

  /** remoteTransfer 가 download/upload 스트림 구동용으로 어댑터를 얻는다(세션 격리 유지). */
  getAdapter(sessionId: string): RemoteAdapter | null {
    return this.sessions.get(sessionId)?.adapter ?? null
  }

  getProfile(sessionId: string): RemoteProfileDTO | null {
    return this.sessions.get(sessionId)?.profile ?? null
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  /**
   * 세션 오류 보고 — 한 세션의 끊김/타임아웃을 해당 패널에만 격리 전파(remote:session-error).
   * Main·다른 세션은 영향 없음. 세션은 정리한다.
   */
  reportSessionError(sessionId: string, error: RemoteError): void {
    const s = this.sessions.get(sessionId)
    if (!s) return
    if (s.wc && !s.wc.isDestroyed()) {
      s.wc.send(CHANNELS.REMOTE_SESSION_ERROR, { sessionId, error })
    }
    void this.disconnect(sessionId)
  }

  // ── RemoteService: 탐색/조작(원격 POSIX traversal 방어) ────────────────
  private resolveSession(sessionId: string): Result<Session, RemoteError> {
    const s = this.sessions.get(sessionId)
    if (!s) return err(remoteError('ECONNRESET'))
    return ok(s)
  }

  private guardRemotePath(path: string): Result<string, RemoteError> {
    const r = normalizeRemotePath(path)
    if (!r.ok) {
      return err({ code: 'EACCES', message: '잘못된 원격 경로입니다.', path })
    }
    return ok(r.path)
  }

  async list(
    sessionId: string,
    path: string
  ): Promise<Result<{ entries: FileEntryDTO[] }, RemoteError>> {
    const sr = this.resolveSession(sessionId)
    if (!sr.ok) return sr
    const pr = this.guardRemotePath(path)
    if (!pr.ok) return pr
    return sr.value.adapter.list(pr.value)
  }

  async stat(sessionId: string, path: string): Promise<Result<FileEntryDTO, RemoteError>> {
    const sr = this.resolveSession(sessionId)
    if (!sr.ok) return sr
    const pr = this.guardRemotePath(path)
    if (!pr.ok) return pr
    return sr.value.adapter.stat(pr.value)
  }

  async mkdir(
    sessionId: string,
    path: string,
    name: string
  ): Promise<Result<void, RemoteError>> {
    const sr = this.resolveSession(sessionId)
    if (!sr.ok) return sr
    const pr = this.guardRemotePath(path)
    if (!pr.ok) return pr
    if (name.includes('/') || name.includes('\0') || name === '.' || name === '..') {
      return err({ code: 'EACCES', message: '잘못된 이름입니다.', path })
    }
    return sr.value.adapter.mkdir(pr.value, name)
  }

  async rename(
    sessionId: string,
    path: string,
    newName: string
  ): Promise<Result<void, RemoteError>> {
    const sr = this.resolveSession(sessionId)
    if (!sr.ok) return sr
    const pr = this.guardRemotePath(path)
    if (!pr.ok) return pr
    if (newName.includes('/') || newName.includes('\0') || newName === '.' || newName === '..') {
      return err({ code: 'EACCES', message: '잘못된 이름입니다.', path })
    }
    return sr.value.adapter.rename(pr.value, newName)
  }

  async delete(sessionId: string, path: string): Promise<Result<void, RemoteError>> {
    const sr = this.resolveSession(sessionId)
    if (!sr.ok) return sr
    const pr = this.guardRemotePath(path)
    if (!pr.ok) return pr
    return sr.value.adapter.delete(pr.value)
  }
}

/**
 * 기본 어댑터 팩토리(런타임). verify 는 스텁 팩토리를 주입한다.
 *
 * ⚠ 어댑터는 **정적 import** 한다(과거 지연 `require('./SftpAdapter')` 는 electron-vite 가 main 을
 * `out/main/index.js` 단일 번들로 묶을 때 런타임에 `./SftpAdapter` 가 존재하지 않아
 * `MODULE_NOT_FOUND` 가 났다 — 빌드된 앱에서 remote:connect 실패의 원인). 어댑터가 의존하는
 * 네트워크 라이브러리(ssh2-sftp-client·basic-ftp·node:tls)는 electron.vite 가 externalize 하여
 * 런타임에 node_modules 에서 로드되므로, 정적 import 해도 번들에 라이브러리 본문이 들어가지 않는다.
 */
export function defaultAdapterFactory(): AdapterFactory {
  return (protocol): RemoteAdapter =>
    protocol === 'sftp' ? new SftpAdapter() : new FtpAdapter()
}
