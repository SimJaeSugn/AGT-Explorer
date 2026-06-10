/**
 * dashboard 유스케이스 (I장 §1.3·§2.7) — 디스크 요약 로드 + Top10 스캔 제어 + 이벤트 브리지.
 *
 *  - loadDriveUsage(): fsApi.drives() → analyzeSlice.drives. 파생(used·freePct)은 셀렉터에서.
 *  - startScan(root): analyzeApi.scanStart → scanId 보관(beginScan).
 *  - cancelScan(): analyzeApi.scanCancel(scanId) → markScanCanceling.
 *  - initScanBridge(): App 부팅 시 1회. subscribeScanStream 전역 구독 → scanId 상관으로
 *    analyzeSlice 진행/완료/오류 갱신(operationsBridge 패턴).
 *
 * app → infra/api 직접 호출(.eslintrc 허용). 실패는 슬라이스 오류 필드/토스트로 안내(비차단).
 */
import type { ScanEntry } from '@shared/dto'
import { analyzeApi, fsApi, shellApi, subscribeScanStream } from '@renderer/infra/api'
import { store } from '@renderer/app/stores/rootStore'
import { parentOf } from '@renderer/domain/paths'

/** fsApi.drives() 로 디스크 목록 로드 → analyzeSlice.drives 갱신. */
export async function loadDriveUsage(): Promise<void> {
  const s = store.getState()
  s.setDrivesLoading(true)
  const res = await fsApi.drives()
  if (res.ok) {
    store.getState().setDrives(res.value)
  } else {
    store.getState().setDrivesError(res.error.message ?? '드라이브 정보를 불러오지 못했습니다.')
  }
}

/**
 * 루트(폴더 또는 드라이브) Top10 스캔 시작. 진행 중 스캔이 있으면 먼저 취소한다.
 * scanStart 성공 시 scanId 를 보관(beginScan)해 이후 progress/done 을 상관시킨다.
 */
export async function startScan(root: string): Promise<void> {
  const s = store.getState()
  // 진행 중 스캔이 있으면 선취소(중복 방지).
  if (s.scanId && s.scanStatus === 'scanning') {
    await analyzeApi.scanCancel(s.scanId)
  }
  const res = await analyzeApi.scanStart({ root })
  if (res.ok) {
    store.getState().beginScan(res.value.scanId, root)
  } else {
    store.getState()._scanError(res.error.message ?? '스캔을 시작하지 못했습니다.')
  }
}

/** 진행 중 스캔 협조취소. scanId 없으면 무시. */
export async function cancelScan(): Promise<void> {
  const s = store.getState()
  if (!s.scanId || s.scanStatus !== 'scanning') return
  s.markScanCanceling()
  await analyzeApi.scanCancel(s.scanId)
}

/**
 * 스캔결과 항목의 위치로 활성 패널을 이동시키고 대시보드를 닫는다(V1 — "위치로 이동").
 * 폴더는 그 폴더로 진입하고, 파일은 파일이 든 상위(부모) 폴더로 이동한다. 활성 패널이
 * 없거나 상위가 없는 경로(내 PC 등)는 무시한다. 결과 섹션에서만 호출되므로 진행 중
 * 스캔과 충돌하지 않는다(closeDashboard 가 협조취소 없이 닫아도 안전).
 */
export function jumpToScanEntry(entry: ScanEntry): void {
  const s = store.getState()
  const panelId = s.activePanelId()
  if (!panelId) return
  const target = entry.isDir ? entry.path : parentOf(entry.path)
  if (target === null) return
  s.navigate(panelId, target, true)
  s.closeDashboard()
}

/** Google AI 모드(udm=50) 검색 진입점. 항목 이름·종류로 질의를 프리필한다. */
const GOOGLE_AI_MODE_BASE = 'https://www.google.com/search?udm=50'

/**
 * Google AI 모드로 해당 파일/폴더에 대한 질의를 OS 기본 브라우저에서 연다(V1).
 * URL 프로토콜 화이트리스트(http/https) 검증은 main(shell.handlers)이 수행한다.
 * 실패는 토스트로 안내(비차단).
 */
export async function askGoogleAiAboutEntry(entry: ScanEntry): Promise<void> {
  const kind = entry.isDir ? '폴더' : '파일'
  const query = `${entry.name} ${kind}에 대해 알려줘`
  const url = `${GOOGLE_AI_MODE_BASE}&q=${encodeURIComponent(query)}`
  const res = await shellApi.openExternal(url)
  if (!res.ok) {
    store.getState().pushToast('error', '브라우저에서 링크를 열지 못했습니다.')
  }
}

let disposer: (() => void) | null = null

/**
 * analyze:scan:* 전역 구독 시작(중복 호출 무시). scanId 가 현재 활성 스캔과
 * 일치하는 이벤트만 슬라이스에 반영(상관 필터) — 취소·교체된 스캔의 잔여 이벤트 격리.
 */
export function initScanBridge(): void {
  if (disposer) return
  disposer = subscribeScanStream({
    onProgress: (evt) => {
      const s = store.getState()
      if (evt.scanId !== s.scanId) return
      s._scanProgress(evt.scannedItems, evt.scannedBytes, evt.currentPath)
    },
    onDone: (evt) => {
      const s = store.getState()
      if (evt.scanId !== s.scanId) return
      s._scanDone(evt.result)
    },
    onError: (evt) => {
      const s = store.getState()
      if (evt.scanId !== s.scanId) return
      s._scanError(evt.error.message ?? '스캔 중 오류가 발생했습니다.')
    }
  })
}

/** 구독 해제(테스트·HMR). */
export function disposeScanBridge(): void {
  if (disposer) {
    disposer()
    disposer = null
  }
}
