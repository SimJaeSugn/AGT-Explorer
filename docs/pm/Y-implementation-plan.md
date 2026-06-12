# §Y Windows 셸 컨텍스트 메뉴 연동 — 코드베이스 수준 세부 구현 계획 (Y1 · US-23.1 · F37)

> 작성: 테크리드 · 2026-06-12 · 브랜치 `feature/shell-context-verbs`(권장) · 상태: **설계 PASS → 구현 세부계획 확정**
> 설계 단일 출처: [ADR-013 셸 컨텍스트 메뉴 verbs](../architecture/adr/ADR-013-shell-context-menu-verbs.md) · [ADR-005 프로세스/보안 모델](../architecture/adr/ADR-005-process-security-model.md) · [ADR-003 IPC 계약 스타일](../architecture/adr/ADR-003-ipc-contract-style.md)
> 추적성: [traceability §1-Y](../architecture/traceability.md#1-y-windows-셸-컨텍스트-메뉴-연동y1us-231f37-2026-06-12-편입--매핑----설계-완료구현-전) · [directory-structure §Y](../architecture/directory-structure.md)
> 기획 수용기준: [features §Y1(10개)](../features.md) · [user-stories US-23.1](../user-stories.md) · [flows F37](../flows.md)
> 검증 반영: [architecture-review-Y.md 경미 권고 4건](../reviews/architecture-review-Y.md) — 본 계획에서 흡수(§6).
>
> **목적**: PM이 개발자 에이전트(backend-dev/frontend-dev)를 순차 호출해 구현하도록, Y1을 ① 만들/고칠 파일 경로·심볼, ② 경계 계약(DTO·에러·preload API 시그니처), ③ 권고 4건 흡수 지점, ④ verify 항목, ⑤ 구현 순서·DoD로 확정한다. **본 문서는 코드를 생성하지 않는다 — 실행 계획만.**
>
> **건드리지 않을 것(불변)**: `docs/roadmap.md`(doc-sync 게이트 전용)·기획 4종(PRD/features/user-stories/flows)·기존 `shell:*` 6채널 계약·기존 contextMenu 항목 산출. 본 계획은 **추가 전용**(append-only)이다.

---

## 0. 공통 규약·불변 규칙

### 0.1 전 태스크 공통 규칙
- 기존 코드/문서 **비파괴**. ADR-013 설계 계약 임의 변경 금지(계약은 §2에 고정).
- **ADR-003 throw 0 / Result**: 신규 IPC 핸들러는 `Result<T, FileOpError>`·sender 검증(`isTrustedSender`)·zod(`parseArgs`)·`guardPath` 필수. 어떤 경로에서도 핸들러는 throw 하지 않는다.
- **ADR-005 보안**: 경로·verbId는 **stdin JSON 페이로드로만** 워커에 전달. PowerShell 스크립트는 **고정 텍스트**(`showProperties` env 전달 선례 — 문자열 보간/명령행 합성 0). 원격(`sftp://`/`ftp://`)·archive(`archive://`) prefix는 핸들러에서 거부(로컬 경로 한정).
- **계약 단일 출처**: 채널 상수=`src/shared/ipc/channels.ts`, 타입=`src/shared/ipc/contracts.ts`, DTO=`src/shared/dto/index.ts`, zod=`src/main/ipc/guard.ts`, preload 노출=`src/preload/api.ts`+`src/renderer/infra/api/index.ts`.
- **신규 npm/네이티브 의존성 0** · **EVENT_CHANNELS(푸시) 무변**(둘 다 invoke) · **`SESSION_SCHEMA_VERSION` 무변경**.
- 도메인 순수 규칙(`domain/rules/*`)은 react/zustand/infra/shared-ipc import 금지. 블랙리스트 정규화·verbId 파싱은 순수 함수로 분리(verify 가능).

### 0.2 공유(공통) 변경 파일 — 충돌 주의 지점
순차 구현(T1→T2→T3→T4→T5→T6)이므로 충돌은 거의 없다. 단 아래 공유 파일은 **append만**:

| 파일 | T1 | T2 | T3 | T4 | 충돌 회피 |
|---|---|---|---|---|---|
| `src/shared/ipc/channels.ts` | `SHELL_CONTEXT_VERBS`·`SHELL_INVOKE_VERB` 2줄 추가 | — | — | — | shell:* 블록 말미 append |
| `src/shared/ipc/contracts.ts` | `ShellContextVerbsReq/Res`·`ShellInvokeVerbReq` + ChannelMap 2줄 | — | — | — | shell:* 블록 말미 append |
| `src/shared/dto/index.ts` | `ShellVerbDTO` + `FileOpErrorCode`에 `'EVERB'` 1줄 | — | — | — | DTO append + 에러 유니온 1항 추가(§2.4) |
| `src/main/ipc/guard.ts` | `zShellContextVerbsReq`·`zShellInvokeVerbReq` | — | — | — | guard 말미 append |
| `src/main/ipc/shell.handlers.ts` | — | 2핸들러 등록 | — | — | `registerShellHandlers` 말미 append |
| `src/preload/api.ts` | shell 네임스페이스 타입 2줄 + 구현 2줄 | — | — | — | shell 블록 append |
| `src/renderer/infra/api/index.ts` | — | — | `shellApi.contextVerbs`·`invokeVerb` 2메서드 | — | shellApi append |
| `src/renderer/app/usecases/contextMenu.ts` | — | — | — | 단일 선택 말미 섹션 병합 | 기존 산출 불변·말미 push만 |
| `src/renderer/app/stores/uiSlice.ts` | — | — | — | `ContextMenuState`에 `winVerbs` + 액션 | 기존 필드 불변·옵셔널 추가 |

> **순서 근거**: T1(계약) 먼저 동결해야 T2(메인)·T3(preload)·T4(렌더러)가 추측 없이 병렬/순차 가능. T5(verify)는 T1·T2 순수 로직이 선 후 작성. T6(빌드)는 T2 ps1 파일 존재 후.

---

## 1. 태스크 분해 (의존 순서)

### T1 — 공유 계약 동결 (backend-dev) · 의존: 없음

**산출물(파일·심볼)**
- `src/shared/ipc/channels.ts` (확장): shell:* 블록 말미에
  ```
  SHELL_CONTEXT_VERBS: 'shell:context-verbs', // impl: §Y1 (셸 verb 조회 — 상주 PowerShell)
  SHELL_INVOKE_VERB: 'shell:invoke-verb',     // impl: §Y1 (verb.DoIt 실행 — fire-and-forget)
  ```
- `src/shared/ipc/contracts.ts` (확장): shell:* 블록 말미에 `ShellContextVerbsReq`·`ShellContextVerbsRes`·`ShellInvokeVerbReq` 인터페이스 + ChannelMap 2줄(§2.1).
- `src/shared/dto/index.ts` (확장): `ShellVerbDTO` 인터페이스(§2.2) + `FileOpErrorCode` 유니온에 `| 'EVERB'` 1항 추가 + 주석(§2.4).
- `src/main/ipc/guard.ts` (확장): `zShellContextVerbsReq`·`zShellInvokeVerbReq`(§2.3).
- `src/preload/api.ts` (확장): `shell` 네임스페이스 **타입 선언** 2줄 추가(§2.5) — 구현 2줄도 같이(invoke 위임).

**DoD**: `npm run typecheck:node`·`typecheck:web` PASS. ChannelMap 누락 시 컴파일 에러로 강제됨. grep 으로 `shell:context-verbs`·`shell:invoke-verb`·`SHELL_CONTEXT_VERBS`·`SHELL_INVOKE_VERB`·`ShellVerbDTO`·`EVERB` 가 위 파일에만 존재. 기존 shell:* 6채널·기존 DTO 무변경(git diff append-only).

---

### T2 — 메인: 상주 PowerShell 워커 서비스 + ps1 + 핸들러 (backend-dev) · 의존: T1

**산출물(파일·심볼)**
- `src/main/os/shellVerbs.ts` (신규) — `ShellVerbsService` 클래스 + `shellVerbsService` 싱글톤 export.
  - 시그니처:
    ```ts
    interface ShellVerbsServiceOptions {
      /** 헤드리스 검증용 트랜스포트 주입(기본=실제 PowerShell child_process). */
      transport?: ShellVerbsTransport
      /** 조회 타임아웃 ms(기본 1500). */
      requestTimeoutMs?: number
      /** 연속 기동 실패 쿨다운 임계(기본 3 — UQ-Y5). */
      maxConsecutiveSpawnFailures?: number
    }
    class ShellVerbsService {
      listVerbs(normalizedPath: string): Promise<Result<{ verbs: ShellVerbDTO[] }>>
      invokeVerb(normalizedPath: string, verbId: string): Promise<Result<void>>
      dispose(): void  // before-quit 정리(child.kill·stdin end·리스너 해제)
    }
    export const shellVerbsService: ShellVerbsService
    ```
  - 내부 책임: ① lazy 워커 spawn(`spawnWorker()` — `powershell.exe -NoProfile -NonInteractive -File <ps1경로>`, `windowsHide:true`), ② stdin/stdout JSON **라인 버퍼 파서**(`\n` split·`id` 상관 in-flight `Map<id, {resolve, timer}>`), ③ **FIFO 직렬 큐**(이전 응답 수신 후 다음 요청 전송 — UQ-Y2), ④ stale-cancel(새 경로 list 요청 시 미완 list 요청 폐기→섹션 비노출), ⑤ 타임아웃(`requestTimeoutMs` 후 해당 요청만 reject·워커 미종료), ⑥ **타임아웃 후 늦은 응답 폐기**(in-flight Map 에 없는 id 응답은 drop — 권고-2), ⑦ crash 재기동(`child.on('exit'|'error')` → in-flight 전부 reject·다음 요청 때 1회 재기동·연속 N회 실패 시 세션 비활성 쿨다운 — UQ-Y5), ⑧ **블랙리스트 필터**(`filterVerbs()` — `shellVerbsBlacklist.ts` 순수 함수 사용, list 응답을 렌더러로 보내기 전 Main 에서 적용), ⑨ **재열거 교차검증 식별**: invoke 는 ps1 `invoke` op 에 `{path, verbId}` 전달 → ps1 측이 재열거 후 index+정규화표시명 매칭(§4 ps1 책임). 서비스는 결과 code(`ok`/`EVERB`/`ENOENT`/`EUNKNOWN`)를 Result 로 변환.
  - **throw 0**: 비-Windows·spawn 동기 throw(`spawnDetached` 선례)·파싱 실패·타임아웃 전부 `Result.err` 또는 빈 verbs 로 흡수.
  - `transport` 주입: `interface ShellVerbsTransport { send(line: string): void; onLine(cb): void; onExit(cb): void; kill(): void }` — verify 가 PowerShell 미경유 페이크로 주입(driveType.ts `queryFn` 선례).
- `src/main/os/shellVerbsBlacklist.ts` (신규·순수) — `normalizeVerbName(name: string): string`(`&` 제거·트림·소문자·말미 `(...)` 단축키 그룹 제거) + `BLACKLIST: ReadonlySet<string>`(영/한 사전 §3) + `isBlacklisted(name): boolean` + `parseVerbId(verbId): { index: number; display: string } | null` + `makeVerbId(index, display): string`. **react/infra import 0** → T5 verify 대상.
- `src/main/os/shellVerbsWorker.ps1` (신규·고정 텍스트) — stdin JSON 루프(§4 전체 명세).
- `src/main/ipc/shell.handlers.ts` (확장) — `registerShellHandlers` 말미에 2핸들러(§2.6 시퀀스):
  - `SHELL_CONTEXT_VERBS`: sender → zod → guardPath → 로컬 한정(원격/archive prefix 거부·`locationKindOf` 또는 prefix 검사) → `fs.access(F_OK)` 존재 확인 → `shellVerbsService.listVerbs(path)` 위임. 실패/타임아웃은 `Result.err` 가 아니라 **빈 verbs `ok({verbs:[]})`** 로 흡수(섹션 비노출=크래시 없는 정상 — 권고-3 `empty` 포괄). 단 sender/zod/guard/prefix 거부는 `Result.err`(잘못된 호출).
  - `SHELL_INVOKE_VERB`: sender → zod → guardPath → 로컬 한정 → `fs.access(F_OK)`(미존재 ENOENT) → `shellVerbsService.invokeVerb(path, verbId)`. 결과 `EVERB`/`ENOENT`/`EUNKNOWN` 을 `Result.err` 로 전파(렌더러가 가벼운 토스트).
- `src/main/index.ts` (확장) — `before-quit` 핸들러 내부에 `try { shellVerbsService.dispose() } catch {}` 1줄 추가(좀비 프로세스 방지·archiveSessionManager().closeAll() 선례 위치).

**DoD**: `npm run build`(typecheck node+web + electron-vite) PASS. ESLint 0. `os/` 계층 경계 준수(네트워크 import 0). ps1 은 고정 텍스트(경로/verbId 문자열 보간 0 — grep 으로 `$env:`·`$input` 외 경로 합성 부재 확인). 핸들러 throw 0(전 분기 Result). T5 verify 통과(아래).

---

### T3 — preload/infra API 노출 (backend-dev 또는 frontend-dev) · 의존: T1

**산출물**
- `src/preload/api.ts` (T1에서 타입 추가됨) — 구현 객체 `shell` 블록에 2줄:
  ```ts
  contextVerbs: (req) => invoke(CHANNELS.SHELL_CONTEXT_VERBS, req),
  invokeVerb: (req) => invoke(CHANNELS.SHELL_INVOKE_VERB, req)
  ```
- `src/renderer/infra/api/index.ts` (확장) — `shellApi` 에 2메서드(§2.5):
  ```ts
  contextVerbs: (path: string): Promise<Result<ShellContextVerbsRes>> =>
    bridge().shell.contextVerbs({ path }),
  invokeVerb: (path: string, verbId: string): Promise<Result<void>> =>
    bridge().shell.invokeVerb({ path, verbId })
  ```

**DoD**: typecheck PASS. `shellApi.contextVerbs`/`invokeVerb` 가 렌더러에서 타입 안전 호출 가능. ui→infra 직접 import 금지 규칙은 T4 usecase 경유로 준수(infra 자체는 노출만).

---

### T4 — 렌더러: 유스케이스 + contextMenu 병합 + uiSlice 상태 + UI 렌더 (frontend-dev) · 의존: T1·T3

**산출물(파일·심볼)**
- `src/renderer/app/usecases/shellVerbs.ts` (신규) — 조회·TTL 캐시·실행:
  ```ts
  interface WinVerbsCacheEntry { items: ShellVerbDTO[]; at: number }  // 경로키 TTL 캐시
  /** 메뉴 열림 시 호출: 경로 verb 조회 → uiSlice.winVerbs 갱신(loading→ready/empty). */
  export function loadWinVerbs(path: string): void
  /** "Windows 메뉴" 항목 클릭: fire-and-forget 실행. 실패만 가벼운 토스트. */
  export function invokeWinVerb(path: string, verbId: string): Promise<void>
  ```
  - `loadWinVerbs`: ① TTL(8초·`WIN_VERBS_TTL_MS`) 캐시 hit 이면 즉시 `ready/empty` 세팅(재조회 생략 — UQ-Y4 렌더러 캐시), ② miss 면 `winVerbs={status:'loading',items:[]}` 세팅 후 `shellApi.contextVerbs(path)` 호출 → 성공·verbs 0건 → `empty` / 성공·verbs N건 → `ready`+캐시 저장 / `Result.err`(거부) → `empty`(섹션 비노출). ③ **경합 가드**: 응답 도착 시 `uiSlice.contextMenu?.targetPath === path` 인지 확인(메뉴가 닫혔거나 다른 항목으로 바뀌었으면 무시).
  - `invokeWinVerb`: `shellApi.invokeVerb(path, verbId)` → `Result.err` 면 `pushToast('info', '메뉴 동작을 실행할 수 없습니다.')`(EVERB=stale 시 "메뉴가 변경되었습니다" 등). 성공은 무음(fire-and-forget).
- `src/renderer/app/stores/uiSlice.ts` (확장):
  - `ContextMenuState` 에 옵셔널 추가: `readonly winVerbs?: { status: 'loading' | 'ready' | 'empty'; items: ShellVerbDTO[] }`.
  - 액션 `setWinVerbs(state: {status; items}): void` — `contextMenu` 가 열려 있을 때만 `winVerbs` 갱신(immer set·닫혀 있으면 무시).
  - `openContextMenu` 는 무변경(winVerbs 는 별도 액션으로 비동기 채움 — 동기 산출 불변).
- `src/renderer/app/usecases/contextMenu.ts` (확장) — `buildMenuItems` 의 **단일 선택(`!multi && single`) 경로 말미**(속성 그룹 다음, return 직전)에 "Windows 메뉴" 섹션 병합:
  - `single` 이고 `locationKindOf(single.path)==='local'` 일 때만(원격/archive 숨김).
  - `store.getState().contextMenu?.winVerbs` 를 읽어:
    - `status==='loading'` → `{id:'win-loading', label:'Windows 메뉴 불러오는 중…', run: undefined}`(비활성 표시 행) + 상단 separator.
    - `status==='ready'` && items.length>0 → separator + 각 verb `{id:'win-'+verbId, label:display, run:()=>void invokeWinVerb(single.path, verbId)}`.
    - `status==='empty'` 또는 undefined → **아무것도 추가 안 함**(섹션 비노출).
  - **다중 선택·빈 영역**: 추가 안 함(단일 한정). B6 자체 명령 산출 **불변**.
  - 주의: `buildMenuItems` 는 동기 → 비동기 조회는 별도. **`openRowContextMenu` 끝에서 단일 선택·로컬일 때 `loadWinVerbs(entry.path)` 트리거**(메뉴 열기 직후 비동기 채움). `ContextMenu.tsx` 가 `winVerbs` 변화를 리렌더로 반영.
- `src/renderer/ui/contextmenu/ContextMenu.tsx` (확장) — `items` useMemo 의 deps 에 `winVerbs` 반영. 현재 `[contextMenu]` 의존이지만 `winVerbs` 가 `contextMenu` 객체 내부 필드이므로 **`setWinVerbs` 가 새 `contextMenu` 참조를 만들도록** uiSlice 액션이 immer 로 교체하면 자동 리렌더(별도 deps 불요). 로딩 행(`run` 없는 항목)은 기존 `run()` 가드(`if(!item.run) return`)로 클릭 무동작 — 추가 코드 최소. 로딩 행 시각 구분(흐림)은 선택(MenuRow 에 `disabled` prop 없으면 1차는 일반 라벨로 표시).

**DoD**: typecheck PASS. ESLint 0. 단일 파일/폴더(로컬) 우클릭 시 메뉴에 "Windows 메뉴" 섹션이 로딩→채움/숨김으로 반영(코드 경로 존재). 다중 선택·원격·archive·빈 영역 우클릭 시 섹션 미노출(코드 분기). B6 기존 항목 산출 무변경(verify:store/기존 회귀 0). T5 verify(캐시·경합 가드·병합 분기) 통과.

---

### T5 — verify 스크립트 (backend-dev) · 의존: T2(순수 로직)·T4(병합 분기)

**산출물**
- `scripts/verify-shellverbs.ts` (신규) + `package.json` 에 `verify:shellverbs` 스크립트 1줄(verify:shell-h4h6 패턴 — esbuild cjs 번들 후 node).
- 검증 대상(헤드리스 순수·페이크 트랜스포트):
  - **블랙리스트 정규화**(`shellVerbsBlacklist.ts`): `normalizeVerbName` 가 `&Open`→`open`·`삭제(&D)`→`삭제`·`복사  `→`복사`·`Create &shortcut`→`create shortcut` 등. `isBlacklisted` 가 영/한 사전(open/cut/copy/paste/delete/rename/properties/link·열기/잘라내기/복사/붙여넣기/삭제/이름 바꾸기/속성/바로 가기 만들기) 매칭. `copy as path`("경로로 복사")·압축/외부앱 항목은 **미필터**(노출).
  - **verbId 파싱/합성**: `makeVerbId(5,'반디집으로 압축하기')`→`'5:반디집으로 압축하기'`·`parseVerbId` 왕복·콜론 포함 표시명(`display`에 `:` 있으면 첫 콜론까지만 index)·잘못된 형식 null.
  - **서비스 라인 프로토콜**(페이크 transport 주입): list 요청 송신→JSON 라인 응답 수신→블랙리스트 필터 후 verbs 반환·id 상관 매칭·**타임아웃 후 늦은 응답 폐기**(in-flight 없는 id drop)·stale-cancel(새 list 가 이전 list reject)·FIFO 직렬(2요청 순차)·crash(exit 이벤트) 시 in-flight 전부 reject + 다음 요청 재기동·연속 N회 실패 쿨다운.
  - **invoke 결과 코드 매핑**: ps1 `ok`→`Result.ok`·`EVERB`→`err(EVERB)`·`ENOENT`→`err(ENOENT)`.
  - **TTL 캐시·경합 가드**(렌더러 `shellVerbs.ts` 순수 부분 또는 store verify 로): TTL 만료 전 재조회 생략·targetPath 불일치 응답 무시.
  - **contextMenu 병합 분기**(`verify:store` 또는 본 스크립트): 단일+로컬+ready → "Windows 메뉴" 항목 N개 / 다중 → 0개 / 원격·archive → 0개 / loading → 로딩 행 1개 / empty → 0개. B6 기존 항목 수 불변.

**신규 verify 케이스 추정**: **약 38~46개**(블랙리스트 정규화 12·verbId 파싱/합성 8·서비스 프로토콜/타임아웃/stale/crash/쿨다운 12·invoke 코드 매핑 3·TTL/경합 4·병합 분기 7). 단일 신규 스크립트 `verify:shellverbs`(병합 분기 일부는 `verify:store` 에 흡수 가능).

**DoD**: `npm run verify:shellverbs` 0 fail. 기존 verify 전체 회귀 0(특히 `verify:store`·`verify:shell-h4h6`).

---

### T6 — 빌드·패키징: ps1 번들 (backend-dev/devops-engineer) · 의존: T2(ps1 존재)

**산출물 — UQ-Y1 1차안: `out/main/` 동일 디렉토리 배치 + extraResources 미사용(asar 내부 `-File`)**
- 결정: **ps1 을 `out/main/shellVerbsWorker.ps1` 로 복사**해 `shellVerbs.ts` 가 `join(__dirname, 'shellVerbsWorker.ps1')`(hashWorker.js 와 동일 패턴)로 참조. asar 내부 파일이지만 **`-File` 은 asar 가상경로를 직접 못 읽으므로**, 패키징 시 **asar 외부로 unpack** 한다(아래 둘 중 1택):
  - (1차 권장) `electron-builder.yml` 에 `asarUnpack: ['**/shellVerbsWorker.ps1']` 추가 → 런타임 경로는 `__dirname` 이 `app.asar.unpacked/out/main/` 로 해석(electron-builder 가 unpack 파일을 자동 그 경로에 둠). `shellVerbs.ts` 의 ps1 경로 해석은 `__dirname.replace('app.asar','app.asar.unpacked')` 보정(필요 시).
  - (대안) `electron-builder.yml extraResources` 로 `resources/shellVerbsWorker.ps1` → `process.resourcesPath/shellVerbsWorker.ps1`. 단 dev(`__dirname`=out/main)와 prod(resourcesPath) 경로 분기 필요.
- **ps1 을 `out/main/` 으로 복사하는 빌드 훅**: electron-vite rollup 은 `.ps1`(비-JS)을 번들하지 않으므로, **`vite-plugin-static-copy` 미도입(신규 의존성 0 원칙)** → 대신 `electron.vite.config.ts` 의 main 빌드에 **closeBundle 훅(인라인 플러그인)** 또는 `package.json` build 스크립트 앞에 `node scripts/copy-ps1.cjs`(fs.copyFileSync `src/main/os/shellVerbsWorker.ps1` → `out/main/shellVerbsWorker.ps1`) 1단계 추가. **1차 권장**: `electron.vite.config.ts` main 에 소형 인라인 플러그인(`{ name:'copy-ps1', closeBundle(){ copyFileSync(...) } }`) — 신규 의존성 0·빌드/패키지 모두 커버.
- `electron-builder.yml` (확장): `asarUnpack: ['**/shellVerbsWorker.ps1']` 1줄 추가(기존 files/asar 무변경).
- `shellVerbs.ts` ps1 경로 해석 헬퍼: `resolveWorkerScriptPath()` — `app.isPackaged` 시 `__dirname.replace('app.asar','app.asar.unpacked')` 보정·dev 는 `__dirname` 그대로. 부재 시 서비스는 spawn 실패→섹션 비노출(견고).

**권고-4 흡수**: ExecutionPolicy 차단 대응 — `-File` 호출에 `-ExecutionPolicy Bypass` 를 함께 지정(`powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File <ps1>`). Bypass 도 차단되는 잠금 환경이면 spawn/실행 실패→in-flight reject→섹션 비노출(폴백). UQ-Y1 후속 트리거: 그래도 실패 빈발 시 **인라인 here-string `-Command -`**(고정 텍스트·경로는 여전히 stdin)로 전환.

**DoD**: `npm run build` PASS 후 `out/main/shellVerbsWorker.ps1` 존재. (가능 시) `npm run dist` 1회 — `app.asar.unpacked/out/main/shellVerbsWorker.ps1` 배치 확인. 부팅 스모크(did-fail 0). **정직 한계**: 실 패키지 설치본에서의 ps1 경로 해석·ExecutionPolicy 실 동작은 패키징 환경에서만 확정(🟡).

---

## 2. 경계 계약 고정 (backend↔frontend 추측 금지)

### 2.1 contracts.ts (shell:* 블록 말미 append)
```ts
// ── §Y1: shell:context-verbs / shell:invoke-verb (상주 PowerShell·COM Verbs) ──
export interface ShellContextVerbsReq {
  /** 우클릭한 단일 항목의 절대 로컬 경로(핸들러가 guardPath·존재·로컬 한정 검증). */
  readonly path: string
}
export interface ShellContextVerbsRes {
  /** 블랙리스트 필터 후의 표시용 verb 목록(빈 배열=섹션 비노출). */
  readonly verbs: ShellVerbDTO[]
}
export interface ShellInvokeVerbReq {
  readonly path: string
  /** "<index>:<정규화표시명>" 합성키(조회 응답의 verbId 그대로). */
  readonly verbId: string
}
// ChannelMap 추가:
[CHANNELS.SHELL_CONTEXT_VERBS]: { req: ShellContextVerbsReq; res: Result<ShellContextVerbsRes> }
[CHANNELS.SHELL_INVOKE_VERB]:   { req: ShellInvokeVerbReq;   res: Result<void> }
```

### 2.2 dto/index.ts (append)
```ts
/**
 * 셸 컨텍스트 verb 1개(§Y1). Main 이 COM Verbs() 열거→블랙리스트 필터 후 렌더러로 전달.
 * verbId = "<index>:<정규화표시명>" 안정 합성키(React key·실행 시 재열거 교차검증).
 */
export interface ShellVerbDTO {
  readonly verbId: string
  readonly display: string  // 사용자 표시 라벨(정규화된 표시명·`&` 제거)
}
```

### 2.3 guard.ts (append)
```ts
// ── §Y1: shell:context-verbs / shell:invoke-verb ──
// path 는 형태(min1)만 1차 검증, 핸들러가 guardPath·존재·로컬 한정 재검증.
export const zShellContextVerbsReq = z.object({ path: zPath })
export const zShellInvokeVerbReq = z.object({ path: zPath, verbId: z.string().min(1).max(512) })
```

### 2.4 에러 코드 — `EVERB` 추가 (dto/index.ts FileOpErrorCode)
ADR-013·traceability §1-Y 가 `EVERB`(stale/미존재 verb)를 명시하나 기존 `FileOpErrorCode` 유니온에 없음. **RemoteErrorCode 확장 선례와 동형으로 1항 추가**:
```ts
  | 'EVERB' // §Y1 셸 verb 미존재/스테일(재열거 교차검증 불일치 — 실행 거부)
```

### 2.5 preload + infra API 시그니처 (확정 — frontend 가 그대로 호출)
- preload `shell` 네임스페이스 타입(`src/preload/api.ts`):
  ```ts
  contextVerbs(req: ShellContextVerbsReq): Promise<Result<ShellContextVerbsRes>>
  invokeVerb(req: ShellInvokeVerbReq): Promise<Result<void>>
  ```
- 렌더러 `shellApi`(`src/renderer/infra/api/index.ts`):
  ```ts
  contextVerbs(path: string): Promise<Result<ShellContextVerbsRes>>
  invokeVerb(path: string, verbId: string): Promise<Result<void>>
  ```
- **frontend(T4)는 위 2메서드만 사용**. usecase `shellVerbs.ts` 가 유일한 호출부(ui→infra 직접 금지).

### 2.6 핸들러 검증 시퀀스(고정 — `shell:open`/`show-properties` 3중 검증 동형)
- **context-verbs**: sender → `parseArgs(zShellContextVerbsReq)` → `guardPath` → **로컬 한정**(원격 `://`·`archive://` prefix 거부 → `err(EINVAL,'로컬 경로만 지원')`) → `fs.access(F_OK)`(미존재 ENOENT) → `shellVerbsService.listVerbs(path)`. 서비스 결과는 항상 `ok({verbs})`(실패=빈 배열·섹션 비노출).
- **invoke-verb**: sender → `parseArgs(zShellInvokeVerbReq)` → `guardPath` → 로컬 한정 → `fs.access(F_OK)` → `shellVerbsService.invokeVerb(path, verbId)` → `EVERB`/`ENOENT`/`EUNKNOWN` 은 `Result.err` 전파.

---

## 3. 블랙리스트 사전 (확정 — shellVerbsBlacklist.ts)
정규화 키(소문자·`&`제거·트림·말미 `(...)` 제거) 기준 매칭 집합:
```
open · 열기
cut · 잘라내기
copy · 복사
paste · 붙여넣기
delete · 삭제
rename · 이름 바꾸기 · 이름바꾸기
properties · 속성
create shortcut · 바로 가기 만들기 · link
```
- **미필터(노출 유지)**: `copy as path`/`경로로 복사`(앱 미제공)·압축/외부앱 항목(반디집·Cursor·AGT-Finder 등). `open with`/`연결 프로그램으로 열기` 는 **정확 일치 시만 필터**(보수적·과필터 방지) — 1차는 블랙리스트에 미포함(노출), PoC 결과로 구현 단계 확정 가능.
- **정직 한계**: 영/한 외 OS 언어는 미필터(중복 표시·무해). 가속기 위치 변형은 정규화로 흡수하나 완전 일치 미보장(best-effort).

---

## 4. ps1 워커 명세 (shellVerbsWorker.ps1 — 고정 텍스트)
- 헤더(인코딩 — 권고-1 흡수): `$OutputEncoding = [Console]::OutputEncoding = [Text.Encoding]::UTF8`·**`[Console]::InputEncoding = [Text.Encoding]::UTF8`**(PS 5.1 한글 stdin 깨짐 방지) · `$ErrorActionPreference='Stop'`.
- 루프: `while ($line = [Console]::In.ReadLine()) { $req = $line | ConvertFrom-Json; ... }`(stdin JSON 1줄 = 1요청). 경로/verbId 는 **`$req.path`/`$req.verbId` 로만** 사용(문자열 합성 0).
- op 분기:
  - `list`: `$sh = New-Object -ComObject Shell.Application; $folder = $sh.Namespace((Split-Path $req.path)); $item = $folder.ParseName((Split-Path $req.path -Leaf)); $verbs = @(); $i=0; foreach($v in $item.Verbs()){ if($v.Name){ $verbs += @{index=$i; name=$v.Name; display=($v.Name -replace '&','')} }; $i++ }` → `@{id=$req.id; ok=$true; verbs=$verbs} | ConvertTo-Json -Compress -Depth 4` 출력(1줄). item null → `@{id;ok=$false;code='ENOENT'}`.
  - `invoke`: 항목 재열거 → `$want = $req.verbId` 파싱(`<index>:<display>`). ① `Item([int]$index)` 의 정규화 display==요청 display → 그 verb `.DoIt()` → `ok=$true`. ② 불일치 → 전체에서 정규화 display 일치 첫 verb `.DoIt()`. ③ 없음 → `ok=$false; code='EVERB'`. (블랙리스트는 Main 에서 list 응답에 적용하므로 ps1 invoke 는 식별만.)
  - `ping`(헬스): `@{id;ok=$true}`.
- 출력은 **항상 `ConvertTo-Json -Compress`(1줄)** + 즉시 flush. 예외는 try/catch 로 `@{id;ok=$false;code='EUNKNOWN';message=...}` 1줄.
- **블랙리스트는 ps1 이 아니라 Main(`shellVerbsBlacklist.ts`)에서 적용**(verify 가능·언어 사전 단일 출처). ps1 은 원문 `name`·정규화 `display`·`index` 만 반환.

---

## 5. 권고 4건 흡수 지점 (architecture-review-Y.md)
| 권고 | 흡수 태스크·파일 |
|---|---|
| **권고-1** ps1 stdin **입력** 인코딩 명시 | **T2** `shellVerbsWorker.ps1` 헤더 `[Console]::InputEncoding = [Text.Encoding]::UTF8`(§4). T5 가 한글 경로 왕복 케이스로 간접 확인(실 PS 인코딩은 🟡). |
| **권고-2** 타임아웃 후 늦은 응답 id 폐기 | **T2** `shellVerbs.ts` 라인 파서: in-flight `Map` 에 없는 id 응답은 drop. **T5** "타임아웃 후 늦은 응답 폐기" 케이스. |
| **권고-3** `empty` 가 빈목록·실패·타임아웃 포괄 명시 | **T2** 핸들러가 실패/타임아웃을 `ok({verbs:[]})` 로 흡수 + **T4** `winVerbs.status==='empty'\|undefined → 섹션 비노출`. usecase 주석에 "empty=빈목록·실패·타임아웃 모두 비노출" 명기. |
| **권고-4** ExecutionPolicy 차단 대응(폴백) | **T6** `-ExecutionPolicy Bypass -File` + UQ-Y1 후속 트리거(인라인 `-Command -` 전환·경로는 stdin 유지). |

---

## 6. 검증 계획
1. **타입/빌드**: `npm run typecheck:node`·`typecheck:web`·`npm run build`(electron-vite) PASS. ESLint 0(변경 파일).
2. **신규 verify**: `npm run verify:shellverbs`(약 38~46 케이스·§T5) 0 fail.
3. **기존 verify 전체 회귀**: `verify:store`·`verify:domain`·`verify:shell-h4h6`·`verify:open-with`·`verify:persistence` 등 전 스윕 0 fail·회귀 0. 특히 `verify:store`(contextMenu 병합 분기·B6 기존 항목 수 불변) 확인.
4. **일회성 실 노드 스모크(Electron 없이)**: `node` 로 `ShellVerbsService` 를 **실제 `powershell.exe -File shellVerbsWorker.ps1`** 로 직접 구동(transport 기본값) → 임시 파일 1개 경로로 `listVerbs` → stdout JSON 라인 왕복 수신·한글 표시명 보존 확인 → `dispose()` 좀비 0. **이 스모크로 "상주 워커 기동→조회→JSON 응답" 왕복이 Electron 없이 node 단독 구동 가능함을 실증**(서비스가 electron import 없이 child_process 만 쓰므로 가능 — driveType.ts 선례). 실패 시 빈 verbs 폴백 확인.
5. **정직 한계(🟡로 남는 범위·✅위장 금지)**: 실 GUI(우클릭→"Windows 메뉴" 섹션 표출·로딩→채움·항목 클릭→외부 프로그램 실행·다중선택 숨김·실 블랙리스트 한글 매칭)·실 패키지 설치본 ps1 경로 해석/ExecutionPolicy·캐스케이드 서브메뉴 누락 범위·영/한 외 언어 미필터는 **Electron 앱 실행 GUI 스모크에서만 확정**(헤드리스 범위 밖). 헤드리스 verify·노드 스모크는 순수 로직·라인 프로토콜·계약 불변식·node 단독 워커 왕복만 증명.

---

## 7. 회귀 가드
- **기존 `shell:*` 6채널 무회귀**: T1 은 append-only(채널/타입/DTO 추가만) → 기존 `SHELL_OPEN`~`SHELL_OPEN_EXTERNAL` 계약·핸들러 무변경. `verify:shell-h4h6`·`verify:open-with` 통과로 확인.
- **contextMenu 기존 항목 무회귀**: T4 는 단일 선택 경로 **말미 push만**·기존 그룹(열기/편집/태그/삭제/속성) 산출 코드 무변경. 다중·빈영역 경로 무변경. `verify:store` 의 메뉴 항목 케이스로 B6 항목 수·순서 불변 확인.
- **EVENT_CHANNELS 무변**: 신규 채널 2종 모두 invoke → 푸시 채널 목록 무변경(grep `EVENT_CHANNELS` 무변).
- **`FileOpErrorCode` 확장 안전**: `EVERB` 1항 추가는 유니온 확장(기존 코드 분기 무영향·RemoteErrorCode 선례 동형). 기존 에러 처리 switch 의 default/EUNKNOWN 폴백이 신규 코드도 흡수.
- **세션/빌드 무회귀**: `SESSION_SCHEMA_VERSION` 무변경·신규 워커 청크 없음(ps1 은 rollup input 아님·복사만). 부팅 스모크 did-fail 0.
- **before-quit**: `shellVerbsService.dispose()` 추가는 try/catch 격리(기존 flush/원격/archive 정리 순서 무영향).

---

## 8. 리스크·미해결
- **R1 (UQ-Y1·중)**: asar 패키지에서 `-File` ps1 경로 해석. 1차 `asarUnpack`+`__dirname` 보정으로 해소하나, 실 패키지 환경에서만 최종 확정(🟡). 폴백: 인라인 `-Command -`(경로는 stdin 유지). → **T6 에서 `npm run dist` 1회 검증 권장**.
- **R2 (권고-1·중)**: PS 5.1 stdin UTF-8. 헤더 `InputEncoding` 명시로 대응하나 콘솔 코드페이지 환경 편차는 실 PS 실행에서만 확정(🟡). 헤드리스는 페이크 transport 라 실 인코딩 미검증.
- **R3 (저)**: COM `Verbs()` 의 캐스케이드 서브메뉴 핸들러 일부 누락(설계 비범위·best-effort). 정직 한계로 수용.
- **R4 (저)**: 블랙리스트 최종 사전은 features §Y1 PoC 16종으로 확정 — `open with`/`연결 프로그램` 필터 여부는 PoC 열거 표시명 확인 후 T2 에서 미세 조정(과필터/누락 균형). 사전 변경은 `shellVerbsBlacklist.ts` 단일 출처라 verify 로 즉시 검증.
- **R5 (저)**: 상주 PowerShell 1개 프로세스 메모리/수명 — lazy 기동·쿨다운·before-quit dispose 로 흡수. 다창(U3) 시 캐시/서비스 공유는 UQ-Y4 후속(Main 승격) — 1차는 단일 서비스 싱글톤·렌더러 캐시.
- **차단 쟁점 0**: 모든 리스크는 1차 결정+폴백이 있어 구현 진행을 막지 않는다.
