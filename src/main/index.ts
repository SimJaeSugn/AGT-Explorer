import { app, BrowserWindow, session } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { createMainWindow } from './windows/mainWindow'
import { registerIpcHandlers } from './ipc'
import { initPersistence, sessionStore } from './persistence'

// ── 단일 인스턴스 락 (PRD §7, ADR-005) ──────────────────────────────
// 두 번째 실행 시도는 즉시 종료하고, 첫 인스턴스의 창을 포커스한다.
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  let mainWindow: BrowserWindow | null = null

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  // 종료 직전 보류 중인 세션 스냅샷을 즉시 flush (디바운스 대기분 보존, SA §5.2).
  // 비정상 종료(크래시)는 변경 시점마다의 디바운스 저장으로 직전 상태가 이미 남는다.
  let quitFlushed = false
  app.on('before-quit', (e) => {
    if (quitFlushed) return
    try {
      if (!sessionStore().hasPending()) return
    } catch {
      return // persistence 미초기화(부팅 실패) → 스킵.
    }
    // flush 가 끝날 때까지 종료를 한 번 보류했다가 재시도.
    e.preventDefault()
    void sessionStore()
      .flush()
      .finally(() => {
        quitFlushed = true
        app.quit()
      })
  })

  app.whenReady().then(async () => {
    electronApp.setAppUserModelId('com.explorer.app')

    // 영속 store 초기화(userData) — IPC 핸들러 등록 전에 끝낸다(SA §5.2).
    await initPersistence(app.getPath('userData'))

    // 엄격 CSP — 로컬 번들만 허용, 원격/인라인 스크립트 차단 (ADR-005)
    // dev 에서는 Vite HMR(웹소켓/인라인) 을 위해 약간 완화한다.
    const isDev = !!process.env['ELECTRON_RENDERER_URL']
    const csp = isDev
      ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: http: https:; font-src 'self' data:"
      : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"

    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [csp]
        }
      })
    })

    // 모든 권한 요청 거부 (로컬 전용·텔레메트리 옵트인 외 차단, D5)
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, cb) => cb(false))

    app.on('browser-window-created', (_e, win) => {
      optimizer.watchWindowShortcuts(win)
    })

    // IPC 핸들러 등록(P1: fs:* 읽기 계열). 창 생성 전에 등록한다.
    registerIpcHandlers()

    mainWindow = createMainWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow()
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}
