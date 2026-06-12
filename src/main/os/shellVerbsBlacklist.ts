/**
 * 셸 컨텍스트 verb 블랙리스트·정규화·verbId 합성 (§Y1·ADR-013 결정④, 순수 모듈).
 *
 * COM `FolderItemVerb` 는 canonical verb name 을 안정적으로 노출하지 않고 표시명
 * (`Name` — 다국어·`&` 가속기 포함)만 주므로, 앱 자체 명령과 중복되는 verb(열기/
 * 복사/삭제/속성 등)는 **표시명 정규화 매칭**으로 걸러낸다(영/한 사전·그 외 언어는
 * best-effort 미필터). 블랙리스트는 ps1 이 아니라 Main(이 모듈)에서 적용한다 —
 * verify 가능·언어 사전 단일 출처(ADR-013 §4).
 *
 * **순수 모듈**: electron / react / zustand / infra / shared-ipc import 0 →
 * 헤드리스 verify(verify:shellverbs) 대상.
 */

/**
 * 표시명 정규화: `&`(가속기) 제거 → 말미 단축키 그룹 `(...)`/`(&X)` 제거 →
 * 공백 정리(연속 공백 1칸·트림) → 소문자화. 블랙리스트 매칭·교차검증의 단일 규칙.
 *
 * 예: `&Open`→`open` · `삭제(&D)`→`삭제` · `복사  `→`복사` ·
 *     `Create &shortcut`→`create shortcut` · `Properties (&R)`→`properties`.
 */
export function normalizeVerbName(name: string): string {
  if (typeof name !== 'string') return ''
  let s = name.replace(/&/g, '') // 가속기 마커 제거.
  // 말미 단축키 그룹 제거: 끝의 `(...)`(영숫자 1~3자 또는 비었던 가속기) 1회.
  s = s.replace(/\s*\([^()]{0,3}\)\s*$/u, '')
  s = s.replace(/\s+/gu, ' ').trim() // 공백 정리.
  return s.toLowerCase()
}

/**
 * 앱 자체 명령과 중복되는 verb 의 정규화 표시명 집합(영/한 — ADR-013 §3 표).
 * `copy as path`/`경로로 복사`·압축/외부앱 항목은 **미포함**(노출 유지).
 * `open with`/`연결 프로그램으로 열기` 는 1차 미포함(보수적·과필터 방지).
 */
export const BLACKLIST: ReadonlySet<string> = new Set([
  // open
  'open',
  '열기',
  // cut
  'cut',
  '잘라내기',
  // copy (주의: 'copy as path'/'경로로 복사' 는 normalizeVerbName 후 'copy as path'/'경로로 복사' 로
  // 별개 키가 되어 매칭되지 않음 — 노출 유지)
  'copy',
  '복사',
  // paste
  'paste',
  '붙여넣기',
  // delete
  'delete',
  '삭제',
  // rename
  'rename',
  '이름 바꾸기',
  '이름바꾸기',
  // properties
  'properties',
  '속성',
  // create shortcut / link (중복 UX)
  'create shortcut',
  '바로 가기 만들기',
  'link'
])

/** 정규화 표시명이 블랙리스트에 속하는지(앱 자체 구현과 중복 → 비노출). */
export function isBlacklisted(name: string): boolean {
  return BLACKLIST.has(normalizeVerbName(name))
}

/**
 * verbId 합성: `"<index>:<정규화표시명>"`. display 에 `:` 가 있어도 첫 콜론만
 * 구분자이므로 안전(parseVerbId 가 첫 콜론까지만 index 로 본다).
 */
export function makeVerbId(index: number, display: string): string {
  return `${index}:${display}`
}

/**
 * verbId 파싱: 첫 콜론 앞을 index(정수), 뒤 전체를 display 로 본다.
 * 형식 위반(콜론 없음·index 비정수·index 음수)은 null.
 */
export function parseVerbId(verbId: string): { index: number; display: string } | null {
  if (typeof verbId !== 'string') return null
  const colon = verbId.indexOf(':')
  if (colon < 0) return null
  const head = verbId.slice(0, colon)
  if (!/^\d+$/.test(head)) return null
  const index = Number.parseInt(head, 10)
  if (!Number.isInteger(index) || index < 0) return null
  return { index, display: verbId.slice(colon + 1) }
}

/** ps1 이 반환한 원시 verb(index/name/display)의 형태(블랙리스트 적용 전 1개). */
export interface RawShellVerb {
  readonly index: number
  /** 원문 표시명(`&` 포함 가능). */
  readonly name: string
  /** ps1 이 1차 정규화(`&` 제거)한 표시명. Main 이 normalizeVerbName 으로 재정규화. */
  readonly display: string
}

/** 블랙리스트 적용 결과 verb(렌더러로 보낼 형태). */
export interface FilteredShellVerb {
  readonly verbId: string
  readonly display: string
}

/**
 * 원시 verb 목록 → 블랙리스트 필터 + verbId 합성(순수). list 응답을 렌더러로 보내기
 * 전 Main 에서 적용한다. 표시명 비어 있는 verb·블랙리스트 verb 는 제외.
 * verbId 의 display 는 ps1 이 준 `display`(원문에서 `&` 제거)를 그대로 쓴다 —
 * invoke 시 ps1 의 `($_.Name -replace '&','')` 와 동일 규칙으로 교차검증되도록.
 */
export function filterVerbs(raw: readonly RawShellVerb[]): FilteredShellVerb[] {
  const out: FilteredShellVerb[] = []
  for (const v of raw) {
    if (!v || typeof v.display !== 'string' || v.display.trim().length === 0) continue
    if (isBlacklisted(v.name ?? v.display)) continue
    out.push({ verbId: makeVerbId(v.index, v.display), display: v.display })
  }
  return out
}
