/**
 * 아이콘 팩 (renderer/ui/icons) — "파일 탐색기 아이콘 세트"(claude.ai/design) 모노라인 24px.
 *
 * 디자인 팩의 정확한 path 데이터를 ICON_PATHS 에 담고, 범용 <Icon name> 컴포넌트가
 * 24 viewBox · stroke 1.8 · currentColor · 둥근 캡/조인으로 렌더한다. 모든 크롬(탭바·
 * 아이콘바·사이드바·툴바·상태바)과 파일 목록 폴더/파일 타일이 이 한 벌을 공유한다.
 *
 * 기존 컴포넌트 호환을 위해 이름별 export(ArrowLeftIcon 등)는 팩 아이콘을 감싼
 * 얇은 래퍼로 유지한다 — 호출부 수정 없이 팩 path 로 교체된다.
 */
import type { CSSProperties } from 'react'

export interface IconProps {
  /** 픽셀 크기(정사각). 기본 16. */
  readonly size?: number
  /** 선 굵기. 기본 1.8(팩 톤). */
  readonly stroke?: number
  /** 추가 인라인 스타일. */
  readonly style?: CSSProperties
}

/**
 * 아이콘 팩 path 데이터(내부 SVG 마크업 문자열). 디자인 팩 paintIcons()/디렉토리
 * 섹션에서 그대로 추출했다. 팩에 없는 크롬 필수 아이콘(monitor·clock 등)은 동일 톤으로 보강.
 */
export const ICON_PATHS: Record<string, string> = {
  // ── 탐색/액션(팩 38종) ───────────────────────────────────────────────
  back: '<path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/>',
  forward: '<path d="M5 12h14"/><path d="M12 5l7 7-7 7"/>',
  up: '<path d="M12 19V5"/><path d="M5 12l7-7 7 7"/>',
  refresh: '<path d="M21 3v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 9"/><path d="M3 21v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 15"/>',
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M9.5 20v-6h5v6"/>',
  search: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/>',
  newFolder: '<path d="M3 7a2 2 0 0 1 2-2h3.4l1.8 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><line x1="12" y1="10.6" x2="12" y2="16"/><line x1="9.5" y1="13.3" x2="14.5" y2="13.3"/>',
  newFile: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><line x1="12" y1="12" x2="12" y2="17"/><line x1="9.5" y1="14.5" x2="14.5" y2="14.5"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5V4.5A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5"/>',
  cut: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><line x1="8.2" y1="7.4" x2="20" y2="16"/><line x1="8.2" y1="16.6" x2="20" y2="8"/>',
  paste: '<path d="M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1z"/><path d="M16 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2"/>',
  delete: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
  rename: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  sort: '<line x1="4" y1="6" x2="13" y2="6"/><line x1="4" y1="12" x2="11" y2="12"/><line x1="4" y1="18" x2="9" y2="18"/><path d="M17 4v14"/><path d="M14 15l3 3 3-3"/>',
  filter: '<polygon points="3 4 21 4 14 12 14 19 10 21 10 12"/>',
  listView: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1.1"/><circle cx="4" cy="12" r="1.1"/><circle cx="4" cy="18" r="1.1"/>',
  gridView: '<rect x="3" y="3" width="7" height="7" rx="1.4"/><rect x="14" y="3" width="7" height="7" rx="1.4"/><rect x="3" y="14" width="7" height="7" rx="1.4"/><rect x="14" y="14" width="7" height="7" rx="1.4"/>',
  splitView: '<rect x="3" y="4" width="18" height="16" rx="2"/><line x1="12" y1="4" x2="12" y2="20"/>',
  quadSplit: '<rect x="3" y="4" width="18" height="16" rx="2"/><line x1="12" y1="4" x2="12" y2="20"/><line x1="3" y1="12" x2="21" y2="12"/>',
  panelLeft: '<rect x="3" y="4" width="18" height="16" rx="2"/><rect x="4" y="5" width="5" height="14" fill="currentColor" opacity="0.16" stroke="none"/><line x1="9" y1="4" x2="9" y2="20"/>',
  panelRight: '<rect x="3" y="4" width="18" height="16" rx="2"/><rect x="15" y="5" width="5" height="14" fill="currentColor" opacity="0.16" stroke="none"/><line x1="15" y1="4" x2="15" y2="20"/>',
  panelBottom: '<rect x="3" y="4" width="18" height="16" rx="2"/><rect x="4" y="14" width="16" height="5" fill="currentColor" opacity="0.16" stroke="none"/><line x1="3" y1="14" x2="21" y2="14"/>',
  preview: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="2.6"/>',
  star: '<path d="M12 2.5l2.95 6.36 6.8.84-5.02 4.64 1.33 6.66L12 17.7 5.94 21l1.33-6.66L2.25 9.7l6.8-.84z"/>',
  share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><line x1="8.2" y1="10.9" x2="15.8" y2="6.1"/><line x1="8.2" y1="13.1" x2="15.8" y2="17.9"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 9 12 4 17 9"/><line x1="12" y1="4" x2="12" y2="15"/>',
  compress: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v2M12 8v2M12 12v1.5"/><rect x="10.3" y="13.5" width="3.4" height="4" rx="1"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  settings: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1.5" y1="14" x2="6.5" y2="14"/><line x1="9.5" y1="8" x2="14.5" y2="8"/><line x1="17.5" y1="16" x2="22.5" y2="16"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><polyline points="7 9 10 12 7 15"/><line x1="12" y1="15" x2="16" y2="15"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
  compare: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M6 8.5v5a2.5 2.5 0 0 0 2.5 2.5H12"/><polyline points="10 14 12.5 16.5 10 19"/><path d="M18 15.5v-5A2.5 2.5 0 0 0 15.5 8H12"/><polyline points="14 10.5 11.5 8 14 5.5"/>',
  detailView: '<rect x="3" y="5" width="6.5" height="6.5" rx="1.2"/><line x1="12" y1="6.5" x2="21" y2="6.5"/><line x1="12" y1="10" x2="18" y2="10"/><line x1="3" y1="15.5" x2="21" y2="15.5"/><line x1="3" y1="19" x2="16" y2="19"/>',
  dashboard: '<rect x="3" y="3" width="8" height="10" rx="1.5"/><rect x="3" y="16" width="8" height="5" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="11" width="7" height="10" rx="1.5"/>',
  insight: '<polyline points="3 17 9 11 13 15 21 7"/><polyline points="15 7 21 7 21 13"/>',
  shortcuts: '<rect x="2" y="6" width="20" height="12" rx="2"/><line x1="6" y1="10.5" x2="6.01" y2="10.5"/><line x1="10" y1="10.5" x2="10.01" y2="10.5"/><line x1="14" y1="10.5" x2="14.01" y2="10.5"/><line x1="18" y1="10.5" x2="18.01" y2="10.5"/><line x1="8" y1="14" x2="16" y2="14"/>',
  theme: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18a9 9 0 0 0 0-18z" fill="currentColor" stroke="none"/>',
  // ── 디렉토리/파일(팩 directory·file) ──────────────────────────────────
  folder: '<path d="M3 7a2 2 0 0 1 2-2h3.4l1.8 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  drive: '<path d="M3 7a2 2 0 0 1 2-2h3.4l1.8 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9.5 15.5v-2.2l2.5-2 2.5 2v2.2z"/>',
  file: '<path d="M6 2.6 H14 L19.4 8 V19.4 A1.6 1.6 0 0 1 17.8 21 H6.2 A1.6 1.6 0 0 1 4.6 19.4 V4.2 A1.6 1.6 0 0 1 6.2 2.6 Z"/><path d="M13.9 2.6 V8.1 H19.4"/>',
  // ── 파일 유형/언어 내부 글리프(팩 GL 맵) — 파일 글리프 안에 겹쳐 그리는 유형 표식 ──
  app: '<rect x="4" y="5" width="16" height="14" rx="2"/><line x1="4" y1="9" x2="20" y2="9"/>',
  plug: '<path d="M9 3v4M15 3v4"/><rect x="7" y="7" width="10" height="6" rx="1.5"/><path d="M12 13v4a3 3 0 0 1-3 3H7"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 5v2M12 17v2M5 12h2M17 12h2M7.2 7.2l1.4 1.4M15.4 15.4l1.4 1.4M16.8 7.2l-1.4 1.4M8.6 15.4l-1.4 1.4"/>',
  braces: '<path d="M9 4c-1.8 0-2 1.5-2 4s-.6 3.5-2 4c1.4.5 2 1.5 2 4s.2 4 2 4"/><path d="M15 4c1.8 0 2 1.5 2 4s.6 3.5 2 4c-1.4.5-2 1.5-2 4s-.2 4-2 4"/>',
  vector: '<rect x="3" y="3" width="4" height="4" rx="1"/><rect x="17" y="3" width="4" height="4" rx="1"/><rect x="3" y="17" width="4" height="4" rx="1"/><rect x="17" y="17" width="4" height="4" rx="1"/><path d="M7 5h10M5 7v10M19 7v10M7 19h10"/>',
  image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.6"/><path d="M21 16l-5-5-4 4-2-2-4 4"/>',
  video: '<rect x="3" y="5" width="18" height="14" rx="2"/><polygon points="10 9 15 12 10 15"/>',
  audio: '<path d="M9 17V6l9-2v11"/><circle cx="6.5" cy="17" r="2.4"/><circle cx="15.5" cy="15" r="2.4"/>',
  book: '<path d="M6 4h10a2 2 0 0 1 2 2v14H8a2 2 0 0 1-2-2z"/><path d="M18 20H8a2 2 0 0 0-2 2"/><line x1="9.5" y1="9" x2="14.5" y2="9"/>',
  text: '<line x1="6" y1="7" x2="18" y2="7"/><line x1="6" y1="11" x2="18" y2="11"/><line x1="6" y1="15" x2="14" y2="15"/>',
  md: '<rect x="3" y="6" width="18" height="12" rx="1.6"/><path d="M6.5 15V9l2.5 3 2.5-3v6"/><path d="M16.5 9v4M14.5 12l2 2 2-2"/>',
  log: '<line x1="5" y1="7" x2="6.4" y2="7"/><line x1="8.5" y1="7" x2="18" y2="7"/><line x1="5" y1="11" x2="6.4" y2="11"/><line x1="8.5" y1="11" x2="18" y2="11"/><line x1="5" y1="15" x2="6.4" y2="15"/><line x1="8.5" y1="15" x2="14" y2="15"/>',
  archive: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M12 4v3M12 9v2M12 13v2"/><rect x="10.3" y="14" width="3.4" height="4" rx="1"/>',
  disc: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2"/>',
  map: '<polygon points="3 6 9 4 15 6 21 4 21 18 15 20 9 18 3 20"/><line x1="9" y1="4" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="20"/>',
  db: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.6 3.1 3 7 3s7-1.4 7-3V6"/><path d="M5 12v6c0 1.6 3.1 3 7 3s7-1.4 7-3v-6"/>',
  code: '<polyline points="9 8 5 12 9 16"/><polyline points="15 8 19 12 15 16"/>',
  markup: '<polyline points="8 8 4 12 8 16"/><polyline points="16 8 20 12 16 16"/><line x1="13.5" y1="6" x2="10.5" y2="18"/>',
  style: '<circle cx="9" cy="8" r="2"/><circle cx="16" cy="11" r="2"/><circle cx="8" cy="16" r="2"/><circle cx="15" cy="17.5" r="2"/>',
  atom: '<circle cx="12" cy="12" r="1.8"/><ellipse cx="12" cy="12" rx="9" ry="3.8"/><ellipse cx="12" cy="12" rx="9" ry="3.8" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9" ry="3.8" transform="rotate(120 12 12)"/>',
  shell: '<rect x="3" y="4" width="18" height="16" rx="2"/><polyline points="7 9 10 12 7 15"/><line x1="12" y1="15" x2="16" y2="15"/>',
  // ── 크롬 보강(팩 외 — 동일 24/모노라인 톤) ────────────────────────────
  transfer: '<path d="M7 4v13"/><polyline points="3.5 7.5 7 4 10.5 7.5"/><path d="M17 20V7"/><polyline points="20.5 16.5 17 20 13.5 16.5"/>',
  workspace: '<rect x="3" y="3" width="8" height="8" rx="1.6"/><rect x="13" y="3" width="8" height="8" rx="1.6"/><rect x="3" y="13" width="8" height="8" rx="1.6"/><rect x="13" y="13" width="8" height="8" rx="1.6"/>',
  columns: '<rect x="3" y="4" width="7" height="16" rx="1"/><rect x="14" y="4" width="7" height="16" rx="1"/>',
  monitor: '<rect x="3" y="4" width="18" height="13" rx="1.5"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
  clock: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 13.8"/>',
  hardDrive: '<rect x="2" y="6" width="20" height="12" rx="2"/><line x1="6" y1="12" x2="6.01" y2="12"/><circle cx="17" cy="12" r="1.1" fill="currentColor" stroke="none"/>',
  globe: '<circle cx="12" cy="12" r="9"/><line x1="3" y1="12" x2="21" y2="12"/><path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z"/>',
  sparkles: '<path d="M12 3l1.7 4.6L18 9.3l-4.3 1.7L12 15.6l-1.7-4.6L6 9.3l4.3-1.7z"/><path d="M18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8z"/>',
  chevronRight: '<polyline points="9 18 15 12 9 6"/>',
  chevronDown: '<polyline points="6 9 12 15 18 9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>'
}

/** 팩 아이콘 1개 렌더(이름→ICON_PATHS). fill 기본 none(채움형은 fill 전달). */
export function Icon({
  name,
  size = 16,
  stroke = 1.8,
  style,
  fill
}: IconProps & { name: string; fill?: string }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill ?? 'none'}
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ flex: 'none', display: 'block', ...style }}
      dangerouslySetInnerHTML={{ __html: ICON_PATHS[name] ?? '' }}
    />
  )
}

// ── 이름별 호환 래퍼(기존 호출부 무수정) ───────────────────────────────
export const ArrowLeftIcon = (p: IconProps): JSX.Element => <Icon name="back" {...p} />
export const ArrowRightIcon = (p: IconProps): JSX.Element => <Icon name="forward" {...p} />
export const ArrowUpIcon = (p: IconProps): JSX.Element => <Icon name="up" {...p} />
export const RefreshIcon = (p: IconProps): JSX.Element => <Icon name="refresh" {...p} />
export const HomeIcon = (p: IconProps): JSX.Element => <Icon name="home" {...p} />
export const SearchIcon = (p: IconProps): JSX.Element => <Icon name="search" {...p} />
export const SettingsIcon = (p: IconProps): JSX.Element => <Icon name="settings" {...p} />
export const DownloadIcon = (p: IconProps): JSX.Element => <Icon name="download" {...p} />
export const ListIcon = (p: IconProps): JSX.Element => <Icon name="listView" {...p} />
export const GridIcon = (p: IconProps): JSX.Element => <Icon name="gridView" {...p} />
export const ColumnsIcon = (p: IconProps): JSX.Element => <Icon name="columns" {...p} />
export const TrashIcon = (p: IconProps): JSX.Element => <Icon name="trash" {...p} />
export const EyeIcon = (p: IconProps): JSX.Element => <Icon name="preview" {...p} />
export const MonitorIcon = (p: IconProps): JSX.Element => <Icon name="monitor" {...p} />
export const ClockIcon = (p: IconProps): JSX.Element => <Icon name="clock" {...p} />
export const HardDriveIcon = (p: IconProps): JSX.Element => <Icon name="hardDrive" {...p} />
export const GlobeIcon = (p: IconProps): JSX.Element => <Icon name="globe" {...p} />
export const SparklesIcon = (p: IconProps): JSX.Element => <Icon name="sparkles" {...p} />
export const ChevronRightIcon = (p: IconProps): JSX.Element => <Icon name="chevronRight" {...p} />
export const ChevronDownIcon = (p: IconProps): JSX.Element => <Icon name="chevronDown" {...p} />
export const PlusIcon = (p: IconProps): JSX.Element => <Icon name="plus" {...p} />
export const CloseIcon = (p: IconProps): JSX.Element => <Icon name="close" {...p} />
export const FolderLineIcon = (p: IconProps): JSX.Element => <Icon name="folder" {...p} />
export const FileLineIcon = (p: IconProps): JSX.Element => <Icon name="file" {...p} />

/** 별(즐겨찾기) — filled 면 채워서 활성 표시(팩 star path). */
export function StarIcon({ filled, ...p }: IconProps & { filled?: boolean }): JSX.Element {
  return <Icon name="star" fill={filled ? 'currentColor' : 'none'} {...p} size={p.size ?? 14} />
}
