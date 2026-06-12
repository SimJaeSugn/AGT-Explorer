# ADR-013 — Windows 셸 컨텍스트 메뉴 연동 (Shell.Application Verbs·상주 PowerShell 워커)

상태: 제안 · 2026-06-12 · **🔜 설계 완료·구현 전**
관련 기획: PRD §6 Should(2026-06-12 §Y)·§8 단축키(신규 키 불요) · features §Y/§Y1 · user-stories 에픽23(US-23.1) · flows F37
관련 설계: [ADR-005 프로세스/보안 모델](./ADR-005-process-security-model.md)(쉘 실행 검증·명령행 합성 0 준수) · [ADR-003 IPC 계약 스타일](./ADR-003-ipc-contract-style.md)(invoke/handle·Result·sender·zod) · `main/os/shell.ts#showProperties`(COM `Shell.Application`·`Verbs()`/`DoIt()`·env 경로 전달 선례) · `main/hash/HashManager.ts`·`main/workers/hashWorker.ts`(워커 수명·jobId·취소 선례) · `renderer/app/usecases/contextMenu.ts`·`ui/contextmenu/`(B6 컨텍스트 메뉴 인프라)

> **이 ADR이 다루는 것**: §Y1은 파일/폴더 우클릭 시 앱 컨텍스트 메뉴(B6) 하단에 "Windows 메뉴" 섹션을 더해, Windows에 설치된 프로그램이 등록한 셸 컨텍스트 메뉴 항목(예: "반디집으로 압축하기"·"Cursor로 열기"·"AGT-Finder로 열기")을 노출·실행하는 상호운용 기능이다. 본 ADR은 ① 셸 verb 접근 방식(COM vs 네이티브 N-API vs 레지스트리 정적), ② 상주 PowerShell 워커 프로토콜, ③ verb 식별(스테일 메뉴·오실행 방지) 전략, ④ 중복 verb 블랙리스트 전략, ⑤ 보안 경계, ⑥ 정직 한계를 결정한다. 기술 방향(COM `FolderItem.Verbs()`/`verb.DoIt()`·상주 PowerShell 워커·신규 네이티브 의존성 0·신규 IPC 2종)은 **기획에서 사용자가 확정**했고, 본 ADR은 그 안에서 정확한 계약·프로토콜·식별·필터·경계를 확정한다.

---

## 맥락

기존 B6 컨텍스트 메뉴는 앱 자체 명령(열기·연결프로그램·복사/잘라내기/이름변경·삭제·속성·태그·고정 등)만 노출한다(`renderer/app/usecases/contextMenu.ts#buildMenuItems`). 사용자는 별도로 Windows 탐색기를 열어 우클릭해야 설치 프로그램의 셸 항목(압축·외부 앱으로 열기 등)을 쓸 수 있었다. §Y1은 그 셸 항목을 앱 메뉴 하단 "Windows 메뉴" 섹션에 **병합 렌더**해 상호운용성을 높인다.

제약(features §Y1·ADR-005):
- **명령행 문자열 합성 0**: 경로는 stdin JSON 페이로드/환경변수로만 전달, 스크립트 텍스트는 고정(`showProperties` 선례).
- **신규 네이티브 의존성 0·신규 npm 의존성 0**: 네이티브 N-API 셸 애드온 비채택.
- **우클릭 비차단**: COM 호출은 Main/렌더러 스레드를 막지 않아야 한다(우클릭 지연 완화).
- **단일 선택 한정·중복 verb 블랙리스트·fire-and-forget·로딩 상태 허용**(정직 한계 ①~⑤).
- **신규 IPC 채널 2종**(verb 조회·verb 실행) — P1 채널 동결 이후 신기능 신규 채널 선례(`shell:open-terminal`·`analyze:scan:*`·`hash:*`·`archive:*` 등)와 동일 규약(동결 예외 명시).

핵심 결정: ① 셸 verb 접근 방식, ② 워커 모델·프로토콜·수명, ③ verb 식별 전략, ④ 블랙리스트 전략, ⑤ IPC 계약·보안 경계.

---

## 결정 ① — 셸 verb 접근 방식: COM `Shell.Application` + 상주 PowerShell 자식 프로세스(N-API·레지스트리 정적 비채택)

| 후보 | 장점 | 단점 | 판정 |
|---|---|---|---|
| **COM `Shell.Application` `FolderItem.Verbs()` + 상주 PowerShell 워커(채택)** | 탐색기와 **동일한 verb 집합**(설치 프로그램이 등록한 항목 그대로)·네이티브 빌드 0·`showProperties` 선례·상주로 우클릭 지연 완화 | PowerShell 부팅 비용(상주로 1회 상환)·canonical name 미노출(블랙리스트는 표시명 정규화)·서브메뉴 평탄화 | **채택** |
| 네이티브 N-API 애드온(`IContextMenu`/`IShellExtInit` 직접 호출) | 캐스케이드 서브메뉴·HMENU 완전 재현·canonical 식별 정밀 | **네이티브 빌드·prebuild·ABI 관리 비용**(신규 네이티브 의존성 0 원칙 위배)·크래시가 프로세스 신뢰 경계 침범 | 비채택(원칙 위배) |
| 레지스트리 정적 verb 파싱(`HKCR\*\shell`·`shellex`) | 외부 프로세스 0 | **셸 확장(`ContextMenuHandlers` COM in-proc)**으로 등록된 항목(7-Zip·반디집 등 다수)을 못 잡음·동적 verb 누락·MUI 다국어 해석 불가 | 비채택(누락 과다) |
| Electron `shell`/`Menu` | 내장 | Electron은 임의 셸 verb 열거 API를 노출하지 않음(`shell.trashItem`·`openPath`만) | 불가 |

**채택**: COM `Shell.Application`을 **상주 PowerShell 자식 프로세스**가 호출한다. 매 우클릭마다 PowerShell을 새로 `spawn`하면(=`showProperties` 패턴) 부팅 비용(수백 ms)이 우클릭 지연으로 직결되므로, **프로세스 1개를 상주**시키고 stdin/stdout JSON 라인 프로토콜로 조회/실행 요청을 보낸다(부팅 비용 1회 상환).

> N-API 비채택 근거: 셸 확장의 풍부한 재현(서브메뉴·HMENU)은 매력적이나, 네이티브 빌드·ABI·prebuild 매트릭스 비용과 "신규 네이티브 의존성 0" 원칙을 깬다. §Y1의 1차 비범위가 이미 "네이티브 메뉴 팝업·서브메뉴 완전 재현"이므로 N-API의 이점이 1차 요구를 넘어선다(과설계). 레지스트리 정적 파싱은 in-proc COM 셸 확장 항목을 구조적으로 누락해 "설치 프로그램 항목 노출"이라는 핵심 가치를 못 채운다.

---

## 결정 ② — 상주 PowerShell 워커: 모델·프로토콜·수명주기

### 모델 (Worker Threads 아님 — 자식 프로세스)
hash/scan/grep 워커는 **Worker Threads**(Node fs·CPU)이지만, §Y1은 **PowerShell + COM STA**가 필요하므로 Worker Threads가 아니라 **`child_process` 1개 상주**로 둔다. ADR-005 §(c)/(d)의 "무거운 작업은 별도 처리·Main 비차단" 원칙을 따르되, 실행 주체가 PowerShell이라는 점만 다르다(원격을 Main 스레드 RemoteService에 둔 §M3와 유사하게, "외부 런타임 의존" 작업의 격리 형태가 다름).

- 모듈 위치: **`src/main/os/shellVerbs.ts`**(서비스·워커 수명·요청 큐) — `os/` 어댑터 계층(shell.ts 이웃). COM/PowerShell은 OS 통합이므로 `hash/`·`search/`가 아닌 `os/`에 둔다.
- PowerShell 스크립트: **`src/main/os/shellVerbsWorker.ps1`**(고정 텍스트·stdin 루프) — `electron-vite`/`electron-builder` 리소스로 패키징(asar 외부 또는 extraResources).
- 라이프사이클·요청 큐는 Main(`ShellVerbsService`)이 관리하고, 렌더러와 직접 통신하지 않는다(IPC 핸들러 경유).

### stdin/stdout JSON 라인 프로토콜 (명령행 합성 0)
PowerShell은 `powershell.exe -NoProfile -NonInteractive -Command -`(또는 `-File <스크립트>`)로 **한 번** 기동하고, **경로·요청은 명령행이 아니라 stdin의 JSON 한 줄**로 전달한다(스크립트 텍스트는 고정 — 보간/주입 0).

```text
# Main → PowerShell (stdin, 1요청 = JSON 1줄)
{ "id": "<uuid>", "op": "list",   "path": "<절대경로>" }
{ "id": "<uuid>", "op": "invoke", "path": "<절대경로>", "verbId": "<index>:<정규화표시명>" }
{ "id": "<uuid>", "op": "ping" }

# PowerShell → Main (stdout, 1응답 = JSON 1줄)
{ "id": "<uuid>", "ok": true,  "verbs": [ { "index": 5, "name": "반디집으로 압축하기(&L)", "display": "반디집으로 압축하기" }, ... ] }
{ "id": "<uuid>", "ok": true }                                  # invoke 성공(DoIt 호출됨·결과 미추적)
{ "id": "<uuid>", "ok": false, "code": "ENOENT|EVERB|EUNKNOWN", "message": "..." }
```

- PowerShell은 `$item = (New-Object -ComObject Shell.Application).Namespace($dir).ParseName($leaf)` 로 항목을 얻고 `$item.Verbs()`를 열거한다. 경로는 stdin JSON에서 읽어 ParseName 인자로만 쓴다(문자열 합성 0·`showProperties` env 전달과 동치 원칙).
- 각 응답은 **개행으로 구분된 단일 JSON 라인**(Main이 라인 버퍼로 파싱·`id`로 요청 상관). PowerShell 측 출력은 `ConvertTo-Json -Compress`.
- 인코딩: stdin/stdout UTF-8 고정(`[Console]::OutputEncoding`·한글 표시명 보존).

### 수명주기
- **기동(lazy)**: 첫 verb 조회 요청 시 워커를 spawn(앱 부팅 비용에 셸 워커를 얹지 않음). 비-Windows·spawn 동기 throw는 `shell.ts#spawnDetached`/`execFileNoThrow` 선례대로 흡수해 "섹션 비노출" 폴백.
- **crash 재기동**: `child.on('exit')`/`on('error')` 시 in-flight 요청을 전부 reject(섹션 비노출)하고, **다음 조회 요청 때 1회 재기동**(즉시 무한 재기동 금지·간단). 연속 N회(예: 3회) 기동 실패 시 세션 동안 기능 비활성(쿨다운)으로 토스트 폭주 방지.
- **앱 종료 정리**: `app.on('before-quit')`(또는 `will-quit`)에서 `child.kill()`·stdin end·리스너 해제(좀비 프로세스 방지).
- **타임아웃**: 조회 요청은 **짧은 타임아웃(예: 1500ms)** — 무응답 시 해당 요청만 reject하고 "Windows 메뉴" 섹션 **비노출**(flows F37 "워커 조회 실패/타임아웃 → 섹션 비노출"). 타임아웃은 워커를 죽이지 않는다(다음 요청 재시도).
- **동시 요청 직렬화**: PowerShell COM STA는 단일 스레드이므로 요청을 **FIFO 큐로 직렬화**(이전 응답 수신 후 다음 요청 전송)하거나, `id` 상관으로 다중 인플라이트를 허용하되 1차는 **직렬화(단순·정확)**. 우클릭은 빈번하지 않고 직전 요청은 **stale-cancel**(새 경로 조회가 오면 이전 미완 조회 결과는 폐기)한다.

---

## 결정 ③ — verb 식별 전략: 조회는 (index+정규화표시명) 동반, 실행은 **재열거 후 표시명 우선 매칭**(index는 검증용)

`FolderItemVerbs`는 **위치 기반 컬렉션**(`Item(index)`)이고, 조회와 실행 사이에 셸 상태(메뉴 등록·언어)가 바뀔 수 있다. **순수 index 신뢰는 잘못된 verb 실행(오실행) 위험**, **순수 표시명 매칭은 동명 verb·언어 변동 위험**이 있다. 안전을 위해 **둘을 결합**한다.

- **조회 응답**: 각 verb를 `{ index, name(원문·`&` 포함), display(정규화: `&` 제거·트림) }`로 반환. 렌더러로 보내는 `verbId`는 `"<index>:<display>"` 합성키(안정 식별·React key).
- **실행 시**: 워커가 `verb.DoIt()`을 호출하기 전에 **항목의 Verbs()를 다시 열거**하고:
  1. `Item(index)`의 정규화 display가 요청 `display`와 **일치하면 그 verb 실행**(index 신뢰 + 표시명 교차검증 → 빠르고 안전).
  2. 불일치(메뉴가 바뀜)면 **전체에서 정규화 display가 같은 첫 verb로 폴백**(표시명 매칭).
  3. 그래도 없으면 **실행하지 않고** `EVERB`(stale) 반환 → 렌더러는 무음 또는 "메뉴가 변경되었습니다" 토스트(fire-and-forget).
- **근거**: "스테일 메뉴로 엉뚱한 verb 실행 방지"가 최우선 → **index만 믿지 않는다**. 표시명을 1급 식별자로 두되 index로 빠른 경로 + 교차검증. 불일치 시 실행 거부(오실행 < 미실행).

> 한계: 동일 display verb가 여러 개면(드묾) 첫 항목을 택한다(best-effort). canonical name이 노출되지 않으므로(결정 ④) 표시명이 가장 안정적인 식별자다.

---

## 결정 ④ — 중복 verb 블랙리스트: canonical name 부재 → 표시명 정규화 매칭(다국어 사전) + 한계 정직 표기

§Y1은 "앱이 이미 자체 구현한 verb(open/cut/copy/paste/delete/rename/properties 등)는 노출 안 함"을 요구한다. 문제: **`FolderItemVerb`는 canonical verb name(예: `open`/`delete`)을 안정적으로 노출하지 않고 `Name`(다국어 표시명·`&` 가속기 포함)만 준다**(예: "&Open"/"&열기", "&Delete"/"&삭제(D)"). 그래서 canonical 기준 필터가 불가능하다.

**현실적 전략(표시명 정규화 매칭)**:
1. **정규화**: `Name`에서 `&`(가속기) 제거·앞뒤 공백 제거·소문자화·말미 `(...)` 단축키 그룹 제거 → 정규화 키.
2. **다국어 블랙리스트 사전**: 앱 자체 구현과 중복되는 verb의 **영어+한국어 표시명 집합**으로 매칭(언어 환경 2종 우선 — 영어/한국어. 그 외 언어는 best-effort 미필터·한계 표기).

**확정 블랙리스트(canonical 의도 ↔ 표시명 매칭 집합)** — flows 예외표의 `paste` 누락(reviewer 권고-2)을 여기서 **`paste` 포함으로 확정 해소**:

| canonical 의도 | 매칭할 정규화 표시명(영/한) |
|---|---|
| open | `open` · `열기` |
| cut | `cut` · `잘라내기` |
| copy | `copy` · `복사` |
| **paste** | `paste` · `붙여넣기` |
| delete | `delete` · `삭제` |
| rename | `rename` · `이름 바꾸기` · `이름바꾸기` |
| properties | `properties` · `속성` |
| (link·중복 UX) | `create shortcut` · `바로 가기 만들기` · `link` |

> `copy as path`("경로로 복사")·`open with`("연결 프로그램으로 열기")는 **블랙리스트에서 제외**한다 — 전자는 앱 미제공(노출 가치 있음), 후자는 앱이 별도 항목으로 제공하나 셸의 "연결 프로그램으로 열기" 캐스케이드는 앱 항목과 의미가 겹치므로 **1차는 표시명이 정확히 일치할 때만 필터**(과필터로 유용 항목을 숨기지 않도록 보수적). 최종 사전은 구현 단계에서 PoC 열거 결과(features §Y1 PoC 16종)로 확정한다.

**정직 한계(은폐 금지)**:
- canonical name 부재로 **표시명 정규화 매칭에 의존** → 영어·한국어 외 OS 언어에서는 중복 verb가 필터되지 않고 노출될 수 있다(중복 표시·기능 무해). 1차는 영/한만 보장.
- 가속기 위치·번역체 변형(예: "삭제(&D)" vs "삭제") 차이는 정규화로 흡수하지만, 완전 일치는 보장하지 못한다(best-effort).
- 블랙리스트는 **표시 필터일 뿐**이며, 실행 가능 verb 자체를 OS에서 막는 것이 아니다(안전 무해).

---

## 결정 ⑤ — IPC 계약 & 보안 경계

### 신규 IPC 채널 2종 (`shell:context-verbs` / `shell:invoke-verb`)
기존 `shell:*` 네이밍 규약(`shell:open`·`shell:open-with`·`shell:show-properties`·`shell:open-terminal`·`shell:icon`·`shell:open-external`)에 맞춰 확정한다. 둘 다 **invoke(요청-응답)** → `EVENT_CHANNELS`(푸시) 무변(신규 푸시 0).

```text
shell:context-verbs(req: { path: string })
  -> Result<{ verbs: ShellVerbDTO[] }, FileOpError>      # 단일 항목 verb 조회
     # ShellVerbDTO = { verbId: string; display: string }  (verbId = "<index>:<정규화표시명>")
     # 블랙리스트 필터는 Main(또는 워커)에서 적용 후 반환 → 렌더러는 표시만.

shell:invoke-verb(req: { path: string; verbId: string })
  -> Result<void, FileOpError>                            # verb.DoIt() — fire-and-forget
     # ok = DoIt 호출 성공(외부 프로그램 결과 미추적). EVERB = stale/미존재. ENOENT = 경로 소실.
```

- **채널 상수**: `shared/ipc/channels.ts` `SHELL_CONTEXT_VERBS: 'shell:context-verbs'`·`SHELL_INVOKE_VERB: 'shell:invoke-verb'`(impl 주석 `§Y1`). **동결 예외 명시**: P1 채널 동결 이후 Should/신기능 신규 채널 추가 선례(`shell:open-terminal`·`shell:icon`·`analyze:scan:*`·`fs:watch:*`·`trash:*`·`preview:thumbnail`·`hash:*`·`queue:*`·`archive:*`·`window:*`·`fs:known-folders`)와 동일 규약 — 동결 위반 아님.
- **타입**: `shared/ipc/contracts.ts` `ShellContextVerbsReq/Res`·`ShellInvokeVerbReq`·ChannelMap 항목, `shared/dto/index.ts` `ShellVerbDTO`.
- **zod guard**: `main/ipc/guard.ts` `zShellContextVerbsReq = z.object({ path: zPath })`·`zShellInvokeVerbReq = z.object({ path: zPath, verbId: z.string().min(1).max(512) })`.

### 보안 경계 (ADR-005 정합)
- **sender 검증**: `isTrustedSender`(우리 렌더러 출처만).
- **경로 검증**: `guardPath`(정규화·상위이탈 `..` 차단) + 존재 확인(`fs.access F_OK`) — `shell:open`/`show-properties` 3중 검증과 동형. **로컬 경로 한정**: 원격(`sftp://`/`ftp://`)·archive(`archive://`) prefix는 거부(셸 COM은 로컬 경로만 — hash/search의 원격 prefix 거부 선례).
- **명령행 합성 0**: 경로·verbId는 **stdin JSON 페이로드**로만 워커에 전달, PowerShell 스크립트는 고정 텍스트(ADR-005 §3.3-4·`showProperties` env 전달 원칙).
- **신뢰 경계 명시(중요)**: `shell:invoke-verb`는 **임의 외부 프로그램 실행**이다(설치 프로그램이 등록한 verb를 실행). 그러나 ① 실행 대상은 **사용자가 우클릭한 실제 항목 경로의 셸이 제공하는 verb뿐**(앱이 명령/인자를 합성하지 않음), ② verb 목록은 OS 셸이 결정(앱이 임의 실행 표면을 추가하지 않음), ③ fire-and-forget(앱이 자식 프로세스 권한을 확장하지 않음). 즉 **새로운 실행 표면을 만들지 않고, 탐색기 우클릭과 동일한 신뢰 모델**을 앱 안으로 가져온다. verb 실행은 사용자의 명시적 선택(메뉴 클릭)으로만 발생한다.

---

## 결정 ⑥ — 렌더러 통합: "Windows 메뉴" 섹션 병합·로딩 UX·TTL 캐시

- **병합 지점**: `renderer/app/usecases/contextMenu.ts#buildMenuItems`의 **단일 선택(`!multi && single`) 경로 말미**(속성 그룹 다음)에 "Windows 메뉴" 섹션을 추가한다. 다중 선택·빈 영역 메뉴에는 추가하지 않는다(정직 한계 ②·단일 한정). B6 자체 명령 산출은 **불변**(섹션만 추가).
- **비동기 채움 + 로딩 UX**: `buildMenuItems`는 동기 함수이므로 verb 조회 결과를 즉석에서 못 채운다. 1차는 **신규 유스케이스 `app/usecases/shellVerbs.ts`**가 메뉴 열림 시 `shell:context-verbs`를 호출하고, 결과를 메뉴 상태(예: `uiSlice`의 컨텍스트 메뉴 상태에 `winVerbs: { status: 'loading'|'ready'|'empty'; items: ShellVerbDTO[] }`)에 반영해 `ui/contextmenu/ContextMenu`가 섹션을 **로딩 → 채움/숨김**으로 렌더한다. 조회 실패/타임아웃/빈 목록 → 섹션 **비노출**(크래시·빈 섹션 없음).
- **TTL 캐시**: 같은 경로 재우클릭 시 짧은 TTL(예: 5~10초) 메모리 캐시로 재조회를 생략(우클릭 반복 체감 개선). 캐시는 렌더러 유스케이스 또는 Main 서비스 측에 둘 수 있으나, **1차는 렌더러 측 경로키 TTL 캐시**(단순·세션 한정·무효화는 TTL 만료). 파일시스템 변경에 정밀 동기화하지 않는다(best-effort).
- **실행**: "Windows 메뉴" 항목 클릭 → `shell:invoke-verb(path, verbId)` 호출(fire-and-forget). 성공/실패 미추적(실패만 가벼운 토스트 — 정직 한계 ④). 클릭 후 메뉴 닫힘.

---

## 근거 (종합)

- **신규 네이티브/npm 의존성 0**: COM `Shell.Application`은 `showProperties` 선례로 검증된 경로. PowerShell·COM은 시스템 내장.
- **우클릭 비차단**: 상주 PowerShell 1개 + lazy 기동 + TTL 캐시 + 짧은 타임아웃으로 우클릭 지연을 구조적으로 흡수(매 우클릭 spawn 비용 제거).
- **오실행 방지 우선**: index+표시명 결합 식별 + 실행 시 재열거 교차검증 → 스테일 메뉴로 엉뚱한 verb 실행을 막는다(미실행 < 오실행).
- **ADR-005 전면 준수**: sender·zod·guardPath·로컬 한정·명령행 합성 0·실행 표면 미추가(탐색기와 동일 신뢰 모델).
- **B6 비파괴 확장**: 앱 자체 명령 동작 불변, "Windows 메뉴" 섹션만 추가(features §Y1 "충돌·회귀 없이").
- **단순성**: 1차는 직렬 요청 큐·평탄 verb 목록·표시명 매칭으로 최소 설계(서브메뉴 완전 재현·다중 invoke는 비범위).

## 트레이드오프

- **canonical name 부재** → 블랙리스트가 표시명 정규화 매칭(영/한 보장·그 외 언어 best-effort). 완전 다국어 필터 불가(정직 한계).
- **서브메뉴 평탄화/누락**: 캐스케이드(7-Zip류 서브메뉴 핸들러)는 `Verbs()` 평탄 열거에서 일부 누락 가능(보이는 것만 best-effort·비범위).
- **상주 프로세스 1개**: 메모리·수명 관리 부담(crash 재기동·종료 정리·쿨다운으로 흡수). 단, 항상 떠 있지 않고 lazy 기동.
- **fire-and-forget**: 실행 결과를 추적하지 않음(외부 프로그램 실행이므로 의도적). 실패는 무음/가벼운 토스트.

## 결과

- 신규 Main 모듈 `src/main/os/shellVerbs.ts`(`ShellVerbsService` — 상주 워커 수명·요청 큐·타임아웃·블랙리스트 필터·재열거 식별) + `src/main/os/shellVerbsWorker.ps1`(고정 PowerShell 스크립트·stdin JSON 루프).
- 신규 IPC 핸들러 `main/ipc/shell.handlers.ts`(확장: `shell:context-verbs`·`shell:invoke-verb` 등록 — sender+zod+guardPath+로컬 한정).
- 신규 IPC 채널 2종 `shell:context-verbs`·`shell:invoke-verb`(invoke·EVENT_CHANNELS 무변)·신규 DTO `ShellVerbDTO`.
- 신규 렌더러 유스케이스 `renderer/app/usecases/shellVerbs.ts`(조회·TTL 캐시·실행) + `contextMenu.ts`/`ui/contextmenu/ContextMenu` 확장(섹션 병합·로딩 UX) + `uiSlice` 컨텍스트 메뉴 상태에 `winVerbs` 필드.
- 신규 npm 의존성 **0**·신규 네이티브 의존성 **0**·`SESSION_SCHEMA_VERSION` 무변경.
- ADR-000-index에 ADR-013 등록. 마일스톤: 후속 Should(M10 가칭·PRD §12). 상태 **🔜 설계 완료·구현 전**.

---

## 미해결 질문 (구현 단계 deferral)

| # | 질문 | 1차 결정 | 후속 트리거 | 비차단 |
|---|---|---|---|---|
| **UQ-Y1** | PowerShell 스크립트 패키징 위치(asar 외부 vs extraResources vs 인라인 `-Command` 문자열) | 1차 **`-File` 외부 `.ps1`**(extraResources·고정 텍스트·읽기 전용) | 빌드 시 `.ps1` 경로 해석/서명 이슈가 있으면 인라인 고정 here-string `-Command -`로 전환(여전히 경로는 stdin) | 비차단 — 둘 다 명령행 합성 0 유지 |
| **UQ-Y2** | 요청 직렬화 vs `id` 다중 인플라이트 | 1차 **FIFO 직렬화 + stale-cancel** | 우클릭 빈도/체감 지연 측정 후 다중 인플라이트 필요 시 `id` 상관 동시 처리 | 비차단 — 1차 단순·정확 |
| **UQ-Y3** | 블랙리스트 다국어 확장(영/한 외) | 1차 **영어+한국어 표시명 사전** | 다국어 사용자 피드백 시 OS 언어별 표시명 사전 확장 또는 canonical 추정 휴리스틱 보강 | 비차단 — 미필터는 중복 표시(무해) |
| **UQ-Y4** | TTL 캐시 위치(렌더러 vs Main) | 1차 **렌더러 경로키 TTL 캐시** | 다창(U3)·다패널에서 캐시 공유가 필요하면 Main 서비스로 승격 | 비차단 — best-effort 캐시 |
| **UQ-Y5** | crash 재기동 쿨다운 임계(N회) | 1차 **연속 3회 실패 시 세션 비활성** | 환경별 PowerShell 가용성 편차 측정 후 조정 | 비차단 — 토스트 폭주 방지용 보수값 |
