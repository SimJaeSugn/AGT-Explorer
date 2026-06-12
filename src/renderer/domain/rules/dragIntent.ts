/**
 * 드래그&드롭 의도 판정 규칙 (renderer/domain/rules/dragIntent) — 순수 함수.
 *
 * SA §8 D&D 의도 규칙·features A3·US-1.3 를 도메인 순수 함수로 격리한다.
 * 드래그·붙여넣기가 동일 규칙을 공유하고 단위 테스트가 쉽다.
 * UI 는 표현만, 규칙은 도메인.
 *
 *  - 같은 드라이브 = 이동, 다른 드라이브 = 복사 (Windows 관례).
 *  - Ctrl = 복사 강제, Shift = 이동 강제.
 *  - 동일 폴더 드롭 = 무시(작업 없음). 단 Ctrl 강제 복사는 "복사본" 으로 진행.
 *  - 조상 → 자손 이동 = 차단(자기 자신을 포함하는 경로로 옮길 수 없음).
 *
 * 부수효과 없음. react/zustand/infra/shared-ipc import 금지(.eslintrc).
 */
import { isMyPc, normalizeDisplay, parentOf } from '@renderer/domain/paths'

export type DragIntent = 'move' | 'copy'

/** 드래그 수정자(키 상태). */
export interface DragModifiers {
  readonly ctrl: boolean
  readonly shift: boolean
}

/** 드롭 선검증 결과. blocked 면 사유 메시지를 동반한다. */
export interface DropDecision {
  /** 산출된 의도(차단/무시여도 표현용으로 채운다). */
  readonly intent: DragIntent
  /** 실제 작업을 수행할지. false 면 reason 참고. */
  readonly allowed: boolean
  /** allowed=false 사유 코드. */
  readonly reason: 'ok' | 'same-folder' | 'into-descendant' | 'no-sources' | 'invalid-target'
  /** 사용자 안내 메시지(없으면 빈 문자열). */
  readonly message: string
}

/**
 * 경로에서 드라이브 식별자를 뽑는다(대문자). 비교용.
 *  - "C:\\a\\b" → "C"
 *  - UNC "\\\\server\\share\\x" → "\\\\SERVER\\SHARE"
 *  - "내 PC"(빈 경로)·드라이브 미상 → ''
 */
export function driveOf(path: string): string {
  if (isMyPc(path)) return ''
  const norm = normalizeDisplay(path)
  const m = /^([A-Za-z]):/.exec(norm)
  if (m) return (m[1] as string).toUpperCase()
  // UNC 공유 루트까지를 "드라이브" 로 본다.
  const unc = /^\\\\([^\\]+)\\([^\\]+)/.exec(norm)
  if (unc) return `\\\\${(unc[1] as string).toUpperCase()}\\${(unc[2] as string).toUpperCase()}`
  return ''
}

/** 두 경로가 같은 드라이브/볼륨에 있는가. 드라이브 미상이면 false(보수적=복사). */
export function sameDrive(a: string, b: string): boolean {
  const da = driveOf(a)
  const db = driveOf(b)
  if (da === '' || db === '') return false
  return da === db
}

/**
 * 기본 의도(수정키 적용). 출발/도착 드라이브·수정키만으로 결정한다.
 *  - Ctrl → 복사(강제, 최우선)
 *  - Shift → 이동(강제)
 *  - 그 외 → 같은 드라이브=이동 / 다른 드라이브=복사
 *
 * Ctrl 과 Shift 가 동시면 Ctrl(복사)을 우선한다(데이터 보존 안전 우선).
 */
export function resolveDragIntent(
  sourceDir: string,
  destDir: string,
  mods: DragModifiers
): DragIntent {
  if (mods.ctrl) return 'copy'
  if (mods.shift) return 'move'
  return sameDrive(sourceDir, destDir) ? 'move' : 'copy'
}

/** 경로 비교 키(대소문자 무시·끝 슬래시 정리). */
function key(p: string): string {
  return normalizeDisplay(p).toLowerCase()
}

/**
 * dest 가 src(폴더) 자신이거나 그 자손인가 — 순환 이동 차단 판정.
 * 예) src="C:\\a", dest="C:\\a\\b" → true(차단 대상).
 *     src="C:\\a", dest="C:\\a"     → true(자기 자신).
 */
export function isInsideOrEqual(src: string, dest: string): boolean {
  if (isMyPc(src)) return false
  // 후행 백슬래시 제거 — 드라이브 루트(C:\)는 normalizeDisplay 가 끝 `\`를 보존해
  // `s + '\\'` 가 `C:\\`(이중)이 되어 자손 판정이 어긋난다(루트→하위 순환 이동 미차단).
  const s = key(src).replace(/\\+$/, '')
  const d = key(dest).replace(/\\+$/, '')
  if (s === d) return true
  return d.startsWith(s + '\\')
}

/** 항목들의 부모 폴더(드롭 출발 폴더)를 반환. sourcePanelDir 를 fallback 으로. */
export function commonParent(sources: readonly string[], sourcePanelDir: string): string {
  if (sources.length === 0) return sourcePanelDir
  const first = sources[0] as string
  const parent = parentOf(first)
  return parent === null ? sourcePanelDir : parent
}

/**
 * 드롭 선검증 — 의도 산출 + 동일폴더/순환 차단(SA §8 선검증).
 *
 * @param sources       드래그된 항목 경로들.
 * @param sourceDir     출발(드래그 시작) 패널의 현재 폴더.
 * @param destDir       드롭 대상 폴더(빈 영역=패널 폴더, 폴더 항목 위=그 폴더).
 * @param mods          수정키.
 */
export function decideDrop(
  sources: readonly string[],
  sourceDir: string,
  destDir: string,
  mods: DragModifiers
): DropDecision {
  const intent = resolveDragIntent(sourceDir, destDir, mods)

  if (sources.length === 0) {
    return { intent, allowed: false, reason: 'no-sources', message: '' }
  }

  // 조상 → 자손 이동/복사 차단: 드래그 폴더 중 하나라도 dest 를 포함하면 불가.
  for (const src of sources) {
    if (isInsideOrEqual(src, destDir)) {
      return {
        intent,
        allowed: false,
        reason: 'into-descendant',
        message: '폴더를 자기 하위로 옮길 수 없습니다.'
      }
    }
  }

  // 동일 폴더 드롭: 항목들의 부모(=sourceDir)와 dest 가 같으면 무시.
  // 단, Ctrl 강제 복사는 같은 폴더 "복사본" 규칙으로 진행(allowed).
  const parent = commonParent(sources, sourceDir)
  if (key(parent) === key(destDir)) {
    if (mods.ctrl && intent === 'copy') {
      return { intent: 'copy', allowed: true, reason: 'ok', message: '' }
    }
    return { intent, allowed: false, reason: 'same-folder', message: '' }
  }

  return { intent, allowed: true, reason: 'ok', message: '' }
}
