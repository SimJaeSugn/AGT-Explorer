import { contextBridge } from 'electron'
import { api } from './api'

// contextIsolation:true 전제 — window 에 직접 할당하지 않고 contextBridge 로만 노출한다.
// (ADR-005: 권한 누수 차단, 메서드 단위 한정 노출)
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error('[preload] exposeInMainWorld 실패:', error)
  }
} else {
  // 격리가 꺼진 비정상 환경 폴백 (정상 경로에서는 도달하지 않음).
  // @ts-expect-error -- contextIsolation 비활성 폴백
  window.api = api
}
