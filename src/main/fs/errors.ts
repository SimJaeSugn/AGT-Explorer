/**
 * node fs errno → FileOpError 매핑 (Main 전용).
 * 모든 fs 핸들러는 throw 대신 이 매핑으로 Result.err 를 만든다(ADR-003).
 */
import type { FileOpError } from '@shared/ipc/contracts'
import type { FileOpErrorCode } from '@shared/dto'

interface ErrnoLike {
  code?: string
  message?: string
  errno?: number
}

/** 알려진 errno 코드 → 도메인 코드. 미지의 코드는 EUNKNOWN. */
const ERRNO_MAP: Record<string, FileOpErrorCode> = {
  EEXIST: 'EEXIST',
  EINVAL: 'EINVAL',
  EACCES: 'EACCES',
  EPERM: 'EPERM',
  ENOENT: 'ENOENT',
  EBUSY: 'EBUSY',
  ENOTDIR: 'ENOTDIR',
  EISDIR: 'EISDIR',
  ELOOP: 'ELOOP',
  ENOSPC: 'ENOSPC'
}

/** 임의의 throw 값을 FileOpError 로 정규화한다. */
export function toFileOpError(e: unknown, path?: string): FileOpError {
  const errnoObj = (e ?? {}) as ErrnoLike
  const rawCode = typeof errnoObj.code === 'string' ? errnoObj.code : undefined
  const code: FileOpErrorCode = (rawCode && ERRNO_MAP[rawCode]) || 'EUNKNOWN'
  const message =
    typeof errnoObj.message === 'string' && errnoObj.message.length > 0
      ? errnoObj.message
      : '알 수 없는 파일 작업 오류'
  const base: FileOpError = { code, message }
  return {
    ...base,
    ...(path !== undefined ? { path } : {}),
    ...(rawCode !== undefined ? { cause: rawCode } : {})
  }
}

/** 도메인 코드로 직접 FileOpError 를 만든다(guard·검증 실패용). */
export function fileOpError(code: FileOpErrorCode, message: string, path?: string): FileOpError {
  return { code, message, ...(path !== undefined ? { path } : {}) }
}
