/**
 * CompactExplorer — "탐색기 전용" 경량 창 셸 (U3 — 탭을 창 밖으로 드롭해 분리).
 *
 * 기존 풀 셸(App)과 달리 탭바·아이콘바(앱 상단 명령바)·사이드바·미리보기·상태바가
 * 전혀 없고, 단일 탭의 활성 패널 하나만 창 전체에 그린다. 단, 패널 "자체" 헤더
 * (뒤로/앞으로/위로 아이콘·주소(경로)·보기 아이콘 = PanelToolbar)와 검색바는 그대로
 * 유지한다 — Panel 컴포넌트를 통째로 렌더하므로 탐색기 내부 헤더·경로 기능이 살아 있다.
 *
 * 파일 작업(복사/이동/삭제)에 필요한 최소 오버레이(컨텍스트 메뉴·진행률·충돌·확인·
 * 토스트·퀵룩)와 KeyboardDispatcher 를 마운트한다.
 *
 * 이 창은 분리 창이므로 세션 자동저장에 참여하지 않는다(windowManager — reopen-only).
 */
import { useRootStore } from '@renderer/app/stores/rootStore'
import { Panel } from '@renderer/ui/panel/Panel'
import { KeyboardDispatcher } from '@renderer/ui/keyboard/KeyboardDispatcher'
import { ContextMenu } from '@renderer/ui/contextmenu/ContextMenu'
import { QuickLookOverlay } from '@renderer/ui/quicklook/QuickLookOverlay'
import { Toasts } from '@renderer/ui/dialogs/Toasts'
import { ProgressDialog } from '@renderer/ui/dialogs/ProgressDialog'
import { ConflictDialog } from '@renderer/ui/dialogs/ConflictDialog'
import { ConfirmDialog } from '@renderer/ui/dialogs/ConfirmDialog'
import { tokens } from '@renderer/ui/theme/tokens'

export function CompactExplorer(): JSX.Element {
  // 단일 탭·단일(활성) 패널만 그린다. 분리 부팅(windowInit)은 탭 1개로 부팅하므로
  // activeTabId 의 activePanelId 가 곧 이 창의 유일한 패널이다.
  const tabId = useRootStore((s) => s.activeTabId)
  const panelId = useRootStore((s) => s.tabs[s.activeTabId]?.activePanelId)

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
      {panelId ? (
        // Panel 통째로 렌더 → 패널 헤더(PanelToolbar: 뒤로/앞으로/위로·주소·보기)·검색바·
        // 파일목록·워터마크가 그대로 유지된다. 단일 패널이므로 번호 배지는 숨김(totalPanels=1).
        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          <Panel panelId={panelId} tabId={tabId} active panelNumber={1} totalPanels={1} />
        </div>
      ) : (
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: tokens.color.textMuted
          }}
        >
          탐색기
        </div>
      )}
      {/* 파일 작업·우클릭에 필요한 최소 오버레이만 마운트. */}
      <Toasts />
      <ProgressDialog />
      <ConflictDialog />
      <ConfirmDialog />
      <QuickLookOverlay />
      <ContextMenu />
    </div>
  )
}
