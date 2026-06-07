# ADR-005 — 프로세스 / 보안 모델

상태: 제안 · 2026-06-06

## 맥락
파일탐색기는 사용자 디스크 전체에 읽기/쓰기/삭제를 한다. Renderer(웹 컨텍스트)에 FS 권한을 직접 주면 단 하나의 렌더러 취약점이 임의 파일 조작으로 번진다. 동시에 **대용량 I/O가 UI를 멈추면 안 되고**(US-5.2/5.6), **로컬 전용·텔레메트리 옵트인**(PRD 7장·D5)을 지켜야 한다.

## 선택지 비교

### (a) Renderer의 FS 권한
| 옵션 | 장점 | 단점 |
|---|---|---|
| **Main만 FS, Renderer는 IPC로만(채택)** | 신뢰 경계 명확, 취약점 영향 격리 | IPC 계약/직렬화 비용 |
| `nodeIntegration: true`로 Renderer 직접 FS | 구현 간단 | **심각한 보안 안티패턴**, Electron 권고 정면 위배 |

### (b) 격리/샌드박스
| 옵션 | 장점 | 단점 |
|---|---|---|
| **contextIsolation+sandbox+contextBridge(채택)** | Electron 20+ 기본·권고, 권한 누수 차단 | preload에 안전 API 표면 설계 필요 |
| 격리 끔 | preload에서 자유로운 객체 공유 | 프로토타입 오염·권한 누수 위험 |

### (c) 무거운 작업 실행 위치
| 옵션 | 장점 | 단점 |
|---|---|---|
| **별도 Worker(UtilityProcess/Worker Threads)(채택)** | Main 이벤트루프·UI 비차단, 크래시 격리 | 프로세스 간 통신/취소 설계 필요 |
| Main에서 직접 동기/대형 작업 | 단순 | Main 블로킹 → IPC·창 전체 멈춤 |

### (d) Worker 실행 모델: UtilityProcess vs Worker Threads — **P4 확정**
SPK-Worker(roadmap) 결과 **Worker Threads 채택**. 근거:

| 기준 | Worker Threads(채택) | UtilityProcess |
|---|---|---|
| 작업 성격 | copy/move/delete 는 **I/O 바운드**(fs 스트림). 스레드로 충분 | CPU 격리 이점이 작음 |
| 네이티브 모듈 | **불필요** — `node:fs` 스트림만 사용. 휴지통(`shell.trashItem`)·속성창은 Electron `shell`/COM 의존이라 **Main 스레드**에 둠 → Worker 에 네이티브 의존 없음 | 별도 Node 런타임 부팅·preload 설정 비용 |
| 취소 정밀도 | **SharedArrayBuffer(Int32) + `Atomics`** 로 메시지 큐 지연 없이 sub-chunk 즉시 감지(실증: 2번째 progress 시점 취소 → 부분 파일 정리) | 메시지 IPC 취소 → 큐 지연 가능 |
| 충돌 왕복 | `postMessage`/`on('message')` 양방향 단순(실증: conflict→resolve overwrite 적용) | MessagePort 별도 수립 필요 |
| 크래시 내성 | 작업 스레드 크래시가 Main 을 죽이지 않음(worker.on('error')) — 충분 | 프로세스 완전 격리(과한 격리) |

→ 본 앱은 네이티브 모듈 의존이 없고 I/O 바운드이므로 **Worker Threads** 가 통신·취소·번들 모두 단순·정밀. 휴지통/속성창처럼 Electron API 가 필요한 작업만 Main 스레드에서 처리해 "Worker 에 네이티브 모듈" 리스크(SR1) 자체를 제거.

## 결정
- 모든 `BrowserWindow`: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`.
- **FS/OS 접근은 Main 전용**. Renderer는 Preload `contextBridge`로 노출된 **메서드 단위 `window.api`**로만 접근.
- **방어 심층 검증**: Preload 1차(형태) + Main 핸들러 2차(senderFrame 출처·zod 스키마·경로 정규화).
- **대용량 복사/이동/삭제·대형 스캔은 Worker(Worker Threads)**에서 실행, Main(OperationManager)이 진행률 200ms 스로틀로 중계·취소(SharedArrayBuffer/Atomics) 전달. **휴지통(`shell.trashItem`)·속성창은 Electron/COM 의존이라 Main 스레드 직접 처리**(Worker 네이티브 의존 제거).
- 엄격 CSP, 원격 콘텐츠 로드 없음, 네트워크는 텔레메트리 옵트인 외 차단(D5).
- **쉘 실행 계열(`shell:open`/`open-with`/`show-properties`)** 은 정규화·존재·권한 확인 후 `shell.openPath`/`openExternal`에 **검증된 단일 경로만** 전달한다. 명령행 조립(인자 주입) 금지, `openExternal`은 `http`/`https`/`mailto` 프로토콜 화이트리스트만 허용(임의 경로/스킴 실행 차단). 상세 규칙은 [system-architecture.md §3.3-4](../system-architecture.md).

## 근거
- Electron 공식 보안 모범사례(contextIsolation 기본, ipcRenderer 통째 노출 금지, IPC sender 검증)와 정합.
- 단일 렌더러 취약점이 FS로 번지지 않도록 권한을 Main에 가둔다.
- Worker 분리로 비차단 성능(US-5.2/5.6) + 작업 크래시가 UI를 죽이지 않음(안정성 99.5%).

## 트레이드오프
- IPC 직렬화/계약 유지 비용(대량 엔트리는 청크 스트리밍·경량 DTO로 완화).
- Preload API 표면을 신중히 설계·최소화해야 함(노출이 곧 공격면).
- ~~**미결**: Worker를 UtilityProcess vs Worker Threads 중 무엇으로 할지~~ → **P4 확정: Worker Threads**(위 §(d)). 네이티브 모듈 의존 없음·I/O 바운드·SharedArrayBuffer 취소 정밀도·양방향 메시지 단순성을 근거로 채택. 헤드리스 실증(scripts/verify-worker.ts)으로 진행률·충돌 왕복·취소를 검증.
