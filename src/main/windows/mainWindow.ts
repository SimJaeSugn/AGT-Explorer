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
    title: 'Explorer',
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

  window.on('ready-to-show', () => {
    window.show()
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
