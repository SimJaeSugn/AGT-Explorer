/**
 * src/main/agent/scope.ts — 에이전트 경로 스코프 화이트리스트(ADR-014 결정⑦·위협 모델).
 *
 * LLM 응답(tool_call 인자)은 외부 입력이다. 모든 경로(cwd·selection·PlannedOp sources/dest)는
 * 핸들러에서 guardPath(정규화·`..` 차단) 통과 후, **scope.assertInScope** 로:
 *   - 연 루트/선택 조상 경계 안인지(스코프 루트 하위),
 *   - 시스템/보호 폴더가 아닌지,
 *   - 원격/archive prefix 가 아닌지(로컬만)
 * 를 재검증한다. confirm 시점에 재검증(TOCTOU·LLM 오염 방지).
 *
 * 순수 판정(정규화된 경로 문자열만 다룸·IO 0) → 헤드리스 verify 대상.
 */
import type { Result } from '@shared/ipc/contracts'
import { err, ok } from '@shared/ipc/contracts'
import { fileOpError } from '../fs/errors'

/** 스코프(연 루트·선택 조상 집합 — 전부 정규화된 절대 경로). */
export interface AgentScope {
  /** 에이전트가 접근 가능한 루트 경로들(하위 포함). */
  readonly roots: readonly string[]
}

/** 시스템/보호 폴더 프리픽스(소문자·역슬래시 정규화 비교). 하위 전체 차단. */
const SYSTEM_PREFIXES: readonly string[] = [
  'c:\\windows',
  'c:\\program files',
  'c:\\program files (x86)',
  'c:\\programdata',
  'c:\\$recycle.bin',
  'c:\\system volume information'
]

/** 원격/archive 가상 경로 prefix(로컬 아님 — 에이전트 도구 거부). */
const VIRTUAL_PREFIXES: readonly string[] = ['remote://', 'archive://', 'sftp://', 'ftp://']

/** 경로를 소문자·역슬래시 정규형으로(스코프 비교용). */
function canon(p: string): string {
  return p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
}

/** child 가 parent(루트) 하위(또는 동일)인지(정규형 비교·세그먼트 경계 존중). */
export function isUnder(child: string, parent: string): boolean {
  const c = canon(child)
  const p = canon(parent)
  if (c === p) return true
  return c.startsWith(p + '\\')
}

/** 가상(원격/archive) 경로인지. */
export function isVirtualPath(p: string): boolean {
  const lower = p.trim().toLowerCase()
  return VIRTUAL_PREFIXES.some((v) => lower.startsWith(v))
}

/** 시스템/보호 폴더(하위 포함)인지. */
export function isSystemPath(p: string): boolean {
  const c = canon(p)
  return SYSTEM_PREFIXES.some((s) => c === s || c.startsWith(s + '\\'))
}

/**
 * 정규화된 경로가 스코프 안의 로컬·비시스템 경로인지 단언.
 * 입력은 guardPath 를 이미 통과한(정규화·`..` 차단) 경로여야 한다.
 */
export function assertInScope(path: string, scope: AgentScope): Result<string> {
  if (isVirtualPath(path)) {
    return err(fileOpError('ESECURITY', '원격/압축 경로는 에이전트 범위 밖입니다.', path))
  }
  if (isSystemPath(path)) {
    return err(fileOpError('ESECURITY', '시스템/보호 폴더는 에이전트 범위 밖입니다.', path))
  }
  if (scope.roots.length === 0) {
    return err(fileOpError('ESECURITY', '에이전트 스코프 루트가 비어 있습니다.', path))
  }
  const inScope = scope.roots.some((root) => isUnder(path, root))
  if (!inScope) {
    return err(fileOpError('ESECURITY', '허용된 스코프 루트 밖의 경로입니다.', path))
  }
  return ok(path)
}

/**
 * 이름 있는 위치(§Z) 의 로컬·비시스템·비가상 경로만 추린다(스코프 추가 루트 후보).
 *   - isVirtualPath(remote/archive): list_directory(로컬 fs) 대상 아님 → 제외(목록엔 표시 가능).
 *   - isSystemPath(시스템 폴더): assertInScope 가 어차피 거부하지만, 루트로도 넣지 않는다(이중 방어).
 * 입력은 정규화 가정(핸들러가 guardPath 통과분만 넘긴다). 빈/중복은 정리.
 */
export function scopeRootsFromLocations(paths: readonly string[]): string[] {
  const out: string[] = []
  for (const p of paths) {
    if (!p) continue
    if (isVirtualPath(p)) continue
    if (isSystemPath(p)) continue
    if (!out.includes(p)) out.push(p)
  }
  return out
}

/**
 * cwd + selection (+ 이름 있는 위치 경로)으로 스코프를 구성(정규화된 경로 가정).
 *
 * `locationPaths` 는 §Z 이름 있는 위치(즐겨찾기/빠른위치/최근/드라이브/패널)의 **로컬·비시스템·
 * 비가상** 경로다(scopeRootsFromLocations 로 미리 추렸거나, 여기서 동일 규칙으로 필터). 이를 추가
 * 루트로 포함해 "즐겨찾기 X의 목록 조회" 같은 시나리오에서 해당 경로 하위를 list_directory 가
 * 읽을 수 있게 한다. 시스템 폴더는 루트로 줘도 assertInScope 가 거부(isSystemPath 우선).
 */
export function buildScope(
  cwd: string,
  selection: readonly string[],
  locationPaths: readonly string[] = []
): AgentScope {
  const roots: string[] = []
  const add = (p: string): void => {
    if (!p) return
    if (isVirtualPath(p) || isSystemPath(p)) return // 가상/시스템은 루트 제외(이중 방어).
    if (!roots.some((r) => isUnder(p, r))) roots.push(p)
  }
  if (cwd) add(cwd)
  // 선택 항목은 그 자신을 루트로(하위 접근 허용). cwd 하위면 cwd 가 흡수.
  for (const s of selection) add(s)
  // 이름 있는 위치 경로(로컬·비시스템만) 추가 루트.
  for (const p of locationPaths) add(p)
  return { roots }
}
