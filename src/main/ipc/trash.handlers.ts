/**
 * trash:* IPC 핸들러 (K장 K2 — 휴지통 관리, K1 공유 · ADR-005).
 *
 * - trash:list    → sender 검증 후 recycleBinService.list() → ok(items).
 * - trash:restore → sender·zod 검증 + 각 id 가 `$Recycle.Bin` 경로 화이트리스트인지
 *                   재검증(임의 경로 실행 차단·방어 심층) 후 restore.
 * - trash:empty   → sender·zod 검증 + **confirmed === true 가 아니면 EINVAL 거부**
 *                   (전체 비우기 확인 게이트) 후 empty.
 *
 * 모든 핸들러 guard 통과(senderFrame·zod), 응답 Result<T,FileOpError>. service 는
 * throw 0(실패→ok:false 신호)이므로 핸들러는 try/catch → toFileOpError 로 1급 전파.
 * analyze.handlers.ts handleGuarded 패턴을 복제한다.
 */
import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import type { TrashItemDTO } from '@shared/dto'
import { CHANNELS } from '@shared/ipc/channels'
import type { Result } from '@shared/ipc/contracts'
import { err, ok } from '@shared/ipc/contracts'
import { fileOpError, toFileOpError } from '../fs/errors'
import { isRecycleBinPath, recycleBinService } from '../os/recycleBin'
import {
  isTrustedSender,
  parseArgs,
  untrustedSenderError,
  zTrashEmptyReq,
  zTrashRestoreReq
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

export function registerTrashHandlers(): void {
  // ── trash:list (휴지통 열거) ──────────────────────────────────────────
  // 인자 없음 → sender 검증만. service.list 는 throw 0(실패 시 빈 목록).
  ipcMain.handle(CHANNELS.TRASH_LIST, async (event): Promise<Result<TrashItemDTO[]>> => {
    if (!isTrustedSender(event)) return err(untrustedSenderError())
    try {
      const items = await recycleBinService.list()
      return ok(items)
    } catch (e) {
      return err(toFileOpError(e))
    }
  })

  // ── trash:restore (선택 항목 원위치 복원) ─────────────────────────────
  // zod(형태) + 각 id 의 $Recycle.Bin 화이트리스트 재검증. 화이트리스트 외 id 가
  // 1건이라도 섞이면 실행 없이 ESECURITY 거부(임의 경로 실행 차단).
  handleGuarded(CHANNELS.TRASH_RESTORE, zTrashRestoreReq, async (req): Promise<Result<void>> => {
    const bad = req.ids.find((id) => !isRecycleBinPath(id))
    if (bad !== undefined) {
      return err(fileOpError('ESECURITY', '휴지통 외 경로는 복원할 수 없습니다.', bad))
    }
    try {
      const r = await recycleBinService.restore(req.ids)
      if (!r.ok) {
        return err(fileOpError('EUNKNOWN', `복원에 실패했습니다${r.message ? `: ${r.message}` : '.'}`))
      }
      return ok(undefined)
    } catch (e) {
      return err(toFileOpError(e))
    }
  })

  // ── trash:empty (전체 비우기 — confirmed 게이트) ──────────────────────
  // confirmed 가 literal true 가 아니면 실행 없이 EINVAL 거부(확인 모달 미통과).
  handleGuarded(CHANNELS.TRASH_EMPTY, zTrashEmptyReq, async (req): Promise<Result<void>> => {
    if (req.confirmed !== true) {
      return err(fileOpError('EINVAL', '비우기 확인이 필요합니다.'))
    }
    try {
      const r = await recycleBinService.empty()
      if (!r.ok) {
        return err(fileOpError('EUNKNOWN', `비우기에 실패했습니다${r.message ? `: ${r.message}` : '.'}`))
      }
      return ok(undefined)
    } catch (e) {
      return err(toFileOpError(e))
    }
  })
}
