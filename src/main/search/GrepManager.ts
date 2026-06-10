/**
 * GrepManager — search:content:* 오케스트레이션 (M8 — 내용 검색 grep, ADR-010 결정④⑤).
 *
 * ScanManager·HashManager 동형:
 *  - search:content:start 마다 jobId 발급, grepWorker(Worker Thread)에 위임 → UI 비차단.
 *  - Worker 진행 보고를 200ms 스로틀로 search:content:progress 1건씩 Renderer 푸시.
 *  - Worker match → search:content:match 즉시 중계(증분·첫 결과 빠르게).
 *  - Worker done → search:content:done 푸시 + 스로틀 정리 + worker.terminate().
 *  - Worker fatal/error → ECANCELED/정규식 컴파일 실패 등은 잡 시작 단계가 아니면
 *    done(truncated=false)로 정리(별도 error 채널 없음 — match 무·done 으로 종료).
 *  - search:content:cancel → SharedArrayBuffer 취소 플래그 set(즉시 감지·멱등).
 *  - wc.isDestroyed() 가드(OperationManager.push 패턴).
 *
 * 동시 잡 정책: grep 은 단일 활성(새 시작 시 이전 잡 취소) — 사용자가 다른 폴더로
 * 이동하면 진행 잡을 정리하는 ADR-010 결정④ 의도와 일치.
 *
 * 정규식 컴파일 실패는 **start 단계에서** compileMatcher 로 사전 검출해 Result.err 로
 * 반환한다(throw 0·워커 띄우기 전). 모든 반환은 Result<T, FileOpError>.
 */
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Worker } from 'node:worker_threads'
import type { WebContents } from 'electron'
import { CHANNELS } from '@shared/ipc/channels'
import type { FileOpError, Result, SearchContentStartReq } from '@shared/ipc/contracts'
import { err, ok } from '@shared/ipc/contracts'
import { fileOpError, toFileOpError } from '../fs/errors'
import { compileMatcher } from './grepEngine'
import { CANCEL_FLAG_INDEX } from '../workers/grepProtocol'
import type { GrepJob, GrepOutMsg } from '../workers/grepProtocol'

/** 진행률 스로틀 간격(ms). op:*·analyze:scan:*·hash:* 와 동일. */
const PROGRESS_THROTTLE_MS = 200

type GrepStateName = 'running' | 'cancelling' | 'done'

interface ActiveGrep {
  jobId: string
  state: GrepStateName
  wc: WebContents
  worker: Worker | null
  cancelView: Int32Array | null
  lastProgress: {
    scannedFiles: number
    matchedFiles: number
    currentPath: string
  } | null
  throttleTimer: NodeJS.Timeout | null
}

export class GrepManager {
  private readonly jobs = new Map<string, ActiveGrep>()

  /** 번들된 워커 경로. out/main/grepWorker.js (index.js 와 동일 디렉토리). */
  private workerPath(): string {
    return join(__dirname, 'grepWorker.js')
  }

  /**
   * grep 시작. 핸들러에서 정규화·디렉토리 검증 완료된 req(root 절대경로).
   * 정규식 컴파일 실패는 워커 띄우기 전에 Result.err(EINVAL)로 거부한다.
   */
  start(req: SearchContentStartReq, wc: WebContents): Result<{ jobId: string }> {
    // 정규식 사전 컴파일 검증(실패 시 워커 없이 즉시 err).
    const matcher = compileMatcher(req.query, req.isRegex)
    if (matcher === null) {
      return err(fileOpError('EINVAL', '정규식을 해석할 수 없습니다(구문 오류).'))
    }

    // 단일 활성 grep 정책 — 진행 중 잡이 있으면 먼저 취소.
    for (const prev of this.jobs.values()) {
      if (prev.state !== 'done') this.cancel(prev.jobId)
    }

    const jobId = randomUUID()
    const cancelBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)
    const cancelView = new Int32Array(cancelBuffer)

    const active: ActiveGrep = {
      jobId,
      state: 'running',
      wc,
      worker: null,
      cancelView,
      lastProgress: null,
      throttleTimer: null
    }
    this.jobs.set(jobId, active)

    const job: GrepJob = { jobId, payload: req, cancelBuffer }

    let worker: Worker
    try {
      worker = new Worker(this.workerPath(), { workerData: job })
    } catch (e) {
      this.jobs.delete(jobId)
      return { ok: false, error: toFileOpError(e, req.root) }
    }
    active.worker = worker

    worker.on('message', (msg: GrepOutMsg) => this.onWorkerMessage(active, msg))
    worker.on('error', (e) => this.fail(active, toFileOpError(e, req.root)))
    worker.on('exit', () => {
      if (active.state !== 'done') {
        this.fail(active, toFileOpError(new Error('검색 워커가 비정상 종료되었습니다.'), req.root))
      }
    })

    this.startThrottle(active)
    return ok({ jobId })
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

  private onWorkerMessage(job: ActiveGrep, msg: GrepOutMsg): void {
    switch (msg.type) {
      case 'progress':
        job.lastProgress = {
          scannedFiles: msg.scannedFiles,
          matchedFiles: msg.matchedFiles,
          currentPath: msg.currentPath
        }
        break
      case 'match':
        // 증분 결과는 스로틀 없이 즉시 중계(첫 결과 빠르게·가상 스크롤 적재).
        if (job.state !== 'done') {
          this.push(job.wc, CHANNELS.SEARCH_CONTENT_MATCH, {
            jobId: job.jobId,
            file: msg.file,
            lines: msg.lines
          })
        }
        break
      case 'done':
        this.finish(job, () =>
          this.push(job.wc, CHANNELS.SEARCH_CONTENT_DONE, {
            jobId: job.jobId,
            totalMatches: msg.totalMatches,
            truncated: msg.truncated
          })
        )
        break
      case 'fatal':
        // 잡 도중 치명 오류 — 정직하게 done(truncated=true)로 정리(별도 error 채널 없음).
        this.finish(job, () =>
          this.push(job.wc, CHANNELS.SEARCH_CONTENT_DONE, {
            jobId: job.jobId,
            totalMatches: 0,
            truncated: true
          })
        )
        break
    }
  }

  /** 200ms 스로틀로 마지막 진행률 1건 푸시. */
  private startThrottle(job: ActiveGrep): void {
    job.throttleTimer = setInterval(() => {
      if (job.state === 'running' && job.lastProgress && !job.wc.isDestroyed()) {
        this.push(job.wc, CHANNELS.SEARCH_CONTENT_PROGRESS, {
          jobId: job.jobId,
          scannedFiles: job.lastProgress.scannedFiles,
          matchedFiles: job.lastProgress.matchedFiles,
          currentPath: job.lastProgress.currentPath
        })
      }
    }, PROGRESS_THROTTLE_MS)
  }

  /** 완료 공통 — 스로틀 정리 + 종료 이벤트 푸시 + worker 종료 + 정리. */
  private finish(job: ActiveGrep, emit: () => void): void {
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

  private fail(job: ActiveGrep, _error: FileOpError): void {
    // grep 은 별도 error 채널이 없으므로 done(truncated)로 정직 종료한다.
    void _error
    this.finish(job, () =>
      this.push(job.wc, CHANNELS.SEARCH_CONTENT_DONE, {
        jobId: job.jobId,
        totalMatches: 0,
        truncated: true
      })
    )
  }

  private push(wc: WebContents, channel: string, payload: unknown): void {
    if (!wc.isDestroyed()) wc.send(channel, payload)
  }
}

export const grepManager = new GrepManager()
