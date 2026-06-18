/**
 * "새로 만들기" ShellNew 유스케이스 (§Y2) — Windows 레지스트리 기반 "새로 만들기" 형식.
 *
 * Windows 탐색기처럼 레지스트리 ShellNew 핸들러(안전 3종: NullFile·FileName·Data)를
 * 열거해 컨텍스트 메뉴 "새로 만들기" 하위 메뉴에 합쳐 노출한다. 목록은 거의 불변이므로
 * 앱 부팅 시 1회 프리페치(prefetchShellNewTypes)해 모듈 캐시에 담고, 메뉴 빌드 시점에
 * 동기로 getShellNewTypes() 로 읽는다(비동기 채움 → 다음 메뉴 열기부터 반영).
 *
 * 고정 형식(NEW_FILE_TYPES — 폴더/텍스트/Markdown/JSON)과 확장자가 겹치는 레지스트리
 * 항목은 제외해 중복(예: "텍스트 문서" 2개)을 막는다.
 *
 * 경계: app → infra/api(shellApi) · store. 비-Windows·실패는 빈 목록으로 수렴(무손상).
 */
import type { ShellNewItemDTO } from '@shared/dto'
import { store } from '@renderer/app/stores/rootStore'
import { shellApi } from '@renderer/infra/api'
import { isMyPc, joinPath } from '@renderer/domain/paths'
import { panelPaths, NEW_FILE_TYPES } from './fileOps'

/** 파일명에서 소문자 확장자 추출(".txt"). 없으면 빈 문자열. */
function extOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(dot).toLowerCase() : ''
}

let cachedTypes: ShellNewItemDTO[] = []
let loaded = false

/** 캐시된 레지스트리 ShellNew 형식(프리페치 전이면 빈 배열). 메뉴 빌드에서 동기 사용. */
export function getShellNewTypes(): ShellNewItemDTO[] {
  return cachedTypes
}

/**
 * 부팅 시 1회 호출(windowInit) — 레지스트리 ShellNew 형식을 프리페치해 캐시한다.
 * 고정 형식과 확장자가 겹치는 항목은 제외(중복 방지). 실패/비-Windows 면 빈 목록 유지.
 */
export async function prefetchShellNewTypes(): Promise<void> {
  if (loaded) return
  loaded = true
  try {
    const res = await shellApi.newList()
    if (res.ok) {
      const fixedExts = new Set(NEW_FILE_TYPES.map((t) => extOf(t.baseName)))
      cachedTypes = res.value.items.filter((i) => !fixedExts.has(i.ext.toLowerCase()))
    }
  } catch {
    /* 무시 — 빈 목록 유지(고정 항목만 노출) */
  }
}

/**
 * ShellNew 형식 파일 생성(컨텍스트 메뉴 "새로 만들기 ▸ <형식>"). Main 워커가 레지스트리
 * 재조회로 생성 방식을 판정·생성하고 최종 파일명을 돌려준다. 성공 시 새로고침 + 즉시
 * 인라인 이름편집(고정 형식 createNewFile 과 동일 UX) + undo(K1) 적재.
 */
export async function createFromShellNew(item: ShellNewItemDTO): Promise<void> {
  const { activePanelId, activePath } = panelPaths()
  const s = store.getState()
  if (!activePanelId || activePath === undefined || isMyPc(activePath)) {
    s.pushToast('info', '이 위치에는 새로 만들 수 없습니다.')
    return
  }
  const res = await shellApi.newCreate(activePath, item.id, item.label)
  if (!res.ok) {
    s.pushToast('error', '새로 만들기에 실패했습니다.')
    return
  }
  const path = joinPath(activePath, res.value.name)
  // K1 undo: 생성 역연산 = 휴지통 보내기.
  s.pushUndo({ kind: 'create', path })
  s.refresh(activePanelId)
  s.startRename({ panelId: activePanelId, path, initialName: res.value.name, isNew: true })
}
