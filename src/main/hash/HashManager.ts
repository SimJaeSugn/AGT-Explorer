/**
 * HashManager — hash:* 오케스트레이션 (M7 — ADR-009 결정②④).
 *
 * ScanManager 동형:
 *  - hash:*:start 마다 jobId 발급, hashWorker(Worker Thread)에 위임 → UI 비차단.
 *  - Worker 진행 보고를 200ms 스로틀로 hash:*:progress 1건씩 Renderer 푸시.
 *  - Worker done → hash:*:done 푸시 + 스로틀 정리 + worker.terminate().
 *  - Worker fatal/error → hash:error 푸시(analyze:scan:error 동형 — 정직 표면).
 *  - hash:cancel → SharedArrayBuffer 취소 플래그 set(즉시 감지·멱등·레이스 안전).
 *  - wc.isDestroyed() 가드(OperationManager.push 패턴).
 *
 * 동시 잡 정책: compare/verify 는 단일 활성(새 시작 시 이전 동종 취소), dup 도 단일.
 * 단순화를 위해 동종(kind)별 1개 활성으로 둔다(세션 격리는 jobId Map).
 *
 * 모든 반환은 Result<T, FileOpError>. throw 금지.
 */
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Worker } from 'node:worker_threads'
import type { WebContents } from 'electron'
import { CHANNELS } from '@shared/ipc/channels'
import type {
  HashCompareStartReq,
  HashDupStartReq,
  HashVerifyStartReq,
  FileOpError,
  Result
} from '@shared/ipc/contracts'
import { ok } from '@shared/ipc/contracts'
import type { HashAlgo } from '@shared/dto'
import { toFileOpError } from '../fs/errors'
import { CANCEL_FLAG_INDEX } from '../workers/hashProtocol'
import type { HashJob, HashJobKind, HashOutMsg } from '../workers/hashProtocol'

/** 진행률 스로틀 간격(ms). op:*·analyze:scan:* 와 동일. */
const PROGRESS_THROTTLE_MS = 200

/** 잡 종류별 진행/완료 채널 매핑(분기 단일 출처). */
const PROGRESS_CHANNEL: Record<HashJobKind, string> = {
  compare: CHANNELS.HASH_COMPARE_PROGRESS,
  dup: CHANNELS.HASH_DUP_PROGRESS,
  verify: CHANNELS.HASH_VERIFY_PROGRESS
}

type HashStateName = 'running' | 'cancelling' | 'done'

interface ActiveHash {
  jobId: string
  kind: HashJobKind
  state: HashStateName
  wc: WebContents
  worker: Worker | null
  cancelView: Int32Array | null
  lastProgress: {
    scannedItems: number
    scannedBytes: number
    currentPath: string
  } | null
  throttleTimer: NodeJS.Timeout | null
}

export class HashManager {
  private readonly jobs = new Map<string, ActiveHash>()

  /** 번들된 워커 경로. out/main/hashWorker.js (index.js 와 동일 디렉토리). */
  private workerPath(): string {
    return join(__dirname, 'hashWorker.js')
  }

  startCompare(req: HashCompareStartReq, wc: WebContents): Result<{ jobId: string }> {
    return this.startJob('compare', req, req.algo ?? 'sha256', wc, req.leftDir)
  }

  startDup(req: HashDupStartReq, wc: WebContents): Result<{ jobId: string }> {
    return this.startJob('dup', req, req.algo ?? 'sha256', wc, req.roots[0])
  }

  startVerify(req: HashVerifyStartReq, wc: WebContents): Result<{ jobId: string }> {
    return this.startJob('verify', req, req.algo ?? 'sha256', wc, req.pairs[0]?.src)
  }

  /** 취소 — 공유 취소 플래그 set(즉시 감지). 멱등(레이스: cancel↔done). */
  cancel(jobId: string): Result<void> {
    const job = this.jobs.get(jobId)
    if (!job) return ok(undefined)
    job.state = 'cancelling'
    if (job.cancelView) Atomics.store(job.cancelView, CANCEL_FLAG_INDEX, 1)
    return ok(undefined)
  }

  // ──────────────────────────────────────────────────────────────────

  private startJob(
    kind: HashJobKind,
    payload: HashCompareStartReq | HashDupStartReq | HashVerifyStartReq,
    algo: HashAlgo,
    wc: WebContents,
    diagPath?: string
  ): Result<{ jobId: string }> {
    // 동종 활성 잡 단일화 — 진행 중 동종 잡이 있으면 먼저 취소.
    for (const prev of this.jobs.values()) {
      if (prev.kind === kind && prev.state !== 'done') this.cancel(prev.jobId)
    }

    const jobId = randomUUID()
    const cancelBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)
    const cancelView = new Int32Array(cancelBuffer)

    const active: ActiveHash = {
      jobId,
      kind,
      state: 'running',
      wc,
      worker: null,
      cancelView,
      lastProgress: null,
      throttleTimer: null
    }
    this.jobs.set(jobId, active)

    const job: HashJob = { jobId, kind, payload, algo, cancelBuffer }

    let worker: Worker
    try {
      worker = new Worker(this.workerPath(), { workerData: job })
    } catch (e) {
      this.jobs.delete(jobId)
      return { ok: false, error: toFileOpError(e, diagPath) }
    }
    active.worker = worker

    worker.on('message', (msg: HashOutMsg) => this.onWorkerMessage(active, msg))
    worker.on('error', (e) => this.fail(active, toFileOpError(e, diagPath)))
    worker.on('exit', () => {
      if (active.state !== 'done') {
        this.fail(active, toFileOpError(new Error('해시 워커가 비정상 종료되었습니다.'), diagPath))
      }
    })

    this.startThrottle(active)
    return ok({ jobId })
  }

  private onWorkerMessage(job: ActiveHash, msg: HashOutMsg): void {
    switch (msg.type) {
      case 'progress':
        job.lastProgress = {
          scannedItems: msg.scannedItems,
          scannedBytes: msg.scannedBytes,
          currentPath: msg.currentPath
        }
        break
      case 'compare-done':
        this.finish(job, () =>
          this.push(job.wc, CHANNELS.HASH_COMPARE_DONE, { jobId: job.jobId, result: msg.result })
        )
        break
      case 'dup-done':
        this.finish(job, () =>
          this.push(job.wc, CHANNELS.HASH_DUP_DONE, {
            jobId: job.jobId,
            groups: msg.groups,
            truncated: msg.truncated
          })
        )
        break
      case 'verify-done':
        this.finish(job, () =>
          this.push(job.wc, CHANNELS.HASH_VERIFY_DONE, {
            jobId: job.jobId,
            mismatches: msg.mismatches,
            verified: msg.verified
          })
        )
        break
      case 'fatal':
        this.fail(job, {
          code: msg.code,
          message: msg.message,
          ...(msg.path ? { path: msg.path } : {})
        })
        break
    }
  }

  /** 200ms 스로틀로 마지막 진행률 1건 푸시(잡 종류별 채널). */
  private startThrottle(job: ActiveHash): void {
    const channel = PROGRESS_CHANNEL[job.kind]
    job.throttleTimer = setInterval(() => {
      if (job.state === 'running' && job.lastProgress && !job.wc.isDestroyed()) {
        this.push(job.wc, channel, {
          jobId: job.jobId,
          scannedItems: job.lastProgress.scannedItems,
          scannedBytes: job.lastProgress.scannedBytes,
          currentPath: job.lastProgress.currentPath
        })
      }
    }, PROGRESS_THROTTLE_MS)
  }

  /** 완료 공통 — 스로틀 정리 + 종료 이벤트 푸시 + worker 종료 + 정리. */
  private finish(job: ActiveHash, emit: () => void): void {
    if (job.state === 'done') return
    job.state = 'done'
    if (job.throttleTimer) {
      clearInterval(job.throttleTimer)
      job.throttleTimer = null
    }
    if (!job.wc.isDestroyed()) emit()
    if (job.worker) void job.worker.terminate().catch(() => undefined)
    this.jobs.delete(job.jobId)
  }

  private fail(job: ActiveHash, error: FileOpError): void {
    this.finish(job, () => this.push(job.wc, CHANNELS.HASH_ERROR, { jobId: job.jobId, error }))
  }

  private push(wc: WebContents, channel: string, payload: unknown): void {
    if (!wc.isDestroyed()) wc.send(channel, payload)
  }
}

export const hashManager = new HashManager()
