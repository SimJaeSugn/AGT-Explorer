/**
 * clipboard:* IPC 핸들러 (P4 구현 — 파일 클립보드).
 *
 * - clipboard:copy-files / cut-files → 내부 클립보드 상태 갱신(+OS 텍스트 경로).
 * - clipboard:read → 담긴 경로·effect(copy/cut/none) 반환.
 * - clipboard:paste-target → 담긴 effect 에 따라 OperationManager 로
 *     copy(붙여넣기) / move(잘라내기 붙여넣기) 작업 시작. cut 은 1회 후 비움.
 *
 * 진행률/충돌/완료는 op:* 이벤트(operationId 포함)로 관찰한다. paste-target 의
 * 응답은 계약상 Result<void> 이므로, 실제 진행은 op:progress/op:done 으로 추적한다.
 *
 * §M M2: Windows CF_HDROP(탐색기와 양방향 붙여넣기)는 os/shellClipboard.ts 가
 * PowerShell + .NET System.Windows.Forms.Clipboard 로 실제 표준 CF_HDROP 셸 연동을
 * 제공한다(write/read/has 비동기). 기존 4채널·fileClipboard.ts(앱 내부 상태)는 병존.
 */
import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { constants as fsConstants } from 'node:fs'
import * as fsp from 'node:fs/promises'
import { CHANNELS } from '@shared/ipc/channels'
import type {
  ClipboardFilesReadRes,
  ClipboardHasFilesRes,
  ClipboardReadRes,
  OpStartRes,
  Result
} from '@shared/ipc/contracts'
import { err, ok } from '@shared/ipc/contracts'
import { clearAfterPaste, readClipboard, setClipboard } from '../os/fileClipboard'
import {
  hasFilesOnClipboard,
  readFilesFromClipboard,
  writeFilesToClipboard
} from '../os/shellClipboard'
import { operationManager } from '../operations/OperationManager'
import { fileOpError, toFileOpError } from '../fs/errors'
import {
  guardPath,
  isTrustedSender,
  parseArgs,
  untrustedSenderError,
  zClipboardFilesReq,
  zClipboardPasteTargetReq,
  zClipboardWriteFilesReq
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

export function registerClipboardHandlers(): void {
  // ── clipboard:copy-files ─────────────────────────────────────────
  handleGuarded(CHANNELS.CLIPBOARD_COPY_FILES, zClipboardFilesReq, (req) => {
    const paths: string[] = []
    for (const p of req.paths) {
      const g = guardPath(p)
      if (!g.ok) return g as Result<void>
      paths.push(g.value)
    }
    setClipboard(paths, 'copy')
    return ok(undefined)
  })

  // ── clipboard:cut-files ──────────────────────────────────────────
  handleGuarded(CHANNELS.CLIPBOARD_CUT_FILES, zClipboardFilesReq, (req) => {
    const paths: string[] = []
    for (const p of req.paths) {
      const g = guardPath(p)
      if (!g.ok) return g as Result<void>
      paths.push(g.value)
    }
    setClipboard(paths, 'cut')
    return ok(undefined)
  })

  // ── clipboard:read ───────────────────────────────────────────────
  ipcMain.handle(CHANNELS.CLIPBOARD_READ, async (event): Promise<Result<ClipboardReadRes>> => {
    if (!isTrustedSender(event)) return err(untrustedSenderError())
    const c = readClipboard()
    return ok({ paths: c.paths, effect: c.effect })
  })

  // ── clipboard:paste-target ───────────────────────────────────────
  // effect(copy/cut)에 따라 OperationManager 로 op 를 시작하고 operationId 를
  // 반환한다(op:start 와 동일 파이프라인 — 진행률/충돌/완료를 그 id 로 상관).
  // BUG-001 수정: 이전엔 Result<void> 라 렌더러가 op 라이프사이클을 못 잡아
  // ProgressDialog/ConflictDialog 미표시·충돌 시 hang 이 발생했다.
  handleGuarded(CHANNELS.CLIPBOARD_PASTE_TARGET, zClipboardPasteTargetReq, async (req, event) => {
    const gd = guardPath(req.destDir)
    if (!gd.ok) return gd as Result<OpStartRes>

    const clip = readClipboard()
    if (clip.effect === 'none' || clip.paths.length === 0) {
      return err(fileOpError('EINVAL', '클립보드에 붙여넣을 파일이 없습니다.'))
    }
    const kind = clip.effect === 'cut' ? 'move' : 'copy'
    const r = await operationManager.start(kind, clip.paths, gd.value, undefined, event.sender)
    if (!r.ok) return r as Result<OpStartRes>
    // 잘라내기 1회 소비(op 시작 성공 시점에 소비 — 기존 동작 유지).
    clearAfterPaste()
    // op:start 와 동일 shape({operationId})를 반환해 렌더러가 registerOperation 가능.
    return ok(r.value)
  })

  // ──────────────────────────────────────────────────────────────────────
  // §M M2: CF_HDROP 양방향 (신규 3채널 — 기존 4채널과 비파괴 병존, impl: MP2)
  //   `os/shellClipboard.ts`(DROPFILES·Preferred DropEffect 조립/파싱)를 호출한다.
  //   기존 4채널·fileClipboard.ts·내부 복사/붙여넣기(B4)는 무변경(병존).
  // ──────────────────────────────────────────────────────────────────────

  // ── clipboard:write-files (CF_HDROP 쓰기) ────────────────────────────
  // 각 path 를 guardPath(정규화·상위이탈 차단·로컬만) 후 CF_HDROP+Preferred
  // DropEffect 로 시스템 클립보드에 적재한다(탐색기·타 앱이 copy/move 구분).
  handleGuarded(
    CHANNELS.CLIPBOARD_WRITE_FILES,
    zClipboardWriteFilesReq,
    async (req): Promise<Result<void>> => {
      const paths: string[] = []
      for (const p of req.paths) {
        const g = guardPath(p)
        if (!g.ok) return g as Result<void>
        paths.push(g.value)
      }
      try {
        await writeFilesToClipboard(paths, req.effect)
      } catch (e) {
        return err(toFileOpError(e))
      }
      return ok(undefined)
    }
  )

  // ── clipboard:read-files (CF_HDROP 읽기) ─ 인자 없음 → sender 검증만 ──
  // 외부(탐색기 등)에서 복사/잘라낸 CF_HDROP 도 파싱한다. 읽은 경로는 **불신
  // 입력**(ADR-007 ⑥): guardPath 정규화 + 실존 확인(F_OK)을 통과한 항목만 반환한다.
  // 비파일 클립보드/손상 buffer 는 정상 빈 결과({paths:[],effect:'none'}).
  ipcMain.handle(
    CHANNELS.CLIPBOARD_READ_FILES,
    async (event): Promise<Result<ClipboardFilesReadRes>> => {
      if (!isTrustedSender(event)) return err(untrustedSenderError())
      let raw: { paths: string[]; effect: 'copy' | 'move' | 'none' }
      try {
        raw = await readFilesFromClipboard()
      } catch (e) {
        return err(toFileOpError(e))
      }
      if (raw.paths.length === 0) return ok({ paths: [], effect: 'none' })

      const verified: string[] = []
      for (const p of raw.paths) {
        const g = guardPath(p)
        if (!g.ok) continue // 외부 입력 불신 — 정규화 실패 항목 제외.
        try {
          await fsp.access(g.value, fsConstants.F_OK)
          verified.push(g.value)
        } catch {
          /* 미존재 항목 제외(부분) */
        }
      }
      if (verified.length === 0) return ok({ paths: [], effect: 'none' })
      return ok({ paths: verified, effect: raw.effect })
    }
  )

  // ── clipboard:has-files (CF_HDROP 존재) ─ 인자 없음 → sender 검증만 ──
  ipcMain.handle(
    CHANNELS.CLIPBOARD_HAS_FILES,
    async (event): Promise<Result<ClipboardHasFilesRes>> => {
      if (!isTrustedSender(event)) return err(untrustedSenderError())
      return ok({ has: await hasFilesOnClipboard() })
    }
  )
}
