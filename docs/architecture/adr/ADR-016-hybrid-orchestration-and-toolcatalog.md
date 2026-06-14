# ADR-016 — 에이전트 오케스트레이션: Plan-Execute + ReAct 하이브리드 · ToolCatalog 추상화

상태: 제안 · 2026-06-14 · **🔜 설계 완료·구현 전** (읽기 전용 Q&A 동작은 이미 구현됨 — 본 ADR은 그 **내부 오케스트레이션 리팩터**)

> **결정 종류**: 사용자 직접 결정(아키텍처 변경). **요구사항/스코프 변경 아님** — 동일한 "읽기 전용 자연어 Q&A" 능력(§Z·US-24.1·24.5)을 더 견고한 오케스트레이션으로 재구성하는 **내부 아키텍처 리팩터**다(product-planner 불요). 사용자에게 보이는 동작 변화는 §결과·사용자 영향 참조(패널 plan 단계 표시 1건 — 비파괴 옵션).

관련 ADR:
- [ADR-014 자연어 파일 에이전트](./ADR-014-agentic-natural-language-file-agent.md) — **결정 ④(tool-use 루프)·③(읽기자유/쓰기스테이징)·①(Main 신뢰 경계)·⑦(위협 모델)을 본 ADR이 비파괴 확장**(단일 ReAct → 하이브리드). ①③⑥⑦ 안전 레일은 전부 보존.
- [ADR-015 멀티 LLM 제공자 추상화](./ADR-015-multi-llm-provider-abstraction.md) — **제공자 무지(G1)·정규화(G2)·티어 라우팅(G7)** 위에서 동작. 본 ADR은 provider 계층을 건드리지 않는다(Planner·Executor 모두 `LLMProvider.createCompletion` 1개만 사용).
- [ADR-003 IPC 계약](./ADR-003-ipc-contract-style.md) — `agent:event` 단방향 스트림 비파괴 확장(신규 IPC 채널 0).
- [ADR-005 보안 모델](./ADR-005-process-security-model.md) — Main 단일 신뢰 경계·읽기 전용 도구·scope 강제 불변.

상세 컴포넌트·시퀀스·인터페이스 스펙: [agent-natural-language-design.md](../agent-natural-language-design.md)(개정 §14·§15).

---

## 맥락

현 `AgentOrchestrator.runAgentLoop`(구현됨·`src/main/agent/AgentOrchestrator.ts`)는 **단일 ReAct 루프** 1겹이다: `provider.createCompletion` → `stopReason==tool_use` 면 도구 즉시 실행·`tool_result` 회신 → 반복 → `finish`/`end_turn` 종료. 상한(턴/도구/토큰/시간·`limits.ts`)·취소(`AbortSignal`)·이벤트(thinking/tool-call/finish)는 이미 견고하다. 도구는 `toolRegistry.ts`의 `TOOLS` 맵(`ToolEntry` = `{def, mode, pathArgs, run}`)에 하드코딩되어 있고, Orchestrator는 `listToolDefs()`·`executeTool()`·`lookupTool()`·`isFinish()` **자유 함수**를 직접 import 한다.

두 가지 한계가 본 ADR의 동인이다:

1. **단일 ReAct의 다단계 추론 취약성.** 한 컨텍스트 안에서 "탐색 → 관찰 → 다음 결정"을 매 턴 즉흥적으로 한다. 다단계 질의("A 폴더에서 큰 파일 찾고, 그 종류별로 분류한 다음, B와 비교")에서 모델이 중간에 목표를 잃거나(goal drift), 불필요한 도구 호출을 반복하거나, 상한에 부딪혀 부분 답으로 끝나기 쉽다. 사용자에게 "무엇을 하려는지"가 thinking 텍스트로만 흐를 뿐 **구조화된 계획이 없다**.

2. **도구가 인터페이스로 추상화되지 않음.** Planner가 "쓸 수 있는 도구 목록·스키마"를 알려면 `listToolDefs()`를, Executor가 invoke 하려면 `executeTool()`를 각각 자유 함수로 호출한다. 도구 발견(list/describe)·실행(invoke)·메타(mode)가 한 모듈의 흩어진 export로 노출되어 있어, **Planner와 Executor가 동일한 "도구 카탈로그"를 공유한다는 계약이 타입으로 표현되지 않는다**. 헤드리스 verify에서 카탈로그를 스텁/관측하기도 불편하다(전역 `TOOLS` 맵 의존).

핵심 결정 3가지: **(A) 오케스트레이션 토폴로지**(순수 ReAct 유지 vs 순수 Plan-Execute vs 하이브리드), **(B) 도구 추상화**(`ToolCatalog` 인터페이스 도입 여부·범위), **(C) 모델 라우팅**(Planner=고티어·Executor=경량을 기존 `modelRouter` 위에서 어떻게).

---

## 결정 A — 오케스트레이션 토폴로지: **Plan-Execute + ReAct 하이브리드** (순수 ReAct·순수 Plan-Execute 비채택)

LLM이 먼저 자연어 지시를 **구조화된 추론 계획(ReasoningPlan)** = 순서 있는 스텝 목록으로 산출하고(Planner 단계), 각 스텝을 **ReAct 미니 루프**로 실행한다(Executor 단계). 스텝 실패·새 관찰·상한 근접 시 **재계획(Re-plan)** 하거나 조기 종료한다.

### 대안 비교

| 후보 | 장점 | 단점 | 판정 |
|---|---|---|---|
| **하이브리드 Plan-Execute + ReAct (채택)** | ① 다단계 질의에서 **goal drift 감소**(상위 계획이 닻 역할). ② 사용자에게 **계획 가시화**(패널에 스텝 목록·진행). ③ Planner=고티어 1회 + Executor=경량 N회로 **비용 구조 최적화**(현재 매 턴 plan/light 추론 라우팅보다 의도 명확). ④ 단순 질의는 **plan 우회**로 단일 ReAct와 동치(오버헤드 0). ⑤ 재계획 지점이 명시적이라 **루프 가드가 더 단순·예측 가능**. | 단순 질의에 plan을 강제하면 1턴 추가 지연·비용(→ plan 우회 정책으로 해소). 컴포넌트 2개(Planner/Executor)로 코드 표면 증가. | **채택** |
| 순수 ReAct 유지(현 구조) | 가장 단순(1겹 루프·이미 구현·검증됨). 단순~중간 질의에 충분. | 다단계 추론 취약(goal drift·도구 낭비)·계획 미가시화. 본 ADR 동인 ①을 해소 못 함. | 비채택(동인 미해소) — 단, **plan 우회 경로로 하이브리드 안에 흡수**(단순 질의는 사실상 순수 ReAct로 동작) |
| 순수 Plan-Execute(계획 전체를 미리 고정·스텝을 단일 도구 호출로 직매핑) | 계획이 완전히 결정적·추적 쉬움. | 읽기 탐색은 **관찰 의존적**(디렉토리 내용을 봐야 다음 경로가 정해짐)이라 사전 고정 계획이 자주 빗나감 → 잦은 전면 재계획·비효율. ReAct의 "관찰→적응" 강점 상실. | 비채택(탐색 작업과 부정합) |

### 토폴로지 (3단계)

```
ReasoningPlan(스텝 N개) ── Executor(스텝별 ReAct 미니루프) ── Re-planner(실패·관찰·상한 시)
        ▲                                                            │
        └──────────────────── 재계획 트리거 ──────────────────────────┘
```

1. **Planner 단계** — LLM이 사용자 지시 + **ToolCatalog.describe()**(쓸 수 있는 도구·스키마)를 컨텍스트로 받아 `ReasoningPlan`(스텝 목록: 각 스텝 = `{id, goal, rationale, suggestedTools?}`)을 구조화 산출한다. 산출 방식은 **전용 `plan` 도구 호출**(JSON Schema로 plan 형태 강제 — 자유텍스트 파싱보다 견고·정규화 어댑터 재사용) 또는 그것이 비현실적이면 1턴 구조화 응답. **plan 자체는 추론 계획이지 실행이 아니다** — 도구를 호출하지 않는다.
   - ⚠️ **용어 분리(혼동 방지)**: 본 ADR의 `ReasoningPlan`/`StepPlan`은 **추론 계획**이다. ADR-014의 쓰기 `PlannedOp`(파일쓰기 변경안·plan-add/plan-ready·diff 게이트·Z2/Z3)와 **완전히 별개**다. 읽기 전용 Q&A에는 `PlannedOp`가 없다. 명칭을 `ReasoningPlan`/`ReasoningStep`으로 못박아 `PlannedOp`와 겹치지 않게 한다.

2. **Executor 단계(ReAct)** — 각 `ReasoningStep`을 **독립된 ReAct 미니 루프**로 실행: reasoning(경량 모델) → `ToolCatalog.invoke()`(읽기/navigate 도구) → observation(tool_result) → 다음. 스텝은 자체 종료 신호(스텝 완료 = 모델이 도구 없이 응답하거나 `step_done` 도구 호출)로 끝난다. **현 `runAgentLoop`의 도구 디스패치 로직이 그대로 미니 루프의 본체가 된다**(executeTool→clampToolResult→is_error 처리 보존).

3. **Re-plan 정책** — 다음 트리거에서 Planner를 재호출하거나 조기 종료한다:
   - **스텝 실패**: 미니 루프가 연속 is_error N회(`MAX_STEP_TOOL_ERRORS`) 또는 스텝 미니루프 턴 상한 도달 → 남은 스텝을 현 관찰로 재계획(또는 부분 답으로 종료).
   - **새 관찰**: 스텝 결과가 계획 전제를 무효화(예: 대상 폴더 없음) → 재계획.
   - **상한 근접**: 전역 토큰/시간/도구 호출이 상한의 임계(예: 80%)에 도달 → 재계획 금지·즉시 **요약 종료**(부분 답 보존).
   - **루프 가드**: 재계획 횟수 상한 `MAX_REPLANS`(예: 2). 초과 시 마지막 plan으로 강제 종료. 동일 plan 반복 감지(plan 해시) 시에도 종료.

### Plan 우회 (단순 질의 → 바로 ReAct)

모든 질의에 plan을 강제하지 않는다. **단순 질의는 plan 단계를 건너뛰고 단일 ReAct(현 동작과 동치)로 처리**한다. 우회 판정은 보수적·결정적 규칙으로(LLM 추가 호출 없이):
- 휴리스틱(순수 함수 `shouldPlan(prompt)`): 프롬프트 길이·접속/순차 표현("그 다음", "그리고", "비교", "분류 후") 매치·복수 동사 등. **불확실하면 plan 안 함**(false negative 안전 — plan 미수립도 ReAct로 답이 나옴).
- 또는 **Planner가 "단일 스텝 plan"을 반환**하면 그것이 곧 단일 ReAct(별도 분기 불요). MVP는 휴리스틱 우회를 1차로 두고, 정밀도는 후속 튜닝(UQ).

> **단순성 우선**: 우회 경로 덕분에 하이브리드는 "단순 질의 = 현재와 동일, 다단계 질의 = plan으로 견고화"가 되어, 과설계 없이 동인만 해소한다.

---

## 결정 B — 도구 추상화: **`ToolCatalog` 인터페이스** (현 `toolRegistry`가 구현체)

도구의 **발견(describe/list)·실행(invoke)·메타(mode)** 를 단일 인터페이스 `ToolCatalog`로 추상화한다. Planner는 카탈로그로 "쓸 수 있는 도구"를 알고, Executor는 카탈로그로 invoke 한다. 현 `toolRegistry.ts`의 `TOOLS` 맵 + 자유 함수(`listToolDefs`/`executeTool`/`lookupTool`/`isFinish`)는 **이 인터페이스의 기본 구현체**(`createDefaultToolCatalog(deps)`)가 된다.

### 대안 비교

| 후보 | 장점 | 단점 | 판정 |
|---|---|---|---|
| **`ToolCatalog` 인터페이스 도입 (채택)** | Planner/Executor가 **동일 계약(타입) 공유**·도구 출처 1곳. **SDK·서비스 주입성 유지**(생성자에 backend/scope/guardPath 주입 → 헤드리스 verify가 스텁/스파이 카탈로그 주입). provider 정규화 접점 명확(`catalog.toToolDefs()` → provider tools 포맷). | 인터페이스 1겹 추가(현 자유 함수 → 메서드). 기존 호출부(AgentOrchestrator·agent.handlers) 마이그레이션 필요. | **채택** |
| 현 자유 함수 유지(전역 `TOOLS` 맵) | 변경 0. | Planner/Executor가 전역 함수에 직접 결합 → 주입·관측 불편·"카탈로그 공유" 계약이 타입에 없음. 동인 ② 미해소. | 비채택(동인 미해소) |
| 도구를 provider 계층에 흡수 | provider가 tool 포맷 알아서 처리. | 도구 실행(읽기 서비스·scope·dispatch)은 provider 무관 — 책임 혼합·ADR-015 제공자 무지 위배. | 비채택(책임 혼합) |

### 인터페이스 스펙 (설계 시그니처 — 구현은 team-dev)

```ts
// src/main/agent/ToolCatalog.ts (신규·타입+팩토리)

/** 도구 1종의 발견용 서술(스키마 포함·LLM/Planner 컨텍스트용). */
export interface ToolDescriptor {
  readonly name: string
  readonly description: string
  readonly mode: ToolMode                       // 'read' | 'write' | 'navigate' (기존 toolRegistry)
  readonly inputSchema: Readonly<Record<string, unknown>>  // JSON Schema 1벌(기존 NormalizedToolDef.inputSchema)
}

/** 도구 발견·실행·메타 추상화. Planner=describe, Executor=invoke. */
export interface ToolCatalog {
  /** 발견: 쓸 수 있는 도구 서술 목록(Planner 컨텍스트·finish/step_done 제외 옵션). */
  describe(): readonly ToolDescriptor[]
  /** provider 정규화 접점: JSON Schema 1벌 → provider tools 포맷(어댑터가 직렬화). finish 포함. */
  toToolDefs(): readonly NormalizedToolDef[]
  /** 메타 조회(미등록이면 undefined). */
  lookup(name: string): ToolDescriptor | undefined
  /** finish 종료 신호 도구인지(루프 종료 판정). */
  isFinish(name: string): boolean
  /**
   * 실행: 미등록·스코프 밖 경로·write(비활성)는 is_error 결과(throw 0).
   * 내부에서 guardPath + scope.assertInScope 재검증 후 backend 호출(현 executeTool 본체).
   */
  invoke(name: string, input: Record<string, unknown>, ctx: ToolInvokeCtx): Promise<ToolExecResult>
}

/** 카탈로그 생성 시 주입 의존(헤드리스 verify가 스텁 주입). */
export interface ToolCatalogDeps {
  readonly scope: AgentScope
  readonly guardPath: GuardPathFn
  readonly backend: ReadToolBackend            // 기존(읽기 서비스 주입)
  readonly contentConsent: boolean
  readonly locations?: AgentLocations
  readonly dispatchAction?: (a: DispatchAction) => void
}
export function createDefaultToolCatalog(deps: ToolCatalogDeps): ToolCatalog
```

- **현 `toolRegistry.ts`는 보존**: `TOOLS` 맵·`ToolEntry`·`executeTool`·`runOpenTab`·`runListLocations`는 그대로 두고, `createDefaultToolCatalog`가 이들을 **감싸는 어댑터**가 된다(`describe`=`TOOLS` 순회·`invoke`=`executeTool` 위임·`toToolDefs`=`listToolDefs`·`isFinish`=기존). 기존 자유 함수는 deprecated 주석 후 호출부 마이그레이션이 끝나면 정리(또는 호환 유지). **읽기 전용·scope·is_error 동작 1:1 보존**.
- **invoke 시 ctx 주입**: 현재 `executeTool`이 scope/guardPath/backend를 매 호출 인자로 받는 것을, 카탈로그는 **생성 시(`deps`)에 한 번 캡처**한다(run 1건 = 카탈로그 1개). `invoke`의 `ctx`는 호출별 변동분(현재 없음·향후 per-call override 여지)만 둔다. 이로써 Planner/Executor가 **scope·backend가 박힌 카탈로그 하나**를 공유한다.
- **provider 정규화 접점**: `catalog.toToolDefs()` → `normalize/{anthropic,openai}.ts`가 provider tools 포맷으로 직렬화(ADR-015 G2 그대로). 카탈로그는 포맷 무지(JSON Schema 1벌만 안다).

---

## 결정 C — 모델 라우팅: **Planner=plan 티어 · Executor=light 티어** (기존 `modelRouter` 위에서·제공자 무지)

기존 2-티어(`plan`/`light`·`modelRouter.route`·ADR-015 G7)를 **단계별 의도로 호출**한다. 새 티어·새 모델 ID 도입 0(provider 무지 유지).

| 단계 | 호출 | 티어 | 근거 |
|---|---|---|---|
| Planner | `route({turn:0, intent:'plan'})` → `'plan'` | plan(고성능·opus류) | 계획 품질이 전체 결과를 좌우 — 1회 고티어 투자. |
| Executor 미니루프 | `route({turn>0, intent:'summarize'})` → `'light'` | light(경량·sonnet류) | 스텝 실행·도구 결과 요약은 경량으로 충분·N회라 비용 민감. |
| Re-plan | `route({intent:'plan'})` → `'plan'` | plan | 재계획도 계획이므로 고티어(단 `MAX_REPLANS`로 횟수 제한). |
| Plan 우회(단순 질의) | 현 동작 유지(`route({turn})`) | 첫 턴 plan·이후 light | 변경 0. |

- **비용/지연 트레이드오프**: 현재는 첫 턴만 plan·이후 light. 하이브리드는 plan을 **명시적 1회 + 재계획 시만**으로 한정하고 실행 본체를 전부 light로 돌려 **고티어 호출을 의도가 분명한 지점에만** 집중한다. 단순 질의는 plan 우회로 추가 비용 0. 다단계 질의는 plan 1회(고티어)로 goal drift를 줄여 **불필요한 light 도구 호출 N회를 절감** → 총비용이 오히려 줄 수 있다(가설·실측은 🟡).
- `modelRouter.ts`는 이미 `intent: 'plan'|'summarize'|'name-suggest'`를 받으므로 **시그니처 변경 없이** 하이브리드가 사용. (선택) 의도 enum에 `'replan'`을 비파괴 추가할 수 있으나 MVP는 `'plan'` 재사용으로 충분.

---

## 결과 · 사용자 영향

### 보존되는 것(불변식 — ADR-014/015 안전 레일 전부)
- **읽기 전용**: 도구는 read 7종(list/search/preview/scan/dup/compare/list_locations) + navigate(open_tab) + finish. **쓰기 도구 0**·`mode==='write'`는 카탈로그 invoke에서 is_error(현 `executeTool` 방어 보존).
- **scope·guardPath·SSRF·키 보관·네이티브 0**: 카탈로그가 invoke 내부에서 guardPath + `scope.assertInScope` 재검증(현 로직 이동만). provider/ssrfGuard/agentKeyStore 무변. 신규 npm·네이티브 의존성 0.
- **`SESSION_SCHEMA_VERSION` 무변**: 에이전트 상태는 휘발(영속 0).
- **프롬프트 인젝션 내성**: plan/실행이 오염돼도 도구가 읽기/navigate뿐·scope 강제 → 즉시 안전. **plan 산출물도 신뢰 못 하는 데이터로 취급**(plan의 suggestedTools는 힌트일 뿐·Executor invoke는 항상 카탈로그 화이트리스트·scope 재검증을 통과). 오염된 plan이 만들 수 있는 최악은 "읽기 도구를 더 호출"뿐(상한이 흡수).
- 신규 IPC 채널 0 — `agent:event` 단방향 스트림 비파괴 확장만(아래).

### 상한·취소 (재정의 — `limits.ts` 단일 출처 확장)
기존 전역 상한(MAX_TURNS·MAX_TOOL_CALLS·MAX_TOKENS·MAX_WALL_MS·MAX_TOOL_RESULT_CHARS)은 **전역으로 그대로 적용**(하이브리드 전체에 누적). 추가:
- `MAX_PLAN_STEPS`(예: 8) — ReasoningPlan 스텝 수 상한(plan 산출 시 절단).
- `MAX_STEP_TURNS`(예: 6) — 스텝당 미니루프 턴 상한(스텝 무한 루프 방지·전역 MAX_TURNS와 별개·전역이 항상 우선 차단).
- `MAX_STEP_TOOL_ERRORS`(예: 3) — 스텝 내 연속 is_error 임계(재계획 트리거).
- `MAX_REPLANS`(예: 2) — 재계획 횟수 상한(루프 가드).
- `REPLAN_BUDGET_RATIO`(예: 0.8) — 전역 토큰/시간 임계 도달 시 재계획 금지·요약 종료.
- 취소(`AbortSignal`)는 Planner·Executor·Re-plan 모든 진입점에서 체크(현 패턴 확장). 진행 중 jobId(hash/grep) 취소도 그대로.

### 이벤트/계약 (비파괴 — 신규 IPC 채널 0)
`AgentEvent` 유니온(contracts.ts)에 **plan·step 변형을 비파괴 추가**(기존 변형 무변·기존 핸들러/렌더러 무영향). `OrchestratorEvent`(루프 내부)도 동형 확장:
- `{ type: 'plan'; runId; steps: ReadonlyArray<{id; goal}>; replanCount: number }` — Planner가 plan 산출/재계획 시.
- `{ type: 'step'; runId; stepId; index; total; phase: 'start'|'done'|'failed' }` — 스텝 진행.
- 기존 `thinking`/`tool-call`/`action`/`plan-ready`/`error`는 그대로(스텝 내 thinking·tool-call은 stepId 옵셔널 부기 가능·비파괴).
- **패널 표시(사용자에게 보이는 유일한 변화)**: AgentPanel이 plan 이벤트를 받으면 **스텝 목록(체크리스트)** 을 thinking 위에 표시하고, step 이벤트로 진행 표시(진행 중/완료/실패). plan 이벤트가 없으면(단순 질의·plan 우회) **현재와 동일한 UI**(스텝 표시 없음). → 비파괴·점진적.

### 마이그레이션 영향 파일 (점진·기존 동작 보존)
| 파일 | 변경 |
|---|---|
| `src/main/agent/ToolCatalog.ts` | **신규** — 인터페이스 + `createDefaultToolCatalog`(toolRegistry 감싸기) |
| `src/main/agent/toolRegistry.ts` | 보존 — 자유 함수에 deprecated 주석(카탈로그 경유 권장)·동작 무변 |
| `src/main/agent/planner.ts` | **신규** — `buildReasoningPlan(provider, catalog, prompt, ...)` 순수 골격(provider 호출 격리) |
| `src/main/agent/AgentOrchestrator.ts` | 개정 — `runAgentLoop`을 `runHybrid`(plan 우회 분기 + Planner + Executor 미니루프 + Re-plan)로 재구성. **현 단일 ReAct 본체는 Executor 미니루프 + plan 우회 경로로 재사용**(삭제 아님) |
| `src/main/agent/modelRouter.ts` | 무변(기존 intent 재사용·선택적 `'replan'` 비파괴 추가) |
| `src/main/agent/limits.ts` | 상한 상수 5종 추가(위) |
| `src/main/ipc/agent.handlers.ts` | `toAgentEvent`에 plan/step 변형 매핑 추가·`runAgentLoop`→`runHybrid` 호출(인자 동형) |
| `src/shared/ipc/contracts.ts` | `AgentEvent`에 plan/step 변형 비파괴 추가 |
| `scripts/verify-agent.ts` | 하이브리드·카탈로그·재계획 verify 케이스 추가(스텁 provider) |

### 리스크
- ① **plan 우회 오판정**: 다단계인데 단순으로 봐서 plan 미수립 → 현 동작(단일 ReAct)으로 폴백되므로 **답은 나옴**(품질만 하락). false negative 안전. 휴리스틱 튜닝은 후속.
- ② **재계획 발산**: `MAX_REPLANS` + plan 해시 반복 감지로 가드. 발산해도 전역 상한이 최종 차단.
- ③ **plan 산출 포맷 비결정**: `plan` 도구(JSON Schema 강제)로 구조화 → 깨진 arguments는 ADR-015 G2대로 is_error·1회 재시도 후 plan 우회 폴백.
- ④ **비용 증가 가능성**(단순 질의에 plan 강제 시) → plan 우회로 차단. 다단계는 절감 가설(실측 🟡).
- ⑤ **현 동작 회귀**: 마이그레이션은 "단일 ReAct 본체 = Executor 미니루프 + plan 우회"로 **기존 코드 경로를 보존**해 회귀 위험 최소화. verify로 plan 우회 경로가 현 `runAgentLoop`과 동치임을 고정.

### 검증 전략 (헤드리스 verify — `scripts/verify-agent.ts` 확장)
스텁 provider가 **plan→steps→tool_use 시퀀스**를 반환하도록 짜서:
- **plan 우회**: 단순 프롬프트 → plan 미수립·단일 ReAct 동치(현 케이스 그대로 통과).
- **하이브리드 happy path**: 스텁이 plan(스텝 2개) → 각 스텝 tool_use → step_done → finish 시퀀스 → Executor가 스텝 순서대로 카탈로그 invoke·observation 회신·종료.
- **재계획**: 스텝 미니루프가 is_error N회 → Re-plan 트리거·`MAX_REPLANS` 가드·발산 시 종료.
- **상한**: MAX_PLAN_STEPS 절단·MAX_STEP_TURNS·REPLAN_BUDGET_RATIO 임계 시 요약 종료·전역 상한 우선.
- **ToolCatalog**: `describe()`/`toToolDefs()`/`lookup()`/`isFinish()` 정확성·`invoke()`가 scope 밖 경로/미등록/write를 is_error로(현 executeTool verify 이관)·스텁 backend 주입.
- **이벤트**: plan/step 변형 emit·기존 변형 무변(라운드트립).
- **실 LLM·실 GUI(패널 스텝 표시)는 🟡**(헤드리스 범위 밖·✅위장 금지).

---

## 추적성 (이 결정 → 영향 파일 · 🔜 설계)
요구 동인은 기존 §Z(US-24.1 NL 에이전트 Plan 루프·US-24.5 읽기 도구 실행)의 **내부 오케스트레이션 품질**이다(신규 요구 0). traceability.md §1-Z 정식 갱신·roadmap §0.5 상태는 **구현 후 doc-sync** 영역(본 ADR은 architecture/ 내 설계만). 상세 매핑은 [agent-natural-language-design.md §14·§15](../agent-natural-language-design.md).

## 미해결 질문
- UQ-H1: plan 우회 휴리스틱(`shouldPlan`) 정밀도 — 규칙 기반 1차 vs Planner "단일 스텝 plan" 반환 기반. 실측 후 튜닝.
- UQ-H2: `MAX_PLAN_STEPS`/`MAX_STEP_TURNS`/`MAX_REPLANS` 기본값 — 실 워크로드로 보정(현 추정값).
- UQ-H3: plan 산출 = 전용 `plan` 도구(JSON Schema) vs 1턴 구조화 텍스트 — provider 정규화 호환성·견고성 실측.
- UQ-H4: 멀티 윈도우 동시 run 시 카탈로그/플래너 격리(현 run 1건=카탈로그 1개로 자연 격리·재확인).
- UQ-H5: 다단계 질의 비용 절감 가설의 실측(plan 1회 고티어 투자 vs 절감된 light 호출).
