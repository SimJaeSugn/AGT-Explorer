/**
 * CodePreview — kind:'text' + data.lang 코드 구문강조 렌더러 (J6).
 *
 * highlight.js 로 data.text 를 강조한다. 메인 청크 비대화 방지를 위해 highlight.js 는
 * **동적 import**(이 모듈 자체가 PreviewPanel 에서 React.lazy 로 분리됨 — 청크 격리).
 * highlight.js 코어(lib/core) + 공통 언어 세트(lib/common)만 사용(전체 import 금지).
 *
 * 보안: highlight.js 출력은 escape 된 토큰 span(자체 안전 마크업)이라 dangerouslySetInnerHTML
 * 사용 가능. eval/new Function 미사용(정적 토크나이저) → CSP `script-src 'self'` 호환.
 * 등록되지 않은/미상 언어는 highlightAuto 폴백(무오류).
 */
import { useEffect, useRef, useState } from 'react'
import type { PreviewData } from '@shared/dto'
import { tokens } from '@renderer/ui/theme/tokens'
// CSS 테마는 로컬 번들 import(CSP style-src 'self' 'unsafe-inline' OK).
import 'highlight.js/styles/github.css'

export default function CodePreview({ data }: { data: PreviewData }): JSX.Element {
  const text = data.text ?? ''
  const lang = data.lang
  const [html, setHtml] = useState<string | null>(null)
  const reqRef = useRef(0)

  useEffect(() => {
    const seq = ++reqRef.current
    let cancelled = false
    void (async () => {
      // highlight.js 공통 언어 세트만(전체 import 금지 — 트리셰이킹).
      const hljs = (await import('highlight.js/lib/common')).default
      if (cancelled || seq !== reqRef.current) return
      try {
        const out =
          lang && hljs.getLanguage(lang)
            ? hljs.highlight(text, { language: lang })
            : hljs.highlightAuto(text)
        setHtml(out.value)
      } catch {
        setHtml(null) // 강조 실패 → plain 폴백(아래 분기).
      }
    })()
    return () => {
      cancelled = true
    }
  }, [text, lang])

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
        {html !== null ? (
          // highlight.js 가 escape 한 안전한 토큰 마크업.
          <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <code>{text}</code>
        )}
      </pre>
    </div>
  )
}
