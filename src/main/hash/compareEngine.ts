/**
 * P1 폴더 비교 엔진 (M7 — ADR-009 결정②③).
 *
 * M6 렌더러 domain/rules/compare.ts 의 4상태 분류(left-only/right-only/diff/same)와
 * **동일 결과**를 Main 에서 산출하되, 해시(내용) 옵션·재귀 하위폴더 비교를 추가한다.
 *
 * 분류 드리프트 방지(ADR-009 위험7): isDifferent/matchKey 규칙은 M6 와 동치이며
 * verify:hash 가 양쪽 동치를 고정한다(P1해시 단계에서 shared 헬퍼로 추출 예정).
 *
 * 환경 비의존: fs(listDir)·해시(hashFile)를 deps 로 주입 → 헤드리스 verify 가능.
 * throw 금지(ADR-003): 항목 단위 실패는 격리(해시 null=diff 보수적 처리 회피 — 같은
 * 크기인데 해시 실패면 판정 불가이므로 diff 로 본다·정직). 순환차단(realpath Set).
 *
 * 추적성: ADR-009 §결정②③ · features §P1 · M6 compare.ts 분류 규칙.
 */
import type { ComparePairDTO, CompareResultDTO, CompareStatus, FileEntryDTO, HashAlgo } from '@shared/dto'
import type { HashHooks } from './hashEngine'

/** compareEngine 이 fs/해시와 결합하는 의존(주입형). */
export interface CompareEngineDeps {
  /** 디렉토리 1개의 항목 메타(lstat·심볼릭 미추종). 실패 시 빈 배열(권한격리). */
  listDir(dir: string, hooks: HashHooks): Promise<FileEntryDTO[]>
  /** 단일 파일 해시(취소/읽기실패 null). */
  hashFile(path: string, algo: HashAlgo, hooks: HashHooks): Promise<string | null>
  /** 순환차단용 realpath(베스트에포트). 실패 시 입력 그대로 반환. */
  realpath(dir: string): Promise<string>
}

/** 비교 요청(정규화된 절대경로). */
export interface CompareRequest {
  readonly leftDir: string
  readonly rightDir: string
  readonly useHash: boolean
  readonly recursive: boolean
  readonly algo: HashAlgo
}

/** 재귀 비교 항목 상한(폭주 방어·정직 truncated). scanEngine SCAN_ITEM_CAP 동형 축소. */
export const COMPARE_ITEM_CAP = 1_000_000

/** 짝지음 키(M6 matchKey 동치 — Windows 대소문자 무시·공백 정규화). */
function matchKey(name: string): string {
  return name.trim().toLowerCase()
}

/**
 * 양쪽 존재 항목의 메타 차이 판정(M6 isDifferent 동치 — bySize·byMtime tol=2000).
 * 종류 다르면 diff, 폴더끼리는 메타 비교 제외(same). useHash 는 호출측에서 별도 처리.
 */
function metaDifferent(left: FileEntryDTO, right: FileEntryDTO): boolean {
  if (left.isDir !== right.isDir) return true
  if (left.isDir && right.isDir) return false
  if (left.size !== right.size) return true
  if (Math.abs(left.mtime - right.mtime) > 2000) return true
  return false
}

interface CompareState {
  pairs: ComparePairDTO[]
  scannedItems: number
  scannedBytes: number
  canceled: boolean
  truncated: boolean
  readonly visitedLeft: Set<string>
  readonly visitedRight: Set<string>
}

/**
 * 폴더 한 쌍(leftDir/rightDir)을 비교한다. recursive 면 양쪽 동명 디렉토리에 재귀 진입.
 * relPath 는 재귀 동명 충돌 구분용(루트는 빈 문자열·ComparePairDTO.relPath 는 P1해시에서
 * 추가될 옵셔널 필드 — W1 에선 name 에 상대경로를 합쳐 결정성만 확보).
 */
async function compareDir(
  leftDir: string,
  rightDir: string,
  relPath: string,
  req: CompareRequest,
  state: CompareState,
  hooks: HashHooks,
  deps: CompareEngineDeps
): Promise<void> {
  if (state.canceled || state.truncated) return
  if (hooks.shouldCancel()) {
    state.canceled = true
    return
  }

  // 순환차단(양쪽 각각 realpath 방문 Set).
  const realL = await deps.realpath(leftDir).catch(() => leftDir)
  const realR = await deps.realpath(rightDir).catch(() => rightDir)
  if (state.visitedLeft.has(realL) || state.visitedRight.has(realR)) return
  state.visitedLeft.add(realL)
  state.visitedRight.add(realR)

  const leftEntries = await deps.listDir(leftDir, hooks)
  const rightEntries = await deps.listDir(rightDir, hooks)

  const leftMap = new Map<string, FileEntryDTO>()
  const rightMap = new Map<string, FileEntryDTO>()
  for (const e of leftEntries) {
    const k = matchKey(e.name)
    if (!leftMap.has(k)) leftMap.set(k, e)
  }
  for (const e of rightEntries) {
    const k = matchKey(e.name)
    if (!rightMap.has(k)) rightMap.set(k, e)
  }

  const keys = new Set<string>()
  for (const k of leftMap.keys()) keys.add(k)
  for (const k of rightMap.keys()) keys.add(k)
  const sortedKeys = [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

  // 재귀 진입 대상(양쪽 동명 디렉토리)을 모아 항목 분류 후 진입.
  const recurseInto: { l: FileEntryDTO; r: FileEntryDTO; key: string }[] = []

  for (const key of sortedKeys) {
    if (state.canceled || state.truncated) return
    if (hooks.shouldCancel()) {
      state.canceled = true
      return
    }
    if (state.scannedItems >= COMPARE_ITEM_CAP) {
      state.truncated = true
      return
    }

    const l = leftMap.get(key) ?? null
    const r = rightMap.get(key) ?? null
    state.scannedItems++

    let status: CompareStatus
    if (l && !r) status = 'left-only'
    else if (!l && r) status = 'right-only'
    else if (l && r) {
      const bothDir = l.isDir && r.isDir
      if (bothDir) {
        // 양쪽 폴더 — 메타상 same, 재귀면 내부 진입(상대경로 누적).
        status = 'same'
        if (req.recursive) recurseInto.push({ l, r, key })
      } else if (metaDifferent(l, r)) {
        status = 'diff'
      } else if (req.useHash && !l.isDir && !r.isDir && l.size === r.size) {
        // 같은 이름·같은 크기 파일 → 내용 해시 비교(같은 크기 아님은 위에서 이미 diff).
        const hl = await deps.hashFile(l.path, req.algo, hooks)
        const hr = await deps.hashFile(r.path, req.algo, hooks)
        state.scannedBytes += l.size + r.size
        hooks.onProgress(state.scannedItems, state.scannedBytes, l.path)
        // 해시 실패(null)는 판정 불가 → 보수적으로 diff(은폐 금지·정직).
        status = hl !== null && hr !== null && hl === hr ? 'same' : 'diff'
      } else {
        status = 'same'
      }
    } else continue

    const name = relPath ? `${relPath}/${l?.name ?? r?.name ?? key}` : (l?.name ?? r?.name ?? key)
    state.pairs.push({ name, left: l, right: r, status })
  }

  // 재귀 진입(분류 후) — 양쪽 동명 폴더 내부.
  if (req.recursive) {
    for (const { l, r, key } of recurseInto) {
      if (state.canceled || state.truncated) return
      const childRel = relPath ? `${relPath}/${l.name}` : l.name
      void key
      await compareDir(l.path, r.path, childRel, req, state, hooks, deps)
    }
  }
}

/** 폴더 비교 실행 → CompareResultDTO(4상태·요약·옵션·truncated). throw 금지. */
export async function runCompare(
  req: CompareRequest,
  hooks: HashHooks,
  deps: CompareEngineDeps
): Promise<CompareResultDTO> {
  const state: CompareState = {
    pairs: [],
    scannedItems: 0,
    scannedBytes: 0,
    canceled: false,
    truncated: false,
    visitedLeft: new Set<string>(),
    visitedRight: new Set<string>()
  }

  await compareDir(req.leftDir, req.rightDir, '', req, state, hooks, deps)
  // 종료 시 마지막 진행 1건 보고.
  hooks.onProgress(state.scannedItems, state.scannedBytes, req.leftDir)

  let leftOnly = 0
  let rightOnly = 0
  let diff = 0
  let same = 0
  for (const p of state.pairs) {
    if (p.status === 'left-only') leftOnly++
    else if (p.status === 'right-only') rightOnly++
    else if (p.status === 'diff') diff++
    else same++
  }

  return {
    pairs: state.pairs,
    summary: { leftOnly, rightOnly, diff, same, total: state.pairs.length },
    usedHash: req.useHash,
    recursive: req.recursive,
    truncated: state.truncated
  }
}
