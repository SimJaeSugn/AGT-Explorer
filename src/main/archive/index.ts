/**
 * 압축(archive) 특권 디렉토리 배럴 — Main 단일 출처 (§Q1 M9 · ADR-008).
 *
 * `src/main/archive/` 는 ADR-008 의 **압축 라이브러리 화이트리스트 디렉토리**다(ESLint 예외 —
 * yauzl/yazl import 는 이 디렉토리 안에서만 허용). 상위 계층(ipc/archive.handlers.ts)은 본
 * 배럴이 노출하는 ArchiveSessionManager·ArchiveService·타입만 의존하고, 압축 라이브러리는 이
 * 디렉토리 안에 캡슐화된다(외부 import 금지 — lint 가드 · remote/ 모델 동형).
 */
import { ArchiveSessionManager } from './ArchiveSessionManager'
import { ArchiveService, type OpRegistrar } from './ArchiveService'

export { ArchiveSessionManager } from './ArchiveSessionManager'
export type { ZipOpener } from './ArchiveSessionManager'
export { ArchiveService } from './ArchiveService'
export type { OpRegistrar } from './ArchiveService'
export { openZip, forEachEntryForExtract } from './ZipReader'
export type { ZipHandle, RawZipEntry } from './ZipReader'
export { addToZip } from './ZipWriter'
export type { AddItem } from './ZipWriter'
export { archiveError, toArchiveError, classifyArchiveError } from './archiveErrors'

// ── 런타임 싱글턴(앱 부팅 시 초기화) ────────────────────────────────────
let _sessionManager: ArchiveSessionManager | null = null
let _service: ArchiveService | null = null

/** 세션 매니저 초기화(open/list/close). */
export function initArchiveSessionManager(): ArchiveSessionManager {
  _sessionManager = new ArchiveSessionManager()
  return _sessionManager
}

export function archiveSessionManager(): ArchiveSessionManager {
  if (!_sessionManager) {
    throw new Error('archiveSessionManager not initialized — call initArchiveSessionManager() first')
  }
  return _sessionManager
}

/** 추출/추가 서비스 초기화(op:* 재사용 — reg 는 OperationManager 주입). */
export function initArchiveService(reg: OpRegistrar): ArchiveService {
  _service = new ArchiveService(reg)
  return _service
}

export function archiveService(): ArchiveService {
  if (!_service) {
    throw new Error('archiveService not initialized — call initArchiveService() first')
  }
  return _service
}
