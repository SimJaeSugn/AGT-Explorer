/**
 * 내용 검색(grep) Worker Thread 엔트리 (M8 — ADR-010, ADR-005 SPK-Worker).
 *
 * Main(GrepManager)이 new Worker(...) 로 띄우고 workerData=GrepJob 을 준다.
 * grepEngine(환경 비의존 코어)을 실 fs deps(grepEngineDeps)로 구동하고, 진행/일치/
 * 완료를 parentPort.postMessage 로 Main 에 보고한다. Renderer 와 직접 통신하지 않는다.
 *
 * 취소: workerData.cancelBuffer(Int32Array) 를 Atomics.load 로 폴링 → 청크/파일
 * 경계에서 즉시 감지. scanWorker·hashWorker 와 동형. `if (!port)` 가드로 번들 검증 시 no-op.
 */
import { parentPort, workerData } from 'node:worker_threads'
import { compileMatcher, runGrep, GREP_DEFAULT_MAX_FILE_BYTES } from '../search/grepEngine'
import type { GrepHooks } from '../search/grepEngine'
import { grepEngineDeps } from '../search/fsDeps'
import { CANCEL_FLAG_INDEX } from './grepProtocol'
import type { GrepJob, GrepOutMsg } from './grepProtocol'

const port = parentPort
const job = workerData as GrepJob

if (!port) {
  // worker_threads 외부에서 import 된 경우(번들 검증 등) — no-op.
} else {
  const cancelView = new Int32Array(job.cancelBuffer)
  const post = (msg: GrepOutMsg): void => port.postMessage(msg)
  const req = job.payload
  const hooks: GrepHooks = {
    onProgress: (scannedFiles, matchedFiles, currentPath) =>
      post({ type: 'progress', scannedFiles, matchedFiles, currentPath }),
    onMatch: (file, lines) => post({ type: 'match', file, lines }),
    shouldCancel: () => Atomics.load(cancelView, CANCEL_FLAG_INDEX) === 1
  }

  void (async () => {
    const matcher = compileMatcher(req.query, req.isRegex)
    if (matcher === null) {
      post({ type: 'fatal', code: 'EINVAL', message: '정규식을 해석할 수 없습니다(구문 오류).' })
      return
    }
    try {
      const result = await runGrep(
        matcher,
        {
          root: req.root,
          query: req.query,
          isRegex: req.isRegex,
          recursive: req.recursive,
          includeHidden: req.includeHidden ?? false,
          maxFileBytes: req.maxFileBytes ?? GREP_DEFAULT_MAX_FILE_BYTES
        },
        hooks,
        grepEngineDeps
      )
      post({ type: 'done', totalMatches: result.totalMatches, truncated: result.truncated })
    } catch (e) {
      post({
        type: 'fatal',
        code: 'EUNKNOWN',
        message: e instanceof Error ? e.message : '검색 워커 치명적 오류'
      })
    }
  })()
}
