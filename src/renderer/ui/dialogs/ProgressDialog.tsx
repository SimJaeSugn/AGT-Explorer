/**
 * ProgressDialog — 진행률 바·ETA·취소 (US-5.2, roadmap P4).
 *
 * operationsSlice.activeOperations() 를 구독해 진행 중 작업을 표시한다.
 * 진행률은 Main 이 200ms 이내 간격으로 op:progress 를 푸시하고
 * operationsBridge → operationsSlice 가 반영 → 여기서 그대로 렌더한다.
 * (200ms 갱신 보장은 Main 푸시 주기 + 슬라이스 반영으로 달성. 본 컴포넌트는 표현만.)
 *
 * 동시 다중 op 는 목록으로 묶어 표시(features E4). 각 op 에 취소 버튼.
 * done/partial-failed 작업은 요약 + 닫기 버튼으로 전환된다.
 */
import { useMemo } from 'react'
import { useRootStore } from '@renderer/app/stores/rootStore'
import type { Operation } from '@renderer/app/stores/operationsSlice'
import { cancelOperation } from '@renderer/app/usecases/fileOps'
import { tokens } from '@renderer/ui/theme/tokens'
import { btn, overlayStyle, panelStyle, titleStyle } from './dialogStyles'

const KIND_LABEL: Record<Operation['kind'], string> = {
  copy: '복사',
  move: '이동',
  delete: '영구 삭제',
  trash: '휴지통으로 삭제'
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function formatEta(op: Operation): string {
  const { processedBytes, totalBytes, bytesPerSec } = op.progress
  if (bytesPerSec <= 0 || totalBytes <= 0) return ''
  const remain = Math.max(0, totalBytes - processedBytes)
  const sec = Math.ceil(remain / bytesPerSec)
  if (sec < 60) return `약 ${sec}초 남음`
  const min = Math.ceil(sec / 60)
  return `약 ${min}분 남음`
}

export function ProgressDialog(): JSX.Element | null {
  // operationOrder/operations 변화에 반응하도록 두 참조를 구독.
  const operations = useRootStore((s) => s.operations)
  const order = useRootStore((s) => s.operationOrder)
  const dismiss = useRootStore((s) => s.dismissOperation)

  const list = useMemo(
    () => order.map((id) => operations[id]).filter((o): o is Operation => !!o),
    [order, operations]
  )

  if (list.length === 0) return null

  return (
    <div style={overlayStyle} role="dialog" aria-modal="true" aria-label="파일 작업 진행률">
      <div style={{ ...panelStyle, minWidth: 460 }}>
        <div style={titleStyle}>파일 작업 {list.length > 1 ? `(${list.length}건)` : ''}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {list.map((op) => (
            <OperationRow key={op.operationId} op={op} onDismiss={dismiss} />
          ))}
        </div>
      </div>
    </div>
  )
}

function OperationRow({
  op,
  onDismiss
}: {
  op: Operation
  onDismiss: (id: string) => void
}): JSX.Element {
  const done = op.status === 'done' || op.status === 'partial-failed'
  const { processedBytes, totalBytes, processedItems, totalItems, currentName } = op.progress
  const pct =
    totalBytes > 0
      ? Math.min(100, Math.round((processedBytes / totalBytes) * 100))
      : totalItems > 0
        ? Math.min(100, Math.round((processedItems / totalItems) * 100))
        : 0

  return (
    <div
      data-testid={`op-${op.operationId}`}
      style={{
        border: `1px solid ${tokens.color.border}`,
        borderRadius: 8,
        padding: 12
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <strong>{KIND_LABEL[op.kind]}</strong>
        <span style={{ color: tokens.color.textMuted }}>
          {op.status === 'cancelling' ? '취소 중…' : op.status === 'conflict' ? '충돌 대기' : `${pct}%`}
        </span>
      </div>

      {!done && (
        <>
          <div
            style={{
              height: 8,
              borderRadius: 4,
              background: tokens.color.bgAlt,
              overflow: 'hidden'
            }}
          >
            <div
              data-testid={`op-bar-${op.operationId}`}
              style={{
                width: `${pct}%`,
                height: '100%',
                background: tokens.color.accent,
                transition: 'width 120ms linear'
              }}
            />
          </div>
          <div
            style={{
              marginTop: 6,
              fontSize: 12,
              color: tokens.color.textMuted,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          >
            {currentName || '준비 중…'}
          </div>
          <div style={{ marginTop: 2, fontSize: 12, color: tokens.color.textMuted }}>
            {processedItems}/{totalItems || '?'} 항목 · {formatBytes(processedBytes)}
            {totalBytes > 0 ? ` / ${formatBytes(totalBytes)}` : ''}
            {formatEta(op) ? ` · ${formatEta(op)}` : ''}
          </div>
        </>
      )}

      {done && op.summary && (
        <div style={{ fontSize: 12, color: tokens.color.textMuted }}>
          성공 {op.summary.succeededItems}개
          {op.summary.failedItems > 0 ? `, 실패 ${op.summary.failedItems}개` : ''}
          {op.summary.canceled ? ' (취소됨)' : ''}
          {op.summary.failures.length > 0 && (
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {op.summary.failures.slice(0, 5).map((f) => (
                <li key={f.path} style={{ color: tokens.color.danger }}>
                  {f.path}: {f.message}
                </li>
              ))}
              {op.summary.failures.length > 5 && (
                <li>외 {op.summary.failures.length - 5}건…</li>
              )}
            </ul>
          )}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
        {done ? (
          <button style={btn('primary')} onClick={() => onDismiss(op.operationId)}>
            닫기
          </button>
        ) : (
          <button
            style={btn('default')}
            disabled={op.status === 'cancelling'}
            onClick={() => void cancelOperation(op.operationId)}
          >
            {op.status === 'cancelling' ? '취소 중…' : '취소'}
          </button>
        )}
      </div>
    </div>
  )
}
