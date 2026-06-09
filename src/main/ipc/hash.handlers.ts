/**
 * hash:* IPC 핸들러 (M7 — 공용 해시·비교 엔진, ADR-009).
 *
 * - hash:compare:start → guardPath(left/right) + 디렉토리 검증 후 HashManager.startCompare.
 * - hash:dup:start     → roots[] 각 guardPath + 디렉토리 검증 후 startDup.
 * - hash:verify:start  → pairs[].src/.dst 각 guardPath + 파일 검증 후 startVerify.
 * - hash:cancel        → HashManager.cancel(jobId).
 * - progress/done/error 는 HashManager 가 event.sender 로 직접 푸시.
 *
 * 보안(ADR-005): 전부 로컬 한정 — 원격 prefix(sftp://·ftp://·archive://) 거부.
 * 모든 핸들러 guard 통과(senderFrame·zod·경로 정규화), 응답 Result<T,FileOpError>.
 * analyze.handlers.ts handleGuarded 패턴을 복제한다.
 */
import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import * as fsp from 'node:fs/promises'
import { CHANNELS } from '@shared/ipc/channels'
import type {
  HashCompareStartReq,
  HashDupStartReq,
  HashJobStartRes,
  HashVerifyStartReq,
  Result
} from '@shared/ipc/contracts'
import { err } from '@shared/ipc/contracts'
import { fileOpError, toFileOpError } from '../fs/errors'
import { hashManager } from '../hash/HashManager'
import {
  guardPath,
  isTrustedSender,
  parseArgs,
  untrustedSenderError,
  zHashCancelReq,
  zHashCompareStartReq,
  zHashDupStartReq,
  zHashVerifyStartReq
} from './guard'

function handleGuarded<TSchema extends import('zod').ZodTypeAny, TVal>(
  channel: string,
  schema: TSchema,
  fn: (
    req: import('zod').infer<TSchema>,
    event: IpcMainInvokeEvent
  ) => Promise<Result<TVal>> | Result<TVal>
): void {
  ipcMain.handle(channel, async (event, raw): Promise<Result<TVal>> => {
    if (!isTrustedSender(event)) return err(untrustedSenderError())
    const parsed = parseArgs(schema, raw)
    if (!parsed.ok) return parsed as Result<TVal>
    return fn(parsed.value, event)
  })
}

/** 원격/아카이브 prefix 거부(로컬 한정 — §5-PU.3 규칙12). */
const REMOTE_PREFIXES = ['sftp://', 'ftp://', 'ftps://', 'archive://']
function isRemotePath(raw: string): boolean {
  const lower = raw.toLowerCase()
  return REMOTE_PREFIXES.some((p) => lower.startsWith(p))
}

/** 경로 1건 정규화 + 종류 검증(dir/file). 원격 prefix·상위이탈·종류 불일치는 err. */
async function resolveLocal(
  raw: string,
  kind: 'dir' | 'file'
): Promise<Result<string>> {
  if (isRemotePath(raw)) {
    return err(fileOpError('ESECURITY', '해시 작업은 로컬 경로만 지원합니다(원격 거부).', raw))
  }
  const g = guardPath(raw)
  if (!g.ok) return g
  try {
    const st = await fsp.stat(g.value)
    if (kind === 'dir' && !st.isDirectory()) {
      return err(fileOpError('ENOTDIR', '대상이 폴더가 아닙니다.', g.value))
    }
    if (kind === 'file' && !st.isFile()) {
      return err(fileOpError('EISDIR', '대상이 파일이 아닙니다.', g.value))
    }
  } catch (e) {
    return err(toFileOpError(e, g.value))
  }
  return { ok: true, value: g.value }
}

export function registerHashHandlers(): void {
  // ── hash:compare:start ───────────────────────────────────────────
  handleGuarded(
    CHANNELS.HASH_COMPARE_START,
    zHashCompareStartReq,
    async (req, event): Promise<Result<HashJobStartRes>> => {
      const l = await resolveLocal(req.leftDir, 'dir')
      if (!l.ok) return l as Result<HashJobStartRes>
      const r = await resolveLocal(req.rightDir, 'dir')
      if (!r.ok) return r as Result<HashJobStartRes>
      const normalized: HashCompareStartReq = {
        leftDir: l.value,
        rightDir: r.value,
        useHash: req.useHash,
        recursive: req.recursive,
        ...(req.algo ? { algo: req.algo } : {})
      }
      return hashManager.startCompare(normalized, event.sender)
    }
  )

  // ── hash:dup:start ───────────────────────────────────────────────
  handleGuarded(
    CHANNELS.HASH_DUP_START,
    zHashDupStartReq,
    async (req, event): Promise<Result<HashJobStartRes>> => {
      const roots: string[] = []
      for (const raw of req.roots) {
        const g = await resolveLocal(raw, 'dir')
        if (!g.ok) return g as Result<HashJobStartRes>
        roots.push(g.value)
      }
      const normalized: HashDupStartReq = {
        roots,
        ...(req.minSize !== undefined ? { minSize: req.minSize } : {}),
        ...(req.algo ? { algo: req.algo } : {})
      }
      return hashManager.startDup(normalized, event.sender)
    }
  )

  // ── hash:verify:start ────────────────────────────────────────────
  handleGuarded(
    CHANNELS.HASH_VERIFY_START,
    zHashVerifyStartReq,
    async (req, event): Promise<Result<HashJobStartRes>> => {
      const pairs: { src: string; dst: string }[] = []
      for (const pair of req.pairs) {
        const s = await resolveLocal(pair.src, 'file')
        if (!s.ok) return s as Result<HashJobStartRes>
        const d = await resolveLocal(pair.dst, 'file')
        if (!d.ok) return d as Result<HashJobStartRes>
        pairs.push({ src: s.value, dst: d.value })
      }
      const normalized: HashVerifyStartReq = {
        pairs,
        ...(req.algo ? { algo: req.algo } : {})
      }
      return hashManager.startVerify(normalized, event.sender)
    }
  )

  // ── hash:cancel ──────────────────────────────────────────────────
  handleGuarded(CHANNELS.HASH_CANCEL, zHashCancelReq, (req) => hashManager.cancel(req.jobId))
}
