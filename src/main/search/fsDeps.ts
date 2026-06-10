/**
 * node:fs 결합 의존 팩토리 (M8 — grep 엔진 실 fs 어댑터, ADR-010).
 *
 * 환경 비의존 엔진(grepEngine)이 받는 deps(GrepEngineDeps)의 **실제 구현**을 한곳에
 * 모은다. Worker(grepWorker)가 이 모듈로 엔진을 구동한다. verify 스크립트는 이 모듈을
 * 쓰지 않고 자체 메모리 스텁을 주입한다(헤드리스 — 순수 엔진만 검증). fsDeps 자체도
 * node 내장만 쓰므로 esbuild 가능.
 *
 * 심볼릭 미추종·권한격리·순환차단은 scanEngine/hash fsDeps 의 F장 원칙을 재사용한다.
 * Windows 숨김/시스템 속성은 lstat 만으로 못 얻으므로 win32 attrs 비트를 별도 조회한다.
 *
 * 추적성: ADR-010 §결정②③④ · main/hash/fsDeps.ts 선례.
 */
import { open, lstat, readdir, realpath as fspRealpath } from 'node:fs/promises'
import { win32 } from 'node:path'
import { resolveAttributes } from '../fs/winAttributes'
import type { GrepDirent, GrepEngineDeps, GrepFileReader } from './grepEngine'

/** node:fs FileHandle 위 GrepFileReader(청크 read). */
function makeReader(handle: import('node:fs/promises').FileHandle): GrepFileReader {
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

/** grepEngine 용 실 fs deps. */
export const grepEngineDeps: GrepEngineDeps = {
  async readDir(dir: string): Promise<GrepDirent[]> {
    const dirents = await readdir(dir, { withFileTypes: true })
    const out: GrepDirent[] = []
    for (const de of dirents) {
      const child = win32.join(dir, de.name)
      let st: import('node:fs').Stats
      try {
        st = await lstat(child)
      } catch {
        continue // lstat 실패 — 항목 격리(권한·레이스).
      }
      const isSymlink = st.isSymbolicLink()
      const isDir = !isSymlink && st.isDirectory()
      const isFile = !isSymlink && st.isFile()
      // 숨김/시스템 속성(win32 비트 우선·이름 휴리스틱 폴백 — FileSystemService 동치).
      const attrs = resolveAttributes(de.name, st, isSymlink)
      const hidden = attrs.hidden || attrs.system
      out.push({
        name: de.name,
        path: child,
        isDir,
        isFile,
        isSymlink,
        size: isFile ? st.size : 0,
        hidden,
        ext: isFile ? win32.extname(de.name).slice(1).toLowerCase() : ''
      })
    }
    return out
  },

  async openReader(path: string): Promise<GrepFileReader> {
    const handle = await open(path, 'r')
    return makeReader(handle)
  },

  async realpath(dir: string): Promise<string> {
    return fspRealpath(dir).catch(() => dir)
  }
}
