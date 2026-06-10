/**
 * ArchiveSessionManager — 압축 세션 수명·격리 관리 (§Q1 M9 · ADR-008 결정①-세션모델).
 *
 * RemoteSessionManager 형태 모방(별도 네임스페이스 + sessionId 세션 모델):
 *  - open: zip 을 열어(ZipReader.openZip) 엔트리 테이블을 캐시하고 sessionId 를 발급한다.
 *    한 zip 안의 폴더 진입·뒤로/위로는 **같은 sessionId·innerPath 만 변경**(재오픈 없음).
 *    암호 zip(hasEncrypted)은 즉시 닫고 EUNSUPPORTED 안내(복호화 미구현 · 1차 제외).
 *  - list: 캐시된 엔트리 테이블에서 innerPath 디렉토리의 **직속 자식**만 FileEntryDTO 로 정규화.
 *  - close: 세션 핸들 정리(파일 디스크립터 해제 · 멱등). 패널 이탈/탭 닫기 시 호출.
 *  - closeAll: 앱 종료 시 전 세션 정리(누수 0).
 *
 * 추출/추가는 본 매니저가 아니라 ArchiveService(워커 오케스트레이션)가 archivePath 로 직접
 * 수행한다(워커가 zip 을 추출 전용으로 재오픈 — 세션 핸들 스레드 공유 회피). 본 매니저는
 * 세션→archivePath 매핑 + list 캐시만 책임진다. throw 0(모든 반환 Result).
 */
import { randomUUID } from 'node:crypto'
import type { FileEntryDTO } from '@shared/dto'
import type { Result } from '@shared/ipc/contracts'
import { err, ok } from '@shared/ipc/contracts'
import { makeArchivePath } from '@shared/archive/archivePath'
import { archiveError, toArchiveError } from './archiveErrors'
import { openZip, type RawZipEntry, type ZipHandle } from './ZipReader'

/** zip 열기 함수 주입(verify 가 스텁 대체 · 런타임은 openZip). */
export type ZipOpener = (archivePath: string) => Promise<ZipHandle>

interface ArchiveSession {
  readonly sessionId: string
  readonly archivePath: string
  readonly handle: ZipHandle
}

export class ArchiveSessionManager {
  private readonly sessions = new Map<string, ArchiveSession>()

  constructor(private readonly opener: ZipOpener = openZip) {}

  /**
   * zip 을 열어 세션을 발급한다. 손상/없음/권한은 Result.err, 암호 zip 은 EUNSUPPORTED.
   * @param archivePath 핸들러가 guardPath·로컬·실존 검증을 마친 zip 절대경로.
   */
  async open(archivePath: string): Promise<Result<{ sessionId: string }>> {
    let handle: ZipHandle
    try {
      handle = await this.opener(archivePath)
    } catch (e) {
      return err(toArchiveError(e, undefined, archivePath))
    }
    // 암호 zip(엔트리 암호화) 1차 제외 — 즉시 닫고 안내.
    if (handle.hasEncrypted) {
      await handle.close().catch(() => undefined)
      return err(archiveError('EUNSUPPORTED', archivePath))
    }
    const sessionId = randomUUID()
    this.sessions.set(sessionId, { sessionId, archivePath, handle })
    return ok({ sessionId })
  }

  /**
   * innerPath 디렉토리의 직속 자식 엔트리를 FileEntryDTO 로 정규화해 반환한다.
   *  - 직속 파일: 엔트리 그대로.
   *  - 직속 하위 폴더: zip 에 명시 디렉토리 엔트리가 없어도 하위 파일 경로에서 합성(set).
   *  path 필드는 표시·라우팅용 archive:// URI(makeArchivePath).
   */
  list(sessionId: string, innerPath: string): Result<{ entries: FileEntryDTO[] }> {
    const session = this.sessions.get(sessionId)
    if (!session) return err(archiveError('ENOENT', undefined, '유효하지 않은 압축 세션입니다.'))

    const prefix = normalizeInner(innerPath)
    const dirSet = new Map<string, { mtime: number }>() // 직속 하위 폴더명 → 메타
    const files: FileEntryDTO[] = []

    for (const entry of session.handle.entries) {
      const rel = entryRelativeTo(entry.entryName, prefix)
      if (rel === null) continue // 이 디렉토리 하위가 아님.
      const slash = rel.indexOf('/')
      if (slash < 0) {
        // 직속 항목.
        if (entry.isDir) {
          // 명시 디렉토리 엔트리(rel='name/'→ rel 끝 '/'는 entryRelativeTo 가 제거).
          if (rel.length > 0) dirSet.set(rel, { mtime: entry.mtime })
        } else {
          files.push(toFileEntry(session.archivePath, prefix, rel, entry, false))
        }
      } else {
        // 더 깊은 항목 → 직속 하위 폴더 합성.
        const dirName = rel.slice(0, slash)
        if (dirName.length > 0 && !dirSet.has(dirName)) {
          dirSet.set(dirName, { mtime: entry.mtime })
        }
      }
    }

    const dirEntries = [...dirSet.entries()].map(([name, meta]) =>
      toFileEntry(session.archivePath, prefix, name, null, true, meta.mtime)
    )
    return ok({ entries: [...dirEntries, ...files] })
  }

  /** 세션 종료(핸들 닫기 · 멱등). */
  async close(sessionId: string): Promise<Result<void>> {
    const session = this.sessions.get(sessionId)
    if (!session) return ok(undefined) // 멱등.
    this.sessions.delete(sessionId)
    await session.handle.close().catch(() => undefined)
    return ok(undefined)
  }

  /** 앱 종료 시 전 세션 정리. */
  async closeAll(): Promise<void> {
    const all = [...this.sessions.values()]
    this.sessions.clear()
    await Promise.all(all.map((s) => s.handle.close().catch(() => undefined)))
  }

  /** 세션의 zip 로컬 경로(추출/추가 워커 구동용 · 세션 검증 겸용). */
  getArchivePath(sessionId: string): string | null {
    return this.sessions.get(sessionId)?.archivePath ?? null
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }
}

// ── 순수 헬퍼 ──────────────────────────────────────────────────────────

/** innerPath 정규화(구분자 통일·선행/후행 '/' 제거). 루트면 ''. */
function normalizeInner(innerPath: string): string {
  return innerPath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
}

/**
 * 엔트리명이 prefix 디렉토리 하위면 prefix 를 떼고 상대 부분(후행 '/' 제거)을 반환, 아니면 null.
 * prefix='' 면 루트 — 모든 엔트리가 하위. 자기 자신(엔트리==prefix)은 null(목록에 자기 제외).
 */
function entryRelativeTo(entryName: string, prefix: string): string | null {
  const norm = entryName.replace(/\\/g, '/').replace(/\/+$/, '')
  if (prefix === '') return norm.length > 0 ? norm : null
  if (norm === prefix) return null
  if (norm.startsWith(prefix + '/')) {
    return norm.slice(prefix.length + 1)
  }
  return null
}

/** zip 엔트리(또는 합성 폴더) → FileEntryDTO. path 는 archive:// URI. */
function toFileEntry(
  archivePath: string,
  parentInner: string,
  name: string,
  entry: RawZipEntry | null,
  isDir: boolean,
  dirMtime = 0
): FileEntryDTO {
  const inner = parentInner === '' ? name : `${parentInner}/${name}`
  const ext = isDir ? '' : extOf(name)
  return {
    name,
    path: makeArchivePath(archivePath, inner),
    isDir,
    size: entry ? entry.uncompressedSize : 0,
    mtime: entry ? entry.mtime : dirMtime,
    ctime: entry ? entry.mtime : dirMtime,
    ext,
    attrs: { hidden: false, readonly: false, system: false, symlink: entry?.isSymlink ?? false }
  }
}

/** 파일명에서 소문자 확장자(선행 '.' 제외). 없으면 ''. */
function extOf(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return ''
  return name.slice(dot + 1).toLowerCase()
}
