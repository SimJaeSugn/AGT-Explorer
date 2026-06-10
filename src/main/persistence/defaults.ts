/**
 * 영속화 기본값 + 스키마 버전 + 손상/구버전 폴백 정규화 (SA §5.1~5.3).
 *
 * - 세션/설정 스냅샷의 스키마 버전과 안전 기본값을 단일 출처로 둔다.
 * - 디스크에서 읽은 값이 손상·부분·구버전이어도 throw 하지 않고
 *   `coerce*` 가 기본값과 병합해 항상 완전한 스냅샷을 돌려준다(크래시 프리).
 *
 * 휘발 상태(선택·진행 중 작업·closedHistory·드래그·rename)는 스냅샷에
 * 애초에 포함하지 않으므로 여기서도 다루지 않는다.
 */
import type {
  PanelSnapshot,
  SessionSnapshot,
  SettingsSnapshot,
  SidebarSnapshot,
  SortDir,
  SortKey,
  SplitRatios,
  TabSnapshot,
  ThemeMode,
  ViewMode,
  WindowSnapshot
} from '@shared/dto'

/**
 * 현재 스키마 버전. 구조 변경 시 +1 하고 마이그레이션을 추가한다.
 * domain/session/index.ts 의 SESSION_SCHEMA_VERSION 미러를 동시에 맞춰야 한다(SA §5.3).
 */
export const SESSION_SCHEMA_VERSION = 1
export const SETTINGS_SCHEMA_VERSION = 1

const THEME_MODES: ReadonlySet<ThemeMode> = new Set<ThemeMode>([
  'light',
  'dark',
  'system',
  'bluelight'
])
const SORT_KEYS: ReadonlySet<SortKey> = new Set<SortKey>(['name', 'size', 'ext', 'mtime'])
const SORT_DIRS: ReadonlySet<SortDir> = new Set<SortDir>(['asc', 'desc'])
// J4: 보기 5종(아이콘 대/중/소·목록·자세히). 미지/구버전 값은 coercePanel 이 'details' 폴백.
const VIEW_MODES: ReadonlySet<ViewMode> = new Set<ViewMode>([
  'icons-large',
  'icons-medium',
  'icons-small',
  'list',
  'details'
])
const LAYOUTS = new Set(['single', 'split-2-h', 'split-2-v', 'grid-4'])

/** 분할 비율 클램프 경계(feat-H3 §3.4). 반대편도 최소 0.15 확보 → 0.15~0.85. */
const SPLIT_MIN_RATIO = 0.15
const SPLIT_MAX_RATIO = 0.85
/** 미사용 축/누락 축 기본 비율(균등). */
const SPLIT_DEFAULT_RATIO = 0.5

/** 미리보기 패널 폭 클램프 경계(J7). 기본 320, 240~720 범위. */
const PREVIEW_WIDTH_MIN = 240
const PREVIEW_WIDTH_MAX = 720

/**
 * 자세히 보기 고정폭 열 너비 클램프 경계·기본값(전역 설정).
 * renderer domain/rules/columnWidths(COLUMN_MIN/MAX·DEFAULT_DETAILS_COLUMN_WIDTHS)의
 * **미러**(main 은 renderer 를 import 할 수 없음 — .eslintrc). 값이 일치해야 한다.
 */
const COLUMN_MIN_WIDTH = 48
const COLUMN_MAX_WIDTH = 600
const DEFAULT_DETAILS_COLUMN_WIDTHS = { size: 90, type: 60, mtime: 140 } as const

/**
 * 파일 태그 팔레트 키 집합(T1) — renderer domain/rules/tags(TAG_PALETTE)의 **미러**
 * (main 은 renderer 를 import 할 수 없음 — .eslintrc). 키가 일치해야 한다(coerce 화이트리스트).
 */
const TAG_KEYS: ReadonlySet<string> = new Set([
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'gray'
])

// ────────────────────────────────────────────────────────────────────────
// 설정 기본값 (features E6 / F장: 숨김 off, 확장자 on, 테마 system)
// ────────────────────────────────────────────────────────────────────────

export function defaultSettings(): SettingsSnapshot {
  return {
    version: SETTINGS_SCHEMA_VERSION,
    theme: 'system',
    startLocation: '', // 빈 문자열 → "내 PC"
    showHidden: false,
    showExtensions: true,
    recentLimit: 10,
    showDashboardOnStartup: true,
    // §R4 체크섬 검증: 기본 off(끄면 복사 동작 무변경·비파괴).
    verifyOnCopy: false
  }
}

/** 텔레메트리 옵트인 기본값 — 꺼짐(D5). SettingsSnapshot 와 분리된 별도 store. */
export const DEFAULT_TELEMETRY_OPT_IN = false

// ────────────────────────────────────────────────────────────────────────
// 세션 기본값 ("내 PC" 안전 폴백 탭)
// ────────────────────────────────────────────────────────────────────────

export function defaultSidebar(): SidebarSnapshot {
  // J8: favoriteLabels(별칭 맵)은 기본 빈 맵 — 별칭 없으면 UI 가 basename 폴백.
  // pinnedByDir(상단 고정 맵)도 기본 빈 맵.
  // T1: tagsByPath(태그 라벨 맵)도 기본 빈 맵.
  return {
    favorites: [],
    favoriteLabels: {},
    pinnedByDir: {},
    tagsByPath: {},
    recent: [],
    width: 240,
    collapsed: false
  }
}

/** 손상/미존재 시 부팅할 안전 폴백 세션("내 PC" 단일 탭, SA §5.3). */
export function defaultSession(): SessionSnapshot {
  return {
    version: SESSION_SCHEMA_VERSION,
    windows: [],
    sidebar: defaultSidebar(),
    ui: { theme: 'system', previewOpen: false }
  }
}

// ────────────────────────────────────────────────────────────────────────
// 정규화(coerce) — 디스크 raw → 완전·유효 스냅샷
// ────────────────────────────────────────────────────────────────────────

type Raw = Record<string, unknown>
const asObj = (v: unknown): Raw | undefined =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Raw) : undefined
const asStr = (v: unknown, fb: string): string => (typeof v === 'string' ? v : fb)
const asNum = (v: unknown, fb: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fb
const asBool = (v: unknown, fb: boolean): boolean => (typeof v === 'boolean' ? v : fb)
const asStrArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []

/** 설정 raw 를 기본값과 병합해 완전한 SettingsSnapshot 으로 정규화. */
export function coerceSettings(raw: unknown): SettingsSnapshot {
  const o = asObj(raw)
  const d = defaultSettings()
  if (!o) return d
  const theme = o['theme']
  const recentLimit = asNum(o['recentLimit'], d.recentLimit)
  return {
    version: SETTINGS_SCHEMA_VERSION,
    theme: typeof theme === 'string' && THEME_MODES.has(theme as ThemeMode) ? (theme as ThemeMode) : d.theme,
    startLocation: asStr(o['startLocation'], d.startLocation),
    showHidden: asBool(o['showHidden'], d.showHidden),
    showExtensions: asBool(o['showExtensions'], d.showExtensions),
    // 1~1000 범위로 클램프(비정상 값 방어).
    recentLimit: Math.min(1000, Math.max(1, Math.trunc(recentLimit))),
    showDashboardOnStartup: asBool(o['showDashboardOnStartup'], d.showDashboardOnStartup),
    // §R4: 비파괴 — 구버전 설정(키 누락)은 기본 false 폴백.
    verifyOnCopy: asBool(o['verifyOnCopy'], d.verifyOnCopy ?? false)
  }
}

function coercePanel(raw: unknown): PanelSnapshot | undefined {
  const o = asObj(raw)
  if (!o) return undefined
  const id = o['id']
  const path = o['path']
  if (typeof id !== 'string' || typeof path !== 'string') return undefined
  const sortKey = o['sortKey']
  const sortDir = o['sortDir']
  const viewMode = o['viewMode']
  const hist = asObj(o['history'])
  return {
    id,
    path,
    sortKey: typeof sortKey === 'string' && SORT_KEYS.has(sortKey as SortKey) ? (sortKey as SortKey) : 'name',
    sortDir: typeof sortDir === 'string' && SORT_DIRS.has(sortDir as SortDir) ? (sortDir as SortDir) : 'asc',
    viewMode:
      typeof viewMode === 'string' && VIEW_MODES.has(viewMode as ViewMode) ? (viewMode as ViewMode) : 'details',
    history: { back: asStrArray(hist?.['back']), forward: asStrArray(hist?.['forward']) },
    scrollTop: Math.max(0, asNum(o['scrollTop'], 0))
  }
}

/**
 * 분할 비율(splitRatios) 정규화(feat-H3 §3.4).
 * - 입력이 객체가 아니면(누락/null/배열/원시값) `undefined` 반환 → 필드 생략,
 *   복원 측(LayoutHost)에서 균등(0.5/0.5)으로 폴백한다. 구버전 세션(필드 없음) 호환.
 * - 객체면 각 축을 0.15~0.85 로 클램프. 축이 비유한수(NaN/Infinity/문자열 등)면
 *   해당 축만 0.5 폴백 후 클램프 경계 내(0.5)로 유지.
 */
function coerceSplitRatios(raw: unknown): SplitRatios | undefined {
  const o = asObj(raw)
  if (!o) return undefined
  const clampAxis = (v: unknown): number =>
    Math.max(SPLIT_MIN_RATIO, Math.min(SPLIT_MAX_RATIO, asNum(v, SPLIT_DEFAULT_RATIO)))
  return { col: clampAxis(o['col']), row: clampAxis(o['row']) }
}

function coerceTab(raw: unknown): TabSnapshot | undefined {
  const o = asObj(raw)
  if (!o) return undefined
  const id = o['id']
  if (typeof id !== 'string') return undefined
  const layout = o['layout']
  const panels = Array.isArray(o['panels'])
    ? (o['panels'] as unknown[]).map(coercePanel).filter((p): p is PanelSnapshot => p !== undefined)
    : []
  if (panels.length === 0) return undefined
  const activePanelId =
    typeof o['activePanelId'] === 'string' && panels.some((p) => p.id === o['activePanelId'])
      ? (o['activePanelId'] as string)
      : panels[0].id
  const splitRatios = coerceSplitRatios(o['splitRatios'])
  return {
    id,
    activePanelId,
    layout: typeof layout === 'string' && LAYOUTS.has(layout) ? (layout as TabSnapshot['layout']) : 'single',
    panels,
    // 누락/비객체면 생략(undefined) — 복원 측 균등 폴백(§3.4). 구버전 호환.
    ...(splitRatios ? { splitRatios } : {})
  }
}

function coerceWindow(raw: unknown): WindowSnapshot | undefined {
  const o = asObj(raw)
  if (!o) return undefined
  const tabs = Array.isArray(o['tabs'])
    ? (o['tabs'] as unknown[]).map(coerceTab).filter((t): t is TabSnapshot => t !== undefined)
    : []
  if (tabs.length === 0) return undefined
  const activeTabId =
    typeof o['activeTabId'] === 'string' && tabs.some((t) => t.id === o['activeTabId'])
      ? (o['activeTabId'] as string)
      : tabs[0].id
  return { tabs, activeTabId }
}

/**
 * 즐겨찾기 별칭 맵(J8) 정규화.
 * - 입력이 객체가 아니거나(구버전: favoriteLabels 키 없음) 값이 string 이 아니면 제외.
 * - **키가 실제 favorites 에 존재하는 것만** 보존(즐겨찾기에서 빠진 고아 라벨 제거).
 * - 빈 문자열 라벨은 "별칭 없음"과 동일하므로 보존하지 않는다(UI basename 폴백).
 * 비파괴·구버전 호환: 구버전 `string[]`(라벨 없음) → 빈 맵 `{}`.
 */
function coerceFavoriteLabels(raw: unknown, favorites: readonly string[]): Record<string, string> {
  const o = asObj(raw)
  if (!o) return {}
  const fav = new Set(favorites)
  const out: Record<string, string> = {}
  for (const key of Object.keys(o)) {
    if (!fav.has(key)) continue // 고아 키 제거(즐겨찾기에 없는 경로)
    const v = o[key]
    if (typeof v !== 'string' || v.length === 0) continue
    out[key] = v
  }
  return out
}

/**
 * 상단 고정 맵(pinnedByDir) 정규화. dirPath → 문자열 경로 배열.
 * - 입력이 객체가 아니면(구버전: 키 없음) 빈 맵.
 * - 값이 배열이 아니거나 비면 제외(빈 배열 키는 무의미). 항목 중 문자열만 보존.
 * 비파괴·구버전 호환.
 */
function coercePinnedByDir(raw: unknown): Record<string, string[]> {
  const o = asObj(raw)
  if (!o) return {}
  const out: Record<string, string[]> = {}
  for (const key of Object.keys(o)) {
    const arr = asStrArray(o[key])
    if (arr.length > 0) out[key] = arr
  }
  return out
}

/**
 * 자세히 보기 열 너비(detailsColumnWidths) 정규화.
 * - 입력이 객체가 아니면(누락/null/배열) `undefined` 반환 → 필드 생략, 복원 측이 기본값
 *   폴백. 구버전 세션(필드 없음) 호환·round-trip 동등.
 * - 객체면 각 열을 48~600 클램프(비유한수/범위밖 방어). 누락 키는 기본값.
 * renderer domain/rules/columnWidths(coerceDetailsColumnWidths)와 동일 규칙 미러.
 */
function coerceDetailsColumnWidths(raw: unknown): { size: number; type: number; mtime: number } | undefined {
  const o = asObj(raw)
  if (!o) return undefined
  const d = DEFAULT_DETAILS_COLUMN_WIDTHS
  const clampCol = (v: unknown, fb: number): number =>
    typeof v === 'number' && Number.isFinite(v)
      ? Math.max(COLUMN_MIN_WIDTH, Math.min(COLUMN_MAX_WIDTH, Math.round(v)))
      : fb
  return {
    size: clampCol(o['size'], d.size),
    type: clampCol(o['type'], d.type),
    mtime: clampCol(o['mtime'], d.mtime)
  }
}

/**
 * 파일 태그 맵(tagsByPath) 정규화(T1). path → 태그 키 배열.
 * - 입력이 객체가 아니면(구버전: 키 없음) 빈 맵.
 * - 값이 배열이 아니면 제외. 항목 중 **유효 팔레트 키만** 보존(중복 제거).
 *   빈 결과 키는 제외(태그 없음과 동일). 팔레트 순서 보존(TAG_KEYS 삽입순).
 * 비파괴·구버전 호환. renderer domain/rules/tags(normalizeTags)와 동일 규칙 미러.
 */
export function coerceTagsByPath(raw: unknown): Record<string, string[]> {
  const o = asObj(raw)
  if (!o) return {}
  const out: Record<string, string[]> = {}
  for (const key of Object.keys(o)) {
    const arr = o[key]
    if (!Array.isArray(arr)) continue
    const present = new Set<string>()
    for (const v of arr) if (typeof v === 'string' && TAG_KEYS.has(v)) present.add(v)
    if (present.size === 0) continue
    // 팔레트 순서(TAG_KEYS 삽입순)로 정렬 — round-trip 안정.
    out[key] = [...TAG_KEYS].filter((k) => present.has(k))
  }
  return out
}

function coerceSidebar(raw: unknown, recentLimit: number): SidebarSnapshot {
  const o = asObj(raw)
  const d = defaultSidebar()
  if (!o) return d
  const favorites = asStrArray(o['favorites'])
  return {
    favorites,
    favoriteLabels: coerceFavoriteLabels(o['favoriteLabels'], favorites),
    pinnedByDir: coercePinnedByDir(o['pinnedByDir']),
    tagsByPath: coerceTagsByPath(o['tagsByPath']),
    // recentLimit 적용(최신 우선이 앞에 있다고 가정 — 앞에서 자른다).
    recent: asStrArray(o['recent']).slice(0, Math.max(0, recentLimit)),
    width: Math.max(120, asNum(o['width'], d.width)),
    collapsed: asBool(o['collapsed'], d.collapsed)
  }
}

/**
 * 세션 raw 를 정규화한다. 구조가 무효/구버전이거나 windows 가 비면
 * 안전 폴백(빈 windows + 기본 사이드바)으로 돌려 크래시 프리 부팅을 보장한다.
 * @param recentLimit settings 의 recentLimit(최근 목록 슬라이스에 적용).
 */
export function coerceSession(raw: unknown, recentLimit: number): SessionSnapshot {
  const o = asObj(raw)
  if (!o) return defaultSession()
  const windows = Array.isArray(o['windows'])
    ? (o['windows'] as unknown[]).map(coerceWindow).filter((w): w is WindowSnapshot => w !== undefined)
    : []
  const ui = asObj(o['ui'])
  const theme = ui?.['theme']
  // J7: previewWidth — 유한수면 240~720 클램프, 아니면(누락/비유한수) 필드 생략(undefined)
  //     → 복원 측이 기본 320 폴백. 구버전 세션(previewWidth 없음) 호환·비파괴.
  const rawPreviewWidth = ui?.['previewWidth']
  const previewWidth =
    typeof rawPreviewWidth === 'number' && Number.isFinite(rawPreviewWidth)
      ? Math.max(PREVIEW_WIDTH_MIN, Math.min(PREVIEW_WIDTH_MAX, rawPreviewWidth))
      : undefined
  // 자세히 보기 열 너비(전역): 누락/비객체면 키 생략 → 복원 측 기본값 폴백(구버전 호환).
  const detailsColumnWidths = coerceDetailsColumnWidths(ui?.['detailsColumnWidths'])
  return {
    version: SESSION_SCHEMA_VERSION,
    windows,
    sidebar: coerceSidebar(o['sidebar'], recentLimit),
    ui: {
      theme: typeof theme === 'string' && THEME_MODES.has(theme as ThemeMode) ? (theme as ThemeMode) : 'system',
      previewOpen: asBool(ui?.['previewOpen'], false),
      // 누락/비유한수면 키 생략(구버전 round-trip 동등 보존).
      ...(previewWidth !== undefined ? { previewWidth } : {}),
      ...(detailsColumnWidths !== undefined ? { detailsColumnWidths } : {})
    }
  }
}
