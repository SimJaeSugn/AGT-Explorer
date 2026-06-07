# H — 신규 UX 기능 3건 구현 계획서 (코드베이스 수준)

> 작성: 테크리드 · 2026-06-07 · 상태: **계획(구현 전)** · 단계 라벨: **P8-UX**
> 대상: ① 상단 전역 아이콘바 ② 사이드바 온오프 토글 ③ 2/4분할 크기 조절(드래그 + 영속)
> 입력 현황: `App.tsx`·`LayoutHost.tsx`·`tabsSlice.ts`·`commandBus.ts`·`sidebarSlice.ts`·`uiSlice.ts`·`keybindings/index.ts`·`shortcuts.ts`·`PanelToolbar.tsx`·`shared/dto`·`persistence/defaults.ts`·`session.ts` 정독 완료.
> 컨벤션 준수: Immer 슬라이스 · 셀렉터 격리 · commandBus 수렴 · tokens 스타일 · Result · coerce 정규화 · DTO 단일 출처.

---

## 0. 요약 / 핵심 결정

| # | 결정 | 근거 |
|---|------|------|
| D-1 | 모든 아이콘바 버튼은 **`execCommand(commandId)`** 로 수렴. 직접 슬라이스 액션 호출 금지. | 키보드/메뉴/버튼 단일 경로(SA §7.1). |
| D-2 | 신규 commandId **2건만** 신설: `sidebar.toggle`, `theme.toggle`. 나머지(layout/file/nav/preview/search/app/workspace/setViewMode)는 기존 또는 소폭 보강으로 충족. | 아래 §1.2 commandId 감사표. |
| D-3 | 사이드바 토글 단축키 = **`Ctrl+B`** (현 keybindings 표에 미사용 확인 — 충돌 없음). | §2.2 충돌 감사. |
| D-4 | 테마 토글은 `theme.toggle` → **light↔dark 2-state 순환**(system 진입 안 함). 현재 resolved 기준으로 반대값. `changeTheme` usecase 재사용(영속까지). | system은 토글 의미가 모호 → 명시적 2-state. |
| D-5 | 분할 비율 상태는 `Tab.splitRatios`(신규 필드). 2분할=`{ col: number }`, 4분할=`{ col: number; row: number }` 단일 형태로 통합(2분할은 row 미사용). | 타입 분기 최소화·coerce 단순화. |
| D-6 | 분할 비율 **영속**은 `TabSnapshot.splitRatios` 신규 필드 → **shared DTO 변경** → backend `coerceTab` 정규화 추가. **frontend/backend 경계 작업.** | 재시작 유지 요구. |
| D-7 | `setViewMode` 전역 명령(`view.setMode.list`/`view.setMode.details`) 신설 — 현재 setViewMode는 PanelToolbar 직접 호출만 존재, commandBus 미경유. 아이콘바 "상세/리스트" 버튼용. | 아이콘바도 commandBus 수렴(D-1). |

**신규 commandId(4):** `sidebar.toggle` · `theme.toggle` · `view.setMode.list` · `view.setMode.details`
**신규 단축키(1):** `Ctrl+B` → `sidebar.toggle` (context: global)
**DTO 변경 범위:** `TabSnapshot`에 `splitRatios?` 추가 1건 → renderer(`session.ts` 직렬화/`tabsSlice` 복원) + main(`defaults.ts` coerce) 양쪽.
**기타 신규 상태/export:**
- `clipboardHasFiles: boolean`(uiSlice) — 붙여넣기 활성조건용 경량 동기 상태(작업 H-4b, §1.6). **비영속**(휘발 런타임).
- `applyTheme.ts`의 `systemPrefersDark` **export 전환 1건** — theme.toggle의 prefersDark 출처(중대-1, §1.4).

---

## 1. 기능 ① 상단 전역 아이콘바

### 1.1 마운트 위치 / 신규 파일

- 신규: **`src/renderer/ui/toolbar/IconBar.tsx`** (전역 아이콘바)
- 신규(선택): **`src/renderer/ui/toolbar/iconBarItems.ts`** — 버튼 정의 테이블(라벨/아이콘/commandId/활성조건 셀렉터)을 데이터로 분리(`keybindings/index.ts`가 단축키를 데이터로 선언한 패턴과 동형).
- 마운트: `App.tsx` 컴포넌트 트리에서 **`<TabBar />` 바로 아래, `<div flex:1>`(Sidebar|LayoutHost|PreviewPanel 행) 바로 위**.

```tsx
// App.tsx (변경 지점만)
<TabBar />
<IconBar />                      {/* ← 신규 */}
<div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
  <Sidebar /><LayoutHost /><PreviewPanel />
</div>
```

### 1.2 commandId 감사표 (4그룹 — "빠진 것" 식별)

| 그룹 | 버튼(라벨) | commandId | 상태 | 활성 조건(disabled 규칙) | 조치 |
|------|-----------|-----------|------|--------------------------|------|
| 레이아웃/뷰 | 사이드바 토글 | `sidebar.toggle` | **신설** | 항상 활성. 토글 상태(눌림) 표시. | commandBus + sidebarSlice는 이미 `toggleSidebar` 존재 → 진입점만 |
| | 2분할 | `layout.toggleSplit2` | 기존 | 활성 탭 있음. layout∈{split-2-*}이면 눌림 표시. | — |
| | 4분할 | `layout.toggleGrid4` | 기존 | 활성 탭 있음. layout==='grid-4'이면 눌림. | — |
| | 미리보기 | `preview.toggle` | 기존 | 항상. `previewOpen`이면 눌림. | — |
| | 상세 보기 | `view.setMode.details` | **신설** | 활성 패널 있음. 현재 viewMode==='details'면 눌림. | commandBus 케이스 추가(setViewMode 경유) |
| | 리스트 보기 | `view.setMode.list` | **신설** | 활성 패널 있음. viewMode==='list'면 눌림. | 동상 |
| 파일 작업 | 새 폴더 | `file.newFolder` | 기존 | 활성 패널이 실제 폴더(경로 ≠ "내 PC")일 때만. | 활성조건 셀렉터 §1.3 |
| | 복사 | `file.copy` | 기존 | 선택 1개 이상. | |
| | 잘라내기 | `file.cut` | 기존 | 선택 1개 이상. | |
| | 붙여넣기 | `file.paste` | 기존 | **`clipboardHasFiles===true`**(빔이면 흐림). | 활성조건용 동기 상태 H-4b 신설(§1.6) |
| | 이름바꾸기 | `file.rename` | 기존 | 선택 정확히 1개. | |
| | 삭제 | `file.trash` | 기존 | 선택 1개 이상. | |
| 탐색 | 뒤로 | `nav.back` | 기존 | 활성 패널 `nav.back.length>0`. | |
| | 앞 | `nav.forward` | 기존 | 활성 패널 `nav.forward.length>0`. | |
| | 위 | `nav.up` | 기존 | 활성 패널 경로 ≠ "내 PC". | |
| | 새로고침 | `panel.refresh` | 기존 | 활성 패널 있음. | |
| | 검색 | `search.open` | 기존 | 활성 패널이 실제 폴더. | |
| 도구 | 설정 | `app.settings` | 기존 | 항상. | |
| | 워크스페이스 | `workspace.manage` | 기존 | 항상. | |
| | 테마 토글 | `theme.toggle` | **신설** | 항상. 현재 resolved 테마 아이콘 표시(☀/🌙). | commandBus + changeTheme 재사용 |

> 그룹 사이에는 `tokens.color.border` 세로 구분선(`<div role="separator">`)을 둔다.

### 1.3 활성조건 셀렉터 (격리)

`IconBar`는 **버튼별로 필요한 최소 상태만** 구독한다(셀렉터 격리). 공통 파생값은 작은 셀렉터 헬퍼로 추출:

```ts
// iconBarItems.ts (또는 app/usecases/selectors.ts 확장)
// 각 항목: enabled(state) => boolean,  active(state) => boolean(눌림 표시)
interface IconBarItem {
  readonly id: string                 // commandId
  readonly label: string              // title/aria-label
  readonly icon: string               // 임시 글리프(P7 아이콘셋 전 PanelToolbar와 동일 텍스트 글리프)
  readonly group: 'layout' | 'file' | 'nav' | 'tool'
  enabled(s: RootState): boolean
  active?(s: RootState): boolean
}
```

활성조건은 **기존 셀렉터 재사용**:
- 선택 개수: `selectionSlice`의 활성 패널 선택 집합 크기(기존 `selection` 맵).
- 클립보드: **신규 경량 동기 상태 `clipboardHasFiles: boolean`(uiSlice)** — 붙여넣기 버튼 `enabled = s.clipboardHasFiles`. 렌더러에는 현재 동기 클립보드 상태가 없고 `clipboardApi.read()`는 비동기 IPC뿐이므로(중대-2), US-7.1 "클립보드 빔→붙여넣기 흐림" 수용기준을 만족시키기 위해 이 상태를 신설한다(작업 **H-4b**, §1.6). "항상 활성" 폴백은 **채택하지 않는다**(수용기준 위반).
- nav 가능: `panels[activePanelId].nav.back/forward.length`.
- "내 PC" 판정: `path === MY_PC_PATH`(`domain/paths`).

> 버튼 클릭 핸들러는 **무조건 `execCommand(item.id)`** 호출. `enabled===false`면 `disabled` 속성 + `opacity:0.4`(PanelToolbar 패턴과 동일, 라인 99 참조). disabled여도 execCommand는 안전(내부에서 no-op/조건분기)하지만 UI에서 선차단.

### 1.4 commandBus 보강 (신규/수정 케이스)

`src/renderer/app/usecases/commandBus.ts`:

```ts
case 'sidebar.toggle':
  s.toggleSidebar()            // 기존 sidebarSlice 액션
  return true
case 'theme.toggle': {
  // resolved 기준 반대값으로. system이면 현재 resolved 계산 후 반대.
  void toggleThemeMode()       // settings usecase 신규 헬퍼(영속 포함)
  return true
}
case 'view.setMode.list': {
  const p = activePanel(); if (p) s.setViewMode(p, 'list'); return true
}
case 'view.setMode.details': {
  const p = activePanel(); if (p) s.setViewMode(p, 'details'); return true
}
```

- `toggleThemeMode()`는 `app/usecases/settings.ts`에 신규. **prefersDark 출처(중대-1 확정):** `applyTheme.ts`의 내부 함수 `systemPrefersDark()`를 **export로 전환**하고 `settings.ts`가 import해 재사용한다(헤드리스/미지원 시 false 보장 로직 단일 출처). 동작:
  ```ts
  // app/usecases/settings.ts (신규)
  import { resolveTheme, systemPrefersDark } from '@renderer/ui/theme/applyTheme'
  /** theme.toggle: 현재 resolved 기준 light↔dark 2-state 토글(즉시 적용+영속은 changeTheme 위임). */
  export async function toggleThemeMode(): Promise<void> {
    const cur = store.getState().theme                          // 'light'|'dark'|'system'
    const resolved = resolveTheme(cur, systemPrefersDark())     // 현재 화면에 보이는 실제 테마
    await changeTheme(resolved === 'dark' ? 'light' : 'dark')   // 반대값 → 즉시 적용 + 영속
  }
  ```
  - **2-state 단일안:** 토글 결과는 항상 명시적 `light`/`dark`(system 진입 안 함). `system` 상태에서 토글하면 현재 resolved의 반대 명시값으로 고정된다.
  - `applyTheme.ts`의 `resolveTheme`는 이미 export됨 → **추가 export는 `systemPrefersDark` 1건뿐**. DOM 적용·영속은 전적으로 기존 `changeTheme()`에 위임(중복 로직 0).
  - `commandBus`는 이미 다른 usecase(fileOps 등)를 import하므로 settings import 추가 일관.

### 1.5 변경 지점 요약 (기능 ①)

| 파일 | 변경 |
|------|------|
| `src/renderer/ui/toolbar/IconBar.tsx` | **신규** — 4그룹 버튼 렌더, 구분선, execCommand 수렴, enabled/active 셀렉터 격리 |
| `src/renderer/ui/toolbar/iconBarItems.ts` | **신규** — 버튼 정의 테이블(데이터) |
| `src/renderer/ui/App.tsx` | `<IconBar />` 마운트(TabBar 아래) |
| `src/renderer/app/usecases/commandBus.ts` | `sidebar.toggle`·`theme.toggle`·`view.setMode.*` 케이스 추가 |
| `src/renderer/app/usecases/settings.ts` | `toggleThemeMode()` 신규(`resolveTheme`+`systemPrefersDark` import 재사용 → `changeTheme` 위임) |
| `src/renderer/ui/theme/applyTheme.ts` | **`systemPrefersDark` export 추가 1건**(`function systemPrefersDark` → `export function systemPrefersDark`). 동작 변경 없음(가시성만). |

### 1.6 클립보드 동기 상태 H-4b (중대-2 확정 — 붙여넣기 활성조건)

**문제(중대-2):** 렌더러에 클립보드 동기 상태가 없고 `clipboardApi.read()`는 비동기 IPC만 제공한다. 따라서 "클립보드 빔→붙여넣기 흐림"(US-7.1)을 동기 셀렉터로 구현할 수 없다. 수용기준은 **유지**하고, 경량 동기 boolean을 신설한다(폴백 "항상 활성" 폐기 — 내부 모순 제거).

**상태 위치:** **`uiSlice`** — 전역 저빈도 UI 플래그(테마·미리보기 토글과 동질). `clipboard` 슬라이스는 별도로 없으며 `selection`/`operations`는 패널·작업 단위라 부적합 → uiSlice 채택.

```ts
// uiSlice.ts — 인터페이스/초기값/액션 추가
readonly clipboardHasFiles: boolean        // 초기 false
setClipboardHasFiles(v: boolean): void     // set((s)=>{ s.clipboardHasFiles = v })
```

**갱신 경로(4):**

| # | 트리거 | 동작 | 위치 |
|---|--------|------|------|
| 1 | 우리 copy/cut 성공 | `clipboardCopy`/`clipboardCut`에서 `copyFiles`/`cutFiles` 성공 직후 `setClipboardHasFiles(true)` | `fileOps.ts` |
| 2 | window `focus` | 외부 앱 클립보드 변경 반영 — `clipboardApi.read()` 후 `setClipboardHasFiles(res.ok && res.value.effect!=='none' && res.value.paths.length>0)` | `IconBar.tsx` 마운트 시 `addEventListener('focus', …)`(언마운트 정리) |
| 3 | 붙여넣기 후 재동기 | `clipboardPaste` 종료 후 동일한 read 재동기(cut 효과면 OS가 비울 수 있음) | `fileOps.ts` |
| 4 | 부팅/아이콘바 마운트 1회 | `IconBar` 마운트 effect에서 `clipboardApi.read()` 1회로 초기화 | `IconBar.tsx` |

> 공통 헬퍼 권장: `fileOps.ts`에 `export async function syncClipboardState(): Promise<void>`(read→setClipboardHasFiles). 경로 2·3·4가 이 헬퍼를 재사용한다(중복 0). 경로 1은 성공이 곧 "있음"이므로 직접 `setClipboardHasFiles(true)`(불필요한 IPC 왕복 회피).

**활성조건:** 아이콘바 "붙여넣기" 버튼 `enabled = s.clipboardHasFiles`. `clipboardPaste` usecase 자체의 "내 PC 차단/빈 클립보드 안내"는 기존대로 방어적으로 유지(상태와 무관하게 안전).

**변경 지점 요약(H-4b):**

| 파일 | 변경 |
|------|------|
| `src/renderer/app/stores/uiSlice.ts` | `clipboardHasFiles` 상태 + `setClipboardHasFiles` 액션 |
| `src/renderer/app/usecases/fileOps.ts` | copy/cut 성공 시 true, paste 후 재동기, `syncClipboardState()` 헬퍼 신규 |
| `src/renderer/ui/toolbar/IconBar.tsx` | 마운트 시 초기 read + `focus` 리스너 등록/정리, 붙여넣기 enabled 셀렉터 구독 |

> **영속 제외:** `clipboardHasFiles`는 휘발 런타임 상태(OS 클립보드가 진실 출처) → 세션 직렬화/coerce 대상 아님. 재시작 시 마운트 read(경로 4)로 복구.

---

## 2. 기능 ② 사이드바 온오프 토글

상태(`sidebarCollapsed`·`toggleSidebar`)와 `Sidebar.tsx`의 `if (collapsed) return null`(라인 36)은 **이미 존재**. 진입점만 연결.

### 2.1 진입점

- 아이콘바 버튼: 기능 ①의 `sidebar.toggle` 버튼(이미 §1.2 포함).
- 단축키: `Ctrl+B` 신규 등록.

### 2.2 단축키 충돌 감사 (`Ctrl+B`)

`keybindings/index.ts`의 `baseBindings`·`tabNumberBindings`(Ctrl+1~9) 전수 확인 결과:
**`ctrl+b` 미사용.** (사용 중 Ctrl 조합: t/w/shift+t/d/tab/shift+tab/arrowleft/arrowright/\\/shift+\\/l/r/f/c/x/v/z/a/,/p/1~9.) → **충돌 없음. `Ctrl+B` 채택.**

```ts
// keybindings/index.ts baseBindings 에 추가 (그룹: '패널 분할' 또는 신설 '레이아웃')
{ chord: 'ctrl+b', commandId: 'sidebar.toggle', context: 'global',
  label: '사이드바 토글', group: '보기' }
```

> `context: 'global'` → 입력 컨텍스트(addressEdit/search/rename/dialog) 중엔 비활성(텍스트 입력 우선). KeyBindingRegistry는 부팅 시 동일 컨텍스트 중복 chord를 assert하므로 `ctrl+b` 유일성 자동 검증됨.

### 2.3 변경 지점 요약 (기능 ②)

| 파일 | 변경 |
|------|------|
| `src/renderer/domain/keybindings/index.ts` | `ctrl+b → sidebar.toggle` 바인딩 1건 추가(단일 출처 → 설정/도움말 자동 반영) |
| `src/renderer/app/usecases/commandBus.ts` | `sidebar.toggle` 케이스(§1.4와 동일 — 중복 아님) |
| (기존) `sidebarSlice.toggleSidebar` / `Sidebar.tsx` | **변경 없음** |

> 영속: `sidebarCollapsed`는 이미 `SidebarSnapshot.collapsed`로 직렬화·복원·coerce됨(`session.ts`·`defaults.ts` 기존). 추가 작업 없음.

---

## 3. 기능 ③ 2분할 / 4분할 크기 조절 (드래그 + 영속)

### 3.1 상태 모델 (renderer)

**도메인 엔티티** `src/renderer/domain/entities/index.ts` — `Tab`에 필드 추가:

```ts
export interface SplitRatios {
  /** 좌/우 분할의 좌측 비율(0.1~0.9). 2분할(split-2-h)·grid-4 가로축 공용. */
  readonly col: number
  /** 상/하 분할의 상단 비율(0.1~0.9). grid-4 세로축·split-2-v 공용. */
  readonly row: number
}
export interface Tab {
  readonly id: string
  readonly layout: LayoutKind
  readonly panelIds: string[]
  readonly activePanelId: string
  /** 분할 비율(미설정 시 균등 0.5/0.5로 간주). */
  readonly splitRatios?: SplitRatios
}
```

> 통합 형태(D-5): 2분할-h는 `col`만, 2분할-v는 `row`만, grid-4는 `col`+`row` 사용. 미사용 축은 0.5 기본 유지.

**상수** (예: `domain/entities` 또는 `LayoutHost` 인접):
```ts
export const SPLIT_MIN_RATIO = 0.15   // 최소 비율(반대편도 0.15 보장 → 클램프 0.15~0.85)
export const SPLIT_DEFAULT = { col: 0.5, row: 0.5 } as const
```

### 3.2 tabsSlice 액션 신규

`src/renderer/app/stores/tabsSlice.ts`:

```ts
// 인터페이스에 추가
/** 분할 비율 설정(클램프 0.15~0.85). axis 별 1축 갱신, 더블클릭 복귀는 0.5 전달. */
setSplitRatio(tabId: string, axis: 'col' | 'row', ratio: number): void
```

구현(Immer):
```ts
setSplitRatio(tabId, axis, ratio) {
  const clamped = Math.max(SPLIT_MIN_RATIO, Math.min(1 - SPLIT_MIN_RATIO, ratio))
  set((s) => {
    const t = s.tabs[tabId]; if (!t) return
    const cur = t.splitRatios ?? { col: 0.5, row: 0.5 }
    t.splitRatios = { ...cur, [axis]: clamped }
  })
}
```

> `toggleSplit2`/`toggleGrid4`는 변경 불필요(미설정이면 LayoutHost가 0.5로 렌더). 단일 복귀 시 `splitRatios`는 남겨도 무해(다음 분할 시 재사용) — 명시 초기화는 선택사항.

### 3.3 LayoutHost 렌더 + 분할선 컴포넌트

`src/renderer/ui/layout/LayoutHost.tsx` 재구성. 신규 컴포넌트 **`src/renderer/ui/layout/SplitDivider.tsx`**.

**축 매핑 규칙(경미-1 확정 — 못박기):** SplitDivider는 **`orientation`(vertical|horizontal)만** 받고 axis를 모른다. **LayoutHost가 layout으로 axis를 매핑한다 — vertical divider→`col` 갱신, horizontal divider→`row` 갱신.** 즉 `split-2-h`=vertical divider 1개(col), `split-2-v`=horizontal divider 1개(row), `grid-4`=vertical(col)+horizontal(row) 독립 2개. `setSplitRatio(tabId, axis, ratio)`의 `axis`는 LayoutHost가 이 매핑으로 결정해 전달한다(divider는 ratio만 보고).

**grid-4 가드(경미-2 확정):** grid-4의 비율 적용·divider 렌더는 **`panelIds.length === 4` 전제**다(`toggleGrid4`가 항상 4패널을 보장 — `focusPanelDir`와 동일 가드). LayoutHost는 grid-4 분기에서 `panelIds.length === 4`를 가드한 뒤에만 divider/비율을 적용한다(예외적 비정상 길이면 균등 폴백).

**2분할(`split-2-h`/`split-2-v`):**
- 현재 `flex: 1` 균등 → **`flex: <ratio>` / `flex: <1-ratio>`** 로 변경.
  - h: 좌 `flex: col`, 우 `flex: 1-col`. v: 상 `flex: row`, 하 `flex: 1-row`.
- 두 패널 사이에 `<SplitDivider orientation="vertical|horizontal" />` 삽입(드래그 핸들, 6px hit area, hover 하이라이트).

**4분할(`grid-4`):**
- 현재 고정 `gridTemplateColumns: '1fr 1fr'` → **`${col}fr ${1-col}fr`**, rows → **`${row}fr ${1-row}fr`**.
- **divider는 독립 2개만(경미-3 확정):** 세로 divider 1개(orientation=vertical → col 조절, 가운데 열 경계, 전체 높이) + 가로 divider 1개(orientation=horizontal → row 조절, 전체 너비). 각각 한 축만 드래그한다(US-7.3 "각각 드래그" 수용기준과 정합).
- **중앙 교차점 양축 동시 드래그 = "Won't for now"(비범위).** 두 divider가 시각적으로 겹치는 중앙 지점에서의 col·row 동시 조절은 이번 범위에서 구현하지 않는다. 사용자는 세로·가로 divider를 각각 드래그한다.

**SplitDivider 시그니처:**
```tsx
interface SplitDividerProps {
  // vertical=좌우 분할 핸들(세로 막대), horizontal=상하 분할 핸들(가로 막대).
  // axis(col/row) 매핑은 divider가 모른다 — LayoutHost가 §3.3 매핑으로 결정.
  readonly orientation: 'vertical' | 'horizontal'
  /** 컨테이너 기준 비율 계산 콜백: vertical→clientX/width, horizontal→clientY/height. */
  onDrag(ratio: number): void          // pointermove 중 setSplitRatio(throttle 불필요, Immer 저빈도)
  onReset(): void                       // 더블클릭 → 0.5 복귀
}
```

**드래그 구현:** `pointerdown` → `setPointerCapture` → `pointermove`에서 컨테이너 `getBoundingClientRect()`로 ratio 계산(`(clientX - rect.left)/rect.width`) → `onDrag(ratio)` → `setSplitRatio`. `pointerup`/capture loss로 종료. 더블클릭 → `onReset`(`setSplitRatio(..,.., 0.5)`).

**최소 제약:** `setSplitRatio` 클램프(0.15~0.85)가 1차. 추가로 각 패널 컨테이너에 기존 `minWidth:220`/`minHeight:160`(현 LayoutHost 값) 유지 → flex-basis와 충돌 시 min이 우선(작은 창에서 핸들 무력화 방지). 매우 좁은 창에서는 clamp 비율보다 px min이 이겨 시각 안정.

### 3.4 영속 (shared DTO 변경 — frontend ↔ backend 경계)

**[shared]** `src/shared/dto/index.ts` — `TabSnapshot`에 추가:
```ts
export interface TabSnapshot {
  readonly id: string
  readonly activePanelId: string
  readonly layout: LayoutKind
  readonly panels: PanelSnapshot[]
  /** 분할 비율(미설정 시 복원에서 0.5 기본). col/row 각 0.15~0.85. */
  readonly splitRatios?: { readonly col: number; readonly row: number }
}
```

**[frontend — 직렬화]** `src/renderer/app/usecases/session.ts` `buildSessionSnapshot()`:
- 탭 매핑 시 `splitRatios: tab.splitRatios` 추가(undefined면 생략 — 직렬화 안정).

**[frontend — 복원]** `src/renderer/app/stores/tabsSlice.ts` `restoreWindows()`:
- `tab` 객체 생성부에 `splitRatios: tabSnap.splitRatios` 주입(있으면).

**[backend — 정규화]** `src/main/persistence/defaults.ts` `coerceTab()`:
- `splitRatios` 정규화 헬퍼 추가. 각 축을 **0.15~0.85 클램프**, 누락/비정상은 필드 생략(또는 `{col:0.5,row:0.5}`). 형태:
```ts
function coerceSplitRatios(raw: unknown): { col: number; row: number } | undefined {
  const o = asObj(raw); if (!o) return undefined
  const clamp = (v: unknown) => Math.max(0.15, Math.min(0.85, asNum(v, 0.5)))
  return { col: clamp(o['col']), row: clamp(o['row']) }
}
// coerceTab return 에: splitRatios: coerceSplitRatios(o['splitRatios'])
```
> `SESSION_SCHEMA_VERSION`은 **유지(1)** 가능: 신규 필드가 optional이고 coerce가 누락을 안전 처리하므로 구버전 세션과 호환(마이그레이션 불요). 단 리뷰어 합의로 +1 결정 가능(R-4).

### 3.5 변경 지점 요약 (기능 ③)

| 파일 | 계층 | 변경 |
|------|------|------|
| `src/shared/dto/index.ts` | shared | `TabSnapshot.splitRatios?` 추가 |
| `src/renderer/domain/entities/index.ts` | renderer/domain | `Tab.splitRatios?` + `SplitRatios` + 상수 |
| `src/renderer/app/stores/tabsSlice.ts` | renderer/app | `setSplitRatio` 액션 + `restoreWindows` 복원 |
| `src/renderer/app/usecases/session.ts` | renderer/app | `buildSessionSnapshot` 직렬화 |
| `src/renderer/ui/layout/LayoutHost.tsx` | renderer/ui | flex/grid 비율 적용 + divider 삽입 |
| `src/renderer/ui/layout/SplitDivider.tsx` | renderer/ui | **신규** 드래그 핸들 |
| `src/main/persistence/defaults.ts` | **main(backend)** | `coerceTab` splitRatios 정규화 |

> **경계 명시:** shared DTO 1건 변경이 main(coerce)·renderer(직렬화/복원/렌더) 양쪽을 건드린다. backend 담당은 `defaults.ts` coerce만, frontend 담당은 나머지. 통합 지점은 "세션 저장→재시작→복원" E2E.

---

## 4. 작업 분해 / 배정 (태스크)

| TID | 태스크 | 담당 | 의존 | 산출물 |
|-----|--------|------|------|--------|
| H-1 | commandId 신설(`sidebar.toggle`/`theme.toggle`/`view.setMode.*`) + `toggleThemeMode` usecase | frontend-dev | — | commandBus·settings 변경 |
| H-2 | `Ctrl+B` 바인딩 추가 | frontend-dev | — | keybindings/index.ts |
| H-4b | 클립보드 동기 상태 `clipboardHasFiles`(uiSlice) + `syncClipboardState` 헬퍼 + fileOps 갱신 경로(copy/cut/paste) | frontend-dev | — | uiSlice·fileOps |
| H-3 | `IconBar.tsx` + `iconBarItems.ts` + App 마운트 (focus 리스너·초기 read는 H-4b 상태 사용) | frontend-dev | H-1, H-4b | 아이콘바 UI |
| H-4 | `Tab.splitRatios` + `setSplitRatio` + 상수 | frontend-dev | — | entities·tabsSlice |
| H-5 | `SplitDivider.tsx` + LayoutHost 비율 렌더 | frontend-dev | H-4 | 드래그 분할 |
| H-6 | `TabSnapshot.splitRatios` DTO + session 직렬화/복원 | frontend-dev | H-4 | dto·session·tabsSlice |
| H-7 | `coerceTab` splitRatios 정규화 | **backend-dev** | H-6(DTO 합의 후) | defaults.ts |
| H-8 | QA: 활성조건·명령수렴·토글·드래그·영속 검증 | qa-engineer | H-3,H-5,H-7 | 검증 보고 |

> **인터페이스 먼저:** H-6의 `TabSnapshot.splitRatios` shape을 H-4/H-7 착수 전 frontend·backend가 합의(이 문서 §3.4가 합의안). 합의 후 병렬.

---

## 5. DoD (측정 가능)

**기능 ① 아이콘바**
- [ ] TabBar 아래 4그룹(구분선 3개) 렌더, 모든 버튼 클릭이 `execCommand`로 수렴(직접 액션 호출 0건 — grep으로 확인).
- [ ] 비활성 조건 충족 시 해당 버튼 `disabled` + `opacity:0.4`: nav.back 불가 / **클립보드 빔(`clipboardHasFiles===false`) 붙여넣기 흐림** / 선택 0개 복사·삭제 / "내 PC"에서 위로·새폴더.
- [ ] **클립보드 동기(H-4b):** copy/cut 직후 붙여넣기 활성화 / 외부 앱에서 비파일 복사 후 창 `focus` 시 붙여넣기 흐림(재동기) / 부팅 후 클립보드에 파일 있으면 마운트 read로 활성. (US-7.1 수용기준 충족, "항상 활성 폴백" 미사용.)
- [ ] 토글형(2분할/4분할/미리보기/상세·리스트/사이드바/테마) 현재 상태 "눌림" 표시.
- [ ] typecheck/lint 0.

**기능 ② 사이드바 토글**
- [ ] 아이콘바 버튼·`Ctrl+B` 양쪽으로 `Sidebar` 표시↔숨김 즉시 전환.
- [ ] 텍스트 입력(주소편집/검색/이름변경) 중 `Ctrl+B` 비반응(global context 차단).
- [ ] collapsed 상태 재시작 유지(기존 SidebarSnapshot 경로).

**기능 ③ 분할 크기 조절**
- [ ] 2분할 드래그로 좌우(또는 상하) 비율 연속 변경, 클램프 0.15~0.85.
- [ ] 4분할 세로 divider(col)·가로 divider(row) **독립 2개**만 동작(중앙 교차 동시 드래그는 비범위 — 구현/검증 대상 아님). `panelIds.length===4`에서만 적용.
- [ ] 더블클릭 → 0.5 균등 복귀.
- [ ] 좁은 창에서 minWidth220/minHeight160 우선(패널 붕괴 없음).
- [ ] **세션 저장→재시작→복원 후 비율 유지**(저장 JSON에 splitRatios 존재, 복원 LayoutHost 반영).
- [ ] 손상/구버전 세션(splitRatios 없음/범위초과) coerce가 0.15~0.85 클램프·기본 0.5로 폴백(크래시 프리).

---

## 6. QA 검증 포인트

- **아이콘바 활성조건·명령 수렴:** 각 버튼 disabled 매트릭스(위 DoD) + 클릭→commandBus 동일 commandId 발행(키보드와 동일 결과). 디버그: 키보드 Alt+← 와 아이콘바 "뒤로" 동일 효과.
- **클립보드 동기(H-4b):** copy/cut 직후 `clipboardHasFiles===true`→붙여넣기 활성 / 외부 앱 텍스트 복사 후 창 focus 시 false→흐림 / paste 후(cut) 재동기 / 부팅 마운트 read 초기화. 셀렉터가 동기 boolean이라 read IPC 없이 즉시 disabled 판정됨을 확인.
- **사이드바 토글:** 버튼/단축키 등가, 입력 컨텍스트 차단, 영속.
- **분할 드래그:** 비율 정확도(rect 기준 — vertical→X, horizontal→Y), 최소 제약, 더블클릭 복귀, grid-4 **독립 2 divider**(세로=col, 가로=row; 교차 동시는 비범위), `length===4` 가드, 좁은 창 안정.
- **영속/복원:** 비율 변경→자동저장(debounce 800ms)→재시작→동일 비율. coerce 폴백(범위초과/누락/문자열 오염 raw).
- **경계 교차:** shared DTO 변경이 main coerce·renderer 직렬화 양쪽 동기(타입 컴파일 + 실 저장 파일 확인).

---

## 7. 리스크 / 에스컬레이션

| ID | 리스크 | 대응 |
|----|--------|------|
| R-1 | 분할 비율 변경이 자동저장 debounce를 과도 트리거(드래그 중 store 다발 변경) | `setSplitRatio`는 Immer 단일 set이고 autosave는 800ms debounce + 직렬화 동등 비교(`session.ts` lastSerialized)로 흡수 — 추가 throttle 불요(검증 필요). |
| R-2 | grid-4 중앙 교차 동시 드래그 UX 복잡 | **"Won't for now"(비범위) 확정(경미-3).** 세로·가로 독립 divider 2개만. US-7.3 "각각 드래그" 수용기준과 정합 — 리스크 해소. |
| R-3 | ~~클립보드 "빔" 활성조건 셀렉터 경로 불명확~~ → **해소(중대-2 확정)** | 렌더러에 동기 클립보드 상태가 없음을 확인. 신규 경량 동기 상태 `clipboardHasFiles`(uiSlice)를 작업 **H-4b**로 신설(§1.6). "항상 활성 폴백"은 US-7.1 수용기준 위반이므로 폐기. 잔여 리스크: `focus` 재동기의 IPC 빈도 — read는 가볍고 focus는 저빈도라 무시 가능. |
| R-4 | `SESSION_SCHEMA_VERSION` 유지 vs +1 | optional+coerce 안전 → 유지 권장. 리뷰어가 +1 요구 시 마이그레이션 no-op 추가. |
| R-5 | 아이콘 글리프(아이콘셋 부재) | P7 아이콘셋 전까지 PanelToolbar식 텍스트 글리프(←→↑⟳☰≣☀🌙 등) 사용, 추후 교체. |
| E-1(에스컬레이션) | 4분할 크기조절 범위가 "교차 동시 드래그까지" 요구로 확대되면 | PM에게 스코프 확인(독립 2축으로 충분한지). |

---

## 8. 추적성 (문서 동기화 대비)

- 본 기능군은 기존 PRD/features에 **명시 항목 부재 가능성** → 신규 UX 개선으로 분류. 구현 Phase 완료 시 `doc-sync` 게이트로 `roadmap.md §0.5`에 `P8-UX` 행 추가 + `traceability.md` 갱신(스코프 일탈 여부 PM 확인 대상).
- 신규 commandId 4건·단축키 `Ctrl+B`는 `keybindings/index.ts` 단일 출처 → 설정 화면/ShortcutHelp 자동 반영(별도 문서화 불요, 코드가 출처).
