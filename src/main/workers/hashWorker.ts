/**
 * 공용 해시·비교 Worker Thread 엔트리 (M7 — ADR-009, ADR-005 SPK-Worker).
 *
 * Main(HashManager)이 new Worker(...) 로 띄우고 workerData=HashJob 을 준다.
 * kind 로 compareEngine/dupEngine/verifyEngine 을 분기 실행하고, 진행/완료를
 * parentPort.postMessage 로 Main 에 보고한다. Renderer 와 직접 통신하지 않는다.
 *
 * 취소: workerData.cancelBuffer(Int32Array) 를 Atomics.load 로 폴링 → 청크/항목
 * 경계에서 즉시 감지. scanWorker.ts 와 동형. `if (!port)` 가드로 번들 검증 시 no-op.
 */
import { parentPort, workerData } from 'node:worker_threads'
import type {
  HashCompareStartReq,
  HashDupStartReq,
  HashVerifyStartReq
} from '@shared/ipc/contracts'
import type { HashAlgo } from '@shared/dto'
import { runCompare } from '../hash/compareEngine'
import { findDuplicates, DUP_DEFAULT_MIN_SIZE } from '../hash/dupEngine'
import { verifyPairs } from '../hash/verifyEngine'
import { compareEngineDeps, dupEngineDeps, verifyEngineDeps } from '../hash/fsDeps'
import type { HashHooks } from '../hash/hashEngine'
import { CANCEL_FLAG_INDEX } from './hashProtocol'
import type { HashJob, HashOutMsg } from './hashProtocol'

const port = parentPort
const job = workerData as HashJob

if (!port) {
  // worker_threads 외부에서 import 된 경우(번들 검증 등) — no-op.
} else {
  const cancelView = new Int32Array(job.cancelBuffer)
  const post = (msg: HashOutMsg): void => port.postMessage(msg)
  const hooks: HashHooks = {
    onProgress: (scannedItems, scannedBytes, currentPath) =>
      post({ type: 'progress', scannedItems, scannedBytes, currentPath }),
    shouldCancel: () => Atomics.load(cancelView, CANCEL_FLAG_INDEX) === 1
  }
  const algo: HashAlgo = job.algo

  void (async () => {
    try {
      switch (job.kind) {
        case 'compare': {
          const p = job.payload as HashCompareStartReq
          const result = await runCompare(
            {
              leftDir: p.leftDir,
              rightDir: p.rightDir,
              useHash: p.useHash,
              recursive: p.recursive,
              algo
            },
            hooks,
            compareEngineDeps
          )
          post({ type: 'compare-done', result })
          break
        }
        case 'dup': {
          const p = job.payload as HashDupStartReq
          const minSize = p.minSize ?? DUP_DEFAULT_MIN_SIZE
          const { groups, truncated } = await findDuplicates(
            p.roots,
            minSize,
            algo,
            hooks,
            dupEngineDeps
          )
          post({ type: 'dup-done', groups, truncated })
          break
        }
        case 'verify': {
          const p = job.payload as HashVerifyStartReq
          const { mismatches, verified } = await verifyPairs(p.pairs, algo, hooks, verifyEngineDeps)
          post({ type: 'verify-done', mismatches, verified })
          break
        }
      }
    } catch (e) {
      post({
        type: 'fatal',
        code: 'EUNKNOWN',
        message: e instanceof Error ? e.message : '해시 워커 치명적 오류'
      })
    }
  })()
}
