/**
 * infra/icon — 그리드 이미지 썸네일 path+size 단위 캐시 + in-flight 디듀프 (feat-L1, 계획서 §4).
 *
 * iconCache.ts 와 1:1 동형: store 밖 전역 모듈(패널 슬라이스 미오염, SA §5.2 셀렉터 격리) +
 * cache/inflight/subscribers 3-Map(Set) + notify + useSyncExternalStore 구독. 행 컴포넌트는
 * app/usecases/thumbnails 를 경유해(ui→infra 직접 import 금지) 이 모듈을 구독한다.
 *
 * 키 = `${path}::${size}` (path별 고유 — ext 캐시 공유 불가). 같은 키는 IPC 1회만(in-flight 디듀프).
 *
 * iconCache 와의 핵심 차이 = **negCache**(reviewer 확정):
 *   - iconCache 폴백은 "다음 가시 항목의 같은 ext 키"로 재시도되지만, 썸네일 키는 path별 고유라
 *     실패를 전혀 캐시 안 하면 손상/미지원 셀이 화면에 머무는 동안 **매 렌더 재요청**한다.
 *   - 그래서 실패(dataUrl=null·빈문자·에러)는 dataUrl 없는 **마커만** 작은 LRU(상한 256)에 기록한다.
 *     성공 캐시(dataUrl 보유)와 분리 — 음성 캐시는 "이 path+size 는 당분간 OSIcon 폴백"을 기억하되
 *     영구 폐기가 아니라 LRU evict 로 재시도 여지를 남긴다.
 */
import { previewApi } from '@renderer/infra/api'

/** 성공 dataUrl 캐시(key → dataUrl). 성공만 저장한다. */
const cache = new Map<string, string>()
/** 음성 캐시(key 집합, 삽입순 = LRU). dataUrl 없는 마커만 — 폴백 셀 재요청 억제. */
const negCache = new Set<string>()
/** in-flight Promise(key → Promise) — 동일 키 동시요청 디듀프. */
const inflight = new Map<string, Promise<void>>()
/** 캐시 변경 구독자(useSyncExternalStore). */
const subscribers = new Set<() => void>()

/** 음성 캐시 상한(LRU). 초과 시 가장 오래된 키 evict → 재시도 여지 유지. */
const MAX_NEG_CACHE = 256

function notify(): void {
  for (const cb of subscribers) cb()
}

/** 음성 캐시 기록(LRU). 이미 있으면 최신으로 갱신(재삽입), 상한 초과 시 첫 키 evict. */
function negCacheSet(key: string): void {
  if (negCache.has(key)) negCache.delete(key)
  negCache.add(key)
  if (negCache.size > MAX_NEG_CACHE) {
    const oldest = negCache.values().next().value
    if (oldest !== undefined) negCache.delete(oldest)
  }
}

/** 캐시 키 = `${path}::${size}` (path별 고유 — ext 공유 불가). backend thumbnailKeyFor 와 동일 규칙. */
export function thumbnailKeyFor(path: string, size: number): string {
  return `${path}::${size}`
}

/** 캐시된 썸네일 dataUrl 조회(없으면 undefined). 음성 캐시는 여기서 노출하지 않음(폴백=undefined 동작). */
export function getCachedThumbnail(key: string): string | undefined {
  return cache.get(key)
}

/**
 * 썸네일 로드 트리거. 이미 성공 캐시·음성 캐시·in-flight 면 재요청하지 않는다(디듀프).
 * 성공 dataUrl → 캐시 후 구독자 통지. 폴백(dataUrl===null·빈문자·에러) → 음성 캐시 후 통지
 * (OSIcon 폴백이 즉시 보이게 + 같은 셀의 매 렌더 재요청 폭주 방지).
 */
export function requestThumbnail(path: string, size: number): Promise<void> {
  const key = thumbnailKeyFor(path, size)
  if (cache.has(key) || negCache.has(key)) return Promise.resolve()
  const existing = inflight.get(key)
  if (existing) return existing

  const p = (async (): Promise<void> => {
    try {
      const res = await previewApi.thumbnail(path, size)
      if (res.ok && res.value.dataUrl) {
        cache.set(key, res.value.dataUrl)
      } else {
        // ok({dataUrl:null}) 폴백 또는 err — 음성 캐시로 재요청 억제(영구 아님, LRU evict).
        negCacheSet(key)
      }
      notify()
    } catch {
      // 무음 — 음성 캐시로 마킹(토스트 폭주 방지, OSIcon 폴백 유지).
      negCacheSet(key)
      notify()
    } finally {
      inflight.delete(key)
    }
  })()

  inflight.set(key, p)
  return p
}

/** 캐시 변경 구독(useSyncExternalStore용). 해제 함수 반환. */
export function subscribeThumbnail(cb: () => void): () => void {
  subscribers.add(cb)
  return () => {
    subscribers.delete(cb)
  }
}
