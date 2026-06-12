/**
 * §Y1 "Windows 메뉴" 섹션 — **순수** 합성·캐시·경합 가드 헬퍼 (store/infra 무의존).
 *
 * shellVerbs.ts(부수효과 포함 — store/shellApi 호출) 와 contextMenu.ts(MenuItem 병합)가
 * 이 모듈의 순수 함수를 재사용한다. 이 파일은 react/zustand/infra/shared-ipc 를 import 하지
 * 않으므로(@shared/dto 타입만) 헤드리스 verify(verify:shellverbs)가 직접 검증한다.
 *
 * 분리 이유(DoD): 병합 분기·TTL 캐시·경합 가드 로직을 store/DOM 과 떼어내 순수 함수로
 * 못박아야 verify 가 store 부팅 없이 검증할 수 있다(reviewer 권고 A — 단일 출처 verify).
 */
import type { ShellVerbDTO } from '@shared/dto'

/** "Windows 메뉴" 섹션의 비동기 채움 상태(uiSlice.ContextMenuState.winVerbs). */
export interface WinVerbsState {
  /**
   * loading = 조회 중(로딩 행 1개) · ready = verb 도착(items 렌더) · empty = 비노출
   * (빈목록·실패·타임아웃·거부 모두 포괄 — ADR-013/권고-3 "empty 단일 규약").
   */
  readonly status: 'loading' | 'ready' | 'empty'
  readonly items: readonly ShellVerbDTO[]
}

/** TTL 캐시 엔트리(경로키 → verb 목록 + 적재 시각). */
export interface WinVerbsCacheEntry {
  readonly items: readonly ShellVerbDTO[]
  /** Date.now() 기준 적재 시각(ms). */
  readonly at: number
}

/**
 * 렌더러 verb 캐시 TTL(ms). 같은 경로 재우클릭(메뉴 닫았다 다시 열기)이 8초 내면
 * 워커 재조회를 생략한다(UQ-Y4). 너무 길면 외부 셸 변경(앱 설치/제거)을 늦게 반영하므로
 * 8초로 보수적 — 메뉴 1회 상호작용 수명을 충분히 덮되 셸 변경엔 곧 만료.
 */
export const WIN_VERBS_TTL_MS = 8000

/** 병합 섹션 MenuItem 의 형태(contextMenu.MenuItem 의 부분집합 — 순수 모듈이라 자체 정의). */
export interface WinVerbsMenuItem {
  readonly id: string
  readonly label?: string
  readonly separator?: boolean
  /** 비활성(정보) 행 — 로딩 표시용(흐리게·클릭 무동작). */
  readonly disabled?: boolean
  /** 클릭 시 실행(로딩 행은 없음 → 클릭 무동작). */
  readonly run?: () => void
}

/**
 * 캐시 엔트리가 아직 신선한가(TTL 미만)? entry 없으면 false.
 * now 는 Date.now() 주입(verify 가 고정 시각으로 검증).
 */
export function isCacheFresh(
  entry: WinVerbsCacheEntry | undefined,
  now: number,
  ttlMs: number = WIN_VERBS_TTL_MS
): boolean {
  if (!entry) return false
  return now - entry.at < ttlMs
}

/**
 * 비동기 응답이 **현재 열린 메뉴 컨텍스트와 일치**하는가(경합 가드).
 * 늦게 도착한 응답이 다른 경로(또는 닫힌 메뉴)에 꽂히는 것을 막는다.
 * currentTargetPath = 응답 시점의 contextMenu?.targetPath(닫혔으면 null/undefined).
 */
export function isResponseStillRelevant(
  currentTargetPath: string | null | undefined,
  requestedPath: string
): boolean {
  return currentTargetPath === requestedPath
}

/**
 * winVerbs 상태 → "Windows 메뉴" 섹션 MenuItem 배열(병합용·순수).
 *  - undefined/empty            → []            (섹션 자체 비노출)
 *  - loading                    → [separator, 로딩 행]
 *  - ready & items.length>0     → [separator, ...verb 행]
 *  - ready & items.length===0   → []            (방어 — empty 와 동치)
 *
 * onInvoke(verbId) 는 verb 행 클릭 핸들러(shellVerbs.invokeWinVerb 바인딩). 로딩 행은
 * run 미부여 → ContextMenu 의 `if(!item.run) return` 가드로 클릭 무동작.
 */
export function buildWinVerbsSection(
  winVerbs: WinVerbsState | undefined,
  onInvoke: (verbId: string) => void
): WinVerbsMenuItem[] {
  if (!winVerbs) return []
  if (winVerbs.status === 'empty') return []
  if (winVerbs.status === 'loading') {
    return [
      { id: 'win-sep', separator: true },
      { id: 'win-loading', label: 'Windows 메뉴 불러오는 중…', disabled: true }
    ]
  }
  // ready
  if (winVerbs.items.length === 0) return []
  const out: WinVerbsMenuItem[] = [{ id: 'win-sep', separator: true }]
  for (const v of winVerbs.items) {
    out.push({
      id: `win-${v.verbId}`,
      label: v.display,
      run: () => onInvoke(v.verbId)
    })
  }
  return out
}
