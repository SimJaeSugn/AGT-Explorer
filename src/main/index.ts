// libuv 스레드풀 상향(프로세스 전역). **가장 첫 import** 로 두어 다른 모듈이 async I/O 를
// 시작하기 전에 UV_THREADPOOL_SIZE 를 설정한다(부작용 모듈 — 상세 주석은 threadpool.ts 참조).
import './os/threadpool'
import { app, BrowserWindow, session } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { CHANNELS } from '@shared/ipc/channels'
import { createPrimaryWindow, getPrimaryWindow } from './windows/windowManager'
import { extractPathArg } from './os/launchPath'
import { registerIpcHandlers } from './ipc'
import { initPersistence, sessionStore } from './persistence'
import { initRemoteProfileStore } from './persistence/RemoteProfileStore'
import { initCredentialStore } from './os/credentials'
import { initAgentKeyStore } from './agent/agentKeyStore'
import { initRemoteSessionManager, remoteSessionManager } from './remote'
import { initArchiveSessionManager, initArchiveService, archiveSessionManager } from './archive'
import { operationManager } from './operations/OperationManager'
import { watchService } from './fs/WatchService'
import { driveTypeService } from './os/driveType'
import { shellVerbsService } from './os/shellVerbs'
import { diskTypeService } from './os/diskType'
import { initAutoUpdate } from './os/autoUpdate'

// ── 단일 인스턴스 락 (PRD §7, ADR-005) ──────────────────────────────
// 두 번째 실행 시도는 즉시 종료하고, 첫 인스턴스의 창을 포커스한다.
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  // 두 번째 실행(탐색기 "AGT-Finder로 열기" 포함): primary 창을 포커스하고, argv 에
  // 경로가 있으면 렌더러로 전달해 새 탭으로 연다(V2). 멀티 윈도우(U3)에서도
  // app:open-path 는 세션·새 탭을 담당하는 primary 창으로만 보낸다(전역 푸시 단일화).
  app.on('second-instance', (_e, argv) => {
    const primary = getPrimaryWindow()
    if (!primary) return
    if (primary.isMinimized()) primary.restore()
    primary.focus()
    const target = extractPathArg(argv)
    if (target) primary.webContents.send(CHANNELS.APP_OPEN_PATH, { path: target })
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
    // 압축 세션 전부 정리(파일 디스크립터 누수 0 — §Q1). 미초기화면 무시.
    try {
      void archiveSessionManager().closeAll()
    } catch {
      /* archive 미초기화 → 스킵 */
    }
    // 셸 verb 상주 PowerShell 워커 종료(좀비 프로세스 0 — §Y1). 미기동이면 멱등.
    try {
      shellVerbsService.dispose()
    } catch {
      /* shellVerbs 미초기화 → 스킵 */
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

    // §Z 에이전트: 제공자별 API 키 store(safeStorage·평문 0·credentialStore 동형) 초기화.
    initAgentKeyStore(userData)

    // §Q1 압축(M9): zip 세션 매니저(open/list/close) + 추출/추가 서비스 초기화.
    //   추출/추가는 OperationManager(op:* 스트림)를 주입받아 진행률·취소·완료를 재사용한다
    //   (신규 진행률 채널 0 — remote:download/upload 선례 동형). yauzl/yazl 은 archive/ 캡슐화.
    initArchiveSessionManager()
    initArchiveService(operationManager)

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

    const mainWindow = createPrimaryWindow()

    // V2: 최초 실행이 탐색기 "AGT-Finder로 열기"였다면 argv 경로를 렌더러로 전달한다
    // (창 로드 완료 후 1회 — 렌더러가 새 탭으로 연다). 경로 없으면 무동작.
    const launchTarget = extractPathArg(process.argv)
    if (launchTarget) {
      mainWindow.webContents.once('did-finish-load', () => {
        mainWindow.webContents.send(CHANNELS.APP_OPEN_PATH, { path: launchTarget })
      })
    }

    // 매핑 네트워크 드라이브 문자 캐시 1회 비동기 수집(J2). non-blocking — PowerShell 콜드스타트가
    // 부팅을 차단하지 않는다(trigger-and-forget). 실패해도 서비스 내부 격리(throw 0) → 부팅 영향 0.
    void driveTypeService.refresh()

    // 드라이브 미디어 종류(SSD/HDD) 캐시 1회 비동기 수집. non-blocking — PowerShell 콜드스타트가
    // 부팅을 차단하지 않는다(trigger-and-forget). 실패해도 서비스 내부 격리(throw 0) → 미상은 비-SSD
    // 취급(보수적)이라 기존 동시성 숫자 유지(무회귀). 파일 작업 동시성 산출에 사용된다.
    void diskTypeService.refresh()

    // P7: GitHub Releases 자동 업데이트 1회 확인(패키징 빌드 한정·trigger-and-forget).
    // 미패키징/오프라인/오류는 모듈 내부에서 격리(throw 0) → 부팅 영향 0.
    initAutoUpdate()

    app.on('activate', () => {
      // 모든 창이 닫힌 뒤 재활성(darwin) 시 primary 창을 다시 띄운다(세션 복원 경로).
      if (BrowserWindow.getAllWindows().length === 0) {
        createPrimaryWindow()
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
