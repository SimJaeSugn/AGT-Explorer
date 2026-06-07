/**
 * open 유스케이스 — 항목 활성화(더블클릭/Enter): 폴더=진입, 파일=shell:open (B6).
 *
 * roadmap P2: 폴더는 navHistory 적재 후 진입, 파일은 shell:open 으로 OS 연결
 * 프로그램 실행. shell:open 결과(Result)를 확인해 실패(미연결 형식·권한 등)는
 * 사용자 안내 토스트로 표시한다. 보안 검증은 Main shell.handlers 가 수행.
 *
 * app 계층 → infra/api(shell.open) 직접 호출(.eslintrc 허용).
 */
import type { FileEntryDTO } from '@shared/dto'
import { shellApi } from '@renderer/infra/api'
import { store } from '@renderer/app/stores/rootStore'
import { baseName } from '@renderer/domain/paths'

/** 메시지 친화화: FileOpError 코드 → 사용자 안내. */
function openErrorMessage(code: string, name: string): string {
  switch (code) {
    case 'ENOENT':
      return `"${name}" 을(를) 찾을 수 없습니다. 이동/삭제되었을 수 있습니다.`
    case 'EACCES':
    case 'EPERM':
      return `"${name}" 에 접근할 권한이 없습니다.`
    case 'ESECURITY':
      return `"${name}" 경로가 차단되었습니다.`
    case 'EINVAL':
      return `"${name}" 을(를) 열 수 없습니다(잘못된 경로).`
    default:
      return `"${name}" 을(를) 여는 데 실패했습니다. 연결된 프로그램이 없을 수 있습니다.`
  }
}

/**
 * 항목 활성화. 폴더면 panelId 패널을 그 폴더로 진입시키고,
 * 파일이면 shell:open 으로 실행한다.
 */
export async function activateEntry(panelId: string, entry: FileEntryDTO): Promise<void> {
  const s = store.getState()
  if (entry.isDir) {
    s.navigate(panelId, entry.path, true)
    return
  }
  const res = await shellApi.open(entry.path)
  if (!res.ok) {
    store.getState().pushToast('error', openErrorMessage(res.error.code, entry.name))
  }
}

/**
 * "연결 프로그램으로 열기"(shell:open-with) — 단일 파일 선택 시 컨텍스트 메뉴에서 호출.
 *
 * roadmap P6(features §B6 Should): 선택 파일 경로로 OS "연결 프로그램으로 열기"
 * 대화상자를 띄운다. 성공은 무음(OS 대화상자가 뜸), 실패만 사용자 안내 토스트로
 * 폴백한다(activateEntry 의 shell:open 과 동일한 에러 메시지 정책).
 *
 * 폴더·다중선택은 호출측(컨텍스트 메뉴)이 비표시/비활성으로 거른다. 방어적으로
 * isDir 이면 no-op(폴더에는 연결 프로그램 개념이 없음).
 */
export async function openWithEntry(entry: FileEntryDTO): Promise<void> {
  if (entry.isDir) return
  const res = await shellApi.openWith(entry.path)
  if (!res.ok) {
    store.getState().pushToast('error', openErrorMessage(res.error.code, entry.name))
  }
}

/**
 * "속성"(shell:show-properties) — 컨텍스트 메뉴 단일 선택 시 OS 속성창을 띄운다.
 *
 * roadmap P4(features §B6): 파일·폴더 단일 선택의 OS 속성 대화상자. 성공은 무음
 * (OS 창이 뜸), 실패만 사용자 안내 토스트로 폴백한다(open 계열과 동일 정책).
 * ui→infra 직접 import 금지 규칙을 이 usecase 경유로 준수한다(ContextMenu→여기→shellApi).
 */
export async function showPropertiesFor(path: string): Promise<void> {
  const res = await shellApi.showProperties(path)
  if (!res.ok) {
    store.getState().pushToast('error', openErrorMessage(res.error.code, baseName(path)))
  }
}

/**
 * 활성 패널의 현재 선택 항목(단일)을 활성화(Enter 키 명령에서 사용).
 * 선택이 없거나 여러 개면 첫 항목을 연다(폴더 우선 X — 화면 순서 첫 선택).
 */
export async function activateSelected(
  panelId: string,
  entryByPath: (path: string) => FileEntryDTO | undefined
): Promise<void> {
  const sel = store.getState().selection[panelId]
  if (!sel || sel.selectedPaths.size === 0) return
  const first = sel.selectedPaths.values().next().value as string | undefined
  if (!first) return
  const entry = entryByPath(first)
  if (entry) await activateEntry(panelId, entry)
}
