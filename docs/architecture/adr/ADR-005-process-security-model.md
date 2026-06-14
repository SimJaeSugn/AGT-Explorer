# ADR-005 — 프로세스 / 보안 모델

상태: 제안 · 2026-06-06 · **부분 개정: 2026-06-08([ADR-007](./ADR-007-remote-protocol-and-network-boundary.md)) · 추가 부분 확장(설계): 2026-06-14([ADR-014](./ADR-014-agentic-natural-language-file-agent.md)·[ADR-015](./ADR-015-multi-llm-provider-abstraction.md) — 멀티 AI 제공자·D8)**

> **[2026-06-14 부분 확장 메모 — 비파괴·설계 단계]** 본 ADR의 "네트워크 차단 기본·외부 송신 없음(D5)"은 ADR-007(D7·§M3)에 이어 **[ADR-014](./ADR-014-agentic-natural-language-file-agent.md)·[ADR-015](./ADR-015-multi-llm-provider-abstraction.md)로 §Z1 자연어 파일 에이전트에 한해 추가 정밀화**된다. **[초판 ADR-014는 Anthropic 단일 엔드포인트 전제였으나, 사용자가 멀티 AI 제공자(Claude·OpenAI·내부 자체 모델)를 확정 → ADR-015가 송신 목적지를 3종으로 일반화·결정 D7→D8 갱신]**: 외부 송신은 (a) 텔레메트리 옵트인 + (b) 사용자 입력/저장 원격 호스트(§M3) + **(c) 에이전트가 활성화한 AI 제공자 — `api.anthropic.com`·`api.openai.com`·SSRF 화이트리스트를 통과한 내부 호스트만**(전면 개방 아님). 내부 자체 모델 base URL은 **화이트리스트 + IP 리터럴/사설망/메타데이터(169.254.169.254) 차단 + DNS 리바인딩/리다이렉트 방어**(ADR-015 G4·SSRF). `@anthropic-ai/sdk`·`openai`·`node:https`/`node:tls`/`node:dns` import는 **`src/main/agent/`에만 ESLint 화이트리스트**로 허용(ADR-007 결정② 동형·`verify:eslint-agent`·그 외 main/렌더러/domain/shared 금지 불변). 에이전트 루프는 **Main 단일 신뢰 경계**(본 ADR "FS/OS·네트워크=Main 전용"·ADR-007 결정⑤ 준수)이며 **`LLMProvider` 추상화 뒤에서 3제공자를 동일 구동**(제공자 무지·ADR-015 G1), API 키는 **제공자별 safeStorage 슬롯(ADR-007 결정③ 패턴)·렌더러 미노출**, 쓰기 도구는 **즉시 실행 0(plan 스테이징·사용자 confirm·기존 op:* + undo 실행)** 이라 본 ADR "실행 표면 미추가" 원칙을 지킨다. 상태 🔜 설계 완료·구현 전(roadmap §0.5). 기획 4종 편입 완료(features §Z1·user-stories 에픽24·flows F38~F41·PRD §6/§7 D8).

> **[2026-06-08 부분 개정 메모 — 비파괴]** 본 ADR의 **"네트워크는 텔레메트리 옵트인 외 차단(D5)"·"로컬 전용"** 부분은 §M3(FTP/SFTP 원격 접속) 편입으로 **[ADR-007](./ADR-007-remote-protocol-and-network-boundary.md) 결정 ①②에서 부분 개정**됐다(결정 D7). 네트워크 연결은 이제 **(a) 텔레메트리 옵트인 + (b) 사용자가 명시 입력/저장한 원격 호스트**로만 발생하며, 원격 네트워크 코드는 `src/main/remote/` 단일 디렉토리에만 ESLint 화이트리스트로 허용된다(그 외 main 전 경로 네트워크 import 전면 금지 불변). 프로세스 배치(원격=Main 스레드)·방어 심층·contextIsolation/sandbox·쉘 실행 규칙은 본 ADR 그대로 유지된다. 외부 D&D(`startDrag`)·CF_HDROP 클립보드(M1/M2)도 본 ADR "검증된 경로만·실행 표면 미추가" 원칙 안에서 ADR-007 결정 ⑦로 정의된다.

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
- 엄격 CSP, 원격 콘텐츠 로드 없음, 네트워크는 텔레메트리 옵트인 외 차단(D5). **[2026-06-08 부분 개정] §M3(FTP/SFTP)에 한해 "사용자가 명시 입력/저장한 원격 호스트로의 연결"을 추가 허용(D7·ADR-007 결정 ①). 원격 네트워크 import는 `src/main/remote/`에만 ESLint 화이트리스트로 허용(전면 해제 아님·ADR-007 결정 ②).**
- **쉘 실행 계열(`shell:open`/`open-with`/`show-properties`)** 은 정규화·존재·권한 확인 후 `shell.openPath`/`openExternal`에 **검증된 단일 경로만** 전달한다. 명령행 조립(인자 주입) 금지, `openExternal`은 `http`/`https`/`mailto` 프로토콜 화이트리스트만 허용(임의 경로/스킴 실행 차단). 상세 규칙은 [system-architecture.md §3.3-4](../system-architecture.md).

## 근거
- Electron 공식 보안 모범사례(contextIsolation 기본, ipcRenderer 통째 노출 금지, IPC sender 검증)와 정합.
- 단일 렌더러 취약점이 FS로 번지지 않도록 권한을 Main에 가둔다.
- Worker 분리로 비차단 성능(US-5.2/5.6) + 작업 크래시가 UI를 죽이지 않음(안정성 99.5%).

## 트레이드오프
- IPC 직렬화/계약 유지 비용(대량 엔트리는 청크 스트리밍·경량 DTO로 완화).
- Preload API 표면을 신중히 설계·최소화해야 함(노출이 곧 공격면).
- ~~**미결**: Worker를 UtilityProcess vs Worker Threads 중 무엇으로 할지~~ → **P4 확정: Worker Threads**(위 §(d)). 네이티브 모듈 의존 없음·I/O 바운드·SharedArrayBuffer 취소 정밀도·양방향 메시지 단순성을 근거로 채택. 헤드리스 실증(scripts/verify-worker.ts)으로 진행률·충돌 왕복·취소를 검증.
