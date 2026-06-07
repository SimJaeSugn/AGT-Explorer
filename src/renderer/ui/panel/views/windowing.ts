/**
 * windowing — FileListView 가상 스크롤 윈도잉 순수 함수 (P7-C, ADR-004 / SA §6).
 *
 * FileListView 의 윈도잉 산식(고정 행높이)을 부수효과 없는 순수 함수로 추출한다.
 * 1만 항목이어도 렌더 후보가 `(viewportH/cellH + 2·overscan)·colCount` 이내 상수임을
 * 헤드리스 verify(qa verify-perf)로 보증하기 위함이다.
 *
 * **회귀 0 원칙**: FileListView L163-172 의 기존 산식을 그대로 옮긴다(동작 불변).
 *   - grid: colCount = max(1, floor(viewportW / cellW)), cellH = 셀 높이.
 *   - list/details: colCount = 1, cellH = rowHeight.
 *
 * 순수 데이터 계산만(React/DOM 비의존).
 */

/** computeWindow 입력. */
export interface WindowInput {
  /** 스크롤 컨테이너 scrollTop(px). */
  readonly scrollTop: number
  /** 가시 영역 높이(px). */
  readonly viewportH: number
  /** 한 셀(행) 높이(px). grid=셀높이, list/details=rowHeight. */
  readonly cellH: number
  /** 열 수(grid=계산값, list/details=1). */
  readonly colCount: number
  /** 전체 항목 수(visible.length). */
  readonly count: number
  /** 가시 영역 위·아래로 추가 렌더할 행 수. */
  readonly overscan: number
}

/** computeWindow 출력(렌더 윈도 + 전체 높이). */
export interface WindowResult {
  /** 렌더 시작 항목 인덱스(포함). */
  readonly startIdx: number
  /** 렌더 끝 항목 인덱스(미포함, exclusive). */
  readonly endIdx: number
  /** 콘텐츠 전체 높이(px) — 스크롤 영역 산정용. */
  readonly totalHeight: number
  /** 렌더 시작 행. */
  readonly startRow: number
  /** 렌더 끝 행(미포함). */
  readonly endRow: number
  /** 전체 행 수(ceil(count / colCount)). */
  readonly rowCount: number
}

/**
 * 가시 영역 + 오버스캔으로 렌더할 항목 범위와 콘텐츠 높이를 계산한다.
 *
 * FileListView 의 기존 산식과 정확히 동일:
 * ```
 * rowCount   = ceil(count / colCount)
 * totalHeight= rowCount * cellH
 * startRow   = max(0, floor(scrollTop / cellH) - overscan)
 * endRow     = min(rowCount, ceil((scrollTop + viewportH) / cellH) + overscan)
 * startIdx   = startRow * colCount
 * endIdx     = min(count, endRow * colCount)
 * ```
 */
export function computeWindow(input: WindowInput): WindowResult {
  const { scrollTop, viewportH, cellH, colCount, count, overscan } = input
  const rowCount = Math.ceil(count / colCount)
  const totalHeight = rowCount * cellH
  const startRow = Math.max(0, Math.floor(scrollTop / cellH) - overscan)
  const endRow = Math.min(rowCount, Math.ceil((scrollTop + viewportH) / cellH) + overscan)
  const endIdx = Math.min(count, endRow * colCount)
  // scrollTop 이 콘텐츠 높이를 넘으면(프로그램적 복원·필터로 count 축소 등) startRow·colCount
  // 곱이 endIdx 를 초과해 음수 윈도가 될 수 있다 → endIdx 로 클램프(빈 윈도, 불변식 startIdx≤endIdx 보장).
  // 정상 스크롤 범위에서는 startRow*colCount ≤ endIdx 이므로 no-op(회귀 0).
  const startIdx = Math.min(startRow * colCount, endIdx)
  return { startIdx, endIdx, totalHeight, startRow, endRow, rowCount }
}
