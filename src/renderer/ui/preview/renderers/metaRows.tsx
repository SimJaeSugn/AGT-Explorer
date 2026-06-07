/**
 * metaRows — 미리보기 공통 메타 표(이름·경로·크기·수정일) (US-4.3).
 *
 * MetaPreview·UnsupportedPreview 가 공유한다(중복 제거).
 */
import type { PreviewData } from '@shared/dto'
import { tokens } from '@renderer/ui/theme/tokens'

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`
  return `${(b / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function formatMtime(ms: number): string {
  if (!ms) return '-'
  try {
    return new Date(ms).toLocaleString()
  } catch {
    return '-'
  }
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  padding: '4px 0',
  fontSize: 12,
  borderBottom: `1px solid ${tokens.color.border}`
}

const keyStyle: React.CSSProperties = {
  flex: '0 0 64px',
  color: tokens.color.textMuted
}

const valStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  wordBreak: 'break-all',
  color: tokens.color.text
}

/** 공통 메타 표를 렌더한다. */
export function MetaRows({ data }: { data: PreviewData }): JSX.Element {
  return (
    <div style={{ padding: '0 14px' }}>
      <div style={rowStyle}>
        <span style={keyStyle}>이름</span>
        <span style={valStyle}>{data.name}</span>
      </div>
      <div style={rowStyle}>
        <span style={keyStyle}>경로</span>
        <span style={valStyle}>{data.path}</span>
      </div>
      <div style={rowStyle}>
        <span style={keyStyle}>크기</span>
        <span style={valStyle}>{formatBytes(data.size)}</span>
      </div>
      <div style={rowStyle}>
        <span style={keyStyle}>수정일</span>
        <span style={valStyle}>{formatMtime(data.mtime)}</span>
      </div>
    </div>
  )
}
