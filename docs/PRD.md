# PRD — 멀티 디렉토리 파일탐색기 (제품명: AGT-Finder · 코드네임: Explorer)

> **제품명 표기**: 사용자 노출 제품명은 **AGT-Finder**(2026-06-07 확정·feat-J4·US-9.4). "Explorer"는 개발 코드네임으로만 유지한다. 본 문서 본문의 사용자 노출 명칭은 AGT-Finder를 따른다.

> 작성일: 2026-06-06 · **갱신: 2026-07-14** · 작성: 제품 기획(PM) · 상태: **Must(MVP) 구현 완료 · Should 대부분 완료(4분할·미리보기·워크스페이스·텔레메트리·연결 프로그램으로 열기 · 신규 UX 6종: 아이콘바·사이드바 토글·분할 크기조절·터미널 열기·경로 직접 입력·파일 유형 아이콘 · 신규 분석·접근성 2종: 사용량 대시보드·블루라이트 차단 테마 · 신규 보기·실시간·뷰어·브랜딩 J장 7종: 박스 선택·패널 실시간 갱신(✅·`subst`/일부 클라우드 `DriveType≠4`만 미포함 한계)·보기 5종·AGT-Finder 브랜딩·미리보기 2단 뷰어/폭 조절·즐겨찾기 별칭 · 신규 K장 3종: 되돌리기 Ctrl+Z·휴지통 관리 화면·파일 유형별 비중(✅ 구현 완료 — P6 잔여 해소) · F5/F6 복사·이동 제거) · **신규 §M 외부 연계 3종(M1 외부 D&D 복사·M2 클립보드 외부 연계 Should·M3 FTP/SFTP Could, US-12.1~12.5 — 2026-06-08 구현 완료·QA PASS ✅, 실 동작은 런타임 스모크 권장 🟡)** · **신규 §N 즐겨찾기 UX 2종(N1 즐겨찾기 경로 워터마크·N2 즐겨찾기 드래그 정렬 Should, US-13.1~13.2 — 2026-06-08 구현 완료·QA PASS ✅, 렌더러 전용·신규 채널 0·키 `Alt+Shift+↑/↓`, 실 GUI 동작은 런타임 스모크 권장 🟡)** · **신규 §O 파일/폴더 상단 고정(pin) 1종(O1 Should, US-14.1 — 2026-06-09 정식 편입·코드 구현 완료, 렌더러 전용·신규 채널 0·신규 의존성 0·컨텍스트 메뉴 토글·디렉토리별 📌 최상단·세션 영속, 실 GUI 동작은 런타임 스모크 권장 🟡)** · **파워 기능 14종(§P~§U) M6~M9 전부 구현 완료(코드)·실 GUI/실 워커 🟡 — M9(Q1 압축파일 `archive://` 어댑터 신규 채널 `archive:*`·신규 의존성 yauzl/yazl·ADR-008 / U3 탭 색상/잠금·탭 분리(새 창) 신규 채널 `window:split-tab`/`window:get-init`) + 신규 Should §U4 탭 사용자 지정 이름(US-20.4·신규 채널 0)·§X1 좌측 사이드바 빠른 위치 ▸ 다운로드(US-22.1·신규 채널 `fs:known-folders`) 구현 완료 → §P~§U 14종 전부 완료(T3 폐기). 개발 잔여(🔜) 0 — 남은 것은 P7 런타임(성능 실측·코드서명·NSIS)** · **신규 §Y Windows 셸 컨텍스트 메뉴 연동 1종(Y1 Should, US-23.1 — 2026-06-12 기획 편입·설계 ADR-013·구현 완료(코드)·통합 QA PASS ✅, 신규 채널 `shell:context-verbs`/`shell:invoke-verb`·신규 의존성 0·`verify:shellverbs` 99/0, 실 GUI/실 패키지 런타임 스모크 권장 🟡)** · **신규 §Z Agentic 자연어 파일 에이전트 1종(Z1 Could, US-24.1~24.5 — 2026-06-14 기획 편입·설계 ADR-014/015·읽기 전용 범위 구현 완료(코드)·실 동작 🟡 / 쓰기(US-24.2 plan·실행) 🔜 deferred[사용자 "읽기 전용으로 완성" 결정], 신규 채널 `agent:*`·신규 의존성 `@anthropic-ai/sdk`+`openai`(네이티브 0)·도구 8종(읽기 7종 + `open_tab` 내비게이션·비파괴·파일 쓰기 아님·2026-06-14 추가)·`verify:agent` 225/0·SCHEMA 무변, 실 SDK/스트림/probe/GUI/SSRF 네트워크는 API 키+Electron 필요로 미검증 🟡)****
> 관련 문서: [features.md](./features.md) · [user-stories.md](./user-stories.md) · [flows.md](./flows.md) · [roadmap.md](./roadmap.md)
>
> **변경 이력**: 2026-06-07 신규 3기능(상단 아이콘바 H1·사이드바 토글 H2·분할 크기조절 H3) Should로 편입 — §6 MoSCoW·§8 단축키(`Ctrl+B`) 추가. **2026-06-07 위 3기능 구현·QA PASS → §6 Should 체크박스 `[x]`·§8 `Ctrl+B` 구현됨 표기**(상태 표기 갱신, 상세 [roadmap.md §0.5](./roadmap.md)). **2026-06-07 H장 연장으로 신규 3기능(터미널 열기 H4·경로 직접 입력 H5·파일 유형 아이콘 H6, US-7.4~7.6) Should로 편입 — §6 MoSCoW 3항목 추가·§8 신규 단축키 불요 명시. 2026-06-07 위 3기능 구현·QA PASS → §6 Should 체크박스 `[x]`로 갱신**(신규 채널 `shell:open-terminal`·예약 채널 `shell:icon` 정식 구현, 상태 표기 갱신, 상세 [roadmap.md §0.5](./roadmap.md)). **2026-06-07 신규 챕터 §I(분석·시각화/접근성 테마)로 2기능(사용량 대시보드 I1·블루라이트 차단 테마 I2, US-8.1·8.2) Should로 편입 — §6 MoSCoW 2항목 추가·§8 신규 단축키 불요 명시·§10 리스크 R4/R5 추가·차트 의존성 recharts(MIT) 명시. 2026-06-07 위 2기능 구현·QA PASS → §6 Should 체크박스 `[x]`·§10 R4/R5 상태 갱신**(I1 신규 채널 `analyze:scan:*` 5종·recharts 831kB lazy 청크, I2 `BLUELIGHT_PALETTE`·`ThemeMode` 4종. I1 파일 유형별 비중 인사이트는 선택항 미구현·네이티브 성능 실측은 런타임 스모크 권장. 상세 [roadmap.md §0.5](./roadmap.md)).**
> **2026-06-07 추가 편입(신규 7건, features §J·user-stories 에픽9)**: 드래그 박스 선택(J1·US-9.1)·패널 실시간 갱신(J2·US-9.2)·Windows 보기 5종(J3·US-9.3)·**제품명 AGT-Finder 브랜딩(J4·US-9.4, M for 릴리스)**·미리보기 2단 확장 뷰어(J5·US-9.5)·미리보기 폭 조절(J6·US-9.6)·즐겨찾기 별칭(J7·US-9.7) — §6 MoSCoW에 추가, §8에 보기 전환 단축키 메모. **2026-06-07 위 7건 구현·QA PASS → §6 Should 체크박스 `[x]`로 갱신**(J1·J3·J4·J5·J6·J7 ✅, **J2도 보류 2건(선택/스크롤 보존·UNC 폴링 폴백) 구현 완료 + 매핑 네트워크 드라이브(`X:\`) `GetDriveType` 연동(`os/driveType.ts` PowerShell CIM `DriveType=4`)으로 🟡→✅ 격상 — `subst`·일부 클라우드 드라이브(`DriveType≠4`)만 미포함 한계**). 신규 채널 `fs:watch:*`(J2)·신규 의존성 highlight.js(BSD-3)/marked(MIT)/dompurify(MPL-2.0, J5)·appId `com.agtfinder.app`(J4). **2026-06-07 스코프 축소: F5(복사)/F6(이동) 단축키 제거(사용자 결정) → §8 단축키 표에서 행 삭제·§6 Must 정정·§11 결정 D4 정정 완료, 코드(`keybindings`·`commandBus`·`fileOps`·`ShortcutHelp`)에서도 제거됨**(D&D·클립보드 복사/이동은 유지).
> **2026-06-07 신규 챕터 §K(되돌리기·휴지통 관리·유형별 비중)로 3기능(feat-K1 되돌리기 `Ctrl+Z` 다단계 undo·feat-K2 휴지통 관리 화면·feat-K3 파일 유형별 비중 인사이트, US-10.1~10.3) Should로 편입·구현·QA PASS(team-dev) → §6 Should 체크박스 `[x]`로 갱신** — §8 단축키 표 `Ctrl+Z`=되돌리기 정식화(`notYet`→`performUndo` undo 연결). **K1·K2는 roadmap §0.5 "P6 미구현 잔여 🔜"의 되돌리기·휴지통 관리 화면의 정식 구현으로 P6 잔여 해소 ✅**, **K3은 I1(US-8.1)의 "(가능 시) 유형별 비중" 선택항 정식 구현 ✅**. K2 신규 채널 `trash:*` 3종·Windows Shell COM `recycleBin.ts`·verify:recyclebin 37, K1 `undoSlice.ts`(cap 50)·`undo.ts`, K3 `categorize.ts`·byCategory 1패스. 신규 의존성 0(PowerShell 시스템 내장). 영구삭제 불가(undo 미push)·휴지통 비우기 확인(`confirmed` 게이트)·undo 충돌 선검증·copy-undo 보수적 등 데이터 안전 수용 기준은 features §K·user-stories 에픽10에 확정. ※ 휴지통 COM·undo 역연산 네이티브 동작은 런타임 스모크 권장.
> **2026-06-07 신규 챕터 §L(그리드 보기 이미지 썸네일)로 1기능(feat-L1 그리드 보기 이미지 썸네일 자체 생성, US-11.1) Should로 편입·구현 완료 ✅(team-dev·QA PASS) → §6 Should 항목 추가·MoSCoW 분류 근거(§L) 추가·§8 신규 단축키 불요 명시.** J3(보기 5종, ✅)에서 보류했던 "이미지 썸네일 자체 생성"을 정식 편입·구현 — 아이콘 그리드에서 이미지 파일을 OS 형식 아이콘 대신 실제 내용 썸네일로 표시(미지원/손상/초대용량/null은 OS 아이콘 `shell:icon`·H6 폴백, 목록/자세히는 OS 아이콘 유지). 가시 셀만 생성·캐시·비차단(1만 항목)·data URL 전달(CSP `img-src data:` 호환)·렌더러 직접 파일 접근 없음(ADR-005). **roadmap §0.5 "그리드/썸네일" 잔여의 정식 편입·구현이자 사실상 마지막 사용자 기능 잔여를 해소**(P7 릴리스 실측·코드서명은 별개 🟡). 구현: 신규 채널 `preview:thumbnail`·`os/thumbnail.ts`(nativeImage 비율보존 resize·30MB 상한·LRU 256·세마포어 4)·`thumbnailCache.ts`·`domain/image.ts`·`FileListView ThumbnailIcon`·신규 의존성 0·`verify:thumbnail` 33. nativeImage 실 디코드·GUI 그리드 렌더은 런타임 스모크 권장.
> **2026-06-08 신규 챕터 §M(외부 연계)로 3기능 정식 편입 → 같은 날 구현 완료·QA PASS ✅(편입 시 🔜 미착수 → MP0~MP5 구현 → 🔜→✅)**: **M1 외부 프로그램으로 D&D 복사(Should·US-12.1)·M2 복사/붙여넣기 Windows 클립보드 외부 연계(CF_HDROP 양방향, Should·US-12.2)·M3 FTP/SFTP 원격 접속(Could·US-12.3~12.5)**. §6 MoSCoW에 Should 2항목·Could 1항목 추가, §6 하단 "MoSCoW 분류 근거(2026-06-08 §M)" 표 추가, §8 단축키 메모 추가(M1~M3 모두 기존 D&D/`Ctrl+C/X/V`/컨텍스트 메뉴 재사용·신규 키 불요). **M1·M2는 기존 Must 기능(A3 패널 간 D&D·B4 복사/붙여넣기)의 외부 확장**, **M3는 §6 "Won't"의 "FTP/SSH 등 원격 프로토콜 브라우징"을 사용자 결정으로 정정·편입**(은폐 금지 — §6 Won't에서 해당 줄 취소선 처리·본 변경 이력·결정 D6 기록). **보안 개정**: ① 자격증명(비밀번호·SSH 키)은 **OS 자격증명 보관소(Windows Credential Manager/DPAPI)에만 저장·평문 금지**(결정 D6·§7), ② "로컬 전용·외부 네트워크 전송 없음(D5)" 원칙을 M3에 한해 **부분 개정** — 사용자가 명시 입력한 원격 호스트로만 연결 허용·그 외 임의 외부 송신 금지(텔레메트리 포함·D5 옵트인 원칙 유지)는 유지(결정 D7·§7). 챕터 식별자 "M"은 MoSCoW 마커 Must(J4 "M for 릴리스")와 구분해 항상 "§M·M1/M2/M3"로 표기. **2026-06-08 §M 3건 구현 완료·통합 QA PASS → §6 Should 체크박스 `[x]`·§6 Could M3 `[x]`·MoSCoW 근거 표 상태줄 ✅로 갱신**(상태 🔜→✅, 신규 채널 `dnd:start-drag`·파일 `clipboard:write/read/has-files`·`remote:*`·신규 의존성 `ssh2-sftp-client`/`basic-ftp`[M3만]·`os/credentials.ts` safeStorage/DPAPI·`remote/*`·verify 신규 7종 213/0). **코드 정합·verify 충족 ✅ / 실 동작(외부 앱 실드롭·탐색기 양방향 복사·이동 실 왕복·실 SFTP/FTP/FTPS 핸드셰이크·호스트키 모달·실 DPAPI 암복호·실 전송/취소/충돌·평문 FTP 경고)은 헤드리스로 미증명 → 런타임 스모크 권장 🟡**(✅ 위장 아님·§K·§L 양식 동일). 상세 [roadmap.md §0.5·§3-M](./roadmap.md)·features §M·user-stories 에픽12·flows F14~F16.
> **2026-06-08 신규 챕터 §N(즐겨찾기 UX 향상)으로 2기능 정식 편입(🔜 미착수 — 기획 단계)**: **N1 즐겨찾기 경로 워터마크(Should·US-13.1)·N2 즐겨찾기 드래그 정렬(Should·US-13.2)**. §6 MoSCoW에 Should 2항목 추가, §6 하단 "MoSCoW 분류 근거(2026-06-08 §N)" 표 추가, §8 단축키 메모 추가(N2 키보드 대체수단·신규 키 불요·기존 `F2`/방향키 동선). **N1·N2는 기존 Must "즐겨찾기/북마크"(C4)와 J7 즐겨찾기 별칭(US-9.7·`SidebarSnapshot.favoriteLabels`)의 비파괴 확장** — N1은 J7 별칭을 표시 텍스트 소스로 재사용(없으면 경로 basename), N2는 `SidebarSnapshot`에 즐겨찾기 순서를 추가 영속한다(기존과 모순 없음). 챕터 식별자 "N"은 MoSCoW 마커와 무관(§M처럼 챕터 라벨일 뿐). **2026-06-08 §N 2건 구현 완료·통합 QA PASS → §6 Should 체크박스 `[x]`·MoSCoW 근거 표 상태줄 ✅·§8 단축키 표에 `Alt+Shift+↑/↓`(N2 재정렬) 추가·키 메모 확정으로 갱신**(상태 🔜→✅, 렌더러 전용·신규 IPC 채널 0·신규 의존성 0·키보드 대체수단 `Alt+Shift+↑/↓` 전역 미배정·충돌 0·핵심 verify 302/0·contrast 실패 0). **경과(은폐 금지): 같은 날 기획 편입(🔜 미착수) → 설계(architecture-review-N: 1차안 `Alt+↑/↓`→`Alt+Shift+↑/↓` 확정 정정) → 구현 → QA PASS(qa-integration-N) → 🔜→✅.** **코드 정합·verify 충족 ✅ / 실 GUI 동작(워터마크 렌더·드래그/키보드 정렬·테마별 반투명도·재시작 순서 유지·IME 키 점유)은 헤드리스로 미증명 → 런타임 스모크 권장 🟡**(✅ 위장 아님). 상세 features §N·user-stories 에픽13(US-13.x)·flows F17~F18·[roadmap.md §0.5](./roadmap.md).
> **2026-06-09 (doc-sync·상태/추적성만·MoSCoW 스코프 문구 무변경)**: ① **§M 결함 수정 2건** — M3 원격 디렉토리 더블클릭 ENOENT(원격 URI 미재구성·`parentOf/breadcrumbs` win32 오해)·M1 외부 드래그 "여기에 드롭" 오버레이 잔존(OS 드래그 인계 후 내부 dragState 미종료)을 수정. **직전 동기화의 "§M 코드 정합 ✅"가 실제로는 원격 진입·드래그 종료가 깨져 있던 ✅위장 드리프트였음을 정정**(코드 정합 회복·실 동작은 여전히 런타임 스모크 🟡). §M 수용 기준·MoSCoW 분류 문구는 무변경(결함 수정·신규 스코프 아님). 상세 [roadmap.md §0.5](./roadmap.md)·traceability §1-M. ② **[스코프 일탈·PM/사용자 결정 대기] "파일/폴더 상단 고정(pin)"** — docs/temp/ref.md "아이디어" 기반으로 코드에는 구현됐으나(컨텍스트 메뉴 상단 고정/해제·디렉토리별 📌 최상단 표시·세션 영속), **PRD/features/US/flows에 정식 기능 항목이 없는 비계획 구현**이다. doc-sync 게이트 원칙(스코프는 사람이 정한다)에 따라 **본 PRD §6 MoSCoW 등 스코프 분류에 임의 추가하지 않았다** — 정식 편입 여부는 PM/사용자 결정 대기(편입 시 product-planner가 정식 항목 추가·chief-architect 추적성 매핑). 구현 사실은 roadmap §0.5 "추가(2026-06-09)" 줄에만 정직하게 기록됨.
> **2026-06-09 (정식 편입 — 위 ② "결정 대기" 해소): 신규 챕터 §O(파일/폴더 상단 고정, US-14.1·F19) 1기능 정식 편입.** **O1 파일/폴더 상단 고정(pin)·Should** — 위 doc-sync에서 "비계획 구현(결정 대기)"으로 플래그됐던 코드 선구현 항목을 PM/사용자 결정으로 **정식 기획 항목화**한다. §6 MoSCoW에 Should 1항목 추가(체크박스 `[x]` — 코드 완료)·§6 하단 "MoSCoW 분류 근거(2026-06-09 §O)" 표 추가·§8 단축키 메모 추가(컨텍스트 메뉴 토글·신규 키 불요). **§O는 파일 목록 보기/정렬(B1·B2, Must)의 부가 UX이자 즐겨찾기 별칭(J7)·워터마크(N1)와 동격의 per-위치 메타 확장** — 고정 데이터는 `SidebarSnapshot.pinnedByDir`(dirPath→항목 경로 배열)로 J7 `favoriteLabels`와 동일 패턴 영속(기존 데이터 비파괴), 표시는 `applyPins`가 정렬 결과 최상단으로 후처리한다(폴더 우선보다도 위·그룹 내부는 정렬 순서 유지). **렌더러 전용·신규 IPC 채널 0·신규 npm 의존성 0**(`verify:domain` 60(applyPins)·`verify:store` 121(pin 액션·영속)·`verify:persistence` 101(coercePinnedByDir)). **코드 정합·verify 충족 ✅ / 실 GUI 동작(컨텍스트 메뉴 토글·목록 최상단 📌 렌더·재시작 후 유지)은 헤드리스로 미증명 → 런타임 스모크 권장 🟡**(✅ 위장 아님·§N 양식 동일). **정직 범위 제외: 고정 항목 간 수동 드래그 재정렬·다중선택 일괄 고정은 1차 범위 밖.** 기존 §A~§N 스코프 문구는 무변경. 상세 features §O·user-stories 에픽14(US-14.1)·flows F19. roadmap·traceability 상태/추적성 갱신은 후속 chief-architect + doc-sync 담당.
> **2026-06-09 (동작 변경 2건 — refinement·기존 기능 수용기준 갱신·새 챕터/MoSCoW 등급/스코프 불변, 출처 docs/temp/ref.md)**: ① **§O 고정 표시 "최상단 정렬"→"스크롤 고정(sticky)"** — 목록(list)·자세히(details) 보기에서 고정 항목이 스크롤해도 상단에 붙어 계속 보이도록 변경(키보드 내비게이션은 sticky 밴드 높이만큼 스크롤 보정). **아이콘 그리드(icons-*)는 wrapping 레이아웃 특성상 sticky 미적용 → 기존대로 "정렬 최상단"만 유지**(보기별 차이 정직 표기). §6 MoSCoW 근거(§O)·features §O1·US-14.1·flows F19 수용기준/서사/플로우 갱신. ② **원격 주소창 경로-only 입력(§H5×§M3 교차)** — 원격(SFTP/FTP) 패널 주소 표시줄 편집 시 호스트(`sftp://host`)는 고정 프리픽스로 표시되고 사용자는 경로만(`/mnt/sub`) 입력하면 현재 호스트와 결합해 이동(전체 URI 입력 강요 없음·방어적으로 전체 URI도 처리·로컬 경로 입력 동작 불변). §6 H5/Could M3 항목·features §H5·§M3·US-7.5·US-12.4·flows 주소입력/F16 수용기준 보강. **검증: typecheck/lint/build 0·verify 회귀 0(domain 60·store 121·persistence 101·perf 25 windowing 불변·remote-route 47). 실 GUI(원격 주소 경로-only 입력·이동, 고정 sticky 스크롤 고정 렌더·키보드 보정)는 헤드리스 미증명 → 런타임 스모크 권장 🟡.** roadmap·traceability 상태/추적성은 후속 chief-architect + doc-sync 담당.
> **2026-06-09 (신규 기획 편입 — 파워 기능 14종 / M6 3종 구현 완료(코드)·통합 검증 PASS ✅·실 GUI 🟡 · 나머지 11종 🔜)**: 타 탐색기와 차별화하는 파워 기능 14개를 6개 신규 챕터로 정식 편입한다. **M6 배정 3종(§P P1 폴더 비교 메타·단일깊이·§R R1 고급 일괄 이름변경·§T T3 정렬/필터 프리셋)은 2026-06-09 구현 완료(코드 정합·verify 충족)·실 GUI 런타임 스모크 🟡(P1 해시·재귀 비교는 M7 연기). 나머지 11종(Q1·R2·R3·R4·S1·S2·T1·T2·U1·U2·U3)은 🔜 미착수(M7~M9·기획 신규 편입)**. **§P 듀얼 패널 폴더 비교·동기화(P1·US-15.1·Should)** · **§Q 압축파일 폴더처럼 열기(Q1·US-16.1·Should)** · **§R 파워 파일 작업(R1 고급 일괄 이름변경·US-17.1·Should / R2 중복 파일 찾기·US-17.2·Should / R3 전송 큐 매니저·US-17.3·Should / R4 복사 시 체크섬 검증·US-17.4·Could)** · **§S 검색·실행 가속(S1 내용 검색 grep·US-18.1·Should / S2 명령 팔레트·US-18.2·Should)** · **§T 메타·표시 UX(T1 파일 태그/색상 라벨·US-19.1·Should / T2 폴더 용량 인라인·US-19.2·Should / T3 정렬/필터 프리셋·US-19.3·Should)** · **§U 빠른 보기·탐색·탭 UX(U1 Space 퀵룩·US-20.1·Should / U2 브레드크럼 드롭다운·US-20.2·Should / U3 탭 색상/잠금·탭 분리·US-20.3·Could)**. §6 MoSCoW에 14항목 추가(전부 미체크 `[ ]`)·§6 하단 "MoSCoW 분류 근거(2026-06-09 §P~§U)" 표 추가·§8 단축키에 `Ctrl+Shift+P`(명령 팔레트·신규·충돌 없음) 추가·§12 마일스톤 M6~M9 제안 추가. **보안 제약(기획): 원격·압축·grep·해시는 ADR-005 프로세스 보안·경로 검증(Zip Slip 차단 포함)·throw0/Result·IPC guard 준수(상세 설계는 chief-architect)·외부로 나가는 네트워크/실행 없음**(M3 원격 외 새 네트워크 경계 없음). 상세 features §P~§U·user-stories 에픽15~20(US-15.x~US-20.x)·flows F20~F33. roadmap·traceability는 후속 chief-architect + doc-sync 담당.
> **2026-06-09 (doc-sync·상태/추적성만·MoSCoW 스코프 문구 무변경 — 파워 기능 M7 2차 구현 완료(코드)·통합 검증 PASS ✅·실 워커/실 GUI 🟡)**: 파워 기능 마일스톤 **M7**(공용 해시 인프라 W1 + 전송 큐 인프라 W2 + 4기능)을 구현·통합 검증 완료 → 해당 §6 MoSCoW 체크박스 `[ ]`→`[x]`로 상태 표기 갱신(스코프/등급/수용기준 문구 무변경). **R2 중복 파일 찾기(US-17.2·Should)·R3 전송 큐 매니저(US-17.3·Should)·R4 복사 시 체크섬 검증(US-17.4·Could)·P1 듀얼 패널 비교 해시/재귀 확장(US-15.1, M6 메타·단일깊이 → M7 해시·재귀)** 을 🔜→구현 완료(코드)로 정정. **신규 IPC 채널 `hash:*`(compare/dup/verify/cancel)·`queue:*`(list/state/pause/resume/retry/set-concurrency) 추가**(P1 동결 이후 Should 신기능 신규 채널 — 기존 8선례 동일 invoke·guard/zod/Result 규약·SHA-256 Node 내장이라 **신규 npm 의존성 0**). 신규 검증 `verify:hash` 46·`verify:queue` 47(둘 다 0 fail). **코드 정합·verify 충족 ✅ / 실 동작(해시 워커 잡·큐 스케줄러 일시정지/재개·중복 정리·복사후 검증 트리거·해시·재귀 실 GUI 비교)은 헤드리스로 미증명 → 런타임 스모크 권장 🟡**(✅ 위장 아님·R4 비원자 복사 검증 타이밍·원격 큐 일시정지 미배선 정직 표기). 나머지 §Q·§S·§T(T1/T2)·§U는 🔜 유지(M8/M9). 상세 [roadmap.md §0.5](./roadmap.md)·features §P/§R·user-stories 에픽15/17·flows F23~F25·traceability §1-P1/§1-R2/§1-R3/§1-R4.
> **2026-06-10 (신규 기획 편입 — §W 자세히 보기 컬럼 헤더·너비 조절 1종 / 구현 완료(코드)·실 GUI 🟡): 신규 챕터 §W(자세히 보기 컬럼, US-21.1·F34) 1기능 정식 편입.** **W1 자세히 보기 컬럼 헤더 + 너비 드래그 조절·Should** — 사용자 직접 요청으로 정식 기획 항목화한다. 자세히(details) 보기에 컬럼 헤더 막대(이름 | 크기 | 유형 | 수정한 날짜)를 추가하고, 컬럼 분리자를 드래그로 너비 조절(분리자 포커스 시 방향키 리사이즈·컬럼별 최소 너비·`이름` 컬럼 신축)하며 폭을 세션에 영속(전역 설정·재시작 후 유지)한다. §6 MoSCoW에 Should 1항목 추가(체크박스 `[x]` — 코드 완료)·§6 하단 "MoSCoW 분류 근거(2026-06-10 §W)" 표 추가·§8 단축키 메모 추가(분리자 방향키는 분리자 포커스 한정 로컬 핸들러·전역 키 미배정·신규 키 불요). **§W는 파일 목록 보기(B1, Must)의 부가 표시 UX이자 상단 고정(O1)·즐겨찾기 별칭(J7)과 동격의 렌더러+세션 영속 소규모 확장** — 폭은 `SessionSnapshot.ui.detailsColumnWidths`(하위호환 선택 필드+coerce)로 `pinnedByDir`/`previewWidth`와 동일 패턴 영속한다. **렌더러+세션 영속만·신규 IPC 채널 0·신규 npm 의존성 0·`SESSION_SCHEMA_VERSION` 무변경**(`verify:domain` 컬럼 폭 24케이스: `clampColumnWidth`/`coerceDetailsColumnWidths`). **자세히 보기 한정**(그리드/목록 해당 없음)·**헤더 클릭 정렬은 1차 범위 밖**(너비 조절·레이블만·정직 표기). **코드 정합·verify 충족 / 실 GUI 동작(헤더 렌더·드래그 리사이즈·키보드 리사이즈·재시작 후 폭 유지)은 헤드리스로 미증명 → 런타임 스모크 권장 🟡**(✅ 위장 아님·§O 양식 동일). 기존 §A~§U 스코프 문구는 무변경. 상세 features §W·user-stories 에픽21(US-21.1)·flows F34. roadmap·traceability 상태/추적성 갱신은 후속 chief-architect + doc-sync 담당.
> **2026-06-10 (doc-sync·상태/추적성만·MoSCoW 스코프 문구 무변경 — 파워 기능 M8 6종 + 신규 §W1 구현 완료(코드)·통합 검증 PASS ✅·실 GUI/실 워커 🟡)**: 파워 기능 마일스톤 **M8**(S1 내용 검색 grep·S2 명령 팔레트·T1 파일 태그/색상 라벨·T2 폴더 용량 인라인·U1 Space 퀵룩·U2 브레드크럼 드롭다운) + 신규 Should §W1(자세히 보기 컬럼 헤더·너비 드래그)을 구현·통합 검증 완료 → 해당 §6 MoSCoW 체크박스 `[ ]`→`[x]`로 상태 표기 갱신(스코프/등급/수용기준 문구 무변경). **S1·S2·T1·T2·U1·U2** 6항목을 🔜→구현 완료(코드)로 정정·§8 단축키 표 `Ctrl+Shift+P`(S2)·`Space`(U1) 구현 완료 표기·§12 마일스톤 M8 행 ✅로 갱신. **S1만 신규 IPC 채널 `search:content:*` 5종 추가**(P1 동결 이후 신기능 신규 채널 — 기존 선례 동일 invoke·guard/zod/Result 규약·ADR-010·외부 ripgrep 비채택·**신규 npm 의존성 0** Node 내장), **나머지 5종(S2·T1·T2·U1·U2)은 신규 채널 0**(렌더러 전용·세션 메타·기존 채널 재사용). 신규 검증 `verify:search` 58·`verify:palette` 20·`verify:contentsearch` 38(전부 0 fail) + domain 204·store 222·persistence 119. **T1은 T3 폐기 때 삭제됐던 `filterComposition.ts` 태그 합성을 새로 설계함.** **코드 정합·verify 충족 ✅ / 실 GUI·실 워커(grep 스트리밍·결과 점프·팔레트 검색/실행·Space 퀵룩·태그 부여/필터·폴더용량 실 스캔·브레드크럼 ▾ 이동)은 헤드리스로 미증명 → 런타임 스모크 권장 🟡**(✅ 위장 아님·§N/§O 양식 동일). **M8 잔여 0 — 파워기능 잔여는 M9(Q1 압축·U3 멀티윈도우) 2종.** 상세 [roadmap.md §0.5·§1](./roadmap.md)·features §S/§T/§U/§W·user-stories 에픽18~21·flows·traceability §1-S1/§1-S2/§1-T1/§1-T2/§1-U1/§1-U2/§1-W.
> **2026-06-10 (신규 기획 편입 — 사용자 직접 요청 2종 / 구현 완료(코드)·실 GUI 🟡)**: 사용자 직접 요청 2건을 정식 기획 항목화한다. **① 탭 사용자 지정 이름(custom tab name)·Should**(§U 연장 §U4·US-20.4·F35) — 탭 라벨 더블클릭 인라인 편집(Enter 확정/Esc 취소/blur 확정·빈 값=자동 제목 복귀)·우클릭 "이름 바꾸기"로 자동 제목(폴더명)을 덮어쓰고 세션 영속. 기존 §U3(탭 색상/잠금·탭 분리)와 별개로 **이름 부여만** 추가(중복 아님). **렌더러+세션 영속만·신규 IPC 채널 0·신규 npm 의존성 0·`SESSION_SCHEMA_VERSION` 무변경**(`Tab.customName?`·`TabSnapshot.customName?` 하위호환 선택 필드). **② 좌측 사이드바 "빠른 위치"·Should**(신규 챕터 §X·US-22.1·F36) — 사이드바 "빠른 위치" 섹션의 노드 클릭으로 활성 패널을 OS 시스템 폴더로 이동. **신규 채널 `fs:known-folders`**(무인자 invoke → `KnownFoldersDTO { downloads, desktop, documents, pictures, home }`·`app.getPath`·P1 동결 후 신기능 신규 채널·선례 동일 규약)·**신규 npm 의존성 0**. 당시(2026-06-10) 정직 범위: 다운로드 항목만 렌더. **(2026-06-28 동작 확장: 다운로드·바탕화면·문서·사진 4개 노드로 확대·각 경로 조회 실패 시 해당 행만 비표시·`home`은 DTO로 함께 가져오나 미표시·예약·MoSCoW Should 무변경.)** §6 MoSCoW에 Should 2항목 추가(체크박스 `[x]` — 코드 완료)·§8 단축키 메모 추가(둘 다 신규 키 불요 — 탭 이름=라벨 더블클릭/우클릭·다운로드=사이드바 클릭). 상세 features §U4·§X·user-stories 에픽20(US-20.4)/에픽22(US-22.1)·flows F35·F36. roadmap·traceability 상태/추적성 갱신은 후속 chief-architect + doc-sync 담당.
> **2026-06-12 (신규 기획 편입 — §Y Windows 셸 컨텍스트 메뉴 연동 1종 / 🔜 미착수): 신규 챕터 §Y(Windows 셸 컨텍스트 메뉴 연동, US-23.1·F37) 1기능 정식 편입.** **Y1 파일/폴더 우클릭 시 Windows 셸 컨텍스트 메뉴 항목 노출·실행·Should** — 사용자 직접 요청으로 정식 기획 항목화한다(설계·구현 전·🔜 미착수). 파일/폴더 우클릭 시 앱 React 컨텍스트 메뉴(B6) 하단에 "Windows 메뉴" 섹션을 추가해, Windows에 설치된 프로그램들이 등록한 셸 컨텍스트 메뉴 항목(예: "반디집으로 압축하기"·"Cursor로 열기"·"AGT-Finder로 열기")을 노출하고 선택 시 실행한다. **기술 방식(사용자 확정): Windows 셸 COM `Shell.Application`의 `FolderItem.Verbs()` 열거 + `verb.DoIt()` 실행**(네이티브 N-API 애드온 비채택·신규 네이티브 의존성 0 원칙)·메인 프로세스 **상주 PowerShell 워커**(기존 hash/archive 워커 패턴 동일)로 COM 호출해 우클릭 지연 완화. 신규 IPC 채널 2종 예상(verb 조회·verb 실행 — 정확한 채널명/프로토콜은 chief-architect 설계 단계 확정·기획은 행동 계약 수준만). §6 MoSCoW에 Should 1항목 추가(체크박스 `[ ]` — 미구현)·§6 하단 "MoSCoW 분류 근거(2026-06-12 §Y)" 표 추가·§8 단축키 메모 추가(우클릭 메뉴 내 섹션·신규 키 불요)·§12 마일스톤 표에 "후속(M10)" 행 추가. **§Y는 컨텍스트 메뉴 인프라(B6, Must)·ADR-005 보안 모델의 확장이자 외부 연계(§M M1·M2)와 결을 같이하는 Windows 셸 상호운용 UX** — 우선순위 **Should**. **정직 한계(수용기준에 행동 계약으로 반영): ① 캐스케이드 서브메뉴 평탄화/누락 가능(보이는 것만 best-effort)·② 다중 선택 시 단일 항목 기준 → 1차 단일 선택 한정 노출(다중 선택 시 섹션 숨김)·③ 앱 자체 구현 중복 verb(open/cut/copy/paste/delete/rename/properties 등) canonical name 블랙리스트 필터·④ verb 실행은 fire-and-forget(성공/실패 미추적)·⑤ 워커 첫 기동/조회 지연 시 로딩 상태 허용.** **비범위(Non-goal): 네이티브 메뉴 팝업(HMENU)·캐스케이드 서브메뉴 완전 재현·다중 선택 일괄 invoke.** 기존 §A~§X 스코프 문구는 무변경. 상세 features §Y·user-stories 에픽23(US-23.1)·flows F37. roadmap·traceability 상태/추적성 갱신은 후속 chief-architect + doc-sync 담당.
> **2026-06-12 (§Y 구현 완료·통합 QA PASS → 상태 표기 동기화 — doc-sync): §Y Y1 Windows 셸 컨텍스트 메뉴 연동이 설계 ADR-013 → T1~T6(backend+frontend) 구현 → 통합 QA PASS([qa-integration-Y](./reviews/qa-integration-Y.md))로 완료 → §6 Should 체크박스 `[ ]`→`[x]`·MoSCoW 근거(§Y) 상태줄·§12 마일스톤 "후속(M10)" 행을 구현 완료(코드)로 갱신.** 신규 invoke 채널 `shell:context-verbs`/`shell:invoke-verb` 2종(P1 동결 후 신기능 선례 동일 규약)·신규 npm/네이티브 의존성 0(상주 PowerShell `shellVerbsWorker.ps1`+COM Verbs)·`FileOpErrorCode`에 `'EVERB'` 비파괴 확장·`SESSION_SCHEMA_VERSION` 무변·`verify:shellverbs` 75/0·typecheck/build PASS·ESLint 0. **스코프/MoSCoW 문구·수용기준 본문 무변경(상태표기만). 정직 한계(✅ 위장 아님): 실 GUI(우클릭 "Windows 메뉴" 섹션·verb 클릭 실행·다중선택/원격/archive 숨김·한글 display)·실 패키지 설치본(asar ps1·ExecutionPolicy·`npm run dist` 미수행)은 런타임 스모크 권장 🟡.** 상세 [roadmap.md §0.5 2026-06-12 §Y 단락](./roadmap.md)·traceability §1-Y.
> **2026-06-14 (동작 확장 정식 편입 — 이미 구현·검증된 동작 확장 3건을 기획 수용기준/명세/플로우에 반영·MoSCoW 등급/스코프 분류 무변경·상태표기 정합)**: 사용자 결정으로 이미 구현·검증된(상태 단일 출처 [roadmap.md §0.5 2026-06-14 단락](./roadmap.md): "구현 완료(코드)·실 동작/실 GUI 🟡") 동작 확장 3건을 정식 편입한다. **① 탭 루트 잠금(§U3·US-20.3·F33의 동작 확장)** — 탭 잠금 시 활성 패널 경로를 `Tab.lockedRoot`로 고정·잠긴 동안 루트 밖(상위) 이동 차단+안내 토스트·🏠 "잠긴 루트로 이동" 버튼·해제 시 루트 동반 해제·`lockedRoot` 세션 비파괴 영속(`tabLock.ts#isWithinLockedRoot`·`panelsSlice` navigate 가드). 기존 US-20.3(Could)의 "잠긴 탭 닫기 가드"에 더해 루트 잠금을 수용기준으로 추가. **② FTP/SFTP 접속 초기 폴더(§M3·US-12.3의 동작 확장)** — 연결 직후 서버 작업 디렉토리(FTP `pwd`·SFTP `cwd`·보통 홈) 진입·미보고 시 `/` 폴백(`RemoteConnectRes.initialPath?` 체인). **③ FTP 폴더 재귀 업로드 + 업로드 충돌 정책(§M3·US-12.5의 동작 확장)** — 폴더 업로드 시 하위 트리 재귀(부모→자식 원격 디렉토리 생성+파일 개별 업로드·이전엔 폴더 누락)·업로드도 다운로드와 동일 `ConflictPolicy`(overwrite/skip/rename) 배선(`RemoteUploadReq.conflictPolicy`·계약 기존·미배선→배선). **셋 다 기존 항목의 동작 확장 — MoSCoW 등급(U3=Could·M3=Could) 무변경·신규 IPC 채널 0(기존 `remote:connect`/`remote:upload` 비파괴 확장·탭 잠금=렌더러 전용)·신규 npm 의존성 0·`SESSION_SCHEMA_VERSION` 무변경.** §6 MoSCoW(M3 Could·U3 Could) 항목 본문에 동작 확장 부기·§8 단축키 메모(셋 다 신규 키 불요)·§12 마일스톤(M5+ §M 행·M9 §U3 행) 노트 갱신. **코드 정합·`verify:remote` 36 충족 / 실 동작(라이브 FTP/SFTP 초기 폴더·폴더 재귀 업로드·충돌 해결)·실 GUI(탭 루트 잠금 차단/토스트/🏠 버튼/재시작 후 복원)는 헤드리스로 미증명 → 런타임 스모크 권장 🟡**(✅ 위장 아님). 기존 §A~§Y 스코프 문구는 무변경. 상세 features §M3·§U3·user-stories US-12.3/12.5/20.3·flows F16·F33.
> **2026-06-14 (신규 기획 편입 — §Z Agentic 자연어 파일 에이전트 1종 / 🔜 설계 완료·구현 전): 신규 챕터 §Z(Agentic 자연어 파일 에이전트, US-24.1~24.5·F38~F41·ADR-014) 정식 편입.** **Z1 자연어 파일 에이전트(Plan→Confirm→Execute)·Could** — 사용자 직접 요청으로 정식 기획 항목화한다(설계 ADR-014·`docs/architecture/agent-natural-language-design.md` 완료·구현 전·🔜 미착수). 자연어 지시(예: "다운로드 폴더에서 2023년 송장 PDF를 찾아 `Invoices/2023/`로 옮겨줘")를 받아, 에이전트가 **읽기 도구로 자율 탐색**하며 **변경안(plan)** 을 수집하고, 사용자가 **diff로 확인·부분 수용**한 뒤, 기존 파일작업 파이프(`op:*`·휴지통·되돌리기 `Ctrl+Z`)로 **실행**한다. **핵심 안전 모델(읽기 자유 / 쓰기는 확인 전 미실행)**: LLM은 읽기 도구를 자유롭게 호출하지만 쓰기 도구는 실제 파일을 건드리지 않고 plan에 적재(stage)만 하며, 모든 실제 변경은 사용자 확인 후 검증된 기존 파이프를 거친다. **멀티 AI 제공자(사용자 결정): Claude(Anthropic)·OpenAI·내부 자체 모델(OpenAI 호환 HTTP 엔드포인트) 셋 다 연결 가능**하며, 사용자가 설정에서 제공자/모델/키를 선택·전환한다(내부 엔드포인트는 base URL 화이트리스트로 SSRF 차단). **BYO 키**(사용자 제공·과금 사용자 책임)·키는 안전 보관(safeStorage)·키 미보유 시 기능 비활성+안내. **1차 도구 범위: 로컬 파일 한정·삭제는 휴지통만**(영구삭제·원격 FTP·압축 내부·셸 명령 제외)·**파일 내용의 외부 전송은 명시 동의 게이트**(기본은 경로·메타데이터만 전송). §6 MoSCoW Could에 1항목 추가(체크박스 `[ ]` — 미구현·🔜)·§6 하단 "MoSCoW 분류 근거(2026-06-14 §Z)" 표 추가·§8 단축키 메모(명령 팔레트/아이콘바 진입·신규 키 최소·기존 `Ctrl+Shift+P` 재사용 가능)·§12 후속(M11) 행 추가·§7 보안 절에 D8(에이전트 네트워크 경계·멀티 제공자 화이트리스트·내용 동의)·§11 결정 D8 추가. **§Z는 §M 외부 연계(M3 원격·D7 네트워크 경계 부분 개정)·명령 팔레트(S2)와 결을 같이하는 부가 기능이자, 핵심 파일 기능(§A~§Y)과 완전 독립**(에이전트 없이도 모든 핵심 작업 동작)·우선순위 **Could**. **정직 한계(수용기준에 행동 계약으로 반영): ① LLM plan은 비결정적·오류 가능 → 최종 방어선은 사용자 diff 확인(부분 수용·거부·undo가 안전망)·② 프롬프트 인젝션(파일명·내용에 섞인 지시)은 plan 적재까지는 막지 못함 → 쓰기 미실행+diff 게이트가 차단·③ tool-use(function-calling) 미지원 제공자/모델은 에이전트 비활성 또는 제한+명확한 안내·④ 비용은 BYO 키라 사용자 과금(상한으로 폭주만 차단·비용 자체는 사용자 책임).** **비범위(Non-goal·1차): 영구삭제·원격(FTP)·압축 내부·셸 명령 실행 도구·전 디스크 자율 작업·완전 자동 실행(사용자 확인 없는 변경)·창 간 동시 다중 run.** 기존 §A~§Y 스코프 문구는 무변경. 상세 features §Z·user-stories 에픽24(US-24.1~24.5)·flows F38~F41. roadmap·traceability 상태/추적성 갱신은 후속 chief-architect + doc-sync 담당.
> **2026-06-14 (§Z 읽기 전용 범위 구현 완료(코드)·통합 검증 PASS → 상태 표기 동기화 — doc-sync): §Z Z1 Agentic 자연어 파일 에이전트의 읽기 전용 범위(US-24.1·24.3·24.4·24.5)가 ADR-014/015 설계 → Z0(제공자 추상화·function-calling 정규화·SSRF 가드·읽기 도구 7종 레지스트리)·Z1(읽기 전용 에이전트·패널·제공자/키 설정) 구현·통합 검증 PASS로 코드 완료 → §6 MoSCoW Could 항목 본문 상태·MoSCoW 근거(§Z) 상태줄·§12 후속(M11) 행을 "읽기 전용 범위 구현 완료(코드)·실 동작 🟡 / 쓰기(US-24.2) 🔜 deferred"로 갱신(체크박스 `[ ]` 유지 — 쓰기 미구현+런타임 미검증).** **쓰기(plan 수집·Confirm→Execute=US-24.2)는 사용자 "읽기 전용으로 완성" 결정으로 🔜 deferred(`agent:confirm`=EUNSUPPORTED).** 신규 IPC 채널 `agent:*`(run/event/cancel/confirm + provider set·get·list-models·probe + key set·has·동결 후 신기능 선례 동일 규약)·신규 npm 의존성 `@anthropic-ai/sdk`+`openai` 2종(네이티브 0)·`SESSION_SCHEMA_VERSION` 무변·`verify:agent` 225/0(2026-06-14 `open_tab` 내비 도구 추가로 201→225)·`verify:eslint-agent` 20/0·typecheck(node+web)/build PASS·부팅 exit 0. **스코프/MoSCoW 등급·수용기준 본문 무변경(상태표기만). 정직 한계(✅ 위장 아님): 헤드리스 verify·코드 정합만 ✅·실 SDK 왕복·실 스트림·실 probe·실 GUI·실 SSRF 네트워크는 미검증(API 키+Electron 필요)·창 렌더 미확인 → 실 동작 🟡.** 상세 [roadmap.md §0.5 2026-06-14 §Z 단락](./roadmap.md)·traceability §1-Z. **[2026-06-14 증분 — `open_tab` 내비게이션 도구 추가]: 읽기 도구 7종 → 도구 8종(읽기 7종 + `open_tab`·`mode:'navigate'`·새 탭 열고 이동·비파괴 내비·**파일 쓰기 아님**·쓰기 도구는 여전히 deferred)·`AgentEvent`에 `action` 변형 비파괴 추가·신규 IPC 채널 0(기존 `agent:event` 재사용)·`verify:agent` 201→225·상태 등급 무변(읽기 전용 범위 구현 완료(코드)·실 GUI 🟡). 수용기준 본문·MoSCoW 무변경(상태표기/추적성만).**
> **2026-06-18 (doc-sync·상태/추적성만·MoSCoW 스코프 문구 무변경 — §U3 동작 확장 2건 구현 완료(코드)·실 GUI 🟡)**: §U3(US-20.3 탭 색상/잠금/분리)의 동작 확장 2건을 구현·검증 완료 → §12 마일스톤 M9 행 U3 status 노트에 부기(체크박스·등급 무변). **① 탭 색상 전체 배경 + 파스텔 웜/쿨/중립 팔레트** — 좌측 3px 막대→탭 전체 파스텔 틴트(활성 0.34/비활성 0.18)·파일 태그(`TAG_PALETTE`)와 의도가 달라 **탭 전용 팔레트 분리**(신규 `renderer/domain/rules/tabColors.ts` `TAB_COLOR_PALETTE` 12색·웜/쿨/중립·신규 키 coral·amber·teal·sky·lavender + 기존 7키 하위호환·`TabBar.tsx` 전체 배경/그룹 메뉴·`defaults.ts` 탭 색상 검증 `TAG_KEYS`→`TAB_COLOR_KEYS` 분리). **② 탭 드래그 아웃 → "탐색기 전용" 경량 compact 창 분리** — 기존 우클릭 "새 창 분리"(풀 셸)와 별개로 탭을 창 밖 드롭 시 앱 탭바/명령바/사이드바/미리보기/상태바·좌우 분할 없는 단일 패널 창(단 패널 자체 헤더 `PanelToolbar`[주소·뒤로/앞으로/위로·보기]·검색바는 유지·2026-06-18 후속 정정·신규 `ui/layout/CompactExplorer.tsx`가 `Panel` 통째 렌더·`windowSplit.ts#detachTabToCompactWindow`·계약 비파괴 확장 `WindowMode`'full'|'compact'·`WindowSplitTabReq.mode?`/`WindowInitRes.mode`·`uiSlice.windowMode`). **둘 다 기존 §U3 동작 확장 — 신규 IPC 채널 0(기존 `window:split-tab`/`window:get-init` 비파괴 확장)·신규 npm 의존성 0·`SESSION_SCHEMA_VERSION` 무변(신규 색상 키만 화이트리스트 확장)·MoSCoW/우선순위/수용기준 문구 무변경.** build PASS·ESLint 0·`verify:store` 296/0·`verify:persistence` 147/0(회귀 0·신규 케이스 0). **정직 한계(✅ 위장 아님): 헤드리스 verify·타입·빌드·코드 정합만 ✅·실 GUI(탭 전체 채색·파스텔 표출·웜/쿨 메뉴·드래그 아웃→경량 창·경량 창 파일목록/키보드 내비)는 Electron 미실행 → 런타임 스모크 권장 🟡.** **⚠️ 드리프트(결정 대기): ②의 "드래그 아웃→경량 compact 창"은 features §U3/US-20.3/flows F33 "탭 분리=새 창(풀 셸)" 수용기준 미명시 신규 동작/창 종류 — 기획 4종 본문 무수정·정식 편입 여부 PM/사용자 결정 대기.** 상세 [roadmap.md §0.5 2026-06-18 단락](./roadmap.md)·traceability §1-U3.
> **2026-06-30 (동작 확장 정식 편입 — V14 드라이브 연결/해제 자동 갱신을 §J8·US-9.8로 정식 편입): 신규 기능 §J8 드라이브 연결/해제(토폴로지 변경) 자동 갱신·Should.** 이미 구현·검증·게시(v1.13.1)된 비계획 구현(roadmap §0.5 "⚠️ 스코프 일탈" 플래그)이던 V14를 사용자 정식 편입 결정으로 기획 4종에 정식 추가한다. USB 등 이동식/네트워크 드라이브 연결·해제(`WM_DEVICECHANGE`)를 감지해 사이드바 트리·"내 PC" 패널·대시보드 디스크 사용량을 자동 재열거(1.2초 디바운스·`loadDrives` 병합으로 펼침 상태 보존)한다. **J2(features §J2·US-9.2, 디렉토리 내부 파일 워처 `fs:watch:*`)와 인접하나 별개**(드라이브 마운트/언마운트 ≠ 디렉토리 내부 변경)이므로 J2 수용기준에 끼워넣지 않고 §J에 별도 항목으로 추가. §6 MoSCoW Should에 1항목 추가(체크박스 `[x]` — 코드 완료)·§12 마일스톤 "후속(M12)" 행 추가·§8 신규 단축키 불요(자동 동작). **신규 푸시 evt `fs:drives-changed` 1종·신규 invoke 채널 0·신규 npm/네이티브 의존성 0(Windows 내장 `BrowserWindow.hookWindowMessage`)·`SESSION_SCHEMA_VERSION` 무변.** **구현 완료(코드)·`verify:store` 296/0·`verify:persistence` 147/0·build PASS / 실 USB 물리 연결·해제→실 GUI 자동 갱신은 Electron 미실행·물리 디바이스 부재로 미검증 → 런타임 스모크 권장 🟡**(✅ 위장 아님). 기존 §A~§Z 스코프 문구 무변경. 상세 features §J8·user-stories 에픽9(US-9.8)·flows F42·roadmap §0.5(2026-06-30 단락·스코프 일탈 플래그 해소)·traceability §1-V(V14 정식 편입).
> **2026-07-14 (정식 편입 — §U5 새 창(현재 위치 복제) `Ctrl+N` 1건 / 구현 완료(코드)·v1.15.0 게시·실 GUI 🟡): 신규 기능 §U5(US-20.5·F43) 정식 편입.** **U5 새 창(현재 위치 복제)·Should** — 이미 구현·게시(v1.15.0·커밋 `acc30bf`)됐으나 기획 문서에 항목이 없던 비계획 구현(roadmap §0.5 "⚠️ 스코프 일탈" 플래그)을 **사용자 정식 편입 결정**으로 기획 항목화한다. Windows 탐색기 관례대로 `Ctrl+N`을 누르면 **현재 위치(활성 탭)를 그대로 가진 창이 하나 더 열린다(복제)** — 기존 §U3 "탭 분리(새 창)"(탭을 새 창으로 **옮김**·소스 탭 제거)와 달리 **소스 탭을 닫지 않는다**(별개 동작·중복 아님). 명령 팔레트(`Ctrl+Shift+P`)·단축키 도움말에도 "새 창(현재 위치 복제)"로 자동 노출(KEYBINDINGS 단일 출처 파생). 텍스트 입력 컨텍스트(주소창 편집·검색·이름변경·다이얼로그)에서는 가로채지 않는다(타이핑 보존)·기존 `Ctrl+Shift+N`(새 폴더)과 충돌 없음. §6 MoSCoW Should에 1항목 추가(체크박스 `[x]` — 코드 완료)·§6 하단 "MoSCoW 분류 근거(2026-07-14 §U5)" 표 추가·**§8 단축키 표에 신규 그룹 "창" + `Ctrl+N` 행 추가**·§12 마일스톤 "후속(M13)" 행 추가. **렌더러 전용(main 무변경)·신규 IPC 채널 0(기존 `window:split-tab` 재사용)·신규 npm 의존성 0·`SESSION_SCHEMA_VERSION` 무변.** **정직 한계(✅ 위장 아님): 새 창은 primary=false → 세션 자동저장에 미참여 → 앱 재시작 시 복원되지 않는다(기존 §U3 windowManager의 알려진 한계 승계·의도적 MVP). 헤드리스 검증만 통과(typecheck node+web PASS·ESLint 0·`verify:palette` 20/0·`verify:domain` 215/0·`verify:store` 296/0·레지스트리 스모크 OK) / 실 GUI(실제 `Ctrl+N` → 새 창 표출)는 런타임 스모크 권장 🟡.** 기존 §A~§Z 스코프 문구는 무변경. 상세 features §U5·user-stories 에픽20(US-20.5)·flows F43.
> 구현 현황 요약은 [roadmap.md §0.5](./roadmap.md) 참조. 상태 범례: ✅ 구현 완료 · 🟡 부분 · 🔜 미착수

---

## 1. 개요

**AGT-Finder**(코드네임 Explorer)는 여러 디렉토리를 동시에 보고 다룰 수 있는 Windows 데스크톱 파일탐색기다.
**탭(여러 위치 보관)** 과 **분할 패널(화면을 나눠 여러 패널을 동시 표시)** 을 모두 지원해, 서로 다른 폴더를
나란히 띄워 놓고 패널 간에 파일을 바로 옮기고 복사할 수 있다.
파일을 자주 옮기고 정리하는 파워유저·개발자·일반 사용자가 겪는 "한 번에 한 폴더만 보이는"
Windows 기본 탐색기의 답답함을 해결하는 것이 목표다. (Electron 기반 데스크톱 앱)

---

## 2. 배경 / 문제 정의

### 사용자 문제
- Windows 기본 탐색기는 한 창에서 **한 폴더**만 집중해 보여, 두 폴더 간 작업 시 창을 여러 개 띄워야 한다.
- 탭이 도입됐지만 **분할(나란히 보기)** 이 없어, 출발지·도착지를 동시에 보기 어렵다.
- 폴더를 오가며 같은 경로를 다시 찾는 일이 잦고, 즐겨찾기/최근 위치 활용이 빈약하다.
- 대량 파일 목록 로딩과 대용량 복사 시 체감 속도가 느리고, 진행 상황 파악이 어렵다.
- 키보드 중심 작업, 다중 선택·일괄 처리 같은 파워유저 워크플로 지원이 약하다.

### 비즈니스 목표
- "여러 디렉토리 동시 관리"라는 **명확한 단일 차별점**으로 파워유저 시장에 진입한다.
- 학습 곡선을 낮춰(친숙한 탐색기 UX 계승) 일반 사용자까지 확장 가능한 기반을 만든다.

---

## 3. 목표 및 성공 지표

| 구분 | 지표 | 1차 릴리스 목표 |
|---|---|---|
| 핵심 가치 | 분할 패널 사용 세션 비율 | 주 활성 사용자의 40% 이상이 분할 패널을 1회 이상 사용 |
| 효율 | 패널 간 파일 이동/복사 작업 수 | DAU당 평균 5회 이상 |
| 성능 | 10,000개 파일 폴더 첫 렌더 | 1.5초 이내(스피너→첫 화면) |
| 성능 | 대용량 복사 진행률 갱신 지연 | 200ms 이내 갱신, UI 비차단 |
| 유지 | 주간 리텐션(W1) | 30% 이상 |
| 안정성 | 크래시 프리 세션 | 99.5% 이상 |

> 지표는 1차 릴리스 후 실측 기반으로 재보정한다(가정 단계 수치).

---

## 4. 대상 사용자 / 페르소나

### P1. 파워유저 "정리광 민수" (주 타겟)
- 다운로드/작업 폴더를 매일 분류·정리. 두세 폴더를 오가며 파일을 옮긴다.
- 니즈: 출발·도착 폴더를 나란히 보고 드래그로 즉시 이동, 키보드 단축키, 일괄 선택.
- 통점: 창 여러 개를 띄우고 alt-tab 하는 피로감.

### P2. 개발자 "코드짜는 지현"
- 프로젝트 폴더, 빌드 산출물, 리소스 디렉토리를 동시에 본다. 경로를 자주 복사한다.
- 니즈: 탭으로 자주 쓰는 경로 보관, 즐겨찾기, 경로 텍스트 복사, 숨김/확장자 표시.

### P3. 일반 사용자 "사진 정리하는 영희"
- 사진/문서를 폴더별로 옮기고 미리보기로 확인한다.
- 니즈: 친숙한 UI, 이미지 미리보기, 실수 시 휴지통 복구, 단순함.

---

## 5. 제품 원칙

1. **친숙함 위에 강화**: Windows 탐색기 멘탈모델을 깨지 않고 확장한다.
2. **동시성 우선**: 핵심 화면은 "여러 위치를 동시에"를 항상 전제로 설계한다.
3. **안전한 파괴적 작업**: 삭제는 기본 휴지통 경유, 되돌리기 가능하게.
4. **키보드 일급**: 마우스로 가능한 핵심 동작은 키보드로도 가능하게.
5. **비차단 성능**: 무거운 I/O는 UI를 멈추지 않는다(진행률·취소 제공).

---

## 5-1. 용어 사전 (표준어 — 전 문서 공통)

> 동일 대상은 아래 표준어 하나로만 표기한다. 모든 문서(PRD/features/user-stories/flows)가 이를 따른다.

| 표준어 | 정의 | 쓰지 않는 말(통합 대상) |
|---|---|---|
| **탭** | 창 안에서 위치를 보관·전환하는 단위. 탭마다 독립 레이아웃을 가진다. | — |
| **레이아웃** | 한 탭 안의 패널 배치 형태(단일/2분할/4분할). | 페인 구성 |
| **분할 패널** | 화면을 나눠 둘 이상의 패널을 동시에 두는 것 또는 그 영역. | 다중 페인, 패널 영역 |
| **패널** | 독립된 탐색 뷰 하나(주소 표시줄·목록·정렬·선택 상태 보유). | 페인 |
| **활성 패널** | 현재 포커스를 가진 패널(테두리/헤더로 표시). | — |
| **패널 1~4** | 분할 시 각 패널의 위치 호칭. row-major 순서로 **패널 1=좌상, 패널 2=우상, 패널 3=좌하, 패널 4=우하**(2분할은 패널 1·패널 2만). 화면 위치를 직접 가리킬 땐 "좌상/우상/좌하/우하"를 괄호로 병기 가능. | 좌측/우측 패널, 첫째 패널 |
| **주소 표시줄** | 경로를 브레드크럼/편집 모드로 보여주는 막대. | 주소창, 미니주소 |
| **사이드바** | 좌측 트리·즐겨찾기·최근·드라이브·휴지통 영역. | — |
| **상태바** | 하단의 항목 수·선택 개수/용량·활성 패널 경로 표시줄. | — |
| **미리보기 패널** | 선택 항목의 미리보기를 보여주는 부착형 영역(Should). | 프리뷰 패널 |

---

## 6. 범위와 우선순위 (MoSCoW)

> 상세 동작 규칙은 [features.md](./features.md) 참조. **MVP = Must 전체.**
> 우선순위 표기는 전 문서 공통: **Must / Should / Could / Won't**(축약 시 M/S/C/W).
> **[2026-06-07 상태] Must 전체 구현 완료(MVP). Should는 4분할·미리보기·워크스페이스·텔레메트리·연결 프로그램으로 열기 + 신규 UX 6종(아이콘바·사이드바 토글·분할 크기조절·터미널 열기·경로 직접 입력·파일 유형 아이콘) + 신규 분석·접근성 2종(사용량 대시보드·블루라이트 차단 테마) + 신규 보기·실시간·뷰어·브랜딩 7종(J장) + 되돌리기 Ctrl+Z(K1)·휴지통 관리 화면(K2)·파일 유형별 비중(K3) + 그리드 이미지 썸네일 자체 생성(L1·feat-L1·신규 채널 `preview:thumbnail`) 구현 완료. → **§K·§L 완료 시점(2026-06-07) 기준으로 사용자 기능 Should 잔여(🔜)는 0이었다(충돌 처리 고급 옵션 등 일부만 남음). 2026-06-08 §M(외부 연계) 신규 3기능(M1·M2 Should·M3 Could, US-12.1~12.5)이 기획 편입(🔜)됐다가 같은 날 MP0~MP5로 구현 완료·통합 QA PASS(✅)됨 → **§M 완료 시점(2026-06-08) 기준 사용자 기능 잔여(🔜)는 0이었다(실 동작은 런타임 스모크 권장 🟡).** 같은 날 §N(즐겨찾기 UX 향상) 신규 2건(N1 즐겨찾기 경로 워터마크·N2 즐겨찾기 드래그 정렬, 둘 다 Should, US-13.1~13.2)도 기획 편입(🔜)됐다가 **같은 날 구현 완료·통합 QA PASS(✅)됨 → §N 완료 시점(2026-06-08) 기준 사용자 기능 잔여(🔜)는 0이다**(렌더러 전용·신규 채널 0·키 `Alt+Shift+↑/↓`·실 GUI 동작 런타임 스모크 🟡). 그 외 남은 것은 P7 릴리스 실측·코드서명 등 릴리스 안정화(🟡)와 §M·§N 실 동작 런타임 스모크(🟡)이다.** 체크박스 `[x]` = 구현됨.

### Must (MVP — 1차 릴리스) — ✅ 전체 구현 완료
- [x] 탭 관리(추가/닫기/전환/이동, **탭 복제**, 닫은 탭 복원)
- [x] **2분할 패널**(좌우/상하) + 활성 패널 개념
- [x] **패널 간 드래그&드롭 이동/복사** *(~~단축키 복사(F5)/이동(F6)~~은 2026-06-07 제거됨 — §8·§11 D4 정정. 패널 간 복사/이동은 D&D·클립보드 `Ctrl+C/X/V`로 수행)*
- [x] 파일 목록 보기: 리스트 / 상세(아이콘은 기본 시스템 아이콘)
- [x] 정렬(이름/크기/수정일/형식, 오름/내림)
- [x] 기본 조작: 생성(폴더/파일)·이름변경·삭제(휴지통)·복사·잘라내기·붙여넣기
- [x] **복사/이동 충돌 해결**(덮어쓰기/건너뛰기/둘 다 유지/모두 적용/폴더 병합/읽기전용·사용중 대상 처리)
- [x] 탐색: 주소 표시줄(경로 입력/표시), 뒤로/앞으로/위로, 트리 사이드바
- [x] 즐겨찾기/북마크, 최근 위치
- [x] 현재 디렉토리 내 검색(파일명) + 확장자/이름 필터
- [x] 키보드 단축키 체계(핵심 동작, 8장 단축키 표 참조)
- [x] 다중 선택(Ctrl/Shift/박스) + 일괄 작업  *(박스 선택은 후속, Ctrl/Shift 구현)*
- [x] 대용량 복사/이동 진행률 표시 + 취소  *(200ms 갱신 구현; 1.5초/200ms 실측은 P7)*
- [x] 다크/라이트 테마  *(+시스템 테마)*
- [x] 상태바(선택 개수/용량/현재 항목 수/활성 패널 경로)
- [x] **자동 세션 복원**(정상·비정상 종료 후 마지막 탭/패널 복원)

### Should (1차 직후) — 🟢 대부분 완료 (P6에서 4분할·미리보기·워크스페이스·텔레메트리·연결 프로그램으로 열기 구현 + 신규 UX 6종: 아이콘바·사이드바 토글·분할 크기조절·터미널 열기·경로 직접 입력·파일 유형 아이콘 구현 + 신규 분석·접근성 2종: 사용량 대시보드·블루라이트 차단 테마 구현 + **§K 3종 구현 완료 ✅: 되돌리기 Ctrl+Z(K1)·휴지통 관리 화면(K2)·파일 유형별 비중(K3)** + **§L 1종 구현 완료 ✅: 그리드 이미지 썸네일 자체 생성(L1·US-11.1·신규 채널 `preview:thumbnail`)**). **잔여 Should: 충돌 처리 고급 옵션 정도만 🔜(그리드 보기 5종 J3 ✅ + 이미지 썸네일 L1 ✅로 그리드/썸네일 잔여는 해소).**
- [x] 4분할(2x2) 패널 레이아웃 *(결정 기록 D1)* — P6 ✅
- [x] **그리드 보기 이미지 썸네일 자체 생성** *(2026-06-07 편입·구현 완료 ✅, features §L1·US-11.1)* — **신규 채널 `preview:thumbnail`**·`os/thumbnail.ts`(nativeImage `createFromPath`→비율보존 resize→`toDataURL`·30MB 상한·LRU 256·세마포어 4·실패 비캐싱)·`thumbnailCache.ts`·`domain/image.ts`·`FileListView ThumbnailIcon`. 보기 5종(J3)은 ✅이고, **아이콘 그리드에서 이미지 파일을 OS 형식 아이콘 대신 실제 내용 썸네일로 표시**(대상=png·jpg·jpeg·gif·bmp·ico·webp 등; 미지원/손상/초대용량/null은 **OS 아이콘 `shell:icon`·H6 폴백**, 목록/자세히는 OS 아이콘 유지). **가시 셀만 생성·캐시·비차단**(invoke 비동기·in-flight 디듀프), **data URL 전달(CSP `img-src data:` 호환)·렌더러 직접 파일 접근 없음**(ADR-005). roadmap §0.5 "그리드/썸네일" 잔여의 정식 편입·구현이자 **사실상 마지막 사용자 기능 잔여를 해소**(P7 릴리스 실측·코드서명은 별개 🟡). **신규 의존성 0**(Electron 내장 nativeImage)·`verify:thumbnail` 33. 신규 단축키 불요. **nativeImage 실 디코드·GUI 그리드 렌더는 런타임 스모크 권장.**
- [x] 미리보기 패널(이미지/텍스트/기본 메타) *(결정 기록 D2)* — P6 ✅(`preview:read`)
- [x] **되돌리기(`Ctrl+Z`) — 다단계 undo 스택** *(2026-06-07 편입·구현 완료, features §K1·US-10.1)* — ✅ 완료. 이름변경·새 폴더/파일·이동·복사/붙여넣기 역연산, 삭제(휴지통)는 원위치 복원(K2 `trashApi.restore` 재사용), **영구삭제 되돌릴 수 없음(undo 미push·안내 토스트)**, undo 충돌 시 임의 덮어쓰기 금지·중단(선검증), redo는 후속. `Ctrl+Z` `notYet`→`performUndo` 연결(`undoSlice.ts` cap 50·`undo.ts`). roadmap §0.5 P6 잔여 "되돌리기"의 정식 구현. ※ copy-undo 보수적·undo 역연산 네이티브 동작 런타임 스모크 권장
- [x] **휴지통 관리(복원/비우기) 화면** *(2026-06-07 편입·구현 완료, features §K2·US-10.2)* — ✅ 완료. 사이드바 "휴지통"/아이콘바 진입, 목록(이름·**원래 경로**·삭제일·크기), **선택 복원(원위치)·전체 비우기(확인 모달 후 영구삭제·`confirmed` 게이트)**, 보안(임의 경로 실행 차단·ADR-005·`$Recycle.Bin` 화이트리스트). 신규 채널 `trash:*` 3종·Windows Shell COM `recycleBin.ts`·`TrashDialog.tsx`·verify:recyclebin 37. roadmap §0.5 P6 잔여 "휴지통 관리 화면"의 정식 구현. ※ 휴지통 COM 런타임 스모크 권장
- [x] **파일 유형별 비중 인사이트(대시보드 보강)** *(2026-06-07 편입·구현 완료, features §K3·US-10.3)* — ✅ 완료. I1 Top10 스캔에 **확장자 카테고리별(이미지·동영상·문서·코드·압축·기타) 용량 집계**를 더해 차트+표로 표시(`categorize.ts`·`scanEngine.ts` byCategory 1패스·`CategoryBar.tsx`·verify:scan 39). I1(US-8.1)의 "(가능 시) 유형별 비중" 선택항을 정식화·기존 recharts·`analyze:scan:*` 스캔 재사용(신규 의존성·채널 불요)
- [ ] 충돌 처리 고급 옵션(빠른 필터 칩, 충돌 일괄 규칙 사전 설정 등 확장) — 🔜 미구현
- [x] **외부 프로그램으로 드래그 앤 드롭 복사** *(2026-06-08 편입·구현 완료·QA PASS ✅, features §M1·US-12.1)* — 패널 항목을 앱 바깥(바탕화면·Windows 탐색기·타 앱)으로 드래그하면 그곳에 **복사**(원본 보존). 기존 패널 간 D&D(A3)의 **외부 확장** — 도착지가 내부 패널이면 A3 규칙(이동/복사·수정키), 외부면 복사로 분기. 로컬 파일 항목 대상(원격 M3 항목 제외). **신규 채널 `dnd:start-drag`·`os/dragdrop.ts`(`webContents.startDrag`·경로 정규화/존재/로컬 한정)·`usecases/externalDrag.ts`·`transferRoute.ts`(외부=복사 고정)·신규 의존성 0·`verify:dnd` 29.** ✅ 구현 완료 — **실 외부 앱 드롭·드래그 고스트 아이콘은 런타임 스모크 권장 🟡**
- [x] **복사/붙여넣기 Windows 클립보드 외부 연계(CF_HDROP 양방향)** *(2026-06-08 편입·구현 완료·QA PASS ✅, features §M2·US-12.2)* — 앱 `Ctrl+C/X` → Windows 탐색기에서 `Ctrl+V`(복사/이동), 그 **역방향**(탐색기 복사 → 앱 `Ctrl+V`)이 표준 파일 클립보드 포맷(**CF_HDROP**·Preferred DropEffect)으로 동작. 기존 B4("OS 클립보드 연동")의 **양방향 외부 연계 정식 확정**(앱 내부 B4 동작 불변·외부 계약만 추가). 충돌은 D4 준용·로컬 항목 대상. **신규 채널 `clipboard:write/read/has-files`·`os/shellClipboard.ts`(DROPFILES·Preferred DropEffect 바이트·방어적 파싱)·`usecases/clipboardExternal.ts`(effect=move→cut 부모/대상 새로고침·기존 `op:*` 재사용)·신규 의존성 0·`verify:clipboard-hdrop` 33.** ✅ 구현 완료 — **탐색기 양방향 복사/이동(Move) 실 왕복은 런타임 스모크 권장 🟡**
- [x] **즐겨찾기 경로 워터마크** *(2026-06-08 편입·구현 완료·QA PASS ✅, features §N1·US-13.1)* — 현재 패널이 보고 있는 경로가 **즐겨찾기에 정확히 일치**할 때, 패널 파일 목록 **뒤 배경**에 그 즐겨찾기 이름을 **크고 반투명하게** 깔아 "여긴 즐겨찾기한 곳"임을 시각적으로 알린다. 표시 텍스트는 **J7 즐겨찾기 별칭(`favoriteLabels`) 우선·없으면 경로 basename**(J7 재사용·비파괴). 부분/하위경로 일치는 1차 제외(정직 표기). **본문 텍스트·아이콘 위에 깔리지 않아 가독성·WCAG 대비를 해치지 않게**(워터마크는 목록 z-index 뒤·`pointer-events:none`·`aria-hidden`) 한다. **신규 채널 0·렌더러 전용 — `domain/rules/favoriteWatermark.ts`(정확일치 순수함수)·`FavoriteWatermark.tsx`·`Panel.tsx`·`ui/theme/palette.ts`/`tokens.ts`(4테마 반투명도 토큰)·`verify:domain` 49(워터마크 10케이스)·`verify:contrast` 실패 0.** ✅ 구현 완료 — **실 배경 워터마크 렌더·z-index·4테마 반투명도·긴이름 ellipsis·2/4분할 격리·빈폴더 비중첩은 런타임 스모크 권장 🟡**
- [x] **파일/폴더 상단 고정(pin)** *(2026-06-09 편입·구현 완료, features §O1·US-14.1)* — 파일 목록에서 단일 파일/폴더를 컨텍스트 메뉴 **"상단 고정"** 으로 고정(이미 고정된 항목은 "상단 고정 해제"로 토글). 고정 항목은 **현재 정렬/필터와 무관하게 목록 최상단**(폴더 우선 정렬보다도 위)에 모여 표시되고, 고정 그룹 내부는 현재 정렬 순서를 유지한다. 고정은 **디렉토리(경로) 단위**로 관리되며(같은 경로에서만 그 고정이 보임·원격 SFTP/FTP 경로도 동일) **세션에 영속**(재시작 후 유지)된다. 시각 표식은 **📌**(그리드=셀 좌상단 배지·목록/자세히=이름 앞). **렌더러+세션영속만·신규 IPC 채널 0·신규 의존성 0**(즐겨찾기 별칭 J7·워터마크 N1과 동격의 per-위치 메타 `SidebarSnapshot.pinnedByDir` 재사용·`applyPins`·`verify:domain` 60/`verify:store` 121/`verify:persistence` 101). 신규 단축키 불요(컨텍스트 메뉴). **정직 범위 제외: 고정 항목 간 수동 드래그 재정렬·다중선택 일괄 고정은 1차 범위 밖.** ※ **실 GUI 동작(컨텍스트 메뉴 토글·목록 최상단 📌 렌더·재시작 후 유지)은 런타임 스모크 권장 🟡**
- [x] **자세히 보기 컬럼 헤더 + 너비 드래그 조절** *(2026-06-10 편입·구현 완료(코드)·실 GUI 🟡, features §W1·US-21.1)* — 자세히(details) 보기에 **컬럼 헤더 막대(이름 | 크기 | 유형 | 수정한 날짜)** 를 추가하고, 컬럼 사이 분리자를 **드래그로 너비 조절**(분리자 포커스 시 방향키 리사이즈·컬럼별 최소 너비·**이름 컬럼은 남는 폭을 채워 신축**)한다. 조절한 폭은 **세션에 영속**(전역 설정·재시작 후 유지)된다. 그 전에는 자세히 보기에 헤더가 없고 컬럼 폭이 고정이었다. **렌더러+세션 영속만·신규 IPC 채널 0·신규 npm 의존성 0·`SESSION_SCHEMA_VERSION` 무변경**(`SidebarSnapshot`류와 동일한 하위호환 선택 필드 `SessionSnapshot.ui.detailsColumnWidths`+coerce·`pinnedByDir`/`previewWidth` 선례). **자세히 보기 한정**(그리드/목록 보기는 해당 없음·헤더 클릭 정렬은 1차 범위 밖 — 너비 조절·레이블만). 신규 단축키 불요(분리자 방향키는 분리자 포커스 한정·전역 키 미배정). `domain/rules/columnWidths.ts`(`clampColumnWidth`/`coerceDetailsColumnWidths`·min 48/max 600·기본 크기 90/유형 60/수정일 140)·`app/stores/columnsSlice.ts`·`ui/panel/views/FileListView.tsx`(헤더+분리자 sticky 밴드)·`verify:domain`(컬럼 폭 24케이스). ※ **실 GUI 동작(헤더 렌더·드래그/키보드 리사이즈·재시작 후 폭 유지)은 런타임 스모크 권장 🟡**
- [x] **탭 사용자 지정 이름(custom tab name)** *(2026-06-10 편입·구현 완료(코드)·실 GUI 🟡, features §U4·US-20.4)* — 탭 라벨에 **사용자 지정 이름을 부여**해 자동 제목(현재 폴더명)을 덮어쓴다. 탭 라벨을 **더블클릭하면 인라인 편집**(Enter 확정·Esc 취소·blur 확정·**빈 값이면 자동 제목으로 복귀**)하거나 **탭 우클릭 "이름 바꾸기"** 로 변경하며, 지정한 이름은 **세션에 영속**(재시작 후 유지)된다. 기존 §U3(탭 색상/잠금·탭 분리)와는 별개로 **이름 부여만** 추가하는 항목이다(색상/잠금은 §U3 소관·여기서 다루지 않음·중복 아님). **렌더러+세션 영속만·신규 IPC 채널 0·신규 npm 의존성 0·`SESSION_SCHEMA_VERSION` 무변경**(`Tab.customName?`·`TabSnapshot.customName?` 하위호환 선택 필드+coerce — `pinnedByDir`/`detailsColumnWidths` 선례). `app/stores/tabsSlice.ts`(`setTabName`/`clearTabName`)·`ui/tabbar/TabBar.tsx`(인라인 `TabRenameInput`·우클릭 "이름 바꾸기")·`verify:store`(탭 이름 액션·영속). **이름만**(탭 아이콘 변경은 범위 밖). ※ **실 GUI 동작(라벨 더블클릭 인라인 편집·우클릭 이름 바꾸기·빈 값 자동복귀·재시작 후 유지)은 런타임 스모크 권장 🟡**
- [x] **Windows 셸 컨텍스트 메뉴 연동** *(2026-06-12 편입·구현 완료(코드)·통합 QA PASS·실 GUI/실 패키지 🟡, features §Y1·US-23.1)* — 파일/폴더 우클릭 시 앱 React 컨텍스트 메뉴(B6) 하단에 **"Windows 메뉴" 섹션**을 추가해, Windows에 설치된 프로그램들이 등록한 셸 컨텍스트 메뉴 항목(예: "반디집으로 압축하기"·"Cursor로 열기"·"AGT-Finder로 열기")을 노출하고 선택 시 실행한다. **기술 방식(사용자 확정): Windows 셸 COM `Shell.Application`의 `FolderItem.Verbs()` 열거 + `verb.DoIt()` 실행**(네이티브 N-API 애드온 비채택·신규 네이티브 의존성 0)·메인 프로세스 **상주 PowerShell 워커**(기존 hash/archive 워커 패턴)로 COM 호출(우클릭 지연 완화). 신규 IPC 채널 2종 예상(verb 조회·verb 실행 — 정확한 채널명/프로토콜은 chief-architect 설계 단계 확정·기획은 행동 계약 수준만). **정직 한계(수용기준에 반영): ① 캐스케이드 서브메뉴 평탄화/누락 가능(보이는 것만 best-effort)·② 다중 선택 시 단일 항목 기준 → 1차 단일 선택 한정 노출(다중 선택 시 섹션 숨김)·③ 앱 자체 구현 중복 verb(open/cut/copy/paste/delete/rename/properties 등) canonical name 블랙리스트 필터·④ verb 실행 fire-and-forget(성공/실패 미추적)·⑤ 워커 첫 기동/조회 지연 시 로딩 상태 허용.** **비범위(Non-goal): 네이티브 메뉴 팝업·서브메뉴 완전 재현·다중 선택 일괄 invoke.** 컨텍스트 메뉴 인프라(B6, Must)·ADR-005 보안 모델 확장. 신규 단축키 불요(우클릭 메뉴 내 섹션). **2026-06-12 T1~T6 구현 완료·통합 QA PASS([roadmap §0.5 2026-06-12 §Y 단락](.\roadmap.md)·신규 채널 `shell:context-verbs`/`shell:invoke-verb`·신규 의존성 0·`verify:shellverbs` 75/0·build PASS) → 구현 완료(코드). 실 GUI(우클릭 섹션 표출·verb 클릭 실행)·실 패키지 설치본은 런타임 스모크 권장 🟡(✅ 위장 아님)**
- [x] **좌측 사이드바 "빠른 위치"** *(2026-06-10 편입·2026-06-28 동작 확장·구현 완료(코드)·실 GUI 🟡, features §X1·US-22.1)* — 사이드바에 **"빠른 위치"** 섹션을 추가하고 그 안의 **다운로드·바탕화면·문서·사진** 노드를 클릭하면 활성 패널이 해당 **OS 시스템 폴더**로 이동한다. 즐겨찾기·최근·드라이브와 동격의 사이드바 진입점으로, 자주 쓰는 시스템 폴더에 한 번에 닿게 한다. **신규 채널 `fs:known-folders`**(무인자 invoke → `KnownFoldersDTO { downloads, desktop, documents, pictures, home }`을 `app.getPath`로 반환 — P1 동결 후 신기능 신규 채널, 기존 `preview:read`/`analyze:scan:*`/`hash:*` 선례와 동일 invoke·guard/Result 규약)·**신규 npm 의존성 0**. `fs.handlers.ts`(핸들러)·`app/stores/sidebarSlice.ts`(`knownFolders`·`loadKnownFolders`)·`ui/sidebar/Sidebar.tsx`("빠른 위치" 섹션). (2026-06-28 동작 확장: 노출 노드 다운로드 단독 → **다운로드·바탕화면·문서·사진 4개**·각 경로 조회 실패 시 해당 행만 비표시·`home`은 DTO로 함께 가져오나 미표시·예약·**MoSCoW 분류 Should 무변경**·신규 채널/의존성 0). 노드 클릭 **이동만**(추가/제거·재정렬·고정은 범위 밖). ※ **실 GUI 동작(섹션 렌더·4개 노드 클릭 이동·실 `app.getPath` 경로)은 런타임 스모크 권장 🟡**
- [x] **즐겨찾기 드래그 정렬** *(2026-06-08 편입·구현 완료·QA PASS ✅, features §N2·US-13.2)* — 사이드바 즐겨찾기 섹션 내 항목을 **드래그로 순서 변경**하고 그 순서를 **세션/사이드바 스냅샷(`SidebarSnapshot.favorites` 배열 순서)에 영속**한다(재시작 후 유지). 드래그 중 시각 피드백(삽입 위치 인디케이터·드래그 항목 강조), **키보드 대체 수단 `Alt+Shift+↑/↓`**(접근성·사이드바 즐겨찾기 포커스 한정·전역 미배정·충돌 0) 제공, 다른 사이드바 섹션(트리·드라이브·휴지통·최근)과 **격리**(즐겨찾기 항목만 정렬·타 섹션 위로 드롭 무효). 기존 즐겨찾기 추가/제거·J7 별칭 동작 불변. **신규 채널 0·DTO 변경 0·렌더러 전용 — `useFavoriteReorder.ts`·`sidebarSlice.reorderFavorite`·`Sidebar.tsx`·`verify:store` 107(reorder·영속 11케이스)·`verify:persistence` 94(`SESSION_SCHEMA_VERSION`·`coerceSidebar` 무변경).** ✅ 구현 완료 — **실 마우스 드래그(DropLine·강조)·`Alt+Shift+↑/↓` 키 이동·ARIA 발화·재시작 후 순서 유지(한국어 IME `Alt+Shift` 점유 가능성 낮음)는 런타임 스모크 권장 🟡**
- [x] **듀얼 패널 폴더 비교·동기화** *(2026-06-09 편입·M6 메타·단일깊이 + M7 해시·재귀 확장 구현 완료(코드)·통합 검증 PASS ✅ / 실 GUI·실 워커 🟡, features §P1·US-15.1)* — 좌/우 2패널 폴더 diff(이름+크기+수정일·해시 옵션)·4상태 강조(좌만/우만/다름/같음)·동기 스크롤·차이만 보기·좌→우/우→좌 미러(**변경 미리보기·확정 전 무변경·휴지통 경유 삭제·기본 off**). 충돌 D4·진행률/취소 US-5.2·수행작업 K1 누적. 해시/대용량 비교 워커 비차단·취소. 강력 차별화 핵심. 1차 제외: 4분할 동시·실시간 자동·원격↔로컬. **구현(M6): `domain/rules/compare.ts`(4상태·`planMirror`)·`compareSlice`·`usecases/compare`·`ui/compare/`·`CompareStatus` DTO·미러=기존 `op:*`·신규 채널 0(메타·단일깊이). 확장(M7): `ComparePairDTO.relPath?`·`CompareOptions useHash/recursive`·`fromCompareResult`·`compareSlice` 해시잡 상태·`usecases/compare`(`hash:compare:*` 구독·옵션 off는 M6 메타 동치)·CompareToolbar/CompareView 토글·진행률·재귀 표시·`main/hash/compareEngine.ts`·신규 채널 `hash:compare:*`·`verify:hash` 46. 실 GUI 진입/미러/동기 스크롤·실 해시 워커 비교는 런타임 스모크 권장 🟡**
- [x] **압축파일 폴더처럼 열기** *(2026-06-09 편입·M9 구현 완료(코드)·통합 검증 PASS ✅ / 실 GUI·실 워커 🟡, features §Q1·US-16.1)* — zip 더블클릭/우클릭 "폴더처럼 열기"로 **내부를 디렉토리처럼 탐색·추출·추가**(`archive://` 어댑터 설계 힌트는 M3 RemoteAdapter 패턴). **Zip Slip(상위 경로 이탈) 차단** 필수. 강력 차별화. 1차 제외: 암호 zip·7z/rar/tar.gz 등 zip 외 포맷·중첩 압축 재귀·압축 내부 이름변경/삭제·원격 압축. **구현(M9): backend `src/main/archive/*`(`ArchiveService`·`ZipReader`(yauzl)·`ZipWriter`(yazl)·`ArchiveSessionManager`·`archiveProtocol`·`archiveErrors`)·`src/main/workers/archiveWorker.ts`·`src/shared/archive/{safePath,archivePath}.ts`(Zip Slip 순수)·`renderer/app/usecases/archive.ts`·신규 채널 `archive:open/list/close/extract/add` 5종·신규 의존성 `yauzl`+`yazl`(MIT·네이티브 0)·추출/추가 진행률=기존 `op:*` 재사용·ADR-008·`verify:archive` 56·`verify:archiveui` 43. 1차 zip만·암호 zip 제외(EUNSUPPORTED)·중첩 zip 제외. 실 zip 열기/추출/추가 IPC 왕복·진행률은 런타임 스모크 권장 🟡**
- [x] **고급 일괄 이름변경** *(2026-06-09 편입·M6 1차 구현 완료(코드)·통합 검증 PASS ✅ / 실 GUI 🟡, features §R1·US-17.1)* — 패턴/정규식/연번/대소문자 변환 조합 + **실시간 미리보기** + **충돌 검사**(서로/기존 충돌 시 차단)·일괄 `Ctrl+Z` 되돌리기(K1). 1차 제외: 미디어 메타기반 명명·이름변경 규칙 프리셋. **구현(M6): `domain/rules/batchRename.ts`·`usecases/batchRename`·`ui/rename/BatchRenameDialog`·`undoSlice kind:'batchRename'`·`undo.ts` 역연산·`Ctrl+Shift+R`·기존 `fs:rename` 반복·신규 채널 0. 실 파일 왕복·Ctrl+Z 실복원은 런타임 스모크 권장 🟡**
- [x] **중복 파일 찾기** *(2026-06-09 편입·M7 구현 완료(코드)·통합 검증 PASS ✅ / 실 GUI·실 워커 🟡, features §R2·US-17.2)* — 범위(폴더/드라이브/패널) 지정·**크기 그룹핑→해시 비교 2단계**·중복 그룹 표시·"원본 1개 남기고 정리"·휴지통 삭제·K1 연계·워커 비차단/취소. 1차 제외: 유사 이미지·무확인 자동 정리·원격. **구현(M7): `domain/rules/dupGroup.ts`·`dedupSlice`·`usecases/dedup.ts`·`ui/dedup/DuplicatesDialog.tsx`·`main/hash/dupEngine.ts`(크기 그룹핑→SHA-256·Worker)·신규 채널 `hash:dup:*`·`hash:cancel`·정리=기존 `op:trash` 재사용(확인 모달·휴지통·undo)·`verify:hash` 46. 실 워커 해시 잡·실 GUI 중복 정리는 런타임 스모크 권장 🟡**
- [x] **전송 큐 매니저** *(2026-06-09 편입·M7 구현 완료(코드)·통합 검증 PASS ✅ / 실 GUI·실 스케줄러 🟡, features §R3·US-17.3)* — 로컬 복사/이동·원격(M3) 업/다운로드를 **단일 큐**로(기존 `op:*`/`remote:*` 통합)·진행률/속도·일시정지/재개·취소·동시성 설정·실패 재시도·UI 비차단. 1차 제외: 드래그 재정렬·대역폭 제한·종료 후 큐 영속·청크 이어받기. **구현(M7): `main/operations/TransferQueue.ts`·`OperationManager` 큐 승격(비파괴·기본 무한동시성=단발 동치)·`usecases/queue.ts`·`ui/queue/(QueuePanel·QueueItemRow·QueueConcurrencyControl)`·StatusBar 합산 인디케이터·신규 채널 `queue:*`(list/pause/resume/retry/set-concurrency·queue:state 푸시)·SharedArrayBuffer 2워드(cancel 불변+pause 신규)·`verify:queue` 47. 실 스케줄러 일시정지/재개·실 GUI 큐 패널은 런타임 스모크 권장 🟡(원격 큐 일시정지 미배선 정직 표기)**
- [x] **내용 검색(grep)** *(2026-06-09 편입·M8 구현 완료(코드)·통합 검증 PASS ✅ / 실 워커·GUI 🟡, features §S1·US-18.1)* — 파일 **내부 텍스트** 검색(현재는 이름 필터만)·현재 폴더(+하위 토글)·정규식 옵션·**바이너리 제외·크기 상한**·라인 결과 목록·미리보기 점프·워커 비차단/취소. 1차 제외: 전 디스크 풀텍스트 인덱싱(Won't 유지)·결과 직접 일괄 치환·원격 내용 검색. **구현(M8): `main/search/{grepEngine,binaryDetect,GrepManager,fsDeps}`·`main/workers/grep{Worker,Protocol}`·`search.handlers.ts`·`usecases/contentSearch`·`searchSlice`·`ui/search/ContentSearchDialog`·`domain/rules/contentSearch`·신규 채널 `search:content:*` 5종·신규 의존성 0(Node 내장)·점프=기존 `preview:read`·ADR-010·`verify:search` 58·`verify:contentsearch` 38. 실 grep 워커 스트리밍·결과 점프·미리보기 표출은 런타임 스모크 권장 🟡**
- [x] **명령 팔레트(`Ctrl+Shift+P`)** *(2026-06-09 편입·M8 구현 완료(코드)·통합 검증 PASS ✅ / 실 GUI 🟡, features §S2·US-18.2)* — 모든 명령·즐겨찾기·최근·드라이브를 한 입력창에서 통합 검색·실행·점프(키보드/아이콘바와 **동일 commandId 수렴**)·신규 단축키 `Ctrl+Shift+P`(미배정·충돌 없음). 1차 제외: 내용검색 통합·사용자 매크로·플러그인 명령. **구현(M8): `ui/palette/CommandPalette`·`domain/rules/paletteMatch`·uiSlice `paletteOpen`·commandBus `palette.open`·신규 채널 0·`verify:palette` 20. 실 팔레트 열림/검색/실행은 런타임 스모크 권장 🟡**
- [x] **파일 태그/색상 라벨** *(2026-06-09 편입·M8 구현 완료(코드)·통합 검증 PASS ✅ / 실 GUI 🟡, features §T1·US-19.1)* — 파일/폴더에 색 태그 부여·태그 필터·per-경로 메타 세션 영속(J7 별칭·O1 고정과 동격 패턴)·**앱 내부 메타(파일 자체·ADS 미변경·데이터 비파괴)**. 1차 제외: 사용자 정의 태그명/색·OS/ADS 연동·전 디스크 태그 검색·동기화. **구현(M8): `domain/rules/tags.ts`(7색 팔레트·순수 `matchesTags`)·`tagsSlice`·contextMenu "태그"·SearchBar 태그칩·FileListView 태그 점·`computeVisible` 이름+태그 합성·세션 메타 `tagsByPath`+coerce·`SESSION_SCHEMA_VERSION` 무변경·신규 채널 0(T3 폐기로 삭제됐던 filterComposition 태그 합성을 T1에서 재설계). 실 태그 부여·필터는 런타임 스모크 권장 🟡**
- [x] **상세 보기 폴더 용량 인라인** *(2026-06-09 편입·M8 구현 완료(코드)·통합 검증 PASS ✅ / 실 GUI 🟡, features §T2·US-19.2)* — 자세히 보기 폴더 행 **온디맨드** 크기 계산·인라인 표시·취소 가능·비차단(I1 `scanEngine` 권한skip/순환차단 재사용)·기본 off. 1차 제외: 전 폴더 자동 일괄·결과 영속 캐시·그리드/목록 표시·실시간 갱신. **구현(M8): `usecases/folderSize`(지연·캐시·디듀프·`analyze:scan:*` 재사용)·FileListView details·신규 채널 0. 실 폴더 용량 스캔은 런타임 스모크 권장 🟡**
- [ ] ~~**정렬/필터 프리셋 저장** *(Should)*~~ — **폐기(2026-06-09 사용자 결정·코드 전면 제거).** ~~정렬+필터 조합을 이름 붙여 저장·적용·이름변경/삭제·세션 영속(features §T3·US-19.3).~~ M6에서 구현 완료(코드)됐으나 2026-06-09 사용자 결정으로 폐기되어 코드 전면 제거(`domain/rules/filterComposition.ts`·`presetsSlice`·`usecases/presets`·`ui/preset/*`·`FilterPreset` DTO 삭제·`computeVisible`→`filterEntries` 환원·`SESSION_SCHEMA_VERSION` 2→1 환원). MoSCoW 등급(Should)은 기록 보존하되 상태는 폐기. 상세: roadmap §0.5 T3 폐기 단락.
- [x] **Space 퀵룩 오버레이** *(2026-06-09 편입·M8 구현 완료(코드)·통합 검증 PASS ✅ / 실 GUI 🟡, features §U1·US-20.1)* — `Space`로 선택 항목 큰 미리보기 오버레이(이미지/텍스트/코드/마크다운/메타·항목 간 이동·D3/J5 안전 모델 재사용·비차단). 1차 제외: 동영상/오디오 재생·PDF 다중 페이지·오버레이 편집·다중 동시 미리보기. **구현(M8): `ui/quicklook/QuickLookOverlay`(J5 프리뷰 뷰어 재사용)·keybindings `Space`(list 컨텍스트 한정·입력/오버레이 억제)·uiSlice·신규 채널 0·`preview:read` 재사용(CSP/DOMPurify 보존). 실 Space 퀵룩은 런타임 스모크 권장 🟡**
- [x] **브레드크럼 드롭다운** *(2026-06-09 편입·M8 구현 완료(코드)·통합 검증 PASS ✅ / 실 GUI 🟡, features §U2·US-20.2)* — 주소 표시줄 각 세그먼트에서 **형제 폴더 드롭다운** 이동·키보드 내비·온디맨드 비동기 로드. 1차 제외: 다단계 트리 펼침·파일 표시·즐겨찾기/최근 혼합. **구현(M8): `ui/toolbar/BreadcrumbDropdown`·`domain/rules/breadcrumbSiblings`·`usecases/breadcrumbDropdown`·PanelToolbar 배선·신규 채널 0·`fs:tree-children` 재사용·원격 경로 ▾ 비표시. 실 브레드크럼 ▾ 이동은 런타임 스모크 권장 🟡**
- [x] **명시적 워크스페이스 저장·복원**(이름 붙여 저장/불러오기) *(결정 기록 D3)* — P6 ✅
- [x] 연결 프로그램 선택(`shell:open-with`, B6) — P6 ✅(`os/shell.ts#openWith`·OpenAs_RunDLL·컨텍스트 메뉴 "연결 프로그램으로 열기")
- [x] 텔레메트리 옵트인(기본 꺼짐, 외부 전송 전무) *(결정 기록 D5, §7 보안)* — P6 ✅
- [x] **상단 전역 아이콘바(툴바)** *(2026-06-07 편입, features §H1·US-7.1)* — P6 후 ✅. 탭바 아래 4그룹(레이아웃/뷰·파일 작업·탐색·도구) 아이콘 버튼, 활성 패널 기준·키보드와 동일 commandId 수렴, 컨텍스트 비활성 시 흐림(`ui/toolbar/IconBar.tsx`)
- [x] **사이드바 온오프 토글** *(2026-06-07 편입, features §H2·US-7.2)* — ✅. `Ctrl+B`·아이콘바 버튼으로 사이드바 표시/숨김, 상태 세션 영속(기존 `sidebarCollapsed`·`toggleSidebar` 진입점 제공). ※ 실제 토글은 런타임 스모크 권장
- [x] **분할 패널 크기 조절(분할선 드래그)** *(2026-06-07 편입, features §H3·US-7.3)* — ✅. 2분할 1축/4분할 2축 비율 조절, 최소 크기 제약·더블클릭 균등 복귀·**비율 세션 영속**(`SplitDivider`·`splitRatios`). ※ 실제 드래그는 런타임 스모크 권장
- [x] **우클릭 "터미널 열기" / "터미널 열기(Claude)"** *(2026-06-07 편입·구현 완료, 2026-06-28 동작 확장, features §H4·US-7.4)* — 폴더(또는 패널 빈 영역=현재 경로)를 작업 디렉토리로 터미널 실행. **Windows Terminal(`wt.exe -d`) 우선·없으면 `powershell.exe -NoExit` 폴백**. (2026-06-28) "터미널 열기" 바로 아래 **"터미널 열기(Claude)"** 항목 추가 — 셸 기동 직후 `claude`(Claude Code CLI) 자동 실행(`shell:open-terminal` 옵셔널 `launch:'claude'` 고정 리터럴·임의 명령 미허용·PATH에 claude 미설치 시 셸은 열리되 "claude 없음" 오류). 검증된 경로만 실행(신규 채널 `shell:open-terminal`·`os/shell.ts#openTerminal`·`execFile` 인자 배열·stat 디렉토리 검증·ADR-005). 신규 단축키 불요(컨텍스트 메뉴)·신규 채널/의존성 0. ※ 네이티브 `wt.exe`/`claude` 실제 실행은 런타임 스모크 권장 🟡
- [x] **디렉토리 경로 직접 입력** *(2026-06-07 편입·구현 완료, features §H5·US-7.5)* — ✅. 주소 표시줄 **단일 클릭 시 전체 경로 편집 모드** 진입(`PanelToolbar.tsx`·`closest('button')` 가드, 기존 `Ctrl+L`·더블클릭 유지). Enter=이동·Esc=취소·잘못된 경로 인라인 오류(`validateAndNavigate` 재사용). 신규 단축키 불요. **(2026-06-09 동작 보강·refinement) 원격(SFTP/FTP·§M3) 패널에서는 호스트(`sftp://host`)가 고정 프리픽스로 표시되고 사용자는 경로만(`/mnt/sub`) 입력하면 현재 호스트와 결합해 이동한다(전체 URI 입력 강요 없음·방어적으로 전체 URI도 처리·로컬 경로 입력 동작 불변·`verify:remote-route` 47·실 GUI 런타임 스모크 🟡)**
- [x] **파일 유형별 아이콘** *(2026-06-07 편입·구현 완료, features §H6·US-7.6)* — ✅. 목록 항목을 **OS 실제 파일 아이콘**으로 표시(P1 동결된 `shell:icon` 채널 정식 구현·`os/icon.ts`·`OSIcon`). 폴더/드라이브 아이콘·미해석 폴백(실패 비캐싱), **확장자 단위 캐시 LRU512**·가상 스크롤 `iconRef` 지연(1만 개 목록 첫 렌더 비차단). ※ 네이티브 `app.getFileIcon` 실제 실행은 런타임 스모크 권장
- [x] **디렉토리 사용량 대시보드** *(2026-06-07 편입·구현 완료, features §I1·US-8.1)* — ✅. 모달 대시보드로 **드라이브별 총/사용/여유 용량을 즉시(도넛 차트+표)** 표시하고(기존 `DriveDTO`+`diskSpace()` 재사용), **선택 폴더/드라이브의 용량 Top10을 온디맨드 스캔(막대 차트+표, 진행률·취소·UI 비차단)** — **신규 채널 `analyze:scan:*` 5종**·`scanEngine.ts`(재귀 집계·Top10 힙·순환 realpath Set 차단·skipped·취소·truncated)·`scanWorker.ts`·`ScanManager`. 여유 %·최대 폴더 인사이트 제공. 진입점=아이콘바 ④도구 그룹 아이콘 + **실행 시 자동 팝업**(`uiSlice.showDashboardOnStartup` 기본 켜짐). 차트=**recharts 3.8.1(MIT)·831kB lazy 청크**. 신규 단축키 불요. ※ **(가능 시) 파일 유형별 비중 인사이트는 선택항으로 미구현 🔜·네이티브 statfs/대용량 스캔 성능 실측은 런타임 스모크 권장**
- [x] **블루라이트(청색광) 차단 테마** *(2026-06-07 편입·구현 완료, features §I2·US-8.2)* — ✅. 기존 라이트/다크/시스템에 더해 **#FBF0D9(따뜻한 크림색) 배경의 저청색광 테마**를 4번째 선택지로 추가(E2·US-5.3 확장·`BLUELIGHT_PALETTE`·`ThemeMode` 4종). 즉시 적용·설정 영속(`THEME_MODES` 화이트리스트), 본문 텍스트 **WCAG AA(4.5:1) 통과(본문 11.04:1·muted 5.25:1)**. 기존 테마 동작 무변경(`toggleThemeMode`는 light↔dark 유지). 새 단축키·새 채널 불요

> **[2026-06-07 편입·구현 완료 ✅ — features §J·user-stories 에픽9]** 아래 6건은 team-dev 구현·QA PASS. 우선순위 근거는 §6 하단 "MoSCoW 분류 근거(2026-06-07)" 참조. (브랜딩 J4는 릴리스 요건이라 아래 "릴리스 요건"에 둠.)
- [x] **패널 실시간 갱신(파일시스템 워처)** ✅ *(features §J2·US-9.2)* — **Should 상위**. 신규 채널 `fs:watch:*`·`WatchService.ts`(non-recursive·디바운스·격리 + **UNC + 매핑 네트워크 드라이브 eager 폴링·reactive fs.watch error 폴백**)·`os/driveType.ts`(`GetDriveType` 연동)·`watchBridge.ts`·`panelsSlice`(`softRefresh`/선택·스크롤 보존). **정렬/필터 유지·디바운스·대량 폴백·권한/삭제 예외 정리·경로 교체 누수 없음·선택/스크롤 보존·UNC + 매핑 네트워크 드라이브 폴링 폴백 모두 충족 ✅**(보류 2건 구현 완료 + 매핑 드라이브 `GetDriveType` 연동 완료, 🟡→✅). 매핑 네트워크 드라이브(`X:\`)는 `os/driveType.ts`(PowerShell CIM `Win32_LogicalDisk DriveType=4`·`paths.isNetworkDriveRoot`)로 eager 폴링 적용. **잔여 한계(정직 표기): `subst`·일부 클라우드 드라이브(`DriveType≠4`)는 미포함 → reactive 폴백 유지.**
- [x] **드래그 박스 선택(러버밴드)** ✅ *(features §J1·US-9.1)* — Should. `boxSelect.ts`·`selectionSlice.boxSelect`·`FileListView`(러버밴드·자동 스크롤·가상 스크롤 정합). roadmap P2의 후속 박스 선택을 정식화. ※ 실제 드래그는 런타임 스모크 권장
- [x] **Windows 표준 보기 5종(큰/보통/작은 아이콘·목록·자세히)** ✅ *(features §J3·US-9.3)* — Should. `ViewMode` 5종(icons-large/medium/small/list/details)·`FileListView` 그리드(H6 `shell:icon`/`OSIcon` 재사용·가상 스크롤)·`PanelToolbar` 드롭다운·패널별 기억. 기존 "그리드/썸네일 보기"를 Windows 표준 세트로 구체화·완료
- [x] **미리보기 2단 확장 뷰어** ✅ *(features §J5·US-9.5)* — Should. 상단 정보(`PreviewInfoCard`) + 하단 뷰어(이미지·텍스트·코드 구문 강조(highlight.js)·마크다운(marked+DOMPurify), 미지원 폴백). D3 `preview:read`·`Ctrl+P` 재사용·신규 라이브러리 lazy 청크·마크다운 DOMPurify 새니타이즈
- [x] **미리보기 패널 폭 조절** ✅ *(features §J6·US-9.6)* — Should. 분할선 드래그로 미리보기 폭 조절·세션 영속(H3 `SplitDivider`·`ui.previewWidth` 재사용)
- [x] **즐겨찾기 별칭(표시 이름) 변경** ✅ *(features §J7·US-9.7)* — Should. 즐겨찾기 표시 이름 별칭 지정·영속(`SidebarSnapshot.favoriteLabels`·`Sidebar` 인라인 편집·경로 불변·basename 폴백)
- [x] **드라이브 연결/해제(토폴로지 변경) 자동 갱신** 🟡 *(2026-06-30 정식 편입·features §J8·US-9.8)* — Should. USB 등 이동식/네트워크 드라이브 연결·해제(`WM_DEVICECHANGE`) 감지 → 사이드바 트리·"내 PC" 패널·대시보드 디스크 사용량 자동 재열거(1.2초 디바운스·`loadDrives` 병합으로 펼침 상태 보존). **J2(디렉토리 내부 파일 워처)와 인접하나 별개**(드라이브 마운트/언마운트). 신규 푸시 evt `fs:drives-changed` 1종·신규 invoke 채널 0·신규 npm/네이티브 의존성 0(Windows 내장 `BrowserWindow.hookWindowMessage`)·`SESSION_SCHEMA_VERSION` 무변·`os/deviceChange.ts`·`usecases/drivesBridge.ts`. **구현 완료(코드)·`verify:store` 296/0·`verify:persistence` 147/0·build PASS / 실 USB 물리 연결·해제→실 GUI 자동 갱신은 런타임 스모크 권장 🟡**(✅ 위장 아님). 비계획 구현(roadmap §0.5 "⚠️ 스코프 일탈" 플래그)을 사용자 정식 편입 결정으로 본 항목 추가.
- [x] **새 창(현재 위치 복제) `Ctrl+N`** 🟡 *(2026-07-14 정식 편입·features §U5·US-20.5)* — Should. Windows 탐색기 관례 `Ctrl+N` → **현재 위치(활성 탭)를 그대로 가진 창을 하나 더 연다(복제)**. **§U3 "탭 분리(새 창)"(탭을 옮김·소스 탭 제거)와 달리 소스 탭을 닫지 않는다**(별개 동작). 명령 팔레트·단축키 도움말 자동 노출(KEYBINDINGS 단일 출처)·텍스트 입력 컨텍스트 미발화·`Ctrl+Shift+N`(새 폴더)과 충돌 0. **렌더러 전용(main 무변경)·신규 IPC 채널 0(기존 `window:split-tab` 재사용)·신규 npm 의존성 0·`SESSION_SCHEMA_VERSION` 무변**(`domain/keybindings`·`commandBus#window.new`·`usecases/windowSplit.ts#openEmptyWindow`). **구현 완료(코드)·v1.15.0 게시·typecheck/ESLint 0·`verify:palette` 20/0·`verify:domain` 215/0·`verify:store` 296/0 / 실 GUI(실제 `Ctrl+N` → 새 창 표출) 런타임 스모크 권장 🟡**(✅ 위장 아님). **정직 한계: 새 창은 primary=false → 세션 자동저장 미참여 → 재시작 시 복원되지 않음**(§U3 windowManager 한계 승계·의도적 MVP). 비계획 구현(roadmap §0.5 "⚠️ 스코프 일탈" 플래그)을 사용자 정식 편입 결정으로 본 항목 추가.

### Could (이후)
- [x] **FTP/SFTP 원격 접속** *(2026-06-08 편입·구현 완료·QA PASS ✅, features §M3·US-12.3~12.5)* — 원격 서버(FTP/FTPS/SFTP)에 접속해 원격 파일을 **탐색·업로드·다운로드**. 원격 위치를 패널 하나로 열어 로컬/다른 원격과 나란히(멀티 디렉토리 차별점을 원격까지 확장). **PRD §6 Won't "FTP/SSH 등 원격 프로토콜 브라우징"을 사용자 결정으로 정정·편입한 항목**(결정 D6). **자격증명=OS 자격증명 보관소(safeStorage/DPAPI)에만 저장·평문 금지**(미가용 시 EUNSUPPORTED 거부·평문 폴백 금지·비밀 DTO/로그/Error 배제). "로컬 전용·외부 네트워크 전송 없음(D5)" 보안 원칙을 **부분 개정**(D7 — 사용자가 명시 입력한 원격 호스트로만 연결 허용·임의 송신 금지 유지·네트워크 import `src/main/remote/` ESLint 화이트리스트). 연결 끊김·타임아웃·인증 실패·호스트 키 경고는 패널 단위 격리(세션 격리). **신규 채널 `remote:*`·`remote/{RemoteService,SftpAdapter,FtpAdapter,RemoteSessionManager,remoteTransfer}.ts`·`os/credentials.ts`·`RemoteProfileStore.ts`·`ui/remote/{RemoteDialog,HostKeyModal}.tsx`·호스트키 TOFU·.part 원자 rename·Zip Slip 차단·평문 FTP 경고·신규 의존성 `ssh2-sftp-client`/`basic-ftp`(M3만)·`verify:credentials` 17·`verify:remote` 23·`verify:remote-trust` 35·`verify:remote-route` 47·`verify:eslint-remote` 29.** ✅ 구현 완료 — **실 SFTP/FTP/FTPS 핸드셰이크·호스트키 모달·실 DPAPI 암복호·실 전송 진행률/취소/충돌·타임아웃/끊김 세션격리·평문 FTP 경고는 런타임 스모크 권장 🟡**. deferral 정직: resume/체크섬·원격↔원격·Cred Manager UI는 1차 범위 밖(ADR-007 미해결질문). **(2026-06-09 UX 보강·refinement) 원격 패널 주소 표시줄은 호스트(`sftp://host`)를 고정 프리픽스로 표시하고 경로만(`/mnt/sub`) 입력받아 현재 호스트와 결합 이동(전체 URI 강요 없음·H5×M3 교차·features §M3·US-12.4·실 GUI 런타임 스모크 🟡)** **(2026-06-14 동작 확장 정식 편입·Could 무변경) ① 연결 직후 서버 작업 디렉토리(FTP `pwd`·SFTP `cwd`·보통 홈) 진입(미보고 시 `/` 폴백·`RemoteConnectRes.initialPath?`·US-12.3) · ② 폴더(디렉토리) 재귀 업로드(부모→자식 원격 디렉토리 생성+파일 개별 업로드·이전엔 폴더 누락·US-12.5) · ③ 업로드 충돌 정책 `ConflictPolicy` 배선(다운로드와 동일 overwrite/skip/rename·계약 기존·미배선→배선·US-12.5) — 셋 다 기존 `remote:connect`/`remote:upload` 비파괴 확장·신규 채널 0·`verify:remote` 36·실 동작 런타임 스모크 🟡(상태 단일 출처 roadmap §0.5 2026-06-14 단락)**
- [x] **복사 시 체크섬 검증** *(2026-06-09 편입·M7 구현 완료(코드)·통합 검증 PASS ✅ / 실 검증 타이밍 🟡, features §R4·US-17.4)* — 복사 후 원본·사본 해시 비교로 무결성 검증(**옵션·기본 off**)·불일치 경고·결과 요약·워커 비차단/취소. Could(안전 옵션·빈도 낮음). 1차 제외: 강제 항상 검증·자동 재복사·원격 전송 체크섬(ADR-007 deferral 연계)·알고리즘 선택 UI. **구현(M7): `domain/rules/checksumVerdict.ts`·`usecases/checksum.ts`·`SettingsSnapshot.verifyOnCopy`(기본 false·`defaults.ts` coerce)·SettingsDialog 토글·`operationsBridge` op:done 후 `hash:verify` 트리거·`main/hash/verifyEngine.ts`/`hashEngine.ts`(원본/사본 스트리밍 SHA-256)·신규 채널 `hash:verify:*`·`verify:hash` 46. 실 복사후 검증 트리거 타이밍(비원자 복사 검증)·실 GUI는 런타임 스모크 권장 🟡**
- [x] **탭 색상/잠금(닫기 방지·루트 잠금)·탭을 새 창으로** *(2026-06-09 편입·M9 구현 완료(코드)·통합 검증 PASS ✅ / 실 GUI·멀티윈도우 🟡, features §U3·US-20.3)* — 탭 색상 지정·탭 잠금(닫기 방지)·**탭 분리(새 창)**·색상/잠금 세션 영속. Could(멀티 윈도우 복잡도). 1차 제외: 창 간 탭 드래그 이동·창별 워크스페이스·탭 그룹화. **구현(M9): 색상/잠금=세션 메타(`Tab.color?`/`Tab.locked?`·`TabSnapshot.color?`/`locked?`·신규 채널 0·닫기 가드)·탭 분리=멀티 윈도우(`src/main/windows/windowManager.ts`·`renderer/app/usecases/windowSplit.ts`·신규 채널 `window:split-tab`/`window:get-init` 2종)·신규 의존성 0·`verify:store`/`verify:persistence`. 정직 한계: 멀티 윈도우 세션 복원은 주 창만(분리 창은 reopen-only·재시작 복원 안 함·의도적 MVP). 실 멀티 윈도우 분리/이동·탭 색상/잠금 GUI는 런타임 스모크 권장 🟡** **(2026-06-14 동작 확장 정식 편입·Could 무변경) 탭 잠금이 "닫기 방지"에 더해 "루트 잠금"으로 확장됨 — 잠금 시 활성 패널 경로를 `Tab.lockedRoot`로 고정·잠긴 동안 루트 밖(상위) 이동 차단+안내 토스트·🏠 "잠긴 루트로 이동" 버튼·해제 시 루트 동반 해제·잠긴 루트 세션 비파괴 영속. `domain/rules/tabLock.ts#isWithinLockedRoot`·`panelsSlice.lockedRootForPanel` navigate 가드·`tabsSlice.toggleTabLock`·`TabSnapshot.lockedRoots`·렌더러 전용·신규 채널 0·`SESSION_SCHEMA_VERSION` 무변경·실 GUI 런타임 스모크 🟡(상태 단일 출처 roadmap §0.5 2026-06-14·2026-06-15 단락). **(2026-06-15 결함 수정) 분할 패널 잠금이 활성 패널 1경로로 모든 패널이 같이 잠기던 결함 → 패널별 맵 `Tab.lockedRoots`(panelId→root)로 각 패널 독립 잠금·구버전 단일값 하위호환.**
- [ ] 패널 비율 자유 조절, 패널 동기 스크롤  *(패널 동기 스크롤은 §P1 폴더 비교의 "동기 스크롤"로 부분 정식화됨 — 신규 기획)*
- [x] ~~파일 태그/색상 라벨~~, 사용자 정의 정렬  *(파일 태그/색상 라벨은 2026-06-09 §T1(US-19.1, Should)로 정식 편입·승격 — 본 Could 줄에서 취소선 처리. 사용자 정의 정렬은 Could 유지)*
- [x] ~~압축/해제(zip) 통합~~  *(2026-06-09 §Q1(US-16.1, Should)로 정식 편입·승격 — "폴더처럼 열기·추출·추가"로 구체화. 본 Could 줄 취소선 처리)*
- [ ] 플러그인/확장 포인트, ~~명령 팔레트~~  *(명령 팔레트는 2026-06-09 §S2(US-18.2, Should)로 정식 편입·승격 — 본 Could 줄에서 명령 팔레트만 취소선 처리. 플러그인/확장 포인트는 Could 유지)*
- [ ] **Agentic 자연어 파일 에이전트(Plan→Confirm→Execute)** *(2026-06-14 편입·**읽기 전용 범위 구현 완료(코드)·실 동작 🟡 / 쓰기(US-24.2 plan·실행) 🔜 deferred** — 체크박스는 쓰기 미구현+런타임 미검증으로 `[ ]` 유지·구현 상태 단일 출처는 roadmap §0.5, features §Z1·US-24.1~24.5)* — 자연어 지시(예: "다운로드에서 2023년 송장 PDF를 `Invoices/2023/`로 옮겨줘")를 받아 에이전트가 **읽기 도구로 자율 탐색**하며 **변경안(plan)** 을 수집하고, 사용자가 **diff로 확인·부분 수용**한 뒤 기존 파일작업 파이프(`op:*`·휴지통·`Ctrl+Z` 되돌리기)로 **실행**한다. **읽기 자유 / 쓰기는 확인 전 미실행**(쓰기 도구는 plan 적재만·LLM이 직접·즉시 파괴할 경로 없음)이 안전 핵심. **멀티 AI 제공자: Claude(Anthropic 2-티어 opus/sonnet)·OpenAI·내부 자체 모델(OpenAI 호환 HTTP 엔드포인트·base URL+키+모델 ID)** 셋 다 연결 가능(설정에서 선택·전환·동일 UX 추상화), 내부 엔드포인트는 **base URL 화이트리스트로 SSRF 차단**. **BYO 키**(사용자 제공·과금 사용자 책임)·키는 **safeStorage(DPAPI)** 암호화 보관(평문/렌더러 노출 0)·키 미보유 시 기능 비활성+안내. **1차 도구 범위: 로컬 파일 한정·삭제는 휴지통만**(영구삭제·원격 FTP·압축 내부·셸 명령 제외)·**경로 스코프**(사용자가 연 루트/선택 항목의 조상 경계 안·시스템 폴더 차단)·**파일 내용 외부 전송은 명시 동의 게이트**(기본 경로·메타만)·**비용 상한**(턴/op/토큰/시간 하드 상한). Could(외부 LLM 의존·BYO 키·프라이버시/비용 부담이 커 핵심 차별점과 독립한 실험적 부가 기능·후속 마일스톤 M11 PoC). 1차 제외: 영구삭제/원격/압축/셸 도구·완전 자동 실행·전 디스크 자율 작업·창 간 동시 다중 run. **신규 IPC 채널 `agent:*`·신규 npm 의존성 `@anthropic-ai/sdk`+`openai`(네이티브 0)·`SESSION_SCHEMA_VERSION` 무변(에이전트 상태 휘발·비밀은 safeStorage·스냅샷엔 비-비밀 설정만). 상세 설계 ADR-014/015·`docs/architecture/agent-natural-language-design.md`·매핑 traceability §1-Z. ※ 읽기 전용 범위(US-24.1·24.3·24.4·24.5) 구현 완료(코드·verify:agent 225/0·2026-06-14 `open_tab` 내비 도구 추가로 201→225·도구 8종=읽기 7종+`open_tab`[비파괴 내비·파일 쓰기 아님])·실 동작 🟡 / 쓰기(US-24.2 plan diff·실행)는 사용자 "읽기 전용으로 완성" 결정으로 🔜 deferred — 구현 상태는 roadmap §0.5가 단일 출처**
- [ ] 다중 OS(macOS/Linux) 지원

### Won't (이번 사이클 제외)
- 클라우드 스토리지(드라이브/원드라이브) 직접 동기화
- 파일 내용 전문 인덱싱 검색(내용 기반 풀텍스트)
- ~~FTP/SSH 등 원격 프로토콜 브라우징~~ — **[2026-06-08 정정·편입] 이 항목은 사용자 결정으로 Won't에서 제거되어 §M(M3·FTP/SFTP 원격 접속, Could)으로 정식 편입됐다.** (과거 Won't였으나 사용자 요구로 승격 — 변경 이력·결정 D6 참조)
- 파일 편집기(텍스트 편집은 미리보기까지만)

### 릴리스 요건 / 개발 도구 (Must for 릴리스 · DevEx) — ✅ 구현 완료 (G장 4종) · 🟡 P7 릴리스 안정화(헤드리스분 ✅ / 런타임 실측·서명 잔여)
> 사용자 기능이 아니라 **릴리스 준비·개발 도구·기존 기능 결함 수정** 성격의 항목이다.
> 원래 로드맵에 미반영된 채 진행됐던 추가물을 **사후에 정식 추적 대상으로 편입**한 것이다(roadmap §0.5 "로드맵 외 추가 반영" → 정식화). 모두 **구현 완료(✅)**.
> 상세 규칙은 [features.md G장](./features.md) 참조.

- [x] **앱 아이콘 / 브랜딩** (Must for 릴리스) — `resources/icon.ico`(멀티 사이즈)·`resources/icon.png`, 생성 스크립트 `scripts/gen-icon.ps1`, electron-builder `win.icon` 연결, dev 창 아이콘 적용. 겹친 폴더 디자인·따뜻한 톤. (US-6.1) ✅
- [x] **원클릭 인스톨러 빌드 스크립트** (DevEx 도구) — 루트 `build-installer.ps1`. 의존성 점검 → typecheck → electron-vite build → electron-builder(NSIS)를 한 번에 실행하고 인스톨러 경로 출력. (US-6.2) ✅
- [x] **가상 스크롤 뷰포트 높이 측정 결함 수정** (기존 Must "가상 스크롤"의 품질 — US-5.6 보강) — `FileListView` 뷰포트 높이 측정을 콜백 ref 기반 ResizeObserver로 전환(로딩 중 컨테이너 미마운트로 viewportH가 400px에 고정되던 결함 해소) + 전역 CSS 리셋. ✅
- [x] **제품명 AGT-Finder 브랜딩** (Must for 릴리스 · ✅ 구현 완료, 2026-06-07 편입) — *(features §J4·US-9.4)* productName·**appId `com.agtfinder.app`**·창 타이틀·`<title>`·`package.json` 메타·문서 표기를 전부 **AGT-Finder**로 교체(`package.json`·`electron-builder.yml`·`index.html`·`mainWindow.ts`·`main/index.ts`·`paths.ts`). 사용자 노출 표면에 잔존 "Explorer" 없음(내부 ExplorerApi 타입·코드 주석만 유지). 코드네임 "Explorer"는 개발용으로만 유지. ※ 실행 파일명(`AGT-Finder.exe`)·NSIS 인스톨러·바로가기 이름은 패키징 산출물 런타임 확인 권장(설정은 productName 기준 완료). ✅
- [~] **P7 릴리스 안정화** (Must for 릴리스 · 🟡 부분 — 헤드리스분 ✅ / 런타임 잔여 🟡, 2026-06-07) — *(roadmap §3 P7)* **헤드리스 충족 ✅**: 접근성(`useFocusTrap`·모달 6종 `role=dialog`/`aria-modal`/Esc·행 `aria-posinset/setsize`·`:focus-visible`·Shift+F10), WCAG AA 대비 4팔레트 전수(`scripts/verify-contrast.ts`), 성능 측정 불변식(`windowing.ts`·`scripts/verify-perf.ts` 25), F장 QA 매트릭스(`scripts/verify-fmatrix.ts` 32·`docs/P7-qa-matrix.md`), npm audit 점검(`docs/P7-security-audit.md` — 릴리스 차단 아님), sourcemap 분리(`!out/**/*.map`), 코드서명 설정(`CSC_LINK`/`CSC_KEY_PASSWORD`). **런타임 잔여 🟡**: 성능 3종 실측 숫자(`docs/P7-perf-measurement.md`)·실제 코드서명(.pfx 인증서)·NSIS 설치/실행/제거 실측·F장 실케이스(실 네트워크/symlink/ACL)·실 스크린리더. **→ M4 1차 릴리스 미완(🟡).**

---

### MoSCoW 분류 근거 (2026-06-07 신규 8건)

> 사용자 요청 8건의 우선순위 배정 근거. 기본값: **핵심 가치(다중 디렉토리 작업)와 독립적인 UX/부가 개선은 Should**, **릴리스에 필수인 브랜딩은 M(릴리스 요건)**, **요구 정정(F5/F6 제거)은 우선순위 항목이 아니라 기존 명세 정정**.

| 항목 | 분류 | 근거 |
|---|---|---|
| 패널 실시간 갱신(J2) | **Should(상위)** | 일상 사용 빈도가 가장 높고 "보던 목록이 최신이 아님"의 답답함을 직접 해소 → 체감 가치 높음. 다만 핵심 차별점(2패널 작업)과 독립적이고 워처 신뢰성(네트워크 드라이브) 변수가 있어 Must 아님 → Should 중 우선 |
| 드래그 박스 선택(J1) | Should | 다중 선택 보조 수단(Ctrl/Shift는 이미 Must로 구현). 편의 개선이라 Should. roadmap P2 후속으로 남았던 항목의 정식화 |
| Windows 보기 5종(J3) | Should | 친숙성·표현 다양화 개선. 핵심 작업은 기존 상세/목록(Must)으로 충분 → 아이콘 그리드는 Should(기존 "그리드/썸네일 Should" 계승) |
| 미리보기 2단 뷰어(J5) | Should | 미리보기(D3) 자체가 Should(결정 D2). 그 확장이므로 Should. 코드 강조·마크다운은 부가 가치 |
| 미리보기 폭 조절(J6) | Should | 미리보기(Should)의 보조 조작. H3 메커니즘 재사용으로 비용 작음 → Should |
| 즐겨찾기 별칭(J7) | Should | 즐겨찾기(Must)의 표시 편의. C4에서 별칭을 이미 Should로 예고 → Should |
| 브랜딩 AGT-Finder(J4) | **M(릴리스 요건)** | 제품 정체성·배포 식별의 필수 요소. G1 앱 아이콘과 동급의 릴리스 게이트 → Must for 릴리스 |
| F5/F6 복사·이동 제거 | **정정(우선순위 N/A)** | 우선순위 신규 배정이 아니라 기존 Must/결정 D4의 **스코프 축소 정정**(사용자 결정). D&D·클립보드 복사/이동은 유지 |

### MoSCoW 분류 근거 (2026-06-07 신규 3건 — §K)

> §K 3건은 모두 **roadmap §0.5 P6 미구현 잔여(Should)** 또는 기존 Should 선택항의 정식 편입이라 **분류는 기존 Should를 승계**한다. 모두 핵심 가치(다중 디렉토리 작업)와 독립적인 데이터 안전·정리 효율 개선이므로 Should가 유지된다(Must 아님).

| 항목 | 분류 | 근거 |
|---|---|---|
| 되돌리기 `Ctrl+Z`(K1) | **Should** | 제품 원칙 3 "안전한 파괴적 작업"(삭제 휴지통·되돌리기 가능)을 강화하나, 핵심 차별점(2패널 작업)과 독립적이고 휴지통(Must)이 1차 안전망을 이미 제공 → Should. 기존 B7·P6 잔여 "되돌리기"의 Should 승계. 다단계 undo·역연산 정확성·충돌 안전 복잡도가 있어 1차 직후 |
| 휴지통 관리 화면(K2) | **Should** | B5에서 "휴지통 기본 연동=Must / 관리 화면=Should"로 이미 분류됨. 삭제·휴지통 이동(Must)·사이드바 휴지통 접근(Must)은 동작하므로 관리 화면(복원·비우기 UI)은 편의 개선 → Should 승계 |
| 파일 유형별 비중(K3) | **Should** | I1 사용량 대시보드(US-8.1, Should)의 "(가능 시) 유형별 비중" 선택항을 정식화한 것. 모(母) 기능이 Should이고 기존 스캔·차트(recharts) 재사용으로 비용이 작은 부가 인사이트 → Should 승계 |

### MoSCoW 분류 근거 (2026-06-07 신규 1건 — §L)

| 항목 | 분류 | 근거 |
|---|---|---|
| 그리드 이미지 썸네일(L1) | **Should** | J3 아이콘 그리드 보기(Should)의 **부가 UX 향상**으로, 핵심 가치(다중 디렉토리 작업)와 독립적이며 기존 "그리드/썸네일 Should" 계열을 승계한다. 형식 아이콘(H6, ✅)으로 식별은 이미 가능하므로 실내용 썸네일은 편의 개선 → Must 아님. 가상 스크롤 성능(가시 셀·캐시·비차단)·디코딩 폴백 복잡도가 있어 1차 직후. C/W가 아닌 이유: 사용자 직접 요청이고 J3·H6 인프라(`shell:icon`·`iconRef`·가상 스크롤)를 재사용해 비용이 제한적이며 체감 가치(이미지 식별)가 분명 → Should |

### MoSCoW 분류 근거 (2026-06-08 신규 3건 — §M 외부 연계)

> 사용자 요청 3건(외부 D&D·클립보드 외부 연계·FTP/SFTP)의 우선순위 배정 근거. 기준: **기존 Must 기능(D&D·클립보드)의 외부 확장은 체감 가치가 높고 인프라를 재사용하므로 Should**, **핵심 차별점과 독립적이며 보안·복잡도가 큰 신영역(FTP/SFTP)은 Could**. 3건 모두 **2026-06-08 구현 완료·통합 QA PASS ✅**(편입 당일 MP0~MP5 구현 — 실 동작은 런타임 스모크 권장 🟡). (챕터 식별자 "M"은 우선순위 마커 Must와 별개 — 본 표의 분류 열이 우선순위다.)

| 항목 | 분류 | 근거 |
|---|---|---|
| 외부 프로그램으로 D&D 복사(M1) | **Should** | 기존 패널 간 D&D(A3, Must)의 **자연스러운 외부 확장**으로 "탐색기처럼 바깥으로 끌어 복사"라는 친숙한 기대를 충족(제품 원칙 1 "친숙함 위에 강화"). 핵심 차별점(2패널 작업)과는 독립적이고, 외부 드롭 타깃의 처리는 OS/도착지 앱에 위임되며 데이터 안전을 위해 복사로 고정 → Must는 아니나 체감 가치 높음 → Should |
| 클립보드 외부 연계 CF_HDROP 양방향(M2) | **Should** | B4가 이미 "OS 클립보드 연동(타 앱 호환)"을 Must로 명시했으나 **실제 양방향 파일 포맷(CF_HDROP)·이동 효과 계약이 미확정**이었다. 이를 정식 확정·완성하는 것으로, 탐색기와의 상호운용은 일상 빈도가 높아 가치가 크다. 다만 앱 내부 복사/붙여넣기(Must)는 이미 동작하고 본 항목은 외부 연계 계약 추가이므로 Should(B4 Must의 외부 확장) |
| FTP/SFTP 원격 접속(M3) | **Could** | 핵심 차별점(로컬 다중 디렉토리 작업)과 **독립적인 신영역**이며, 네트워크 연결·자격증명 보관소·전송 신뢰성(끊김/타임아웃/이어받기)·호스트 키 검증 등 **보안·복잡도가 가장 크다**. 보안 원칙(D5 로컬 전용)의 부분 개정(D7)까지 수반한다. 사용자 직접 요청이라 Won't가 아니라 **정식 편입하되**, 위험·범위가 커 1차 핵심 이후로 미뤄 **Could**. (과거 Won't였던 항목의 승격 — 결정 D6) |

### MoSCoW 분류 근거 (2026-06-08 신규 2건 — §N 즐겨찾기 UX 향상)

> 사용자 요청 2건(즐겨찾기 경로 워터마크·즐겨찾기 드래그 정렬)의 우선순위 배정 근거. 기준: **즐겨찾기는 기존 Must 기능이나, 본 2건은 핵심 차별점(다중 디렉토리 작업)과 독립적인 즐겨찾기 UX 향상(시각 피드백·정렬 편의)이고 기존 인프라(J7 별칭·`SidebarSnapshot`)를 재사용해 비용이 제한적 → Should**. 둘 다 **2026-06-08 기획 편입(🔜) → 같은 날 구현 완료·QA PASS ✅**(상태 🔜→✅·렌더러 전용·신규 채널 0·키 `Alt+Shift+↑/↓`·verify 302·실 GUI 동작 런타임 스모크 🟡). (챕터 식별자 "N"은 우선순위 마커와 별개 — 본 표의 분류 열이 우선순위다.)

| 항목 | 분류 | 근거 |
|---|---|---|
| 즐겨찾기 경로 워터마크(N1) | **Should** | 즐겨찾기(C4, Must)·J7 별칭(US-9.7, Should)의 **시각 향상 부가 UX**다. 현재 위치가 즐겨찾기임을 배경 워터마크로 즉시 인지시켜 맥락 파악을 돕지만, 핵심 작업(다중 디렉토리 이동·복사)은 워터마크 없이도 동작하므로 Must는 아니다. J7 `favoriteLabels`를 텍스트 소스로 재사용해 비용이 작고, 정확 일치 한정·본문 위 비중첩으로 가독성/대비 위험이 통제됨 → Should. C/W가 아닌 이유: 사용자 직접 요청이고 기존 J7 인프라 재사용으로 비용이 제한적이며 체감 가치(맥락 인지)가 분명 |
| 즐겨찾기 드래그 정렬(N2) | **Should** | C4(즐겨찾기) "**순서 변경**(S)"으로 이미 Should로 예고된 항목의 정식화다(J7 별칭과 동격의 즐겨찾기 편의). 자주 쓰는 즐겨찾기를 위로 올려두는 일상 빈도가 있어 가치가 있으나, 핵심 차별점과 독립적이고 즐겨찾기 추가/제거(Must)는 정렬 없이도 동작하므로 Should. `SidebarSnapshot` 영속·드래그 인터랙션·키보드 대체수단(접근성) 복잡도가 있어 1차 직후 |

### MoSCoW 분류 근거 (2026-06-09 신규 1건 — §O 파일/폴더 상단 고정)

> 사용자 요청 1건(파일/폴더 상단 고정)의 우선순위 배정 근거. 기준: **자주 보는 항목을 현재 디렉토리 목록 위로 올리는 소규모 렌더러 UX 개선으로, 핵심 차별점(다중 디렉토리 작업)과 독립적이고 기존 메타 패턴(J7 별칭·`SidebarSnapshot`)을 재사용해 비용이 작다 → Should**(즐겨찾기 별칭 J7·즐겨찾기 워터마크 N1과 동급). 출처는 `docs/temp/ref.md` 아이디어로, 코드 선구현 후 2026-06-09 정식 편입(은폐 금지 — 직전 doc-sync에서 "비계획 구현"으로 플래그됐던 항목을 PM/사용자 결정으로 정식화). 챕터 식별자 "O"는 우선순위 마커와 별개 — 본 표의 분류 열이 우선순위다.
> **[2026-06-09 동작 변경·refinement]** O1의 고정 표시 방식을 "최상단 정렬"에서 **"스크롤 고정(sticky)"** 으로 변경했다(목록/자세히 보기에서 스크롤해도 고정 항목이 상단에 붙어 계속 보임·그리드는 wrapping 특성상 정렬 상단만 유지·키보드 보정). **이는 동작 변경일 뿐 MoSCoW 등급(Should)·스코프는 불변**이다(features §O1·US-14.1·F19 갱신).

| 항목 | 분류 | 근거 |
|---|---|---|
| 파일/폴더 상단 고정(O1) | **Should** | 파일 목록 보기/정렬(B1·B2, Must)의 **부가 UX 향상**으로, 자주 쓰는 항목을 디렉토리 최상단에 고정해 탐색 동선을 줄인다. 핵심 작업(다중 디렉토리 이동·복사)은 고정 없이도 동작하므로 Must는 아니다. 즐겨찾기 별칭(J7·Should)·즐겨찾기 워터마크(N1·Should)와 **동격의 소규모 per-위치 메타 확장**이며(`SidebarSnapshot.pinnedByDir` 재사용·신규 채널 0·신규 의존성 0) 정렬 결과에 후처리만 더해 비용이 작다 → Should. C/W가 아닌 이유: 사용자 직접 요청이고 기존 J7 메타·정렬 인프라(`applyPins`) 재사용으로 비용이 제한적이며 체감 가치(자주 쓰는 항목 즉시 접근)가 분명. 고정 항목 수동 재정렬·다중선택 일괄 고정은 1차 범위 밖(정직) |

### MoSCoW 분류 근거 (2026-06-10 신규 1건 — §W 자세히 보기 컬럼 헤더·너비 조절)

> 사용자 요청 1건(자세히 보기 컬럼 헤더 + 너비 드래그 조절)의 우선순위 배정 근거. 기준: **자세히 보기의 컬럼을 보기 좋게 조정하는 표시 UX 개선으로, 핵심 차별점(다중 디렉토리 작업)과 독립적이고 렌더러+세션 영속만으로 동작해 비용이 작다 → Should**(파일 목록 보기/정렬 B1·B2의 부가 UX·즐겨찾기 별칭 J7·상단 고정 O1과 동급의 소규모 표시 UX). 챕터 식별자 "W"는 우선순위 마커와 별개 — 본 표의 분류 열이 우선순위다.

| 항목 | 분류 | 근거 |
|---|---|---|
| 자세히 보기 컬럼 헤더 + 너비 조절(W1) | **Should** | 자세히(Details) 보기(B1, Must)의 **표시 UX 향상**으로, 헤더 막대와 컬럼 너비 조절은 친숙한 탐색기 관례(제품 원칙 1 "친숙함 위에 강화")를 충족하고 긴 파일명/메타 가독성을 높인다. 핵심 작업(다중 디렉토리 이동·복사)은 컬럼 조절 없이도 동작하므로 Must는 아니다. 상단 고정(O1·Should)·즐겨찾기 별칭(J7·Should)과 **동격의 렌더러+세션 영속 소규모 UX**이며(`SessionSnapshot.ui.detailsColumnWidths` 하위호환 선택 필드 추가·신규 채널 0·신규 의존성 0·`SESSION_SCHEMA_VERSION` 무변경) 정렬/필터 로직을 바꾸지 않아 비용이 작다 → Should. C/W가 아닌 이유: 사용자 직접 요청이고 기존 영속 패턴(`pinnedByDir`/`previewWidth`)을 재사용해 비용이 제한적이며 체감 가치(컬럼 가독성)가 분명. **헤더 클릭 정렬(컬럼 헤더로 정렬 기준 변경)은 1차 범위 밖**(너비 조절·레이블 표시만 — 정직 표기) |

### MoSCoW 분류 근거 (2026-06-10 신규 2건 — §U4 탭 사용자 지정 이름 · §X 빠른 위치 ▸ 다운로드)

> 사용자 직접 요청 2건(탭 사용자 지정 이름·사이드바 "빠른 위치 ▸ 다운로드")의 우선순위 배정 근거. 기준: **기존 핵심 UX(탭 관리 A1·트리 사이드바 C3)의 비파괴 확장으로, 핵심 차별점(다중 디렉토리 작업)과 독립적이고 렌더러(+세션 영속)만으로 비용이 작다 → Should**(즐겨찾기 별칭 J7·상단 고정 O1·자세히 컬럼 W1과 동급의 소규모 UX). 챕터/식별자 "U4"·"X"는 우선순위 마커와 별개 — 본 표의 분류 열이 우선순위다.

| 항목 | 분류 | 근거 |
|---|---|---|
| 탭 사용자 지정 이름(U4) | **Should** | 탭 관리(A1, Must)의 **표시 편의 확장**으로, 많은 탭을 의미 단위로 구분하려는 파워유저 니즈를 충족한다(제품 원칙 1 "친숙함 위에 강화"·브라우저 탭 관례). 핵심 작업(다중 디렉토리 이동)은 자동 제목만으로도 동작하므로 Must는 아니다. 기존 §U3(탭 색상/잠금·탭 분리)와 별개로 **이름 부여만** 추가하며, **렌더러+세션 영속만·신규 채널 0·신규 의존성 0·`SESSION_SCHEMA_VERSION` 무변경**(`Tab.customName?` 하위호환 선택 필드)으로 비용이 작다 → Should. C/W가 아닌 이유: 사용자 직접 요청이고 기존 영속 패턴(`pinnedByDir`/`detailsColumnWidths`)을 재사용해 비용이 제한적이며 체감 가치(탭 구분)가 분명 |
| 빠른 위치 ▸ OS 알려진 폴더(X1) | **Should** | 트리 사이드바(C3, Must)의 **탐색 진입점 확장**으로, 가장 자주 들르는 시스템 폴더(다운로드·바탕화면·문서·사진)에 한 번에 닿게 해 일상 동선을 단축한다(즐겨찾기·드라이브 진입점과 동격). 핵심 차별점과 독립적이고 항목 클릭 이동은 기존 사이드바 이동 경로를 재사용한다. **신규 채널 `fs:known-folders` 하나만 추가**(P1 동결 후 신기능 신규 채널 — 기존 선례와 동일 invoke·guard/Result 규약·신규 npm 의존성 0)되며 폴더 이동 외 부가 동작이 없어 비용이 작다 → Should. (2026-06-28 동작 확장: 노출 노드 다운로드 단독 → **다운로드·바탕화면·문서·사진 4개**로 확대·각 경로 조회 실패 시 해당 행만 비표시·`home`은 DTO로 함께 가져오나 예약·미표시·**MoSCoW 분류 Should 무변경**·신규 채널/의존성 0). C/W가 아닌 이유: 사용자 직접 요청이고 OS 표준 폴더 즉시 접근의 체감 가치가 분명 |

### MoSCoW 분류 근거 (2026-06-12 신규 1건 — §Y Windows 셸 컨텍스트 메뉴 연동)

> 사용자 직접 요청 1건(Windows 셸 컨텍스트 메뉴 연동)의 우선순위 배정 근거. 기준: **앱 우클릭 메뉴를 Windows 셸 생태계와 상호운용하게 하는 편의 확장으로, 핵심 차별점(다중 디렉토리 작업)과 독립적이며 기존 컨텍스트 메뉴 인프라(B6)·ADR-005 보안 모델을 재사용한다 → Should**(외부 연계 §M M1·M2와 결을 같이하는 Windows 셸 상호운용 UX). 챕터 식별자 "Y"는 우선순위 마커와 별개 — 본 표의 분류 열이 우선순위다. **상태(2026-06-12): 구현 완료(코드)·통합 QA PASS — 신규 채널 `shell:context-verbs`/`shell:invoke-verb`·신규 의존성 0·`verify:shellverbs` 75/0. 실 GUI/실 패키지 런타임 스모크 🟡.**

| 항목 | 분류 | 근거 |
|---|---|---|
| Windows 셸 컨텍스트 메뉴 연동(Y1) | **Should** | 컨텍스트 메뉴(B6, Must)의 **상호운용 확장**으로, 설치 프로그램(반디집·Cursor 등)이 셸에 등록한 verb를 앱 우클릭 메뉴에서 바로 실행하게 해 별도 Windows 탐색기 우클릭을 없앤다(외부 연계 §M·제품 원칙 1 "친숙함 위에 강화"). 핵심 작업(다중 디렉토리 이동·복사)은 셸 verb 없이도 동작하므로 Must는 아니다. **신규 네이티브 의존성 0**(셸 COM `Shell.Application` + 상주 PowerShell 워커 — 기존 hash/archive 워커 패턴 재사용)이고 신규 IPC 채널 2종(verb 조회·실행, P1 동결 후 신기능 신규 채널·선례 동일 규약 예상)만 추가되며, 기존 컨텍스트 메뉴 인프라(B6)·ADR-005 보안 모델을 재사용해 비용이 통제된다 → Should. C/W가 아닌 이유: 사용자 직접 요청이고 PoC로 설치 프로그램 verb 열거가 실증(2026-06-12)됐으며 체감 가치(셸 통합 편의)가 분명. **동작 범위: 단일 선택과 다중 선택(2개 이상) 모두 섹션 노출(로컬 경로 한정·다중은 선택 전체를 하나의 셸 컨텍스트 메뉴로 처리). 정직 한계: 캐스케이드 서브메뉴 best-effort(평탄화/누락 가능)·로컬 경로 한정(원격/archive 섞이면 숨김)·중복 verb 블랙리스트 필터·verb 실행 fire-and-forget·워커 첫 조회 지연 로딩 상태 — 수용기준에 행동 계약으로 반영. 비범위: 네이티브 메뉴 팝업·서브메뉴 완전 재현** |

### MoSCoW 분류 근거 (2026-06-14 신규 1건 — §Z Agentic 자연어 파일 에이전트)

> 사용자 직접 요청 1건(Agentic 자연어 파일 에이전트)의 우선순위 배정 근거. 기준: **외부 LLM에 의존하고 BYO 키·프라이버시·비용 책임을 동반하는 실험적 부가 기능으로, 핵심 차별점(다중 디렉토리 작업)과 완전 독립하며(에이전트 없이도 §A~§Y 전부 동작) PoC 성격이 강하다 → Could**(후속 마일스톤 M11). 챕터 식별자 "Z"는 우선순위 마커와 별개 — 본 표의 분류 열이 우선순위다. **상태(2026-06-14): 읽기 전용 범위(US-24.1·24.3·24.4·24.5) 구현 완료(코드·verify:agent 225/0·2026-06-14 `open_tab` 내비 도구 추가로 201→225·도구 8종=읽기 7종+`open_tab`[비파괴 내비·파일 쓰기 아님])·실 동작 🟡 / 쓰기(US-24.2 plan·실행) 🔜 deferred(사용자 "읽기 전용으로 완성" 결정·`agent:confirm`=EUNSUPPORTED). 상태 단일 출처는 roadmap §0.5 — 본 표는 우선순위(분류 열)만 확정한다(분류=Could 무변경).**

| 항목 | 분류 | 근거 |
|---|---|---|
| Agentic 자연어 파일 에이전트(Z1) | **Could** | **강력 차별화이지만 핵심 차별점과 독립한 실험적 부가 기능.** 자연어로 파일 정리를 지시하는 가치는 크나, ① 앱이 처음으로 **외부 LLM(Claude/OpenAI/내부 모델)에 의존**하고(키 없음·네트워크 오류·API 변경 시 기능 전면 비활성), ② **BYO 키·과금이 사용자 책임**이며, ③ **파일 내용의 외부 전송·프롬프트 인젝션** 등 새 프라이버시·보안 표면을 추가한다. 핵심 파일 작업(다중 디렉토리 이동·복사·정리)은 에이전트 없이도 완결되므로 Must/Should가 아니다. 안전(읽기 자유/쓰기 스테이징·diff 확인·휴지통·undo)과 격리(safeStorage·경로 스코프·SSRF 차단·네트워크 단일 격리)는 기존 인프라(`op:*`·undo·credentialStore·§M3 D7 네트워크 경계)를 재사용해 비용을 통제하지만, LLM plan의 비결정성·비용 예측 불가성·외부 의존이 본질적이라 **PoC로 후속 마일스톤(M11)에 두는 Could가 적절**. W가 아닌 이유: 사용자 직접 요청이고 설계(ADR-014)가 완료돼 실증 경로가 분명. **멀티 제공자(Claude/OpenAI/내부 OpenAI 호환 엔드포인트) 추상화·내부 base URL 화이트리스트 SSRF 차단·tool-use 미지원 모델 degradation·키 safeStorage는 수용기준에 포함. 정직 한계: plan 비결정성(최종 방어선=사용자 diff 확인)·프롬프트 인젝션(plan 적재까지는 불가피·쓰기 미실행+diff가 차단)·비용 사용자 과금 — features §Z·user-stories 에픽24에 행동 계약으로 반영. 비범위: 영구삭제/원격/압축/셸 도구·완전 자동 실행** |

### MoSCoW 분류 근거 (2026-06-09 신규 14건 — §P~§U 파워 기능)

> 타 탐색기와 차별화하는 파워 기능 14건의 우선순위 배정 근거. 기준: **강력 차별화 핵심·파워유저 일상 가치·기존 인프라 재사용 가능 항목은 Should**(요구사항대로 차별화 핵심은 Should 이상), **핵심 차별점과 독립적이며 비용 대비 빈도가 낮거나(체크섬) 멀티 윈도우 복잡도가 큰(탭 분리) 항목은 Could**. **상태(2026-06-09): M6 배정 3종(P1 메타·단일깊이·R1·T3) 구현 완료(코드)·실 GUI 🟡 / 나머지 11종 🔜 미착수(M7~M9)** — 우선순위(분류 열) 자체는 불변. 챕터 식별자 "P~U"는 우선순위 마커와 별개 — 본 표의 분류 열이 우선순위다. 보안 제약(원격·압축·grep·해시 = ADR-005·경로 검증·Zip Slip 차단·throw0/Result·IPC guard·외부 네트워크/실행 없음)은 §7 보안 및 features 각 챕터에 명시.

| 항목 | 분류 | 근거 |
|---|---|---|
| 듀얼 패널 폴더 비교·동기화(P1) | **Should(상위)** | **강력 차별화 핵심.** 이미 구현된 분할 패널(A2)·패널 간 D&D(A3)를 "비교·정리"로 확장해 제품의 단일 차별점(여러 디렉토리 동시 관리)을 직접 강화한다. 핵심 가치와 정면으로 결합되나, 동기화가 파괴적이라 데이터 안전(미리보기·확인·휴지통)을 갖춰야 하고 해시/대용량 비교 복잡도가 있어 Must(1차 릴리스 게이트)는 아님 → Should 상위(M6 1순위) |
| 압축파일 폴더처럼 열기(Q1) | **Should** | **강력 차별화.** 일상 빈도가 높고 별도 도구를 대체한다. 기존 M3 RemoteAdapter 패턴(`archive://`)을 재사용할 여지가 있어 비용이 통제되나, 압축 쓰기·포맷·암호화 변수로 범위를 zip로 좁혀야 하므로 Must 아님 → Should |
| 고급 일괄 이름변경(R1) | **Should** | 파워유저 정리 효율의 핵심. 기존 일괄 작업(E3)·되돌리기(K1)를 재사용하고 미리보기/충돌 검사로 안전을 확보한다. 핵심 차별점과 독립적이나 체감 가치가 커 Should |
| 중복 파일 찾기(R2) | **Should** | 정리 가치가 크고 사용량 대시보드(I1)와 결을 같이한다. 크기→해시 2단계로 비용을 통제. 핵심 차별점과 독립적이라 Must 아님 → Should |
| 전송 큐 매니저(R3) | **Should** | 기존 진행률(E4)·`op:*`/`remote:*`를 통합 큐로 완성하는 작업으로 다수/원격 전송 시 체감 가치가 크다. 단일 작업 진행률(Must)은 이미 있으므로 통합 큐는 확장 → Should |
| 복사 시 체크섬 검증(R4) | **Could** | 데이터 안전을 더하지만 일상 빈도가 낮고 해시 비용이 성능에 영향을 준다(기본 off). 핵심 차별점과 독립적이고 옵션 성격이라 Could |
| 내용 검색 grep(S1) | **Should** | 개발자·파워유저 핵심 가치(이름이 아닌 내용으로 찾기). 현재 이름 필터만 가능한 한계를 메운다. PRD Won't "내용 전문 인덱싱"과 구분(전 디스크 인덱스는 여전히 Won't·본 항목은 현재 폴더 온디맨드 grep) → Should |
| 명령 팔레트(S2) | **Should** | 모든 명령·위치를 한 입력창에서 실행해 키보드 일급(제품 원칙 4)을 강화. 기존 commandBus로 수렴해 비용이 제한적. 핵심 작업은 팔레트 없이도 가능하므로 Must 아님 → Should(과거 Could "명령 팔레트"의 승격) |
| 파일 태그/색상 라벨(T1) | **Should** | 폴더 구조와 독립된 분류 수단. J7/O1과 동격의 per-경로 메타·세션 영속 패턴을 재사용해 비용이 작고 데이터 비파괴(앱 내부 메타). 핵심 차별점과 독립적이라 Should(과거 Could의 승격) |
| 폴더 용량 인라인(T2) | **Should** | I1 사용량 대시보드(Should)의 인라인 버전으로 정리 우선순위 파악을 돕는다. `scanEngine` 재사용·온디맨드·기본 off로 성능 위험 통제 → Should |
| ~~정렬/필터 프리셋(T3)~~ (폐기) | ~~**Should**~~ | ~~자주 쓰는 보기 조합 재사용으로 파워유저 효율을 높인다. 워크스페이스 저장(E·Should)과 동격 메타·비용 작음 → Should.~~ **MoSCoW 등급 기록 보존하되 2026-06-09 사용자 결정으로 폐기·코드 제거(상태=폐기).** |
| Space 퀵룩(U1) | **Should** | 미리보기(D3·J5, Should)의 빠른 전체화면 버전으로 친숙성(macOS Quick Look)·완성도가 높다. D3/J5 렌더러 재사용으로 비용 제한적 → Should |
| 브레드크럼 드롭다운(U2) | **Should** | 주소 표시줄(C1, Must)의 탐색 가속 UX. 형제 폴더 즉시 이동으로 동선을 줄인다. 핵심 작업은 기존 브레드크럼/사이드바로 가능하므로 Must 아님 → Should |
| 탭 색상/잠금·탭 분리(U3) | **Could** | 탭 색상·잠금은 소규모지만 **탭 분리(새 창)** 가 멀티 윈도우(BrowserWindow 다중)·세션 복원·IPC 라우팅 복잡도를 동반한다. 핵심 차별점과 독립적이고 복잡도가 커 묶어서 Could |

### MoSCoW 분류 근거 (2026-07-14 신규 1건 — §U5 새 창(현재 위치 복제) `Ctrl+N`)

> 이미 구현·게시(v1.15.0)된 비계획 구현을 사용자 정식 편입 결정으로 기획 항목화한 1건의 우선순위 배정 근거. 기준: **탐색기 관례(친숙함) 편의 단축키이자 기존 멀티 윈도우 인프라(§U3 `window:split-tab`)의 재사용 확장으로, 핵심 차별점(다중 디렉토리 작업)과 독립적이고 렌더러 전용·신규 채널 0으로 비용이 작다 → Should**(탭 사용자 지정 이름 U4·자세히 컬럼 W1·빠른 위치 X1과 동급의 소규모 UX). 챕터/식별자 "U5"는 우선순위 마커와 별개 — 본 표의 분류 열이 우선순위다.

| 항목 | 분류 | 근거 |
|---|---|---|
| 새 창(현재 위치 복제)·`Ctrl+N`(U5) | **Should** | 탭 관리(A1, Must)·멀티 윈도우(U3)의 **진입 동선 확장**으로, Windows 탐색기의 가장 익숙한 관례 단축키(`Ctrl+N`=새 창)를 그대로 제공해 "지금 보던 위치를 놔둔 채 창 하나 더"라는 일상 니즈를 충족한다(제품 원칙 1 "친숙함 위에 강화"). 핵심 작업(다중 디렉토리 이동·복사)은 새 창 없이도 동작하므로 Must는 아니다. **U3가 Could였던 이유(멀티 윈도우 BrowserWindow 다중·세션 복원·IPC 라우팅 복잡도)는 U3 구현으로 이미 해소**됐고, U5는 그 인프라(`window:split-tab`·`windowManager`)를 **그대로 재사용**해 신규 IPC 채널 0·신규 의존성 0·렌더러 전용(main 무변경)·`SESSION_SCHEMA_VERSION` 무변으로 **비용이 U3와 비교할 수 없이 작다** → Could가 아니라 Should. C/W가 아닌 이유: 사용자 정식 편입 결정 + 이미 구현·게시됐고(v1.15.0) 관례 단축키 부재가 오히려 이질감을 주는 항목. **정직 표기(범위 밖·한계): 새 창은 primary=false라 세션 자동저장에 미참여 → 재시작 시 복원되지 않는다(§U3 분리 창과 동일 한계·의도적 MVP)·창 간 탭 드래그 이동·창별 워크스페이스는 여전히 §U3 1차 제외 범위** |

---

## 7. 비기능 요구사항

### 성능
- 10,000개 이상 항목 폴더: 가상 스크롤(virtualized list)로 렌더, 첫 화면 1.5초 이내.
  - **[2026-06-07 결함 수정 ✅]** 가상 스크롤 뷰포트 높이 측정을 콜백 ref 기반 ResizeObserver로 전환. 로딩 중 컨테이너가 아직 마운트되지 않아 viewportH가 400px에 고정되던 결함을 해소(전역 CSS 리셋 동반). 이는 기존 Must "가상 스크롤"(US-5.6)의 품질/결함 수정 항목이다.
  - **[2026-06-07 P7 ✅ 헤드리스 불변식 / 🟡 실측]** windowing 순수함수(`windowing.ts`) 추출 + `scripts/verify-perf.ts`(25 pass)로 1만 항목 가상 스크롤 DOM 후보 수십개·200ms 스로틀·검색 필터 **불변식 증명**. **첫 렌더 ≤1.5초·진행률/검색 ≤200ms 실측 숫자는 GUI 런타임 측정 잔여(🟡 — `docs/P7-perf-measurement.md` 절차).**
- 디렉토리 읽기·복사 등 I/O는 **워커/별도 프로세스**에서 처리해 UI 스레드 비차단.
- 대용량 복사: 청크 단위 진행률, 200ms 이내 갱신, 사용자 취소 가능.
- 메모리: 썸네일은 화면 진입 항목만 지연 로드(lazy)·캐시 상한 적용.

### 안정성 / 데이터 안전
- 삭제는 기본 **휴지통 경유**. 영구 삭제는 별도 확인.
- 복사/이동 충돌 시 명시적 확인(덮어쓰기/건너뛰기/이름변경). 임의 덮어쓰기 금지.
- 작업 실패(권한/사용 중 파일 등) 시 부분 성공 결과와 실패 목록을 명확히 보고.
- 비정상 종료 후 탭/패널 세션 복원.

### 접근성
- 모든 핵심 동작 키보드 접근 가능, 포커스 표시 명확. **[2026-06-07 ✅ P7 코드]** 공용 포커스 트랩(`useFocusTrap`: 첫 포커스·Tab 순환·opener 복귀·Esc 위임)·모달 6종 `role=dialog`/`aria-modal`/Esc·`:focus-visible`(인라인 outline 제거)·Shift+F10 컨텍스트 메뉴 구현. **실 스크린리더 발화·포커스 육안은 런타임 🟡.**
- 테마 대비 WCAG AA 수준 지향, 글자 크기 시스템 설정 존중. **[2026-06-07 ✅ P7]** 4종 팔레트(LIGHT/DARK/BLUELIGHT) 주요 토큰쌍 WCAG AA 전수 통과(`scripts/verify-contrast.ts`, 실패 0).
- 스크린리더용 항목 레이블(파일명/형식/크기) 제공(Should). **[2026-06-07 ✅ 코드]** 행 `aria-posinset/setsize` 등 ARIA 레이블 구현(실 스크린리더 검증은 런타임 🟡).

### 보안 / 권한
- OS 파일시스템 권한을 그대로 존중. 권한 없는 경로 접근 시 명확한 안내.
- 앱은 사용자 권한 범위 내에서만 동작(권한 상승은 OS 표준 흐름 따름).
- 외부 네트워크 전송 없음(로컬 전용)이 기본. **텔레메트리는 옵트인(기본 꺼짐)**, 동의 시에만 익명 집계 전송(결정 기록 D5).
- **[2026-06-08 보안 경계 부분 개정 — 결정 D7·정직 기록] FTP/SFTP 원격 접속(§M·M3) 편입에 따른 네트워크 경계 개정.** 기존 "로컬 전용·외부 네트워크 전송 없음(D5)" 원칙을 **M3에 한해 부분 개정**한다: 네트워크 연결·파일 전송은 **사용자가 명시적으로 입력/저장한 원격 호스트(FTP/FTPS/SFTP)로만** 발생한다. 그 외 임의 외부 송신은 여전히 **전무**하며, **임의 외부 송신 금지(텔레메트리 포함·D5 옵트인 원칙)는 변경 없이 유지**된다(원격 연결 ≠ 텔레메트리). 즉 "로컬 전용"은 "**사용자가 지시한 원격 호스트로의 전송만 허용, 그 외 임의 송신 금지(텔레메트리 포함)**"로 정밀화된다.
- **[2026-06-08] 원격 자격증명 저장 — OS 자격증명 보관소만(결정 D6).** FTP/SFTP 비밀번호·SSH 키 패스프레이즈 등 비밀은 **OS 자격증명 보관소(Windows Credential Manager / DPAPI 계열)에만 저장**하고, **설정 파일·세션 파일·로그·오류 메시지에 평문 저장·노출을 금지**한다. 사용자가 "저장"을 선택할 때만 보관소에 저장하고, 미저장 시 메모리에서만 사용 후 폐기한다. 평문 FTP 전송 시 **비암호화 경고**를 표시하고, SFTP(SSH)·FTPS는 암호화 전송하며 미신뢰/변경된 호스트 키는 경고·사용자 확인 후에만 진행한다(중간자 공격 방지). (features §M3·US-12.3)
- **[2026-06-08] 외부 D&D·클립보드 외부 연계(§M·M1·M2) 보안.** 외부로 노출/교환하는 것은 **사용자가 선택한 실제 파일 경로(CF_HDROP 등 표준 포맷)** 뿐이며, 외부 클립보드 입력도 제공된 파일 경로만 검증 후 사용한다. 임의 데이터·실행 표면을 추가하지 않는다(ADR-005 보안 모델 유지).
- **[2026-06-14 보안 경계 추가 개정 — 결정 D8·정직 기록] Agentic 자연어 파일 에이전트(§Z·Z1) 편입에 따른 네트워크 경계·AI 제공자·내용 전송 정책.** 본 기능은 앱에 **두 가지 새 표면** — (a) 외부 AI 제공자(LLM) 네트워크 송신, (b) LLM이 영향을 주는 파일 변경 제안 — 을 추가한다. D5/D7 원칙 위에서 다음을 강제한다(전면 개방 아님·정직한 부분 확장):
>   - **네트워크 경계(D8·D7 추가 정밀화)**: 에이전트의 외부 송신은 **사용자가 설정에서 선택·활성화한 AI 제공자 엔드포인트로만** 발생한다 — (i) Claude=`api.anthropic.com`, (ii) OpenAI=`api.openai.com`, (iii) **내부 자체 모델=사용자가 등록한 OpenAI 호환 HTTP 엔드포인트**. 그 외 임의 외부 송신은 여전히 **전무**하다. 하드코딩 자동 연결·백그라운드 호출 없음(사용자가 명시 실행할 때만 호출·키 없으면 비활성).
>   - **SSRF 차단(내부 엔드포인트)**: 내부 자체 모델의 base URL은 **화이트리스트로만 허용**한다(임의 URL 전면 개방 금지). 사용자/관리자가 사내 게이트웨이·vLLM·TGI 등 신뢰 호스트를 화이트리스트에 등록하고, 그 외 호스트로의 요청은 거부한다(메타데이터 서비스·내부망 스캔 등 SSRF 차단).
>   - **BYO 키·자격증명 보관(D6 동형)**: AI 제공자 API 키(BYO·과금 사용자 책임)는 **safeStorage(DPAPI)로 암호화 저장**하고 설정 파일·세션 스냅샷·로그·오류 메시지·IPC 응답·plan DTO에 **평문 저장·노출을 금지**한다. 키는 메인 프로세스에서만 복호하며 렌더러에 전달하지 않는다. safeStorage 미가용 시 키 저장 비활성(평문 폴백 금지). 세션 스냅샷에는 **비-비밀 설정(제공자 선택·모델 ID·base URL 화이트리스트)만** 영속한다.
>   - **파일 내용 전송 동의(SG-4)**: 에이전트의 기본 동작은 **경로·메타데이터(이름·크기·수정일)만** AI 제공자로 전송한다. 파일 **실내용**(미리보기 텍스트)은 **작업별 명시 동의 게이트**를 통과할 때만 전송하며, 동의 시에도 미리보기 상한 바이트만 보낸다(전체 파일 업로드 안 함). 어떤 항목을 읽고 전송했는지는 도구 호출 로그로 사용자에게 정직 표시한다.
>   - **읽기 자유 / 쓰기 미실행·휴지통·되돌리기**: LLM은 읽기 도구만 즉시 실행하고 쓰기 도구는 plan에 적재(stage)만 한다. 모든 실제 변경은 **사용자 confirm(diff) 후** 기존 파이프로만 실행되며 **삭제는 휴지통만·`Ctrl+Z`로 되돌릴 수 있다**(영구삭제·원격·셸 도구는 1차 미노출 — 인젝션이 부를 도구 자체가 없음).
>   (features §Z·user-stories 에픽24·결정 D8·ADR-014)
- **[2026-06-07 P7 ✅ 보안 점검]** `npm audit` 점검·판정(`docs/P7-security-audit.md`): 9건 전부 major 업그레이드 필요(비파괴 fix 0건) — 8건 빌드 툴체인(배포 산출물 영향 0)·1건 electron 본체(ADR-005 하드닝 완화). **major 업그레이드는 사용자 결정 보류 → 릴리스 차단 아님.** sourcemap 배포 제외(`!out/**/*.map`)·코드서명 설정(`CSC_LINK`/`CSC_KEY_PASSWORD`, 실제 서명은 .pfx 인증서 필요 🟡).

### 호환 / 플랫폼
- 1차: Windows 10/11. 한글/유니코드 경로·긴 경로(Long Path) 처리 고려.
- 데스크톱 앱(Electron) 전제 유지. 단일 인스턴스 권장(중복 실행 제어).

### 릴리스 / 패키징 / 개발 도구 (DevEx) — ✅ 구현 완료
> 1차 릴리스 산출과 개발 효율을 위한 도구·자산 요건. §6 "릴리스 요건 / 개발 도구"와 동일 항목의 비기능 관점 기술. 모두 구현 완료.
- **앱 아이콘 / 브랜딩(Must for 릴리스)**: 인스톨러·실행 파일·작업표시줄·dev 창에 고유 아이콘이 적용되어 앱이 시각적으로 식별된다. 멀티 사이즈 `.ico`(`resources/icon.ico`) + `.png`(`resources/icon.png`)를 `scripts/gen-icon.ps1`로 생성·재현하고, electron-builder `win.icon`에 연결한다. 디자인은 겹친 폴더(멀티 디렉토리 정체성) + 따뜻한 톤.
- **원클릭 인스톨러 빌드(DevEx)**: 단일 명령(`build-installer.ps1`)으로 의존성 점검 → typecheck → electron-vite build → electron-builder(NSIS)를 일괄 실행하고 최종 인스톨러 경로를 출력해, 릴리스 빌드 재현성과 개발자 효율을 높인다.
- **[2026-06-22 P7 ✅ 코드·실 게시 / 🟡 실 왕복] 자동 업데이트(GitHub Releases)**: 패키징 빌드 한정으로 앱 시작 시 1회 새 버전을 확인(`electron-updater`·`src/main/os/autoUpdate.ts initAutoUpdate()`·`app.isPackaged` 한정·throw 0 격리)하고, 새 버전이 있으면 백그라운드 차등 다운로드 후 다음 재시작 때 NSIS가 조용히 설치한다. 게시는 `npm run release`(electron-builder `--publish always`·`electron-builder.yml publish: github`). **상태: 코드 정합·typecheck/build/부팅 통과·1.9.2 GitHub Releases 실 게시 완료(exe·blockmap·latest.yml) ✅ / 실 설치본 자동 업데이트 왕복(감지→다운로드→재시작 설치)·코드서명(미적용) 🟡.** (ADR-006 빌드·릴리스 절차·roadmap §P7·traceability §1-P7)

---

## 8. 단축키 체계 (확정 — 충돌 없음)

> **결정 배경**: 듀얼 패널 파일관리자 관례(Total Commander)에 맞춰 **포커스 이동은 `Tab`/`Ctrl+←·→`** 로 두고, 새로고침은 `Ctrl+R`로 배정한다.
> **[2026-06-07 스코프 축소]** 과거 Total Commander 관례로 두었던 **패널 간 복사=`F5`/이동=`F6`** 단축키는 **사용자 결정으로 제거(Deprecated)** 했다(사유: 일반 사용자에게 일반적이지 않은 단축키). 표에서 두 행을 삭제 처리했고, **패널 간 복사/이동은 D&D(A3)·클립보드(`Ctrl+C/X/V`)** 가 단일 경로다. `F5`/`F6` 키는 미배정 상태가 된다.
> 이전 명세의 F5/F6 이중 할당 문제는 새로고침을 `Ctrl+R`로 옮겨 이미 해소돼 있었고, 본 정정으로 `F5`/`F6` 자체가 사라져 충돌 여지가 원천 제거됐다.

| 영역 | 키 | 동작 |
|---|---|---|
| 탭 | `Ctrl+T` | 새 탭 |
| 탭 | `Ctrl+W` | 탭 닫기 |
| 탭 | `Ctrl+Shift+T` | 닫은 탭 복원 |
| 탭 | `Ctrl+D` | 탭 복제(동일 경로 새 탭) |
| 탭 | `Ctrl+Tab` / `Ctrl+Shift+Tab` | 다음 / 이전 탭 |
| 탭 | `Ctrl+1`~`Ctrl+9` | N번째 탭 |
| **창** | **`Ctrl+N`** | **새 창(현재 위치 복제)** — 현재 위치(활성 탭)를 그대로 가진 창을 하나 더 연다(소스 탭 유지·§U3 "탭 분리(새 창)"=탭을 옮김과 별개). Should — U5·US-20.5 **2026-07-14 정식 편입·구현 완료(코드)·실 GUI 🟡** (탐색기 관례·전역·텍스트 입력/다이얼로그 컨텍스트 미발화·`Ctrl+Shift+N`(새 폴더)과 충돌 0·명령 팔레트/단축키 도움말 자동 노출) |
| **패널 포커스** | **`Tab`** | **다른 패널로 포커스 이동(주된 키)** |
| 패널 포커스 | `Ctrl+←` / `Ctrl+→` | 좌/우 패널로 포커스 이동(보조) |
| 패널 포커스 | `Alt+1`~`Alt+4` | 패널 1~4로 직접 포커스(분할 시·row-major 패널 1=좌상 … 패널 4=우하). 단일 레이아웃·범위 밖이면 무시 |
| 패널 분할 | `Ctrl+\` | 2분할 토글(좌우) |
| 패널 분할 | `Ctrl+Shift+\` | 4분할 토글(2x2, Should — P6 구현됨) |
| 레이아웃 | `Ctrl+B` | 사이드바 표시/숨김 토글(Should — 2026-06-07 편입, H2·US-7.2 — **구현됨** `domain/keybindings`→`sidebar.toggle`) |
| ~~패널 작업~~ | ~~`F5`~~ | ~~활성 패널 선택 항목을 다른 패널로 복사~~ — **삭제됨(2026-06-07 사용자 요청)** |
| ~~패널 작업~~ | ~~`F6`~~ | ~~활성 패널 선택 항목을 다른 패널로 이동~~ — **삭제됨(2026-06-07 사용자 요청)** |
| 탐색 | `Alt+←` / `Alt+→` / `Alt+↑` | 뒤로 / 앞으로 / 위로 |
| 탐색 | `Ctrl+L` | 주소 표시줄 편집 모드 |
| 탐색 | `Backspace` | 상위 폴더 |
| 보기 | **`Ctrl+R`** | **새로고침(F5 충돌 회피)** |
| 보기 | `Ctrl+F` | 현재 폴더 검색 |
| 파일 | `Ctrl+C` / `Ctrl+X` / `Ctrl+V` | 복사 / 잘라내기 / 붙여넣기(클립보드) |
| 파일 | `F2` | 이름변경 |
| 파일 | `Ctrl+Shift+N` | 새 폴더 |
| 파일 | `Delete` / `Shift+Delete` | 휴지통 삭제 / 영구 삭제 |
| 파일 | `Ctrl+Z` | 되돌리기(Should — 2026-06-07 정식화·**구현 완료 ✅**, K1·US-10.1 — `notYet` 안내가 `performUndo` 다단계 undo로 연결됨·global·입력 중 미발화) |
| 선택 | `Ctrl+A` / `Ctrl+클릭` / `Shift+클릭` | 전체 / 개별 / 범위 선택 |
| 미리보기 | `Ctrl+P` | 미리보기 패널 토글(Should — P6 구현됨) |
| 미리보기 | `Space` | 퀵룩 오버레이 열기/닫기(Should — U1·US-20.1 **M8 구현 완료(코드)·실 GUI 🟡** — 항목 선택 상태에서·입력/이름편집/오버레이 중 미발화) |
| 명령 팔레트 | `Ctrl+Shift+P` | 명령 팔레트 열기(Should — S2·US-18.2 **M8 구현 완료(코드)·실 GUI 🟡** — 미배정 조합·충돌 없음·`Esc` 닫기) |
| 즐겨찾기 | `Alt+Shift+↑` / `Alt+Shift+↓` | 즐겨찾기 순서 위/아래로 이동(Should — 2026-06-08 N2·US-13.2 **구현 완료 ✅**, 드래그 정렬의 키보드 대체수단·사이드바 즐겨찾기 포커스 한정·전역 미배정·충돌 0) |

> **[2026-07-14] 신규 그룹 "창" · `Ctrl+N`(U5 새 창(현재 위치 복제))는 기존 어느 키와도 충돌하지 않음을 확인했다** — 기존 Ctrl 단독 조합은 T/W/D/Tab/\\/L/R/F/C/X/V/A/P/B/,/1~9이며 **`Ctrl+N`은 미배정**이었다(`Ctrl+Shift+N`=새 폴더는 `Shift`가 붙은 별개 조합·충돌 0). 전역(`global`) 컨텍스트로 등록되지만 **텍스트 입력 컨텍스트(주소창 편집·검색·이름변경·다이얼로그)에서는 가로채지 않아** 타이핑이 보존된다. 명령 팔레트(`Ctrl+Shift+P`)·단축키 도움말에는 KEYBINDINGS 단일 출처에서 "새 창(현재 위치 복제)"로 자동 노출된다(별도 등록 없음).
> **충돌 검증**: 위 표에서 한 키가 동일 컨텍스트에서 두 동작에 매핑되지 않음을 확인했다.
> 특히 `Tab`(포커스)·`Ctrl+R`(새로고침)이 고유하게 배정되었다. **`F5`·`F6`은 2026-06-07 제거되어 더 이상 어떤 동작에도 매핑되지 않는다(미배정).**
> **[2026-06-07] 신규 `Ctrl+B`(사이드바 토글)는 기존 어느 키와도 충돌하지 않음을 확인했다**(기존 Ctrl 조합: T/W/D/Tab/\\/L/R/F/C/X/V/Shift+N/A/P/,/1~9 및 Shift·← → 조합 — B는 미사용). VS Code 등에서 사이드바 토글에 쓰는 관례 키와도 일치. H1 아이콘바·H3 분할 크기조절은 신규 단축키를 요구하지 않고 기존 commandId(분할/미리보기/탐색/파일 등)를 마우스로 호출한다.
> **[2026-06-08] 신규 `Alt+Shift+↑`/`Alt+Shift+↓`(N2 즐겨찾기 순서 이동)는 기존 어느 키와도 충돌하지 않음을 확인했다** — 전역 `domain/keybindings`에 `alt+shift+arrow*`가 미등록(`alt+arrowup`=`nav.up`은 `Shift` 없는 조합)이라 `KeyboardDispatcher` capture가 가로채지 않고 사이드바 즐겨찾기 포커스 컨텍스트의 로컬 핸들러만 동작한다(코드 확인·qa-integration-N §4). 한국어 IME `Alt+Shift` 언어전환 OS 점유 가능성은 런타임 스모크 확인 권장([낮음-1]·가능성 낮음).
> **[2026-06-07] 신규 H4~H6도 신규 단축키를 요구하지 않는다**: H4 터미널 열기=컨텍스트 메뉴 항목(2026-06-28 동작 확장: "터미널 열기" 바로 아래 **"터미널 열기(Claude)"** 컨텍스트 메뉴 항목 추가·기동 직후 `claude` 자동 실행·신규 단축키 불요), H5 경로 직접 입력=주소 표시줄 단일 클릭(기존 `Ctrl+L` 유지·재사용), H6 파일 유형 아이콘=표시 동작(키 불요).
> **[2026-06-07] 신규 I1·I2도 신규 단축키를 요구하지 않는다**: I1 사용량 대시보드=아이콘바 ④도구 그룹 아이콘 클릭 + 실행 시 자동 팝업(설정 토글 기본 켜짐)으로 열고 모달은 `Esc`로 닫는다(기존 모달 닫기 관례 재사용), I2 블루라이트 차단 테마=설정에서 선택하는 표시 설정(키 불요). 향후 대시보드 전용 단축키가 필요해지면 미사용 키 중 충돌 없는 것(예: `Ctrl+Shift+U` — 현재 미배정)을 후속 배정한다.
> **[2026-06-07] 신규 §J(US-9.x)의 단축키 영향**:
> - **J1 드래그 박스 선택**=마우스 동작(키 불요), **J2 패널 실시간 갱신**=자동 동작(키 불요), **J6 미리보기 폭 조절**=분할선 드래그(키 불요), **J7 즐겨찾기 별칭**=우클릭/`F2` 인라인 편집(기존 `F2` 재사용·신규 키 불요), **J5 미리보기 2단 뷰어**=기존 `Ctrl+P` 토글 재사용, **J4 브랜딩**=표시 명칭(키 불요).
> - **J3 Windows 보기 5종**은 우선 **아이콘바(H1) 보기 컨트롤 + 우클릭 "보기" 메뉴**로 전환한다(신규 단축키 없이 출시 가능). 단축키가 필요하면 Windows 탐색기 관례인 **`Ctrl+Shift+1`~`Ctrl+Shift+6`**(보기 모드 1~6)를 후속 배정한다 — 기존 표의 `Ctrl+1~9`(N번째 탭)는 `Shift` 없이 쓰이므로 `Ctrl+Shift+숫자`는 **충돌 없음**(현재 미배정). `Ctrl+1`류 단독은 탭 전환과 충돌하므로 보기 전환에 쓰지 않는다.
> **[2026-06-07] 신규 §K(US-10.x)의 단축키 영향**:
> - **K1 되돌리기**=**기존 `Ctrl+Z` 정식화**(신규 키 불요 — 이미 등록된 `file.undo` 키를 다단계 undo 동작에 연결). redo는 본 버전 범위 밖이라 `Ctrl+Y`/`Ctrl+Shift+Z` 등 redo 키는 **미배정**(후속 시 충돌 없는 키 배정).
> - **K2 휴지통 관리**=사이드바 "휴지통"/아이콘바 ④도구 그룹 버튼 진입(신규 단축키 불요·모달은 `Esc` 닫기 관례 재사용), **K3 유형별 비중**=I1 대시보드 내 표시(키 불요·대시보드 진입은 I1과 동일).
> **[2026-06-07] 신규 §L(US-11.1)의 단축키 영향**: **L1 그리드 이미지 썸네일**=아이콘 그리드 보기(J3)에서의 **자동 표시 동작**이라 신규 단축키를 요구하지 않는다(보기 전환은 J3 아이콘바/우클릭 "보기"로 이미 제공). 썸네일 표시 자체에 별도 키·토글이 없다.
> **[2026-06-08] 신규 §M(US-12.x 외부 연계)의 단축키 영향**: 신규 단축키를 요구하지 않는다. **M1 외부 D&D**=마우스 드래그(앱 바깥으로)로 기존 D&D 동작의 도착지 확장(키 불요), **M2 클립보드 외부 연계**=기존 `Ctrl+C/X/V`(파일) 재사용 — 동일 키가 외부 클립보드(CF_HDROP)와 양방향으로 작동(신규 키 불요·충돌 없음), **M3 FTP/SFTP 원격 접속**=사이드바 "원격" 섹션/메뉴 "원격 연결" 진입과 컨텍스트 메뉴(접속·업/다운로드)로 조작(신규 키 불요). 향후 원격 연결 전용 단축키가 필요해지면 미사용 키 중 충돌 없는 것을 후속 배정한다(현재 미배정).
> **[2026-06-08] 신규 §N(US-13.x 즐겨찾기 UX 향상)의 단축키 영향 — 구현 완료, 키 확정**: 신규 전역 단축키를 요구하지 않는다. **N1 즐겨찾기 경로 워터마크**=현재 패널 경로가 즐겨찾기와 일치할 때의 **자동 표시 동작**(키·토글 불요). **N2 즐겨찾기 드래그 정렬**=사이드바 즐겨찾기 항목의 **마우스 드래그**(주 동선·키 불요)이며, **접근성 키보드 대체수단**으로 즐겨찾기 항목 포커스 후 **`Alt+Shift+↑/↓`로 위/아래 한 칸 순서 이동**(설계·구현 확정 — 사이드바 즐겨찾기 포커스 한정)을 제공한다. **`Alt+Shift+↑/↓`는 전역 `KeyBindingRegistry`(`domain/keybindings`)에 미배정된 조합**이라 `KeyboardDispatcher` capture 단계가 가로채지 않고 Sidebar 로컬 핸들러(`altKey&&shiftKey&&!ctrl&&!meta` 가드)가 동작한다 — **키 조합 자체가 미사용이라 충돌 0**. 1차안 `Alt+↑/↓`는 기존 `Alt+↑`(=`nav.up`)와 충돌해 폐기(architecture-review-N [높음-1] 정정). **기존 표의 `Alt+←/→/↑`(뒤로/앞으로/위로)는 `Shift` 없이 쓰이므로 `Alt+Shift+↑/↓`와 충돌하지 않는다.** 별칭 편집(J7)에 쓰던 `F2`는 N2가 재사용하지 않는다(편집과 정렬은 별개 동선). ※ 한국어 IME가 `Alt+Shift`를 입력 언어 전환에 점유할 가능성은 낮으나 런타임 스모크에서 확인 권장(qa-integration-N [낮음-1]).
> **[2026-06-09] 신규 §O(US-14.1 파일/폴더 상단 고정)의 단축키 영향**: 신규 단축키를 요구하지 않는다. **O1 상단 고정/해제**=파일 목록 항목의 **컨텍스트 메뉴(우클릭) "상단 고정"/"상단 고정 해제" 토글**로만 조작한다(전용 단축키·툴바 버튼 미신설). 표식(📌)·최상단 표시는 자동(키 불요). 향후 고정 토글 전용 단축키가 필요해지면 미사용 키 중 충돌 없는 것을 후속 배정한다(현재 미배정).
> **[2026-06-10] 신규 §W(US-21.1 자세히 보기 컬럼 헤더·너비 조절)의 단축키 영향**: 신규 전역 단축키를 요구하지 않는다. **W1 컬럼 너비 조절**=컬럼 사이 분리자의 **마우스 드래그**(주 동선·키 불요)이며, **접근성 키보드 대체수단**으로 분리자에 포커스를 둔 상태에서 **방향키(←/→)로 너비를 한 단계씩 조절**한다 — 이 방향키 리사이즈는 **분리자(`role="separator"`)에 포커스가 있을 때만 동작하는 로컬 핸들러**로, 전역 `KeyBindingRegistry`(`domain/keybindings`)에 어떤 조합도 등록하지 않는다(전역 키 미배정·`KeyboardDispatcher` 미경유·기존 어떤 단축키와도 충돌 0). 헤더 레이블 표시·`이름` 컬럼 신축은 자동(키 불요).
> **[2026-06-10] 신규 §U4(US-20.4 탭 사용자 지정 이름)·§X(US-22.1 빠른 위치 ▸ 다운로드)의 단축키 영향**: 둘 다 신규 단축키를 요구하지 않는다. **U4 탭 이름 바꾸기**=탭 라벨 **더블클릭 인라인 편집**(Enter 확정·Esc 취소·blur 확정·빈 값 자동 제목 복귀) 또는 **탭 우클릭 "이름 바꾸기"** 로만 조작한다(전용 단축키 미신설·인라인 편집의 Enter/Esc는 편집 입력 컨텍스트 한정 로컬 처리·전역 `KeyBindingRegistry` 미등록·`KeyboardDispatcher` 미경유). **X1 빠른 위치 다운로드 이동**=사이드바 "빠른 위치 ▸ 다운로드" 항목 **클릭**으로 활성 패널 이동(즐겨찾기·드라이브 클릭 이동과 동일 동선·키 불요). 향후 전용 단축키가 필요해지면 미사용 키 중 충돌 없는 것을 후속 배정한다(현재 미배정).
> **[2026-06-12] 신규 §Y(US-23.1 Windows 셸 컨텍스트 메뉴 연동)의 단축키 영향**: 신규 단축키를 요구하지 않는다. **Y1 Windows 메뉴 항목 실행**=파일/폴더 **우클릭 컨텍스트 메뉴(B6) 하단의 "Windows 메뉴" 섹션 항목 클릭**으로만 조작한다(전용 단축키·툴바 버튼 미신설·기존 우클릭 동선 재사용). 셸 verb 조회·실행은 상주 PowerShell 워커 경유의 자동 처리이며 별도 키·토글이 없다. 향후 전용 단축키가 필요해지면 미사용 키 중 충돌 없는 것을 후속 배정한다(현재 미배정).
> **[2026-06-14] 신규 §Z(US-24.1~24.5 Agentic 자연어 파일 에이전트)의 단축키 영향**: 신규 전역 단축키를 **최소화**한다. **Z1 에이전트 진입**=**명령 팔레트(`Ctrl+Shift+P`·S2) "AI 에이전트 열기" 명령** 또는 **아이콘바 ④도구 그룹 버튼**으로 연다(기존 commandId/팔레트 수렴·신규 전용 키 미신설). 에이전트 패널은 모달/패널 닫기 관례(`Esc`)를 재사용하고, 자연어 입력은 입력창 포커스 컨텍스트의 로컬 처리(`Enter`=실행·전역 `KeyBindingRegistry` 미등록·`KeyboardDispatcher` 미경유)다. 플랜 diff 확인/실행·키 설정은 패널 내 버튼으로 조작한다(키 불요). 향후 에이전트 전용 단축키가 필요해지면 미사용 키 중 충돌 없는 것(예: `Ctrl+Shift+A` — 현재 미배정)을 후속 배정한다(현재 미배정·충돌 0).
> **[2026-06-09] 신규 §P~§U(US-15.x~US-20.x 파워 기능 14종)의 단축키 영향 — M6~M9 전부 구현 완료(R1=`Ctrl+Shift+R`·S2=`Ctrl+Shift+P`·U1=`Space` 실제 등록·Q1=더블클릭/우클릭·U3=탭 우클릭/드래그·신규 키 0) / §P~§U 14종 전부 완료**:
> - **신규 키 2개만 추가**(둘 다 미배정·충돌 없음·**M8 구현 완료(코드)·실 GUI 🟡**): **S2 명령 팔레트=`Ctrl+Shift+P`**(기존 Ctrl+P=미리보기와 `Shift` 유무로 구분·기존 Ctrl/Shift 조합 어디에도 미사용), **U1 Space 퀵룩=`Space`**(항목 선택 상태에서만 미리보기 오버레이·입력/이름편집/검색/오버레이 포커스 중에는 미발화로 타이핑과 충돌 회피). VS Code 등의 명령 팔레트 관례 키(`Ctrl+Shift+P`)와 일치.
> - **나머지 12종 키 배정**: P1 폴더 비교=아이콘바/우클릭 토글(신규 키 0·구현 완료), **R1 일괄 이름변경=`Ctrl+Shift+R`(구현 시 정식 등록·기존 미배정·충돌 0)** + 우클릭/아이콘바(`F2`는 단일 인라인 편집 유지·재사용 안 함), Q1 압축 열기=더블클릭/우클릭, R2 중복 찾기·R3 전송 큐·T2 폴더 용량·T3 프리셋(신규 키 0·아이콘바/PresetBar 드롭다운으로 구현 완료)·U2 브레드크럼 드롭다운=아이콘바/우클릭/주소 표시줄, R4 체크섬·S1 내용 검색=설정/검색 모드 토글, T1 태그=우클릭, U3 탭 색상/잠금/분리=탭 우클릭/드래그(**2026-06-14 동작 확장 U3 탭 루트 잠금도 신규 키 0** — 잠금=탭 우클릭·🏠 "잠긴 루트로 이동"=패널 툴바 버튼 클릭). 향후 각 기능 전용 단축키가 필요해지면 미사용 키 중 충돌 없는 것을 후속 배정한다.
> - **충돌 검증**: `Ctrl+Shift+P`·`Space`는 PRD 8장 기존 표 어느 행과도 매핑이 겹치지 않음을 확인했다(기존 Ctrl+Shift 조합=T/Tab/N/\\·Alt+Shift+화살표만 사용·`Space`는 미배정). `Space`는 활성 패널 항목 선택 컨텍스트에 한정해 기존 스크롤/체크 동작과 분리한다(설계 단계 정밀화).
> 단축키 사용자 정의는 Could 범위.

---

## 9. 가정

- 1차 타겟은 단일 사용자의 로컬 디스크/네트워크 드라이브(매핑된 경로) 사용.
- 사용자는 기존 탐색기 사용 경험이 있어 기본 멘탈모델을 공유한다.
- 시스템 아이콘/연결 프로그램(더블클릭 실행)은 OS 기본 동작에 위임한다.
- 사용량 대시보드 차트는 recharts(MIT 라이선스)로 그린다는 전제다(번들·라이선스 영향 검토 완료 — §10 R5). 디스크 드라이브 메타(총/사용/여유)는 OS API로 즉시 조회 가능하다고 가정한다.
- 최종 기술 스택/아키텍처는 아키텍트 단계에서 확정한다(본 문서는 기능·요구 중심).

---

## 10. 리스크

| # | 리스크 | 영향 | 대응 |
|---|---|---|---|
| R1 | 대량 파일 렌더 성능(수만~수십만) | 높음 | 가상 스크롤·증분 로딩 필수, 성능 기준 사전 검증(성능 목표: 3장·7장) |
| R2 | 패널 간 드래그&드롭 시 이동/복사 의도 구분 | 중 | 기본 규칙(같은 드라이브=이동, 다른 드라이브=복사) + 수정키로 강제 |
| R3 | 휴지통/롱패스/심볼릭링크 등 Windows 특수 케이스 | 중 | features.md F장 동작 규칙에 명시, QA 케이스화 |
| R4 | 사용량 대시보드 Top10 스캔이 수십만 파일에서 느리거나 UI를 막음 | 중 | **[2026-06-07 구조 대응 완료 ✅·실측 미완 🟡]** 백그라운드 워커 스캔(`scanWorker.ts`)·진행률 200ms 스로틀 갱신·취소 지원(SharedArrayBuffer)·UI 비차단 구현. 권한 거부 `skipped` 건너뛰기·심볼릭/정션 링크 realpath Set 순환 차단·`truncated` 상한으로 안정성 확보(verify:scan 28/0). 자동 팝업은 설정 토글(기본 켜짐)로 거슬림 방지. **수십만 파일 실측 성능은 런타임 스모크 권장(P7 성능 항목 연계)** |
| R5 | recharts 차트 라이브러리 도입에 따른 번들 증가 | 낮음 | **[2026-06-07 해소 ✅]** recharts 3.8.1 MIT 라이선스(상용 배포 제약 없음). `DashboardModalBody` **React.lazy로 831kB 별도 청크 분리** → 메인 번들(466kB) 비대화 없음. 빌드 성공 확인 |

---

## 11. 결정 기록 (Decision Log — 이전 미해결 질문 5건 확정)

> 이전 기획 단계에서 남긴 미해결 질문 5건을 모두 합리적 기본값으로 **확정**한다.
> 단축키 충돌(F5/F6)은 "질문"이 아니라 명세 내부 모순이었으므로 결함으로 분류해 8장 단축키 표에서 즉시 확정했다.

| # | 쟁점 | 결정 | 우선순위 | 근거 |
|---|---|---|---|---|
| **D1** | 4분할(2x2) MVP 포함 여부 | **MVP는 2분할까지. 4분할은 Should** | Should | 핵심 차별점(출발↔도착 2패널 작업)은 2분할로 충분히 검증된다. 4분할은 최소 패널 폭·포커스 순환 등 복잡도가 커 MVP 후로 미뤄 출시 속도를 확보. |
| **D2** | 미리보기 패널 MVP 포함 여부 | **Should (MVP 제외)** | Should | 핵심 가치(다중 디렉토리 작업)와 독립적인 부가 가치. 형식별 렌더러 비용이 커 1차 직후로 분리. 단축키(`Ctrl+P`)는 미리 예약. |
| **D3** | 세션 저장 범위 | **자동 세션 복원=Must, 명시적 워크스페이스 저장=Should** | Must / Should | "작업 이어가기"는 신뢰성의 기본이므로 자동 복원(정상·비정상 종료 모두)은 Must. 이름 붙여 저장/불러오는 명시적 워크스페이스는 고급 니즈라 Should. |
| **D4** | 패널 간 작업 단축키 충돌(F5/F6) | **포커스 이동=`Tab`/`Ctrl+←·→`, 새로고침=`Ctrl+R`.** ~~복사=`F5`, 이동=`F6`~~ → **2026-06-07 제거(사용자 결정)** | Must | 포커스 이동·새로고침 배정은 유지. **`F5`(복사)/`F6`(이동)은 2026-06-07 사용자 결정으로 제거**(사유: 일반 사용자에게 일반적이지 않은 단축키) — 패널 간 복사/이동은 D&D·클립보드(`Ctrl+C/X/V`)로 수행. 상세는 8장·§6·features §A3·§E1·US-1.3. |
| **D5** | 텔레메트리(사용 지표 수집) | **옵트인(기본 꺼짐). 동의 시에만 익명 집계 전송, 로컬 전용이 기본** | Should | 로컬 전용 제품 원칙과 프라이버시 존중. 성공 지표(3장)는 옵트인 사용자 표본 + 정성 피드백으로 보정. 미동의 시 외부 전송 전무. ※ **[2026-06-08] D5의 "로컬 전용" 중 임의 송신 금지·텔레메트리 옵트인 부분은 불변**이며, FTP/SFTP 원격 연결에 한한 네트워크 경계만 D7로 부분 개정됨(아래). |
| **D6** | FTP/SFTP 원격 접속 편입 + 자격증명 저장 방식 *(2026-06-08 신규 — 과거 Won't 정정)* | **§6 Won't였던 "FTP/SSH 등 원격 프로토콜 브라우징"을 정정·편입(§M·M3, Could).** 자격증명(비밀번호·키 패스프레이즈)은 **OS 자격증명 보관소(Windows Credential Manager/DPAPI)에만 저장·평문 저장 금지** | Could | **정직 기록**: 과거 이번 사이클 제외(Won't)였으나 **사용자 결정(2026-06-08)으로 정식 기능화**한다(§6 Won't에서 해당 줄 제거·변경 이력 명기). 핵심 차별점과 독립적이고 보안·복잡도가 커 우선순위는 Could. 비밀의 평문 저장은 데이터 유출 위험이 커 OS 보관소(DPAPI 계열)로 한정(설정/세션/로그 평문 금지). 평문 FTP는 비암호화 경고, SFTP/FTPS 암호화·호스트 키 확인. (features §M3·US-12.3, §7 보안) |
| **D7** | 로컬 전용 보안 원칙(D5)의 부분 개정 — 네트워크 경계 *(2026-06-08 신규)* | **"로컬 전용·외부 네트워크 전송 없음"을 M3에 한해 부분 개정**: 네트워크 연결·전송은 **사용자가 명시적으로 입력/저장한 원격 호스트로만** 허용. 그 외 임의 외부 송신 금지(텔레메트리 포함·D5 옵트인 원칙)는 유지 | Could(M3 종속) | **정직 기록**: FTP/SFTP(M3)는 본질적으로 원격 전송이 필요하므로 D5의 "로컬 전용"을 그대로 둘 수 없다. **사용자가 지시한 원격 호스트로의 전송만 허용**하고 그 외 임의 송신은 여전히 금지하도록 경계를 정밀화한다(원격 연결 ≠ 텔레메트리). 외부 D&D·클립보드(M1·M2)는 로컬 파일 경로 교환일 뿐 네트워크 송신이 아님(D7 비해당). (§7 보안·features §M) |
| **D8** | Agentic 에이전트 네트워크 경계·멀티 AI 제공자·내용 전송 *(2026-06-14 신규 — D7 추가 정밀화)* | **에이전트(§Z·Z1) 외부 송신은 사용자가 선택·활성화한 AI 제공자 엔드포인트로만**(Claude `api.anthropic.com`·OpenAI `api.openai.com`·**내부 자체 모델=등록된 OpenAI 호환 엔드포인트, base URL 화이트리스트로 SSRF 차단**). **BYO 키**(과금 사용자 책임)는 **safeStorage 암호화·평문/렌더러 노출 금지**. **파일 내용 전송은 명시 동의 게이트**(기본 경로·메타만). **읽기 자유 / 쓰기는 plan 적재만·confirm 후 휴지통·undo로만 실행**(영구삭제·원격·셸 도구 1차 미노출) | Could(Z1 종속) | **정직 기록**: 자연어 에이전트는 본질적으로 외부 LLM 호출이 필요하므로 D7을 한 단계 더 정밀화한다 — 임의 송신은 여전히 금지하되 사용자가 활성화한 제공자 엔드포인트만 허용한다. 내부 자체 모델은 임의 URL을 열면 SSRF 위험이 크므로 **base URL 화이트리스트**로만 허용한다(전면 개방 금지). BYO 키 평문 저장은 유출 위험이 커 safeStorage(DPAPI 계열)로 한정한다(D6 동형). 파일 내용의 무단 외부 전송을 막기 위해 기본은 경로·메타만 보내고 실내용은 작업별 명시 동의에서만 전송한다. LLM이 직접·즉시 파괴할 수 없도록 쓰기는 plan 적재만 하고 사용자 diff 확인 후 휴지통·undo 가능한 기존 파이프로만 실행한다(인젝션 내성). (§7 보안 D8·features §Z·user-stories 에픽24·ADR-014) |

> 위 결정은 6장 MoSCoW·8장 단축키·user-stories 수용 기준에 모두 반영되어 있다.
> **[2026-06-08] D6·D7은 §6 MoSCoW(M1·M2 Should·M3 Could)·§6 Won't 정정·§7 보안 절·features §M·user-stories 에픽12(US-12.x)에 반영되어 있다.**

---

## 12. 마일스톤 (제안)

> 상태: 2026-06-07 기준. 로드맵 Phase 매핑 — M1≈P0~P2 · M2≈P3~P4 · M3≈P5 · M4≈P7 · M5+≈P6.

| 단계 | 내용 | 산출물 | 상태 |
|---|---|---|---|
| M0 | 기획 확정·아키텍처 설계 | PRD/명세 확정, 기술 결정 | ✅ 완료 |
| M1 | 단일 패널 탐색 기반(목록/정렬/탐색/기본 조작) | 동작하는 탐색기 코어 | ✅ 완료 |
| M2 | 탭(복제 포함) + 2분할 패널 + 패널 간 이동/복사 + 충돌 해결 | 핵심 차별점 동작 | ✅ 완료 |
| M3 | 검색/필터, 즐겨찾기/최근, 진행률, 테마, 단축키, 상태바, 자동 세션 복원 | MVP 기능 완성 | ✅ 완료 |
| M4 | 안정화·성능 튜닝(1.5초/200ms 검증)·접근성·QA | **1차 릴리스** | 🟡 부분 (**헤드리스분 ✅**: 접근성 코드(`useFocusTrap`·모달 6종 ARIA/Esc·focus-visible·행 ARIA)·WCAG AA 4팔레트 전수·성능/F장 검증 하니스(`verify:perf`/`verify:fmatrix`)·npm audit 점검(릴리스 차단 아님)·sourcemap 분리·코드서명 설정·앱 아이콘·원클릭 인스톨러 빌드(`build-installer.ps1`)·**[2026-06-22] 자동 업데이트 도입(electron-updater·GitHub Releases·`autoUpdate.ts`·1.9.2 실 게시 완료)**. **런타임 잔여 🟡**: 성능 3종 실측·실제 코드서명(.pfx)·NSIS 설치/실행/제거 실측·자동 업데이트 실 설치본 왕복·F장 실케이스·실 스크린리더) |
| M5+ | 4분할·미리보기 패널·명시적 워크스페이스 저장·신규 UX(아이콘바·사이드바 토글·분할 크기조절·터미널 열기·경로 직접 입력·파일 유형 아이콘)·**분석·접근성(사용량 대시보드·블루라이트 차단 테마)**·**보기·실시간·뷰어·브랜딩(박스 선택·패널 실시간 갱신·보기 5종·AGT-Finder·미리보기 2단 뷰어/폭 조절·즐겨찾기 별칭)** 등 Should | 후속 릴리스 | 🟡 부분(P6: 4분할·미리보기·워크스페이스·텔레메트리·연결프로그램 열기 완료 + 신규 UX 6종(H1~H6) 완료 + **분석·접근성 2종(I1·I2) 완료** + **J장 7종(J1·J3·J4·J5·J6·J7 완료, J2 실시간 갱신도 보류 2건(선택/스크롤 보존·UNC 폴링 폴백) 구현 완료 + 매핑 네트워크 드라이브 `X:\` `GetDriveType` 연동(`os/driveType.ts`) 완료 ✅ — `subst`·일부 클라우드(`DriveType≠4`)만 미포함 한계)** + **K장 3종(되돌리기 K1·휴지통 관리 K2·유형별 비중 K3) 완료** + **L장 1종(그리드 이미지 썸네일 L1·신규 채널 `preview:thumbnail`) 완료** + 외부 연계(§M)·즐겨찾기 UX(§N)·상단 고정(§O)까지 사용자 기능 Should 잔여 0) **+ (2026-06-14 동작 확장 정식 편입) §M M3 원격 3건(연결 직후 서버 작업 디렉토리 진입·폴더 재귀 업로드·업로드 충돌 정책 배선·US-12.3/12.5)·§U U3 탭 루트 잠금(US-20.3) — 전부 기존 항목 동작 확장·MoSCoW 무변경·신규 채널 0·구현 완료(코드)·실 동작/실 GUI 🟡(상태 단일 출처 roadmap §0.5 2026-06-14 단락)** |
| 후속(M10) | **Windows 셸 컨텍스트 메뉴 연동(§Y·Y1·US-23.1, Should)** — 우클릭 메뉴에 "Windows 메뉴" 섹션 추가(셸 COM `FolderItem.Verbs()`/`verb.DoIt()`·상주 PowerShell 워커·신규 IPC 채널 `shell:context-verbs`/`shell:invoke-verb` 2종·신규 네이티브 의존성 0) | 후속 릴리스 | ✅ 구현 완료(코드)·통합 QA PASS(2026-06-12·`verify:shellverbs` 99/0[단일+다중 선택 확장 + 2026-06-28 "Windows 메뉴 ▸" 단일 하위 메뉴화 반영]·build PASS)·실 GUI/실 패키지 런타임 스모크 🟡 |
| 후속(M12) | **드라이브 연결/해제(토폴로지 변경) 자동 갱신(§J8·US-9.8, Should)** — USB 등 이동식/네트워크 드라이브 연결·해제(`WM_DEVICECHANGE`) 감지 → 사이드바·"내 PC"·대시보드 드라이브 목록 자동 재열거(1.2초 디바운스·신규 푸시 evt `fs:drives-changed`·신규 invoke 채널 0·신규 npm/네이티브 의존성 0·Windows 내장 `hookWindowMessage`). 2026-06-30 비계획 구현(roadmap §0.5 스코프 일탈 플래그) → 사용자 정식 편입 | 후속 릴리스 | 🟡 구현 완료(코드)·`verify:store` 296/0·`verify:persistence` 147/0·build PASS / 실 USB 물리 연결·해제→실 GUI 자동 갱신 런타임 스모크 권장 🟡 |
| 후속(M13) | **새 창(현재 위치 복제) `Ctrl+N`(§U5·US-20.5, Should)** — 탐색기 관례 `Ctrl+N` → 활성 탭 스냅샷으로 새 창 생성(현재 위치 복제·소스 탭 유지·§U3 탭 분리=탭 이동과 별개). 기존 `window:split-tab` 재사용(**신규 IPC 채널 0**)·신규 npm 의존성 0·렌더러 전용(main 무변경)·명령 팔레트/단축키 도움말 자동 노출. 2026-07-14 비계획 구현(roadmap §0.5 스코프 일탈 플래그) → 사용자 정식 편입 | 후속 릴리스(v1.15.0 게시) | 🟡 구현 완료(코드)·v1.15.0 GitHub Releases 게시(커밋 `acc30bf`)·typecheck(node+web) PASS·ESLint 0·`verify:palette` 20/0·`verify:domain` 215/0·`verify:store` 296/0 / **실 GUI(`Ctrl+N` → 새 창 표출) 런타임 스모크 권장 🟡 · 새 창은 세션 자동저장 미참여(재시작 복원 안 됨·§U3 한계 승계)** |
| 후속(M11) | **Agentic 자연어 파일 에이전트(§Z·Z1·US-24.1~24.5, Could)** — 자연어 지시 → 읽기 도구 자율 탐색 → plan diff 확인·부분 수용 → 기존 `op:*`(휴지통·undo) 실행. **멀티 AI 제공자(Claude/OpenAI/내부 OpenAI 호환 엔드포인트)·BYO 키 safeStorage·내부 base URL 화이트리스트 SSRF 차단·1차 로컬/휴지통 한정·내용 전송 명시 동의·비용 상한.** 읽기 자유/쓰기 스테이징·신규 IPC 채널 `agent:*`·신규 npm 의존성 `@anthropic-ai/sdk`+`openai`(네이티브 0)·`SESSION_SCHEMA_VERSION` 무변(에이전트 상태 휘발). 설계 ADR-014/015·`docs/architecture/agent-natural-language-design.md`·매핑 traceability §1-Z | 후속 릴리스(PoC) | **읽기 전용 범위(US-24.1·24.3·24.4·24.5) 구현 완료(코드)·실 동작 🟡 / 쓰기(US-24.2 plan·실행) 🔜 deferred**(verify:agent 225/0·2026-06-14 `open_tab` 내비 도구 추가로 201→225·도구 8종=읽기 7종+`open_tab`[비파괴 내비·파일 쓰기 아님]·상태 단일 출처 roadmap §0.5) |

### 파워 기능 14종(§P~§U) 마일스톤 (제안 — M6~M9 전부 구현 완료(코드)·실 GUI 🟡 / **§P~§U 14종 전부 완료**)

> **[2026-06-09 신규]** 타 탐색기 차별화 파워 기능 14종을 **의존성·가치·위험** 기준으로 4단계(M6~M9)로 묶어 구현 순서를 제안한다. 묶음 원칙: ① **강력 차별화 + 기존 인프라 직접 재사용** 항목을 먼저(M6), ② **공통 인프라(워커 해시·전송 큐·grep 워커)를 먼저 깔아야 하는** 무거운 작업을 그다음(M7), ③ **per-경로 메타·표시 UX**처럼 경량·독립 항목을 병렬로(M8), ④ **멀티 윈도우 등 복잡도 큰 Could**를 마지막(M9). 단계 내 순서는 의존성 우선. **상태(2026-06-10): M6·M7·M8·M9 전부 구현 완료(코드)·실 GUI/실 워커 🟡(M7에서 P1 해시·재귀 확장·R2·R3·R4 구현 — 공용 해시 W1·전송 큐 W2 인프라 포함 / M8에서 S1 내용 검색 grep·S2 명령 팔레트·T1 파일 태그·T2 폴더 용량·U1 Space 퀵룩·U2 브레드크럼 드롭다운 구현 / M9에서 Q1 압축파일 `archive://` 어댑터·U3 탭 색상/잠금·탭 분리(새 창) 구현). T3은 폐기(제거). 개발 잔여(🔜)는 0 — §P~§U 14종 전부 완료(M6~M9 종료). 남은 것은 P7 런타임(성능 실측·코드서명·NSIS) + 보류 백로그(B2·I5~I7).**

| 단계 | 묶음(기능) | 묶음 근거 / 의존성 | 우선순위 | 상태 |
|---|---|---|---|---|
| **M6** (차별화 코어·기존 인프라 재사용) | **P1 폴더 비교(메타·단일깊이) · R1 고급 일괄 이름변경 · ~~T3 정렬/필터 프리셋~~(폐기)** | 모두 **강력 차별화/파워 핵심**이면서 **기존 인프라를 직접 재사용**해 선행 의존이 적다 — P1=분할 패널(A2)·D&D(A3)·충돌(D4)·되돌리기(K1), R1=일괄 작업(E3)·되돌리기(K1)·이름변경 안전(B3). ~~T3=정렬(B2)·필터(D2)·세션 영속(E).~~ 가시적 차별화를 가장 빠르게 확보. **P1의 해시 옵션은 M7의 해시 워커 도입 전엔 메타 비교만으로 우선 출시 가능**(해시는 M7에서 켜기) | Should | ✅ P1·R1 구현 완료(코드)·통합 검증 PASS(2026-06-09) / 실 GUI 🟡 · P1 해시·재귀 M7 연기 🔜 · **❌ T3 폐기(2026-06-09 사용자 결정·코드 제거)** |
| **M7** (공통 무거운 인프라 — 해시·워커·큐) | **R2 중복 찾기 · R3 전송 큐 매니저 · R4 복사 시 체크섬 검증 · (공용 해시 W1·전송 큐 W2 인프라 · P1 해시·재귀 확장)** | **공통 백그라운드 인프라(워커 해시 엔진·대량 스캔·통합 큐)** 를 깔아야 하는 무거운 묶음. R2(해시)·R4(해시)는 **공용 해시 워커**를 공유하고, R3은 기존 `op:*`/`remote:*`를 통합 큐로 묶어 R2/R4의 진행률·취소·동시성을 일관되게 수용한다. **M6 P1 해시 옵션이 이 단계의 해시 워커에 연결됨(P1 해시·재귀 확장 구현).** R4는 Could라 단계 내 후순위 | Should(R4=Could) | ✅ 구현 완료(코드)·통합 검증 PASS(2026-06-09·신규 채널 `hash:*`/`queue:*`·신규 의존성 0·`verify:hash` 46·`verify:queue` 47) / 실 워커·실 GUI 🟡 |
| **M8** (경량·독립 메타/표시·빠른 보기 UX) | **S1 내용 검색(grep) · T1 파일 태그/색상 라벨 · T2 폴더 용량 인라인 · S2 명령 팔레트 · U1 Space 퀵룩 · U2 브레드크럼 드롭다운** | 서로 의존이 적고 **경량·독립적**이라 병렬 진행 가능. S1 grep은 검색/표시 UX 묶음(워커/취소 패턴은 기존 검색 인프라 재사용), T1=per-경로 메타(J7/O1 패턴 재사용), T2=I1 `scanEngine` 재사용(M7 인프라와 무관하게 가능), S2=commandBus 수렴(명령 메타만), U1=미리보기(D3/J5) 재사용, U2=브레드크럼(C1) 확장. 신규 단축키 2개(`Ctrl+Shift+P`·`Space`)는 이 단계에서 등록 | Should | ✅ 구현 완료(코드)·통합 검증 PASS(2026-06-10·S1 신규 채널 `search:content:*` 5종·나머지 5종 신규 채널 0·신규 의존성 0·`verify:search` 58·`verify:palette` 20·`verify:contentsearch` 38) / 실 GUI·실 워커 🟡 |<!-- 변경: S1 grep을 M7→M8로 이동. 설계(ADR-010)에서 M8(경량 검색·표시 UX 묶음)로 확정 — 2026-06-09 설계 정합 -->
| **M9** (차별화 확장·복잡도 큰 Could) | **Q1 압축파일 폴더처럼 열기 · U3 탭 색상/잠금·탭 분리** | Q1은 강력 차별화지만 **`archive://` 어댑터(M3 RemoteAdapter 패턴 차용)·압축 라이브러리·Zip Slip 보안** 설계가 무거워 안정화 후가 안전(추출은 M7 큐·진행률 재사용). U3은 **멀티 윈도우(BrowserWindow 다중)·세션 복원·IPC 라우팅** 복잡도가 가장 커 마지막 Could. 두 항목 모두 1차 핵심 차별화(M6)와 독립 | Q1=Should·U3=Could | ✅ 구현 완료(코드)·통합 검증 PASS(2026-06-10·Q1 신규 채널 `archive:*` 5종·신규 의존성 `yauzl`+`yazl`·`verify:archive` 56·`verify:archiveui` 43·ADR-008 / U3 신규 채널 `window:split-tab`/`window:get-init` 2종·색상/잠금=세션 메타 신규 채널 0) / 실 GUI·실 워커·멀티윈도우 🟡 — **M9 잔여 0·§P~§U 14종 전부 완료** · **(2026-06-14 동작 확장 정식 편입·2026-06-15 패널별 결함 수정) U3 탭 잠금 "루트 잠금"(패널별 맵 `Tab.lockedRoots`·각 분할 패널이 자기 경로로 독립 잠김·잠긴 루트 밖 이동 차단·🏠 복귀 버튼·세션 영속·구버전 단일값 하위호환·신규 채널 0·SCHEMA 무변·Could 무변경) — 구현 완료(코드)·실 GUI 🟡** · **(2026-06-18 동작 확장 2건) U3 탭 색상 전체 배경+파스텔 웜/쿨/중립 팔레트(전용 `tabColors.ts` 12색)·탭 드래그 아웃→경량 compact 창 분리(`WindowMode` 비파괴 확장·신규 채널 0)·구현 완료(코드)·실 GUI 🟡·⚠️ "드래그 아웃→경량 compact 창"은 US-20.3 수용기준 미명시 신규 동작/창 종류·정식 편입 결정 대기(roadmap §0.5 2026-06-18 단락)** |

> 단계 경계는 가치/위험 기준 제안이며, 실제 묶음·순서는 chief-architect 설계(공용 해시 워커·통합 큐·`archive://` 어댑터 ADR)에서 확정한다. M6~M9는 기존 M0~M5와 별개 트랙(후속 릴리스).
