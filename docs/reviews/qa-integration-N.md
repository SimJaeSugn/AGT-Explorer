# 통합 QA 보고 — §N 즐겨찾기 UX 향상 (N1 워터마크 · N2 드래그 정렬)

> QA 엔지니어 · 일자: 2026-06-08 · 회차: N(1차 통합 검증)
> 대상: 에픽13(US-13.1/13.2) 신규 2기능 — 렌더러 전용·신규 IPC 채널 0
> 기준: `features.md §N` · `user-stories.md 에픽13` · `flows.md F17/F18` · `architecture-review-N.md`
> 성격: 헤드리스(빌드·타입·린트·verify·코드 교차) 검증 + 런타임 스모크 권장 식별. GUI 실동작 검증 아님.

---

## 판정: **PASS (헤드리스 범위)**

블로커 0 · 높음 0 · 보통 0 · 낮음 2(개선 제안·비차단).

설계 검증(architecture-review-N) [높음-1] 키 충돌 근거 결함이 **구현에서 정정되어 해소**됨(`Alt+↑/↓`→`Alt+Shift+↑/↓`). [보통-1] Panel `position:relative` 누락도 구현에서 반영됨. 빌드·타입·린트·핵심 verify 전부 0 실패. §N 신규 verify 케이스가 핵심 위험(정확일치 판정·정규화·다중일치 결정론·인덱스 환산 경계·순서 영속 단일출처)을 실제로 커버. 기존 즐겨찾기(C4)·별칭(J7)·박스선택(J1)·세션 복원 회귀 없음(코드·verify 경로 확인). **단 GUI 실렌더(워터마크 z-index/반투명·드래그 인디케이터·키보드 포커스 추종)는 헤드리스 한계로 런타임 스모크 권장.**

---

## 1. 빌드 · 타입 · 린트 · verify (실측 Bash 실행)

| 항목 | 명령 | 결과 |
|---|---|---|
| 타입체크 | `npm run typecheck`(node+web) | **PASS** (0 에러) |
| 린트 | `npm run lint` | **PASS** (0 에러·0 경고) |
| 빌드 | `npm run build` | **PASS** (888 모듈·built in 4.36s. import 경고는 기존 remote/api 동적·정적 혼용 — §N 무관·비차단) |
| verify:domain | 헤드리스 | **49 passed, 0 failed** (N1 워터마크 10케이스 포함) |
| verify:store | 헤드리스 | **107 passed, 0 failed** (N2 reorder·영속 11케이스 포함) |
| verify:p5 | 헤드리스 | **52 passed, 0 failed** |
| verify:contrast | 헤드리스 | **실패 0 · 경고 0** (4팔레트 — 워터마크 변경 후에도 본문 대비 게이트 유지) |
| verify:persistence | 헤드리스 | **94 passed, 0 failed** (coerceSidebar 복원 경로 무변경 확인) |

**verify 누계(핵심 5종): 302 passed / 0 failed + contrast 0실패 + persistence 94.**

### §N 신규 verify가 핵심 위험을 커버하는가 — YES
- **N1 `resolveFavoriteWatermark`(domain.verify L174~217, 10케이스)**: 정확일치→basename·별칭 우선·정규화 일치(끝슬래시 `C:\Projects\`·슬래시방향 `C:/Projects`)·하위경로 비매치(과표시 방지·F17 핵심)·비즐겨찾기 비매치·내PC(`''`) 비매치·원격(`sftp://`) 비매치·빈별칭(`'   '`) basename 폴백·다중일치 첫1개(결정론). **수용기준 위험을 직접 타격.**
- **N2 `resolveDropTarget`(domain.verify L219~233, 9케이스)**: insert 위치→to 인덱스 환산의 제거후보정(`insert>from → -1`)·자기뒤 드롭 무동작·맨끝 드롭·범위밖 null. **드래그 정렬의 오프바이원 위험 커버.**
- **N2 `reorderFavorite`+영속(store.verify L488~538)**: 4개 재배열(앞→뒤·뒤→앞·인접스왑)·별칭 경로키 불변·동일/범위밖 무동작·1개 경계 무동작·`buildSessionSnapshot` 순서 그대로 직렬화(영속 단일출처). **순서 영속·범위가드 커버.**

---

## 2. 수용기준 충족 (헤드리스 가능 범위)

### N1 즐겨찾기 경로 워터마크 (US-13.1)
| 수용기준 | 판정 | 근거 |
|---|---|---|
| 정확 일치만 표시·부분/하위 미표시 | ✅ | `favoriteWatermark.ts` normalizeDisplay 후 `===` 매치·하위경로 비매치 verify |
| 별칭 우선·basename 폴백 | ✅ | `favoriteLabels[fav]` trim 비어있으면 `baseName(fav)` — FavoriteRow.display와 동일 규칙 |
| 내PC·원격·비즐겨찾기 미표시 | ✅ | `isMyPc`·`locationKindOf!=='local'` 가드 + verify |
| 다중일치 1개만(결정론) | ✅ | 첫 일치 인덱스 1개 반환·verify "다중일치 첫1개" |
| 뒤 배경 비중첩(가독성·WCAG 영향0) | ✅(코드) | `FavoriteWatermark.tsx` zIndex:0, FileListView zIndex:1 + Panel relative 래퍼. **실렌더 육안은 🟡** |
| aria-hidden·pointer-events:none·userSelect:none | ✅ | `aria-hidden="true"`·`pointerEvents:'none'`·`userSelect:'none'` 명시 → 박스선택·D&D·접근성 트리 무간섭 |
| 4테마 토큰 | ✅ | `palette.ts` LIGHT(.06)/DARK(.08)/BLUELIGHT(.07) `--c-watermark-opacity`+`--c-watermark-color`. 시스템=light/dark resolved 승계 |
| 긴 이름 ellipsis | ✅(코드) | `whiteSpace:nowrap`+`textOverflow:ellipsis`+`maxWidth:100%`+`clamp()` 폰트. **실렌더 🟡** |
| 빈 폴더에도 표시·안내문 비중첩 | ✅(코드) | 빈영역 div `background:transparent`로 워터마크 노출·중앙 flex 안내문과 동일 레이어 미겹침. **실렌더 🟡** |
| 2/4분할 패널 격리 | ✅ | `panelId`별 `panels[panelId].path` 구독·독립 판정 |
| WCAG verify:contrast 0실패 유지 | ✅ | 워터마크는 본문 위 비중첩 장식이라 게이트 비대상·contrast 0실패 실측 |

### N2 즐겨찾기 드래그 정렬 (US-13.2)
| 수용기준 | 판정 | 근거 |
|---|---|---|
| 순서 배열 재배열 | ✅ | `reorderFavorite(from,to)` splice·verify |
| `SidebarSnapshot` 스키마 미변경 영속·복원 | ✅ | `session.ts` `[...s.favorites]`·`SESSION_SCHEMA_VERSION` 무변경·`coerceSidebar` 무변경(persistence verify 94)·main/preload/shared 0변경 |
| `Alt+Shift+↑/↓` 전역 미배정(키 충돌 0) | ✅ | `domain/keybindings` Grep: `alt+arrowup`=nav.up만·`alt+shift+arrow` 미등록. 로컬 onKeyDown은 `altKey&&shiftKey&&!ctrl&&!meta` 가드 |
| 타 섹션 격리 | ✅ | 드래그 상태는 FavoritesSection 행에서만 set·`onDragOver` `reorderActive` 게이트·인덱스는 섹션 내 계산 |
| 경계(0~1개·범위 가드) | ✅ | 0개=섹션 미렌더(`favorites.length>0`)·1개 무동작·`reorderFavorite` 범위가드·verify |
| favoriteLabels(J7) 경로키 불변 | ✅ | 순서만 splice·라벨 맵 경로키라 순서 무관·verify "별칭 보존" |
| 키보드 대체수단(접근성) | ✅(코드) | row tabIndex=0·`Alt+Shift+↑/↓`·focus 추종(rAF). role=option·aria-posinset/setsize/grabbed/roledescription. **실 스크린리더·포커스 육안 🟡** |
| 드래그 시각 피드백(인디케이터·강조) | ✅(코드) | `DropLine`(accent 2px)·`opacity:0.4` 드래그 항목. **실렌더 🟡** |
| ESC/무효 드롭 원상복귀 | ✅(코드) | HTML5 `onDragEnd`→`endFavoriteReorder`·무효 드롭=`resolveDropTarget` null→무동작 |

---

## 3. 경계면 · 회귀 (코드·verify 교차)

- **기존 즐겨찾기(C4 add/remove/toggle)**: `sidebarSlice` 기존 액션 무변경(reorderFavorite만 신규 추가). ✅
- **별칭(J7) 인라인 편집**: FavoriteRow display 로직·setFavoriteLabel 무변경·라벨 경로키 불변. ✅
- **박스선택(J1)**: 워터마크 `pointerEvents:none`·zIndex 0(러버밴드 zIndex 2 위)→ `boxSelect`·컨테이너 onPointerDown 무간섭. ✅
- **내부 D&D(`useDrag`/`dragState`)**: N2는 별개 외부 스토어(`useFavoriteReorder`)로 분리·파일 dragState 미오염. ✅
- **패널 렌더**: Panel 외곽이 `tokens.color.bg` 유지·`position:relative` 래퍼만 추가. ✅
- **세션 복원**: `coerceSidebar`·`SESSION_SCHEMA_VERSION` 무변경·persistence verify 94 통과. ✅
- **FileListView 배경 transparent 부작용**: 외곽 2개 컨테이너만 transparent화(빈영역 div·스크롤 컨테이너). 행/헤더/선택/sticky 로더는 자체 배경 유지(`bgAlt`·`bgSelected` 등). Panel 외곽 동일 `tokens.color.bg` 제공 → 패널 배경/가독성 동일. ✅(실렌더 육안 🟡)

---

## 4. 키 충돌 재확인 (Grep)

- `domain/keybindings/index.ts`: `alt+arrowleft`(nav.back)·`alt+arrowright`(nav.fwd)·`alt+arrowup`(nav.up) 등록. **`alt+shift+arrowup/down` 등록 없음.**
- `KeyboardDispatcher`는 window capture·`inputContext` 기반·`KeyContext`에 `'sidebar'` 없음(architecture-review-N [높음-1] 분석 유효).
- **구현 선택(키 변경안 채택)**: `Alt+Shift+↑/↓`는 전역 미등록 → capture 단계 디스패처가 가로채지 않고 버블 단계 Sidebar 로컬 `onKeyDown` 정상 도달. **충돌 0 확인.** 일반 `Alt+↑`는 즐겨찾기 행에서도 nav.up으로 동작(로컬 핸들러가 shift 없으면 early-return → 회귀 없음).

---

## 발견 결함

### [낮음-1] N2 키보드 이동 시 `Alt+Shift+↑/↓`의 잠재적 OS/플랫폼 예약 미검증 (개선 제안)
- **무엇**: `Alt+Shift+↑/↓`는 앱 전역 미배정으로 충돌은 없으나, 일부 IME/스크린리더/OS 접근성 기능이 `Alt+Shift`(예: 입력 언어 전환 `Alt+Shift`)를 점유할 여지가 있다.
- **어디서**: `Sidebar.tsx` FavoriteRow.onKeyDown.
- **기대 vs 실제**: 모든 환경에서 키보드 재정렬 동작 / 헤드리스로는 OS 레벨 점유 검증 불가.
- **심각도/처리**: 낮음. **런타임 스모크에서 한국어 IME 환경(Alt+Shift 언어전환 충돌 여부) 확인 권장.** 수용기준(키보드 대체수단 제공)은 코드상 충족.

### [낮음-2] N1 워터마크 폰트 `clamp(28px,9vw,96px)`의 vw 기준 (개선 제안)
- **무엇**: 폰트가 `9vw`(viewport 폭) 기준이라 분할 패널(패널 폭 ≪ viewport)에서 의도보다 크게 잡힐 수 있다. ellipsis로 가로 넘침은 막지만 4분할 좁은 패널에서 글자가 과대해 보일 수 있다.
- **어디서**: `FavoriteWatermark.tsx` span.fontSize.
- **기대 vs 실제**: 패널 폭 비례 / `vw`는 패널 아닌 viewport 비례.
- **심각도/처리**: 낮음(레이아웃 깨짐은 없음·ellipsis 가드). **런타임 스모크에서 2/4분할 워터마크 크기 육안 확인 권장.** 필요 시 `cqw`(컨테이너 쿼리) 또는 고정값으로 후속 조정.

---

## 미검증(런타임 스모크 권장 — 헤드리스 한계)

1. **N1 실렌더**: 워터마크가 실제로 목록 뒤(z-index)·반투명·본문 위 비중첩으로 그려지는지, 4테마 각각 반투명도 적정성(과/미표시), 긴 이름 ellipsis, 빈 폴더 안내문과 비중첩, 2/4분할 패널별 독립 표시.
2. **N2 실드래그**: 마우스 드래그 시 DropLine 인디케이터·드래그 항목 0.4 투명·드롭 위치 정확성, ESC 취소 원상복귀.
3. **N2 키보드**: `Alt+Shift+↑/↓` 실 이동·포커스 추종·스크린리더 ARIA 발화, IME 환경 `Alt+Shift` 충돌 여부([낮음-1]).
4. **FileListView transparent**: 실 패널에서 배경 동일성·드롭 하이라이트 box-shadow 정상.

---

## 결론

§N N1·N2는 **헤드리스 검증 범위에서 PASS**(블로커·높음 0). 설계 리뷰의 핵심 우려(키 충돌 [높음-1]·Panel relative [보통-1])가 구현에서 정정됐고, 빌드·타입·린트·핵심 verify 전수 0 실패, 신규 verify가 정확일치/정규화/다중일치/인덱스환산/순서영속 등 핵심 위험을 실제 커버한다. 회귀(C4·J7·J1·세션 복원·패널 배경) 없음. **GUI 실동작(워터마크 렌더·드래그/키보드 정렬·테마별 반투명도·IME 키 충돌)은 런타임 스모크로 마무리 권장.**
