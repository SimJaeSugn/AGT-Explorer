/**
 * 대시보드 표시용 포맷 헬퍼 (I장). 순수 함수 — 차트·표·인사이트 카드 공유.
 */

/** 바이트 → 사람이 읽는 단위(StatusBar 와 동형 규칙). */
export function formatBytes(b: number): string {
  if (!Number.isFinite(b) || b < 0) return '—'
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`
  if (b < 1024 * 1024 * 1024 * 1024) return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`
  return `${(b / 1024 / 1024 / 1024 / 1024).toFixed(2)} TB`
}

/** 0~100 백분율 문자열(소수 1자리). */
export function formatPct(ratio: number): string {
  if (!Number.isFinite(ratio)) return '—'
  return `${(ratio * 100).toFixed(1)}%`
}

/** 정수 천단위 구분. */
export function formatCount(n: number): string {
  return n.toLocaleString()
}
