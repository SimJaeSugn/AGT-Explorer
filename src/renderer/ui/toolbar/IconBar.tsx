/**
 * IconBar — 상단 전역 아이콘바(H-3). TabBar 아래 마운트.
 *
 * 4그룹(레이아웃·파일·탐색·도구)을 구분선으로 나눠 렌더한다. 모든 버튼 클릭은
 * execCommand(commandId) 로 수렴(직접 슬라이스 액션 호출 금지, D-1). 각 버튼은
 * 자신의 enabled/active 셀렉터만 구독해 리렌더를 격리한다(IconButton).
 *
 * H-4b: 마운트 시 클립보드 상태 1회 초기화 + window focus 재동기(언마운트 정리).
 * 붙여넣기 버튼은 clipboardHasFiles 동기 boolean 으로 활성조건을 판정한다.
 */
import { useEffect } from 'react'
import { useRootStore } from '@renderer/app/stores/rootStore'
import { execCommand } from '@renderer/app/usecases/commandBus'
import { syncClipboardState } from '@renderer/app/usecases/fileOps'
import { tokens } from '@renderer/ui/theme/tokens'
import { ICON_BAR_ITEMS, iconBarItemTitle, type IconBarItem } from './iconBarItems'

const btnStyle: React.CSSProperties = {
  border: `1px solid ${tokens.color.border}`,
  background: tokens.color.bg,
  borderRadius: 4,
  width: 28,
  height: 26,
  cursor: 'pointer',
  fontSize: 14,
  color: tokens.color.text,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0
}

/** 토글형(active 정의됨) 버튼은 현재 테마 resolved 에 따라 아이콘이 바뀔 수 있음. */
function IconButton({ item }: { item: IconBarItem }): JSX.Element {
  // 각 버튼이 자신의 enabled/active 만 구독(셀렉터 격리).
  const enabled = useRootStore((s) => (item.enabled ? item.enabled(s) : true))
  const active = useRootStore((s) => (item.active ? item.active(s) : false))
  // 테마 토글 버튼은 현재 resolved 테마 글리프(☀/🌙)를 표시.
  const theme = useRootStore((s) => s.theme)

  let icon = item.icon
  if (item.id === 'theme.toggle') {
    const resolved = resolvedThemeGlyph(theme)
    icon = resolved
  }

  const isToggle = item.active !== undefined
  const title = iconBarItemTitle(item)

  return (
    <button
      type="button"
      onClick={() => execCommand(item.id)}
      disabled={!enabled}
      title={title}
      aria-label={title}
      aria-pressed={isToggle ? active : undefined}
      style={{
        ...btnStyle,
        opacity: enabled ? 1 : 0.4,
        cursor: enabled ? 'pointer' : 'default',
        background: active ? tokens.color.bgSelected : tokens.color.bg,
        borderColor: active ? tokens.color.accentBorder : tokens.color.border
      }}
    >
      {icon}
    </button>
  )
}

/** 현재 테마 설정에서 토글 버튼에 보일 글리프(라이트=☀ → 다크로 전환, 다크=🌙). */
function resolvedThemeGlyph(theme: string): string {
  // light 면 "다크로 전환" 의미로 🌙, dark 면 ☀. system 은 ◐(중립).
  if (theme === 'dark') return '☀'
  if (theme === 'light') return '🌙'
  return '◐'
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
    void syncClipboardState()
    const onFocus = (): void => {
      void syncClipboardState()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  // 그룹 경계에 구분선을 삽입하며 렌더.
  const groups: IconBarItem['group'][] = ['layout', 'file', 'nav', 'tool']

  return (
    <div
      role="toolbar"
      aria-label="전역 도구 모음"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '4px 8px',
        borderBottom: `1px solid ${tokens.color.border}`,
        background: tokens.color.bgAlt,
        flexWrap: 'wrap'
      }}
    >
      {groups.map((g, gi) => (
        <div key={g} style={{ display: 'contents' }}>
          {gi > 0 && <div role="separator" aria-orientation="vertical" style={separatorStyle} />}
          {ICON_BAR_ITEMS.filter((it) => it.group === g).map((it) => (
            <IconButton key={it.id} item={it} />
          ))}
        </div>
      ))}
    </div>
  )
}
