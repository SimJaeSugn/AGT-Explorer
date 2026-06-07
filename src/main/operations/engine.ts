/**
 * 파일 작업 엔진 — 재귀 copy/move/delete 의 핵심 로직 (P4, SA §4.1).
 *
 * 환경 비의존(environment-agnostic): 진행/충돌/취소/실패 보고를 모두
 * 콜백(EngineHooks)으로 받는다. 그래서 (a) Worker Thread 안에서 실제 작업으로,
 * (b) 검증 스크립트에서 메인 스레드 직접 호출로 동일하게 돌릴 수 있다.
 *
 * 설계 포인트:
 *  - move = 같은 볼륨 rename(빠름) / 다른 볼륨 copy+delete. fs.rename 의 EXDEV 로 판별.
 *  - 재귀 디렉토리: 폴더는 mkdir 후 자식 재귀, "폴더 병합"은 기존 폴더 유지+자식 재충돌.
 *  - 진행률: 64KB~256KB 청크 스트림 복사로 누적 바이트 보고(200ms 스로틀은 상위에서).
 *  - 취소: shouldCancel() 협조 폴링 — 파일/청크 경계에서 중단. 부분 복사분은
 *    "진행 중 항목"만 정리(unlink), 이미 끝난 항목은 유지(안전 정책).
 *  - 충돌: 대상 동명 존재 시 resolveConflict() 로 정책 질의(overwrite/skip/rename/merge).
 *  - 실패 격리: 개별 항목 실패는 onFailure 누적 후 계속(부분 실패 보고).
 *
 * throw 금지 — 작업 항목 단위 오류는 FileOpError 로 변환해 누적한다.
 */
import { constants as fsConstants, createReadStream, createWriteStream } from 'node:fs'
import * as fsp from 'node:fs/promises'
import { win32 } from 'node:path'
import type { ConflictResolution, FileOpErrorCode, OpFailure } from '@shared/dto'
import { toFileOpError } from '../fs/errors'
import { nextAvailablePath } from './conflict'

/** 진행률 스트림 복사 청크(256KB). */
const COPY_CHUNK = 256 * 1024

/** 엔진이 상위(Worker/검증)에 보고/질의하는 훅. */
export interface EngineHooks {
  /** 사전 집계 완료(총 항목/바이트). 진행률 분모. */
  onTotals(totalItems: number, totalBytes: number): void
  /** 누적 진행 보고(델타 아님 — 누적값). 상위에서 200ms 스로틀. */
  onProgress(processedBytes: number, processedItems: number, currentName: string): void
  /** 개별 실패 누적. */
  onFailure(failure: OpFailure): void
  /**
   * 충돌 해소 질의. 대상에 동명 존재 시 호출. 정책 반환까지 await.
   * applyToAll 처리는 상위(Worker)가 담당하고, 엔진엔 최종 resolution 만 돌려준다.
   */
  resolveConflict(args: {
    sourcePath: string
    targetPath: string
    sourceSize: number
    sourceMtime: number
    sourceIsDir: boolean
    targetSize: number
    targetMtime: number
    targetIsDir: boolean
  }): Promise<ConflictResolution>
  /** 협조적 취소 폴링. true 면 안전 지점에서 중단. */
  shouldCancel(): boolean
}

export interface EngineResult {
  succeededItems: number
  failedItems: number
  canceled: boolean
  failures: OpFailure[]
}

interface Counters {
  bytes: number
  items: number
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

/** 소스 트리의 총 항목 수/바이트를 사전 집계(진행률 분모). 접근 실패는 0 으로 무시. */
async function aggregate(sources: string[]): Promise<{ items: number; bytes: number }> {
  let items = 0
  let bytes = 0
  const walk = async (p: string): Promise<void> => {
    let st: import('node:fs').Stats
    try {
      st = await fsp.lstat(p)
    } catch {
      return
    }
    items++
    if (st.isDirectory()) {
      let kids: string[] = []
      try {
        kids = await fsp.readdir(p)
      } catch {
        return
      }
      for (const k of kids) await walk(win32.join(p, k))
    } else {
      bytes += st.size
    }
  }
  for (const s of sources) await walk(s)
  return { items, bytes }
}

/** 청크 스트림 복사(진행 보고). 취소 시 부분 파일 정리. */
async function copyFileStreamed(
  src: string,
  dest: string,
  counters: Counters,
  hooks: EngineHooks,
  name: string
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const rs = createReadStream(src, { highWaterMark: COPY_CHUNK })
    const ws = createWriteStream(dest)
    let aborted = false
    const cleanup = (err?: Error): void => {
      if (aborted) return
      aborted = true
      rs.destroy()
      ws.destroy()
      if (err) reject(err)
      else resolve()
    }
    rs.on('error', cleanup)
    ws.on('error', cleanup)
    rs.on('data', (chunk: string | Buffer) => {
      if (hooks.shouldCancel()) {
        cleanup(Object.assign(new Error('canceled'), { code: 'ECANCELED' }))
        return
      }
      counters.bytes += chunk.length
      hooks.onProgress(counters.bytes, counters.items, name)
    })
    ws.on('finish', () => cleanup())
    rs.pipe(ws)
  })
  // 메타데이터(수정시각) 보존 — 베스트에포트.
  try {
    const st = await fsp.stat(src)
    await fsp.utimes(dest, st.atime, st.mtime)
  } catch {
    /* 베스트에포트 */
  }
}

/** 단일 항목(파일/폴더) 복사. 충돌 해소·재귀·취소 처리. */
async function copyEntry(
  src: string,
  destDir: string,
  name: string,
  isMove: boolean,
  counters: Counters,
  result: EngineResult,
  hooks: EngineHooks
): Promise<void> {
  if (hooks.shouldCancel()) {
    result.canceled = true
    return
  }

  let st: import('node:fs').Stats
  try {
    st = await fsp.lstat(src)
  } catch (e) {
    pushFailure(result, hooks, src, e)
    return
  }

  let destPath = win32.join(destDir, name)
  let merge = false

  if (await pathExists(destPath)) {
    // 충돌 — 정책 질의.
    let tStat: import('node:fs').Stats | null = null
    try {
      tStat = await fsp.lstat(destPath)
    } catch {
      tStat = null
    }
    const resolution = await hooks.resolveConflict({
      sourcePath: src,
      targetPath: destPath,
      sourceSize: st.isFile() ? st.size : 0,
      sourceMtime: Math.trunc(st.mtimeMs),
      sourceIsDir: st.isDirectory(),
      targetSize: tStat?.isFile() ? tStat.size : 0,
      targetMtime: tStat ? Math.trunc(tStat.mtimeMs) : 0,
      targetIsDir: tStat ? tStat.isDirectory() : false
    })

    if (resolution === 'skip') {
      return
    } else if (resolution === 'rename') {
      destPath = await nextAvailablePath(destDir, name, pathExists)
    } else if (resolution === 'merge') {
      // 폴더 병합: 폴더면 기존 유지하고 자식 재귀(아래). 파일이면 overwrite 와 동일.
      merge = st.isDirectory() && (tStat?.isDirectory() ?? false)
    }
    // overwrite: 파일이면 그대로 destPath 에 덮어쓴다(아래에서 기존 제거).
  }

  if (st.isDirectory()) {
    // 폴더: mkdir(병합이면 기존 유지) 후 자식 재귀.
    try {
      if (!merge) {
        await fsp.mkdir(destPath, { recursive: true })
      } else if (!(await pathExists(destPath))) {
        await fsp.mkdir(destPath, { recursive: true })
      }
    } catch (e) {
      pushFailure(result, hooks, src, e)
      return
    }
    counters.items++
    hooks.onProgress(counters.bytes, counters.items, name)
    result.succeededItems++

    let kids: string[]
    try {
      kids = await fsp.readdir(src)
    } catch (e) {
      pushFailure(result, hooks, src, e)
      return
    }
    for (const k of kids) {
      if (hooks.shouldCancel()) {
        result.canceled = true
        return
      }
      await copyEntry(win32.join(src, k), destPath, k, isMove, counters, result, hooks)
    }
    // move: 자식까지 복사 끝났으면 원본 폴더 제거.
    if (isMove && !result.canceled) {
      try {
        await fsp.rm(src, { recursive: true, force: true })
      } catch (e) {
        pushFailure(result, hooks, src, e)
      }
    }
  } else {
    // 파일: 덮어쓰기면 기존 제거 후 스트림 복사.
    try {
      if (await pathExists(destPath)) {
        await chmodWritable(destPath)
        await fsp.rm(destPath, { force: true })
      }
      await copyFileStreamed(src, destPath, counters, hooks, name)
      counters.items++
      result.succeededItems++
      hooks.onProgress(counters.bytes, counters.items, name)
      if (isMove) {
        await chmodWritable(src)
        await fsp.rm(src, { force: true })
      }
    } catch (e) {
      // 취소로 인한 중단: 부분 파일 정리.
      const fe = toFileOpError(e, src)
      if (fe.code === 'ECANCELED' || (e as { code?: string })?.code === 'ECANCELED') {
        await fsp.rm(destPath, { force: true }).catch(() => undefined)
        result.canceled = true
        return
      }
      pushFailure(result, hooks, src, e)
    }
  }
}

/** 읽기전용 비트 해제 시도(덮어쓰기/삭제 전). 베스트에포트. */
async function chmodWritable(p: string): Promise<void> {
  try {
    await fsp.chmod(p, 0o666)
  } catch {
    /* 베스트에포트 */
  }
}

function pushFailure(result: EngineResult, hooks: EngineHooks, path: string, e: unknown): void {
  const fe = toFileOpError(e, path)
  const code: FileOpErrorCode = fe.code
  const failure: OpFailure = { path, code, message: fe.message }
  result.failures.push(failure)
  result.failedItems++
  hooks.onFailure(failure)
}

// ────────────────────────────────────────────────────────────────────────
// 공개 엔진 API
// ────────────────────────────────────────────────────────────────────────

/** copy: sources → destDir 재귀 복사. */
export async function runCopy(
  sources: string[],
  destDir: string,
  hooks: EngineHooks
): Promise<EngineResult> {
  return runCopyOrMove(sources, destDir, false, hooks)
}

/** move: 같은 볼륨 rename, 다른 볼륨 copy+delete. */
export async function runMove(
  sources: string[],
  destDir: string,
  hooks: EngineHooks
): Promise<EngineResult> {
  const result: EngineResult = { succeededItems: 0, failedItems: 0, canceled: false, failures: [] }
  const totals = await aggregate(sources)
  hooks.onTotals(totals.items, totals.bytes)
  const counters: Counters = { bytes: 0, items: 0 }

  for (const src of sources) {
    if (hooks.shouldCancel()) {
      result.canceled = true
      break
    }
    const name = win32.basename(src)
    const destPath = win32.join(destDir, name)

    // 같은 볼륨 + 대상 미존재 → rename(빠른 경로).
    if (!(await pathExists(destPath))) {
      try {
        await fsp.rename(src, destPath)
        // rename 은 트리 전체를 한 번에 옮긴다 → 항목/바이트를 사후 집계로 누적.
        const moved = await aggregateOne(destPath)
        counters.items += moved.items
        counters.bytes += moved.bytes
        result.succeededItems += moved.items
        hooks.onProgress(counters.bytes, counters.items, name)
        continue
      } catch (e) {
        const code = (e as { code?: string })?.code
        if (code !== 'EXDEV') {
          // EXDEV 가 아닌 실패(권한 등)는 항목 실패로 기록.
          pushFailure(result, hooks, src, e)
          continue
        }
        // EXDEV: 다른 볼륨 → copy+delete 폴백(아래 copyEntry).
      }
    }
    // 대상 존재(충돌) 또는 EXDEV → copyEntry(이동 모드).
    await copyEntry(src, destDir, name, true, counters, result, hooks)
  }
  return result
}

async function runCopyOrMove(
  sources: string[],
  destDir: string,
  isMove: boolean,
  hooks: EngineHooks
): Promise<EngineResult> {
  const result: EngineResult = { succeededItems: 0, failedItems: 0, canceled: false, failures: [] }
  const totals = await aggregate(sources)
  hooks.onTotals(totals.items, totals.bytes)
  const counters: Counters = { bytes: 0, items: 0 }
  for (const src of sources) {
    if (hooks.shouldCancel()) {
      result.canceled = true
      break
    }
    await copyEntry(src, destDir, win32.basename(src), isMove, counters, result, hooks)
  }
  return result
}

/** 단일 경로(파일/폴더)의 항목/바이트 집계(rename 사후 누적용). */
async function aggregateOne(p: string): Promise<{ items: number; bytes: number }> {
  return aggregate([p])
}

/** delete: 영구 삭제(재귀). 휴지통이 아니라 실제 제거. */
export async function runDelete(sources: string[], hooks: EngineHooks): Promise<EngineResult> {
  const result: EngineResult = { succeededItems: 0, failedItems: 0, canceled: false, failures: [] }
  const totals = await aggregate(sources)
  hooks.onTotals(totals.items, totals.bytes)
  const counters: Counters = { bytes: 0, items: 0 }

  for (const src of sources) {
    if (hooks.shouldCancel()) {
      result.canceled = true
      break
    }
    const name = win32.basename(src)
    try {
      await chmodWritable(src)
      await fsp.rm(src, { recursive: true, force: true })
      counters.items++
      result.succeededItems++
      hooks.onProgress(counters.bytes, counters.items, name)
    } catch (e) {
      pushFailure(result, hooks, src, e)
    }
  }
  return result
}
