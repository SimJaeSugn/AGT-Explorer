/**
 * StatusBar — 항목 수·선택 개수/용량·활성 경로·필터 결과·진행 op 인디케이터 (US-5.7).
 *
 * 활성 패널만 구독해 표시. 선택 개수·합계 용량은 selectionSlice 에서 파생.
 * 필터 활성 시 "결과 N/M" 를, 진행 중 작업이 있으면 인디케이터를 표시한다
 * (operationsSlice.activeOperations).
 */
import { useRootStore } from '@renderer/app/stores/rootStore'
import { computeVisible, filterInfo } from '@renderer/app/usecases/selectors'
import { MY_PC_LABEL } from '@renderer/domain/paths'
import { tokens } from '@renderer/ui/theme/tokens'

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`
}

/** op kind → 한글 라벨. */
function opLabel(kind: string): string {
  switch (kind) {
    case 'copy':
      return '복사'
    case 'move':
      return '이동'
    case 'delete':
      return '삭제'
    case 'trash':
      return '휴지통 이동'
    default:
      return '작업'
  }
}

export function StatusBar(): JSX.Element {
  const info = useRootStore((s) => {
    const tab = s.tabs[s.activeTabId]
    const pid = tab?.activePanelId
    const panel = pid ? s.panels[pid] : undefined
    if (!panel || !pid) return null
    const visible = computeVisible(panel)
    const fInfo = filterInfo(panel)
    const sel = s.selection[pid]
    const selPaths = sel?.selectedPaths
    let selSize = 0
    let selCount = 0
    if (selPaths && selPaths.size > 0) {
      const byPath = new Map(visible.map((e) => [e.path, e]))
      for (const p of selPaths) {
        const e = byPath.get(p)
        if (e) {
          selCount += 1
          selSize += e.size
        }
      }
    }
    return {
      path: panel.path === '' ? MY_PC_LABEL : panel.path,
      total: visible.length,
      streaming: panel.directory.status === 'streaming',
      filterActive: fInfo.active,
      filterMatched: fInfo.matched,
      filterTotal: fInfo.total,
      selCount,
      selSize
    }
  })

  // 진행 중 작업 인디케이터(완료 아님). 평탄 셀렉터로 첫 작업만 표시.
  const op = useRootStore((s) => {
    const order = s.operationOrder
    for (const id of order) {
      const o = s.operations[id]
      if (o && o.status !== 'done' && o.status !== 'partial-failed') return o
    }
    return null
  })
  const activeOpCount = useRootStore(
    (s) =>
      s.operationOrder.filter((id) => {
        const o = s.operations[id]
        return o && o.status !== 'done' && o.status !== 'partial-failed'
      }).length
  )

  return (
    <div
      style={{
        height: 24,
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '0 10px',
        borderTop: `1px solid ${tokens.color.border}`,
        background: tokens.color.bgAlt,
        fontSize: 12,
        color: tokens.color.textMuted,
        whiteSpace: 'nowrap',
        overflow: 'hidden'
      }}
      role="status"
      aria-live="polite"
    >
      {info ? (
        <>
          {info.filterActive ? (
            <span>
              필터 결과 {info.filterMatched}/{info.filterTotal}개
            </span>
          ) : (
            <span>
              {info.total}개 항목{info.streaming ? ' (로딩 중)' : ''}
            </span>
          )}
          {info.selCount > 0 && (
            <span>
              {info.selCount}개 선택{info.selSize > 0 ? ` · ${formatBytes(info.selSize)}` : ''}
            </span>
          )}
          {op && (
            <span style={{ color: tokens.color.accent }}>
              ⟳ {opLabel(op.kind)} 중
              {op.progress.totalItems > 0
                ? ` ${op.progress.processedItems}/${op.progress.totalItems}`
                : ''}
              {activeOpCount > 1 ? ` (+${activeOpCount - 1})` : ''}
            </span>
          )}
          <span style={{ marginLeft: 'auto', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {info.path}
          </span>
        </>
      ) : (
        <span>준비됨</span>
      )}
    </div>
  )
}
