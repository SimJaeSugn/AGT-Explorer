/**
 * K2 RecycleBinService 실증 스크립트(헤드리스, 일회성 검증).
 *
 * RecycleBinService 를 PowerShell COM 미경유 **주입 스텁**(listFn/restoreFn/emptyFn)으로
 * 구동하여(env·OS 비의존) 다음을 검증한다:
 *  1) list JSON 파싱 — id·name·originalPath·deletedAt·size 정규화, 단일 항목 배열화,
 *     결손·오타입 필드 방어, 파싱 실패 시 빈 목록 폴백(throw 0).
 *  2) id 화이트리스트 — 비-$Recycle.Bin id 항목은 list 에서 제외, restore 에서 제거,
 *     isRecycleBinPath 정규식 정확.
 *  3) restore — $R id env 주입 경로(서비스 필터), 빈/전량 비-휴지통 id → ok:false,
 *     스텁 실패(throw·ok:false) → ok:false(throw 0).
 *  4) empty — 스텁 성공/실패 전파(throw 0).
 *  5) 폴백 — listFn/restoreFn/emptyFn reject 시 throw 없이 안전 신호 반환.
 *
 * 실행: esbuild 번들 후 node (verify-scan.ts 패턴, electron external·@shared 별칭 해소).
 */
import {
  RecycleBinService,
  isRecycleBinPath,
  parseTrashList
} from '../src/main/os/recycleBin'

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

const BIN = 'C:\\$Recycle.Bin\\S-1-5-21-1\\'

async function main(): Promise<void> {
  // ── 1) list JSON 파싱 + 정규화 ────────────────────────────────────────
  line('== 1) list JSON 파싱 + 정규화 ==')
  const sampleJson = JSON.stringify([
    {
      id: `${BIN}$RABCDE.txt`,
      name: 'note.txt',
      originalPath: 'C:\\Users\\me\\Documents\\note.txt',
      deletedAt: 1700000000000,
      size: 1234
    },
    {
      id: `${BIN}$RFGHIJ`,
      name: 'photos',
      originalPath: 'C:\\Users\\me\\Pictures\\photos',
      deletedAt: 1700000001000,
      size: 0
    }
  ])
  const svc1 = new RecycleBinService({ listFn: () => Promise.resolve(sampleJson) })
  const items1 = await svc1.list()
  check('list 2건 파싱', items1.length === 2)
  check('id 보존', items1[0]?.id === `${BIN}$RABCDE.txt`)
  check('name 보존', items1[0]?.name === 'note.txt')
  check('originalPath 보존', items1[0]?.originalPath === 'C:\\Users\\me\\Documents\\note.txt')
  check('deletedAt 보존', items1[0]?.deletedAt === 1700000000000)
  check('size 보존', items1[0]?.size === 1234)
  check('폴더 size=0', items1[1]?.size === 0)

  // 단일 항목(객체) → 배열화.
  const single = JSON.stringify({
    id: `${BIN}$RSINGLE.dat`,
    name: 'one.dat',
    originalPath: 'D:\\x\\one.dat',
    deletedAt: 1,
    size: 5
  })
  const svc1b = new RecycleBinService({ listFn: () => Promise.resolve(single) })
  const items1b = await svc1b.list()
  check('단일 객체 → 배열화(1건)', items1b.length === 1 && items1b[0]?.name === 'one.dat')

  // 결손·오타입 필드 방어.
  const messy = JSON.stringify([
    { id: `${BIN}$RM1`, name: 'a', originalPath: '', deletedAt: 'bad', size: -10 },
    { id: `${BIN}$RM2` /* name 없음 */, originalPath: 'P', deletedAt: 0, size: '99' }
  ])
  const svc1c = new RecycleBinService({ listFn: () => Promise.resolve(messy) })
  const items1c = await svc1c.list()
  check('잘못된 deletedAt → 0', items1c[0]?.deletedAt === 0)
  check('음수 size → 0', items1c[0]?.size === 0)
  check('name 결손 → 빈 문자열', items1c[1]?.name === '')
  check('문자열 size → 숫자 변환(99)', items1c[1]?.size === 99)

  // 파싱 실패 → 빈 목록(throw 0).
  const svc1d = new RecycleBinService({ listFn: () => Promise.resolve('not json{{') })
  check('파싱 실패 → 빈 목록', (await svc1d.list()).length === 0)
  const svc1e = new RecycleBinService({ listFn: () => Promise.resolve('') })
  check('빈 출력 → 빈 목록', (await svc1e.list()).length === 0)
  // listFn reject → 빈 목록(throw 0).
  const svc1f = new RecycleBinService({ listFn: () => Promise.reject(new Error('boom')) })
  let listThrew = false
  try {
    const r = await svc1f.list()
    check('listFn reject → 빈 목록(throw 0)', r.length === 0)
  } catch {
    listThrew = true
  }
  check('list throw 0', !listThrew)

  // ── 2) id 화이트리스트($Recycle.Bin) ──────────────────────────────────
  line('== 2) id 화이트리스트($Recycle.Bin) ==')
  check('정상 휴지통 경로 통과', isRecycleBinPath(`${BIN}$RABC`))
  check('대소문자 무시 통과', isRecycleBinPath('c:\\$recycle.bin\\sid\\$RX'))
  check('임의 경로 거부(system32)', !isRecycleBinPath('C:\\Windows\\System32\\evil.exe'))
  check('빈 문자열 거부', !isRecycleBinPath(''))
  check('구버전 RECYCLER 거부', !isRecycleBinPath('C:\\RECYCLER\\x'))

  // list 가 비-휴지통 id 항목을 제외하는지.
  const mixed = JSON.stringify([
    { id: `${BIN}$ROK`, name: 'ok', originalPath: '', deletedAt: 0, size: 1 },
    { id: 'C:\\Windows\\System32\\evil.exe', name: 'evil', originalPath: '', deletedAt: 0, size: 1 }
  ])
  const svc2 = new RecycleBinService({ listFn: () => Promise.resolve(mixed) })
  const items2 = await svc2.list()
  check('list 가 비-휴지통 id 제외(1건)', items2.length === 1 && items2[0]?.name === 'ok')
  // parseTrashList 직접 동등.
  check('parseTrashList 직접 호출 동등', parseTrashList(mixed).length === 1)

  // ── 3) restore — env 주입 경로 + 필터 + 폴백 ───────────────────────────
  line('== 3) restore(env 주입·필터·throw 0) ==')
  let restoredIds: string[] | null = null
  const svc3 = new RecycleBinService({
    restoreFn: (ids) => {
      restoredIds = ids
      return Promise.resolve({ ok: true })
    }
  })
  const r3a = await svc3.restore([`${BIN}$R1`, `${BIN}$R2`])
  check('정상 restore → ok', r3a.ok === true)
  check('restoreFn 이 휴지통 id 만 수신', restoredIds !== null && (restoredIds as string[]).length === 2)

  // 비-휴지통 id 는 서비스가 필터링(이중 방어).
  restoredIds = null
  const r3b = await svc3.restore([`${BIN}$ROK`, 'C:\\evil.exe'])
  check('restore 가 비-휴지통 id 제거', restoredIds !== null && (restoredIds as string[]).length === 1)
  check('restore 필터 후 ok', r3b.ok === true)

  // 전량 비-휴지통 / 빈 배열 → ok:false(restoreFn 미호출).
  let calledCount = 0
  const svc3c = new RecycleBinService({
    restoreFn: (ids) => {
      calledCount++
      return Promise.resolve({ ok: true, message: `${ids.length}` })
    }
  })
  const r3c = await svc3c.restore(['C:\\a.exe', 'D:\\b.exe'])
  check('전량 비-휴지통 id → ok:false', r3c.ok === false)
  const r3d = await svc3c.restore([])
  check('빈 배열 → ok:false', r3d.ok === false)
  check('복원 불가 시 restoreFn 미호출', calledCount === 0)

  // restoreFn 실패(ok:false)/reject → ok:false(throw 0).
  const svc3e = new RecycleBinService({
    restoreFn: () => Promise.resolve({ ok: false, message: '부분 실패' })
  })
  check('restoreFn ok:false 전파', (await svc3e.restore([`${BIN}$R1`])).ok === false)
  const svc3f = new RecycleBinService({ restoreFn: () => Promise.reject(new Error('x')) })
  let restoreThrew = false
  try {
    const r = await svc3f.restore([`${BIN}$R1`])
    check('restoreFn reject → ok:false(throw 0)', r.ok === false)
  } catch {
    restoreThrew = true
  }
  check('restore throw 0', !restoreThrew)

  // ── 4) empty — 성공/실패 전파(throw 0) ────────────────────────────────
  line('== 4) empty(성공/실패·throw 0) ==')
  const svc4a = new RecycleBinService({ emptyFn: () => Promise.resolve({ ok: true }) })
  check('empty 성공 전파', (await svc4a.empty()).ok === true)
  const svc4b = new RecycleBinService({
    emptyFn: () => Promise.resolve({ ok: false, message: 'denied' })
  })
  check('empty 실패 전파', (await svc4b.empty()).ok === false)
  const svc4c = new RecycleBinService({ emptyFn: () => Promise.reject(new Error('z')) })
  let emptyThrew = false
  try {
    const r = await svc4c.empty()
    check('emptyFn reject → ok:false(throw 0)', r.ok === false)
  } catch {
    emptyThrew = true
  }
  check('empty throw 0', !emptyThrew)

  line('')
  line(`RESULT: ${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

void main()
