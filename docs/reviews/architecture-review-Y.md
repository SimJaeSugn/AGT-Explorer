# 아키텍처 설계 검증 보고 — §Y Windows 셸 컨텍스트 메뉴 연동 (ADR-013 / 에픽23·US-23.1·F37)

- 검증 대상: `docs/architecture/adr/ADR-013-shell-context-menu-verbs.md`(신규), `ADR-000-index.md`(행 추가), `traceability.md §1-Y`(신규), `directory-structure.md §Y`, `software-architecture.md §15`, `system-architecture.md §5-PU.1`(갱신분)
- 기준 문서: `features.md §Y/§Y1`(수용기준 10개·비범위 3건), `user-stories.md US-23.1`, `flows.md F37`, `planning-review-Y.md`(기획 PASS·권고 2건), `ADR-003`(IPC 계약), `ADR-005`(보안 모델)
- 검증일: 2026-06-12 · 검증자: 독립 Reviewer(제3자) · 범위: 설계 추적성·근거·정합·구현 착수 가능성(코드 동작 검증 제외 — 구현 전)

---

## 판정: **PASS**

## 요약
ADR-013은 기획에서 사용자가 확정한 기술 방향(COM `Verbs()`/`DoIt()`·상주 PowerShell 워커·네이티브 0·IPC 2종) 안에서 계약·프로토콜·verb 식별·블랙리스트·보안 경계를 정확히 확정했고, features §Y1 수용기준 10개가 traceability §1-Y 두 행으로 빠짐없이 매핑된다. 대안 비교(COM vs N-API vs 레지스트리 정적 vs Electron)·비채택 사유·정직 한계가 충실하다. ADR-005(명령행 합성 0·sender·zod·guardPath·로컬 한정·실행 표면 미추가)와 ADR-003(invoke/Result/zod) 규약을 전면 준수하며, 실코드 선례(`showProperties` COM `Verbs()`/`DoIt()`/`-replace "&",""`·`HashManager` 워커 수명·`shell:*` 채널 네이밍·`preload` shell 래퍼)와 일치한다. 신규 채널 2종은 기존 코드베이스에 이름 충돌이 없고(grep 0), 6개 문서가 모순 없이 추가 전용으로 편입됐다(git diff: PRD -1은 기획단계 헤더 일자뿐). 상태 표기는 전부 "🔜 설계 완료·구현 전"으로 정직하다(✅ 위장 0). UQ 5건은 비차단 분류가 적절하다. 깐깐하게 본 4개 기술 쟁점(index 안정성·유니코드·fire-and-forget ok 판정·타임아웃 큐 정합)도 모두 설계에 명시적으로 다뤄졌다. **그대로 구현(team-dev) 단계로 진행 가능하다.** 경미 권고 4건만 후속 참고로 남긴다.

---

## 체크리스트 결과

### 1. 추적성 (features §Y1 수용기준 10개 → 설계 매핑) — PASS
traceability §1-Y 2개 행 + ADR-013 결정 ①~⑥에 수용기준 10개가 전부 매핑된다(유령 매핑 0 — 참조한 기획 항목 §Y1·US-23.1·F37·정직 한계 ①~⑤·비범위 3건이 모두 실재).

| # | features §Y1 수용기준 | 설계 매핑 위치 | 판정 |
|---|---|---|---|
| 1 | "Windows 메뉴" 섹션 표시·`Verbs()` 열거 항목 노출 | §1-Y 행1·결정⑥(병합 지점 buildMenuItems 말미)·결정②(조회 op) | ✅ |
| 2 | 다중 선택 시 섹션 숨김 | 결정⑥(`!multi && single` 경로 한정)·§1-Y 정직 한계③ | ✅ |
| 3 | 중복 verb 블랙리스트(open/cut/copy/**paste**/delete/rename/properties) | 결정④ 확정표(paste 포함=권고-2 해소)·§1-Y | ✅ |
| 4 | 서브메뉴 평탄화/누락 best-effort·크래시/빈 섹션 없음 | 트레이드오프·결정⑥(실패/빈→비노출)·정직 한계① | ✅ |
| 5 | `DoIt()` 실행·fire-and-forget | 결정②(invoke 응답)·결정⑤(ok=DoIt 호출)·결정⑥ | ✅ |
| 6 | 로딩 상태·상주 워커 비차단 | 결정②(lazy·타임아웃)·결정⑥(winVerbs status loading)·정직 한계⑤ | ✅ |
| 7 | COM Shell.Application·N-API 비채택·신규 네이티브 0·채널 2종 | 결정①(대안표)·결정⑤·근거 | ✅ |
| 8 | 우클릭한 실제 경로만·임의 합성/실행 표면 0·ADR-005 | 결정⑤(보안 경계·신뢰 경계 명시) | ✅ |
| 9 | B6 충돌·회귀 없이 섹션만 추가 | 결정⑥("B6 자체 명령 산출 불변·섹션만 추가") | ✅ |
| 10 | 비범위 3건(HMENU·서브메뉴 완전 재현·다중 invoke) | 결정①(N-API 과설계)·트레이드오프·§1-Y 비범위 | ✅ |

### 2. ADR 품질(대안 비교·트레이드오프·정직 한계) — PASS
- 결정① 4행 대안표(COM 채택 / N-API 비채택[원칙 위배] / 레지스트리 정적 비채택[누락 과다] / Electron 불가)에 장단점·판정·근거가 모두 있다. N-API 비채택을 "과설계(1차 비범위가 이미 서브메뉴 완전 재현 제외)" 근거로 보강 — 타당.
- 결정②~④에 워커 모델(Worker Threads vs 자식 프로세스 선택 근거)·verb 식별 3단 폴백·블랙리스트 표시명 정규화가 각각 근거와 함께 결정됨.
- 트레이드오프 4건·정직 한계(결정④ 3건)·상주 프로세스 비용이 은폐 없이 기술됨. 과설계 아님(직렬 큐·평탄 목록·표시명 매칭으로 최소 설계).

### 3. ADR-005 정합(명령행 합성 0·신뢰 경계) — PASS
- 명령행 합성 0: 결정②(stdin JSON 페이로드·고정 ps1·`ParseName` 인자로만)·결정⑤가 `showProperties` env 전달 원칙과 동치임을 명시. 실코드 `src/main/os/shell.ts#showProperties`(line 188-200: `$env:EXPLORER_PROP_DIR`·`-replace "&",""`·문자열 보간 0)가 정확한 선례 — 설계의 PowerShell 패턴이 실재 검증된 경로를 상주판으로 확장한 것임을 확인.
- 신뢰 경계 명시: 결정⑤ "신뢰 경계 명시(중요)" 단락이 `shell:invoke-verb`=임의 외부 프로그램 실행임을 정직히 인정하되 ①실행 대상=사용자 우클릭 경로의 셸 verb뿐 ②verb 목록=OS 셸 결정 ③fire-and-forget로 "새 실행 표면 미추가=탐색기 우클릭과 동일 신뢰 모델"임을 논증 — ADR-005 §3.3-4(line 49 "명령행 조립 금지")와 정합.

### 4. ADR-003 정합(Result·zod·sender·이름 충돌) — PASS
- Result shape: 결정⑤가 `Result<{verbs}>`·`Result<void>` 사용(ADR-003 line 18 `Result<T,FileOpError>` 판별 유니온 규약 일치).
- zod·sender·guardPath: 결정⑤가 `zShellContextVerbsReq`/`zShellInvokeVerbReq`·`isTrustedSender`·`guardPath`+`fs.access`를 `shell:open`/`show-properties` 3중 검증과 동형으로 명시.
- 이름 충돌 0: `src` 전체 grep에서 `shell:context-verbs`·`shell:invoke-verb`·`SHELL_CONTEXT_VERBS`·`SHELL_INVOKE_VERB` 부재(구현 전이므로 정상·충돌 없음). 기존 `channels.ts`의 `shell:*` 6종(open/open-with/show-properties/icon/open-terminal/open-external)과 네이밍 규약 일치·중복 없음. `preload/api.ts`의 shell 네임스페이스(line 213-217·407-413)에 `contextVerbs`/`invokeVerb` 추가가 기존 래퍼 패턴과 동형.

### 5. 기술적 타당성(깐깐) — PASS
- **(a) verbId index+표시명 교차검증**: 결정③이 `FolderItemVerbs`가 위치 기반 컬렉션이고 조회↔실행 사이 순서 변동 가능함을 정확히 인지. 실행 시 **재열거 후** ① index의 정규화 display 일치=실행 ② 불일치=전체 표시명 매칭 폴백 ③ 없음=`EVERB` 실행 거부(오실행<미실행)의 3단 처리로 순서 변동을 구조적으로 흡수. COM Verbs() 동작과 정합.
- **(b) 유니코드 인코딩**: 결정② "인코딩: stdin/stdout UTF-8 고정(`[Console]::OutputEncoding`·한글 표시명 보존)" 명시. PoC가 실제 한글 표시명("반디집으로 압축하기")을 다루므로 필수 사항이 다뤄짐(아래 권고-1: PowerShell 5.1 stdin 입력 인코딩 측면 보강 여지).
- **(c) fire-and-forget ok 판정**: 결정⑤·system-arch §5-PU.1이 "ok=DoIt 호출 성공(외부 프로그램 결과 미추적)·EVERB=stale/미존재·ENOENT=경로 소실"로 ok 의미를 모순 없이 정의. fire-and-forget이 "DoIt 호출까지의 동기 성공"으로 한정돼 모순 없음.
- **(d) 타임아웃·큐 정합**: 결정② "타임아웃은 워커를 죽이지 않는다(다음 요청 재시도)"·"stale-cancel(새 경로 조회 오면 이전 미완 폐기)"·"id 상관"·FIFO 직렬화로 늦게 도착하는 응답의 정합을 다룸(아래 권고-2: 타임아웃 후 늦은 응답의 id 폐기 규칙을 한 줄 더 명시하면 견고).

### 6. 문서 정합·무손상 — PASS
- 6개 문서 모순 0: 채널명(`shell:context-verbs`/`shell:invoke-verb`)·verbId 형식(`<index>:<정규화표시명>`)·블랙리스트(paste 포함)·정직 한계가 ADR·traceability·directory·software-arch·system-arch에서 일관.
- 무손상(git diff --stat): ADR-000-index +2, directory +32, software-arch +19, system-arch +8, traceability +14 — 전부 추가 전용. PRD -1은 기획단계 헤더 일자 교체(planning-review-Y에서 이미 확인된 허용분)로 본 설계분과 무관. 기존 내용 삭제·변경 0.
- 상태 정직: ADR-013·§1-Y·directory §Y·software §15·system §5-PU.1·ADR-000 모두 "🔜 설계 완료·구현 전" 일관 표기. §1-Y가 "아래 파일/심볼은 예정 구현 대상(아직 코드 없음·유령 매핑 아님)"을 명시 — ✅ 위장 방지 충실.

### 7. 구현 착수 가능성 — PASS
- 신규/수정 파일 목록이 실코드 구조와 일치(Glob 확인): `src/main/os/shell.ts`·`src/renderer/app/usecases/contextMenu.ts`·`src/renderer/ui/contextmenu/ContextMenu.tsx`·`src/main/ipc/shell.handlers.ts`·`src/shared/ipc/channels.ts`·`src/main/hash/HashManager.ts`(워커 수명 선례)·`src/renderer/infra/api/index.ts`·`src/preload/api.ts` 전부 실재. 신규 `shellVerbs.ts`/`shellVerbsWorker.ps1`만 추가(`os/` 계층 — 타당).
- UQ 5건(ps1 패키징·직렬화 방식·다국어 사전·캐시 위치·crash 쿨다운 임계)은 모두 1차 결정 + 후속 트리거가 있어 비차단 분류 적절 — 구현자가 추가 결정 없이 착수 가능.

---

## 경미 권고 (PASS — 반영 선택)

### [권고-1] PowerShell stdin **입력** 인코딩 명시 보강
- 위치: ADR-013 결정② "인코딩" 줄 / `shellVerbsWorker.ps1` 설계.
- 문제: 출력은 `[Console]::OutputEncoding` UTF-8로 명시됐으나, **stdin 입력 인코딩**(`[Console]::InputEncoding`·`$input` 읽기) 측은 한 줄 부족. Windows PowerShell 5.1(시스템 기본)은 콘솔 입력 기본 코드페이지가 비-UTF-8일 수 있어, 한글 경로/verbId가 stdin JSON으로 들어올 때 깨질 여지가 있다(PowerShell 7+는 UTF-8 기본).
- 권고: `shellVerbsWorker.ps1`에 `[Console]::InputEncoding = [Text.Encoding]::UTF8`(또는 `chcp 65001` 상당)을 입력에도 명시. 구현 단계 처리 가능·비차단.

### [권고-2] 타임아웃 후 "늦게 도착하는 응답"의 id 폐기 규칙 1줄 명시
- 위치: ADR-013 결정② 타임아웃/직렬화 단락.
- 문제: "타임아웃은 워커를 죽이지 않고 다음 요청 재시도"는 명시됐으나, 타임아웃으로 reject한 요청의 응답이 뒤늦게 stdout으로 도착했을 때(특히 직렬 큐에서 다음 요청과 id가 다르므로 무해하나) "미상관 id 응답은 폐기"라는 라인 버퍼 파서 규칙이 암묵적이다.
- 권고: "in-flight 맵에 없는 id 응답은 폐기(stale)"를 결정②에 1줄 추가하면 (d) 큐 정합이 더 명확. 현재도 id 상관 설계로 사실상 안전 — 표기 선명도 차원.

### [권고-3] 결정⑥ `uiSlice` 상태 형상과 §1-Y 표기 일치(미세)
- 위치: ADR-013 결정⑥ `winVerbs: { status: 'loading'|'ready'|'empty'; ... }` ↔ traceability §1-Y `status:'loading'|'ready'|'empty'`.
- 문제: 일치함(모순 0). 다만 features §Y1 로딩 상태 외에 "조회 실패/타임아웃→비노출"이 `empty`로 흡수되는지 `error` 별도 상태인지 1차 형상이 `empty`로 통합돼 있음(설계 의도로 보이나 명시 약함).
- 권고: `empty`가 "빈 목록·실패·타임아웃 모두 섹션 비노출"을 포괄함을 결정⑥에 1구절 부기하면 구현자 모호성 0. 비차단.

### [권고-4] `shellVerbsWorker.ps1` 패키징(UQ-Y1)과 코드서명/asar 상호작용 후속 메모
- 위치: ADR-013 UQ-Y1 / directory-structure §Y `electron-builder.yml extraResources`.
- 문제: extraResources `.ps1` 외부 파일은 P7 코드서명(앱 서명 범위)·PowerShell 실행 정책(ExecutionPolicy)·SmartScreen과 상호작용할 수 있다. UQ-Y1이 "인라인 here-string `-Command -` 전환"을 폴백으로 두어 비차단은 맞으나, `-File <ps1>`이 서명 안 된 스크립트에 대한 ExecutionPolicy 차단을 받을 가능성(`-File`은 정책 적용·`-Command`는 상대적 완화)은 후속 트리거에 한 줄 더 둘 가치가 있다.
- 권고: UQ-Y1 후속 트리거에 "ExecutionPolicy/스크립트 서명 이슈 시 인라인 `-Command -`로 전환(여전히 경로는 stdin)"을 명시(이미 폴백 방향은 적힌 상태 — 트리거 사유에 ExecutionPolicy 1단어 보강). 비차단.

---

## 확인 필요(사용자 판단)
- 없음(차단 쟁점 0). UQ 5건·권고 4건 모두 구현 단계에서 흡수 가능하며 진행을 막지 않는다. 마일스톤 "M10 가칭"은 기획 검증 권고-1과 동일한 표기 모호성(파워기능 M9 이후 신규 Should)으로, PRD §12에서 이미 분리 표기됐으므로 비차단.

---

## 결론
**PASS — 그대로 구현(team-dev) 단계 진행 가능.** 추적성·근거·ADR-005/003 정합·실코드 선례 일치·무손상·정직 표기 모두 충족하고, 깐깐히 본 4개 기술 쟁점(index 안정성·유니코드·fire-and-forget·타임아웃 큐)도 설계에 다뤄졌다. 경미 권고 4건은 구현 단계에서 자연 흡수되는 선명도/견고성 보강이다.
