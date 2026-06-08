/**
 * 외부 D&D(앱 → OS/타앱) 드래그 시작 래퍼 (§M M1 · F14 · ADR-007 ⑦).
 *
 * `webContents.startDrag`는 **Main 전용** API다. 검증된 로컬 절대경로 목록과
 * 비어있지 않은 NativeImage 아이콘을 받아 `wc.startDrag({ files, icon })`를 호출한다.
 * 외부로 나가는 것은 검증된 로컬 파일 경로뿐(원격·미존재·상위이탈은 상위 핸들러가 거부).
 *
 * **아이콘(CN-2)**: Electron startDrag 는 `icon`(빈 NativeImage 불가) 필수다. 빈 아이콘이면
 * startDrag 가 throw 하므로, 핸들러가 아래 우선순위로 비어있지 않은 NativeImage 를 마련해 넘긴다:
 *   1) 대표 파일의 `app.getFileIcon`(기존 os/icon.ts 와 같은 소스) → dataURL → nativeImage
 *   2) 번들 리소스 기본 파일 아이콘(`resources/icon.png`)
 *   3) 최소 내장 fallback(1x1 투명이 아닌 16x16 단색 PNG — 빈 이미지 금지)
 * 본 모듈은 (2)(3) 폴백 생성·검증과 startDrag 호출만 담당하고, (1) 추출은 핸들러가 시도해 넘긴다.
 *
 * throw 0(ADR-003): 모든 실패는 Result.err 또는 ok({started:false}) 로 1급 전파한다.
 */
import { join } from 'node:path'
import { nativeImage, type NativeImage, type WebContents } from 'electron'
import type { Result } from '@shared/ipc/contracts'
import { err, ok } from '@shared/ipc/contracts'
import { fileOpError } from '../fs/errors'

export interface StartDragResult {
  readonly started: boolean
}

/**
 * 최소 내장 fallback 아이콘(16x16 단색 PNG, base64). 리소스 아이콘 로드 실패 시에도
 * **빈 NativeImage 로 startDrag 가 throw 하지 않도록** 항상 비어있지 않은 이미지를 보장한다.
 * (회색 사각형 — 시각적 의미는 없고 startDrag 의 icon 필수 제약 충족이 목적.)
 */
const FALLBACK_ICON_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAHElEQVR42mNkYPhfz0AEYBxV' +
  'SFKBg4ODg4MBAGW2A/9G0e2hAAAAAElFTkSuQmCC'

let cachedFallback: NativeImage | null = null

/**
 * 번들 리소스(`resources/icon.png`) → 실패 시 내장 base64 → 항상 비어있지 않은 NativeImage 반환.
 * resourcesDir 가 주어지면 그 경로의 `icon.png` 를 먼저 시도한다(헤드리스 verify 는 미주입 가능).
 */
export function getFallbackDragIcon(resourcesDir?: string): NativeImage {
  if (cachedFallback && !cachedFallback.isEmpty()) return cachedFallback

  if (resourcesDir) {
    try {
      const img = nativeImage.createFromPath(join(resourcesDir, 'icon.png'))
      if (!img.isEmpty()) {
        cachedFallback = img
        return img
      }
    } catch {
      // 리소스 로드 실패(패키징·경로 누락) → 내장 base64 로 폴백.
    }
  }

  const embedded = nativeImage.createFromDataURL(`data:image/png;base64,${FALLBACK_ICON_PNG_BASE64}`)
  cachedFallback = embedded
  return embedded
}

/**
 * 핸들러가 마련한 대표 아이콘(없거나 비어있으면 fallback) 으로 NativeImage 를 확정한다.
 * - dataUrl 이 유효(비어있지 않은 NativeImage)면 그대로 사용.
 * - 비어있거나 변환 실패면 getFallbackDragIcon().
 * **반환 NativeImage 는 항상 isEmpty()=false** (startDrag icon 필수 제약 보장).
 */
export function resolveDragIcon(dataUrl: string | null, resourcesDir?: string): NativeImage {
  if (dataUrl) {
    try {
      const img = nativeImage.createFromDataURL(dataUrl)
      if (!img.isEmpty()) return img
    } catch {
      // 잘못된 dataUrl → fallback.
    }
  }
  return getFallbackDragIcon(resourcesDir)
}

/**
 * 검증된 로컬 절대경로 목록으로 외부 드래그를 시작한다.
 *
 * 전제(상위 핸들러 보장): paths 는 모두 정규화된 로컬 절대경로·실존·로컬 FS(원격 prefix 거부).
 * icon 은 비어있지 않은 NativeImage(resolveDragIcon 결과).
 *
 * - 빈 paths → err(EINVAL).
 * - 빈 icon → err(EUNKNOWN, startDrag 거부 사전 방지).
 * - wc 파괴(destroyed) → ok({started:false}) (오류 아님 — 창이 닫히는 정상 상황).
 * - startDrag 예외 → err(EUNKNOWN).
 *
 * startDrag 는 동기 호출이며 즉시 반환한다. 외부 드롭은 항상 **복사 효과**(이동 미지원·1차 결정).
 */
export function startExternalDrag(
  wc: WebContents,
  paths: string[],
  icon: NativeImage
): Result<StartDragResult> {
  if (paths.length === 0) {
    return err(fileOpError('EINVAL', '드래그할 경로가 없습니다.'))
  }
  if (icon.isEmpty()) {
    // 방어: startDrag 는 빈 아이콘에 throw 한다 → 사전 차단(폴백 미적용 호출 방지).
    return err(fileOpError('EUNKNOWN', '드래그 아이콘이 비어 있습니다(startDrag 거부).'))
  }
  if (wc.isDestroyed()) {
    return ok({ started: false })
  }

  try {
    // Electron Item 타입은 file(필수)+files(override) 형태다. 단일은 file, 다중은 files 가
    // file 을 덮어쓴다(전체 경로 목록 드래그). 둘 다 채워 단일/다중 모두 정합.
    wc.startDrag({ file: paths[0] as string, files: paths, icon })
    return ok({ started: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : '알 수 없는 오류'
    return err(fileOpError('EUNKNOWN', `외부 드래그 시작 실패: ${msg}`))
  }
}
