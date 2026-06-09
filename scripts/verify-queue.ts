/**
 * M7 W2 전송 큐 스케줄러 실증 스크립트(헤드리스, 일회성 검증 · ADR-011).
 *
 * TransferQueue 를 메인 스레드에서 직접 구동(env 비의존 — fs/Worker 미경유)하여
 * 상태머신을 검증한다. run 클로저는 mock(실행 여부만 기록)으로 주입한다.
 *
 *  1) 단발 동치 — 기본 무한 동시성: enqueue 즉시 run() 호출(= 큐 도입 전 동작).
 *  2) 동시성 한도 — maxConcurrent=2 → 3번째 항목 pending 유지.
 *  3) FIFO pump 순서 — 완료 시 다음 대기 항목이 enqueue 순으로 실행.
 *  4) pause/resume — running↔paused 전이 + 플래그 set/clear, 슬롯 점유 유지.
 *  5) 파일 경계 일시정지 — paused 항목은 pump 가 새로 깨우지 않음(슬롯 점유).
 *  6) retry — failed → factory 재기동(원본 제거), pending/running 은 retry 불가.
 *  7) 취소 정합 — complete('canceled') 후 슬롯 해제·다음 pump.
 *  8) set-concurrency — 한도 상향 즉시 대기 항목 pump.
 *  9) snapshot shape — FIFO 순서·상태·진행률 합성(getProgress 주입).
 * 10) SharedArrayBuffer 2워드 정합 — cancel(0) 불변·pause(1) 신규(인덱스 동치).
 *
 * 실행: esbuild 번들 후 node (verify-scan/hash 패턴, @shared 별칭·external:electron).
 */
import { TransferQueue } from '../src/main/operations/TransferQueue'
import type { QueueEntry, ProgressSnapshot } from '../src/main/operations/TransferQueue'
import {
  CANCEL_FLAG_INDEX,
  PAUSE_FLAG_INDEX,
  FLAG_WORD_COUNT
} from '../src/main/workers/protocol'
import type { QueueItemKind } from '../src/shared/dto'

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

/** mock 큐 항목 생성. run 호출 시 ran 배열에 operationId 기록. */
function makeEntry(
  id: string,
  ran: string[],
  opts?: { kind?: QueueItemKind; pauseFlag?: { on: boolean } }
): QueueEntry {
  return {
    operationId: id,
    kind: opts?.kind ?? 'copy',
    status: 'pending',
    enqueuedAt: Date.now(),
    run: () => {
      ran.push(id)
    },
    sourcesSummary: `src-${id}`,
    destSummary: `dst-${id}`,
    setPauseFlag: opts?.pauseFlag
      ? (paused): void => {
          opts.pauseFlag!.on = paused
        }
      : null
  }
}

const zeroProgress: ProgressSnapshot = {
  processedBytes: 0,
  totalBytes: 0,
  processedItems: 0,
  totalItems: 0,
  bytesPerSec: 0,
  etaSec: null
}

function main(): void {
  // ── 1) 단발 동치(기본 무한 동시성) ───────────────────────────────────
  line('== 1) 단발 동치 — 기본 무한 동시성 즉시 실행 ==')
  {
    const q = new TransferQueue()
    const ran: string[] = []
    q.enqueue(makeEntry('a', ran))
    check('enqueue 즉시 run() 호출(단발 동치)', ran.length === 1 && ran[0] === 'a')
    check('항목 running 전이', q.get('a')?.status === 'running')
    check('기본 maxConcurrent 무한', q.getMaxConcurrent() === Number.MAX_SAFE_INTEGER)
    // 다수 enqueue 도 전부 즉시 실행(단발 다발 동치).
    q.enqueue(makeEntry('b', ran))
    q.enqueue(makeEntry('c', ran))
    check('무한 동시성: 추가 항목도 즉시 실행', ran.length === 3)
  }

  // ── 2) 동시성 한도 — 3번째 pending ───────────────────────────────────
  line('== 2) 동시성 한도 maxConcurrent=2 → 3번째 pending ==')
  {
    const q = new TransferQueue()
    q.setConcurrency(2)
    const ran: string[] = []
    q.enqueue(makeEntry('a', ran))
    q.enqueue(makeEntry('b', ran))
    q.enqueue(makeEntry('c', ran))
    check('한도 2: a,b 실행', ran.length === 2 && ran[0] === 'a' && ran[1] === 'b')
    check('c 는 pending 대기', q.get('c')?.status === 'pending')
    check('a,b running', q.get('a')?.status === 'running' && q.get('b')?.status === 'running')
  }

  // ── 3) FIFO pump 순서 — 완료 시 다음 대기 실행 ───────────────────────
  line('== 3) FIFO pump — 완료 시 다음 대기 항목 실행 ==')
  {
    const q = new TransferQueue()
    q.setConcurrency(1)
    const ran: string[] = []
    q.enqueue(makeEntry('a', ran))
    q.enqueue(makeEntry('b', ran))
    q.enqueue(makeEntry('c', ran))
    check('한도 1: a 만 실행', ran.length === 1 && ran[0] === 'a')
    q.complete('a', 'done')
    check('a 완료 → b 실행(FIFO)', ran.length === 2 && ran[1] === 'b')
    q.complete('b', 'done')
    check('b 완료 → c 실행(FIFO)', ran.length === 3 && ran[2] === 'c')
  }

  // ── 4) pause/resume — 전이 + 플래그 set/clear ────────────────────────
  line('== 4) pause/resume 전이 + SharedArrayBuffer 플래그 ==')
  {
    const q = new TransferQueue()
    const ran: string[] = []
    const flag = { on: false }
    q.enqueue(makeEntry('a', ran, { pauseFlag: flag }))
    check('a running', q.get('a')?.status === 'running')
    const paused = q.pause('a')
    check('pause 반환 true', paused === true)
    check('a paused', q.get('a')?.status === 'paused')
    check('pause 플래그 set(true)', flag.on === true)
    const resumed = q.resume('a')
    check('resume 반환 true', resumed === true)
    check('a running 복귀', q.get('a')?.status === 'running')
    check('pause 플래그 clear(false)', flag.on === false)
    // 잘못된 전이 거부.
    check('running 항목 resume 거부', q.resume('a') === false)
    check('미존재 pause 거부', q.pause('zzz') === false)
  }

  // ── 5) 파일 경계 일시정지 — paused 슬롯 점유(pump 미깨움) ─────────────
  line('== 5) paused 항목 슬롯 점유 — pump 가 새로 깨우지 않음 ==')
  {
    const q = new TransferQueue()
    q.setConcurrency(1)
    const ran: string[] = []
    q.enqueue(makeEntry('a', ran))
    q.enqueue(makeEntry('b', ran))
    q.pause('a') // a paused — 슬롯 여전히 점유.
    q.pump() // 강제 pump
    check('paused 가 슬롯 점유 → b 미실행', ran.length === 1 && ran[0] === 'a')
    q.resume('a')
    check('resume 후에도 b 는 a 완료 전까지 대기', ran.length === 1)
    q.complete('a', 'done')
    check('a 완료 → b 실행', ran.length === 2 && ran[1] === 'b')
  }

  // ── 6) retry — failed 만 재기동 ──────────────────────────────────────
  line('== 6) retry — failed → factory 재기동, 원본 제거 ==')
  {
    const q = new TransferQueue()
    const ran: string[] = []
    q.enqueue(makeEntry('a', ran))
    // running 항목 retry 불가.
    check('running 항목 retry 불가', q.retry('a', () => 'new') === null)
    q.complete('a', 'failed')
    check('a failed', q.get('a')?.status === 'failed')
    let factoryCalled = false
    const newId = q.retry('a', () => {
      factoryCalled = true
      q.enqueue(makeEntry('a2', ran))
      return 'a2'
    })
    check('retry factory 호출', factoryCalled === true)
    check('retry 새 operationId 반환', newId === 'a2')
    check('원본 failed 항목 제거', q.has('a') === false)
    check('새 항목 a2 실행', q.has('a2') && ran.includes('a2'))
    // factory null 반환 시 retry 실패.
    q.complete('a2', 'failed')
    check('factory null → retry null', q.retry('a2', () => null) === null)
  }

  // ── 7) 취소 정합 — canceled 슬롯 해제 ────────────────────────────────
  line('== 7) 취소 — complete(canceled) 후 슬롯 해제·다음 pump ==')
  {
    const q = new TransferQueue()
    q.setConcurrency(1)
    const ran: string[] = []
    q.enqueue(makeEntry('a', ran))
    q.enqueue(makeEntry('b', ran))
    q.complete('a', 'canceled')
    check('a canceled', q.get('a')?.status === 'canceled')
    check('취소 후 b 실행(슬롯 해제)', ran.length === 2 && ran[1] === 'b')
    // 종료 항목 중복 complete 무시.
    q.complete('a', 'done')
    check('종료 항목 재완료 무시', q.get('a')?.status === 'canceled')
  }

  // ── 8) set-concurrency — 상향 시 즉시 pump ───────────────────────────
  line('== 8) set-concurrency 상향 → 대기 항목 즉시 pump ==')
  {
    const q = new TransferQueue()
    q.setConcurrency(1)
    const ran: string[] = []
    q.enqueue(makeEntry('a', ran))
    q.enqueue(makeEntry('b', ran))
    q.enqueue(makeEntry('c', ran))
    check('한도 1: a 만', ran.length === 1)
    q.setConcurrency(3)
    check('한도 3 상향 → b,c 즉시 실행', ran.length === 3)
    // 하향은 실행 중 항목을 죽이지 않음(점유 유지).
    q.setConcurrency(1)
    check('하향해도 실행 중 항목 유지', q.get('a')?.status === 'running')
  }

  // ── 9) snapshot shape — FIFO·진행률 합성 ─────────────────────────────
  line('== 9) snapshot — FIFO 순서·상태·진행률 합성 ==')
  {
    const q = new TransferQueue()
    q.setConcurrency(1)
    const ran: string[] = []
    q.enqueue(makeEntry('a', ran, { kind: 'move' }))
    q.enqueue(makeEntry('b', ran, { kind: 'remote-download' }))
    const prog: ProgressSnapshot = {
      processedBytes: 50,
      totalBytes: 100,
      processedItems: 1,
      totalItems: 2,
      bytesPerSec: 25,
      etaSec: 2
    }
    const snap = q.snapshot((id) => (id === 'a' ? prog : zeroProgress))
    check('snapshot FIFO 순서', snap.length === 2 && snap[0]!.operationId === 'a' && snap[1]!.operationId === 'b')
    check('snapshot kind 보존', snap[0]!.kind === 'move' && snap[1]!.kind === 'remote-download')
    check('snapshot 상태', snap[0]!.status === 'running' && snap[1]!.status === 'pending')
    check('snapshot 진행률 합성(a)', snap[0]!.processedBytes === 50 && snap[0]!.bytesPerSec === 25 && snap[0]!.etaSec === 2)
    check('snapshot 진행률 0(b 대기)', snap[1]!.processedBytes === 0 && snap[1]!.etaSec === null)
    check('snapshot summary 보존', snap[0]!.sourcesSummary === 'src-a' && snap[0]!.destSummary === 'dst-a')
  }

  // ── 10) SharedArrayBuffer 2워드 정합 — cancel(0) 불변·pause(1) 신규 ──
  line('== 10) SharedArrayBuffer 2워드 인덱스 정합 ==')
  {
    check('CANCEL_FLAG_INDEX 불변(0)', CANCEL_FLAG_INDEX === 0)
    check('PAUSE_FLAG_INDEX 신규(1)', PAUSE_FLAG_INDEX === 1)
    check('FLAG_WORD_COUNT=2', FLAG_WORD_COUNT === 2)
    // 2워드 버퍼: cancel set 이 pause 에 영향 0(동치 보장).
    const buf = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * FLAG_WORD_COUNT)
    const view = new Int32Array(buf)
    Atomics.store(view, CANCEL_FLAG_INDEX, 1)
    check('cancel set → pause 영향 0', Atomics.load(view, PAUSE_FLAG_INDEX) === 0)
    Atomics.store(view, PAUSE_FLAG_INDEX, 1)
    check('pause set → cancel 불변(1)', Atomics.load(view, CANCEL_FLAG_INDEX) === 1)
    Atomics.store(view, PAUSE_FLAG_INDEX, 0)
    check('pause clear → cancel 불변(1)', Atomics.load(view, CANCEL_FLAG_INDEX) === 1)
  }

  line('')
  line(`결과: PASS ${pass} / FAIL ${fail}`)
  if (fail > 0) process.exit(1)
}

main()
