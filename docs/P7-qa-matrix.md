# P7-D F장 Windows 특수케이스 QA 매트릭스

> 작성: QA · 2026-06-07 · 상태: **헤드리스 verify 완비 · 실케이스 런타임 위임**
> 입력: [P7-execution-plan.md §2.4·§6](./P7-execution-plan.md) · features F장 · ADR-005 §3.3(경로 보안)
> 헤드리스 증명: `scripts/verify-fmatrix.ts`(32 PASS) + 기존 `verify-fs`·`verify-watch`·`verify-scan`.

본 매트릭스는 F장(Windows 특수 경로/링크/권한) 케이스를 **헤드리스 verify 로 증명 가능한 로직**과
**실 환경(권한·네트워크·ACL)이 필요한 런타임 항목**으로 정직하게 분리한다. ⚠️ "헤드리스 verify
가능"은 *코드 로직·정규화·격리 동작*을 의미하며, 실 디바이스 동작(네트워크 폴링 전환·스크린 표시
육안)은 별도 런타임 컬럼이다.

## 1. 매트릭스 (케이스 × 기대동작 × 헤드리스 / 런타임)

| # | 케이스 | 기대 동작 | 헤드리스 verify | 런타임 실측 필요 | 증명 위치 |
|---|---|---|---|---|---|
| F-1 | **롱패스(>260, `\\?\`)** | `normalizePath` 가 `\\?\`·`\\?\UNC\` 프리픽스 보존(차단 안 함)·롱패스 폴더 `fs:list`/`fs:stat` **throw 0, Result 정상** | ✅ `verify-fmatrix §1`(깊은 중첩 307자 실폴더) | 실 탐색기 진입·표시 육안·롱패스 미지원 구형 OS | `paths.normalizePath`·`FileSystemService.list/stat` |
| F-2 | **정션 링크(junction)** | 링크를 **따라가지 않음**(scanEngine `lstat.isSymbolicLink()`→skipped++)·`attrs.symlink=true` 표기·합계 미포함 | ✅ `verify-fmatrix §2`(`fs.symlink …'junction'` 권한 불요) | 실 탐색기 내 표시·아이콘 | `FileSystemService.toEntry`·`scanEngine.runScan` |
| F-3 | **정션 순환(조상 가리킴)** | realpath 방문 `Set` + 링크 미추적으로 **무한루프 없이 종료**(throw 0) | ✅ `verify-fmatrix §2`·`verify-scan §4` | — (헤드리스로 충분) | `scanEngine` visited Set |
| F-4 | **심볼릭 링크(symlink, 파일/디렉토리)** | 정션과 동일 처리(미추적·격리) | ⚠️ 부분 — symlink 생성은 **개발자모드/관리자 권한** 필요(junction 으로 동등 로직 검증) | ✅ 권한 있는 런타임에서 실 symlink | (로직은 junction 과 동일 경로) |
| F-5 | **UNC 경로(`\\srv\share`)** | `isUncPath`→`isLikelyRemotePath` true → **eager 폴링**·감시 격리(throw 0) | ✅ `verify-fmatrix §3`·`verify-watch §6`(경로 판정 로직) | ✅ 실 네트워크 공유 연결·폴링 diff 동작 | `paths.isUncPath/isLikelyRemotePath`·`WatchService` |
| F-6 | **롱패스 UNC(`\\?\UNC\…`)** | `isUncPath` true(원격 분류)·`normalizePath` 보존 | ✅ `verify-fmatrix §1·§3` | 실 롱패스 네트워크 공유 | 동상 |
| F-7 | **매핑 네트워크 드라이브(`X:\`)** | `driveTypeService`(CIM DriveType=4) 캐시→`isNetworkDriveRoot`→eager 폴링. 캐시 미초기화/실패 시 false 폴백(reactive 의존, 회귀 0) | ✅ `verify-fmatrix §3`·`verify-watch §12·§13`(캐시 동기 주입) | ✅ 실 매핑 드라이브·실 PowerShell CIM 수집 | `paths.isNetworkDriveRoot`·`driveType` |
| F-8 | **권한거부(ACL deny, EACCES)** | `fs:list`/op:* 가 `FileOpError(EACCES)` **1급 전파**(throw 0)·패널 denied 표시·작업 부분실패 격리 | ⚠️ 코드경로만 — ACL 조작은 권한 필요. ENOENT/ENOTDIR 로 1급 전파 패턴 검증 | ✅ 실 ACL 거부 폴더(`icacls /deny`)에서 EACCES | `FileSystemService`·`engine.ts`·`verify-ops` |
| F-9 | **미존재 경로(ENOENT)** | `fs:list`/`stat` **throw 0, Result.err(ENOENT)** | ✅ `verify-fmatrix §4`·`verify-fs §5` | — | `FileSystemService` |
| F-10 | **파일을 디렉토리로 list(ENOTDIR)** | throw 0, Result.err(ENOTDIR) | ✅ `verify-fmatrix §4` | — | `FileSystemService.list` |
| F-11 | **예약명/금지문자(`CON`, `<>:"/\|?*`)** | `validateEntryName` EINVAL(생성·이름변경 거부) | ✅ `verify-ops`(이름검증) | — | `paths.validateEntryName` |
| F-12 | **유니코드/이모지 파일명** | 정상 표시·정렬·작업(throw 0) | ✅ `verify-fs`(유니코드 임시파일) | 실 표시 육안 | `FileSystemService` |

## 2. 헤드리스 verify 실행 결과 (verify-fmatrix.ts)

```
RESULT: 32 passed, 0 failed
```
- 번들/실행: `esbuild scripts/verify-fmatrix.ts --bundle --platform=node --format=cjs --external:electron --alias:@shared=./src/shared --outfile=./out/verify-fmatrix.cjs && node ./out/verify-fmatrix.cjs`
- 본 환경은 **OS 롱패스 지원 + 정션 생성 권한 보유** → F-1·F-2·F-3 실폴더 케이스가 실제로 실행됨
  (환경에 따라 롱패스/정션 생성 실패 시 자동으로 코드경로만 검증하고 NOTE 표기 — 위장 없음).

## 3. 런타임 매트릭스(사용자 환경 실측 — 본 환경 차단)

아래는 **실 디바이스·권한이 필요해 헤드리스로 증명 불가**한 항목. 사용자 Windows 런타임에서 수행.

| 케이스 | 절차 | 합격 기준 |
|---|---|---|
| 실 네트워크 공유(UNC) | `\\<서버>\<공유>` 진입 → 파일 변경 → 감시 갱신 확인 | eager 폴링으로 변경 반영(fs.watch 실패해도 폴링 diff), throw 0 |
| 실 매핑 드라이브(`X:\`) | `net use X: \\srv\share` → 진입 → 변경 감시 | `driveTypeService` 가 X 를 DRIVE_REMOTE 로 수집 → eager 폴링 |
| 실 symlink(디렉토리) | 개발자모드/관리자: `mklink /D linkdir target` → 부모 폴더 진입·스캔 | 링크 미추적(skipped)·순환 무한루프 없음 |
| 실 ACL 거부 폴더 | `icacls deny <user>:(R)` 폴더 → 진입·복사 시도 | `fs:list` EACCES denied 표시(throw 0)·op:* 부분실패 격리 |
| 롱패스 표시 육안 | >260자 폴더 진입 → 이름/스크롤/작업 | 정상 표시·작업, 경로 잘림 없음 |

## 4. 정직성 게이트
- ✅(헤드리스 충족): F-1·F-2·F-3·F-5(판정)·F-6·F-7(판정)·F-9·F-10·F-11·F-12 의 **로직**.
- ⚠️(런타임 필요): F-4(실 symlink)·F-5/F-7(실 디바이스 동작)·F-8(실 ACL) — roadmap/traceability 에
  "헤드리스 verify 완비 · 실케이스 런타임 실측 필요"로 표기, ✅ 위장 금지(P7 계획 §0·§8).
- 기존 verify 회귀 0 확인: `verify:fs`(19)·`verify:scan`(28)·`verify:watch`(77)·`verify:ops`(35) 전부 PASS.
