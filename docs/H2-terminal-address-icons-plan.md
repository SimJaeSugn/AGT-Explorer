# H2 구현 계획서 — 터미널 열기 · 주소 직접입력 · OS 실제 아이콘

> 작성: 테크리드 · 2026-06-07 · 상태: **계획(구현 미착수)**
> 대상: 신규 3기능(사용자 확정 결정 반영) — 컨텍스트 메뉴 "터미널 열기", 주소창 단일클릭 편집, 파일 유형별 OS 실제 아이콘
> 입력 설계 정합: ADR-003(Result 1급 전파)·ADR-005(쉘 실행 검증·셸 미경유 execFile)·SA §3.1~3.2(IPC 계약 단일출처)·SA §5.2(셀렉터 격리)
> 컨벤션 준수: `Result`·zod guard·`execFile`(인자 배열)·Immer·셀렉터 격리·commandBus/usecase 경유·tokens·`ui→infra` 직접 import 금지

---

## 0. 요약 (TL;DR)

| # | 기능 | 신규 채널 | backend 변경 | frontend 변경 | 보안 |
|---|------|-----------|--------------|---------------|------|
| 1 | 터미널 열기 | `shell:open-terminal` **(신규)** | channels/contracts/guard/handler/os.shell | preload·infra·usecase·contextMenu | ADR-005 3중검증 + execFile 배열 |
| 2 | 주소 직접입력 | 없음 | 없음 | `PanelToolbar.tsx` 단일클릭 진입 1곳 | N/A(렌더러 전용) |
| 3 | OS 실제 아이콘 | `shell:icon` **(예약 구현)** | handler + os 아이콘추출 + LRU/in-flight 캐시 | preload·infra·iconCache·FileListView | guardPath + 존재검증, dataUrl read-only |

핵심 결정:
- **터미널**: `wt.exe -d <경로>` 우선 → 실패/부재 시 `powershell.exe`(cwd=경로) 폴백. 둘 다 `execFile`(셸 미경유)·인자 배열·`windowsHide:false`(터미널은 보여야 함).
- **아이콘 캐시 키 정책(단일 확정안)**: frontend는 **항상 실존 경로**를 보낸다 — 일반 파일은 `{ path: entry.path }`, 폴더/드라이브는 실존 대표 경로 + 합성키 힌트(아래 §3.1/§3.2). backend가 `win32.extname(path)`로 캐시 키를 환원: 일반 파일=`ext:<ext>`, per-file 고유 아이콘(exe/lnk/ico/cur 등)=`path:<path>`, 폴더=`__dir__`, 드라이브=`__drive__`. **추출/조회 실패는 캐시에 저장하지 않음**(다음 가시 항목 경로로 재시도 가능). backend LRU + frontend Map 캐시 2단, in-flight 디듀프.
- **주소**: 더블클릭 핸들러를 **단일 클릭 진입**으로 확장하되, **개별 브레드크럼 버튼 클릭(이동)** 과 충돌 없게 이벤트 분리.

---

## 1. 기능 1 — 터미널 열기 (신규 채널 `shell:open-terminal`)

### 1.1 계약 (shared)

`src/shared/ipc/channels.ts` — `CHANNELS` 에 추가:
```ts
SHELL_OPEN_TERMINAL: 'shell:open-terminal', // impl: H2 (Windows Terminal/PowerShell)
```

`src/shared/ipc/contracts.ts` — 요청 타입 + 맵 추가:
```ts
// shell:* 신규
export interface ShellOpenTerminalReq {
  /** 터미널을 띄울 작업 디렉토리(검증된 디렉토리 경로). */
  readonly cwd: string
}
// IpcRequestMap 에:
[CHANNELS.SHELL_OPEN_TERMINAL]: { req: ShellOpenTerminalReq; res: Result<void> }
```
> 동결 원칙 위반 아님: `shell:icon`(예약)은 그대로 두고 `shell:open-terminal`만 신규 추가. EVENT_CHANNELS 변경 없음(요청-응답).

### 1.2 guard (zod)

`src/main/ipc/guard.ts`:
```ts
export const zShellOpenTerminalReq = z.object({ cwd: zPath })
```

### 1.3 os 어댑터

`src/main/os/shell.ts` — 신규 함수:
```ts
/**
 * 검증된 디렉토리 경로에서 터미널을 연다.
 * wt.exe -d <cwd> 우선, 실패/부재 시 powershell.exe(cwd=경로) 폴백.
 * 셸 미경유 execFile + 인자 배열(ADR-005). windowsHide:false(터미널 표시).
 * 비-Windows 는 미지원 안내 반환(개발/CI 폴백).
 */
export async function openTerminal(normalizedDir: string): Promise<OpenResult>
```
구현 규칙:
- `process.platform !== 'win32'` → `{ errorMessage: '터미널 열기는 Windows에서만 지원됩니다.' }`.
- 1차: `execFile('wt.exe', ['-d', normalizedDir], { windowsHide: false })`.
  - `wt.exe`는 PATH에 없을 수 있음(미설치/Server) → `error.code === 'ENOENT'` 또는 spawn 실패 시 폴백.
  - wt는 런처라 즉시 반환(detach). `error` 없으면 성공.
- 2차(폴백): `execFile('powershell.exe', ['-NoExit'], { cwd: normalizedDir, windowsHide: false })`.
  - `-NoExit`로 창 유지. cwd 옵션으로 작업 디렉토리 지정(경로를 명령행 문자열로 합성하지 않음 — 주입 차단).
  - powershell도 실패 시 그 error.message를 반환.
- **경로는 항상 인자 배열/cwd 옵션으로만 전달**(문자열 보간 금지, ADR-005 §3.3-4).

### 1.4 handler

`src/main/ipc/shell.handlers.ts` — `registerShellHandlers()` 내부에 추가. **shell:open 패턴 재사용 + 디렉토리 검증 추가**:
```
ipcMain.handle(CHANNELS.SHELL_OPEN_TERMINAL, async (event, raw) => {
  (1) isTrustedSender 검증
  (2) parseArgs(zShellOpenTerminalReq, raw)
  (3) guardPath(cwd) → 정규화·상위이탈 차단
  (4) fsp.access(F_OK) → 존재 확인(ENOENT)
  (5) fsp.stat(cwd) → !isDirectory() 면 ENOTDIR 거부   ← shell:open과 다른 추가 검증
  (6) openTerminal(cwd) → errorMessage 있으면 EUNKNOWN err
})
```
> (5) 디렉토리 검증이 핵심: 파일 경로로 터미널 cwd를 열 수 없게 한다. `fsp.stat` 사용(import 추가).

### 1.5 preload / infra

`src/preload/api.ts` — `ExplorerApi.shell` 인터페이스 + 구현에 `openTerminal` 추가, `ShellOpenTerminalReq` import:
```ts
openTerminal(req: ShellOpenTerminalReq): Promise<Result<void>>
// 구현:
openTerminal: (req) => invoke(CHANNELS.SHELL_OPEN_TERMINAL, req),
```

`src/renderer/infra/api/index.ts` — `shellApi`에 추가:
```ts
/** shell:open-terminal — 디렉토리 경로에서 터미널 실행(컨텍스트 메뉴 "터미널 열기"). */
openTerminal: (cwd: string): Promise<Result<void>> => bridge().shell.openTerminal({ cwd }),
```

### 1.6 usecase

`src/renderer/app/usecases/open.ts` — **기존 파일에 추가**(신규 파일 아님; §1.6·§4 일치). 기존 `openErrorMessage`/`activateEntry`/`openWithEntry`/`showPropertiesFor` 와 같은 모듈에 둔다(open 계열 정책 일관). 터미널은 **전용 에러 메시지**를 쓴다:
```ts
/** 터미널 전용 에러 메시지(터미널 맥락 문구 — open 계열과 분리). */
function terminalErrorMessage(code: string): string {
  switch (code) {
    case 'ENOTDIR':
      return '폴더가 아닙니다. 터미널은 폴더에서만 열 수 있습니다.'
    case 'ENOENT':
      return '경로가 존재하지 않습니다. 이동/삭제되었을 수 있습니다.'
    case 'EACCES':
    case 'EPERM':
      return '해당 경로에 접근할 권한이 없습니다.'
    case 'ESECURITY':
      return '경로가 차단되어 터미널을 열 수 없습니다.'
    default: // EUNKNOWN 등
      return '터미널을 열 수 없습니다.'
  }
}

/**
 * "터미널 열기"(shell:open-terminal) — 컨텍스트 메뉴에서 디렉토리/패널 경로 대상.
 * 성공은 무음(터미널 창이 뜸), 실패만 안내 토스트(터미널 전용 문구).
 * ui→infra 직접 import 금지 규칙을 이 usecase 경유로 준수(ContextMenu→여기→shellApi).
 */
export async function openTerminalAt(path: string): Promise<void> {
  const res = await shellApi.openTerminal(path)
  if (!res.ok) store.getState().pushToast('error', terminalErrorMessage(res.error.code))
}
```
> 대안(동등): `openErrorMessage(code, name, defaultMsg?)` 처럼 `openErrorMessage` 에 default 인자를 추가해 터미널 default 를 주입하는 방식도 허용. 어느 쪽이든 **터미널 default 는 "터미널을 열 수 없습니다"**, `ENOTDIR`="폴더가 아닙니다", `ENOENT`="경로가 존재하지 않습니다" 로 한다. (handler 의 stat 거부가 `ENOTDIR`/`ENOENT` 코드를 그대로 내려줌 — §1.4와 코드 일치.)

### 1.7 컨텍스트 메뉴 항목

`src/renderer/app/usecases/contextMenu.ts` — `buildMenuItems`:

**노출 조건(확정).**
- **빈 영역(`targetPath === null`)**: `!isMyPc(panelPath) && panelPath !== ''` 일 때만 "터미널 열기" 노출. (현재 코드상 빈영역 비-MyPc 분기는 이미 `panelPath` 가 `''`/My PC 가 아님을 전제하지만, 방어적으로 `panelPath !== ''` 도 함께 확인.)
- **단일 디렉토리 선택(`!multi && single && single.isDir`)**: 대상 = `single.path` 로 노출.
- **파일 단일 / 다중 선택 / My PC**: **미표시**(파일에는 cwd 개념 부적합, 다중은 모호, My PC는 경로 없음).

**경로 출처(확정).** 빈 영역 대상은 현재 패널 경로 `store.getState().panels[panelId]?.path`. **근거(코드 확인):** `panelsSlice.navigate()` 가 설정하는 `panel.path` 는 항상 `''`(My PC 드라이브 목록) 또는 `fs:list` 로 실제 디렉토리 리스팅되는 **실존 디렉토리 경로**다 — 가상/검색 뷰가 없어 패널 path 에 비실존·비디렉토리 경로가 들어가지 않는다(`src/renderer/app/stores/panelsSlice.ts` navigate L260, load→fs:list). 따라서 빈영역 path 출처는 항상 실존 디렉토리이거나 `''`(후자는 위 노출 조건에서 배제). **최종 안전망**은 backend handler 의 stat 검증(§1.4)으로 `ENOTDIR`/`ENOENT` 거부 → 레이스(클릭 직후 삭제 등)도 안전.

**메뉴 배치(확정).**
- **빈 영역**: "터미널 열기" 는 **붙여넣기 그룹과 새로고침 사이**에 둔다(고정). separator 규칙:
  ```
  붙여넣기
  ── sep-empty ──
  새 폴더
  터미널 열기        ← 신규(붙여넣기 그룹과 새로고침 사이)
  ── sep-terminal ── (조건부: 위 항목 존재 시에만)
  새로고침
  ```
  즉 "새 폴더" 다음·"새로고침" 앞에 push 하고, 그 사이에 separator(`sep-terminal`) 1개를 항목이 실제 노출될 때만 추가한다.
- **단일 디렉토리 선택**: **열기 그룹** 내, "열기" 바로 다음에 "터미널 열기" 를 push 한다(`sep-open` separator 앞). 즉 열기 → 터미널 열기 → `sep-open`.
- import 추가: `openTerminalAt`(`./open`). `isMyPc` 는 이미 import됨.

---

## 2. 기능 2 — 주소 직접 입력 (단일 클릭 편집)

### 2.1 변경 지점 — `src/renderer/ui/toolbar/PanelToolbar.tsx` 1곳

현재(비편집 상태) 컨테이너 `<div onDoubleClick={...}>`(라인 170~209):
- 브레드크럼 `<button onClick={navigate}>`(개별 크럼 = 이동)이 자식으로 존재.
- 컨테이너에 `onClick`을 추가해 **빈 영역/경로 텍스트 클릭 시 편집 진입**, 단 **개별 크럼 버튼 클릭은 이동 유지**.

### 2.2 충돌 분리 전략

크럼 버튼과 컨테이너 클릭을 분리한다:
1. 컨테이너에 `onClick={onAddressBarClick}` 추가(기존 `onDoubleClick` 유지 — 더블클릭도 그대로 동작).
2. `onAddressBarClick`: `e.target`이 컨테이너 자신(또는 비-버튼 영역)일 때만 편집 진입.
   ```ts
   function onAddressBarClick(e: React.MouseEvent): void {
     // 개별 크럼 <button> 클릭은 navigate 전담 → 컨테이너 클릭만 편집 진입.
     if ((e.target as HTMLElement).closest('button')) return
     focusPanel()
     setAddressEditing(true)
   }
   ```
3. 크럼 `<button onClick>`은 그대로 `navigate(panelId, c.path, true)` 유지.
   - 버튼 클릭은 `closest('button')` 가드로 `onAddressBarClick`에서 조기 return → 충돌 없음.
   - (선택) 버튼에 `onClick`에서 `e.stopPropagation()`을 추가하면 더 명확하나, `closest('button')` 가드로 충분.
- 기존 `Ctrl+L`(`address.edit` 커맨드 → `setAddressEditing(true)`)·더블클릭 경로 **변경 없음**(회귀 0).
- `commitEdit`/`validateAndNavigate`/`addressEditing`/Esc/Enter 로직 **재사용**(추가/변경 없음).

### 2.3 UX 미세사항
- `title` 갱신: "클릭/더블클릭/Ctrl+L 로 경로 편집".
- 단일 클릭으로 편집 진입 후 기존 `useEffect`가 `inputRef.select()`로 전체 경로 선택(기존 동작 유지).

> 신규 채널·스토어 액션·usecase 불요. 순수 `PanelToolbar.tsx` 국소 변경.

---

## 3. 기능 3 — 파일 유형별 OS 실제 아이콘 (`shell:icon` 예약 구현)

### 3.1 계약 — 변경 없음(이미 동결)

`ShellIconReq { path?; ext? }` → `ShellIconRes { dataUrl }`, `IpcRequestMap[CHANNELS.SHELL_ICON]` 모두 **이미 contracts.ts에 존재**. preload `shell.icon`·infra `shellApi`에 어댑터만 추가하면 됨. guard에 zod 스키마만 추가.

**요청 형태 분기(단일 확정).** frontend는 항상 **실존 경로**를 보낸다. `path`/`ext` 두 필드의 역할을 다음과 같이 고정한다:
- **파일/일반 항목**: `{ path: <실존 항목 경로> }` 만 보낸다(`ext` 미사용). backend가 경로로 추출하고 `win32.extname(path)`로 캐시 키를 환원한다.
- **폴더/드라이브(합성키)**: `{ path: <실존 대표 경로>, ext: '__dir__' | '__drive__' }`. `path`는 실제 추출에 쓰는 실존 경로(폴더는 항목 경로 또는 `app.getPath('home')`, 드라이브는 요청에 온 드라이브 루트 경로), `ext`는 **합성 캐시 키 전용 힌트**다.

> 즉 `ShellIconReq.ext` 의 optional 은 **폴더/드라이브 합성키 전용**이며 일반 파일 경로에는 쓰지 않는다(아래 guard 주석으로 한정). 요청 형태 분기를 정하는 단일 위치는 frontend 요청 빌더 **`iconRequestFor(entry): ShellIconReq`**(§3.4, `iconKeyFor`와 짝). backend는 이 두 형태만 받는다고 가정한다.

`src/main/ipc/guard.ts`:
```ts
// 항상 실존 path 필수. ext 는 폴더/드라이브 합성키 전용 힌트(__dir__/__drive__)이며
// 일반 파일에는 오지 않는다(파일 키는 backend 가 win32.extname(path) 로 환원).
export const zShellIconReq = z.object({
  path: zPath,
  ext: z.enum(['__dir__', '__drive__']).optional() // 합성키 전용. 일반 파일은 미지정.
})
```
> 동결된 contracts 타입(`path?`/`ext?`)은 호환을 위해 그대로 두되, **guard 가 실제 허용 형태를 좁힌다**(path 필수 + ext 는 두 합성키만). 이로써 "빈 요청"·"임의 ext 문자열"을 입구에서 거부한다.

### 3.2 os 아이콘 추출 — 신규 모듈 `src/main/os/icon.ts`

```ts
/**
 * OS 파일 아이콘 추출 + 키 단위 LRU 캐시 (ADR-005: 읽기 전용, 실행 없음).
 *
 * 단일 추출 전략: 호출부(handler)는 항상 검증된 실존 path 를 넘긴다.
 *   - app.getFileIcon 은 실존 파일 경로를 요구하므로 ext-only 추출은 하지 않는다.
 *   - 캐시 키만 다음 규칙으로 환원한다(키 ≠ 추출 입력):
 *       · 폴더 합성요청('__dir__')      → 키 '__dir__'
 *       · 드라이브 합성요청('__drive__') → 키 '__drive__'
 *       · per-file 고유 아이콘(exe/lnk/ico/cur/ani/msc/scr) → 'path:<path>'
 *       · 그 외 일반 파일               → 'ext:<win32.extname(path) 소문자>'
 *   - 추출/조회 실패는 캐시에 저장하지 않는다(영구 폴백 방지 — 아래 참고).
 */
export interface IconResult { readonly dataUrl: string }

/**
 * 검증된 실존 path(+선택 합성키 힌트)로 dataUrl 추출. throw 금지.
 * 성공 → dataUrl 문자열, 실패(추출 예외/빈 이미지) → null(캐시 미저장).
 */
export async function getFileIconDataUrl(req: { path: string; ext?: '__dir__' | '__drive__' }): Promise<string | null>
```

구현 세부:
- **추출**: Electron `app.getFileIcon(path, { size: 'small' })` 는 `Promise<NativeImage>` 를 반환한다 → `await` 후 `nativeImage.toDataURL()`(PNG data URL)을 `await` 결과에서 호출한다. `size:'small'` 은 ~16px 로, 행 아이콘 슬롯(§3.4의 16×16 박스) 및 `tokens.rowHeight = 26`(행 높이 26px) 과 정합한다([경미-1] 정합 대조 — 16px 아이콘이 26px 행 안에 여백 포함 적합).
- **추출 입력 경로 산출(키와 분리)**:
  - 합성키(`__dir__`/`__drive__`) 요청이면 추출 입력 = 요청에 온 **실존 `path`** 그대로(폴더는 항목/홈 경로, 드라이브는 드라이브 루트 경로 — §3.1 요청 빌더가 보장). 첫 1회만 추출 후 합성 키로 캐시 → 전 폴더/드라이브가 공유.
  - 일반 요청이면 추출 입력 = `path`(실존 항목 경로).
- **캐시 키 산출(`cacheKeyFor(req)`)**:
  - `req.ext === '__dir__'` → `'__dir__'`, `req.ext === '__drive__'` → `'__drive__'`.
  - 아니면 `const ext = win32.extname(req.path).slice(1).toLowerCase()`:
    `PER_FILE_EXT.has(ext)` → `path:<req.path>`, 아니면 `ext:<ext>`(확장자 없으면 `ext:` 빈 키).
  - `const PER_FILE_EXT = new Set(['exe','lnk','ico','cur','ani','msc','scr'])`.
- **실패 비캐싱(영구 폴백 방지)**: 추출 예외·빈 NativeImage 는 `null` 반환하고 **캐시에 넣지 않는다**. 따라서 한 항목 경로(예: 권한 일시 거부·경로 레이스)로 실패해도 키가 오염되지 않아, **같은 키의 다음 가시 항목 경로로 재시도**할 수 있다. (handler·frontend 모두 실패를 캐시하지 않음 — §3.3·§3.4·§6에 명문화.)
- **LRU**: 간단한 Map 기반 LRU(상한 `MAX_ICON_CACHE = 512` 엔트리). 초과 시 가장 오래된 키 evict(get 시 재삽입으로 최신화). **성공 항목만** 카운트(실패는 미저장이므로 상한 압박 없음). 메모리 상한 명시 → 리스크 §6 대응.
- **toFileOpError 불필요**: 추출 실패는 `null` 반환(핸들러가 빈 dataUrl 선택). UI는 폴백 아이콘을 유지하므로 **err보다 빈 결과 선호**(토스트 폭주 방지).

### 3.3 handler — `src/main/ipc/shell.handlers.ts`

`registerShellHandlers()` 내부에 추가:
```
ipcMain.handle(CHANNELS.SHELL_ICON, async (event, raw) => {
  (1) isTrustedSender
  (2) parseArgs(zShellIconReq, raw)            ← path 필수 + ext 는 __dir__/__drive__ 만(§3.1)
  (3) guardPath(path) → 정규화·상위이탈 차단
  (4) fsp.access(path, F_OK) → 미존재면 ok({dataUrl:''}) (폴백; 캐시 미저장)
  (5) getFileIconDataUrl({ path, ext }) → dataUrl 있으면 캐시 후 ok({dataUrl}), null이면 ok({dataUrl:''}) (캐시 미저장)
})
```
> 아이콘은 **실패해도 UI 폴백이 있으므로 ok({dataUrl:''})로 부드럽게** 반환(토스트 폭주 방지). guardPath는 유지(상위이탈 차단). **실패(미존재·추출 null)는 캐시에 저장하지 않는다** — 같은 키의 다음 가시 항목 경로로 재시도 가능(§3.2 영구 폴백 방지 일관).

### 3.4 frontend 소비 — 신규 `src/renderer/infra/icon/iconCache.ts` + `FileListView.tsx`

**infra 아이콘 캐시(가상 스크롤 1만개 대응 핵심)** — `src/renderer/infra/icon/iconCache.ts`:
```ts
/**
 * 키 단위 아이콘 캐시 + in-flight 디듀프 (ui→infra 직접 금지이므로
 * app/usecases 경유 또는 ui가 app selector를 통해 접근).
 *
 * - 캐시 키(iconKeyFor): 폴더='__dir__', 드라이브='__drive__',
 *   per-file 확장자(exe/lnk/ico/cur/ani/msc/scr)='path:<path>', 그 외='ext:<ext>'.
 *   backend cacheKeyFor 와 동일 규칙(경계면 일치). 같은 키는 IPC 1회만.
 * - 요청 빌더(iconRequestFor): 항상 실존 경로를 담은 ShellIconReq 생성 —
 *   파일/per-file={ path: entry.path }, 폴더={ path: entry.path, ext:'__dir__' },
 *   드라이브={ path: <드라이브 루트>, ext:'__drive__' }. 키 분기와 짝(§3.1).
 * - in-flight: 동일 키 동시요청은 같은 Promise 공유(디듀프).
 * - 실패 비캐싱: 빈 dataUrl 응답은 캐시에 넣지 않음 → 다음 가시 항목 경로로 재시도.
 * - 구독: 행 컴포넌트가 키로 조회 → 없으면 로드 트리거 + 폴백 반환,
 *   완료 시 리렌더 통지(경량 이벤트/버전 카운터).
 */
export function iconKeyFor(entry: FileEntryDTO): string            // backend cacheKeyFor 와 동일 규칙
export function iconRequestFor(entry: FileEntryDTO): ShellIconReq  // 실존 경로 + 합성키 힌트
export function getCachedIcon(key: string): string | undefined
export function requestIcon(entry: FileEntryDTO): Promise<void>    // in-flight 디듀프, 실패 비캐싱
export function subscribeIcon(cb: () => void): () => void          // 캐시 변경 통지
```
- **frontend Map 상한 불요([경미-2])**: 키가 확장자(`ext:<ext>`) 또는 두 합성키로 환원되므로 Map 엔트리는 **세션에서 등장한 확장자 종류 수**(현실적으로 수십~수백)로 **자연 상한**을 가진다. per-file(`path:<path>`)만 항목당 엔트리지만 exe/lnk 등은 일반 폴더에서 소수다. 따라서 frontend Map에는 별도 상한·evict 가 불필요하다(backend LRU(512)가 main 프로세스 상한 담당).
- **셀렉터 격리(SA §5.2) 준수**: 아이콘 캐시는 **panelId 무관 전역**(같은 png는 모든 패널 공유) → 패널 store 슬라이스를 오염시키지 않음. store 밖 모듈 상태 + `useSyncExternalStore`로 행이 구독.
- **app usecase 경유**: `ui→infra` 직접 import 금지 규칙상, `src/renderer/app/usecases/icons.ts` 얇은 래퍼를 두거나 iconCache를 app 계층에 배치. (권장: `app/usecases/icons.ts`가 `infra/icon`을 감싸고 `shellApi.icon` 호출.)

**FileListView.tsx `FileRow` 변경**(라인 394 `const icon = entry.isDir ? '📁' : '📄'` 대체):
```tsx
// 기존 이모지 → OSIcon 컴포넌트(폴백 이모지 유지).
<span style={{ flex: '0 0 auto', width: 16, height: 16, ... }}>
  <OSIcon entry={entry} />
</span>
```
신규 경량 컴포넌트 `OSIcon`(같은 파일 또는 `views/OSIcon.tsx`):
```tsx
function OSIcon({ entry }: { entry: FileEntryDTO }): JSX.Element {
  const key = iconKeyFor(entry)
  const dataUrl = useSyncExternalStore(subscribeIcon, () => getCachedIcon(key))
  useEffect(() => { if (!dataUrl) void requestIcon(entry) }, [key])
  if (dataUrl) return <img src={dataUrl} width={16} height={16} alt="" />
  return <span>{entry.isDir ? '📁' : '📄'}</span> // 로드 전 폴백
}
```
- **1만개 성능**: 확장자별 1회만 IPC(키 공유) → 폴더에 png 5000개여도 IPC 1회. in-flight 디듀프로 동시 5000행이 같은 Promise 공유.
- **가상 스크롤 정합**: 보이는 행(수십 개)만 마운트 → `requestIcon`은 가시 행 확장자만 트리거(폭주 없음). 캐시는 영구(세션) → 스크롤 재진입 시 즉시.
- **폴더/드라이브 기본 아이콘**: `iconKeyFor`가 `__dir__`/`__drive__`로 환원 → 1회 추출 후 전 폴더 공유.

---

## 4. 파일·함수 변경 지점 (시그니처 수준 집계)

| 계층 | 파일 | 변경 |
|------|------|------|
| shared | `ipc/channels.ts` | `SHELL_OPEN_TERMINAL` 추가 |
| shared | `ipc/contracts.ts` | `ShellOpenTerminalReq` + IpcRequestMap 1줄 (icon은 기존) |
| main | `ipc/guard.ts` | `zShellOpenTerminalReq`, `zShellIconReq` |
| main | `os/shell.ts` | `openTerminal(dir): Promise<OpenResult>` |
| main | `os/icon.ts` **(신규)** | `getFileIconDataUrl(req)` + LRU |
| main | `ipc/shell.handlers.ts` | `SHELL_OPEN_TERMINAL` 핸들러(+stat 디렉토리검증), `SHELL_ICON` 핸들러 |
| preload | `api.ts` | `shell.openTerminal` 인터페이스+구현 (icon은 기존 노출) |
| renderer/infra | `api/index.ts` | `shellApi.openTerminal` (+ icon 어댑터는 app/icons에서) |
| renderer/infra | `icon/iconCache.ts` **(신규)** | 확장자 키 캐시·in-flight·subscribe |
| renderer/app | `usecases/open.ts` **(기존에 추가)** | `openTerminalAt(path)` + `terminalErrorMessage(code)` |
| renderer/app | `usecases/icons.ts` **(신규, 권장)** | iconCache + shellApi.icon 래핑 |
| renderer/app | `usecases/contextMenu.ts` | buildMenuItems에 "터미널 열기" 2분기 |
| renderer/ui | `toolbar/PanelToolbar.tsx` | 주소 컨테이너 `onClick` 단일클릭 편집 |
| renderer/ui | `panel/views/FileListView.tsx` | `FileRow` 이모지 → `OSIcon` |

---

## 5. DoD (측정 가능)

**공통**: `typecheck` 0 · `lint` 0 · 기존 verify 하네스 회귀 0(375 pass 유지).

> 문서 동기화([경미-4]): 구현 후 roadmap 의 H4/H5/H6 상태 🔜→✅ 전환 및 `docs/architecture/traceability.md` 추가는 **이 계획서 DoD 가 아니라 doc-sync 게이트**(각 Phase QA 통과 직후 `doc-synchronizer`)로 처리한다(CLAUDE.md 문서 동기화 게이트).

1. **터미널 열기**
   - 디렉토리 항목 우클릭 → "터미널 열기" 노출, 클릭 시 해당 경로에서 wt/PowerShell 실행.
   - 패널 빈영역 우클릭(비-MyPc) → 현재 경로 대상 "터미널 열기" 노출·동작.
   - 파일/다중 선택 → 항목 미표시.
   - 단위 검증: `openTerminal`이 wt ENOENT 시 powershell로 폴백(execFile 모킹)·인자 배열 전달(문자열 합성 0)·존재하지 않는/파일 경로 거부(ENOENT/ENOTDIR).
2. **주소 직접입력**
   - 주소창 빈영역/경로 텍스트 단일 클릭 → 편집 모드(전체 경로 선택).
   - 개별 브레드크럼 클릭 → 해당 경로로 **이동**(편집 진입 안 함).
   - Ctrl+L·더블클릭·Enter·Esc 기존 동작 회귀 0.
3. **OS 아이콘**
   - 파일 행이 OS 실제 아이콘 표시(로드 전 이모지 폴백 → 로드 후 img).
   - 같은 확장자 N행 → IPC 호출 **1회**(in-flight/캐시 검증, 카운터 단언).
   - 폴더/드라이브 기본 아이콘 표시. exe/lnk는 path별 고유 아이콘.
   - 1만개 목록 스크롤 시 가시 행만 요청, 캐시 엔트리 ≤ MAX(512) 유지.

---

## 6. QA 검증 포인트

- **터미널**: (a) wt 설치/미설치 양 환경 폴백 신뢰성, (b) ADR-005 — execFile 인자 배열·`cwd` 옵션만 사용(명령행 문자열 합성 0건 grep), (c) 경로에 공백·한글·`&` 포함 시 정상(주입 무해), (d) 파일 경로/미존재 경로 거부.
- **주소**: (a) 단일클릭 편집 vs 크럼 이동 분기(`closest('button')` 가드), (b) 활성/비활성 패널 모두 동작, (c) Ctrl+L·더블클릭 회귀.
- **아이콘**: (a) 같은 ext 1만행 IPC 1회(성능·디듀프), (b) 로드 전 폴백→로드 후 교체 깜빡임, (c) 폴더/드라이브/exe per-file 키 정확성, (d) **셀렉터 격리** — 아이콘 캐시가 패널 store 슬라이스를 오염시키지 않음(다른 패널 불필요 리렌더 0), (e) 캐시 메모리 상한(LRU evict) 동작 + frontend Map 은 ext 종류 수로 자연 상한, (f) 미존재 파일 요청 시 빈 dataUrl(토스트 폭주 0), (g) **실패 비캐싱**: 추출/조회 실패한 키는 캐시에 남지 않아 같은 키의 다음 실존 항목 경로로 재시도되어 끝내 아이콘 표시(영구 폴백 0).

---

## 7. 리스크 / 에스컬레이션

| 리스크 | 영향 | 대응 |
|--------|------|------|
| 아이콘 비동기 로드가 셀렉터 격리 위반(패널 store 오염) | 다른 패널 리렌더 폭주 | 아이콘 캐시를 **store 밖 전역 모듈** + `useSyncExternalStore`로 분리. 행 단위 구독만. |
| 아이콘 캐시 메모리 무한 증가 | RAM 누수 | backend LRU(512) 가 main 상한 담당. frontend Map 은 키가 ext/합성키로 환원되어 **확장자 종류 수(수십~수백)로 자연 상한**([경미-2]) → 별도 상한 불요. per-file(exe)만 path 키 — 일반 폴더는 소수. 실패는 비캐싱이라 상한 압박 없음. |
| `wt.exe` 부재(미설치/Server) 폴백 신뢰성 | 터미널 안 뜸 | ENOENT/spawn 실패 명시 감지 → powershell `-NoExit` cwd 폴백. 둘 다 실패만 토스트. |
| `app.getFileIcon`은 ext-only가 아닌 **실존 경로**를 요구 | 확장자만으론 추출 불가 | **확정 전략(reviewer 타당 확정)**: frontend가 항상 실존 항목 경로를 보내고 backend가 추출 후 캐시 키를 ext 로 환원 → "그 ext 를 처음 만난 실제 파일"로 1회 추출, 이후 ext 키 공유(§3.1·§3.2). 추출 실패는 비캐싱이라 다음 실존 경로로 재시도. |
| 주소창 단일클릭이 의도치 않은 편집 진입 | UX 거슬림 | `closest('button')` 가드는 **주소 컨테이너 안의 브레드크럼 버튼만** 걸러낸다(이동 전담). 즐겨찾기(★) 버튼은 주소 컨테이너 **밖의 형제 요소**(`PanelToolbar.tsx` L127, 주소 `<div>` 는 L139~)라 `onAddressBarClick` 핸들러 자체가 호출되지 않아 **무관**하다. 필요 시 mousedown 드래그 구분. |

**에스컬레이션(PM)**: 아이콘 추출 전략(실존 경로 추출 + ext 키 환원)은 reviewer **타당 확정**·PM 확정 완료. 잔여 결정(범위/설계 모순)이 팀 내 2회 미해결이면 PM에 올림.

---

## 8. frontend / backend 분담

- **backend(Main)**: channels/contracts/guard 계약 추가 → `os/shell.openTerminal` + `os/icon.ts`(LRU) → `shell.handlers` 핸들러 2종(open-terminal·icon). **인터페이스 먼저 합의**(아래 §9 시그니처).
- **frontend(Renderer)**: preload `shell.openTerminal` + infra `shellApi`/`iconCache`/`app/usecases(open.openTerminalAt·icons)` → `contextMenu` 항목 → `PanelToolbar` 단일클릭 → `FileListView` OSIcon. 계약 동결 후 mock 위에서 병렬 진행 가능.
- **병렬 가능 경계**: §9 시그니처 합의 직후 backend(핸들러)와 frontend(소비)가 동시 진행. 통합은 icon dataUrl/터미널 실행을 런타임 스모크로 교차 검증.

---

## 9. 신규 채널 최종 시그니처 (인터페이스-먼저 합의 대상)

```ts
// shared/ipc
SHELL_OPEN_TERMINAL: 'shell:open-terminal'
interface ShellOpenTerminalReq { readonly cwd: string }
[CHANNELS.SHELL_OPEN_TERMINAL]: { req: ShellOpenTerminalReq; res: Result<void> }
// ShellIconReq{ path?; ext? } → ShellIconRes{ dataUrl } : 기존 동결, 변경 없음

// main/os
openTerminal(normalizedDir: string): Promise<OpenResult>            // wt -d → powershell cwd 폴백
getFileIconDataUrl(req: { path: string; ext?: '__dir__' | '__drive__' }): Promise<string | null>  // 실존 path 추출, LRU 512, 실패 비캐싱

// guard
zShellOpenTerminalReq = z.object({ cwd: zPath })
zShellIconReq = z.object({ path: zPath, ext: z.enum(['__dir__','__drive__']).optional() })

// preload  : shell.openTerminal(req), shell.icon(req)[기존]
// infra    : shellApi.openTerminal(cwd), shellApi.icon(req)  (icon 어댑터는 app/usecases/icons 가 감쌈)
// infra/icon : iconKeyFor(entry), iconRequestFor(entry), getCachedIcon(key), requestIcon(entry), subscribeIcon(cb)
// usecase  : open.openTerminalAt(path) + terminalErrorMessage(code) [open.ts 추가],
//            contextMenu buildMenuItems "터미널 열기"(빈영역: 붙여넣기·새폴더 다음/새로고침 앞 / 단일폴더: 열기 다음)
```

캐시 전략 요약(확정): frontend는 **항상 실존 경로** 전송 → backend가 `win32.extname(path)`로 키 환원 — 일반 파일=`ext:<ext>`, per-file(exe/lnk/ico/cur 등)=`path:<path>`, 폴더=`__dir__`, 드라이브=`__drive__`. **추출/조회 실패는 비캐싱**(영구 폴백 방지, 다음 실존 경로로 재시도). 2단 캐시: **backend LRU(512)** + **frontend Map(ext 종류 수로 자연 상한)**, **in-flight Promise 디듀프**. 보안: 두 채널 모두 isTrustedSender + zod + guardPath, 터미널은 추가 stat 디렉토리검증 + execFile 인자배열(셸 미경유, ADR-005), 아이콘은 읽기 전용 dataUrl(실행 없음).
