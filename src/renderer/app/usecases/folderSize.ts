/**
 * folderSize 유스케이스 — 자세히 보기 폴더 용량 인라인(T2·US-19.2)의 lazy 캐시 경계.
 *
 * 기존 analyze:scan 엔진을 **단일 폴더 1회 스캔**에 재사용해(신규 채널 0) 폴더의 총
 * 바이트(ScanResult.totalBytes)를 얻는다. 가시 윈도에 실제 렌더되는 폴더 행만 요청하고
 * (eager 전수 스캔 금지), 같은 path 는 1회만(in-flight 디듀프), 결과는 영속 캐시한다.
 *
 * thumbnailCache.ts 동형 — store 밖 전역 모듈(패널 슬라이스 미오염, SA §5.2 셀렉터 격리) +
 * cache/inflight/subscribers + useSyncExternalStore 구독(행 컴포넌트가 thumbnails 처럼 소비).
 *
 * dashboard 의 analyzeSlice 스캔(단일 활성 스캔 추적)과 **독립** — 여기서는 자체 scanId 상관
 * 임시 구독으로 동시 다수의 작은 폴더 스캔을 처리한다(대시보드 진행 상태 미오염).
 *
 * 한계(정직): 매우 큰 트리는 scanEngine 이 항목 상한/취소/권한스킵을 이미 적용하므로 그
 * 잘린 total 을 그대로 표시한다(truncated 여부는 표면화하지 않음 — 근사값 허용).
 */
import { analyzeApi, subscribeScanStream } from '@renderer/infra/api'

/** 성공 캐시(path → 총 바이트). 음수 마커(-1)=스캔 실패/취소(재시도 억제·"—" 폴백). */
const cache = new Map<string, number>()
/** in-flight Promise(path → Promise) — 동일 path 동시요청 디듀프. */
const inflight = new Map<string, Promise<void>>()
/** 캐시 변경 구독자(useSyncExternalStore). */
const subscribers = new Set<() => void>()

/** 실패/취소 마커(음수) — 화면엔 미노출(getCachedFolderSize 가 undefined 로 폴백). */
const FAILED = -1

/**
 * scanId → 대기 항목(path·resolve). **단일 공유 스트림 구독**이 이 맵으로 done/error 를
 * scanId 별로 라우팅한다. 폴더 행마다 subscribeScanStream 을 호출하면 동시 N개 폴더 스캔 시
 * IPC 리스너가 N×3개 누적돼 MaxListenersExceededWarning 이 났다 → 구독은 1회만(리스너 3개 고정).
 */
const pending = new Map<string, { path: string; resolve: () => void }>()
/** 공유 스트림 해제 함수(최초 요청 시 1회 부착·앱 수명 동안 유지). */
let streamOff: (() => void) | null = null

function ensureStream(): void {
  if (streamOff) return
  streamOff = subscribeScanStream({
    onProgress: () => undefined, // 총합만 필요 — 진행률 무시.
    onDone: (evt) => {
      const e = pending.get(evt.scanId)
      if (!e) return // 다른 소비자(대시보드)·이미 처리됨.
      pending.delete(evt.scanId)
      // 취소(canceled)면 실패 마커, 아니면 총 바이트 캐시.
      cache.set(e.path, evt.result.canceled ? FAILED : evt.result.totalBytes)
      notify()
      e.resolve()
    },
    onError: (evt) => {
      const e = pending.get(evt.scanId)
      if (!e) return
      pending.delete(evt.scanId)
      cache.set(e.path, FAILED)
      notify()
      e.resolve()
    }
  })
}

function notify(): void {
  for (const cb of subscribers) cb()
}

/** 캐시 키 = 폴더 절대경로 그대로(path별 고유). */
export function folderSizeKeyFor(path: string): string {
  return path
}

/**
 * 캐시된 폴더 총 바이트 조회. 미캐시·in-flight·실패면 undefined(행은 "—" 폴백).
 * 성공(>=0)만 숫자로 반환한다(음수 마커는 undefined 로 가린다).
 */
export function getCachedFolderSize(path: string): number | undefined {
  const v = cache.get(path)
  if (v === undefined || v < 0) return undefined
  return v
}

/**
 * 폴더 1개의 총 바이트 스캔 트리거. 이미 캐시(성공/실패)·in-flight 면 재요청 안 함(디듀프).
 * analyze:scan 을 자체 scanId 로 시작하고 그 scanId 의 done/error 만 임시 구독해 상관시킨다
 * (대시보드 analyzeSlice 와 독립). 완료 시 total 캐시 후 통지, 실패/취소는 음수 마커.
 */
export function requestFolderSize(path: string): Promise<void> {
  if (cache.has(path)) return Promise.resolve()
  const existing = inflight.get(path)
  if (existing) return existing

  ensureStream() // 공유 스트림 1회 부착(리스너 3개 고정).
  const p = (async (): Promise<void> => {
    try {
      const started = await analyzeApi.scanStart({ root: path })
      if (!started.ok) {
        cache.set(path, FAILED)
        notify()
        return
      }
      const scanId = started.value.scanId
      // 이 scanId 의 done/error 를 공유 스트림이 pending 맵으로 라우팅(자체 리스너 추가 없음).
      await new Promise<void>((resolve) => {
        pending.set(scanId, { path, resolve })
      })
    } catch {
      cache.set(path, FAILED)
      notify()
    } finally {
      inflight.delete(path)
    }
  })()

  inflight.set(path, p)
  return p
}

/** 캐시 변경 구독(useSyncExternalStore용). 해제 함수 반환. */
export function subscribeFolderSize(cb: () => void): () => void {
  subscribers.add(cb)
  return () => {
    subscribers.delete(cb)
  }
}
