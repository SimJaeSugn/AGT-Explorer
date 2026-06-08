# 추적성 매핑 (기획 → 설계) — AGT-Finder (코드네임 Explorer)

> **갱신: 2026-06-08** — §M 외부 연계 3기능(M1 외부 D&D·M2 클립보드 CF_HDROP 양방향·M3 FTP/SFTP, US-12.1~12.5·F14~F16) **구현 완료·통합 QA PASS → §1-M 상태 🔜→✅ 동기화**(매핑 17파일 실재 확인·[final-traceability-M](../reviews/final-traceability-M.md) PASS). 신규 **[ADR-007](./adr/ADR-007-remote-protocol-and-network-boundary.md)**(ADR-005 부분 개정·네트워크 경계 D5→D7·자격증명 safeStorage/DPAPI·원격=Main 스레드). 신규 채널군 `dnd:*`·파일 `clipboard:*`·`remote:*`. 신규 npm 의존성 `ssh2-sftp-client`·`basic-ftp`(M3만). 실 동작은 런타임 스모크 권장 🟡.
> 작성: 시니어 아키텍트 · 2026-06-06 · **갱신: 2026-06-07**(G장 릴리스/도구 추적 추가 · H장 UX/레이아웃 확장 추적 추가: 아이콘바·사이드바 토글·분할 크기조절 + **터미널 열기(신규 채널 `shell:open-terminal`)·경로 직접 입력·파일 유형 아이콘(예약 채널 `shell:icon` 정식 구현)** · **I장 분석·접근성 추적 추가: 사용량 대시보드(신규 채널 `analyze:scan:*` 5종·recharts MIT lazy 청크)·블루라이트 차단 테마(`BLUELIGHT_PALETTE`·`ThemeMode` 4종)** · **J장 보기·실시간·뷰어·브랜딩 추적 추가: 박스 선택·패널 실시간 갱신(신규 채널 `fs:watch:*`)·보기 5종(`ViewMode`)·AGT-Finder 브랜딩(appId `com.agtfinder.app`)·미리보기 2단 뷰어(highlight.js/marked/dompurify)·미리보기 폭 조절·즐겨찾기 별칭 · **F5/F6 복사·이동 매핑 제거(2026-06-07 사용자 결정)** · **P7 릴리스 안정화 헤드리스분 추적 추가(§1-P7): 접근성(`useFocusTrap`·모달 6종 ARIA/Esc·행 ARIA·focus-visible)·WCAG AA(`verify:contrast`)·성능 불변식(`windowing.ts`·`verify:perf`)·F장 매트릭스(`verify:fmatrix`)·보안 audit/sourcemap/코드서명 설정 — 헤드리스 ✅ / 실측·실제 서명·실케이스 🟡**)
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
| **패널 간 이동/복사(D&D·클립보드)** (US-1.3, A3) | dnd/, FileListView | D&D usecase, 클립보드 usecase (~~`panel.copyToOther`/`moveToOther`(F5/F6)~~ — **2026-06-07 코드에서 제거**, `usecases/fileOps.ts`의 `copyToOtherPanel`/`moveToOtherPanel` 삭제·`panelPaths` 헬퍼는 D&D용 보존) | `resolveDragIntent`(드라이브/수정키), 순환이동 차단, 동일폴더 무시 | op:start, op:progress, op:conflict, op:resolve, op:done, op:cancel | ADR-003, ADR-005 |
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
| **미리보기 패널** (US-4.3, feat-D3, S) ✅ / **2단 뷰어 확장**(feat-J5) ✅ | `ui/preview/PreviewPanel.tsx`(+J5 `PreviewInfoCard` 2단) + `renderers/*`(Image/Text/Meta/Unsupported **+J5 Code(highlight.js)/Markdown(marked+DOMPurify)**) | `uiSlice.previewOpen`·`commandBus#preview.toggle`(+J6 `uiSlice.previewWidth`) | 형식 분기·상한·바이너리 판별·lang/isMarkdown(`FileSystemService.readPreview`) | **preview:read**(신규, `preview.handlers.ts`·`dto.PreviewData`) — J5 신규 채널 0(재사용) | SA 8장. J5 의존성 highlight.js/marked/dompurify lazy(§1-J 참조) |
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

## 1-J. 보기 · 실시간 갱신 · 뷰어 확장 · 브랜딩(J장, Should) → 구현 파일 매핑

> features §J(박스 선택·패널 실시간 갱신·보기 5종·AGT-Finder 브랜딩·미리보기 2단 뷰어·미리보기 폭 조절·즐겨찾기 별칭)를 2026-06-07 정식 편입·구현(PRD §6 Should·J4 M릴리스·user-stories 에픽9). J2는 **신규 채널 `fs:watch:*` 4종**(P1 동결 이후 추가 — P6 `preview:read`·H4 `shell:open-terminal`·I장 `analyze:scan:*` 동일 선례)으로, J1/J3/J5(렌더러)·J6/J7은 신규 IPC 채널이 아니라 **slice·DTO 확장**(ViewMode·previewWidth·favoriteLabels)으로 추적한다. **식별자 권위 기준 = 기획문서 feat-J1~J7/US-9.1~9.7**(계획서 내부 번호 J1~J8 아님). 2026-06-07 코드 확인 ✅(typecheck/lint 0·`verify:watch` 77/0·`verify:store` 76/0·QA PASS·빌드 성공; J2 보류 2건(선택/스크롤 보존·UNC 폴링 폴백) 구현 완료 + 매핑 네트워크 드라이브 `GetDriveType` 연동 완료 ✅, `subst`·일부 클라우드(`DriveType≠4`)만 미포함 한계).

| 기능(추적원) | UI 컴포넌트 | 유스케이스/스토어 | 도메인/엔진 규칙 | 채널 / DTO | 비고 |
|---|---|---|---|---|---|
| **드래그 박스 선택(러버밴드)** (feat-J1, US-9.1, S) ✅ | `src/renderer/ui/panel/views/FileListView.tsx`(러버밴드 오버레이·경계 자동 스크롤) | `src/renderer/app/stores/selectionSlice.ts#boxSelect`(교체/누적/범위 모드) | `src/renderer/domain/rules/boxSelect.ts`(사각형 교차 판정 순수함수·가상 스크롤 마운트 항목 포함) | 신규 채널·DTO **없음**(렌더러 내부 선택 연산) | ※ 실제 마우스 드래그·자동 스크롤은 런타임 DOM 의존 → 런타임 스모크 권장 |
| **패널 실시간 갱신(워처)** (feat-J2, US-9.2, S) ✅ | `FileListView`(자동 갱신 반영·`pendingScrollRestore` 1회성 스크롤 복원) | `src/renderer/app/usecases/watchBridge.ts`(watchId 상관·경로 교체 시 이전 감시 해제·리소스 정리·onEvent→`softRefresh`) · `src/renderer/app/stores/panelsSlice.ts`(`softRefresh`·`capturePreserve`·`_applyPreserve`·`pendingScrollRestore`·navigate 3종 `resetSelection`) · `src/renderer/app/stores/selectionSlice.ts#setSelection` | `src/main/fs/WatchService.ts`(non-recursive `fs.watch`·디바운스 병합·권한/네트워크/미지원 격리 throw 0→onError + **UNC + 매핑 네트워크 드라이브 eager 폴링·reactive fs.watch error 폴백·4s readdir diff·stat 승계·pollBusy 재진입 가드·>20k 항목 비활성·stop 정리·미지 고정 드라이브 lazy refresh trigger**) · `src/main/os/driveType.ts`(`DriveTypeService` — PowerShell CIM `Win32_LogicalDisk DriveType=4`=`DRIVE_REMOTE` execFile 조회·네트워크 드라이브 문자 캐시 원자 Set 교체·throttle·재진입 가드·빈집합 폴백·헤드리스 `queryFn`/`setNetworkDriveLetters` 주입) · `src/main/fs/paths.ts`(`isUncPath`·`isNetworkDriveRoot`(driveType 캐시 동기 조회)·`isLikelyRemotePath`) · `src/main/index.ts`(부팅 non-blocking refresh) | **신규 채널 `fs:watch:start/event/stop/error`(4종)**: `channels.ts`·`contracts.ts` → `main/ipc/watch.handlers.ts`(sender·guardPath·디렉토리 검증). **폴링·`GetDriveType` 연동은 backend 내부·계약 변경 0(투명)·신규 npm 의존성 0(PowerShell 시스템 내장)** | ADR-005(execFile 셸 미경유·고정 상수 스크립트·`^[A-Z]:` 화이트리스트 파싱). P1 동결 후 신규 채널(선례 동일 규약). 보류 2건 구현 완료: **선택/스크롤 보존 ✅·UNC 폴링 폴백 ✅**. **매핑 네트워크 드라이브(`X:\`) `GetDriveType` 연동 완료 → eager 폴링 적용 ✅**. 잔여 한계: `subst`·일부 클라우드(`DriveType≠4`) 미포함(reactive 폴백 유지). ※ 네이티브 워처 실제 이벤트 런타임 스모크 권장 |
| **Windows 표준 보기 5종** (feat-J3, US-9.3, S) ✅ | `FileListView`(아이콘 그리드 3종·H6 `OSIcon`/`shell:icon` 재사용·가상 스크롤) · `src/renderer/ui/toolbar/PanelToolbar.tsx`(보기 드롭다운) | `app/stores/panelsSlice.ts`(패널별 `view` 기억) | 그리드 2차원 레이아웃·박스 선택(J1) 교차 정합 | **DTO `ViewMode`**(`'icons-large'|'icons-medium'|'icons-small'|'list'|'details'`, `shared/dto`) · `main/persistence/defaults.ts VIEW_MODES` 화이트리스트 | 신규 IPC 채널 없음(아이콘은 기존 `shell:icon` 재사용) |
| **브랜딩 AGT-Finder** (feat-J4, US-9.4, M릴리스) ✅ | `src/renderer/index.html`(`<title>AGT-Finder`) | — | — | (패키징/식별자) `package.json`(name `agt-finder`·description) · `electron-builder.yml`(**`appId: com.agtfinder.app`**·`productName: AGT-Finder`) · `src/main/windows/mainWindow.ts` · `src/main/index.ts` · `src/main/persistence/paths.ts`(userData 경로) | 코드네임 "Explorer"는 내부 ExplorerApi 타입·주석만 유지(사용자 노출 0). ※ exe/인스톨러 파일명·바로가기는 패키징 산출물 런타임 확인 권장 |
| **미리보기 2단 뷰어(정보+확장 뷰어)** (feat-J5, US-9.5, S) ✅ | `src/renderer/ui/preview/PreviewPanel.tsx`(상단 `PreviewInfoCard`+하단 뷰어) · `renderers/CodePreview.tsx`(highlight.js 강조) · `renderers/MarkdownPreview.tsx`(marked+DOMPurify) · 기존 Image/Text/Meta/Unsupported 폴백 | `uiSlice.previewOpen`·`commandBus#preview.toggle`(`Ctrl+P` 재사용) | `FileSystemService.readPreview`(lang/isMarkdown 판별·상한·바이너리) | **기존 `preview:read` 재사용**(신규 채널 0) · 신규 의존성 **highlight.js(BSD-3)·marked(MIT)·dompurify(MPL-2.0)** lazy 청크 | ADR-005·CSP. 마크다운 DOMPurify 새니타이즈·원격 로드/eval 차단(읽기 전용) |
| **미리보기 패널 폭 조절** (feat-J6, US-9.6, S) ✅ | H3 `ui/layout/SplitDivider.tsx` 재사용(미리보기-본문 분할선) | `app/stores/uiSlice.ts#previewWidth`(클램프·기본 폭 복귀) · `usecases/session.ts`(직렬화·영속) | `ui/layout/splitMath.ts#ratioFromPoint`(순수함수 재사용) | **DTO 확장**: `shared/dto`(`ui.previewWidth`) | 토글 off→on 후 폭 유지. H3 메커니즘 재사용·다른 경계(가로 축) |
| **즐겨찾기 별칭 변경** (feat-J7, US-9.7, S) ✅ | `src/renderer/ui/sidebar/Sidebar.tsx`(인라인 편집·우클릭/`F2`·Enter/Esc) | `app/stores/sidebarSlice.ts`(별칭 설정/초기화·basename 폴백) · `usecases/session.ts`(영속) | 표시 전용(경로 불변)·빈 별칭 basename 폴백·중복 허용 | **DTO 확장**: `shared/dto SidebarSnapshot.favoriteLabels` · `main/persistence/defaults.ts`(정규화) | 기존 `F2` 재사용·신규 채널 없음 |

> **F5/F6 매핑 제거(2026-06-07 사용자 결정·은폐 금지)**: 본 추적성의 §1 "패널 간 이동/복사" 행과 §2 단축키 표 `F5`/`F6` 행이 가리키던 `panel.copyToOther`/`moveToOther` commandId·`usecases/fileOps.ts`의 `copyToOtherPanel`/`moveToOtherPanel` 함수는 **코드에서 제거**됐다(`domain/keybindings`·`commandBus`·`fileOps`·`ShortcutHelp`). 위 두 곳을 코드 기준으로 정정했다 — **유령 매핑(코드 없는데 매핑 잔존) 제거**. 패널 간 복사/이동은 D&D(A3)·클립보드(`Ctrl+C/X/V`)가 단일 경로로 유지된다(이 매핑은 그대로 유효).

> **식별자 매핑 주의(reviewer 중대-1)**: 계획서 `J-ref-batch-plan.md`의 내부 번호(J1~J8)와 기획문서 feat-ID(feat-J1~J7·US-9.1~9.7)가 다르다. 본 추적성은 **기획문서 feat-J1~J7/US-9.1~9.7을 권위 기준**으로 작성했다(박스선택=J1/9.1, 실시간갱신=J2/9.2, 보기5종=J3/9.3, 브랜딩=J4/9.4, 뷰어=J5/9.5, 폭조절=J6/9.6, 별칭=J7/9.7, F5/F6제거=feat 없음·기존 정정).

---

## 1-K. 되돌리기 · 휴지통 관리 · 유형별 비중(K장, Should) → 구현 파일 매핑

> features §K(되돌리기 `Ctrl+Z` 다단계 undo·휴지통 관리 화면·파일 유형별 비중)를 2026-06-07 정식 편입·구현(PRD §6 Should·user-stories 에픽10). roadmap §0.5 "P6 미구현 잔여 🔜"의 되돌리기·휴지통 관리 화면을 정식 구현하고(P6 잔여 해소), I1 "(가능하면) 유형별 비중" 선택항을 K3로 정식화했다. K2는 **신규 채널 `trash:*` 3종**(P1 동결 이후 추가 — `preview:read`·`shell:open-terminal`·`analyze:scan:*`·`fs:watch:*` 동일 선례), K1·K3은 신규 IPC 채널 0(K1=renderer undo 스택+기존 `op:*`/`fsApi`/`trashApi` 역연산, K3=기존 `analyze:scan:*`·`scanEngine` byCategory 1패스 확장)이다. 2026-06-07 코드 확인 ✅(typecheck/lint 0·`verify:recyclebin` 37/0·`verify:store` 99/0·`verify:scan` 39/0·빌드 성공·QA PASS).

| 기능(추적원) | UI 컴포넌트 | 유스케이스/스토어 | 도메인/엔진 규칙 | 채널 / DTO | 비고 |
|---|---|---|---|---|---|
| **되돌리기 `Ctrl+Z` 다단계 undo** (feat-K1, US-10.1, S) ✅ | (진입은 `commandBus` `file.undo`·아이콘바/메뉴; 토스트 안내) | `src/renderer/app/stores/undoSlice.ts`(`undoStack`·`UNDO_STACK_CAP=50`·`UndoEntry` 판별유니온 rename/create/move/copy/trash·`pushUndo`/`popUndo`) · `src/renderer/app/usecases/undo.ts`(`performUndo`·kind별 역연산·역연산 전 충돌 선검증·빈 스택 안내) · `usecases/fileOps.ts`/`operationsBridge.ts`(작업 시 `undoMeta` hook 적재·역연산 op엔 undoMeta 미부여) · `commandBus.ts`(`file.undo`→`performUndo`·`notYet` 제거) | rename↔rename·create→휴지통·move→역move·copy→사본휴지통·trash→`trashApi.restore`·영구삭제(delete) 미적재 | **신규 채널 0**(기존 `op:*`·`fsApi.validatePath`·`trashApi` 재사용)·`Ctrl+Z` global(입력/편집 미발화) | ADR-005·US-2.4 충돌 안전. **정직 한계: copy-undo 보수적(사본 경로 충돌 시 미생성·중단)·영구삭제 되돌릴 수 없음(미push·토스트).** ※ undo 역연산 네이티브 동작 런타임 스모크 권장 |
| **휴지통 관리 화면(복원·비우기)** (feat-K2, US-10.2, S) ✅ | `src/renderer/ui/trash/TrashDialog.tsx`(목록[이름·원경로·삭제일·크기]·복원·비우기 확인·focus trap[중첩 확인 포함]·Esc) · 사이드바/아이콘바 ④도구 진입 | `src/renderer/app/stores/trashSlice.ts`·`src/renderer/app/usecases/trash.ts` · `uiSlice.trashOpen`+가드 | `src/main/os/recycleBin.ts`(PowerShell Shell COM·env 주입·`$Recycle.Bin` 화이트리스트·`Move-Item` 폴백·throw 0·헤드리스 주입) | **신규 채널 `trash:list`/`trash:restore`/`trash:empty`(3종)**: `channels.ts`·`contracts.ts`(`TrashItemDTO`) → `main/ipc/trash.handlers.ts`(sender·zod·화이트리스트 재검증·`confirmed` 게이트) | ADR-005(임의 경로 실행 차단·검증된 항목에만 위임). P1 동결 후 신규 채널(선례 동일 규약·invoke). verify:recyclebin 37. ※ 휴지통 COM 실제 동작 런타임 스모크 권장 |
| **파일 유형별 비중 인사이트** (feat-K3, US-10.3, S) ✅ | `src/renderer/ui/dashboard/charts/CategoryBar.tsx`+표(비중%·절대 용량·파일 수·가장 큰 유형) · `DashboardModalBody.tsx` | `app/stores/analyzeSlice.ts`(byCategory 소비) | `src/main/operations/categorize.ts`(7카테고리 확장자 매핑·소문자 정규화·미매핑/확장자 없음→기타) · `src/main/operations/scanEngine.ts`(byCategory **1패스 집계·추가 I/O 0**) | **신규 채널 0**(기존 `analyze:scan:*` 재사용) · **DTO `ScanResult.byCategory?: CategoryUsage[]`**(비파괴 확장) | recharts 재사용(신규 의존성 0)·바이트 내림차순. I1 스캔 비차단·진행률·취소·순환 차단 규칙 승계. verify:scan 39 |

> **K장 신규 채널·의존성 정합(드리프트 아님)**: `trash:*` 3종은 P1 "전 채널 타입 동결" 이후 추가됐으나 P6 `preview:read`·H4 `shell:open-terminal`·I장 `analyze:scan:*`·J장 `fs:watch:*`과 동일 선례·동일 guard/zod/Result·sender 검증·화이트리스트·`confirmed` 게이트 규약을 따른다(product-planner가 PRD §6 Should·features §K2·US-10.2로 정식 편입). 신규 npm 의존성 0(`recycleBin.ts`는 PowerShell 시스템 내장·`execFile`). K1·K3은 신규 IPC 채널 0. **유령 매핑 없음(모든 매핑이 실 파일 경로와 일치, 2026-06-07 코드 확인).**

---

## 1-L. 그리드 보기 이미지 썸네일(L장, Should) → 구현 파일 매핑

> features §L(그리드 보기 이미지 썸네일 자체 생성)을 2026-06-07 정식 편입·구현(PRD §6 Should·user-stories 에픽11). roadmap §0.5 "P6 미구현 잔여 🔜"의 **마지막 항목 "그리드 썸네일 이미지 자체 생성"**을 정식 구현(P6 잔여 전부 해소 → §L 완료 시점 2026-06-07 기준 개발 잔여 🔜 0이었음; 이후 2026-06-08 §M 3건 신규 편입으로 현재 개발 잔여는 §M 3건 — roadmap §0.5 참조). J3(보기 5종 ✅)의 아이콘 그리드에서 이미지 파일만 형식 아이콘 대신 실제 내용 축소 썸네일로 표시, 그 외/실패는 H6 OS 아이콘 폴백. L1은 **신규 채널 `preview:thumbnail`(invoke 1종)**(P1 동결 이후 추가 — `preview:read`·`shell:open-terminal`·`analyze:scan:*`·`fs:watch:*`·`trash:*` 동일 선례)으로, **신규 npm 의존성 0**(Electron 내장 nativeImage). 2026-06-07 코드 확인 ✅(typecheck/lint 0·`verify:thumbnail` 33/0·빌드 성공·QA PASS US-11.1 8/8 결함 0).

| 기능(추적원) | UI 컴포넌트 | 유스케이스/스토어 | 도메인/엔진 규칙 | 채널 / DTO | 비고 |
|---|---|---|---|---|---|
| **그리드 보기 이미지 썸네일 자체 생성** (feat-L1, US-11.1, S) ✅ | `src/renderer/ui/panel/views/FileListView.tsx`(`ThumbnailIcon` — 그리드 icons-* 분기 한정·이미지=`<img objectFit:contain>` 비율보존 레터박스·미로드/null=`OSIcon` 폴백·로드 전 OSIcon 자리표시·details/list는 OS 아이콘 유지) | `src/renderer/infra/icon/thumbnailCache.ts`(iconCache 동형 전역 캐시·negCache·in-flight 디듀프·`useSyncExternalStore` 구독·`thumbnailKeyFor`·`requestThumbnail`) · `app/usecases/thumbnails`(경유) | `src/renderer/domain/image.ts`(`isThumbnailableExt` 이미지 판별·`thumbSizeFor` 셀 px×DPR→버킷 스냅, dpr=Math.min(2,devicePixelRatio)) | **신규 채널 `preview:thumbnail`(invoke)**: `channels.ts`(`PREVIEW_THUMBNAIL`)·`contracts.ts`(`ThumbnailReq`/`ThumbnailRes`·`Result<ThumbnailRes>`) → `main/ipc/preview.handlers.ts`(`handleGuarded`·`guardPath`)·`main/os/thumbnail.ts`(`getThumbnailDataUrl`·nativeImage `createFromPath`→비율보존 resize(긴 변=size 단일축)→`toDataURL`·`THUMB_MAX_BYTES` 30MB·LRU `MAX_THUMB_CACHE` 256·실패 비캐싱·세마포어 4·헤드리스 nativeImage 주입)·`guard.ts`(`zThumbnailReq`·`THUMB_SIZE_BUCKETS [32,48,64,96,128]` 화이트리스트) | ADR-005(렌더러 직접 파일 접근 없음·`guardPath`·H6 동일 보안 모델). dataUrl만(CSP `img-src data:`)·size 버킷 화이트리스트(DoS 차단). **신규 의존성 0**(Electron 내장 nativeImage). verify:thumbnail 33. ※ nativeImage 실 디코드·GUI 그리드 `<img>` 교체·1만 항목 비차단 런타임 스모크 권장 |

> **L장 신규 채널·의존성 정합(드리프트 아님)**: `preview:thumbnail`(invoke 1종)은 P1 "전 채널 타입 동결" 이후 추가됐으나 P6 `preview:read`·H4 `shell:open-terminal`·I장 `analyze:scan:*`·J장 `fs:watch:*`·K장 `trash:*`과 동일 선례·동일 guard/zod/Result·sender 검증·`guardPath`·size 버킷 화이트리스트 규약을 따른다(product-planner가 PRD §6 Should·features §L1·US-11.1로 정식 편입 — J3에서 보류했던 "이미지 썸네일 자체 생성"의 정식 구현). **신규 npm 의존성 0**(`thumbnail.ts`는 Electron 내장 nativeImage). **유령 매핑 없음(모든 매핑이 실 파일 경로와 일치, 2026-06-07 코드 확인 — `src/main/os/thumbnail.ts`·`src/renderer/infra/icon/thumbnailCache.ts`·`src/renderer/domain/image.ts`·`FileListView.tsx ThumbnailIcon` 실재 확인).**

---

## 1-P7. 릴리스 안정화 — 성능·접근성·보안·패키징(P7) → 구현 파일 매핑

> 로드맵 P7(안정화·성능검증·접근성·패키징, PRD §3·§7 NFR)의 **헤드리스 구현분**을 추적한다. 사용자 UI 신기능이 아니라 검증 하니스·접근성 보강·빌드 설정이므로 **실제 구현 파일·verify 스크립트·문서**로 추적한다(2026-06-07 코드 확인 ✅). **헤드리스로 증명된 것만 ✅, GUI 실행/인증서/실 환경 필요분은 🟡(런타임 잔여) — ✅ 위장 아님.**

| 기능(추적원) | 구현 파일(실경로) / 검증 | 상태 |
|---|---|---|
| **접근성 — 포커스 트랩·모달 ARIA·키보드** (PRD §7 접근성, US-5.4) | `src/renderer/ui/keyboard/useFocusTrap.ts`(첫 포커스·Tab 순환·opener 복귀·Esc 위임) · 모달 6종 `role=dialog`/`aria-modal`/Esc(`ConfirmDialog`·`DashboardModal`·`ConflictDialog`·`WorkspaceDialog`·`SettingsDialog`·`ProgressDialog`) · `FileListView`(행 `aria-posinset/setsize`) · `:focus-visible`(전역+인라인 outline 제거) · Shift+F10 컨텍스트 메뉴 | ✅ 코드(실 스크린리더 발화·포커스 육안은 런타임 🟡) |
| **WCAG AA 대비** (PRD §7 접근성) | `scripts/verify-contrast.ts`(4팔레트 LIGHT/DARK/BLUELIGHT 주요 토큰쌍 AA 전수·실패 0) · `ui/theme/palette.ts`(LIGHT text-muted·DARK danger 미세 보정) | ✅ |
| **성능 측정 하니스(불변식)** (PRD §3·§7 1.5초/200ms, US-5.6) | `src/renderer/ui/panel/views/windowing.ts`(computeWindow 순수함수·`startIdx≤endIdx` 클램프) · `scripts/verify-perf.ts`(25: windowing 불변식·1만 항목 DOM 후보 수십개·200ms 스로틀·검색 필터) · `docs/P7-perf-measurement.md`(실측 절차) | ✅ 헤드리스 불변식 / 🟡 실측 숫자(GUI 런타임) |
| **F장 QA 매트릭스(코드경로)** (PRD F장 Windows 특수케이스) | `scripts/verify-fmatrix.ts`(32: 롱패스·정션 순환·UNC/매핑 판정·ENOENT/ENOTDIR throw 0) · `docs/P7-qa-matrix.md` | ✅ 헤드리스분 / 🟡 실케이스(실 네트워크·symlink·ACL deny EACCES) |
| **보안 audit·sourcemap·코드서명 설정** (PRD §7 보안, ADR-005/006) | `docs/P7-security-audit.md`(npm audit 9건 판정·릴리스 차단 아님) · `electron.vite.config.ts`(sourcemap main/preload true·renderer `'hidden'`) · `electron-builder.yml`(`!out/**/*.map` 제외·`CSC_LINK`/`CSC_KEY_PASSWORD`·`signingHashAlgorithms`) | ✅ 점검·설정(준비완료) / 🟡 실제 서명(.pfx 인증서)·NSIS 설치 실측 |

> **P7 정직 구분 주석**: 위 매핑은 코드·verify·문서로 **헤드리스 증명된 부분만 ✅**다. 성능 실측 숫자·실제 코드서명·NSIS 설치/실행/제거 실측·F장 실케이스·실 스크린리더는 GUI 실행/인증서/실 환경이 필요해 **🟡 런타임 잔여**다. **P7 전체는 아직 🟡(릴리스 미완)** — roadmap §0.5·§3 P7 단계와 동일 기준. npm audit 9건은 major 업그레이드 필요(비파괴 fix 0)·빌드 툴체인+electron 본체(ADR-005 완화)로 **릴리스 차단 아님**(사용자 결정 보류).

---

## 1-M. 외부 연계(§M, 2026-06-08 편입) → 구현 매핑 — ✅ 구현 완료·QA PASS (실 동작 런타임 스모크 🟡)

> features §M(M1 외부 D&D·M2 클립보드 CF_HDROP 양방향·M3 FTP/SFTP)·user-stories 에픽12(US-12.1~12.5)·flows F14~F16. **신규 [ADR-007](./adr/ADR-007-remote-protocol-and-network-boundary.md)** 가 보안·네트워크 경계·프로세스 배치를 정의(ADR-005 부분 개정). 신규 채널은 ADR-003 단일출처 규약(P1 동결 후 `preview:read`·`shell:open-terminal`·`analyze:scan:*`·`fs:watch:*`·`trash:*`·`preview:thumbnail` 동일 선례)으로 추가됐다. **상태: 3건 전부 ✅ 구현 완료·통합 QA PASS(2026-06-08·MP0~MP5)·매핑 17파일 실재 확인(허위/누락 매핑 0)** — 아래 표 모듈/채널은 계획이 아니라 실재 코드. 상태 단일 출처는 roadmap §0.5. **실 동작(외부 앱 실드롭·탐색기 양방향 왕복·실 SFTP/FTP/FTPS·실 DPAPI·실 전송)은 런타임 스모크 권장 🟡**(✅ 위장 아님).

| 기능(추적원) | UI 컴포넌트(계획) | 유스케이스/스토어(계획) | 도메인 규칙(계획) | IPC 채널(계획) | 관련 ADR | 상태 |
|---|---|---|---|---|---|---|
| **외부 프로그램으로 D&D 복사** (M1, US-12.1, F14, S) | `ui/dnd`(외부 드래그 시작)·`FileListView` | `usecases/externalDrag.ts`(도착지 외부 판정→위임)·기존 A3 D&D 분기 | `domain/rules/transferRoute.ts`(외부=복사 고정)·기존 `resolveDragIntent` | **`dnd:start-drag`**(신규·invoke) → `main/os/dragdrop.ts`(`webContents.startDrag`·경로 정규화/존재/권한/로컬 한정)·`dnd.handlers.ts`(sender·zod) | ADR-007 ⑦, ADR-005 | ✅ (실 OS 드롭 🟡) |
| **클립보드 외부 연계(CF_HDROP 양방향)** (M2, US-12.2, F15, S) | 컨텍스트메뉴/단축키(기존)·붙여넣기 활성 판정 | `usecases/clipboardExternal.ts`(쓰기/읽기·내부/외부 우선순위)·기존 clipboard usecase | 기존 "복사본" 명명·D4 충돌 준용 | **`clipboard:write-files`/`clipboard:read-files`/`clipboard:has-files`**(신규·기존 텍스트 폴백 `clipboard:copy-files`/`cut-files`/`paste-target`/`read` 대체·확장) → `main/os/shellClipboard.ts`(CF_HDROP·Preferred DropEffect 바이트)·`clipboard.handlers.ts`. 붙여넣기는 기존 `op:start(copy/move)` 재사용 | ADR-007 ⑦, ADR-005 | ✅ (실 왕복 🟡) |
| **FTP/SFTP 접속(자격증명 OS 보관소)** (M3, US-12.3, F16, C) | `ui/remote/`(연결 다이얼로그·사이드바 "원격"·호스트키/비암호화 경고) | `usecases/remote.ts`(연결/프로필 CRUD)·`stores/remoteSlice.ts` | — | **`remote:connect`/`remote:disconnect`**·**`remote:cred:save/has/delete`**·**`remote:profile:list/upsert/delete`**·푸시 **`remote:host-key`/`remote:session-error`** → `main/remote/RemoteSessionManager.ts`·`SftpAdapter`(ssh2-sftp-client)·`FtpAdapter`(basic-ftp)·`main/os/credentials.ts`(safeStorage/DPAPI) | **ADR-007 ①②③④⑤⑥**, ADR-005 | ✅ (실 서버/DPAPI 🟡) |
| **원격 탐색·다운로드** (M3, US-12.4, F16, C) | `ui/remote/`·기존 `FileListView`(원격 entries 재사용)·`PanelHeader`(원격 경로 배지) | `usecases/remote.ts`(탐색·다운로드)·`usecases/navigation`(location.kind 분기)·기존 operations | `transferRoute.ts`(원격→로컬=download)·원격 응답 불신 검증 | **`remote:list`/`remote:stat`/`remote:mkdir`/`remote:rename`/`remote:delete`**·**`remote:download`** → `remoteTransfer.ts`(.part 임시명·원자 rename)·진행률 **기존 `op:progress`/`op:conflict`/`op:done`** 재사용 | ADR-007 ⑤⑥, ADR-003 | ✅ (실 서버/전송 🟡) |
| **원격 업로드·연결 끊김/타임아웃** (M3, US-12.5, F16, C) | `ui/remote/`(세션 오류 표시·패널 격리) | `usecases/remote.ts`(업로드·재시도 안내) | `transferRoute.ts`(로컬→원격=upload) | **`remote:upload`**·**`op:cancel`** 재사용·푸시 **`remote:session-error`**(세션 격리·D4 충돌/E4 진행률 재사용) | ADR-007 ⑤⑥, ADR-005 | ✅ (실 전송/끊김 🟡) |

> **§M 신규 채널 정합(드리프트 아님·구현 완료)**: `dnd:*`·파일 `clipboard:*`·`remote:*`는 P1 "전 채널 동결" 이후 추가됐고, 기존 6선례(`preview:read`·`shell:open-terminal`·`analyze:scan:*`·`fs:watch:*`·`trash:*`·`preview:thumbnail`)와 동일 규약(`shared/ipc` 단일출처·invoke/이벤트·`Result`·sender·zod·경로/세션 검증)을 따른다(product-planner가 PRD §6 §M·features §M·US-12.1~12.5로 정식 편입). **신규 npm 의존성: `ssh2-sftp-client`(Apache-2.0)·`basic-ftp`(MIT) 2종(M3만)·`src/main/remote/`에서만 import(ESLint 화이트리스트·`verify:eslint-remote` 29).** M1·M2는 신규 npm 의존성 0(Electron 내장 startDrag·clipboard buffer·safeStorage). **2026-06-08 구현 완료 — 위 표 매핑은 실 파일 경로로 확정됨(17파일 실재·doc-synchronizer 동기화 완료).**

> **§M 보안 추적(필수 수용 기준)**: 자격증명 평문 금지·OS 보관소만(D6) → `os/credentials.ts`(safeStorage/DPAPI)·비밀 DTO/로그 미수록(ADR-007 ③⑥). 네트워크 경계 D5→D7 부분 개정 → `src/main/remote/` ESLint 화이트리스트(ADR-007 ②)·`.eslintrc.cjs` overrides. **구현 시 `.eslintrc.cjs` main override `no-restricted-imports`에 기존 8개(`http`/`https`/`net`/`dgram`±node:)는 유지하고 `node:tls`·원격 라이브러리(`ssh2`·`ssh2-sftp-client`·`basic-ftp`)를 신규 차단 추가 + `src/main/remote/**` 예외(allow)**(현 코드는 tls·원격 라이브러리 미차단이므로 "추가"가 필요). 원격 응답 불신(traversal·심볼릭·호스트키 TOFU·평문 FTP 경고·.part 임시명) → ADR-007 ⑥.

---

## 2. 단축키 표(PRD 8장) → 처리 위치 매핑

> 단일 출처: `renderer/domain/keybindings`(키→commandId). 디스패치는 SW 7장.

| 키 | commandId | 처리 슬라이스/유스케이스 |
|---|---|---|
| `Tab` | `panel.focusNext`(순환) | tabsSlice |
| `Ctrl+←/→` | `panel.focusDir(dir)`(방향) | tabsSlice |
| ~~`F5` / `F6`~~ | ~~`panel.copyToOther`/`moveToOther`~~ | **삭제됨(2026-06-07 사용자 요청)** — 키 미배정·commandId/usecase 코드에서 제거. 패널 간 복사/이동은 D&D·클립보드(`Ctrl+C/X/V`)가 단일 경로 |
| `Ctrl+R` | `panel.refresh` | panelsSlice → fs:list:start |
| `Ctrl+T/W/Shift+T/D`, `Ctrl+Tab`, `Ctrl+1~9` | `tab.*` | tabsSlice |
| `Ctrl+\` | `layout.toggleSplit2` | tabsSlice |
| `Ctrl+B` (S) | `sidebar.toggle` | sidebarSlice(`toggleSidebar`) |
| `Alt+←/→/↑`, `Backspace` | `nav.back/forward/up` | panelsSlice(navHistory) |
| `Ctrl+L` / `Ctrl+F` | `address.edit`/`search.open` | 컨텍스트 스코프 진입 |
| `Ctrl+C/X/V` | `file.copy/cut/paste` | clipboard usecase |
| `F2`, `Ctrl+Shift+N` | `file.rename`/`file.newFolder`(+새 파일) | file usecase → fs:rename/fs:mkdir/fs:create-file |
| `Delete`/`Shift+Delete` | `file.trash`/`file.deletePermanent` | file usecase → op:trash/op:delete |
| `Ctrl+Z` (S) | `file.undo` → `performUndo` | Undo 스택 ✅(K1: `undoSlice.ts` cap 50·`undo.ts` 역연산·§1-K) |
| `Ctrl+A`, `Ctrl+클릭`, `Shift+클릭` | `select.all/toggle/range` | selectionSlice |
| `Ctrl+P` (S) | `preview.toggle` | uiSlice |

> **충돌 회피 검증 반영**(결정-D4): `Tab`/`Ctrl+R`가 고유 commandId로 매핑됨(~~`F5`/`F6`~~은 2026-06-07 제거되어 미배정). 레지스트리가 동일 컨텍스트 중복 매핑을 부팅 시 assert.
> **포커스 명령 구분**: `panel.focusNext`(Tab=순환)와 `panel.focusDir(dir)`(Ctrl+←/→=방향)는 별개 commandId다(SW §7.2와 통일).

---

## 3. 비기능 요구(PRD 7장) → 구조적 대응

| 비기능 요구 | 구조적 대응 | 근거 문서 |
|---|---|---|
| 10,000개 1.5초 첫 렌더 | 디렉토리 스트리밍(fs:list:chunk) + 가상 스크롤 첫 청크 즉시 렌더 / **P7 ✅ 불변식 검증**(`windowing.ts`·`verify:perf` 25), 🟡 실측 숫자 런타임 | SA 3.1, SW 6.2, ADR-004, §1-P7 |
| 진행률 200ms·UI 비차단 | Worker 실행 + Main 200ms 스로틀 + 이벤트 스트림 + 셀렉터 리렌더 격리 | SA 4.1, ADR-005, ADR-002 |
| 검색 입력 200ms (US-4.1 Must) | 도메인 순수함수 메모이즈 + deferred/transition; 미달 시 가시영역 우선 필터 → (필요 시) Web Worker 폴백, M1 측정 항목화 | SW 6.3, SW §10-1 |
| 삭제 휴지통 경유·되돌리기 | op:trash + Undo 스택 ✅(K1: `undoSlice.ts`·`undo.ts`·§1-K) + 휴지통 관리 `trash:*`(K2) | SA 4.2, §1-K |
| 충돌 임의 덮어쓰기 금지 | op:conflict 질의 → 사용자 명시 선택 | SA 4.1, SW 8 |
| 비정상 종료 복원 | 변경 시 디바운스 저장 + 원자적 쓰기 + 스키마 버전 | SA 5장 |
| 보안(로컬·권한·옵트인) | contextIsolation+sandbox, Main FS 격리, 양단 검증, 네트워크 차단 기본 | ADR-005, SA 3.3 |
| 롱패스/링크/네트워크/권한 | FileSystemService 예외 처리 + FileOpError 전파 + 패널 단위 오류 격리 | SA 4장, ADR-003 |
| 단일 인스턴스 | Main requestSingleInstanceLock | SA 2.3 |
| 접근성(키보드/포커스/ARIA) | 중앙 단축키 디스패치·컨텍스트 스코프, ARIA 행 레이블 / **P7 ✅**: `useFocusTrap`·모달 6종 role/aria/Esc·행 `aria-posinset/setsize`·`:focus-visible`·Shift+F10·WCAG AA 4팔레트 전수(`verify:contrast`), 🟡 실 스크린리더 | SW 7, ADR-004, §1-P7 |

---

## 4. 추적성이 커버한 핵심 기능 (요약)

탭 관리 · 2분할/4분할 패널 · 패널 간 이동/복사(D&D·클립보드 — ~~F5/F6~~ 2026-06-07 제거) · 목록 보기/정렬(**보기 5종 J3: `ViewMode`**) · 생성/이름변경(fs:mkdir/create-file/rename) · 삭제(휴지통/영구) · 파일 실행/열기(B6) · 복사/붙여넣기 · 충돌 해결 · 주소표시줄/탐색 · 트리 사이드바 · 즐겨찾기/최근(**별칭 J7: `favoriteLabels`**) · 현재 폴더 검색 · 확장자 필터 · 미리보기(S, **2단 뷰어 J5·폭 조절 J6**) · 다중 선택/일괄(**박스 선택 J1: `boxSelect`**) · 진행률/취소 · 대용량 빠른 첫 렌더(성능) · 테마(라이트/다크/시스템/**블루라이트 차단 I2**) · 설정(E6) · 키보드 워크플로(8장 전체) · 자동 세션 복원 · 상태바 · 명시적 워크스페이스(S) · 휴지통 연동 · Windows 특수케이스 · 텔레메트리 옵트인 · **사용량 대시보드(S, I1: `analyze:scan:*`·recharts)** · **패널 실시간 갱신(S, J2 ✅: `fs:watch:*`·`WatchService`(UNC + 매핑 드라이브 eager + reactive 폴링)·`os/driveType.ts`(GetDriveType 연동)·`panelsSlice` softRefresh/보존; `subst`·일부 클라우드(`DriveType≠4`)만 미포함 한계)** · **브랜딩 AGT-Finder(M릴리스, J4: appId `com.agtfinder.app`)**.

> 위 항목 모두 컴포넌트·유스케이스/스토어·IPC 채널·ADR로 매핑 완료. 생성/이름변경(B3)은 전용 `fs:mkdir`/`fs:create-file`/`fs:rename` 채널(SA §3.2), 실행(B6)은 `shell:*`, 설정(E6)은 `settings:get/set`으로 실 채널까지 연결했다(유령 매핑 제거). **Should 4종(4분할·미리보기·워크스페이스·텔레메트리)은 P6에서 실 파일·채널까지 매핑 완료 ✅** — 미리보기는 신규 `preview:read`(기존 `fs:stat` 잠정 매핑 정정), 텔레메트리는 신규 `telemetry:get-opt-in` 추가. **연결 프로그램으로 열기(`shell:open-with`)·컨텍스트 메뉴(우클릭) 인프라는 P6 시점에 구현 완료 ✅**(후자는 P4 산출물이 실제 누락돼 있던 드리프트를 해소 — `ui/contextmenu/`·속성→`shell:show-properties` 호출 UI 포함). **신규 UX 6종(H장: 아이콘바 H1·사이드바 토글 H2·분할 크기조절 H3·터미널 열기 H4·경로 직접 입력 H5·파일 유형 아이콘 H6)도 구현 완료 ✅**(§1-H 매핑 — renderer commandId 4건·`TabSnapshot.splitRatios` DTO 확장·`coerceSplitRatios`; **H4 신규 채널 `shell:open-terminal`·H6 예약 채널 `shell:icon` 정식 구현(예약→구현 드리프트 해소)**; US-7.2/7.3 드래그·H4 `wt.exe`·H6 `app.getFileIcon` 실제 네이티브 실행은 런타임 스모크 권장). **신규 보기·실시간·뷰어·브랜딩(J장: 박스 선택 J1·패널 실시간 갱신 J2·보기 5종 J3·AGT-Finder 브랜딩 J4·미리보기 2단 뷰어 J5·폭 조절 J6·즐겨찾기 별칭 J7)도 구현 완료 ✅**(§1-J 매핑 — J2 신규 채널 `fs:watch:*`·J3 `ViewMode`·J4 appId `com.agtfinder.app`·J5 highlight.js/marked/dompurify·J6 `previewWidth`·J7 `favoriteLabels`; **J2 실시간 갱신은 보류 2건(선택/스크롤 보존·UNC 폴링 폴백) 구현 완료 + 매핑 네트워크 드라이브 `GetDriveType` 연동(`os/driveType.ts` PowerShell CIM `DriveType=4`·`paths.isNetworkDriveRoot`)으로 🟡→✅ 격상 — `panelsSlice` softRefresh/`pendingScrollRestore`·`WatchService` UNC + 매핑 드라이브 eager + reactive 폴링·`paths.ts` isUncPath/isNetworkDriveRoot; `subst`·일부 클라우드(`DriveType≠4`)만 미포함 한계**; 워처/뷰어 네이티브 동작·박스선택 드래그는 런타임 스모크 권장). **F5/F6 복사·이동 매핑은 코드 제거에 맞춰 §1·§2에서 정정(유령 매핑 제거).** **신규 K장 3종(되돌리기 Ctrl+Z K1·휴지통 관리 화면 K2·파일 유형별 비중 K3)도 구현 완료 ✅**(§1-K 매핑 — K1 `undoSlice.ts`(cap 50)·`undo.ts` 역연산·`commandBus` `notYet`→`performUndo`(신규 채널 0)·K2 신규 채널 `trash:*` 3종·`recycleBin.ts` Shell COM·`TrashDialog.tsx`·K3 `categorize.ts`·`scanEngine` byCategory 1패스·`ScanResult.byCategory` DTO 비파괴 확장(신규 채널 0); **이로써 직전 "Should 잔여"였던 되돌리기·휴지통 관리 화면이 해소**됨; copy-undo 보수적·영구삭제 미push·휴지통 COM 런타임 스모크 권장). **신규 L장 1종(그리드 보기 이미지 썸네일 자체 생성 L1)도 구현 완료 ✅**(§1-L 매핑 — 신규 채널 `preview:thumbnail`·`os/thumbnail.ts` nativeImage 비율보존 resize·30MB 상한·LRU 256·세마포어 4·`thumbnailCache.ts`·`domain/image.ts`·`FileListView ThumbnailIcon`·신규 의존성 0·verify:thumbnail 33; **이로써 직전 "Should 잔여"였던 그리드 썸네일 이미지 자체 생성이 해소** → Should 잔여(🔜) 0). **이로써 §L 완료 시점(2026-06-07) 기준 개발 잔여(🔜)는 0이었다 — 남은 것은 P7 릴리스 실측·실제 코드서명·런타임 스모크(🟡)뿐이었다(아래 §1-P7). 2026-06-08 §M(외부 연계) 3기능(M1·M2 Should·M3 Could, US-12.1~12.5)이 기획 편입(🔜)됐다가 같은 날 MP0~MP5로 구현 완료·통합 QA PASS(✅)됨 → 현재 개발 잔여(🔜) = 0(매핑 §1-M 실 파일로 확정·실 동작은 런타임 스모크 권장 🟡). roadmap §0.5 머리말 §M 줄이 단일 출처.** nativeImage 실 디코드·GUI 그리드 렌더은 런타임 스모크 권장.
