# 개발 로드맵 — Explorer (멀티 디렉토리 파일탐색기)

> 작성: 테크리드 · 2026-06-06 · **갱신: 2026-06-07** · 상태: **P0~P5(MVP) 구현 완료 · P6(Should) 구현 완료 · 신규 UX(H장: 아이콘바·사이드바 토글·분할 크기조절·터미널 열기·경로 직접 입력·파일 유형 아이콘) 구현 완료 · 신규 분석·접근성(I장: 사용량 대시보드·블루라이트 차단 테마) 구현 완료 · P7 부분**
> 입력 설계: [system-architecture.md](./architecture/system-architecture.md) · [software-architecture.md](./architecture/software-architecture.md) · [directory-structure.md](./architecture/directory-structure.md) · [traceability.md](./architecture/traceability.md) · [adr/](./architecture/adr/)
> 우선순위 출처: [PRD.md §6 MoSCoW](./PRD.md) · [user-stories.md](./user-stories.md)
> 상태 범례: ✅ 완료 · 🟡 부분 · 🔜 미착수

---

## 0. 목적 / 읽는 법

이 문서는 확정된 아키텍처를 **독립적으로 빌드·검증 가능한 순서 있는 단계(Phase)** 로 분해한 개발 로드맵이다.

- **MVP = PRD §6 Must 전체** → P0~P5에서 완성. **Should(4분할·미리보기·워크스페이스·텔레메트리)** → P6 이후로 분리.
- 각 단계는 **목표 / 산출물(모듈·파일 영역) / 의존 / 담당 역할 / 완료 기준(DoD, 측정 가능) / QA 검증 포인트 / 추적성(US·feat·설계 모듈)** 을 명시한다.
- **역할 분담 원칙**: P0은 devops 골격 → 이후 backend(Main: IPC/FS/파일작업)와 frontend(Renderer: React UI/상태)가 `shared/ipc` 계약을 합의한 뒤 병렬 → qa는 각 단계 경계면 교차 검증.
- **계약 단일화**: 모든 요청/응답 shape은 `src/shared/ipc/contracts.ts` + `src/shared/ipc/channels.ts` + `src/shared/dto/`에 단일 출처로 둔다. backend·frontend·preload가 동일 타입을 import → 컴파일 타임에 계약 위반 검출.

---

## 0.5 진행 현황 (2026-06-07 기준)

> **MVP(Must, P0~P5) 구현 완료 + P6(Should 4종: 4분할·미리보기·워크스페이스·텔레메트리) 구현 완료 + 신규 UX(H장 6기능: 상단 아이콘바·사이드바 토글·분할 크기조절·터미널 열기·경로 직접 입력·파일 유형 아이콘) 구현 완료 + 신규 분석·접근성(I장 2기능: 사용량 대시보드·블루라이트 차단 테마) 구현 완료.**
> 자동 verify 하니스 누계 **434 pass / 0 fail**(직전 400 + `verify:persistence` 보강 +6 + `verify:scan` 28: scanEngine 재귀 집계·Top10 힙·순환 realpath Set·skipped 격리·취소 부분결과·truncated 상한), typecheck/lint 0, 빌드 성공(메인 466kB + 대시보드 831kB **별도 lazy 청크 분리**),
> NSIS 인스톨러 + 앱 아이콘 생성 완료. 기획→설계→구현 추적성 검증 **PASS(Must 18/18 = 100%)**,
> 통합 QA **PASS**(P6·신규 UX·I장 블로커/높음/보통 0건, 결함 0; 잔여 성능 실측·네이티브 statfs·대용량 스캔 성능은 런타임 스모크 권장).
> **추가(2026-06-07):** Should `shell:open-with`(연결 프로그램으로 열기) 구현 완료 ✅, **P4 산출물 컨텍스트 메뉴(우클릭)가 P6 시점에 뒤늦게 구현되어 드리프트 해소**(직전까지 P4가 ✅였으나 `ui/contextmenu/`·속성→show-properties 호출 UI는 미구현이었음 — 아래 §0.5 주석 참조), **신규 UX 3기능(H장: feat-H1/H2/H3 · 에픽7 US-7.1~7.3)이 구현·QA PASS**, 그리고 **신규 UX 추가 3기능(H장: feat-H4/H5/H6 · 에픽7 US-7.4~7.6, PRD §6 Should)이 구현·QA PASS** 됨(아래 "신규 UX(H장)" 표 참조). **이때 P1에서 "전 채널 동결" 후 P2/P4 단계의 시스템 아이콘 캐시로 예약·미구현이던 `shell:icon` 채널이 feat-H6로 정식 구현(호출부 추가)되어 예약→구현 드리프트가 해소**됐고, **터미널 열기용 신규 채널 `shell:open-terminal`이 추가**됐다(동결 예외 — 아래 신규 채널 주석).
> **추가(2026-06-07, I장):** **신규 분석·접근성 2기능(I장: feat-I1 디렉토리 사용량 대시보드 · feat-I2 블루라이트 차단 테마 · 에픽8 US-8.1/8.2, PRD §6 Should)이 구현·QA PASS** 됨(아래 "신규 분석·접근성(I장)" 표 참조). **I1은 신규 채널 `analyze:scan:*` 5종을 추가**(P1 동결 이후 Should 신기능 신규 채널 — `preview:read`·`shell:open-terminal` 선례와 동일 규약, 아래 신규 채널 주석), 디스크 요약은 기존 `DriveDTO.totalBytes/freeBytes`+`diskSpace()` 재사용(backend 신규 0). **차트 라이브러리 recharts 3.8.1(MIT) 신규 도입** — `DashboardModalBody` React.lazy로 **831kB 별도 청크 분리**(메인 번들 비대화 없음). I2는 신규 채널 0(테마 토큰 1종 추가).

| Phase | 상태 | 비고 |
|---|---|---|
| **P0** 골격·빌드 | ✅ 완료 | install/typecheck/build/lint/NSIS 패키징 통과 |
| **P1** IPC 계약·FS 읽기 | ✅ 완료 | 전 채널 타입 동결, `fs:*` 읽기 핸들러 (verify:fs 19/19) |
| **P2** 단일 패널 UI | ✅ 완료 | 가상 스크롤·정렬·주소창·트리·파일 실행(`shell:open`) |
| **P3** 탭·2분할·단축키 | ✅ 완료 | KeyBindingRegistry, 활성 패널 포커스 |
| **P4** 파일작업·진행률·충돌·D&D | ✅ 완료 | Worker Threads·휴지통·충돌해결 (BUG-001 수정 완료) |
| **P5** 검색·세션복원·설정·테마·상태바 | ✅ 완료 | **MVP(Must 18/18) 완성** |
| **P6** (Should) 4분할·미리보기·워크스페이스·텔레메트리 | ✅ 완료 | 4종 구현(verify:p6 26/26) **+ 연결 프로그램으로 열기(`shell:open-with`) 구현 완료(verify:open-with 12/12)**. **Should 잔여(그리드/썸네일 보기·되돌리기 Ctrl+Z)는 미구현 🔜 — 아래 표** |
| **P7** 안정화·성능실측·접근성·패키징 | 🟡 부분 | **NSIS 패키징·앱 아이콘 완료**, 성능 3종 실측·접근성·코드서명·`npm audit` 미완 |
| **릴리스/도구**(G장, 기획 정식 편입) | ✅ 완료 | 앱 아이콘(G1·US-6.1) · 원클릭 빌드 `build-installer.ps1`(G2·US-6.2) · 가상 스크롤 결함 수정(G3·US-5.6 보강) — PRD §6·§7·§12, features §G, user-stories 에픽6 |
| **신규 UX**(H장, 기획 정식 편입, Should) | ✅ 완료 | 상단 전역 아이콘바(H1·US-7.1) · 사이드바 온오프 토글(H2·US-7.2, `Ctrl+B`) · 분할 크기조절(H3·US-7.3) · **우클릭 터미널 열기(H4·US-7.4, 신규 채널 `shell:open-terminal`) · 디렉토리 경로 직접 입력(H5·US-7.5) · 파일 유형별 OS 아이콘(H6·US-7.6, 예약 채널 `shell:icon` 정식 구현)** — PRD §6 Should·§8 `Ctrl+B`, features §H, user-stories 에픽7. **US-7.2/7.3 실제 마우스 드래그·US-7.4 `wt.exe`·US-7.6 `app.getFileIcon` 실제 네이티브 실행은 런타임 의존 → 런타임 스모크 권장(코드 정합 충족)** |
| **신규 분석·접근성**(I장, 기획 정식 편입, Should) | ✅ 완료 | 디렉토리 사용량 대시보드(I1·US-8.1, **신규 채널 `analyze:scan:*` 5종**·recharts 도넛/막대+표·진행률·취소·비차단·자동 팝업 토글) · 블루라이트 차단 테마(I2·US-8.2, #FBF0D9 크림 배경 4번째 테마) — PRD §6 Should·§10 R4/R5, features §I, user-stories 에픽8. **WCAG: 블루라이트 본문 11.04:1·muted 5.25:1 등 AA 통과. 네이티브 실제 statfs·대용량 스캔 성능 실측은 런타임 스모크 권장(코드 정합·verify:scan 28 충족). 파일 유형별 비중 인사이트는 "(가능하면)" 선택항으로 미구현** |

**P6(Should) — 구현 완료분 ✅ (구현 파일)**

| 기능 | 구현 상태 / 핵심 파일 |
|---|---|
| 4분할(grid-4) US-1.4 | ✅ `ui/layout/LayoutHost.tsx`(2x2 row-major), `tabsSlice.ts`(`toggleGrid4`·`focusPanelDir`), `usecases/fileOps.ts`(grid-4 `activeIdx^1` 분기), `domain/keybindings/index.ts`(`ctrl+shift+\`→`layout.toggleGrid4`), `commandBus.ts` |
| 미리보기 패널 US-4.3 | ✅ 신규 채널 `preview:read`(`channels.ts`·`contracts.ts`·`dto`(PreviewData)), `main/fs/FileSystemService.ts#readPreview`, `main/ipc/preview.handlers.ts`, `ui/preview/PreviewPanel.tsx`+`renderers/*`, `uiSlice.previewOpen`, `commandBus#preview.toggle`, `Ctrl+P` |
| 워크스페이스 저장/복원 US-5.8 | ✅ `main/persistence/WorkspaceStore.ts`, `main/ipc/workspace.handlers.ts`(save/list/load/delete), `usecases/workspace.ts`, `ui/workspace/WorkspaceDialog.tsx`, `tabsSlice.resetWorkspace`+`session.ts#applySnapshot`(복원 단일화) |
| 텔레메트리 옵트인 결정-D5 | ✅ 신규 채널 `telemetry:get-opt-in`(부팅 재수화), `session.handlers.ts` 핸들러, `settings.ts#loadSettings`, `SettingsDialog` 체크박스, `.eslintrc.cjs` main 오버라이드 `no-restricted-imports`(node:http/https/net/dgram = 전송 전무 정적 가드), src 전역 네트워크 송신 grep 0건 |
| 연결 프로그램으로 열기(`shell:open-with`, features §B6 Should) | ✅ `main/os/shell.ts#openWith`(`execFile rundll32 shell32.dll,OpenAs_RunDLL`), `main/ipc/shell.handlers.ts`(SHELL_OPEN_WITH 핸들러, shell:open 동일 ADR-005 3중 검증), `main/ipc/guard.ts#zShellOpenWithReq`, frontend `usecases/open.ts#openWithEntry` + 컨텍스트 메뉴 "연결 프로그램으로 열기"(파일 전용). 검증 `verify:open-with` 12/12 |
| 컨텍스트 메뉴(우클릭) 인프라 (P4 산출물 — 뒤늦게 구현, 드리프트 해소) | ✅ `ui/contextmenu/ContextMenu.tsx`, `usecases/contextMenu.ts`(buildMenuItems·openRowContextMenu·openEmptyContextMenu), `uiSlice.contextMenu` 상태/액션, `FileListView`(onContextMenu), `App.tsx` 마운트. 항목: 열기·연결프로그램(파일전용)·복사·잘라내기·이름바꾸기·삭제(휴지통)·영구삭제·**속성→`shell:show-properties`**·빈영역(붙여넣기·새폴더·새로고침, My PC는 새로고침만). 우클릭이 키보드/툴바와 동일 commandId 경로로 수렴 |

> **드리프트 해소 주석(은폐 금지)**: P4 DoD "컨텍스트 메뉴 '속성'이 `shell:show-properties` 호출"과 P4 산출물 `ui/contextmenu/`는 직전(P6) 동기화 시점까지 **실제로는 미구현**이었으나 문서상 P4가 ✅로 표기돼 있었다(`shell:show-properties` backend 핸들러는 P4부터 있었으나 이를 호출하는 컨텍스트 메뉴 UI가 없었음). 이번에 컨텍스트 메뉴 인프라가 구현되어 P4 산출물·DoD가 **뒤늦게 충족(드리프트 해소)**됐다.

**P6(Should) — 미구현 잔여 🔜 (진입점만 예약)**

| 기능 | 현재 상태 |
|---|---|
| 그리드/썸네일 보기 | 🔜 `FileListView`에 `isGrid=false // P6` |
| 되돌리기(`Ctrl+Z`) | 🔜 `ctrl+z`→`file.undo` 키 등록, `commandBus` `notYet('되돌리기')` |
| 휴지통 관리 화면 | 🔜 미구현 |

**P6 신규 IPC 채널 2종(설계 원칙 정합)**: `preview:read`·`telemetry:get-opt-in`은 P1 "전 채널 타입 동결" 이후 P6에서 **추가된** 채널이다. P1 동결 원칙은 *기존* MVP 채널 계약을 동결해 병렬화 출발선을 고정하려는 것이며, Should 신기능에 필요한 신규 채널 추가는 그 원칙의 위반이 아니다(`channels.ts`에 "신규(P6 Should)"로 명시·동일 guard/zod/Result 규약 준수). 스코프 일탈 아님 — PRD §6 Should·US-4.3/D5에 근거. 

**릴리스/도구 — 기획 정식 편입 완료 ✅ (구 "로드맵 외 추가")**: 아래 3건은 더 이상 로드맵 외 유지보수가 아니라 기획에 **정식 편입**됐다 — features 신설 **§G**, user-stories 신설 **에픽6**, PRD **§6 릴리스 요건·§7·§12**. 코드 사실로 ✅ 확인됨.
> - **앱 아이콘 / 브랜딩** (G1·US-6.1, **M 릴리스 요건**): `resources/icon.ico`·`resources/icon.png`·`scripts/gen-icon.ps1`(겹친 폴더), electron-builder `win.icon` 연결.
> - **원클릭 인스톨러 빌드** (G2·US-6.2, **개발 도구**): 루트 `build-installer.ps1`(의존성→typecheck→build→NSIS 일괄·인스톨러 경로 출력).
> - **가상 스크롤 뷰포트 높이 측정 결함 수정** (G3·US-5.6 보강): `FileListView`를 콜백 ref 기반 ResizeObserver로 전환 + 전역 CSS 리셋(`index.html`) — 기존 Must "가상 스크롤" 품질 결함 수정(신규 스코프 아님).

**신규 UX(H장, Should) — 구현 완료 ✅ (구현 파일)**: 기존 동작(분할 A2·사이드바 C3·단축키 E1)을 더 빠르게 호출·조정하는 UX 확장. 2026-06-07 정식 편입(features §H·user-stories 에픽7·PRD §6 Should). 코드 사실로 ✅ 확인됨.

| 기능 | 구현 상태 / 핵심 파일 |
|---|---|
| 상단 전역 아이콘바 (H1·US-7.1) | ✅ `ui/toolbar/IconBar.tsx`·`iconBarItems.ts`(4그룹 20버튼, 활성조건·`aria-pressed`·툴팁에 단축키 표기, execCommand 수렴), `ui/App.tsx` 마운트. 신규 commandId 4건 `sidebar.toggle`·`theme.toggle`·`view.setMode.list`·`view.setMode.details`(`commandBus.ts`), `settings.ts#toggleThemeMode`·`applyTheme.ts#systemPrefersDark` export |
| 사이드바 온오프 토글 (H2·US-7.2) | ✅ `domain/keybindings/index.ts`(`ctrl+b`→`sidebar.toggle`) + 아이콘바 버튼 → `sidebarSlice.toggleSidebar`(collapsed 상태·세션 영속 기존 재사용). **실제 토글 마우스 클릭/단축키는 런타임 DOM 의존 → 런타임 스모크 권장** |
| 분할 패널 크기조절 (H3·US-7.3) | ✅ `ui/layout/SplitDivider.tsx`·`splitMath.ts`(`ratioFromPoint` 순수함수)·`LayoutHost.tsx`(2분할 flex·4분할 grid 컨테이너 ref 측정·2축 독립), `tabsSlice.setSplitRatio`(클램프 `SPLIT_MIN_RATIO=0.15`~0.85), `Tab.splitRatios`(`domain/entities`)·`shared/dto TabSnapshot.splitRatios?`·`usecases/session.ts` 직렬화·`main/persistence/defaults.ts#coerceSplitRatios` 정규화. **실제 분할선 드래그는 런타임 DOM 의존 → 런타임 스모크 권장** |
| 우클릭 "터미널 열기" (H4·US-7.4) | ✅ **신규 채널 `shell:open-terminal`**(`channels.ts`·`contracts.ts ShellOpenTerminalReq`), `src/main/os/shell.ts#openTerminal`(`wt.exe -d`→`powershell.exe -NoExit` 폴백·`execFile` 인자 배열), `shell.handlers.ts`(sender 검증·zod·guardPath·stat 디렉토리 검증 ADR-005), `guard.ts#zShellOpenTerminalReq`, `usecases/open.ts#openTerminalAt`·`terminalErrorMessage`, `contextMenu.ts`(단일 폴더·빈 영역 항목; 파일·My PC 미표시). **네이티브 `wt.exe` 실제 실행은 런타임 스모크 권장** |
| 디렉토리 경로 직접 입력 (H5·US-7.5) | ✅ `PanelToolbar.tsx` 단일 클릭 편집 진입(`closest('button')` 가드로 브레드크럼 버튼 클릭과 분리), 기존 `Ctrl+L`·더블클릭·`validateAndNavigate` 재사용(신규 채널·단축키 불요) |
| 파일 유형별 OS 아이콘 (H6·US-7.6) | ✅ **예약 채널 `shell:icon` 정식 구현(호출부 추가)** — `src/main/os/icon.ts`(`getFileIconDataUrl`·`cacheKeyFor`·LRU512·실패 비캐싱), `shell.handlers.ts SHELL_ICON`, `iconCache.ts`(`iconKeyFor`·`iconRequestFor`·디듀프·구독), `usecases/icons.ts`, `FileListView.tsx OSIcon`. 확장자 단위 캐시·per-file(exe/lnk 등) path 키·가상 스크롤 `iconRef` 지연. **네이티브 `app.getFileIcon` 실제 실행은 런타임 스모크 권장** |

> **신규 UX 설계 원칙 정합(드리프트 아님)**: H1~H3·H5의 신규 commandId·`splitRatios`는 **renderer 내부 commandId / 세션 스냅샷 DTO(`TabSnapshot`) 필드 확장**으로 P1 "전 채널 타입 동결"(IPC 채널 계약 동결)과 **무관**하다 — `Ctrl+B`·단일 클릭 편집도 신규 IPC 채널이 아니라 기존 슬라이스/`validateAndNavigate` 호출일 뿐이다. **H4의 신규 채널 `shell:open-terminal`은 P1 동결 이후 추가된 채널이나, 동결 원칙은 *기존* MVP 채널 계약을 고정해 병렬화 출발선을 잡으려는 것이고 Should 신기능에 필요한 신규 채널 추가는 위반이 아니다** — `preview:read`·`telemetry:get-opt-in`(P6)과 동일 선례·동일 guard/zod/Result 규약 준수. **H6의 `shell:icon`은 P1에 계약만 동결되고 호출부가 없어 "P2/P4 시스템 아이콘 캐시"로 예약·미구현이던 채널을 이번에 정식 구현(호출부 추가)** 한 것으로, 계약·보안·캐시 설계를 변경하지 않고 따른다(예약→구현, 드리프트 해소). 스코프 일탈 아님(product-planner가 PRD §6 Should·§8·features §H·US-7.4~7.6로 정식 편입).

**신규 분석·접근성(I장, Should) — 구현 완료 ✅ (구현 파일)**: 디스크 사용 현황 시각화(읽기 전용 스캔)와 저청색광 접근성 테마. 2026-06-07 정식 편입(features §I·user-stories 에픽8·PRD §6 Should·§10 R4/R5). 코드 사실로 ✅ 확인됨(typecheck/lint 0·`verify:scan` 28/0·QA PASS).

| 기능 | 구현 상태 / 핵심 파일 |
|---|---|
| 디렉토리 사용량 대시보드 (I1·US-8.1) | ✅ **신규 채널 `analyze:scan:*` 5종**(`channels.ts`·`contracts.ts`·`dto ScanResult/ScanEntry`) — `src/main/operations/scanEngine.ts`(재귀 집계·Top10 힙·순환 realpath Set·skipped·취소·truncated)·`src/main/workers/scanWorker.ts`·`src/main/workers/scanProtocol.ts`(SharedArrayBuffer 취소)·`src/main/operations/ScanManager.ts`(scanId·200ms 스로틀·푸시)·`src/main/ipc/analyze.handlers.ts`(guardPath·디렉토리 검증). 디스크 요약은 기존 `DriveDTO.totalBytes/freeBytes`+`diskSpace()` 재사용(backend 신규 0). frontend: `app/stores/analyzeSlice.ts`·`app/usecases/dashboard.ts`(scanId 상관 브리지)·`ui/dashboard/DashboardModal.tsx`(+`DashboardModalBody.tsx` **React.lazy**)·recharts 도넛/막대+표 병행·`iconBarItems`(dashboard.open)·`App.tsx` 자동 팝업·`uiSlice.showDashboardOnStartup`(기본 `true`)·SettingsDialog 토글. **recharts 3.8.1(MIT) 설치, 831kB 별도 lazy 청크 분리.** ※ 파일 유형별 비중 인사이트는 "(가능하면)" 선택항으로 미구현(정직 표기). 네이티브 statfs·대용량 스캔 성능은 런타임 스모크 권장 |
| 블루라이트 차단 테마 (I2·US-8.2) | ✅ `ui/theme/palette.ts BLUELIGHT_PALETTE`(13토큰·`#FBF0D9`)·`applyTheme.ts ResolvedTheme` 확장(bluelight **독립 resolved**·light 폴백 아님)·`ThemeMode` 4종(+`'bluelight'`)·`main/persistence/defaults.ts THEME_MODES`/`guard.ts zThemeMode` 화이트리스트·SettingsDialog 테마 4종 선택. `toggleThemeMode`는 light↔dark 유지(블루라이트는 설정에서 선택). 신규 채널 0. **WCAG: 본문 11.04:1·muted 5.25:1 등 AA 통과** |

**I장 신규 IPC 채널(설계 원칙 정합)**: `analyze:scan:start/progress/done/error/cancel`(5종)은 P1 "전 채널 타입 동결" 이후 I장에서 **추가된** 채널이다. P1 동결 원칙은 *기존* MVP 채널 계약을 고정해 병렬화 출발선을 잡으려는 것이며, **Should 신기능에 필요한 신규 채널 추가는 위반이 아니다** — P6 `preview:read`·`telemetry:get-opt-in`, H4 `shell:open-terminal`과 **동일 선례·동일 guard/zod/Result 규약** 준수(`channels.ts`에 "신규(I장)"로 명시). 스코프 일탈 아님(product-planner가 PRD §6 Should·§10·features §I·US-8.1로 정식 편입). I2는 신규 채널 0(테마 토큰 추가). **recharts(MIT)는 차트 라이브러리 신규 의존성**이나 PRD §10 R5에서 라이선스·번들 영향을 사전 검토했고, lazy 청크 분리로 메인 번들 비대화를 피했다(드리프트 아님 — 기획 근거 있음).

---

## 1. 단계 요약 표

| Phase | 상태 | 한 줄 목표 | 핵심 산출물 | 의존 | 주 담당 | MoSCoW |
|---|---|---|---|---|---|---|
| **P0** | ✅ | 프로젝트 골격·3엔트리 빌드·빈 창 실행 | electron-vite/builder 설정, main/preload/renderer 부트, TS/React/Zustand 초기화 | — | devops | Must(기반) |
| **P1** | ✅ | IPC 계약 기반 + FS 읽기 계층(목록 스트리밍) | `shared/ipc`, preload `window.api`, Result/FileOpError, `fs:*` 핸들러, FileSystemService, infra/api 브리지 | P0 | backend(+frontend 계약합의) | Must |
| **P2** | ✅ | 단일 패널 파일목록 UI(가상 스크롤·정렬·주소창·탐색·트리·파일 실행/열기) | FileListView(가상화), PanelHeader/주소표시줄, nav(뒤/앞/위), Sidebar 트리, panels/selection 슬라이스, open usecase + `shell:open` 핸들러 | P1 | frontend(+backend `shell:open`) | Must |
| **P3** | ✅ | 탭 + 2분할 레이아웃 + 패널 포커스 + 단축키 디스패치 | TabBar, LayoutHost(2분할), tabsSlice, KeyBindingRegistry/Dispatcher/CommandBus | P2 | frontend | Must |
| **P4** | ✅ | 파일 작업(CRUD·휴지통) + 진행률/취소 + 충돌해결 + 패널 간 D&D | `op:*`/`fs:mkdir·create-file·rename` 핸들러, Worker, OperationManager, ProgressDialog/ConflictDialog, dnd/, F5/F6 | P3 (계약은 P1) | backend+frontend | Must |
| **P5** | ✅ | 검색/필터 + 설정 화면(숨김·확장자 토글) + 즐겨찾기/최근 + 자동 세션복원 + 다크모드 + 상태바 | SearchBar/필터, `ui/settings/`(설정·숨김/확장자 토글), sidebarSlice(즐겨찾기·최근), session/settings 영속화, theme/, StatusBar | **P5a: P2** / **P5b: P3·P4** | backend+frontend | Must → **MVP 완성** |
| **P6** | ✅ | (Should) 4분할·미리보기·워크스페이스 저장·텔레메트리(옵트인)·연결프로그램으로 열기 | LayoutHost(grid-4), PreviewPanel/렌더러, `preview:read`, `workspace:*`, `telemetry:get/set-opt-in`, `shell:open-with`(+컨텍스트 메뉴 인프라) | P5 | backend+frontend | Should |
| **P7** | 🟡 | 안정화·성능검증·접근성·패키징(M4 릴리스 준비) | 1.5초/200ms 성능검증, 접근성, NSIS 인스톨러, QA 매트릭스 | P5(+P6 일부) | 전원 | Must(릴리스) |

> **마일스톤 매핑(PRD §12)**: P0~P2 ≈ M1(단일 패널 코어) · P3~P4 ≈ M2(핵심 차별점) · P5 ≈ M3(MVP 기능 완성) · P7 ≈ M4(1차 릴리스) · P6 ≈ M5+(후속).

### 스파이크(선행 또는 병행)
| Spike | 목적 | 시점 | 산출 |
|---|---|---|---|
| **SPK-Worker** | Worker 실행 모델 결정: UtilityProcess vs Worker Threads (취소 지연·진행률 정확도·휴지통/롱패스 네이티브 모듈 로드 벤치) | P1 후반~P4 시작 전 | ADR-005 갱신 |
| **SPK-Perf** | "1만 개 목록 입력 후 200ms 내 가시 결과" + "1만 개 첫 렌더 1.5초" 측정 | P2 말 ~ P5 검색 착수 전 | SW §6.3 폴백 채택 여부, SW §10-1 확정 |

---

## 2. 임계 경로 (Critical Path)

```
P0 → P1 → P2 → P3 → P4 → P5(=MVP 완성) → P7(릴리스)
                         └ P5a(검색/필터·테마·상태바·설정 화면)은 P2 위에서 선행 가능. P5b(세션복원·즐겨찾기·최근 영속)만 P3(탭/레이아웃)·P4(작업) 완료가 전제
```

- **MVP 임계경로 = P0 → P1 → P2 → P3 → P4 → P5.** 이 사슬이 직렬 의존이며 전체 일정을 지배한다.
- **병렬화로 단축 가능한 지점**:
  - P1에서 IPC 계약(`shared/ipc`)을 **가장 먼저 합의·동결**하면, 이후 backend(Main 핸들러 구현)와 frontend(infra/api 모킹 위에서 UI 구현)가 **계약을 경계로 병렬** 진행 → P2~P5의 backend·frontend 작업이 겹친다.
  - P4의 Worker/OperationManager(backend)와 ProgressDialog/ConflictDialog/dnd(frontend)는 `op:*` 계약 합의 후 병렬.
  - **SPK-Worker는 P4의 선행 블로커** → P1~P2 진행 중 병행 착수해 P4 시작 전 결론 필요(임계경로 보호).
  - **SPK-Perf는 P5 검색 착수 전 결론** 필요(폴백 3 Web Worker 도입 여부 결정).
- **임계경로 단축 핵심 한 줄**: "P1의 IPC 계약 동결을 최우선으로 끝내라. 계약이 곧 backend/frontend 병렬화의 출발선이다."

---

## 3. 단계별 상세

---

### P0 — 프로젝트 골격 · 빌드 파이프라인 · 빈 창 실행  ✅ 완료

| 항목 | 내용 |
|---|---|
| **목표** | electron-vite 3엔트리(main/preload/renderer) 빌드가 돌고, 보안 옵션이 적용된 **빈 창**이 dev(HMR)/prod 모두에서 실행된다. 이후 모든 단계의 토대. |
| **산출물(모듈·파일)** | `package.json`, `electron.vite.config.ts`, `electron-builder.yml`, `tsconfig.json`/`tsconfig.node.json`/`tsconfig.web.json`, `.eslintrc.cjs`(계층/프로세스 import 경계 규칙), `src/main/index.ts`(단일 인스턴스 락·창 생성·보안 webPreferences), `src/main/windows/`, `src/preload/index.ts`(빈 contextBridge), `src/renderer/index.html`·`main.tsx`·`ui/App.tsx`, Zustand 빈 store 부트, `src/shared/` 디렉토리 골격, `resources/`(앱 아이콘) |
| **의존** | 없음 |
| **담당** | **devops**(전담). frontend는 React/Zustand 부트 합류 가능 |
| **완료 기준(DoD)** | ☑ `npm run dev` → HMR 동작, 빈 창 표시<br>☑ `npm run build` → 3엔트리 번들 성공, 타입체크(`tsc --noEmit`) 0 에러<br>☑ `npm run package`(electron-builder) → Windows NSIS 인스톨러 산출물 생성<br>☑ BrowserWindow에 `contextIsolation:true, nodeIntegration:false, sandbox:true, webSecurity:true` 적용 확인<br>☑ 단일 인스턴스 락 동작(2회 실행 시 기존 창 포커스)<br>☑ ESLint import 경계 규칙이 위반(예: renderer에서 `node:fs` import)을 에러로 잡음<br>☑ 엄격 CSP 헤더 적용, 원격 콘텐츠 로드 없음 |
| **QA 검증 포인트** | dev/prod 양쪽 실행 스모크, 보안 옵션 4종 실측(devtools/소스 확인), import 경계 규칙이 의도대로 막는지 위반 샘플로 교차 확인, 인스톨러 설치/실행 |
| **추적성** | PRD §7(단일 인스턴스·보안), ADR-001(빌드), ADR-005(프로세스/보안), ADR-006(패키징), DS §2~5 |

---

### P1 — IPC 계약 기반 + FS 읽기 계층(디렉토리 목록·스트리밍)  ✅ 완료

| 항목 | 내용 |
|---|---|
| **목표** | 타입 안전 IPC RPC + 이벤트 스트림의 **전 채널 타입 계약을 동결**하고, Renderer가 `window.api`로 디렉토리 목록(소형 단발 + 대형 스트리밍)·stat·드라이브·트리·경로검증을 받을 수 있다. **계약 동결 = 이후 backend/frontend 병렬화의 출발선.** (핸들러 구현 범위는 단계별로 분리 — 아래 (a)/(b) 참조) |
| **산출물(모듈·파일)** | **(a) 전 채널 타입 계약 동결**: `src/shared/ipc/channels.ts`(채널 상수 — `fs:*`·`shell:*`·`op:*`·`clipboard:*`·`session:*`·`settings:*`·`workspace:*` **전부**), `src/shared/ipc/contracts.ts`(위 모든 채널의 요청/응답·이벤트 타입 shape를 동결), `src/shared/dto/`(FileEntryDTO·DriveDTO·세션/설정 스냅샷 DTO 등), `Result<T,FileOpError>` 판별유니온·`FileOpError` 코드(EEXIST/EINVAL/EACCES/ENOENT 등). **미구현 채널은 contracts.ts에 타입만 두고 핸들러는 명시 stub/주석(`// impl: P4` 등)으로 계약만 고정** → frontend가 모킹 위에서 P2/P4/P5 UI를 병렬 선행 가능.<br>**(b) 핸들러 구현(P1 범위 = `fs:*` 읽기 계열만)**: `src/main/ipc/fs.handlers.ts`(`fs:list`/`fs:stat`/`fs:drives`/`fs:tree-children`/`fs:validate-path` + 스트리밍 `fs:list:start/chunk/done/error/cancel`), `src/main/ipc/guard.ts`(senderFrame 검증·경로 정규화·zod 스키마), `src/main/fs/`(FileSystemService: 스트리밍 읽기·롱패스·링크·네트워크 예외). **`shell:*`/`op:*`/`clipboard:*`/`session:*`/`settings:*`/`workspace:*` 핸들러 실구현은 각 해당 Phase(P2/P4/P5/P6)에서 수행.**<br>`src/preload/api.ts`(채널별 래퍼 1메서드 + 1차 검증·이벤트 구독), `src/renderer/infra/api/`(window.api 래핑 + IPC 이벤트→스토어 브리지) |
| **의존** | P0 |
| **담당** | **backend**(Main 핸들러·FileSystemService·guard) + **frontend**(infra/api 어댑터·preload 래퍼 검토). **첫 작업 = 양측이 `shared/ipc` 계약 공동 합의·동결** |
| **완료 기준(DoD)** | ☑ `shared/ipc` 타입이 동결되고 main/preload/renderer가 동일 타입 import(타입체크 0 에러)<br>☑ **contracts.ts에 전 채널(`fs:*`·`shell:*`·`op:*`·`clipboard:*`·`session:*`·`settings:*`·`workspace:*`)의 요청/응답·이벤트 타입이 모두 존재. 미구현 채널은 핸들러 stub/주석으로 계약만 고정(타입체크 0 에러)**<br>☑ **frontend가 미구현 채널을 infra/api 모킹으로 호출해도 타입 계약과 일치(병렬 선행 가능성 검증)**<br>☑ `fs:list`/`fs:stat`/`fs:drives`/`fs:tree-children`/`fs:validate-path`가 실제 경로에 대해 `Result` 반환(P1 구현 범위)<br>☑ 대형 폴더(1만 항목)가 `fs:list:start`→`chunk`(증분)→`done` 스트림으로 전달되고 `cancel` 동작<br>☑ 권한 거부/미존재 경로가 throw 아닌 `FileOpError(code)`로 1급 전파<br>☑ guard가 `..` 상위이탈·시스템 보호경로 정규화·차단, senderFrame 검증 동작<br>☑ infra/api 통해 호출 시 이벤트 스트림이 스토어 액션으로 브리지됨(콘솔/테스트 확인) |
| **QA 검증 포인트** | 계약 경계면 교차 검증(요청/응답 shape이 contracts.ts와 일치), 스트림 청크 순서·done total 정확성, 취소 후 추가 청크 유입 없음, 오류코드 매핑(EACCES/ENOENT) 실측, 롱패스/유니코드/링크/네트워크 드라이브 케이스 |
| **추적성** | US-5.6(스트리밍 첫 렌더), US-3.1(경로검증), US-3.2(드라이브·트리), F장(Windows 특수케이스), SA §3~4, SW §3.1~3.2, ADR-003(IPC 계약) |

---

### P2 — 단일 패널 파일목록 UI(가상 스크롤·보기/정렬·주소창·탐색·트리)  ✅ 완료

| 항목 | 내용 |
|---|---|
| **목표** | 한 개 패널에서 폴더를 열고, 가상 스크롤로 목록을 보고, 정렬/보기 전환·다중 선택·주소창/뒤·앞·위 탐색·트리 사이드바 이동이 된다. **항목 활성화(더블클릭/`Enter`)로 폴더는 진입, 파일은 OS 연결 프로그램으로 실행**한다(아직 탭/분할 없음, 파일 작업(CRUD/속성창)은 없음). |
| **산출물(모듈·파일)** | `src/renderer/app/stores/`(panelsSlice: path·navHistory·view·directoryView / selectionSlice), `src/renderer/domain/rules/`(자연정렬·폴더우선), `src/renderer/domain/paths/`, `src/renderer/domain/entities/`; `ui/panel/`(Panel 셸·PanelHeader), `ui/panel/views/FileListView`(가상 스크롤 list/details·인라인 편집 자리·더블클릭/`Enter` 활성화 핸들러), `ui/toolbar/`(주소표시줄 브레드크럼/편집·뒤/앞/위·보기·정렬 컨트롤), `ui/sidebar/`(트리·드라이브·내 PC, `fs:tree-children` 지연확장), `app/usecases/`(폴더진입·nav·view·selection·**open**(항목 활성화: 폴더=진입/파일=`shell:open` 위임)); **`shell.handlers.ts`(`shell:open` 핸들러 — 경로 정규화·존재·권한 검증 후 `shell.openPath` 위임. ADR-005)** |
| **의존** | P1 |
| **담당** | **frontend**(단일 패널 UI·open usecase 전담) + **backend**(`shell:open` 핸들러·경로 검증 가드). backend는 P1 `fs:*` 안정화 지원, P4 계약 사전 검토 |
| **완료 기준(DoD)** | ☑ 폴더 진입 시 스트림 첫 청크 도착 즉시 첫 화면 렌더(스피너 해제), 1만 항목에서 가상 스크롤 DOM 노드 수십 개 유지<br>☑ details/list 보기 전환, 컬럼 클릭 정렬(이름/크기/형식/수정일·오름/내림), 자연정렬·폴더우선 토글 동작·패널별 기억<br>☑ 브레드크럼 클릭·`Ctrl+L` 경로입력·잘못된 경로 인라인 오류, `Alt+←/→/↑`·`Backspace` 탐색<br>☑ 트리 펼침/접힘·클릭 시 패널 경로 변경, 사이드바 토글/폭조절<br>☑ `Ctrl/Shift/박스/Ctrl+A` 다중 선택, 선택이 셀렉터로 격리 리렌더(다른 영역 비리렌더)<br>☑ **폴더 항목을 더블클릭 또는 `Enter`로 활성화 시 그 폴더로 진입(navHistory 적재)**<br>☑ **파일 항목을 더블클릭 또는 `Enter`로 활성화 시 `shell:open`을 통해 OS 연결 프로그램으로 실행(반환 코드 확인, 미연결 형식은 OS 기본 동작 위임)**<br>☑ **`shell:open` 핸들러가 (a) 경로 정규화(`..` 상위이탈 차단)·(b) 대상 존재·(c) 접근 권한을 모두 통과한 경로만 `shell.openPath`에 위임. 검증 실패 시 실행 없이 `FileOpError`(ENOENT/EACCES/EINVAL) 반환 — 임의/조작 경로 실행 차단(ADR-005)**<br>☑ 권한거부/빈/네트워크 폴더가 패널 단위 오류/빈 상태로 격리 표시<br>☑ 타입체크·린트 0 에러 |
| **QA 검증 포인트** | (SPK-Perf 연계) 1만 항목 첫 렌더 1.5초 측정, 스크롤 시 가시영역만 재계산, 정렬/필터 정확성, 셀렉터 리렌더 격리(다른 패널/선택 변경에 비리렌더), DirectoryView 상태머신(idle→loading→streaming→ready/error/empty/denied) 전이; **항목 활성화 진리표(폴더=진입/파일=실행), `shell:open` 보안 검증 교차(미존재 경로·`..` 이탈 경로·권한밖 경로 주입 시 실행 차단·FileOpError 반환 실측), 실행 실패(미연결 형식) 폴백 안내** |
| **추적성** | US-2.1(보기/정렬), US-3.1(주소표시줄/이동), US-3.2(트리), US-5.1(다중선택 일부), US-5.6(가상스크롤 첫렌더), **US-2.2/B6(파일 실행·열기: 더블클릭/`Enter`)**, feat-B1/B2/B6/C1~C3, SW §4·§6, SA §3.2·§3.3-4, ADR-004(가상화), ADR-002(상태), **ADR-005(shell 실행 검증)** |

---

### P3 — 탭 + 2분할 레이아웃 + 패널 포커스 + 단축키 디스패치  ✅ 완료

| 항목 | 내용 |
|---|---|
| **목표** | 탭(추가/닫기/전환/이동/복제/닫은탭복원)과 2분할(좌우/상하) 레이아웃, 활성 패널 포커스, 중앙 단축키 디스패치가 동작한다. 핵심 차별점의 골격. |
| **산출물(모듈·파일)** | `app/stores/tabsSlice`(windows·tabs·layout·activeTab/activePanel·closedHistory), `app/usecases/`(탭열기/복제/복원·분할토글·패널포커스이동); `ui/tabbar/`(탭바·드래그 순서), `ui/layout/LayoutHost`(single/split-2-h/split-2-v 배치·분할선·최소폭); `ui/keyboard/`(KeyBindingRegistry·Dispatcher·CommandBus·컨텍스트 스코프), `src/renderer/domain/keybindings/`(PRD §8 표 단일 출처: 키→commandId) |
| **의존** | P2 |
| **담당** | **frontend**(전담) |
| **완료 기준(DoD)** | ☑ `Ctrl+T/W/Tab/1~9`·가운데클릭·드래그순서·`Ctrl+D` 복제·`Ctrl+Shift+T` 복원, 마지막 탭 닫으면 "내 PC" 기본 탭 유지<br>☑ 각 탭 독립(경로·정렬·보기·히스토리), 분할 구성 탭별 독립<br>☑ `Ctrl+\` 2분할 토글, 각 패널 독립 상태, 활성 패널 시각 구분<br>☑ `Tab`=패널 포커스 순환, `Ctrl+←/→`=방향 포커스(별개 commandId)<br>☑ KeyBindingRegistry가 동일 컨텍스트 중복 매핑을 부팅 시 assert, 컨텍스트 스코프(주소창/검색/이름편집/다이얼로그)에서 텍스트 입력 우선·전역 단축키 차단<br>☑ 단축키 목록을 **읽을 수 있도록 KeyBindingRegistry가 (키→commandId→표시명) 목록을 노출**(레지스트리 읽기 API). **실제 표시 호스트인 설정 화면 단축키 섹션은 P5a에서 제공** — P3에서는 레지스트리 노출까지만 완료(또는 임시 도움말 패널로 확인) |
| **QA 검증 포인트** | 단축키 충돌 부재(특히 Tab/F5/F6/Ctrl+R 고유성), 컨텍스트 스코프 전환 정확성, closedHistory 휘발(세션 비직렬화) 확인, 2분할에서 패널별 셀렉터 리렌더 격리, 탭 N개에서 활성 패널 정확히 하나 불변식 |
| **추적성** | US-1.1(탭), US-1.2(2분할), US-5.4(키보드), 결정-D4(단축키 충돌), feat-A1/A2/E1, SW §2·§5·§7, ADR-002 |

---

### P4 — 파일 작업(CRUD·휴지통) + 진행률/취소 + 충돌해결 + 패널 간 D&D  ✅ 완료

> **드리프트 해소(2026-06-07)**: 본 P4 산출물 중 `ui/contextmenu/`(컨텍스트 메뉴)와 DoD "컨텍스트 메뉴 '속성'→`shell:show-properties`"는 P4 당시 backend 핸들러(`shell:show-properties`)만 있고 **호출 UI가 누락**된 채 ✅로 표기돼 있었다. 컨텍스트 메뉴 인프라가 P6 시점에 뒤늦게 구현되어 이제 충족됨(§0.5 P6 표·드리프트 주석 참조).

| 항목 | 내용 |
|---|---|
| **목표** | 생성·이름변경·복사·잘라내기·붙여넣기·삭제(휴지통/영구)가 되고, 대용량 복사/이동이 Worker에서 비차단 실행되며 진행률(200ms)·취소·충돌해결이 동작한다. 패널 간 D&D 및 F5/F6로 이동/복사한다. **핵심 차별점 완성.** |
| **산출물(모듈·파일)** | (backend) `src/main/ipc/op.handlers.ts`(`op:start/progress/conflict/resolve/done/cancel`), `fs.handlers.ts`에 `fs:mkdir`/`fs:create-file`/`fs:rename` 추가, `src/main/operations/`(OperationManager·작업큐·AbortController·200ms 스로틀), `src/main/workers/`(재귀 복사/이동/삭제·사전집계·청크 진행보고·충돌질의), `src/main/os/`(휴지통 `shell.trashItem`·`dialog:confirm-permanent-delete`), `shell.handlers.ts`에 **`shell:show-properties`(OS 속성창 호출 `shell.showItemInFolder`/네이티브 속성 다이얼로그)·`clipboard:*` 추가**(`shell:open`은 P2에서 구현됨, `shell:open-with`(연결 프로그램 선택)는 Should → P6); `ui/contextmenu/`(컨텍스트 메뉴: 열기·속성·복사/잘라내기/삭제); (frontend) `app/stores/operationsSlice`, `app/usecases/`(파일CRUD·복사이동·D&D·붙여넣기), `domain/rules/`(충돌명명 "이름 (n)"/"복사본"·`resolveDragIntent`·순환이동 차단·동일폴더 무시), `ui/dialogs/`(ProgressDialog·ConflictDialog·ConfirmDialog), `ui/dnd/`(드래그&드롭 핸들러) |
| **의존** | P3 (UI 통합 기준). **계약(`op:*`·`fs:mkdir/rename`)은 P1에서 합의** → backend Worker/OperationManager는 P2~P3 중 병행 가능. **SPK-Worker 선결 필요.** |
| **담당** | **backend**(OperationManager·Worker·휴지통·op/fs 핸들러) + **frontend**(다이얼로그·dnd·usecase·operationsSlice). `op:*` 계약 경계로 병렬 |
| **완료 기준(DoD)** | ☑ `Ctrl+Shift+N` 새 폴더(즉시 이름편집)·새 파일·`F2` 이름변경, 금지문자/예약명/중복명 → EINVAL/EEXIST 안내<br>☑ `Ctrl+C/X/V` OS 클립보드 호환, 잘라내기 항목 흐림·붙여넣기 전 원본 유지, 같은 폴더 "복사본" 자동명명<br>☑ `Delete` 휴지통 이동(되돌리기 가능)·`Shift+Delete` Main 모달 확인 후 영구삭제<br>☑ 대용량 복사/이동이 Worker에서 실행되어 **작업 중 다른 탭/패널 조작이 멈추지 않음**(UI 비차단)<br>☑ 진행률(현재 파일명·전체%·남은 항목/용량)이 **200ms 이내 간격** 갱신, 취소 시 진행분 처리 후 summary, 부분실패 목록 보고<br>☑ 충돌 시 임의 덮어쓰기 없음, 덮어쓰기/건너뛰기/둘다유지("이름 (n)")/폴더 병합/모두적용, 읽기전용·사용중 처리, 크기·수정일 비교 표시<br>☑ 패널 간 D&D: 같은드라이브=이동/다른드라이브=복사 기본, Ctrl=복사·Shift=이동 강제, 폴더 위 드롭=그 폴더 안, 동일폴더 무시, 조상→자손 차단·안내<br>☑ **D&D 중 드롭 가능 대상(패널 빈 영역·폴더 항목)이 시각적으로 하이라이트되고, 현재 의도(복사/이동)가 커서·툴팁으로 상시 표시(수정키 변경 시 즉시 반영) — 드롭 불가 영역은 비하이라이트(US-1.3)**<br>☑ **컨텍스트 메뉴 "속성"이 `shell:show-properties`로 선택 항목의 OS 속성창을 호출(다중 선택 시 규칙대로 처리)**<br>☑ `F5`=복사/`F6`=이동이 D&D와 동일 `op:start` 경로로 동작 |
| **QA 검증 포인트** | 200ms 진행률 갱신 실측, 취소 지연·진행분 정합, 충돌 매트릭스(파일/폴더/읽기전용/사용중/권한) 교차, FileOperation 상태머신(pending→running→conflict→running→done/partial-failed/cancelling) 전이, 휴지통 이동/복원 실측, 순환이동·동일폴더·자기위치 선검증, D&D 의도 판정(드라이브×수정키) 진리표, **D&D 드롭 대상 하이라이트·커서/툴팁 의도 표시 시각 검증(수정키 변경 즉시 반영)**, **`shell:show-properties` 속성창 호출 실측**, op:* 계약 경계 교차 검증 |
| **추적성** | US-1.3(D&D·F5/F6·**드롭 하이라이트·커서/툴팁 피드백**), US-2.2(생성/이름변경/삭제), US-2.3(클립보드), US-2.4(충돌), US-5.1(일괄), US-5.2(진행률/취소), **B6(속성창=`shell:show-properties`)**, feat-A3/B3/B4/B5/B6/feat-D4, SA §4, SW §8, ADR-003/005 |

---

### P5 — 검색/필터 + 즐겨찾기/최근 + 설정 화면(숨김·확장자 토글) + 자동 세션복원 + 다크모드 + 상태바  → **MVP 완성**  ✅ 완료

> **트랙 분리(병렬 착수)**: **P5a**(검색/필터·테마·상태바·**설정 화면** — 의존 **P2**) / **P5b**(세션복원·즐겨찾기·최근 영속 — 의존 **P3·P4**). P5a는 P4 완료를 기다리지 않고 P2 위에서 선행 착수 가능. 설정 화면 골격은 P3 DoD("단축키 목록을 설정에서 표시")의 의존 대상이므로 P5a에서 우선 제공한다.

| 항목 | 내용 |
|---|---|
| **목표** | 현재 폴더 검색(200ms)·확장자/이름 필터, **설정 화면(테마·기본 시작 위치·숨김 파일 표시·확장자 표시·최근 개수·단축키 보기)과 숨김/확장자 표시 토글의 목록 즉시 반영**, 즐겨찾기·최근, 정상·비정상 종료 후 자동 세션복원, 다크/라이트/시스템 테마, 상태바가 동작한다. **Must 전체 완성 = MVP.** |
| **산출물(모듈·파일)** | **(P5a, frontend) `ui/panel/SearchBar`**, `app/usecases/`(검색/필터), `domain/rules/`(필터/패턴매칭·하이라이트 순수함수), `panelsSlice.filter`, `ui/theme/`(다크/라이트/시스템), `ui/statusbar/`(항목수·선택개수/용량·활성경로·필터결과); **`ui/settings/`(설정 화면 — 테마·기본 시작 위치·숨김 파일 표시·확장자 표시·최근 개수·단축키 목록 보기), `app/usecases/settings`, `app/stores/uiSlice.settings`(theme·startLocation·recentLimit) + `panelsSlice`(또는 `uiSlice`)에 `showHidden`·`showExtensions` 상태 추가, FileListView가 `showExtensions`로 확장자 표시 토글, 폴더 진입 시 `fs:list(showHidden)` 파라미터를 설정값으로 전달(사용자 제어 경로 연결)**.<br>**(P5b, frontend) `app/usecases/`(즐겨찾기·최근·세션복원), `app/stores/sidebarSlice`(favorites·recent), `ui/sidebar/`(즐겨찾기·최근 섹션)**; (backend) `src/main/ipc/session.handlers.ts`(`session:load/save`·`settings:get/set` 핸들러 실구현), `src/main/persistence/`(session.json/settings.json 원자적 쓰기·디바운스·스키마 버전·손상 폴백); App 부트스트랩 세션복원 |
| **의존** | **P5a**: P2(패널 목록·`fs:list`). **P5b**: P3(탭/레이아웃 스냅샷)·P4(작업 후 상태). (계약 `session:*`·`settings:*`은 P1에서 동결) |
| **담당** | **frontend**(검색/필터·설정 화면·숨김·확장자 토글·즐겨찾기·테마·상태바·복원 로직) + **backend**(persistence·session/settings 핸들러). 세션·설정 스냅샷 스키마는 `shared/dto`에 합의(P1 동결) |
| **완료 기준(DoD)** | ☑ `Ctrl+F` 검색창, 입력 후 **200ms 이내** 점증 필터·하이라이트, 해제 시 전체 복귀(SPK-Perf 폴백 적용)<br>☑ `*.png`/`report*` 패턴 필터, 결과 개수 상태바 반영<br>☑ **설정 화면에서 테마·기본 시작 위치·숨김 파일 표시·확장자 표시·최근 개수를 변경하면 `settings:set` 통해 settings.json에 영속, 재시작 후 유지**<br>☑ **숨김 파일 표시 토글 변경 시 `fs:list(showHidden=true/false)`로 재요청되어 패널 목록에 숨김/시스템 파일이 즉시 포함/제외(기본 off)**<br>☑ **확장자 표시 토글 변경 시 FileListView 이름 표기에 확장자 즉시 표시/숨김(기본 on)**<br>☑ **설정 화면 단축키 섹션이 KeyBindingRegistry를 읽어 PRD §8 단축키 목록을 표시(P3 DoD "설정에서 단축키 표시"의 실제 호스트)**<br>☑ 폴더 즐겨찾기 추가/제거·사이드바 고정, 최근 자동기록·개별/전체 삭제·**최근 개수가 설정값(recentLimit) 따름**<br>☑ 정상 재시작 시 마지막 탭/경로/레이아웃 복원, **비정상 종료(크래시) 후에도 복원**(원자적 쓰기), 패널 정렬/보기 복원<br>☑ closedHistory·선택·진행작업은 복원 제외(휘발) 확인<br>☑ 손상/구버전 스냅샷 → 안전 폴백("내 PC" 탭) 부팅(크래시 프리)<br>☑ 라이트/다크/시스템 테마 즉시 적용<br>☑ 상태바: 전체 항목수·선택개수/합계용량·활성경로·필터결과 갱신 |
| **QA 검증 포인트** | (SPK-Perf) 1만 항목 검색 입력 200ms 실측, 디바운스 트랜지션 블로킹 부재; **설정 변경→settings.json 영속→재시작 유지 실측, 숨김 토글 on/off 시 목록 항목 수 변화(`fs:list` showHidden 연동) 실측, 확장자 토글 표기 변화, 설정 단축키 목록과 PRD §8 일치**; 세션 디바운스 저장+before-quit 플러시, 크래시(강제종료) 후 복원, 원자적 쓰기(쓰기 중 종료 시 파일 무손상), 스키마 마이그레이션·손상 폴백, 테마 대비 WCAG AA 지향 |
| **추적성** | US-4.1(검색), US-4.2(필터), US-3.3(즐겨찾기/최근), US-5.3(테마), US-5.5(세션복원), US-5.7(상태바), **feat-E6(설정), F장(숨김/시스템 파일 표시 토글·확장자 표시 토글)**, 결정-D3(세션), feat-D1/D2/C4/C5/E2/E5, **settings:get/set·session:save/load**, SA §5, SW §5.3·§6.3 |

---

### P6 — (Should) 4분할 · 미리보기 패널 · 워크스페이스 저장 · 텔레메트리(옵트인) · 연결프로그램으로 열기  ✅ 완료(5종) · 🔜 Should 잔여(그리드/썸네일·되돌리기)

| 항목 | 내용 |
|---|---|
| **목표** | MVP 안정화 후 Should 기능: 4분할(2x2), 미리보기 패널(이미지/텍스트/메타), 명시적 워크스페이스 저장/복원, 텔레메트리 옵트인. |
| **산출물(모듈·파일)** | ✅ `ui/layout/LayoutHost`(grid-4·포커스 순환 확장), `domain` 포커스 순환 규칙; ✅ `ui/preview/PreviewPanel`+형식별 렌더러(`renderers/*`), `uiSlice.previewOpen`, **신규 `preview:read` 채널**(`FileSystemService.readPreview`·`preview.handlers.ts`); ✅ `src/main/persistence/WorkspaceStore.ts`·`workspace:save/list/load/delete`, 워크스페이스 UI(`WorkspaceDialog`); ✅ `telemetry:get/set-opt-in`(기본 false)·옵트인 시에만 익명 집계·`.eslintrc.cjs` 네트워크 정적 가드; ✅ **`shell:open-with`(연결 프로그램으로 열기, features §B6 Should): `os/shell.ts#openWith`(OpenAs_RunDLL)·`shell.handlers.ts`(3중 검증)·`guard.ts#zShellOpenWithReq`·`usecases/open.ts#openWithEntry`·컨텍스트 메뉴 항목**; ✅ **컨텍스트 메뉴(우클릭) 인프라(`ui/contextmenu/`·`usecases/contextMenu.ts`·`uiSlice.contextMenu`) — P4 산출물이 뒤늦게 구현돼 P4 드리프트 해소(속성→`shell:show-properties` 호출 UI 포함)**. **🔜 미구현 잔여: 그리드/썸네일 보기·되돌리기(Ctrl+Z)** |
| **의존** | P5(MVP 완성·스냅샷 구조·LayoutHost·uiSlice 재사용) |
| **담당** | backend+frontend(변화 격리 경계 내 확장: `ui/panel/views/*`·`ui/preview/renderers/*`·`workspace:*` 채널) |
| **완료 기준(DoD)** | ☑ 2x2 4분할·4패널 독립 상태·포커스 순환(`panel.focusNext`)과 방향이동 구분<br>☑ 이미지 축소·텍스트 앞부분·기본 메타·미지원 형식 아이콘 미리보기, `Ctrl+P` 토글<br>☑ 워크스페이스 이름저장/불러오기(탭·패널·경로 복원)/이름변경/삭제<br>☑ 텔레메트리 기본 꺼짐, 동의 시에만 외부 전송·미동의 시 전송 전무 |
| **QA 검증 포인트** | 4분할 포커스 순환 vs 방향이동 차이, 미리보기 형식별 렌더·대용량/미지원 폴백, 워크스페이스 스냅샷 재사용 정합, 텔레메트리 옵트인 네트워크 차단 검증 |
| **추적성** | US-1.4(4분할), US-4.3(미리보기), US-5.8(워크스페이스), 결정-D1/D2/D5, feat-D3, SW §9(변화 격리), SA §5.2 |

---

### P7 — 안정화 · 성능검증 · 접근성 · 패키징(1차 릴리스 준비)  🟡 부분(패키징·아이콘 완료)

| 항목 | 내용 |
|---|---|
| **목표** | PRD 성능/안정/접근성 목표를 실측 검증하고, 인스톨러·QA 매트릭스를 완비해 1차 릴리스(M4) 준비. |
| **산출물(모듈·파일)** | 성능 검증 하니스(1.5초/200ms), 접근성 보강(ARIA 행 레이블·포커스 트랩), QA 매트릭스(F장 Windows 특수케이스), `electron-builder.yml` 코드서명·sourcemap 분리, `tests/`(도메인 단위·IPC 통합·e2e) |
| **의존** | P5(+P6 일부) |
| **담당** | 전원(qa 주도 검증, devops 패키징, backend/frontend 결함 수정) |
| **완료 기준(DoD)** | ☑ 1만 항목 첫 렌더 1.5초·진행률 200ms·검색 200ms 실측 충족(미달 시 폴백 적용 후 재측정)<br>☑ 크래시 프리 세션 99.5% 지향(세션복원·원자적 저장 검증)<br>☑ 핵심 동작 전부 키보드 접근·포커스 표시·WCAG AA 대비 지향<br>☑ NSIS 인스톨러(코드서명) 설치/실행/제거 검증<br>☑ F장 매트릭스(롱패스/링크/네트워크/권한) 통과 |
| **QA 검증 포인트** | 성능 3종 실측, 회귀 스위트, Windows 특수케이스, 보안(네트워크 차단·CSP·senderFrame) 최종 점검 |
| **추적성** | PRD §3·§7(성능·안정·접근성·보안), §12 M4, traceability §3 |

---

## 4. 역할 분담 & 병렬화 가이드

| Phase | devops | backend (Main) | frontend (Renderer) | qa |
|---|---|---|---|---|
| P0 | **골격·빌드·패키징·CSP·보안옵션** | — | React/Zustand 부트 합류 | 빌드 스모크·보안옵션 |
| P1 | CI 빌드 게이트 | **fs:* 핸들러·FileSystemService·guard** | **infra/api·preload 검토**, 계약 공동합의 | 계약 경계·스트림·오류코드 |
| P2 | — | **`shell:open` 핸들러·경로검증 가드** + fs:* 안정화 지원 | **단일 패널 UI(+open usecase·파일 실행/`Enter`) 전담** | 첫렌더 성능·리렌더 격리·상태머신·**shell:open 보안 검증** |
| P3 | — | (P4 계약 사전검토) | **탭·2분할·단축키(+레지스트리 노출) 전담** | 단축키 충돌·컨텍스트·불변식 |
| P4 | — | **OperationManager·Worker·휴지통·op/fs 핸들러·`shell:show-properties`** | **다이얼로그·dnd(+하이라이트/커서피드백)·컨텍스트메뉴·usecase·operationsSlice** | 200ms·충돌매트릭스·D&D 진리표·하이라이트·상태머신 |
| P5 | — | **persistence·session/settings 핸들러** | **P5a: 검색/필터·테마·상태바·설정화면(숨김/확장자 토글) / P5b: 즐겨찾기·최근·복원** | 검색200ms·설정영속·숨김토글 연동·크래시복원·원자적쓰기 |
| P6 | — | workspace:*·telemetry·썸네일 | 4분할·미리보기·워크스페이스 UI | 옵트인 차단·미리보기 폴백 |
| P7 | **코드서명·인스톨러** | 결함 수정 | 접근성·결함 수정 | **성능 3종·F장 매트릭스·보안 최종** |

**병렬화 규칙**
1. **계약 우선(Interface First)**: P1에서 **전 채널(`fs:*`·`shell:*`·`op:*`·`clipboard:*`·`session:*`·`settings:*`·`workspace:*`)의 타입 계약**(`shared/ipc`·`shared/dto`)을 동결하는 것이 모든 병렬 작업의 선행 조건. **핸들러 구현은 P1=`fs:*` 읽기 계열만, 나머지는 각 해당 Phase(`shell:open`=P2 / `op:*`·`shell:show-properties`·`clipboard:*`=P4 / `session:*`·`settings:*`=P5 / `workspace:*`=P6)**. 타입이 P1에 동결되므로 frontend는 infra/api 모킹 위에서 UI를, backend는 실제 핸들러를 Phase별로 병렬 구현.
2. **작은 단위 배정**: 한 사람에게 한 번에 한 모듈 경계(예: backend는 OperationManager만, frontend는 ConflictDialog만)를 준다.
3. **즉시 통합**: 모듈 완성 즉시 `op:*`/`fs:*` 경계에서 통합·교차 비교해 타입·shape·계약 위반을 조기 발견.
4. **블로커 에스컬레이션**: SPK-Worker(P4 선결)·SPK-Perf(P5 선결) 결론 지연, 설계 모순, 범위 변경은 PM에 보고.

---

## 5. 단계 게이트(이중 검증 루프)

각 Phase는 다음 게이트를 통과해야 다음으로 넘어간다(최대 2회 재검증, 실패 시 PM 에스컬레이션):

1. **세부 계획**(파일·함수·인터페이스 구체화) → **reviewer 계획 검증**(설계 정합·실행가능성) → 반영
2. **구현** → **qa 구현 검증**(계획대로 됐는지·경계면 교차·수용기준) → 반영 → 통과 시 다음 Phase

**Phase별 핵심 게이트 한 줄**
- P0: 빈 창 dev/prod 실행 + 보안옵션 + 인스톨러 생성
- P1: `shared/ipc` **전 채널 타입 동결** + 스트림/오류코드 교차검증
- P2: 1만 항목 첫 렌더 + 리렌더 격리 + **파일 더블클릭/`Enter` 실행(shell:open 보안 검증)**
- P3: 단축키 충돌 부재 + 탭/분할 불변식 + 단축키 레지스트리 노출
- P4: 200ms 진행률 + 충돌매트릭스 + D&D 의도 진리표 + **드롭 하이라이트·속성창**
- P5: 검색 200ms + **설정 화면(숨김/확장자 토글 즉시 반영·영속)** + 크래시 후 세션복원 (→ MVP 완성)
- P6: Should 기능 (변화 격리 경계 내)
- P7: 성능 3종 실측 + 릴리스 패키징
