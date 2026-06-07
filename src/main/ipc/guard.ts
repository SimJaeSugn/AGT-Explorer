/**
 * IPC 핸들러 가드 (ADR-005 §3.3 방어 심층).
 *
 * 모든 핸들러는 이 가드를 통과한다:
 *   1) senderFrame 출처 검증 — 우리 렌더러(로컬 번들/dev 서버)에서 온 호출만 수용.
 *   2) zod 스키마로 인자 형태 재검증(Preload 1차 + Main 2차).
 *   3) 경로 정규화·상위이탈(`..`) 차단(normalizePath).
 *
 * 검증 실패는 throw 가 아니라 Result.err(ESECURITY/EINVAL) 로 1급 전파한다(ADR-003).
 */
import type { IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import type { FileOpError, Result } from '@shared/ipc/contracts'
import { err } from '@shared/ipc/contracts'
import { fileOpError } from '../fs/errors'
import { normalizePath } from '../fs/paths'

/**
 * senderFrame 출처 검증.
 * - dev: ELECTRON_RENDERER_URL(예: http://localhost:xxxx) 출처 허용.
 * - prod: file:// 로컬 번들 출처 허용.
 * 그 외 출처(원격·iframe 주입)는 거부한다.
 */
export function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame
  if (!frame) return false
  const url = frame.url
  if (!url) return false

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl && url.startsWith(devUrl)) return true
  // prod: 로컬 파일 번들.
  if (url.startsWith('file://')) return true
  return false
}

/** zod 스키마 검증 + 결과를 Result 로 래핑하는 헬퍼. */
export function parseArgs<T>(schema: z.ZodType<T>, raw: unknown): Result<T> {
  const r = schema.safeParse(raw)
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    return err(fileOpError('EINVAL', `잘못된 요청 인자 — ${msg}`))
  }
  return { ok: true, value: r.data }
}

/**
 * 경로 1건을 정규화·검증한다. 상위이탈/상대경로/빈 경로는 ESECURITY/EINVAL.
 * 성공 시 정규화된 경로 문자열을 반환.
 */
export function guardPath(input: string): Result<string> {
  const r = normalizePath(input)
  if (!r.ok) {
    const code = r.reason?.includes('이탈') ? 'ESECURITY' : 'EINVAL'
    return err(fileOpError(code, `경로 거부: ${r.reason ?? '유효하지 않음'}`, input))
  }
  return { ok: true, value: r.path }
}

/** 신뢰되지 않은 sender 에 대한 표준 거부 에러. */
export const untrustedSenderError = (): FileOpError =>
  fileOpError('ESECURITY', '신뢰되지 않은 호출 출처')

// ── 공용 zod 스키마(핸들러가 재사용) ───────────────────────────────────
export const zPath = z.string().min(1)

export const zFsListReq = z.object({ path: zPath, showHidden: z.boolean() })
export const zFsStatReq = z.object({ path: zPath })
export const zFsTreeChildrenReq = z.object({ path: zPath })
export const zFsValidatePathReq = z.object({ path: zPath })
export const zFsListStartReq = z.object({
  path: zPath,
  showHidden: z.boolean(),
  chunkSize: z.number().int().positive().optional()
})
export const zFsListCancelReq = z.object({ streamId: z.string().min(1) })

// ── P4: fs 단발 / op:* / clipboard:* / dialog:* / shell:show-properties ──
export const zFsMkdirReq = z.object({ parentDir: zPath, name: z.string().min(1) })
export const zFsCreateFileReq = z.object({
  parentDir: zPath,
  name: z.string().min(1),
  template: z.string().optional()
})
export const zFsRenameReq = z.object({ path: zPath, newName: z.string().min(1) })

const zOpKind = z.enum(['copy', 'move', 'delete', 'trash'])
const zConflictResolution = z.enum(['overwrite', 'skip', 'rename', 'merge'])
export const zOpStartReq = z.object({
  kind: zOpKind,
  sources: z.array(zPath).min(1),
  destDir: zPath.optional(),
  conflictPolicy: zConflictResolution.optional()
})
export const zOpResolveReq = z.object({
  operationId: z.string().min(1),
  conflictId: z.string().min(1),
  resolution: zConflictResolution,
  applyToAll: z.boolean()
})
export const zOpCancelReq = z.object({ operationId: z.string().min(1) })

export const zClipboardFilesReq = z.object({ paths: z.array(zPath).min(1) })
export const zClipboardPasteTargetReq = z.object({ destDir: zPath })
export const zDialogConfirmPermanentDeleteReq = z.object({ paths: z.array(zPath).min(1) })
export const zShellShowPropertiesReq = z.object({ path: zPath })
export const zShellOpenWithReq = z.object({ path: zPath })

// ── P5: session:* / settings:* / telemetry:set-opt-in ────────────────────
// SessionSnapshot 은 구조가 깊고 Renderer 가 생성한 직렬화 객체이므로,
// 형태 1차만 통과시키고(중첩 무효 필드는 Store 의 coerceSession 이 정규화),
// 본문 정규화는 persistence 계층에 위임한다(단일 책임).
const zThemeMode = z.enum(['light', 'dark', 'system'])
export const zSessionSaveReq = z.object({
  snapshot: z.object({ version: z.number() }).passthrough()
})
export const zSettingsSetReq = z.object({
  patch: z
    .object({
      theme: zThemeMode.optional(),
      startLocation: z.string().optional(),
      showHidden: z.boolean().optional(),
      showExtensions: z.boolean().optional(),
      recentLimit: z.number().int().optional()
    })
    .strict()
})
export const zTelemetrySetOptInReq = z.object({ enabled: z.boolean() })

// ── P6: preview:* / workspace:* ──────────────────────────────────────────
// preview:read 는 단일 경로만(가드가 guardPath 로 정규화·상위이탈 차단).
export const zPreviewReadReq = z.object({ path: zPath })

// workspace:* — SessionSnapshot 은 깊은 직렬화 객체이므로 형태 1차(version)만
// 통과시키고 본문 정규화는 WorkspaceStore 의 coerceSession 에 위임한다
// (zSessionSaveReq 와 동일 정책). name 은 파일명으로 쓰이므로 Store 에서 추가
// 새니타이즈(경로 분리자·`..`·예약명 차단)한다.
export const zWorkspaceSaveReq = z.object({
  name: z.string().min(1).max(120),
  snapshot: z.object({ version: z.number() }).passthrough()
})
export const zWorkspaceLoadReq = z.object({ name: z.string().min(1).max(120) })
export const zWorkspaceDeleteReq = z.object({ name: z.string().min(1).max(120) })
