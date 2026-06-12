# 기능 명세 — 멀티 디렉토리 파일탐색기 (AGT-Finder · 코드네임 Explorer)

> 관련: [PRD.md](./PRD.md) · [user-stories.md](./user-stories.md) · [flows.md](./flows.md) · [roadmap.md](./roadmap.md)
> 본 문서는 영역별 **기능과 동작 규칙**을 정의한다. 구현 방식은 다루지 않는다.
> 우선순위 표기: **M**=Must(MVP) · **S**=Should · **C**=Could · **W**=Won't
> 용어는 [PRD.md 5-1 용어 사전](./PRD.md#5-1-용어-사전-표준어--전-문서-공통)을 따른다(주소 표시줄/분할 패널/패널/상태바 등).
> 단축키는 [PRD.md 8장 단축키 표](./PRD.md#8-단축키-체계-확정--충돌-없음)가 단일 출처다.
>
> **[2026-06-07 구현 상태]** **M(Must) 표기 기능은 전부 구현 완료(MVP).** Should는 P6에서 5종 구현 완료 ✅ — 4분할(D2: `grid-4` 2x2), 미리보기 패널(D3: `preview:read`·`Ctrl+P`), 명시적 워크스페이스 저장/복원(E·`workspace:*`·[2026-06-11 설정>워크스페이스 페이지 통합·`WorkspacePanel`+`SettingsDialog#WorkspaceCategory`·독립 `WorkspaceDialog` 폐지·진입=`openSettings('workspace')`]), 텔레메트리 옵트인(기본 꺼짐·외부 전송 전무·네트워크 정적 가드), **연결 프로그램으로 열기(B6 `shell:open-with` — `os/shell.ts#openWith`·OpenAs_RunDLL·컨텍스트 메뉴 항목)**.
> 또한 **컨텍스트 메뉴(우클릭) 인프라가 구현 완료** ✅(`ui/contextmenu/`·열기·연결프로그램·복사/잘라내기/이름바꾸기·삭제(휴지통)/영구삭제·속성→`shell:show-properties`·빈영역 붙여넣기/새폴더/새로고침) — 직전까지 P4 산출물로만 표기됐던 컨텍스트 메뉴가 실제로 누락돼 있던 드리프트가 해소됨(상세 [roadmap.md §0.5](./roadmap.md)).
> **되돌리기(B7·K1 `Ctrl+Z` 다단계 undo)·휴지통 관리 화면(B5·K2)은 §K로, 그리드 보기 이미지 썸네일 자체 생성(B1·feat-L1 §L)은 §L로 구현 완료 ✅**(아래 §K·§L). **§K·§L 완료 시점(2026-06-07) 기준으로 사용자 기능 Should/C/W 잔여(🔜)는 0이었다** — 보기 5종 J3 ✅ + 이미지 내용 썸네일 L1 ✅. **2026-06-08 §M(외부 연계) 신규 3기능(M1·M2 Should·M3 Could, US-12.1~12.5)이 기획 편입(🔜)됐다가 같은 날 MP0~MP5로 구현 완료·통합 QA PASS(✅)됨 → **§M 완료 시점(2026-06-08) 기준 사용자 기능 잔여(🔜)는 0이었다.** 같은 날 §N(즐겨찾기 UX 향상) 신규 2건(N1·N2 Should, US-13.1~13.2)도 기획 편입(🔜)됐다가 **같은 날 구현 완료·통합 QA PASS(✅)됨 → §N 완료 시점(2026-06-08) 기준 사용자 기능 잔여(🔜)는 0이다.** 그 외 남은 것은 P7 릴리스 실측·코드서명 등 릴리스 안정화 잔여(🟡)와 §M·§N 실 동작 런타임 스모크(🟡)이다. 상세 현황은 [roadmap.md §0.5·§3-M](./roadmap.md).
> **G장(패키징/릴리스/개발 도구)** 은 로드맵 외로 진행됐던 추가물(앱 아이콘·원클릭 빌드·가상 스크롤 결함 수정)을 **사후 정식 편입**한 영역으로, 모두 ✅ 구현 완료.
> **[2026-06-07 P7 릴리스 안정화 — 헤드리스분 ✅ / 런타임 잔여 🟡]** 접근성(포커스 트랩·모달 6종 ARIA/Esc·행 ARIA·`:focus-visible`·Shift+F10)·WCAG AA 대비(4팔레트 전수)·성능 측정 불변식(`verify:perf`)·F장 QA 매트릭스(`verify:fmatrix`)·npm audit 점검(릴리스 차단 아님)·sourcemap 분리·코드서명 설정(준비완료)은 헤드리스로 **✅ 충족**. **성능 실측 숫자·실제 코드서명(.pfx 인증서)·NSIS 설치/실행/제거 실측·F장 실케이스(실 네트워크/symlink/ACL)·실 스크린리더는 런타임 잔여 🟡 — P7 전체는 아직 🟡.** 상세 [roadmap.md §0.5·§3 P7](./roadmap.md).
> **H장(UX/레이아웃 확장, Should)** 신규 6기능 모두 ✅ 구현 완료 — 상단 전역 아이콘바(H1: `ui/toolbar/IconBar.tsx`·`iconBarItems.ts`, 4그룹 20버튼·activeWhen·`aria-pressed`·툴팁 단축키), 사이드바 온오프 토글(H2: `Ctrl+B`→`sidebar.toggle`→`toggleSidebar`), 분할 패널 크기조절(H3: `ui/layout/SplitDivider.tsx`·`splitMath.ts`·`tabsSlice.setSplitRatio`·`splitRatios` 세션 영속), **우클릭 "터미널 열기"(H4: 신규 채널 `shell:open-terminal`·`os/shell.ts#openTerminal` wt.exe→PowerShell 폴백·`contextMenu.ts`·ADR-005), 디렉토리 경로 직접 입력(H5: `PanelToolbar.tsx` 단일클릭 편집·`validateAndNavigate` 재사용), 파일 유형별 OS 아이콘(H6: 예약 채널 `shell:icon` 정식 구현·`os/icon.ts`·`iconCache.ts`·`OSIcon`·확장자 캐시 LRU512·iconRef 지연)**. US-7.2/7.3 마우스 드래그·H4 네이티브 `wt.exe`·H6 `app.getFileIcon`의 실제 네이티브 실행은 런타임 의존이라 런타임 스모크 권장(코드 정합 충족). 상세 [roadmap.md §0.5](./roadmap.md).
> **I장(분석·시각화 / 접근성 테마, Should) ✅ 구현 완료** — 2026-06-07 정식 편입·구현·QA PASS. 디렉토리 사용량 대시보드(I1 ✅: 드라이브 사용량 즉시 도넛+표·Top10 온디맨드 스캔[진행률·취소·비차단]·인사이트·실행 시 자동 팝업 토글 기본 켜짐·recharts 3.8.1 MIT·831kB lazy 청크 — **신규 채널 `analyze:scan:*` 5종**·`scanEngine.ts`·`ScanManager.ts`·`scanWorker.ts`·`DashboardModal.tsx`·`analyzeSlice.ts`), 블루라이트 차단 테마(I2 ✅: #FBF0D9 크림 배경 저청색광 테마·WCAG AA 통과[본문 11.04:1]·`BLUELIGHT_PALETTE`·`ThemeMode` 4종). US-8.1·8.2. **파일 유형별 비중 인사이트는 §K3(feat-K3)로 정식 구현 완료 ✅**(I1의 "(가능하면)" 선택항을 `categorize.ts`·`scanEngine.ts` byCategory 1패스·`CategoryBar.tsx`로 정식화). **네이티브 statfs·대용량 스캔 성능 실측은 런타임 스모크 권장.**
> **[2026-06-07 편입·구현 완료 ✅] J장(탐색기 보기·실시간 갱신/뷰어 확장, Should) 신규 7기능** — 사용자 요청 8건 중 신규 7건을 정식 편입·구현·QA PASS(team-dev). feat-J1 파일 드래그 박스 선택(러버밴드 ✅ `boxSelect.ts`·`selectionSlice.boxSelect`·`FileListView`)·**feat-J2 좌/우 패널 실시간 갱신(파일시스템 워처 ✅ — 신규 채널 `fs:watch:*`·`WatchService.ts`(UNC + 매핑 드라이브 eager + reactive 폴링)·`os/driveType.ts`(GetDriveType 연동)·`watchBridge.ts`·`panelsSlice`(softRefresh/보존); 정렬/필터·선택/스크롤 보존·UNC + 매핑 네트워크 드라이브 폴링 폴백 충족 ✅, `subst`·일부 클라우드 드라이브(`DriveType≠4`)만 미포함 한계)**·feat-J3 Windows 표준 "보기" 5종(✅ `ViewMode` icons-large/medium/small/list/details·그리드 OSIcon)·**feat-J4 브랜딩 변경 "AGT-Finder"(✅ appId `com.agtfinder.app`)**·feat-J5 미리보기 2단 뷰어(✅ `PreviewInfoCard`+`CodePreview`(highlight.js)·`MarkdownPreview`(marked+DOMPurify))·feat-J6 미리보기 패널 폭 조절(✅ SplitDivider 재사용·`ui.previewWidth`)·feat-J7 즐겨찾기 별칭 변경(✅ `SidebarSnapshot.favoriteLabels`·인라인 편집). US-9.1~9.7. **나머지 1건(F5/F6 복사·이동 제거)은 §J가 아니라 §A3·§E1의 기존 절을 "삭제됨/Deprecated"로 정정**(아래·코드 반영 완료). 신규 의존성 highlight.js(BSD-3)·marked(MIT)·dompurify(MPL-2.0)는 lazy 청크 분리. 매핑 네트워크 드라이브 `GetDriveType` 연동(`os/driveType.ts`)은 신규 npm 의존성·신규 IPC 채널 0(PowerShell 시스템 내장). 워처/뷰어 네이티브 동작·박스선택 드래그는 런타임 스모크 권장(코드 정합·verify:watch 77·verify:store 76 충족). 상세 [roadmap.md §0.5 "신규 보기·실시간·뷰어·브랜딩(J장)"](./roadmap.md).
> **[2026-06-07 스코프 축소 — F5/F6 복사·이동 제거] 사용자 결정(2026-06-07)으로 "활성 패널 선택 항목을 다른 패널로 복사=`F5`/이동=`F6`" 단축키를 제거(Deprecated)한다.** 사유: "듀얼 패널 파일관리자 외 일반 사용자에게 일반적이지 않은 단축키." **D&D·클립보드(`Ctrl+C/X/V`) 복사/이동은 그대로 유지**한다. 정정 위치: 본 features §A3·§E1, PRD §8 단축키 표·§6 Must·결정 D4, user-stories US-1.3·US-5.4. 추적성(roadmap P4·traceability)은 코드 반영 후 doc-synchronizer가 정정한다.
> **[2026-06-07 편입·구현 완료 ✅ — K장(되돌리기·휴지통 관리·유형별 비중, Should) 신규 3기능]** roadmap §0.5 "P6 미구현 잔여 🔜"로 남아 있던 **Should 잔여 3건**을 정식 편입·구현·QA PASS(team-dev). feat-K1 되돌리기(✅ `Ctrl+Z` 다단계 undo 스택 — `undoSlice.ts`(cap 50·판별유니온)·`undo.ts`(역연산 rename↔rename·create→휴지통·move→역move·copy→사본휴지통·trash→`trashApi.restore`·**영구삭제 미push**·충돌 선검증)·`commandBus`의 `notYet`→`performUndo`; 기존 P6 잔여 "되돌리기"의 정식 구현)·feat-K2 휴지통 관리 화면(✅ 복원/비우기 — **신규 채널 `trash:*` 3종**·`os/recycleBin.ts`(PowerShell Shell COM·`$Recycle.Bin` 화이트리스트·Move-Item 폴백)·`trash.handlers.ts`(sender·zod·화이트리스트·`confirmed` 게이트)·`ui/trash/TrashDialog.tsx`; 기존 P6 잔여 "휴지통 관리 화면"의 정식 구현)·feat-K3 파일 유형별 비중 인사이트(✅ `categorize.ts`·`scanEngine.ts` byCategory 1패스·`ScanResult.byCategory`·`CategoryBar.tsx`; **I1의 "(가능하면) 유형별 비중" 선택항을 정식 구현**). US-10.1~10.3. **모두 ✅ 구현 완료**(typecheck/lint 0·`verify:recyclebin` 37·`verify:store` 99·`verify:scan` 39·QA PASS). **정직 한계: copy-undo는 보수적(사본 경로 충돌 시 미생성·중단)·영구삭제 되돌릴 수 없음(토스트)·휴지통 COM 및 undo 역연산 실제 네이티브 동작은 런타임 스모크 권장.** 상세 §K·[roadmap.md §0.5](./roadmap.md).
> **[2026-06-08 편입·구현 완료·QA PASS ✅ — M장(외부 연계, US-12.1~12.5) 신규 3기능]** 2026-06-08 사용자 요청으로 기획 편입(🔜)됐다가 같은 날 ADR-007 설계·MP0~MP5 구현·통합 QA PASS → 상태 🔜→✅ 동기화. **M1 외부 D&D 복사(Should ✅ — 신규 채널 `dnd:start-drag`·`os/dragdrop.ts`·`usecases/externalDrag.ts`·`transferRoute.ts`·`verify:dnd` 29)·M2 클립보드 CF_HDROP 외부 연계(Should ✅ — 신규 채널 `clipboard:write/read/has-files`·`os/shellClipboard.ts`·`usecases/clipboardExternal.ts`·`verify:clipboard-hdrop` 33)·M3 FTP/SFTP 원격(Could ✅ — 신규 채널 `remote:*`·`remote/{RemoteService,SftpAdapter,FtpAdapter,RemoteSessionManager,remoteTransfer}.ts`·`os/credentials.ts`(safeStorage/DPAPI)·`RemoteProfileStore.ts`·`ui/remote/*`·신규 의존성 `ssh2-sftp-client`/`basic-ftp`[M3만·`src/main/remote/` 한정]·`verify:credentials` 17·`verify:remote` 23·`verify:remote-trust` 35·`verify:remote-route` 47·`verify:eslint-remote` 29).** 보안 필수 수용기준 충족: 자격증명 평문 0·호스트키 TOFU·traversal/Zip Slip 차단·.part 원자 rename·평문 FTP 경고·네트워크 import remote/ 한정. **정직 한계(은폐 금지·✅ 위장 아님): verify는 헤드리스 불변식만 증명. 실 외부 앱 드롭·드래그 고스트(M1)·탐색기 양방향 복사/이동(Move) 실 왕복(M2)·실 SFTP/FTP/FTPS 핸드셰이크·호스트키 모달·실 DPAPI 암복호·실 전송 진행률/취소/충돌·.part rename·실 타임아웃/끊김 세션격리·평문 FTP 경고(M3)는 런타임 스모크 권장 🟡.** 상세 §M·[roadmap.md §0.5·§3-M](./roadmap.md).
> 범례: ✅ 구현 완료 · 🟡 부분 · 🔜 미착수.
> **[2026-06-08 편입·구현 완료·QA PASS ✅] N장(즐겨찾기 UX 향상, 신규 2기능)** 사용자 요청으로 정식 편입(🔜) → 같은 날 설계·구현·통합 QA PASS(상태 🔜→✅ 동기화). **N1 즐겨찾기 경로 워터마크(Should ✅ — `domain/rules/favoriteWatermark.ts`·`FavoriteWatermark.tsx`·`Panel.tsx`·`ui/theme/palette.ts`/`tokens.ts` 4테마 토큰·`verify:domain` 49·`verify:contrast` 실패 0)·N2 즐겨찾기 드래그 정렬(Should ✅ — `useFavoriteReorder.ts`·`sidebarSlice.reorderFavorite`·`Sidebar.tsx`·키보드 대체수단 `Alt+Shift+↑/↓`·`verify:store` 107·`verify:persistence` 94)**, US-13.1·US-13.2. **N1·N2는 기존 즐겨찾기/북마크(C4, Must)·즐겨찾기 별칭(J7·US-9.7, Should)의 비파괴 확장** — N1은 J7 별칭(`SidebarSnapshot.favoriteLabels`)을 워터마크 텍스트 소스로 재사용(없으면 경로 basename), N2는 `SidebarSnapshot.favorites` 배열 순서를 추가 영속한다. **렌더러 전용·신규 IPC 채널 0·신규 npm 의존성 0·신규 ADR 0.** 우선순위 근거는 [PRD §6 "MoSCoW 분류 근거(2026-06-08 §N)"](./PRD.md#6-범위와-우선순위-moscow). 신규 전역 단축키 불요(N1=자동 표시·N2=마우스 드래그 + 키보드 대체수단 `Alt+Shift+↑/↓`·전역 미배정·충돌 0). **정직 한계(은폐 금지·✅ 위장 아님): verify는 헤드리스 순수 로직·불변식만 증명. 실 GUI 동작(워터마크 렌더·드래그/키보드 정렬·테마별 반투명도·재시작 순서 유지·한국어 IME `Alt+Shift` 점유 가능성)은 런타임 스모크 권장 🟡.** 상세 §N·user-stories 에픽13·flows F17~F18.
> **[2026-06-08 편입·구현 완료·QA PASS ✅] M장(외부 연계, 신규 3기능)** 사용자 요청으로 정식 편입 → 같은 날 MP0~MP5 구현·통합 QA PASS(상태 🔜→✅). **M1 외부 프로그램으로 D&D 복사(Should)·M2 클립보드 외부 연계(CF_HDROP 양방향, Should)·M3 FTP/SFTP 원격 접속(Could)**, US-12.1~12.5. M1·M2는 기존 A3(패널 간 D&D)·B4(복사/붙여넣기)의 **외부 확장**, M3는 **PRD §6 Won't "FTP/SSH 등 원격 프로토콜 브라우징"을 사용자 결정으로 정정·편입**(은폐 금지·PRD 결정 D6)하며 "로컬 전용·외부 네트워크 전송 없음(D5)" 보안 원칙을 **부분 개정**(D7 — 사용자가 명시 입력한 원격 호스트로만 연결 허용·그 외 임의 외부 송신 금지(텔레메트리 포함·D5 옵트인 원칙 유지)). **자격증명은 OS 자격증명 보관소(safeStorage/DPAPI)에만 저장·평문 저장 금지**. 우선순위 근거는 [PRD §6 "MoSCoW 분류 근거(2026-06-08 신규 3건 — §M 외부 연계)"](./PRD.md#6-범위와-우선순위-moscow). **모두 ✅ 구현 완료(실 동작은 런타임 스모크 권장 🟡).** 상세 §M.
> **[2026-06-09 §M 결함 수정 + 비계획 구현 플래그 — doc-sync·상태/추적성만]** ① **§M 결함 수정 2건**: M3 원격 디렉토리 더블클릭 ENOENT·M1 외부 드래그 "여기에 드롭" 오버레이 잔존을 수정 — **직전 "§M 코드 정합 ✅"가 실제로는 원격 진입·드래그 종료가 깨져 있던 ✅위장 드리프트였음을 정정**(코드 정합 회복·실 동작은 여전히 런타임 스모크 🟡·신규 스코프 아님·§M 동작 규칙 문구 무변경). ② **[2026-06-09 정식 편입 — 위 ② "비계획 구현 플래그" 해소] "파일/폴더 상단 고정(pin)"을 §O(O1·US-14.1·F19)로 정식 편입**: docs/temp/ref.md "아이디어" 기반으로 코드 선구현됐던 비계획 구현(컨텍스트 메뉴 상단 고정/해제·디렉토리별 📌 최상단 표시·세션 영속)을 PM/사용자 결정으로 **정식 기획 항목으로 편입**했다 — features §O 신규 절·PRD §6 MoSCoW(Should)·user-stories 에픽14(US-14.1)·flows F19 추가. 우선순위 **Should**(즐겨찾기 별칭 J7·워터마크 N1과 동급 소규모 렌더러 UX). **렌더러 전용·신규 IPC 채널 0·신규 npm 의존성 0**(`verify:domain` 60(applyPins)·`verify:store` 121(pin 액션·영속)·`verify:persistence` 101(coercePinnedByDir)). **코드 정합·verify 충족 ✅ / 실 GUI 동작(컨텍스트 메뉴 토글·목록 최상단 📌 렌더·재시작 후 유지)은 런타임 스모크 권장 🟡**(✅ 위장 아님). roadmap·traceability 상태/추적성 갱신은 후속 chief-architect + doc-sync 담당. 상세 §O.
> **[2026-06-09 동작 변경 2건 — refinement·기존 기능 수용기준 갱신]** docs/temp/ref.md 신규 아이디어 2건을 구현·검증 완료하여 기존 명세를 실제 동작에 맞게 갱신했다(새 챕터 신설 아님·MoSCoW 등급/스코프 불변). ① **§O 고정 표시 "최상단 정렬"→"스크롤 고정(sticky)"**: 목록(list)·자세히(details) 보기에서 고정 항목이 스크롤해도 상단에 붙어 계속 보이도록 변경(키보드 내비게이션은 밴드 높이만큼 스크롤 보정). **아이콘 그리드(icons-*)는 wrapping 레이아웃 특성상 sticky 미적용 → 기존대로 "정렬 최상단"만 유지**(보기별 차이 정직 표기). §O1 표시·정렬 규칙·수용기준·US-14.1·F19 갱신. ② **원격 주소창 경로-only 입력(§H5×§M3 교차)**: 원격(SFTP/FTP) 패널의 주소 표시줄 편집 시 호스트(`sftp://host`)는 고정 프리픽스로 표시되고 사용자는 경로만(`/mnt/sub`) 입력하면 현재 호스트와 결합해 이동(방어적으로 전체 URI 입력도 처리·로컬 경로 입력 동작 불변). §H5·§M3 동작 규칙·수용기준·US-7.5·US-12.4·flows 주소입력/F16 갱신. **검증: typecheck/lint/build 0·verify 회귀 0(domain 60·store 121·persistence 101·perf 25 windowing 불변·remote-route 47). 실 GUI(원격 주소 경로-only 입력·이동, 고정 sticky 스크롤 고정 렌더·키보드 보정)는 헤드리스 미증명 → 런타임 스모크 권장 🟡.**
> **[2026-06-09 편입·구현 완료(코드)·통합 검증 PASS ✅ / 실 GUI 🟡 — 파워기능 M6 1차 3종(§P·§R·§T)]** 2026-06-09 §P~§U 14종 일괄 기획 편입(설계만·🔜) 중 M6 배정 3종을 구현·통합 검증 완료. **P1 듀얼 패널 폴더 비교(메타·단일깊이)(§P·US-15.1·F20, Should ✅ 코드 — `domain/rules/compare.ts` 4상태·`planMirror`·`compareSlice`·`usecases/compare`·`ui/compare/`[CompareView·CompareToolbar·useSyncScroll·CompareMirrorDialog]·`CompareStatus` DTO·미러=기존 `op:*`·**해시 비교·재귀 비교는 M7 연기 🔜**) · R1 고급 일괄 이름변경(§R·US-17.1·F22, Should ✅ 코드 — `domain/rules/batchRename.ts`·`usecases/batchRename`·`ui/rename/BatchRenameDialog`·`undoSlice kind:'batchRename'`·`undo.ts` 역연산·`Ctrl+Shift+R`·기존 `fs:rename` 반복) · T3 정렬/필터 프리셋(§T·US-19.3·F30, Should ✅ 코드 — `domain/rules/filterComposition.ts`·`presetsSlice`·`usecases/presets`·`ui/preset/PresetBar+PresetManageDialog`·`FilterPreset` DTO·`selectors.computeVisible` matches 교체·`coerceFilterPresets`·`SESSION_SCHEMA_VERSION` 1→2).** **3기능 모두 렌더러+세션영속·신규 IPC 채널 0·신규 npm 의존성 0.** 검증: typecheck/lint/build 0·`verify:domain` 132·`verify:store` 162·`verify:persistence` 123·`verify:operations` 75·`verify:perf` 25·`verify:p5` 52(0 fail·회귀 0). **정직 한계(은폐 금지·✅ 위장 아님): 헤드리스 verify는 순수 로직·store·세션 영속 불변식만 증명. 실 GUI 동작(프리셋 드롭다운/관리 다이얼로그·일괄 rename 실 파일 왕복·Ctrl+Z 실복원·비교 진입/미러/동기 스크롤)은 런타임 스모크 권장 🟡. P1 메타·단일깊이 한정·해시/재귀 M7 연기. 나머지 §P~§U 11종(Q1·R2·R3·R4·S1·S2·T1·T2·U1·U2·U3)은 🔜 미착수(M7~M9).** 상세 §P·§R·§T·[roadmap.md §0.5](./roadmap.md).
> **[2026-06-09 편입·구현 완료(코드)·통합 검증 PASS ✅ / 실 워커·GUI 🟡 — 파워기능 M7 2차(공용 인프라 W1·W2 + 4기능)]** M7 배정분을 구현·통합 검증 완료. **공용 해시 인프라 W1**(`src/main/hash/`[hashEngine·dupEngine·compareEngine·verifyEngine·fsDeps·HashManager]·`src/main/workers/`[hashWorker·hashProtocol]·`hash.handlers.ts`·**신규 채널 `hash:compare:*`/`hash:dup:*`/`hash:verify:*`/`hash:cancel`**·SHA-256 node:crypto·Worker Threads·취소·진행률·`verify:hash` 46)·**전송 큐 인프라 W2**(`TransferQueue.ts`·`OperationManager` 큐 승격·`queue.handlers.ts`·**신규 채널 `queue:*`**·SharedArrayBuffer 2워드 cancel+pause·`verify:queue` 47). **R2 중복 파일 찾기(§R·US-17.2·F23, Should ✅ 코드 — `domain/rules/dupGroup.ts`·`dedupSlice`·`usecases/dedup.ts`·`ui/dedup/DuplicatesDialog.tsx`·`dupEngine.ts`·`hash:dup:*`·정리=기존 `op:trash`) · R3 전송 큐 매니저(§R·US-17.3·F24, Should ✅ 코드 — `usecases/queue.ts`·`ui/queue/(QueuePanel·QueueItemRow·QueueConcurrencyControl·queueFormat)`·StatusBar 합산) · R4 복사 시 체크섬 검증(§R·US-17.4·F25, Could ✅ 코드 — `domain/rules/checksumVerdict.ts`·`usecases/checksum.ts`·`SettingsSnapshot.verifyOnCopy`·SettingsDialog 토글·op:done 후 `hash:verify` 트리거) · P1 해시/재귀 비교 확장(§P·US-15.1, ✅ 코드 — `ComparePairDTO.relPath?`·`compare.ts` useHash/recursive·`fromCompareResult`·`compareSlice` 해시잡·`usecases/compare` `hash:compare:*` 구독·`compareEngine.ts`·옵션 off는 M6 메타 동치).** **신규 IPC 채널 `hash:*`·`queue:*`·신규 npm 의존성 0(SHA-256=node:crypto 내장).** 검증: typecheck/lint/build 0·`verify:hash` 46·`verify:queue` 47·`verify:domain` 168·`verify:store` 207·`verify:persistence` 128·`verify:operations` 75·`verify:ops` 35·`verify:paste` 13·`verify:scan` 39·`verify:fs` 19·`verify:perf` 25·`verify:p5` 52(전부 0 fail·회귀 0). **정직 한계(은폐 금지·✅ 위장 아님): 헤드리스 verify는 순수 로직·store·해시/큐 불변식만 증명. 실 동작(해시 워커 잡·큐 스케줄러 일시정지/재개·중복 정리·복사후 검증 트리거·해시/재귀 실 GUI 비교)은 런타임 스모크 권장 🟡. R4 비원자 복사 검증 타이밍·원격 큐 일시정지 미배선 정직 표기. 나머지 §P~§U 7종(Q1·S1·S2·T1·T2·U1·U2·U3)은 🔜 미착수(M8~M9).** 상세 §P·§R·[roadmap.md §0.5](./roadmap.md).
> **[2026-06-10 편입·구현 완료(코드)·통합 검증 PASS ✅ / 실 GUI·실 워커 🟡 — 파워기능 M8 6종(§S·§T·§U) + 신규 Should §W1]** M8 배정 6종을 구현·통합 검증 완료. **S1 내용 검색(grep)(§S·US-18.1, Should ✅ 코드 — **신규 채널 `search:content:*` 5종**·`main/search/{grepEngine,binaryDetect,GrepManager,fsDeps}`·`main/workers/grep{Worker,Protocol}`·`search.handlers.ts`·`usecases/contentSearch`·`searchSlice`·`ui/search/ContentSearchDialog`·`domain/rules/contentSearch`·ADR-010·점프=기존 `preview:read`·신규 의존성 0[Node 내장]·`verify:search` 58·`verify:contentsearch` 38) · S2 명령 팔레트(§S·US-18.2, Should ✅ 코드 — 신규 채널 0·`ui/palette/CommandPalette`·`paletteMatch`·`Ctrl+Shift+P`·`verify:palette` 20) · T1 파일 태그/색상 라벨(§T·US-19.1, Should ✅ 코드 — 신규 채널 0·`domain/rules/tags.ts` 7색·`tagsSlice`·세션 메타 `tagsByPath`·**T3 폐기로 삭제됐던 filterComposition 태그 합성 재설계**) · T2 폴더 용량 인라인(§T·US-19.2, Should ✅ 코드 — 신규 채널 0·`usecases/folderSize`·`analyze:scan:*` 재사용) · U1 Space 퀵룩(§U·US-20.1, Should ✅ 코드 — 신규 채널 0·`ui/quicklook/QuickLookOverlay`[J5 재사용]·`Space`·`preview:read` 재사용) · U2 브레드크럼 드롭다운(§U·US-20.2, Should ✅ 코드 — 신규 채널 0·`ui/toolbar/BreadcrumbDropdown`·`breadcrumbSiblings`·`fs:tree-children` 재사용).** **신규 Should §W1 자세히 보기 컬럼 헤더·너비 드래그(§W·US-21.1·F34, ✅ 코드 — 신규 채널 0·`domain/rules/columnWidths.ts`·`columnsSlice`·`FileListView` sticky 헤더 밴드·세션 영속).** **S1만 신규 IPC 채널 추가·나머지 5종+§W1 신규 채널 0·신규 npm 의존성 0.** 검증: `npm run build`(typecheck node+web+electron-vite) PASS·ESLint 0·신규 `verify:search` 58·`verify:palette` 20·`verify:contentsearch` 38 + `verify:domain` 204·`verify:store` 222·`verify:persistence` 119(전부 0 fail·회귀 0). **정직 한계(은폐 금지·✅ 위장 아님): 헤드리스 verify는 순수 로직·store·세션 영속·계약 불변식만 증명. 실 GUI·실 워커(grep 스트리밍·결과 점프·미리보기 표출·팔레트 검색/실행·Space 퀵룩·태그 부여/필터·폴더용량 실 스캔·브레드크럼 ▾ 이동·컬럼 헤더 드래그/키보드 리사이즈/재시작 후 폭 유지)는 런타임 스모크 권장 🟡. Electron 앱 미실행. M8 잔여 0 — 파워기능 잔여는 M9(Q1 압축·U3 멀티윈도우) 2종(아래 M9 배너에서 구현 완료).** 상세 §S·§T·§U·§W·[roadmap.md §0.5·§1](./roadmap.md).
> **[2026-06-12 편입·구현 완료(코드)·통합 QA PASS ✅ / 실 GUI·실 패키지 🟡 — §Y Windows 셸 컨텍스트 메뉴 연동 1종(Y1·US-23.1, Should)]** 사용자 직접 요청으로 정식 편입 → 설계 ADR-013 → T1~T6 구현 → 통합 QA PASS([qa-integration-Y](./reviews/qa-integration-Y.md))로 완료(상태 🔜→구현 완료(코드)). **Y1 Windows 셸 컨텍스트 메뉴 연동(Should ✅ 코드)** — 파일/폴더 우클릭 시 앱의 React 컨텍스트 메뉴 하단에 "Windows 메뉴" 섹션을 추가해, Windows에 설치된 프로그램들이 등록한 셸 컨텍스트 메뉴 항목(예: "반디집으로 압축하기", "Cursor로 열기", "AGT-Finder로 열기")을 노출하고 선택 시 실행한다. **기술 방식(확정·실코드): Windows 셸 COM Verbs 열거 + `verb.DoIt()` 실행**(네이티브 N-API 애드온 비채택·신규 네이티브 의존성 0)·메인 프로세스 **상주 PowerShell 워커 `shellVerbsWorker.ps1`**(기존 hash/archive 워커 패턴)로 COM 호출. **신규 IPC 채널 `shell:context-verbs`/`shell:invoke-verb` 2종**(P1 동결 후 신기능 선례 동일 규약)·`os/shellVerbs.ts`(워커 서비스·before-quit dispose)·`os/shellVerbsBlacklist.ts`(자체구현 verb 누출 차단·설계와 달리 분리)·`shellVerbsSection.ts`(메뉴 섹션 병합·설계와 달리 분리)·`shell.handlers.ts`(sender·zod·재열거 교차검증→`EVERB` 거부)·`FileOpErrorCode`에 `'EVERB'` 비파괴 확장·electron.vite ps1 복사·electron-builder asarUnpack. 기존 B6 컨텍스트 메뉴 인프라(`ui/contextmenu/`)·ADR-005 보안 모델의 확장이며 우선순위 **Should**(우클릭 메뉴 내 섹션·신규 키 불요). 검증: typecheck(node+web)/build PASS(out/main/shellVerbsWorker.ps1 생성)·ESLint 0·`verify:shellverbs` 75/0·일회성 실 노드 스모크(ps1 워커 한글 경로 왕복·실 COM 열거·블랙리스트 필터·EVERB 거부·dispose 좀비 0) 통과. **정직 한계(은폐 금지·✅ 위장 아님): 헤드리스 verify·실 노드 스모크로 증명된 항목만 ✅·실 GUI(우클릭 "Windows 메뉴" 섹션 표출·로딩→채움/숨김·verb 클릭→외부 프로그램 DoIt·다중선택/원격/archive 숨김·한글 display 실 렌더)·실 패키지 설치본(asar ps1 경로·ExecutionPolicy·`npm run dist` 미수행)은 런타임 스모크 권장 🟡. 별도 트랙: `verify:worker` FAIL은 §Y 무관 사전 환경 결함(Node 22.17 워커 atomics·clean HEAD 동일 재현·§Y 회귀 아님).** 우선순위 근거는 [PRD §6 "MoSCoW 분류 근거(2026-06-12 §Y)"](./PRD.md#6-범위와-우선순위-moscow). 상세 §Y·user-stories 에픽23(US-23.1)·flows F37·[roadmap.md §0.5 2026-06-12 §Y 단락](./roadmap.md).
> **[2026-06-10 편입·구현 완료(코드)·통합 검증 PASS ✅ / 실 GUI·실 워커·멀티윈도우 🟡 — 파워기능 M9 2종(§Q·§U) + 신규 Should §U4·§X1]** M9 배정 2종 + 사용자 명시 요청 신규 Should 2건을 구현·통합 검증 완료. **Q1 압축파일 `archive://` 어댑터(§Q·US-16.1, Should ✅ 코드 — **신규 채널 `archive:open/list/close/extract/add` 5종**·**신규 의존성 `yauzl`+`yazl`**[MIT·네이티브 0]·`src/main/archive/*`[`ArchiveService`·`ZipReader`(yauzl)·`ZipWriter`(yazl)·`ArchiveSessionManager`·`archiveProtocol`·`archiveErrors`]·`src/main/workers/archiveWorker.ts`·`src/shared/archive/{safePath,archivePath}.ts`[Zip Slip 순수]·`renderer/app/usecases/archive.ts`·추출/추가=기존 `op:*`·1차 zip만·암호 zip 제외·중첩 zip 제외·Zip Slip 차단[ADR-008]·`verify:archive` 56·`verify:archiveui` 43) · U3 탭 색상/잠금·탭 분리(새 창)(§U·US-20.3, Could ✅ 코드 — 색상/잠금=세션 메타[`Tab.color?`/`locked?`·신규 채널 0·닫기 가드]·탭 분리=멀티 윈도우[`src/main/windows/windowManager.ts`·`renderer/app/usecases/windowSplit.ts`·**신규 채널 `window:split-tab`/`window:get-init` 2종**]·신규 의존성 0).** **신규 Should §U4 탭 사용자 지정 이름(§U·US-20.4, ✅ 코드 — 신규 채널 0·`tabsSlice.setTabName/clearTabName`·`TabBar TabRenameInput`·`TabSnapshot.customName?` 영속) · §X1 좌측 사이드바 "빠른 위치 ▸ 다운로드"(§X·US-22.1, ✅ 코드 — **신규 채널 `fs:known-folders` 1종**·`KnownFoldersDTO`·`sidebarSlice.loadKnownFolders`·`Sidebar` 빠른 위치 섹션·다운로드만 렌더).** **Q1만 신규 의존성 추가(yauzl/yazl)·Q1·U3·X1 신규 채널 추가·U4 신규 채널 0.** 검증: `npm run build`(typecheck node+web + archiveWorker.js 번들) PASS·ESLint 0·부팅 스모크 정상·`verify:archive` 56·`verify:archiveui` 43 + store/persistence 증분(전부 0 fail·회귀 0). **정직 한계(은폐 금지·✅ 위장 아님): 헤드리스 verify·코드 정합·부팅 스모크(창 표시)만 ✅. 실 기능 동작(zip 실 열기/추출/추가 IPC 왕복·op:* 진행률·멀티 윈도우 실 분리/이동/복원·탭 인라인 이름변경·색상/잠금·다운로드 노드 이동)은 런타임 스모크 권장 🟡. U3 정직 한계: 멀티 윈도우 세션 복원은 주 창만(분리 창 reopen-only·재시작 복원 안 함·의도적 MVP). M9 잔여 0 — §P~§U 14종 전부 완료(M6~M9 종료·T3 폐기).** 상세 §Q·§U·§X·[roadmap.md §0.5·§1](./roadmap.md).

---

## A. 멀티 디렉토리 핵심 UX

### A1. 탭 관리 (M)
**목적**: 여러 위치를 한 창에서 보관·전환.

| 항목 | 동작 규칙 |
|---|---|
| 새 탭 | `Ctrl+T` 또는 탭바 `+`. 기본 위치는 직전 탭 경로 또는 홈(내 PC) |
| 탭 닫기 | `Ctrl+W`, 탭 가운데 클릭, X 버튼. 마지막 탭을 닫으면 **"내 PC"(드라이브 목록)를 표시하는 기본 탭**을 유지(빈 화면 아님) |
| 탭 전환 | `Ctrl+Tab`/`Ctrl+Shift+Tab`, `Ctrl+1~9`(N번째 탭), 클릭 |
| 탭 이동 | 드래그로 순서 변경 |
| 탭 복제 (M) | `Ctrl+D` 또는 우클릭 메뉴 "탭 복제"(동일 경로 새 탭). MVP 포함(US-1.1) |
| 닫은 탭 복원 | `Ctrl+Shift+T`로 직전에 닫은 탭 복원(스택) |
| 탭 제목 | 현재 폴더명 표시. 동명 폴더는 상위 일부 경로 병기 |

- **상태**: 각 탭은 자신의 탐색 히스토리(뒤로/앞으로), 정렬/보기 상태를 독립 보관한다.
- 비정상 종료/재시작 시 마지막 탭 목록·경로 복원(M, 자동). 명시적 워크스페이스 저장은 S.

### A2. 분할 패널 (M: 2분할 / S: 4분할)
**목적**: 서로 다른 디렉토리를 나란히 보고 동시에 작업.

| 항목 | 동작 규칙 |
|---|---|
| 2분할 | 좌우 분할 / 상하 분할 선택 (M) |
| 4분할 | 2x2 그리드 (S) |
| 분할 해제 | 패널 닫기 → 단일 패널로 복귀 |
| 활성 패널 | 항상 하나의 패널이 "활성"(포커스). 테두리/헤더로 시각 표시 |
| 패널 포커스 이동 | **`Tab`**(주된 키) 또는 `Ctrl+←/→`. ※ 구 파일 이동 키 `F6`은 2026-06-07 제거됨(§A3·§E1) — 충돌 여지 자체가 사라짐 |
| 패널 크기 | 분할선 드래그로 비율 조절(S), MVP는 균등 분할 |
| 각 패널 독립 | 패널마다 경로·정렬·보기·선택 상태 독립 |

- **탭과의 관계**: 분할은 "현재 탭 안의 레이아웃"이다. 각 탭이 자신의 분할 구성을 가진다.
  (한 탭에서 2분할, 다른 탭은 단일 패널 가능)
- 패널은 그 자체로 하나의 탐색기 뷰(주소 표시줄·목록·정렬을 가짐).

### A3. 패널 간 이동/복사 (M)
**목적**: 출발지·도착지를 보며 즉시 파일 옮기기.

| 방법 | 동작 규칙 |
|---|---|
| 드래그&드롭 | 한 패널에서 선택 항목을 다른 패널 목록으로 드래그 |
| 기본 의도 | **같은 드라이브 = 이동**, **다른 드라이브 = 복사** (Windows 관례 따름) |
| 의도 강제 | 드래그 중 `Ctrl`=복사 강제, `Shift`=이동 강제 |
| ~~단축키 복사/이동~~ | ~~활성 패널 선택 항목을 **다른 패널로 복사 = `F5`**, **이동 = `F6`**~~ — **삭제됨/Deprecated(2026-06-07 사용자 요청, 사유: 일반 사용자에게 일반적이지 않은 단축키).** 패널 간 복사/이동은 **D&D**와 **클립보드(`Ctrl+C/X/V`)** 로만 한다. `F5`/`F6`는 미배정(새로고침은 기존대로 `Ctrl+R`) |
| 드롭 대상 | 패널의 빈 영역 = 해당 패널 현재 폴더, 폴더 항목 위 = 그 폴더 안 |
| 시각 피드백 | 드롭 가능 대상 하이라이트, 복사/이동 커서 구분 표시 |
| 자기 위치 드롭 | **출발지와 동일한 폴더에 드롭하면 작업 없이 무시**(복사본 생성 안 함). 단, 명시적 복사(`Ctrl` 강제)는 같은 폴더 "복사본" 규칙 적용 |
| 순환 이동 차단 | **조상 폴더를 그 자손 폴더로 이동(자기 자신을 포함하는 경로)하면 차단하고 "폴더를 자기 하위로 옮길 수 없습니다" 안내** |
| 충돌 | 같은 이름 존재 시 충돌 다이얼로그(아래 D4) |

> 드래그 중 의도(복사/이동)는 커서·툴팁으로 항상 명시한다(사용자 오작동 방지).

---

## B. 파일/폴더 기본 조작

### B1. 목록 보기 (M: 리스트/상세, S: 그리드)
| 보기 | 내용 |
|---|---|
| 상세(Details) (M) | 이름·크기·형식·수정일 컬럼. 컬럼 클릭=정렬, 폭 조절·표시 토글 |
| 리스트(List) (M) | 아이콘+이름 컴팩트 나열 |
| 그리드/썸네일(Grid) (S) | 큰 아이콘/이미지 썸네일. 썸네일 크기 단계 조절. (보기 5종은 J3 ✅·**이미지 내용 썸네일 자체 생성은 feat-L1 §L ✅ 구현 완료**) |

- 아이콘은 OS 시스템 아이콘/연결 프로그램 아이콘 사용.
- 보기 상태는 패널별로 기억(M), 폴더별 기억은 C.

### B2. 정렬 (M)
- 기준: 이름 / 크기 / 형식(확장자) / 수정일. 오름차순·내림차순 토글.
- **폴더 우선** 정렬 기본 on(폴더가 파일보다 위). 토글 가능.
- 이름 정렬은 자연 정렬(파일2 < 파일10) 적용.

### B3. 생성 / 이름변경 / 삭제 (M)
| 동작 | 규칙 |
|---|---|
| 새 폴더 | `Ctrl+Shift+N`. 기본명 "새 폴더", 즉시 이름 편집 상태 |
| 새 파일 | 컨텍스트 메뉴(텍스트 파일 등 기본 템플릿) |
| 이름변경 | `F2` 또는 천천히 두 번 클릭. 잘못된 문자(`\ / : * ? " < > |`)·중복명 차단 및 안내 |
| 삭제(휴지통) | `Delete` → 휴지통 이동(기본). 되돌리기 가능 |
| 영구 삭제 | `Shift+Delete` → 별도 확인 다이얼로그 후 영구 삭제 |

### B4. 복사 / 잘라내기 / 붙여넣기 (M)
- `Ctrl+C` 복사, `Ctrl+X` 잘라내기, `Ctrl+V` 붙여넣기. OS 클립보드 연동(타 앱 호환).
- 잘라내기 항목은 흐리게 표시, 붙여넣기 전까지 원본 유지.
- 같은 폴더 붙여넣기 시 "이름 - 복사본" 규칙으로 자동 명명.

### B5. 휴지통 (M 기본 연동 / S 관리 화면)
- 삭제는 OS 휴지통으로 이동(M). 사이드바에서 휴지통 접근.
- 휴지통 관리(복원·비우기) 화면은 S → **feat-K2(§K2)에서 정식 편입·구현 완료 ✅**(목록 필드·선택 복원·전체 비우기·확인·보안 수용 기준; 신규 채널 `trash:*`·`recycleBin.ts`).

### B6. 실행 / 열기 (M)
- 더블클릭: 폴더=진입, 파일=OS 연결 프로그램으로 실행.
- `Enter`=열기, `Backspace`/`Alt+←`=상위/뒤로.
- 컨텍스트 메뉴(우클릭): 열기, 연결 프로그램으로 열기(S — ✅ `shell:open-with`, 파일 전용), 복사/잘라내기/이름 바꾸기, 삭제(휴지통)/영구 삭제, 속성(OS 속성창 호출 `shell:show-properties`). 빈 영역: 붙여넣기/새 폴더/새로고침(My PC는 새로고침만). ✅ 구현 완료(우클릭이 키보드/툴바와 동일 commandId 경로로 수렴). ※ 폴더/빈 영역의 "터미널 열기"는 별도 항목 → features §H4(US-7.4, ✅ 구현 완료)에서 정의(B6 실행/속성과 동일 보안 모델·ADR-005, 신규 채널 `shell:open-terminal`).

### B7. 되돌리기 (S) — ✅ 구현 완료(feat-K1·§K1)
- 직전 파일 작업(이동/이름변경/삭제→휴지통/복사) `Ctrl+Z`로 되돌리기. **범위·한계는 feat-K1(§K1)에서 정식 확정·구현 완료 ✅**(다단계 undo 스택 cap 50·역연산 가능 작업 표·충돌 선검증·영구삭제 불가·copy-undo 보수적).

---

## C. 탐색 (Navigation)

### C1. 주소 표시줄 (M)
- 현재 경로를 **브레드크럼**으로 표시(각 구간 클릭=해당 폴더 이동).
- 클릭/`Ctrl+L`로 편집 모드 전환 → 경로 직접 입력·붙여넣기로 이동.
- 잘못된 경로 입력 시 인라인 오류 표시(이동 안 함).
- 경로 텍스트 복사 액션 제공(개발자 니즈).

### C2. 뒤로 / 앞으로 / 위로 (M)
- 뒤로 `Alt+←`, 앞으로 `Alt+→`, 위로(상위 폴더) `Alt+↑`.
- 패널/탭별 독립 히스토리. 버튼 길게 눌러 히스토리 목록(S).

### C3. 트리 사이드바 (M)
- 좌측에 드라이브·폴더 트리. 펼침/접힘, 클릭=활성 패널 경로 이동.
- 즐겨찾기·최근·휴지통·내 PC(드라이브 목록) 섹션 포함.
- 사이드바 표시/숨김 토글, 폭 조절.

### C4. 즐겨찾기 / 북마크 (M)
- 폴더를 즐겨찾기에 추가/제거(드래그 또는 메뉴). 사이드바 상단 고정.
- 순서 변경, 이름 별칭 지정(S). *(이름 별칭=J7(§J7)에서 정식 구현 완료 ✅. **순서 변경=N2(§N2)에서 드래그 정렬로 구현 완료 ✅**(드래그 + 키보드 `Alt+Shift+↑/↓`·실 동작 런타임 스모크 🟡). 현재 패널이 즐겨찾기 경로일 때의 배경 워터마크 시각 피드백은 **N1(§N1) 구현 완료 ✅**.)

### C5. 최근 위치 (M)
- 최근 방문 폴더 N개 기록(개수 설정 가능). 사이드바/드롭다운에서 접근.
- 항목 개별 삭제·전체 지우기(개인정보 고려).

---

## D. 검색 / 필터 / 충돌 처리

### D1. 현재 디렉토리 검색 (M)
- 활성 패널에 검색창(`Ctrl+F`). 파일/폴더 **이름** 기준 즉시 필터(점증 검색).
- 하위 폴더 포함 검색 토글(S). 결과는 현재 목록을 필터링해 표시.
- 검색 중 일치 부분 하이라이트.

### D2. 필터 (M)
- 확장자/이름 패턴 필터(예: `*.png`, `report*`). 검색창과 통합 또는 별도 필터 바.
- 빠른 필터 칩(S): 이미지/문서/동영상 등 유형 묶음.

### D3. 미리보기 패널 (S) — ✅ P6 구현(`preview:read`·PreviewPanel·`Ctrl+P`)
- 선택 항목 미리보기: 이미지(축소), 텍스트(앞부분), 기본 메타(크기/수정일/형식).
- 패널 토글(`Ctrl+P` 등). 미지원 형식은 메타+아이콘만 표시.

### D4. 충돌 처리 규칙 (M) — 데이터 안전 핵심

복사/이동 중 같은 이름 대상이 있을 때 명시적 선택 없이 임의 덮어쓰기 금지. (수용 기준은 US-2.4)

| 옵션 | 동작 | 우선순위 |
|---|---|---|
| 덮어쓰기 | 대상 **파일** 교체. 대상이 **폴더**면 내용 **병합**(하위 항목별로 충돌 재판정) | M |
| 건너뛰기 | 해당 항목 작업 제외, 나머지는 계속 | M |
| 둘 다 유지 | 새 항목을 "이름 (n)"으로 자동 명명해 둘 다 보존 | M |
| 폴더 병합 | 같은 이름 폴더는 삭제·교체가 아니라 **재귀 병합**(내부 동일명 파일만 재충돌 처리) | M |
| 모두 적용 | 현재 선택을 이후 동일 유형 충돌에 **일괄 적용**(다이얼로그 재표시 안 함) | M |

- **읽기전용 대상**: 덮어쓰기 선택 시 사용자 확인 후 진행, 거부 시 건너뜀.
- **사용 중/권한 없음 대상**: 명확한 사유와 함께 자동 건너뜀, 작업 종료 후 **결과 요약에 실패 항목·사유 목록**.
- 충돌 다이얼로그에는 양쪽 항목의 **크기·수정일**을 나란히 보여 비교 가능하게 한다.

---

## E. 부가 기능

### E1. 키보드 단축키 체계 (M)

**단일 출처: [PRD.md 8장 단축키 체계](./PRD.md#8-단축키-체계-확정--충돌-없음)** — 충돌 없이 확정됨.
여기서는 핵심 원칙만 요약한다(중복·불일치 방지를 위해 키 전체 목록은 PRD 8장만 유지).

- **패널 포커스 이동**: `Tab`(주) / `Ctrl+←·→`(보조)
- ~~**패널 간 복사/이동**: `F5`(복사) / `F6`(이동)~~ — **삭제됨/Deprecated(2026-06-07 사용자 요청, 사유: 일반 사용자에게 일반적이지 않은 단축키).** 패널 간 복사/이동은 **D&D**·**클립보드(`Ctrl+C/X/V`)** 로 수행. `F5`/`F6` 키는 미배정
- **새로고침**: `Ctrl+R` (기존대로 유지 — `F5`/`F6` 제거 후에도 변경 없음)
- **탭/탐색/파일/선택**: PRD 8장 표 참조
- 단축키 사용자 정의는 Could(설정에서 보기 전용은 M).

> 과거 F5(새로고침↔복사)·F6(포커스 이동↔파일 이동) 이중 할당은 PRD 8장으로 해소됐고, **2026-06-07 사용자 결정으로 `F5`(복사)/`F6`(이동) 자체를 제거**해 키가 더 단순해졌다. 패널 간 복사/이동은 D&D·클립보드가 단일 경로다.

### E2. 다크 / 라이트 테마 (M)
- 라이트/다크/시스템 따름 3가지. 즉시 적용. 대비 AA 지향.

### E3. 다중 선택 / 일괄 작업 (M)
- `Ctrl`(개별 토글)·`Shift`(범위)·마우스 박스 선택·`Ctrl+A`.
- 선택 항목에 복사/이동/삭제/이름변경(연속 일괄)·압축(C) 일괄 적용.
- 선택 개수·합계 용량을 상태바에 표시.

### E4. 진행률 표시 (M)
- 대용량/다수 복사·이동·삭제 시 진행 다이얼로그(또는 상태바 인디케이터).
- 표시 항목: 현재 파일명, 전체 진행률, 남은 항목/용량, 속도(S), 취소 버튼.
- 동시에 여러 작업 시 작업 목록으로 묶어 표시(S).
- UI 비차단(작업 중에도 탐색 가능).

### E5. 상태바 (M)
- 현재 폴더 항목 수, 선택 개수, 선택 용량 합계, 활성 패널 경로 요약.

### E6. 설정 (M 최소)
- 테마, 기본 시작 위치, 숨김 파일·확장자 표시, 최근 위치 개수, 단축키(보기 전용 M / 편집 C).

---

## F. Windows 특수 케이스 동작 규칙 (M 고려)

| 케이스 | 규칙 |
|---|---|
| 숨김/시스템 파일 | 기본 숨김, 설정으로 표시 토글 |
| 확장자 표시 | 기본 표시, 토글 가능 |
| 긴 경로(Long Path) | 260자 초과 경로도 처리 시도, 실패 시 명확한 안내 |
| 심볼릭/정션 링크 | 링크임을 표시, 순환 참조 방지 |
| 네트워크 드라이브 | 매핑된 경로 탐색 지원, 지연/끊김 시 로딩·오류 안내 |
| 권한 없는 폴더 | 접근 거부 메시지, 빈 목록 대신 사유 표시 |
| 사용 중 파일 | 이동/삭제 실패 사유 안내, 부분 성공 보고 |
| 동일 위치 드롭 | 출발=도착 폴더 동일 시 작업 없이 무시(A3 참조) |
| 순환 이동 | 조상 폴더를 자손으로 이동 시 차단·안내(A3 참조) |

---

## G. 패키징 / 릴리스 / 개발 도구 (DevEx)

> 사용자 화면 기능이 아니라 **릴리스 산출물·브랜딩 자산·개발 도구** 영역이다.
> 원래 로드맵에 미반영된 채 진행된 추가물을 **사후 정식 편입**한 항목으로(roadmap §0.5 "로드맵 외 추가 반영" → 정식화), 모두 **구현 완료(✅)**.
> 우선순위 표기: 아이콘 = **M(릴리스 요건)** · 원클릭 빌드 = **개발 도구(DevEx)**.

### G1. 앱 아이콘 / 브랜딩 (M · 릴리스 요건) ✅
**목적**: 인스톨러·실행 파일·작업표시줄·dev 창에서 앱을 고유 아이콘으로 식별. (US-6.1)

| 항목 | 동작 규칙 |
|---|---|
| 아이콘 자산 | `resources/icon.ico`(멀티 사이즈) + `resources/icon.png` 제공 |
| 생성/재현 | `scripts/gen-icon.ps1`로 아이콘 자산을 생성·재현(소스에서 반복 빌드 가능) |
| 패키징 연결 | electron-builder `win.icon`에 `.ico` 연결 → 인스톨러·실행 파일 아이콘 적용 |
| dev 창 | 개발 실행 창에도 동일 아이콘 적용 |
| 디자인 | 겹친 폴더(멀티 디렉토리 정체성 반영) + 따뜻한 톤 |

### G2. 원클릭 인스톨러 빌드 스크립트 (개발 도구 · DevEx) ✅
**목적**: 단일 명령으로 릴리스 인스톨러를 재현성 있게 산출. (US-6.2)

| 항목 | 동작 규칙 |
|---|---|
| 위치/실행 | 프로젝트 루트 `build-installer.ps1` 단일 실행 |
| 단계 | 의존성 점검 → typecheck → electron-vite build → electron-builder(NSIS)를 순차 일괄 실행 |
| 출력 | 완료 시 생성된 인스톨러(NSIS) 파일 경로를 출력 |
| 실패 처리 | 단계 중 실패 시 중단하고 사유를 알 수 있게 함(릴리스 빌드 게이트) |

### G3. 가상 스크롤 뷰포트 높이 측정 결함 수정 (기존 Must "가상 스크롤" 품질) ✅
**목적**: 기존 Must 기능 "가상 스크롤"(B1·US-5.6)의 결함을 수정해 품질을 회복. 새 기능 추가가 아닌 **결함 수정**이다.

| 항목 | 내용 |
|---|---|
| 결함 | 로딩 중 컨테이너가 아직 마운트되지 않아 뷰포트 높이(viewportH)가 400px에 고정됨 → 가시 항목 수 오산정 |
| 수정 | `FileListView` 뷰포트 높이 측정을 **콜백 ref 기반 ResizeObserver**로 전환 + 전역 CSS 리셋 동반 |
| 효과 | 컨테이너 실제 크기에 따라 viewportH가 정확히 반영되어 가상 스크롤 렌더가 정상화 |
| 추적 | US-5.6(가상 스크롤 첫 렌더) 수용 기준에 결함 수정 메모 반영 |

---

## H. UX / 레이아웃 확장

> 기존 기능(분할 패널 A2·사이드바 C3·단축키 E1)을 **사용자 접근성·조작 편의** 관점에서 확장하는 영역이다.
> 새로운 파일시스템 동작을 추가하는 것이 아니라, **이미 존재하는 동작을 더 빠르고 직관적으로 호출·조정**하게 만든다.
> 2026-06-07 사용자 요청으로 정식 편입. 우선순위는 모두 **S(Should)** — 핵심 가치(다중 디렉토리 작업)와 독립적이나 UX 완성도를 크게 높이는 개선이다.
> 단축키는 [PRD.md 8장](./PRD.md#8-단축키-체계-확정--충돌-없음)이 단일 출처다. 범례: ✅ 구현 완료 · 🟡 부분 · 🔜 미착수.
> **[2026-06-07 구현 상태] H1·H2·H3 모두 ✅ 구현 완료.** 구현 파일 매핑은 각 절 제목 옆 표기 및 [roadmap.md §0.5 "신규 UX(H장)"](./roadmap.md) 참조.
> **[2026-06-07 추가 편입·구현 완료 ✅] H4 우클릭 "터미널 열기"·H5 디렉토리 경로 직접 입력·H6 파일 유형별 아이콘** 3기능을 H장 연장으로 정식 편입(US-7.4~7.6), team-dev에서 구현·QA PASS. 모두 **S(Should)**. H4는 컨텍스트 메뉴 인프라(`ui/contextmenu/`)·B6 보안 모델(ADR-005)을 재사용하며 신규 채널 `shell:open-terminal`을 추가했고, H5는 C1 주소 표시줄·`validateAndNavigate`를 재사용(단일 클릭 진입), H6은 P1에 계약 동결된 `shell:icon` 채널(예약 미구현)을 **정식 구현(호출부 추가)**했다 — 예약→구현으로 드리프트 해소. H4 네이티브 `wt.exe`·H6 `app.getFileIcon`의 실제 네이티브 실행은 런타임 스모크 권장.

### H1. 상단 전역 아이콘바(툴바) (S) ✅ 구현 완료 — `ui/toolbar/IconBar.tsx`·`iconBarItems.ts`(4그룹 20버튼·execCommand 수렴·activeWhen 비활성·`aria-pressed`·툴팁 단축키)·`App.tsx` 마운트
**목적**: 자주 쓰는 동작을 마우스로 한 번에 실행하도록, 앱 상단(탭바 아래)에 전역 아이콘 버튼 바를 둔다. 키보드/컨텍스트 메뉴와 **동일한 commandId**로 수렴해 조작 경로를 일원화한다. (US-7.1)

| 항목 | 동작 규칙 |
|---|---|
| 위치 | 탭바 **아래**, 주소 표시줄/패널 영역 **위**. 항상 노출(설정으로 숨김은 Could) |
| 그룹 구성 | 4개 기능 그룹을 **구분선으로 분리**해 배치(아래 순서 권장) |
| ① 레이아웃/뷰 | 사이드바 토글(`Ctrl+B`) · 2분할(`Ctrl+\`) · 4분할(`Ctrl+Shift+\`) · 미리보기(`Ctrl+P`) · 상세/리스트 보기 전환 |
| ② 파일 작업 | 새 폴더(`Ctrl+Shift+N`) · 복사(`Ctrl+C`) · 잘라내기(`Ctrl+X`) · 붙여넣기(`Ctrl+V`) · 이름바꾸기(`F2`) · 삭제(`Delete`) |
| ③ 탐색 | 뒤로(`Alt+←`) · 앞으로(`Alt+→`) · 위로(`Alt+↑`) · 새로고침(`Ctrl+R`) · 검색(`Ctrl+F`) |
| ④ 도구 | 설정(`Ctrl+,`) · 워크스페이스 · 테마 토글(라이트/다크) |
| 동작 기준 | 버튼은 **활성 패널** 기준으로 동작한다(키보드/컨텍스트 메뉴와 동일 commandId로 수렴) |
| 비활성 처리 | 컨텍스트상 불가능한 동작은 버튼을 **비활성(흐림)** 처리한다(예: 클립보드 비었을 때 붙여넣기, 선택 0개일 때 복사/잘라내기/이름바꾸기/삭제, 히스토리 없을 때 뒤로/앞으로, 최상위에서 위로) |
| 상태 반영 | 토글형 버튼(사이드바·미리보기·테마·현재 분할 모드·현재 보기 모드)은 **현재 상태를 시각적으로 표시**(눌림/하이라이트) |
| 접근성 | 각 버튼에 **툴팁(동작명 + 해당 단축키)** 과 aria-label 제공. 키보드 포커스 이동 가능 |

**수용 기준** (✅ 구현 — `IconBar.tsx`·`iconBarItems.ts`)
- [x] 탭바 아래에 4개 그룹(레이아웃/뷰·파일 작업·탐색·도구)이 구분선으로 나뉜 아이콘바가 표시된다
- [x] 각 버튼 클릭 시 키보드 단축키와 **동일한 commandId**가 실행되어 활성 패널에 적용된다(execCommand 수렴)
- [x] 컨텍스트상 불가능한 동작의 버튼은 비활성(흐림) 상태가 되고 클릭해도 동작하지 않는다(activeWhen)
- [x] 토글형 버튼(사이드바·미리보기·테마·분할 모드·보기 모드)은 현재 상태를 시각적으로 반영한다(`aria-pressed`)
- [x] 버튼에 마우스를 올리면 동작명과 해당 단축키가 포함된 툴팁이 표시된다
- [x] 테마 토글 버튼은 라이트↔다크를 즉시 전환한다(`theme.toggle`→`toggleThemeMode`; 시스템 따름은 설정에서 별도 선택)

### H2. 사이드바 온오프 토글 (S) ✅ 구현 완료 — `domain/keybindings/index.ts`(`Ctrl+B`→`sidebar.toggle`)·아이콘바 버튼 → `sidebarSlice.toggleSidebar`(collapsed·세션 영속 기존). ※ 실제 토글 동작은 런타임 스모크 권장
**목적**: 화면을 넓게 쓰기 위해 좌측 사이드바를 보이기/숨기기로 전환한다. 상태(`sidebarCollapsed`)와 토글 액션(`toggleSidebar`)은 이미 존재하나 **진입점이 없던 것**을, 아이콘바 버튼과 단축키(`Ctrl+B`)로 제공한다. (US-7.2)

| 항목 | 동작 규칙 |
|---|---|
| 토글 진입점 | 아이콘바 ①그룹의 사이드바 버튼, 단축키 `Ctrl+B` |
| 동작 | 사이드바 표시 ↔ 숨김 토글. 숨김 시 패널 영역이 그 공간을 차지(C3 폭조절과 독립) |
| 상태 유지 | 토글 상태는 세션에 영속되어 재시작 후에도 마지막 상태가 복원된다(자동 세션 복원 US-5.5 범위에 포함) |
| 시각 표시 | 아이콘바 버튼이 현재 표시/숨김 상태를 반영(눌림/하이라이트) |

**수용 기준** (✅ 구현 — `Ctrl+B`→`sidebar.toggle`→`toggleSidebar`; ※ 실제 토글은 런타임 스모크 권장)
- [x] `Ctrl+B` 또는 아이콘바 버튼으로 사이드바가 표시↔숨김 전환된다
- [x] 사이드바가 숨겨지면 패널 영역이 그 공간으로 확장된다
- [x] 토글 상태가 세션에 저장되어 재시작 후 마지막 상태로 복원된다(기존 `sidebarCollapsed` 영속 재사용)
- [x] 아이콘바 사이드바 버튼이 현재 표시/숨김 상태를 시각적으로 반영한다(`aria-pressed`)

### H3. 분할 패널 크기 조절(분할선 드래그) (S) ✅ 구현 완료 — `ui/layout/SplitDivider.tsx`·`splitMath.ts`(`ratioFromPoint`)·`LayoutHost.tsx`(2분할 flex/4분할 grid 2축 독립)·`tabsSlice.setSplitRatio`(클램프 0.15~0.85)·`splitRatios` 세션 영속(`coerceSplitRatios`). ※ 실제 분할선 드래그는 런타임 스모크 권장
**목적**: 작업에 맞게 분할 패널의 비율을 조정한다. A2 "분할선 드래그로 비율 조절(S)"을 구체화하고, **세션 영속·최소 크기·균등 복귀**를 정식 수용 기준으로 확정한다. (US-7.3)

| 항목 | 동작 규칙 |
|---|---|
| 2분할 조절 | 두 패널 사이 분할선(드래그 핸들)을 드래그해 비율 조절(좌우 분할=가로 1축, 상하 분할=세로 1축) |
| 4분할 조절 | 2x2 그리드의 **가로·세로 2축** 분할선을 각각 드래그해 행·열 비율 조절 |
| 최소 크기 | 각 패널은 **최소 폭/높이 제약**을 가진다. 제약 미만으로는 더 끌리지 않는다(패널이 사라지지 않음) |
| 균등 복귀 | 분할선 **더블클릭** 시 해당 축을 균등(50:50, 4분할은 행/열 균등)으로 되돌린다 |
| 세션 영속 | 조정한 분할 비율은 **재시작 후에도 유지**된다(자동 세션 복원 US-5.5 범위에 포함). 비율은 탭/레이아웃별로 독립 보관 |
| 시각 피드백 | 분할선 위에서 리사이즈 커서 표시, 드래그 중 비율이 실시간 반영 |

**수용 기준** (✅ 구현 — `SplitDivider.tsx`·`splitMath.ts`·`tabsSlice.setSplitRatio`·`splitRatios` 영속; ※ 실제 드래그는 런타임 스모크 권장)
- [x] 2분할에서 분할선을 드래그하면 두 패널 비율이 실시간으로 조절된다(`ratioFromPoint`)
- [x] 4분할에서 가로·세로 분할선을 각각 드래그해 행·열 비율을 조절할 수 있다(grid 2축 독립)
- [x] 각 패널은 최소 폭/높이 제약 이하로 줄어들지 않는다(클램프 `SPLIT_MIN_RATIO=0.15`~0.85)
- [x] 분할선을 더블클릭하면 해당 축이 균등 비율로 복귀한다
- [x] 조정한 분할 비율이 세션에 저장되어 재시작 후에도 유지된다(`TabSnapshot.splitRatios`·`coerceSplitRatios`, 탭/레이아웃별 독립)

### H4. 우클릭 "터미널 열기" (S) ✅ 구현 완료 — 신규 채널 `shell:open-terminal`·`os/shell.ts#openTerminal`(wt.exe→PowerShell 폴백·`execFile`)·`shell.handlers.ts`(sender·zod·guardPath·stat 디렉토리 검증)·`guard.ts#zShellOpenTerminalReq`·`usecases/open.ts`(`openTerminalAt`·`terminalErrorMessage`)·`contextMenu.ts`(단일폴더·빈영역 항목). ※ 네이티브 `wt.exe` 실제 실행은 런타임 스모크 권장
**목적**: 현재 보고 있는 폴더에서 곧바로 명령줄 작업을 이어가도록, 컨텍스트 메뉴에서 선택 폴더(또는 현재 패널 경로)를 작업 디렉토리로 터미널을 연다. 개발자(P2)가 GUI ↔ CLI를 오갈 때의 경로 재입력 피로를 없앤다. (US-7.4)

| 항목 | 동작 규칙 |
|---|---|
| 진입점 | 컨텍스트 메뉴(우클릭) 항목 **"터미널 열기"**. ① 파일 목록의 **디렉토리 항목** 위 우클릭 → 그 폴더, ② 패널 **빈 영역** 우클릭 → 현재 패널 경로 |
| 작업 디렉토리 | 위에서 결정된 폴더를 터미널의 시작 작업 디렉토리(cwd)로 연다 |
| 터미널 선택 | **Windows Terminal(`wt.exe`) 우선, 없으면 PowerShell로 폴백**(확정). 둘 다 불가 시 명확한 오류 안내 |
| 적용 대상 | 폴더에만 적용. 파일 항목 위·드라이브 목록(내 PC)·존재하지 않는 경로에는 비활성 또는 미표시 |
| 보안 | **검증된 경로만** 실행한다(ADR-005). 경로 정규화·`..` 이탈 차단·존재·권한 3관문을 통과한 경로만 터미널 실행에 위임하고, 인자 주입을 막기 위해 경로는 인자 배열로 전달(셸 문자열 합성 금지). 실패 시 실행 없이 사유 안내 |
| 기존 정합 | 컨텍스트 메뉴 인프라(`ui/contextmenu/`)와 동일 commandId 경로로 수렴(B6 실행/속성과 동일한 보안 모델·`shell:open`류 검증 재사용). 신규 단축키 불요 |

**수용 기준** (✅ 구현 — 신규 채널 `shell:open-terminal`·`os/shell.ts#openTerminal`·`contextMenu.ts`; ※ 네이티브 실행 런타임 스모크 권장)
- [x] 디렉토리 항목 위 우클릭 메뉴에 "터미널 열기"가 있고, 선택 시 그 폴더를 cwd로 터미널이 열린다
- [x] 패널 빈 영역 우클릭 메뉴의 "터미널 열기"는 현재 패널 경로를 cwd로 터미널을 연다
- [x] `wt.exe -d`가 있으면 Windows Terminal로, 없으면 `powershell.exe -NoExit`로 폴백해 열린다
- [x] 파일 항목·드라이브 목록(내 PC)에는 "터미널 열기"가 비활성 또는 미표시된다
- [x] 경로 검증(정규화·`..` 이탈 차단·존재·stat 디렉토리 검증)을 통과하지 못한 경로는 터미널을 실행하지 않고 사유가 안내된다(ADR-005)
- [x] 경로는 `execFile` 인자 배열로 전달되어 셸 메타문자가 포함된 폴더명에도 명령 주입이 발생하지 않는다(셸 경유 없음)

### H5. 디렉토리 경로 직접 입력 (S) ✅ 구현 완료 — `PanelToolbar.tsx` 단일클릭 편집 진입(`closest('button')` 가드로 브레드크럼 버튼 클릭과 분리), 기존 `Ctrl+L`·더블클릭·`validateAndNavigate` 재사용
**목적**: 브레드크럼 탐색만으로 도달하기 번거로운 위치(긴 경로·붙여넣은 경로)로 즉시 이동하도록, 주소 표시줄에 경로를 직접 타이핑/붙여넣어 이동한다. C1 주소 표시줄의 "클릭/`Ctrl+L`로 편집 모드"를 **단일 클릭 진입**까지 구체화한다. (US-7.5)

| 항목 | 동작 규칙 |
|---|---|
| 편집 모드 진입 | 주소(브레드크럼) 영역 **단일 클릭** 시 편집 모드로 전환되어 **전체 경로 텍스트**가 채워진 입력란이 된다(탐색기식·확정). 기존 `Ctrl+L`·더블클릭 진입도 유지 |
| 텍스트 상태 | 진입 시 전체 경로가 선택(전체 선택)되어 바로 덮어쓰기·붙여넣기 가능 |
| 이동 | **Enter** = 입력 경로로 이동. **Esc** = 편집 취소(원래 브레드크럼·경로 복귀) |
| 잘못된 경로 | 존재하지 않거나 형식이 잘못된 경로는 **인라인 오류** 표시 후 이동하지 않는다(편집 모드 유지). 기존 `validateAndNavigate` 재사용 |
| 적용 대상 | 활성 패널의 주소 표시줄. 입력은 활성 패널 경로만 바꾼다 |
| 원격 패널일 때 경로-only 입력 (M3 교차) | **(2026-06-09 추가)** 활성 패널이 **원격(SFTP/FTP·§M3)** 일 때는, 주소 입력부가 **호스트(`sftp://host`)를 고정 프리픽스로 표시**하고 사용자는 **경로만(`/mnt/sub`)** 입력하면 된다. 입력한 경로는 **현재 호스트와 결합**해 이동한다. (방어적: 사용자가 전체 URI(`sftp://host/path`)를 그대로 넣어도 처리한다.) **로컬 패널의 경로 입력 동작은 불변**(전체 로컬 경로 입력). |
| 기존 정합 | C1·US-3.1의 경로 입력 동작을 진입 방식만 확장(단일 클릭). 검증 로직(`validateAndNavigate`)·인라인 오류는 기존 것을 재사용, 신규 단축키 불요 |

**수용 기준** (✅ 구현 — `PanelToolbar.tsx` 단일클릭 편집·`validateAndNavigate` 재사용)
- [x] 주소 표시줄을 단일 클릭하면 편집 모드로 전환되고 전체 경로 텍스트가 입력란에 채워진다
- [x] 기존 `Ctrl+L`·더블클릭으로도 동일하게 편집 모드에 진입한다
- [x] Enter로 입력 경로로 이동하고, Esc로 편집을 취소해 원래 표시로 복귀한다
- [x] 잘못된/존재하지 않는 경로는 인라인 오류로 안내되고 이동하지 않으며 편집 모드가 유지된다(`validateAndNavigate` 재사용)
- [x] 클립보드 경로를 붙여넣어 Enter로 즉시 이동할 수 있다
- [x] 입력은 활성 패널 경로만 변경한다(다른 패널·탭에 영향 없음)
- [x] **(2026-06-09 추가) 원격(M3) 패널에서는 호스트(`sftp://host`)가 고정 프리픽스로 표시되고 경로만(`/mnt/sub`) 입력하면 현재 호스트와 결합해 이동한다. 사용자가 전체 URI를 그대로 입력해도 정상 처리되며(방어적), 로컬 패널의 경로 입력 동작은 불변이다** — `verify:remote-route` 47. ※ 실 GUI(원격 주소 경로-only 입력·이동) 런타임 스모크 권장 🟡

### H6. 파일 유형별 아이콘 (S) ✅ 구현 완료 — 예약 채널 `shell:icon` 정식 구현: `os/icon.ts`(`getFileIconDataUrl`·`cacheKeyFor`·LRU512·실패 비캐싱)·`shell.handlers.ts`(SHELL_ICON)·`iconCache.ts`(`iconKeyFor`·`iconRequestFor`·디듀프·구독)·`usecases/icons.ts`·`FileListView.tsx OSIcon`. 확장자 단위 캐시·per-file(exe/lnk 등) path 키. ※ 네이티브 `app.getFileIcon` 실제 실행은 런타임 스모크 권장
**목적**: 목록에서 항목 유형을 한눈에 식별하도록, 각 파일을 유형에 맞는 아이콘으로 표시한다. B1의 "아이콘은 OS 시스템 아이콘/연결 프로그램 아이콘 사용" 원칙을 **실제 구현**으로 정식화한다. (US-7.6)

> **shell:icon 예약→구현(드리프트 해소)**: 시스템 아이콘 채널 `shell:icon(req:{path|ext}) -> {dataUrl}`은 **P1에서 계약 동결**되었고(system-architecture §IPC), IPC DTO는 `iconRef`로 지연 로드하도록 설계됐으나(software-architecture: "화면 진입 행만 `shell:icon` 요청+캐시") **호출부가 없어 의도적으로 미구현 상태로 예약**돼 있었다(qa-integration: "shell:icon — 의도된 미구현, 호출부 없음"). 본 H6이 그 **예약된 채널을 정식 구현(호출부 추가)** 하여 예약→구현으로 드리프트를 해소했다 — 계약·보안·캐시 설계를 변경하지 않고 따른다.

| 항목 | 동작 규칙 |
|---|---|
| 아이콘 소스 | **OS 실제 파일 아이콘**(연결 프로그램/시스템 아이콘)을 `shell:icon` 채널로 받아 표시 |
| 폴더/드라이브 | 폴더·드라이브는 적절한 폴더/드라이브 아이콘으로 표시 |
| 폴백 | 아이콘을 해석할 수 없는 형식·실패 시 일반(기본) 파일 아이콘으로 폴백(빈칸·깨진 이미지 금지) |
| 캐시 단위 | **확장자 단위 캐시**(같은 확장자는 1회 조회 후 재사용). 폴더/드라이브 등 특수 항목은 종류 단위 캐시 |
| 지연 로드 | 가상 스크롤과 정합하도록 **화면에 진입한 행만 아이콘 요청**(`iconRef` 지연). 스크롤 아웃 항목은 요청하지 않는다 |
| 성능 | 1만 개 항목 목록에서도 첫 렌더가 막히지 않는다 — 아이콘은 비동기로 채워지고(없는 동안 폴백 표시), 확장자 캐시로 중복 조회를 제거해 동일 확장자 N개라도 조회는 1회. 캐시는 메모리 상한 적용(PRD 7장 lazy/캐시) |
| 보안 | `shell:icon`은 경로/확장자 입력을 검증하고(ADR-005 양단 검증), dataUrl만 반환(임의 코드 실행 표면 없음) |

**수용 기준** (✅ 구현 — `os/icon.ts`·`iconCache.ts`·`OSIcon`; ※ 네이티브 실행 런타임 스모크 권장)
- [x] 파일 목록 각 항목이 유형(확장자)에 맞는 OS 실제 아이콘으로 표시된다(`shell:icon`→`dataUrl`·`OSIcon`)
- [x] 폴더·드라이브는 적절한 폴더/드라이브 아이콘으로 표시된다
- [x] 아이콘을 해석할 수 없는 형식·조회 실패 시 일반 파일 아이콘으로 폴백된다(빈칸/깨진 이미지 없음·실패 비캐싱)
- [x] 같은 확장자 항목은 아이콘을 1회만 조회해 재사용한다(`cacheKeyFor`/`iconKeyFor` 확장자 단위 캐시·LRU512)
- [x] 화면에 보이는 행만 아이콘을 요청하고(가상 스크롤 `iconRef` 지연·디듀프), 1만 개 항목 목록에서도 첫 렌더가 아이콘 로딩으로 막히지 않는다(아이콘은 비동기로 채워짐)
- [x] `shell:icon` 입력 검증을 통과한 경로/확장자에만 응답하며 dataUrl 외 실행 표면을 추가하지 않는다(ADR-005)

---

## I. 분석·시각화 / 접근성 테마

> 기존 영역이 "파일을 다루는 동작"이었다면, I장은 **디스크 사용 현황을 한눈에 파악(분석·시각화)** 하고 **눈 피로를 줄이는 접근성 테마**를 더해 제품의 부가가치·접근성을 높이는 영역이다.
> 새로운 파일시스템 *조작*을 추가하지 않으며(읽기 전용 스캔 + 표시 설정), 핵심 가치(다중 디렉토리 작업)와 독립적이나 사용 만족도를 높이는 개선이다.
> 2026-06-07 사용자 요청으로 정식 편입. 우선순위는 모두 **S(Should)** — 부가가치(대시보드)·접근성(저청색광 테마) 개선으로, MVP/Must와 독립적이다.
> 차트는 **recharts**(React 차트 라이브러리, MIT 라이선스)를 사용한다. 단축키는 [PRD.md 8장](./PRD.md#8-단축키-체계-확정--충돌-없음)이 단일 출처다. 범례: ✅ 구현 완료 · 🟡 부분 · 🔜 미착수.
> **[2026-06-07 편입·구현 완료 ✅] feat-I1 디렉토리 사용량 대시보드·feat-I2 블루라이트(청색광) 차단 테마** 2기능을 정식 편입·구현·QA PASS(US-8.1·8.2). I1은 **신규 채널 `analyze:scan:*` 5종**(scanEngine 재귀 집계·Top10 힙·순환 차단·취소·truncated)·디스크 요약은 기존 `DriveDTO`+`diskSpace()` 재사용·recharts(MIT, lazy 청크)로 구현. I2는 `BLUELIGHT_PALETTE`(#FBF0D9)·`ThemeMode` 4종 확장으로 구현. **파일 유형별 비중 인사이트는 "(가능하면)" 선택항이라 미구현 🔜. 네이티브 statfs·대용량 스캔 성능 실측은 런타임 스모크 권장.** 상세 [roadmap.md §0.5 "신규 분석·접근성(I장)"](./roadmap.md).

### I1. 디렉토리 사용량 대시보드 (S) ✅ 구현 완료 — 신규 채널 `analyze:scan:*`(`channels.ts`·`contracts.ts`·`dto ScanResult/ScanEntry`)·`src/main/operations/scanEngine.ts`(재귀 집계·Top10 힙·순환 realpath Set·skipped·취소·truncated)·`src/main/workers/scanWorker.ts`·`scanProtocol.ts`(SharedArrayBuffer 취소)·`ScanManager.ts`(scanId·200ms 스로틀)·`analyze.handlers.ts`(guardPath·디렉토리 검증). frontend: `analyzeSlice.ts`·`usecases/dashboard.ts`·`ui/dashboard/DashboardModal.tsx`(+`DashboardModalBody` React.lazy)·recharts 도넛/막대+표·`uiSlice.showDashboardOnStartup`(기본 켜짐)·SettingsDialog 토글. ※ 파일 유형별 비중 인사이트 미구현(선택항)·네이티브 statfs/대용량 스캔 성능은 런타임 스모크 권장
**목적**: 디스크 어디가 차 있는지·무엇이 용량을 많이 쓰는지를 모달 대시보드에서 표·차트로 즉시 파악한다. 파워유저(P1)·개발자(P2)가 정리 우선순위를 빠르게 정하도록 돕는다. (US-8.1)

| 항목 | 동작 규칙 |
|---|---|
| 진입점 | ① 상단 아이콘바 **④도구 그룹**의 "사용량 대시보드" 아이콘 클릭으로 모달 오픈, ② **프로그램 실행 시 자동 팝업**(설정 "시작 시 대시보드 표시"가 켜져 있을 때만 — 기본 켜짐) |
| 모달 구성 | 모달 대시보드로 표시(메인 탐색 화면 위 오버레이). 닫기(`Esc`·닫기 버튼)로 즉시 탐색 화면 복귀. 모달 동안에도 백그라운드 스캔은 비차단 |
| 디스크별 사용량(즉시) | 각 드라이브의 **총/사용/여유 용량**을 **즉시 표시**(드라이브 메타만 조회 — 별도 스캔 불요). **도넛 차트 + 표** 병행 표시 |
| 용량 Top10(온디맨드) | 선택한 **폴더 또는 드라이브**를 스캔해 **용량 상위 10개(폴더/파일)** 를 **막대 차트 + 표**로 표시. **확정: 디스크 요약은 즉시, Top10은 대상을 골라 온디맨드로 스캔**(자동 전체 스캔 안 함). 스캔은 **진행률 표시·취소 지원** |
| 인사이트 | 선택 드라이브/폴더의 **여유 공간 %**, **가장 큰 폴더(Top1)** 를 요약 카드로 표시. ~~(가능하면) **파일 유형별 비중**(확장자 그룹별 용량 비율)~~ → **feat-K3(§K3)로 정식화·이관**(선택항 "(가능하면)"을 정식 Should 기능으로 승격) |
| 차트 | recharts(MIT) — 도넛(드라이브 사용률)·막대(Top10). 차트 옆 동일 데이터를 표로도 제공(스크린리더·정밀 수치 확인용) |
| 스캔 성능(비차단) | Top10 스캔은 **메인(렌더) 스레드를 막지 않는 백그라운드 처리**. 수십만 파일 규모에서도 진행률이 주기적으로 갱신되고, 스캔 중에도 모달 닫기·탐색이 가능하다 |
| 스캔 취소 | 스캔 중 **취소 버튼**으로 즉시 중단. 취소 시 부분 집계까지만 반영(또는 직전 결과 유지)하고 사유를 안내. 새 대상 선택 시 진행 중 스캔은 취소·교체 |
| 보안/안정(권한 거부) | 스캔 중 **권한 없는 경로**는 건너뛰고 사유를 집계 요약에 누적(전체 스캔 중단 안 함). 합계는 "접근 불가 영역 제외" 또는 그에 준하는 표기 |
| 보안/안정(심볼릭/정션 링크) | **심볼릭/정션 링크는 따라가지 않거나 방문 집합으로 순환을 차단**해 무한 재귀·중복 집계를 방지(F장 "심볼릭/정션 링크 순환 방지" 규칙 준수). 이미 방문한 실경로는 재집계하지 않는다 |
| 자동 팝업 토글 | 설정에 **"시작 시 대시보드 표시"** 토글 제공(**기본 켜짐**). 끄면 실행 시 자동 팝업하지 않고 아이콘바 클릭으로만 연다. 자동 팝업 모달 안에도 "다음부터 표시 안 함" 빠른 끄기 동선 제공(설정 토글과 동기화) |
| 데이터 갱신 | 디스크 요약은 모달 오픈 시 갱신. Top10은 스캔 완료 시점 스냅샷이며 "다시 스캔" 동작으로 갱신 |

**수용 기준** (✅ 구현 — `analyze:scan:*`·`scanEngine.ts`·`DashboardModal.tsx`·`analyzeSlice.ts`; ※ 파일 유형별 비중은 feat-K3(§K3)로 정식 구현 완료 ✅·네이티브 성능 실측 런타임 스모크 권장)
- [x] 아이콘바 ④도구 그룹의 "사용량 대시보드" 아이콘 클릭으로 모달 대시보드가 열리고, `Esc`·닫기 버튼으로 닫혀 탐색 화면으로 복귀한다
- [x] 모달 오픈 즉시 각 드라이브의 총/사용/여유 용량이 **도넛 차트 + 표**로 표시된다(별도 스캔 없이 드라이브 메타만으로 즉시 — 기존 `DriveDTO.totalBytes/freeBytes`+`diskSpace()`)
- [x] 폴더 또는 드라이브를 선택해 "스캔"하면 용량 상위 10개(폴더/파일)가 **막대 차트 + 표**로 표시된다(자동 전체 스캔이 아니라 온디맨드 — `analyze:scan:start`→`ScanResult.topFolders/topFiles`)
- [x] 여유 공간 %·가장 큰 폴더(Top1) 인사이트가 요약 카드로 표시된다. **(가능 시) 파일 유형별 비중은 선택항이었으나 → feat-K3(§K3·US-10.3)로 정식화·구현 완료 ✅**(`categorize.ts`·`scanEngine.ts` byCategory·`CategoryBar.tsx`로 본 대시보드에 카테고리별 비중 차트+표 표시)
- [x] **(성능·비차단)** Top10 스캔은 백그라운드(워커)에서 처리되어 메인 UI를 막지 않으며, 진행률이 200ms 스로틀로 주기 갱신되고 스캔 중에도 모달 닫기·탐색이 가능하다(`scanWorker.ts`·`ScanManager` 푸시). ※ 수십만 파일 실측 성능은 런타임 스모크 권장
- [x] **(취소)** 스캔 중 취소 버튼으로 즉시 중단되며(`analyze:scan:cancel`·SharedArrayBuffer 협조 폴링), 취소 시 부분 집계까지만 반영(`canceled=true`)하고 사유가 안내된다(새 대상 선택 시 진행 중 스캔도 취소·교체)
- [x] **(보안/안정 — 권한 거부)** 스캔 중 권한 없는 경로는 건너뛰고 `skipped` 카운트에 누적되며 전체 스캔은 중단되지 않는다(verify:scan 통과)
- [x] **(보안/안정 — 링크 순환)** 심볼릭/정션 링크는 방문 실경로(realpath) Set으로 순환을 차단해 무한 재귀·중복 집계가 발생하지 않는다(verify:scan "순환에도 1회만 집계" 통과)
- [x] **(자동 팝업 토글)** 설정 "시작 시 대시보드 표시"는 **기본 켜짐**(`uiSlice.showDashboardOnStartup=true`)이며, 켜져 있으면 실행 시 자동 팝업(`App.tsx`)하고 끄면 아이콘바 클릭으로만 열린다(설정 토글 동기화)
- [x] 디스크 요약·Top10 차트 옆에 동일 데이터의 표가 제공되어 정밀 수치 확인과 스크린리더 접근이 가능하다

### I2. 블루라이트(청색광) 차단 테마 (S) ✅ 구현 완료 — `ui/theme/palette.ts BLUELIGHT_PALETTE`(13토큰·#FBF0D9)·`applyTheme.ts ResolvedTheme` 확장(bluelight 독립 resolved)·`ThemeMode` 4종·`defaults.ts THEME_MODES`/`guard.ts zThemeMode` 화이트리스트·SettingsDialog 4종 선택. `toggleThemeMode`는 light↔dark 유지. WCAG AA 통과(본문 11.04:1·muted 5.25:1). 신규 채널 0
**목적**: 장시간 사용 시 눈 피로를 줄이도록, 기존 라이트/다크/시스템에 더해 **따뜻한 크림색(#FBF0D9)을 기본 배경으로 하는 저청색광 테마**를 추가한다. (US-8.2)

> E2(다크/라이트 테마)·US-5.3의 테마 선택지를 **확장**하는 항목이다. 기존 테마 동작·수용 기준은 변경하지 않고 선택지 1종을 추가한다.

| 항목 | 동작 규칙 |
|---|---|
| 선택지 추가 | 기존 **라이트 / 다크 / 시스템 따름**에 **"블루라이트 차단(저청색광)"** 을 추가해 4종으로 확장. 설정(E6)에서 선택 |
| 기본 배경색 | **#FBF0D9(따뜻한 크림색)** 를 기본 배경으로 한다. 전경(텍스트)·강조·구분선 등 토큰은 청색광이 적은 따뜻한 톤으로 정의 |
| 즉시 적용 | 선택 시 재시작 없이 **즉시 전체 화면에 적용**(기존 테마 전환과 동일). 선택은 세션/설정에 영속 |
| 대비(접근성) | 본문 텍스트는 배경(#FBF0D9) 대비 **WCAG AA(일반 텍스트 4.5:1) 이상**을 지향한다. 강조·비활성·선택 상태도 식별 가능한 대비를 유지 |
| 아이콘바 토글 정합 | 아이콘바 ④도구 그룹의 테마 토글은 라이트↔다크 즉시 전환(기존 H1)이며, 블루라이트 차단을 포함한 4종 선택은 설정에서 한다(토글 ≠ 전체 순환 — 기존 동작 유지) |
| 기존 정합 | 테마 토큰 체계를 재사용해 테마 1종 추가로 구현. 새 단축키·새 채널 불요 |

**수용 기준** (✅ 구현 — `BLUELIGHT_PALETTE`·`applyTheme.ts`·`THEME_MODES`/`zThemeMode`)
- [x] 설정에서 테마로 **라이트/다크/시스템/블루라이트 차단** 4종 중 하나를 선택할 수 있다(`ThemeMode` 4종·SettingsDialog)
- [x] 블루라이트 차단 테마는 **#FBF0D9(따뜻한 크림색)** 를 기본 배경으로 사용한다(`BLUELIGHT_PALETTE`)
- [x] 테마 선택이 재시작 없이 즉시 전체 화면에 적용되고, 선택이 설정/세션에 영속되어 재시작 후 유지된다(`defaults.ts THEME_MODES` 화이트리스트 재수화)
- [x] **(대비)** 블루라이트 차단 테마에서 본문 텍스트가 배경 대비 WCAG AA(4.5:1) 이상을 지향하며(본문 11.04:1·muted 5.25:1 측정), 강조·비활성·선택 상태도 식별 가능한 대비를 유지한다
- [x] 기존 라이트/다크/시스템 테마의 동작과 수용 기준은 변경 없이 그대로 유지된다(선택지 1종 추가·`toggleThemeMode`는 light↔dark 유지)

---

## J. 탐색기 보기 · 실시간 갱신 · 뷰어 확장 · 브랜딩

> 2026-06-07 사용자 요청 8건 중 **신규 7건**을 정식 편입하는 영역이다(나머지 1건 = F5/F6 제거는 §A3·§E1 정정).
> 기존 보기(B1)·미리보기(D3)·분할 크기조절(H3)·즐겨찾기(C4)를 **Windows 탐색기 수준의 보기·실시간성·뷰어 경험**으로 확장하고, 제품 브랜딩을 **AGT-Finder**로 전환한다.
> 우선순위는 PRD §6 MoSCoW를 단일 출처로 따른다(대부분 Should — feat-J4 브랜딩만 Must for 릴리스). 단축키는 [PRD.md 8장](./PRD.md#8-단축키-체계-확정--충돌-없음)이 단일 출처다.
> **[2026-06-07 상태] 구현 완료 ✅** — team-dev 구현·QA PASS. 신규 의존성 highlight.js(BSD-3)·marked(MIT)·dompurify(MPL-2.0, 마크다운 새니타이즈)는 lazy 청크 분리, 파일시스템 워처는 신규 채널 `fs:watch:*`(non-recursive·디바운스·격리). **J2(US-9.2)는 정렬/필터 유지·디바운스·격리·경로 교체·선택/스크롤 보존·UNC 폴링 폴백 모두 충족으로 🟡→✅ 격상**(보류 2건 구현 완료) 후, **매핑 네트워크 드라이브(`X:\`)도 `GetDriveType` 연동(`os/driveType.ts` PowerShell CIM `Win32_LogicalDisk DriveType=4`·`paths.isNetworkDriveRoot`)으로 eager 폴링 적용되어 ✅ 격상**(신규 npm 의존성·신규 IPC 채널 0). **잔여 한계(정직 표기): `subst`·일부 클라우드 드라이브(`DriveType≠4`)는 미포함 → reactive 폴백 유지.** 범례: ✅ 구현 완료 · 🟡 부분 · 🔜 미착수.

### J1. 파일 드래그 박스 선택(러버밴드) (S) ✅ 구현 완료 — `domain/rules/boxSelect.ts`(사각형 교차 판정 순수함수)·`app/stores/selectionSlice.ts#boxSelect`(교체/누적/범위)·`FileListView`(러버밴드 오버레이·경계 자동 스크롤·가상 스크롤 마운트 항목 포함). ※ 실제 마우스 드래그·자동 스크롤은 런타임 DOM 의존 → 런타임 스모크 권장
**목적**: 파일 목록 빈 영역에서 마우스 드래그로 사각형(러버밴드)을 그려 그 안에 들어온 항목을 한 번에 다중 선택한다. E3 "마우스 박스 선택"과 roadmap P2 DoD의 박스 다중선택(후속으로 남아 있던 항목)을 **정식 기능화**한다. (US-9.1)

> roadmap P2 DoD는 "`Ctrl/Shift/박스/Ctrl+A` 다중 선택"을 들었으나, PRD §6 Must는 박스 선택을 "후속"으로 표기(`*(박스 선택은 후속, Ctrl/Shift 구현)*`)했다. 본 J1이 그 후속 박스 선택을 정식 Should 기능으로 확정한다.

| 항목 | 동작 규칙 |
|---|---|
| 진입 | 파일 목록 **빈 영역**(항목이 없는 공간)에서 마우스 좌버튼 누름→드래그로 러버밴드 시작. 항목 위에서 시작한 드래그는 D&D(A3)로 처리되어 충돌하지 않는다 |
| 선택 판정 | 러버밴드 사각형과 **교차(겹침)** 하는 항목을 선택 대상으로 한다(완전 포함이 아니라 교차 기준 — 탐색기 관례) |
| 실시간 반영 | 드래그 중 사각형 변화에 따라 선택 집합이 **실시간 갱신**된다. 마우스 놓으면 확정 |
| 수정키 조합 | 기본 드래그=새 선택으로 교체. **`Ctrl`+드래그=기존 선택에 추가(토글 누적)**, **`Shift`+드래그=범위 확장**. 수정키 없는 드래그는 기존 선택을 비우고 새로 잡는다 |
| 스크롤 중 선택 | 러버밴드를 목록 위/아래 경계로 끌면 **자동 스크롤**되며, 스크롤로 새로 보이는(가상 스크롤로 마운트되는) 항목도 사각형에 들면 선택에 포함된다 |
| 보기 모드 정합 | 상세/목록(1차원 행)·아이콘 그리드(2차원, J3) 모두에서 동작한다. 그리드에서는 2차원 사각형 교차로 판정 |
| 상태바 정합 | 선택 개수·합계 용량이 드래그 종료 시 상태바(E5)에 반영된다 |

**수용 기준** (✅ 구현 — `boxSelect.ts`·`selectionSlice.boxSelect`·`FileListView`)
- [x] 파일 목록 빈 영역에서 드래그하면 러버밴드 사각형이 그려지고, 사각형과 교차하는 항목이 선택된다
- [x] 항목 위에서 시작한 드래그는 D&D로 처리되어 러버밴드가 시작되지 않는다(충돌 없음)
- [x] 드래그 중 사각형 변화에 따라 선택 집합이 실시간으로 갱신되고, 마우스를 놓으면 확정된다
- [x] `Ctrl`+드래그는 기존 선택에 누적, `Shift`+드래그는 범위 확장, 수정키 없는 드래그는 새 선택으로 교체된다
- [x] 러버밴드를 목록 경계로 끌면 자동 스크롤되며, 스크롤로 새로 보이는 항목도 사각형에 들면 선택된다(가상 스크롤 정합)
- [x] 상세/목록·아이콘 그리드(J3) 모든 보기에서 동작하며, 선택 개수·합계 용량이 상태바에 반영된다

### J2. 좌/우 패널 실시간 갱신(파일시스템 워처) (S) ✅ 구현 완료 — 신규 채널 `fs:watch:start/event/stop/error`·`src/main/fs/WatchService.ts`(non-recursive `fs.watch`·디바운스 병합·권한/네트워크/미지원 격리 throw 0 + **UNC + 매핑 네트워크 드라이브 eager 폴링·reactive fs.watch error 폴백·4s readdir diff·stat 승계·pollBusy 재진입 가드·>20k 항목 비활성·stop 정리·미지 고정 드라이브 lazy refresh trigger**)·`src/main/os/driveType.ts`(`DriveTypeService` — PowerShell CIM `Win32_LogicalDisk DriveType=4`=`DRIVE_REMOTE` execFile 조회·네트워크 드라이브 문자 캐시 원자 Set 교체·throttle·재진입 가드·빈집합 폴백·헤드리스 주입)·`src/main/fs/paths.ts`(`isUncPath`·`isNetworkDriveRoot`(캐시 조회)·`isLikelyRemotePath`)·`watch.handlers.ts`·`main/index.ts`(부팅 non-blocking refresh)·`app/usecases/watchBridge.ts`(watchId 상관·경로 교체 시 이전 감시 해제·리소스 정리·onEvent→`softRefresh`)·`app/stores/panelsSlice.ts`(`softRefresh`·`capturePreserve`·`_applyPreserve`·`pendingScrollRestore`·navigate `resetSelection`)·`selectionSlice.setSelection`·`FileListView`(1회성 스크롤 복원). **정렬/필터/검색 유지·디바운스·대량 폴백·예외 정리·경로 교체 누수 없음·선택/스크롤 보존·UNC + 매핑 네트워크 드라이브 폴링 폴백 모두 충족 ✅. 잔여 한계(정직 표기): `subst`·일부 클라우드 드라이브(`DriveType≠4`)는 미포함 → reactive 폴백 유지(런타임 매핑 변경 시 첫 진입 reactive→차순 eager).** 신규 npm 의존성·신규 IPC 채널 0(PowerShell 시스템 내장·backend 내부). ※ 네이티브 워처 실제 이벤트는 런타임 스모크 권장
**목적**: 디스크의 파일 변경(생성·삭제·이름변경·이동)을 감지해 패널 목록을 **자동 갱신**한다. 사용자가 수동 새로고침(`Ctrl+R`) 없이도 좌/우(또는 N개) 패널이 항상 최신 상태를 보이게 한다. (US-9.2)

| 항목 | 동작 규칙 |
|---|---|
| 감시 대상 | **현재 열려 있는 각 패널의 폴더**(좌/우/4분할 모두). 패널이 다른 경로로 이동하면 워처도 그 경로로 교체(이전 경로 감시 해제) |
| 감지 이벤트 | 그 폴더 직속의 **생성·삭제·이름변경·수정(크기/수정일)·이동(들어옴/나감)** 을 감지해 해당 항목만 목록에 반영(전체 재읽기 최소화). 하위 폴더 재귀 감시는 하지 않음(현재 폴더 단위) |
| 정렬·필터·선택·스크롤 유지 | 자동 갱신 후에도 현재 정렬(B2)·검색/필터(D1·D2)·**선택·스크롤 위치를 보존**한다 ✅(사라진 항목은 선택 해제, 남은 선택·스크롤은 `softRefresh`/`pendingScrollRestore`로 유지). ※ 패널이 다른 경로로 navigate할 때는 잔존 선택을 의도적으로 비운다(`resetSelection`) |
| 디바운스(성능) | 짧은 시간 다발 변경(대량 복사·압축 해제 등)은 **디바운스(예: 100~300ms 합치기)** 로 묶어 1회 갱신한다. 대량 변경 시 개별 이벤트 폭주로 UI가 막히지 않는다(비차단) |
| 대량 변경 폴백 | 디바운스 윈도 내 변경이 임계치를 넘으면 개별 반영 대신 **그 폴더 1회 재읽기(re-list)** 로 폴백한다 |
| 예외 — 권한/삭제된 폴더 | 감시 중 폴더가 삭제·접근 불가가 되면 워처를 정리하고 패널에 사유 표시(F장 권한 규칙 준수). 오류로 앱이 중단되지 않는다 |
| 예외 — 네트워크 드라이브 | **네트워크/이동식 드라이브는 워처 신뢰성이 낮을 수 있다.** **UNC(`\\서버\공유`) + 매핑 네트워크 드라이브(`X:\`) 모두 eager 저빈도 폴링(4s readdir diff·stat 승계·>20k 비활성)으로 보완 ✅**, 로컬 경로라도 fs.watch 실패 시 reactive 폴링으로 폴백한다. **매핑 네트워크 드라이브는 `GetDriveType` 연동(`os/driveType.ts` PowerShell CIM `DriveType=4` 조회→문자 캐시·`paths.isNetworkDriveRoot`)으로 eager 폴링이 적용된다.** 잔여 한계: `subst`·일부 클라우드 드라이브(`DriveType≠4`)는 미포함 → reactive 폴백에만 의존(fs.watch 무에러·무신호 시 수동 새로고침 유지) |
| 리소스 정리 | 패널 닫힘·경로 이동·앱 종료 시 워처 핸들을 누수 없이 해제한다 |

**수용 기준** (✅ 구현 — `WatchService.ts`(UNC + 매핑 드라이브 eager + reactive 폴링)·`os/driveType.ts`(GetDriveType 연동)·`watchBridge.ts`·`fs:watch:*`·`panelsSlice`(softRefresh/보존)·`selectionSlice.setSelection`; `subst`·일부 클라우드 드라이브(`DriveType≠4`)만 미포함 한계)
- [x] 한 패널이 보고 있는 폴더에서 외부(다른 앱·다른 패널)로 파일을 생성/삭제/이름변경하면, 수동 새로고침 없이 그 패널 목록이 자동 반영된다(`fs:watch:event`→`softRefresh`)
- [x] 패널이 다른 경로로 이동하면 워처가 새 경로로 교체되고 이전 경로 감시가 해제된다(누수 없음·`watchBridge` 경로 교체·리소스 정리)
- [x] 자동 갱신 후에도 현재 정렬·필터·검색이 유지되고, 남아 있는 항목의 **선택·스크롤도 보존된다 ✅**(`softRefresh`·`capturePreserve`·`_applyPreserve`·`pendingScrollRestore` 1회성 복원). ※ navigate 시에는 잔존 선택을 의도적으로 비운다(`resetSelection`)
- [x] 대량 변경(다수 파일 동시 생성/삭제)에도 디바운스로 묶여 1회 갱신되며 UI가 막히지 않는다(WatchService 디바운스 병합·비차단)
- [x] 감시 중 폴더가 삭제·접근 불가가 되면 워처를 정리하고 패널에 사유를 표시하며 앱이 중단되지 않는다(권한/네트워크/미지원 throw 0 격리·`onError`)
- [x] 네트워크/이동식 드라이브에서 이벤트 누락 가능성에 대비한 폴링 폴백 — **UNC(`\\서버\공유`) + 매핑 네트워크 드라이브(`X:\`) 모두 ✅ 구현**(eager 폴링·4s readdir diff·stat 승계·pollBusy·>20k 비활성). 매핑 드라이브는 `GetDriveType` 연동(`os/driveType.ts` PowerShell CIM `Win32_LogicalDisk DriveType=4`=`DRIVE_REMOTE` 조회→문자 캐시·`paths.isNetworkDriveRoot` 동기 판정)으로 eager 폴링이 적용된다. **잔여 한계(정직 표기): `subst`·일부 클라우드 드라이브(`DriveType≠4`)는 미포함 → reactive 폴백 유지(런타임 매핑 변경 시 첫 진입 reactive→차순 eager)**
- [x] 좌/우(및 4분할) 패널이 각자 독립적으로 자기 폴더를 감시·갱신한다(한 패널 갱신이 다른 패널에 영향 없음·watchId 상관 격리)

### J3. Windows 표준 "보기" 5종 (S) ✅ 구현 완료 — `shared/dto ViewMode`(`'icons-large'|'icons-medium'|'icons-small'|'list'|'details'`)·`FileListView` 아이콘 그리드(H6 `OSIcon`/`shell:icon` 재사용·가상 스크롤)·`ui/toolbar/PanelToolbar.tsx` 보기 드롭다운·`panelsSlice` 패널별 기억·`defaults.ts VIEW_MODES` 화이트리스트
**목적**: Windows 탐색기의 "보기" 메뉴와 동등한 표준 보기 세트를 제공한다. 기존 상세(Details)·목록(List) 2종에 **아이콘 보기 3종(큰/보통/작은 아이콘 그리드)** 을 추가해 **총 5종**으로 확장한다. (US-9.3)

> B1(목록 보기)의 "그리드/썸네일(S)"·roadmap P6 잔여 "그리드/썸네일 보기 🔜"를 **Windows 표준 보기 세트로 구체화·확정**한다. 아이콘은 H6에서 구현한 **OS 실제 아이콘(`shell:icon`)** 을 그대로 활용한다(이미지 썸네일 자체 생성은 본 J3 범위 밖 — **feat-L1(§L)로 정식 편입**).

| 보기 | 내용 |
|---|---|
| 큰 아이콘 | 큰 OS 아이콘(`shell:icon`) 그리드 + 파일명. 가장 큰 아이콘 단계 |
| 보통 아이콘 | 중간 크기 아이콘 그리드 + 파일명 |
| 작은 아이콘 | 작은 아이콘 + 파일명(컴팩트 그리드) |
| 목록(List) (기존 M) | 작은 아이콘 + 이름, 세로 컴팩트 나열(다단 흐름) |
| 자세히(Details) (기존 M) | 이름·크기·형식·수정일 컬럼, 정렬·컬럼 폭조절 |

| 항목 | 동작 규칙 |
|---|---|
| 전환 진입점 | 상단 아이콘바(H1) ①레이아웃/뷰 그룹의 보기 전환 컨트롤 + 우클릭(컨텍스트 메뉴) "보기" 하위 메뉴. (단축키는 PRD 8장 결정 — 보기 메뉴/아이콘바 중심, 기존 키 충돌 없이 배정) |
| 아이콘 소스 | 아이콘 그리드 3종은 **H6의 OS 실제 아이콘(`shell:icon`)** 을 크기 단계만 달리해 사용. 이미지 파일도 J3 자체에서는 형식 아이콘(**이미지 썸네일 생성은 feat-L1(§L)로 정식 편입**) |
| 가상 스크롤 정합 | 아이콘 그리드도 **가상 스크롤**(ADR-004)로 렌더해 1만 개 항목에서도 첫 렌더가 막히지 않는다. 화면 진입 셀만 아이콘 요청(H6 `iconRef` 지연 재사용) |
| 상태 기억 | 보기 모드는 **패널별로 기억**(B1 원칙). 폴더별 기억은 Could |
| 박스 선택 정합 | 아이콘 그리드(2차원)에서도 J1 러버밴드 박스 선택이 사각형 교차로 동작한다 |

**수용 기준** (✅ 구현 — `ViewMode` 5종·`FileListView` 그리드·`PanelToolbar`)
- [x] 보기를 **큰 아이콘 / 보통 아이콘 / 작은 아이콘 / 목록 / 자세히** 5종 중 하나로 전환할 수 있다(아이콘바 + 우클릭 "보기")
- [x] 아이콘 그리드 3종은 H6의 OS 실제 아이콘(`shell:icon`)을 크기 단계만 달리해 표시한다
- [x] 아이콘 그리드도 가상 스크롤로 렌더되어 1만 개 항목에서 첫 렌더가 막히지 않고, 화면에 보이는 셀만 아이콘을 요청한다(`iconRef` 지연 재사용)
- [x] 보기 모드가 패널별로 기억되어 패널마다 다른 보기를 가질 수 있다
- [x] 아이콘 그리드에서도 J1 박스 선택이 사각형 교차로 동작한다
- [x] 기존 상세/목록 보기의 정렬·컬럼·동작은 변경 없이 유지된다

### J4. 브랜딩 변경 — "AGT-Finder" (M for 릴리스) ✅ 구현 완료 — `package.json`(name `agt-finder`)·`electron-builder.yml`(`appId: com.agtfinder.app`·`productName: AGT-Finder`)·`index.html`(`<title>AGT-Finder`)·`mainWindow.ts`·`main/index.ts`·`paths.ts`(userData 경로). 코드네임 "Explorer"는 내부(ExplorerApi 타입·주석)만 유지·사용자 노출 0 잔존. ※ exe/인스톨러 파일명·바로가기는 패키징 산출물 런타임 확인 권장
**목적**: 제품명을 **AGT-Finder**로 변경하고, 실행 파일·창 타이틀·인스톨러·앱 식별자 등 사용자가 보는 모든 브랜딩 표면을 일괄 교체한다. (US-9.4)

> 코드네임 "Explorer"는 개발 코드네임으로 남기되, **사용자 노출 제품명은 AGT-Finder**로 통일한다. 기존 G1 앱 아이콘/브랜딩과 연계되나, 본 J4는 **명칭(텍스트) 식별자 교체**에 집중한다(아이콘 자산 자체 변경은 선택).

| 항목 | 교체 대상 |
|---|---|
| 제품명(productName) | electron-builder `productName` → `AGT-Finder` |
| 앱 식별자(appId) | `appId`(예: `com.agt.finder` 류로 확정 — 설계 단계 결정) |
| 창 타이틀 | BrowserWindow 기본 타이틀·`<title>`·문서 제목 표기를 `AGT-Finder`로 |
| 실행 파일명 | 빌드 산출 실행 파일(.exe) 이름 → `AGT-Finder.exe` |
| 인스톨러 | NSIS 인스톨러 파일명·설치 마법사 표시명·**바로가기(시작 메뉴·바탕화면) 이름** → `AGT-Finder` |
| 패키지 메타 | `package.json` name/description 등 표기(배포에 노출되는 필드) |
| 문서 표기 | 기획 문서 본문의 사용자 노출 제품명 "Explorer" 표기를 `AGT-Finder`로 갱신(코드네임 표기는 유지 가능) |

> **체크리스트(브랜딩 — 수용 기준 겸용)**: 아래는 코드/패키징 변경 체크리스트이며 그대로 수용 기준으로 쓴다.

**수용 기준(브랜딩 체크리스트)** (✅ 구현 — appId `com.agtfinder.app`)
- [x] electron-builder `productName`이 `AGT-Finder`로 설정된다
- [x] `appId`가 AGT-Finder용 식별자로 변경된다(확정값 `com.agtfinder.app`)
- [x] 앱 창 타이틀·`<title>`(문서 제목)이 `AGT-Finder`로 표시된다(`index.html`·`mainWindow.ts`)
- [~] 빌드 산출 실행 파일명이 `AGT-Finder.exe`(또는 그에 준함)로 생성된다 — `productName` 기준 생성. ※ 실제 산출 파일명은 패키징 런타임 확인 권장
- [~] NSIS 인스톨러 파일명·설치 마법사 표시명·시작 메뉴/바탕화면 바로가기 이름이 `AGT-Finder`다 — electron-builder 설정 기준. ※ 인스톨러 산출물 런타임 확인 권장
- [x] `package.json`·배포 메타의 사용자 노출 명칭이 `AGT-Finder`로 일관된다(name `agt-finder`·description)
- [x] 기획 문서 본문의 사용자 노출 제품명 표기가 `AGT-Finder`로 갱신된다(코드네임 "Explorer"는 개발용으로만 유지)
- [x] 설치→실행→제거 전 과정에서 사용자에게 노출되는 명칭이 모두 `AGT-Finder`로 일치한다(코드 노출 표면 잔존 "Explorer" 없음·내부 타입/주석만 유지)

### J5. 미리보기 2단 뷰어(정보 + 확장 뷰어) (S) ✅ 구현 완료 — `ui/preview/PreviewPanel.tsx`(상단 `PreviewInfoCard`+하단 뷰어 2단)·`renderers/CodePreview.tsx`(**highlight.js** 언어 감지 강조)·`renderers/MarkdownPreview.tsx`(**marked**+**DOMPurify** 새니타이즈)·기존 Image/Text/Meta/Unsupported 폴백·`FileSystemService.readPreview`(lang/isMarkdown 판별). 기존 `preview:read`·`Ctrl+P` 재사용. 신규 의존성 highlight.js(BSD-3)·marked(MIT)·dompurify(MPL-2.0)·lazy 청크 분리·CSP eval 0
**목적**: 기존 미리보기 패널(D3)을 **상하 2단 구성**으로 확장한다. 상단=선택 파일의 정보(이름·크기·형식·수정일 등), 하단=실제 내용 뷰어. 뷰어는 **확장 세트**로 이미지·텍스트·**코드 구문 강조**·추가 형식(마크다운 등)을 지원하고, 미지원은 메타/아이콘으로 폴백한다. (US-9.5)

> D3(미리보기 패널, ✅ `preview:read`)을 확장하는 항목이다. 기존 `preview:read` 채널·`PreviewPanel`·형식별 렌더러를 재사용·확장한다(신규 의존성: 코드 구문 강조 라이브러리 — 설계 단계 선정, 라이선스·번들은 lazy 청크 권장).

| 영역 | 내용 |
|---|---|
| 상단 — 파일 정보 | 선택 항목의 **이름·크기·형식(확장자/MIME)·수정일·생성일·경로** 등 메타를 표 형태로 표시. 다중 선택 시 개수·합계 용량 요약 |
| 하단 — 뷰어 | 형식에 맞는 렌더러로 내용 표시(아래 지원 형식) |
| 2단 비율 | 상단 정보/하단 뷰어의 높이 비율을 둘 수 있다(기본값 고정, 조절은 Could). J6은 패널 **폭** 조절(별개 축) |

**지원 형식(확장 뷰어)**
| 형식 | 표시 |
|---|---|
| 이미지 | 축소 미리보기(기존 D3) — png/jpg/gif/webp/svg 등 |
| 텍스트 | 앞부분 텍스트(기존 D3), 대용량은 일부만 로드(상한) |
| 코드(구문 강조) | 소스 코드 파일을 **언어 감지 후 구문 강조** 표시(확장자→언어 매핑). 라이브러리는 설계 단계 선정(lazy 로드) |
| 마크다운 | 렌더링된 마크다운(또는 원문+서식). 코드 블록은 구문 강조 |
| 미지원 | **메타 + 형식 아이콘 폴백**(빈 화면 금지) |

| 항목 | 동작 규칙 |
|---|---|
| 비차단 로드 | 뷰어 내용은 **비동기 로드**(대용량은 상한까지만), 로드 중 스피너·완료 후 표시. 미리보기 로드가 목록/탐색을 막지 않는다 |
| 토글·정합 | 기존 `Ctrl+P`(D3) 토글·`preview:read` 채널 재사용. 선택 변경 시 미리보기가 그 항목으로 갱신 |
| 보안 | 미리보기는 **읽기 전용**(코드 실행·임의 스크립트 실행 표면 없음). 마크다운/코드 렌더는 원문을 안전하게 표시(HTML 주입·원격 로드 차단, CSP 준수) |
| 성능 | 코드 강조·마크다운 렌더 라이브러리는 **lazy 청크**로 분리(메인 번들 비대화 방지 — recharts 선례 준수) |

**수용 기준** (✅ 구현 — `PreviewPanel`·`PreviewInfoCard`·`CodePreview`·`MarkdownPreview`)
- [x] 미리보기 패널이 상단(파일 정보)/하단(뷰어) 2단으로 표시된다(`PreviewInfoCard`+뷰어)
- [x] 상단에 선택 항목의 이름·크기·형식·수정일 등 메타가 표시되고, 다중 선택 시 개수·합계 용량이 요약된다
- [x] 이미지·텍스트·코드(구문 강조)·마크다운을 하단 뷰어로 표시한다(코드는 highlight.js 언어 감지 후 강조)
- [x] 미지원 형식은 메타 + 형식 아이콘으로 폴백된다(빈 화면 없음·`UnsupportedPreview`)
- [x] 뷰어 내용이 비동기로 로드되어(대용량은 상한까지) 목록/탐색을 막지 않으며, 선택 변경 시 그 항목으로 갱신된다
- [x] 기존 `Ctrl+P` 토글·`preview:read` 채널을 재사용한다(D3 동작 유지)
- [x] 미리보기는 읽기 전용이며 HTML 주입·원격 로드·코드 실행 표면을 추가하지 않는다(마크다운 DOMPurify 새니타이즈·CSP eval 0 준수)
- [x] 코드 강조·마크다운 렌더 라이브러리는 lazy 청크로 분리되어 메인 번들이 비대해지지 않는다(highlight.js·marked·dompurify lazy)

### J6. 미리보기 패널 폭 조절 (S) ✅ 구현 완료 — H3 `SplitDivider.tsx`·`splitMath.ts#ratioFromPoint` 재사용·`uiSlice.previewWidth`(클램프·기본 폭 복귀)·`usecases/session.ts` 직렬화·세션 영속(토글 off→on 후 폭 유지)
**목적**: 미리보기 패널(D3·J5)의 **폭**을 분할선 드래그로 조절한다. H3(분할 패널 크기조절)의 분할선·세션 영속 방식을 그대로 재사용한다. (US-9.6)

> H3는 *패널 간* 분할선 크기조절을, 본 J6은 *미리보기 패널과 본문 영역 사이* 분할선 크기조절을 다룬다(동일 메커니즘·다른 경계). J5의 2단 비율(상하 축)과 별개의 **가로(폭) 축**이다.

| 항목 | 동작 규칙 |
|---|---|
| 조절 | 미리보기 패널과 패널 영역 사이의 **분할선(드래그 핸들)** 을 드래그해 미리보기 패널 폭을 조절(H3 `SplitDivider`·`ratioFromPoint` 재사용) |
| 최소/최대 | 미리보기 패널·본문 영역 모두 **최소 폭 제약**(H3 클램프 방식). 제약 미만으로 끌리지 않음 |
| 균등/기본 복귀 | 분할선 **더블클릭** 시 기본 폭으로 복귀(H3 균등 복귀 방식 준용) |
| 세션 영속 | 조절한 미리보기 폭(비율)은 **재시작 후에도 유지**(H3 `splitRatios` 세션 영속 방식 재사용). 미리보기 토글 off 후 다시 켜도 마지막 폭 유지 |
| 배치 정합 | 미리보기가 우측 부착이면 가로 분할선, 하단 부착이면 세로 분할선(flows §4 배치 규칙 준수). 1차는 우측 부착 폭 조절 |

**수용 기준** (✅ 구현 — `SplitDivider` 재사용·`uiSlice.previewWidth` 영속)
- [x] 미리보기 패널과 본문 사이 분할선을 드래그하면 미리보기 패널 폭이 실시간으로 조절된다(H3 `SplitDivider`·`ratioFromPoint` 재사용)
- [x] 미리보기·본문 모두 최소 폭 제약 이하로 줄어들지 않는다(H3 클램프)
- [x] 분할선 더블클릭 시 기본 폭으로 복귀한다
- [x] 조절한 미리보기 폭이 세션에 저장되어 재시작 후에도 유지되고, 미리보기 토글 off→on 후에도 마지막 폭이 유지된다(`ui.previewWidth` 영속)
- [x] 기존 H3(패널 간 분할 크기조절)·미리보기 토글(`Ctrl+P`) 동작에 영향을 주지 않는다

### J7. 즐겨찾기 별칭(표시 이름) 변경 (S) ✅ 구현 완료 — `shared/dto SidebarSnapshot.favoriteLabels`·`sidebarSlice`(별칭 설정/초기화·basename 폴백)·`ui/sidebar/Sidebar.tsx` 인라인 편집(우클릭/`F2`·Enter 확정·Esc 취소)·`session.ts` 영속. 별칭은 표시 전용(경로 불변)
**목적**: 즐겨찾기에 등록한 항목의 **표시 이름(별칭)** 을 사용자가 변경할 수 있게 한다. 현재는 경로의 basename으로 고정되어 동명 폴더 구분·의미 부여가 어렵다. (US-9.7)

> C4(즐겨찾기) "이름 별칭 지정(S)"을 **정식 기능으로 구체화**한다. 별칭은 표시용이며 실제 경로는 변경하지 않는다.

| 항목 | 동작 규칙 |
|---|---|
| 별칭 설정 | 즐겨찾기 항목 우클릭 "이름 바꾸기"(또는 `F2`) → 인라인 편집으로 표시 이름 변경. Enter 확정·Esc 취소 |
| 표시 | 사이드바 즐겨찾기 섹션에 **별칭**을 표시(별칭 없으면 경로 basename 폴백). 툴팁/보조 텍스트로 실제 경로 확인 가능 |
| 경로 불변 | 별칭은 **표시 전용** — 실제 경로·이동 동작은 변하지 않는다(별칭을 바꿔도 같은 폴더로 이동) |
| 영속 | 별칭은 즐겨찾기 데이터(설정/세션)에 **영속**되어 재시작 후에도 유지된다. 별칭 초기화(기본 basename 복귀) 동작 제공 |
| 중복·빈값 | 빈 별칭은 basename 폴백으로 처리. 같은 별칭 중복은 허용(경로가 식별자이므로) |

**수용 기준** (✅ 구현 — `favoriteLabels`·`Sidebar` 인라인 편집)
- [x] 즐겨찾기 항목을 우클릭 "이름 바꾸기"(또는 `F2`)로 표시 이름(별칭)을 인라인 편집해 변경할 수 있다(Enter 확정·Esc 취소)
- [x] 사이드바 즐겨찾기에 별칭이 표시되고, 별칭이 없으면 경로 basename으로 폴백된다
- [x] 별칭은 표시 전용이며 실제 경로·이동 동작은 변하지 않는다(별칭을 바꿔도 같은 폴더로 이동)
- [x] 별칭이 설정/세션에 영속되어 재시작 후에도 유지되며, 기본 basename으로 초기화할 수 있다
- [x] 빈 별칭은 basename 폴백으로 처리되고, 같은 별칭 중복은 허용된다

---

## K. 되돌리기 · 휴지통 관리 · 유형별 비중 인사이트

> roadmap §0.5 "P6 미구현 잔여 🔜"로 남아 있던 **Should 잔여 3건**을 정식 편입하는 영역이다.
> feat-K1·feat-K2는 기존 P6 잔여(되돌리기·휴지통 관리 화면)의 **정식 편입·구체화**이고, feat-K3은 §I1 대시보드의 "(가능하면) 유형별 비중" **선택항을 정식 Should 기능으로 승격**한 것이다.
> 2026-06-07 사용자 요청으로 정식 편입·구현·QA PASS(team-dev). 우선순위는 모두 **S(Should)** — 핵심 가치(다중 디렉토리 작업)와 독립적이나 데이터 안전(되돌리기)·정리 효율(휴지통·유형별 비중)을 높이는 개선이다.
> 단축키는 [PRD.md 8장](./PRD.md#8-단축키-체계-확정--충돌-없음)이 단일 출처다(`Ctrl+Z`=되돌리기 — 기존 등록 키의 `notYet` 안내를 K1 `performUndo`로 정식 연결). K2 휴지통은 신규 채널 `trash:*` 3종(Windows Shell COM `recycleBin.ts`)·K1 undo 스택은 renderer 슬라이스+기존 `op:*`/`fsApi`/`trashApi` 재사용으로 구현됐다.
> 범례: ✅ 구현 완료 · 🟡 부분 · 🔜 미착수. **[2026-06-07 상태] feat-K1·K2·K3 모두 ✅ 구현 완료**(typecheck/lint 0·`verify:recyclebin` 37·`verify:store` 99·`verify:scan` 39·QA PASS). 구현 파일 매핑은 각 절 제목 옆 표기 및 [roadmap.md §0.5 "신규 되돌리기·휴지통·유형별 비중(K장)"](./roadmap.md) 참조.

### K1. 되돌리기 (`Ctrl+Z`) — 다단계 undo 스택 (S) ✅ 구현 완료 — `app/stores/undoSlice.ts`(스택 cap 50·`UndoEntry` 판별유니온)·`app/usecases/undo.ts`(`performUndo`·역연산·충돌 선검증·영구삭제 미push)·`commandBus.ts`(`file.undo`→`performUndo`·`notYet` 제거). ※ undo 역연산 네이티브 동작은 런타임 스모크 권장
**목적**: 파일 작업 실수를 빠르게 되돌려 데이터 안전을 높인다. 직전 파일 작업을 역연산해 원상복구하며, **다단계 undo 스택**으로 여러 작업을 거슬러 되돌릴 수 있다. B7(되돌리기)의 "범위·한계 명세 확정 필요"를 정식 확정한다. (US-10.1)

> **기존 P6 잔여의 정식 편입**: `Ctrl+Z`는 이미 키 등록되어 있으나 현재 `commandBus`에서 `notYet('되돌리기')` 안내만 한다(roadmap §0.5). 본 K1이 그 예약을 **실제 undo 동작으로 정식 연결**한다.

| 항목 | 동작 규칙 |
|---|---|
| 진입 | `Ctrl+Z`(이미 등록된 `file.undo` 키) 또는 아이콘바/메뉴 "되돌리기". 스택이 비어 있으면 비활성(흐림) 또는 "되돌릴 작업 없음" 안내 |
| undo 스택 | 파일 작업 실행 시마다 역연산 정보를 **다단계 스택**에 쌓는다. `Ctrl+Z` 1회 = 스택 최상단 1작업 되돌림. 연속 입력 시 차례로 거슬러 되돌린다 |
| 스택 깊이 | 스택 깊이에 **상한**(예: 최근 N=20개)을 둔다. 상한 초과 시 가장 오래된 항목부터 폐기. 다단계 깊이 값은 설계 단계 확정(권장 기본 20) |
| redo | **v1 제외(후속)**. `Ctrl+Y`/`Ctrl+Shift+Z` 등 redo는 본 K1 범위 밖(후속 기능으로 예약) |
| 작업 단위 | 다중 선택 일괄 작업(예: 10개 동시 이동)은 **1 undo 단위**로 묶어 한 번에 되돌린다(부분 되돌림 아님) |

**undo 가능/불가 작업 범위 (역연산 정의)**

| 원작업 | undo 동작(역연산) | 가능 여부 |
|---|---|---|
| 이름변경 | 원래 이름으로 되돌림(rename back) | ✅ 가능 |
| 새 폴더 생성 | 생성된 폴더 삭제(비어 있을 때 — 사용자가 내용 추가했으면 충돌 안전 규칙 적용) | ✅ 가능 |
| 새 파일 생성 | 생성된 파일 삭제 | ✅ 가능 |
| 이동(move) | 원래 위치로 다시 이동(move back) | ✅ 가능 |
| 복사/붙여넣기 | **생성된 사본 삭제**(원본은 그대로) | ✅ 가능 |
| 삭제(휴지통) | **휴지통에서 원래 위치로 복원**(feat-K2 휴지통 복원 로직 재사용) | ✅ 가능 |
| 영구 삭제(`Shift+Delete`) | 복원 수단 없음 → **되돌릴 수 없음** | ❌ 불가 → 안내 토스트("영구 삭제는 되돌릴 수 없습니다") |
| 외부(타 앱) 변경 | 본 앱 작업 이력이 아님 | ❌ 추적 대상 아님 |

**충돌·안전 규칙**
| 항목 | 규칙 |
|---|---|
| undo 충돌 | undo 역연산 시 **원위치에 동명 파일/폴더가 새로 생겼다면**(예: 이동 되돌릴 자리에 다른 파일 생김) **임의 덮어쓰기 금지** — 작업을 중단하고 사유를 안내한다(D4 충돌 안전 원칙 준수) |
| 영구삭제 안내 | 영구 삭제 직후 `Ctrl+Z` 시 되돌릴 수 없음을 **토스트로 안내**(스택에 영구삭제는 unundoable 마커로만 기록하거나 미적재) |
| 휴지통 복원 실패 | 휴지통에서 원본이 이미 비워졌거나 복원 위치 접근 불가 시 중단·사유 안내(앱 중단 없음) |
| 부분 실패 | 일괄 작업 undo 중 일부 실패 시 성공/실패 요약(D4 결과 요약 규칙 준수) |

**수용 기준** (✅ 구현 — `undoSlice.ts`·`undo.ts`·`commandBus.ts`)
- [x] `Ctrl+Z`(또는 메뉴/아이콘바 "되돌리기")로 직전 파일 작업이 역연산되어 원상복구된다(`notYet('되돌리기')`가 `performUndo()` 호출로 대체됨)
- [x] **다단계 undo 스택**이 동작해 `Ctrl+Z`를 연속 입력하면 여러 작업을 차례로 거슬러 되돌릴 수 있다(`UNDO_STACK_CAP=50` 상한, 초과 시 오래된 항목 `shift` 폐기)
- [x] 이름변경·새 폴더/파일 생성·이동·복사/붙여넣기가 각 역연산(rename↔rename·생성물→휴지통·원위치 역move·사본→휴지통)으로 되돌려진다
- [x] 삭제(휴지통)는 **휴지통에서 원래 위치로 복원**되어 되돌려진다(`trashApi.restore` — feat-K2 복원 로직 재사용)
- [x] **영구 삭제(`Shift+Delete`)는 되돌릴 수 없으며**, undo 스택에 push되지 않고 시도 시 "되돌릴 수 없음" 안내 토스트가 표시된다(임의 복구 시도 없음)
- [x] undo 역연산 위치에 동명 파일/폴더가 새로 생긴 경우 **임의 덮어쓰기 없이 중단·안내**된다(역연산 전 충돌 선검증·D4 충돌 안전). ※ copy-undo는 보수적: 사본 경로 충돌 시 새 사본을 만들지 않고 중단(완전 역연산 한계)
- [x] 다중 선택 일괄 작업은 1 undo 단위로 묶여 한 번에 되돌려지고, 부분 실패 시 성공/실패가 요약된다
- [x] redo는 본 버전 범위 밖이다(후속 — `Ctrl+Z`만 제공, redo 키 미배정)
- [x] 되돌릴 작업이 없으면 빈 스택 안내("되돌릴 작업이 없습니다") 토스트가 표시된다

### K2. 휴지통 관리 화면 (S) ✅ 구현 완료 — 신규 채널 `trash:list`/`trash:restore`/`trash:empty`·`src/main/os/recycleBin.ts`(PowerShell Shell COM·`$Recycle.Bin` 화이트리스트·Move-Item 폴백·throw 0)·`src/main/ipc/trash.handlers.ts`(sender·zod·화이트리스트 재검증·`confirmed` 게이트)·`ui/trash/TrashDialog.tsx`(목록·복원·비우기 확인·focus trap·Esc)·`uiSlice.trashOpen`·`trashSlice`·사이드바/아이콘바 진입. ※ 휴지통 COM 실제 동작은 런타임 스모크 권장
**목적**: Windows 휴지통(재활용 폴더) 항목을 한 화면에서 보고 관리한다. 삭제한 파일을 **원위치로 복원**하거나 휴지통을 **전체 비우기**(영구삭제)해 정리한다. B5의 "휴지통 관리(복원·비우기) 화면은 S"를 정식 확정한다. (US-10.2)

> **기존 P6 잔여의 정식 편입**: roadmap §0.5의 "휴지통 관리 화면 🔜"을 정식 기능화한다. 구현 수단(Windows Shell COM 등)은 설계 위임이나, **보안(임의 경로 실행 차단)·확인(비우기 전 모달)** 수용 기준은 본 명세에서 확정한다.

| 항목 | 동작 규칙 |
|---|---|
| 진입점 | 사이드바 **"휴지통"** 항목 클릭 또는 상단 아이콘바 ④도구 그룹의 휴지통 버튼 → 휴지통 관리 화면/모달 표시 |
| 목록 필드 | 휴지통 항목을 표로 표시 — **이름 · 원래 경로(삭제 전 전체 경로) · 삭제일 · 크기** |
| 정렬 | 이름/원래 경로/삭제일/크기 기준 정렬(B2 정렬 원칙 준용) |
| 선택 복원 | 선택 항목을 **원래 위치로 복원**한다(다중 선택 일괄 복원 가능). 복원 위치에 동명 파일이 있으면 **임의 덮어쓰기 금지**(D4 충돌 안전·충돌 다이얼로그 또는 건너뛰기·사유 안내) |
| 전체 비우기 | 휴지통을 **영구 삭제**한다 — **반드시 확인 모달**을 거친다(되돌릴 수 없음 경고·항목 수/용량 표시 후 사용자 확정). 확인 없이는 비우지 않는다 |
| 선택 영구삭제(옵션) | (설계 선택) 선택 항목만 영구삭제도 동일하게 확인 모달 후 진행. 1차 필수는 "전체 비우기" |
| 보안 | **임의 경로 실행/조작을 차단**한다 — 복원/비우기는 휴지통 항목 식별자에만 작용하고, 사용자가 임의 경로를 주입해 실행하는 표면을 추가하지 않는다(ADR-005 보안 모델 준수, 경로 검증 양단). 구현 수단(Shell COM 등)은 검증된 항목에만 위임 |
| 자동 갱신 정합 | 복원·비우기 후 휴지통 목록과 (해당 시) 패널 워처(J2)를 통해 원위치 목록이 갱신된다 |
| 예외 | 항목이 이미 사라졌거나(외부 비우기) 권한 부족 시 사유 안내·해당 항목 건너뛰기(앱 중단 없음, F장 권한 규칙 준수) |

**수용 기준** (✅ 구현 — `recycleBin.ts`·`trash.handlers.ts`·`TrashDialog.tsx`)
- [x] 사이드바 "휴지통" 또는 아이콘바 버튼으로 휴지통 관리 화면/모달이 열리고, 닫기(`Esc`·닫기 버튼)로 탐색 화면으로 복귀한다(focus trap)
- [x] 휴지통 항목이 **이름 · 원래 경로 · 삭제일 · 크기** 필드로 목록 표시된다(`trash:list`)
- [x] 선택 항목을 **원래 위치로 복원**할 수 있으며(`trash:restore`), feat-K1 되돌리기의 휴지통 복원도 이 로직(`trashApi.restore`)을 재사용한다
- [x] 복원 위치 충돌·예외는 **임의 덮어쓰기 없이** 처리·사유 안내된다(D4 충돌 안전)
- [x] **전체 비우기**는 **확인 모달**(되돌릴 수 없음 경고)을 거친 뒤에만 영구삭제를 수행한다(`trash:empty`는 `confirmed=true` 게이트 — 확인 없이 비우지 않음, 중첩 확인 focus trap 포함)
- [x] 복원/비우기는 **검증된 휴지통 항목에만 작용**한다 — `$Recycle.Bin` 화이트리스트 재검증·sender 검증으로 임의 경로 주입 실행 표면을 추가하지 않는다(ADR-005)
- [x] 항목이 이미 사라졌거나 권한 부족 시 사유가 안내되고 앱이 중단되지 않는다(throw 0·Move-Item 폴백)
- [x] 복원·비우기 후 휴지통 목록이 갱신된다(원위치 패널은 워처 J2 연계 시)

### K3. 파일 유형별 비중 인사이트 (S) ✅ 구현 완료 — `src/main/operations/categorize.ts`(7카테고리 매핑)·`scanEngine.ts`(byCategory 1패스 집계·추가 I/O 0)·`shared/dto ScanResult.byCategory`(비파괴 확장)·`ui/dashboard/charts/CategoryBar.tsx`+표(비중%·절대 용량·파일 수·가장 큰 유형)
**목적**: §I1 디렉토리 사용량 대시보드의 Top10 스캔 결과에 **확장자 카테고리별 용량 집계**를 더해, 사용자가 "무슨 종류가 용량을 차지하는지"를 한눈에 파악하도록 한다. I1의 "(가능하면) 파일 유형별 비중" 선택항을 **정식 Should 기능으로 승격**한다. (US-10.3)

> **I1 선택항의 정식화**: §I1 인사이트의 "(가능하면) 파일 유형별 비중"은 미구현 선택항이었다(I1 자체 범위에서는 🔜). 본 K3이 이를 정식 기능으로 확정한다 — **I1의 기존 Top10 스캔(`analyze:scan:*`·`scanEngine`) 집계 경로를 확장**해 카테고리별 용량을 함께 산출하고 대시보드에 표시한다.

**유형(확장자 카테고리) 분류**
| 카테고리 | 예시 확장자(설계 단계 정밀화) |
|---|---|
| 이미지 | jpg·jpeg·png·gif·webp·bmp·svg·heic·tiff 등 |
| 동영상 | mp4·mkv·avi·mov·wmv·webm·flv 등 |
| 문서 | pdf·doc(x)·xls(x)·ppt(x)·hwp·txt·rtf·odt 등 |
| 코드 | js·ts·py·java·c·cpp·cs·go·rs·json·html·css·md 등 |
| 압축 | zip·7z·rar·tar·gz·iso 등 |
| 기타 | 위에 속하지 않는 모든 확장자(확장자 없음 포함) |

| 항목 | 동작 규칙 |
|---|---|
| 집계 대상 | I1 Top10 스캔 대상(선택 폴더/드라이브)과 **동일 스캔 1회**에서 파일별 확장자를 카테고리에 매핑해 **카테고리별 용량 합계·파일 수**를 누적한다(별도 추가 스캔 없이 기존 재귀 순회에 집계 단계만 추가) |
| 분류 기준 | 확장자(소문자 정규화) → 카테고리 매핑 테이블. 매핑에 없으면 "기타". 확장자 없는 파일도 "기타" |
| 표시 | 대시보드에 **차트(파이/도넛 또는 누적 막대) + 표**로 표시 — 카테고리별 **용량 비중(%)**·절대 용량·파일 수. 표는 스크린리더·정밀 수치용으로 차트와 병행(I1 차트+표 원칙 준수) |
| 차트 | recharts(MIT, I1 선례)로 그린다. 신규 차트 의존성 불요(기존 recharts 재사용) |
| 비차단·취소 정합 | I1 스캔의 비차단(워커)·진행률·취소·권한 거부 건너뛰기·링크 순환 차단 규칙을 그대로 따른다(집계 항목만 추가, 스캔 안전성 변경 없음) |
| 빈 결과 | 스캔 대상이 비었거나 전부 접근 불가면 "유형별 데이터 없음" 안내(빈 차트 대신) |

**수용 기준** (✅ 구현 — `categorize.ts`·`scanEngine.ts` byCategory·`CategoryBar.tsx`)
- [x] I1 Top10 스캔 결과에 **확장자 카테고리별(이미지·동영상·문서·코드·압축·기타) 용량 집계**가 함께 산출된다(동일 스캔 1회 byCategory 1패스 집계, 별도 스캔·추가 I/O 0)
- [x] 대시보드에 카테고리별 **용량 비중(%)·절대 용량·파일 수**가 **차트 + 표**로 표시된다(차트=recharts 재사용·표 병행·바이트 내림차순)
- [x] 확장자는 소문자 정규화 후 카테고리 매핑되며, 매핑에 없거나 확장자 없는 파일은 "기타"로 집계된다(`categorize.ts`)
- [x] 유형별 비중 집계는 I1 스캔의 비차단·진행률·취소·권한 거부 건너뛰기·링크 순환 차단 규칙을 그대로 따른다(스캔 안전성 변경 없음)
- [x] 스캔 대상이 비었거나 전부 접근 불가면 "유형별 데이터 없음"이 안내된다(빈 차트 대신)
- [x] 신규 차트 라이브러리 의존성을 추가하지 않는다(기존 recharts·lazy 청크 재사용)

---

## L. 그리드 보기 이미지 썸네일

> J3(보기 5종)의 **아이콘 그리드 보기**를 확장해, 이미지 파일을 OS 형식 아이콘 대신 **실제 이미지 내용의 축소 썸네일**로 보여 주는 영역이다.
> J3에서 "이미지 썸네일 자체 생성은 본 J3 범위 밖(추후)"으로 명시 보류했던 **마지막 잔여**(roadmap §0.5 "P6 잔여 그리드/썸네일"·"잔여 🔜 그리드 썸네일 이미지 자체 생성")를 **feat-L1로 정식 편입**한다.
> 2026-06-07 사용자 요청으로 정식 편입·**구현 완료 ✅**(team-dev·QA PASS). 우선순위 **S(Should)** — 핵심 가치(다중 디렉토리 작업)와 독립적인 **부가 UX** 개선이며, J3 아이콘 그리드(Should)의 시각 표현을 향상시킨다.
> **이것은 §K·§L 완료 시점(2026-06-07)까지 개발 잔여의 사실상 마지막 사용자 기능 항목이었고, 구현 완료되어 당시 사용자 기능 잔여(🔜)가 0이 됐다**(P7 릴리스 실측·코드서명 등 릴리스 안정화 잔여는 별개로 🟡). **2026-06-08 §M(M1/M2/M3·US-12.x)이 신규 편입(🔜)됐다가 같은 날 구현 완료·QA PASS(✅)됨.** 같은 날 §N(N1·N2 Should·US-13.x)도 기획 편입(🔜)됐다가 **같은 날 구현 완료·QA PASS(✅)됨 → §N 완료 시점(2026-06-08) 기준 사용자 기능 잔여(🔜)는 0이다**(§M·§N 실 동작은 런타임 스모크 권장 🟡). 단축키는 [PRD.md 8장](./PRD.md#8-단축키-체계-확정--충돌-없음)이 단일 출처다(L1은 보기 동작이라 신규 단축키 불요).
> 범례: ✅ 구현 완료 · 🟡 부분 · 🔜 미착수. **[2026-06-07 상태] feat-L1 ✅ 구현 완료** — 신규 채널 `preview:thumbnail`·`os/thumbnail.ts`(nativeImage 비율보존 resize·30MB 상한·LRU 256·세마포어 4)·`thumbnailCache.ts`·`domain/image.ts`·`FileListView ThumbnailIcon`. 신규 의존성 0(Electron 내장 nativeImage). 검증 `verify:thumbnail` 33. **nativeImage 실 디코드·GUI 그리드 렌더는 런타임 스모크 권장(코드 정합 충족).**

### L1. 그리드 보기 이미지 썸네일 자체 생성 (S) ✅ 구현 완료
**목적**: 파일 목록의 **아이콘 그리드 보기**(J3 큰/보통/작은 아이콘)에서, **이미지 파일은 OS 파일유형 아이콘 대신 실제 이미지 내용을 축소한 썸네일**로 표시해, 어떤 이미지인지 열어 보지 않고도 한눈에 식별하게 한다. (US-11.1)

> **J3·H6와의 관계**: J3(보기 5종)의 아이콘 그리드는 H6의 OS 실제 아이콘(`shell:icon`)을 크기 단계만 달리해 쓴다. feat-L1은 그중 **이미지 형식 파일에 한해** 형식 아이콘 자리를 **실제 내용 썸네일**로 교체한다(이미지가 아니거나 디코딩 불가/손상/초대용량이면 **H6 OS 아이콘으로 폴백**). 즉 **썸네일=이미지 한정 표현 향상, OS 아이콘=그 외 전체의 기본·폴백**으로 역할이 명확히 나뉜다. J3의 "이미지도 1차에는 형식 아이콘(썸네일 생성은 추후 확장)" 보류가 L1으로 해소된다.

**대상 / 폴백 규칙**
| 구분 | 규칙 |
|---|---|
| 대상 형식 | 이미지 형식 — png·jpg·jpeg·gif·bmp·ico·webp 등(정밀 목록은 설계 단계 확정). 확장자(소문자 정규화) 기준 판별 |
| 폴백 — 미지원/디코딩 불가 | 대상 외 형식, 디코딩 불가/미지원 인코딩은 **H6 OS 아이콘(`shell:icon`)으로 폴백**(빈 칸·깨진 이미지 금지) |
| 폴백 — 손상 | 손상·잘린 이미지 등 디코딩 실패 시 **OS 아이콘 폴백**(에러로 앱 중단 없음·해당 셀만 폴백) |
| 폴백 — 초대용량 | 썸네일 생성 비용이 과한 **초대용량 이미지**는 상한(설계 단계 확정)을 두고 초과 시 **OS 아이콘 폴백**(생성 시도로 UI를 막지 않음) |
| 적용 범위 | **아이콘 그리드 보기(J3 icons-large/medium/small)에 한정**. **목록(list)·자세히(details) 보기는 기존 작은 OS 아이콘 유지**(썸네일 대상 아님) |

**동작 / 성능 규칙**
| 항목 | 규칙 |
|---|---|
| 크기 단계 | 그리드 셀 크기(큰/보통/작은 아이콘)에 맞는 썸네일을 표시. 셀 크기에 비례한 적정 해상도로 축소(과대 디코딩 회피) |
| 로드 전 폴백 | 썸네일 로드 **전에는 폴백 아이콘(H6 OS 아이콘)을 먼저** 표시하고, 썸네일이 준비되면 **그 자리에서 썸네일로 교체**한다(레이아웃 점프 최소화·빈 화면 금지) |
| 가시 셀만 생성 | **가상 스크롤(ADR-004·J3 정합)에서 화면에 보이는 셀의 썸네일만 생성**한다(J3 `iconRef` 지연 요청 방식 준용). 화면 밖 항목은 생성하지 않는다 |
| 캐시 | 생성한 썸네일은 **캐시**해 재스크롤·재진입 시 재생성을 피한다(캐시 키·용량 상한·무효화 정책은 설계/구현 위임). 폴백된 항목(미지원·손상)은 재시도 비용을 피하도록 캐시 처리(구현 위임) |
| 비차단 | 썸네일 생성은 **비동기·비차단**으로, **1만 항목 폴더에서도 목록 스크롤·탐색을 막지 않는다**(생성 폭주 방지·가시 셀 한정·디바운스/큐잉은 구현 위임) |
| 정합 | J1 박스 선택·정렬(B2)·검색/필터(D1·D2)·J2 실시간 갱신과 충돌 없이 동작(썸네일은 셀의 시각 표현일 뿐, 선택·탐색 동작 불변) |

**보안 규칙**
| 항목 | 규칙 |
|---|---|
| 전달 방식 | 썸네일은 **data URL**(예: `data:image/...;base64,...`)로 렌더러에 전달한다(메인/백엔드에서 디코딩·축소·인코딩, 렌더러는 결과만 표시) |
| CSP 호환 | data URL 표시는 **CSP `img-src data:`** 와 호환된다. 원격 URL 로드·`file://` 직접 참조를 추가하지 않는다 |
| 렌더러 격리 | **렌더러는 파일에 직접 접근하지 않는다**(ADR-005 보안 모델 준수). 디코딩 입력 경로는 메인에서 검증(H6 `shell:icon`·B6 보안 모델과 동일 원칙) |

**수용 기준** (✅ 구현 — `os/thumbnail.ts`·`preview:thumbnail`·`thumbnailCache.ts`·`domain/image.ts`·`FileListView ThumbnailIcon`; ※ 실제 nativeImage 디코드·GUI 그리드 렌더는 런타임 스모크 권장)
- [x] 아이콘 그리드 보기(J3 큰/보통/작은 아이콘)에서 **이미지 파일(png·jpg·jpeg·gif·bmp·ico·webp 등)이 OS 형식 아이콘 대신 실제 내용 썸네일**로 표시된다(`isThumbnailableExt`·그리드 분기→`ThumbnailIcon`·`<img objectFit:contain>`)
- [x] 디코딩 불가/미지원 형식·**손상**·**초대용량** 이미지는 **H6 OS 아이콘(`shell:icon`)으로 폴백**되며(빈 칸·깨진 이미지 없음), 폴백으로 인해 앱이 중단되지 않는다(해당 셀만 폴백)(`createFromPath` isEmpty/예외→null·30MB 상한→null·null=OSIcon)
- [x] 썸네일은 그리드 셀 크기(큰/보통/작은)에 맞춰 표시되고, **로드 전에는 폴백 아이콘을 먼저 보이다가 준비되면 썸네일로 교체**된다(미로드 시 OSIcon·`useSyncExternalStore` 갱신 시 `<img>` 교체·DPR 버킷 `thumbSizeFor`)
- [x] **가상 스크롤에서 화면에 보이는 셀의 썸네일만 생성**되고(J3 `iconRef` 지연 준용), 화면 밖 항목은 생성하지 않는다(가시 셀만 마운트→`useEffect` 1회 요청)
- [x] 생성한 썸네일은 **캐시**되어 재스크롤·재진입 시 재생성되지 않는다(`thumbnailCache` LRU·negCache·in-flight 디듀프; 메인 `os/thumbnail.ts` LRU 256·실패 비캐싱)
- [x] 썸네일 생성이 **비동기·비차단**으로 동작해 **1만 항목 폴더에서도 목록 스크롤·탐색이 막히지 않는다**(invoke 비동기·in-flight 디듀프·가시 셀 한정·세마포어 4·30MB 상한; ※ 실측은 런타임 스모크 권장)
- [x] **목록(list)·자세히(details) 보기는 기존 작은 OS 아이콘을 유지**한다(썸네일 적용 대상 아님)(`ThumbnailIcon`은 그리드 icons-* 분기 한정·details/list는 OSIcon)
- [x] 썸네일은 **data URL**로 전달되어 **CSP `img-src data:`** 와 호환되며, **렌더러가 파일에 직접 접근하지 않는다**(ADR-005·H6와 동일 보안 모델, 원격/`file://` 로드 미추가)(`toDataURL`·`guardPath`·size 버킷 화이트리스트)
- [x] J1 박스 선택·정렬·검색/필터·J2 실시간 갱신 동작에 영향을 주지 않는다(썸네일은 시각 표현, 선택·탐색 동작 불변)

---

## M. 외부 연계 (외부 D&D · 클립보드 외부 연계 · FTP/SFTP 원격)

> **[챕터 식별자 주의]** 본 챕터 식별자 "**M**"(챕터 M·M1/M2/M3)은 MoSCoW 우선순위 마커 **M(Must)** 과 글자가 같다. 혼동을 막기 위해 본 문서·전 문서에서 **챕터/기능은 항상 "§M·M1·M2·M3"(또는 "M장")**, **우선순위는 항상 "Must/Should/Could/Won't"(축약 시 괄호 안 M/S/C/W)** 로 표기한다. 예: "M1(외부 D&D) — Should". J4 브랜딩의 "M for 릴리스"는 우선순위 마커이지 챕터 식별자가 아니다.
>
> 기존 A~L장이 **앱 내부(로컬·패널 간)** 동작이었다면, 본 M장은 그 경계를 **앱 바깥(타 프로그램·원격 서버)** 으로 확장하는 영역이다.
> - **M1·M2**(외부 D&D·클립보드 외부 연계)는 기존 **A3(패널 간 D&D)·B4(복사/잘라내기/붙여넣기)** 의 **확장**으로, 앱의 파일 작업을 Windows 셸·타 앱과 상호운용하게 한다.
> - **M3**(FTP/SFTP 원격)은 **신영역**이다. PRD §6 "Won't"의 "FTP/SSH 등 원격 프로토콜 브라우징"을 **사용자 결정으로 정정·편입**한 것으로(은폐 금지 — PRD §6 Won't에서 해당 줄 제거·변경 이력 기록·PRD §11 결정 D6), "**로컬 전용·외부 네트워크 전송 없음(결정 D5)**" 보안 원칙을 **부분 개정**한다(D7). FTP/SFTP에 한해 **사용자가 명시적으로 입력한 원격 호스트로만** 네트워크 연결을 허용하며, 텔레메트리 등 임의 송신은 여전히 금지한다.
> 2026-06-08 사용자 요청으로 정식 편입(기획 단계). 우선순위 배정 근거는 [PRD §6 "MoSCoW 분류 근거(2026-06-08 신규 3건 — §M 외부 연계)"](./PRD.md#6-범위와-우선순위-moscow) 참조.
> 단축키는 [PRD.md 8장](./PRD.md#8-단축키-체계-확정--충돌-없음)이 단일 출처다(M1·M2는 기존 D&D/`Ctrl+C/X/V` 재사용·신규 키 불요, M3는 컨텍스트 메뉴/사이드바 진입·신규 키 불요).
> **상태(범례): ✅ 구현 완료 · 🟡 부분 · 🔜 미착수. [2026-06-08 상태] M1·M2·M3 전부 ✅ 구현 완료·통합 QA PASS**(편입 당일 ADR-007 설계·MP0~MP5 구현). 구현 방식(네이티브 셸 D&D API·CF_HDROP 클립보드·ssh2-sftp-client/basic-ftp)은 아키텍트/개발팀 위임이었고 코드로 구현됨. **코드 정합·verify 충족 ✅ / 실 동작(외부 앱 실드롭·탐색기 양방향 왕복·실 SFTP/FTP/FTPS·실 DPAPI·실 전송)은 런타임 스모크 권장 🟡**(✅ 위장 아님). 각 절 수용 기준 체크박스는 코드 정합·verify로 충족(`[x]`)하되, **순수 런타임/네이티브 의존 항목은 항목 옆에 🟡 부기**한다.

### M1. 외부 프로그램으로 드래그 앤 드롭 복사 (Should) ✅ 구현 완료 (실 드롭 런타임 스모크 🟡)
**목적**: 탐색기 항목을 **앱 바깥(다른 앱·바탕화면·Windows 탐색기 등)** 으로 드래그하면 그곳에 **복사**되게 한다. 기존 패널 간 D&D(A3)는 앱 내부 이동/복사였고, M1은 그 드래그의 도착지를 **외부 드롭 타깃**까지 확장한다. (US-12.1)

> **A3와의 관계**: A3는 출발·도착이 모두 앱 내부 패널이다. M1은 **출발=앱 내부, 도착=외부 앱**인 경우다. 외부로의 드래그는 OS 표준 파일 드래그(셸이 인지하는 파일 드롭 데이터)로 시작되며, 도착지 앱이 그 드롭을 받아 처리한다.

| 항목 | 동작 규칙 |
|---|---|
| 외부 드래그 시작 | 패널 목록에서 항목을 선택해 **앱 창 바깥으로** 드래그하면 OS 표준 파일 드래그가 시작된다(드래그 페이로드 = 실제 파일 경로 목록) |
| 기본 의도 = 복사 | 외부 드롭의 기본 동작은 **복사**(원본 보존). 사용자가 명시적으로 이동을 의도해도 1차 범위는 **복사로 고정**(데이터 안전 우선 — 외부 이동은 후속 검토) |
| 다중 선택 | 다중 선택한 여러 항목을 한 번에 외부로 드래그하면 전부 드롭 타깃에 복사된다 |
| 드래그 이미지 | 드래그 중 항목 수/이름을 나타내는 드래그 이미지(고스트)를 표시(가능 시) |
| 내부 D&D와 구분 | **드롭 대상이 앱 내부 패널이면 A3 규칙**(같은 드라이브=이동/다른 드라이브=복사·수정키), **앱 바깥이면 M1(복사)**. 시작은 동일 드래그, 도착지로 분기 |
| 폴더 드래그 | 폴더를 외부로 드래그하면 폴더와 하위 내용 전체가 복사된다(도착지 앱의 처리에 위임) |
| 진행/대용량 | 대용량/다수 복사 시 **복사 진행·완료는 도착지(드롭 받은 앱/셸)의 작업**으로 처리된다(우리 앱은 드래그 소스 제공까지). 우리 앱 내부로의 드롭은 기존 E4 진행률 규칙을 따른다 |
| 실패/취소 | 외부 드롭을 도착지가 거부하거나 취소하면 원본은 그대로 유지된다(손실 없음). 드래그를 창 바깥에서 놓지 않고 취소하면 작업 없음 |
| 가상/원격 항목 | **M3 원격(FTP/SFTP) 항목의 외부 드래그는 1차 범위 밖**(원격→로컬은 M3 다운로드로 수행). M1은 로컬 파일시스템 항목 대상 |
| 보안 | 외부로 노출되는 것은 **사용자가 선택한 실제 파일 경로**뿐이다. 임의 데이터·실행 표면을 추가하지 않는다(ADR-005 원칙 유지) |

**수용 기준** (✅ 구현 완료·QA PASS — 코드 정합·`verify:dnd` 29 충족 / 실 OS 드롭은 런타임 스모크 권장 🟡)
- [x] 패널에서 선택한 항목을 앱 창 바깥(바탕화면·Windows 탐색기·다른 앱)으로 드래그&드롭하면 그 위치에 **복사**된다(원본 보존) — 🟡 실 OS 드롭 스모크 권장(`webContents.startDrag`)
- [x] 다중 선택한 여러 항목을 한 번에 외부로 드래그하면 모두 복사된다
- [x] 폴더를 외부로 드래그하면 폴더와 하위 내용 전체가 복사된다
- [x] 같은 드래그라도 **도착지가 앱 내부 패널이면 A3 규칙(이동/복사·수정키)**, **외부면 복사**로 동작한다(분기·`transferRoute.ts` 외부=복사 고정)
- [x] 외부 드롭을 도착지가 거부/취소하거나 드래그를 창 안에서 놓으면 **원본이 손실 없이 유지**된다(외부=복사이므로 원본 불변)
- [x] 드래그 중 복사 의도를 나타내는 시각 피드백(드래그 이미지/커서)이 표시된다 — 🟡 실 드래그 고스트 아이콘 스모크 권장(빈 아이콘 사전차단·fallback 검증됨)
- [x] M3 원격(FTP/SFTP) 항목은 외부 D&D 대상이 아니며(원격→로컬은 M3 다운로드), 로컬 파일 항목만 외부 드래그된다(원격 prefix ESECURITY 차단)
- [x] 외부로 전달되는 데이터는 선택한 실제 파일 경로뿐이며 임의 실행/주입 표면을 추가하지 않는다(ADR-005·경로 정규화/존재 검증)

### M2. 복사/잘라내기/붙여넣기 Windows 클립보드 외부 연계 (Should) ✅ 구현 완료 (실 왕복 런타임 스모크 🟡)
**목적**: 앱의 복사/잘라내기/붙여넣기가 **Windows 시스템 클립보드와 양방향 연동**되어 타 프로그램과 상호운용된다. 즉 **앱에서 `Ctrl+C` → Windows 탐색기에서 `Ctrl+V`로 붙여넣기**, 그 **역방향(탐색기에서 복사 → 앱에서 붙여넣기)** 이 모두 표준 클립보드 파일 포맷(**CF_HDROP** 등)으로 동작한다. 기존 B4("OS 클립보드 연동(타 앱 호환)")의 약식 서술을 **양방향 파일 포맷 연계로 정식 확정**한다. (US-12.2)

> **B4와의 관계**: B4는 앱 내부 복사/잘라내기/붙여넣기를 정의하며 "OS 클립보드 연동(타 앱 호환)"을 명시했으나, **타 앱과의 실제 파일 포맷(CF_HDROP)·잘라내기 이동 효과(Preferred DropEffect)·양방향 수용 기준**은 미확정이었다. M2가 이를 확정한다. 앱 내부 복사/잘라내기/붙여넣기 동작(B4) 자체는 변경하지 않고, **외부 연계 계약만 추가**한다.

| 항목 | 동작 규칙 |
|---|---|
| 앱 → 외부 (복사) | 앱에서 `Ctrl+C` 시 선택 파일 목록을 **표준 파일 클립보드 포맷(CF_HDROP 등)** 으로 시스템 클립보드에 올린다 → Windows 탐색기·타 앱에서 `Ctrl+V`로 **복사** 붙여넣기 가능 |
| 앱 → 외부 (잘라내기) | 앱에서 `Ctrl+X` 시 CF_HDROP + **이동 효과 표시(Preferred DropEffect = Move)** 를 클립보드에 설정 → 탐색기에서 붙여넣으면 **이동**으로 처리되고 원본이 사라진다. 붙여넣기 전까지 원본 유지·앱 목록에서 흐리게 표시(B4 유지) |
| 외부 → 앱 (붙여넣기) | Windows 탐색기·타 앱에서 복사/잘라낸 파일을 앱 패널에서 `Ctrl+V` 시, **클립보드의 CF_HDROP를 읽어** 현재 패널 폴더로 복사/이동한다. 클립보드의 이동/복사 효과(DropEffect)를 존중한다 |
| 충돌 처리 | 외부에서 붙여넣은 항목이 대상 폴더와 이름 충돌 시 **기존 D4 충돌 처리 규칙**(덮어쓰기/건너뛰기/둘 다 유지/병합/모두 적용)을 그대로 적용한다 |
| 진행률 | 외부에서 붙여넣은 대용량/다수 항목 복사·이동도 **E4 진행률·취소·부분 실패 요약**을 따른다 |
| 비파일 클립보드 | 클립보드에 파일 포맷(CF_HDROP)이 없으면(텍스트·이미지 등) 붙여넣기는 **파일 붙여넣기로 동작하지 않고** 적절히 무시·안내한다(파일 외 포맷은 본 기능 범위 밖) |
| 경로 텍스트 | (기존 C1) "경로 텍스트 복사"는 텍스트 클립보드 기능으로 M2(파일 포맷)와 별개로 유지된다 |
| 원격(M3) 정합 | **원격(FTP/SFTP) 항목의 클립보드 외부 연계는 1차 범위 밖**(원격↔로컬 전송은 M3 업/다운로드로 수행). M2는 로컬 파일시스템 항목 대상 |
| 보안 | 클립보드에 올리는 것은 **사용자가 선택한 실제 파일 경로**뿐. 외부에서 읽을 때도 클립보드가 제공하는 파일 경로만 신뢰·검증해 사용한다(임의 실행 표면 미추가·ADR-005) |

**수용 기준** (✅ 구현 완료·QA PASS — 코드 정합·`verify:clipboard-hdrop` 33 충족 / 실 탐색기 양방향 왕복은 런타임 스모크 권장 🟡)
- [x] 앱에서 `Ctrl+C` 후 **Windows 탐색기에서 `Ctrl+V`** 하면 선택 파일/폴더가 그 위치에 **복사**된다(CF_HDROP 등 표준 파일 포맷·DROPFILES 조립) — 🟡 실 왕복 스모크 권장
- [x] 앱에서 `Ctrl+X` 후 **탐색기에서 `Ctrl+V`** 하면 **이동**으로 처리되고(Preferred DropEffect=Move), 붙여넣기 전까지 원본이 유지되며 앱 목록에서 흐리게 표시된다 — 🟡 실 이동(Move) 왕복 스모크 권장
- [x] **Windows 탐색기/타 앱에서 복사·잘라낸 파일**을 앱 패널에서 `Ctrl+V` 하면 현재 패널 폴더로 **복사/이동**된다(클립보드 DropEffect 존중·effect 매핑) — 🟡 외부→앱 실 왕복 스모크 권장
- [x] 외부에서 붙여넣은 항목의 이름 충돌은 기존 D4 충돌 처리(덮어쓰기/건너뛰기/둘 다 유지/병합/모두 적용)로 해결된다(기존 `op:*`/D4 재사용)
- [x] 외부에서 붙여넣은 대용량/다수 항목도 E4 진행률·취소·부분 실패 요약을 따른다(기존 op 파이프라인 재사용)
- [x] 클립보드에 파일 포맷이 없으면(텍스트·이미지 등) 파일 붙여넣기로 동작하지 않고 적절히 무시·안내된다(비파일=effect none·방어적 파싱 폴백)
- [x] 앱 내부 복사/잘라내기/붙여넣기(B4) 동작은 변경 없이 유지된다(외부 연계 계약만 추가·기존 4채널 병존 보존·회귀 0)
- [x] 클립보드로 주고받는 데이터는 실제 파일 경로뿐이며, 외부 클립보드 입력도 검증 후 사용해 임의 실행 표면을 추가하지 않는다(ADR-005·guardPath+F_OK 통과분만)
- [x] 원격(M3) 항목은 클립보드 외부 연계 대상이 아니다(원격↔로컬 전송은 M3 업/다운로드)

### M3. FTP/SFTP 원격 접속 (Could) ✅ 구현 완료 (실 서버/DPAPI/전송 런타임 스모크 🟡)
**목적**: 원격 서버에 **FTP/SFTP로 접속**해 원격 파일을 **탐색·업로드·다운로드**한다. 로컬 다중 디렉토리 작업과 동일한 탐색기 UX 안에서 원격 위치를 다룬다. (US-12.3·12.4·12.5)

> **[중대 변경 — 정직 기록] PRD §6 "Won't"의 정정·편입**: 본 M3는 PRD §6 Won't에 있던 "**FTP/SSH 등 원격 프로토콜 브라우징**"을 **사용자 결정(2026-06-08)으로 정정·편입**한 것이다. 과거 이 사이클 제외(Won't)였으나 사용자 요구로 정식 기능화한다 → PRD §6 Won't에서 해당 줄 제거·PRD 변경 이력·PRD §11 결정 **D6**에 기록.
> **[보안 경계 부분 개정 — 정직 기록]** M3는 "**로컬 전용·외부 네트워크 전송 없음**"(결정 D5의 로컬 전용 원칙)을 **부분 개정**한다(결정 **D7**). **FTP/SFTP에 한해, 사용자가 명시적으로 입력한 원격 호스트로만** 네트워크 연결·전송을 허용한다. 텔레메트리 등 사용자 동의 없는 임의 송신 금지는 그대로 유지된다(D5의 텔레메트리 옵트인·임의 송신 금지 원칙 불변).

**연결 / 자격증명**
| 항목 | 동작 규칙 |
|---|---|
| 프로토콜 | **FTP·FTPS·SFTP(SSH)** 지원(정확한 지원 범위는 설계 단계 확정). 사용자가 프로토콜·호스트·포트·사용자명·인증 방식을 입력 |
| 인증 방식 | **비밀번호** 인증 / **SSH 키(개인키)** 인증(SFTP). 호스트 키 확인(미신뢰 호스트 키 경고) |
| **자격증명 저장 = OS 자격증명 보관소** | 비밀번호·개인키 패스프레이즈 등 비밀은 **OS 자격증명 보관소(Windows Credential Manager / DPAPI 계열)에만 저장**한다. **평문(설정 파일·세션 파일·로그) 저장 절대 금지.** 저장은 사용자가 "저장" 선택 시에만 수행하고, 미저장 시 메모리에서만 사용 후 폐기 |
| 연결 관리 | 저장한 원격 연결 프로필(이름·호스트·사용자명 등 비밀 제외 메타)을 사이드바/연결 관리에서 목록·재접속·편집·삭제 |
| 연결 진입 | 사이드바 "원격" 섹션 또는 메뉴 "원격 연결"에서 새 연결/저장 연결 선택 → 접속 |

**탐색 / 전송**
| 항목 | 동작 규칙 |
|---|---|
| 원격 탐색 | 접속 후 원격 디렉토리를 **로컬과 동일한 패널 UX**(목록·정렬·주소 표시줄·탐색 이동)로 탐색. 원격 경로 표기는 `프로토콜://사용자@호스트/경로` 형태로 명확히(로컬과 구분) |
| 주소창 경로-only 입력 | **(2026-06-09 추가·H5 교차)** 원격 패널에서 주소 표시줄 편집(클릭/`Ctrl+L`) 시 **호스트(`sftp://host`)는 고정 프리픽스로 표시**되고 사용자는 **경로만(`/mnt/sub`)** 입력하면 현재 호스트와 결합해 이동한다(전체 URI 입력을 강요하지 않음). 방어적으로 사용자가 전체 URI를 입력해도 처리. 상세는 §H5·US-7.5/US-12.4 |
| 패널 통합 | 원격 위치를 **패널 하나로** 열어, 다른 패널(로컬 또는 다른 원격)과 나란히 둔다(멀티 디렉토리 차별점을 원격까지 확장) |
| 다운로드 | 원격 → 로컬 패널로 **드래그&드롭 또는 복사/붙여넣기** 시 다운로드. 진행률·취소·부분 실패 요약(E4) |
| 업로드 | 로컬 → 원격 패널로 드래그&드롭 또는 복사/붙여넣기 시 업로드. 진행률·취소·부분 실패 요약(E4) |
| 원격 내 작업 | 원격 내 이름변경·삭제·새 폴더 등 기본 조작(프로토콜·권한이 허용하는 범위). 권한/미지원 동작은 사유 안내 |
| 충돌 처리 | 업/다운로드 시 이름 충돌은 D4 충돌 처리 규칙 준용(덮어쓰기/건너뛰기/둘 다 유지 등). 원격 측 제약은 사유 안내 |

**연결 끊김 / 타임아웃 / 에러 처리**
| 항목 | 동작 규칙 |
|---|---|
| 타임아웃 | 연결·전송 타임아웃 시 명확한 사유 안내, 해당 원격 패널만 오류 표시(다른 패널·앱 전체 영향 없음·F장 "네트워크 끊김" 규칙 준용) |
| 연결 끊김 | 전송 중 끊김 시 진행분/실패분을 요약하고 재시도/재접속을 안내. 부분 다운로드 산출물 처리(임시 파일·이어받기 여부)는 설계 단계 확정. **이어받기(resume) 지원 여부·부분 전송 무결성(체크섬/크기 검증) 기준은 설계에서 확정**한다(차단 아님·deferral). 단, 끊김 시 도착지에 남은 불완전 파일이 완료본으로 오인되지 않도록 처리(임시명/정리 또는 명시 표식)하는 안전 원칙은 데이터 안전 원칙(PRD §5 원칙3)으로 유지하며, 구체 방식은 설계 단계에서 정한다 |
| 인증 실패 | 자격증명 오류 시 재입력 유도(저장된 비밀이 틀리면 보관소 갱신 동선 제공). 무한 재시도/계정 잠금 유발 방지 안내 |
| 호스트 키 경고 | 미신뢰/변경된 호스트 키는 명시적 경고·사용자 확인 후에만 진행(중간자 공격 방지) |
| 오프라인/도달 불가 | 호스트 도달 불가 시 사유 안내, 앱 중단 없음 |

**보안**
| 항목 | 동작 규칙 |
|---|---|
| 네트워크 경계 | 네트워크 연결은 **사용자가 명시적으로 입력/저장한 원격 호스트로만** 발생한다(D7). 그 외 임의 외부 송신 없음(텔레메트리 포함·D5 옵트인 원칙 유지) |
| 전송 보안 | SFTP(SSH)·FTPS는 암호화 전송. 평문 FTP 사용 시 **비암호화 경고**를 표시한다 |
| 비밀 비노출 | 비밀번호·키·패스프레이즈는 로그·세션·설정 파일·오류 메시지에 평문 노출 금지(OS 보관소만·D6/D7) |
| 격리 | 원격 처리 오류가 로컬 탐색·다른 패널을 중단시키지 않는다(패널 단위 격리·F장 준용) |

**수용 기준** (✅ 구현 완료·QA PASS — 코드 정합·`verify:credentials` 17·`verify:remote` 23·`verify:remote-trust` 35·`verify:remote-route` 47·`verify:eslint-remote` 29 충족 / 실 서버·DPAPI·전송은 런타임 스모크 권장 🟡)
- [x] 사용자가 프로토콜(FTP/FTPS/SFTP)·호스트·포트·사용자명·인증 방식을 입력해 원격 서버에 **접속**할 수 있다(`RemoteDialog`·`remote:connect`) — 🟡 실 SFTP/FTP/FTPS 핸드셰이크 스모크 권장
- [x] 비밀번호 인증과 SFTP **SSH 키 인증**을 지원하고, 미신뢰/변경된 **호스트 키는 경고·사용자 확인 후에만** 진행한다(TOFU·`HostKeyModal`·초기 포커스=거부) — 🟡 실 호스트키 모달 표시 스모크 권장
- [x] **자격증명(비밀번호·키 패스프레이즈)은 OS 자격증명 보관소(safeStorage/DPAPI)에만 저장되며, 설정/세션/로그에 평문으로 저장되지 않는다**(미저장 시 메모리 사용 후 폐기·미가용 시 EUNSUPPORTED 거부·평문 폴백 금지·비밀 DTO/로그/Error 배제·`verify:credentials` 평문 0) — 🟡 실 DPAPI 암복호 라운드트립 스모크 권장
- [x] 저장한 원격 연결 프로필(비밀 제외 메타)을 목록·재접속·편집·삭제할 수 있다(`RemoteProfileStore` 화이트리스트 7필드만 영속·비밀 구조적 배제)
- [x] 접속 후 원격 디렉토리를 **로컬과 동일한 패널 UX**(목록·정렬·주소 표시줄·이동)로 탐색하며, 원격 경로가 로컬과 구분되게 표기된다(`remote:list`→`FileEntryDTO` 재사용·`panelsSlice` 원격 라우팅) — 🟡 실 서버 디렉토리 렌더 스모크 권장
- [x] **(2026-06-09 추가) 원격 패널의 주소 표시줄 편집 시 호스트(`sftp://host`)는 고정 프리픽스로 표시되고 사용자는 경로만(`/mnt/sub`) 입력하면 현재 호스트와 결합해 이동한다(전체 URI 입력 강요 없음·방어적으로 전체 URI 입력도 처리). 로컬 패널 경로 입력 동작은 불변** — H5 교차 개선·`verify:remote-route` 47. ※ 실 GUI(원격 주소 경로-only 입력·이동) 런타임 스모크 권장 🟡
- [x] 원격 위치를 **패널 하나로 열어** 다른 패널(로컬/다른 원격)과 나란히 둘 수 있다
- [x] 원격→로컬 **다운로드**, 로컬→원격 **업로드**가 드래그&드롭 또는 복사/붙여넣기로 동작하고, **진행률·취소·부분 실패 요약(E4)** 을 따른다(`remoteTransfer`·operationId→기존 `op:*` 브리지·.part 원자 rename) — 🟡 실 전송 진행률/취소/충돌 스모크 권장
- [x] 업/다운로드 이름 충돌은 D4 충돌 처리 규칙으로 해결된다(기존 D4 재사용)
- [x] **연결/전송 타임아웃·끊김·인증 실패·도달 불가** 시 사유가 안내되고, 해당 원격 패널만 오류를 표시하며 앱·다른 패널이 중단되지 않는다(패널 단위 격리·`RemoteSessionManager` 세션 격리·`remote:session-error` 푸시) — 🟡 실 타임아웃/끊김 세션격리 스모크 권장
- [x] 네트워크 연결은 **사용자가 명시적으로 입력/저장한 원격 호스트로만** 발생하며, 그 외 임의 외부 송신이 없다(D7·네트워크 import `src/main/remote/` ESLint 화이트리스트·`verify:eslint-remote`)
- [x] 평문 FTP 사용 시 **비암호화 경고**가 표시되고, 비밀이 로그/세션/설정/오류 메시지에 평문 노출되지 않는다(`FtpAdapter` encrypted=false→경고 토스트·SAFE_MESSAGES만 전파) — 🟡 실 평문 FTP 경고 표시 스모크 권장
- [x] 원격(M3) 항목은 외부 D&D(M1)·클립보드 외부 연계(M2)의 직접 대상이 아니다(원격↔로컬 전송은 M3 업/다운로드로 수행)

---

## N. 즐겨찾기 UX 향상 (경로 워터마크 · 드래그 정렬)

> 기존 **즐겨찾기/북마크(C4, Must)** 와 **즐겨찾기 별칭(J7·US-9.7, Should)** 을 **비파괴로 확장**하는 영역이다. 새로운 파일시스템 동작을 추가하는 것이 아니라, 즐겨찾기의 **시각 피드백(N1)** 과 **순서 정렬(N2)** 을 더해 즐겨찾기 UX 완성도를 높인다.
> 2026-06-08 사용자 요청으로 정식 편입. 우선순위는 둘 다 **S(Should)** — 핵심 가치(다중 디렉토리 작업)와 독립적이나 즐겨찾기 사용성을 높이는 개선이다(우선순위 근거 [PRD §6 "MoSCoW 분류 근거(2026-06-08 §N)"](./PRD.md#6-범위와-우선순위-moscow)).
> **기존 정합**: N1은 J7 별칭(`SidebarSnapshot.favoriteLabels`)을 표시 텍스트 소스로 **재사용**(없으면 경로 basename 폴백 — J7과 동일 규칙), N2는 `SidebarSnapshot`에 즐겨찾기 **순서**를 추가 영속한다(기존 즐겨찾기 추가/제거·J7 별칭 동작 불변). 단축키는 [PRD.md 8장](./PRD.md#8-단축키-체계-확정--충돌-없음)이 단일 출처다.
> 범례: ✅ 구현 완료 · 🟡 부분 · 🔜 미착수. **[2026-06-08 상태] N1·N2 모두 ✅ 구현 완료·통합 QA PASS**([qa-integration-N](./reviews/qa-integration-N.md): 블로커·높음 0·핵심 verify 302/0·contrast 실패 0·typecheck/lint/build 0·렌더러 전용·신규 채널 0). 경과(🔜→✅): 같은 날 기획 편입(🔜 미착수) → 설계(키 `Alt+Shift+↑/↓` 확정) → 구현 → QA PASS → doc-sync 🔜→✅. **실 GUI 동작은 런타임 스모크 권장 🟡**(아래 각 항목 "※ 실렌더 🟡" 표기).

### N1. 즐겨찾기 경로 워터마크 (S) ✅ 구현 완료 (실 GUI 렌더 런타임 스모크 🟡)
**목적**: 현재 패널이 보고 있는 폴더가 **즐겨찾기에 등록된 곳**일 때, 패널 파일 목록 뒤 배경에 그 즐겨찾기 이름을 크고 반투명하게 깔아 "여긴 즐겨찾기한 곳"임을 한눈에 인지시킨다. 폴더를 오가며 맥락(여기가 어디인지·즐겨찾기인지)을 빠르게 파악하게 돕는다. (US-13.1)

> C4(즐겨찾기)·J7(별칭, US-9.7)의 **시각 향상 확장**이다. 표시 텍스트는 J7 별칭을 우선 재사용해 별칭 변경과 자동으로 일관된다(별칭 바꾸면 워터마크도 그 이름으로 표시).

**표시 텍스트 소스 (J7 재사용)**
| 우선순위 | 소스 | 규칙 |
|---|---|---|
| 1순위 | **J7 즐겨찾기 별칭(`favoriteLabels[path]`)** | 해당 즐겨찾기에 별칭이 지정돼 있으면 별칭을 표시(J7과 동일 데이터 — 별칭 변경 시 워터마크도 따라 변경) |
| 2순위(폴백) | **경로 basename** | 별칭이 없으면(빈값 포함) 경로의 마지막 구간(폴더명)을 표시(J7 basename 폴백 규칙과 동일) |

**일치 조건 (1차 — 정직 표기)**
| 항목 | 동작 규칙 |
|---|---|
| 정확 일치만 | 현재 패널 경로가 **즐겨찾기 경로와 정확히 일치**할 때만 워터마크를 표시한다. **부분 일치·하위 경로(즐겨찾기의 자식 폴더)는 1차에서 표시하지 않는다**(과표시로 오인 방지·정직). 경로 비교는 OS 정규화(대소문자·후행 슬래시·구분자) 기준으로 한다 |
| 다중 일치 | 같은 경로가 즐겨찾기에 둘 이상 등록되는 경우는 즐겨찾기 데이터 구조상 통상 없으나, 있으면 첫 항목(또는 별칭 있는 항목)을 1개만 표시(겹쳐 깔지 않음) |
| 비즐겨찾기 | 현재 경로가 즐겨찾기가 아니면 워터마크를 표시하지 않는다(빈 배경) |

**시각·배치 규칙**
| 항목 | 동작 규칙 |
|---|---|
| 위치(z-index) | 워터마크는 패널 파일 목록·아이콘·텍스트의 **뒤 배경**에 깔린다(목록 z-index 아래). **본문 텍스트·아이콘과 겹쳐 가독성을 해치지 않게** 한다(목록 위에 덮이지 않음) |
| 배치 | 패널 영역 **중앙 또는 한쪽 구석**에 크게(설계에서 중앙/구석 기본값 확정). 목록 스크롤과 무관하게 배경에 고정(스크롤 시 함께 흐르지 않게 — 배경 고정 권장) |
| 반투명·대비 | 크고 **반투명**하게 표시하되, **본문 텍스트의 WCAG 대비에 영향을 주지 않도록**(워터마크가 본문 글자 뒤로만 깔리고 본문 위에 안 깔림) 한다. **테마별 반투명도**(라이트/다크/시스템/블루라이트)를 달리해 각 배경에서 과하지도 안 보이지도 않게 조정(설계·구현에서 토큰화) |
| 긴 이름 | 별칭/폴더명이 길면 패널 폭에 맞춰 **말줄임 또는 축소**(레이아웃 깨짐·가로 넘침 없음). 폰트 크기는 패널 폭에 비례 조정 가능(설계 결정) |
| 빈 폴더 | 빈 폴더("이 폴더가 비어 있습니다" 안내)여도 즐겨찾기면 워터마크는 표시(빈 안내 텍스트와 겹치지 않게 배치) |
| 토글 | 1차는 **항상 표시 가능**(토글 없이 출시 가능). 표시 on/off 토글 제공 여부·진입점은 설계/구현 단계에서 결정(필요 시 설정 항목) |
| 격리 | 워터마크는 **활성/비활성 패널 각각** 자기 경로 기준으로 독립 판정·표시(2분할/4분할에서 패널마다 다른 워터마크 가능) |

**수용 기준** (✅ 구현 완료 — 코드 정합·verify 충족 / 실렌더 육안은 🟡)
- [x] 현재 패널 경로가 즐겨찾기 경로와 **정확히 일치**할 때만 패널 배경에 워터마크가 표시되고, 일치하지 않으면(부분/하위 경로 포함) 표시되지 않는다 — `favoriteWatermark.ts` normalizeDisplay `===` 매치·하위경로 비매치(`verify:domain`)
- [x] 워터마크 텍스트는 **J7 별칭(`favoriteLabels`)을 우선** 사용하고, 별칭이 없으면 경로 basename으로 폴백한다(별칭 변경 시 워터마크도 따라 변경됨) — `favoriteLabels[fav]` trim 폴백 `baseName(fav)`(FavoriteRow.display 동일 규칙·verify)
- [x] 워터마크는 파일 목록·아이콘·텍스트의 **뒤 배경**에 반투명하게 깔리며, 본문 텍스트·아이콘과 겹쳐 가독성을 해치지 않는다(본문 WCAG 대비 영향 없음) — `FavoriteWatermark.tsx` zIndex:0·FileListView zIndex:1·`pointer-events:none`·`aria-hidden`·`verify:contrast` 실패 0. ※ 실렌더 육안 🟡
- [x] 라이트/다크/시스템/블루라이트 4테마 각각에서 워터마크 반투명도가 과하거나 안 보이지 않게 조정되어 본문 가독성을 유지한다 — `palette.ts` LIGHT(.06)/DARK(.08)/BLUELIGHT(.07) `--c-watermark-opacity`·시스템=resolved 승계. ※ 실 반투명도 적정성 육안 🟡(`9vw` 폰트 2/4분할 과대 여부 [낮음-2])
- [x] 별칭/폴더명이 길어도 패널 폭에 맞춰 말줄임/축소되어 레이아웃이 깨지거나 가로로 넘치지 않는다 — `whiteSpace:nowrap`+`textOverflow:ellipsis`+`maxWidth:100%`. ※ 실렌더 🟡
- [x] 빈 폴더에서도 즐겨찾기면 워터마크가 표시되며, 빈 폴더 안내 텍스트와 겹치지 않게 배치된다 — 빈영역 div `background:transparent`로 워터마크 노출·안내문과 동일 레이어 미겹침. ※ 실렌더 🟡
- [x] 2분할/4분할에서 각 패널이 자기 경로 기준으로 독립적으로 워터마크를 판정·표시한다(패널 격리) — `panelId`별 `panels[panelId].path` 구독·독립 판정
- [x] 기존 즐겨찾기(C4)·별칭(J7) 동작과 충돌·회귀가 없다(표시 전용 — 즐겨찾기 데이터·경로·이동 동작 불변) — 박스선택(J1)·D&D·접근성 트리 무간섭(qa-integration-N 회귀 0)

### N2. 즐겨찾기 드래그 정렬 (S) ✅ 구현 완료 (실 드래그·키보드 런타임 스모크 🟡)
**목적**: 사이드바 즐겨찾기 섹션의 항목을 **드래그로 원하는 순서로 재배열**하고 그 순서를 영속시켜, 자주 쓰는 즐겨찾기를 위로 올려두는 등 사용자가 즐겨찾기 목록을 자기 작업 흐름에 맞게 정리하게 한다. (US-13.2)

> C4(즐겨찾기) "**순서 변경**(S)"으로 이미 Should로 예고된 항목의 정식 편입이다. 순서는 `SidebarSnapshot`에 추가 영속한다(J7 별칭과 동격의 즐겨찾기 메타 확장·기존 데이터 비파괴).

| 항목 | 동작 규칙 |
|---|---|
| 드래그 정렬 | 사이드바 즐겨찾기 항목을 **마우스로 잡아(드래그) 위/아래로 끌어** 순서를 바꾼다. 놓으면(드롭) 새 순서로 확정 |
| 시각 피드백 | 드래그 중 **삽입 위치 인디케이터**(항목 사이에 드롭 위치 선/하이라이트)와 **드래그 중인 항목 강조**(반투명/들림 효과)를 표시해 어디에 놓일지 명확히 한다 |
| 영속 | 변경된 즐겨찾기 순서를 **세션/사이드바 스냅샷(`SidebarSnapshot`)에 영속**한다 → 재시작 후에도 유지(기존 즐겨찾기 데이터에 순서 메타 추가·비파괴). 순서 데이터 형태(명시적 순서 배열 또는 정렬 인덱스)는 설계 단계 확정 |
| 섹션 격리 | **즐겨찾기 섹션 내에서만** 재정렬된다. 다른 사이드바 섹션(트리·드라이브·휴지통·최근)과는 **격리** — 즐겨찾기 항목을 타 섹션으로 끌어도 이동/추가되지 않고(섹션 경계 밖 드롭=무효·원위치 복귀), 타 섹션 항목이 즐겨찾기 순서에 끼어들지 않는다 |
| 키보드 대체 | 마우스를 쓸 수 없는 사용자를 위해 **키보드로 순서를 옮기는 대체 수단**을 제공한다(접근성). 즐겨찾기 항목 포커스 후 **`Alt+Shift+↑/↓`로 위·아래 한 칸 이동**(확정·구현 — 사이드바 즐겨찾기 포커스 한정·전역 미배정·충돌 0, [PRD 8장](./PRD.md#8-단축키-체계-확정--충돌-없음)). 스크린리더용 ARIA(role=option·`aria-posinset/setsize`·`aria-grabbed`·`roledescription`) 안내 제공 |
| 별칭 정합 | 정렬은 **순서만** 바꾼다 — J7 별칭·경로·즐겨찾기 추가/제거 동작은 불변(별칭이 있는 항목은 별칭 그대로 표시되며 위치만 이동) |
| 예외 | 즐겨찾기 0~1개면 정렬 동작이 의미 없으므로 무동작(에러 아님). 드래그 중 ESC/취소 또는 유효하지 않은 위치 드롭 시 순서 미변경(원상 복귀) |

**수용 기준** (✅ 구현 완료 — 코드 정합·verify 충족 / 실 드래그·키보드 육안은 🟡)
- [x] 사이드바 즐겨찾기 항목을 드래그&드롭으로 위/아래로 끌어 순서를 변경할 수 있다 — `useFavoriteReorder.ts`+`resolveDropTarget`·`reorderFavorite(from,to)` splice(`verify:domain`/`verify:store`). ※ 실 마우스 드래그 🟡
- [x] 드래그 중 삽입 위치 인디케이터와 드래그 항목 강조 등 시각 피드백이 표시된다 — `DropLine`(accent 2px)·드래그 항목 `opacity:0.4`. ※ 실렌더 🟡
- [x] 변경된 즐겨찾기 순서가 `SidebarSnapshot`(세션/사이드바 스냅샷)에 영속되어 재시작 후에도 유지된다 — `session.ts` `[...s.favorites]`·`SESSION_SCHEMA_VERSION`·`coerceSidebar` 무변경(`verify:store` 영속·`verify:persistence` 94). ※ 재시작 후 유지 육안 🟡
- [x] 재정렬은 즐겨찾기 섹션 내에서만 일어나고, 트리·드라이브·휴지통·최근 등 다른 섹션과 격리된다(타 섹션으로 드롭하면 이동·추가되지 않고 원위치로 복귀) — 드래그 상태는 FavoritesSection 행에서만 set·`reorderActive` 게이트·섹션 내 인덱스 계산
- [x] 마우스 없이 **키보드로 즐겨찾기 순서를 이동**할 수 있는 대체 수단이 제공된다(접근성 — `Alt+Shift+↑/↓`·포커스 추종 rAF·ARIA 안내) — row tabIndex=0·`altKey&&shiftKey&&!ctrl&&!meta` 가드·role=option·aria-posinset/setsize/grabbed. ※ 실 스크린리더·포커스 육안 🟡
- [x] 정렬은 순서만 바꾸며 J7 별칭·경로·즐겨찾기 추가/제거 동작에 영향을 주지 않는다(별칭 항목은 별칭 유지·위치만 이동) — 순서만 splice·라벨 맵 경로키라 순서 무관(`verify:store` "별칭 보존")
- [x] 즐겨찾기가 0~1개이거나 드래그를 취소/유효하지 않은 위치에 놓으면 순서가 변경되지 않는다(무동작·원상 복귀, 에러 없음) — 0개=섹션 미렌더·1개 무동작·`reorderFavorite` 범위가드·`onDragEnd`→`endFavoriteReorder`·무효 드롭 `resolveDropTarget` null(verify)
- [x] 기존 즐겨찾기(C4) 추가/제거·클릭 이동·J7 별칭 인라인 편집 동작과 충돌·회귀가 없다 — `sidebarSlice` 기존 액션 무변경(reorderFavorite만 신규)·FavoriteRow display·setFavoriteLabel 무변경(qa-integration-N 회귀 0)

---

## O. 파일/폴더 상단 고정 (Pin)

> 기존 **파일 목록 보기·정렬(B1·B2, Must)** 과 **즐겨찾기 메타(C4·J7)** 를 **비파괴로 확장**하는 영역이다. 새로운 파일시스템 동작을 추가하는 것이 아니라, 자주 보는 파일/폴더를 **현재 디렉토리 목록의 최상단에 고정**해 매번 스크롤·검색하지 않고 바로 찾게 하는 **렌더러 UX 기능**이다.
> 2026-06-09 사용자 요청으로 정식 편입(출처: `docs/temp/ref.md` 아이디어 — 코드 선구현 후 정식 기획 편입). 우선순위는 **S(Should)** — 핵심 가치(다중 디렉토리 작업)와 독립적이나 일상 탐색 동선을 단축하는 즐겨찾기 별칭(J7)·워터마크(N1)와 동급의 소규모 UX 개선이다(우선순위 근거 [PRD §6 "MoSCoW 분류 근거(2026-06-09 §O)"](./PRD.md#6-범위와-우선순위-moscow)).
> **기존 정합**: 고정 데이터는 즐겨찾기 별칭(J7 `favoriteLabels`)과 **동일한 per-위치(디렉토리) 메타 패턴**을 따라 `SidebarSnapshot.pinnedByDir`(dirPath → 고정 항목 경로 배열)로 영속한다(즐겨찾기 데이터·정렬 동작 불변). 고정 적용은 정렬(B2) 직후 단계에 끼워 넣어 정렬/필터 동작을 바꾸지 않는다. 단축키는 [PRD.md 8장](./PRD.md#8-단축키-체계-확정--충돌-없음)이 단일 출처다(컨텍스트 메뉴로만 조작·신규 키 불요).
> **[2026-06-09 동작 변경 — refinement] 고정 항목 표시를 "최상단 정렬" → "스크롤 고정(sticky)"으로 변경**: 목록(list)·자세히(details) 보기에서 고정 항목이 스크롤해도 항상 상단에 붙어 계속 보이도록 변경했다. 아이콘 그리드(icons-*)는 wrapping 레이아웃 특성상 sticky를 적용하지 않고 기존대로 "정렬 최상단"만 유지한다(보기별 차이 정직 표기). 키보드 내비게이션은 sticky 밴드 높이만큼 스크롤 보정된다. **MoSCoW 등급(Should)·스코프는 불변**(동작 변경일 뿐). 검증: typecheck/lint/build 0·verify 회귀 0(domain 60·store 121·persistence 101·perf 25 windowing 불변·remote-route 47).
> 범례: ✅ 구현 완료 · 🟡 부분 · 🔜 미착수. **[2026-06-09 상태] O1 ✅ 구현 완료(코드)**(코드 정합·verify 충족 — `verify:domain` 60(applyPins)·`verify:store` 121(pin 액션·영속)·`verify:persistence` 101(coercePinnedByDir)). **렌더러 전용·신규 IPC 채널 0·신규 npm 의존성 0.** **실 GUI 동작(컨텍스트 메뉴 토글·목록/자세히 sticky 상단 밴드 스크롤 고정 렌더·그리드 정렬 상단·키보드 보정·재시작 후 유지)은 헤드리스로 미증명 → 런타임 스모크 권장 🟡**(✅ 위장 아님·각 수용 기준 옆 "※ 실 GUI 🟡" 부기).

### O1. 파일/폴더 상단 고정(pin) (S) ✅ 구현 완료 (실 GUI 동작 런타임 스모크 🟡)
**목적**: 현재 디렉토리에서 자주 쓰는 파일/폴더를 **목록 최상단에 고정**해, 정렬·필터·스크롤과 무관하게 항상 위에서 바로 찾게 한다. 폴더를 오갈 때 "이 폴더에서 늘 먼저 보는 것"을 손쉽게 끌어올린다. **목록/자세히 보기에서는 스크롤해도 고정 항목이 상단에 붙어(sticky) 계속 보이며**(2026-06-09 동작 변경: "최상단 정렬" → "스크롤 고정"), 그리드 보기에서는 레이아웃 특성상 "최상단 정렬"만 유지된다(보기별 차이는 아래 표시·정렬 규칙 참조). (US-14.1)

> C4(즐겨찾기)는 **사이드바에 폴더를 보관**하는 전역 즐겨찾기이고, O1 상단 고정은 **특정 디렉토리 안에서 그 안의 항목을 위로 올리는** 디렉토리 지역(local) 메타다(서로 보완·중복 아님). 즐겨찾기 별칭(J7)과 동일한 per-위치 메타 영속 패턴을 재사용한다.

**조작 (컨텍스트 메뉴 토글)**
| 항목 | 동작 규칙 |
|---|---|
| 고정 | 파일 목록에서 **단일 파일 또는 폴더**를 우클릭 → 컨텍스트 메뉴 **"상단 고정"** 선택 시 그 항목을 현재 디렉토리의 고정 목록에 추가 |
| 해제 | 이미 고정된 항목을 우클릭하면 메뉴 라벨이 **"상단 고정 해제"** 로 바뀌며, 선택 시 고정을 제거(토글) |
| 대상 범위 | **단일 항목 토글만** 1차 범위(파일·폴더 모두 가능). 다중 선택 일괄 고정은 1차 범위 밖(정직 표기) |
| 진입점 | 컨텍스트 메뉴(우클릭)로만 조작한다. 전용 단축키·툴바 버튼은 신설하지 않는다(신규 키 불요) |

**표시·정렬 규칙**
| 항목 | 동작 규칙 |
|---|---|
| 스크롤 고정(sticky) — 목록/자세히 | **목록(list)·자세히(details) 보기**에서는 고정된 항목이 **스크롤해도 항상 목록 최상단에 붙어(sticky) 계속 보인다** — 목록을 아래로 내려도 고정 항목 밴드는 상단에 고정되어 사라지지 않는다(폴더 우선 정렬(B2)보다도 위). **변경(2026-06-09): 기존 "최상단 정렬(스크롤하면 함께 밀려 올라감)" → "스크롤 고정(sticky·상단 밴드 유지)".** |
| 정렬 상단(밴드 비활성) — 그리드 | **아이콘 그리드(icons-large/medium/small) 보기**는 셀 wrapping 특성상 sticky 밴드가 부분 행을 점유하면 레이아웃이 깨지므로 **sticky를 적용하지 않는다** → 그리드에서는 기존대로 **"고정 항목을 목록 최상단에 정렬"만** 유지된다(스크롤하면 함께 밀려 올라감·밴드 비활성). 이 **보기별 차이는 의도된 동작**이다(정직 표기). |
| 그룹 내부 순서 | 고정 그룹 **내부**는 현재 정렬 기준대로 정렬된 순서를 유지한다(고정했다고 임의 순서가 되지 않음). 비고정 그룹도 현재 정렬 순서를 유지 |
| 키보드 내비게이션 보정 | sticky 밴드(목록/자세히)가 키보드로 이동 중인 항목을 가리지 않도록 **고정 밴드 높이만큼 추가 스크롤 보정**된다(포커스 항목이 밴드 아래로 가려지지 않음) |
| 시각 표식 | 고정 항목에 **📌 아이콘** 표시 — **그리드(아이콘) 보기 = 셀 좌상단 배지**, **목록/자세히 보기 = 이름 앞**. 접근성 레이블 "상단 고정됨" 부여 |
| 디렉토리 단위 | 고정은 **디렉토리(경로) 단위**로 관리된다 — 같은 경로를 다시 열었을 때만 그 고정이 보이고, 다른 폴더에는 영향 없다(`pinnedByDir`: dirPath → 항목 경로 배열) |
| 원격 경로 | 원격(SFTP/FTP·§M3) 경로도 **경로 단위로 동일하게** 동작한다(별도 제약 없음 — 원격 디렉토리 경로를 키로 고정·표시) |

**영속 규칙**
| 항목 | 동작 규칙 |
|---|---|
| 세션 영속 | 고정 상태는 세션(사이드바 스냅샷 `SidebarSnapshot.pinnedByDir`)에 **영속**되어 **앱 재시작 후에도 유지**된다. J7 별칭(`favoriteLabels`)과 동격의 per-위치 메타 확장(기존 스냅샷 데이터 비파괴) |
| 정규화 | 복원 시 값이 **문자열 배열인 항목만** 보존하고, **빈 배열 키는 제외**한다(무의미한 키 누적 방지·`coercePinnedByDir`) |

**범위 밖 (1차 — 정직 표기)**
| 항목 | 사유 |
|---|---|
| 고정 항목 간 수동 드래그 재정렬 | 고정 그룹은 **현재 정렬 기준 순서**를 따른다. 고정 항목끼리 드래그로 임의 순서를 만드는 것은 1차 범위 밖 |
| 다중 선택 일괄 고정 | 1차는 **단일 항목 토글**만. 여러 항목을 한 번에 고정/해제하는 것은 1차 범위 밖 |

**수용 기준** (✅ 구현 완료 — 코드 정합·verify 충족 / 실 GUI 동작은 🟡)
- [x] 파일 목록에서 단일 **파일 또는 폴더**를 우클릭하면 컨텍스트 메뉴에 **"상단 고정"** 항목이 나타나고, 선택하면 그 항목이 현재 디렉토리에서 고정된다 — `contextMenu.ts`(단일 선택 시 `pin` 항목·`togglePin(dirPath, single.path)`). ※ 실 GUI 🟡
- [x] 이미 고정된 항목을 우클릭하면 라벨이 **"상단 고정 해제"** 로 바뀌고, 선택하면 고정이 해제된다(토글) — `isPinned(dirPath, single.path)` 분기·`togglePin` 토글(`verify:store`). ※ 실 GUI 🟡
- [x] 고정된 항목은 **현재 정렬/필터와 무관하게 목록 최상단**에 모여 표시되며, **폴더 우선 정렬보다도 위**에 온다 — `domain/rules/sort.ts#applyPins`(정렬 직후 고정/비고정 분할·`[...top, ...rest]`·`verify:domain` 60)
- [x] **목록(list)·자세히(details) 보기에서는 스크롤해도 고정 항목 밴드가 항상 최상단에 붙어(sticky) 계속 보인다**(목록을 아래로 내려도 고정 항목이 사라지지 않음) — sticky 상단 밴드 렌더(`FileListView.tsx`). ※ 실렌더 🟡
- [x] **아이콘 그리드(icons-*) 보기에서는 sticky를 적용하지 않고 "정렬 최상단 유지"만** 동작한다(셀 wrapping 특성상 부분 행 점유로 레이아웃이 깨지므로 밴드 비활성 — 보기별 차이는 의도된 동작·정직 표기). ※ 실렌더 🟡
- [x] **키보드 내비게이션 시 sticky 밴드(목록/자세히)가 포커스 항목을 가리지 않도록 고정 밴드 높이만큼 추가 스크롤 보정**된다 — 키보드 이동 스크롤 보정(`FileListView.tsx`). ※ 실 GUI 🟡
- [x] 고정 그룹 **내부**는 현재 정렬 기준의 정렬된 상대 순서를 그대로 유지한다(고정/비고정 두 그룹 모두 정렬 순서 보존) — `applyPins`가 그룹 분할 시 입력(정렬된) 순서를 보존(`verify:domain`)
- [x] 고정 항목에 **📌** 표식이 표시된다 — **그리드=셀 좌상단 배지**, **목록/자세히=이름 앞**(접근성 레이블 "상단 고정됨") — `FileListView.tsx`(`pinned` prop·그리드 절대배치 배지·목록 이름 앞 span·`aria-label`). ※ 실렌더 🟡
- [x] 고정은 **디렉토리(경로) 단위**로 관리되어 같은 경로에서만 그 고정이 보이고 다른 폴더에는 영향이 없다 — `pinnedByDir[dirPath]` 키 분리·`pinnedHere = pinnedByDir[panel.path]` 구독(`verify:store`)
- [x] 고정 상태가 **세션에 영속**되어 앱 재시작 후에도 유지된다(빈 배열 키 제외·문자열 배열만 보존) — `session.ts`/`sidebarSlice` coerce(`pinnedByDir` 정규화)·`defaults.ts`·`SidebarSnapshot.pinnedByDir`(`verify:persistence` 101·`verify:store` 121). ※ 재시작 후 유지 육안 🟡
- [x] 원격(SFTP/FTP·§M3) 경로에서도 경로 단위로 동일하게 동작한다(별도 제약 없음) — `pinnedByDir` 키가 패널 경로 문자열(로컬/원격 무관)·`applyPins` 경로 비교 동일
- [x] 신규 IPC 채널·신규 npm 의존성 없이 렌더러+세션 영속만으로 동작하며, 기존 즐겨찾기(C4·J7)·정렬(B2)·필터·보기(J3) 동작과 충돌·회귀가 없다 — 신규 채널 0·의존성 0·`applyPins`는 정렬 결과에만 후처리(정렬/필터 로직 불변)
- [ ] 고정 항목 간 수동 드래그 재정렬 — **1차 범위 밖**(고정 그룹은 현재 정렬 기준 순서)
- [ ] 다중 선택 일괄 고정/해제 — **1차 범위 밖**(단일 항목 토글만)

---

## P. 듀얼 패널 폴더 비교·동기화 (2026-06-09 신규 기획 — P1 M6 메타·단일깊이 + M7 해시·재귀 확장 구현 완료(코드)·실 GUI·실 워커 🟡)

> **타 탐색기와의 강력한 차별화 1.** 이미 구현된 분할 패널(A2·2/4분할)·패널 간 D&D(A3)를 토대로, 좌/우 두 패널의 폴더를 **diff(차이 분석)** 하고 한쪽을 기준으로 **미러·동기화**하는 파워 기능이다. 핵심 차별점(여러 디렉토리 동시 관리)을 "비교·정리" 영역까지 확장한다.
> 우선순위 **S(Should·상위)** — 차별화 핵심이고 기존 2패널 인프라를 직접 활용한다. 단, 동기화는 파괴적 작업이라 데이터 안전(미리보기·확인·휴지통 경유)을 필수 수용 기준으로 둔다.
> 상태: **P1 M6 메타·단일깊이 구현 완료(코드)·실 GUI 런타임 스모크 🟡 (2026-06-09 M6 1차) + 해시(내용) 비교·재귀 비교 M7 확장 구현 완료(코드)·실 워커/GUI 런타임 스모크 🟡 (2026-06-09 M7 2차)**. 우선순위 근거는 [PRD §6 "MoSCoW 분류 근거(2026-06-09 §P~§U 파워 기능)"](./PRD.md#6-범위와-우선순위-moscow). 구현: `domain/rules/compare.ts`(4상태·`planMirror`·M7 `CompareOptions useHash/recursive`·`fromCompareResult`·`relPath`)·`compareSlice`(M7 해시잡 상태)·`usecases/compare`(M7 `hash:compare:*` 구독·옵션 off는 M6 메타 동치)·`ui/compare/`(CompareToolbar/CompareView 해시·재귀 토글·진행률)·`CompareStatus`/`ComparePairDTO.relPath?` DTO·미러=기존 `op:*`·M7 신규 채널 `hash:compare:*`·`main/hash/compareEngine.ts`. 보안: ADR-005 프로세스 보안·경로 검증·throw0/Result·IPC guard 준수·SHA-256=node:crypto 내장. 외부로 나가는 네트워크/실행 없음. 범례: ✅ 구현 완료 · 🟡 부분 · 🔜 미착수.

### P1. 듀얼 패널 폴더 비교 (S) ✅ 구현 완료 (M6 메타·단일깊이 + M7 해시·재귀 확장 — 실 GUI 진입/미러/동기스크롤·실 해시 워커 비교 런타임 스모크 🟡)
**목적**: 두 폴더(좌/우 패널)의 차이를 한눈에 파악하고, 한쪽 기준으로 안전하게 맞춘다. (US-15.1)

**비교(diff) 규칙**
| 항목 | 동작 규칙 |
|---|---|
| 비교 진입 | 좌우 2분할 상태에서 "폴더 비교" 토글(아이콘바·우클릭·메뉴). 두 패널 폴더를 같은 이름 기준으로 짝지어 비교 |
| 비교 기준 | 기본 = **이름 + 크기 + 수정일**. 옵션으로 **해시(내용) 비교**(켜면 같은 이름·같은 크기 항목만 해시 계산해 내용 동일 여부 판정) |
| 차이 분류 | 항목을 4상태로 분류·강조: **좌만 있음 / 우만 있음 / 양쪽 다름(크기·수정일·해시 차이) / 같음**. 색·아이콘으로 시각 구분 |
| 폴더 재귀 | 하위 폴더는 같은 이름끼리 재귀 비교(폴더 자체는 "양쪽 존재 + 내부 차이 유무" 표시). 1차는 **현재 폴더 1단계 + 펼친 하위만** (전체 재귀 깊이 비교는 옵션·아래 MVP 경계) |
| 동기 스크롤 | "동기 스크롤" 토글 — 한쪽을 스크롤하면 짝지어진 다른 패널도 같은 위치로 따라 스크롤(짝 없는 항목은 빈 줄/플레이스홀더로 정렬 유지) |
| 필터 | "차이만 보기" 토글(같음 항목 숨김), 기존 검색/필터(D1·D2)와 병행 |

**동기화(미러) 규칙 — 데이터 안전 핵심**
| 항목 | 동작 규칙 |
|---|---|
| 방향 | **좌→우 미러 / 우→좌 미러 / 양방향 병합** 중 선택. "미러"는 기준 쪽에 맞춰 대상 쪽을 동일하게 만든다 |
| 미리보기 필수 | 실행 전 **변경 미리보기**(복사 N건·덮어쓸 M건·삭제 K건)를 요약으로 보여주고, 사용자 확정 전에는 어떤 파일도 건드리지 않는다 |
| 삭제 처리 | 미러 시 기준에 없는 대상 파일 삭제는 **휴지통 경유**(영구삭제 아님)·기본 off. 켤 때 별도 확인 |
| 충돌·실패 | 복사/덮어쓰기 충돌은 D4 규칙 준용, 진행률·취소·부분 실패 요약은 E4·US-5.2 준용 |
| 되돌리기 | 동기화로 수행된 복사/이동/휴지통 삭제는 가능 범위에서 K1 되돌리기 스택에 누적 |

**MVP 경계 (1차 — 정직 표기)**
| 1차 포함 | 1차 제외 |
|---|---|
| 좌/우 2패널 이름+크기+수정일 비교, 4상태 강조, 동기 스크롤 토글, 차이만 보기, 좌→우·우→좌 미러(미리보기·확인·휴지통 삭제) | 해시(내용) 비교는 **옵션(기본 off·같은 이름·같은 크기 한정)**; 무제한 깊이 전체 재귀 자동 비교(대용량 트리 성능); 4분할 동시 비교(2패널만); 실시간 자동 동기화(수동 실행만); 원격(M3)↔로컬 비교 |

**비기능·제약**
- 해시 계산·대용량 비교는 워커/별도 프로세스(UI 비차단·진행률·취소), 메인 스레드 차단 금지(PRD §7 성능).
- 경로 검증·순환 링크 차단(F장)·throw0/Result·IPC guard(ADR-005). 외부 네트워크 전송 없음.

**수용 기준** (메타·단일깊이 ✅ 구현 완료(코드)·실 GUI 🟡 / 해시·재귀 M7 연기 🔜)
- [x] 좌우 2분할에서 "폴더 비교"를 켜면 두 패널 항목이 이름 기준으로 짝지어지고 **좌만/우만/다름/같음** 4상태가 색·아이콘으로 구분 표시된다 *(메타 비교 ✅ 코드·실 GUI 🟡)*
- [ ] 비교 기준에 **해시(내용) 비교** 옵션이 있으며, 켜면 같은 이름·같은 크기 항목의 내용 동일 여부까지 판정한다(끄면 메타만) *(🔜 M7 연기 — M6는 메타만)*
- [x] "동기 스크롤"을 켜면 한 패널 스크롤 시 짝지어진 다른 패널이 같은 위치로 따라 스크롤된다 *(✅ 코드 `useSyncScroll`·실 GUI 🟡)*
- [x] "차이만 보기"로 같음 항목을 숨길 수 있다 *(✅ 코드·실 GUI 🟡)*
- [ ] (미해결/설계 인계) "차이만 보기"가 기존 검색/필터(D1·D2)·태그 필터(T1)와 동시 적용될 때의 합성 규칙(AND/OR)은 chief-architect 설계에서 확정 *(프리셋 T3은 2026-06-09 폐기·제외)*
- [ ] **좌→우 / 우→좌 미러** 실행 전 **변경 미리보기(복사·덮어쓰기·삭제 건수)** 가 표시되고, 확정 전에는 파일이 변경되지 않는다
- [ ] 미러 중 기준에 없는 대상 파일 삭제는 **휴지통 경유**이며 기본 off, 켤 때 별도 확인을 거친다
- [ ] 충돌은 D4, 진행률·취소·부분 실패 요약은 E4/US-5.2를 따른다
- [ ] 해시 계산·대용량 비교가 백그라운드에서 처리되어 UI를 막지 않고 취소 가능하다
- [ ] (범위 밖) 무제한 깊이 전체 재귀 자동 비교·4분할 동시 비교·실시간 자동 동기화·원격↔로컬 비교는 1차 제외

---

## Q. 압축파일(zip 등) 폴더처럼 열기 (2026-06-09 신규 기획 — M9 구현 완료(코드)·실 GUI·실 워커 🟡)

> **타 탐색기와의 강력한 차별화 2.** 압축파일을 별도 도구 없이 **폴더처럼 진입·탐색**하고, 항목을 **추출**하거나 새 항목을 **추가**한다. 기존 원격(M3) RemoteAdapter 패턴처럼 `archive://` 네임스페이스 어댑터로 패널 하나에 압축 내부를 여는 것이 설계 힌트다(설계는 chief-architect).
> 우선순위 **S(Should)** — 일상 빈도가 높은 차별화 기능이나, 압축 포맷·쓰기(추가)·암호화 변수로 MVP 범위를 좁힌다.
> 상태: **M9 구현 완료(코드)·통합 검증 PASS ✅ / 실 GUI·실 워커 런타임 스모크 🟡**(2026-06-10·신규 채널 `archive:*` 5종·신규 의존성 yauzl/yazl·`verify:archive` 56·`verify:archiveui` 43). 보안: 압축 해제 경로 검증·**Zip Slip(상위 경로 이탈) 차단**(M3에서 확립한 원칙 재사용·`shared/archive/safePath.ts` 순수+워커 양쪽·ADR-008 결정④)·throw0/Result·IPC guard(ADR-005). 외부 네트워크 전송 없음. 범례: ✅ · 🟡 · 🔜.

### Q1. 압축파일 폴더처럼 열기·추출·추가 (S) ✅ 구현 완료(코드) (실 GUI·실 워커 런타임 스모크 🟡)
**목적**: 압축파일을 풀지 않고 내부를 탐색하고, 필요한 것만 꺼내거나 넣는다. (US-16.1)

| 항목 | 동작 규칙 |
|---|---|
| 진입 | 압축파일(zip) 더블클릭/Enter 또는 우클릭 "폴더처럼 열기" → 패널에 압축 내부를 디렉토리처럼 표시(목록/정렬/주소 표시줄·`archive://` 경로 표기) |
| 탐색 | 내부 폴더 진입·상위/뒤로(C2)·브레드크럼(C1) 동작. 로컬과 동일 UX |
| 추출 | 내부 항목 선택 → 다른 패널(로컬)로 **D&D/복사·붙여넣기** 또는 우클릭 "추출"로 꺼내기(다중·폴더 포함, 진행률·취소·충돌 D4) |
| 추가 | 로컬 항목을 압축 패널로 **D&D/붙여넣기** 시 압축에 항목 추가(쓰기 가능 포맷·아래 MVP 경계) |
| 표시 구분 | 압축 내부 패널은 로컬과 시각 구분(경로 배지·아이콘). 압축 파일 자체는 목록에서 일반 파일 + "폴더처럼 열기" 액션 |

**MVP 경계 (1차 — 정직 표기)**
| 1차 포함 | 1차 제외 |
|---|---|
| **zip만** 진입·탐색·추출(읽기). zip로의 **항목 추가(쓰기)** | **암호(비밀번호) 걸린 zip**; zip 외 포맷(7z·rar·tar.gz 등); 압축 내부 직접 편집(저장 후 재압축); 압축 내부 항목 이름변경/삭제(쓰기 고급); 중첩 압축(zip 안의 zip) 재귀 진입; 원격(M3) 상의 압축 진입 |

**비기능·제약**
- 추출/추가는 워커/별도 처리(UI 비차단·진행률·취소). 대용량 압축 스트리밍 처리.
- **Zip Slip 차단**(`../` 등 상위 경로 이탈 엔트리는 거부·정규화 후 대상 폴더 내부로만 추출), 경로 검증(F장)·throw0/Result·IPC guard(ADR-005).

**수용 기준** (M9 구현 완료(코드)·실 GUI·실 워커 🟡)
- [x] zip 파일을 더블클릭/우클릭 "폴더처럼 열기"로 패널에서 내부를 디렉토리처럼 탐색할 수 있다(목록·정렬·브레드크럼·뒤로/위로) — `renderer/app/usecases/archive.ts`·`main/archive/{ArchiveService,ZipReader}`·`archive:open/list` 채널. ※ 실 zip 열기/탐색 🟡
- [x] 내부 항목을 다른(로컬) 패널로 D&D/복사·붙여넣기 또는 "추출"로 꺼낼 수 있고, 다중/폴더·진행률·취소·충돌(D4)이 적용된다 — `archive:extract`·추출 진행률=기존 `op:*` 재사용. ※ 실 추출 IPC 왕복 🟡
- [x] 로컬 항목을 zip 패널로 D&D/붙여넣기하면 zip에 추가된다(쓰기) — `main/archive/ZipWriter`(yazl)·`archive:add`. ※ 실 추가 IPC 왕복 🟡
- [x] **암호 zip은 1차 제외**되며, 만나면 명확히 "지원하지 않음(암호 보호)" 안내한다(빈 화면·크래시 없음) — `archiveErrors` EUNSUPPORTED. ※ 실 동작 🟡
- [x] 추출 시 **Zip Slip(상위 경로 이탈) 엔트리는 차단**되고 대상 폴더 내부로만 풀린다 — `shared/archive/safePath.ts`(순수)+워커 양쪽 검증·ADR-008 결정④·`verify:archive` 56
- [x] 추출/추가가 백그라운드 처리되어 UI를 막지 않고 취소 가능하다 — `main/workers/archiveWorker.ts`·기존 `op:*` 취소 재사용. ※ 실 비차단/취소 🟡
- [ ] (범위 밖) 7z·rar 등 zip 외 포맷·중첩 압축 재귀·압축 내부 이름변경/삭제·원격 압축 진입은 1차 제외

---

## R. 파워 파일 작업 (2026-06-09 신규 기획 — R1 구현 완료(코드, M6)·실 GUI 🟡 / R2·R3·R4 구현 완료(코드, M7)·실 워커·GUI 🟡)

> **파워유저 작업 묶음.** 대량 정리에 쓰는 4기능을 한 챕터로 묶는다: **R1 고급 일괄 이름변경 · R2 중복 파일 찾기 · R3 전송 큐 매니저 · R4 복사 시 체크섬 검증**. 기존 일괄 작업(E3)·진행률(E4)·되돌리기(K1)·`op:*` 전송 인프라를 확장한다.
> 우선순위: R1·R2 = **S(Should)**(파워유저 핵심 가치), R3 = **S(Should)**(기존 op:* 통합), R4 = **C(Could)**(안전 옵션·비용 대비 빈도 낮음).
> 상태: **R1 구현 완료(코드)·실 GUI 런타임 스모크 🟡 (2026-06-09 M6 1차) / R2·R3·R4 구현 완료(코드)·실 워커/GUI 런타임 스모크 🟡 (2026-06-09 M7 2차 — 공용 해시 인프라 W1·전송 큐 인프라 W2·신규 채널 `hash:*`/`queue:*`·신규 의존성 0)**. R1 구현: `domain/rules/batchRename.ts`·`usecases/batchRename`·`ui/rename/BatchRenameDialog`·신규 채널 0. R2: `domain/rules/dupGroup.ts`·`dedupSlice`·`usecases/dedup.ts`·`ui/dedup/DuplicatesDialog.tsx`·`main/hash/dupEngine.ts`·`hash:dup:*`·정리=기존 `op:trash`. R3: `main/operations/TransferQueue.ts`·`OperationManager` 큐 승격·`usecases/queue.ts`·`ui/queue/`·`queue:*`·SharedArrayBuffer cancel+pause. R4: `domain/rules/checksumVerdict.ts`·`usecases/checksum.ts`·`verifyOnCopy`·op:done 후 `hash:verify` 트리거. 보안: 해시·전송은 워커·경로 검증·throw0/Result·IPC guard(ADR-005)·SHA-256=node:crypto 내장. 외부 네트워크 전송 없음. 범례: ✅ · 🟡 · 🔜.
> **챕터↔에픽 매핑**: 본 챕터(§R) = **에픽17**(US-17.1 R1 · US-17.2 R2 · US-17.3 R3 · US-17.4 R4). 4기능:1에픽 구조이므로 절별 US 번호를 위 매핑으로 확인할 것.

### R1. 고급 일괄 이름변경 (S) ✅ 구현 완료 (실 파일 왕복·Ctrl+Z 실복원 런타임 스모크 🟡)
**목적**: 여러 파일을 규칙(패턴·정규식·연번·대소문자)으로 한 번에, 안전하게 이름변경한다. (US-17.1 · 에픽17)

| 항목 | 동작 규칙 |
|---|---|
| 진입 | 다중 선택 → 우클릭/아이콘바 "일괄 이름변경" → 전용 다이얼로그 |
| 규칙 | **찾기/바꾸기(문자열·정규식), 접두/접미 추가, 연번(시작값·자릿수·증가폭), 대소문자 변환(UPPER/lower/Title), 확장자 변경/유지** 조합 |
| 실시간 미리보기 | 규칙 입력 즉시 **현재명 → 변경 후 명** 표 미리보기(적용 전 결과 확인) |
| 충돌 검사 | 변경 후 이름이 **서로 충돌하거나 기존 파일과 충돌**하면 해당 행을 경고 표시하고, 충돌이 있으면 실행 차단 또는 충돌 행 제외 선택 |
| 되돌리기 | 일괄 이름변경 전체를 **한 번의 Ctrl+Z(K1)** 로 되돌릴 수 있게 묶어 push |
| 안전 | 금지문자(`\ / : * ? " < > |`)·예약명·빈 이름 차단·안내(B3 준용) |

**MVP 경계**: 1차 포함 = 찾기/바꾸기(정규식)·접두/접미·연번·대소문자·실시간 미리보기·충돌 검사·일괄 undo. 1차 제외 = EXIF/미디어 메타데이터 기반 명명·다단계 규칙 저장(이름변경 프리셋은 후속)·정규식 캡처그룹 고급 치환 함수.

**수용 기준** (✅ 구현 완료(코드)·실 GUI 런타임 스모크 🟡 — `verify:domain`/`verify:store` 충족)
- [x] 다중 선택 후 일괄 이름변경 다이얼로그에서 찾기/바꾸기(정규식 포함)·접두/접미·연번·대소문자 규칙을 조합할 수 있다 *(✅ 코드·실 GUI 🟡)*
- [x] 규칙 입력 시 현재명→변경후명이 실시간 표로 미리보기된다(적용 전) *(✅ 코드·실 GUI 🟡)*
- [x] 변경 후 이름끼리 또는 기존 파일과 **충돌하면 경고**되고, 충돌 상태로는 임의 덮어쓰기 없이 실행이 차단(또는 충돌 행 제외)된다 *(✅ `batchRename.ts` 충돌검사)*
- [x] 금지문자·예약명·빈 이름은 차단·안내된다(B3) *(✅ 코드)*
- [x] 일괄 이름변경 전체를 한 번의 `Ctrl+Z`로 되돌릴 수 있다(K1 연계) *(✅ `undoSlice kind:'batchRename'`·실 복원 🟡)*
- [ ] (범위 밖) 미디어 메타데이터 기반 명명·이름변경 규칙 저장(프리셋)은 1차 제외

### R2. 중복 파일 찾기 (S) ✅ 구현 완료(코드, M7) — 실 워커 해시 잡·실 GUI 중복 정리 런타임 스모크 🟡 (`domain/rules/dupGroup.ts`·`dedupSlice`·`usecases/dedup.ts`·`ui/dedup/DuplicatesDialog.tsx`·`main/hash/dupEngine.ts`·신규 채널 `hash:dup:*`·`hash:cancel`·정리=기존 `op:trash` 재사용)
**목적**: 해시 기반으로 내용이 같은 중복 파일을 찾아 안전하게 정리한다. (US-17.2)

| 항목 | 동작 규칙 |
|---|---|
| 범위 | 선택 폴더 / 드라이브 / 패널(현재 폴더·하위) 중 지정 |
| 탐지 | 1차 크기 그룹핑 → 같은 크기끼리 **해시 비교**로 내용 동일 그룹 확정(불필요한 전체 해시 방지) |
| 결과 표시 | 중복 그룹별로 묶어 표시(그룹 내 파일 경로·크기·수정일), 그룹별 "원본 1개 남기고 나머지 선택" 보조 |
| 정리 | 선택 항목을 **휴지통으로** 삭제(영구삭제 아님·기본). 실행 전 요약·확인 |
| 안전 | 그룹 내 전체 선택(모두 삭제) 방지 가드(최소 1개 보존 권고)·되돌리기(K1) 연계 |

**MVP 경계**: 1차 포함 = 폴더/드라이브/패널 범위·크기+해시 2단계 탐지·그룹 표시·선택 정리(휴지통)·진행률/취소. 1차 제외 = 유사 이미지(perceptual hash) 탐지·자동 정리(사용자 확인 없이)·중복 하드링크 대체·원격(M3) 범위.

**수용 기준** (🔜 미착수)
- [ ] 범위(폴더/드라이브/패널)를 지정해 중복 탐지를 시작할 수 있다
- [ ] **크기 그룹핑 후 해시 비교** 2단계로 내용 동일 파일을 그룹으로 묶어 표시한다(불필요한 전체 해시 회피)
- [ ] 그룹별로 "원본 하나 남기고 나머지 선택" 보조가 제공되고, 선택 항목을 **휴지통으로** 정리한다(실행 전 요약·확인)
- [ ] 탐지가 백그라운드(워커)에서 처리되어 UI를 막지 않고 진행률·취소가 동작한다
- [ ] 정리 삭제는 K1 되돌리기와 연계되고, 그룹 전체 삭제(보존 0)에는 경고한다
- [ ] (범위 밖) 유사 이미지 탐지·무확인 자동 정리·원격 범위는 1차 제외

### R3. 전송 큐 매니저 (S) ✅ 구현 완료(코드, M7) — 실 스케줄러 일시정지/재개·실 GUI 큐 패널 런타임 스모크 🟡 (`main/operations/TransferQueue.ts`·`OperationManager` 큐 승격·신규 채널 `queue:*`·`usecases/queue.ts`·`ui/queue/(QueuePanel·QueueItemRow·QueueConcurrencyControl·queueFormat)`·StatusBar 합산·SharedArrayBuffer 2워드 cancel+pause·원격 큐 일시정지 미배선 정직 표기)
**목적**: 복사/이동/원격 전송을 하나의 큐로 모아 목록·진행률·일시정지/재개·동시성으로 관리한다. (US-17.3)

| 항목 | 동작 규칙 |
|---|---|
| 통합 큐 | 로컬 복사/이동·원격(M3) 업/다운로드를 **단일 큐**로 표시(기존 `op:*`/`remote:*` 작업을 큐 항목으로 통합) |
| 항목 정보 | 작업별 소스/대상·전체 진행률·현재 파일·속도·남은 시간·상태(대기/진행/일시정지/완료/실패) |
| 제어 | 작업별 **일시정지/재개·취소**, 큐 **동시 실행 개수(동시성) 설정** |
| 결과 | 완료/실패 항목 누적·부분 실패 요약(E4·US-5.2)·실패 항목 재시도 |
| 비차단 | 큐 패널을 열어둔 채 탐색 가능(UI 비차단), 큐는 상태바 인디케이터와 연동 |

**MVP 경계**: 1차 포함 = 로컬+원격 통합 큐·작업별 진행률/속도·일시정지/재개·취소·동시성 설정·실패 재시도. 1차 제외 = 작업 우선순위 재정렬(드래그)·대역폭 제한(스로틀 수치 지정)·앱 종료 후 큐 영속/재개·세부 청크 단위 이어받기.

**수용 기준** (🔜 미착수)
- [ ] 로컬 복사/이동과 원격 업/다운로드가 하나의 큐 목록에 통합 표시된다
- [ ] 각 작업의 진행률·현재 파일·속도·상태가 표시되고, 작업별 일시정지/재개·취소가 동작한다
- [ ] 큐의 동시 실행 개수(동시성)를 설정할 수 있다
- [ ] 실패 항목이 요약되고 재시도할 수 있다(E4/US-5.2)
- [ ] 큐를 연 채로 탐색이 가능하다(UI 비차단)
- [ ] (범위 밖) 작업 드래그 재정렬·대역폭 제한·앱 종료 후 큐 영속·청크 이어받기는 1차 제외

### R4. 복사 시 체크섬 검증 (C) ✅ 구현 완료(코드, M7) — 실 복사후 검증 트리거 타이밍(비원자 복사) 런타임 스모크 🟡 (`domain/rules/checksumVerdict.ts`·`usecases/checksum.ts`·`SettingsSnapshot.verifyOnCopy` 기본 off·SettingsDialog 토글·`operationsBridge` op:done 후 `hash:verify` 트리거·`main/hash/verifyEngine.ts`·신규 채널 `hash:verify:*`)
**목적**: 복사 후 원본·사본 해시를 비교해 무결성을 검증한다(옵션). (US-17.4)

| 항목 | 동작 규칙 |
|---|---|
| 옵션 | 설정 또는 복사 시 "복사 후 체크섬 검증" 토글(기본 off — 성능 영향) |
| 동작 | 복사 완료 후 원본·사본 해시 비교 → 일치=검증됨 표식, 불일치=경고·실패 항목 보고 |
| 범위 | 로컬 복사 및 원격(M3) 전송에 적용 가능. 이동은 복사+삭제 시 복사분 검증 후 원본 삭제 |
| 비차단 | 해시 계산은 워커·진행률에 검증 단계 포함, 취소 가능 |

**MVP 경계**: 1차 포함 = 로컬 복사 후 옵션 체크섬 검증·불일치 경고·결과 요약. 1차 제외 = 항상 켜기(강제)·검증 실패 시 자동 재복사·원격 전송 체크섬(원격은 ADR-007 deferral 연계·후속)·체크섬 알고리즘 선택 UI.

**수용 기준** (🔜 미착수)
- [ ] "복사 후 체크섬 검증" 옵션이 있고 기본 off이며, 켜면 복사 완료 후 원본·사본 해시를 비교한다
- [ ] 불일치 시 경고하고 실패 항목으로 결과 요약에 보고한다(임의 무시 없음)
- [ ] 검증 단계가 진행률에 포함되고 취소 가능하다(UI 비차단)
- [ ] (범위 밖) 강제 항상 검증·자동 재복사·원격 전송 체크섬·알고리즘 선택 UI는 1차 제외

---

## S. 검색·실행 가속 (2026-06-09 신규 기획 — M8 구현 완료(코드)·실 GUI/실 워커 🟡)

> **찾기·실행을 빠르게.** **S1 내용 검색(grep) · S2 명령 팔레트** 2기능. 기존 이름 검색/필터(D1·D2)와 단축키 체계(E1)를 확장한다.
> 우선순위: S1 = **S(Should)**(개발자·파워유저 핵심 가치), S2 = **S(Should)**(전역 실행 가속).
> 상태: **M8 구현 완료(코드)·실 GUI/실 워커 런타임 스모크 🟡(2026-06-10)**. S1=신규 채널 `search:content:*` 5종·`main/search/`·`grepWorker`·신규 의존성 0(Node 내장)·ADR-010·`verify:search` 58·`verify:contentsearch` 38, S2=신규 채널 0·`ui/palette/CommandPalette`·`paletteMatch`·`Ctrl+Shift+P`·`verify:palette` 20. 보안: grep은 워커/별도 처리·바이너리 제외·크기 상한·경로 검증·throw0/Result·IPC guard(ADR-005). 외부 네트워크 전송 없음. 범례: ✅ · 🟡 · 🔜.

### S1. 내용 검색(grep) (S) — 구현 완료(코드)·실 워커/GUI 🟡
**목적**: 파일 **내부 텍스트**를 검색해(현재는 이름 필터만) 결과로 점프한다. (US-18.1)

| 항목 | 동작 규칙 |
|---|---|
| 진입 | 검색창 모드 토글 "내용 검색"(기존 이름 검색 D1과 별도 모드) 또는 전용 패널 |
| 범위 | 현재 폴더(하위 포함 토글), 검색어(문자열·정규식 옵션) |
| 제외/상한 | **바이너리 파일 자동 제외**(확장자/내용 휴리스틱), **파일 크기 상한**(초과 파일 건너뜀), 숨김/시스템 제외 토글 |
| 결과 | 파일별 일치 줄(라인 번호·해당 줄 발췌) 목록, 일치 부분 하이라이트 |
| 점프 | 결과 클릭 → 해당 파일로 목록 점프 + 미리보기 패널(D3·J5)에서 해당 위치로 스크롤 |
| 비차단 | 백그라운드 워커 검색·진행률·취소, 대량 결과 가상 스크롤 |

**MVP 경계**: 1차 포함 = 현재 폴더(+하위 토글) 텍스트/정규식 검색·바이너리 제외·크기 상한·결과 목록(라인)·미리보기 점프·진행률/취소. 1차 제외 = 전 디스크 인덱싱(풀텍스트 인덱스·PRD Won't "내용 전문 인덱싱" 유지)·검색 결과에서 직접 일괄 치환(편집)·인코딩 자동 감지 고급·원격(M3) 내용 검색.

**수용 기준** (구현 완료(코드)·실 GUI/실 워커 런타임 스모크 🟡)
- [x] 검색창 "내용 검색" 모드로 현재 폴더(하위 포함 토글) 파일 내부 텍스트를 검색한다(정규식 옵션) *(코드·실 GUI 🟡)*
- [x] **바이너리 파일은 자동 제외**되고, **크기 상한 초과 파일은 건너뛴다**(설정값) *(코드·`binaryDetect.ts`)*
- [x] 결과가 파일별 일치 줄(라인 번호·발췌)로 표시되고 일치 부분이 하이라이트된다 *(코드·match ranges [start,end) end-exclusive)*
- [x] 결과 클릭 시 해당 파일로 점프하고 미리보기에서 해당 위치를 보여준다 *(코드·`preview:read` 재사용·실 표출 🟡)*
- [x] 검색이 백그라운드에서 처리되어 UI를 막지 않고 진행률·취소가 동작한다 *(코드·grep 워커·`search:content:*`·실 스트리밍 🟡)*
- [x] (범위 밖) 전 디스크 풀텍스트 인덱싱(PRD Won't 유지)·결과 직접 일괄 치환·원격 내용 검색은 1차 제외

### S2. 명령 팔레트(Ctrl+Shift+P) (S) — 구현 완료(코드)·실 GUI 🟡
**목적**: 모든 명령·즐겨찾기·최근·드라이브를 한 입력창에서 검색·실행·점프한다. (US-18.2)

| 항목 | 동작 규칙 |
|---|---|
| 진입 | `Ctrl+Shift+P`(현재 미배정 — §8 신규 단축키)로 팔레트 오버레이 열기, `Esc` 닫기 |
| 검색 대상 | **명령(commandId 전체·단축키 표기)·즐겨찾기·최근 위치·드라이브** 통합 검색(부분 일치·점수 정렬) |
| 실행/점프 | 명령 항목 = 활성 패널에 실행(키보드/아이콘바와 동일 commandId 수렴), 위치 항목(즐겨찾기/최근/드라이브) = 그 경로로 이동 |
| 키보드 | 위/아래로 항목 이동·Enter 실행·최근 사용 명령 상단 가중 |
| 일관성 | 명령은 기존 commandBus 경로로 수렴(중복 로직 없음), 컨텍스트 불가 명령은 흐림/제외 |

**MVP 경계**: 1차 포함 = 명령+즐겨찾기+최근+드라이브 통합 검색·실행/점프·키보드 내비·`Ctrl+Shift+P`. 1차 제외 = 파일/폴더 내용 검색 결과를 팔레트에 통합(S1과 분리)·사용자 정의 매크로/체이닝·플러그인 명령(PRD Could "플러그인" 유지).

**수용 기준** (구현 완료(코드)·실 GUI 런타임 스모크 🟡)
- [x] `Ctrl+Shift+P`로 명령 팔레트가 열리고 `Esc`로 닫힌다(신규 단축키·기존 키와 충돌 없음) *(코드·실 GUI 🟡)*
- [x] 입력으로 명령·즐겨찾기·최근·드라이브를 통합 검색(부분 일치)하고 점수/최근 가중으로 정렬한다 *(코드·`paletteMatch.ts`)*
- [x] 명령 항목 실행은 키보드/아이콘바와 **동일 commandId**로 수렴하고, 위치 항목 선택은 그 경로로 이동한다 *(코드·commandBus 수렴)*
- [x] 위/아래·Enter 키보드만으로 검색·실행이 가능하다 *(코드·실 GUI 🟡)*
- [x] 컨텍스트상 불가능한 명령은 흐림/제외된다 *(코드)*
- [x] (범위 밖) 파일 내용 검색 통합·사용자 매크로·플러그인 명령은 1차 제외

---

## T. 메타·표시 UX (2026-06-09 신규 기획 — T1·T2 M8 구현 완료(코드)·실 GUI 🟡 / T3 폐기(코드 제거))

> **항목 메타와 표시를 풍부하게.** **T1 파일 태그/색상 라벨 · T2 상세 보기 폴더 용량 인라인 · ~~T3 정렬/필터 프리셋 저장~~(폐기)** 3기능. 기존 per-위치 메타(J7 별칭·N1 워터마크·O1 고정)·정렬/필터(B2·D2)·세션 영속 패턴을 확장한다.
> 우선순위: T1 = **S(Should)**, T2 = **S(Should)**, ~~T3 = **S(Should)**~~(등급 보존·폐기).
> 상태: **T1·T2는 M8 구현 완료(코드)·실 GUI 런타임 스모크 🟡(2026-06-10) / T3는 M6에서 구현 완료(코드)됐다가 2026-06-09 사용자 결정으로 폐기·코드 전면 제거(아래 T3 절 참조)**. T1=신규 채널 0·`domain/rules/tags.ts`(7색 팔레트·`matchesTags`)·`tagsSlice`·세션 메타 `tagsByPath`+coerce·**T3 폐기로 삭제됐던 `filterComposition.ts` 태그 합성을 T1에서 재설계**, T2=신규 채널 0·`usecases/folderSize`·`analyze:scan:*` 재사용. T3 제거 내역: `domain/rules/filterComposition.ts`·`presetsSlice`·`usecases/presets`·`ui/preset/PresetBar+PresetManageDialog`·`FilterPreset` DTO 삭제·`selectors.computeVisible`→기존 `filterEntries` 환원·`SESSION_SCHEMA_VERSION` 2→1 환원. 범례: ✅ · 🟡 · 🔜 · ❌ 폐기.

### T1. 파일 태그 / 색상 라벨 (S) — 구현 완료(코드)·실 GUI 🟡
**목적**: 파일/폴더에 색 태그를 붙여 분류하고 태그로 필터한다. (US-19.1)

| 항목 | 동작 규칙 |
|---|---|
| 부여 | 항목 우클릭 "태그/라벨" → 색상 라벨(예: 빨강/노랑/초록/파랑/보라/회색 등 고정 팔레트) 1개 이상 부여·해제 |
| 표시 | 목록/그리드에서 항목에 색 점·테두리 등으로 태그 시각 표시(테마 대비 유지·WCAG) |
| 필터 | 태그로 필터(특정 색만 보기), 기존 검색/필터(D1·D2)와 병행 |
| 영속 | 태그는 per-경로 메타로 세션 영속(J7 별칭·O1 고정과 동격 패턴, 기존 스냅샷 비파괴 확장) |
| 안전 | 태그는 **앱 내부 메타**(파일 자체·NTFS 대체스트림 미변경 — 데이터 비파괴) |

**MVP 경계**: 1차 포함 = 고정 색 팔레트 라벨 부여/해제·목록/그리드 표시·태그 필터·세션 영속(앱 내부 메타). 1차 제외 = 사용자 정의 태그명/색 추가·NTFS 대체데이터스트림이나 OS 태그 연동·태그 기반 전역 검색(전 디스크)·태그 동기화.

**수용 기준** (구현 완료(코드)·실 GUI 런타임 스모크 🟡)
- [x] 항목 우클릭에서 색상 라벨(고정 7색 팔레트)을 부여·해제할 수 있다 *(코드·contextMenu "태그" 서브메뉴·실 GUI 🟡)*
- [x] 부여한 태그가 목록/그리드에서 색으로 표시되고 테마 대비를 유지한다 *(코드·FileListView 태그 점)*
- [x] 태그로 목록을 필터할 수 있다(기존 검색/필터와 병행) *(코드·SearchBar 태그칩·`computeVisible` 이름+태그 합성)*
- [x] 태그 필터가 기존 검색/필터(D1·D2)와 합성될 때의 규칙을 **T1에서 신설**(T3 폐기로 삭제된 `filterComposition.ts` 태그 합성을 `domain/rules/tags.ts`·`selectors.computeVisible`로 재설계 — 이름+태그 합성)
- [x] 태그가 per-경로 메타로 세션에 영속되어 재시작 후 유지된다(기존 스냅샷 비파괴·`SidebarSnapshot.tagsByPath`+coerce·`SESSION_SCHEMA_VERSION` 무변경)
- [x] 태그는 앱 내부 메타로 저장되어 파일 자체를 변경하지 않는다(데이터 비파괴)
- [x] (범위 밖) 사용자 정의 태그명/색·OS 태그/ADS 연동·전 디스크 태그 검색·동기화는 1차 제외

### T2. 상세 보기 폴더 용량 인라인 (S) — 구현 완료(코드)·실 GUI 🟡
**목적**: 자세히 보기에서 폴더 크기를 온디맨드로 계산해 인라인 표시한다(취소 가능·비차단). (US-19.2)

| 항목 | 동작 규칙 |
|---|---|
| 트리거 | 자세히(details) 보기 폴더 행의 크기 칸에서 "계산"(클릭/우클릭) 또는 설정 "폴더 크기 자동 계산"(기본 off — 성능) |
| 동작 | 폴더 재귀 합계를 백그라운드 계산 → 완료 시 해당 행 크기 칸에 표시(계산 중=스피너/진행 표기) |
| 취소·비차단 | 계산 중에도 탐색 가능, 다른 폴더로 이동/정렬 변경 시 진행 계산 취소·정리 |
| 재사용 | I1 사용량 대시보드 스캔 엔진(`scanEngine`)·순환 차단·권한 skip 재사용 가능(설계는 architect) |

**MVP 경계**: 1차 포함 = 자세히 보기 폴더 행 온디맨드 크기 계산·인라인 표시·취소·비차단·권한 skip/순환 차단. 1차 제외 = 모든 폴더 자동 일괄 계산(기본 on)·크기 결과 영속 캐시·그리드/목록 보기 폴더 크기 표시(자세히 전용)·실시간 갱신(워처 연동).

**수용 기준** (구현 완료(코드)·실 GUI 런타임 스모크 🟡)
- [x] 자세히 보기 폴더 행에서 온디맨드로 폴더 재귀 크기를 계산해 크기 칸에 인라인 표시한다 *(코드·`usecases/folderSize`·지연·캐시·디듀프·실 스캔 🟡)*
- [x] 계산이 백그라운드에서 처리되어 UI를 막지 않고 취소 가능하며, 폴더 이동/정렬 변경 시 진행 계산이 정리된다 *(코드·`analyze:scan:*` 재사용)*
- [x] 권한 없는 경로는 건너뛰고, 심볼릭/정션 링크 순환이 차단된다(I1 엔진 원칙 재사용) *(코드·기존 scanEngine 재사용)*
- [x] 기본은 off(성능)이며 설정/행 액션으로 켠다 *(코드)*
- [x] (범위 밖) 전 폴더 자동 일괄 계산·결과 영속 캐시·그리드/목록 표시·실시간 갱신은 1차 제외

### ~~T3. 정렬/필터 프리셋 저장 (S)~~ ❌ 폐기 (2026-06-09 사용자 결정·코드 전면 제거)
> **폐기 안내(은폐 금지·경과 보존)**: M6에서 구현 완료(코드 ✅)됐으나 **2026-06-09 사용자 결정으로 폐기되어 코드가 전면 제거**됐다. 삭제 파일: `domain/rules/filterComposition.ts`·`app/stores/presetsSlice.ts`·`app/usecases/presets.ts`·`ui/preset/PresetBar.tsx`·`ui/preset/PresetManageDialog.tsx`(디렉토리째). 환원: `selectors.computeVisible`→기존 `filterEntries`(이름 필터)·`FilterState` extPatterns/tagColors/diffOnly 제거·`FilterPreset`/`PresetSort`/`PresetFilter`/`TagColor`/`SessionSnapshot.filterPresets` DTO 제거·`SESSION_SCHEMA_VERSION` 2→1 환원. 아래 설명·수용기준은 **이력으로만 보존**(상태=폐기).

**목적**: 자주 쓰는 정렬+필터 조합을 이름 붙여 저장·적용한다. (US-19.3) *(폐기)*

| 항목 | 동작 규칙 |
|---|---|
| 저장 | 현재 정렬(기준·방향·폴더 우선)+필터(검색어·확장자 패턴·태그 필터 등) 조합을 이름 붙여 프리셋으로 저장 |
| 적용 | 프리셋 선택 시 활성 패널에 정렬+필터 일괄 적용 |
| 관리 | 프리셋 이름변경·삭제·순서. 세션 영속(워크스페이스 저장 E와 동격 메타) |
| 범위 | 프리셋은 전역(모든 패널에 적용 가능). 패널/폴더 자동 연결은 1차 제외 |

**MVP 경계**: 1차 포함 = 정렬+필터 조합 이름 저장·적용·이름변경/삭제·세션 영속. 1차 제외 = 폴더별 프리셋 자동 기억(특정 폴더 열면 자동 적용)·프리셋 공유/내보내기·컬럼 표시 구성까지 포함.

**수용 기준** (❌ 폐기 — 2026-06-09 사용자 결정으로 코드 전면 제거·아래는 이력 보존)
- [ ] ~~현재 정렬+필터 조합을 이름 붙여 프리셋으로 저장할 수 있다~~ *(폐기)*
- [ ] ~~프리셋을 선택하면 활성 패널에 정렬+필터가 일괄 적용된다~~ *(폐기)*
- [ ] ~~(설계 확정) 프리셋 필터가 기존 검색/필터(D1·D2)와 합성될 때 `filterComposition.ts#matches`로 단일화~~ *(폐기·`filterComposition.ts` 삭제됨)*
- [ ] ~~프리셋을 이름변경·삭제할 수 있고 세션에 영속되어 재시작 후 유지된다~~ *(폐기·`SESSION_SCHEMA_VERSION` 2→1 환원)*
- [ ] ~~(범위 밖) 폴더별 자동 프리셋·프리셋 공유/내보내기·컬럼 구성 포함은 1차 제외~~ *(폐기)*

---

## U. 빠른 보기·탐색·탭 UX (2026-06-09 신규 기획 — U1·U2 M8 + U3 M9 + U4 구현 완료(코드)·실 GUI·멀티윈도우 🟡)

> **완성도 UX 묶음.** **U1 Space 퀵룩 오버레이 · U2 브레드크럼 드롭다운 · U3 탭 색상/잠금·탭을 새 창으로** 3기능. 기존 미리보기(D3·J5)·주소 표시줄(C1)·탭 관리(A1)를 확장한다.
> 우선순위: U1 = **S(Should)**, U2 = **S(Should)**, U3 = **C(Could)**(탭 분리=새 창은 멀티 윈도우 복잡도).
> 상태: **U1·U2는 M8 구현 완료(코드)·실 GUI 런타임 스모크 🟡(2026-06-10) / U3는 M9 구현 완료(코드)·실 GUI·멀티윈도우 런타임 스모크 🟡(2026-06-10·색상/잠금 세션 메타 신규 채널 0·탭 분리 신규 채널 `window:split-tab`/`window:get-init`·분리 창 reopen-only) / U4는 구현 완료(코드)·실 GUI 🟡(신규 채널 0)**. U1=신규 채널 0·`ui/quicklook/QuickLookOverlay`(J5 재사용)·`Space` list 컨텍스트·`preview:read` 재사용, U2=신규 채널 0·`ui/toolbar/BreadcrumbDropdown`·`breadcrumbSiblings`·`fs:tree-children` 재사용·원격 ▾ 비표시. 보안: 퀵룩 미리보기는 D3/J5 안전 모델(DOMPurify·CSP·렌더러 직접 파일 접근 없음) 재사용·throw0/Result·IPC guard(ADR-005). 외부 네트워크 전송 없음. 범례: ✅ · 🟡 · 🔜.

### U1. Space 퀵룩 오버레이 (S) — 구현 완료(코드)·실 GUI 🟡
**목적**: macOS Quick Look처럼 Space로 선택 항목을 큰 미리보기 오버레이로 즉시 본다. (US-20.1)

| 항목 | 동작 규칙 |
|---|---|
| 진입 | 목록에서 항목 선택 후 `Space` → 화면 중앙 큰 미리보기 오버레이, `Space`/`Esc`로 닫기 |
| 콘텐츠 | 이미지(큰 미리보기)·텍스트/코드·마크다운·기본 메타(D3·J5 렌더러 재사용), 미지원=메타+아이콘 |
| 탐색 | 오버레이 연 채 `↑/↓`(또는 ←/→)로 이전/다음 항목 미리보기 전환 |
| 비차단 | 내용 비동기 로드(목록 비차단), 큰 파일·미디어 상한(미리보기 안전 모델 준수) |

**MVP 경계**: 1차 포함 = `Space` 오버레이·이미지/텍스트/코드/마크다운/메타·항목 간 이동·`Space`/`Esc` 닫기. 1차 제외 = 동영상/오디오 재생·PDF 다중 페이지 렌더·오버레이에서 직접 편집·여러 항목 동시 미리보기.

**수용 기준** (구현 완료(코드)·실 GUI 런타임 스모크 🟡)
- [x] 항목 선택 후 `Space`로 큰 미리보기 오버레이가 열리고 `Space`/`Esc`로 닫힌다 *(코드·list 컨텍스트 한정·입력/오버레이 억제·실 GUI 🟡)*
- [x] 이미지·텍스트·코드·마크다운·기본 메타가 표시되고 미지원 형식은 메타+아이콘으로 폴백된다(D3/J5 재사용) *(코드·`QuickLookOverlay`)*
- [x] 오버레이를 연 채 키보드로 이전/다음 항목을 전환할 수 있다 *(코드·실 GUI 🟡)*
- [x] 내용이 비동기 로드되어 목록을 막지 않고, 미리보기 안전 모델(CSP·DOMPurify·렌더러 직접 파일 접근 없음)을 따른다 *(코드·`preview:read` 재사용)*
- [x] (범위 밖) 동영상/오디오 재생·PDF 다중 페이지·오버레이 편집·다중 동시 미리보기는 1차 제외

### U2. 브레드크럼 드롭다운 (S) — 구현 완료(코드)·실 GUI 🟡
**목적**: 주소 표시줄 각 세그먼트에서 형제 폴더 드롭다운으로 빠르게 이동한다. (US-20.2)

| 항목 | 동작 규칙 |
|---|---|
| 진입 | 브레드크럼(C1) 각 구간 옆 펼침 표식(▾) 클릭 → 그 구간의 **형제(같은 부모의 하위) 폴더 목록** 드롭다운 |
| 이동 | 드롭다운 항목 선택 시 활성 패널이 그 폴더로 이동(현재 경로 강조) |
| 키보드 | 드롭다운 키보드 내비(↑/↓·Enter·Esc), 많은 형제는 스크롤/필터 |
| 비차단 | 형제 폴더 목록은 온디맨드 비동기 로드(브레드크럼 클릭 시), 권한 없음/지연 안내 |

**MVP 경계**: 1차 포함 = 각 세그먼트 형제 폴더 드롭다운·선택 이동·키보드 내비·온디맨드 로드. 1차 제외 = 드롭다운 내 다단계(손자) 트리 펼침·드롭다운에서 파일까지 표시(폴더만)·드롭다운에서 즐겨찾기/최근 혼합.

**수용 기준** (구현 완료(코드)·실 GUI 런타임 스모크 🟡)
- [x] 브레드크럼 각 구간에서 펼침 표식(▾)으로 그 구간의 형제 폴더 목록 드롭다운을 연다 *(코드·`BreadcrumbDropdown`·원격 경로는 ▾ 비표시·실 GUI 🟡)*
- [x] 드롭다운 항목 선택 시 활성 패널이 그 폴더로 이동하고 현재 경로가 강조된다 *(코드·`breadcrumbDropdown` usecase)*
- [x] 드롭다운을 키보드(↑/↓·Enter·Esc)로 조작할 수 있고 형제가 많으면 스크롤/필터된다 *(코드·실 GUI 🟡)*
- [x] 형제 폴더 목록이 온디맨드 비동기 로드되어 주소 표시줄을 막지 않고, 권한 없음/지연이 안내된다 *(코드·`fs:tree-children` 재사용)*
- [x] (범위 밖) 다단계 트리 펼침·파일 표시·즐겨찾기/최근 혼합은 1차 제외

### U3. 탭 색상 / 잠금 · 탭을 새 창으로 (C) ✅ 구현 완료(코드) (실 GUI·멀티윈도우 런타임 스모크 🟡)
**목적**: 탭에 색상·잠금(닫기 방지)을 주고, 탭을 분리해 새 창으로 연다. (US-20.3)

| 항목 | 동작 규칙 |
|---|---|
| 색상 | 탭 우클릭 "탭 색상" → 색 지정(구분용). 색은 세션 영속 |
| 잠금 | 탭 우클릭 "탭 잠금"(닫기 방지) → `Ctrl+W`·가운데클릭·X로 닫히지 않음(잠금 표식), 해제로 토글 |
| 새 창으로 | 탭 우클릭 "새 창으로 분리" 또는 탭을 창 밖으로 드래그 → 그 탭을 새 창으로 이동(원 창에서 제거) |
| 세션 | 탭 색상·잠금 상태·다중 창 구성은 세션 영속(자동 복원 US-5.5 연계 범위) |

**MVP 경계**: 1차 포함 = 탭 색상 지정·탭 잠금(닫기 방지) 토글·탭을 새 창으로 분리·색상/잠금 세션 영속. 1차 제외 = 창 간 탭 드래그 이동(서로 다른 창끼리 탭 주고받기)·창별 독립 워크스페이스 저장·탭 그룹화(폴더링).

**비기능·제약**
- 탭 분리=새 창은 멀티 윈도우(BrowserWindow 다중)·세션 복원·IPC 라우팅 복잡도가 있어 **Could**. 창 간 상태 격리·IPC guard(ADR-005) 준수.

**수용 기준** (M9 구현 완료(코드)·실 GUI·멀티윈도우 🟡)
- [x] 탭 우클릭으로 탭 색상을 지정할 수 있고 색이 세션에 영속된다 — `Tab.color?`·`TabSnapshot.color?`·`TabBar` 우클릭 색상(TAG_PALETTE 재사용). ※ 실 GUI 🟡
- [x] 탭을 잠그면(닫기 방지) `Ctrl+W`·가운데클릭·X로 닫히지 않고 잠금 표식이 표시되며 해제로 토글된다 — `Tab.locked?`·닫기 가드·commandBus 가드. ※ 실 GUI 🟡
- [x] 탭을 "새 창으로 분리"하면 그 탭이 새 창으로 이동하고 원 창에서 제거된다 — `windowSplit.ts#splitTabToNewWindow`·`window:split-tab`·`main/windows/windowManager.ts`. ※ 실 멀티윈도우 🟡
- [x] 탭 색상·잠금 상태가 세션에 영속되어 재시작 후 유지된다(US-5.5 연계 범위) — 세션 메타. ※ 분리 창은 reopen-only·재시작 복원 안 함(주 창만·의도적 MVP·정직 표기)
- [ ] (범위 밖) 창 간 탭 드래그 이동·창별 독립 워크스페이스·탭 그룹화는 1차 제외

### U4. 탭 사용자 지정 이름(custom tab name) (S) ✅ 구현 완료 (실 GUI 동작 런타임 스모크 🟡)
**목적**: 탭 라벨에 **사용자가 직접 지은 이름**을 부여해 자동 제목(현재 폴더명)을 덮어쓰고, 여러 탭을 의미 단위(예: "작업", "다운로드 정리")로 구분한다. (US-20.4)

> 본 항목은 **이름 부여만** 추가한다 — 탭 색상·잠금·탭 분리(새 창)는 §U3 소관이며 여기서 다루지 않는다(중복 아님). 탭 아이콘 변경도 1차 범위 밖(이름만). 기존 탭 제목 규칙(A1 "현재 폴더명 표시·동명 폴더 상위 경로 병기")은 사용자 지정 이름이 **없을 때의 기본값(자동 제목)** 으로 그대로 유지된다.

**조작 (인라인 편집 · 우클릭 메뉴)**
| 항목 | 동작 규칙 |
|---|---|
| 더블클릭 편집 | 탭 라벨을 **더블클릭**하면 그 자리에서 인라인 텍스트 편집 모드로 전환한다(`TabRenameInput`) |
| 우클릭 메뉴 | 탭 우클릭 컨텍스트 메뉴의 **"이름 바꾸기"** 로도 같은 인라인 편집을 시작한다 |
| 확정 | **Enter** 또는 입력창 **blur**(포커스 잃음)로 입력한 이름을 확정한다 |
| 취소 | **Esc** 로 편집을 취소하고 직전 라벨로 되돌린다(변경 없음) |
| 빈 값 = 자동 복귀 | 이름을 **비워서 확정**하면 사용자 지정 이름을 **제거하고 자동 제목(현재 폴더명)으로 복귀**한다 |

**표시·영속 규칙**
| 항목 | 동작 규칙 |
|---|---|
| 표시 우선순위 | 사용자 지정 이름이 있으면 그 이름을, 없으면 **자동 제목(현재 폴더명·A1 규칙)** 을 탭 라벨로 표시한다 |
| 경로 이동과 무관 | 사용자 지정 이름이 설정된 탭은 폴더를 옮겨도 **지정 이름을 유지**한다(자동 제목으로 되돌아가지 않음·비울 때만 자동 복귀) |
| 세션 영속 | 사용자 지정 이름은 세션(`TabSnapshot.customName?`)에 **영속**되어 **앱 재시작 후에도 유지**된다. `pinnedByDir`/`detailsColumnWidths`와 동격의 하위호환 선택 필드(기존 스냅샷 데이터 비파괴·`SESSION_SCHEMA_VERSION` 무변경·coerce) |

**범위 밖 (1차 — 정직 표기)**
| 항목 | 사유 |
|---|---|
| 탭 색상 / 잠금 / 탭 분리 | §U3 소관(본 항목은 **이름 부여만**·중복 아님) |
| 탭 아이콘 변경 | 1차는 텍스트 이름만(아이콘 커스터마이즈는 범위 밖) |

**수용 기준** (✅ 구현 완료 — 코드 정합·verify 충족 / 실 GUI 동작은 🟡)
- [x] 탭 라벨을 **더블클릭**하면 인라인 편집 모드로 전환된다 — `ui/tabbar/TabBar.tsx`(`TabRenameInput`). ※ 실 GUI 🟡
- [x] 탭 **우클릭 컨텍스트 메뉴 "이름 바꾸기"** 로도 같은 인라인 편집을 시작할 수 있다 — `TabBar.tsx` 탭 컨텍스트 메뉴. ※ 실 GUI 🟡
- [x] **Enter** 또는 입력창 **blur** 로 이름이 확정되고, **Esc** 로 편집이 취소된다(직전 라벨 유지) — `TabRenameInput` 키/blur 핸들러. ※ 실 GUI 🟡
- [x] 이름을 **비워서 확정**하면 사용자 지정 이름이 제거되고 **자동 제목(현재 폴더명)으로 복귀**한다 — `tabsSlice.clearTabName`(빈 값 분기). ※ 실 GUI 🟡
- [x] 사용자 지정 이름이 있으면 그 이름을, 없으면 자동 제목을 탭 라벨로 표시한다(폴더 이동 시에도 지정 이름 유지) — `TabBar.tsx` 라벨 우선순위(`customName ?? 자동 제목`)·`tabsSlice.setTabName`
- [x] 사용자 지정 이름이 **세션에 영속**되어 앱 재시작 후에도 유지된다 — `app/usecases/session.ts`·`main/persistence/defaults.ts`·`TabSnapshot.customName?`(coerce·`verify:store`). ※ 재시작 후 유지 육안 🟡
- [x] 기존 세션에 `customName` 필드가 없어도 자동 제목으로 정상 동작한다(하위호환 선택 필드) — `coerce`·**`SESSION_SCHEMA_VERSION` 무변경**(`pinnedByDir`/`detailsColumnWidths` 선례)
- [x] 신규 IPC 채널·신규 npm 의존성 없이 렌더러+세션 영속만으로 동작하며, 기존 탭 관리(A1)·탭 복제/복원·세션 복원(US-5.5)과 충돌·회귀가 없다 — 신규 채널 0·의존성 0·`Tab.customName?` 추가는 표시/영속 계층 한정
- [ ] 탭 색상·잠금·탭 분리(새 창) — **§U3 소관**(본 항목은 이름 부여만)
- [ ] 탭 아이콘 변경 — **1차 범위 밖**(텍스트 이름만)

---

## W. 자세히 보기 컬럼 헤더 · 너비 조절 (2026-06-10 신규 기획 — 구현 완료(코드)·실 GUI 🟡)

> 기존 **자세히(Details) 보기(B1, Must)** 를 **표시 UX 관점에서 비파괴 확장**하는 영역이다. 새로운 파일시스템 동작을 추가하는 것이 아니라, 자세히 보기에 **컬럼 헤더 막대를 더하고 컬럼 너비를 사용자가 직접 조절**하게 만들어, 긴 파일명·메타를 보기 좋게 펼치는 **렌더러 UX 기능**이다. 그 전에는 자세히 보기에 헤더가 없고 컬럼 폭이 고정이었다.
> 2026-06-10 사용자 직접 요청으로 정식 편입. 우선순위는 **S(Should)** — 핵심 가치(다중 디렉토리 작업)와 독립적이나 일상 가독성을 높이는 상단 고정(O1)·즐겨찾기 별칭(J7)과 동급의 소규모 표시 UX 개선이다(우선순위 근거 [PRD §6 "MoSCoW 분류 근거(2026-06-10 §W)"](./PRD.md#6-범위와-우선순위-moscow)).
> **기존 정합**: 조절한 컬럼 폭은 상단 고정(O1 `pinnedByDir`)·미리보기 폭(J6 `ui.previewWidth`)과 **동일한 하위호환 선택 필드 영속 패턴**을 따라 `SessionSnapshot.ui.detailsColumnWidths`(+coerce)로 세션에 저장한다(기존 스냅샷 데이터 비파괴·`SESSION_SCHEMA_VERSION` 무변경). 컬럼 폭 적용은 자세히 보기 렌더 계층에만 작용해 정렬(B2)·필터 동작을 바꾸지 않는다. 단축키는 [PRD.md 8장](./PRD.md#8-단축키-체계-확정--충돌-없음)이 단일 출처다(분리자 드래그·분리자 포커스 방향키로만 조작·전역 키 미배정).
> 범례: ✅ 구현 완료 · 🟡 부분 · 🔜 미착수. **[2026-06-10 상태] W1 ✅ 구현 완료(코드)**(코드 정합·verify 충족 — `verify:domain` 컬럼 폭 24케이스: `clampColumnWidth`/`coerceDetailsColumnWidths`). **렌더러+세션 영속만·신규 IPC 채널 0·신규 npm 의존성 0·`SESSION_SCHEMA_VERSION` 무변경.** **실 GUI 동작(헤더 4컬럼 렌더·분리자 드래그 리사이즈·분리자 포커스 방향키 리사이즈·재시작 후 폭 유지)은 헤드리스로 미증명 → 런타임 스모크 권장 🟡**(✅ 위장 아님·각 수용 기준 옆 "※ 실 GUI 🟡" 부기).

### W1. 자세히 보기 컬럼 헤더 + 너비 드래그 조절 (S) ✅ 구현 완료 (실 GUI 동작 런타임 스모크 🟡)
**목적**: 자세히(details) 보기에 **컬럼 헤더 막대**를 두고 **컬럼 너비를 직접 조절**하게 해, 긴 파일명·유형·날짜를 잘림 없이 보기 좋게 펼친다. 조절한 폭은 다시 열어도 유지되어 매번 다시 맞출 필요가 없다. (US-21.1)

> 본 기능은 **자세히(details) 보기 한정**이다 — 그리드(아이콘)·목록(list) 보기는 컬럼 구조가 없어 해당하지 않는다. **헤더는 컬럼 너비 조절·레이블 표시 전용**이며, 헤더 클릭으로 정렬 기준을 바꾸는 동작은 **1차 범위 밖**이다(정직 표기 — 정렬은 기존 B2 경로 유지).

**헤더·컬럼 구성**
| 항목 | 동작 규칙 |
|---|---|
| 헤더 막대 | 자세히 보기 목록 **상단에 컬럼 헤더 막대**(이름 | 크기 | 유형 | 수정한 날짜)를 표시한다. 상단 고정(O1) sticky 밴드보다 **위**의 sticky 헤더 밴드로 둔다(스크롤해도 헤더가 상단에 붙어 보임) |
| 컬럼 4종 | **이름 · 크기 · 유형 · 수정한 날짜** 4개 컬럼. 기본 너비 = 크기 90 · 유형 60 · 수정한 날짜 140(px) |
| 이름 컬럼 신축 | **`이름` 컬럼은 고정 폭을 갖지 않고 남는 가로 폭을 채워 신축(flex)** 한다(나머지 3개 컬럼 폭을 뺀 나머지). 패널 폭이 바뀌면 `이름` 컬럼이 늘고 줄어든다 |

**너비 조절 규칙**
| 항목 | 동작 규칙 |
|---|---|
| 분리자 드래그 | 컬럼 **사이 분리자(divider)** 를 마우스로 좌우 드래그하면 그 컬럼 너비가 실시간으로 바뀐다 |
| 키보드 리사이즈 | 분리자에 **포커스**(`role="separator"`)를 둔 상태에서 **방향키(←/→)** 로 너비를 한 단계씩 조절한다(접근성 대체수단·분리자 포커스 한정·전역 키 미배정) |
| 컬럼별 최소 너비 | 각 컬럼은 **최소 너비(48px) 이하로 줄어들지 않으며 최대(600px)를 넘지 않는다**(`clampColumnWidth`) — 컬럼이 사라지거나 레이블이 완전히 가려지지 않음 |
| 접근성 | 분리자는 `role="separator"` · `aria-orientation="vertical"` 를 가지며 키보드 포커스·방향키 조절이 가능하다 |

**영속 규칙**
| 항목 | 동작 규칙 |
|---|---|
| 세션 영속 | 조절한 컬럼 폭은 **세션(`SessionSnapshot.ui.detailsColumnWidths`)에 영속**되어 **앱 재시작 후에도 유지**된다. **전역 설정**(세션 단위 1벌)으로, J6 미리보기 폭(`ui.previewWidth`)·O1 고정(`pinnedByDir`)과 동격의 하위호환 선택 필드 |
| 하위호환·정규화 | 기존 세션에 필드가 없으면 **기본 너비로 동작**하고, 복원 시 값은 **min/max로 클램프**해 보존한다(`coerceDetailsColumnWidths`). **`SESSION_SCHEMA_VERSION`은 변경하지 않는다**(`pinnedByDir`/`previewWidth` 선례와 동일한 선택 필드 추가) |

**범위 밖 (1차 — 정직 표기)**
| 항목 | 사유 |
|---|---|
| 헤더 클릭 정렬 | 본 기능은 **너비 조절·레이블 표시 전용**. 컬럼 헤더 클릭으로 정렬 기준/방향을 바꾸는 동작은 1차 범위 밖(정렬은 기존 B2 경로 유지) |
| 컬럼 표시/숨김·순서 변경 | 컬럼을 켜고 끄거나(토글) 컬럼 순서를 드래그로 바꾸는 것은 1차 범위 밖(4컬럼 고정) |
| 보기별 적용 | 그리드·목록 보기 컬럼 조절은 해당 없음(자세히 보기 한정) |

**수용 기준** (✅ 구현 완료 — 코드 정합·verify 충족 / 실 GUI 동작은 🟡)
- [x] 자세히(details) 보기에 **컬럼 헤더 막대(이름 | 크기 | 유형 | 수정한 날짜)** 가 표시된다 — `ui/panel/views/FileListView.tsx`(헤더 sticky 밴드·O1 고정 밴드 위). ※ 실 GUI 🟡
- [x] 컬럼 **사이 분리자를 드래그**하면 그 컬럼 너비가 실시간으로 바뀐다 — `FileListView.tsx` 분리자 + `columnsSlice` 폭 상태. ※ 실 GUI 🟡
- [x] 각 컬럼은 **최소 너비(48px) 이하로 줄어들지 않고 최대(600px)를 넘지 않는다** — `domain/rules/columnWidths.ts#clampColumnWidth`(`verify:domain` 24케이스)
- [x] **`이름` 컬럼은 남는 가로 폭을 채워 신축**되고, 나머지 3개 컬럼(크기/유형/수정한 날짜)이 조절한 폭을 갖는다(기본 90/60/140) — `FileListView.tsx` 레이아웃(이름 flex·나머지 고정 폭)
- [x] 분리자에 **포커스를 둔 상태에서 방향키(←/→)로 너비를 조절**할 수 있다(분리자 `role="separator"`·`aria-orientation="vertical"`·접근성 대체수단·전역 키 미배정) — `FileListView.tsx` 분리자 키 핸들러. ※ 실 GUI 🟡
- [x] 조절한 컬럼 폭이 **세션에 영속**되어 앱 재시작 후에도 유지된다(전역 설정·1벌) — `app/usecases/session.ts`·`main/persistence/defaults.ts`·`SessionSnapshot.ui.detailsColumnWidths`(`coerceDetailsColumnWidths`·`verify:domain`). ※ 재시작 후 유지 육안 🟡
- [x] 기존 세션에 컬럼 폭 필드가 없어도 **기본 너비로 동작**하고, 복원 시 값은 min/max로 클램프되어 보존된다 — `coerceDetailsColumnWidths`·**`SESSION_SCHEMA_VERSION` 무변경**(`pinnedByDir`/`previewWidth` 선례)
- [x] 신규 IPC 채널·신규 npm 의존성 없이 렌더러+세션 영속만으로 동작하며, 기존 정렬(B2)·필터·보기(J3)·상단 고정(O1) 동작과 충돌·회귀가 없다 — 신규 채널 0·의존성 0·컬럼 폭은 자세히 보기 렌더 계층에만 작용(정렬/필터 로직 불변)
- [x] 본 기능은 **자세히 보기 한정**이며 그리드·목록 보기에는 적용되지 않는다 — `FileListView.tsx` details 분기 한정
- [ ] 헤더 클릭으로 정렬 기준/방향 변경 — **1차 범위 밖**(너비 조절·레이블 표시 전용)
- [ ] 컬럼 표시/숨김·순서 변경 — **1차 범위 밖**(4컬럼 고정)

---

## X. 좌측 사이드바 "빠른 위치" (2026-06-10 신규 기획 — 구현 완료(코드)·실 GUI 🟡)

> 기존 **트리 사이드바(C3, Must)** 를 **탐색 진입점 관점에서 비파괴로 확장**하는 영역이다. 즐겨찾기·최근·드라이브·휴지통과 동격으로, 사이드바에 **"빠른 위치"** 섹션을 더해 자주 쓰는 **OS 시스템 폴더(다운로드 등)** 로 한 번에 닿게 한다. 1차는 **다운로드** 항목만 노출한다(아래 정직 표기).
> 2026-06-10 사용자 직접 요청으로 정식 편입. 우선순위는 **S(Should)** — 핵심 가치(다중 디렉토리 작업)와 독립적이나 일상 탐색 동선을 단축하는 즐겨찾기 별칭(J7)·상단 고정(O1)과 동급의 소규모 탐색 UX 개선이다(우선순위 근거 [PRD §6 "MoSCoW 분류 근거(2026-06-10 §X)"](./PRD.md#6-범위와-우선순위-moscow)).
> **기존 정합**: "빠른 위치" 항목 클릭 이동은 기존 사이드바 항목 클릭(C3·즐겨찾기 클릭)과 **동일한 활성 패널 이동 경로**를 재사용한다(새 탐색 동작 추가 아님). OS 시스템 폴더 경로는 **신규 채널 `fs:known-folders`**(무인자 invoke → `KnownFoldersDTO { downloads, desktop, documents, home }`·`app.getPath`)로 가져온다 — P1 동결 이후 신기능 신규 채널로, 기존 `preview:read`·`analyze:scan:*`·`hash:*`·`search:content:*` 선례와 동일한 invoke·guard/Result 규약(ADR-005)을 따른다(신규 npm 의존성 0). 단축키는 [PRD.md 8장](./PRD.md#8-단축키-체계-확정--충돌-없음)이 단일 출처다(항목 클릭으로만 조작·신규 키 불요).
> 범례: ✅ 구현 완료 · 🟡 부분 · 🔜 미착수. **[2026-06-10 상태] X1 ✅ 구현 완료(코드)**(코드 정합 — `fs.handlers.ts`·`sidebarSlice.knownFolders`/`loadKnownFolders`·`Sidebar.tsx` "빠른 위치" 섹션·신규 채널 `fs:known-folders`·신규 npm 의존성 0). **정직 범위: 현재는 다운로드 항목만 렌더된다**(바탕화면/문서/홈은 DTO로 함께 가져오나 미표시·예약). **실 GUI 동작(섹션 렌더·다운로드 클릭 이동·실 `app.getPath` 경로 해석)은 헤드리스로 미증명 → 런타임 스모크 권장 🟡**(✅ 위장 아님·각 수용 기준 옆 "※ 실 GUI 🟡" 부기).

### X1. 빠른 위치 ▸ 다운로드 이동 (S) ✅ 구현 완료 (실 GUI 동작 런타임 스모크 🟡)
**목적**: 사이드바 **"빠른 위치"** 섹션의 **다운로드** 항목을 클릭하면 활성 패널이 **OS 다운로드 폴더**로 즉시 이동한다 — 매번 경로를 입력하거나 트리를 펼치지 않고 가장 자주 들르는 폴더에 한 번에 닿는다. (US-22.1)

> C4(즐겨찾기)는 **사용자가 직접 등록한** 폴더 모음이고, X1 "빠른 위치"는 **OS가 제공하는 표준 시스템 폴더**(다운로드 등)를 항상 제공하는 고정 진입점이다(서로 보완·중복 아님).

**구성·동작**
| 항목 | 동작 규칙 |
|---|---|
| 섹션 | 사이드바에 **"빠른 위치"** 섹션을 추가한다(즐겨찾기·최근·드라이브·휴지통과 동격의 사이드바 진입점) |
| 다운로드 항목 | 섹션 안의 **다운로드** 항목 클릭 시 활성 패널이 **OS 다운로드 폴더**로 이동한다(기존 사이드바 항목 클릭과 동일한 활성 패널 이동 경로 재사용) |
| 경로 출처 | OS 시스템 폴더 경로는 **신규 채널 `fs:known-folders`**(무인자 invoke → `KnownFoldersDTO { downloads, desktop, documents, home }`)로 가져온다(`app.getPath` 기반·`sidebarSlice.loadKnownFolders`로 적재) |
| 현재 렌더 범위 | **현재는 다운로드 항목만 렌더된다.** 바탕화면·문서·홈은 DTO로 **함께 가져오나 사이드바에 표시하지 않는다**(예약·정직 표기) |

**범위 밖 (1차 — 정직 표기)**
| 항목 | 사유 |
|---|---|
| 바탕화면·문서·홈 항목 표시 | DTO(`KnownFoldersDTO`)로 함께 가져오나 1차는 **다운로드만 렌더**(나머지는 예약·미표시) |
| 항목 추가/제거·재정렬·고정 | "빠른 위치"는 OS 제공 고정 진입점(사용자 편집은 즐겨찾기 C4 소관)·1차 범위 밖 |
| 다운로드 외 동작 | 항목 클릭 **이동만**(다운로드 폴더 비우기·정리 등 부가 동작 없음) |

**수용 기준** (✅ 구현 완료 — 코드 정합 / 실 GUI 동작은 🟡)
- [x] 사이드바에 **"빠른 위치"** 섹션이 추가되고 그 안에 **다운로드** 항목이 표시된다 — `ui/sidebar/Sidebar.tsx`(빠른 위치 섹션). ※ 실 GUI 🟡
- [x] 다운로드 항목을 클릭하면 활성 패널이 **OS 다운로드 폴더**로 이동한다(기존 사이드바 항목 클릭과 동일한 이동 경로) — `Sidebar.tsx` 클릭 → 활성 패널 navigate(`knownFolders.downloads`). ※ 실 GUI 🟡
- [x] OS 시스템 폴더 경로를 **신규 채널 `fs:known-folders`** 로 가져온다(무인자 invoke → `KnownFoldersDTO { downloads, desktop, documents, home }`·`app.getPath`) — `fs.handlers.ts`(핸들러)·`sidebarSlice.knownFolders`/`loadKnownFolders`. ※ 실 `app.getPath` 경로 해석 🟡
- [x] **현재는 다운로드 항목만 렌더**되며(바탕화면/문서/홈은 DTO로 함께 가져오나 미표시·예약), 신규 npm 의존성 없이 동작한다 — `Sidebar.tsx` 다운로드만 렌더(정직 표기)·신규 의존성 0
- [x] 기존 사이드바(C3·즐겨찾기·최근·드라이브·휴지통)·탐색 동작과 충돌·회귀가 없다(추가 진입점일 뿐 기존 항목 동작 불변) — `Sidebar.tsx` 신규 섹션 추가·기존 섹션 렌더/동작 무변경
- [ ] 바탕화면·문서·홈 항목 표시 — **1차 범위 밖**(DTO로 함께 가져오나 다운로드만 렌더·예약)
- [ ] 빠른 위치 항목 추가/제거·재정렬·고정 — **1차 범위 밖**(OS 제공 고정 진입점·사용자 편집은 즐겨찾기 C4 소관)

---

## Y. Windows 셸 컨텍스트 메뉴 연동 (2026-06-12 신규 기획 — 구현 완료(코드)·실 GUI/실 패키지 🟡)

> 기존 **컨텍스트 메뉴 인프라(B6, 우클릭 메뉴)** 를 **Windows 셸과의 상호운용 관점에서 비파괴로 확장**하는 영역이다. 새로운 파일시스템 동작을 추가하는 것이 아니라, 앱의 React 컨텍스트 메뉴 하단에 **"Windows 메뉴" 섹션**을 더해, Windows에 설치된 프로그램들이 등록한 **셸 컨텍스트 메뉴 항목**(예: "반디집으로 압축하기", "Cursor로 열기", "AGT-Finder로 열기")을 노출하고 선택 시 그 동작을 실행하게 만드는 **상호운용 UX 기능**이다. 그 전에는 앱 컨텍스트 메뉴가 앱 자체 명령(열기·복사·삭제 등)만 노출했다.
> **[챕터 식별자 주의]** 본 챕터 식별자 "**Y**"는 MoSCoW 우선순위 마커와 무관한 챕터 라벨이다(§M·§N 동일 규약). 우선순위는 항상 "Must/Should/Could/Won't". §V는 roadmap/traceability에서 **비계획 구현 플래그 장**으로 쓰이므로 본 신규 사용자 기능 챕터는 문자 **Y**를 쓴다.
> 2026-06-12 사용자 직접 요청으로 정식 편입(기획 단계·미착수). 우선순위는 **S(Should)** — 핵심 가치(다중 디렉토리 작업)와 독립적이나 Windows 셸 생태계와의 상호운용으로 일상 편의를 크게 높이는 개선이다(우선순위 근거 [PRD §6 "MoSCoW 분류 근거(2026-06-12 §Y)"](./PRD.md#6-범위와-우선순위-moscow)).
> **기술 방식(사용자 확정)**: Windows 셸 COM `Shell.Application`의 `FolderItem.Verbs()` 열거 + `verb.DoIt()` 실행. **네이티브 N-API 애드온 방식은 비채택**(신규 네이티브 의존성 0 원칙). 메인 프로세스에서 **상주 PowerShell 워커**(stdin/stdout 프로토콜·기존 hash/archive 워커와 동일한 구조)로 COM을 호출해 우클릭 지연을 완화한다. 신규 IPC 채널 2종 예상(verb 조회·verb 실행) — **정확한 채널명·워커 프로토콜·캐시 전략은 chief-architect 설계 단계에서 확정**하므로 본 명세는 **행동 계약 수준**으로만 기술한다. 기존 B6 컨텍스트 메뉴 인프라(`ui/contextmenu/`)·ADR-005 프로세스 보안 모델의 확장이다.
> **이 PC 실증(2026-06-12 PoC·정직 기록)**: `package.json` 1개 파일에 대해 COM `Verbs()` 열거 결과 — "&Open / AGT-Finder로 열기 / C&ursor(으)로 열기 / Add to &Favorites / package.zip으로 압축하기(&Z) / package.7z로 압축하기(&7) / 반디집으로 압축하기(&L)… / Copy &as path / &Share / Restore previous &versions / Cu&t / &Copy / Create &shortcut / &Delete / Rena&me / P&roperties". 즉 설치 프로그램(반디집·Cursor) 항목이 실제로 열거됨을 확인했다(서브메뉴 전용 핸들러는 일부 누락 가능 — 아래 정직 한계 ①).
> 단축키는 [PRD.md 8장](./PRD.md#8-단축키-체계-확정--충돌-없음)이 단일 출처다(우클릭 메뉴 내 섹션이므로 신규 키 불요). 범례: ✅ 구현 완료 · 🟡 부분 · 🔜 미착수. **[2026-06-12 상태] Y1 구현 완료(코드)·통합 QA PASS** — 설계 ADR-013 → T1~T6 구현 → 통합 QA PASS([qa-integration-Y](./reviews/qa-integration-Y.md)). **신규 채널 `shell:context-verbs`/`shell:invoke-verb` 2종·신규 의존성 0(상주 PowerShell `shellVerbsWorker.ps1`+COM Verbs)·`verify:shellverbs` 75/0·typecheck/build PASS·ESLint 0·일회성 실 노드 스모크(ps1 워커 한글 경로 왕복·실 COM 열거·블랙리스트 필터·EVERB 거부·dispose 좀비 0) 통과.** **정직 한계(✅ 위장 아님): 헤드리스 verify·실 노드 스모크로 증명된 항목만 [x]·실 GUI(우클릭 섹션 표출·verb 클릭→외부 프로그램 DoIt·로딩→채움/숨김·한글 display 실 렌더)·실 패키지 설치본(asar ps1 경로·ExecutionPolicy)은 🟡로 둔다.**

### Y1. 파일/폴더 우클릭 시 Windows 셸 컨텍스트 메뉴 항목 노출·실행 (S) 구현 완료(코드)·실 GUI/실 패키지 🟡
**목적**: 파일/폴더를 우클릭했을 때 앱 컨텍스트 메뉴 하단에 **"Windows 메뉴" 섹션**을 두고, Windows에 설치된 프로그램들이 등록한 셸 컨텍스트 메뉴 항목을 보여 줘, 별도의 Windows 탐색기 우클릭 없이 앱 안에서 바로 그 동작(압축·외부 앱으로 열기 등)을 실행한다. (US-23.1)

> **B6와의 관계**: B6는 앱이 자체 구현한 명령(열기·연결 프로그램·복사/잘라내기/이름바꾸기·삭제·속성 등)을 노출한다. Y1은 그 메뉴 **하단에 별도 섹션("Windows 메뉴")** 을 추가해 **OS 셸이 제공하는 verb**를 노출한다(앱 자체 명령 영역과 시각적·논리적으로 분리). 앱 자체 명령(B6) 동작은 변경하지 않고 **셸 verb 섹션만 추가**한다.

**노출 / 구성**
| 항목 | 동작 규칙 |
|---|---|
| 섹션 위치 | 단일 파일/폴더 우클릭 시 앱 컨텍스트 메뉴(B6) **하단에 "Windows 메뉴" 섹션**을 구분선과 함께 추가한다(앱 자체 명령 영역과 분리) |
| 항목 출처 | 셸 COM `Shell.Application`의 `FolderItem.Verbs()` 로 열거한 verb 목록을 메뉴 항목으로 렌더한다(예: "반디집으로 압축하기", "Cursor로 열기", "AGT-Finder로 열기") |
| 단일 선택 한정 | **다중 선택 시 "Windows 메뉴" 섹션을 숨긴다**(COM `Verbs()`는 단일 항목 기준 — 정직 한계 ②·1차 단일 선택 한정 노출) |
| 중복 verb 필터 | 앱이 이미 자체 구현한 verb(canonical verb name 기준 **블랙리스트**: `open`·`cut`·`copy`·`paste`·`delete`·`rename`·`properties` 등)는 노출하지 않는다(중복 UX 방지·정직 한계 ③) |
| 로딩 상태 | 워커 첫 기동·첫 조회 지연 시 섹션에 **로딩 상태**(예: "Windows 메뉴 불러오는 중…" 또는 지연 표시)를 허용한다(정직 한계 ⑤) |
| 서브메뉴 | 캐스케이드(중첩) 서브메뉴는 **평탄화되거나 누락될 수 있다**(7-Zip처럼 서브메뉴 전용 핸들러는 일부 미표시 가능) — **보이는 것만 노출하는 best-effort 계약**(정직 한계 ①) |

**실행 규칙**
| 항목 | 동작 규칙 |
|---|---|
| verb 실행 | "Windows 메뉴"의 항목 선택 시 해당 verb를 `verb.DoIt()` 로 실행한다(상주 PowerShell 워커 경유) |
| fire-and-forget | verb 실행은 **외부 프로그램 실행**이므로 결과(성공/실패)를 앱이 추적하지 않는다(fire-and-forget 계약·정직 한계 ④). 실행 실패는 무음 또는 가벼운 안내(토스트) 수준 |
| 성능 | 우클릭 지연을 줄이기 위해 COM 호출은 **상주 PowerShell 워커**(기존 hash/archive 워커 패턴)에서 처리한다(메인/렌더러 스레드 비차단) |
| 보안 | 셸 verb 열거·실행은 **사용자가 우클릭한 실제 항목 경로**에 대해서만 수행한다(임의 데이터·임의 명령 합성 없음·ADR-005 프로세스 보안 모델 준수·정확한 가드는 설계 단계 확정) |

**범위 밖 (1차 — 비범위·Non-goal·정직 표기)**
| 항목 | 사유 |
|---|---|
| 네이티브 메뉴 팝업 | OS 네이티브 컨텍스트 메뉴(HMENU) 팝업을 그대로 띄우지 않는다 — 앱 React 메뉴에 항목을 **병합**해 렌더하는 방식만 1차 범위 |
| 서브메뉴 완전 재현 | 캐스케이드(중첩) 서브메뉴 트리의 완전 재현은 1차 범위 밖(보이는 항목만 best-effort·정직 한계 ①) |
| 다중 선택 invoke | 다중 선택 항목에 대한 일괄 verb 실행은 1차 범위 밖(COM `Verbs()`가 단일 항목 기준 — 다중 선택 시 섹션 숨김) |

**수용 기준** (구현 완료(코드)·통합 QA PASS — 헤드리스 verify·실 노드 스모크로 증명된 항목만 [x]·실 GUI/실 패키지 의존 항목은 🟡)
- [ ] 🟡 단일 파일/폴더를 우클릭하면 앱 컨텍스트 메뉴(B6) **하단에 "Windows 메뉴" 섹션**이 구분선과 함께 표시되고, 셸 COM `FolderItem.Verbs()` 로 열거한 설치 프로그램 항목(예: "반디집으로 압축하기"·"Cursor로 열기"·"AGT-Finder로 열기")이 노출된다 *(섹션 병합 로직 `shellVerbsSection.ts`·`ContextMenu.tsx`·`verify:shellverbs` merge 케이스 [x]·실 COM 열거 노드 스모크 통과(반디집 항목 포착) / **실 GUI 우클릭 섹션 표출은 🟡**)*
- [ ] 🟡 **다중 선택 시 "Windows 메뉴" 섹션이 숨겨진다**(COM Verbs()는 단일 항목 기준·1차 단일 선택 한정·정직 한계 ②) *(섹션 병합 숨김 로직 [x]·실 GUI 다중선택 숨김 표출은 🟡)*
- [x] **앱이 이미 자체 구현한 verb**(canonical verb name 블랙리스트: open/cut/copy/paste/delete/rename/properties 등)는 **노출되지 않는다**(중복 UX 방지·정직 한계 ③) *(`shellVerbsBlacklist.ts`·`verify:shellverbs` 블랙리스트 케이스·실 노드 스모크 누출 0)*
- [x] **캐스케이드 서브메뉴는 평탄화되거나 누락될 수 있으며, 보이는 항목만 노출하는 best-effort 계약**이다(서브메뉴 전용 핸들러 일부 미표시 허용·앱 크래시·빈 섹션 없이 정상 동작·정직 한계 ①) *(미존재→빈목록·실 COM 열거 노드 스모크 통과)*
- [x] "Windows 메뉴" 항목 선택 시 해당 verb가 `verb.DoIt()` 로 실행되며, **실행 결과(성공/실패)는 앱이 추적하지 않는다(fire-and-forget)**(실행 실패는 무음 또는 가벼운 토스트 안내·정직 한계 ④) *(`shell.handlers.ts` 재열거 교차검증→가짜 verbId EVERB 거부 노드 스모크 통과·외부 프로그램 미실행 / **실 verb 클릭→외부 프로그램 DoIt 실행은 🟡**)*
- [x] 워커 첫 기동·첫 조회 지연 시 섹션에 **로딩 상태**(예: "Windows 메뉴 불러오는 중…" 또는 지연 표시)가 허용되며, 조회는 **상주 PowerShell 워커**(기존 hash/archive 워커 패턴)에서 처리되어 우클릭/메인 스레드가 비차단된다(정직 한계 ⑤) *(`shellVerbs.ts` 상주 워커·`verify:shellverbs` 로딩 전이 케이스·ps1 워커 왕복 노드 스모크 통과 / **실 GUI 로딩 상태 표출은 🟡**)*
- [x] 셸 verb 열거·실행은 **Windows 셸 COM `Shell.Application`(`FolderItem.Verbs()`/`verb.DoIt()`)** 으로 수행하며 **네이티브 N-API 애드온·신규 네이티브 의존성을 추가하지 않는다**(신규 IPC 채널 `shell:context-verbs`/`shell:invoke-verb` 2종·신규 npm/네이티브 의존성 0)
- [x] verb 열거·실행은 **사용자가 우클릭한 실제 항목 경로**에 대해서만 수행하며, 임의 명령 합성·임의 실행 표면을 추가하지 않는다(ADR-005 보안 모델 준수·`guard.ts §Y1` zod·재열거 교차검증·셸 미경유 ps1 워커)
- [x] 기존 앱 자체 컨텍스트 메뉴(B6) 명령(열기·연결 프로그램·복사/잘라내기/이름바꾸기·삭제·속성·빈 영역 메뉴)과 충돌·회귀 없이 "Windows 메뉴" 섹션만 추가된다 *(typecheck/build PASS·verify 회귀 0·`ContextMenu.tsx` 섹션 병합 / 실 GUI 회귀 0은 🟡)*
- [ ] 네이티브 메뉴 팝업(HMENU)·캐스케이드 서브메뉴 완전 재현·다중 선택 일괄 invoke — **1차 범위 밖(비범위·Non-goal)**
