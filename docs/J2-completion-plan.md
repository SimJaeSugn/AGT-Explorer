# J2 완성 계획서 — 실시간 갱신 v1 보류 2건 (feat-J2 / US-9.2)

> 작성: 테크리드 · 2026-06-07 · 상태: **계획(구현 미착수)**
> 대상: US-9.2 잔여 수용기준 2건 — (1) 갱신 시 선택/스크롤 보존, (2) 네트워크/미지원 드라이브 폴링 폴백
> 입력 읽음: `src/main/fs/WatchService.ts`·`src/main/ipc/watch.handlers.ts`·`src/renderer/app/usecases/watchBridge.ts`·`src/renderer/app/stores/panelsSlice.ts`·`src/renderer/app/stores/selectionSlice.ts`·`src/renderer/ui/panel/views/FileListView.tsx`·`src/renderer/domain/paths/index.ts`·`src/main/fs/paths.ts`·`src/main/fs/FileSystemService.ts`·`src/shared/ipc/contracts.ts`·`scripts/verify-watch.ts`
> 컨벤션: Immer(panels)·selection 통째 교체(ADR-002)·Result(ADR-003)·디바운스·격리 throw 0·verify 헤드리스(esbuild→node)

---

## 0. 현재 인프라 요약 (확장 기반)

- **backend 워처**: `WatchService.start(path, cb)` → `fs.watch(path, { recursive:false })`. 디바운스 250ms(`schedule`), 격리 throw 0(start/워처 error 모두 onError 후 watchId 발급), `stop`/`stopAll`/`stopAllForSender` 멱등·누수 0. `onEvent(path)` 1회 신호만(증분 미전송 — 렌더러 re-list).
- **IPC**: `fs:watch:start`(→`{watchId}`)·`fs:watch:stop`·푸시 `fs:watch:event{watchId,path}`·`fs:watch:error{watchId,error}`. (`channels.ts`·`contracts.ts` 동결)
- **frontend 브리지**: `watchBridge.ts` — 패널 경로 변화 추적(store.subscribe), 경로별 watchStart/watchStop, `onEvent`→`st.refresh(panelId)`, `onError`→매핑 해제·무음 격리.
- **refresh 경로**: `panelsSlice.refresh(panelId)` → `load(panelId, cur.path)` → `disposeStream` 후 `startStream`(재-list). **`startStream` 진입 시 `directory`를 `{status:'loading', entries:[]}`로 리셋** → 선택/스크롤이 휘발하는 지점.
- **선택**: `selectionSlice.selection[panelId]: SelectionState{anchorIndex, selectedPaths:Set<string>}`. 경로 기반(인덱스 아님 — 보존에 유리). 통째 교체 규약.
- **스크롤**: `Panel.scrollTop`(store)와 `FileListView`의 로컬 `useState(scrollTop)`이 **이중 존재**. 현재 store의 `scrollTop`은 **세션 복원용으로만 기록**되고 FileListView는 로컬 state·`scrollRef.current.scrollTop`(DOM)으로 윈도잉을 그린다. navigate/navBack 등은 `p.scrollTop=0`만 설정하나 FileListView 로컬 state는 별도 → **현재 navigate 시 DOM scrollTop은 컨테이너 재마운트(키 변화 없음)로 0이 보장되지 않는 잠재 이슈가 있으나 본 계획 범위는 "워처발 갱신 보존"이므로 그 경로를 정밀화한다.**

---

## 1. 보류 1 — 갱신 시 선택/스크롤 보존

### 1.1 설계 개요 (refresh 모드 분기)

워처발 갱신과 사용자 명시 행위를 **모드로 구분**한다.

| 행위 | 진입점 | 선택 | 스크롤 | 비고 |
|---|---|---|---|---|
| 워처발 갱신 | `watchBridge.onEvent` → `softRefresh(panelId)` | **보존**(교집합) | **보존**(클램프) | 경로 동일 |
| 수동 새로고침(Ctrl+R / 컨텍스트 "새로고침") | `refresh(panelId)` | **보존**(동일) | **보존** | 경로 동일 — 보존이 자연스러움 |
| navigate(경로 변경) | `navigate`/`navBack`/`navForward`/`navUp` | **초기화** | **0** | 경로 변경 = 컨텍스트 리셋(기존 유지) |
| refreshAll(숨김 토글 등) | `refreshAll` | **보존** | **보존** | 경로 동일 |

**결정**: 경로가 **바뀌지 않는 모든 재-list(refresh·softRefresh·refreshAll)는 보존**, 경로가 **바뀌는 navigate 계열은 초기화**. 워처발 전용 `softRefresh`는 별도 진입점으로 두되 내부적으로 보존 옵션을 켠 `load`를 호출(수동 refresh와 구현 공유).

### 1.2 캡처/복원 메커니즘 (panelsSlice)

재-list는 비동기(스트리밍)라서 "재-list 시작 시점에 selectedPaths·scrollTop을 캡처 → done 시점에 새 entries 집합과 교집합으로 selection 재적용 + scrollTop 복원"이 필요하다. 캡처값은 **슬라이스 외부 비직렬화 맵**(`streamDisposers`와 동형)에 보관한다.

```ts
// panelsSlice.ts (모듈 스코프, 비직렬화 자원)
interface PreserveSnapshot {
  selectedPaths: ReadonlySet<string>
  anchorPath: string | null   // anchorIndex 대신 "경로"로 보존(재-list 후 인덱스 재계산)
  scrollTop: number
}
const preserveSnapshots = new Map<string, PreserveSnapshot>()
```

> **핵심 불변식(중대-1 반영)**: `SelectionState.anchorIndex`는 `selection.ts`의 연산들이
> 받는 **`visiblePaths`(= `computeVisible(panel)` 결과) 순서의 인덱스**다 (`directory.entries`의
> raw 인덱스가 아님). 따라서 anchor 캡처/복원은 **반드시 `computeVisible` 결과 기준**으로 환산한다.
> `directory.entries[anchorIndex]`로 환산하면 정렬·필터가 걸린 패널에서 엉뚱한 항목을 가리킨다.

#### 변경 함수 시그니처 (panelsSlice.ts)

```ts
// 기존 시그니처 확장(옵션 추가, 기본값으로 하위호환).
load(panelId: string, path: string, opts?: { preserve?: boolean }): void
refresh(panelId: string, opts?: { preserve?: boolean }): void   // 기본 preserve:true (경로 동일 → 보존)
refreshAll(opts?: { preserve?: boolean }): void                 // 기본 preserve:true
startStream(panelId: string, path: string, preserve: boolean): Promise<void>
loadMyPc(panelId: string, preserve: boolean): Promise<void>     // 내 PC(드라이브)도 동일 규약(보통 보존 불필요하나 일관성)

// 신규: 워처발 전용 진입점(보존 강제). watchBridge 가 호출.
softRefresh(panelId: string): void   // = refresh(panelId, { preserve: true }) 와 동치, 의미 명시용 별도 export
```

`PanelsSlice` 인터페이스에 `softRefresh(panelId: string): void` 추가, `refresh`/`refreshAll` 시그니처에 옵션 추가.

#### 캡처 (재-list 시작 직전)

`load(panelId, path, { preserve:true })` 호출 시, `startStream`이 `directory`를 리셋하기 **직전에** 캡처:

```ts
import { computeVisible } from '@renderer/app/usecases/selectors'

function capturePreserve(panelId: string): void {
  const sel = get().selection[panelId]
  const p = get().panels[panelId]
  if (!p) return
  // anchorIndex 는 computeVisible(정렬·필터 후 visible) 순서의 인덱스 → 같은 순서에서 경로 환산.
  // (directory.entries[anchorIndex] 아님 — 그건 raw 순서라 정렬/필터 시 어긋남.)
  const visible = computeVisible(p)              // 메모 적중 시 동일 참조(추가 비용 0)
  const anchorPath =
    sel && sel.anchorIndex >= 0 ? (visible[sel.anchorIndex]?.path ?? null) : null
  preserveSnapshots.set(panelId, {
    selectedPaths: sel ? new Set(sel.selectedPaths) : new Set(),
    anchorPath,
    scrollTop: p.scrollTop   // store scrollTop(아래 1.3 에서 onScroll 미러로 항상 최신화)
  })
}
```

> **주의(리스크 R1, 중대-1 확정)**: `selectedPaths`는 **경로 기반**이라 재-list 후 이름·정렬이
> 바뀌어도 안정적이다(보존 우선). `anchorIndex`는 **`computeVisible` 결과(정렬·필터 후 visible)
> 순서의 인덱스**이므로 캡처는 `computeVisible(p)[sel.anchorIndex]?.path`로 환산하고, 복원은
> **새 패널의 `computeVisible` 결과에서 anchorPath 인덱스를 재탐색**한다(`entries.findIndex` 아님).
> anchor 복원은 best-effort(못 찾으면 selectedPaths 잔존 첫 항목 또는 -1)로 두고 selectedPaths
> 교집합 보존을 우선한다.

#### 복원 (재-list done 직후)

`_onDone`에서 보존 스냅샷이 있으면 적용. selection은 selectionSlice 액션을 통해 통째 교체.

```ts
// _onDone(panelId, streamId, total, truncated) 말미
const snap = preserveSnapshots.get(panelId)
if (snap) {
  preserveSnapshots.delete(panelId)
  get()._applyPreserve(panelId, snap)
}

// 신규 내부 액션(selection + scroll 동시 복원).
_applyPreserve(panelId, snap): void {
  const p = get().panels[panelId]
  if (!p) return
  // (a) anchor 복원도 computeVisible(정렬·필터 후 visible) 순서에서 재탐색(entries.findIndex 아님).
  //     캡처 시 anchorPath 가 visible[anchorIndex] 였으므로 환산 기준이 일치해야 한다.
  const visible = computeVisible(p)
  const livePaths = new Set(visible.map((e) => e.path))
  // selection 교집합: 새 visible 에 여전히 존재하는 경로만 유지.
  const kept = new Set<string>()
  for (const path of snap.selectedPaths) if (livePaths.has(path)) kept.add(path)
  let anchorIndex = -1
  if (snap.anchorPath && livePaths.has(snap.anchorPath)) {
    anchorIndex = visible.findIndex((e) => e.path === snap.anchorPath)  // visible 인덱스
  } else if (kept.size > 0) {
    // anchor 가 사라졌으면 잔존 선택 중 visible 순서상 첫 항목을 anchor 로(best-effort).
    anchorIndex = visible.findIndex((e) => kept.has(e.path))
  }
  // selectionSlice: 통째 교체(ADR-002). 신규 액션 setSelection 사용.
  get().setSelection(panelId, { anchorIndex, selectedPaths: kept })
  // (b) scrollTop 복원: 명시적 1회성 플래그를 set(중대-3). store scrollTop 자체는
  //     onScroll 미러의 단일 출처이므로 여기서 덮어쓰지 않고, "이번 done 1회만 복원" 플래그만 둔다.
  set((s) => {
    const pp = s.panels[panelId]
    if (pp) pp.pendingScrollRestore = snap.scrollTop   // number | null. FileListView 가 1회 소비.
  })
  // 실제 DOM 클램프·플래그 소거는 FileListView useEffect 가 status==='ready'+totalHeight 확정 시 수행(1.3).
}
```

`_onError`에서도 보존 스냅샷이 있으면 **버린다**(에러 시 복원 안 함 — 안전). `pendingScrollRestore`도
set하지 않는다.

> **`pendingScrollRestore` 필드(신규, 중대-3)**: `Panel` 타입에 `pendingScrollRestore: number | null`
> 추가(기본 `null`). `_applyPreserve`만 set, FileListView가 소비 즉시 `null`로 소거(1회성). nonce가
> 아니라 "복원할 scrollTop 값"을 직접 담아 store `scrollTop`(onScroll 미러)과 **경합·덮어쓰기 없음**.

### 1.3 스크롤 store↔DOM 단일화 (FileListView)

현재 FileListView는 로컬 `scrollTop` state로 윈도잉을 그리고 store `scrollTop`을 무시한다. 보존을 위해 **store `scrollTop`을 단일 출처로 승격**한다(최소 변경):

- `setScrollTop(panelId, top)`를 **onScroll에서 호출**(현재는 로컬 state만 갱신) → store가 항상 최신. 디바운스(예 rAF/120ms)로 과갱신 방지(셀렉터 격리라 리렌더는 자기 패널만이지만 immer 비용 절감). 이 store `scrollTop`이 캡처(`capturePreserve`)의 입력이자 세션 복원 출처다.
- **복원 적용(명시적 1회성 플래그, 중대-3 확정)**: "store `scrollTop`≠0이면 복원" **휴리스틱은 제거**한다 — 그 휴리스틱은 사용자가 수동으로 스크롤해 둔 위치를 매 status 전이마다 덮어쓰고 onScroll 미러와 경합한다. 대신 `_applyPreserve`가 set한 panel별 `pendingScrollRestore: number | null`을 **단 1회** 소비한다. useEffect는 `pendingScrollRestore !== null` **그리고** `status === 'ready'` **그리고** totalHeight(콘텐츠 높이)가 확정된 시점에만 `min(pending, scrollHeight - clientHeight)`로 클램프 적용 후 **즉시 플래그를 `null`로 소거**한다. 평상시(수동 스크롤·navigate)에는 플래그가 `null`이라 useEffect가 아무것도 하지 않는다.

#### 변경 함수/지점 (FileListView.tsx)

```ts
// onScroll: 로컬 + store 동시 갱신(rAF 디바운스). 복원 플래그와 무관 — 항상 사용자 스크롤 미러.
const onScroll = useCallback((e) => {
  const top = e.currentTarget.scrollTop
  setScrollTop(top)                 // 윈도잉용 로컬(즉시)
  scheduleStoreScroll(panelId, top) // store 반영(디바운스) → 보존 캡처 정확
}, [panelId])

// 복원 효과: pendingScrollRestore 가 set(워처발 보존 done)이고 status==='ready'+높이 확정일 때만
// 1회 클램프 적용 후 즉시 플래그 소거. "scrollTop≠0" 휴리스틱 없음(수동 스크롤·navigate 무간섭).
const pendingScrollRestore = usePanel(panelId, (p) => p.pendingScrollRestore)
useEffect(() => {
  if (pendingScrollRestore == null) return        // 평상시 no-op
  const el = scrollRef.current
  if (!el || directory?.status !== 'ready') return // 높이 미확정이면 다음 totalHeight 변화에서 재시도
  const max = Math.max(0, el.scrollHeight - el.clientHeight)
  const clamped = Math.min(pendingScrollRestore, max)   // 콘텐츠 축소 시 클램프(빈 공간 0)
  el.scrollTop = clamped
  setScrollTop(clamped)                            // 로컬 윈도잉 동기화
  clearPendingScrollRestore(panelId)               // ← 즉시 1회성 소거(panelsSlice 액션)
}, [pendingScrollRestore, directory?.status, totalHeight, panelId])
```

`clearPendingScrollRestore(panelId)`는 panelsSlice 신규 내부 액션 — `set((s)=>{ const p=s.panels[panelId]; if(p) p.pendingScrollRestore=null })`.

> **대안(더 단순)**: store `scrollTop`을 윈도잉의 단일 출처로 쓰고 로컬 state 제거. 그러나 onScroll 마다 store 갱신→리렌더가 가상스크롤 성능에 영향 가능 → **로컬 state 유지 + 디바운스 store 미러링 + 명시적 1회성 복원 플래그**를 채택. 성능 실측 후 재검토.

### 1.4 navigate 계열 selection 초기화 — 필수 신규 변경 (중대-2 확정)

**현재 코드 사실(확인 완료)**: `panelsSlice.navigate`(L260)·`navBack`(L278)·`navForward`(L294)는
`p.scrollTop = 0`만 설정하고 **`resetSelection`을 호출하지 않는다**. `navUp`(L310)은 `navigate`
경유라 동일. 셋 다 `load(panelId, path)`(preserve 없음)를 호출 → 보존 스냅샷이 없어 `_onDone`은
selection을 건드리지 않는다 → **이전 경로의 selectedPaths가 잔존**한다(현재는 새 경로 entries와
경로가 안 겹쳐 화면상 안 보일 뿐, store에는 남음).

보존 모드 도입 후에는 "경로 변경 = 선택/스크롤 초기화" DoD(D3)를 충족해야 하므로 이는 **확정
변경 항목**이다(점검·확인이 아니라 신규 구현):

```ts
// navigate / navBack / navForward 각각에 추가(navUp 은 navigate 경유라 자동 적용).
get().resetSelection(panelId)   // ← 신규 호출(경로 변경 시 선택 초기화). scrollTop=0 은 기존 유지.
```

- `resetSelection`은 selectionSlice에 이미 존재(L65) — 추가 구현 불필요, 호출만 삽입.
- 삽입 위치: 각 함수가 `load(panelId, target)`를 호출하기 직전(또는 직후). preserve 미지정
  load이므로 `_onDone`이 selection을 덮어쓰지 않아 순서 무해. `scrollTop=0`은 이미 set됨.

> **회귀 표면(중대-2)**: 이 변경은 navigate 시 store selection을 비우는 **기존 동작 변경**이다.
> navigate 직후 selection을 읽는 모든 소비자가 영향 — **상태바(선택 N개 표기)·드래그 소스(선택 항목
> 드래그)·일괄작업 대상(복사/이동/삭제 큐)**. QA 분담에 "navigate 후 이 3개 소비자가 빈 selection을
> 올바로 반영하는지(잔존 선택으로 인한 유령 일괄작업·드래그 0)" 회귀 확인을 명시한다(§4 qa-engineer).

### 1.5 selectionSlice 추가

```ts
// SelectionSlice 인터페이스에 추가:
/** 보존 복원용 통째 교체(anchorIndex + selectedPaths 직접 주입). ADR-002 규약. */
setSelection(panelId: string, next: SelectionState): void
```

구현은 기존 패턴과 동일 — `set((s) => { s.selection[panelId] = next })`.

---

## 2. 보류 2 — 네트워크/미지원 드라이브 폴링 폴백

### 2.1 설계 개요

`WatchService.start` 내부에서 **fs.watch 대신/실패 시 폴링 모드**로 전환한다. 소비측(`watch.handlers.ts`·`watchBridge`)은 **동일한 `onEvent(path)` 콜백**만 받으므로 **투명**(신규 채널 0). 전환 조건:

1. **사전 판정(eager)**: 경로가 UNC(`\\server\share…`) 또는 네트워크 매핑 드라이브면 처음부터 폴링.
2. **실패 폴백(reactive)**: 로컬 경로라도 `fs.watch`가 throw(ENOSYS/ENOTSUP/EPERM) 또는 워처 `error` 이벤트 → 폴링으로 전환(현재는 stop+onError로 격리만 함).

### 2.2 UNC/네트워크 판정 헬퍼

기존: `renderer/domain/paths`·`main/fs/paths.ts`에 **UNC 정밀 판정 헬퍼는 없음**(`normalizePath`가 `\\?\`/UNC 프리픽스를 보존만, `breadcrumbs`/`parentOf`에 UNC 정규식 산재). `FileSystemService.guessDriveKind`는 `root.startsWith('\\\\')→'network'`만(드라이브 문자 매핑 네트워크 드라이브는 미판정).

**신규 헬퍼 추가** (`src/main/fs/paths.ts`):

```ts
/** UNC 경로(\\server\share…)인지. \\?\ 롱패스·\\?\UNC\ 도 포함. */
export function isUncPath(p: string): boolean {
  return /^\\\\(?!\?\\)/.test(p) || /^\\\\\?\\UNC\\/i.test(p)
}

/**
 * 폴링 폴백을 사전 적용할 "네트워크/원격 가능성" 경로 판정.
 * - UNC 는 항상 true.
 * - 드라이브 문자 매핑 네트워크 드라이브(X:\)는 동기 판정이 어려움 → 별도 함수(아래).
 */
export function isLikelyRemotePath(p: string): boolean {
  return isUncPath(p)
}
```

**매핑 네트워크 드라이브(X:\) 판정 — 코드 확인 결과(경미-4 / US-9.2③)**:

`FileSystemService.guessDriveKind`(L622) 현재 구현은 **`root.startsWith('\\\\') → 'network'`,
그 외 전부 `'fixed'`**다. 즉 **드라이브 문자 매핑 네트워크 드라이브(X:\)는 'fixed'로 잘못 분류**되며,
`drives()`가 매핑 네트워크 드라이브를 식별하는 수단은 **현재 코드에 없다**. Win32 드라이브 타입
감지(`GetDriveType`/`WNetGetConnection`)는 네이티브 의존이라 본 계획 범위 밖이다.

따라서 **계약 변경 0**을 유지하면서 eager 대상을 다음으로 확정한다:

- **(a) UNC 경로**(`\\server\share…`, `\\?\UNC\…`) — `isUncPath`로 동기 판정, 항상 eager.
- **(b) 백엔드 내부 감지 네트워크/원격 드라이브** — `start`에 들어온 경로의 드라이브 루트를
  `FileSystemService.guessDriveKind`로 판정해 `'network'`면 eager. **단, 현재 guessDriveKind는
  매핑 네트워크 드라이브를 'fixed'로 보므로 이 경로는 guessDriveKind가 GetDriveType 기반으로
  보강될 때 실효**(아래 권장 보강). 보강 전에는 (b)가 사실상 UNC만 잡으므로 (a)와 동치.
- **감지 불가(매핑이지만 'fixed'로 분류)인 경우만 reactive**(fs.watch error→폴링 전환)에 의존.

> **drives() 네트워크 식별 재사용 가능성(코드 확인)**: 현재 `guessDriveKind`는 UNC 외 네트워크
> 식별 수단이 없어 **그대로는 매핑 드라이브 eager에 재사용 불가**. 두 가지 선택지:
> - **선택지 1(권장, 계약 0)**: `guessDriveKind`를 Win32 `GetDriveType`(예: `koffi`/`ffi` 없이
>   `cmd /c net use` 파싱은 비용) 또는 이미 존재하면 OS API로 보강해 매핑 드라이브를 'network'로
>   판정 → `WatchService`가 동일 판정 함수를 **백엔드 내부에서 재사용**(req 필드 추가 없음 = 계약 0).
> - **선택지 2(네이티브 회피)**: 보강 불가 시 **(a) UNC-eager + reactive 폴백**으로 두고, 한계를
>   R5·DoD에 정직 표기("fs.watch가 에러도 신호도 안 내는 매핑 드라이브는 자동 갱신 미동작 가능,
>   수동 새로고침 유지").
> 어느 쪽이든 **IPC 계약(`channels.ts`·`contracts.ts`) 변경 0** — 네트워크 판정은 전부 백엔드 내부.

### 2.3 WatchService 폴링 모드

`ActiveWatch`에 폴링 필드 추가, `start`에 모드 분기, `stop`에 인터벌 정리 추가.

```ts
/** 폴링 스냅샷 1항목 식별 키: name + size + mtimeMs. */
type PollSnapshot = Map<string, string>  // name → `${size}:${mtimeMs}`

interface ActiveWatch {
  watchId: string
  path: string
  watcher: FSWatcher | null
  debounceTimer: NodeJS.Timeout | null
  // ── 폴링 폴백(신규) ──
  pollTimer: NodeJS.Timeout | null
  pollSnapshot: PollSnapshot | null   // 직전 스냅샷(diff 기준)
  pollBusy: boolean                    // readdir 진행 중 재진입 가드(중복 억제)
  mode: 'watch' | 'poll'
  cb: WatchCallbacks
}
```

상수:

```ts
const POLL_INTERVAL_MS = 4000        // 3~5s 권장 중앙값. 네트워크 비용 상한.
const POLL_MAX_ENTRIES = 20_000      // 대량 디렉토리 가드: 초과 시 폴링 비활성 + onError 1회 안내(수동 새로고침 유지).
```

#### 의존성 주입 (경미-1 — verify 헤드리스용 정식화)

`fs.watch`와 remote 판정을 **생성자 옵션으로 주입 가능**하게 정식화한다(직접 모듈 호출 금지).
verify-watch가 throw 스텁·remote 강제로 폴링/격리 경로를 헤드리스 검증할 수 있게 한다.

```ts
import { watch as fsWatch, statSync, type FSWatcher } from 'node:fs'
import { isLikelyRemotePath as defaultIsRemote } from './paths'

type WatchFn = (path: string, opts: { recursive: boolean }, listener: () => void) => FSWatcher
type IsRemoteFn = (path: string) => boolean

interface WatchServiceOptions {
  watchFn?: WatchFn         // 기본 = node:fs.watch(실모듈)
  isRemoteFn?: IsRemoteFn   // 기본 = paths.isLikelyRemotePath(실모듈)
}

export class WatchService {
  private readonly watchFn: WatchFn
  private readonly isRemoteFn: IsRemoteFn
  constructor(opts: WatchServiceOptions = {}) {
    this.watchFn = opts.watchFn ?? fsWatch
    this.isRemoteFn = opts.isRemoteFn ?? defaultIsRemote
  }
  // ...
}
// 싱글턴은 옵션 없이 생성(= 실모듈). export const watchService = new WatchService()
```

`start`/`pollOnce` 본문은 `watch(...)`/`isLikelyRemotePath(...)`를 직접 부르지 않고
**`this.watchFn`/`this.isRemoteFn` 경유**로 호출한다(아래 의사코드 반영).

#### start 분기

```ts
start(path, cb): string {
  // ... 기존 빈경로/stat 디렉토리 검증 동일 ...
  if (this.isRemoteFn(path)) {       // ← 주입 경유(경미-1). UNC + 내부 감지 네트워크 드라이브.
    this.startPolling(entry)         // eager 폴링
    return watchId
  }
  try {
    const watcher = this.watchFn(path, { recursive:false }, () => this.schedule(entry))  // ← 주입 경유
    watcher.on('error', (e) => {
      // 기존: stop + onError. 변경: 폴링 폴백 전환(로컬도 네트워크 매핑일 수 있음).
      this.fallbackToPolling(entry, e)
    })
    entry.watcher = watcher
    entry.mode = 'watch'
  } catch (e) {
    // ENOSYS/ENOTSUP/EPERM 등 → 격리 후 폴링 폴백.
    this.fallbackToPolling(entry, e)
  }
  return watchId
}
```

#### 폴링 구현

```ts
/** fs.watch 실패 시 폴링으로 전환(watcher 정리 후 폴링 시작). 투명 — onEvent 동일. */
private fallbackToPolling(entry: ActiveWatch, _cause: unknown): void {
  if (!this.watches.has(entry.watchId)) return  // 이미 stop 됨
  if (entry.watcher) { try { entry.watcher.close() } catch {} ; entry.watcher = null }
  this.startPolling(entry)
}

/** 폴링 시작: 초기 스냅샷 1회(이벤트 미발화) 후 인터벌 diff. */
private startPolling(entry: ActiveWatch): void {
  entry.mode = 'poll'
  // 초기 스냅샷은 통지하지 않는다(현재 상태 = 기준선).
  void this.pollOnce(entry, /*notify*/ false)
  entry.pollTimer = setInterval(() => { void this.pollOnce(entry, true) }, POLL_INTERVAL_MS)
}

/** readdir(name+size+mtime) 스냅샷 → 직전과 diff. 변경 시 onEvent 1회(중복 억제). */
private async pollOnce(entry: ActiveWatch, notify: boolean): Promise<void> {
  if (entry.pollBusy) return            // 재진입 가드(느린 네트워크 readdir 겹침 방지)
  if (!this.watches.has(entry.watchId)) return
  entry.pollBusy = true
  try {
    const dirents = await fsp.readdir(entry.path, { withFileTypes: true })
    if (!this.watches.has(entry.watchId)) return   // 비동기 중 stop
    // 대량 디렉토리: 부분 스냅샷으로 "변경 누락"을 내느니 폴링 비활성 + 1회 안내(경미-3 확정).
    if (dirents.length > POLL_MAX_ENTRIES) {
      this.stopPolling(entry)
      // FileOpErrorCode 에 대용량 전용 코드가 없어 EUNKNOWN(일반)으로 안내 메시지만 명확히.
      entry.cb.onError(fileOpError(
        'EUNKNOWN',
        `항목이 너무 많아(${dirents.length}) 자동 갱신을 끕니다. 수동 새로고침을 사용하세요.`,
        entry.path
      ))
      return
    }
    const prev = entry.pollSnapshot
    const snap: PollSnapshot = new Map()
    for (const d of dirents) {
      try {
        const st = await fsp.stat(join(entry.path, d.name))  // size/mtime
        snap.set(d.name, `${st.size}:${Math.trunc(st.mtimeMs)}`)
      } catch {
        // stat 간헐 실패(네트워크 글리치 등): '?' 로 두면 다음 사이클 stat 성공 시 가짜 diff 유발.
        // 이전 스냅샷에 키가 있으면 그 값을 승계(내용 변화 없음으로 간주), 없으면 신규 항목 표시('?').
        snap.set(d.name, prev?.get(d.name) ?? '?')          // 경미-2 확정
      }
    }
    entry.pollSnapshot = snap
    if (notify && prev && this.diff(prev, snap)) {
      // watch 경로와 동일하게 디바운스 경유(중복·연속 변경 병합).
      this.schedule(entry)
    }
  } catch (e) {
    // readdir 실패(경로 사라짐·권한) → 폴링 중단 + onError 격리(수동 새로고침 유지).
    this.stopPolling(entry)
    entry.cb.onError(toFileOpError(e, entry.path))
  } finally {
    entry.pollBusy = false
  }
}

/** 스냅샷 diff: 키 집합 또는 값(size/mtime) 변경 여부. */
private diff(a: PollSnapshot, b: PollSnapshot): boolean {
  if (a.size !== b.size) return true
  for (const [k, v] of b) if (a.get(k) !== v) return true
  return false
}

private stopPolling(entry: ActiveWatch): void {
  if (entry.pollTimer) { clearInterval(entry.pollTimer); entry.pollTimer = null }
}
```

#### stop 확장

```ts
stop(watchId): void {
  const entry = this.watches.get(watchId)
  if (!entry) return
  this.watches.delete(watchId)
  if (entry.debounceTimer) { clearTimeout(entry.debounceTimer); entry.debounceTimer = null }
  this.stopPolling(entry)               // 신규: 인터벌 정리
  if (entry.watcher) { try { entry.watcher.close() } catch {} ; entry.watcher = null }
}
```

> **중복 통지 억제**: (a) 폴링 변경은 기존 `schedule`(250ms 디바운스)을 경유 → 연속 변경 병합. (b) `pollBusy` 재진입 가드 → 느린 readdir이 겹쳐 중복 발화 방지. (c) 초기 스냅샷은 `notify:false` → 기준선만 설정(start 직후 가짜 이벤트 0). (d) diff 결과 변경 없으면 schedule 미호출.

> **비용 상한**: `POLL_INTERVAL_MS=4s`(네트워크 readdir 비용 균형), `POLL_MAX_ENTRIES=20k` 초과 시 **폴링 비활성 + onError 1회 안내**(부분 스냅샷으로 "변경 누락"을 내느니 자동 갱신을 끄고 수동 새로고침 유지 — 경미-3). 폴링은 패널이 보는 **현재 디렉토리 1개**만(비재귀) → 동시 폴링 수 = 활성 패널 수(2~4). stat 간헐 실패 항목은 이전 스냅샷 값을 승계해 가짜 diff를 막는다(경미-2).

### 2.4 watch.handlers.ts / watchBridge — 변경 없음

폴링은 backend 내부 전환이고 `onEvent`/`onError` 시그니처가 동일하므로 **핸들러·브리지 수정 0**(투명성 확인이 DoD). 단, watchBridge의 `onEvent`는 보존을 위해 `softRefresh`로 변경(1번 작업과 통합).

### 2.5 import 추가 (WatchService.ts)

```ts
import * as fsp from 'node:fs/promises'   // readdir/stat (폴링)
import { join } from 'node:path'
import { fileOpError } from './errors'    // 대량 디렉토리 안내(경미-3)
// isLikelyRemotePath 는 직접 import 하지 않고 생성자 기본값으로만 사용(경미-1, §2.3 주입).
// import { isLikelyRemotePath as defaultIsRemote } from './paths'  ← §2.3 의존성 주입에서 import.
```

### 2.6 eager 폴링 대상 결정 — 백엔드 내부(계약 변경 0)

eager 폴링 판정은 **전부 `WatchService.start` 내부(백엔드)**에서 한다 — IPC req에 필드를 추가하지
않는다(계약 0). `isLikelyRemotePath`(= 주입 `isRemoteFn`)를 다음으로 정의한다:

```ts
// paths.ts — UNC + (보강 시) 매핑 네트워크 드라이브.
export function isLikelyRemotePath(p: string): boolean {
  if (isUncPath(p)) return true                 // (a) UNC 항상 eager
  // (b) 매핑 네트워크 드라이브: guessDriveKind 가 'network' 로 판정하는 드라이브 루트면 eager.
  //     현재 guessDriveKind 는 매핑 드라이브를 'fixed' 로 보므로 보강 전에는 false(=UNC만).
  //     보강(2.2 선택지1) 후 X:\ 매핑도 여기서 true 가 된다. ← 백엔드 내부 재사용, 계약 0.
  return isNetworkDriveRoot(p)   // guessDriveKind 재사용(드라이브 문자 → kind) — 보강 전엔 항상 false
}
```

- `isNetworkDriveRoot(p)`는 `p`에서 드라이브 문자(`X:`)를 뽑아 `FileSystemService.guessDriveKind`
  (또는 동일 OS 감지 헬퍼)를 호출하는 얇은 래퍼. **`drives()`의 네트워크 식별 로직을 그대로 재사용**.
- 보강(GetDriveType) 가능 여부는 backend-dev가 런타임 확인 — 가능하면 매핑 드라이브 eager 실효,
  불가하면 UNC-eager + reactive로 두고 한계를 R5·DoD에 명기. **어느 경로든 req 필드/채널 추가 없음**.

---

## 3. 파일·함수 변경지점 / DoD / QA / 리스크

### 3.1 변경 파일·함수 (시그니처)

**backend**
| 파일 | 변경 | 시그니처 |
|---|---|---|
| `src/main/fs/paths.ts` | 신규 헬퍼 | `isUncPath(p:string):boolean` · `isLikelyRemotePath(p:string):boolean`(UNC + `isNetworkDriveRoot` 재사용) |
| `src/main/fs/FileSystemService.ts` | (선택지1) `guessDriveKind` 보강 | 매핑 네트워크 드라이브 'network' 판정(GetDriveType 등). 불가 시 미변경 + R5 한계 표기 |
| `src/main/fs/WatchService.ts` | 생성자 주입 · `ActiveWatch` 확장(poll 필드) · `start` 분기 · 신규 private | `constructor({watchFn?,isRemoteFn?})` · `startPolling(e)` · `fallbackToPolling(e,cause)` · `pollOnce(e,notify):Promise<void>`(대량 가드·stat 승계) · `diff(a,b):boolean` · `stopPolling(e)` · `stop` 인터벌 정리 |
| `scripts/verify-watch.ts` | 폴링 케이스 추가 | (헤드리스 — 아래 QA) |

**frontend**
| 파일 | 변경 | 시그니처 |
|---|---|---|
| `src/renderer/app/stores/panelsSlice.ts` | 보존 캡처/복원 + navigate 초기화 | `load(panelId,path,opts?)` · `refresh(panelId,opts?)` · `refreshAll(opts?)` · `softRefresh(panelId)` · `startStream(…,preserve)` · `_applyPreserve`(컴퓨트비저블 anchor + `pendingScrollRestore` set) · `capturePreserve`(computeVisible anchor 환산) · `clearPendingScrollRestore(panelId)`(내부) · **navigate/navBack/navForward 각각 `resetSelection(panelId)` 신규 호출**(중대-2) · `Panel` 타입에 `pendingScrollRestore:number\|null` 추가 |
| `src/renderer/app/stores/selectionSlice.ts` | 통째 교체 액션 | `setSelection(panelId, next:SelectionState):void` |
| `src/renderer/app/usecases/watchBridge.ts` | onEvent→softRefresh | `st.refresh(panelId)` → `st.softRefresh(panelId)` |
| `src/renderer/ui/panel/views/FileListView.tsx` | onScroll store 미러 + 복원 효과 | `onScroll`(store 디바운스 미러) · 복원 `useEffect` |

### 3.2 DoD (측정 가능)

**선택/스크롤 보존**
- D1: 워처발 갱신(softRefresh) 후, 갱신 전 선택 경로 중 **여전히 존재하는 경로는 selectedPaths에 유지**, **삭제된 경로만 해제**된다(교집합 정확).
- D2: 갱신 후 `scrollTop`이 보존되며, 복원은 **`pendingScrollRestore` 1회성 플래그**로만 적용된다("scrollTop≠0" 휴리스틱 없음 — 사용자 수동 스크롤 미덮어씀). 콘텐츠 높이가 줄면 `min(pending, scrollHeight-clientHeight)`로 **클램프**(음수/초과 없음) 후 플래그 즉시 소거(다음 status 전이에 재적용 0).
- D3: navigate(경로 변경)·navBack/Forward/Up은 **명시적 `resetSelection` 호출**로 selection 초기화 + scrollTop=0(보존 안 함). navigate 후 상태바·드래그 소스·일괄작업 대상에 잔존 선택 0.
- D4: 수동 새로고침(Ctrl+R)·refreshAll도 보존(경로 동일).
- D5: 재-list **error 시 보존 스냅샷 폐기**(복원 시도 안 함), 메모리 누수 0(`preserveSnapshots`는 done/error에서 항상 delete).

**폴링 폴백**
- D6: UNC 경로(`\\server\share`) 또는 `isRemoteFn` 강제 주입 시 start → 폴링 모드(eager), `activeCount()` 1, fs.watch(`watchFn`) 미호출.
- D7: `watchFn` throw 스텁(ENOSYS/ENOTSUP/EPERM 모의) 또는 watcher error 이벤트 → 폴링 폴백 전환(watcher null, pollTimer 활성). 주입 포인트(`watchFn`/`isRemoteFn`)로 헤드리스 검증 가능.
- D6b: readdir 항목 수 > `POLL_MAX_ENTRIES` → 폴링 비활성(pollTimer 정리) + onError 1회 안내, 이후 무발화(수동 새로고침만).
- D8: 디렉토리 변경(파일 추가/삭제/size·mtime 변경) → 다음 폴링 사이클에 onEvent 1회(diff 정확). 변경 없으면 onEvent 0.
- D9: 초기 폴링 스냅샷은 onEvent 미발화(가짜 이벤트 0).
- D10: stop → pollTimer 정리, 이후 변경 무발화(`activeCount()` 0, 좀비 인터벌 0).
- D11: 중복 억제 — 빠른 연속 변경은 디바운스로 1~수회 병합, pollBusy 재진입 가드 동작.
- D12: watchBridge/watch.handlers 수정 0으로 폴링이 watch와 동일 이벤트 소비(투명).
- D13: typecheck/lint 0, `verify:watch` 전건 PASS(+폴링 신규 케이스), `verify:store` PASS(+보존 케이스).

### 3.3 QA 검증 포인트

- **선택 보존**: 5개 선택→그 중 2개 외부 삭제→softRefresh→남은 3개만 selected, 삭제 2개 해제. anchor가 삭제 항목이면 -1 또는 첫 잔존으로 폴백.
- **스크롤 클램프**: 긴 목록 하단 스크롤→다수 항목 삭제로 높이 축소→softRefresh→scrollTop이 새 max로 클램프(빈 공간 노출 없음).
- **navigate 격리**: A폴더 선택→B폴더 navigate→selection 비고 scrollTop 0.
- **폴링 전환**: verify-watch에서 (a) UNC 경로 모의(존재하지 않는 `\\?\…` 대신 **임시 로컬 디렉토리를 isLikelyRemotePath 모의 주입**으로 폴링 강제) (b) fs.watch throw 모의(watch를 던지는 스텁 주입) → 폴링 경로 진입·diff·stop 정리 검증.
- **diff 정확**: 파일 size만 변경(같은 이름 덮어쓰기)도 감지(mtime/size 키), rename(이름 변경)도 키 집합 변화로 감지.
- **stop 정리**: 폴링 중 stop 후 `setInterval` 잔존 0(activeCount 0 + 후속 변경 무발화).
- **투명성**: watch.handlers/watchBridge diff 0줄로 폴링 이벤트가 패널 refresh 트리거.

### 3.4 리스크

- **R1 (선택 인덱스 vs 경로)**: anchorIndex가 visible 인덱스라 재-list 후 어긋남 → **경로 환산 보존**으로 완화. selectedPaths(경로 기반)는 안정. *완화: anchor best-effort, selection 우선.*
- **R2 (스크롤 store↔DOM 이중화)**: 로컬 state·DOM·store 3중 동기화 타이밍. 복원 효과가 onScroll 미러와 충돌 가능 → **status 'ready' 전이 + totalHeight 확정 후 1회 클램프**로 경합 최소화. *대안: store 단일 출처(성능 실측 후).* 
- **R3 (폴링 비용)**: 네트워크 readdir+stat가 느리면 4s 주기 누적 지연 → `pollBusy` 가드로 겹침 방지, `POLL_MAX_ENTRIES`로 대량 컷. mtime/size만 비교(내용 미독). *완화 가능, 추가 비용 상한은 런타임 실측.*
- **R4 (diff 정확도)**: size+mtime 동일한 변경(드물게 mtime 해상도 한계)은 미감지 가능 → 키 집합 변화(추가/삭제/rename)는 항상 감지. 동일 size·mtime 덮어쓰기는 워처도 한계. 또한 stat 간헐 실패 항목은 **이전 스냅샷 값을 승계**(경미-2)해 내용 변화 없는 stat 글리치가 가짜 diff를 내지 않게 한다(이전 값 없으면 '?'=신규 표시). *수용(v1).*
- **R5 (매핑 네트워크 드라이브 eager)**: `guessDriveKind`가 매핑 드라이브(X:\)를 'fixed'로 분류하므로, GetDriveType 보강 전에는 매핑 드라이브 eager가 실효되지 않고 **reactive 폴백**(fs.watch error→폴링)에 의존한다. **fs.watch가 에러도 신호도 안 내는 매핑 드라이브는 첫 변경까지 자동 갱신 미동작 가능 — 수동 새로고침은 항상 유지**(정직 표기). *완화: §2.2 선택지1(guessDriveKind 보강, 계약 0) 또는 네이티브(범위 밖).*

---

## 4. 분담

### frontend-dev
- `panelsSlice.ts`:
  - 보존 캡처/복원 — `capturePreserve`(anchor를 **`computeVisible(p)[anchorIndex]?.path`로 환산**, 중대-1)·`_applyPreserve`(anchor를 새 **computeVisible 결과에서 재탐색**, selectedPaths 교집합 우선, `pendingScrollRestore` set)·`softRefresh`·`load/refresh/refreshAll` 옵션화·`startStream` preserve 전달·`_onDone`/`_onError` 훅.
  - `Panel` 타입에 `pendingScrollRestore: number | null` 추가, `clearPendingScrollRestore` 액션.
  - **navigate/navBack/navForward 각각 `get().resetSelection(panelId)` 신규 호출 추가**(중대-2, navUp은 navigate 경유).
- `selectionSlice.ts`: `setSelection` 통째 교체 액션.
- `watchBridge.ts`: `onEvent`→`softRefresh`.
- `FileListView.tsx`: onScroll store 디바운스 미러 + **복원 useEffect는 `pendingScrollRestore` 1회성 플래그 기반**(scrollTop≠0 휴리스틱 없음), status==='ready'+totalHeight 확정 시 클램프 후 즉시 소거(중대-3).
- `tests/store.verify.ts`: 보존 케이스(정렬·필터 적용 패널에서 anchor 환산 정확·교집합·클램프·navigate 격리·error 폐기) 추가.

### backend-dev
- `main/fs/paths.ts`: `isUncPath`·`isLikelyRemotePath`(UNC + `isNetworkDriveRoot` 재사용 래퍼, 경미-4).
- `main/fs/FileSystemService.ts`: (선택지1 가능 시) `guessDriveKind`를 GetDriveType 등으로 보강해 매핑 네트워크 드라이브 'network' 판정 → eager 실효. **불가하면 미변경 + R5 한계 명기**(계약 0 어느 쪽이든).
- `main/fs/WatchService.ts`: **생성자 주입 `{ watchFn?, isRemoteFn? }`**(경미-1, 기본=실모듈)·폴링 모드(`ActiveWatch` 확장·`start` 분기는 `this.isRemoteFn`/`this.watchFn` 경유·`startPolling`/`fallbackToPolling`/`pollOnce`(대량 디렉토리 비활성+onError 1회·stat 실패 시 이전 스냅샷 값 승계)/`diff`/`stopPolling`·`stop` 정리·import 추가).
- `scripts/verify-watch.ts`: 폴링 케이스(`isRemoteFn` 강제→eager·`watchFn` throw 스텁→폴백·diff·중복 억제·stop 정리·초기 스냅샷 무발화·대량 디렉토리 비활성). 주입 포인트로 fs.watch throw·remote 강제 검증.

### qa-engineer
- 경계면 교차: 폴링↔watch 투명성(watchBridge/handlers 무변경 확인), 보존 시 **정렬·필터가 걸린 패널에서 anchor가 computeVisible 기준으로 정확히 보존/복원**되는지(중대-1) + selection 교집합·scroll 1회성 클램프 수용기준 대조.
- **navigate 회귀(중대-2)**: navigate/navBack/navForward 후 잔존 선택 0을 **상태바(선택 N개)·드래그 소스·일괄작업 대상(복사/이동/삭제 큐)** 3개 소비자에서 교차 확인(유령 일괄작업·드래그 0).
- **스크롤 복원 1회성(중대-3)**: 워처발 갱신 후 1회 클램프되고, 이후 사용자 수동 스크롤이 덮어쓰이지 않는지(휴리스틱 잔재 0).
- verify 헤드리스 전건 + 신규 케이스 PASS, typecheck/lint 0 확인.

---

## 5. 신규 채널 필요 여부

**불필요.** 폴링은 backend 내부 전환으로 `fs:watch:event`/`fs:watch:error`를 그대로 재사용(투명). 선택/스크롤 보존은 전부 renderer 내부(슬라이스). eager 폴링 대상(UNC + 내부 감지 네트워크 드라이브) 판정도 **`WatchService` 내부**에서 하며 IPC req에 필드를 추가하지 않는다(`guessDriveKind` 백엔드 재사용). **계약(`channels.ts`·`contracts.ts`) 변경 0 — 어떤 보강 경로를 택해도 동일.**
