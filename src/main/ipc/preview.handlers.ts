/**
 * preview:* IPC 핸들러 (P6b 구현 — 미리보기 데이터 읽기, US-4.3).
 *
 * - preview:read → 활성 패널 단일 선택 항목의 미리보기 데이터를 읽는다.
 *     이미지(원본 바이트 base64 data URL)·텍스트(앞부분 64KB)·메타·미지원을
 *     kind 별 payload 로 반환한다. 형식 분기/상한/바이너리 판별은
 *     FileSystemService.readPreview 가 담당(SA §4).
 *
 * 도메인별 register 패턴 일관성(clipboard/op/session.handlers)을 위해 별도 파일.
 * 모든 핸들러 guard 통과(senderFrame·zod·guardPath), 응답 Result<T>(throw 금지).
 */
import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { CHANNELS } from '@shared/ipc/channels'
import type { Result, ThumbnailRes } from '@shared/ipc/contracts'
import { err, ok } from '@shared/ipc/contracts'
import type { PreviewData } from '@shared/dto'
import { fileSystemService } from '../fs/FileSystemService'
import { toFileOpError } from '../fs/errors'
import { getThumbnailDataUrl } from '../os/thumbnail'
import {
  guardPath,
  isTrustedSender,
  parseArgs,
  untrustedSenderError,
  zPreviewReadReq,
  zThumbnailReq
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

export function registerPreviewHandlers(): void {
  // ── preview:read (단일 경로 → 미리보기 데이터) ──────────────────────
  handleGuarded(CHANNELS.PREVIEW_READ, zPreviewReadReq, async (req): Promise<Result<PreviewData>> => {
    const g = guardPath(req.path)
    if (!g.ok) return g as Result<PreviewData>
    try {
      // readPreview 는 throw 하지 않지만(설계상), 방어적으로 감싼다.
      return ok(await fileSystemService.readPreview(g.value))
    } catch (e) {
      return err(toFileOpError(e, g.value))
    }
  })

  // ── preview:thumbnail (그리드 이미지 셀 → 비율 보존 축소 dataUrl, L장) ──
  // sender/parseArgs(size 버킷 화이트리스트)는 handleGuarded 가 처리. 여기선 guardPath
  // (정규화·상위이탈 차단)만 추가한다. "썸네일 불가"(미지원/손상/대용량/빈)는 예외가
  // 아니라 ok({dataUrl:null}) — 프런트가 OS 아이콘으로 폴백한다(throw 0).
  handleGuarded(CHANNELS.PREVIEW_THUMBNAIL, zThumbnailReq, async (req): Promise<Result<ThumbnailRes>> => {
    const g = guardPath(req.path)
    if (!g.ok) return g as Result<ThumbnailRes>
    const dataUrl = await getThumbnailDataUrl({
      path: g.value,
      size: req.size,
      ...(req.mtime !== undefined ? { mtime: req.mtime } : {})
    })
    return ok({ dataUrl })
  })
}
