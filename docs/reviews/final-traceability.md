# 최종 추적성 검증 보고 — MVP(P0~P5) 기획→설계→구현

> 검증: 독립 검증 담당(Reviewer) · 2026-06-07
> 대상: `E:\03.프로젝트\explorer\src` 전체
> 기준: PRD.md(MoSCoW·D1~D5·§8 단축키·§7 비기능) · user-stories.md(Must 수용기준) · features.md · architecture/traceability.md · roadmap.md
> 범위: **기획→설계→구현의 추적성·완결성·범위 충족**(코드 동작 세부·성능 실측은 qa-engineer 별도 검증)

---

## 판정: **PASS**

- **(1) Must 충족률: 18/18 (100%)** — PRD §6 Must 전 항목이 설계 모듈 → 실제 구현 파일/슬라이스/핸들러까지 끊김 없이 존재.
- **(2) 누락된 Must: 없음.**
- **(3) 범위 일탈: 없음(경미한 관찰 1건 — 텔레메트리 옵트인 플래그가 로드맵 P6 대신 P5 핸들러에 선구현. 외부 전송 미구현·기본 false로 결정-D5 준수, 결함 아님).**

요약: 핵심 차별점(탭·2분할·패널 간 이동/복사·D&D 의도 규칙)부터 파일조작·탐색·검색/필터·세션복원·테마·상태바·설정까지 모든 Must가 실제 코드로 실현되어 있다. 결정기록 D1~D5를 모두 준수했고, 단축키 단일 출처(`domain/keybindings`)가 PRD §8과 일치하며 부팅 시 충돌 assert가 있다. 보안·성능 비기능 요구도 구조적으로 코드에 반영됐다. 그대로 P7(안정화·릴리스 준비)로 진행 가능하다.

---

## 1. MVP Must 추적성 매트릭스

| # | Must 기능 (PRD §6 / US) | 설계(traceability) | 구현 파일 | 상태 |
|---|---|---|---|---|
| 1 | 탭 관리(추가/닫기/전환/이동/복제/닫은탭복원) US-1.1 | TabBar / tab.* / closedHistory | `tabsSlice.ts`, `ui/tabbar/TabBar.tsx`, `commandBus.ts`(tab.*) | ✅ |
| 2 | 2분할 패널 + 활성 패널 US-1.2 | LayoutHost, Panel / layout.toggleSplit2 | `ui/layout/LayoutHost.tsx`, `ui/panel/Panel.tsx`, `tabsSlice.ts`(focusNext/Dir) | ✅ |
| 3 | 패널 간 D&D 이동/복사 + F5/F6 US-1.3 | dnd/, panel.copyToOther/moveToOther / resolveDragIntent | `domain/rules/dragIntent.ts`, `ui/dnd/*`, `usecases/fileOps.ts`(copy/moveToOther) | ✅ |
| 4 | 목록 보기(리스트/상세) + 정렬 US-2.1 | FileListView / 자연정렬·폴더우선 | `ui/panel/views/FileListView.tsx`, `domain/rules/sort.ts`, `panelsSlice.ts` | ✅ |
| 5 | 생성·이름변경·삭제(휴지통)·복사·잘라내기·붙여넣기 US-2.2/2.3 | file/clipboard usecase / fs:mkdir·create·rename | `op.handlers.ts`(fs:mkdir/create/rename), `clipboard.handlers.ts`, `usecases/fileOps.ts`, `os/shell.ts`(trashItem) | ✅ |
| 6 | 복사/이동 충돌 해결(덮어쓰기/건너뛰기/둘다유지/병합/모두적용/읽기전용·사용중) US-2.4 | ConflictDialog / operations | `operations/conflict.ts`, `operations/engine.ts`, `workers/fileOpWorker.ts`, `ui/dialogs/ConflictDialog.tsx` | ✅ |
| 7 | 주소 표시줄(입력/표시) + 뒤/앞/위 US-3.1 | Toolbar / nav usecase | `ui/toolbar/PanelToolbar.tsx`, `usecases/navigate.ts`, `panelsSlice.ts`(navHistory), `fs.handlers.ts`(validate-path) | ✅ |
| 8 | 트리 사이드바 US-3.2 | Sidebar / fs:tree-children | `ui/sidebar/Sidebar.tsx`, `sidebarSlice.ts`, `fs.handlers.ts`(drives/tree-children) | ✅ |
| 9 | 즐겨찾기/북마크 + 최근 위치 US-3.3 | Sidebar / sidebarSlice | `sidebarSlice.ts`(favorites/recent), `ui/sidebar/Sidebar.tsx` | ✅ |
| 10 | 현재 폴더 검색(파일명) + 확장자/이름 필터 US-4.1/4.2 | SearchBar / filter 순수함수 | `domain/rules/filter.ts`, `ui/panel/SearchBar.tsx`, `panelsSlice.ts`(filter) | ✅ |
| 11 | 키보드 단축키 체계 US-5.4 (PRD §8) | keybindings(단일출처) / Registry·Dispatcher·CommandBus | `domain/keybindings/index.ts`, `ui/keyboard/registry.ts`, `KeyboardDispatcher.tsx`, `commandBus.ts` | ✅ |
| 12 | 다중 선택(Ctrl/Shift/박스/Ctrl+A) + 일괄 US-5.1 | FileListView / selectionSlice | `domain/rules/selection.ts`, `selectionSlice.ts`, `FileListView.tsx` | ✅ |
| 13 | 대용량 복사/이동 진행률 + 취소 US-5.2 | ProgressDialog / OperationManager(200ms 스로틀) | `operations/OperationManager.ts`(PROGRESS_THROTTLE_MS=200), `ui/dialogs/ProgressDialog.tsx`, `op:cancel` | ✅ |
| 14 | 다크/라이트 테마 US-5.3 | theme/ / uiSlice | `ui/theme/*`, `usecases/settings.ts`, `uiSlice.ts`(theme) | ✅ |
| 15 | 상태바(선택개수/용량/항목수/활성경로) US-5.7 | StatusBar / 셀렉터 파생 | `ui/statusbar/StatusBar.tsx`, `usecases/selectors.ts` | ✅ |
| 16 | 자동 세션 복원(정상·비정상) US-5.5 (결정-D3) | App 부트스트랩 / session usecase | `usecases/session.ts`(휘발 제외 명시), `persistence/SessionStore.ts`+`atomic.ts`, `main/index.ts`(before-quit flush) | ✅ |
| 17 | 설정/숨김·확장자 토글 feat-E6/F장 | 설정 화면 / settings usecase | `ui/settings/SettingsDialog.tsx`, `usecases/settings.ts`, `guard.ts`(showHidden 파라미터), `FileListView`(확장자 토글) | ✅ |
| 18 | 파일 실행/열기(B6) US-2.2 | FileListView 더블클릭/Enter / open usecase | `usecases/open.ts`, `shell.handlers.ts`(shell:open + 경로검증), `os/shell.ts` | ✅ |

> 18개 Must 전부 **기획원(US/feat) → 설계 매핑(traceability) → 구현 파일**의 3단 추적이 끊김 없이 성립한다. traceability.md의 매핑 중 "유령 매핑"(설계만 있고 구현 없음)은 발견되지 않았다. IPC 채널은 `shared/ipc/channels.ts`에 전 채널 동결 + 해당 Phase별 핸들러 실구현(`ipc/index.ts`에서 fs/shell/op/clipboard/session 등록 확인, workspace만 P6 주석 보류)으로 일치한다.

---

## 2. 결정 기록(D1~D5) 준수

| 결정 | 내용 | 구현 준수 여부 |
|---|---|---|
| **D1** | 4분할=Should(MVP 제외), 2분할까지 Must | ✅ `LayoutHost`는 single/split-2만 구현. grid-4 미구현(P6 보류). Should를 MVP에 섞지 않음 |
| **D2** | 미리보기 패널=Should(MVP 제외), Ctrl+P 예약 | ✅ `PreviewPanel` 미구현. `keybindings`에 `ctrl+p`=`preview.toggle` 예약만, `commandBus`에서 "다음 단계 제공" 토스트(no-op) 처리 |
| **D3** | 자동 세션복원=Must / 명시적 워크스페이스=Should | ✅ 자동 복원 완비(`usecases/session.ts`). 워크스페이스(`workspace:*`)는 채널만 동결·핸들러 미등록(P6). 정확히 분리됨 |
| **D4** | Tab=포커스 / F5=복사 / F6=이동 / Ctrl+R=새로고침(충돌 제거) | ✅ `keybindings`에 4키 모두 고유 commandId. `registry.assertNoConflicts()` 부팅 시 동일 컨텍스트 중복 throw. F5≠새로고침 분리 확인 |
| **D5** | 텔레메트리 옵트인(기본 꺼짐), 로컬 전용 기본 | ✅ `main/index.ts` 권한요청 전부 거부 + 엄격 CSP(connect-src 'self'). `telemetry:set-opt-in` 기본 false·전송 미구현(외부 전송 전무). 결정 준수 |

결정기록 위반(Should를 Must로 끌어올림 / Must를 누락) **없음**.

---

## 3. 단축키 단일 출처 ↔ PRD §8 대조

- **단일 출처 확립**: `src/renderer/domain/keybindings/index.ts`의 `KEYBINDINGS` 한 곳에서 선언 → `registry.ts`가 인덱싱 → `KeyboardDispatcher` 디스패치 → `commandBus` 실행. 설정 화면/도움말은 `registry.listBindings()`를 읽어 표시(표↔코드 불일치 구조적 방지).
- **PRD §8 표 일치**: 탭(Ctrl+T/W/Shift+T/D, Ctrl+Tab/Shift+Tab, Ctrl+1~9 9개 펼침), 패널 포커스(Tab=focusNext / Ctrl+←·→=focusDir 별개 commandId), 분할(Ctrl+\), 패널작업(F5/F6), 탐색(Alt+←/→/↑, Backspace, Ctrl+L), 보기(Ctrl+R, Ctrl+F), 파일(Ctrl+C/X/V, F2, Ctrl+Shift+N, Delete/Shift+Delete, Ctrl+Z=Should), 선택(Ctrl+A), 미리보기(Ctrl+P=Should) — **전부 코드에 존재하고 동작 매핑됨**.
- **충돌 부재**: `assertNoConflicts()`가 동일 컨텍스트 내 중복 chord를 부팅 시 throw. Tab/F5/F6/Ctrl+R 고유성 보장. 텍스트 컨텍스트(addressEdit/search/rename/dialog)에서 전역 단축키 차단 로직(`isTextContext`) 존재.
- **합리적 추가(일탈 아님)**: `Ctrl+,`(설정 열기), `Enter`(panel.activate), `F1`(도움말, App에서 직접) — PRD §8 표에 없으나 표준 관례 부합·기존 키와 충돌 없음. 표 항목을 누락·변경한 것이 아니라 보완이므로 일탈로 분류하지 않음.
- **마우스 조작 제외 타당**: PRD §8의 `Ctrl+클릭`/`Shift+클릭`은 키보드 단축키가 아니라 마우스 선택이므로 `keybindings` 맵이 아닌 `FileListView`/`selectionSlice`에서 처리(올바른 책임 분리).

---

## 4. 비기능 요구 반영 여부 (존재 수준)

| 비기능 요구 | 코드 반영 근거 |
|---|---|
| 보안 — contextIsolation/sandbox/nodeIntegration false/webSecurity | ✅ `windows/mainWindow.ts` webPreferences 4종 강제 |
| 보안 — Main 전용 FS·guard(senderFrame·zod·경로정규화·`..`차단) | ✅ `ipc/guard.ts`(isTrustedSender/parseArgs/guardPath), `fs/paths.ts` 정규화. Renderer는 `window.api`만 |
| 보안 — 단일 인스턴스·CSP·권한차단·로컬전용 | ✅ `main/index.ts`(requestSingleInstanceLock, 엄격 CSP, setPermissionRequestHandler 전부 거부) |
| 성능 — 가상화(1만 항목 첫렌더) | ✅ `FileListView.tsx` 자체 윈도잉(가시+오버스캔만 DOM) |
| 성능 — 스트리밍 읽기(첫 청크 즉시 렌더) | ✅ `fs.handlers.ts` fs:list:start/chunk/done, `FileSystemService.ts` |
| 성능 — I/O 워커 비차단 + 진행률 200ms 스로틀 + 취소 | ✅ `workers/fileOpWorker.ts`(Worker Thread), `OperationManager.ts`(setInterval 200ms, SharedArrayBuffer 취소 플래그) |
| 성능 — 검색 디바운스/순수함수 | ✅ `domain/rules/filter.ts` 순수, `session.ts` 디바운스(800ms 저장), 검색 UI 측 처리 |
| 안정성 — 휴지통 경유·영구삭제 확인·원자적 세션쓰기·손상 폴백 | ✅ `os/shell.ts`(trashItem), `dialog:confirm-permanent-delete`, `persistence/atomic.ts`, `session.ts` 손상 폴백 |

> 비기능 요구는 모두 **구조적으로 코드에 존재**한다. 실측 충족(1.5초/200ms/검색 200ms)은 본 검증 범위 밖이며 qa-engineer/P7 성능 하니스의 몫.

---

## 5. 범위 일탈 점검

- **Should/Could의 MVP 혼입**: 없음. 4분할·미리보기·워크스페이스는 모두 미구현 또는 채널/키만 예약(P6 보류). 그리드 보기는 `FileListView`에서 `isGrid = false // P6`로 명시 차단.
- **설계에 없던 임의 기능 추가**: 없음. 추가된 `Ctrl+,`/`Enter`/`F1`/`Toasts`/`DragOverlay`는 기존 설계 컴포넌트 경계 내 보완.
- **경미한 관찰 1건 (결함 아님)**: `telemetry:set-opt-in` 핸들러가 로드맵상 P6인데 P5 `session.handlers.ts`에 선구현됨. 다만 (a) 외부 전송 코드 전무, (b) 기본 false, (c) 결정-D5(옵트인·로컬전용) 준수 → 범위 위반이 아니라 안전한 선반영. 향후 traceability/로드맵 시점 표기와의 정합을 위해 기록만 남김.

---

## 6. 종합 의견

MVP(P0~P5)는 **기획 수용 기준 전체를 추적 가능하게 충족**한다. 18개 Must가 기획원→설계→구현의 3단 추적에서 끊기는 지점이 없고, 핵심 차별점(탭·2분할·패널 간 이동/복사·D&D 의도 규칙)이 도메인 순수 규칙(`dragIntent.ts`)·워커 기반 작업(`engine.ts`/`fileOpWorker.ts`)·충돌 해소 UI(`ConflictDialog.tsx`)로 실제 동작 경로까지 결선되어 있다. 결정기록 D1~D5를 모두 준수했고(특히 D1 4분할·D2 미리보기·D3 워크스페이스의 Should 분리가 정확), 단축키는 단일 출처+부팅 충돌 assert로 PRD §8과 일치하며, 보안·성능 비기능 요구가 구조적으로 반영됐다.

**반영 권고 사항 없음(필수)**. 선택적으로, 텔레메트리 선구현 시점을 로드맵/traceability에 한 줄 반영하면 문서-코드 정합이 더 깔끔하다.

**판정: PASS → P7(안정화·성능 실측·접근성·패키징) 진행 가능.**
성능 실측(1.5초/200ms/검색 200ms)·Windows 특수케이스·D&D 진리표 동작 검증은 qa-engineer 트랙에서 마무리한다.
