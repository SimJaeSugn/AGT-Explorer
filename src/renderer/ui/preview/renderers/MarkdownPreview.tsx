/**
 * MarkdownPreview — kind:'text' + data.isMarkdown 마크다운 렌더러 (J6).
 *
 * marked 로 마크다운→HTML 파싱 후 **DOMPurify 로 새니타이즈(필수)** 한 뒤
 * dangerouslySetInnerHTML 로 주입한다. raw HTML 직접 주입 금지(XSS 방어).
 *
 * 보안(필수 게이트):
 *  - 항상 DOMPurify.sanitize 후 주입 — `<script>`·on* 핸들러·javascript: URL·
 *    원격 위험 요소 제거. CSP(`script-src 'self'`·`img-src 'self' data:`)가 2차 방어.
 *  - marked·DOMPurify 모두 eval/new Function 미사용 → CSP 호환.
 * 번들: marked·dompurify 는 동적 import(이 모듈 자체가 PreviewPanel 에서 React.lazy
 *  분리 → 별도 청크, 메인 진입 번들 미오염).
 */
import { useEffect, useRef, useState } from 'react'
import type { PreviewData } from '@shared/dto'
import { tokens } from '@renderer/ui/theme/tokens'

export default function MarkdownPreview({ data }: { data: PreviewData }): JSX.Element {
  const text = data.text ?? ''
  const [html, setHtml] = useState<string | null>(null)
  const reqRef = useRef(0)

  useEffect(() => {
    const seq = ++reqRef.current
    let cancelled = false
    void (async () => {
      const [{ marked }, DOMPurifyMod] = await Promise.all([
        import('marked'),
        import('dompurify')
      ])
      if (cancelled || seq !== reqRef.current) return
      const DOMPurify = DOMPurifyMod.default
      try {
        // marked 동기 파싱(async 비활성). 결과 raw HTML.
        const raw = marked.parse(text, { async: false }) as string
        // 필수: dangerouslySetInnerHTML 직전 항상 새니타이즈.
        const clean = DOMPurify.sanitize(raw)
        setHtml(clean)
      } catch {
        setHtml('')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [text])

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
      <div
        className="md-preview"
        style={{
          flex: 1,
          minHeight: 0,
          margin: 0,
          padding: 12,
          overflow: 'auto',
          fontSize: 13,
          lineHeight: 1.6,
          color: tokens.color.text,
          background: tokens.color.bg,
          wordBreak: 'break-word'
        }}
        // DOMPurify 로 새니타이즈된 안전한 HTML 만 주입(raw 금지).
        dangerouslySetInnerHTML={{ __html: html ?? '' }}
      />
    </div>
  )
}
