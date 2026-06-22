/**
 * glyphs — 결정적 폴더/드라이브 인라인 SVG 아이콘(테마·OS·정션 환경 무관).
 *
 * OS 아이콘(app.getFileIcon)은 정션(재배치 AppData 등) 환경에서 폴더에 디스크/엉뚱한
 * 아이콘을 줘 공유 캐시를 오염시켰으므로, 폴더/드라이브는 이 결정적 글리프로 표준화한다.
 * 파일 목록(FileListView)·사이드바 트리(Sidebar)가 동일 글리프를 공유해 좌/우 패널 일관.
 */
import { Icon } from '@renderer/ui/icons/lucide'
import { tokens } from '@renderer/ui/theme/tokens'

/**
 * 폴더 아이콘 — "파일 탐색기 아이콘 팩"의 모노라인 폴더 글리프(currentColor=folder 토큰).
 * 사이드바 트리·파일 목록·OS 아이콘 폴백이 같은 팩 글리프를 공유한다.
 * link=true 면 좌하단 바로가기 화살표(↗) 배지(링크/정션 폴더).
 */
export function FolderGlyph({ size, link }: { size: number; link?: boolean }): JSX.Element {
  const badge = Math.max(8, Math.round(size * 0.55))
  return (
    <span
      style={{
        position: 'relative',
        display: 'inline-flex',
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
        color: tokens.color.folder
      }}
      aria-hidden
    >
      <Icon name="folder" size={size} stroke={1.6} />
      {link && (
        <span
          title="링크(바로가기) 폴더"
          style={{
            position: 'absolute',
            left: -2,
            bottom: -2,
            width: badge,
            height: badge,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#fff',
            border: '1px solid rgba(0,0,0,0.4)',
            borderRadius: 2,
            color: '#1a73e8',
            fontSize: Math.max(7, Math.round(badge * 0.78)),
            lineHeight: 1,
            fontWeight: 800
          }}
        >
          ↗
        </span>
      )}
    </span>
  )
}

/** 드라이브/루트 글리프 — 아이콘 팩의 "루트/드라이브"(폴더+상향 표식, 모노라인). */
export function DriveGlyph({ size }: { size: number }): JSX.Element {
  return (
    <span style={{ display: 'inline-flex', color: tokens.color.folder }} aria-hidden>
      <Icon name="drive" size={size} stroke={1.6} />
    </span>
  )
}
