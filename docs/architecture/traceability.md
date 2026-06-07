# 추적성 매핑 (기획 → 설계) — Explorer

> 작성: 시니어 아키텍트 · 2026-06-06 · **갱신: 2026-06-07**(G장 릴리스/도구 추적 추가 · H장 UX/레이아웃 확장 추적 추가: 아이콘바·사이드바 토글·분할 크기조절 + **터미널 열기(신규 채널 `shell:open-terminal`)·경로 직접 입력·파일 유형 아이콘(예약 채널 `shell:icon` 정식 구현)** · **I장 분석·접근성 추적 추가: 사용량 대시보드(신규 채널 `analyze:scan:*` 5종·recharts MIT lazy 청크)·블루라이트 차단 테마(`BLUELIGHT_PALETTE`·`ThemeMode` 4종)**)
> 목적: PRD/features/user-stories의 각 주요 기능이 **어느 컴포넌트·모듈·IPC 채널·ADR**로 실현되는지 추적한다.
> 약어: SA=[system-architecture.md](./system-architecture.md), SW=[software-architecture.md](./software-architecture.md), DS=[directory-structure.md](./directory-structure.md)

---

## 1. 핵심 기능 → 설계 매핑

> **코드 네임스페이스 범례(참조 무결성)**:
> - `feat-Xn` = features.md 영역코드(A~F + 번호). 예: `feat-D1`=현재폴더 검색, `feat-D3`=미리보기 패널.
> - `결정-Dn` = PRD 11장 결정기록(D1~D5). 예: `결정-D3`=세션 저장 범위, `결정-D4`=단축키 충돌 회피, `결정-D5`=로컬·옵트인 보안.
> - `US-x.y` = user-stories.md.
> 동일 표 안에서 `feat-Dn`과 `결정-Dn`은 **서로 다른 대상**이므로 반드시 접두어로 구분한다.

| 기능(추적원) | UI 컴포넌트 | 유스케이스/스토어 | 도메인 규칙 | IPC 채널 | 관련 ADR |
|---|---|---|---|---|---|
| **탭 관리** (US-1.1, A1) | TabBar | `tab.*` usecase / tabsSlice | closedHistory 스택 | session:save/load | ADR-002 |
| **2분할 패널** (US-1.2, A2) | LayoutHost, Panel | `layout.toggleSplit2`, `panel.focusNext` / tabsSlice | — | — | ADR-002 |
| **4분할** (US-1.4, S) ✅ | `ui/layout/LayoutHost.tsx`(grid-4 2x2 row-major) | `tabsSlice.toggleGrid4`·`focusPanelDir` / `usecases/fileOps.ts`(grid-4 `activeIdx^1`) | grid-4 포커스 순환·`ctrl+shift+\`→`layout.toggleGrid4` | — | ADR-002 |
| **패널 간 이동/복사(D&D·F5/F6)** (US-1.3, A3) | dnd/, FileListView | `panel.copyToOther`/`moveToOther`, D&D usecase | `resolveDragIntent`(드라이브/수정키), 순환이동 차단, 동일폴더 무시 | op:start, op:progress, op:conflict, op:resolve, op:done, op:cancel | ADR-003, ADR-005 |
| **목록 보기/정렬** (US-2.1, B1/B2) | FileListView(details/list/grid) | view usecase / panelsSlice | 자연정렬·폴더우선 | fs:list:start/chunk/done | ADR-004 |
| **생성/이름변경** (US-2.2, B3 Must) | FileListView 인라인편집(`F2`/`Ctrl+Shift+N`/새 파일) | file usecase | 금지문자·예약명·중복명 검증(EINVAL/EEXIST) | **fs:mkdir, fs:create-file, fs:rename** | ADR-003 |
| **삭제(휴지통/영구)** (US-2.2, B3 Must) | FileListView, ConfirmDialog | file usecase | 영구삭제 사전 확인 | op:trash, op:delete, dialog:confirm-permanent-delete | ADR-003, ADR-005 |
| **파일 실행/열기** (B6 Must) | `FileListView` 더블클릭/`Enter` · `ui/contextmenu/ContextMenu.tsx`(우클릭) | `usecases/open.ts`(activateEntry·openWithEntry·showPropertiesFor) · `usecases/contextMenu.ts`(buildMenuItems) | (OS 위임) | shell:open ✅, shell:show-properties ✅(컨텍스트 메뉴 "속성"에서 호출), **shell:open-with(S) ✅** (`main/os/shell.ts#openWith` OpenAs_RunDLL·`shell.handlers.ts`·`guard.ts#zShellOpenWithReq`·컨텍스트 메뉴 "연결 프로그램으로 열기") | ADR-005 |
| **컨텍스트 메뉴(우클릭)** (B6, P4 산출물 — P6 시점 구현·드리프트 해소) ✅ | `ui/contextmenu/ContextMenu.tsx`(경계 보정·키보드) · `FileListView`(onContextMenu) · `App.tsx`(마운트) | `usecases/contextMenu.ts`(buildMenuItems·openRowContextMenu·openEmptyContextMenu) · `uiSlice.contextMenu`(상태/openContextMenu·closeContextMenu) | 단일/다중/빈영역·My PC 항목 표시 규칙(+단일 폴더·빈 영역 "터미널 열기") | 메뉴 클릭 → 동일 commandId(`panel.activate`·`file.copy/cut/rename/trash/deletePermanent/paste/newFolder`·`panel.refresh`) 또는 `openWithEntry`·`showPropertiesFor`·`openTerminalAt` → shell:open-with·shell:show-properties·**shell:open-terminal(H4, 신규)** | ADR-005 |
| **복사/잘라내기/붙여넣기** (US-2.3, B4) | 컨텍스트메뉴/단축키 | clipboard usecase | "복사본" 명명 | clipboard:copy-files/cut-files/paste-target, op:start | ADR-003 |
| **복사/이동 충돌 해결** (US-2.4, feat-D4) | ConflictDialog | operations usecase / operationsSlice | 덮어쓰기/병합/둘다유지/모두적용 판정 | op:conflict, op:resolve, op:done(실패목록) | ADR-003 |
| **주소표시줄/이동버튼** (US-3.1, C1/C2) | Toolbar, 주소표시줄 | nav usecase / panelsSlice(navHistory) | 경로 유틸 | fs:validate-path, fs:list:start | — |
| **트리 사이드바** (US-3.2, C3) | Sidebar | sidebar usecase / sidebarSlice | — | fs:drives, fs:tree-children | — |
| **즐겨찾기/최근** (US-3.3, C4/C5) | Sidebar | sidebar usecase / sidebarSlice | — | session:save/load(영속) | — |
| **현재 폴더 검색** (US-4.1, feat-D1) | SearchBar | search usecase / panelsSlice(filter) | 필터/하이라이트(순수) | (Renderer 내 필터, IPC 불필요; 200ms 폴백 SW §6.3) | ADR-004 |
| **확장자/이름 필터** (US-4.2, feat-D2) | SearchBar/필터바 | search usecase | 패턴 매칭 규칙 | — | — |
| **미리보기 패널** (US-4.3, feat-D3, S) ✅ | `ui/preview/PreviewPanel.tsx` + `renderers/*`(Image/Text/Meta/Unsupported) | `uiSlice.previewOpen`·`commandBus#preview.toggle` | 형식 분기·상한·바이너리 판별(`FileSystemService.readPreview`) | **preview:read**(신규, `preview.handlers.ts`·`dto.PreviewData`) | SA 8장 |
| **다중 선택/일괄** (US-5.1, E3) | FileListView | selection usecase / selectionSlice | 선택집합 연산, count/totalSize 파생 | (op:start로 일괄) | ADR-002 |
| **진행률/취소** (US-5.2, E4) | ProgressDialog, StatusBar | operations usecase / operationsSlice | — | op:progress(200ms 스로틀), op:cancel, op:done | ADR-005 |
| **대용량 폴더 빠른 첫 렌더(성능)** (US-5.6) | FileListView(가상 스크롤) | panelsSlice 스트림 적재 | — | fs:list:start/chunk/done, fs:list:cancel | ADR-004, ADR-005 |
| **테마** (US-5.3, feat-E2) | theme/ | ui usecase / uiSlice | — | settings:get/set(theme) | — |
| **설정** (feat-E6) | 설정 화면 / uiSlice(settings) | settings usecase | 시작위치·숨김/확장자 표시·최근 개수 적용 규칙 | settings:get/set | — |
| **키보드 워크플로** (US-5.4, feat-E1, PRD 8장) | keyboard/(Registry·Dispatcher·CommandBus) | 모든 usecase | keybindings 맵(단일 출처) | (명령→해당 채널) | ADR-002 |
| **자동 세션 복원** (US-5.5, 결정-D3) | App 부트스트랩 | session usecase / 다중 슬라이스 | 스냅샷 직렬화 규칙(closedHistory 제외) | session:load/save | SA 5장, ADR-002 |
| **상태바** (US-5.7, feat-E5) | StatusBar | selection/operations 셀렉터 | 합계 파생 | — | — |
| **명시적 워크스페이스** (US-5.8, S, 결정-D3) ✅ | `ui/workspace/WorkspaceDialog.tsx` | `usecases/workspace.ts`·`tabsSlice.resetWorkspace`+`session.ts#applySnapshot`(복원 단일화) | 스냅샷 재사용 | workspace:save/list/load/delete(`main/persistence/WorkspaceStore.ts`·`workspace.handlers.ts`) | SA 5장 |
| **휴지통 연동** (B5, F장) | Sidebar(휴지통) | file usecase | — | op:trash, (복원/비우기 S) | SA 4.2 |
| **단일 인스턴스/세션 안전** (PRD 7장) | — | — | — | (Main 단일 인스턴스 락, 원자적 저장) | ADR-005, SA 5장 |
| **Windows 특수케이스(롱패스/링크/네트워크/권한)** (F장) | 패널 오류상태 표시 | DirectoryView status | — | fs:list:error(denied 등), FileOpError 전파 | ADR-003, ADR-005 |
| **텔레메트리 옵트인** (결정-D5) ✅ | `SettingsDialog` 체크박스 | `settings.ts#loadSettings`(부팅 재수화) | 전송 코드 전무·`.eslintrc.cjs` main `no-restricted-imports`(node:http/https/net/dgram) 정적 가드 | telemetry:set-opt-in(기본 off), **telemetry:get-opt-in**(신규, 부팅 재수화·`session.handlers.ts`) | ADR-005 |

---

## 1-G. 패키징 / 릴리스 / 개발 도구(G장) → 구현 파일 매핑

> features §G(앱 아이콘·원클릭 빌드·가상 스크롤 결함 수정)를 사후 정식 편입한 영역. 사용자 UI 기능이 아니라 릴리스 산출·도구·결함 수정이므로 IPC/도메인 규칙 칸 대신 **실제 구현 파일**로 추적한다(2026-06-07 코드 확인 ✅).

| 기능(추적원) | 구현 파일(실경로) | 비고 |
|---|---|---|
| **앱 아이콘 / 브랜딩** (G1, US-6.1, M·릴리스) | `resources/icon.ico`, `resources/icon.png`, `scripts/gen-icon.ps1`, `electron-builder.yml`(`win.icon: resources/icon.ico`) | 겹친 폴더 디자인. dev 창 아이콘도 동일 적용 |
| **원클릭 인스톨러 빌드** (G2, US-6.2, 도구) | `build-installer.ps1`(루트) | 의존성 점검→typecheck→build→`npm run package`(NSIS)→인스톨러 경로 출력 |
| **가상 스크롤 뷰포트 높이 결함 수정** (G3, US-5.6 보강) | `src/renderer/ui/panel/views/FileListView.tsx`(콜백 ref + ResizeObserver, `viewportH`), `src/renderer/index.html`(전역 CSS 리셋) | 기존 Must "가상 스크롤" 품질 결함 수정 — 신규 스코프 아님 |

---

## 1-H. UX / 레이아웃 확장(H장, Should) → 구현 파일 매핑

> features §H(상단 아이콘바·사이드바 토글·분할 크기조절·터미널 열기·경로 직접 입력·파일 유형 아이콘)를 2026-06-07 정식 편입(PRD §6 Should·§8 `Ctrl+B`·user-stories 에픽7). 기존 동작(분할 A2·사이드바 C3·단축키 E1·주소 표시줄 C1·아이콘 B1)을 더 빠르게 호출·조정·구체화하는 UX 확장이다. H1~H3·H5는 신규 IPC 채널이 아니라 **renderer commandId·세션 스냅샷 DTO 확장**으로, H4는 **신규 채널 `shell:open-terminal`**, H6은 **P1 예약 채널 `shell:icon` 정식 구현(호출부 추가)**으로 추적한다(2026-06-07 코드 확인 ✅).

| 기능(추적원) | UI 컴포넌트 | 유스케이스/스토어 | 도메인 규칙 | commandId / 채널 / DTO | 비고 |
|---|---|---|---|---|---|
| **상단 전역 아이콘바** (H1, US-7.1, S) ✅ | `src/renderer/ui/toolbar/IconBar.tsx`·`iconBarItems.ts`(4그룹 20버튼·activeWhen·`aria-pressed`·툴팁 단축키) · `src/renderer/ui/App.tsx`(마운트) | `app/usecases/commandBus.ts`(execCommand 수렴) · `settings.ts#toggleThemeMode` · `ui/theme/applyTheme.ts#systemPrefersDark` | 버튼 활성조건·토글 상태 표시 규칙 | **신규 commandId**: `sidebar.toggle`·`theme.toggle`·`view.setMode.list`·`view.setMode.details`(renderer 내부, IPC 채널 아님) | 키보드/컨텍스트메뉴와 동일 commandId 경로 수렴 |
| **사이드바 온오프 토글** (H2, US-7.2, S) ✅ | `IconBar` 사이드바 버튼 | `app/stores/sidebarSlice.ts#toggleSidebar`(`sidebarCollapsed`·세션 영속 기존) | — | `domain/keybindings/index.ts`(`ctrl+b`→`sidebar.toggle`) | ※ 실제 토글은 런타임 DOM 의존 → 런타임 스모크 권장 |
| **분할 패널 크기조절** (H3, US-7.3, S) ✅ | `src/renderer/ui/layout/SplitDivider.tsx` · `LayoutHost.tsx`(2분할 flex/4분할 grid 컨테이너 ref 측정·2축 독립) | `app/stores/tabsSlice.ts#setSplitRatio`(클램프 `SPLIT_MIN_RATIO=0.15`~0.85) · `usecases/session.ts`(`splitRatios` 직렬화) | `ui/layout/splitMath.ts#ratioFromPoint`(순수함수) · `domain/entities`(`Tab.splitRatios`·`SPLIT_MIN_RATIO`) | **DTO 확장**: `shared/dto TabSnapshot.splitRatios?` · `main/persistence/defaults.ts#coerceSplitRatios`(정규화) | ※ 실제 드래그는 런타임 DOM 의존 → 런타임 스모크 권장. 세션 스냅샷 필드 확장이며 P1 IPC 채널 동결과 무관 |
| **우클릭 "터미널 열기"** (H4, US-7.4, S) ✅ | `usecases/contextMenu.ts`(단일 폴더·빈 영역 "터미널 열기" 항목, 파일·My PC 미표시) · `ui/contextmenu/ContextMenu.tsx` | `app/usecases/open.ts#openTerminalAt`·`terminalErrorMessage` · `infra/api`(`shellApi.openTerminal`) | 실존 디렉토리 경로만 진입점 표시 | **신규 채널 `shell:open-terminal`**: `channels.ts`·`contracts.ts ShellOpenTerminalReq` → `main/os/shell.ts#openTerminal`(`wt.exe -d`→`powershell.exe -NoExit` 폴백·`execFile`) · `shell.handlers.ts`(sender·zod·guardPath·stat 디렉토리 검증) · `guard.ts#zShellOpenTerminalReq` | ADR-005. P1 동결 후 신규 채널(P6 `preview:read`·`telemetry:get-opt-in` 동일 선례). ※ 네이티브 `wt.exe` 실행 런타임 스모크 권장 |
| **디렉토리 경로 직접 입력** (H5, US-7.5, S) ✅ | `src/renderer/ui/toolbar/PanelToolbar.tsx`(단일 클릭 편집 진입·`closest('button')` 가드) | 기존 `validateAndNavigate`·`Ctrl+L`·더블클릭 재사용 | 경로 검증·인라인 오류(기존) | 신규 채널·단축키·DTO **없음**(진입 방식만 확장) | C1·US-3.1 동작을 단일 클릭 진입으로 구체화 |
| **파일 유형별 OS 아이콘** (H6, US-7.6, S) ✅ | `src/renderer/ui/panel/views/FileListView.tsx`(`OSIcon`) | `app/usecases/icons.ts`(`getCachedIcon`·`requestIcon`·`subscribeIcon`·`iconKeyFor`) · `infra/icon/iconCache.ts`(`iconKeyFor`·`iconRequestFor`·디듀프·구독) | 확장자 단위 캐시·per-file path 키·가상 스크롤 `iconRef` 지연 | **예약 채널 `shell:icon` 정식 구현(호출부 추가)**: `contracts.ts ShellIconReq/Res` → `main/os/icon.ts`(`getFileIconDataUrl`·`cacheKeyFor`·LRU512·실패 비캐싱) · `shell.handlers.ts SHELL_ICON`(sender·zod·검증) | ADR-005. **P1 동결 후 "P2/P4 시스템 아이콘 캐시"로 예약·미구현이던 채널을 정식 구현 → 예약→구현 드리프트 해소**. ※ 네이티브 `app.getFileIcon` 실행 런타임 스모크 권장 |

---

## 1-I. 분석·시각화 / 접근성 테마(I장, Should) → 구현 파일 매핑

> features §I(디렉토리 사용량 대시보드·블루라이트 차단 테마)를 2026-06-07 정식 편입·구현(PRD §6 Should·§10 R4/R5·user-stories 에픽8). I1은 **신규 채널 `analyze:scan:*` 5종**(P1 동결 이후 추가 — P6 `preview:read`·H4 `shell:open-terminal` 동일 선례)으로, 디스크 요약은 기존 `DriveDTO`+`diskSpace()` 재사용(backend 신규 0)이며 차트는 **recharts(MIT) lazy 청크**로 추적한다. I2는 테마 토큰 1종 추가(신규 채널 0). 구현 명명은 코드가 단일 출처다 — **DTO는 `ScanResult.root`/`ScanEntry.bytes`**(계획서의 `rootPath`/`sizeBytes`/`ScanEntryDTO`는 미채택, 아래 명명 드리프트 주석). 2026-06-07 코드 확인 ✅(typecheck/lint 0·`verify:scan` 28/0·QA PASS).

| 기능(추적원) | UI 컴포넌트 | 유스케이스/스토어 | 도메인/엔진 규칙 | commandId / 채널 / DTO | 비고 |
|---|---|---|---|---|---|
| **디렉토리 사용량 대시보드** (I1, US-8.1, S) ✅ | `src/renderer/ui/dashboard/DashboardModal.tsx`(+`DashboardModalBody.tsx` **React.lazy**) · recharts 도넛/막대+표 병행 · `ui/toolbar/iconBarItems.ts`(`dashboard.open`) · `ui/App.tsx`(자동 팝업) · SettingsDialog("시작 시 대시보드 표시" 토글) | `app/stores/analyzeSlice.ts` · `app/usecases/dashboard.ts`(scanId 상관 브리지) · `app/stores/uiSlice.ts`(`showDashboardOnStartup` 기본 `true`) | `src/main/operations/scanEngine.ts`(재귀 집계·Top10 힙·순환 realpath Set·skipped·취소·truncated) · `src/main/workers/scanWorker.ts`·`scanProtocol.ts`(SharedArrayBuffer 취소) · `src/main/operations/ScanManager.ts`(scanId·200ms 스로틀·푸시) | **신규 채널 `analyze:scan:start/progress/done/error/cancel`(5종)**: `channels.ts`·`contracts.ts` → `main/ipc/analyze.handlers.ts`(guardPath·디렉토리 검증). **DTO `ScanResult{root,totalBytes,totalItems,topFolders,topFiles,skipped,canceled,truncated}`·`ScanEntry{path,name,bytes,isDir}`**. 디스크 요약=기존 `DriveDTO.totalBytes/freeBytes`+`diskSpace()` 재사용(신규 0) | ADR-005. **신규 의존성 recharts 3.8.1(MIT)·831kB lazy 청크 분리.** ※ (가능 시) 파일 유형별 비중 인사이트는 선택항 미구현 🔜·네이티브 statfs/대용량 스캔 성능 실측은 런타임 스모크 권장 |
| **블루라이트 차단 테마** (I2, US-8.2, S) ✅ | `ui/settings/SettingsDialog`(테마 4종 선택) | `app/usecases/settings.ts#toggleThemeMode`(light↔dark 유지) | `ui/theme/palette.ts BLUELIGHT_PALETTE`(13토큰·#FBF0D9) · `ui/theme/applyTheme.ts ResolvedTheme`(bluelight **독립 resolved**·light 폴백 아님) | `ThemeMode` 4종(+`'bluelight'`) · `main/persistence/defaults.ts THEME_MODES` · `main/ipc/guard.ts zThemeMode` 화이트리스트. 신규 채널 **없음** | WCAG AA 통과(본문 11.04:1·muted 5.25:1). E2·US-5.3 선택지 1종 확장(기존 테마 동작 무변경) |

> **계획서 명명 드리프트(코드=단일 출처)**: `docs/I-dashboard-bluelight-plan.md`는 DTO를 `ScanEntryDTO`·`sizeBytes`·`rootPath`로 기재했으나 **구현은 `ScanEntry`·`bytes`·`root`** 로 확정됐다(QA 관찰-1). traceability/roadmap은 구현 명명을 기록한다. 또한 계획서는 scanWorker/scanProtocol을 `src/main/operations/`로 적었으나 실제 위치는 **`src/main/workers/`** 다(코드 기준 기록).

---

## 2. 단축키 표(PRD 8장) → 처리 위치 매핑

> 단일 출처: `renderer/domain/keybindings`(키→commandId). 디스패치는 SW 7장.

| 키 | commandId | 처리 슬라이스/유스케이스 |
|---|---|---|
| `Tab` | `panel.focusNext`(순환) | tabsSlice |
| `Ctrl+←/→` | `panel.focusDir(dir)`(방향) | tabsSlice |
| `F5` / `F6` | `panel.copyToOther`/`moveToOther` | operations usecase → op:start |
| `Ctrl+R` | `panel.refresh` | panelsSlice → fs:list:start |
| `Ctrl+T/W/Shift+T/D`, `Ctrl+Tab`, `Ctrl+1~9` | `tab.*` | tabsSlice |
| `Ctrl+\` | `layout.toggleSplit2` | tabsSlice |
| `Ctrl+B` (S) | `sidebar.toggle` | sidebarSlice(`toggleSidebar`) |
| `Alt+←/→/↑`, `Backspace` | `nav.back/forward/up` | panelsSlice(navHistory) |
| `Ctrl+L` / `Ctrl+F` | `address.edit`/`search.open` | 컨텍스트 스코프 진입 |
| `Ctrl+C/X/V` | `file.copy/cut/paste` | clipboard usecase |
| `F2`, `Ctrl+Shift+N` | `file.rename`/`file.newFolder`(+새 파일) | file usecase → fs:rename/fs:mkdir/fs:create-file |
| `Delete`/`Shift+Delete` | `file.trash`/`file.deletePermanent` | file usecase → op:trash/op:delete |
| `Ctrl+Z` (S) | `file.undo` | Undo 스택(범위 미결, SA 4.2) |
| `Ctrl+A`, `Ctrl+클릭`, `Shift+클릭` | `select.all/toggle/range` | selectionSlice |
| `Ctrl+P` (S) | `preview.toggle` | uiSlice |

> **충돌 회피 검증 반영**(결정-D4): `Tab`/`F5`/`F6`/`Ctrl+R`가 고유 commandId로 매핑됨. 레지스트리가 동일 컨텍스트 중복 매핑을 부팅 시 assert.
> **포커스 명령 구분**: `panel.focusNext`(Tab=순환)와 `panel.focusDir(dir)`(Ctrl+←/→=방향)는 별개 commandId다(SW §7.2와 통일).

---

## 3. 비기능 요구(PRD 7장) → 구조적 대응

| 비기능 요구 | 구조적 대응 | 근거 문서 |
|---|---|---|
| 10,000개 1.5초 첫 렌더 | 디렉토리 스트리밍(fs:list:chunk) + 가상 스크롤 첫 청크 즉시 렌더 | SA 3.1, SW 6.2, ADR-004 |
| 진행률 200ms·UI 비차단 | Worker 실행 + Main 200ms 스로틀 + 이벤트 스트림 + 셀렉터 리렌더 격리 | SA 4.1, ADR-005, ADR-002 |
| 검색 입력 200ms (US-4.1 Must) | 도메인 순수함수 메모이즈 + deferred/transition; 미달 시 가시영역 우선 필터 → (필요 시) Web Worker 폴백, M1 측정 항목화 | SW 6.3, SW §10-1 |
| 삭제 휴지통 경유·되돌리기 | op:trash + Undo 스택 | SA 4.2 |
| 충돌 임의 덮어쓰기 금지 | op:conflict 질의 → 사용자 명시 선택 | SA 4.1, SW 8 |
| 비정상 종료 복원 | 변경 시 디바운스 저장 + 원자적 쓰기 + 스키마 버전 | SA 5장 |
| 보안(로컬·권한·옵트인) | contextIsolation+sandbox, Main FS 격리, 양단 검증, 네트워크 차단 기본 | ADR-005, SA 3.3 |
| 롱패스/링크/네트워크/권한 | FileSystemService 예외 처리 + FileOpError 전파 + 패널 단위 오류 격리 | SA 4장, ADR-003 |
| 단일 인스턴스 | Main requestSingleInstanceLock | SA 2.3 |
| 접근성(키보드/포커스/ARIA) | 중앙 단축키 디스패치·컨텍스트 스코프, ARIA 행 레이블 | SW 7, ADR-004 |

---

## 4. 추적성이 커버한 핵심 기능 (요약)

탭 관리 · 2분할/4분할 패널 · 패널 간 이동/복사(D&D·F5/F6) · 목록 보기/정렬 · 생성/이름변경(fs:mkdir/create-file/rename) · 삭제(휴지통/영구) · 파일 실행/열기(B6) · 복사/붙여넣기 · 충돌 해결 · 주소표시줄/탐색 · 트리 사이드바 · 즐겨찾기/최근 · 현재 폴더 검색 · 확장자 필터 · 미리보기(S) · 다중 선택/일괄 · 진행률/취소 · 대용량 빠른 첫 렌더(성능) · 테마(라이트/다크/시스템/**블루라이트 차단 I2**) · 설정(E6) · 키보드 워크플로(8장 전체) · 자동 세션 복원 · 상태바 · 명시적 워크스페이스(S) · 휴지통 연동 · Windows 특수케이스 · 텔레메트리 옵트인 · **사용량 대시보드(S, I1: `analyze:scan:*`·recharts)**.

> 위 항목 모두 컴포넌트·유스케이스/스토어·IPC 채널·ADR로 매핑 완료. 생성/이름변경(B3)은 전용 `fs:mkdir`/`fs:create-file`/`fs:rename` 채널(SA §3.2), 실행(B6)은 `shell:*`, 설정(E6)은 `settings:get/set`으로 실 채널까지 연결했다(유령 매핑 제거). **Should 4종(4분할·미리보기·워크스페이스·텔레메트리)은 P6에서 실 파일·채널까지 매핑 완료 ✅** — 미리보기는 신규 `preview:read`(기존 `fs:stat` 잠정 매핑 정정), 텔레메트리는 신규 `telemetry:get-opt-in` 추가. **연결 프로그램으로 열기(`shell:open-with`)·컨텍스트 메뉴(우클릭) 인프라는 P6 시점에 구현 완료 ✅**(후자는 P4 산출물이 실제 누락돼 있던 드리프트를 해소 — `ui/contextmenu/`·속성→`shell:show-properties` 호출 UI 포함). **신규 UX 6종(H장: 아이콘바 H1·사이드바 토글 H2·분할 크기조절 H3·터미널 열기 H4·경로 직접 입력 H5·파일 유형 아이콘 H6)도 구현 완료 ✅**(§1-H 매핑 — renderer commandId 4건·`TabSnapshot.splitRatios` DTO 확장·`coerceSplitRatios`; **H4 신규 채널 `shell:open-terminal`·H6 예약 채널 `shell:icon` 정식 구현(예약→구현 드리프트 해소)**; US-7.2/7.3 드래그·H4 `wt.exe`·H6 `app.getFileIcon` 실제 네이티브 실행은 런타임 스모크 권장). **Should 잔여(그리드/썸네일 보기·되돌리기 Ctrl+Z·휴지통 관리 화면)는 미구현 🔜.**
