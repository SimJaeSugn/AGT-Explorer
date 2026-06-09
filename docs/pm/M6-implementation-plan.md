# M6 파워 기능 — 코드베이스 수준 세부 구현 계획 (~~T3~~ · R1 · P1 메타)

> **⚠️ 폐기 주석(2026-06-09 사용자 결정):** 본 계획의 **T3 정렬/필터 프리셋 부분은 폐기됨(2026-06-09).** T3은 구현 완료(코드)됐다가 사용자 결정으로 전면 제거됐다(`domain/rules/filterComposition.ts`·`presetsSlice`·`usecases/presets`·`ui/preset/*`·`FilterPreset` DTO 삭제·`computeVisible`→`filterEntries` 환원·`SESSION_SCHEMA_VERSION` 2→1 환원). 아래 T3 관련 절(§0.2/§0.3 T3 열·§1-T3·§3·§4 세션 영속·§8 T3 DoD 등)은 **이력으로만 보존**(상태=폐기). R1·P1 부분은 유효(구현 완료).
> 작성: 테크리드 · 2026-06-09 · 브랜치 `feature/power-features` · 상태: **R1·P1 구현 완료 · T3 폐기(2026-06-09)**
> 설계 단일 출처: [ADR-009 해시·비교 엔진](../architecture/adr/ADR-009-hash-and-compare-engine.md) · [ADR-012 메타 영속·필터 합성](../architecture/adr/ADR-012-metadata-persistence-and-filter-composition.md) · [system-architecture §5-PU](../architecture/system-architecture.md) · [software-architecture §13·§14](../architecture/software-architecture.md) · [directory-structure §8](../architecture/directory-structure.md) · [traceability §1-P·§1-R·§1-T](../architecture/traceability.md)
> 기획 수용기준: [features §P/§R/§T](../features.md) · [user-stories US-15.1·US-17.1·US-19.3](../user-stories.md) · [flows F20·F22·F30](../flows.md)
>
> **목적**: PM이 개발자 에이전트를 순차 호출해 구현할 수 있도록, M6 3기능을 ① 만들/고칠 파일 경로, ② 핵심 시그니처, ③ 채널 유무 판정, ④ 도메인 순수 규칙, ⑤ 세션 영속 확장, ⑥ UI 진입점·단축키, ⑦ undo 연계, ⑧ verify 항목, ⑨ 구현 순서·DoD로 확정한다. **본 문서는 코드를 생성하지 않는다 — 실행 계획만.**
>
> **상주 팀 없음**: TeamCreate/SendMessage 미사용. PM이 개발자 에이전트를 **기능 단위로 순차 호출**한다. 따라서 본 계획은 **T3 / R1 / P1 각각이 단일 개발자가 독립 구현 가능한 단위**로 쪼갰다. 기능 간 공통 변경점은 §0.2에 명시(공유 파일 충돌 최소화).

---

## 0. 공통 규약·명명·공유 변경점

### 0.1 불변 규칙 (전 기능 공통)
- 기존 코드/문서 **비파괴**. 설계 계약 임의 변경 금지.
- 도메인 순수 규칙(`domain/rules/*`)은 **react/zustand/infra/shared-ipc import 금지**(`.eslintrc` 경계). 입력은 DTO·플레인 객체, 출력은 새 객체(부수효과 0).
- **ADR-003 throw0/Result**: 신규 IPC 핸들러가 생긴다면 `Result<T, FileOpError>`·sender 검증·zod·`guardPath` 필수. **M6 3기능은 신규 채널 0 목표**(§2 판정).
- **계약 단일 출처**: DTO는 `src/shared/dto/index.ts`, 세션 영속 스키마/coerce는 `src/main/persistence/defaults.ts` + `src/renderer/domain/session/index.ts`(버전 미러).
- **ADR-005 보안**: M6는 모두 **렌더러 + 세션 영속**(P1 메타 비교 포함 — 이미 로드된 양 패널 entries 비교). 신규 네트워크/실행/파일 접근 표면 0.

### 0.2 공유(공통) 변경 파일 — 충돌 주의 지점
| 파일 | T3 | R1 | P1 | 충돌 회피 |
|---|---|---|---|---|
| `src/shared/dto/index.ts` | `FilterPreset`·`PresetSort`·`PresetFilter` 추가 | — | `CompareStatus`·`ComparePairDTO`·`CompareSummary`(렌더러 표시용 순수 타입) 추가 | 서로 다른 블록에 **append만**(기존 타입 무변경). T3 먼저 → P1이 그 아래 추가 |
| `src/renderer/app/usecases/selectors.ts#computeVisible` | 필터 합성 함수로 교체(`filterComposition.matches`) | — | (비교 패널은 별도 셀렉터 — computeVisible 미변경) | **T3가 단독 변경**. P1은 건드리지 않음 |
| `src/renderer/domain/keybindings/index.ts` | (없음 — 프리셋은 메뉴/UI 진입) | `ctrl+shift+r`→`file.batchRename`(신규) | (없음 — 비교는 명령/버튼 진입) | R1만 1줄 추가. 충돌 없음 |
| `src/renderer/app/usecases/commandBus.ts` | `preset.save`/`preset.apply` 라우팅(선택) | `file.batchRename`→`openBatchRename` | `compare.toggle`/`compare.run` 라우팅(선택) | switch case append만 — 서로 다른 case |
| `src/renderer/app/stores/rootStore.ts` | `createPresetsSlice` 등록 | — | `createCompareSlice` 등록 | 슬라이스 등록 1줄씩(append) |
| `src/renderer/app/usecases/contextMenu.ts` | (선택) "이 보기를 프리셋으로 저장" | "고급 이름변경…"(2+ 선택 시) | "다른 패널과 비교"(폴더 빈영역) | 서로 다른 메뉴 항목 |
| `src/main/persistence/defaults.ts` | `coerceFilterPresets` + `defaultSession`/`coerceSession`에 `filterPresets` 1필드 | — | — | **T3 단독**. P1·R1은 영속 0 |

> **순차 구현이므로 충돌은 거의 없다.** 단 `dto/index.ts`·`commandBus.ts`·`rootStore.ts`는 3기능 모두 소폭 append → **T3 → R1 → P1 순서로 진행**하면 뒤 기능이 항상 최신 파일 위에 추가(merge 불요).

### 0.3 명명 단일 출처 표
| 영역 | T3 | R1 | P1 |
|---|---|---|---|
| 도메인 순수 | `domain/rules/filterComposition.ts` | `domain/rules/batchRename.ts` | `domain/rules/compare.ts` |
| store | `app/stores/presetsSlice.ts` | (없음 — 다이얼로그 로컬 state + undoSlice) | `app/stores/compareSlice.ts` |
| usecase | `app/usecases/presets.ts` | `app/usecases/batchRename.ts` | `app/usecases/compare.ts` |
| UI | `ui/preset/*` | `ui/rename/BatchRenameDialog.tsx` | `ui/compare/*` |
| DTO | `FilterPreset` 등 | (없음) | `CompareStatus`·`ComparePairDTO`·`CompareSummary` |
| 채널 | **0** | **0** | **0** |
| 의존성 | **0** | **0** | **0** |

---

## 1. 기능별 신규/수정 파일 + 핵심 시그니처

### ~~1-T3. 정렬/필터 프리셋 (US-19.3 · §T · F30 · ADR-012)~~ — ❌ 폐기됨(2026-06-09 사용자 결정·코드 전면 제거)

> 아래 신규 파일·변경·세션 영속 계획은 구현됐다가 2026-06-09 사용자 결정으로 전면 제거됐다. 이력으로만 보존.

**신규 파일**
- `src/renderer/domain/rules/filterComposition.ts` — 복수 필터 합성(차원 간 AND·차원 내 OR, ADR-012 결정②). 순수.
  ```ts
  /** 활성 필터 차원(빈/미설정이면 그 차원 비활성). */
  export interface ActiveFilters {
    readonly query?: string                 // D1 이름 검색(부분 일치, 단일)
    readonly extPatterns?: readonly string[]// D2 확장자/이름 패턴(복수=OR)
    readonly tagColors?: readonly TagColor[]// T1 태그(복수=OR) — M6는 항상 비활성(M8에서 채움)
    readonly diffOnly?: boolean             // P1 차이만 보기 — M6는 비교 패널에서만 의미(아래 주석)
  }
  /** 한 항목이 모든 활성 차원을 통과(AND)하는가. 차원 내 다중 값은 OR. */
  export function matches(entry: FileEntryDTO, f: ActiveFilters): boolean
  /** 활성 차원이 하나라도 있는지(상태바·메모 키용). */
  export function hasActiveFilter(f: ActiveFilters): boolean
  ```
  - `query`는 기존 `filter.ts#matchesQuery` 재사용(중복 구현 금지 — import). `extPatterns`는 `filter.ts#globToRegExp` 재사용.
  - **M6 스코프 한계(정직)**: `tagColors`는 M8(T1) 전까지 항상 비어 있음 → 차원 비활성. `diffOnly`는 **비교 패널 전용**이며 일반 패널 computeVisible에서는 미사용(아래 selectors 변경 참조). filterComposition은 M6에 **query+extPatterns 차원만 실제 작동**하되 인터페이스는 4차원 전부 수용(M8/P1 확장 무변경).

- `src/renderer/app/stores/presetsSlice.ts` — 프리셋 목록(전역)·CRUD.
  ```ts
  export interface PresetsSlice {
    readonly filterPresets: FilterPreset[]   // 순서 보존
    addPreset(name: string, sort: PresetSort, filter: PresetFilter): void  // id 자동 발급
    applyPreset(id: string, panelId: string): void  // 활성 패널 sort/filter 세팅(교체식)
    renamePreset(id: string, name: string): void
    removePreset(id: string): void
    hydratePresets(list: FilterPreset[]): void  // 세션 복원
  }
  ```
  - `applyPreset`은 내부에서 `panelsSlice.setSort`류 + `setSearchOpen/Query` + (확장 필터 필드) 세팅을 호출 → **활성 필터 교체**(ADR-012 결정② "프리셋 동시 적용 미지원"). id는 `crypto.randomUUID()` 또는 기존 id 생성 헬퍼.

- `src/renderer/app/usecases/presets.ts` — UI ↔ slice 브리지(현재 패널의 sort/filter를 PresetSort/PresetFilter로 캡처해 addPreset 호출).
  ```ts
  export function captureCurrentAsPreset(panelId: string, name: string): void
  export function applyPresetToActive(id: string): void
  ```

- `src/renderer/ui/preset/PresetBar.tsx`(또는 toolbar 드롭다운) — 프리셋 목록 표시·적용·"현재 보기 저장" 버튼.
- `src/renderer/ui/preset/PresetManageDialog.tsx` — 이름변경·삭제 관리(focus trap·Esc, 기존 dialog 패턴).

**수정 파일**
- `src/renderer/app/stores/panelsSlice.ts` — `FilterState`에 필터 차원 확장 필드 추가(비파괴):
  - `filter`에 `extPatterns?: string[]`·`tagColors?: TagColor[]`·`diffOnly?: boolean` 추가(현재는 `{query, open}`만). M6는 `extPatterns`까지만 UI로 노출 가능(또는 query만 유지하고 프리셋 적용 시에만 세팅). **최소안: filter에 `preset`이 세팅한 차원 값을 그대로 담는다.**
  - `applyPanelState`(세션 복원)는 filter 복원 안 함(휘발 — 기존과 동일). 프리셋만 영속.
- `src/renderer/app/usecases/selectors.ts#computeVisible` — `filterEntries(entries, query)`를 `entries.filter(e => matches(e, activeFilters))`로 교체. 메모 슬롯 키에 `extPatterns`(참조 또는 직렬화)·`diffOnly` 추가. **query만 있던 기존 동작과 정확히 동치**(extPatterns/tagColors 비었을 때 query만 평가)를 verify로 보장.
- `src/renderer/domain/entities/index.ts` — `FilterState` 인터페이스에 위 옵셔널 필드 추가(타입).
- `src/shared/dto/index.ts` — `FilterPreset` 등 추가(§3).
- `src/main/persistence/defaults.ts` — `coerceFilterPresets` + `coerceSession`/`defaultSession`에 `filterPresets`(§4).
- `src/renderer/app/usecases/session.ts#buildSessionSnapshot`/`applySnapshot` — `filterPresets` 직렬화·복원(§4).
- `src/renderer/app/stores/rootStore.ts` — `createPresetsSlice` 등록.
- (선택) `src/renderer/app/usecases/contextMenu.ts` — 빈영역 메뉴에 "이 보기를 프리셋으로 저장".

---

### 1-R1. 고급 일괄 이름변경 (US-17.1 · §R · F22)

**신규 파일**
- `src/renderer/domain/rules/batchRename.ts` — 규칙→이름 매핑 + 충돌 검사. 순수.
  ```ts
  export interface BatchRenameRule {
    readonly find?: string            // 찾기(빈=미적용)
    readonly replace?: string         // 바꾸기
    readonly useRegex?: boolean       // find를 정규식으로
    readonly prefix?: string          // 접두
    readonly suffix?: string          // 접미(확장자 앞)
    readonly seq?: {                  // 연번
      readonly enabled: boolean
      readonly start: number          // 시작 번호
      readonly step: number           // 증가
      readonly pad: number            // 0패딩 자릿수
      readonly position: 'prefix' | 'suffix'
    }
    readonly caseMode?: 'none' | 'upper' | 'lower' | 'title'  // 대소문자 변환
    readonly applyToExt?: boolean     // 확장자 포함 적용 여부(기본 false=베이스명만)
  }
  export interface RenamePreviewRow {
    readonly path: string             // 원본 절대경로
    readonly oldName: string
    readonly newName: string
    readonly changed: boolean
    readonly error: RenameRowError | null  // 'invalid-char'|'reserved'|'empty'|'dup-internal'|'dup-existing'
  }
  /** 대상 목록 + 규칙 → 미리보기 행(순서 보존·연번은 입력 순서대로). */
  export function computeBatchRename(
    targets: readonly { path: string; name: string; isDir: boolean }[],
    rule: BatchRenameRule,
    existingNamesInDir: ReadonlySet<string>   // 같은 폴더 내 비대상 기존 이름(충돌검사)
  ): RenamePreviewRow[]
  /** 적용 가능 여부(에러 행 0). */
  export function isApplicable(rows: readonly RenamePreviewRow[]): boolean
  ```
  - **충돌 검사 2종**: ① 변경 후 이름끼리 서로 충돌(dup-internal), ② 같은 폴더 내 비대상 기존 항목과 충돌(dup-existing). 금지문자/예약명(`CON`,`PRN`,`AUX`,`NUL`,`COM1..9`,`LPT1..9`)/빈 이름은 **B3 규칙 재사용**(기존 검증 로직을 domain으로 추출 또는 fileOps의 `nameOpErrorMessage`와 정합). 대소문자 무시 비교(Windows 파일시스템).
  - 정규식 실패(컴파일 에러)는 throw 금지 → 해당 규칙 비적용 + 전 행 error 없이 원본 유지(또는 상단 경고 플래그 반환). **ReDoS 완화**: 사용자 정규식은 신뢰 못 함 → 행 단위 적용·간단 타임가드(M6는 파일명 단위라 입력 짧음·1차 단순).

- `src/renderer/app/usecases/batchRename.ts` — 다이얼로그 진입·실행 브리지.
  ```ts
  export function openBatchRename(): void   // 활성 패널 2+ 선택 → 다이얼로그 open(uiSlice 플래그)
  /** 적용: rows를 fs:rename 반복 실행 + undo 한 묶음 push. 충돌 회피 2단계 rename. */
  export async function applyBatchRename(panelId: string, rows: RenamePreviewRow[]): Promise<void>
  ```
- `src/renderer/ui/rename/BatchRenameDialog.tsx` — 규칙 입력 폼·실시간 미리보기 표(old→new·충돌 강조)·적용/취소. focus trap·Esc(기존 dialog 패턴 재사용).

**수정 파일**
- `src/renderer/app/stores/uiSlice.ts` — `batchRenameOpen: boolean` + `openBatchRename()`/`closeBatchRename()`(기존 `trashOpen` 등과 동형·전역 단축키 가드 합류).
- `src/renderer/domain/keybindings/index.ts` — `{ chord:'ctrl+shift+r', commandId:'file.batchRename', context:'list', label:'고급 일괄 이름변경', group:'파일' }`(충돌 점검 §5).
- `src/renderer/app/usecases/commandBus.ts` — `case 'file.batchRename': openBatchRename(); return true`.
- `src/renderer/app/usecases/contextMenu.ts` — 다중 선택(2+) 시 "고급 이름변경…" 항목(단일 선택은 기존 F2 인라인 유지).
- `src/renderer/app/stores/undoSlice.ts` — **`UndoEntry`에 `kind:'batchRename'` 추가**(§6).
- `src/renderer/app/usecases/undo.ts` — `undoBatchRename` 분기 추가(§6).

---

### 1-P1. 듀얼 패널 폴더 비교 — 메타 비교만 (US-15.1 · §P · F20 · ADR-009)

> **M6 스코프**: 이름·크기·수정일 **메타 4상태 분류**만. 해시(내용) 비교는 M7. 비교 대상은 **이미 로드된 양 패널의 `directory.entries`**(좌/우) → **신규 채널 0**(§2 판정). 미러 실행은 기존 `op:*` 재사용.

**신규 파일**
- `src/renderer/domain/rules/compare.ts` — 4상태 분류·짝지음. 순수.
  ```ts
  export type CompareStatus = 'left-only' | 'right-only' | 'diff' | 'same'
  export interface ComparePair {
    readonly name: string                 // 짝지음 키(이름 기준·대소문자 무시)
    readonly left: FileEntryDTO | null
    readonly right: FileEntryDTO | null
    readonly status: CompareStatus
  }
  export interface CompareOptions {
    readonly bySize: boolean              // 크기 비교(기본 true)
    readonly byMtime: boolean             // 수정일 비교(기본 true)
    readonly mtimeToleranceMs?: number    // 수정일 허용 오차(파일시스템 정밀도 차이·기본 2000ms)
    readonly caseSensitive?: boolean      // 이름 매칭 대소문자(기본 false=Windows)
  }
  /** 좌/우 entries → 이름으로 짝지어 4상태 분류한 정렬된 페어 목록. */
  export function compareEntries(
    left: readonly FileEntryDTO[],
    right: readonly FileEntryDTO[],
    opts: CompareOptions
  ): ComparePair[]
  export interface CompareSummary {
    readonly leftOnly: number; readonly rightOnly: number
    readonly diff: number; readonly same: number; readonly total: number
  }
  export function summarize(pairs: readonly ComparePair[]): CompareSummary
  /** 동기 스크롤용: 페어 목록을 같은 행 인덱스로 정렬(짝 없는 쪽은 placeholder). UI가 소비. */
  ```
  - **분류 규칙**: 양쪽 모두 존재 → `bySize && left.size!==right.size`이거나 `byMtime && |mtime차|>tolerance`이면 `diff`, 아니면 `same`. 한쪽만 → `left-only`/`right-only`. 폴더 vs 파일 동명 충돌도 `diff`. **순수·헤드리스 verify 대상**(Main compareEngine은 M7에서 도입, M6는 렌더러 순수 규칙만으로 메타 비교 완결).

- `src/renderer/app/stores/compareSlice.ts` — 비교 모드·결과·동기 스크롤·필터.
  ```ts
  export interface CompareSlice {
    readonly compareActive: boolean       // 비교 모드 on/off(탭/패널 페어 단위)
    readonly comparePairs: ComparePair[]
    readonly compareSummary: CompareSummary | null
    readonly compareDiffOnly: boolean     // "차이만 보기"(left-only/right-only/diff만)
    readonly syncScroll: boolean          // 동기 스크롤 토글
    readonly compareOptions: CompareOptions
    runCompare(leftPanelId: string, rightPanelId: string): void  // 양 패널 entries로 즉시 계산
    clearCompare(): void
    toggleDiffOnly(): void
    toggleSyncScroll(): void
  }
  ```
- `src/renderer/app/usecases/compare.ts` — 비교 시작·미러 미리보기·실행 브리지.
  ```ts
  export function startCompare(): void   // 2분할(좌/우 패널)에서 양 패널 entries로 runCompare
  /** 미러 미리보기: 좌→우 또는 우→좌 동기화 시 발생할 복사 N·덮어쓰기 M 산출(파괴 전 확인용). */
  export function previewMirror(direction: 'l2r' | 'r2l'): MirrorPlan
  /** 미러 실행: 사용자 확정 후 기존 op:start(copy/move/trash) 묶음 + K1 undo 누적. */
  export async function applyMirror(direction: 'l2r' | 'r2l', plan: MirrorPlan): Promise<void>
  ```
  - **미러는 파괴적** → 변경 미리보기(복사/덮어쓰기 수) → 사용자 확정 → 기존 `startOperation('copy'|'trash', …)` 재사용(휴지통 경유 삭제·D4 충돌·K1 undo). M6 1차는 **단방향 복사 미러(없는 항목·다른 항목 복사)**만 우선, 삭제(한쪽에만 있는 걸 지우는 동기화)는 확인 모달 필수. (P1 미러 전체 범위는 M7 큐와 정합 — M6는 메타 비교 + 기본 복사 미러까지.)

- `src/renderer/ui/compare/CompareView.tsx` — 좌/우 짝지은 diff 뷰(4상태 색·아이콘).
- `src/renderer/ui/compare/useSyncScroll.ts` — 좌/우 가상 스크롤 인덱스 동기 컨트롤러(FileListView 가상 스크롤 위에 얹음).
- `src/renderer/ui/compare/CompareToolbar.tsx` — 비교 on/off·"차이만 보기"·동기 스크롤·미러 방향 버튼·요약(좌만 N/우만 M/다름 K/같음 L).

**수정 파일**
- `src/shared/dto/index.ts` — `CompareStatus`·`ComparePairDTO`(직렬화 필요 시·M6는 렌더러 내부라 도메인 타입으로 충분하나 추적성 위해 DTO에 등록)·`CompareSummary` 추가.
- `src/renderer/app/stores/rootStore.ts` — `createCompareSlice` 등록.
- `src/renderer/app/usecases/contextMenu.ts` — 폴더 빈영역에 "다른 패널과 비교"(2분할일 때만).
- (선택) `src/renderer/app/usecases/commandBus.ts` — `compare.toggle`/`compare.run` 라우팅.
- `src/renderer/ui/panel/views/FileListView.tsx` 또는 `ui/layout/LayoutHost.tsx` — 비교 모드 활성 시 CompareView로 전환(또는 오버레이). **기존 FileListView 비파괴** — 비교는 별도 뷰 컴포넌트로 분리(LayoutHost가 `compareActive`면 CompareView 렌더).

---

## 2. 신규 IPC 채널 필요 여부 — 판정: **3기능 모두 채널 0**

| 기능 | 채널 | 근거 |
|---|---|---|
| **T3** | **0** | 정렬/필터는 이미 렌더러 도메인 순수 규칙(sort.ts·filter.ts)·panelsSlice·computeVisible로 완결. 프리셋은 세션 스냅샷 메타 `filterPresets` 확장 → 기존 `session:save/load`(디바운스·원자적 쓰기) 재사용(J7 `favoriteLabels`·O1 `pinnedByDir` 동형). ADR-012 결정①·system-architecture §5-PU.0. |
| **R1** | **0** | 미리보기·충돌검사는 **렌더러 순수 규칙**(batchRename.ts). 실행은 **기존 `fs:rename` 반복**(이미 fileOps#commitRename이 사용). undo는 렌더러 undo 스택 + 기존 역연산. system-architecture §5-PU.0·SW §14.1. |
| **P1(메타)** | **0** | 비교 대상이 **이미 로드된 양 패널 `directory.entries`**(좌/우)이므로 추가 fs 호출 불요 → 렌더러에서 `compareEntries` 순수 계산으로 4상태 산출. 미러 실행만 **기존 `op:*` 재사용**(휴지통 삭제·D4 충돌). **해시(내용) 비교·재귀 디렉토리 스캔이 필요한 경우는 M7 `hash:compare:*`**(ADR-009) — M6 비대상. |

> **P1 채널 0 검토 결론(정직)**: M6 메타 비교는 "현재 두 패널에 표시 중인 같은 깊이 폴더의 항목 비교"로 충분(F20 수용기준의 1차 메타 비교). **재귀 하위 폴더까지 비교**하거나 **내용 해시 비교**가 필요하면 그건 M7 `hash:compare:*`(Worker·진행률·취소)로 간다. M6는 양 패널 entries(이미 로드됨) 단일 깊이 메타 비교 → 신규 채널 0 가능. 만약 M6에서도 "재귀 메타 비교"를 수용기준이 요구하면 → PM 결정(스코프), 그 경우 M7 채널 선행 필요(블로커로 상신).

**신규 npm 의존성: 0** (전 기능). **신규 ADR: 0** (ADR-009·012 기존 설계 준수).

---

## 3. 도메인 순수 규칙 (테스트 용이·헤드리스 verify 대상)

| 파일 | 입력 | 출력 | 부수효과 |
|---|---|---|---|
| `domain/rules/filterComposition.ts#matches` | `FileEntryDTO`, `ActiveFilters` | `boolean` | 0 — query는 `filter.ts#matchesQuery`, extPatterns는 `globToRegExp` 재사용(DRY) |
| `domain/rules/batchRename.ts#computeBatchRename` | 대상 목록·`BatchRenameRule`·기존 이름 Set | `RenamePreviewRow[]` | 0 — 정규식 컴파일 실패는 throw 금지(안전 폴백) |
| `domain/rules/compare.ts#compareEntries` | 좌/우 `FileEntryDTO[]`·`CompareOptions` | `ComparePair[]` | 0 — 이름 매칭(대소문자 무시)·size/mtime 허용오차 비교 |

- 세 규칙 모두 **react/zustand/infra/shared-ipc import 0**(ESLint 도메인 경계). `@shared/dto` 타입 전용 import만 허용.
- 셋 다 **순수 함수 → 기존 `tests/domain.verify.ts`(verify:domain)에 케이스 추가** 또는 신규 verify 스크립트(§7).

---

## 4. 세션 영속 스키마 확장 (T3 전용 — 비파괴·coerce 패턴)

### 4.1 DTO (`src/shared/dto/index.ts` — append)
```ts
export type PresetSort = { readonly key: SortKey; readonly dir: SortDir; readonly folderFirst: boolean }
export type PresetFilter = {
  readonly query?: string
  readonly extPatterns?: string[]
  readonly tagColors?: TagColor[]   // M8(T1)에서 채움 — M6는 비어 있음
  readonly diffOnly?: boolean       // P1 — M6 일반 패널 미사용
}
export interface FilterPreset {
  readonly id: string
  readonly name: string
  readonly sort: PresetSort
  readonly filter: PresetFilter
}
// SessionSnapshot 확장(비파괴·옵셔널):
//   sidebar/ui 와 동격으로 최상위 filterPresets? : FilterPreset[]  (또는 sidebar 안에 둘지 결정 — 아래)
```
> **배치 결정**: ADR-012는 `SessionSnapshot.filterPresets`(전역)로 명시. **`SessionSnapshot` 최상위에 옵셔널 `filterPresets?: FilterPreset[]` 추가**(sidebar/ui와 동격). `SidebarSnapshot`이 아님(프리셋은 사이드바 메타가 아니라 전역 보기 메타). `TagColor`는 M6 시점에 타입만 미리 정의(`'red'|'orange'|'yellow'|'green'|'blue'|'purple'|'gray'`)하거나 M8로 미룬다 → **M6는 `PresetFilter.tagColors`를 옵셔널로 두되 `TagColor` 타입을 dto에 선정의**(M8 무변경 재사용). 

### 4.2 coerce (`src/main/persistence/defaults.ts` — append)
- `SESSION_SCHEMA_VERSION` **1 → 2** 상향(구조 추가) + `src/renderer/domain/session/index.ts` 미러 값 동시 +1. 마이그레이션은 "없으면 빈 기본값 `[]`"(ADR-012 결정① — 비파괴, 구버전 세션은 `filterPresets` 누락 → 빈 배열).
- `coerceFilterPresets(raw): FilterPreset[]`:
  - 배열 아니면 `[]`. 각 항목: `id`·`name`(빈 이름 제외 또는 자동 이름) 문자열 필수, `sort.key`는 `SORT_KEYS`·`sort.dir`은 `SORT_DIRS`·`folderFirst`는 bool로 폴백(기존 `coercePanel` 패턴 재사용), `filter`는 안전 정규화(미지 필드 제거·`extPatterns`는 `asStrArray`). 손상 항목은 폐기(throw0).
- `defaultSession()`: `filterPresets: []` 추가. `coerceSession()`: `filterPresets: coerceFilterPresets(o['filterPresets'])` 추가.

### 4.3 직렬화/복원 (`src/renderer/app/usecases/session.ts`)
- `buildSessionSnapshot()`: `filterPresets: [...s.filterPresets]` 추가(휘발 아님).
- `applySnapshot()`: `s.hydratePresets(snap.filterPresets ?? [])` 추가.
- **round-trip 동등성**: 구버전 세션(필드 없음) → coerce가 `[]` → 저장 시에도 안정(불필요 저장 억제 lastSerialized 정합). version 2로 저장.

> **R1·P1은 영속 0**: R1은 작업(휘발), P1 비교 결과/모드도 휘발(세션 미저장 — 부팅 시 비교 off). undo 스택도 기존대로 휘발(coerce에 없음).

---

## 5. UI 진입점 · 단축키 (충돌 점검)

### 5.1 진입점
| 기능 | 진입 |
|---|---|
| **T3** | toolbar `PresetBar` 드롭다운(목록·적용)·"현재 보기 저장" 버튼 / 빈영역 컨텍스트 메뉴 "이 보기를 프리셋으로 저장" / 관리 다이얼로그(이름변경·삭제) |
| **R1** | `Ctrl+Shift+R`(목록 컨텍스트·2+ 선택) / 다중 선택 컨텍스트 메뉴 "고급 이름변경…" / (선택) 아이콘바 버튼 |
| **P1** | `CompareToolbar` 비교 on/off 버튼(2분할일 때 노출) / 폴더 빈영역 컨텍스트 메뉴 "다른 패널과 비교" / 비교 모드 내 "차이만 보기"·동기 스크롤·미러 토글 |

### 5.2 신규 단축키 충돌 점검 (기존 `KEYBINDINGS` 대조)
- `Ctrl+Shift+R`(R1 batchRename): 기존 매핑 **없음**(검색 결과 `ctrl+r`=panel.refresh / `ctrl+shift+t`=tab.reopen / `ctrl+shift+n`=newFolder / `ctrl+shift+\`=grid4 — `ctrl+shift+r` 미사용). **충돌 0**. context=`list`로 등록(목록 포커스 시만·텍스트 입력 중 미발화).
- T3·P1은 **신규 단축키 미추가**(메뉴/버튼 진입) → 충돌 0. (필요 시 후속에 팔레트 S2로 노출.)
- 전역 단축키 가드: R1 다이얼로그 열림 시 `dialog` 컨텍스트로 전역 단축키 차단(기존 `confirmDelete`/`trashOpen` 가드에 `batchRenameOpen` 합류 — uiSlice).

---

## 6. 되돌리기 연계 (R1 — undoSlice/undo.ts)

### 6.1 undoSlice — `UndoEntry`에 신규 kind 추가(append)
```ts
| {
    readonly kind: 'batchRename'
    /** 한 묶음으로 바뀐 각 항목의 역연산 정보. */
    readonly items: { readonly newPath: string; readonly oldName: string; readonly newName: string }[]
    /** 영향 폴더(새로고침용). */
    readonly dir: string
  }
```
- 기존 `rename` 단건과 동형이나 **N건을 1엔트리로 묶어 push**(features §R1 "한 묶음으로 되돌리기"). `applyBatchRename` 성공 시 1회 `pushUndo({kind:'batchRename', items, dir})`.

### 6.2 undo.ts — `undoBatchRename` 분기 추가
```ts
case 'batchRename': await undoBatchRename(entry); return
```
- **역순 적용 + 충돌 선검증**(기존 undoRename 원칙 재사용): 각 item을 `newPath → oldName`으로 되돌리되, ① newPath 존재 확인, ② oldName 자리 동명 충돌 시 **덮어쓰지 않고 중단·안내**(임의 덮어쓰기 금지). 묶음 중 일부 실패 시 부분 복원 + 정직 안내(완전 원자성은 fs 한계 — 토스트로 "일부만 되돌림" 명시). 완료 후 `dir` 보는 패널 refresh.
- **2단계 rename 충돌 회피**: 묶음 내 이름 순환(A→B, B→A)은 적용·되돌리기 모두 임시명 경유 2단계 rename으로 처리(`applyBatchRename`·`undoBatchRename` 공통 헬퍼).

### 6.3 적용 경로
- `applyBatchRename`: rows를 `fs:rename` 순차(또는 2단계) 실행 → 성공분만 모아 1엔트리 push. 실패 행은 토스트 안내(부분 적용 정직 표기). **K1 undo 스택 cap(50) 정합**(1묶음=1엔트리).

> **T3·P1 undo**: T3(프리셋)은 비파괴 메타라 undo 불요. P1 미러는 **기존 op:* 경로가 자동으로 K1 undo 적재**(copy→copy-undo·trash→trash-undo) — 신규 undo 로직 0.

---

## 7. verify 계획 (신규 verify:* + 케이스 개요)

> 기존 패턴: 도메인 순수 = `verify:domain`(tests/domain.verify.ts), store 액션 = `verify:store`(tests/store.verify.ts), persistence coerce = `verify:persistence`(scripts/verify-persistence.ts). **신규 전용 스크립트보다 기존 verify에 케이스 추가**를 우선(빌드 파이프 단순). 분량 많으면 신규 스크립트 분리.

| 기능 | verify | 케이스 개요 |
|---|---|---|
| **T3** | `verify:domain`(filterComposition) + `verify:store`(presetsSlice) + `verify:persistence`(coerceFilterPresets) | **filterComposition**: query만(기존 동치)·extPatterns OR(png/jpg)·차원 간 AND·빈 필터 전부 통과·hasActiveFilter. **presetsSlice**: add(id 발급)·apply(sort/filter 세팅·교체식)·rename·remove·hydrate. **coerce**: 손상(배열 아님→[])·미지 sort.key 폴백·빈 이름 폐기·extPatterns 비문자열 제거·version 2 round-trip·구버전(필드 없음→[]) 비파괴. |
| **R1** | `verify:domain`(batchRename) 또는 신규 `verify:batchrename` | find/replace·정규식·연번(pad/step/position)·대소문자(upper/lower/title)·접두접미·확장자 적용 토글·**충돌검사**(dup-internal·dup-existing·금지문자·예약명·빈 이름)·정규식 컴파일 실패 안전 폴백·isApplicable. |
| **P1** | `verify:domain`(compare) 또는 신규 `verify:compare` | 4상태 분류(left-only/right-only/diff/same)·size 차이→diff·mtime 허용오차(경계)·대소문자 무시 매칭·폴더vs파일 동명→diff·summarize 카운트 합=total·빈 입력·동기 스크롤 인덱스 정렬. |

- 추가로 `verify:store`에 **compareSlice**(runCompare·toggleDiffOnly·syncScroll) 케이스, undoSlice **batchRename push/pop** 케이스.
- **회귀 0 목표**: 기존 `verify:store`/`verify:domain`/`verify:persistence` 전 케이스 통과 유지(computeVisible 교체가 기존 query 동작 동치임을 verify로 고정).
- 신규 스크립트 추가 시 `package.json` `scripts`에 `verify:batchrename`·`verify:compare` esbuild 라인 추가(기존 `verify:domain` 라인 형식 복제).

---

## 8. 구현 순서 · 기능별 DoD

### 8.1 순서: **T3 → R1 → P1** (권장 근거)
1. **T3 먼저(가장 가벼움)**: 신규 채널 0·기존 정렬/필터 파이프라인 확장만. 공유 파일(dto·persistence·session·computeVisible)을 T3가 먼저 정착시키면 R1/P1이 그 위에 깔끔히 append. filterComposition이 P1의 "차이만 보기" 기반도 됨(인터페이스 선정의).
2. **R1 다음(독립성 높음)**: 완전 독립 모듈(batchRename 순수 + 다이얼로그 + undo). 공유 변경은 keybindings 1줄·commandBus 1 case·undoSlice 1 kind·uiSlice 1 플래그뿐 → T3와 무충돌.
3. **P1 마지막(통합 면적 큼)**: 비교 뷰·동기 스크롤·미러(op:* 연계)로 UI/레이아웃 통합 면적이 가장 큼. dto·rootStore·contextMenu append는 T3·R1 정착 후 진행하면 merge 0.

### 8.2 기능별 DoD (공통: typecheck 0 · lint 0 · build 성공)
- **T3 DoD**: `verify:domain`(filterComposition)·`verify:store`(presetsSlice)·`verify:persistence`(coerceFilterPresets) 신규 케이스 통과 + **기존 verify 회귀 0**(computeVisible 동치) · 프리셋 저장→재시작→복원(세션 version 2 round-trip) · 수용기준 F30/US-19.3 충족(저장·적용·이름변경·삭제·세션 영속·합성 AND/OR).
- **R1 DoD**: `verify:domain`/`verify:batchrename`(규칙·충돌·안전폴백) 통과 + undo push/pop verify · 실시간 미리보기·충돌 강조·Ctrl+Z 한 묶음 되돌리기 동작 · 수용기준 F22/US-17.1 충족(패턴/정규식/연번/대소문자·미리보기·충돌검사·되돌리기).
- **P1 DoD**: `verify:domain`/`verify:compare`(4상태·요약) 통과 + compareSlice verify · 4상태 색/아이콘·차이만 보기·동기 스크롤·미러 미리보기→확정→op:* 실행·K1 undo 누적 동작 · 수용기준 F20/US-15.1 충족(메타 비교 4상태·미러/동기화·동기 스크롤). **해시 옵션은 M7로 명시 deferral(정직)**.
- **전체**: 각 기능 QA PASS 직후 **doc-sync 게이트 실행**(roadmap §0.5·traceability §1-P/§1-R/§1-T 🔜→✅, 실 GUI 동작은 런타임 스모크 🟡 정직 구분). **동기화 전 다음 기능으로 넘어가지 않음**(CLAUDE.md 게이트).

---

## 9. 규약 준수 체크리스트

| 규약 | 적용 |
|---|---|
| **ADR-003 throw0/Result** | 신규 IPC 핸들러 0(채널 0). 도메인 순수 규칙은 throw 금지(정규식 실패·손상 입력 안전 폴백). undo 역연산은 기존 Result 경로 재사용. |
| **ADR-005 보안** | 신규 네트워크/실행/렌더러 직접 파일 접근 0. R1 실행은 기존 `fs:rename`(검증된 핸들러), P1 미러는 기존 `op:*`(휴지통·D4 충돌·guardPath). 비교는 이미 로드된 entries만 사용. |
| **계층 import 규칙** | `domain/rules/*` 3종은 react/zustand/infra/shared-ipc import 0(타입 전용 `@shared/dto`만). usecase→infra/api 직접 호출 허용(기존). UI→domain/usecase만(shared-ipc 직접 import 금지). |
| **계약 단일출처** | DTO=`shared/dto/index.ts`, 세션 스키마/coerce=`persistence/defaults.ts`(+ `domain/session` 버전 미러). version 1→2 상향 1회·미러 동기. |
| **ADR-012 결정②** | filterComposition = 차원 간 AND·차원 내 OR. 프리셋=교체식(동시 합성 미지원). |
| **ADR-009 마일스톤 정합** | P1 M6=메타 비교만·해시는 M7 `hash:compare:*`로 deferral(은폐 금지). 미러 삭제는 휴지통 경유. |
| **비파괴** | 기존 FileListView·computeVisible 동작 동치(verify 고정)·기존 채널/의존성 무변경·구버전 세션 호환. |

---

## 10. 리스크 / 주의

1. **computeVisible 교체 회귀(T3·중)**: `filterEntries(query)` → `matches(activeFilters)` 교체 시 기존 query 동작이 깨지면 전 패널 필터에 영향. **완화**: extPatterns/tagColors 빈 경우 query만 평가하도록 보장 + 기존 verify 회귀 0를 게이트로. 메모 슬롯 키 누락 시 stale 결과 → 키에 새 차원 포함 필수.
2. **세션 version 1→2 마이그레이션(T3·저)**: 구버전 세션 로드 시 `filterPresets` 누락 → coerce가 `[]`로 안전 폴백. **주의**: `domain/session/index.ts` 미러 값을 같이 +1 안 하면 버전 불일치 경고. 두 곳 동시 수정.
3. **R1 일괄 rename 원자성 한계(R1·중·정직)**: fs:rename N건은 비원자 → 중간 실패 시 부분 적용. 2단계 rename으로 순환 충돌은 회피하나 완전 롤백은 불가 → **부분 적용·부분 되돌림을 토스트로 정직 안내**(은폐 금지). undo도 동일(부분 복원 가능).
4. **R1 정규식 ReDoS(R1·저)**: 사용자 정규식은 파일명(짧음) 단위 적용이라 위험 낮으나, 컴파일 실패는 throw 금지로 안전 폴백. 악성 패턴 타임가드는 1차 단순(파일명 길이 상한).
5. **P1 비교 깊이 스코프(P1·중·PM 결정 가능)**: M6는 **현재 표시 중인 단일 깊이 양 패널 entries 메타 비교**. 수용기준이 "재귀 하위 폴더 비교"를 M6에서 요구하면 → M7 `hash:compare:*`(Worker·진행률) 선행 필요 → **블로커로 PM 상신**. 본 계획은 단일 깊이로 채널 0 달성.
6. **P1 미러 파괴성(P1·중)**: 한쪽에만 있는 항목 삭제 동기화는 데이터 손실 위험 → **확인 모달 필수·휴지통 경유·K1 undo**. M6 1차는 복사 미러 우선, 삭제 미러는 명시 확인. (전체 미러 범위는 M7 큐와 정합.)
7. **P1 동기 스크롤·가상 스크롤 통합(P1·중)**: FileListView 가상 스크롤 위에 동기 컨트롤러를 얹어야 함 → 짝 없는 항목 placeholder 행 높이 정합 필요. 1만 항목 비차단(§6.3 메모) 유지. 런타임 스모크 권장(🟡).
8. **공유 파일 순차 append 가정(전체·저)**: 상주 팀 없이 순차 구현이므로 T3→R1→P1 순서를 지키면 dto/commandBus/rootStore merge 충돌 0. **순서 어기면** 뒤 기능이 앞 기능 변경을 덮어쓸 위험 → 순서 준수.
