/**
 * search:content:* IPC 핸들러 (M8 — 내용 검색 grep, ADR-010).
 *
 * - search:content:start  → guardPath(root) + 디렉토리 검증 + 원격 prefix 거부(로컬 한정)
 *                           후 GrepManager.start(정규식 사전 컴파일 검증 포함).
 * - search:content:cancel → GrepManager.cancel(jobId).
 * - progress/match/done 는 GrepManager 가 event.sender 로 직접 푸시.
 *
 * 보안(ADR-005): 전부 로컬 한정 — 원격 prefix(sftp://·ftp://·archive://) 거부.
 * 모든 핸들러 guard 통과(senderFrame·zod·경로 정규화), 응답 Result<T,FileOpError>.
 * analyze.handlers.ts·hash.handlers.ts handleGuarded 패턴을 복제한다.
 */
import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import * as fsp from 'node:fs/promises'
import { CHANNELS } from '@shared/ipc/channels'
import type { Result, SearchContentStartReq, SearchContentStartRes } from '@shared/ipc/contracts'
import { err } from '@shared/ipc/contracts'
import { fileOpError, toFileOpError } from '../fs/errors'
import { grepManager } from '../search/GrepManager'
import {
  guardPath,
  isTrustedSender,
  parseArgs,
  untrustedSenderError,
  zSearchContentCancelReq,
  zSearchContentStartReq
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

/** 원격/아카이브 prefix 거부(로컬 한정 — ADR-005·hash.handlers 동형). */
const REMOTE_PREFIXES = ['sftp://', 'ftp://', 'ftps://', 'archive://']
function isRemotePath(raw: string): boolean {
  const lower = raw.toLowerCase()
  return REMOTE_PREFIXES.some((p) => lower.startsWith(p))
}

export function registerSearchHandlers(): void {
  // ── search:content:start ─────────────────────────────────────────
  handleGuarded(
    CHANNELS.SEARCH_CONTENT_START,
    zSearchContentStartReq,
    async (req, event): Promise<Result<SearchContentStartRes>> => {
      if (isRemotePath(req.root)) {
        return err(fileOpError('ESECURITY', '내용 검색은 로컬 경로만 지원합니다(원격 거부).', req.root))
      }
      const g = guardPath(req.root)
      if (!g.ok) return g as Result<SearchContentStartRes>
      // 루트는 존재하는 디렉토리여야 한다(파일/미존재 거부).
      try {
        const st = await fsp.stat(g.value)
        if (!st.isDirectory()) {
          return err(fileOpError('ENOTDIR', '검색 대상이 폴더가 아닙니다.', g.value))
        }
      } catch (e) {
        return err(toFileOpError(e, g.value))
      }
      const normalized: SearchContentStartReq = {
        root: g.value,
        query: req.query,
        isRegex: req.isRegex,
        recursive: req.recursive,
        ...(req.includeHidden !== undefined ? { includeHidden: req.includeHidden } : {}),
        ...(req.maxFileBytes !== undefined ? { maxFileBytes: req.maxFileBytes } : {})
      }
      return grepManager.start(normalized, event.sender)
    }
  )

  // ── search:content:cancel ────────────────────────────────────────
  handleGuarded(CHANNELS.SEARCH_CONTENT_CANCEL, zSearchContentCancelReq, (req) =>
    grepManager.cancel(req.jobId)
  )
}
