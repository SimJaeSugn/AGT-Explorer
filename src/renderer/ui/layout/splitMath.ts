/**
 * splitMath — 분할 비율 산출 순수 함수(H-5, 단위테스트 가능 분리).
 *
 * SplitDivider 의 포인터→비율 변환 로직을 부수효과 없는 순수 함수로 분리한다.
 * 측정 기준은 항상 "분할 컨테이너"(flex row/column 또는 grid)의 rect 이며,
 * vertical=컨테이너 width 기준, horizontal=컨테이너 height 기준으로 연속 비율을
 * 낸다. 클램프(0.15~0.85)는 호출측 setSplitRatio 가 1차로 담당하므로 여기서는
 * raw 비율(범위밖 포함)을 그대로 반환한다 — 경계/범위밖 입력의 단위 검증 용이.
 *
 * rect 크기가 0 이하(측정 불가)면 null 을 돌려 호출측이 무동작 처리하게 한다.
 */

/** 분할 핸들 방향. vertical=좌우 분할(세로 막대), horizontal=상하 분할(가로 막대). */
export type SplitOrientation = 'vertical' | 'horizontal'

/**
 * 분할 컨테이너 rect 기준 포인터 위치의 raw 비율(0~1, 범위밖 가능).
 *
 * @param rect    분할 컨테이너(flex/grid)의 getBoundingClientRect 결과.
 * @param clientX 포인터 X(뷰포트 기준).
 * @param clientY 포인터 Y(뷰포트 기준).
 * @param orientation vertical→width 축, horizontal→height 축.
 * @returns 비율(클램프 안 함). 측정 불가(해당 축 크기 ≤ 0)면 null.
 */
export function ratioFromPoint(
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
  orientation: SplitOrientation
): number | null {
  if (orientation === 'vertical') {
    if (rect.width <= 0) return null
    return (clientX - rect.left) / rect.width
  }
  if (rect.height <= 0) return null
  return (clientY - rect.top) / rect.height
}
