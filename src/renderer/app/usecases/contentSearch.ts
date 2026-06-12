/**
 * 내용 검색(grep) 유스케이스 (app/usecases/contentSearch) — 시작·구독·점프 (§S1·US-18.1·F20·ADR-010).
 *
 * 백엔드 `search:content:*`(스트리밍 grep)로 활성 패널 폴더(+하위 토글)의 파일 내부 텍스트를
 * 검색하고, 증분 결과(match)·진행률(progress)·완료(done)를 searchSlice 에 누적한다. 결과 줄을
 * 클릭하면 활성 패널을 그 파일의 부모 폴더로 이동시키고 파일을 단일 선택해 미리보기(J5/D3)에
 * 자동 표출한다(미리보기는 PreviewPanel 이 단일 선택을 따라 preview:read 재사용 — 신규 채널 0).
 *
 * 범위(root): 활성 패널의 현재 폴더(로컬 한정). "내 PC"·원격 경로는 거부(ADR-005·ADR-010 1차 제외).
 * 새 검색 시작·패널 이동·모달 종료 시 진행 잡을 취소한다(누수 방지).
 *
 * 경계: app → infra/api(searchApi·subscribeContentSearchStream) 직접 호출(.eslintrc 허용).
 * 결과 표현 순수 로직은 domain/rules/contentSearch 에 위임.
 */
import { searchApi, subscribeContentSearchStream } from '@renderer/infra/api'
import { store } from '@renderer/app/stores/rootStore'
import { isMyPc, parentOf } from '@renderer/domain/paths'
import { isRemotePath } from '@renderer/domain/rules/remoteLocation'
import { visibleEntries } from './selectors'

/** 활성 패널의 현재 폴더(검색 범위). "내 PC"·원격이면 null. */
function activeRoot(): string | null {
  const s = store.getState()
  const pid = s.activePanelId()
  if (!pid) return null
  const path = s.panels[pid]?.path
  if (path === undefined || path === '' || isMyPc(path) || isRemotePath(path)) return null
  return path
}

/**
 * 내용 검색 모달 열기 — 활성 패널 폴더를 범위로 삼아 모달을 띄운다. 검색 자체는 사용자가
 * "검색" 버튼/Enter 로 시작(startContentSearch). 활성 폴더가 로컬이 아니면 안내 후 중단.
 * seedQuery 가 있으면(이름 검색바에서 전환) 입력에 채운다.
 */
export function openContentSearch(seedQuery?: string): void {
  const s = store.getState()
  const root = activeRoot()
  if (!root) {
    s.pushToast('info', '내용 검색은 로컬 폴더에서만 사용할 수 있습니다.')
    return
  }
  s.openContentSearch(seedQuery)
}

/**
 * 내용 검색 시작 — 현재 폼(query/isRegex/recursive/includeHidden)으로 search:content:start.
 * 진행 중 잡이 있으면 먼저 취소한다(중복 방지). 빈 검색어는 무시.
 */
export async function startContentSearch(): Promise<void> {
  const s = store.getState()
  const root = activeRoot()
  if (!root) {
    s.pushToast('info', '내용 검색은 로컬 폴더에서만 사용할 수 있습니다.')
    return
  }
  const query = s.searchQuery.trim()
  if (query === '') return
  // 진행 중 잡 선취소.
  if (s.searchJobId && s.searchStatus === 'running') {
    await searchApi.contentCancel(s.searchJobId)
  }
  const res = await searchApi.contentStart({
    root,
    query,
    isRegex: s.searchIsRegex,
    recursive: s.searchRecursive,
    includeHidden: s.searchIncludeHidden
  })
  if (!res.ok) {
    store.getState()._searchError(res.error.message ?? '검색을 시작하지 못했습니다.')
    return
  }
  store.getState().beginContentSearch(res.value.jobId, root)
}

/** 진행 중 검색 협조취소. jobId 없으면 무시. */
export async function cancelContentSearch(): Promise<void> {
  const s = store.getState()
  if (!s.searchJobId || s.searchStatus !== 'running') return
  const jobId = s.searchJobId
  s.markSearchCanceling()
  await searchApi.contentCancel(jobId)
}

/**
 * 결과 점프 — 활성 패널을 file 의 부모 폴더로 이동시키고, 목록 로딩 완료 시 그 파일을
 * 단일 선택한다. 단일 선택이 되면 PreviewPanel 이 자동으로 preview:read 를 호출하므로
 * 미리보기 패널이 열려 있지 않으면 함께 펼친다(발견성). 같은 폴더면 즉시 선택.
 */
export function jumpToResult(file: string): void {
  const s = store.getState()
  const pid = s.activePanelId()
  if (!pid) return
  const parent = parentOf(file)
  if (parent === null) return

  // 미리보기 패널이 닫혀 있으면 펼쳐 결과를 바로 보여준다(점프=보기 의도).
  if (!s.previewOpen) s.setPreviewOpen(true)

  const cur = s.panels[pid]?.path
  if (cur === parent) {
    selectInPanel(pid, file)
    return
  }
  s.navigate(pid, parent, true)
  // navigate 는 비동기 스트리밍 로딩이므로, 해당 패널이 목표 폴더를 ready/empty 로
  // 끝낼 때까지 기다렸다가 단일 선택한다(폴링 대신 store 구독 1회·타임아웃 가드).
  waitForPanelReady(pid, parent, file)
}

/** 패널의 directory 가 path 에 대해 로딩을 끝내면 file 단일 선택(1회·타임아웃 4s). */
function waitForPanelReady(panelId: string, path: string, file: string): void {
  let done = false
  const timer = setTimeout(() => {
    if (done) return
    done = true
    unsub()
    // 타임아웃이어도 best-effort 선택 시도(이미 로드됐을 수 있음).
    selectInPanel(panelId, file)
  }, 4000)

  const finish = (): void => {
    if (done) return
    done = true
    clearTimeout(timer)
    unsub()
    selectInPanel(panelId, file)
  }

  const unsub = store.subscribe((state) => {
    const p = state.panels[panelId]
    if (!p || p.path !== path) {
      // 사용자가 그새 다른 곳으로 이동 → 점프 포기(누수 방지).
      if (!done) {
        done = true
        clearTimeout(timer)
        unsub()
      }
      return
    }
    const st = p.directory.status
    if (st === 'ready' || st === 'empty' || st === 'error' || st === 'denied') {
      finish()
    }
  })
}

/** 패널에서 경로 1개를 단일 선택(파일이 목록에 있을 때만 의미). */
function selectInPanel(panelId: string, file: string): void {
  // 파일의 실제 목록 인덱스를 anchor 로 설정(0 고정 금지) — 점프 후 ↑/↓·Shift 범위·퀵룩이
  // 올바른 행 기준으로 동작하도록. 목록 미로딩 등으로 못 찾으면 0 폴백(기존 동작).
  const idx = visibleEntries(panelId).findIndex((e) => e.path === file)
  store.getState().setSelection(panelId, {
    anchorIndex: idx >= 0 ? idx : 0,
    selectedPaths: new Set<string>([file])
  })
}

let disposer: (() => void) | null = null
let navWatcher: (() => void) | null = null

/**
 * 활성 패널이 검색 루트에서 벗어나면(다른 폴더로 이동·탭 전환) 진행 중 grep 을 취소한다
 * (누수 방지·ADR-010 "다른 폴더로 이동하면 진행 잡 정리"). store 구독으로 path 변화를 감시.
 */
function watchNavigationCancel(): void {
  if (navWatcher) return
  navWatcher = store.subscribe((state) => {
    if (state.searchStatus !== 'running' || !state.searchJobId) return
    const pid = state.activePanelId()
    const curPath = pid ? state.panels[pid]?.path : undefined
    // 검색을 시작한 폴더(searchRoot)와 활성 패널 경로가 달라지면 취소.
    if (curPath !== state.searchRoot) {
      void cancelContentSearch()
    }
  })
}

/**
 * search:content:* 전역 구독 시작(중복 호출 무시). jobId 가 현재 활성 잡과 일치하는
 * 이벤트만 슬라이스에 반영(상관 필터) — 취소·교체된 잡의 잔여 이벤트 격리(dedupBridge 동형).
 */
export function initContentSearchBridge(): void {
  if (disposer) return
  watchNavigationCancel()
  disposer = subscribeContentSearchStream({
    onProgress: (evt) => {
      const s = store.getState()
      if (evt.jobId !== s.searchJobId) return
      s._searchProgress(evt.scannedFiles, evt.matchedFiles, evt.currentPath)
    },
    onMatch: (evt) => {
      const s = store.getState()
      if (evt.jobId !== s.searchJobId) return
      s._searchAppend({ file: evt.file, lines: evt.lines })
    },
    onDone: (evt) => {
      const s = store.getState()
      if (evt.jobId !== s.searchJobId) return
      s._searchDone(evt.totalMatches, evt.truncated)
    }
  })
}

/** 구독 해제(테스트·HMR). */
export function disposeContentSearchBridge(): void {
  if (disposer) {
    disposer()
    disposer = null
  }
  if (navWatcher) {
    navWatcher()
    navWatcher = null
  }
}
