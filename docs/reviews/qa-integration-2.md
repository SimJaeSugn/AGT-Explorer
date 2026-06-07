# QA 재검증 보고서 (BUG-001 수정 확인 + 최종 통합 게이트) — Explorer MVP

> 작성: QA 엔지니어 · 2026-06-07 · 대상: BUG-001 수정본 재검증 + MVP(P0~P5) 최종 통합 게이트
> 입력: `qa-integration.md`(BUG-001 CONDITIONAL PASS), 수정 4파일(contracts/clipboard.handlers/fileOps/preload·infra), 신규 `verify:paste`
> 방법: 수정 코드 직접 읽기 + 경계면 4지점 교차 대조 + 전체 게이트(typecheck/lint/build/package) 및 verify 9종 실제 실행

---

## 0. 종합 판정: **PASS (통과)**

이전 보고서의 유일한 릴리스 블로커였던 **BUG-001(클립보드 붙여넣기 op 미등록 → ProgressDialog/ConflictDialog 미표시·충돌 시 hang)** 이 **계약·Main·Renderer·preload·infra 5개 지점에서 일관되게 수정**되었음을 코드로 확인했고, 신규 헤드리스 실증 하니스(`verify:paste`)가 **(a)진행률 (b)충돌 (c)hang 없는 resolve (d)cut 양방향 처리** 전부를 실측 PASS로 증명했다. 전체 게이트(typecheck/lint/build/package)와 verify 9종이 **0 실패**로 통과한다.

- 릴리스 게이트 관점: **PASS** (BUG-001 해소, 잔여 High 결함 0).

---

## 1. BUG-001 해소 확인

### 1.1 수정 5지점 교차 대조 — 타입 불일치 0

| 지점 | 파일:라인 | 수정 후 상태 | 판정 |
|---|---|---|---|
| 계약 | `src/shared/ipc/contracts.ts:234` | `CLIPBOARD_PASTE_TARGET: { req: ClipboardPasteTargetReq; res: Result<OpStartRes> }` | ● |
| preload(타입) | `src/preload/api.ts:133` | `pasteTarget(req): Promise<Result<OpStartRes>>` | ● |
| preload(구현) | `src/preload/api.ts:206` | `invoke(CHANNELS.CLIPBOARD_PASTE_TARGET, req)` (제네릭이 계약에서 추론) | ● |
| infra 어댑터 | `src/renderer/infra/api/index.ts:148` | `pasteTarget(destDir): Promise<Result<OpStartRes>>` | ● |
| Main 핸들러 | `src/main/ipc/clipboard.handlers.ts:85-100` | effect→kind(copy/move) 후 `operationManager.start(kind, clip.paths, gd.value, undefined, event.sender)` → `ok(r.value)`(operationId) 반환, 성공 시 `clearAfterPaste()` | ● |
| Renderer usecase | `src/renderer/app/usecases/fileOps.ts:165-198` | `clipboardApi.read()`로 kind/cut여부 결정 → `pasteTarget` → `registerOperation(res.value.operationId, kind, refreshPanelIds(refreshDirs))` | ● |

- `OperationManager.start` 시그니처 `(kind, sources, destDir, conflictPolicy, wc): Promise<Result<{operationId}>>` (`OperationManager.ts:72-78`) 와 핸들러 호출 인자 5개가 **정확히 일치** → F5/F6/D&D(`op:start`)와 동일 파이프라인.
- 계약 변경(권장 (a)안)으로 채택됨 → **계약 무변경 lazy-등록(b안) 대비 가장 정합적**.

### 1.2 4개 하위 조건 성립 추적 (코드 + 실증)

| 조건 | 성립 근거 | 실증(verify:paste) |
|---|---|---|
| (a) ProgressDialog 표시 | paste가 `registerOperation` → `operations` 맵 등재 → `op:progress`가 등록된 id 매칭(`_opProgress`), 진행 op≥1 시 ProgressDialog 표시 | `op:progress 가 반환 operationId 로 emit` PASS |
| (b) ConflictDialog 표시 | 등록된 op에 `op:conflict`가 `_opConflict`로 conflictQueue 적재 → ConflictDialog head 표시 | `충돌 이벤트 발생`·`op:conflict 가 반환 operationId 로 emit` PASS |
| (c) hang 없는 진행 | `op:resolve`(operationManager.resolve)로 Worker conflict promise 해소 → `op:done` 도달 | `충돌 resolve 후 op:done 도달(hang 없음)`·15s 타임아웃 미발동 PASS |
| (d) 완료 후 새로고침(cut=양쪽) | cut일 때 `refreshDirs = [...cutParents(원본부모), activePath(대상)]` → `refreshPanelIds`로 패널ID 변환 → `op.refreshPaths` 저장 → done 브리지(`operationsBridge.ts:29-33`)가 `s.refresh(pid)` 호출 | cut(move) 대상 존재·원본 사라짐·클립보드 비움 PASS |

`_opDone`(`operationsSlice.ts:185`)·done 브리지(`operationsBridge.ts:29`: `op?.refreshPaths ?? []` → 패널별 `refresh`)까지 라이프사이클이 끊김 없이 연결됨을 확인.

**BUG-001 해소 여부: 해소됨(RESOLVED).**

---

## 2. 게이트 재검증 수치표

| 항목 | 명령 | 결과 | 수치 |
|---|---|---|---|
| 타입체크(node) | `tsc -p tsconfig.node.json` | **PASS** | 0 에러 |
| 타입체크(web) | `tsc -p tsconfig.web.json` | **PASS** | 0 에러 |
| 린트 | `eslint . --ext .ts,.tsx,.cjs` | **PASS** | 0 에러 / 0 경고 |
| 빌드 | `npm run build`(prebuild clean) | **PASS** | exit 0, **3엔트리**(main `index.js` 53.48kB + `fileOpWorker.js` 2.51kB + `chunks/protocol-*.js` 9.16kB / preload `index.cjs` 5.30kB / renderer 92모듈 `index-*.js` 402.24kB) |
| 패키징 | `npm run package`(NSIS) | **PASS** | exit 0, `dist/Explorer Setup 0.1.0.exe`(≈78.86MB, x64, oneClick=false) |

`prebuild`가 `out` 정상 clean 후 재빌드 확인. 패키징은 `application icon is not set` 경고만(코드서명/아이콘은 P7 범위, 기능 무관).

### 2.1 verify 하니스 전수 (9종, paste 신규 포함)

| 스크립트 | 결과 | pass/fail | 이전 대비 |
|---|---|---|---|
| `verify:fs` | PASS | 19 / 0 | = |
| `verify:ops` | PASS | 35 / 0 | = |
| `verify:worker` | PASS | 8 / 0 | = |
| `verify:persistence` | PASS | 43 / 0 | = |
| `verify:store` | PASS | 30 / 0 | = |
| `verify:domain` | PASS | 21 / 0 | = |
| `verify:operations` | PASS | 80 / 0 | +14 (paste 경로 케이스 추가) |
| `verify:p5` | PASS | 52 / 0 | = |
| `verify:paste` (신규) | PASS | 13 / 0 | 신규 |
| **합계** | **9/9 통과** | **301 / 0** | 274 → **301 (+27, fail 0)** |

회귀 확인: 이전 8종 274 pass의 각 수치가 **그대로 유지**(누락·신규 fail 0). 증가분 +27 = `verify:operations` +14(paste op 라이프사이클 케이스) + `verify:paste` 신규 13. **신규 fail·기존 fail 전무.**

---

## 3. 경계면 일치

| 채널 | contracts | preload(타입/구현) | infra 어댑터 | Main 핸들러 | 정합 |
|---|---|---|---|---|---|
| `clipboard:paste-target` | `Result<OpStartRes>` | `Result<OpStartRes>` / invoke | `Result<OpStartRes>` | `start()` → `ok({operationId})` | **일치(타입+런타임)** |

- 채널명: 5지점 모두 `CHANNELS.CLIPBOARD_PASTE_TARGET` 상수 import(하드코딩 0).
- shape: paste 응답이 `op:start`(`OpStartRes`)와 **동일 shape** → 렌더러 상관 로직(registerOperation) 단일화.
- 타입체크 0 에러 = 컴파일 타임 계약 위반 0. 이전 보고서의 "런타임 라이프사이클 결함 1건"이 **해소되어 §3 경계면 불일치 0(타입+런타임)** 으로 전환.
- 나머지 전 채널 정합 매트릭스는 1차 보고서(§3) 기준 변동 없음.

---

## 4. 잔여 결함

| ID | 심각도 | 상태 | 비고 |
|---|---|---|---|
| BUG-001 | High | **CLOSED** | 5지점 수정 + verify:paste 13 PASS로 해소 확인 |
| OBS-002 | 낮음 | OPEN(관찰) | 영구삭제 확인 경로 이원화(Renderer 모달 1차 사용, 기능 정상). Main 모달 일원화는 추후 권고 |
| OBS-003 | 정보 | CLOSED | `truncated` 필드 정합(기록용) |

**잔여 High 결함: 0건.** Medium/Blocker도 없음. OBS-002(낮음)는 기능상 US-2.2 충족이라 릴리스 게이트에 영향 없음.

### 헤드리스 미실증(P7 권고, 결함 아님)
실 Electron IPC 왕복·성능 3종 실측(US-5.6 1만 항목 1.5초 등)·UI 렌더/다이얼로그 포커스트랩·Windows 특수경로·NSIS 실설치/코드서명. BUG-001은 verify:paste가 실 OperationManager+번들 Worker를 구동해 헤드리스 한계를 상당 부분 보완(실 IPC 직렬화 계층만 미검).

---

## 5. MVP(Must) 수용 기준 충족 매트릭스 (갱신)

BUG-001 해소로 1차 보고서의 ◐ 4건 중 3건이 ● 전환:

| US | 스토리 | 이전 | 현재 | 근거 |
|---|---|---|---|---|
| US-2.3 | 복사/잘라내기/붙여넣기 | ◐ | **●** | paste가 op 등록 → 진행률·완료·새로고침(cut 양쪽) 성립(verify:paste) |
| US-2.4 | 충돌 해결 | ◐ | **●** | paste 충돌도 ConflictDialog 표시·resolve로 진행, hang 없음(verify:paste #3) |
| US-5.2 | 진행률/취소 | ◐ | **●** | paste 경로 진행률 표시 성립, 전 op 경로 ProgressDialog 일관 |
| US-5.6 | 대용량 첫 렌더(성능) | ◐ | ◐(유지) | 스트리밍/가상스크롤 구현, **1.5초 실측만 P7 범위** |

**Must 18개 충족률**
- 완전 충족(●): **17 / 18 = 94%**
- 부분(◐): 1 (US-5.6 — 성능 실측, P7 범위. 코드 경로·스로틀은 확인)
- 미충족(○): 0

**최종 MVP 수용기준 충족률: 17/18 = 94% (잔여 ◐ 1건은 P7 성능 실측 한정, 기능 결함 아님).**

---

## 6. tech-lead 보고 요약

- **종합 판정: PASS** — BUG-001 해소, 전체 게이트·verify 9종 0 실패, 잔여 High 결함 0.
- **BUG-001**: CLOSED. 계약(`Result<OpStartRes>`)·Main(start→operationId)·Renderer(read→registerOperation, cut 양쪽 새로고침)·preload·infra 5지점 일관. verify:paste 13/13 PASS(진행률·충돌·hang없음·cut move/clipboard clear 실증).
- **게이트 수치**: typecheck 0·lint 0·build 3엔트리 exit 0·package exit 0 / verify **301 pass · 0 fail**(274→301, 회귀 0).
- **경계면**: paste-target 5지점 타입+런타임 일치, 불일치 0.
- **잔여 High 결함**: 0건 (OBS-002 낮음, OBS-003 정보뿐).
- **MVP 충족률**: Must 17/18 = 94%(잔여 ◐는 US-5.6 성능 실측, P7).
