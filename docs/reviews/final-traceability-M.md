# 최종 추적성 검증 — §M 외부 연계(에픽12·M1/M2/M3) — 회차 1

> 검증자: 독립 reviewer · 2026-06-08 · 대상: §M(US-12.1~12.5) 구현 추적성·정합·수용기준 충족
> 범위: 추적성·정합·수용기준(코드 동작 판정은 qa-engineer 담당·중복 배제)

## 판정: **PASS (조건부)**

코드 구현은 기획 수용기준 → 설계(ADR-007) → 구현 파일/채널 → verify 하니스로 **끊김 없이 추적**되고, PM 확정 5결정이 코드·설계에 일관되게 반영됐다. 끊긴 추적·미구현 수용기준·유령 매핑은 **없다**.

**단, 모든 기획·설계·계획·추적성 문서의 상태 표기가 "🔜 미착수"로 코드와 정반대로 어긋나 있다**(심각도: 중대 — 단 추적성 사슬 자체는 정확, 표기만 미동기화). 이는 PASS를 막는 결함이 아니라 **후속 doc-sync 게이트가 반드시 ✅로 갱신해야 할 입력**이다.

---

## 1. 수용기준 100% 추적 — 끊긴 고리 없음

US-12.1~12.5 각 수용기준이 ① 설계결정(ADR-007 ①~⑦) ② 구현 파일/채널 ③ verify 하니스로 전부 추적됨. 실파일·verify 실행으로 교차 확인.

| US | 설계 | 구현(실재 확인) | verify(실행 결과) |
|---|---|---|---|
| US-12.1 외부 D&D 복사 | ADR-007 ⑦ | `os/dragdrop.ts`·`ipc/dnd.handlers.ts`·`usecases/externalDrag.ts`·`domain/rules/transferRoute.ts`(외부=copy 고정)·채널 `dnd:start-drag` | `verify:dnd` 29/0 |
| US-12.2 클립보드 CF_HDROP 양방향 | ADR-007 ⑦ | `os/shellClipboard.ts`·`clipboard.handlers.ts`(신규 3채널)·`usecases/clipboardExternal.ts`·채널 `clipboard:write/read/has-files` | `verify:clipboard-hdrop` 33/0 |
| US-12.3 FTP/SFTP 접속·자격증명 | ADR-007 ①②③④⑤⑥ | `os/credentials.ts`(safeStorage/DPAPI)·`remote/{RemoteService,SftpAdapter,FtpAdapter,RemoteSessionManager}.ts`·`persistence/RemoteProfileStore.ts`·`remote.handlers.ts`·채널 `remote:cred:*`/`profile:*`/`connect` | `verify:credentials` 17/0·`verify:remote` 23/0·`verify:eslint-remote` 29/0 |
| US-12.4 원격 탐색·다운로드 | ADR-007 ⑤⑥ | `remote/remoteTransfer.ts`(.part 원자 rename)·`usecases/remote.ts`·채널 `remote:list/stat/download`·op:* 재사용 | `verify:remote-trust` 35/0·`verify:remote-route` 47/0 |
| US-12.5 업로드·끊김/타임아웃 | ADR-007 ⑤⑥ | `remoteTransfer.ts`·`RemoteSessionManager.ts`(세션 격리)·채널 `remote:upload`·푸시 `remote:session-error` | `verify:remote` 23/0 |

- typecheck 0 에러. §M verify 8종 전부 통과(eslint-remote·m-contract·clipboard-hdrop·dnd·credentials·remote·remote-trust·remote-route).
- **미구현·끊긴 수용기준 없음.** 1차 범위 외 항목(이어받기·체크섬·원격↔원격)은 deferral로 정직 표기(아래 §3).

## 2. traceability.md §1-M 정확성 — 매핑 정확, 상태 표기만 어긋남

- §1-M 표의 17개 매핑 파일 전부 **실재 확인**(dragdrop·shellClipboard·credentials·remote/* 7종·핸들러 3종·usecase 3종·remoteSlice·transferRoute·ui/remote·RemoteProfileStore). **허위 매핑·누락 매핑 없음.**
- 채널 상수 `channels.ts`에 `dnd:*`·`clipboard:write/read/has-files`·`remote:*` 전부 존재. 기존 `clipboard:copy/cut/paste`(CN-1 병존)도 보존됨.
- **결함(중대): §1-M 상태 열이 "🔜(설계만·코드 미생성)"** 으로 코드와 정반대. 머리말도 "🔜 미착수(설계 단계)". → doc-sync가 ✅로 갱신 필요.

## 3. PM 확정 5결정 — 코드·문서 일관 반영 ✅

| 결정 | 검증 결과 |
|---|---|
| ① 자격증명 safeStorage·평문금지 | `credentials.ts` safeStorage/DPAPI 전용·`isEncryptionAvailable()=false`→EUNSUPPORTED 거부·평문 폴백 금지·비밀 DTO/로그/Error 배제(verify 통과) ✅ |
| ② FTP/SFTP Won't→편입 | PRD §6 Won't 취소선·D6 기록·코드 실재 ✅ |
| ③ 네트워크 경계 `remote/` 한정 | `.eslintrc.cjs` `node:tls`/ssh2/ssh2-sftp-client/basic-ftp 차단 + `src/main/remote/**` 예외(verify:eslint-remote 29/0) ✅ |
| ④ 외부 이동 1차 복사 고정 | `transferRoute.ts` "외부 도착(M1): copy 고정"·remote↔remote=unsupported ✅ |
| ⑤ 클립보드 1차 병존(CN-1) | 기존 4채널+`fileClipboard.ts` 보존 + 신규 3채널 추가 ✅ |

## 3-b. 스코프 정합 — 일탈·미달 없음, deferral 정직

- 과잉 구현(기획 없는데 구현됨) 없음. 미달(기획 있는데 빠짐) 없음.
- deferral 정직 표기: `.part` 원자 rename은 구현·resume/체크섬(UQ-M2)·원격↔원격(UQ-M3)·자격증명 Cred Manager UI(UQ-M1)는 코드에 미구현(설계대로). `remoteTransfer.ts`에 resume 코드 없음 확인.

## 4. 상태 표기 준비 — doc-sync 게이트 입력

후속 doc-sync가 갱신해야 할 표기(상태의 단일 출처 roadmap §0.5 → 나머지 정렬):

| 문서 | 현재(틀림) | 권고 |
|---|---|---|
| roadmap §0.5 머리말·§3-M(MP0~MP5) | 전부 🔜 미착수 | **✅ 구현 완료**(런타임 스모크 항목은 🟡 정직 구분: 실 FTP/SFTP 서버 연결·DPAPI 실암호화·외부 앱 실드롭·GUI 전송) |
| traceability §1-M | 🔜(코드 미생성) | ✅ + 실파일 경로 확정(이미 실파일과 일치하므로 상태·머리말만 정정) |
| PRD §M·MoSCoW·§6 | 전부 🔜 미착수 | ✅(M1·M2 Should·M3 Could 구현 완료) |
| features §M(M1/M2/M3 수용기준 `[ ]`) | 전부 🔜·`[ ]` | ✅·`[x]`(런타임 의존 항목만 주석) |
| user-stories 에픽12·백로그표 | 전부 🔜 미착수 | ✅ |
| flows F14~F16 | 전부 🔜 미착수 | ✅ |

**🟡 정직 구분(런타임 스모크 권장 — 헤드리스로 미증명)**: 실 FTP/FTPS/SFTP 서버 연결·전송·DPAPI 실암호화·`webContents.startDrag` 외부 앱 실드롭·CF_HDROP 탐색기 실연동·GUI 원격 탐색. verify는 헤드리스 불변식만 증명.

## 확인 필요(사용자 판단)

- 없음(구현 차단 쟁점 없음). ADR-007 UQ-M1~M4(safeStorage UI·resume·원격↔원격·전용 프로세스)는 전부 1차 범위 밖·구현 비차단으로 이미 PM 확인 대상. 본 검증은 그 deferral이 코드에 정직히 반영됨을 확인.
