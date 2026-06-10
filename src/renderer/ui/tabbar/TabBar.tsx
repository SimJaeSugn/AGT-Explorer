/**
 * TabBar — 탭 추가/닫기/전환/드래그 순서/복제 (US-1.1).
 *
 * roadmap P3: Ctrl+T/W/Tab/1~9·가운데클릭 닫기·드래그 순서·Ctrl+D 복제·
 * Ctrl+Shift+T 복원(키는 디스패처). 여기서는 마우스 UI 와 액션 호출.
 * 탭 라벨은 활성 패널 경로의 마지막 세그먼트.
 */
import { useState } from 'react'
import { useRootStore } from '@renderer/app/stores/rootStore'
import { baseName, MY_PC_LABEL } from '@renderer/domain/paths'
import { resolveDriveLabel } from '@renderer/app/selectors/driveLabel'
import { requestNewTab } from '@renderer/app/usecases/newTab'
import { tokens } from '@renderer/ui/theme/tokens'

export function TabBar(): JSX.Element {
  const tabOrder = useRootStore((s) => s.tabOrder)
  const activeTabId = useRootStore((s) => s.activeTabId)
  const openSettings = useRootStore((s) => s.openSettings)
  const [dragId, setDragId] = useState<string | null>(null)

  return (
    <div
      role="tablist"
      aria-label="탭"
      style={{
        display: 'flex',
        alignItems: 'stretch',
        height: 32,
        background: tokens.color.bgAlt,
        borderBottom: `1px solid ${tokens.color.border}`,
        overflowX: 'auto'
      }}
    >
      {tabOrder.map((tabId, idx) => (
        <TabItem
          key={tabId}
          tabId={tabId}
          index={idx}
          active={tabId === activeTabId}
          dragId={dragId}
          setDragId={setDragId}
        />
      ))}
      <button
        onClick={() => void requestNewTab()}
        title="새 탭 (Ctrl+T)"
        aria-label="새 탭"
        style={{
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          fontSize: 18,
          color: tokens.color.textMuted,
          width: 34,
          flex: '0 0 auto'
        }}
      >
        +
      </button>
      <button
        onClick={openSettings}
        title="설정 (Ctrl+,)"
        aria-label="설정"
        style={{
          marginLeft: 'auto',
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          fontSize: 16,
          color: tokens.color.textMuted,
          width: 36,
          flex: '0 0 auto'
        }}
      >
        ⚙
      </button>
    </div>
  )
}

function TabItem({
  tabId,
  index,
  active,
  dragId,
  setDragId
}: {
  tabId: string
  index: number
  active: boolean
  dragId: string | null
  setDragId: (id: string | null) => void
}): JSX.Element {
  const label = useRootStore((s) => {
    const tab = s.tabs[tabId]
    if (!tab) return '탭'
    const path = s.panels[tab.activePanelId]?.path ?? ''
    if (path === '') return MY_PC_LABEL
    // 드라이브 루트 탭은 볼륨 라벨 포함 표기("Windows (C:)")로 — 트리 label 재사용.
    return resolveDriveLabel(path, s.tree, baseName(path))
  })
  const activateTab = useRootStore((s) => s.activateTab)
  const closeTab = useRootStore((s) => s.closeTab)
  const moveTab = useRootStore((s) => s.moveTab)

  return (
    <div
      role="tab"
      aria-selected={active}
      draggable
      onDragStart={() => setDragId(tabId)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={() => {
        if (dragId && dragId !== tabId) moveTab(dragId, index)
        setDragId(null)
      }}
      onClick={() => activateTab(tabId)}
      onMouseDown={(e) => {
        // 가운데 클릭 = 닫기.
        if (e.button === 1) {
          e.preventDefault()
          closeTab(tabId)
        }
      }}
      title={label}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '0 8px 0 12px',
        minWidth: 90,
        maxWidth: 200,
        cursor: 'pointer',
        background: active ? tokens.color.bg : 'transparent',
        borderRight: `1px solid ${tokens.color.border}`,
        borderTop: active ? `2px solid ${tokens.color.accent}` : '2px solid transparent',
        fontSize: 13,
        color: active ? tokens.color.text : tokens.color.textMuted
      }}
    >
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation()
          closeTab(tabId)
        }}
        title="탭 닫기 (Ctrl+W)"
        aria-label="탭 닫기"
        style={{
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          color: tokens.color.textMuted,
          fontSize: 13,
          borderRadius: 3,
          width: 18,
          height: 18
        }}
      >
        ✕
      </button>
    </div>
  )
}
