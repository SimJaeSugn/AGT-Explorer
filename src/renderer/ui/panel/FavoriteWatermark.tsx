/**
 * FavoriteWatermark — 즐겨찾기 경로 배경 워터마크 (§N N1·US-13.1·F17).
 *
 * 현재 패널 경로가 즐겨찾기와 정확 일치하면(domain/rules/favoriteWatermark)
 * 패널 본문 영역 배경에 즐겨찾기 이름(별칭/basename)을 크고 반투명하게 깐다.
 *
 * 접근성·비파괴(설계 §5-N.1):
 *   - position:absolute(inset:0) — Panel 컨테이너(position:relative)에 갇힘.
 *   - 파일 목록(FileListView)보다 **낮은 z-index** → 본문이 항상 워터마크 위.
 *   - pointer-events:none(클릭·박스선택·D&D 무간섭)·aria-hidden(접근성 트리 제외)·
 *     userSelect:none. 본문 위 비중첩 장식이라 WCAG 대비 게이트 비대상.
 *   - 테마별 반투명도/글자색 토큰(라이트/다크/시스템 resolved/블루라이트).
 *   - 긴 이름은 ellipsis(가로 넘침 없음).
 *
 * 1차 기본값: 항상 표시(토글 없음). 자기 패널 path + favorites/favoriteLabels 만 구독.
 */
import { useMemo } from 'react'
import { useRootStore } from '@renderer/app/stores/rootStore'
import { resolveFavoriteWatermark } from '@renderer/domain/rules/favoriteWatermark'
import { tokens } from '@renderer/ui/theme/tokens'

interface Props {
  readonly panelId: string
}

export function FavoriteWatermark({ panelId }: Props): JSX.Element | null {
  const path = useRootStore((s) => s.panels[panelId]?.path ?? '')
  const favorites = useRootStore((s) => s.favorites)
  const favoriteLabels = useRootStore((s) => s.favoriteLabels)

  // 파생 메모이즈: favorites 는 저빈도 갱신(SW §5.2)이라 비용 무시 가능.
  const result = useMemo(
    () => resolveFavoriteWatermark(path, favorites, favoriteLabels),
    [path, favorites, favoriteLabels]
  )

  if (!result.match) return null

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
        userSelect: 'none',
        overflow: 'hidden',
        padding: '0 24px',
        boxSizing: 'border-box'
      }}
    >
      <span
        style={{
          maxWidth: '100%',
          fontSize: 'clamp(14px, 3.2vw, 40px)',
          fontWeight: 800,
          letterSpacing: '0.02em',
          color: tokens.color.watermark,
          opacity: tokens.watermarkOpacity,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          lineHeight: 1.1
        }}
      >
        {result.text}
      </span>
    </div>
  )
}
