# P7 — 보안 점검 / npm audit / 코드서명 준비

> 작성: 2026-06-07 · P7(릴리스 준비) 산출물. 헤드리스로 가능한 점검·설정 준비를 담고, 실제 서명·실측은 사용자/CI 환경 항목으로 분리한다.

## 1. npm audit 판정 (2026-06-07 실측)

`npm audit` 결과 **9건(high 6 · moderate 3)**. `npm audit fix`(비파괴)로는 **0건 해소** — 전부 major 업그레이드 필요(파괴적).

| 분류 | 패키지 | 배포물 영향 |
|---|---|---|
| 빌드 툴체인(devDependency) 8건 | `electron-builder`·`app-builder-lib`·`dmg-builder`·`electron-builder-squirrel-windows`·`tar`·`electron-vite`·`esbuild`·`vite` | **없음** — 빌드/패키징 시점에만 사용, 배포되는 앱 런타임에 포함 안 됨 |
| 런타임 본체 1건 | `electron`(31.x) | 앱 런타임 본체(devDependencies에 선언되나 배포물에 임베드) |

### 판정: 릴리스 차단 아님 + major 업그레이드는 사용자 결정 보류
- **빌드 툴체인 8건**: 배포 앱에 미포함 → 런타임 보안 영향 0. 빌드 환경(개발자/CI)에서만 노출되며, 신뢰된 로컬 빌드라 실위험 낮음.
- **electron 본체 1건**: 다수 advisory가 macOS/미사용 표면이거나, **ADR-005 하드닝으로 이미 차단** — CSP(`script-src 'self'`)·`sandbox:true`·`contextIsolation:true`·`nodeIntegration:false`·`webSecurity:true`·`setWindowOpenHandler` 외부 링크 차단·senderFrame 검증·원격 콘텐츠 로드 없음.
- **major 업그레이드(electron 31→42, electron-builder 24→26)는 전면 재검증(패키징·런타임 회귀)이 필요** → 자동 적용하지 않고 **사용자/릴리스 담당 결정**으로 보류. 보안 패치 채택 시 별도 안정화 라운드 권장.

### 권장 후속(사용자 결정)
- `npm audit fix --force`는 electron/electron-builder를 major로 올려 **빌드·런타임 회귀 가능** → 즉시 적용 금지.
- 릴리스 전 electron을 **현재 메이저의 최신 패치**(31.x 최신)로 올리는 비파괴 업그레이드 + 재빌드/재verify 권장.

## 2. 코드서명 준비 (electron-builder.yml)

실제 서명은 **유효한 코드서명 인증서(.pfx)** 가 필요하므로 사용자/CI 환경 항목. 설정은 준비 완료:

- 인증서는 **환경변수로 주입**(저장소 커밋 금지): `CSC_LINK`(.pfx 경로 또는 base64), `CSC_KEY_PASSWORD`(암호). electron-builder가 `CSC_*`를 자동 인식.
- `win.signingHashAlgorithms: [sha256]` 설정.
- 타임스탬프 서버(`rfc3161TimeStampServer`)는 인증서 준비 후 주석 해제.
- **환경변수 미설정 시 미서명 빌드(경고만, 빌드 성공)** — 현재 헤드리스 빌드는 미서명으로 정상 동작.

### 서명 빌드 절차 (사용자 환경)
```powershell
$env:CSC_LINK = "C:\path\to\cert.pfx"      # 또는 base64
$env:CSC_KEY_PASSWORD = "<암호>"
npm run package                              # NSIS 서명 인스톨러 산출(dist/)
```

## 3. sourcemap 분리 (electron.vite.config.ts)

- main/preload: `sourcemap: true`(별도 `.map` 생성).
- renderer: `sourcemap: 'hidden'`(번들에 `//#` 참조 미삽입 → 사용자 노출 없음, 디버깅용 맵만 `out/`에 존재).
- **NSIS 패키지 제외**: `electron-builder.yml`의 `files`에 `!out/**/*.map` → 배포물에 sourcemap 미포함(디버깅용으로만 보관).

## 4. 보안 최종 점검 (ADR-005, 코드 사실)
- CSP: prod 헤더(`main/index.ts`) + 메타(`index.html`) 양쪽 `script-src 'self'`(eval 0 — recharts/highlight.js/marked 정적 스캔 0건).
- 프로세스: `contextIsolation:true·nodeIntegration:false·sandbox:true·webSecurity:true`(mainWindow.ts).
- IPC: 전 핸들러 `isTrustedSender`(senderFrame)·zod·`guardPath`(상위이탈 차단).
- 네트워크: 외부 송신 코드 0건(grep), `.eslintrc.cjs` main 오버라이드 `no-restricted-imports`(node:http/https/net/dgram) 정적 차단. 외부 링크는 `setWindowOpenHandler` deny + `shell.openExternal`.
- 단일 인스턴스 락(`requestSingleInstanceLock`).

## 5. 런타임/인증서 필요 항목 (헤드리스 불가 — 정직 분리)
- **실제 코드서명**: 인증서(.pfx) 필요 → 설정만 준비.
- **NSIS 설치/실행/제거 실측**: 빌드+Windows 설치 절차 필요.
- **성능 3종 실측**(1.5초/200ms): `docs/P7-perf-measurement.md` 절차로 런타임 측정.
- **F장 실 케이스**: 실 네트워크 드라이브·실 심볼릭 링크·실 ACL deny → `docs/P7-qa-matrix.md` 런타임 분류.
