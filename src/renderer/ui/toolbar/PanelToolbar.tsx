/**
 * PanelToolbar — 패널 헤더: 뒤로/앞/위 + 주소 표시줄(브레드크럼·편집) + 보기/정렬.
 *
 * roadmap P2: Ctrl+L 편집 모드(주소 입력·이동), 브레드크럼 클릭 이동,
 * Alt+←/→/↑ 은 단축키 디스패처가 처리(여기 버튼도 동일 액션 호출).
 * 잘못된 경로는 fs:validate-path 로 검증 후 인라인 오류 표시.
 *
 * ui → app(store·infra 경유는 store 액션). 단, 경로 검증은 app usecase 로 위임.
 */
import { useEffect, useRef, useState } from 'react'
import type { ViewMode } from '@shared/dto'
import { useRootStore } from '@renderer/app/stores/rootStore'
import { breadcrumbs, normalizeDisplay } from '@renderer/domain/paths'
import { resolveDriveLabel } from '@renderer/app/selectors/driveLabel'
import { isRemotePath, locationKindOf, makeRemotePath, parseRemotePath } from '@renderer/domain/rules/remoteLocation'
import { validateAndNavigate } from '@renderer/app/usecases/navigate'
import { BreadcrumbDropdown } from '@renderer/ui/toolbar/BreadcrumbDropdown'
import { tokens } from '@renderer/ui/theme/tokens'

interface Props {
  readonly panelId: string
  readonly active: boolean
}

const btnStyle: React.CSSProperties = {
  border: `1px solid ${tokens.color.border}`,
  background: tokens.color.bg,
  borderRadius: 4,
  width: 26,
  height: 24,
  cursor: 'pointer',
  fontSize: 13,
  color: tokens.color.text,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center'
}

export function PanelToolbar({ panelId, active }: Props): JSX.Element {
  const path = useRootStore((s) => s.panels[panelId]?.path ?? '')
  const nav = useRootStore((s) => s.panels[panelId]?.nav)
  const view = useRootStore((s) => s.panels[panelId]?.view)
  const navBack = useRootStore((s) => s.navBack)
  const navForward = useRootStore((s) => s.navForward)
  const navUp = useRootStore((s) => s.navUp)
  const refresh = useRootStore((s) => s.refresh)
  const navigate = useRootStore((s) => s.navigate)
  const setViewMode = useRootStore((s) => s.setViewMode)
  const setActivePanel = useRootStore((s) => s.setActivePanel)
  const activeTabId = useRootStore((s) => s.activeTabId)
  const isFav = useRootStore((s) => s.favorites.includes(path))
  const toggleFavorite = useRootStore((s) => s.toggleFavorite)

  // 주소 편집 모드는 활성 패널만 전역 addressEditing 과 연동.
  const addressEditing = useRootStore((s) => s.addressEditing && active)
  const setAddressEditing = useRootStore((s) => s.setAddressEditing)

  const [editValue, setEditValue] = useState(path)
  const [pathError, setPathError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // 원격 경로면 호스트 프리픽스(sftp://host)는 고정 표시하고, 입력은 경로만 받는다.
  const remoteLoc = parseRemotePath(path)

  useEffect(() => {
    if (addressEditing) {
      // 원격: 호스트 제외 경로만(예: '/mnt/sub') 편집. 로컬: 전체 경로.
      const loc = parseRemotePath(path)
      setEditValue(loc ? loc.remotePath : path)
      setPathError(null)
      useRootStore.getState().setInputContext('addressEdit')
      const t = setTimeout(() => inputRef.current?.select(), 0)
      return () => {
        clearTimeout(t)
        // 편집 종료(Enter 커밋·Esc·언마운트) 시 입력 컨텍스트를 반드시 해제한다.
        // 안 하면 inputContext 가 'addressEdit' 로 남아 Delete/Ctrl+C 등 전역 단축키가
        // 영구 차단된다(주소창 포커스 이후 단축키 먹통 버그).
        useRootStore.getState().setInputContext('list')
      }
    }
    return undefined
  }, [addressEditing, path])

  const crumbs = breadcrumbs(path)
  // §Q1: 패널이 압축(zip) 내부면 주소창에 📦 배지를 표시한다(로컬/원격과 시각 구분).
  const inArchive = locationKindOf(path) === 'archive'
  // 드라이브 루트 세그먼트는 볼륨 라벨 포함 표기("Windows (C:)")로 — 트리 드라이브 노드
  // label 재사용(미로드/비-드라이브 세그먼트는 기존 라벨 유지).
  const tree = useRootStore((s) => s.tree)

  async function commitEdit(): Promise<void> {
    let target: string
    if (remoteLoc) {
      const raw = editValue.trim()
      // 사용자가 전체 URI 를 그대로 넣었으면 그대로, 아니면 호스트에 경로만 결합.
      target = isRemotePath(raw)
        ? raw
        : makeRemotePath(remoteLoc.protocol, remoteLoc.host, raw === '' ? '/' : raw.startsWith('/') ? raw : `/${raw}`)
    } else {
      target = normalizeDisplay(editValue)
    }
    const res = await validateAndNavigate(panelId, target)
    if (res.ok) {
      setAddressEditing(false)
      setPathError(null)
    } else {
      setPathError(res.message)
    }
  }

  function focusPanel(): void {
    if (!active) setActivePanel(activeTabId, panelId)
  }

  return (
    <div
      onMouseDown={focusPanel}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 6px',
        borderBottom: `1px solid ${tokens.color.border}`,
        background: tokens.color.bgAlt
      }}
    >
      <button
        style={{ ...btnStyle, opacity: nav && nav.back.length ? 1 : 0.4 }}
        disabled={!nav || nav.back.length === 0}
        onClick={() => navBack(panelId)}
        title="뒤로 (Alt+←)"
        aria-label="뒤로"
      >
        ←
      </button>
      <button
        style={{ ...btnStyle, opacity: nav && nav.forward.length ? 1 : 0.4 }}
        disabled={!nav || nav.forward.length === 0}
        onClick={() => navForward(panelId)}
        title="앞으로 (Alt+→)"
        aria-label="앞으로"
      >
        →
      </button>
      <button
        style={btnStyle}
        onClick={() => navUp(panelId)}
        title="위로 (Alt+↑ / Backspace)"
        aria-label="위로"
      >
        ↑
      </button>
      <button style={btnStyle} onClick={() => refresh(panelId)} title="새로고침 (Ctrl+R)" aria-label="새로고침">
        ⟳
      </button>
      <button
        style={{ ...btnStyle, opacity: path === '' ? 0.4 : 1, color: isFav ? tokens.color.folder : tokens.color.text }}
        disabled={path === ''}
        onClick={() => toggleFavorite(path)}
        title={isFav ? '즐겨찾기 제거' : '즐겨찾기에 추가'}
        aria-label={isFav ? '즐겨찾기 제거' : '즐겨찾기에 추가'}
        aria-pressed={isFav}
      >
        {isFav ? '★' : '☆'}
      </button>

      {/* 주소 표시줄 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {addressEditing ? (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {remoteLoc && (
                <span
                  title="원격 호스트 — 경로만 입력하세요"
                  style={{
                    flex: '0 0 auto',
                    maxWidth: '40%',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    color: tokens.color.textMuted,
                    fontSize: 12,
                    fontFamily: tokens.font,
                    userSelect: 'none'
                  }}
                >
                  {remoteLoc.protocol}://{remoteLoc.host}
                </span>
              )}
              <input
                ref={inputRef}
                value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void commitEdit()
                else if (e.key === 'Escape') setAddressEditing(false)
              }}
              onFocus={() => useRootStore.getState().setInputContext('addressEdit')}
              onBlur={() => useRootStore.getState().setInputContext('list')}
              spellCheck={false}
              aria-label="경로 입력"
              style={{
                flex: 1,
                minWidth: 0,
                height: 24,
                boxSizing: 'border-box',
                border: `1px solid ${pathError ? tokens.color.danger : tokens.color.accentBorder}`,
                borderRadius: 4,
                padding: '0 8px',
                fontSize: 13,
                fontFamily: tokens.font
                  // 키보드 포커스 가시성은 전역 :focus-visible(a11y CSS)에 위임.
                }}
              />
            </div>
            {pathError && (
              <span style={{ color: tokens.color.danger, fontSize: 11, marginTop: 2 }}>{pathError}</span>
            )}
          </div>
        ) : (
          <div
            onClick={(e) => {
              // 개별 브레드크럼 <button> 클릭은 navigate 전담 → 컨테이너 클릭만 편집 진입.
              if ((e.target as HTMLElement).closest('button')) return
              focusPanel()
              setAddressEditing(true)
            }}
            onDoubleClick={() => {
              focusPanel()
              setAddressEditing(true)
            }}
            title="클릭/더블클릭 또는 Ctrl+L 로 경로 편집"
            style={{
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'nowrap',
              overflow: 'hidden',
              height: 24,
              border: `1px solid ${tokens.color.border}`,
              borderRadius: 4,
              padding: '0 6px',
              background: tokens.color.bg,
              fontSize: 13
            }}
          >
            {inArchive && (
              <span
                title="압축(zip) 내부를 보고 있습니다"
                aria-label="압축 파일 내부"
                style={{
                  flex: '0 0 auto',
                  marginRight: 4,
                  fontSize: 13,
                  userSelect: 'none'
                }}
              >
                📦
              </span>
            )}
            {crumbs.map((c, i) => {
              // ▾ 형제 드롭다운(U2): 로컬 경로 + 마지막(현재) 세그먼트가 아닐 때만.
              // 원격(sftp://·ftp://)·압축(archive://)은 로컬 fs:tree-children 대상이 아니므로 비표시.
              // currentChildPath = 다음 세그먼트(사용자가 실제 거쳐온 자식) — current 표식용.
              const next = crumbs[i + 1]
              const showDropdown = !remoteLoc && !inArchive && next !== undefined
              return (
                <span key={c.path} style={{ display: 'inline-flex', alignItems: 'center' }}>
                  {i > 0 && <span style={{ color: tokens.color.textMuted, margin: '0 2px' }}>›</span>}
                  <button
                    onClick={() => navigate(panelId, c.path, true)}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      cursor: 'pointer',
                      color: tokens.color.text,
                      fontSize: 13,
                      padding: '2px 4px',
                      borderRadius: 3,
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {resolveDriveLabel(c.path, tree, c.label)}
                  </button>
                  {showDropdown && (
                    <BreadcrumbDropdown
                      segmentPath={c.path}
                      currentChildPath={next.path}
                      onNavigate={(p) => navigate(panelId, p, true)}
                    />
                  )}
                </span>
              )
            })}
          </div>
        )}
      </div>

      {/* 보기 전환(5종 드롭다운, J4) */}
      <select
        value={view?.viewMode ?? 'details'}
        onChange={(e) => setViewMode(panelId, e.target.value as ViewMode)}
        title="보기"
        aria-label="보기"
        style={{
          height: 24,
          border: `1px solid ${tokens.color.border}`,
          borderRadius: 4,
          fontSize: 12,
          background: tokens.color.bg,
          color: tokens.color.text
        }}
      >
        <option value="icons-large">큰 아이콘</option>
        <option value="icons-medium">보통 아이콘</option>
        <option value="icons-small">작은 아이콘</option>
        <option value="list">목록</option>
        <option value="details">자세히</option>
      </select>

      {/* 정렬은 자세히 보기 열 헤더 클릭으로 수행한다(FileListView ColumnHeader). */}
    </div>
  )
}
