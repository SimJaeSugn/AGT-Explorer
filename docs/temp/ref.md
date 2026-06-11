## 아이디어 백로그 


## 버그리포트
- 대용량 파일 복사시 전송큐를 열어 일시정지 했는데도 우측하단의 파일작업에서는 계속 작업이 진행된다.( 전송큐에서 멈췄던 작업제계하면 처리량 프로그래스바가 실시간 동기화되지 않는다. ) → **보류**: 설계 한계(파일 경계 일시정지만·진행 중 단일 파일/청크 미반영·일시정지 중 진행률 푸시 차단). 청크 단위 재개대기 + 일시정지 중 진행률 유지 구조개선 필요.

## 처리됨 (2026-06-11)
- ✅ 설정 팝업 좌우 2단 구성(좌 카테고리 / 우 항목) — 레이아웃·시스템·워크스페이스·단축키 4개 카테고리 (SettingsDialog 재구성)
  - 레이아웃: 테마 + **단축아이콘(신규)** — 상단 아이콘바에 표시할 기능을 그룹별 체크박스로 선택 + "기본값 초기화"
  - 시스템: 기본시작위치·숨김/시스템·확장자·최근개수·시작시 대시보드·복사후 체크섬
  - 워크스페이스: 관리 본문 임베드(기존 워크스페이스 팝업과 **동일 기능** — 저장/불러오기/이름변경/삭제/선택해제). 독립 팝업(WorkspaceDialog) 폐지·삭제.
  - 단축키: PRD §8 목록 인라인 표시(ShortcutHelp 읽기 API 재사용)
  - ✅ 워크스페이스 아이콘(🗂)·상태바 칩 클릭 → 설정 워크스페이스 페이지로 딥링크 연동(`openSettings('workspace')`·`settingsCategory` 스토어 단일 출처). 단축키(❓) 아이콘은 종전 도움말 유지.
- ✅ 상단 아이콘바 아이콘 위치 드래그 변경 — id 기준 전체 순서 재구성·숨김 위치 보존·`settings:set iconBarOrder` 영속 (IconBar 드래그 + resolveIconBarItems)
- ✅ 빠른 위치에 "바탕화면" 추가 — knownFolders.desktop 노드(백엔드는 이미 제공) (Sidebar 빠른 위치)
- ✅ 휴지통 비우기 대용량 실패 — 항목별 COM DoIt 루프(6000여 항목 15초 타임아웃) 제거 → Win32 SHEmptyRecycleBin 벌크 + 항목수 기반 성공판정(반환코드 0x8000FFFF 오판 수정)·타임아웃 120s. 실측 exit 0·464ms 검증 (recycleBin.ts)
- ✅ 단축아이콘 체크박스 토글 시 "설정 저장 실패" 토스트 — settings:set zod 가드(.strict())에 iconBarHidden/iconBarOrder 누락 → 허용 추가 (guard.ts)
- ✅ 우측 패널에서 Esc 누르면 포커스가 생김 — Esc는 포커스를 해제(blur)하도록(그리드 onKeyDown) + 비-단축키 키 입력 시 그리드 포커스 링 미표시([role=grid]:focus-visible outline 제거)
- ✅ 새로고침 단축키 F5로 변경 (Ctrl+R → F5, Windows 탐색기 관례) (keybindings)
- ✅ 검색(Ctrl+F) 후 목록 클릭 시 단축키 먹통 — 클릭 시 inputContext 'list' 복귀 (FileListView 포인터다운)
- ✅ 스크롤 후 하위폴더 진입 시 빈 화면 — 경로 변경 시 가상스크롤 scrollTop(로컬·DOM·store) 0 리셋 (FileListView)
- ✅ 고급 일괄 이름변경 한글 찾기 안 됨 — 조합 인지 ImeInput(조합 중 onValue 보류·종료 시 커밋)으로 찾기/바꾸기/접두/접미 교체 (BatchRenameDialog)

## 처리됨 (2026-06-10)
- ✅ 디렉토리 유형별 아이콘 — 일반 폴더=공유 표준 폴더 아이콘(`__dir__`), 링크(정션/심볼릭) 폴더=표준 폴더+바로가기 화살표 오버레이(OSIcon). 링크는 `__dir__` 오염 방지로 요청 스킵 (이전 특수폴더 경로별 OS아이콘은 아이콘 뒤섞임으로 폐기)
- ✅ 휴지통 복원/비우기 오류 — 동사 부분매칭·전역 Stop 제거·항목별 격리·한글 인코딩(UTF-8) (recycleBin.ts)
- ✅ 다중 선택 드래그 고스트에 다중선택 느낌(2줄 카드 + 스택, setDragImage) (I5 — useDrag/DragOverlay)
- ✅ 새 탭 시작 위치: 기본 위치 있으면 그곳, 없고 워크스페이스 있으면 피커로 선택 → 그 위치에서 새 탭(세션 비파괴) (I6 — newTab usecase + NewTabPickerDialog)
- ✅ 설정의 단축키 정보 분리 → 도움말(❓) 아이콘/F1 으로 표시 (I7 — IconBar help.shortcuts + Settings 목록 제거)
- ✅ 설정의 익명 사용 통계 도움말 추가 (I8 — SettingsDialog 설명 보강)
- ✅ F11/F12 등 브라우저 기반 단축키 차단(앱 사용 단축키는 통과) (I9 — KeyboardDispatcher)
- ✅ 기본 시작위치 설정해도 새 탭이 그 위치로 시작 안 됨 ("E:" → "E:\\" 보정 포함) (B1 — tabsSlice.newTab)
- ✅ 미러 복사 시 목적지 루트에 파일 평탄화(이상한 파일) — 재귀 비교 구조 보존 (B3 — op:start baseDir)
- ✅ 대량 삭제 완전삭제 팝업 시 작업패널 실패 로그가 오류처럼 보임 — 폴백 시 실패 op 제거 (B4 — operationsBridge)
- ✅ 영구삭제 EPERM(읽기전용/정션)·ENOENT(asar)·EACCES(소켓) 견고화 + 일시적 잠금 재시도 (engine forceRemove)
- ✅ 사용 중(잠긴) 파일은 오류 아닌 "사용 중(건너뜀)"으로 별도 분류 (OpSummary.inUse)
- ✅ 자동링크: 폴더를 다른 위치로 복사 + 원본 백업 후 원본자리 정션(권한 불필요) (V10)
- ✅ 워처 갱신 시 화면 깜빡임 제거(옛 목록 유지 → 원자 교체) (panelsSlice reload 버퍼)
