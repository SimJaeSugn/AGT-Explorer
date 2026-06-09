/**
 * 듀얼 패널 폴더 비교 규칙 (renderer/domain/rules/compare) — 순수 TS, 부수효과 0.
 *
 * §P1·US-15.1·F20·ADR-009. **M6 스코프: 단일 깊이 메타 비교만**(이름·크기·수정일).
 * 해시(내용) 비교·재귀 하위폴더 비교는 **M7**(ADR-009 `hash:compare:*`)로 연기한다.
 *
 * 좌/우 두 패널의 이미 로드된 `directory.entries` 를 **이름 기준으로 짝지어**
 * 항목별 4상태로 분류한다:
 *   - left-only  : 좌측에만 존재
 *   - right-only : 우측에만 존재
 *   - diff       : 양쪽 존재하나 메타(크기/수정일/종류)가 다름
 *   - same       : 양쪽 존재하고 메타 동일
 *
 * 짝지음 키는 **이름**(기본 대소문자 무시 — Windows 파일시스템). 폴더 vs 파일
 * 동명 충돌도 'diff' 로 본다. 결과는 동기 스크롤·미러 산출의 단일 출처가 된다.
 *
 * 경계 규칙(.eslintrc): domain 은 react/zustand/infra/shared-ipc import 금지.
 * shared/dto 타입 전용 import만 허용. throw 금지(ADR-003) — 손상 입력은 안전 폴백.
 */
import type { ComparePairDTO, CompareStatus, FileEntryDTO } from '@shared/dto'

export type { CompareStatus }

/** 한 이름에 대한 좌/우 짝지음 + 분류 결과. */
export interface ComparePair {
  /** 짝지음 키(원본 이름·좌 우선·없으면 우). 표시·정렬용. */
  readonly name: string
  /** 매칭 정규화 키(대소문자/공백 처리 후). 동기 스크롤·중복 판정 내부용. */
  readonly key: string
  /** 좌측 항목(없으면 null = right-only). */
  readonly left: FileEntryDTO | null
  /** 우측 항목(없으면 null = left-only). */
  readonly right: FileEntryDTO | null
  /** 4상태 분류. */
  readonly status: CompareStatus
  /**
   * 재귀 비교(P1·recursive=true) 시 좌/우 루트 기준 상대경로(예: "sub\\a.txt").
   * 단일깊이 메타 비교는 undefined(이름이 곧 상대경로) — 표시 들여쓰기·깊이 산출에 쓰인다.
   */
  readonly relPath?: string
}

/** 비교 기준 옵션(메타 비교 + M7 해시/재귀 옵션). */
export interface CompareOptions {
  /** 크기 비교(기본 true). */
  readonly bySize: boolean
  /** 수정일 비교(기본 true). */
  readonly byMtime: boolean
  /** 수정일 허용 오차(ms). 파일시스템 정밀도 차이 흡수. 기본 2000. */
  readonly mtimeToleranceMs?: number
  /** 이름 매칭 대소문자 구분(기본 false = Windows). */
  readonly caseSensitive?: boolean
  /**
   * 내용(해시) 비교(§P1·M7·ADR-009). 켜면 같은 이름·같은 크기 항목을 백엔드
   * hash:compare 잡이 SHA-256 으로 비교해 same/diff 를 확정한다(렌더러 메타 경로 우회).
   * 기본 false = M6 메타 비교(채널 0). 이 옵션의 적용은 usecases/compare 가 분기한다
   * (이 순수 모듈의 compareEntries 는 항상 메타 경로 — 동치 보존).
   */
  readonly useHash?: boolean
  /**
   * 재귀 하위폴더 비교(§P1·M7). 켜면 양쪽 동명 디렉토리를 재귀 진입해 relPath 누적
   * (백엔드 hash:compare 잡). 기본 false = 단일 깊이(M6). 적용 분기는 usecases/compare.
   */
  readonly recursive?: boolean
}

/** 4상태 카운트 요약(상태바·툴바·미러 미리보기 보조). */
export interface CompareSummary {
  readonly leftOnly: number
  readonly rightOnly: number
  readonly diff: number
  readonly same: number
  readonly total: number
}

/** 기본 옵션(메타 비교·대소문자 무시·2초 허용오차·해시/재귀 off = M6 동치). */
export const DEFAULT_COMPARE_OPTIONS: CompareOptions = {
  bySize: true,
  byMtime: true,
  mtimeToleranceMs: 2000,
  caseSensitive: false,
  useHash: false,
  recursive: false
}

/** 짝지음 키 산출(대소문자 옵션 반영·앞뒤 공백 정규화). */
function matchKey(name: string, caseSensitive: boolean): string {
  const trimmed = name.trim()
  return caseSensitive ? trimmed : trimmed.toLowerCase()
}

/**
 * 양쪽 존재 항목의 메타 차이 판정 → 'diff' 면 true, 'same' 이면 false.
 * 종류(폴더 vs 파일) 다르면 무조건 diff. 폴더는 크기 비교 제외(집계 0/미정).
 */
function isDifferent(left: FileEntryDTO, right: FileEntryDTO, opts: CompareOptions): boolean {
  // 종류 충돌(동명 폴더 vs 파일)은 항상 다름.
  if (left.isDir !== right.isDir) return true
  // 폴더끼리는 메타(크기 0·수정일)가 신뢰도 낮으므로 same 으로 본다(단일 깊이 메타 비교).
  // 내부 차이 유무는 M7 재귀/해시 비교 영역(은폐 금지 — 1차는 존재 동일=same).
  if (left.isDir && right.isDir) return false
  const tol = opts.mtimeToleranceMs ?? 0
  if (opts.bySize && left.size !== right.size) return true
  if (opts.byMtime && Math.abs(left.mtime - right.mtime) > tol) return true
  return false
}

/**
 * 좌/우 entries → 이름으로 짝지어 4상태 분류한 페어 목록.
 *
 * 정렬: 이름(매칭 키) 기준 안정 정렬 → **좌/우 입력 순서와 무관하게 같은 결과**
 * (정렬무관 키매칭). 같은 키 다중(대소문자만 다른 동명)은 입력 순서로 누적.
 */
export function compareEntries(
  left: readonly FileEntryDTO[],
  right: readonly FileEntryDTO[],
  opts: CompareOptions = DEFAULT_COMPARE_OPTIONS
): ComparePair[] {
  const caseSensitive = opts.caseSensitive ?? false
  // 이름 키 → 좌/우 항목. 중복 키(드묾)는 첫 항목만 짝지음(나머지는 left/right-only 로 별도 키 처리 회피·1차 단순).
  const leftMap = new Map<string, FileEntryDTO>()
  const rightMap = new Map<string, FileEntryDTO>()
  for (const e of left) {
    const k = matchKey(e.name, caseSensitive)
    if (!leftMap.has(k)) leftMap.set(k, e)
  }
  for (const e of right) {
    const k = matchKey(e.name, caseSensitive)
    if (!rightMap.has(k)) rightMap.set(k, e)
  }

  // 키 합집합(정렬해 결정성 확보 — 좌/우 입력 순서 무관).
  const keys = new Set<string>()
  for (const k of leftMap.keys()) keys.add(k)
  for (const k of rightMap.keys()) keys.add(k)
  const sortedKeys = [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

  const pairs: ComparePair[] = []
  for (const key of sortedKeys) {
    const l = leftMap.get(key) ?? null
    const r = rightMap.get(key) ?? null
    let status: CompareStatus
    if (l && !r) status = 'left-only'
    else if (!l && r) status = 'right-only'
    else if (l && r) status = isDifferent(l, r, opts) ? 'diff' : 'same'
    else continue // 도달 불가(키는 한쪽 이상 존재)
    pairs.push({ name: l?.name ?? r?.name ?? key, key, left: l, right: r, status })
  }
  return pairs
}

/**
 * 백엔드 hash:compare 결과(ComparePairDTO[]·해시/재귀)를 렌더러 ComparePair[] 로 환산(순수).
 *
 * P1 해시/재귀 옵션 on 일 때 사용한다(off 면 compareEntries 메타 경로 그대로 — 동치 보존).
 * 짝지음 키는 relPath(재귀·있으면) 또는 name(단일깊이)을 caseSensitive 옵션으로 정규화한다.
 * 분류 status 는 백엔드 compareEngine 이 이미 확정한 값을 그대로 신뢰한다(드리프트 방지 —
 * verify 로 메타 경로와 동치 고정). DTO 는 key 가 없으므로 여기서 매칭 키를 채운다.
 */
export function fromCompareResult(
  pairs: readonly ComparePairDTO[],
  opts: CompareOptions = DEFAULT_COMPARE_OPTIONS
): ComparePair[] {
  const caseSensitive = opts.caseSensitive ?? false
  const out: ComparePair[] = []
  for (const p of pairs) {
    const keyBase = p.relPath ?? p.name
    out.push({
      name: p.name,
      key: matchKey(keyBase, caseSensitive),
      left: p.left,
      right: p.right,
      status: p.status,
      ...(p.relPath !== undefined ? { relPath: p.relPath } : {})
    })
  }
  return out
}

/** 페어 목록 → 4상태 카운트 요약(합 = total). */
export function summarize(pairs: readonly ComparePair[]): CompareSummary {
  let leftOnly = 0
  let rightOnly = 0
  let diff = 0
  let same = 0
  for (const p of pairs) {
    if (p.status === 'left-only') leftOnly++
    else if (p.status === 'right-only') rightOnly++
    else if (p.status === 'diff') diff++
    else same++
  }
  return { leftOnly, rightOnly, diff, same, total: pairs.length }
}

/** "차이만 보기" 필터: same 을 제외한 페어만(left-only/right-only/diff). */
export function diffOnlyPairs(pairs: readonly ComparePair[]): ComparePair[] {
  return pairs.filter((p) => p.status !== 'same')
}

/**
 * 미러 계획 — 한쪽(source)을 다른쪽(dest)에 맞추기 위해 **복사할 항목**과
 * (선택 시) **삭제할 항목**을 산출한다(파괴 전 미리보기·확인용).
 *
 * 방향 'l2r' = 좌→우(좌 기준으로 우를 맞춤): 좌만 있음 + 다름 = 우로 복사,
 * 우만 있음 = (삭제 동기화 켜면) 우에서 삭제 대상.
 * 'r2l' 은 좌우 반대.
 *
 * **순수 산출만** — 실제 fs 변경은 usecase 가 op:* 로 수행(휴지통·undo).
 */
export type MirrorDirection = 'l2r' | 'r2l'

export interface MirrorPlan {
  readonly direction: MirrorDirection
  /** 복사할 항목(source 측 절대경로). 없는 것 + 다른 것. */
  readonly copyPaths: string[]
  /** 덮어쓰기가 되는 항목 수(다름·dest 에 동명 존재 → 충돌). 안내용. */
  readonly overwriteCount: number
  /** 삭제 동기화 대상(dest 측 절대경로). includeDeletes=false 면 항상 빈 배열. */
  readonly deletePaths: string[]
  /** 복사 대상 폴더(dest 패널 경로). */
  readonly destDir: string
}

/**
 * 미러 계획 산출(순수). includeDeletes=true 면 "기준에 없는 dest 항목"을 삭제 대상에 포함.
 * @param pairs compareEntries 결과
 * @param direction 미러 방향
 * @param destDir 대상(복사가 들어갈) 패널 폴더 경로
 * @param includeDeletes 삭제 동기화 포함 여부(기본 false = 안전한 복사 미러)
 */
export function planMirror(
  pairs: readonly ComparePair[],
  direction: MirrorDirection,
  destDir: string,
  includeDeletes = false
): MirrorPlan {
  const l2r = direction === 'l2r'
  const copyPaths: string[] = []
  const deletePaths: string[] = []
  let overwriteCount = 0
  for (const p of pairs) {
    const source = l2r ? p.left : p.right
    const target = l2r ? p.right : p.left
    if (p.status === 'same') continue
    if (source) {
      // source-only(없는 것) 또는 diff(다른 것) → 복사.
      if (!target || p.status === 'diff') {
        copyPaths.push(source.path)
        if (target) overwriteCount++
      }
    } else if (target && includeDeletes) {
      // source 에 없고 dest(target)에만 있음 → 삭제 동기화 대상(휴지통 경유).
      deletePaths.push(target.path)
    }
  }
  return { direction, copyPaths, overwriteCount, deletePaths, destDir }
}
