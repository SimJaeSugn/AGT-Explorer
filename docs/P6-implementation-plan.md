# P6 (Should) 구현 계획서 — 4분할 · 미리보기 · 워크스페이스 · 텔레메트리

> 작성: 테크리드 · 2026-06-07 · 상태: **계획 v2(reviewer FAIL 조건부 보완 반영 — 재검증 대기)** · 구현 미착수
> v2 보완(reviewer 독립 검증 + PM 확정 반영): [중대-1] grid-4 F5/F6 방향 규칙 확정 · [중대-2] 워크스페이스 복원 단일화 필수 격상(`resetWorkspace`+`applySnapshot`) · [중대-3] `telemetry:get-opt-in` 신규 채널 단일안 · [경미-1] focusNextPanel 가드 검증 · [경미-2] ESLint main 오버라이드 채택 · [경미-3] 신규 `preview.handlers.ts` 확정. (변경 섹션: §0·§2.1·§2.2·§2.3·§2.4·§3·§4·§5·§6)
> 입력: [roadmap.md §3 P6](./roadmap.md) · [software-architecture.md §9·§5.2·§7.2](./architecture/software-architecture.md) · [system-architecture.md §3.2·§5](./architecture/system-architecture.md) · [traceability.md](./architecture/traceability.md)
> 대상: roadmap P6 DoD를 **코드베이스 수준**(파일·함수·인터페이스)으로 구체화. 본 문서는 "무엇을 만들지"의 단일 출처이며, 구현은 reviewer 계획 검증 통과 후 착수한다.

---

## 0. 사전 조사 요약 (현재 코드 사실)

P6는 "예약된 진입점 위에 살을 붙이는" 작업이다. 조사 결과 **이미 동결/선구현된 자산**이 많아 신규 표면은 작다.

| 영역 | 이미 있는 것(재사용) | 비어 있는 것(P6에서 채울 것) |
|---|---|---|
| **4분할** | `LayoutKind`에 `grid-4` 동결(dto, defaults `LAYOUTS`, coerce), `tabsSlice.focusNextPanel`(순환)·`focusPanelDir`(방향), `panel.focusNext`/`panel.focusDir.*` commandId, `Ctrl+\` 키 | LayoutHost 2x2 배치, `toggleGrid4` 액션, `focusPanelDir`의 4분할 기하 보정, `layout.toggleGrid4` 명령·키 바인딩 |
| **미리보기** | `Ctrl+P`→`preview.toggle` 키 등록(commandBus `notYet`), `uiSlice` 자리(previewOpen 미존재), `SessionSnapshot.ui.previewOpen` 동결, SW §9 `ui/preview/renderers/*` 격리 경계 | **데이터 IPC 채널 전무(갭 ⚠️)**, `uiSlice.previewOpen`, PreviewPanel + 형식별 렌더러, App 마운트, FileSystemService 읽기 메서드 |
| **워크스페이스** | `workspace:*` 채널·contracts·preload `api.workspace.*`·infra `bridge().workspace` 전부 동결, `persistencePaths.workspacesDir` 경로, `coerceSession`·`buildSessionSnapshot` 재사용 가능, `restoreWindows` | `WorkspaceStore`(persistence), `registerWorkspaceHandlers`, infra `workspaceApi` 어댑터, `workspace` usecase, 워크스페이스 UI |
| **텔레메트리** | **체크박스(SettingsDialog)·`changeTelemetryOptIn` usecase·`telemetry:set-opt-in` 채널·핸들러·`SettingsStore.setTelemetryOptIn`·`isTelemetryOptIn()`·telemetry.json 영속 전부 구현 완료** | (a) 외부 전송 코드 전무 보장·문서화 + **ESLint main 오버라이드 정적 금지(필수)**, (b) **신규 `telemetry:get-opt-in` 채널**로 `loadSettings` 부팅 재수화(필수 — `SettingsSnapshot` 계약 불변) |

> **핵심 결론**: P6d(텔레메트리)는 **검증·문서화 + 작은 부팅 재수화 채널(`telemetry:get-opt-in`)·ESLint 정적 가드**. P6c(워크스페이스)는 계약·persistence 패턴이 완비돼 **패턴 복제** 위주이나 **복원 단일화(`resetWorkspace`+`applySnapshot`)는 필수**(R-C2 해소). P6a(4분할)는 기존 슬라이스 확장 + **`panelPaths()` grid-4 분기**(F5/F6 결정성, [중대-1]). **주 신규 설계 표면은 P6b 미리보기의 `preview:read` 채널**이고, 부수 신규 채널로 `telemetry:get-opt-in`이 추가된다(2종).

---

## 1. 하위 단계 분해 (의존·병렬·담당)

| 하위 단계 | 목표 | 의존 | 병렬 가능성 | 담당 |
|---|---|---|---|---|
| **P6a 4분할(grid-4)** | 2x2 레이아웃·4패널 독립·포커스 순환 vs 방향 구분·단축키 | P5(LayoutHost·tabsSlice) | P6b/c/d와 완전 병렬(겹치는 파일 없음) | **frontend** 단독 |
| **P6b 미리보기** | 이미지/텍스트/메타/미지원 렌더·`Ctrl+P` 토글·**신규 read 채널** | P5(uiSlice) + **신규 채널 계약 합의** | backend(채널·서비스)·frontend(패널·렌더러)가 **계약 동결 후 병렬** | **backend+frontend** |
| **P6c 워크스페이스** | save/list/load/delete 핸들러 실구현·UI·복원 정합 | P5(persistence·session 스냅샷·restoreWindows) | backend(Store·핸들러)·frontend(UI·usecase)가 **이미 동결된 계약 경계로 병렬** | **backend+frontend** |
| **P6d 텔레메트리** | 옵트인 노출 보장 + 외부 전송 전무 검증·**ESLint main 정적 금지** + **`telemetry:get-opt-in` 부팅 재수화** | 없음(채널 동결 후 독립) | 독립 | **backend(검증·신규 채널)** + qa |

**진행 순서(이중 검증 루프 1단위 = P6 전체를 하위 4개로 쪼갬)**:
1. **계약 합의 먼저**: 신규 채널 2종을 동결 → reviewer 검증.
   - `preview:read`(P6b): `channels.ts`/`contracts.ts`/`dto`. P6b backend·frontend 병렬의 출발선.
   - `telemetry:get-opt-in`(P6d, [중대-3]): `channels.ts`/`contracts.ts`(`SettingsSnapshot` 불변). P6d 부팅 재수화의 출발선.
2. 동결 직후 4트랙 병렬: P6a(frontend: `toggleGrid4`·LayoutHost·`focusPanelDir`·`panelPaths()` grid-4 분기) · P6b backend(서비스/`preview.handlers`) ∥ P6b frontend(패널/렌더러, 모킹 위) · P6c backend(Store/핸들러) ∥ P6c frontend(UI·`resetWorkspace`·`applySnapshot`) · P6d(검증·ESLint 가드·`telemetry:get-opt-in` 핸들러+재수화).
3. 각 트랙 모듈 완성 즉시 경계에서 통합·교차 비교 → qa 점진 검증.

---

## 2. 단계별 파일·함수·인터페이스 변경 지점

### 2.1 P6a — 4분할 (grid-4) · frontend 단독

#### 수정 파일

**`src/renderer/app/stores/tabsSlice.ts`**
- `TabsSlice` 인터페이스에 추가:
  ```ts
  /** 4분할 토글(single/split-2 ↔ grid-4). grid-4 진입 시 부족한 패널을 활성 패널 경로로 채운다. */
  toggleGrid4(tabId?: string): void
  ```
- 구현 (`toggleSplit2` 패턴 그대로):
  - 현재 `layout !== 'grid-4'` → `grid-4`로 전환. 패널이 4개 미만이면 `addPanel`+`resetSelection`으로 **활성 패널 경로 복제**해 4개까지 채운다(2분할이면 2개 추가, 단일이면 3개 추가). `t.panelIds`는 항상 4개.
  - 현재 `layout === 'grid-4'` → `single`로 복귀. 활성 패널만 남기고 나머지 `removePanel`+`dropSelection`(toggleSplit2 단일복귀 분기와 동일).
- **`focusPanelDir(dir)` 보정 (4분할 방향 이동 — DoD 핵심 ⚠️)**: 현재는 `left=panelIds[0]`, `right=panelIds[last]`로 2분할만 맞다. grid-4(2x2, panelIds = `[좌상, 우상, 좌하, 우하]` 순서 고정)에서는 행/열 기하로 계산해야 순환(Tab)과 결과가 달라진다.
  - 인터페이스를 `focusPanelDir(dir: 'left' | 'right' | 'up' | 'down')`로 확장(현재 left/right만). 단, **P6 키 바인딩은 left/right만 유지**(PRD §8 표에 up/down 패널 포커스 키 없음). up/down은 내부 기하 헬퍼로만 두거나, 범위를 left/right로 한정(아래 리스크 R-A1 참조 — 범위 확정은 reviewer 판단).
  - grid-4 기하: 활성 패널 인덱스 `i`(0~3) → 2x2 좌표 `(row=⌊i/2⌋, col=i%2)`. `left`=col을 0으로, `right`=col을 1로(같은 행 내 수평 이동). `panelIds`가 4개일 때만 이 분기, 2개면 기존 로직 유지.
- **`focusNextPanel()`**: 변경 불필요(이미 `panelIds.length` 기준 순환 → 4개에서 0→1→2→3→0 순환). grid-4에서 "순환"이 자연 동작. **가드 정상성**: `focusNextPanel`의 `if (!tab || tab.panelIds.length <= 1) return` 가드는 `panelIds.length === 4`를 통과하므로 4패널 순환이 그대로 작동(코드 변경 없음 — QA 검증 항목, §4 참조).

**`src/renderer/app/usecases/fileOps.ts` — `panelPaths()` grid-4 분기 (F5/F6 대상 결정 ⚠️ [중대-1])**
- 현재 `panelPaths()`는 `const otherId = tab.panelIds.find((p) => p !== activeId)`로 **활성 외 첫 패널**을 무조건 고른다. 이는 2패널 전제이며 grid-4(4패널)에서 **비결정적**(panelIds 순서에 의존해 "다른 패널"이 임의 선택됨)이다. F5(`copyToOtherPanel`)/F6(`moveToOtherPanel`)이 이 `otherPanelId`/`otherPath`를 대상으로 쓴다.
- **확정 규칙(PM 결정)**: grid-4에서 F5/F6 대상 패널 = **"같은 행의 반대 열" 패널 → 없으면 첫 비활성 패널**. 2x2에서 `panelIds` 인덱스는 `[0=좌상, 1=우상, 2=좌하, 3=우하]` 기준(LayoutHost 셀 배치 순서와 동일):
  - 활성 0 → 대상 1, 활성 1 → 대상 0, 활성 2 → 대상 3, 활성 3 → 대상 2 (같은 행의 반대 열, XOR 1).
  - 구현: `const activeIdx = tab.panelIds.indexOf(activeId)`. grid-4(`tab.layout === 'grid-4'` && `panelIds.length === 4`)이면 `const otherIdx = activeIdx ^ 1; otherId = tab.panelIds[otherIdx] ?? tab.panelIds.find((p) => p !== activeId)`. 그 외(single/split-2)는 **기존 동작 유지**(`find((p) => p !== activeId)`).
  - 폴백("없으면 첫 비활성 패널")은 `panelIds` 길이가 4 미만인 비정상 grid-4 상태에 대한 안전망.
- 적용 범위: `panelPaths()` 한 곳만 수정하면 F5/F6/Ctrl+V·D&D 등 이를 쓰는 모든 호출이 일관되게 새 규칙을 따른다. single/split-2 결과는 불변.

**`src/renderer/ui/layout/LayoutHost.tsx`**
- `tab.layout === 'grid-4'` 분기 추가. 2x2 배치:
  - 바깥 컨테이너 `display: grid; gridTemplateColumns: 1fr 1fr; gridTemplateRows: 1fr 1fr; gap`(또는 중첩 flex 2행).
  - `tab.panelIds`(4개)를 순서대로 셀에 배치. 분할선은 셀 경계 `borderLeft`(col>0)·`borderTop`(row>0)으로(기존 split 스타일 토큰 `borderStrong` 재사용).
  - 최소폭/최소높이: 각 셀 `minWidth: 220, minHeight: 160`(기존 split 값 재사용).
- 기존 single/split-2 분기는 그대로. **권장 리팩터**: `layout` 기준 분기를 함수로 추출(가독성), 단 기존 동작 보존.

**`src/renderer/app/usecases/commandBus.ts`**
- `case 'layout.toggleGrid4': s.toggleGrid4(); return true` 추가.
- `panel.focusDir.up`/`down` 명령을 추가할지는 키 바인딩 추가 여부에 따름(아래). 추가 시 `focusPanelDir('up'|'down')` 연결.

**`src/renderer/domain/keybindings/index.ts`**
- 4분할 토글 키 추가. PRD §8에 4분할 전용 키가 명시돼 있지 않으므로 **`Ctrl+Shift+\`**(2분할 `Ctrl+\`와 짝)를 신규 chord로 제안:
  ```ts
  { chord: 'ctrl+shift+\\', commandId: 'layout.toggleGrid4', context: 'global', label: '4분할 토글(2x2)', group: '패널 분할' }
  ```
  - **충돌 검증**: `KeyBindingRegistry.assertNoConflicts`가 부팅 시 검출. `ctrl+shift+\\`는 기존 어디에도 없음(grep 확인). 신규 키 도입은 PRD §8 표 갱신이 필요 → **D4(단축키 충돌 회피) 영향 → doc-sync에서 PRD/traceability 단축키 표 갱신**.

#### DoD(P6a)
- `Ctrl+Shift+\`로 grid-4 토글, 4패널이 각자 독립 `directoryView`/`selection`/`navHistory`/`view`를 가짐(panelsSlice가 이미 panelId별 분리).
- `Tab`(`panel.focusNext`)=4패널 0→1→2→3→0 순환. `Ctrl+←/→`(`panel.focusDir`)=같은 행 내 수평 이동 → **2분할과 달리 순환과 방향 결과가 다름**(우상 패널에서 Tab은 좌하로, Ctrl+→는 무변/우상 유지).
- **`focusNextPanel` 가드 통과**: grid-4(`panelIds.length === 4`)에서 `panelIds.length <= 1` 가드를 통과해 Tab이 4패널 전체를 순환한다(코드 변경 불필요, 측정 항목).
- **F5/F6 대상 결정([중대-1])**: grid-4에서 F5(`copyToOtherPanel`)/F6(`moveToOtherPanel`) 대상 = **활성 패널과 같은 행의 반대 열**(활성 idx ^ 1). 활성=우상(idx1)이면 대상=좌상(idx0), 활성=좌하(idx2)이면 대상=우하(idx3). single/split-2는 기존 동작(활성 외 첫 패널) 유지.
- 활성 패널 정확히 하나 불변식 유지(tabsSlice 기존 보장).
- grid-4 탭이 세션 스냅샷에 직렬화·복원됨(`coerceSession`의 `LAYOUTS`에 grid-4 이미 포함, `restoreWindows`는 layout-agnostic). 추가 코드 불필요 — **검증 대상**.

---

### 2.2 P6b — 미리보기 패널 · backend+frontend (신규 채널 ⚠️)

#### ⚠️ 설계 갭 해소: 신규 IPC 채널 `preview:read`

현재 텍스트 앞부분/이미지 바이트를 렌더러로 가져올 채널이 없다(`fs:stat`은 메타만). **단순 채널 추가로 충분**하다고 판단(썸네일 디코딩 같은 구조적 결정 불필요 — 아래 근거). 채널 추가는 P6 신규 Should 기능이므로 contracts 동결 예외 허용(과제 명시).

**근거(채널 추가로 충분, chief-architect 에스컬레이션 불필요)**:
- 이미지는 **원본 바이트를 base64 data URL로 그대로 렌더**(`<img src>`)하고 **크기 상한(예 ≤ 5MB)** 초과 시 "미리보기 생략" 폴백. 썸네일 디코딩(Main Worker/OffscreenCanvas, SA §8 미해결 3)은 **그리드/썸네일 보기(별도 Could)에서만 필요**하고 미리보기 1장에는 불필요 → 디코딩 전략 결정을 P6에서 회피.
- 텍스트는 **앞부분 N바이트만**(예 ≤ 64KB) 읽어 UTF-8 디코드. 바이너리 판별은 읽은 바이트의 NUL/비텍스트 비율 휴리스틱.
- 보안(ADR-005 §3.3)·크기 상한·바이너리 방어가 모두 **단일 핸들러 안에서 가드 가능** → 구조 변경 없음.

**`src/shared/ipc/channels.ts`** — `CHANNELS`에 추가:
```ts
// ── preview:* 미리보기 데이터 읽기 ─ 신규(P6 Should), impl: P6 ──────────
PREVIEW_READ: 'preview:read', // impl: P6 (텍스트 앞부분/이미지 바이트/메타)
```
- `EVENT_CHANNELS`는 변경 없음(요청-응답이므로).

**`src/shared/dto/index.ts`** — 미리보기 결과 DTO 추가(직렬화 가능 타입만):
```ts
/** 미리보기 종류(렌더러 형식별 렌더러 선택 키). */
export type PreviewKind = 'image' | 'text' | 'meta' | 'unsupported'

/** preview:read 결과. kind에 따라 payload 필드가 채워진다(나머지는 undefined). */
export interface PreviewData {
  readonly kind: PreviewKind
  /** 공통 메타(항상 채움). */
  readonly name: string
  readonly path: string
  readonly size: number
  readonly mtime: number
  readonly ext: string
  /** kind==='image': data URL(`data:image/png;base64,...`). 상한 초과 시 undefined+truncated. */
  readonly dataUrl?: string
  /** kind==='text': 앞부분 텍스트(상한까지). */
  readonly text?: string
  /** kind==='text'|'image': 상한 초과로 잘렸는지(전체 표시 아님 안내). */
  readonly truncated?: boolean
  /** kind==='unsupported': 사유 표시용 라벨(예: '바이너리','크기 초과'). */
  readonly reason?: string
}
```

**`src/shared/ipc/contracts.ts`**:
```ts
// ── preview:* (신규 P6) ──
export interface PreviewReadReq { readonly path: string }
// IpcRequestMap에 추가:
[CHANNELS.PREVIEW_READ]: { req: PreviewReadReq; res: Result<PreviewData> }
```
- import 목록에 `PreviewData` 추가.

**`src/preload/api.ts`** — `ExplorerApi`에 추가 + 구현:
```ts
readonly preview: { read(req: PreviewReadReq): Promise<Result<PreviewData>> }
// api 객체:
preview: { read: (req) => invoke(CHANNELS.PREVIEW_READ, req) }
```

**`src/renderer/infra/api/index.ts`** — 어댑터 추가:
```ts
export const previewApi = {
  read: (path: string): Promise<Result<PreviewData>> => bridge().preview.read({ path })
}
```

**`src/main/ipc/guard.ts`** — zod 스키마 추가:
```ts
export const zPreviewReadReq = z.object({ path: zPath })
```

**`src/main/fs/FileSystemService.ts`** — 읽기 메서드 추가(읽기 계열이므로 이 서비스가 적합):
```ts
/** 미리보기 상한 상수(서비스 내부). */
const PREVIEW_TEXT_MAX = 64 * 1024       // 텍스트 앞부분 64KB
const PREVIEW_IMAGE_MAX = 5 * 1024 * 1024 // 이미지 원본 5MB
const PREVIEW_IMAGE_EXTS = new Set(['png','jpg','jpeg','gif','webp','bmp','ico','svg'])
const PREVIEW_TEXT_EXTS = new Set(['txt','md','json','js','ts','tsx','jsx','css','html','xml','yml','yaml','log','csv','ini','cfg','sh','py','c','h','cpp','java','go','rs',''])
```
```ts
/**
 * 미리보기 데이터를 읽는다(P6b, US-4.3). 경로는 guard에서 정규화·검증된 것.
 * - 디렉토리/미존재 → ENOENT/EISDIR err.
 * - 이미지 확장자 & size ≤ 상한 → base64 data URL.
 * - 텍스트 확장자(또는 무확장자) → 앞부분 N바이트 읽어 바이너리 휴리스틱 후 text/unsupported.
 * - 그 외 → kind:'meta'(아이콘+메타만) 또는 'unsupported'.
 * 모든 분기 throw 금지 → Result<PreviewData>.
 */
async readPreview(path: string): Promise<Result<PreviewData>>
```
- 구현 골자: `lstat`로 존재·디렉토리 확인 → `toEntry`로 공통 메타 → `ext`로 분기. 이미지면 `fsp.readFile`(상한 초과면 truncated unsupported), data URL 조립(MIME은 ext 매핑, svg는 `image/svg+xml`). 텍스트면 `fs.open`+`read`로 **앞부분 N바이트만** 읽고 NUL 바이트 비율 > 임계면 `unsupported(reason:'바이너리')`, 아니면 `text`. 나머지 ext는 `meta`.

**`src/main/ipc/preview.handlers.ts`** (신규 — [경미-3] PM 확정) — 도메인별 register 패턴 일관성을 위해 **신규 핸들러 파일**로 분리:
```ts
export function registerPreviewHandlers(): void
```
- `handleGuarded(CHANNELS.PREVIEW_READ, zPreviewReadReq, ...)` → `guardPath`로 정규화 → `fileSystemService.readPreview(path)`. `session.handlers.ts`/`op.handlers.ts`와 동일한 `isTrustedSender`+`parseArgs`+Result 패턴.

**`src/main/ipc/index.ts`** — 등록 라인 추가:
```ts
import { registerPreviewHandlers } from './preview.handlers'
// registerIpcHandlers() 본문:
registerPreviewHandlers() // P6: preview:read
```
- (워크스페이스와 동일하게 register 함수 호출 1줄 추가. fs.handlers에 끼워넣지 않고 도메인별 파일 분리 — `clipboard.handlers`/`op.handlers`/`session.handlers` 패턴과 일관.)

#### Renderer (frontend)

**`src/renderer/app/stores/uiSlice.ts`** — `previewOpen` 신설:
```ts
readonly previewOpen: boolean           // 추가(현재 없음)
togglePreview(): void                   // Ctrl+P
setPreviewOpen(v: boolean): void
```
- 초기값 `previewOpen: false`. `togglePreview` = `set((s) => { s.previewOpen = !s.previewOpen })`.
- **세션 연동**: `buildSessionSnapshot`(usecases/session.ts)의 `ui.previewOpen`이 현재 하드코딩 `false` → `s.previewOpen`으로 교체. `restoreSession`에서 `snap.ui.previewOpen`을 `setPreviewOpen`으로 복원(현재 ui 복원 누락 — 작은 보완). `applySettings`는 settings 채널이라 무관.

**`src/renderer/ui/preview/PreviewPanel.tsx`** (신규) — App 우측(또는 하단) 도킹 패널:
- `previewOpen` 구독, false면 `null`.
- 미리보기 대상 = **활성 패널의 단일 선택 항목**. 활성 패널 id → `selection[panelId]`에서 selectedPaths가 정확히 1개일 때 그 경로. 0개/다중이면 "항목을 선택하세요" placeholder.
- 선택 경로 변경 시 `previewApi.read(path)` 호출(디바운스 ~150ms, 빠른 키보드 이동 시 과호출 방지). 로딩/에러 상태 자체 보유(useState — 전역 슬라이스 불필요, 단일 패널 국소 상태).
- `PreviewData.kind`로 형식별 렌더러 디스패치.

**`src/renderer/ui/preview/renderers/*`** (신규, SW §9 격리 경계) — 형식별:
- `ImagePreview.tsx`: `<img src={data.dataUrl}>` 축소(maxWidth/maxHeight, object-fit contain). `truncated`면 "원본이 커서 미리보기를 생략했습니다".
- `TextPreview.tsx`: `<pre>`로 `data.text` 표시(monospace, 스크롤). `truncated`면 "앞부분만 표시" 배지.
- `MetaPreview.tsx`: 이름·경로·크기·수정일 표(공통 메타). 'meta' kind 기본.
- `UnsupportedPreview.tsx`: 큰 파일 아이콘 + `data.reason`("바이너리"/"크기 초과"/"미지원 형식").
- (선택) `index.ts`에 `kind → 컴포넌트` 레지스트리 맵 → PreviewPanel이 맵 조회(SW §9 "형식별 등록" 패턴).

**`src/renderer/ui/App.tsx`** — `<LayoutHost />` 옆(workArea 우측)에 `<PreviewPanel />` 마운트. flex row에서 `previewOpen`일 때만 폭 차지(패널 자체가 null 반환으로 제어).

**`src/renderer/app/usecases/commandBus.ts`** — `case 'preview.toggle'`의 `notYet(...)` 제거 → `s.togglePreview(); return true`.

#### DoD(P6b)
- `Ctrl+P`로 PreviewPanel 토글, 재시작 시 `previewOpen` 복원.
- 이미지(png/jpg/...) 단일 선택 → 축소 표시. 텍스트(txt/md/json/...) → 앞부분 표시. 기타 → 메타. 미지원/바이너리/대용량 → 아이콘+사유 폴백.
- **대용량 텍스트(>64KB)**: 앞부분만 + truncated 배지. **대용량 이미지(>5MB)**: 생략 폴백(앱 멈춤 없음). **바이너리(.exe/.zip)**: NUL 휴리스틱으로 unsupported.
- 보안: `preview:read`가 guard(senderFrame·zod·`guardPath`)를 통과, 경로 정규화·상위이탈 차단. 디렉토리/미존재 → Result.err.

---

### 2.3 P6c — 워크스페이스 저장/복원 · backend+frontend

#### 복원 경로 단일화 (⚠️ [중대-2] PM 확정 — 필수)

실측: `tabsSlice.restoreWindows`(line 127~)는 **기존 탭을 비우지 않고 `insertTab(tab, false)`로 누적**한다(부팅 전제 — 부팅 시점엔 탭이 없음). `loadWorkspace`가 이를 그대로 호출하면 기존 탭에 워크스페이스 탭이 **덧붙어** P6c DoD "현재 탭/패널 정리 후 복원"을 위반한다. 다음 3가지를 **필수**로 구현한다(이전 "권장" 표현 폐기):

1. **`tabsSlice`에 `resetWorkspace()` 신규 액션** — 모든 기존 탭/패널/관련 상태(`tabs`·`tabOrder`·`activeTabId`·각 패널의 panelsSlice/selectionSlice 엔트리)를 비운다. `restoreWindows`/`applySnapshot`이 깨끗한 상태 위에 복원하도록 보장하는 정리 액션. (구현: 기존 탭들을 `closeTab` 반복 또는 `set((s) => { s.tabs = {}; s.tabOrder = []; ... })`로 일괄 초기화 — 패널/선택 슬라이스 cleanup 동반.)
2. **복원 로직을 `applySnapshot(snap)` 공통 함수로 추출** — `usecases/session.ts`에 `applySnapshot(snap: SessionSnapshot)`을 두고 내부에서 `hydrateSidebar` + `restoreWindows`(필요 시 ui.previewOpen 복원 포함)를 수행한다. `restoreSession`(부팅)과 `loadWorkspace`(워크스페이스 로드)가 **동일 경로**를 타도록 강제한다(중복 구현 금지). 단, `loadWorkspace`는 `applySnapshot` 호출 **직전에 `resetWorkspace()`를 선행**(부팅은 빈 상태라 reset 불필요·무해).
3. `restoreWindows`는 변경하지 않는다(부팅 호환). 정리는 `resetWorkspace()`가, 복원은 `applySnapshot()`가 담당하는 책임 분리.

#### Backend

**`src/main/persistence/WorkspaceStore.ts`** (신규 — `SessionStore` 패턴 복제):
```ts
export class WorkspaceStore {
  constructor(private readonly paths: PersistencePaths, private readonly getRecentLimit: () => number) {}
  /** workspaces/ 디렉토리의 *.json을 열거해 WorkspaceInfo[](name·savedAt) 반환. */
  async list(): Promise<WorkspaceInfo[]>
  /** 이름→파일경로(파일명 sanitize: validateEntryName 재사용 + 확장자 .json). */
  async save(name: string, snapshot: SessionSnapshot): Promise<void>   // writeJsonAtomic + savedAt 메타
  /** 이름으로 로드 → coerceSession으로 정규화(손상/구버전 안전). 미존재 → ENOENT throw 아닌 폴백? → 핸들러에서 err. */
  async load(name: string): Promise<SessionSnapshot | undefined>
  async delete(name: string): Promise<boolean>
}
```
- **파일명 안전성**: 사용자 입력 이름을 파일명에 쓰므로 `validateEntryName`(paths.ts) 재사용 + 경로 분리자/`..` 차단. 저장 형식: `{ version, savedAt, snapshot }` 래퍼 또는 snapshot에 savedAt 동봉. `list()`는 각 파일 mtime 또는 내부 savedAt 사용.
- **재사용**: `writeJsonAtomic`·`readJsonSafe`·`coerceSession`·`persistencePaths.workspacesDir` 그대로.

**`src/main/persistence/index.ts`** — `WorkspaceStore` 초기화:
- `initPersistence`에서 `const workspace = new WorkspaceStore(paths, () => settings.get().recentLimit)` 생성, `_workspace` 보관, `workspaceStore()` 게터 추가, re-export.

**`src/main/ipc/workspace.handlers.ts`** (신규 — `session.handlers.ts` 패턴):
```ts
export function registerWorkspaceHandlers(): void
```
- `workspace:save`(zod `zWorkspaceSaveReq` 신규: name + snapshot passthrough), `workspace:list`(인자 없음, sender 검증만), `workspace:load`(name), `workspace:delete`(name). 모두 `isTrustedSender`+`parseArgs`+Result.
- guard.ts에 추가: `zWorkspaceSaveReq`(`{ name: z.string().min(1).max(120), snapshot: z.object({version:z.number()}).passthrough() }`), `zWorkspaceLoadReq`, `zWorkspaceDeleteReq`(`{ name: z.string().min(1) }`).

**`src/main/ipc/index.ts`** — `registerWorkspaceHandlers()` 주석 해제·호출:
```ts
import { registerWorkspaceHandlers } from './workspace.handlers'
// ...
registerWorkspaceHandlers() // P6: workspace:*
```

#### Frontend

**`src/renderer/infra/api/index.ts`** — `workspaceApi` 어댑터 추가(preload `bridge().workspace.*`는 이미 존재):
```ts
export const workspaceApi = {
  save: (name: string, snapshot: SessionSnapshot) => bridge().workspace.save({ name, snapshot }),
  list: () => bridge().workspace.list(),
  load: (name: string) => bridge().workspace.load({ name }),
  delete: (name: string) => bridge().workspace.delete({ name })
}
```

**`src/renderer/app/usecases/workspace.ts`** (신규 — `session.ts` 패턴):
```ts
/** 현재 상태를 이름 붙여 저장(buildSessionSnapshot 재사용). */
export async function saveWorkspace(name: string): Promise<boolean>
/** 워크스페이스 목록 조회. */
export async function listWorkspaces(): Promise<WorkspaceInfo[]>
/** 워크스페이스 로드 → resetWorkspace()로 기존 탭/패널 정리 후 applySnapshot()로 복원(부팅과 동일 경로). */
export async function loadWorkspace(name: string): Promise<boolean>
export async function deleteWorkspace(name: string): Promise<boolean>
export async function renameWorkspace(oldName: string, newName: string): Promise<boolean> // load→save(new)→delete(old)
```
- `loadWorkspace`([중대-2] 필수 경로): `workspaceApi.load(name)` → `res.value`(SessionSnapshot)에 대해 **(1) `store.getState().resetWorkspace()`로 기존 탭/패널 전부 정리 → (2) `applySnapshot(res.value)`로 복원**. `applySnapshot`은 `restoreSession`(부팅)과 **공유하는 단일 함수**이므로 복원 정합이 세션과 동일하게 보장된다(중복 구현 금지). **rename은 계약에 채널이 없으므로 load+save+delete 조합**(UI 편의).
- **P6c 신규 산출물 명세(필수)**: `tabsSlice.resetWorkspace()`(정리 액션) + `usecases/session.ts`의 `applySnapshot(snap)`(복원 공통 함수, `restoreSession` 리팩터로 추출). 이 둘은 P6c backend(Store/핸들러)와 별개로 **frontend 트랙 산출물**이며, P6c DoD 측정 대상이다.

**`src/renderer/ui/workspace/WorkspaceDialog.tsx`** (신규 — `SettingsDialog` 다이얼로그 패턴):
- 이름 입력 + "저장" 버튼, 목록(name·savedAt) + 각 항목 "불러오기"/"이름변경"/"삭제". `overlayStyle`/`panelStyle` 재사용.
- `uiSlice`에 `workspaceOpen: boolean` + `openWorkspace()`/`closeWorkspace()` 추가(SettingsDialog와 동일 패턴, `inputContext='dialog'`).
- 진입점: SettingsDialog 내 "워크스페이스 관리…" 버튼 또는 TabBar 메뉴. **신규 커맨드 `workspace.manage`**(키 바인딩 선택 — PRD §8에 없으므로 버튼만으로 충분, 키는 미추가 권장).

**`src/renderer/app/usecases/commandBus.ts`** — (키 추가 시) `case 'workspace.manage': s.openWorkspace(); return true`.

#### DoD(P6c)
- 이름으로 저장 시 `workspaces/<name>.json` 원자적 기록(`writeJsonAtomic`), 목록에 name·savedAt 표시.
- 불러오기 시 현재 탭/패널 정리 후 저장된 탭·패널·경로·레이아웃(grid-4 포함)·정렬/보기/히스토리 복원(`resetWorkspace()` → `applySnapshot()` 경로 → 부팅 세션 복원과 **동일 경로**라 정합 보장).
- **[중대-2] 측정 기준**: 기존에 N개 탭이 열린 상태에서 M개 탭을 가진 워크스페이스를 로드하면 **로드 후 탭 수 == M(워크스페이스 탭 수), 기존 탭 잔존 == 0**. (즉 `Object.keys(store.getState().tabs).length === M`, 누적 N+M 아님.) `applySnapshot`이 `restoreSession`과 동일 코드 경로임을 코드 레벨에서 확인(중복 구현 부재).
- 이름변경(load+save+delete)·삭제(파일 제거) 동작.
- 손상/구버전 워크스페이스 파일 → `coerceSession` 폴백(크래시 프리).
- 보안: 핸들러 guard 통과, 파일명 sanitize로 경로 이탈 차단.

---

### 2.4 P6d — 텔레메트리 옵트인 (검증·문서화 중심)

**현황: 거의 완료.** 남은 작업:

1. **(a) 옵트인 노출 — 이미 충족.** `SettingsDialog`에 "익명 사용 통계" 체크박스(`telemetryOptIn`) + `changeTelemetryOptIn` usecase + `telemetry:set-opt-in` 핸들러 + `SettingsStore.setTelemetryOptIn`(telemetry.json) 모두 구현됨. **추가 코드 불필요.**
2. **(b) 외부 전송 전무 보장·문서화 + ESLint 정적 가드 채택** ([경미-2] PM 확정 — 핵심 P6d 작업):
   - **코드 감사**: 전 코드베이스에 네트워크 송신 API(`fetch`/`XMLHttpRequest`/`net.request`/`http(s).request`/`WebSocket`/외부 URL) 사용처가 없음을 grep으로 확인하고 **결과를 본 계획서/추적성에 명시**. (조사 시점 기준 미발견 — 구현 단계 qa가 재확인.)
   - **회귀 가드(채택 — 필수)**: 실측상 `.eslintrc.cjs`는 **renderer 오버라이드에만** `node:*`/`fs`/`child_process` 금지가 있고 **main 오버라이드에는 import 제한이 없다**(line 84~97은 renderer import 금지만). → `.eslintrc.cjs`의 **main/preload 오버라이드(`files: ['src/main/**/*.ts', 'src/preload/**/*.ts']`)에 `no-restricted-imports`로 네트워크 송신 모듈 정적 금지** 추가:
     ```js
     // main/preload 오버라이드의 no-restricted-imports에 추가:
     paths: [
       { name: 'node:http', message: '텔레메트리/네트워크 전송 금지(D5·ADR-005 §3.3-6) — 외부 송신 코드 도입 차단.' },
       { name: 'node:https', message: '동일 — 네트워크 송신 금지.' },
       { name: 'net', message: '동일 — TCP 소켓 금지.' },
       { name: 'node:net', message: '동일 — TCP 소켓 금지.' },
       { name: 'node:dgram', message: '동일 — UDP 소켓 금지.' }
     ]
     ```
     (기존 main 오버라이드의 `patterns`(renderer import 금지)는 유지하고 `paths` 배열을 신규 추가.) 이로써 "텔레메트리 전송 전무"를 **정적으로 강제**(향후 누구도 송신 모듈 import 불가). grep 감사 + 문서화도 병행.
   - **문서화**: "옵트인 ON이어도 현재 외부 전송 구현이 없으므로 실제 전송되는 데이터는 0이다(플래그만 영속). ESLint가 송신 모듈 import를 정적 차단한다"를 roadmap/PRD에 명시 → doc-sync 반영.
3. **(c) 부팅 재수화 — 신규 `telemetry:get-opt-in` 채널(단일안)** ([중대-3] PM 확정 — 필수):
   - 실측: `loadSettings`(usecases/settings.ts line 23)가 `store.getState().telemetryOptIn`(슬라이스 기본 false)을 `applySettings(res.value, telemetry)`의 2번째 인자로 넘겨 **디스크 저장값(telemetry.json)을 무시**한다(주석에도 명시). 사용자가 ON으로 저장 후 재시작하면 UI 체크박스가 false로 잘못 표시.
   - **확정 단일안**: 신규 채널 **`telemetry:get-opt-in`** 추가(req `void` → `Result<{ optIn: boolean }>`). **`SettingsSnapshot` 계약은 건드리지 않는다**(ui/main 모두 telemetryOptIn을 분리 채널로 다루는 기존 설계 유지). Main은 이미 있는 `settingsStore().isTelemetryOptIn()`(SettingsStore.ts line 50)으로 응답. 부팅 시 `loadSettings`가 이 채널을 호출해 `applySettings(snapshot, optIn)`의 2번째 인자에 **실제 값** 주입.
   - **변경 지점 명세**:
     - `src/shared/ipc/channels.ts` — `TELEMETRY_GET_OPT_IN: 'telemetry:get-opt-in', // impl: P6 (부팅 재수화, D5)` 추가.
     - `src/shared/ipc/contracts.ts` — `TelemetryGetOptInRes` 인터페이스(`{ readonly optIn: boolean }`) 추가 + `IpcRequestMap`에 `[CHANNELS.TELEMETRY_GET_OPT_IN]: { req: void; res: Result<TelemetryGetOptInRes> }`.
     - `src/preload/api.ts` — `ExplorerApi.telemetry`에 `getOptIn(): Promise<Result<TelemetryGetOptInRes>>` 추가 + 구현 `getOptIn: () => invoke(CHANNELS.TELEMETRY_GET_OPT_IN)`.
     - `src/renderer/infra/api/index.ts` — `telemetryApi`에 `getOptIn: (): Promise<Result<{ optIn: boolean }>> => bridge().telemetry.getOptIn()` 추가.
     - `src/main/ipc/session.handlers.ts`(텔레메트리 핸들러가 여기 있음) — `handleGuarded`/`isTrustedSender`로 `CHANNELS.TELEMETRY_GET_OPT_IN` 핸들러 추가 → `ok({ optIn: settingsStore().isTelemetryOptIn() })`. (req 인자 없음 → guard는 sender 검증만, 별도 zod 스키마 불필요하거나 `z.void()`/`z.undefined()`.)
     - `src/renderer/app/usecases/settings.ts` — `loadSettings`에서 `settingsApi.get()` 성공 후 `const optInRes = await telemetryApi.getOptIn(); const optIn = optInRes.ok ? optInRes.value.optIn : store.getState().telemetryOptIn; store.getState().applySettings(res.value, optIn)`. (조회 실패 시 기존 폴백 유지 — 크래시 프리.)

#### DoD(P6d)
- 기본 꺼짐(`DEFAULT_TELEMETRY_OPT_IN=false`) — 충족.
- 옵트인 토글이 telemetry.json에 영속 — 충족.
- **옵트인 ON/OFF 무관하게 외부로 나가는 네트워크 요청이 0건**(qa 네트워크 캡처/정적 검사로 입증) — P6d 핵심 검증.
- **[경미-2] ESLint 정적 가드 채택**: `.eslintrc.cjs` main/preload 오버라이드에 `node:http`/`node:https`/`net`/`node:net`/`node:dgram` `no-restricted-imports` 금지 추가 → lint가 송신 모듈 import를 정적 차단(lint 0건 통과 = 가드 활성·위반 없음).
- **[중대-3] 부팅 재수화**: 옵트인 ON으로 저장 → 재시작 시 `telemetry:get-opt-in`으로 실제 값 조회 → SettingsDialog 체크박스가 ON으로 정확히 표시(기존 false 오표시 해소). 측정: telemetry.json `optIn:true` 상태에서 부팅 후 `store.getState().telemetryOptIn === true`.

---

## 3. 측정 가능한 DoD 종합 (roadmap P6 → 코드 수준)

| roadmap P6 DoD | 코드베이스 수준 측정 기준 |
|---|---|
| 2x2 4분할·4패널 독립·포커스 순환 vs 방향 구분 | `toggleGrid4` 후 `panelIds.length===4`, 각 panelId가 독립 directory/selection. `panel.focusNext`=4순환(`focusNextPanel` `length<=1` 가드 통과해 4패널 순환), `panel.focusDir`=행내 수평. grid-4에서 두 명령 결과 상이(자동 테스트 또는 수동 진리표). |
| **grid-4 F5/F6 대상 결정성([중대-1])** | grid-4에서 `panelPaths().otherPanelId` = 활성 idx ^ 1(같은 행 반대 열). 활성 idx1→대상 idx0, idx2→idx3. single/split-2는 기존(활성 외 첫 패널) 유지. 비결정성 제거. |
| 이미지/텍스트/메타/미지원 미리보기·Ctrl+P | `preview:read`가 kind별 payload 반환, PreviewPanel이 형식별 렌더. 대용량/바이너리 폴백. `togglePreview` 연결·세션 복원. |
| 워크스페이스 저장/불러오기/이름변경/삭제 | 4개 핸들러 동작, `workspaces/*.json` 원자적, 복원이 `resetWorkspace()`→`applySnapshot()`(부팅과 동일 경로) 경유로 세션과 정합. **로드 후 탭 수 = 워크스페이스 탭 수(기존 탭 잔존 0).** |
| 텔레메트리 기본 꺼짐·동의 시에만 전송·미동의 전무 | 옵트인 영속 + **전송 코드 부재 입증**(grep/네트워크 캡처) + **ESLint main 송신 모듈 정적 금지** + **`telemetry:get-opt-in` 부팅 재수화로 UI 표시 정확.** |
| 빌드/타입/린트 | typecheck 0·lint 0·verify 하니스 통과(신규 채널 타입이 Main/Preload/Renderer 일치). |

---

## 4. QA 검증 포인트

**P6a 4분할**
- **포커스 순환 vs 방향 진리표**(핵심): grid-4에서 활성=우상(idx1)일 때 `Tab`→좌하(idx2), `Ctrl+←`→좌상(idx0), `Ctrl+→`→우상 유지. 2분할과 결과가 다름을 명시 검증.
- **focusNextPanel 가드 검증([경미-1])**: grid-4(4패널)에서 Tab 순환이 `focusNextPanel`의 `panelIds.length <= 1` 가드를 통과해 4패널(0→1→2→3→0)을 빠짐없이 순환한다.
- **grid-4 F5/F6 대상 진리표([중대-1])**: grid-4에서 F5/F6 대상 = 같은 행 반대 열. 활성=우상(idx1)→대상 좌상(idx0), 활성=좌하(idx2)→대상 우하(idx3), 활성=좌상(idx0)→대상 우상(idx1). 같은 항목 선택·실행 시 매 호출 동일 대상(비결정성 없음). single/split-2는 기존 동작 유지.
- 4패널 셀렉터 리렌더 격리(한 패널 스트리밍/선택이 다른 3패널 비리렌더).
- grid-4 탭 세션 저장→재시작 복원, single↔split-2↔grid-4 전환 시 패널 누수/활성 패널 불변식.
- 신규 `Ctrl+Shift+\` 충돌 부재(레지스트리 부팅 assert 통과).

**P6b 미리보기**
- 형식별 렌더: png/jpg/gif/svg(이미지), txt/md/json/소스(텍스트), pdf/docx 등(메타/미지원).
- **대용량 텍스트(>64KB)**: 앞부분만+배지, 앱 비차단. **대용량 이미지(>5MB)**: 생략 폴백. **바이너리(.exe/.zip/.dll)**: NUL 휴리스틱 unsupported(이미지로 오인 안 함).
- 보안 교차: `preview:read`에 `..` 이탈 경로·미존재·디렉토리·권한밖 경로 주입 → 실행/읽기 없이 Result.err(ESECURITY/ENOENT/EISDIR/EACCES).
- 빠른 키보드 이동 시 디바운스로 과호출 없음, 선택 0/다중일 때 placeholder.

**P6c 워크스페이스**
- save→list→load 라운드트립이 탭/패널/경로/레이아웃(grid-4 포함)/정렬·보기·히스토리를 정확 복원(세션 복원과 동일 경로 → 스냅샷 재사용 정합).
- **[중대-2] 기존 탭 누적 부재**: 기존 N개 탭이 열린 상태에서 M개 탭 워크스페이스 로드 → 로드 후 탭 수 == M(N+M 아님). `resetWorkspace()`가 선행되어 기존 탭 잔존 0. `loadWorkspace`와 `restoreSession`이 `applySnapshot` 단일 경로 공유(중복 구현 부재) 확인.
- 이름 sanitize(`..`/`/`/예약명 포함 이름 거부 또는 안전화), 동명 덮어쓰기 정책, 삭제 후 list 반영.
- 손상 워크스페이스 파일 로드 → coerce 폴백(크래시 프리). 원자적 쓰기(쓰기 중 종료 무손상).

**P6d 텔레메트리**
- **옵트인 ON/OFF 모두에서 네트워크 요청 0건**(프록시/캡처 또는 정적 import 검사). telemetry.json만 갱신.
- **[경미-2] ESLint 정적 가드**: `.eslintrc.cjs` main/preload에 `node:http`/`node:https`/`net`/`node:net`/`node:dgram` import 금지 추가 후 lint 통과(위반 0). 송신 모듈 import 시 lint 에러로 차단됨을 음성 케이스로 확인.
- **[중대-3] 부팅 재수화**: telemetry.json `optIn:true` 저장 후 재시작 → `telemetry:get-opt-in` 호출 → SettingsDialog 체크박스 ON 표시(`store.getState().telemetryOptIn === true`). 조회 실패 시 폴백으로 크래시 없음.
- 체크박스 토글→영속→재시작 표시 일치.

---

## 5. 리스크 / 에스컬레이션

| ID | 항목 | 판단/제안 | 에스컬레이션 |
|---|---|---|---|
| **R-A1** | grid-4 방향 포커스에 **상/하(up/down) 이동 키가 PRD §8에 없음**. 같은 행 좌우만으로 "방향 이동"을 충족할지, up/down 키도 신설할지. | 제안: left/right만 행내 수평으로 구현(DoD "순환 vs 방향 구분"은 충족). up/down 미도입. | reviewer 계획 검증 시 범위 확정. up/down 키 신설은 PRD §8 변경 → PM. |
| **R-A2** | 4분할 토글 키 `Ctrl+Shift+\` 신설은 **PRD §8 단축키 표에 없는 신규 키**(D4 충돌 회피 표 갱신 필요). | 신규 chord, 레지스트리 충돌 없음 확인. | PRD §8·traceability 단축키 표 갱신을 **doc-sync 게이트**로 처리(요구사항 변경 아님, 표기 갱신). 키 채택 자체는 reviewer 합의. |
| **R-B1** | 미리보기 데이터 채널 신규 추가(P1 동결 예외). 텍스트/이미지 상한·바이너리 휴리스틱 임계값. 핸들러 파일 위치. | **단순 채널 추가로 충분**(썸네일 디코딩 구조 결정 회피 — 원본 바이트 직접 표시). **[경미-3 해소·PM 확정]** 핸들러는 신규 `preview.handlers.ts`+`registerPreviewHandlers()`로 분리(도메인별 register 패턴 일관). | 채널 추가 자체는 과제에서 허용 명시. 상한 수치(64KB/5MB)는 reviewer 확정. SVG를 data URL로 렌더 시 XSS 표면 → CSP·sandbox로 격리되나 reviewer 점검 권장. |
| **R-C1** | 워크스페이스 `rename` 채널이 계약에 없음 → load+save+delete 조합으로 UI 구현. | 조합으로 충분(원자성은 약하나 Should 수준 허용). | 필요 시 `workspace:rename` 신규 채널 추가 여부 reviewer 판단. |
| **R-C2** | 워크스페이스 로드 시 기존 탭 정리 후 복원 — 실측상 `restoreWindows`(line 127~)가 `insertTab(tab, false)`로 **기존 탭을 비우지 않고 누적**(부팅 전제). | **[해소·PM 확정 필수]** `tabsSlice.resetWorkspace()` 신규(정리) + `applySnapshot(snap)` 공통 함수 추출(`restoreSession`·`loadWorkspace` 단일 경로). `loadWorkspace`는 reset→applySnapshot 순. "권장"→"필수" 격상. | 해소(§2.3·DoD 측정 "탭 수=M"). |
| **R-D1** | 텔레메트리 부팅 재수화 결함 — `loadSettings`(line 23)가 슬라이스 기본 false를 넘겨 telemetry.json 저장값 무시. | **[해소·PM 확정 단일안]** 신규 `telemetry:get-opt-in`(req void→`Result<{optIn}>`) 채널로 부팅 시 실제 값 조회. `SettingsSnapshot` 계약 불변. Main은 `isTelemetryOptIn()` 재사용. | 해소(§2.4 (c)·§6 신규채널). |
| **R-X1** | 신규 채널(`preview:read`)·Should 키 추가로 **문서-코드 동기화** 필요(roadmap §0.5, traceability, PRD §8). | 각 하위 단계 QA 통과 직후 doc-sync 게이트 실행(CLAUDE.md 규정). | 자동(doc-sync). 스코프 일탈 아님(기획 Should 범위 내). |

---

## 6. 추적성 매핑

| 추적원 | 본 계획 대응 | 설계 근거 |
|---|---|---|
| **US-1.4 (4분할, S)** | P6a: `toggleGrid4`·LayoutHost grid-4·`focusPanelDir` 4분할 보정 | SW §2.1(Layout='grid-4')·§7.2(focusNext vs focusDir), traceability §1 "4분할" |
| **US-4.3 (미리보기, S)** | P6b: `preview:read` 신규 채널·PreviewPanel·`renderers/*`·`uiSlice.previewOpen` | SW §9(미리보기 렌더러 격리)·§4(PreviewPanel), SA §5.1(ui.previewOpen), traceability §1 "미리보기 패널" |
| **US-5.8 (워크스페이스, S)** | P6c: `WorkspaceStore`·`workspace:*` 핸들러·`workspace` usecase·WorkspaceDialog | SA §5.2(workspaces/ 스냅샷 재사용), SW §9, traceability §1 "명시적 워크스페이스" |
| **결정-D1/D2 (4분할·미리보기 Should 결정)** | P6a/P6b 범위 확정 | PRD §11 결정기록 |
| **결정-D5 (로컬·옵트인 보안)** | P6d: 옵트인 영속 + 전송 전무 입증 + **ESLint main 송신 모듈 정적 금지** + **`telemetry:get-opt-in` 부팅 재수화**, ADR-005 §3.3-6 | SA §3.3, traceability §1 "텔레메트리 옵트인" |
| **feat-D3 (미리보기 패널)** | P6b 전체 | features.md §D3 |
| **신규 채널 ① `preview:read`** | channels/contracts/dto/preload/infra/guard/FileSystemService/**preview.handlers.ts**/index.ts | SA §3.2 카탈로그 확장(P6 Should 예외) |
| **신규 채널 ② `telemetry:get-opt-in`** | channels/contracts/preload/infra/session.handlers + loadSettings 호출. `SettingsSnapshot` 계약 불변(옵트인 분리 채널 유지). | SA §3.3·§3.2, [중대-3] 부팅 재수화 단일안 |

---

## 7. 코드 컨벤션 준수 체크 (계획 자기검증)

- **Result<T,FileOpError>**: `readPreview`·워크스페이스 핸들러 전부 throw 금지, Result 반환. errors.ts `toFileOpError`/`fileOpError` 재사용.
- **zod guard**: 신규 `zPreviewReadReq`·`zWorkspace*Req`를 guard.ts에 추가, 모든 핸들러 `isTrustedSender`+`parseArgs`+`guardPath`.
- **Immer 슬라이스**: `uiSlice`(저빈도)는 Immer 적용 패턴 그대로(`set((s) => {...})`). `tabsSlice` `toggleGrid4`는 기존 `toggleSplit2`와 동일 패턴.
- **셀렉터 격리**: PreviewPanel은 활성 패널 selection만 구독, 4분할 패널은 panelId별 구독 유지(리렌더 격리).
- **계약 단일 출처**: 신규 채널 타입을 channels.ts/contracts.ts/dto에만 정의, Main/Preload/Renderer가 동일 import.
- **persistence 패턴**: WorkspaceStore가 atomic·coerce·paths 재사용, SessionStore와 대칭.
- **주석 스타일**: 파일 상단 JSDoc 블록 + 추적성(US/SA/SW) 참조 주석 — 기존 파일과 동일 형식.

---

> **다음 단계**: 본 v2는 reviewer FAIL(조건부)의 6개 지적([중대-1·2·3]·[경미-1·2·3])을 PM 확정대로 반영했다. reviewer 재검증(PASS 기대) → 통과 후 계약 2종(`preview:read`·`telemetry:get-opt-in`) 동결 → 4트랙 병렬 구현 착수. 각 하위 단계 QA 통과 직후 doc-sync 게이트 실행.
