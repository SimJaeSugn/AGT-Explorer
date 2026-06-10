/**
 * P5 영속화 실증 스크립트(헤드리스, 일회성 검증).
 *
 * 임시 userData 디렉토리에서 다음을 실증한다:
 *  1) 설정 저장(set patch)→로드 라운드트립, 기본값, recentLimit 클램프.
 *  2) 세션 저장(즉시 flush)→로드 라운드트립(스냅샷 일치).
 *  3) 손상 파일(깨진 JSON)·구조 무효 → 기본값/안전 폴백(크래시 프리).
 *  4) 원자적 쓰기: 쓰기 후 .tmp 잔여 없음, 파일 항상 완전한 JSON.
 *  5) 휘발 상태 제외: SessionSnapshot 구조에 selection/op/closedHistory 가
 *     애초에 없고, raw 에 섞여 들어와도 직렬화/복원되지 않음.
 *  6) 디바운스: save 후 즉시 flush 전엔 파일 미기록, flush 시 기록.
 *  7) 텔레메트리 옵트인 기본 false → 영속 → 재로드 유지.
 *
 * Electron app·IPC·BrowserWindow 의존이 없도록 Store 를 직접 임시 디렉토리로
 * 구동한다(initPersistence 가 baseDir 주입식). before-quit 훅·실제 IPC 왕복은
 * GUI 의존이라 헤드리스 단독 불가 → 로직 검증 + 한계 명시.
 *
 * 실행: esbuild 번들 후 node (verify-ops.ts 패턴, @shared 별칭 해소).
 */
import { constants as fsConstants } from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import { join } from 'node:path'
import type { SessionSnapshot, SettingsSnapshot } from '@shared/dto'
import { SessionStore } from '../src/main/persistence/SessionStore'
import { SettingsStore } from '../src/main/persistence/SettingsStore'
import { persistencePaths } from '../src/main/persistence/paths'
import {
  coerceSession,
  defaultSession,
  defaultSettings,
  defaultSidebar
} from '../src/main/persistence/defaults'
import { readJsonSafe, writeJsonAtomic } from '../src/main/persistence/atomic'
import { fileSystemService } from '../src/main/fs/FileSystemService'

function line(s: string): void {
  // eslint-disable-next-line no-console
  console.log(s)
}
let pass = 0
let fail = 0
function check(name: string, cond: boolean): void {
  if (cond) {
    pass++
    line(`  PASS  ${name}`)
  } else {
    fail++
    line(`  FAIL  ${name}`)
  }
}
async function exists(p: string): Promise<boolean> {
  try {
    await fsp.access(p, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

function sampleSession(): SessionSnapshot {
  return {
    version: 1,
    windows: [
      {
        tabs: [
          {
            id: 'tab-1',
            activePanelId: 'panel-1',
            layout: 'split-2-v',
            panels: [
              {
                id: 'panel-1',
                path: 'C:\\Users\\me\\Documents',
                sortKey: 'mtime',
                sortDir: 'desc',
                viewMode: 'details',
                history: { back: ['C:\\Users\\me'], forward: [] },
                scrollTop: 420
              },
              {
                id: 'panel-2',
                path: 'D:\\work',
                sortKey: 'name',
                sortDir: 'asc',
                viewMode: 'list',
                history: { back: [], forward: [] },
                scrollTop: 0
              }
            ],
            // coerceTab 이 splitRatios 를 panels 뒤에 부착하므로 키 순서를 맞춰
            // JSON.stringify 라운드트립 동등을 유지한다(정상 범위 → 보존).
            splitRatios: { col: 0.5, row: 0.3 }
          }
        ],
        activeTabId: 'tab-1'
      }
    ],
    // J8: favoriteLabels(별칭 맵) — coerce 가 favorites 에 있는 키만 보존하므로
    // 라운드트립 동등을 위해 키 'C:\\fav'(favorites 에 존재)에 라벨을 둔다.
    // J7: ui.previewWidth(범위 내 240~720) — coerce 가 보존하므로 round-trip 포함.
    sidebar: {
      favorites: ['C:\\fav'],
      favoriteLabels: { 'C:\\fav': '즐겨찾기' },
      // 상단 고정 맵 — coerce 가 비-빈 배열 키를 보존하므로 round-trip 포함.
      pinnedByDir: { 'C:\\d': ['C:\\d\\pin.txt'] },
      // T1: 태그 맵 — coerce(coerceTagsByPath)가 유효 키를 팔레트 순으로 보존하므로
      // round-trip 동등을 위해 키 순서(red<blue)를 맞춘다(coerce 출력과 일치).
      tagsByPath: { 'C:\\d\\pin.txt': ['red', 'blue'] },
      recent: ['C:\\r1', 'C:\\r2'],
      width: 280,
      collapsed: false
    },
    ui: { theme: 'dark', previewOpen: false, previewWidth: 360 }
  }
}

async function main(): Promise<void> {
  const base = await fsp.mkdtemp(join(os.tmpdir(), 'explorer-p5-'))
  line(`임시 userData: ${base}`)
  const paths = persistencePaths(base)

  // ── 1) 설정 라운드트립 + 기본값 + 클램프 ──────────────────────────────
  line('== 1) 설정 저장→로드 라운드트립 / 기본값 / recentLimit ==')
  const settings = new SettingsStore(paths)
  const loaded0 = await settings.load()
  const d = defaultSettings()
  check('초기 로드 = 기본값(테마 system)', loaded0.theme === 'system' && d.theme === 'system')
  check('기본 showHidden=false', loaded0.showHidden === false)
  check('기본 showExtensions=true', loaded0.showExtensions === true)
  check('기본 showDashboardOnStartup=true', loaded0.showDashboardOnStartup === true && d.showDashboardOnStartup === true)

  // ── I장: coerce 화이트리스트(bluelight 테마 · showDashboardOnStartup) ──
  // bluelight 는 THEME_MODES 화이트리스트에 들어가 coerce 가 보존해야 한다.
  const setBlue = await settings.set({ theme: 'bluelight' })
  check('coerce: theme=bluelight 허용·보존', setBlue.theme === 'bluelight')
  // 알 수 없는 테마 값은 기본값(system)으로 폴백.
  const settingsBlueReload = new SettingsStore(paths)
  const blueReloaded = await settingsBlueReload.load()
  check('재로드 후 theme=bluelight 유지', blueReloaded.theme === 'bluelight')
  // showDashboardOnStartup off 영속.
  const setDash = await settings.set({ showDashboardOnStartup: false })
  check('coerce: showDashboardOnStartup=false 저장', setDash.showDashboardOnStartup === false)
  const dashReload = await new SettingsStore(paths).load()
  check('재로드 후 showDashboardOnStartup=false 유지', dashReload.showDashboardOnStartup === false)
  // 구버전 settings.json(키 누락) → 기본값 true 로 채움(무손상 호환).
  await fsp.writeFile(paths.settings, JSON.stringify({ version: 1, theme: 'light' }), 'utf8')
  const legacySettings = await new SettingsStore(paths).load()
  check('구버전 settings(showDashboardOnStartup 누락) → 기본 true 채움', legacySettings.showDashboardOnStartup === true)
  // §R4: verifyOnCopy 기본 off·toggle 영속·구버전 누락 false 폴백.
  check('기본 verifyOnCopy=false', loaded0.verifyOnCopy === false && d.verifyOnCopy === false)
  const setVerify = await settings.set({ verifyOnCopy: true })
  check('coerce: verifyOnCopy=true 저장', setVerify.verifyOnCopy === true)
  const verifyReload = await new SettingsStore(paths).load()
  check('재로드 후 verifyOnCopy=true 유지', verifyReload.verifyOnCopy === true)
  // 비불리언(손상) → coerce 가 false 폴백.
  await fsp.writeFile(paths.settings, JSON.stringify({ version: 1, theme: 'light', verifyOnCopy: 'yes' }), 'utf8')
  const verifyCoerced = await new SettingsStore(paths).load()
  check('coerce: 손상 verifyOnCopy(비불리언) → false 폴백', verifyCoerced.verifyOnCopy === false)
  // 구버전(키 누락) → false 폴백.
  check('구버전 settings(verifyOnCopy 누락) → false 폴백', legacySettings.verifyOnCopy === false)
  // 정상 상태로 복구(이후 테스트 영향 방지).
  await settings.set({ theme: 'system', showDashboardOnStartup: true, verifyOnCopy: false })

  const set1 = await settings.set({ theme: 'dark', showHidden: true, recentLimit: 25 })
  check('set 후 theme=dark', set1.theme === 'dark')
  check('set 후 showHidden=true', set1.showHidden === true)
  check('set 후 recentLimit=25', set1.recentLimit === 25)
  check('settings.json 파일 생성됨', await exists(paths.settings))

  // 새 인스턴스로 재로드(영속 확인)
  const settings2 = new SettingsStore(paths)
  const reloaded = await settings2.load()
  check('재로드 후 theme=dark 유지', reloaded.theme === 'dark')
  check('재로드 후 recentLimit=25 유지', reloaded.recentLimit === 25)

  // 비정상 값 클램프
  const clamp = await settings2.set({ recentLimit: -5 })
  check('recentLimit 음수 → 1 로 클램프', clamp.recentLimit === 1)
  const clampHi = await settings2.set({ recentLimit: 999999 })
  check('recentLimit 과대 → 1000 으로 클램프', clampHi.recentLimit === 1000)
  await settings2.set({ recentLimit: 10 })

  // ── 2) 세션 라운드트립 ────────────────────────────────────────────────
  line('== 2) 세션 저장→로드 라운드트립(스냅샷 일치) ==')
  const sess = new SessionStore(paths, () => settings2.get().recentLimit, 0) // debounce 0 = 즉시
  const snap = sampleSession()
  await sess.save(snap)
  check('session.json 파일 생성됨(즉시 flush)', await exists(paths.session))
  const back = await sess.load()
  check('windows 수 일치', back.windows.length === 1)
  check('tab.layout 복원', back.windows[0].tabs[0].layout === 'split-2-v')
  check('panel[0].path 복원', back.windows[0].tabs[0].panels[0].path === 'C:\\Users\\me\\Documents')
  check('panel[0].sortKey 복원', back.windows[0].tabs[0].panels[0].sortKey === 'mtime')
  check('panel[0].scrollTop 복원', back.windows[0].tabs[0].panels[0].scrollTop === 420)
  check('history.back 복원', back.windows[0].tabs[0].panels[0].history.back[0] === 'C:\\Users\\me')
  check('sidebar.favorites 복원', back.sidebar.favorites[0] === 'C:\\fav')
  check('sidebar.favoriteLabels 복원(J8)', back.sidebar.favoriteLabels?.['C:\\fav'] === '즐겨찾기')
  check('sidebar.pinnedByDir 복원(상단 고정)', back.sidebar.pinnedByDir?.['C:\\d']?.[0] === 'C:\\d\\pin.txt')
  check('ui.theme 복원', back.ui.theme === 'dark')
  check('ui.previewWidth 복원(J7)', back.ui.previewWidth === 360)
  check(
    'splitRatios 정상 비율 보존(0.5/0.3)',
    back.windows[0].tabs[0].splitRatios?.col === 0.5 && back.windows[0].tabs[0].splitRatios?.row === 0.3
  )
  check(
    '전체 직렬화 동등(JSON.stringify 라운드트립)',
    JSON.stringify(back) === JSON.stringify(snap)
  )

  // recentLimit 적용: recent 가 limit 보다 길면 잘림
  await settings2.set({ recentLimit: 1 })
  const sessLimited = new SessionStore(paths, () => settings2.get().recentLimit, 0)
  const backLimited = await sessLimited.load()
  check('recentLimit=1 적용 → recent 1개로 슬라이스', backLimited.sidebar.recent.length === 1)
  await settings2.set({ recentLimit: 10 })

  // ── 3) 손상/무효 → 폴백 ───────────────────────────────────────────────
  line('== 3) 손상 파일 → 기본값/안전 폴백(크래시 프리) ==')
  await fsp.writeFile(paths.settings, '{ this is not valid json ]]', 'utf8')
  const corruptSettings = new SettingsStore(paths)
  const cs = await corruptSettings.load()
  check('손상 settings.json → 기본값 폴백', cs.theme === 'system' && cs.showExtensions === true)

  await fsp.writeFile(paths.session, '   broken', 'utf8')
  const corruptSess = new SessionStore(paths, () => 10, 0)
  const csess = await corruptSess.load()
  check('손상 session.json → 빈 windows 안전 폴백', csess.windows.length === 0)
  check('손상 폴백도 version 채워짐(v1)', csess.version === 1)

  // 구조 무효(필수 필드 누락) → 해당 항목 드롭
  await writeJsonAtomic(paths.session, {
    version: 1,
    windows: [
      { tabs: [{ id: 't', activePanelId: 'p', layout: 'single', panels: [{ id: 'p' /* path 없음 */ }] }], activeTabId: 't' },
      { tabs: [{ id: 't2', activePanelId: 'p2', layout: 'single', panels: [{ id: 'p2', path: 'C:\\ok' }] }], activeTabId: 't2' }
    ],
    sidebar: { favorites: [], recent: [], width: 240, collapsed: false },
    ui: { theme: 'system', previewOpen: false }
  })
  const partial = await corruptSess.load()
  check('path 없는 panel 의 탭/창 드롭, 유효한 창만 복원', partial.windows.length === 1 && partial.windows[0].tabs[0].panels[0].path === 'C:\\ok')

  // ── 4) 원자적 쓰기 ────────────────────────────────────────────────────
  line('== 4) 원자적 쓰기(temp→rename) ==')
  const okWrite = await writeJsonAtomic(paths.settings, defaultSettings())
  check('writeJsonAtomic 성공', okWrite)
  check('쓰기 후 .tmp 잔여 없음', !(await exists(`${paths.settings}.tmp`)))
  const parsedBack = await readJsonSafe<SettingsSnapshot>(paths.settings)
  check('쓰여진 파일이 완전한 JSON 으로 재파싱됨', parsedBack !== undefined && parsedBack.version === 1)

  // ── 5) 휘발 상태 제외 ─────────────────────────────────────────────────
  line('== 5) 휘발 상태 제외(selection/op/closedHistory/drag/rename) ==')
  // raw 에 휘발 필드를 강제로 섞어 저장 → 로드 시 정규화로 사라져야 한다.
  const tainted = {
    ...sampleSession(),
    closedHistory: ['C:\\closed-tab'], // 창 수준 휘발
    selection: ['C:\\sel'], // 선택 휘발
    activeOperation: { id: 'op-1' } // 진행 중 작업 휘발
  } as unknown
  await writeJsonAtomic(paths.session, tainted)
  const cleaned = await corruptSess.load()
  const cleanedKeys = Object.keys(cleaned as Record<string, unknown>).sort().join(',')
  check('복원 스냅샷에 휘발 키 없음(sidebar,ui,version,windows 만)', cleanedKeys === 'sidebar,ui,version,windows')
  check('closedHistory 직렬화/복원 안 됨', !('closedHistory' in (cleaned as Record<string, unknown>)))
  check('selection 직렬화/복원 안 됨', !('selection' in (cleaned as Record<string, unknown>)))
  check('activeOperation 직렬화/복원 안 됨', !('activeOperation' in (cleaned as Record<string, unknown>)))

  // ── 5b) splitRatios 정규화(feat-H3 §3.4) ──────────────────────────────
  line('== 5b) splitRatios coerce(클램프/누락폴백/비객체방어/구버전호환) ==')
  const ratioTab = (sr: unknown): unknown => ({
    version: 1,
    windows: [
      {
        tabs: [
          {
            id: 't',
            activePanelId: 'p',
            layout: 'grid-4',
            splitRatios: sr,
            panels: [{ id: 'p', path: 'C:\\ok' }]
          }
        ],
        activeTabId: 't'
      }
    ],
    sidebar: { favorites: [], recent: [], width: 240, collapsed: false },
    ui: { theme: 'system', previewOpen: false }
  })
  const loadRatio = async (sr: unknown): Promise<SessionSnapshot['windows'][0]['tabs'][0]['splitRatios']> => {
    await writeJsonAtomic(paths.session, ratioTab(sr))
    const r = await corruptSess.load()
    return r.windows[0]?.tabs[0]?.splitRatios
  }

  // 범위초과 → 0.15~0.85 클램프
  const over = await loadRatio({ col: 0.99, row: 0.01 })
  check('범위초과 splitRatios → col 0.85 / row 0.15 클램프', over?.col === 0.85 && over?.row === 0.15)
  const neg = await loadRatio({ col: -3, row: 5 })
  check('음수/과대 splitRatios → 0.15 / 0.85 클램프', neg?.col === 0.15 && neg?.row === 0.85)

  // 비유한수(NaN/Infinity/문자열) → 해당 축 0.5 폴백
  const taintedRatio = await loadRatio({ col: 'oops', row: Number.POSITIVE_INFINITY })
  check('비유한 축 → 0.5 폴백', taintedRatio?.col === 0.5 && taintedRatio?.row === 0.5)
  const partialRatio = await loadRatio({ col: 0.2 }) // row 누락
  check('축 일부 누락 → 누락 축만 0.5, 유효 축 보존', partialRatio?.col === 0.2 && partialRatio?.row === 0.5)

  // 누락/비객체 → 필드 생략(undefined), 구버전 세션 호환
  const missing = await loadRatio(undefined)
  check('splitRatios 누락 → 필드 생략(undefined)', missing === undefined)
  const nonObj = await loadRatio('not-an-object')
  check('splitRatios 문자열(비객체) → 필드 생략', nonObj === undefined)
  const arr = await loadRatio([0.5, 0.5])
  check('splitRatios 배열(비객체) → 필드 생략', arr === undefined)
  const nul = await loadRatio(null)
  check('splitRatios null → 필드 생략', nul === undefined)
  // 구버전 세션: 탭 객체에 splitRatios 키 자체가 없음
  await writeJsonAtomic(paths.session, {
    version: 1,
    windows: [
      {
        tabs: [{ id: 't', activePanelId: 'p', layout: 'single', panels: [{ id: 'p', path: 'C:\\ok' }] }],
        activeTabId: 't'
      }
    ],
    sidebar: { favorites: [], recent: [], width: 240, collapsed: false },
    ui: { theme: 'system', previewOpen: false }
  })
  const legacy = await corruptSess.load()
  check('구버전 세션(splitRatios 키 없음) 크래시 프리 복원', legacy.windows.length === 1)
  check('구버전 세션 → splitRatios 미부착(undefined)', legacy.windows[0].tabs[0].splitRatios === undefined)

  // ── 6) 디바운스 ───────────────────────────────────────────────────────
  line('== 6) 디바운스 저장(변경 합산) + flush ==')
  await fsp.rm(paths.session, { force: true })
  const debounced = new SessionStore(paths, () => 10, 50) // 50ms 디바운스
  await debounced.save(sampleSession())
  check('save 직후(디바운스 대기) 파일 미기록', !(await exists(paths.session)))
  check('hasPending=true', debounced.hasPending())
  const wrote = await debounced.flush()
  check('flush 시 기록됨', wrote && (await exists(paths.session)))
  check('flush 후 hasPending=false', !debounced.hasPending())
  const noPending = await debounced.flush()
  check('보류 없을 때 flush → false(no-op)', noPending === false)

  // 연속 save 합산: 마지막 값만 기록
  await fsp.rm(paths.session, { force: true })
  const d2 = new SessionStore(paths, () => 10, 50)
  const s1 = sampleSession()
  const s2 = { ...sampleSession(), ui: { theme: 'light' as const, previewOpen: true } }
  await d2.save(s1)
  await d2.save(s2)
  await d2.flush()
  const merged = await readJsonSafe<SessionSnapshot>(paths.session)
  check('연속 save 합산 → 마지막(light) 만 기록', merged?.ui.theme === 'light')

  // ── 7) 텔레메트리 옵트인 ──────────────────────────────────────────────
  line('== 7) 텔레메트리 옵트인(기본 false → 영속 → 유지) ==')
  const tStore = new SettingsStore(paths)
  await tStore.load()
  check('기본 옵트인 false', tStore.isTelemetryOptIn() === false)
  await tStore.setTelemetryOptIn(true)
  check('telemetry.json 생성됨', await exists(paths.telemetry))
  const tStore2 = new SettingsStore(paths)
  await tStore2.load()
  check('재로드 후 옵트인 true 유지', tStore2.isTelemetryOptIn() === true)
  await tStore2.setTelemetryOptIn(false)
  const tStore3 = new SettingsStore(paths)
  await tStore3.load()
  check('다시 false 로 복귀 영속', tStore3.isTelemetryOptIn() === false)

  // ── 8) J8: coerceSidebar.favoriteLabels(고아 제거·값검증·구버전) ─────────
  line('== 8) J8 favoriteLabels coerce(고아 제거/값검증/구버전 호환) ==')
  const defSb = defaultSidebar()
  check('defaultSidebar.favoriteLabels = {}', JSON.stringify(defSb.favoriteLabels) === '{}')

  const cs8 = (sidebar: unknown): SessionSnapshot['sidebar'] =>
    coerceSession(
      {
        version: 1,
        windows: [],
        sidebar,
        ui: { theme: 'system', previewOpen: false }
      },
      10
    ).sidebar

  // 정상 라벨: favorites 에 있는 키만 보존.
  const sbOk = cs8({ favorites: ['C:\\a', 'C:\\b'], favoriteLabels: { 'C:\\a': '문서', 'C:\\b': '작업' } })
  check('favoriteLabels 정상 보존', sbOk.favoriteLabels?.['C:\\a'] === '문서' && sbOk.favoriteLabels?.['C:\\b'] === '작업')

  // 고아 키 제거: favorites 에 없는 경로의 라벨은 버린다.
  const sbOrphan = cs8({ favorites: ['C:\\a'], favoriteLabels: { 'C:\\a': '문서', 'C:\\gone': '고아' } })
  check('고아 라벨(favorites 없음) 제거', sbOrphan.favoriteLabels?.['C:\\gone'] === undefined)
  check('고아 제거 후 유효 라벨 보존', sbOrphan.favoriteLabels?.['C:\\a'] === '문서')

  // 값 검증: 비문자열·빈 문자열 라벨 제거.
  const sbBad = cs8({ favorites: ['C:\\a', 'C:\\b', 'C:\\c'], favoriteLabels: { 'C:\\a': 123, 'C:\\b': '', 'C:\\c': 'ok' } })
  check('비문자열 라벨 제거', sbBad.favoriteLabels?.['C:\\a'] === undefined)
  check('빈 문자열 라벨 제거', sbBad.favoriteLabels?.['C:\\b'] === undefined)
  check('정상 문자열 라벨 보존', sbBad.favoriteLabels?.['C:\\c'] === 'ok')

  // 구버전: favorites 만 있고 favoriteLabels 없음 → 빈 맵.
  const sbLegacy = cs8({ favorites: ['C:\\a'] })
  check('구버전(favoriteLabels 없음) → {}', JSON.stringify(sbLegacy.favoriteLabels) === '{}')

  // favoriteLabels 가 비객체(배열/문자열) → {} 폴백(크래시 없음).
  const sbNonObj = cs8({ favorites: ['C:\\a'], favoriteLabels: ['x'] })
  check('favoriteLabels 비객체 → {}', JSON.stringify(sbNonObj.favoriteLabels) === '{}')

  // ── 8b) 상단 고정(pinnedByDir) coerce(빈 배열 제거·비문자열 정리·구버전) ──
  line('== 8b) pinnedByDir coerce(빈배열 제거/비문자열 정리/구버전 호환) ==')
  check('defaultSidebar.pinnedByDir = {}', JSON.stringify(defSb.pinnedByDir) === '{}')
  const sbPin = cs8({ favorites: [], pinnedByDir: { 'C:\\d': ['C:\\d\\a.txt', 'C:\\d\\b.txt'] } })
  check('pinnedByDir 정상 보존', sbPin.pinnedByDir?.['C:\\d']?.length === 2)
  const sbPinEmpty = cs8({ favorites: [], pinnedByDir: { 'C:\\d': [] } })
  check('빈 배열 키 제거', sbPinEmpty.pinnedByDir?.['C:\\d'] === undefined)
  const sbPinBad = cs8({ favorites: [], pinnedByDir: { 'C:\\d': ['C:\\d\\ok.txt', 123, null] } })
  check('비문자열 항목 정리', JSON.stringify(sbPinBad.pinnedByDir?.['C:\\d']) === JSON.stringify(['C:\\d\\ok.txt']))
  const sbPinLegacy = cs8({ favorites: ['C:\\a'] })
  check('구버전(pinnedByDir 없음) → {}', JSON.stringify(sbPinLegacy.pinnedByDir) === '{}')
  const sbPinNonObj = cs8({ favorites: [], pinnedByDir: ['x'] })
  check('pinnedByDir 비객체 → {}', JSON.stringify(sbPinNonObj.pinnedByDir) === '{}')

  // ── 8c) T1: 파일 태그(tagsByPath) coerce(무효키/빈배열/비배열/팔레트순/구버전) ──
  line('== 8c) tagsByPath coerce(무효키 제거/빈배열 제외/팔레트순/구버전 호환) ==')
  check('defaultSidebar.tagsByPath = {}', JSON.stringify(defSb.tagsByPath) === '{}')
  const sbTag = cs8({ favorites: [], tagsByPath: { 'C:\\a': ['blue', 'red'] } })
  check('tagsByPath 팔레트순 보존(red<blue)', JSON.stringify(sbTag.tagsByPath?.['C:\\a']) === JSON.stringify(['red', 'blue']))
  const sbTagBad = cs8({ favorites: [], tagsByPath: { 'C:\\a': ['red', 'cyan', 1] } })
  check('무효 태그 키 제거', JSON.stringify(sbTagBad.tagsByPath?.['C:\\a']) === JSON.stringify(['red']))
  const sbTagEmpty = cs8({ favorites: [], tagsByPath: { 'C:\\a': [] } })
  check('빈 배열 키 제외', sbTagEmpty.tagsByPath?.['C:\\a'] === undefined)
  const sbTagNonArr = cs8({ favorites: [], tagsByPath: { 'C:\\a': 'red' } })
  check('비배열 값 제외', sbTagNonArr.tagsByPath?.['C:\\a'] === undefined)
  const sbTagLegacy = cs8({ favorites: ['C:\\a'] })
  check('구버전(tagsByPath 없음) → {}', JSON.stringify(sbTagLegacy.tagsByPath) === '{}')
  const sbTagNonObj = cs8({ favorites: [], tagsByPath: ['x'] })
  check('tagsByPath 비객체 → {}', JSON.stringify(sbTagNonObj.tagsByPath) === '{}')

  // ── 9) J7: coerceSession.ui.previewWidth(클램프 240~720·생략) ────────────
  line('== 9) J7 previewWidth coerce(클램프/누락생략/비유한수) ==')
  const cs9 = (ui: Record<string, unknown>): SessionSnapshot['ui'] =>
    coerceSession({ version: 1, windows: [], sidebar: defaultSidebar(), ui }, 10).ui

  const pwIn = cs9({ theme: 'system', previewOpen: false, previewWidth: 400 })
  check('previewWidth 범위 내(400) 보존', pwIn.previewWidth === 400)
  const pwLo = cs9({ theme: 'system', previewOpen: false, previewWidth: 100 })
  check('previewWidth 하한 미만(100) → 240 클램프', pwLo.previewWidth === 240)
  const pwHi = cs9({ theme: 'system', previewOpen: false, previewWidth: 9999 })
  check('previewWidth 상한 초과(9999) → 720 클램프', pwHi.previewWidth === 720)
  const pwNan = cs9({ theme: 'system', previewOpen: false, previewWidth: Number.NaN })
  check('previewWidth NaN → 키 생략(undefined)', pwNan.previewWidth === undefined && !('previewWidth' in pwNan))
  const pwStr = cs9({ theme: 'system', previewOpen: false, previewWidth: '300' })
  check('previewWidth 문자열 → 키 생략', pwStr.previewWidth === undefined)
  const pwMissing = cs9({ theme: 'system', previewOpen: false })
  check('previewWidth 누락(구버전) → 키 생략', pwMissing.previewWidth === undefined && !('previewWidth' in pwMissing))
  // 경계값.
  check('previewWidth 경계 240 보존', cs9({ theme: 'system', previewOpen: false, previewWidth: 240 }).previewWidth === 240)
  check('previewWidth 경계 720 보존', cs9({ theme: 'system', previewOpen: false, previewWidth: 720 }).previewWidth === 720)

  // ── 10) J6: readPreview lang/isMarkdown(텍스트 분기 힌트) ────────────────
  line('== 10) J6 readPreview lang/isMarkdown(구문강조 언어/마크다운) ==')
  const jbase = await fsp.mkdtemp(join(os.tmpdir(), 'explorer-jpreview-'))
  const mkPrev = async (name: string, content: string): Promise<import('@shared/dto').PreviewData> => {
    const p = join(jbase, name)
    await fsp.writeFile(p, content, 'utf8')
    return fileSystemService.readPreview(p)
  }
  const rTs = await mkPrev('a.ts', 'const x: number = 1')
  check('.ts → kind=text, lang=typescript', rTs.kind === 'text' && rTs.lang === 'typescript')
  check('.ts → isMarkdown 미설정', rTs.isMarkdown !== true)
  const rJs = await mkPrev('a.js', 'const x = 1')
  check('.js → lang=javascript', rJs.lang === 'javascript')
  const rPy = await mkPrev('a.py', 'x = 1')
  check('.py → lang=python', rPy.lang === 'python')
  const rGo = await mkPrev('a.go', 'package main')
  check('.go → lang=go', rGo.lang === 'go')
  const rRs = await mkPrev('a.rs', 'fn main() {}')
  check('.rs → lang=rust', rRs.lang === 'rust')
  const rPs1 = await mkPrev('a.ps1', 'Write-Host hi')
  check('.ps1 → lang=powershell', rPs1.lang === 'powershell')
  const rMd = await mkPrev('a.md', '# Title\n\ntext')
  check('.md → kind=text, isMarkdown=true', rMd.kind === 'text' && rMd.isMarkdown === true)
  check('.md → lang=markdown', rMd.lang === 'markdown')
  const rMarkdown = await mkPrev('a.markdown', '# T')
  check('.markdown → isMarkdown=true', rMarkdown.isMarkdown === true)
  const rTxt2 = await mkPrev('plain.txt', 'just text')
  check('.txt → lang 미설정(plain)', rTxt2.kind === 'text' && rTxt2.lang === undefined)
  check('.txt → isMarkdown 미설정', rTxt2.isMarkdown !== true)
  const rNoextJ = await mkPrev('LICENSE', 'no ext')
  check('무확장자 → kind=text, lang 미설정', rNoextJ.kind === 'text' && rNoextJ.lang === undefined)
  const rJson = await mkPrev('a.json', '{"k":1}')
  check('.json → lang=json', rJson.lang === 'json')
  const rYaml = await mkPrev('a.yaml', 'k: 1')
  check('.yaml → lang=yaml', rYaml.lang === 'yaml')
  await fsp.rm(jbase, { recursive: true, force: true }).catch(() => undefined)

  // ── 11) 세션 version 1 + filterPresets 부재(프리셋 제거 후 환원) ───────────
  line('== 11) 세션 version 1 환원 / filterPresets 필드 부재 ==')
  const dsess = defaultSession()
  check('defaultSession.version=1', dsess.version === 1)
  check('defaultSession.filterPresets 필드 없음', !('filterPresets' in (dsess as Record<string, unknown>)))

  // 구버전 raw(filterPresets 키가 섞여 들어와도) coerce 가 무시·복원 안 함.
  const cs11 = (sessRaw: unknown): SessionSnapshot => coerceSession(sessRaw, 10)
  const noPreset = cs11({
    version: 1,
    windows: [{ tabs: [{ id: 't', activePanelId: 'p', layout: 'single', panels: [{ id: 'p', path: 'C:\\ok' }] }], activeTabId: 't' }],
    sidebar: { favorites: [], recent: [], width: 240, collapsed: false },
    ui: { theme: 'system', previewOpen: false },
    filterPresets: [{ id: 'x', name: '폐기' }]
  })
  check('coerce version 1 유지', noPreset.version === 1)
  check('coerce 가 filterPresets 무시(필드 없음)', !('filterPresets' in (noPreset as Record<string, unknown>)))

  // version 1 round-trip(SessionStore): sampleSession 저장→로드 동등.
  const sessRt = new SessionStore(paths, () => 10, 0)
  await sessRt.save(sampleSession())
  const backRt = await sessRt.load()
  check('round-trip version 1', backRt.version === 1)
  check('round-trip 전체 동등(JSON)', JSON.stringify(backRt) === JSON.stringify(sampleSession()))

  // ── 정리 ──────────────────────────────────────────────────────────────
  await fsp.rm(base, { recursive: true, force: true }).catch(() => undefined)
  line('')
  line(`RESULT: ${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

void main()
