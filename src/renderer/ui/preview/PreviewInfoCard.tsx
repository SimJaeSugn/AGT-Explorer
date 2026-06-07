/**
 * PreviewInfoCard — 미리보기 상단 정보 카드 (J6).
 *
 * 이름·크기·형식·수정일·경로를 2열(라벨·값) 표로 표시한다. PreviewData 가 있으면
 * 그 메타를, 없으면(로딩 전) path 기반 최소 표기. tokens 사용·테마 호환.
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

function baseName(p: string): string {
  const norm = p.replace(/[\\/]+$/, '')
  const i = Math.max(norm.lastIndexOf('\\'), norm.lastIndexOf('/'))
  return i >= 0 ? norm.slice(i + 1) : norm
}

function kindLabel(data: PreviewData): string {
  if (data.ext) return data.ext.toUpperCase()
  return data.kind === 'image' ? '이미지' : data.kind === 'text' ? '텍스트' : '파일'
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  padding: '3px 0',
  fontSize: 12
}

const keyStyle: React.CSSProperties = {
  flex: '0 0 52px',
  color: tokens.color.textMuted
}

const valStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  wordBreak: 'break-all',
  color: tokens.color.text
}

export function PreviewInfoCard({
  data,
  path
}: {
  data: PreviewData | null
  path: string | null
}): JSX.Element | null {
  if (!data && path === null) return null
  const name = data ? data.name : path !== null ? baseName(path) : ''
  const fullPath = data ? data.path : (path ?? '')

  return (
    <div
      style={{
        flex: '0 0 auto',
        padding: '8px 12px',
        borderBottom: `1px solid ${tokens.color.border}`,
        background: tokens.color.bgAlt
      }}
      aria-label="파일 정보"
    >
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: tokens.color.text,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          marginBottom: 4
        }}
        title={name}
      >
        {name}
      </div>
      {data && (
        <>
          <div style={rowStyle}>
            <span style={keyStyle}>크기</span>
            <span style={valStyle}>{formatBytes(data.size)}</span>
          </div>
          <div style={rowStyle}>
            <span style={keyStyle}>형식</span>
            <span style={valStyle}>{kindLabel(data)}</span>
          </div>
          <div style={rowStyle}>
            <span style={keyStyle}>수정일</span>
            <span style={valStyle}>{formatMtime(data.mtime)}</span>
          </div>
        </>
      )}
      <div style={rowStyle}>
        <span style={keyStyle}>경로</span>
        <span style={valStyle} title={fullPath}>
          {fullPath}
        </span>
      </div>
    </div>
  )
}
