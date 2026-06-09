# M7 — 코드베이스 수준 세부 구현 계획 (공용 해시 엔진 · 전송 큐 + R2 · R3 · R4 · P1 해시/재귀)

> 작성: 테크리드 · 2026-06-09 · 브랜치 `feature/power-features` · 상태: **🔜 미착수(구현 대기)**
> 설계 단일 출처: [ADR-009 해시·비교 엔진](../architecture/adr/ADR-009-hash-and-compare-engine.md) · [ADR-011 전송 큐](../architecture/adr/ADR-011-transfer-queue.md) · [system-architecture §5-PU](../architecture/system-architecture.md) · [software-architecture §13·§14](../architecture/software-architecture.md) · [directory-structure §8](../architecture/directory-structure.md) · [traceability §1-P·§1-R](../architecture/traceability.md)
> 기획 수용기준: [features §P1·§R2·§R3·§R4](../features.md) · [user-stories US-15.1·US-17.2·US-17.3·US-17.4](../user-stories.md) · [flows F20·F23·F24·F25](../flows.md)
> 선행 기준선(반드시 재사용): `operations/scanEngine.ts`(환경 비의존 엔진·콜백 훅·순환차단)·`operations/ScanManager.ts`(jobId·취소·200ms 스로틀·세션 격리)·`operations/OperationManager.ts`(op:* 오케스트레이션·SharedArrayBuffer 취소·진행률·외부 op 등록)·`workers/scanWorker.ts`·`workers/scanProtocol.ts`·`workers/fileOpWorker.ts`·`workers/protocol.ts`·`ipc/analyze.handlers.ts`(handleGuarded 선례)·`ipc/guard.ts`·`shared/ipc/{channels,contracts}.ts`·`shared/dto/index.ts`·`infra/api/index.ts`(subscribeScanStream 선례)·`preload/api.ts`·`app/stores/operationsSlice.ts`·`app/usecases/operationsBridge.ts`·M6 `domain/rules/compare.ts`·`app/stores/compareSlice.ts`·`app/usecases/compare.ts`.
>
> **목적**: PM이 개발자 에이전트(backend-dev / frontend-dev / qa-engineer)를 **순차 호출**해 구현하도록, M7 6스코프를 ① 신규 채널·DTO 계약(shared 단일출처 선확정), ② 해시 워커·큐 구조, ③ 기능별 파일·시그니처·구현 순서·DoD, ④ verify 계획, ⑤ 리스크로 확정한다. **본 문서는 코드를 생성하지 않는다 — 실행 계획만.**
>
> **상주 팀 없음**: TeamCreate/SendMessage 미사용. 따라서 본 계획은 **인프라(backend) → 기능(backend+frontend)** 단위로, 각 단계가 **단일 개발자가 독립 구현 가능**하도록 쪼갰다. 채널/DTO 계약은 backend·frontend가 합의 가능하게 **shared/ipc 단일출처를 가장 먼저 확정**(W0)하는 순서로 둔다.

---

## 0. 공통 규약 · 명명 · 공유 변경점

### 0.1 불변 규칙 (전 스코프 공통)
- 기존 코드/문서 **비파괴**. 설계 계약 임의 변경 금지. 기존 `op:*`·`analyze:scan:*`·`remote:*` 채널·의미 **불변**.
- **ADR-003 throw0/Result**: 신규 IPC 핸들러는 전부 `Result<T, FileOpError>` 반환·sender 검증(`isTrustedSender`)·zod(`parseArgs`)·`guardPath` 필수. 워커/엔진 내부도 항목 단위 오류는 throw 금지(`scanEngine` `skipped++` 패턴).
- **ADR-005 보안**: 해시·중복·검증·비교는 전부 **로컬 한정**(원격 네임스페이스 거부). 신규 네트워크/실행 표면 0. 모든 경로 `guardPath` 정규화·상위이탈 차단·순환 링크 미추종(`scanEngine` F장 원칙 재사용). 워커는 Main 전용(Renderer 직접 fs 접근 0).
- **계약 단일 출처**: 채널=`src/shared/ipc/channels.ts`, 요청/응답·이벤트 타입=`src/shared/ipc/contracts.ts`, DTO=`src/shared/dto/index.ts`. Main↔Worker 내부 프로토콜은 `src/main/hash/*Protocol.ts`(shared 가 아님 — `scanProtocol.ts` 선례).
- **동결 예외**: M7 신규 채널은 **Should 신기능 + 워커/Main 백그라운드 작업**으로 `analyze:scan:*`·`remote:*` 선례와 **동일 규약**(P1 동결 후 추가). system-architecture §5-PU.1에 이미 등재된 시그니처를 그대로 구현한다(설계 확장 아님 = 계획대로 구현).
- **신규 npm 의존성: 0** — 해시는 Node 내장 `crypto.createHash('sha256')`. 큐는 OperationManager 내부 확장(의존 0). (고속화 wasm은 UQ-H1 deferral — 비차단.)

### 0.2 공유(공통) 변경 파일 — 충돌 주의 지점
순차 구현이므로 **W0(계약) → W1(해시 인프라) → W2(큐 인프라) → R2 → R3 → R4 → P1해시** 순서를 지키면 머지 충돌 0. 아래는 여러 스코프가 함께 건드리는 파일:

| 파일 | 변경 스코프 | append-only 규칙 |
|---|---|---|
| `src/shared/ipc/channels.ts` | W0(`HASH_*`·`QUEUE_*` 상수 + `EVENT_CHANNELS` 푸시 6종 추가) | 기존 블록 무변경·끝에 신규 블록 append. W0이 1회 확정. |
| `src/shared/ipc/contracts.ts` | W0(요청/응답·이벤트 타입 + `IpcRequestMap`·`IpcEventMap` 항목) | 기존 항목 무변경·끝에 append. |
| `src/shared/dto/index.ts` | W0(`DupGroupDTO`·`CompareResultDTO`·`HashAlgo`·`VerifyMismatchDTO`·`QueueItemDTO`·`QueueItemKind`·`QueueItemStatus`) | M6가 추가한 `ComparePairDTO`·`CompareSummary` 블록 **아래에** append. |
| `src/preload/api.ts` | W0(`ExplorerApi.hash`·`ExplorerApi.queue` 표면 + invoke/subscribe 구현) | 기존 네임스페이스 무변경·`analyze`/`op` 뒤에 신규 `hash`/`queue` 추가. |
| `src/renderer/infra/api/index.ts` | W0(`hashApi`·`queueApi`·`subscribeHashStream`·`subscribeQueueStream`) | 기존 export 무변경·끝에 append(`subscribeScanStream` 동형). |
| `src/main/ipc/index.ts` | W1(`registerHashHandlers`)·W2(`registerQueueHandlers`) | `registerIpcHandlers()` 끝에 2줄 append. |
| `src/main/operations/OperationManager.ts` | W2(내부 `TransferQueue` 스케줄러·일시정지·재시도) | **비파괴 확장** — 기존 `start`/`finish`/`cancel`/`registerExternalOperation` 의미 보존, 큐 계층을 그 안에 삽입(§3 상세). |
| `src/main/workers/protocol.ts` + `fileOpWorker.ts` | W2(일시정지 플래그·`PAUSE_FLAG_INDEX` 추가) | `CANCEL_FLAG_INDEX` 옆에 `PAUSE_FLAG_INDEX=1` 추가·SharedArrayBuffer 2워드화(비파괴 — 기존 취소 동작 불변). |
| `src/renderer/app/stores/operationsSlice.ts` | R3(큐 표시 상태 미러·`_queueState`) | 기존 액션 무변경·큐 항목 필드·`_queueState`/`activeQueueItems` append. |
| `src/renderer/app/stores/rootStore.ts` | R2(`createDedupSlice`)·R3(큐는 operationsSlice 확장이라 신규 슬라이스 선택) | 슬라이스 등록 1줄 append. |
| `src/renderer/domain/rules/compare.ts` + `compareSlice.ts` + `usecases/compare.ts` | P1해시(해시 옵션·재귀 결과 수용) | **M6 메타 경로 비파괴** — 해시/재귀는 옵션 분기로 추가(메타 단일깊이 기본 동작 동치 보장·verify 회귀 0). |

### 0.3 명명 단일 출처 표
| 영역 | 해시 인프라(W1) | 큐 인프라(W2) | R2 | R3 | R4 | P1해시 |
|---|---|---|---|---|---|---|
| Main 엔진/서비스 | `main/hash/hashEngine.ts`·`HashManager.ts` | `OperationManager`(확장·내부 `TransferQueue`) | `main/hash/dupEngine.ts` | (큐 인프라 재사용) | `main/hash/hashEngine.ts`(verify 경로) | `main/hash/compareEngine.ts` |
| Main 워커 | `main/workers/hashWorker.ts`·`hashProtocol.ts` | `fileOpWorker.ts`(일시정지 플래그) | hashWorker(dup 잡) | — | hashWorker(verify 잡) | hashWorker(compare 잡) |
| Main IPC | `main/ipc/hash.handlers.ts` | `main/ipc/queue.handlers.ts` | hash.handlers(dup) | queue.handlers | hash.handlers(verify) | hash.handlers(compare) |
| 채널 | `hash:compare:*`·`hash:dup:*`·`hash:verify:*`·`hash:cancel` | `queue:*` | `hash:dup:*` | `queue:*` | `hash:verify:*` | `hash:compare:*` |
| DTO | `HashAlgo`·`CompareResultDTO` | `QueueItemDTO`·`QueueItemKind`·`QueueItemStatus` | `DupGroupDTO` | `QueueItemDTO` | `VerifyMismatchDTO` | `CompareResultDTO`·`ComparePairDTO`(M6 재사용) |
| store | — | — | `app/stores/dedupSlice.ts` | `operationsSlice`(큐 확장) | (compareSlice/dedup 결과에 표식) | `compareSlice`(확장) |
| usecase | — | — | `app/usecases/dedup.ts` | `app/usecases/queue.ts` | `app/usecases/checksum.ts` | `app/usecases/compare.ts`(확장) |
| UI | — | — | `ui/dedup/*` | `ui/queue/*` | 옵션 토글(설정/복사 다이얼로그)·결과 표식 | `ui/compare/*`(확장: 해시 토글·재귀 토글·진행률) |
| 도메인 순수 | — | — | `domain/rules/dupGroup.ts` | `domain/rules/queueRules.ts`(선택) | `domain/rules/checksumVerdict.ts` | `domain/rules/compare.ts`(확장) |

---

## 1. 신규 IPC 채널 카탈로그 (W0 — 가장 먼저 확정)

> system-architecture §5-PU.1에 등재된 시그니처를 **그대로** 구현한다. 아래는 코드 수준(채널 상수명·DTO 형태·zod 규약·sender/경로 화이트리스트)으로 구체화한 것이다. **invoke 채널은 전부 `Result<T, FileOpError>`**, **푸시 이벤트는 단방향**(Main→Renderer). 식별자는 jobId(hash)·operationId(queue, 기존 재사용).

### 1.1 `channels.ts` 신규 상수 (append)
```text
// ── hash:* (P1 해시 옵션·R2·R4 — ADR-009, 신규 M7) ──────────────────────
HASH_COMPARE_START: 'hash:compare:start',   // invoke → Result<{ jobId }>
HASH_COMPARE_PROGRESS: 'hash:compare:progress', // 푸시 evt
HASH_COMPARE_DONE: 'hash:compare:done',     // 푸시 evt
HASH_DUP_START: 'hash:dup:start',           // invoke → Result<{ jobId }>
HASH_DUP_PROGRESS: 'hash:dup:progress',     // 푸시 evt
HASH_DUP_DONE: 'hash:dup:done',             // 푸시 evt
HASH_VERIFY_START: 'hash:verify:start',     // invoke → Result<{ jobId }>
HASH_VERIFY_PROGRESS: 'hash:verify:progress', // 푸시 evt
HASH_VERIFY_DONE: 'hash:verify:done',       // 푸시 evt
HASH_ERROR: 'hash:error',                   // 푸시 evt (잡 치명 오류 — scan:error 동형·정직)
HASH_CANCEL: 'hash:cancel',                 // invoke → Result<void>

// ── queue:* (R3 전송 큐 — ADR-011, 신규 M7) ────────────────────────────
QUEUE_LIST: 'queue:list',                   // invoke → Result<{ items: QueueItemDTO[] }>
QUEUE_STATE: 'queue:state',                 // 푸시 evt (디바운스 큐 스냅샷)
QUEUE_PAUSE: 'queue:pause',                 // invoke → Result<void>
QUEUE_RESUME: 'queue:resume',               // invoke → Result<void>
QUEUE_RETRY: 'queue:retry',                 // invoke → Result<void>
QUEUE_SET_CONCURRENCY: 'queue:set-concurrency', // invoke → Result<void>
// 취소=기존 op:cancel 재사용, 진행률=기존 op:progress 재사용.
```
`EVENT_CHANNELS` 신규 푸시 추가(7종): `HASH_COMPARE_PROGRESS/DONE`·`HASH_DUP_PROGRESS/DONE`·`HASH_VERIFY_PROGRESS/DONE`·`HASH_ERROR`·`QUEUE_STATE`.
> **설계와의 정직한 차이 1건**: §5-PU.1은 `hash:*` 오류를 별도 채널로 명시하지 않았으나, `analyze:scan:error` 선례대로 잡 치명 오류 푸시 `hash:error`를 추가한다(잡 시작 실패는 invoke Result로, 잡 도중 치명 오류는 푸시로 — 정직 표면). 이는 비파괴·선례 동형이며 ADR 변경 아님(설계 의도 충족 보강).

### 1.2 `contracts.ts` 요청/응답·이벤트 타입 (append)
```ts
// ── hash:* (M7) ──────────────────────────────────────────────────────
export type HashAlgo = 'sha256'   // 1차 1종(ADR-009 결정①). algo 파라미터화로 후속 확장 여지.

export interface HashCompareStartReq {
  readonly leftDir: string
  readonly rightDir: string
  readonly useHash: boolean        // true=같은 이름·같은 크기 항목 내용 해시 비교
  readonly recursive: boolean      // true=하위 폴더 재귀 비교
  readonly algo?: HashAlgo
}
export interface HashJobStartRes { readonly jobId: string }
export interface HashDupStartReq {
  readonly roots: string[]         // 폴더/드라이브/패널 경로(범위)
  readonly minSize?: number        // 이 크기 미만 무시(기본 1 — 0바이트 제외)
  readonly algo?: HashAlgo
}
export interface HashVerifyStartReq {
  readonly pairs: { readonly src: string; readonly dst: string }[]
  readonly algo?: HashAlgo
}
export interface HashCancelReq { readonly jobId: string }

// 푸시 evt — 모두 jobId 상관(소비측 필터)
export interface HashProgressEvt {
  readonly jobId: string
  readonly scannedItems: number
  readonly scannedBytes: number
  readonly currentPath: string
}
export interface HashCompareDoneEvt { readonly jobId: string; readonly result: CompareResultDTO }
export interface HashDupDoneEvt { readonly jobId: string; readonly groups: DupGroupDTO[]; readonly truncated: boolean }
export interface HashVerifyDoneEvt { readonly jobId: string; readonly mismatches: VerifyMismatchDTO[]; readonly verified: number }
export interface HashErrorEvt { readonly jobId: string; readonly error: FileOpError }

// ── queue:* (M7) ─────────────────────────────────────────────────────
export interface QueueListRes { readonly items: QueueItemDTO[] }
export interface QueuePauseReq { readonly operationId: string }
export interface QueueResumeReq { readonly operationId: string }
export interface QueueRetryReq { readonly operationId: string }
export interface QueueSetConcurrencyReq { readonly maxConcurrent: number }
export interface QueueStateEvt { readonly items: QueueItemDTO[] }
```
`IpcRequestMap` 추가: `HASH_COMPARE_START`/`HASH_DUP_START`/`HASH_VERIFY_START` → `Result<HashJobStartRes>`, `HASH_CANCEL` → `Result<void>`, `QUEUE_LIST` → `Result<QueueListRes>`, `QUEUE_PAUSE/RESUME/RETRY/SET_CONCURRENCY` → `Result<void>`.
`IpcEventMap` 추가: 위 7 푸시 evt 매핑.

### 1.3 `dto/index.ts` 신규 DTO (M6 compare 블록 아래 append)
```ts
/** R2 중복 그룹 1건 — 내용 동일(같은 크기 + 같은 해시) 파일 묶음. */
export interface DupGroupDTO {
  readonly hash: string            // 그룹 식별 해시(표시·중복판정)
  readonly size: number            // 그룹 공통 바이트
  readonly files: DupFileDTO[]     // 2개 이상(중복만)
}
export interface DupFileDTO {
  readonly path: string
  readonly name: string
  readonly mtime: number
}
/** R4 체크섬 불일치 1건. verified=일치 수는 done evt 에 합산. */
export interface VerifyMismatchDTO {
  readonly src: string
  readonly dst: string
  readonly reason: 'hash-mismatch' | 'size-mismatch' | 'read-error'
}
/** P1 해시/재귀 비교 결과(Main compareEngine → 렌더러). 단일출처는 ComparePairDTO(M6). */
export interface CompareResultDTO {
  readonly pairs: ComparePairDTO[] // 4상태(left-only/right-only/diff/same)·재귀면 상대경로 포함
  readonly summary: CompareSummary
  readonly usedHash: boolean
  readonly recursive: boolean
  readonly truncated: boolean      // 항목 상한 도달(정직 표기)
}
/** R3 큐 항목 1건(operationId 식별 — 기존 op 재사용). */
export type QueueItemKind = 'copy' | 'move' | 'delete' | 'trash' | 'remote-download' | 'remote-upload'
export type QueueItemStatus = 'pending' | 'running' | 'paused' | 'done' | 'failed' | 'canceled'
export interface QueueItemDTO {
  readonly operationId: string
  readonly kind: QueueItemKind
  readonly status: QueueItemStatus
  readonly sourcesSummary: string   // "3개 항목" 등 요약(경로 전체 미수록·표시용)
  readonly destSummary: string
  readonly processedBytes: number
  readonly totalBytes: number
  readonly processedItems: number
  readonly totalItems: number
  readonly bytesPerSec: number
  readonly etaSec: number | null
  readonly enqueuedAt: number
}
```
> **추적성 주의**: `ComparePairDTO`는 M6가 단일깊이용으로 `name`만 키로 둠. 재귀 비교는 동명 충돌을 피하려 **상대경로**가 필요 → `ComparePairDTO`에 옵셔널 `relPath?: string` 1필드 **비파괴 추가**(M6 메타 경로는 미사용·동치). P1해시 단계에서 추가.

### 1.4 guard.ts zod 스키마 (append)
```ts
const zHashAlgo = z.enum(['sha256'])
export const zHashCompareStartReq = z.object({
  leftDir: zPath, rightDir: zPath, useHash: z.boolean(), recursive: z.boolean(), algo: zHashAlgo.optional()
})
export const zHashDupStartReq = z.object({
  roots: z.array(zPath).min(1), minSize: z.number().int().nonnegative().optional(), algo: zHashAlgo.optional()
})
export const zHashVerifyStartReq = z.object({
  pairs: z.array(z.object({ src: zPath, dst: zPath })).min(1).max(100_000), algo: zHashAlgo.optional()
})
export const zHashCancelReq = z.object({ jobId: z.string().min(1) })
export const zQueuePauseReq = z.object({ operationId: z.string().min(1) })  // resume/retry 동형 재사용 가능
export const zQueueSetConcurrencyReq = z.object({ maxConcurrent: z.number().int().min(1).max(16) })
```
- **경로 화이트리스트**: 핸들러가 `leftDir/rightDir/roots[]/pairs[].src/pairs[].dst`를 **각각 `guardPath`** 로 정규화·상위이탈 차단 후 `stat`으로 존재/종류 검증(`analyze.handlers` 선례). 원격 prefix(`sftp://`·`ftp://`·`archive://`)는 거부(로컬 한정 — §5-PU.3 규칙12). dup `roots`는 디렉토리, verify `pairs`는 파일이어야 함.
- **sender**: 모든 핸들러 `isTrustedSender` + `parseArgs(zod)` 통과(`handleGuarded` 헬퍼 복제 — `analyze.handlers.ts`와 동일).

---

## 2. 해시 워커 설계 (W1 — `src/main/hash/` + `src/main/workers/`)

> scanEngine/scanWorker/ScanManager 패턴을 그대로 차용한다. **환경 비의존 순수 엔진**(콜백 훅) + **Worker 결합** + **HashManager 오케스트레이터**의 3층. 헤드리스 verify 가능(워커 없이 엔진 직접 구동).

### 2.1 환경 비의존 엔진 코어 (순수 — 헤드리스 verify 대상)
**`src/main/hash/hashEngine.ts`** — 스트리밍 해시 코어.
```ts
export interface HashHooks {
  onProgress(scannedItems: number, scannedBytes: number, currentPath: string): void
  shouldCancel(): boolean        // 협조 폴링(scanEngine 동형)
}
/** 단일 파일 스트리밍 해시(청크 read stream → hash.update). 청크 경계마다 취소 폴링·진행 바이트 보고. */
export async function hashFile(path: string, algo: HashAlgo, hooks: HashHooks): Promise<string | null>
// null = 취소되었거나 읽기 실패(throw 금지 — 호출측이 skipped/read-error 처리)
export const HASH_CHUNK_BYTES = 1 << 20  // 1MB 청크(대용량 메모리 안전)
```
**`src/main/hash/dupEngine.ts`** — R2 크기 그룹핑 → 해시 그룹 확정(순수 코어 + fs는 hooks 경유 주입).
```ts
export interface DupEngineDeps {
  /** roots 재귀 열거 → {path,name,size,mtime} (scanEngine 순환차단·권한격리 재사용). */
  enumerate(roots: readonly string[], minSize: number, hooks: HashHooks): Promise<DupFileMeta[]>
  hashFile(path: string, algo: HashAlgo, hooks: HashHooks): Promise<string | null>
}
export async function findDuplicates(
  roots: readonly string[], minSize: number, algo: HashAlgo, hooks: HashHooks, deps: DupEngineDeps
): Promise<{ groups: DupGroupDTO[]; truncated: boolean }>
// 알고리즘: ① 전체 열거하며 size 로 Map<size, meta[]> 그룹핑 → ② size 그룹이 2+ 인 것만 각 파일 해시
//   → ③ Map<hash, meta[]> 로 재그룹핑 → 2+ 인 것만 DupGroupDTO. 유일 크기는 해시 0(비용 통제·ADR-009 결정③).
```
**`src/main/hash/compareEngine.ts`** — P1 폴더 비교(메타 4상태 + 해시 옵션 + 재귀).
```ts
export interface CompareEngineDeps {
  listDir(dir: string, hooks: HashHooks): Promise<FileEntryDTO[]>  // lstat 메타·심볼릭 미추종
  hashFile(path: string, algo: HashAlgo, hooks: HashHooks): Promise<string | null>
}
export async function runCompare(
  req: { leftDir: string; rightDir: string; useHash: boolean; recursive: boolean; algo: HashAlgo },
  hooks: HashHooks, deps: CompareEngineDeps
): Promise<CompareResultDTO>
// 짝지음·4상태 분류 규칙은 M6 domain/rules/compare.ts 의 분류 로직과 동치(공유)여야 함:
//   useHash=true → 양쪽 존재 + 같은 크기 항목만 해시 계산해 same/diff 확정(같은 크기 아님=diff·해시 회피).
//   recursive=true → 양쪽 동명 디렉토리는 재귀 진입(상대경로 relPath 누적)·순환차단(realpath Set).
```
> **분류 규칙 공유(드리프트 방지)**: M6 `domain/rules/compare.ts`의 `isDifferent`/`matchKey` 분류 규칙을 Main compareEngine과 **동일 결과**로 둔다. 도메인은 react/infra import 금지라 Main이 그 파일을 import 할 수 없으므로, **분류 판정 헬퍼를 shared/dto 타입만 의존하는 작은 순수 함수로 추출**해 양쪽이 공유하거나(권장), 최소한 verify로 동치 고정한다(§5).

### 2.2 Worker 결합
**`src/main/workers/hashProtocol.ts`** (scanProtocol 동형 — Main 내부 스레드 경계 전용).
```ts
export type HashJobKind = 'compare' | 'dup' | 'verify'
export interface HashJob {
  readonly jobId: string
  readonly kind: HashJobKind
  readonly payload: HashCompareStartReq | HashDupStartReq | HashVerifyStartReq  // 정규화된 절대경로
  readonly algo: HashAlgo
  readonly cancelBuffer: SharedArrayBuffer  // Int32[0]=cancel (scanProtocol 동형)
}
export interface HashProgressMsg { type: 'progress'; scannedItems; scannedBytes; currentPath }
export interface HashCompareDoneMsg { type: 'compare-done'; result: CompareResultDTO }
export interface HashDupDoneMsg { type: 'dup-done'; groups: DupGroupDTO[]; truncated: boolean }
export interface HashVerifyDoneMsg { type: 'verify-done'; mismatches: VerifyMismatchDTO[]; verified: number }
export interface HashFatalMsg { type: 'fatal'; code: FileOpErrorCode; message: string; path?: string }
export type HashOutMsg = HashProgressMsg | HashCompareDoneMsg | HashDupDoneMsg | HashVerifyDoneMsg | HashFatalMsg
export const CANCEL_FLAG_INDEX = 0
```
**`src/main/workers/hashWorker.ts`** (scanWorker 동형) — `workerData=HashJob` 수신 → `kind`로 compareEngine/dupEngine/hashFile 분기 실행 → `parentPort.postMessage`. fs 결합 deps(`listDir`·`enumerate`·`hashFile`)는 워커가 실제 `node:fs`로 주입. 취소는 `Atomics.load(cancelView, CANCEL_FLAG_INDEX)===1`. `if (!parentPort)` 가드로 번들 검증 시 no-op(scanWorker 선례).
> **재귀 열거·순환차단·권한격리**: `scanEngine.scanDir`의 realpath 방문 Set·lstat 심볼릭 미추종·readdir/lstat 실패 skipped++·`SCAN_ITEM_CAP` 상한 패턴을 dupEngine `enumerate`·compareEngine 재귀에 **그대로 재사용**(중복 구현 회피 — 가능하면 scanEngine의 디렉토리 워크를 공용 헬퍼로 추출하거나 동일 규칙 복제).

### 2.3 오케스트레이터
**`src/main/hash/HashManager.ts`** (ScanManager 동형, 단일 인스턴스 `hashManager` export).
- `startCompare/startDup/startVerify(req, wc)` → `randomUUID` jobId 발급 + `SharedArrayBuffer(4byte)` 취소 버퍼 + `new Worker(workerPath, { workerData: HashJob })`.
- worker `message`: progress는 `lastProgress` 보관(200ms `setInterval` 스로틀로 `HASH_*_PROGRESS` 1건 푸시) / `*-done`은 해당 `HASH_*_DONE` 푸시 후 finish / `fatal`은 `HASH_ERROR` 푸시 후 finish.
- `cancel(jobId)` → `Atomics.store(cancelView, 0, 1)`(멱등 ok·레이스 안전·ScanManager 선례).
- `wc.isDestroyed()` 가드·`worker.terminate()` 정리·jobId Map 제거(ScanManager `finish` 복제).
- **동시 잡 정책**: compare/verify는 단일 활성(새 시작 시 이전 동종 취소·ScanManager 선례), dup은 1개로 충분. 세션 격리(jobId Map).
- **워커 경로**: `join(__dirname, 'hashWorker.js')`(ScanManager·OperationManager 동형). **빌드 설정 확인 필수**: `electron.vite.config.ts` main 워커 엔트리에 `hashWorker` 추가(`scanWorker`·`fileOpWorker` 선례 — backend-dev 첫 작업에 포함).

### 2.4 IPC 핸들러
**`src/main/ipc/hash.handlers.ts`** (analyze.handlers 동형) — `registerHashHandlers()`:
- `HASH_COMPARE_START`: `guardPath(leftDir)`·`guardPath(rightDir)` + 각 `stat` 디렉토리 검증 + 원격 prefix 거부 → `hashManager.startCompare`.
- `HASH_DUP_START`: `roots[]` 각 `guardPath`+디렉토리 검증 → `hashManager.startDup`.
- `HASH_VERIFY_START`: `pairs[].src/.dst` 각 `guardPath`+파일 검증 → `hashManager.startVerify`.
- `HASH_CANCEL`: `hashManager.cancel(jobId)`.
- progress/done/error는 HashManager가 `event.sender`로 직접 푸시(analyze 선례).
- `index.ts registerIpcHandlers()`에 `registerHashHandlers()` append.

---

## 3. 전송 큐 설계 (W2 — `OperationManager` 확장 + `queue.handlers.ts`)

> ADR-011 결정①: **OperationManager를 큐 스케줄러로 승격**(전면 교체 아님·비파괴). 큐 항목 = 기존 `operationId`. 기존 `op:*` 채널·의미 불변. 단발 작업도 "큐 길이 1"로 자연 흡수.

### 3.1 OperationManager 내부 확장 (비파괴)
기존 `start()`는 **즉시 워커를 띄우지 말고** 큐에 enqueue 후 스케줄러가 동시성 한도 내에서 실제 실행하도록 분리한다. 단, 기존 호출부·반환(`Result<{operationId}>`)·이벤트 의미는 불변.
- 내부 클래스 `TransferQueue`(같은 파일 내 또는 `operations/TransferQueue.ts` 분리·가독성):
  ```ts
  interface QueueEntry {
    operationId: string
    kind: OpKind
    status: QueueItemStatus
    enqueuedAt: number
    run: () => void          // 실제 실행(startWorker/startTrash/externalOp 구동 클로저)
    sourcesSummary: string; destSummary: string
    pauseView: Int32Array | null  // 일시정지 플래그(SharedArrayBuffer Int32[1])
    // 진행률은 기존 ActiveOp.lastProgress 재사용
  }
  ```
- **스케줄러**: `maxConcurrent`(기본 2·설정값) 한도. enqueue/완료/재개 시 `pump()` 호출 → `pending` 중 한도 여유만큼 `run()`. 초과분 `pending` 유지(FIFO·enqueueAt 순).
- **단발 호환**: `maxConcurrent ≥ 활성수`면 즉시 실행(체감 동일). 원격 download/upload(`registerExternalOperation`)·trash·copy/move/delete 전부 큐 항목으로 흡수.
- **상태바 연동**: 큐 변경 시 디바운스(예: 150ms)로 `QUEUE_STATE` 푸시(`buildQueueSnapshot(): QueueItemDTO[]`).

### 3.2 일시정지/재개 (협조적 — ADR-011 결정②)
- **로컬(Worker)**: SharedArrayBuffer를 **2워드**로 확장(`Int32[0]=cancel`·`Int32[1]=pause`). `workers/protocol.ts`에 `PAUSE_FLAG_INDEX = 1` 추가·`fileOpWorker.ts` `shouldCancel` 옆에 일시정지 폴링 추가:
  ```ts
  // engine 의 파일/청크 경계 훅에서: pause 플래그면 현재 파일 완료 후 짧은 sleep 루프 폴링(재개까지 대기).
  ```
  → **기존 취소 동작 불변**(cancel 인덱스 0 그대로). engine.ts(runCopy/runMove/runDelete)가 파일 경계에서 hooks를 폴링하므로, `EngineHooks`에 `shouldPause?(): boolean` 추가(옵셔널·비파괴) 또는 `shouldCancel` 폴링 지점에서 pause 대기 삽입(최소 변경 우선 — backend-dev 판단·verify로 고정).
- **원격(Main 스트림)**: ssh2/basic-ftp 스트림 `pause()`/`resume()`(Node stream 표준)을 `registerExternalOperation` 핸들에 `onPause/onResume` 훅으로 노출. `remoteTransfer.ts`가 자기 스트림을 멈춤/재개.
- **세분 단위**: 1차 **파일 경계 일시정지**(현재 파일 마치고 멈춤). 청크 이어받기는 UQ-R2 deferral(비차단).

### 3.3 재시도·동시성·채널
- **재시도**: `failed` 큐 항목을 같은 소스/대상으로 새 큐 항목 재큐(또는 동일 항목 status→pending). 실패 사유는 기존 `OpSummary.failures` 재사용.
- **동시성**: `QUEUE_SET_CONCURRENCY(maxConcurrent)` → 스케줄러 한도 갱신 후 `pump()`. 1차 단일 전역 동시성(로컬/원격 분리는 UQ-R1 deferral).
- **`src/main/ipc/queue.handlers.ts`** (`registerQueueHandlers()`): `QUEUE_LIST`(스냅샷)·`QUEUE_PAUSE/RESUME/RETRY`(operationId)·`QUEUE_SET_CONCURRENCY`. 취소는 기존 `op:cancel`. `index.ts`에 append.
> **정직한 주의**: 이 확장은 OperationManager 핵심 경로를 건드린다 → 기존 `verify:ops`·`verify:operations`·`verify:paste` **회귀 0**을 게이트로(§5·§7). 큐 미사용(maxConcurrent 무한·단발) 시 기존 동작과 **정확히 동치**임을 verify로 고정.

### 3.4 렌더러 큐 슬라이스/브리지 (R3)
- `operationsSlice` 확장: `queueItems: QueueItemDTO[]`·`maxConcurrent: number`·`_queueState(items)`·`activeQueueItems()`. 기존 op 미러와 별개 필드(비파괴).
- `app/usecases/queue.ts`: `pauseQueueItem/resumeQueueItem/retryQueueItem/setConcurrency`(queueApi 호출)·부팅 시 `queue:list` 1회 로드.
- `app/usecases/queueBridge.ts`(operationsBridge 동형): `subscribeQueueStream` 구독 → `_queueState`. App 부팅 시 1회 init.

---

## 4. 기능별 신규/수정 파일 + 구현 순서 + DoD

### 구현 순서(권장): **W0 계약 → W1 해시 인프라 → W2 큐 인프라 → R2 → R3 → R4 → P1해시**
인프라(W1·W2)는 backend-dev 단독. 기능은 backend(엔진/잡 연결)→frontend(UI) 순서로 단일 개발자 단위.

| 단계 | 담당 | 의존성 | 산출물 핵심 |
|---|---|---|---|
| **W0 계약** | backend-dev | 없음 | channels·contracts·dto·guard·preload·infra/api 신규 표면(§1). typecheck 0. |
| **W1 해시 인프라** | backend-dev | W0 | hashEngine·dupEngine·compareEngine·HashManager·hashWorker·hashProtocol·hash.handlers·vite 워커 엔트리(§2). |
| **W2 큐 인프라** | backend-dev | W0 | OperationManager 큐 확장·일시정지 플래그·queue.handlers·queueBridge 골격(§3). |
| **R2** | backend(잡)→frontend(UI) | W1 | dupEngine 연결·`dedupSlice`·`usecases/dedup.ts`·`domain/rules/dupGroup.ts`·`ui/dedup/*`. |
| **R3** | frontend(UI) | W2 | `ui/queue/*`(목록·진행률·속도·ETA·일시정지/재개/취소/재시도·동시성)·StatusBar 인디케이터 연동·`usecases/queue.ts`. |
| **R4** | backend(verify 잡)→frontend(옵션) | W1·W2 | `usecases/checksum.ts`·`domain/rules/checksumVerdict.ts`·복사 후 `hash:verify` 잡·옵션 토글(설정/복사)·결과 표식. |
| **P1해시** | backend(compare 잡)→frontend(토글) | W1 | compareEngine 연결·`compare.ts`(도메인 확장)·`compareSlice`/`usecases/compare.ts` 해시·재귀 분기·`ui/compare/*` 토글·진행률. `ComparePairDTO.relPath?` 추가. |

### 4.1 R2 중복 파일 찾기 (US-17.2·§R2·F23)
**신규**: `domain/rules/dupGroup.ts`(그룹 정렬·"원본 1개 남기고 나머지 선택" 보조·전체선택 가드 — 순수)·`app/stores/dedupSlice.ts`(범위·진행률·그룹·선택)·`app/usecases/dedup.ts`(`startDedup(roots)`·`hash:dup` 구독·정리=`op:trash` 재사용·K1 undo 자동)·`ui/dedup/DedupPanel.tsx`·`DedupGroupRow.tsx`·`ui/dedup/dedupBridge.ts`.
**수정**: `rootStore.ts`(`createDedupSlice`)·`usecases/contextMenu.ts`(폴더 "중복 찾기")·진입(아이콘바/메뉴).
**도메인 순수 `dupGroup.ts`**: `selectAllButOne(group)`·`hasFullSelection(group)`(보존 0 경고)·`sortGroupsByWaste(groups)`. throw 0.
**DoD**: 범위 지정→탐지 시작·크기→해시 2단계·그룹 표시·"원본 1개 남기고 선택"·휴지통 정리·진행률/취소·K1 연계·전체삭제 경고. `verify:hash`(dupEngine)·`verify:domain`(dupGroup) 통과.

### 4.2 R3 전송 큐 매니저 (US-17.3·§R3·F24)
**신규**: `ui/queue/QueuePanel.tsx`(목록·항목별 진행률·속도·ETA·상태)·`QueueItemRow.tsx`(일시정지/재개/취소/재시도 버튼)·`QueueConcurrencyControl.tsx`·`app/usecases/queue.ts`·`app/usecases/queueBridge.ts`.
**수정**: `operationsSlice`(큐 미러·§3.4)·`ui/statusbar/*`(큐 합산 "N개 작업 진행 중" 인디케이터·기존 진행 인디케이터 큐 연동)·진입(상태바 클릭/메뉴로 큐 패널 토글).
**DoD**: 로컬+원격 통합 큐 목록·항목별 진행률/속도/상태·일시정지/재개·취소·동시성 설정·실패 재시도·비차단(큐 열고 탐색)·상태바 연동. **기존 op:* 회귀 0**(verify:ops/operations/paste). `verify:queue`(스케줄러 상태머신) 통과.

### 4.3 R4 체크섬 검증 (US-17.4·§R4·F25, Could·후순위)
**신규**: `domain/rules/checksumVerdict.ts`(쌍 비교 판정·요약 — 순수)·`app/usecases/checksum.ts`(복사 완료 후 `hash:verify:start({pairs})` + 결과 토스트/표식)·`ui/dialogs/*` 또는 복사 옵션 토글("복사 후 체크섬 검증"·기본 off).
**수정**: 설정(settingsSlice·옵션 토글 영속 선택)·복사 흐름(op:done 후 옵션 켜졌으면 검증 잡 트리거)·결과 표식(불일치 경고).
**연계(ADR-009 UQ-H2 1차 결정)**: 복사(op:*/R3 큐) **완료 후 별도 `hash:verify` 잡**·요약 합산(복사+검증 단일 진행률 통합은 후속·비차단).
**DoD**: 옵션 기본 off·켜면 복사 후 원본/사본 해시 비교·불일치 경고 및 실패 요약(임의 무시 0)·검증 진행률/취소·비차단. `verify:hash`(verify 판정)·`verify:domain`(checksumVerdict) 통과.

### 4.4 P1 해시/재귀 비교 (US-15.1 확장·ADR-009)
**수정(비파괴)**: `domain/rules/compare.ts`(해시 비교 분기·재귀 결과 수용·분류 헬퍼 공유 추출)·`compareSlice`(해시 토글·재귀 토글·진행률·jobId·결과 수용)·`usecases/compare.ts`(useHash/recursive면 `hash:compare:start` 호출·구독·미러는 기존 op:* 유지)·`ui/compare/CompareToolbar.tsx`(해시·재귀 토글)·`ui/compare/CompareView.tsx`(진행률·재귀 트리 표시)·`compareBridge`(hash:compare 구독).
**신규 DTO 변경**: `ComparePairDTO.relPath?`(재귀 동명 구분·비파괴).
**M6 동치 보장**: useHash=false·recursive=false면 **M6 메타 단일깊이 경로 그대로**(렌더러 순수 계산·채널 0). 켤 때만 워커 경유(`hash:compare`).
**DoD**: 해시(내용) 옵션·재귀 하위폴더 비교·진행률/취소·UI 비차단·미러는 기존 휴지통/K1 경로. **M6 메타 비교 회귀 0**(verify:domain compare 동치). `verify:hash`(compareEngine)·`verify:domain`(분류 동치) 통과.

---

## 5. verify 계획 (신규 verify:* + 헤드리스 케이스 개요)

> 기존 패턴: 도메인 순수=`verify:domain`(tests/domain.verify.ts)·store=`verify:store`·엔진=신규 esbuild cjs 스크립트(`verify:scan`·`verify:ops` 선례). **워커는 헤드리스 주입 스텁**(scanWorker/thumbnail/dnd verify처럼 `external:electron`·fs deps 주입). 신규 스크립트는 `package.json scripts`에 `verify:scan` 라인 형식 복제로 추가.

| 신규 verify | 대상 | 헤드리스 케이스 개요 |
|---|---|---|
| **`verify:hash`** (scripts/verify-hash.ts·cjs·external:electron) | hashEngine·dupEngine·compareEngine·checksumVerdict | **hashEngine**: 동일 내용 같은 해시·다른 내용 다른 해시·청크 경계(>1MB 임시파일)·취소 중단(shouldCancel→null)·읽기실패 null(throw0). **dupEngine**: 유일 크기 해시 0(호출 카운트 검증·deps 스텁)·같은 크기 다른 내용 분리·2+ 만 그룹·minSize 필터·item cap truncated. **compareEngine**: 메타 4상태(M6 동치)·useHash 같은 크기만 해시·다른 크기 해시 회피·재귀 relPath·순환차단(realpath 중복 skip)·취소 부분결과. **checksumVerdict**: 일치/불일치/size-mismatch/read-error 판정·요약 합. (fs deps는 임시 디렉토리/주입 스텁.) |
| **`verify:queue`** (scripts/verify-queue.ts·cjs·external:electron·stub-electron) | TransferQueue 상태머신 | 동시성 한도(maxConcurrent=2 → 3번째 pending)·pump 순서(FIFO)·pause→paused·resume→running·retry(failed→pending 재큐)·set-concurrency 후 즉시 pump·**단발 동치**(maxConcurrent 무한 시 enqueue 즉시 run = 기존 동작)·buildQueueSnapshot shape. (Worker·wc는 스텁 — run 클로저 mock.) |
| **`verify:domain`** 확장 | dupGroup·compare(확장)·checksumVerdict | dupGroup: selectAllButOne·hasFullSelection 경고·sortGroupsByWaste. compare 확장: 해시 분기 분류·재귀 키(relPath) 매칭·**M6 케이스 전부 통과 유지**(회귀 0). |
| **`verify:store`** 확장 | dedupSlice·operationsSlice(큐 미러) | dedup: startDedup·그룹 수용·선택·정리. operationsSlice: `_queueState` 미러·activeQueueItems·기존 op 미러 케이스 회귀 0. |
| **회귀 게이트** | 기존 전 verify | `verify:ops`·`verify:operations`·`verify:paste`(OperationManager 큐 확장 회귀)·`verify:scan`(워커 패턴 공유)·`verify:domain`/`verify:store`(M6 compare 동치) **전 케이스 통과 유지**. |

> **워커 헤드리스 주입(리스크 완화 핵심)**: hashEngine/dupEngine/compareEngine는 fs deps(`listDir`·`enumerate`·`hashFile`)를 **인자 주입**으로 받게 설계(§2.1) → verify가 메모리 스텁/임시파일로 워커 없이 엔진을 직접 검증(scanEngine `runScan(hooks)` 직접 호출 선례·OperationManager `deleteDirect` 선례). HashManager·Worker 메시지 경로(스로틀·terminate·취소 전파)는 ScanManager와 동형이므로 **구조 동일성으로 신뢰**(런타임 스모크 🟡로 정직 구분).

---

## 6. 규약 준수 체크리스트

| 규약 | 적용 |
|---|---|
| **ADR-003 throw0/Result** | 신규 invoke 핸들러 전부 `Result<T,FileOpError>`·`isTrustedSender`·`parseArgs(zod)`·`guardPath`. 엔진/워커 항목 단위 오류는 throw 금지(skipped/null/read-error 격리). 잡 도중 치명오류는 `hash:error` 푸시. |
| **ADR-005 보안** | 해시·dup·verify·compare 전부 로컬 한정(원격/archive prefix 거부)·경로 정규화·순환 미추종·워커 Main 전용. 신규 네트워크/실행 표면 0. SharedArrayBuffer 취소+일시정지(기존 인프라 재사용). |
| **계층 import 규칙** | `main/hash/*`는 main 일반 규칙(네트워크/tls/원격 라이브러리 import 금지 — 화이트리스트는 `main/remote/`만). 도메인 순수(`dupGroup`·`checksumVerdict`·`compare` 확장)는 react/zustand/infra/shared-ipc import 0(타입 전용 `@shared/dto`). ui→app 경유. |
| **계약 단일출처** | 채널=channels.ts·타입=contracts.ts·DTO=dto/index.ts. Main↔Worker 내부=hashProtocol.ts(shared 아님). 모두 W0에서 1회 확정 후 backend/frontend 합의 기준. |
| **동결 예외** | M7 신규 채널은 Should 신기능·워커/Main 백그라운드 작업 = `analyze:scan:*`·`remote:*` 선례 동일 규약(P1 동결 후 추가). §5-PU.1 등재 시그니처 구현. |
| **비파괴** | 기존 `op:*`·`analyze:scan:*`·M6 메타 compare 동작 동치(verify 회귀 0). SharedArrayBuffer 2워드화·OperationManager 큐화는 단발 동치 보장. |
| **ADR-009/011 정합** | 1차 SHA-256·algo 파라미터화(UQ-H1 deferral)·R2 크기 선필터·R4 별도 verify 잡(UQ-H2)·큐 FIFO/전역 동시성/파일 경계 일시정지(UQ-R1/R2/R3 deferral). 은폐 금지(런타임 스모크 🟡 정직). |

---

## 7. 리스크 / 주의

1. **워커 헤드리스 검증 한계(중·정직)**: HashManager·hashWorker의 Worker 메시지/스로틀/terminate 경로는 verify가 직접 못 돌림(ScanManager 동형으로 신뢰·런타임 스모크 🟡). **완화**: 엔진을 fs deps 주입형으로 설계해 핵심 로직은 헤드리스 100% 커버(§5). 워커 결합부는 scanWorker와 1:1 구조 동일성 코드리뷰로 게이트.
2. **OperationManager 큐 확장 회귀(높음)**: op:* 핵심 경로 변경 → 단발 복사/이동/삭제/휴지통/원격·붙여넣기 회귀 위험. **완화**: "큐 미사용 시 기존 동작 정확 동치"를 verify:queue + verify:ops/operations/paste 회귀 0로 게이트. 큐화는 **enqueue→pump 분리만**(실행 로직 자체 무변경) 최소 침습.
3. **일시정지 정합(중)**: 파일 경계 일시정지는 거대 단일 파일이면 그 파일을 마쳐야 멈춤(청크 멈춤은 후속·UQ-R2). SharedArrayBuffer 2워드화 시 기존 취소 인덱스(0) 불변 보장 필수 — verify로 고정. 원격 스트림 pause/resume는 세션 유지(재연결 불요) 확인.
4. **취소 정합(중)**: 해시 잡 취소는 청크/디렉토리/파일 경계 폴링 → 거대 파일 1개 해시 중에는 청크 경계마다 폴링(즉시성 확보). 큐 항목 취소(op:cancel)와 잡 취소(hash:cancel) 식별 체계 분리(operationId vs jobId) — 혼동 금지.
5. **대용량 성능(중)**: SHA-256 초대용량 다수에서 느릴 수 있음(UQ-H1 wasm 고속화는 algo 파라미터로 후속·비차단). R2는 크기 선필터로 불필요 해시 회피(유일 크기 0)·재귀 비교는 SCAN_ITEM_CAP 상한·truncated 정직 표기. 1만+ 항목 비차단·진행률 200ms.
6. **재귀 비교 동명 키 충돌(중)**: M6 `ComparePairDTO`는 `name`만 키 → 재귀에서 다른 폴더 동명 충돌. **완화**: `relPath?` 비파괴 추가·짝지음 키를 relPath 기준으로(재귀 시). M6 단일깊이는 relPath 미사용 동치.
7. **분류 규칙 드리프트(중)**: M6 렌더러 compare.ts와 Main compareEngine이 같은 4상태 분류여야 함(도메인 경계상 직접 공유 불가). **완화**: 분류 판정을 shared/dto 타입만 의존하는 순수 헬퍼로 추출 공유 또는 verify로 양쪽 동치 고정(§2.1·§5).
8. **빌드 워커 엔트리 누락(저·치명적이면 런타임 실패)**: `hashWorker`를 `electron.vite.config.ts` main 워커 엔트리에 등록 안 하면 `join(__dirname,'hashWorker.js')` 미존재. **완화**: W1 첫 작업에 vite 설정 추가 포함·`scanWorker`/`fileOpWorker` 등록부 복제.
9. **순차 구현 순서 의존(저)**: W0 계약을 가장 먼저 확정해야 backend/frontend 병렬 합의 가능. 순서(W0→W1→W2→R2→R3→R4→P1해시) 어기면 shared 파일 머지 충돌. 순서 준수.

---

## 8. 단계별 doc-sync 게이트

각 스코프(W1·W2·R2·R3·R4·P1해시) QA PASS 직후 **doc-sync 게이트 실행**(CLAUDE.md): roadmap §0.5·traceability §1-P/§1-R 🔜→✅, 실 GUI/워커 런타임 동작은 🟡 정직 구분, verify 누계 갱신. **동기화 전 다음 스코프로 넘어가지 않는다.** 스코프 일탈·Must 미구현·문서-코드 충돌은 PM에 상신.
