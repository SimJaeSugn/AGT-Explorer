/**
 * 중복 파일 그룹 보조 규칙 (renderer/domain/rules/dupGroup) — 순수 TS, 부수효과 0.
 *
 * §R2·US-17.2·F23·ADR-009. 백엔드 `hash:dup:*` 가 산출한 DupGroupDTO[](내용 동일
 * 파일 묶음)에 대해 **표시 정렬·"원본 1개 보존" 선택 보조·전체삭제 경고 판정**을
 * 순수 함수로 격리한다. 파괴적 정리(휴지통 삭제)는 usecase 가 수행하고, 이 모듈은
 * "어떤 파일을 지울지" 후보 산출과 안전 가드(보존 0 경고)만 책임진다.
 *
 * 핵심 안전 원칙(데이터 안전):
 *  - selectAllButOne 은 그룹마다 **정확히 1개를 보존**(가장 오래된 mtime = 원본 추정).
 *    같은 mtime 이면 path 사전순 첫 항목을 보존(결정론). 보존 대상은 절대 선택하지 않는다.
 *  - hasFullSelection 은 한 그룹의 모든 파일이 선택된 위험 상태(보존 0)를 감지한다.
 *    usecase 가 이를 경고/차단에 쓴다(전부 삭제 = 데이터 손실 방지).
 *
 * 경계 규칙(.eslintrc): domain 은 react/zustand/infra/shared-ipc import 금지.
 * shared/dto 타입 전용 import만 허용. throw 금지(ADR-003) — 손상 입력은 안전 폴백.
 */
import type { DupGroupDTO, DupFileDTO } from '@shared/dto'

/**
 * 그룹의 "보존 후보" 1개를 결정(가장 오래된 mtime → 동률이면 path 사전순 첫 항목).
 * 빈 그룹/파일 없음이면 null(안전 폴백). 이 path 는 selectAllButOne 에서 선택 제외된다.
 */
export function keepCandidate(group: DupGroupDTO): string | null {
  const files = group?.files
  if (!Array.isArray(files) || files.length === 0) return null
  let best: DupFileDTO = files[0] as DupFileDTO
  for (const f of files) {
    if (!f) continue
    const fm = Number.isFinite(f.mtime) ? f.mtime : Number.MAX_SAFE_INTEGER
    const bm = Number.isFinite(best.mtime) ? best.mtime : Number.MAX_SAFE_INTEGER
    if (fm < bm || (fm === bm && f.path < best.path)) best = f
  }
  return best.path
}

/**
 * 한 그룹에서 "원본 1개(가장 오래된 것) 외 나머지" 경로를 선택 후보로 반환.
 * 보존 대상은 제외 → 결과는 그룹 파일수-1 개(중복만 삭제·원본 보존). 그룹이 2개 미만이면 빈 배열.
 */
export function selectAllButOne(group: DupGroupDTO): string[] {
  const files = group?.files
  if (!Array.isArray(files) || files.length < 2) return []
  const keep = keepCandidate(group)
  return files
    .filter((f): f is DupFileDTO => !!f)
    .map((f) => f.path)
    .filter((p) => p !== keep)
}

/**
 * 모든 그룹에 대해 "원본 1개 보존" 선택 집합을 합산(정리 기본 추천 선택).
 * 그룹별 selectAllButOne 의 합집합. usecase 가 dedupSlice 초기 선택 채우기에 쓴다.
 */
export function selectAllButOneForAll(groups: readonly DupGroupDTO[]): string[] {
  const out: string[] = []
  for (const g of groups) out.push(...selectAllButOne(g))
  return out
}

/**
 * 한 그룹의 모든 파일이 선택되었는지(보존 0 = 전부 삭제 위험). 빈 그룹은 false.
 * @param group 대상 그룹
 * @param selected 현재 선택된 경로 집합
 */
export function hasFullSelection(group: DupGroupDTO, selected: ReadonlySet<string>): boolean {
  const files = group?.files
  if (!Array.isArray(files) || files.length === 0) return false
  return files.every((f) => !!f && selected.has(f.path))
}

/**
 * 선택 집합 중 "그룹 전부 선택(보존 0)" 인 그룹이 하나라도 있으면 true.
 * usecase 가 정리 확인 모달에서 데이터 손실 경고를 띄울지 판정한다.
 */
export function anyFullySelected(
  groups: readonly DupGroupDTO[],
  selected: ReadonlySet<string>
): boolean {
  return groups.some((g) => hasFullSelection(g, selected))
}

/**
 * 그룹별 "회수 가능 용량"(= (파일수-1) × size, 원본 1개 보존 가정) 내림차순 정렬.
 * 동률이면 파일수 많은 그룹 우선. 원본 배열 비파괴(복사 후 정렬).
 */
export function sortGroupsByWaste(groups: readonly DupGroupDTO[]): DupGroupDTO[] {
  return [...groups].sort((a, b) => {
    const wa = wastedBytes(a)
    const wb = wastedBytes(b)
    if (wb !== wa) return wb - wa
    return (b.files?.length ?? 0) - (a.files?.length ?? 0)
  })
}

/** 그룹의 중복 낭비 바이트((파일수-1)×size). 그룹이 2개 미만이면 0. */
export function wastedBytes(group: DupGroupDTO): number {
  const n = group?.files?.length ?? 0
  if (n < 2) return 0
  const size = Number.isFinite(group.size) ? group.size : 0
  return (n - 1) * size
}

/** 전체 그룹의 총 회수 가능 용량(선택과 무관·표시용 요약). */
export function totalWastedBytes(groups: readonly DupGroupDTO[]): number {
  return groups.reduce((a, g) => a + wastedBytes(g), 0)
}

/** 선택된 파일 수(전체 그룹 합산). */
export function countSelected(
  groups: readonly DupGroupDTO[],
  selected: ReadonlySet<string>
): number {
  let n = 0
  for (const g of groups) {
    for (const f of g.files ?? []) if (f && selected.has(f.path)) n += 1
  }
  return n
}
