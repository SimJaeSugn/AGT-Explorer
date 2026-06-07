/**
 * P4 Worker Thread 실증(헤드리스) — 실제 Worker 스레드를 띄워
 * 진행률 메시지·SharedArrayBuffer 취소·충돌 메시지 왕복을 검증한다.
 *
 * OperationManager 의 IPC(WebContents) 의존 없이, 본 스크립트가 Main 역할을
 * 흉내 내어 worker.on('message')/postMessage 로 충돌을 해소하고 취소 플래그를
 * 세팅한다. 번들된 워커(out/main/fileOpWorker.js)를 직접 로드한다.
 *
 * 실행 전제: `npm run build` 로 out/main/fileOpWorker.js 가 존재해야 한다.
 */
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

const here = fileURLToPath(import.meta.url)
const ROOT = join(here, '..', '..')
const WORKER = join(ROOT, 'out', 'main', 'fileOpWorker.js')
const CANCEL_FLAG_INDEX = 0

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

interface DoneMsg {
  type: 'done'
  succeededItems: number
  failedItems: number
  canceled: boolean
  failures: unknown[]
}

/** 워커를 띄우고 충돌/취소를 정책대로 처리한 뒤 done 요약을 반환. */
function runJob(
  job: Record<string, unknown>,
  cancelView: Int32Array,
  opts: { onConflict?: (m: { conflictId: string }) => { resolution: string; applyToAll: boolean }; cancelAfterProgress?: number }
): Promise<{ done: DoneMsg; progressCalls: number; conflictCalls: number }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER, { workerData: job })
    let progressCalls = 0
    let conflictCalls = 0
    worker.on('message', (msg: { type: string; conflictId?: string }) => {
      if (msg.type === 'progress') {
        progressCalls++
        if (opts.cancelAfterProgress !== undefined && progressCalls >= opts.cancelAfterProgress) {
          Atomics.store(cancelView, CANCEL_FLAG_INDEX, 1)
        }
      } else if (msg.type === 'conflict') {
        conflictCalls++
        const decision = opts.onConflict?.({ conflictId: msg.conflictId! }) ?? {
          resolution: 'skip',
          applyToAll: true
        }
        worker.postMessage({
          type: 'resolve',
          conflictId: msg.conflictId,
          resolution: decision.resolution,
          applyToAll: decision.applyToAll
        })
      } else if (msg.type === 'done') {
        void worker.terminate()
        resolve({ done: msg as unknown as DoneMsg, progressCalls, conflictCalls })
      } else if (msg.type === 'fatal') {
        void worker.terminate()
        reject(new Error(`fatal: ${JSON.stringify(msg)}`))
      }
    })
    worker.on('error', reject)
  })
}

async function main(): Promise<void> {
  // 워커 번들 존재 확인.
  try {
    await fsp.access(WORKER)
  } catch {
    // eslint-disable-next-line no-console
    console.error(`워커 번들 없음: ${WORKER} — 먼저 \`npm run build\` 실행 필요`)
    process.exit(2)
  }

  const tmp = await fsp.mkdtemp(join(os.tmpdir(), 'explorer-wrk-'))
  // eslint-disable-next-line no-console
  console.log(`임시 디렉토리: ${tmp}`)

  // ── 1) Worker copy 진행률 + done ─────────────────────────────────
  // eslint-disable-next-line no-console
  console.log('== 1) Worker copy: 진행률 메시지 + done 요약 ==')
  const src = join(tmp, 'src')
  await fsp.mkdir(join(src, 'sub'), { recursive: true })
  for (let i = 0; i < 5; i++) await fsp.writeFile(join(src, `f${i}.bin`), Buffer.alloc(300 * 1024, 1))
  await fsp.writeFile(join(src, 'sub', 'deep.bin'), Buffer.alloc(300 * 1024, 2))
  const dest = join(tmp, 'dest')
  await fsp.mkdir(dest, { recursive: true })

  const buf1 = new SharedArrayBuffer(4)
  const view1 = new Int32Array(buf1)
  const r1 = await runJob(
    { operationId: randomUUID(), kind: 'copy', sources: [src], destDir: dest, cancelBuffer: buf1 },
    view1,
    {}
  )
  check('copy done 도착', r1.done.type === 'done')
  check('copy 취소 아님', !r1.done.canceled)
  check('copy 진행률 메시지 발생', r1.progressCalls > 0)
  check('copy 재귀 파일 도착', !!(await fsp.stat(join(dest, 'src', 'sub', 'deep.bin')).catch(() => null)))
  // eslint-disable-next-line no-console
  console.log(`  progressCalls=${r1.progressCalls} succeeded=${r1.done.succeededItems}`)

  // ── 2) Worker 충돌 메시지 왕복 → overwrite ───────────────────────
  // eslint-disable-next-line no-console
  console.log('== 2) Worker 충돌 메시지 왕복(overwrite) ==')
  const csrc = join(tmp, 'csrc')
  await fsp.mkdir(csrc, { recursive: true })
  await fsp.writeFile(join(csrc, 'hit.txt'), 'NEW')
  const cdest = join(tmp, 'cdest')
  await fsp.mkdir(join(cdest, 'csrc'), { recursive: true })
  await fsp.writeFile(join(cdest, 'csrc', 'hit.txt'), 'OLD')
  const buf2 = new SharedArrayBuffer(4)
  const view2 = new Int32Array(buf2)
  const r2 = await runJob(
    { operationId: randomUUID(), kind: 'copy', sources: [csrc], destDir: cdest, cancelBuffer: buf2 },
    view2,
    { onConflict: () => ({ resolution: 'overwrite', applyToAll: false }) }
  )
  check('충돌 메시지 발생', r2.conflictCalls > 0)
  const after = await fsp.readFile(join(cdest, 'csrc', 'hit.txt'), 'utf8')
  check('충돌 overwrite 적용(NEW)', after === 'NEW')

  // ── 3) Worker SharedArrayBuffer 취소 ─────────────────────────────
  // eslint-disable-next-line no-console
  console.log('== 3) Worker 취소(SharedArrayBuffer 플래그) ==')
  const bsrc = join(tmp, 'bsrc')
  await fsp.mkdir(bsrc, { recursive: true })
  for (let i = 0; i < 40; i++) await fsp.writeFile(join(bsrc, `b${i}.bin`), Buffer.alloc(512 * 1024, 3))
  const bdest = join(tmp, 'bdest')
  await fsp.mkdir(bdest, { recursive: true })
  const buf3 = new SharedArrayBuffer(4)
  const view3 = new Int32Array(buf3)
  const r3 = await runJob(
    { operationId: randomUUID(), kind: 'copy', sources: [bsrc], destDir: bdest, cancelBuffer: buf3 },
    view3,
    { cancelAfterProgress: 2 }
  )
  check('취소 후 done.canceled=true', r3.done.canceled)
  const copied = (await fsp.readdir(join(bdest, 'bsrc')).catch(() => [])).length
  check('취소 시 일부만 복사(40 미만)', copied < 40)
  // eslint-disable-next-line no-console
  console.log(`  취소까지 복사=${copied}/40`)

  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => undefined)

  // eslint-disable-next-line no-console
  console.log('')
  // eslint-disable-next-line no-console
  console.log(`RESULT: ${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

void main()
