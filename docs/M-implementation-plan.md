# §M 외부 연계 — 코드베이스 수준 세부 구현 계획 (M1·M2·M3)

> 작성: 테크리드 · 2026-06-08 · 상태: **🔜 미착수(구현 대기)**
> 설계 단일 출처: [ADR-007](./architecture/adr/ADR-007-remote-protocol-and-network-boundary.md) · [system-architecture §5-M](./architecture/system-architecture.md) · [software-architecture §11](./architecture/software-architecture.md) · [directory-structure §5-M·§6](./architecture/directory-structure.md) · [traceability §1-M](./architecture/traceability.md)
> 기획 수용기준: [features §M](./features.md) · [user-stories 에픽12](./user-stories.md)
> Phase 로드맵: [roadmap.md §M(MP0~MP5)](./roadmap.md)
>
> **목적**: 구현팀(devops/backend/frontend/qa)이 바로 착수 가능하도록 ① 만들/고칠 파일 경로, ② 신규 시그니처, ③ 채널별 DTO·zod·검증·에러 모델, ④ 기존 파일 변경 지점, ⑤ 신규 `verify:*` 항목, ⑥ 역할·병렬화를 Phase별로 확정한다. **본 문서는 코드를 생성하지 않는다** — 실행 계획만.
>
> **불변 규칙(전 Phase 공통)**: 기존 코드/문서 비파괴. 설계 계약 임의 변경 금지. 모든 신규 IPC 채널은 기존 단일출처 규약 준수(`shared/ipc/channels.ts` 상수 + `contracts.ts` 타입 + `IpcRequestMap`/`IpcEventMap` + `guard.ts` zod + `isTrustedSender` + `guardPath` + `Result<T,FileOpError>`·throw 0). 선례 6종(`preview:read`·`shell:open-terminal`·`analyze:scan:*`·`fs:watch:*`·`trash:*`·`preview:thumbnail`)을 그대로 踏襲. 비밀은 DTO/로그/Error에서 구조적 배제(ADR-007 ③⑥).

---

## 0. 명명·경로 단일 출처 표(전 Phase 참조)

| 영역 | 신규 파일/심볼 단일 출처 | 비고 |
|---|---|---|
| 채널 상수 | `src/shared/ipc/channels.ts` `CHANNELS.DND_START_DRAG`·`CLIPBOARD_WRITE_FILES`/`READ_FILES`/`HAS_FILES`·`REMOTE_*` | 기존 `CHANNELS` 객체에 비파괴 추가 |
| 채널 계약 타입 | `src/shared/ipc/contracts.ts` Req/Res 인터페이스 + `IpcRequestMap`/`IpcEventMap` 항목 | 동일 |
| DTO | `src/shared/dto/index.ts` `RemoteProfileDTO`·`RemoteEntryDTO`(=`FileEntryDTO` 재사용)·`RemoteErrorCode`·`ClipboardEffectKind` | `RemoteError`는 `FileOpError`의 `code` 유니온 확장(별도 타입 아님 — ADR-007 결정⑥ 직렬화 규약) |
| zod | `src/main/ipc/guard.ts` `zDndStartDragReq`·`zClipboardWriteFilesReq`·`zRemote*Req` | 기존 zod 블록 하단 추가 |
| OS 모듈 | `src/main/os/dragdrop.ts`·`shellClipboard.ts`·`credentials.ts` | startDrag·CF_HDROP·safeStorage |
| 원격 특권 | `src/main/remote/{RemoteService,SftpAdapter,FtpAdapter,RemoteSessionManager,remoteTransfer}.ts` | **유일 네트워크 import 디렉토리**(ESLint 예외) |
| 원격 영속 | `src/main/persistence/RemoteProfileStore.ts` | `profiles.json`·`known_hosts.json`(비밀 제외) |
| preload | `src/preload/api.ts` `ExplorerApi.dnd`·`clipboard`(확장)·`remote` | `invoke`/`subscribe` 헬퍼 재사용 |
| 도메인 | `src/renderer/domain/rules/transferRoute.ts`·`domain/entities`(확장) | 순수 |
| usecase/store | `src/renderer/app/usecases/{externalDrag,clipboardExternal,remote}.ts`·`app/stores/remoteSlice.ts` | |
| UI | `src/renderer/ui/remote/*`·`ui/dnd`(확장) | |

> **확인 필요 (CN-1)**: directory-structure §6 트리는 `clipboard.handlers.ts`를 "기존 확장"으로 표기. 본 계획은 **기존 `src/main/ipc/clipboard.handlers.ts`에 신규 3채널 핸들러를 추가(확장)**하고 기존 `copy-files`/`cut-files`/`paste-target`/`read` 핸들러·채널·`fileClipboard.ts`는 **삭제하지 않고 보존**한다(비파괴). 렌더러 호출부만 신규 채널로 전환(MP2 §전환 전략). → PM/reviewer 확인.

---

## MP0 — 골격 · 의존성 · ESLint 화이트리스트 (선행, 단독)

### ① 만들/고칠 파일
- **신규 디렉토리(빈 스텁)**: `src/main/remote/`(README 또는 `.gitkeep`), `src/renderer/ui/remote/`.
- **고침** `package.json` `dependencies`: `ssh2-sftp-client`(Apache-2.0)·`basic-ftp`(MIT) 추가. (자격증명·CF_HDROP·드래그는 Electron 내장 — 신규 의존성 0.)
- **고침** `.eslintrc.cjs` main/preload override `no-restricted-imports`.

### ② ESLint 변경 지점(ADR-007 ②·directory-structure §5-M, 정확한 작업)
`.eslintrc.cjs`의 `overrides` 배열 중 `files: ['src/main/**/*.ts', 'src/preload/**/*.ts']` 블록:
- **(2-a) 기존 8개 유지**(무변경): `node:http`/`http`·`node:https`/`https`·`net`/`node:net`·`dgram`/`node:dgram`.
- **(2-b) 신규 차단 추가**: `paths`에 `node:tls`·`ssh2`·`ssh2-sftp-client`·`basic-ftp` 4개 추가(각 message에 "원격 네트워크 import는 `src/main/remote/`에만 허용" 명시). `node:tls`가 핵심(basic-ftp FTPS가 내부적으로 `node:tls` 사용).
- **(2-c) `src/main/remote/**` 예외 override 신규 추가**: `overrides` 배열에 **새 항목** `{ files: ['src/main/remote/**/*.ts'], rules: { 'no-restricted-imports': ['error', { paths: [ /* renderer만 금지 유지 */ ], patterns: [{ group: ['**/renderer/**','@renderer/*'], message: ... }] }] } }`. 즉 remote/ 안에서는 8개+신규4개 네트워크/TLS/라이브러리 차단을 **해제**하되 renderer import 금지는 유지. ESLint override는 후순위 매칭이 우선이므로 main 광역 블록 뒤에 두면 remote/만 완화된다.

> **검증 포인트(ESLint 회귀)**: ① `src/main/remote/` **밖**에서 `node:tls`/원격 라이브러리 import 시 lint 에러. ② `src/main/remote/` **안**에서는 통과. ③ 기존 8개 차단이 remote/ 밖에서 여전히 에러. ④ renderer/domain/shared 네트워크 금지 불변.

### ③ DoD
- `npm install` 성공(ssh2 가속 모듈 optional 실패해도 순수 JS 모드 설치 완료 — `npm config get` 로 optional 빌드 실패 무해 확인). `npm run lint` 0 에러. `npm run typecheck` 0(빈 디렉토리·신규 의존성 타입 해소). 기존 verify 누계 회귀 0.

### ④ 신규 verify
- `verify:eslint-remote`(신규, MP0): `.eslintrc.cjs`를 직접 import해 **(a) main 광역 블록에 신규 4개 차단이 존재**, **(b) `src/main/remote/**` override가 존재하고 네트워크 paths를 비움(허용)**, **(c) 기존 8개 유지**를 정적 단언(파일 파싱·구조 검사·헤드리스). 양식: 기존 `verify-*.ts`(pass/fail 카운터·esbuild 번들→node).

### ⑤ 역할 · 병렬
- **devops 단독**(선행). 완료 전까지 backend의 remote/ 코드 작성 불가(ESLint 예외 미존재 시 lint 실패) → **MP0는 MP4보다 반드시 먼저**. MP1과는 병렬 가능(MP1은 shared만 건드림).

---

## MP1 — IPC 계약 동결 (인터페이스 먼저 · backend/frontend 병렬 출발선)

> **원칙: 인터페이스 먼저.** §M 전 채널의 채널상수·계약타입·DTO·zod를 한 번에 동결해 backend(MP2~MP4)와 frontend(MP5)가 모킹 위에서 병렬 착수하게 한다. 핸들러 실구현은 각 Phase. 선례: P1 "전 채널 동결" + 이후 Phase별 핸들러.

### ① 만들/고칠 파일
- `src/shared/ipc/channels.ts`(CHANNELS 추가 + EVENT_CHANNELS 추가)
- `src/shared/ipc/contracts.ts`(Req/Res 타입 + IpcRequestMap/IpcEventMap 항목)
- `src/shared/dto/index.ts`(RemoteProfileDTO·RemoteErrorCode 등 + FileOpErrorCode 확장)
- `src/main/ipc/guard.ts`(zod 스키마 — 핸들러 구현은 후속 Phase, **스키마는 여기서 동결**)
- `src/preload/api.ts`(ExplorerApi 타입 + 호출부 래퍼 — invoke/subscribe만, 동결)

### ② 신규 채널 상수(`channels.ts` CHANNELS에 추가)
```
// ── dnd:* 외부 드래그 (M1, 신규 §M) ──
DND_START_DRAG: 'dnd:start-drag',                 // invoke → Result<{started:boolean}>

// ── clipboard:* CF_HDROP 양방향 (M2, 신규 §M — 기존 텍스트 폴백 채널과 병존) ──
CLIPBOARD_WRITE_FILES: 'clipboard:write-files',   // invoke → Result<void>
CLIPBOARD_READ_FILES:  'clipboard:read-files',    // invoke → Result<ClipboardFilesReadRes>
CLIPBOARD_HAS_FILES:   'clipboard:has-files',     // invoke → Result<{has:boolean}>

// ── remote:* FTP/SFTP (M3, 신규 §M) ──
REMOTE_CRED_SAVE:   'remote:cred:save',           // invoke → Result<void>
REMOTE_CRED_HAS:    'remote:cred:has',            // invoke → Result<{has:boolean}>
REMOTE_CRED_DELETE: 'remote:cred:delete',         // invoke → Result<void>
REMOTE_PROFILE_LIST:   'remote:profile:list',     // invoke → Result<RemoteProfileDTO[]>
REMOTE_PROFILE_UPSERT: 'remote:profile:upsert',   // invoke → Result<RemoteProfileDTO>
REMOTE_PROFILE_DELETE: 'remote:profile:delete',   // invoke → Result<void>
REMOTE_CONNECT:    'remote:connect',              // invoke → Result<RemoteConnectRes, RemoteError>
REMOTE_DISCONNECT: 'remote:disconnect',           // invoke → Result<void>
REMOTE_HOST_KEY:      'remote:host-key',          // 푸시 evt (TOFU 확인 요청)
REMOTE_SESSION_ERROR: 'remote:session-error',     // 푸시 evt (세션 격리 오류)
REMOTE_LIST:   'remote:list',                     // invoke → Result<{entries:FileEntryDTO[]}, RemoteError>
REMOTE_STAT:   'remote:stat',                     // invoke → Result<FileEntryDTO, RemoteError>
REMOTE_MKDIR:  'remote:mkdir',                    // invoke → Result<void, RemoteError>
REMOTE_RENAME: 'remote:rename',                   // invoke → Result<void, RemoteError>
REMOTE_DELETE: 'remote:delete',                   // invoke → Result<void, RemoteError>
REMOTE_DOWNLOAD: 'remote:download',               // invoke → Result<{operationId}, RemoteError>
REMOTE_UPLOAD:   'remote:upload',                 // invoke → Result<{operationId}, RemoteError>
```
- **EVENT_CHANNELS 추가**: `CHANNELS.REMOTE_HOST_KEY`, `CHANNELS.REMOTE_SESSION_ERROR`(단방향 푸시). 나머지는 invoke.
- **op:* 재사용**: 다운로드/업로드 진행률·충돌·완료·취소는 **신규 채널 무추가** — 기존 `OP_PROGRESS`/`OP_CONFLICT`/`OP_DONE`/`OP_CANCEL` 재사용(system-architecture §5-M.1). `remote:download/upload`는 `operationId`만 반환하고 렌더러가 기존 op 브리지로 상관.

### ③ DTO(`shared/dto/index.ts` 추가)
```ts
// ── 원격 프로필 (비밀 제외 메타만 — ADR-007 ③) ──
export type RemoteProtocol = 'ftp' | 'ftps' | 'sftp'
export type RemoteAuthMethod = 'password' | 'privateKey'   // SFTP만 privateKey
export interface RemoteProfileDTO {
  readonly id: string                  // 안정 키. credential key = `remote:<id>`
  readonly name: string                // 표시 라벨
  readonly protocol: RemoteProtocol
  readonly host: string
  readonly port: number                // ftp 21 / sftp 22 기본(프론트 제안·검증은 backend)
  readonly username: string
  readonly authMethod: RemoteAuthMethod
  // ⚠ 비밀(password/passphrase/privateKey 본문) 필드 없음 — 구조적 배제
}
// ── 원격 오류 코드 (FileOpErrorCode 확장 — 별도 타입 아님, 직렬화 동일) ──
//   ADR-007 결정⑥: RemoteError = FileOpError. code 유니온만 확장.
//   기존 FileOpError 소비측은 unknown code를 generic 처리(하위호환).
```
- **`FileOpErrorCode` 확장**(`shared/dto/index.ts` 기존 유니온에 추가): `'EAUTH'|'ETIMEDOUT'|'ECONNRESET'|'EHOSTUNREACH'|'EHOSTKEY'|'EUNSUPPORTED'`. (기존 `EACCES`·`ENOENT`는 재사용.) → `RemoteError`는 타입 별칭 `export type RemoteError = FileOpError`로 두되, 본문은 동일 구조. **비밀 필드 없음**(컴파일 타임 보장).
- **`RemoteEntry`**: 원격 목록 항목은 **기존 `FileEntryDTO` 재사용**(software-architecture §11.1 — "원격 entries도 FileEntryDTO로 정규화"). 신규 DTO 불필요. 단 `path`는 원격 절대경로, `attrs.symlink`로 심볼릭 표시.

### ④ 채널별 Req/Res 계약(`contracts.ts`)
```ts
// M1 dnd:*
export interface DndStartDragReq { readonly paths: string[]; readonly iconHint?: 'single'|'multi'|'folder' }
export interface DndStartDragRes { readonly started: boolean }
// M2 clipboard:* (CF_HDROP)
export interface ClipboardWriteFilesReq { readonly paths: string[]; readonly effect: 'copy'|'cut' }
export interface ClipboardFilesReadRes { readonly paths: string[]; readonly effect: 'copy'|'move'|'none' }
export interface ClipboardHasFilesRes { readonly has: boolean }
// M3 remote:*
export interface RemoteCredSaveReq { readonly profileId: string; readonly secret: { kind:'password'|'passphrase'|'privateKey'; value: string } }
export interface RemoteCredHasReq { readonly profileId: string }
export interface RemoteCredDeleteReq { readonly profileId: string }
export interface RemoteProfileUpsertReq { readonly profile: RemoteProfileDTO }
export interface RemoteProfileDeleteReq { readonly profileId: string }
export interface RemoteConnectReq {
  readonly profile: RemoteProfileDTO
  readonly secret?: { kind:'password'|'passphrase'|'privateKey'; value: string }  // 미저장 1회용
  readonly hostKeyDecision?: 'accept'|'reject'                                     // TOFU 회신
}
export interface RemoteConnectRes { readonly sessionId: string; readonly encrypted: boolean }
export interface RemoteListReq { readonly sessionId: string; readonly path: string }
export interface RemoteStatReq { readonly sessionId: string; readonly path: string }
export interface RemoteMkdirReq { readonly sessionId: string; readonly path: string; readonly name: string }
export interface RemoteRenameReq { readonly sessionId: string; readonly path: string; readonly newName: string }
export interface RemoteDeleteReq { readonly sessionId: string; readonly path: string }
export interface RemoteDownloadReq { readonly sessionId: string; readonly remotePaths: string[]; readonly destDir: string; readonly conflictPolicy?: ConflictPolicy }
export interface RemoteUploadReq { readonly sessionId: string; readonly localPaths: string[]; readonly remoteDir: string; readonly conflictPolicy?: ConflictPolicy }
export interface RemoteDisconnectReq { readonly sessionId: string }
// 푸시 evt
export interface RemoteHostKeyEvt { readonly connectId: string; readonly fingerprint: string; readonly algo: string; readonly status: 'unknown'|'changed' }
export interface RemoteSessionErrorEvt { readonly sessionId: string; readonly error: RemoteError }
```
- **IpcRequestMap/IpcEventMap 항목 추가**: 위 전 채널 매핑(invoke는 RequestMap, host-key/session-error는 EventMap). `res`의 에러 타입은 remote 연결/탐색/전송은 `Result<T, RemoteError>`(= `Result<T, FileOpError>`와 동일 직렬화), cred/profile은 `Result<T, FileOpError>`.

### ⑤ zod 스키마(`guard.ts`, MP1 동결 — 핸들러 구현은 후속)
- `zDndStartDragReq = z.object({ paths: z.array(zPath).min(1), iconHint: z.enum(['single','multi','folder']).optional() })`
- `zClipboardWriteFilesReq = z.object({ paths: z.array(zPath).min(1), effect: z.enum(['copy','cut']) })`
- (read-files/has-files는 인자 없음 → sender 검증만)
- `zRemoteProtocol = z.enum(['ftp','ftps','sftp'])`, `zRemoteAuthMethod = z.enum(['password','privateKey'])`
- `zRemoteProfileDTO = z.object({ id: z.string().min(1), name: z.string().min(1).max(120), protocol: zRemoteProtocol, host: z.string().min(1).max(255), port: z.number().int().min(1).max(65535), username: z.string().max(255), authMethod: zRemoteAuthMethod }).strict()` — **비밀 필드 거부**(strict).
- `zRemoteSecret = z.object({ kind: z.enum(['password','passphrase','privateKey']), value: z.string().min(1).max(100_000) })` (privateKey 본문 여유 상한)
- `zRemoteCredSaveReq`·`zRemoteCredHasReq`·`zRemoteCredDeleteReq`·`zRemoteProfileUpsertReq`·`zRemoteProfileDeleteReq`·`zRemoteConnectReq`(secret optional·hostKeyDecision enum optional)·`zRemoteListReq`·`zRemoteStatReq`·`zRemoteMkdirReq`·`zRemoteRenameReq`·`zRemoteDeleteReq`·`zRemoteDownloadReq`(remotePaths min1·destDir zPath)·`zRemoteUploadReq`(localPaths min1·remoteDir)·`zRemoteDisconnectReq`(sessionId min1).
- **원격 경로 검증 주의**: `sessionId`·원격 `path`는 **로컬 `guardPath`(win32 normalizePath)를 쓰지 않는다**(POSIX 원격 경로). 원격 경로 정규화·traversal 방어는 `RemoteService`/어댑터에서 **POSIX 기준**으로 별도 수행(MP4 §보안). zod는 형태(min1·문자열)만. **로컬 도착지(`destDir`)·로컬 소스(`localPaths`)는 기존 `guardPath`로 검증**(MP4 핸들러).

### ⑥ preload(`api.ts`)
- `ExplorerApi`에 `dnd: { startDrag(req): Promise<Result<DndStartDragRes>> }`, `clipboard` 확장(`writeFiles`·`readFiles`·`hasFiles` 추가, 기존 copyFiles/cutFiles/pasteTarget/read 보존), `remote: { credSave/credHas/credDelete/profileList/profileUpsert/profileDelete/connect/disconnect/list/stat/mkdir/rename/delete/download/upload + onHostKey/onSessionError 구독 }`. 전부 `invoke`/`subscribe` 헬퍼 재사용.

### ⑦ DoD
- `npm run typecheck` 0(Main·Preload·Renderer 동일 타입 컴파일). `npm run lint` 0. **frontend가 모킹 위에서 MP5 UI 선행 가능**(타입 존재). backend가 MP2~MP4 핸들러를 동결 타입에 맞춰 구현 가능. 기존 채널·DTO·핸들러 무변경(비파괴 — 기존 verify 누계 회귀 0).

### ⑧ 신규 verify
- `verify:m-contract`(신규): channels/contracts/dto/guard를 import해 **(a) 신규 채널 상수 존재·중복 없음**, **(b) IpcRequestMap/IpcEventMap 키와 CHANNELS 정합**(누락/오타 0), **(c) zod 스키마가 유효/무효 샘플을 기대대로 통과/거부**(특히 `zRemoteProfileDTO.strict()`가 비밀 필드 주입을 거부), **(d) RemoteProfileDTO 타입에 비밀 필드 부재**(구조 검사) 단언.

### ⑨ 역할 · 병렬
- **backend 주도 + frontend 공동 합의**(P1 선례). qa는 계약 경계·DTO 비밀배제 교차검증. MP0와 병렬 가능. **MP1 통과가 MP2~MP5 전부의 선행 조건.**

---

## MP2 — M2 클립보드 CF_HDROP 양방향 (의존성 0 · 먼저)

> 신규 의존성 0(Electron clipboard buffer). M1과 함께 가장 단순·저위험 → 원격(MP4)보다 먼저. system-architecture §5-M.1 M2·ADR-007 결정⑦·§통합 규칙.

### ① 만들/고칠 파일
- **신규** `src/main/os/shellClipboard.ts` — CF_HDROP·Preferred DropEffect 바이트 조립/파싱.
- **고침** `src/main/ipc/clipboard.handlers.ts` — 신규 3핸들러 추가(기존 4핸들러 보존).
- **고침** `src/main/ipc/guard.ts` — (MP1에서 이미 동결, 핸들러가 import).
- **신규** `scripts/verify-clipboard-hdrop.ts` + `scripts/stub-electron-clipboard.ts`.
- **고침(frontend, MP2 후반)** `src/renderer/app/usecases/clipboardExternal.ts`(신규)·기존 clipboard usecase 호출부 전환.

### ② `shellClipboard.ts` 시그니처
```ts
// DROPFILES 구조체 + UTF-16LE 더블널 종단 경로 리스트 조립/파싱(Windows 표준 레이아웃).
export function writeFilesToClipboard(paths: string[], effect: 'copy'|'cut'): void
//   clipboard.writeBuffer('CF_HDROP', dropfilesBuffer) + writeBuffer('Preferred DropEffect', effectBuffer)
//   + clipboard.writeText(paths.join('\r\n')) 병기(외부 텍스트 호환·기존 폴백 계승)
export function readFilesFromClipboard(): { paths: string[]; effect: 'copy'|'move'|'none' }
//   clipboard.has('CF_HDROP') ? readBuffer 파싱 : { paths:[], effect:'none' }
//   Preferred DropEffect(DWORD): DROPEFFECT_MOVE(2)→'move', DROPEFFECT_COPY(1)/기타→'copy'
export function hasFilesOnClipboard(): boolean   // clipboard.has('CF_HDROP')
// ── 내부(테스트 노출) ──
export function buildDropfiles(paths: string[]): Buffer       // DROPFILES 헤더(20B)+wide 경로+더블널
export function parseDropfiles(buf: Buffer): string[]         // 방어적: 길이·pFiles offset·널종단·UTF-16 검증
export function buildPreferredDropEffect(effect: 'copy'|'cut'): Buffer   // 4바이트 LE DWORD
export function parsePreferredDropEffect(buf: Buffer | null): 'copy'|'move'|'none'
```
- **방어적 파싱(SR8·ADR-007 ⑦)**: `parseDropfiles`는 buffer 길이 < 20, pFiles offset 범위 초과, fWide=false(ANSI), 더블널 미발견, 홀수 바이트(UTF-16 정렬 깨짐) 시 **빈 배열 반환(throw 0)**. 잘못된 외부 입력에 안전.
- **헤드리스 주입**: `electron` clipboard를 모듈 최상위 import하되, 조립/파싱 순수함수(`buildDropfiles`/`parseDropfiles`/`build/parsePreferredDropEffect`)는 clipboard 비의존 → verify가 직접 호출(stub-electron-clipboard로 writeBuffer/readBuffer/has 스텁).

### ③ 핸들러(`clipboard.handlers.ts` 확장)
```
clipboard:write-files → handleGuarded(zClipboardWriteFilesReq):
   각 path guardPath(로컬·정규화·상위이탈 차단) → shellClipboard.writeFilesToClipboard(paths, effect) → ok()
clipboard:read-files  → sender 검증만 → shellClipboard.readFilesFromClipboard()
   읽은 paths 각각 **존재·정규화 재검증(외부 입력 불신·ADR-007 ⑥)** → 존재 항목만 반환. effect 그대로.
clipboard:has-files   → sender 검증만 → { has: shellClipboard.hasFilesOnClipboard() }
```
- 기존 `copy-files`/`cut-files`/`paste-target`/`read`·`fileClipboard.ts`는 **보존**(렌더러 전환 완료 후 후속 정리 — 본 1차는 비파괴 병존).

### ④ 에러 모델
- write: guardPath 실패 → `ESECURITY`/`EINVAL`. clipboard 쓰기 예외 → `EUNKNOWN`(toFileOpError). read: 비파일 클립보드 → 정상 `{paths:[],effect:'none'}`(에러 아님). 외부 경로 존재 안 함 → 해당 항목 제외(부분).

### ⑤ frontend 전환(MP2 후반 — frontend)
- **신규** `usecases/clipboardExternal.ts`: `copyFiles(paths)`→`api.clipboard.writeFiles({paths,effect:'copy'})`, `cutFiles`→effect:'cut', `paste(destDir)`→`api.clipboard.readFiles()`로 paths·effect 수신 후 **기존 `api.op.start({kind: effect==='move'?'move':'copy', sources:paths, destDir})`** 호출(D4 충돌·E4 진행률 기존 경로 그대로). `hasFiles()`로 붙여넣기 활성 판정.
- **변경 지점**: 기존 `Ctrl+C/X/V` commandId(`file.copy/cut/paste`)가 가리키는 usecase를 `clipboardExternal`로 라우팅(commandBus). 잘라내기 흐림 표시: 시스템 클립보드 변화 감지(focus/poll 시 `hasFiles`·effect 재조회)로 흐림 해제(ADR-007 ⑦-3).

### ⑥ DoD
- write→read 왕복 paths·effect 보존. cut→DropEffect=Move 바이트 정확. 비파일 클립보드 read→`none`. 방어적 파싱이 손상 buffer에 throw 0. B4 내부 동작 무변경(수용기준 features §M2). typecheck/lint 0.

### ⑦ 신규 verify
- `verify:clipboard-hdrop`(신규): ① DROPFILES 라운드트립(단일/다중/유니코드 경로명) ② Preferred DropEffect copy/cut/Move 매핑 ③ 방어적 파싱 매트릭스(짧은 buffer·offset 초과·ANSI·홀수 길이·더블널 누락→빈 배열 throw 0) ④ write→read 왕복 effect 보존(stub clipboard 경유). 양식: 기존 verify(pass/fail·esbuild·electron 별칭 stub).

### ⑧ 역할 · 병렬
- backend(shellClipboard·핸들러)와 frontend(clipboardExternal·commandBus 라우팅)는 MP1 계약 동결 후 **병렬**. qa: CF_HDROP 라운드트립·외부 입력 불신 검증. **MP3와 병렬 가능**(서로 무관).

---

## MP3 — M1 외부 D&D 복사 (의존성 0)

> 신규 의존성 0(`webContents.startDrag`). MP2와 병렬. ADR-007 결정⑦·system-architecture F14.

### ① 만들/고칠 파일
- **신규** `src/main/os/dragdrop.ts` — startDrag Main 전용 래퍼.
- **신규** `src/main/ipc/dnd.handlers.ts` — `dnd:start-drag` 핸들러.
- **고침** `src/main/ipc/index.ts` — `registerDndHandlers()` 등록.
- **신규(frontend)** `src/renderer/app/usecases/externalDrag.ts`·`ui/dnd`(확장).
- **신규** `scripts/verify-dnd.ts`(+ electron stub).

### ② `dragdrop.ts` 시그니처
```ts
import type { WebContents } from 'electron'
export interface StartDragResult { readonly started: boolean }
//   검증된 로컬 경로 목록만 받아 wc.startDrag({ files, icon }). 원격 경로·미존재·권한거부는 거부(상위 핸들러에서).
export function startExternalDrag(wc: WebContents, paths: string[], iconHint?: 'single'|'multi'|'folder'): Result<StartDragResult>
//   icon: nativeImage(드래그 고스트). 단일=파일아이콘(getFileIcon 재사용 가능)·다중/폴더=기본 아이콘.
//   startDrag는 동기 호출이며 즉시 반환. 실패(빈 files·wc destroyed) → ok({started:false}) 또는 err.
```
- **icon 처리**: Electron `startDrag`는 `icon`(빈 NativeImage 불가) 필수. iconHint로 기본 아이콘 매핑(기존 `os/icon.ts` getFileIcon 재사용 검토 — **확인 필요 CN-2**: getFileIcon은 dataURL 반환, startDrag는 NativeImage 필요 → `nativeImage.createFromDataURL` 변환 또는 번들 리소스 아이콘 사용. backend가 1픽셀 폴백 금지(startDrag가 거부) → 최소 16px 리소스 아이콘 준비).

### ③ 핸들러(`dnd.handlers.ts`)
```
dnd:start-drag → handleGuarded(zDndStartDragReq):
  1) 각 path guardPath(정규화·상위이탈)
  2) 로컬 FS 한정: 'sftp://'·'ftp://'·'ftps://' prefix 거부 → ESECURITY(원격 항목 외부 드래그 불가·features §M1)
  3) 존재·접근 확인(fsp.access) — 미존재 거부
  4) startExternalDrag(event.sender, paths, iconHint) → Result<{started}>
```
- **분기**: 도착지가 앱 내부 패널이면 렌더러가 `dnd:start-drag`를 **호출하지 않고** 기존 A3 D&D(op:start) 경로 사용(system-architecture F14 Note). 분기 판정은 렌더러 드롭 타겟(externalDrag usecase).

### ④ 에러 모델
- 빈 paths→zod EINVAL. 원격 prefix→ESECURITY. 미존재→ENOENT. wc destroyed→`ok({started:false})`. startDrag 예외→EUNKNOWN.

### ⑤ frontend(`externalDrag.ts`·ui/dnd)
- `FileListView` 드래그 시작 시: 드롭 타겟이 **창 바깥(외부)**으로 판정되면 `api.dnd.startDrag({paths, iconHint})` 위임. 내부 패널이면 기존 A3. **선택 항목 중 원격(location.kind==='remote')은 제외**(로컬만 — features §M1). 시각 피드백: 복사 커서/고스트.
- **도메인**: `domain/rules/transferRoute.ts`(MP1/MP4 공유)에서 "외부 도착=복사 고정" 판정.

### ⑥ DoD
- 로컬 단일/다중/폴더 외부 드래그 시작(startDrag 호출). 원격 경로·미존재 거부. 내부 드롭은 A3 유지(분기). 외부 노출=검증된 파일 경로뿐(ADR-005·수용기준 features §M1). typecheck/lint 0.

### ⑦ 신규 verify
- `verify:dnd`(신규): 핸들러 로직 단위 — ① 원격 prefix 경로 거부(ESECURITY) ② 빈 paths 거부 ③ 미존재 경로 거부(ENOENT) ④ 유효 로컬 경로 통과 시 startExternalDrag 호출(stub wc.startDrag 스파이로 files 인자 확인) ⑤ guardPath 상위이탈 차단. 양식: electron stub(startDrag 스파이)·esbuild·pass/fail.
- (런타임 🟡): 실제 외부 앱 드롭·고스트 이미지는 GUI 스모크 권장.

### ⑧ 역할 · 병렬
- backend(dragdrop·핸들러)·frontend(externalDrag·드롭 분기). MP2와 병렬. qa: 외부/내부 분기 진리표·원격 제외·보안.

---

## MP4 — M3 RemoteService · safeStorage · 원격 전송 (신규 라이브러리·보안 표면 — 뒤)

> 신규 의존성 2종·네트워크 경계·자격증명·신뢰경계. 가장 크고 위험 → 마지막 backend Phase. **MP0(ESLint 예외) 선행 필수.** ADR-007 ①~⑥·system-architecture F16.

### ① 만들/고칠 파일
- **신규** `src/main/os/credentials.ts`(safeStorage/DPAPI).
- **신규** `src/main/persistence/RemoteProfileStore.ts`(profiles.json·known_hosts.json).
- **신규** `src/main/remote/RemoteService.ts`(인터페이스)·`SftpAdapter.ts`·`FtpAdapter.ts`·`RemoteSessionManager.ts`·`remoteTransfer.ts`.
- **신규** `src/main/ipc/remote.handlers.ts`.
- **고침** `src/main/ipc/index.ts`(`registerRemoteHandlers()`).
- **고침** `src/main/operations/OperationManager.ts` — 원격 전송 진행률 연동 진입점(아래 ④).
- **신규** `scripts/verify-credentials.ts`·`verify-remote.ts`·`verify-remote-trust.ts`(+ stub).

### ② `credentials.ts` 시그니처(ADR-007 ③·D6)
```ts
//  safeStorage.encryptString → userData/remote/credentials.enc 원자적 쓰기. 평문 금지.
export interface CredentialStore {
  isAvailable(): boolean                                  // safeStorage.isEncryptionAvailable()
  save(profileId: string, secret: string): Promise<Result<void>>     // DPAPI 암호화 저장(게이트: 사용자 "저장")
  load(profileId: string): Promise<Result<string|null>>  // 복호화(연결 수립 시점에만·메모리 한정)
  has(profileId: string): Promise<Result<{has:boolean}>>
  delete(profileId: string): Promise<Result<void>>
}
export const credentialStore: CredentialStore
//  헤드리스 주입: safeStorage 래퍼(encryptFn/decryptFn)·파일 IO를 옵션으로 주입(verify가 스텁).
//  isAvailable()=false면 save가 거부(EUNSUPPORTED) — 평문 폴백 금지(메모리 전용 모드 안내).
```
- **저장 포맷**: `credentials.enc` = `{ [profileId]: base64(encryptedBytes) }` JSON(암호문만·평문 아님). `atomic.ts`(readJsonSafe/writeJsonAtomic) 재사용. **단 비밀이므로 `atomic.ts` 헤더 "비밀 저장 금지"와 충돌** → **확인 필요 CN-3**: credentials.enc는 암호문이라 atomic.ts의 "평문 세션/설정만" 주석과 모순 아님(암호문 저장은 허용). atomic 헤더에 "암호문은 예외(credentials.ts 경유)" 메모 추가하거나 credentials.ts 전용 원자 쓰기 사용 → reviewer 확인.

### ③ `RemoteProfileStore.ts` 시그니처
```ts
export interface RemoteProfileStore {
  list(): Promise<RemoteProfileDTO[]>                     // profiles.json(비밀 제외)
  upsert(p: RemoteProfileDTO): Promise<RemoteProfileDTO>  // name 새니타이즈·id 안정
  delete(id: string): Promise<void>                       // 연동: credentialStore.delete(id)·known_hosts 정리
  getKnownHostKey(host: string, port: number): Promise<string|undefined>   // known_hosts.json 지문
  setKnownHostKey(host: string, port: number, fingerprint: string): Promise<void>
}
```
- `profiles.json`·`known_hosts.json`은 **비밀 아님**(평문 OK·atomic.ts 정상 사용). 무결성은 userData OS 파일권한 위임(ADR-007 ⑥-4 무결성 가정).

### ④ `RemoteService`·어댑터·세션·전송
```ts
// RemoteService.ts — 어댑터 공통 인터페이스(상위는 이것만 본다)
export interface RemoteService {
  connect(opts: ConnectOpts): Promise<Result<{sessionId:string; encrypted:boolean}, RemoteError>>
  disconnect(sessionId: string): Promise<Result<void>>
  list(sessionId: string, path: string): Promise<Result<{entries: FileEntryDTO[]}, RemoteError>>
  stat(sessionId: string, path: string): Promise<Result<FileEntryDTO, RemoteError>>
  mkdir/rename/delete(...): Promise<Result<void, RemoteError>>
}
// SftpAdapter.ts (ssh2-sftp-client): hostVerifier(TOFU)·password/privateKey 인증·list/get/put/mkdir/rename/delete
// FtpAdapter.ts (basic-ftp): FTP/FTPS(secure: 'implicit'|true)·평문 FTP 비암호화 신호(encrypted=false)
// RemoteSessionManager.ts: sessionId별 연결 수명·격리. 한 세션 throw 0(끊김/타임아웃→remote:session-error 푸시·해당 세션만).
//   onHostKeyPrompt → remote:host-key 푸시 → 재연결(hostKeyDecision) 흐름.
// remoteTransfer.ts: download/upload 스트림. .part 임시명→완료 시 원자 rename(ADR-007 ⑥-7).
//   진행률은 OperationManager(200ms 스로틀·AbortController) 재사용. op:progress/op:done 푸시.
```
- **ssh2 가속 optional**(ADR-007 ④): `ssh2-sftp-client` 설치 시 `cpu-features`/`*-crypto` 실패 무해(순수 JS). 패키징 영향 0.

### ⑤ 핸들러(`remote.handlers.ts`) — 채널별 검증·에러
- cred:save → zod + `credentialStore.isAvailable()` 게이트 + save. **응답에 secret 미수록**(void). cred:has/delete 동일.
- profile:list/upsert/delete → zod(strict 비밀배제) + store. upsert가 name 새니타이즈.
- connect → zod. secret 있으면 1회용, 없으면 credentialStore.load(profileId). hostKeyDecision 흐름. → `{sessionId,encrypted}` 또는 RemoteError. **응답·로그·Error에 비밀 미수록**(ADR-007 ⑥-6).
- list/stat/mkdir/rename/delete → zod + sessionId 유효성(SessionManager) + **원격 path POSIX 정규화·traversal 방어(어댑터)**. RemoteError 사유 전파.
- download → zod + **로컬 destDir `guardPath`** + remotePaths 형태 검증. remoteTransfer 시작 → `{operationId}`. **로컬 도착지 하위 이탈 차단(Zip Slip·ADR-007 ⑥-1)**·파일명 새니타이즈(⑥-3)·심볼릭 미추종(⑥-2).
- upload → zod + **로컬 localPaths `guardPath`** + remoteDir. remoteTransfer.

### ⑥ OperationManager 변경 지점(④ 연동)
- `OperationManager`에 원격 전송 진입점 추가: 기존 `start()`는 로컬 copy/move/delete/trash. 원격은 `remoteTransfer.ts`가 operationId를 발급하고 **동일 `op:progress`/`op:done` 푸시 경로·200ms 스로틀·`op:cancel`(AbortSignal)**를 재사용하도록, OperationManager에 `registerExternalOperation(operationId, {onCancel})` 또는 `trackRemote(...)` 메서드를 추가(기존 ActiveOp 맵에 원격 op 등록). **기존 로컬 op 로직 무변경**(비파괴 추가). → **확인 필요 CN-4**: OperationManager 재사용 방식(전용 메서드 추가 vs remoteTransfer가 직접 op 이벤트 푸시)은 backend 세부 설계·reviewer 검증 포인트.

### ⑦ 에러 모델(RemoteError = FileOpError code 확장)
- `EAUTH`(인증 실패·재입력 유도)·`ETIMEDOUT`·`ECONNRESET`(끊김)·`EHOSTUNREACH`·`EHOSTKEY`(호스트키 미신뢰/변경)·`EUNSUPPORTED`(프로토콜 미지원 동작)·`EACCES`·`ENOENT`. **메시지에 비밀 절대 미수록**. unknown code는 렌더러가 generic 폴백.

### ⑧ DoD
- 프로필 CRUD·자격증명 safeStorage 저장/복호화(평문 0)·SFTP 비밀번호/키 인증·호스트키 TOFU(unknown/changed 경고·known_hosts 저장)·FTP/FTPS 연결·평문 FTP 비암호화 신호(encrypted=false)·원격 list/stat/조작·다운로드/업로드(.part 원자 rename·진행률 op:* 재사용·취소)·세션 격리(한 세션 오류가 다른 패널·Main 비중단)·**전 응답/로그/Error 비밀 0**·원격 응답 불신 검증(traversal/심볼릭/파일명/도착지 이탈). typecheck/lint 0.

### ⑨ 신규 verify(헤드리스 — 네이티브/네트워크 미경유 주입)
- `verify:credentials`(신규): safeStorage 스텁 주입 — save/load 라운드트립(암호문만 저장·복호화 일치)·isAvailable=false 시 save 거부(EUNSUPPORTED)·delete·파일 미존재 폴백·**저장 객체에 평문 secret 부재** 단언.
- `verify:remote`(신규): RemoteService를 **어댑터 스텁 주입**(실 네트워크 미경유) — 연결 흐름(hostKeyDecision unknown→accept)·세션 격리(한 세션 throw 0→session-error)·list entries→FileEntryDTO 정규화·RemoteError 코드 전파·**연결/오류 객체에 비밀 미수록** 단언.
- `verify:remote-trust`(신규·SR5/SR6 핵심): ① 원격 path traversal(`../`·절대경로 탈출) POSIX 정규화 차단 ② 다운로드 도착지 하위 이탈 차단(Zip Slip 매트릭스) ③ 원격 파일명 로컬 금지문자 새니타이즈/거부 ④ 심볼릭 미추종 ⑤ host-key changed→경고 status ⑥ **RemoteError·로그 문자열에 비밀 패턴(password/passphrase/privateKey value) 부재** grep 단언(SR6 "응답에 비밀 없음" 불변식).
- (런타임 🟡): 실제 FTP/SFTP 서버 연결·전송·DPAPI 실암호화는 GUI/네트워크 스모크 권장.

### ⑩ 역할 · 병렬
- **backend 주도**(가장 큰 단위). 내부 병렬: ① credentials.ts+RemoteProfileStore(persistence) ② SftpAdapter ③ FtpAdapter ④ RemoteSessionManager+remoteTransfer를 서로 다른 담당이 RemoteService 인터페이스 합의 후 병렬. devops: ssh2 패키징/서명 영향 점검(SR7). qa: 신뢰경계·비밀배제 집중(감사 비중↑·ADR-007 ②). **MP5(원격 UI)는 MP4 핸들러 일부 완성 후 모킹으로 선행 가능.**

---

## MP5 — 원격 UI · 전송 라우팅 통합 (frontend 주도)

> MP1 계약 동결 후 모킹으로 선행 가능, MP4 핸들러 완성 시 실연동. software-architecture §11.

### ① 만들/고칠 파일
- **신규** `src/renderer/domain/rules/transferRoute.ts`(순수)·`domain/entities`(RemoteLocation·RemoteProfile·RemoteError 확장).
- **신규** `src/renderer/app/usecases/remote.ts`·`app/stores/remoteSlice.ts`.
- **신규** `src/renderer/ui/remote/*`(연결 다이얼로그·사이드바 "원격" 섹션·원격 배지·호스트키/비암호화 경고).
- **고침** `src/renderer/infra/api`(remoteApi·dndApi·clipboardApi 래퍼 — preload 경유)·`usecases/navigation`(location.kind 분기)·`ui/panel/views/FileListView.tsx`(원격 entries 재사용)·`PanelHeader`(원격 경로 배지)·`commandBus`(D&D/붙여넣기 전송 라우팅).
- **신규** `tests/remote-route.verify.ts`(transferRoute 순수함수).

### ② `transferRoute.ts`(순수 — D&D·클립보드·키보드 공유)
```ts
export type Loc = { kind:'local' } | { kind:'remote' }
export type TransferKind = 'copy'|'move'|'upload'|'download'|'unsupported'
export function resolveTransfer(src: Loc, dst: Loc, mods: {ctrl:boolean;shift:boolean}): TransferKind
//  local↔local: 기존 resolveDragIntent(copy/move). local→remote: upload. remote→local: download.
//  remote↔remote: unsupported(1차 범위 밖·UQ-M3). 외부 도착(M1): copy 고정.
```

### ③ navigation·FileListView·remoteSlice
- `Panel.location: LocalLocation | RemoteLocation`(software-architecture §11.1). `usecases/navigation`이 `location.kind`로 `fs:list:*`(로컬) vs `api.remote.list`(원격) 분기. 원격 entries도 `FileEntryDTO`라 정렬/필터/선택/가상스크롤 재사용. `DirectoryView.status`에 `'disconnected'|'timeout'` 추가(원격 오류 격리).
- `remoteSlice`: 세션·프로필 목록·연결 상태·호스트키 경고 UI 상태. `onHostKey`/`onSessionError` 구독→슬라이스.

### ④ UI 수용기준 매핑(features §M3)
- 연결 다이얼로그(프로토콜·호스트·포트·사용자명·인증방식·"저장" 체크)·사이드바 "원격" 섹션(프로필 목록·재접속·편집·삭제)·원격 패널 배지(`프로토콜://사용자@호스트/경로`)·호스트키 경고 모달(지문 표시·accept/reject)·평문 FTP 비암호화 경고·세션 오류 패널 격리 표시·재시도 안내.

### ⑤ DoD
- 원격 접속→탐색→다운로드/업로드(D&D·붙여넣기)·진행률/취소/충돌(D4/E4 재사용)·프로필 CRUD UI·호스트키 경고·비암호화 경고·세션 격리 표시. 전 수용기준(US-12.3~12.5) 충족. typecheck/lint 0.

### ⑥ 신규 verify
- `verify:remote-route`(신규·store/domain 양식): transferRoute 진리표(local↔local·upload·download·remote↔remote unsupported·외부 copy 고정)·remoteSlice 상태 전이(연결/끊김/호스트키 경고). 양식: 기존 `verify:store`/`verify:domain`(esbuild esm·@renderer 별칭).
- (런타임 🟡): 실 GUI 원격 탐색·전송·다이얼로그는 스모크 권장.

### ⑦ 역할 · 병렬
- **frontend 주도**. qa: 전송 라우팅 진리표·세션 격리·수용기준 교차. devops: 빌드/청크. MP4와 모킹 병렬→실연동 통합.

---

## 부록 A. 신규 IPC 채널 · DTO 요약(병렬 합의용)

| 채널 | 종류 | Req | Res | 에러 | Phase |
|---|---|---|---|---|---|
| `dnd:start-drag` | invoke | DndStartDragReq | DndStartDragRes | FileOpError | MP3 |
| `clipboard:write-files` | invoke | ClipboardWriteFilesReq | void | FileOpError | MP2 |
| `clipboard:read-files` | invoke | — | ClipboardFilesReadRes | FileOpError | MP2 |
| `clipboard:has-files` | invoke | — | ClipboardHasFilesRes | FileOpError | MP2 |
| `remote:cred:save/has/delete` | invoke | RemoteCred*Req | void/{has}/void | FileOpError | MP4 |
| `remote:profile:list/upsert/delete` | invoke | RemoteProfile*Req/— | RemoteProfileDTO[]/DTO/void | FileOpError | MP4 |
| `remote:connect` | invoke | RemoteConnectReq | RemoteConnectRes | **RemoteError** | MP4 |
| `remote:disconnect` | invoke | RemoteDisconnectReq | void | FileOpError | MP4 |
| `remote:list/stat/mkdir/rename/delete` | invoke | Remote*Req | {entries}/FileEntryDTO/void | **RemoteError** | MP4 |
| `remote:download/upload` | invoke | RemoteDownload/UploadReq | {operationId} | **RemoteError** | MP4 |
| `remote:host-key` | 푸시 evt | — | RemoteHostKeyEvt | — | MP4 |
| `remote:session-error` | 푸시 evt | — | RemoteSessionErrorEvt | — | MP4 |
| (재사용) `op:progress/conflict/done/cancel` | — | — | — | — | MP4(전송) |

> RemoteError = FileOpError(code 유니온 확장: EAUTH·ETIMEDOUT·ECONNRESET·EHOSTUNREACH·EHOSTKEY·EUNSUPPORTED). 별도 판별 kind 없음·비밀 필드 없음(ADR-007 ⑥).

## 부록 B. 신규 verify 하니스 목록(헤드리스)

| verify 스크립트 | Phase | 검증 핵심 |
|---|---|---|
| `verify:eslint-remote` | MP0 | ESLint 화이트리스트(신규 4차단·remote/ 예외·기존 8유지) |
| `verify:m-contract` | MP1 | 채널/DTO/zod 정합·RemoteProfileDTO 비밀배제 |
| `verify:clipboard-hdrop` | MP2 | DROPFILES 라운드트립·DropEffect·방어적 파싱 |
| `verify:dnd` | MP3 | 원격거부·미존재거부·startDrag 위임·guardPath |
| `verify:credentials` | MP4 | safeStorage 라운드트립·평문 0·isAvailable 게이트 |
| `verify:remote` | MP4 | 연결 흐름·세션 격리·entries 정규화·비밀 미수록 |
| `verify:remote-trust` | MP4 | traversal·Zip Slip·새니타이즈·심볼릭·host-key·비밀 grep 0 |
| `verify:remote-route` | MP5 | transferRoute 진리표·remoteSlice 전이 |

> 전부 `package.json` `scripts`에 기존 양식(esbuild 번들→node·@shared/@renderer 별칭·electron stub)으로 추가. (런타임 🟡: 외부 앱 드롭·실 DPAPI·실 FTP/SFTP·GUI 전송은 스모크 권장 — verify는 헤드리스 불변식만.)

## 부록 C. 확인 필요(Open Questions for PM/reviewer)

| # | 항목 | 비고 |
|---|---|---|
| CN-1 | 기존 `clipboard:copy-files/cut-files/paste-target/read`·`fileClipboard.ts` 1차 보존(병존) vs 즉시 대체 | system-architecture §5-M.1은 "대체·확장" 표현. 본 계획은 비파괴 병존→후속 정리 권장 |
| CN-2 | startDrag `icon`(NativeImage 필수) 소스 — getFileIcon dataURL 변환 vs 번들 리소스 아이콘 | 빈 아이콘은 startDrag 거부. 최소 16px 리소스 필요 |
| CN-3 | `credentials.enc` 암호문 저장과 `atomic.ts` "비밀 저장 금지" 헤더 정합 | 암호문은 평문 아님 — 헤더 메모 추가 or 전용 쓰기 |
| CN-4 | 원격 전송 진행률의 OperationManager 재사용 방식 | 전용 메서드 추가 vs remoteTransfer 직접 op 푸시 |
| CN-5 | ssh2 가속(cpu-features) optional 빌드·코드서명 영향(SR7) | 순수 JS 모드 기본·devops MP4 점검 |
