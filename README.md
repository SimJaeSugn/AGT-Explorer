# AGT-Finder

멀티 디렉토리 파일탐색기 (Electron + TypeScript + React, Windows).

기획·설계·구현 산출물은 [`docs/`](docs/) 참조. 프로젝트 가이드는 [`CLAUDE.md`](CLAUDE.md).

## 요구사항

- **Node.js 20 또는 22 LTS** (`package.json` engines: `>=20.11 <21 || >=22 <23`)
- Windows 10/11 x64

## 개발 실행

```powershell
npm install
npm run dev        # electron-vite dev (HMR)
```

기타 스크립트: `npm run typecheck`, `npm run lint`, `npm run build`(타입체크 + electron-vite 빌드).

## 빌드 (로컬 인스톨러 — GitHub 업로드 없음)

로컬 동작 확인·수동 배포용 NSIS 인스톨러만 생성한다. **GitHub Releases에는 아무것도 올리지 않는다.**

| 방법 | 명령 | 비고 |
|---|---|---|
| 스크립트(권장) | `.\build-installer.ps1` | `npm install`(의존성 동기화) → `npm run package`. 산출물 경로·크기 출력 |
| 〃 옵션 | `.\build-installer.ps1 -Install -OpenFolder` | `-Install`=`npm ci`(깨끗한 재설치), `-OpenFolder`=완료 후 `dist\` 열기 |
| 직접 | `npm run package` | clean → typecheck → electron-vite build → electron-builder(게시 없음) |

산출물: `dist\AGT-Finder Setup <버전>.exe` (+ `latest.yml`·`*.blockmap` 도 `dist\`에 생성되나 업로드되지 않음).

> ⚠️ 이렇게 만든 `.exe`만 GitHub 릴리스에 수동 업로드하면 자동 업데이트가 새 버전을 **못 본다**(`latest.yml`·`.blockmap` 누락). 실제 출시는 아래 `npm run release` 를 쓴다.

## 릴리스 (GitHub Releases 게시 → 자동 업데이트 배포)

```powershell
# 1) package.json 의 version 을 올린다 (설치된 버전보다 높아야 업데이트가 감지됨)
# 2) 게시
npm run release
```

- `release` = `npm run build && electron-builder --win --config electron-builder.yml --publish always`.
- electron-builder 가 `AGT-Finder-Setup-<버전>.exe` + `.blockmap` + `latest.yml`(업데이터 매니페스트)을
  GitHub Releases(`SimJaeSugn/AGT-Explorer`)에 업로드한다. `releaseType: release` 설정으로 draft 없이 즉시 공개.

### GitHub 토큰 설정

게시에는 GitHub 토큰(Contents: write 권한)이 필요하다. 둘 중 하나로 주입:

```powershell
# A) 세션 임시 (권장)
$env:GH_TOKEN = "github_pat_..."; npm run release
```

```
# B) 파일 — 프로젝트 루트 electron-builder.env (electron-builder 가 읽는 고정 파일명)
GH_TOKEN=github_pat_...
```

> `electron-builder.env` 는 `.gitignore` 에 등록되어 있다(토큰 평문 — **커밋 금지**).
> 리포가 PUBLIC이라 *사용자 앱의 업데이트 다운로드*에는 토큰이 필요 없다(게시할 때만 필요).

## 자동 업데이트 동작

- 모듈: `src/main/os/autoUpdate.ts` (`src/main/index.ts` 부팅 시 `initAutoUpdate()` 호출, electron-updater).
- **패키징된 빌드에서만** 동작(`app.isPackaged`). dev/오프라인/오류는 내부 격리(throw 0)되어 부팅 영향 없음.
- 앱 시작 시 릴리스의 `latest.yml` 1회 조회 → 새 버전이 있으면 백그라운드 차등 다운로드 →
  완료 시 OS 알림 → **다음 재시작 때 NSIS가 조용히 설치**(작업 중 강제 종료 안 함).

### 주의

- **첫 배포 한정**: updater가 없는 옛 빌드는 자동 업데이트되지 않는다. updater 포함 버전(최초 1.9.1)을
  한 번 **수동 설치**해야 이후 버전부터 자동 적용된다.
- **미서명 경고**: 코드서명 인증서(.pfx) 미적용 시 설치/업데이트마다 Windows SmartScreen 경고가 뜬다.
  `electron-builder.yml` 의 `CSC_LINK`/`CSC_KEY_PASSWORD` 환경변수 슬롯으로 적용 가능.

> 상세 배경·결정 근거: [`docs/architecture/adr/ADR-006-packaging.md`](docs/architecture/adr/ADR-006-packaging.md)
