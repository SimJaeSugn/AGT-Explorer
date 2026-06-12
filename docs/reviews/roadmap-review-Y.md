# 개발 세부계획 검증 보고 — §Y Windows 셸 컨텍스트 메뉴 연동 (Y-implementation-plan.md)

- 검증 대상: `docs/pm/Y-implementation-plan.md`(tech-lead 작성·2026-06-12·T1~T6 세부계획)
- 기준 문서: `ADR-013`(확정 설계)·`traceability.md §1-Y`·`directory-structure §Y`·`features.md §Y1`(수용기준 10개)·`flows.md F37`·`architecture-review-Y.md`(경미 권고 4건)
- 검증일: 2026-06-12 · 검증자: 독립 Reviewer(제3자) · 범위: 설계 정합·실행 가능성·권고 흡수·검증 계획·수용기준 커버리지·금지선(코드 동작 검증 제외 — 구현 전)

---

## 판정: **PASS**

## 요약
세부계획은 ADR-013·traceability §1-Y 설계 범위 안에서 채널·DTO·verbId·블랙리스트·워커 수명주기·패키징을 충실히 구체화했고, 설계에 없던 임의 결정은 전부 합리적 구체화(`FileOpErrorCode`에 `EVERB` 추가·실패의 `ok({verbs:[]})` 흡수)로 판별된다. T1~T6 의존 순서가 정합하고, 참조하는 파일·심볼(`electron.vite.config.ts` rollup 멀티엔트리·`HashManager#workerPath` `__dirname` 패턴·`driveType.ts queryFn` 트랜스포트 주입 선례·`shell.handlers.ts` 3중 검증·`contextMenu.ts#buildMenuItems`의 `!multi && single` 경로·`uiSlice.ContextMenuState.targetPath`·`before-quit`+`archiveSessionManager().closeAll()` 선례·`verify:shell-h4h6` esbuild 패턴)이 실코드에 모두 실재한다(Glob/Grep 확인). 권고 4건이 흡수 지점 표(§5)와 본문에 모두 명시됐고, 검증 계획이 신규 verify·node 단독 워커 스모크·기존 전체 회귀·정직 한계(🟡)를 명확히 구분한다. 수용기준 10개가 T1~T6에 빠짐없이 매핑되며, 금지선(roadmap·기획 4종 무수정·기존 채널 계약 무변경·append-only)을 명시적으로 선언·준수한다. **그대로 구현(team-dev) 진행 가능.** 경미 권고 3건만 후속 참고로 남긴다.

---

## 체크리스트 결과

### 1. 설계 정합 — PASS
- **채널·DTO·verbId·블랙리스트·프로토콜**: 계획 §2~§4가 ADR-013 결정⑤(채널 2종·DTO·verbId `<index>:<정규화표시명>`·zod guard)·결정②(stdin JSON 라인·FIFO·타임아웃·crash 재기동)·결정③(재열거 교차검증)·결정④(블랙리스트 표시명 정규화·영/한 사전)와 1:1 정합. 블랙리스트 사전(§3)도 결정④ 확정표(paste 포함)와 일치.
- **워커 수명주기**: lazy spawn·crash 재기동·연속 3회 쿨다운(UQ-Y5)·before-quit dispose·짧은 타임아웃(1500ms·UQ 기본값)이 ADR-013 결정②/UQ와 일치.
- **패키징 1차안**: T6의 `asarUnpack`+`__dirname` 보정이 UQ-Y1 "1차 `-File` 외부 `.ps1`" 결정 안. `electron-builder.yml` 현재 `asar: true`·`asarUnpack` 부재 확인 → 1줄 추가 계획 정합.
- **① `FileOpErrorCode`에 `EVERB` 추가가 계약 동결과 충돌하는가 → 충돌 아님(합리적 구체화)**: 실코드 `src/shared/dto/index.ts`의 `FileOpErrorCode`(line 696~710)는 `| RemoteErrorCode`(line 710)로 §M 원격 코드를 유니온 확장한 선례가 실재한다. 계획 §2.4가 이 "RemoteErrorCode 확장 선례 동형"을 정확히 인용하며 `| 'EVERB'` 1항 추가. 유니온 확장은 기존 소비측 switch의 default/EUNKNOWN 폴백이 흡수(주석 line 673~674 "unknown code를 generic 폴백")하므로 기존 계약 비파괴. ADR-013·traceability §1-Y가 `EVERB`를 이미 명시했으므로 설계 위반 아님 — **빠진 타입을 설계 의도대로 채운 합리적 구체화**.
- **② `context-verbs` 실패를 `ok({verbs:[]})`로 흡수 → ADR-013·F37 정합(모순 없음)**: ADR-013 결정⑥("조회 실패/타임아웃/빈 목록 → 섹션 비노출·크래시·빈 섹션 없음")·결정②("타임아웃 시 해당 요청만 reject하고 섹션 비노출")·F37 예외("워커 조회 실패/타임아웃 → 섹션 비노출·앱 자체 메뉴는 정상")과 정합. 계획 §2.6이 "서비스 결과는 항상 `ok({verbs})`(실패=빈 배열), 단 sender/zod/guard/prefix 거부만 `Result.err`"로 경계를 정확히 구분 — 잘못된 호출(거부)과 정상 폴백(빈 섹션)을 분리해 권고-3까지 함께 충족.

### 2. 실행 가능성(태스크 분해·의존·심볼 실재) — PASS
- **의존 순서**: T1(계약 동결)→T2(메인)·T3(preload)→T4(렌더러)→T5(verify)→T6(빌드). §0.2 충돌표가 공유 파일을 append-only로 한정. 순서 근거(계약 선동결로 추측 제거)가 타당.
- **담당 배정**: backend/frontend 구분이 계층과 정합(T2 메인=backend·T4 렌더러=frontend·T3 preload는 양쪽 허용).
- **참조 심볼 실재(Glob/Grep spot-check 전부 확인)**:
  - `electron.vite.config.ts`: main rollup `input` 멀티엔트리(`hashWorker` 등 `.ts`→`out/main/*.js`) 실재. 계획 T6이 ".ps1은 비-JS라 rollup 번들 안 됨 → closeBundle 인라인 플러그인 copy"로 정확히 인지(신규 의존성 0 원칙 유지).
  - `HashManager.workerPath()`: `join(__dirname, 'hashWorker.js')`(line 67) 실재 → T6 `join(__dirname, 'shellVerbsWorker.ps1')` 패턴 근거 정확.
  - `driveType.ts`: `queryFn` 트랜스포트 주입 선례(line 18·31·110·"PowerShell 미경유 스텁") 실재 → T2 `ShellVerbsTransport` 주입 verify 근거 정확.
  - `shell.handlers.ts`: `registerShellHandlers`(line 39)·`isTrustedSender`→`parseArgs`→`guardPath` 3중 검증(line 43·46·50) 실재 → §2.6 시퀀스 동형.
  - `shell.ts`: `spawnDetached`(line 77)·`execFileNoThrow`(line 101)·`showProperties` COM+`$env:EXPLORER_PROP_DIR`(line 178·190·209) 실재 → throw 0 흡수·명령행 합성 0 선례 정확.
  - `contextMenu.ts#buildMenuItems`(line 127)의 `!multi && single` 경로(line 185·229·274)·속성 그룹(line 276)·`openRowContextMenu`(line 288)의 `openContextMenu` 호출(line 308) 실재 → T4 병합 지점·`loadWinVerbs` 트리거 위치 정확.
  - `uiSlice.ts`: `ContextMenuState`(line 48)·`targetPath`(line 56)·`openContextMenu`(line 308) 실재 → `winVerbs` 옵셔널 추가 정합.
  - `ContextMenu.tsx`: `items` useMemo deps `[contextMenu]`(line 43)·`useRootStore((s)=>s.contextMenu)`(line 29) 실재 → T4 "setWinVerbs immer 새 참조 → 셀렉터 리렌더 → buildMenuItems 재호출" 메커니즘이 zustand/immer 동작과 정합(별도 deps 불요 주장 타당).
  - `infra/api/index.ts shellApi`(line 172~186)·`preload/api.ts shell` 네임스페이스 실재 → T3 2메서드 append 동형.
  - `main/index.ts`: `before-quit`(line 42)+`archiveSessionManager().closeAll()`(line 53) 실재 → T2 `dispose()` try/catch 추가 위치 정확.
  - `package.json verify:shell-h4h6`(line 36, esbuild cjs→node) 실재 → T5 `verify:shellverbs` 패턴 정확.
  - `electron-builder.yml`: `asar: true`·`asarUnpack` 부재 확인 → T6 추가 계획 정합.

### 3. 권고 4건 흡수 — PASS
계획 §5 흡수표 + 본문에 4건 모두 명시:
- **권고-1**(stdin 입력 인코딩): §4 ps1 헤더 `[Console]::InputEncoding = [Text.Encoding]::UTF8` + §5표 + T5 한글 경로 왕복 케이스(실 PS는 🟡). ✅
- **권고-2**(타임아웃 후 늦은 응답 id 폐기): T2 책임 ⑥("in-flight Map에 없는 id 응답 drop") + T5 전용 케이스 + §5표. ✅
- **권고-3**(empty가 빈목록·실패·타임아웃 포괄): §2.6·T4(`empty\|undefined → 비노출`)·usecase 주석 명기 + §5표. ✅
- **권고-4**(ExecutionPolicy): T6 `-ExecutionPolicy Bypass -File` + 후속 `-Command -` 트리거 + §5표. ✅

### 4. 검증 계획 적정성 — PASS
- 신규 verify: `verify:shellverbs`(약 38~46 케이스·블랙리스트 정규화·verbId 파싱/합성·라인 프로토콜·타임아웃/stale/crash/쿨다운·invoke 코드 매핑·TTL/경합·병합 분기) 명세.
- node 단독 워커 스모크(§6-4): 실 `powershell.exe -File`로 `ShellVerbsService`를 Electron 없이 구동(driveType.ts 선례 근거)·한글 표시명 보존·dispose 좀비 0 — 헤드리스 범위 내 최대 실증.
- 회귀 가드(§7): 기존 `shell:*` 6채널·`verify:store`(B6 항목 수·순서 불변)·`EVENT_CHANNELS` 무변·`FileOpErrorCode` 확장 안전·`SESSION_SCHEMA_VERSION` 무변 명시.
- 정직 한계(§6-5): 실 GUI(섹션 표출·로딩→채움·항목 클릭→외부 실행·다중 숨김·실 한글 블랙리스트)·실 패키지 ps1 경로/ExecutionPolicy·캐스케이드 누락을 🟡로 정직 구분(✅위장 0).

### 5. 수용기준 커버리지(§Y1 10개 → T1~T6) — PASS
| # | features §Y1 수용기준 | 매핑 태스크 |
|---|---|---|
| 1 | "Windows 메뉴" 섹션 표시·`Verbs()` 열거 노출 | T2(list op·ps1)·T4(병합 렌더) |
| 2 | 다중 선택 시 섹션 숨김 | T4(`!multi && single` 한정·다중 0개) |
| 3 | 블랙리스트(open/cut/copy/paste/delete/rename/properties) 미노출 | T2(`shellVerbsBlacklist.ts` Main 필터)·§3·T5(정규화 12케이스) |
| 4 | 서브메뉴 best-effort·크래시/빈 섹션 없음 | T2(평탄 열거)·T4(empty→비노출)·§8 R3 정직 한계 |
| 5 | `DoIt()` 실행·fire-and-forget | T2(invoke op)·T4(`invokeWinVerb` 무음·실패만 토스트) |
| 6 | 로딩 상태·상주 워커 비차단 | T4(`status:'loading'` 행)·T2(lazy spawn·FIFO·비차단) |
| 7 | COM·N-API 비채택·네이티브 0·채널 2종 | T1(채널 2종)·T2(COM ps1·신규 의존성 0) |
| 8 | 우클릭 실제 경로만·합성/실행 표면 0·ADR-005 | T2 §2.6(sender·zod·guardPath·로컬 한정·stdin only) |
| 9 | B6 충돌·회귀 없이 섹션만 추가 | T4(말미 push만·기존 산출 불변)·§7(verify:store 회귀 0) |
| 10 | 비범위 3건(HMENU·서브메뉴 완전 재현·다중 invoke) | §8 R3·계획 전반(평탄 목록·단일 한정) |

누락 0. 유령 매핑 0(참조한 §Y1 항목 전부 실재).

### 6. 금지선 — PASS
- **roadmap·기획 4종 무수정**: §0 "건드리지 않을 것(불변): `docs/roadmap.md`(doc-sync 게이트 전용)·기획 4종·기존 shell:* 6채널 계약·기존 contextMenu 항목 산출. 본 계획은 추가 전용(append-only)." 명시.
- **기존 채널 계약 무변경**: §7 회귀 가드가 `SHELL_OPEN~SHELL_OPEN_EXTERNAL` 무변경·`verify:shell-h4h6`/`verify:open-with` 통과로 보증. 신규 채널 2종 모두 invoke → `EVENT_CHANNELS` 무변.
- **신규 npm/네이티브 의존성 0**: §0.1·T6(copy는 인라인 플러그인·`vite-plugin-static-copy` 미도입) 명시.

---

## 경미 권고 (PASS — 반영 선택·비차단)

### [권고-A] verify 분배 모호성 미세 정리
- 위치: T5 "병합 분기 일부는 `verify:store` 에 흡수 가능" / §6-3 "특히 `verify:store`(contextMenu 병합 분기·B6 기존 항목 수 불변)".
- 문제: 병합 분기(단일+로컬+ready→N개 / 다중→0 / empty→0 / loading→1행)를 `verify:shellverbs`와 `verify:store` 중 어디서 단언할지 "흡수 가능"으로 양다리. 구현자가 둘 다 비우거나 중복 작성할 여지(미세).
- 권고: 1차 단언 위치를 한쪽으로 못박기(예: 순수 병합 분기는 `verify:shellverbs`, B6 기존 항목 수·순서 불변 회귀는 `verify:store`). 비차단.

### [권고-B] T6 `__dirname` asar 보정의 dev/prod 경로 검증을 DoD에 1줄
- 위치: T6 `resolveWorkerScriptPath()`·DoD.
- 문제: `app.isPackaged ? __dirname.replace('app.asar','app.asar.unpacked') : __dirname` 보정은 HashManager 워커(`.js`·asar 내부 직접 로드)와 달리 `-File` 외부 읽기라 prod에서만 검증 가능. DoD가 `npm run dist` "가능 시"로 약하게 둠(현 환경 한계상 타당).
- 권고: 실 패키지 검증이 미수행으로 남으면 §8 R1과 동일하게 🟡로 명시 유지(이미 정직 표기됨 — 표기 일관성 차원). 비차단.

### [권고-C] `open with`/`연결 프로그램으로 열기` 블랙리스트 미포함의 PoC 확정 시점 명시 보강
- 위치: §3·§8 R4.
- 문제: §3은 `open with`를 "정확 일치 시만 필터·1차 미포함(노출)"으로, R4는 "PoC 열거 표시명 확인 후 T2에서 미세 조정"으로 둠. ADR-013 결정④와 정합하나, 수용기준 3(블랙리스트)의 "등"에 포함되는지 1차 노출 결정이 features §Y1 PoC 16종(`&Open`·`Copy as path` 등)과 어긋날 여지는 없음(노출은 안전측). 다만 최종 사전 확정 책임이 T2 구현자에게 위임됨이 명확하면 좋음.
- 권고: R4에 "사전은 `shellVerbsBlacklist.ts` 단일 출처·변경 시 T5 verify 케이스 동반 갱신" 1줄(이미 §8 R4에 "verify로 즉시 검증" 적힘 — 표기 충분). 비차단.

---

## 확인 필요(사용자 판단)
- 없음(차단 쟁점 0). UQ-Y1~Y5·권고-A~C 모두 구현 단계에서 흡수 가능하며 진행을 막지 않는다. R1(asar ps1 경로)·R2(PS 5.1 stdin 인코딩)는 실 패키지/실 PS 환경에서만 최종 확정되는 정직 한계(🟡)로, 계획이 폴백(인라인 `-Command -`·`InputEncoding` 헤더)을 갖춰 비차단.

---

## 결론
**PASS — 그대로 구현(team-dev) 진행 가능.** 설계 정합(EVERB 유니온 확장·실패 ok 흡수 모두 합리적 구체화)·실행 가능성(전 참조 심볼 실코드 실재)·권고 4건 흡수·검증 계획·수용기준 10개 커버리지·금지선 준수가 모두 충족된다. 경미 권고 3건은 구현 단계에서 자연 흡수되는 선명도 보강이다.
