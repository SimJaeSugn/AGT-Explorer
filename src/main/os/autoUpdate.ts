/**
 * AutoUpdate — GitHub Releases 기반 **사용자 주도** 자동 업데이트 (electron-updater / P7).
 *
 * 정책: 시작 시 자동으로 받지 않는다(autoDownload=false). 사용자가 설정 "소프트웨어 정보"의
 * 버튼으로 ① 확인(check) → ② 다운로드(download) → ③ 재시작 설치(install)를 직접 트리거한다.
 * 진행 상황(checking/available/downloading%/downloaded/error)은 update:status 푸시로 전 창에
 * 브로드캐스트한다.
 *
 * 동작 범위:
 *   - **패키징된 빌드에서만** 동작한다(`app.isPackaged`). dev/미패키징에서는 check 가
 *     EUNSUPPORTED 를 반환하고, 리스너만 무해히 등록된다(app-update.yml 부재 시 autoUpdater 가
 *     throw 하므로 함수 진입부에서 가드).
 *   - 채널·게시 위치는 electron-builder.yml 의 publish(github)에서 app-update.yml 로 번들된다.
 *
 * 견고성: 모든 진입점 throw 0(격리). 네트워크 오류·오프라인이어도 앱에 영향 0(에러는
 * update:status {phase:'error'} 로 표면화).
 *
 * 보안: 업데이트 파일은 latest.yml 의 SHA512 로 무결성 검증된다.
 */
import { app, BrowserWindow } from 'electron'
// electron-updater 는 CommonJS 모듈 — ESM 메인에서 named import 는 런타임 크래시
// ("Named export 'autoUpdater' not found"). default import 후 구조분해가 유일하게 동작한다.
// import/default 룰은 CJS↔ESM interop 을 이해 못 하므로 이 줄만 예외 처리한다.
// eslint-disable-next-line import/default
import electronUpdater from 'electron-updater'
import { CHANNELS } from '@shared/ipc/channels'
import type { Result, UpdateCheckRes, UpdateStatusEvt } from '@shared/ipc/contracts'
import { err, ok } from '@shared/ipc/contracts'

// eslint-disable-next-line import/no-named-as-default-member
const { autoUpdater } = electronUpdater

let initialized = false

/** update:status 를 열린 모든 창으로 브로드캐스트(설정 창이 어느 창이든 수신). */
function broadcast(evt: UpdateStatusEvt): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(CHANNELS.UPDATE_STATUS, evt)
  }
}

/**
 * 업데이터 초기화 — 자동 다운로드를 끄고, 진행 상황을 브로드캐스트하는 리스너만 등록한다.
 * **확인/다운로드를 트리거하지 않는다.** 멱등(중복 호출 무시). 패키징 빌드가 아니면 무동작.
 */
export function initAutoUpdate(): void {
  if (initialized) return
  initialized = true
  if (!app.isPackaged) return

  // 사용자 주도: 자동 다운로드 끔. 받은 뒤 종료 시 설치는 허용(다음 실행에 적용).
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => broadcast({ phase: 'checking' }))
  autoUpdater.on('update-available', (info) =>
    broadcast({ phase: 'available', version: info.version })
  )
  autoUpdater.on('update-not-available', (info) =>
    broadcast({ phase: 'not-available', version: info.version })
  )
  autoUpdater.on('download-progress', (p) =>
    broadcast({
      phase: 'downloading',
      percent: p.percent,
      transferred: p.transferred,
      total: p.total,
      bytesPerSecond: p.bytesPerSecond
    })
  )
  autoUpdater.on('update-downloaded', (info) =>
    broadcast({ phase: 'downloaded', version: info.version })
  )
  autoUpdater.on('error', (e) =>
    broadcast({ phase: 'error', message: e?.message ?? String(e) })
  )
}

/** 미패키징(dev) 안내 에러 — 자동 업데이트는 설치본에서만 동작. */
function devUnsupported(): Result<never> {
  return err({
    code: 'EUNSUPPORTED',
    message: '자동 업데이트는 설치본에서만 동작합니다(개발 빌드).'
  })
}

/** update:check — 새 버전 확인(다운로드는 하지 않음). */
export async function checkForUpdate(): Promise<Result<UpdateCheckRes>> {
  if (!app.isPackaged) return devUnsupported()
  try {
    const r = await autoUpdater.checkForUpdates()
    const current = app.getVersion()
    // r 가 null 이면 확인 불가 — 최신으로 간주(보수적).
    const latest = r?.updateInfo?.version ?? null
    const available = !!latest && latest !== current
    return ok({ currentVersion: current, available, version: available ? latest : null })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    broadcast({ phase: 'error', message })
    return err({ code: 'EUNKNOWN', message })
  }
}

/** update:download — 업데이트 파일 다운로드 시작(진행률은 update:status). */
export async function downloadUpdate(): Promise<Result<void>> {
  if (!app.isPackaged) return devUnsupported()
  try {
    await autoUpdater.downloadUpdate()
    return ok(undefined)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    broadcast({ phase: 'error', message })
    return err({ code: 'EUNKNOWN', message })
  }
}

/** update:install — 지금 종료하고 설치(다운로드 완료 후에만 의미 있음). */
export function quitAndInstallUpdate(): Result<void> {
  if (!app.isPackaged) return devUnsupported()
  // isSilent=false(설치 UI 표시), isForceRunAfter=true(설치 후 앱 재실행).
  setImmediate(() => autoUpdater.quitAndInstall(false, true))
  return ok(undefined)
}
