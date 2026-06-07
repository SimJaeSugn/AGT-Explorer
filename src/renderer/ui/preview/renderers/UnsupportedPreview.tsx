/**
 * UnsupportedPreview — kind:'unsupported' 렌더러 (US-4.3).
 *
 * 미지원/바이너리/크기 초과 폴백: 아이콘 + 사유(reason) + 공통 메타 표.
 */
import type { PreviewData } from '@shared/dto'
import { tokens } from '@renderer/ui/theme/tokens'
import { MetaRows } from './metaRows'

export function UnsupportedPreview({ data }: { data: PreviewData }): JSX.Element {
  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', paddingTop: 16 }}>
      <div style={{ textAlign: 'center', fontSize: 48, color: tokens.color.textMuted, marginBottom: 4 }}>
        🗎
      </div>
      <div
        style={{
          textAlign: 'center',
          fontSize: 12,
          color: tokens.color.textMuted,
          marginBottom: 12
        }}
      >
        미리보기를 표시할 수 없습니다{data.reason ? ` (${data.reason})` : ''}.
      </div>
      <MetaRows data={data} />
    </div>
  )
}
