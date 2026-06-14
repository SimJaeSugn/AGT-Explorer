/**
 * src/main/agent/realReadDeps.ts — ReadBackendDeps 실 구현(§Z Z1).
 *
 * readBackend.ts 의 주입형 `ReadBackendDeps` 를 **기존 Main 읽기 서비스/엔진** 으로 채운다.
 *   - list/preview → FileSystemService(싱글턴)
 *   - scan         → scanEngine.runScan
 *   - search       → grepEngine.runGrep + grepEngineDeps(실 fs)
 *   - dup          → dupEngine.findDuplicates + dupEngineDeps(실 fs/crypto)
 *   - compare      → compareEngine.runCompare + compareEngineDeps(실 fs/crypto)
 *
 * 엔진 hook(onProgress/onMatch)은 에이전트 도구 결과에는 진행 푸시가 없으므로 수집/무시한다.
 * shouldCancel 은 run 의 AbortSignal 폴링과 연결된다(readBackend 가 주입).
 *
 * 정직: 실 fs IO 경로 — 런타임 스모크 🟡(verify 는 readBackend 를 스텁 deps 로 검증).
 */
import { fileSystemService } from '../fs/FileSystemService'
import { runScan } from '../operations/scanEngine'
import { runGrep, compileMatcher, GREP_DEFAULT_MAX_FILE_BYTES, type GrepDirent, type GrepEngineDeps, type GrepLineHit } from '../search/grepEngine'
import { grepEngineDeps } from '../search/fsDeps'
import { findDuplicates } from '../hash/dupEngine'
import { runCompare } from '../hash/compareEngine'
import { dupEngineDeps, compareEngineDeps } from '../hash/fsDeps'
import { AGENT_SEARCH_SKIP_DIRS } from './limits'
import type { ReadBackendDeps } from './readBackend'

/**
 * 에이전트 search 한정 grep deps — 거대/노이즈 디렉토리(node_modules·.git·dist·out·.cache)를
 * walk 에서 제외한다(§Z 프리징 완화·소문자 비교). **전역 grepEngineDeps(GUI 검색)는 무변** —
 * 이 래퍼는 에이전트 어댑터 경로에서만 사용한다. readDir 결과에서 스킵 디렉토리를 드롭하므로
 * runGrep walk 가 해당 하위를 재귀하지 않는다(파일/실디렉토리는 그대로 통과).
 */
const agentGrepDeps: GrepEngineDeps = {
  async readDir(dir: string): Promise<GrepDirent[]> {
    const all = await grepEngineDeps.readDir(dir)
    return all.filter((d) => !(d.isDir && AGENT_SEARCH_SKIP_DIRS.has(d.name.toLowerCase())))
  },
  openReader: grepEngineDeps.openReader,
  realpath: grepEngineDeps.realpath
}

export function createRealReadDeps(): ReadBackendDeps {
  return {
    async list(path, showHidden) {
      const r = await fileSystemService.list(path, showHidden)
      if (!r.ok) return { ok: false, error: { message: r.error.message } }
      return {
        ok: true,
        value: {
          entries: r.value.entries.map((e) => ({
            name: e.name,
            isDir: e.isDir,
            size: e.size,
            mtime: e.mtime,
            ext: e.ext
          })),
          truncated: r.value.truncated
        }
      }
    },

    // §Z open_tab 존재 검증 — FileSystemService.stat(lstat 기반)으로 존재/디렉토리 여부만.
    async statPath(path) {
      const r = await fileSystemService.stat(path)
      if (!r.ok) return { exists: false, isDir: false }
      return { exists: true, isDir: r.value.isDir === true }
    },

    async readPreview(path) {
      const p = await fileSystemService.readPreview(path)
      return {
        kind: p.kind,
        name: p.name,
        size: p.size,
        mtime: p.mtime,
        ext: p.ext,
        ...(p.text !== undefined ? { text: p.text } : {}),
        ...(p.reason !== undefined ? { reason: p.reason } : {}),
        ...(p.truncated !== undefined ? { truncated: p.truncated } : {})
      }
    },

    async scan(root, shouldCancel) {
      const res = await runScan(root, {
        onProgress: () => {},
        shouldCancel
      })
      return {
        totalBytes: res.totalBytes,
        totalItems: res.totalItems,
        topFolders: res.topFolders.map((f) => ({ name: f.name, path: f.path, bytes: f.bytes })),
        topFiles: res.topFiles.map((f) => ({ name: f.name, path: f.path, bytes: f.bytes })),
        skipped: res.skipped,
        canceled: res.canceled,
        truncated: res.truncated
      }
    },

    async search(root, query, opts, shouldCancel, onProgress) {
      const matcher = compileMatcher(query, opts.regex)
      if (!matcher) {
        return { files: [], totalMatches: 0, matchedFiles: 0, truncated: false, canceled: false, invalidRegex: true }
      }
      const collected: Array<{ file: string; lines: Array<{ lineNo: number; text: string }> }> = []
      const res = await runGrep(
        matcher,
        {
          root,
          query,
          isRegex: opts.regex,
          recursive: opts.recursive,
          includeHidden: false,
          maxFileBytes: GREP_DEFAULT_MAX_FILE_BYTES
        },
        {
          // 트리 워크 진행을 어댑터로 전달(어댑터가 스로틀·조기 종료 카운터 갱신). 미주입 시 무시.
          onProgress: onProgress ?? (() => {}),
          onMatch: (file: string, lines: GrepLineHit[]) => {
            collected.push({ file, lines: lines.map((l) => ({ lineNo: l.lineNo, text: l.text })) })
          },
          // 조기 종료 + 취소(어댑터가 결과/스캔 상한·시간 예산 도달 시 true 반환).
          shouldCancel
        },
        agentGrepDeps
      )
      return {
        files: collected,
        totalMatches: res.totalMatches,
        matchedFiles: res.matchedFiles,
        truncated: res.truncated,
        canceled: res.canceled
      }
    },

    async dup(roots, shouldCancel) {
      const res = await findDuplicates(
        roots,
        -1,
        'sha256',
        { onProgress: () => {}, shouldCancel },
        dupEngineDeps
      )
      return {
        groups: res.groups.map((g) => ({ hash: g.hash, size: g.size, files: g.files.map((f) => ({ path: f.path })) })),
        truncated: res.truncated
      }
    },

    async compare(leftDir, rightDir, shouldCancel) {
      const res = await runCompare(
        { leftDir, rightDir, useHash: false, recursive: false, algo: 'sha256' },
        { onProgress: () => {}, shouldCancel },
        compareEngineDeps
      )
      return {
        pairs: res.pairs.map((p) => ({
          name: p.name,
          status: p.status,
          ...(p.relPath !== undefined ? { relPath: p.relPath } : {})
        })),
        summary: res.summary,
        truncated: res.truncated
      }
    }
  }
}
