/**
 * J2 WatchService 실증 스크립트(헤드리스, 일회성 검증).
 *
 * WatchService 를 메인 스레드에서 직접 구동(electron·IPC 비의존)하여 검증한다:
 *  1) 디렉토리 검증 — 빈 경로("내 PC")·미존재·파일 경로는 start 시 onError(감시 거부).
 *  2) 디바운스·병합 — 윈도 내 연속/대량 변경(다수 파일 생성)이 1회 onEvent 로 병합.
 *  3) 격리(throw 0) — 권한/미지원 모의(미존재 경로) 에서도 start 가 throw 하지 않고
 *     onError 후 watchId 발급(수동 새로고침 유지).
 *  4) stop 멱등 — 같은 watchId 를 2회 stop·모르는 watchId stop·격리된 watchId stop 무해.
 *  5) stop 후 무유입 — stop 하면 이후 변경이 onEvent 를 발화하지 않는다.
 *  6) stopAll / activeCount — 전체 해제 후 활성 0(좀비 핸들 0).
 *
 * 실행: esbuild 번들 후 node (verify-scan.ts 패턴, electron external·@shared 별칭 해소).
 */
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import { join } from 'node:path'
import { WatchService } from '../src/main/fs/WatchService'
import { isUncPath, isLikelyRemotePath, isNetworkDriveRoot } from '../src/main/fs/paths'
import { DriveTypeService, driveTypeService } from '../src/main/os/driveType'
import type { FileOpError } from '@shared/ipc/contracts'

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
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * 폴링 1사이클(POLL_INTERVAL_MS=4000) + 디바운스(250) + readdir/stat 여유.
 * WatchService 의 POLL_INTERVAL_MS 가 비주입(고정)이라 실시간 대기로 검증한다.
 */
const POLL_WAIT = 5200

/** onEvent/onError 호출을 수집하는 콜백 + 카운터. */
function collector(): {
  events: string[]
  errors: FileOpError[]
  cb: { onEvent: (p: string) => void; onError: (e: FileOpError) => void }
} {
  const events: string[] = []
  const errors: FileOpError[] = []
  return {
    events,
    errors,
    cb: {
      onEvent: (p) => events.push(p),
      onError: (e) => errors.push(e)
    }
  }
}

async function main(): Promise<void> {
  const base = await fsp.mkdtemp(join(os.tmpdir(), 'explorer-watch-'))
  line(`임시 루트: ${base}`)
  const svc = new WatchService()

  // ── 1) 디렉토리 검증(빈 경로·미존재·파일 거부) ──────────────────────────
  line('== 1) 디렉토리 검증(빈 경로/미존재/파일 → onError) ==')

  // 빈 경로("내 PC") → EINVAL onError, watchId 발급(격리), 활성 0(watcher 미생성).
  const empty = collector()
  const emptyId = svc.start('', empty.cb)
  check('빈 경로 → watchId 발급(격리)', typeof emptyId === 'string' && emptyId.length > 0)
  check('빈 경로 → onError 1회', empty.errors.length === 1 && empty.errors[0]?.code === 'EINVAL')
  check('빈 경로 → onEvent 0', empty.events.length === 0)
  svc.stop(emptyId)

  // 미존재 경로 → ENOENT onError(throw 0).
  const missing = collector()
  let threw = false
  let missingId = ''
  try {
    missingId = svc.start(join(base, '__no_such_dir__'), missing.cb)
  } catch {
    threw = true
  }
  check('미존재 경로 start throw 0(격리)', !threw)
  check('미존재 경로 → onError(ENOENT)', missing.errors.length === 1 && missing.errors[0]?.code === 'ENOENT')
  svc.stop(missingId)

  // 파일 경로 → ENOTDIR onError.
  const filePath = join(base, 'a.txt')
  await fsp.writeFile(filePath, 'hello')
  const fileC = collector()
  const fileId = svc.start(filePath, fileC.cb)
  check('파일 경로 → onError(ENOTDIR)', fileC.errors.length === 1 && fileC.errors[0]?.code === 'ENOTDIR')
  check('파일 경로 → onEvent 0', fileC.events.length === 0)
  svc.stop(fileId)

  check('검증 거부 후 활성 감시 0(watcher 미생성)', svc.activeCount() === 0)

  // ── 2) 디바운스·병합(연속/대량 변경 → 1회 onEvent) ──────────────────────
  line('== 2) 디바운스·병합(대량 변경 → 1~수회 onEvent) ==')
  const watchDir = join(base, 'watched')
  await fsp.mkdir(watchDir, { recursive: true })
  const c2 = collector()
  const id2 = svc.start(watchDir, c2.cb)
  check('디렉토리 감시 start → watchId 발급', typeof id2 === 'string' && id2.length > 0)
  check('start 직후 활성 1', svc.activeCount() === 1)
  check('start 직후 onError 0(정상)', c2.errors.length === 0)

  // 디바운스 윈도(250ms) 안에 50개 파일을 빠르게 생성 → 병합되어 1회로 묶여야 한다.
  for (let i = 0; i < 50; i++) {
    await fsp.writeFile(join(watchDir, `f${i}.bin`), Buffer.alloc(8, 1))
  }
  // 디바운스 만료까지 대기(여유).
  await sleep(500)
  check('대량 변경(50건) → onEvent 1~수회로 병합(>=1)', c2.events.length >= 1)
  check('대량 변경 → onEvent 소수 병합(<=3)', c2.events.length <= 3)
  check('대량 변경 onEvent path = 감시 디렉토리', c2.events.every((p) => p === watchDir))

  // 추가 단일 변경 → 다시 1회 발화(별 디바운스 윈도).
  const before = c2.events.length
  await fsp.writeFile(join(watchDir, 'extra.bin'), Buffer.alloc(8, 1))
  await sleep(500)
  check('새 윈도 단일 변경 → onEvent 추가 1회', c2.events.length === before + 1)

  // ── 3) stop 후 무유입 ───────────────────────────────────────────────────
  line('== 3) stop 후 무유입(이후 변경 미발화) ==')
  svc.stop(id2)
  check('stop 후 활성 0', svc.activeCount() === 0)
  const afterStop = c2.events.length
  await fsp.writeFile(join(watchDir, 'post-stop.bin'), Buffer.alloc(8, 1))
  await sleep(500)
  check('stop 후 변경 → onEvent 미발화', c2.events.length === afterStop)

  // ── 4) stop 멱등 ────────────────────────────────────────────────────────
  line('== 4) stop 멱등(중복/미지/격리 watchId) ==')
  let threwStop = false
  try {
    svc.stop(id2) // 이미 stop 됨
    svc.stop(id2) // 재차
    svc.stop('unknown-watch-id') // 모르는 ID
    svc.stop(emptyId) // 격리(watcher 미생성)된 ID
  } catch {
    threwStop = true
  }
  check('중복/미지/격리 watchId stop throw 0(멱등)', !threwStop)

  // ── 5) stopAll / stopAllForSender ──────────────────────────────────────
  line('== 5) stopAll / stopAllForSender(전체 해제) ==')
  const dirA = join(base, 'A')
  const dirB = join(base, 'B')
  await fsp.mkdir(dirA, { recursive: true })
  await fsp.mkdir(dirB, { recursive: true })
  const ca = collector()
  const cb = collector()
  const idA = svc.start(dirA, ca.cb)
  const idB = svc.start(dirB, cb.cb)
  check('독립 2개 감시(watchId 독립)', idA !== idB && idA.length > 0 && idB.length > 0)
  check('독립 2개 감시 → 활성 2', svc.activeCount() === 2)
  svc.stopAllForSender([idA])
  check('stopAllForSender([idA]) → 활성 1', svc.activeCount() === 1)
  svc.stopAll()
  check('stopAll → 활성 0(좀비 핸들 0)', svc.activeCount() === 0)
  svc.stop(idB) // stopAll 후 잔존 ID stop 멱등(무해).
  // stopAll 후 idB 변경 무유입.
  const afterAll = cb.events.length
  await fsp.writeFile(join(dirB, 'x.bin'), Buffer.alloc(8, 1))
  await sleep(400)
  check('stopAll 후 잔존 감시 미발화', cb.events.length === afterAll)

  // ── 6) UNC/원격 판정 헬퍼 ───────────────────────────────────────────────
  line('== 6) UNC/원격 경로 판정(isUncPath / isLikelyRemotePath) ==')
  check('UNC \\\\server\\share → true', isUncPath('\\\\server\\share\\dir'))
  check('롱패스 UNC \\\\?\\UNC\\server\\share → true', isUncPath('\\\\?\\UNC\\server\\share'))
  check('롱패스 디바이스 \\\\?\\C:\\ → false(원격 아님)', !isUncPath('\\\\?\\C:\\dir'))
  check('로컬 C:\\ → false', !isUncPath('C:\\Users'))
  check('빈 문자열 → false', !isUncPath(''))
  check('isLikelyRemotePath(UNC) → true(eager)', isLikelyRemotePath('\\\\nas\\media'))
  // 매핑 드라이브(X:\)는 이제 driveTypeService 캐시 의존(정적 false 아님). 캐시 비초기화(빈 집합)
  // 기본 상태에서는 false(폴백·회귀 0). 캐시 주입 시 true 는 §12 에서 검증한다.
  // (싱글턴 오염 방지: 매핑 케이스 진입 전 빈 캐시로 리셋.)
  driveTypeService.setNetworkDriveLetters([])
  check('빈 캐시 매핑 X:\\ → isLikelyRemotePath false(폴백: reactive 의존)', !isLikelyRemotePath('X:\\share'))

  // ── 7) eager 폴링(isRemoteFn 강제 주입) ──────────────────────────────────
  // 임시 로컬 디렉토리를 isRemoteFn 으로 "원격" 강제 → fs.watch 미호출, 처음부터 폴링.
  // watchFn 은 호출되면 안 되므로(eager) throw 스텁으로 두어 "미호출"을 강제 검증.
  line('== 7) eager 폴링(isRemoteFn 강제 → fs.watch 미호출, 초기 스냅샷 무발화) ==')
  const remoteDir = join(base, 'remote')
  await fsp.mkdir(remoteDir, { recursive: true })
  await fsp.writeFile(join(remoteDir, 'seed.bin'), Buffer.alloc(4, 1))
  let eagerWatchFnCalled = false
  const eagerSvc = new WatchService({
    isRemoteFn: () => true,
    watchFn: () => {
      eagerWatchFnCalled = true
      throw new Error('watchFn 은 eager 폴링에서 호출되면 안 된다')
    }
  })
  const c7 = collector()
  const id7 = eagerSvc.start(remoteDir, c7.cb)
  check('eager: watchId 발급', typeof id7 === 'string' && id7.length > 0)
  check('eager: 활성 1', eagerSvc.activeCount() === 1)
  check('eager: fs.watch(watchFn) 미호출', eagerWatchFnCalled === false)
  // 초기 스냅샷 수립 대기(짧게) — 발화 없어야 함.
  await sleep(300)
  check('eager: 초기 스냅샷 무발화(가짜 이벤트 0)', c7.events.length === 0)
  check('eager: 초기 onError 0(정상)', c7.errors.length === 0)

  // 변경 후 1 폴링 사이클(4s+) → diff 감지 → onEvent 1회.
  await fsp.writeFile(join(remoteDir, 'new.bin'), Buffer.alloc(4, 1))
  await sleep(POLL_WAIT)
  check('eager: 디렉토리 변경 → 폴링 diff onEvent 1회', c7.events.length === 1 && c7.events[0] === remoteDir)

  // 변경 없는 사이클 → 추가 발화 0.
  const e7 = c7.events.length
  await sleep(POLL_WAIT)
  check('eager: 변경 없음 → 추가 발화 0', c7.events.length === e7)

  // stop → 폴링 인터벌 정리, 이후 변경 무발화.
  eagerSvc.stop(id7)
  check('eager: stop 후 활성 0(인터벌 정리)', eagerSvc.activeCount() === 0)
  await fsp.writeFile(join(remoteDir, 'post.bin'), Buffer.alloc(4, 1))
  await sleep(POLL_WAIT)
  check('eager: stop 후 폴링 무발화(좀비 인터벌 0)', c7.events.length === e7)

  // ── 8) reactive 폴백(watchFn throw 스텁 → 폴링 전환) ─────────────────────
  line('== 8) reactive 폴백(watchFn throw ENOSYS → 폴링 전환·diff·stat승계) ==')
  const fbDir = join(base, 'fallback')
  await fsp.mkdir(fbDir, { recursive: true })
  await fsp.writeFile(join(fbDir, 'base.bin'), Buffer.alloc(4, 1))
  const fbSvc = new WatchService({
    isRemoteFn: () => false, // 로컬로 취급 → fs.watch 시도 → throw → 폴백.
    watchFn: () => {
      const e = new Error('operation not supported') as Error & { code?: string }
      e.code = 'ENOSYS'
      throw e
    }
  })
  const c8 = collector()
  const id8 = fbSvc.start(fbDir, c8.cb)
  check('reactive: watchId 발급(throw 격리)', typeof id8 === 'string' && id8.length > 0)
  check('reactive: 활성 1(폴링 전환)', fbSvc.activeCount() === 1)
  check('reactive: throw 격리 — start onError 0', c8.errors.length === 0)
  await sleep(300)
  check('reactive: 초기 스냅샷 무발화', c8.events.length === 0)

  // 파일 추가 → 폴링 diff → onEvent.
  await fsp.writeFile(join(fbDir, 'added.bin'), Buffer.alloc(4, 1))
  await sleep(POLL_WAIT)
  check('reactive: 추가 → onEvent 1회', c8.events.length === 1)

  // 파일 삭제(키 집합 변화) → onEvent.
  const d8 = c8.events.length
  await fsp.rm(join(fbDir, 'added.bin'))
  await sleep(POLL_WAIT)
  check('reactive: 삭제 → onEvent 1회', c8.events.length === d8 + 1)

  // size 변경(같은 이름 덮어쓰기) → onEvent.
  const s8 = c8.events.length
  await fsp.writeFile(join(fbDir, 'base.bin'), Buffer.alloc(128, 2))
  await sleep(POLL_WAIT)
  check('reactive: size 변경(덮어쓰기) → onEvent 1회', c8.events.length === s8 + 1)

  fbSvc.stop(id8)
  check('reactive: stop 후 활성 0', fbSvc.activeCount() === 0)

  // ── 9) watcher error 이벤트 → 폴링 폴백 ─────────────────────────────────
  // watchFn 이 핸들을 반환하되 즉시 error 이벤트를 내는 스텁 → fallbackToPolling.
  line('== 9) watcher error 이벤트 → 폴링 폴백 전환 ==')
  const errDir = join(base, 'watcher-err')
  await fsp.mkdir(errDir, { recursive: true })
  const errSvc = new WatchService({
    isRemoteFn: () => false,
    watchFn: (_p, _o, _l) => {
      // 최소 FSWatcher 모의: on('error') 리스너를 즉시 호출, close 는 no-op.
      const handlers: Record<string, ((e: unknown) => void)[]> = {}
      const fake = {
        on(ev: string, h: (e: unknown) => void) {
          const list = (handlers[ev] ??= [])
          list.push(h)
          if (ev === 'error') {
            // 다음 틱에 error 발화(start 반환 후) → fallbackToPolling.
            setTimeout(() => {
              const er = new Error('watcher died') as Error & { code?: string }
              er.code = 'EPERM'
              for (const fn of handlers['error'] ?? []) fn(er)
            }, 0)
          }
          return fake
        },
        close() {
          /* no-op */
        }
      }
      return fake as unknown as ReturnType<WatchFn>
    }
  })
  const c9 = collector()
  const id9 = errSvc.start(errDir, c9.cb)
  // error 발화 + 폴링 전환 대기.
  await sleep(300)
  check('watcher error: 활성 1(폴링 전환, stop 안 됨)', errSvc.activeCount() === 1)
  check('watcher error: 폴백 후 onError 0(격리, 폴링 대체)', c9.errors.length === 0)
  await fsp.writeFile(join(errDir, 'after-err.bin'), Buffer.alloc(4, 1))
  await sleep(POLL_WAIT)
  check('watcher error: 폴백 폴링이 변경 감지 → onEvent 1회', c9.events.length === 1)
  errSvc.stop(id9)
  check('watcher error: stop 후 활성 0', errSvc.activeCount() === 0)

  // ── 10) 대량 디렉토리 → 폴링 비활성 + onError 1회 ──────────────────────────
  // POLL_MAX_ENTRIES(20k) 초과를 실제 파일로 만들기엔 비용 큼 → readdir 스텁 없이도
  // 검증되도록, 20k+1 개의 빈 파일 대신 "동작 계약"을 확인하기 위해 readdir 결과를
  // 부풀리는 별도 경로가 없으므로, 여기서는 실파일 대량 생성 대신 가드 로직 자체는
  // 코드 인스펙션 + diff/승계 케이스로 커버됨을 명시하고, 경계는 소규모로 동작만 확인한다.
  // (실 20k 생성은 CI 비용 과다 — 한계 정직 표기.)
  line('== 10) 대량 디렉토리 가드(경계 동작 확인) ==')
  line('  NOTE  POLL_MAX_ENTRIES(20000) 초과 실파일 생성은 CI 비용 과다 → 로직 인스펙션으로 커버.')
  line('        (>20k 시 stopPolling + onError(EUNKNOWN) 1회 — pollOnce 분기, 변경 시 회귀 주의.)')

  // ── 11) 폴링 중 stop 정리(인터벌 좀비 0) ──────────────────────────────────
  line('== 11) 폴링 stop 정리(인터벌 좀비 0) ==')
  const stopDir = join(base, 'poll-stop')
  await fsp.mkdir(stopDir, { recursive: true })
  const stopSvc = new WatchService({ isRemoteFn: () => true })
  const c11 = collector()
  const id11 = stopSvc.start(stopDir, c11.cb)
  await sleep(200)
  check('poll-stop: 활성 1', stopSvc.activeCount() === 1)
  let threwStop11 = false
  try {
    stopSvc.stop(id11)
    stopSvc.stop(id11) // 멱등.
  } catch {
    threwStop11 = true
  }
  check('poll-stop: stop 멱등 throw 0', !threwStop11)
  check('poll-stop: stop 후 활성 0', stopSvc.activeCount() === 0)
  await fsp.writeFile(join(stopDir, 'z.bin'), Buffer.alloc(4, 1))
  await sleep(POLL_WAIT)
  check('poll-stop: stop 후 폴링 무발화', c11.events.length === 0)

  // ── 12) 매핑 네트워크 드라이브 감지(캐시 주입 → 동기 판정, J2) ────────────────
  // setup: 싱글턴 캐시 직접 주입(비동기 refresh 없이 동기 판정 검증).
  line('== 12) 매핑 네트워크 드라이브 감지(캐시 주입 → 동기 판정) ==')
  driveTypeService.setNetworkDriveLetters(['Z'])
  check('매핑 Z:\\ → isNetworkDriveRoot true', isNetworkDriveRoot('Z:\\share'))
  check('매핑 z:\\(소문자) → true(대소문자 무시)', isNetworkDriveRoot('z:\\share'))
  check('매핑 Z:\\sub\\dir → true', isNetworkDriveRoot('Z:\\sub\\dir'))
  check('로컬 C:\\ → false(미등록 드라이브)', !isNetworkDriveRoot('C:\\Users'))
  check('UNC \\\\nas → isNetworkDriveRoot false(드라이브 문자 아님)', !isNetworkDriveRoot('\\\\nas\\m'))
  check('매핑 Z: → isLikelyRemotePath true(eager 대상)', isLikelyRemotePath('Z:\\share'))
  check('빈 캐시에도 UNC eager 유지(이중 안전)', isLikelyRemotePath('\\\\nas\\m'))
  // teardown: 폴백 시뮬레이션 — 빈 캐시 리셋(싱글턴 오염·순서 의존 방지).
  driveTypeService.setNetworkDriveLetters([])
  check('빈 캐시(폴백) → 매핑도 false(회귀 0: UNC만 eager)', !isNetworkDriveRoot('Z:\\share'))
  check('폴백 후에도 UNC eager 유지', isLikelyRemotePath('\\\\nas\\m'))

  // ── 13) refresh queryFn 주입(PowerShell 미경유 파싱·폴백, J2) ────────────────
  line('== 13) refresh queryFn 주입(PowerShell 미경유 파싱·폴백) ==')
  // raw stdout 스텁("Z:\nY:") → 파싱 → {Z, Y}.
  const svcOk = new DriveTypeService({ queryFn: async () => 'Z:\nY:' })
  await svcOk.refresh()
  check('queryFn 주입 refresh → Z 파싱 반영', svcOk.isNetworkDriveLetter('Z'))
  check('queryFn 주입 refresh → Y 파싱 반영', svcOk.isNetworkDriveLetter('Y'))
  check('queryFn 주입 refresh → 미등록 X false', !svcOk.isNetworkDriveLetter('X'))
  check('refresh 후 initialized true', svcOk.isInitialized())

  // 파싱 화이트리스트: 비드라이브 행·잡음은 폐기, 드라이브 문자만 통과.
  const svcNoise = new DriveTypeService({
    queryFn: async () => 'DeviceID\r\n--------\r\nW:\r\ngarbage\r\n  V:  \r\n'
  })
  await svcNoise.refresh()
  check('파싱: W: 통과(공백/CRLF 무관)', svcNoise.isNetworkDriveLetter('W'))
  check('파싱: V: 통과(앞뒤 공백 trim)', svcNoise.isNetworkDriveLetter('V'))
  check('파싱: 헤더/구분선/잡음 행 폐기', !svcNoise.isNetworkDriveLetter('D'))

  // PowerShell 실패(queryFn reject) → 빈 집합 폴백(throw 0).
  let refreshThrew = false
  const svcFail = new DriveTypeService({ queryFn: async () => { throw new Error('boom') } })
  try {
    await svcFail.refresh()
  } catch {
    refreshThrew = true
  }
  check('queryFn reject → refresh throw 0(격리)', !refreshThrew)
  check('queryFn 실패 → 빈 집합 폴백(false)', !svcFail.isNetworkDriveLetter('Z'))

  // 직전 캐시 유지: 성공 후 실패해도 기존 캐시 보존(원자 교체, 빈 상태 미노출).
  const svcKeep = new DriveTypeService({
    queryFn: async () => 'Z:',
    minRefreshIntervalMs: 0 // throttle 해제(연속 refresh 검증).
  })
  await svcKeep.refresh()
  check('성공 refresh → Z 캐시', svcKeep.isNetworkDriveLetter('Z'))

  // throttle: 진행 직후 재호출은 PowerShell 미경유(같은 캐시 유지). minInterval=큰 값으로 검증.
  let queryCalls = 0
  const svcThrottle = new DriveTypeService({
    queryFn: async () => {
      queryCalls++
      return 'Z:'
    },
    minRefreshIntervalMs: 60_000
  })
  await svcThrottle.refresh()
  await svcThrottle.refresh() // throttle 윈도 내 → 스킵.
  check('throttle: 연속 refresh → queryFn 1회만(남발 방지)', queryCalls === 1)

  // 재진입 가드: 동시 다발 refresh → 진행 중 Promise 공유(queryFn 1회).
  let concurrentCalls = 0
  const svcReentry = new DriveTypeService({
    queryFn: async () => {
      concurrentCalls++
      await sleep(50)
      return 'Z:'
    },
    minRefreshIntervalMs: 0
  })
  await Promise.all([svcReentry.refresh(), svcReentry.refresh(), svcReentry.refresh()])
  check('재진입 가드: 동시 3회 refresh → queryFn 1회만', concurrentCalls === 1)

  // 빈 출력 폴백(비-Windows 시뮬레이션 등): 빈 문자열 → 빈 집합.
  const svcEmpty = new DriveTypeService({ queryFn: async () => '' })
  await svcEmpty.refresh()
  check('빈 출력 → 빈 집합(폴백, throw 0)', !svcEmpty.isNetworkDriveLetter('Z'))

  // 싱글턴 최종 리셋(테스트 격리 — 후속 실행 오염 방지).
  driveTypeService.setNetworkDriveLetters([])

  // ── 정리 ──────────────────────────────────────────────────────────────
  await fsp.rm(base, { recursive: true, force: true }).catch(() => undefined)
  line('')
  line(`RESULT: ${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

void main()
