/**
 * CommandBus — commandId → 유스케이스 실행 (SA §7.1 명령 패턴).
 *
 * 단축키(Dispatcher)·메뉴·버튼이 같은 commandId 를 발행하면 여기서 단일 처리.
 * 스토어 액션을 조합한다. P4 에서 동작 연결할 명령(file.* 등)은
 * 키 등록은 되어 있으나 여기서는 안내 토스트 또는 no-op 로 둔다(roadmap P3).
 *
 * P2/P3 에서 실제 동작하는 명령: tab.* / panel.focus* / layout.toggleSplit2 /
 * nav.* / panel.refresh / select.all / address.edit / search.open / panel.activate.
 */
import { store } from '@renderer/app/stores/rootStore'
import { activateSelected } from './open'
import { visibleEntries } from './selectors'
import {
  cancelOperation,
  createNewFolder,
  requestPermanentDelete,
  startRenameSelected,
  trashSelected
} from './fileOps'
// §M M2: 복사/잘라내기/붙여넣기를 시스템 클립보드 채널로 전환(타 앱 연계·CN-1 병존).
import {
  copyToSystemClipboard,
  cutToSystemClipboard,
  pasteFromSystemClipboard
} from './clipboardExternal'
import { toggleThemeMode } from './settings'
import { performUndo } from './undo'
import { openBatchRename } from './batchRename'
import { startCompare } from './compare'
import { startDedup } from './dedup'
import { requestNewTab } from './newTab'

/** 현재 활성 패널 id 헬퍼. */
function activePanel(): string | undefined {
  return store.getState().activePanelId()
}

/**
 * U1 퀵룩 대상 경로 — 활성 패널의 "앵커(현재 활성)" 항목 경로.
 * 우선순위: selection.anchorIndex 의 가시 항목 → 단일 선택 항목 → null.
 * 다중 선택이어도 앵커(마지막 클릭/이동 기준점) 1개를 미리본다.
 */
function activeAnchorPath(): string | null {
  const s = store.getState()
  const pid = s.activePanelId()
  if (!pid) return null
  const vis = visibleEntries(pid)
  if (vis.length === 0) return null
  const sel = s.selection[pid]
  if (sel) {
    const ai = sel.anchorIndex
    if (ai >= 0 && ai < vis.length) {
      const e = vis[ai]
      if (e) return e.path
    }
    if (sel.selectedPaths.size === 1) {
      const [only] = sel.selectedPaths
      if (only) return only
    }
  }
  return null
}

/**
 * commandId 를 실행한다. 알 수 없는/비활성 명령은 무시(false 반환 가능).
 * @returns 처리 여부(true 면 기본 동작 preventDefault 권장).
 */
export function execCommand(commandId: string): boolean {
  const s = store.getState()

  // tab.select.N (N번째 탭)
  if (commandId.startsWith('tab.select.')) {
    const n = Number(commandId.slice('tab.select.'.length))
    if (Number.isFinite(n)) {
      s.selectTabByIndex(n)
      return true
    }
  }

  switch (commandId) {
    // ── 탭 ───────────────────────────────────────────────────────────
    case 'tab.new':
      void requestNewTab()
      return true
    case 'tab.close':
      s.closeTab()
      return true
    case 'tab.reopen':
      s.reopenTab()
      return true
    case 'tab.duplicate':
      s.duplicateTab()
      return true
    case 'tab.next':
      s.nextTab()
      return true
    case 'tab.prev':
      s.prevTab()
      return true

    // ── 패널 포커스 / 분할 ───────────────────────────────────────────
    // 패널이 1개뿐이면 Tab/Ctrl+←·→ 은 가로채지 않고 네이티브 포커스 이동에 양보.
    case 'panel.focusNext': {
      const tab = s.activeTab()
      if (!tab || tab.panelIds.length <= 1) return false
      s.focusNextPanel()
      return true
    }
    case 'panel.focusDir.left': {
      const tab = s.activeTab()
      if (!tab || tab.panelIds.length <= 1) return false
      s.focusPanelDir('left')
      return true
    }
    case 'panel.focusDir.right': {
      const tab = s.activeTab()
      if (!tab || tab.panelIds.length <= 1) return false
      s.focusPanelDir('right')
      return true
    }
    case 'layout.toggleSplit2':
      s.toggleSplit2()
      return true
    case 'layout.toggleGrid4':
      s.toggleGrid4()
      return true

    // ── 사이드바 / 테마 / 보기 모드(H-1) ─────────────────────────────────
    case 'sidebar.toggle':
      s.toggleSidebar()
      return true
    case 'theme.toggle':
      void toggleThemeMode()
      return true
    case 'view.setMode.list': {
      const p = activePanel()
      if (p) s.setViewMode(p, 'list')
      return true
    }
    case 'view.setMode.details': {
      const p = activePanel()
      if (p) s.setViewMode(p, 'details')
      return true
    }

    // ── 탐색 ─────────────────────────────────────────────────────────
    case 'nav.back': {
      const p = activePanel()
      if (p) s.navBack(p)
      return true
    }
    case 'nav.forward': {
      const p = activePanel()
      if (p) s.navForward(p)
      return true
    }
    case 'nav.up': {
      const p = activePanel()
      if (p) s.navUp(p)
      return true
    }
    case 'address.edit':
      s.setAddressEditing(true)
      return true

    // ── 설정 ─────────────────────────────────────────────────────────
    case 'app.settings':
      s.openSettings()
      return true

    // ── 단축키 도움말(I7 — F1 과 동일, ? 아이콘에서도 호출) ─────────────
    case 'help.shortcuts':
      s.toggleShortcutHelp()
      return true

    // ── 사용량 대시보드(I장) ──────────────────────────────────────────
    case 'dashboard.open':
      s.openDashboard()
      return true

    // ── 휴지통 관리(K장 K2) ───────────────────────────────────────────
    case 'trash.open':
      s.openTrash()
      return true

    // ── 원격 연결(§M M3) ──────────────────────────────────────────────
    case 'remote.open':
      s.openRemoteDialog()
      return true

    // ── 폴더 비교(§P1) ────────────────────────────────────────────────
    case 'compare.toggle':
      startCompare()
      return true

    // ── 중복 파일 찾기(§R2) ────────────────────────────────────────────
    case 'dedup.open':
      void startDedup()
      return true

    // ── 전송 큐 매니저(§R3) ────────────────────────────────────────────
    case 'queue.open':
      s.openQueuePanel()
      return true

    // ── 보기 ─────────────────────────────────────────────────────────
    case 'panel.refresh': {
      const p = activePanel()
      if (p) s.refresh(p)
      return true
    }
    case 'search.open': {
      const p = activePanel()
      if (p) {
        s.setSearchOpen(p, true)
        s.setInputContext('search')
      }
      return true
    }

    // ── 선택 / 활성화 ────────────────────────────────────────────────
    case 'select.all': {
      const p = activePanel()
      if (p) {
        const vis = visibleEntries(p).map((e) => e.path)
        s.selectAll(p, vis)
      }
      return true
    }
    case 'panel.activate': {
      const p = activePanel()
      if (p) {
        const map = new Map(visibleEntries(p).map((e) => [e.path, e]))
        void activateSelected(p, (path) => map.get(path))
      }
      return true
    }

    // ── 파일 작업(P4 연결) ───────────────────────────────────────────
    case 'file.copy':
      void copyToSystemClipboard()
      return true
    case 'file.cut':
      void cutToSystemClipboard()
      return true
    case 'file.paste':
      void pasteFromSystemClipboard()
      return true
    case 'file.rename':
      startRenameSelected()
      return true
    case 'file.batchRename':
      openBatchRename()
      return true
    case 'file.newFolder':
      void createNewFolder()
      return true
    case 'file.trash':
      void trashSelected()
      return true
    case 'file.deletePermanent':
      requestPermanentDelete()
      return true
    case 'file.cancelOperation': {
      // 진행 중 첫 작업 취소(ProgressDialog 외 단축 경로).
      const active = s.activeOperations()[0]
      if (active) void cancelOperation(active.operationId)
      return true
    }

    // ── 되돌리기(K장 K1) ─────────────────────────────────────────────
    case 'file.undo':
      void performUndo()
      return true
    case 'preview.toggle':
      s.togglePreview()
      return true
    case 'workspace.manage':
      // 워크스페이스 관리는 설정 화면의 워크스페이스 페이지로 연동(독립 팝업 폐지).
      s.openSettings('workspace')
      return true

    // ── 명령 팔레트(S2 · US-18.2) ─────────────────────────────────────
    case 'palette.open':
      s.openPalette()
      return true

    // ── 퀵룩(U1 · US-20.1) — 열려 있으면 닫고, 아니면 앵커 항목을 연다(토글) ──
    case 'quicklook.toggle': {
      if (s.quickLookPath) {
        s.closeQuickLook()
        return true
      }
      const path = activeAnchorPath()
      if (path) {
        s.openQuickLook(path)
        return true
      }
      // 미리볼 항목이 없으면 가로채지 않음(Space 네이티브 동작 양보).
      return false
    }

    default:
      return false
  }
}
