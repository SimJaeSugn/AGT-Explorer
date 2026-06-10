/**
 * 브레드크럼 드롭다운 형상화 (renderer/domain/rules) — 순수 TS (U2).
 *
 * 한 브레드크럼 세그먼트의 ▾ 를 열면 그 세그먼트의 "자식 폴더" 목록(= 다음
 * 세그먼트의 형제들)을 fs:tree-children 으로 받아온다. 이 모듈은 그 결과를
 * 드롭다운 표시용으로 형상화한다:
 *  - 폴더만 통과(트리 핸들러가 이미 폴더만 주지만 2중 방어).
 *  - 자연 정렬(naturalCompare — 목록 정렬과 동일 규칙으로 사용자 기대 일치).
 *  - 사용자가 실제로 들어온 자식(currentChildPath)을 current=true 로 표식.
 *
 * 경로 비교는 대소문자 무시(Windows FS 의미) + 끝 슬래시 정규화로 한다.
 */
import type { FileEntryDTO } from '@shared/dto'
import { naturalCompare } from './sort'

/** 드롭다운 한 행. */
export interface BreadcrumbSibling {
  /** 표시 이름(폴더명). */
  readonly name: string
  /** 이동 대상 절대 경로. */
  readonly path: string
  /** 사용자가 현재 경로에서 실제로 거쳐 들어온 자식인지(체크 표식·초기 포커스). */
  readonly current: boolean
}

/** 경로 비교 키: 끝 슬래시 제거 + 소문자(Windows 대소문자 무시). */
function pathKey(p: string): string {
  return p.replace(/[\\/]+$/, '').toLowerCase()
}

/**
 * tree-children 결과를 드롭다운 행 목록으로 형상화한다.
 * @param entries fs:tree-children 응답(폴더 목록).
 * @param currentChildPath 현재 경로에서 이 세그먼트 다음에 거쳐온 자식 경로(없으면 null).
 */
export function shapeBreadcrumbSiblings(
  entries: readonly FileEntryDTO[],
  currentChildPath: string | null
): BreadcrumbSibling[] {
  const curKey = currentChildPath ? pathKey(currentChildPath) : null
  return entries
    .filter((e) => e.isDir)
    .map((e) => ({
      name: e.name,
      path: e.path,
      current: curKey !== null && pathKey(e.path) === curKey
    }))
    .sort((a, b) => naturalCompare(a.name, b.name))
}
