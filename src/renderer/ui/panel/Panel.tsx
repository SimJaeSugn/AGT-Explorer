/**
 * Panel — 독립 탐색 뷰 셸 (SA §4): 툴바 + 검색바 + 파일목록.
 *
 * 활성 패널은 테두리/헤더로 시각 구분(US-1.2 활성 패널 개념).
 * 클릭/포커스 시 setActivePanel 로 활성화한다.
 */
import { useRootStore } from '@renderer/app/stores/rootStore'
import { PanelToolbar } from '@renderer/ui/toolbar/PanelToolbar'
import { FileListView } from '@renderer/ui/panel/views/FileListView'
import { SearchBar } from '@renderer/ui/panel/SearchBar'
import { tokens } from '@renderer/ui/theme/tokens'

interface Props {
  readonly panelId: string
  readonly tabId: string
  readonly active: boolean
}

export function Panel({ panelId, tabId, active }: Props): JSX.Element {
  const setActivePanel = useRootStore((s) => s.setActivePanel)
  const searchOpen = useRootStore((s) => s.panels[panelId]?.filter.open ?? false)

  return (
    <div
      onMouseDownCapture={() => {
        if (!active) setActivePanel(tabId, panelId)
      }}
      data-testid={`panel-${panelId}`}
      data-active={active}
      style={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        border: `2px solid ${active ? tokens.color.accentBorder : 'transparent'}`,
        boxSizing: 'border-box',
        background: tokens.color.bg
      }}
    >
      <PanelToolbar panelId={panelId} active={active} />
      {searchOpen && <SearchBar panelId={panelId} />}
      <FileListView panelId={panelId} active={active} />
    </div>
  )
}
