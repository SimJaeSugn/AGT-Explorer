/**
 * windowManager — 멀티 윈도우 생성·추적 (U3 탭 분리, US-20.3 Could).
 *
 * 기존 단일 창 모델(index.ts 의 `mainWindow`)을 N개 창으로 일반화한다. 모든
 * 창은 createMainWindow() 와 **동일한 보안 옵션(ADR-005 4종)·show-fallback·
 * dev/prod 로드 로직**을 재사용한다(createWindow 단일 출처).
 *
 * 핵심 설계:
 *  - 첫 창(primary)은 부팅 시 세션을 복원·자동저장한다(오늘과 동일).
 *  - "새 창으로 분리"로 만든 창(split)은 넘겨받은 탭 1개로 부팅하며 **세션
 *    자동저장에 참여하지 않는다**(공유 session.json 클로버 방지). 즉 분리 창은
 *    세션 복원 대상이 아니다(reopen-only — 정직 한계, U3 §session).
 *  - 각 창의 렌더러는 부팅 시 `window:get-init` invoke 로 자신의 초기 상태
 *    ({ primary, initialTab })를 동기적으로 끌어온다(푸시 경쟁 회피).
 *
 * 창별 푸시 라우팅: op / analyze / hash / queue / watch / search 등 기존 핸들러는 이미
 * `event.sender` 로 푸시하므로 분리 창에서 시작한 작업의 진행률·다이얼로그는
 * 그 창으로 정확히 간다(별도 배선 불필요). 전역으로 남는 푸시는 app:open-path
 * (탐색기 "AGT-Finder로 열기")뿐이며, primary 창으로만 보낸다(U3 §push 한계).
 */
import { join } from 'node:path'
import { BrowserWindow, shell } from 'electron'
import { is } from '@electron-toolkit/utils'
import type { TabSnapshot } from '@shared/dto'

/** 한 창의 부팅 초기 상태(렌더러가 window:get-init 로 끌어간다). */
export interface WindowInit {
  /** 이 창이 primary(세션 복원·자동저장 담당)인가. split 창은 false. */
  readonly primary: boolean
  /** 분리로 넘겨받은 초기 탭(split 창만). primary 창은 null(세션 복원 경로). */
  readonly initialTab: TabSnapshot | null
}

/** webContents.id → 해당 창의 부팅 초기 상태. */
const initByWebContents = new Map<number, WindowInit>()

/** primary(첫) 창의 webContents.id. 분리 창과 구분하는 단일 기준. */
let primaryWebContentsId: number | null = null

/**
 * 보안 옵션(ADR-005 4종)·show-fallback·dev/prod 로드·외부링크 차단을 강제한 창을
 * 만든다. createMainWindow() 와 동일 로직의 단일 출처 — primary/split 공용.
 */
function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    show: false,
    autoHideMenuBar: true,
    title: 'AGT-Finder',
    // 패키징 시엔 exe 임베드 아이콘(electron-builder win.icon)을 쓰므로 생략.
    ...(is.dev ? { icon: join(__dirname, '../../resources/icon.png') } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      // ADR-005 — 보안 옵션 4종(모든 창 동일 강제).
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  })

  // webContents.id 를 생성 시점에 캡처한다. 'closed' 이벤트는 webContents 파괴 후 발생하므로
  // 그 안에서 window.webContents 에 접근하면 "Object has been destroyed" 가 난다(종료 시 크래시).
  const wcId = window.webContents.id

  // 1차: 정상 경로 — 렌더러 첫 페인트 준비 시 표시.
  window.on('ready-to-show', () => {
    window.show()
  })

  // 폴백 — ready-to-show 지연·누락으로 창이 영영 숨겨지는 문제 방지.
  //   ① 렌더러 로드 완료 시, ② 3초 타임아웃 시에도 (아직 안 보이면) 강제 표시.
  const showOnce = (): void => {
    if (!window.isDestroyed() && !window.isVisible()) window.show()
  }
  window.webContents.once('did-finish-load', showOnce)
  const showFallback = setTimeout(showOnce, 3000)
  window.on('show', () => clearTimeout(showFallback))
  window.on('closed', () => clearTimeout(showFallback))

  // 렌더러 로드 실패 진단(흰 화면/창 미표시 원인 추적).
  window.webContents.on('did-fail-load', (_e, code, desc, url) => {
    // eslint-disable-next-line no-console
    console.error(`[window] did-fail-load: code=${code} desc=${desc} url=${url}`)
    showOnce()
  })
  window.webContents.on('render-process-gone', (_e, details) => {
    // eslint-disable-next-line no-console
    console.error(`[window] render-process-gone: reason=${details.reason} code=${details.exitCode}`)
  })

  // 창이 닫히면 초기 상태 맵에서 정리(누수 방지). 캡처해 둔 wcId 사용
  // (closed 시점엔 window.webContents 가 파괴돼 접근 시 throw).
  window.on('closed', () => {
    initByWebContents.delete(wcId)
  })

  // 외부 링크는 새 BrowserWindow 대신 OS 기본 브라우저로(원격 콘텐츠 로드 차단).
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  // dev: electron-vite dev 서버(HMR) / prod: 로컬 번들만 로드.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

/**
 * primary(첫) 창을 만든다. 세션 복원·자동저장은 이 창의 렌더러가 담당한다.
 * index.ts whenReady 와 activate(모든 창 닫힌 뒤 재활성)에서 호출한다.
 */
export function createPrimaryWindow(): BrowserWindow {
  const win = createWindow()
  primaryWebContentsId = win.webContents.id
  initByWebContents.set(win.webContents.id, { primary: true, initialTab: null })
  return win
}

/**
 * 분리 창을 만든다(U3 "새 창으로 분리"). 넘겨받은 탭 스냅샷 1개로 부팅하며
 * 세션 자동저장에는 참여하지 않는다(primary=false). 렌더러가 window:get-init 로
 * initialTab 을 끌어가 기본 부트 탭 대신 해당 탭을 띄운다.
 */
export function createSplitWindow(initialTab: TabSnapshot): BrowserWindow {
  const win = createWindow()
  initByWebContents.set(win.webContents.id, { primary: false, initialTab })
  return win
}

/**
 * 한 창(webContents.id)의 부팅 초기 상태를 반환한다. 미등록(이론상 불가 —
 * 모든 창이 create* 경로를 거침)이면 안전 폴백으로 primary 취급(기본 부트).
 */
export function getWindowInit(webContentsId: number): WindowInit {
  return initByWebContents.get(webContentsId) ?? { primary: true, initialTab: null }
}

/**
 * primary 창의 BrowserWindow(없거나 파괴됐으면 null). app:open-path 같은
 * 전역 푸시·second-instance 포커스 타깃으로 쓴다.
 */
export function getPrimaryWindow(): BrowserWindow | null {
  if (primaryWebContentsId === null) return null
  const all = BrowserWindow.getAllWindows()
  const win = all.find((w) => w.webContents.id === primaryWebContentsId)
  return win && !win.isDestroyed() ? win : null
}
