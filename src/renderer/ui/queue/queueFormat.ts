/**
 * 전송 큐 표시 포맷 헬퍼 (ui/queue/queueFormat) — 순수 함수 (§R3·US-17.3).
 *
 * QueueItemDTO 의 종류·상태를 한글 라벨로, 속도/ETA 를 사람이 읽는 문자열로 변환한다.
 * StatusBar·QueuePanel 공유. tokens 색상 키만 반환(컴포넌트가 실제 색 적용).
 */
import type { QueueItemKind, QueueItemStatus } from '@shared/dto'

/** 큐 항목 종류 → 한글 라벨. */
export function kindLabel(kind: QueueItemKind): string {
  switch (kind) {
    case 'copy':
      return '복사'
    case 'move':
      return '이동'
    case 'delete':
      return '삭제'
    case 'trash':
      return '휴지통 이동'
    case 'remote-download':
      return '다운로드'
    case 'remote-upload':
      return '업로드'
    default:
      return '작업'
  }
}

/** 큐 항목 상태 → 한글 라벨. */
export function statusLabel(status: QueueItemStatus): string {
  switch (status) {
    case 'pending':
      return '대기'
    case 'running':
      return '진행 중'
    case 'paused':
      return '일시정지'
    case 'done':
      return '완료'
    case 'failed':
      return '실패'
    case 'canceled':
      return '취소됨'
    default:
      return ''
  }
}

/** 상태 → tokens 색상 키(컴포넌트가 tokens.color[key] 로 적용). */
export function statusColorKey(status: QueueItemStatus): 'accent' | 'danger' | 'textMuted' | 'text' {
  switch (status) {
    case 'running':
      return 'accent'
    case 'failed':
      return 'danger'
    case 'paused':
    case 'pending':
    case 'canceled':
      return 'textMuted'
    default:
      return 'text'
  }
}

/** 초당 바이트 → "12.3 MB/s". 0/유효하지 않으면 빈 문자열. */
export function formatSpeed(bytesPerSec: number): string {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return ''
  const b = bytesPerSec
  if (b < 1024) return `${Math.round(b)} B/s`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB/s`
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB/s`
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB/s`
}

/** 남은 초 → "약 1분 20초" / "약 45초". null/0 이하면 빈 문자열. */
export function formatEta(etaSec: number | null): string {
  if (etaSec === null || !Number.isFinite(etaSec) || etaSec <= 0) return ''
  const sec = Math.round(etaSec)
  if (sec < 60) return `약 ${sec}초`
  const m = Math.floor(sec / 60)
  const r = sec % 60
  return r > 0 ? `약 ${m}분 ${r}초` : `약 ${m}분`
}

/** 진행률 0~1(totalBytes 우선·없으면 items 기준). 산출 불가 시 0. */
export function progressRatio(processed: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0
  const r = processed / total
  if (!Number.isFinite(r)) return 0
  return Math.max(0, Math.min(1, r))
}
