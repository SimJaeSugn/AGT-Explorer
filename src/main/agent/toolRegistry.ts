/**
 * src/main/agent/toolRegistry.ts — 도구 레지스트리(읽기 전용·JSON Schema 1벌·ADR-014 결정③).
 *
 * **Z0 범위: 읽기 도구 6종만**(list/search/preview/scan/dup/compare). 쓰기 도구(move/copy/
 * rename/mkdir/trash)는 선언·구현 금지(Z2 범위). 도구는 **JSON Schema 입력 스키마로 단일
 * 정의** 되어 normalize 어댑터가 제공자 포맷으로 직렬화한다(포맷 무지).
 *
 * 실행 백엔드(`ReadToolBackend`)는 **주입 가능 인터페이스** — 기본 구현은 기존 Main 읽기 서비스
 * (FileSystemService·GrepManager·ScanManager·HashManager·compare)를 IPC 왕복 없이 직접 호출하고,
 * 헤드리스 verify 는 스텁을 주입한다. 경로 인자는 호출 전 guardPath + scope.assertInScope 를
 * 통과해야 한다(미등록 도구·스코프 밖 경로는 is_error tool_result).
 */
import type { AgentLocations, Result } from '@shared/ipc/contracts'
import { err, ok } from '@shared/ipc/contracts'
import { fileOpError } from '../fs/errors'
import type { NormalizedToolDef } from './provider/LLMProvider'
import type { AgentScope } from './scope'
import { assertInScope, isVirtualPath } from './scope'

/**
 * 도구 분류:
 *   - read=즉시 실행(파일 읽기) / write=stage(Z2·plan→confirm).
 *   - navigate=즉시 실행하는 **비파괴 내비게이션 액션**(파일 미변경·확인 불요). read 처럼 즉시
 *     실행되지만 백엔드 IO 대신 렌더러 상태 변경(open_tab → tabsSlice.newTab)을 디스패치한다.
 * Z0 은 read·navigate 만 등록(write 미등록).
 */
export type ToolMode = 'read' | 'write' | 'navigate'

/**
 * 렌더러 디스패치 액션(비파괴 내비게이션·§Z open_tab). 도구가 메인 루프에서 실행되지만
 * "탭 열기"는 렌더러 상태 변경이라, 핸들러가 주입한 콜백으로 렌더러에 디스패치한다.
 */
export type DispatchAction = { readonly action: 'open-tab'; readonly path: string }

/**
 * 장시간 도구(트리 워크) 진행 보고(§Z 프리징 완화). 도구 어댑터가 스로틀해 호출하면
 * 오케스트레이터가 tool-progress 이벤트로 중계한다. 진행 통지일 뿐 결과/제어와 무관(놓쳐도 안전).
 */
export interface ToolProgress {
  readonly tool: string
  readonly scanned: number
  readonly matched: number
  readonly current?: string
}

/** 도구 실행 결과(tool_result content 로 직렬화될 요약 + 오류 표시). */
export interface ToolExecResult {
  /** 모델에게 회신할 요약 텍스트(상한 절단은 Orchestrator). */
  readonly content: string
  readonly isError?: boolean
}

/** 경로 정규화 훅 — 핸들러의 guardPath 동형(주입 가능·verify 스텁). */
export type GuardPathFn = (input: string) => Result<string>

/**
 * 읽기 도구 실행 백엔드(주입 가능). 기본 구현은 기존 Main 서비스 직접 호출.
 * 각 메서드는 이미 guardPath + scope 를 통과한 경로를 받는다.
 */
export interface ReadToolBackend {
  list(path: string, showHidden: boolean): Promise<ToolExecResult>
  /**
   * 내용 검색. onProgress(주입) 가 있으면 어댑터가 트리 워크 중 스로틀된 진행을 보고한다(§Z
   * 프리징 완화). 미주입 시 기존 동작과 동치(진행 보고 0). 어댑터는 결과/스캔 상한·시간 예산
   * 도달 시 walk 를 조기 종료한다(부분 결과 + "일부만" 표기).
   */
  search(
    root: string,
    query: string,
    opts: { regex?: boolean; recursive?: boolean },
    onProgress?: (scanned: number, matched: number, current: string) => void
  ): Promise<ToolExecResult>
  preview(path: string, contentConsent: boolean): Promise<ToolExecResult>
  scan(root: string): Promise<ToolExecResult>
  dup(roots: readonly string[]): Promise<ToolExecResult>
  compare(leftDir: string, rightDir: string): Promise<ToolExecResult>
  /**
   * §Z open_tab 존재 검증용 경량 stat(주입형·verify 스텁). 경로 존재/디렉토리 여부만 반환한다
   * (실 fs IO 0 인 verify 는 스텁으로 분기 검증). 미구현 백엔드(레거시)는 옵셔널 — 미존재 시
   * open_tab 은 존재 검증을 건너뛰지 않고 "검증 불가"로 보수적 거부(환각 경로 dispatch 방지).
   */
  statPath?(path: string): Promise<{ exists: boolean; isDir: boolean }>
}

/** 도구 실행 시 주입되는 비-경로 컨텍스트(백엔드·동의·이름있는 위치·렌더러 디스패치). */
export interface ToolRunCtx {
  readonly backend: ReadToolBackend
  readonly contentConsent: boolean
  /** §Z list_locations 패스스루용 — 렌더러가 모은 이름 있는 위치(없으면 빈 모음). */
  readonly locations: AgentLocations
  /**
   * §Z open_tab 등 비파괴 내비게이션 액션을 렌더러로 디스패치(핸들러가 event.sender.send 로 배선·
   * verify 는 스파이 주입). 미주입(undefined) 시 navigate 도구는 디스패치 불가로 is_error.
   */
  readonly dispatchAction?: (action: DispatchAction) => void
  /**
   * §Z 장시간 도구 진행 보고(트리 워크 프리징 완화). 주입되면 search_content 어댑터가
   * 스로틀된 진행(스캔/일치/현재경로)을 보고하고, 오케스트레이터가 tool-progress 이벤트로 중계한다.
   * 미주입 시 진행 보고 0(기존 동작 동치). verify 는 스파이로 주입해 스로틀 전달을 단언한다.
   */
  readonly onToolProgress?: (p: ToolProgress) => void
}

/** 도구 1종 정의(스키마 + 경로 인자 키 + 디스패처). */
export interface ToolEntry {
  readonly def: NormalizedToolDef
  readonly mode: ToolMode
  /** 입력에서 스코프 검증할 경로 인자 추출(문자열 경로 배열). */
  readonly pathArgs: (input: Record<string, unknown>) => readonly string[]
  readonly run: (input: Record<string, unknown>, ctx: ToolRunCtx) => Promise<ToolExecResult>
}

const STR = { type: 'string' } as const

// ── 읽기 도구 6종 정의(JSON Schema 1벌) ───────────────────────────────────

const TOOLS: Readonly<Record<string, ToolEntry>> = {
  list_directory: {
    mode: 'read',
    def: {
      name: 'list_directory',
      description: '디렉토리의 파일·폴더 목록과 메타(크기·수정시각·종류)를 반환한다.',
      inputSchema: {
        type: 'object',
        properties: { path: STR, showHidden: { type: 'boolean' } },
        required: ['path'],
        additionalProperties: false
      }
    },
    pathArgs: (i) => [String(i['path'] ?? '')],
    run: (i, c) => c.backend.list(String(i['path'] ?? ''), Boolean(i['showHidden']))
  },
  search_content: {
    mode: 'read',
    def: {
      name: 'search_content',
      description: '폴더 하위 파일 내용을 텍스트/정규식으로 검색하고 일치 위치를 반환한다.',
      inputSchema: {
        type: 'object',
        properties: {
          root: STR,
          query: STR,
          regex: { type: 'boolean' },
          recursive: { type: 'boolean' }
        },
        required: ['root', 'query'],
        additionalProperties: false
      }
    },
    pathArgs: (i) => [String(i['root'] ?? '')],
    run: (i, c) =>
      c.backend.search(
        String(i['root'] ?? ''),
        String(i['query'] ?? ''),
        {
          regex: Boolean(i['regex']),
          recursive: i['recursive'] === undefined ? true : Boolean(i['recursive'])
        },
        // 진행 콜백 주입(있을 때만) — 어댑터가 스로틀해 호출, 오케스트레이터가 tool-progress 중계.
        c.onToolProgress
          ? (scanned, matched, current) =>
              c.onToolProgress!({ tool: 'search_content', scanned, matched, ...(current ? { current } : {}) })
          : undefined
      )
  },
  read_preview: {
    mode: 'read',
    def: {
      name: 'read_preview',
      description:
        '파일 미리보기(메타+요약). 실내용은 사용자 동의(contentConsent) 시에만 포함되고, 아니면 메타만 반환한다.',
      inputSchema: {
        type: 'object',
        properties: { path: STR },
        required: ['path'],
        additionalProperties: false
      }
    },
    pathArgs: (i) => [String(i['path'] ?? '')],
    run: (i, c) => c.backend.preview(String(i['path'] ?? ''), c.contentConsent)
  },
  scan_folder: {
    mode: 'read',
    def: {
      name: 'scan_folder',
      description: '폴더 하위를 재귀 스캔해 용량·항목 수·확장자 분포 등 집계를 반환한다.',
      inputSchema: {
        type: 'object',
        properties: { root: STR },
        required: ['root'],
        additionalProperties: false
      }
    },
    pathArgs: (i) => [String(i['root'] ?? '')],
    run: (i, c) => c.backend.scan(String(i['root'] ?? ''))
  },
  find_duplicates: {
    mode: 'read',
    def: {
      name: 'find_duplicates',
      description: '주어진 폴더들에서 내용이 동일한 중복 파일 그룹을 해시로 찾는다.',
      inputSchema: {
        type: 'object',
        properties: { roots: { type: 'array', items: STR } },
        required: ['roots'],
        additionalProperties: false
      }
    },
    pathArgs: (i) => (Array.isArray(i['roots']) ? (i['roots'] as unknown[]).map(String) : []),
    run: (i, c) => c.backend.dup(Array.isArray(i['roots']) ? (i['roots'] as unknown[]).map(String) : [])
  },
  compare_folders: {
    mode: 'read',
    def: {
      name: 'compare_folders',
      description: '두 폴더를 비교해 좌/우 전용·동일·다른 항목을 반환한다.',
      inputSchema: {
        type: 'object',
        properties: { leftDir: STR, rightDir: STR },
        required: ['leftDir', 'rightDir'],
        additionalProperties: false
      }
    },
    pathArgs: (i) => [String(i['leftDir'] ?? ''), String(i['rightDir'] ?? '')],
    run: (i, c) => c.backend.compare(String(i['leftDir'] ?? ''), String(i['rightDir'] ?? ''))
  },
  open_tab: {
    mode: 'navigate',
    def: {
      name: 'open_tab',
      description:
        '새 탭을 열고 지정한 로컬 폴더 경로로 이동한다. 파일을 바꾸지 않는 내비게이션 액션이며 ' +
        '즉시 실행된다(확인 불요). 사용자가 "거기로 이동해줘", "그 폴더 열어줘" 처럼 위치 이동을 ' +
        '원하면 이 도구를 쓴다. 이름으로 위치를 가리키면 먼저 list_locations 로 실제 경로를 찾아라.',
      inputSchema: {
        type: 'object',
        properties: { path: STR },
        required: ['path'],
        additionalProperties: false
      }
    },
    pathArgs: (i) => [String(i['path'] ?? '')],
    run: (i, c) => runOpenTab(String(i['path'] ?? ''), c)
  },
  list_locations: {
    mode: 'read',
    def: {
      name: 'list_locations',
      description:
        '사용자가 이름으로 알고 있는 위치(즐겨찾기·빠른 위치·최근 방문·드라이브·열린 패널 1~4)와 ' +
        '각각의 실제 경로를 반환한다. 사용자가 "즐겨찾기 프로젝트A" 처럼 경로 대신 이름으로 ' +
        '위치를 가리키면 먼저 이 도구로 이름→경로를 찾은 뒤, 그 경로로 list_directory 등을 호출하라. ' +
        'fs 접근 없음(이름 매칭용 메타데이터만).',
      inputSchema: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            enum: ['favorites', 'quickAccess', 'recent', 'drives', 'panels'],
            description: '특정 분류만 보고 싶을 때 지정(생략하면 전부 반환).'
          }
        },
        additionalProperties: false
      }
    },
    // 경로 인자 없음(패스스루) — 스코프 검증 대상 경로 0.
    pathArgs: () => [],
    run: (i, c) => runListLocations(i, c.locations)
  }
}

/**
 * §Z open_tab 실행 — 렌더러에 비파괴 'open-tab' 액션 디스패치(파일 미변경·확인 불요).
 * 경로는 executeTool 이 guardPath 정규화 + assertInScope(가상/시스템/스코프 밖 거부)를 이미 통과한
 * 정규화 로컬 경로다.
 *
 * **존재 검증(§Z 환각 경로 방지)**: dispatch 전에 backend.statPath 로 경로가 실제로 존재하는
 * 디렉토리인지 확인한다. 모델이 placeholder/창작 경로를 던지면 빈 탭을 열거나 환각 경로로 이동하는
 * 대신 "존재하지 않음" + list_locations 안내로 거부해 다음 턴에 교정하도록 한다.
 *   - 존재하지 않음 → 거부(list_locations 안내).
 *   - 파일이면 → 부모 디렉토리로 열기(합리적 보정).
 *   - statPath 미배선(레거시 백엔드) → 검증 불가로 보수적 거부(환각 dispatch 방지).
 * dispatchAction 미주입 시 디스패치 불가 → is_error(throw 0).
 */
async function runOpenTab(path: string, ctx: ToolRunCtx): Promise<ToolExecResult> {
  if (!ctx.dispatchAction) {
    return { content: '탭 열기 액션 디스패치가 배선되지 않았습니다.', isError: true }
  }
  if (!ctx.backend.statPath) {
    return {
      content:
        `경로 존재 검증을 할 수 없어 탭을 열지 않았습니다(${path}). list_locations 로 실제 경로를 확인하세요.`,
      isError: true
    }
  }
  let st: { exists: boolean; isDir: boolean }
  try {
    st = await ctx.backend.statPath(path)
  } catch {
    st = { exists: false, isDir: false }
  }
  if (!st.exists) {
    return {
      content:
        `해당 경로가 존재하지 않아 탭을 열지 않았습니다: ${path}. ` +
        '경로를 추측·창작하지 말고 list_locations 를 먼저 호출해 실제 경로를 얻은 뒤 그 경로로 다시 시도하세요. ' +
        '이 시스템은 Windows(역슬래시·드라이브 문자)입니다.',
      isError: true
    }
  }
  // 파일을 가리키면 부모 디렉토리를 연다(디렉토리만 탭 대상·합리적 보정).
  const target = st.isDir ? path : parentDir(path)
  if (!target) {
    return { content: `열 수 있는 디렉토리를 찾지 못했습니다: ${path}.`, isError: true }
  }
  ctx.dispatchAction({ action: 'open-tab', path: target })
  return {
    content: st.isDir
      ? `새 탭을 열고 ${target}로 이동했습니다.`
      : `대상이 파일이라 상위 폴더 ${target}를 새 탭으로 열었습니다.`
  }
}

/** 정규화된 경로의 부모 디렉토리(역슬래시 기준). 드라이브 루트/추출 불가 시 빈 문자열. */
function parentDir(p: string): string {
  const norm = p.replace(/[\\/]+$/, '')
  const idx = norm.lastIndexOf('\\')
  if (idx <= 0) return ''
  const parent = norm.slice(0, idx)
  // 드라이브 루트(예: "E:")는 "E:\\" 로 보정.
  return /^[a-zA-Z]:$/.test(parent) ? parent + '\\' : parent
}

/** §Z list_locations 실행 — 렌더러가 모은 위치를 구조화 JSON 으로 반환(fs 접근 0·순수 패스스루). */
async function runListLocations(
  input: Record<string, unknown>,
  locations: AgentLocations
): Promise<ToolExecResult> {
  const cat = typeof input['category'] === 'string' ? (input['category'] as string) : undefined

  // 항목 직렬화(이름·경로 + 로컬/가상 구분 안내). 가상(remote/archive)은 list_directory 대상 아님.
  const mapItems = (items: readonly { name: string; path: string }[] | undefined) =>
    (items ?? []).slice(0, MAX_LOCATION_ITEMS).map((it) => ({
      name: it.name,
      path: it.path,
      ...(isVirtualPath(it.path) ? { virtual: true } : {})
    }))

  const all = {
    favorites: mapItems(locations.favorites),
    quickAccess: mapItems(locations.quickAccess),
    recent: mapItems(locations.recent),
    drives: mapItems(locations.drives),
    panels: (locations.panels ?? []).slice(0, MAX_LOCATION_ITEMS).map((p) => ({
      index: p.index,
      path: p.path,
      active: p.active,
      ...(isVirtualPath(p.path) ? { virtual: true } : {})
    }))
  }

  const payload =
    cat && cat in all ? { [cat]: (all as Record<string, unknown>)[cat] } : all
  return {
    content: JSON.stringify({
      note: 'virtual=true 인 항목(원격/압축)은 list_directory 대상이 아니다. 로컬 경로만 탐색 가능.',
      ...payload
    })
  }
}

/** list_locations 분류별 직렬화 항목 상한(토큰 폭주 방어). */
const MAX_LOCATION_ITEMS = 200

/** 리다이렉트 에러에 표시할 유효 스코프 루트 최대 개수(토큰 폭주 방어). */
const MAX_REDIRECT_ROOTS = 8

/**
 * §Z 경로 거부(존재하지 않음/스코프 밖/가상)를 **모델이 다음 턴에 교정**하도록 리다이렉트형
 * 에러 텍스트로 만든다(순수). (a) 사유 + (b) 유효 루트 요약 + (c) list_locations 안내를 담는다.
 * 이렇게 하면 모델이 placeholder/창작 경로를 또 던지는 대신 실제 경로를 조회하게 유도된다.
 */
export function buildRedirectError(reason: string, scope: AgentScope, attempted?: string): string {
  const roots = scope.roots.slice(0, MAX_REDIRECT_ROOTS)
  const rootsText =
    roots.length > 0
      ? `현재 접근 가능한 루트: ${roots.join(' , ')}${scope.roots.length > roots.length ? ` …(외 ${scope.roots.length - roots.length}개)` : ''}.`
      : '현재 접근 가능한 루트가 없습니다.'
  const attemptedText = attempted ? `시도한 경로: ${attempted}. ` : ''
  return (
    `${attemptedText}${reason} ` +
    `${rootsText} ` +
    '경로를 추측·창작하지 말고, list_locations 를 먼저 호출해 실제 경로(드라이브·즐겨찾기·빠른위치·' +
    '최근·패널)를 얻은 뒤 그 경로 문자열을 그대로 사용하세요. 이 시스템은 Windows(역슬래시·드라이브 문자)입니다.'
  )
}

/** 빈 위치 모음(locations 미제공 시 기본값). */
export const EMPTY_LOCATIONS: AgentLocations = {}

/** finish 종료 신호 도구(실행 없음 — Orchestrator 가 루프 종료). */
export const FINISH_TOOL: NormalizedToolDef = {
  name: 'finish',
  description: '더 이상 도구가 필요 없고 작업이 끝났을 때 호출해 응답을 마무리한다.',
  inputSchema: {
    type: 'object',
    properties: { summary: { type: 'string' } },
    additionalProperties: false
  }
}

/**
 * 모델에 보낼 전체 도구 정의(읽기 6종 + finish).
 * @deprecated ADR-016 — 직접 호출 대신 `ToolCatalog.toToolDefs()`(createDefaultToolCatalog) 경유 권장.
 *   본 자유 함수는 카탈로그 구현 본체로 보존된다(동작 무변).
 */
export function listToolDefs(): readonly NormalizedToolDef[] {
  return [...Object.values(TOOLS).map((t) => t.def), FINISH_TOOL]
}

/**
 * 도구명 조회(미등록이면 undefined).
 * @deprecated ADR-016 — `ToolCatalog.lookup(name)` 경유 권장(카탈로그 구현 본체로 보존).
 */
export function lookupTool(name: string): ToolEntry | undefined {
  return TOOLS[name]
}

/** @deprecated ADR-016 — `ToolCatalog.isFinish(name)` 경유 권장(카탈로그 구현 본체로 보존). */
export function isFinish(name: string): boolean {
  return name === 'finish'
}

/**
 * 도구 1건 실행: 미등록·스코프 밖 경로는 is_error 결과(throw 0).
 * guardPath(주입) + scope.assertInScope 로 모든 경로 인자를 재검증한 뒤 백엔드 실행.
 * @deprecated ADR-016 — `ToolCatalog.invoke(name, input)`(createDefaultToolCatalog 가 scope/backend/
 *   guardPath/contentConsent/locations/dispatchAction 캡처) 경유 권장. 본 함수는 카탈로그 구현 본체로
 *   보존된다(읽기 전용·scope·is_error 1:1 동작 무변).
 */
export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: {
    readonly backend: ReadToolBackend
    readonly scope: AgentScope
    readonly guardPath: GuardPathFn
    readonly contentConsent: boolean
    /** §Z 이름 있는 위치(list_locations 패스스루). 미제공 시 빈 모음. */
    readonly locations?: AgentLocations
    /** §Z open_tab 비파괴 내비 액션 디스패치(미제공 시 navigate 도구 is_error). */
    readonly dispatchAction?: (action: DispatchAction) => void
    /** §Z 장시간 도구 진행 보고(미제공 시 진행 보고 0·기존 동작 동치). */
    readonly onToolProgress?: (p: ToolProgress) => void
  }
): Promise<ToolExecResult> {
  const entry = TOOLS[name]
  if (!entry) {
    return { content: `미등록 도구: ${name}`, isError: true }
  }
  if (entry.mode === 'write') {
    // Z0 은 쓰기 비활성 — write 도구는 등록조차 안 되지만 방어적으로 거부(read·navigate 만 허용).
    return { content: `쓰기 도구는 현재 단계에서 비활성입니다: ${name}`, isError: true }
  }
  // 경로 인자 정규화 + 스코프 검증. 거부는 §Z 리다이렉트형 에러(유효 루트 + list_locations 안내)로
  // — 모델이 placeholder/창작 경로를 또 던지지 않고 실제 경로를 조회·교정하도록 유도.
  const normalized: Record<string, string> = {}
  for (const raw of entry.pathArgs(input)) {
    if (!raw) {
      return {
        content: buildRedirectError('경로 인자가 비어 있습니다(경로를 창작하지 마세요).', ctx.scope),
        isError: true
      }
    }
    const g = ctx.guardPath(raw)
    if (!g.ok) {
      return {
        content: buildRedirectError(`경로가 유효하지 않습니다(${g.error.message}).`, ctx.scope, raw),
        isError: true
      }
    }
    const s = assertInScope(g.value, ctx.scope)
    if (!s.ok) {
      return {
        content: buildRedirectError(`경로가 스코프 밖이거나 접근 불가합니다(${s.error.message}).`, ctx.scope, g.value),
        isError: true
      }
    }
    normalized[raw] = g.value
  }
  // 정규화된 경로로 입력 치환(키 보존).
  const safeInput = substitutePaths(input, normalized)
  try {
    return await entry.run(safeInput, {
      backend: ctx.backend,
      contentConsent: ctx.contentConsent,
      locations: ctx.locations ?? EMPTY_LOCATIONS,
      ...(ctx.dispatchAction ? { dispatchAction: ctx.dispatchAction } : {}),
      ...(ctx.onToolProgress ? { onToolProgress: ctx.onToolProgress } : {})
    })
  } catch (e) {
    return { content: `도구 실행 오류: ${e instanceof Error ? e.message : String(e)}`, isError: true }
  }
}

/** input 의 경로 문자열을 정규화 경로로 치환(문자열·문자열 배열만). */
function substitutePaths(
  input: Record<string, unknown>,
  map: Record<string, string>
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === 'string' && map[v]) out[k] = map[v]
    else if (Array.isArray(v)) out[k] = v.map((x) => (typeof x === 'string' && map[x] ? map[x] : x))
    else out[k] = v
  }
  return out
}

/** 기본 백엔드 — 기존 Main 읽기 서비스 직접 호출(Z1 에서 실서비스 배선). 미배선은 EUNSUPPORTED. */
export function createPendingBackend(): ReadToolBackend {
  const notWired = async (tool: string): Promise<ToolExecResult> => ({
    content: `읽기 도구 백엔드 미배선(Z1): ${tool}`,
    isError: true
  })
  return {
    list: () => notWired('list_directory'),
    search: () => notWired('search_content'),
    preview: () => notWired('read_preview'),
    scan: () => notWired('scan_folder'),
    dup: () => notWired('find_duplicates'),
    compare: () => notWired('compare_folders')
  }
}

/** 표준 err 헬퍼 재노출(핸들러 편의). */
export { err as toolErr, ok as toolOk }
export { fileOpError as toolError }
