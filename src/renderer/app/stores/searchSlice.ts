/**
 * searchSlice — 내용 검색(grep) 결과 상태 (§S1·US-18.1·F20·ADR-010).
 *
 * 백엔드 `search:content:*`(start/progress/match/done·cancel)가 스트리밍한 파일 단위
 * 결과를 누적하고 진행률(스캔/일치 파일·현재 경로)·완료·취소·오류·결과 절단(truncated)을
 * 보유한다. 실제 IPC 호출·구독은 usecases/contentSearch 가 담당하고(app→infra 경계),
 * 이 슬라이스는 데이터만 다룬다(dedupSlice 동형 — Immer 슬라이스, 고빈도 아님).
 *
 * 모달 열림(contentSearchOpen)·inputContext 'dialog' 게이트도 여기서 보유한다
 * (dedup 은 uiSlice 가 보유했으나 검색 상태는 한 슬라이스로 응집 — 모달 표면이 작음).
 *
 * 상태머신: idle → running(jobId·진행률·증분 결과 적재) → done | error | canceled.
 * match 이벤트는 200ms 스로틀된 progress 와 별개로 파일 단위 즉시 푸시(첫 결과 빠름).
 */
import type { GrepMatchDTO } from '@shared/dto'
import { countRows } from '@renderer/domain/rules/contentSearch'
import type { SliceCreator } from './types'

export type ContentSearchStatus = 'idle' | 'running' | 'done' | 'error' | 'canceled'

export interface SearchSlice {
  /** 내용 검색 모달 열림 여부(§S1). */
  readonly contentSearchOpen: boolean
  /** 검색 상태머신. */
  readonly searchStatus: ContentSearchStatus
  /** 진행 중 잡 식별(search:content:start 발급, progress/match/done 상관). 없으면 null. */
  readonly searchJobId: string | null
  /** 검색 루트(활성 패널 폴더 — 상대경로 표시·재시도 기준). */
  readonly searchRoot: string
  /** 검색어(문자열 또는 정규식 소스). */
  readonly searchQuery: string
  /** true=정규식 검색. */
  readonly searchIsRegex: boolean
  /** true=하위 폴더 재귀. */
  readonly searchRecursive: boolean
  /** true=숨김/시스템 파일 포함. */
  readonly searchIncludeHidden: boolean
  /** 파일 단위 누적 결과(증분 match 푸시). */
  readonly searchResults: GrepMatchDTO[]
  /** 평탄 결과 행 수 캐시(헤더+줄 — 진행 표시·키보드 이동 한계). */
  readonly searchRowCount: number
  /** 진행률: 스캔(텍스트 후보)한 파일 수. */
  readonly searchScannedFiles: number
  /** 진행률: 1건 이상 일치한 파일 수. */
  readonly searchMatchedFiles: number
  /** 진행률: 현재 처리 중 경로(표시용). */
  readonly searchCurrentPath: string
  /** 완료 시 총 일치 수(done evt). */
  readonly searchTotalMatches: number
  /** 결과 상한 도달로 잘렸는지(정직 표기). */
  readonly searchTruncated: boolean
  /** 오류 메시지(없으면 null). */
  readonly searchError: string | null

  // 모달 열림 ───────────────────────────────────────────────────────────────
  /** 내용 검색 모달 열기(inputContext='dialog'). 초기 query 시드(선택). */
  openContentSearch(seedQuery?: string): void
  /** 내용 검색 모달 닫기(다른 모달 없으면 inputContext='list' 복귀). */
  closeContentSearch(): void

  // 폼 토글(시작 전 입력) ─────────────────────────────────────────────────────
  setSearchFormQuery(query: string): void
  setSearchIsRegex(v: boolean): void
  setSearchRecursive(v: boolean): void
  setSearchIncludeHidden(v: boolean): void

  // usecase 브리지(usecases/contentSearch 가 호출) ───────────────────────────
  /** 검색 시작(jobId·root·옵션 보관·상태 running·이전 결과 비움). */
  beginContentSearch(jobId: string, root: string): void
  /** 파일 단위 증분 결과 적재(search:content:match). */
  _searchAppend(match: GrepMatchDTO): void
  /** 진행률 미러(search:content:progress). */
  _searchProgress(scannedFiles: number, matchedFiles: number, currentPath: string): void
  /** 완료(search:content:done) — status=done·총 일치·절단 표기. */
  _searchDone(totalMatches: number, truncated: boolean): void
  /** 오류(시작 실패 또는 정규식 컴파일 실패 등). */
  _searchError(message: string): void
  /** 취소 표시(search:content:cancel 호출 후). */
  markSearchCanceling(): void
  /** 결과/진행 초기화(모달 내 "지우기"). 폼 옵션은 유지. */
  clearSearch(): void
}

export const createSearchSlice: SliceCreator<SearchSlice> = (set) => ({
  contentSearchOpen: false,
  searchStatus: 'idle',
  searchJobId: null,
  searchRoot: '',
  searchQuery: '',
  searchIsRegex: false,
  searchRecursive: true,
  searchIncludeHidden: false,
  searchResults: [],
  searchRowCount: 0,
  searchScannedFiles: 0,
  searchMatchedFiles: 0,
  searchCurrentPath: '',
  searchTotalMatches: 0,
  searchTruncated: false,
  searchError: null,

  openContentSearch(seedQuery) {
    set((s) => {
      s.contentSearchOpen = true
      s.inputContext = 'dialog'
      if (seedQuery !== undefined && seedQuery !== '') s.searchQuery = seedQuery
    })
  },

  closeContentSearch() {
    set((s) => {
      s.contentSearchOpen = false
      if (
        !s.confirmDelete &&
        !s.renameTarget &&
        !s.settingsOpen &&
        !s.dashboardOpen &&
        !s.workspaceOpen &&
        !s.trashOpen &&
        !s.remoteDialogOpen &&
        !s.batchRenameOpen &&
        !s.dedupOpen &&
        !s.queuePanelOpen &&
        !s.paletteOpen &&
        !s.quickLookPath
      ) {
        s.inputContext = 'list'
      }
    })
  },

  setSearchFormQuery(query) {
    set((s) => {
      s.searchQuery = query
    })
  },
  setSearchIsRegex(v) {
    set((s) => {
      s.searchIsRegex = v
    })
  },
  setSearchRecursive(v) {
    set((s) => {
      s.searchRecursive = v
    })
  },
  setSearchIncludeHidden(v) {
    set((s) => {
      s.searchIncludeHidden = v
    })
  },

  beginContentSearch(jobId, root) {
    set((s) => {
      s.searchStatus = 'running'
      s.searchJobId = jobId
      s.searchRoot = root
      s.searchResults = []
      s.searchRowCount = 0
      s.searchScannedFiles = 0
      s.searchMatchedFiles = 0
      s.searchCurrentPath = ''
      s.searchTotalMatches = 0
      s.searchTruncated = false
      s.searchError = null
    })
  },

  _searchAppend(match) {
    set((s) => {
      if (s.searchStatus !== 'running') return
      // GrepMatchDTO.lines[].ranges 는 readonly 튜플 → immer WritableDraft 와 충돌하므로
      // draft 배열 요소 타입으로 캐스트해 push(결과는 읽기 전용으로만 소비 — 변형하지 않음).
      s.searchResults.push({ file: match.file, lines: [...match.lines] } as (typeof s.searchResults)[number])
      s.searchRowCount = countRows(s.searchResults)
    })
  },

  _searchProgress(scannedFiles, matchedFiles, currentPath) {
    set((s) => {
      if (s.searchStatus !== 'running') return
      s.searchScannedFiles = scannedFiles
      s.searchMatchedFiles = matchedFiles
      s.searchCurrentPath = currentPath
    })
  },

  _searchDone(totalMatches, truncated) {
    set((s) => {
      if (s.searchStatus !== 'running') return
      s.searchStatus = 'done'
      s.searchJobId = null
      s.searchTotalMatches = totalMatches
      s.searchTruncated = truncated
      s.searchCurrentPath = ''
    })
  },

  _searchError(message) {
    set((s) => {
      s.searchStatus = 'error'
      s.searchError = message
      s.searchJobId = null
      s.searchCurrentPath = ''
    })
  },

  markSearchCanceling() {
    set((s) => {
      if (s.searchStatus === 'running') {
        s.searchStatus = 'canceled'
        s.searchJobId = null
        s.searchCurrentPath = ''
      }
    })
  },

  clearSearch() {
    set((s) => {
      s.searchStatus = 'idle'
      s.searchJobId = null
      s.searchResults = []
      s.searchRowCount = 0
      s.searchScannedFiles = 0
      s.searchMatchedFiles = 0
      s.searchCurrentPath = ''
      s.searchTotalMatches = 0
      s.searchTruncated = false
      s.searchError = null
    })
  }
})
