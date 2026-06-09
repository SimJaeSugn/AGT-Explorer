# ADR-011 — 전송 큐 아키텍처 (op:* 통합 큐 · 일시정지/재개/동시성)

상태: 제안 · 2026-06-09
관련 기획: PRD §R(R3)·§6 MoSCoW · features §R3 · user-stories 에픽17(US-17.3) · flows F20~F33(R3)
관련 설계: [ADR-005 프로세스/보안 모델](./ADR-005-process-security-model.md) · [ADR-003 IPC 계약 스타일](./ADR-003-ipc-contract-style.md) · [ADR-007 원격(`remote:download/upload`→op:* 재사용)](./ADR-007-remote-protocol-and-network-boundary.md) · `OperationManager.ts`(기존 op:* 오케스트레이션) · [system-architecture §5-R](../system-architecture.md)

> **이 ADR이 다루는 것**: §R3(전송 큐 매니저)이 기존 단발 `op:*`(복사/이동/삭제·진행률·취소·충돌)와 `remote:download/upload`를 **하나의 통합 큐**로 확장하면서, ① 기존 단발 작업과의 **호환(비파괴)**, ② 일시정지/재개, ③ 동시 실행 개수(동시성), ④ 실패 재시도를 어떻게 도입하는가를 결정한다. 마일스톤 **M7**(공통 무거운 인프라 — R2/R4/S1의 진행률·취소·동시성을 일관 수용).

---

## 맥락

현재(MVP) 구조:
- 단발 작업은 `op:start`마다 `OperationManager`가 `operationId`를 발급하고 Worker(또는 trash는 Main)로 즉시 실행한다(`OperationManager.ts`). 진행률은 `op:progress`(200ms 스로틀), 충돌 `op:conflict`/`op:resolve`, 완료 `op:done`, 취소 `op:cancel`.
- §M3 원격 전송도 `remote:download/upload`가 operationId만 반환하고 **같은 op:* 스트림을 재사용**한다(ADR-007 결정⑤).

§R3 요구(features §R3):
- **단일 큐**: 로컬 복사/이동 + 원격 업/다운로드를 한 목록에 통합 표시.
- 작업별 소스/대상·진행률·현재 파일·속도·남은 시간·상태(대기/진행/일시정지/완료/실패).
- 작업별 **일시정지/재개·취소**, 큐 **동시 실행 개수(동시성)** 설정, 실패 항목 재시도.
- **비차단**(큐 열어둔 채 탐색)·상태바 인디케이터 연동.
- **1차 제외**(features §R3): 작업 드래그 재정렬·대역폭 제한·앱 종료 후 큐 영속/재개·청크 이어받기.

핵심 결정: ① 기존 단발 op:*와 큐의 관계(전면 교체 vs 큐를 op:* 위 레이어로), ② 일시정지/재개 메커니즘, ③ 동시성 스케줄러, ④ 채널 설계.

---

## 결정 ① — `OperationManager`를 "큐 스케줄러"로 승격 (전면 교체 아님·기존 op:* 비파괴 확장)

| 옵션 | 장점 | 단점 | 판정 |
|---|---|---|---|
| **OperationManager에 큐 스케줄러 계층 추가(채택)** | 기존 `op:start`/진행률/충돌/취소 의미·채널을 **그대로 보존**하고, 그 위에 "대기 큐 + 동시성 제한 + 일시정지"를 얹는다. 단발 작업도 "큐 길이 1"로 자연 흡수 → **기존 호출부 무변경**(비파괴) | OperationManager 책임 증가 | **채택** |
| 별도 TransferQueue 서비스 신설(op:* 와 병존) | 관심사 분리 | op:* 와 큐가 진행률·취소·충돌을 이중 관리 → 드리프트·정합 부담. 단발/큐 작업 경로가 갈라짐 | 비채택 |
| op:* 전면 교체(모두 큐 경유) | 단일 경로 | 기존 안정 동작·채널 깨짐(회귀 위험)·MVP 호환 상실 | 비채택 |

- **결정**: `OperationManager`에 **큐 모델**을 도입한다. 모든 작업(로컬 op:start·원격 download/upload·압축 extract/add[ADR-008])은 내부적으로 **큐 항목(QueueItem)** 이 되고, 스케줄러가 **동시성 한도(maxConcurrent)** 안에서 실행한다.
  - **기존 단발 작업 호환**: 동시성 한도 ≥ 현재 활성 수면 즉시 실행(체감 동일). `op:start`/`op:progress`/`op:conflict`/`op:resolve`/`op:done`/`op:cancel` **채널·의미 불변**.
  - **큐 항목 = 기존 operationId 1개**: 큐 항목 식별자는 기존 `operationId`를 그대로 쓴다(새 식별 체계 도입 안 함) → 진행률·충돌·완료가 기존 스트림으로 자연 흐른다.
  - 원격/압축 전송도 같은 큐에 들어가 동시성·일시정지·재시도를 일관되게 받는다.

---

## 결정 ② — 일시정지/재개 (협조적 일시정지 — 로컬/원격 공통)

- **로컬(Worker)**: SharedArrayBuffer 취소 플래그 옆에 **일시정지 플래그**를 추가한다(취소 인프라 재사용). Worker는 파일/청크 경계에서 플래그를 폴링해 ① 일시정지면 현재 파일 완료 후 대기(또는 청크 경계 멈춤), ② 재개면 계속. 진행 상태(처리한 항목/바이트)는 보존.
- **원격(Main 스트림)**: ssh2/basic-ftp 스트림을 `pause()`/`resume()`(Node stream 표준)으로 일시정지/재개. 세션은 유지(재연결 불요).
- **세분 단위**: 1차는 **파일 경계 일시정지**(현재 파일은 마치고 멈춤)로 단순·안전. **청크 단위 이어받기(resume)는 1차 제외**(features §R3) — 일시정지/재개는 "같은 세션 내 멈춤/계속"이지 앱 종료 후 재개가 아니다.
- **상태**: 큐 항목 상태에 `'paused'` 추가(대기/진행/일시정지/완료/실패). `op:progress`에 상태 필드 또는 별도 큐 상태 푸시로 렌더러 반영.

---

## 결정 ③ — 동시성 스케줄러 (maxConcurrent · 대기 큐)

- **스케줄러**: `OperationManager`가 `maxConcurrent`(설정값·기본 예: 2) 한도로 큐에서 대기 항목을 꺼내 실행한다. 한도 초과분은 `'pending'`(대기) 상태로 대기.
- **로컬/원격 동시성 분리 고려**: 로컬 디스크 I/O와 원격 네트워크 I/O는 병목이 다르다 → 1차는 **단일 전역 동시성**으로 단순화하되, 후속에 로컬/원격 별도 한도로 확장 가능하게 스케줄러를 파라미터화(미해결 UQ-R1).
- **재시도**: 실패 항목(부분 실패 요약·E4/US-5.2)은 큐에 `'failed'`로 남고, 사용자가 **재시도**하면 같은 소스/대상으로 새 큐 항목(또는 동일 항목 재큐). 실패 사유(권한·사용중·네트워크)는 기존 OpSummary 실패 목록 재사용.
- **순서**: 1차는 **enqueue 순서(FIFO)**. 드래그 재정렬·우선순위는 1차 제외(features §R3).

---

## 결정 ④ — 채널 설계 (기존 op:* 재사용 + 큐 제어 `queue:*` 최소 추가)

전송 자체(진행률·충돌·완료·취소)는 **기존 `op:*`를 그대로 재사용**한다. 큐 "보기·제어"만 최소 신규 채널로 추가한다.

```text
queue:list() -> Result<{ items: QueueItemDTO[] }, FileOpError>     # 현재 큐 스냅샷(큐 패널 초기 로드)
queue:state(evt: { items: QueueItemDTO[] })                        # 푸시 — 큐 항목 추가/상태변경 시 갱신(디바운스)
queue:pause(req: { operationId }) -> Result<void, FileOpError>     # 작업 일시정지
queue:resume(req: { operationId }) -> Result<void, FileOpError>    # 작업 재개
queue:retry(req: { operationId }) -> Result<void, FileOpError>     # 실패 항목 재시도
queue:set-concurrency(req: { maxConcurrent: number }) -> Result<void, FileOpError>
# 취소는 기존 op:cancel 재사용. 진행률은 기존 op:progress 재사용.
```
- `QueueItemDTO`: `{ operationId, kind(copy/move/remote-up/remote-down/archive-extract/archive-add), sources요약, dest요약, status, progress(처리/전체 바이트·항목), bytesPerSec, etaSec }`.
- **상태바 인디케이터 연동**: 기존 StatusBar 진행 인디케이터가 큐 합산(`queue:state`)으로 "N개 작업 진행 중" 표시.
- ADR-003 단일출처 규약·sender·zod. 동결 예외는 `remote:*`·`analyze:scan:*` 선례와 동일.

---

## 근거 (종합)

- **비파괴 호환**: 기존 op:* 채널·의미·호출부를 보존하고 큐를 그 위에 얹어 회귀 위험 최소화(MVP 안정 동작 유지).
- **단일 식별 체계**: 큐 항목 = 기존 operationId → 진행률/충돌/완료가 기존 스트림으로 흐름·드리프트 0.
- **취소 인프라 재사용**: 일시정지를 SharedArrayBuffer 플래그(취소 옆)·Node stream pause/resume로 구현 → 신규 패턴 0.
- **R2/R4/S1 수용**: M7에서 큐가 깔리면 R2 정리 삭제·R4 검증·S1 결과 정리 등 다수 작업의 진행률·취소·동시성을 일관 수용(PRD §12 M7 묶음 근거).
- **단순성**: 1차 FIFO·전역 동시성·파일 경계 일시정지로 과설계 회피(드래그 재정렬·대역폭 제한·종료 후 재개·청크 resume은 features §R3 1차 제외 그대로).

## 트레이드오프

- **OperationManager 책임 증가**: 큐 스케줄러·일시정지·재시도가 한 모듈에 집중 → 내부 모듈 분리(`TransferQueue` 내부 클래스)로 가독성 보완.
- **파일 경계 일시정지**: 거대 단일 파일은 그 파일을 마쳐야 멈춤(청크 멈춤은 후속). 1차 안전·단순.
- **전역 동시성**: 로컬/원격 병목 차이를 1차엔 무시(별도 한도는 후속).
- **종료 후 큐 영속 없음**: 앱 재시작 시 큐 비움(features §R3 1차 제외). 진행 중 작업은 종료 시 정리.

## 결과

- `OperationManager.ts` 확장(내부 `TransferQueue` 스케줄러·일시정지 플래그·재시도). 기존 op:* 채널·의미 불변.
- Worker 프로토콜에 일시정지 플래그 추가(SharedArrayBuffer·취소 옆).
- 신규 IPC 채널군 `queue:*`(list/state/pause/resume/retry/set-concurrency) + 기존 op:* 재사용.
- 신규 npm 의존성: **0**.
- 신규 DTO: `QueueItemDTO`(shared/dto). 신규 렌더러: `ui/queue/`(전송 큐 패널)·`operationsSlice` 확장(큐 항목).
- ADR-000-index에 ADR-011 등록. 마일스톤 **M7**.

---

## 미해결 질문 (설계 deferral)

| # | 질문 | 1차 결정 | 후속 트리거 | 비차단 |
|---|---|---|---|---|
| **UQ-R1** | 로컬/원격 별도 동시성 한도 | 1차 **단일 전역 동시성** | 로컬 디스크/원격 네트워크 병목 차이가 실측될 때 별도 한도로 확장(스케줄러 파라미터화) | 비차단 |
| **UQ-R2** | 청크 단위 이어받기(resume)·앱 종료 후 큐 재개 | 1차 **제외**(features §R3) — 파일 경계 일시정지·세션 내 멈춤/계속만 | 끊긴 대용량 전송 재개 수요 시 ADR-007 UQ-M2(부분 전송 resume)와 함께 설계 | 비차단 — features §R3 1차 제외 |
| **UQ-R3** | 작업 드래그 재정렬·우선순위·대역폭 제한 | 1차 **FIFO·제한 없음** | 파워유저 수요 시 우선순위 큐·스로틀 추가 | 비차단 — features §R3 1차 제외 |
