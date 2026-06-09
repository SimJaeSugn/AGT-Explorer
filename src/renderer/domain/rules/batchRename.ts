/**
 * 고급 일괄 이름변경 규칙 (renderer/domain/rules/batchRename) — 순수 TS, 부수효과 없음.
 *
 * 다중 선택 항목에 규칙(찾기/바꾸기·정규식·접두/접미·연번·대소문자)을 적용해
 * (원경로 → 새이름) 매핑과 충돌 검사 결과를 미리보기 행으로 산출한다(R1·US-17.1·§R·F22).
 *
 * 규약(계획서 §3·§9):
 *  - react/zustand/infra/shared-ipc import 0(@shared/dto 타입 전용만).
 *  - **throw 금지**(ADR-003 throw0): 잘못된 정규식은 throw 하지 않고 해당 행 error 플래그
 *    또는 원본 유지로 안전 폴백한다(invalidRegex 플래그 동시 반환).
 *  - 충돌 검사 2종: ① 변경 후 이름끼리(dup-internal), ② 같은 폴더 내 비대상 기존 이름(dup-existing).
 *  - 금지문자(\ / : * ? " < > |)·예약명·빈 이름은 B3 규칙 준용 차단(invalid-char/reserved/empty).
 *  - Windows 파일시스템 대소문자 무시 비교.
 */

/** 일괄 이름변경 규칙(다이얼로그 폼 1:1). 모든 필드는 옵셔널·미설정이면 그 규칙 비적용. */
export interface BatchRenameRule {
  /** 찾기(빈=미적용). useRegex 면 정규식 소스로 해석. */
  readonly find?: string
  /** 바꾸기(find 가 있을 때 치환 문자열·정규식 캡처 $1 등 허용). */
  readonly replace?: string
  /** find 를 정규식으로 해석(전역·대소문자 무시 기본). */
  readonly useRegex?: boolean
  /** 접두(이름 앞). */
  readonly prefix?: string
  /** 접미(베이스명 뒤·확장자 앞, applyToExt=true 면 확장자 포함 끝). */
  readonly suffix?: string
  /** 연번. enabled=false 면 비적용. */
  readonly seq?: SeqRule
  /** 대소문자 변환. 'none'(기본)·UPPER·lower·Title. */
  readonly caseMode?: CaseMode
  /** 확장자까지 규칙 적용(기본 false=베이스명만 변환·확장자 보존). */
  readonly applyToExt?: boolean
}

/** 연번 규칙. */
export interface SeqRule {
  readonly enabled: boolean
  /** 시작 번호. */
  readonly start: number
  /** 증가폭. */
  readonly step: number
  /** 0패딩 자릿수(예: pad=3 → 001). */
  readonly pad: number
  /** 연번 위치(이름 앞/뒤). */
  readonly position: 'prefix' | 'suffix'
}

/** 대소문자 변환 모드. */
export type CaseMode = 'none' | 'upper' | 'lower' | 'title'

/** 미리보기 행의 충돌/오류 코드(없으면 null). */
export type RenameRowError =
  | 'invalid-char' // 금지문자 포함
  | 'reserved' // 예약명(CON/PRN/AUX/NUL/COM1..9/LPT1..9)
  | 'empty' // 빈 이름
  | 'dup-internal' // 변경 후 이름이 대상끼리 충돌
  | 'dup-existing' // 같은 폴더 내 비대상 기존 항목과 충돌

/** 미리보기 1행(원본 → 변경 후). */
export interface RenamePreviewRow {
  /** 원본 절대경로(실행·undo 키). */
  readonly path: string
  /** 원본 이름(확장자 포함). */
  readonly oldName: string
  /** 규칙 적용 후 이름(확장자 포함). */
  readonly newName: string
  /** 실제로 이름이 바뀌는가(oldName !== newName, 대소문자 변경 포함). */
  readonly changed: boolean
  /** 충돌/오류(없으면 null). */
  readonly error: RenameRowError | null
}

/** computeBatchRename 결과(행 + 정규식 컴파일 실패 여부). */
export interface BatchRenameResult {
  readonly rows: RenamePreviewRow[]
  /** useRegex 인데 find 가 잘못된 정규식이라 컴파일 실패(안전 폴백·전 행 원본 유지). */
  readonly invalidRegex: boolean
}

/** Windows 금지문자(파일명에 사용 불가). */
const FORBIDDEN_CHARS = /[\\/:*?"<>|]/

/** Windows 예약명(확장자 무관·대소문자 무시). */
const RESERVED_NAMES = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9'
])

/** 파일명을 베이스명/확장자로 분리. 확장자 없으면 ext=''(점 미포함). 선행 점 파일(.gitignore)은 전체가 베이스명. */
export function splitName(name: string): { base: string; ext: string } {
  const idx = name.lastIndexOf('.')
  // 점이 없거나 맨 앞(.gitignore)·맨 뒤(name.) 면 확장자 없음으로 본다.
  if (idx <= 0 || idx === name.length - 1) return { base: name, ext: '' }
  return { base: name.slice(0, idx), ext: name.slice(idx + 1) }
}

/** 대소문자 변환(베이스명 단위). */
function applyCase(s: string, mode: CaseMode): string {
  switch (mode) {
    case 'upper':
      return s.toUpperCase()
    case 'lower':
      return s.toLowerCase()
    case 'title':
      // 단어 경계(공백·구분자·점·언더스코어·하이픈) 다음 첫 글자 대문자.
      return s.replace(/(^|[\s._\-([{])([a-z])/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase())
    default:
      return s
  }
}

/** 연번 문자열(0패딩). */
function seqString(seq: SeqRule, index: number): string {
  const n = seq.start + seq.step * index
  const sign = n < 0 ? '-' : ''
  const digits = Math.abs(Math.trunc(n)).toString()
  const padded = seq.pad > 0 ? digits.padStart(seq.pad, '0') : digits
  return sign + padded
}

/** 정규식 소스 컴파일(실패 시 null·throw 금지). */
function tryCompile(source: string): RegExp | null {
  try {
    // 전역·대소문자 무시(파일명 단위). 잘못된 패턴은 catch 로 폴백.
    return new RegExp(source, 'gi')
  } catch {
    return null
  }
}

/** 이름 검증(금지문자/예약명/빈) → RenameRowError 또는 null. */
function validateName(name: string): RenameRowError | null {
  const trimmed = name.trim()
  if (trimmed === '') return 'empty'
  if (FORBIDDEN_CHARS.test(name)) return 'invalid-char'
  const { base } = splitName(name)
  if (RESERVED_NAMES.has(base.toLowerCase())) return 'reserved'
  return null
}

/** 규칙을 한 항목(이름)에 적용해 새 이름 산출. 정규식은 미리 컴파일된 것을 받음(null=비적용). */
function applyRule(
  name: string,
  rule: BatchRenameRule,
  index: number,
  compiledFind: RegExp | null
): string {
  const { base, ext } = splitName(name)
  // 규칙 적용 대상 문자열: applyToExt 면 전체 이름, 아니면 베이스명만.
  let target = rule.applyToExt ? name : base

  // 1) 찾기/바꾸기.
  if (rule.find && rule.find.length > 0) {
    const replacement = rule.replace ?? ''
    if (rule.useRegex) {
      if (compiledFind) {
        // lastIndex 오염 방지를 위해 매 호출 새 정규식이 아니라 replace(전역)로 1회.
        compiledFind.lastIndex = 0
        target = target.replace(compiledFind, replacement)
      }
      // compiledFind=null(잘못된 정규식)이면 치환 생략(원본 유지) — 호출측이 invalidRegex 처리.
    } else {
      // 문자열 전역 치환(대소문자 구분·단순). split/join 으로 전역.
      target = target.split(rule.find).join(replacement)
    }
  }

  // 2) 대소문자 변환.
  if (rule.caseMode && rule.caseMode !== 'none') {
    target = applyCase(target, rule.caseMode)
  }

  // 3) 접두/접미.
  if (rule.prefix) target = rule.prefix + target
  if (rule.suffix) target = target + rule.suffix

  // 4) 연번(접두/접미).
  if (rule.seq && rule.seq.enabled) {
    const sq = seqString(rule.seq, index)
    target = rule.seq.position === 'prefix' ? sq + target : target + sq
  }

  // applyToExt 면 target 이 곧 전체 이름. 아니면 베이스명만 바꿨으니 확장자 복원.
  if (rule.applyToExt) return target
  return ext ? `${target}.${ext}` : target
}

/** 규칙에 실제 적용할 변형이 하나라도 있는지(없으면 전부 changed=false). */
function ruleHasEffect(rule: BatchRenameRule): boolean {
  return Boolean(
    (rule.find && rule.find.length > 0) ||
      rule.prefix ||
      rule.suffix ||
      (rule.seq && rule.seq.enabled) ||
      (rule.caseMode && rule.caseMode !== 'none')
  )
}

/**
 * 대상 목록 + 규칙 → 미리보기 행(순서 보존·연번은 입력 순서대로).
 *
 * @param targets 대상 항목(원본 절대경로·이름·디렉토리 여부). 입력 순서 = 연번 순서.
 * @param rule 적용 규칙.
 * @param existingNamesInDir 같은 폴더 내 **비대상** 기존 항목 이름 집합(소문자·충돌검사용).
 *        호출측(usecase)이 대상 자신은 제외하고 전달한다.
 */
export function computeBatchRename(
  targets: readonly { path: string; name: string; isDir: boolean }[],
  rule: BatchRenameRule,
  existingNamesInDir: ReadonlySet<string>
): BatchRenameResult {
  // 정규식 1회 컴파일(실패 → invalidRegex·치환 비적용).
  let invalidRegex = false
  let compiledFind: RegExp | null = null
  if (rule.useRegex && rule.find && rule.find.length > 0) {
    compiledFind = tryCompile(rule.find)
    if (compiledFind === null) invalidRegex = true
  }

  const hasEffect = ruleHasEffect(rule)
  const existingLower = new Set([...existingNamesInDir].map((n) => n.toLowerCase()))

  // 1차: 새 이름 산출.
  const draft = targets.map((t, i) => {
    const newName = hasEffect ? applyRule(t.name, rule, i, compiledFind) : t.name
    return { path: t.path, oldName: t.name, newName }
  })

  // 변경 후 이름 빈도(대소문자 무시) — dup-internal 검출.
  const newNameCount = new Map<string, number>()
  for (const d of draft) {
    const key = d.newName.toLowerCase()
    newNameCount.set(key, (newNameCount.get(key) ?? 0) + 1)
  }

  const rows: RenamePreviewRow[] = draft.map((d) => {
    const changed = d.newName !== d.oldName
    let error: RenameRowError | null = validateName(d.newName)
    if (error === null) {
      const keyNew = d.newName.toLowerCase()
      // dup-internal: 같은 새 이름이 2개 이상.
      if ((newNameCount.get(keyNew) ?? 0) > 1) {
        error = 'dup-internal'
      } else if (changed && existingLower.has(keyNew)) {
        // dup-existing: 변경 후 이름이 폴더 내 비대상 기존 항목과 충돌(변경되는 행만).
        error = 'dup-existing'
      }
    }
    return { path: d.path, oldName: d.oldName, newName: d.newName, changed, error }
  })

  return { rows, invalidRegex }
}

/** 적용 가능 여부(에러 행 0 + 실제 변경 1건 이상). 정규식 실패면 false. */
export function isApplicable(result: BatchRenameResult): boolean {
  if (result.invalidRegex) return false
  const rows = result.rows
  if (rows.length === 0) return false
  if (rows.some((r) => r.error !== null)) return false
  return rows.some((r) => r.changed)
}

/** 사용자 안내용 충돌/오류 라벨(UI 표시). */
export function renameErrorLabel(error: RenameRowError): string {
  switch (error) {
    case 'invalid-char':
      return '사용할 수 없는 문자'
    case 'reserved':
      return '예약된 이름'
    case 'empty':
      return '빈 이름'
    case 'dup-internal':
      return '대상끼리 이름 충돌'
    case 'dup-existing':
      return '기존 파일과 충돌'
  }
}
