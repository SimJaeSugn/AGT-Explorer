# ADR-006 — 패키징 / 배포

상태: 채택 · 2026-06-06 (자동 업데이트 GitHub Releases 도입 2026-06-22)

## 맥락
1차 타깃은 **Windows 10/11 x64**. 인스톨러, (향후) 코드 서명·자동 업데이트, 단일 인스턴스 실행이 필요(PRD 7장). 빌드는 electron-vite로 결정(ADR-001)했고, 패키징 도구를 별도로 정해야 한다.

## 선택지 비교

| 도구 | 인스톨러(NSIS) | 코드서명 | 자동업데이트 | electron-vite 결합 | Vite 안정성 |
|---|---|---|---|---|---|
| **electron-builder(채택)** | 성숙 | 성숙 | 성숙(builder/updater) | 템플릿 기본 결합 | 무관(분리) |
| Electron Forge makers | 지원 | 지원 | 지원 | Vite 경로 experimental | 리스크 |

## 결정
**electron-builder**로 Windows **NSIS 인스톨러**를 생성한다. 설정은 `electron-builder.yml`. 단일 인스턴스 락은 앱 코드(Main)에서 처리.

## 근거
- ADR-001에서 빌드를 electron-vite로 택했고, electron-vite 표준 템플릿이 electron-builder와 결합되어 있어 마찰이 적다.
- NSIS·코드서명·자동 업데이트 경로가 Windows에서 성숙해 향후 배포 요구를 모두 흡수.
- Forge makers는 본 빌드 선택(experimental Vite)과 충돌 → 보류.

## 트레이드오프
- 빌드(electron-vite)+패키징(electron-builder) 2단 파이프라인을 스크립트로 연결해야 함.
- 멀티 OS(C, macOS/Linux) 확장 시 builder 타깃 추가는 가능하나 코드서명·공증 등 OS별 작업이 별도로 필요(이번 사이클 범위 밖).

---

## 빌드 · 릴리스 방법 (2026-06-22 추가)

빌드 파이프라인은 두 갈래다. **로컬 인스톨러만 만드는 "빌드"** 와 **GitHub Releases에 게시해 자동 업데이트로 배포하는 "릴리스"** 는 명확히 구분한다.

### 1. 빌드 (로컬 인스톨러만 — GitHub 업로드 없음)

| 방법 | 명령 | 비고 |
|---|---|---|
| 스크립트(권장) | `.\build-installer.ps1` | `npm install`(의존성 동기화) → `npm run package` 순서. 산출물 경로·크기 출력. |
| 〃 옵션 | `.\build-installer.ps1 -Install -OpenFolder` | `-Install`=`npm ci`(깨끗한 재설치), `-OpenFolder`=완료 후 `dist\` 열기 |
| 직접 | `npm run package` | clean → typecheck → electron-vite build → electron-builder(게시 없음) |

- 산출물: `dist\AGT-Finder Setup <버전>.exe` (+ `latest.yml`, `*.blockmap` 도 `dist\`에 생성되나 **업로드되지 않음**).
- **GitHub에 아무것도 올리지 않는다.** electron-builder 게시 정책상 npm lifecycle 이벤트가 `package`(≠`release`)이고 `--publish`도 없으며 로컬(비-CI·태그 없음)이면 게시하지 않기 때문(`GH_TOKEN`·publish 설정이 있어도 동일). 코드 근거: `app-builder-lib/.../PublishManager.js` — `npm_lifecycle_event === "release"` 일 때만 자동 `publish: always`.
- 용도: 로컬 동작 확인, 수동 배포용 설치본 생성.

### 2. 릴리스 (GitHub Releases 게시 → 자동 업데이트 배포)

```
1) package.json 의 version 을 올린다 (설치된 버전보다 높아야 업데이트 감지).
2) npm run release
```

- `release` 스크립트 = `npm run build && electron-builder --win --config electron-builder.yml --publish always`.
- electron-builder 가 `AGT-Finder-Setup-<버전>.exe` + `.blockmap` + `latest.yml`(업데이터가 읽는 매니페스트)을 GitHub Releases에 업로드.
- 게시 설정(`electron-builder.yml`): `publish: github`(owner `SimJaeSugn`, repo `AGT-Explorer`), `releaseType: release`(draft 단계 생략·즉시 공개).
- **인증 토큰**: 게시에는 GitHub 토큰(Contents: write)이 필요하다. 프로젝트 루트 `electron-builder.env` 파일의 `GH_TOKEN=...` 또는 셸 환경변수 `$env:GH_TOKEN` 으로 주입. **`electron-builder.env` 는 `.gitignore` 로 커밋 금지**(토큰 평문). 리포가 PUBLIC이라 *사용자 앱의 업데이트 다운로드*에는 토큰이 불필요.

### 3. 자동 업데이트 동작 (electron-updater)

- 모듈: `src/main/os/autoUpdate.ts` (`index.ts` 부팅 시 `initAutoUpdate()` 호출).
- **패키징 빌드에서만** 동작(`app.isPackaged`). dev/오프라인/오류는 내부 격리(throw 0).
- 앱 시작 시 릴리스의 `latest.yml` 1회 조회 → 새 버전 있으면 백그라운드 차등 다운로드 → 완료 시 OS 알림 → **다음 재시작 때 NSIS가 조용히 설치**(작업 중 강제 종료 안 함).

### 주의사항

- **첫 배포 한정**: updater가 없는 옛 빌드는 자동 업데이트되지 않는다. updater 포함 버전(최초 1.9.1)을 한 번 **수동 설치**해야 이후 버전부터 자동 적용.
- **`build-installer.ps1` 산출물만 수동 업로드 금지**: `.exe`만 올리고 `latest.yml`·`.blockmap`을 누락하면 자동 업데이트가 새 버전을 못 본다. 출시는 반드시 `npm run release` 사용.
- **미서명 경고**: 코드서명 인증서(.pfx) 미적용 시 설치/업데이트마다 Windows SmartScreen 경고. `electron-builder.yml` 의 `CSC_LINK`/`CSC_KEY_PASSWORD` 슬롯으로 적용(§P7-F).
