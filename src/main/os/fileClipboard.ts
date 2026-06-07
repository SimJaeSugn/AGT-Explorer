/**
 * 파일 클립보드 (P4, clipboard:* — SA §3.2).
 *
 * Windows 의 진짜 CF_HDROP(탐색기와 상호 붙여넣기) 연동은 네이티브 클립보드
 * 포맷 쓰기/읽기가 필요하다. Electron 의 clipboard 모듈은 CF_HDROP 를 1급으로
 * 노출하지 않으므로(buffer 로 raw 포맷을 다룰 수는 있으나 OS 별 바이트 레이아웃
 * 의존), MVP 는 **앱 내부 클립보드 상태**를 단일 출처로 두고, 부가로 OS 텍스트
 * 클립보드에 경로 목록을 써 둔다(다른 앱이 경로 문자열로라도 받게).
 *
 * 즉:
 *   - copy/cut: 내부 상태(paths + effect) 갱신 + clipboard.writeText(개행 구분 경로).
 *   - read: 내부 상태 반환(effect 포함).
 *   - paste-target: 내부 상태의 effect 에 따라 OperationManager 로 copy/move 위임은
 *     핸들러(clipboard.handlers)에서 수행. 여기서는 상태만 제공.
 *
 * 한계(명시): 외부 탐색기에서 복사한 파일을 본 앱에서 CF_HDROP 로 받지는 못한다
 * (텍스트 경로만). 향후 네이티브 모듈로 CF_HDROP 양방향 지원 가능.
 */
import { clipboard } from 'electron'

export type ClipboardEffect = 'copy' | 'cut' | 'none'

interface ClipboardState {
  paths: string[]
  effect: ClipboardEffect
}

let state: ClipboardState = { paths: [], effect: 'none' }

/** 복사/잘라내기로 파일 경로를 클립보드에 담는다. */
export function setClipboard(paths: string[], effect: 'copy' | 'cut'): void {
  state = { paths: [...paths], effect }
  // 부가: OS 텍스트 클립보드에 경로 목록(개행 구분) — 외부 앱 호환 최소.
  try {
    clipboard.writeText(paths.join('\r\n'))
  } catch {
    /* 베스트에포트 */
  }
}

/** 클립보드에 담긴 파일 작업 의도 조회. */
export function readClipboard(): { paths: string[]; effect: ClipboardEffect } {
  return { paths: [...state.paths], effect: state.effect }
}

/** 붙여넣기 후 잘라내기 효과 소거(원본 1회 이동 후 클립보드 비움). */
export function clearAfterPaste(): void {
  if (state.effect === 'cut') {
    state = { paths: [], effect: 'none' }
  }
}
