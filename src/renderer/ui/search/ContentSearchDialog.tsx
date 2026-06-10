/**
 * ContentSearchDialog — 내용 검색(grep) 화면 (§S1·US-18.1·F20·ADR-010).
 *
 * 모달 패턴(DuplicatesDialog/TrashDialog 동형: overlay 클릭 닫기·stopPropagation·role=dialog·
 * aria-modal·Esc·useFocusTrap). 백엔드 search:content:* 진행률·증분 결과·완료를 searchSlice 에서
 * 구독하고, IPC 는 usecases/contentSearch 경유.
 *
 * 구성:
 *  - 입력 행: 검색어 + 정규식·하위 폴더 포함·숨김 포함 토글 + 검색/취소 버튼.
 *  - 진행 행: 스캔/일치 파일 수·현재 경로(aria-live=polite — 진행 안내).
 *  - 결과: 파일별 그룹(상대경로·일치 수) + 일치 줄(라인번호 + 발췌·하이라이트), 가상 스크롤.
 *    role=listbox/option·↑/↓ 이동·Enter/클릭 점프(부모 폴더 이동 + 단일 선택 → 미리보기 J5).
 *  - 빈/0건·절단("결과가 많아 일부만 표시")·오류 상태.
 *
 * 셀렉터 격리: 이 컴포넌트만 searchSlice 를 구독한다.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRootStore } from '@renderer/app/stores/rootStore'
import {
  cancelContentSearch,
  jumpToResult,
  startContentSearch
} from '@renderer/app/usecases/contentSearch'
import {
  flattenResults,
  nextRowIndex,
  splitHighlight,
  type ResultRow
} from '@renderer/domain/rules/contentSearch'
import { baseName } from '@renderer/domain/paths'
import { useFocusTrap } from '@renderer/ui/keyboard/useFocusTrap'
import { btn, overlayStyle, panelStyle, titleStyle } from '@renderer/ui/dialogs/dialogStyles'
import { tokens } from '@renderer/ui/theme/tokens'
import { computeWindow } from '@renderer/ui/panel/views/windowing'

/** 결과 한 행 높이(px·고정 — 가상 스크롤 윈도잉 기준). 헤더/줄 동일 높이로 단순화. */
const ROW_H = 24
/** 가시영역 위·아래 오버스캔 행 수. */
const OVERSCAN = 6
/** 결과 스크롤 영역 높이(px). */
const LIST_H = 420

export function ContentSearchDialog(): JSX.Element | null {
  const open = useRootStore((s) => s.contentSearchOpen)
  const status = useRootStore((s) => s.searchStatus)
  const root = useRootStore((s) => s.searchRoot)
  const query = useRootStore((s) => s.searchQuery)
  const isRegex = useRootStore((s) => s.searchIsRegex)
  const recursive = useRootStore((s) => s.searchRecursive)
  const includeHidden = useRootStore((s) => s.searchIncludeHidden)
  const results = useRootStore((s) => s.searchResults)
  const scannedFiles = useRootStore((s) => s.searchScannedFiles)
  const matchedFiles = useRootStore((s) => s.searchMatchedFiles)
  const currentPath = useRootStore((s) => s.searchCurrentPath)
  const totalMatches = useRootStore((s) => s.searchTotalMatches)
  const truncated = useRootStore((s) => s.searchTruncated)
  const error = useRootStore((s) => s.searchError)

  const setSearchFormQuery = useRootStore((s) => s.setSearchFormQuery)
  const setSearchIsRegex = useRootStore((s) => s.setSearchIsRegex)
  const setSearchRecursive = useRootStore((s) => s.setSearchRecursive)
  const setSearchIncludeHidden = useRootStore((s) => s.setSearchIncludeHidden)
  const clearSearch = useRootStore((s) => s.clearSearch)

  const panelRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  const [scrollTop, setScrollTop] = useState(0)
  const [cursor, setCursor] = useState(-1)

  useFocusTrap(open, panelRef, { initialFocus: inputRef })

  // 열릴 때 결과/커서/스크롤 초기화는 하지 않는다(이전 검색 유지) — 단 커서/스크롤만 리셋.
  useEffect(() => {
    if (open) {
      setCursor(-1)
      setScrollTop(0)
    }
  }, [open])

  // Esc 로 닫기(전역 캡처). 진행 중이면 먼저 취소 후 닫기는 사용자가 명시(여기선 닫기만).
  useEffect(() => {
    if (!open) return undefined
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        close()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open])

  // 그룹 결과 → 평탄한 행 목록(가상 스크롤·키보드 이동 대상).
  const rows = useMemo(() => flattenResults(root, results), [root, results])

  // 새 결과가 들어오면 커서가 범위를 벗어나지 않게 클램프.
  useEffect(() => {
    if (cursor >= rows.length) setCursor(rows.length - 1)
  }, [rows.length, cursor])

  if (!open) return null

  function close(): void {
    useRootStore.getState().closeContentSearch()
  }

  const running = status === 'running'

  function onSubmit(): void {
    setCursor(-1)
    setScrollTop(0)
    void startContentSearch()
  }

  /** 결과 영역 키보드: ↑/↓ 이동, Enter 점프, Home/End. */
  function onListKey(e: React.KeyboardEvent): void {
    if (rows.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      moveCursor(nextRowIndex(cursor, 1, rows.length))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      moveCursor(nextRowIndex(cursor, -1, rows.length))
    } else if (e.key === 'Home') {
      e.preventDefault()
      moveCursor(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      moveCursor(rows.length - 1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const row = rows[cursor]
      if (row) jumpToResult(row.file)
    }
  }

  /** 커서 이동 + 해당 행이 가시영역에 들어오도록 스크롤 보정. */
  function moveCursor(next: number): void {
    setCursor(next)
    const el = listRef.current
    if (!el || next < 0) return
    const top = next * ROW_H
    const bottom = top + ROW_H
    if (top < el.scrollTop) el.scrollTop = top
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight
  }

  return (
    <div
      style={overlayStyle}
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-label="내용 검색"
    >
      <div
        ref={panelRef}
        style={{
          ...panelStyle,
          width: 760,
          maxWidth: '94vw',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 제목 */}
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <h2 style={{ ...titleStyle, margin: 0 }}>🔎 내용 검색</h2>
          <span
            style={{
              marginLeft: 8,
              fontSize: 12,
              color: tokens.color.textMuted,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: 360
            }}
            title={root}
          >
            {baseName(root)}
          </span>
          <button
            onClick={close}
            aria-label="닫기"
            style={{
              marginLeft: 'auto',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              color: tokens.color.textMuted,
              fontSize: 16
            }}
          >
            ✕
          </button>
        </div>

        {/* 입력 행 */}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            onSubmit()
          }}
          style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
        >
          <input
            ref={inputRef}
            value={query}
            placeholder={isRegex ? '정규식 (예: TODO|FIXME)' : '검색할 텍스트'}
            onChange={(e) => setSearchFormQuery(e.target.value)}
            aria-label="검색어"
            style={{
              flex: '1 1 240px',
              height: 28,
              border: `1px solid ${tokens.color.border}`,
              borderRadius: 4,
              padding: '0 10px',
              fontSize: 13,
              fontFamily: tokens.font,
              background: tokens.color.bg,
              color: tokens.color.text
            }}
          />
          {running ? (
            <button type="button" onClick={() => void cancelContentSearch()} style={btn('danger')}>
              취소
            </button>
          ) : (
            <button type="submit" disabled={query.trim() === ''} style={btn('primary')}>
              검색
            </button>
          )}
        </form>

        {/* 옵션 토글 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            marginTop: 8,
            fontSize: 12,
            flexWrap: 'wrap'
          }}
        >
          <Toggle label="정규식" checked={isRegex} onChange={setSearchIsRegex} />
          <Toggle label="하위 폴더 포함" checked={recursive} onChange={setSearchRecursive} />
          <Toggle label="숨김 파일 포함" checked={includeHidden} onChange={setSearchIncludeHidden} />
          <span style={{ flex: 1 }} />
          {(results.length > 0 || status !== 'idle') && (
            <button
              type="button"
              onClick={() => {
                clearSearch()
                setCursor(-1)
                setScrollTop(0)
              }}
              style={{
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                color: tokens.color.textMuted,
                fontSize: 12,
                textDecoration: 'underline'
              }}
            >
              지우기
            </button>
          )}
        </div>

        {/* 진행 행(live region) */}
        <div
          aria-live="polite"
          style={{
            marginTop: 8,
            minHeight: 18,
            fontSize: 12,
            color: tokens.color.textMuted,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            overflow: 'hidden'
          }}
        >
          {running ? (
            <>
              <span>
                스캔 {scannedFiles}개 · 일치 파일 {matchedFiles}개
              </span>
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  opacity: 0.8
                }}
                title={currentPath}
              >
                {currentPath}
              </span>
            </>
          ) : status === 'done' ? (
            <span>
              일치 {totalMatches}건 · 파일 {results.length}개
              {truncated ? ' · 결과가 많아 일부만 표시' : ''}
            </span>
          ) : status === 'canceled' ? (
            <span>검색을 취소했습니다.</span>
          ) : status === 'error' ? (
            <span style={{ color: tokens.color.danger }}>{error ?? '검색 중 오류가 발생했습니다.'}</span>
          ) : null}
        </div>

        {/* 결과 목록(가상 스크롤) */}
        <div
          ref={listRef}
          role="listbox"
          aria-label="검색 결과"
          tabIndex={0}
          onKeyDown={onListKey}
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
          style={{
            marginTop: 8,
            flex: 1,
            minHeight: 160,
            height: LIST_H,
            maxHeight: '52vh',
            overflowY: 'auto',
            border: `1px solid ${tokens.color.border}`,
            borderRadius: 6,
            background: tokens.color.bgAlt,
            position: 'relative',
            outline: 'none'
          }}
        >
          <ResultsBody
            rows={rows}
            scrollTop={scrollTop}
            cursor={cursor}
            status={status}
            onActivate={(row, index) => {
              setCursor(index)
              jumpToResult(row.file)
            }}
          />
        </div>
      </div>
    </div>
  )
}

/** 가상 스크롤 본문 — 윈도잉으로 가시 행만 렌더. */
function ResultsBody({
  rows,
  scrollTop,
  cursor,
  status,
  onActivate
}: {
  rows: ResultRow[]
  scrollTop: number
  cursor: number
  status: string
  onActivate: (row: ResultRow, index: number) => void
}): JSX.Element {
  if (rows.length === 0) {
    const text =
      status === 'running'
        ? '검색 중…'
        : status === 'done'
          ? '일치하는 내용이 없습니다.'
          : '검색어를 입력하고 검색하세요.'
    return (
      <div
        style={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: tokens.color.textMuted,
          fontSize: 13
        }}
      >
        {text}
      </div>
    )
  }

  const win = computeWindow({
    scrollTop,
    viewportH: LIST_H,
    cellH: ROW_H,
    colCount: 1,
    count: rows.length,
    overscan: OVERSCAN
  })

  const slice: JSX.Element[] = []
  for (let i = win.startIdx; i < win.endIdx; i++) {
    const row = rows[i]
    if (!row) continue
    slice.push(
      <ResultRowView
        key={i}
        row={row}
        index={i}
        top={i * ROW_H}
        focused={i === cursor}
        onActivate={onActivate}
      />
    )
  }

  return <div style={{ height: win.totalHeight, position: 'relative' }}>{slice}</div>
}

/** 단일 결과 행(파일 헤더 또는 일치 줄). 절대 위치(가상 스크롤). */
function ResultRowView({
  row,
  index,
  top,
  focused,
  onActivate
}: {
  row: ResultRow
  index: number
  top: number
  focused: boolean
  onActivate: (row: ResultRow, index: number) => void
}): JSX.Element {
  const common: React.CSSProperties = {
    position: 'absolute',
    top,
    left: 0,
    right: 0,
    height: ROW_H,
    display: 'flex',
    alignItems: 'center',
    cursor: 'pointer',
    fontSize: 12,
    boxSizing: 'border-box',
    background: focused ? tokens.color.bgSelected : 'transparent'
  }

  if (row.kind === 'file') {
    return (
      <div
        role="option"
        aria-selected={focused}
        title={row.file}
        onClick={() => onActivate(row, index)}
        style={{
          ...common,
          gap: 6,
          padding: '0 8px',
          fontWeight: 600,
          color: tokens.color.text,
          borderTop: `1px solid ${tokens.color.border}`
        }}
      >
        <span aria-hidden>📄</span>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {row.relPath}
        </span>
        <span style={{ flex: '0 0 auto', color: tokens.color.textMuted, fontWeight: 400 }}>
          {row.lineCount}건
        </span>
      </div>
    )
  }

  return (
    <div
      role="option"
      aria-selected={focused}
      title={`${row.relPath}:${row.line.lineNo}`}
      onClick={() => onActivate(row, index)}
      style={{
        ...common,
        gap: 8,
        padding: '0 8px 0 24px',
        color: tokens.color.text,
        fontFamily: 'ui-monospace, "Consolas", monospace'
      }}
    >
      <span
        aria-hidden
        style={{
          flex: '0 0 44px',
          textAlign: 'right',
          color: tokens.color.textMuted,
          userSelect: 'none'
        }}
      >
        {row.line.lineNo}
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
        <HighlightedLine text={row.line.text} ranges={row.line.ranges} />
      </span>
    </div>
  )
}

/** 일치 줄 발췌를 ranges(end-exclusive)로 하이라이트(<mark>)해 렌더. */
function HighlightedLine({
  text,
  ranges
}: {
  text: string
  ranges: ReadonlyArray<readonly [number, number]>
}): JSX.Element {
  const segs = useMemo(() => splitHighlight(text, ranges), [text, ranges])
  return (
    <>
      {segs.map((seg, i) =>
        seg.hit ? (
          <mark
            key={i}
            style={{
              background: tokens.color.highlight,
              color: 'inherit',
              borderRadius: 2,
              padding: '0 1px'
            }}
          >
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        )
      )}
    </>
  )
}

/** 옵션 토글(체크박스 + 라벨). */
function Toggle({
  label,
  checked,
  onChange
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}): JSX.Element {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}
