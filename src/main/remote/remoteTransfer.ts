/**
 * remoteTransfer — 원격 다운로드/업로드 오케스트레이션 (§M M3 · ADR-007 결정⑤⑥-7 · CN-4).
 *
 * - 진행률·취소·완료는 **신규 채널 없이 기존 op:* 스트림 재사용**(CN-4): OperationManager 의
 *   `registerExternalOperation` 으로 operationId 를 발급받아 reportProgress(200ms 스로틀 경유)·
 *   finishOp(op:done) 를 호출하고, op:cancel 은 onCancel 훅으로 AbortSignal 을 set 한다.
 * - **부분 전송 안전(ADR-007 ⑥-7)**: 다운로드는 `<dest>.part` 임시명으로 받은 뒤 완료 시
 *   원자적 rename → 불완전 파일이 완료본으로 오인되지 않게 한다. 취소/실패 시 .part 정리.
 * - **신뢰경계(ADR-007 ⑥)**: 원격 파일명 새니타이즈 + 로컬 도착지 하위 이탈(Zip Slip) 차단은
 *   safeLocalDestPath(remotePath.ts)로 강제. 도착지 밖이면 해당 항목 격리(skip).
 *
 * 이 모듈은 어댑터(RemoteAdapter)를 RemoteSessionManager.getAdapter 로 받아 구동한다 —
 * 라이브러리를 직접 import 하지 않는다(어댑터 캡슐화).
 */
import * as fsp from 'node:fs/promises'
import { posix, win32 } from 'node:path'
import type { WebContents } from 'electron'
import type { OpSummary, OpFailure, ConflictPolicy } from '@shared/dto'
import type { Result } from '@shared/ipc/contracts'
import { err, ok } from '@shared/ipc/contracts'
import type { CancelSignal, RemoteAdapter, RemoteError } from './RemoteService'
import { remoteError } from './remoteErrors'
import { safeLocalDestPath } from './remotePath'

/** OperationManager 의 외부 op 등록 표면(주입 — verify 가 스텁). */
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

/** 취소 가능한 신호(AbortController 의 aborted 만 노출). */
class MutableCancel implements CancelSignal {
  aborted = false
  abort(): void {
    this.aborted = true
  }
}

/**
 * 다운로드 실행: 원격 파일들 → 로컬 destDir. operationId 즉시 반환, 진행률은 op:* 스트림.
 *  - 각 원격 파일명을 새니타이즈 + 도착지 하위 검증(safeLocalDestPath).
 *  - `.part` 임시명 → 완료 시 원자 rename.
 *  - 취소(op:cancel)→ AbortSignal set → 어댑터 스트림 destroy → .part 정리.
 */
async function localPathExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p)
    return true
  } catch {
    return false
  }
}

/** 동명 충돌 시 `name (1).ext` … 로 유니크 로컬 경로 산출(rename 정책). */
async function uniqueLocalPath(p: string): Promise<string> {
  const dir = win32.dirname(p)
  const ext = win32.extname(p)
  const base = win32.basename(p, ext)
  for (let i = 1; i < 10000; i++) {
    const cand = win32.join(dir, `${base} (${i})${ext}`)
    if (!(await localPathExists(cand))) return cand
  }
  return win32.join(dir, `${base} (${Date.now()})${ext}`)
}

export function startDownload(
  adapter: RemoteAdapter,
  remotePaths: string[],
  destDir: string,
  wc: WebContents,
  reg: OpRegistrar,
  conflictPolicy?: ConflictPolicy
): Result<{ operationId: string }, RemoteError> {
  if (remotePaths.length === 0) return err(remoteError('ENOENT', destDir))

  const cancel = new MutableCancel()
  const handle = reg.registerExternalOperation('copy', wc, () => cancel.abort())

  // 비동기로 진행(즉시 operationId 반환).
  void (async () => {
    const failures: OpFailure[] = []
    let succeeded = 0
    // 완료된 파일들의 누적 바이트(진행률 표시용). 현재 파일은 transferred 를 더한다.
    let baseBytes = 0
    for (let i = 0; i < remotePaths.length; i++) {
      if (cancel.aborted) break
      const remotePath = remotePaths[i] as string
      const name = posix.basename(remotePath)
      const dest = safeLocalDestPath(destDir, name)
      if (!dest.ok) {
        failures.push({ path: remotePath, code: 'ESECURITY', message: '도착지 이탈 차단' })
        continue
      }
      // 충돌 정책: 도착지 존재 시 skip(건너뜀)·rename(유니크명). overwrite/merge/미지정은 덮어쓰기.
      let finalPath = dest.path
      if (await localPathExists(dest.path)) {
        if (conflictPolicy === 'skip') continue
        if (conflictPolicy === 'rename') finalPath = await uniqueLocalPath(dest.path)
      }
      const partPath = `${finalPath}.part`
      let lastTransferred = 0
      const r = await adapter.download(
        remotePath,
        partPath,
        (transferred) => {
          lastTransferred = transferred
          handle.reportProgress({
            processedBytes: baseBytes + transferred,
            totalBytes: 0,
            processedItems: i,
            totalItems: remotePaths.length,
            currentName: name
          })
        },
        cancel
      )
      if (!r.ok) {
        await fsp.rm(partPath, { force: true }).catch(() => undefined)
        failures.push({ path: remotePath, code: r.error.code, message: r.error.message })
        continue
      }
      // 완료 → 원자적 rename(.part → 최종). 불완전 파일 완료본 오인 방지.
      try {
        await fsp.rename(partPath, finalPath)
        succeeded++
        baseBytes += lastTransferred
      } catch {
        await fsp.rm(partPath, { force: true }).catch(() => undefined)
        failures.push({ path: remotePath, code: 'EUNKNOWN', message: '파일 확정 실패' })
      }
    }
    handle.finishOp({
      operationId: handle.operationId,
      kind: 'copy',
      succeededItems: succeeded,
      failedItems: failures.length,
      canceled: cancel.aborted,
      failures
    })
  })()

  return ok({ operationId: handle.operationId })
}

/**
 * 업로드 실행: 로컬 파일들 → 원격 remoteDir. operationId 즉시 반환, 진행률은 op:* 스트림.
 * 로컬 소스는 핸들러가 guardPath 로 검증한 절대경로 전제. 원격 경로는 POSIX join.
 */
export function startUpload(
  adapter: RemoteAdapter,
  localPaths: string[],
  remoteDir: string,
  wc: WebContents,
  reg: OpRegistrar
): Result<{ operationId: string }, RemoteError> {
  if (localPaths.length === 0) return err(remoteError('ENOENT', remoteDir))

  const cancel = new MutableCancel()
  const handle = reg.registerExternalOperation('copy', wc, () => cancel.abort())

  void (async () => {
    const failures: OpFailure[] = []
    let succeeded = 0
    let baseBytes = 0
    for (let i = 0; i < localPaths.length; i++) {
      if (cancel.aborted) break
      const localPath = localPaths[i] as string
      const name = win32.basename(localPath)
      const remotePath = posix.join(remoteDir, name)
      let lastTransferred = 0
      const r = await adapter.upload(
        localPath,
        remotePath,
        (transferred) => {
          lastTransferred = transferred
          handle.reportProgress({
            processedBytes: baseBytes + transferred,
            totalBytes: 0,
            processedItems: i,
            totalItems: localPaths.length,
            currentName: name
          })
        },
        cancel
      )
      if (!r.ok) {
        failures.push({ path: localPath, code: r.error.code, message: r.error.message })
        continue
      }
      succeeded++
      baseBytes += lastTransferred
    }
    handle.finishOp({
      operationId: handle.operationId,
      kind: 'copy',
      succeededItems: succeeded,
      failedItems: failures.length,
      canceled: cancel.aborted,
      failures
    })
  })()

  return ok({ operationId: handle.operationId })
}
