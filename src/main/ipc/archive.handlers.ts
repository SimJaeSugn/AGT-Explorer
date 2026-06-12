/**
 * archive:* IPC 핸들러 (§Q1 M9 — 압축파일 어댑터, ADR-008).
 *
 * zip 열기/탐색(open/list/close)·추출(extract)·추가(add)를 연결한다. 본 파일은 **압축
 * 라이브러리를 직접 import 하지 않는다** — archive/ 배럴이 노출하는 매니저/서비스만 호출한다
 * (yauzl/yazl 은 archive/ 안에 캡슐화 · ESLint 화이트리스트 · remote.handlers 모델 동형).
 *
 * 보안(throw 0 · Result · zod · sender · path-whitelist):
 *  - 모든 핸들러 guard 통과(senderFrame·zod).
 *  - 로컬 경로(archivePath/destDir/localPaths)는 guardPath 로 정규화·상위이탈 차단 + 원격
 *    (sftp://·ftp://) prefix 거부(1차 로컬만 · ADR-008 결정⑤). archivePath 는 실존·파일 검증.
 *  - 추출/추가는 ArchiveService 가 Worker 로 위임하고 **op:* 스트림 재사용**(operationId 만 반환).
 *    Zip Slip 강제는 워커(archiveSafePath 순수규칙)가 수행(이중 방어).
 */
import * as fsp from 'node:fs/promises'
import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { CHANNELS } from '@shared/ipc/channels'
import type {
  ArchiveListRes,
  ArchiveOpenRes,
  ArchiveTransferRes,
  Result
} from '@shared/ipc/contracts'
import { err } from '@shared/ipc/contracts'
import { fileOpError } from '../fs/errors'
import { archiveService, archiveSessionManager } from '../archive'
import {
  guardPath,
  isTrustedSender,
  parseArgs,
  untrustedSenderError,
  zArchiveAddReq,
  zArchiveCloseReq,
  zArchiveExtractReq,
  zArchiveListReq,
  zArchiveOpenReq
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

/** 원격(sftp://·ftp://·ftps://)·압축(archive://) prefix 거부 — 로컬 경로만 허용(ADR-008 결정⑤). */
function isLocalOnly(p: string): boolean {
  return !/^(sftp|ftp|ftps|archive):\/\//i.test(p)
}

export function registerArchiveHandlers(): void {
  // ── open: zip central directory 열기·세션 발급(암호 zip → EUNSUPPORTED) ──
  handleGuarded(
    CHANNELS.ARCHIVE_OPEN,
    zArchiveOpenReq,
    async (req): Promise<Result<ArchiveOpenRes>> => {
      if (!isLocalOnly(req.archivePath)) {
        return err(fileOpError('EACCES', '원격/압축 경로의 zip 은 1차 지원하지 않습니다.', req.archivePath))
      }
      const g = guardPath(req.archivePath)
      if (!g.ok) return g as Result<ArchiveOpenRes>
      // 실존·파일 검증(디렉토리·없음 거부).
      const st = await fsp.stat(g.value).catch(() => null)
      if (!st || !st.isFile()) {
        return err(fileOpError('ENOENT', '압축 파일을 찾을 수 없습니다.', g.value))
      }
      return archiveSessionManager().open(g.value)
    }
  )

  // ── list: innerPath 디렉토리의 직속 엔트리(정규화 FileEntryDTO) ──────────
  handleGuarded(
    CHANNELS.ARCHIVE_LIST,
    zArchiveListReq,
    async (req): Promise<Result<ArchiveListRes>> =>
      archiveSessionManager().list(req.sessionId, req.innerPath)
  )

  // ── close: 세션·핸들 정리(멱등) ─────────────────────────────────────────
  handleGuarded(CHANNELS.ARCHIVE_CLOSE, zArchiveCloseReq, async (req): Promise<Result<void>> =>
    archiveSessionManager().close(req.sessionId)
  )

  // ── extract: archive→local. op:* 재사용·Zip Slip 차단(워커) ─────────────
  handleGuarded(
    CHANNELS.ARCHIVE_EXTRACT,
    zArchiveExtractReq,
    async (req, event): Promise<Result<ArchiveTransferRes>> => {
      const archivePath = archiveSessionManager().getArchivePath(req.sessionId)
      if (!archivePath) return err(fileOpError('ENOENT', '유효하지 않은 압축 세션입니다.'))
      // 로컬 도착지 guardPath(정규화·상위이탈 차단 — Zip Slip 1차 방어) + 원격 prefix 거부.
      if (!isLocalOnly(req.destDir)) {
        return err(fileOpError('EACCES', '원격 도착지로는 추출할 수 없습니다.', req.destDir))
      }
      const g = guardPath(req.destDir)
      if (!g.ok) return g as Result<ArchiveTransferRes>
      return archiveService().startExtract(
        archivePath,
        req.innerPaths,
        g.value,
        event.sender,
        req.conflictPolicy
      )
    }
  )

  // ── add: local→archive(재작성). op:* 재사용 ─────────────────────────────
  handleGuarded(
    CHANNELS.ARCHIVE_ADD,
    zArchiveAddReq,
    async (req, event): Promise<Result<ArchiveTransferRes>> => {
      const archivePath = archiveSessionManager().getArchivePath(req.sessionId)
      if (!archivePath) return err(fileOpError('ENOENT', '유효하지 않은 압축 세션입니다.'))
      // 로컬 소스 guardPath(정규화·상위이탈 차단) + 원격 prefix 거부.
      const localPaths: string[] = []
      for (const p of req.localPaths) {
        if (!isLocalOnly(p)) {
          return err(fileOpError('EACCES', '원격/압축 경로는 추가 소스로 쓸 수 없습니다.', p))
        }
        const g = guardPath(p)
        if (!g.ok) return g as Result<ArchiveTransferRes>
        localPaths.push(g.value)
      }
      return archiveService().startAdd(
        archivePath,
        localPaths,
        req.innerDir,
        req.conflictPolicy,
        event.sender
      )
    }
  )
}
