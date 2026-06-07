# 아키텍처 설계 독립 검증 보고서 — Explorer

> 검증자: 독립 Reviewer(제3자) · 2026-06-06 · 회차: 1
> 대상: system-architecture.md · software-architecture.md · directory-structure.md · ADR-000~006 · traceability.md
> 기준: PRD.md(8장 단축키·11장 D1~D5·7장 비기능) · features.md(A~F) · user-stories.md(US-1.1~5.8)

---

## 판정: **FAIL** (조건부 — High 2건 + Med 5건 반영 후 PASS 가능)

전체 설계 품질은 높다. 프로세스/보안 모델, IPC 계약 스타일, 가상화·스트리밍 성능 설계, 계층 분리와 ESLint 경계 강제, ADR의 대안 비교는 모두 충실하고 근거가 있다. 그러나 **Must 기능(생성/이름변경)의 IPC 계약 누락**과 **추적성 표의 D-코드 의미 충돌**이라는 구조적 결함이 있어, 그대로 1차 구현에 들어가면 핵심 작업 경로 하나가 미정의 상태로 남는다. 아래 High 항목을 반영하면 통과 가능하다.

---

## 항목별 평가 (체크리스트 1~7)

### 1. 추적성 — **부분 미흡**
- 24개 핵심 기능 대부분이 컴포넌트·유스케이스·IPC·ADR로 매핑됨. 탭/분할/패널간이동/검색/미리보기/세션복원/성능 목표 모두 본문 설계와 연결되어 "유령 매핑"은 대체로 없음.
- **그러나 결함 2건**:
  - (R1, High) **생성·이름변경(US-2.2/B3, Must)의 IPC 채널이 표에는 있다고 적혀 있으나 실제 계약(SA 3.2)에 없음** → 유령 매핑. 상세는 반영항목 R1.
  - (R2, Med) **B6(실행/열기), E6(설정)이 추적성 표 1절에 독립 행으로 없음.** `shell:open/open-with/show-properties`, `settings:get/set` 채널은 SA에 존재하지만 features 항목과 표로 연결되지 않아 추적이 끊김. (테마 행이 settings 일부만 커버)

### 2. 기술 선정 근거 — **양호**
- ADR-001~006 모두 대안 비교표 + 결정 + 근거 + 트레이드오프 구조를 갖춤. 빌드(electron-vite vs Forge/webpack), 상태관리(Zustand vs Redux/Jotai/Context), IPC(RPC+이벤트 vs 단일디스패처/자동프록시/protobuf), 가상화, 프로세스/보안, 패키징 전부 근거 있음. 근거 없는 단정은 발견되지 않음.
- (R3, Low) ADR-002가 "Immer 런타임 비용"을 트레이드오프로 인정하면서 동시에 고빈도 슬라이스(selection '매우 높음', operations '높음')에 Immer 적용을 전제. "고빈도 경로는 수동 업데이트"라는 단서는 있으나 어떤 슬라이스를 Immer 제외할지 기준이 없음 → 결정 가능한 형태로 명시 권장.

### 3. 프로세스/보안 모델 — **양호**
- contextIsolation/sandbox/nodeIntegration:false/webSecurity, Main 전용 FS, contextBridge 메서드 단위 노출, 양단(Preload+Main senderFrame+zod) 검증, 경로 정규화·`..` 차단, CSP, 네트워크 차단 기본 — Electron 모범사례에 정합. Renderer가 직접 FS 접근하는 경로 없음(ESLint로 `node:*` import 금지까지 강제).
- IPC 계약이 권한오류(Result/FileOpError), 취소(op:cancel/fs:list:cancel/AbortSignal), 진행률 스트리밍(op:progress 200ms 스로틀)을 일관되게 다룸.
- (R4, Med) **`shell:open`(연결 프로그램 실행)의 인자 검증 규칙이 보안 절(SA 3.3)에서 누락.** 임의 경로 실행은 RCE 인접 위험 — 경로 정규화·화이트리스트 규칙이 `op:*`/`fs:*`엔 명시됐으나 `shell:open`/`shell:open-with`에는 별도 언급 없음.

### 4. 성능 설계 실현성 — **양호**
- 첫 렌더 1.5초: fs:list:start→chunk 스트리밍 + 첫 청크 즉시 렌더(스피너 해제) + 윈도잉. 병목을 "전체 스캔이 아닌 첫 표시 시점"으로 정확히 짚음. 실현 가능한 구조.
- 진행률 200ms: Worker 보고 → Main 200ms 스로틀 합산 → 이벤트 푸시. 합리적.
- (R5, Med) **검색 입력 200ms 목표의 "1만 개 폴더" 동시 충족 근거가 약함.** SW 6.3은 메모이즈+deferred/transition로 충족 "목표"라고만 하고, Web Worker 오프로드는 "확장 여지(M1 측정 후)"로 미룸. US-4.1 수용기준은 200ms를 MVP 필수로 못박음 → 1만 개에서 메인스레드 필터가 200ms를 깨면 MVP 미달. 측정 실패 시 폴백(가상 스크롤 가시영역만 우선 필터 등)을 결정 가능한 형태로 명시 필요.

### 5. 추상화/계층 일관성 — **양호**
- 도메인↔앱↔인프라↔UI 의존 방향이 SW 3.1과 DS 5장(ESLint 규칙)에서 일관. 디렉토리 구조(domain/app/infra/ui + shared)가 계층을 그대로 반영. 도메인 모델(Window→Tab→Layout→Panel→DirectoryView)이 PRD 5-1 용어 사전·features A2와 일치.
- (R6, Low) SW 도메인 모델은 `closedHistory`를 **Tab 엔티티**에 둠(SW 2.1, 라인 31 "(창 수준) 닫은 탭 복원 스택")인데 주석은 "창 수준"이라 명기 → 엔티티 배치(Tab)와 주석(창 수준)이 상충. 닫은 탭 복원은 창 단위가 맞으므로 `Window`로 이동 권장.

### 6. 구현 가능성/리스크 — **양호**
- 미해결 질문 3건(Worker 모델/Undo 영속 범위/썸네일 위치) 모두 의사결정 가능한 형태이고 1차 구현(M1 단일 패널)을 막지 않음. Worker 모델은 M1 스파이크로, Undo·썸네일은 Should 착수 시점으로 미룬 것이 타당.
- (R1과 연결) 단, 생성/이름변경 IPC 누락은 "미해결 질문"이 아니라 **빠진 설계 영역**이므로 1차 구현 전 메워야 함.

### 7. 내부 일관성 — **부분 미흡**
- IPC 채널명·도메인 용어·디렉토리명은 문서 간 일관(fs:list:*, op:*, session:*, workspace:* 등 교차 확인 일치).
- (R7, High) **추적성 표에서 "D3" 코드가 두 의미로 혼용.** SA/features의 D3(미리보기 패널)과 PRD 11장 결정기록 D3(세션 저장 범위)가 같은 표에서 구분 없이 쓰임:
  - 라인 26 "미리보기 패널 (US-4.3, **D3**, S)" → features D3
  - 라인 32 "자동 세션 복원 (US-5.5, **D3**)" / 라인 34 "명시적 워크스페이스 (US-5.8, S, **D3**)" → PRD 결정 D3
  같은 표에서 동일 코드가 다른 대상을 가리켜 추적 신뢰성을 훼손.
- (R8, Med) **`panel.focusNext` vs `focusDir` 매핑이 문서 간 불일치.** SW 7.2는 `Tab → panel.focusNext`만 정의(`Ctrl+←/→` 누락). traceability 라인 48은 `Tab, Ctrl+←/→ → panel.focusNext/focusDir`로 `focusDir`를 새로 도입. traceability 라인 14(2분할 행)는 `panel.focusNext`만 표기. `Ctrl+←/→`의 commandId가 SW 본문에 정의되지 않아 단일 출처(keybindings 맵)와 불일치.

---

## 반영(수정) 항목 목록

### R1 — 생성/이름변경 IPC 계약 누락 (유령 매핑) · **High**
- **무엇이**: US-2.2/B3(새 폴더 `Ctrl+Shift+N`, 새 파일, 이름변경 `F2`)는 Must인데, 이를 수행할 FS IPC 채널이 정의돼 있지 않다. SA 3.2 채널 카탈로그에 `fs:mkdir`/`fs:create`/`fs:rename` 류가 없고, `op:*`는 copy/move/delete/trash만 다룬다.
- **어느 문서**: system-architecture.md §3.2(채널 카탈로그) — 누락 / traceability.md 라인 18(생성·이름변경 행이 `op:trash, op:delete`만 적어 생성·이름변경을 커버하는 것처럼 보임 → 유령 매핑).
- **왜 문제**: Must 기능의 핵심 실행 경로가 계약 미정의. keybinding(`file.newFolder`/`file.rename`)은 존재하나 도달할 Main 핸들러가 없어 1차 구현 착수 시 즉시 막힘. 추적성 표는 "매핑 완료"라 주장하나 실제 본문엔 없음.
- **어떻게**: SA §3.2 "디렉토리/메타" 또는 신설 "파일 기본조작(단발)" 그룹에 `fs:mkdir(req:{ parentDir, name }) -> Result<FileEntryDTO, FileOpError>`, `fs:create-file(req:{ parentDir, name, template? })`, `fs:rename(req:{ path, newName }) -> Result<FileEntryDTO, FileOpError>` 추가(금지문자·중복명 오류를 FileOpError로 전파). traceability 라인 18 IPC 칸에 이 채널들을 반영. DS의 `fs.handlers.ts` 책임 주석에도 생성/이름변경 추가.

### R2 — B6(실행/열기)·E6(설정) 추적성 행 누락 · **Med**
- **무엇이**: features B6(더블클릭 실행, Enter 열기, 연결 프로그램 선택 S, OS 속성창)과 E6(설정 — 시작위치/숨김·확장자 표시/최근 개수)이 traceability §1 기능 매핑표에 독립 행으로 없다.
- **어느 문서**: traceability.md §1.
- **왜 문제**: `shell:open/open-with/show-properties`, `settings:get/set` 채널은 SA에 존재하지만 features 요구와 표로 연결되지 않아 "이 기능이 어디서 실현되는가" 추적이 끊긴다. 특히 B6는 Must(US 미부여이나 features Must).
- **어떻게**: §1 표에 "파일 실행/열기(B6)" 행(컴포넌트: FileListView 더블클릭/컨텍스트메뉴, usecase: open usecase, IPC: shell:open/open-with/show-properties)과 "설정(E6)" 행(uiSlice/settings usecase, settings:get/set) 추가. 테마 행과 설정 행의 경계도 정리.

### R7 — 추적성 표 D-코드 의미 충돌 · **High**
- **무엇이**: 동일 traceability §1 표에서 "D3"이 features-D3(미리보기)와 PRD결정-D3(세션 범위) 두 의미로 혼용. D1/D2도 features 코드와 PRD 결정코드가 충돌할 소지(features D1=검색, PRD D1=4분할).
- **어느 문서**: traceability.md 라인 24·26·32·34·38.
- **왜 문제**: 추적성 문서의 본분은 무결한 참조인데, 같은 표에서 같은 코드가 다른 대상을 가리켜 독자가 근거를 오인한다. 검증 자동화/리뷰 시 오추적.
- **어떻게**: 코드 네임스페이스를 분리 표기한다. features 코드는 `F:D3`(또는 `feat-D3`), PRD 결정기록은 `PRD-D3`(또는 `결정D3`)로 접두. 표 상단에 범례 1줄 추가("F:Xn=features 영역코드, PRD-Dn=PRD 11장 결정기록"). 최소한 라인 26 미리보기는 `feat-D3`, 라인 32/34는 `결정D3`, 라인 38은 `결정D5`, 라인 24 검색은 `feat-D1`로 명시.

### R8 — focusNext/focusDir commandId 불일치 · **Med**
- **무엇이**: `Ctrl+←/→`(보조 포커스 이동, PRD 8장 Must)의 commandId가 SW 본문(7.2)에 없고, traceability에서만 `focusDir`로 등장. SW는 `Tab→panel.focusNext`만 정의.
- **어느 문서**: software-architecture.md §7.2 표(라인 267) / traceability.md 라인 48·14.
- **왜 문제**: keybindings 맵을 "단일 출처"로 천명(SW 7.1)했는데 정작 보조 포커스 키의 commandId가 본문에 정의되지 않아 단일 출처가 불완전. 문서 간 명칭(focusNext/focusDir) 불일치.
- **어떻게**: SW 7.2 대표 매핑 표에 `Ctrl+←/→ → panel.focusDir(dir)` 행 추가하고, traceability 라인 14·48과 명칭 통일. `panel.focusNext`(Tab=순환)와 `panel.focusDir`(방향 지정)의 의미 구분을 1줄 명시.

### R4 — shell:open 경로 검증 규칙 누락 · **Med**
- **무엇이**: `shell:open`/`shell:open-with`(임의 경로 실행)에 대한 입력 검증·화이트리스트 규칙이 보안 절에 없다.
- **어느 문서**: system-architecture.md §3.3(IPC 보안 규칙) / ADR-005.
- **왜 문제**: 임의 경로/인자 실행은 가장 민감한 표면. `op:*`/`fs:*`엔 경로 정규화·`..` 차단이 명시됐으나 쉘 실행 계열엔 누락 → 방어 심층의 빈틈.
- **어떻게**: §3.3에 "쉘 실행 계열은 경로 정규화 + 존재·권한 확인 후 OS 위임만 하고, 인자 주입(명령행 조립) 금지, `shell.openPath`/`openExternal` 사용 시 프로토콜 화이트리스트 적용" 규칙 1항 추가.

### R5 — 검색 200ms × 1만개 동시 충족 폴백 부재 · **Med**
- **무엇이**: US-4.1 수용기준(입력 후 200ms 점증 필터, Must)을 1만 개 목록에서 메인스레드 메모이즈만으로 보장한다는 근거가 약하고, 실패 시 폴백이 "확장 여지"로만 열려 있음.
- **어느 문서**: software-architecture.md §6.3 / §10 미해결 1.
- **왜 문제**: MVP 필수 수용기준인데 충족 실패 시 대응이 결정되지 않아 M4 성능 검증에서 리스크.
- **어떻게**: §6.3에 측정 임계 미달 시 폴백을 명시(가시영역 우선 필터 → 전체는 비동기, 또는 경량 Web Worker 오프로드). M1 성능 스파이크에 "1만 개 필터 200ms" 측정 항목을 명시적으로 포함.

### R3 — Immer 적용 슬라이스 기준 부재 · **Low**
- **무엇이**: ADR-002가 Immer 런타임 비용을 인정하면서 고빈도 슬라이스(selection 매우높음/operations 높음)에도 일괄 적용 전제. "수동 최적화" 단서만 있고 적용 기준 없음.
- **어느 문서**: ADR-002 트레이드오프 / SW §5.2.
- **왜 문제**: 가상 스크롤·진행률 고빈도 경로에서 Immer가 성능 목표를 위협할 수 있는데 제외 기준이 없어 구현자 임의 판단에 맡겨짐.
- **어떻게**: "고빈도 경로(selectionSlice의 선택 토글, operationsSlice 진행률 머지)는 Immer 미적용 수동 set" 같은 기준 1줄을 ADR-002 또는 SW 5.2에 명시.

### R6 — closedHistory 엔티티 배치 모순 · **Low**
- **무엇이**: `closedHistory`가 Tab 엔티티 필드로 정의되나 주석은 "(창 수준)"이라 명기.
- **어느 문서**: software-architecture.md §2.1 라인 31.
- **왜 문제**: 닫은 탭 복원(`Ctrl+Shift+T`)은 창 단위 스택이 맞으므로 엔티티 배치와 의미가 상충. SessionSnapshot(SA 5.1)에도 closedHistory 직렬화 위치가 불명확.
- **어떻게**: `closedHistory`를 `Window` 엔티티로 이동하고, SA 5.1 SessionSnapshot에 복원 대상 여부(휘발/영속)를 명시.

---

## 확인 필요 (사용자/PM 판단)
- **R1(생성·이름변경 IPC)·R7(D-코드 충돌)** 은 High로, chief-architect가 즉시 반영해야 PASS 가능. 설계 의도 변경이 아니라 누락·표기 결함이므로 PM 의사결정 불필요, 생산자 수정으로 충분.
- R5(검색 폴백)는 M1 성능 측정 결과에 따라 Web Worker 도입 시점이 갈리므로, M1 스파이크 범위에 "1만 개 필터 200ms" 항목 포함 여부를 PM이 확인하면 좋음.

---

## 통과 조건 요약
High 2건(R1, R7) + Med 5건(R2, R4, R5, R8 — R3/R6은 Low로 권고) 반영 후 재검증 시 PASS 전망. 설계의 골격(프로세스/보안·IPC·성능·계층)은 견고하므로 전면 재작업은 불필요하다.
