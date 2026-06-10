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
import { openContentSearch } from '@renderer/app/usecases/contentSearch'
import { TAG_PALETTE, type TagKey } from '@renderer/domain/rules/tags'
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
        borderBottom: `1px solid ${tokens.color.border}`,
        background: tokens.color.bgAlt
      }}
    >
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 6px'
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
      {/* S1: 이름 검색 → 내용 검색(grep) 모드 전환. 현재 입력을 검색어로 시드. */}
      <button
        type="button"
        onClick={() => openContentSearch(local.trim())}
        title="내용 검색 (파일 안 텍스트 grep)"
        aria-label="내용 검색 열기"
        style={{
          flex: '0 0 auto',
          height: 22,
          padding: '0 8px',
          border: `1px solid ${tokens.color.border}`,
          borderRadius: 4,
          background: tokens.color.bg,
          color: tokens.color.text,
          cursor: 'pointer',
          fontSize: 11,
          whiteSpace: 'nowrap'
        }}
      >
        내용 검색
      </button>
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
      {/* T1: 태그 칩 필터(활성 태그로 목록 좁히기 — OR 합성·이름필터와 AND). */}
      <TagChips panelId={panelId} />
    </div>
  )
}

/**
 * TagChips — 색상 태그 필터 칩(T1·US-19.1). 칩 토글로 panelId 의 활성 태그 필터를
 * on/off 한다. 활성 태그가 있으면 computeVisible 이 이름필터 AND 태그필터(OR)로 좁힌다.
 * 모두 끄면 태그 필터 비활성(전체). 검색바 하단에 작은 색상 점 칩 줄로 둔다.
 */
function TagChips({ panelId }: { panelId: string }): JSX.Element {
  const activeTags = useRootStore((s) => s.activeTagsByPanel[panelId])
  const toggleActiveTag = useRootStore((s) => s.toggleActiveTag)
  const clearActiveTags = useRootStore((s) => s.clearActiveTags)
  const active = activeTags ?? EMPTY_ACTIVE

  return (
    <div
      role="group"
      aria-label="태그 필터"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '0 6px 4px',
        flexWrap: 'wrap'
      }}
    >
      <span style={{ fontSize: 11, color: tokens.color.textMuted, marginRight: 2 }}>태그:</span>
      {TAG_PALETTE.map((c) => {
        const on = active.has(c.key)
        return (
          <button
            key={c.key}
            type="button"
            aria-pressed={on}
            aria-label={`태그 필터 ${c.name}${on ? ' 켜짐' : ''}`}
            title={c.name}
            onClick={() => toggleActiveTag(panelId, c.key)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              height: 20,
              padding: '0 7px',
              borderRadius: 10,
              cursor: 'pointer',
              fontSize: 11,
              color: tokens.color.text,
              background: on ? tokens.color.bgSelected : tokens.color.bg,
              border: `1px solid ${on ? tokens.color.accentBorder : tokens.color.border}`
            }}
          >
            <span
              aria-hidden
              style={{
                width: 9,
                height: 9,
                borderRadius: '50%',
                background: c.color,
                boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.18)'
              }}
            />
            {c.name}
          </button>
        )
      })}
      {active.size > 0 && (
        <button
          type="button"
          onClick={() => clearActiveTags(panelId)}
          aria-label="태그 필터 모두 해제"
          style={{
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            color: tokens.color.textMuted,
            fontSize: 11,
            textDecoration: 'underline'
          }}
        >
          해제
        </button>
      )}
    </div>
  )
}

/** 활성 태그 미존재 시 안정 빈 Set(참조 안정). */
const EMPTY_ACTIVE: ReadonlySet<TagKey> = new Set<TagKey>()

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
