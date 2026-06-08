# §M(에픽12) 구현 로드맵 + 세부 구현계획 — 독립 계획 검증 보고서

> 검증자: reviewer(독립) · 2026-06-08 · 1회차
> 대상: `docs/roadmap.md` §3-M(MP0~MP5)+§4 역할표 · `docs/M-implementation-plan.md`(신규)
> 정합 기준(Read 완료): ADR-007 · system-architecture §5-M · software-architecture §11 · directory-structure §5-M·§6 · traceability §1-M · features §M · user-stories 에픽12 · 기존 코드(`.eslintrc.cjs`·`src/main/ipc/*`·`shared/ipc/channels.ts`·`OperationManager.ts`·`package.json`)
> 검증 성격: **계획·문서 검증**(코드 동작 아님) — 설계 정합·단계 순서·DoD 측정성·실행가능성·verify 적정성·ESLint 실효성·비파괴·확인필요 판정

---

## 판정: **PASS (조건부)** — 블로커 0, 높음 1(문서 정합 1건), 보통 4, 낮음 3

세부 구현계획은 설계 단일 출처(ADR-007/§5-M/§11/§5-M·§6/§1-M)와 **높은 정합도**로 일치하며, 단계 순서·의존성·DoD·verify 하니스가 기존 P0~L 양식을 일관되게 답습한다. 구현팀이 추측 없이 착수 가능한 수준의 파일경로·시그니처·DTO·zod·변경지점이 확정돼 있다. **착수 차단 블로커는 없다.** 다만 ① §5-M 본문의 "대체·확장" 표현과 본 계획의 "비파괴 병존"(CN-1) 사이 **문서-계약 정합 불일치 1건(높음)**은 PM/사용자 결정으로 해소 후 진행 권장이며(차단은 아님), 보통/낮음 항목은 구현 중 반영하면 된다.

---

## 항목별 검증 결과

### 1. 설계 정합성 — **합치**
- 신규 채널 19종(`dnd:start-drag`·`clipboard:write/read/has-files`·`remote:*` 16종)이 system-architecture §5-M.1 카탈로그와 **시그니처·Req/Res·에러타입까지 일치**. `op:*` 재사용(다운/업로드 진행률) 결정도 §5-M.1·ADR-007 ⑤와 합치.
- `RemoteError = FileOpError`(code 유니온 확장·별도 kind 없음·비밀 필드 없음)가 §5-M.1 L339·ADR-007 ⑥과 정확히 동일.
- 모듈 배치(`os/{dragdrop,shellClipboard,credentials}`·`remote/*`·`persistence/RemoteProfileStore`·`domain/rules/transferRoute`)가 directory-structure §6 트리·software-architecture §11.2 계층표와 일치. 도메인 순수성(transferRoute는 IO 모름) 유지.
- `RemoteEntry=FileEntryDTO` 재사용이 §11.1과 합치. `RemoteProfileDTO` 비밀 구조적 배제가 ADR-007 ③⑥와 합치.
- **설계 위반·임의 변경 없음.**

### 2. 단계 순서·의존성 — **타당**
- MP0(ESLint/의존성) 선행 필수 근거 정확: remote/ ESLint 예외 없이는 MP4 remote 코드가 lint 실패 → MP0 < MP4 강제. (검증: 현재 `.eslintrc.cjs`에 remote/ override 부재 확인.)
- MP1(계약 동결) = 전 Phase 선행, "인터페이스 먼저"(P1 선례) 타당.
- M1(MP3)·M2(MP2) 신규 의존성 0·상호 무관 → 병렬·선행, M3(MP4/5) 후행. 의존 그래프에 **순환·누락 선행 없음**.
- MP5는 MP1 모킹 선행 + MP4 실연동. 합리적.

### 3. 완료기준(DoD) 측정 가능성 — **충분(특히 보안)**
- MP4 보안 DoD가 features §M3 수용기준(L932~944)·ADR-007 ⑥와 1:1 추적: "평문 비밀 0"→`verify:credentials`(저장 객체 평문 secret 부재 단언), "호스트키 TOFU"→`verify:remote`(unknown→accept 흐름)·`verify:remote-trust`(host-key changed 경고), "세션 격리"→`verify:remote`(한 세션 throw 0→session-error), "원격응답 불신"→`verify:remote-trust`(traversal/Zip Slip/심볼릭/새니타이즈 + **비밀 grep 0**). 전부 헤드리스 검증가능 단언으로 환원됨 → **측정 가능**.
- MP0 DoD("remote/ 밖 네트워크 import lint 차단·안 lint 통과")가 `verify:eslint-remote` 정적 단언으로 검증가능.
- 런타임 의존분(실 DPAPI·실 FTP/SFTP·외부 앱 드롭·실 startDrag)을 🟡 스모크로 정직히 분리 — 기존 K·L장 양식과 일관.

### 4. 실행 가능성 — **착수 가능**
- 0절 명명·경로 단일출처표 + Phase별 ①만들/고칠 파일 ②시그니처 ③DTO/zod ④변경지점 ⑤verify ⑥역할이 확정. 구현팀이 추측 없이 착수 가능.
- 기존 코드 정합 확인: `handleGuarded`(파일별 로컬 정의)·`zPath`·`parseArgs`·`isTrustedSender`·`guardPath`(guard.ts), `registerTrashHandlers`(index.ts 등록 선례), `OperationManager.ops`/`start()`(원격 연동 진입점 존재) — 계획이 가리키는 심볼·패턴이 **실재**.
- 기존 clipboard 채널(`clipboard:copy-files/cut-files/paste-target/read`)·신규(`write/read/has-files`) **문자열 충돌 없음**(검증: channels.ts L55~58).
- **치명적 공백 없음.** (보통·낮음 항목은 아래.)

### 5. 검증 하니스 적정성 — **일관·핵심위험 커버**
- 신규 verify 8종이 `package.json` 기존 양식(esbuild 번들→node·`--alias:@shared/@renderer`·`--alias:electron=stub`)과 일치(검증: verify:thumbnail/paste 선례).
- 핵심 위험 커버: 클립보드 왕복(`verify:clipboard-hdrop` 방어적 파싱 매트릭스)·드래그 거부(`verify:dnd` 원격/미존재 거부·startDrag 스파이)·자격증명 비밀배제(`verify:credentials` 평문 0)·원격 신뢰경계(`verify:remote-trust` traversal/Zip Slip/비밀 grep). **누락 위험 없음.**

### 6. ESLint 화이트리스트 실효성 — **실효·"추가"가 정확(오기 아님)**
- **현재 `.eslintrc.cjs` main override(L88~108) 차단 목록 실측**: `node:http`·`http`·`node:https`·`https`·`net`·`node:net`·`dgram`·`node:dgram` **정확히 8개**. `node:tls`·`ssh2`·`ssh2-sftp-client`·`basic-ftp`는 **현재 차단 안 됨**(부재 확인).
- 따라서 MP0 (2-b) "신규 4개 차단 추가"는 **진짜 추가 작업**이며 "이미 차단된 듯한 오기" 없음. (2-a) "기존 8개 유지"도 정확. (2-c) remote/ override(후순위 매칭 우선으로 완화) 구조도 ESLint override 의미론상 실효.
- `node:tls` 차단이 화이트리스트 핵심(basic-ftp FTPS 내부 tls 사용)이라는 근거가 ADR-007 ②(2-b)·directory-structure §5-M 구현체크와 합치.

### 7. 비파괴 — **무손상**
- 기존 roadmap P0~P7·G~L·§4(P0~P7 역할)·§5(게이트)는 §3-M·§4(MP행) **추가만**, 내용 변경 없음(검증: §0.5 상태표·P6 표·§4 P행 무변경 확인).
- 기존 clipboard 4핸들러·`fileClipboard.ts` 보존(병존). 기존 채널/DTO/verify 누계 회귀 0 명시.

### 8. 확인 필요(CN-1~5) 판정 — 아래 별도 절

---

## 반영 항목

### [높음-1] §5-M 본문 "대체·확장" vs 본 계획 "비파괴 병존" 문서 정합 불일치 (CN-1)
- **무엇**: system-architecture §5-M.1 L286·L301은 기존 `clipboard:copy-files/cut-files/paste-target/read`(텍스트 폴백)를 신규 3채널로 **"대체·확장"**·**"대체"**로 명시. 그러나 M-implementation-plan(CN-1·MP2 §③)은 기존 4핸들러·`fileClipboard.ts`를 **삭제하지 않고 보존(비파괴 병존)**하고 렌더러 호출부만 전환한다고 결정.
- **위치**: system-architecture §5-M.1 L286,L301 ↔ M-implementation-plan §0(CN-1)·MP2 ③·부록C CN-1.
- **문제**: 설계 단일출처 문구("대체")와 구현계획("병존")이 표면적으로 상충. 그대로 두면 qa 구현검증 단계에서 "설계는 대체인데 왜 병존이냐"는 드리프트 시비 소지. 어느 쪽이든 **불변규칙(비파괴)·B4 동작불변**은 충족되나, 단일출처 정합이 깨진 채로 두면 안 됨.
- **권고**: 둘 중 하나로 정합화 — (A·권장) §5-M.1 문구를 "1차는 비파괴 병존(신규 채널로 호출부 전환)→기존 텍스트폴백 채널은 후속 정리"로 갱신해 계획과 일치시키거나(doc-sync 게이트로 처리 가능), (B) 계획을 §5-M "즉시 대체"에 맞춰 기존 4채널 제거. **데이터안전·회귀리스크상 (A) 권장.** 이 정합화는 **PM/사용자 결정 사항**(아래 CN-1).

### [보통-1] MP4 OperationManager 원격 연동 방식 미확정 (CN-4)
- **무엇**: 원격 전송 진행률을 기존 `op:progress/done`·200ms 스로틀·AbortSignal에 태우는 방식이 "전용 메서드(`registerExternalOperation`/`trackRemote`) 추가" vs "remoteTransfer 직접 op 푸시" 미결.
- **위치**: M-implementation-plan MP4 ⑥(CN-4).
- **문제**: `OperationManager`는 현재 `ops` Map·`start()`→`startWorker` 경로만 있고 외부 op 등록 진입점이 없음(검증 확인). 어느 방식이든 **기존 로컬 op 로직 무변경(비파괴)** 제약은 명시돼 있으나, 미확정이면 MP4 backend 착수 시 인터페이스 충돌 가능.
- **권고**: MP4 착수 전 backend가 "전용 메서드 추가(기존 ActiveOp 맵에 원격 op 등록·onCancel 위임)"를 기본안으로 1줄 확정. 설계상 **권장 기본값으로 진행 가능**(차단 아님).

### [보통-2] startDrag 아이콘 소스 미확정 (CN-2)
- **무엇**: `webContents.startDrag`는 `icon`(빈 NativeImage 불가) 필수. `getFileIcon`은 dataURL 반환·startDrag는 NativeImage 필요.
- **위치**: M-implementation-plan MP3 ②(CN-2).
- **문제**: 최소 16px 리소스 아이콘 또는 `nativeImage.createFromDataURL` 변환 경로가 미확정이면 MP3 런타임에서 startDrag 거부 가능. (단 verify:dnd는 stub이라 헤드리스 검증은 무영향.)
- **권고**: MP3 착수 시 "번들 리소스 아이콘(single/multi/folder 3종, 최소 16px) 준비"를 기본안으로 확정. **권장 기본값으로 진행 가능**(차단 아님).

### [보통-3] credentials.enc ↔ atomic.ts "비밀 저장 금지" 헤더 정합 (CN-3)
- **무엇**: `credentials.enc`는 암호문(평문 아님)이라 atomic.ts "평문 세션/설정만" 주석과 의미상 모순 아님이나, 헤더 메모가 없으면 후속 리뷰어 혼동.
- **위치**: M-implementation-plan MP4 ②(CN-3).
- **문제**: 문서/주석 정합 위생 문제(보안 결함 아님).
- **권고**: MP4에서 atomic.ts 헤더에 "암호문은 예외(credentials.ts 경유)" 1줄 추가 또는 credentials.ts 전용 원자쓰기. **권장으로 진행 가능**(차단 아님).

### [보통-4] verify:eslint-remote의 .eslintrc.cjs import 방식 양식 차이
- **무엇**: 신규 verify 7종은 esbuild 번들→node 양식이나, `verify:eslint-remote`는 `.eslintrc.cjs`를 직접 import해 구조 단언한다(L53). 기존 verify는 `**/*.cjs`가 eslint ignore이고 esbuild 번들 대상이 src인 점과 약간 결이 다름.
- **위치**: M-implementation-plan MP0 ④·부록B.
- **문제**: 실행은 가능(node가 .cjs require)하나, package.json 스크립트 형태(esbuild 경유 vs 직접 node require)를 명시 안 하면 devops가 양식 추측.
- **권고**: MP0에서 `verify:eslint-remote`는 "esbuild 없이 `node scripts/verify-eslint-remote.cjs`(또는 .mjs에서 require)로 `.eslintrc.cjs`를 require해 overrides 배열 정적 검사" 형태를 1줄 명시. 사소.

### [낮음-1] zRemoteProfileDTO.strict() 비밀배제 단언의 한계 명시
- **무엇**: `.strict()`는 알려지지 않은 키 거부로 password 등 임의 비밀필드 주입을 막으나, 이는 "스키마 정의 시점에 비밀필드를 안 넣었다" 전제. verify:m-contract (c)/(d)가 이를 단언하므로 충분하나, "strict는 unknown key 거부일 뿐 known 필드 비밀화는 타입/구조검사로 보장"임을 verify 주석에 남기면 좋음.
- **위치**: MP1 ⑤·⑧.
- **권고**: 정보성. verify:m-contract 단언 문구에 반영.

### [낮음-2] 원격 path zod가 guardPath 미적용임을 핸들러 주석에 강조
- **무엇**: 원격 POSIX 경로는 로컬 guardPath(win32) 미사용·어댑터에서 POSIX traversal 방어. 계획에 명시돼 있으나(MP1 ⑤ 주의·MP4 ⑤), 구현자가 실수로 guardPath를 원격 path에 적용하면 정상 경로 거부 가능.
- **위치**: MP1 ⑤·MP4 ⑤.
- **권고**: remote.handlers 각 핸들러에 "원격 path는 guardPath 금지(POSIX)·로컬 destDir/localPaths만 guardPath" 주석 강제. verify:remote-trust가 이를 커버하므로 사소.

### [낮음-3] op:cancel 원격 전송 .part 정리 책임 위치 명시
- **무엇**: §5-M.1 L337은 `op:cancel`→AbortSignal→스트림 destroy·`.part` 정리. 계획 MP4 ④는 remoteTransfer가 .part 원자 rename은 명시하나, 취소 시 .part **삭제** 책임(remoteTransfer vs OperationManager)이 CN-4 미확정과 얽힘.
- **위치**: MP4 ④·⑥.
- **권고**: CN-4 확정 시 "취소→.part 삭제는 remoteTransfer onCancel에서" 1줄 동봉.

---

## 확인 필요 (PM/사용자 결정) — CN-1~5 판정

| # | 항목 | reviewer 판정 | 결정 주체 |
|---|---|---|---|
| **CN-1** | 기존 clipboard 채널 병존 vs 즉시 대체 | **사용자/PM 결정 필요** — §5-M "대체" 문구와 계획 "병존"이 정합 불일치(높음-1). 비파괴·B4 불변상 **병존(권장)**이 안전하나, 단일출처 문구 정합화가 필요해 사용자/PM이 (A 문서갱신/B 즉시대체) 택일 권장 | **PM→사용자** |
| **CN-2** | startDrag 아이콘 소스 | **권장 기본값으로 진행 가능**(번들 16px 리소스 아이콘 3종). 구현 비차단 | backend/devops(MP3) |
| **CN-3** | credentials.enc ↔ atomic.ts 헤더 정합 | **권장으로 진행 가능**(헤더 메모 추가). 보안결함 아님·비차단 | backend(MP4) |
| **CN-4** | OperationManager 원격 재사용 방식 | **권장 기본값으로 진행 가능**(전용 메서드 추가·기존 로직 무변경). MP4 착수 전 backend 1줄 확정 | backend(MP4) |
| **CN-5** | ssh2 가속 optional 빌드·서명 영향 | **권장으로 진행 가능**(순수 JS 모드 기본·ADR-007 ④와 합치). devops MP4 점검 항목·비차단 | devops(MP4) |

**결론**: CN-2~5는 전부 **권장 기본값으로 구현 진행 가능(비차단)**. **CN-1만 PM→사용자 결정이 필요**(설계 단일출처 문구와 계획의 정합화 방향). 단, CN-1도 어느 방향이든 비파괴·B4 불변은 충족되므로 **MP0/MP1 착수 자체는 차단되지 않으며**, MP2(클립보드 전환) 착수 전까지 결정하면 된다.

---

## 종합

- **PASS(조건부)**. 블로커 0. 높음 1(문서 정합·CN-1)은 PM/사용자 결정으로 해소 권장이나 MP0/MP1 착수는 비차단. 보통 4·낮음 3은 구현 중 반영.
- 설계 정합·단계 순서·DoD 측정성·실행가능성·verify 적정성·ESLint 실효성·비파괴 전 항목 통과.
- 권고 진행: MP0/MP1 즉시 착수 가능 → MP2 착수 전 CN-1 결정 반영 → MP4 착수 전 CN-2/3/4/5 기본값 1줄 확정.
