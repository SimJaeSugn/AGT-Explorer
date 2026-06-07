/**
 * 경로 유틸 (renderer/domain/paths) — 순수 TS, Windows 경로 규칙.
 *
 * Renderer 는 node:path 를 쓸 수 없으므로(.eslintrc) Windows(win32) 경로
 * 연산을 직접 구현한다. Main 의 normalizePath 와 의미가 일치하도록 유지한다.
 *
 * "내 PC"(드라이브 목록 루트)는 빈 문자열('')로 표현한다.
 */

/** "내 PC"(드라이브 루트 목록) 가상 경로. 빈 문자열로 약속. */
export const MY_PC_PATH = ''

/** "내 PC" 표시 라벨. */
export const MY_PC_LABEL = '내 PC'

/** 경로 구분자 정규화: '/' → '\\'. */
export function toBackslash(p: string): string {
  return p.replace(/\//g, '\\')
}

/** 드라이브 루트(예: "C:\\")인지. */
export function isDriveRoot(p: string): boolean {
  return /^[A-Za-z]:\\?$/.test(p)
}

/** "내 PC"(빈 경로)인지. */
export function isMyPc(p: string): boolean {
  return p === MY_PC_PATH
}

/**
 * 경로의 표시 이름(마지막 세그먼트). 드라이브 루트는 "C:\\", "내 PC"는 라벨.
 */
export function baseName(p: string): string {
  if (isMyPc(p)) return MY_PC_LABEL
  const norm = toBackslash(p).replace(/\\+$/, '')
  if (/^[A-Za-z]:$/.test(norm)) return norm + '\\'
  const idx = norm.lastIndexOf('\\')
  return idx >= 0 ? norm.slice(idx + 1) : norm
}

/**
 * 상위 폴더 경로. 드라이브 루트의 상위는 "내 PC"(''), "내 PC"의 상위는 null.
 * 일반 경로는 마지막 세그먼트를 제거한다.
 */
export function parentOf(p: string): string | null {
  if (isMyPc(p)) return null
  const norm = toBackslash(p).replace(/\\+$/, '')
  // UNC 루트(\\server\share)는 더 위로 올라가지 않음 → 내 PC.
  if (/^\\\\[^\\]+\\[^\\]+$/.test(norm)) return MY_PC_PATH
  if (/^[A-Za-z]:$/.test(norm)) return MY_PC_PATH // 드라이브 루트 상위 = 내 PC
  const idx = norm.lastIndexOf('\\')
  if (idx < 0) return MY_PC_PATH
  const parent = norm.slice(0, idx)
  // "C:" 만 남으면 드라이브 루트로 복원.
  if (/^[A-Za-z]:$/.test(parent)) return parent + '\\'
  if (parent.startsWith('\\\\')) return parent // UNC 중간
  return parent || MY_PC_PATH
}

/** 자식 경로 결합(win32 join 의 단순화). */
export function joinPath(parent: string, name: string): string {
  if (isMyPc(parent)) return name
  const norm = toBackslash(parent).replace(/\\+$/, '')
  return `${norm}\\${name}`
}

/**
 * 브레드크럼 세그먼트 목록. 각 항목은 { label, path }.
 * "내 PC" → 드라이브 → 하위 폴더 순으로 누적 경로를 만든다.
 */
export interface Crumb {
  readonly label: string
  readonly path: string
}

export function breadcrumbs(p: string): Crumb[] {
  const out: Crumb[] = [{ label: MY_PC_LABEL, path: MY_PC_PATH }]
  if (isMyPc(p)) return out

  const norm = toBackslash(p).replace(/\\+$/, '')

  // UNC: \\server\share\a\b
  if (norm.startsWith('\\\\')) {
    const rest = norm.slice(2)
    const segs = rest.split('\\').filter(Boolean)
    if (segs.length >= 2) {
      const shareRoot = `\\\\${segs[0]}\\${segs[1]}`
      out.push({ label: shareRoot, path: shareRoot })
      let acc = shareRoot
      for (let i = 2; i < segs.length; i++) {
        acc = `${acc}\\${segs[i]}`
        out.push({ label: segs[i] as string, path: acc })
      }
    }
    return out
  }

  // 드라이브 경로: C:\a\b
  const m = /^([A-Za-z]:)(\\.*)?$/.exec(norm)
  if (m) {
    const drive = m[1] as string
    const driveRoot = drive + '\\'
    out.push({ label: driveRoot, path: driveRoot })
    const tail = m[2] ? m[2].replace(/^\\/, '') : ''
    if (tail) {
      let acc = driveRoot
      for (const seg of tail.split('\\').filter(Boolean)) {
        acc = acc.endsWith('\\') ? `${acc}${seg}` : `${acc}\\${seg}`
        out.push({ label: seg, path: acc })
      }
    }
  }
  return out
}

/** 표시용 정규화(끝 슬래시 정리, 드라이브 루트 보존). 비교/저장용 키. */
export function normalizeDisplay(p: string): string {
  if (isMyPc(p)) return MY_PC_PATH
  const b = toBackslash(p.trim())
  if (/^[A-Za-z]:\\?$/.test(b)) return b.replace(/\\?$/, '\\') // "C:" → "C:\"
  return b.replace(/\\+$/, '')
}
