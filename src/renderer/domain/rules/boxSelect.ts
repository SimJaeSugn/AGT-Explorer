/**
 * 박스 선택(러버밴드) 기하 규칙 (renderer/domain/rules/boxSelect) — 순수 함수 (J1).
 *
 * FileListView 의 빈 영역 드래그로 그린 사각형과 교차하는 항목 인덱스를 산출한다.
 * 기하 계산은 **전체 항목 인덱스**에 대해 수행한다(DOM 미렌더 행도 선택 대상 —
 * 가상 스크롤 1만 행 정합). 좌표는 스크롤 컨테이너 내부 콘텐츠 좌표계(scrollTop 포함).
 *
 * list/details 는 colCount=1, cellW=뷰포트폭. 그리드는 colCount>1.
 */

export interface Rect {
  readonly top: number
  readonly left: number
  readonly bottom: number
  readonly right: number
}

/** 시작점·현재점 두 점에서 정규화된 사각형(top<bottom, left<right)을 만든다. */
export function normalizeRect(ax: number, ay: number, bx: number, by: number): Rect {
  return {
    top: Math.min(ay, by),
    bottom: Math.max(ay, by),
    left: Math.min(ax, bx),
    right: Math.max(ax, bx)
  }
}

/** 셀(top,left,h,w)이 사각형과 교차하는지(AABB 겹침). */
export function intersectsCell(
  rect: Rect,
  cellTop: number,
  cellLeft: number,
  cellH: number,
  cellW: number
): boolean {
  const cellBottom = cellTop + cellH
  const cellRight = cellLeft + cellW
  return (
    cellLeft < rect.right &&
    cellRight > rect.left &&
    cellTop < rect.bottom &&
    cellBottom > rect.top
  )
}

/**
 * 사각형과 교차하는 항목 인덱스 집합(전체 인덱스 기하 계산 — 윈도잉 무관).
 * 항목 i 의 위치: row=floor(i/col), col=i%col → (row*cellH, col*cellW).
 */
export function indicesInRect(
  rect: Rect,
  opts: { colCount: number; cellH: number; cellW: number; count: number }
): number[] {
  const { colCount, cellH, cellW, count } = opts
  const out: number[] = []
  if (colCount < 1 || cellH <= 0 || count <= 0) return out

  // 교차 가능한 row 범위만 훑어 비용을 줄인다.
  const firstRow = Math.max(0, Math.floor(rect.top / cellH))
  const lastRow = Math.floor((rect.bottom - 1) / cellH)
  for (let row = firstRow; row <= lastRow; row++) {
    const cellTop = row * cellH
    for (let col = 0; col < colCount; col++) {
      const i = row * colCount + col
      if (i >= count) break
      const cellLeft = col * cellW
      if (intersectsCell(rect, cellTop, cellLeft, cellH, cellW)) out.push(i)
    }
  }
  return out
}
