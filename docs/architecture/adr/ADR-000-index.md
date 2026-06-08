# ADR 인덱스 — Explorer 아키텍처 결정 기록

> 작성: 시니어 아키텍트 · 2026-06-06
> ADR(Architecture Decision Record)은 주요 기술 결정의 "맥락 → 선택지 비교 → 결정 → 근거 → 트레이드오프"를 1건씩 기록한다.

| # | 제목 | 결정 요약 | 상태 |
|---|---|---|---|
| [ADR-001](./ADR-001-build-tool.md) | 빌드 도구 선정 | electron-vite (개발/번들) | 제안 |
| [ADR-002](./ADR-002-state-management.md) | 상태관리 라이브러리 | Zustand + Immer (슬라이스 분할) | 제안 |
| [ADR-003](./ADR-003-ipc-contract-style.md) | IPC 계약 스타일 | 타입공유 RPC(invoke/handle) + 단방향 이벤트 스트림 | 제안 |
| [ADR-004](./ADR-004-list-virtualization.md) | 파일목록 가상화 방식 | 윈도잉(고정 행높이 details, grid는 그리드 윈도잉) + 스트리밍 증분 | 제안 |
| [ADR-005](./ADR-005-process-security-model.md) | 프로세스/보안 모델 | Main/Preload/Renderer 분리 + contextIsolation·sandbox + Worker | 제안 |
| [ADR-006](./ADR-006-packaging.md) | 패키징 | electron-builder (NSIS, Windows) | 제안 |
| [ADR-007](./ADR-007-remote-protocol-and-network-boundary.md) | 원격 프로토콜(FTP/SFTP)·네트워크 경계·외부 셸 연계(§M) | 원격=Main 스레드 `RemoteService`(ssh2-sftp-client/basic-ftp), 네트워크 경계 D5→D7 부분 개정·ESLint 화이트리스트(`src/main/remote/`만), 자격증명 safeStorage(DPAPI)·평문 금지, CF_HDROP/startDrag=Electron 내장. **ADR-005 부분 개정** | 제안 |

> 모든 ADR은 PRD/features/user-stories의 요구를 추적해 결정되었다. 추적 매핑은 [traceability.md](../traceability.md) 참조.
> **ADR-007은 ADR-005(프로세스/보안 모델)의 "네트워크 차단 기본·로컬 전용" 부분을 §M3(FTP/SFTP)에 한해 부분 개정한다**(삭제·대체 아님·비파괴). 상세는 ADR-007 결정 ①②.
