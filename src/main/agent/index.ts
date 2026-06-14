/**
 * src/main/agent/ — 자연어 파일 에이전트(§Z) Main 격리 디렉토리 (자리표시)
 *
 * 설계: docs/architecture/agent-natural-language-design.md
 * 근거 ADR: ADR-014(에이전트 루프·읽기자유/쓰기스테이징·op 재사용·위협모델)
 *           ADR-015(멀티 LLM 제공자 추상화·function-calling 정규화·내부 SSRF·제공자별 키)
 *
 * 이 디렉토리는 **유일한 LLM SDK·외부 송신 특권 경계**다(.eslintrc.cjs `src/main/agent/**` override):
 *   - `@anthropic-ai/sdk`·`openai`·`node:https`/`node:tls`/`node:dns` import 는 여기서만 허용된다.
 *   - 그 외 main 전 경로·preload·renderer·domain·shared 에서는 전면 금지(remote/ 격리 모델 동형·ADR-015 G8).
 *   - 외부 송신 목적지 제한(Anthropic·OpenAI·SSRF 통과 내부 호스트만)은 코드(ssrfGuard)에서 강제한다.
 *
 * Z0 구현분(읽기 전용·쓰기 도구 0): limits·scope·toolRegistry·modelRouter·models·
 * agentKeyStore·providerConfigStore·AgentOrchestrator + provider/{LLMProvider·createProvider·
 * 3종 구현·normalize/*·ssrfGuard}. 쓰기 도구·plan 수집(Z2)·confirm/execute(Z3)·렌더러 UI(Z1)는
 * 범위 밖. 핸들러는 src/main/ipc/agent.handlers.ts(키/제공자 store 배선 + 루프 호출 골격).
 */
export * from './limits'
export * from './scope'
export * from './models'
export * from './modelRouter'
export * from './toolRegistry'
export * from './agentKeyStore'
export * from './providerConfigStore'
export * from './AgentOrchestrator'
export * from './provider/LLMProvider'
export * from './provider/createProvider'
export * from './provider/AnthropicProvider'
export * from './provider/OpenAIProvider'
export * from './provider/InternalOpenAICompatProvider'
export * from './provider/ssrfGuard'
