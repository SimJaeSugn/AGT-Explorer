/**
 * glyphs — 결정적 폴더/드라이브 인라인 SVG 아이콘(테마·OS·정션 환경 무관).
 *
 * OS 아이콘(app.getFileIcon)은 정션(재배치 AppData 등) 환경에서 폴더에 디스크/엉뚱한
 * 아이콘을 줘 공유 캐시를 오염시켰으므로, 폴더/드라이브는 이 결정적 글리프로 표준화한다.
 * 파일 목록(FileListView)·사이드바 트리(Sidebar)가 동일 글리프를 공유해 좌/우 패널 일관.
 */

/**
 * 폴더 아이콘 — 좌측 사이드바에서 쓰던 📁 이모지를 전체 공통으로 사용(사이드바·패널 일관).
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
        justifyContent: 'center'
      }}
      aria-hidden
    >
      <span style={{ fontSize: Math.round(size * 0.95), lineHeight: 1 }}>📁</span>
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

/** 회색 디스크/드라이브 SVG(드라이브 루트 항목 전용). */
export function DriveGlyph({ size }: { size: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      {/* 드라이브 본체(회색 라운드 박스) + 상태 표시등. */}
      <rect x="2.5" y="7" width="19" height="10" rx="1.8" fill="#CDD2D8" stroke="#9AA0A6" strokeWidth="0.6" />
      <rect x="2.5" y="12.4" width="19" height="4.6" rx="1.8" fill="#BCC2C9" />
      <circle cx="18.4" cy="14.7" r="1.05" fill="#5BC46A" />
      <rect x="5" y="14" width="6.5" height="1.4" rx="0.7" fill="#9AA0A6" />
    </svg>
  )
}
