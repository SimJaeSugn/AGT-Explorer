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

/** 현재 스키마 버전. 구조 변경 시 +1 하고 마이그레이션을 추가한다. */
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
const VIEW_MODES: ReadonlySet<ViewMode> = new Set<ViewMode>(['list', 'details'])
const LAYOUTS = new Set(['single', 'split-2-h', 'split-2-v', 'grid-4'])

/** 분할 비율 클램프 경계(feat-H3 §3.4). 반대편도 최소 0.15 확보 → 0.15~0.85. */
const SPLIT_MIN_RATIO = 0.15
const SPLIT_MAX_RATIO = 0.85
/** 미사용 축/누락 축 기본 비율(균등). */
const SPLIT_DEFAULT_RATIO = 0.5

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
    showDashboardOnStartup: true
  }
}

/** 텔레메트리 옵트인 기본값 — 꺼짐(D5). SettingsSnapshot 와 분리된 별도 store. */
export const DEFAULT_TELEMETRY_OPT_IN = false

// ────────────────────────────────────────────────────────────────────────
// 세션 기본값 ("내 PC" 안전 폴백 탭)
// ────────────────────────────────────────────────────────────────────────

export function defaultSidebar(): SidebarSnapshot {
  return { favorites: [], recent: [], width: 240, collapsed: false }
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
    showDashboardOnStartup: asBool(o['showDashboardOnStartup'], d.showDashboardOnStartup)
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

function coerceSidebar(raw: unknown, recentLimit: number): SidebarSnapshot {
  const o = asObj(raw)
  const d = defaultSidebar()
  if (!o) return d
  return {
    favorites: asStrArray(o['favorites']),
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
  return {
    version: SESSION_SCHEMA_VERSION,
    windows,
    sidebar: coerceSidebar(o['sidebar'], recentLimit),
    ui: {
      theme: typeof theme === 'string' && THEME_MODES.has(theme as ThemeMode) ? (theme as ThemeMode) : 'system',
      previewOpen: asBool(ui?.['previewOpen'], false)
    }
  }
}
