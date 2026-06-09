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
| [ADR-008](./ADR-008-archive-namespace-adapter.md) | 압축 `archive://` 어댑터(§Q1) | `archive://` 별도 네임스페이스 + 공통 도메인 인터페이스(M3 RemoteAdapter 패턴 차용)·읽기 `yauzl`/쓰기 `yazl`(순수 JS·네이티브 0)·외부 7z 바이너리 비채택·**Zip Slip 차단**·추출/추가 Worker+op:* 재사용·암호 zip 1차 제외 | 제안 |
| [ADR-009](./ADR-009-hash-and-compare-engine.md) | 공용 해시·비교 엔진(§P1·§R2·§R4) | 단일 해시 엔진 공유(폴더 비교 해시 옵션·중복 찾기·체크섬)·알고리즘 Node 내장 SHA-256(의존 0·고속화는 측정 후 조건부)·Worker Threads(scanEngine 패턴)·스트리밍·메타/크기 선필터·`hash:*` 채널 | 제안 |
| [ADR-010](./ADR-010-content-search-grep-engine.md) | 내용 검색 grep 엔진(§S1) | 내장 Worker 스트리밍 스캔(외부 ripgrep 바이너리 비채택)·바이너리 휴리스틱 제외·크기/라인/결과 상한·정규식 ReDoS 완화·취소·`search:content:*` 채널·전 디스크 인덱싱 Won't 유지 | 제안 |
| [ADR-011](./ADR-011-transfer-queue.md) | 전송 큐 아키텍처(§R3) | `OperationManager`를 큐 스케줄러로 승격(op:* 비파괴 확장·operationId 재사용)·일시정지(SharedArrayBuffer/stream pause)·동시성·재시도·`queue:*` 최소 추가(전송 자체는 op:* 재사용) | 제안 |
| [ADR-012](./ADR-012-metadata-persistence-and-filter-composition.md) | 태그/메타 영속·~~프리셋·필터 합성~~(§T1·~~§T3·§P1~~) | 태그=세션 스냅샷 메타 확장(J7/O1 패턴·신규 채널 0)·데이터 비파괴(파일/ADS 미변경). ~~프리셋·복수 필터 합성(AND/OR·`filterComposition.ts`)~~ **부분은 2026-06-09 사용자 결정으로 폐기·코드 제거(T3 폐기)**·태그(T1) 영속 부분만 유효 | 제안(부분 폐기 — T3 프리셋/필터합성 폐기·T1 태그 유효) |

> 모든 ADR은 PRD/features/user-stories의 요구를 추적해 결정되었다. 추적 매핑은 [traceability.md](../traceability.md) 참조.
> **ADR-007은 ADR-005(프로세스/보안 모델)의 "네트워크 차단 기본·로컬 전용" 부분을 §M3(FTP/SFTP)에 한해 부분 개정한다**(삭제·대체 아님·비파괴). 상세는 ADR-007 결정 ①②.
> **ADR-008~012(2026-06-09 §P~§U 파워 기능 14종)** 는 기존 ADR/설계를 보존·승계하며 신규만 추가한다. archive(ADR-008)·해시(ADR-009)·grep(ADR-010)·전송 큐(ADR-011)는 ADR-005 프로세스/보안(렌더러 직접 FS/네트워크 금지·경로 검증·Zip Slip 차단)·ADR-003 throw0/Result·IPC guard를 전면 준수하고, **외부로 나가는 신규 네트워크/실행은 없다**(압축·grep·해시 전부 로컬). 경량 기능(⑥명령팔레트·⑧폴더용량·⑩퀵룩·⑪브레드크럼·⑫탭색상/잠금/분리)은 ADR 없이 software-architecture §14에 모듈 설계로 둔다.
