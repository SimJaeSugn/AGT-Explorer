/**
 * src/main/agent/provider/normalize/textToolCalls.ts — 텍스트형 tool_call 폴백 파서(§Z).
 *
 * **문제:** 일부 소형/호환 모델(특히 로컬 LM Studio qwen3-1.7b 등)이 도구 호출을 구조화된
 * `tool_calls`(OpenAI) / `tool_use` 블록(Anthropic) 으로 내보내지 않고, **응답 텍스트(content)
 * 안에 그대로 직렬화**해 흘려보낸다. 예(qwen):
 *
 *   <tool_call>
 *   {"name": "list_directory", "arguments": {"path": "E:\\"}}
 *   </tool_call>
 *
 * 이 경우 구조화 호출이 비어 있어 Orchestrator 가 `tool_use` 로 인식하지 못하고, raw 태그가
 * thinking/답변에 그대로 누출된다. 이 모듈은 그런 텍스트형 호출을 **방어적으로** 추출해
 * NormalizedToolCall[] 로 복원하고, 표시 텍스트에서 해당 블록을 제거한다.
 *
 * **순수 함수(IO·SDK import 0)** — 헤드리스 verify 대상. throw 0(깨진 JSON 은 건너뜀).
 *
 * 적용 우선순위(중요): **구조화 호출이 이미 있으면 폴백 미적용**(정상 경로 우선). 텍스트 폴백은
 * 구조화 호출이 비어 있을 때만 동작한다(openai.ts 어셈블러·비스트리밍에서 배선).
 */
import type { NormalizedToolCall } from '../LLMProvider'

/** 텍스트 추출 결과: 복원된 호출 + 호출 블록을 제거한 표시 텍스트. */
export interface TextToolCallExtraction {
  /** 복원된 도구 호출(0개면 텍스트형 호출 없음 — 회귀 안전). */
  readonly toolCalls: NormalizedToolCall[]
  /** 추출된 블록을 제거한 표시용 텍스트(남은 자연어만). 호출이 없으면 원문 그대로. */
  readonly cleanedText: string
}

/** 빈 결과(원문 보존) — 회귀 0 보장용 헬퍼. */
function empty(text: string): TextToolCallExtraction {
  return { toolCalls: [], cleanedText: text }
}

/**
 * 단일 후보(JSON 또는 그 문자열)를 NormalizedToolCall 로 변환. 형태가 안 맞으면 null(건너뜀).
 *
 * - `name`(문자열) 필수. 없으면 null.
 * - `arguments` 가 객체면 그대로 input.
 * - `arguments` 가 문자열이면 JSON.parse 시도(실패 시 parseError 표기·throw 0·input={}).
 * - `arguments` 누락이면 input={}(인자 없는 호출 허용).
 * - 객체가 아닌 arguments(배열·원시값)는 parseError.
 */
function toCall(raw: unknown, id: string): NormalizedToolCall | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  const name = obj['name']
  if (typeof name !== 'string' || name.trim() === '') return null

  // 일부 모델은 'arguments' 대신 'parameters'/'args' 를 쓴다(방어적 별칭).
  const argsRaw =
    'arguments' in obj ? obj['arguments'] : 'parameters' in obj ? obj['parameters'] : obj['args']

  if (argsRaw === undefined || argsRaw === null) {
    return { id, name, input: {} }
  }
  if (typeof argsRaw === 'object' && !Array.isArray(argsRaw)) {
    return { id, name, input: argsRaw as Record<string, unknown> }
  }
  if (typeof argsRaw === 'string') {
    const s = argsRaw.trim()
    if (s === '') return { id, name, input: {} }
    try {
      const parsed = JSON.parse(s) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { id, name, input: parsed as Record<string, unknown> }
      }
      return { id, name, input: {}, parseError: 'arguments 가 JSON 객체가 아닙니다.' }
    } catch (e) {
      return {
        id,
        name,
        input: {},
        parseError: `arguments JSON 파싱 실패: ${e instanceof Error ? e.message : String(e)}`
      }
    }
  }
  return { id, name, input: {}, parseError: 'arguments 가 객체/문자열이 아닙니다.' }
}

/**
 * 문자열에서 `pos` 위치의 `{` 로 시작하는 균형 잡힌 JSON 객체의 끝 인덱스(닫는 `}` 다음)를 찾는다.
 * 문자열 리터럴 내부의 중괄호·이스케이프를 무시한다. 못 찾으면 -1.
 */
function findBalancedObjectEnd(s: string, start: number): number {
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < s.length; i++) {
    const ch = s[i]
    if (inStr) {
      if (esc) {
        esc = false
      } else if (ch === '\\') {
        esc = true
      } else if (ch === '"') {
        inStr = false
      }
      continue
    }
    if (ch === '"') {
      inStr = true
    } else if (ch === '{') {
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0) return i + 1
    }
  }
  return -1
}

const TOOL_CALL_TAG = /<tool_call>([\s\S]*?)<\/tool_call>/gi

/**
 * 응답 content 에서 텍스트형 도구 호출을 추출하고 표시 텍스트를 정리한다.
 *
 * 패턴 1(Qwen·우선): `<tool_call> ... </tool_call>` 안의 JSON 객체(여러 개 가능). 태그는 표시
 *   텍스트에서 제거된다. 태그 안 JSON 이 깨졌으면 그 블록은 건너뛰되 **태그는 제거**(raw 누출 방지).
 * 패턴 2(방어·보수적): 패턴 1 매치가 하나도 없을 때만, 텍스트 안의 **균형 잡힌 `{...}` 객체**
 *   중 `name` + (`arguments`|`parameters`|`args`) 키를 동시에 가진 것만 추출(```json``` 펜스
 *   포함). 일반 JSON 출력 오인 방지를 위해 키 조건을 엄격히 본다.
 *
 * 구조화 호출 유무 판단은 호출 측(어셈블러/비스트리밍)에서 한다 — 이 함수는 텍스트만 본다.
 */
export function extractTextToolCalls(content: string): TextToolCallExtraction {
  if (!content || content.indexOf('{') === -1) return empty(content)

  const calls: NormalizedToolCall[] = []
  let seq = 0

  // ── 패턴 1: <tool_call>…</tool_call> ──────────────────────────────────────
  let cleaned = content
  let sawTag = false
  cleaned = cleaned.replace(TOOL_CALL_TAG, (_full, inner: string) => {
    sawTag = true
    const body = inner.trim()
    const objStart = body.indexOf('{')
    if (objStart !== -1) {
      const end = findBalancedObjectEnd(body, objStart)
      const jsonStr = end !== -1 ? body.slice(objStart, end) : body.slice(objStart)
      try {
        const parsed = JSON.parse(jsonStr) as unknown
        const call = toCall(parsed, `txt_${seq}`)
        if (call) {
          calls.push(call)
          seq++
        }
      } catch {
        // 깨진 JSON — 블록은 건너뛰되 태그는 제거(raw 누출 방지·throw 0).
      }
    }
    return '' // 태그(및 내용) 제거.
  })

  if (sawTag) {
    return { toolCalls: calls, cleanedText: cleaned.trim() }
  }

  // ── 패턴 2: 펜스/단독 {…} (보수적 — name+arguments 키 동시 보유) ──────────────
  // 패턴 1 매치가 전혀 없을 때만 동작. 균형 객체를 순회하며 도구 호출 모양만 추출.
  let scanFrom = 0
  let result = content
  const removeRanges: Array<[number, number]> = []
  for (;;) {
    const brace = content.indexOf('{', scanFrom)
    if (brace === -1) break
    const end = findBalancedObjectEnd(content, brace)
    if (end === -1) break
    const slice = content.slice(brace, end)
    // 빠른 사전 필터: name 과 (arguments|parameters|args) 가 모두 나타날 때만 parse 시도.
    const hasName = /"name"\s*:/.test(slice)
    const hasArgs = /"(arguments|parameters|args)"\s*:/.test(slice)
    if (hasName && hasArgs) {
      try {
        const parsed = JSON.parse(slice) as unknown
        const call = toCall(parsed, `txt_${seq}`)
        if (call) {
          calls.push(call)
          seq++
          removeRanges.push([brace, end])
        }
      } catch {
        // 깨진/부분 JSON — 건너뜀(표시 텍스트 보존).
      }
    }
    scanFrom = end
  }

  if (calls.length === 0) return empty(content)

  // 추출된 객체(및 감싸는 ```json 펜스)를 표시 텍스트에서 제거.
  for (let i = removeRanges.length - 1; i >= 0; i--) {
    const [s, e] = removeRanges[i]!
    let from = s
    let to = e
    // 앞쪽 ```json / ``` 펜스 흡수.
    const before = result.slice(0, from)
    const fence = before.match(/```(?:json)?\s*$/i)
    if (fence) from -= fence[0].length
    // 뒤쪽 ``` 펜스 흡수.
    const after = result.slice(to)
    const fenceEnd = after.match(/^\s*```/)
    if (fenceEnd) to += fenceEnd[0].length
    result = result.slice(0, from) + result.slice(to)
  }

  return { toolCalls: calls, cleanedText: result.trim() }
}
