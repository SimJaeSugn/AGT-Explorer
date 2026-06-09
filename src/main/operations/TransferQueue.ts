/**
 * TransferQueue — op:* 통합 전송 큐 스케줄러 (M7 W2 · ADR-011).
 *
 * OperationManager 의 내부 스케줄러 계층(전면 교체 아님·비파괴 확장). 모든 작업
 * (로컬 copy/move/delete/trash · 원격 download/upload) 은 큐 항목(QueueEntry)이 되어
 * FIFO·전역 동시성 한도(maxConcurrent) 안에서 실행된다. 큐 항목 식별자는 기존
 * `operationId` 를 그대로 쓴다(새 식별 체계 없음 — 진행률·충돌·완료가 기존 op:* 스트림
 * 으로 자연 흐름).
 *
 * 핵심 불변(회귀 0 — 계획서 리스크②):
 *  - **enqueue → pump 분리만** 한다. 실제 실행 로직(run 클로저)은 무변경.
 *  - **단발 동치**: maxConcurrent ≥ 활성 수면 enqueue 즉시 run() → 기존 동작과 바이트 동치.
 *    기본값 Number.MAX_SAFE_INTEGER(= 무한) 로 두면 큐 도입 전과 정확히 동일하게 즉시 실행.
 *  - 진행률/취소/충돌은 OperationManager 의 기존 ActiveOp 경로 재사용(큐는 상태/순서만 관리).
 *
 * 일시정지(파일 경계): pause(operationId) 는 항목 status=paused + SharedArrayBuffer
 * pause 플래그 set(워커가 다음 파일 경계에서 대기). resume 은 역. 실행 슬롯은 점유 유지
 * (일시정지는 "멈춤"이지 "대기열 반환"이 아님 — 재개 즉시 계속). 동시성 산정 시
 * running·paused 모두 활성으로 센다(슬롯 점유).
 *
 * 이 모듈은 fs/Worker 를 직접 만지지 않는다 → verify 가 run 클로저를 mock 으로 주입해
 * 헤드리스 검증한다(verify:queue).
 *
 * throw 금지(ADR-003) — 미지의 operationId 등은 boolean/no-op 으로 격리.
 */
import type { QueueItemDTO, QueueItemKind, QueueItemStatus } from '@shared/dto'

/** 큐 항목 1건(내부). 진행률은 OperationManager.ActiveOp 가 보유(여기선 상태/메타만). */
export interface QueueEntry {
  readonly operationId: string
  readonly kind: QueueItemKind
  status: QueueItemStatus
  readonly enqueuedAt: number
  /** 실제 실행 트리거(startWorker/startTrash/externalOp 구동 클로저). pump 가 1회 호출. */
  readonly run: () => void
  readonly sourcesSummary: string
  readonly destSummary: string
  /** 일시정지 플래그 set/clear(워커 SharedArrayBuffer[1]). 외부 op·trash 는 null. */
  setPauseFlag: ((paused: boolean) => void) | null
  /** 원격 스트림 등 외부 일시정지 훅(있으면 우선). */
  externalPause?: () => void
  externalResume?: () => void
}

/** 진행률 스냅샷 조회(OperationManager 가 주입 — DTO 합성용). */
export interface ProgressSnapshot {
  readonly processedBytes: number
  readonly totalBytes: number
  readonly processedItems: number
  readonly totalItems: number
  readonly bytesPerSec: number
  readonly etaSec: number | null
}

/** 활성으로 간주하는 상태(실행 슬롯 점유). */
function isActiveStatus(s: QueueItemStatus): boolean {
  return s === 'running' || s === 'paused'
}

/** 종료 상태(슬롯 해제·재시도 가능 후보는 failed). */
function isTerminalStatus(s: QueueItemStatus): boolean {
  return s === 'done' || s === 'failed' || s === 'canceled'
}

export class TransferQueue {
  private readonly entries = new Map<string, QueueEntry>()
  /** FIFO 순서 보존(enqueue 순). */
  private order: string[] = []
  /**
   * 동시 실행 한도. 기본 무한 → 단발 동치(즉시 실행). queue:set-concurrency 로 갱신.
   * (OperationManager 가 명시적 큐 모드를 켤 때만 유한값 사용.)
   */
  private maxConcurrent = Number.MAX_SAFE_INTEGER

  /** 큐 변경 통지(디바운스 emit·OperationManager 가 주입). */
  private onChange: (() => void) | null = null

  setOnChange(cb: () => void): void {
    this.onChange = cb
  }

  getMaxConcurrent(): number {
    return this.maxConcurrent
  }

  /** 동시성 한도 설정 후 즉시 pump(여유 슬롯만큼 대기 항목 실행). */
  setConcurrency(maxConcurrent: number): void {
    this.maxConcurrent = Math.max(1, Math.floor(maxConcurrent))
    this.pump()
    this.notify()
  }

  /** 활성(running+paused) 항목 수 — 슬롯 점유. */
  private activeCount(): number {
    let n = 0
    for (const id of this.order) {
      const e = this.entries.get(id)
      if (e && isActiveStatus(e.status)) n++
    }
    return n
  }

  /**
   * 항목 등록 후 스케줄(enqueue → pump). 등록 직후 한도 여유가 있으면 같은 tick 에
   * run() 이 호출된다(단발 동치). 식별자 중복(operationId) 은 무시(멱등).
   */
  enqueue(entry: QueueEntry): void {
    if (this.entries.has(entry.operationId)) return
    this.entries.set(entry.operationId, entry)
    this.order.push(entry.operationId)
    this.pump()
    this.notify()
  }

  /**
   * 스케줄러 코어: FIFO 로 pending 항목을 한도 여유만큼 running 전이 + run() 호출.
   * paused 는 슬롯 점유(활성)로 세므로 pump 가 새로 깨우지 않는다.
   */
  pump(): void {
    for (const id of this.order) {
      if (this.activeCount() >= this.maxConcurrent) break
      const e = this.entries.get(id)
      if (!e || e.status !== 'pending') continue
      e.status = 'running'
      // run 클로저는 동기적으로 워커/스트림을 띄우고 반환(실제 완료는 finish 콜백).
      e.run()
    }
  }

  /** 일시정지: running → paused + 플래그 set(파일 경계에서 워커 대기). */
  pause(operationId: string): boolean {
    const e = this.entries.get(operationId)
    if (!e || e.status !== 'running') return false
    e.status = 'paused'
    if (e.externalPause) e.externalPause()
    else if (e.setPauseFlag) e.setPauseFlag(true)
    this.notify()
    return true
  }

  /** 재개: paused → running + 플래그 clear. 슬롯은 계속 점유했으므로 pump 불필요. */
  resume(operationId: string): boolean {
    const e = this.entries.get(operationId)
    if (!e || e.status !== 'paused') return false
    e.status = 'running'
    if (e.externalResume) e.externalResume()
    else if (e.setPauseFlag) e.setPauseFlag(false)
    this.notify()
    return true
  }

  /**
   * 완료 전이(OperationManager.finish 가 호출). 종료 상태로 두고 슬롯 해제 후 pump
   * (다음 대기 항목 실행). canceled/failed/done 구분.
   */
  complete(operationId: string, status: 'done' | 'failed' | 'canceled'): void {
    const e = this.entries.get(operationId)
    if (!e || isTerminalStatus(e.status)) return
    e.status = status
    this.pump()
    this.notify()
  }

  /**
   * 재시도: failed 항목을 factory 로 같은 소스/대상으로 재기동(새 operationId).
   * factory 는 OperationManager 가 startWorker/startTrash/external 를 다시 호출해
   * **새 QueueEntry 를 스스로 enqueue** 하고 새 operationId 를 반환한다. 여기선 원래
   * 실패 항목만 제거(중복 표시 방지) + factory 호출. 반환=새 operationId(실패 시 null).
   */
  retry(operationId: string, factory: () => string | null): string | null {
    const e = this.entries.get(operationId)
    if (!e || e.status !== 'failed') return null
    this.remove(operationId)
    return factory()
  }

  /** 큐에서 항목 제거(완료 dismiss·retry 시 원본 제거). */
  remove(operationId: string): void {
    if (!this.entries.has(operationId)) return
    this.entries.delete(operationId)
    this.order = this.order.filter((id) => id !== operationId)
    this.notify()
  }

  /** 취소 표식(op:cancel 경로). complete('canceled') 는 finish 에서 별도 호출. */
  has(operationId: string): boolean {
    return this.entries.has(operationId)
  }

  get(operationId: string): QueueEntry | undefined {
    return this.entries.get(operationId)
  }

  /**
   * 큐 스냅샷(queue:list / queue:state). FIFO 순서 유지. 진행률은 주입 함수로 합성
   * (OperationManager 의 ActiveOp.lastProgress 재사용). 미존재 진행률은 0.
   */
  snapshot(getProgress: (operationId: string) => ProgressSnapshot | null): QueueItemDTO[] {
    const out: QueueItemDTO[] = []
    for (const id of this.order) {
      const e = this.entries.get(id)
      if (!e) continue
      const p = getProgress(id)
      out.push({
        operationId: e.operationId,
        kind: e.kind,
        status: e.status,
        sourcesSummary: e.sourcesSummary,
        destSummary: e.destSummary,
        processedBytes: p?.processedBytes ?? 0,
        totalBytes: p?.totalBytes ?? 0,
        processedItems: p?.processedItems ?? 0,
        totalItems: p?.totalItems ?? 0,
        bytesPerSec: p?.bytesPerSec ?? 0,
        etaSec: p?.etaSec ?? null,
        enqueuedAt: e.enqueuedAt
      })
    }
    return out
  }

  private notify(): void {
    if (this.onChange) this.onChange()
  }
}

/** OpKind → QueueItemKind 매핑(trash 포함·원격은 호출부가 명시). */
export function opKindToQueueKind(kind: QueueItemKind): QueueItemKind {
  return kind
}
