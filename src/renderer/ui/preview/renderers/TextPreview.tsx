/**
 * TextPreview — kind:'text' 렌더러 (US-4.3).
 *
 * 앞부분 텍스트를 monospace <pre> 로 표시(스크롤). truncated 면 "앞부분만 표시" 배지.
 */
import type { PreviewData } from '@shared/dto'
import { tokens } from '@renderer/ui/theme/tokens'

export function TextPreview({ data }: { data: PreviewData }): JSX.Element {
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {data.truncated && (
        <div
          style={{
            flex: '0 0 auto',
            padding: '4px 10px',
            fontSize: 11,
            color: tokens.color.textMuted,
            borderBottom: `1px solid ${tokens.color.border}`
          }}
        >
          앞부분만 표시(파일이 커서 전체가 아닙니다).
        </div>
      )}
      <pre
        style={{
          flex: 1,
          minHeight: 0,
          margin: 0,
          padding: 10,
          overflow: 'auto',
          fontFamily: 'monospace',
          fontSize: 12,
          lineHeight: 1.5,
          whiteSpace: 'pre',
          color: tokens.color.text,
          background: tokens.color.bg
        }}
      >
        {data.text ?? ''}
      </pre>
    </div>
  )
}
