/**
 * OperationManager — op:* 작업 오케스트레이션 (P4, SA §4.1, ADR-005).
 *
 * 책임:
 *  - op:start 마다 operationId 발급, 작업 상태머신 추적.
 *  - copy/move/delete 는 Worker Thread(fileOpWorker)에 위임 → UI 비차단.
 *  - trash 는 Electron shell.trashItem 으로 Main 스레드에서 직접 처리(네이티브).
 *  - Worker 진행 보고를 200ms 스로틀로 합산해 op:progress 1건씩 Renderer 푸시.
 *  - Worker 충돌 질의 → op:conflict 푸시 → op:resolve 수신 → Worker 로 중계.
 *  - op:cancel → SharedArrayBuffer 취소 플래그 set(즉시 감지) + Worker 종료 유도.
 *  - 완료 시 op:done(summary) 푸시.
 *  - 사전 선검증: 소스 존재·동일 폴더 무시·조상→자손(순환) 이동 차단(SA §4.1).
 *
 * 모든 반환은 Result<T, FileOpError>. throw 금지.
 */
import { constants as fsConstants } from 'node:fs'
import * as fsp from 'node:fs/promises'
import { join, win32 } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Worker } from 'node:worker_threads'
import type { WebContents } from 'electron'
import { shell } from 'electron'
import { CHANNELS } from '@shared/ipc/channels'
import type { FileOpError, Result } from '@shared/ipc/contracts'
import { err, ok } from '@shared/ipc/contracts'
import type { ConflictResolution, OpFailure, OpKind, OpSummary } from '@shared/dto'
import { fileOpError, toFileOpError } from '../fs/errors'
import { runDelete } from './engine'
import { CANCEL_FLAG_INDEX } from '../workers/protocol'
import type { WorkerInMsg, WorkerJob, WorkerOutMsg } from '../workers/protocol'

/** 진행률 스로틀 간격(ms). roadmap P4 DoD: 200ms 이내 갱신. */
const PROGRESS_THROTTLE_MS = 200

type OpState = 'running' | 'conflict' | 'cancelling' | 'done'

interface ActiveOp {
  operationId: string
  kind: OpKind
  state: OpState
  wc: WebContents
  worker: Worker | null
  /** 취소 플래그 공유 버퍼(Int32). */
  cancelView: Int32Array | null
  /** 진행 스로틀 타이머/마지막 페이로드. */
  lastProgress: {
    processedBytes: number
    totalBytes: number
    processedItems: number
    totalItems: number
    currentName: string
  } | null
  totals: { totalItems: number; totalBytes: number }
  throttleTimer: NodeJS.Timeout | null
  /** Main 직접 처리(trash)용 취소 플래그. */
  canceled: boolean
  resolveDone: ((summary: OpSummary) => void) | null
}

export class OperationManager {
  private readonly ops = new Map<string, ActiveOp>()

  /** 번들된 워커 경로. out/main/fileOpWorker.js (index.js 와 동일 디렉토리). */
  private workerPath(): string {
    return join(__dirname, 'fileOpWorker.js')
  }

  // ──────────────────────────────────────────────────────────────────
  // op:start
  // ──────────────────────────────────────────────────────────────────

  async start(
    kind: OpKind,
    sources: string[],
    destDir: string | undefined,
    conflictPolicy: ConflictResolution | undefined,
    wc: WebContents
  ): Promise<Result<{ operationId: string }>> {
    // ── 사전 선검증 ────────────────────────────────────────────────
    if (sources.length === 0) {
      return err(fileOpError('EINVAL', '대상 항목이 없습니다.'))
    }
    // 소스 존재 확인(전부 없으면 거부, 일부 없으면 작업 중 실패로 격리).
    const existing: string[] = []
    for (const s of sources) {
      try {
        await fsp.access(s, fsConstants.F_OK)
        existing.push(s)
      } catch {
        /* 누락은 작업 중 failure 로 기록되거나, 전부 누락 시 아래 거부 */
      }
    }
    if (existing.length === 0) {
      return err(fileOpError('ENOENT', '대상을 찾을 수 없습니다.', sources[0]))
    }

    if (kind === 'copy' || kind === 'move') {
      if (!destDir) return err(fileOpError('EINVAL', '대상 디렉토리가 필요합니다.'))
      // 대상 디렉토리 존재·디렉토리 여부.
      try {
        const st = await fsp.stat(destDir)
        if (!st.isDirectory()) return err(fileOpError('ENOTDIR', '대상이 폴더가 아닙니다.', destDir))
      } catch (e) {
        return err(toFileOpError(e, destDir))
      }
      // 순환/동일폴더 선검증.
      const pre = this.precheckCopyMove(existing, destDir, kind)
      if (!pre.ok) return pre as Result<{ operationId: string }>
    }

    const operationId = randomUUID()

    if (kind === 'trash') {
      // 휴지통은 Worker 미사용 — Main 스레드에서 shell.trashItem.
      return this.startTrash(operationId, existing, wc)
    }
    if (kind === 'delete') {
      // 영구삭제도 Worker 위임(재귀·진행률). delete 는 destDir 무관.
      return this.startWorker(operationId, 'delete', existing, undefined, conflictPolicy, wc)
    }
    // copy / move.
    return this.startWorker(operationId, kind, existing, destDir, conflictPolicy, wc)
  }

  /** 동일 폴더로의 이동 무시·조상→자손(순환) 이동 차단. */
  private precheckCopyMove(
    sources: string[],
    destDir: string,
    kind: OpKind
  ): Result<void> {
    const destNorm = win32.resolve(destDir).toLowerCase()
    for (const src of sources) {
      const srcNorm = win32.resolve(src).toLowerCase()
      const srcParent = win32.dirname(srcNorm)
      // 이동 시 같은 폴더로의 이동은 무의미(무시 대상) → 거부 안내.
      if (kind === 'move' && srcParent === destNorm) {
        return err(fileOpError('EINVAL', '같은 폴더로는 이동할 수 없습니다.', src))
      }
      // 조상→자손: dest 가 src 하위면 순환(자기 안으로 복사/이동) 차단.
      if (destNorm === srcNorm || destNorm.startsWith(srcNorm + win32.sep)) {
        return err(fileOpError('EINVAL', '폴더를 자기 자신 또는 하위로 이동/복사할 수 없습니다.', src))
      }
    }
    return ok(undefined)
  }

  // ──────────────────────────────────────────────────────────────────
  // Worker 기반 copy/move/delete
  // ──────────────────────────────────────────────────────────────────

  private startWorker(
    operationId: string,
    kind: 'copy' | 'move' | 'delete',
    sources: string[],
    destDir: string | undefined,
    conflictPolicy: ConflictResolution | undefined,
    wc: WebContents
  ): Result<{ operationId: string }> {
    const cancelBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)
    const cancelView = new Int32Array(cancelBuffer)

    const op: ActiveOp = {
      operationId,
      kind,
      state: 'running',
      wc,
      worker: null,
      cancelView,
      lastProgress: null,
      totals: { totalItems: 0, totalBytes: 0 },
      throttleTimer: null,
      canceled: false,
      resolveDone: null
    }
    this.ops.set(operationId, op)

    const job: WorkerJob = {
      operationId,
      kind,
      sources,
      ...(destDir !== undefined ? { destDir } : {}),
      ...(conflictPolicy !== undefined ? { conflictPolicy } : {}),
      cancelBuffer
    }

    let worker: Worker
    try {
      worker = new Worker(this.workerPath(), { workerData: job })
    } catch (e) {
      this.ops.delete(operationId)
      return err(toFileOpError(e))
    }
    op.worker = worker

    worker.on('message', (msg: WorkerOutMsg) => this.onWorkerMessage(op, msg))
    worker.on('error', (e) => {
      this.finish(op, {
        operationId,
        kind,
        succeededItems: 0,
        failedItems: sources.length,
        canceled: op.canceled,
        failures: [{ path: sources[0] ?? '', code: 'EUNKNOWN', message: e.message }]
      })
    })
    worker.on('exit', () => {
      // 정상 done 메시지로 이미 finish 됐으면 무시. 비정상 종료만 보강.
      if (op.state !== 'done') {
        this.finish(op, {
          operationId,
          kind,
          succeededItems: 0,
          failedItems: 0,
          canceled: true,
          failures: []
        })
      }
    })

    this.startThrottle(op)
    return ok({ operationId })
  }

  private onWorkerMessage(op: ActiveOp, msg: WorkerOutMsg): void {
    switch (msg.type) {
      case 'totals':
        op.totals = { totalItems: msg.totalItems, totalBytes: msg.totalBytes }
        break
      case 'progress':
        op.lastProgress = {
          processedBytes: msg.processedBytes,
          totalBytes: op.totals.totalBytes,
          processedItems: msg.processedItems,
          totalItems: op.totals.totalItems,
          currentName: msg.currentName
        }
        break
      case 'conflict':
        op.state = 'conflict'
        this.push(op.wc, CHANNELS.OP_CONFLICT, {
          operationId: op.operationId,
          conflictId: msg.conflictId,
          source: {
            name: win32.basename(msg.sourcePath),
            path: msg.sourcePath,
            isDir: msg.sourceIsDir,
            size: msg.sourceSize,
            mtime: msg.sourceMtime,
            ctime: msg.sourceMtime,
            ext: '',
            attrs: { hidden: false, readonly: false, system: false, symlink: false }
          },
          target: {
            name: win32.basename(msg.targetPath),
            path: msg.targetPath,
            isDir: msg.targetIsDir,
            size: msg.targetSize,
            mtime: msg.targetMtime,
            ctime: msg.targetMtime,
            ext: '',
            attrs: { hidden: false, readonly: false, system: false, symlink: false }
          }
        })
        break
      case 'failure':
        // 진행 중 실패는 done summary 에 합산되어 도착하므로 여기선 누적 불필요.
        break
      case 'done':
        op.state = 'running'
        this.finish(op, {
          operationId: op.operationId,
          kind: op.kind,
          succeededItems: msg.succeededItems,
          failedItems: msg.failedItems,
          canceled: msg.canceled,
          failures: msg.failures
        })
        break
      case 'fatal':
        this.finish(op, {
          operationId: op.operationId,
          kind: op.kind,
          succeededItems: 0,
          failedItems: 1,
          canceled: false,
          failures: [{ path: '', code: msg.code, message: msg.message }]
        })
        break
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // 진행률 200ms 스로틀
  // ──────────────────────────────────────────────────────────────────

  private startThrottle(op: ActiveOp): void {
    op.throttleTimer = setInterval(() => {
      if (op.lastProgress && !op.wc.isDestroyed()) {
        this.push(op.wc, CHANNELS.OP_PROGRESS, {
          operationId: op.operationId,
          processedBytes: op.lastProgress.processedBytes,
          totalBytes: op.lastProgress.totalBytes,
          processedItems: op.lastProgress.processedItems,
          totalItems: op.lastProgress.totalItems,
          currentName: op.lastProgress.currentName
        })
      }
    }, PROGRESS_THROTTLE_MS)
  }

  // ──────────────────────────────────────────────────────────────────
  // 휴지통 (Main 스레드 · shell.trashItem)
  // ──────────────────────────────────────────────────────────────────

  private async startTrash(
    operationId: string,
    sources: string[],
    wc: WebContents
  ): Promise<Result<{ operationId: string }>> {
    const op: ActiveOp = {
      operationId,
      kind: 'trash',
      state: 'running',
      wc,
      worker: null,
      cancelView: null,
      lastProgress: null,
      totals: { totalItems: sources.length, totalBytes: 0 },
      throttleTimer: null,
      canceled: false,
      resolveDone: null
    }
    this.ops.set(operationId, op)

    // 비동기로 진행(즉시 operationId 반환).
    void (async () => {
      const failures: OpFailure[] = []
      let succeeded = 0
      for (let i = 0; i < sources.length; i++) {
        if (op.canceled) break
        const src = sources[i] as string
        try {
          await shell.trashItem(src)
          succeeded++
          if (!wc.isDestroyed()) {
            this.push(wc, CHANNELS.OP_PROGRESS, {
              operationId,
              processedBytes: 0,
              totalBytes: 0,
              processedItems: i + 1,
              totalItems: sources.length,
              currentName: win32.basename(src)
            })
          }
        } catch (e) {
          const fe = toFileOpError(e, src)
          failures.push({ path: src, code: fe.code, message: fe.message })
        }
      }
      this.finish(op, {
        operationId,
        kind: 'trash',
        succeededItems: succeeded,
        failedItems: failures.length,
        canceled: op.canceled,
        failures
      })
    })()

    return ok({ operationId })
  }

  // ──────────────────────────────────────────────────────────────────
  // op:resolve / op:cancel
  // ──────────────────────────────────────────────────────────────────

  resolve(
    operationId: string,
    conflictId: string,
    resolution: ConflictResolution,
    applyToAll: boolean
  ): Result<void> {
    const op = this.ops.get(operationId)
    if (!op) return err(fileOpError('ENOENT', '해당 작업을 찾을 수 없습니다.'))
    if (!op.worker) return err(fileOpError('EINVAL', '충돌 해소 대상이 아닙니다.'))
    const msg: WorkerInMsg = { type: 'resolve', conflictId, resolution, applyToAll }
    op.worker.postMessage(msg)
    op.state = 'running'
    return ok(undefined)
  }

  cancel(operationId: string): Result<void> {
    const op = this.ops.get(operationId)
    if (!op) return err(fileOpError('ENOENT', '해당 작업을 찾을 수 없습니다.'))
    op.state = 'cancelling'
    op.canceled = true
    // Worker: 공유 취소 플래그 set(즉시 감지).
    if (op.cancelView) Atomics.store(op.cancelView, CANCEL_FLAG_INDEX, 1)
    return ok(undefined)
  }

  // ──────────────────────────────────────────────────────────────────
  // 완료 처리
  // ──────────────────────────────────────────────────────────────────

  private finish(op: ActiveOp, summary: OpSummary): void {
    if (op.state === 'done') return
    op.state = 'done'
    if (op.throttleTimer) {
      clearInterval(op.throttleTimer)
      op.throttleTimer = null
    }
    // 마지막 진행률 1건 강제 푸시(100% 도달 반영).
    if (op.lastProgress && !op.wc.isDestroyed()) {
      this.push(op.wc, CHANNELS.OP_PROGRESS, {
        operationId: op.operationId,
        processedBytes: op.lastProgress.processedBytes,
        totalBytes: op.lastProgress.totalBytes,
        processedItems: op.lastProgress.processedItems,
        totalItems: op.lastProgress.totalItems,
        currentName: op.lastProgress.currentName
      })
    }
    if (!op.wc.isDestroyed()) {
      this.push(op.wc, CHANNELS.OP_DONE, { operationId: op.operationId, summary })
    }
    if (op.worker) void op.worker.terminate().catch(() => undefined)
    this.ops.delete(op.operationId)
  }

  private push(wc: WebContents, channel: string, payload: unknown): void {
    if (!wc.isDestroyed()) wc.send(channel, payload)
  }

  // ──────────────────────────────────────────────────────────────────
  // 헤드리스 검증용: Worker 없이 엔진 직접 구동(verify 스크립트 전용).
  // 실제 IPC 경로는 위 start() 를 쓴다.
  // ──────────────────────────────────────────────────────────────────

  /** 검증 전용 — 영구삭제를 Worker 없이 직접 실행(테스트 격리). */
  async deleteDirect(
    sources: string[],
    onProgress?: (items: number) => void
  ): Promise<OpSummary> {
    const result = await runDelete(sources, {
      onTotals: () => undefined,
      onProgress: (_b, items) => onProgress?.(items),
      onFailure: () => undefined,
      resolveConflict: () => Promise.resolve('skip'),
      shouldCancel: () => false
    })
    return {
      operationId: 'direct',
      kind: 'delete',
      succeededItems: result.succeededItems,
      failedItems: result.failedItems,
      canceled: result.canceled,
      failures: result.failures
    }
  }
}

export const operationManager = new OperationManager()

/** FileOpError 헬퍼 재노출(핸들러 편의). */
export type { FileOpError }
