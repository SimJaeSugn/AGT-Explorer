/**
 * §Y1 셸 컨텍스트 verb 유스케이스 (app/usecases/shellVerbs) — 조회·TTL 캐시·실행.
 *
 * 컨텍스트 메뉴가 단일 로컬 항목으로 열릴 때 openRowContextMenu 가 loadWinVerbs 를
 * 호출해 "Windows 메뉴" 섹션을 비동기로 채운다(loading→ready/empty). 메뉴 항목 클릭은
 * invokeWinVerb 가 fire-and-forget 실행하고 실패만 가벼운 토스트로 안내한다.
 *
 * 경계: app → infra/api(shellApi)·store. 순수 합성/캐시/경합 로직은
 * shellVerbsSection.ts(store/infra 무의존)에 분리해 verify 가 직접 검증한다.
 *
 * empty 단일 규약(ADR-013·권고-3): 빈목록·워커 실패·타임아웃·spawn 불가·미존재 경로·
 * Result.err(거부) 모두 status='empty' → 섹션 비노출(크래시 없는 정상 경로).
 */
import { shellApi } from '@renderer/infra/api'
import { store } from '@renderer/app/stores/rootStore'
import {
  WIN_VERBS_TTL_MS,
  isCacheFresh,
  isResponseStillRelevant,
  type WinVerbsCacheEntry
} from './shellVerbsSection'

/**
 * 경로키 TTL 캐시(모듈 수명). 같은 경로 재우클릭(8초 내)이면 워커 재조회를 생략한다.
 * 메뉴 닫힘 시 winVerbs 상태는 리셋되지만(closeContextMenu→null), 이 캐시는 TTL 까지
 * 유지되어 곧바로 다시 연 경우 즉시 ready/empty 로 복원한다(UQ-Y4 렌더러 캐시).
 */
const cache = new Map<string, WinVerbsCacheEntry>()

/** verify/테스트용: 캐시 초기화(상태 누수 방지). 프로덕션 경로에서는 호출 없음. */
export function __clearWinVerbsCache(): void {
  cache.clear()
}

/**
 * 메뉴 열림 직후 호출: 단일 로컬 경로의 셸 verb 를 조회해 uiSlice.winVerbs 갱신.
 *  ① TTL 캐시 hit → 즉시 ready(items>0)/empty(items=0) 세팅(재조회 생략).
 *  ② miss → loading 세팅 후 shellApi.contextVerbs → ready(N>0)/empty(0·err).
 *  ③ 경합 가드: 응답 도착 시 contextMenu?.targetPath 가 여전히 이 경로일 때만 반영
 *     (메뉴가 닫혔거나 다른 항목으로 바뀌었으면 무시 — 늦은 응답 오염 차단).
 */
export function loadWinVerbs(path: string): void {
  const cached = cache.get(path)
  if (isCacheFresh(cached, Date.now(), WIN_VERBS_TTL_MS) && cached) {
    store.getState().setWinVerbs({
      status: cached.items.length > 0 ? 'ready' : 'empty',
      items: [...cached.items]
    })
    return
  }

  store.getState().setWinVerbs({ status: 'loading', items: [] })

  void shellApi
    .contextVerbs(path)
    .then((res) => {
      // 경합 가드: 응답이 여전히 같은 메뉴 컨텍스트(같은 경로)일 때만 반영.
      const current = store.getState().contextMenu?.targetPath
      if (!isResponseStillRelevant(current, path)) return

      if (res.ok) {
        const items = res.value.verbs
        cache.set(path, { items: [...items], at: Date.now() })
        store.getState().setWinVerbs({
          status: items.length > 0 ? 'ready' : 'empty',
          items: [...items]
        })
      } else {
        // 거부(원격/archive prefix·guard) = empty 단일 규약(섹션 비노출). 캐시는 남기지 않음.
        store.getState().setWinVerbs({ status: 'empty', items: [] })
      }
    })
    .catch(() => {
      // 브리지 예외(이론상 없음 — IPC 는 Result 로 흡수)도 empty 로 안전 수렴.
      const current = store.getState().contextMenu?.targetPath
      if (isResponseStillRelevant(current, path)) {
        store.getState().setWinVerbs({ status: 'empty', items: [] })
      }
    })
}

/** invoke 실패 코드 → 사용자 안내 문구(EVERB=스테일 메뉴·그 외 일반). */
function invokeErrorMessage(code: string): string {
  switch (code) {
    case 'EVERB':
      return '메뉴가 변경되었습니다. 다시 시도해 주세요.'
    case 'ENOENT':
      return '항목을 찾을 수 없습니다. 이동/삭제되었을 수 있습니다.'
    default: // EUNKNOWN 등
      return '메뉴 동작을 실행할 수 없습니다.'
  }
}

/**
 * "Windows 메뉴" 항목 클릭: fire-and-forget 실행. 성공은 무음(외부 프로그램/대화상자가 뜸),
 * 실패만 가벼운 토스트로 안내한다(open 계열 정책 동형).
 */
export async function invokeWinVerb(path: string, verbId: string): Promise<void> {
  const res = await shellApi.invokeVerb(path, verbId)
  if (!res.ok) {
    store.getState().pushToast('info', invokeErrorMessage(res.error.code))
  }
}
