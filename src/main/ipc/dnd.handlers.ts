/**
 * dnd:* IPC 핸들러 (§M M1 — 외부 드래그, 실구현 MP3).
 *
 * dnd:start-drag: 검증된 로컬 파일 경로(들)를 OS/타앱으로 드래그 시작.
 *   1) sender(senderFrame) + zod(zDndStartDragReq) — handleGuarded.
 *   2) 각 path 화이트리스트 검증(validateDragPaths):
 *        · 원격 네임스페이스(sftp://·ftp://·ftps://) prefix → ESECURITY(로컬만 외부 노출)
 *        · guardPath(win32 정규화·상위이탈 차단)
 *        · fsp.access(존재·접근 가능) — 미존재 → ENOENT
 *   3) 대표 아이콘 확정(resolveRepresentativeIcon): app.getFileIcon(기존 os/icon.ts 소스)
 *        → dataUrl → nativeImage. 실패/빈 → 번들/내장 fallback(빈 아이콘 금지·CN-2).
 *   4) startExternalDrag(event.sender, paths, icon) → Result<{started}>.
 *
 * 외부로 나가는 것은 검증된 로컬 파일 경로뿐(ADR-007 ⑦·ADR-005). 외부 드롭은 항상 복사
 * (이동 미지원·1차 결정). 도착지가 앱 내부 패널이면 렌더러가 이 채널을 호출하지 않고
 * 기존 A3 D&D(op:start)를 쓴다(분기는 렌더러 드롭 타겟 판정 — MP5).
 *
 * 모든 핸들러 guard 통과(senderFrame·zod), 응답 Result<T,FileOpError>, throw 0(ADR-003).
 * analyze/trash/watch.handlers.ts 의 handleGuarded 패턴을 복제한다.
 */
import * as fsp from 'node:fs/promises'
import { app, ipcMain } from 'electron'
import type { IpcMainInvokeEvent, NativeImage, WebContents } from 'electron'
import { CHANNELS } from '@shared/ipc/channels'
import type { DndStartDragRes, Result } from '@shared/ipc/contracts'
import { err, ok } from '@shared/ipc/contracts'
import { resolveDragIcon, startExternalDrag } from '../os/dragdrop'
import { fileOpError } from '../fs/errors'
import { guardPath, isTrustedSender, parseArgs, untrustedSenderError, zDndStartDragReq } from './guard'

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

/** 원격 네임스페이스 prefix(외부 드래그 금지 — 로컬 FS 항목만 OS 로 노출). */
const REMOTE_PREFIXES = ['sftp://', 'ftp://', 'ftps://'] as const

/** path 가 원격 네임스페이스 prefix 로 시작하는지(대소문자 무시). */
function isRemotePath(p: string): boolean {
  const lower = p.toLowerCase()
  return REMOTE_PREFIXES.some((pre) => lower.startsWith(pre))
}

/**
 * 드래그 경로 목록 화이트리스트 검증(핸들러 보안 게이트 — IPC/sender 래퍼 분리, verify 재사용).
 *   · 원격 prefix → ESECURITY(로컬만 외부 노출).
 *   · guardPath(win32 정규화·상위이탈 차단) → 정규화된 절대경로로 환원.
 *   · fsp.access(존재·접근 가능) — 미존재 → ENOENT.
 * 하나라도 실패하면 즉시 err 로 거부(전부-또는-전무: 드래그는 부분 시작하지 않음).
 * 성공 시 정규화된 절대경로 목록을 ok 로 반환한다.
 *
 * accessFn 은 fsp.access 를 기본으로 하되 헤드리스 verify 가 주입(실 FS 미경유)할 수 있다.
 */
export async function validateDragPaths(
  paths: string[],
  accessFn: (p: string) => Promise<void> = (p) => fsp.access(p)
): Promise<Result<string[]>> {
  const out: string[] = []
  for (const raw of paths) {
    // 1) 원격 네임스페이스 거부(정규화 이전에 — guardPath 가 sftp:// 를 상대경로로 오인하지 않도록).
    if (isRemotePath(raw)) {
      return err(fileOpError('ESECURITY', '원격 경로는 외부로 드래그할 수 없습니다(로컬만).', raw))
    }
    // 2) 정규화·상위이탈 차단.
    const g = guardPath(raw)
    if (!g.ok) return g as Result<string[]>
    // 3) 존재·접근 확인.
    try {
      await accessFn(g.value)
    } catch {
      return err(fileOpError('ENOENT', '대상을 찾을 수 없습니다.', g.value))
    }
    out.push(g.value)
  }
  return ok(out)
}

/**
 * 대표 아이콘(다중 선택 시 첫 항목·1차 단순) 을 비어있지 않은 NativeImage 로 확정한다(CN-2).
 *   · app.getFileIcon(대표 경로) → dataUrl(기존 os/icon.ts 와 같은 소스) → nativeImage.
 *   · 실패/빈 이미지 → resolveDragIcon 이 번들/내장 fallback 으로 폴백.
 * iconHint 는 1차에서 영향 없음(향후 다중/폴더 전용 아이콘 분기 여지).
 *
 * getIconDataUrl 은 헤드리스 verify 가 주입할 수 있게 인자로 받는다(실 네이티브 미경유).
 */
export async function resolveRepresentativeIcon(
  paths: string[],
  resourcesDir?: string,
  getIconDataUrl: (p: string) => Promise<string | null> = defaultGetIconDataUrl
): Promise<NativeImage> {
  const rep = paths[0]
  let dataUrl: string | null = null
  if (rep) {
    try {
      dataUrl = await getIconDataUrl(rep)
    } catch {
      dataUrl = null
    }
  }
  return resolveDragIcon(dataUrl, resourcesDir)
}

/** 기본 아이콘 dataUrl 추출 — app.getFileIcon(실존 경로). 빈/예외는 null(폴백 유도). */
async function defaultGetIconDataUrl(p: string): Promise<string | null> {
  try {
    const img = await app.getFileIcon(p, { size: 'normal' })
    if (img.isEmpty()) return null
    const url = img.toDataURL()
    return url || null
  } catch {
    return null
  }
}

/**
 * dnd:start-drag 의 검증·아이콘·startDrag 위임 본체(IPC/sender 래퍼 분리 — verify 재사용).
 * resourcesDir 는 fallback 리소스 아이콘 경로(prod: process.resourcesPath).
 */
export async function runStartDrag(
  req: { paths: string[]; iconHint?: 'single' | 'multi' | 'folder' | undefined },
  wc: WebContents,
  resourcesDir?: string
): Promise<Result<DndStartDragRes>> {
  // 1) 경로 화이트리스트(원격 거부·정규화·존재).
  const validated = await validateDragPaths(req.paths)
  if (!validated.ok) return validated as Result<DndStartDragRes>

  // 2) 대표 아이콘 확정(빈 아이콘 금지 — fallback 보장).
  const icon = await resolveRepresentativeIcon(validated.value, resourcesDir)

  // 3) startDrag 위임(외부 = 복사 고정).
  return startExternalDrag(wc, validated.value, icon)
}

export function registerDndHandlers(): void {
  // ── dnd:start-drag (외부 드래그 시작) ────────────────────────────────
  handleGuarded(
    CHANNELS.DND_START_DRAG,
    zDndStartDragReq,
    (req, event): Promise<Result<DndStartDragRes>> =>
      runStartDrag(req, event.sender, process.resourcesPath)
  )
}
