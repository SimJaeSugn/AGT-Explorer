/**
 * SearchBar — Ctrl+F 현재 폴더 검색/필터 (US-4.1/US-4.2, P5).
 *
 * 200ms 반영 전략(SW §6.3 폴백 1·2):
 *  - 입력은 로컬 state 로 즉시 에코(타이핑 블로킹 0) → 스토어 query 갱신은
 *    React `startTransition` 으로 감싸 비차단 + 디바운스(~80ms)로 마지막
 *    입력만 전체 재계산. 가시영역 우선은 가상 스크롤이 본래 가시행만 그리므로
 *    필터 결과 상단이 즉시 보인다. 대량 미달 시 폴백 3(Web Worker)은 조건부.
 *  - 결과 개수는 상태바가 filterInfo 로 표시(여기선 입력 UI 만).
 *  - 패턴: `*.png`/`report*` 글롭, 그 외 부분일치(domain/rules/filter).
 *
 * 검색 컨텍스트(search) 진입 → 전역 단축키 차단(Escape 로 닫기).
 */
import { useEffect, useRef, useState, useTransition } from 'react'
import { useRootStore } from '@renderer/app/stores/rootStore'
import { computeVisible } from '@renderer/app/usecases/selectors'
import { tokens } from '@renderer/ui/theme/tokens'

const DEBOUNCE_MS = 80

export function SearchBar({ panelId }: { panelId: string }): JSX.Element {
  const storeQuery = useRootStore((s) => s.panels[panelId]?.filter.query ?? '')
  const setSearchQuery = useRootStore((s) => s.setSearchQuery)
  const setSearchOpen = useRootStore((s) => s.setSearchOpen)
  const setInputContext = useRootStore((s) => s.setInputContext)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 로컬 즉시 에코값(스토어 반영은 디바운스+transition).
  const [local, setLocal] = useState(storeQuery)
  const [, startTransition] = useTransition()

  useEffect(() => {
    inputRef.current?.focus()
    setInputContext('search')
    return () => {
      setInputContext('list')
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [setInputContext])

  function pushQuery(value: string): void {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      // 비차단 전환: 대량 목록 재필터가 타이핑 프레임을 막지 않게.
      startTransition(() => setSearchQuery(panelId, value))
    }, DEBOUNCE_MS)
  }

  function close(): void {
    if (timerRef.current) clearTimeout(timerRef.current)
    setSearchOpen(panelId, false)
    setInputContext('list')
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 6px',
        borderBottom: `1px solid ${tokens.color.border}`,
        background: tokens.color.bgAlt
      }}
    >
      <span style={{ fontSize: 12, color: tokens.color.textMuted }}>🔍</span>
      <input
        ref={inputRef}
        value={local}
        placeholder="이름·확장자 검색 (예: *.png, report*)"
        onChange={(e) => {
          const v = e.target.value
          setLocal(v)
          pushQuery(v)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            close()
          }
        }}
        aria-label="현재 폴더 검색"
        style={{
          flex: 1,
          height: 22,
          border: `1px solid ${tokens.color.border}`,
          borderRadius: 4,
          padding: '0 8px',
          fontSize: 13,
          fontFamily: tokens.font,
          background: tokens.color.bg,
          color: tokens.color.text
          // 키보드 포커스 가시성은 전역 :focus-visible(a11y CSS)에 위임.
        }}
      />
      <SearchCount panelId={panelId} />
      <button
        onClick={close}
        style={{
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          color: tokens.color.textMuted,
          fontSize: 14
        }}
        aria-label="검색 닫기"
      >
        ✕
      </button>
    </div>
  )
}

/** 검색 결과 개수 인라인 표기(상태바와 별개로 즉시 확인용). */
function SearchCount({ panelId }: { panelId: string }): JSX.Element | null {
  const matched = useRootStore((s) => {
    const p = s.panels[panelId]
    if (!p || !p.filter.open || p.filter.query.trim() === '') return null
    return computeVisible(p).length // 셀렉터 메모 캐시 경유.
  })
  if (matched === null) return null
  return (
    <span style={{ fontSize: 11, color: tokens.color.textMuted, whiteSpace: 'nowrap' }}>
      {matched}개
    </span>
  )
}
