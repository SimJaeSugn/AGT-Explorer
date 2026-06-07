/**
 * Windows 파일 속성(hidden/system/readonly) 매핑 (Main 전용, features F장).
 *
 * node:fs 의 Stats 만으로는 win32 의 hidden/system 비트를 직접 얻을 수 없다.
 * Electron(Chromium) 런타임의 V8/Node 빌드는 `fs.statSync` 결과에 표준 POSIX
 * 필드만 노출한다. 따라서 다음 전략을 쓴다:
 *
 *  1) readonly  → POSIX write 권한 비트(0o200)가 꺼져 있으면 readonly 로 간주.
 *  2) hidden    → (a) 선행 '.' 이름(유닉스 관습) 또는
 *                 (b) win32 FILE_ATTRIBUTE_HIDDEN. Node 내장 API 로는 (b)를
 *                     안정적으로 못 읽으므로, 사용 가능하면 win32 비트를,
 *                     아니면 이름 휴리스틱을 사용한다.
 *  3) system    → win32 FILE_ATTRIBUTE_SYSTEM. 못 읽으면 false.
 *
 * win32 비트 읽기는 선택적 네이티브 경로(향후 SPK 에서 네이티브 모듈/
 * PowerShell 대체 결정)로 격리해 둔다. P1 에서는 Node 표준 + 이름 휴리스틱
 * 폴백으로 동작하며, 인터페이스는 동결한다.
 */
import type { Stats } from 'node:fs'

// win32 FILE_ATTRIBUTE_* 상수(참조용).
const FILE_ATTRIBUTE_HIDDEN = 0x2
const FILE_ATTRIBUTE_SYSTEM = 0x4
const FILE_ATTRIBUTE_READONLY = 0x1
const FILE_ATTRIBUTE_REPARSE_POINT = 0x400

/**
 * Node Stats 에 (런타임에 따라) win32 속성 비트가 실린 경우 추출.
 * 표준 타입엔 없으므로 런타임 프로빙으로 안전 접근한다.
 */
function readWin32Bits(stats: Stats): number | null {
  // 일부 Node 빌드는 비표준으로 attributes 를 노출하지 않는다.
  const candidate = (stats as unknown as { attributes?: unknown }).attributes
  return typeof candidate === 'number' ? candidate : null
}

export interface ResolvedAttrs {
  hidden: boolean
  readonly: boolean
  system: boolean
  symlink: boolean
}

/**
 * Stats + 이름 + 심볼릭여부로 속성을 해소한다.
 * @param name 파일/폴더 이름(확장자 포함)
 * @param stats stat() 또는 lstat() 결과
 * @param isSymlink lstat 으로 판정한 링크 여부
 */
export function resolveAttributes(name: string, stats: Stats, isSymlink: boolean): ResolvedAttrs {
  const win32 = readWin32Bits(stats)

  // readonly: win32 비트 우선, 없으면 POSIX write 비트로 추정.
  const readonly =
    win32 !== null
      ? (win32 & FILE_ATTRIBUTE_READONLY) !== 0
      : (stats.mode & 0o200) === 0

  // hidden: win32 비트 우선, 없으면 선행 '.' 휴리스틱.
  const hidden =
    win32 !== null ? (win32 & FILE_ATTRIBUTE_HIDDEN) !== 0 : name.startsWith('.')

  // system: win32 비트만 신뢰. 없으면 false.
  const system = win32 !== null ? (win32 & FILE_ATTRIBUTE_SYSTEM) !== 0 : false

  // symlink: lstat 판정 우선, win32 reparse 비트 보조.
  const symlink = isSymlink || (win32 !== null && (win32 & FILE_ATTRIBUTE_REPARSE_POINT) !== 0)

  return { hidden, readonly, system, symlink }
}
