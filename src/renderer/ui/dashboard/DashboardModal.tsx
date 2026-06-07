/**
 * DashboardModal — 사용량 대시보드 모달 셸 (I장 §4.3).
 *
 * 본문(DashboardModalBody, recharts 포함)을 React.lazy 동적 import + Suspense 로
 * 분리한다 → 메인 청크 미오염(모달 미오픈 시 미로드). 모달 패턴은 SettingsDialog 와
 * 동일(오버레이 클릭 닫기·stopPropagation·aria-modal·Esc).
 *
 * 닫힐 때 진행 중 스캔이 있으면 협조취소(누수 방지). inputContext='dialog' 전환은
 * uiSlice.openDashboard/closeDashboard 가 담당.
 */
import { lazy, Suspense, useEffect } from 'react'
import { useRootStore } from '@renderer/app/stores/rootStore'
import { cancelScan } from '@renderer/app/usecases/dashboard'
import { overlayStyle, panelStyle, titleStyle } from '@renderer/ui/dialogs/dialogStyles'
import { tokens } from '@renderer/ui/theme/tokens'

const DashboardModalBody = lazy(() => import('./DashboardModalBody'))

/** 진행 중 스캔이 있으면 취소(누수 방지) 후 모달 닫기. 최신 상태는 getState 로 읽는다. */
function closeDashboardSafely(): void {
  const s = useRootStore.getState()
  if (s.scanStatus === 'scanning') void cancelScan()
  s.closeDashboard()
}

export function DashboardModal(): JSX.Element | null {
  const open = useRootStore((s) => s.dashboardOpen)

  // Esc 닫기(모달 패턴). 열려 있을 때만 바인딩. 핸들러는 getState 로 최신 상태 참조.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        closeDashboardSafely()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open])

  if (!open) return null

  return (
    <div
      style={overlayStyle}
      onClick={closeDashboardSafely}
      role="dialog"
      aria-modal="true"
      aria-label="용량 대시보드"
    >
      <div
        style={{
          ...panelStyle,
          width: 880,
          maxWidth: '94vw',
          maxHeight: '88vh',
          overflowY: 'auto'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <h2 style={{ ...titleStyle, margin: 0 }}>용량 대시보드</h2>
          <button
            onClick={closeDashboardSafely}
            aria-label="닫기"
            style={{
              marginLeft: 'auto',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              fontSize: 18,
              color: tokens.color.text
            }}
          >
            ✕
          </button>
        </div>

        <Suspense
          fallback={
            <div style={{ color: tokens.color.textMuted, fontSize: 13, padding: '24px 0' }}>
              대시보드를 불러오는 중…
            </div>
          }
        >
          <DashboardModalBody />
        </Suspense>
      </div>
    </div>
  )
}
