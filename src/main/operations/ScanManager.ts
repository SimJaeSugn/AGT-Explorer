/**
 * ScanManager — analyze:scan:* 오케스트레이션 (I장, 계획서 §2.5).
 *
 * OperationManager 의 축소판:
 *  - analyze:scan:start 마다 scanId 발급, scanWorker(Worker Thread)에 위임 → UI 비차단.
 *  - Worker 진행 보고를 200ms 스로틀로 analyze:scan:progress 1건씩 Renderer 푸시.
 *  - Worker done → analyze:scan:done 푸시 + 스로틀 정리 + worker.terminate().
 *  - analyze:scan:cancel → SharedArrayBuffer 취소 플래그 set(즉시 감지).
 *  - wc.isDestroyed() 가드(OperationManager.push 패턴).
 *
 * 동시 스캔은 1개로 충분 — 새 스캔 시작 시 진행 중인 이전 스캔을 취소한다.
 * 모든 반환은 Result<T, FileOpError>. throw 금지.
 */
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Worker } from 'node:worker_threads'
import type { WebContents } from 'electron'
import { CHANNELS } from '@shared/ipc/channels'
import type { FileOpError, Result } from '@shared/ipc/contracts'
import { ok } from '@shared/ipc/contracts'
import { toFileOpError } from '../fs/errors'
import { CANCEL_FLAG_INDEX } from '../workers/scanProtocol'
import type { ScanJob, ScanOutMsg } from '../workers/scanProtocol'

/** 진행률 스로틀 간격(ms). op:* 와 동일(200ms 이내 갱신). */
const PROGRESS_THROTTLE_MS = 200

type ScanStateName = 'running' | 'cancelling' | 'done'

interface ActiveScan {
  scanId: string
  state: ScanStateName
  wc: WebContents
  worker: Worker | null
  /** 취소 플래그 공유 버퍼(Int32). */
  cancelView: Int32Array | null
  /** 진행 스로틀용 마지막 페이로드. */
  lastProgress: {
    scannedItems: number
    scannedBytes: number
    currentPath: string
  } | null
  throttleTimer: NodeJS.Timeout | null
}

export class ScanManager {
  private readonly scans = new Map<string, ActiveScan>()

  /** 번들된 워커 경로. out/main/scanWorker.js (index.js 와 동일 디렉토리). */
  private workerPath(): string {
    return join(__dirname, 'scanWorker.js')
  }

  /**
   * 스캔 시작. 동시 스캔 1개 정책 — 진행 중 스캔이 있으면 먼저 취소한다.
   * @param rootPath 핸들러에서 정규화·존재/디렉토리 검증 완료된 절대 경로.
   */
  start(rootPath: string, wc: WebContents): Result<{ scanId: string }> {
    // 진행 중인 이전 스캔 취소(단일 활성 스캔 정책).
    for (const prev of this.scans.values()) {
      if (prev.state !== 'done') this.cancel(prev.scanId)
    }

    const scanId = randomUUID()
    const cancelBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)
    const cancelView = new Int32Array(cancelBuffer)

    const scan: ActiveScan = {
      scanId,
      state: 'running',
      wc,
      worker: null,
      cancelView,
      lastProgress: null,
      throttleTimer: null
    }
    this.scans.set(scanId, scan)

    const job: ScanJob = { scanId, rootPath, cancelBuffer }

    let worker: Worker
    try {
      worker = new Worker(this.workerPath(), { workerData: job })
    } catch (e) {
      this.scans.delete(scanId)
      return { ok: false, error: toFileOpError(e, rootPath) }
    }
    scan.worker = worker

    worker.on('message', (msg: ScanOutMsg) => this.onWorkerMessage(scan, msg))
    worker.on('error', (e) => {
      this.fail(scan, toFileOpError(e, rootPath))
    })
    worker.on('exit', () => {
      // 정상 done 으로 이미 정리됐으면 무시. 비정상 종료만 error 보강.
      if (scan.state !== 'done') {
        this.fail(scan, toFileOpError(new Error('스캔 워커가 비정상 종료되었습니다.'), rootPath))
      }
    })

    this.startThrottle(scan)
    return ok({ scanId })
  }

  /** 취소 — 공유 취소 플래그 set(즉시 감지). Worker 가 canceled 부분결과로 done. */
  cancel(scanId: string): Result<void> {
    const scan = this.scans.get(scanId)
    // 이미 끝났거나 모르는 scanId 도 취소는 멱등하게 ok(레이스: cancel↔done).
    if (!scan) return ok(undefined)
    scan.state = 'cancelling'
    if (scan.cancelView) Atomics.store(scan.cancelView, CANCEL_FLAG_INDEX, 1)
    return ok(undefined)
  }

  // ──────────────────────────────────────────────────────────────────

  private onWorkerMessage(scan: ActiveScan, msg: ScanOutMsg): void {
    switch (msg.type) {
      case 'progress':
        scan.lastProgress = {
          scannedItems: msg.scannedItems,
          scannedBytes: msg.scannedBytes,
          currentPath: msg.currentPath
        }
        break
      case 'done':
        this.finish(scan, () => {
          this.push(scan.wc, CHANNELS.ANALYZE_SCAN_DONE, {
            scanId: scan.scanId,
            result: msg.result
          })
        })
        break
      case 'fatal':
        this.fail(scan, { code: msg.code, message: msg.message, ...(msg.path ? { path: msg.path } : {}) })
        break
    }
  }

  /** 200ms 스로틀로 마지막 진행률 1건 푸시(취소 상태에선 무유입 — 즉시 done 으로 전이). */
  private startThrottle(scan: ActiveScan): void {
    scan.throttleTimer = setInterval(() => {
      if (scan.state === 'running' && scan.lastProgress && !scan.wc.isDestroyed()) {
        this.push(scan.wc, CHANNELS.ANALYZE_SCAN_PROGRESS, {
          scanId: scan.scanId,
          scannedItems: scan.lastProgress.scannedItems,
          scannedBytes: scan.lastProgress.scannedBytes,
          currentPath: scan.lastProgress.currentPath
        })
      }
    }, PROGRESS_THROTTLE_MS)
  }

  /** 완료 공통 처리 — 스로틀 정리 + 종료 이벤트 푸시 + worker 종료 + 정리. */
  private finish(scan: ActiveScan, emit: () => void): void {
    if (scan.state === 'done') return
    scan.state = 'done'
    if (scan.throttleTimer) {
      clearInterval(scan.throttleTimer)
      scan.throttleTimer = null
    }
    if (!scan.wc.isDestroyed()) emit()
    if (scan.worker) void scan.worker.terminate().catch(() => undefined)
    this.scans.delete(scan.scanId)
  }

  private fail(scan: ActiveScan, error: FileOpError): void {
    this.finish(scan, () => {
      this.push(scan.wc, CHANNELS.ANALYZE_SCAN_ERROR, { scanId: scan.scanId, error })
    })
  }

  private push(wc: WebContents, channel: string, payload: unknown): void {
    if (!wc.isDestroyed()) wc.send(channel, payload)
  }
}

export const scanManager = new ScanManager()
