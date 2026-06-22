/**
 * StatusBar — 항목 수·선택 개수/용량·활성 경로·필터 결과·진행 op 인디케이터 (US-5.7).
 *
 * 활성 패널만 구독해 표시. 선택 개수·합계 용량은 selectionSlice 에서 파생.
 * 필터 활성 시 "결과 N/M" 를, 진행 중 작업이 있으면 인디케이터를 표시한다
 * (operationsSlice.activeOperations).
 *
 * US-5.8 확장: 현재 선택 워크스페이스가 있으면 우측에 이름 + 변경/저장 상태
 * (변경됨/저장 중/저장됨 시각/저장 실패) 칩을 표시한다. 상태는 session 유스케이스의
 * 자동 저장 pub/sub(useSyncExternalStore — zustand 자동저장 루프 회피)에서 읽는다.
 * 칩 클릭 = 워크스페이스 다이얼로그 열기.
 */
import { useSyncExternalStore } from 'react'
import { useRootStore } from '@renderer/app/stores/rootStore'
import { computeVisible, filterInfo } from '@renderer/app/usecases/selectors'
import {
  getWorkspaceSaveStatus,
  subscribeWorkspaceSaveStatus,
  type WorkspaceSaveStatus
} from '@renderer/app/usecases/session'
import { MY_PC_LABEL } from '@renderer/domain/paths'
import { tokens } from '@renderer/ui/theme/tokens'

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`
}

/** 자동 저장 상태 → 표시 라벨·색(US-5.8 확장). idle=불러온 직후 동기화 상태. */
function saveStateView(st: WorkspaceSaveStatus): { label: string; color: string } {
  switch (st.state) {
    case 'dirty':
      return { label: '변경됨', color: tokens.color.accent }
    case 'saving':
      return { label: '저장 중…', color: tokens.color.accent }
    case 'error':
      return { label: '저장 실패', color: tokens.color.danger }
    case 'saved':
      return {
        label: st.savedAt ? `저장됨 ${new Date(st.savedAt).toLocaleTimeString()}` : '저장됨',
        color: tokens.color.textMuted
      }
    default:
      // idle: 불러오기 직후 등 파일과 동기화된 상태(저장 이력 없음).
      return { label: '저장됨', color: tokens.color.textMuted }
  }
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

/** 항목 사이 작은 점 구분자(목업 상태바 톤). */
function Dot(): JSX.Element {
  return (
    <span
      aria-hidden
      style={{
        flex: 'none',
        width: 3,
        height: 3,
        borderRadius: '50%',
        background: tokens.color.borderStrong
      }}
    />
  )
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

  // §R3: 전송 큐 합산 인디케이터(진행/대기/일시정지 = 활성). 클릭 시 큐 패널 토글.
  const queueActiveCount = useRootStore(
    (s) =>
      s.queueItems.filter(
        (it) => it.status === 'pending' || it.status === 'running' || it.status === 'paused'
      ).length
  )
  const openQueuePanel = useRootStore((s) => s.openQueuePanel)

  // US-5.8 확장: 현재 선택 워크스페이스 + 자동 저장 상태(변경/저장). 미선택이면 칩 숨김.
  const currentWorkspace = useRootStore((s) => s.currentWorkspace)
  // 워크스페이스 관리는 설정 화면의 워크스페이스 페이지로 연동(독립 팝업 폐지).
  const openSettings = useRootStore((s) => s.openSettings)
  const wsStatus = useSyncExternalStore(subscribeWorkspaceSaveStatus, getWorkspaceSaveStatus)
  const wsView = saveStateView(wsStatus)

  return (
    <div
      style={{
        height: 28,
        display: 'flex',
        alignItems: 'center',
        gap: 11,
        padding: '0 14px',
        borderTop: `1px solid ${tokens.color.border}`,
        background: tokens.color.chrome,
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
            <span style={{ color: tokens.color.text }}>
              필터 결과 {info.filterMatched}/{info.filterTotal}개
            </span>
          ) : (
            <span style={{ color: tokens.color.text }}>
              {info.total}개 항목{info.streaming ? ' (로딩 중)' : ''}
            </span>
          )}
          {info.selCount > 0 && <Dot />}
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
          {queueActiveCount > 0 && (
            <button
              type="button"
              onClick={() => openQueuePanel()}
              title="전송 큐 열기"
              style={{
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                color: tokens.color.accent,
                fontSize: 12,
                padding: 0,
                font: 'inherit'
              }}
            >
              ⇅ {queueActiveCount}개 작업 진행 중
            </button>
          )}
          <span
            style={{
              marginLeft: 'auto',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
              fontSize: 11.5,
              color: tokens.color.textMuted
            }}
          >
            {info.path}
          </span>
        </>
      ) : (
        <span>준비됨</span>
      )}
      {currentWorkspace && <Dot />}
      {currentWorkspace && (
        <button
          type="button"
          onClick={() => openSettings('workspace')}
          title={`워크스페이스 "${currentWorkspace}" — ${wsView.label} (클릭: 워크스페이스 관리)`}
          style={{
            marginLeft: info ? 0 : 'auto',
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            fontSize: 12,
            padding: 0,
            font: 'inherit',
            color: tokens.color.textMuted,
            whiteSpace: 'nowrap',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4
          }}
        >
          <span
            aria-hidden
            style={{
              flex: 'none',
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: wsView.color
            }}
          />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160 }}>
            {currentWorkspace}
          </span>
          <span style={{ color: wsView.color }}>· {wsView.label}</span>
        </button>
      )}
    </div>
  )
}
