# QA 통합 검증 보고서 — Explorer MVP (P0~P5)

> 작성: QA 엔지니어 · 2026-06-07 · 대상: MVP(P0~P5) 전체 통합
> 입력: roadmap.md(DoD·QA 포인트), user-stories.md(수용 기준), PRD §8(단축키), system-architecture.md §3(IPC 카탈로그)
> 방법: 빌드/타입/린트/verify 하니스 실제 실행 + 프론트↔백엔드 경계면 코드 교차 대조 + 수용 기준 코드 추적

---

## 0. 종합 판정: **CONDITIONAL PASS (조건부 통과)**

빌드·타입·린트·패키징·자동 검증 하니스(8종)는 **전부 통과(0 실패)**하고, 보안 경계·IPC 계약 정합·대부분의 MVP 수용 기준이 코드로 충족됐다. 다만 **클립보드 붙여넣기(Ctrl+V) 경로에서 진행률·충돌·새로고침이 동작하지 않는 High 결함 1건**이 존재한다. 이 결함은 US-2.3/US-2.4(붙여넣기·충돌 해결)의 핵심 수용 기준을 깨므로 릴리스 전 수정이 필요하다(블로커 인접). 그 외 기능은 통과.

- 릴리스 게이트 관점: **BUG-001 수정 전까지 FAIL**, 수정 시 PASS.

---

## 1. 빌드 / 타입 / 린트 / 패키징 수치표

| 항목 | 명령 | 결과 | 수치 |
|---|---|---|---|
| 타입체크(node) | `tsc -p tsconfig.node.json` | **PASS** | 0 에러 |
| 타입체크(web) | `tsc -p tsconfig.web.json` | **PASS** | 0 에러 |
| 린트 | `eslint . --ext .ts,.tsx,.cjs` | **PASS** | 0 에러 / 0 경고 |
| 빌드 | `npm run build` (prebuild clean 포함) | **PASS** | exit 0, **3엔트리 산출** |
| 패키징 | `npm run package` (electron-builder NSIS) | **PASS** | exit 0, 인스톨러 생성 |

**빌드 산출물(3엔트리 확인됨)**
- `out/main/index.js` (53.48 kB) + `out/main/fileOpWorker.js` (2.51 kB) + `out/main/chunks/protocol-*.js`
- `out/preload/index.cjs` (5.30 kB)
- `out/renderer/index.html` + `out/renderer/assets/index-*.js` (401.40 kB)
- 모듈 변환: main 28 / preload 3 / renderer 92
- 패키징: `dist/Explorer Setup 0.1.0.exe` (≈78 MB, electron 31.7.7, x64, NSIS oneClick=false). 코드서명 미적용(P7 범위) — `application icon is not set` 경고만(기능 무관).

`prebuild` 가 `out` 디렉토리를 정상 삭제(clean) 후 재빌드함을 확인.

---

## 2. 검증 하니스 전수 실행 (verify:*)

| 스크립트 | 결과 | pass/fail |
|---|---|---|
| `verify:fs` | **PASS** | 19 / 0 |
| `verify:ops` | **PASS** | 35 / 0 |
| `verify:worker` | **PASS** | 8 / 0 |
| `verify:persistence` | **PASS** | 43 / 0 |
| `verify:store` | **PASS** | 30 / 0 |
| `verify:domain` | **PASS** | 21 / 0 |
| `verify:operations` | **PASS** | 66 / 0 |
| `verify:p5` | **PASS** | 52 / 0 |
| **합계** | **8/8 통과** | **274 / 0** |

주요 검증 커버리지(샘플): 경로 `..` 이탈 차단, 스트림 start→chunk→done 누적 일치·취소 후 무유입, 충돌 명명("report (2).png", "a.tar (2).gz"), Worker 진행률·충돌 왕복(overwrite)·SharedArrayBuffer 취소, 세션 디바운스+flush·휘발(activeOperation) 직렬화 제외, 텔레메트리 기본 false 영속, 도메인 정렬/필터/드래그 의도 규칙.

> 한계: verify 하니스는 모두 헤드리스(Node)에서 도메인/서비스/스토어 로직을 직접 구동한다. **실제 IPC 왕복(ipcMain↔ipcRenderer)·Electron 런타임·UI 렌더는 검증하지 않음**(§6 참조).

---

## 3. 경계면 교차 비교 (preload `window.api` ↔ Main 핸들러 ↔ contracts)

계약 단일 출처(`src/shared/ipc/channels.ts` + `contracts.ts` + `dto/index.ts`)를 기준으로, preload(`src/preload/api.ts`) ↔ Main 핸들러(`src/main/ipc/*.handlers.ts`) ↔ infra 어댑터(`src/renderer/infra/api/index.ts`)를 전 채널 대조했다.

### 3.1 채널별 정합 매트릭스

| 채널 | contracts | preload 노출 | Main 핸들러 등록 | infra 어댑터 | 정합 |
|---|---|---|---|---|---|
| `fs:list` / `stat` / `drives` / `tree-children` / `validate-path` | ✓ | ✓ | ✓ (fs.handlers) | ✓ | **일치** |
| `fs:list:start/cancel` + chunk/done/error(evt) | ✓ | ✓ | ✓ (fs.handlers) | ✓ | **일치** |
| `fs:mkdir` / `create-file` / `rename` | ✓ | ✓ | ✓ (op.handlers) | ✓ | **일치** |
| `shell:open` | ✓ | ✓ | ✓ (shell.handlers) | ✓ | **일치** |
| `shell:show-properties` | ✓ | ✓ | ✓ (shell.handlers) | ✓ | **일치** |
| `shell:open-with` | ✓ | ✓(타입만) | ✗(P6 예정) | ✗ | 의도된 미구현 — 호출부 없음 ✓ |
| `shell:icon` | ✓ | ✓(타입만) | ✗(후속) | ✗ | 의도된 미구현 — 호출부 없음 ✓ |
| `op:start/resolve/cancel` + progress/conflict/done(evt) | ✓ | ✓ | ✓ (op.handlers / OperationManager) | ✓ | **일치** |
| `clipboard:copy-files/cut-files/read/paste-target` | ✓ | ✓ | ✓ (clipboard.handlers) | ✓ | **일치(shape)**, 단 BUG-001(런타임 결함) |
| `dialog:confirm-permanent-delete` | ✓ | ✓ | ✓ (op.handlers) | ✓ | **일치** |
| `session:load/save` | ✓ | ✓ | ✓ (session.handlers) | ✓ | **일치** |
| `settings:get/set` | ✓ | ✓ | ✓ (session.handlers) | ✓ | **일치** |
| `telemetry:set-opt-in` | ✓ | ✓ | ✓ (session.handlers) | ✓ | **일치** |
| `workspace:save/list/load/delete` | ✓ | ✓(타입만) | ✗(P6 예정) | ✗ | 의도된 미구현 — 호출부 없음 ✓ |

### 3.2 shape / Result / 이벤트 정합

- **채널명**: preload·infra·Main 모두 `CHANNELS` 상수를 import(하드코딩 문자열 없음) → 오타 불일치 0.
- **요청/응답 타입**: preload `ExplorerApi`·infra 어댑터·Main 핸들러가 모두 `IpcRequestMap`/`IpcEventMap`·`@shared/dto` 동일 타입 import. 타입체크 0 에러 = 컴파일 타임 계약 위반 0.
- **Result/FileOpError**: 양단 모두 `Result<T, FileOpError>` 판별 유니온. Main 핸들러는 전부 `err(...)`/`ok(...)` 반환(throw 금지 준수), guard 실패도 `Result.err(ESECURITY/EINVAL)`로 1급 전파. 렌더러 usecase는 `if (!res.ok)` 분기로 일관 처리.
- **이벤트 페이로드**: `fs:list:chunk/done/error`·`op:progress/conflict/done` 의 payload shape가 contracts(IpcEventMap)와 일치. infra의 `subscribeListStream`/`subscribeOpStream`이 streamId/operationId 상관 라우팅으로 구독.
- **op:conflict source/target**: Main(OperationManager)이 `FileEntryDTO` 전체 필드를 채워 푸시 → ConflictDialog가 크기·수정일·종류 비교 표시(US-2.4 충족).

### 3.3 경계면 불일치 건수: **0 (계약/타입 레벨)**

타입·채널명·shape·Result 처리 레벨에서 프론트-백엔드 불일치는 **없음**. 단, **런타임 흐름 불일치 1건**이 §4 BUG-001로 분리 보고됨(타입은 맞으나 operationId 상관 라이프사이클이 paste 경로에서 끊김).

---

## 4. 발견된 버그 / 결함

### BUG-001 — 클립보드 붙여넣기(Ctrl+V) 작업이 진행률·충돌·새로고침에서 누락 〔심각도: 높음 / 블로커 인접〕

- **무엇이**: Ctrl+V 붙여넣기로 시작된 복사/이동 작업은 ProgressDialog·ConflictDialog가 뜨지 않고, 완료 후 패널 새로고침도 안 된다. 특히 **이름 충돌이 있으면 작업이 무한 대기(hang)** 한다.
- **어디서 (경계면)**:
  - 백엔드: `src/main/ipc/clipboard.handlers.ts` `clipboard:paste-target` → `operationManager.start(...)` 가 operationId를 발급하고 `op:progress/conflict/done`를 그 id로 푸시.
  - 계약: `clipboard:paste-target` 응답이 `Result<void>`(contracts.ts:231) → **operationId가 렌더러로 반환되지 않음**.
  - 프론트: `src/renderer/app/usecases/fileOps.ts` `clipboardPaste()` 가 `pasteTarget`만 호출하고 `registerOperation(...)`를 호출하지 않음.
  - 결과: `src/renderer/app/stores/operationsSlice.ts` 의 `_opProgress`/`_opConflict`/`_opDone` 가 모두 `const op = s.operations[id]; if (!op) return` 으로 **조기 반환**(미등록 operationId).
- **기대 vs 실제**:
  - 기대(US-2.3/US-5.2): 붙여넣기 진행 시 ProgressDialog 표시·200ms 갱신, 충돌 시 ConflictDialog로 덮어쓰기/건너뛰기/둘다유지 선택, 완료 후 대상 패널 새로고침.
  - 실제: ProgressDialog/ConflictDialog 미표시(operations 맵에 항목 없음). 충돌 발생 시 Worker `resolveConflict` 가 `op:resolve`를 영원히 대기 → `fileOpWorker.ts` 의 conflict promise 미해소 → **붙여넣기 영구 정지**. 완료해도 `operationsBridge` 의 `onDone` 이 `refreshPaths=[]`(미등록)라 새로고침 없음.
- **재현**:
  1. 2개 폴더에서 같은 이름 파일이 존재하도록 준비.
  2. A에서 Ctrl+C → B로 이동 → Ctrl+V.
  3. 충돌 다이얼로그가 뜨지 않고 작업이 멈춤(또는 충돌 없을 시 진행률 없이 조용히 진행, 목록 미갱신).
- **참고(F5/F6·D&D는 정상)**: `copyToOtherPanel`/`moveToOtherPanel`/`performDrop` 는 `startOperation()` 경유로 `op.start` 반환 operationId를 `registerOperation` 에 등록하므로 진행률·충돌·새로고침이 정상 동작. **paste 경로만 이 등록 단계를 건너뜀.**
- **권장 수정(택1)**:
  - (a) `clipboard:paste-target` 계약을 `Result<OpStartRes>`(operationId 반환)로 바꾸고, `clipboardPaste()`가 반환 id로 `registerOperation` 호출. (계약 변경 — 가장 정합적)
  - (b) operationsSlice의 op 이벤트 핸들러가 **미등록 operationId를 수신하면 lazy 등록**(progress/conflict 첫 수신 시 Operation 생성)하도록 보강. (계약 무변경, refreshPaths는 별도 경로 필요)
- **담당 권고**: backend(계약·핸들러) + frontend(operationsSlice/fileOps) 협업.

### OBS-002 — 영구삭제 확인 경로 이원화 (관찰 / 낮음, 기능 정상)

- `dialog:confirm-permanent-delete`(Main 네이티브 모달) 핸들러가 등록되어 있으나, 렌더러는 자체 `ConfirmDialog`(uiSlice.confirmDelete)로 영구삭제를 확인한다(`fileOps.ts requestPermanentDelete/confirmPermanentDelete`). SA §4.2는 "Main 모달 권장"이고 코드 주석도 이를 인지하고 의도적으로 Renderer 모달 1차 사용을 택함. **기능상 US-2.2(영구삭제 확인) 충족**. Main 모달 채널은 미사용 상태로 남음(데드 채널은 아님 — 계약·핸들러는 존재). 추후 일원화 권고.

### OBS-003 — `truncated` 필드 처리 정합 (관찰 / 정보)

`fs:list:done` 의 `truncated` 가 contracts(`ListStreamDone`)·핸들러·infra 콜백(`onDone(total, truncated)`)까지 일관 전달됨. 불일치 없음(과거 우려 해소 확인용 기록).

---

## 5. MVP(Must) 수용 기준 충족 매트릭스

판정: ●충족(코드/테스트로 확인) / ◐부분(코드 존재, 헤드리스 미실증 또는 일부 갭) / ○미충족

| US | 스토리 | 판정 | 근거 / 비고 |
|---|---|---|---|
| US-1.1 | 탭 보관 | ● | tabsSlice·usecases·TabBar, Ctrl+T/W/Tab/1~9·복제·복원·"내 PC" 기본탭, 탭별 독립(verify:store) |
| US-1.2 | 2분할 | ● | LayoutHost single/split-2-h/v, 활성패널 시각 구분, Tab/Ctrl+←→ 포커스, 탭별 독립 |
| US-1.3 | 패널 간 D&D·F5/F6 | ● | dragIntent(같은드라이브=이동/다른=복사, Ctrl/Shift 강제, 순환차단, 동일폴더 무시), DragOverlay 커서/툴팁·하이라이트, F5/F6=startOperation. (verify:domain) |
| US-2.1 | 보기/정렬 | ● | domain/rules/sort 자연정렬·폴더우선, 패널별 view 기억, list/details |
| US-2.2 | 생성/이름변경/삭제 | ● | fs:mkdir/create-file/rename(EEXIST 자동증가·EINVAL 안내), Delete=trash, Shift+Delete=확인 후 delete |
| US-2.3 | 복사/잘라내기/붙여넣기 | **◐** | copy/cut 클립보드·잘라내기 흐림·복사본 명명은 동작. **붙여넣기(V) 진행/새로고침 결함(BUG-001)** |
| US-2.4 | 충돌 해결 | **◐** | ConflictDialog(덮어쓰기/건너뛰기/둘다유지/병합·모두적용·크기/수정일 비교)·Worker 충돌 왕복은 정상(verify:worker). **단 paste 경로 충돌은 미표시·hang(BUG-001)** |
| US-3.1 | 주소창/이동 | ● | 브레드크럼·Ctrl+L·validate-path 인라인 오류·Alt+←/→/↑·Backspace |
| US-3.2 | 트리 사이드바 | ● | tree-children 지연확장, 즐겨찾기/최근/휴지통/내PC 섹션, 토글·폭조절 |
| US-3.3 | 즐겨찾기/최근 | ● | sidebarSlice favorites/recent, recentLimit 적용·개별/전체 삭제 |
| US-4.1 | 현재 폴더 검색 | ● | SearchBar Ctrl+F, 디바운스 80ms+startTransition(200ms 목표 내), 하이라이트, 해제 복귀 |
| US-4.2 | 확장자/이름 필터 | ● | domain/rules/filter 글롭(*.png/report*), 상태바 결과 개수 |
| US-5.1 | 다중 선택/일괄 | ● | selectionSlice Ctrl/Shift/박스/Ctrl+A, 일괄 op, 상태바 선택개수/용량 |
| US-5.2 | 진행률/취소 | **◐** | OperationManager 200ms 스로틀·취소(Atomics)·부분실패 요약·UI 비차단(Worker)은 정상. **paste 경로만 진행률 미표시(BUG-001)** |
| US-5.3 | 테마 | ● | theme/applyTheme 라이트/다크/시스템 즉시 적용·영속 |
| US-5.4 | 키보드 워크플로 | ● | KEYBINDINGS=PRD §8 1:1 일치, registry 중복 assert, Tab/F5/F6/Ctrl+R 고유성 확인, 설정·F1 도움말 목록 노출 |
| US-5.5 | 자동 세션복원 | ● | session.ts 휘발 제외(selection/closedHistory/op/dragOp 등)·디바운스+before-quit flush·원자적 쓰기·손상 폴백(verify:persistence) |
| US-5.6 | 대용량 첫 렌더(성능) | ◐ | 스트리밍 start→chunk→done·가상 스크롤 구현됨(verify:fs). **1.5초 실측은 헤드리스 불가(P7)** |
| US-5.7 | 상태바 | ● | 항목수·선택개수/용량·활성경로·필터결과·진행 op 인디케이터 |

**Must 스토리 18개 충족률**
- 완전 충족(●): **14 / 18 = 78%**
- 부분(◐, BUG-001 또는 성능 실측 미실증): 4 (US-2.3, US-2.4, US-5.2, US-5.6)
- 미충족(○): 0
- **BUG-001 수정 시**: US-2.3/2.4/5.2 가 ●로 전환 → 17/18(94%) 충족, 잔여 ◐는 US-5.6(성능 실측, P7 범위)만.

> Should(US-1.4 4분할·US-4.3 미리보기·US-5.8 워크스페이스)는 MVP 범위 외(P6) — 미평가. 계약(workspace:*)만 동결, 호출부 없음 확인.

---

## 6. 보안 경계 점검

| 항목 | 결과 | 근거 |
|---|---|---|
| Renderer FS 직접 접근 차단 | **PASS** | `.eslintrc.cjs` renderer override: `electron`/`fs`/`child_process`/`node:*` import 금지(error). 린트 0 위반. FS는 `window.api`(infra/api) 단일 경계만 사용. |
| 계층 경계(domain/ui/app) | **PASS** | domain→react/zustand/infra/shared-ipc 금지, ui→infra 직접 금지, main/preload→renderer 금지. 린트 통과. |
| BrowserWindow 보안 4종 | **PASS** | `mainWindow.ts`: contextIsolation/sandbox/webSecurity true, nodeIntegration false. |
| senderFrame 검증 | **PASS** | `guard.ts isTrustedSender` 전 핸들러 진입점에서 호출(fs/shell/op/clipboard/session 모두 `handleGuarded` 또는 인라인). 인자없는 채널(drives/clipboard:read/session:load/settings:get)도 sender 검증 적용. |
| 경로 정규화·`..` 차단 | **PASS** | `guardPath`→`normalizePath`(상위이탈→ESECURITY). fs/shell/op/clipboard 경로 인자 전부 통과. zod 1차+normalize 2차(방어 심층). verify:fs 로 `..` 이탈 차단 실증. |
| shell:open / show-properties 검증 | **PASS** | shell:open 3중 검증(정규화→F_OK 존재→R_OK 권한) 후에만 `shell.openPath` 위임, 실패 시 실행 없이 FileOpError. show-properties도 정규화+존재 확인 후 위임. 명령행 조립 없음(검증된 단일 경로만). |
| CSP / 원격 차단 | **PASS** | `index.ts` onHeadersReceived 로 엄격 CSP(prod: default-src 'self'·object-src 'none'·frame-ancestors 'none'). setWindowOpenHandler 가 http/https만 외부 브라우저 위임·나머지 deny. permission 요청 전부 거부. |
| 단일 인스턴스 락 | **PASS** | requestSingleInstanceLock + second-instance 포커스. |

보안 경계 위반: **0 발견.**

---

## 7. 헤드리스로 확인하지 못한 항목 (실런타임/UI 필요 — P7 권고)

1. **실제 IPC 왕복**: ipcMain↔ipcRenderer 직렬화·senderFrame 거부가 실 Electron 런타임에서 동작하는지(verify는 서비스 직접 호출). 특히 BUG-001은 실행 시 더 명확히 드러남.
2. **성능 3종 실측**: US-5.6 1만 항목 첫 렌더 1.5초, op:progress 200ms 갱신, 검색 200ms 반영(코드 경로·스로틀은 확인, 시간 미측정).
3. **UI 렌더/상호작용**: 가상 스크롤 DOM 노드 수 유지, 셀렉터 리렌더 격리, 다이얼로그 표시·포커스 트랩, DragOverlay 시각 피드백.
4. **Windows 특수 케이스**: 롱패스·유니코드·심볼릭/정션·네트워크 드라이브·휴지통 실연동(shell.trashItem), win32 hidden/system 속성 매핑.
5. **세션 크래시 복원**: 강제 종료(crash) 후 재기동 복원·원자적 쓰기 중 종료 무손상(로직·verify는 확인, 실프로세스 킬 미수행).
6. **설정 영속 왕복**: settings.json/session.json 실제 디스크 영속→재시작 유지(persistence 단위는 verify 통과, 앱 재시작 e2e 미수행).
7. **패키징 산출물 설치/실행**: NSIS 인스톨러 생성은 확인, 실제 설치/실행/제거·코드서명 미검증.

---

## 8. tech-lead 보고 요약

- **종합 판정**: CONDITIONAL PASS — 빌드·검증·보안·계약은 전부 통과. **BUG-001(붙여넣기 진행/충돌/새로고침 누락, 충돌 시 hang) 수정이 릴리스 전 필수.**
- **즉시 조치**: BUG-001 (High) — backend `clipboard:paste-target` operationId 반환 + frontend registerOperation 연결(권장 (a)).
- **빌드/검증 수치**: 타입 0·린트 0·빌드 3엔트리 exit 0·패키징 exit 0 / verify 8종 **274 pass · 0 fail**.
- **경계면 불일치**: 계약·타입·채널·shape 레벨 **0건**. 런타임 라이프사이클 결함 1건(BUG-001).
- **MVP 충족률**: Must 14/18 완전 충족(78%), BUG-001 수정 시 17/18(94%, 잔여는 P7 성능 실측).
</content>
</invoke>
