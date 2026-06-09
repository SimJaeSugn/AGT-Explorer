/**
 * QueuePanel — 전송 큐 매니저 패널 (§R3·US-17.3·F24).
 *
 * 모달 패턴(TrashDialog 동형: overlay 클릭 닫기·role=dialog·aria-modal·Esc·useFocusTrap).
 * operationsSlice.queueItems(queueBridge 가 queue:state 푸시로 미러)를 FIFO 순으로 그리고,
 * 항목별 제어(QueueItemRow)·전체 일시정지/재개·동시성 설정(QueueConcurrencyControl)을 제공.
 * 비차단: 패널을 연 채로 탐색·다른 작업 가능(파일 작업은 큐로 자연 흡수).
 *
 * 셀렉터 격리: 이 컴포넌트만 queueItems/maxConcurrent 를 구독한다. IPC 는 usecases/queue 경유.
 */
import { useEffect, useRef } from 'react'
import { useRootStore } from '@renderer/app/stores/rootStore'
import { pauseAll, resumeAll } from '@renderer/app/usecases/queue'
import { useFocusTrap } from '@renderer/ui/keyboard/useFocusTrap'
import { QueueItemRow } from '@renderer/ui/queue/QueueItemRow'
import { QueueConcurrencyControl } from '@renderer/ui/queue/QueueConcurrencyControl'
import { btn, overlayStyle, panelStyle, titleStyle } from '@renderer/ui/dialogs/dialogStyles'
import { tokens } from '@renderer/ui/theme/tokens'

export function QueuePanel(): JSX.Element | null {
  const open = useRootStore((s) => s.queuePanelOpen)
  const items = useRootStore((s) => s.queueItems)

  const panelRef = useRef<HTMLDivElement | null>(null)
  const closeBtnRef = useRef<HTMLButtonElement | null>(null)

  useFocusTrap(open, panelRef, { initialFocus: closeBtnRef })

  useEffect(() => {
    if (!open) return undefined
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        useRootStore.getState().closeQueuePanel()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open])

  if (!open) return null

  function close(): void {
    useRootStore.getState().closeQueuePanel()
  }

  // FIFO(큐 진입 순) 정렬 — Main 스냅샷이 이미 FIFO 지만 안전하게 enqueuedAt 보장.
  const sorted = [...items].sort((a, b) => a.enqueuedAt - b.enqueuedAt)
  const activeCount = items.filter(
    (it) => it.status === 'running' || it.status === 'pending' || it.status === 'paused'
  ).length
  const runningCount = items.filter((it) => it.status === 'running').length
  const pausedCount = items.filter((it) => it.status === 'paused').length

  return (
    <div style={overlayStyle} onClick={close} role="dialog" aria-modal="true" aria-label="전송 큐">
      <div
        ref={panelRef}
        style={{
          ...panelStyle,
          width: 680,
          maxWidth: '94vw',
          maxHeight: '86vh',
          display: 'flex',
          flexDirection: 'column'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <h2 style={{ ...titleStyle, margin: 0 }}>⇅ 전송 큐</h2>
          <button
            ref={closeBtnRef}
            onClick={close}
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

        {/* 요약 + 전체 제어 + 동시성 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: tokens.color.textMuted }}>
            진행/대기 {activeCount}건
            {runningCount > 0 ? ` · 진행 중 ${runningCount}` : ''}
            {pausedCount > 0 ? ` · 일시정지 ${pausedCount}` : ''}
          </span>
          <span style={{ marginLeft: 'auto' }} />
          <QueueConcurrencyControl />
          <button
            style={btn('default')}
            disabled={runningCount === 0}
            onClick={() => void pauseAll()}
          >
            전체 일시정지
          </button>
          <button
            style={btn('default')}
            disabled={pausedCount === 0}
            onClick={() => void resumeAll()}
          >
            전체 재개
          </button>
        </div>

        {/* 목록 */}
        {items.length === 0 ? (
          <div style={{ color: tokens.color.textMuted, fontSize: 13, padding: '24px 0' }}>
            진행 중이거나 대기 중인 작업이 없습니다.
          </div>
        ) : (
          <div
            style={{
              overflowY: 'auto',
              flex: 1,
              border: `1px solid ${tokens.color.border}`,
              borderRadius: 6
            }}
          >
            {sorted.map((it) => (
              <QueueItemRow key={it.operationId} item={it} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
