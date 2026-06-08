/**
 * 외부(시스템) 클립보드 유스케이스 (app/usecases/clipboardExternal) — §M M2.
 *
 * 복사/잘라내기/붙여넣기를 **시스템 클립보드 채널(CF_HDROP)** 로 전환해 타 앱과
 * 연계한다(MP2):
 *   - 복사     → clipboard:write-files({paths, effect:'copy'})
 *   - 잘라내기 → clipboard:write-files({paths, effect:'cut'})
 *   - 붙여넣기 → clipboard:read-files() 로 시스템 클립보드의 파일·DropEffect 를 읽어
 *               기존 op:start(copy|move) 파이프라인에 투입(D4 충돌·E4 진행률 그대로).
 *   - 활성판정 → clipboard:has-files() 로 붙여넣기 가능 여부(IconBar/컨텍스트 메뉴).
 *
 * 기존 내부 클립보드(fileOps.clipboardCopy/Cut/Paste·clipboard:copy/cut/paste-target)는
 * 보존하되(CN-1 병존), 호출부(commandBus)를 본 모듈로 라우팅한다. 시스템 클립보드를
 * 단일 출처로 삼아(ADR-007 ⑦) 내부 effect 흐림 표시도 has-files 폴링으로 동기화한다.
 *
 * 원격 항목은 시스템 클립보드 CF_HDROP 대상이 아니다(로컬 절대경로만) — 원격 패널에서의
 * 복사/붙여넣기는 전송 라우팅(usecases/remote)이 담당하고, 여기서는 로컬 경로만 다룬다.
 *
 * 경계: app → infra/api(clipboardApi·opApi) 직접 호출(.eslintrc 허용).
 */
import type { OpKind } from '@shared/dto'
import { clipboardApi } from '@renderer/infra/api'
import { store } from '@renderer/app/stores/rootStore'
import type { OperationUndoMeta } from '@renderer/app/stores/operationsSlice'
import { isMyPc, parentOf } from '@renderer/domain/paths'
import { isRemotePath } from '@renderer/domain/rules/remoteLocation'
import { clipboardEffectToOpKind } from '@renderer/domain/rules/transferRoute'
import { panelPaths, selectedPaths, startOperation } from './fileOps'

/**
 * 시스템 클립보드의 파일 존재 여부를 읽어 붙여넣기 활성조건을 동기화한다(H-4b 동형).
 * 마운트 1회·window focus·붙여넣기 후 재동기에서 호출. 실패 시 보수적으로 false.
 */
export async function syncSystemClipboardState(): Promise<void> {
  const s = store.getState()
  const res = await clipboardApi.hasFiles()
  s.setClipboardHasFiles(res.ok ? res.value.has : false)
}

/** Ctrl+C: 활성 패널의 로컬 선택을 시스템 클립보드에 복사(effect=copy). */
export async function copyToSystemClipboard(): Promise<void> {
  const { activePanelId } = panelPaths()
  const s = store.getState()
  if (!activePanelId) return
  const sources = selectedPaths(activePanelId).filter((p) => !isRemotePath(p))
  if (sources.length === 0) return
  const res = await clipboardApi.writeFiles(sources, 'copy')
  if (!res.ok) s.pushToast('error', `복사 실패: ${res.error.message}`)
  else s.setClipboardHasFiles(true)
}

/** Ctrl+X: 활성 패널의 로컬 선택을 시스템 클립보드에 잘라내기(effect=cut → DropEffect Move). */
export async function cutToSystemClipboard(): Promise<void> {
  const { activePanelId } = panelPaths()
  const s = store.getState()
  if (!activePanelId) return
  const sources = selectedPaths(activePanelId).filter((p) => !isRemotePath(p))
  if (sources.length === 0) return
  const res = await clipboardApi.writeFiles(sources, 'cut')
  if (!res.ok) s.pushToast('error', `잘라내기 실패: ${res.error.message}`)
  else s.setClipboardHasFiles(true)
}

/**
 * Ctrl+V: 활성 패널 폴더로 시스템 클립보드 파일을 붙여넣기.
 * read-files() 로 paths·effect 를 수신해 기존 op:start(copy|move) 로 투입한다.
 * copy → 대상 폴더만 새로고침, move(cut) → 원본 부모 폴더 + 대상 폴더 둘 다.
 *
 * 원격 패널 붙여넣기(로컬 시스템 클립보드 → 원격 = 업로드)는 usecases/remote 가 담당하므로,
 * 여기서는 도착지가 원격이면 위임 신호만 주고 처리하지 않는다(상위 라우팅에서 분기).
 */
export async function pasteFromSystemClipboard(): Promise<void> {
  const { activePanelId, activePath } = panelPaths()
  const s = store.getState()
  if (!activePanelId || activePath === undefined) return
  if (isMyPc(activePath)) {
    s.pushToast('info', '"내 PC" 에는 붙여넣을 수 없습니다.')
    return
  }
  if (isRemotePath(activePath)) {
    // 원격 도착지: 시스템 클립보드(로컬 파일) → 원격 업로드는 전송 라우팅이 담당.
    // 정적 순환(remote→clipboardExternal) 없음 — 동적 import 로 panelsSlice 경유 순환만 회피.
    const { pasteIntoRemote } = await import('./remote')
    await pasteIntoRemote(activePanelId, activePath)
    return
  }

  const clip = await clipboardApi.readFiles()
  if (!clip.ok) {
    s.pushToast('error', `붙여넣기 실패: ${clip.error.message}`)
    return
  }
  if (clip.value.effect === 'none' || clip.value.paths.length === 0) {
    s.pushToast('info', '붙여넣을 항목이 없습니다.')
    return
  }
  const kind: OpKind = clipboardEffectToOpKind(clip.value.effect)
  const isCut = kind === 'move'
  const srcPaths = clip.value.paths
  const cutParents = isCut
    ? srcPaths.map((p) => parentOf(p)).filter((d): d is string => d !== null)
    : []
  const refreshDirs = isCut ? [...cutParents, activePath] : [activePath]

  // undo 메타: cut 단일 부모만 역방향 move, copy 는 생성 사본 휴지통(fileOps 와 동일 규약).
  let undoMeta: OperationUndoMeta | undefined
  if (isCut) {
    const parents = new Set(cutParents)
    if (parents.size === 1) {
      undoMeta = { kind: 'move', sources: [...srcPaths], fromDir: [...parents][0] as string, toDir: activePath }
    }
  } else {
    undoMeta = { kind: 'copy', sources: [...srcPaths], destDir: activePath }
  }

  await startOperation(kind, srcPaths, activePath, refreshDirs, undoMeta)
  // 붙여넣기 후 재동기(cut 효과면 OS 가 클립보드를 비울 수 있음).
  void syncSystemClipboardState()
}
