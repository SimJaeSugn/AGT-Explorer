/**
 * QueueItemRow — 전송 큐 항목 1행 (§R3·US-17.3·F24).
 *
 * 종류·대상·상태·진행률(바)·속도·ETA 와 항목별 제어 버튼(일시정지/재개·취소·재시도)을
 * 그린다. 제어는 usecases/queue·fileOps(cancelOperation) 경유(ui→infra 직접 금지).
 * 진행률 바는 진행 중·일시정지에만 표시. 종료(done/canceled) 항목은 흐림 처리.
 */
import type { QueueItemDTO } from '@shared/dto'
import { cancelOperation } from '@renderer/app/usecases/fileOps'
import { pauseQueueItem, resumeQueueItem, retryQueueItem } from '@renderer/app/usecases/queue'
import { formatBytes, formatCount } from '@renderer/ui/dashboard/format'
import {
  formatEta,
  formatSpeed,
  kindLabel,
  progressRatio,
  statusColorKey,
  statusLabel
} from '@renderer/ui/queue/queueFormat'
import { btn } from '@renderer/ui/dialogs/dialogStyles'
import { tokens } from '@renderer/ui/theme/tokens'

const smallBtn: React.CSSProperties = { height: 24, padding: '0 8px', fontSize: 12 }

export function QueueItemRow({ item }: { item: QueueItemDTO }): JSX.Element {
  const ratio = progressRatio(item.processedBytes, item.totalBytes)
  const ratioPct = Math.round(ratio * 100)
  const speed = formatSpeed(item.bytesPerSec)
  const eta = formatEta(item.etaSec)
  const isActive = item.status === 'running' || item.status === 'paused' || item.status === 'pending'
  const isTerminal = item.status === 'done' || item.status === 'canceled'
  const statusColor = tokens.color[statusColorKey(item.status)]

  return (
    <div
      style={{
        padding: '6px 8px',
        borderBottom: `1px solid ${tokens.color.border}`,
        opacity: isTerminal ? 0.55 : 1,
        fontSize: 12
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: 600 }}>{kindLabel(item.kind)}</span>
        <span style={{ color: statusColor, fontSize: 11 }}>{statusLabel(item.status)}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {item.status === 'running' && (
            <button style={btn('default')} onClick={() => void pauseQueueItem(item.operationId)}>
              <span style={smallBtn}>일시정지</span>
            </button>
          )}
          {item.status === 'paused' && (
            <button style={btn('default')} onClick={() => void resumeQueueItem(item.operationId)}>
              <span style={smallBtn}>재개</span>
            </button>
          )}
          {item.status === 'failed' && (
            <button style={btn('default')} onClick={() => void retryQueueItem(item.operationId)}>
              <span style={smallBtn}>재시도</span>
            </button>
          )}
          {isActive && (
            <button style={btn('default')} onClick={() => void cancelOperation(item.operationId)}>
              <span style={smallBtn}>취소</span>
            </button>
          )}
        </span>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 8,
          color: tokens.color.textMuted,
          marginTop: 2,
          overflow: 'hidden'
        }}
      >
        <span
          style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          title={`${item.sourcesSummary} → ${item.destSummary}`}
        >
          {item.sourcesSummary}
          {item.destSummary ? ` → ${item.destSummary}` : ''}
        </span>
      </div>

      {/* 진행률 바(진행 중·일시정지·대기). */}
      {isActive && (
        <div style={{ marginTop: 4 }}>
          <div
            style={{
              height: 6,
              borderRadius: 3,
              background: tokens.color.border,
              overflow: 'hidden'
            }}
            role="progressbar"
            aria-valuenow={ratioPct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              style={{
                width: `${ratioPct}%`,
                height: '100%',
                background: item.status === 'paused' ? tokens.color.textMuted : tokens.color.accent,
                transition: 'width 120ms linear'
              }}
            />
          </div>
          <div
            style={{
              display: 'flex',
              gap: 10,
              marginTop: 2,
              color: tokens.color.textMuted,
              fontVariantNumeric: 'tabular-nums'
            }}
          >
            <span>
              {formatBytes(item.processedBytes)}
              {item.totalBytes > 0 ? ` / ${formatBytes(item.totalBytes)}` : ''}
              {item.totalItems > 0
                ? ` · ${formatCount(item.processedItems)}/${formatCount(item.totalItems)}개`
                : ''}
            </span>
            {speed && <span>{speed}</span>}
            {eta && <span>{eta}</span>}
          </div>
        </div>
      )}
    </div>
  )
}
