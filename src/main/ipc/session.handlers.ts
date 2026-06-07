/**
 * session:* / settings:* / telemetry:set-opt-in IPC 핸들러 (P5 구현).
 *
 * - session:load  → 디스크 세션 로드(손상/구버전 안전 폴백).
 * - session:save  → 디바운스 자동 저장(연속 변경 합산, before-quit 에서 flush).
 * - settings:get  → 현재 설정(테마·시작위치·숨김·확장자·최근 개수).
 * - settings:set  → 부분 패치 즉시 원자적 영속 → 갱신된 전체 스냅샷 반환.
 * - telemetry:set-opt-in → 옵트인 플래그 영속(기본 false, D5). 전송은 미구현.
 * - telemetry:get-opt-in → 부팅 재수화용 옵트인 실제 값 조회(디스크 telemetry.json).
 *
 * 모든 핸들러 guard 통과(senderFrame·zod), 응답 Result<T,FileOpError>(throw 금지).
 * 본문 정규화(휘발 제외·무효 필드 폴백)는 persistence 계층(coerce*)에 위임한다.
 */
import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { CHANNELS } from '@shared/ipc/channels'
import type { Result, TelemetryGetOptInRes } from '@shared/ipc/contracts'
import { err, ok } from '@shared/ipc/contracts'
import type { SessionSnapshot, SettingsSnapshot } from '@shared/dto'
import { sessionStore, settingsStore } from '../persistence'
import { toFileOpError } from '../fs/errors'
import {
  isTrustedSender,
  parseArgs,
  untrustedSenderError,
  zSessionSaveReq,
  zSettingsSetReq,
  zTelemetrySetOptInReq
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

export function registerSessionHandlers(): void {
  // ── session:load (인자 없음 → sender 검증만) ─────────────────────────
  ipcMain.handle(CHANNELS.SESSION_LOAD, async (event): Promise<Result<SessionSnapshot>> => {
    if (!isTrustedSender(event)) return err(untrustedSenderError())
    try {
      return ok(await sessionStore().load())
    } catch (e) {
      return err(toFileOpError(e))
    }
  })

  // ── session:save (디바운스 자동 저장) ────────────────────────────────
  handleGuarded(CHANNELS.SESSION_SAVE, zSessionSaveReq, async (req): Promise<Result<void>> => {
    try {
      // zod passthrough 로 형태만 통과 → Store 가 coerce 로 정규화.
      await sessionStore().save(req.snapshot as unknown as SessionSnapshot)
      return ok(undefined)
    } catch (e) {
      return err(toFileOpError(e))
    }
  })

  // ── settings:get (인자 없음) ─────────────────────────────────────────
  ipcMain.handle(CHANNELS.SETTINGS_GET, async (event): Promise<Result<SettingsSnapshot>> => {
    if (!isTrustedSender(event)) return err(untrustedSenderError())
    return ok(settingsStore().get())
  })

  // ── settings:set (부분 패치 → 영속 → 갱신본 반환) ────────────────────
  handleGuarded(CHANNELS.SETTINGS_SET, zSettingsSetReq, async (req): Promise<Result<SettingsSnapshot>> => {
    try {
      return ok(await settingsStore().set(req.patch as Partial<SettingsSnapshot>))
    } catch (e) {
      return err(toFileOpError(e))
    }
  })

  // ── telemetry:set-opt-in (플래그만 영속, 기본 false, D5) ─────────────
  handleGuarded(
    CHANNELS.TELEMETRY_SET_OPT_IN,
    zTelemetrySetOptInReq,
    async (req): Promise<Result<void>> => {
      try {
        await settingsStore().setTelemetryOptIn(req.enabled)
        return ok(undefined)
      } catch (e) {
        return err(toFileOpError(e))
      }
    }
  )

  // ── telemetry:get-opt-in (부팅 재수화 — 디스크 실제 값, 인자 없음) ────
  // loadSettings 부팅 시 telemetry.json 저장값을 정확히 재수화한다([중대-3]).
  ipcMain.handle(
    CHANNELS.TELEMETRY_GET_OPT_IN,
    async (event): Promise<Result<TelemetryGetOptInRes>> => {
      if (!isTrustedSender(event)) return err(untrustedSenderError())
      return ok({ optIn: settingsStore().isTelemetryOptIn() })
    }
  )
}
