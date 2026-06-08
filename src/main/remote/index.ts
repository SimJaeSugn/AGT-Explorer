/**
 * 원격(FTP/FTPS/SFTP) 특권 디렉토리 배럴 — Main 단일 출처 (§M M3).
 *
 * `src/main/remote/` 는 ADR-007 결정②의 **네트워크 화이트리스트 디렉토리**다(ESLint
 * 예외). 상위 계층(ipc/remote.handlers.ts)은 본 배럴이 노출하는 RemoteSessionManager·
 * remoteTransfer·타입만 의존하고, 네트워크 라이브러리(ssh2/basic-ftp)·node:tls 는 이
 * 디렉토리 안에 캡슐화된다(외부 import 금지 — lint 가드).
 */
import type { KnownHostsStore } from './RemoteSessionManager'
import { RemoteSessionManager, defaultAdapterFactory } from './RemoteSessionManager'

export type {
  RemoteService,
  RemoteAdapter,
  RemoteError,
  ConnectOpts,
  ConnectResult,
  HostKeyInfo,
  HostKeyDecision,
  RemoteSecretInput
} from './RemoteService'
export { RemoteSessionManager, defaultAdapterFactory } from './RemoteSessionManager'
export type { KnownHostsStore, AdapterFactory, ConnectRequest } from './RemoteSessionManager'
export { startDownload, startUpload } from './remoteTransfer'
export type { OpRegistrar } from './remoteTransfer'
export {
  normalizeRemotePath,
  joinRemote,
  sanitizeLocalFileName,
  isWithinLocalDir,
  safeLocalDestPath
} from './remotePath'
export { classifyRemoteError, toRemoteError, remoteError } from './remoteErrors'

// ── 런타임 싱글턴(앱 부팅 시 초기화) ────────────────────────────────────
let _manager: RemoteSessionManager | null = null

/**
 * 세션 매니저 초기화. knownHosts 는 RemoteProfileStore(known_hosts.json) 를 주입한다.
 * 어댑터 팩토리는 실제 SFTP/FTP 어댑터(네트워크)를 지연 로드한다.
 */
export function initRemoteSessionManager(knownHosts: KnownHostsStore): RemoteSessionManager {
  _manager = new RemoteSessionManager(defaultAdapterFactory(), knownHosts)
  return _manager
}

export function remoteSessionManager(): RemoteSessionManager {
  if (!_manager) {
    throw new Error('remoteSessionManager not initialized — call initRemoteSessionManager() first')
  }
  return _manager
}
