/**
 * 디스크 사용량 스캔 Worker Thread 엔트리 (I장, ADR-005 SPK-Worker).
 *
 * Main(ScanManager)이 new Worker(...) 로 띄우고 workerData=ScanJob 을 준다.
 * 이 스레드에서 scanEngine.runScan 을 돌리고, 진행/완료를 parentPort.postMessage
 * 로 Main 에 보고한다. Renderer 와 직접 통신하지 않는다(Main 경유).
 *
 * 취소: workerData.cancelBuffer(Int32Array) 를 Atomics.load 로 폴링 → 메시지 큐
 * 지연 없이 즉시 감지(디렉토리/항목 경계 취소). fileOpWorker.ts 와 동형.
 */
import { parentPort, workerData } from 'node:worker_threads'
import { runScan } from '../operations/scanEngine'
import type { ScanHooks } from '../operations/scanEngine'
import { CANCEL_FLAG_INDEX } from './scanProtocol'
import type { ScanJob, ScanOutMsg } from './scanProtocol'

const port = parentPort
const job = workerData as ScanJob

if (!port) {
  // worker_threads 외부에서 import 된 경우(번들 검증 등) — no-op.
} else {
  const cancelView = new Int32Array(job.cancelBuffer)
  const post = (msg: ScanOutMsg): void => port.postMessage(msg)

  const hooks: ScanHooks = {
    onProgress: (scannedItems, scannedBytes, currentPath) =>
      post({ type: 'progress', scannedItems, scannedBytes, currentPath }),
    shouldCancel: () => Atomics.load(cancelView, CANCEL_FLAG_INDEX) === 1
  }

  void (async () => {
    try {
      const result = await runScan(job.rootPath, hooks)
      post({ type: 'done', result })
    } catch (e) {
      post({
        type: 'fatal',
        code: 'EUNKNOWN',
        message: e instanceof Error ? e.message : '스캔 워커 치명적 오류'
      })
    }
  })()
}
