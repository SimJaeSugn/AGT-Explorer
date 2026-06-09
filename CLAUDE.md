# Explorer — 프로젝트 가이드

멀티 디렉토리 파일탐색기 (Electron + TypeScript + React, Windows). 기획·설계·구현 산출물은 `docs/` 참조.

## 하네스: 개발 워크플로 (dev-harness)

**목표:** 기획 → 설계 → 구현을 dev-harness(프로젝트 플러그인)로 진행하고, 문서와 코드를 항상 일치시킨다.

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
| 2026-06-08 | dev-harness 표기를 "전역 플러그인" → "프로젝트 플러그인"으로 갱신 | `CLAUDE.md` | dev-harness 플러그인을 project 스코프로 설치 |
| 2026-06-08 | doc-sync 게이트 실행: §M(에픽12 M1·M2·M3 외부연계·원격) 구현 완료·통합 QA PASS → 상태 표기 🔜→✅ 동기화(실 동작 런타임 스모크 🟡 정직 구분·verify 누계 ~1015) | `docs/roadmap.md §0.5·§3-M·§4`, `docs/PRD.md §M·§6`, `docs/features.md §M`, `docs/user-stories.md 에픽12`, `docs/flows.md F14~F16`, `docs/architecture/traceability.md §1-M` | §M 구현 완료·QA PASS 후 문서-코드 상태 동기화 |
| 2026-06-08 | doc-sync 게이트 실행: §N(에픽13 N1 즐겨찾기 경로 워터마크·N2 즐겨찾기 드래그 정렬) 구현 완료·통합 QA PASS → 상태 표기 🔜→✅ 동기화(실 GUI 동작 런타임 스모크 🟡 정직 구분·렌더러 전용·신규 채널 0·키 `Alt+Shift+↑/↓` PRD §8 정합·핵심 verify 302/0) | `docs/roadmap.md §0.5`, `docs/PRD.md §6·§8`, `docs/features.md §N`, `docs/user-stories.md 에픽13`, `docs/flows.md F17~F18`, `docs/architecture/traceability.md §1-N·§2` | §N 구현 완료·QA PASS 후 문서-코드 상태 동기화 |
| 2026-06-09 | doc-sync 게이트 실행(ref.md 3건): ① §M 결함 수정 2건(M3 원격 디렉토리 더블클릭 ENOENT·M1 외부 드래그 오버레이 잔존) → **직전 "§M 코드 정합 ✅"의 ✅위장 드리프트 정직 정정**·코드 정합 회복(실 동작 🟡 유지·신규 스코프 아님), ② **비계획 구현 "파일/폴더 상단 고정(pin)" 스코프 일탈로 플래그**(기획문서 정식 추가 안 함·MoSCoW 무변경·roadmap §0.5 개발현황에만 사실 기록·PM/사용자 정식 편입 결정 대기). 기준일 6개 문서 2026-06-09 통일·verify 누계 ~1015→~1040(domain 60·store 121·persistence 101) | `docs/roadmap.md §0.5(추가 2026-06-09)`, `docs/PRD.md 헤더·변경이력`, `docs/features.md 배너`, `docs/user-stories.md 헤더·에픽12`, `docs/flows.md 헤더`, `docs/architecture/traceability.md §1-M` | §M 결함 수정 후 ✅위장 드리프트 정정 + pin 비계획 구현 스코프 일탈 플래그 |
| 2026-06-09 | doc-sync 게이트 실행(ref.md 동작 변경 2건): ① **§O 상단 고정 "정렬 최상단"→"스크롤 고정(sticky)"**(목록/자세히 전용·그리드는 정렬 상단 유지·`FileListView.tsx` sticky 밴드·키보드 보정·`sort.ts#applyPins`·selectors 불변=렌더 계층), ② **원격 주소창 경로-only 입력**(§M M3 / H5 교차·`PanelToolbar.tsx` 호스트 프리픽스 고정·`navigate.ts` 원격 URI validate-path 우회). 상태 단일 출처 roadmap §0.5·§1 요약표 §O 행·§3-M MP5 부기 갱신 → product-planner(기획 4종)·chief-architect(traceability §1-O·§1-M·§1-H) 반영분과 정합. **상태 "구현 완료(코드)·실 GUI 런타임 스모크 🟡" 유지(✅위장 금지)**·신규 채널 0·신규 의존성 0·렌더러 계층·**verify 누계 ~1040 불변·회귀 0**(domain 60·store 121·persistence 101·perf 25·remote-route 47). 6개 문서 기준일 2026-06-09 통일·모순 0 | `docs/roadmap.md §0.5·§1·§3-M`, `docs/PRD.md §O`, `docs/features.md §O1·§H5`, `docs/user-stories.md 에픽14·US-7.5/12.4`, `docs/flows.md F19·F16`, `docs/architecture/traceability.md §1-O·§1-M·§1-H` | ref.md 동작 변경 2건 구현·검증 후 문서-코드 상태 동기화 |
| 2026-06-09 | doc-sync 게이트 실행: **§O pin 정식 편입 상태 동기화** — 직전(2026-06-09) "스코프 일탈 플래그" 였던 파일/폴더 상단 고정(pin)이 **사용자 정식 편입 결정 → product-planner가 PRD §6 Should·features §O(O1)·user-stories 에픽14(US-14.1)·flows F19 정식 편입 + chief-architect traceability §1-O 매핑** 됨에 따라, 상태의 단일 출처 roadmap §0.5(추가 줄 정정 + §1 요약표 §O·§N 행 추가 + 헤더 §O 추가)를 "정식 편입 완료·구현 완료(코드)·실 GUI 런타임 스모크 🟡"로 갱신. 전 문서 §O 상태/범례/기준일(2026-06-09) 정합 확인(모순 0)·verify 60/121/101 재확인·traceability §1-O 유령 매핑 0 교차 확인. **스코프/MoSCoW 문구 무변경(product-planner 확정 유지)·상태표기/추적성만.** | `docs/roadmap.md §0.5·§1 요약표·헤더`, (정합 확인) `docs/PRD.md §6·§6 근거`, `docs/features.md §O`, `docs/user-stories.md 에픽14·백로그표`, `docs/flows.md F19`, `docs/architecture/traceability.md §1-O` | pin 정식 편입 결정 후 roadmap 단일 출처 상태 동기화 + 전 문서 정합 |
