# 디렉토리 구조 & 빌드/패키징 — Explorer

> 작성: 시니어 아키텍트 · 2026-06-06 · 상태: 제안 v1
> 관련: [system-architecture.md](./system-architecture.md) · [software-architecture.md](./software-architecture.md) · [adr/ADR-000-index.md](./adr/ADR-000-index.md)

---

## 1. 패키지 전략: 단일 패키지(single package) + 내부 경로 별칭

### 결정
**모노레포(npm workspaces/pnpm/turbo)를 쓰지 않고, 단일 패키지 안에서 `main`/`preload`/`renderer`/`shared`를 디렉토리로 분리**한다.

### 근거 (대안 비교)

| 옵션 | 장점 | 단점 | 적합성 |
|---|---|---|---|
| **단일 패키지(채택)** | 설정 단순, electron-vite가 3개 엔트리(main/preload/renderer)를 기본 지원, 의존성 한 곳 관리 | 패키지 단위 경계 강제는 약함(린트 규칙으로 보완) | MVP 규모·단일 앱에 최적 |
| 모노레포 | 패키지 경계가 물리적으로 강함, 코드 공유 명확 | 도구(turbo/pnpm) 오버헤드, 빌드 파이프라인 복잡, 1개 앱엔 과설계 | 다중 앱/공유 라이브러리 배포 시 |

- Explorer는 **배포 산출물이 데스크톱 앱 하나**다. 모노레포의 핵심 이점(여러 배포 단위 공유)이 없다 → **단순성 우선**(PRD 5장 아님, 아키텍트 설계 원칙).
- 계층/프로세스 경계는 **디렉토리 + ESLint import 규칙**(예: `renderer`가 `node:fs` import 금지, `domain`이 `react`/IPC import 금지)으로 강제한다. 물리적 패키지 분리 없이도 의존 방향 규칙을 지킬 수 있다.

---

## 2. 폴더 트리 (제안)

```text
explorer/
├─ docs/                          # 기획·아키텍처 문서 (현행)
│  └─ architecture/               # 본 설계 산출물
├─ electron.vite.config.ts        # main/preload/renderer 3-엔트리 빌드 설정
├─ electron-builder.yml           # 패키징/인스톨러(NSIS) 설정
├─ package.json
├─ tsconfig.json                  # 공통 베이스
├─ tsconfig.node.json             # main/preload(Node 환경)
├─ tsconfig.web.json              # renderer(DOM 환경)
├─ .eslintrc.cjs                  # 계층/프로세스 import 경계 규칙
│
├─ src/
│  ├─ main/                       # ▶ Main 프로세스 (Node·OS·FS 권한 보유)
│  │  ├─ index.ts                 # 앱 진입: 단일 인스턴스 락, 창 생성, 보안 옵션
│  │  ├─ windows/                 # BrowserWindow 생성·관리(보안 webPreferences)
│  │  ├─ ipc/                     # ipcMain.handle 등록 + 출처/스키마 검증
│  │  │  ├─ fs.handlers.ts        #   fs:* (목록/stat/드라이브/트리/검증 + 생성 fs:mkdir/fs:create-file·이름변경 fs:rename)
│  │  │  ├─ op.handlers.ts        #   op:* (복사/이동/삭제/취소/충돌해결)
│  │  │  ├─ shell.handlers.ts     #   shell:*/clipboard:* (실행·아이콘·속성·클립보드)
│  │  │  ├─ session.handlers.ts   #   session:*/workspace:*/settings:*
│  │  │  └─ guard.ts              #   senderFrame 검증·경로 정규화·zod 스키마
│  │  ├─ fs/                      # FileSystemService: 스트리밍 읽기·롱패스·링크·네트워크
│  │  ├─ operations/              # OperationManager·작업큐·AbortController·진행률 200ms 스로틀
│  │  ├─ workers/                 # 복사/이동/삭제 워커(UtilityProcess/Worker Threads)
│  │  ├─ os/                      # Windows 통합: 휴지통·시스템아이콘·속성창·쉘 실행
│  │  └─ persistence/             # session.json/settings.json/workspaces 원자적 저장·마이그레이션
│  │
│  ├─ preload/                    # ▶ Preload (신뢰 게이트)
│  │  ├─ index.ts                 # contextBridge.exposeInMainWorld('api', api)
│  │  └─ api.ts                   # 채널별 래퍼 1메서드씩 + 인자 1차 검증·이벤트 구독
│  │
│  ├─ renderer/                   # ▶ Renderer (React UI) — node 접근 금지
│  │  ├─ index.html
│  │  ├─ main.tsx                 # React 부트스트랩
│  │  ├─ app/                     # 애플리케이션 계층
│  │  │  ├─ usecases/             #   탭/분할/포커스/탐색/복사이동/검색/세션복원 유스케이스
│  │  │  └─ stores/               #   Zustand 슬라이스(tabs/panels/selection/operations/sidebar/ui)
│  │  ├─ domain/                  # 도메인 계층(순수 TS, 부수효과·React·IPC 의존 금지)
│  │  │  ├─ entities/             #   Window/Tab/Panel/FileEntry/Selection ... 타입
│  │  │  ├─ rules/                #   정렬(자연·폴더우선)·충돌명명·드래그의도·순환이동차단
│  │  │  ├─ keybindings/          #   PRD 8장 단축키 표 단일 출처(키→commandId)
│  │  │  └─ paths/                #   경로 유틸
│  │  ├─ infra/                   # 인프라 어댑터
│  │  │  └─ api/                  #   window.api 래핑 클라이언트·IPC이벤트→스토어 브리지
│  │  └─ ui/                      # UI 계층(React 컴포넌트)
│  │     ├─ App.tsx
│  │     ├─ keyboard/             #   KeyBindingRegistry·Dispatcher·CommandBus·컨텍스트 스코프
│  │     ├─ tabbar/               #   탭바
│  │     ├─ toolbar/              #   툴바·주소표시줄(브레드크럼/편집)
│  │     ├─ sidebar/              #   트리·즐겨찾기·최근·드라이브·휴지통
│  │     ├─ layout/               #   LayoutHost(단일/2분할/4분할 배치·분할선·최소폭)
│  │     ├─ panel/                #   Panel 셸·PanelHeader·SearchBar
│  │     │  └─ views/             #     FileListView(가상스크롤)·details/list/grid(S)
│  │     ├─ preview/              #   PreviewPanel(S)·형식별 렌더러
│  │     ├─ dialogs/              #   ProgressDialog·ConflictDialog·ConfirmDialog
│  │     ├─ statusbar/            #   상태바
│  │     ├─ dnd/                  #   드래그&드롭 핸들러(의도는 domain/rules 호출)
│  │     └─ theme/                #   다크/라이트/시스템 테마
│  │
│  └─ shared/                     # ▶ 3 프로세스 공통(타입·상수만, 런타임 부수효과 없음)
│     ├─ ipc/
│     │  ├─ channels.ts           #   채널명 상수(fs:list, op:start, ...) 단일 출처
│     │  └─ contracts.ts          #   요청/응답·이벤트 TS 타입(계약)
│     └─ dto/                     #   FileEntryDTO·DriveDTO·OpSummary·SessionSnapshot 등
│
├─ resources/                     # 앱 아이콘·인스톨러 자산
└─ tests/                         # 단위(도메인 규칙)·통합(IPC 계약)·e2e
```

### 각 위치 책임 한 줄 요약

- `src/main/*` — OS/FS 권한을 가진 유일한 곳. IPC 핸들러는 검증 후 서비스에 위임.
- `src/preload/*` — Renderer에 노출하는 안전 API 표면. 메서드 단위 한정 노출.
- `src/renderer/domain/*` — 순수 규칙·엔티티. 어떤 프레임워크/IO도 모른다(테스트 용이).
- `src/renderer/app/*` — 유스케이스 + 상태 스토어(도메인과 인프라를 조합).
- `src/renderer/infra/*` — `window.api`를 아는 유일한 Renderer 모듈.
- `src/renderer/ui/*` — React 표현 계층. 단축키·D&D는 규칙을 domain에 위임.
- `src/shared/*` — 3 프로세스가 공유하는 계약/DTO 타입. 런타임 로직 없음.

---

## 3. 빌드 도구: electron-vite

### 대안 비교

| 도구 | 역할 | 장점 | 단점 |
|---|---|---|---|
| **electron-vite (채택)** | 개발 빌드/번들 | Vite 기반 초고속 HMR, **main/preload/renderer 3-엔트리 1설정** 기본 지원, TS·React 1급, 환경별 분리 쉬움 | 패키징은 별도(electron-builder 결합 필요) |
| Electron Forge (+Vite 플러그인) | 스캐폴딩+빌드+패키징 통합 | 공식 통합 워크플로 | **Forge의 Vite 지원이 experimental**, 3-엔트리 제어·HMR 성숙도 낮음 |
| webpack(Forge 기본) | 번들 | 성숙·생태계 | dev 서버 느림, 설정 장황, Vite 대비 DX 열위 |

### 근거
- 성능 목표 달성과 무관하게 **개발 반복 속도(HMR)**가 생산성을 좌우하고, Vite의 HMR은 webpack 대비 압도적이다.
- electron-vite는 Main/Preload/Renderer **세 타깃을 한 설정으로** 다뤄 본 프로젝트의 3-프로세스 구조와 정확히 맞는다.
- Forge의 Vite 통합은 아직 experimental이라 안정성 리스크가 있어, **빌드(electron-vite) + 패키징(electron-builder)** 조합으로 각자 성숙한 도구를 쓴다. 상세는 [ADR-001](./adr/ADR-001-build-tool.md).

---

## 4. 패키징: electron-builder (NSIS)

| 도구 | 장점 | 단점 | 판정 |
|---|---|---|---|
| **electron-builder (채택)** | NSIS 인스톨러·코드서명·자동업데이트 성숙, electron-vite 템플릿 기본 결합, Windows 타깃 1급 | 설정 YAML 학습 | 채택 |
| Electron Forge makers | 공식·플러그인형 | Vite 경로가 experimental, 위 빌드 선택과 충돌 | 보류 |

- 1차 타깃 Windows 10/11 x64, NSIS 인스톨러. 코드 서명·단일 인스턴스·자동 업데이트(향후) 모두 electron-builder로 커버. 상세·트레이드오프는 [ADR-006](./adr/ADR-006-packaging.md).

---

## 5. 경계 강제 (ESLint import 규칙)

물리적 패키지 분리 대신 린트로 의존 방향을 강제한다(software-architecture 3.1):

- `renderer/**`는 `node:*`·`electron`·`fs`·`child_process` import 금지 → `infra/api`(=`window.api`)만 허용.
- `domain/**`는 `react`·`zustand`·`infra`·`shared/ipc` import 금지(순수 TS, DTO 타입만 허용).
- `ui/**`는 `infra/**` 직접 import 금지 → `app/**`(스토어·유스케이스) 경유.
- `main/**`·`preload/**`는 `renderer/**` import 금지.
- 공통 import는 `shared/**`(타입 전용)만 허용.

> 이 규칙들은 "의존 방향 규칙"을 빌드 타임에 검증해, 시간이 지나도 아키텍처가 침식되지 않게 한다.
