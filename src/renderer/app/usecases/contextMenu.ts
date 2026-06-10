/**
 * 컨텍스트 메뉴 유스케이스 (app/usecases/contextMenu) — 우클릭 → 선택 보정 → 메뉴 열기.
 *
 * roadmap P4(frontend): 마우스 우클릭이 키보드/툴바와 동일한 commandId 경로로 수렴하도록
 * 메뉴 클릭은 commandBus.execCommand 또는 단일 전용 usecase(openWithEntry·showPropertiesFor)
 * 를 호출한다. 이 모듈은 (a) 우클릭 시 활성 패널·선택 보정, (b) 컨텍스트별 메뉴 항목 산출을
 * 담당한다. 실제 메뉴 렌더·키보드·경계 보정은 ui/contextmenu/ContextMenu 가 처리한다.
 *
 * 경계: app → store(액션)·usecases. UI 는 이 usecase 경유로만 호출(ui→infra 직접 import 금지).
 */
import type { FileEntryDTO } from '@shared/dto'
import { store } from '@renderer/app/stores/rootStore'
import { isMyPc } from '@renderer/domain/paths'
import { locationKindOf } from '@renderer/domain/rules/remoteLocation'
import { isZipFile } from '@renderer/domain/rules/archiveSession'
import { TAG_PALETTE, type TagKey } from '@renderer/domain/rules/tags'
import { execCommand } from './commandBus'
import { openTerminalAt, openWithEntry, showPropertiesFor } from './open'
import { openArchiveAsFolder, extractToLocal } from './archive'
import { panelPaths } from './fileOps'
import { comparePanelsOf } from './compare'
import { visibleEntries } from './selectors'

/** 메뉴 항목 1개. separator 면 구분선만 그린다. */
export interface MenuItem {
  /** 안정적 식별자(React key·테스트). */
  readonly id: string
  /** 표시 라벨('separator' 면 무시). */
  readonly label?: string
  /** 구분선 여부. */
  readonly separator?: boolean
  /** 위험 동작(삭제) 강조 표시. */
  readonly danger?: boolean
  /** 체크 상태(토글 메뉴 — 태그 on/off). 표시는 ✓ 마커(undefined=비체크 미표시). */
  readonly checked?: boolean
  /** 앞쪽 색상 점(태그 색상 등). CSS color — 있으면 라벨 앞에 작은 점 표시. */
  readonly dotColor?: string
  /**
   * 하위 메뉴(있으면 이 항목 hover/→ 시 플라이아웃). 가지면 run 은 보통 없다.
   * 태그("태그") 색상 토글 목록을 담는다(T1).
   */
  readonly children?: MenuItem[]
  /** 클릭/Enter 시 실행(separator·children 보유 항목은 없을 수 있음). */
  readonly run?: () => void
}

/** 우클릭 시점의 메뉴 구성 입력. */
interface MenuContext {
  /** 현재 선택 경로 집합. */
  readonly selectedPaths: ReadonlySet<string>
  /** 단일 선택 항목(있으면). 다중/없음이면 null. */
  readonly singleEntry: FileEntryDTO | null
}

/**
 * 활성 패널 선택을 화면 순서 entry 배열로 매핑(라벨용 단일 항목 판정).
 * visibleEntries 로 경로→entry 를 만든다(이름·isDir 참조).
 */
function buildContext(panelId: string): MenuContext {
  const sel = store.getState().selection[panelId]
  const selectedPaths = sel?.selectedPaths ?? new Set<string>()
  let singleEntry: FileEntryDTO | null = null
  if (selectedPaths.size === 1) {
    const only = selectedPaths.values().next().value as string | undefined
    if (only) singleEntry = visibleEntries(panelId).find((e) => e.path === only) ?? null
  }
  return { selectedPaths, singleEntry }
}

/** commandId 발행 단축 헬퍼(메뉴 클릭 → 키보드/툴바와 동일 경로). */
function cmd(commandId: string): () => void {
  return () => {
    execCommand(commandId)
  }
}

/**
 * "태그" 하위 메뉴(T1) — 선택 경로(들)에 색상 라벨 토글. 다중 선택 시 모든 선택 항목에
 * 동일하게 토글한다. 체크 기준: 단일은 그 항목, 다중은 **모든** 항목에 해당 태그가
 * 있으면 체크(부분 적용은 미체크 — 토글하면 전부 추가). 신규 채널 0(렌더러 store 전용).
 */
function buildTagSubmenu(paths: string[]): MenuItem {
  const st = store.getState()
  const allHave = (key: TagKey): boolean =>
    paths.length > 0 && paths.every((p) => st.tagsFor(p).includes(key))
  const children: MenuItem[] = TAG_PALETTE.map((c) => {
    const checked = allHave(c.key)
    return {
      id: `tag-${c.key}`,
      label: c.name,
      dotColor: c.color,
      checked,
      run: () => {
        const s = store.getState()
        // 모두 체크면 전부 제거, 아니면 전부 추가(일관 토글).
        for (const p of paths) {
          const has = s.tagsFor(p).includes(c.key)
          if (checked && has) s.toggleTag(p, c.key)
          else if (!checked && !has) s.toggleTag(p, c.key)
        }
      }
    }
  })
  // "태그 지우기" — 선택 항목의 모든 태그 제거(어느 항목에든 태그가 있을 때만 노출).
  const anyTagged = paths.some((p) => st.tagsFor(p).length > 0)
  if (anyTagged) {
    children.push({ id: 'tag-sep', separator: true })
    children.push({
      id: 'tag-clear',
      label: '태그 지우기',
      run: () => {
        const s = store.getState()
        for (const p of paths) s.clearTags(p)
      }
    })
  }
  return { id: 'tags', label: '태그', children }
}

/**
 * 컨텍스트별 메뉴 항목 산출(표시·활성 규칙).
 *  - 단일 파일: 열기 / 연결 프로그램으로 열기 / 복사·잘라내기·이름변경 / 삭제·영구삭제 / 속성
 *  - 단일 폴더: 열기 / 복사·잘라내기·이름변경 / 삭제·영구삭제 / 속성 (연결 프로그램 제외)
 *  - 다중 선택: 복사·잘라내기 / 삭제·영구삭제 (이름변경·연결프로그램·속성은 단일 전용)
 *  - 빈 영역: 붙여넣기 / 새 폴더 / 새로고침
 */
export function buildMenuItems(panelId: string, targetPath: string | null): MenuItem[] {
  const ctx = buildContext(panelId)

  // 빈 영역(대상 없음) ─ 붙여넣기/새 폴더/새로고침.
  // My PC(드라이브 목록)에는 붙여넣기·새 폴더가 불가하므로 새로고침만 노출(QA 보통-1).
  if (targetPath === null) {
    const panelPath = store.getState().panels[panelId]?.path ?? ''
    if (isMyPc(panelPath)) {
      return [{ id: 'refresh', label: '새로고침', run: cmd('panel.refresh') }]
    }
    const empty: MenuItem[] = [
      { id: 'paste', label: '붙여넣기', run: cmd('file.paste') },
      { id: 'sep-empty', separator: true },
      { id: 'newFolder', label: '새 폴더', run: cmd('file.newFolder') }
    ]
    // 터미널 열기: 비-MyPc 실존 디렉토리 경로일 때만(붙여넣기·새폴더 다음/새로고침 앞).
    // 노출 시에만 separator 추가(§1.7 배치). panelPath 는 navigate 가 보장하는 실존 디렉토리.
    if (!isMyPc(panelPath) && panelPath !== '') {
      empty.push({ id: 'terminal', label: '터미널 열기', run: () => void openTerminalAt(panelPath) })
      empty.push({ id: 'sep-terminal', separator: true })
    }
    // §P1: "다른 패널과 비교"(좌우 2분할일 때만). 두 패널 폴더를 메타 4상태로 diff.
    if (comparePanelsOf() !== null) {
      empty.push({ id: 'compare', label: '다른 패널과 비교', run: cmd('compare.toggle') })
      empty.push({ id: 'sep-compare', separator: true })
    }
    empty.push({ id: 'refresh', label: '새로고침', run: cmd('panel.refresh') })
    return empty
  }

  const multi = ctx.selectedPaths.size > 1
  const single = ctx.singleEntry
  const items: MenuItem[] = []

  // §Q1: 현재 패널이 압축 내부인지(추출 메뉴 노출 판정). targetPath 가 archive:// URI 면 압축 항목.
  const inArchive = targetPath !== null && locationKindOf(targetPath) === 'archive'

  // ── 압축: "추출"(압축 내부 항목 — 단일/다중 모두). 도착지=다른 패널의 로컬 폴더. ──────
  // 도착지가 준비 안 됐어도 메뉴는 노출(클릭 시 안내) — 발견성 우선. 도착지 해석은 클릭 시점
  // (최신 패널 상태)에 한다(메뉴를 띄운 뒤 반대편을 옮길 수 있으므로).
  if (inArchive) {
    const sources = single ? [single.path] : [...ctx.selectedPaths]
    items.push({
      id: 'extract',
      label: '추출',
      run: () => {
        const d = panelPaths().otherPath
        if (typeof d === 'string' && locationKindOf(d) === 'local' && !isMyPc(d)) {
          void extractToLocal(sources, d)
        } else {
          store.getState().pushToast('info', '추출하려면 반대편 패널을 로컬 폴더로 여세요.')
        }
      }
    })
    items.push({ id: 'sep-extract', separator: true })
  }

  // ── 열기 그룹(단일 전용) ──────────────────────────────────────────────
  if (!multi && single) {
    // 폴더=진입, 파일=연결 프로그램 실행. 둘 다 panel.activate(activateEntry) 로 수렴.
    items.push({ id: 'open', label: '열기', run: cmd('panel.activate') })
    // §Q1: 로컬 .zip 단일 선택 시 "폴더처럼 열기"(archive:open → archive://zip!/ 이동).
    if (!single.isDir && isZipFile(single.name) && locationKindOf(single.path) === 'local') {
      items.push({
        id: 'openAsFolder',
        label: '폴더처럼 열기',
        run: () => void openArchiveAsFolder(panelId, single.path)
      })
    }
    // 단일 디렉토리 선택만 "터미널 열기"(열기 그룹 내, 열기 바로 다음). 파일은 cwd 개념 부적합.
    if (single.isDir) {
      items.push({
        id: 'terminal',
        label: '터미널 열기',
        run: () => void openTerminalAt(single.path)
      })
    }
    // §R2: 단일 폴더 선택 시 "중복 찾기"(활성 패널 폴더 범위로 hash:dup 탐지).
    // 현재 usecase 는 활성 패널 폴더를 범위로 쓰므로, 선택 폴더로 진입 후 찾는 흐름은
    // 1차로 활성 패널 폴더 기준(메뉴는 진입점만 제공·계획서 §4.1 "현재 패널 폴더").
    if (single.isDir) {
      items.push({ id: 'dedup', label: '중복 찾기', run: cmd('dedup.open') })
      // §V10 자동링크: 이 폴더를 다른 위치로 복사 + 원본자리에 정션(원본은 백업으로 보존).
      items.push({
        id: 'autoLink',
        label: '자동링크…',
        run: () => store.getState().openAutoLink(single.path)
      })
    }
    if (!single.isDir) {
      items.push({
        id: 'openWith',
        label: '연결 프로그램으로 열기',
        run: () => void openWithEntry(single)
      })
    }
    items.push({ id: 'sep-open', separator: true })
  }

  // ── 편집 그룹 ─────────────────────────────────────────────────────────
  items.push({ id: 'copy', label: '복사', run: cmd('file.copy') })
  items.push({ id: 'cut', label: '잘라내기', run: cmd('file.cut') })
  if (!multi && single) {
    items.push({ id: 'rename', label: '이름 바꾸기', run: cmd('file.rename') })
    // 상단 고정(pin) 토글 — 현재 패널(디렉토리) 기준. 파일·폴더 단일 선택 모두 허용.
    const dirPath = store.getState().panels[panelId]?.path ?? ''
    const pinnedNow = store.getState().isPinned(dirPath, single.path)
    items.push({
      id: 'pin',
      label: pinnedNow ? '상단 고정 해제' : '상단 고정',
      run: () => store.getState().togglePin(dirPath, single.path)
    })
  }
  // §R1: 다중 선택(2+) 시 "고급 이름변경…"(단일은 위 인라인 F2). Ctrl+Shift+R 과 동일 경로.
  if (multi) {
    items.push({ id: 'batchRename', label: '고급 이름변경…', run: cmd('file.batchRename') })
  }

  // ── 태그 그룹(T1) — 단일/다중 선택 모두. 색상 라벨 토글 하위 메뉴. ────────
  {
    const tagPaths = single ? [single.path] : [...ctx.selectedPaths]
    if (tagPaths.length > 0) items.push(buildTagSubmenu(tagPaths))
  }

  // ── 삭제 그룹 ─────────────────────────────────────────────────────────
  items.push({ id: 'sep-del', separator: true })
  items.push({ id: 'trash', label: '삭제(휴지통)', danger: true, run: cmd('file.trash') })
  items.push({
    id: 'deletePermanent',
    label: '영구 삭제',
    danger: true,
    run: cmd('file.deletePermanent')
  })

  // ── 속성 그룹(단일 전용) ──────────────────────────────────────────────
  if (!multi && single) {
    items.push({ id: 'sep-props', separator: true })
    items.push({ id: 'properties', label: '속성', run: () => void showPropertiesFor(single.path) })
  }

  return items
}

/**
 * 파일 목록 행 우클릭 → 활성 패널 전환 + 선택 보정(탐색기 표준) + 메뉴 열기.
 *
 * 우클릭한 항목이 현재 선택에 없으면 그 항목만 단일 선택으로 바꾼다(이미 선택에
 * 포함되어 있으면 기존 다중 선택 유지 — 여러 항목 일괄 작업 의도 보존).
 */
export function openRowContextMenu(
  panelId: string,
  entry: FileEntryDTO,
  visiblePaths: readonly string[],
  index: number,
  clientX: number,
  clientY: number
): void {
  const s = store.getState()
  // 활성 패널 전환(명령은 활성 패널 기준이므로 메뉴 열기 전에 보장).
  const tab = s.activeTab()
  if (tab && tab.activePanelId !== panelId) s.setActivePanel(tab.id, panelId)

  const sel = s.selection[panelId]
  const inSelection = sel?.selectedPaths.has(entry.path) ?? false
  if (!inSelection) {
    // 선택 밖 항목 우클릭 → 그 항목만 단일 선택.
    s.clickSelect(panelId, visiblePaths, index, false, false)
  }

  s.openContextMenu({ x: clientX, y: clientY, panelId, targetPath: entry.path })
}

/** 패널 빈 영역 우클릭 → 활성 패널 전환 + (대상 없음) 메뉴 열기. */
export function openEmptyContextMenu(panelId: string, clientX: number, clientY: number): void {
  const s = store.getState()
  const tab = s.activeTab()
  if (tab && tab.activePanelId !== panelId) s.setActivePanel(tab.id, panelId)
  s.openContextMenu({ x: clientX, y: clientY, panelId, targetPath: null })
}
