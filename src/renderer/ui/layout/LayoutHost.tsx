/**
 * LayoutHost — 활성 탭의 레이아웃(단일/2분할/4분할)에 따라 패널 배치 (US-1.2, US-1.4).
 *
 * roadmap P3: single·split-2-h(좌우)·split-2-v(상하). 분할선·최소폭.
 * roadmap P6: grid-4(2x2). panelIds row-major(0=패널1/좌상,1=패널2/우상,2=패널3/좌하,3=패널4/우하)로
 * 셀에 배치하고 셀 경계에 분할선을 둔다. 각 패널 독립 상태.
 *
 * H-5(분할 크기조절): SplitDivider 드래그로 비율 조절. 축 매핑은 LayoutHost 가
 * 결정한다 — split-2-h=vertical divider(col), split-2-v=horizontal divider(row),
 * grid-4=vertical(col)+horizontal(row) 독립 2개. 비율은 Tab.splitRatios(미설정 시
 * 0.5/0.5 균등). 좁은 창은 minWidth220/minHeight160 이 비율보다 우선한다.
 *
 * 활성 탭만 마운트(탭 전환 시 다른 탭 패널은 언마운트되지만 스토어 상태는 유지).
 */
import { useRef, useState } from 'react'
import { useRootStore } from '@renderer/app/stores/rootStore'
import { Panel } from '@renderer/ui/panel/Panel'
import { SplitDivider } from '@renderer/ui/layout/SplitDivider'
import { ratioFromPoint } from '@renderer/ui/layout/splitMath'
import { CompareView } from '@renderer/ui/compare/CompareView'
import { SPLIT_DEFAULT } from '@renderer/domain/entities'
import { tokens } from '@renderer/ui/theme/tokens'

/** 분할 카드 사이/창 가장자리 여백(px) — 패널이 분리된 둥근 카드로 떠 보이게 한다(목업 톤). */
const SPLIT_GAP = 12

export function LayoutHost(): JSX.Element {
  const tab = useRootStore((s) => s.tabs[s.activeTabId])
  const setSplitRatio = useRootStore((s) => s.setSplitRatio)
  // §P1: 폴더 비교 모드(2분할 좌/우)면 CompareView 로 전환(기존 FileListView 비파괴).
  const compareActive = useRootStore((s) => s.compareActive)
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

  // ── 폴더 비교 모드(§P1): 2분할 좌/우를 CompareView 로 전환(diff 4상태·동기 스크롤). ──
  // 비교는 2분할에서만 진입(usecases/compare.startCompare 가 가드). 그 외 레이아웃은 무시.
  if (compareActive && (tab.layout === 'split-2-h' || tab.layout === 'split-2-v')) {
    return <CompareView />
  }

  // ── 4분할(grid-4): CSS grid 2x2, row-major 배치 + 독립 2 divider ──────
  if (tab.layout === 'grid-4') {
    // 경미-2 가드: 정확히 4패널일 때만 비율/divider 적용(아니면 균등 폴백).
    const isQuad = tab.panelIds.length === 4
    const gCol = isQuad ? col : 0.5
    const gRow = isQuad ? row : 0.5
    return (
      // 바깥 여백(창 가장자리 인셋) → 안쪽 grid(gap 으로 카드 분리). 측정 기준 ref 는
      // gap 만 있고 padding 0 인 안쪽 grid 라 비율(ratioFromPoint)이 정확하다.
      <div style={{ flex: 1, minWidth: 0, padding: SPLIT_GAP, background: tokens.color.bg }}>
        <div
          ref={gridContainerRef}
          style={{
            width: '100%',
            height: '100%',
            position: 'relative',
            display: 'grid',
            gridTemplateColumns: `${gCol}fr ${1 - gCol}fr`,
            gridTemplateRows: `${gRow}fr ${1 - gRow}fr`,
            gap: SPLIT_GAP
          }}
        >
          {tab.panelIds.map((pid, i) => (
            // fr 비율(0.15~0.85 클램프)이 셀 크기를 온전히 제어하도록 최소 크기 0.
            // 카드 테두리/라운드/클립은 Panel 자신이 그린다(셀 경계선 제거 — gap 이 분리).
            <div key={pid} style={{ minWidth: 0, minHeight: 0, display: 'flex' }}>
              <Panel
                panelId={pid}
                tabId={tab.id}
                active={pid === tab.activePanelId}
                panelNumber={i + 1}
                totalPanels={tab.panelIds.length}
              />
            </div>
          ))}
          {isQuad && (
            <>
              {/* 세로 divider(col 조절) — 가운데 열 gap, 전체 높이. */}
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: `${gCol * 100}%`,
                  width: SPLIT_GAP,
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
              {/* 가로 divider(row 조절) — 가운데 행 gap, 전체 너비. */}
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top: `${gRow * 100}%`,
                  height: SPLIT_GAP,
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
              {/* 가운데 교차점 핸들(목업 그린 원) — 가로·세로 동시 조절. */}
              <CenterHandle
                gridRef={gridContainerRef}
                left={gCol}
                top={gRow}
                onDrag={(c, r) => {
                  setSplitRatio(tab.id, 'col', c)
                  setSplitRatio(tab.id, 'row', r)
                }}
                onReset={() => {
                  setSplitRatio(tab.id, 'col', 0.5)
                  setSplitRatio(tab.id, 'row', 0.5)
                }}
              />
            </>
          )}
        </div>
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
            // 비율(first·0.15~0.85 클램프)이 크기를 온전히 제어하도록 최소 크기 0.
            // (220/160 floor 는 비율과 충돌해 분할선이 멈춘 듯한 데드존을 만든다 — grid-4 동일.)
            minWidth: 0,
            minHeight: 0,
            display: 'flex',
            overflow: 'hidden'
          }}
        >
          <Panel
            panelId={pid}
            tabId={tab.id}
            active={pid === tab.activePanelId}
            panelNumber={i + 1}
            totalPanels={tab.panelIds.length}
          />
        </div>
      )
    })
    return (
      // 바깥 여백(창 인셋) → 안쪽 flex(ref·padding 0)에서 비율 측정 → 정확.
      // 두 카드 사이 간격은 SplitDivider(7px) 가 담당(카드 라운드/테두리는 Panel).
      <div style={{ flex: 1, minWidth: 0, padding: SPLIT_GAP, background: tokens.color.bg, display: 'flex' }}>
        <div
          ref={splitContainerRef}
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: horizontal ? 'row' : 'column'
          }}
        >
          {nodes}
        </div>
      </div>
    )
  }

  // ── 단일(single): 둥근 카드 1개를 창 인셋 여백 안에 둔다 ───────────────
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        padding: SPLIT_GAP,
        background: tokens.color.bg
      }}
    >
      {tab.panelIds.map((pid, i) => (
        <div key={pid} style={{ flex: 1, minWidth: 0, display: 'flex' }}>
          <Panel
            panelId={pid}
            tabId={tab.id}
            active={pid === tab.activePanelId}
            panelNumber={i + 1}
            totalPanels={tab.panelIds.length}
          />
        </div>
      ))}
    </div>
  )
}

/**
 * CenterHandle — 4분할 가운데 교차점의 둥근 그린 핸들(목업). 드래그하면 포인터 위치로
 * col(가로 비율)·row(세로 비율)를 동시에 조절한다. 더블클릭=균등(0.5/0.5).
 * 측정 기준은 안쪽 grid rect(padding 0)라 ratioFromPoint 가 정확하다.
 */
function CenterHandle({
  gridRef,
  left,
  top,
  onDrag,
  onReset
}: {
  gridRef: React.RefObject<HTMLElement>
  left: number
  top: number
  onDrag: (col: number, row: number) => void
  onReset: () => void
}): JSX.Element {
  const draggingRef = useRef(false)
  const [active, setActive] = useState(false)

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>): void {
    if (!draggingRef.current) return
    const el = gridRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const c = ratioFromPoint(rect, e.clientX, e.clientY, 'vertical')
    const r = ratioFromPoint(rect, e.clientX, e.clientY, 'horizontal')
    if (c !== null && r !== null) onDrag(c, r)
  }

  function endDrag(e: React.PointerEvent<HTMLDivElement>): void {
    if (!draggingRef.current) return
    draggingRef.current = false
    setActive(false)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }

  return (
    <div
      role="separator"
      aria-label="가운데 핸들 — 가로·세로 동시 크기 조절"
      tabIndex={-1}
      onPointerDown={(e) => {
        e.preventDefault()
        draggingRef.current = true
        setActive(true)
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={onReset}
      title="드래그하여 가로·세로 동시 조절 · 더블클릭으로 균등"
      style={{
        position: 'absolute',
        left: `${left * 100}%`,
        top: `${top * 100}%`,
        transform: 'translate(-50%, -50%)',
        width: 18,
        height: 18,
        borderRadius: '50%',
        zIndex: 2,
        cursor: 'move',
        background: tokens.color.accent,
        border: `2px solid ${tokens.color.bg}`,
        boxShadow: active
          ? `0 0 0 4px color-mix(in srgb, ${tokens.color.accent} 30%, transparent)`
          : '0 1px 4px rgba(0,0,0,0.4)',
        touchAction: 'none'
      }}
    />
  )
}
