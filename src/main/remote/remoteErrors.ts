/**
 * 원격 오류 정규화 (§M M3 · ADR-007 결정⑥-6·⑦).
 *
 * 라이브러리(ssh2/basic-ftp) throw 값·errno·메시지를 `RemoteError`(= FileOpError, code 확장)
 * 로 정규화한다. **메시지에 비밀(password/passphrase/privateKey 본문)을 절대 싣지 않는다** —
 * 코드+안전 메시지만 전파한다. 본 모듈은 순수 함수만(네트워크 비의존) → verify 가 직접 호출.
 */
import type { RemoteError } from './RemoteService'

interface ErrnoLike {
  code?: string
  message?: string
  level?: string
}

/** 안전 메시지(코드별 사용자 노출 문구 — 비밀·민감정보 없음). */
const SAFE_MESSAGES: Record<string, string> = {
  EAUTH: '인증에 실패했습니다. 자격증명을 확인하세요.',
  ETIMEDOUT: '연결 시간이 초과되었습니다.',
  ECONNRESET: '연결이 끊어졌습니다.',
  EHOSTUNREACH: '호스트에 연결할 수 없습니다.',
  EHOSTKEY: '호스트 키를 신뢰할 수 없습니다.',
  EUNSUPPORTED: '지원되지 않는 작업입니다.',
  EACCES: '권한이 거부되었습니다.',
  ENOENT: '경로를 찾을 수 없습니다.',
  EUNKNOWN: '원격 작업 중 오류가 발생했습니다.'
}

export type NormalizedCode =
  | 'EAUTH'
  | 'ETIMEDOUT'
  | 'ECONNRESET'
  | 'EHOSTUNREACH'
  | 'EHOSTKEY'
  | 'EUNSUPPORTED'
  | 'EACCES'
  | 'ENOENT'
  | 'EUNKNOWN'

/** 라이브러리 errno/메시지 패턴 → RemoteError 코드. 비밀 미참조. */
export function classifyRemoteError(e: unknown): NormalizedCode {
  const o = (e ?? {}) as ErrnoLike
  const rawCode = typeof o.code === 'string' ? o.code.toUpperCase() : ''
  const msg = typeof o.message === 'string' ? o.message.toLowerCase() : ''

  // 직접 errno 매핑.
  if (rawCode === 'ETIMEDOUT' || msg.includes('timed out') || msg.includes('timeout')) {
    return 'ETIMEDOUT'
  }
  if (rawCode === 'ECONNRESET' || rawCode === 'EPIPE' || msg.includes('reset')) return 'ECONNRESET'
  if (
    rawCode === 'EHOSTUNREACH' ||
    rawCode === 'ENOTFOUND' ||
    rawCode === 'ECONNREFUSED' ||
    rawCode === 'EAI_AGAIN' ||
    msg.includes('getaddrinfo') ||
    msg.includes('connect')
  ) {
    return 'EHOSTUNREACH'
  }
  if (
    msg.includes('host key') ||
    msg.includes('hostkey') ||
    msg.includes('host fingerprint') ||
    rawCode === 'EHOSTKEY'
  ) {
    return 'EHOSTKEY'
  }
  if (
    rawCode === 'EAUTH' ||
    msg.includes('authentication') ||
    msg.includes('auth fail') ||
    msg.includes('permission denied (publickey') ||
    msg.includes('password') || // "All configured authentication methods failed" 류
    msg.includes('login') ||
    msg.includes('530') // FTP not logged in
  ) {
    return 'EAUTH'
  }
  if (rawCode === 'EACCES' || rawCode === 'EPERM' || msg.includes('550') /* FTP perm */) {
    return 'EACCES'
  }
  if (rawCode === 'ENOENT' || msg.includes('no such file') || msg.includes('not found')) {
    return 'ENOENT'
  }
  return 'EUNKNOWN'
}

/** 임의 throw 값 → RemoteError(코드+안전 메시지). path 는 원격 경로(비밀 아님)만. */
export function toRemoteError(e: unknown, code?: NormalizedCode, path?: string): RemoteError {
  const finalCode = code ?? classifyRemoteError(e)
  const base: RemoteError = {
    code: finalCode,
    message: SAFE_MESSAGES[finalCode] ?? SAFE_MESSAGES['EUNKNOWN']!
  }
  return { ...base, ...(path !== undefined ? { path } : {}) }
}

/** 코드로 직접 RemoteError 생성(안전 메시지). */
export function remoteError(code: NormalizedCode, path?: string): RemoteError {
  return {
    code,
    message: SAFE_MESSAGES[code] ?? SAFE_MESSAGES['EUNKNOWN']!,
    ...(path !== undefined ? { path } : {})
  }
}
