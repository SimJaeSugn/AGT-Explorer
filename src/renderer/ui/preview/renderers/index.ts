/**
 * 미리보기 렌더러 레지스트리 (SW §9 형식별 등록 격리 경계).
 *
 * PreviewData.kind → 렌더러 컴포넌트 매핑. PreviewPanel 이 이 맵을 조회해
 * 형식별 렌더러를 디스패치한다. 새 형식 추가는 여기 한 곳만 확장한다.
 */
import type { PreviewData, PreviewKind } from '@shared/dto'
import { ImagePreview } from './ImagePreview'
import { TextPreview } from './TextPreview'
import { MetaPreview } from './MetaPreview'
import { UnsupportedPreview } from './UnsupportedPreview'

export type PreviewRenderer = (props: { data: PreviewData }) => JSX.Element

export const PREVIEW_RENDERERS: Record<PreviewKind, PreviewRenderer> = {
  image: ImagePreview,
  text: TextPreview,
  meta: MetaPreview,
  unsupported: UnsupportedPreview
}
