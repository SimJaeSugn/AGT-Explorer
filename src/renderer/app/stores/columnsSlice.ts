/**
 * columnsSlice — 자세히(details) 보기 열 너비 (SA §5.2, 저빈도·전역).
 *
 * 자세히 보기 헤더에서 드래그로 조절하는 고정폭 열(크기/유형/수정한 날짜)의 너비를
 * 보유한다. **전역 설정**(패널·탭별이 아님) — 모든 패널의 자세히 보기가 같은 폭을 쓴다.
 * 이름(name) 열은 남은 공간을 flex 로 채우므로 저장 폭이 없다.
 *
 * 영속: buildSessionSnapshot 이 ui.detailsColumnWidths 로 직렬화하고 applySnapshot 이
 * hydrate 한다(스키마 버전 미상향 — coerce 폴백). 클램프/정규화 단일 출처는
 * domain/rules/columnWidths(순수 함수).
 */
import {
  clampColumnWidth,
  coerceDetailsColumnWidths,
  DEFAULT_DETAILS_COLUMN_WIDTHS,
  type DetailsColumn,
  type DetailsColumnWidths
} from '@renderer/domain/rules/columnWidths'
import type { SliceCreator } from './types'

export interface ColumnsSlice {
  /** 자세히 보기 고정폭 열 너비(px). 이름 열은 flex → 저장 폭 없음(전역 설정). */
  readonly detailsColumnWidths: DetailsColumnWidths

  /** 열 1개의 너비 설정(드래그/키보드 리사이즈). clampColumnWidth 로 클램프. */
  setDetailsColumnWidth(col: DetailsColumn, px: number): void
  /** 세션 복원: 열 너비 일괄 주입(coerce 로 정규화 후 적용). */
  hydrateColumns(widths: unknown): void
}

export const createColumnsSlice: SliceCreator<ColumnsSlice> = (set) => ({
  detailsColumnWidths: { ...DEFAULT_DETAILS_COLUMN_WIDTHS },

  setDetailsColumnWidth(col, px) {
    set((s) => {
      s.detailsColumnWidths[col] = clampColumnWidth(px)
    })
  },

  hydrateColumns(widths) {
    const next = coerceDetailsColumnWidths(widths)
    set((s) => {
      s.detailsColumnWidths = next
    })
  }
})
