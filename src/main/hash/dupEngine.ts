/**
 * R2 중복 파일 찾기 엔진 (M7 — ADR-009 결정③·UQ-H3).
 *
 * 알고리즘(크기 선필터 → 해시 확정 2단계, 비용 통제):
 *   ① roots 재귀 열거 → 모든 파일을 Map<size, meta[]> 로 크기 그룹핑.
 *   ② size 그룹이 2개 이상인 것만 각 파일 해시(유일 크기는 해시 0 — ADR-009 결정③).
 *   ③ Map<hash, meta[]> 로 재그룹핑 → 2개 이상인 것만 DupGroupDTO(중복만).
 *
 * 환경 비의존: fs 결합(enumerate)·해시(hashFile)를 deps 로 주입 → 헤드리스 verify 가능.
 * throw 금지(ADR-003): 항목 단위 실패(해시 null)는 그 파일을 건너뛴다(skipped 격리).
 *
 * 추적성: ADR-009 §결정③ · features §R2 · scanEngine 순환차단/권한격리 재사용(enumerate).
 */
import type { DupFileDTO, DupGroupDTO, HashAlgo } from '@shared/dto'
import type { HashHooks } from './hashEngine'

/** 열거된 파일 1개의 메타(중복 판정에 필요한 최소 필드). */
export interface DupFileMeta {
  readonly path: string
  readonly name: string
  readonly size: number
  readonly mtime: number
}

/** dupEngine 이 fs/해시와 결합하는 의존(주입형). */
export interface DupEngineDeps {
  /**
   * roots 를 재귀 열거해 minSize 이상 파일 메타를 반환한다.
   * scanEngine 의 순환차단(realpath Set)·심볼릭 미추종·권한격리(skipped)·항목 상한
   * (truncated) 을 재사용한다. 상한 도달 시 truncated=true.
   */
  enumerate(
    roots: readonly string[],
    minSize: number,
    hooks: HashHooks
  ): Promise<{ files: DupFileMeta[]; truncated: boolean }>
  /** 단일 파일 해시(취소·읽기실패 시 null — hashEngine.hashFile). */
  hashFile(path: string, algo: HashAlgo, hooks: HashHooks): Promise<string | null>
}

/** R2 1차 minSize 기본(0바이트 제외). */
export const DUP_DEFAULT_MIN_SIZE = 1

/**
 * roots 범위의 중복 그룹(내용 동일 = 같은 크기 + 같은 해시)을 찾는다.
 * @returns groups=2개 이상 묶음만, truncated=항목 상한 도달.
 */
export async function findDuplicates(
  roots: readonly string[],
  minSize: number,
  algo: HashAlgo,
  hooks: HashHooks,
  deps: DupEngineDeps
): Promise<{ groups: DupGroupDTO[]; truncated: boolean }> {
  const effMin = minSize >= 0 ? minSize : DUP_DEFAULT_MIN_SIZE

  // ① 전체 열거 + 크기 그룹핑.
  const { files, truncated } = await deps.enumerate(roots, effMin, hooks)
  if (hooks.shouldCancel()) return { groups: [], truncated }

  const bySize = new Map<number, DupFileMeta[]>()
  for (const f of files) {
    const arr = bySize.get(f.size)
    if (arr) arr.push(f)
    else bySize.set(f.size, [f])
  }

  // ② 같은 크기 그룹이 2개 이상인 것만 해시(유일 크기는 해시 0 — 비용 통제).
  let scannedItems = 0
  const byHash = new Map<string, DupFileMeta[]>()
  for (const [, group] of bySize) {
    if (group.length < 2) continue // 유일 크기 = 중복 불가, 해시 회피.
    for (const f of group) {
      if (hooks.shouldCancel()) return { groups: collectGroups(byHash), truncated }
      const h = await deps.hashFile(f.path, algo, hooks)
      scannedItems++
      // 진행 보고(누적 항목·바이트는 enumerate 단계와 별개 — 상위 스로틀이 흡수).
      hooks.onProgress(scannedItems, f.size, f.path)
      if (h === null) continue // 취소/읽기실패 — 그 파일 격리.
      // ③ 해시별 재그룹핑(같은 크기 보존 — 충돌 시 size 로도 분리).
      const key = `${h}:${f.size}`
      const arr = byHash.get(key)
      if (arr) arr.push(f)
      else byHash.set(key, [f])
    }
  }

  return { groups: collectGroups(byHash), truncated }
}

/** Map<hashKey, meta[]> 에서 2개 이상 묶음만 DupGroupDTO 로 수집(낭비 큰 그룹 우선 정렬). */
function collectGroups(byHash: Map<string, DupFileMeta[]>): DupGroupDTO[] {
  const groups: DupGroupDTO[] = []
  for (const [key, metas] of byHash) {
    if (metas.length < 2) continue
    const hash = key.slice(0, key.lastIndexOf(':'))
    const size = metas[0]!.size
    const dupFiles: DupFileDTO[] = metas.map((m) => ({
      path: m.path,
      name: m.name,
      mtime: m.mtime
    }))
    groups.push({ hash, size, files: dupFiles })
  }
  // 낭비 바이트(= size × (중복수-1)) 큰 그룹 우선.
  groups.sort((a, b) => b.size * (b.files.length - 1) - a.size * (a.files.length - 1))
  return groups
}
