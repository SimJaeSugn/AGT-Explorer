/**
 * remoteSlice — 원격(FTP/SFTP) 연결 UI 상태 (§M M3).
 *
 * 프로필 목록·세션 맵·연결 진행·호스트키 확인 요청·세션 오류를 보유한다.
 * trashSlice/analyzeSlice 동형(데이터·UI 상태만, IPC 는 usecases/remote 경유).
 *
 * ⚠ 비밀(password/passphrase/privateKey 본문)은 이 슬라이스에 **절대 보관하지 않는다**
 *   (ADR-007 ③⑥). 연결 폼의 비밀은 컴포넌트 로컬 state 에서 즉시 connect/credSave
 *   요청 본문으로만 전달되고 슬라이스로 들어오지 않는다. 본 슬라이스 필드에는 비밀 없음.
 *
 * 모달 열림(remoteDialogOpen)·inputContext='dialog' 게이트는 uiSlice 가 관리한다
 * (trashOpen 동형). 세션은 sessionId→RemoteSession 맵으로, 원격 패널 경로(sftp://...)와
 * 호스트로 상관한다.
 */
import type { RemoteProfileDTO } from '@shared/dto'
import type { RemoteHostKeyEvt } from '@shared/ipc/contracts'
import type { SliceCreator } from './types'

/** 연결 진행 상태(연결 다이얼로그·패널 배지 표시용). */
export type RemoteConnectStatus = 'idle' | 'connecting' | 'connected' | 'error'

/** 활성 원격 세션 1개(비밀 없음). */
export interface RemoteSession {
  readonly sessionId: string
  /** 연결된 프로필(공개 메타만). */
  readonly profile: RemoteProfileDTO
  /** 암호화 연결 여부(false=평문 FTP → 비암호화 경고). */
  readonly encrypted: boolean
}

/** 호스트키 확인 요청(TOFU) — 사용자 신뢰/거부 모달 입력. */
export interface HostKeyPrompt {
  readonly connectId: string
  readonly fingerprint: string
  readonly algo: string
  /** unknown=최초 접속(미등록), changed=known_hosts 불일치(경고 강화). */
  readonly status: 'unknown' | 'changed'
}

export interface RemoteSlice {
  /** 저장된 원격 프로필 목록(remote:profile:list). */
  readonly remoteProfiles: RemoteProfileDTO[]
  /** 활성 세션 맵(sessionId → 세션). */
  readonly remoteSessions: Record<string, RemoteSession>
  /** 호스트별 활성 세션 상관(host:port → sessionId). 원격 패널 경로→세션 해석. */
  readonly remoteSessionByHost: Record<string, string>
  /** 연결 진행 상태(다이얼로그 버튼·스피너). */
  readonly remoteConnectStatus: RemoteConnectStatus
  /** 연결 오류 메시지(없으면 null). */
  readonly remoteConnectError: string | null
  /** 진행 중 호스트키 확인 요청(없으면 null — 모달 비표시). */
  readonly hostKeyPrompt: HostKeyPrompt | null

  // 프로필 ────────────────────────────────────────────────────────────────
  /** 프로필 목록 반영(usecases/remote.loadProfiles). */
  _setRemoteProfiles(profiles: RemoteProfileDTO[]): void

  // 연결 상태 ──────────────────────────────────────────────────────────────
  /** 연결 시작(status=connecting, 오류 초기화). */
  _remoteConnecting(): void
  /** 연결 성공 → 세션 등록(status=connected). */
  _remoteConnected(session: RemoteSession): void
  /** 연결 실패(status=error, 메시지). */
  _remoteConnectError(message: string): void
  /** 연결 상태 초기화(다이얼로그 재오픈 시). */
  _resetRemoteConnect(): void
  /** 세션 제거(disconnect·세션 오류 시). */
  _removeSession(sessionId: string): void

  // 호스트키 / 세션 오류 푸시 ────────────────────────────────────────────────
  /** 호스트키 확인 요청 표시(remote:host-key 푸시). */
  _setHostKeyPrompt(evt: RemoteHostKeyEvt): void
  /** 호스트키 확인 요청 해제(사용자 결정 후). */
  _clearHostKeyPrompt(): void
}

/** host:port 상관 키(세션 맵). */
function hostKey(host: string, port: number): string {
  return `${host}:${port}`
}

export const createRemoteSlice: SliceCreator<RemoteSlice> = (set) => ({
  remoteProfiles: [],
  remoteSessions: {},
  remoteSessionByHost: {},
  remoteConnectStatus: 'idle',
  remoteConnectError: null,
  hostKeyPrompt: null,

  _setRemoteProfiles(profiles) {
    set((s) => {
      s.remoteProfiles = profiles
    })
  },

  _remoteConnecting() {
    set((s) => {
      s.remoteConnectStatus = 'connecting'
      s.remoteConnectError = null
    })
  },

  _remoteConnected(session) {
    set((s) => {
      s.remoteSessions[session.sessionId] = session
      s.remoteSessionByHost[hostKey(session.profile.host, session.profile.port)] = session.sessionId
      s.remoteConnectStatus = 'connected'
      s.remoteConnectError = null
      s.hostKeyPrompt = null
    })
  },

  _remoteConnectError(message) {
    set((s) => {
      s.remoteConnectStatus = 'error'
      s.remoteConnectError = message
    })
  },

  _resetRemoteConnect() {
    set((s) => {
      s.remoteConnectStatus = 'idle'
      s.remoteConnectError = null
      s.hostKeyPrompt = null
    })
  },

  _removeSession(sessionId) {
    set((s) => {
      const sess = s.remoteSessions[sessionId]
      delete s.remoteSessions[sessionId]
      if (sess) {
        const hk = hostKey(sess.profile.host, sess.profile.port)
        if (s.remoteSessionByHost[hk] === sessionId) delete s.remoteSessionByHost[hk]
      }
    })
  },

  _setHostKeyPrompt(evt) {
    set((s) => {
      s.hostKeyPrompt = {
        connectId: evt.connectId,
        fingerprint: evt.fingerprint,
        algo: evt.algo,
        status: evt.status
      }
    })
  },

  _clearHostKeyPrompt() {
    set((s) => {
      s.hostKeyPrompt = null
    })
  }
})
