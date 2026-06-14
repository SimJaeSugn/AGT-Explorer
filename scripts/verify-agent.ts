/**
 * verify:agent (§Z Z0) — 자연어 파일 에이전트 백엔드 헤드리스 검증.
 *
 * 실 SDK·실 API·실 네트워크 없이(스텁 주입) 다음을 단언한다:
 *   1) function-calling 정규화 어댑터(anthropic/openai) — 양방향 라운드트립·멀티콜·stop 매핑·
 *      깨진 arguments→parseError(throw 0).
 *   2) ssrfGuard — IP 리터럴(사설/loopback/링크로컬/169.254.169.254/IPv6 ULA·매핑) 차단·화이트
 *      리스트 정확 일치·정규화 우회 차단·DNS 리바인딩(스텁 lookup)·등록 검증.
 *   3) toolRegistry — 읽기 6종 스키마·미등록 도구 is_error·guardPath/scope 경로 거부·쓰기 도구 부재.
 *   4) AgentOrchestrator — 스텁 provider 주입(제공자 무지): tool_use→실행→finish·상한 초과 중단·취소·
 *      tool-use 미지원 degradation·tool_result 절단.
 *   5) agentKeyStore — 제공자별 슬롯 라운드트립·평문 미저장·미가용 거부(스텁 safeStorage).
 *   6) createProvider 팩토리 — 분기·키 미보유 EAUTH·internal baseUrl/modelId 필수·degradation 캡.
 *   7) modelRouter/models — 티어 라우팅·티어→모델 해석(internal 단일).
 *
 * 양식: 기존 verify-*(pass/fail·esbuild 번들→node·--external:electron). 순수 로직만 — 실 GUI/실
 * API/실 SSRF 네트워크는 🟡 미검증(✅위장 금지).
 */
import {
  fromAnthropicResponse,
  toAnthropicMessages,
  toAnthropicTools,
  extractSystem,
  type AnthropicResponse
} from '../src/main/agent/provider/normalize/anthropic'
import {
  createOpenAIStreamAssembler,
  fromOpenAIResponse,
  parseOpenAIToolCall,
  toOpenAIMessages,
  toOpenAITools,
  type OpenAIResponse,
  type OpenAIStreamChunk
} from '../src/main/agent/provider/normalize/openai'
import {
  createAnthropicStreamAssembler,
  fromAnthropicResponse as fromAnthropicResp2,
  type AnthropicStreamEvent
} from '../src/main/agent/provider/normalize/anthropic'
import { extractTextToolCalls } from '../src/main/agent/provider/normalize/textToolCalls'
import {
  splitReasoning,
  mapServerError,
  isToolParseServerError,
  REASONING_TOOL_PARSE_MESSAGE
} from '../src/main/agent/provider/normalize/reasoning'
import { createAnthropicProvider, type AnthropicClientLike } from '../src/main/agent/provider/AnthropicProvider'
import { createOpenAIProvider, type OpenAIClientLike } from '../src/main/agent/provider/OpenAIProvider'
import { createInternalProvider } from '../src/main/agent/provider/InternalOpenAICompatProvider'
import { runProviderProbe } from '../src/main/agent/providerProbe'
import { createProviderConfigStore } from '../src/main/agent/providerConfigStore'
import type { ThinkingDelta } from '../src/main/agent/provider/LLMProvider'
import {
  assertRequestAllowed,
  isBlockedIpLiteral,
  isBlockedIPv4,
  isBlockedIPv6,
  matchesAllowList,
  normalizeUrl,
  validateRegister,
  type DnsLookup
} from '../src/main/agent/provider/ssrfGuard'
import {
  executeTool,
  listToolDefs,
  lookupTool,
  createPendingBackend,
  buildRedirectError,
  type ReadToolBackend,
  type DispatchAction,
  type ToolProgress
} from '../src/main/agent/toolRegistry'
import {
  buildGroundingBlock,
  withGrounding,
  GROUNDING_HARD_RULES,
  GROUNDING_MAX_PER_CATEGORY,
  isPathError,
  MAX_CONSECUTIVE_PATH_ERRORS,
  REPEATED_PATH_ERROR_HINT
} from '../src/main/agent/grounding'
import { buildScope, isUnder, assertInScope, scopeRootsFromLocations } from '../src/main/agent/scope'
import { runAgentLoop, runHybrid, clampToolResult, type OrchestratorEvent } from '../src/main/agent/AgentOrchestrator'
import { createDefaultToolCatalog } from '../src/main/agent/ToolCatalog'
import {
  shouldPlan,
  normalizePlan,
  planHash,
  buildReasoningPlan,
  buildPlannerSystemPrompt,
  PLAN_TOOL
} from '../src/main/agent/planner'
import {
  MAX_PLAN_STEPS,
  MAX_REPLANS,
  nearBudget,
  MAX_TOOL_CALLS,
  exceededLimit,
  MAX_TURNS,
  MAX_TOOL_RESULT_CHARS,
  AGENT_SEARCH_MAX_MATCHED_FILES,
  AGENT_SEARCH_MAX_SCANNED_FILES,
  AGENT_SEARCH_TIME_BUDGET_MS,
  AGENT_TOOL_PROGRESS_THROTTLE_MS,
  AGENT_TOOL_PROGRESS_THROTTLE_FILES,
  AGENT_TOOL_PROGRESS_PATH_MAX
} from '../src/main/agent/limits'
import { createReadBackend, type ReadBackendDeps } from '../src/main/agent/readBackend'
import { route } from '../src/main/agent/modelRouter'
import { resolveModelId } from '../src/main/agent/models'
import { createAgentKeyStore } from '../src/main/agent/agentKeyStore'
import { createProvider } from '../src/main/agent/provider/createProvider'
import type {
  LLMProvider,
  LLMTurnResult,
  NormalizedCompletionReq,
  NormalizedMessage,
  NormalizedToolDef
} from '../src/main/agent/provider/LLMProvider'
import type { AgentEvent, AgentLocations, ProviderConfig } from '../src/shared/ipc/contracts'
import { safeStorageStub, __setAvailable } from './stub-safe-storage'
import type { CredFileIo } from '../src/main/os/credentials'

let pass = 0
let fail = 0
function check(name: string, cond: boolean): void {
  if (cond) {
    pass++
    // eslint-disable-next-line no-console
    console.log(`  PASS  ${name}`)
  } else {
    fail++
    // eslint-disable-next-line no-console
    console.log(`  FAIL  ${name}`)
  }
}
function section(s: string): void {
  // eslint-disable-next-line no-console
  console.log(`\n== ${s} ==`)
}

const SAMPLE_TOOLS: readonly NormalizedToolDef[] = [
  { name: 'list_directory', description: 'list', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } }
]

function memIo(): { io: CredFileIo; dump(): Record<string, string> | undefined } {
  let stored: Record<string, string> | undefined
  return {
    io: {
      read: async () => (stored ? { ...stored } : undefined),
      write: async (_p, v) => {
        stored = { ...v }
        return true
      }
    },
    dump: () => stored
  }
}

async function main(): Promise<void> {
  // ════ 1) 정규화 어댑터 ════════════════════════════════════════════════
  section('1) function-calling 정규화 어댑터')

  // Anthropic 도구 정의 직렬화.
  const antTools = toAnthropicTools(SAMPLE_TOOLS)
  check('[ant] tools→input_schema 변환', antTools[0]!.input_schema !== undefined && (antTools[0] as { name: string }).name === 'list_directory')

  // Anthropic 응답→공통(tool_use·멀티콜).
  const antResp: AnthropicResponse = {
    content: [
      { type: 'text', text: '탐색합니다' },
      { type: 'tool_use', id: 'tu_1', name: 'list_directory', input: { path: 'E:\\a' } },
      { type: 'tool_use', id: 'tu_2', name: 'scan_folder', input: { root: 'E:\\b' } }
    ],
    stop_reason: 'tool_use',
    usage: { input_tokens: 10, output_tokens: 5 }
  }
  const antTurn = fromAnthropicResponse(antResp)
  check('[ant] stop_reason tool_use→공통', antTurn.stopReason === 'tool_use')
  check('[ant] 멀티 tool_use→toolCalls[2]', antTurn.toolCalls.length === 2)
  check('[ant] tool_use input 보존', antTurn.toolCalls[0]!.input['path'] === 'E:\\a')
  check('[ant] text 누적', antTurn.text === '탐색합니다')
  check('[ant] usage 매핑', antTurn.usage?.inputTokens === 10 && antTurn.usage?.outputTokens === 5)
  check('[ant] end_turn 매핑', fromAnthropicResponse({ content: [], stop_reason: 'end_turn' }).stopReason === 'end_turn')

  // Anthropic 메시지·system 분리.
  const msgs: NormalizedMessage[] = [
    { role: 'system', content: 'SYS' },
    { role: 'user', content: '안녕' },
    { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'list_directory', input: { path: 'X' } }] },
    { role: 'tool', toolResults: [{ callId: 'c1', content: 'OK' }] }
  ]
  check('[ant] system top-level 분리', extractSystem(msgs) === 'SYS')
  const antMsgs = toAnthropicMessages(msgs)
  check('[ant] system 메시지 배열 제외', antMsgs.every((m) => m.role !== 'system'))
  check('[ant] tool 결과→user tool_result', antMsgs.some((m) => Array.isArray(m.content) && (m.content as Array<{ type: string }>).some((b) => b.type === 'tool_result')))

  // OpenAI 도구 정의.
  const oaTools = toOpenAITools(SAMPLE_TOOLS)
  check('[oai] tools→function.parameters', oaTools[0]!.type === 'function' && oaTools[0]!.function.name === 'list_directory')

  // OpenAI 응답→공통(tool_calls·arguments JSON 문자열).
  const oaResp: OpenAIResponse = {
    choices: [
      {
        message: {
          content: '진행',
          tool_calls: [
            { id: 'oc_1', function: { name: 'list_directory', arguments: '{"path":"E:\\\\c"}' } },
            { id: 'oc_2', function: { name: 'scan_folder', arguments: '{ bad json' } }
          ]
        },
        finish_reason: 'tool_calls'
      }
    ],
    usage: { prompt_tokens: 7, completion_tokens: 3 }
  }
  const oaTurn = fromOpenAIResponse(oaResp)
  check('[oai] finish_reason tool_calls→tool_use', oaTurn.stopReason === 'tool_use')
  check('[oai] arguments JSON 파싱', oaTurn.toolCalls[0]!.input['path'] === 'E:\\c')
  check('[oai] 깨진 arguments→parseError(throw 0)', oaTurn.toolCalls[1]!.parseError !== undefined && Object.keys(oaTurn.toolCalls[1]!.input).length === 0)
  check('[oai] stop 매핑', fromOpenAIResponse({ choices: [{ message: {}, finish_reason: 'stop' }] }).stopReason === 'end_turn')
  check('[oai] length→max_tokens', fromOpenAIResponse({ choices: [{ message: {}, finish_reason: 'length' }] }).stopReason === 'max_tokens')

  // OpenAI 메시지: assistant tool_calls·tool 결과 펼침.
  const oaMsgs = toOpenAIMessages(msgs)
  check('[oai] assistant tool_calls 직렬화(arguments=JSON 문자열)', oaMsgs.some((m) => m.role === 'assistant' && Array.isArray(m.tool_calls) && typeof m.tool_calls[0]!.function.arguments === 'string'))
  check('[oai] tool 결과→role:tool tool_call_id', oaMsgs.some((m) => m.role === 'tool' && m.tool_call_id === 'c1'))

  // 빈 arguments 안전.
  check('[oai] 빈 arguments→input={}', Object.keys(parseOpenAIToolCall({ id: 'x', function: { name: 'f', arguments: '' } }).input).length === 0)
  check('[oai] 배열 arguments→parseError', parseOpenAIToolCall({ id: 'x', function: { name: 'f', arguments: '[1,2]' } }).parseError !== undefined)

  // ── §Z 텍스트형 tool_call 폴백 파서(소형/호환 모델 비일관 케이스) ──────────────
  section('1b) 텍스트형 tool_call 폴백 파서(§Z)')

  // 파서 단위: Qwen <tool_call> 단일.
  const qwenSingle = '여기 결과입니다.\n<tool_call>\n{"name": "list_directory", "arguments": {"path": "E:\\\\"}}\n</tool_call>'
  const ext1 = extractTextToolCalls(qwenSingle)
  check('[txt] <tool_call> 1개 추출', ext1.toolCalls.length === 1 && ext1.toolCalls[0]!.name === 'list_directory')
  check('[txt] arguments 객체 input 보존', ext1.toolCalls[0]!.input['path'] === 'E:\\')
  check('[txt] 태그 제거(raw 누출 0)', !ext1.cleanedText.includes('<tool_call>') && !ext1.cleanedText.includes('list_directory') && ext1.cleanedText.includes('여기 결과입니다'))

  // 파서 단위: 여러 <tool_call> 블록.
  const qwenMulti = '<tool_call>{"name":"scan_folder","arguments":{"root":"E:\\\\a"}}</tool_call> 그리고 <tool_call>{"name":"finish","arguments":{"summary":"끝"}}</tool_call>'
  const ext2 = extractTextToolCalls(qwenMulti)
  check('[txt] 여러 <tool_call>→toolCalls[2]', ext2.toolCalls.length === 2 && ext2.toolCalls[1]!.name === 'finish')
  check('[txt] 다중 호출 id 고유', ext2.toolCalls[0]!.id !== ext2.toolCalls[1]!.id)

  // 파서 단위: arguments 가 JSON 문자열형.
  const argStr = '<tool_call>{"name":"list_directory","arguments":"{\\"path\\":\\"E:\\\\\\\\b\\"}"}</tool_call>'
  const ext3 = extractTextToolCalls(argStr)
  check('[txt] arguments 문자열형→JSON.parse', ext3.toolCalls.length === 1 && ext3.toolCalls[0]!.input['path'] === 'E:\\b')

  // 파서 단위: 깨진 JSON 은 건너뛰되 태그 제거(throw 0).
  const broken = '앞말 <tool_call>{ this is not json </tool_call> 뒷말'
  const ext4 = extractTextToolCalls(broken)
  check('[txt] 깨진 JSON 블록 건너뜀(throw 0)', ext4.toolCalls.length === 0)
  check('[txt] 깨진 블록도 태그 제거', !ext4.cleanedText.includes('<tool_call>') && ext4.cleanedText.includes('앞말') && ext4.cleanedText.includes('뒷말'))

  // 파서 단위: 텍스트형 호출 없으면 원문 불변(회귀 0).
  const plain = '이것은 평범한 답변입니다. 도구 호출 없음.'
  const ext5 = extractTextToolCalls(plain)
  check('[txt] 텍스트형 호출 없음→toolCalls[0]·원문 불변', ext5.toolCalls.length === 0 && ext5.cleanedText === plain)

  // 파서 단위: 패턴 2(펜스 없는 단독 {name,arguments}) 보수적 추출.
  const bare = '실행하겠습니다 {"name": "scan_folder", "arguments": {"root": "E:\\\\x"}} 완료'
  const ext6 = extractTextToolCalls(bare)
  check('[txt] 단독 {name,arguments} 보수적 추출', ext6.toolCalls.length === 1 && ext6.toolCalls[0]!.name === 'scan_folder' && ext6.toolCalls[0]!.input['root'] === 'E:\\x')
  // 일반 JSON(도구 호출 아님)은 무시(오탐 방지).
  const ext6b = extractTextToolCalls('설정은 {"theme":"dark","size":12} 입니다.')
  check('[txt] 일반 JSON(name/arguments 없음) 무시(오탐 0)', ext6b.toolCalls.length === 0)

  // 비스트리밍 적용: 구조화 tool_calls 없음 + content 에 텍스트형 → toolCalls·stopReason=tool_use·태그 제거.
  const oaTextResp: OpenAIResponse = {
    choices: [{ message: { content: '탐색합니다\n<tool_call>{"name":"list_directory","arguments":{"path":"E:\\\\"}}</tool_call>' }, finish_reason: 'stop' }]
  }
  const oaTextTurn = fromOpenAIResponse(oaTextResp)
  check('[txt-oai] 비스트리밍 폴백→toolCalls[1]', oaTextTurn.toolCalls.length === 1 && oaTextTurn.toolCalls[0]!.name === 'list_directory')
  check('[txt-oai] 비스트리밍 폴백→stopReason tool_use', oaTextTurn.stopReason === 'tool_use')
  check('[txt-oai] 비스트리밍 폴백→content 태그 제거', !oaTextTurn.text.includes('<tool_call>') && oaTextTurn.text.includes('탐색합니다'))

  // 우선순위: 구조화 tool_calls 가 있으면 폴백 미적용(텍스트형 무시).
  const oaBothResp: OpenAIResponse = {
    choices: [{
      message: {
        content: '<tool_call>{"name":"finish","arguments":{}}</tool_call>',
        tool_calls: [{ id: 'real', function: { name: 'list_directory', arguments: '{"path":"E:\\\\"}' } }]
      },
      finish_reason: 'tool_calls'
    }]
  }
  const oaBothTurn = fromOpenAIResponse(oaBothResp)
  check('[txt-oai] 구조화 호출 우선(텍스트 폴백 미적용)', oaBothTurn.toolCalls.length === 1 && oaBothTurn.toolCalls[0]!.id === 'real')

  // 회귀: 텍스트형 없는 일반 end_turn 응답은 기존 동작 불변.
  const oaPlainTurn = fromOpenAIResponse({ choices: [{ message: { content: '평범한 답변' }, finish_reason: 'stop' }] })
  check('[txt-oai] 텍스트형 없음→stopReason 불변(end_turn)', oaPlainTurn.stopReason === 'end_turn' && oaPlainTurn.toolCalls.length === 0 && oaPlainTurn.text === '평범한 답변')

  // 스트리밍 적용: delta.content 로 들어온 텍스트형 호출 조립 후 폴백.
  {
    const asm = createOpenAIStreamAssembler(() => {})
    asm.push({ choices: [{ delta: { content: '진행 <tool_call>{"name":"scan_folder",' } }] })
    asm.push({ choices: [{ delta: { content: '"arguments":{"root":"E:\\\\y"}}</tool_call>' } }] })
    asm.push({ choices: [{ delta: {}, finish_reason: 'stop' }] })
    const sres = asm.result()
    check('[txt-oai] 스트리밍 텍스트형 조립→폴백 toolCalls', sres.toolCalls.length === 1 && sres.toolCalls[0]!.name === 'scan_folder' && sres.toolCalls[0]!.input['root'] === 'E:\\y')
    check('[txt-oai] 스트리밍 폴백→stopReason tool_use·태그 제거', sres.stopReason === 'tool_use' && !sres.text.includes('<tool_call>'))
  }

  // 스트리밍 우선순위: 구조화 tool_calls 가 조립되면 텍스트 폴백 미적용.
  {
    const asm = createOpenAIStreamAssembler(() => {})
    asm.push({ choices: [{ delta: { content: '<tool_call>{"name":"finish","arguments":{}}</tool_call>', tool_calls: [{ index: 0, id: 'r', function: { name: 'list_directory', arguments: '{"path":"E:\\\\"}' } }] } }] })
    asm.push({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })
    const sres = asm.result()
    check('[txt-oai] 스트리밍 구조화 우선(폴백 미적용)', sres.toolCalls.length === 1 && sres.toolCalls[0]!.name === 'list_directory')
  }

  // Anthropic 폴백(소형/호환 모델 대비).
  const antTextTurn = fromAnthropicResp2({
    content: [{ type: 'text', text: '<tool_call>{"name":"list_directory","arguments":{"path":"E:\\\\"}}</tool_call>' }],
    stop_reason: 'end_turn'
  })
  check('[txt-ant] Anthropic 텍스트형 폴백→tool_use', antTextTurn.toolCalls.length === 1 && antTextTurn.stopReason === 'tool_use' && !antTextTurn.text.includes('<tool_call>'))
  const antRealTurn = fromAnthropicResp2({
    content: [{ type: 'tool_use', id: 'tu', name: 'finish', input: {} }],
    stop_reason: 'tool_use'
  })
  check('[txt-ant] Anthropic 구조화 tool_use 우선(폴백 미적용)', antRealTurn.toolCalls.length === 1 && antRealTurn.toolCalls[0]!.id === 'tu')

  // ── §Z 추론(reasoning) 분리 + 서버 파싱 400 매핑(qwen3 등 추론 모델 견고화) ──────────
  section('1c) 추론 분리 + 서버 파싱 400 매핑(§Z)')

  // splitReasoning: 닫힌 <think> 추출·제거.
  {
    const r = splitReasoning('<think>음 사용자가 목록을 원하네</think>여기 결과입니다.')
    check('[rea] 닫힌 <think> 제거→content clean', r.content === '여기 결과입니다.' && !r.content.includes('<think>'))
    check('[rea] 닫힌 <think> 내용 thinking 추출', r.thinking.includes('목록을 원하네'))
  }
  // splitReasoning: 닫힘 없는 <think>(스트림 절단·모델 누락) → 여는 태그부터 끝까지 흡수.
  {
    const r = splitReasoning('앞 답변 <think>여기부터 끝까지 추론인데 닫힘이 없음')
    check('[rea] 닫힘 없는 <think>→여는 태그부터 끝까지 제거', r.content === '앞 답변' && !r.content.includes('<think>'))
    check('[rea] 닫힘 없는 <think> 내용 thinking 추출', r.thinking.includes('닫힘이 없음'))
  }
  // splitReasoning: 여러 블록 + 대소문자.
  {
    const r = splitReasoning('<THINK>a</THINK>중간<think>b</think>끝')
    check('[rea] 다중 블록·대소문자 무시 제거', r.content === '중간끝' && !r.content.toLowerCase().includes('<think>'))
    check('[rea] 다중 블록 thinking 결합', r.thinking.includes('a') && r.thinking.includes('b'))
  }
  // splitReasoning: <think> 없으면 원문 불변(회귀 0).
  {
    const r = splitReasoning('그냥 평범한 답변입니다.')
    check('[rea] <think> 없음→원문 불변·thinking 빈값', r.content === '그냥 평범한 답변입니다.' && r.thinking === '')
  }

  // OpenAI 응답: reasoning_content(비표준)는 content/tool 처리에서 제외(thinking 으로만 취급).
  {
    const respRC: OpenAIResponse = {
      choices: [{ message: { content: '최종 답변', reasoning_content: '내부 추론 토큰' }, finish_reason: 'stop' }]
    }
    const turn = fromOpenAIResponse(respRC)
    check('[rea-oai] reasoning_content 제외→content 는 답변만', turn.text === '최종 답변' && !turn.text.includes('내부 추론'))
    check('[rea-oai] reasoning_content 만 있는 응답 tool 처리 미오염', turn.toolCalls.length === 0 && turn.stopReason === 'end_turn')
  }
  // OpenAI 응답: content 인라인 <think> → 제거(닫힘·미닫힘 모두).
  {
    const turnClosed = fromOpenAIResponse({ choices: [{ message: { content: '<think>추론</think>깔끔한 답' }, finish_reason: 'stop' }] })
    check('[rea-oai] content 인라인 <think>(닫힘) 제거', turnClosed.text === '깔끔한 답' && !turnClosed.text.includes('<think>'))
    const turnOpen = fromOpenAIResponse({ choices: [{ message: { content: '답변 <think>끝없는 추론' }, finish_reason: 'stop' }] })
    check('[rea-oai] content 인라인 <think>(미닫힘) 제거', turnOpen.text === '답변' && !turnOpen.text.includes('<think>'))
  }
  // OpenAI 응답: <think> 안에 텍스트형 tool_call 이 섞여도 추론 제거가 우선(누출 0).
  {
    const turn = fromOpenAIResponse({ choices: [{ message: { content: '<think>고민중</think>\n<tool_call>{"name":"list_directory","arguments":{"path":"E:\\\\"}}</tool_call>' }, finish_reason: 'stop' }] })
    check('[rea-oai] <think> 제거 후에도 텍스트형 tool_call 폴백 동작', turn.toolCalls.length === 1 && turn.toolCalls[0]!.name === 'list_directory')
    check('[rea-oai] <think>·<tool_call> 모두 content 비노출', !turn.text.includes('<think>') && !turn.text.includes('<tool_call>'))
  }

  // OpenAI 스트림: reasoning_content 델타는 thinking(onDelta)로만·content 누적 제외.
  {
    const deltas: string[] = []
    const asm = createOpenAIStreamAssembler((t) => deltas.push(t))
    asm.push({ choices: [{ delta: { reasoning_content: '추론조각1' } }] })
    asm.push({ choices: [{ delta: { reasoning_content: '추론조각2' } }] })
    asm.push({ choices: [{ delta: { content: '최종답' } }] })
    asm.push({ choices: [{ delta: {}, finish_reason: 'stop' }] })
    const sres = asm.result()
    check('[rea-oai] 스트림 reasoning_content→thinking onDelta 흐름', deltas.includes('추론조각1') && deltas.includes('추론조각2'))
    check('[rea-oai] 스트림 reasoning_content→content 누적 제외', sres.text === '최종답' && !sres.text.includes('추론조각'))
  }
  // OpenAI 스트림: content 인라인 <think> 조립 후 제거.
  {
    const asm = createOpenAIStreamAssembler(() => {})
    asm.push({ choices: [{ delta: { content: '<think>스트림 추론' } }] })
    asm.push({ choices: [{ delta: { content: '계속</think>답변본문' } }] })
    asm.push({ choices: [{ delta: {}, finish_reason: 'stop' }] })
    const sres = asm.result()
    check('[rea-oai] 스트림 인라인 <think> 조립 후 제거', sres.text === '답변본문' && !sres.text.includes('<think>'))
  }

  // toOpenAIMessages 라운드트립: assistant content 에 <think> 미포함(에코 clean).
  {
    const turn = fromOpenAIResponse({ choices: [{ message: { content: '<think>비밀 추론</think>표시 답변' }, finish_reason: 'stop' }] })
    const round = toOpenAIMessages([{ role: 'assistant', content: turn.text }])
    const asst = round.find((m) => m.role === 'assistant')
    check('[rea-rt] 라운드트립 assistant content <think> 미포함', !!asst && typeof asst.content === 'string' && !asst.content.includes('<think>') && asst.content === '표시 답변')
  }

  // Anthropic 인라인 <think> 분리(무해 적용).
  {
    const turn = fromAnthropicResp2({ content: [{ type: 'text', text: '<think>ant 추론</think>ant 답변' }], stop_reason: 'end_turn' })
    check('[rea-ant] Anthropic content 인라인 <think> 제거', turn.text === 'ant 답변' && !turn.text.includes('<think>'))
  }

  // 서버 파싱 400 → actionable 매핑(raw <think> 비노출).
  {
    const parse400 = Object.assign(new Error('Failed to parse input at pos 0: <think>\nOkay, let\'s see...'), { status: 400 })
    check('[err] 400 "Failed to parse <think>"→파싱오류 판정', isToolParseServerError(parse400))
    const mapped = mapServerError(parse400)
    check('[err] 400→actionable 메시지(raw <think> 비노출)', mapped === REASONING_TOOL_PARSE_MESSAGE && !mapped.includes('<think>') && !mapped.includes('Failed to parse'))
  }
  // status 없는 throw 라도 메시지 패턴이면 매핑(LM Studio 가 status 안 줄 수도).
  {
    const noStatus = new Error('Failed to parse input at pos 0: <think>...')
    check('[err] status 없는 "Failed to parse"도 매핑', mapServerError(noStatus) === REASONING_TOOL_PARSE_MESSAGE)
  }
  // 5xx 는 서버 일반 오류로 간주(도구 파싱형 아님 — 원문 유지·단 <think>는 정리).
  {
    const e500 = Object.assign(new Error('internal server error'), { status: 500 })
    check('[err] 5xx 일반 오류는 도구 파싱형 아님', !isToolParseServerError(e500) && mapServerError(e500) === 'internal server error')
  }
  // 일반 오류(추론 무관)는 원문 메시지 유지(회귀 0).
  {
    const eauth = new Error('인증에 실패했습니다(401).')
    check('[err] 일반 오류 원문 유지(회귀 0)', !isToolParseServerError(eauth) && mapServerError(eauth) === '인증에 실패했습니다(401).')
  }
  // 오류 메시지에 raw <think> 가 섞여 있으면 절대 그대로 노출하지 않는다(UI 누출 방지).
  // <think> 포함은 추론 누출 시나리오로 간주 → actionable 메시지로 치환(raw 비노출이 핵심).
  {
    const dirty = new Error('something <think>leak</think> happened')
    const mapped = mapServerError(dirty)
    check('[err] <think> 포함 오류→raw 비노출(actionable 치환)', !mapped.includes('<think>') && !mapped.includes('leak'))
  }

  // 오케스트레이터: provider throw(400 파싱) → 정제 error 이벤트·루프 깔끔히 종료(프리징 0).
  {
    const throwingProvider: LLMProvider = {
      id: 'internal',
      capabilities: { toolUse: true, streaming: true },
      async createCompletion(): Promise<LLMTurnResult> {
        throw Object.assign(new Error('Failed to parse input at pos 0: <think>\n...'), { status: 400 })
      }
    }
    const errScope = buildScope('E:\\work', [])
    const errGuard = (p: string) =>
      typeof p === 'string' && p.startsWith('E:\\')
        ? { ok: true as const, value: p }
        : { ok: false as const, error: { code: 'EINVAL' as const, message: '거부' } }
    const errBackend: ReadToolBackend = {
      list: async () => ({ content: 'ok' }),
      search: async () => ({ content: 'ok' }),
      preview: async () => ({ content: 'ok' }),
      scan: async () => ({ content: 'ok' }),
      dup: async () => ({ content: 'ok' }),
      compare: async () => ({ content: 'ok' })
    }
    const events: OrchestratorEvent[] = []
    const out = await runAgentLoop(throwingProvider, { prompt: 'p', scope: errScope, contentConsent: false, backend: errBackend, guardPath: errGuard }, (e) => events.push(e))
    check('[err-loop] provider 400 throw→error 종료(프리징 0)', out.stopReason === 'error')
    const errEvt = events.find((e) => e.type === 'error')
    check('[err-loop] error 이벤트 actionable·raw <think> 비노출', !!errEvt && errEvt.type === 'error' && errEvt.message === REASONING_TOOL_PARSE_MESSAGE && !errEvt.message.includes('<think>'))
  }

  // ════ 2) ssrfGuard (정책 B — 2026-06-14 완화) ═══════════════════════════
  // 정책 B(사용자 결정): 로컬 LLM(LM Studio·Ollama `127.0.0.1`)·사내 LAN 게이트웨이를
  // 사용자가 설정에서 **직접 등록**할 수 있게 loopback·사설 LAN 을 허용한다(BYO base URL —
  // LLM 비자율). 보안 핵심인 링크로컬(169.254/16·메타데이터 169.254.169.254)·unspecified
  // (0.0.0.0/::)·IPv6 링크로컬(fe80::/10)은 **계속 차단**. 화이트리스트 요구는 유지(등록한
  // 호스트만 통로). (이전 정책 A 는 loopback·사설을 차단했음 — B 로 뒤집음.)
  section('2) ssrfGuard (정책 B: loopback/사설 허용·링크로컬/메타데이터 차단)')
  // ── 정책 B 로 허용(이전엔 차단) ──────────────────────────────────────────
  check('[ip] 10/8 사설 허용(B)', !isBlockedIPv4([10, 0, 0, 1]))
  check('[ip] 172.16/12 사설 허용(B)', !isBlockedIPv4([172, 16, 0, 1]) && !isBlockedIPv4([172, 31, 255, 1]))
  check('[ip] 192.168/16 사설 허용(B)', !isBlockedIPv4([192, 168, 1, 1]))
  check('[ip] 127/8 loopback 허용(B)', !isBlockedIPv4([127, 0, 0, 1]))
  check('[ip] 100.64/10 CGNAT 허용(B)', !isBlockedIPv4([100, 64, 0, 1]))
  check('[ip] 172.32 비차단(사설 범위 밖·공인)', !isBlockedIPv4([172, 32, 0, 1]))
  // ── 계속 차단(보안 핵심) ─────────────────────────────────────────────────
  check('[ip] 169.254.169.254 메타데이터 차단(유지)', isBlockedIPv4([169, 254, 169, 254]))
  check('[ip] 169.254/16 링크로컬 차단(유지)', isBlockedIPv4([169, 254, 1, 1]))
  check('[ip] 0.0.0.0 unspecified 차단(유지)', isBlockedIPv4([0, 0, 0, 0]))
  check('[ip] 멀티캐스트 224 차단(유지)', isBlockedIPv4([224, 0, 0, 1]))
  check('[ip] 240/4 예약 차단(유지)', isBlockedIPv4([240, 0, 0, 1]))
  check('[ip] 8.8.8.8 공인 허용', !isBlockedIPv4([8, 8, 8, 8]))
  // ── IPv6 ─────────────────────────────────────────────────────────────────
  check('[ipv6] ::1 loopback 허용(B)', !isBlockedIPv6('::1'))
  check('[ipv6] fc00::/7 ULA 허용(B)', !isBlockedIPv6('fd00:abcd::1') && !isBlockedIPv6('fc00::1'))
  check('[ipv6] fe80 링크로컬 차단(유지)', isBlockedIPv6('fe80::1'))
  check('[ipv6] :: unspecified 차단(유지)', isBlockedIPv6('::'))
  check('[ipv6] ::ffff:10.0.0.1 매핑 사설 허용(B)', !isBlockedIPv6('::ffff:10.0.0.1'))
  check('[ipv6] ::ffff:127.0.0.1 매핑 loopback 허용(B)', !isBlockedIPv6('::ffff:127.0.0.1'))
  check('[ipv6] 공인 2001:db8 비차단', !isBlockedIPv6('2001:db8::1'))
  check('[lit] IP 리터럴 판정(메타데이터=true·공인/사설=false)', isBlockedIpLiteral('169.254.169.254') && !isBlockedIpLiteral('api.example.com') && !isBlockedIpLiteral('10.0.0.1'))

  // ── IPv4-매핑 IPv6: 차단 대역만 거부(정책 B 위임 회귀) ─────────────────────
  // WHATWG URL 파서는 `[::ffff:169.254.169.254]` 를 헥스텟 압축형 `[::ffff:a9fe:a9fe]`
  // 로 정규화한다. extractMappedIPv4 후 isBlockedIPv4(=정책 B)에 위임하므로, 링크로컬/
  // 메타데이터 매핑은 계속 차단되고 loopback/사설 매핑은 허용된다. 실 경로 보장을 위해
  // `new URL(...).hostname`(=normalizeUrl 산출 호스트)으로 단언한다.
  const mappedHost = (u: string): string => normalizeUrl(u)!.hostname
  check('[ipv6-map] new URL 정규화형 ::ffff:a9fe:a9fe(=169.254.169.254) 차단(유지)', isBlockedIPv6(mappedHost('http://[::ffff:169.254.169.254]/')))
  check('[ipv6-map] new URL 정규화형 ::ffff:7f00:1(=127.0.0.1) 허용(B)', !isBlockedIPv6(mappedHost('http://[::ffff:127.0.0.1]/')))
  check('[ipv6-map] new URL 정규화형 ::ffff:a00:1(=10.0.0.1) 허용(B)', !isBlockedIPv6(mappedHost('http://[::ffff:10.0.0.1]/')))
  check('[ipv6-map] 비압축형 0:0:0:0:0:ffff:192.168.0.1 허용(B)', !isBlockedIPv6('0:0:0:0:0:ffff:192.168.0.1'))
  check('[ipv6-map] 헥스텟형 직접 ::ffff:c0a8:1(=192.168.0.1) 허용(B)', !isBlockedIPv6('::ffff:c0a8:1'))
  check('[ipv6-map] 공인 매핑 ::ffff:8.8.8.8 비차단', !isBlockedIPv6(mappedHost('http://[::ffff:8.8.8.8]/')))

  // 정규화·정규화 우회.
  const n1 = normalizeUrl('HTTPS://API.Example.COM.:443/v1')
  check('[norm] 대문자·trailing dot 정규화', n1?.hostname === 'api.example.com' && n1?.port === 443)
  check('[norm] file:// 거부', normalizeUrl('file:///etc/passwd') === null)
  check('[norm] 스킴 없는 입력 거부', normalizeUrl('not-a-url') === null)
  check('[norm] ftp:// 거부', normalizeUrl('ftp://h/x') === null)
  // 로컬 LLM base URL 정규화(LM Studio `127.0.0.1:1234/v1`) — 포트·경로·http 허용.
  const nLocal = normalizeUrl('http://127.0.0.1:1234/v1')
  check('[norm] 로컬 LLM http://127.0.0.1:1234/v1 정규화(포트/http 허용)', nLocal?.hostname === '127.0.0.1' && nLocal?.port === 1234 && nLocal?.scheme === 'http:')
  const nLocalHost = normalizeUrl('http://localhost:1234')
  check('[norm] http://localhost:1234 정규화', nLocalHost?.hostname === 'localhost' && nLocalHost?.port === 1234)

  // 화이트리스트 정확 일치.
  const allow = ['llm.internal.corp:443', 'host2.local']
  check('[wl] 정확 일치 허용', matchesAllowList(normalizeUrl('https://llm.internal.corp/v1')!, allow))
  check('[wl] 호스트만 등록→기본포트 매칭', matchesAllowList(normalizeUrl('https://host2.local/v1')!, allow))
  check('[wl] 목록 밖 거부', !matchesAllowList(normalizeUrl('https://evil.com/v1')!, allow))

  // 등록 검증(1~4) — 실 입력 URL 문자열로 검증(validateRegister 내부에서 normalizeUrl→new URL()).
  check('[reg] 공인 도메인 등록 허용', validateRegister('https://llm.internal.corp/v1').ok)
  // ── 정책 B: 로컬/사설 IP 리터럴 등록 허용(이전엔 거부) ──────────────────────
  check('[reg] 로컬 LLM http://127.0.0.1:1234/v1 등록 허용(B)', validateRegister('http://127.0.0.1:1234/v1').ok)
  check('[reg] localhost:1234 등록 허용(B)', validateRegister('http://localhost:1234').ok)
  check('[reg] 사설 192.168.1.50:8000 등록 허용(B)', validateRegister('http://192.168.1.50:8000').ok)
  check('[reg] 사설 10.0.0.5 등록 허용(B)', validateRegister('http://10.0.0.5').ok)
  check('[reg] 사설 172.16.0.10 등록 허용(B)', validateRegister('http://172.16.0.10').ok)
  check('[reg] IPv6 loopback [::1]:1234 등록 허용(B)', validateRegister('http://[::1]:1234').ok)
  check('[reg] IPv4-매핑 loopback [::ffff:127.0.0.1] 등록 허용(B)', validateRegister('http://[::ffff:127.0.0.1]').ok)
  // ── 계속 거부(보안 핵심) ─────────────────────────────────────────────────
  check('[reg] 메타데이터 IP 등록 거부(유지)', !validateRegister('https://169.254.169.254/v1').ok)
  check('[reg] 169.254 링크로컬 등록 거부(유지)', !validateRegister('http://169.254.1.1').ok)
  check('[reg] 0.0.0.0 등록 거부(유지)', !validateRegister('http://0.0.0.0').ok)
  check('[reg] file 스킴 등록 거부', !validateRegister('file:///x').ok)
  check('[reg] IPv4-매핑 IPv6 메타데이터 등록 거부(유지)', !validateRegister('https://[::ffff:169.254.169.254]/v1').ok)
  check('[reg] IPv6 링크로컬 [fe80::1] 등록 거부(유지)', !validateRegister('http://[fe80::1]').ok)

  // 요청 직전(1~6·DNS 리바인딩 스텁).
  const okLookup: DnsLookup = async () => [{ address: '93.184.216.34', family: 4 }]
  const metaLookup: DnsLookup = async () => [{ address: '169.254.169.254', family: 4 }]
  const loopbackLookup: DnsLookup = async () => [{ address: '127.0.0.1', family: 4 }]
  const r1 = await assertRequestAllowed('https://llm.internal.corp/v1', allow, okLookup)
  check('[req] 화이트리스트+공인 해석 허용', r1.ok)
  // 정책 B: 도메인이 loopback 으로 해석돼도 허용(로컬 LLM 도메인 별칭).
  const r2 = await assertRequestAllowed('https://llm.internal.corp/v1', allow, loopbackLookup)
  check('[req] DNS 해석 127.0.0.1→허용(B·로컬 LLM)', r2.ok)
  // 정책 B 유지: 도메인이 메타데이터로 해석되면 여전히 거부(DNS 리바인딩 방어).
  const r2b = await assertRequestAllowed('https://llm.internal.corp/v1', allow, metaLookup)
  check('[req] DNS 리바인딩(메타데이터 해석) 차단(유지)', !r2b.ok)
  const r3 = await assertRequestAllowed('https://evil.com/v1', allow, okLookup)
  check('[req] 화이트리스트 밖 차단', !r3.ok)
  // 정책 B: 화이트리스트에 등록된 사설/로컬 IP 리터럴 요청 허용(이전엔 차단).
  const r4 = await assertRequestAllowed('http://10.0.0.9/v1', ['10.0.0.9:80'], okLookup)
  check('[req] 화이트리스트 등록 사설 IP 리터럴 허용(B)', r4.ok)
  const r4b = await assertRequestAllowed('http://127.0.0.1:1234/v1', ['127.0.0.1:1234'], okLookup)
  check('[req] 화이트리스트 등록 로컬 LLM(127.0.0.1:1234) 허용(B)', r4b.ok)
  // 화이트리스트에 없으면 사설이어도 차단(화이트리스트 게이트 유지).
  const r4c = await assertRequestAllowed('http://10.0.0.9/v1', [], okLookup)
  check('[req] 화이트리스트 미등록 사설 IP 차단(화이트리스트 유지)', !r4c.ok)

  // ── 요청 직전 SSRF 실경로(정책 B) ──────────────────────────────────────────
  // 실 코드 경로 그대로 검증: assertRequestAllowed(<URL 문자열>, allowList, lookupStub).
  // lookupStub 은 IP 리터럴이라 호출되지 않지만 안전하게 공인 IP 반환.
  // 차단 케이스: 링크로컬/메타데이터/unspecified 만(화이트리스트에 넣어도 IP 게이트로 거부).
  const blockedReqs: ReadonlyArray<readonly [string, string]> = [
    ['http://[::ffff:169.254.169.254]/', '[::ffff:a9fe:a9fe]:80'],
    ['http://169.254.169.254/', '169.254.169.254:80'],
    ['http://169.254.1.1/', '169.254.1.1:80'],
    ['http://[fe80::1]/', '[fe80::1]:80'],
    ['http://0.0.0.0/', '0.0.0.0:80']
  ]
  for (const [url, key] of blockedReqs) {
    const rr = await assertRequestAllowed(url, [key], okLookup)
    check(`[req-ssrf] 실경로 차단(유지): ${url}`, !rr.ok)
  }
  // 정책 B 로 허용되는 케이스(화이트리스트 등록 + 로컬/사설 IP 리터럴) — 거짓 차단 회귀 방지.
  // 0x7f000001·2130706433 은 new URL() 이 127.0.0.1 로 canonical화 → 정책 B 로 허용.
  const allowedReqs: ReadonlyArray<readonly [string, string]> = [
    ['http://[::ffff:127.0.0.1]/', '[::ffff:7f00:1]:80'],
    ['http://[::ffff:10.0.0.1]/', '[::ffff:a00:1]:80'],
    ['http://[::1]/', '[::1]:80'],
    ['http://127.0.0.1/', '127.0.0.1:80'],
    ['http://0x7f000001/', '127.0.0.1:80'],
    ['http://2130706433/', '127.0.0.1:80']
  ]
  for (const [url, key] of allowedReqs) {
    const rr = await assertRequestAllowed(url, [key], okLookup)
    check(`[req-ssrf] 실경로 허용(B·화이트리스트 등록): ${url}`, rr.ok)
  }
  // 공인 화이트리스트 호스트 허용 — 거짓 차단 회귀 방지.
  const allowReq1 = await assertRequestAllowed('https://api.openai.com/v1', ['api.openai.com:443'], okLookup)
  check('[req-ssrf] 공인 화이트리스트 호스트 허용', allowReq1.ok)
  const allowReq2 = await assertRequestAllowed('https://llm.internal.corp/v1', allow, okLookup)
  check('[req-ssrf] 내부 공인 호스트 허용', allowReq2.ok)

  // ════ 3) toolRegistry ═════════════════════════════════════════════════
  section('3) toolRegistry (읽기 전용)')
  const defs = listToolDefs()
  const names = defs.map((d) => d.name)
  for (const t of ['list_directory', 'search_content', 'read_preview', 'scan_folder', 'find_duplicates', 'compare_folders', 'finish']) {
    check(`[reg] 도구 선언: ${t}`, names.includes(t))
  }
  for (const w of ['move', 'copy', 'rename', 'mkdir', 'trash', 'delete']) {
    check(`[reg] 쓰기 도구 미선언: ${w}`, !names.includes(w) && lookupTool(w) === undefined)
  }
  check('[reg] 모든 등록 도구 mode=read', ['list_directory', 'search_content', 'read_preview', 'scan_folder', 'find_duplicates', 'compare_folders'].every((n) => lookupTool(n)?.mode === 'read'))

  const scope = buildScope('E:\\work', ['E:\\work\\sel'])
  const guardOk = (p: string) => (typeof p === 'string' && p.startsWith('E:\\') ? { ok: true as const, value: p } : { ok: false as const, error: { code: 'EINVAL' as const, message: '거부' } })
  let backendCalled = ''
  const recordBackend: ReadToolBackend = {
    list: async (p) => { backendCalled = `list:${p}`; return { content: 'ok' } },
    search: async () => ({ content: 'ok' }),
    preview: async (_p, c) => ({ content: c ? 'with-content' : 'meta-only' }),
    scan: async () => ({ content: 'ok' }),
    dup: async () => ({ content: 'ok' }),
    compare: async () => ({ content: 'ok' }),
    // §Z 기본 스텁: 모든 경로 존재하는 디렉토리로 간주(open_tab 정상 경로 테스트용).
    statPath: async () => ({ exists: true, isDir: true })
  }
  const ctx = { backend: recordBackend, scope, guardPath: guardOk, contentConsent: false }

  const exMissing = await executeTool('frobnicate', {}, ctx)
  check('[exec] 미등록 도구→is_error(throw 0)', exMissing.isError === true)

  const exOut = await executeTool('list_directory', { path: 'C:\\other' }, ctx)
  check('[exec] 스코프 밖 경로 거부(is_error)', exOut.isError === true && backendCalled === '')

  const exIn = await executeTool('list_directory', { path: 'E:\\work\\sub' }, ctx)
  check('[exec] 스코프 안 경로→백엔드 실행', exIn.isError !== true && backendCalled === 'list:E:\\work\\sub')

  const exConsentOff = await executeTool('read_preview', { path: 'E:\\work\\f.txt' }, ctx)
  check('[exec] contentConsent=false→메타만', exConsentOff.content === 'meta-only')
  const exConsentOn = await executeTool('read_preview', { path: 'E:\\work\\f.txt' }, { ...ctx, contentConsent: true })
  check('[exec] contentConsent=true→실내용', exConsentOn.content === 'with-content')

  const exBadGuard = await executeTool('list_directory', { path: 'relative\\x' }, ctx)
  check('[exec] guardPath 거부 경로→is_error', exBadGuard.isError === true)

  const pending = createPendingBackend()
  const exPending = await executeTool('list_directory', { path: 'E:\\work\\z' }, { ...ctx, backend: pending })
  check('[exec] 미배선 백엔드(Z1)→is_error', exPending.isError === true)

  // scope 단언.
  check('[scope] isUnder 하위 true', isUnder('E:\\work\\a\\b', 'E:\\work'))
  check('[scope] isUnder 경계 존중(work2 아님)', !isUnder('E:\\work2\\a', 'E:\\work'))
  check('[scope] 시스템 폴더 거부', !assertInScope('C:\\Windows\\System32', { roots: ['C:\\'] }).ok)
  check('[scope] 원격 prefix 거부', !assertInScope('sftp://h/x', scope).ok)

  // ════ 4) AgentOrchestrator ════════════════════════════════════════════
  section('4) AgentOrchestrator (스텁 provider·제공자 무지)')

  // tool_use→실행→finish 시나리오.
  function scriptedProvider(turns: LLMTurnResult[], capToolUse = true): LLMProvider {
    let i = 0
    const seen: NormalizedCompletionReq[] = []
    const prov: LLMProvider & { seen: NormalizedCompletionReq[] } = {
      id: 'anthropic',
      capabilities: { toolUse: capToolUse, streaming: true },
      seen,
      async createCompletion(req): Promise<LLMTurnResult> {
        seen.push(req)
        return turns[Math.min(i++, turns.length - 1)]!
      }
    }
    return prov
  }

  {
    const provider = scriptedProvider([
      { text: '탐색', toolCalls: [{ id: 't1', name: 'list_directory', input: { path: 'E:\\work\\a' } }], stopReason: 'tool_use' },
      { text: '끝', toolCalls: [{ id: 't2', name: 'finish', input: { summary: '완료요약' } }], stopReason: 'tool_use' }
    ])
    const events: OrchestratorEvent[] = []
    const out = await runAgentLoop(provider, { prompt: 'p', scope, contentConsent: false, backend: recordBackend, guardPath: guardOk }, (e) => events.push(e))
    check('[loop] tool_use→read 실행→finish 종료', out.stopReason === 'finish')
    check('[loop] finish summary 반영', out.summary === '완료요약')
    check('[loop] tool-call 이벤트 emit', events.some((e) => e.type === 'tool-call' && e.tool === 'list_directory'))
    check('[loop] finish 이벤트 emit', events.some((e) => e.type === 'finish'))
  }

  // end_turn 즉시 종료.
  {
    const provider = scriptedProvider([{ text: '답', toolCalls: [], stopReason: 'end_turn' }])
    const out = await runAgentLoop(provider, { prompt: 'p', scope, contentConsent: false, backend: recordBackend, guardPath: guardOk }, () => {})
    check('[loop] end_turn 즉시 종료', out.stopReason === 'end_turn' && out.turns === 1)
  }

  // degradation: tool-use 미지원.
  {
    const provider = scriptedProvider([{ text: '', toolCalls: [], stopReason: 'end_turn' }], false)
    const events: OrchestratorEvent[] = []
    const out = await runAgentLoop(provider, { prompt: 'p', scope, contentConsent: false, backend: recordBackend, guardPath: guardOk }, (e) => events.push(e))
    check('[loop] tool-use 미지원→error 종료(degradation)', out.stopReason === 'error' && events.some((e) => e.type === 'error'))
  }

  // 취소.
  {
    const ctrl = new AbortController()
    ctrl.abort()
    const provider = scriptedProvider([{ text: '', toolCalls: [{ id: 't', name: 'list_directory', input: { path: 'E:\\work\\a' } }], stopReason: 'tool_use' }])
    const out = await runAgentLoop(provider, { prompt: 'p', scope, contentConsent: false, backend: recordBackend, guardPath: guardOk, signal: ctrl.signal }, () => {})
    check('[loop] 사전 취소→aborted', out.stopReason === 'aborted')
  }

  // 상한: 무한 tool_use → turns 상한.
  {
    const provider = scriptedProvider([{ text: '', toolCalls: [{ id: 't', name: 'list_directory', input: { path: 'E:\\work\\a' } }], stopReason: 'tool_use' }])
    const events: OrchestratorEvent[] = []
    const out = await runAgentLoop(provider, { prompt: 'p', scope, contentConsent: false, backend: recordBackend, guardPath: guardOk }, (e) => events.push(e))
    check('[loop] 무한 tool_use→상한 중단(limit)', out.stopReason === 'limit' && out.turns <= MAX_TURNS && events.some((e) => e.type === 'limit'))
  }

  // 깨진 arguments→is_error 회신(루프 계속·throw 0).
  {
    const provider = scriptedProvider([
      { text: '', toolCalls: [{ id: 'b', name: 'list_directory', input: {}, parseError: 'bad' }], stopReason: 'tool_use' },
      { text: '복구', toolCalls: [{ id: 'f', name: 'finish', input: {} }], stopReason: 'tool_use' }
    ])
    const out = await runAgentLoop(provider, { prompt: 'p', scope, contentConsent: false, backend: recordBackend, guardPath: guardOk }, () => {})
    check('[loop] parseError 도구→is_error 회신·루프 계속', out.stopReason === 'finish')
  }

  // 상한 순수 판정·절단.
  check('[limit] exceededLimit turns', exceededLimit({ turns: MAX_TURNS, stagedOps: 0, toolCalls: 0, tokens: 0, elapsedMs: 0 }) === 'turns')
  check('[limit] exceededLimit 미초과 null', exceededLimit({ turns: 1, stagedOps: 0, toolCalls: 0, tokens: 0, elapsedMs: 0 }) === null)
  // 토큰·wall 제한 해제(무제한) — 거대 토큰/시간이어도 turns·tool-calls 만 차단.
  check(
    '[limit] tokens/wall 해제 — 거대값도 미차단(null)',
    exceededLimit({ turns: 1, stagedOps: 0, toolCalls: 0, tokens: 5_000_000, elapsedMs: 3_600_000 }) === null
  )
  check(
    '[limit] tokens/wall 해제 — turns 는 여전히 차단',
    exceededLimit({ turns: MAX_TURNS, stagedOps: 0, toolCalls: 0, tokens: 9_999_999, elapsedMs: 9_999_999 }) === 'turns'
  )
  const clamp = clampToolResult('x'.repeat(MAX_TOOL_RESULT_CHARS + 100))
  check('[limit] tool_result 절단', clamp.truncated && clamp.text.length <= MAX_TOOL_RESULT_CHARS + 20)

  // ════ 5) agentKeyStore ════════════════════════════════════════════════
  section('5) agentKeyStore (제공자별 슬롯·평문 0)')
  __setAvailable(true)
  {
    const { io, dump } = memIo()
    const store = createAgentKeyStore(safeStorageStub, '/base', io)
    check('[key] 가용', store.isAvailable())
    const s1 = await store.set('anthropic', 'sk-ant-SECRET')
    const s2 = await store.set('openai', 'sk-oai-SECRET')
    check('[key] set ok(2 제공자)', s1.ok && s2.ok)
    const g1 = await store.get('anthropic')
    check('[key] 라운드트립 복호 일치', g1.ok && g1.value === 'sk-ant-SECRET')
    const raw = JSON.stringify(dump() ?? {})
    check('[key] 디스크에 평문 미저장', !raw.includes('sk-ant-SECRET') && !raw.includes('sk-oai-SECRET'))
    check('[key] 슬롯 분리(anthropic≠openai 암호문)', (dump() ?? {})['anthropic'] !== (dump() ?? {})['openai'])
    const h1 = await store.has('anthropic')
    const h3 = await store.has('internal')
    check('[key] has 정확(있음/없음)', h1.ok && h1.value.has && h3.ok && !h3.value.has)
    const d = await store.delete('anthropic')
    const hAfter = await store.has('anthropic')
    check('[key] delete 후 has=false', d.ok && hAfter.ok && !hAfter.value.has)
    const gMiss = await store.get('internal')
    check('[key] 미저장 get→null', gMiss.ok && gMiss.value === null)
  }
  {
    __setAvailable(false)
    const { io } = memIo()
    const store = createAgentKeyStore(safeStorageStub, '/base', io)
    const s = await store.set('anthropic', 'x')
    check('[key] safeStorage 미가용→set 거부(EUNSUPPORTED·평문 폴백 0)', !s.ok && (!s.ok ? s.error.code === 'EUNSUPPORTED' : false))
    __setAvailable(true)
  }

  // ════ 6) createProvider 팩토리 ════════════════════════════════════════
  section('6) createProvider 팩토리')
  const stubFactory = {
    anthropic: () => ({ messages: { create: async () => ({ content: [], stop_reason: 'end_turn' }) as AnthropicResponse } }),
    openai: () => ({ chat: { completions: { create: async () => ({ choices: [{ message: {}, finish_reason: 'stop' }] }) as OpenAIResponse } } }),
    internal: () => ({ chat: { completions: { create: async () => ({ choices: [{ message: {}, finish_reason: 'stop' }] }) as OpenAIResponse } } })
  }
  {
    const cfg: ProviderConfig = { id: 'anthropic' }
    const r = await createProvider({ config: cfg, getKey: async () => 'sk', clientFactory: stubFactory })
    check('[factory] anthropic 생성·id 정합', r.ok && r.value.id === 'anthropic' && r.value.capabilities.toolUse)
  }
  {
    const r = await createProvider({ config: { id: 'openai' }, getKey: async () => null, clientFactory: stubFactory })
    check('[factory] 키 미보유→EAUTH', !r.ok && (!r.ok ? r.error.code === 'EAUTH' : false))
  }
  {
    const r = await createProvider({ config: { id: 'internal', baseUrl: 'https://llm.internal.corp/v1', modelId: 'm1', supportsToolUse: true }, getKey: async () => 'sk', clientFactory: stubFactory, allowList: ['llm.internal.corp:443'], lookup: okLookup })
    check('[factory] internal 생성·capability 플래그', r.ok && r.value.id === 'internal' && r.value.capabilities.toolUse)
  }
  {
    // 결함 수정 C: 로컬 internal 서버는 키 불필요 — 키 없음(null)이어도 EAUTH 가 아니라 성공(플레이스홀더).
    let usedKey = ''
    const keyCaptureFactory = {
      ...stubFactory,
      internal: (apiKey: string) => { usedKey = apiKey; return stubFactory.internal() }
    }
    const r = await createProvider({ config: { id: 'internal', baseUrl: 'http://127.0.0.1:1234/v1', modelId: 'qwen', supportsToolUse: true }, getKey: async () => null, clientFactory: keyCaptureFactory, allowList: ['127.0.0.1:1234'], lookup: okLookup })
    check('[factory] internal 키 없음→성공(플레이스홀더·EAUTH 아님)', r.ok && r.value.id === 'internal')
    check('[factory] internal 키 없음→플레이스홀더 키 주입', usedKey === 'lm-studio')
  }
  {
    // 결함 수정 C: 빈 문자열 키도 플레이스홀더로 대체.
    let usedKey = ''
    const keyCaptureFactory = {
      ...stubFactory,
      internal: (apiKey: string) => { usedKey = apiKey; return stubFactory.internal() }
    }
    const r = await createProvider({ config: { id: 'internal', baseUrl: 'http://127.0.0.1:1234/v1', modelId: 'qwen' }, getKey: async () => '', clientFactory: keyCaptureFactory, allowList: ['127.0.0.1:1234'], lookup: okLookup })
    check('[factory] internal 빈 키→플레이스홀더 대체', r.ok && usedKey === 'lm-studio')
  }
  {
    // 결함 수정 C: 키가 있으면 internal 도 그 키를 사용(플레이스홀더 미사용).
    let usedKey = ''
    const keyCaptureFactory = {
      ...stubFactory,
      internal: (apiKey: string) => { usedKey = apiKey; return stubFactory.internal() }
    }
    const r = await createProvider({ config: { id: 'internal', baseUrl: 'http://127.0.0.1:1234/v1', modelId: 'qwen' }, getKey: async () => 'real-key', clientFactory: keyCaptureFactory, allowList: ['127.0.0.1:1234'], lookup: okLookup })
    check('[factory] internal 실 키 보유→그 키 사용(플레이스홀더 아님)', r.ok && usedKey === 'real-key')
  }
  {
    // 결함 수정 C 회귀: anthropic/openai 는 키 없으면 여전히 EAUTH(로컬 예외는 internal 한정).
    const ra = await createProvider({ config: { id: 'anthropic' }, getKey: async () => null, clientFactory: stubFactory })
    const ro = await createProvider({ config: { id: 'openai' }, getKey: async () => null, clientFactory: stubFactory })
    check('[factory] anthropic 키 없음→여전히 EAUTH(internal 예외 격리)', !ra.ok && (!ra.ok ? ra.error.code === 'EAUTH' : false))
    check('[factory] openai 키 없음→여전히 EAUTH(internal 예외 격리)', !ro.ok && (!ro.ok ? ro.error.code === 'EAUTH' : false))
  }
  {
    const r = await createProvider({ config: { id: 'internal', supportsToolUse: true } as ProviderConfig, getKey: async () => 'sk', clientFactory: stubFactory })
    check('[factory] internal baseUrl/modelId 누락→EINVAL', !r.ok)
  }
  {
    const r = await createProvider({ config: { id: 'internal', baseUrl: 'https://llm.internal.corp/v1', modelId: 'm1' }, getKey: async () => 'sk', clientFactory: stubFactory, allowList: ['llm.internal.corp:443'] })
    check('[factory] internal supportsToolUse 미지정→capability false(degradation)', r.ok && !r.value.capabilities.toolUse)
  }
  // internal provider SSRF 게이트: 요청 직전 차단(정책 B — 메타데이터 리바인딩은 계속 차단).
  {
    const r = await createProvider({ config: { id: 'internal', baseUrl: 'https://llm.internal.corp/v1', modelId: 'm1', supportsToolUse: true }, getKey: async () => 'sk', clientFactory: stubFactory, allowList: ['llm.internal.corp:443'], lookup: metaLookup })
    let threw = false
    if (r.ok) {
      try {
        await r.value.createCompletion({ messages: [], tools: [], tier: 'plan', maxTokens: 10 }, () => {})
      } catch {
        threw = true
      }
    }
    check('[factory] internal 요청 직전 SSRF(메타데이터 리바인딩) 차단→throw(B 유지)', threw)
  }
  // internal provider 정책 B: 로컬 LLM(127.0.0.1) 화이트리스트 등록 시 요청 통과(throw 0).
  {
    const r = await createProvider({ config: { id: 'internal', baseUrl: 'http://127.0.0.1:1234/v1', modelId: 'm1', supportsToolUse: true }, getKey: async () => 'sk', clientFactory: stubFactory, allowList: ['127.0.0.1:1234'], lookup: okLookup })
    let threw = false
    if (r.ok) {
      try {
        await r.value.createCompletion({ messages: [], tools: [], tier: 'plan', maxTokens: 10 }, () => {})
      } catch {
        threw = true
      }
    }
    check('[factory] internal 로컬 LLM(127.0.0.1:1234) 요청 통과(B·throw 0)', r.ok && !threw)
  }

  // ════ 7) modelRouter / models ═════════════════════════════════════════
  section('7) modelRouter / models')
  check('[router] 첫 턴→plan', route({ turn: 0 }) === 'plan')
  check('[router] 후속 턴→light', route({ turn: 3 }) === 'light')
  check('[router] always-light 비용모드', route({ turn: 0, costMode: 'always-light' }) === 'light')
  check('[router] summarize 의도→light', route({ turn: 0, intent: 'summarize' }) === 'light')
  check('[models] anthropic plan→opus', resolveModelId({ id: 'anthropic' }, 'plan') === 'claude-opus-4-8')
  check('[models] openai light 기본', resolveModelId({ id: 'openai' }, 'light') === 'gpt-4.1-mini')
  check('[models] 설정 override 우선', resolveModelId({ id: 'anthropic', planModel: 'custom-plan' }, 'plan') === 'custom-plan')
  check('[models] internal 단일 모델(티어 무관)', resolveModelId({ id: 'internal', modelId: 'm9' }, 'plan') === 'm9' && resolveModelId({ id: 'internal', modelId: 'm9' }, 'light') === 'm9')

  // ════ 8) ReadToolBackend 실서비스 어댑터(Z1·스텁 deps) ═════════════════════
  section('8) ReadToolBackend 어댑터 (스텁 서비스 주입·직렬화/절단/동의)')

  // 스텁 deps — 직렬화·절단·동의 분기 검증용. 실 fs 없이 결과만 반환.
  const bigEntries = Array.from({ length: 500 }, (_v, i) => ({
    name: `f${i}.txt`, isDir: false, size: i, mtime: 0, ext: 'txt'
  }))
  const stubDeps: ReadBackendDeps = {
    list: async (p) => p === '__err__'
      ? { ok: false, error: { message: '권한 없음' } }
      : { ok: true, value: { entries: bigEntries, truncated: false } },
    readPreview: async (p) => ({
      kind: p.endsWith('.txt') ? 'text' : 'meta',
      name: 'x.txt', size: 10, mtime: 0, ext: 'txt',
      text: 'SECRET-CONTENT'.repeat(2000)
    }),
    scan: async () => ({
      totalBytes: 1024 * 1024, totalItems: 42,
      topFolders: [{ name: 'sub', path: 'E:\\w\\sub', bytes: 500 }],
      topFiles: [{ name: 'big', path: 'E:\\w\\big', bytes: 900 }],
      skipped: 1, canceled: false, truncated: false
    }),
    search: async (_r, q) => q === '(' // 컴파일 실패 신호(스텁)
      ? { files: [], totalMatches: 0, matchedFiles: 0, truncated: false, canceled: false, invalidRegex: true }
      : { files: [{ file: 'E:\\w\\a.txt', lines: Array.from({ length: 50 }, (_v, i) => ({ lineNo: i, text: `hit${i}` })) }], totalMatches: 50, matchedFiles: 1, truncated: false, canceled: false },
    dup: async () => ({ groups: [{ hash: 'h', size: 100, files: [{ path: 'a' }, { path: 'b' }] }], truncated: false }),
    compare: async () => ({
      pairs: [
        { name: 'only-left', status: 'left-only' },
        { name: 'identical', status: 'same' },
        { name: 'changed', status: 'diff' }
      ],
      summary: { leftOnly: 1, rightOnly: 0, diff: 1, same: 1, total: 3 },
      truncated: false
    }),
    // §Z open_tab 존재 검증 스텁(기본: 존재하는 디렉토리·골든/일반 케이스용).
    statPath: async () => ({ exists: true, isDir: true })
  }
  const rb = createReadBackend(stubDeps)

  const rbList = await rb.list('E:\\w', false)
  const listJson = JSON.parse(rbList.content) as { count: number; shown: number; truncated: boolean; entries: unknown[] }
  check('[rb] list 직렬화·count 보존', rbList.isError !== true && listJson.count === 500)
  check('[rb] list 항목수 상한 절단(shown<count·truncated)', listJson.shown === 200 && listJson.truncated === true && listJson.entries.length === 200)

  const rbListErr = await rb.list('__err__', false)
  check('[rb] list 서비스 실패→is_error', rbListErr.isError === true)

  const rbPreviewOff = await rb.preview('E:\\w\\x.txt', false)
  check('[rb] preview 동의 false→본문 미수록(SECRET 0)', !rbPreviewOff.content.includes('SECRET') && rbPreviewOff.content.includes('"contentIncluded":false'))
  const rbPreviewOn = await rb.preview('E:\\w\\x.txt', true)
  const pvJson = JSON.parse(rbPreviewOn.content) as { contentIncluded: boolean; truncated: boolean; text: string }
  check('[rb] preview 동의 true→텍스트 포함·상한 절단', pvJson.contentIncluded === true && pvJson.truncated === true && pvJson.text.length <= 8000)

  const rbScan = await rb.scan('E:\\w')
  const scanJson = JSON.parse(rbScan.content) as { totalItems: number; topFolders: unknown[]; totalSizeHuman: string }
  check('[rb] scan 직렬화·human 단위', scanJson.totalItems === 42 && scanJson.totalSizeHuman.includes('MB') && scanJson.topFolders.length === 1)

  const rbSearch = await rb.search('E:\\w', 'hit', { regex: false, recursive: true })
  const srJson = JSON.parse(rbSearch.content) as { totalMatches: number; files: Array<{ matches: unknown[] }> }
  check('[rb] search 직렬화·줄 상한 절단', srJson.totalMatches === 50 && srJson.files[0]!.matches.length === 20)
  const rbSearchBad = await rb.search('E:\\w', '(', { regex: true, recursive: true })
  check('[rb] search 정규식 실패→is_error', rbSearchBad.isError === true)

  const rbDup = await rb.dup(['E:\\w'])
  check('[rb] dup 직렬화·copies', JSON.parse(rbDup.content).groups[0].copies === 2)

  const rbCmp = await rb.compare('E:\\l', 'E:\\r')
  const cmpJson = JSON.parse(rbCmp.content) as { diffPairs: Array<{ status: string }>; summary: { total: number } }
  check('[rb] compare 직렬화·same 제외(diff/only만)', cmpJson.summary.total === 3 && cmpJson.diffPairs.length === 2 && cmpJson.diffPairs.every((p) => p.status !== 'same'))

  // 취소 신호 전파(signal.aborted→shouldCancel) — 스텁이 shouldCancel 인자를 수신하는지.
  {
    const ctrl = new AbortController()
    ctrl.abort()
    let sawCancel = false
    const cancelDeps: ReadBackendDeps = {
      ...stubDeps,
      scan: async (_root, shouldCancel) => {
        sawCancel = shouldCancel()
        return { totalBytes: 0, totalItems: 0, topFolders: [], topFiles: [], skipped: 0, canceled: true, truncated: false }
      }
    }
    const rbC = createReadBackend(cancelDeps, ctrl.signal)
    await rbC.scan('E:\\w')
    check('[rb] AbortSignal→shouldCancel 전파', sawCancel === true)
  }

  // ════ 9) run 통합(스텁 provider + 실 createReadBackend·스텁 deps) ══════════
  section('9) runAgentLoop + createReadBackend 통합(emit 시퀀스)')
  {
    const backend = createReadBackend(stubDeps)
    const provider = scriptedProvider([
      { text: '탐색', toolCalls: [{ id: 't1', name: 'scan_folder', input: { root: 'E:\\work\\a' } }], stopReason: 'tool_use' },
      { text: '끝', toolCalls: [{ id: 't2', name: 'finish', input: { summary: '스캔 완료' } }], stopReason: 'tool_use' }
    ])
    const events: OrchestratorEvent[] = []
    const out = await runAgentLoop(provider, { prompt: '용량 분석', scope, contentConsent: false, backend, guardPath: guardOk }, (e) => events.push(e))
    check('[run] 실 백엔드 어댑터로 tool 실행→finish', out.stopReason === 'finish' && out.summary === '스캔 완료')
    check('[run] scan tool-call 이벤트 emit', events.some((e) => e.type === 'tool-call' && e.tool === 'scan_folder'))
    // tool_result 가 어댑터 직렬화 JSON 인지(provider 가 본 두번째 요청 메시지에 tool 결과 포함).
    const seenReqs = (provider as unknown as { seen: NormalizedCompletionReq[] }).seen
    const toolMsg = seenReqs[1]?.messages.find((m) => m.role === 'tool')
    check('[run] tool_result=어댑터 직렬화(totalItems 포함)', !!toolMsg && JSON.stringify(toolMsg).includes('totalItems'))
  }

  // ════ 10) §Z list_locations + 스코프 확장 ════════════════════════════════
  section('10) list_locations (이름 있는 위치 → 경로 패스스루) + 스코프 확장')

  // 도구 선언.
  check('[loc] list_locations 도구 선언', listToolDefs().some((d) => d.name === 'list_locations'))
  check('[loc] list_locations mode=read', lookupTool('list_locations')?.mode === 'read')
  check('[loc] list_locations 경로 인자 0(패스스루)', lookupTool('list_locations')!.pathArgs({}).length === 0)

  const locations: AgentLocations = {
    favorites: [
      { name: '프로젝트A', path: 'E:\\work\\projectA' },
      { name: '원격백업', path: 'sftp://host/backup' } // 가상 — 표시 가능·스코프 제외
    ],
    quickAccess: [{ name: '다운로드', path: 'C:\\Users\\me\\Downloads' }],
    recent: [{ name: 'recentDir', path: 'E:\\recent\\x' }],
    drives: [{ name: '로컬 디스크 (E:)', path: 'E:\\' }],
    panels: [
      { index: 1, path: 'E:\\work', active: true },
      { index: 2, path: 'D:\\data', active: false }
    ]
  }

  // list_locations 실행 — context.locations 정확 반환.
  const locScope = buildScope('E:\\nowhere', [], scopeRootsFromLocations(['E:\\work\\projectA']))
  const locCtx = { backend: recordBackend, scope: locScope, guardPath: guardOk, contentConsent: false, locations }
  const locAll = await executeTool('list_locations', {}, locCtx)
  check('[loc] 실행 성공(throw 0)', locAll.isError !== true)
  const locJson = JSON.parse(locAll.content) as {
    favorites: Array<{ name: string; path: string; virtual?: boolean }>
    quickAccess: Array<{ name: string; path: string }>
    drives: Array<{ name: string; path: string }>
    panels: Array<{ index: number; path: string; active: boolean }>
  }
  check('[loc] favorites 이름·경로 반환', locJson.favorites[0]!.name === '프로젝트A' && locJson.favorites[0]!.path === 'E:\\work\\projectA')
  check('[loc] 가상(sftp) 항목 virtual=true 표기', locJson.favorites[1]!.virtual === true)
  check('[loc] quickAccess 다운로드 반환', locJson.quickAccess[0]!.name === '다운로드')
  check('[loc] drives 반환', locJson.drives[0]!.path === 'E:\\')
  check('[loc] panels index/active 반환', locJson.panels[0]!.index === 1 && locJson.panels[0]!.active === true)

  // category 필터.
  const locFav = JSON.parse((await executeTool('list_locations', { category: 'favorites' }, locCtx)).content) as Record<string, unknown>
  check('[loc] category 필터(favorites만)', Array.isArray(locFav['favorites']) && locFav['quickAccess'] === undefined)

  // locations 미제공 시 빈 결과(회귀: 기존 호출자는 locations 없이도 동작).
  const locEmpty = await executeTool('list_locations', {}, { backend: recordBackend, scope: locScope, guardPath: guardOk, contentConsent: false })
  const emptyJson = JSON.parse(locEmpty.content) as { favorites: unknown[] }
  check('[loc] locations 미제공→빈 favorites(회귀)', Array.isArray(emptyJson.favorites) && emptyJson.favorites.length === 0)

  // ── 스코프 확장(핵심) ───────────────────────────────────────────────────
  // scopeRootsFromLocations: 로컬 비시스템만 추림(가상/시스템 제외).
  const roots = scopeRootsFromLocations(['E:\\work\\projectA', 'sftp://h/x', 'C:\\Windows\\System32', 'E:\\work\\projectA'])
  check('[loc] scopeRoots 로컬만(가상/시스템/중복 제외)', roots.length === 1 && roots[0] === 'E:\\work\\projectA')

  // 이전엔 스코프 밖이던 favorite 경로가 이제 list_directory 통과.
  const scopeWithFav = buildScope('E:\\elsewhere', [], scopeRootsFromLocations(['E:\\work\\projectA']))
  const ctxFav = { backend: recordBackend, scope: scopeWithFav, guardPath: guardOk, contentConsent: false }
  const exFavBefore = assertInScope('E:\\work\\projectA\\file.txt', buildScope('E:\\elsewhere', []))
  check('[loc] (대조) locations 없으면 favorite 경로 스코프 밖', !exFavBefore.ok)
  const exFav = await executeTool('list_directory', { path: 'E:\\work\\projectA\\file.txt' }, ctxFav)
  check('[loc] favorite 경로가 스코프 루트로 추가→list_directory 통과', exFav.isError !== true)

  // 시스템 폴더 위치는 루트로 줘도 거부(isSystemPath 우선).
  const scopeSys = buildScope('E:\\x', [], scopeRootsFromLocations(['C:\\Windows']))
  const sysAssert = assertInScope('C:\\Windows\\System32', scopeSys)
  check('[loc] 시스템 폴더 위치는 루트로 줘도 거부', !sysAssert.ok)

  // 가상(remote/archive) 위치는 list_directory(로컬) 거부.
  const scopeVirt = buildScope('E:\\x', [], scopeRootsFromLocations(['sftp://host/backup']))
  check('[loc] 가상 위치는 스코프 루트로 미포함(빈 루트)', scopeVirt.roots.length === 1 && scopeVirt.roots[0] === 'E:\\x')
  const virtAssert = assertInScope('sftp://host/backup/a', scopeVirt)
  check('[loc] 가상 경로 list_directory(assertInScope) 거부', !virtAssert.ok)

  // buildScope 3번째 인자 미지정 시 기존 동작 동일(회귀).
  const legacyScope = buildScope('E:\\work', ['E:\\work\\sel'])
  check('[loc] buildScope 회귀(locations 미지정=cwd+selection)', legacyScope.roots.length === 1 && legacyScope.roots[0] === 'E:\\work')

  // ════ 10b) §Z open_tab (비파괴 내비게이션 액션·dispatchAction) ═══════════════
  section('10b) open_tab (navigate 도구·dispatchAction 디스패치·스코프 재검증)')

  // 도구 선언·분류.
  check('[tab] open_tab 도구 선언', listToolDefs().some((d) => d.name === 'open_tab'))
  check('[tab] open_tab mode=navigate(read/write 아님)', lookupTool('open_tab')?.mode === 'navigate')
  const tabSchema = lookupTool('open_tab')!.def.inputSchema as { properties?: Record<string, unknown>; required?: string[] }
  check('[tab] open_tab 스키마 path 필수', !!tabSchema.properties?.['path'] && Array.isArray(tabSchema.required) && tabSchema.required.includes('path'))
  check('[tab] open_tab 경로 인자 추출', lookupTool('open_tab')!.pathArgs({ path: 'E:\\work\\x' })[0] === 'E:\\work\\x')

  // 쓰기 도구가 아님(여전히 미선언) — open_tab 추가가 write 도구를 열지 않음.
  for (const w of ['move', 'copy', 'rename', 'mkdir', 'trash', 'delete']) {
    check(`[tab] open_tab 추가 후에도 쓰기 도구 미선언: ${w}`, lookupTool(w) === undefined)
  }

  // 스코프 안 경로 통과 → dispatchAction 스파이가 {action:'open-tab', path} 로 호출.
  {
    const tabScope = buildScope('E:\\work', ['E:\\work\\sel'])
    const dispatched: DispatchAction[] = []
    const tabCtx = {
      backend: recordBackend,
      scope: tabScope,
      guardPath: guardOk,
      contentConsent: false,
      dispatchAction: (a: DispatchAction) => dispatched.push(a)
    }
    const exTab = await executeTool('open_tab', { path: 'E:\\work\\sub' }, tabCtx)
    check('[tab] 스코프 안→성공(throw 0·is_error 아님)', exTab.isError !== true)
    check('[tab] dispatchAction 호출(action=open-tab·정규화 경로)', dispatched.length === 1 && dispatched[0]!.action === 'open-tab' && dispatched[0]!.path === 'E:\\work\\sub')
    check('[tab] 성공 텍스트(새 탭·경로 포함)', exTab.content.includes('새 탭') && exTab.content.includes('E:\\work\\sub'))
  }

  // 스코프 밖 → 거부·디스패치 0.
  {
    const tabScope = buildScope('E:\\work', [])
    const dispatched: DispatchAction[] = []
    const exOut = await executeTool('open_tab', { path: 'C:\\other' }, { backend: recordBackend, scope: tabScope, guardPath: guardOk, contentConsent: false, dispatchAction: (a: DispatchAction) => dispatched.push(a) })
    check('[tab] 스코프 밖 경로 거부(is_error)·디스패치 0', exOut.isError === true && dispatched.length === 0)
  }

  // 시스템 경로 거부.
  {
    const sysScope = buildScope('C:\\', [])
    const dispatched: DispatchAction[] = []
    const guardSys = (p: string) => (typeof p === 'string' && /^[A-Za-z]:\\/.test(p) ? { ok: true as const, value: p } : { ok: false as const, error: { code: 'EINVAL' as const, message: '거부' } })
    const exSys = await executeTool('open_tab', { path: 'C:\\Windows\\System32' }, { backend: recordBackend, scope: sysScope, guardPath: guardSys, contentConsent: false, dispatchAction: (a: DispatchAction) => dispatched.push(a) })
    check('[tab] 시스템 경로 거부·디스패치 0', exSys.isError === true && dispatched.length === 0)
  }

  // 가상(remote/archive) 경로 거부.
  {
    const tabScope = buildScope('E:\\work', [])
    const dispatched: DispatchAction[] = []
    const guardVirt = (p: string) => ({ ok: true as const, value: p })
    const exVirt = await executeTool('open_tab', { path: 'sftp://host/x' }, { backend: recordBackend, scope: tabScope, guardPath: guardVirt, contentConsent: false, dispatchAction: (a: DispatchAction) => dispatched.push(a) })
    check('[tab] 가상(sftp) 경로 거부·디스패치 0', exVirt.isError === true && dispatched.length === 0)
  }

  // dispatchAction 미주입 → is_error(디스패치 불가).
  {
    const tabScope = buildScope('E:\\work', [])
    const exNoDispatch = await executeTool('open_tab', { path: 'E:\\work\\sub' }, { backend: recordBackend, scope: tabScope, guardPath: guardOk, contentConsent: false })
    check('[tab] dispatchAction 미주입→is_error(디스패치 불가)', exNoDispatch.isError === true)
  }

  // 오케스트레이터 즉시 실행(plan 미생성·read 처럼) + tool_result 성공 회신.
  {
    const tabScope = buildScope('E:\\work', [])
    const dispatched: DispatchAction[] = []
    const provider = scriptedProvider([
      { text: '이동', toolCalls: [{ id: 't1', name: 'open_tab', input: { path: 'E:\\work\\target' } }], stopReason: 'tool_use' },
      { text: '끝', toolCalls: [{ id: 't2', name: 'finish', input: { summary: '탭 열기 완료' } }], stopReason: 'tool_use' }
    ])
    const events: OrchestratorEvent[] = []
    const out = await runAgentLoop(provider, { prompt: '거기로 이동', scope: tabScope, contentConsent: false, backend: recordBackend, guardPath: guardOk, dispatchAction: (a: DispatchAction) => dispatched.push(a) }, (e) => events.push(e))
    check('[tab-loop] navigate 도구 즉시 실행→finish(plan 미생성)', out.stopReason === 'finish')
    check('[tab-loop] dispatchAction 디스패치(루프 경유)', dispatched.length === 1 && dispatched[0]!.path === 'E:\\work\\target')
    check('[tab-loop] tool-call 이벤트 mode=navigate', events.some((e) => e.type === 'tool-call' && e.tool === 'open_tab' && e.mode === 'navigate'))
    check('[tab-loop] plan-* 이벤트 미생성(쓰기 아님)', !events.some((e) => e.type === 'plan-add'))
    check('[tab-loop] toolCalls 상한 카운트에 포함', out.toolCalls >= 2)
    // tool_result 가 성공 텍스트(provider 가 본 두번째 요청 tool 메시지).
    const seenReqs = (provider as unknown as { seen: NormalizedCompletionReq[] }).seen
    const toolMsg = seenReqs[1]?.messages.find((m) => m.role === 'tool')
    check('[tab-loop] tool_result 성공 텍스트 회신', !!toolMsg && JSON.stringify(toolMsg).includes('새 탭'))
  }

  // AgentEvent action 변형 직렬화(IPC 푸시 DTO shape).
  {
    const actionEvt: AgentEvent = { type: 'action', runId: 'r1', action: 'open-tab', path: 'E:\\work\\z' }
    const round = JSON.parse(JSON.stringify(actionEvt)) as AgentEvent
    check('[tab-evt] AgentEvent action 변형 직렬화 라운드트립', round.type === 'action' && round.action === 'open-tab' && round.path === 'E:\\work\\z' && round.runId === 'r1')
  }

  // ════ 11) 스트리밍 조립 — OpenAI tool_calls 델타(UQ-G3) ════════════════════
  section('11) OpenAI 스트림 조립(텍스트 델타·tool_calls index 누적·깨짐 parseError)')
  {
    const deltas: string[] = []
    const asm = createOpenAIStreamAssembler((t) => deltas.push(t))
    // 텍스트 델타 2조각.
    asm.push({ choices: [{ delta: { content: '안녕' } }] })
    asm.push({ choices: [{ delta: { content: '하세요' } }] })
    // tool_call index 0: id·name 첫 조각, arguments 분할 누적.
    asm.push({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c0', function: { name: 'list_directory', arguments: '{"pa' } }] } }] })
    asm.push({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"E' } }] } }] })
    asm.push({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ':\\\\x"}' } }] } }] })
    // tool_call index 1: 깨진 arguments.
    asm.push({ choices: [{ delta: { tool_calls: [{ index: 1, id: 'c1', function: { name: 'scan_folder', arguments: '{ bad' } }] } }] })
    asm.push({ choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 4, completion_tokens: 9 } })
    const r = asm.result()
    check('[stream-oai] 텍스트 델타 onDelta 순서 보존', deltas.join('') === '안녕하세요')
    check('[stream-oai] 누적 text 일치', r.text === '안녕하세요')
    check('[stream-oai] finish_reason→tool_use', r.stopReason === 'tool_use')
    check('[stream-oai] tool_calls index 누적 조립(2건)', r.toolCalls.length === 2)
    check('[stream-oai] 분할 arguments 누적→파싱(path=E:\\x)', r.toolCalls[0]!.input['path'] === 'E:\\x')
    check('[stream-oai] 깨진 arguments→parseError(throw 0)', r.toolCalls[1]!.parseError !== undefined && Object.keys(r.toolCalls[1]!.input).length === 0)
    check('[stream-oai] usage 매핑', r.usage?.inputTokens === 4 && r.usage?.outputTokens === 9)
  }
  {
    // finish_reason 미수신(스트림 끊김) → tool_calls 유무로 추론.
    const asm = createOpenAIStreamAssembler(() => {})
    asm.push({ choices: [{ delta: { content: '답변만' } }] })
    check('[stream-oai] finish 없음·tool 없음→end_turn', asm.result().stopReason === 'end_turn')
    const asm2 = createOpenAIStreamAssembler(() => {})
    asm2.push({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'x', function: { name: 'f', arguments: '{}' } }] } }] })
    check('[stream-oai] finish 없음·tool 있음→tool_use', asm2.result().stopReason === 'tool_use')
  }

  // ════ 12) 스트리밍 조립 — Anthropic messages.stream ════════════════════════
  section('12) Anthropic 스트림 조립(text_delta·input_json_delta·tool_use)')
  {
    const deltas: string[] = []
    const asm = createAnthropicStreamAssembler((t) => deltas.push(t))
    const evs: AnthropicStreamEvent[] = [
      { type: 'message_start', message: { usage: { input_tokens: 11, output_tokens: 0 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '탐색' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '합니다' } },
      { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tu1', name: 'list_directory' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"path"' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: ':"E:\\\\a"}' } },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 7 } }
    ]
    for (const e of evs) asm.push(e)
    const r = asm.result()
    check('[stream-ant] text_delta onDelta 순서', deltas.join('') === '탐색합니다')
    check('[stream-ant] 누적 text', r.text === '탐색합니다')
    check('[stream-ant] stop_reason→tool_use', r.stopReason === 'tool_use')
    check('[stream-ant] tool_use 블록 조립', r.toolCalls.length === 1 && r.toolCalls[0]!.name === 'list_directory')
    check('[stream-ant] input_json_delta 누적→파싱(path=E:\\a)', r.toolCalls[0]!.input['path'] === 'E:\\a')
    check('[stream-ant] usage(message_start in + message_delta out)', r.usage?.inputTokens === 11 && r.usage?.outputTokens === 7)
  }
  {
    // 깨진 input_json → 빈 객체 흡수(throw 0).
    const asm = createAnthropicStreamAssembler(() => {})
    asm.push({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 't', name: 'f' } })
    asm.push({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{bad' } })
    asm.push({ type: 'message_delta', delta: { stop_reason: 'tool_use' } })
    const r = asm.result()
    check('[stream-ant] 깨진 input_json→input={}(throw 0)', r.toolCalls.length === 1 && Object.keys(r.toolCalls[0]!.input).length === 0)
  }

  // ════ 13) provider 스트리밍 경로 — onDelta thinking + 비스트리밍 폴백 ════════
  section('13) provider createCompletion 스트리밍/폴백(스텁 클라이언트)')

  function asyncIter<T>(items: readonly T[]): AsyncIterable<T> {
    return {
      async *[Symbol.asyncIterator]() {
        for (const it of items) yield it
      }
    }
  }

  // OpenAI provider 스트리밍.
  {
    const deltas: string[] = []
    const client: OpenAIClientLike = {
      chat: {
        completions: {
          create: async () => ({ choices: [{ message: {}, finish_reason: 'stop' }] }),
          createStream: () =>
            asyncIter<OpenAIStreamChunk>([
              { choices: [{ delta: { content: '스트' } }] },
              { choices: [{ delta: { content: '리밍' } }] },
              { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c', function: { name: 'list_directory', arguments: '{"path":"E:\\\\z"}' } }] } }] },
              { choices: [{ delta: {}, finish_reason: 'tool_calls' }] }
            ])
        }
      }
    }
    const prov = createOpenAIProvider({ id: 'openai' }, client)
    const r = await prov.createCompletion({ messages: [{ role: 'user', content: 'q' }], tools: [], tier: 'light', maxTokens: 10 }, (d: ThinkingDelta) => deltas.push(d.text))
    check('[prov-oai] 스트리밍 onDelta 흐름', deltas.join('') === '스트리밍')
    check('[prov-oai] 스트림 tool_call 조립', r.toolCalls.length === 1 && r.toolCalls[0]!.input['path'] === 'E:\\z')
    check('[prov-oai] stopReason tool_use', r.stopReason === 'tool_use')
  }
  // OpenAI provider 비스트리밍 폴백(createStream throw → create).
  {
    const deltas: string[] = []
    let createCalled = false
    const client: OpenAIClientLike = {
      chat: {
        completions: {
          create: async () => { createCalled = true; return { choices: [{ message: { content: '폴백답' }, finish_reason: 'stop' }] } },
          createStream: () => { throw new Error('스트림 미지원') }
        }
      }
    }
    const prov = createOpenAIProvider({ id: 'openai' }, client)
    const r = await prov.createCompletion({ messages: [], tools: [], tier: 'plan', maxTokens: 10 }, (d: ThinkingDelta) => deltas.push(d.text))
    check('[prov-oai] 스트림 실패→비스트리밍 폴백', createCalled && r.text === '폴백답' && deltas.length === 0)
  }
  // OpenAI provider: createStream 미제공 → create 경로.
  {
    const client: OpenAIClientLike = {
      chat: { completions: { create: async () => ({ choices: [{ message: { content: 'nostream' }, finish_reason: 'stop' }] }) } }
    }
    const prov = createOpenAIProvider({ id: 'openai' }, client)
    const r = await prov.createCompletion({ messages: [], tools: [], tier: 'plan', maxTokens: 10 }, () => {})
    check('[prov-oai] createStream 미제공→create 경로', r.text === 'nostream')
  }
  // Anthropic provider 스트리밍.
  {
    const deltas: string[] = []
    const client: AnthropicClientLike = {
      messages: {
        create: async () => ({ content: [], stop_reason: 'end_turn' }),
        stream: () =>
          asyncIter<AnthropicStreamEvent>([
            { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
            { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'A' } },
            { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'B' } },
            { type: 'message_delta', delta: { stop_reason: 'end_turn' } }
          ])
      }
    }
    const prov = createAnthropicProvider({ id: 'anthropic' }, client)
    const r = await prov.createCompletion({ messages: [{ role: 'user', content: 'q' }], tools: [], tier: 'light', maxTokens: 10 }, (d: ThinkingDelta) => deltas.push(d.text))
    check('[prov-ant] 스트리밍 onDelta 흐름', deltas.join('') === 'AB' && r.text === 'AB' && r.stopReason === 'end_turn')
  }
  // Anthropic provider 비스트리밍 폴백(stream throw → create).
  {
    let createCalled = false
    const client: AnthropicClientLike = {
      messages: {
        create: async () => { createCalled = true; return { content: [{ type: 'text', text: 'ant폴백' }], stop_reason: 'end_turn' } },
        stream: () => { throw new Error('스트림 실패') }
      }
    }
    const prov = createAnthropicProvider({ id: 'anthropic' }, client)
    const r = await prov.createCompletion({ messages: [], tools: [], tier: 'plan', maxTokens: 10 }, () => {})
    check('[prov-ant] 스트림 실패→비스트리밍 폴백', createCalled && r.text === 'ant폴백')
  }
  // Internal provider 스트리밍(SSRF 게이트 통과 후).
  {
    const deltas: string[] = []
    const client: OpenAIClientLike = {
      chat: {
        completions: {
          create: async () => ({ choices: [{ message: {}, finish_reason: 'stop' }] }),
          createStream: () =>
            asyncIter<OpenAIStreamChunk>([
              { choices: [{ delta: { content: '내부' } }] },
              { choices: [{ delta: {}, finish_reason: 'stop' }] }
            ])
        }
      }
    }
    const prov = createInternalProvider({ config: { id: 'internal', baseUrl: 'https://llm.internal.corp/v1', modelId: 'm1', supportsToolUse: true }, client, allowList: ['llm.internal.corp:443'], lookup: okLookup })
    const r = await prov.createCompletion({ messages: [], tools: [], tier: 'plan', maxTokens: 10 }, (d: ThinkingDelta) => deltas.push(d.text))
    check('[prov-int] SSRF 통과 후 스트리밍 onDelta', deltas.join('') === '내부' && r.stopReason === 'end_turn')
  }

  // ════ 14) providerProbe 실 런타임(G3) ══════════════════════════════════════
  section('14) providerProbe 실 런타임(더미 도구 completion·정적 폴백)')
  {
    // probe 성공: 모델이 더미 도구 호출 → toolUse:true·source:probe.
    const prov = scriptedProvider([{ text: '', toolCalls: [{ id: 'p', name: 'probe_capability', input: { ok: true } }], stopReason: 'tool_use' }])
    const r = await runProviderProbe({ provider: prov })
    check('[probe] 더미 도구 호출→toolUse:true·source:probe', r.toolUse === true && r.source === 'probe')
  }
  {
    // probe: 모델이 도구 미호출(end_turn) → toolUse:false·source:probe·reason.
    const prov = scriptedProvider([{ text: '응답', toolCalls: [], stopReason: 'end_turn' }])
    const r = await runProviderProbe({ provider: prov })
    check('[probe] 도구 미호출→toolUse:false·source:probe·reason', r.toolUse === false && r.source === 'probe' && !!r.reason)
  }
  {
    // probe 호출 실패(throw) → 정적 capability 폴백.
    const throwing: LLMProvider = {
      id: 'openai',
      capabilities: { toolUse: true, streaming: true },
      async createCompletion() { throw new Error('네트워크 오류') }
    }
    const r = await runProviderProbe({ provider: throwing })
    check('[probe] 호출 실패→정적 폴백(capability·source:static·reason)', r.source === 'static' && r.toolUse === true && r.reason!.includes('네트워크'))
  }
  {
    // provider=null(키 없음) → 정적 폴백·toolUse:false.
    const r = await runProviderProbe({ provider: null, providerError: 'API 키 없음' })
    check('[probe] provider 없음(키 없음)→static·false·reason', r.source === 'static' && r.toolUse === false && r.reason === 'API 키 없음')
  }
  {
    // 결함 수정 A: capability.toolUse=false(internal supportsToolUse 미지정)라도 단락하지 않고
    // **실측**한다. 스텁이 toolCalls 를 내면 toolUse:true·source:probe(실 LM Studio 회복).
    const noToolButCalls: LLMProvider = {
      id: 'internal',
      capabilities: { toolUse: false, streaming: true },
      async createCompletion() {
        return { text: '', toolCalls: [{ id: 'p', name: 'probe_capability', input: { ok: true } }], stopReason: 'tool_use' as const }
      }
    }
    const r = await runProviderProbe({ provider: noToolButCalls })
    check('[probe] capability false라도 실측(toolCalls 회신)→toolUse:true·source:probe(단락 안 함)', r.toolUse === true && r.source === 'probe')
  }
  {
    // capability.toolUse=false 인데 모델도 도구 미호출 → 실측 결과 toolUse:false·source:probe.
    const noToolNoCalls: LLMProvider = {
      id: 'internal',
      capabilities: { toolUse: false, streaming: true },
      async createCompletion() {
        return { text: '응답', toolCalls: [], stopReason: 'end_turn' as const }
      }
    }
    const r = await runProviderProbe({ provider: noToolNoCalls })
    check('[probe] capability false·도구 미호출→실측 toolUse:false·source:probe', r.toolUse === false && r.source === 'probe')
  }
  {
    // 결함 수정 A 회귀: capability false 인 provider 가 throw → 정적 폴백(capability 값=false).
    const noToolThrows: LLMProvider = {
      id: 'internal',
      capabilities: { toolUse: false, streaming: true },
      async createCompletion() { throw new Error('네트워크 오류') }
    }
    const r = await runProviderProbe({ provider: noToolThrows })
    check('[probe] capability false·요청 실패→정적 폴백(static·false·reason)', r.source === 'static' && r.toolUse === false && !!r.reason)
  }

  // ── 결함 수정 B: 실 probe(source:'probe') 결과를 활성 config 의 supportsToolUse 로 영속 ──────
  // (PROBE 핸들러 로직 미러: source==='probe' 일 때만 setActive({...active, supportsToolUse}).)
  // 영속 후 agent:run capability 게이트(provider.capabilities.toolUse)가 internal 에서 통과되도록.
  {
    const persist = (store: ReturnType<typeof createProviderConfigStore>, res: { toolUse: boolean; source: 'probe' | 'static' }): void => {
      if (res.source === 'probe') {
        const active = store.getActive()
        store.setActive({ ...active, supportsToolUse: res.toolUse })
      }
    }
    // internal 활성 + 실 probe(toolUse:true) → supportsToolUse=true 저장(이후 run 게이트 통과).
    const store = createProviderConfigStore()
    store.setActive({ id: 'internal', baseUrl: 'http://127.0.0.1:1234/v1', modelId: 'qwen' })
    check('[probe-persist] 초기 internal supportsToolUse 미설정', store.getActive().supportsToolUse === undefined)
    // capToolUse=false 로 만들어도(internal 미지정 모사) probe 가 실측해 toolCalls 회신 → true.
    const probeProv = scriptedProvider([{ text: '', toolCalls: [{ id: 'p', name: 'probe_capability', input: { ok: true } }], stopReason: 'tool_use' }], false)
    const rProbe = await runProviderProbe({ provider: probeProv })
    persist(store, rProbe)
    check('[probe-persist] 실 probe(true)→supportsToolUse=true 저장(run 게이트 통과)', store.getActive().supportsToolUse === true)

    // 정적 폴백(source:'static')은 저장하지 않음(실측 아님).
    const store2 = createProviderConfigStore()
    store2.setActive({ id: 'internal', baseUrl: 'http://127.0.0.1:1234/v1', modelId: 'qwen' })
    persist(store2, { toolUse: false, source: 'static' })
    check('[probe-persist] 정적 폴백(static)→supportsToolUse 미저장(undefined 유지)', store2.getActive().supportsToolUse === undefined)

    // 실 probe(toolUse:false)도 false 로 정직 저장(모델이 도구 미지원).
    const store3 = createProviderConfigStore()
    store3.setActive({ id: 'internal', baseUrl: 'http://127.0.0.1:1234/v1', modelId: 'qwen', supportsToolUse: true })
    persist(store3, { toolUse: false, source: 'probe' })
    check('[probe-persist] 실 probe(false)→supportsToolUse=false 정직 갱신', store3.getActive().supportsToolUse === false)
  }

  // ════ 15) 내부 화이트리스트 관리(add validateRegister·remove·list) ═══════════
  section('15) providerConfigStore 화이트리스트 add/remove/list')
  {
    const store = createProviderConfigStore()
    // 기본값이 내부(127.0.0.1:1234)라 그 호스트가 선등록된 상태로 시작.
    check(
      '[wl-store] 초기 기본 호스트 선등록(127.0.0.1:1234)',
      store.allowedInternalHosts().length === 1 && store.allowedInternalHosts().includes('127.0.0.1:1234')
    )
    const add1 = store.registerInternalHost('https://llm.internal.corp/v1')
    check('[wl-store] 공인 호스트 add 성공', add1.ok)
    check('[wl-store] list 반영(정규화 키)', store.allowedInternalHosts().includes('llm.internal.corp:443'))
    // 정책 B(validateRegister): 사설 IP add 허용·메타데이터/링크로컬/file 은 계속 거부.
    const addPriv = store.registerInternalHost('http://10.0.0.5/v1')
    check('[wl-store] 사설 IP add 허용(B·validateRegister)', addPriv.ok && store.allowedInternalHosts().includes('10.0.0.5:80'))
    const addLocal = store.registerInternalHost('http://127.0.0.1:1234/v1')
    check('[wl-store] 로컬 LLM 127.0.0.1:1234 add 허용(B)', addLocal.ok && store.allowedInternalHosts().includes('127.0.0.1:1234'))
    const addMeta = store.registerInternalHost('https://169.254.169.254/v1')
    check('[wl-store] 메타데이터 IP add 거부(유지)', !addMeta.ok)
    const addMapped = store.registerInternalHost('https://[::ffff:169.254.169.254]/v1')
    check('[wl-store] IPv4-매핑 IPv6 메타데이터 add 거부(유지)', !addMapped.ok)
    const addBadUrl = store.registerInternalHost('file:///x')
    check('[wl-store] file 스킴 add 거부', !addBadUrl.ok)
    // 허용 3건(공인+사설+로컬), 거부 케이스는 목록 미변경.
    check('[wl-store] 허용 3건·거부는 목록 미변경', store.allowedInternalHosts().length === 3)
    // remove: URL 입력(사설/로컬 정리 후 공인만).
    store.removeInternalHost('http://10.0.0.5/v1')
    store.removeInternalHost('http://127.0.0.1:1234/v1')
    const rmUrl = store.removeInternalHost('https://llm.internal.corp/v1')
    check('[wl-store] remove(URL) 성공·목록 비움', rmUrl.ok && store.allowedInternalHosts().length === 0)
    // remove: 정규화 키 입력.
    store.registerInternalHost('https://host2.internal:8443/v1')
    const rmKey = store.removeInternalHost('host2.internal:8443')
    check('[wl-store] remove(정규화 키) 성공', rmKey.ok && store.allowedInternalHosts().length === 0)
    // remove 없는 호스트→ENOENT.
    const rmMiss = store.removeInternalHost('nope.internal:443')
    check('[wl-store] 없는 호스트 remove→err(ENOENT·throw 0)', !rmMiss.ok && (!rmMiss.ok ? rmMiss.error.code === 'ENOENT' : false))
    // internal 활성화 시 baseUrl 자동 등록.
    const setInt = store.setActive({ id: 'internal', baseUrl: 'https://auto.internal/v1', modelId: 'm1', supportsToolUse: true })
    check('[wl-store] internal setActive→baseUrl 자동 화이트리스트 등록', setInt.ok && store.allowedInternalHosts().includes('auto.internal:443'))
  }

  // ════ 16) ToolCatalog 인터페이스(ADR-016 결정 B·§15) ══════════════════════
  section('16) ToolCatalog (describe/toToolDefs/lookup/isFinish/invoke·scope·write·dispatch)')
  {
    const catScope = buildScope('E:\\work', ['E:\\work\\sel'])
    let catBackendCalled = ''
    const catBackend: ReadToolBackend = {
      list: async (p) => { catBackendCalled = `list:${p}`; return { content: 'ok' } },
      search: async () => ({ content: 'ok' }),
      preview: async (_p, c) => ({ content: c ? 'with-content' : 'meta-only' }),
      scan: async () => ({ content: 'ok' }),
      dup: async () => ({ content: 'ok' }),
      compare: async () => ({ content: 'ok' }),
      statPath: async () => ({ exists: true, isDir: true })
    }
    const catalog = createDefaultToolCatalog({
      scope: catScope,
      guardPath: guardOk,
      backend: catBackend,
      contentConsent: false
    })

    // describe(): 실행 도구 서술(finish 제외·mode 부기).
    const described = catalog.describe()
    const descNames = described.map((d) => d.name)
    check('[cat] describe 실행 도구 포함(list_directory)', descNames.includes('list_directory'))
    check('[cat] describe finish 제외(제어 도구)', !descNames.includes('finish'))
    check('[cat] describe mode 부기(open_tab=navigate)', described.find((d) => d.name === 'open_tab')?.mode === 'navigate')
    check('[cat] describe inputSchema 노출', !!described.find((d) => d.name === 'list_directory')?.inputSchema)

    // toToolDefs(): provider 정규화 접점 — finish 포함(provider 가 종료 도구도 봄).
    const defs2 = catalog.toToolDefs()
    check('[cat] toToolDefs finish 포함(종료 도구)', defs2.some((d) => d.name === 'finish'))
    check('[cat] toToolDefs = listToolDefs 동치(개수)', defs2.length === listToolDefs().length)

    // lookup / isFinish.
    check('[cat] lookup 메타(mode)', catalog.lookup('scan_folder')?.mode === 'read')
    check('[cat] lookup 미등록→undefined', catalog.lookup('nope') === undefined)
    check('[cat] isFinish(finish)=true', catalog.isFinish('finish') === true)
    check('[cat] isFinish(list_directory)=false', catalog.isFinish('list_directory') === false)

    // invoke: 스코프 안→백엔드 실행(deps 캡처 — invoke 인자에 scope/backend 없음).
    const inv1 = await catalog.invoke('list_directory', { path: 'E:\\work\\sub' })
    check('[cat] invoke 스코프 안→백엔드 실행(deps 캡처)', inv1.isError !== true && catBackendCalled === 'list:E:\\work\\sub')

    // invoke: 스코프 밖→is_error(guardPath+assertInScope 보존).
    const inv2 = await catalog.invoke('list_directory', { path: 'C:\\other' })
    check('[cat] invoke 스코프 밖→is_error(scope 재검증 보존)', inv2.isError === true)

    // invoke: 미등록→is_error(throw 0).
    const inv3 = await catalog.invoke('frobnicate', {})
    check('[cat] invoke 미등록→is_error(throw 0)', inv3.isError === true)

    // invoke: write 도구는 미등록(읽기 전용)·방어적 is_error.
    const inv4 = await catalog.invoke('move', { src: 'E:\\work\\a', dst: 'E:\\work\\b' })
    check('[cat] invoke write/미등록 도구→is_error(읽기 전용 보존)', inv4.isError === true)

    // open_tab dispatch: dispatchAction 캡처 → invoke 시 스파이 호출.
    const catDispatched: DispatchAction[] = []
    const catalog2 = createDefaultToolCatalog({
      scope: catScope,
      guardPath: guardOk,
      backend: catBackend,
      contentConsent: false,
      dispatchAction: (a: DispatchAction) => catDispatched.push(a)
    })
    const invTab = await catalog2.invoke('open_tab', { path: 'E:\\work\\sub' })
    check('[cat] invoke open_tab→dispatchAction(캡처)', invTab.isError !== true && catDispatched.length === 1 && catDispatched[0]!.path === 'E:\\work\\sub')

    // dispatchAction 미주입 카탈로그→open_tab is_error.
    const invTabNo = await catalog.invoke('open_tab', { path: 'E:\\work\\sub' })
    check('[cat] dispatchAction 미주입→open_tab is_error', invTabNo.isError === true)
  }

  // ════ 17) shouldPlan 휴리스틱(단순=우회·복합=plan) ══════════════════════════
  section('17) shouldPlan (plan 우회 판정·순수)')
  check('[plan-h] 단순 질의→우회(false): "이 폴더 목록 보여줘"', shouldPlan('이 폴더 목록 보여줘') === false)
  check('[plan-h] 단순 질의→우회(false): "용량 분석"', shouldPlan('용량 분석') === false)
  check('[plan-h] 빈 프롬프트→false', shouldPlan('') === false && shouldPlan('   ') === false)
  check('[plan-h] 순차 표현→plan(true): "A 찾고 그 다음 비교"', shouldPlan('A 폴더에서 큰 파일 찾고 그 다음 비교해줘') === true)
  check('[plan-h] 비교 표현→plan(true)', shouldPlan('두 폴더를 비교해줘') === true)
  check('[plan-h] 분류 표현→plan(true)', shouldPlan('파일을 종류별로 분류해줘') === true)
  // 골든 시나리오 프롬프트는 plan 경로로 가야 한다(탐색→식별→열기 다단계).
  check(
    '[plan-h] 골든 시나리오→plan(true)',
    shouldPlan('E: 드라이브에서 브라우저 기반 ERD 설계 도구개발 프로젝트를 찾아 해당 폴더를 열어줘') === true
  )

  // ════ 18) planner 순수 유틸(normalizePlan·planHash·PLAN_TOOL) ════════════════
  section('18) planner 순수 유틸(plan 정규화·해시·plan 도구 스키마)')
  {
    const np = normalizePlan({ steps: [{ goal: '드라이브 해석' }, { goal: '탐색', suggestedTools: ['list_directory'] }, { goal: '' }] }, 0)
    check('[planner] normalizePlan 빈 goal 드롭·id 부여', np.steps.length === 2 && np.steps[0]!.id === 'step-1')
    check('[planner] normalizePlan suggestedTools 보존', np.steps[1]!.suggestedTools?.[0] === 'list_directory')
    check('[planner] normalizePlan replanCount 반영', np.replanCount === 0)
    // MAX_PLAN_STEPS 절단.
    const many = normalizePlan({ steps: Array.from({ length: MAX_PLAN_STEPS + 5 }, (_v, i) => ({ goal: `g${i}` })) }, 1)
    check('[planner] normalizePlan MAX_PLAN_STEPS 절단', many.steps.length === MAX_PLAN_STEPS && many.replanCount === 1)
    // 깨진/빈 입력→빈 plan(throw 0).
    check('[planner] normalizePlan 빈 입력→빈 steps', normalizePlan({}, 0).steps.length === 0)
    // planHash 안정·발산 구분.
    check('[planner] planHash 동일 plan 동일 해시', planHash(np) === planHash(normalizePlan({ steps: [{ goal: '드라이브 해석' }, { goal: '탐색' }] }, 9)))
    check('[planner] planHash 다른 plan 다른 해시', planHash(np) !== planHash(normalizePlan({ steps: [{ goal: '다른 목표' }] }, 0)))
    // PLAN_TOOL 스키마 — steps 필수·도구 미실행(계획만).
    const ps = PLAN_TOOL.inputSchema as { required?: string[]; properties?: Record<string, unknown> }
    check('[planner] PLAN_TOOL steps 필수', Array.isArray(ps.required) && ps.required.includes('steps') && !!ps.properties?.['steps'])
  }

  // nearBudget 순수 판정.
  check('[budget] nearBudget 미근접 false', nearBudget({ turns: 1, stagedOps: 0, toolCalls: 1, tokens: 1, elapsedMs: 1 }) === false)
  check('[budget] nearBudget toolCalls 임계 true', nearBudget({ turns: 0, stagedOps: 0, toolCalls: MAX_TOOL_CALLS, tokens: 0, elapsedMs: 0 }) === true)

  // ════ 19) runHybrid — plan 우회 = runAgentLoop 동치(현 동작 보존·회귀 0) ════════
  section('19) runHybrid plan 우회(단순 질의→단일 ReAct 동치)')
  {
    // 단순 프롬프트(shouldPlan=false) → plan/step 이벤트 0·도구 실행→finish(현 동작).
    const provider = scriptedProvider([
      { text: '탐색', toolCalls: [{ id: 't1', name: 'list_directory', input: { path: 'E:\\work\\a' } }], stopReason: 'tool_use' },
      { text: '끝', toolCalls: [{ id: 't2', name: 'finish', input: { summary: '완료' } }], stopReason: 'tool_use' }
    ])
    const events: OrchestratorEvent[] = []
    const out = await runHybrid(provider, { prompt: '목록 보여줘', scope, contentConsent: false, backend: recordBackend, guardPath: guardOk }, (e) => events.push(e))
    check('[hybrid-bypass] 단순 질의→finish', out.stopReason === 'finish' && out.summary === '완료')
    check('[hybrid-bypass] plan 이벤트 미발생(현 UI 동일)', !events.some((e) => e.type === 'plan'))
    check('[hybrid-bypass] step 이벤트 미발생', !events.some((e) => e.type === 'step'))
    check('[hybrid-bypass] tool-call 이벤트는 발생(기존 동작)', events.some((e) => e.type === 'tool-call'))
  }
  {
    // tool-use 미지원 degradation 보존.
    const provider = scriptedProvider([{ text: '', toolCalls: [], stopReason: 'end_turn' }], false)
    const out = await runHybrid(provider, { prompt: '복잡하게 찾고 그 다음 비교', scope, contentConsent: false, backend: recordBackend, guardPath: guardOk }, () => {})
    check('[hybrid-bypass] tool-use 미지원→error(degradation 보존)', out.stopReason === 'error')
  }
  {
    // 사전 취소→aborted.
    const ctrl = new AbortController()
    ctrl.abort()
    const provider = scriptedProvider([{ text: '', toolCalls: [], stopReason: 'end_turn' }])
    const out = await runHybrid(provider, { prompt: '찾고 그 다음 비교', scope, contentConsent: false, backend: recordBackend, guardPath: guardOk, signal: ctrl.signal }, () => {})
    check('[hybrid-bypass] 사전 취소→aborted', out.stopReason === 'aborted')
  }

  // ════ 20) 골든 시나리오 — runHybrid plan→steps→탐색·식별·open_tab ════════════
  section('20) 골든 시나리오(plan[E: 탐색·식별·열기]→steps→open_tab dispatch)')
  {
    // 스텁 provider: 호출 순서대로 — ① plan 도구(3스텝) → ② step1: list_locations→텍스트(완료)
    // → ③ step2: list_directory→텍스트(완료) → ④ step3: read_preview→open_tab→finish.
    // runHybrid 가 카탈로그로 invoke 하고 최종 open_tab 이 dispatchAction 으로 기대 경로 호출됨을 단언.
    const TARGET = 'E:\\work\\erd-designer'
    const turns: LLMTurnResult[] = [
      // Planner: plan 도구 호출(3스텝).
      {
        text: '계획 수립',
        toolCalls: [{
          id: 'p1',
          name: 'plan',
          input: {
            steps: [
              { goal: 'E: 드라이브 경로 해석', suggestedTools: ['list_locations'] },
              { goal: 'E: 하위 폴더 탐색', suggestedTools: ['list_directory'] },
              { goal: 'ERD 도구 프로젝트 식별 후 열기', suggestedTools: ['read_preview', 'open_tab'] }
            ]
          }
        }],
        stopReason: 'tool_use'
      },
      // step1: list_locations 실행 → 텍스트 응답(스텝 완료).
      { text: 'E: 드라이브 탐색', toolCalls: [{ id: 's1a', name: 'list_locations', input: { category: 'drives' } }], stopReason: 'tool_use' },
      { text: 'E: 드라이브 = E:\\', toolCalls: [], stopReason: 'end_turn' },
      // step2: list_directory 실행 → 텍스트 응답(스텝 완료).
      { text: '폴더 목록 조회', toolCalls: [{ id: 's2a', name: 'list_directory', input: { path: 'E:\\work' } }], stopReason: 'tool_use' },
      { text: '후보 폴더 발견', toolCalls: [], stopReason: 'end_turn' },
      // step3: read_preview(식별) → open_tab(열기) → finish(전체 종료).
      { text: '내용 확인', toolCalls: [{ id: 's3a', name: 'read_preview', input: { path: 'E:\\work\\erd-designer\\package.json' } }], stopReason: 'tool_use' },
      { text: 'ERD 도구 확정·열기', toolCalls: [{ id: 's3b', name: 'open_tab', input: { path: TARGET } }], stopReason: 'tool_use' },
      { text: '완료', toolCalls: [{ id: 's3c', name: 'finish', input: { summary: 'ERD 설계 도구 프로젝트를 새 탭으로 열었습니다.' } }], stopReason: 'tool_use' }
    ]
    const provider = scriptedProvider(turns)
    // 스코프: E:\work 루트(드라이브 E:\ 도 location 으로 추가).
    const goldScope = buildScope('E:\\work', [], scopeRootsFromLocations(['E:\\']))
    const goldLocations: AgentLocations = { drives: [{ name: '로컬 디스크 (E:)', path: 'E:\\' }] }
    const goldBackend = createReadBackend(stubDeps)
    const dispatched: DispatchAction[] = []
    const events: OrchestratorEvent[] = []
    const out = await runHybrid(
      provider,
      {
        prompt: 'E: 드라이브에서 브라우저 기반 ERD 설계 도구개발 프로젝트를 찾아 해당 폴더를 열어줘',
        scope: goldScope,
        contentConsent: true,
        backend: goldBackend,
        guardPath: guardOk,
        locations: goldLocations,
        dispatchAction: (a: DispatchAction) => dispatched.push(a)
      },
      (e) => events.push(e)
    )
    check('[golden] runHybrid plan 경로→finish', out.stopReason === 'finish')
    check('[golden] plan 이벤트 발생(3스텝)', events.some((e) => e.type === 'plan' && e.steps.length === 3))
    check('[golden] step start 이벤트 발생', events.some((e) => e.type === 'step' && e.phase === 'start'))
    check('[golden] step done 이벤트 발생', events.some((e) => e.type === 'step' && e.phase === 'done'))
    check('[golden] list_locations tool-call(드라이브 해석)', events.some((e) => e.type === 'tool-call' && e.tool === 'list_locations'))
    check('[golden] list_directory tool-call(탐색)', events.some((e) => e.type === 'tool-call' && e.tool === 'list_directory'))
    check('[golden] read_preview tool-call(식별)', events.some((e) => e.type === 'tool-call' && e.tool === 'read_preview'))
    check('[golden] open_tab tool-call(열기·navigate)', events.some((e) => e.type === 'tool-call' && e.tool === 'open_tab' && e.mode === 'navigate'))
    check('[golden] 최종 open_tab dispatchAction→기대 경로', dispatched.length === 1 && dispatched[0]!.action === 'open-tab' && dispatched[0]!.path === TARGET)
    check('[golden] finish summary 반영', out.summary.includes('ERD'))
  }

  // ════ 21) 재계획(step 실패→재계획·MAX_REPLANS 가드·발산 종료) ════════════════
  section('21) runHybrid 재계획(스텝 실패→re-plan·MAX_REPLANS·plan 해시 발산 가드)')
  {
    // step1 미니루프가 연속 is_error(스코프 밖 경로 반복) → step-failed → 재계획.
    // 1차 재계획은 다른 plan(해시 다름) → replanCount>=1 plan 이벤트 발생.
    // 2차부터는 동일 plan(발산) → seenPlanHashes 가드로 요약 종료(무한 재계획 방지).
    let planCount = 0
    const replanProvider: LLMProvider = {
      id: 'anthropic',
      capabilities: { toolUse: true, streaming: true },
      async createCompletion(req): Promise<LLMTurnResult> {
        const isPlan = req.tools.some((t) => t.name === 'plan')
        if (isPlan) {
          planCount++
          // 1차(최초)·2차(재계획)는 다른 plan → 재계획 plan 이벤트 발생. 3차부터 2차와 동일(발산).
          const goal = planCount <= 1 ? '스코프 밖 폴더 접근 A' : '스코프 밖 폴더 접근 B'
          return {
            text: '계획',
            toolCalls: [{ id: `p${planCount}`, name: 'plan', input: { steps: [{ goal }] } }],
            stopReason: 'tool_use'
          }
        }
        // Executor: 스코프 밖 경로 호출 반복 → invoke is_error 누적 → step-failed.
        return {
          text: '시도',
          toolCalls: [{ id: 'e', name: 'list_directory', input: { path: 'C:\\forbidden' } }],
          stopReason: 'tool_use'
        }
      }
    }
    const events: OrchestratorEvent[] = []
    const out = await runHybrid(
      replanProvider,
      { prompt: '스코프 밖을 찾고 그 다음 비교', scope: buildScope('E:\\work', []), contentConsent: false, backend: recordBackend, guardPath: guardOk },
      (e) => events.push(e)
    )
    check('[replan] step failed 이벤트 발생', events.some((e) => e.type === 'step' && e.phase === 'failed'))
    check('[replan] 재계획 plan 이벤트 1회 이상(replanCount>0)', events.some((e) => e.type === 'plan' && e.replanCount >= 1))
    check('[replan] 동일 plan 발산→종료(무한 재계획 아님)', out.stopReason === 'end_turn' || out.stopReason === 'limit')
    check('[replan] 재계획 횟수 MAX_REPLANS 가드(plan 호출 ≤ MAX_REPLANS+2)', planCount <= MAX_REPLANS + 2)
  }
  {
    // plan 산출 실패(plan 도구 미호출)→plan 우회 폴백(단일 ReAct·답은 나옴).
    const provider: LLMProvider = {
      id: 'openai',
      capabilities: { toolUse: true, streaming: true },
      async createCompletion(req): Promise<LLMTurnResult> {
        const isPlan = req.tools.some((t) => t.name === 'plan')
        // Planner 단계: plan 도구 미호출(빈 plan) → 우회 폴백.
        if (isPlan) return { text: '계획 못 세움', toolCalls: [], stopReason: 'end_turn' }
        // 우회 ReAct: 바로 end_turn 응답.
        return { text: '바로 답변', toolCalls: [], stopReason: 'end_turn' }
      }
    }
    const events: OrchestratorEvent[] = []
    const out = await runHybrid(provider, { prompt: '찾고 그 다음 비교해줘', scope, contentConsent: false, backend: recordBackend, guardPath: guardOk }, (e) => events.push(e))
    check('[replan] plan 산출 실패→plan 우회 폴백(end_turn)', out.stopReason === 'end_turn')
    check('[replan] 폴백 시 plan 이벤트 미발생', !events.some((e) => e.type === 'plan'))
  }

  // ════ 22) AgentEvent plan/step 변형 직렬화(IPC 푸시 DTO shape·frontend 인계) ═════
  section('22) AgentEvent plan/step 변형 라운드트립(비파괴·신규 채널 0)')
  {
    const planEvt: AgentEvent = { type: 'plan', runId: 'r1', steps: [{ id: 'step-1', goal: '탐색' }, { id: 'step-2', goal: '열기' }], replanCount: 0 }
    const round = JSON.parse(JSON.stringify(planEvt)) as AgentEvent
    check('[evt] plan 변형 라운드트립', round.type === 'plan' && round.type === 'plan' && round.steps.length === 2 && round.steps[0]!.goal === '탐색' && round.replanCount === 0)
    const stepEvt: AgentEvent = { type: 'step', runId: 'r1', stepId: 'step-1', index: 0, total: 2, phase: 'start' }
    const rs = JSON.parse(JSON.stringify(stepEvt)) as AgentEvent
    check('[evt] step 변형 라운드트립', rs.type === 'step' && rs.type === 'step' && rs.stepId === 'step-1' && rs.phase === 'start' && rs.total === 2)
    // 기존 변형(thinking/tool-call/plan-ready/action/error) 무변 — 라운드트립 보존.
    const thinking: AgentEvent = { type: 'thinking', runId: 'r1', text: 't' }
    check('[evt] 기존 thinking 변형 무변', (JSON.parse(JSON.stringify(thinking)) as AgentEvent).type === 'thinking')
  }

  // buildReasoningPlan(provider 격리) — plan 도구 호출 시 정규화 plan 반환·미호출 시 빈 plan.
  {
    const catalog = createDefaultToolCatalog({ scope, guardPath: guardOk, backend: recordBackend, contentConsent: false })
    const okProv = scriptedProvider([{ text: 'plan', toolCalls: [{ id: 'p', name: 'plan', input: { steps: [{ goal: 'g1' }, { goal: 'g2' }] } }], stopReason: 'tool_use' }])
    const plan1 = await buildReasoningPlan(okProv, catalog, { prompt: 'q', replanCount: 0 })
    check('[planner-bld] plan 도구 호출→정규화 plan(2스텝)', plan1.steps.length === 2 && plan1.steps[0]!.goal === 'g1')
    const noPlanProv = scriptedProvider([{ text: '계획 없음', toolCalls: [], stopReason: 'end_turn' }])
    const plan2 = await buildReasoningPlan(noPlanProv, catalog, { prompt: 'q', replanCount: 0 })
    check('[planner-bld] plan 도구 미호출→빈 plan(우회 폴백 신호)', plan2.steps.length === 0)
    // 깨진 plan arguments(parseError)→빈 plan(throw 0).
    const badProv = scriptedProvider([{ text: '', toolCalls: [{ id: 'p', name: 'plan', input: {}, parseError: 'bad' }], stopReason: 'tool_use' }])
    const plan3 = await buildReasoningPlan(badProv, catalog, { prompt: 'q', replanCount: 0 })
    check('[planner-bld] 깨진 plan arguments→빈 plan(throw 0)', plan3.steps.length === 0)
  }

  // ════ 23) search 진행 스트리밍 + walk 바운드(§Z 프리징 완화·어댑터 레벨) ═══════════
  section('23) search_content 진행 스로틀 + 조기 종료(matched/scanned/time) + 동치')

  // 엔진 모사 stub — runGrep 처럼 파일을 순차 스캔하며 onProgress 를 파일마다 호출하고,
  // shouldCancel 을 파일마다 폴링한다(true 면 즉시 부분 결과 반환). 옵션으로 파일당 일치/지연 제어.
  function makeSearchStub(opts: {
    totalFiles: number
    matchEvery?: number // 이 간격마다 일치(기본: 일치 0)
    perFileDelayMs?: number // 파일당 가짜 경과(시간 예산 테스트용·Date.now 모킹 대신 누적)
    timeBudgetSim?: boolean // true 면 실제 Date.now 대신 즉시 다수 호출로 시간 시뮬 불가 → 별도 케이스
  }): ReadBackendDeps['search'] {
    return async (_root, _query, _o, shouldCancel, onProgress) => {
      let scanned = 0
      let matched = 0
      const files: Array<{ file: string; lines: Array<{ lineNo: number; text: string }> }> = []
      for (let i = 0; i < opts.totalFiles; i++) {
        if (shouldCancel()) break // 조기 종료(어댑터가 결과/스캔/시간 상한 도달 판정).
        scanned++
        const isMatch = opts.matchEvery ? scanned % opts.matchEvery === 0 : false
        if (isMatch) {
          matched++
          files.push({ file: `E:\\w\\f${scanned}.txt`, lines: [{ lineNo: 1, text: 'hit' }] })
        }
        // 엔진은 파일마다 onProgress 보고.
        onProgress?.(scanned, matched, `E:\\w\\f${scanned}.txt`)
      }
      return { files, totalMatches: matched, matchedFiles: matched, truncated: false, canceled: false }
    }
  }

  // ── 23a) 진행 스로틀 전달(onProgress N회 → onToolProgress 스로틀) ──
  {
    // 파일 간격 스로틀(AGENT_TOOL_PROGRESS_THROTTLE_FILES=50)로 300파일이면 적어도 6회 푸시.
    const deps: ReadBackendDeps = { ...stubDeps, search: makeSearchStub({ totalFiles: 300 }) }
    const progresses: ToolProgress[] = []
    const rb = createReadBackend(deps)
    const res = await rb.search('E:\\w', 'x', { regex: false, recursive: true }, (s, m, c) =>
      progresses.push({ tool: 'search_content', scanned: s, matched: m, ...(c ? { current: c } : {}) })
    )
    check('[prog] onToolProgress 스로틀 호출(파일 간격≥50→여러 회)', progresses.length >= 1 && progresses.length <= 300)
    check('[prog] 스로틀로 매 파일마다 푸시하지 않음(<300)', progresses.length < 300)
    check('[prog] tool 식별자 search_content', progresses.every((p) => p.tool === 'search_content'))
    check('[prog] 누적 scanned 단조 증가', progresses.every((p, i) => i === 0 || p.scanned >= progresses[i - 1]!.scanned))
    const sr = JSON.parse(res.content) as { scannedFiles: number; bounded: boolean }
    check('[prog] 결과 scannedFiles 반영(=300·완주)', sr.scannedFiles === 300 && sr.bounded === false)
  }

  // ── 23b) onToolProgress 미주입 → 진행 보고 0(기존 동작 동치) ──
  {
    const deps: ReadBackendDeps = { ...stubDeps, search: makeSearchStub({ totalFiles: 120, matchEvery: 3 }) }
    const rb = createReadBackend(deps)
    const res = await rb.search('E:\\w', 'x', { regex: false, recursive: true }) // onProgress 없음
    const sr = JSON.parse(res.content) as { matchedFiles: number; bounded: boolean; files: unknown[] }
    check('[prog] onProgress 미주입→정상 결과(throw 0)', res.isError !== true && sr.matchedFiles === 40)
    check('[prog] 미주입 시 완주(bounded=false)', sr.bounded === false)
  }

  // ── 23c) 조기 종료: 결과(matched) 상한 도달 → walk 중단·부분결과+"일부만" ──
  {
    // 매 파일 일치(matchEvery=1)·10만 파일 → matched 가 AGENT_SEARCH_MAX_MATCHED_FILES 도달 시 중단.
    const deps: ReadBackendDeps = { ...stubDeps, search: makeSearchStub({ totalFiles: 100_000, matchEvery: 1 }) }
    const rb = createReadBackend(deps)
    const res = await rb.search('E:\\w', 'x', { regex: false, recursive: true }, () => {})
    const sr = JSON.parse(res.content) as { bounded: boolean; note?: string; matchedFiles: number; scannedFiles: number }
    check('[bound] matched 상한 도달→조기 종료(bounded)', sr.bounded === true)
    check('[bound] 스캔 수 ≪ 전체(10만 미만)·상한 근처', sr.scannedFiles < 100_000 && sr.scannedFiles <= AGENT_SEARCH_MAX_MATCHED_FILES + 2)
    check('[bound] "일부만 검색됨" 정직 표기·결과 상한 사유', !!sr.note && sr.note.includes('일부만') && sr.note.includes('상한'))
  }

  // ── 23d) 조기 종료: 스캔(scanned) 캡 도달 → walk 중단(일치 0 거대 트리) ──
  {
    const deps: ReadBackendDeps = { ...stubDeps, search: makeSearchStub({ totalFiles: 100_000, matchEvery: 0 }) }
    const rb = createReadBackend(deps)
    const res = await rb.search('E:\\w', 'x', { regex: false, recursive: true }, () => {})
    const sr = JSON.parse(res.content) as { bounded: boolean; note?: string; scannedFiles: number }
    check('[bound] scanned 캡 도달→조기 종료(bounded)', sr.bounded === true)
    check('[bound] 스캔 수 ≈ 스캔 캡(<전체)', sr.scannedFiles < 100_000 && sr.scannedFiles <= AGENT_SEARCH_MAX_SCANNED_FILES + 2)
    check('[bound] 스캔 상한 사유 표기', !!sr.note && sr.note.includes('스캔 상한'))
  }

  // ── 23e) 조기 종료: 시간 예산 초과 → walk 중단 ──
  {
    // Date.now 를 모킹해 시간 예산 경과를 강제(파일마다 시간 점프).
    const realNow = Date.now
    let clock = 1_000_000
    // 첫 호출(startedAt)=clock, 이후 파일 진행마다 큰 폭 증가시켜 예산 초과 유도.
    Date.now = () => clock
    const stepDeps: ReadBackendDeps = {
      ...stubDeps,
      search: async (_root, _q, _o, shouldCancel, onProgress) => {
        let scanned = 0
        for (let i = 0; i < 100_000; i++) {
          if (shouldCancel()) break
          scanned++
          clock += AGENT_SEARCH_TIME_BUDGET_MS / 10 // 10파일이면 예산 초과.
          onProgress?.(scanned, 0, `E:\\w\\f${scanned}.txt`)
        }
        return { files: [], totalMatches: 0, matchedFiles: 0, truncated: false, canceled: false }
      }
    }
    const rb = createReadBackend(stepDeps)
    const res = await rb.search('E:\\w', 'x', { regex: false, recursive: true }, () => {})
    Date.now = realNow
    const sr = JSON.parse(res.content) as { bounded: boolean; note?: string; scannedFiles: number }
    check('[bound] 시간 예산 초과→조기 종료(bounded)', sr.bounded === true)
    check('[bound] 시간 초과 시 적은 파일만 스캔(<100)', sr.scannedFiles < 100)
    check('[bound] 시간 예산 사유 표기', !!sr.note && sr.note.includes('시간 예산'))
  }

  // ── 23f) 작은 트리(상한 미만) → 완전 결과·bounded=false(기존 동작 동치) ──
  {
    const deps: ReadBackendDeps = { ...stubDeps, search: makeSearchStub({ totalFiles: 30, matchEvery: 5 }) }
    const rb = createReadBackend(deps)
    const res = await rb.search('E:\\w', 'x', { regex: false, recursive: true }, () => {})
    const sr = JSON.parse(res.content) as { bounded: boolean; note?: string; matchedFiles: number; scannedFiles: number }
    check('[equiv] 작은 트리 완전 결과(matched=6·scanned=30)', sr.matchedFiles === 6 && sr.scannedFiles === 30)
    check('[equiv] bounded=false·note 없음(완주)', sr.bounded === false && sr.note === undefined)
  }

  // ── 23g) current 경로 새니타이즈(제어문자 공백화·길이 절단) ──
  {
    const long = 'E:\\w\\' + 'a'.repeat(AGENT_TOOL_PROGRESS_PATH_MAX + 50) + '\nctrl\ttab'
    const sanitizeDeps: ReadBackendDeps = {
      ...stubDeps,
      search: async (_root, _q, _o, _sc, onProgress) => {
        onProgress?.(1, 0, long)
        return { files: [], totalMatches: 0, matchedFiles: 0, truncated: false, canceled: false }
      }
    }
    const seen: string[] = []
    const rb = createReadBackend(sanitizeDeps)
    await rb.search('E:\\w', 'x', { regex: false, recursive: true }, (_s, _m, c) => seen.push(c))
    const first = seen[0] ?? ''
    check('[sani] current 길이 절단(≤PATH_MAX)', first.length <= AGENT_TOOL_PROGRESS_PATH_MAX)
    // eslint-disable-next-line no-control-regex
    check('[sani] 제어문자 제거(개행·탭 없음)', !/[\u0000-\u001f\u007f]/.test(first))
  }

  // ── 23h) onToolProgress 미주입 시 조기 종료는 여전히 동작(진행 보고와 독립) ──
  {
    const deps: ReadBackendDeps = { ...stubDeps, search: makeSearchStub({ totalFiles: 100_000, matchEvery: 1 }) }
    const rb = createReadBackend(deps)
    const res = await rb.search('E:\\w', 'x', { regex: false, recursive: true }) // onProgress 없음
    const sr = JSON.parse(res.content) as { bounded: boolean; scannedFiles: number }
    check('[bound] 진행 미주입에도 조기 종료 동작(walk 바운드 독립)', sr.bounded === true && sr.scannedFiles <= AGENT_SEARCH_MAX_MATCHED_FILES + 2)
  }

  // ════ 24) AgentEvent tool-progress 변형 직렬화 + 오케스트레이터 중계 ══════════════
  section('24) tool-progress AgentEvent 라운드트립 + runReactLoop→tool-progress emit')
  {
    const evt: AgentEvent = { type: 'tool-progress', runId: 'r1', tool: 'search_content', scanned: 1200, matched: 7, current: 'E:\\w\\x.ts', stepId: 'step-2' }
    const round = JSON.parse(JSON.stringify(evt)) as AgentEvent
    check('[tp-evt] tool-progress 변형 라운드트립', round.type === 'tool-progress' && round.type === 'tool-progress' && round.scanned === 1200 && round.matched === 7 && round.current === 'E:\\w\\x.ts' && round.stepId === 'step-2')
    // stepId/current 생략형도 안전.
    const minimal: AgentEvent = { type: 'tool-progress', runId: 'r2', tool: 'search_content', scanned: 5, matched: 0 }
    const rm = JSON.parse(JSON.stringify(minimal)) as AgentEvent
    check('[tp-evt] tool-progress 최소형(stepId/current 생략) 라운드트립', rm.type === 'tool-progress' && rm.type === 'tool-progress' && rm.stepId === undefined && rm.current === undefined)
  }

  // 오케스트레이터: search_content 호출 → 어댑터 onProgress → tool-progress OrchestratorEvent emit.
  {
    const progDeps: ReadBackendDeps = { ...stubDeps, search: makeSearchStub({ totalFiles: 200, matchEvery: 7 }) }
    const progBackend = createReadBackend(progDeps)
    const provider = scriptedProvider([
      { text: '검색', toolCalls: [{ id: 't1', name: 'search_content', input: { root: 'E:\\work\\a', query: 'foo' } }], stopReason: 'tool_use' },
      { text: '끝', toolCalls: [{ id: 't2', name: 'finish', input: { summary: '검색 완료' } }], stopReason: 'tool_use' }
    ])
    const events: OrchestratorEvent[] = []
    const out = await runAgentLoop(provider, { prompt: '내용 검색', scope, contentConsent: false, backend: progBackend, guardPath: guardOk }, (e) => events.push(e))
    check('[tp-loop] search_content 실행→finish', out.stopReason === 'finish')
    const tps = events.filter((e) => e.type === 'tool-progress')
    check('[tp-loop] tool-progress OrchestratorEvent emit(≥1)', tps.length >= 1)
    check('[tp-loop] tool-progress tool=search_content·scanned 증가', tps.every((e) => e.type === 'tool-progress' && e.tool === 'search_content'))
    // 단일 ReAct(plan 우회)이므로 stepId 없음.
    check('[tp-loop] 단일 ReAct→stepId 없음', tps.every((e) => e.type === 'tool-progress' && e.stepId === undefined))
  }

  // 상수 정합(매직넘버 산재 0).
  check('[tp-const] MAX_MATCHED_FILES=결과 상한(readBackend MAX_GREP_FILES=100)', AGENT_SEARCH_MAX_MATCHED_FILES === 100)
  check('[tp-const] 스로틀 상수 양수', AGENT_TOOL_PROGRESS_THROTTLE_MS > 0 && AGENT_TOOL_PROGRESS_THROTTLE_FILES > 0)

  // ════ 25) §Z 경로 그라운딩(환각 placeholder 경로 완화) ═══════════════════════════
  section('25) 경로 그라운딩 블록 + 창작 금지 하드 규칙(Planner/Executor 선주입)')

  // ── 25a) buildGroundingBlock: 실제 경로 직렬화(cwd + 분류) ──
  {
    const locs: AgentLocations = {
      drives: [{ name: 'C 드라이브', path: 'C:\\' }, { name: 'E 드라이브', path: 'E:\\' }],
      favorites: [{ name: '프로젝트A', path: 'E:\\03.프로젝트\\projectA' }],
      quickAccess: [{ name: '다운로드', path: 'C:\\Users\\me\\Downloads' }],
      recent: [{ name: 'docs', path: 'E:\\docs' }],
      panels: [{ index: 1, path: 'E:\\work', active: true }, { index: 2, path: 'E:\\other', active: false }]
    }
    const block = buildGroundingBlock(locs, 'E:\\work\\cur')
    check('[grnd] cwd 줄 포함', block.includes('현재 폴더(cwd): E:\\work\\cur'))
    check('[grnd] 드라이브 실경로 직렬화(E:\\)', block.includes('E 드라이브=E:\\') && block.includes('드라이브'))
    check('[grnd] 즐겨찾기 이름=경로 직렬화', block.includes('프로젝트A=E:\\03.프로젝트\\projectA'))
    check('[grnd] 빠른위치 직렬화', block.includes('다운로드=C:\\Users\\me\\Downloads'))
    check('[grnd] 최근 방문 직렬화', block.includes('docs=E:\\docs'))
    check('[grnd] 패널 index 라벨·활성 표기', block.includes('패널1(활성)=E:\\work') && block.includes('패널2=E:\\other'))
    check('[grnd] "그대로 사용" 안내 포함', block.includes('그대로 사용'))
  }

  // ── 25b) 빈 locations + cwd 없음 → list_locations 조회 안내(빈 컨텍스트 창작 차단) ──
  {
    const emptyBlock = buildGroundingBlock(undefined, undefined)
    check('[grnd] 빈 locations→list_locations 조회 안내', emptyBlock.includes('list_locations') && emptyBlock.includes('창작하지'))
    check('[grnd] 빈 locations→list_directory 안내', emptyBlock.includes('list_directory'))
    const emptyObj = buildGroundingBlock({}, '')
    check('[grnd] 빈 객체+빈 cwd→조회 안내', emptyObj.includes('list_locations'))
  }

  // ── 25c) 분류별 상한(폭주 방지) ──
  {
    const many = Array.from({ length: GROUNDING_MAX_PER_CATEGORY + 10 }, (_v, i) => ({ name: `fav${i}`, path: `E:\\f${i}` }))
    const block = buildGroundingBlock({ favorites: many }, undefined)
    check('[grnd] 분류 상한 초과→…(외 N개) 표기', block.includes('…(외 10개)'))
    // 상한 개수만 직렬화(상한+1번째는 미표시).
    check('[grnd] 상한 내 항목만 직렬화', block.includes(`fav${GROUNDING_MAX_PER_CATEGORY - 1}=`) && !block.includes(`fav${GROUNDING_MAX_PER_CATEGORY}=`))
  }

  // ── 25d) GROUNDING_HARD_RULES: 창작/placeholder 금지·Windows·list_locations 우선 명시 ──
  {
    check('[grnd] 하드규칙 Windows·역슬래시 명시', GROUNDING_HARD_RULES.includes('Windows') && GROUNDING_HARD_RULES.includes('역슬래시'))
    check('[grnd] 하드규칙 Unix placeholder 금지(/path/to·/Users/Username)', GROUNDING_HARD_RULES.includes('/path/to') && GROUNDING_HARD_RULES.includes('/Users/Username'))
    check('[grnd] 하드규칙 추측·창작 금지', GROUNDING_HARD_RULES.includes('추측') && GROUNDING_HARD_RULES.includes('지어내'))
    check('[grnd] 하드규칙 list_locations 우선', GROUNDING_HARD_RULES.includes('list_locations'))
  }

  // ── 25e) withGrounding: base 보존 + 그라운딩 + 하드규칙 덧붙임 ──
  {
    const merged = withGrounding('BASE_SYSTEM_PROMPT', { drives: [{ name: 'E', path: 'E:\\' }] }, 'E:\\work')
    check('[grnd] withGrounding base 보존(앞부분)', merged.startsWith('BASE_SYSTEM_PROMPT'))
    check('[grnd] withGrounding 그라운딩 블록 포함', merged.includes('E=E:\\') && merged.includes('현재 폴더(cwd): E:\\work'))
    check('[grnd] withGrounding 하드규칙 포함', merged.includes('/Users/Username') && merged.includes('list_locations'))
  }

  // ── 25f) Planner 시스템 프롬프트에 그라운딩/하드규칙 선주입 ──
  {
    const sys = buildPlannerSystemPrompt('- list_directory (read): 목록', undefined, {
      locations: { drives: [{ name: 'E', path: 'E:\\' }] },
      cwd: 'E:\\proj'
    })
    check('[grnd-plan] Planner 프롬프트 그라운딩 블록(실경로)', sys.includes('E=E:\\') && sys.includes('현재 폴더(cwd): E:\\proj'))
    check('[grnd-plan] Planner 프롬프트 창작 금지 규칙', sys.includes('지어내') && sys.includes('/path/to'))
    check('[grnd-plan] Planner 프롬프트 Windows 명시', sys.includes('Windows'))
    // grounding 미지정 시에도 빈 그라운딩 안내(회귀: 기존 시그니처 호환).
    const sysNoGrnd = buildPlannerSystemPrompt('- t (read): x')
    check('[grnd-plan] grounding 미지정→빈 그라운딩 안내(회귀 호환)', sysNoGrnd.includes('list_locations') && sysNoGrnd.includes('계획 수립기'))
  }

  // ── 25g) Executor(runAgentLoop): 시스템 프롬프트에 그라운딩 주입(provider 가 본 메시지로 단언) ──
  {
    const provider = scriptedProvider([{ text: '답', toolCalls: [], stopReason: 'end_turn' }])
    await runAgentLoop(provider, {
      prompt: 'p', scope, contentConsent: false, backend: recordBackend, guardPath: guardOk,
      locations: { drives: [{ name: 'E', path: 'E:\\' }] }, cwd: 'E:\\work'
    }, () => {})
    const seen = (provider as unknown as { seen: NormalizedCompletionReq[] }).seen
    const sysMsg = seen[0]?.messages.find((m) => m.role === 'system')
    const sysText = sysMsg && typeof sysMsg.content === 'string' ? sysMsg.content : ''
    check('[grnd-exec] Executor system 프롬프트에 실경로 그라운딩', sysText.includes('E=E:\\') && sysText.includes('현재 폴더(cwd): E:\\work'))
    check('[grnd-exec] Executor system 프롬프트에 창작 금지 규칙', sysText.includes('/Users/Username') && sysText.includes('list_locations'))
  }

  // ════ 26) §Z 리다이렉트형 경로 에러(유효 루트 + list_locations 안내) ════════════
  section('26) 경로 거부 리다이렉트 에러 + open_tab 존재 검증 + 반복 가드')

  // ── 26a) buildRedirectError: 사유 + 유효 루트 요약 + list_locations 안내 ──
  {
    const sc = buildScope('E:\\work', ['E:\\work\\sel'])
    const e = buildRedirectError('경로가 스코프 밖입니다.', sc, 'C:\\nope')
    check('[redir] 사유 포함', e.includes('스코프 밖'))
    check('[redir] 시도 경로 포함', e.includes('C:\\nope'))
    check('[redir] 유효 루트 요약 포함', e.includes('E:\\work'))
    check('[redir] list_locations 안내 포함', e.includes('list_locations'))
    check('[redir] Windows 명시', e.includes('Windows'))
    // 루트 0개여도 안전.
    const e0 = buildRedirectError('사유', { roots: [] })
    check('[redir] 루트 0개→"없습니다" 안내', e0.includes('없습니다') && e0.includes('list_locations'))
  }

  // ── 26b) executeTool 스코프 밖/창작(Unix) 경로 → 리다이렉트 에러 ──
  {
    const sc = buildScope('E:\\work', [])
    const guardUnix = (p: string) => (typeof p === 'string' && /^[A-Za-z]:\\/.test(p) ? { ok: true as const, value: p } : { ok: false as const, error: { code: 'EINVAL' as const, message: '상대/비Windows 경로' } })
    // 환각형 Unix placeholder 경로 → guardPath 거부 → 리다이렉트.
    const exUnix = await executeTool('list_directory', { path: '/Users/Username/Projects' }, { backend: recordBackend, scope: sc, guardPath: guardUnix, contentConsent: false })
    check('[redir-exec] Unix placeholder 경로 거부(is_error)', exUnix.isError === true)
    check('[redir-exec] 거부 시 list_locations 안내(리다이렉트)', isPathError(exUnix.content) && exUnix.content.includes('list_locations'))
    // 스코프 밖(정상 Windows 경로지만 루트 밖) → 리다이렉트 + 유효 루트.
    const exOut = await executeTool('list_directory', { path: 'C:\\other' }, { backend: recordBackend, scope: sc, guardPath: guardOk, contentConsent: false })
    check('[redir-exec] 스코프 밖→리다이렉트(유효 루트 E:\\work)', exOut.isError === true && exOut.content.includes('E:\\work') && exOut.content.includes('list_locations'))
  }

  // ── 26c) open_tab 존재 검증: 미존재 경로 → dispatch 안 함·리다이렉트 ──
  {
    const sc = buildScope('E:\\work', [])
    const dispatched: DispatchAction[] = []
    const noExistBackend: ReadToolBackend = { ...recordBackend, statPath: async () => ({ exists: false, isDir: false }) }
    const ex = await executeTool('open_tab', { path: 'E:\\work\\ghost' }, { backend: noExistBackend, scope: sc, guardPath: guardOk, contentConsent: false, dispatchAction: (a: DispatchAction) => dispatched.push(a) })
    check('[tab-exist] 미존재 경로→is_error', ex.isError === true)
    check('[tab-exist] 미존재→dispatchAction 미호출(환각 dispatch 방지)', dispatched.length === 0)
    check('[tab-exist] 미존재→list_locations 안내', ex.content.includes('list_locations'))
  }

  // ── 26d) open_tab: 존재하는 디렉토리 → 정상 dispatch ──
  {
    const sc = buildScope('E:\\work', [])
    const dispatched: DispatchAction[] = []
    const dirBackend: ReadToolBackend = { ...recordBackend, statPath: async () => ({ exists: true, isDir: true }) }
    const ex = await executeTool('open_tab', { path: 'E:\\work\\real' }, { backend: dirBackend, scope: sc, guardPath: guardOk, contentConsent: false, dispatchAction: (a: DispatchAction) => dispatched.push(a) })
    check('[tab-exist] 존재 디렉토리→정상 dispatch', ex.isError !== true && dispatched.length === 1 && dispatched[0]!.path === 'E:\\work\\real')
  }

  // ── 26e) open_tab: 파일이면 부모 디렉토리로 dispatch(합리적 보정) ──
  {
    const sc = buildScope('E:\\work', [])
    const dispatched: DispatchAction[] = []
    const fileBackend: ReadToolBackend = { ...recordBackend, statPath: async () => ({ exists: true, isDir: false }) }
    const ex = await executeTool('open_tab', { path: 'E:\\work\\sub\\file.txt' }, { backend: fileBackend, scope: sc, guardPath: guardOk, contentConsent: false, dispatchAction: (a: DispatchAction) => dispatched.push(a) })
    check('[tab-exist] 파일→부모 디렉토리로 dispatch', ex.isError !== true && dispatched.length === 1 && dispatched[0]!.path === 'E:\\work\\sub')
  }

  // ── 26f) open_tab: statPath 미배선 백엔드 → 보수적 거부(환각 dispatch 방지) ──
  {
    const sc = buildScope('E:\\work', [])
    const dispatched: DispatchAction[] = []
    const noStat: ReadToolBackend = {
      list: recordBackend.list, search: recordBackend.search, preview: recordBackend.preview,
      scan: recordBackend.scan, dup: recordBackend.dup, compare: recordBackend.compare
      // statPath 미정의
    }
    const ex = await executeTool('open_tab', { path: 'E:\\work\\x' }, { backend: noStat, scope: sc, guardPath: guardOk, contentConsent: false, dispatchAction: (a: DispatchAction) => dispatched.push(a) })
    check('[tab-exist] statPath 미배선→보수적 거부·dispatch 0', ex.isError === true && dispatched.length === 0 && ex.content.includes('list_locations'))
  }

  // ── 26g) createReadBackend statPath 어댑터(deps.statPath 위임·throw 흡수) ──
  {
    const okStat = createReadBackend({ ...stubDeps, statPath: async () => ({ exists: true, isDir: true }) })
    check('[tab-exist] createReadBackend statPath 노출(deps 있음)', typeof okStat.statPath === 'function')
    const st = await okStat.statPath!('E:\\x')
    check('[tab-exist] statPath 위임 결과', st.exists === true && st.isDir === true)
    const throwStat = createReadBackend({ ...stubDeps, statPath: async () => { throw new Error('boom') } })
    const st2 = await throwStat.statPath!('E:\\x')
    check('[tab-exist] statPath throw 흡수→exists:false', st2.exists === false)
    const stubNoStat: ReadBackendDeps = { // statPath 미제공(명시적)
      list: stubDeps.list, readPreview: stubDeps.readPreview, scan: stubDeps.scan,
      search: stubDeps.search, dup: stubDeps.dup, compare: stubDeps.compare
    }
    const noStatBackend = createReadBackend(stubNoStat)
    check('[tab-exist] deps.statPath 없으면 backend.statPath 미노출', noStatBackend.statPath === undefined)
  }

  // ── 26h) 반복 환각 가드: 연속 경로 에러 임계 → list_locations 강한 힌트 1회 주입 ──
  {
    check('[guard] isPathError 판정(list_locations 마커)', isPathError('경로 거부... list_locations 호출') && !isPathError('일반 에러'))
    check('[guard] 임계 상수 양수', MAX_CONSECUTIVE_PATH_ERRORS >= 1)
    check('[guard] 힌트 텍스트 list_locations·Windows', REPEATED_PATH_ERROR_HINT.includes('list_locations') && REPEATED_PATH_ERROR_HINT.includes('Windows'))

    // 시나리오: 항상 스코프 밖 경로 호출 → 연속 경로 에러 → 임계 후 user 힌트 메시지 주입.
    const sc = buildScope('E:\\work', [])
    const repProvider = scriptedProvider([
      { text: '시도', toolCalls: [{ id: 'a', name: 'list_directory', input: { path: 'C:\\nope' } }], stopReason: 'tool_use' }
    ])
    await runAgentLoop(repProvider, { prompt: 'p', scope: sc, contentConsent: false, backend: recordBackend, guardPath: guardOk }, () => {})
    const seen = (repProvider as unknown as { seen: NormalizedCompletionReq[] }).seen
    // runReactLoop 은 단일 messages 배열을 누적 변형하므로 seen[*] 은 동일 참조 → 최종 배열을 한 번만 검사.
    const finalMessages = seen[seen.length - 1]?.messages ?? []
    const hintCount = finalMessages.filter((m) => m.role === 'user' && typeof m.content === 'string' && m.content === REPEATED_PATH_ERROR_HINT).length
    check('[guard] 연속 경로 에러 임계 도달→힌트 1회 주입', hintCount === 1)
  }

  // ── 결과 ──
  // eslint-disable-next-line no-console
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

void main()
