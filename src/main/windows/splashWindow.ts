/**
 * splashWindow — 부팅 시 홍보영상을 먼저 띄우는 스플래시 창(체감 지연 가리기).
 *
 * 배경: 메인 렌더러 초기화(세션 복원·React 마운트)에 시간이 걸려 앱이 곧바로 뜨지
 * 않는다. 그동안 프레임리스 스플래시 창에 홍보 페이지(promo.html)를 먼저 보여주고,
 * 메인 창은 숨긴 채(deferShow) 백그라운드에서 초기화한다. 초기화가 끝나면 main 이
 * signalSplashReady() 로 닫기 버튼을 활성화해, 사용자가 "지금 닫고 들어갈지 / 계속
 * 볼지"를 직접 고른다.
 *
 * 핵심 설계:
 *  - 'splash' 세션 파티션으로 로드한다 → index.ts 가 defaultSession 에만 건 엄격 CSP가
 *    적용되지 않아, promo 의 인라인 스크립트·blob URL·DecompressionStream 이 동작한다.
 *  - 래퍼(splash/index.html)가 promo 를 <iframe> 으로 격리하고 닫기 버튼만 부모 문서에
 *    둔다(promo 의 document 전체 재작성에도 버튼이 살아있다).
 *  - splash:ready(main→splash) / splash:close(splash→main) 2채널만 쓴다. 메인 앱의
 *    공유 IPC 계약(CHANNELS)과 무관한 스플래시 내부 전용 채널이라 별도 상수로 둔다.
 */
import { join } from 'node:path'
import { BrowserWindow, ipcMain } from 'electron'

/** main→splash: 초기화 완료 → 닫기 버튼 활성화. */
const SPLASH_READY = 'splash:ready'
/** splash→main: 사용자가 닫기 버튼 클릭. */
const SPLASH_CLOSE = 'splash:close'

let splashWin: BrowserWindow | null = null
let ipcWired = false

/**
 * 스플래시 창을 만들고 즉시 promo 래퍼를 로드한다. 프레임리스·고정 크기·중앙 정렬.
 * autoplayPolicy 를 완화해 홍보 영상이 사용자 제스처 없이 자동 재생되게 한다.
 */
export function createSplashWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1024,
    height: 600,
    frame: false,
    resizable: false,
    show: false,
    center: true,
    backgroundColor: '#0f1216',
    title: 'AGT-Finder',
    webPreferences: {
      preload: join(__dirname, '../preload/splash.cjs'),
      // 별도 인메모리 세션 → defaultSession 의 엄격 CSP(script-src 'self') 미적용.
      partition: 'splash',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      // 홍보 영상 자동 재생 허용(사용자 제스처 불요).
      autoplayPolicy: 'no-user-gesture-required'
    }
  })

  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.show()
  })
  // 폴백 — ready-to-show 누락 시 로드 완료 시점에 강제 표시.
  win.webContents.once('did-finish-load', () => {
    if (!win.isDestroyed() && !win.isVisible()) win.show()
  })
  win.on('closed', () => {
    splashWin = null
  })

  void win.loadFile(join(__dirname, '../splash/index.html'))
  splashWin = win
  return win
}

/** 살아있는 스플래시 창(없거나 파괴됐으면 null). */
export function getSplashWindow(): BrowserWindow | null {
  return splashWin && !splashWin.isDestroyed() ? splashWin : null
}

/** 초기화 완료를 스플래시에 알려 닫기 버튼을 활성화한다. 창이 없으면 무동작. */
export function signalSplashReady(): void {
  const w = getSplashWindow()
  if (w && !w.webContents.isDestroyed()) w.webContents.send(SPLASH_READY)
}

/**
 * splash:close(닫기 버튼) 수신 핸들러를 1회 등록한다(멱등). 수신 시 스플래시 창을
 * 닫고, 메인 창 표시는 호출부(index.ts)가 splash 의 'closed' 이벤트에서 처리한다
 * (사용자 닫기·로드 실패 등 모든 닫힘 경로를 단일화).
 */
export function wireSplashIpc(): void {
  if (ipcWired) return
  ipcWired = true
  ipcMain.on(SPLASH_CLOSE, () => {
    getSplashWindow()?.close()
  })
}
