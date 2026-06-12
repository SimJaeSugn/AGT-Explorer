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

### 5-M. §M 네트워크 화이트리스트 규칙 (ADR-007 ② · 2026-06-08 추가)

기존 "main 네트워크 import 전면 금지(D5)"를 **전면 해제하지 않고**, 단일 디렉토리만 예외로 둔다:

- **기존 차단 유지(8개)**: 현재 `.eslintrc.cjs` main override가 이미 차단 중인 `node:http`/`http`·`node:https`/`https`·`net`/`node:net`·`dgram`/`node:dgram`은 **그대로 유지**한다.
- **신규 차단 추가**: 현재 `.eslintrc.cjs`는 **`node:tls`도, 원격 라이브러리(`ssh2`·`ssh2-sftp-client`·`basic-ftp`)도 차단하지 않는다.** 구현 시 이들을 main `no-restricted-imports`에 **신규 차단 대상으로 추가**해야 한다(이는 "유지"가 아니라 "추가" 작업임). `basic-ftp`의 FTPS가 `node:tls`를 쓰므로 `node:tls` 차단이 화이트리스트 모델의 핵심이다.
- `.eslintrc.cjs` `overrides`로 **`src/main/remote/**` 에 한해 위 전체(기존 8개 + 신규 `node:tls`·원격 라이브러리) import를 allow**한다(그 외 main 전 경로 전면 금지 불변).
- `src/main/remote/` 밖 모듈은 원격 기능을 `RemoteService` 인터페이스로만 호출(네트워크 표면이 한 디렉토리 경계 뒤로 캡슐화).
- 렌더러·도메인·shared의 네트워크 import 전면 금지는 불변 — 원격은 `remote:*` IPC로만.

> **구현 체크**: `.eslintrc.cjs` main override `no-restricted-imports`에 추가할 신규 차단 = `node:tls`, `ssh2`, `ssh2-sftp-client`, `basic-ftp`. 전체 차단은 `overrides`의 `src/main/remote/**`에서만 해제.

---

## 6. §M 외부 연계 신규 모듈 배치 (2026-06-08 비파괴 추가)

> 보안·프로세스 결정은 [ADR-007](./adr/ADR-007-remote-protocol-and-network-boundary.md). 상태: **🔜 미착수(설계 단계)**. 아래는 §2 폴더 트리에 **추가**되는 위치다(기존 트리 무변경).

```text
src/
├─ main/
│  ├─ remote/                     # ▶ 신규 — 네트워크 특권 디렉토리(ESLint 예외·ADR-007 ②)
│  │  ├─ RemoteService.ts         #   원격 추상 인터페이스(list/stat/get/put/mkdir/rename/delete)
│  │  ├─ SftpAdapter.ts           #   ssh2-sftp-client 구현(SFTP·호스트키 hostVerifier·키 인증)
│  │  ├─ FtpAdapter.ts            #   basic-ftp 구현(FTP/FTPS·TLS·비암호화 경고 신호)
│  │  ├─ RemoteSessionManager.ts  #   sessionId별 연결 수명·격리·끊김/타임아웃 처리
│  │  └─ remoteTransfer.ts        #   업/다운로드 스트림·.part 임시명·OperationManager 연동·취소
│  ├─ ipc/
│  │  ├─ dnd.handlers.ts          # ▶ 신규 — dnd:start-drag(sender·경로검증·로컬 한정)
│  │  ├─ clipboard.handlers.ts    #   (기존 확장) clipboard:write-files/read-files/has-files(CF_HDROP)
│  │  └─ remote.handlers.ts       # ▶ 신규 — remote:*(sender·zod·세션검증·비밀 미수록)
│  ├─ os/
│  │  ├─ dragdrop.ts              # ▶ 신규 — webContents.startDrag 래퍼(Main 전용)
│  │  ├─ shellClipboard.ts        # ▶ 신규 — CF_HDROP·Preferred DropEffect 바이트 조립/파싱
│  │  └─ credentials.ts           # ▶ 신규 — safeStorage(DPAPI) 비밀 암호화 저장·복호화(평문 금지)
│  └─ persistence/
│     ├─ RemoteProfileStore.ts    # ▶ 신규 — remote/profiles.json(비밀 제외 메타)·known_hosts.json(지문)
│     └─ (credentials.enc)        #   safeStorage 암호문(평문 아님·os/credentials.ts 관리)
│
├─ renderer/
│  ├─ domain/
│  │  ├─ entities/                #   (확장) RemoteLocation·RemoteProfile·RemoteError 타입
│  │  └─ rules/
│  │     └─ transferRoute.ts      # ▶ 신규 — 출발/도착 location → copy/move/upload/download 판정(순수)
│  ├─ app/
│  │  ├─ usecases/
│  │  │  ├─ remote.ts             # ▶ 신규 — 연결/프로필/탐색/전송 유스케이스
│  │  │  ├─ clipboardExternal.ts  # ▶ 신규 — CF_HDROP 쓰기/읽기·내부/외부 우선순위
│  │  │  └─ externalDrag.ts       # ▶ 신규 — 외부 드래그 감지·dnd:start-drag 위임
│  │  └─ stores/
│  │     └─ remoteSlice.ts        # ▶ 신규 — 세션·프로필·호스트키 경고 상태
│  ├─ infra/api/                  #   (확장) remoteApi·clipboardApi·dndApi 래퍼
│  └─ ui/
│     ├─ remote/                  # ▶ 신규 — 연결 다이얼로그·사이드바 "원격" 섹션·원격 배지·경고
│     └─ dnd/                     #   (확장) 외부 드래그 시작 핸들러
│
└─ shared/
   ├─ ipc/
   │  ├─ channels.ts              #   (확장) DND_*·CLIPBOARD_*(파일)·REMOTE_* 채널 상수
   │  └─ contracts.ts             #   (확장) 위 채널 요청/응답·이벤트 타입
   └─ dto/                        #   (확장) RemoteProfileDTO·RemoteError·ClipboardFilesDTO 등
```

### 각 위치 책임 한 줄 요약(신규)

- `src/main/remote/*` — **유일한 네트워크 특권 디렉토리**. 원격 어댑터·세션·전송. ESLint 예외(ADR-007 ②).
- `src/main/os/credentials.ts` — 비밀을 safeStorage(DPAPI)로만 암호화 보관(평문 금지·D6).
- `src/main/os/shellClipboard.ts` — CF_HDROP/Preferred DropEffect OS 클립보드 포맷 어댑터(신규 의존성 0).
- `src/main/os/dragdrop.ts` — `webContents.startDrag` Main 전용 래퍼(검증된 로컬 경로만).
- `renderer/domain/rules/transferRoute.ts` — 로컬/원격 전송 종류 판정 순수 함수(D&D·클립보드·키보드 공유).
- `renderer/ui/remote/*` — 원격 연결·탐색 UI(로컬 패널 UX 재사용·시각 구분 배지).

> **신규 npm 의존성**: `ssh2-sftp-client`(Apache-2.0)·`basic-ftp`(MIT)만 추가(`src/main/remote/`에서만 import). 자격증명·CF_HDROP·외부 드래그는 Electron 내장(신규 의존성 0).

---

## 7. §N 즐겨찾기 UX 신규/수정 모듈 배치 (2026-06-08 비파괴 추가)

> 모듈 경계는 [software-architecture §12](./software-architecture.md). 채널·흐름은 [system-architecture §5-N](./system-architecture.md). 상태: **🔜 미착수(설계 단계)**. **신규 IPC 채널 0 · 신규 npm 의존성 0 · 신규 ADR 0 · Main 측 신규 파일 0**(전부 Renderer 내부). 아래는 §2 폴더 트리에 **추가/수정**되는 위치다(기존 트리 무변경·`src/main/**`·`src/preload/**`·`src/shared/**` 무변경).

```text
src/renderer/
├─ domain/
│  └─ rules/
│     └─ favoriteWatermark.ts     # ▶ 신규(N1) — 패널 경로 vs 즐겨찾기 정확 일치 판정 + 표시 텍스트(별칭/basename) 순수 함수
├─ app/
│  └─ stores/
│     └─ sidebarSlice.ts          #   (확장·N2) reorderFavorite(from,to) 추가 — favorites 배열 재배열(Immer). 기존 액션 불변
└─ ui/
   ├─ panel/
   │  ├─ Panel.tsx                #   (확장·N1) FileListView 뒤 배경 워터마크 레이어 마운트(또는 아래 FavoriteWatermark 합성)
   │  └─ FavoriteWatermark.tsx    # ▶ 신규(N1·선택) — 배경 워터마크 레이어(absolute·pointer-events:none·aria-hidden·테마 반투명·말줄임)
   ├─ sidebar/
   │  ├─ Sidebar.tsx              #   (확장·N2) 즐겨찾기 행 드래그 핸들·드롭 인디케이터·Alt+Shift+↑/↓ 키 핸들러(로컬·미배정 조합)·정렬 ARIA
   │  └─ useFavoriteReorder.ts    # ▶ 신규(N2) — 사이드바 즐겨찾기 전용 경량 드래그 훅 + 외부 pub/sub 상태(파일 dragState와 별개)
   └─ theme/
      └─ palette.ts / tokens.ts   #   (확장·N1) 4테마(라이트/다크/시스템·resolved/블루라이트)별 워터마크 반투명도 토큰 1종 추가
```

### 각 위치 책임 한 줄 요약(신규/수정)

- `renderer/domain/rules/favoriteWatermark.ts` — N1 판정·텍스트 소스 순수 함수(`normalizeDisplay`·`baseName`·`locationKindOf` 재사용). FS/IO 모름.
- `renderer/app/stores/sidebarSlice.ts`(확장) — N2 `reorderFavorite` 액션 1개 추가. 순서=`favorites` 배열 자체(별도 필드 0).
- `renderer/ui/panel/Panel.tsx`·`FavoriteWatermark.tsx` — N1 배경 레이어(목록 뒤 z-index·비상호작용·접근성 제외).
- `renderer/ui/sidebar/Sidebar.tsx`·`useFavoriteReorder.ts` — N2 드래그/키보드 재정렬 UI(섹션 격리·타 섹션 무영향).
- `renderer/ui/theme/*`(확장) — N1 테마별 워터마크 반투명도 토큰(본문 위 비중첩 장식).

> **세션 영속**: N2 순서는 기존 `app/usecases/session.ts`(`[...s.favorites]` 직렬화)·`src/main/persistence/defaults.ts coerceSidebar`(`asStrArray` 순서 보존)가 **변경 없이** 처리한다 — `SidebarSnapshot` 구조·스키마 버전 불변(N2 신규 영속 파일·필드 0).
>
> **ESLint 경계 불변**: 신규 모듈 전부 `domain`(순수)·`app/stores`·`ui` 규칙을 따른다 — `favoriteWatermark.ts`는 react/infra/shared-ipc import 금지(도메인 순수), `ui/sidebar/*`는 `app` 경유. §5의 network 화이트리스트와 무관(네트워크 import 0).

---

## 8. §P~§U 파워 기능 14종 신규 모듈 배치 (2026-06-09 비파괴 추가)

> 모듈 경계는 [software-architecture §13·§14](./software-architecture.md). 채널·흐름은 [system-architecture §5-PU](./system-architecture.md). ADR: [008~012](./adr/ADR-000-index.md). 상태: **🔜 미착수(설계 단계)**. 아래는 §2 폴더 트리에 **추가/확장**되는 위치다(기존 트리 무변경). **네트워크 import 0**(압축·grep·해시 전부 로컬) — §5/§5-M network 화이트리스트(`src/main/remote/`)와 무관, ESLint 경계 불변.

```text
src/
├─ main/
│  ├─ archive/                    # ▶ 신규(Q1·ADR-008) — zip 어댑터(로컬·네트워크 import 없음)
│  │  ├─ ArchiveService.ts        #   archive:// 추상(open/list/extract/add) — RemoteService 패턴 차용(인터페이스는 별개)
│  │  ├─ ZipReader.ts             #   yauzl 스트리밍 읽기(엔트리 열거·추출 스트림)
│  │  ├─ ZipWriter.ts             #   yazl 재작성식 추가(원자 rename)
│  │  └─ ArchiveSessionManager.ts #   열린 zip sessionId 수명·임시물 정리
│  ├─ hash/                       # ▶ 신규(P1해시·R2·R4·ADR-009) — 공용 해시·비교(로컬)
│  │  ├─ hashEngine.ts            #   환경 비의존 스트리밍 해시(algo 파라미터·HashHooks) — scanEngine 패턴
│  │  ├─ compareEngine.ts         #   P1 폴더 비교(메타 4상태 + 해시 옵션)
│  │  ├─ dupEngine.ts             #   R2 크기 그룹핑→해시 그룹 확정
│  │  └─ HashManager.ts           #   jobId·취소 플래그·200ms 스로틀·세션 격리(ScanManager 형태)
│  ├─ search/                     # ▶ 신규(S1·ADR-010) — grep 엔진(로컬)
│  │  ├─ grepEngine.ts            #   환경 비의존 스트리밍 라인 스캔·정규식
│  │  ├─ binaryDetect.ts          #   바이너리 휴리스틱(확장자 + NUL/비텍스트 샘플)
│  │  └─ GrepManager.ts           #   jobId·취소·200ms·증분 결과 푸시
│  ├─ operations/
│  │  └─ OperationManager.ts      #   (확장·R3·ADR-011) 내부 TransferQueue 스케줄러·일시정지·재시도. op:* 채널·의미 불변
│  ├─ workers/                    #   (확장) 추출/추가·hash·grep 워커(각 엔진 import·SharedArrayBuffer 취소+일시정지)
│  ├─ ipc/
│  │  ├─ archive.handlers.ts      # ▶ 신규 — archive:*(sender·zod·경로검증·로컬 한정·Zip Slip)
│  │  ├─ hash.handlers.ts         # ▶ 신규 — hash:*(compare/dup/verify·jobId·취소)
│  │  ├─ search.handlers.ts       # ▶ 신규 — search:content:*(jobId·취소·증분)
│  │  └─ queue.handlers.ts        # ▶ 신규 — queue:*(list/state/pause/resume/retry/concurrency)
│  └─ persistence/
│     └─ defaults.ts              #   (확장·T1) coerceTagsByPath ※coerceFilterPresets(T3)는 2026-06-09 폐기·제거·스키마 2→1 환원
│
├─ renderer/
│  ├─ domain/
│  │  ├─ entities/                #   (확장·Q1·U3) ArchiveLocation·Tab.color/locked 타입
│  │  └─ rules/
│  │     ├─ archiveSafePath.ts    # ▶ 신규(Q1) — Zip Slip 경계 검증(순수·헤드리스 verify 대상)
│  │     ├─ transferRoute.ts      #   (확장·Q1) archive↔local 전송 종류 추가
│  │     ├─ compare.ts            # ▶ 신규(P1) — 4상태 분류·짝지음 순수 규칙
│  │     ├─ (filterComposition.ts) # ✗ 폐기(2026-06-09)·T3와 함께 코드 제거 — T1 합성은 구현 시 재설계
│  │     ├─ tags.ts               # ▶ 신규(T1) — 색 팔레트·경로 키 정규화
│  │     ├─ batchRename.ts        # ▶ 신규(R1) — 규칙→이름매핑·충돌검사(순수)
│  │     └─ paletteMatch.ts       # ▶ 신규(S2) — 명령/위치 매칭 점수(순수)
│  ├─ domain/keybindings/index.ts #   (확장·S2/U1) Ctrl+Shift+P→palette.open·Space→quicklook.toggle
│  ├─ app/
│  │  ├─ usecases/                #   (확장) archive·compare·dedup·checksum·contentSearch·queue·folderSize 트리거 브리지
│  │  └─ stores/                  #   (확장/신규) compareSlice·dedupSlice·searchSlice·operationsSlice(큐)·panelsSlice(filter·tag·archive location) ※presetsSlice(T3)는 2026-06-09 폐기·제거
│  ├─ infra/api/                  #   (확장) archiveApi·hashApi·searchApi·queueApi 래퍼
│  └─ ui/
│     ├─ compare/                 # ▶ 신규(P1) — diff 뷰·동기 스크롤·미러 미리보기
│     ├─ dedup/                   # ▶ 신규(R2) — 중복 그룹 패널
│     ├─ rename/                  # ▶ 신규(R1) — BatchRenameDialog
│     ├─ queue/                   # ▶ 신규(R3) — 전송 큐 패널(StatusBar 인디케이터 연동)
│     ├─ search/                  #   (확장·S1) "내용 검색" 모드·결과 목록·점프
│     ├─ palette/                 # ▶ 신규(S2) — CommandPalette 오버레이
│     ├─ tags/                    # ▶ 신규(T1) — 태그 부여·표시·필터
│     ├─ (preset/)                # ✗ 폐기(2026-06-09)·T3 프리셋 저장/적용/관리 코드 제거
│     ├─ quicklook/               # ▶ 신규(U1) — Space 퀵룩 오버레이(preview 재사용)
│     ├─ toolbar/                 #   (확장·U2) Breadcrumb 형제 폴더 드롭다운
│     └─ panel/views/FileListView #   (확장·T2) details 폴더 행 용량 인라인
│
└─ shared/
   ├─ ipc/
   │  ├─ channels.ts              #   (확장) ARCHIVE_*·HASH_*·SEARCH_CONTENT_*·QUEUE_* 채널 상수(+EVENT_CHANNELS 푸시 추가)
   │  └─ contracts.ts             #   (확장) 위 채널 요청/응답·이벤트 타입
   └─ dto/                        #   (확장) CompareResultDTO·DupGroupDTO·GrepMatchDTO·QueueItemDTO·TagColor·SessionSnapshot(tagsByPath) ※FilterPreset·filterPresets(T3)는 2026-06-09 폐기·제거
```

### 각 위치 책임 한 줄 요약(신규)

- `src/main/archive/*` — zip 어댑터(로컬·yauzl/yazl·Zip Slip은 추출 워커 + `archiveSafePath.ts` 양쪽 검증).
- `src/main/hash/*` — 공용 해시·비교·중복 엔진(P1 해시 옵션·R2·R4 공유·Worker·scanEngine 패턴).
- `src/main/search/*` — grep 스트리밍 스캔·바이너리 제외(외부 ripgrep 없음·로컬 워커).
- `OperationManager`(확장) — 전송 큐 스케줄러(op:* 비파괴·operationId 재사용).
- `renderer/domain/rules/{archiveSafePath,compare,tags,batchRename,paletteMatch}.ts` — 순수 규칙(헤드리스 verify 대상·react/infra/shared-ipc import 금지). ※`filterComposition.ts`(T3)는 2026-06-09 폐기·코드 제거됨.
- `persistence/defaults.ts`(확장) — T1/T3 메타 안전 복원(신규 채널 0·세션 영속 재사용).

> **신규 npm 의존성**: `yauzl`(MIT)·`yazl`(MIT)만 추가(`src/main/archive/`에서만 import·네이티브 빌드 0). 해시(Node 내장 SHA-256)·grep(Node 내장 스트림)·큐·태그/프리셋·R1/S2/T2/U1/U2/U3은 **신규 의존성 0**. 외부 7z 바이너리·ripgrep 바이너리는 **비채택**(ADR-005 실행 표면 불변·ADR-008/010).
>
> **ESLint 경계**: archive/hash/search는 `src/main/` 일반 규칙(네트워크/TLS/원격 라이브러리 import 금지 — §5·§5-M 화이트리스트는 `src/main/remote/`만). 도메인 순수 규칙 6종은 §5 도메인 import 규칙 준수(react/zustand/infra/shared-ipc 금지).

### §Y Windows 셸 컨텍스트 메뉴 연동 — 신규 파일 위치 (2026-06-12·🔜 설계 완료·구현 전·[ADR-013](./adr/ADR-013-shell-context-menu-verbs.md))

> COM `Shell.Application` `Verbs()`/`DoIt()`를 **상주 PowerShell 자식 프로세스**로 호출한다. hash/grep 워커는 Worker Threads(Node)이지만 §Y는 PowerShell+COM이 필요하므로 `os/` 어댑터 계층의 **상주 자식 프로세스**로 둔다(`showProperties` COM 선례의 상주판). 신규 네이티브/npm 의존성 0·신규 IPC 채널 2종(invoke).

```text
src/main/
├─ os/
│  ├─ shellVerbs.ts            # ▶ 신규 — ShellVerbsService(상주 PowerShell 워커 수명·lazy 기동·crash 재기동·쿨다운·종료 정리·FIFO 요청 큐·타임아웃→섹션 비노출·블랙리스트 표시명 정규화 필터·index+표시명 결합 식별·재열거 교차검증)
│  └─ shellVerbsWorker.ps1     # ▶ 신규 — 고정 PowerShell 스크립트(stdin JSON 루프·Shell.Application·Namespace().ParseName()·Verbs()/DoIt()·UTF-8·명령행 합성 0)
├─ ipc/
│  ├─ shell.handlers.ts        #   (확장) shell:context-verbs·shell:invoke-verb 핸들러(sender·zod·guardPath·로컬 한정)
│  └─ guard.ts                 #   (확장) zShellContextVerbsReq{path}·zShellInvokeVerbReq{path,verbId}
└─ (electron-builder.yml)      #   (확장) shellVerbsWorker.ps1 extraResources 패키징(UQ-Y1)

src/renderer/
├─ app/usecases/
│  ├─ shellVerbs.ts            # ▶ 신규 — verb 조회(shell:context-verbs)·경로키 TTL 캐시·실행(shell:invoke-verb·fire-and-forget)
│  └─ contextMenu.ts           #   (확장) buildMenuItems 단일 선택 말미 "Windows 메뉴" 섹션 병합(B6 자체 명령 불변)
├─ app/stores/uiSlice.ts       #   (확장) 컨텍스트 메뉴 상태 winVerbs{status,items}
├─ infra/api/                  #   (확장) shellApi.contextVerbs·shellApi.invokeVerb 래퍼
└─ ui/contextmenu/ContextMenu.tsx #   (확장) "Windows 메뉴" 섹션 렌더(로딩/채움/숨김)·항목 클릭 실행

src/shared/
├─ ipc/channels.ts             #   (확장) SHELL_CONTEXT_VERBS·SHELL_INVOKE_VERB(invoke·EVENT_CHANNELS 무변)
├─ ipc/contracts.ts            #   (확장) ShellContextVerbsReq/Res·ShellInvokeVerbReq·ChannelMap
└─ dto/index.ts                #   (확장) ShellVerbDTO{ verbId; display }
```

- `src/main/os/shellVerbs.ts` — 상주 PowerShell 워커 오케스트레이터(수명·요청 큐·타임아웃·블랙리스트·verb 식별). 렌더러와 직접 통신하지 않고 IPC 핸들러 경유(`HashManager` 형태의 서비스).
- `src/main/os/shellVerbsWorker.ps1` — 고정 텍스트 스크립트(경로·verbId는 stdin JSON으로만 수신·문자열 합성 0). `electron-builder` extraResources로 패키징(asar 외부·UQ-Y1).
- **신규 npm/네이티브 의존성 0**(COM·PowerShell 시스템 내장). **ESLint 경계**: `os/`는 `src/main/` 일반 규칙(네트워크 import 금지·`remote/`만 예외). PowerShell 호출은 셸 실행 계열이므로 ADR-005 §3.3-4(명령행 합성 0) 준수.
