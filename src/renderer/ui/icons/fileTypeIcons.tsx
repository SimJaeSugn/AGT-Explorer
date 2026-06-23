/**
 * 파일 유형/개발 언어 아이콘 — 아이콘 세트 "특징 강조형"(docs/temp 참조)을 그대로 옮긴다.
 *
 * 디자인 원칙(참조와 동일):
 *  - 종이(문서) 공통 베이스 제거. 파일 유형은 **고유 심볼 글리프를 전면**에, 틴트(반투명
 *    동일 색) 둥근 사각칩 안에 그린다.
 *  - 개발 언어는 글리프 대신 **명칭의 특징 알파벳 모노그램**(JS·TS·Py·Rs…)을 모노스페이스
 *    볼드로, 틴트 + 링(테두리) 사각칩 안에 그린다.
 *  - 팔레트: blue/amber/slate/emerald/teal/rose/violet/lime 8색.
 *
 * 패널 파일 목록(자세히 행·그리드 타일)에서 공용으로 쓴다. 폴더/드라이브는 별도 글리프
 * (glyphs.tsx)를 쓰므로 여기서 다루지 않는다.
 */

/** 참조 팔레트(특징 강조형). */
const P = {
  blue: '#6aa6f5',
  amber: '#e0a85b',
  slate: '#8a93a0',
  emerald: '#3ecf8e',
  teal: '#4fc7c7',
  rose: '#e08aa6',
  violet: '#b98ce0',
  lime: '#b5d65f'
} as const

/** #rrggbb + alpha → rgba() (칩 틴트/링 생성, 참조 hexA 동일). */
function hexA(hex: string, a: number): string {
  const m = hex.replace('#', '')
  const r = parseInt(m.slice(0, 2), 16)
  const g = parseInt(m.slice(2, 4), 16)
  const b = parseInt(m.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${a})`
}

// ── 카테고리 폴백 셋(개별 매핑에 없을 때) ────────────────────────────────
const EXEC_EXTS = new Set(['exe', 'msi', 'bat', 'cmd', 'com', 'app', 'appimage', 'deb', 'rpm'])
const ARCHIVE_EXTS = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz', 'zst', 'cab', 'iso'])
const CONFIG_EXTS = new Set(['yml', 'yaml', 'json', 'toml', 'ini', 'cfg', 'conf', 'env', 'lock', 'blockmap'])
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'ico', 'tif', 'tiff', 'heic'])
const VIDEO_EXTS = new Set(['mp4', 'mkv', 'mov', 'avi', 'webm', 'wmv', 'flv', 'm4v'])
const AUDIO_EXTS = new Set(['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma'])
const DOC_EXTS = new Set(['md', 'txt', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'csv', 'rtf', 'hwp'])

// ── 파일 유형: 확장자 → {글리프, 색} (참조 fileTypes + 확장자 별칭 확장) ──────
const FILE_TYPE_MAP: Record<string, { glyph: string; color: string }> = {
  // 실행 / 라이브러리
  exe: { glyph: 'app', color: P.blue }, msi: { glyph: 'app', color: P.blue }, com: { glyph: 'app', color: P.blue }, appimage: { glyph: 'app', color: P.blue },
  dll: { glyph: 'plug', color: P.blue }, so: { glyph: 'plug', color: P.blue }, dylib: { glyph: 'plug', color: P.blue },
  // 설정 / 데이터
  yaml: { glyph: 'gear', color: P.amber }, yml: { glyph: 'gear', color: P.amber }, toml: { glyph: 'gear', color: P.amber }, ini: { glyph: 'gear', color: P.amber }, cfg: { glyph: 'gear', color: P.amber }, conf: { glyph: 'gear', color: P.amber }, env: { glyph: 'gear', color: P.amber }, lock: { glyph: 'gear', color: P.amber },
  json: { glyph: 'braces', color: P.amber }, jsonc: { glyph: 'braces', color: P.amber },
  // 이미지 / 벡터
  svg: { glyph: 'vector', color: P.emerald },
  png: { glyph: 'image', color: P.emerald }, jpg: { glyph: 'image', color: P.emerald }, jpeg: { glyph: 'image', color: P.emerald }, gif: { glyph: 'image', color: P.emerald }, bmp: { glyph: 'image', color: P.emerald }, webp: { glyph: 'image', color: P.emerald }, ico: { glyph: 'image', color: P.emerald }, tif: { glyph: 'image', color: P.emerald }, tiff: { glyph: 'image', color: P.emerald }, heic: { glyph: 'image', color: P.emerald },
  // 미디어
  mp4: { glyph: 'video', color: P.rose }, mkv: { glyph: 'video', color: P.rose }, mov: { glyph: 'video', color: P.rose }, avi: { glyph: 'video', color: P.rose }, webm: { glyph: 'video', color: P.rose }, wmv: { glyph: 'video', color: P.rose }, flv: { glyph: 'video', color: P.rose }, m4v: { glyph: 'video', color: P.rose },
  mp3: { glyph: 'audio', color: P.violet }, wav: { glyph: 'audio', color: P.violet }, flac: { glyph: 'audio', color: P.violet }, aac: { glyph: 'audio', color: P.violet }, ogg: { glyph: 'audio', color: P.violet }, m4a: { glyph: 'audio', color: P.violet }, wma: { glyph: 'audio', color: P.violet },
  // 문서 / 텍스트
  pdf: { glyph: 'book', color: P.rose },
  txt: { glyph: 'text', color: P.slate },
  md: { glyph: 'md', color: P.teal }, markdown: { glyph: 'md', color: P.teal },
  doc: { glyph: 'book', color: P.slate }, docx: { glyph: 'book', color: P.slate }, rtf: { glyph: 'book', color: P.slate }, hwp: { glyph: 'book', color: P.slate }, odt: { glyph: 'book', color: P.slate },
  xls: { glyph: 'book', color: P.slate }, xlsx: { glyph: 'book', color: P.slate }, csv: { glyph: 'book', color: P.slate }, ppt: { glyph: 'book', color: P.slate }, pptx: { glyph: 'book', color: P.slate },
  // 압축 / 디스크 이미지
  zip: { glyph: 'archive', color: P.lime }, rar: { glyph: 'archive', color: P.lime }, '7z': { glyph: 'archive', color: P.lime }, tar: { glyph: 'archive', color: P.lime }, gz: { glyph: 'archive', color: P.lime }, tgz: { glyph: 'archive', color: P.lime }, bz2: { glyph: 'archive', color: P.lime }, xz: { glyph: 'archive', color: P.lime }, zst: { glyph: 'archive', color: P.lime }, cab: { glyph: 'archive', color: P.lime },
  iso: { glyph: 'disc', color: P.violet }, img: { glyph: 'disc', color: P.violet }, dmg: { glyph: 'disc', color: P.violet },
  // 기타
  map: { glyph: 'map', color: P.slate }, blockmap: { glyph: 'map', color: P.slate },
  log: { glyph: 'log', color: P.slate },
  db: { glyph: 'db', color: P.violet }, sqlite: { glyph: 'db', color: P.violet }, sqlite3: { glyph: 'db', color: P.violet },
  ttf: { glyph: 'font', color: P.teal }, otf: { glyph: 'font', color: P.teal }, woff: { glyph: 'font', color: P.teal }, woff2: { glyph: 'font', color: P.teal }
}

// ── 개발 언어: 확장자 → {모노그램 마크, 색} (참조 langTypes + 확장자 별칭 확장) ──
const LANG_MAP: Record<string, { mark: string; color: string }> = {
  js: { mark: 'JS', color: P.amber }, mjs: { mark: 'JS', color: P.amber }, cjs: { mark: 'JS', color: P.amber },
  ts: { mark: 'TS', color: P.blue },
  jsx: { mark: 'JSX', color: P.teal }, tsx: { mark: 'TSX', color: P.teal },
  html: { mark: 'Ht', color: P.rose }, htm: { mark: 'Ht', color: P.rose },
  css: { mark: 'Css', color: P.violet },
  scss: { mark: 'Sc', color: P.rose }, sass: { mark: 'Sc', color: P.rose }, less: { mark: 'Sc', color: P.rose },
  vue: { mark: 'Vue', color: P.emerald }, svelte: { mark: 'Sv', color: P.rose },
  py: { mark: 'Py', color: P.amber }, pyw: { mark: 'Py', color: P.amber },
  java: { mark: 'Jv', color: P.rose },
  kt: { mark: 'Kt', color: P.violet }, kts: { mark: 'Kt', color: P.violet },
  c: { mark: 'C', color: P.blue }, h: { mark: 'C', color: P.blue },
  cpp: { mark: 'C++', color: P.blue }, cc: { mark: 'C++', color: P.blue }, cxx: { mark: 'C++', color: P.blue }, hpp: { mark: 'C++', color: P.blue },
  cs: { mark: 'C#', color: P.violet },
  go: { mark: 'Go', color: P.teal },
  rs: { mark: 'Rs', color: P.rose },
  rb: { mark: 'Rb', color: P.rose },
  php: { mark: 'Php', color: P.violet },
  swift: { mark: 'Sw', color: P.rose },
  dart: { mark: 'Dt', color: P.teal },
  sql: { mark: 'Sql', color: P.amber },
  sh: { mark: 'Sh', color: P.slate }, bash: { mark: 'Sh', color: P.slate }, zsh: { mark: 'Sh', color: P.slate }
}

/**
 * 파일 유형 글리프 본문(24 viewBox·stroke). 참조 paintGlyphs() GL 과 동일. 일부 글리프는
 * `fill="currentColor"` 를 쓰므로 렌더 시 svg 의 CSS color 도 유형색으로 맞춘다.
 */
const GLYPH_BODIES: Record<string, string> = {
  app: '<rect x="3" y="4" width="18" height="16" rx="2.4"/><line x1="3" y1="9" x2="21" y2="9"/><circle cx="6" cy="6.5" r="0.6" fill="currentColor"/><circle cx="8.4" cy="6.5" r="0.6" fill="currentColor"/>',
  plug: '<path d="M9 3v4M15 3v4"/><rect x="7" y="7" width="10" height="6" rx="1.5"/><path d="M12 13v4a3 3 0 0 1-3 3H7"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 4.5v2M12 17.5v2M4.5 12h2M17.5 12h2M6.9 6.9l1.4 1.4M15.7 15.7l1.4 1.4M17.1 6.9l-1.4 1.4M8.3 15.7l-1.4 1.4"/>',
  braces: '<path d="M9 4c-1.8 0-2 1.5-2 4s-.6 3.5-2 4c1.4.5 2 1.5 2 4s.2 4 2 4"/><path d="M15 4c1.8 0 2 1.5 2 4s.6 3.5 2 4c-1.4.5-2 1.5-2 4s-.2 4-2 4"/>',
  vector: '<rect x="3" y="3" width="4" height="4" rx="1"/><rect x="17" y="3" width="4" height="4" rx="1"/><rect x="3" y="17" width="4" height="4" rx="1"/><rect x="17" y="17" width="4" height="4" rx="1"/><path d="M7 5h10M5 7v10M19 7v10M7 19h10"/>',
  image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.6"/><path d="M21 16l-5-5-4 4-2-2-4 4"/>',
  video: '<rect x="3" y="5" width="18" height="14" rx="2"/><polygon points="10 9 15 12 10 15" fill="currentColor" stroke="none"/>',
  audio: '<path d="M9 17V6l9-2v11"/><circle cx="6.5" cy="17" r="2.4"/><circle cx="15.5" cy="15" r="2.4"/>',
  book: '<path d="M6 4h10a2 2 0 0 1 2 2v14H8a2 2 0 0 1-2-2z"/><path d="M18 20H8a2 2 0 0 0-2 2"/><line x1="9.5" y1="9" x2="14.5" y2="9"/>',
  text: '<line x1="6" y1="7" x2="18" y2="7"/><line x1="6" y1="11" x2="18" y2="11"/><line x1="6" y1="15" x2="14" y2="15"/>',
  md: '<rect x="3" y="6" width="18" height="12" rx="1.6"/><path d="M6.5 15V9l2.5 3 2.5-3v6"/><path d="M16.5 9v4M14.5 12l2 2 2-2"/>',
  log: '<line x1="5" y1="7" x2="6.4" y2="7"/><line x1="8.5" y1="7" x2="18" y2="7"/><line x1="5" y1="11" x2="6.4" y2="11"/><line x1="8.5" y1="11" x2="18" y2="11"/><line x1="5" y1="15" x2="6.4" y2="15"/><line x1="8.5" y1="15" x2="14" y2="15"/>',
  archive: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M12 4v3M12 9v2M12 13v2"/><rect x="10.3" y="14" width="3.4" height="4" rx="1"/>',
  disc: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2"/>',
  map: '<polygon points="3 6 9 4 15 6 21 4 21 18 15 20 9 18 3 20"/><line x1="9" y1="4" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="20"/>',
  db: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.6 3.1 3 7 3s7-1.4 7-3V6"/><path d="M5 12v6c0 1.6 3.1 3 7 3s7-1.4 7-3v-6"/>',
  font: '<path d="M5 19l5.5-14h3L19 19"/><path d="M7.5 13h9"/>'
}

type ResolvedIcon =
  | { kind: 'lang'; mark: string; color: string }
  | { kind: 'glyph'; glyph: string; color: string }

/** 확장자 → 아이콘(언어 모노그램 우선 → 파일유형 글리프 → 카테고리 폴백). */
function resolveFileIcon(extRaw: string): ResolvedIcon {
  const ext = extRaw.toLowerCase()
  const lang = LANG_MAP[ext]
  if (lang) return { kind: 'lang', mark: lang.mark, color: lang.color }
  const ft = FILE_TYPE_MAP[ext]
  if (ft) return { kind: 'glyph', glyph: ft.glyph, color: ft.color }
  if (EXEC_EXTS.has(ext)) return { kind: 'glyph', glyph: 'app', color: P.blue }
  if (ARCHIVE_EXTS.has(ext)) return { kind: 'glyph', glyph: 'archive', color: P.lime }
  if (IMAGE_EXTS.has(ext)) return { kind: 'glyph', glyph: 'image', color: P.emerald }
  if (VIDEO_EXTS.has(ext)) return { kind: 'glyph', glyph: 'video', color: P.rose }
  if (AUDIO_EXTS.has(ext)) return { kind: 'glyph', glyph: 'audio', color: P.violet }
  if (CONFIG_EXTS.has(ext)) return { kind: 'glyph', glyph: 'gear', color: P.amber }
  if (DOC_EXTS.has(ext)) return { kind: 'glyph', glyph: 'book', color: P.slate }
  return { kind: 'glyph', glyph: 'text', color: P.slate }
}

/** 확장자 유형색만(타일 틴트·유형 라벨 색 공용). */
export function fileColorForExt(extRaw: string): string {
  return resolveFileIcon(extRaw).color
}

/** 파일 유형 글리프 1개를 유형색으로 그린다(참조 GL 동일·24 viewBox). */
function FileGlyphSvg({ glyph, size, color }: { glyph: string; size: number; color: string }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      // color: 일부 글리프의 fill="currentColor"(app 도트·video 삼각형)도 유형색으로.
      style={{ flex: 'none', display: 'block', color }}
      dangerouslySetInnerHTML={{ __html: GLYPH_BODIES[glyph] ?? GLYPH_BODIES.text }}
    />
  )
}

/** 모노그램 글자 수에 따른 폰트 크기(참조 28/21/17 비율 ≈ 0.52/0.39/0.30). */
function monoFontSize(mark: string, size: number): number {
  const n = mark.length
  const ratio = n >= 4 ? 0.3 : n === 3 ? 0.39 : 0.52
  return Math.max(7, Math.round(size * ratio))
}

/**
 * 파일 유형/개발 언어 아이콘(특징 강조형). 틴트 둥근 사각칩 안에 파일 유형은 고유 글리프를,
 * 개발 언어는 모노그램을 그린다(언어칩은 링 테두리 추가). 큰 그리드(showLabel)에서는 글리프
 * 아래에 확장자 라벨을 얹는다(언어는 모노그램이 곧 라벨이라 생략).
 */
export function FileTypeIcon({
  ext,
  size,
  showLabel
}: {
  ext: string
  size: number
  showLabel?: boolean
}): JSX.Element {
  const icon = resolveFileIcon(ext)
  const radius = Math.max(3, Math.round(size * 0.26))
  const label = ext ? ext.toUpperCase().slice(0, 4) : ''
  const withLabel = !!showLabel && icon.kind === 'glyph' && !!label
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: withLabel ? Math.round(size * 0.06) : 0,
        width: size,
        height: size,
        flex: 'none',
        boxSizing: 'border-box',
        borderRadius: radius,
        background: hexA(icon.color, 0.12),
        border: icon.kind === 'lang' ? `1px solid ${hexA(icon.color, 0.3)}` : 'none'
      }}
    >
      {icon.kind === 'lang' ? (
        <span
          style={{
            fontFamily: "'SFMono-Regular', ui-monospace, 'Menlo', monospace",
            fontWeight: 800,
            lineHeight: 1,
            letterSpacing: '-0.02em',
            color: icon.color,
            fontSize: monoFontSize(icon.mark, size)
          }}
        >
          {icon.mark}
        </span>
      ) : (
        <FileGlyphSvg
          glyph={icon.glyph}
          color={icon.color}
          size={Math.round(size * (withLabel ? 0.46 : 0.56))}
        />
      )}
      {withLabel && (
        <span
          style={{
            fontSize: Math.max(7, Math.round(size * 0.15)),
            fontWeight: 800,
            letterSpacing: '-0.2px',
            lineHeight: 1,
            color: icon.color
          }}
        >
          {label}
        </span>
      )}
    </span>
  )
}
