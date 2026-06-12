/**
 * §Y1 셸 컨텍스트 verb — 헤드리스 verify (일회성·순수·페이크 트랜스포트).
 *
 * 실제 PowerShell/COM 실행·실 GUI(우클릭 섹션·DoIt 외부 프로그램 실행)는 헤드리스로
 * 검증 불가하므로:
 *   - 블랙리스트 정규화·필터(영/한), verbId 합성/파싱 → 순수 함수(shellVerbsBlacklist).
 *   - ShellVerbsService → 페이크 트랜스포트 주입(PowerShell 미경유)으로 라인 프로토콜·
 *     FIFO 직렬·타임아웃·늦은 id 폐기·stale-cancel·crash 재기동·쿨다운·invoke 코드 매핑.
 *
 * 실행: esbuild cjs 번들(external:electron) 후 node(verify:shell-h4h6 패턴).
 *
 * NOTE(frontend-dev T4): 렌더러 병합 분기(단일+로컬+ready → "Windows 메뉴" 항목 N개 /
 *   다중 → 0 / 원격·archive → 0 / loading → 행 1개 / empty → 0 / B6 기존 항목 수 불변)
 *   케이스는 contextMenu.ts·uiSlice 구현 후 **여기 또는 verify:store 에 추가**한다.
 *   이 스크립트가 §Y verify 의 단일 출처다(병합 분기도 이 한곳으로 못박음 — reviewer 권고 A).
 */
import {
  BLACKLIST,
  filterVerbs,
  isBlacklisted,
  makeVerbId,
  normalizeVerbName,
  parseVerbId,
  type RawShellVerb
} from '../src/main/os/shellVerbsBlacklist'
import {
  ShellVerbsService,
  type ShellVerbsTransport
} from '../src/main/os/shellVerbs'
// 렌더러 T4 병합 분기·TTL 캐시·경합 가드(순수·store/infra 무의존 — verify 단일 출처).
import {
  WIN_VERBS_TTL_MS,
  buildWinVerbsSection,
  isCacheFresh,
  isResponseStillRelevant,
  type WinVerbsState
} from '@renderer/app/usecases/shellVerbsSection'
import type { ShellVerbDTO } from '@shared/dto'

let pass = 0
let fail = 0
function check(name: string, cond: boolean): void {
  if (cond) {
    pass++
    // eslint-disable-next-line no-console
    console.log(`  PASS  ${name}`)
  } else {
    fail++
    // eslint-disable-next-line no-console
    console.log(`  FAIL  ${name}`)
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// ──────────────────────────────────────────────────────────────────────────
// 페이크 트랜스포트 — 송신된 요청을 기록하고, 테스트가 응답 라인/종료를 수동 주입.
// ──────────────────────────────────────────────────────────────────────────
interface FakeTransport extends ShellVerbsTransport {
  readonly sent: string[]
  emitLine(line: string): void
  emitExit(): void
  killed: boolean
}

function makeFake(): FakeTransport {
  let lineCb: ((line: string) => void) | null = null
  let exitCb: (() => void) | null = null
  const sent: string[] = []
  return {
    sent,
    killed: false,
    send(line: string): void {
      sent.push(line)
    },
    onLine(cb): void {
      lineCb = cb
    },
    onExit(cb): void {
      exitCb = cb
    },
    kill(): void {
      this.killed = true
    },
    emitLine(line: string): void {
      lineCb?.(line)
    },
    emitExit(): void {
      exitCb?.()
    }
  }
}

/** 송신된 마지막 요청의 파싱(JSON). */
function lastReq(t: FakeTransport): { id: string; op: string; path?: string; verbId?: string } {
  const raw = t.sent[t.sent.length - 1]!
  return JSON.parse(raw)
}

async function main(): Promise<void> {
  // ════ 블랙리스트 정규화 ════════════════════════════════════════════════
  check('[norm] &Open → open', normalizeVerbName('&Open') === 'open')
  check('[norm] 삭제(&D) → 삭제', normalizeVerbName('삭제(&D)') === '삭제')
  check('[norm] 복사   (trailing) → 복사', normalizeVerbName('복사   ') === '복사')
  check('[norm] Create &shortcut → create shortcut', normalizeVerbName('Create &shortcut') === 'create shortcut')
  check('[norm] Properties (&R) → properties', normalizeVerbName('Properties (&R)') === 'properties')
  check('[norm] 연속 공백 1칸', normalizeVerbName('이름  바꾸기') === '이름 바꾸기')
  check('[norm] 비문자열 → 빈문자열', normalizeVerbName(undefined as unknown as string) === '')

  // ════ 블랙리스트 매칭(영/한) ═══════════════════════════════════════════
  check('[bl] &열기 차단', isBlacklisted('&열기'))
  check('[bl] Cut 차단', isBlacklisted('Cut'))
  check('[bl] 붙여넣기 차단', isBlacklisted('붙여넣기'))
  check('[bl] 삭제(&D) 차단', isBlacklisted('삭제(&D)'))
  check('[bl] 속성 차단', isBlacklisted('속성'))
  check('[bl] 바로 가기 만들기 차단', isBlacklisted('바로 가기 만들기'))
  check('[bl] copy as path 미차단(노출)', !isBlacklisted('Copy as path'))
  check('[bl] 경로로 복사 미차단(노출)', !isBlacklisted('경로로 복사'))
  check('[bl] 반디집으로 압축하기 미차단', !isBlacklisted('반디집으로 압축하기(&L)'))
  check('[bl] Cursor로 열기 미차단', !isBlacklisted('Cursor로 열기'))
  check('[bl] 사전 크기 합리', BLACKLIST.size >= 16)

  // ════ verbId 합성/파싱 ════════════════════════════════════════════════
  check('[id] make 5/압축 → 5:반디집으로 압축하기', makeVerbId(5, '반디집으로 압축하기') === '5:반디집으로 압축하기')
  const p1 = parseVerbId('5:반디집으로 압축하기')
  check('[id] parse 왕복', p1 !== null && p1.index === 5 && p1.display === '반디집으로 압축하기')
  const p2 = parseVerbId('3:A:B:C')
  check('[id] parse 콜론 포함 display(첫 콜론만)', p2 !== null && p2.index === 3 && p2.display === 'A:B:C')
  check('[id] parse 콜론 없음 → null', parseVerbId('abc') === null)
  check('[id] parse 비정수 index → null', parseVerbId('x:open') === null)
  check('[id] parse 음수 index → null', parseVerbId('-1:open') === null)
  check('[id] parse 0:빈display 허용', (() => { const r = parseVerbId('0:'); return r !== null && r.index === 0 && r.display === '' })())
  check('[id] 왕복 make→parse', (() => { const r = parseVerbId(makeVerbId(12, 'Cursor로 열기')); return r !== null && r.index === 12 && r.display === 'Cursor로 열기' })())

  // ════ filterVerbs(블랙리스트 + verbId 합성) ═════════════════════════════
  const raw: RawShellVerb[] = [
    { index: 0, name: '&Open', display: 'Open' },
    { index: 1, name: '잘라내기(&T)', display: '잘라내기(&T)' },
    { index: 2, name: '반디집으로 압축하기(&L)', display: '반디집으로 압축하기(L)' },
    { index: 3, name: '속성(&R)', display: '속성(R)' },
    { index: 4, name: 'Cursor로 열기', display: 'Cursor로 열기' },
    { index: 5, name: '', display: '' } // 빈 표시명 → 제외
  ]
  const filtered = filterVerbs(raw)
  check('[filter] 블랙리스트+빈것 제외 → 2개(압축·Cursor)', filtered.length === 2)
  check('[filter] verbId 합성(index:display)', filtered[0]!.verbId === '2:반디집으로 압축하기(L)')
  check('[filter] display 보존', filtered[1]!.display === 'Cursor로 열기')

  // ════ 서비스: 정상 list 라인 프로토콜 + 블랙리스트 필터 ═════════════════
  {
    const t = makeFake()
    const svc = new ShellVerbsService({ transportFactory: () => t, requestTimeoutMs: 500 })
    const promise = svc.listVerbs('C:\\tmp\\x.txt')
    await sleep(0)
    check('[svc] list 송신됨', t.sent.length === 1 && lastReq(t).op === 'list')
    const id = lastReq(t).id
    t.emitLine(JSON.stringify({ id, ok: true, verbs: raw }))
    const res = await promise
    check('[svc] list ok', res.ok)
    check('[svc] list 블랙리스트 필터 후 2개', res.ok && res.value.verbs.length === 2)
    svc.dispose()
    check('[svc] dispose → kill', t.killed)
  }

  // ════ 서비스: 늦은 id 폐기(타임아웃 후) ═════════════════════════════════
  {
    const t = makeFake()
    const svc = new ShellVerbsService({ transportFactory: () => t, requestTimeoutMs: 50 })
    const promise = svc.listVerbs('C:\\a')
    await sleep(0)
    const id = lastReq(t).id
    await sleep(80) // 타임아웃 경과 → 요청 reject(빈목록 수렴)
    const res = await promise
    check('[svc] 타임아웃 → ok(빈목록 수렴)', res.ok && res.value.verbs.length === 0)
    // 늦은 응답(이미 사라진 id) 주입 → drop(throw 0·무영향)
    let threw = false
    try {
      t.emitLine(JSON.stringify({ id, ok: true, verbs: raw }))
    } catch {
      threw = true
    }
    check('[svc] 늦은 id 응답 drop(throw 0)', !threw)
    svc.dispose()
  }

  // ════ 서비스: stale-cancel(새 list 가 이전 list 폐기) ═══════════════════
  {
    const t = makeFake()
    const svc = new ShellVerbsService({ transportFactory: () => t, requestTimeoutMs: 500 })
    const p1c = svc.listVerbs('C:\\first')
    await sleep(0)
    const firstId = lastReq(t).id
    // 첫 응답 오기 전 새 경로 list → 이전 in-flight list 는 빈목록으로 폐기.
    const p2c = svc.listVerbs('C:\\second')
    const r1 = await p1c
    check('[svc] stale-cancel → 이전 list 빈목록', r1.ok && r1.value.verbs.length === 0)
    await sleep(0)
    const secondId = lastReq(t).id
    check('[svc] 새 list 재송신(다른 id)', secondId !== firstId)
    t.emitLine(JSON.stringify({ id: secondId, ok: true, verbs: [{ index: 0, name: 'Cursor로 열기', display: 'Cursor로 열기' }] }))
    const r2 = await p2c
    check('[svc] 새 list 정상 응답', r2.ok && r2.value.verbs.length === 1)
    svc.dispose()
  }

  // ════ 서비스: FIFO 직렬(invoke 2건 순차) ════════════════════════════════
  {
    const t = makeFake()
    const svc = new ShellVerbsService({ transportFactory: () => t, requestTimeoutMs: 500 })
    const a = svc.invokeVerb('C:\\a', '0:Open')
    const b = svc.invokeVerb('C:\\b', '1:Cut')
    await sleep(0)
    check('[svc] FIFO: 첫 요청만 송신(직렬)', t.sent.length === 1)
    const idA = lastReq(t).id
    t.emitLine(JSON.stringify({ id: idA, ok: true }))
    await a
    await sleep(0)
    check('[svc] FIFO: 첫 응답 후 둘째 송신', t.sent.length === 2)
    const idB = lastReq(t).id
    t.emitLine(JSON.stringify({ id: idB, ok: true }))
    const rb = await b
    check('[svc] 둘째 invoke ok', rb.ok)
    svc.dispose()
  }

  // ════ 서비스: invoke 코드 매핑(ok/EVERB/ENOENT/EUNKNOWN) ════════════════
  {
    const mk = (): { svc: ShellVerbsService; t: FakeTransport } => {
      const t = makeFake()
      const svc = new ShellVerbsService({ transportFactory: () => t, requestTimeoutMs: 500 })
      return { svc, t }
    }
    // ok
    let { svc, t } = mk()
    let pr = svc.invokeVerb('C:\\a', '0:Open')
    await sleep(0)
    t.emitLine(JSON.stringify({ id: lastReq(t).id, ok: true }))
    check('[svc] invoke ok → Result.ok', (await pr).ok)
    svc.dispose()
    // EVERB
    ;({ svc, t } = mk())
    pr = svc.invokeVerb('C:\\a', '9:Stale')
    await sleep(0)
    t.emitLine(JSON.stringify({ id: lastReq(t).id, ok: false, code: 'EVERB' }))
    let r = await pr
    check('[svc] invoke EVERB → err(EVERB)', !r.ok && r.error.code === 'EVERB')
    svc.dispose()
    // ENOENT
    ;({ svc, t } = mk())
    pr = svc.invokeVerb('C:\\a', '0:Open')
    await sleep(0)
    t.emitLine(JSON.stringify({ id: lastReq(t).id, ok: false, code: 'ENOENT' }))
    r = await pr
    check('[svc] invoke ENOENT → err(ENOENT)', !r.ok && r.error.code === 'ENOENT')
    svc.dispose()
    // EUNKNOWN(미지 code)
    ;({ svc, t } = mk())
    pr = svc.invokeVerb('C:\\a', '0:Open')
    await sleep(0)
    t.emitLine(JSON.stringify({ id: lastReq(t).id, ok: false, code: 'WEIRD' }))
    r = await pr
    check('[svc] invoke 미지 code → err(EUNKNOWN)', !r.ok && r.error.code === 'EUNKNOWN')
    svc.dispose()
  }

  // ════ 서비스: crash(exit) → in-flight reject + 다음 요청 재기동 ══════════
  {
    let spawnCount = 0
    let cur: FakeTransport = makeFake()
    const svc = new ShellVerbsService({
      transportFactory: () => {
        spawnCount++
        cur = makeFake()
        return cur
      },
      requestTimeoutMs: 500
    })
    const p1c = svc.listVerbs('C:\\a')
    await sleep(0)
    check('[svc] crash: 1회 기동', spawnCount === 1)
    cur.emitExit() // 워커 crash
    const r1 = await p1c
    check('[svc] crash: in-flight 빈목록 수렴', r1.ok && r1.value.verbs.length === 0)
    // 다음 요청 → 재기동(2회)
    const p2c = svc.listVerbs('C:\\b')
    await sleep(0)
    check('[svc] crash: 다음 요청 재기동(2회)', spawnCount === 2)
    cur.emitLine(JSON.stringify({ id: lastReq(cur).id, ok: true, verbs: [] }))
    const r2 = await p2c
    check('[svc] 재기동 후 정상 응답', r2.ok)
    svc.dispose()
  }

  // ════ 서비스: 연속 spawn 실패 쿨다운(N=2) ═══════════════════════════════
  {
    let attempts = 0
    const svc = new ShellVerbsService({
      transportFactory: () => {
        attempts++
        throw new Error('spawn 실패(테스트)')
      },
      requestTimeoutMs: 200,
      maxConsecutiveSpawnFailures: 2
    })
    const r1 = await svc.listVerbs('C:\\a')
    check('[svc] 쿨다운: 1차 실패 → 빈목록', r1.ok && r1.value.verbs.length === 0)
    const r2 = await svc.listVerbs('C:\\b')
    check('[svc] 쿨다운: 2차 실패 → 빈목록', r2.ok && r2.value.verbs.length === 0)
    check('[svc] 쿨다운: 2회 기동 시도', attempts === 2)
    const r3 = await svc.listVerbs('C:\\c')
    check('[svc] 쿨다운 진입 → 더 이상 기동 시도 안 함', attempts === 2 && r3.ok && r3.value.verbs.length === 0)
    const ri = await svc.invokeVerb('C:\\c', '0:Open')
    check('[svc] 쿨다운 중 invoke → err', !ri.ok)
    svc.dispose()
  }

  // ════ 렌더러 T4: TTL 캐시 신선도(isCacheFresh) ═════════════════════════
  {
    const now = 1_000_000
    check('[ttl] entry 없음 → 미신선', !isCacheFresh(undefined, now))
    check('[ttl] TTL 미만 → 신선', isCacheFresh({ items: [], at: now - 100 }, now))
    check('[ttl] TTL 경계(=TTL) → 미신선', !isCacheFresh({ items: [], at: now - WIN_VERBS_TTL_MS }, now))
    check('[ttl] TTL 초과 → 미신선', !isCacheFresh({ items: [], at: now - WIN_VERBS_TTL_MS - 1 }, now))
  }

  // ════ 렌더러 T4: 경합 가드(isResponseStillRelevant) ════════════════════
  {
    check('[race] 같은 경로 → 반영', isResponseStillRelevant('C:\\a\\f.txt', 'C:\\a\\f.txt'))
    check('[race] 다른 경로 → 무시', !isResponseStillRelevant('C:\\a\\other.txt', 'C:\\a\\f.txt'))
    check('[race] 메뉴 닫힘(null) → 무시', !isResponseStillRelevant(null, 'C:\\a\\f.txt'))
    check('[race] 메뉴 닫힘(undefined) → 무시', !isResponseStillRelevant(undefined, 'C:\\a\\f.txt'))
  }

  // ════ 렌더러 T4: "Windows 메뉴" 병합 분기(buildWinVerbsSection) ═════════
  {
    const verbs: ShellVerbDTO[] = [
      { verbId: '2:반디집으로 압축하기', display: '반디집으로 압축하기' },
      { verbId: '4:Cursor로 열기', display: 'Cursor로 열기' }
    ]
    let invoked = ''
    const onInvoke = (v: string): void => {
      invoked = v
    }

    // undefined(미조회·다중/원격에서 winVerbs 미세팅 동치) → 섹션 비노출.
    check('[merge] undefined → 0개(비노출)', buildWinVerbsSection(undefined, onInvoke).length === 0)

    // empty → 섹션 비노출(빈목록·실패·타임아웃·거부 포괄).
    const emptyState: WinVerbsState = { status: 'empty', items: [] }
    check('[merge] empty → 0개(비노출)', buildWinVerbsSection(emptyState, onInvoke).length === 0)

    // loading → separator + 로딩 행 1개(비활성·run 없음).
    const loadingState: WinVerbsState = { status: 'loading', items: [] }
    const ld = buildWinVerbsSection(loadingState, onInvoke)
    check('[merge] loading → separator + 로딩 행(2)', ld.length === 2)
    check('[merge] loading[0] separator', ld[0]!.separator === true)
    check('[merge] loading 행 disabled·run 없음', ld[1]!.disabled === true && ld[1]!.run === undefined)
    check('[merge] loading 행 라벨', ld[1]!.label === 'Windows 메뉴 불러오는 중…')

    // ready(N>0) → separator + verb 행 N개. verbId 가 id 에 반영·클릭 시 onInvoke.
    const readyState: WinVerbsState = { status: 'ready', items: verbs }
    const rd = buildWinVerbsSection(readyState, onInvoke)
    check('[merge] ready → separator + 2 verb 행(3)', rd.length === 3)
    check('[merge] ready[0] separator', rd[0]!.separator === true)
    check('[merge] ready verb id = win-<verbId>', rd[1]!.id === 'win-2:반디집으로 압축하기')
    check('[merge] ready verb 라벨 = display', rd[1]!.label === '반디집으로 압축하기')
    rd[1]!.run?.()
    check('[merge] ready verb 클릭 → onInvoke(verbId)', invoked === '2:반디집으로 압축하기')
    rd[2]!.run?.()
    check('[merge] ready 둘째 verb 클릭 → onInvoke', invoked === '4:Cursor로 열기')

    // ready 인데 items 0 → 방어적으로 empty 와 동치(비노출).
    const readyEmpty: WinVerbsState = { status: 'ready', items: [] }
    check('[merge] ready+items 0 → 0개(비노출)', buildWinVerbsSection(readyEmpty, onInvoke).length === 0)
  }

  // eslint-disable-next-line no-console
  console.log('')
  // eslint-disable-next-line no-console
  console.log(`RESULT: ${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

void main()
