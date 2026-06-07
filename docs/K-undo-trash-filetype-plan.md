# K장 구현 계획서 — 되돌리기(Ctrl+Z) · 휴지통 관리 화면 · 파일 유형별 비중

> 상태: **계획(설계 검증 대기)** · 작성: 테크리드 · 날짜: 2026-06-07
> 대상: Should 잔여 3건 (K1 Ctrl+Z 되돌리기 · K2 휴지통 관리 화면 · K3 파일 유형별 비중)
> 이 문서는 **코드베이스 수준의 구현 계획**이며, 구현은 검증 통과 후 착수한다.

---

## 0. 개요 · 범위 동결

| ID | 기능 | 핵심 | 신규/확장 |
|----|------|------|-----------|
| K1 | 되돌리기(Ctrl+Z) | 다단계 undo 스택 — rename·create·move·paste(copy) 역연산, 삭제는 휴지통 복원(K2 재사용). 영구삭제 불가(토스트). redo v1 제외. | 신규 `undoSlice` + fileOps hook + commandBus 연결 |
| K2 | 휴지통 관리 화면 | Windows 휴지통 목록(이름·원래경로·삭제일·크기)·선택 복원·전체 비우기(확인). 진입: 사이드바/아이콘바. | 신규 `recycleBin.ts` + `trash:*` 채널 + 모달 UI |
| K3 | 파일 유형별 비중 | scanEngine `byCategory` 집계(이미지/동영상/문서/코드/압축/기타) → 대시보드 차트/표. | scanEngine·ScanResult 확장 + 대시보드 섹션 |

**스코프 경계(확정):**
- redo(Ctrl+Y)는 v1 제외. undo 스택은 **휘발**(세션 비직렬화 — 앱 재시작 시 비움).
- 영구삭제(delete)는 undo **불가** → undo 시도 시 안내 토스트, 스택에 엔트리를 만들지 않는다.
- undo 충돌(동명 항목이 생겼거나 대상이 사라짐 등)은 **선검증 후 안내·중단** — 임의 덮어쓰기 금지.
- K3 집계는 `analyze:scan` 채널 **내부**에서만 일어난다(신규 채널 0). `ScanResult` 확장만.

---

## 1. K2 — 휴지통 서비스 (backend 선행, K1·K2 공유)

### 1.1 설계 결정: PowerShell Shell.Application COM (driveType.ts 선례)

Node/Electron 에는 휴지통 **열거·복원** 네이티브 API 가 없다(`shell.trashItem` 은 보내기 전용).
`driveType.ts`·`shell.ts`(showProperties)에서 확립된 **execFile + 고정 스크립트 + 환경변수 주입 + headless queryFn 주입** 패턴을 그대로 복제해 신규 `recycleBin.ts` 를 만든다.

| 연산 | PowerShell(COM) | 비고 |
|------|----------------|------|
| 열거 | `(New-Object -ComObject Shell.Application).NameSpace(0xA).Items()` → 각 item 의 `Name`, `Path`, 원래경로(`ExtendedProperty('System.Recycle.DateDeleted')`·`ExtendedProperty('System.Recycle.DeletedFrom')`), `Size`. `ConvertTo-Json -Compress` 직렬화. | `0xA`=`ssfBINHED`(휴지통 가상 폴더). `Path` 는 `$Recycle.Bin\...\$R...` 실경로(복원 키). |
| 복원 | 대상 item 의 원래경로(`DeletedFrom + Name`)를 식별 → 충돌 없으면 `.InvokeVerb('복원')`/`.InvokeVerb('restore')`, 충돌·동사 부재 시 `Move-Item` 원위치(원위치 충돌 안전 처리). | 토큰은 휴지통 내부 `$R` 실경로로 매칭(이름 동명 다수 안전). |
| 비우기 | PS5+ `Clear-RecycleBin -Force -ErrorAction Stop`. 실패 시 COM 폴백. | **반드시 Renderer 확인 모달 통과 후에만 호출**. |

> COM/로케일 주의: `InvokeVerb` 동사명은 로케일 의존('복원' vs 'restore') → `showProperties` 처럼 **동사 이름을 정규식(`복원|Restore`)으로 탐색**해 첫 동사 실행. 동사 부재 시 `Move-Item` 폴백.

### 1.2 신규 파일 `src/main/os/recycleBin.ts`

`DriveTypeService` 와 동형: 고정 상수 스크립트, `execFile('powershell.exe', [...])`, `windowsHide:true`, `timeout`, headless 주입용 `queryFn`/`invokeFn` 옵션, 비-Windows·실패·파싱오류 → 안전 폴백(빈 목록/Result.err). **throw 0**.

```ts
/** 휴지통 항목 1개(JSON 역직렬화 후 정규화). */
export interface RecycleItemRaw {
  /** 휴지통 내부 실경로($R...) — 복원/식별 토큰. */
  readonly id: string
  /** 표시 이름(원래 파일명). */
  readonly name: string
  /** 원래 전체 경로(DeletedFrom\Name). 없으면 ''. */
  readonly originalPath: string
  /** 삭제 시각(epoch ms). 파싱 실패 시 0. */
  readonly deletedAt: number
  /** 바이트 크기(폴더는 0 또는 집계불가). */
  readonly size: number
  /** 디렉토리 여부. */
  readonly isDir: boolean
}

export interface RecycleBinServiceOptions {
  /** list 스크립트 raw stdout(JSON) 반환. headless 주입. */
  listFn?: () => Promise<string>
  /** restore/empty 실행 래퍼. headless 주입(부수효과 격리). */
  invokeFn?: (kind: 'restore' | 'empty', ids: string[]) => Promise<{ ok: boolean; message?: string }>
}

export class RecycleBinService {
  /** 휴지통 열거 → 정규화된 항목 배열. 실패/비-Win → []. throw 0. */
  async list(): Promise<RecycleItemRaw[]>
  /** 선택 항목($R 실경로 id 배열) 원위치 복원. 항목별 성공/실패 집계 반환. */
  async restore(ids: string[]): Promise<RecycleRestoreResult>
  /** 전체 비우기(Clear-RecycleBin → COM 폴백). 확인은 호출측(핸들러 상위) 책임. */
  async empty(): Promise<{ ok: boolean; message?: string }>
}
export const recycleBinService = new RecycleBinService()
```

`RecycleRestoreResult = { restored: number; failed: { id: string; name: string; message: string }[] }`.

**보안(driveType·shell 선례 준수):**
- 스크립트는 **고정 상수**. 가변 데이터(복원할 `$R` id 목록)는 **명령행 보간 금지** → 환경변수(`EXPLORER_TRASH_IDS`, 개행 join) 또는 stdin 으로 전달하고 스크립트가 `$env:` 로 읽는다(`showProperties` 의 `EXPLORER_PROP_*` 패턴).
- id 는 `$Recycle.Bin` 하위 경로 화이트리스트(정규식 `\\$Recycle\.Bin\\`)만 통과시켜 **임의 경로 실행 차단**.
- `empty` 는 핸들러가 Renderer 확인 응답 없이는 절대 호출하지 않음(아래 1.3 모달 게이트).

### 1.3 신규 채널 `trash:*`

`channels.ts` `CHANNELS` 에 추가(명명: 도메인 접두사 `trash:`):

```ts
TRASH_LIST: 'trash:list',       // invoke → Result<TrashListRes>
TRASH_RESTORE: 'trash:restore', // invoke → Result<TrashRestoreRes>
TRASH_EMPTY: 'trash:empty',     // invoke → Result<TrashEmptyRes>
```
모두 **요청-응답**(푸시 evt 없음) → `EVENT_CHANNELS` 변경 0.

`contracts.ts` 추가:
```ts
export interface TrashItemDTO { id: string; name: string; originalPath: string; deletedAt: number; size: number; isDir: boolean }
export interface TrashListRes { items: TrashItemDTO[] }
export interface TrashRestoreReq { ids: string[] }
export interface TrashRestoreRes { restored: number; failed: { id: string; name: string; message: string }[] }
export interface TrashEmptyReq { confirm: true }   // 확인 토큰(가드가 강제)
export interface TrashEmptyRes { emptied: boolean }
```
`IpcRequestMap` 에 3건 등록:
```ts
[CHANNELS.TRASH_LIST]: { req: void; res: Result<TrashListRes> }
[CHANNELS.TRASH_RESTORE]: { req: TrashRestoreReq; res: Result<TrashRestoreRes> }
[CHANNELS.TRASH_EMPTY]: { req: TrashEmptyReq; res: Result<TrashEmptyRes> }
```

`dto/index.ts` 에 `TrashItemDTO` 만 둘지(데이터 모델) `contracts` 에 둘지: **DTO(데이터)는 dto, 요청/응답 shape 는 contracts** 규칙에 따라 `TrashItemDTO` 는 `dto/index.ts`, 나머지(`Trash*Req/Res`)는 `contracts.ts`.

### 1.4 신규 핸들러 `src/main/ipc/trash.handlers.ts`

`analyze.handlers.ts` 의 `handleGuarded` 패턴 복제(senderFrame → zod → fn). `index.ts` `registerIpcHandlers()` 에 `registerTrashHandlers()` 추가.

- `trash:list` → `recycleBinService.list()` → `ok({ items })`. zod: `void`(인자 없음 → `z.void()` 또는 raw 무시).
- `trash:restore` → zod `zTrashRestoreReq = z.object({ ids: z.array(z.string().min(1)).min(1) })`. id 화이트리스트(`$Recycle.Bin` 포함) 재검증 후 service.restore.
- `trash:empty` → zod `zTrashEmptyReq = z.object({ confirm: z.literal(true) })`. **확인 토큰이 literal true 가 아니면 EINVAL 거부** → service.empty.

> 비우기 확인 UX: 1차는 **Renderer 자체 모달**(`ConfirmDialog` 동형)로 확인 → 확인 시에만 `confirm:true` 로 invoke. (Main `dialog.showMessageBox` 폴백 옵션도 가능하나 일관 UX 위해 Renderer 우선 — `confirmPermanentDelete` 선례.)

### 1.5 preload / infra 어댑터

`preload/api.ts` `ExplorerApi` 에 `trash` 네임스페이스 추가:
```ts
readonly trash: {
  list(): Promise<Result<TrashListRes>>
  restore(req: TrashRestoreReq): Promise<Result<TrashRestoreRes>>
  empty(req: TrashEmptyReq): Promise<Result<TrashEmptyRes>>
}
```
`infra/api/index.ts` 에 `trashApi = { list, restore, empty }` (`opApi` 동형, `confirm:true` 는 `empty()` 래퍼에서 고정 주입).

---

## 2. K2 — 휴지통 관리 화면 (frontend)

### 2.1 상태 — 신규 `src/renderer/app/stores/trashSlice.ts`

`analyzeSlice`/`uiSlice` 모달 패턴 참고. Immer 슬라이스(고빈도 아님).
```ts
export type TrashStatus = 'idle' | 'loading' | 'ready' | 'error'
export interface TrashSlice {
  trashOpen: boolean
  trashStatus: TrashStatus
  trashItems: TrashItemDTO[]
  trashSelected: Set<string>          // 선택된 item id
  trashError: string | null
  openTrash(): void                   // inputContext='dialog' (uiSlice 모달 게이트에 합류)
  closeTrash(): void
  _setTrashItems(items: TrashItemDTO[]): void
  toggleTrashSelect(id: string): void
  // ...
}
```
주의: `uiSlice` 의 `inputContext='list'` 복귀 조건들(`!s.confirmDelete && !s.dashboardOpen && ...`)에 **`!s.trashOpen`** 을 추가해야 함(모든 모달 close 분기 8곳 — uiSlice 257~422 라인). 이는 횡단 변경이므로 검증 포인트로 명시.

### 2.2 유스케이스 — 신규 `src/renderer/app/usecases/trash.ts`

`dashboard.ts`(startScan/cancelScan) 동형. app→infra(`trashApi`) 직접 호출.
```ts
export async function loadTrash(): Promise<void>          // trash:list → _setTrashItems / 토스트
export async function restoreSelected(): Promise<void>    // trash:restore(선택 id) → 결과 토스트 + loadTrash 재조회 + 영향 패널 refresh
export async function emptyTrash(): Promise<void>         // 확인 모달 통과 후 trash:empty → 토스트 + loadTrash
```
복원 후: 원래경로의 부모 폴더를 보고 있는 패널이 있으면 `refresh`(fileOps 의 `panelsShowingDir` 재사용 또는 store.refresh 직접).

### 2.3 UI — 신규 `src/renderer/ui/trash/TrashModal.tsx` (+ lazy body)

`DashboardModal`/`DashboardModalBody` 패턴(Suspense lazy, focus trap, overlay/panel 스타일 재사용 `dialogStyles`). 본문:
- 표: 이름 · 원래경로 · 삭제일(`formatBytes`/날짜 포맷) · 크기. 행 체크박스 선택, 헤더 전체선택.
- 버튼: **선택 복원**(선택 ≥1 활성) · **전체 비우기**(항목 ≥1 활성, 클릭 시 확인 모달).
- 빈 목록·loading·error 상태 표시.
- 마운트 시 `loadTrash()`.

### 2.4 진입점

- **commandBus**: `case 'trash.open': s.openTrash(); return true` 추가.
- **keybindings**: (선택) 단축키 미배정 — 메뉴/아이콘 진입만. (Ctrl+Z 는 K1 전용.)
- **iconBarItems**: `tool` 그룹에 `{ id: 'trash.open', label: '휴지통', icon: '🗑', group: 'tool', active: s=>s.trashOpen }` 추가.
- **Sidebar**: "탐색" 섹션 위/아래에 휴지통 노드 1개(`MyPcNode` 동형, 클릭 → `execCommand('trash.open')`). app→ui 경계상 Sidebar 는 store 액션(`openTrash`) 직접 호출도 가능(기존 navigate 패턴과 동일).
- **App 루트**에 `<TrashModal />` 마운트(`ConfirmDialog`/`DashboardModal` 옆).

---

## 3. K1 — 되돌리기(Ctrl+Z) undo 시스템

### 3.1 상태 — 신규 `src/renderer/app/stores/undoSlice.ts`

휘발 스택. `operationsSlice` 와 분리(관심사 분리·고빈도 progress 와 무관). Immer 슬라이스.

```ts
/** undo 가능한 작업 1건의 역연산 정보. kind 별 판별 유니온. */
export type UndoEntry =
  | { kind: 'rename'; path: string; oldName: string; newName: string; newPath: string }
  | { kind: 'create'; path: string }                                   // 역=휴지통 보내기
  | { kind: 'move'; sources: string[]; fromDir: string; toDir: string } // 역=toDir→fromDir move
  | { kind: 'copy'; createdPaths: string[] }                            // 역=생성 사본 휴지통 보내기
  | { kind: 'trash'; trashedNames: string[]; fromDir: string }          // 역=휴지통 복원(K2)

export interface UndoSlice {
  undoStack: UndoEntry[]            // push=top, pop=undo
  pushUndo(entry: UndoEntry): void  // 상한(예: 50) 초과 시 오래된 것 drop
  popUndo(): UndoEntry | undefined
  clearUndo(): void                 // (세션 비직렬화이므로 부팅 시 자동 빈 스택)
}
```
상한 `UNDO_STACK_CAP = 50`. **세션/워크스페이스 스냅샷에 미포함**(coerceSession 에 undo 필드 없음 → 자동 휘발).

### 3.2 역연산 정의표 (진리표)

| 원작업 | undo 엔트리 생성 시점(hook) | 역연산 | undo 가능? | 충돌 선검증 |
|--------|---------------------------|--------|-----------|------------|
| rename | `commitRename` 성공 직후(fileOps) | rename(newPath→oldName) | ✅ | oldName 동명 항목 재생성됐는지 |
| create folder/file | `createNewFolder`/`createNewFile` 성공 직후 | 생성물 휴지통 보내기(op:start trash) | ✅ | 경로 존재·내용 변경 여부(폴더 비어있나) |
| move (cut→paste / D&D move) | op:done(move) 브리지에서 | 역방향 move(toDir→fromDir) | ✅ | fromDir 에 동명 재생성됐는지·대상 존재 |
| copy (paste copy / D&D copy) | op:done(copy) 브리지에서 | 생성된 사본 휴지통 보내기 | ✅ | 사본 경로 존재 여부 |
| trash (휴지통 보내기) | op:done(trash) 브리지에서 | **휴지통 복원(K2 trash:restore)** | ✅ | 원위치 동명 충돌 |
| delete (영구삭제) | **엔트리 미생성** | — | ❌ | undo 시도 시 안내 토스트 |

> **핵심 hook 지점:**
> - **rename/create**: `fileOps.ts` 의 `commitRename`·`createNewFolder`·`createNewFile` 성공 분기에서 `store.pushUndo(...)`.
> - **move/copy/trash**: `operationsBridge.ts` `onDone` 콜백 — `op.kind` + 등록 시 보관한 정보로 엔트리 생성. 이를 위해 `registerOperation`/`Operation` 에 **undo 메타**(예: `undoMeta?: { fromDir; toDir; sources } | { trashedNames; fromDir }`)를 추가해 op:done 시점에 역연산 정보를 알 수 있게 한다. copy 의 `createdPaths` 는 op:done summary 에 생성 경로가 없으므로, **대상 폴더 + source basename 으로 산출**(동명 충돌 rename 시 부정확 가능 → 리스크 §6, v1 은 충돌-rename 케이스는 undo 비활성 처리).

### 3.3 undo 실행 — 신규 `src/renderer/app/usecases/undo.ts`

```ts
/** Ctrl+Z 진입: 스택 top pop → kind 별 역연산. 충돌 선검증 실패 시 안내·중단(엔트리 복원). */
export async function performUndo(): Promise<void>
```
분기:
- `rename` → 선검증(`fsApi.validatePath(oldPath)` 미존재 확인) → `fsApi.rename({ path:newPath, newName:oldName })`. 실패 시 토스트, 엔트리 미복원(이미 pop).
- `create` → 선검증(존재·폴더면 비어있나) → `startOperation('trash', [path], ...)`.
- `move` → 선검증(toDir 에 항목 존재·fromDir 동명 없음) → `startOperation('move', [toDir\name...], fromDir, ...)`.
- `copy` → 선검증(사본 존재) → `startOperation('trash', createdPaths, ...)`.
- `trash` → `trashApi.list()` 로 해당 항목 id 매칭(이름+fromDir originalPath) → `trashApi.restore(ids)`. 매칭 실패 시 토스트(이미 비워졌거나 못 찾음).
- 빈 스택 → `pushToast('info', '되돌릴 작업이 없습니다.')`.

**충돌 선검증 원칙**: 역연산 전 항상 대상 상태를 확인. 동명 항목이 새로 생겼으면 **덮어쓰지 않고** `pushToast('error', '되돌릴 수 없습니다 — 같은 이름의 항목이 이미 있습니다.')` 후 중단.

### 3.4 commandBus 연결

`commandBus.ts` 의 `case 'file.undo': notYet(...)` 를 교체:
```ts
case 'file.undo':
  void performUndo()
  return true
```
`keybindings/index.ts` 의 `ctrl+z` 라벨을 `'되돌리기'`(Should 표기 제거)로 갱신. context 는 `'global'` 유지(텍스트 입력 컨텍스트에서는 Dispatcher 가 이미 차단).

> 인라인 rename 편집 중 Ctrl+Z 는 input 자체 undo 가 우선되어야 함 → `rename`/`addressEdit`/`search` 컨텍스트에서는 `file.undo` 가 발화하지 않도록 context='global' 유지(Dispatcher 가 입력 컨텍스트 제외). 검증 포인트.

---

## 4. K3 — 파일 유형별 비중

### 4.1 카테고리 분류 — 신규 `src/shared/dto` 또는 `src/main/operations/categorize.ts`

확장자→카테고리 맵(순수 함수). scanEngine(Main/Worker)·대시보드 라벨 공용 가능성 → **`shared`** 에 두는 것이 안전하나, 분류는 집계 전용이므로 `src/main/operations/categorize.ts`(Main 전용)로 두고 카테고리 키 enum 만 `dto` 공유.

```ts
export type FileCategory = 'image' | 'video' | 'document' | 'code' | 'archive' | 'other'
/** 소문자 확장자(선행 '.' 제외) → 카테고리. 미등록/빈 확장자 → 'other'. */
export function categorizeExt(ext: string): FileCategory
```
대표 매핑(예시, 확정 표는 구현 시):
- image: png jpg jpeg gif webp bmp svg ico tiff heic
- video: mp4 mkv avi mov wmv flv webm m4v
- document: pdf doc docx xls xlsx ppt pptx txt md hwp odt csv
- code: js ts jsx tsx py java c cpp h cs go rs rb php html css json xml yml yaml sh
- archive: zip 7z rar gz tar bz2 xz
- other: 그 외 전부

### 4.2 scanEngine 집계 (1패스)

`scanEngine.ts` `ScanState` 에 카테고리 누적기 추가:
```ts
readonly byCategory: Record<FileCategory, { bytes: number; count: number }>
```
초기화는 6키 0. `scanDir` 의 `st.isFile()` 분기(196~206줄)에서 파일 처리 시 1회:
```ts
const cat = categorizeExt(win32.extname(dirent.name).slice(1).toLowerCase())
state.byCategory[cat].bytes += bytes
state.byCategory[cat].count++
```
**추가 디스크 I/O 0**(이미 lstat·size 보유, 이름만 분류) → 성능 영향 무시 가능.

`runScan` 반환에 `byCategory` 배열 추가(셀렉터 친화 — 정렬은 소비측):
```ts
byCategory: (Object.entries(state.byCategory) as [FileCategory, {bytes:number;count:number}][])
  .map(([category, v]) => ({ category, bytes: v.bytes, count: v.count }))
```

### 4.3 `ScanResult` 확장 (dto/index.ts)

```ts
/** 확장자 카테고리별 용량/개수 집계(K3). */
export interface CategoryUsage {
  readonly category: FileCategory
  readonly bytes: number
  readonly count: number
}
export interface ScanResult {
  // ...기존 필드...
  /** 파일 유형(카테고리)별 용량/개수. 항상 6개(0 포함). 폴더는 미집계. */
  readonly byCategory: CategoryUsage[]
}
```
**계약 확장(비파괴 추가)**: `analyze:scan:done` 의 `ScanResult` 에 필드 1개 추가 → 기존 소비측은 무시, 신규 소비측만 사용. **신규 채널/DTO 0**(분류 enum `FileCategory` 만 신규 export).

> 호환성: `ScanResult` 를 만드는 곳은 `runScan` 1곳 → 항상 채워짐. 구버전 직렬화 결과(없음 — 휘발 데이터) 고려 불필요. ScanManager(Worker) 가 `runScan` 결과를 그대로 전달하므로 추가 변경 없음(필드만 통과).

### 4.4 대시보드 표시 (DashboardModalBody.tsx)

`ScanSection` 결과 블록(320줄~)에 **유형별 섹션** 추가(상위 폴더/파일 표 아래):
- 차트: 신규 `src/renderer/ui/dashboard/charts/CategoryBar.tsx`(또는 도넛 `CategoryDonut`) — `TopBar`/`DiskDonut` recharts 패턴 복제. props = `CategoryUsage[]`.
- 표 병행(접근성): 카테고리 · 용량(`formatBytes`) · 개수(`formatCount`) · 비중%(전체 대비). `TopTable` 동형.
- 카테고리 한글 라벨 맵(이미지/동영상/문서/코드/압축/기타).
- 0바이트 카테고리는 표에 표시(차트는 0 제외 가능).

---

## 5. 파일·함수 변경지점 요약 (시그니처)

### 신규 파일
| 경로 | 내용 |
|------|------|
| `src/main/os/recycleBin.ts` | `RecycleBinService.list/restore/empty`, `recycleBinService`, headless 옵션 |
| `src/main/ipc/trash.handlers.ts` | `registerTrashHandlers()` (handleGuarded 패턴) |
| `src/main/operations/categorize.ts` | `categorizeExt(ext): FileCategory` |
| `src/renderer/app/stores/trashSlice.ts` | 휴지통 모달 상태 |
| `src/renderer/app/stores/undoSlice.ts` | undo 스택 |
| `src/renderer/app/usecases/trash.ts` | `loadTrash/restoreSelected/emptyTrash` |
| `src/renderer/app/usecases/undo.ts` | `performUndo()` |
| `src/renderer/ui/trash/TrashModal.tsx` (+ Body lazy) | 휴지통 화면 |
| `src/renderer/ui/dashboard/charts/CategoryBar.tsx` | 유형별 차트 |

### 변경 파일
| 경로 | 변경 |
|------|------|
| `src/shared/ipc/channels.ts` | `TRASH_LIST/RESTORE/EMPTY` 3개 추가(EVENT_CHANNELS 무변) |
| `src/shared/ipc/contracts.ts` | `Trash*Req/Res`, `IpcRequestMap` 3건 |
| `src/shared/dto/index.ts` | `TrashItemDTO`, `FileCategory`, `CategoryUsage`, `ScanResult.byCategory` |
| `src/main/ipc/guard.ts` | `zTrashRestoreReq`, `zTrashEmptyReq`($Recycle.Bin 화이트리스트·literal true) |
| `src/main/ipc/index.ts` | `registerTrashHandlers()` 등록 |
| `src/main/operations/scanEngine.ts` | `byCategory` 1패스 집계 + 반환 |
| `src/preload/api.ts` | `trash` 네임스페이스 |
| `src/renderer/infra/api/index.ts` | `trashApi` |
| `src/renderer/app/usecases/commandBus.ts` | `file.undo`→performUndo, `trash.open` case |
| `src/renderer/app/usecases/fileOps.ts` | rename/create 성공 시 pushUndo; startOperation 에 undoMeta |
| `src/renderer/app/usecases/operationsBridge.ts` | op:done 에서 move/copy/trash undo 엔트리 생성 |
| `src/renderer/app/stores/operationsSlice.ts` | `Operation.undoMeta?`, `registerOperation` 인자 확장 |
| `src/renderer/app/stores/uiSlice.ts` | 모달 inputContext 복귀 조건에 `!s.trashOpen` (8곳) |
| `src/renderer/domain/keybindings/index.ts` | ctrl+z 라벨 갱신 |
| `src/renderer/ui/toolbar/iconBarItems.ts` | 휴지통 버튼 |
| `src/renderer/ui/sidebar/Sidebar.tsx` | 휴지통 노드 |
| `src/renderer/ui/dashboard/DashboardModalBody.tsx` | 유형별 섹션 |
| `src/renderer/app/stores/rootStore.ts` | trashSlice·undoSlice 합성(slice 등록) |
| App 루트(예: `App.tsx`) | `<TrashModal />` 마운트 |

---

## 6. 리스크 / 에스컬레이션

| 리스크 | 영향 | 완화 |
|--------|------|------|
| **휴지통 COM 신뢰성**(로케일 동사명, JSON 깊이/단일항목 배열화, 대용량 목록 지연) | K2 핵심 | 동사 정규식 탐색·`ConvertTo-Json -Depth`·단일항목 `@()` 강제 배열·`timeout` 넉넉히·실패 시 빈 목록 폴백. headless 스텁으로 파싱 단위검증. |
| **undo copy `createdPaths` 부정확**(충돌 rename 시 사본명이 달라짐) | K1 copy undo 오작동 | v1: 충돌이 발생한 copy(op:done summary 의 failedItems/conflict 흔적) 는 undo 엔트리 **미생성**(보수적). 정확 추적은 OperationManager 가 생성 경로를 summary 에 싣는 후속 과제(에스컬레이션 후보). |
| **undo trash 매칭 실패**(휴지통에서 동명 다수·이미 비움) | K1 trash undo 실패 | originalPath+name 매칭, 다수면 deletedAt 최신 우선. 실패 시 안내 토스트(중단). |
| **uiSlice 횡단 변경**(inputContext 복귀 8곳) | 입력 컨텍스트 회귀 | 모달 close 분기 전수 점검 — QA 회귀 항목. |
| **대용량 휴지통/스캔** | 성능 | 휴지통 목록 표 가상화는 v1 제외(항목 수 적다 가정), 초과 시 후속. K3 집계는 추가 I/O 0. |
| **계약 확장 ScanResult** | 직렬화 | 비파괴 추가·휘발 데이터 → 호환 문제 없음. |

**즉시 PM 에스컬레이션 후보:** (1) copy-undo 정확도를 위해 OperationManager summary 에 생성경로를 싣는 범위 확대 여부, (2) 휴지통 비우기 확인을 Renderer 모달 vs Main `dialog.showMessageBox` 중 무엇으로 할지(보안·일관성 trade-off).

---

## 7. 분담

| 담당 | 태스크 |
|------|--------|
| **backend-dev** | K2 휴지통 서비스(`recycleBin.ts` COM·headless), `trash:*` 채널/contracts/guard/핸들러, preload/infra `trash`; K3 `categorize.ts`+scanEngine `byCategory`+`ScanResult` 확장 |
| **frontend-dev** | K1 undoSlice·undo.ts·fileOps/operationsBridge hook·commandBus 연결; K2 trashSlice·trash.ts·TrashModal·진입점(아이콘바/사이드바)·uiSlice 횡단; K3 대시보드 유형별 섹션·CategoryBar |
| **qa-engineer** | undo 진리표(가능/불가) 검증, 휴지통 복원/비우기/보안(임의경로 차단·confirm 게이트), K3 집계 정확성(샘플 트리 카테고리 합), uiSlice 회귀 |
| **reviewer** | 본 계획 설계 정합성(COM 보안 패턴 준수·계약 확장 비파괴·undo hook 위치) |

### QA 검증 포인트 (수용 기준)
- **undo 진리표**: rename↔rename, create→trash, move 역방향, copy→사본 trash, trash→복원, delete→불가(토스트). 빈 스택 안내. 충돌 시 덮어쓰기 0(안내·중단).
- **휴지통**: list 항목 4필드 정확, 선택 복원 원위치, 전체 비우기 확인 후만 실행, `confirm:true` 없으면 거부, `$Recycle.Bin` 외 id 거부.
- **K3**: 알려진 확장자 분포 트리에서 카테고리별 bytes/count 합 = 전체 파일 bytes/count(폴더 제외), 미지 확장자→other.

---

## 8. 구현 순서(권장 단계)

1. **K3**(최소 결합, 검증 쉬움): categorize → scanEngine byCategory → ScanResult → 대시보드. QA 후 doc-sync.
2. **K2 backend**: recycleBin.ts → trash:* 채널/핸들러/preload/infra. headless 단위검증.
3. **K2 frontend**: trashSlice/trash.ts/TrashModal/진입점/uiSlice. QA 후 doc-sync.
4. **K1**: undoSlice → fileOps/bridge hook → undo.ts → commandBus. (K2 trash:restore 의존 → K2 후행.) QA 후 doc-sync.

각 단계 완료 시 `doc-sync` 게이트(roadmap §0.5·traceability) 갱신 후 다음 단계.
