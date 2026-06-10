/**
 * 압축 엔트리 경로 안전 규칙 (shared/archive/safePath) — 순수 함수(단일 출처).
 *
 * §Q1(압축 어댑터 · ADR-008 결정④)의 **유일한 신규 보안 임계 표면**인 Zip Slip(경로
 * traversal) 차단 로직의 단일 구현체. 압축 엔트리명은 **악의적일 수 있는 외부 입력**으로
 * 취급한다(원격 응답 불신과 동일 정신 · ADR-007 ⑥).
 *
 * ⚠ **양쪽 계층이 공유**(ADR-008 결정④ "domain + Main 추출 워커 양쪽"):
 *   - Renderer 도메인: `renderer/domain/rules/archiveSafePath.ts` 가 본 모듈을 re-export.
 *   - Main 추출/추가 워커: `@shared/archive/safePath` 를 직접 import(이중 방어·단일 출처).
 *   본 모듈을 shared 에 두는 이유 — ESLint 경계상 main 은 renderer 를 import 할 수 없고,
 *   renderer/domain 은 node:* 를 쓸 수 없으므로, **node 비의존 순수 문자열 로직**으로 구현해
 *   양쪽이 같은 코드를 본다(domain/paths/index.ts 의 win32 직접 구현 정책과 동일).
 *
 * 추출 시 강제 규칙(ADR-008 결정④):
 *   1. 정규화 후 경계 검증 — 각 엔트리 도착 경로가 destDir 하위(prefix+구분자 경계)가
 *      아니면 거부(`../`·`..\`·절대경로·드라이브·UNC 탈출 차단).
 *   2. 드라이브/루트 프리픽스 제거 — 절대경로/드라이브 엔트리는 루트를 떼고 상대화.
 *   3. 심볼릭링크 엔트리 — 추출 시 추종/생성하지 않음(isSymlinkEntry).
 *   4. 파일명 새니타이즈 — 로컬 금지문자(`< > : " | ? *`)·예약명(CON…)·널바이트 안전 치환.
 *   5. 엔트리 수·총 해제 바이트·압축비 상한(zip bomb 완화 — ARCHIVE_CAPS).
 *   6. `.part` 임시 추출 후 완료 시 원자 rename(부분 추출 안전 — 워커가 구현).
 *
 * 부수효과 없음(fs/electron/network/node:path 비의존) → verify:archive 가 직접 호출해
 * 탈출 엔트리 거부 불변식을 헤드리스로 단언한다.
 *
 * 주의: 압축 엔트리명은 zip 명세상 POSIX 구분자(`/`)가 표준이나, 악성 입력은 win32 구분자
 * (`\`)·드라이브·UNC 를 섞을 수 있으므로 둘 다 분해/검증한다. 도착지 검증은 항상 win32 기준.
 */

/** 로컬(Windows) 파일명 금지문자: < > : " | ? * 와 제어문자(U+0000~U+001F). 전역 치환. */
// eslint-disable-next-line no-control-regex
const FORBIDDEN_LOCAL_NAME_CHARS_G = new RegExp('[<>:"|?*\\u0000-\\u001f]', 'g')

const RESERVED_LOCAL_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
])

/**
 * zip bomb 완화 기본 상한(ADR-008 결정④-5 · UQ-Q3 — 런타임 튜닝). 추출 워커가 초과 시 중단.
 *  - 엔트리 수: 100,000개.
 *  - 총 해제 바이트: 8 GiB.
 *  - 단일 엔트리 압축비: 1000:1 초과 의심(압축 1B → 1000B 이상)이면 폭탄 후보로 격리.
 */
export const ARCHIVE_CAPS = {
  maxEntries: 100_000,
  maxTotalUncompressedBytes: 8 * 1024 * 1024 * 1024,
  /** 단일 엔트리 압축비 상한(uncompressed/compressed). 초과 시 의심. */
  maxCompressionRatio: 1000
} as const

/** 추출 도착지 안전 결과. ok=false 면 호출부가 해당 엔트리를 격리(skip·실패 보고). */
export interface ArchiveSafePathResult {
  readonly ok: boolean
  /** 안전한 로컬 절대경로(ok=true). destDir 하위 보장. */
  readonly path: string
  /** 거부/격리 사유(ok=false). */
  readonly reason?: string
}

// ── win32 순수 경로 헬퍼(node:path 비의존) ───────────────────────────────

/** 구분자 통일: '/' → '\\'. */
function toWin(p: string): string {
  return p.replace(/\//g, '\\')
}

/**
 * win32 join 의 단순화: 절대 base(드라이브/UNC 루트) + 상대 세그먼트들. 세그먼트는 이미
 * 새니타이즈된 단일 이름이라 구분자가 없다. base 의 끝 '\\'는 정리한다.
 */
function joinWin(base: string, segs: readonly string[]): string {
  const root = toWin(base).replace(/\\+$/, '')
  if (segs.length === 0) return root
  return `${root}\\${segs.join('\\')}`
}

/**
 * candidate 가 destDir 하위(또는 destDir 자신)인지 검증한다(Zip Slip 경계 검증 · ADR-008 ④-1).
 * destDir·candidate 모두 win32 절대경로 전제. 대소문자 무시(Windows FS)·구분자 경계 강제.
 * node:path.resolve 없이 순수 비교(입력이 이미 절대경로 전제 — 도착지 검증용).
 */
export function isInsideDir(destDir: string, candidate: string): boolean {
  const dest = toWin(destDir).toLowerCase().replace(/[\\]+$/, '')
  const cand = toWin(candidate).toLowerCase().replace(/[\\]+$/, '')
  if (cand === dest) return true
  return cand.startsWith(dest + '\\')
}

/**
 * 압축 엔트리명을 **루트/드라이브/UNC 프리픽스를 제거한 상대 POSIX 경로**로 정규화한다
 * (ADR-008 결정④-2). 절대경로·드라이브 엔트리가 시스템 경로에 쓰이지 못하게 상대화한다.
 *  - win32/POSIX 구분자 혼용을 모두 `/` 로 통일.
 *  - 선행 `/`·드라이브(`C:`)·UNC(`\\server\share`) 프리픽스 제거.
 *  - 빈 세그먼트·`.` 제거. `..` 세그먼트는 보존(아래 safeExtractPath 가 경계 검증으로 거부).
 * 반환은 항상 상대 경로(루트 프리픽스 없음). 빈 결과면 빈 문자열.
 */
export function stripRootPrefix(entryName: string): string {
  let s = String(entryName).replace(/\\/g, '/')
  // 드라이브: C:/... 또는 C:... → /... 로 환원.
  s = s.replace(/^[A-Za-z]:/, '')
  // 선행 슬래시 모두 제거(절대경로·UNC 프리픽스 흡수).
  s = s.replace(/^\/+/, '')
  // 세그먼트 정리: 빈 세그먼트·`.` 제거(`..` 는 보존 — 경계 검증이 거부).
  const segs = s.split('/').filter((seg) => seg.length > 0 && seg !== '.')
  return segs.join('/')
}

/**
 * 단일 엔트리 세그먼트(파일/폴더명) 1개를 로컬 FS 안전 이름으로 새니타이즈한다
 * (ADR-008 결정④-4). 금지문자→`_`, 예약명→접두, 끝 공백/마침표 제거. `..`·`.` 은
 * 경로 의미라 여기 오지 않게 호출부가 분해한다(방어적으로 안전 기본명 반환).
 */
export function sanitizeSegment(segment: string): string {
  let base = String(segment).replace(FORBIDDEN_LOCAL_NAME_CHARS_G, '_')
  // 끝 공백/마침표 제거(Windows 비허용).
  base = base.replace(/[ .]+$/g, '')
  if (base.length === 0 || base === '.' || base === '..') return '_'
  const stem = base.split('.')[0]?.toUpperCase() ?? ''
  if (RESERVED_LOCAL_NAMES.has(stem)) return `_${base}`
  return base
}

/**
 * 압축 엔트리명(외부 입력)으로 **destDir 하위의 안전한 로컬 추출 경로**를 만든다
 * (ADR-008 결정④-1·2·4 통합). 절차:
 *  1) 루트/드라이브/UNC 프리픽스 제거 + 구분자 통일(stripRootPrefix).
 *  2) `..` 세그먼트가 있으면 거부(상대 탈출 차단 — 새니타이즈로 흡수하지 않음).
 *  3) 각 세그먼트 새니타이즈 후 destDir 와 join.
 *  4) 결과가 destDir 하위가 아니면 거부(이중 방어).
 * 빈 엔트리명·전부 `..` 등은 거부(ok=false). 디렉토리 엔트리(`name/`)도 동일 처리한다
 * (호출부가 isDirEntry 로 구분).
 */
export function safeExtractPath(destDir: string, entryName: string): ArchiveSafePathResult {
  const rel = stripRootPrefix(entryName)
  if (rel.length === 0) {
    return { ok: false, path: '', reason: '빈/루트 엔트리명' }
  }
  const segs = rel.split('/')
  // `..` 세그먼트가 하나라도 있으면 상대 탈출 시도 — 즉시 거부.
  if (segs.some((seg) => seg === '..')) {
    return { ok: false, path: '', reason: '상위 디렉토리 이탈(..)' }
  }
  const safeSegs = segs.map((seg) => sanitizeSegment(seg))
  const candidate = joinWin(destDir, safeSegs)
  if (!isInsideDir(destDir, candidate)) {
    return { ok: false, path: '', reason: '도착지 디렉토리 이탈' }
  }
  return { ok: true, path: candidate }
}

/**
 * zip 엔트리가 심볼릭링크인지 판정한다(ADR-008 결정④-3). zip 은 Unix 모드 비트를
 * externalFileAttributes 상위 16비트에 담는다. S_IFLNK(0xA000)이면 링크 → 추출 스킵.
 * @param externalFileAttributes yauzl Entry.externalFileAttributes
 */
export function isSymlinkEntry(externalFileAttributes: number): boolean {
  const unixMode = (externalFileAttributes >>> 16) & 0xffff
  const S_IFMT = 0o170000
  const S_IFLNK = 0o120000
  return (unixMode & S_IFMT) === S_IFLNK
}

/**
 * zip 엔트리가 디렉토리인지(이름이 `/` 또는 `\` 로 끝남 — zip 디렉토리 관례). yauzl 권장 판정.
 */
export function isDirEntry(entryName: string): boolean {
  return /[/\\]$/.test(entryName)
}

/**
 * 추가(add) 시 내부 경로(innerDir + 파일명)를 안전한 zip 엔트리명(POSIX)으로 만든다.
 * 추출의 역방향 — 사용자가 준 innerDir 도 불신해 루트 프리픽스 제거·`..` 거부·세그먼트
 * 새니타이즈한다(악성 innerDir 로 zip 내부에 경로 traversal 엔트리를 심지 못하게).
 * 반환은 항상 POSIX 구분자(`/`)·상대 경로. 거부 시 ok=false.
 */
export function safeArchiveEntryName(innerDir: string, fileName: string): ArchiveSafePathResult {
  const dir = stripRootPrefix(innerDir)
  const dirSegs = dir.length > 0 ? dir.split('/') : []
  const nameRel = stripRootPrefix(fileName)
  const nameSegs = nameRel.length > 0 ? nameRel.split('/') : []
  const all = [...dirSegs, ...nameSegs]
  if (all.length === 0) return { ok: false, path: '', reason: '빈 엔트리명' }
  if (all.some((seg) => seg === '..')) {
    return { ok: false, path: '', reason: '상위 디렉토리 이탈(..)' }
  }
  const safe = all.map((seg) => sanitizeSegment(seg))
  // zip 엔트리명은 POSIX 구분자.
  return { ok: true, path: safe.join('/') }
}

/**
 * 압축비 폭탄 후보 판정(ADR-008 결정④-5). compressedSize 가 0 이면(저장/디렉토리) false.
 * uncompressed/compressed 가 상한 초과면 true(추출 워커가 격리·중단 판단).
 */
export function isSuspiciousRatio(uncompressedSize: number, compressedSize: number): boolean {
  if (compressedSize <= 0) return false
  return uncompressedSize / compressedSize > ARCHIVE_CAPS.maxCompressionRatio
}
