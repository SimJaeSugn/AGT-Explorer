import { app, BrowserWindow, session } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { createMainWindow } from './windows/mainWindow'
import { registerIpcHandlers } from './ipc'
import { initPersistence, sessionStore } from './persistence'
import { initRemoteProfileStore } from './persistence/RemoteProfileStore'
import { initCredentialStore } from './os/credentials'
import { initRemoteSessionManager, remoteSessionManager } from './remote'
import { watchService } from './fs/WatchService'
import { driveTypeService } from './os/driveType'

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
    // 종료 직전 모든 FS 워처 핸들 해제(좀비 핸들 0 — J2). 멱등.
    watchService.stopAll()
    // 원격 세션 전부 정리(소켓 누수 0). 미초기화면 무시.
    try {
      void remoteSessionManager().disconnectAll()
    } catch {
      /* persistence/remote 미초기화 → 스킵 */
    }
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
    electronApp.setAppUserModelId('com.agtfinder.app')

    // 영속 store 초기화(userData) — IPC 핸들러 등록 전에 끝낸다(SA §5.2).
    const userData = app.getPath('userData')
    await initPersistence(userData)

    // §M M3 원격: 자격증명(safeStorage)·프로필/known_hosts store·세션 매니저 초기화.
    //   credentialStore 는 electron safeStorage(DPAPI)를 주입한다. 세션 매니저는 known_hosts
    //   를 RemoteProfileStore 로 주입받고, 어댑터(SFTP/FTP)는 사용 시점에 지연 로드된다.
    initCredentialStore(userData)
    const profiles = initRemoteProfileStore(userData)
    initRemoteSessionManager(profiles)

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

    // 매핑 네트워크 드라이브 문자 캐시 1회 비동기 수집(J2). non-blocking — PowerShell 콜드스타트가
    // 부팅을 차단하지 않는다(trigger-and-forget). 실패해도 서비스 내부 격리(throw 0) → 부팅 영향 0.
    void driveTypeService.refresh()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow()
      }
    })
  })

  app.on('window-all-closed', () => {
    // 창이 모두 닫히면 남은 워처 핸들을 해제(누수 방지, before-quit 보강).
    watchService.stopAll()
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}
