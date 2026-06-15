/**
 * src/main/agent/provider/retry.ts — LLM 호출 일시 오류 재시도(§Z 견고성·순수·IO 0).
 *
 * 문제: `provider.createCompletion` 은 네트워크 단절·레이트리밋(429)·일시적 5xx 로 실패할 수 있다.
 * 기존 오케스트레이터는 한 번 실패하면 루프를 즉시 종료했다 — 일시 장애가 곧 작업 실패였다.
 *
 * 본 모듈은 **일시 오류만** 지수 백오프로 재시도하는 범용 헬퍼를 제공한다. 영구 오류(인증 4xx·
 * 도구 호출 파싱형·취소)는 재시도하지 않고 즉시 던진다(빠른 실패 보존). AbortSignal 이 잡히면
 * 대기 중에도 즉시 깨어나 재시도하지 않는다.
 *
 * 순수/주입식: 실제 타이머(`defaultSleep`)는 기본값이며 테스트는 `sleep` 을 즉시 resolve 로 주입해
 * 결정적으로 검증한다(IO·SDK·electron import 0 → 헤드리스 verify 대상). throw 는 fn 의 오류만 전파.
 */

/** 백오프 기본 지연(ms) — `base * 2^attempt`. */
export const RETRY_BASE_MS = 400

/** 백오프 상한(ms) — 지수 증가가 이 값을 넘지 않는다. */
export const RETRY_CAP_MS = 8_000

/** 재시도 대상 HTTP status(일시 장애 — 레이트리밋·게이트웨이·일시적 5xx). */
const TRANSIENT_HTTP_STATUS: ReadonlySet<number> = new Set([408, 425, 429, 500, 502, 503, 504])

/** 재시도 대상 네트워크 오류 코드(연결 단절·타임아웃·일시적 DNS·도달 불가). */
const TRANSIENT_NET_CODES: ReadonlySet<string> = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENETDOWN',
  'ENETRESET'
])

/** 오류 객체에서 HTTP status 추출(있으면). 없으면 undefined. */
function httpStatus(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined
  const e = err as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } }
  if (typeof e.status === 'number') return e.status
  if (typeof e.statusCode === 'number') return e.statusCode
  if (e.response && typeof e.response.status === 'number') return e.response.status
  return undefined
}

/** 오류 객체에서 네트워크 오류 코드(`ECONNRESET` 등) 추출(있으면). */
function errCode(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') return undefined
  const c = (err as { code?: unknown }).code
  if (typeof c === 'string') return c
  const cause = (err as { cause?: unknown }).cause
  if (cause && typeof cause === 'object') {
    const cc = (cause as { code?: unknown }).code
    if (typeof cc === 'string') return cc
  }
  return undefined
}

/** 오류에서 사람이 읽을 메시지 추출(throw 0). */
function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  if (err && typeof err === 'object') {
    const m = (err as { message?: unknown }).message
    if (typeof m === 'string') return m
  }
  return ''
}

/**
 * 오류가 **일시 장애(재시도 가치 있음)** 인지 판정한다(순수).
 *
 * - HTTP status 가 있으면 그 값만으로 판정한다(408/425/429/500/502/503/504 → true, 그 외 4xx/3xx → false).
 *   따라서 인증 401·404·도구 파싱 400 등은 재시도 대상이 아니다(빠른 실패).
 * - status 가 없으면 네트워크 오류 코드/메시지 패턴으로 판정한다(연결 단절·타임아웃·일시 DNS).
 * - `ECONNREFUSED`/`ENOTFOUND` 는 보통 영구(서버 미가동·DNS 부재) → 재시도하지 않는다.
 */
export function isTransientError(err: unknown): boolean {
  if (!err) return false
  const status = httpStatus(err)
  if (status !== undefined) return TRANSIENT_HTTP_STATUS.has(status)
  const code = errCode(err)
  if (code) return TRANSIENT_NET_CODES.has(code)
  const msg = errMsg(err).toLowerCase()
  if (!msg) return false
  return (
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('socket hang up') ||
    msg.includes('network error') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('eai_again') ||
    msg.includes('fetch failed') ||
    msg.includes('temporarily unavailable')
  )
}

/** 지수 백오프 지연(ms·순위 결정적·지터 없음) — `min(cap, base * 2^attempt)`. */
export function backoffDelayMs(attempt: number, base: number = RETRY_BASE_MS, cap: number = RETRY_CAP_MS): number {
  const a = attempt < 0 ? 0 : attempt
  const raw = base * 2 ** a
  return Math.min(cap, raw)
}

/** AbortSignal 을 존중하는 기본 sleep(취소 시 즉시 resolve — 호출부가 aborted 재확인). */
export function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0 || signal?.aborted) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const onAbort = (): void => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export interface RetryOptions {
  /** 첫 시도 외 추가 재시도 최대 횟수(총 시도 = 1 + maxRetries). */
  readonly maxRetries: number
  /** 취소 신호 — aborted 면 재시도하지 않고 마지막 오류를 던진다. */
  readonly signal?: AbortSignal
  /** 일시 오류 판정(기본 isTransientError). false 면 재시도 없이 즉시 던진다. */
  readonly isTransient?: (err: unknown) => boolean
  /** 대기 함수(기본 defaultSleep). 테스트는 즉시 resolve 로 주입해 결정적 검증. */
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  /** 백오프 기본/상한(테스트 튜닝용). */
  readonly baseMs?: number
  readonly capMs?: number
  /** 재시도 직전 콜백(로깅·관찰용·부수효과 허용). */
  readonly onRetry?: (info: { readonly attempt: number; readonly delayMs: number; readonly error: unknown }) => void
}

/**
 * `fn` 을 호출하고, **일시 오류면 지수 백오프로 재시도**한다(순수 로직·주입식 sleep).
 *
 * - 성공: 즉시 결과 반환(재시도 0 — 정상 경로 부담 0).
 * - 영구 오류 또는 재시도 소진: 마지막 오류를 그대로 던진다(호출부가 정제 메시지로 매핑).
 * - 취소: 호출 전/대기 후 aborted 면 재시도하지 않고 마지막 오류를 던진다.
 *
 * `fn` 은 시도 번호(0-based)를 받는다(매 시도 새 in-flight 생성 가능).
 */
export async function callWithRetry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions): Promise<T> {
  const isTransient = opts.isTransient ?? isTransientError
  const sleep = opts.sleep ?? defaultSleep
  const base = opts.baseMs ?? RETRY_BASE_MS
  const cap = opts.capMs ?? RETRY_CAP_MS
  let attempt = 0
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fn(attempt)
    } catch (e) {
      // 취소·영구 오류·재시도 소진 → 즉시 전파(빠른 실패).
      if (opts.signal?.aborted) throw e
      if (attempt >= opts.maxRetries || !isTransient(e)) throw e
      const delayMs = backoffDelayMs(attempt, base, cap)
      opts.onRetry?.({ attempt: attempt + 1, delayMs, error: e })
      await sleep(delayMs, opts.signal)
      if (opts.signal?.aborted) throw e
      attempt++
    }
  }
}
