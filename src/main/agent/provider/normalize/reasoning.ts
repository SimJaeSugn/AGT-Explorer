/**
 * src/main/agent/provider/normalize/reasoning.ts — 추론(thinking) 분리·서버 파싱 오류 매핑(§Z).
 *
 * **문제 1(오염 방지):** 일부 추론 모델(로컬 qwen3 등)이 추론 토큰을 —
 *   ① OpenAI 응답의 **`reasoning_content`**(비표준 필드)로 분리하거나,
 *   ② 멀티턴에서 **`<think>…</think>`(닫힘 없을 수도)를 content 에 인라인** 생성한다.
 * 이 추론물이 정규화된 content 에 섞이면 (a) 저장/에코 content 가 오염되고 (b) 다음 턴에
 * 되돌려 보낼 때 서버가 다시 파싱하다 깨지며(특히 도구+멀티턴) (c) 토큰을 낭비한다.
 * 이 모듈은 content 에서 인라인 `<think>` 를 **추출(thinking)·제거(clean content)** 한다.
 *
 * **문제 2(서버 파싱 400):** 추론 모델이 `<think>` 생성물을 도구 호출 형식으로 못 만들면
 * 서버(LM Studio 등)가 `400 "Failed to parse input at pos 0: <think>…"` 를 던진다. raw
 * 덤프를 사용자에게 노출하지 않도록 **정제된 actionable 메시지**로 매핑한다(원문은 cause/로그).
 *
 * **순수 함수(IO·SDK import 0)** — 헤드리스 verify 대상. throw 0.
 */

/** 추론 분리 결과: 정리된 content(추론 비포함) + 추출된 thinking 텍스트(있으면). */
export interface ReasoningSplit {
  /** 추론 블록을 제거한 표시/저장/에코용 content(추론 없으면 원문 그대로). */
  readonly content: string
  /** 추출된 추론 텍스트(인라인 `<think>` 내용 결합). 없으면 ''. */
  readonly thinking: string
}

const THINK_OPEN = '<think>'
const THINK_CLOSE = '</think>'

/**
 * content 에서 인라인 `<think>…</think>` 블록을 추출하고 제거한다.
 *
 * - 닫는 `</think>` 가 있으면 그 사이를 thinking 으로 가져가고 블록을 제거.
 * - 여는 `<think>` 만 있고 닫힘이 없으면(스트림 절단·모델 누락) **여는 태그부터 끝까지**를
 *   thinking 으로 간주하고 제거(닫힘 없는 추론 누출 방지).
 * - 여러 블록도 처리. `<think>` 가 없으면 원문 그대로(회귀 0).
 * - 대소문자 무시(`<THINK>` 등 방어).
 */
export function splitReasoning(content: string): ReasoningSplit {
  if (!content) return { content, thinking: '' }
  const lower = content.toLowerCase()
  if (lower.indexOf(THINK_OPEN) === -1) return { content, thinking: '' }

  const thinkParts: string[] = []
  let out = ''
  let i = 0
  while (i < content.length) {
    const open = lower.indexOf(THINK_OPEN, i)
    if (open === -1) {
      out += content.slice(i)
      break
    }
    // 여는 태그 이전 자연어는 보존.
    out += content.slice(i, open)
    const afterOpen = open + THINK_OPEN.length
    const close = lower.indexOf(THINK_CLOSE, afterOpen)
    if (close === -1) {
      // 닫힘 없음 — 여는 태그부터 끝까지 추론으로 흡수(누출 방지).
      thinkParts.push(content.slice(afterOpen))
      i = content.length
      break
    }
    thinkParts.push(content.slice(afterOpen, close))
    i = close + THINK_CLOSE.length
  }

  return {
    content: out.trim(),
    thinking: thinkParts.join('\n').trim()
  }
}

// ── 서버 파싱 오류 → actionable 메시지 매핑 ─────────────────────────────────

/** 추론 모델 호환 안내(도구 호출 형식 생성 실패 시). */
export const REASONING_TOOL_PARSE_MESSAGE =
  '이 모델이 도구 호출 형식을 올바르게 생성하지 못했습니다(추론 모델 호환 문제일 수 있습니다). ' +
  '비추론(non-thinking) 모델이나 더 큰 모델을 사용해 보세요.'

/**
 * 서버/SDK 오류가 "도구 호출 파싱 실패(특히 추론 `<think>` 누출)"형인지 판정한다.
 *
 * LM Studio 등은 추론 모델이 도구 호출을 못 만들면 `400 "Failed to parse input at pos 0:
 * <think>…"` 를 던진다. status(4xx) + 메시지 패턴으로 보수적으로 식별한다(오탐 방지).
 */
export function isToolParseServerError(err: unknown): boolean {
  const msg = errorText(err)
  if (!msg) return false
  const lower = msg.toLowerCase()
  const looksParse =
    lower.includes('failed to parse') ||
    (lower.includes('parse') && lower.includes('tool')) ||
    lower.includes('<think>')
  if (!looksParse) return false
  // 가능하면 4xx 로 한정(status 없는 throw 도 메시지로 잡되, 5xx 명시면 제외).
  const status = httpStatus(err)
  if (status !== undefined && (status < 400 || status >= 500)) return false
  return true
}

/**
 * 임의 오류를 사용자에게 보일 **정제 메시지**로 매핑한다. 도구 파싱형이면 actionable 안내,
 * 그 외에는 원문 메시지(이미 사람이 읽을 수 있는 형태)를 반환한다. raw `<think>` 덤프는
 * 절대 노출하지 않는다(도구 파싱형으로 잡혀 안내로 치환되거나, 원문에 think 가 있으면 정리).
 */
export function mapServerError(err: unknown): string {
  // 도구 파싱형(추론 <think> 누출 포함)이면 actionable 안내로 치환(raw 비노출).
  // isToolParseServerError 가 <think> 포함 메시지도 잡으므로 raw 덤프는 UI 에 새지 않는다.
  if (isToolParseServerError(err)) return REASONING_TOOL_PARSE_MESSAGE
  const msg = errorText(err) || '알 수 없는 오류가 발생했습니다.'
  // 방어: 혹시라도 도구 파싱형으로 안 잡힌 메시지에 raw <think> 가 있으면 제거(이중 안전망).
  if (msg.toLowerCase().includes('<think>')) {
    const cleaned = splitReasoning(msg).content
    return cleaned || REASONING_TOOL_PARSE_MESSAGE
  }
  return msg
}

/** 오류 객체에서 사람이 읽을 메시지 문자열 추출(throw 0). */
function errorText(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  if (err && typeof err === 'object') {
    const m = (err as { message?: unknown }).message
    if (typeof m === 'string') return m
    try {
      return JSON.stringify(err)
    } catch {
      return String(err)
    }
  }
  return String(err)
}

/** OpenAI/SDK 오류에서 HTTP status 추출(있으면). 없으면 undefined. */
function httpStatus(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined
  const e = err as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } }
  if (typeof e.status === 'number') return e.status
  if (typeof e.statusCode === 'number') return e.statusCode
  if (e.response && typeof e.response.status === 'number') return e.response.status
  return undefined
}
