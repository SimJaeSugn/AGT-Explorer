# Explorer — 프로젝트 가이드

멀티 디렉토리 파일탐색기 (Electron + TypeScript + React, Windows). 기획·설계·구현 산출물은 `docs/` 참조.

## 하네스: 개발 워크플로 (dev-harness)

**목표:** 기획 → 설계 → 구현을 dev-harness(전역 플러그인)로 진행하고, 문서와 코드를 항상 일치시킨다.

**트리거:** 기획/설계/구현 진행 요청 시 dev-harness 스킬(`dev-harness:dev-orchestrator` 기획·설계, `dev-harness:team-dev` 구현)을 사용한다. 단순 질문은 직접 응답 가능.

### 📌 문서 동기화 게이트 (상시 — 필수)

**개발 진행 중 기획문서와 개발문서를 항상 코드와 동기화한다.** 다음 시점마다 `doc-sync` 스킬을
실행해 `doc-synchronizer` 에이전트(`subagent_type: "doc-synchronizer"`, `model: "opus"`)로
문서 상태(✅/🟡/🔜)를 실제 구현과 일치시킨다:

1. **각 구현 Phase 완료 직후** (team-dev Phase 3 루프에서 한 Phase가 QA 통과할 때마다). **동기화를 끝내기 전에는 다음 Phase로 넘어가지 않는다.**
2. **전체 통합 검증 시** (team-dev Phase 5).
3. 사용자가 "문서 동기화/상태 갱신"을 요청할 때(전체 감사).

- 동기화 대상: 기획 `docs/PRD.md`·`features.md`·`user-stories.md`·`flows.md` / 개발 `docs/roadmap.md`·`docs/architecture/traceability.md`.
- 상태의 단일 출처는 `docs/roadmap.md §0.5 진행 현황`. 나머지 문서를 여기에 맞춘다.
- 이 게이트는 **상태 표기·추적성만** 갱신한다. 요구사항/수용기준/스코프 변경은 PM→사용자 결정.
- 스코프 일탈(기획에 없는데 구현됨)·Must 미구현·문서-코드 충돌은 동기화 보고로 사용자에게 올린다.

> 절차 상세: `.claude/skills/doc-sync/SKILL.md` · 에이전트: `.claude/agents/doc-synchronizer.md`

**변경 이력:**
| 날짜 | 변경 내용 | 대상 | 사유 |
|------|----------|------|------|
| 2026-06-07 | 문서 동기화 게이트 추가 (doc-synchronizer 에이전트 + doc-sync 스킬 + CLAUDE.md 게이트) | `.claude/agents/doc-synchronizer.md`, `.claude/skills/doc-sync/`, `CLAUDE.md` | 개발 진행 중 기획·개발 문서를 코드와 항상 동기화하라는 요청 |
