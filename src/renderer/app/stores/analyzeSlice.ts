/**
 * analyzeSlice — 디렉토리 사용량 대시보드 상태 (I장 §1·§2.7).
 *
 * 두 데이터 축을 보유한다:
 *  (1) 디스크 요약: fsApi.drives() 결과(DriveDTO[]) + 파생(used·freePct)은 셀렉터에서.
 *  (2) Top10 스캔: analyze:scan:* 의 진행/완료/오류 미러.
 *
 * Immer 제외 정신(operationsSlice 선례): 200ms 고빈도 progress 푸시라 평탄 교체로
 * 다룬다. 단일 활성 스캔만 추적한다(scanId 상관은 브리지에서 필터).
 *
 * 다이얼로그(대시보드) 열림/닫힘·inputContext 책임은 uiSlice 에 둔다(슬라이스는 데이터만).
 */
import type { DriveDTO, ScanResult } from '@shared/dto'
import type { SliceCreator } from './types'

/** 스캔 진행률 스냅샷(analyze:scan:progress 미러). */
export interface ScanProgress {
  readonly scannedItems: number
  readonly scannedBytes: number
  readonly currentPath: string
}

/** 스캔 상태머신. */
export type ScanStatus = 'idle' | 'scanning' | 'done' | 'error' | 'canceled'

function emptyProgress(): ScanProgress {
  return { scannedItems: 0, scannedBytes: 0, currentPath: '' }
}

export interface AnalyzeSlice {
  // ── 디스크 요약 ────────────────────────────────────────────────────────
  /** fsApi.drives() 결과(원본 DTO). 파생값(used·freePct)은 셀렉터/뷰에서 계산. */
  readonly drives: DriveDTO[]
  /** 드라이브 로딩 중 여부. */
  readonly drivesLoading: boolean
  /** 드라이브 로드 오류 메시지(없으면 null). */
  readonly drivesError: string | null

  // ── Top10 스캔 ─────────────────────────────────────────────────────────
  /** 현재 활성 스캔 ID(없으면 null). */
  readonly scanId: string | null
  /** 스캔 대상 루트(표시용). */
  readonly scanRoot: string | null
  readonly scanStatus: ScanStatus
  readonly scanProgress: ScanProgress
  /** 완료 결과(없으면 null). */
  readonly scanResult: ScanResult | null
  /** 스캔 오류 메시지(없으면 null). */
  readonly scanError: string | null

  // ── 디스크 요약 액션 ─────────────────────────────────────────────────────
  setDrivesLoading(v: boolean): void
  setDrives(drives: DriveDTO[]): void
  setDrivesError(msg: string | null): void

  // ── 스캔 액션(usecase/dashboard 가 호출) ─────────────────────────────────
  /** 스캔 시작 등록(scanStart 성공 후): scanId·root 보관, status=scanning, 이전 결과 초기화. */
  beginScan(scanId: string, root: string): void
  /** 취소 요청 표시(scanCancel 호출 후): status=canceled 후속은 done 이벤트가 확정. */
  markScanCanceling(): void

  // ── 스캔 이벤트 진입(infra 브리지가 scanId 상관 후 호출) ──────────────────
  _scanProgress(scannedItems: number, scannedBytes: number, currentPath: string): void
  _scanDone(result: ScanResult): void
  _scanError(message: string): void

  /** 스캔 상태 초기화(대시보드 닫기·새 스캔 전). */
  resetScan(): void
}

export const createAnalyzeSlice: SliceCreator<AnalyzeSlice> = (set) => ({
  drives: [],
  drivesLoading: false,
  drivesError: null,

  scanId: null,
  scanRoot: null,
  scanStatus: 'idle',
  scanProgress: emptyProgress(),
  scanResult: null,
  scanError: null,

  setDrivesLoading(v) {
    set((s) => {
      s.drivesLoading = v
    })
  },

  setDrives(drives) {
    set((s) => {
      s.drives = drives
      s.drivesLoading = false
      s.drivesError = null
    })
  },

  setDrivesError(msg) {
    set((s) => {
      s.drivesError = msg
      s.drivesLoading = false
    })
  },

  beginScan(scanId, root) {
    set((s) => {
      s.scanId = scanId
      s.scanRoot = root
      s.scanStatus = 'scanning'
      s.scanProgress = emptyProgress()
      s.scanResult = null
      s.scanError = null
    })
  },

  markScanCanceling() {
    set((s) => {
      // done 이벤트가 canceled:true 로 확정하므로 여기서는 표시만(진행 카운터 유지).
      if (s.scanStatus === 'scanning') s.scanStatus = 'canceled'
    })
  },

  _scanProgress(scannedItems, scannedBytes, currentPath) {
    set((s) => {
      // 취소 표시 후에도 done 전까지 들어오는 잔여 progress 는 무시(취소 후 무유입 계약).
      if (s.scanStatus !== 'scanning') return
      s.scanProgress = { scannedItems, scannedBytes, currentPath }
    })
  },

  _scanDone(result) {
    set((s) => {
      s.scanResult = result
      s.scanStatus = result.canceled ? 'canceled' : 'done'
      s.scanError = null
    })
  },

  _scanError(message) {
    set((s) => {
      s.scanStatus = 'error'
      s.scanError = message
    })
  },

  resetScan() {
    set((s) => {
      s.scanId = null
      s.scanRoot = null
      s.scanStatus = 'idle'
      s.scanProgress = emptyProgress()
      s.scanResult = null
      s.scanError = null
    })
  }
})
