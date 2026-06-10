/**
 * 전송 라우팅 규칙 (renderer/domain/rules/transferRoute) — 순수 함수.
 *
 * §M M3: 로컬↔원격 드롭/복사/붙여넣기를 다운로드/업로드/로컬op 로 라우팅한다.
 * D&D·클립보드·키보드가 같은 규칙을 공유하고 단위 테스트가 쉽다(dragIntent 동형).
 *
 *  - local → local   : 기존 resolveDragIntent(copy/move) — 라우팅은 'local'(기존 op:* 경로).
 *  - local → remote  : upload.
 *  - remote → local  : download.
 *  - remote → remote : unsupported(1차 범위 밖 · UQ-M3 · 로컬 경유 별도).
 *  - 외부(앱 바깥) 도착(M1): copy 고정(transferToExternal).
 *
 * §Q1(ADR-008 결정①-전송 라우팅): 압축↔로컬 조합을 추가한다.
 *  - archive → local : extract(`archive:extract` · 추출).
 *  - local → archive : add(`archive:add` · 추가).
 *  - archive ↔ archive / archive ↔ remote : unsupported(1차 범위 밖 · ADR-008).
 *
 * 부수효과 없음. react/zustand/infra/shared-ipc import 금지(.eslintrc).
 */
import type { LocationKind } from './remoteLocation'
import { resolveDragIntent, type DragModifiers } from './dragIntent'

export type { LocationKind }

/** 위치(라우팅 입력 — 종류만 본다). */
export interface Loc {
  readonly kind: LocationKind
}

/**
 * 전송 종류.
 *  - 'copy'/'move' : 로컬↔로컬(기존 op:* 파이프라인으로 위임).
 *  - 'upload'      : 로컬→원격(remote:upload).
 *  - 'download'    : 원격→로컬(remote:download).
 *  - 'extract'     : 압축→로컬(archive:extract · §Q1).
 *  - 'add'         : 로컬→압축(archive:add · §Q1).
 *  - 'unsupported' : 원격↔원격 · 압축↔압축 · 압축↔원격(1차 미지원).
 */
export type TransferKind = 'copy' | 'move' | 'upload' | 'download' | 'extract' | 'add' | 'unsupported'

/**
 * 드롭/붙여넣기 전송 종류 결정.
 *  local↔local 은 수정키·드라이브로 copy/move(dragIntent 재사용),
 *  로컬↔원격은 upload/download, 원격↔원격은 unsupported.
 *
 * @param srcLoc    출발 위치 종류.
 * @param dstLoc    도착 위치 종류.
 * @param mods      수정키(local↔local copy/move 판정용).
 * @param sourceDir local↔local 일 때 출발 폴더(드라이브 비교).
 * @param destDir   local↔local 일 때 도착 폴더(드라이브 비교).
 */
export function resolveTransfer(
  srcLoc: Loc,
  dstLoc: Loc,
  mods: DragModifiers,
  sourceDir = '',
  destDir = ''
): TransferKind {
  if (srcLoc.kind === 'local' && dstLoc.kind === 'local') {
    return resolveDragIntent(sourceDir, destDir, mods)
  }
  if (srcLoc.kind === 'local' && dstLoc.kind === 'remote') return 'upload'
  if (srcLoc.kind === 'remote' && dstLoc.kind === 'local') return 'download'
  // §Q1(ADR-008): 압축↔로컬만 지원. 압축↔압축·압축↔원격은 1차 범위 밖.
  if (srcLoc.kind === 'archive' && dstLoc.kind === 'local') return 'extract'
  if (srcLoc.kind === 'local' && dstLoc.kind === 'archive') return 'add'
  // remote → remote · archive ↔ archive · archive ↔ remote
  return 'unsupported'
}

/**
 * 외부(OS/타 앱) 도착 전송 종류(M1). 항상 복사(원본 보존). 원격 소스는 외부 드래그
 * 자체가 금지되므로 호출 전 필터링(아래 isExternalDragAllowed)된다.
 */
export function transferToExternal(): TransferKind {
  return 'copy'
}

/**
 * 외부 드래그 허용 여부(M1): 선택 항목이 **모두 로컬**일 때만 허용한다.
 * 원격 항목(sftp://·ftp(s)://)은 외부로 드래그할 수 없다(features §M1).
 * 빈 선택은 불가.
 */
export function isExternalDragAllowed(locations: readonly LocationKind[]): boolean {
  if (locations.length === 0) return false
  return locations.every((k) => k === 'local')
}

/**
 * 클립보드 read 의 DropEffect → 로컬 붙여넣기 op kind.
 *   'move' → 'move'(잘라넣기), 'copy'/'none' → 'copy'.
 * 시스템 클립보드의 effect 를 기존 op:* 파이프라인 kind 로 변환한다(M2).
 */
export function clipboardEffectToOpKind(effect: 'copy' | 'move' | 'none'): 'copy' | 'move' {
  return effect === 'move' ? 'move' : 'copy'
}
