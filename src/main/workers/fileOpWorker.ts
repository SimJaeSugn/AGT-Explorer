/**
 * 파일 작업 Worker Thread 엔트리 (P4, ADR-005 SPK-Worker = Worker Threads).
 *
 * Main(OperationManager)이 new Worker(...) 로 띄우고 workerData=WorkerJob 을 준다.
 * 이 스레드에서 engine(runCopy/runMove/runDelete)을 돌리고, 진행/충돌/실패/완료를
 * parentPort.postMessage 로 Main 에 보고한다. Renderer 와 직접 통신하지 않는다(Main 경유).
 *
 * 취소: workerData.cancelBuffer(Int32Array) 를 Atomics.load 로 폴링 → 메시지 큐
 * 지연 없이 즉시 감지(sub-chunk 취소 지연).
 * 충돌: resolveConflict 는 conflictId 로 Main 에 질의 후 'resolve' 메시지를 기다린다.
 *   applyToAll 캐시는 본 스레드에서 관리(같은 유형 충돌 자동 적용).
 */
import { parentPort, workerData } from 'node:worker_threads'
import { randomUUID } from 'node:crypto'
import type { ConflictResolution } from '@shared/dto'
import { runCopy, runDelete, runMove } from '../operations/engine'
import type { EngineHooks } from '../operations/engine'
import { CANCEL_FLAG_INDEX, PAUSE_FLAG_INDEX } from './protocol'
import type { WorkerInMsg, WorkerJob, WorkerOutMsg } from './protocol'

const port = parentPort
const job = workerData as WorkerJob

/** "C:\\..." → "C"(대문자). UNC/원격/상대 등 드라이브 문자가 없으면 빈 문자열. */
function driveLetterOf(p: string): string {
  return /^[A-Za-z]:/.test(p) ? p[0]!.toUpperCase() : ''
}

/**
 * 적응형 복사 동시성 결정(무회귀 휴리스틱):
 *  - copy/move 만 대상(delete 는 1).
 *  - 소스↔대상이 **다른 볼륨**이면 4(읽기/쓰기 장치 분리 → 병렬 이득), 같은 볼륨이면 1
 *    (같은 디스크 동시 접근은 HDD 시킹 악화 위험 → 순차로 회귀 방지).
 *  드라이브 종류(SSD/HDD) 정보가 워커에 없으므로 같은 볼륨 병렬은 보수적으로 보류한다.
 */
function pickConcurrency(): number {
  if (job.kind === 'delete' || !job.destDir) return 1
  const dest = driveLetterOf(job.destDir)
  if (!dest) return 1
  const crossVolume = job.sources.some((s) => {
    const d = driveLetterOf(s)
    return d !== '' && d !== dest
  })
  return crossVolume ? 4 : 1
}

if (!port) {
  // worker_threads 외부에서 import 된 경우(번들 검증 등) — no-op.
} else {
  // 2워드 협조 버퍼: [0]=cancel, [1]=pause(M7). 단일 Int32Array 뷰 공유.
  const cancelView = new Int32Array(job.cancelBuffer)
  const pauseView = cancelView
  const post = (msg: WorkerOutMsg): void => port.postMessage(msg)

  // 충돌 응답 대기 레지스트리.
  const pending = new Map<string, (r: ConflictResolution) => void>()
  // applyToAll 캐시: 한 번 '모두 적용' 선택 시 이후 동일 유형 자동 적용.
  let stickyResolution: ConflictResolution | null =
    job.conflictPolicy !== undefined ? job.conflictPolicy : null

  port.on('message', (raw: WorkerInMsg) => {
    if (raw.type === 'resolve') {
      if (raw.applyToAll) stickyResolution = raw.resolution
      const fn = pending.get(raw.conflictId)
      if (fn) {
        pending.delete(raw.conflictId)
        fn(raw.resolution)
      }
    }
  })

  const hooks: EngineHooks = {
    onTotals: (totalItems, totalBytes) => post({ type: 'totals', totalItems, totalBytes }),
    onProgress: (processedBytes, processedItems, currentName) =>
      post({ type: 'progress', processedBytes, processedItems, currentName }),
    onFailure: (failure) => post({ type: 'failure', failure }),
    shouldCancel: () => Atomics.load(cancelView, CANCEL_FLAG_INDEX) === 1,
    // 파일 경계 일시정지(M7 · ADR-011): pause(1) 면 재개/취소까지 대기. Atomics.wait 로
    // 워커 스레드를 블록(CPU 0)하되 취소 즉시성 위해 100ms 마다 깨어 cancel 폴링.
    awaitResume: async () => {
      while (
        Atomics.load(pauseView, PAUSE_FLAG_INDEX) === 1 &&
        Atomics.load(cancelView, CANCEL_FLAG_INDEX) !== 1
      ) {
        Atomics.wait(pauseView, PAUSE_FLAG_INDEX, 1, 100)
      }
    },
    resolveConflict: (args) => {
      // 일괄 정책이 정해져 있으면 즉시 적용(질의 없이).
      if (stickyResolution !== null) return Promise.resolve(stickyResolution)
      const conflictId = randomUUID()
      return new Promise<ConflictResolution>((resolve) => {
        pending.set(conflictId, resolve)
        post({
          type: 'conflict',
          conflictId,
          sourcePath: args.sourcePath,
          targetPath: args.targetPath,
          sourceSize: args.sourceSize,
          sourceMtime: args.sourceMtime,
          sourceIsDir: args.sourceIsDir,
          targetSize: args.targetSize,
          targetMtime: args.targetMtime,
          targetIsDir: args.targetIsDir
        })
      })
    }
  }

  void (async () => {
    try {
      const concurrency = pickConcurrency()
      const result =
        job.kind === 'copy'
          ? await runCopy(job.sources, job.destDir ?? '', hooks, concurrency)
          : job.kind === 'move'
            ? await runMove(job.sources, job.destDir ?? '', hooks, concurrency)
            : await runDelete(job.sources, hooks)

      post({
        type: 'done',
        succeededItems: result.succeededItems,
        failedItems: result.failedItems,
        canceled: result.canceled,
        failures: result.failures
      })
    } catch (e) {
      post({
        type: 'fatal',
        code: 'EUNKNOWN',
        message: e instanceof Error ? e.message : '워커 치명적 오류'
      })
    }
  })()
}
