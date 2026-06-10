/**
 * 압축(archive) 오류 정규화 (§Q1 M9 · ADR-008).
 *
 * yauzl/yazl·zlib throw 값·errno·메시지를 `FileOpError`(code 유니온) 로 정규화한다.
 * remoteErrors.ts 동형 — 순수 함수만(네트워크/electron 비의존) → verify:archive 가 직접 호출.
 *
 * 암호 zip(엔트리 isEncrypted)·미지원 포맷은 EUNSUPPORTED(안내 메시지)로 분류한다
 * (ADR-008 결정②-암호 zip 1차 제외). 그 외는 errno 매핑 또는 EUNKNOWN.
 */
import type { FileOpError } from '@shared/ipc/contracts'
import type { FileOpErrorCode } from '@shared/dto'

interface ErrnoLike {
  code?: string
  message?: string
}

/** 코드별 안전 메시지(사용자 노출 문구). */
const SAFE_MESSAGES: Partial<Record<FileOpErrorCode, string>> = {
  EUNSUPPORTED: '지원하지 않는 압축 파일입니다(암호 보호 또는 비 zip 형식).',
  EACCES: '압축 파일에 접근할 권한이 없습니다.',
  ENOENT: '압축 파일을 찾을 수 없습니다.',
  EINVAL: '손상되었거나 올바르지 않은 압축 파일입니다.',
  ESECURITY: '안전하지 않은 경로의 항목을 건너뛰었습니다.',
  ENOSPC: '디스크 공간이 부족합니다.',
  EUNKNOWN: '압축 작업 중 오류가 발생했습니다.'
}

const ERRNO_MAP: Record<string, FileOpErrorCode> = {
  EACCES: 'EACCES',
  EPERM: 'EPERM',
  ENOENT: 'ENOENT',
  EEXIST: 'EEXIST',
  EISDIR: 'EISDIR',
  ENOTDIR: 'ENOTDIR',
  ENOSPC: 'ENOSPC',
  EBUSY: 'EBUSY'
}

/** 임의 throw 값 → 압축 오류 코드. zip 손상·암호 신호를 분류한다. */
export function classifyArchiveError(e: unknown): FileOpErrorCode {
  const o = (e ?? {}) as ErrnoLike
  const rawCode = typeof o.code === 'string' ? o.code : ''
  const msg = typeof o.message === 'string' ? o.message.toLowerCase() : ''

  if (rawCode && ERRNO_MAP[rawCode]) return ERRNO_MAP[rawCode] as FileOpErrorCode
  if (
    msg.includes('encrypt') ||
    msg.includes('password') ||
    msg.includes('not supported') ||
    msg.includes('unsupported')
  ) {
    return 'EUNSUPPORTED'
  }
  if (
    msg.includes('end of central directory') ||
    msg.includes('invalid') ||
    msg.includes('corrupt') ||
    msg.includes('not a zip') ||
    msg.includes('signature')
  ) {
    return 'EINVAL'
  }
  return 'EUNKNOWN'
}

/** 코드로 직접 FileOpError 생성(안전 메시지). path 는 zip/엔트리 경로(비밀 아님). */
export function archiveError(code: FileOpErrorCode, path?: string, message?: string): FileOpError {
  return {
    code,
    message: message ?? SAFE_MESSAGES[code] ?? SAFE_MESSAGES['EUNKNOWN']!,
    ...(path !== undefined ? { path } : {})
  }
}

/** 임의 throw 값 → FileOpError(코드+안전 메시지). */
export function toArchiveError(e: unknown, code?: FileOpErrorCode, path?: string): FileOpError {
  const finalCode = code ?? classifyArchiveError(e)
  return archiveError(finalCode, path)
}
