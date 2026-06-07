/**
 * TextPreview — kind:'text' 렌더러 + 2차 분기 (US-4.3, J6).
 *
 * data.isMarkdown → MarkdownPreview(마크다운 렌더), data.lang → CodePreview(구문강조),
 * 아니면 기존 plain <pre>. Markdown/Code 렌더러는 **React.lazy 동적 import**로
 * 별도 청크 분리(highlight.js/marked/dompurify 가 메인 진입 번들에 포함되지 않도록 —
 * DashboardModalBody lazy 선례 동형). 레지스트리(PREVIEW_RENDERERS)는 kind 단위 안정 유지.
 */
import { lazy, Suspense } from 'react'
import type { PreviewData } from '@shared/dto'
import { tokens } from '@renderer/ui/theme/tokens'

const CodePreview = lazy(() => import('./CodePreview'))
const MarkdownPreview = lazy(() => import('./MarkdownPreview'))

function LazyFallback(): JSX.Element {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: tokens.color.textMuted,
        fontSize: 13
      }}
    >
      미리보기를 불러오는 중…
    </div>
  )
}

export function TextPreview({ data }: { data: PreviewData }): JSX.Element {
  if (data.isMarkdown) {
    return (
      <Suspense fallback={<LazyFallback />}>
        <MarkdownPreview data={data} />
      </Suspense>
    )
  }
  if (data.lang) {
    return (
      <Suspense fallback={<LazyFallback />}>
        <CodePreview data={data} />
      </Suspense>
    )
  }
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
