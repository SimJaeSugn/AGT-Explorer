/**
 * FileListView — 가상 스크롤 파일 목록 (ADR-004, SA §6).
 *
 * 자체 윈도잉(고정 행높이): 가시 영역 + 오버스캔 행만 DOM 에 렌더한다.
 * 1만 행이어도 실제 DOM 노드는 수십 개로 일정.
 *   - details/list: 고정 행높이 윈도잉.
 *   - grid: 열 수 × 셀 높이 그리드 윈도잉.
 *
 * 다중 선택(Ctrl/Shift/Ctrl+A)·더블클릭/Enter 활성화·키보드 이동을 처리한다.
 * 정렬/필터는 app/usecases/selectors(computeVisible)가 계산한 결과만 그린다.
 *
 * 셀렉터 격리(SA §5.2): 자기 panelId 의 directory/view/selection 만 구독.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { FileEntryDTO, SortDir, SortKey } from '@shared/dto'
import { useRootStore } from '@renderer/app/stores/rootStore'
import { computeVisible } from '@renderer/app/usecases/selectors'
import { activateEntry } from '@renderer/app/usecases/open'
import { getCachedIcon, iconKeyFor, isDriveFolder, isLinkFolder, requestIcon, subscribeIcon } from '@renderer/app/usecases/icons'
import { DriveGlyph, FolderGlyph } from '@renderer/ui/icons/glyphs'
import { Icon, FolderLineIcon } from '@renderer/ui/icons/lucide'
import {
  getCachedThumbnail,
  requestThumbnail,
  subscribeThumbnail,
  thumbnailKeyFor
} from '@renderer/app/usecases/thumbnails'
import { isThumbnailableExt, thumbSizeFor } from '@renderer/domain/image'
import { commitRename } from '@renderer/app/usecases/fileOps'
import { openEmptyContextMenu, openRowContextMenu } from '@renderer/app/usecases/contextMenu'
import { highlightRange } from '@renderer/domain/rules/filter'
import { tagColorOf, type TagKey } from '@renderer/domain/rules/tags'
import {
  getCachedFolderSize,
  requestFolderSize,
  subscribeFolderSize
} from '@renderer/app/usecases/folderSize'
import { normalizeRect, indicesInRect } from '@renderer/domain/rules/boxSelect'
import type { SelectionState } from '@renderer/domain/rules/selection'
import { tokens, gridCellFor } from '@renderer/ui/theme/tokens'
import type { DetailsColumn, DetailsColumnWidths } from '@renderer/domain/rules/columnWidths'
import {
  useDragSource,
  useExternalDragSource,
  useDropTarget,
  useHtml5DropTarget,
  useDragState
} from '@renderer/ui/dnd/useDrag'
import { computeWindow } from './windowing'

const OVERSCAN = 6
/**
 * 비-그리드(목록/자세히) 보기 행 높이(px) — 디자인 템플릿(목업) 톤의 여유 있는 행.
 * 유형-색 아이콘 타일(26px)이 위아래 여백과 함께 들어가도록 키웠다. 목록·자세히 둘 다
 * 같은 행 UI(타일 + 유형색)를 쓴다. 그리드(아이콘) 보기는 gridCell 높이를 따로 쓴다.
 */
const LIST_ROW_H = 44
/**
 * 자세히 보기 열 헤더 밴드 높이(px). 스크롤 컨테이너 최상단에 sticky 로 고정되며,
 * 핀(고정) sticky 밴드는 이 높이만큼 아래로 밀려 헤더 아래에 쌓인다(헤더가 위).
 * 키보드 스크롤 보정도 이 상수를 더해 행이 헤더 뒤로 숨지 않게 한다.
 */
const HEADER_H = 24
/**
 * 자세히(details) 헤더 정렬 상수 — 헤더 "이름" 라벨이 행의 파일명과 같은 x 에서
 * 시작하도록 details 행 메트릭(좌측 패딩 11 · 유형-색 타일 26 · 타일~이름 gap 11)에 맞춘다.
 */
const ROW_PAD_X = 11
/** 헤더 선행 spacer 폭(= details 행의 아이콘 타일 폭) + 타일~이름 gap. */
const ROW_ICON_W = 26
const ROW_ICON_GAP = 11
/** 박스 선택 시작 임계(클릭과 구분). DnD threshold 와 동일. */
const BOX_THRESHOLD = 5
/** 자동 스크롤 임계 영역(뷰포트 상/하단 px). */
const AUTOSCROLL_EDGE = 24
/** 자동 스크롤 1프레임당 이동 px. */
const AUTOSCROLL_STEP = 12
/** 태그 없는 행에 넘길 안정 빈 배열(매 렌더 새 배열 방지 — FileRow memo 안정). */
const EMPTY_TAGS: readonly TagKey[] = []

interface Props {
  readonly panelId: string
  readonly active: boolean
}

/** 크기 사람친화 표기. */
function formatSize(entry: FileEntryDTO): string {
  if (entry.isDir) return ''
  const b = entry.size
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`
  return `${(b / 1024 / 1024 / 1024).toFixed(1)} GB`
}

function formatMtime(ms: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`
}

// 유형별 색(디자인 템플릿 "유형-색" 톤). 폴더는 테마 accent, 나머지는 카테고리 고정색.
const EXEC_EXTS = new Set(['exe', 'msi', 'bat', 'cmd', 'com', 'app', 'appimage', 'deb', 'rpm'])
const ARCHIVE_EXTS = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz', 'zst', 'cab', 'iso'])
const CONFIG_EXTS = new Set(['yml', 'yaml', 'json', 'toml', 'ini', 'cfg', 'conf', 'env', 'lock', 'blockmap'])
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'ico', 'tif', 'tiff', 'heic'])
const VIDEO_EXTS = new Set(['mp4', 'mkv', 'mov', 'avi', 'webm', 'wmv', 'flv', 'm4v'])
const AUDIO_EXTS = new Set(['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma'])
const CODE_EXTS = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'cs', 'rb', 'php', 'sh', 'html', 'css', 'scss', 'vue', 'sql'])
const DOC_EXTS = new Set(['md', 'txt', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'csv', 'rtf', 'hwp'])

/**
 * 확장자 → {내부 글리프 이름, 유형색}. 아이콘 팩 "파일 유형/개발 언어" 표와 동일.
 * (색은 팩 팔레트: blue#6aa6f5·amber#e0a85b·slate#8a93a0·emerald#3ecf8e·teal#4fc7c7·
 *  rose#e08aa6·violet#b98ce0·lime#b5d65f)
 */
const EXT_ICON: Record<string, { glyph: string; color: string }> = {
  exe: { glyph: 'app', color: '#6aa6f5' }, msi: { glyph: 'app', color: '#6aa6f5' }, dll: { glyph: 'plug', color: '#6aa6f5' },
  yaml: { glyph: 'gear', color: '#e0a85b' }, yml: { glyph: 'gear', color: '#e0a85b' }, json: { glyph: 'braces', color: '#e0a85b' },
  svg: { glyph: 'vector', color: '#3ecf8e' }, png: { glyph: 'image', color: '#3ecf8e' }, jpg: { glyph: 'image', color: '#3ecf8e' }, jpeg: { glyph: 'image', color: '#3ecf8e' },
  mp4: { glyph: 'video', color: '#e08aa6' }, mp3: { glyph: 'audio', color: '#b98ce0' },
  pdf: { glyph: 'book', color: '#e08aa6' }, txt: { glyph: 'text', color: '#8a93a0' }, md: { glyph: 'md', color: '#4fc7c7' },
  zip: { glyph: 'archive', color: '#b5d65f' }, iso: { glyph: 'disc', color: '#b98ce0' },
  map: { glyph: 'map', color: '#8a93a0' }, blockmap: { glyph: 'map', color: '#8a93a0' }, log: { glyph: 'log', color: '#8a93a0' }, db: { glyph: 'db', color: '#b98ce0' },
  // 개발 언어
  js: { glyph: 'code', color: '#e0a85b' }, mjs: { glyph: 'code', color: '#e0a85b' }, cjs: { glyph: 'code', color: '#e0a85b' },
  ts: { glyph: 'code', color: '#6aa6f5' }, jsx: { glyph: 'atom', color: '#4fc7c7' }, tsx: { glyph: 'atom', color: '#4fc7c7' },
  html: { glyph: 'markup', color: '#e08aa6' }, css: { glyph: 'style', color: '#b98ce0' }, scss: { glyph: 'style', color: '#b98ce0' }, vue: { glyph: 'atom', color: '#3ecf8e' },
  py: { glyph: 'code', color: '#e0a85b' }, java: { glyph: 'code', color: '#e08aa6' }, kt: { glyph: 'code', color: '#b98ce0' }, c: { glyph: 'code', color: '#6aa6f5' },
  cpp: { glyph: 'code', color: '#6aa6f5' }, h: { glyph: 'code', color: '#6aa6f5' }, cs: { glyph: 'code', color: '#b98ce0' }, go: { glyph: 'code', color: '#4fc7c7' }, rs: { glyph: 'code', color: '#e08aa6' },
  rb: { glyph: 'code', color: '#e08aa6' }, php: { glyph: 'code', color: '#b98ce0' }, swift: { glyph: 'code', color: '#e08aa6' }, dart: { glyph: 'code', color: '#4fc7c7' },
  sql: { glyph: 'db', color: '#e0a85b' }, sh: { glyph: 'shell', color: '#8a93a0' }, bash: { glyph: 'shell', color: '#8a93a0' }
}

/** 확장자 → 글리프+색. EXT_ICON 우선, 없으면 카테고리 폴백. */
function fileIconFor(extRaw: string): { glyph: string; color: string } {
  const ext = extRaw.toLowerCase()
  const hit = EXT_ICON[ext]
  if (hit) return hit
  if (EXEC_EXTS.has(ext)) return { glyph: 'app', color: '#6aa6f5' }
  if (CODE_EXTS.has(ext)) return { glyph: 'code', color: '#6aa6f5' }
  if (ARCHIVE_EXTS.has(ext)) return { glyph: 'archive', color: '#b5d65f' }
  if (CONFIG_EXTS.has(ext)) return { glyph: 'gear', color: '#e0a85b' }
  if (IMAGE_EXTS.has(ext)) return { glyph: 'image', color: '#3ecf8e' }
  if (VIDEO_EXTS.has(ext)) return { glyph: 'video', color: '#e08aa6' }
  if (AUDIO_EXTS.has(ext)) return { glyph: 'audio', color: '#b98ce0' }
  if (DOC_EXTS.has(ext)) return { glyph: 'book', color: '#8aa0b4' }
  return { glyph: 'text', color: '#8a93a0' }
}

/** 항목 유형 색(타일 틴트·유형 라벨 공용). 폴더=테마 accent, 파일=유형색. */
function fileTypeColor(entry: FileEntryDTO): string {
  return entry.isDir ? tokens.color.accent : fileIconFor(entry.ext).color
}

/**
 * 파일 유형 아이콘(아이콘 팩 "파일 유형/개발 언어") — 파일 글리프(중립 외곽선) 위에
 * 유형별 내부 글리프(유형색)를 겹치고, 큰 크기에서는 하단에 확장자 라벨을 얹는다.
 * 목록/자세히 타일과 그리드(큰·보통·작은 아이콘) 보기에서 공용으로 쓴다.
 */
function FileTypeIcon({ ext, size, showLabel }: { ext: string; size: number; showLabel?: boolean }): JSX.Element {
  const { glyph, color } = fileIconFor(ext)
  const label = ext ? ext.toUpperCase().slice(0, 4) : ''
  return (
    <span
      aria-hidden
      style={{ position: 'relative', display: 'inline-flex', width: size, height: size, flex: 'none' }}
    >
      {/* 파일 외곽선(중립색) */}
      <Icon name="file" size={size} stroke={1.3} style={{ color: tokens.color.textMuted }} />
      {/* 내부 유형 글리프(유형색) — 파일 본문 영역에 겹쳐 그린다. */}
      <span
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: size * 0.2,
          height: size * 0.56,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color
        }}
      >
        <Icon name={glyph} size={Math.round(size * 0.46)} stroke={1.7} />
      </span>
      {/* 확장자 라벨(큰/보통 아이콘 등 충분히 클 때만) */}
      {showLabel && label && (
        <span
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: Math.round(size * 0.07),
            textAlign: 'center',
            fontSize: Math.max(7, Math.round(size * 0.155)),
            fontWeight: 800,
            letterSpacing: '-0.2px',
            lineHeight: 1,
            color
          }}
        >
          {label}
        </span>
      )}
    </span>
  )
}

/** 확장자 표시 토글에 따른 이름 표기. */
function displayName(entry: FileEntryDTO, showExt: boolean): string {
  if (showExt || entry.isDir || entry.ext === '') return entry.name
  // 확장자 숨김: 마지막 ".ext" 제거.
  const dot = entry.name.lastIndexOf('.')
  return dot > 0 ? entry.name.slice(0, dot) : entry.name
}

export function FileListView({ panelId, active }: Props): JSX.Element {
  const directory = useRootStore((s) => s.panels[panelId]?.directory)
  const view = useRootStore((s) => s.panels[panelId]?.view)
  const filter = useRootStore((s) => s.panels[panelId]?.filter)
  const panelPath = useRootStore((s) => s.panels[panelId]?.path ?? '')
  // 상단 고정: 이 패널 경로의 고정 항목 배열(변경 시 재렌더 + computeVisible 재계산).
  const pinnedHere = useRootStore((s) => s.pinnedByDir[s.panels[panelId]?.path ?? ''])
  // T1: 태그 맵·활성 태그 필터. 둘 다 변경 시 재렌더 + computeVisible 재계산(태그 필터/배지).
  const tagsByPath = useRootStore((s) => s.tagsByPath)
  const activeTags = useRootStore((s) => s.activeTagsByPanel[panelId])
  const selection = useRootStore((s) => s.selection[panelId])
  const showExtensions = useRootStore((s) => s.showExtensions)
  // 자세히 보기 열 너비(전역 설정·드래그 조절). 행/헤더가 동일 폭을 공유해 정렬 유지.
  const colWidths = useRootStore((s) => s.detailsColumnWidths)
  const setDetailsColumnWidth = useRootStore((s) => s.setDetailsColumnWidth)
  // 자세히 보기 열 헤더 클릭 정렬(같은 키 재클릭 시 방향 토글 — setSort 가 처리).
  const setSort = useRootStore((s) => s.setSort)
  const renameTarget = useRootStore((s) => s.renameTarget)
  // J2: 워처발 갱신 시 1회성 스크롤 복원 플래그(보존). null=평상시 no-op.
  const pendingScrollRestore = useRootStore((s) => s.panels[panelId]?.pendingScrollRestore ?? null)
  const setStoreScroll = useRootStore((s) => s.setScrollTop)
  const clearPendingScrollRestore = useRootStore((s) => s.clearPendingScrollRestore)

  const clickSelect = useRootStore((s) => s.clickSelect)
  const selectAll = useRootStore((s) => s.selectAll)
  const moveSelect = useRootStore((s) => s.moveSelect)
  const boxSelect = useRootStore((s) => s.boxSelect)
  const setActivePanel = useRootStore((s) => s.setActivePanel)
  const activeTabId = useRootStore((s) => s.activeTabId)
  // 검색바(inputContext='search') 등이 열린 상태에서 목록을 클릭하면 list 컨텍스트로
  // 복귀시킨다 — 그래야 Delete/Ctrl+C 등 'list' 단축키가 다시 동작한다(검색 후 클릭 시
  // 단축키 먹통 버그). 검색 input 재포커스 시엔 디스패처가 편집요소를 textContext 로
  // 강등하므로 검색 입력은 그대로 안전하다.
  const setInputContext = useRootStore((s) => s.setInputContext)

  // D&D: 패널 빈영역 드롭 타겟 + 드래그 상태(하이라이트 판정).
  const drag = useDragState()
  const emptyAreaDrop = useDropTarget({ panelId, destDir: panelPath, overEntryPath: null })
  // HTML5 드롭(드롭 즉시 이동 — OS 드래그가 포인터를 점유해도 동작): 빈영역=패널 폴더.
  const emptyAreaHtml5 = useHtml5DropTarget({ panelId, destDir: panelPath, overEntryPath: null })
  const panelDropHighlight =
    drag.active &&
    drag.target?.panelId === panelId &&
    drag.target.overEntryPath === null &&
    drag.allowed

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const roRef = useRef<ResizeObserver | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(400)
  const [viewportW, setViewportW] = useState(600)

  // 스크롤 컨테이너 콜백 ref: 노드가 실제로 마운트/언마운트되는 시점에
  // ResizeObserver 를 부착·해제하고 즉시 측정한다.
  //
  // (버그 이력) 과거에는 `useEffect(..., [])` 로 마운트 시 1회만 측정했는데,
  // 디렉토리가 '로딩' 상태일 때는 스크롤 컨테이너가 렌더되지 않아
  // scrollRef.current 가 null → 옵저버 미부착 → viewportH 가 초기값(400)에
  // 고정됐다. 그 결과 윈도잉이 ~400px 분량의 행만 그려 목록이 패널 높이보다
  // 짧게 보였다(특히 디렉토리를 늦게 로드하는 우측 패널). 콜백 ref 는
  // 컨테이너가 준비된 직후 정확히 측정하므로 이 문제를 없앤다.
  const attachScroll = useCallback((el: HTMLDivElement | null) => {
    scrollRef.current = el
    if (roRef.current) {
      roRef.current.disconnect()
      roRef.current = null
    }
    if (el) {
      const ro = new ResizeObserver(() => {
        setViewportH(el.clientHeight)
        setViewportW(el.clientWidth)
      })
      ro.observe(el)
      roRef.current = ro
      setViewportH(el.clientHeight)
      setViewportW(el.clientWidth)
    }
  }, [])

  // computeVisible 은 패널 객체로 메모. 셀렉터 입력 변화에만 재계산.
  const panel = useRootStore((s) => s.panels[panelId])
  const visible = useMemo(
    () => (panel ? computeVisible(panel) : []),
    // directory.entries/view/filter 가 바뀌면 panel 참조도 immer 로 갱신됨.
    // pinnedHere 는 고정 토글 시 참조가 바뀌어 재계산(applyPins)을 유발한다.
    // tagsByPath/activeTags 는 태그 필터·배지 변경 시 재계산/재렌더(computeVisible 도 소비).
    [panel, directory?.entries, view, filter, pinnedHere, tagsByPath, activeTags]
  )
  const visiblePaths = useMemo(() => visible.map((e) => e.path), [visible])

  // store scrollTop 미러(보존 캡처·세션 복원 출처). rAF 디바운스로 immer 과갱신 억제.
  const scrollMirrorRef = useRef<{ raf: number | null; pending: number }>({ raf: null, pending: 0 })
  const onScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const top = e.currentTarget.scrollTop
      setScrollTop(top) // 윈도잉용 로컬(즉시)
      // store 반영(rAF 1프레임 병합) → capturePreserve 가 최신 scrollTop 을 읽는다.
      const m = scrollMirrorRef.current
      m.pending = top
      if (m.raf === null) {
        m.raf = requestAnimationFrame(() => {
          m.raf = null
          setStoreScroll(panelId, m.pending)
        })
      }
    },
    [panelId, setStoreScroll]
  )

  const viewMode = view?.viewMode ?? 'details'
  const isGrid = viewMode.startsWith('icons-')
  // 자세히 보기에서만 열 헤더 밴드를 그린다. 헤더 높이만큼 콘텐츠가 아래로 밀린다.
  const isDetails = viewMode === 'details'
  const headerH = isDetails ? HEADER_H : 0
  // 목록·자세히 모두 템플릿 톤의 여유 행(타일+여백). 그리드는 gridCell 높이를 따로 쓴다.
  const rowH = isGrid ? tokens.rowHeight : LIST_ROW_H
  const gridCell = isGrid ? gridCellFor(viewMode) : null

  // 윈도잉 계산. 그리드는 보기별 셀 폭/높이, 비그리드는 1열·rowHeight.
  // cellH/colCount/cellW 는 키보드 스크롤(L246)·박스선택 geomRef 가 재사용하므로 보존.
  const cellW = gridCell ? gridCell.w : viewportW
  const colCount = gridCell ? Math.max(1, Math.floor(viewportW / gridCell.w)) : 1
  const cellH = gridCell ? gridCell.h : rowH
  // 윈도잉 산식은 순수 함수(windowing.ts)로 추출(qa verify-perf 가 동일 함수 소비).
  const { startIdx, endIdx, totalHeight } = computeWindow({
    scrollTop,
    viewportH,
    cellH,
    colCount,
    count: visible.length,
    overscan: OVERSCAN
  })

  // 상단 고정 sticky 밴드(§O 변경): 고정 항목을 스크롤해도 목록 최상단에 고정 표시한다.
  // 목록/자세히(colCount=1) 전용 — 그리드는 wrapping 특성상 부분 행 점유로 레이아웃이
  // 깨지므로 기존 "정렬 최상단 유지"만 적용(밴드 비활성). applyPins 가 고정 항목을 visible
  // 앞쪽에 모으므로, 선두 연속 구간이 곧 고정 묶음이다(인덱스/선택/키보드 공간은 불변).
  const pinnedSet = useMemo(() => new Set(pinnedHere ?? []), [pinnedHere])
  const sticky = !isGrid && pinnedSet.size > 0
  let stickyCount = 0
  if (sticky) {
    while (stickyCount < visible.length) {
      const e = visible[stickyCount]
      if (!e || !pinnedSet.has(e.path)) break
      stickyCount++
    }
  }
  const stickyBandH = stickyCount * cellH

  // 행 mousedown → 선택 갱신. 단, 수정자 없이 **이미 다중 선택된** 항목을 누르면 단일
  // 붕괴를 mouseup(click)으로 미룬다 → 그래야 그 항목을 드래그할 때 선택 전체가 보존돼
  // 다중 이동이 된다(드래그가 일어나면 click 이 발화하지 않으므로 다중 유지). A3 다중 D&D.
  const onRowMouseDown = useCallback(
    (index: number, e: React.MouseEvent) => {
      // 우클릭(보조 버튼)은 선택 보정을 onContextMenu(openRowContextMenu) 가 전담한다.
      if (e.button !== 0) return
      if (!active) {
        const tabId = activeTabId
        setActivePanel(tabId, panelId)
      }
      // 목록과 상호작용 시작 → list 컨텍스트(검색바 열린 채 클릭해도 단축키 복구).
      setInputContext('list')
      const ctrl = e.ctrlKey || e.metaKey
      const shift = e.shiftKey
      if (!ctrl && !shift) {
        const path = visiblePaths[index]
        const cur = useRootStore.getState().selection[panelId]
        if (path && cur && cur.selectedPaths.has(path) && cur.selectedPaths.size > 1) {
          return // 미룸: 드래그면 다중 보존, 단순 클릭이면 onRowClickSelect 가 단일로 정리.
        }
      }
      clickSelect(panelId, visiblePaths, index, ctrl, shift)
    },
    [active, activeTabId, setActivePanel, panelId, clickSelect, visiblePaths, setInputContext]
  )

  // 행 click(= mouseup·드래그 아님) → 미뤄둔 단일 선택 적용. 드래그였다면 click 이 발화하지
  // 않아 호출되지 않는다(다중 보존). 수정자 클릭은 mousedown 이 이미 처리(중복 토글 방지).
  const onRowClickSelect = useCallback(
    (index: number, e: React.MouseEvent) => {
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return
      clickSelect(panelId, visiblePaths, index, false, false)
    },
    [panelId, clickSelect, visiblePaths]
  )

  const onRowDouble = useCallback(
    (entry: FileEntryDTO) => {
      void activateEntry(panelId, entry)
    },
    [panelId]
  )

  // 행 우클릭 → 활성 패널 전환 + 선택 보정(선택 밖이면 단일 선택) + 컨텍스트 메뉴.
  const onRowContext = useCallback(
    (index: number, entry: FileEntryDTO, e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      openRowContextMenu(panelId, entry, visiblePaths, index, e.clientX, e.clientY)
    },
    [panelId, visiblePaths]
  )

  // 빈 영역(행 밖) 우클릭 → 활성 패널 전환 + (대상 없음) 컨텍스트 메뉴.
  const onEmptyContext = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      if (!active) setActivePanel(activeTabId, panelId)
      openEmptyContextMenu(panelId, e.clientX, e.clientY)
    },
    [panelId, active, setActivePanel, activeTabId]
  )

  // 드래그 소스 산출: 클릭 항목이 선택에 포함되면 전체 선택을, 아니면 해당 항목만.
  const dragSourcesFor = useCallback(
    (entry: FileEntryDTO): string[] => {
      const sel = selection?.selectedPaths
      if (sel && sel.has(entry.path) && sel.size > 0) return [...sel]
      return [entry.path]
    },
    [selection]
  )

  // 키보드: ↑/↓ 이동, Ctrl+A(전역 디스패처도 처리하지만 list 포커스 시 직접도 허용).
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const isArrow =
        e.key === 'ArrowDown' ||
        e.key === 'ArrowUp' ||
        ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && colCount > 1)
      if (isArrow) {
        e.preventDefault()
        const cur = selection && selection.anchorIndex >= 0 ? selection.anchorIndex : -1
        // 그리드는 ↑↓ ±colCount, ←→ ±1. list/details(colCount=1)는 ↑↓ ±1만.
        let delta = 0
        if (e.key === 'ArrowDown') delta = colCount
        else if (e.key === 'ArrowUp') delta = -colCount
        else if (e.key === 'ArrowRight') delta = 1
        else if (e.key === 'ArrowLeft') delta = -1
        const next = Math.max(0, Math.min(visible.length - 1, cur + delta))
        moveSelect(panelId, visiblePaths, next)
        // 가시 영역으로 스크롤(그리드는 행 단위).
        const el = scrollRef.current
        if (el) {
          const top = Math.floor(next / colCount) * cellH
          // 상단 가림 영역 = 열 헤더(headerH·자세히 전용) + 핀 sticky 밴드(stickyBandH).
          // 위로 스크롤 시 그만큼 더 올려 대상 행이 헤더/밴드 뒤로 가리지 않게 한다
          // (고정 행 자신은 max(0)로 0 → 밴드에 표시).
          const topOcclusion = headerH + stickyBandH
          if (top < el.scrollTop + topOcclusion) el.scrollTop = Math.max(0, top - topOcclusion)
          else if (top + cellH > el.scrollTop + el.clientHeight) {
            el.scrollTop = top + cellH - el.clientHeight
          }
        }
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault()
        selectAll(panelId, visiblePaths)
      } else if (e.key === 'Escape') {
        // Esc 는 포커스를 "푼다" — 그리드(tabIndex=0)에 포커스를 주지 않는다.
        // 그리드는 클릭만으로 이미 포커스를 갖지만 마우스 포커스라 :focus-visible 링이
        // 없다가, Esc(키보드 입력) 순간 브라우저 휴리스틱이 링을 띄워 "포커스가 생긴 것"
        // 처럼 보였다. blur 로 포커스를 해제해 링이 뜨지 않고 포커스가 풀리게 한다.
        scrollRef.current?.blur()
      } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
        // 키보드 컨텍스트 메뉴 호출(WCAG 2.1.1): 활성 행 기준 위치에 메뉴를 연다.
        // 활성 행이 없으면(선택 없음) 빈 영역 메뉴를 패널 좌상단 부근에 연다.
        e.preventDefault()
        e.stopPropagation()
        const el = scrollRef.current
        const idx = selection && selection.anchorIndex >= 0 ? selection.anchorIndex : -1
        const entry = idx >= 0 ? visible[idx] : undefined
        if (el && entry) {
          // 활성 행의 화면 좌표(콘텐츠 top - scrollTop + 컨테이너 top)에서 약간 안쪽.
          const rect = el.getBoundingClientRect()
          const row = Math.floor(idx / colCount)
          const col = idx % colCount
          const x = rect.left + Math.min(rect.width - 8, col * cellW + 24)
          const y = rect.top + (row * cellH - el.scrollTop) + Math.min(cellH, cellH / 2 + 8)
          openRowContextMenu(panelId, entry, visiblePaths, idx, x, y)
        } else if (el) {
          const rect = el.getBoundingClientRect()
          if (!active) setActivePanel(activeTabId, panelId)
          openEmptyContextMenu(panelId, rect.left + 16, rect.top + 16)
        }
      }
    },
    [
      selection,
      visible,
      moveSelect,
      panelId,
      visiblePaths,
      cellH,
      cellW,
      colCount,
      stickyBandH,
      headerH,
      selectAll,
      active,
      setActivePanel,
      activeTabId
    ]
  )

  // ── 박스 선택(러버밴드, J1) ─────────────────────────────────────────────
  // 오버레이 렌더용 상태(콘텐츠 좌표계 사각형). 드래그 중에만 non-null.
  const [boxRect, setBoxRect] = useState<{
    top: number
    left: number
    width: number
    height: number
  } | null>(null)
  // 드래그 세션(시작점·수정자·base 선택·자동스크롤 rAF). useState 리렌더 회피.
  const dragRef = useRef<{
    startX: number // 콘텐츠 좌표(scrollTop 포함)
    startY: number
    curClientX: number // 뷰포트 좌표(자동스크롤 임계 판정)
    curClientY: number
    mode: 'replace' | 'add' | 'toggle'
    base: SelectionState
    started: boolean // BOX_THRESHOLD 초과로 실제 시작했는지
    rafId: number | null
  } | null>(null)

  // 최신 윈도잉 파라미터를 리스너에서 참조하기 위한 ref(이벤트는 closure 고정).
  const geomRef = useRef({ colCount, cellH, cellW, count: visible.length })
  geomRef.current = { colCount, cellH, cellW, count: visible.length }
  const visiblePathsRef = useRef(visiblePaths)
  visiblePathsRef.current = visiblePaths
  // 본문 행이 열 헤더(headerH)만큼 아래로 밀려 있으므로, 박스선택 인덱스 매핑은
  // 헤더 높이를 뺀 콘텐츠-Y 로 계산한다(시각 사각형은 헤더 포함 raw 좌표 유지).
  const headerHRef = useRef(headerH)
  headerHRef.current = headerH

  const applyBox = useCallback(() => {
    const d = dragRef.current
    const el = scrollRef.current
    if (!d || !el) return
    const rect = el.getBoundingClientRect()
    // 현재 포인터의 콘텐츠 좌표(스크롤 포함).
    const curX = d.curClientX - rect.left + el.scrollLeft
    const curY = d.curClientY - rect.top + el.scrollTop
    const r = normalizeRect(d.startX, d.startY, curX, curY)
    setBoxRect({ top: r.top, left: r.left, width: r.right - r.left, height: r.bottom - r.top })
    const g = geomRef.current
    // 행 좌표계로 환산(헤더 높이만큼 위로) 후 인덱스 매핑. 시각 사각형은 위 raw 좌표 유지.
    const h = headerHRef.current
    const indices = indicesInRect({ ...r, top: r.top - h, bottom: r.bottom - h }, g)
    boxSelect(panelId, visiblePathsRef.current, indices, d.mode, d.base)
  }, [boxSelect, panelId])

  const stopBox = useCallback(() => {
    const d = dragRef.current
    if (d?.rafId !== null && d?.rafId !== undefined) cancelAnimationFrame(d.rafId)
    dragRef.current = null
    setBoxRect(null)
    window.removeEventListener('pointermove', onBoxPointerMove)
    window.removeEventListener('pointerup', onBoxPointerUp)
  }, [])

  // 자동 스크롤 rAF 루프: 커서가 뷰포트 상/하단 임계 안이면 스크롤 후 박스 재계산.
  const autoScrollTick = useCallback(() => {
    const d = dragRef.current
    const el = scrollRef.current
    if (!d || !el) return
    const rect = el.getBoundingClientRect()
    let dy = 0
    if (d.curClientY < rect.top + AUTOSCROLL_EDGE) dy = -AUTOSCROLL_STEP
    else if (d.curClientY > rect.bottom - AUTOSCROLL_EDGE) dy = AUTOSCROLL_STEP
    if (dy !== 0) {
      const before = el.scrollTop
      el.scrollTop = Math.max(0, Math.min(el.scrollHeight - el.clientHeight, before + dy))
      if (el.scrollTop !== before) {
        setScrollTop(el.scrollTop)
        applyBox()
      }
    }
    d.rafId = requestAnimationFrame(autoScrollTick)
  }, [applyBox])

  const onBoxPointerMove = useCallback(
    (e: PointerEvent) => {
      const d = dragRef.current
      const el = scrollRef.current
      if (!d || !el) return
      d.curClientX = e.clientX
      d.curClientY = e.clientY
      if (!d.started) {
        const rect = el.getBoundingClientRect()
        const curX = e.clientX - rect.left + el.scrollLeft
        const curY = e.clientY - rect.top + el.scrollTop
        if (Math.abs(curX - d.startX) < BOX_THRESHOLD && Math.abs(curY - d.startY) < BOX_THRESHOLD) {
          return
        }
        d.started = true
        d.rafId = requestAnimationFrame(autoScrollTick)
      }
      applyBox()
    },
    [applyBox, autoScrollTick]
  )

  const onBoxPointerUp = useCallback(() => {
    stopBox()
  }, [stopBox])

  const onContainerPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // 좌클릭·빈 영역(행/리네임/버튼이 아닌)에서만 박스 선택 시작.
      if (e.button !== 0) return
      const target = e.target as HTMLElement
      // 행(role=row)·input·button 위에서 시작한 포인터는 무시(기존 클릭/D&D/리네임 우선).
      if (target.closest('[role="row"]') || target.closest('input') || target.closest('button')) {
        return
      }
      const el = scrollRef.current
      if (!el) return
      if (!active) setActivePanel(activeTabId, panelId)
      // 빈 영역 클릭도 목록 상호작용 → list 컨텍스트 복귀(검색 후 단축키 복구).
      setInputContext('list')
      const rect = el.getBoundingClientRect()
      const startX = e.clientX - rect.left + el.scrollLeft
      const startY = e.clientY - rect.top + el.scrollTop
      const cur = useRootStore.getState().selection[panelId]
      const base: SelectionState = cur ?? { anchorIndex: -1, selectedPaths: new Set() }
      const mode = e.ctrlKey || e.metaKey ? 'add' : e.shiftKey ? 'toggle' : 'replace'
      dragRef.current = {
        startX,
        startY,
        curClientX: e.clientX,
        curClientY: e.clientY,
        mode,
        base,
        started: false,
        rafId: null
      }
      window.addEventListener('pointermove', onBoxPointerMove)
      window.addEventListener('pointerup', onBoxPointerUp)
    },
    [active, activeTabId, panelId, setActivePanel, onBoxPointerMove, onBoxPointerUp, setInputContext]
  )

  // 언마운트 시 리스너·rAF 누수 방지(박스 선택 + 스크롤 미러 rAF).
  useEffect(() => {
    return () => {
      const d = dragRef.current
      if (d?.rafId !== null && d?.rafId !== undefined) cancelAnimationFrame(d.rafId)
      const m = scrollMirrorRef.current
      if (m.raf !== null) cancelAnimationFrame(m.raf)
      window.removeEventListener('pointermove', onBoxPointerMove)
      window.removeEventListener('pointerup', onBoxPointerUp)
    }
  }, [onBoxPointerMove, onBoxPointerUp])

  // 경로 변경(navigate/back/forward) 시 가상 스크롤을 최상단으로 리셋한다.
  // 로컬 scrollTop 상태가 이전 위치(큰 값)로 남으면 윈도(startIdx~endIdx)가 새 목록
  // 범위 밖을 가리켜 아무 행도 안 그려진다(스크롤 후 하위폴더 진입 시 빈 화면 → 새로고침
  // 해야 보이던 버그). DOM·로컬·store scrollTop 을 모두 0 으로 맞춘다. refresh(같은 경로)는
  // panelPath 가 안 바뀌어 무간섭이며 pendingScrollRestore 가 별도 복원한다.
  useEffect(() => {
    setScrollTop(0)
    const el = scrollRef.current
    if (el) el.scrollTop = 0
    setStoreScroll(panelId, 0)
  }, [panelPath, panelId, setStoreScroll])

  // J2: 워처발 갱신 스크롤 복원 — pendingScrollRestore 1회성 플래그 기반.
  // status==='ready' + totalHeight 확정일 때만 클램프 적용 후 즉시 소거(휴리스틱 없음).
  // Hooks 규칙 준수: early return 이전에 선언(내부에서 status/높이 가드).
  useEffect(() => {
    if (pendingScrollRestore == null) return // 평상시 no-op(수동 스크롤·navigate 무간섭)
    const el = scrollRef.current
    if (!el || directory?.status !== 'ready') return // 높이 미확정이면 다음 status/height 변화에서 재시도
    const max = Math.max(0, el.scrollHeight - el.clientHeight)
    const clamped = Math.min(pendingScrollRestore, max) // 콘텐츠 축소 시 클램프(빈 공간 0)
    el.scrollTop = clamped
    setScrollTop(clamped) // 로컬 윈도잉 동기화
    setStoreScroll(panelId, clamped) // store 미러도 일치
    clearPendingScrollRestore(panelId) // 즉시 1회성 소거
  }, [
    pendingScrollRestore,
    directory?.status,
    totalHeight,
    panelId,
    setStoreScroll,
    clearPendingScrollRestore
  ])

  if (!directory || !view) return <div />

  // 상태별 표시.
  if (directory.status === 'loading') {
    return <CenterMsg text="불러오는 중…" muted />
  }
  if (directory.status === 'denied') {
    return <CenterMsg text="접근 권한이 없습니다." error />
  }
  if (directory.status === 'error') {
    return <CenterMsg text={`오류: ${directory.error?.message ?? '알 수 없음'}`} error />
  }
  if (directory.status === 'empty' || (directory.status === 'ready' && visible.length === 0)) {
    const filtering = !!filter?.open && filter.query.trim().length > 0
    return (
      <div
        onPointerEnter={emptyAreaDrop.onPointerEnter}
        onPointerLeave={emptyAreaDrop.onPointerLeave}
        onContextMenu={onEmptyContext}
        data-testid={`filelist-${panelId}`}
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          // N1: 배경 투명(워터마크 노출·F17 비중첩). 패널 배경색은 Panel 외곽이 제공.
          background: 'transparent',
          color: tokens.color.textMuted,
          fontSize: 13,
          boxShadow: panelDropHighlight ? `inset 0 0 0 2px ${tokens.color.accent}` : undefined
        }}
      >
        {filtering ? '검색 결과가 없습니다.' : '이 폴더는 비어 있습니다.'}
      </div>
    )
  }

  // FileRow 1개 생성(윈도 본문 + sticky 밴드 공용).
  // topOffset: 본문 행은 열 헤더(headerH)만큼 아래로 민다. 핀 밴드 행은 0(밴드가 이미
  // sticky top:headerH 로 헤더 아래에 위치 — 밴드 내부 좌표는 헤더 무관).
  function renderRow(i: number, entry: FileEntryDTO, topOffset = 0): JSX.Element {
    const row = Math.floor(i / colCount)
    const col = i % colCount
    const top = topOffset + row * cellH
    const selected = selection?.selectedPaths.has(entry.path) ?? false
    const pinned = pinnedHere?.includes(entry.path) ?? false
    const renaming = renameTarget?.panelId === panelId && renameTarget.path === entry.path
    const dropHi =
      drag.active &&
      entry.isDir &&
      drag.target?.panelId === panelId &&
      drag.target.overEntryPath === entry.path &&
      drag.allowed
    // T1: 이 항목의 태그(없으면 빈 배열). tagsByPath 변경 시 visible 메모가 무효화되어
    // renderRow 가 다시 호출되므로 배지가 갱신된다.
    const entryTags = tagsByPath[entry.path] ?? EMPTY_TAGS
    return (
      <FileRow
        key={entry.path}
        entry={entry}
        index={i}
        setSize={visible.length}
        top={top}
        left={gridCell ? col * gridCell.w : 0}
        width={gridCell ? gridCell.w : '100%'}
        height={cellH}
        selected={selected}
        pinned={pinned}
        tags={entryTags}
        active={active}
        details={view.viewMode === 'details'}
        colWidths={colWidths}
        grid={gridCell ? { icon: gridCell.icon } : null}
        showExt={showExtensions}
        query={filter?.open ? filter.query : ''}
        panelId={panelId}
        panelPath={panelPath}
        dropHighlight={dropHi}
        renaming={renaming}
        initialName={renaming ? renameTarget.initialName : ''}
        onMouseDownSelect={onRowMouseDown}
        onClickSelect={onRowClickSelect}
        onDouble={onRowDouble}
        onContext={onRowContext}
        dragSourcesFor={dragSourcesFor}
      />
    )
  }

  // sticky 고정 밴드 행(목록/자세히 전용·colCount=1·top=i*cellH 로컬=글로벌).
  const stickyRows: JSX.Element[] = []
  if (sticky) {
    for (let i = 0; i < stickyCount; i++) {
      const entry = visible[i]
      if (entry) stickyRows.push(renderRow(i, entry))
    }
  }

  // 렌더 윈도(가시 + 오버스캔). 고정 행(i<stickyCount)은 sticky 밴드에서 렌더하므로 본문에서 제외.
  const rows: JSX.Element[] = []
  for (let i = startIdx; i < endIdx; i++) {
    const entry = visible[i]
    if (!entry) continue
    if (sticky && i < stickyCount) continue
    // 본문 행은 열 헤더(headerH) 아래에서 시작하도록 headerH 만큼 내린다.
    rows.push(renderRow(i, entry, headerH))
  }

  return (
    <div
      ref={attachScroll}
      onScroll={onScroll}
      onKeyDown={onKeyDown}
      onContextMenu={onEmptyContext}
      onPointerDown={onContainerPointerDown}
      onPointerEnter={emptyAreaDrop.onPointerEnter}
      onPointerLeave={emptyAreaDrop.onPointerLeave}
      onDragOver={emptyAreaHtml5.onDragOver}
      onDragLeave={emptyAreaHtml5.onDragLeave}
      onDrop={emptyAreaHtml5.onDrop}
      tabIndex={0}
      role="grid"
      aria-label="파일 목록"
      data-testid={`filelist-${panelId}`}
      style={{
        position: 'relative',
        flex: 1,
        overflowY: 'auto',
        overflowX: 'hidden',
        // outline 은 전역 a11y CSS(:focus-visible)가 키보드 포커스에만 표시.
        // 인라인 outline:'none' 을 두면 CSS 를 이겨 키보드 포커스가 안 보이므로 제거.
        // N1: 배경 투명(워터마크 노출). 패널 배경색은 Panel 외곽이 동일 tokens.color.bg 로 제공.
        background: 'transparent',
        boxShadow: panelDropHighlight ? `inset 0 0 0 2px ${tokens.color.accent}` : undefined
      }}
    >
      <div style={{ height: totalHeight + headerH, position: 'relative' }}>
        {isDetails && (
          <ColumnHeader
            widths={colWidths}
            height={HEADER_H}
            onResize={setDetailsColumnWidth}
            sortKey={view.sortKey}
            sortDir={view.sortDir}
            onSort={(key) => setSort(panelId, key)}
          />
        )}
        {sticky && stickyCount > 0 && (
          <div
            style={{
              position: 'sticky',
              // 열 헤더 밴드(headerH) 아래에 핀 밴드가 쌓이도록 헤더 높이만큼 내린다.
              top: headerH,
              zIndex: 3,
              height: stickyBandH,
              // 고정 영역을 본문과 구분되게: 대체 배경(bgAlt·헤더/툴바 색) + 강조 하단 구분선.
              // 스크롤되는 본문을 가리도록 불투명해야 한다.
              background: tokens.color.bgAlt,
              boxShadow: `inset 0 -2px 0 ${tokens.color.borderStrong}`
            }}
          >
            {stickyRows}
          </div>
        )}
        {rows}
        {boxRect && (
          <div
            aria-hidden
            style={{
              position: 'absolute',
              top: boxRect.top,
              left: boxRect.left,
              width: boxRect.width,
              height: boxRect.height,
              background: tokens.color.bgSelected,
              opacity: 0.35,
              border: `1px solid ${tokens.color.accent}`,
              pointerEvents: 'none',
              zIndex: 2
            }}
          />
        )}
      </div>
      {directory.status === 'streaming' && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'sticky',
            bottom: 0,
            padding: '2px 8px',
            fontSize: 11,
            color: tokens.color.textMuted,
            background: tokens.color.bgAlt,
            borderTop: `1px solid ${tokens.color.border}`
          }}
        >
          불러오는 중… {visible.length}개
        </div>
      )}
    </div>
  )
}

interface RowProps {
  entry: FileEntryDTO
  index: number
  /** 전체 항목 수(가상 스크롤 aria-setsize 고지용). */
  setSize: number
  top: number
  left: number | string
  width: number | string
  height: number
  selected: boolean
  /** 상단 고정 여부(목록 최상단 배치 + 핀 표식). */
  pinned: boolean
  /** 이 항목에 붙은 태그 키(색상 배지·T1). 빈 배열이면 배지 없음. */
  tags: readonly TagKey[]
  active: boolean
  details: boolean
  /** 자세히 보기 고정폭 열 너비(헤더와 공유 — 정렬 유지). */
  colWidths: DetailsColumnWidths
  /** 아이콘 그리드 셀 모드(J4). null 이면 list/details 행. icon=아이콘 px. */
  grid: { icon: number } | null
  showExt: boolean
  query: string
  panelId: string
  panelPath: string
  dropHighlight: boolean
  renaming: boolean
  initialName: string
  onMouseDownSelect: (index: number, e: React.MouseEvent) => void
  onClickSelect: (index: number, e: React.MouseEvent) => void
  onDouble: (entry: FileEntryDTO) => void
  onContext: (index: number, entry: FileEntryDTO, e: React.MouseEvent) => void
  dragSourcesFor: (entry: FileEntryDTO) => string[]
}

function FileRow({
  entry,
  index,
  setSize,
  top,
  left,
  width,
  height,
  selected,
  pinned,
  tags,
  active,
  details,
  colWidths,
  grid,
  showExt,
  query,
  panelId,
  panelPath,
  dropHighlight,
  renaming,
  initialName,
  onMouseDownSelect,
  onClickSelect,
  onDouble,
  onContext,
  dragSourcesFor
}: RowProps): JSX.Element {
  const bg = dropHighlight
    ? tokens.color.bgHover
    : selected
      ? active
        ? tokens.color.bgSelected
        : tokens.color.bgSelectedInactive
      : 'transparent'
  // 리스킨: 활성 패널에서 선택된 행에 좌측 accent 강조바(목업 "채움 + 바").
  const selBar = selected && active ? `inset 3px 0 0 ${tokens.color.accent}` : undefined
  const name = displayName(entry, showExt)
  const dim = entry.attrs.hidden || entry.attrs.system ? 0.55 : 1
  // 자세히 보기 유형-색(아이콘 타일 + 유형 라벨 공용).
  const typeColor = fileTypeColor(entry)

  // 드래그 소스(이 행에서 시작) + 폴더면 드롭 타겟(그 폴더 안).
  const dragSrc = useDragSource(panelId, panelPath, () => dragSourcesFor(entry))
  // 행 드래그는 native HTML5 dragstart 로 시작(§M M1: allLocal 은 OS 인계, 내부 드롭은
  // onDrop 이 즉시 처리). 드래그 컨텍스트(출발 패널/폴더)도 여기서 등록한다.
  const extDrag = useExternalDragSource(panelId, panelPath, () => dragSourcesFor(entry))
  const folderDrop = useDropTarget({
    panelId,
    destDir: entry.path,
    overEntryPath: entry.isDir ? entry.path : null
  })
  // 폴더 행 HTML5 드롭(드롭 즉시 이동). 파일 행은 드롭 타겟 아님(컨테이너로 버블 → 현재 폴더).
  const folderHtml5 = useHtml5DropTarget({
    panelId,
    destDir: entry.path,
    overEntryPath: entry.isDir ? entry.path : null
  })

  // ── 아이콘 그리드 셀(J4): 아이콘 위·이름 아래(2줄 ellipsis·중앙정렬) ──────
  if (grid) {
    return (
      <div
        role="row"
        aria-selected={selected}
        aria-label={`${name}${entry.isDir ? ', 폴더' : ', 파일'}`}
        aria-posinset={index + 1}
        aria-setsize={setSize}
        onMouseDown={(e) => onMouseDownSelect(index, e)}
        onClick={(e) => onClickSelect(index, e)}
        onContextMenu={(e) => onContext(index, entry, e)}
        onPointerDown={renaming ? undefined : dragSrc.onPointerDown}
        draggable={renaming ? false : extDrag.draggable}
        onDragStart={renaming ? undefined : extDrag.onDragStart}
        onDragEnd={renaming ? undefined : extDrag.onDragEnd}
        onPointerEnter={entry.isDir ? folderDrop.onPointerEnter : undefined}
        onPointerLeave={entry.isDir ? folderDrop.onPointerLeave : undefined}
        onDragOver={entry.isDir ? folderHtml5.onDragOver : undefined}
        onDragLeave={entry.isDir ? folderHtml5.onDragLeave : undefined}
        onDrop={entry.isDir ? folderHtml5.onDrop : undefined}
        onDoubleClick={() => onDouble(entry)}
        title={entry.path}
        style={{
          position: 'absolute',
          top,
          left,
          width,
          height,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'flex-start',
          gap: 4,
          padding: 6,
          boxSizing: 'border-box',
          fontSize: 12,
          color: tokens.color.text,
          opacity: dim,
          background: bg,
          borderRadius: 8,
          boxShadow: selBar,
          outline: dropHighlight ? `2px solid ${tokens.color.accent}` : undefined,
          outlineOffset: -2,
          cursor: 'default',
          userSelect: 'none',
          textAlign: 'center'
        }}
      >
        {pinned && (
          <span
            aria-label="상단 고정됨"
            title="상단 고정됨"
            style={{
              position: 'absolute',
              top: 2,
              left: 4,
              fontSize: 11,
              lineHeight: 1,
              pointerEvents: 'none'
            }}
          >
            📌
          </span>
        )}
        {/* T1: 그리드 태그 코너 점(셀 우상단). */}
        <TagDots tags={tags} variant="grid" />
        <span
          style={{
            flex: '0 0 auto',
            width: grid.icon,
            height: grid.icon,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          {/* 폴더=팩 폴더/드라이브 글리프(OSIcon), 이미지=실제 썸네일, 그 외 파일=팩 유형 아이콘
              (큰/보통 아이콘은 확장자 라벨 표시·작은 아이콘은 글리프만). */}
          {entry.isDir ? (
            <OSIcon entry={entry} size={grid.icon} />
          ) : isThumbnailableExt(entry.ext.toLowerCase()) ? (
            <ThumbnailIcon entry={entry} size={grid.icon} />
          ) : (
            <FileTypeIcon ext={entry.ext} size={grid.icon} showLabel={grid.icon >= 44} />
          )}
        </span>
        {renaming ? (
          <RenameInput panelId={panelId} path={entry.path} initialName={initialName} />
        ) : (
          <span
            style={{
              width: '100%',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              wordBreak: 'break-word',
              lineHeight: 1.3
            }}
          >
            <HighlightedName name={name} query={query} />
          </span>
        )}
      </div>
    )
  }

  return (
    <div
      role="row"
      aria-selected={selected}
      aria-label={`${name}${entry.isDir ? ', 폴더' : ', 파일'}`}
      aria-posinset={index + 1}
      aria-setsize={setSize}
      onMouseDown={(e) => onMouseDownSelect(index, e)}
      onClick={(e) => onClickSelect(index, e)}
      onContextMenu={(e) => onContext(index, entry, e)}
      onPointerDown={renaming ? undefined : dragSrc.onPointerDown}
      draggable={renaming ? false : extDrag.draggable}
      onDragStart={renaming ? undefined : extDrag.onDragStart}
      onDragEnd={renaming ? undefined : extDrag.onDragEnd}
      onPointerEnter={entry.isDir ? folderDrop.onPointerEnter : undefined}
      onPointerLeave={entry.isDir ? folderDrop.onPointerLeave : undefined}
      onDragOver={entry.isDir ? folderHtml5.onDragOver : undefined}
      onDragLeave={entry.isDir ? folderHtml5.onDragLeave : undefined}
      onDrop={entry.isDir ? folderHtml5.onDrop : undefined}
      onDoubleClick={() => onDouble(entry)}
      title={entry.path}
      style={{
        position: 'absolute',
        top,
        left,
        width,
        height,
        display: 'flex',
        alignItems: 'center',
        gap: 11,
        padding: '0 11px',
        boxSizing: 'border-box',
        fontSize: 13.5,
        color: tokens.color.text,
        opacity: dim,
        background: bg,
        borderRadius: 8,
        boxShadow: selBar,
        outline: dropHighlight ? `2px solid ${tokens.color.accent}` : undefined,
        outlineOffset: -2,
        cursor: 'default',
        userSelect: 'none',
        whiteSpace: 'nowrap'
      }}
    >
      {/* 비-그리드(목록/자세히) 공통(템플릿): 유형-색 둥근 타일 + 라인 폴더/파일 아이콘. */}
      <span
        style={{
          flex: '0 0 auto',
          width: 26,
          height: 26,
          borderRadius: 8,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: typeColor,
          background: `color-mix(in srgb, ${typeColor} 16%, transparent)`
        }}
      >
        {entry.isDir ? <FolderLineIcon size={17} /> : <FileTypeIcon ext={entry.ext} size={24} />}
      </span>
      {pinned && (
        <span
          aria-label="상단 고정됨"
          title="상단 고정됨"
          style={{ flex: '0 0 auto', fontSize: 11, lineHeight: 1, marginLeft: -2 }}
        >
          📌
        </span>
      )}
      {renaming ? (
        <RenameInput panelId={panelId} path={entry.path} initialName={initialName} />
      ) : (
        <span
          style={{
            flex: details ? '1 1 40%' : '1 1 auto',
            minWidth: 0,
            display: 'inline-flex',
            alignItems: 'center',
            overflow: 'hidden'
          }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
            <HighlightedName name={name} query={query} />
          </span>
          {/* T1: 이름 옆 태그 색상 점(자세히·목록 공통). */}
          <TagDots tags={tags} variant="details" />
        </span>
      )}
      {details && (
        <>
          {/* 고정폭 열은 헤더(ColumnHeader)와 동일한 colWidths 를 읽어 정렬을 유지한다. */}
          <span
            style={{
              flex: `0 0 ${colWidths.size}px`,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              textAlign: 'right',
              fontSize: 12,
              color: tokens.color.textMuted,
              fontVariantNumeric: 'tabular-nums'
            }}
          >
            {/* T2: 폴더는 lazy 스캔 총 용량, 파일은 자기 크기(formatSize). */}
            {entry.isDir ? <FolderSize path={entry.path} /> : formatSize(entry)}
          </span>
          <span
            style={{
              flex: `0 0 ${colWidths.type}px`,
              boxSizing: 'border-box',
              paddingRight: 6,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              textAlign: 'right',
              // 리스킨(템플릿): 유형 라벨을 유형-색으로 강조(폴더=accent·파일=카테고리색).
              fontSize: 10.5,
              fontWeight: 600,
              letterSpacing: '.03em',
              color: typeColor
            }}
          >
            {entry.isDir ? '폴더' : entry.ext ? entry.ext.toUpperCase() : '파일'}
          </span>
          <span
            style={{
              flex: `0 0 ${colWidths.mtime}px`,
              boxSizing: 'border-box',
              paddingRight: 6,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              textAlign: 'right',
              fontSize: 11,
              color: tokens.color.textMuted,
              fontVariantNumeric: 'tabular-nums'
            }}
          >
            {formatMtime(entry.mtime)}
          </span>
        </>
      )}
    </div>
  )
}

/**
 * ColumnHeader — 자세히(details) 보기 열 헤더 밴드(이름 | 크기 | 유형 | 수정한 날짜).
 *
 * 스크롤 컨테이너 최상단에 `position: sticky; top: 0` 으로 고정되며 핀(고정) sticky
 * 밴드(top: headerH)보다 위(zIndex 4 > 3)에 쌓인다. **행 레이아웃과 정확히 동일한**
 * 좌측 패딩(ROW_PAD_X)·아이콘폭+gap(ROW_ICON_W+ROW_ICON_GAP) 선행 spacer 로 "이름"
 * 라벨을 행의 파일명과 같은 x 에 정렬한다. 고정폭 3열은 행과 같은 colWidths·textAlign 을
 * 쓴다. 각 고정폭 열 왼쪽 경계(이름↔크기 포함)에 드래그 가능한 구분자를 둔다.
 *
 * 정렬: 각 열 라벨을 클릭하면 해당 키로 정렬한다(이름→name·크기→size·유형→ext·
 * 수정한 날짜→mtime). 현재 정렬 열은 ▲(asc)/▼(desc) 표식을 보이며, 같은 열 재클릭 시
 * 방향이 토글된다(setSort 가 처리). 기존 툴바 정렬 드롭다운을 대체한다.
 *
 * a11y: 헤더 행은 role="row", 각 열은 role="columnheader" + aria-sort(ascending/
 * descending/none). 라벨은 <button> 으로 키보드 정렬 가능. 구분자만 role="separator"
 * aria-orientation="vertical" + 화살표키 ±8px 리사이즈.
 */
function ColumnHeader({
  widths,
  height,
  onResize,
  sortKey,
  sortDir,
  onSort
}: {
  widths: DetailsColumnWidths
  height: number
  onResize: (col: DetailsColumn, px: number) => void
  sortKey: SortKey
  sortDir: SortDir
  onSort: (key: SortKey) => void
}): JSX.Element {
  const labelStyle = (align: 'left' | 'right' | 'center'): React.CSSProperties => ({
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    textAlign: align,
    color: tokens.color.textMuted,
    fontWeight: 600
  })
  const ariaSort = (key: SortKey): 'ascending' | 'descending' | 'none' =>
    sortKey === key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'
  return (
    <div
      role="row"
      style={{
        position: 'sticky',
        top: 0,
        // 헤더는 핀 밴드(zIndex 3)·본문 위. 박스선택 오버레이(2)·본문보다 항상 위.
        zIndex: 4,
        height,
        display: 'flex',
        alignItems: 'center',
        gap: ROW_ICON_GAP,
        padding: `0 ${ROW_PAD_X}px`,
        boxSizing: 'border-box',
        fontSize: 12,
        userSelect: 'none',
        whiteSpace: 'nowrap',
        // 본문을 가리도록 불투명(살짝 떠 있는 헤더 표면) + 하단 강조 구분선.
        background: tokens.color.elevated,
        boxShadow: `inset 0 -1px 0 ${tokens.color.borderStrong}`
      }}
    >
      {/* 행 아이콘(ROW_ICON_W) 자리 — 행 파일명과 같은 x 기준 선행 spacer. */}
      <span aria-hidden style={{ flex: '0 0 auto', width: ROW_ICON_W, height: ROW_ICON_W }} />
      {/* 이름 열: 남은 공간 flex(행의 name span flex '1 1 40%' 과 동일 비중)·헤더명 왼쪽 정렬. */}
      <span role="columnheader" aria-sort={ariaSort('name')} style={{ flex: '1 1 40%', minWidth: 0 }}>
        <SortLabel label="이름" align="left" active={sortKey === 'name'} dir={sortDir} onClick={() => onSort('name')} labelStyle={labelStyle} />
      </span>
      {/* 크기 열(왼쪽 경계에 이름↔크기 구분자)·헤더명 중앙정렬. */}
      <span role="columnheader" aria-sort={ariaSort('size')} style={{ flex: `0 0 ${widths.size}px`, position: 'relative' }}>
        <ColumnDivider col="size" widthNow={widths.size} onResize={onResize} />
        <SortLabel label="크기" align="center" active={sortKey === 'size'} dir={sortDir} onClick={() => onSort('size')} labelStyle={labelStyle} />
      </span>
      {/* 유형 열·헤더명 중앙정렬(정렬 키는 ext). */}
      <span role="columnheader" aria-sort={ariaSort('ext')} style={{ flex: `0 0 ${widths.type}px`, position: 'relative' }}>
        <ColumnDivider col="type" widthNow={widths.type} onResize={onResize} />
        <SortLabel label="유형" align="center" active={sortKey === 'ext'} dir={sortDir} onClick={() => onSort('ext')} labelStyle={labelStyle} />
      </span>
      {/* 수정한 날짜 열·헤더명 중앙정렬(정렬 키는 mtime). */}
      <span role="columnheader" aria-sort={ariaSort('mtime')} style={{ flex: `0 0 ${widths.mtime}px`, position: 'relative' }}>
        <ColumnDivider col="mtime" widthNow={widths.mtime} onResize={onResize} />
        <SortLabel label="수정한 날짜" align="center" active={sortKey === 'mtime'} dir={sortDir} onClick={() => onSort('mtime')} labelStyle={labelStyle} />
      </span>
    </div>
  )
}

/**
 * SortLabel — 열 헤더 라벨 버튼(클릭 정렬). 현재 정렬 열이면 방향 표식(▲/▼)을 덧붙인다.
 * 테두리 없는 투명 버튼으로 헤더 라벨처럼 보이되 클릭/키보드(Enter/Space)로 정렬한다.
 * 활성 열은 강조색(text)·굵게, 비활성은 기존 muted 라벨 스타일을 유지한다.
 */
function SortLabel({
  label,
  align,
  active,
  dir,
  onClick,
  labelStyle
}: {
  label: string
  align: 'left' | 'right' | 'center'
  active: boolean
  dir: SortDir
  onClick: () => void
  labelStyle: (align: 'left' | 'right' | 'center') => React.CSSProperties
}): JSX.Element {
  const justify = align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center'
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${label} 기준 정렬`}
      style={{
        ...labelStyle(align),
        width: '100%',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: justify,
        gap: 3,
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        padding: 0,
        fontSize: 'inherit',
        fontFamily: 'inherit',
        color: active ? tokens.color.text : tokens.color.textMuted,
        fontWeight: 600
      }}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
      {active && (
        <span aria-hidden style={{ flex: '0 0 auto', fontSize: 10, color: tokens.color.accent }}>
          {dir === 'asc' ? '▲' : '▼'}
        </span>
      )}
    </button>
  )
}

/**
 * ColumnDivider — 열 왼쪽 경계의 드래그 리사이즈 핸들(자세히 헤더).
 *
 * 해당 열의 **왼쪽 경계**를 끌어 그 열의 px 너비를 조절한다(왼쪽으로 끌면 넓어짐).
 * 포인터: pointerdown 에서 setPointerCapture → pointermove 로 delta 반영 → pointerup.
 * 키보드: 좌/우 화살표 ±8px(WCAG 2.1.1). clampColumnWidth(슬라이스 setter)가 하한/상한
 * 보장. role="separator" aria-orientation="vertical".
 */
function ColumnDivider({
  col,
  widthNow,
  onResize
}: {
  col: DetailsColumn
  widthNow: number
  onResize: (col: DetailsColumn, px: number) => void
}): JSX.Element {
  // 드래그 세션 상태(시작 X·시작 너비). pointer capture 로 window 리스너 불요.
  const dragRef = useRef<{ startX: number; startW: number } | null>(null)
  const [activeDrag, setActiveDrag] = useState(false)
  const [hover, setHover] = useState(false)

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLSpanElement>) => {
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation() // 컨테이너 박스선택 시작 방지.
      dragRef.current = { startX: e.clientX, startW: widthNow }
      setActiveDrag(true)
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [widthNow]
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLSpanElement>) => {
      const d = dragRef.current
      if (!d) return
      // 열 왼쪽 경계를 끌므로 오른쪽 이동(+dx)은 열을 좁게(−), 왼쪽 이동은 넓게(+).
      const dx = e.clientX - d.startX
      onResize(col, d.startW - dx)
    },
    [col, onResize]
  )

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLSpanElement>) => {
    dragRef.current = null
    setActiveDrag(false)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }, [])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLSpanElement>) => {
      // 화살표 ±8px(WCAG 2.1.1 키보드 조작 대안). 다른 키는 전역 디스패처로 통과.
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        e.stopPropagation()
        onResize(col, widthNow - 8)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        e.stopPropagation()
        onResize(col, widthNow + 8)
      }
    },
    [col, widthNow, onResize]
  )

  // 평상시에도 보이는 구분선(borderStrong) → 어디를 잡는지 명확. hover/드래그 시 accent·굵게.
  const emphasize = activeDrag || hover
  return (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label="열 너비 조절"
      title="열 너비 조절 (드래그하거나 ←/→)"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onKeyDown={onKeyDown}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'absolute',
        top: 0,
        // 경계 중앙에 넓은 잡기 영역(폭 11px·중앙 정렬)으로 드래그를 쉽게 한다.
        left: -5,
        width: 11,
        height: '100%',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        cursor: 'col-resize',
        background: 'transparent',
        touchAction: 'none'
      }}
    >
      {/* 항상 보이는 세로 구분선(헤더 전체 높이). 평상시 borderStrong, 강조 시 accent·3px. */}
      <span
        aria-hidden
        style={{
          width: emphasize ? 3 : 1,
          height: '100%',
          background: emphasize ? tokens.color.accent : tokens.color.borderStrong,
          pointerEvents: 'none'
        }}
      />
    </span>
  )
}

/**
 * OSIcon — 항목 아이콘. **파일**은 OS 실제 아이콘(확장자 캐시, H6), **폴더/드라이브**는
 * 결정적 SVG 글리프(노란 폴더 / 회색 디스크 / 링크 폴더+화살표).
 *
 * 폴더/드라이브에 OS 아이콘을 쓰던 방식은 정션(재배치 AppData 등) 환경에서 공유 '__dir__'
 * 캐시가 디스크 아이콘으로 오염돼 일반 폴더가 디스크로 보이는 문제가 있어 글리프로 표준화했다.
 * 파일 OS 아이콘 캐시는 useSyncExternalStore 구독 유지(셀렉터 격리, SA §5.2).
 */
function OSIcon({ entry, size = 16 }: { entry: FileEntryDTO; size?: number }): JSX.Element {
  const isDir = entry.isDir
  const key = iconKeyFor(entry)
  const dataUrl = useSyncExternalStore(subscribeIcon, () => getCachedIcon(key))

  useEffect(() => {
    // 파일만 OS 아이콘 로드(폴더/드라이브는 결정적 SVG → 요청 불요).
    if (!isDir && !getCachedIcon(key)) void requestIcon(entry)
  }, [key, entry, isDir])

  if (isDir) {
    if (isDriveFolder(entry)) return <DriveGlyph size={size} />
    return <FolderGlyph size={size} link={isLinkFolder(entry)} />
  }

  if (dataUrl) {
    // OS 아이콘은 저해상도(16/32)일 수 있으나 그리드 셀 크기에 맞춰 확대 렌더.
    return (
      <img
        src={dataUrl}
        width={size}
        height={size}
        alt=""
        draggable={false}
        style={{ imageRendering: size > 32 ? 'auto' : undefined }}
      />
    )
  }
  return (
    <span aria-hidden style={{ fontSize: size > 16 ? size * 0.8 : undefined }}>
      📄
    </span>
  )
}

/**
 * 썸네일 요청 DPR — 셀 아이콘 px × DPR 로 버킷 size 를 산출(레티나에서 선명도 확보).
 * 상한 2 로 클램프해 4K/스케일 환경에서도 버킷이 [32,48,64,96,128] 범위를 넘지 않게 한다
 * (guard 의 size 화이트리스트 통과 보장 + 메모리/디코드 폭주 방지). 모듈 로드 시 1회 산출.
 */
const THUMB_DPR = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1)

/**
 * ThumbnailIcon — 그리드 셀의 이미지 entry 를 실제 내용 축소 썸네일로 표시(feat-L1, 계획서 §5.3).
 *
 * OSIcon 동형: 전역 썸네일 캐시(infra/icon/thumbnailCache, app/usecases/thumbnails 경유)를
 * useSyncExternalStore 로 구독한다. 같은 path+size 키는 IPC 1회만(in-flight 디듀프), 실패/미지원은
 * 음성 캐시로 재요청 억제. 가시 셀만 요청은 윈도잉 루프가 보장(가시범위 밖 셀은 언마운트).
 *
 *   (a) 썸네일 dataUrl 있음 → <img objectFit:contain>(비율 보존·레터박스, 정사각 셀에서 왜곡 없음).
 *   (b) 미로드/폴백(null) → OSIcon(기존 H6) — 로딩 중에도 OS 아이콘이 자연스러운 자리표시.
 * 비이미지(폴더·미지원 ext)는 호출측(그리드 분기)에서 곧장 OSIcon 으로 분기되어 여기 도달 안 함.
 */
function ThumbnailIcon({ entry, size }: { entry: FileEntryDTO; size: number }): JSX.Element {
  // 요청 size = 셀 아이콘 px × DPR → 버킷 스냅(THUMB_SIZE_BUCKETS, guard 화이트리스트와 동일).
  const px = thumbSizeFor(size, THUMB_DPR)
  const key = thumbnailKeyFor(entry.path, px, entry.mtime)
  const dataUrl = useSyncExternalStore(subscribeThumbnail, () => getCachedThumbnail(key))

  useEffect(() => {
    // 미캐시(성공/음성 어느 쪽도 없음)면 1회 요청 — 캐시는 requestThumbnail 내부에서 디듀프.
    // mtime 포함 → 파일 교체 시 키가 바뀌어 새 썸네일을 재요청(stale 방지).
    if (getCachedThumbnail(key) === undefined) void requestThumbnail(entry.path, px, entry.mtime)
  }, [key, entry.path, px, entry.mtime])

  if (dataUrl) {
    // 비율 보존(objectFit:contain) — 비정사각 이미지가 정사각 셀에서 왜곡되지 않고 레터박스.
    return (
      <img
        src={dataUrl}
        alt=""
        draggable={false}
        style={{ objectFit: 'contain', maxWidth: size, maxHeight: size }}
      />
    )
  }
  // 미로드/폴백(null=음성 캐시) → OSIcon 폴백(기존 H6).
  return <OSIcon entry={entry} size={size} />
}

/**
 * 인라인 이름편집 input (F2·새 항목). Enter=커밋, Esc=취소, blur=커밋.
 * 확장자 앞부분만 선택(파일명 편집 편의). 커밋 실패(EEXIST/EINVAL) 시 편집 유지.
 */
function RenameInput({
  panelId,
  path,
  initialName
}: {
  panelId: string
  path: string
  initialName: string
}): JSX.Element {
  const [value, setValue] = useState(initialName)
  const endRename = useRootStore((s) => s.endRename)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const committingRef = useRef(false)

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.focus()
    // 확장자 앞 이름 부분만 선택.
    const dot = initialName.lastIndexOf('.')
    if (dot > 0) el.setSelectionRange(0, dot)
    else el.select()
  }, [initialName])

  async function commit(): Promise<void> {
    if (committingRef.current) return
    committingRef.current = true
    if (value.trim() === initialName) {
      endRename()
      return
    }
    const ok = await commitRename(panelId, path, value)
    if (!ok) {
      committingRef.current = false
      inputRef.current?.focus()
    }
  }

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') {
          e.preventDefault()
          void commit()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          endRename()
        }
      }}
      onBlur={() => void commit()}
      spellCheck={false}
      aria-label="이름 편집"
      style={{
        flex: '1 1 40%',
        height: 20,
        minWidth: 0,
        boxSizing: 'border-box',
        border: `1px solid ${tokens.color.accentBorder}`,
        borderRadius: 3,
        padding: '0 4px',
        fontSize: 13,
        fontFamily: tokens.font
        // 키보드 포커스 가시성은 전역 :focus-visible(a11y CSS)에 위임(인라인 outline 제거).
      }}
    />
  )
}

/**
 * TagDots — 행의 태그 색상 점(T1). details=이름 뒤 인라인 작은 점들, grid=좌상단 코너 점.
 * 각 점은 aria-label("태그: 빨강")로 스크린리더에 고지한다(role="grid" 무간섭 — span).
 */
function TagDots({
  tags,
  variant
}: {
  tags: readonly TagKey[]
  variant: 'details' | 'grid'
}): JSX.Element | null {
  if (tags.length === 0) return null
  const size = variant === 'grid' ? 8 : 7
  if (variant === 'grid') {
    // 그리드: 좌상단 코너에 점들을 세로로 약간 겹쳐 쌓는다(셀 콘텐츠 위 절대배치).
    return (
      <span
        style={{
          position: 'absolute',
          top: 3,
          right: 4,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          pointerEvents: 'none'
        }}
      >
        {tags.map((k) => (
          <Dot key={k} k={k} size={size} />
        ))}
      </span>
    )
  }
  // 자세히: 이름 뒤 인라인 점들(가로).
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, marginLeft: 6, flex: '0 0 auto' }}>
      {tags.map((k) => (
        <Dot key={k} k={k} size={size} />
      ))}
    </span>
  )
}

/** 단일 태그 색상 점(aria-label 고지). */
function Dot({ k, size }: { k: TagKey; size: number }): JSX.Element {
  const meta = tagColorOf(k)
  return (
    <span
      role="img"
      aria-label={`태그: ${meta?.name ?? k}`}
      title={meta?.name ?? k}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        flex: '0 0 auto',
        background: meta?.color ?? tokens.color.textMuted,
        boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.18)'
      }}
    />
  )
}

/**
 * FolderSize — 자세히 보기 폴더 행의 크기 열 인라인 총 용량(T2). lazy 캐시(folderSize)를
 * useSyncExternalStore 로 구독한다(썸네일/아이콘 캐시 동형). 미캐시면 1회 요청하고 산출
 * 전까지 "—" 폴백(렌더 비차단). 가시 윈도에 실제 렌더되는 폴더 행만 요청(eager 금지).
 */
function FolderSize({ path }: { path: string }): JSX.Element {
  const bytes = useSyncExternalStore(subscribeFolderSize, () => getCachedFolderSize(path))

  useEffect(() => {
    if (getCachedFolderSize(path) === undefined) void requestFolderSize(path)
  }, [path])

  if (bytes === undefined) {
    return (
      <span aria-label="폴더 용량 계산 중" style={{ color: tokens.color.textMuted }}>
        —
      </span>
    )
  }
  return <>{formatBytes(bytes)}</>
}

/** 바이트 사람친화 표기(폴더 합계용 — formatSize 와 동일 단위 규칙). */
function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`
  return `${(b / 1024 / 1024 / 1024).toFixed(1)} GB`
}

/** 검색어 매칭 구간을 하이라이트해 이름을 렌더(부분일치 쿼리만). */
function HighlightedName({ name, query }: { name: string; query: string }): JSX.Element {
  const range = highlightRange(name, query)
  if (!range) return <>{name}</>
  return (
    <>
      {name.slice(0, range.start)}
      <mark
        style={{
          background: tokens.color.highlight,
          color: 'inherit',
          borderRadius: 2,
          padding: '0 1px'
        }}
      >
        {name.slice(range.start, range.end)}
      </mark>
      {name.slice(range.end)}
    </>
  )
}

function CenterMsg({
  text,
  muted,
  error
}: {
  text: string
  muted?: boolean
  error?: boolean
}): JSX.Element {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: error ? tokens.color.danger : muted ? tokens.color.textMuted : tokens.color.text,
        fontSize: 13,
        background: tokens.color.bg
      }}
    >
      {text}
    </div>
  )
}
