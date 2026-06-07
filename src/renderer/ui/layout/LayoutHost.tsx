/**
 * LayoutHost — 활성 탭의 레이아웃(단일/2분할/4분할)에 따라 패널 배치 (US-1.2, US-1.4).
 *
 * roadmap P3: single·split-2-h(좌우)·split-2-v(상하). 분할선·최소폭.
 * roadmap P6: grid-4(2x2). panelIds row-major(0=좌상,1=우상,2=좌하,3=우하)로
 * 셀에 배치하고 셀 경계에 분할선을 둔다. 각 패널 독립 상태.
 *
 * H-5(분할 크기조절): SplitDivider 드래그로 비율 조절. 축 매핑은 LayoutHost 가
 * 결정한다 — split-2-h=vertical divider(col), split-2-v=horizontal divider(row),
 * grid-4=vertical(col)+horizontal(row) 독립 2개. 비율은 Tab.splitRatios(미설정 시
 * 0.5/0.5 균등). 좁은 창은 minWidth220/minHeight160 이 비율보다 우선한다.
 *
 * 활성 탭만 마운트(탭 전환 시 다른 탭 패널은 언마운트되지만 스토어 상태는 유지).
 */
import { useRef } from 'react'
import { useRootStore } from '@renderer/app/stores/rootStore'
import { Panel } from '@renderer/ui/panel/Panel'
import { SplitDivider } from '@renderer/ui/layout/SplitDivider'
import { SPLIT_DEFAULT } from '@renderer/domain/entities'
import { tokens } from '@renderer/ui/theme/tokens'

export function LayoutHost(): JSX.Element {
  const tab = useRootStore((s) => s.tabs[s.activeTabId])
  const setSplitRatio = useRootStore((s) => s.setSplitRatio)
  // 분할 비율 측정 기준: 실제 분할 컨테이너(2분할=flex, 4분할=grid) ref.
  // SplitDivider 의 DOM 부모가 컨테이너가 아니므로 명시적으로 ref 를 넘긴다.
  const splitContainerRef = useRef<HTMLDivElement>(null)
  const gridContainerRef = useRef<HTMLDivElement>(null)

  if (!tab) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: tokens.color.textMuted }}>
        탭이 없습니다.
      </div>
    )
  }

  const ratios = tab.splitRatios ?? SPLIT_DEFAULT
  const col = ratios.col
  const row = ratios.row

  // ── 4분할(grid-4): CSS grid 2x2, row-major 배치 + 독립 2 divider ──────
  if (tab.layout === 'grid-4') {
    // 경미-2 가드: 정확히 4패널일 때만 비율/divider 적용(아니면 균등 폴백).
    const isQuad = tab.panelIds.length === 4
    const gCol = isQuad ? col : 0.5
    const gRow = isQuad ? row : 0.5
    return (
      <div
        ref={gridContainerRef}
        style={{
          flex: 1,
          minWidth: 0,
          position: 'relative',
          display: 'grid',
          gridTemplateColumns: `${gCol}fr ${1 - gCol}fr`,
          gridTemplateRows: `${gRow}fr ${1 - gRow}fr`,
          background: tokens.color.bgAlt
        }}
      >
        {tab.panelIds.map((pid, i) => {
          const c = i % 2
          const r = Math.floor(i / 2)
          return (
            <div
              key={pid}
              style={{
                minWidth: 220,
                minHeight: 160,
                display: 'flex',
                overflow: 'hidden',
                borderLeft: c > 0 ? `1px solid ${tokens.color.borderStrong}` : undefined,
                borderTop: r > 0 ? `1px solid ${tokens.color.borderStrong}` : undefined
              }}
            >
              <Panel panelId={pid} tabId={tab.id} active={pid === tab.activePanelId} />
            </div>
          )
        })}
        {isQuad && (
          <>
            {/* 세로 divider(col 조절) — 가운데 열 경계, 전체 높이. */}
            <div
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: `${gCol * 100}%`,
                width: 6,
                transform: 'translateX(-50%)'
              }}
            >
              <SplitDivider
                orientation="vertical"
                containerRef={gridContainerRef}
                onDrag={(ratio) => setSplitRatio(tab.id, 'col', ratio)}
                onReset={() => setSplitRatio(tab.id, 'col', 0.5)}
              />
            </div>
            {/* 가로 divider(row 조절) — 가운데 행 경계, 전체 너비. */}
            <div
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: `${gRow * 100}%`,
                height: 6,
                transform: 'translateY(-50%)'
              }}
            >
              <SplitDivider
                orientation="horizontal"
                containerRef={gridContainerRef}
                onDrag={(ratio) => setSplitRatio(tab.id, 'row', ratio)}
                onReset={() => setSplitRatio(tab.id, 'row', 0.5)}
              />
            </div>
          </>
        )}
      </div>
    )
  }

  const horizontal = tab.layout === 'split-2-h'
  const split = tab.layout === 'split-2-h' || tab.layout === 'split-2-v'

  // ── 2분할: flex 비율 적용 + divider 1개 ──────────────────────────────
  if (split) {
    // split-2-h → col(좌측 비율), split-2-v → row(상단 비율).
    const first = horizontal ? col : row
    const axis: 'col' | 'row' = horizontal ? 'col' : 'row'
    // 패널·divider 를 컨테이너의 직접 flex 자식으로 평탄 배치한다(=display:contents
    // 래퍼 제거). divider 는 flex:0 0 6px 직접 자식이라 컨테이너 rect 로 정상 측정.
    const nodes: JSX.Element[] = []
    tab.panelIds.forEach((pid, i) => {
      const isFirst = i === 0
      if (!isFirst) {
        nodes.push(
          <SplitDivider
            key={`divider-${pid}`}
            orientation={horizontal ? 'vertical' : 'horizontal'}
            containerRef={splitContainerRef}
            onDrag={(ratio) => setSplitRatio(tab.id, axis, ratio)}
            onReset={() => setSplitRatio(tab.id, axis, 0.5)}
          />
        )
      }
      nodes.push(
        <div
          key={pid}
          style={{
            flex: isFirst ? first : 1 - first,
            minWidth: horizontal ? 220 : 0,
            minHeight: horizontal ? 0 : 160,
            display: 'flex',
            overflow: 'hidden'
          }}
        >
          <Panel panelId={pid} tabId={tab.id} active={pid === tab.activePanelId} />
        </div>
      )
    })
    return (
      <div
        ref={splitContainerRef}
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: horizontal ? 'row' : 'column',
          background: tokens.color.bgAlt
        }}
      >
        {nodes}
      </div>
    )
  }

  // ── 단일(single): 기존 유지 ──────────────────────────────────────────
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        background: tokens.color.bgAlt
      }}
    >
      {tab.panelIds.map((pid) => (
        <div key={pid} style={{ flex: 1, minWidth: 0, display: 'flex' }}>
          <Panel panelId={pid} tabId={tab.id} active={pid === tab.activePanelId} />
        </div>
      ))}
    </div>
  )
}
