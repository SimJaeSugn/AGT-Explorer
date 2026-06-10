/**
 * launchOpen 유스케이스 (V2 — 탐색기 "AGT-Finder로 열기").
 *
 * Main 이 argv(최초 실행)·second-instance(중복 실행)로 받은 탐색기 경로를 app:open-path
 * 로 푸시하면, 이를 새 탭으로 연다. 폴더/드라이브는 그대로, 파일이면 상위 폴더를 연다.
 * Main 이 이미 정규화·존재 검증을 했지만, 여기서도 fs:validate-path 로 종류(폴더/파일)를
 * 확인해 파일이면 부모로 보정한다(방어적 — 경로가 그새 바뀌었어도 안전).
 *
 * app → infra/api 직접 호출(.eslintrc 허용). 전역 1회 구독(중복 호출 무시).
 */
import type { AppOpenPathEvt } from '@shared/ipc/contracts'
import { fsApi, subscribeOpenPath } from '@renderer/infra/api'
import { store } from '@renderer/app/stores/rootStore'
import { parentOf } from '@renderer/domain/paths'

let disposer: (() => void) | null = null

/** 전달받은 경로를 새 탭으로 연다(파일이면 상위 폴더). */
async function openLaunchPath(rawPath: string): Promise<void> {
  let target = rawPath
  const res = await fsApi.validatePath({ path: rawPath })
  if (res.ok && res.value.exists) {
    target = res.value.isDir ? res.value.normalized : parentOf(res.value.normalized) ?? res.value.normalized
  }
  store.getState().newTab(target)
}

/** app:open-path 전역 구독 시작(중복 호출 무시). App 부팅 시 1회. */
export function initOpenPathBridge(): void {
  if (disposer) return
  disposer = subscribeOpenPath((evt: AppOpenPathEvt) => void openLaunchPath(evt.path))
}

/** 구독 해제(테스트·HMR). */
export function disposeOpenPathBridge(): void {
  if (disposer) {
    disposer()
    disposer = null
  }
}
