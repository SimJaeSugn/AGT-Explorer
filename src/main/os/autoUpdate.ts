/**
 * AutoUpdate — GitHub Releases 기반 자동 업데이트 (electron-updater / P7).
 *
 * 앱 시작 후 한 번 `latest.yml`(electron-builder 가 릴리스에 함께 게시)을 조회해
 * 새 버전이 있으면 **백그라운드로 차등 다운로드**하고, 다운로드가 끝나면 OS 네이티브
 * 알림을 띄운다(checkForUpdatesAndNotify). 실제 설치는 사용자가 앱을 다음에 재시작할 때
 * NSIS 인스톨러가 조용히 적용한다(autoInstallOnAppQuit 기본 true).
 *
 * 동작 범위:
 *   - **패키징된 빌드에서만** 동작한다(`app.isPackaged`). dev/미패키징에서는 무동작 —
 *     electron-updater 는 app-update.yml(패키징 시 생성)이 없으면 throw 하므로 가드한다.
 *   - 채널·게시 위치는 electron-builder.yml 의 `publish:`(github) 에서 주입되어
 *     app-update.yml 로 번들된다(코드에 owner/repo 하드코딩 불필요).
 *
 * 견고성:
 *   - 모든 진입점 throw 0(격리). 네트워크 오류·레이트리밋·오프라인이어도 부팅/앱에 영향 0.
 *   - 자동 다운로드만 수행하고, 강제 재시작은 하지 않는다(사용자 작업 보호).
 *
 * 보안: 업데이트 파일은 electron-builder 가 생성한 `latest.yml` 의 SHA512 로 무결성 검증된다.
 * 코드 서명(CSC_*)이 적용되면 인스톨러 서명도 함께 검증된다(미서명이면 SmartScreen 경고만).
 */
import { app } from 'electron'
import { autoUpdater } from 'electron-updater'

let initialized = false

/**
 * 자동 업데이트를 초기화하고 1회 확인을 트리거한다(trigger-and-forget).
 * 패키징 빌드가 아니면 즉시 무동작으로 반환한다. 멱등(중복 호출 무시).
 */
export function initAutoUpdate(): void {
  if (initialized) return
  initialized = true

  // dev/미패키징(app-update.yml 부재)에서는 동작하지 않는다 — 조용히 스킵.
  if (!app.isPackaged) return

  // 다운로드 완료까지는 자동, 설치는 다음 재시작에 적용(작업 중 강제 종료 방지).
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  // 진단 로그(electron-log 미사용 — console 로만; 실패해도 격리).
  autoUpdater.on('error', (err) => {
    console.warn('[autoUpdate] error:', err?.message ?? err)
  })
  autoUpdater.on('update-available', (info) => {
    console.info('[autoUpdate] update available:', info.version)
  })
  autoUpdater.on('update-not-available', () => {
    console.info('[autoUpdate] up to date')
  })
  autoUpdater.on('update-downloaded', (info) => {
    console.info('[autoUpdate] downloaded:', info.version, '— 다음 재시작 시 설치')
  })

  // 새 버전이 있으면 받고, 받은 뒤 OS 알림. 오류는 위 error 핸들러로 격리.
  void autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    console.warn('[autoUpdate] check failed:', err?.message ?? err)
  })
}
