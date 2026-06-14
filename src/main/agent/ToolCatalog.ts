/**
 * src/main/agent/ToolCatalog.ts — 도구 발견·실행·메타 추상화 인터페이스(ADR-016 결정 B·design §15).
 *
 * 도구의 **발견(describe/toToolDefs)·실행(invoke)·메타(lookup/isFinish)** 를 단일 인터페이스로
 * 추상화한다. Planner=describe(쓸 수 있는 도구 서술)·Executor=invoke(읽기/navigate 실행)·
 * provider 정규화=toToolDefs. 현 `toolRegistry.ts`(`TOOLS` 맵·`executeTool`·`runOpenTab`·
 * `runListLocations`)가 `createDefaultToolCatalog`로 감싸여 구현체가 된다(읽기 전용·scope·is_error
 * 1:1 보존).
 *
 * **보존 불변식(ADR-014/015 안전 레일)**: 읽기 전용(쓰기 도구 0·mode==='write'→is_error)·
 * scope·guardPath 재검증·SSRF·키 safeStorage·네이티브 0·`SESSION_SCHEMA_VERSION` 무변. 카탈로그는
 * scope/backend/guardPath/contentConsent/locations/dispatchAction 을 **생성 시 1회 캡처**한다
 * (run 1건 = 카탈로그 1개 → 멀티 윈도우 동시 run 자연 격리·UQ-H4). invoke 인자는 호출별 변동분만.
 *
 * 순수 어댑터(IO·SDK·electron import 0 — toolRegistry 위임만) → 헤드리스 verify 가 스텁 backend·
 * 스텁 scope·스파이 dispatchAction 을 주입해 카탈로그 단위로 검증한다.
 */
import type { AgentLocations } from '@shared/ipc/contracts'
import type { NormalizedToolDef } from './provider/LLMProvider'
import type { AgentScope } from './scope'
import {
  EMPTY_LOCATIONS,
  executeTool,
  isFinish as isFinishTool,
  listToolDefs,
  lookupTool,
  type DispatchAction,
  type GuardPathFn,
  type ReadToolBackend,
  type ToolExecResult,
  type ToolMode,
  type ToolProgress
} from './toolRegistry'

/** 도구 1종의 발견용 서술(스키마 포함·Planner/LLM 컨텍스트용). */
export interface ToolDescriptor {
  readonly name: string
  readonly description: string
  /** 'read' | 'write' | 'navigate' (기존 toolRegistry ToolMode). */
  readonly mode: ToolMode
  /** JSON Schema 1벌(기존 NormalizedToolDef.inputSchema). */
  readonly inputSchema: Readonly<Record<string, unknown>>
}

/** invoke 의 호출별 변동 컨텍스트(현재 비어있음·향후 per-call override 여지). */
export interface ToolInvokeCtx {
  /** 예약(현재 사용 안 함) — 시그니처 안정성용 placeholder. */
  readonly _?: never
}

/** 도구 발견·실행·메타 추상화. Planner=describe·Executor=invoke·provider 정규화=toToolDefs. */
export interface ToolCatalog {
  /**
   * 발견: 쓸 수 있는 도구 서술 목록(Planner 컨텍스트). finish/step_done 같은 제어 도구는 제외
   * (실제 IO/navigate 도구만 — Planner 가 "탐색·식별·열기 전략"을 세우게).
   */
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
   * scope/backend/guardPath/contentConsent/locations/dispatchAction 은 생성 시 캡처됨.
   */
  invoke(name: string, input: Record<string, unknown>, ctx?: ToolInvokeCtx): Promise<ToolExecResult>
}

/** 카탈로그 생성 시 주입 의존(헤드리스 verify 가 스텁 주입·run 1건 = 카탈로그 1개). */
export interface ToolCatalogDeps {
  readonly scope: AgentScope
  readonly guardPath: GuardPathFn
  /** 기존(읽기 서비스 주입·verify 스텁). */
  readonly backend: ReadToolBackend
  readonly contentConsent: boolean
  readonly locations?: AgentLocations
  readonly dispatchAction?: (a: DispatchAction) => void
  /**
   * §Z 장시간 도구(트리 워크) 진행 보고(프리징 완화). 캡처되면 invoke 시 backend(search) 어댑터가
   * 스로틀된 진행을 보고하고, 오케스트레이터가 tool-progress 이벤트로 중계한다. 미캡처 시 진행 보고 0.
   */
  readonly onToolProgress?: (p: ToolProgress) => void
}

/** finish 제어 도구명(describe 에서 제외). step_done 도입 시 여기에 추가. */
const CONTROL_TOOL_NAMES: ReadonlySet<string> = new Set(['finish'])

/**
 * 기본 ToolCatalog 구현체 — 현 `toolRegistry`(TOOLS 맵·executeTool)를 감싸는 어댑터.
 * deps 를 생성 시 1회 캡처해 Planner/Executor 가 scope·backend 가 박힌 카탈로그 하나를 공유한다.
 */
export function createDefaultToolCatalog(deps: ToolCatalogDeps): ToolCatalog {
  return {
    describe(): readonly ToolDescriptor[] {
      // listToolDefs() 는 finish 포함 — Planner 컨텍스트에선 제어 도구를 빼고
      // 각 도구의 mode(read/navigate)를 lookup 으로 덧붙인다.
      const out: ToolDescriptor[] = []
      for (const def of listToolDefs()) {
        if (CONTROL_TOOL_NAMES.has(def.name)) continue
        const entry = lookupTool(def.name)
        if (!entry) continue
        out.push({
          name: def.name,
          description: def.description,
          mode: entry.mode,
          inputSchema: def.inputSchema
        })
      }
      return out
    },
    toToolDefs(): readonly NormalizedToolDef[] {
      return listToolDefs()
    },
    lookup(name: string): ToolDescriptor | undefined {
      const entry = lookupTool(name)
      if (!entry) return undefined
      return {
        name: entry.def.name,
        description: entry.def.description,
        mode: entry.mode,
        inputSchema: entry.def.inputSchema
      }
    },
    isFinish(name: string): boolean {
      return isFinishTool(name)
    },
    invoke(name: string, input: Record<string, unknown>): Promise<ToolExecResult> {
      // 캡처된 deps 로 executeTool 위임 — guardPath+assertInScope·write→is_error 전부 보존.
      return executeTool(name, input, {
        backend: deps.backend,
        scope: deps.scope,
        guardPath: deps.guardPath,
        contentConsent: deps.contentConsent,
        locations: deps.locations ?? EMPTY_LOCATIONS,
        ...(deps.dispatchAction ? { dispatchAction: deps.dispatchAction } : {}),
        ...(deps.onToolProgress ? { onToolProgress: deps.onToolProgress } : {})
      })
    }
  }
}
