/**
 * CommandPalette — 명령 팔레트 오버레이 (S2 · US-18.2, Should).
 *
 * Ctrl+Shift+P 로 열리는 중앙 오버레이. 텍스트 입력 + 결과 리스트로,
 * 한 곳에서 (1) 등록된 모든 명령(commandId + 사람이 읽는 라벨) 실행,
 * (2) 즐겨찾기·최근·드라이브로 활성 패널 이동을 제공한다.
 *
 * 소스(모두 렌더러 상태 — 신규 IPC 0):
 *   - 명령: KeyBindingRegistry.listBindings()(PRD §8 단일 출처)에서 commandId+label
 *     을 dedupe. 실행은 commandBus.execCommand(id).
 *   - 즐겨찾기/최근/드라이브: uiStore(favorites·recent·treeRoots·tree). 선택 시
 *     활성 패널 navigate.
 *
 * 매칭/정렬은 domain/rules/paletteMatch(순수)에 위임. a11y: role="dialog"
 * aria-modal·input 라벨·결과 role="listbox"/option·↑/↓/Enter/Esc·포커스 트랩·
 * opener 복귀(useFocusTrap). inputContext='dialog' 로 전역 단축키는 차단된다.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRootStore } from '@renderer/app/stores/rootStore'
import { execCommand } from '@renderer/app/usecases/commandBus'
import { keyBindingRegistry } from '@renderer/ui/keyboard/registry'
import { baseName } from '@renderer/domain/paths'
import { resolveDriveLabel } from '@renderer/app/selectors/driveLabel'
import { matchPalette, type PaletteCandidate } from '@renderer/domain/rules/paletteMatch'
import { useFocusTrap } from '@renderer/ui/keyboard/useFocusTrap'
import { overlayStyle } from '@renderer/ui/dialogs/dialogStyles'
import { tokens } from '@renderer/ui/theme/tokens'

/** 팔레트 항목 종류(아이콘·실행 분기). */
type ItemKind = 'command' | 'favorite' | 'recent' | 'drive'

/** 팔레트 항목 1개(매칭용 라벨 + 실행 식별자). */
interface PaletteItem {
  readonly kind: ItemKind
  /** 매칭/표시 라벨. */
  readonly label: string
  /** kind==='command' → commandId, 그 외 → 경로. */
  readonly target: string
  /** 보조 표기(명령 그룹·경로 등, 우측 흐림 텍스트). */
  readonly hint: string
}

const ICON: Record<ItemKind, string> = {
  command: '⌘',
  favorite: '★',
  recent: '🕘',
  drive: '💽'
}

export function CommandPalette(): JSX.Element | null {
  const open = useRootStore((s) => s.paletteOpen)
  const close = useRootStore((s) => s.closePalette)
  const favorites = useRootStore((s) => s.favorites)
  const favoriteLabels = useRootStore((s) => s.favoriteLabels)
  const recent = useRootStore((s) => s.recent)
  const treeRoots = useRootStore((s) => s.treeRoots)
  const tree = useRootStore((s) => s.tree)
  const navigate = useRootStore((s) => s.navigate)

  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  // 포커스 트랩(컨테이너=패널 div, 첫 포커스=입력) + opener 복귀.
  useFocusTrap(open, panelRef, { initialFocus: inputRef })

  // 열릴 때마다 질의/활성 인덱스 초기화.
  useEffect(() => {
    if (open) {
      setQuery('')
      setActive(0)
    }
  }, [open])

  // 모든 후보(명령 + 즐겨찾기 + 최근 + 드라이브). 열렸을 때만 계산.
  const candidates = useMemo<PaletteCandidate<PaletteItem>[]>(() => {
    if (!open) return []
    const out: PaletteCandidate<PaletteItem>[] = []

    // (1) 명령: PRD §8 단일 출처에서 commandId+label dedupe(첫 등장 우선).
    const seen = new Set<string>()
    for (const b of keyBindingRegistry.listBindings()) {
      if (seen.has(b.commandId)) continue
      // 팔레트 자기 자신·퀵룩 토글은 메뉴에서 제외(혼란 방지).
      if (b.commandId === 'palette.open' || b.commandId === 'quicklook.toggle') continue
      seen.add(b.commandId)
      out.push({
        label: b.label,
        value: { kind: 'command', label: b.label, target: b.commandId, hint: b.group }
      })
    }

    // (2) 즐겨찾기: 별칭 우선·없으면 드라이브 라벨/basename.
    for (const p of favorites) {
      const alias = favoriteLabels[p]
      const display = alias && alias.trim() !== '' ? alias : resolveDriveLabel(p, tree, baseName(p))
      out.push({
        label: display,
        value: { kind: 'favorite', label: display, target: p, hint: p }
      })
    }

    // (3) 최근.
    for (const p of recent) {
      const display = resolveDriveLabel(p, tree, baseName(p))
      out.push({
        label: display,
        value: { kind: 'recent', label: display, target: p, hint: p }
      })
    }

    // (4) 드라이브(트리 루트).
    for (const p of treeRoots) {
      const display = tree[p]?.label ?? p
      out.push({
        label: display,
        value: { kind: 'drive', label: display, target: p, hint: p }
      })
    }
    return out
  }, [open, favorites, favoriteLabels, recent, treeRoots, tree])

  const results = useMemo(() => matchPalette(candidates, query), [candidates, query])

  // 결과 수 변동 시 활성 인덱스 클램프.
  useEffect(() => {
    setActive((a) => (results.length === 0 ? 0 : Math.min(a, results.length - 1)))
  }, [results.length])

  // 활성 항목 스크롤 추종.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!open) return null

  function run(item: PaletteItem): void {
    if (item.kind === 'command') {
      close()
      execCommand(item.target)
      return
    }
    // 즐겨찾기/최근/드라이브 → 활성 패널 이동.
    const st = useRootStore.getState()
    const pid = st.activePanelId()
    close()
    if (pid) navigate(pid, item.target, true)
  }

  function onKeyDown(e: React.KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => (results.length === 0 ? 0 : (a + 1) % results.length))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => (results.length === 0 ? 0 : (a - 1 + results.length) % results.length))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const r = results[active]
      if (r) run(r.candidate.value)
    }
  }

  return (
    <div
      style={{ ...overlayStyle, alignItems: 'flex-start', paddingTop: '12vh' }}
      onClick={close}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="명령 팔레트"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        style={{
          width: 560,
          maxWidth: '92vw',
          maxHeight: '70vh',
          display: 'flex',
          flexDirection: 'column',
          background: tokens.color.bg,
          border: `1px solid ${tokens.color.borderStrong}`,
          borderRadius: 10,
          boxShadow: '0 12px 40px rgba(0,0,0,0.28)',
          overflow: 'hidden',
          color: tokens.color.text
        }}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
          }}
          placeholder="명령·즐겨찾기·최근·드라이브 검색…"
          aria-label="명령 팔레트 검색"
          aria-controls="palette-results"
          spellCheck={false}
          autoComplete="off"
          style={{
            flex: '0 0 auto',
            height: 44,
            border: 'none',
            borderBottom: `1px solid ${tokens.color.border}`,
            background: 'transparent',
            color: tokens.color.text,
            fontSize: 15,
            padding: '0 14px',
            outline: 'none',
            fontFamily: tokens.font
          }}
        />
        <div
          ref={listRef}
          id="palette-results"
          role="listbox"
          aria-label="검색 결과"
          style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 0' }}
        >
          {results.length === 0 ? (
            <div
              style={{
                padding: '16px 14px',
                color: tokens.color.textMuted,
                fontSize: 13,
                textAlign: 'center'
              }}
            >
              일치하는 항목이 없습니다.
            </div>
          ) : (
            results.map((r, i) => {
              const item = r.candidate.value
              const selected = i === active
              return (
                <div
                  key={`${item.kind}:${item.target}`}
                  data-idx={i}
                  role="option"
                  aria-selected={selected}
                  onMouseMove={() => setActive(i)}
                  onClick={() => run(item)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '7px 14px',
                    cursor: 'pointer',
                    background: selected ? tokens.color.bgSelected : 'transparent'
                  }}
                >
                  <span style={{ width: 18, textAlign: 'center', flex: '0 0 auto' }}>
                    {ICON[item.kind]}
                  </span>
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {item.label}
                  </span>
                  <span
                    style={{
                      flex: '0 0 auto',
                      maxWidth: '45%',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      color: tokens.color.textMuted,
                      fontSize: 11
                    }}
                    title={item.hint}
                  >
                    {item.hint}
                  </span>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
