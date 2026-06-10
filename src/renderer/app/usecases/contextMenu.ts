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
import { execCommand } from './commandBus'
import { openTerminalAt, openWithEntry, showPropertiesFor } from './open'
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
  /** 클릭/Enter 시 실행(separator 는 없음). */
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

  // ── 열기 그룹(단일 전용) ──────────────────────────────────────────────
  if (!multi && single) {
    // 폴더=진입, 파일=연결 프로그램 실행. 둘 다 panel.activate(activateEntry) 로 수렴.
    items.push({ id: 'open', label: '열기', run: cmd('panel.activate') })
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
