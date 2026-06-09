/**
 * SplitDivider — 분할 패널 사이 드래그 핸들(H-5).
 *
 * orientation(vertical|horizontal)만 받고 axis(col/row)는 모른다 — LayoutHost 가
 * §3.3 매핑(vertical→col, horizontal→row)으로 결정해 onDrag/onReset 콜백을 넘긴다.
 *
 * 측정 기준은 핸들의 DOM 부모가 아니라 LayoutHost 가 넘긴 containerRef(실제 분할
 * 컨테이너: 2분할=flex row/column, 4분할=grid 컨테이너)의 rect 다. 부모 래퍼
 * (display:contents 나 6px 오버레이)는 크기가 0/6px 라 비율이 망가지므로 컨테이너
 * rect 로만 계산한다(vertical→clientX/width, horizontal→clientY/height).
 *
 * 드래그: pointerdown → setPointerCapture → pointermove 에서 containerRef rect 로
 * 비율 계산 → onDrag(ratio). pointerup/capture loss 로 종료. 더블클릭 → onReset
 * (0.5 복귀). 클램프(0.15~0.85)는 setSplitRatio 가 1차로 담당한다.
 */
import { useRef, useState } from 'react'
import { tokens } from '@renderer/ui/theme/tokens'
import { ratioFromPoint } from '@renderer/ui/layout/splitMath'

interface SplitDividerProps {
  /** vertical=좌우 분할 핸들(세로 막대), horizontal=상하 분할 핸들(가로 막대). */
  readonly orientation: 'vertical' | 'horizontal'
  /**
   * 측정 기준이 되는 실제 분할 컨테이너(flex row/column 또는 grid)의 ref.
   * 핸들의 DOM 부모가 컨테이너가 아닐 수 있으므로 LayoutHost 가 명시적으로 넘긴다.
   */
  readonly containerRef: React.RefObject<HTMLElement>
  /** 컨테이너 기준 비율(0~1) — pointermove 중 setSplitRatio 로 전달된다. */
  onDrag(ratio: number): void
  /** 더블클릭 → 0.5 균등 복귀. */
  onReset(): void
}

export function SplitDivider({
  orientation,
  containerRef,
  onDrag,
  onReset
}: SplitDividerProps): JSX.Element {
  const vertical = orientation === 'vertical'
  const draggingRef = useRef(false)
  const [hover, setHover] = useState(false)
  const [dragging, setDragging] = useState(false)
  // 평상시 가는 선, 마우스 오버/드래그 중 굵고 강조색.
  const activeLine = hover || dragging
  const lineThickness = activeLine ? 3 : 1
  const lineColor = activeLine ? tokens.color.accent : tokens.color.border

  /** 분할 컨테이너 rect 기준 포인터 비율 산출(순수함수 위임). */
  function ratioFromEvent(e: React.PointerEvent<HTMLDivElement>): number | null {
    const container = containerRef.current
    if (!container) return null
    const rect = container.getBoundingClientRect()
    return ratioFromPoint(rect, e.clientX, e.clientY, orientation)
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>): void {
    e.preventDefault()
    draggingRef.current = true
    setDragging(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>): void {
    if (!draggingRef.current) return
    const ratio = ratioFromEvent(e)
    if (ratio !== null) onDrag(ratio)
  }

  function endDrag(e: React.PointerEvent<HTMLDivElement>): void {
    if (!draggingRef.current) return
    draggingRef.current = false
    setDragging(false)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  return (
    // 히트 영역은 잡기 쉽게 7px 유지(투명)·실제 경계선은 가운데 가는 선으로 표현한다.
    // 평상시 1px(border) → 마우스 오버/드래그 시 3px·accent 로 굵고 강조(즉시 시각 피드백).
    <div
      role="separator"
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      tabIndex={-1}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onDoubleClick={onReset}
      title="드래그하여 크기 조절 · 더블클릭으로 균등"
      style={{
        flex: '0 0 auto',
        alignSelf: 'stretch',
        width: vertical ? 7 : '100%',
        height: vertical ? '100%' : 7,
        cursor: vertical ? 'col-resize' : 'row-resize',
        background: 'transparent',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        touchAction: 'none',
        zIndex: 1,
        userSelect: 'none'
      }}
    >
      <div
        style={{
          width: vertical ? lineThickness : '100%',
          height: vertical ? '100%' : lineThickness,
          background: lineColor,
          // 굵기 변화가 위치를 흔들지 않도록 가운데 정렬(부모 flex center)·부드러운 전환.
          transition: 'background 80ms, width 80ms, height 80ms',
          pointerEvents: 'none'
        }}
      />
    </div>
  )
}
