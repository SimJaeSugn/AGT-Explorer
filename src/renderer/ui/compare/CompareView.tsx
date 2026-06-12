/**
 * CompareView — 듀얼 패널 폴더 비교 diff 뷰 (§P1·US-15.1·F20·M6 메타 비교).
 *
 * 좌/우 패널 항목을 이름으로 짝지어 4상태(좌만/우만/다름/같음)를 색·배지로 표시한다.
 * 동기 스크롤(syncScroll 토글)·차이만 보기(compareDiffOnly)를 지원한다.
 *
 * **M6 스코프: 단일 깊이 메타 비교만**. 해시·재귀는 M7. 비교 대상은 이미 로드된
 * 양 패널 directory.entries(채널 0). 양 패널 entries 변경 시 effect 가 재계산한다.
 *
 * 좌/우를 **독립 스크롤 컨테이너**로 두되 같은 행 인덱스를 공유한다(짝 없는 쪽은
 * placeholder 행). syncScroll=on 이면 useSyncScroll 이 두 컨테이너 scrollTop 을 미러.
 * 가상 스크롤(windowing)을 양쪽 동일 윈도로 적용해 1만 항목도 비차단.
 */
import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import type { FileEntryDTO } from '@shared/dto'
import { useRootStore } from '@renderer/app/stores/rootStore'
import { refreshCompareIfActive } from '@renderer/app/usecases/compare'
import { diffOnlyPairs, type ComparePair, type CompareStatus } from '@renderer/domain/rules/compare'
import { tokens } from '@renderer/ui/theme/tokens'
import { computeWindow } from '@renderer/ui/panel/views/windowing'
import { CompareToolbar } from './CompareToolbar'
import { useSyncScroll } from './useSyncScroll'

const OVERSCAN = 6

/** 상태별 셀 배경 틴트(반투명 — 4테마 위에 얹힘) + 라벨·글리프. */
const STATUS_INFO: Record<CompareStatus, { tint: string; label: string; glyph: string }> = {
  'left-only': { tint: 'rgba(56,142,60,0.18)', label: '좌만 있음', glyph: '◀' },
  'right-only': { tint: 'rgba(25,118,210,0.18)', label: '우만 있음', glyph: '▶' },
  diff: { tint: 'rgba(245,124,0,0.20)', label: '다름', glyph: '≠' },
  same: { tint: 'transparent', label: '같음', glyph: '=' }
}

function fmtSize(size: number, isDir: boolean): string {
  if (isDir) return '폴더'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
  return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`
}

function fmtMtime(ms: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function CompareView(): JSX.Element | null {
  const compareActive = useRootStore((s) => s.compareActive)
  const pairs = useRootStore((s) => s.comparePairs)
  const diffOnly = useRootStore((s) => s.compareDiffOnly)
  const syncScroll = useRootStore((s) => s.syncScroll)
  const leftId = useRootStore((s) => s.compareLeftPanelId)
  const rightId = useRootStore((s) => s.compareRightPanelId)
  // 양 패널 entries 참조 구독(변경 시 재계산 트리거).
  const leftEntries = useRootStore((s) => (leftId ? s.panels[leftId]?.directory.entries : undefined))
  const rightEntries = useRootStore((s) => (rightId ? s.panels[rightId]?.directory.entries : undefined))

  // entries 가 바뀌면(새로고침·워처·이동·미러 후) 비교 결과 재계산.
  useEffect(() => {
    if (compareActive) refreshCompareIfActive()
  }, [compareActive, leftEntries, rightEntries])

  const rows = useMemo<ComparePair[]>(
    () => (diffOnly ? diffOnlyPairs(pairs) : pairs),
    [pairs, diffOnly]
  )

  const sync = useSyncScroll(syncScroll)
  // 좌/우 독립 scrollTop → 독립 윈도잉. 동기 OFF 일 때 한쪽만 스크롤해도 반대편이
  // 자기 DOM 스크롤 위치(0 등)에 맞는 윈도를 그려 빈/검은 띠가 생기지 않는다.
  // 동기 ON 이면 useSyncScroll 이 두 DOM scrollTop 을 미러 → 두 onScroll 이 같은 값으로
  // 발화해 두 윈도도 자동 일치한다.
  const [leftScrollTop, setLeftScrollTop] = useState(0)
  const [rightScrollTop, setRightScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(400)
  const roRef = useRef<ResizeObserver | null>(null)

  // 좌측 컨테이너로 윈도잉 viewport 측정(양 컨테이너 동일 높이).
  const measureRef = useCallback((el: HTMLDivElement | null) => {
    if (roRef.current) {
      roRef.current.disconnect()
      roRef.current = null
    }
    if (el) {
      const ro = new ResizeObserver(() => setViewportH(el.clientHeight))
      ro.observe(el)
      roRef.current = ro
      setViewportH(el.clientHeight)
    }
  }, [])
  useEffect(() => () => roRef.current?.disconnect(), [])

  // 좌측 컨테이너 ref: sync.leftRef + measureRef 합성을 **안정 useCallback** 으로 묶는다.
  // 인라인 화살표로 두면 매 렌더 ref 정체성이 바뀌어 detach/attach → measureRef 가 매 렌더
  // ResizeObserver 를 파괴·재생성한다(스크롤마다 발생). 둘 다 안정 함수라 의존성 안정.
  const leftContainerRef = useCallback(
    (el: HTMLDivElement | null) => {
      sync.leftRef(el)
      measureRef(el)
    },
    [sync.leftRef, measureRef]
  )

  const rowH = tokens.rowHeight
  const winLeft = computeWindow({
    scrollTop: leftScrollTop,
    viewportH,
    cellH: rowH,
    colCount: 1,
    count: rows.length,
    overscan: OVERSCAN
  })
  const winRight = computeWindow({
    scrollTop: rightScrollTop,
    viewportH,
    cellH: rowH,
    colCount: 1,
    count: rows.length,
    overscan: OVERSCAN
  })
  const totalHeight = winLeft.totalHeight // count·cellH 동일 → 좌우 동일.

  if (!compareActive) return null

  function renderColumn(side: 'left' | 'right'): JSX.Element[] {
    const out: JSX.Element[] = []
    const win = side === 'left' ? winLeft : winRight
    for (let i = win.startIdx; i < win.endIdx; i++) {
      const pair = rows[i]
      if (!pair) continue
      const entry = side === 'left' ? pair.left : pair.right
      out.push(
        <HalfRow
          key={pair.key}
          entry={entry}
          status={pair.status}
          side={side}
          relPath={pair.relPath}
          top={i * rowH}
          height={rowH}
        />
      )
    }
    return out
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: tokens.color.bg }}>
      <CompareToolbar />
      {/* 컬럼 헤더(좌/우). */}
      <div
        style={{
          display: 'flex',
          flex: '0 0 auto',
          height: 24,
          borderBottom: `1px solid ${tokens.color.borderStrong}`,
          background: tokens.color.bgAlt,
          fontSize: 11,
          color: tokens.color.textMuted
        }}
      >
        <ColHeader label="왼쪽" />
        <div style={{ width: 1, background: tokens.color.borderStrong }} />
        <ColHeader label="오른쪽" />
      </div>
      {rows.length === 0 ? (
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: tokens.color.textMuted,
            fontSize: 13
          }}
        >
          {diffOnly ? '차이가 없습니다.' : '비교할 항목이 없습니다.'}
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          <ScrollColumn
            containerRef={leftContainerRef}
            onScroll={(e) => {
              setLeftScrollTop(e.currentTarget.scrollTop)
              sync.onLeftScroll()
            }}
            totalHeight={totalHeight}
            ariaLabel="폴더 비교 — 왼쪽"
          >
            {renderColumn('left')}
          </ScrollColumn>
          <div style={{ width: 1, background: tokens.color.borderStrong }} />
          <ScrollColumn
            containerRef={sync.rightRef}
            onScroll={(e) => {
              setRightScrollTop(e.currentTarget.scrollTop)
              sync.onRightScroll()
            }}
            totalHeight={totalHeight}
            ariaLabel="폴더 비교 — 오른쪽"
          >
            {renderColumn('right')}
          </ScrollColumn>
        </div>
      )}
    </div>
  )
}

function ScrollColumn({
  containerRef,
  onScroll,
  totalHeight,
  ariaLabel,
  children
}: {
  containerRef: (el: HTMLDivElement | null) => void
  onScroll: (e: React.UIEvent<HTMLDivElement>) => void
  totalHeight: number
  ariaLabel: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      role="grid"
      aria-label={ariaLabel}
      style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', position: 'relative', minWidth: 0 }}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>{children}</div>
    </div>
  )
}

function ColHeader({ label }: { label: string }): JSX.Element {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', padding: '0 10px' }}>{label}</div>
  )
}

/** 재귀 비교 상대경로의 깊이(폴더 구분자 수) — 들여쓰기 산출. */
function relDepth(relPath: string | undefined): number {
  if (!relPath) return 0
  let n = 0
  for (const ch of relPath) if (ch === '\\' || ch === '/') n++
  return n
}

function HalfRow({
  entry,
  status,
  side,
  relPath,
  top,
  height
}: {
  entry: FileEntryDTO | null
  status: CompareStatus
  side: 'left' | 'right'
  relPath?: string | undefined
  top: number
  height: number
}): JSX.Element {
  const info = STATUS_INFO[status]
  // 재귀 비교면 상대경로 깊이만큼 들여쓰기(가독성). 단일깊이는 0.
  const indent = relDepth(relPath) * 14
  // 짝 없는 쪽(placeholder) — 옅은 빗금 배경으로 "없음" 표현.
  if (!entry) {
    return (
      <div
        role="row"
        aria-label="없음"
        style={{
          position: 'absolute',
          top,
          left: 0,
          right: 0,
          height,
          display: 'flex',
          alignItems: 'center',
          padding: '0 10px',
          paddingLeft: 10 + indent,
          boxSizing: 'border-box',
          color: tokens.color.textMuted,
          fontStyle: 'italic',
          borderBottom: `1px solid ${tokens.color.border}`,
          background:
            'repeating-linear-gradient(45deg, transparent, transparent 6px, rgba(128,128,128,0.06) 6px, rgba(128,128,128,0.06) 12px)'
        }}
      >
        —
      </div>
    )
  }
  const showBadge =
    status === 'diff' ||
    (status === 'left-only' && side === 'left') ||
    (status === 'right-only' && side === 'right')
  return (
    <div
      role="row"
      aria-label={`${relPath ?? entry.name}, ${info.label}`}
      title={entry.path}
      style={{
        position: 'absolute',
        top,
        left: 0,
        right: 0,
        height,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '0 10px',
        paddingLeft: 10 + indent,
        boxSizing: 'border-box',
        fontSize: 13,
        whiteSpace: 'nowrap',
        background: info.tint,
        borderBottom: `1px solid ${tokens.color.border}`
      }}
    >
      <span aria-hidden style={{ flex: '0 0 auto' }}>
        {entry.isDir ? '📁' : '📄'}
      </span>
      <span style={{ flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis' }}>{entry.name}</span>
      {showBadge && (
        <span
          aria-hidden
          title={info.label}
          style={{ flex: '0 0 auto', fontSize: 11, fontWeight: 700, color: tokens.color.text, opacity: 0.75 }}
        >
          {info.glyph}
        </span>
      )}
      <span style={{ flex: '0 0 72px', textAlign: 'right', color: tokens.color.textMuted, fontVariantNumeric: 'tabular-nums' }}>
        {fmtSize(entry.size, entry.isDir)}
      </span>
      <span style={{ flex: '0 0 116px', textAlign: 'right', color: tokens.color.textMuted, fontVariantNumeric: 'tabular-nums' }}>
        {fmtMtime(entry.mtime)}
      </span>
    </div>
  )
}
