/**
 * ArchiveService — archive:extract/add 오케스트레이션 (§Q1 M9 · ADR-008 결정③).
 *
 * 추출/추가의 CPU 작업(inflate/deflate)을 **Worker Thread**(archiveWorker)로 오프로딩하고,
 * 진행률·취소·완료는 **신규 채널 없이 기존 op:* 스트림 재사용**한다(remote:download/upload 의
 * registerExternalOperation 선례 동형 — operationId 만 반환). HashManager 의 Worker 수명/취소
 * (SharedArrayBuffer)와 OperationManager 의 외부 op 등록을 결합한다.
 *
 *  - extract: zip → 로컬 destDir. 워커가 Zip Slip·심볼릭·폭탄을 격리(skip)하고 .part 원자 추출.
 *  - add: 로컬 → zip 재작성. 서비스가 디렉토리를 파일 항목으로 전개 + overwrite 정책 적용 후 워커 위임.
 *
 * 모든 반환 Result(throw 0). 워커 fatal/exit → op:done(실패 요약). op:cancel → cancelBuffer set.
 */
import * as fsp from 'node:fs/promises'
import { basename, join, relative } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Worker } from 'node:worker_threads'
import type { WebContents } from 'electron'
import type { OpSummary, OpFailure } from '@shared/dto'
import type { Result } from '@shared/ipc/contracts'
import { ok } from '@shared/ipc/contracts'
import { safeArchiveEntryName } from '@shared/archive/safePath'
import { toArchiveError } from './archiveErrors'
import { openZip } from './ZipReader'
import { CANCEL_FLAG_INDEX } from './archiveProtocol'
import type { ArchiveAddItem, ArchiveJob, ArchiveOutMsg } from './archiveProtocol'

/**
 * OperationManager 의 외부 op 등록 표면(주입 — verify 가 스텁). remote/remoteTransfer 의
 * OpRegistrar 와 동형(동일 op:* 스트림 재사용 규약).
 */
export interface OpRegistrar {
  registerExternalOperation(
    kind: 'copy' | 'move' | 'delete' | 'trash',
    wc: WebContents,
    onCancel: () => void
  ): {
    operationId: string
    reportProgress: (p: {
      processedBytes: number
      totalBytes: number
      processedItems: number
      totalItems: number
      currentName: string
    }) => void
    finishOp: (summary: OpSummary) => void
  }
}

/** zip 열기 함수 주입(add 의 동명 충돌 사전 해소용 엔트리 열거). verify 가 스텁. */
export type ZipOpener = (archivePath: string) => Promise<import('./ZipReader').ZipHandle>

export class ArchiveService {
  constructor(
    private readonly reg: OpRegistrar,
    private readonly opener: ZipOpener = openZip
  ) {}

  /** 번들된 워커 경로. out/main/archiveWorker.js (index.js 와 동일 디렉토리). */
  private workerPath(): string {
    return join(__dirname, 'archiveWorker.js')
  }

  /**
   * 추출(archive→local). operationId 즉시 반환, 진행률은 op:* 스트림. Zip Slip 은 워커가 강제.
   * @param archivePath 세션 매니저가 검증한 zip 절대경로.
   * @param innerPaths zip 내부 추출 대상(파일/폴더 prefix). 빈 배열이면 전체.
   * @param destDir 핸들러가 guardPath 검증한 로컬 도착 디렉토리.
   */
  startExtract(
    archivePath: string,
    innerPaths: string[],
    destDir: string,
    wc: WebContents
  ): Result<{ operationId: string }> {
    const cancelBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)
    const cancelView = new Int32Array(cancelBuffer)
    const handle = this.reg.registerExternalOperation('copy', wc, () =>
      Atomics.store(cancelView, CANCEL_FLAG_INDEX, 1)
    )

    const job: ArchiveJob = {
      jobId: randomUUID(),
      kind: 'extract',
      archivePath,
      innerPaths,
      destDir,
      cancelBuffer
    }
    this.spawn(job, handle, archivePath)
    return ok({ operationId: handle.operationId })
  }

  /**
   * 추가(local→archive 재작성). operationId 즉시 반환. 서비스가 ① 디렉토리를 파일 항목으로
   * 전개, ② 안전 엔트리명 산출(safeArchiveEntryName), ③ overwrite 정책으로 동명 기존 엔트리
   * 집합을 계산한 뒤 워커에 위임한다.
   * @param archivePath 세션 매니저가 검증한 zip 절대경로(재작성 대상).
   * @param localPaths 핸들러가 guardPath 검증한 로컬 소스(파일/폴더).
   * @param innerDir zip 내부 도착 폴더(POSIX 상대 · 루트면 '').
   * @param conflictPolicy 동명 충돌 정책('overwrite' 면 기존 엔트리 제외 후 신규로 대체).
   */
  startAdd(
    archivePath: string,
    localPaths: string[],
    innerDir: string,
    conflictPolicy: 'overwrite' | 'skip' | 'rename' | 'merge' | undefined,
    wc: WebContents
  ): Result<{ operationId: string }> {
    const cancelBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)
    const cancelView = new Int32Array(cancelBuffer)
    const handle = this.reg.registerExternalOperation('copy', wc, () =>
      Atomics.store(cancelView, CANCEL_FLAG_INDEX, 1)
    )

    // 비동기 준비(디렉토리 전개·충돌 집합) 후 워커 스폰. operationId 는 즉시 반환.
    void (async () => {
      try {
        const items = await expandAddItems(localPaths, innerDir)
        if (items.length === 0) {
          handle.finishOp(this.emptySummary(handle.operationId, false))
          return
        }
        const skipExisting = await this.computeSkipExisting(
          archivePath,
          items,
          conflictPolicy ?? 'rename'
        )
        const job: ArchiveJob = {
          jobId: randomUUID(),
          kind: 'add',
          archivePath,
          addItems: items,
          skipExisting,
          cancelBuffer
        }
        this.spawn(job, handle, archivePath)
      } catch (e) {
        handle.finishOp({
          operationId: handle.operationId,
          kind: 'copy',
          succeededItems: 0,
          failedItems: 1,
          canceled: false,
          failures: [
            {
              path: archivePath,
              code: toArchiveError(e).code,
              message: toArchiveError(e).message
            }
          ]
        })
      }
    })()

    return ok({ operationId: handle.operationId })
  }

  // ── 내부 ────────────────────────────────────────────────────────────

  /** 워커 스폰 + 메시지 → op:* 중계. 실패/exit 시 op:done(실패 요약). */
  private spawn(
    job: ArchiveJob,
    handle: ReturnType<OpRegistrar['registerExternalOperation']>,
    archivePath: string
  ): void {
    let worker: Worker
    try {
      worker = new Worker(this.workerPath(), { workerData: job })
    } catch (e) {
      handle.finishOp({
        operationId: handle.operationId,
        kind: 'copy',
        succeededItems: 0,
        failedItems: 1,
        canceled: false,
        failures: [{ path: archivePath, code: toArchiveError(e).code, message: toArchiveError(e).message }]
      })
      return
    }

    const failures: OpFailure[] = []
    let done = false

    const finish = (summary: OpSummary): void => {
      if (done) return
      done = true
      void worker.terminate().catch(() => undefined)
      handle.finishOp(summary)
    }

    worker.on('message', (msg: ArchiveOutMsg) => {
      switch (msg.type) {
        case 'progress':
          handle.reportProgress({
            processedBytes: msg.processedBytes,
            totalBytes: msg.totalBytes,
            processedItems: msg.processedItems,
            totalItems: msg.totalItems,
            currentName: msg.currentName
          })
          break
        case 'skip':
          failures.push({ path: msg.entryName, code: msg.code, message: msg.message })
          break
        case 'done':
          finish({
            operationId: handle.operationId,
            kind: 'copy',
            succeededItems: msg.succeededItems,
            failedItems: failures.length,
            canceled: msg.canceled,
            failures
          })
          break
        case 'fatal':
          failures.push({
            path: msg.path ?? archivePath,
            code: msg.code,
            message: msg.message
          })
          finish({
            operationId: handle.operationId,
            kind: 'copy',
            succeededItems: 0,
            failedItems: failures.length,
            canceled: false,
            failures
          })
          break
      }
    })

    worker.on('error', (e) => {
      failures.push({ path: archivePath, code: toArchiveError(e).code, message: toArchiveError(e).message })
      finish({
        operationId: handle.operationId,
        kind: 'copy',
        succeededItems: 0,
        failedItems: failures.length,
        canceled: false,
        failures
      })
    })

    worker.on('exit', () => {
      if (!done) {
        finish({
          operationId: handle.operationId,
          kind: 'copy',
          succeededItems: 0,
          failedItems: failures.length + 1,
          canceled: false,
          failures: [
            ...failures,
            { path: archivePath, code: 'EUNKNOWN', message: '압축 워커가 비정상 종료되었습니다.' }
          ]
        })
      }
    })
  }

  /**
   * overwrite 정책일 때 신규 엔트리명과 동명인 기존 zip 엔트리명 집합을 계산한다(재작성 시 제외).
   * 그 외 정책은 빈 집합(yazl 이 동명을 둘 다 보존 — 1차 단순화 · merge/rename/skip 동치 취급).
   */
  private async computeSkipExisting(
    archivePath: string,
    items: readonly ArchiveAddItem[],
    policy: 'overwrite' | 'skip' | 'rename' | 'merge'
  ): Promise<string[]> {
    if (policy !== 'overwrite') return []
    let handle: import('./ZipReader').ZipHandle
    try {
      handle = await this.opener(archivePath)
    } catch {
      return [] // 열기 실패는 워커가 재작성 시 fatal 로 보고.
    }
    const existing = new Set(handle.entries.map((e) => e.entryName))
    await handle.close().catch(() => undefined)
    const newNames = new Set(items.map((it) => it.entryName))
    return [...existing].filter((name) => newNames.has(name))
  }

  private emptySummary(operationId: string, canceled: boolean): OpSummary {
    return {
      operationId,
      kind: 'copy',
      succeededItems: 0,
      failedItems: 0,
      canceled,
      failures: []
    }
  }
}

/**
 * 로컬 소스(파일/폴더)를 zip 추가용 파일 항목(ArchiveAddItem)으로 전개한다.
 *  - 파일: innerDir/basename 으로 1개.
 *  - 폴더: 재귀 전개 — innerDir/folderName/<relpath> 로 하위 파일들. 빈 폴더는 1차 생략(yazl
 *    addEmptyDirectory 미사용 — 파일 단위 추가).
 * 각 엔트리명은 safeArchiveEntryName 으로 새니타이즈(악성 경로 차단). 실패 항목은 제외.
 */
async function expandAddItems(
  localPaths: readonly string[],
  innerDir: string
): Promise<ArchiveAddItem[]> {
  const out: ArchiveAddItem[] = []
  for (const src of localPaths) {
    let st: import('node:fs').Stats
    try {
      st = await fsp.stat(src)
    } catch {
      continue // 없음/권한 — 격리.
    }
    if (st.isDirectory()) {
      const folderName = basename(src)
      await walkDir(src, async (filePath, size) => {
        const rel = relative(src, filePath).replace(/\\/g, '/')
        const safe = safeArchiveEntryName(innerDir, `${folderName}/${rel}`)
        if (safe.ok) out.push({ entryName: safe.path, localPath: filePath, size })
      })
    } else if (st.isFile()) {
      const safe = safeArchiveEntryName(innerDir, basename(src))
      if (safe.ok) out.push({ entryName: safe.path, localPath: src, size: st.size })
    }
  }
  return out
}

/** 디렉토리 재귀 순회 — 각 파일에 (절대경로, 크기) 콜백. 심볼릭/오류 항목은 격리. */
async function walkDir(
  dir: string,
  onFile: (filePath: string, size: number) => Promise<void>
): Promise<void> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const ent of entries) {
    const full = join(dir, ent.name)
    if (ent.isSymbolicLink()) continue // 링크 추종 안 함(추출 정신과 대칭).
    if (ent.isDirectory()) {
      await walkDir(full, onFile)
    } else if (ent.isFile()) {
      try {
        const st = await fsp.stat(full)
        await onFile(full, st.size)
      } catch {
        /* 격리 */
      }
    }
  }
}
