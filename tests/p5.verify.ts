/* P5(검색/필터·세션복원·설정·즐겨찾기·최근·상태바 파생) 검증 하니스. window.api 모킹. */

// ── window.api 모킹(infra/api bridge 가 참조) ─────────────────────────
let savedSession: unknown = null
let settingsState = {
  version: 1,
  theme: 'system',
  startLocation: '',
  showHidden: false,
  showExtensions: true,
  recentLimit: 10
}
let telemetryOptIn = false
let lastListStartShowHidden: boolean | null = null

const fakeApi = {
  version: 'test',
  fs: {
    list: async () => ({ ok: true, value: { entries: [], truncated: false } }),
    stat: async () => ({ ok: false, error: { code: 'ENOENT', message: 'x' } }),
    drives: async () => ({ ok: true, value: [] }),
    treeChildren: async () => ({ ok: true, value: [] }),
    validatePath: async () => ({ ok: true, value: { exists: true, isDir: true, normalized: 'C:\\' } }),
    listStart: async (req: { showHidden: boolean }) => {
      lastListStartShowHidden = req.showHidden
      return { ok: true, value: { streamId: 'sid-1' } }
    },
    listCancel: async () => ({ ok: true, value: undefined }),
    onListChunk: () => () => undefined,
    onListDone: () => () => undefined,
    onListError: () => () => undefined,
    mkdir: async () => ({ ok: false, error: { code: 'EINVAL', message: '' } }),
    createFile: async () => ({ ok: false, error: { code: 'EINVAL', message: '' } }),
    rename: async () => ({ ok: false, error: { code: 'EINVAL', message: '' } })
  },
  shell: {
    open: async () => ({ ok: true, value: undefined }),
    openWith: async () => ({ ok: true, value: undefined }),
    showProperties: async () => ({ ok: true, value: undefined }),
    icon: async () => ({ ok: false, error: { code: 'EUNKNOWN', message: '' } })
  },
  op: {
    start: async () => ({ ok: false, error: { code: 'EUNKNOWN', message: '' } }),
    resolve: async () => ({ ok: true, value: undefined }),
    cancel: async () => ({ ok: true, value: undefined }),
    onProgress: () => () => undefined,
    onConflict: () => () => undefined,
    onDone: () => () => undefined
  },
  clipboard: {
    copyFiles: async () => ({ ok: true, value: undefined }),
    cutFiles: async () => ({ ok: true, value: undefined }),
    pasteTarget: async () => ({ ok: true, value: undefined }),
    read: async () => ({ ok: true, value: { paths: [], effect: 'none' } })
  },
  dialog: { confirmPermanentDelete: async () => ({ ok: true, value: { confirmed: true } }) },
  session: {
    load: async () =>
      savedSession
        ? { ok: true, value: savedSession }
        : { ok: false, error: { code: 'ENOENT', message: 'no session' } },
    save: async (req: { snapshot: unknown }) => {
      savedSession = req.snapshot
      return { ok: true, value: undefined }
    }
  },
  settings: {
    get: async () => ({ ok: true, value: settingsState }),
    set: async (req: { patch: Record<string, unknown> }) => {
      settingsState = { ...settingsState, ...req.patch }
      return { ok: true, value: settingsState }
    }
  },
  telemetry: {
    setOptIn: async (req: { enabled: boolean }) => {
      telemetryOptIn = req.enabled
      return { ok: true, value: undefined }
    },
    getOptIn: async () => ({ ok: true, value: { optIn: telemetryOptIn } })
  }
}
;(globalThis as unknown as { api: unknown }).api = fakeApi
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
  observe(): void {}
  disconnect(): void {}
}

import type { FileEntryDTO } from '../src/shared/dto'
import {
  filterEntries,
  matchesQuery,
  globToRegExp,
  highlightRange
} from '../src/renderer/domain/rules/filter'
import { resolveTheme } from '../src/renderer/ui/theme/applyTheme'
import { useRootStore } from '../src/renderer/app/stores/rootStore'
import { computeVisible, filterInfo } from '../src/renderer/app/usecases/selectors'
import { buildSessionSnapshot, restoreSession } from '../src/renderer/app/usecases/session'
import { changeRecentLimit, changeShowHidden, loadSettings } from '../src/renderer/app/usecases/settings'

let pass = 0
let fail = 0
function ok(label: string, cond: boolean): void {
  if (cond) pass++
  else {
    fail++
    console.log('FAIL', label)
  }
}

const mk = (name: string, isDir = false): FileEntryDTO => ({
  name,
  path: 'C:\\x\\' + name,
  isDir,
  size: isDir ? 0 : 100,
  mtime: 0,
  ctime: 0,
  ext: isDir ? '' : name.includes('.') ? (name.split('.').pop() as string).toLowerCase() : '',
  attrs: { hidden: false, readonly: false, system: false, symlink: false }
})

const entries = [
  mk('report.png'),
  mk('report.txt'),
  mk('summary.png'),
  mk('readme.md'),
  mk('Reports', true),
  mk('image.PNG')
]

// ── 1. 필터 술어(이름/확장자/글롭) ───────────────────────────────────
ok('빈 쿼리 전체', filterEntries(entries, '').length === entries.length)
ok('부분일치 report (대소문자 무시)', filterEntries(entries, 'report').map((e) => e.name).sort().join(',') === 'Reports,report.png,report.txt')
ok('글롭 *.png (대소문자 무시)', filterEntries(entries, '*.png').map((e) => e.name).sort().join(',') === 'image.PNG,report.png,summary.png')
ok('글롭 report*', filterEntries(entries, 'report*').map((e) => e.name).sort().join(',') === 'Reports,report.png,report.txt')
ok('확장자 .md', filterEntries(entries, '.md').map((e) => e.name).join(',') === 'readme.md')
ok('matchesQuery 단건 true', matchesQuery(mk('alpha.png'), '*.png') === true)
ok('matchesQuery 단건 false', matchesQuery(mk('alpha.txt'), '*.png') === false)
ok('globToRegExp ? 한글자', globToRegExp('a?c').test('abc') && !globToRegExp('a?c').test('ac'))
ok('하이라이트 부분일치 구간', JSON.stringify(highlightRange('report.png', 'port')) === JSON.stringify({ start: 2, end: 6 }))
ok('하이라이트 글롭 null', highlightRange('report.png', '*.png') === null)
ok('하이라이트 미매칭 null', highlightRange('report.png', 'zzz') === null)

// ── 2. 테마 resolve(순수) ─────────────────────────────────────────────
ok('theme light', resolveTheme('light', true) === 'light')
ok('theme dark', resolveTheme('dark', false) === 'dark')
ok('theme system→dark', resolveTheme('system', true) === 'dark')
ok('theme system→light', resolveTheme('system', false) === 'light')

// ── 3. 설정 로드 → 슬라이스 반영 + 숨김 토글 fs:list 연동 ─────────────
settingsState = { ...settingsState, showHidden: true, showExtensions: false, recentLimit: 5, theme: 'dark', startLocation: 'C:\\' }
await loadSettings()
const s = () => useRootStore.getState()
ok('설정 로드 showHidden', s().showHidden === true)
ok('설정 로드 showExtensions', s().showExtensions === false)
ok('설정 로드 recentLimit', s().recentLimit === 5)
ok('설정 로드 theme', s().theme === 'dark')
ok('설정 로드 startLocation', s().startLocation === 'C:\\')

// 기본 탭 1개 만들고 패널 navigate → listStart 가 showHidden=true 로 호출되는지.
s().initDefaultTab()
const pid0 = s().activePanelId()!
s().navigate(pid0, 'D:\\demo', true)
await Promise.resolve()
await Promise.resolve()
ok('숨김 토글 → fs:list showHidden 전달', lastListStartShowHidden === true)

// changeShowHidden(false) → 슬라이스+영속+재스캔.
await changeShowHidden(false)
ok('changeShowHidden 슬라이스', s().showHidden === false)
ok('changeShowHidden 영속', settingsState.showHidden === false)
await Promise.resolve()
await Promise.resolve()
ok('changeShowHidden 재스캔 showHidden=false', lastListStartShowHidden === false)

// ── 4. 즐겨찾기 추가/제거 ─────────────────────────────────────────────
s().addFavorite('C:\\proj')
s().addFavorite('C:\\proj') // 중복
ok('즐겨찾기 1개(중복 무시)', s().favorites.filter((p) => p === 'C:\\proj').length === 1)
ok('즐겨찾기 내 PC 무시', (s().addFavorite(''), s().favorites.includes('')) === false)
ok('isFavorite true', s().isFavorite('C:\\proj') === true)
s().toggleFavorite('C:\\proj')
ok('토글 제거', s().isFavorite('C:\\proj') === false)
s().toggleFavorite('C:\\docs')
ok('토글 추가', s().isFavorite('C:\\docs') === true)

// ── 5. 최근 limit(recentLimit=5) ─────────────────────────────────────
s().clearRecent()
for (let i = 0; i < 8; i++) s().recordRecent('C:\\r' + i)
ok('최근 limit 5 적용', s().recent.length === 5)
ok('최근 최신 우선', s().recent[0] === 'C:\\r7')
s().recordRecent('C:\\r7') // 재방문 → 맨 앞, 중복 제거
ok('재방문 중복 제거 유지 5', s().recent.length === 5 && s().recent[0] === 'C:\\r7')
ok('내 PC 최근 제외', (s().recordRecent(''), s().recent.includes('')) === false)
// recentLimit 축소 즉시 반영.
await changeRecentLimit(3)
ok('recentLimit 축소 즉시 잘림', s().recent.length === 3)
ok('recentLimit 영속', settingsState.recentLimit === 3)

// ── 6. 상태바 파생값(filterInfo) ──────────────────────────────────────
// pid0 패널 directory.entries 를 직접 주입(스트림 done 시뮬).
const sid = s().panels[pid0]!.directory.streamId
if (sid) {
  s()._onChunk(pid0, sid, entries)
  s()._onDone(pid0, sid, entries.length, false)
}
const panel0 = s().panels[pid0]!
ok('필터 비활성 시 matched=total', filterInfo(panel0).active === false && filterInfo(panel0).total === entries.length)
s().setSearchOpen(pid0, true)
s().setSearchQuery(pid0, '*.png')
const panel0b = s().panels[pid0]!
const fi = filterInfo(panel0b)
ok('필터 활성 matched=3', fi.active === true && fi.matched === 3 && fi.total === entries.length)
ok('computeVisible 필터 결과 3', computeVisible(panel0b).length === 3)
s().setSearchOpen(pid0, false)

// ── 7. 세션 스냅샷 직렬화: 휘발 제외 라운드트립 ───────────────────────
// 선택·진행작업·closedHistory 같은 휘발 상태를 만든 뒤 스냅샷에 안 들어가는지 확인.
s().selectAll(pid0, entries.map((e) => e.path))
s().registerOperation('op-vol', 'copy', ['C:\\x'])
// closedHistory 적재.
s().newTab('C:\\tabx')
const tabxId = s().activeTabId
s().closeTab(tabxId)
ok('closedHistory 적재됨(휘발 대상)', s().closedHistory.length >= 1)

const snap = buildSessionSnapshot()
const serialized = JSON.stringify(snap)
ok('스냅샷 selection 미포함', !serialized.includes('selectedPaths') && !serialized.includes('anchorIndex'))
ok('스냅샷 operations 미포함', !serialized.includes('op-vol') && !serialized.includes('processedBytes'))
ok('스냅샷 closedHistory 미포함', !('closedHistory' in (snap as Record<string, unknown>)))
ok('스냅샷 directory/streamId 미포함', !serialized.includes('streamId') && !serialized.includes('"entries"'))
ok('스냅샷 favorites 포함', snap.sidebar.favorites.includes('C:\\docs'))
ok('스냅샷 recent 포함', snap.sidebar.recent.length === 3)
ok('스냅샷 패널 path/sort/view 포함', snap.windows[0]!.tabs[0]!.panels[0]!.path === 'D:\\demo')
ok('스냅샷 history 포함', Array.isArray(snap.windows[0]!.tabs[0]!.panels[0]!.history.back))

// ── 8. 세션 복원 라운드트립 ───────────────────────────────────────────
// 위 스냅샷을 저장소에 넣고 새 스토어 상태로 복원.
savedSession = snap
// 기존 탭 모두 닫아 초기화 흉내(restoreWindows 는 추가 적재).
// 새 restoreSession 호출(복원 성공 여부 확인).
const restored = await restoreSession()
ok('세션 복원 성공', restored === true)
// 복원 직후 즐겨찾기/최근 유지.
ok('복원 즐겨찾기 유지', s().isFavorite('C:\\docs'))
ok('복원 최근 유지', s().recent.length === 3)
// 복원된 탭 중 D:\demo 경로 패널 존재.
const anyDemo = Object.values(s().panels).some((p) => p.path === 'D:\\demo')
ok('복원 패널 경로 D:\\demo 존재', anyDemo)

// ── 9. 첫 실행(스냅샷 없음) → 기본 탭 ─────────────────────────────────
// startLocation 'C:\\' 설정이므로 newTab('C:\\') 폴백 경로 검증은 별도 store로.
ok('telemetry 기본 false 유지', telemetryOptIn === false)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
