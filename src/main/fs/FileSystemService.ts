/**
 * FileSystemService — Main 측 파일시스템 읽기 계층 (SA §4).
 *
 * 책임(P1 구현 범위 = 읽기 계열):
 *   - 디렉토리 목록(단발 + 스트리밍/청크 증분)
 *   - stat(단일 항목 메타)
 *   - 드라이브 열거(Windows)
 *   - 사이드바 트리 지연 확장(하위 폴더만)
 *   - 경로 검증(주소창)
 *
 * 모든 메서드는 throw 하지 않고 Result<T, FileOpError> 를 반환한다(ADR-003).
 * Windows 속성(hidden/system/readonly)·롱패스·링크·네트워크 예외를 흡수한다.
 *
 * fs:mkdir/create-file/rename(P4), op:*(P4)는 본 서비스에 메서드 자리만 두지 않고
 * 각 Phase 에서 추가한다(계약은 contracts 에 동결됨).
 */
import { constants as fsConstants } from 'node:fs'
import * as fsp from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { win32 } from 'node:path'
import type {
  DirListResult,
  DriveDTO,
  DriveKind,
  FileEntryDTO,
  PathValidation,
  PreviewData
} from '@shared/dto'
import type { FileOpError, Result } from '@shared/ipc/contracts'
import { err, ok } from '@shared/ipc/contracts'
import { fileOpError, toFileOpError } from './errors'
import { extOf, joinWin, validateEntryName } from './paths'
import { resolveAttributes } from './winAttributes'

/** 단발 목록 상한(안전장치). 초과 시 truncated=true. */
const SINGLE_LIST_CAP = 50_000
/** 스트리밍 기본 청크 크기(항목 수). */
const DEFAULT_CHUNK_SIZE = 500
/** 스트리밍 총 상한. */
const STREAM_CAP = 500_000

// ── 미리보기 상한·분기 테이블 (P6b, US-4.3) ──────────────────────────────
/** 텍스트 미리보기로 읽는 앞부분 상한(64KB). 초과 분량은 truncated 표기. */
const PREVIEW_TEXT_MAX = 64 * 1024
/** 이미지 원본을 base64 로 전달할 최대 크기(5MB). 초과 시 메타 폴백. */
const PREVIEW_IMAGE_MAX = 5 * 1024 * 1024

/** 이미지로 취급할 확장자 → MIME 매핑(원본 바이트를 data URL 로 그대로 렌더). */
const PREVIEW_IMAGE_MIME: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml'
}

/**
 * 확장자 → 구문강조 언어 코드(highlight.js 언어명, J6). 텍스트로 판정된 파일에만
 * `PreviewData.lang` 으로 채운다. 미상은 undefined(렌더러 plain 폴백 또는 auto).
 * highlight.js `lib/common` 에 포함되는 흔한 언어 위주(렌더러 트리셰이킹과 정합).
 */
const PREVIEW_CODE_LANG: Readonly<Record<string, string>> = {
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  json: 'json',
  jsonc: 'json',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'xml',
  htm: 'xml',
  xml: 'xml',
  svg: 'xml',
  vue: 'xml',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  cs: 'csharp',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  hxx: 'cpp',
  php: 'php',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  ps1: 'powershell',
  bat: 'dos',
  cmd: 'dos',
  sql: 'sql',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  cfg: 'ini',
  conf: 'ini',
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  md: 'markdown',
  markdown: 'markdown',
  swift: 'swift',
  dart: 'dart',
  scala: 'scala',
  lua: 'lua',
  r: 'r',
  pl: 'perl',
  groovy: 'groovy'
}

/**
 * 텍스트로 취급할 확장자(앞부분만 읽어 표시). 무확장자('')도 텍스트 시도 후
 * NUL 휴리스틱으로 바이너리면 unsupported 로 폴백한다. J6 으로 코드 확장자 다수 확대.
 */
const PREVIEW_TEXT_EXTS: ReadonlySet<string> = new Set([
  'txt', 'md', 'markdown', 'rst', 'json', 'jsonc', 'js', 'jsx', 'mjs', 'cjs',
  'ts', 'tsx', 'mts', 'cts', 'css', 'scss', 'less', 'html', 'htm', 'xml', 'svg',
  'vue', 'svelte', 'csv', 'tsv', 'log', 'ini', 'cfg', 'conf', 'env', 'properties',
  'yaml', 'yml', 'toml', 'sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd', 'py', 'pyw',
  'rb', 'go', 'rs', 'c', 'h', 'cpp', 'cc', 'cxx', 'hpp', 'hxx', 'java', 'kt',
  'kts', 'cs', 'php', 'sql', 'swift', 'dart', 'scala', 'lua', 'r', 'pl', 'pm',
  'groovy', 'gradle', 'dockerfile', 'makefile', 'gitignore', 'gitattributes',
  'editorconfig', 'patch', 'diff', 'm', ''
])

/** 진행 중인 스트림 1개의 핸들(취소 토큰). */
interface ActiveStream {
  canceled: boolean
}

export interface StreamCallbacks {
  onChunk: (entries: FileEntryDTO[]) => void
  onDone: (total: number, truncated: boolean) => void
  onError: (error: FileOpError) => void
}

export class FileSystemService {
  private readonly streams = new Map<string, ActiveStream>()

  // ──────────────────────────────────────────────────────────────────
  // 단일 항목 → DTO 변환
  // ──────────────────────────────────────────────────────────────────

  /**
   * dirent + 경로로 FileEntryDTO 를 만든다.
   * 링크 판정을 위해 lstat 으로 stat 하고, 디렉토리/크기/시간을 수집한다.
   * stat 실패(권한·끊긴 링크) 항목은 안전한 기본값으로 채워 목록에서 누락하지 않는다.
   */
  private async toEntry(fullPath: string, name: string): Promise<FileEntryDTO> {
    let isDir = false
    let isSymlink = false
    let size = 0
    let mtime = 0
    let ctime = 0
    let hidden = false
    let readonly = false
    let system = false

    try {
      const lst = await fsp.lstat(fullPath)
      isSymlink = lst.isSymbolicLink()
      // 링크면 대상 stat 으로 실제 타입을 본다(끊긴 링크는 lstat 사용).
      let st = lst
      if (isSymlink) {
        try {
          st = await fsp.stat(fullPath)
        } catch {
          st = lst // 끊긴 링크: lstat 메타 유지
        }
      }
      isDir = st.isDirectory()
      size = st.isFile() ? st.size : 0
      mtime = Math.trunc(st.mtimeMs)
      ctime = Math.trunc(st.ctimeMs)
      const attrs = resolveAttributes(name, st, isSymlink)
      hidden = attrs.hidden
      readonly = attrs.readonly
      system = attrs.system
      isSymlink = attrs.symlink
    } catch {
      // stat 전체 실패: 이름만 아는 항목으로 최소 DTO 구성(권한 거부 등).
    }

    return {
      name,
      path: fullPath,
      isDir,
      size,
      mtime,
      ctime,
      ext: extOf(name, isDir),
      attrs: { hidden, readonly, system, symlink: isSymlink }
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // fs:list — 단발 디렉토리 목록 (소형 폴더)
  // ──────────────────────────────────────────────────────────────────

  async list(path: string, showHidden: boolean): Promise<Result<DirListResult>> {
    let dirents: import('node:fs').Dirent[]
    try {
      dirents = await fsp.readdir(path, { withFileTypes: true })
    } catch (e) {
      return err(toFileOpError(e, path))
    }

    const entries: FileEntryDTO[] = []
    let truncated = false
    for (const d of dirents) {
      if (entries.length >= SINGLE_LIST_CAP) {
        truncated = true
        break
      }
      const full = win32.join(path, d.name)
      const entry = await this.toEntry(full, d.name)
      if (!showHidden && (entry.attrs.hidden || entry.attrs.system)) continue
      entries.push(entry)
    }
    return ok({ entries, truncated })
  }

  // ──────────────────────────────────────────────────────────────────
  // fs:list:start/chunk/done — 스트리밍 (대형 폴더, US-5.6)
  // ──────────────────────────────────────────────────────────────────

  /**
   * 스트림을 시작하고 즉시 streamId 를 반환한다. 실제 스캔/청크 전송은
   * 비동기로 진행되며 콜백(onChunk/onDone/onError)으로 Main 핸들러가
   * Renderer 에 푸시한다. 취소는 cancelStream(streamId).
   */
  startListStream(
    path: string,
    showHidden: boolean,
    chunkSize: number,
    cb: StreamCallbacks
  ): string {
    const streamId = randomUUID()
    const handle: ActiveStream = { canceled: false }
    this.streams.set(streamId, handle)
    const size = chunkSize > 0 ? chunkSize : DEFAULT_CHUNK_SIZE

    // 비동기 스캔. 즉시 반환하므로 void 로 띄운다.
    void this.runStream(streamId, handle, path, showHidden, size, cb)
    return streamId
  }

  private async runStream(
    streamId: string,
    handle: ActiveStream,
    path: string,
    showHidden: boolean,
    chunkSize: number,
    cb: StreamCallbacks
  ): Promise<void> {
    let dir: import('node:fs').Dir
    try {
      dir = await fsp.opendir(path)
    } catch (e) {
      this.streams.delete(streamId)
      cb.onError(toFileOpError(e, path))
      return
    }

    let total = 0
    let truncated = false
    let buffer: FileEntryDTO[] = []

    try {
      for await (const d of dir) {
        if (handle.canceled) break
        if (total >= STREAM_CAP) {
          truncated = true
          break
        }
        const full = win32.join(path, d.name)
        const entry = await this.toEntry(full, d.name)
        if (!showHidden && (entry.attrs.hidden || entry.attrs.system)) continue
        buffer.push(entry)
        total++
        if (buffer.length >= chunkSize) {
          if (handle.canceled) break
          cb.onChunk(buffer)
          buffer = []
        }
      }
      if (!handle.canceled && buffer.length > 0) {
        cb.onChunk(buffer)
      }
      if (handle.canceled) {
        // 취소 후에는 추가 청크/완료 이벤트를 보내지 않는다(계약: 취소 후 무유입).
        await dir.close().catch(() => undefined)
        this.streams.delete(streamId)
        return
      }
      cb.onDone(total, truncated)
    } catch (e) {
      if (!handle.canceled) cb.onError(toFileOpError(e, path))
    } finally {
      await dir.close().catch(() => undefined)
      this.streams.delete(streamId)
    }
  }

  /** 스트림 취소. 이후 청크/완료 이벤트는 발생하지 않는다. */
  cancelStream(streamId: string): void {
    const handle = this.streams.get(streamId)
    if (handle) handle.canceled = true
  }

  // ──────────────────────────────────────────────────────────────────
  // fs:stat — 단일 항목 메타
  // ──────────────────────────────────────────────────────────────────

  async stat(path: string): Promise<Result<FileEntryDTO>> {
    try {
      await fsp.lstat(path) // 존재 확인(없으면 throw → ENOENT)
    } catch (e) {
      return err(toFileOpError(e, path))
    }
    const name = win32.basename(path) || path
    const entry = await this.toEntry(path, name)
    return ok(entry)
  }

  // ──────────────────────────────────────────────────────────────────
  // preview:read — 미리보기 데이터(텍스트 앞부분/이미지 바이트/메타) (P6b, US-4.3)
  //
  // 경로는 guard 에서 정규화·상위이탈 차단된 것(ADR-005 §3.3). 모든 분기 throw
  // 금지 — 호출 핸들러가 Result 로 감싼다(여기서는 PreviewData 만 반환).
  //   - 디렉토리 → kind:'meta'(미리보기 대상 아님, 메타만).
  //   - 이미지 확장자 & size ≤ 5MB → base64 data URL(kind:'image').
  //                       size > 5MB → kind:'meta' + reason('크기 초과').
  //   - 텍스트 확장자/무확장자 → 앞부분 64KB 만 읽어 NUL 휴리스틱:
  //       NUL 있음 → kind:'unsupported'(reason:'바이너리'),
  //       없음 → kind:'text'(64KB 초과면 truncated=true).
  //   - 그 외 확장자 → kind:'meta'(아이콘+메타만).
  // ──────────────────────────────────────────────────────────────────

  async readPreview(path: string): Promise<PreviewData> {
    // 공통 메타(이름·크기·수정시각·확장자). lstat 실패면 ENOENT 메타로 폴백.
    let isDir = false
    let size = 0
    let mtime = 0
    const name = win32.basename(path) || path
    try {
      const lst = await fsp.lstat(path)
      let st = lst
      if (lst.isSymbolicLink()) {
        try {
          st = await fsp.stat(path)
        } catch {
          st = lst // 끊긴 링크
        }
      }
      isDir = st.isDirectory()
      size = st.isFile() ? st.size : 0
      mtime = Math.trunc(st.mtimeMs)
    } catch {
      // 미존재/권한 → 메타만(빈 값). 호출부는 kind:'meta' 로 안내.
      return { kind: 'meta', name, path, size: 0, mtime: 0, ext: '', reason: '읽을 수 없음' }
    }

    const ext = extOf(name, isDir)

    // 디렉토리는 미리보기 대상이 아님 — 메타만.
    if (isDir) {
      return { kind: 'meta', name, path, size, mtime, ext }
    }

    // ── 이미지: 원본 바이트 → base64 data URL(크기 상한 가드) ──
    const mime = PREVIEW_IMAGE_MIME[ext]
    if (mime) {
      if (size > PREVIEW_IMAGE_MAX) {
        return { kind: 'meta', name, path, size, mtime, ext, reason: '크기 초과', truncated: true }
      }
      try {
        const buf = await fsp.readFile(path)
        const dataUrl = `data:${mime};base64,${buf.toString('base64')}`
        return { kind: 'image', name, path, size, mtime, ext, dataUrl }
      } catch {
        // 읽기 실패 → 메타 폴백(throw 금지).
        return { kind: 'meta', name, path, size, mtime, ext, reason: '읽을 수 없음' }
      }
    }

    // ── 텍스트(또는 무확장자): 앞부분 64KB 만 읽어 바이너리 휴리스틱 ──
    if (PREVIEW_TEXT_EXTS.has(ext)) {
      let buf: Buffer
      let truncated = false
      try {
        const fh = await fsp.open(path, 'r')
        try {
          const chunk = Buffer.alloc(PREVIEW_TEXT_MAX)
          const { bytesRead } = await fh.read(chunk, 0, PREVIEW_TEXT_MAX, 0)
          buf = chunk.subarray(0, bytesRead)
          truncated = size > PREVIEW_TEXT_MAX
        } finally {
          await fh.close()
        }
      } catch {
        return { kind: 'meta', name, path, size, mtime, ext, reason: '읽을 수 없음' }
      }
      // NUL 바이트가 있으면 바이너리로 판정(텍스트로 표시하지 않음).
      if (buf.includes(0)) {
        return { kind: 'unsupported', name, path, size, mtime, ext, reason: '바이너리' }
      }
      const text = buf.toString('utf8')
      // J6: 구문강조 언어 힌트(미상이면 생략) + 마크다운 여부(텍스트 kind 에만 채움).
      const lang = PREVIEW_CODE_LANG[ext]
      const isMarkdown = ext === 'md' || ext === 'markdown'
      return {
        kind: 'text',
        name,
        path,
        size,
        mtime,
        ext,
        text,
        ...(lang ? { lang } : {}),
        ...(isMarkdown ? { isMarkdown: true } : {}),
        ...(truncated ? { truncated: true } : {})
      }
    }

    // ── 그 외 형식: 메타만(아이콘+이름·크기·수정일). ──
    return { kind: 'meta', name, path, size, mtime, ext }
  }

  // ──────────────────────────────────────────────────────────────────
  // fs:tree-children — 사이드바 트리 지연 확장(하위 "폴더"만)
  // ──────────────────────────────────────────────────────────────────

  async treeChildren(path: string): Promise<Result<FileEntryDTO[]>> {
    let dirents: import('node:fs').Dirent[]
    try {
      dirents = await fsp.readdir(path, { withFileTypes: true })
    } catch (e) {
      return err(toFileOpError(e, path))
    }
    const out: FileEntryDTO[] = []
    for (const d of dirents) {
      const full = win32.join(path, d.name)
      const entry = await this.toEntry(full, d.name)
      // 트리에는 폴더만, 숨김/시스템 제외(사이드바 기본).
      if (!entry.isDir) continue
      if (entry.attrs.hidden || entry.attrs.system) continue
      out.push(entry)
    }
    return ok(out)
  }

  // ──────────────────────────────────────────────────────────────────
  // fs:validate-path — 주소창 검증
  // ──────────────────────────────────────────────────────────────────

  async validatePath(path: string): Promise<Result<PathValidation>> {
    try {
      const st = await fsp.stat(path)
      return ok({ exists: true, isDir: st.isDirectory(), normalized: path })
    } catch (e) {
      const fe = toFileOpError(e, path)
      // 존재하지 않음은 오류가 아니라 검증 결과(exists:false)로 1급 반환.
      if (fe.code === 'ENOENT') {
        return ok({ exists: false, isDir: false, normalized: path })
      }
      return err(fe)
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // fs:mkdir / fs:create-file / fs:rename — 단발 기본조작 (P4, SA §3.2)
  // 이름 검증(금지문자·예약명·빈이름)은 paths.validateEntryName 재사용.
  // 충돌(EEXIST)·권한(EACCES)·미존재(ENOENT)는 errno→FileOpError 매핑.
  // ──────────────────────────────────────────────────────────────────

  /** 새 폴더 생성. 생성된 폴더의 DTO 반환(즉시 인라인 선택용). */
  async mkdir(parentDir: string, name: string): Promise<Result<FileEntryDTO>> {
    const v = validateEntryName(name)
    if (!v.ok) return err(fileOpError('EINVAL', `잘못된 이름: ${v.reason}`, name))
    const full = joinWin(parentDir, name)
    try {
      // recursive:false → 동명 존재 시 EEXIST.
      await fsp.mkdir(full, { recursive: false })
    } catch (e) {
      return err(toFileOpError(e, full))
    }
    return ok(await this.toEntry(full, name))
  }

  /** 새 파일 생성(빈 파일 또는 템플릿). 동명 존재 시 EEXIST(flag 'wx'). */
  async createFile(parentDir: string, name: string, template?: string): Promise<Result<FileEntryDTO>> {
    const v = validateEntryName(name)
    if (!v.ok) return err(fileOpError('EINVAL', `잘못된 이름: ${v.reason}`, name))
    const full = joinWin(parentDir, name)
    try {
      // 'wx' = 쓰기 전용, 존재하면 실패(EEXIST). 빈 파일/템플릿 기록 후 닫기.
      const fh = await fsp.open(full, 'wx')
      try {
        if (template) await fh.writeFile(template, 'utf8')
      } finally {
        await fh.close()
      }
    } catch (e) {
      return err(toFileOpError(e, full))
    }
    return ok(await this.toEntry(full, name))
  }

  /** 이름변경(같은 부모 내). 동명 존재 시 EEXIST, 미존재 ENOENT, 권한 EACCES. */
  async rename(path: string, newName: string): Promise<Result<FileEntryDTO>> {
    const v = validateEntryName(newName)
    if (!v.ok) return err(fileOpError('EINVAL', `잘못된 이름: ${v.reason}`, newName))
    // 원본 존재 확인.
    try {
      await fsp.lstat(path)
    } catch (e) {
      return err(toFileOpError(e, path))
    }
    const parent = win32.dirname(path)
    const target = joinWin(parent, newName)
    // 대상이 이미 존재하면(대소문자만 다른 동일 경로는 허용) EEXIST.
    if (target.toLowerCase() !== path.toLowerCase()) {
      try {
        await fsp.access(target, fsConstants.F_OK)
        return err(fileOpError('EEXIST', '같은 이름의 항목이 이미 있습니다.', target))
      } catch {
        /* 대상 미존재 → 진행 */
      }
    }
    try {
      await fsp.rename(path, target)
    } catch (e) {
      return err(toFileOpError(e, target))
    }
    return ok(await this.toEntry(target, newName))
  }

  // ──────────────────────────────────────────────────────────────────
  // fs:drives — Windows 드라이브 열거 ("내 PC")
  // ──────────────────────────────────────────────────────────────────

  async drives(): Promise<Result<DriveDTO[]>> {
    try {
      const out: DriveDTO[] = []
      // A:~Z: 루트를 프로빙(접근 가능한 것만).
      for (let c = 67 /* 'C' */; c <= 90 /* 'Z' */; c++) {
        const letter = String.fromCharCode(c)
        const root = `${letter}:\\`
        let ready = false
        try {
          await fsp.access(root, fsConstants.F_OK)
          ready = true
        } catch {
          continue // 마운트 안 됨
        }
        const space = await this.diskSpace(root)
        out.push({
          path: root,
          label: `${letter}:\\`,
          letter,
          kind: this.guessDriveKind(root),
          totalBytes: space.total,
          freeBytes: space.free,
          ready
        })
      }
      // A:, B: (플로피/이동식) 도 접근 가능하면 추가.
      for (const letter of ['A', 'B']) {
        const root = `${letter}:\\`
        try {
          await fsp.access(root, fsConstants.F_OK)
          const space = await this.diskSpace(root)
          out.unshift({
            path: root,
            label: `${letter}:\\`,
            letter,
            kind: 'removable',
            totalBytes: space.total,
            freeBytes: space.free,
            ready: true
          })
        } catch {
          // 없음
        }
      }
      return ok(out)
    } catch (e) {
      return err(toFileOpError(e))
    }
  }

  /** statfs 기반 디스크 용량(가능한 경우). 실패 시 null. */
  private async diskSpace(root: string): Promise<{ total: number | null; free: number | null }> {
    try {
      // node:fs/promises.statfs 는 Node 18.15+ 제공.
      const statfs = (fsp as unknown as { statfs?: (p: string) => Promise<StatFsLike> }).statfs
      if (!statfs) return { total: null, free: null }
      const s = await statfs(root)
      const total = s.blocks * s.bsize
      const free = s.bavail * s.bsize
      return { total, free }
    } catch {
      return { total: null, free: null }
    }
  }

  /** 드라이브 종류 추정(P1 휴리스틱). 네트워크/이동식 정밀 판정은 후속. */
  private guessDriveKind(root: string): DriveKind {
    if (root.startsWith('\\\\')) return 'network'
    return 'fixed'
  }
}

interface StatFsLike {
  bsize: number
  blocks: number
  bavail: number
}

/** 싱글턴(핸들러가 공유). */
export const fileSystemService = new FileSystemService()
