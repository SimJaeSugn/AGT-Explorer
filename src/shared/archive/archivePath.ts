/**
 * 압축 URI(archive://) 구성·분해 순수 함수 (shared/archive/archivePath) — 단일 출처.
 *
 * §Q1(ADR-008 결정①): zip 내부 위치를 `archive://<archivePath>!/<innerPath>` URI 로 인코딩해
 * 로컬(`C:\...`)·원격(`sftp://...`)과 한 string 필드(`Panel.path`)에서 구분한다.
 *   - `archivePath` : zip 파일의 로컬 절대경로(예: `C:\d\a.zip`).
 *   - `!`           : zip 경계 구분자(관례 — `path/to.zip!/inner/file`).
 *   - `innerPath`   : zip 내부 POSIX 상대경로(루트면 빈 문자열).
 *
 * ⚠ Renderer(domain/rules/archiveLocation)·Main(ArchiveSessionManager) 양쪽이 공유한다 —
 *   ESLint 경계상 main 은 renderer 를 import 할 수 없으므로 shared 에 둔다(safePath.ts 동일 정책).
 * 부수효과 없음(순수 TS · node 비의존).
 */

/** archive URI 스킴 prefix. */
export const ARCHIVE_SCHEME = 'archive://'

/** zip 경계 구분자(zip 절대경로와 내부경로 사이 — ADR-008 관례). */
export const ARCHIVE_BOUNDARY = '!/'

/** 압축 위치 분해 결과(archivePath·innerPath — sessionId 는 런타임 세션 맵에서 별도 보유). */
export interface ArchiveLocation {
  /** zip 파일의 로컬 절대경로(예: 'C:\\d\\a.zip'). */
  readonly archivePath: string
  /** zip 내부 POSIX 상대경로(루트면 ''). 항상 선행 '/' 없음. */
  readonly innerPath: string
}

/** 경로가 압축 URI(archive://...)인가. */
export function isArchivePath(path: string): boolean {
  return path.startsWith(ARCHIVE_SCHEME)
}

/**
 * 압축 URI 를 구성한다. innerPath 는 POSIX 상대경로(선행/후행 '/' 정리).
 * 예: makeArchivePath('C:\\d\\a.zip', 'sub/x.txt') → 'archive://C:\\d\\a.zip!/sub/x.txt'
 *     루트는 'archive://C:\\d\\a.zip!/'.
 */
export function makeArchivePath(archivePath: string, innerPath: string): string {
  const inner = innerPath.replace(/^\/+/, '').replace(/\/+$/, '')
  return `${ARCHIVE_SCHEME}${archivePath}${ARCHIVE_BOUNDARY}${inner}`
}

/**
 * 압축 URI 를 archivePath/innerPath 로 분해한다. 비압축이면 null.
 * 방어적: 스킴·경계('!/') 존재 확인. innerPath 는 POSIX 상대(선행 '/' 제거).
 */
export function parseArchivePath(path: string): ArchiveLocation | null {
  if (!path.startsWith(ARCHIVE_SCHEME)) return null
  const rest = path.slice(ARCHIVE_SCHEME.length)
  const bIdx = rest.indexOf(ARCHIVE_BOUNDARY)
  if (bIdx < 0) {
    // 경계 없음 — zip 루트로 간주(archive://C:\a.zip 형태).
    const archivePath = rest
    if (archivePath === '') return null
    return { archivePath, innerPath: '' }
  }
  const archivePath = rest.slice(0, bIdx)
  if (archivePath === '') return null
  const inner = rest.slice(bIdx + ARCHIVE_BOUNDARY.length).replace(/^\/+/, '')
  return { archivePath, innerPath: inner }
}

/** 압축 내부 자식 경로 결합(POSIX). parent='sub', name='x' → 'sub/x'. 루트('') 처리. */
export function joinInnerPath(parentInnerPath: string, name: string): string {
  const base = parentInnerPath.replace(/\/+$/, '')
  return base === '' ? name : `${base}/${name}`
}

/** 압축 내부 상위 경로(POSIX). 'a/b' → 'a', 'a' → '', '' → ''. */
export function innerParentOf(innerPath: string): string {
  const norm = innerPath.replace(/\/+$/, '')
  if (norm === '') return ''
  const idx = norm.lastIndexOf('/')
  if (idx < 0) return ''
  return norm.slice(0, idx)
}
