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
 * 영문 셸 verb 표시명 → 한국어 표시명 사전(§Y1).
 *
 * COM `FolderItemVerb.Name` 은 시스템/앱 로케일을 따르므로, 영어 Windows 거나 영어
 * 표시명으로 verb 를 등록한 앱(예: 일부 외부 프로그램)의 항목은 메뉴에 영어로 노출된다.
 * 사용자에게 보이는 `display` 만 한국어로 치환하고(verbId 의 원문 display 는 보존 →
 * 워커 교차검증 `($v.Name -replace '&','')` 와 계속 일치), 사전에 없으면 원문 유지한다.
 *
 * 키는 normalizeVerbName 결과(소문자·`&`/말미 단축키 제거)와 동일 규칙. 블랙리스트로
 * 이미 제거되는 항목(open/cut/copy/paste/delete/rename/properties/create shortcut)은 제외.
 */
export const VERB_TRANSLATIONS: ReadonlyMap<string, string> = new Map([
  // 편집·보기·실행
  ['edit', '편집'],
  ['print', '인쇄'],
  ['preview', '미리 보기'],
  ['play', '재생'],
  ['run', '실행'],
  ['run as administrator', '관리자 권한으로 실행'],
  ['run as another user', '다른 사용자로 실행'],
  ['open with', '연결 프로그램으로 열기'],
  ['open in new window', '새 창에서 열기'],
  ['open in new tab', '새 탭에서 열기'],
  ['open new window', '새 창에서 열기'],
  ['open file location', '파일 위치 열기'],
  ['open command window here', '여기에 명령 창 열기'],
  ['open powershell window here', '여기에 PowerShell 창 열기'],
  ['open in terminal', '터미널에서 열기'],
  ['open in windows terminal', '터미널에서 열기'],
  // 고정·보내기·공유
  ['pin to start', '시작 화면에 고정'],
  ['unpin from start', '시작 화면에서 제거'],
  ['pin to taskbar', '작업 표시줄에 고정'],
  ['unpin from taskbar', '작업 표시줄에서 제거'],
  ['pin to quick access', '즐겨찾기에 고정'],
  ['unpin from quick access', '즐겨찾기에서 제거'],
  ['send to', '보내기'],
  ['share', '공유'],
  ['share with', '공유 대상'],
  ['give access to', '액세스 권한 부여'],
  ['add to favorites', '즐겨찾기에 추가'],
  ['include in library', '라이브러리에 포함'],
  // 경로·압축·미디어
  ['copy as path', '경로로 복사'],
  ['copy path', '경로 복사'],
  ['extract', '압축 풀기'],
  ['extract all', '모두 압축 풀기'],
  ['extract here', '여기에 압축 풀기'],
  ['extract files', '압축 풀기'],
  ['extract to', '압축 풀기'],
  ['compress', '압축'],
  ['compress to', '압축'],
  ['compress here', '여기에 압축'],
  ['compress and email', '압축 후 메일 보내기'],
  ['compress using administrator authority', '관리자 권한으로 압축'],
  ['compress using administrator privileges', '관리자 권한으로 압축'],
  ['extract using administrator authority', '관리자 권한으로 압축 풀기'],
  ['extract using administrator privileges', '관리자 권한으로 압축 풀기'],
  ['add to archive', '압축 파일에 추가'],
  ['set as desktop background', '바탕 화면 배경으로 설정'],
  ['rotate right', '오른쪽으로 회전'],
  ['rotate left', '왼쪽으로 회전'],
  ['cast to device', '장치로 캐스트'],
  // 시스템·디스크·네트워크
  ['scan with microsoft defender', 'Microsoft Defender로 검사'],
  ['troubleshoot compatibility', '호환성 문제 해결'],
  ['restore previous versions', '이전 버전 복원'],
  ['restore', '복원'],
  ['mount', '탑재'],
  ['eject', '꺼내기'],
  ['burn to disc', '디스크에 굽기'],
  ['format', '포맷'],
  ['map network drive', '네트워크 드라이브 연결'],
  ['disconnect network drive', '네트워크 드라이브 연결 끊기'],
  ['show more options', '추가 옵션 표시'],
  ['new', '새로 만들기']
])

/**
 * 사용자 표시명 한국어화: 정규화 키가 사전에 있으면 한국어, 없으면 원문 그대로.
 * verbId 가 아니라 보이는 `display` 에만 적용한다(워커 교차검증은 원문 기준 유지).
 */
export function translateVerbDisplay(display: string): string {
  if (typeof display !== 'string') return ''
  return VERB_TRANSLATIONS.get(normalizeVerbName(display)) ?? display
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
 * 사용자에게 보이는 `display` 만 translateVerbDisplay 로 한국어화한다(원문은 verbId 에 보존).
 */
export function filterVerbs(raw: readonly RawShellVerb[]): FilteredShellVerb[] {
  const out: FilteredShellVerb[] = []
  for (const v of raw) {
    if (!v || typeof v.display !== 'string' || v.display.trim().length === 0) continue
    if (isBlacklisted(v.name ?? v.display)) continue
    out.push({ verbId: makeVerbId(v.index, v.display), display: translateVerbDisplay(v.display) })
  }
  return out
}
