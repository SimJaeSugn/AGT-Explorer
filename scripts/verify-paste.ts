/**
 * BUG-001 실증(헤드리스) — clipboard:paste-target 이 operationId 를 반환하고
 * op:progress/conflict/done 이 그 id 로 emit 되며, 충돌 시 resolve 로 진행되어
 * 무한 대기(hang) 가 없음을 검증한다.
 *
 * 검증 대상은 핸들러가 실행하는 정확한 로직: readClipboard() + effect 에 따른
 * operationManager.start(kind, ...) + clearAfterPaste(). 실제 OperationManager 와
 * 번들된 워커(out/main/fileOpWorker.js)를 구동하며, IPC WebContents 는 fake 로
 * 대체해 push(op:*) 페이로드를 캡처한다(electron 은 scripts/stub-electron 로 alias).
 *
 * 실행 전제: `npm run build` 로 out/main/fileOpWorker.js 존재.
 */
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import { join } from 'node:path'
import type { WebContents } from 'electron'
import { CHANNELS } from '../src/shared/ipc/channels'
import type { ConflictResolution } from '../src/shared/dto'
import { operationManager } from '../src/main/operations/OperationManager'
import { clearAfterPaste, readClipboard, setClipboard } from '../src/main/os/fileClipboard'

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

interface Captured {
  channel: string
  payload: { operationId: string; conflictId?: string; summary?: unknown }
}

type EvtPayload = { operationId: string; conflictId?: string; summary?: unknown }

/** op:* 이벤트를 캡처하고, 충돌 시 정책대로 operationManager.resolve 로 응답하는 fake WebContents. */
function makeFakeWc(opts: {
  onConflict?: (operationId: string, conflictId: string) => { resolution: ConflictResolution; applyToAll: boolean }
}): { wc: WebContents; events: Captured[]; done: Promise<Captured> } {
  const events: Captured[] = []
  let resolveDone: (c: Captured) => void
  const done = new Promise<Captured>((res) => {
    resolveDone = res
  })
  const wc = {
    isDestroyed: () => false,
    send: (channel: string, payload: EvtPayload) => {
      events.push({ channel, payload })
      if (channel === CHANNELS.OP_CONFLICT && opts.onConflict && payload.conflictId) {
        const d = opts.onConflict(payload.operationId, payload.conflictId)
        // 핸들러의 op:resolve 경로와 동일.
        operationManager.resolve(payload.operationId, payload.conflictId, d.resolution, d.applyToAll)
      }
      if (channel === CHANNELS.OP_DONE) resolveDone({ channel, payload })
    }
  } as unknown as WebContents
  return { wc, events, done }
}

/** 핸들러 clipboard:paste-target 의 핵심 로직 그대로(가드/IPC 래퍼 제외). */
async function pasteTarget(
  destDir: string,
  wc: WebContents
): Promise<{ ok: boolean; operationId?: string }> {
  const clip = readClipboard()
  if (clip.effect === 'none' || clip.paths.length === 0) return { ok: false }
  const kind = clip.effect === 'cut' ? 'move' : 'copy'
  const r = await operationManager.start(kind, clip.paths, destDir, undefined, wc)
  if (!r.ok) return { ok: false }
  clearAfterPaste()
  return { ok: true, operationId: r.value.operationId }
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_res, rej) => setTimeout(() => rej(new Error(`TIMEOUT(hang) ${label} > ${ms}ms`)), ms))
  ])
}

async function main(): Promise<void> {
  const tmp = await fsp.mkdtemp(join(os.tmpdir(), 'explorer-paste-'))
  // eslint-disable-next-line no-console
  console.log(`임시 디렉토리: ${tmp}`)

  // ── 1) COPY 붙여넣기: operationId 반환 + progress/done 상관 ────────
  // eslint-disable-next-line no-console
  console.log('== 1) copy 붙여넣기: operationId 반환 + op:progress/done 상관 ==')
  const src1 = join(tmp, 'src1')
  await fsp.mkdir(src1, { recursive: true })
  for (let i = 0; i < 5; i++) await fsp.writeFile(join(src1, `f${i}.bin`), Buffer.alloc(300 * 1024, 1))
  const dest1 = join(tmp, 'dest1')
  await fsp.mkdir(dest1, { recursive: true })

  setClipboard([src1], 'copy')
  const f1 = makeFakeWc({})
  const res1 = await pasteTarget(dest1, f1.wc)
  check('copy paste-target 가 operationId 반환', res1.ok && typeof res1.operationId === 'string' && res1.operationId.length > 0)
  const doneEvt1 = await withTimeout(f1.done, 15000, 'copy done')
  const opId1 = res1.operationId!
  const progress1 = f1.events.filter((e) => e.channel === CHANNELS.OP_PROGRESS)
  check('op:progress 가 반환된 operationId 로 emit', progress1.length > 0 && progress1.every((e) => e.payload.operationId === opId1))
  check('op:done 가 반환된 operationId 로 emit', doneEvt1.payload.operationId === opId1)
  check('copy 결과물 도착', !!(await fsp.stat(join(dest1, 'src1', 'f0.bin')).catch(() => null)))
  check('copy 후 클립보드 유지(copy 는 비우지 않음)', readClipboard().effect === 'copy')
  // eslint-disable-next-line no-console
  console.log(`  operationId=${opId1} progressEvents=${progress1.length}`)

  // ── 2) CUT 붙여넣기: move + 클립보드 비움 ─────────────────────────
  // eslint-disable-next-line no-console
  console.log('== 2) cut 붙여넣기: move 실행 + 클립보드 비움 ==')
  const src2 = join(tmp, 'src2')
  await fsp.mkdir(src2, { recursive: true })
  await fsp.writeFile(join(src2, 'g.txt'), 'X')
  const dest2 = join(tmp, 'dest2')
  await fsp.mkdir(dest2, { recursive: true })

  setClipboard([src2], 'cut')
  const f2 = makeFakeWc({})
  const res2 = await pasteTarget(dest2, f2.wc)
  check('cut paste-target 가 operationId 반환', res2.ok && typeof res2.operationId === 'string')
  await withTimeout(f2.done, 15000, 'cut done')
  check('cut(move) 결과: 대상에 존재', !!(await fsp.stat(join(dest2, 'src2', 'g.txt')).catch(() => null)))
  const src2Gone = (await fsp.stat(src2).catch(() => null)) === null
  check('cut(move) 결과: 원본 사라짐', src2Gone)
  check('cut 후 클립보드 비움(effect=none)', readClipboard().effect === 'none')

  // ── 3) 충돌 붙여넣기: op:conflict → resolve → 진행(hang 없음) ──────
  // eslint-disable-next-line no-console
  console.log('== 3) 충돌 붙여넣기: op:conflict 후 resolve 로 진행(무한 대기 없음) ==')
  const src3 = join(tmp, 'src3')
  await fsp.mkdir(src3, { recursive: true })
  await fsp.writeFile(join(src3, 'hit.txt'), 'NEW')
  const dest3 = join(tmp, 'dest3')
  await fsp.mkdir(join(dest3, 'src3'), { recursive: true })
  await fsp.writeFile(join(dest3, 'src3', 'hit.txt'), 'OLD')

  setClipboard([src3], 'copy')
  let conflictSeen = false
  let conflictOpIdMatched = false
  let expectedOpId3 = ''
  const f3 = makeFakeWc({
    onConflict: (opId, _cid) => {
      conflictSeen = true
      conflictOpIdMatched = opId === expectedOpId3
      return { resolution: 'overwrite', applyToAll: false }
    }
  })
  const res3 = await pasteTarget(dest3, f3.wc)
  const res3OpId = res3.operationId!
  expectedOpId3 = res3OpId
  const done3 = await withTimeout(f3.done, 15000, 'conflict done').catch((e: Error) => {
    check(`충돌 붙여넣기 무한 대기 없음 (${e.message})`, false)
    return null
  })
  check('충돌 이벤트 발생', conflictSeen)
  check('op:conflict 가 반환 operationId 로 emit', conflictOpIdMatched)
  if (done3) {
    check('충돌 resolve 후 op:done 도달(hang 없음)', done3.payload.operationId === res3OpId)
    const after = await fsp.readFile(join(dest3, 'src3', 'hit.txt'), 'utf8')
    check('overwrite 적용(NEW)', after === 'NEW')
  }

  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => undefined)

  // eslint-disable-next-line no-console
  console.log('')
  // eslint-disable-next-line no-console
  console.log(`RESULT: ${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

void main()
