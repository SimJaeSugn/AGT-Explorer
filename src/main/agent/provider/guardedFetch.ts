/**
 * src/main/agent/provider/guardedFetch.ts — 내부 provider fetch SSRF 게이트(§Z Z1·ADR-015 G4·D8).
 *
 * `createDefaultClientFactory({ internalFetch })` 에 주입할 fetch 래퍼. SDK 가 내부 호스트로
 * HTTP 요청을 보내기 직전, 매 요청의 실 URL 을 `assertRequestAllowed`(1~6단계·DNS 리바인딩)로
 * 재검증하고, **`redirect:'error'`** 로 리다이렉트(6단계)를 강제 차단한다(메타데이터/사설망으로의
 * 우회 차단). 화이트리스트 호스트만 통과한다.
 *
 * `node:fetch`(전역 fetch) 사용은 외부 송신 특권 경계인 `src/main/agent/` 안에서만 허용된다
 * (ssrfGuard 와 동일 격리). allowList 와 lookup 은 핸들러가 클로저로 캡처해 주입한다.
 */
import { assertRequestAllowed, type DnsLookup } from './ssrfGuard'

/**
 * SSRF 게이트를 거치는 fetch 를 만든다. 등록된 allowedHosts(정규화 `host:port` 또는 host)만 통과.
 * @param getAllowList 호출 시점의 화이트리스트(동적 — 등록 갱신 반영).
 */
type FetchFn = typeof fetch
type FetchArgs = Parameters<FetchFn>

export function createGuardedFetch(getAllowList: () => readonly string[], lookup?: DnsLookup): FetchFn {
  const guarded = async (input: FetchArgs[0], init?: FetchArgs[1]): ReturnType<FetchFn> => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : (input as { url: string }).url
    const allow = getAllowList()
    const check = await assertRequestAllowed(url, allow, lookup)
    if (!check.ok) {
      throw new Error(`SSRF 차단: ${check.error.message}`)
    }
    // 리다이렉트 강제 차단(6단계) — 메타데이터/사설망 우회 봉쇄.
    return fetch(input, { ...init, redirect: 'error' })
  }
  return guarded as FetchFn
}
