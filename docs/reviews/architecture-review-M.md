# 아키텍처 설계 검증 보고서 — §M(에픽12) 외부 연계 3기능

> 검증자: 독립 Reviewer(제3자·설계 비당사자) · 검증일: 2026-06-08 · 회차: M(설계)
> 대상: ADR-007 / ADR-000-index / ADR-005(부분 개정 메모) / system-architecture §5-M·SR5~SR8 / software-architecture §11 / directory-structure §5-M·§6 / traceability §1-M
> 기준: PRD(§6 §M·§7·§11 D6/D7) · features §M · user-stories 에픽12(US-12.1~12.5) · flows F14~F16 · 기존 ADR-003/005 · 기획 검증 보고서(planning-review-M PASS)

---

## 판정: **PASS (조건부 — 보통 2건 반영 권고, 블로커·높음 0)**

### 요약
ADR-007과 4개 설계 문서는 §M 3기능을 **정직하고 추적성 있게** 설계했다. 보안 ADR(가장 중요한 검증축)은 건전하다 — 네트워크 차단을 전면 해제하지 않고 `src/main/remote/` 단일 디렉토리 화이트리스트로 최소 표면화했고, safeStorage/DPAPI의 Credential Manager UI 미노출 한계를 **은폐 없이 정직하게 기록**했으며, ADR-005 충돌을 "부분 개정"으로 양방향 상호참조했다. 기술 선정에 대안 비교·트레이드오프가 모두 있고, IPC 계약은 ADR-003 단일출처 규약과 일관되며, 디렉토리·추상화 배치도 기존 계층과 정합한다. team-dev 착수를 막는 치명적 공백은 없다.

다만 **블로커는 아니나 반영을 권고하는 정확성·완결성 결함 2건**(보통)이 있다: ① 설계가 ESLint 가드를 "유지(maintain)"라 기술했으나 실제 `.eslintrc.cjs`는 `node:tls`·원격 라이브러리를 **차단하지 않고 있어** "유지"가 아니라 "추가"가 필요(코드-문서 불일치), ② chief-architect의 미해결 질문 3건이 **어느 문서에도 consolidated 목록으로 명시되지 않아** PM/사용자 결정 추적이 누락. 둘 다 구현 차단 수준은 아니나 정직성·추적성 원칙상 정정 권고. 미해결 질문 3건은 모두 "후속/1차 범위 밖"으로 안전하게 deferral돼 **구현 착수를 차단하지 않는다**.

---

## 체크리스트 판정 요약

| # | 체크 항목 | 판정 | 비고 |
|---|---|---|---|
| 1 | 추적성(M1/2/3 ↔ US-12.x ↔ F14~16 ↔ 채널/모듈 ↔ ADR-007) | ✅ PASS | traceability §1-M이 5행 모두 기능↔US↔flow↔채널↔모듈↔ADR 결정번호까지 연결. 기획 수용기준 빠짐 없음(아래 §1) |
| 2 | 보안 ADR 타당성(네트워크 경계·자격증명·신뢰 경계·ADR-005 충돌) | ✅ PASS | 최소 표면·safeStorage 한계 정직·원격 불신 입력·부분 개정 명시 모두 충족(아래 §2). **단 보통-1: ESLint "유지" 표현이 코드와 불일치** |
| 3 | 기술 선정 근거(라이브러리·프로세스·자격증명 대안 비교) | ✅ PASS | 3개 결정 모두 비교표+트레이드오프+네이티브/번들/서명 영향 고려(아래 §3) |
| 4 | IPC 계약 정합(ADR-003·선례·M2 내부 클립보드 통합) | ✅ PASS | 단일출처·invoke/이벤트·Result·sender·zod 일관. M2 우선순위 규칙 모순 없이 정의(아래 §4) |
| 5 | 디렉토리/추상화 타당성 | ✅ PASS | 신규 모듈 계층 정합·원격 FS는 별도 네임스페이스+공통 인터페이스(합리적·기존 FS와 무모순)(아래 §5) |
| 6 | 비파괴 확장 | ✅ PASS | 기존 ADR/문서 무손상·ADR-005 양방향 상호참조·기존 트리 무변경(아래 §6) |
| 7 | 실행 가능성(team-dev 착수·미해결 질문 차단성) | 🟡 PASS(조건부) | 착수 가능·치명 공백 0. **단 보통-2: 미해결 질문 3건 consolidated 목록 부재**(추적 누락·차단 아님)(아래 §7) |

---

## 검증 상세

### §1. 추적성 (PASS)
traceability §1-M의 5개 행이 끊김 없이 연결된다: M1=US-12.1·F14·`dnd:start-drag`·`os/dragdrop.ts`·ADR-007⑦, M2=US-12.2·F15·`clipboard:*`·`os/shellClipboard.ts`·ADR-007⑦, M3=US-12.3~12.5·F16·`remote:*`·`remote/*`·`os/credentials.ts`·ADR-007①~⑥. 기획 필수 수용기준 전수 대조 결과 누락 없음:
- US-12.3 "OS 보관소·평문 금지"(필수) → ADR-007 결정③·SR6·보안규칙8·directory §6에 반영.
- US-12.3 "SSH 키 인증·호스트 키 경고" → 결정④(hostVerifier 1급)·결정⑥-4(TOFU)·F16에 반영.
- US-12.3 "평문 FTP 비암호화 경고" → 결정⑥-5·SA보안규칙9·remote:connect `encrypted` 필드.
- US-12.4 "원격 내 rename/delete/mkdir" → `remote:mkdir/rename/delete` 채널 정의.
- US-12.5 "패널 단위 격리" → 결정⑤ RemoteSessionManager·`remote:session-error`(해당 세션만).
- US-12.5 "부분 파일 오인 방지"(기획 재검증 추가분) → 결정⑥-7 `.part`+원자 rename으로 직접 충족.
- US-12.1 "원격 항목 외부 D&D 제외" → `dnd:start-drag` 원격 네임스페이스 거부.

판정: 기획→설계 추적성 완결. 빠진 요구 없음.

### §2. 보안 ADR 타당성 (PASS · 가장 중요)

**(a) 네트워크 최소 표면 — 타당**: 결정①이 D5를 "사용자가 명시 입력/저장한 호스트로만"으로 정밀화(전면 개방 아님). 결정②가 네트워크 import를 `src/main/remote/` 단일 디렉토리 ESLint 화이트리스트로 가두고, 그 밖 모듈은 `RemoteService` 인터페이스로만 호출 → 외부 통신 표면이 한 디렉토리 뒤로 캡슐화. **우회 가능성 평가**: ESLint `no-restricted-imports`는 정적 import만 차단하므로 동적 `import()`/`require()`·문자열 난독화는 잡지 못하는 본질적 한계가 있으나, 이는 모든 lint 가드의 공통 한계이고 "감사 가능한 단일 디렉토리"라는 설계 목표(리뷰어가 한 곳만 보면 됨)는 유효하게 달성된다. 합리적.

**(b) safeStorage/DPAPI vs D6 "OS 자격증명 보관소" — 충족·정직**: D6/features §M3 L901/US-12.3 L471은 일관되게 "Windows Credential Manager/**DPAPI 계열**"로 기술한다. safeStorage는 Windows에서 DPAPI를 백엔드로 쓰므로 **D6의 "DPAPI 계열" 문언을 충족**한다. 핵심은 "평문 금지"인데 safeStorage는 OS 키 암호문만 보관하므로 충족. **한계의 정직성**: 결정③ 표(L63)·근거(L73)·트레이드오프(L156)에서 "Credential Manager UI에 항목이 안 보임(사용자 OS UI 직접 삭제 불가, 앱 내 삭제만)"을 3회 반복해 명시 → 은폐 없음. `isEncryptionAvailable()=false` 시 평문 폴백 금지·메모리 전용 폴백까지 규정(L71) → 데이터 안전 원칙 준수. 건전.

**(c) 원격 응답 불신 입력 — 충족**: 결정⑥이 traversal 방어(도착지 하위 이탈 차단·Zip Slip류)·심볼릭 미추종·파일명 새니타이즈·호스트키 TOFU·평문 FTP 경고·비밀 비노출·`.part` 원자 rename 7개를 모두 다룬다. 로컬 FS보다 강한 검증 명시. 충족.

**(d) ADR-005 충돌 처리 — 정직**: ADR-005 L3 상태줄+L5 부분 개정 메모(비파괴)와 ADR-007 L7·결정①말미·결과부가 **양방향 상호참조**. "삭제·대체 아님·부분 개정"을 반복 명시. ADR-000-index L14·L17도 등록·개정 관계 기록. 은폐 0.

판정: 보안 ADR은 건전·정직. 단 아래 **보통-1**(ESLint 코드-문서 불일치)은 정정 권고.

### §3. 기술 선정 근거 (PASS)
- 자격증명(결정③): keytar(아카이브 리스크)/safeStorage(채택)/napi-rs(후속) 3안 비교표+판정. 번들/서명 영향 0 명시.
- 라이브러리(결정④): ssh2-sftp-client·basic-ftp·jsftp·구형 비교표(라이선스·유지보수·네이티브·번들). 채택 근거(SFTP=ssh2 표준·hostVerifier 1급, FTP=순수 JS)+트레이드오프(라이브러리 2개) 명시. ssh2 `cpu-features`/`*-crypto` optional→순수 JS 모드 기본 번들로 코드서명/`@electron/rebuild` 영향 최소화(SR7와 정합).
- 프로세스(결정⑤): Main 스레드 vs Worker Threads 비교표. ADR-005 §(d) "Electron/네트워크 의존=Main 스레드" 원칙과 정합 근거(비밀 단일 경계·네트워크 I/O 바운드). 단정적이지 않고 "초대용량 동시 전송 시 UtilityProcess 후속 검토" 트레이드오프 인정.

판정: 근거 빈약·단정 없음. 충실.

### §4. IPC 계약 정합 (PASS)
SA §5-M.1 채널 시그니처가 ADR-003 단일출처(`shared/ipc` 채널상수+계약타입)·invoke(단발)/이벤트(푸시)·`Result<T,FileOpError>`·sender/zod/경로·세션 검증을 일관 적용. P1 동결 후 6선례(`preview:read`·`shell:open-terminal`·`analyze:scan:*`·`fs:watch:*`·`trash:*`·`preview:thumbnail`)와 동일 규약(traceability §1-M 주석). `RemoteError`를 FileOpError 확장으로 정의하고 비밀 필드 구조적 배제 명시.

**M2 내부/외부 클립보드 통합(체크리스트 4 핵심)**: ADR-007 §"M2 통합·우선순위 규칙"이 ① 앱 복사/잘라내기=시스템 클립보드 CF_HDROP 단일 출처 승격(+텍스트 폴백 병기), ② 붙여넣기=시스템 클립보드 우선 읽기, ③ 잘라내기 흐림 권위=시스템 클립보드, ④ **B4 동작 자체 불변**(단일 출처가 내부 상태→시스템 클립보드로 이동·체감 동일·외부 연계만 추가)로 모순 없이 정의. 기존 `clipboard:copy-files/cut-files/paste-target`(코드 실재 확인)을 신규 3채널로 "대체·확장"하는 변경이나, B4 불변 보장과 함께 일관 기술. 모순 없음.

판정: 정합.

### §5. 디렉토리/추상화 타당성 (PASS)
- directory §6 신규 모듈 배치가 기존 계층 규칙과 정합: 네트워크는 `main/remote/`만, 도메인 `transferRoute.ts`는 순수(IO 모름), 렌더러는 `remote:*` IPC만. SW §11.2 계층표가 도메인/앱/인프라/UI 각 신규 모듈 책임 정의.
- 원격 FS 추상화(SW §11.1): "별도 네임스페이스(`sftp://`·`ftp://`)+공통 도메인 인터페이스" 3안 비교 후 채택. 투명 통합 비채택 근거(세션·인증·끊김·취소 의미가 로컬과 달라 누수)가 타당. 기존 `FileEntryDTO`·`DirectoryView` 재사용으로 UI 무분기·`Panel.location` 판별 유니온으로 로컬 호환 유지 → 기존 FileSystemService와 모순 없음. SW §11.3 변화 격리표(프로토콜 추가·클립보드 포맷·자격증명 백엔드 교체)도 합리적.

판정: 합리적·무모순.

### §6. 비파괴 확장 (PASS)
- ADR-005: 삭제 없이 L3 상태줄+L5 메모+L48 본문 inline으로 "부분 개정" 추가. 프로세스·방어심층·CSP·셸 규칙은 "본 ADR 그대로 유지" 명시.
- ADR-000-index: ADR-007 행 추가, 개정 관계 각주.
- system/software/directory: 전부 "비파괴 추가·기존 트리 무변경" 머리말. SA §5-M, SW §11, DS §5-M/§6 모두 기존 절 뒤에 append.

판정: 기존 결정 충돌은 신규 ADR 명시 개정으로 처리. 손상 0.

### §7. 실행 가능성 (PASS 조건부)
team-dev가 착수할 수준의 계약·모듈·보안 규칙이 갖춰졌다. 채널 시그니처·DTO·모듈 경로·검증 규칙·시퀀스(F14~16)가 구현 지시 수준으로 구체적. 미해결 질문 3건의 차단성 판정:
- **safeStorage UI 노출**: 1차 safeStorage 확정, 후속 napi-rs는 "UI 노출이 요건이면". D6은 UI 노출을 요구하지 않으므로 **차단 아님**(deferral 안전).
- **이어받기(resume) 범위**: `.part`+원자 rename으로 "부분 파일 오인 방지"(US-12.5 필수)는 1차 충족, resume/체크섬만 후속. 기획도 "설계 단계 확정" 후 "방식은 설계"로 deferral 허용 → **차단 아님**.
- **원격↔원격 전송**: SW §11.1 전송 라우팅에서 "1차 범위 밖(후속)" 명시. 기획 US-12.4/12.5는 원격↔로컬만 요구 → **차단 아님**.

판정: 3건 모두 안전하게 deferral돼 구현 착수 차단 수준 아님. 단 **보통-2**(consolidated 목록 부재)는 추적성상 정정 권고.

---

## 발견 항목

### [보통-1] ESLint 네트워크 가드를 "유지(maintain)"로 기술했으나 실제 코드는 `node:tls`·원격 라이브러리를 차단하지 않음 — 코드-문서 불일치
- **무엇**: ADR-007 결정②(L46)·directory §5-M(L153)은 `node:tls` 및 원격 라이브러리(`ssh2`·`ssh2-sftp-client`·`basic-ftp`) import 금지를 "**유지**한다"고 기술한다. 그러나 실제 `.eslintrc.cjs`(L93~102 main override)의 차단 목록은 `node:http`/`http`/`node:https`/`https`/`net`/`node:net`/`dgram`/`node:dgram` **8개뿐**으로, **`node:tls`도 `ssh2`/`ssh2-sftp-client`/`basic-ftp`도 현재 차단 대상이 아니다.** traceability L49도 기존 가드를 "node:http/https/net/dgram"으로만 기록.
- **위치**: `docs/architecture/adr/ADR-007-...md` L46(결정②-2) · `docs/architecture/directory-structure.md` L153 · (실코드 대조원) `.eslintrc.cjs` L93~102.
- **문제**: "유지"라는 표현은 "이미 차단 중이니 그대로 둔다"는 의미인데, 실제로는 `node:tls`·원격 라이브러리를 **새로 추가 차단**해야 화이트리스트 모델이 성립한다(특히 `basic-ftp`의 FTPS는 `node:tls`를 쓰므로 `node:tls`를 `src/main/remote/`로 가두는 것이 결정②의 핵심). 현 표현대로 team-dev가 "유지"로 읽으면 `node:tls`·원격 라이브러리가 main 전 경로에서 import 가능한 상태가 방치돼 **결정②의 격리 목표가 무력화**될 수 있다. 보안 설계의 실효성과 직결되나, 의도(추가 차단)는 문맥상 명확하고 구현 시 바로잡을 수 있어 블로커는 아님.
- **권고**: ADR-007 결정②-2와 directory §5-M L153을 **"기존 차단 목록(`node:http`/`https`/`net`/`dgram`)을 유지하고, 여기에 `node:tls` 및 원격 라이브러리(`ssh2`·`ssh2-sftp-client`·`basic-ftp`)를 **신규 추가 차단**한 뒤, `overrides`로 `src/main/remote/**`에만 예외(allow)를 둔다"**로 명확히 정정한다("유지"→"기존 8개 유지 + tls·원격 라이브러리 신규 추가"). traceability §1-M 보안 추적 주석(L169)에도 "`.eslintrc.cjs`에 `node:tls`·원격 라이브러리 차단 신규 추가 + remote/ 예외"를 한 구절 부기 권장.

### [보통-2] chief-architect 미해결 질문 3건이 어느 문서에도 consolidated 목록으로 명시되지 않음 — 추적 누락
- **무엇**: 본 검증 의뢰가 명시한 "chief-architect가 남긴 미해결 질문 3건(safeStorage UI 노출·이어받기 범위·원격↔원격)"이 ADR-007 내에 **"(미해결 질문 참조)"라는 괄호 언급**(L73·L92·L158·L156)으로 산재할 뿐, ADR-007이나 system-architecture §8(미해결 질문) 어디에도 **번호 매겨진 consolidated 목록으로 정리돼 있지 않다.** system-architecture §8(L444~448)은 기존 3건(Worker 모델·Undo 영속·썸네일 디코딩)만 담고 §M 3건을 추가하지 않았다.
- **위치**: `docs/architecture/adr/ADR-007-...md`(미해결 질문 절 부재) · `docs/architecture/system-architecture.md` §8(L444~448, §M 3건 미반영).
- **문제**: 다른 설계 문서(SW §10, SA §8)는 미해결 질문을 명시 절로 두어 PM/사용자 결정을 추적하는데, §M의 결정 회피 항목만 본문 괄호에 흩어져 **PM이 "무엇을 결정해야 하는지" 한눈에 추적 불가**. 검증 체크리스트 7(미해결 질문 추적)·기존 문서 관행과 불일치. 차단은 아님(3건 모두 안전 deferral).
- **권고**: ADR-007 말미에 **"## 미해결 질문(후속 결정)"** 절을 신설해 ① safeStorage UI 노출 요건 시 napi-rs 전환, ② 이어받기(resume)·체크섬 범위, ③ 원격↔원격 전송, (④ 초대용량 동시 전송 시 원격 전용 UtilityProcess) 4건을 번호로 정리하고 "전부 1차 범위 밖·구현 비차단" 명시. 또는 system-architecture §8에 §M 3건을 추가 항목으로 등재. 본문 산재 괄호 언급은 이 목록을 가리키게 정리.

### [낮음-1] safeStorage `credentials.enc`·`known_hosts.json`·`profiles.json`의 무결성/변조 모델 미언급(참고)
- **무엇**: 결정③은 비밀을 `credentials.enc`에 DPAPI 암호화 보관하나, **암호문 파일·`known_hosts.json`(호스트키 지문)·`profiles.json`이 다른 프로세스/사용자에 의해 변조·교체될 때의 무결성**(예: 공격자가 known_hosts를 덮어써 MITM 키를 신뢰시키는 시나리오)은 다루지 않는다. DPAPI는 기밀성은 주나 무결성/인증은 보장하지 않는다.
- **위치**: ADR-007 결정③·결정⑥-4.
- **문제**: 단일 사용자·로컬 가정(PRD §9)하에선 위협 모델 밖에 가까워 1차 비차단이나, 보안 ADR의 완결성 관점에서 "userData 권한에 의존·무결성은 OS 파일 권한에 위임" 정도의 한 줄 가정 명시가 정직성을 높인다.
- **권고**: 결정⑥-4(TOFU) 또는 트레이드오프에 "known_hosts/credentials.enc 무결성은 userData 디렉토리 OS 파일 권한에 위임(단일 사용자 가정·PRD §9), 파일 변조는 위협 모델 밖" 한 구절 부기 권장. 선택.

### [낮음-2] `RemoteError` vs `FileOpError` 직렬화 일관성(참고)
- **무엇**: SA §5-M.1은 일부 채널은 `Result<..., FileOpError>`(cred/profile/disconnect), 전송·탐색은 `Result<..., RemoteError>`로 오류 타입이 갈린다. `RemoteError`를 "FileOpError 확장"(L339)이라 했으나, 렌더러 오류 처리(기존 FileOpError 소비 코드)가 확장 필드를 어떻게 다루는지(판별 키·하위호환)는 미명세.
- **위치**: SA §5-M.1 L339·채널 시그니처.
- **문제**: 구현 시 결정 가능한 세부라 비차단이나, `RemoteError`가 `FileOpError`의 `code` 유니온을 확장하는지/별도 `kind`로 판별하는지 한 줄 명시하면 team-dev 모호성 제거.
- **권고**: L339에 "`RemoteError extends FileOpError`로 `code` 유니온만 확장(기존 소비 코드는 unknown code를 일반 오류로 폴백)" 정도 명시 권장. 선택.

---

## 확인 필요 (PM → 사용자 판단)

1. **미해결 질문 3건의 deferral 승인**(safeStorage UI 노출·이어받기/resume 범위·원격↔원격 전송): 본 검증 결과 **3건 모두 기획 요구(D6·US-12.x) 범위 밖이며 1차 구현을 차단하지 않는다.** 설계는 안전하게 후속으로 미뤘다. PM이 "1차 범위에서 제외(후속)"를 사용자에게 확인만 받으면 그대로 진행 가능. (보통-2 정정으로 이 3건을 ADR 미해결 질문 절에 명시 등재 권고.)
2. **safeStorage UI 미노출 수용 여부**: D6 문언("DPAPI 계열")은 충족하나, 사용자가 "Windows 자격증명 관리자 UI에서 직접 항목 확인/삭제"를 기대한다면 napi-rs/keyring 전환이 필요하다. 설계는 이를 정직히 트레이드오프로 올렸다 — **사용자 기대치 확인 권장**(앱 내 프로필 삭제로 충분한지). 보안 결함은 아님.

---

## 결론
보안 ADR(검증의 핵심축)은 **건전하고 정직**하다 — 최소 표면·safeStorage 한계 명시·원격 불신 입력·ADR-005 부분 개정 양방향 참조가 모두 충족된다. 추적성·기술 근거·IPC 정합·디렉토리/추상화·비파괴 확장 전 항목 PASS. 블로커·높음 0. 발견된 **보통-1(ESLint "유지"→실제는 tls·원격 라이브러리 추가 필요·코드 불일치)·보통-2(미해결 질문 consolidated 목록 부재)** 2건은 구현 착수를 막지 않으나 보안 실효성·추적성 정직성 관점에서 **반영을 권고**한다. 정정은 chief-architect가 수행한다(본 검증자는 직접 수정하지 않음). **PASS — 위 2건 반영 시 완결성↑, 미반영해도 team-dev 착수 가능.**
