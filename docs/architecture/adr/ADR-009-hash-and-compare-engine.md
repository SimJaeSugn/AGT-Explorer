# ADR-009 — 공용 해시·비교 엔진 (폴더 비교·중복 찾기·체크섬 검증 공유)

상태: 제안 · 2026-06-09
관련 기획: PRD §P(P1)·§R(R2·R4)·§6 MoSCoW · features §P1·§R2·§R4 · user-stories 에픽15(US-15.1)·에픽17(US-17.2·US-17.4) · flows F20~F33
관련 설계: [ADR-005 프로세스/보안 모델](./ADR-005-process-security-model.md)(Worker 모델 준수) · [ADR-003 IPC 계약 스타일](./ADR-003-ipc-contract-style.md) · `scanEngine.ts`/`ScanManager.ts`(I장 워커·취소·진행률 선례) · [system-architecture §5-P](../system-architecture.md) · [software-architecture §13](../software-architecture.md)

> **이 ADR이 다루는 것**: §P1 폴더 비교의 해시(내용) 비교 옵션·§R2 중복 파일 찾기·§R4 복사 시 체크섬 검증이 **모두 "파일 내용을 해시해 동일성을 판정"** 하는 공통 요구를 가진다. 이를 **단일 공용 해시 엔진**으로 모듈화하고, 알고리즘·Worker 오프로딩·취소·대용량 스트리밍·메타 비교 우선 전략을 결정한다. 마일스톤 **M6(P1 메타 비교)** → **M7(해시 엔진 도입·P1 해시 옵션·R2·R4)**.

---

## 맥락

세 기능이 해시를 공유한다:

| 기능 | 해시 용도 | 1차 우선순위 | 마일스톤 |
|---|---|---|---|
| **P1 폴더 비교·동기화** | "같은 이름·같은 크기" 항목의 **내용 동일 여부**(옵션·기본 off) | Should(상위) | 비교 기본=메타(M6) / 해시 옵션=M7 |
| **R2 중복 파일 찾기** | 크기 그룹핑 후 **같은 크기끼리 해시**로 중복 그룹 확정 | Should | M7 |
| **R4 복사 시 체크섬 검증** | 복사 후 **원본·사본 해시 비교**로 무결성 검증(옵션·기본 off) | Could | M7(단계 내 후순위) |

공통 제약(features 각 챕터·PRD §7): 해시·대용량 비교는 **워커/별도 처리(UI 비차단·진행률·취소)**, 메인 스레드 차단 금지, 경로 검증·순환 링크 차단(F장), throw0/Result, IPC guard(ADR-005). 외부 네트워크 전송 없음.

세 기능이 각자 해시를 구현하면 중복·드리프트·취소/진행률 불일치가 생긴다. **공용 엔진으로 모듈화**가 자연스럽다.

핵심 결정: ① 해시 알고리즘, ② 실행 모델(Worker Threads), ③ 대용량 스트리밍·취소, ④ "불필요한 전체 해시 회피"(메타/크기 선필터) 전략, ⑤ 공용 모듈 경계와 진행률 채널.

---

## 결정 ① — 해시 알고리즘: 1차 해시는 Node 내장 SHA-256(신규 의존성 0), 고속화(BLAKE3/xxHash)는 실측 후 조건부 도입

**용도가 "내용 동일성 판정"(보안 서명 아님)** 이므로 충돌 저항보다 **속도**가 중요하다.

| 후보 | 속도 | 충돌(동일성 판정 적합) | 의존/네이티브 | 판정 |
|---|---|---|---|---|
| **Node 내장 `crypto` SHA-256** | 중(OpenSSL 가속) | 매우 강(충분) | **내장(의존 0)** | **1차 기본값(안전 폴백)** |
| **xxhash(`xxhash-addon`/wasm)** | 매우 빠름 | 비암호·동일성 판정엔 충분(충돌 확률 무시 가능, 크기 선필터로 추가 보강) | wasm은 의존 1·네이티브 0 / addon은 네이티브 빌드 | 후속 고속화 옵션 |
| **BLAKE3(wasm)** | 매우 빠름·병렬 | 강 | wasm 의존 1 | 후속 고속화 옵션 |
| MD5 | 빠름 | 충돌 알려짐(동일성엔 가능하나 권장 안 함) | 내장 | 비권장 |

### 결정
- **1차 기본: Node 내장 `crypto.createHash('sha256')`**(의존 0·네이티브 빌드 0·검증된 정확성). 동일성 판정에 충분하고 OpenSSL 가속으로 실용 속도 확보.
- **알고리즘을 엔진 파라미터로 추상화**: `hashFile(path, { algo })` 형태로 두어, 실측 후 대용량 성능이 부족하면 **xxHash/BLAKE3 wasm**(네이티브 빌드 0)을 옵션으로 추가할 수 있게 한다(인터페이스 고정·구현 교체).
- **충돌 위험 완화**: R2/P1은 **크기 선필터 후 해시**이므로 "같은 크기 + 같은 해시"만 동일로 본다(충돌 확률 추가 하락). 절대 무결성이 필요한 R4 체크섬도 SHA-256이면 충분.

> 1차에 외부 해시 라이브러리를 두지 않는 이유: 내장 SHA-256로 정확성·의존 0을 확보하고, **고속화는 측정 후 조건부 도입**(과설계 회피·번들/네이티브 빌드 영향 0 유지).

---

## 결정 ② — 실행 모델: Worker Threads + 환경 비의존 순수 엔진 (scanEngine 패턴 차용)

해시(CPU)+파일 읽기(I/O)는 **로컬 fs I/O 바운드 + CPU**라 ADR-005 §(d)·`scanEngine` 선례대로 **Worker Threads**에 오프로딩한다(원격을 Main 스레드에 둔 §M3와 대조 — 그건 네트워크 I/O·비밀 표면 때문).

- **환경 비의존 엔진**: `scanEngine.ts`가 채택한 패턴(진행/취소를 콜백 훅으로 받아 Worker·검증 스크립트 양쪽에서 동일 실행)을 그대로 적용한다. `compareEngine`/`dupEngine`은 `HashHooks { onProgress, shouldCancel }`만 의존하는 순수 함수형 코어로 두고, Worker가 실제 fs와 결합한다 → **헤드리스 verify 가능**(scanEngine/`verify:scan` 선례).
- **취소**: `scanEngine`·OperationManager가 쓰는 **SharedArrayBuffer 취소 플래그**(또는 협조적 `shouldCancel()` 폴링)를 재사용한다. 파일/디렉토리 경계·해시 청크 경계에서 즉시 중단·부분 결과 반환.
- **진행률**: 200ms 스로틀(scanEngine/OperationManager 선례)로 누적 항목/바이트·현재 경로 푸시.
- **순환·권한**: `scanEngine`의 F장 원칙 재사용 — 심볼릭/정션 미추종·realpath 방문 Set로 ELOOP 격리·readdir/lstat 실패는 throw 금지(skipped++ 후 계속).

---

## 결정 ③ — 대용량 스트리밍 해시 + "불필요한 전체 해시 회피" 2단계

- **스트리밍 해시**: 파일을 청크(예: 64KB~수MB) 단위 read stream으로 흘려 `hash.update()` → 전체를 메모리에 올리지 않는다(대용량 안전). 청크 경계마다 취소 확인·진행 바이트 보고.
- **메타/크기 선필터(핵심 비용 통제)**:
  - **R2**: 1차 **크기로 그룹핑** → 같은 크기 그룹이 2개 이상일 때만 그 그룹을 해시(유일 크기는 해시 0). 그룹 내에서도 **부분 해시(앞 N바이트) → 전체 해시** 2단계로 조기 분기 가능(후속 최적화·1차는 전체 해시로 단순).
  - **P1**: 비교 기본은 **이름+크기+수정일 메타만**(M6·해시 0). 해시 옵션 켤 때만 **같은 이름·같은 크기 항목**에 한해 해시 계산(features §P1) → "같은 크기 아님 = 다름"으로 해시 회피.
  - **R4**: 복사 직후 원본·사본 각각 1회 스트리밍 해시 비교(선필터 불요·대상 명확).
- **메타 비교 우선 원칙(마일스톤 정합)**: **M6에서 P1을 메타 비교만으로 먼저 출시**하고, **M7에서 해시 엔진을 깔면 P1 해시 옵션·R2·R4를 한꺼번에 연결**한다(공용 엔진이 M7 선행 인프라). 이는 PRD §12 M6/M7 묶음 근거와 일치.

---

## 결정 ④ — 공용 모듈 경계 & 진행률 채널 (`hash:*`)

세 기능이 공유하는 해시·비교 코어를 단일 디렉토리로 모듈화하고, 진행률은 scanEngine 패턴의 신규 스트림 채널로 둔다.

- **Main 모듈 `src/main/hash/`**:
  - `hashEngine.ts` — 환경 비의존 스트리밍 해시 코어(`hashFile`·`hashStream`·algo 파라미터·HashHooks).
  - `compareEngine.ts` — P1 폴더 비교(메타 4상태 분류 + 해시 옵션). 순수 코어 + Worker 결합.
  - `dupEngine.ts` — R2 크기 그룹핑 → 해시 그룹 확정.
  - `HashManager.ts` — `ScanManager` 형태의 오케스트레이터(jobId 발급·Worker 수명·취소 플래그·200ms 스로틀·세션 격리).
  - 워커는 `src/main/workers/`에 두되 위 엔진을 import(scanWorker 선례).
- **신규 IPC 채널 `hash:*`**(요청-응답 + 푸시 스트림, scanEngine/`analyze:scan:*`와 동형):
```text
hash:compare:start(req: { leftDir; rightDir; useHash: boolean; recursive: boolean })
  -> Result<{ jobId }, FileOpError>          # P1 폴더 비교 시작
hash:compare:progress(evt: { jobId; scannedItems; scannedBytes; currentPath })   # 푸시·200ms
hash:compare:done(evt: { jobId; result: CompareResultDTO })                       # 4상태 분류·짝지음
hash:dup:start(req: { roots: string[]; minSize?: number })
  -> Result<{ jobId }, FileOpError>          # R2 중복 탐지(크기→해시 2단계)
hash:dup:progress(evt) / hash:dup:done(evt: { jobId; groups: DupGroupDTO[] })
hash:verify:start(req: { pairs: { src; dst }[]; algo? })
  -> Result<{ jobId }, FileOpError>          # R4 체크섬(원본·사본 쌍 비교)
hash:verify:progress(evt) / hash:verify:done(evt: { jobId; mismatches: string[] })
hash:cancel(req: { jobId }) -> Result<void, FileOpError>
```
- **R4의 OperationManager 연계**: R4는 "복사 후" 검증이므로, 복사 자체는 기존 `op:*`(또는 R3 전송 큐)로 수행하고 R4 검증 단계는 `hash:verify:*`로 진행률을 흘리되, **복사+검증을 한 작업으로 묶을지(진행률에 검증 단계 포함)** 는 R3 전송 큐(ADR-011)와 통합해 설계한다(features §R4 "검증 단계가 진행률에 포함"). 1차는 복사 완료 후 별도 검증 잡으로 두고 결과를 작업 요약에 합산.
- ADR-003 단일출처 규약(channels.ts 상수·contracts.ts 타입·Result·sender·zod·경로 화이트리스트)으로 추가. 동결 예외는 `analyze:scan:*`·`remote:*` 선례와 동일.

---

## 근거 (종합)

- **DRY·일관성**: P1/R2/R4가 해시·취소·진행률·순환차단을 단일 엔진에서 공유 → 동작 일관·중복 0·드리프트 방지.
- **기존 선례 정합**: scanEngine(환경 비의존·콜백 훅·헤드리스 verify)·ScanManager(jobId·취소·200ms)·OperationManager(SharedArrayBuffer 취소)를 그대로 차용 → 신규 패턴 학습 비용 0.
- **의존 0·네이티브 0**: 1차 Node 내장 SHA-256. 고속화는 측정 후 조건부(wasm·네이티브 빌드 0 유지).
- **비용 통제**: 메타/크기 선필터로 "불필요한 전체 해시"를 구조적으로 회피(features §P1·§R2 명시 요구).
- **마일스톤 정합**: M6 메타 비교 선출시 → M7 해시 엔진이 P1 옵션·R2·R4를 한꺼번에 연결(공용 엔진=M7 선행 인프라).

## 트레이드오프

- **Main에 Worker 추가**: scanWorker·fileOpWorker에 더해 해시 워커가 늘어남(워커 수명·메모리 관리). 단일 `HashManager`로 집중.
- **SHA-256 속도**: 초대용량(수GB 다수)에서 xxHash/BLAKE3보다 느림 → algo 파라미터로 후속 고속화 여지(인터페이스 고정).
- **R2 부분 해시 미적용(1차)**: 같은 크기 그룹은 전체 해시(앞 N바이트 조기 분기는 후속). 1차 단순·정확 우선.

## 결과

- 신규 Main 디렉토리 `src/main/hash/`(hashEngine·compareEngine·dupEngine·HashManager) + 워커.
- 신규 도메인 `domain/rules/compare.ts`(4상태 분류·짝지음 순수 규칙·렌더러 측 표시용) — Main compareEngine과 분류 규칙 공유(타입은 shared/dto).
- 신규 IPC 채널군 `hash:*`(compare/dup/verify + progress/done + cancel).
- 신규 npm 의존성: **0**(Node 내장 SHA-256). 후속 고속화 시에만 wasm 해시 1종(별도 결정).
- 신규 DTO: `CompareResultDTO`·`DupGroupDTO` 등(shared/dto).
- ADR-000-index에 ADR-009 등록. 마일스톤 **M6**(P1 메타)→**M7**(해시 엔진·P1 옵션·R2·R4).

---

## 미해결 질문 (설계 deferral)

| # | 질문 | 1차 결정 | 후속 트리거 | 비차단 |
|---|---|---|---|---|
| **UQ-H1** | 해시 알고리즘 고속화(xxHash/BLAKE3 wasm 도입) | 1차 **Node 내장 SHA-256**(의존 0) | M7 해시 워커 대용량 실측이 성능 목표 미달일 때 → wasm 고속 해시(네이티브 빌드 0) 옵션 추가(algo 파라미터로 교체) | 비차단 — 인터페이스 고정 |
| **UQ-H2** | R4 복사+검증을 단일 작업으로 묶기(진행률에 검증 단계 포함) | 1차 **복사(op:*/R3 큐) 후 별도 `hash:verify` 잡·요약 합산** | R3 전송 큐(ADR-011)와 통합 시 "복사→검증" 단일 진행률로 합칠지 결정 | 비차단 — features §R4 충족 방식 2안 모두 가능 |
| **UQ-H3** | R2 부분 해시(앞 N바이트) 조기 분기 | 1차 **같은 크기 그룹 전체 해시** | 대용량 동일 크기 그룹이 많아 비용이 문제될 때 부분 해시 2단계 도입 | 비차단 — 1차 정확·단순 |
