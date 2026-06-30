/**
 * deviceChange — 드라이브 토폴로지 변경 감지 (USB 등 연결/해제).
 *
 * Windows 는 이동식/네트워크 드라이브가 마운트·언마운트되면 모든 최상위 창에
 * WM_DEVICECHANGE(0x0219) 메시지를 보낸다. Electron 의 `BrowserWindow.hookWindowMessage`
 * 로 이 메시지를 가로채(네이티브 의존성 0 — Windows 전용 내장 API) 디바운스한 뒤,
 * 열린 모든 창에 `fs:drives-changed` 를 1건 푸시한다. 렌더러는 이를 받아 드라이브 목록을
 * 재열거한다(사이드바 트리·"내 PC" 패널·대시보드).
 *
 * 메시지 wParam(DBT_DEVICEARRIVAL/REMOVECOMPLETE 등)은 굳이 파싱하지 않는다 — 연결이든
 * 해제든 동일하게 "드라이브 목록을 다시 읽어라" 신호이고, 한 번의 토폴로지 변경이 여러
 * 메시지를 연달아 일으키므로 디바운스로 묶어 단일 재열거로 수렴시킨다.
 *
 * 부수효과로 드라이브 미디어(SSD/HDD)·네트워크 드라이브 문자 캐시도 함께 새로고침한다
 * (새 드라이브의 동시성·네트워크 판정 정합). 두 서비스 모두 throttle+격리(throw 0)라 안전.
 */
import { BrowserWindow } from 'electron'
import { CHANNELS } from '@shared/ipc/channels'
import { driveTypeService } from './driveType'
import { diskTypeService } from './diskType'

/** WM_DEVICECHANGE — 디바이스/미디어 토폴로지 변경 윈도우 메시지. */
const WM_DEVICECHANGE = 0x0219

/** 변경 메시지 버스트를 한 번의 재열거로 묶는 디바운스(ms). */
const DEBOUNCE_MS = 1200

let timer: ReturnType<typeof setTimeout> | null = null

/** 열린 모든 창에 드라이브 변경을 1건 푸시하고 미디어/네트워크 캐시를 새로고침한다. */
function broadcastDrivesChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(CHANNELS.FS_DRIVES_CHANGED, {})
  }
  // 새 드라이브의 SSD/HDD·네트워크 여부 캐시 갱신(격리·throw 0 — 실패해도 푸시는 이미 나감).
  void driveTypeService.refresh()
  void diskTypeService.refresh()
}

/**
 * 주어진 창에 WM_DEVICECHANGE 훅을 건다(디바운스 후 전역 푸시). Windows 전용 —
 * 다른 OS 에서는 hookWindowMessage 가 없거나 무의미하므로 조용히 건너뛴다(throw 0).
 * primary 창 1개에만 걸어도 최상위 창은 메시지를 받으므로 충분하다(푸시는 전 창 대상).
 */
export function initDeviceChangeWatch(win: BrowserWindow): void {
  if (process.platform !== 'win32') return
  try {
    win.hookWindowMessage(WM_DEVICECHANGE, () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        broadcastDrivesChanged()
      }, DEBOUNCE_MS)
    })
    win.on('closed', () => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    })
  } catch (err) {
    // hookWindowMessage 미지원/실패는 기능 저하(자동 갱신 없음)일 뿐 부팅 영향 0.
    // eslint-disable-next-line no-console
    console.error('[deviceChange] WM_DEVICECHANGE 훅 실패 — 드라이브 자동 갱신 비활성:', err)
  }
}
