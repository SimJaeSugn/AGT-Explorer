/**
 * 스플래시(홍보영상) 창 전용 preload — 메인 렌더러 preload(index.ts)와 분리한 최소 표면.
 *
 * 메인 앱 API(window.api)는 노출하지 않는다. 스플래시는 다음만 필요하다.
 *  - onReady(cb): main 이 'splash:ready'(렌더러 부팅 완료) 를 보내면 콜백 → 닫기 버튼 활성화.
 *  - close()    : 사용자가 닫기 버튼을 누르면 'splash:close' 전송 → main 이 splash 를 닫고
 *                 메인 창을 띄운다.
 *  - setDontShowAgain(on): "앞으로 보지 않기" 체크 → main 이 showPromoSplash 설정을 끄고
 *                 (영속) 메인 렌더러 설정 화면을 동기화한다.
 *
 * contextIsolation:true + sandbox:true 전제 — contextBridge 로만 노출한다(ADR-005).
 */
import { contextBridge, ipcRenderer } from 'electron'

const splashApi = {
  /** main 의 'splash:ready'(초기화 완료) 1회 수신 → 콜백. */
  onReady(cb: () => void): void {
    ipcRenderer.on('splash:ready', () => cb())
  },
  /** 닫기 버튼 → main 에 닫기 요청(fire-and-forget). */
  close(): void {
    ipcRenderer.send('splash:close')
  },
  /** "앞으로 보지 않기" 체크 변경 → main 이 showPromoSplash 설정을 갱신·영속한다. */
  setDontShowAgain(on: boolean): void {
    ipcRenderer.send('splash:set-dont-show', on === true)
  }
}

try {
  contextBridge.exposeInMainWorld('splashApi', splashApi)
} catch (error) {
  // contextIsolation 비활성(이론상 불가) — 콘솔만 남기고 무시.
  // eslint-disable-next-line no-console
  console.error('[splash-preload] exposeInMainWorld 실패:', error)
}
