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
import type {
  ConflictResolution,
  OpFailure,
  OpKind,
  OpSummary,
  QueueItemDTO,
  QueueItemKind
} from '@shared/dto'
import { fileOpError, toFileOpError } from '../fs/errors'
import { runDelete } from './engine'
import { CANCEL_FLAG_INDEX, FLAG_WORD_COUNT, PAUSE_FLAG_INDEX } from '../workers/protocol'
import type { WorkerInMsg, WorkerJob, WorkerOutMsg } from '../workers/protocol'
import { TransferQueue } from './TransferQueue'
import type { ProgressSnapshot, QueueEntry } from './TransferQueue'
import { runRobocopyCopy } from '../os/robocopy'
import type { RobocopyHandle } from '../os/robocopy'

/** 진행률 스로틀 간격(ms). roadmap P4 DoD: 200ms 이내 갱신. */
const PROGRESS_THROTTLE_MS = 200

/** queue:state 푸시 디바운스 간격(ms · ADR-011 §3.1). */
const QUEUE_STATE_DEBOUNCE_MS = 150

/** 소스 목록 표시용 요약(경로 전체 미수록 — QueueItemDTO.sourcesSummary). */
function summarizeSources(sources: readonly string[]): string {
  if (sources.length === 0) return ''
  if (sources.length === 1) return win32.basename(sources[0] ?? '')
  return `${win32.basename(sources[0] ?? '')} 외 ${sources.length - 1}개`
}

/**
 * shell.trashItem 실패를 사용자 친화 OpFailure 로 변환한다.
 *
 * Electron 의 trashItem 은 errno 없는 일반 오류("Failed to perform delete operation")를
 * 던져 EUNKNOWN+영어 원문이 그대로 노출된다. trashItem 은 **폴더 단위 원자 연산**이라
 * 내부에 사용 중/잠긴 파일이 하나라도 있으면 통째로 실패한다(흔한 원인). 원인을 추정해
 * 실행 가능한 한국어 메시지로 바꾼다. 알려진 errno(EACCES 등)는 그대로 보존한다.
 */
async function describeTrashFailure(src: string, e: unknown): Promise<OpFailure> {
  const base = toFileOpError(e, src)
  if (base.code !== 'EUNKNOWN') {
    return { path: src, code: base.code, message: base.message }
  }
  // EUNKNOWN(= trashItem 일반 오류): lstat 으로 원인 추정.
  try {
    const st = await fsp.lstat(src)
    if (st.isSymbolicLink()) {
      return {
        path: src,
        code: 'EUNKNOWN',
        message:
          '정션/심볼릭 링크는 휴지통으로 이동할 수 없습니다. Shift+Delete(영구 삭제)로 링크만 제거하세요.'
      }
    }
    return {
      path: src,
      code: 'EUNKNOWN',
      message:
        '휴지통으로 보낼 수 없습니다. 항목이 다른 프로그램에서 사용 중이거나 보호된 시스템 폴더일 수 있습니다 — 사용 중인 프로그램을 닫고 다시 시도하거나, Shift+Delete로 영구 삭제하세요.'
    }
  } catch {
    return {
      path: src,
      code: 'EUNKNOWN',
      message: '휴지통으로 보낼 수 없습니다(항목을 찾을 수 없거나 접근 권한이 없습니다).'
    }
  }
}

type OpState = 'running' | 'conflict' | 'cancelling' | 'done'

interface ActiveOp {
  operationId: string
  kind: OpKind
  state: OpState
  wc: WebContents
  worker: Worker | null
  /** 협조 플래그 공유 버퍼 뷰(Int32[0]=cancel, Int32[1]=pause). */
  cancelView: Int32Array | null
  /** 시작 시각(속도/ETA 산출). */
  startedAt: number
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
  /** 외부(원격 전송) op 취소 훅 — CN-4. cancel() 가 호출(스트림 destroy 위임). */
  externalCancel?: () => void
}

/** 외부(원격) 전송 진행률 입력(registerExternalOperation 의 reportProgress 인자). */
export interface ExternalProgress {
  readonly processedBytes: number
  readonly totalBytes: number
  readonly processedItems: number
  readonly totalItems: number
  readonly currentName: string
}

export class OperationManager {
  private readonly ops = new Map<string, ActiveOp>()

  /** 통합 전송 큐 스케줄러(M7 W2 · ADR-011). 단발 동치: 기본 무한 동시성. */
  private readonly queue = new TransferQueue()

  /** queue:state 푸시 디바운스 타이머·구독 WebContents 집합. */
  private queueDebounce: NodeJS.Timeout | null = null
  private readonly queueSubscribers = new Set<WebContents>()

  /** operationId → 재시도 팩토리(같은 소스/대상으로 새 op 기동). failed 항목만 사용. */
  private readonly retryMeta = new Map<string, () => Result<{ operationId: string }>>()

  constructor() {
    // 큐 변경 시 디바운스 후 queue:state 푸시.
    this.queue.setOnChange(() => this.scheduleQueueEmit())
  }

  /** 번들된 워커 경로. out/main/fileOpWorker.js (index.js 와 동일 디렉토리). */
  private workerPath(): string {
    return join(__dirname, 'fileOpWorker.js')
  }

  // ──────────────────────────────────────────────────────────────────
  // 큐 스냅샷·디바운스 emit (queue:list / queue:state · ADR-011)
  // ──────────────────────────────────────────────────────────────────

  /** ActiveOp.lastProgress + startedAt → 속도/ETA 합성(TransferQueue.snapshot 주입). */
  private progressOf(operationId: string): ProgressSnapshot | null {
    const op = this.ops.get(operationId)
    if (!op) return null
    const lp = op.lastProgress
    const processedBytes = lp?.processedBytes ?? 0
    const totalBytes = lp?.totalBytes ?? op.totals.totalBytes
    const elapsedSec = Math.max(0.001, (Date.now() - op.startedAt) / 1000)
    const bytesPerSec = processedBytes > 0 ? processedBytes / elapsedSec : 0
    const remaining = totalBytes - processedBytes
    const etaSec = bytesPerSec > 0 && remaining > 0 ? remaining / bytesPerSec : null
    return {
      processedBytes,
      totalBytes,
      processedItems: lp?.processedItems ?? 0,
      totalItems: lp?.totalItems ?? op.totals.totalItems,
      bytesPerSec,
      etaSec
    }
  }

  /** 현재 큐 스냅샷(queue:list 응답·queue:state 페이로드). */
  buildQueueSnapshot(): QueueItemDTO[] {
    return this.queue.snapshot((id) => this.progressOf(id))
  }

  /** queue:state 디바운스 푸시 예약. */
  private scheduleQueueEmit(): void {
    if (this.queueDebounce) return
    this.queueDebounce = setTimeout(() => {
      this.queueDebounce = null
      this.emitQueueState()
    }, QUEUE_STATE_DEBOUNCE_MS)
  }

  private emitQueueState(): void {
    const items = this.buildQueueSnapshot()
    for (const wc of this.queueSubscribers) {
      if (wc.isDestroyed()) this.queueSubscribers.delete(wc)
      else wc.send(CHANNELS.QUEUE_STATE, { items })
    }
  }

  /** queue:list 시 구독 WebContents 등록(이후 변경 푸시 수신). */
  private trackSubscriber(wc: WebContents): void {
    this.queueSubscribers.add(wc)
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
    // 협조 플래그 버퍼 2워드(=cancel + pause, M7). 단발 경로는 pause(1) 미사용 → 동치.
    const cancelBuffer = new SharedArrayBuffer(
      Int32Array.BYTES_PER_ELEMENT * FLAG_WORD_COUNT
    )
    const cancelView = new Int32Array(cancelBuffer)

    const op: ActiveOp = {
      operationId,
      kind,
      state: 'running',
      wc,
      worker: null,
      cancelView,
      startedAt: Date.now(),
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

    // 실제 Worker 기동을 큐의 run 클로저로 분리(enqueue → pump). 단발 동치: 기본 무한
    // 동시성이라 enqueue 즉시 run() 호출(아래 동기 경로) → 기존 동작과 바이트 동치.
    let launchError: unknown = null
    const run = (): void => {
      op.startedAt = Date.now()
      let worker: Worker
      try {
        worker = new Worker(this.workerPath(), { workerData: job })
      } catch (e) {
        launchError = e
        // 기동 실패: 큐 항목·op·재시도 메타 모두 정리(기존 동작 동치 — 즉시 err 반환).
        this.queue.remove(operationId)
        this.retryMeta.delete(operationId)
        this.ops.delete(operationId)
        return
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
    }

    // 재시도 메타 보관(failed → retry 시 같은 소스/대상으로 새 op 재기동).
    this.retryMeta.set(operationId, () =>
      this.startWorker(randomUUID(), kind, sources, destDir, conflictPolicy, wc)
    )

    this.enqueueOp({
      operationId,
      kind,
      run,
      sourcesSummary: summarizeSources(sources),
      destSummary: destDir ?? '',
      setPauseFlag: (paused) =>
        Atomics.store(cancelView, PAUSE_FLAG_INDEX, paused ? 1 : 0)
    })

    // 기동 실패(즉시 실행 경로에서 new Worker throw)면 err 반환(기존 동작 보존).
    if (launchError !== null) return err(toFileOpError(launchError))
    return ok({ operationId })
  }

  /** 큐 항목 등록 헬퍼(enqueue → pump). */
  private enqueueOp(args: {
    operationId: string
    kind: QueueItemKind
    run: () => void
    sourcesSummary: string
    destSummary: string
    setPauseFlag: ((paused: boolean) => void) | null
    externalPause?: () => void
    externalResume?: () => void
  }): void {
    const entry: QueueEntry = {
      operationId: args.operationId,
      kind: args.kind,
      status: 'pending',
      enqueuedAt: Date.now(),
      run: args.run,
      sourcesSummary: args.sourcesSummary,
      destSummary: args.destSummary,
      setPauseFlag: args.setPauseFlag,
      ...(args.externalPause ? { externalPause: args.externalPause } : {}),
      ...(args.externalResume ? { externalResume: args.externalResume } : {})
    }
    this.queue.enqueue(entry)
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
      startedAt: Date.now(),
      lastProgress: null,
      totals: { totalItems: sources.length, totalBytes: 0 },
      throttleTimer: null,
      canceled: false,
      resolveDone: null
    }
    this.ops.set(operationId, op)

    // 실제 휴지통 이동을 큐 run 클로저로 분리(enqueue → pump). 단발 동치: 기본 무한
    // 동시성이라 enqueue 즉시 run() → 기존 동작과 동치.
    const run = (): void => {
      op.startedAt = Date.now()
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
            failures.push(await describeTrashFailure(src, e))
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
    }

    // trash 는 Main 직접 처리 — SharedArrayBuffer 일시정지 불가(setPauseFlag=null).
    this.retryMeta.set(operationId, () =>
      this.startTrashSync(randomUUID(), sources, wc)
    )
    this.enqueueOp({
      operationId,
      kind: 'trash',
      run,
      sourcesSummary: summarizeSources(sources),
      destSummary: '휴지통',
      setPauseFlag: null
    })

    return ok({ operationId })
  }

  /** retry 용 동기 래퍼(startTrash 는 async — Result 동기 반환 필요). */
  private startTrashSync(
    operationId: string,
    sources: string[],
    wc: WebContents
  ): Result<{ operationId: string }> {
    void this.startTrash(operationId, sources, wc)
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
    // Worker: 공유 취소 플래그 set(즉시 감지). pause 플래그도 해제해 일시정지 중이던
    //   워커가 awaitResume 루프를 빠져나와 취소를 관측하게 한다(파일 경계 일시정지).
    if (op.cancelView) {
      Atomics.store(op.cancelView, CANCEL_FLAG_INDEX, 1)
      Atomics.store(op.cancelView, PAUSE_FLAG_INDEX, 0)
      Atomics.notify(op.cancelView, PAUSE_FLAG_INDEX)
    }
    // 외부(원격 전송) op: 취소 훅 호출(스트림 destroy → 어댑터가 ECANCELED 로 종료).
    if (op.externalCancel) op.externalCancel()
    // 아직 실행 전(pending) 큐 항목이면 워커가 없으니 즉시 canceled 완료 처리.
    const entry = this.queue.get(operationId)
    if (entry && entry.status === 'pending' && !op.worker) {
      this.finish(op, {
        operationId,
        kind: op.kind,
        succeededItems: 0,
        failedItems: 0,
        canceled: true,
        failures: []
      })
    }
    return ok(undefined)
  }

  // ──────────────────────────────────────────────────────────────────
  // 큐 제어 (queue:* — ADR-011 결정②③④). 취소=기존 op:cancel, 진행률=op:progress.
  // ──────────────────────────────────────────────────────────────────

  /** queue:list — 현재 큐 스냅샷 + 이후 변경 푸시 구독 등록. */
  listQueue(wc: WebContents): Result<{ items: QueueItemDTO[] }> {
    this.trackSubscriber(wc)
    return ok({ items: this.buildQueueSnapshot() })
  }

  /** queue:pause — 항목 일시정지(running → paused, 파일 경계). */
  pauseQueueItem(operationId: string): Result<void> {
    if (!this.queue.has(operationId)) {
      return err(fileOpError('ENOENT', '해당 큐 항목을 찾을 수 없습니다.'))
    }
    if (!this.queue.pause(operationId)) {
      return err(fileOpError('EINVAL', '일시정지할 수 없는 상태입니다.'))
    }
    return ok(undefined)
  }

  /** queue:resume — 항목 재개(paused → running). */
  resumeQueueItem(operationId: string): Result<void> {
    if (!this.queue.has(operationId)) {
      return err(fileOpError('ENOENT', '해당 큐 항목을 찾을 수 없습니다.'))
    }
    if (!this.queue.resume(operationId)) {
      return err(fileOpError('EINVAL', '재개할 수 없는 상태입니다.'))
    }
    return ok(undefined)
  }

  /** queue:retry — 실패 항목 재시도(같은 소스/대상으로 새 op 재기동). */
  retryQueueItem(operationId: string): Result<void> {
    const factory = this.retryMeta.get(operationId)
    if (!factory) {
      return err(fileOpError('EINVAL', '재시도할 수 없는 항목입니다.'))
    }
    const holder: { result: Result<{ operationId: string }> | null } = { result: null }
    const newId = this.queue.retry(operationId, () => {
      const r = factory()
      holder.result = r
      return r.ok ? r.value.operationId : null
    })
    this.retryMeta.delete(operationId)
    if (newId === null) {
      const r = holder.result
      if (r && !r.ok) return r as Result<void>
      return err(fileOpError('EINVAL', '재시도에 실패했습니다.'))
    }
    return ok(undefined)
  }

  /** queue:set-concurrency — 전역 동시성 한도 갱신 후 즉시 pump. */
  setConcurrency(maxConcurrent: number): Result<void> {
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
      return err(fileOpError('EINVAL', '동시성 한도는 1 이상이어야 합니다.'))
    }
    this.queue.setConcurrency(maxConcurrent)
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

    // 큐 항목 종료 전이(슬롯 해제 → 다음 대기 항목 pump). 상태 분류:
    //   canceled → 'canceled', 부분/전체 실패(failedItems>0) → 'failed', 그 외 'done'.
    const queueStatus: 'done' | 'failed' | 'canceled' = summary.canceled
      ? 'canceled'
      : summary.failedItems > 0
        ? 'failed'
        : 'done'
    this.queue.complete(op.operationId, queueStatus)
    // 재시도 메타는 failed 일 때만 보존(retry 후 정리). 성공/취소는 제거.
    if (queueStatus !== 'failed') this.retryMeta.delete(op.operationId)

    this.ops.delete(op.operationId)
  }

  private push(wc: WebContents, channel: string, payload: unknown): void {
    if (!wc.isDestroyed()) wc.send(channel, payload)
  }

  // ──────────────────────────────────────────────────────────────────
  // robocopy 고속 미러(V3) — 폴더 비교 미러의 "복사" 측을 Windows robocopy 로 실행한다.
  //   외부 op 로 등록(registerExternalOperation 재사용) → 진행률 200ms 스로틀·op:cancel·
  //   op:done 규약을 그대로 탄다. /PURGE 없음(삭제 미수행 — 삭제는 trash op 가 undo 보존).
  //   복사분은 robocopy 가 복사 파일 집합을 앱이 정확히 추적하지 않으므로 undo 미제공
  //   (호출부 startRobocopyMirror 가 undoMeta 없이 registerOperation).
  // ──────────────────────────────────────────────────────────────────

  /** robocopy 복사-전용 미러 실행. win32 외 플랫폼은 즉시 err(폴백 없음 — 호출부도 검사). */
  startRobocopyMirror(
    srcDir: string,
    dstDir: string,
    expectedItems: number,
    wc: WebContents
  ): Result<{ operationId: string }> {
    if (process.platform !== 'win32') {
      return err(fileOpError('EUNKNOWN', 'robocopy 고속 미러는 Windows 에서만 지원됩니다.'))
    }
    let runner: RobocopyHandle | null = null
    // 외부 op 등록(취소 시 자식 프로세스 종료). 진행/완료/큐 표시는 기존 경로 재사용.
    const handle = this.registerExternalOperation('copy', wc, () => runner?.cancel())
    runner = runRobocopyCopy(srcDir, dstDir, (p) => {
      handle.reportProgress({
        processedBytes: p.copiedBytes,
        totalBytes: 0, // robocopy 총량 사전 불명 → 분모는 항목 수(expectedItems)로 표시.
        processedItems: p.copiedItems,
        totalItems: expectedItems,
        currentName: p.currentName
      })
    })
    void runner.promise.then((r) => {
      handle.finishOp({
        operationId: handle.operationId,
        kind: 'copy',
        succeededItems: r.copied,
        failedItems: r.failed ? 1 : 0,
        canceled: r.canceled,
        failures:
          r.failed && !r.canceled
            ? [{ path: srcDir, code: 'EUNKNOWN', message: r.errorMessage ?? 'robocopy 실패' }]
            : []
      })
    })
    return ok({ operationId: handle.operationId })
  }

  // ──────────────────────────────────────────────────────────────────
  // 외부(원격) 전송 등록 — CN-4: 원격 다운로드/업로드를 기존 op:* 스트림에 태운다.
  //   remoteTransfer 가 operationId 를 발급받아 자기 스트림을 굴리되, 진행률 200ms 스로틀·
  //   취소(op:cancel)·완료(op:done) 이벤트 규약을 OperationManager 가 재사용 제공한다.
  //   기존 로컬 op(Worker/trash) 로직은 무변경(비파괴 추가).
  // ──────────────────────────────────────────────────────────────────

  /**
   * 원격 전송용 operation 을 등록하고 operationId 를 발급한다(외부 구동 op).
   * - kind: 'copy'(다운로드)·'move'(업로드 의미상 — 1차는 copy 계열로 통일) 등 OpKind.
   * - onCancel: op:cancel 수신 시 호출(스트림 destroy·AbortSignal set 은 호출부 책임).
   * 반환 핸들로 호출부(remoteTransfer)가 진행률 보고·완료 통지를 한다.
   */
  registerExternalOperation(
    kind: OpKind,
    wc: WebContents,
    onCancel: () => void,
    /**
     * M7(선택·비파괴): 원격 전송 큐 표시·일시정지/재개 훅. 미지정이면 기존 동작 동치
     * (remoteTransfer 현행 3-arg 호출 보존). queueKind 는 큐 표시용(원격 다운/업로드).
     */
    queueOpts?: {
      readonly queueKind: QueueItemKind
      readonly sourcesSummary: string
      readonly destSummary: string
      readonly onPause: () => void
      readonly onResume: () => void
    }
  ): { operationId: string; reportProgress: (p: ExternalProgress) => void; finishOp: (summary: OpSummary) => void } {
    const operationId = randomUUID()
    const op: ActiveOp = {
      operationId,
      kind,
      state: 'running',
      wc,
      worker: null,
      cancelView: null,
      startedAt: Date.now(),
      lastProgress: null,
      totals: { totalItems: 0, totalBytes: 0 },
      throttleTimer: null,
      canceled: false,
      resolveDone: null
    }
    // 외부 취소 훅 보관(cancel() 가 호출).
    op.externalCancel = onCancel
    this.ops.set(operationId, op)
    // 진행률 200ms 스로틀(로컬 op 와 동일 경로 재사용).
    this.startThrottle(op)
    // 외부 op 도 큐에 등록(목록·일시정지/재개·동시성 표시). 실제 작업은 호출부가 이미
    // 구동하므로 run 은 no-op(슬롯만 점유) — 기존 즉시-시작 동작 동치. queueOpts 없으면
    // 기존 동작(큐 표시 없음) 보존하되, 큐 일관성을 위해 표시용 요약만 비워 등록한다.
    this.enqueueOp({
      operationId,
      kind: queueOpts?.queueKind ?? (kind as QueueItemKind),
      run: () => undefined,
      sourcesSummary: queueOpts?.sourcesSummary ?? '',
      destSummary: queueOpts?.destSummary ?? '',
      setPauseFlag: null,
      ...(queueOpts ? { externalPause: queueOpts.onPause } : {}),
      ...(queueOpts ? { externalResume: queueOpts.onResume } : {})
    })
    return {
      operationId,
      reportProgress: (p): void => {
        op.lastProgress = {
          processedBytes: p.processedBytes,
          totalBytes: p.totalBytes,
          processedItems: p.processedItems,
          totalItems: p.totalItems,
          currentName: p.currentName
        }
      },
      finishOp: (summary): void => this.finish(op, summary)
    }
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
