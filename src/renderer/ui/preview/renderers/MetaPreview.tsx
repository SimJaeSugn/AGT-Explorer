/**
 * MetaPreview — kind:'meta' 렌더러 (US-4.3).
 *
 * 미리보기 콘텐츠가 없는 형식(문서 등)의 기본 표시: 큰 아이콘 + 공통 메타 표.
 */
import type { PreviewData } from '@shared/dto'
import { tokens } from '@renderer/ui/theme/tokens'
import { MetaRows } from './metaRows'

export function MetaPreview({ data }: { data: PreviewData }): JSX.Element {
  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', paddingTop: 16 }}>
      <div style={{ textAlign: 'center', fontSize: 48, color: tokens.color.textMuted, marginBottom: 12 }}>
        📄
      </div>
      <MetaRows data={data} />
    </div>
  )
}
