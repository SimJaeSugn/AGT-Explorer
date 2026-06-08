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
import { initScanBridge } from '@renderer/app/usecases/dashboard'
import { initWatchBridge } from '@renderer/app/usecases/watchBridge'
import { initRemoteBridge } from '@renderer/app/usecases/remote'
import { loadSettings } from '@renderer/app/usecases/settings'
import { restoreSession, startSessionAutosave } from '@renderer/app/usecases/session'
import { TabBar } from '@renderer/ui/tabbar/TabBar'
import { IconBar } from '@renderer/ui/toolbar/IconBar'
import { Sidebar } from '@renderer/ui/sidebar/Sidebar'
import { LayoutHost } from '@renderer/ui/layout/LayoutHost'
import { PreviewPanel } from '@renderer/ui/preview/PreviewPanel'
import { StatusBar } from '@renderer/ui/statusbar/StatusBar'
import { KeyboardDispatcher } from '@renderer/ui/keyboard/KeyboardDispatcher'
import { ShortcutHelp } from '@renderer/ui/keyboard/ShortcutHelp'
import { SettingsDialog } from '@renderer/ui/settings/SettingsDialog'
import { WorkspaceDialog } from '@renderer/ui/workspace/WorkspaceDialog'
import { DashboardModal } from '@renderer/ui/dashboard/DashboardModal'
import { TrashDialog } from '@renderer/ui/trash/TrashDialog'
import { RemoteDialog } from '@renderer/ui/remote/RemoteDialog'
import { HostKeyModal } from '@renderer/ui/remote/HostKeyModal'
import { Toasts } from '@renderer/ui/dialogs/Toasts'
import { ProgressDialog } from '@renderer/ui/dialogs/ProgressDialog'
import { ConflictDialog } from '@renderer/ui/dialogs/ConflictDialog'
import { ConfirmDialog } from '@renderer/ui/dialogs/ConfirmDialog'
import { ContextMenu } from '@renderer/ui/contextmenu/ContextMenu'
import { DragOverlay } from '@renderer/ui/dnd/DragOverlay'
import { useDragController } from '@renderer/ui/dnd/useDrag'
import { tokens } from '@renderer/ui/theme/tokens'

export function App(): JSX.Element {
  const toggleShortcutHelp = useRootStore((s) => s.toggleShortcutHelp)
  const bootedRef = useRef(false)
  // J7: 미리보기 폭 SplitDivider 의 비율→px 환산 기준(본문 row 컨테이너).
  const bodyRef = useRef<HTMLDivElement | null>(null)

  // 드래그 중 수정키 실시간 추적 + Esc 취소.
  useDragController()

  // op:* / analyze:scan:* 이벤트 → 슬라이스 브리지(진행률/충돌/완료).
  useEffect(() => {
    initOperationsBridge()
    initScanBridge()
    // J2: 좌/우 패널 현재 디렉토리 실시간 감시 브리지(전역 1회 구독).
    initWatchBridge()
    // §M M3: remote:host-key·remote:session-error 푸시 → remoteSlice 브리지(전역 1회 구독).
    initRemoteBridge()
  }, [])

  // 부팅 순서: 설정 로드(테마 적용) → 세션 복원(탭/사이드바) → 자동저장 구독
  // → 시작 시 대시보드 자동 팝업(설정 showDashboardOnStartup, I장 §4.4).
  // StrictMode 의 이중 마운트 방지를 위해 1회 가드.
  useEffect(() => {
    if (bootedRef.current) return
    bootedRef.current = true
    let stopAutosave: (() => void) | null = null
    void (async () => {
      await loadSettings()
      await restoreSession()
      stopAutosave = startSessionAutosave()
      // 설정 로드(applySettings)로 showDashboardOnStartup 가 반영된 뒤 분기.
      const s = useRootStore.getState()
      if (s.showDashboardOnStartup) s.openDashboard()
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
        <Sidebar />
        <LayoutHost />
        <PreviewPanel containerRef={bodyRef} />
      </div>
      <StatusBar />
      <ShortcutHelp />
      <SettingsDialog />
      <WorkspaceDialog />
      <DashboardModal />
      <TrashDialog />
      <RemoteDialog />
      <HostKeyModal />
      <Toasts />
      {/* P4 오버레이: 진행률 · 충돌 · 영구삭제 확인 · D&D 의도 툴팁 */}
      <ProgressDialog />
      <ConflictDialog />
      <ConfirmDialog />
      <ContextMenu />
      <DragOverlay />
    </div>
  )
}
