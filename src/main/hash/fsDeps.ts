/**
 * node:fs / node:crypto 결합 의존 팩토리 (M7 — 해시 엔진 실 fs 어댑터).
 *
 * 환경 비의존 엔진(hashEngine·dupEngine·compareEngine·verifyEngine)이 받는 deps 의
 * **실제 구현**을 한곳에 모은다. Worker(hashWorker)가 이 팩토리로 deps 를 만들어
 * 엔진을 구동한다. verify 스크립트는 이 모듈을 쓰지 않고 자체 스텁/임시파일을 주입한다
 * (헤드리스 — 순수 엔진만 검증). 단, fsDeps 자체도 node 내장만 쓰므로 esbuild 가능.
 *
 * 순환차단·심볼릭 미추종·권한격리·항목 상한은 scanEngine 의 F장 원칙을 재사용한다.
 *
 * 추적성: ADR-009 §결정②③ · scanEngine.scanDir 패턴 · directory-structure §8.
 */
import { createHash } from 'node:crypto'
import { open, lstat, readdir, realpath as fspRealpath, stat } from 'node:fs/promises'
import { win32 } from 'node:path'
import type { FileEntryDTO, HashAlgo } from '@shared/dto'
import type { ChunkReader, HashDigest, HashEngineDeps, HashHooks } from './hashEngine'
import { hashFile as engineHashFile } from './hashEngine'
import type { DupEngineDeps, DupFileMeta } from './dupEngine'
import type { CompareEngineDeps } from './compareEngine'
import type { VerifyEngineDeps } from './verifyEngine'

/** node:fs FileHandle 위 ChunkReader. */
function makeChunkReader(handle: import('node:fs/promises').FileHandle): ChunkReader {
  return {
    async read(buf: Uint8Array): Promise<number> {
      const { bytesRead } = await handle.read(buf, 0, buf.length, null)
      return bytesRead
    },
    async close(): Promise<void> {
      await handle.close()
    }
  }
}

/** node:crypto Hash 위 HashDigest. */
function makeDigest(algo: HashAlgo): HashDigest {
  const h = createHash(algo)
  return {
    update(chunk: Uint8Array): void {
      h.update(chunk)
    },
    digestHex(): string {
      return h.digest('hex')
    }
  }
}

/** hashEngine 용 실 fs/crypto deps. */
export const hashEngineDeps: HashEngineDeps = {
  async openReader(path: string): Promise<ChunkReader> {
    const handle = await open(path, 'r')
    return makeChunkReader(handle)
  },
  createDigest(algo: HashAlgo): HashDigest {
    return makeDigest(algo)
  }
}

/** 공용 hashFile 바인딩(실 fs/crypto). 엔진 deps 의 hashFile 슬롯에 주입. */
export function realHashFile(
  path: string,
  algo: HashAlgo,
  hooks: HashHooks
): Promise<string | null> {
  return engineHashFile(path, algo, hooks, hashEngineDeps)
}

/** Stats → FileEntryDTO(목록 비교용 메타). scanEngine·fs 서비스 매핑 동치. */
function toEntry(path: string, name: string, st: import('node:fs').Stats, symlink: boolean): FileEntryDTO {
  const isDir = st.isDirectory()
  const ext = isDir ? '' : win32.extname(name).slice(1).toLowerCase()
  return {
    name,
    path,
    isDir,
    size: isDir ? 0 : st.size,
    mtime: st.mtimeMs,
    ctime: st.ctimeMs,
    ext,
    attrs: { hidden: false, readonly: false, system: false, symlink }
  }
}

/** dupEngine 용 재귀 열거(순환차단·심볼릭 미추종·권한격리·항목 상한). */
const ENUMERATE_ITEM_CAP = 2_000_000

async function enumerateRoots(
  roots: readonly string[],
  minSize: number,
  hooks: HashHooks
): Promise<{ files: DupFileMeta[]; truncated: boolean }> {
  const files: DupFileMeta[] = []
  const visited = new Set<string>()
  let count = 0
  let truncated = false

  async function walk(dir: string): Promise<void> {
    if (truncated || hooks.shouldCancel()) return
    let real: string
    try {
      real = await fspRealpath(dir)
    } catch {
      real = win32.resolve(dir)
    }
    if (visited.has(real)) return
    visited.add(real)

    let dirents: import('node:fs').Dirent[]
    try {
      dirents = await readdir(dir, { withFileTypes: true })
    } catch {
      return // 권한거부 등 — 디렉토리 격리.
    }

    for (const d of dirents) {
      if (truncated || hooks.shouldCancel()) return
      if (count >= ENUMERATE_ITEM_CAP) {
        truncated = true
        return
      }
      const child = win32.join(dir, d.name)
      let st: import('node:fs').Stats
      try {
        st = await lstat(child)
      } catch {
        continue
      }
      count++
      hooks.onProgress(count, 0, child)
      if (st.isSymbolicLink()) continue // 링크 미추종.
      if (st.isDirectory()) {
        await walk(child)
      } else if (st.isFile() && st.size >= minSize) {
        files.push({ path: child, name: d.name, size: st.size, mtime: st.mtimeMs })
      }
    }
  }

  for (const root of roots) {
    if (truncated || hooks.shouldCancel()) break
    await walk(root)
  }
  return { files, truncated }
}

/** dupEngine 용 실 fs deps. */
export const dupEngineDeps: DupEngineDeps = {
  enumerate: enumerateRoots,
  hashFile: realHashFile
}

/** compareEngine 용 디렉토리 목록(lstat·심볼릭 미추종·권한격리). */
async function listDir(dir: string, _hooks: HashHooks): Promise<FileEntryDTO[]> {
  void _hooks
  let dirents: import('node:fs').Dirent[]
  try {
    dirents = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const entries: FileEntryDTO[] = []
  for (const d of dirents) {
    const child = win32.join(dir, d.name)
    let st: import('node:fs').Stats
    try {
      st = await lstat(child)
    } catch {
      continue
    }
    const symlink = st.isSymbolicLink()
    if (symlink) {
      // 링크 자체는 항목으로 노출(미추종 — 비교는 메타만, 폴더 재귀 진입 안 함).
      entries.push(toEntry(child, d.name, st, true))
      continue
    }
    entries.push(toEntry(child, d.name, st, false))
  }
  return entries
}

/** compareEngine 용 실 fs deps. */
export const compareEngineDeps: CompareEngineDeps = {
  listDir,
  hashFile: realHashFile,
  realpath: (dir: string) => fspRealpath(dir).catch(() => dir)
}

/** verifyEngine 용 실 fs deps. */
export const verifyEngineDeps: VerifyEngineDeps = {
  async statSize(path: string): Promise<number | null> {
    try {
      const st = await stat(path)
      return st.isFile() ? st.size : null
    } catch {
      return null
    }
  },
  hashFile: realHashFile
}
