# P7 실행 계획서 — 안정화 · 성능 실측 · 접근성 · 패키징 (1차 릴리스 준비)

> 작성: 테크리드 · 2026-06-07 · 상태: **계획 v1(reviewer 계획 검증 대기) · 구현 미착수**
> 입력: [roadmap.md §3 P7](./roadmap.md) · [PRD.md §3·§7·§12](./PRD.md) · [traceability.md §3](./architecture/traceability.md) · [software-architecture.md §6.3](./architecture/software-architecture.md) · ADR-005(보안)·ADR-006(패키징)
> 대상: roadmap P7 DoD를 **코드베이스 수준**(파일·함수·인터페이스·verify 하니스)으로 구체화. 본 문서는 "무엇을 만들지"의 단일 출처이며, 구현은 reviewer 계획 검증 통과 후 착수한다.
> **이 환경은 Electron GUI 실행 불가(헤드리스)** — 본 계획은 **헤드리스로 구현 가능한 항목**과 **런타임/인증서가 필요해 "준비"만 하는 항목**을 §0에서 명확히 분류하고, 후자를 "구현 완료"로 위장하지 않는다.

---

## 0. 헤드리스 가능 vs 런타임/인증서 차단 분류 (정직성 게이트)

P7 범위 5종을 **이번에 헤드리스로 구현/검증할 수 있는 부분**과 **실측/서명을 사용자 런타임 환경으로 미루는 부분**으로 쪼갠다. 이 표가 P7 DoD의 "충족 가능 범위"를 규정한다.

| P7 범위 | 헤드리스 **구현/검증 대상**(이번 P7) | 런타임/인증서 **차단**(준비만, 사용자 환경에서 실측/서명) |
|---|---|---|
| **1. 성능 3종** | 측정 **하니스·계측 코드** 구축(`scripts/verify-perf.ts` + dev 계측 훅), 200ms 진행률 스로틀 **코드 검증**(OperationManager·verify), 검색 디바운스 경로 코드 검증, 측정 **절차 문서화** | 실제 숫자(1만 항목 첫 렌더 ≤1.5s · 진행률 갱신 ≤200ms · 검색 ≤200ms 가시결과)는 **앱 GUI 실행 필요 → 사용자 런타임 실측** |
| **2. 접근성** | FileListView 행 ARIA 보강, 모달 5종 **포커스 트랩**(첫 포커스·Tab 순환·Esc·복귀)·`role="dialog"`/`aria-modal`, 아이콘바/툴바 aria, 키보드 전기능 접근 점검표, **WCAG AA 대비 자동 측정**(`verify:contrast`) — **전부 헤드리스 구현 가능** | 실제 스크린리더(NVDA/Narrator) 음성 검증·실 포커스 가시성 육안 확인은 런타임 스모크 |
| **3. 코드서명·패키징** | electron-builder.yml **코드서명 설정 구조**(env 기반)·sourcemap 분리 설정·문서화 | **실제 서명**(인증서 `.pfx`+비밀번호 필요)·NSIS 설치/실행/제거 실측 → **사용자 환경** |
| **4. npm audit** | 9건 분석·**런타임 영향 판정**·`npm audit fix`(비파괴) 적용 결정·electron-builder/electron 업그레이드 트레이드오프 문서화 | electron 메이저 업그레이드(파괴적) 실행 시 전 기능 런타임 재검증은 사용자 결정·런타임 |
| **5. F장 QA 매트릭스** | 케이스 표 작성 + **헤드리스 verify 확장**(`verify:fs`/`verify:watch`에 롱패스·정션 링크·권한거부 추가) | 실제 네트워크 드라이브·실제 심볼릭/정션 링크·권한거부 폴더는 환경 의존 → **런타임 매트릭스 실측** |

> **핵심 한 줄**: P7의 **접근성 보강(2)·성능 하니스(1 측정도구)·npm audit 판정(4)·F장 verify 확장(5 일부)·코드서명 설정 구조(3 설정)** 는 이번에 **헤드리스로 구현**한다. **성능 실측 숫자·실제 코드서명·NSIS 실측·실 네트워크/링크/권한 케이스**는 **사용자 런타임 환경에서 실측/서명**하도록 절차만 완비한다.

### 0.1 사전 조사 — 이미 있는 자산(재사용)

조사 결과 P7도 "예약된 토대 위에 보강"하는 작업이며 신규 표면은 제한적이다.

| 영역 | 이미 있는 것(재사용) | 비어 있는 것(P7에서 채울 것) |
|---|---|---|
| **접근성(목록)** | `FileListView`가 `role="grid"`·행 `role="row"`·`aria-selected`·`aria-label`(이름+폴더/파일)·`aria-label="파일 목록"` 보유, `RenameInput` `aria-label`, 박스선택 오버레이 `aria-hidden` | 행 `aria-posinset`/`aria-setsize`(가상 스크롤 위치 고지), 컬럼 헤더 `role`, 스트리밍 상태 `aria-live` 고지(선택), 키보드 포커스 표시(`:focus-visible` outline) |
| **접근성(모달)** | 5종 모달 전부 `role="dialog"`·`aria-modal="true"`·`aria-label` 보유, 일부 첫 포커스(ConfirmDialog 확인버튼)·Esc 처리, `inputContext='dialog'` 전역 단축키 차단 | **공용 포커스 트랩 훅 부재** — Tab/Shift+Tab 순환 가둠·**닫힐 때 직전 포커스 복귀**가 없음(모달별 산발적 첫 포커스만). 공용화 필요 |
| **접근성(대비)** | `palette.ts` 4팔레트(light/dark/bluelight)·블루라이트는 본문 11.04:1로 AA 통과 주석 | **자동 대비 측정 하니스 부재** — 4팔레트×토큰쌍의 WCAG AA(4.5:1 본문/3:1 large)를 verify로 계산·게이트 |
| **성능** | `OperationManager` 200ms 스로틀(`PROGRESS_THROTTLE_MS=200`·`setInterval`), 검색 디바운스 경로, `FileListView` 가상 스크롤(OVERSCAN), 기존 verify 하니스 12종(esbuild 번들→node 패턴) | **성능 측정 하니스 부재** — 스로틀 간격 코드 검증·대형 목록 가시영역 계산 검증·런타임 실측 절차 문서 |
| **패키징/보안** | `electron-builder.yml`(win·nsis·icon 완비, 코드서명 자리 주석), `electron.vite.config.ts`(3엔트리), `mainWindow.ts`(보안옵션 4종·setWindowOpenHandler), `index.ts` CSP, guard senderFrame | `win.signingHashAlgorithms`/`certificateFile`/`certificatePassword`(env) 설정 구조, sourcemap 분리 설정, npm audit 정리 |
| **F장** | `paths.ts`(롱패스 `\\?\`·UNC·예약명·금지문자·`isNetworkDriveRoot`)·`WatchService`·`verify-fs`/`verify-watch` | 롱패스(>260)·정션/심볼릭 링크·권한거부 verify 케이스 추가, 매트릭스 표(헤드리스/런타임 구분) |

---

## 1. 하위 단계 분해 (의존 · 병렬 · 담당)

| 하위 단계 | 목표 | 헤드리스? | 의존 | 담당 |
|---|---|---|---|---|
| **P7-A 접근성 보강** | FileListView 행 ARIA·**모달 5종 공용 포커스 트랩**·아이콘바/툴바 aria·키보드 점검표·포커스 표시 | ✅ 구현 | 없음(기존 UI) | **frontend** |
| **P7-B 대비 측정 하니스** | 4팔레트 WCAG AA 자동 측정(`verify:contrast`)·미달 토큰 보정 | ✅ 구현 | palette.ts | **frontend** 또는 qa |
| **P7-C 성능 하니스** | 200ms 스로틀 코드 검증·대형 목록 윈도잉 계산 검증·**런타임 실측 절차** | ✅ 하니스 / ⚠️ 숫자=런타임 | OperationManager·FileListView | **qa** |
| **P7-D F장 QA 매트릭스** | 롱패스/링크/권한 verify 확장 + 매트릭스 표(헤드리스/런타임 구분) | ✅ 일부 / ⚠️ 실케이스=런타임 | paths.ts·WatchService·verify-fs/watch | **qa** |
| **P7-E npm audit 판정** | 9건 분석·런타임영향 0 판정·`audit fix`(비파괴) 적용 결정·문서화 | ✅ 판정 | package.json | **devops** |
| **P7-F 코드서명·패키징 준비** | electron-builder.yml 서명 설정 구조·sourcemap 분리·**실서명은 인증서 필요 명시** | ✅ 설정구조 / ⚠️ 실서명=인증서 | electron-builder.yml·vite config | **devops** |

**진행 순서(이중 검증 루프 1단위 = P7 전체를 6개 트랙으로 쪼갬)**:
1. 본 계획 → **reviewer 계획 검증**(설계 정합·헤드리스/런타임 분류 정확성) → 반영.
2. 6트랙 병렬: P7-A/B(frontend) ∥ P7-C/D(qa) ∥ P7-E/F(devops). 겹치는 파일 최소(아래 §2 변경지점 분리).
3. 각 트랙 모듈 완성 즉시 → **qa 구현 검증**(verify 하니스 실행·점검표 충족·헤드리스/런타임 분류 준수) → 반영 → 통과 시 doc-sync(roadmap §0.5·traceability) 게이트.

---

## 2. 단계별 파일 · 함수 · 인터페이스 변경 지점

### 2.1 P7-A — 접근성 보강 (frontend · 헤드리스 구현)

#### (1) 공용 포커스 트랩 훅 — **신규**

**신규 `src/renderer/ui/a11y/useFocusTrap.ts`**
```ts
/**
 * 모달 포커스 트랩(WCAG 2.4.3·2.1.2). 열림 동안:
 *  - 첫 포커스를 컨테이너 내 첫 포커서블(또는 지정 ref)로 이동.
 *  - Tab/Shift+Tab 이 컨테이너 밖으로 나가지 않게 순환(첫↔끝 래핑).
 *  - 닫힐 때 직전 포커스 요소로 복귀(opener 복귀, 2.4.3).
 *  - Esc 는 호출측이 처리(기존 모달 Esc 유지) — 여기선 트랩만.
 */
export function useFocusTrap(
  active: boolean,
  containerRef: React.RefObject<HTMLElement>,
  opts?: { initialFocus?: React.RefObject<HTMLElement> }
): void
```
- 구현: `active && container` → `document.activeElement` 저장 → `initialFocus ?? 첫 포커서블` focus. `keydown`(capture) 에서 `Tab` 가로채 포커서블 목록(`a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])` 중 `:not([disabled])`·가시) 첫/끝 래핑. cleanup 시 저장된 요소 `focus()` 복귀.
- **기존 `inputContext='dialog'` 전역 단축키 차단과 독립**(그건 앱 단축키, 이건 DOM Tab 순환). 둘 다 유지.

#### (2) 모달 5종에 트랩 적용 — **수정**

각 모달의 패널 컨테이너에 `ref` 부여 + `useFocusTrap(open, panelRef, { initialFocus })`. **기존 `role="dialog"`/`aria-modal`/`aria-label`·Esc·첫 포커스는 보존**(중복 첫 포커스는 훅으로 일원화).

| 파일 | 변경 | initialFocus |
|---|---|---|
| `ui/dialogs/ConfirmDialog.tsx` | 패널 div에 ref·트랩, 기존 `confirmBtnRef` 첫 포커스 → 훅 `initialFocus`로 이관 | 확인(영구삭제) 버튼 |
| `ui/dialogs/ConflictDialog.tsx` | ref·트랩 추가, Esc 기존 유지 | 기본 액션(건너뛰기/덮어쓰기 중 1) |
| `ui/dialogs/ProgressDialog.tsx` | ref·트랩 추가 | 취소 버튼 |
| `ui/settings/SettingsDialog.tsx` | 내부 패널 div(이미 `onClick stopPropagation`)에 ref·트랩. **오버레이 클릭 닫기(`onClick={close}`)는 유지하되, 트랩은 내부 패널만 가둠** | 닫기(✕) 또는 첫 입력 |
| `ui/workspace/WorkspaceDialog.tsx` | ref·트랩 추가 | 이름 입력 input |
| `ui/dashboard/DashboardModal.tsx` | ref·트랩 추가(스캔 진행 중 닫기 협조취소 유지) | 닫기 버튼 |
| `ui/contextmenu/ContextMenu.tsx` | 메뉴는 트랩 대신 **roving tabindex 유지**(이미 `menuRef.focus()`·`role` 메뉴 패턴)·↑↓ 이동·Esc·Enter 보존. 트랩 훅 비적용(메뉴는 모달 아님) | — |

> **설계 주의**: SettingsDialog는 오버레이 클릭으로 닫히므로 트랩 컨테이너는 **내부 패널 div**(`stopPropagation` 가진 것). 오버레이 자체엔 트랩 미적용(클릭 닫기 보존).

#### (3) FileListView 행 ARIA 보강 — **수정**

`src/renderer/ui/panel/views/FileListView.tsx`:
- **가상 스크롤 위치 고지**: 각 `FileRow`(grid·list 양쪽 `role="row"` div)에 `aria-posinset={index + 1}`·`aria-setsize={visible.length}` 추가 — 윈도잉으로 DOM에 일부만 있어도 스크린리더가 "N개 중 i번째" 인지(WCAG 4.1.2). `RowProps`에 `setSize: number` 전달(이미 `index` 있음).
- **details 컬럼 헤더**: `PanelToolbar`/details 헤더 행(존재 시)에 `role="columnheader"`·정렬 상태 `aria-sort`(asc/desc/none). 헤더가 FileListView 밖이면 해당 헤더 컴포넌트에서 처리.
- **스트리밍 고지(선택)**: 하단 "불러오는 중… N개" 배너에 `aria-live="polite"`(과다 고지 방지 위해 polite·드물게).
- **포커스 표시**: 스크롤 컨테이너(`role="grid"`)는 `outline:'none'` 중 — `:focus-visible` 시 시각적 포커스 링 필요. 행 선택 시각화는 있으나 **키보드 포커스 표시**는 별도. tokens 기반 `boxShadow inset` 또는 컨테이너 `:focus-visible` outline 추가(아래 (4) CSS).

#### (4) 포커스 가시성 전역 CSS — **수정**

`src/renderer/index.html`(전역 리셋 있는 곳) 또는 신규 `ui/theme/a11y.css`:
- `:focus-visible { outline: 2px solid var(--c-accent); outline-offset: 1px; }` — 키보드 포커스만 표시(마우스 클릭은 미표시, WCAG 2.4.7). 버튼/행/input 공통.
- 기존 `outline:'none'` 인라인을 `:focus-visible` 로 대체하지 않도록 주의(인라인이 CSS를 이김 → 인라인 outline:none을 제거하거나 `:focus-visible` 인라인 분기).

#### (5) 아이콘바/툴바 aria — **수정**

`src/renderer/ui/toolbar/IconBar.tsx`·`iconBarItems.ts`·`PanelToolbar.tsx`:
- 아이콘바 컨테이너 `role="toolbar"`·`aria-label="도구 모음"`. 각 버튼은 이미 `aria-pressed`(토글)·툴팁 단축키 보유 — 텍스트 없는 아이콘 버튼에 `aria-label`(툴팁 텍스트와 동일) 보장 점검.
- 보기 드롭다운(PanelToolbar)·브레드크럼 버튼 `aria-label`·주소 편집 input `aria-label` 점검.

#### (6) 키보드 전기능 접근 점검표 — **신규 문서(본 계획 §5에 표)**

`listShortcutGroups()`(KeyBindingRegistry 읽기) 기반으로 **PRD §8 전 단축키 → commandId → 도달 가능 여부** 점검표를 §5에 작성. 마우스 전용 동작(우클릭 메뉴·드래그)의 **키보드 대체 경로**(컨텍스트 메뉴=`Shift+F10`/`Menu` 키, 박스선택=Shift+화살표) 존재 여부를 점검(없으면 보강 항목으로 식별).

### 2.2 P7-B — WCAG 대비 측정 하니스 (헤드리스 구현)

**신규 `scripts/verify-contrast.ts`** (기존 verify 패턴: esbuild 번들→node):
```ts
// palette.ts 의 4팔레트(LIGHT/DARK/BLUELIGHT) 각 토큰쌍 대비를 계산.
// sRGB → 상대휘도 → 대비비(WCAG 2.0 공식). 게이트:
//   본문 텍스트(text vs bg, text vs bg-alt, text vs bg-selected) ≥ 4.5:1 (AA)
//   muted(text-muted vs bg) ≥ 4.5:1 (보조텍스트도 AA 지향) 또는 ≥3:1 경고
//   accent/danger(아이콘·테두리, large/graphical) ≥ 3:1
import { LIGHT_PALETTE, DARK_PALETTE, BLUELIGHT_PALETTE } from '../src/renderer/ui/theme/palette'
```
- 출력: 팔레트별 토큰쌍 대비비 + PASS/FAIL. **미달 토큰은 P7-A에서 팔레트 값 보정**(예: light `--c-text-muted` `#6a737d` on `#ffffff` ≈ 4.6:1 경계 — 측정으로 확정).
- `package.json` 스크립트 `verify:contrast` 추가. **헤드리스로 4팔레트 전수 게이트** → AA 충족 코드로 보증.

### 2.3 P7-C — 성능 측정 하니스 (하니스=헤드리스 / 숫자=런타임)

#### (1) 200ms 진행률 스로틀 코드 검증 — **헤드리스 verify**

**신규 `scripts/verify-perf.ts`**(또는 기존 `verify-ops` 확장):
- `OperationManager`의 `PROGRESS_THROTTLE_MS === 200` 상수 검증 + **스로틀 동작 시뮬레이션**: `startThrottle`/`finish` 경로에서 가짜 `wc`(send 수집 stub)로 N건 progress 주입 → push 간격이 ≥200ms 간격(±tolerance)으로 합산되는지·마지막 강제 push(100%) 발생하는지 검증. trash 경로 per-item push도 점검.
- **헤드리스 가능**: OperationManager는 electron `shell`만 의존 → `stub-electron` 패턴(`scripts/stub-electron.ts` 기존)으로 주입.

#### (2) 대형 목록 윈도잉 계산 검증 — **헤드리스 verify**

- `FileListView`의 윈도잉 산식(`startRow`/`endRow`/`startIdx`/`endIdx`)은 순수 계산 — **순수 함수로 추출**해 검증 가능하게 한다. 신규 `src/renderer/ui/panel/views/windowing.ts`(`computeWindow(scrollTop, viewportH, cellH, colCount, count, overscan)` → `{startIdx, endIdx, totalHeight}`), FileListView가 이를 호출. verify에서 1만 항목·다양한 scrollTop으로 **DOM 후보 수가 (viewportH/cellH + 2·overscan)·colCount 이내 상수**임을 검증(가상 스크롤 불변식).
- **목적**: "1만 항목이어도 렌더 노드 수십 개" 불변식을 헤드리스로 보증(첫 렌더 1.5초의 구조적 전제).

#### (3) 검색 디바운스 경로 검증 — **헤드리스 verify**

- 검색 usecase의 디바운스/필터 순수 경로(`domain/rules/filter`·`computeVisible`)를 1만 항목으로 호출해 **필터 계산 시간**을 측정(참고치)·정확성 검증. 200ms는 입력→가시결과의 **런타임 체감** 지표라 숫자 자체는 런타임이나, 필터 계산이 동기적으로 무겁지 않음(예: <50ms)을 헤드리스 참고 측정.

#### (4) 런타임 실측 절차 — **문서화(차단 항목)**

`docs/P7-execution-plan.md` 본 절 + roadmap P7 DoD에 **런타임 측정 절차**를 명시(앱 빌드 후 사용자 환경):
- **첫 렌더**: 1만 항목 폴더 생성 스크립트(`scripts/make-bench-dir.ps1` 신규·선택) → 폴더 진입 → DevTools Performance 또는 dev 계측 훅(`performance.mark('list:first-paint')` — `FileListView` 첫 청크 렌더 시 mark, 진입 시점부터 측정)으로 ≤1.5s 확인.
- **진행률**: 대용량 복사 중 `op:progress` 수신 간격 로그(dev 계측) ≤200ms 확인.
- **검색**: 1만 항목에서 입력 후 가시결과까지 ≤200ms(`performance.mark`) 확인.
- dev 계측 훅은 **`import.meta.env.DEV` 가드**로 prod 비포함. mark 코드는 헤드리스로 작성(구현), 측정 실행만 런타임.

> **정직 표기**: 실측 숫자(1.5s/200ms)는 본 P7에서 **미충족 표기 유지** — 하니스·계측·절차는 완비하되 "사용자 런타임 환경에서 실측 필요(GUI 차단)"로 roadmap에 명시.

### 2.4 P7-D — F장 Windows 특수케이스 QA 매트릭스 (verify 확장=헤드리스 / 실케이스=런타임)

#### (1) verify 확장 — **헤드리스 가능 항목**

**`scripts/verify-fs.ts` 확장**:
- **롱패스(>260)**: `\\?\` 프리픽스 경로 정규화(`paths.normalizePath`)가 롱패스 보존하는지 — 이미 `hasLongPrefix` 로직 존재, 케이스 추가. 임시 디렉토리에 깊은 중첩(>260자) 생성 후 `fs:list`/`fs:stat`가 `Result` 정상 반환(throw 0) 검증.
- **정션 링크**: Windows `fs.symlink(..., 'junction')`(권한 불요)로 임시 정션 생성 → `fs:list`가 링크를 순환 없이 처리·`isDir` 표기 검증. **심볼릭 링크**는 개발자 모드/관리자 권한 필요 → 가능 시 검증, 불가 시 런타임 표기.
- **권한거부**: 읽기 거부 모의(존재하나 접근 불가) — Windows에서 ACL 조작은 권한 필요 → 미존재 경로(ENOENT)·기존 denied 경로 케이스로 `FileOpError(EACCES/ENOENT)` 1급 전파 검증(throw 0). 실제 ACL 거부 폴더는 런타임.

**`scripts/verify-watch.ts` 확장**(이미 UNC·매핑드라이브 로직 보유):
- 정션 링크 디렉토리 감시 격리(throw 0)·`isLikelyRemotePath` 매핑드라이브 판정(`driveTypeService` 헤드리스 주입) 케이스 보강.

#### (2) F장 매트릭스 표 — **본 계획 §6**

각 케이스 × {헤드리스 verify 가능 / 런타임 실측 필요} × 기대결과를 §6 표로 작성.

### 2.5 P7-E — npm audit 판정 (헤드리스 판정)

> **사전 실측(2026-06-07, 이 환경에서 `npm audit` 실행 결과)**: **총 9건(moderate 3·high 6)**. 내역:
> - **high 6**: `electron`, `app-builder-lib`, `dmg-builder`, `electron-builder`, `electron-builder-squirrel-windows`, `tar`(node-tar)
> - **moderate 3**: `electron-vite`, `esbuild`, `vite`
> - **전부 `devDependencies` 트리**(`package.json` 확인: electron 포함 9건 모두 devDependencies — 런타임 `dependencies`는 dompurify/highlight.js/immer/marked/recharts/zod/zustand로 audit 0건).

> **⚠️ 프롬프트 가정 정정(은폐 금지)**: 작업 지시의 "9건이 전부 electron-builder 빌드 툴체인"은 **부정확**하다. 9건 중 **electron 본체(high 6 중 1)** 가 포함되며, 이는 빌드 툴이 아니라 **앱 런타임 본체**다(다만 `package.json`상 devDependencies에 위치 — electron-vite 관례). 나머지 8건은 electron-builder/vite/esbuild/tar 등 **빌드·패키징 툴체인**이 맞다. 정확히는 "**8건은 빌드 툴체인, 1건(electron)은 런타임 본체이나 dev로 선언됨**".

**판정 (헤드리스 분석 결과)**:

| 패키지 | 심각도 | 성격 | 배포물 영향 | 조치 |
|---|---|---|---|---|
| `esbuild`/`vite`/`electron-vite` | moderate | **dev 서버**(GHSA: dev 서버가 임의 사이트 요청 응답 노출) | **0**(dev 전용, prod 번들 미포함) | `audit fix`(비파괴) 시도, 미해소 시 dev-only 위험으로 수용 |
| `tar`/`app-builder-lib`/`dmg-builder`/`electron-builder`/`electron-builder-squirrel-windows` | high | **패키징 툴체인**(빌드 시에만 실행) | **0**(빌드 머신에서만 동작, 배포물 무관) | electron-builder 메이저 업그레이드는 **파괴적**(NSIS·서명 재검증 필요) → **보류**, 신뢰 빌드 환경 전제로 수용 |
| `electron` | high | **앱 런타임 본체**(다수 UAF·IPC spoof·ASAR 무결성 우회 등) | **배포물에 직접 영향** | **유일하게 런타임 영향 있음** — 업그레이드 검토 필요(아래) |

**electron 업그레이드 트레이드오프**:
- `npm audit fix --force` → `electron@42.3.3` 설치 = **메이저 점프(31→42), 파괴적 변경**. 보안 advisory 다수가 **macOS 전용**(AppleScript·moveToApplicationsFolder)이거나 **이 앱이 쓰지 않는 표면**(setAsDefaultProtocolClient·setLoginItemSettings·offscreen·USB·custom protocol). 본 앱은 **CSP 엄격·senderFrame 검증·setWindowOpenHandler 차단·sandbox·webSecurity·nodeIntegration:false**(ADR-005)로 IPC spoof/창 open 표면을 이미 강하게 닫아 둠.
- **결정 제안(PM/사용자 확정 대상)**: electron 메이저 업그레이드는 **전 기능 런타임 재검증·NSIS 재패키징·서명 재검증을 동반하는 파괴적 변경** → P7(헤드리스)에서 **즉시 실행하지 않음**. 대신 **(a) `npm audit fix`(비파괴, electron 미변경)만 적용**해 dev 툴 패치 가능분 정리, **(b) electron을 최소 패치/마이너로 올리는 안전 범위 업그레이드는 사용자 런타임 검증과 함께 별도 실행**으로 권고. **런타임 영향 판정: 배포물 보안에 직접 영향 있는 것은 electron 1건뿐, 나머지 8건은 dev/빌드 전용으로 배포물 영향 0.**

**조치 산출물**:
- 본 계획 §7에 audit 판정 표·근거 기록(단일 출처).
- `npm audit fix`(비파괴) 적용 여부는 devops가 dry-run 확인 후 실행(이 환경 dry-run: dmg-license 1건만 비파괴 변경 — 사실상 무영향). **`--force`(electron 메이저)는 사용자 결정 전 금지.**

### 2.6 P7-F — 코드서명 · 패키징 준비 (설정구조=헤드리스 / 실서명=인증서)

#### (1) electron-builder.yml 코드서명 설정 구조 — **수정**

`electron-builder.yml` `win:` 섹션에 코드서명 설정을 **env 기반 구조**로 추가(인증서 미보유 시 미서명 빌드로 폴백 가능하게):
```yaml
win:
  target: [{ target: nsis, arch: [x64] }]
  icon: resources/icon.ico
  # 코드서명: 인증서는 CI/사용자 환경에서 환경변수로 주입(레포에 .pfx 미포함).
  #   CSC_LINK=path/to/cert.pfx  CSC_KEY_PASSWORD=****  (electron-builder 표준 env)
  signingHashAlgorithms: [sha256]
  # certificateFile/certificatePassword 대신 표준 env(CSC_LINK/CSC_KEY_PASSWORD) 사용 권장
  #   — 비밀번호를 yml에 평문 저장하지 않음(보안).
  signAndEditExecutable: true
```
- **인증서는 레포에 커밋 금지** — `CSC_LINK`(.pfx 경로)·`CSC_KEY_PASSWORD`(비밀번호)를 **빌드 환경변수로만** 주입. yml엔 알고리즘·옵션만.
- **timestamp 서버**(`timeStampServer`, 예: `http://timestamp.digicert.com`) 옵션 문서화(서명 만료 무관 검증).
- **실제 서명은 유효 코드서명 인증서(`.pfx`)가 필요** → **이 환경에서 미수행**. yml 구조·env 규약·문서만 준비.

#### (2) sourcemap 분리 — **수정**

`electron.vite.config.ts`:
- `renderer.build.sourcemap: true`(또는 `'hidden'`)·`main.build.sourcemap: true` 설정 추가. `'hidden'`이면 `.map` 생성하되 번들에 `//# sourceMappingURL` 주석 미포함 → **배포물에 소스맵 노출 없이 별도 보관**(크래시 디버깅용).
- electron-builder `files`가 `out/**/*` 전체 포함 중 → `.map`을 패키징에서 제외(`files`에 `!out/**/*.map` 추가) 또는 별도 디렉토리 산출. **소스맵을 인스톨러에 넣지 않고 분리 보관**.

#### (3) NSIS 설치/실행/제거 — **런타임 검증(차단)**

- `build-installer.ps1`(기존 G2) 실행 → `dist/`에 인스톨러 산출 → **설치/실행/제거 실측은 사용자 Windows 환경**. 본 P7은 yml 구조·산출 경로만 보증, 실측 절차를 §8 리스크에 명시.

---

## 3. 신규/변경 파일 요약

| 구분 | 파일 | 트랙 | 헤드리스? |
|---|---|---|---|
| 신규 | `src/renderer/ui/a11y/useFocusTrap.ts` | A | ✅ |
| 신규 | `src/renderer/ui/panel/views/windowing.ts`(순수 윈도잉 추출) | C | ✅ |
| 신규 | `scripts/verify-contrast.ts` + `verify:contrast` 스크립트 | B | ✅ |
| 신규 | `scripts/verify-perf.ts` + `verify:perf` 스크립트 | C | ✅(스로틀·윈도잉) |
| 신규(선택) | `scripts/make-bench-dir.ps1`(1만 항목 벤치 폴더) | C | ⚠️ 런타임 측정 보조 |
| 수정 | 모달 5종(`ConfirmDialog`·`ConflictDialog`·`ProgressDialog`·`SettingsDialog`·`WorkspaceDialog`·`DashboardModal`) | A | ✅ |
| 수정 | `FileListView.tsx`(posinset/setsize·windowing 호출), `IconBar`/`PanelToolbar`(aria) | A | ✅ |
| 수정 | `index.html` 또는 `ui/theme/a11y.css`(:focus-visible) | A | ✅ |
| 수정 | `scripts/verify-fs.ts`·`verify-watch.ts`(롱패스·정션·권한 케이스) | D | ✅ 일부 |
| 수정 | `electron-builder.yml`(서명 env 구조·sourcemap 제외), `electron.vite.config.ts`(sourcemap) | F | ✅ 설정 |
| 수정 | `package.json`(`verify:contrast`·`verify:perf` 스크립트, `audit fix` 비파괴 적용 결정) | B/C/E | ✅ |

---

## 4. DoD (측정 가능) — 헤드리스/런타임 구분

| # | DoD 항목 | 검증 방법 | 헤드리스 충족? |
|---|---|---|---|
| A1 | 모달 5종이 열릴 때 첫 포커스·Tab 순환 가둠·Esc·**닫힐 때 opener 복귀** | `useFocusTrap` 단위 검증(jsdom 불가 시 코드리뷰+런타임 스모크) + 코드 적용 확인 | ✅ 구현(육안 스모크는 런타임) |
| A2 | FileListView 행 `role="row"`·`aria-selected`·`aria-label`·`aria-posinset`/`aria-setsize` | 코드 확인 + 스냅샷 | ✅ |
| A3 | 키보드만으로 전 기능 접근(점검표 §5 전 항목 PASS 또는 보강 식별) | §5 점검표 | ✅ 점검·식별 |
| A4 | `:focus-visible` 포커스 표시(키보드 한정) | CSS 확인 + 런타임 육안 | ✅ 코드(육안=런타임) |
| B1 | 4팔레트 본문 텍스트 대비 ≥4.5:1(AA), 미달 토큰 0 | `verify:contrast` PASS | ✅ |
| C1 | 진행률 스로틀 200ms 코드·동작 검증 | `verify:perf` PASS(스로틀 시뮬) | ✅ |
| C2 | 1만 항목 윈도잉 DOM 후보 상수(가상 스크롤 불변식) | `verify:perf` PASS(windowing) | ✅ |
| C3 | **1만 항목 첫 렌더 ≤1.5s·검색 ≤200ms·진행률 ≤200ms 실측** | dev 계측 + 런타임 측정 절차 | ❌ **런타임(GUI 차단)** |
| D1 | 롱패스·정션 링크·권한코드 전파 verify | `verify:fs`/`verify:watch` 확장 PASS | ✅ 일부 |
| D2 | 실제 네트워크 드라이브·심볼릭 링크·ACL 권한거부 폴더 | 런타임 매트릭스 | ❌ **런타임** |
| E1 | npm audit 9건 판정·런타임영향 0(electron 제외)·비파괴 fix 결정 | §7 판정 + `audit fix` dry-run | ✅ |
| F1 | electron-builder.yml 서명 env 구조·sourcemap 분리 설정 | yml/vite 확인 + 미서명 빌드 성공 | ✅ 설정 |
| F2 | **실제 코드서명·NSIS 설치/실행/제거 실측** | 인증서 주입 후 사용자 빌드 | ❌ **인증서/런타임** |

> **P7 종료 판정**: A1~A4·B1·C1~C2·D1·E1·F1 = **헤드리스 충족 가능(이번 구현 대상)**. C3·D2·F2 = **준비 완료 + 사용자 런타임/인증서 환경에서 실측·서명 필요**로 roadmap에 정직 표기(✅로 위장 금지).

---

## 5. 키보드 전기능 접근 점검표 (P7-A 산출)

> `keyBindingRegistry.listBindings()`(PRD §8 단일 출처) 기준. 마우스 전용 동작의 키보드 대체 경로 존재 여부.

| 동작 영역 | 키보드 경로(있음) | 마우스 전용? 대체 경로 점검 |
|---|---|---|
| 탭(열기/닫기/전환/복제/복원) | `Ctrl+T/W/Tab/1~9/D/Shift+T` | ✅ 키보드 완비 |
| 분할/4분할 토글 | `Ctrl+\`·`Ctrl+Shift+\` | ✅ |
| 패널 포커스 이동 | `Tab`(순환)·`Ctrl+←/→`(방향) | ✅ |
| 파일 선택/이동 | `↑↓←→`·`Ctrl/Shift+클릭`·`Ctrl+A` | 박스선택(드래그)은 마우스 전용 → **Shift+화살표 범위선택이 대체**(점검: moveSelect 범위 모드 존재) |
| 파일 작업(생성/이름/삭제/클립보드) | `Ctrl+Shift+N`·`F2`·`Delete`·`Shift+Delete`·`Ctrl+C/X/V` | ✅ |
| 항목 활성화/실행 | `Enter`(폴더 진입·파일 실행) | ✅ |
| 컨텍스트 메뉴(우클릭) | **점검 항목**: `Shift+F10`/`Menu` 키로 행 컨텍스트 메뉴 호출 가능 여부 → **없으면 P7-A 보강 후보**(키보드 접근 갭) |
| 검색/필터 | `Ctrl+F` | ✅ |
| 주소 입력 | `Ctrl+L` | ✅ |
| 미리보기 토글 | `Ctrl+P` | ✅ |
| 사이드바 토글 | `Ctrl+B` | ✅ |
| 설정/대시보드/워크스페이스 | 아이콘바 버튼 → **키보드 포커스 도달 가능**(Tab)·Enter 활성화 점검 | 아이콘바 Tab 도달 + Enter 점검 |
| D&D(패널 간 복사/이동) | 클립보드(`Ctrl+C/X/V`)가 키보드 대체 경로 | ✅ 대체 존재 |
| 즐겨찾기 별칭 편집 | `F2`(사이드바)·Enter/Esc | ✅ |

> **식별된 보강 후보(구현 시 확정)**: (1) 행 컨텍스트 메뉴의 키보드 호출(`Shift+F10`/`Menu`) — 현재 마우스 우클릭만이면 갭. (2) 아이콘바 버튼 Tab 순서·Enter 활성화 보장.

---

## 6. F장 Windows 특수케이스 QA 매트릭스 (P7-D 산출)

| 케이스 | 기대 동작 | 헤드리스 verify 가능 | 런타임 실측 필요 |
|---|---|---|---|
| **롱패스(>260자, `\\?\`)** | `normalizePath` 롱패스 보존·`fs:list`/`stat` `Result` 정상(throw 0) | ✅ `verify:fs`(깊은 중첩 임시폴더) | 실 탐색기 진입·표시 육안 |
| **정션 링크(junction)** | 순환 없이 처리·`isDir` 표기·감시 격리 | ✅ `verify:fs`/`verify:watch`(`fs.symlink junction` 권한불요) | — |
| **심볼릭 링크(symlink)** | 정션과 동일 처리 | ⚠️ 개발자모드/관리자 권한 시만 생성 가능 | ✅ 권한 있는 런타임 |
| **네트워크 드라이브(UNC `\\srv\share`)** | `isUncPath`→eager 폴링·감시 격리 | ✅ `verify:watch`(경로 판정 로직) | ✅ 실 네트워크 공유 동작 |
| **매핑 네트워크 드라이브(`X:\`)** | `driveTypeService`(CIM DriveType=4)→`isNetworkDriveRoot`→eager 폴링 | ✅ `verify:watch`(헤드리스 주입) | ✅ 실 매핑 드라이브·PowerShell CIM |
| **권한 거부(ACL deny)** | `fs:list` `FileOpError(EACCES)` 1급 전파·패널 denied 표시(throw 0) | ⚠️ ENOENT/기존 denied 경로로 코드경로 검증 | ✅ 실 ACL 거부 폴더 |
| **읽기 거부 후 작업** | op:* `EACCES` 실패 격리·부분실패 보고 | ✅ `verify:ops`(모의) | ✅ 실 권한 폴더 |
| **유니코드/이모지 파일명** | 정상 표시·정렬·작업 | ✅ `verify:fs`(유니코드 임시파일) | — |

---

## 7. npm audit 판정 표 (P7-E 산출 · 단일 출처)

> 이 환경 실측: **9건(high 6·moderate 3), 전부 devDependencies 트리. 런타임 `dependencies`(dompurify/highlight.js/immer/marked/recharts/zod/zustand) audit 0건.**

| 패키지 | 심각도 | 분류 | 배포물 보안 영향 | 조치 |
|---|---|---|---|---|
| esbuild | moderate | dev 서버 | 0 | `audit fix`(비파괴) |
| vite | moderate | dev 서버/빌드 | 0 | `audit fix`(비파괴) |
| electron-vite | moderate | 빌드 툴 | 0 | `audit fix`(비파괴) |
| tar | high | 패키징 의존 | 0(빌드 머신) | electron-builder 업그레이드에 종속·보류 |
| app-builder-lib | high | 패키징 툴체인 | 0 | electron-builder 업그레이드 종속·보류 |
| dmg-builder | high | 패키징(macOS, 미사용) | 0 | 보류(win 전용 빌드라 미실행) |
| electron-builder | high | 패키징 툴체인 | 0(빌드만) | 메이저 업그레이드=파괴적(NSIS/서명 재검증)·**보류** |
| electron-builder-squirrel-windows | high | 패키징(미사용 타깃) | 0 | 보류 |
| **electron** | high | **앱 런타임 본체** | **있음**(UAF·IPC spoof·ASAR — 단 다수 macOS/미사용 표면) | **유일 런타임 영향** — `--force`=메이저 점프(31→42, 파괴적). **즉시 미실행**, 안전범위 업그레이드는 런타임 재검증과 별도 |

**최종 결정(헤드리스 가능 조치)**: **`npm audit fix`(비파괴, electron 미변경) 적용** + **나머지(electron 메이저·electron-builder 메이저)는 사용자 결정 전 보류**. **런타임 영향 판정: 배포물 보안 직접 영향은 electron 1건, 8건은 dev/빌드 전용 영향 0.** electron 업그레이드는 ADR-005 보안 하드닝(CSP·senderFrame·sandbox·setWindowOpenHandler 차단)으로 다수 advisory 표면이 이미 차단됨을 근거로 **릴리스 차단 사유 아님**(권고: 안전범위 업그레이드 후속).

---

## 8. 리스크 & 런타임 차단 항목 (정직 표기)

| 리스크 | 영향 | 차단 성격 | 대응 |
|---|---|---|---|
| **성능 3종 실측 불가(GUI 헤드리스)** | C3 미충족 | **런타임 차단** | 하니스·dev 계측·절차 완비 → 사용자 환경 실측. roadmap에 "실측 미충족(런타임)" 정직 표기 |
| **실제 코드서명 불가(인증서 부재)** | F2 미충족 | **인증서 차단** | yml env 구조·문서 완비 → 사용자가 `.pfx`+`CSC_KEY_PASSWORD` 주입해 서명 |
| **NSIS 설치/실행/제거 실측 불가** | F2 미충족 | **런타임 차단** | `build-installer.ps1` 산출 보증 → 사용자 Windows 실측 |
| **실 네트워크/심볼릭/ACL 케이스 불가** | D2 미충족 | **런타임/권한 차단** | 헤드리스 verify(롱패스·정션·UNC 판정) 확장 → 실케이스는 런타임 매트릭스 |
| electron 메이저 업그레이드 시 회귀 | 전 기능 재검증 부담 | 사용자 결정 | 비파괴 fix만 적용, 메이저는 PM→사용자 결정 |
| 포커스 트랩이 기존 Esc/오버레이 닫기와 충돌 | 모달 UX 회귀 | 설계 주의 | SettingsDialog는 내부 패널만 트랩(오버레이 클릭 닫기 보존)·Esc 기존 유지 |
| 인라인 `outline:'none'`이 `:focus-visible` CSS를 이김 | 포커스 미표시 | 구현 주의 | 인라인 outline 제거 또는 `:focus-visible` 분기 |

---

## 9. 분담 (이중 검증 루프 배정)

| 역할 | 트랙 | 산출물 |
|---|---|---|
| **frontend** | P7-A 접근성 · P7-B 대비(또는 qa와 공유) | `useFocusTrap`·모달 5종 트랩·FileListView ARIA·`:focus-visible`·아이콘바 aria·키보드 점검표·`verify-contrast.ts`·팔레트 보정 |
| **qa** | P7-C 성능 하니스 · P7-D F장 매트릭스 | `verify-perf.ts`·`windowing.ts` 추출·dev 계측 훅·런타임 측정 절차 문서·`verify-fs`/`verify-watch` F장 확장·F장 매트릭스 표 |
| **devops** | P7-E npm audit · P7-F 코드서명·패키징 | audit 판정·`audit fix`(비파괴) 적용·electron-builder.yml 서명 env 구조·sourcemap 분리·서명/NSIS 런타임 절차 문서 |

**게이트**: 각 트랙 → qa 구현 검증(verify 실행·점검표·헤드리스/런타임 분류 준수) → 통과 시 **doc-sync 게이트**(roadmap §0.5 진행 현황·traceability §3 갱신: 헤드리스 충족분 ✅, 런타임 차단분은 "준비완료·런타임 실측 필요" 표기). **C3·D2·F2를 ✅로 위장하지 않는다.**

---

## 10. 추적성

- PRD §3(성능)·§7(안정·접근성·보안)·§12(M4 릴리스) · traceability §3(P7)
- ADR-005(보안: 코드서명 무결성·CSP·senderFrame) · ADR-006(패키징: NSIS·서명)
- SW §6.3(성능 폴백·대비) · roadmap §3 P7 DoD
