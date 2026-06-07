/**
 * ImagePreview — kind:'image' 렌더러 (US-4.3).
 *
 * 원본 바이트를 base64 data URL 로 받아 축소 표시(object-fit contain).
 * 대용량(>상한)으로 dataUrl 이 없으면 truncated 안내로 폴백한다.
 */
import type { PreviewData } from '@shared/dto'
import { tokens } from '@renderer/ui/theme/tokens'

export function ImagePreview({ data }: { data: PreviewData }): JSX.Element {
  if (!data.dataUrl) {
    return (
      <div style={{ padding: 16, color: tokens.color.textMuted, fontSize: 13 }}>
        원본이 커서 미리보기를 생략했습니다.
      </div>
    )
  }
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        padding: 12,
        background: tokens.color.bgAlt
      }}
    >
      <img
        src={data.dataUrl}
        alt={data.name}
        style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
      />
    </div>
  )
}
