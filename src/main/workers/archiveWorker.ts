/**
 * 압축 추출/추가 Worker Thread 엔트리 (§Q1 M9 · ADR-008 결정③ · ADR-005 SPK-Worker).
 *
 * Main(ArchiveService)이 new Worker(...) 로 띄우고 workerData=ArchiveJob 을 준다. inflate(추출)/
 * deflate(추가) CPU 작업을 메인 스레드 밖에서 실행하고 진행/완료/스킵/실패를 parentPort 로
 * 보고한다. Renderer 와 직접 통신하지 않는다(hashWorker.ts 동형). `if (!port)` 가드로 번들
 * 검증 시 no-op.
 *
 * 추출 보안(ADR-008 결정④ — Zip Slip):
 *   - 각 엔트리 도착 경로를 safeExtractPath(@shared/archive/safePath)로 검증 → 이탈 거부(skip).
 *   - 심볼릭링크 엔트리 스킵. 압축비 폭탄·총 크기·엔트리 수 상한 초과 시 중단/격리.
 *   - `.part` 임시명으로 받은 뒤 완료 시 원자 rename(부분 추출 안전).
 *
 * 취소: workerData.cancelBuffer(Int32Array) 를 Atomics.load 로 폴링 → 엔트리 경계에서 감지.
 */
import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import { dirname } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { parentPort, workerData } from 'node:worker_threads'
import {
  ARCHIVE_CAPS,
  isSuspiciousRatio,
  safeExtractPath
} from '@shared/archive/safePath'
import { forEachEntryForExtract } from '../archive/ZipReader'
import { addToZip, type AddItem } from '../archive/ZipWriter'
import { classifyArchiveError } from '../archive/archiveErrors'
import { CANCEL_FLAG_INDEX } from '../archive/archiveProtocol'
import type { ArchiveJob, ArchiveOutMsg } from '../archive/archiveProtocol'

const port = parentPort
const job = workerData as ArchiveJob

if (!port) {
  // worker_threads 외부에서 import 된 경우(번들 검증 등) — no-op.
} else {
  const cancelView = new Int32Array(job.cancelBuffer)
  const post = (msg: ArchiveOutMsg): void => port.postMessage(msg)
  const shouldCancel = (): boolean => Atomics.load(cancelView, CANCEL_FLAG_INDEX) === 1

  /**
   * 추출 — zip 을 순회하며 대상(innerPaths prefix)에 속하는 파일 엔트리를 destDir 하위로
   * 안전 추출한다. Zip Slip·심볼릭·폭탄을 격리(skip)하고 잡은 계속한다.
   */
  const runExtract = async (): Promise<void> => {
    const destDir = job.destDir as string
    const innerPaths = (job.innerPaths ?? []) as string[]
    // prefix 정규화(POSIX·후행 '/' 제거). 빈 배열이면 전체 추출.
    const prefixes = innerPaths.map((p) => p.replace(/\\/g, '/').replace(/\/+$/, ''))
    const extractAll = prefixes.length === 0

    const matches = (entryName: string): boolean => {
      if (extractAll) return true
      const norm = entryName.replace(/\\/g, '/')
      return prefixes.some(
        (pre) => pre === '' || norm === pre || norm.startsWith(pre + '/')
      )
    }

    let succeeded = 0
    let processedItems = 0
    let processedBytes = 0
    let totalUncompressed = 0

    await forEachEntryForExtract(
      job.archivePath,
      (entry) => !entry.isDir && matches(entry.entryName),
      async (entry, openStream) => {
        if (shouldCancel()) return
        processedItems++

        // ── zip bomb 완화: 엔트리 수·총 해제 크기·압축비 상한 ──
        if (processedItems > ARCHIVE_CAPS.maxEntries) {
          throw new Error('엔트리 수 상한 초과(zip bomb 의심)')
        }
        totalUncompressed += entry.uncompressedSize
        if (totalUncompressed > ARCHIVE_CAPS.maxTotalUncompressedBytes) {
          throw new Error('총 해제 크기 상한 초과(zip bomb 의심)')
        }
        if (isSuspiciousRatio(entry.uncompressedSize, entry.compressedSize)) {
          post({
            type: 'skip',
            entryName: entry.entryName,
            code: 'EUNKNOWN',
            message: '비정상 압축비(zip bomb 의심) — 건너뜀'
          })
          return
        }

        // ── 심볼릭링크 엔트리 스킵(링크 통한 destDir 탈출 차단) ──
        if (entry.isSymlink) {
          post({
            type: 'skip',
            entryName: entry.entryName,
            code: 'ESECURITY',
            message: '심볼릭링크 엔트리는 추출하지 않습니다.'
          })
          return
        }

        // ── Zip Slip 경계 검증(이탈 거부) ──
        const safe = safeExtractPath(destDir, entry.entryName)
        if (!safe.ok) {
          post({
            type: 'skip',
            entryName: entry.entryName,
            code: 'ESECURITY',
            message: safe.reason ?? '도착지 이탈 — 건너뜀'
          })
          return
        }

        // ── 디렉토리 보장 + `.part` 임시 추출 → 원자 rename ──
        await fsp.mkdir(dirname(safe.path), { recursive: true })
        const partPath = `${safe.path}.part`
        try {
          const readStream = await openStream()
          const writeStream = fs.createWriteStream(partPath)
          readStream.on('data', (chunk: Buffer) => {
            processedBytes += chunk.length
            post({
              type: 'progress',
              processedItems,
              totalItems: 0,
              processedBytes,
              totalBytes: 0,
              currentName: entry.entryName
            })
          })
          await pipeline(readStream, writeStream)
          await fsp.rename(partPath, safe.path)
          succeeded++
        } catch (e) {
          await fsp.rm(partPath, { force: true }).catch(() => undefined)
          post({
            type: 'skip',
            entryName: entry.entryName,
            code: classifyArchiveError(e),
            message: e instanceof Error ? e.message : '엔트리 추출 실패'
          })
        }
      },
      shouldCancel
    )

    post({ type: 'done', succeededItems: succeeded, canceled: shouldCancel() })
  }

  /**
   * 추가 — 신규 로컬 파일들을 zip 에 deflate 하여 재작성(원자 rename). 동명 기존 엔트리는
   * overwrite 정책 결과(skipExisting)로 제외. ZipWriter 가 tmp→rename·원본 보존을 보장한다.
   */
  const runAdd = async (): Promise<void> => {
    const items = (job.addItems ?? []).map(
      (it): AddItem => ({ entryName: it.entryName, localPath: it.localPath, size: it.size })
    )
    const totalBytes = items.reduce((a, it) => a + it.size, 0)
    const skip = new Set(job.skipExisting ?? [])

    const succeeded = await addToZip(
      job.archivePath,
      items,
      skip,
      (processedBytes) => {
        post({
          type: 'progress',
          processedItems: 0,
          totalItems: items.length,
          processedBytes,
          totalBytes,
          currentName: ''
        })
      },
      shouldCancel
    )

    post({ type: 'done', succeededItems: succeeded, canceled: shouldCancel() })
  }

  // 실행(런타임 분기). const 선언 후 호출 — no-inner-declarations 회피.
  void (async () => {
    try {
      if (job.kind === 'extract') {
        await runExtract()
      } else {
        await runAdd()
      }
    } catch (e) {
      post({
        type: 'fatal',
        code: classifyArchiveError(e),
        message: e instanceof Error ? e.message : '압축 워커 치명적 오류',
        ...(job.archivePath ? { path: job.archivePath } : {})
      })
    }
  })()
}
