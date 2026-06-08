# 아키텍처 설계 검증 보고 — §N 즐겨찾기 UX (N1 워터마크 · N2 드래그 정렬)

> 검증자: 독립 reviewer(제3자) · 일자: 2026-06-08 · 회차: N(1차)
> 검증 대상: `system-architecture.md §5-N`(+§8 미해결 4~6) · `software-architecture.md §12` · `directory-structure.md §7` · `traceability.md §1-N`
> 기준 문서: `PRD §6 §N` · `features.md §N`(N1/N2) · `user-stories.md 에픽13`(US-13.1/13.2) · `flows.md F17/F18` · 기존 설계(SA/SW/DS) · 실제 코드(아래 교차 확인 목록)
> 성격: 아키텍처 설계 검증(추적성·정합·실행가능성). 코드 동작(런타임) 검증 아님.

---

## 판정: **PASS (조건부)**

설계는 추적성·코드 정합·비파괴·실행가능성에서 전반적으로 **건전**하다. 신규 IPC 채널 0·신규 npm 의존성 0·신규 ADR 0 판단은 **타당**하며, N2의 핵심 결정(기존 `SidebarSnapshot.favorites` 배열 순서 재사용)은 실제 코드(`session.ts` `[...s.favorites]`·`coerceSidebar` `asStrArray`·`Sidebar` `favorites.map`)와 **정확히 정합**한다.

다만 **N2 키보드 대체수단(`Alt+↑/↓`)의 충돌 없음 근거가 실제 키 디스패치 구현과 어긋난다**(아래 [높음-1]). 이는 설계 자체를 무효화하진 않으나, 명시된 근거("컨텍스트 분리로 충돌 없음")가 코드상 성립하지 않아 **구현 전 키 처리 방식 또는 키 선택을 정정**해야 한다. 해당 항목은 SA §8 미해결 질문 6으로 이미 "확인 필요"로 열려 있어 **구현 차단(블로커)은 아니나**, 설계 문서의 근거 진술을 바로잡아야 team-dev가 잘못된 가정으로 착수하지 않는다.

블로커 0 · 높음 1 · 보통 2 · 낮음 2.

---

## 체크리스트 결과 요약

| # | 항목 | 결과 |
|---|---|---|
| 1 | 추적성(N1·N2 ↔ US-13.x ↔ F17/F18 ↔ 설계, 수용기준 누락) | PASS |
| 2 | 코드 정합(참조 모듈/상태/함수 실재·모순 없음) | PASS(높음-1 키 근거 제외) |
| 3 | N1 접근성/WCAG(pointer-events·aria-hidden·비중첩) | PASS |
| 4 | N2 영속/복원(배열 순서·session.ts·coerceSidebar 정합) | PASS |
| 5 | 신규 채널/의존성/ADR 0 판단 타당성 | PASS |
| 6 | 비파괴(기존 설계·코드·상태 무손상·🔜 유지) | PASS |
| 7 | 실행가능성(team-dev 즉시 착수 구체성) | PASS(높음-1 정정 권고) |

---

## 1. 추적성 (PASS)

- N1 ↔ US-13.1 ↔ F17 ↔ `traceability §1-N` 1행, N2 ↔ US-13.2 ↔ F18 ↔ §1-N 2행으로 **끊김 없이 연결**된다.
- features §N1 수용기준 8개 항목(정확 일치·J7 별칭 폴백·뒤 배경 가독성·4테마 반투명도·긴 이름 말줄임·빈 폴더·패널 격리·비파괴)이 SA §5-N.1 + flows F17 + traceability §1-N에 **전부 반영**됨. 누락 없음.
- features §N2 수용기준 8개(드래그 재정렬·시각 피드백·`SidebarSnapshot` 영속·섹션 격리·키보드 대체·순서만 변경·0~1개 무동작·비파괴)도 SA §5-N.2 + flows F18 + §1-N 2행에 **전부 반영**됨.
- 식별자 권위 일관: 설계가 features `feat-N1/N2`·`US-13.1/13.2`를 그대로 사용(과거 J장에서 발생한 내부번호 드리프트 같은 문제 없음).

## 2. 코드 정합 (PASS — 단 키 근거는 [높음-1])

실제 파일 Read로 교차 확인한 결과, 설계가 참조하는 모듈/상태/함수는 **모두 실재하며 설명과 일치**한다.

| 설계 참조 | 실제 코드 | 정합 |
|---|---|---|
| `SidebarSnapshot.favorites: string[]` 배열 순서 | `sidebarSlice.ts` `favorites: string[]`, `Sidebar.tsx` `favorites.map((p)=>...)` 순서대로 렌더 | ✅ |
| `favoriteLabels` 맵·별칭 폴백 | `sidebarSlice.ts` `favoriteLabels: Record<string,string>`, `FavoriteRow.display = label&&label.trim()!==''?label:baseName(path)` | ✅ (설계의 "J7 동일 폴백 재사용"이 코드와 정확히 일치) |
| `session.ts` `[...s.favorites]` 순서 보존 직렬화 | `session.ts:63` `favorites: [...s.favorites]` | ✅ |
| `coerceSidebar` `asStrArray` 순서 보존 복원 | `main/persistence/defaults.ts` `coerceSidebar` → `asStrArray(o['favorites'])` | ✅ |
| `normalizeDisplay`(domain/paths) | `domain/paths/index.ts:118` 존재(끝 슬래시 정리·드라이브 루트 보존) | ✅ |
| `baseName`·`isMyPc`(domain/paths) | `domain/paths/index.ts:34/27` 존재 | ✅ |
| `locationKindOf`(domain/rules/remoteLocation) | `domain/rules/remoteLocation.ts:35` 존재(`'remote'|'local'`) | ✅ |
| `addFavorite`가 `''`(내 PC) 무시 | `sidebarSlice.ts:159` `if(path==='') return` | ✅ (워터마크 "내 PC 비매치" 근거 성립) |
| 기존 `dragState`/`useDrag`/`DragOverlay` pub/sub + `useSyncExternalStore` | `ui/dnd/dragState.ts`·`useDrag.ts`·`DragOverlay.tsx` 실재(외부 pub/sub·`useSyncExternalStore`) | ✅ (N2 "형태만 모방·별개 인스턴스" 가능) |
| 테마 토큰 추가 위치(`palette.ts`/`tokens.ts`) | `ui/theme/palette.ts`(LIGHT/DARK/BLUELIGHT)·`tokens.ts`(`var(--c-*)` 참조) 실재 | ✅ (`--c-watermark-opacity` 신규 토큰 추가 가능) |

- **존재하지 않는 모듈 가정 없음**: `reorderFavorite`·`useFavoriteReorder.ts`·`favoriteWatermark.ts`·`FavoriteWatermark.tsx`는 모두 "신규(▶)"로 명시돼 있고 기존 코드와 충돌하는 가정이 없다.
- **스키마 미상향 주장 정합**: N2가 `SidebarSnapshot` 구조를 바꾸지 않으므로 `SESSION_SCHEMA_VERSION` 상향 불요(`session.ts`·`coerceSidebar` 무변경)라는 설계 주장은 코드상 **성립**.

> 단, [높음-1]에서 다루는 키보드 충돌 근거는 코드 정합에 어긋난다.

## 3. N1 접근성/WCAG (PASS)

- SA §5-N.1·SW §12.1·DS §7가 일관되게 `position:absolute`(목록 뒤 z-index)·`pointer-events:none`·`aria-hidden="true"`·`user-select:none`을 명시 → 클릭·박스선택·D&D·스크린리더·접근성 트리에 영향 0. **WCAG AA 대비 게이트는 "본문 위 비중첩 배경 장식"이라 비대상**이라는 판단은 타당(본문 텍스트/아이콘이 항상 워터마크 위에 그려짐).
- 4테마(라이트/다크/시스템 resolved/블루라이트) 반투명도 토큰화 방향이 기존 `palette.ts`(이미 4팔레트 + `paletteFor`)·`applyTheme.ts`(bluelight 독립 resolved) 구조와 정합.
- 빈 폴더 안내와 비중첩 배치 명시(features §N1·flows F17·SA §5-N.1).

## 4. N2 영속/복원 (PASS)

- "순서 = `favorites` 배열 순서 자체" 결정은 코드 4지점(`favorites.map` 렌더·`[...s.favorites]` 직렬화·`asStrArray` 복원·`favoriteLabels`는 경로 키라 순서 무관)에서 **스키마 변경 없이 자동 충족**됨을 실코드로 확인. 별도 order 필드를 두지 않는 판단은 과설계 회피로 **적절**.
- `reorderFavorite(from,to)`는 Immer 슬라이스(`sidebarSlice`는 이미 Immer 적용)에 자연스럽게 추가 가능. 기존 `addFavorite`/`removeFavorite`/`setFavoriteLabel` 불변 유지 가능.
- 영속은 기존 디바운스 `startSessionAutosave`(`session.ts`, 800ms·직렬화 동일 시 skip)가 자동 처리 → 신규 영속 경로 0.

## 5. 신규 채널/의존성/ADR 0 판단 (PASS)

- N1·N2 모두 즐겨찾기·패널 경로가 이미 렌더러 상태(`sidebarSlice`·`panelsSlice`)에 상주하고, FS/OS 조회가 불필요하므로 **Main 측 신규 핸들러·채널 불요** 판단은 타당. (대조: §M은 startDrag/clipboard/safeStorage 때문에 Main 필요 — §N은 그 경계를 건드리지 않음.)
- 신규 npm 의존성 0: 드래그는 HTML5 draggable 또는 포인터 이벤트 경량 구현으로 충분(기존 `dragState` 패턴 모방). 타당.
- 신규 ADR 0(SA §5-N.4): 보안 경계·프로세스·네트워크·의존성 변화 없고 기존 결정(C4·J7·ADR-002·SA §5) 승계라 새 트레이드오프 없음 → **ADR 급(되돌리기 비용 큰 구조 결정) 아님** 판단 타당. 순서 데이터 형태·드래그 방식 결정은 SW §12.2·SA §5-N.2에 근거와 함께 기록됨(ADR 없이 본문 기록으로 충분).
- 과소·과대 설계 없음.

## 6. 비파괴 (PASS)

- 기존 트리(`src/main/**`·`src/preload/**`·`src/shared/**`)·기존 슬라이스 액션·세션 스키마 무변경. DS §7가 "Main 측 신규 파일 0"을 명시하고 코드로도 불요 확인.
- 상태 표기 🔜 미착수 일관 유지(SA §5-N 머리말·SW §12·DS §7·traceability §1-N·flows F17/F18·features/US 전부 🔜). roadmap §0.5 단일 출처 원칙도 §1-N에서 재확인.
- N1=표시 전용(즐겨찾기 데이터 불변), N2=순서만 변경(별칭/경로/추가·제거 불변) → 회귀 위험 낮음.

## 7. 실행가능성 (PASS — 높음-1 정정 후 즉시 착수 가능)

- 모듈 경계·파일 위치·시그니처(`resolveFavoriteWatermark(panelPath, favorites, favoriteLabels)`·`reorderFavorite(from,to)`)가 구체적이라 team-dev 착수 가능.
- SA §8 미해결 4~6(워터마크 배치/반투명도 토큰값·토글 제공 여부·키 바인딩)은 전부 **1차 합리적 기본값이 본문에 명시**돼 있어 구현 차단 아님 — 단 미해결 6(키)은 아래 [높음-1]로 근거 정정 필요.

---

## 반영 항목

### [높음-1] N2 키보드 대체수단 `Alt+↑/↓`의 "충돌 없음" 근거가 실제 디스패치 구현과 어긋남
- **무엇**: SA §5-N.2·§8 미해결 6·SW §12(및 traceability §1-N 메모)이 "`Alt+↑/↓`는 사이드바 즐겨찾기 포커스 컨텍스트 한정 → 패널 탐색 `Alt+←/→/↑`(nav)와 **컨텍스트 분리되어 충돌 없음**, 키 처리는 Sidebar 로컬(전역 KeyBindingRegistry 미경유)"이라고 단정한다.
- **위치**: `system-architecture.md §5-N.2`("키보드 대체수단" 단락)·`§8` 미해결 질문 6 · `software-architecture.md §12.2` · `traceability.md §1-N` 메모.
- **문제(코드 교차)**:
  - `ui/keyboard/KeyboardDispatcher.tsx`는 `window`에 **`{capture:true}`** 로 keydown을 듣고, 활성 컨텍스트를 **DOM 포커스 위치가 아니라 `store.inputContext`** 로 결정한다. `KeyContext`(`domain/keybindings`)에는 **`'sidebar'`가 없고**, 사이드바 행에 포커스가 가도 `inputContext`는 `'list'`로 유지된다(사이드바 행은 editable target 아님 → `addressEdit` 승격도 안 됨).
  - `domain/keybindings/index.ts`에 `alt+arrowup → nav.up`(context `'list'`)이 **전역 등록**돼 있고, `commandBus.ts`의 `nav.up`은 활성 패널에서 **무조건 `return true`(handled)** 한다.
  - 따라서 즐겨찾기 행에 포커스가 있어도 사용자가 `Alt+↑`를 누르면 **capture 단계의 전역 디스패처가 먼저 `nav.up`을 실행하고 `preventDefault()/stopPropagation()`** 하여, 버블 단계의 Sidebar 로컬 `onKeyDown`은 **호출되지 않는다**. 즉 설계가 말하는 "컨텍스트 분리로 충돌 없음"은 현재 디스패치 모델에서 **성립하지 않는다**(`Alt+↑`는 사이드바에서도 nav.up으로 가로채짐). `Alt+↓`는 전역 미사용이라 안전하나 `Alt+↑`가 막혀 "위로 한 칸 이동"이 동작하지 않는다.
- **권고(택1, 구현 전 결정)**:
  1. **키 변경**: 전역 미사용 조합으로 바꾼다(예: `Alt+Shift+↑/↓` 또는 `Ctrl+Shift+↑/↓` — `domain/keybindings` 전역 미사용 확인 필요). 이 경우 Sidebar 로컬 핸들러가 정상 동작.
  2. **컨텍스트 모델 확장**: `KeyContext`에 `'sidebar'`(또는 `'favoritesReorder'`)를 추가하고, 즐겨찾기 행 포커스 시 `setInputContext('sidebar')`로 전환 + 레지스트리에 `alt+arrowup/down → favorite.moveUp/Down`(context `'sidebar'`)을 등록한다. 이러면 `Alt+↑/↓`를 유지하면서 전역 `nav.up`을 컨텍스트로 차단(설계가 의도한 "분리"를 실제로 구현). 단 이는 "전역 KeyBindingRegistry 미경유" 진술과 모순되므로 설계 문구를 함께 수정.
  3. **로컬 우선 가로채기**: Sidebar가 capture 단계에서 자기 컨테이너 keydown을 먼저 처리하고 `stopPropagation`(단, 전역은 window-capture라 컴포넌트 capture가 먼저 실행됨을 보장하도록 구현·검증 필요 — 취약).
- **블로커 아님 근거**: 키 바인딩은 SA §8 미해결 6으로 이미 "확인 필요"로 열려 있어 구현 착수를 막지 않는다. 그러나 **설계 문서의 "충돌 없음/컨텍스트 분리" 근거 문장은 사실과 다르므로 정정**해야 team-dev가 오해 없이 위 1~2안 중 선택한다. 마우스 드래그 정렬(N2 본기능)·N1은 이 항목과 무관하게 진행 가능.

### [보통-1] 워터마크 배경 레이어 마운트에 `Panel` 컨테이너 `position:relative` 전제 누락
- **무엇**: 설계는 `Panel.tsx`가 `FileListView` 뒤에 `position:absolute` 형제 레이어(또는 `FavoriteWatermark.tsx`)를 둔다고 하나, **절대 배치의 기준 컨테이너**를 명시하지 않았다.
- **위치**: `system-architecture.md §5-N.1`(렌더 위치)·`software-architecture.md §12.1`(UI 배치)·`directory-structure.md §7`(Panel.tsx).
- **문제**: 실제 `ui/panel/Panel.tsx` 외곽 div는 `display:flex; flexDirection:column`이며 **`position:relative`가 없다**. `position:absolute` 워터마크가 Panel 본문에 정확히 갇히려면 기준 컨테이너에 `position:relative`가 필요하다(없으면 가장 가까운 positioned 조상 또는 viewport 기준으로 어긋남).
- **권고**: 설계에 "워터마크 레이어를 감싸는 Panel(또는 본문 영역) 컨테이너에 `position:relative` 부여, 워터마크는 그 안에서 `inset:0`(또는 중앙/구석) 절대배치, `FileListView`는 같은 컨테이너 내 더 높은 z-index"를 1줄 추가. 구현 난도 낮음.

### [보통-2] N1 "다중 일치 시 1개만" 규칙이 설계 시그니처/순수함수 명세에 반영 약함
- **무엇**: features §N1 "다중 일치" 행은 "같은 경로가 즐겨찾기에 둘 이상이면 첫 항목(또는 별칭 있는 항목) 1개만 표시"를 요구한다.
- **위치**: `software-architecture.md §12.1` `resolveFavoriteWatermark` 시그니처 주석·`system-architecture.md §5-N.1`.
- **문제**: 설계 시그니처는 "정확 일치(===)"만 기술하고 다중 일치 시 **선택 규칙(첫 항목 우선·별칭 항목 우선)** 을 명시하지 않았다. 코드상 `favorites`는 중복을 `addFavorite`이 막지만(`includes` 가드), `hydrateSidebar`/외부 스냅샷 경로로 중복이 들어올 가능성을 배제하긴 어렵다(방어적). 순수함수가 첫 매치만 반환하면 충족되나 명세에 없으면 구현자 임의 판단이 된다.
- **권고**: `resolveFavoriteWatermark` 명세에 "복수 매치 시 `favorites` 배열의 **첫 일치 인덱스 1개만** 반환(겹쳐 깔지 않음)"을 1줄 명시. (수용기준 충족·결정론 보장.)

### [낮음-1] N1 셀렉터 구독 범위 — 리렌더 격리 원칙과의 정합 주석 보강
- **무엇**: N1 워터마크는 `favorites`·`favoriteLabels`(사이드바 슬라이스) 전체를 구독한다. SW §5.2 "최소 셀렉터" 원칙상 favorites 변경이 모든 패널 워터마크를 리렌더할 수 있다.
- **위치**: `software-architecture.md §12.1`(셀렉터 단락).
- **문제(경미)**: 즐겨찾기 변경은 저빈도(`sidebarSlice` 갱신 빈도 "낮음", SW §5.2)라 성능 실질 영향 미미하나, 설계가 "최소 구독"을 강조하므로 일관성 차원의 주석이 좋다.
- **권고**: "워터마크는 자기 패널 `path` + `favorites`/`favoriteLabels` 구독 — favorites는 저빈도 갱신이라 리렌더 비용 무시 가능(파생 메모이즈로 텍스트 계산)" 정도 1줄. 선택적.

### [낮음-2] N2 섹션 조건부 렌더(`favorites.length>0`)와 "0~1개 무동작" 정합 — 명시 권고
- **무엇**: 실제 `Sidebar.tsx`는 `favorites.length>0`일 때만 즐겨찾기 섹션을 렌더한다. 즉 0개면 드래그 대상 자체가 없고, 1개면 섹션은 보이나 재정렬 의미 없음.
- **위치**: `software-architecture.md §12.2`·`system-architecture.md §5-N.2`(0~1개 무동작).
- **문제(경미)**: 설계는 "0~1개 무동작"을 말하나 0개는 섹션 미렌더라 자연 충족, 1개는 드래그 시작은 가능하되 드롭 위치가 자기 자리뿐임을 구현이 처리해야 한다. 큰 문제 아님.
- **권고**: "0개=섹션 미렌더(자연), 1개=드래그 시작 허용하되 유효 드롭 위치 없음→원위치" 정도로 경계 명시. 선택적.

---

## 확인 필요 (사용자/PM 판단)

1. **[높음-1과 연동] N2 키보드 대체수단 키 선택** — `Alt+↑/↓` 유지(컨텍스트 모델 확장 필요·1~2안)할지, 전역 미사용 조합(`Alt+Shift+↑/↓` 등)으로 변경할지. 접근성 수용기준(키보드 재정렬 제공)은 어느 쪽이든 충족되나, **현 설계 문구("Alt+↑/↓·컨텍스트 분리로 충돌 없음")는 코드상 거짓**이므로 결정과 함께 SA §5-N.2/§8-6·SW §12.2 문장을 정정해야 한다. → 중대도상 PM이 사용자에게 올릴 가치 있음.
2. **N1 토글 제공 여부**(SA §8-5) — 1차 "항상 표시"(설정 토글 없음) 기본값으로 진행할지. 비차단(후속 `uiSlice` 1필드 확장 여지 열림).
3. **N1 워터마크 배치·반투명도 토큰값**(SA §8-4·flows §5) — 중앙 vs 구석·테마별 불투명도. UI 디자인 단계 확정 사안, 구현 비차단.

---

## 결론

설계의 핵심 골격(추적성·코드 정합·비파괴·신규 0 판단·영속 정합)은 **신뢰할 수 있으며 team-dev 착수 가능 수준**이다. 단 **[높음-1] 키보드 충돌 근거가 실제 디스패치 코드와 어긋나므로**, 구현 착수 전 설계 문서의 해당 근거 문장을 정정하고 키 처리 방식(키 변경 또는 컨텍스트 모델 확장)을 확정할 것. [보통-1/2]는 구현 모호성 제거를 위해 반영 권고, [낮음-1/2]는 선택적. 이 항목들 반영 후 재검증 없이 진행 가능하다고 판단한다(블로커 0).
