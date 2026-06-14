# ADR-015 — 멀티 LLM 제공자 추상화·function-calling 정규화·내부 엔드포인트 SSRF 방어

상태: 제안 · 2026-06-14 · **🔜 설계 완료·구현 전**

관련 기획: features §Z1(특히 Z1-d 멀티 AI 제공자 설정) · user-stories 에픽24(US-24.3·24.4 중심, 24.1·24.2·24.5 정합) · flows F38·F40·F41 · PRD §6(§Z Could)·§7 결정 **D8**·§12 M11
관련 설계(상호참조):
- **[ADR-014 자연어 파일 에이전트](./ADR-014-agentic-natural-language-file-agent.md)** — 본 ADR이 **부분 확장·일부 대체**한다(아래 §ADR-014와의 관계). ADR-014의 결정 ①(Main 단일 신뢰 경계)·③(읽기자유/쓰기스테이징)·④(tool-use 루프)·⑥(op:* + undo 재사용)·⑦(위협 모델)은 **그대로 유효**하고, 결정 ②(키 보관)·⑤(모델 라우팅)·⑧(네트워크 경계)를 멀티 제공자로 일반화한다.
- [ADR-005 프로세스/보안 모델](./ADR-005-process-security-model.md) — Main 전용·sender·zod·guardPath·명령행 합성 0
- [ADR-007 원격 프로토콜·네트워크 경계](./ADR-007-remote-protocol-and-network-boundary.md) — **safeStorage(DPAPI) credentialStore·D7 네트워크 경계·`src/main/<격리>/` ESLint 화이트리스트 모델**
- [ADR-003 IPC 계약 스타일](./ADR-003-ipc-contract-style.md) — invoke/handle + 단방향 이벤트 스트림·Result

> 본 ADR은 **설계 결정**만 기록한다(코드 아님). 컴포넌트·계약·시퀀스 상세는 [agent-natural-language-design.md](../agent-natural-language-design.md).

---

## ADR-014와의 관계 (비파괴 부분 대체·은폐 금지)

ADR-014는 **Anthropic 단일 엔드포인트**를 전제로 작성됐다. 사용자가 2026-06-14 **3제공자(Claude·OpenAI·내부 자체 모델)** 를 확정함에 따라, ADR-014의 다음 세 결정을 본 ADR이 일반화한다(ADR-014 본문은 보존하고 해당 결정 머리에 "ADR-015가 일반화" 메모 추가):

| ADR-014 결정 | 단일(Anthropic) 전제 | ADR-015 일반화 |
|---|---|---|
| ② BYO 키 보관 | Anthropic 키 1개 | **제공자별 키 N개**(`provider:apiKey` 슬롯·동일 safeStorage 패턴) — 결정 G5 |
| ⑤ 모델 2-티어 라우팅 | Claude opus/sonnet | **제공자 추상화 위의 티어 라우팅**(Claude 2-티어·OpenAI 대형/소형·내부 단일) — 결정 G7 |
| ⑧ 네트워크 경계 | `api.anthropic.com` 단일 | **3목적지(Anthropic·OpenAI·허용된 내부 호스트)** + **SSRF 방어** — 결정 G4·G8 |

ADR-014의 결정 ①③④⑥⑦은 **제공자 무지(provider-agnostic)** — 본 ADR이 도입하는 `LLMProvider` 인터페이스 뒤에서 변경 없이 동작한다. 따라서 **삭제·대체가 아니라 추상화 계층 1겹을 끼워 넣는 확장**이다.

---

## 맥락

ADR-014는 에이전트 루프를 Main `AgentOrchestrator`에 두고 `anthropic.messages.create`를 직접 호출하는 설계였다. 멀티 제공자 확정으로 다음 5개 신규 쟁점이 생긴다:

1. **제공자 추상화** — Orchestrator가 Claude·OpenAI·내부 모델 중 무엇을 쓰는지 몰라도 동일 루프가 돌아야 한다.
2. **function-calling 정규화** — Anthropic `tool_use` 블록과 OpenAI `tool_calls`(function) 포맷은 요청 도구 스키마·응답 파싱·tool_result 회신 형태가 다르다. 공통 표현으로 양방향 변환해야 한다.
3. **tool-use 미지원 모델 degradation** — 내부 OpenAI 호환 모델 중 일부는 function-calling 미지원. 조용히 오작동하지 않고 비활성/안내해야 한다(US-24.3).
4. **SSRF 방어** — 내부 모델 base URL을 사용자가 입력하므로, 화이트리스트 밖 호스트·사설망·메타데이터 IP로의 요청을 차단해야 한다(US-24.4·D8).
5. **SDK·의존성** — `@anthropic-ai/sdk`·`openai` 두 공식 SDK 추가 가부(네이티브 0 기조).

본 ADR은 이를 결정 G1~G8로 다룬다(G = generalization).

---

## 결정 G1 — 제공자 추상화 계층: **`LLMProvider` 인터페이스 + 구현체 3종** (Orchestrator는 제공자 무지)

`AgentOrchestrator`는 **`LLMProvider` 인터페이스 하나에만 의존**한다. 제공자별 SDK·엔드포인트·function-calling 포맷 차이는 인터페이스 뒤로 숨긴다.

```ts
// src/main/agent/provider/LLMProvider.ts (설계 시그니처 — 코드 아님)
export interface LLMProvider {
  readonly id: ProviderId                    // 'anthropic' | 'openai' | 'internal'
  /** function-calling(tool use) 지원 여부 — degradation 판정의 1차 근거(G3) */
  readonly capabilities: { readonly toolUse: boolean; readonly streaming: boolean }
  /**
   * 공통 메시지·공통 도구 정의를 받아 제공자 API를 호출하고,
   * 응답을 정규화된 LLMTurnResult로 반환한다(스트리밍 델타는 onDelta 콜백).
   */
  createCompletion(
    req: NormalizedCompletionReq,            // messages·tools·tier·maxTokens·signal
    onDelta: (d: ThinkingDelta) => void
  ): Promise<LLMTurnResult>                  // { text, toolCalls[], stopReason, usage }
}

export type ProviderId = 'anthropic' | 'openai' | 'internal'
export type StopReason = 'tool_use' | 'end_turn' | 'max_tokens' | 'stop' | 'error'
export interface NormalizedToolCall {        // 공통 도구 호출 표현(G2)
  readonly id: string                        // 제공자별 호출 ID(tool_result 상관용)
  readonly name: string
  readonly input: Readonly<Record<string, unknown>>
}
export interface LLMTurnResult {
  readonly text: string
  readonly toolCalls: readonly NormalizedToolCall[]
  readonly stopReason: StopReason
  readonly usage?: { readonly inputTokens: number; readonly outputTokens: number }
}
```

| 후보 | 장점 | 단점 | 판정 |
|---|---|---|---|
| **LLMProvider 인터페이스 + 팩토리(채택)** | Orchestrator·toolRegistry·scope·op 파이프 **전부 제공자 무지**(ADR-014 결정 ①③④⑥⑦ 무변)·구현체 추가로 4번째 제공자 확장·테스트 시 스텁 주입 용이(헤드리스 verify) | 인터페이스 설계·정규화 어댑터 비용 | **채택** |
| Orchestrator 내 `if (provider===...)` 분기 | 추상화 비용 0 | 루프 로직에 제공자 분기 산재·확장 시 전 분기 수정·테스트 어려움·ADR-014 루프 오염 | 비채택(응집·확장성) |
| 단일 SDK가 다 지원하길 기대(LiteLLM 류 게이트웨이) | 코드 최소 | 외부 프록시 의존·자체 네트워크 표면 추가·BYO 키 흐름 복잡·내부 모델 SSRF 통제 불가 | 비채택(의존·통제) |

- **팩토리**: `createProvider(config: ProviderConfig): LLMProvider` — `config.id`로 구현체 선택. `config`는 비-비밀(id·모델 ID·base URL)만 담고, **키는 호출 직전 `agentKeyStore`에서 복호**해 SDK 클라이언트 생성 시점에만 주입(키는 config·DTO에 없음·G5).
- **구현체 3종**: `AnthropicProvider`(`@anthropic-ai/sdk`)·`OpenAIProvider`(`openai`)·`InternalOpenAICompatProvider`(`openai` SDK의 `baseURL` 재사용 + SSRF 검증 게이트).
- Orchestrator의 루프(ADR-014 결정 ④)는 `provider.createCompletion(...)` 한 줄만 본다 → 제공자 교체는 팩토리 한 곳.

---

## 결정 G2 — function-calling 정규화 어댑터: **공통 도구 호출 표현 ↔ 제공자 포맷 양방향 변환** (핵심)

도구 정의(1벌)·도구 호출 응답·tool_result 회신을 **공통 표현**으로 두고, 제공자별 어댑터가 송신 시 제공자 포맷으로 직렬화하고 수신 시 공통으로 파싱한다.

### 3방향 포맷 매핑

| 추상(공통) | Anthropic | OpenAI / 내부(OpenAI 호환) |
|---|---|---|
| **도구 정의** `{ name, description, inputSchema(JSON Schema) }` | `tools: [{ name, description, input_schema }]` | `tools: [{ type:'function', function:{ name, description, parameters } }]` |
| **모델→도구 호출** `NormalizedToolCall{ id, name, input }` | content 내 `{ type:'tool_use', id, name, input }` 블록 | `message.tool_calls[].{ id, function:{ name, arguments(JSON 문자열) } }` |
| **도구 결과 회신** `{ callId, content, isError }` | user 메시지 `{ type:'tool_result', tool_use_id, content, is_error }` | role:`tool` 메시지 `{ tool_call_id, content }` (오류는 content에 표기) |
| **stop 이유** `'tool_use'` | `stop_reason: 'tool_use'` | `finish_reason: 'tool_calls'` |
| **stop 이유** `'end_turn'` | `stop_reason: 'end_turn'` | `finish_reason: 'stop'` |

- **JSON Schema 1벌**: `toolRegistry`(ADR-014 결정 ③)가 도구를 **JSON Schema 입력 스키마**로 단일 정의 → 어댑터가 Anthropic `input_schema` / OpenAI `function.parameters`로 직렬화. **도구 정의 산재 0**(toolRegistry 단일 출처 유지).
- **arguments 파싱 견고성(중요)**: OpenAI 계열은 `function.arguments`가 **JSON 문자열**(모델이 깨진 JSON을 낼 수 있음). 어댑터가 `JSON.parse`를 try로 감싸 실패 시 **그 도구 호출을 `is_error` tool_result로 회신**(throw 0·루프 계속). Anthropic은 파싱된 객체라 이 경로 없음.
- **멀티 tool_call 한 턴**: 두 포맷 모두 한 응답에 복수 도구 호출 가능 → 공통 표현은 `toolCalls: NormalizedToolCall[]` 배열. Orchestrator는 ADR-014 루프대로 각 호출을 read=즉시/write=stage 처리.
- **어댑터 위치**: `src/main/agent/provider/normalize/{anthropic,openai}.ts` — 순수 변환 함수(IO 없음)라 **헤드리스 verify의 핵심 대상**(양방향 라운드트립·깨진 arguments·멀티콜·stop 매핑).

> 근거: 정규화를 어댑터로 격리하면 Orchestrator 루프(ADR-014)·toolRegistry·diff·op 파이프가 **포맷 차이를 전혀 모른다**. 제공자별 차이는 순수 함수 2벌에 모이고 단위 검증된다.

---

## 결정 G3 — tool-use 미지원 degradation: **capability 선언 + 사전 probe + 명시 비활성/안내** (조용한 오작동 금지)

에이전트는 function-calling에 **전적으로 의존**(읽기자유/쓰기스테이징이 전부 도구 호출)하므로, tool-use 미지원 모델에서는 동작할 수 없다. 조용히 깨지는 대신 명시적으로 막는다(US-24.3·F40 예외).

- **판정 3단**:
  1. **정적 capability**: `AnthropicProvider.capabilities.toolUse = true`·`OpenAIProvider = true`(공식 API tool calling 지원). `InternalOpenAICompatProvider`는 **기본 미지정(unknown)**.
  2. **설정 플래그**: 내부 모델 등록 시 사용자가 "이 모델은 function-calling 지원" 플래그를 명시(기본 false=안전). vLLM/TGI 등은 모델별 상이하므로 사용자가 안다.
  3. **런타임 probe(선택·1회)**: 설정 시 또는 첫 run 전, 더미 도구 1개로 짧은 completion을 보내 `tool_calls`가 돌아오는지 확인(토큰 최소). 실패/미지원 응답이면 capability=false 캐시.
- **degradation 동작**: `toolUse=false`로 판정되면 — (a) 해당 제공자/모델로 에이전트 **run 비활성**, (b) 패널/설정에 "이 모델은 도구 호출(function-calling)을 지원하지 않아 에이전트를 쓸 수 없습니다" **명확 안내**, (c) 다른 제공자/모델 전환 유도. **텍스트만 받아 자유 텍스트 파싱으로 plan 구성하는 폴백은 비채택**(ADR-014 결정 ④의 "구조적 staged 도구 호출" 안전성을 깨뜨림 — 인젝션·파싱 오류 표면 증가).

> 근거: "동작하는 척하다 틀린 plan"보다 "명확히 못 쓴다고 안내"가 안전하다. 자유 텍스트 plan 파싱 폴백은 ADR-014의 안전 핵심(구조적 도구 호출)을 무너뜨리므로 거부.

---

## 결정 G4 — 내부 엔드포인트 SSRF 방어: **base URL 화이트리스트 + IP 리터럴/사설망 차단 + 요청 직전 Main 검증** (다단계)

내부 자체 모델 base URL은 사용자 입력이다. **화이트리스트 등록 + 매 요청 직전 재검증**의 2중 게이트로 SSRF를 차단한다(US-24.4·D8·F40).

### 검증 규칙(`src/main/agent/provider/ssrfGuard.ts` — 순수 + DNS 1지점)

| 단계 | 규칙 | 거부 사유 |
|---|---|---|
| 1. 스킬 | `https:` 권장·`http:`는 화이트리스트에 명시 등록된 호스트만 허용(루프백 로컬 개발 예외) | `file:`·`ftp:`·`gopher:` 등 거부 |
| 2. 호스트 정규화 | 소문자화·trailing dot 제거·유니코드/punycode 정규화·포트 포함 비교 | 정규화 우회(`EXAMPLE.com.`·대문자) 차단 |
| 3. **화이트리스트 매칭** | 정규화된 `host:port`가 **등록된 허용 목록과 정확 일치**해야 함(와일드카드 기본 불가) | 목록 밖 호스트 전면 거부 |
| 4. **IP 리터럴 차단** | base URL 호스트가 IP 리터럴이면: **사설망(10/8·172.16/12·192.168/16)·loopback(127/8·::1)·링크로컬(169.254/16·fe80::/10)·메타데이터(169.254.169.254·`[fd00:ec2::254]`)·0.0.0.0·멀티캐스트** 거부 | 클라우드 메타데이터·내부망 스캔 차단 |
| 5. **DNS 리바인딩 방어** | 화이트리스트 호스트가 도메인이면 요청 직전 **DNS 해석 → 해석된 모든 A/AAAA가 4단계 사설/메타 IP면 거부**(`lookup all:true`) | 외부 도메인이 사설 IP로 리바인딩되는 공격 차단 |
| 6. **리다이렉트 차단** | 내부 엔드포인트 요청은 **HTTP 리다이렉트 미추종**(`maxRedirects:0` 또는 follow 시 매 홉 1~5단계 재검증) | 화이트리스트 호스트→사설 IP 리다이렉트 차단 |

- **검증 위치(2지점)**: ① **설정 등록 시**(`agent:provider:set` 핸들러 — Main) 화이트리스트 추가 전 1~4단계 형식 검증, ② **매 요청 직전**(`InternalOpenAICompatProvider.createCompletion` 진입 — Main) 1~6단계 전부 재검증(TOCTOU·DNS 리바인딩 방지). 렌더러는 검증에 관여하지 않는다(우회 불가).
- **fetch 강제**: 내부 provider는 `openai` SDK의 커스텀 `fetch`/`httpAgent` 주입으로 위 게이트를 거치게 한다(SDK가 임의 호스트로 직접 나가지 못하게 단일 통로). Anthropic·OpenAI provider는 고정 공식 호스트라 base URL 입력 불가(SSRF 무관).
- **화이트리스트 영속**: 허용 호스트 목록은 **비-비밀**이라 세션/설정에 영속(키는 별도 safeStorage·G5). `SESSION_SCHEMA_VERSION` 무변(아래 결정 G6 한정).

| 후보 | 장점 | 단점 | 판정 |
|---|---|---|---|
| **화이트리스트 + IP/DNS 다단계(채택)** | 메타데이터·사설망·리바인딩까지 구조적 차단·등록 호스트만 통로·감사 1지점 | 사용자가 호스트 등록 필요(UX 1스텝) | **채택** |
| URL 형식 검증만(스킬+호스트 정규식) | 단순 | IP 리터럴·DNS 리바인딩·메타데이터 미차단(SSRF 구멍) | 비채택(불충분) |
| 전면 허용(임의 base URL) | UX 최소 | **SSRF 전면 노출**(D8 정면 위배) | 비채택(보안) |

---

## 결정 G5 — 키 보관 확장: **제공자별 슬롯 safeStorage** (ADR-014 결정 ② 일반화·평문/렌더러/DTO 0)

ADR-014 결정 ②(단일 Anthropic 키 safeStorage)를 **제공자별 키 N개**로 확장한다. 메커니즘·불변식은 동일.

- **슬롯 키잉**: `agentKeyStore`가 `ProviderId → 암호문` 맵을 보관(`userData/agent/keys.enc` 1파일에 제공자별 암호화 바이트, 또는 제공자별 파일). 평문은 디스크·설정·세션·로그·오류·IPC DTO 어디에도 0(컴파일 타임 — DTO에 `apiKey` 필드 부재).
- **채널 변화**: `agent:key:set`/`agent:key:has`를 `{ provider }` 인자로 일반화 → `agent:key:set { provider, apiKey }`·`agent:key:has { provider } → { has }`(또는 `agent:provider:*`로 통합 — 결정 G6).
- **복호 시점**: provider 팩토리가 `createCompletion` 직전(또는 클라이언트 생성 시) 해당 슬롯만 복호 → SDK 클라이언트에 주입. 루프·event·plan DTO에 키 없음(ADR-014 결정 ② 불변식 유지).
- **safeStorage 미가용**: ADR-007/ADR-014대로 평문 폴백 금지·메모리 전용 모드 안내.

---

## 결정 G6 — IPC 계약: **`agent:*`(run/event/confirm/cancel) + `agent:provider:*`(설정·키) 별도 그룹** (settings 확장 비채택)

제공자/키 설정 채널을 **기존 settings 확장이 아니라 `agent:provider:*` 별도 그룹**으로 둔다.

| 후보 | 장점 | 단점 | 판정 |
|---|---|---|---|
| **`agent:provider:*` 신규 그룹(채택)** | 키=Main safeStorage·SSRF 검증이 settings(렌더러 영속·세션 스냅샷)와 **신뢰 경계가 다름**·`src/main/agent/` 격리에 채널·핸들러를 모음(ESLint·감사 1지점)·DTO에 키 필드 격리 | 채널 수 증가 | **채택** |
| 기존 settings 채널 확장 | 채널 수 절약 | 비밀(키)이 settings 흐름·세션 스냅샷 직렬화에 섞일 위험·검증 지점 분산·감사 표면 확대 | 비채택(비밀 격리) |

- **채널(전부 invoke·신규)**:
  - `agent:provider:set` `{ id, modelTierConfig?, baseUrl?, supportsToolUse? }` → `Result<void>` (비-비밀 설정 — SSRF 검증·영속)
  - `agent:provider:get` `void` → `Result<{ active: ProviderConfig; available: ProviderId[] }>` (키 미포함)
  - `agent:provider:list-models` `{ id }` → `Result<{ models: ModelInfo[] }>` (제공자별·내부는 사용자 입력 ID 에코)
  - `agent:provider:probe` `{ id }` → `Result<{ toolUse: boolean }>` (G3 degradation probe)
  - `agent:key:set` `{ provider, apiKey }` → `Result<void>` (safeStorage·평문 0)
  - `agent:key:has` `{ provider }` → `Result<{ has: boolean }>` (키 미노출)
  - (ADR-014 유지) `agent:run`·`agent:event`(push)·`agent:confirm`·`agent:cancel`
- **guard**: 전부 `isTrustedSender` + `parseArgs(zod)`. `baseUrl`은 `zUrl` + SSRF 1~4단계 검증, `apiKey`는 `z.string().min(1).max(8192)`(오류 메시지에 값 미수록), `provider`는 `z.enum(['anthropic','openai','internal'])`.
- **동결 규약**: 전부 신규 채널 — **P1 동결 후 신기능 선례**(`preview:read`·`hash:*`·`queue:*`·`archive:*`·`shell:context-verbs` 등)와 동일 규약·동결 위반 아님(ADR-014 결정과 동일).

---

## 결정 G7 — 모델 라우팅: **제공자 추상화 위의 티어 라우팅** (ADR-014 결정 ⑤ 일반화)

ADR-014의 Claude 2-티어(opus/sonnet)를 **제공자별 티어 매핑**으로 일반화한다. `modelRouter`는 **티어(추상)** 를 결정하고, provider가 **티어→실모델 ID**로 해석한다.

| 추상 티어 | Anthropic | OpenAI | 내부 |
|---|---|---|---|
| `plan`(고성능·다단계 추론) | `claude-opus-4-8` | 대형 모델(설정) | 단일 모델 ID(설정) |
| `light`(요약·분류·이름 후보) | `claude-sonnet-4-6` | 소형 모델(설정) | 동일 단일 모델 |

- **modelRouter는 제공자 무지**: `route(turn, intent) → Tier`만 반환(ADR-014 결정 ⑤ 규칙 유지). Tier→모델 ID 해석은 각 provider가 `ProviderConfig`로 보유(`models.ts` 제공자별 상수 + 내부는 사용자 입력).
- **내부 단일 모델**: 티어가 1개뿐이면 `plan`·`light` 모두 같은 모델 ID로 해석(degradation 없이 동작·비용 절감 효과만 없음).
- 사용자가 "항상 light" 비용 모드 선택 가능(SG-6·후속) — 라우팅을 설정 가능하게 둔다.

---

## 결정 G8 — SDK·의존성·ESLint 격리: **`@anthropic-ai/sdk` + `openai`(둘 다 순수 JS) · `src/main/agent/`만 import 허용**

- **SDK 채택**: `@anthropic-ai/sdk`(Anthropic)·`openai`(OpenAI **및 내부 OpenAI 호환** — `baseURL` 옵션 재사용). 두 공식 SDK 모두 **순수 TypeScript/JS·네이티브 모듈 0**(fetch 기반·번들/코드서명/플랫폼 매트릭스 영향 0 — 기조 유지). 구현 착수 시 `npm ls`로 네이티브 0 재확인(전이 의존 포함). 만약 네이티브가 끼면 **fetch 직접 호출 대안**(두 API 다 단순 REST + SSE — SDK 없이도 구현 가능)으로 폴백(아래 트레이드오프).
- **내부 = `openai` SDK 재사용**: 별도 SDK 없이 `new OpenAI({ baseURL, apiKey, fetch: ssrfGuardedFetch })`. function-calling 스키마가 OpenAI 호환이므로 정규화 어댑터(G2)의 OpenAI 경로 공유.
- **ESLint 격리(ADR-007 결정 ② 동형)**: `@anthropic-ai/sdk`·`openai`·`node:https`/`node:tls`/`node:dns` import는 **`src/main/agent/`에만** 화이트리스트 허용. 그 외 main 전 경로·렌더러·domain·shared는 전면 금지(불변). `verify-eslint-remote.ts` 선례에 **`verify:eslint-agent`** 동형 추가 → 에이전트 외부 통신 표면을 단일 디렉토리에서 감사.
- **네트워크 목적지 화이트리스트**: Anthropic(`api.anthropic.com`)·OpenAI(`api.openai.com`)·**SSRF 게이트를 통과한 내부 호스트만**. 그 외 임의 송신 0(D8).

| 후보 | 장점 | 단점 | 판정 |
|---|---|---|---|
| **공식 SDK 2종(채택)** | 스트리밍·재시도·타입·tool calling 직렬화 검증됨·유지보수·내부는 openai SDK 재사용 | 의존성 2개 추가·SDK API 변경 추적 | **채택** |
| fetch 직접 호출(SDK 0) | 의존성 0·완전 통제 | SSE 파싱·재시도·tool 직렬화 자체 구현·유지보수 부담·버그 표면 | 폴백(네이티브 끼면) |
| 단일 통합 SDK(LangChain 등) | 1개로 다제공자 | 거대 의존·전이 네이티브 위험·통제 약화·내부 SSRF fetch 주입 제약 | 비채택 |

---

## 근거 (종합)

- **Orchestrator 불변·추상화 1겹**: ADR-014의 안전 핵심(Main 위치·읽기자유/쓰기스테이징·op:* 재사용·위협 모델)은 제공자와 무관 — `LLMProvider` 뒤로 제공자 차이를 가두고 루프는 무지.
- **정규화로 포맷 차이 격리**: function-calling 차이는 순수 어댑터 2벌에 모여 단위 검증(헤드리스 ✅) — diff·op 파이프는 포맷을 모른다.
- **SSRF는 화이트리스트 + IP/DNS 다단계 + 요청 직전 Main 재검증**: 메타데이터·사설망·리바인딩까지 구조적 차단. ADR-007의 "네트워크를 단일 격리 디렉토리에 가두고 ESLint 강제" 정신을 3제공자로 확장.
- **비밀 격리 유지**: 키는 제공자별 safeStorage 슬롯·`agent:provider:*` 별도 그룹·DTO/세션/로그 0(ADR-014 결정 ② 불변식 일반화).

## 트레이드오프

- **의존성 2종 추가**(`@anthropic-ai/sdk`·`openai`) — 둘 다 순수 JS 확인 전제(아니면 fetch 폴백). SDK API 변경은 provider 구현체에 흡수(`models.ts`·어댑터 단일 출처).
- **내부 엔드포인트 신뢰도 차이** — 사용자가 등록한 내부 호스트는 Anthropic/OpenAI보다 신뢰·가용성 보장이 약하고, 응답 변조·악성 tool_call 유도 가능성 존재. 완화: SSRF 게이트로 목적지 제한 + ADR-014 안전 레일(쓰기 stage·diff 게이트·경로 scope·도구 화이트리스트)이 **응답을 신뢰 못 하는 입력으로 취급**하므로, 변조된 응답도 plan에 쌓일 뿐 즉시 실행 0.
- **degradation 보수성** — tool-use 미지원 모델을 자유 텍스트 폴백 없이 비활성 → 일부 내부 모델 사용 불가. 안전(구조적 도구 호출 유지) 우선의 의도적 선택.
- **probe 비용** — capability probe가 소량 토큰 소모(BYO 키 과금). 1회 캐시·설정 플래그 우선으로 최소화.

## 결과

- 신규 모듈: `src/main/agent/provider/`(`LLMProvider.ts`·`createProvider.ts`·`AnthropicProvider.ts`·`OpenAIProvider.ts`·`InternalOpenAICompatProvider.ts`·`normalize/{anthropic,openai}.ts`·`ssrfGuard.ts`)·`agentKeyStore`(제공자별 슬롯 일반화).
- 신규 IPC 채널: `agent:provider:set`·`get`·`list-models`·`probe` + `agent:key:set`/`has`(provider 인자 일반화) — P1 동결 후 신기능 선례 동일 규약.
- 신규 npm: `@anthropic-ai/sdk`·`openai`(둘 다 순수 JS·네이티브 0 전제·착수 시 재확인). `SESSION_SCHEMA_VERSION`: 키=safeStorage·비-비밀 설정(제공자/모델/화이트리스트)이 세션 스냅샷에 추가될 수 있으나 **비파괴 옵셔널 필드 → 버전 무변 가능**(구현 시 미러 일치 확인·결정 G6).
- **ADR-014** 결정 ②⑤⑧ 머리에 "ADR-015가 멀티 제공자로 일반화" 비파괴 메모. **ADR-005·ADR-007** 본문 D7/D8 메모에 "OpenAI·내부 호스트 추가(SSRF 화이트리스트)" 갱신. ADR-000-index에 ADR-015 등록.
- `verify:eslint-agent`(신규)로 SDK·네트워크 import를 `src/main/agent/`에 격리 강제.
- 상태: **🔜 설계 완료·구현 전**(roadmap §0.5 단일 출처·product-planner/doc-sync 영역).

## 검증 전략 (헤드리스 ✅ / 🟡)

- **헤드리스 verify(✅ 목표)**: ① 정규화 어댑터 양방향(공통 도구 정의→Anthropic/OpenAI 직렬화·tool_use/tool_calls→공통 파싱·tool_result 회신·stop 매핑·깨진 arguments→is_error·멀티콜)·② SSRF guard(화이트리스트 매칭·IP 리터럴 사설/loopback/링크로컬/169.254.169.254 거부·정규화 우회 차단·DNS 리바인딩 mock·리다이렉트 0)·③ provider 팩토리 선택·capability degradation 분기·④ 키 store 제공자별 슬롯 라운드트립(스텁·평문 0)·⑤ Orchestrator가 LLMProvider 스텁으로 제공자 무지 루프 동작(실 API 없이).
- **🟡 미검증(정직 표기)**: 실 Anthropic/OpenAI/내부 API 왕복·실 모델 tool calling 품질·실 SSRF 공격(메타데이터·리바인딩 실 네트워크)·실 GUI(제공자 전환·키 입력·화이트리스트 관리·degradation 안내)·SDK 네이티브 0 실측(`npm ls`)·실 비용.

## 미해결 질문 (team-dev 구현 단계 deferral)

| # | 질문 | 1차 방향 | 후속 트리거 |
|---|---|---|---|
| **UQ-G1** | `@anthropic-ai/sdk`·`openai` 전이 의존에 네이티브가 끼는가 | 착수 시 `npm ls`·번들 검증, 끼면 fetch 직접 호출 폴백 | 설치 직후 |
| **UQ-G2** | DNS 리바인딩 방어를 매 요청 lookup으로 할 때 지연·캐시 정책 | 짧은 TTL 캐시 + 요청 직전 검증 | 실 내부 호스트 연동 시 |
| **UQ-G3** | OpenAI/내부 모델의 streaming tool_calls 조립(델타로 쪼개진 arguments) | SDK 누적 API 사용·완결 후 정규화 | OpenAI provider 구현 시 |
| **UQ-G4** | 내부 모델 capability를 설정 플래그 vs probe 중 무엇을 기본으로 | 플래그 기본 false + 선택 probe | degradation UX 확정 시 |
| **UQ-G5** | 제공자별 비-비밀 설정의 세션 영속이 `SESSION_SCHEMA_VERSION`에 미치는 영향 | 옵셔널 필드=무변 목표·구현 시 미러 검증 | 설정 영속 배선 시 |
| **UQ-G6** | OpenAI tool_result content 길이·다국어 토큰 예산(ADR-014 UQ-Z1과 연동) | 요약·절단 공통 적용 | 실 토큰 측정 후 |
