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

/**
 * 거대 파일 스트림 복사 청크(1MB). 청크가 클수록 syscall 횟수가 줄어 처리량↑.
 * 이 경로는 STREAM_COPY_THRESHOLD 이상 파일에만 쓰이므로(아래), 청크 단위 진행률·취소
 * 응답성도 충분하다.
 */
const COPY_CHUNK = 1024 * 1024

/**
 * 하이브리드 복사 임계값(64MB). 이 미만 파일은 fs.copyFile(OS 네이티브 CopyFileEx —
 * 유저공간 왕복 0)로 빠르게 복사하고, 이상 파일만 청크 스트림으로 복사한다(파일 내부
 * 진행률 + 청크 단위 협조취소가 필요한 대용량 한정). 작은/중간 파일이 대다수인 "대량
 * 복사"에서 체감 속도 향상의 핵심.
 */
const STREAM_COPY_THRESHOLD = 64 * 1024 * 1024

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
  /**
   * 협조적 일시정지(M7 W2 · ADR-011, 옵셔널·비파괴). 파일 경계에서 await 한다.
   * 일시정지 중이면 재개(또는 취소)까지 resolve 를 미룬다. 미정의면 즉시 통과
   * (기존 단발 경로 동치). 거대 단일 파일은 그 파일을 마친 뒤 다음 경계에서 멈춤
   * (파일 경계 일시정지 — 청크 멈춤은 후속 UQ-R2).
   */
  awaitResume?(): Promise<void>
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

/**
 * 병렬 복사 컨텍스트(적응형 동시성). limit=1 이면 기존 순차 동작과 완전 동치(검증 결정성
 * 보존). limit>1 이면 한 디렉토리의 **파일 자식들**을 동시에 복사하되, 하위 폴더는 순차
 * 재귀하므로 전역 동시 파일 I/O 가 항상 limit 이하로 제한된다(핸들 폭주·깊은 트리 메모리
 * 방지). 충돌 질의는 conflictGate(뮤텍스)로 직렬화해 동시 프롬프트/일괄적용 혼선을 막는다.
 */
interface ParCtx {
  limit: number
  conflictGate: Mutex
}

/** 단순 비공정 뮤텍스(충돌 질의 직렬화용). limit=1 경로에서는 사용되지 않는다. */
class Mutex {
  private locked = false
  private readonly q: Array<() => void> = []
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.locked) await new Promise<void>((res) => this.q.push(res))
    else this.locked = true
    try {
      return await fn()
    } finally {
      const next = this.q.shift()
      if (next) next()
      else this.locked = false
    }
  }
}

/**
 * 워커 풀: items 를 최대 limit 개씩 동시에 fn 으로 처리한다(인덱스를 공유하는 limit 개
 * 소비자). 동시 in-flight 가 limit 으로 제한돼 한 번에 만들어지는 Promise 수도 limit 이하.
 */
async function runPool<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let cursor = 0
  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const idx = cursor++
      await fn(items[idx] as T)
    }
  }
  const workers: Array<Promise<void>> = []
  for (let k = 0; k < Math.min(limit, items.length); k++) workers.push(worker())
  await Promise.all(workers)
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
  // 수정시각 보존은 호출자(copyFileHybrid)가 상위 st 재사용으로 처리(재-stat 제거).
}

/**
 * 단일 파일 복사(크기별 하이브리드). 임계값 미만은 fs.copyFile(OS 네이티브, 빠름),
 * 이상은 청크 스트림(파일 내부 진행률 + 청크 단위 취소). 수정시각은 상위에서 받은 st 를
 * 재사용해 보존한다(추가 stat 없음 — syscall 절감). 취소는 파일 시작 경계에서 확인하며,
 * 스트림 경로는 청크마다 추가 확인한다.
 */
async function copyFileHybrid(
  src: string,
  dest: string,
  st: import('node:fs').Stats,
  counters: Counters,
  hooks: EngineHooks,
  name: string
): Promise<void> {
  if (hooks.shouldCancel()) {
    throw Object.assign(new Error('canceled'), { code: 'ECANCELED' })
  }
  if (st.size >= STREAM_COPY_THRESHOLD) {
    // 거대 파일: 청크 스트림 — counters.bytes 는 청크마다 누적된다.
    await copyFileStreamed(src, dest, counters, hooks, name)
  } else {
    // 일반 파일: OS 네이티브 복사(Windows CopyFileEx) — 유저공간 데이터 왕복 없음.
    await fsp.copyFile(src, dest)
    counters.bytes += st.size
    hooks.onProgress(counters.bytes, counters.items, name)
  }
  // 수정시각 보존 — 베스트에포트(상위 st 재사용).
  try {
    await fsp.utimes(dest, st.atime, st.mtime)
  } catch {
    /* 베스트에포트 */
  }
}

/** 단일 항목(파일/폴더) 복사. 충돌 해소·재귀·취소 처리. par.limit>1 이면 디렉토리 파일 자식을 병렬 복사. */
async function copyEntry(
  src: string,
  destDir: string,
  name: string,
  isMove: boolean,
  counters: Counters,
  result: EngineResult,
  hooks: EngineHooks,
  par: ParCtx
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
    // 병렬(limit>1) 시 동시 충돌 프롬프트/일괄적용 혼선 방지 위해 질의를 직렬화한다.
    const conflictArgs = {
      sourcePath: src,
      targetPath: destPath,
      sourceSize: st.isFile() ? st.size : 0,
      sourceMtime: Math.trunc(st.mtimeMs),
      sourceIsDir: st.isDirectory(),
      targetSize: tStat?.isFile() ? tStat.size : 0,
      targetMtime: tStat ? Math.trunc(tStat.mtimeMs) : 0,
      targetIsDir: tStat ? tStat.isDirectory() : false
    }
    const resolution =
      par.limit > 1
        ? await par.conflictGate.run(() => hooks.resolveConflict(conflictArgs))
        : await hooks.resolveConflict(conflictArgs)

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

    // withFileTypes 로 자식 종류를 한 번에 얻어(자식별 lstat 절감) 파일/폴더로 분류한다.
    let dirents: import('node:fs').Dirent[]
    try {
      dirents = await fsp.readdir(src, { withFileTypes: true })
    } catch (e) {
      pushFailure(result, hooks, src, e)
      return
    }
    const fileEnts = dirents.filter((d) => !d.isDirectory())
    const dirEnts = dirents.filter((d) => d.isDirectory())
    const copyChild = (childName: string): Promise<void> =>
      copyEntry(win32.join(src, childName), destPath, childName, isMove, counters, result, hooks, par)

    // 파일 자식: par.limit>1 이면 동시 복사(전역 동시 I/O 는 하위폴더 순차 처리로 limit 이하 유지).
    if (par.limit > 1 && fileEnts.length > 1) {
      await runPool(fileEnts, par.limit, async (d) => {
        if (hooks.shouldCancel()) {
          result.canceled = true
          return
        }
        await copyChild(d.name)
      })
    } else {
      for (const d of fileEnts) {
        if (hooks.shouldCancel()) {
          result.canceled = true
          return
        }
        await copyChild(d.name)
      }
    }
    // 하위 폴더: 순차 재귀(동시성을 디렉토리 내 파일 수준으로 한정 — 핸들 폭주 방지).
    for (const d of dirEnts) {
      if (hooks.shouldCancel()) {
        result.canceled = true
        return
      }
      await copyChild(d.name)
    }
    // move: 자식까지 복사 끝났으면 원본 폴더 제거(읽기전용·정션·EPERM 견고 삭제).
    if (isMove && !result.canceled) {
      try {
        await forceRemove(src)
      } catch (e) {
        pushFailure(result, hooks, src, e)
      }
    }
  } else {
    // 파일: 덮어쓰기면 기존 제거 후 복사(크기별 하이브리드 — copyFile/스트림).
    try {
      if (await pathExists(destPath)) {
        await chmodWritable(destPath)
        await fsp.rm(destPath, { force: true })
      }
      await copyFileHybrid(src, destPath, st, counters, hooks, name)
      counters.items++
      result.succeededItems++
      hooks.onProgress(counters.bytes, counters.items, name)
      if (isMove) {
        await forceRemove(src)
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

/** EPERM/EBUSY 면 읽기전용 해제 후 1회 재시도하는 rmdir/unlink. */
async function removeWithRetry(p: string, dir: boolean): Promise<void> {
  const remove = (): Promise<void> => (dir ? fsp.rmdir(p) : fsp.unlink(p))
  try {
    await remove()
  } catch (e) {
    const code = (e as { code?: string }).code
    if (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES') {
      await chmodWritable(p)
      await remove() // 재시도(여전히 실패하면 throw → 상위가 실패 보고)
    } else {
      throw e
    }
  }
}

/**
 * 견고한 재귀 영구 삭제 — fsp.rm({force}) 가 Windows 에서 EPERM 으로 멈추는 경우를 보완한다.
 *
 *  - 읽기전용/시스템 속성 디렉토리·파일: chmod 로 쓰기 가능화 후 제거(EPERM 주원인 해소).
 *  - 정션/심볼릭 링크(디렉토리 포함): **대상으로 재귀하지 않고 링크 자체만 제거**한다
 *    (예: 재배치된 AppData 하위의 호환성 정션 — 대상 데이터 보존 + rmdir EPERM 회피).
 *  - rmdir/unlink EPERM·EBUSY 는 chmod 후 1회 재시도. ENOENT(이미 없음)는 성공 취급.
 *
 * 실패(권한·사용 중 등)는 throw 로 상위(runDelete/copyEntry)가 잡아 항목 실패로 보고한다.
 */
async function forceRemove(target: string): Promise<void> {
  let st: import('node:fs').Stats
  try {
    st = await fsp.lstat(target)
  } catch (e) {
    if ((e as { code?: string }).code === 'ENOENT') return // 이미 없음.
    throw e
  }
  await chmodWritable(target)

  // 정션/심볼릭 링크: 링크만 제거(대상 미재귀). 디렉토리 정션은 rmdir, 파일 링크는 unlink.
  if (st.isSymbolicLink()) {
    try {
      await removeWithRetry(target, false)
    } catch {
      await removeWithRetry(target, true)
    }
    return
  }

  if (st.isDirectory()) {
    let kids: string[] = []
    try {
      kids = await fsp.readdir(target)
    } catch {
      kids = []
    }
    for (const k of kids) await forceRemove(win32.join(target, k))
    await removeWithRetry(target, true)
    return
  }

  await removeWithRetry(target, false)
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

/**
 * copy: sources → destDir 재귀 복사.
 * @param concurrency 디렉토리 내 파일 자식 동시 복사 수(기본 1=순차, 기존 동작 동치).
 *   워커가 볼륨 교차 여부로 적응 결정(같은 볼륨=1, 다른 볼륨=N) — engine 은 값만 받는다.
 */
export async function runCopy(
  sources: string[],
  destDir: string,
  hooks: EngineHooks,
  concurrency = 1
): Promise<EngineResult> {
  return runCopyOrMove(sources, destDir, false, hooks, concurrency)
}

/** move: 같은 볼륨 rename, 다른 볼륨 copy+delete. concurrency 는 copy 폴백 경로에만 적용. */
export async function runMove(
  sources: string[],
  destDir: string,
  hooks: EngineHooks,
  concurrency = 1
): Promise<EngineResult> {
  const result: EngineResult = { succeededItems: 0, failedItems: 0, canceled: false, failures: [] }
  const totals = await aggregate(sources)
  hooks.onTotals(totals.items, totals.bytes)
  const counters: Counters = { bytes: 0, items: 0 }
  const par: ParCtx = { limit: Math.max(1, concurrency), conflictGate: new Mutex() }

  for (const src of sources) {
    // 파일 경계 일시정지(M7): 다음 항목 시작 전 재개까지 대기(취소면 await 후 즉시 중단).
    if (hooks.awaitResume) await hooks.awaitResume()
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
    await copyEntry(src, destDir, name, true, counters, result, hooks, par)
  }
  return result
}

async function runCopyOrMove(
  sources: string[],
  destDir: string,
  isMove: boolean,
  hooks: EngineHooks,
  concurrency = 1
): Promise<EngineResult> {
  const result: EngineResult = { succeededItems: 0, failedItems: 0, canceled: false, failures: [] }
  const totals = await aggregate(sources)
  hooks.onTotals(totals.items, totals.bytes)
  const counters: Counters = { bytes: 0, items: 0 }
  const par: ParCtx = { limit: Math.max(1, concurrency), conflictGate: new Mutex() }
  for (const src of sources) {
    // 파일 경계 일시정지(M7).
    if (hooks.awaitResume) await hooks.awaitResume()
    if (hooks.shouldCancel()) {
      result.canceled = true
      break
    }
    await copyEntry(src, destDir, win32.basename(src), isMove, counters, result, hooks, par)
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
    // 파일 경계 일시정지(M7).
    if (hooks.awaitResume) await hooks.awaitResume()
    if (hooks.shouldCancel()) {
      result.canceled = true
      break
    }
    const name = win32.basename(src)
    try {
      // 견고한 재귀 삭제(읽기전용 해제·정션 링크만 제거·EPERM 재시도) — fsp.rm({force}) 가
      // Windows 보호/정션/읽기전용에서 EPERM 으로 멈추는 문제를 보완한다.
      await forceRemove(src)
      counters.items++
      result.succeededItems++
      hooks.onProgress(counters.bytes, counters.items, name)
    } catch (e) {
      pushFailure(result, hooks, src, e)
    }
  }
  return result
}
