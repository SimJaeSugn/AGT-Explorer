import { join } from 'node:path'
import { BrowserWindow, shell } from 'electron'
import { is } from '@electron-toolkit/utils'

/**
 * 메인 창 생성 (ADR-005 프로세스/보안 모델).
 * 모든 BrowserWindow 는 4종 보안 옵션을 강제한다:
 *   contextIsolation:true, nodeIntegration:false, sandbox:true, webSecurity:true
 */
export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    show: false,
    autoHideMenuBar: true,
    title: 'AGT-Finder',
    // 패키징 시엔 exe 에 임베드된 아이콘(electron-builder win.icon)을 쓰므로 생략.
    // dev 에선 resources/icon.png 로 창/작업표시줄 아이콘을 표시한다.
    ...(is.dev ? { icon: join(__dirname, '../../resources/icon.png') } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      // ADR-005 — 보안 옵션 4종
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  })

  // 1차: 정상 경로 — 렌더러 첫 페인트 준비 시 표시.
  window.on('ready-to-show', () => {
    window.show()
  })

  // 폴백 — 일부 환경/타이밍에서 ready-to-show 가 지연·누락돼 창이 영영 숨겨지는 문제 방지.
  //  ① 렌더러 로드 완료 시, ② 3초 타임아웃 시에도 (아직 안 보이면) 강제 표시.
  const showOnce = (): void => {
    if (!window.isDestroyed() && !window.isVisible()) window.show()
  }
  window.webContents.once('did-finish-load', showOnce)
  const showFallback = setTimeout(showOnce, 3000)
  window.on('show', () => clearTimeout(showFallback))
  window.on('closed', () => clearTimeout(showFallback))

  // 렌더러 로드 실패 진단(흰 화면/창 미표시 원인 추적) — 터미널에 사유 출력 + 창은 띄워서 오류 노출.
  window.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`[mainWindow] did-fail-load: code=${code} desc=${desc} url=${url}`)
    showOnce()
  })
  window.webContents.on('render-process-gone', (_e, details) => {
    console.error(`[mainWindow] render-process-gone: reason=${details.reason} code=${details.exitCode}`)
  })

  // 외부 링크는 새 BrowserWindow 대신 OS 기본 브라우저로 (원격 콘텐츠 로드 차단)
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  // dev: electron-vite dev 서버(HMR) / prod: 로컬 번들만 로드
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}
