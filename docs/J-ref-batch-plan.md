# J장 — 추가 기능 8건 코드베이스 수준 구현 계획서

> 작성: 테크리드 · 2026-06-07 · 출처: `docs/temp/ref.md`(사용자 확정 8건)
> 상태: **계획 단계(구현 미착수)**. 본 문서는 파일·함수·인터페이스 변경 지점(시그니처 수준), 신규 채널/DTO,
> 신규 의존성 판단, DoD(측정가능), QA 검증 포인트, 리스크/에스컬레이션, 병렬화/분담을 담는다.
> 컨벤션 준수: Result·zod guard·스트림 streamId 상관·Immer(selection 통째 교체)·셀렉터 격리·coerce 구버전 호환·CSP·tokens.

이 문서의 기능 식별자는 **J1~J8** 로 부여한다(roadmap 편입 시 §J).

| ID | 기능 | 주 계층 |
|---|---|---|
| J1 | 파일 드래그 박스 선택(러버밴드) | frontend |
| J2 | 좌/우 패널 실시간 갱신(FS 워처) | backend + frontend |
| J3 | F5/F6 복사·이동 제거 | frontend(+domain) |
| J4 | Windows "보기" 세트(아이콘 대/중/소·목록·자세히) | frontend(+backend dto/coerce) |
| J5 | AGT-Finder 리브랜딩 | devops |
| J6 | 미리보기 뷰어 상하 2단(정보 카드 + 뷰어, 구문강조·마크다운) | frontend(+backend readPreview·devops 의존성) |
| J7 | 미리보기 패널 폭 조절 | frontend |
| J8 | 즐겨찾기 별칭 변경 | frontend(+backend coerce) |

---

## 0. 공통 전제 / 합의 사항 (인터페이스 우선)

병렬 출발선을 고정하기 위해 아래 계약을 **가장 먼저** 동결한다. backend/frontend 가 동시에 착수 가능.

### 0.1 신규/변경 DTO (단일 출처: `src/shared/dto/index.ts`)

1. **ViewMode 확장 (J4)** — 현재 `'list' | 'details'` →
   ```ts
   export type ViewMode = 'icons-large' | 'icons-medium' | 'icons-small' | 'list' | 'details'
   ```
   `PanelSnapshot.viewMode` 가 이 타입을 그대로 사용하므로 세션 직렬화 자동 호환. coerce 화이트리스트만 확장(0.4).

2. **SidebarSnapshot 즐겨찾기 구조 변경 (J8) — (A) 라벨 맵 분리 [PM 확정]** — 별칭(label)을 별도 맵으로 비파괴 추가. `favorites: string[]` 는 그대로 유지(경로·순서·하위호환):
   ```ts
   export interface SidebarSnapshot {
     readonly favorites: string[]           // 유지(경로 순서·하위호환)
     readonly favoriteLabels?: Record<string, string>  // 신규: path → label(별칭). 없으면 UI 가 basename 폴백
     readonly recent: string[]
     readonly width: number
     readonly collapsed: boolean
   }
   ```
   > **PM 확정**: (A) `favorites: string[]` 유지 + `favoriteLabels?: Record<string,string>` 맵 비파괴 추가로 확정. (B) `FavoriteEntry[]` 교체안은 폐기. 사유: 기존 `coerceSidebar`·`hydrateSidebar`·`buildSessionSnapshot`·`toggleFavorite` 가 `favorites: string[]` 전제 → 맵 추가가 회귀 표면 최소·순서 보존. **스키마 버전 미상향**(비파괴), coerce 가 구버전 `string[]`(라벨 없음)을 빈 맵으로 호환. 별칭 없으면 `basename(path)` 폴백.

3. **previewWidth (J7)** — `SessionSnapshot.ui` 에 추가:
   ```ts
   ui: { readonly theme: ThemeMode; readonly previewOpen: boolean; readonly previewWidth?: number }
   ```
   미지정 시 기본 320(현 `PANEL_WIDTH`). 클램프 240~720.

4. **PreviewData 확장 (J6)** — 코드 구문강조는 **렌더러(frontend)에서** highlight.js 로 수행하므로 신규 backend 필드는 최소. 다만 형식 분기 명확화를 위해 `lang` 힌트를 선택 추가:
   ```ts
   export interface PreviewData {
     // ...기존...
     /** kind==='text': 구문강조 언어 힌트(확장자→언어, backend 가 매핑·미상이면 undefined). */
     readonly lang?: string
     /** kind==='text': 마크다운 원문 여부(ext==='md'|'markdown'). 렌더러가 마크다운 렌더 선택. */
     readonly isMarkdown?: boolean
   }
   ```
   > PreviewData.kind 자체는 변경하지 않는다(여전히 `'image'|'text'|'meta'|'unsupported'`). 마크다운/코드는 모두 `kind:'text'` 로 오고, **렌더러 디스패치 2차 분기**(isMarkdown/lang)로 처리한다 → 레지스트리(`PREVIEW_RENDERERS`) 구조 유지.

### 0.2 신규 IPC 채널 (단일 출처: `src/shared/ipc/channels.ts` + `contracts.ts`)

**J2 FS 워처만 신규 채널을 추가**한다. 나머지 7건은 기존 채널/DTO 재사용 또는 dto 확장으로 충분(신규 채널 0).

`channels.ts CHANNELS` 에 추가:
```ts
// ── fs:watch:* 디렉토리 실시간 감시 (신규 J2 — 현재 디렉토리 1개 non-recursive) ──────
FS_WATCH_START: 'fs:watch:start',   // invoke → Result<{ watchId }> (단일 디렉토리 감시 시작)
FS_WATCH_EVENT: 'fs:watch:event',   // 푸시 evt (디바운스·병합된 변경 알림)
FS_WATCH_STOP: 'fs:watch:stop',     // invoke → Result<void> (경로 이동·언마운트 시 중지)
FS_WATCH_ERROR: 'fs:watch:error'    // 푸시 evt (권한·네트워크·미지원 드라이브 감시 실패 격리)
```
`EVENT_CHANNELS` 에 `FS_WATCH_EVENT`, `FS_WATCH_ERROR` 추가(Preload `on` 구독 노출 대상).

`contracts.ts` 추가:
```ts
/** 패널이 현재 보고 있는 디렉토리 1개를 non-recursive 로 감시. */
export interface FsWatchStartReq { readonly path: string }
export interface FsWatchStartRes { readonly watchId: string }
export interface FsWatchStopReq { readonly watchId: string }
/** 디바운스·병합된 변경 알림. 증분 항목 목록은 보내지 않고 "변경됨" 신호만 — 렌더러가 해당 패널 re-list. */
export interface FsWatchEvt {
  readonly watchId: string
  /** 감시 대상(현재) 경로(상관·검증용). */
  readonly path: string
  /** 이 디바운스 윈도 동안 감시 디렉토리에 1건 이상 변경이 있었음. (증분 미전송 — refresh 트리거) */
  readonly kind: 'changed'
}
export interface FsWatchErrorEvt {
  readonly watchId: string
  readonly path: string
  readonly error: FileOpError  // EACCES/EPERM/ENOENT/ENOTSUP/EUNKNOWN — 감시 불가(격리, 수동 새로고침 유지)
}
```
`IpcRequestMap`/`IpcEventMap` 에 매핑 추가. **streamId 상관 규약과 동형**(watchId 로 묶음).
> **설계 정합 주석**: P1 "전 채널 동결"은 *기존 MVP* 채널 동결이 목적이며, `preview:read`·`shell:open-terminal`·`analyze:scan:*` 선례처럼 신기능 신규 채널 추가는 위반이 아니다(roadmap §0.5 주석 규약). `channels.ts` 에 "신규(J2)"로 명시하고 동일 guard/zod/Result 규약을 따른다.

### 0.3 guard zod 스키마 (`src/main/ipc/guard.ts`)
```ts
export const zFsWatchStartReq = z.object({ path: zPath })
export const zFsWatchStopReq = z.object({ watchId: z.string().min(1) })
```

### 0.4 coerce 화이트리스트 (`src/main/persistence/defaults.ts`)
- `VIEW_MODES` 확장: `new Set(['icons-large','icons-medium','icons-small','list','details'])`.
- `coercePanel` 의 viewMode 폴백 유지(미지의 값 → `'details'`).
- `coerceSidebar`: `favoriteLabels` 정규화(아래 J8) + 구버전(`favorites: string[]`만 있고 라벨 없음) → 빈 맵.
- `coerceSession`: `ui.previewWidth` 정규화(클램프 240~720, 비유한수 → undefined 생략).
- `SESSION_SCHEMA_VERSION` **유지(비파괴)** — J8 (A)안 확정으로 상향·마이그레이션 불요. J5 리브랜딩의 userData
  경로 변경도 마이그레이션 없음(출시 전, PM 확정) → 세션 스키마 영향 없음.

---

## J1. 파일 드래그 박스 선택(러버밴드)

### 목표
`FileListView` 빈 영역에서 pointer 드래그로 사각형(러버밴드)을 그려 교차하는 행을 선택. 가상 스크롤 정합
(보이는 행 + 드래그가 뷰포트 경계에 닿으면 자동 스크롤), Ctrl(기존 선택에 추가), Shift(범위 토글 누적).

### 변경 지점
- **신규** `src/renderer/domain/rules/boxSelect.ts` (순수 함수):
  ```ts
  export interface Rect { readonly top: number; readonly left: number; readonly bottom: number; readonly right: number }
  /** 정규화(시작점·현재점 → top<bottom). */
  export function normalizeRect(ax: number, ay: number, bx: number, by: number): Rect
  /** 행/그리드 셀의 (top,left,h,w)와 사각형 교차 판정. */
  export function intersectsCell(rect: Rect, cellTop: number, cellLeft: number, cellH: number, cellW: number): boolean
  /** rect 와 교차하는 visible 인덱스 집합 산출(윈도잉 무관 — 전체 인덱스 기하 계산). */
  export function indicesInRect(rect: Rect, opts: { colCount: number; cellH: number; cellW: number; count: number }): number[]
  ```
  > 기하 계산은 **전체 항목 인덱스**에 대해 수행한다(DOM 미렌더 행도 선택 대상). 행 위치 = `index → (row=floor(i/col), col=i%col)` → `(row*cellH, col*cellW)`. list/details 는 `colCount=1, cellW=뷰포트폭`.

- **신규** `src/renderer/app/stores/selectionSlice.ts` 액션 — 박스 선택 결과 반영:
  ```ts
  /** 러버밴드 종료 시 인덱스 집합 → 선택 반영. mode: 'replace'(기본) | 'add'(Ctrl) | 'toggle'(Shift). baseSelection 은 드래그 시작 시점 스냅샷. */
  boxSelect(panelId: string, visiblePaths: readonly string[], indices: readonly number[],
            mode: 'replace' | 'add' | 'toggle', base?: SelectionState): void
  ```
  - `domain/rules/selection.ts` 에 헬퍼 추가: `selectIndices(visiblePaths, indices): SelectionState`,
    `unionSelection(base, add)`, `toggleIndices(base, visiblePaths, indices)`. 기존 패턴(새 Set 통째 생성, immer 통째 교체) 준수.

- **변경** `src/renderer/ui/panel/views/FileListView.tsx`:
  - 신규 로컬 상태: `dragBox: { startX,startY,curX,curY,baseSelection } | null` (useRef + useState, 컨테이너 좌표계).
  - 스크롤 컨테이너 `onPointerDown`(빈 영역·좌클릭·행/리네임/DnD 소스가 아닐 때만): 러버밴드 시작.
    행 `FileRow` 의 `onMouseDown` 은 기존 유지(행 위 클릭은 박스 선택 미시작 — `e.stopPropagation` 또는 타깃 판정).
  - `window` pointermove/up 리스너(useDrag 패턴 재사용): 컨테이너 rect 기준 좌표 → `normalizeRect` → `indicesInRect`
    → `boxSelect` 호출(throttle: rAF). **자동 스크롤**: 커서가 뷰포트 상/하단 임계(예: 24px) 안이면
    `requestAnimationFrame` 루프로 `scrollRef.current.scrollTop += step`, 스크롤 후 rect 재계산.
  - 러버밴드 오버레이 `<div>` 렌더(절대배치, `tokens.color.accent` 반투명 + 1px 보더). totalHeight 컨테이너 내부.
  - Ctrl→`add`, Shift→`toggle`(시작 시 mods 캡처, 드래그 중 useDrag 처럼 keydown/up 으로 갱신은 v1 생략 — 시작 시점 고정).
  - **DnD 와의 충돌 회피**: 기존 행 `onPointerDown`(useDragSource)은 행에서만 시작. 빈 영역 박스 선택은 행이 아닌
    스크롤 컨테이너에서 시작 → 타깃이 행이면 무시. `DRAG_THRESHOLD`(5px) 동일 임계로 클릭과 구분.

### 신규 의존성
없음(자체 구현).

### DoD (측정가능)
- 빈 영역에서 5px 이상 드래그 시 러버밴드 박스가 보이고, 박스와 겹치는 행이 선택된다(`aria-selected`).
- 가상 스크롤: 1만 행에서 화면 밖 행도 박스에 포함되면 선택된다(`indicesInRect` 전체 인덱스 계산).
- 자동 스크롤: 커서를 뷰포트 하단에 두면 목록이 스크롤되며 선택 범위가 따라 확장된다.
- Ctrl 드래그=기존 선택 유지+추가, Shift 드래그=토글. 행 클릭/DnD/리네임 회귀 없음.
- `tests/domain.verify.ts` 에 `boxSelect.ts`(normalizeRect·indicesInRect·intersectsCell) 단위 케이스 추가, pass.

### QA 검증 포인트
- 그리드 보기(J4)와 동시 적용 시 `colCount>1` 에서 인덱스↔셀 좌표 매핑 정확성(교차 셀만 선택).
- 박스 선택 시작이 행/체크/리네임 input 위면 미시작(오작동 회귀).
- 스크롤 중 좌표 보정(컨테이너 rect + scrollTop) 누락 시 선택 어긋남 — 경계 테스트.

### 리스크/에스컬레이션
- (중) 자동 스크롤 rAF 루프 누수 → 드래그 종료/언마운트 시 cancel 보장. 미보장 시 PM 보고.
- (저) DnD 와 pointer capture 경합. 동일 `useDrag` 패턴(window 리스너·threshold)로 일관 처리.

---

## J2. 좌/우 패널 실시간 갱신 (파일시스템 워처)

> **PM 확정안 (단일)**: 패널이 **현재 보고 있는 디렉토리 1개만 `fs.watch`(non-recursive)** 로 감시한다.
> 목록 갱신엔 현재 폴더만 보면 충분하므로 `recursive: true` 는 사용하지 않는다(Windows 네트워크/대용량 트리
> 불안정 회피). 패널 경로 이동 시 이전 watch 중지 + 새 경로 watch 시작. 디바운스(200~300ms)로 연속 변경을
> 병합해 해당 패널을 재로드(증분 어려우면 단순 re-list). 네트워크/미지원/권한거부 드라이브는 **watcher 실패를
> 격리(throw 0)** 하고 수동 새로고침(Ctrl+R)을 유지한다. 폴링 폴백 없음(v1).

### 목표
패널이 **현재 보고 있는 디렉토리 1개**를 non-recursive 로 감시해 그 폴더 안의 외부 변경(생성·삭제·이름변경·이동)
시 해당 패널을 자동 재로드(단순 re-list). 디바운스·연속 변경 병합, 권한/네트워크/미지원 드라이브 예외 격리.
backend(워처) + frontend(브리지→refresh).

### 변경 지점 — backend
- **신규** `src/main/fs/WatchService.ts`:
  ```ts
  export interface WatchCallbacks {
    onChange: (path: string) => void          // 디바운스·병합 후 1회 (현재 디렉토리 변경 신호)
    onError: (path: string, e: FileOpError) => void
  }
  export class WatchService {
    /** node:fs.watch(path, { recursive: false }) 시작 — 현재 디렉토리 1개만 감시.
     *  실패(권한·미지원·네트워크)면 onError 후 throw 0(격리). watchId 만 발급(수동 새로고침 유지). */
    start(path: string, cb: WatchCallbacks): string   // watchId(randomUUID)
    stop(watchId: string): void
    stopAll(): void                                    // 창 종료/언마운트
  }
  export const watchService = new WatchService()
  ```
  - `fs.watch(path, { recursive: false })` 사용. **recursive 미사용**(하위 트리 미감시 — 목록 갱신엔 현재 폴더면 충분).
  - **디바운스 200~300ms + 병합**: 한 watchId 의 `change`/`rename` 이벤트는 타이머로 모았다가 1회 `onChange`.
    디바운스가 곧 대량 변경(예: 1000개 일괄 복사)도 1~수회로 묶는 흡수 역할(별도 throttle 불요 — 디바운스만으로 충족).
  - **예외 격리**: `watcher.on('error', ...)` → `toFileOpError` → `onError`(throw 금지). start 자체도 try/catch 로
    감싸 네트워크(UNC `\\\\`)·미지원 FS·권한거부 실패 시 `onError(EACCES/ENOTSUP/EUNKNOWN)` 후 watchId 발급 →
    렌더러는 해당 경로를 수동 새로고침으로 운용(폴링 폴백 없음 v1).
  - **경로 이동 = stop 후 start**: 워처는 watchId 당 1 디렉토리 독립 watcher(단순). 좌/우가 같은 경로여도
    각자 watchId 로 독립 watcher 를 둔다(non-recursive 단일 핸들이라 핸들 비용 낮음 — 디듀프 불요).

- **신규** `src/main/ipc/watch.handlers.ts` — `registerWatchHandlers()`:
  - `FS_WATCH_START`: guard(sender·zFsWatchStartReq·guardPath) → `watchService.start(g.value, { onChange: p => wc.send(FS_WATCH_EVENT, { watchId, path:p, kind:'changed' }), onError: (p,e)=>wc.send(FS_WATCH_ERROR,{watchId,path:p,error:e}) })` → `ok({ watchId })`. `wc.isDestroyed()` 가드(fs.handlers 스트림 패턴 동일).
  - `FS_WATCH_STOP`: `zFsWatchStopReq` → `watchService.stop(req.watchId)` → `ok(undefined)`.
  - `WebContents` `destroyed`/`render-process-gone` 에서 해당 wc 의 watchId 일괄 stop(누수 방지).
- **변경** `src/main/ipc/index.ts`: `registerWatchHandlers()` 호출 추가.
- **변경** `src/main/index.ts`: `before-quit`/`window-all-closed` 시 `watchService.stopAll()`(선택, 프로세스 종료로 자동 정리되나 명시).

### 변경 지점 — preload / infra
- **변경** `src/preload/api.ts` `ExplorerApi.fs` 에 추가:
  ```ts
  watchStart(req: FsWatchStartReq): Promise<Result<FsWatchStartRes>>
  watchStop(req: FsWatchStopReq): Promise<Result<void>>
  onWatchEvent(cb: (evt: FsWatchEvt) => void): Unsubscribe
  onWatchError(cb: (evt: FsWatchErrorEvt) => void): Unsubscribe
  ```
- **변경** `src/renderer/infra/api/index.ts`: `bridge().fs.watchStart/Stop/onWatchEvent/onWatchError` 노출(기존 패턴).

### 변경 지점 — frontend (브리지 → refresh)
- **신규** `src/renderer/app/usecases/watchBridge.ts` (operationsBridge 패턴):
  ```ts
  /** 각 패널이 현재 보는 디렉토리 1개를 감시. 패널 경로 이동/언마운트 시 이전 watch stop + 새 경로 start.
   *  panelId ↔ { path, watchId } 매핑 관리. */
  export function initWatchBridge(): void   // App 부팅 1회
  ```
  - 구현: store 구독으로 각 패널의 **현재 `path`** 변화를 추적 → 경로 변경 시 이전 watchId `watchStop` 후
    새 경로 `watchStart`(현재 디렉토리 1개만). `onWatchEvent` 수신 시 해당 watchId 를 보는 패널을
    `store.getState().refresh(panelId)` 로 재로드. `onWatchError` 수신 시 해당 watchId 매핑을 해제하고
    수동 새로고침 운용으로 전환(무음 격리 또는 1회 토스트).
  - **"내 PC"(빈 경로) 감시 제외**(드라이브 목록은 fs.watch 대상 아님). isMyPc(path) 면 start 안 함.
  - **증분 미적용 v1**: 변경 신호 = 현재 패널 단순 re-list(스트리밍 재로드). 디바운스로 빈도 억제.
  - **스크롤/선택 보존**: refresh 후 선택은 휘발(기존 동작)·스크롤은 panelsSlice 가 0 리셋 → v1 수용.
    (개선: refresh 시 selection 유지는 별도 태스크로 분리 — 본 계획 범위 밖, 리스크 표기.)
- **변경** `src/renderer/ui/App.tsx`: `useEffect` 에 `initWatchBridge()` 추가(initOperationsBridge 옆).
- **변경** (선택) `src/renderer/app/usecases/operationsBridge.ts` 와 중복 refresh 방지 — 내부 op 완료 refresh 와
  워처 refresh 가 겹쳐도 idempotent(load 재호출 안전)하므로 v1 허용. 단 **디바운스로 중복 폭주 차단**.

### 신규 의존성
없음(node 내장 `fs.watch`).

### DoD (측정가능)
- 패널이 보는 폴더에서 외부(탐색기/CLI)로 파일 생성/삭제 시 ~0.5s 내 패널 목록이 갱신된다(현재 디렉토리 한정).
- 좌/우 패널이 서로 다른 경로면 각자 독립 갱신, 같은 경로면 둘 다 갱신(watchId 독립).
- 패널 경로 이동 시 이전 디렉토리 watch 중지 + 새 디렉토리 watch 시작(핸들 수 일정).
- 권한 없는/네트워크/미지원 경로 감시 실패 시 `fs:watch:error` 1회 + 무음 격리(또는 토스트), 수동 새로고침 유지, 앱 크래시·무한루프 없음.
- 대량 변경(예: 1000개 파일 일괄 복사) 시 refresh 가 디바운스로 묶여 1~수회만 발생(병합 검증).
- 하위 폴더(감시 대상 아님) 내부 변경은 현재 패널을 갱신하지 않는다(non-recursive 의도된 동작).
- `npm run verify:*` 신규 하니스 `verify:watch`(WatchService 디바운스·병합·stop 누수·error 격리) 추가, pass.

### QA 검증 포인트
- watchId↔panelId 매핑 누수: 패널 경로를 빠르게 여러 번 바꿔도 이전 watcher 가 stop 되는지(핸들 수 일정).
- 창 종료 시 watcher 전부 해제(좀비 핸들 0).
- 디바운스 윈도 내 연속 변경이 1회 refresh 로 병합되는지(non-recursive 단일 디렉토리 변경 흐름).
- 워처 refresh 와 사용자 진행 중 작업(이름편집 input 열림) 충돌 — refresh 가 renameTarget 을 깨지 않는지.

### 리스크/에스컬레이션
- (중) **네트워크/미지원 드라이브 감시 실패**: `fs.watch`(non-recursive)도 일부 환경(UNC·일부 FS)에서
  미지원/오류 가능. v1 은 **격리(에러 후 비감시) + Ctrl+R 수동 새로고침** 으로 수용. 폴링 폴백은 후속.
  런타임 스모크 권장, 반복 실패 시 PM 보고.
- (중) refresh 시 선택/스크롤 휘발 → UX 저하. 보존 개선은 별도 태스크(에스컬레이션 후보).
- (저) 디바운스 파라미터(200~300ms) 튜닝 — 너무 짧으면 폭주, 길면 체감 지연. 실측 조정.

---

## J3. F5/F6 복사·이동 제거

> **PM 재확인**: `panelPaths()` 는 clipboard/trash/delete/rename/newFolder 등 **12개 호출처 공용 → 보존**.
> F5/F6 제거 범위는 `copyToOtherPanel`/`moveToOtherPanel` 함수 2 + 키바인딩 2 + commandBus case 2 만이다.
> **D&D 와 무관**(D&D 는 `panelPaths` 미사용). 신규 단축키 추가 없음.

### 회귀 핵심 결론 (코드 조사 결과)
- `panelPaths()` 는 **F5/F6 전용이 아니다.** `clipboardCopy/Cut/Paste`·`trashSelected`·`requestPermanentDelete`·
  `confirmPermanentDelete`·`createNewFolder`·`createNewFile`·`startRenameSelected` 등 **다수가 `panelPaths()` 의
  `activePanelId`/`activePath` 를 사용**한다(grep 확인: fileOps.ts 12곳). → **`panelPaths()` 함수는 보존**한다.
- `panelPaths()` 의 `otherPanelId`/`otherPath` 와 grid-4 `activeIdx ^ 1` 분기는 **`copyToOtherPanel`/`moveToOtherPanel`
  에서만 소비**된다. 두 함수를 제거하면 other* 산출은 dead 가 되지만, **D&D 는 `panelPaths` 를 쓰지 않는다**
  (D&D 는 `performDrop`/`dragState` 의 sourceDir/destDir 사용). → other* 계산만 단순화 가능하나, **타입 호환·미사용
  경고 최소화를 위해 `PanelPaths` 인터페이스와 other* 필드는 유지**하고 두 함수만 제거하는 보수적 안을 채택.

### 변경 지점
- **변경** `src/renderer/domain/keybindings/index.ts`: `baseBindings` 에서 `f5`(`panel.copyToOther`),
  `f6`(`panel.moveToOther`) 바인딩 2건 삭제. (그룹 "패널 작업" 이 비면 주석 정리.)
- **변경** `src/renderer/app/usecases/commandBus.ts`:
  - import 에서 `copyToOtherPanel`, `moveToOtherPanel` 제거.
  - `case 'panel.copyToOther'` / `case 'panel.moveToOther'` 블록 삭제(주석 헤더 포함).
- **변경** `src/renderer/app/usecases/fileOps.ts`:
  - `copyToOtherPanel()`·`moveToOtherPanel()` 함수 삭제.
  - `panelPaths()` 의 JSDoc 에서 "F5/F6 대상" 문구 정리(함수·other* 필드는 보존).
  - **선택**: grid-4 `activeIdx ^ 1` 분기는 other* 의 유일 소비처가 사라지므로 단순화 가능하나,
    회귀 위험을 줄이기 위해 **그대로 둔다**(dead 하지만 무해, 타입·테스트 영향 0). 제거는 별도 정리 태스크.
- **변경** `src/renderer/domain/rules/dragIntent.ts`: 상단 주석 "키보드(F5/F6)" 표현만 정리(로직 무변경 — D&D·붙여넣기 규칙 공유 유지).
- **ShortcutHelp / IconBar**: `ShortcutHelp.tsx` 는 `listShortcutGroups()`(keybindings 파생)를 렌더하므로 **자동 반영**(코드 수정 불필요). `iconBarItems.ts` 에 F5/F6 버튼 없음 → 변경 없음.
- **유지(회귀 금지)**: D&D(`useDrag`·`performDrop`·`dragIntent.decideDrop`)·클립보드(Ctrl+C/X/V) 전부 무변경.

### 신규 의존성 / 채널 / DTO
없음.

### DoD (측정가능)
- F5/F6 키 입력이 아무 동작도 하지 않는다(토스트·작업 모두 없음).
- 단축키 도움말(F1)에 "다른 패널로 복사/이동" 항목이 사라진다(keybindings 단일 출처 파생).
- D&D 복사/이동, Ctrl+C/X/V, 휴지통/영구삭제/새폴더/이름변경 전부 정상(panelPaths 보존).
- `npm run typecheck` 0, `npm run lint` 0(미사용 import 경고 없음), `verify:store`/`verify:operations` 영향 없음 pass.

### QA 검증 포인트
- `panelPaths()` 를 쓰는 8개 호출 경로(clipboard·trash·delete·rename·newFolder/File) 전수 정상 회귀.
- 2분할·grid-4 에서 클립보드/삭제/생성 동작 유지(other* 미사용이 부작용 없는지).
- `domain/keybindings` 중복 chord assert(레지스트리 부팅) 통과.

### 리스크/에스컬레이션
- (저) `panelPaths` 오제거 시 광범위 회귀 — **제거 금지 명시**. 리뷰에서 diff 가 함수 2개 + 바인딩 2개 + case 2개로 한정되는지 확인.

---

## J4. Windows "보기" 세트 (아이콘 대/중/소·목록·자세히)

> **PM 확정(보기 전환 UI)**: 보기 5종 전환은 **PanelToolbar 드롭다운/버튼(또는 우클릭 보기 메뉴)만**으로 제공한다.
> **v1 신규 단축키 없음.** `Ctrl+Shift+1~6` 등은 "후속 옵션(미구현)"으로 문서에만 남기고 키바인딩·commandBus 에
> 추가하지 않는다(아래 단축키 항목 정정 반영).

### 목표
`ViewMode` 를 5종으로 확장하고 `FileListView` 에 **아이콘 그리드 렌더**(기존 OS 아이콘 재사용·가상 스크롤 그리드)
추가, `PanelToolbar` 보기 드롭다운/버튼 확장, `panelsSlice.view` coerce. 가상화는 그리드(행당 N열) 지원.

### 변경 지점 — dto/coerce (backend 영역이지만 경량)
- **변경** `src/shared/dto/index.ts`: `ViewMode` 5종(0.1).
- **변경** `src/main/persistence/defaults.ts`: `VIEW_MODES` 화이트리스트 확장(0.4). `coercePanel` viewMode 폴백 `'details'` 유지.

### 변경 지점 — frontend
- **변경** `src/renderer/ui/theme/tokens.ts`: 그리드 셀 크기를 보기별로. 현재 `gridCell: { w:104, h:96 }` 단일 →
  ```ts
  gridCell: {
    large:  { w: 128, h: 120, icon: 64 },
    medium: { w: 104, h: 96,  icon: 48 },  // 기존 호환
    small:  { w: 80,  h: 72,  icon: 32 }
  }
  ```
  (기존 `tokens.gridCell.w/h` 참조처는 FileListView 내부뿐 → 함께 갱신.)
- **변경** `src/renderer/ui/panel/views/FileListView.tsx` (핵심):
  - `isGrid` 를 상수 false 에서 파생으로: `const isGrid = view.viewMode.startsWith('icons-')`.
  - 보기별 셀 크기: `const cell = isGrid ? gridCellFor(view.viewMode) : { h: tokens.rowHeight }`.
  - `colCount = isGrid ? max(1, floor(viewportW / cell.w)) : 1`, `cellH = isGrid ? cell.h : rowHeight`(기존 그리드 윈도잉 로직이 이미 colCount·cellH 를 받게 작성돼 있음 — 활성화만).
  - `FileRow` 에 그리드 모드 분기: 아이콘 그리드 셀(아이콘 위·이름 아래 2줄 ellipsis·중앙정렬). 기존 list/details 행은 유지.
    - 아이콘은 기존 `OSIcon`(iconCache/`shell:icon` H6 재사용) — 크기를 `cell.icon` 으로 확대 렌더(`<img width=icon height=icon>`).
      현재 OSIcon 은 16×16 고정 → `size` prop 추가(`OSIcon({ entry, size=16 })`).
  - 선택 하이라이트·드롭 하이라이트·러버밴드(J1) 모두 그리드 좌표(`left=col*cell.w, top=row*cell.h`)로 동작(기존 그리드 분기 재사용).
  - 키보드 이동(↑/↓): 그리드에서 ↑/↓ 는 ±colCount, ←/→ 는 ±1 로 확장(현재 ±1만). `moveSelect` 인덱스 계산에 colCount 반영.
- **변경** `src/renderer/ui/toolbar/PanelToolbar.tsx`: 보기 전환 버튼 영역(현재 details/list 2버튼) →
  **드롭다운(select) 또는 5버튼**. 권장: `<select value={view.viewMode} onChange={setViewMode}>` 로
  '아이콘(대/중/소)·목록·자세히' 5옵션. 라벨 한글. 기존 2버튼은 제거 또는 드롭다운으로 대체.
- **보기 전환 진입점 = 드롭다운/버튼만 [PM 확정]**: 보기 5종 전환은 위 `PanelToolbar` 드롭다운/버튼(또는
  우클릭 보기 메뉴)으로만 제공한다. **신규 단축키(`Ctrl+Shift+1~6` 등)는 v1 추가하지 않는다** → `keybindings/index.ts`·
  `commandBus.ts` 에 보기 전환 chord 추가 없음. `view.setMode.iconsLarge/Medium/Small` 커맨드는 드롭다운/메뉴가
  직접 `setViewMode` 를 호출하면 충분하므로 commandBus case 추가도 v1 불요(드롭다운 onChange → store 직접).
  > **후속 옵션(미구현)**: `Ctrl+Shift+1~6` 보기 단축키는 향후 별도 태스크로만 문서에 남긴다(DoD 아님).
- `panelsSlice.setViewMode(panelId, mode)` 는 시그니처 무변경(ViewMode 타입만 확장).

### 가상화 정합
- 기존 윈도잉이 이미 `rowCount = ceil(visible.length / colCount)`, `startRow/endRow` 로 그리드 대응 작성됨 →
  `isGrid`·`colCount`·`cellH` 만 실제 값으로 바꾸면 1만 항목 그리드도 DOM 수십 셀 유지.

### 신규 의존성 / 채널
없음(아이콘은 기존 `shell:icon`/iconCache 재사용).

### DoD (측정가능)
- 보기 드롭다운에서 5종 전환 가능, 각 모드가 즉시 반영(아이콘 크기·열 수 변화).
- 아이콘 보기에서 1만 항목 그리드가 가상 스크롤로 부드럽게 스크롤(DOM 노드 수 일정).
- 보기 모드가 세션에 저장·복원(`PanelSnapshot.viewMode` 5종 coerce 통과). 구버전('details')·미지값 폴백 정상.
- 그리드에서 클릭/Ctrl/Shift 선택·키보드 이동(↑↓←→)·러버밴드(J1) 정상.
- typecheck/lint 0, `verify:persistence`(VIEW_MODES coerce) 케이스 추가 pass.

### QA 검증 포인트
- 뷰포트 리사이즈 시 `colCount` 재계산·윈도잉 정합(빈 공간·겹침 없음).
- list↔grid 전환 시 scrollTop 보존/리셋 일관성.
- 그리드 아이콘 로드(`shell:icon` in-flight 디듀프)가 1만 항목에서 IPC 폭주 없는지(H6 캐시 재사용 확인).

### 리스크/에스컬레이션
- (중) **그리드 가상화 정확도**: colCount 계산·셀 좌표·오버스캔 경계. 리사이즈/스크롤 동시 시 깜빡임 가능 → 튜닝.
- (저) 아이콘 확대 렌더 품질(`app.getFileIcon` 해상도) — OS 제공 크기 한계. 큰 아이콘은 OS large icon 요청 필요 시 H6 backend 보강(별도).

---

## J5. AGT-Finder 리브랜딩

> **PM 확정값**: `productName = AGT-Finder` · `appId = com.agtfinder.app` · exe = `AGT-Finder.exe` ·
> 창 타이틀 / `<title>` / NSIS `shortcutName` / `AppUserModelId` 전부 **AGT-Finder**(전체 리네임).
> **userData 마이그레이션 없음 (사유: 출시 전·실사용자 없음)** — productName 변경으로 `%APPDATA%/AGT-Finder`
> 새 경로 사용을 수용하며, 기존 로컬 dev 상태 초기화를 허용한다(마이그레이션 스크립트 작성 불요).

### 변경 지점 (전수 목록)
- **`package.json`**: `name: "explorer"` → `"agt-finder"`(소문자·하이픈, npm 규칙), `description` 갱신,
  `author` 갱신(선택). `productName` 은 package.json 엔 없으므로 electron-builder 에서 지정.
- **`electron-builder.yml`**:
  - `appId: com.explorer.app` → **`com.agtfinder.app`**(확정).
  - `productName: Explorer` → **`AGT-Finder`**(→ 산출 exe `AGT-Finder.exe`, userData `%APPDATA%/AGT-Finder`).
  - `copyright` 갱신.
  - `nsis.shortcutName: Explorer` → **`AGT-Finder`**.
  - `win.icon` 경로 유지(아이콘 교체는 별도 — 리소스 자산 준비되면).
- **`src/renderer/index.html`**: `<title>Explorer</title>` → `<title>AGT-Finder</title>`.
- **`src/main/windows/mainWindow.ts`**: `title: 'Explorer'` → `'AGT-Finder'`.
- **`src/main/index.ts`**: `electronApp.setAppUserModelId('com.explorer.app')` → **`'com.agtfinder.app'`**
  (electron-builder appId 와 동일값 일치 — 작업표시줄 그룹화/알림 식별).
- **`src/preload/api.ts`**: `version: '0.1.0'` 유지(빌드 식별). About/표기에 제품명 쓰면 상수 추가 고려.
  `ExplorerApi` 인터페이스명은 **내부 타입명**이라 리브랜딩 필수 아님 — 변경 시 광범위(api.ts·index.d.ts·env.d.ts·infra/api) 동시 수정 필요하므로 **v1 유지**(사용자 노출 텍스트 아님). 변경은 선택.
- **`src/main/persistence/paths.ts`**: 주석 `%APPDATA%/Explorer/...` → `%APPDATA%/AGT-Finder/...` 로 정정
  (실제 경로는 `app.getPath('userData')` = productName 기반이라 productName 변경만으로 새 경로 사용).
  **마이그레이션 불요(사유: 출시 전)** — 기존 `%APPDATA%/Explorer` 잔존 dev 상태는 자연 초기화 허용.
- **`resources/`**: `icon.ico`·`icon.png` 교체는 자산 준비 후(브랜딩 일관). 미준비 시 기존 아이콘 유지(코드 변경 무관).
- **표기 검수 grep**: `Explorer`(노출 텍스트) 잔존 점검 — README·docs 는 범위 밖(제품 산출물만).

### 변경 지점 수 요약
사용자 노출/식별 핵심 = **6 파일**(package.json, electron-builder.yml, index.html, mainWindow.ts, main/index.ts AppUserModelId, + persistence/paths.ts 주석). 선택(내부 타입명 ExplorerApi) 제외.

### DoD (측정가능)
- 빌드·실행 시 창 타이틀·`<title>`·작업표시줄·NSIS 인스톨러/바로가기 이름이 모두 "AGT-Finder", exe = `AGT-Finder.exe`.
- `npm run build` 성공, `npm run package`(NSIS) 산출물명/productName = AGT-Finder.
- AppUserModelId(`com.agtfinder.app`) 와 appId 일치(작업표시줄 정상 그룹화).
- userData 가 `%APPDATA%/AGT-Finder` 로 생성(마이그레이션 없이 새 경로) — 실행 시 세션/설정 정상 신규 생성.

### QA 검증 포인트
- userData 가 `AGT-Finder` 경로로 생성·읽기/쓰기 정상(기존 `Explorer` 경로 미참조).
- 잔존 "Explorer" 사용자 노출 텍스트 0건(grep — 제품 산출물 범위).

### 리스크/에스컬레이션
- **[해소] userData 마이그레이션**: PM 확정 — **출시 전·실사용자 없음**으로 마이그레이션 미수행, 새 경로
  `%APPDATA%/AGT-Finder` 수용(기존 로컬 dev 상태 초기화 허용). 더 이상 에스컬레이션 대상 아님.
- (저) appId 변경 시 NSIS 가 기존 설치와 별개 제품으로 인식 — 신규 제품 출시이므로 정상(의도된 동작).

---

## J6. 미리보기 뷰어 상하 2단 (정보 카드 + 뷰어, 구문강조·마크다운)

### 목표
`PreviewPanel` 을 상단=파일 정보 카드(이름·크기·형식·수정일·경로) / 하단=뷰어로 재구성. 뷰어 형식 확장:
이미지(축소/맞춤)·텍스트·**코드 구문강조**·**마크다운(HTML 새니타이즈)**·미지원 폴백. 기존 `preview:read` 재사용.

### 변경 지점 — backend (경량)
- **변경** `src/main/fs/FileSystemService.ts#readPreview`:
  - 텍스트 분기에서 `lang`(확장자→highlight.js 언어 별칭) + `isMarkdown`(ext∈{md,markdown}) 필드 채움(0.1).
  - `PREVIEW_TEXT_EXTS` 확장(필요 시): 이미 광범위. 코드 확장자 추가분 점검(예: `vue,svelte,dart,scala,lua,r,m,pl` 등 — 선택).
  - 이미지/메타/unsupported 분기 무변경. **base64 5MB 상한 유지**(CSP img-src 'self' data: 준수).

### 변경 지점 — frontend
- **변경** `src/renderer/ui/preview/PreviewPanel.tsx`:
  - 패널 내부를 **2단 구조**로: 상단 정보 카드(고정 높이 auto) + 하단 뷰어(flex:1, minHeight:0, overflow). 헤더 "미리보기" 유지.
  - 정보 카드 컴포넌트 신규(아래) 렌더 — `data`(또는 path)로 이름·크기(formatSize)·형식(ext/폴더)·수정일·경로 표시.
  - 폭(width)을 `PANEL_WIDTH` 상수 → **`uiSlice.previewWidth` 구독**(J7 연동). 하드코딩 제거.
- **신규** `src/renderer/ui/preview/PreviewInfoCard.tsx`: `{ data: PreviewData | null; path: string | null }` →
  정보 카드(2열 라벨·값, OS 아이콘 + 이름·경로 복사 가능 표기). tokens 사용.
- **변경** `src/renderer/ui/preview/renderers/index.ts`: `kind:'text'` 디스패치를 세분 — `TextPreview` 내부에서
  `data.isMarkdown` → `MarkdownPreview`, `data.lang` 있으면 `CodePreview`(구문강조), 아니면 기존 plain `<pre>`.
  (또는 레지스트리에 `markdown`/`code` 항목 추가 없이 TextPreview 가 2차 분기 — 레지스트리 타입 안정 위해 **TextPreview 내부 분기** 권장.)
- **신규** `src/renderer/ui/preview/renderers/CodePreview.tsx`: highlight.js 로 `data.text` 강조.
  - `hljs.highlight(text, { language: data.lang })` 또는 `highlightAuto`. 결과 HTML 은 **highlight.js 가 escape 한
    안전 마크업**(토큰 span)이라 dangerouslySetInnerHTML 사용 가능하나, **추가 새니타이즈 1차 권장**(아래 보안).
  - highlight.js CSS 테마는 로컬 번들 import(CSP style-src 'self' 'unsafe-inline' OK).
- **신규** `src/renderer/ui/preview/renderers/MarkdownPreview.tsx`: 마크다운 렌더.
  - 파서(marked 또는 markdown-it) → HTML → **DOMPurify.sanitize** → `dangerouslySetInnerHTML`.
  - 코드 펜스는 marked highlight 옵션으로 highlight.js 연동(선택).
- **변경(이미지)** `src/renderer/ui/preview/renderers/ImagePreview.tsx`: "축소/맞춤" — `max-width:100%`,
  `object-fit:contain`, 패널 폭 변화(J7)에 반응. 기존 구현 점검 후 보강.

### 신규 의존성 판단 [PM 확정] (라이선스·CSP·번들)
> **PM 확정 조합 (3종 도입)**: `highlight.js`(BSD-3·eval-free) + `marked`(MIT) + **`DOMPurify`(마크다운 HTML
> 새니타이즈 필수)**. CSP `script-src 'self'` 에서 **eval 사용 0 확인 완료**, 미리보기 렌더러는 **React.lazy
> 청크 분리**(recharts 선례 — `DashboardModalBody` lazy 분리와 동형)로 메인 번들 비대화 방지.

| 라이브러리 | 용도 | 라이선스 | CSP | 번들 |
|---|---|---|---|---|
| **highlight.js** | 코드 구문강조 | **BSD-3-Clause** (permissive) | `script-src 'self'` 위반 없음(**eval 미사용** — 정적 토크나이저). CSS 는 'unsafe-inline' 불필요(로컬 .css import) | 코어 + 필요 언어만 등록(`hljs.registerLanguage`)해 트리셰이킹. 전체 import 금지 → `highlight.js/lib/common` 또는 선별 등록 |
| **marked** | 마크다운 → HTML | **MIT** | 위반 없음(eval 미사용) | 소형(~40KB) |
| **DOMPurify** | **마크다운 HTML 새니타이즈 (필수)** | **MPL-2.0 / Apache-2.0 듀얼** | 위반 없음 | 소형(~20KB) |

> **도입 게이트(확정 절차)**:
> (1) **CSP eval 0** — 3종 모두 `eval`/`new Function` 미사용으로 `script-src 'self'` 호환(설치 버전 빌드에서 재확인).
> (2) **DOMPurify 필수 적용** — 마크다운 렌더 HTML 은 `dangerouslySetInnerHTML` 직전 **항상 `DOMPurify.sanitize`** 통과.
> (3) **React.lazy 청크 분리** — 미리보기 렌더러(CodePreview·MarkdownPreview + highlight.js/marked/DOMPurify)를
>     lazy 로딩해 별도 청크로 분리(recharts `DashboardModalBody` lazy 선례 동형), 메인 진입 번들 비대화 방지.
> (4) highlight.js 는 `lib/common`(공통 언어 세트)만 — 전체 언어 import 금지.

### 보안 (마크다운 HTML 새니타이즈 — 필수)
- 마크다운 렌더 HTML 은 **항상 DOMPurify.sanitize 후** 주입. `<script>`·`on*` 핸들러·`javascript:` URL·외부 `<img src>`(원격) 차단.
- CSP 가 2차 방어(`script-src 'self'` → 인라인 스크립트 실행 자체 차단, `img-src 'self' data:` → 원격 이미지 차단). **DOMPurify + CSP 이중 방어**.
- highlight.js 출력은 escape 된 토큰 span 이나, marked 코드펜스 경유 시에도 DOMPurify 통과.

### DoD (측정가능)
- 미리보기 패널 상단에 정보 카드(이름·크기·형식·수정일·경로), 하단에 형식별 뷰어가 2단으로 보인다.
- `.png/.jpg` 이미지 = 맞춤 축소 렌더, `.txt` = plain, `.js/.ts/.py` = 구문강조, `.md` = 렌더된 마크다운, 바이너리 = 미지원 폴백.
- 마크다운에 `<script>alert(1)</script>` 가 있어도 실행 안 됨(DOMPurify + CSP). XSS 0.
- `npm run build` 성공(신규 의존성 번들 포함·청크 분리 확인), CSP 위반 콘솔 에러 0.
- typecheck/lint 0. (선택) `verify:p6-backend` 에 readPreview lang/isMarkdown 케이스 추가 pass.

### QA 검증 포인트
- 대용량 텍스트(64KB truncated) 구문강조 성능(메인 스레드 블로킹) — 큰 파일 강조 시 지연.
- 마크다운 XSS 페이로드 다양체(이미지 onerror·svg·iframe) 전부 차단.
- 패널 폭 변경(J7) 시 이미지/코드 줄바꿈·가로 스크롤 정합.
- highlight.js 미등록 언어 → 폴백(plain 또는 auto) 무오류.

### 리스크/에스컬레이션
- (높) **마크다운 HTML 새니타이즈 보안**: DOMPurify 미적용/우회 시 XSS. 코드 리뷰 필수 게이트.
- (중) **번들 비대화**: highlight.js 전체 import 금지(언어 선별). 미리보기 렌더러 lazy 청크 분리 검토.
- (중) **CSP eval**: 도입 라이브러리 버전이 eval/new Function 사용하면 `script-src 'self'` 위반 → 빌드 전 점검, 위반 시 대체 라이브러리(PM 보고).

---

## J7. 미리보기 패널 폭 조절

### 목표
기존 `ui/layout/SplitDivider.tsx`(H3) 재사용해 PreviewPanel 좌측 경계 드래그로 폭 변경. `uiSlice.previewWidth`(클램프) + 세션 영속.

### 변경 지점
- **변경** `src/renderer/app/stores/uiSlice.ts`:
  - 상태 `readonly previewWidth: number` 추가(기본 320).
  - 액션 `setPreviewWidth(px: number): void` — **클램프 240~720**(Math.max/min). Immer.
  - 초기값 `previewWidth: 320` 추가.
- **변경** `src/renderer/ui/preview/PreviewPanel.tsx`:
  - `PANEL_WIDTH` 상수 제거 → `const width = useRootStore(s => s.previewWidth)` 구독. `flex: '0 0 {width}px'`.
  - 패널 **좌측 경계에 SplitDivider 배치**(orientation='vertical'). SplitDivider 는 `containerRef` + `onDrag(ratio)`
    콜백 기반이라, 미리보기는 비율이 아니라 px 폭이 필요 → **두 가지 안**:
    - (안1·권장) SplitDivider 를 그대로 쓰되, `containerRef` = App 의 본문 컨테이너(`flex` row 영역), `onDrag(ratio)`
      에서 `previewWidth = clamp((1-ratio) * containerWidth)` 로 환산. 컨테이너 폭은 ref rect 로 측정.
    - (안2) 경량 전용 드래그 핸들(useDrag 패턴) — px 직접. SplitDivider 재사용 요구사항상 **안1 채택**.
  - 더블클릭 → `setPreviewWidth(320)`(기본 복귀, onReset).
- **변경(레이아웃)** `src/renderer/ui/App.tsx`: 본문 `<div flex row>` 안 `LayoutHost` 와 `PreviewPanel` 사이에
  divider 가 들어가도록 구조 조정(PreviewPanel 내부 좌측 보더 자리에 SplitDivider). containerRef 측정을 위해 본문 div 에 ref 부여.
- **변경(영속)**:
  - `src/shared/dto/index.ts`: `SessionSnapshot.ui.previewWidth?`(0.1).
  - `src/renderer/app/usecases/session.ts#buildSessionSnapshot`: `ui: { theme, previewOpen, previewWidth: s.previewWidth }`.
  - `src/renderer/app/usecases/session.ts#applySnapshot`: 복원 시 `store.getState().setPreviewWidth(snap.ui.previewWidth ?? 320)`.
  - `src/main/persistence/defaults.ts#coerceSession`: `ui.previewWidth` 정규화(클램프 240~720, 비유한수 생략) — 0.4.
  - `defaultSession()` ui 에 previewWidth 기본은 생략(undefined → 복원 측 320 폴백) 또는 320 명시.

### 신규 의존성 / 채널
없음.

### DoD (측정가능)
- 미리보기 패널 좌측 경계를 드래그하면 폭이 240~720 범위에서 실시간 변경된다.
- 더블클릭 시 320 기본 복귀.
- 폭이 세션에 저장·복원되며, 구버전 세션(previewWidth 없음)은 320 폴백(coerce).
- typecheck/lint 0, `verify:persistence`(previewWidth coerce 클램프) 케이스 추가 pass.

### QA 검증 포인트
- 드래그 중 컨테이너 rect 측정 정확성(사이드바 토글·창 리사이즈 시 환산 일관).
- 클램프 경계(최소/최대)에서 더 못 줄어듦.
- previewOpen=false 시 divider 미표시(폭 미차지).

### 리스크/에스컬레이션
- (저) SplitDivider 의 ratio→px 환산이 본문 컨테이너 폭 기준이라, 사이드바 폭 변화와 결합 시 환산 오차 → containerRef 를 미리보기 포함 본문 row 로 일관 측정.

---

## J8. 즐겨찾기 별칭 변경

### 목표
`sidebarSlice.favorites` 에 별칭(label)을 부여하고, `Sidebar` 즐겨찾기 행에 이름변경 UI(더블클릭→인라인 input),
`SidebarSnapshot` 영속·coerce 마이그레이션(구버전 `string[]` 호환).

### 데이터 구조 결정 [PM 확정 — (A) 라벨 맵 분리]
**(A)안 확정**: `favorites: string[]`(경로·순서 유지) + `favoriteLabels?: Record<string,string>`(별칭 맵, 비파괴 추가).
별칭 없으면 `basename(path)` 폴백. **스키마 버전 미상향**, coerce 가 구버전 `string[]`(라벨 없음)을 호환.
(B)안(`FavoriteEntry[]` 교체)은 폐기. 사유: 기존 `toggleFavorite`/`removeFavorite`/`addFavorite`/`isFavorite`/
`hydrateSidebar`/`buildSessionSnapshot` 회귀 최소, 순서 보존, coerce 단순.

### 변경 지점 — store
- **변경** `src/renderer/app/stores/sidebarSlice.ts`:
  - 상태 `readonly favoriteLabels: Record<string, string>` 추가(초기 `{}`).
  - 액션:
    ```ts
    /** 즐겨찾기 별칭 설정(빈 문자열이면 별칭 제거 → baseName 표시). */
    setFavoriteLabel(path: string, label: string): void
    /** 별칭 조회(없으면 undefined → UI 가 baseName 폴백). */
    favoriteLabelOf(path: string): string | undefined
    ```
  - `removeFavorite(path)`: 제거 시 `delete favoriteLabels[path]` 동반(고아 라벨 정리).
  - `hydrateSidebar(data)`: 인자에 `favoriteLabels?: Record<string,string>` 추가 → 주입.
- **변경** `src/renderer/app/stores/types.ts`: SidebarSlice 타입 시그니처 반영(인터페이스가 sidebarSlice.ts 에 있으면 그곳).

### 변경 지점 — UI
- **변경** `src/renderer/ui/sidebar/Sidebar.tsx`:
  - `FavoriteRow`: 라벨 = `favoriteLabelOf(path) ?? baseName(path)`. **더블클릭 → 인라인 편집** 진입
    (로컬 state 또는 별도 `editingFavorite` — FileListView 의 RenameInput 패턴 경량 재사용).
  - 인라인 input: Enter=커밋(`setFavoriteLabel`), Esc=취소, blur=커밋. 빈 값 커밋=별칭 제거.
  - `PinnedRow` 에 `editable`·`onRename` prop 추가 또는 FavoriteRow 전용 분기(RecentRow 는 미편집 유지).
  - title(tooltip)은 fullPath 유지(별칭이 baseName 을 가려도 경로 확인 가능).

### 변경 지점 — 영속 / coerce
- **변경** `src/shared/dto/index.ts`: `SidebarSnapshot.favoriteLabels?: Record<string,string>`(0.1).
- **변경** `src/renderer/app/usecases/session.ts#buildSessionSnapshot`: `sidebar.favoriteLabels: { ...s.favoriteLabels }`.
- **변경** `src/renderer/app/usecases/session.ts#applySnapshot`: `hydrateSidebar({ ..., favoriteLabels: snap.sidebar.favoriteLabels })`.
- **변경** `src/main/persistence/defaults.ts#coerceSidebar`:
  - `favoriteLabels` 정규화: 객체이고 값이 string 인 항목만, **키가 실제 favorites 에 존재하는 것만** 보존(고아 제거).
  - 구버전(favoriteLabels 없음) → `{}`. `defaultSidebar()` 에 `favoriteLabels: {}` 추가(선택 — 미지정 시 coerce 가 {} 부여).
  - `SidebarSnapshot` 반환 객체에 `favoriteLabels` 포함.

### 마이그레이션 (구버전 호환)
- 구 세션: `sidebar.favorites: string[]` 만 존재, `favoriteLabels` 없음 → coerce 가 `{}` 부여, UI 는 basename 표시(동작 동일).
- 스키마 버전: **(A)안 비파괴 → `SESSION_SCHEMA_VERSION` 유지(미상향)**. 추가 필드만 선택적.

### 신규 의존성 / 채널
없음.

### DoD (측정가능)
- 즐겨찾기 행 더블클릭 → 인라인 편집 → 별칭 저장, 사이드바에 별칭 표시(경로는 tooltip).
- 별칭을 빈 값으로 커밋하면 baseName 으로 복귀.
- 별칭이 세션에 저장·복원, 구버전 세션은 무오류(baseName).
- 즐겨찾기 제거 시 라벨 고아 없음. typecheck/lint 0, `verify:persistence`(coerceSidebar favoriteLabels·고아 제거) 케이스 추가 pass.

### QA 검증 포인트
- 같은 baseName 의 서로 다른 경로 2개에 다른 별칭 부여 → 독립 표시.
- 별칭 편집 중 다른 곳 클릭(blur) 커밋, Esc 취소.
- 구버전 string[] 세션 로드 시 크래시 없음.

### 리스크/에스컬레이션
- **[해소]** 데이터 구조 — PM 이 (A) 라벨 맵 분리로 확정. (B)안(FavoriteEntry[]) 폐기 → 스키마 버전·마이그레이션 불요. 추가 에스컬레이션 없음.

---

## 요약 보고 (사용자 요청 a~e)

### (a) 신규 채널 / DTO 목록
**신규 IPC 채널 — J2(FS 워처)만, 4종**:
`fs:watch:start`(invoke→`Result<{watchId}>`) · `fs:watch:event`(푸시) · `fs:watch:stop`(invoke→`Result<void>`) · `fs:watch:error`(푸시).
`EVENT_CHANNELS` 에 `fs:watch:event`·`fs:watch:error` 추가. 신규 contracts: `FsWatchStartReq/Res`·`FsWatchStopReq`·`FsWatchEvt`·`FsWatchErrorEvt`. guard: `zFsWatchStartReq`·`zFsWatchStopReq`. **watchId 상관 규약(streamId 동형).**

**신규/변경 DTO (`shared/dto`)**:
- `ViewMode` 5종 확장(J4): `icons-large|icons-medium|icons-small|list|details`. (보기 전환은 드롭다운/버튼만 — 신규 단축키 없음)
- `SidebarSnapshot.favoriteLabels?: Record<string,string>`(J8 — **(A) 라벨 맵 분리 확정**, `favorites: string[]` 유지·비파괴, 스키마 버전 미상향, 별칭 없으면 basename 폴백).
- `SessionSnapshot.ui.previewWidth?: number`(J7).
- `PreviewData.lang?`·`isMarkdown?`(J6, 텍스트 분기 힌트).
- (FS 워처 외) **신규 채널 0** — 나머지 7건은 기존 채널/dto 확장으로 충족.

**coerce 확장(`defaults.ts`)**: `VIEW_MODES` 5종 · `coerceSidebar.favoriteLabels`(고아 제거) · `coerceSession.ui.previewWidth`(클램프 240~720). **SESSION_SCHEMA_VERSION 유지(비파괴)**.

### (b) 신규 의존성 판단 [PM 확정] (구문강조·마크다운 — 라이선스/CSP/번들)
- **highlight.js** (BSD-3-Clause, **eval-free → `script-src 'self'` 호환**, `lib/common` 선별로 번들 최소) — 코드 구문강조.
- **marked** (MIT, eval 미사용, ~40KB) — 마크다운 파싱.
- **DOMPurify** (MPL-2.0/Apache-2.0, ~20KB) — **마크다운 HTML 새니타이즈 필수**(XSS 방어, CSP 와 이중).
- 도입 게이트(확정): (1) 3종 eval/new Function 0 → CSP `script-src 'self'` 호환, (2) 미리보기 렌더러
  **React.lazy 청크 분리**(recharts 선례), (3) DOMPurify 를 `dangerouslySetInnerHTML` 직전 필수 적용,
  (4) highlight.js `lib/common` + CSS 로컬 import. **그 외 7개 기능은 신규 의존성 0.**

### (c) F5/F6 제거 회귀 범위
- **제거 대상(한정)**: `keybindings/index.ts` f5/f6 바인딩 2건 · `commandBus.ts` case 2건 + import · `fileOps.ts` `copyToOtherPanel`/`moveToOtherPanel` 함수 2건.
- **보존 필수**: `panelPaths()` 함수 — **F5/F6 전용 아님**. clipboard(copy/cut/paste)·trash·delete·newFolder/File·rename
  등 fileOps 내 **12개 호출처가 activePath 사용**. 오제거 시 광범위 회귀.
- **D&D 무관**: D&D 는 `panelPaths` 미사용(performDrop·dragState 의 sourceDir/destDir). other*·grid-4 `activeIdx^1`
  분기는 dead 가 되나 **무해하므로 보존**(타입·테스트 영향 0).
- ShortcutHelp 는 keybindings 파생이라 **자동 반영**(수정 불필요). 회귀 표면 = **3 파일, diff 한정**.

### (d) 리브랜딩 변경 지점 수 [PM 확정값]
**확정값**: productName=`AGT-Finder` · appId=`com.agtfinder.app` · exe=`AGT-Finder.exe` · 창 타이틀/`<title>`/
NSIS `shortcutName`/`AppUserModelId` 전부 AGT-Finder.
**사용자 노출/식별 핵심 6 파일**: `package.json`(name/description) · `electron-builder.yml`(appId/productName/copyright/nsis.shortcutName) ·
`src/renderer/index.html`(title) · `src/main/windows/mainWindow.ts`(title) · `src/main/index.ts`(setAppUserModelId) ·
`src/main/persistence/paths.ts`(주석 정정). **선택**: `resources/icon.*` 교체(자산 준비 후), 내부 타입명 `ExplorerApi`(미노출 — v1 유지).
**마이그레이션 없음 [확정]**: productName 변경으로 userData 가 `%APPDATA%/AGT-Finder` 새 경로 사용 — 출시 전·실사용자
없으므로 마이그레이션 스크립트 불요, 기존 로컬 dev 상태 초기화 허용.

### (e) frontend / backend / devops 분담
| 계층 | 담당 항목 |
|---|---|
| **backend** | J2 워처(`WatchService`·`watch.handlers`·guard·index 등록·stopAll) · J4 dto ViewMode·coerce VIEW_MODES · J6 `readPreview` lang/isMarkdown · J7·J8 coerce(previewWidth·favoriteLabels) · 신규 채널/contracts/guard 동결(0.1~0.4) |
| **frontend** | J1 박스선택(boxSelect·selectionSlice·FileListView·자동스크롤) · J4 그리드 보기 렌더·PanelToolbar 드롭다운·OSIcon size · J6 PreviewPanel 2단·CodePreview·MarkdownPreview·InfoCard · J7 previewWidth·SplitDivider 연동·세션 직렬화 · J8 favoriteLabels·Sidebar 인라인 편집 · J3 F5/F6 제거(keybindings·commandBus·fileOps) · J2 watchBridge·preload/infra 노출·App 마운트 |
| **devops** | J5 리브랜딩 패키징(package.json·electron-builder.yml·appId/AppUserModelId·NSIS·아이콘 자산) · J6 신규 의존성 설치/번들 검증(highlight.js·marked·DOMPurify, eval/CSP/lazy 청크) · 신규 `verify:watch` 하니스 골격 · userData 마이그레이션 결정 보조 |

> **병렬 출발선**: §0(채널·DTO·coerce·guard) 동결 후 backend(워처·dto·coerce)와 frontend(나머지 6건)가 동시 착수.
> J3(F5/F6 제거)·J5(리브랜딩)는 의존성 없어 즉시 가능. J7·J8 은 dto/coerce(backend) 선행 후 frontend 영속 연결.
> J6 은 devops 의존성 도입 → frontend 렌더러 순.

### 권장 구현 순서 (단계)
1. **§0 계약 동결**(채널·DTO·coerce·guard·preload 타입) — 병렬 출발선.
2. J3(F5/F6 제거)·J5(리브랜딩) — 독립·저위험 선행.
3. J4(보기 세트)·J1(박스 선택) — FileListView 동시 작업(같은 파일 → 통합 지점 주의, 그리드 좌표 공유).
4. J7(미리보기 폭)·J8(즐겨찾기 별칭) — 영속 연동.
5. J2(워처 — 현재 디렉토리 non-recursive·디바운스·격리) — backend 워처 + frontend 브리지, 런타임 스모크 필요.
6. J6(미리보기 뷰어) — 신규 의존성·보안 게이트(DOMPurify) 최종.

각 단계는 reviewer(세부계획 검증) → 구현 → qa-engineer(계획 대비 검증, 경계면 교차) 루프. 검증 2회 실패 시 PM 에스컬레이션.
