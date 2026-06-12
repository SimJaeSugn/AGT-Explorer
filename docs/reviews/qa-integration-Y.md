# QA 통합 검증 보고 — §Y Windows 셸 컨텍스트 메뉴 연동 (Y1·US-23.1·F37·T1~T6)

> 검증자: qa-engineer · 2026-06-12 · 대상 브랜치/working tree(미커밋 §Y 변경)
> 기준: features §Y1(수용기준 10개)·flows F37·docs/pm/Y-implementation-plan.md DoD·ADR-013
> 방법: 제3자 직접 실행(빌드/타입/verify/노드 스모크) + 경계면 코드 교차 정독. 보고 신뢰 아님.

## 최종 판정: **PASS** (헤드리스·코드정합·실 노드 워커 왕복까지 ✅ / 실 GUI·실 패키지 설치본은 🟡)

---

## 1. 빌드·타입·verify 결과 (직접 실행)

| 항목 | 결과 |
|---|---|
| `npm run typecheck`(node+web) | **PASS** (tsc 0 에러) |
| `npm run build`(typecheck+electron-vite) | **PASS** (exit 0·청크 경고는 기존부터 존재·§Y 무관) |
| `out/main/shellVerbsWorker.ps1` 존재 | **존재** (4883B·electron.vite copy-ps1 인라인 플러그인) |
| `electron-builder.yml asarUnpack: ['**/shellVerbsWorker.ps1']` | **존재** |
| `npm run verify:shellverbs` | **75 passed / 0 failed** (주장 75 일치) |
| 변경 §Y 파일 ESLint(8파일) | **0** |

### verify:* 전체 회귀 스윕 (36개 스크립트 전부 실행)

| 스크립트 | 결과 | 스크립트 | 결과 |
|---|---|---|---|
| fs | 19/0 | thumbnail | 33/0 |
| ops | 35/0 | clipboard-hdrop | 43/0 |
| **worker** | **FAIL(exit1)** ⚠️ 사전부터 존재 | dnd | 29/0 |
| persistence | 147/0 | store | 281/0 |
| scan | 39/0 | domain | 204/0 |
| concurrency | 63/0 | operations | 75/0 |
| hash | 46/0 | p5 | 52/0 |
| queue | 47/0 | paste | 13/0 |
| search | 58/0 | eslint-remote | 29/0 |
| perf | 25/0 | credentials | 17/0 |
| fmatrix | 32/0 | remote | 24/0 |
| contrast | 0실패 | remote-trust | 42/0 |
| watch | 77/0 | remote-route | 47/0 |
| recyclebin | 37/0 | palette | 20/0 |
| p6 | 26/0 | contentsearch | 38/0 |
| open-with | 12/0 | autolink | 13/0 |
| shell-h4h6 | 25/0 | archiveui | 43/0 |
| **shellverbs** | **75/0** | archive | 56/0 |

- **`verify:worker` FAIL은 §Y 회귀가 아님(사전 환경 결함).** 동일 실패가 §Y 변경을 제외한 clean HEAD(working tree stash)에서도 재현됨: `Error: fatal: {"code":"EUNKNOWN","message":"Invalid atomic access index"}` — Node 22.17 워커 스레드 SharedArrayBuffer atomics(hash/queue 워커) 환경 이슈. `verify-worker.ts`는 shellverbs를 일절 참조하지 않음(grep 0). §Y 채널/계약/핸들러와 무관.
- §Y 신규 핵심(`verify:shellverbs` 75) + 회귀 민감 스윕(`store` 281·`domain` 204·`shell-h4h6` 25·`open-with` 12) 전부 0 fail → **B6 컨텍스트 메뉴·기존 shell:* 회귀 0**.
- **검증 케이스 합계(worker 제외 35개 스크립트): 약 1,898 passed / 0 failed**(신규 shellverbs 75 포함).

---

## 2. 경계면 교차 비교 (shape 정합 — 코드 정독)

### IPC 체인 (필드명·에러코드·empty 규약 불일치 0)
`channels.ts(SHELL_CONTEXT_VERBS/SHELL_INVOKE_VERB)` → `contracts.ts(ShellContextVerbsReq/Res·ShellInvokeVerbReq + ChannelMap 2줄)` → `dto/index.ts(ShellVerbDTO{verbId,display} + FileOpErrorCode | 'EVERB')` → `guard.ts(zShellContextVerbsReq·zShellInvokeVerbReq)` → `shell.handlers.ts(2핸들러)` → `preload/api.ts(타입+구현 invoke 위임)` → `infra/api/index.ts(shellApi.contextVerbs/invokeVerb)` → `usecases/shellVerbs.ts(유일 호출부)`. **전 구간 심볼·시그니처 일치(typecheck PASS가 ChannelMap 누락을 컴파일 강제).**

### ps1 ↔ 파서 shape 정합
- ps1 list 응답 `{id, ok:true, verbs:[{index,name,display}]}` ↔ `shellVerbs.ts WorkerResponse`/`RawShellVerb{index,name,display}` 일치.
- ps1 `display = ($name -replace '&','')`(`&`만 제거) ↔ `filterVerbs`가 verbId·라벨에 ps1의 `display` 그대로 사용 → **invoke 재열거 교차검증이 동일 규칙(`$v.Name -replace '&',''`)으로 매칭**(불일치 위험 0). 블랙리스트 매칭만 별도 `normalizeVerbName`(소문자·`(...)` 제거) 사용 — 의도적 분리·일관.
- 에러 코드 ps1 `ENOENT|EVERB|EUNKNOWN` ↔ 서비스 매핑(`invokeVerb`: ok→ok·EVERB→err(EVERB)·ENOENT→err(ENOENT)·그외→EUNKNOWN) ↔ 핸들러 전파 ↔ usecase `invokeErrorMessage`(EVERB/ENOENT/default) 일치.
- **empty 단일 규약**: `listVerbs`가 빈목록·실패·타임아웃·spawn 불가·미존재를 **모두 `ok({verbs:[]})`** 로 수렴 → 핸들러도 미존재 시 `ok({verbs:[]})` → usecase `status:'empty'` → `buildWinVerbsSection` 빈 배열(섹션 비노출). 권고-3 포괄 충족.

### 핸들러 보안 시퀀스 (기존 shell:* 동일 수준)
`context-verbs`/`invoke-verb` 둘 다: `isTrustedSender` → `parseArgs(zod)` → **로컬 한정(원격 `sftp://`/`ftp://`/`ftps://`·`archive://` prefix 거부, raw 입력에서 guardPath 전)** → `guardPath`(상위이탈 차단) → `fs.access(F_OK)`. shell:open/show-properties 3중 검증과 동형(오히려 prefix 거부를 정규화 전에 둬 더 보수적). **핸들러 throw 0**(전 분기 Result). ADR-005 명령행 합성 0: ps1에 `Invoke-Expression`/`Start-Process`/`cmd.exe` 부재·경로/verbId는 `$req.path`/`$req.verbId`로만 사용.

---

## 3. 수용기준 10개 충족 판정 (§Y1)

| # | 수용기준 | 판정 | 코드 근거 |
|---|---|---|---|
| 1 | 단일 우클릭 시 하단 "Windows 메뉴" 섹션 + 셸 verb 노출 | **충족(코드)·🟡 실표출** | `contextMenu.ts#buildMenuItems` 291-294(속성 그룹 다음 append)·`buildWinVerbsSection`(separator+verb 행). **노드 스모크에서 실 COM verb 9개 열거 실증**(반디집/Cursor/AGT-Finder). 실 메뉴 픽셀 표출만 🟡 |
| 2 | 다중 선택 시 섹션 숨김 | **충족** | `!multi && single` 게이트(multi=size>1)·`openRowContextMenu`도 size===1일 때만 loadWinVerbs. verify merge "다중→0개" PASS |
| 3 | 자체구현 verb(open/cut/copy/paste/delete/rename/properties 등) 비노출 | **충족** | `shellVerbsBlacklist.BLACKLIST`(영/한 8쌍)·`filterVerbs`. **노드 스모크 실 결과 누출 0**(원 PoC의 &Open/Cut/Copy/Delete/Rename/Properties 전부 제거 확인). verify 정규화 12 PASS |
| 4 | 캐스케이드 서브메뉴 평탄화/누락 best-effort·크래시/빈 섹션 없음 | **충족** | ps1 `Verbs()` 평탄 열거(서브메뉴 미재귀)·empty 단일 규약으로 빈 섹션 비노출. 정직 한계 ① 명시 |
| 5 | verb.DoIt() 실행·fire-and-forget·실패만 토스트 | **충족(코드)·🟡 실DoIt** | ps1 `$chosen.DoIt()`·서비스 ok/EVERB/ENOENT·`invokeWinVerb`(성공 무음·실패 pushToast). **노드 스모크 가짜 verbId→EVERB 거부 실증**(외부 실행 안 함). 실 외부앱 기동만 🟡 |
| 6 | 로딩 상태 허용·상주 PowerShell 워커·비차단 | **충족(코드)·🟡 실지연** | `loadWinVerbs` loading 세팅·`buildWinVerbsSection` 로딩 행·`ShellVerbsService` lazy 상주 child_process·1500ms 타임아웃·FIFO. **노드 스모크 상주 워커 왕복 실증**. 실 우클릭 체감 지연만 🟡 |
| 7 | COM Shell.Application(Verbs/DoIt)·네이티브/신규 의존성 0·신규 IPC 2종 | **충족** | ps1 `New-Object -ComObject Shell.Application`·`Verbs()`/`DoIt()`. package.json 의존성 무변경(yauzl/yazl 외 신규 0)·채널 정확히 2종(context-verbs·invoke-verb)·EVENT_CHANNELS 무변(invoke만) |
| 8 | 우클릭한 실제 경로에만·임의 명령 합성 없음·ADR-005 | **충족** | 핸들러 로컬한정+guardPath+access·ps1 명령행 합성 0(grep 0)·경로는 stdin JSON 본문만 |
| 9 | 기존 B6 명령(열기·복사·삭제·속성·빈영역)과 충돌·회귀 없이 섹션만 추가 | **충족** | append-only(diff 60+/4-·삭제 4줄은 aria-disabled/style 인플레이스·기존 비활성행 동작 동치). `verify:store` 281·기존 메뉴 케이스 0 회귀 |
| 10 | 네이티브 팝업·서브메뉴 완전재현·다중 invoke = 비범위 | **충족(설계상 비범위)** | 1차 미구현이 의도(features/flows 비범위표 일치) |

**판정 요약: 10/10 충족(코드 정합)** — 그중 #1·#5·#6은 실 노드 워커 왕복으로 핵심 동작까지 실증, 잔여(픽셀 표출·실 외부앱 기동·실 우클릭 지연)만 🟡.

---

## 4. 회귀 점검

- **contextMenu.ts/uiSlice.ts/ContextMenu.tsx diff = append-only.** 삭제 4줄: `aria-disabled={false}`→`item.disabled?true:undefined`(비-disabled 행 = undefined ≈ 기존), color/background에 `item.disabled` 분기 추가(disabled=undefined인 기존 항목 동작 불변). 기존 B6 산출 코드 무변경.
- **`FileOpErrorCode | 'EVERB'` 안전.** 소비처 switch(open.ts·archive.ts)는 string code + `default` 분기 → EVERB는 default 흡수, 미처리 분기/타입에러 0(typecheck PASS). EVERB 전용 분기는 `shellVerbs.ts#invokeErrorMessage`에만.
- **before-quit dispose 안전.** `src/main/index.ts:58-63` try/catch 격리·기존 watchService.stopAll/remote/archive 정리 다음·flush 앞 배치 → 종료 시퀀스 무손상. 멱등.
- **EVENT_CHANNELS 무변**(신규 채널 2종 invoke).

## 5. 일회성 실 노드 스모크 (Electron 없이·독립 재검·완료 후 임시파일 삭제)

실 `powershell.exe -File shellVerbsWorker.ps1` transport로 `ShellVerbsService` 직접 구동:
- **[1] 한글경로 list 왕복**: `package.json`(cwd에 `04.개발환경` 한글) → 9 verbs·한글 표시명 보존("반디집으로 압축하기"/"Cursor(으)로 열기"/"AGT-Finder로 열기"). **블랙리스트 실 필터: 자체구현 verb 누출 0(PASS)**.
- **[2] ENOENT**: 미존재 경로 → 빈 verbs 흡수(섹션 비노출).
- **[3] EVERB**: 가짜 verbId invoke → `err(EVERB)`·**외부 프로그램 미실행**(거부 경로만 — 실 verb 실행 안 함).
- **[4] dispose 좀비 0**: dispose 후 워커 pid 생존=false.

→ "상주 워커 기동→조회→JSON 응답→dispose" 왕복이 Electron 없이 node 단독 구동 가능함을 실증(electron import 0).

## 6. 정직 한계 (🟡 — doc-sync 게이트 입력·✅위장 금지)

헤드리스 verify·노드 스모크·코드정합·빌드까지 ✅. **다음은 Electron 앱 실행 GUI/실 패키지에서만 확정(🟡)**:
1. 실 GUI: 우클릭→"Windows 메뉴" 섹션 픽셀 표출·로딩→채움→숨김 전환·로딩 행 흐림 스타일.
2. 실 verb 실행: 항목 클릭→외부 프로그램/대화상자 실 기동(노드 스모크는 EVERB 거부 경로만, 실 DoIt 미수행).
3. 실 우클릭 체감 지연·상주 워커 첫 기동 지연 완화(비차단 실측).
4. 실 패키지 설치본 ps1 경로 해석(`app.asar.unpacked`)·ExecutionPolicy Bypass 실 동작 — `npm run dist` 미수행(빌드 out/main 배치까지만 확인).
5. 영/한 외 OS 언어 블랙리스트 미필터(중복 표시·무해)·캐스케이드 서브메뉴 누락 범위(best-effort).
6. 사전 결함(§Y 무관): `verify:worker` Node22 atomics 실패 — §Y 회귀 아님.

## 발견 결함
- **블로커/높음/보통: 0건.** §Y 구현은 수용기준 10개·설계 계약(ADR-013)·DoD를 코드 정합+실 노드 워커 왕복 수준에서 충족.
- 참고(낮음·§Y 무관): `verify:worker` 사전 환경 실패 — 별도 트랙. 키보드 `step()`이 로딩 disabled 행을 건너뛰지 않음(클릭 무동작이라 무해·계획상 "선택" 사항).
