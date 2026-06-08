# ADR-007 — 원격 프로토콜(FTP/SFTP)·네트워크 경계·외부 셸 연계(D&D·CF_HDROP)

상태: 제안 · 2026-06-08
관련 기획: PRD §6(§M)·§7(보안 개정)·§11 결정 D6/D7 · features §M(M1/M2/M3) · user-stories 에픽12(US-12.1~12.5) · flows F14/F15/F16
관련 설계: [ADR-005 프로세스/보안 모델](./ADR-005-process-security-model.md)(본 ADR로 **부분 개정**) · [ADR-003 IPC 계약 스타일](./ADR-003-ipc-contract-style.md) · [system-architecture §M](../system-architecture.md) · [software-architecture §11](../software-architecture.md)

> **이 ADR이 다루는 것**: §M 3기능(M1 외부 D&D 복사·M2 클립보드 CF_HDROP 양방향·M3 FTP/SFTP 원격)이 기존 보안 모델(ADR-005)·네트워크 경계(결정 D5)·프로세스 배치를 어떻게 확장/개정하는가. **ADR-005를 삭제·대체하지 않고**, "로컬 전용·외부 네트워크 전송 없음" 원칙을 §M3에 한해 **명시적으로 부분 개정**하며, M1/M2의 외부 셸 연계 표면을 ADR-005 원칙(검증된 경로만·실행 표면 미추가) 안에서 정의한다.

---

## 맥락

ADR-005/결정 D5는 본 앱을 **"로컬 전용·외부 네트워크 전송 없음(텔레메트리 옵트인 제외)"** 으로 못 박았고, 이를 강제하기 위해 **`.eslintrc.cjs`에서 main의 `node:http`/`node:https`/`node:net`/`node:dgram` import를 `no-restricted-imports`로 정적 차단**한다(추적성 §1 텔레메트리 행). 또한 ADR-005는 FS/OS 접근을 Main에 가두고, 모든 외부로의 노출 표면(쉘 실행 등)을 "검증된 단일 경로만 OS에 위임, 명령행 조립 금지"로 제한한다.

§M 3기능은 이 경계를 서로 다른 방식으로 건드린다:

| 기능 | ADR-005와의 관계 | 핵심 쟁점 |
|---|---|---|
| **M1 외부 D&D 복사** (Should) | 경계 안 — 새 네트워크/실행 표면 없음 | `webContents.startDrag`는 **Main에서만 호출 가능**한 API. 외부로 나가는 페이로드는 "사용자가 선택한 검증된 로컬 파일 경로"뿐 |
| **M2 클립보드 CF_HDROP 양방향** (Should) | 경계 안 — 새 네트워크/실행 표면 없음 | 기존 `fileClipboard.ts`는 **텍스트 경로 폴백만** 지원(코드 주석에 "CF_HDROP 미지원·향후 네이티브 모듈" 명기). 실제 양방향 CF_HDROP·Preferred DropEffect는 OS 셸 클립보드 포맷 접근이 필요 |
| **M3 FTP/SFTP 원격** (Could) | **경계를 깸** — 네트워크 소켓·외부 호스트 전송·자격증명 보관 | D5 "외부 전송 없음"을 부분 개정(D7), ESLint 네트워크 차단을 **부분 해제**해야 함, 자격증명을 **평문 금지·OS 보관소만**(D6), 원격 응답을 **신뢰 못 하는 데이터**로 취급 |

따라서 본 ADR은 6개 결정을 다룬다: ① 네트워크 경계 재정의, ② ESLint 정적 가드 조정, ③ 자격증명 OS 보관소 메커니즘, ④ FTP/SFTP 클라이언트 라이브러리 선정, ⑤ 원격 작업 프로세스 배치, ⑥ 원격 신뢰 경계. M1/M2의 셸 연계는 ⑦에서 다룬다.

---

## 결정 ① — 네트워크 경계 재정의 (D5 부분 개정 = D7)

**기존(D5)**: "외부 네트워크 전송 없음(텔레메트리 옵트인 제외)."
**개정(D7)**: 다음으로 **정밀화**한다 — *"네트워크 연결·전송은 (a) 텔레메트리 옵트인, 또는 (b) **사용자가 명시적으로 입력/저장한 원격 호스트(FTP/FTPS/SFTP)** 로만 발생한다. 그 외 임의 외부 송신은 여전히 전무하다."*

- "로컬 전용"의 의미는 폐기되지 않고 **"사용자가 지시한 대상으로만 송신, 그 외 임의 송신 금지"** 로 좁혀진다.
- 원격 연결은 **텔레메트리와 무관**하다(원격 연결 ≠ 텔레메트리 전송). 텔레메트리 임의 송신 금지·기본 꺼짐 원칙은 불변.
- 연결 대상은 **런타임에 사용자 입력/저장 프로필에서만** 결정된다. 하드코딩된 외부 엔드포인트·자동 연결·백그라운드 동기화 없음.

> ADR-005 본문에는 "ADR-007로 §M3 네트워크 경계가 부분 개정됨" 상호참조 메모를 남긴다(은폐 금지·비파괴).

---

## 결정 ② — ESLint 네트워크 정적 가드 조정 (전면 해제 금지 · 화이트리스트식 최소 표면)

기존 `no-restricted-imports` 네트워크 차단을 **전면 해제하지 않는다.** 대신 **단일 격리 디렉토리에만** 네트워크/원격 모듈을 허용하는 화이트리스트식으로 좁힌다.

**규칙**:
1. 원격 네트워크 코드(소켓·TLS·SFTP/FTP 라이브러리 import)는 **`src/main/remote/` 디렉토리 안에서만** 허용한다.
2. `.eslintrc.cjs`의 main `no-restricted-imports`를 다음과 같이 조정한다(현재 코드 상태 기준의 **추가 작업**임에 유의):
   - **(2-a) 기존 차단 유지**: 현재 main override가 이미 차단 중인 **8개**(`node:http`/`http`·`node:https`/`https`·`net`/`node:net`·`dgram`/`node:dgram`)는 **그대로 유지**한다(D5·ADR-005 §3.3-6 텔레메트리/네트워크 송신 회귀 가드).
   - **(2-b) 신규 차단 추가**: 현재 `.eslintrc.cjs`는 **`node:tls`도, 원격 클라이언트 라이브러리도 차단하지 않는다.** 따라서 본 결정의 격리 모델 성립을 위해 **`node:tls` 및 원격 라이브러리(`ssh2`·`ssh2-sftp-client`·`basic-ftp`)를 main `no-restricted-imports`에 신규 차단 대상으로 추가**해야 한다. (특히 `basic-ftp`의 FTPS는 내부적으로 `node:tls`를 사용하므로 `node:tls` 차단이 화이트리스트 모델의 핵심이다.) 즉 이 항목은 "이미 차단 중이라 그대로 둔다"가 아니라 **구현 시 `.eslintrc.cjs`에 차단 항목을 추가하는 작업**이다.
   - **(2-c) remote/ 예외**: 위 (2-a)+(2-b) 전체 차단에 대해 `overrides`로 **`src/main/remote/**`에만 예외(allow)**를 둔다. 그 외 main 전 경로(`fs/`·`ipc/`·`os/`·`operations/`·`persistence/`·`workers/`)는 네트워크/TLS/원격 라이브러리 import **전면 금지**.
3. `src/main/remote/` 외 모듈은 원격 기능을 쓰려면 **`RemoteService` 인터페이스**(같은 디렉토리에서 export)를 통해서만 호출한다 → 네트워크 표면이 한 모듈 경계 뒤로 캡슐화된다.
4. **렌더러·도메인·shared는 네트워크 import 전면 금지 불변**(ADR-005). 원격 작업은 IPC(`remote:*`)로만 트리거.

> **구현 시 `.eslintrc.cjs` main override `no-restricted-imports`에 신규 추가할 차단 목록**(기존 8개에 더하여): `node:tls`, `ssh2`, `ssh2-sftp-client`, `basic-ftp`. 그리고 전체 차단을 `overrides`의 `src/main/remote/**` 블록에서만 해제(allow).

> 효과: D5 정신(임의 네트워크 표면 차단)을 구조로 유지하면서, 네트워크가 닿는 코드를 **감사 가능한 단일 디렉토리**로 가둔다. 리뷰어는 `src/main/remote/` 한 곳만 보면 앱의 전체 외부 통신 표면을 검증할 수 있다.

---

## 결정 ③ — 자격증명 저장: OS 자격증명 보관소만 (평문 금지 · D6)

**비밀(FTP 비밀번호·SSH 개인키 패스프레이즈·필요 시 개인키 본문)은 Windows 자격증명 보관소(Credential Manager / DPAPI 계열)에만 저장한다.** 설정/세션/로그/오류 메시지에 평문 저장·노출을 절대 금지한다(필수 수용 기준 US-12.3·D6).

### 메커니즘 선택지 비교

| 옵션 | 메커니즘 | 장점 | 단점 | 판정 |
|---|---|---|---|---|
| **`keytar`** | libsecret/Win Credential Manager 네이티브 바인딩 | 사실상 표준·간단 API | **2023 아카이브(유지보수 중단)**·네이티브 빌드·prebuild 의존 | 보류(유지보수 리스크) |
| **Electron `safeStorage` + 자체 저장**(채택) | OS 키(DPAPI on Windows)로 암호화한 바이트를 앱이 보관 | **Electron 내장**(신규 네이티브 의존 0)·DPAPI 백엔드·번들 영향 0 | "보관소 항목"이 아니라 "DPAPI로 암호화된 파일"이라 Credential Manager UI에 안 보임 | **채택**(주 메커니즘) |
| `@napi-rs/keyring` 등 신규 바인딩 | Rust napi Credential Manager 바인딩 | 활성 유지보수 | 네이티브 prebuild·번들/서명 영향·플랫폼 매트릭스 | 보류(필요 시 후속) |

### 결정
- **1차: Electron `safeStorage`**(`safeStorage.encryptString`/`decryptString`, Windows에서 DPAPI 사용)로 비밀을 암호화하고, 암호문 바이트만 `app.getPath('userData')/remote/credentials.enc`에 **원자적 쓰기**로 보관한다. DPAPI는 현재 사용자 계정에 종속 → 평문 저장 아님(D6 충족: "Windows Credential Manager/DPAPI 계열").
- **평문 경계**: 복호화된 비밀은 **연결 수립 시점에만** 메모리에 존재하고, 연결 객체 외로 복제하지 않으며, 세션 종료/연결 해제 시 폐기한다. 로그·오류 객체·IPC 응답 DTO에 비밀 필드를 **절대 싣지 않는다**(아래 결정 ⑥·신뢰 경계와 함께 강제).
- **저장 게이트**: 사용자가 "저장" 선택 시에만 암호화 저장. 미저장 시 메모리에서만 사용 후 폐기(US-12.3).
- **프로필 메타(비밀 제외: 이름·호스트·포트·사용자명·프로토콜)** 는 일반 설정처럼 `remote/profiles.json`에 평문 저장(비밀 아님). 프로필↔비밀은 키(`credential key = remote:<profileId>`)로 연결.
- `safeStorage.isEncryptionAvailable()`가 false면(드문 환경) **저장 비활성·메모리 전용 모드**로 폴백하고 사용자에게 안내(평문 저장으로 폴백하지 않음).

> `keytar`를 1차로 쓰지 않는 이유: 아카이브(유지보수 중단)된 라이브러리에 보안 핵심을 의존하는 것은 부적절. `safeStorage`는 Electron 내장·DPAPI 기반이라 **신규 네이티브 의존·번들/서명 영향 0**이면서 D6의 "DPAPI 계열" 요건을 충족한다. Credential Manager UI 노출이 요건이면 후속으로 `@napi-rs/keyring` 검토(미해결 질문 참조).

---

## 결정 ④ — FTP/SFTP 클라이언트 라이브러리 선정

### 후보 비교

| 라이브러리 | 프로토콜 | 라이선스 | 유지보수 | 네이티브 빌드 | 번들 영향 | 비고 |
|---|---|---|---|---|---|---|
| **ssh2** | SFTP(SSH) | MIT | 활발 | **선택적**(순수 JS 폴백 내장·`cpu-features`/`*-crypto` optional) | 중 | 사실상 Node SFTP 표준. 호스트 키 검증·키 인증 1급 |
| **ssh2-sftp-client** | SFTP | Apache-2.0 | 활발 | ssh2 래핑(동일) | 중 | ssh2 위 Promise 기반 고수준 API(list/get/put/rename) |
| **basic-ftp** | FTP·FTPS | MIT | 활발 | **없음(순수 JS)** | 소 | FTP/FTPS 표준. TLS는 Node `tls` 내장 |
| jsftp | FTP | MIT | 정체 | 없음 | 소 | 유지보수 느림 → 제외 |
| node-sftp 등 구형 | SFTP | 다양 | 비활성 | — | — | 제외 |

### 결정
- **SFTP(SSH): `ssh2-sftp-client`**(내부적으로 `ssh2`) 채택. 근거: SFTP는 사실상 `ssh2`가 표준이고, `ssh2-sftp-client`가 list/get/put/mkdir/rename/delete를 Promise로 깔끔히 제공해 `RemoteService` 구현 비용이 낮다. **호스트 키 검증(`hostVerifier`)·개인키/패스프레이즈 인증이 1급**이라 보안 수용 기준(호스트 키 경고·SSH 키 인증)을 직접 충족한다.
- **FTP/FTPS: `basic-ftp`** 채택. 근거: **순수 JS(네이티브 빌드 0)**, FTPS(명시적/암묵적 TLS)를 Node 내장 `tls`로 지원, 활발한 유지보수.
- **네이티브 빌드 정책**: `ssh2`의 `cpu-features`·`*-crypto` 가속 모듈은 **optional**이므로 설치 실패해도 순수 JS 경로로 동작한다. electron-builder 네이티브 리빌드(`@electron/rebuild`)는 가속 모듈이 빌드될 때만 필요 → **기본은 순수 JS 모드로 번들**해 코드서명/패키징 영향을 최소화한다. 성능 가속이 필요하면 후속 결정(미해결 질문).
- 두 라이브러리 모두 `src/main/remote/`에만 import(결정 ②). 외부에는 단일 `RemoteService` 인터페이스만 노출.

> 트레이드오프: SFTP/FTP에 라이브러리 2개를 둔다(통합 단일 라이브러리는 없음). 대신 각 프로토콜에서 가장 성숙·표준인 것을 써 신뢰성과 보안 기능(호스트 키·FTPS TLS)을 확보한다. `RemoteService` 어댑터가 프로토콜 차이를 흡수해 상위 계층은 단일 인터페이스만 본다.

---

## 결정 ⑤ — 원격 작업 프로세스 배치 (기존 Worker Threads 모델과 정합)

**원격 세션·전송은 Main 프로세스의 `RemoteService`(Main 스레드)에서 수행한다.** 대용량 로컬 복사처럼 Worker Threads로 내리지 않는다.

| 옵션 | 장점 | 단점 | 판정 |
|---|---|---|---|
| **Main 스레드(채택)** | ① 자격증명·소켓이 **단일 신뢰 경계**(Main)에 머물러 Worker로 비밀 전달 불필요 → 공격면 최소. ② 원격 전송은 **네트워크 I/O 바운드**(CPU 비차단)라 이벤트루프 점유가 작다. ③ ssh2/basic-ftp는 비동기 스트림 API → Main 이벤트루프를 막지 않음 | 매우 큰 전송 시 Main에서 스트림 파이프 관리 | **채택** |
| Worker Threads | CPU 격리 | 소켓·자격증명을 Worker로 넘겨야 함(비밀 표면 확대)·세션 객체 이전 불가 | 비채택 |

- **정합 근거(ADR-005 §(d))**: Worker Threads는 **로컬 fs I/O 바운드 + CPU 작업(대용량 복사)** 용으로 선택됐다. 원격은 **네트워크 I/O 바운드**이고 핵심 리스크가 "비밀 표면"이므로, ADR-005가 "Electron API/네이티브 의존 작업은 Main 스레드"라 한 원칙(휴지통·속성창과 동일)을 따른다 → **원격도 Main 스레드**.
- **진행률·취소·세션 관리**: 기존 `OperationManager`(200ms 스로틀·`AbortController`·operationId)를 **재사용**한다. 원격 업/다운로드는 `op:start(kind: 'remote-download' | 'remote-upload')` 또는 전용 `remote:download/upload` 채널이 `RemoteSessionManager`를 통해 진행률을 같은 `op:progress` 스트림으로 푸시한다(아래 결정 ⑦·system-architecture §M). 취소는 `AbortSignal`→스트림 destroy.
- **세션 격리**: 각 원격 연결은 `RemoteSessionManager`가 `sessionId`로 관리한다. 한 세션의 끊김/타임아웃/오류는 **해당 세션(패널)만** 오류 상태로 만들고 다른 세션·로컬 탐색·Main을 중단시키지 않는다(throw 0 격리·F장 준용·US-12.5).

---

## 결정 ⑥ — 원격 신뢰 경계 (원격 응답 = 신뢰 못 하는 데이터)

원격 서버 응답(디렉토리 목록·경로·파일명·심볼릭링크 타깃)은 **악의적일 수 있는 외부 입력**으로 취급한다. 로컬 FS 입력보다 강한 검증을 적용한다.

1. **경로 traversal 방어**: 원격 경로는 항상 **서버가 보고한 절대 경로 기준으로 정규화**하고, 다운로드 시 **로컬 도착지 경로가 사용자가 지정한 도착 디렉토리 하위를 벗어나지 않음**을 검증한다(`..`·심볼릭링크를 이용한 도착지 탈출 차단 — "Zip Slip" 류). 도착지 밖이면 거부.
2. **심볼릭링크**: 원격 심볼릭링크는 **표시만 하고 자동 추종하지 않는다**. 재귀 다운로드 시 링크 순환을 차단(방문 경로 Set·로컬 스캔과 동일 원칙).
3. **파일명 새니타이즈**: 원격 파일명에 로컬 금지문자(`< > : " / \ | ? *`)·예약명·경로 구분자가 포함되면 다운로드 시 안전하게 치환/거부한다(로컬 FS 손상 방지).
4. **호스트 키 검증(SFTP)**: `hostVerifier`로 호스트 키 지문을 확인한다. **TOFU(Trust On First Use)** — 처음 보는 키는 사용자에게 지문을 보여 확인받고 `remote/known_hosts.json`(비밀 아님·지문만)에 저장한다. **저장된 키와 다르면(MITM 의심) 경고·차단** 후 사용자 명시 확인 시에만 갱신(US-12.3·flows F16). **무결성 가정**: `known_hosts.json`·`credentials.enc`·`profiles.json` 저장물의 무결성(변조·교체 방지)은 `userData` 디렉토리 OS 파일 권한에 위임한다 — DPAPI는 기밀성만 보장하므로, 단일 사용자·로컬 가정(PRD §9)하에 파일 변조(예: known_hosts 덮어쓰기 MITM)는 위협 모델 밖으로 둔다.
5. **전송 보안 표시**: SFTP/FTPS는 암호화. **평문 FTP는 연결·전송 전 비암호화 경고**를 UI에 표시한다(features §M3 보안표).
6. **비밀 비노출**: `RemoteService`의 어떤 응답 DTO·로그·`FileOpError` 메시지에도 비밀번호/키/패스프레이즈를 **싣지 않는다**(결정 ③과 함께 강제). 오류는 코드+안전 메시지(예: `EAUTH`)로만 전파.
7. **부분 전송 안전**(US-12.5·리뷰 보통-2): 다운로드/업로드 중 끊김 시 도착지의 불완전 파일이 완료본으로 오인되지 않도록 **임시명(`.part` 등)으로 받은 뒤 완료 시 원자적 rename**한다. 이어받기(resume)·체크섬 검증은 후속 설계(deferral, 차단 아님).

---

## 결정 ⑦ — M1/M2 외부 셸 연계 (ADR-005 원칙 안의 표면 정의)

M1/M2는 네트워크가 아니라 **OS 셸과의 로컬 상호운용**이다. ADR-005 "검증된 경로만·실행 표면 미추가" 원칙 안에서 정의한다.

- **M1 외부 D&D (`webContents.startDrag`)**: 드래그 시작은 **Main에서만** 호출 가능한 Electron API다. 렌더러가 외부 드래그 의도를 감지하면 `dnd:start-drag` 채널로 Main에 위임한다. Main은 ① 경로를 **§3.3 보안 규칙대로 정규화·존재·권한 확인**, ② 검증 통과한 **로컬 파일 경로 목록만** `startDrag({ files, icon })`에 전달한다. 외부로 나가는 것은 사용자가 선택한 실제 파일 경로뿐 — **임의 데이터·실행 표면 미추가**(ADR-005 불변). 원격(M3) 항목은 외부 드래그 대상 아님(로컬 경로만).
- **M2 CF_HDROP 양방향**: 기존 `fileClipboard.ts`(텍스트 폴백)를 **셸 클립보드 어댑터로 확장**한다. CF_HDROP 쓰기/읽기·Preferred DropEffect는 OS 클립보드 포맷 접근이 필요하다.
  - **메커니즘 선택**: Electron `clipboard.writeBuffer/readBuffer('CF_HDROP')` + `'Preferred DropEffect'` 포맷에 **DROPFILES 구조체 바이트를 직접 조립/파싱**(Windows 표준 레이아웃). 네이티브 모듈 없이 Electron clipboard buffer API로 구현 가능 → **신규 네이티브 의존 0**. 바이트 레이아웃 조립은 `src/main/os/shellClipboard.ts`에 격리하고, 잘못된 입력에 대한 방어적 파싱(길이·널종단·UTF-16 검증)을 강제한다.
  - **외부 입력 검증**: 외부에서 읽은 CF_HDROP 경로는 **신뢰 못 하는 입력**으로 취급 → 정규화·존재 확인 후에만 사용(ADR-005). 파일 포맷이 없으면(텍스트·이미지) 파일 붙여넣기 안 함.
  - **내부 클립보드와의 우선순위**(아래 §통합 규칙).

### M2 내부/외부 클립보드 통합·우선순위 규칙
앱은 단일 "복사/잘라내기 의도"를 가진다. M2는 이를 **시스템 클립보드(CF_HDROP)를 단일 출처로** 승격한다:
1. **앱 복사/잘라내기(`Ctrl+C/X`)**: 시스템 클립보드에 **CF_HDROP(+잘라내기면 Preferred DropEffect=Move)** 를 쓴다. 기존 텍스트 경로 폴백도 병기(외부 텍스트 수신 앱 호환). → 내부 상태(`ClipboardOp`)는 "마지막 쓰기 시점·잘라내기 흐림 표시"용으로만 유지.
2. **앱 붙여넣기(`Ctrl+V`)**: **시스템 클립보드를 우선** 읽는다. CF_HDROP가 있으면 그 경로·DropEffect로 작업한다(외부에서 복사한 파일도 자연히 처리). CF_HDROP가 없으면 붙여넣기 무시·안내.
3. **잘라내기 흐림 표시**: 앱에서 `Ctrl+X` 한 항목은 흐리게 표시하되, **외부 앱이 클립보드를 덮어쓰면** 흐림을 해제(클립보드 변화 감지). 즉 "잘라내기 상태"의 권위는 시스템 클립보드.
4. B4(앱 내부 복사/붙여넣기) **동작 자체는 불변** — 단일 출처가 내부 상태에서 시스템 클립보드로 바뀔 뿐, 사용자 체감 동작은 동일하고 **외부 연계가 추가**된다.

---

## 근거 (종합)

- **D5 정신 보존**: 네트워크 표면을 전면 개방하지 않고, "사용자가 지시한 호스트로만"으로 좁히며(결정 ①), 그 코드를 단일 디렉토리로 가두고 ESLint로 강제(결정 ②) → 정직한 부분 개정.
- **신규 네이티브 의존 최소화**: 자격증명(safeStorage)·CF_HDROP(clipboard buffer)·외부 드래그(startDrag) 모두 **Electron 내장**으로 처리 → 번들·코드서명·플랫폼 매트릭스 영향 0. 원격 라이브러리만 추가(ssh2-sftp-client·basic-ftp)하되 순수 JS 모드 우선.
- **기존 모델과 정합**: IPC는 ADR-003 단일출처 규약 그대로, 진행률·취소는 OperationManager 재사용, 프로세스 배치는 ADR-005 "Electron/네트워크 의존 = Main 스레드" 원칙 그대로.
- **신뢰 경계 강화**: 원격 응답을 외부 입력으로 취급(traversal·심볼릭·호스트 키)해 ADR-005의 방어 심층을 네트워크까지 연장.

## 트레이드오프

- **safeStorage vs Credential Manager UI**: safeStorage는 DPAPI 암호문을 앱이 보관하므로 Windows 자격증명 관리자 UI에 항목이 보이지 않는다(사용자가 OS UI에서 직접 삭제 불가, 앱 내 "프로필 삭제"로만). D6 요건("DPAPI 계열 보관·평문 금지")은 충족. UI 노출이 필요하면 후속 `@napi-rs/keyring`.
- **라이브러리 2개(ssh2/basic-ftp)**: 통합 단일 의존 대비 표면이 둘이나, 각 프로토콜 표준을 써 보안 기능을 확보. `RemoteService` 어댑터로 상위 추상화는 단일 유지.
- **원격을 Main 스레드에서**: 초대용량 동시 전송이 많아지면 Main 이벤트루프 부담 가능. 1차는 I/O 바운드라 충분, 필요 시 후속으로 원격 전용 UtilityProcess 검토(미해결 질문).
- **ESLint 예외 디렉토리**: `src/main/remote/`가 네트워크 import 특권을 갖는다 → 이 디렉토리의 코드리뷰·감사 비중을 높여 상쇄.

## 결과

- ADR-005는 **유효하되**, "네트워크 차단 기본·로컬 전용"이 **§M3에 한해 ADR-007 결정 ①②로 부분 개정**됨(ADR-005에 상호참조 메모 추가).
- 신규 디렉토리 `src/main/remote/`(네트워크 특권·ESLint 예외)·`src/main/os/shellClipboard.ts`·`src/main/os/dragdrop.ts`·`src/main/os/credentials.ts` 생성(directory-structure 비파괴 추가).
- 신규 IPC 채널군 `dnd:*`·`clipboard:*` 확장·`remote:*`(system-architecture §M·결정 ⑦).
- 신규 npm 의존성: `ssh2-sftp-client`(Apache-2.0)·`basic-ftp`(MIT). 자격증명·드래그·클립보드는 신규 의존성 0(Electron 내장).
- ADR-000-index에 ADR-007 등록.

---

## 미해결 질문 (설계 deferral)

본문에 산재한 결정 회피(deferral) 항목을 한곳에 정리한다. **아래 3건(+참고 1건)은 모두 1차 범위에서 후속으로 미뤘으며, 검증 결과(architecture-review-M) 전부 안전 deferral·구현 착수를 차단하지 않는다.** PM이 사용자에게 "1차 범위 제외(후속)"를 확인받으면 그대로 진행 가능하다.

| # | 미해결 질문 | ① 1차 결정(deferral) | ② 후속 트리거(재검토 시점) | ③ 구현 비차단 여부 |
|---|---|---|---|---|
| **UQ-M1** | safeStorage가 Windows 자격증명 관리자 UI에 항목을 노출하지 않음(사용자 OS UI 직접 삭제 불가, 앱 내 "프로필 삭제"로만) — 결정③·트레이드오프 | 1차는 **Electron `safeStorage`(DPAPI) 확정**. D6 문언("DPAPI 계열·평문 금지")은 충족하므로 UI 노출 없이 진행 | 사용자가 "Windows 자격증명 관리자 UI에서 직접 항목 확인/삭제"를 명시 요건으로 요구할 때 → `@napi-rs/keyring` 등 네이티브 바인딩 전환 검토(번들·서명·플랫폼 매트릭스 재평가 동반) | **비차단** — D6은 UI 노출을 요구하지 않음. 앱 내 프로필 삭제로 1차 기능 완결 |
| **UQ-M2** | 전송 이어받기(resume)·체크섬 검증 범위 — 결정⑥-7 | 1차는 **`.part` 임시명 + 완료 시 원자 rename**으로 "부분 파일 완료본 오인 방지"(US-12.5 필수)만 충족. resume/체크섬은 미구현 | 끊긴 대용량 전송 재개·무결성 검증 수요가 확인될 때 → 서버 측 부분 전송(REST/APPE·SFTP offset) 지원 매트릭스 + 체크섬 정책 설계 | **비차단** — US-12.5 필수("부분 파일 오인 방지")는 1차에 직접 충족됨. resume은 편의 기능 |
| **UQ-M3** | 원격↔원격(서로 다른 원격 호스트) 직접 전송 — software-architecture §11.1 전송 라우팅 | 1차는 **원격↔로컬만**(다운로드/업로드). 원격↔원격은 라우팅에서 "1차 범위 밖" 명시 | 원격↔원격 직접 전송 수요 확인 시 → 로컬 경유 스트림 중계 vs 서버 간 직접(FXP 등) 방식 비교 설계 | **비차단** — 기획 US-12.4/12.5는 원격↔로컬만 요구 |
| (참고) **UQ-M4** | 초대용량 동시 전송 시 원격 전용 프로세스 격리 — 결정⑤·트레이드오프 | 1차는 **Main 스레드**(네트워크 I/O 바운드·비밀 단일 경계). 충분 | 동시 대용량 전송으로 Main 이벤트루프 부담이 측정될 때 → 원격 전용 UtilityProcess 분리 검토(비밀 경계 재설계 동반) | **비차단** — 1차 I/O 바운드 부하에선 Main 스레드로 충분 |

> 본문 내 "(미해결 질문 참조)" 괄호 언급(결정③·결정④·결정⑥-7·트레이드오프)은 위 UQ-M1~M4 목록을 가리킨다. system-architecture §8(기존 미해결 질문 3건: Worker 모델·Undo 영속·썸네일 디코딩)과 별개로, §M 결정 회피는 본 절을 단일 출처로 삼는다.
