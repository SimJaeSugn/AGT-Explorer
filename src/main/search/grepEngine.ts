/**
 * 내용 검색(grep) 스트리밍 라인 스캔 코어 (M8 — ADR-010 결정②④).
 *
 * 환경 비의존(environment-agnostic): fs 결합(디렉토리 열거·파일 청크 read·바이너리
 * 샘플)을 **주입**받아 (a) Worker 안에서 실 파일 grep 으로, (b) 검증 스크립트에서
 * 메모리 스텁으로 동일하게 돌릴 수 있다(scanEngine·hashEngine 선례와 동형).
 *
 * 설계 포인트(ADR-010):
 *  - **라인 스트리밍**: 파일을 청크로 흘리며 라인 경계(LF)로 분할·매칭한다. 전체를
 *    메모리에 올리지 않는다(대용량 안전). CRLF 의 CR 은 발췌에서 제거.
 *  - **라인 길이 상한**: 거대 1줄(미니파이/바이너리스러운) 폭주 방지 — 상한 초과 줄은
 *    상한까지만 버퍼링하고 잔여는 버린다(다음 LF 까지 스킵). 발췌도 상한까지.
 *  - **매칭**: 리터럴(부분 일치·indexOf 루프) 또는 정규식(global). 정규식 컴파일 실패는
 *    상위(GrepManager)가 Result.err 로 격리(여기서는 compileMatcher 가 null 반환).
 *  - **상한**: 파일별 일치 줄 수 상한·전체 결과(줄) 수 상한 → 도달 시 truncated.
 *  - **취소**: shouldCancel() 협조 폴링(청크/파일 경계). 부분 결과 반환.
 *  - **바이너리/크기**: 확장자·내용 휴리스틱 바이너리는 스킵, 크기 상한 초과 스킵.
 *  - **순환·권한**: 심볼릭 미추종·realpath 방문 Set·readdir/lstat 실패 skip(F장 원칙).
 *
 * throw 금지 — 파일 단위 오류는 스킵으로 흡수한다.
 */
import { isBinaryByExt, isBinaryBySample, BINARY_SNIFF_BYTES } from './binaryDetect'

/** 라인 길이 상한(바이트→문자 근사). 초과 줄은 상한까지만 버퍼링·발췌. */
export const GREP_MAX_LINE_LEN = 4096

/** 파일별 일치 줄 수 상한(메모리·전송 통제). */
export const GREP_PER_FILE_MATCH_CAP = 1000

/** 전체 결과(일치 줄) 수 상한 — 도달 시 truncated. */
export const GREP_TOTAL_MATCH_CAP = 50_000

/** 파일 크기 상한 기본값(바이트). 초과 파일은 스캔 스킵(요청 maxFileBytes 로 덮어씀). */
export const GREP_DEFAULT_MAX_FILE_BYTES = 32 * 1024 * 1024

/** 파일 read 청크(라인 분할 버퍼 단위). */
export const GREP_READ_CHUNK_BYTES = 1 << 16 // 64KB

/** grep 일치 줄 1건(엔진 내부·DTO 와 동형). ranges 는 text 내 [start,end) 컬럼 쌍. */
export interface GrepLineHit {
  readonly lineNo: number
  readonly text: string
  readonly ranges: [number, number][]
}

/** 한 파일 매칭 결과. lines 비어 있으면 무일치(상위가 match evt 안 보냄). */
export interface GrepFileResult {
  readonly lines: GrepLineHit[]
  /** 파일별 상한 도달로 줄이 잘렸는지. */
  readonly truncated: boolean
}

/** 한 줄 텍스트에서 일치 구간을 찾는 매처(리터럴/정규식 공통 추상). */
export interface LineMatcher {
  /** line 내 모든 일치 구간 [start, end)(0-기준·end 배타). 무일치면 빈 배열. */
  match(line: string): [number, number][]
}

/** 청크 단위 read 를 제공하는 파일 리더(주입형). read(buf)=0 이면 EOF. */
export interface GrepFileReader {
  read(buf: Uint8Array): Promise<number>
  close(): Promise<void>
}

/** 디렉토리 항목(열거 결과). symlink 는 미추종(상위가 skip). */
export interface GrepDirent {
  readonly name: string
  readonly path: string
  readonly isDir: boolean
  readonly isFile: boolean
  readonly isSymlink: boolean
  /** 파일 크기(바이트). 디렉토리/링크는 0. */
  readonly size: number
  /** 숨김/시스템(includeHidden=false 면 상위가 skip). */
  readonly hidden: boolean
  /** 확장자(소문자·선행 '.' 제외). */
  readonly ext: string
}

/** grepEngine 이 fs 와 결합하는 의존(주입형). */
export interface GrepEngineDeps {
  /** dir 의 직속 항목 열거(lstat 기반·심볼릭 미추종 정보 포함). 실패 시 throw — 상위 catch 로 skip. */
  readDir(dir: string): Promise<GrepDirent[]>
  /** path 의 청크 리더 생성. 실패 시 throw — 상위 catch 로 skip. */
  openReader(path: string): Promise<GrepFileReader>
  /** 순환 차단용 realpath(베스트에포트). 실패 시 입력 그대로. */
  realpath(dir: string): Promise<string>
}

/** 엔진이 상위(Worker/검증)에 보고/질의하는 훅(scanEngine ScanHooks 동형). */
export interface GrepHooks {
  /** 진행 보고(누적 스캔/일치 파일 + 현재 경로). 상위가 200ms 스로틀. */
  onProgress(scannedFiles: number, matchedFiles: number, currentPath: string): void
  /** 파일 1건 일치 결과 증분 푸시(파일 단위). */
  onMatch(file: string, lines: GrepLineHit[]): void
  /** 협조적 취소 폴링. true 면 안전 지점(청크/파일 경계)에서 중단. */
  shouldCancel(): boolean
}

/** grep 실행 옵션(핸들러 정규화 완료 값 + 엔진 상한 주입). */
export interface GrepOptions {
  readonly root: string
  readonly query: string
  readonly isRegex: boolean
  readonly recursive: boolean
  readonly includeHidden: boolean
  readonly maxFileBytes: number
  /** 전체 결과 상한(검증에서 truncated 재현용 주입 — 미지정 시 GREP_TOTAL_MATCH_CAP). */
  readonly totalCap?: number
  /** 파일별 일치 줄 상한(검증 주입 — 미지정 시 GREP_PER_FILE_MATCH_CAP). */
  readonly perFileCap?: number
}

/** grep 종료 요약(엔진 → Worker → done evt). */
export interface GrepResult {
  readonly totalMatches: number
  readonly scannedFiles: number
  readonly matchedFiles: number
  readonly truncated: boolean
  readonly canceled: boolean
}

/**
 * 리터럴 부분 일치 매처. line 내 query 의 모든 출현 구간을 찾는다(겹치지 않게 전진).
 * 대소문자 구분(1차) — ADR-010 1차 범위(case toggle 은 후속).
 */
export function literalMatcher(query: string): LineMatcher {
  return {
    match(line: string): [number, number][] {
      const ranges: [number, number][] = []
      if (query.length === 0) return ranges
      let from = 0
      for (;;) {
        const idx = line.indexOf(query, from)
        if (idx < 0) break
        ranges.push([idx, idx + query.length])
        from = idx + query.length
      }
      return ranges
    }
  }
}

/**
 * 정규식 매처(global). 컴파일 실패는 null 반환(상위가 Result.err — throw 0).
 * 빈 매치(zero-width) 무한루프 방지를 위해 lastIndex 를 강제 전진시킨다.
 */
export function regexMatcher(source: string): LineMatcher | null {
  let re: RegExp
  try {
    re = new RegExp(source, 'g')
  } catch {
    return null
  }
  return {
    match(line: string): [number, number][] {
      const ranges: [number, number][] = []
      re.lastIndex = 0
      let guard = 0
      for (;;) {
        const m = re.exec(line)
        if (m === null) break
        const start = m.index
        const end = start + m[0].length
        ranges.push([start, end])
        // zero-width 매치(빈 문자열) → lastIndex 전진(무한루프 차단).
        if (end === start) re.lastIndex = end + 1
        if (++guard > GREP_PER_FILE_MATCH_CAP * 4) break // 폭주 안전 상한.
        if (re.lastIndex > line.length) break
      }
      return ranges
    }
  }
}

/** isRegex 에 따라 매처 생성. 정규식 컴파일 실패 시 null(상위 Result.err). */
export function compileMatcher(query: string, isRegex: boolean): LineMatcher | null {
  return isRegex ? regexMatcher(query) : literalMatcher(query)
}

const decoder = new TextDecoder('utf-8', { fatal: false })

/**
 * 단일 파일을 스트리밍 라인 스캔한다. 매처는 미리 컴파일된 LineMatcher.
 *  - 청크 read → LF 로 라인 분할 → 각 줄 매칭 → 일치 시 GrepLineHit 누적.
 *  - 라인 길이 상한 초과 줄은 상한까지만 버퍼링(잔여 LF 까지 스킵).
 *  - perFileCap 도달 시 그 파일 truncated.
 *  - 청크 경계 취소 폴링 → 취소면 지금까지 결과 반환(부분).
 */
export async function grepFile(
  reader: GrepFileReader,
  matcher: LineMatcher,
  perFileCap: number,
  hooks: GrepHooks
): Promise<GrepFileResult> {
  const lines: GrepLineHit[] = []
  const buf = new Uint8Array(GREP_READ_CHUNK_BYTES)
  let pending = '' // 현재까지의 (불완전) 라인 텍스트(상한까지).
  let lineNo = 0
  let overLimit = false // 현재 줄이 상한 초과되어 잔여를 스킵 중인가.
  let truncated = false

  const flushLine = (raw: string): boolean => {
    // raw 는 LF 제외·CR 제거 전. CRLF 의 CR 제거.
    let text = raw
    if (text.endsWith('\r')) text = text.slice(0, -1)
    lineNo++
    const ranges = matcher.match(text)
    if (ranges.length > 0) {
      lines.push({ lineNo, text, ranges })
      if (lines.length >= perFileCap) {
        truncated = true
        return false // 더 이상 누적 안 함.
      }
    }
    return true
  }

  try {
    for (;;) {
      if (hooks.shouldCancel()) break
      let n: number
      try {
        n = await reader.read(buf)
      } catch {
        break // read 실패 — 부분 결과로 종료.
      }
      if (n <= 0) break // EOF
      const chunk = decoder.decode(n === buf.length ? buf : buf.subarray(0, n), { stream: true })
      let segStart = 0
      for (let i = 0; i < chunk.length; i++) {
        if (chunk.charCodeAt(i) !== 10) continue // LF 아님.
        const seg = chunk.slice(segStart, i)
        segStart = i + 1
        if (overLimit) {
          // 상한 초과 줄의 종료 — pending(상한까지)만 flush, 잔여 seg 는 버림.
          overLimit = false
          if (!flushLine(pending)) {
            pending = ''
            return { lines, truncated }
          }
          pending = ''
        } else {
          const full = pending + seg
          pending = ''
          if (!flushLine(full)) return { lines, truncated }
        }
      }
      // 청크 잔여(LF 없음) → pending 에 누적(상한까지).
      if (!overLimit) {
        const rest = chunk.slice(segStart)
        if (pending.length + rest.length > GREP_MAX_LINE_LEN) {
          pending = (pending + rest).slice(0, GREP_MAX_LINE_LEN)
          overLimit = true // 이후 이 줄의 잔여는 LF 까지 스킵.
        } else {
          pending += rest
        }
      }
      // overLimit 인 동안 segStart..end 잔여는 무시(다음 LF 가 줄 종료).
    }
  } finally {
    await reader.close().catch(() => undefined)
  }

  // 파일이 LF 로 끝나지 않은 마지막 줄 처리(취소가 아니면).
  if (!hooks.shouldCancel() && (pending.length > 0 || overLimit) && lines.length < perFileCap) {
    flushLine(pending)
  }
  return { lines, truncated }
}

/**
 * root 부터 디렉토리를 순회하며 텍스트 파일을 grep 한다(파일 단위 증분 푸시).
 * 진행률은 onProgress, 일치는 onMatch 로 보고. 매처는 호출 전 컴파일(GrepManager).
 */
export async function runGrep(
  matcher: LineMatcher,
  opts: GrepOptions,
  hooks: GrepHooks,
  deps: GrepEngineDeps
): Promise<GrepResult> {
  const totalCap = opts.totalCap && opts.totalCap > 0 ? opts.totalCap : GREP_TOTAL_MATCH_CAP
  const perFileCap = opts.perFileCap && opts.perFileCap > 0 ? opts.perFileCap : GREP_PER_FILE_MATCH_CAP
  const visited = new Set<string>()
  const state = {
    totalMatches: 0,
    scannedFiles: 0,
    matchedFiles: 0,
    truncated: false,
    canceled: false
  }

  const sniff = new Uint8Array(BINARY_SNIFF_BYTES)

  async function isBinaryFile(d: GrepDirent): Promise<boolean> {
    if (isBinaryByExt(d.ext)) return true
    // 확장자 불명확 → 앞부분 샘플 휴리스틱.
    let reader: GrepFileReader
    try {
      reader = await deps.openReader(d.path)
    } catch {
      return true // 열기 실패 → 스킵(바이너리 취급).
    }
    try {
      const n = await reader.read(sniff)
      if (n <= 0) return false // 빈 파일 → 텍스트.
      return isBinaryBySample(sniff.subarray(0, n))
    } catch {
      return true
    } finally {
      await reader.close().catch(() => undefined)
    }
  }

  async function scanFile(d: GrepDirent): Promise<void> {
    if (state.canceled || state.truncated) return
    if (d.size > opts.maxFileBytes) return // 크기 상한 초과 스킵.
    if (await isBinaryFile(d)) return
    state.scannedFiles++
    hooks.onProgress(state.scannedFiles, state.matchedFiles, d.path)

    let reader: GrepFileReader
    try {
      reader = await deps.openReader(d.path)
    } catch {
      return // 읽기 실패 — 격리.
    }
    const res = await grepFile(reader, matcher, perFileCap, hooks)
    if (res.lines.length > 0) {
      state.matchedFiles++
      state.totalMatches += res.lines.length
      hooks.onMatch(d.path, res.lines)
      hooks.onProgress(state.scannedFiles, state.matchedFiles, d.path)
      if (state.totalMatches >= totalCap) state.truncated = true
    }
  }

  async function walk(dir: string): Promise<void> {
    if (state.canceled || state.truncated) return
    if (hooks.shouldCancel()) {
      state.canceled = true
      return
    }
    // 순환 차단(베스트에포트 realpath).
    let real: string
    try {
      real = await deps.realpath(dir)
    } catch {
      real = dir
    }
    if (visited.has(real)) return
    visited.add(real)

    let dirents: GrepDirent[]
    try {
      dirents = await deps.readDir(dir)
    } catch {
      return // 권한거부 등 — 디렉토리 격리.
    }

    // 파일 먼저(첫 결과 빠르게), 그 다음 하위 폴더 재귀.
    for (const d of dirents) {
      if (state.canceled || state.truncated) return
      if (hooks.shouldCancel()) {
        state.canceled = true
        return
      }
      if (d.isSymlink) continue // 링크 미추종.
      if (!opts.includeHidden && d.hidden) continue
      if (d.isFile) await scanFile(d)
    }
    if (opts.recursive) {
      for (const d of dirents) {
        if (state.canceled || state.truncated) return
        if (d.isSymlink) continue
        if (!opts.includeHidden && d.hidden) continue
        if (d.isDir) await walk(d.path)
      }
    }
  }

  await walk(opts.root)
  if (hooks.shouldCancel()) state.canceled = true
  hooks.onProgress(state.scannedFiles, state.matchedFiles, opts.root)

  return {
    totalMatches: state.totalMatches,
    scannedFiles: state.scannedFiles,
    matchedFiles: state.matchedFiles,
    truncated: state.truncated,
    canceled: state.canceled
  }
}
