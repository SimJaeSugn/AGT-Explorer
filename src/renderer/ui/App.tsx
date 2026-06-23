/**
 * App — 루트 UI 셸 (SA §4 컴포넌트 트리).
 *
 * 구성: TabBar / [Sidebar | LayoutHost] / StatusBar + 전역 오버레이.
 * 부팅 시 기본 탭("내 PC")을 초기화하고 KeyboardDispatcher 를 마운트한다.
 *
 * P5(테마)·P4(다이얼로그) 영역은 자리만 두고 점진 확장한다.
 */
import { useEffect, useRef } from 'react'
import { useRootStore } from '@renderer/app/stores/rootStore'
import { initOperationsBridge } from '@renderer/app/usecases/operationsBridge'
import { initQueueBridge } from '@renderer/app/usecases/queueBridge'
import { initDedupBridge } from '@renderer/app/usecases/dedup'
import { initChecksumBridge } from '@renderer/app/usecases/checksum'
import { initCompareBridge } from '@renderer/app/usecases/compare'
import { initScanBridge } from '@renderer/app/usecases/dashboard'
import { initWatchBridge } from '@renderer/app/usecases/watchBridge'
import { initRemoteBridge } from '@renderer/app/usecases/remote'
import { initOpenPathBridge } from '@renderer/app/usecases/launchOpen'
import { initContentSearchBridge } from '@renderer/app/usecases/contentSearch'
import { initAgentBridge } from '@renderer/app/usecases/agent'
import { loadSettings } from '@renderer/app/usecases/settings'
import { bootWindow } from '@renderer/app/usecases/windowInit'
import { TabBar } from '@renderer/ui/tabbar/TabBar'
import { IconBar } from '@renderer/ui/toolbar/IconBar'
import { Sidebar } from '@renderer/ui/sidebar/Sidebar'
import { LayoutHost } from '@renderer/ui/layout/LayoutHost'
import { CompactExplorer } from '@renderer/ui/layout/CompactExplorer'
import { PreviewPanel } from '@renderer/ui/preview/PreviewPanel'
import { StatusBar } from '@renderer/ui/statusbar/StatusBar'
import { KeyboardDispatcher } from '@renderer/ui/keyboard/KeyboardDispatcher'
import { ShortcutHelp } from '@renderer/ui/keyboard/ShortcutHelp'
import { SettingsDialog } from '@renderer/ui/settings/SettingsDialog'
import { DashboardModal } from '@renderer/ui/dashboard/DashboardModal'
import { TrashDialog } from '@renderer/ui/trash/TrashDialog'
import { RemoteDialog } from '@renderer/ui/remote/RemoteDialog'
import { HostKeyModal } from '@renderer/ui/remote/HostKeyModal'
import { BatchRenameDialog } from '@renderer/ui/rename/BatchRenameDialog'
import { CompareMirrorDialog } from '@renderer/ui/compare/CompareMirrorDialog'
import { DuplicatesDialog } from '@renderer/ui/dedup/DuplicatesDialog'
import { QueuePanel } from '@renderer/ui/queue/QueuePanel'
import { ContentSearchDialog } from '@renderer/ui/search/ContentSearchDialog'
import { CommandPalette } from '@renderer/ui/palette/CommandPalette'
import { AgentPanel } from '@renderer/ui/agent/AgentPanel'
import { QuickLookOverlay } from '@renderer/ui/quicklook/QuickLookOverlay'
import { Toasts } from '@renderer/ui/dialogs/Toasts'
import { ProgressDialog } from '@renderer/ui/dialogs/ProgressDialog'
import { ConflictDialog } from '@renderer/ui/dialogs/ConflictDialog'
import { ConfirmDialog } from '@renderer/ui/dialogs/ConfirmDialog'
import { AutoLinkDialog } from '@renderer/ui/dialogs/AutoLinkDialog'
import { BatchAutoLinkDialog } from '@renderer/ui/dialogs/BatchAutoLinkDialog'
import { NewTabPickerDialog } from '@renderer/ui/tabbar/NewTabPickerDialog'
import { ContextMenu } from '@renderer/ui/contextmenu/ContextMenu'
import { useDragController } from '@renderer/ui/dnd/useDrag'
import { tokens } from '@renderer/ui/theme/tokens'

export function App(): JSX.Element {
  const toggleShortcutHelp = useRootStore((s) => s.toggleShortcutHelp)
  // U3: 이 창의 렌더 모드(compact=탐색기 전용 경량 창). 부팅 시 window:get-init 로 설정.
  const windowMode = useRootStore((s) => s.windowMode)
  const bootedRef = useRef(false)
  // J7: 미리보기 폭 SplitDivider 의 비율→px 환산 기준(본문 row 컨테이너).
  const bodyRef = useRef<HTMLDivElement | null>(null)

  // 드래그 중 수정키 실시간 추적 + Esc 취소.
  useDragController()

  // op:* / analyze:scan:* 이벤트 → 슬라이스 브리지(진행률/충돌/완료).
  useEffect(() => {
    initOperationsBridge()
    // M7 W2: queue:state 푸시 → operationsSlice 큐 미러(전역 1회 구독 + queue:list 초기 로드).
    initQueueBridge()
    // M7 R2: hash:dup:* 푸시 → dedupSlice 미러(전역 1회 구독·jobId 상관).
    initDedupBridge()
    // M7 R4: hash:verify:* 푸시 → 복사 후 체크섬 검증 결과 토스트(전역 1회 구독·jobId 상관).
    initChecksumBridge()
    // M7 §P1: hash:compare:* 푸시 → compareSlice 미러(해시/재귀 비교·전역 1회 구독·jobId 상관).
    initCompareBridge()
    initScanBridge()
    // J2: 좌/우 패널 현재 디렉토리 실시간 감시 브리지(전역 1회 구독).
    initWatchBridge()
    // §M M3: remote:host-key·remote:session-error 푸시 → remoteSlice 브리지(전역 1회 구독).
    initRemoteBridge()
    // V2: app:open-path 푸시 → 탐색기 "AGT-Finder로 열기" 경로를 새 탭으로(전역 1회 구독).
    initOpenPathBridge()
    // M8 S1: search:content:* 푸시 → searchSlice 미러(내용 검색 grep·전역 1회 구독·jobId 상관).
    initContentSearchBridge()
    // §Z Z1: agent:event 푸시 → agentSlice 미러(자연어 에이전트·전역 1회 구독·runId 상관).
    initAgentBridge()
  }, [])

  // 부팅 순서: 설정 로드(테마 적용) → 창 초기화(U3 — primary 면 세션 복원+자동저장,
  // split 이면 넘겨받은 탭으로 부팅·자동저장 미참여) → 시작 시 대시보드 자동 팝업
  // (설정 showDashboardOnStartup, I장 §4.4). StrictMode 이중 마운트 방지를 위해 1회 가드.
  useEffect(() => {
    if (bootedRef.current) return
    bootedRef.current = true
    let stopAutosave: (() => void) | null = null
    void (async () => {
      await loadSettings()
      // U3: window:get-init 으로 primary/split 분기(분리 payload 없으면 기존 부트와 동일).
      stopAutosave = await bootWindow()
      // 설정 로드(applySettings)로 showDashboardOnStartup 가 반영된 뒤 분기.
      const s = useRootStore.getState()
      if (s.showDashboardOnStartup) s.openDashboard()
      // 초기화 완료 통지 — 홍보영상 스플래시 닫기 버튼을 활성화한다(켜진 경우에만 main 이 반응).
      window.api?.app?.signalReady?.()
    })()
    return () => {
      if (stopAutosave) stopAutosave()
    }
  }, [])

  // F1 = 단축키 도움말(레지스트리 읽기 API 확인용, P3).
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'F1') {
        e.preventDefault()
        toggleShortcutHelp()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleShortcutHelp])

  // U3: 탐색기 전용 경량 창 — 풀 셸 대신 단일 파일 목록만 그린다. 위의 모든 브리지/부팅
  // effect 는 모드와 무관하게 실행되므로(훅은 분기 전에 전부 호출됨) 파일 작업·푸시는 정상.
  if (windowMode === 'compact') return <CompactExplorer />

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        fontFamily: tokens.font,
        color: tokens.color.text,
        background: tokens.color.bg,
        overflow: 'hidden'
      }}
    >
      <KeyboardDispatcher />
      <TabBar />
      <IconBar />
      <div ref={bodyRef} style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <Sidebar containerRef={bodyRef} />
        <LayoutHost />
        <PreviewPanel containerRef={bodyRef} />
      </div>
      <StatusBar />
      <ShortcutHelp />
      <SettingsDialog />
      <DashboardModal />
      <TrashDialog />
      <RemoteDialog />
      <HostKeyModal />
      <BatchRenameDialog />
      <CompareMirrorDialog />
      <DuplicatesDialog />
      <QueuePanel />
      {/* M8 S1: 내용 검색(grep) 모달 */}
      <ContentSearchDialog />
      {/* S2 명령 팔레트 · U1 Space 퀵룩(M8 Should) */}
      <CommandPalette />
      {/* §Z Z1 AI 에이전트(읽기 전용) 우측 도킹 패널 */}
      <AgentPanel />
      <QuickLookOverlay />
      <Toasts />
      {/* P4 오버레이: 진행률 · 충돌 · 영구삭제 확인 · D&D 의도 툴팁 */}
      <ProgressDialog />
      <ConflictDialog />
      <ConfirmDialog />
      <AutoLinkDialog />
      <BatchAutoLinkDialog />
      <NewTabPickerDialog />
      <ContextMenu />
    </div>
  )
}
