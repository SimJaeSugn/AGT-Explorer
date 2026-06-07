# I장 — 디렉토리 사용량 대시보드 + 블루라이트 차단 테마 (코드베이스 수준 구현 계획서)

> 작성: 테크리드 · 2026-06-07 · 상태: **계획(구현 미착수)** · 대상: 사용자 확정 신규 2기능
> 입력 코드: `src/main/fs/FileSystemService.ts`, `src/shared/dto`, `src/shared/ipc/*`, `src/main/operations/*`, `src/main/workers/*`, `src/renderer/ui/theme/*`, `src/renderer/app/stores/uiSlice.ts`, `src/renderer/ui/toolbar/iconBarItems.ts`, `src/renderer/app/usecases/commandBus.ts`, `src/main/persistence/defaults.ts`
> 컨벤션 게이트: Result·zod guard·Worker/Abort... 협조취소·Immer 제외 슬라이스·셀렉터 격리·CSP·coerce·tokens/CSS변수 (CLAUDE.md / ADR-002·003·005)

이 문서는 **구현 직전 세부 계획**이다. 코드는 아직 작성하지 않는다. 각 결정의 근거는 현재 코드 사실에 둔다.

---

## 0. 핵심 결정 요약 (먼저 읽어라)

| # | 결정 사항 | 결론 | 근거(코드 사실) |
|---|----------|------|-----------------|
| (a) | 디스크 사용량 채널 | **기존 `fs:drives`·`DriveDTO` 재사용. 신규 채널 불필요.** | `DriveDTO`에 이미 `totalBytes:number\|null`·`freeBytes:number\|null` 존재(`dto/index.ts:75-77`). `FileSystemService.drives()`가 `diskSpace()`로 `statfs`(blocks·bsize·bavail) 계산을 **이미 구현**(`FileSystemService.ts:482-545`). 대시보드는 `fsApi.drives()`만 호출하면 됨. |
| (b) | Top10 스캔 서브시스템 | **신규 채널 `analyze:*` + 신규 Worker `scanWorker` + 신규 DTO.** op:* 재사용 안 함. | `op:*`는 `OpKind`(copy/move/delete/trash)·충돌·`engine.ts`에 강결합(`OperationManager.ts`, `engine.ts`). 스캔은 충돌·대상디렉토리 개념이 없음. 단 **인프라 패턴(SharedArrayBuffer 협조취소·200ms 스로틀·event.sender 푸시·streamId 상관)은 그대로 모사**한다. |
| (c) | recharts CSP/번들 | **도입 가능.** prod CSP `style-src 'self' 'unsafe-inline'` 이미 허용 → recharts 인라인 SVG 스타일 호환. 번들은 대시보드 모달 **동적 import**로 격리. | `index.ts:54` prod CSP에 `'unsafe-inline'` 포함. `img-src 'self' data:` — recharts는 외부 이미지·폰트 미사용(SVG path). React 18 호환. |
| (d) | 블루라이트 ThemeMode 확장 | **`ThemeMode`에 `'bluelight'` 추가**(4-state). `palette.ts`에 `BLUELIGHT_PALETTE`. **테마 토글 버튼(`theme.toggle`)은 light↔dark 2-state 유지** — 블루라이트는 설정 드롭다운에서만 선택. | `ThemeMode='light'\|'dark'\|'system'`(`dto:173`). `toggleThemeMode`가 resolved 기준 light↔dark 토글(`settings.ts:46-50`) — 블루라이트를 토글 순환에 넣으면 UX 혼란. `applyTheme.resolveTheme`은 `'light'\|'dark'` 2색만 반환하므로 bluelight를 **독립 resolved**로 확장 필요. |
| (e) | frontend/backend 분담 | backend: (b) 채널/Worker/DTO + (a) 검증. frontend: 대시보드 모달·차트·아이콘바·자동팝업·블루라이트 팔레트/coerce 연동. devops: recharts 설치·번들 영향 확인. | 아래 §8. |

---

## 1. 디스크 사용량 채널 (기능1-A)

### 1.1 결정: 기존 `fs:drives` 재사용 (신규 채널·DTO 변경 0)

`DriveDTO`와 `FileSystemService.drives()`/`diskSpace()`가 이미 statfs 기반 총/여유 용량을 채운다. **사용량 = total - free**는 렌더러 파생값.

- **statfs 계산(이미 구현, 변경 없음)**: `total = blocks * bsize`, `free = bavail * bsize`. `bavail`(비특권 가용)을 free로 씀 — 일반 사용자 관점 정확. `node:fs/promises.statfs`는 Node 18.15+ 이며 현재 엔진(`>=20.11`)에서 항상 존재.
- **Windows 드라이브 처리(이미 구현)**: C:~Z: + A:/B: 프로빙, `access(root)` 성공분만. statfs 실패 시 `{total:null, free:null}` → 대시보드는 null 드라이브를 "용량 정보 없음"으로 표시.

### 1.2 (선택) 정확도 보강 — 범위 외, 리스크만 기록

`bavail` vs `bfree` 차이(예약 블록)는 Windows에서 보통 무시 가능. 정밀 볼륨 라벨/종류는 별도 과제(현 `guessDriveKind`는 휴리스틱). **이번 스코프에서 DriveDTO 변경 없음** — 대비를 줄이려면 추후 별도 ADR.

### 1.3 변경 지점

| 파일 | 변경 | 비고 |
|------|------|------|
| (없음 — backend) | `fs:drives` 그대로 | DriveDTO·statfs 이미 충족 |
| `renderer/app/usecases/dashboard.ts` (신규) | `loadDriveUsage(): Promise<DriveUsage[]>` — `fsApi.drives()` 호출 후 `used=total-free`·`freePct` 파생 | 셀렉터/유스케이스 계층 |

---

## 2. Top10 스캔 서브시스템 (기능1-B) — 신규 `analyze:*` 채널 + Worker

### 2.1 결정 근거: op:* 재사용하지 않고 신규 채널

`op:*`/`OperationManager`/`engine.ts`는 **변형 작업**(copy/move/delete/trash) 전용이다: `OpKind`·충돌질의(`resolveConflict`)·`destDir`·`conflictPolicy`가 핵심이며 스캔에는 전부 무의미. 강제로 끼우면 계약 오염. 대신 **인프라 패턴만 1:1 모사**한다:

- 협조취소: `SharedArrayBuffer(Int32Array[0])` + `Atomics`(`protocol.ts:11`, `OperationManager.cancel:398`) — 사용자 요청의 "AbortController"는 메인↔워커 경계에선 SharedArrayBuffer가 정석(기존 컨벤션). 채널 입구의 취소 명령은 `analyze:scan:cancel`.
- 200ms 진행률 스로틀: `OperationManager.startThrottle`(`OperationManager.ts:296-309`)의 `setInterval(PROGRESS_THROTTLE_MS=200)` 패턴 재사용.
- streamId 상관: `fs:list` 스트림(`FileSystemService.startListStream` → randomUUID → onChunk/onDone/onError)과 동형.
- event.sender 푸시 + `EVENT_CHANNELS` 등록: `channels.ts:87-94`.

### 2.2 신규 채널 (channels.ts + contracts.ts)

```
// channels.ts CHANNELS 에 추가
ANALYZE_SCAN_START:    'analyze:scan:start',     // invoke → Result<{ scanId }>
ANALYZE_SCAN_CANCEL:   'analyze:scan:cancel',    // invoke → Result<void>
ANALYZE_SCAN_PROGRESS: 'analyze:scan:progress',  // 푸시 evt
ANALYZE_SCAN_DONE:     'analyze:scan:done',       // 푸시 evt
ANALYZE_SCAN_ERROR:    'analyze:scan:error'       // 푸시 evt

// EVENT_CHANNELS 배열에 progress/done/error 3개 추가
```

요청/응답·이벤트 shape (contracts.ts):

```ts
interface AnalyzeScanStartReq { readonly path: string }              // 스캔 루트(폴더 또는 드라이브)
interface AnalyzeScanStart    { readonly scanId: string }
interface AnalyzeScanCancelReq{ readonly scanId: string }

// 진행률(200ms 스로틀): 누적 항목/바이트 + 현재 경로
interface AnalyzeProgressEvt {
  readonly scanId: string
  readonly scannedItems: number
  readonly scannedBytes: number
  readonly currentPath: string
}
interface AnalyzeDoneEvt {
  readonly scanId: string
  readonly result: ScanResult       // dto
}
interface AnalyzeErrorEvt { readonly scanId: string; readonly error: FileOpError }

// IpcRequestMap 에 추가
[CHANNELS.ANALYZE_SCAN_START]:  { req: AnalyzeScanStartReq;  res: Result<AnalyzeScanStart> }
[CHANNELS.ANALYZE_SCAN_CANCEL]: { req: AnalyzeScanCancelReq; res: Result<void> }
// IpcEventMap 에 추가
[CHANNELS.ANALYZE_SCAN_PROGRESS]: AnalyzeProgressEvt
[CHANNELS.ANALYZE_SCAN_DONE]:     AnalyzeDoneEvt
[CHANNELS.ANALYZE_SCAN_ERROR]:    AnalyzeErrorEvt
```

### 2.3 신규 DTO (shared/dto/index.ts)

```ts
/** 스캔 상위 항목(폴더 또는 파일) 1개. */
export interface ScanEntryDTO {
  readonly path: string
  readonly name: string
  readonly isDir: boolean
  readonly sizeBytes: number   // 폴더는 재귀 합계, 파일은 자기 크기
}
/** analyze:scan:done 결과 — 상위 N 폴더/파일 + 요약. */
export interface ScanResult {
  readonly rootPath: string
  readonly totalBytes: number
  readonly totalItems: number
  readonly topFolders: ScanEntryDTO[]   // 상위 10, sizeBytes desc
  readonly topFiles: ScanEntryDTO[]     // 상위 10, sizeBytes desc
  readonly skipped: number              // 권한거부·순환으로 건너뛴 항목 수(격리 카운트)
  readonly canceled: boolean
  readonly truncated: boolean           // 항목 상한 초과 시
}
```

### 2.4 신규 Worker — `src/main/workers/scanWorker.ts` + `src/main/analyze/scanEngine.ts`

`fileOpWorker.ts`/`engine.ts` 분리 패턴을 그대로 따른다(엔진은 환경 비의존 → 검증 스크립트에서 직접 호출 가능).

`scanEngine.ts` 핵심 알고리즘(재귀 사이즈 집계):
- `fsp.opendir` 순회. 각 항목 `lstat`(심볼릭/정션 판정은 `winAttributes.resolveAttributes` 재사용 고려, 단 worker는 winAttributes import 가능).
- **순환 방지(F장 특수케이스)**: 심볼릭링크·정션(`lst.isSymbolicLink()` 또는 reparse)은 **따라가지 않는다**(디렉토리로 재귀 안 함, 링크 자체 크기 0 취급). 추가로 방문 `realpath` Set(`fsp.realpath` 베스트에포트)로 동일 실디렉토리 재방문 차단 → ELOOP 무한루프 격리.
- **권한거부 격리**: `readdir`/`stat` 실패는 throw 금지 → `skipped++` 후 계속(engine.ts `aggregate`의 try/catch 무시 패턴과 동일).
- **Top10 집계**: 루트 직속 자식별 재귀 합계를 구해 폴더 후보 배열에 push; 전체 트리 파일은 별도 min-heap(크기 10) 또는 정렬 후 slice로 topFiles 선정. 메모리 상한: 전체 파일 목록 보관 금지 — 폴더는 직속 자식 단위로만, 파일은 size-10 유지 힙으로 O(전체) 1패스.
- **진행률**: `scannedItems`/`scannedBytes` 누적을 worker가 post, Main이 200ms 스로틀로 1건씩 중계.
- **취소**: `Atomics.load(cancelView,0)===1`을 디렉토리/항목 경계에서 폴링 → 즉시 중단, `canceled:true` done.
- **항목 상한**: `SCAN_ITEM_CAP`(예 2_000_000) 초과 시 `truncated:true`로 중단(폭주 방어, `STREAM_CAP` 선례).

`scanWorker.ts`: `fileOpWorker.ts`(L13-27)와 동형 — `workerData=ScanJob{ rootPath, cancelBuffer }`, parentPort로 `totals?`/`progress`/`done`/`error` post. worker↔main 프로토콜은 `src/main/workers/scanProtocol.ts`(신규, `protocol.ts` 모사).

### 2.5 신규 매니저 — `src/main/analyze/ScanManager.ts`

`OperationManager` 축소판: `analyze:scan:start`마다 `scanId=randomUUID`, `SharedArrayBuffer` 취소뷰, `new Worker(scanWorker.js, {workerData})`, 200ms 스로틀 `setInterval`로 last progress 푸시, worker `done`→`analyze:scan:done` 푸시 + 스로틀 정리 + `worker.terminate()`. `cancel(scanId)`→`Atomics.store(view,0,1)`. `wc.isDestroyed()` 가드(`OperationManager.push` 패턴).

### 2.6 핸들러·preload·infra·브리지

| 파일 | 변경 |
|------|------|
| `main/ipc/analyze.handlers.ts` (신규) | `registerAnalyzeHandlers()` — `handleGuarded(ANALYZE_SCAN_START, zAnalyzeScanStartReq, ...)` → `guardPath(req.path)` 후 `scanManager.start(path, event.sender)`; `ANALYZE_SCAN_CANCEL` → `scanManager.cancel`. (op.handlers.ts 패턴 복제) |
| `main/ipc/index.ts` | `registerAnalyzeHandlers()` 추가 |
| `main/ipc/guard.ts` | `zAnalyzeScanStartReq=z.object({path:zPath})`, `zAnalyzeScanCancelReq=z.object({scanId:z.string().min(1)})` |
| `preload/api.ts` | `analyze:{ scanStart, scanCancel, onProgress, onConflict→onScanProgress/onScanDone/onScanError }` (op 블록 패턴) |
| `renderer/infra/api/index.ts` | `analyzeApi={ scanStart, scanCancel }` + `subscribeScanStream(scanId,{onProgress,onDone,onError})` (subscribeListStream 패턴 — scanId 상관 필터) |

### 2.7 렌더러 상태 — `analyzeSlice` (Immer 제외, operationsSlice 선례)

200ms 고빈도 progress라 평탄 교체(`operationsSlice`처럼 Immer 미적용 가능하나, 단일 활성 스캔이므로 단순 필드여도 무방). 상태: `scanId|null`, `status:'idle'|'scanning'|'done'|'error'|'canceled'`, `progress:{scannedItems,scannedBytes,currentPath}`, `result:ScanResult|null`, `errorMsg|null`. 액션: `startScan/cancelScan/_scanProgress/_scanDone/_scanError/resetScan`. 유스케이스 `usecases/dashboard.ts`가 `analyzeApi`+`subscribeScanStream`을 슬라이스에 브리지(`operationsBridge.ts` 패턴).

---

## 3. recharts 도입 (기능1 차트)

### 3.1 의존성

`npm install recharts` (dependencies). React 18 호환. 트랜지티브: `d3-*`(scale/shape/path)·`victory-vendor`. **번들 영향**: recharts gzip ~100KB+. 완화 → **대시보드 모달을 `React.lazy`/동적 import**로 분리해 메인 청크 미오염(electron-vite/Rollup 자동 코드분할). 평상시 미로드.

### 3.2 CSP 호환 (검증 완료)

- prod CSP(`index.ts:54`): `style-src 'self' 'unsafe-inline'` → recharts가 SVG 요소에 인라인 `style`/`width`/`height` 주입해도 통과.
- `img-src 'self' data:` → recharts는 외부 이미지·웹폰트 미사용(순수 SVG path·text). 위반 없음.
- `script-src 'self'`(eval 없음) → recharts/d3는 `eval`·`new Function` 미사용(런타임 스모크에서 콘솔 CSP 위반 0 확인이 QA 포인트).

### 3.3 차트 컴포넌트 (셀렉터 격리)

| 파일(신규) | 내용 |
|-----------|------|
| `ui/dashboard/charts/DiskDonut.tsx` | recharts `PieChart`(도넛, innerRadius) — 드라이브별 used/free. props=DriveUsage[]. 색은 `tokens.color.*`(CSS변수) 주입 → 테마 연동. |
| `ui/dashboard/charts/TopBar.tsx` | recharts `BarChart`(가로 막대) — Top10 sizeBytes. props=ScanEntryDTO[]. |

**셀렉터 격리**: 차트는 props로만 데이터 받음(스토어 직접 구독 X). 대시보드 모달만 `analyzeSlice`/드라이브 데이터를 구독 → 차트 리렌더가 앱 전역에 전파되지 않음(IconBar/패널 미영향). 모달 미오픈 시 컴포넌트 unmount(동적 import).

---

## 4. 대시보드 모달 + 아이콘바 + 자동 팝업

### 4.1 uiSlice 확장

```ts
// 상태 추가
readonly dashboardOpen: boolean
readonly showDashboardOnStartup: boolean   // 설정(영속) — 부팅 자동팝업
// 액션 추가
openDashboard(): void    // dashboardOpen=true, inputContext='dialog'
closeDashboard(): void   // dashboardOpen=false, 다른 모달 없으면 inputContext='list'
setShowDashboardOnStartup(v: boolean): void
```
`openDashboard/closeDashboard`는 기존 `openSettings/closeSettings`(`uiSlice.ts:240-252`) 가드 패턴 복제(닫을 때 다른 모달 체크). `applySettings`에 `s.showDashboardOnStartup = snapshot.showDashboardOnStartup` 한 줄 추가.

### 4.2 commandBus + 아이콘바 버튼

- `commandBus.ts` switch에 `case 'dashboard.open': s.openDashboard(); return true` 추가.
- `iconBarItems.ts` 'tool' 그룹에 항목 추가:
  ```ts
  { id: 'dashboard.open', label: '용량 대시보드', icon: '📊', group: 'tool' }
  ```
  (단축키 없음 — `iconBarItemTitle`이 라벨만 반환). 활성조건 없음(항상 활성).

### 4.3 DashboardModal (신규 `ui/dashboard/DashboardModal.tsx`)

- `dialogStyles`(overlay/panel/titleStyle/btn) 재사용 — 테마 CSS변수 자동 연동. SettingsDialog와 동일 구조(오버레이 클릭 닫기·stopPropagation·aria-modal).
- 마운트: `App.tsx` 오버레이 그룹에 `<DashboardModal />` 추가(SettingsDialog 옆, L95).
- 내용 3섹션: (1) 디스크별 도넛(부팅/오픈 즉시 `loadDriveUsage`) + 인사이트(여유% 최소 드라이브·총 여유), (2) 스캔 대상 선택(드라이브/현재 폴더) + "스캔 시작"·진행률 바(scannedItems·currentPath)·"취소", (3) 스캔 완료 시 TopBar 차트 + 상위 폴더/파일 리스트 + 인사이트(최대 폴더). **recharts 동적 import** — 모달 본문을 `React.lazy(() => import('./DashboardModalBody'))` + `Suspense` 로 감싸 메인 청크 격리.
- 닫힐 때 진행 중 스캔 있으면 `cancelScan` 호출(누수 방지).

### 4.4 부팅 자동 팝업 (App.tsx 분기)

`App.tsx` 부팅 시퀀스(L47-59) — `loadSettings()` 완료 후 `restoreSession()` 다음에:
```ts
if (store.getState().showDashboardOnStartup) store.getState().openDashboard()
```
`loadSettings`가 `applySettings`로 `showDashboardOnStartup`을 슬라이스에 반영한 뒤 분기. settings 로드 실패 시 기본값(true)로 동작.

### 4.5 설정 토글 (SettingsDialog)

`SettingsDialog.tsx`에 체크박스 1줄 추가(확장자 표시 라벨 패턴 복제):
```
[프로그램 시작 시 용량 대시보드 표시]  checked={showDashboardOnStartup}
  onChange → changeShowDashboardOnStartup(v)   // usecases/settings.ts
```

---

## 5. 설정 영속 — `showDashboardOnStartup` (coerce 화이트리스트)

| 파일 | 변경 |
|------|------|
| `shared/dto/index.ts` `SettingsSnapshot` | `readonly showDashboardOnStartup: boolean` 추가 |
| `main/persistence/defaults.ts` | `defaultSettings()`에 `showDashboardOnStartup: true`; `coerceSettings`에 `showDashboardOnStartup: asBool(o['showDashboardOnStartup'], d.showDashboardOnStartup)` |
| `main/ipc/guard.ts` `zSettingsSetReq` | `.object({...})`에 `showDashboardOnStartup: z.boolean().optional()` (strict 화이트리스트) |
| `renderer/app/usecases/settings.ts` | `changeShowDashboardOnStartup(v){ setShowDashboardOnStartup(v); persist({showDashboardOnStartup:v}) }` |
| `renderer/app/stores/uiSlice.ts` | §4.1 상태/액션 + `applySettings`에 반영 |

> `SETTINGS_SCHEMA_VERSION`은 **올리지 않아도 됨** — coerce가 누락 키를 기본값(true)로 채우므로 구버전 settings.json 무손상 호환(`coerceSettings` 정책). 단 traceability에 신규 설정 명시.

---

## 6. 블루라이트 차단 테마 (#FBF0D9)

### 6.1 ThemeMode 4-state 확장

```ts
// dto/index.ts
export type ThemeMode = 'light' | 'dark' | 'system' | 'bluelight'
```

### 6.2 팔레트 (palette.ts) — 신규 `BLUELIGHT_PALETTE`

배경 `#FBF0D9`(따뜻한 크림) 기반 저청색광. **WCAG AA(4.5:1) 대비 유지** — 텍스트는 진한 따뜻한 갈/회(#3a3326 계열), 보더·선택·강조도 따뜻한 톤으로 전부 정의. LIGHT_PALETTE의 13개 키 전부 채운다(누락 시 변수 미주입 → 색 깨짐). 제안 값(QA가 대비 측정):
```
--c-bg: #FBF0D9; --c-bg-alt: #F3E6C9; --c-bg-hover: #ECDCBA;
--c-bg-selected: #E3CFA0; --c-bg-selected-inactive: #EADCC0;
--c-border: #E0D0AE; --c-border-strong: #C9B488;
--c-text: #3A3326; --c-text-muted: #6E6346;
--c-accent: #9A6A1F; --c-accent-border: #9A6A1F; --c-danger: #B23A2E;
--c-folder: #C79A3A; --c-file: #8A7B55; --c-highlight: #F2D98A
```

### 6.3 applyTheme — bluelight를 독립 resolved로 확장

현재 `resolveTheme`은 `'light'|'dark'`만 반환. 최소 변경으로 bluelight 지원:
```ts
// applyTheme.ts
export type ResolvedTheme = 'light' | 'dark' | 'bluelight'
export function resolveTheme(mode: ThemeMode, prefersDark: boolean): ResolvedTheme {
  if (mode === 'system') return prefersDark ? 'dark' : 'light'
  return mode            // 'bluelight' 그대로 통과
}
// paletteFor(resolved): bluelight → BLUELIGHT_PALETTE
// injectPalette: data-theme=resolved; colorScheme = resolved==='dark'?'dark':'light' (bluelight는 light 계열)
```
`palette.ts#paletteFor` 시그니처를 `ResolvedTheme`으로 확장하고 `bluelight` 분기 추가. `systemPrefersDark` 변경 없음.

### 6.4 테마 토글 버튼과의 관계 (결정 (d))

- **`theme.toggle`(아이콘바·`toggleThemeMode`)는 light↔dark 2-state 유지** — bluelight 진입 안 함(`settings.ts:46-50` 그대로). bluelight 상태에서 토글 누르면? `resolveTheme('bluelight')`는 light 계열이므로 `resolved!=='dark'`→ dark로 전환(합리적: 토글은 "밝게↔어둡게"). 즉 bluelight는 토글 순환에서 빠지고 **설정 드롭다운으로만 선택**.
- **SettingsDialog 드롭다운에 옵션 추가**: `<option value="bluelight">블루라이트 차단</option>`(`SettingsDialog.tsx:77-79` 옆). `changeTheme('bluelight')`가 즉시 `applyTheme` + 영속.

### 6.5 coerce/guard 화이트리스트

| 파일 | 변경 |
|------|------|
| `main/persistence/defaults.ts` | `THEME_MODES = new Set([...,'bluelight'])` (L29) — coerce가 'bluelight' 허용. session ui.theme도 동일 Set 사용(L216 호환 자동). |
| `main/ipc/guard.ts` | `zThemeMode = z.enum(['light','dark','system','bluelight'])` (L124) |

> session.handlers `SessionSnapshot.ui.theme`도 ThemeMode이므로 4값 자동 호환(coerceSession이 THEME_MODES 참조). 추가 변경 불요.

---

## 7. 파일·함수 변경 지점 종합 (시그니처 수준)

### Backend (Main)
| 파일 | 신규/변경 | 시그니처 |
|------|----------|----------|
| `shared/ipc/channels.ts` | 변경 | `ANALYZE_SCAN_START/CANCEL/PROGRESS/DONE/ERROR` 추가 + EVENT_CHANNELS에 progress/done/error |
| `shared/ipc/contracts.ts` | 변경 | `AnalyzeScanStartReq/Start/CancelReq/ProgressEvt/DoneEvt/ErrorEvt` + IpcRequest/EventMap 엔트리 |
| `shared/dto/index.ts` | 변경 | `ScanEntryDTO`·`ScanResult` 추가; `ThemeMode`에 `'bluelight'`; `SettingsSnapshot.showDashboardOnStartup` |
| `main/workers/scanProtocol.ts` | 신규 | `ScanJob`·`ScanOutMsg`(totals/progress/done/error)·`CANCEL_FLAG_INDEX` |
| `main/analyze/scanEngine.ts` | 신규 | `runScan(rootPath, hooks): Promise<ScanResult>` (env 비의존, 검증 직접호출) |
| `main/workers/scanWorker.ts` | 신규 | worker 엔트리(`fileOpWorker.ts` 동형) |
| `main/analyze/ScanManager.ts` | 신규 | `start(path, wc): Result<{scanId}>` · `cancel(scanId): Result<void>` |
| `main/ipc/analyze.handlers.ts` | 신규 | `registerAnalyzeHandlers()` |
| `main/ipc/index.ts` | 변경 | `registerAnalyzeHandlers()` 호출 |
| `main/ipc/guard.ts` | 변경 | `zAnalyzeScanStartReq`·`zAnalyzeScanCancelReq`; `zThemeMode`+'bluelight'; `zSettingsSetReq.showDashboardOnStartup` |
| `main/persistence/defaults.ts` | 변경 | `THEME_MODES`+'bluelight'; `defaultSettings.showDashboardOnStartup=true`; `coerceSettings` 반영 |

### Preload / infra
| 파일 | 변경 |
|------|------|
| `preload/api.ts` | `analyze:{ scanStart/scanCancel/onScanProgress/onScanDone/onScanError }` |
| `renderer/infra/api/index.ts` | `analyzeApi` + `subscribeScanStream` |

### Frontend (Renderer)
| 파일 | 신규/변경 |
|------|----------|
| `renderer/app/stores/analyzeSlice.ts` | 신규(스캔 상태/액션) |
| `renderer/app/stores/rootStore.ts` | 변경(`createAnalyzeSlice` 합성) |
| `renderer/app/stores/types.ts` | 변경(AppStore에 AnalyzeSlice 합성 타입) |
| `renderer/app/stores/uiSlice.ts` | 변경(`dashboardOpen`·`showDashboardOnStartup`·open/close/set + applySettings) |
| `renderer/app/usecases/dashboard.ts` | 신규(`loadDriveUsage`·`startScan`·`cancelScan`·스캔 브리지 init) |
| `renderer/app/usecases/settings.ts` | 변경(`changeShowDashboardOnStartup`) |
| `renderer/app/usecases/commandBus.ts` | 변경(`case 'dashboard.open'`) |
| `renderer/ui/toolbar/iconBarItems.ts` | 변경(`dashboard.open` 버튼) |
| `renderer/ui/dashboard/DashboardModal.tsx` (+`DashboardModalBody.tsx` lazy) | 신규 |
| `renderer/ui/dashboard/charts/DiskDonut.tsx`·`TopBar.tsx` | 신규(recharts) |
| `renderer/ui/App.tsx` | 변경(`<DashboardModal/>` 마운트 + 부팅 자동팝업 분기) |
| `renderer/ui/settings/SettingsDialog.tsx` | 변경(테마 옵션 'bluelight' + 자동팝업 체크박스) |
| `renderer/ui/theme/palette.ts` | 변경(`BLUELIGHT_PALETTE`·`paletteFor` 분기·`ResolvedTheme`) |
| `renderer/ui/theme/applyTheme.ts` | 변경(`ResolvedTheme`·resolveTheme 통과·injectPalette colorScheme) |

### devops
- `package.json` dependencies `recharts` 추가; 번들 분할 확인.

---

## 8. 역할 분담 (frontend / backend / devops)

| 역할 | 작업 |
|------|------|
| **backend** | §2 전체(analyze 채널·scanProtocol·scanEngine·scanWorker·ScanManager·analyze.handlers·guard zod) / §5·§6.5 coerce·guard·dto(ThemeMode·SettingsSnapshot) / `fs:drives` 재사용 확인(변경 없음 검증) |
| **frontend** | §1.3 dashboard 유스케이스·§2.7 analyzeSlice·브리지 / §3 recharts 차트 / §4 DashboardModal·아이콘바·자동팝업·commandBus / §5 settings 유스케이스·SettingsDialog / §6.1~6.4 palette·applyTheme·테마 드롭다운 |
| **devops** | recharts 설치·번들 영향(동적 import 청크 분리 확인)·typecheck/lint |
| **qa** | §9 검증 포인트 전부(경계면 교차) |

**병렬화**: §2.2~2.3(채널·DTO 계약) 합의를 **가장 먼저** 동결 → backend(Worker/Manager)와 frontend(슬라이스/모달 모킹)가 병렬. 블루라이트(§6)는 채널 무관 → 독립 병렬 가능.

---

## 9. DoD (측정 가능) + QA 검증 포인트

### 9.1 DoD
- [ ] `analyze:scan:*` 5채널 동결, typecheck/lint 0, EVENT_CHANNELS 등록.
- [ ] 대용량 폴더 스캔 시 진행률 이벤트 **간격 ≤ 250ms**(200ms 스로틀 + 오차), currentPath 갱신.
- [ ] 스캔 취소 후 progress/done **무유입**(취소 후 이벤트 0건 — fs:list 취소 계약 동형).
- [ ] 심볼릭/정션 순환 디렉토리 스캔이 **무한루프 없이 종료**, `skipped` 카운트 노출.
- [ ] 권한거부 경로가 스캔을 **중단시키지 않음**(throw 0, skipped 누적).
- [ ] `fsApi.drives()` 결과로 디스크별 총/사용/여유·여유% 표시(statfs null은 "정보없음").
- [ ] recharts 도넛/막대 렌더, **콘솔 CSP 위반 0**.
- [ ] `showDashboardOnStartup` 기본 true, 설정에서 끄면 재시작 시 자동팝업 안 뜸; coerce 구버전 settings.json 무손상.
- [ ] `bluelight` 테마 선택 시 #FBF0D9 적용, 모든 토큰 변수 주입(미주입 0), 토글 버튼은 light↔dark만.

### 9.2 QA 검증 포인트
| 포인트 | 방법 |
|--------|------|
| statfs 정확성 | 알려진 드라이브 total/free를 OS(`Get-Volume`)와 대조(±예약블록 허용) |
| 진행률 200ms | 스캔 중 progress 타임스탬프 델타 측정 ≤ 250ms |
| 취소 경로 | cancel 후 수신 이벤트 0 확인(레이스: cancel↔done) |
| 순환/권한 격리 | 정션 자기참조·권한0 폴더 픽스처로 종료·skipped 검증(scanEngine 직접호출 verify 스크립트) |
| 차트 렌더/CSP | 런타임 스모크 — 모달 오픈 시 콘솔 CSP·SVG 렌더 확인 |
| 자동팝업 토글 | 설정 off→재시작 미표시, on→표시 |
| 테마 대비 | bluelight 텍스트/배경 WCAG AA(4.5:1) 측정(대비 계산기) |
| 셀렉터 격리 | 스캔 progress 동안 IconBar/패널 리렌더 0 확인(React DevTools/Profiler) |

---

## 10. 리스크 / 에스컬레이션

| 리스크 | 영향 | 완화 | 에스컬레이션 |
|--------|------|------|-------------|
| 대용량(수백만 파일) 스캔 성능·메모리 | 모달 지연·OOM | size-10 힙 1패스, 폴더 후보만 보관, SCAN_ITEM_CAP truncated, 진행률로 체감 완화 | 성능 실측이 PRD §7 임계 초과 시 PM 보고(샘플링/깊이제한 옵션 검토) |
| 심볼릭/정션 순환 무한루프 | 행/크래시 | 링크 미추적 + realpath 방문 Set + skipped 격리 | F장 특수케이스 재확인 필요 시 보고 |
| recharts CSP/번들 | 차트 미렌더·메인청크 비대 | CSP 사전검증(통과)·동적 import 격리 | 런타임 스모크에서 CSP 위반 시 차트 라이브러리 대체(경량 SVG 자체구현) 검토 후 PM 보고 |
| statfs Windows 정확도(bavail vs 실제) | 용량 오차 | bavail=일반사용자 가용으로 명시 표기 | 큰 괴리 시 DriveDTO 보강 ADR |
| bluelight 4-state로 토글/세션/coerce 누락 | 색 깨짐·복원 실패 | THEME_MODES·zThemeMode·paletteFor·resolveTheme 4곳 일괄 변경 체크리스트 | — |

---

## 11. 설계 정합성 주석 (드리프트 아님 — 동결 원칙 준수)

`analyze:scan:*`는 P1 "전 채널 타입 동결" 이후의 **신규 채널**이다. 동결 원칙은 *기존 MVP 채널* 계약을 고정해 병렬화 출발선을 잡으려는 것이며, 신기능에 필요한 신규 채널 추가는 위반이 아니다 — `preview:read`·`telemetry:get-opt-in`(P6)·`shell:open-terminal`(H4) 선례와 동일하게 `channels.ts`에 "신규(I장)"로 명시하고 동일 guard/zod/Result/SharedArrayBuffer·200ms 스로틀 규약을 준수한다. `ThemeMode`·`SettingsSnapshot` 확장은 DTO 필드 확장(coerce 호환)으로 IPC 채널 동결과 무관하다. 본 기능 정식 편입은 PM→사용자 확정 결정에 근거(스코프 일탈 아님).
```
