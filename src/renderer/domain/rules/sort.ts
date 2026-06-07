/**
 * 정렬 규칙 (renderer/domain/rules/sort) — 순수 함수, 부수효과 없음.
 *
 * - 자연 정렬(natural sort): "file2" < "file10" (숫자 구간을 수치로 비교).
 * - 폴더 우선(folderFirst): 디렉토리를 파일보다 항상 위로.
 * - 정렬 키: name/size/ext/mtime, 방향 asc/desc.
 *
 * SA §3.2(정렬·폴더우선), ADR-004(파생 메모이즈). UI/스토어가 이 함수를 호출한다.
 */
import type { FileEntryDTO, SortDir, SortKey } from '@shared/dto'

/** 자연 정렬 비교(대소문자 무시, 숫자 구간 수치 비교). */
export function naturalCompare(a: string, b: string): number {
  const re = /(\d+)|(\D+)/g
  const ax = a.toLowerCase().match(re) ?? []
  const bx = b.toLowerCase().match(re) ?? []
  const len = Math.min(ax.length, bx.length)
  for (let i = 0; i < len; i++) {
    const as = ax[i] as string
    const bs = bx[i] as string
    const an = Number(as)
    const bn = Number(bs)
    const aIsNum = !Number.isNaN(an) && /^\d/.test(as)
    const bIsNum = !Number.isNaN(bn) && /^\d/.test(bs)
    if (aIsNum && bIsNum) {
      if (an !== bn) return an - bn
    } else {
      const c = as.localeCompare(bs)
      if (c !== 0) return c
    }
  }
  return ax.length - bx.length
}

/** 단일 키 비교(방향 미적용 — asc 기준). */
function compareByKey(a: FileEntryDTO, b: FileEntryDTO, key: SortKey): number {
  switch (key) {
    case 'name':
      return naturalCompare(a.name, b.name)
    case 'size':
      return a.size - b.size
    case 'mtime':
      return a.mtime - b.mtime
    case 'ext': {
      const c = naturalCompare(a.ext, b.ext)
      return c !== 0 ? c : naturalCompare(a.name, b.name)
    }
    default:
      return 0
  }
}

/**
 * 엔트리 배열을 정렬한 **새 배열**을 반환한다(원본 불변).
 * 메모이즈 셀렉터에서 호출 → 입력이 같으면 재계산하지 않는다(호출부 책임).
 */
export function sortEntries(
  entries: readonly FileEntryDTO[],
  key: SortKey,
  dir: SortDir,
  folderFirst: boolean
): FileEntryDTO[] {
  const sign = dir === 'asc' ? 1 : -1
  const copy = entries.slice()
  copy.sort((a, b) => {
    if (folderFirst && a.isDir !== b.isDir) {
      // 폴더 우선은 방향과 무관하게 항상 폴더가 위.
      return a.isDir ? -1 : 1
    }
    let c = compareByKey(a, b, key)
    if (c === 0 && key !== 'name') c = naturalCompare(a.name, b.name)
    return c * sign
  })
  return copy
}
