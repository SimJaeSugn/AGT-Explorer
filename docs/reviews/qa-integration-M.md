# 통합 QA 보고서 — §M(에픽12) 외부 연계 3기능 (M1·M2·M3)

> 대상: M1 외부 D&D 복사 · M2 클립보드 CF_HDROP 외부연계 · M3 FTP/SFTP 원격
> 기준: features §M(M1/M2/M3) · user-stories 에픽12(US-12.1~12.5) · flows F14~F16 · ADR-007 · system-architecture §5-M(SR5~SR8) · M-implementation-plan
> 검증 일자: 2026-06-08 · 검증자: QA 엔지니어 · 방식: 헤드리스(빌드·타입·린트·verify 하니스·경계면 코드 교차)

## 최종 판정: **PASS** (조건: 런타임 스모크 권장 목록 잔여 — 헤드리스 한계)

블로커 0 · 높음 0 · 보통 0 · 낮음 2(문서/관측 메모, 기능 영향 없음). 전체 빌드/타입/린트 0 에러, §M 신규 verify 7종 213 pass / 0 fail, 회귀 verify 전종 0 fail. 경계면 교차(계약↔preload↔핸들러↔렌더러) 전부 정합. 보안 수용기준(SR5~SR8·ADR-007 ①~⑦) 코드 실재 확인.

---

## 1. 빌드 · 타입 · 린트 (실제 Bash 실행)

| 게이트 | 명령 | 결과 |
|---|---|---|
| 타입체크 | `npm run typecheck`(node+web) | **0 에러** (exit 0) |
| 린트 | `npm run lint` (eslint . --ext ts,tsx,cjs) | **0 에러** (exit 0) |
| 빌드 | `npm run build` (typecheck + electron-vite build) | **성공** (exit 0) |

- 빌드 경고 2건은 **사전 존재 advisory**(infra/api/index.ts·usecases/remote.ts 가 정적+동적 import 혼용 → 청크 미분리 안내). 에러 아님·기능 영향 없음. 동적 import 는 순환(panelsSlice→remote, clipboardExternal→remote) 회피용 의도된 패턴.
- 산출 청크: main index.js 139kB · preload 12kB · renderer index 564kB + lazy(Dashboard 836kB·marked/purify 분리). 원격 라이브러리(ssh2/basic-ftp)는 main 번들에 external 처리되어 청크 비대화 없음.

## 2. verify 하니스 누계

### §M 신규 7종 (전부 PASS)
| 하니스 | pass | fail | 핵심 단언 |
|---|---|---|---|
| `verify:eslint-remote` | 29 | 0 | remote/ 밖 tls·ssh2·ssh2-sftp-client·basic-ftp·기존8 차단 / remote/ 안 allow / renderer 금지 유지 (lintText 행동검증 포함) |
| `verify:clipboard-hdrop` | 33 | 0 | DROPFILES 방어적 파싱 6종·copy/cut 왕복·DropEffect=Move·외부 합성 CF_HDROP·손상 폴백 none |
| `verify:dnd` | 29 | 0 | 원격 prefix ESECURITY·미존재 ENOENT·빈 paths EINVAL·빈 아이콘 사전차단·wc destroyed false·아이콘 fallback |
| `verify:credentials` | 17 | 0 | safeStorage 라운드트립·평문 0(JSON 에 password/privateKey 부재)·미가용 시 EUNSUPPORTED 거부(평문 폴백 금지)·has/delete |
| `verify:remote` | 23 | 0 | TOFU(unknown 보류/accept 통과·저장/reject 거부)·세션 격리·list FileEntryDTO·EAUTH 전파·traversal·CN-4 operationId+op:done |
| `verify:remote-trust` | 35 | 0 | 파일명 sanitize(예약명·구분자)·.part 임시명→원자 rename·Zip Slip 차단·hostkey/errno 분류·비밀 0 |
| `verify:remote-route` | 47 | 0 | local/remote 라우팅(upload/download/copy/move/unsupported)·remoteLocation 파싱 |
| **소계** | **213** | **0** | |

### 회귀 (기존 verify 전종 — 전부 PASS, 회귀 0)
| 하니스 | pass/fail | | 하니스 | pass/fail |
|---|---|---|---|---|
| verify:fs | 19 / 0 | | verify:recyclebin | 37 / 0 |
| verify:ops | 35 / 0 | | verify:p6 | 26 / 0 |
| verify:worker | 8 / 0 | | verify:open-with | 12 / 0 |
| verify:persistence | 94 / 0 | | verify:shell-h4h6 | 25 / 0 |
| verify:scan | 39 / 0 | | verify:thumbnail | 33 / 0 |
| verify:perf | 25 / 0 | | verify:store | 99 / 0 |
| verify:fmatrix | 32 / 0 | | verify:domain | 30 / 0 |
| verify:contrast | 0 fail / 0 warn | | verify:operations | 75 / 0 |
| verify:watch | 77 / 0 | | verify:p5 | 52 / 0 |
| verify:paste | 13 / 0 | | | |
| **회귀 소계** | **약 802 pass / 0 fail** | | | |

**누계: 신규 213 + 회귀 ~802 = 약 1015 pass / 0 fail.** 회귀 0 확인(기존 클립보드 B4·내부 D&D A3·패널 탐색·파일작업·undo·휴지통·워처 전부 그린).

## 3. 경계면 교차 비교 (계약 단일출처 ↔ preload ↔ 핸들러 ↔ 렌더러)

계약 단일출처 = `src/shared/ipc/{channels,contracts}.ts` + `src/shared/dto/index.ts`. 4계층이 동일 타입·shape 임을 교차 확인.

### M2 clipboard:read-files (응답 paths+effect ↔ 붙여넣기 사용처)
- 계약: `ClipboardFilesReadRes = { paths: string[]; effect: ClipboardEffectKind('copy'|'move'|'none') }` (contracts.ts:290).
- 핸들러(`clipboard.handlers.ts:148`): 외부 CF_HDROP 파싱 → 각 경로 guardPath+F_OK 검증 통과분만 `ok({paths, effect})` 반환(불신 입력·ADR-007 ⑥). 빈/손상 → `{paths:[], effect:'none'}`.
- preload(`api.ts:190`): `readFiles(): Promise<Result<ClipboardFilesReadRes>>`.
- 렌더러(`clipboardExternal.ts:88`): `clipboardApi.readFiles()` → `clip.value.effect`(none 가드) → `clipboardEffectToOpKind(effect)` → 기존 `startOperation(kind, paths, dest, ...)` 투입(D4 충돌·E4 진행률·undo 메타 그대로). **정합 ✅** (effect=move 일 때 cut 부모+대상 새로고침·undo move 등록).

### M3 remote:list (FileEntryDTO[] ↔ panelsSlice 원격 entries 주입)
- 계약: `RemoteListRes = { entries: FileEntryDTO[] }` (contracts.ts:365). entries 는 기존 로컬과 동일 `FileEntryDTO` 재사용(원격 절대경로).
- 핸들러(`remote.handlers.ts:147`): `remoteSessionManager().list(sessionId, path)` → `Result<RemoteListRes, RemoteError>`.
- 렌더러: `panelsSlice.load`(panelsSlice.ts:302) 가 `isRemotePath(path)` 면 `listRemoteDir`(remote.ts:178) 호출 → `res.value.entries` 를 `_setRemoteEntries`(panelsSlice.ts:499) 로 `p.directory.entries` 에 주입. 로컬과 **동일 shape** → 정렬/필터/선택/가상스크롤 그대로 재사용. **정합 ✅** (이동 중 경로 변경 응답 폐기 가드 포함).

### M3 remote:download/upload operationId ↔ op:* 진행률 브리지
- 계약: `RemoteTransferRes = { operationId: string }` (contracts.ts:383). 진행률·충돌·완료·취소는 **신규 채널 없이 기존 op:\*** 재사용.
- 핸들러(`remote.handlers.ts:164/176`): 로컬 destDir/소스 guardPath → `startDownload/startUpload(adapter, ..., operationManager)`.
- 전송(`remoteTransfer.ts`): `operationManager.registerExternalOperation('copy', wc, onCancel)`(OperationManager.ts:461) 로 operationId 발급 → `reportProgress`(op:progress 200ms 스로틀)·`finishOp`(op:done). `.part` 임시명→원자 rename.
- 렌더러(`remote.ts:245 registerTransfer`): `s.registerOperation(operationId, 'copy', refreshPanels)` → 기존 operationsBridge(op:*)가 진행/완료 추적. **정합 ✅** (operationId 양끝 동일·undo 미생성).

### M3 remote:host-key 푸시 ↔ HostKeyModal
- 계약: `RemoteHostKeyEvt = { connectId, fingerprint, algo, status('unknown'|'changed') }` (contracts.ts:559)·EVENT_CHANNELS 등록(channels.ts:165).
- preload(`api.ts:217`): `onHostKey(cb)` 구독.
- 렌더러: `subscribeRemoteEvents.onHostKey` → `_setHostKeyPrompt(evt)`(remote.ts:404) → `HostKeyModal`(HostKeyModal.tsx:19) 이 `hostKeyPrompt` 구독해 fingerprint·algo 표시·`status==='changed'` 분기(경고 강조)·Esc=거부·초기 포커스=거부 버튼(실수 신뢰 방지). accept→`acceptHostKey`(hostKeyDecision:'accept' 재연결)·reject→`rejectHostKey`. **정합 ✅**.

### M1 dnd:start-drag
- 계약: `DndStartDragReq = { paths, iconHint? }` → `DndStartDragRes = { started }` (contracts.ts:273).
- 핸들러(`dnd.handlers.ts`): `validateDragPaths`(원격 prefix ESECURITY·guardPath·존재) → 대표 아이콘(빈 금지·fallback) → `startExternalDrag`. 렌더러(`externalDrag.ts:41`)는 `dndApi.startDrag` 위임만. **정합 ✅** (외부=복사 고정·원격 항목 외부 드래그 차단).

## 4. 보안 수용기준 교차 검증 (SR5~SR8 · ADR-007 ①~⑦)

| 항목 | 근거(코드) | 판정 |
|---|---|---|
| 자격증명 평문 0(DTO) | `RemoteProfileDTO`(dto:423) 비밀 필드 자체 없음 + `RemoteProfileStore.coerceProfile`(화이트리스트 7필드만 영속·임의 비밀키 구조적 배제) | ✅ |
| 자격증명 safeStorage 암호문만 | `credentials.ts`: encryptString→base64 만 디스크. `isEncryptionAvailable()===false` → EUNSUPPORTED 거부(**평문 폴백 금지**). verify:credentials "평문 0" 단언 통과 | ✅ |
| 비밀 응답/로그/Error 비노출 | `remote.handlers.connect` 응답 `{sessionId, encrypted}` 만. `remoteErrors.toRemoteError`: 원본 메시지 폐기·SAFE_MESSAGES 상수+path 만 전파. verify:remote/remote-trust "비밀 0" 통과 | ✅ |
| 렌더러 store 비밀 비보관 | grep: renderer/app/stores 에 password/passphrase/privateKey 부재. `remote.ts`: secret 은 connect/credSave 요청 본문(pendingConnect 휘발 메모리)으로만 | ✅ |
| 네트워크 import 격리(ESLint) | `.eslintrc.cjs`: main 광역 차단(기존8 + node:tls·tls·ssh2·ssh2-sftp-client·basic-ftp) + `src/main/remote/**` 만 allow. grep: remote/ 밖 네트워크/원격라이브러리 import **0건**. verify:eslint-remote lintText 행동검증 통과 | ✅ |
| 호스트키 TOFU | `RemoteSessionManager`+`known_hosts.json`(지문만). unknown 보류/accept 저장/reject 거부/changed 경고. verify:remote 통과 | ✅ |
| 원격 traversal 차단 | `remotePath.normalizeRemotePath`(절대강제·널바이트 거부·POSIX `..` 루트 clamp)·`joinRemote`(구분자/`..` 거부). verify:remote-trust 통과 | ✅ |
| .part 원자 rename | `remoteTransfer.startDownload`: `<dest>.part`→완료 시 `fsp.rename`·취소/실패 시 .part 정리. verify:remote-trust ".part 부재(원자 rename)" 통과 | ✅ |
| Zip Slip 차단 | `safeLocalDestPath`+`isWithinLocalDir`(win32 도착지 하위 검증). verify:remote-trust "도착지 밖 미생성" 통과 | ✅ |
| 평문 FTP 경고 | `FtpAdapter`: ftp→`encrypted=false`. `remote.ts:131`: `!encrypted` → 비암호화 경고 토스트 | ✅ |

> **무결성 가정(정직 기록)**: known_hosts.json·credentials.enc·profiles.json 의 변조 방지는 userData OS 파일권한에 위임(ADR-007 ⑥-4). DPAPI 는 기밀성만 보장 — 단일사용자·로컬 가정(PRD §9) 위협모델 밖. 설계상 명시된 deferral 로 결함 아님.

## 5. 기능 수용기준 충족 (US-12.1~12.5)

헤드리스로 충족 가능한 계약·로직 경계는 ✅, 실 네이티브/네트워크 런타임 의존은 🟡(스모크 권장).

| US | 수용기준 요지 | 헤드리스 판정 |
|---|---|---|
| US-12.1 (M1) | 외부 드래그=복사·다중·폴더·내부/외부 분기·취소 시 원본 보존·원격 제외·경로만 노출 | 로직/계약 ✅ (검증·분기·원격 차단·아이콘 fallback). `webContents.startDrag` 실제 OS 드롭 🟡 |
| US-12.2 (M2) | Ctrl+C→탐색기 붙여넣기 복사·Ctrl+X→이동(Move)·외부→앱 붙여넣기(DropEffect 존중)·충돌 D4·진행 E4·비파일 무시·B4 불변·원격 제외 | DROPFILES 조립/파싱·effect 매핑·op 파이프라인 ✅. 실 탐색기 양방향 왕복 🟡 |
| US-12.3 (M3) | 접속·비번/SSH키·호스트키 TOFU·자격증명 OS 보관소만·평문 금지 | TOFU·safeStorage·평문0 ✅. 실 ssh2/basic-ftp 핸드셰이크·실 DPAPI 🟡 |
| US-12.4 (M3) | 프로필 CRUD·원격 패널 UX·로컬과 구분 표기·패널 1개로 나란히 | 프로필 store·panelsSlice 원격 라우팅·URI 표기 ✅. 실 서버 디렉토리 렌더 🟡 |
| US-12.5 (M3) | 업/다운로드 D&D·복붙·E4 진행/취소/부분실패·D4 충돌·타임아웃/끊김/인증실패 격리·임의송신 0·평문경고 | operationId op:* 브리지·세션격리·오류분류·.part·라우팅·평문경고 ✅. 실 전송·실 끊김 복원 🟡 |

## 6. 결함 목록

블로커 0 · 높음 0 · 보통 0.

### 낮음-1 (관측·문서) — verify 일괄 루프에서 일부 하니스 result 라인 미포착
- **무엇이**: `verify:contrast`·`verify:p6` 등은 `RESULT: n passed` 형식이 아닌 자체 포맷(`결과: 실패 0건`, `== n PASS / 0 FAIL ==`)이라, grep 기반 일괄 집계 스크립트에서 "no result line" 으로 보일 수 있음.
- **어디서**: QA 집계 편의 문제(제품 코드 아님). 개별 실행 시 전부 PASS·exit 0 확인됨.
- **심각도**: 낮음(제품 무관·집계 도구 한정). 권장: CI 집계 시 종료코드 기준으로 판정.

### 낮음-2 (가독성 메모) — 소스 내 리터럴 NUL(` `) 바이트
- **무엇이**: `remotePath.ts`·`RemoteProfileStore.ts` 의 `includes(' ')` 가 소스에 **실제 NUL 바이트**로 들어가 있어, Read/Grep 도구가 공백으로 렌더링하고 git 이 파일을 "binary" 로 표시함. 동작은 정상(널바이트 거부가 의도대로 작동, verify-remote-trust `/a\0b`→거부 통과 확인).
- **어디서**: `src/main/remote/remotePath.ts:47`, `src/main/persistence/RemoteProfileStore.ts`(sanitize 정규식).
- **기대 vs 실제**: 동작은 정확. 다만 코드 리뷰/grep 가독성·git diff 친화성 저하. 권장(비차단): `' '` 대신 `String.fromCharCode(0)` 또는 정규식 `/\x00/` 으로 표기해 텍스트 파일 유지.
- **심각도**: 낮음(기능·보안 영향 없음·가독성만).

> **검증 중 자가정정 기록(정직)**: 1차로 `normalizeRemotePath` 의 `includes(' ')`(공백)로 오판해 "널바이트 미차단·공백경로 오거부" 결함을 의심했으나, 파일 바이트 직접 검사(charCode=0) 결과 **실제 NUL 바이트**임을 확인 → 결함 아님(낮음-2 가독성 메모로 격하). 공백 포함 원격 경로는 정상 통과한다.

## 7. 런타임 스모크 권장 목록 (헤드리스 한계 — 사용자 알림)

아래는 코드 정합·verify 충족은 확인됐으나 **실 네이티브/네트워크 실행이 필요**해 헤드리스로 단언 불가한 항목. 릴리스 전 실기 1회 스모크 권장(전부 결함 아님·🟡).

1. **M1**: 패널→바탕화면/탐색기/타앱 실제 드래그 드롭 시 복사·드래그 고스트 아이콘 표시(`webContents.startDrag`).
2. **M2**: 앱 Ctrl+C → 탐색기 Ctrl+V 복사 / 앱 Ctrl+X → 탐색기 이동(Move 효과) / 탐색기 복사 → 앱 Ctrl+V 붙여넣기(DropEffect 존중)의 실 왕복.
3. **M3 접속**: 실 SFTP(키/비번)·FTP·FTPS 핸드셰이크(ssh2/basic-ftp), 호스트키 미신뢰/변경 모달 실표시.
4. **M3 자격증명**: 실 Windows DPAPI(safeStorage) 암복호 라운드트립·재시작 후 재접속.
5. **M3 탐색/전송**: 실 서버 디렉토리 목록 렌더·업/다운로드 진행률·취소·대용량·이름충돌(D4)·.part→최종 rename.
6. **M3 장애 격리**: 실 타임아웃/연결끊김/인증실패/도달불가 시 해당 패널만 오류·앱·타패널 무중단(세션 격리).
7. **M3 평문 FTP**: 평문 ftp 연결 시 비암호화 경고 토스트 실표시.

---

## 부록 — 실행 명령(재현)
```
npm run typecheck   # 0 에러
npm run lint        # 0 에러
npm run build       # 성공
# §M 신규
npm run verify:eslint-remote ; npm run verify:clipboard-hdrop ; npm run verify:dnd
npm run verify:credentials ; npm run verify:remote ; npm run verify:remote-trust ; npm run verify:remote-route
# 회귀(핵심)
npm run verify:store ; npm run verify:operations ; npm run verify:paste ; npm run verify:watch ; npm run verify:recyclebin ; ...
```
