/**
 * src/main/agent/readBackend.ts — ReadToolBackend 실서비스 어댑터(§Z Z1).
 *
 * toolRegistry 의 `ReadToolBackend`(읽기 6종)를 **기존 Main 읽기 서비스/엔진** 에 직접 배선한다
 * (IPC 왕복 0). 경로 인자는 toolRegistry.executeTool 이 이미 guardPath + scope.assertInScope 로
 * 재검증한 뒤 넘기므로, 여기서는 서비스 호출 + **결과를 모델용 텍스트/JSON 으로 직렬화**(상한
 * 절단은 Orchestrator.clampToolResult)만 한다.
 *
 * 매핑(읽기 6종):
 *   - list_directory  → FileSystemService.list (DirListResult)
 *   - search_content  → grepEngine.runGrep + grepEngineDeps (GrepResult + 파일별 hit 수집)
 *   - read_preview    → FileSystemService.readPreview (PreviewData; 동의 false 면 본문 제거)
 *   - scan_folder     → scanEngine.runScan (ScanResult)
 *   - find_duplicates → dupEngine.findDuplicates + dupEngineDeps (DupGroupDTO[])
 *   - compare_folders → compareEngine.runCompare + compareEngineDeps (CompareResultDTO)
 *
 * 정직: 서비스/엔진은 환경 비의존 deps 를 받는 실 구현(fsDeps)을 재사용 — 실 fs IO. 본 어댑터의
 * 실 동작(실 파일 왕복)은 런타임 스모크 🟡. 의존 주입형이라 verify 는 스텁 서비스로 직렬화/절단/
 * 동의 분기를 헤드리스 검증한다(createReadBackend(deps) 시그니처).
 */
import type { ReadToolBackend, ToolExecResult } from './toolRegistry'
import {
  AGENT_SEARCH_MAX_MATCHED_FILES,
  AGENT_SEARCH_MAX_SCANNED_FILES,
  AGENT_SEARCH_TIME_BUDGET_MS,
  AGENT_TOOL_PROGRESS_THROTTLE_MS,
  AGENT_TOOL_PROGRESS_THROTTLE_FILES,
  AGENT_TOOL_PROGRESS_PATH_MAX
} from './limits'

// ── 직렬화 상한(개별 항목 수 — 토큰 폭주 1차 방어. 문자 절단은 Orchestrator) ──
const MAX_LIST_ENTRIES = 200
const MAX_SCAN_TOP = 10
const MAX_DUP_GROUPS = 50
const MAX_DUP_FILES_PER_GROUP = 20
const MAX_GREP_FILES = 100
const MAX_GREP_LINES_PER_FILE = 20
const MAX_COMPARE_PAIRS = 300
/** read_preview(동의 시) 본문 직렬화 상한(문자). */
const MAX_PREVIEW_TEXT = 8_000

/** 어댑터가 의존하는 실서비스/엔진(주입형 — verify 스텁 대체 가능). */
export interface ReadBackendDeps {
  /** FileSystemService.list 동형(Result<DirListResult>). */
  list(path: string, showHidden: boolean): Promise<{
    ok: boolean
    value?: { entries: ReadonlyArray<{ name: string; isDir: boolean; size: number; mtime: number; ext: string }>; truncated: boolean }
    error?: { message: string }
  }>
  /** FileSystemService.readPreview 동형(PreviewData). */
  readPreview(path: string): Promise<{
    kind: string
    name: string
    size: number
    mtime: number
    ext: string
    text?: string
    reason?: string
    truncated?: boolean
  }>
  /** scanEngine.runScan 동형(ScanResult). */
  scan(root: string, shouldCancel: () => boolean): Promise<{
    totalBytes: number
    totalItems: number
    topFolders: ReadonlyArray<{ name: string; path: string; bytes: number }>
    topFiles: ReadonlyArray<{ name: string; path: string; bytes: number }>
    skipped: number
    canceled: boolean
    truncated: boolean
  }>
  /**
   * grepEngine.runGrep 어댑터(파일별 hit 수집 후 반환). onProgress(주입) 가 있으면 트리 워크 중
   * **파일마다** 누적(scanned/matched/current)을 보고한다(어댑터가 스로틀). shouldCancel 은 결과/
   * 스캔 상한·시간 예산 조기 종료 + 거대 디렉토리 스킵을 합친 협조 취소다(§Z 프리징 완화).
   */
  search(
    root: string,
    query: string,
    opts: { regex: boolean; recursive: boolean },
    shouldCancel: () => boolean,
    onProgress?: (scanned: number, matched: number, current: string) => void
  ): Promise<{
    files: ReadonlyArray<{ file: string; lines: ReadonlyArray<{ lineNo: number; text: string }> }>
    totalMatches: number
    matchedFiles: number
    truncated: boolean
    canceled: boolean
    invalidRegex?: boolean
  }>
  /** dupEngine.findDuplicates 어댑터. */
  dup(roots: readonly string[], shouldCancel: () => boolean): Promise<{
    groups: ReadonlyArray<{ hash: string; size: number; files: ReadonlyArray<{ path: string }> }>
    truncated: boolean
  }>
  /** compareEngine.runCompare 어댑터. */
  compare(leftDir: string, rightDir: string, shouldCancel: () => boolean): Promise<{
    pairs: ReadonlyArray<{ name: string; status: string; relPath?: string }>
    summary: { leftOnly: number; rightOnly: number; diff: number; same: number; total: number }
    truncated: boolean
  }>
  /**
   * §Z open_tab 존재 검증용 경량 stat(주입형). 경로 존재/디렉토리 여부만 반환(throw 0 — 없으면
   * {exists:false}). FileSystemService.stat(lstat 기반) 동형. verify 는 스텁으로 분기 검증.
   */
  statPath?(path: string): Promise<{ exists: boolean; isDir: boolean }>
}

/** 바이트 → 사람이 읽는 단위(간결 표기). */
function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(1)} ${units[i]}`
}

function jsonResult(obj: unknown): ToolExecResult {
  return { content: JSON.stringify(obj) }
}

/** tool-progress current 경로 새니타이즈 — 제어문자 제거 + 길이 절단(토큰·로그 폭주 방지). */
function sanitizePath(p: string): string {
  if (!p) return ''
  // 제어문자(개행·탭 등·U+0000..U+001F, U+007F) 공백화 — 진행 라인 1줄 표시 보장.
  // eslint-disable-next-line no-control-regex
  const clean = p.replace(/[\u0000-\u001f\u007f]/g, ' ')
  return clean.length > AGENT_TOOL_PROGRESS_PATH_MAX
    ? '…' + clean.slice(clean.length - AGENT_TOOL_PROGRESS_PATH_MAX + 1)
    : clean
}

/** 조기 종료 사유 → 사람이 읽는 표기(결과 note 용·정직 표기). */
function describeBound(reason: 'matched-cap' | 'scanned-cap' | 'time-budget'): string {
  switch (reason) {
    case 'matched-cap':
      return `결과 상한 ${AGENT_SEARCH_MAX_MATCHED_FILES}개 파일 도달`
    case 'scanned-cap':
      return `스캔 상한 ${AGENT_SEARCH_MAX_SCANNED_FILES}파일 도달`
    case 'time-budget':
      return `시간 예산 ${Math.round(AGENT_SEARCH_TIME_BUDGET_MS / 1000)}초 초과`
  }
}

/**
 * 실서비스 deps 로 ReadToolBackend 를 구성한다. signal 은 협조 취소 폴링용(엔진 shouldCancel).
 * 모든 메서드는 throw 0(executeTool 이 try/catch 로 감싸지만 어댑터도 결과로 직렬화).
 */
export function createReadBackend(deps: ReadBackendDeps, signal?: AbortSignal): ReadToolBackend {
  const shouldCancel = (): boolean => signal?.aborted === true
  const depsStat = deps.statPath

  return {
    // §Z open_tab 존재 검증 — deps.statPath 가 있을 때만 노출(throw 0). 미존재 시 {exists:false}.
    ...(depsStat
      ? {
          async statPath(path: string): Promise<{ exists: boolean; isDir: boolean }> {
            try {
              return await depsStat(path)
            } catch {
              return { exists: false, isDir: false }
            }
          }
        }
      : {}),
    async list(path: string, showHidden: boolean): Promise<ToolExecResult> {
      const r = await deps.list(path, showHidden)
      if (!r.ok || !r.value) {
        return { content: `디렉토리 목록 실패: ${r.error?.message ?? '알 수 없음'}`, isError: true }
      }
      const entries = r.value.entries.slice(0, MAX_LIST_ENTRIES).map((e) => ({
        name: e.name,
        type: e.isDir ? 'dir' : 'file',
        size: e.isDir ? undefined : e.size,
        mtime: new Date(e.mtime).toISOString(),
        ext: e.ext || undefined
      }))
      return jsonResult({
        path,
        count: r.value.entries.length,
        shown: entries.length,
        truncated: r.value.truncated || r.value.entries.length > MAX_LIST_ENTRIES,
        entries
      })
    },

    async search(root, query, opts, onToolProgress): Promise<ToolExecResult> {
      // ── walk 바운드(§Z 프리징 근본) + 진행 스로틀(어댑터 레벨·전역 grep 무변) ──
      const startedAt = Date.now()
      // 라이브 카운터 — onProgress 가 파일마다 갱신, earlyStop 이 읽는다.
      let lastScanned = 0
      let lastMatched = 0
      // 조기 종료 사유(부분 결과 + "일부만" 표기용).
      let boundedReason: '' | 'matched-cap' | 'scanned-cap' | 'time-budget' = ''
      // 스로틀 상태.
      let lastPushMs = 0
      let lastPushScanned = 0

      const earlyStop = (): boolean => {
        if (shouldCancel()) return true
        if (lastMatched >= AGENT_SEARCH_MAX_MATCHED_FILES) {
          boundedReason = 'matched-cap'
          return true
        }
        if (lastScanned >= AGENT_SEARCH_MAX_SCANNED_FILES) {
          boundedReason = 'scanned-cap'
          return true
        }
        if (Date.now() - startedAt >= AGENT_SEARCH_TIME_BUDGET_MS) {
          boundedReason = 'time-budget'
          return true
        }
        return false
      }

      // 엔진은 onProgress 를 파일마다 호출 — 여기서 카운터 갱신 + 스로틀 후 상위로 전달.
      const rawProgress = (scanned: number, matched: number, current: string): void => {
        lastScanned = scanned
        lastMatched = matched
        if (!onToolProgress) return
        const now = Date.now()
        if (now - lastPushMs >= AGENT_TOOL_PROGRESS_THROTTLE_MS || scanned - lastPushScanned >= AGENT_TOOL_PROGRESS_THROTTLE_FILES) {
          lastPushMs = now
          lastPushScanned = scanned
          onToolProgress(scanned, matched, sanitizePath(current))
        }
      }

      const r = await deps.search(
        root,
        query,
        { regex: opts.regex ?? false, recursive: opts.recursive ?? true },
        earlyStop,
        rawProgress
      )
      if (r.invalidRegex) {
        return { content: `정규식 컴파일 실패: ${query}`, isError: true }
      }
      // 마지막 진행 1회 보장(스로틀로 누락된 최종 카운트 — onToolProgress 있을 때만).
      if (onToolProgress && lastScanned > lastPushScanned) {
        onToolProgress(lastScanned, lastMatched, '')
      }
      const files = r.files.slice(0, MAX_GREP_FILES).map((f) => ({
        file: f.file,
        matches: f.lines.slice(0, MAX_GREP_LINES_PER_FILE).map((l) => ({ line: l.lineNo, text: l.text }))
      }))
      // 조기 종료(walk 바운드)면 부분 결과임을 정직 표기(✅위장 금지).
      const bounded = boundedReason !== ''
      const note = boundedReason !== ''
        ? `일부만 검색됨(${lastScanned}파일 스캔·${describeBound(boundedReason)})`
        : undefined
      return jsonResult({
        root,
        query,
        regex: opts.regex ?? false,
        recursive: opts.recursive ?? true,
        totalMatches: r.totalMatches,
        matchedFiles: r.matchedFiles,
        scannedFiles: lastScanned,
        truncated: r.truncated || r.files.length > MAX_GREP_FILES || bounded,
        canceled: r.canceled,
        bounded,
        ...(note ? { note } : {}),
        files
      })
    },

    async preview(path, contentConsent): Promise<ToolExecResult> {
      const p = await deps.readPreview(path)
      const base = {
        name: p.name,
        path,
        kind: p.kind,
        size: p.size,
        sizeHuman: humanBytes(p.size),
        mtime: new Date(p.mtime).toISOString(),
        ext: p.ext || undefined,
        reason: p.reason
      }
      // 동의 없으면 메타만(본문/이미지 데이터 미수록 — SG-4).
      if (!contentConsent) {
        return jsonResult({ ...base, contentIncluded: false })
      }
      // 동의 시: 텍스트만 본문 포함(이미지 base64 는 모델에 무의미·토큰 폭주 → 제외).
      if (p.kind === 'text' && typeof p.text === 'string') {
        const text = p.text.length > MAX_PREVIEW_TEXT ? p.text.slice(0, MAX_PREVIEW_TEXT) : p.text
        return jsonResult({
          ...base,
          contentIncluded: true,
          truncated: p.truncated === true || p.text.length > MAX_PREVIEW_TEXT,
          text
        })
      }
      return jsonResult({ ...base, contentIncluded: false })
    },

    async scan(root): Promise<ToolExecResult> {
      const r = await deps.scan(root, shouldCancel)
      return jsonResult({
        root,
        totalBytes: r.totalBytes,
        totalSizeHuman: humanBytes(r.totalBytes),
        totalItems: r.totalItems,
        skipped: r.skipped,
        canceled: r.canceled,
        truncated: r.truncated,
        topFolders: r.topFolders.slice(0, MAX_SCAN_TOP).map((f) => ({ name: f.name, path: f.path, size: humanBytes(f.bytes) })),
        topFiles: r.topFiles.slice(0, MAX_SCAN_TOP).map((f) => ({ name: f.name, path: f.path, size: humanBytes(f.bytes) }))
      })
    },

    async dup(roots): Promise<ToolExecResult> {
      const r = await deps.dup(roots, shouldCancel)
      const groups = r.groups.slice(0, MAX_DUP_GROUPS).map((g) => ({
        size: g.size,
        sizeHuman: humanBytes(g.size),
        copies: g.files.length,
        files: g.files.slice(0, MAX_DUP_FILES_PER_GROUP).map((f) => f.path)
      }))
      return jsonResult({
        roots,
        groupCount: r.groups.length,
        shown: groups.length,
        truncated: r.truncated || r.groups.length > MAX_DUP_GROUPS,
        groups
      })
    },

    async compare(leftDir, rightDir): Promise<ToolExecResult> {
      const r = await deps.compare(leftDir, rightDir, shouldCancel)
      const pairs = r.pairs
        .filter((p) => p.status !== 'same')
        .slice(0, MAX_COMPARE_PAIRS)
        .map((p) => ({ name: p.relPath ?? p.name, status: p.status }))
      return jsonResult({
        leftDir,
        rightDir,
        summary: r.summary,
        truncated: r.truncated || r.pairs.length > MAX_COMPARE_PAIRS,
        diffPairs: pairs
      })
    }
  }
}
