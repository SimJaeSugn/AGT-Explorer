# J2 GetDriveType 연동 계획서 — 매핑 네트워크 드라이브(X:\) 완전 지원 (US-9.2 ③)

> 대상: US-9.2 수용기준 ③ "네트워크/이동식 드라이브 폴링 폴백" 중 **매핑 네트워크 드라이브** 잔여 한계 해소.
> 현재: UNC(`\\server\share`)는 eager 폴링 ✅. 매핑 드라이브(`X:\`)는 `isNetworkDriveRoot`가 **항상 false**라 eager에서 빠지고 reactive(fs.watch 실패 시)에만 의존 → 🟡 부분 한계.
> 목표: 매핑 드라이브 문자를 **실제 감지**해 eager 폴링 대상에 포함 → US-9.2 ③ 매핑 드라이브 🟡 → ✅.
> 범위: **계획만**(구현 없음). 기존 컨벤션(execFile·Result·캐시·주입 헤드리스·격리 throw 0) 준수.
> 작성: 2026-06-07 / TL.

---

## 0. 현황 요약 (코드 확인)

| 지점 | 현재 상태 | 비고 |
|------|----------|------|
| `paths.ts` `isNetworkDriveRoot(_p)` | **항상 false** (L125-128) | 네이티브 드라이브 타입 감지 부재 명시 |
| `paths.ts` `isLikelyRemotePath(p)` | `isUncPath(p) \|\| isNetworkDriveRoot(p)` (L136-138) | 사실상 UNC만 true |
| `WatchService` `isRemoteFn` | 기본 `= isLikelyRemotePath` 주입(L95), eager 분기 L136 | `{ isRemoteFn? }` 주입점 이미 존재 |
| `FileSystemService.guessDriveKind` | `startsWith('\\\\') → 'network'`, 그 외 'fixed' (L622-625) | 매핑 드라이브를 'fixed'로 오분류, 재사용 불가 |
| `shell.ts` | `execFile`+`windowsHide:true`+`-NoProfile -NonInteractive -Command`+`timeout`+`$env` 보간회피 패턴 확립 | `showProperties`(L103-151)가 표준 패턴 |
| `index.ts` | `app.whenReady().then(...)`에서 `initPersistence`→`registerIpcHandlers`→`createMainWindow` (L46-85) | refresh 호출 주입 지점 |
| `verify-watch.ts` | `WatchService({ isRemoteFn, watchFn })` 주입으로 eager/reactive 헤드리스 검증 | 드라이브 집합 주입 지점 필요 |

**근본 원인**: Node에 `GetDriveType` 네이티브 API 없음. 매핑 드라이브의 네트워크 여부는 동기 판정 불가.
**해결 전략**: 네이티브 의존(koffi/ffi) **추가 없이**, 부팅 시 Windows 쿼리로 네트워크 드라이브 문자 집합을 **비동기 1회 수집 → 캐시**하고, `isNetworkDriveRoot`를 **동기 캐시 조회**로 실구현한다.

---

## 1. 핵심 설계 결정 (확정)

### (a) GetDriveType 접근 방식 — PowerShell CIM, execFile 단일 채택

세 후보를 비교해 **PowerShell `Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=4'`** 단일 채택.

| 후보 | 명령 | 신뢰성 | 비용 | 보안 | 판정 |
|------|------|--------|------|------|------|
| **PowerShell CIM (채택)** | `Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=4' \| Select -Expand DeviceID` | DriveType=4(`DRIVE_REMOTE`) WMI 표준값, 안정 | PowerShell 콜드스타트 ~수백ms·1회/부팅 | execFile·셸 미경유·고정 인자·사용자 입력 0 | **채택** |
| `wmic logicaldisk` | `wmic logicaldisk where drivetype=4 get deviceid` | 동등 결과 | 저렴 | execFile 가능 | wmic **deprecated**(Win11+ 미설치 가능) → 탈락 |
| `net use` | `net use` 출력 파싱 | 매핑명 위주(드라이브 문자만 추출은 가능) | 저렴 | execFile 가능 | 출력 포맷 변동·로케일 의존 파싱 취약 → 탈락 |

- **DriveType=4 = `DRIVE_REMOTE`** (Win32 `GetDriveType` 의미값과 동일). CIM이 곧 GetDriveType 연동의 안전한 우회.
- **execFile (셸 미경유) + 고정 인자**: `['-NoProfile','-NonInteractive','-Command', FIXED_SCRIPT]`. 스크립트는 **상수**(경로·사용자 입력 미주입) → 주입면 0. `shell.ts`의 기존 `showProperties` 패턴과 동형.
- 출력은 `Z:\nY:` 같은 **드라이브 문자 행 목록**. 파싱은 **화이트리스트 정규식** `^[A-Z]:$`만 통과(아래 5절).

### (b) 캐시 + 동기 판정 — `Set<string>`(대문자 드라이브 문자)

- `isNetworkDriveRoot`는 동기 시그니처여야 하므로(WatchService.start가 동기 분기), **네트워크 드라이브 문자 집합을 캐시**한다: `Set<string>` (예: `{'Z','Y'}`, 대문자 단일 문자).
- `isNetworkDriveRoot(path)` = path에서 드라이브 문자(`X:` → `X`)를 추출 → 대문자화 → 집합 포함이면 true.
- **갱신 전략(견고·단순 안 확정)**: 두 트리거를 결합한다.
  1. **부팅 1회 비동기 refresh** (index.ts whenReady, non-blocking — 부팅 차단 0).
  2. **lazy refresh on watchStart**: `WatchService.start`에서 경로가 **드라이브 루트(`^[A-Z]:`) 형태이고 아직 캐시 미초기화 또는 미지(unknown) 드라이브**면, **비동기 refresh를 trigger-and-forget**한다(현재 start는 캐시 현재값으로 즉시 판정하고, refresh 완료는 *다음* watchStart부터 반영). 이로써 **런타임 매핑/해제 변경**(앱 실행 중 `net use Z: ...`)에 대응한다.
  - 주기 polling refresh는 **채택 안 함**(불필요한 PowerShell 반복 비용·부팅 1회+lazy로 충분). 단, 재진입 가드(refresh 진행 중 중복 호출 무시)와 throttle(최소 간격, 예 30s)을 두어 watchStart 폭주 시 PowerShell 남발 방지.
  - 매핑 드라이브가 부팅 시점엔 없다가 런타임에 생긴 첫 watchStart는 **그 1회는 reactive 폴백**으로 커버되고(회귀 0), trigger된 refresh가 캐시를 채워 **두 번째 진입부터 eager** — 점진적 정확성. 정직 표기(R3).

### (c) WatchService 연결 — 기본 isRemoteFn 유지, 주입점 재사용

- 기본 `isRemoteFn = isLikelyRemotePath`(= `isUncPath(p) || isNetworkDriveRoot(p)`)는 **그대로**. `isNetworkDriveRoot`가 캐시 실구현으로 바뀌면 **WatchService 코드 변경 없이** 매핑 드라이브가 eager가 된다(연결 지점만 paths.ts 내부 교체).
- lazy refresh trigger(위 b-2)만 `start`에 1줄 추가(드라이브 루트 형태 & 미지 → `void driveType.refresh()`). 주입점 `{ isRemoteFn? }`는 **헤드리스에서 캐시 모킹/강제**에 계속 사용.

### (d) 헤드리스 검증성 — lookup 주입 + 캐시 set 직접 주입

- `DriveTypeService`(또는 모듈 싱글턴)는 **쿼리 함수(queryFn)를 주입 가능**하게 설계: `refresh()` 내부가 PowerShell execFile을 직접 호출하지 않고 `this.queryFn()`(기본 = 실제 PowerShell execFile 래퍼)을 호출 → verify는 PowerShell 없이 `() => Promise.resolve(['Z','Y'])` 같은 스텁 주입으로 네트워크 드라이브 집합 강제.
- 추가로 **캐시 set 직접 주입**(`setNetworkDriveLetters(Set)`)도 노출 → verify가 비동기 refresh 없이 즉시 동기 판정 검증.
- 실제 PowerShell 호출은 **런타임에서만**.

### (e) 보안 (ADR-005 §3.3)

- `execFile('powershell.exe', ['-NoProfile','-NonInteractive','-Command', FIXED_SCRIPT], { windowsHide:true, timeout:5000 })` — **셸 미경유·고정 상수 스크립트·경로/사용자 입력 미주입**.
- 출력 파싱: 줄 단위 trim 후 **`^[A-Z]:$` 화이트리스트만 통과**(드라이브 문자만, 그 외 모든 출력 폐기). 대문자 첫 글자만 Set에 저장.
- **실패/타임아웃/비-Windows/PowerShell 부재 → 빈 집합 폴백**: `isNetworkDriveRoot`가 false 유지 → **현재(UNC만 eager + reactive 폴백)와 정확히 동일** = 회귀 0. throw 0(격리).

---

## 2. 파일·함수 변경 지점 (시그니처)

### 2.1 신규 `src/main/os/driveType.ts`

```ts
/**
 * 매핑 네트워크 드라이브(DRIVE_REMOTE) 문자 감지·캐시 (J2 US-9.2③ / ADR-005).
 *
 * Node엔 Win32 GetDriveType 네이티브 API가 없으므로, PowerShell CIM
 * (Win32_LogicalDisk DriveType=4 = DRIVE_REMOTE)을 execFile(셸 미경유·고정 인자)로
 * 1회 조회해 네트워크 드라이브 문자 집합을 캐시한다. isNetworkDriveRoot 가 동기여야
 * 하므로 집합 조회는 동기, refresh 만 비동기. 실패·타임아웃·비-Windows 는 빈 집합
 * 폴백(회귀 0: UNC eager + reactive 폴백 유지). throw 0(격리).
 */

/** PowerShell CIM 조회 결과(드라이브 문자 목록, 예 ['Z','Y']) 반환. 주입 가능(헤드리스). */
type DriveQueryFn = () => Promise<string[]>

export interface DriveTypeServiceOptions {
  /** 기본 = 실제 PowerShell CIM execFile 래퍼. verify 헤드리스가 스텁 주입. */
  queryFn?: DriveQueryFn
  /** refresh throttle 최소 간격(ms). 기본 30_000. watchStart 폭주 시 PowerShell 남발 방지. */
  minRefreshIntervalMs?: number
}

export class DriveTypeService {
  constructor(opts?: DriveTypeServiceOptions)

  /** 캐시 갱신(비동기 1회·throttle·재진입 가드). 실패 시 캐시 유지(또는 초기 빈 집합). throw 0. */
  refresh(): Promise<void>

  /** 드라이브 문자(대소문자 무시 단일 문자 'Z' 또는 'Z:')가 네트워크 드라이브인지 동기 판정. */
  isNetworkDriveLetter(letter: string): boolean

  /** 캐시가 1회 이상 채워졌는지(lazy trigger 판단용). */
  isInitialized(): boolean

  /** 캐시 직접 주입(헤드리스 검증·강제). 대문자 단일 문자 집합. */
  setNetworkDriveLetters(letters: Iterable<string>): void
}

/** 싱글턴(paths.ts·index.ts·WatchService 공유). 옵션 없이 = 실 PowerShell 쿼리. */
export const driveTypeService: DriveTypeService
```

내부 `defaultQueryFn`(모듈 비공개):
```ts
// 고정 상수 — 경로/사용자 입력 미주입. DriveType=4 = DRIVE_REMOTE.
const CIM_SCRIPT =
  "Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=4' | Select-Object -ExpandProperty DeviceID"

async function defaultQueryFn(): Promise<string[]> {
  if (process.platform !== 'win32') return []          // 비-Windows: 빈 집합(회귀 0).
  return new Promise((resolve) => {
    execFile('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', CIM_SCRIPT],
      { windowsHide: true, timeout: 5000 },
      (error, stdout) => {
        if (error) return resolve([])                  // 실패/타임아웃 → 빈 집합 폴백.
        const letters = String(stdout).split(/\r?\n/)
          .map((s) => s.trim())
          .filter((s) => /^[A-Z]:$/.test(s))           // 화이트리스트: 드라이브 문자만.
          .map((s) => s[0]!)                            // 'Z:' → 'Z'.
        resolve(letters)
      })
  })
}
```

- `refresh()`: throttle(마지막 성공 timestamp + minInterval 이내면 skip) + 재진입 가드(진행 중이면 동일 Promise 공유 or skip) → `queryFn()` → 결과를 대문자 `Set<string>`로 교체. 실패해도 기존 캐시 유지(첫 실패는 빈 집합).

### 2.2 `src/main/fs/paths.ts` — `isNetworkDriveRoot` 실구현

```ts
import { driveTypeService } from '../os/driveType'

/**
 * 드라이브 문자 매핑 네트워크 드라이브(X:\)인지 동기 판정한다(J2 §2.2 / US-9.2③).
 * path 의 드라이브 문자(X:)를 추출해 driveTypeService 캐시(DRIVE_REMOTE) 조회.
 * 캐시 미초기화·실패 시 빈 집합 → false(UNC eager + reactive 폴백 유지, 회귀 0).
 */
export function isNetworkDriveRoot(p: string): boolean {
  if (typeof p !== 'string' || p.length === 0) return false
  const m = /^([A-Za-z]):/.exec(p)                     // 'X:\...' 또는 'X:' → 'X'.
  if (!m) return false                                 // UNC·롱패스·상대경로는 여기서 false.
  return driveTypeService.isNetworkDriveLetter(m[1]!)
}
```

- `isUncPath`·`isLikelyRemotePath`는 **시그니처·로직 변경 없음**. `isLikelyRemotePath = isUncPath(p) || isNetworkDriveRoot(p)`가 그대로 매핑 드라이브를 잡는다.
- 주의: `paths.ts → os/driveType.ts` 신규 import 방향. 순환 의존 없음(driveType는 paths를 참조하지 않음).

### 2.3 `src/main/fs/WatchService.ts` — lazy refresh trigger (1지점)

- 기본 `isRemoteFn`·eager 분기·주입점 **변경 없음**.
- `start()`의 stat 통과 후, eager 판정 직전/직후에 **드라이브 루트 형태 & 미지 드라이브면 비동기 refresh trigger**(런타임 매핑 변경 대응):

```ts
import { driveTypeService } from '../os/driveType'   // (또는 옵션으로 주입 — 아래 검증성 참고)

// start() 내부, statSync 디렉토리 검증 통과 후:
//   드라이브 루트(^[A-Z]:) 경로이고 캐시 미초기화 or 해당 문자 미등록이면,
//   다음 진입을 위해 비동기 refresh 를 trigger-and-forget(현재 판정은 캐시 현재값 사용).
if (/^[A-Za-z]:/.test(path) && !this.isRemoteFn(path)) {
  void driveTypeService.refresh()   // throttle·재진입 가드 내장 — 남발 무해.
}
if (this.isRemoteFn(path)) { this.startPolling(entry); return watchId }
```

- 헤드리스 검증성을 위해 **driveTypeService 의존을 옵션 주입으로** 둘 수도 있으나, `isRemoteFn` 주입만으로 eager/reactive 분기는 이미 강제 가능하므로 **lazy trigger의 driveTypeService는 모듈 싱글턴 직접 참조 + verify에서 setNetworkDriveLetters로 캐시 강제**가 더 단순(주입 표면 최소화). 최종: WatchService 옵션은 현행 유지(`watchFn`·`isRemoteFn`), trigger는 싱글턴 참조.

### 2.4 `src/main/index.ts` — 부팅 refresh (non-blocking)

```ts
import { driveTypeService } from './os/driveType'

// app.whenReady().then(async () => { ... registerIpcHandlers(); ... }) 내부,
// 또는 createMainWindow 후. 부팅을 막지 않도록 await 하지 않는다(trigger-and-forget).
void driveTypeService.refresh()   // PowerShell 콜드스타트가 부팅을 차단하지 않음.
```

- 위치: `registerIpcHandlers()` 직후(창 생성과 병렬). 실패해도 throw 0(서비스 내부 격리) → 부팅 영향 0.

### 2.5 `scripts/verify-watch.ts` — 매핑 드라이브 감지 검증 섹션 추가

기존 §6·§7 사이/뒤에 추가(드라이브타입 주입 기반):

```ts
import { driveTypeService } from '../src/main/os/driveType'
import { isNetworkDriveRoot } from '../src/main/fs/paths'

// ── 12) 매핑 네트워크 드라이브 감지(캐시 주입 → 동기 판정) ──
driveTypeService.setNetworkDriveLetters(['Z'])
check('매핑 Z:\\ → isNetworkDriveRoot true', isNetworkDriveRoot('Z:\\share'))
check('매핑 z:\\(소문자) → true(대소문자 무시)', isNetworkDriveRoot('z:\\share'))
check('로컬 C:\\ → false(미등록 드라이브)', !isNetworkDriveRoot('C:\\Users'))
check('UNC \\\\nas → isNetworkDriveRoot false(드라이브 문자 아님)', !isNetworkDriveRoot('\\\\nas\\m'))
check('매핑 Z: → isLikelyRemotePath true(eager 대상)', isLikelyRemotePath('Z:\\share'))
driveTypeService.setNetworkDriveLetters([])   // 폴백 시뮬레이션.
check('빈 캐시(폴백) → 매핑도 false(회귀 0: UNC만 eager)', !isNetworkDriveRoot('Z:\\share'))
check('빈 캐시에도 UNC eager 유지', isLikelyRemotePath('\\\\nas\\m'))

// ── 13) refresh queryFn 주입(PowerShell 미경유 파싱·폴백) ──
const svc = new DriveTypeService({ queryFn: async () => ['Y'] })
await svc.refresh()
check('queryFn 주입 refresh → 캐시 반영', svc.isNetworkDriveLetter('Y'))
const failSvc = new DriveTypeService({ queryFn: async () => { throw new Error('boom') } })
await failSvc.refresh()   // throw 0 격리.
check('queryFn 실패 → 빈 집합 폴백(throw 0)', !failSvc.isNetworkDriveLetter('Z'))

// (eager 폴링 동작 자체는 기존 §7 isRemoteFn 강제로 이미 커버 — 매핑 감지는 판정 경로만 추가 검증.)
```

> 기존 §6의 `isLikelyRemotePath(매핑 X:\) → false` 단언(L183)은 **삭제/갱신** 필요(이제 캐시에 따라 true 가능). doc-sync 시 정정.

---

## 3. DoD (완료 기준)

1. 매핑 드라이브 문자(예 `Z:`)가 부팅 후(또는 첫 watchStart trigger 후 차순) `isNetworkDriveRoot('Z:\\…') === true` → `WatchService.start`가 **eager 폴링** 진입(fs.watch 미시도).
2. **UNC eager 유지**(회귀 0): `isUncPath`·`isLikelyRemotePath(UNC)` 불변.
3. **실패 폴백 회귀 0**: PowerShell 실패/타임아웃/부재/비-Windows → 빈 집합 → 매핑 드라이브도 false → 기존 동작(UNC eager + reactive 폴백)과 **바이트 동등**. 모든 메서드 throw 0.
4. **보안**: `execFile`(셸 미경유)·고정 상수 스크립트(경로/사용자 입력 미주입)·출력 `^[A-Z]:$` 화이트리스트·`windowsHide:true`·`timeout`.
5. **헤드리스 검증**: verify가 PowerShell 없이 `setNetworkDriveLetters`/`queryFn` 주입으로 매핑 감지·파싱·폴백을 검증, 전부 PASS.
6. **계약 변경 0**: `channels.ts`·`contracts.ts`·IPC req/res shape 불변(판정은 전부 backend 내부).
7. **순환 의존 0**, typecheck·lint·`verify-watch` 그린.
8. **문서 동기화**: roadmap §0.5·traceability·user-stories US-9.2 ③ 🟡 → ✅(doc-synchronizer).

---

## 4. QA 포인트

- **매핑 드라이브 감지**: 캐시에 'Z' 주입 시 `Z:\`·`z:\`(대소문자)·`Z:\sub\dir` 모두 eager. 미등록 `C:\` 로컬은 fs.watch.
- **UNC 유지**: `\\server\share`·`\\?\UNC\…` 여전히 eager. UNC는 드라이브 문자 정규식 불일치로 isNetworkDriveRoot에선 false지만 isUncPath가 잡음(이중 안전).
- **실패 폴백 회귀 0**: queryFn throw/timeout/빈 출력/비-Windows → 빈 집합, 기존 reactive 폴백 경로 그대로. start throw 0.
- **보안 execFile**: 고정 스크립트 인자 배열, `$env`/경로 보간 없음(애초 입력 없음). 출력 화이트리스트 외 폐기(악성/예상외 출력 무시).
- **런타임 매핑 변경**: 앱 실행 중 `net use Z:` 후 첫 watchStart는 reactive, refresh trigger 반영 후 차순 eager(점진적). throttle로 PowerShell 남발 없음.
- **(런타임 스모크, 비-CI)**: 실 매핑 드라이브(`net use Z: \\host\share`)에서 패널 진입 → eager 폴링 4s diff로 외부 변경 자동 반영 확인.

---

## 5. 리스크

| ID | 리스크 | 영향 | 완화 |
|----|--------|------|------|
| R1 | **PowerShell 비용/지연**(콜드스타트 수백ms) | 부팅·watchStart 지연 | refresh는 trigger-and-forget(non-blocking)·throttle 30s·부팅 1회 — UI 차단 0 |
| R2 | **PowerShell 부재/제한 환경**(Server Core·정책) | 매핑 감지 불가 | timeout+error → 빈 집합 폴백 = reactive 폴백 유지(회귀 0). 정직 표기 |
| R3 | **런타임 매핑/해제 변경** 즉시 미반영 | 첫 진입 1회 reactive | lazy trigger로 차순 eager(점진적 정확성). 주기 polling 미채택(비용 회피) |
| R4 | **출력 파싱**(로케일·예상외 행) | 오탐/누락 | DeviceID는 로케일 무관(`Z:` 고정)·`^[A-Z]:$` 화이트리스트로 비드라이브 행 폐기 |
| R5 | **DriveType=4 의미 한정** | substituted drive(`subst`)·일부 클라우드는 4 아님 | 본 스코프는 매핑 네트워크 드라이브(DRIVE_REMOTE)만. 그 외는 reactive 폴백 유지(한계 정직 표기) |
| R6 | **verify §6 기존 단언 충돌**(`매핑 X:\ → false`) | verify red | 해당 단언 삭제/갱신 + 신규 §12·13 추가(2.5) |

---

## 6. 분담

| 담당 | 작업 | 산출물 |
|------|------|--------|
| **backend-dev** (주) | 신규 `os/driveType.ts`(DriveTypeService·defaultQueryFn·캐시·throttle·재진입 가드·폴백), `paths.ts` `isNetworkDriveRoot` 실구현, `WatchService.start` lazy trigger 1지점, `index.ts` 부팅 refresh | 위 5파일 변경 + typecheck/lint 그린 |
| **qa-engineer** | `verify-watch.ts` §12·13 추가(캐시/queryFn 주입 검증)·기존 §6 단언 정정, 매핑 감지·UNC 유지·실패 폴백 회귀 0·보안 점검, (선택) 실 매핑 드라이브 런타임 스모크 | verify 그린 + QA 리포트 |
| frontend-dev | **없음**(렌더러·계약 변경 0) | — |
| devops | **없음**(신규 의존성 0 — PowerShell 시스템 내장) | — |

---

## 7. 구현 순서 (단일 Phase)

1. `os/driveType.ts` 신규(주입 가능 queryFn·캐시·refresh·폴백) → 단위 검증(queryFn 스텁).
2. `paths.ts` `isNetworkDriveRoot` 캐시 조회로 교체(순환 의존 확인).
3. `WatchService.start` lazy refresh trigger 1줄 + `index.ts` 부팅 refresh.
4. `verify-watch.ts` §12·13 + §6 정정 → `verify-watch` 그린.
5. doc-sync(US-9.2 ③ 🟡 → ✅, roadmap §0.5·traceability).

---

### 부록 — 확정 채택값
- 쿼리: `powershell.exe -NoProfile -NonInteractive -Command "Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=4' | Select-Object -ExpandProperty DeviceID"`
- 파싱 화이트리스트: `^[A-Z]:$` → 첫 글자 대문자 Set.
- timeout: 5000ms · windowsHide: true · throttle: 30s · 부팅 1회 + lazy on watchStart.
- 폴백: 빈 집합(회귀 0). 계약 변경 0. 신규 의존성 0.
