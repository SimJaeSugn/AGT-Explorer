/**
 * IconBar — 상단 전역 아이콘바(H-3). TabBar 아래 마운트.
 *
 * 표시 항목·순서는 사용자 설정(단축아이콘 표시/숨김 + 드래그 재배열)을 반영한다.
 * resolveIconBarItems(iconBarOrder, iconBarHidden) 로 해석한 목록을 평탄 렌더하며,
 * 인접 항목의 group 이 바뀌는 경계에만 구분선을 둔다(기본 순서면 기존 4그룹 모양 유지).
 * 모든 버튼 클릭은 execCommand(commandId) 로 수렴(직접 슬라이스 액션 호출 금지, D-1).
 *
 * 드래그 재배열: 각 버튼은 draggable — 드롭 시 id 기준으로 전체 순서를 재구성해
 * reorderIconBar 로 영속한다(숨김 항목 위치 보존). 클릭(execCommand)과 공존.
 *
 * H-4b: 마운트 시 클립보드 상태 1회 초기화 + window focus 재동기(언마운트 정리).
 * 붙여넣기 버튼은 clipboardHasFiles 동기 boolean 으로 활성조건을 판정한다.
 */
import { useEffect, useState } from 'react'
import { useRootStore } from '@renderer/app/stores/rootStore'
import { execCommand } from '@renderer/app/usecases/commandBus'
import { reorderIconBar } from '@renderer/app/usecases/settings'
import { syncSystemClipboardState } from '@renderer/app/usecases/clipboardExternal'
import { tokens } from '@renderer/ui/theme/tokens'
import { Icon } from '@renderer/ui/icons/lucide'
import { iconBarItemTitle, resolveIconBarItems, type IconBarItem } from './iconBarItems'

const btnStyle: React.CSSProperties = {
  border: '1px solid transparent',
  background: 'transparent',
  borderRadius: 8,
  width: 32,
  height: 28,
  cursor: 'pointer',
  fontSize: 14,
  color: tokens.color.text,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0
}

/** 드래그 중 삽입 위치(id 앞/뒤) 표시 상태. */
interface DragState {
  /** 끌고 있는 명령 id. */
  readonly dragId: string
  /** 현재 가리키는 대상 명령 id(null=목록 끝). */
  readonly overId: string | null
}

/** 토글형(active 정의됨) 버튼은 현재 테마 resolved 에 따라 아이콘이 바뀔 수 있음. */
function IconButton({
  item,
  drag,
  onDragStart,
  onDragOverItem,
  onDrop,
  onDragEnd
}: {
  item: IconBarItem
  drag: DragState | null
  onDragStart: (id: string) => void
  onDragOverItem: (id: string) => void
  onDrop: () => void
  onDragEnd: () => void
}): JSX.Element {
  // 각 버튼이 자신의 enabled/active 만 구독(셀렉터 격리).
  const enabled = useRootStore((s) => (item.enabled ? item.enabled(s) : true))
  const active = useRootStore((s) => (item.active ? item.active(s) : false))

  const isToggle = item.active !== undefined
  const title = iconBarItemTitle(item)
  const isDragging = drag?.dragId === item.id
  const showInsert = drag !== null && drag.overId === item.id && drag.dragId !== item.id

  return (
    <button
      type="button"
      draggable
      onClick={() => execCommand(item.id)}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', item.id)
        onDragStart(item.id)
      }}
      onDragOver={(e) => {
        if (!drag) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        onDragOverItem(item.id)
      }}
      onDrop={(e) => {
        e.preventDefault()
        onDrop()
      }}
      onDragEnd={onDragEnd}
      disabled={!enabled}
      title={title}
      aria-label={title}
      aria-pressed={isToggle ? active : undefined}
      style={{
        ...btnStyle,
        opacity: isDragging ? 0.4 : enabled ? 1 : 0.4,
        cursor: enabled ? 'grab' : 'default',
        // 활성(토글 켜짐)= accent 채움 + 대비 글리프(목업 선택 타일). 비활성= 고스트(투명).
        background: active ? tokens.color.accent : 'transparent',
        color: active ? tokens.color.accentContrast : tokens.color.text,
        borderColor: 'transparent',
        // 드롭 삽입 위치 표시: 대상 버튼 왼쪽에 강조 경계.
        boxShadow: showInsert ? `-2px 0 0 0 ${tokens.color.accent}` : undefined
      }}
    >
      {/* 아이콘 팩 SVG(item.icon = 팩 아이콘 이름). 테마 토글은 'theme' 글리프 고정. */}
      <Icon name={item.id === 'theme.toggle' ? 'theme' : item.icon} size={16} />
    </button>
  )
}

const separatorStyle: React.CSSProperties = {
  width: 1,
  alignSelf: 'stretch',
  margin: '2px 4px',
  background: tokens.color.border
}

export function IconBar(): JSX.Element {
  // H-4b: 마운트 1회 초기화 + window focus 재동기(외부 앱 클립보드 변경 반영).
  useEffect(() => {
    void syncSystemClipboardState()
    const onFocus = (): void => {
      void syncSystemClipboardState()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  // 사용자 설정(순서·숨김)을 반영한 표시 항목.
  const order = useRootStore((s) => s.iconBarOrder)
  const hidden = useRootStore((s) => s.iconBarHidden)
  const items = resolveIconBarItems(order, hidden)

  const [drag, setDrag] = useState<DragState | null>(null)

  /** 드롭 확정: id 기준으로 전체 순서(숨김 포함)를 재구성해 영속. */
  function commitReorder(dragId: string, overId: string | null): void {
    // 전체 효과 순서(숨김 포함)의 id 목록.
    const fullIds = resolveIconBarItems(order, []).map((it) => it.id)
    const without = fullIds.filter((id) => id !== dragId)
    if (overId === null) {
      without.push(dragId)
    } else {
      const at = without.indexOf(overId)
      if (at < 0) without.push(dragId)
      else without.splice(at, 0, dragId)
    }
    // 변동 없으면 영속 생략(불필요한 쓰기 방지).
    if (without.length === fullIds.length && without.every((id, i) => id === fullIds[i])) return
    void reorderIconBar(without)
  }

  return (
    <div
      role="toolbar"
      aria-label="전역 도구 모음"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 3,
        padding: '6px 10px',
        borderBottom: `1px solid ${tokens.color.border}`,
        background: tokens.color.chrome,
        flexWrap: 'wrap'
      }}
      // 목록 끝(빈 영역) 드롭: 맨 뒤로 이동.
      onDragOver={(e) => {
        if (drag) e.preventDefault()
      }}
      onDrop={() => {
        if (drag && drag.overId === null) commitReorder(drag.dragId, null)
      }}
    >
      {items.map((it, i) => {
        const prev = items[i - 1]
        // 인접 항목의 group 이 바뀌는 경계에만 구분선(기본 순서면 기존 4그룹 모양).
        const needSep = i > 0 && prev.group !== it.group
        return (
          <div key={it.id} style={{ display: 'contents' }}>
            {needSep && <div role="separator" aria-orientation="vertical" style={separatorStyle} />}
            <IconButton
              item={it}
              drag={drag}
              onDragStart={(id) => setDrag({ dragId: id, overId: id })}
              onDragOverItem={(id) =>
                setDrag((d) => (d && d.overId !== id ? { ...d, overId: id } : d))
              }
              onDrop={() => {
                if (drag) commitReorder(drag.dragId, drag.overId)
                setDrag(null)
              }}
              onDragEnd={() => setDrag(null)}
            />
          </div>
        )
      })}
    </div>
  )
}
