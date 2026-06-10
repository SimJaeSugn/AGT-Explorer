/**
 * SSD 기반 동시성 결정 + 디스크 종류 라인 파서 실증 스크립트(헤드리스·일회성 검증).
 *
 * 검증 대상(순수·Electron/GUI 비의존):
 *   1) pickOpConcurrency(concurrency.ts) — delete/copy/move 동시성 매트릭스.
 *        - delete: 모든 소스 SSD → 8, 하나라도 비-SSD/미상 → 4.
 *        - copy/move: cross-volume → 4, same-volume → 대상 SSD ? 4 : 1, 미상 → 1.
 *   2) parseDiskTypeLines(diskType.ts) — PowerShell stdout 라인 파싱·미디어 분류.
 *        - SSD/HDD/Unspecified/숫자(4/3)/잡음(garbage) 분류·화이트리스트 폐기.
 *   3) DiskTypeService — setDiskTypes 주입·queryFn 스텁 refresh·실패 폴백(throw 0).
 *
 * 실행: esbuild 번들 후 node(verify-fs.ts 패턴, @shared 별칭 해소).
 */
import { pickOpConcurrency, driveLetterOf } from '../src/main/operations/concurrency'
import {
  parseDiskTypeLines,
  classifyMediaForTest as classifyForTest,
  DiskTypeService
} from '../src/main/os/diskType'

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

/** SSD 집합으로부터 isSsd 판정 함수 생성(주입). 문자 대문자 정규화. */
function ssdFrom(letters: string[]): (l: string) => boolean {
  const set = new Set(letters.map((l) => l.charAt(0).toUpperCase()))
  return (l) => set.has(l.charAt(0).toUpperCase())
}

async function main(): Promise<void> {
  // ── 0) driveLetterOf ─────────────────────────────────────────────
  line('== 0) driveLetterOf ==')
  check("driveLetterOf('C:\\\\a') == 'C'", driveLetterOf('C:\\a') === 'C')
  check("driveLetterOf('d:\\\\x') == 'D'(대문자)", driveLetterOf('d:\\x') === 'D')
  check("driveLetterOf(UNC) == ''", driveLetterOf('\\\\server\\share') === '')
  check("driveLetterOf(상대) == ''", driveLetterOf('foo\\bar') === '')
  check("driveLetterOf('') == ''", driveLetterOf('') === '')

  // ── 1) delete 동시성 ─────────────────────────────────────────────
  line('== 1) pickOpConcurrency: delete ==')
  // 모든 소스 SSD → 8.
  check(
    'delete 모든 소스 SSD → 8',
    pickOpConcurrency('delete', ['C:\\a', 'C:\\b'], undefined, ssdFrom(['C'])) === 8
  )
  check(
    'delete 멀티볼륨 전부 SSD → 8',
    pickOpConcurrency('delete', ['C:\\a', 'F:\\b'], undefined, ssdFrom(['C', 'F'])) === 8
  )
  // 비-SSD 포함 → 4.
  check(
    'delete 모든 소스 HDD → 4',
    pickOpConcurrency('delete', ['E:\\a', 'E:\\b'], undefined, ssdFrom([])) === 4
  )
  check(
    'delete SSD+HDD 혼합 → 4',
    pickOpConcurrency('delete', ['C:\\a', 'E:\\b'], undefined, ssdFrom(['C'])) === 4
  )
  // 미상(드라이브 문자 없음) → 보수적 4(SSD 단정 불가).
  check(
    'delete 소스 문자 해석 불가(UNC) → 4',
    pickOpConcurrency('delete', ['\\\\srv\\s\\a'], undefined, ssdFrom(['C'])) === 4
  )
  check(
    'delete 소스 일부만 SSD 문자 + UNC 혼합 → 4',
    pickOpConcurrency('delete', ['C:\\a', '\\\\srv\\s'], undefined, ssdFrom(['C'])) === 4
  )
  check('delete 빈 소스 → 4(보수적)', pickOpConcurrency('delete', [], undefined, ssdFrom(['C'])) === 4)

  // ── 2) copy 동시성 ───────────────────────────────────────────────
  line('== 2) pickOpConcurrency: copy ==')
  // cross-volume → 4(대상 SSD 여부 무관).
  check(
    'copy cross-volume(SSD 대상) → 4',
    pickOpConcurrency('copy', ['E:\\a'], 'C:\\dst', ssdFrom(['C'])) === 4
  )
  check(
    'copy cross-volume(HDD 대상) → 4',
    pickOpConcurrency('copy', ['C:\\a'], 'E:\\dst', ssdFrom(['C'])) === 4
  )
  // same-volume + 대상 SSD → 4.
  check(
    'copy same-volume 대상 SSD → 4',
    pickOpConcurrency('copy', ['C:\\a', 'C:\\b'], 'C:\\dst', ssdFrom(['C'])) === 4
  )
  // same-volume + 대상 HDD → 1(기존 보수적 유지·무회귀).
  check(
    'copy same-volume 대상 HDD → 1',
    pickOpConcurrency('copy', ['E:\\a'], 'E:\\dst', ssdFrom([])) === 1
  )
  // same-volume + 대상 unknown → 1(보수적).
  check(
    'copy same-volume 대상 unknown → 1',
    pickOpConcurrency('copy', ['D:\\a'], 'D:\\dst', ssdFrom([])) === 1
  )
  // 대상 문자 해석 불가 → 1.
  check(
    'copy 대상 문자 해석 불가(UNC) → 1',
    pickOpConcurrency('copy', ['C:\\a'], '\\\\srv\\s', ssdFrom(['C'])) === 1
  )
  // 대상 없음 → 1.
  check('copy 대상 미지정 → 1', pickOpConcurrency('copy', ['C:\\a'], undefined, ssdFrom(['C'])) === 1)

  // ── 3) move 동시성(copy 와 동일 규칙) ───────────────────────────
  line('== 3) pickOpConcurrency: move (== copy 규칙) ==')
  check(
    'move cross-volume → 4',
    pickOpConcurrency('move', ['E:\\a'], 'C:\\dst', ssdFrom(['C'])) === 4
  )
  check(
    'move same-volume 대상 SSD → 4',
    pickOpConcurrency('move', ['C:\\a'], 'C:\\dst', ssdFrom(['C'])) === 4
  )
  check(
    'move same-volume 대상 HDD → 1',
    pickOpConcurrency('move', ['E:\\a'], 'E:\\dst', ssdFrom([])) === 1
  )
  check(
    'move same-volume 대상 unknown → 1',
    pickOpConcurrency('move', ['D:\\a'], 'D:\\dst', ssdFrom([])) === 1
  )

  // ── 4) 무회귀: 비-SSD/미상 경로는 기존 숫자와 동일 ──────────────
  line('== 4) 무회귀: 비-SSD 경로 기존 숫자 보존 ==')
  const noSsd = ssdFrom([])
  check('delete 비-SSD → 4(기존)', pickOpConcurrency('delete', ['E:\\a'], undefined, noSsd) === 4)
  check('copy same HDD → 1(기존)', pickOpConcurrency('copy', ['E:\\a'], 'E:\\d', noSsd) === 1)
  check('copy cross → 4(기존)', pickOpConcurrency('copy', ['E:\\a'], 'F:\\d', noSsd) === 4)
  check('move same HDD → 1(기존)', pickOpConcurrency('move', ['E:\\a'], 'E:\\d', noSsd) === 1)

  // ── 5) classifyMedia(테스트 노출) ────────────────────────────────
  line('== 5) classifyMedia ==')
  check("'SSD' → ssd", classifyForTest('SSD') === 'ssd')
  check("'ssd'(소문자) → ssd", classifyForTest('ssd') === 'ssd')
  check("'HDD' → hdd", classifyForTest('HDD') === 'hdd')
  check("'Unspecified' → unknown", classifyForTest('Unspecified') === 'unknown')
  check("'4'(숫자 SSD) → ssd", classifyForTest('4') === 'ssd')
  check("'3'(숫자 HDD) → hdd", classifyForTest('3') === 'hdd')
  check("'' → unknown", classifyForTest('') === 'unknown')
  check("'garbage' → unknown", classifyForTest('garbage') === 'unknown')

  // ── 6) parseDiskTypeLines ────────────────────────────────────────
  line('== 6) parseDiskTypeLines ==')
  // 이 머신의 실제 출력 형태(검증됨): C:SSD / F:SSD / E:HDD / D:Unspecified
  const real = 'E:HDD\r\nF:SSD\r\nD:Unspecified\r\nC:SSD\r\n'
  const parsed = parseDiskTypeLines(real)
  const map = new Map(parsed.map((p) => [p.letter, p.media]))
  check('parse 4행 통과', parsed.length === 4)
  check("C → ssd", map.get('C') === 'ssd')
  check("F → ssd", map.get('F') === 'ssd')
  check("E → hdd", map.get('E') === 'hdd')
  check("D → unknown(Unspecified)", map.get('D') === 'unknown')
  // 숫자 MediaType 머신 형태.
  const numeric = parseDiskTypeLines('C:4\r\nE:3\r\n')
  const nmap = new Map(numeric.map((p) => [p.letter, p.media]))
  check("숫자 C:4 → ssd", nmap.get('C') === 'ssd')
  check("숫자 E:3 → hdd", nmap.get('E') === 'hdd')
  // 잡음·헤더·빈 줄·소문자 문자 폐기(화이트리스트).
  const noisy = parseDiskTypeLines(
    'DriveLetter:Media\r\n\r\n  \r\nGet-PhysicalDisk\r\nz:SSD\r\nG:SSD\r\n별표줄 :::\r\n'
  )
  const noisyLetters = noisy.map((p) => p.letter)
  check('잡음/헤더 폐기 후 G 만(소문자 z 도 통과해 Z 됨 확인)', noisyLetters.includes('G'))
  // 소문자 z 는 `^([A-Z])` 화이트리스트 미통과 → 폐기.
  check('소문자 z: 라인 폐기(화이트리스트)', !noisyLetters.includes('Z'))
  check("'DriveLetter:Media' 헤더 폐기", !noisyLetters.includes('D'))
  check('빈 문자열 → []', parseDiskTypeLines('').length === 0)
  check('비문자열 방어 → []', parseDiskTypeLines(undefined as unknown as string).length === 0)

  // ── 7) DiskTypeService 동기 판정·주입 ────────────────────────────
  line('== 7) DiskTypeService 주입·동기 판정 ==')
  const svc = new DiskTypeService()
  check('초기 미초기화', svc.isInitialized() === false)
  check("미초기화 isSsd('C') → false(보수적)", svc.isSsd('C') === false)
  svc.setDiskTypes([
    ['C', 'ssd'],
    ['E', 'hdd'],
    ['D', 'unknown']
  ])
  check('주입 후 초기화', svc.isInitialized() === true)
  check("isSsd('C') → true", svc.isSsd('C') === true)
  check("isSsd('C:') → true(콜론 허용)", svc.isSsd('C:') === true)
  check("isSsd('c')(소문자) → true", svc.isSsd('c') === true)
  check("isSsd('E')(hdd) → false", svc.isSsd('E') === false)
  check("isSsd('D')(unknown) → false", svc.isSsd('D') === false)
  check("isSsd('Z')(미등록) → false", svc.isSsd('Z') === false)
  check("mediaTypeOf('E') === 'hdd'", svc.mediaTypeOf('E') === 'hdd')
  check("mediaTypeOf('Z') === 'unknown'", svc.mediaTypeOf('Z') === 'unknown')

  // ── 8) refresh: queryFn 스텁 + 실패 폴백(throw 0) ────────────────
  line('== 8) DiskTypeService refresh 스텁·폴백 ==')
  const svc2 = new DiskTypeService({ queryFn: () => Promise.resolve('C:SSD\r\nE:HDD\r\n') })
  await svc2.refresh()
  check('스텁 refresh 후 isSsd(C) true', svc2.isSsd('C') === true)
  check('스텁 refresh 후 isSsd(E) false', svc2.isSsd('E') === false)
  // 실패(reject) → 직전 캐시 유지·throw 0.
  let threw = false
  const svc3 = new DiskTypeService({ queryFn: () => Promise.reject(new Error('boom')) })
  try {
    await svc3.refresh()
  } catch {
    threw = true
  }
  check('refresh reject 시 throw 0', threw === false)
  check('실패 refresh 후 미초기화 유지(빈)', svc3.isSsd('C') === false)
  // 빈 출력은 직전 캐시 유지(첫 호출은 빈).
  const svc4 = new DiskTypeService({ queryFn: () => Promise.resolve('') })
  await svc4.refresh()
  check('빈 출력 refresh → isSsd false(폴백)', svc4.isSsd('C') === false)

  // ── 결과 ─────────────────────────────────────────────────────────
  line('')
  line(`결과: PASS=${pass} FAIL=${fail}`)
  if (fail > 0) process.exit(1)
}

void main()
