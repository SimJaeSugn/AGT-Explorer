/**
 * compareSlice — 듀얼 패널 폴더 비교 모드·결과·동기 스크롤·필터 (§P1·US-15.1·F20).
 *
 * **M6: 단일 깊이 메타 비교**(이름·크기·수정일·렌더러 순수·채널 0).
 * **M7 확장(§P1)**: ① 내용(해시) 비교 ② 재귀 하위폴더 비교. 옵션 on 이면 백엔드
 * `hash:compare:*`(compareEngine·진행률·취소)로 계산해 결과를 미러하고, off 면 **M6
 * 메타 경로 그대로**(렌더러 계산·동치·채널 0). 분류는 domain/rules/compare.ts 가 수행한다.
 *
 * 휘발 런타임 상태(세션 미저장 — 부팅 시 비교 off·옵션 기본 off). ADR-002 §5.2.
 *
 * 미러(파괴적)는 usecases/compare 가 기존 op:*(복사/휴지통) 로 수행한다(신규 채널 0,
 * 휴지통·K1 undo 자동 적재). 슬라이스는 모드 토글·결과·옵션·해시 잡 상태만 관리한다.
 */
import type { ComparePairDTO, CompareSummary, FileEntryDTO } from '@shared/dto'
import {
  compareEntries,
  fromCompareResult,
  summarize,
  DEFAULT_COMPARE_OPTIONS,
  type ComparePair,
  type CompareOptions
} from '@renderer/domain/rules/compare'
import type { SliceCreator } from './types'

/** 해시/재귀 비교(백엔드 hash:compare 잡) 진행 상태머신. idle=메타 경로(M6). */
export type CompareHashStatus = 'idle' | 'running' | 'ready' | 'error' | 'canceled'

export interface CompareSlice {
  /** 비교 모드 on/off(좌/우 2분할 패널 페어 단위). */
  readonly compareActive: boolean
  /** 비교 대상 좌 패널 id(활성 시 세팅). */
  readonly compareLeftPanelId: string | null
  /** 비교 대상 우 패널 id(활성 시 세팅). */
  readonly compareRightPanelId: string | null
  /** 짝지어 분류한 페어 목록(정렬됨). */
  readonly comparePairs: ComparePair[]
  /** 4상태 요약(비활성이면 null). */
  readonly compareSummary: CompareSummary | null
  /** "차이만 보기"(same 제외 — left-only/right-only/diff만 표시). */
  readonly compareDiffOnly: boolean
  /** 동기 스크롤 토글(좌/우 패널 스크롤 연동). */
  readonly syncScroll: boolean
  /** 비교 기준 옵션(메타·대소문자·허용오차·useHash·recursive). */
  readonly compareOptions: CompareOptions

  // ── M7 §P1 해시/재귀 비교(백엔드 hash:compare 잡) ─────────────────────────
  /** 해시/재귀 비교 잡 상태머신(idle=메타 경로·M6). */
  readonly compareHashStatus: CompareHashStatus
  /** 진행 중 해시 잡 식별(hash:compare:start 발급·progress/done 상관). 없으면 null. */
  readonly compareJobId: string | null
  /** 진행률: 스캔한 항목 수(해시/재귀). */
  readonly compareScannedItems: number
  /** 진행률: 스캔한 바이트(해시 진행). */
  readonly compareScannedBytes: number
  /** 진행률: 현재 처리 중 경로(표시용). */
  readonly compareCurrentPath: string
  /** 결과 항목 상한 도달(정직 표기·hash:compare:done.truncated). */
  readonly compareTruncated: boolean
  /** 해시 잡 오류 메시지(없으면 null). */
  readonly compareHashError: string | null

  /**
   * 양 패널 entries 로 즉시 비교 계산(모드 on). 이미 로드된 entries 만 사용(채널 0).
   * @param leftPanelId 좌 패널 id
   * @param rightPanelId 우 패널 id
   * @param leftEntries 좌 패널 directory.entries
   * @param rightEntries 우 패널 directory.entries
   */
  runCompare(
    leftPanelId: string,
    rightPanelId: string,
    leftEntries: readonly FileEntryDTO[],
    rightEntries: readonly FileEntryDTO[]
  ): void
  /** 양 패널 entries 변경 시 재계산(패널/옵션 유지). 비활성이면 무동작. */
  recomputeCompare(
    leftEntries: readonly FileEntryDTO[],
    rightEntries: readonly FileEntryDTO[]
  ): void
  /** 비교 모드 종료(결과 비움·동기 스크롤 유지 안 함). */
  clearCompare(): void
  /** "차이만 보기" 토글. */
  toggleDiffOnly(): void
  /** 동기 스크롤 토글. */
  toggleSyncScroll(): void
  /** 비교 옵션 갱신 후 재계산이 필요하면 호출측이 recomputeCompare 호출. */
  setCompareOptions(opts: Partial<CompareOptions>): void

  // ── M7 §P1 해시/재귀 비교 브리지(usecases/compare 가 호출) ────────────────
  /** 해시/재귀 잡 시작 표시(jobId 보관·status running·진행률 리셋). */
  beginCompareHash(jobId: string): void
  /** 진행률 미러(hash:compare:progress). */
  _compareHashProgress(scannedItems: number, scannedBytes: number, currentPath: string): void
  /**
   * 해시/재귀 결과 수용(hash:compare:done) — DTO 페어를 ComparePair 로 환산해 미러.
   * status=ready·요약 재계산·truncated 표기. 잡 상관은 호출측(bridge)이 필터.
   */
  _compareHashDone(pairs: readonly ComparePairDTO[], truncated: boolean): void
  /** 해시/재귀 잡 오류(hash:error 또는 시작 실패). */
  _compareHashError(message: string): void
  /** 해시/재귀 잡 취소 표시(hash:cancel 호출 후). */
  markCompareHashCanceling(): void
}

export const createCompareSlice: SliceCreator<CompareSlice> = (set, get) => ({
  compareActive: false,
  compareLeftPanelId: null,
  compareRightPanelId: null,
  comparePairs: [],
  compareSummary: null,
  compareDiffOnly: false,
  syncScroll: true,
  compareOptions: DEFAULT_COMPARE_OPTIONS,
  compareHashStatus: 'idle',
  compareJobId: null,
  compareScannedItems: 0,
  compareScannedBytes: 0,
  compareCurrentPath: '',
  compareTruncated: false,
  compareHashError: null,

  runCompare(leftPanelId, rightPanelId, leftEntries, rightEntries) {
    const pairs = compareEntries(leftEntries, rightEntries, get().compareOptions)
    set((s) => {
      s.compareActive = true
      s.compareLeftPanelId = leftPanelId
      s.compareRightPanelId = rightPanelId
      s.comparePairs = pairs
      s.compareSummary = summarize(pairs)
    })
  },

  recomputeCompare(leftEntries, rightEntries) {
    if (!get().compareActive) return
    const pairs = compareEntries(leftEntries, rightEntries, get().compareOptions)
    set((s) => {
      s.comparePairs = pairs
      s.compareSummary = summarize(pairs)
    })
  },

  clearCompare() {
    set((s) => {
      s.compareActive = false
      s.compareLeftPanelId = null
      s.compareRightPanelId = null
      s.comparePairs = []
      s.compareSummary = null
      s.compareDiffOnly = false
      // 해시/재귀 잡 상태도 리셋(메타 경로로 복귀).
      s.compareHashStatus = 'idle'
      s.compareJobId = null
      s.compareScannedItems = 0
      s.compareScannedBytes = 0
      s.compareCurrentPath = ''
      s.compareTruncated = false
      s.compareHashError = null
    })
  },

  toggleDiffOnly() {
    set((s) => {
      s.compareDiffOnly = !s.compareDiffOnly
    })
  },

  toggleSyncScroll() {
    set((s) => {
      s.syncScroll = !s.syncScroll
    })
  },

  setCompareOptions(opts) {
    set((s) => {
      s.compareOptions = { ...s.compareOptions, ...opts }
    })
  },

  beginCompareHash(jobId) {
    set((s) => {
      s.compareHashStatus = 'running'
      s.compareJobId = jobId
      s.compareScannedItems = 0
      s.compareScannedBytes = 0
      s.compareCurrentPath = ''
      s.compareTruncated = false
      s.compareHashError = null
    })
  },

  _compareHashProgress(scannedItems, scannedBytes, currentPath) {
    set((s) => {
      if (s.compareHashStatus !== 'running') return
      s.compareScannedItems = scannedItems
      s.compareScannedBytes = scannedBytes
      s.compareCurrentPath = currentPath
    })
  },

  _compareHashDone(pairs, truncated) {
    const converted = fromCompareResult(pairs, get().compareOptions)
    set((s) => {
      s.compareHashStatus = 'ready'
      s.comparePairs = converted
      s.compareSummary = summarize(converted)
      s.compareTruncated = truncated
      s.compareCurrentPath = ''
      s.compareJobId = null
    })
  },

  _compareHashError(message) {
    set((s) => {
      s.compareHashStatus = 'error'
      s.compareHashError = message
      s.compareJobId = null
      s.compareCurrentPath = ''
    })
  },

  markCompareHashCanceling() {
    set((s) => {
      if (s.compareHashStatus === 'running') {
        s.compareHashStatus = 'canceled'
        s.compareJobId = null
        s.compareCurrentPath = ''
      }
    })
  }
})
