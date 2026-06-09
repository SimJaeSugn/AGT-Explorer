# ADR-008 — 압축파일 `archive://` 어댑터 · 압축 라이브러리 선정 · Zip Slip 차단

상태: 제안 · 2026-06-09
관련 기획: PRD §Q(Q1)·§6 MoSCoW(§P~§U) · features §Q1 · user-stories 에픽16(US-16.1) · flows F20~F33(Q1)
관련 설계: [ADR-005 프로세스/보안 모델](./ADR-005-process-security-model.md)(준수) · [ADR-007 원격 프로토콜·네트워크 경계](./ADR-007-remote-protocol-and-network-boundary.md)(RemoteAdapter 패턴 차용) · [ADR-003 IPC 계약 스타일](./ADR-003-ipc-contract-style.md) · [system-architecture §5-Q](../system-architecture.md) · [software-architecture §13](../software-architecture.md)

> **이 ADR이 다루는 것**: §Q1(압축파일을 폴더처럼 열기·추출·추가)을 어떤 추상화·라이브러리·보안 모델로 구현하는가. 기존 §M3 `RemoteService`(별도 경로 네임스페이스 + 공통 도메인 인터페이스) 패턴을 `archive://`로 재사용할 수 있는지 판정하고, 압축 라이브러리(읽기/쓰기)를 선정하며, **Zip Slip(경로 traversal) 차단**을 ADR-005 보안 안에서 정의한다. 마일스톤 **M9**.

---

## 맥락

§Q1은 zip 파일을 **별도 도구 없이 패널에서 폴더처럼 진입·탐색**하고, 내부 항목을 다른(로컬) 패널로 **추출**하거나 로컬 항목을 zip에 **추가**한다. 1차 범위는 features §Q1 MVP 경계로 좁혀진다:

- **1차 포함**: zip만 진입·탐색·추출(읽기), zip로의 항목 추가(쓰기).
- **1차 제외**: 암호 zip, zip 외 포맷(7z·rar·tar.gz), 압축 내부 직접 편집, 내부 이름변경/삭제, 중첩 압축(zip 안 zip) 재귀 진입, 원격(M3) 상 압축 진입.

핵심 쟁점:
1. 압축 내부를 패널에 표시하는 **추상화**를 §M3 원격처럼 별도 네임스페이스(`archive://`)로 둘 것인가, 로컬 FS에 투명 통합할 것인가.
2. **압축 라이브러리** 선정(읽기 스트리밍·쓰기·라이선스·네이티브 빌드·번들 영향).
3. 추출 시 **Zip Slip**(`../`·절대경로·드라이브 프리픽스 엔트리로 대상 폴더 밖에 쓰기)을 어떻게 차단하는가(ADR-005 경로 검증 연장).

---

## 결정 ① — 추상화: `archive://` 별도 경로 네임스페이스 + 공통 도메인 인터페이스 (RemoteAdapter 패턴 차용)

§M3가 확립한 **"별도 경로 네임스페이스 + 공통 도메인 인터페이스(추상화 공유·구현 분리)"**(software-architecture §11.1)를 그대로 재사용한다.

| 옵션 | 장점 | 단점 | 판정 |
|---|---|---|---|
| **별도 네임스페이스 `archive://` + 공통 인터페이스(채택)** | 패널은 경로 prefix(`archive://<zip절대경로>!/<내부경로>`)로 로컬/원격/압축을 구분 → UI·탐색·정렬·필터·가상 스크롤 코드 재사용. 압축 세션/추출 의미차를 어댑터 뒤로 격리. **§M3 라우팅 계층(`location.kind`)에 1종(`archive`) 추가만으로 흡수** | 라우팅 분기 1종·세션(열린 zip 핸들) 수명 관리 필요 | **채택** |
| 로컬 FS 투명 통합(임시폴더에 전체 추출 후 일반 폴더로 표시) | 호출부 무분기 | zip 전체 추출 비용(대용량)·임시폴더 정리·쓰기 동기화·"가상 경로" 누수. 큰 zip에서 비차단/진행률 깨짐 | 비채택 |
| 완전 분리(전용 압축 뷰어 UI) | 단순 | 멀티 디렉토리 차별점(압축↔로컬 나란히 D&D 추출)을 못 살림·UI 중복 | 비채택 |

- **도메인 추가**: §M3가 도입한 `Panel.location: LocalLocation | RemoteLocation`에 **`ArchiveLocation`을 추가**한다.
  `ArchiveLocation = { kind:'archive'; sessionId; archivePath: string; innerPath: string }`. 표기용 경로는 `archive://<archivePath>!/<innerPath>`(`!`로 zip 경계 구분 — 관례).
- **라우팅(`usecases/navigation`)**: `location.kind`로 분기 — `'local'`=`fs:list:*`, `'remote'`=`remote:list`, **`'archive'`=`archive:list`**. 원격 entries처럼 압축 entries도 `FileEntryDTO`로 정규화 → `FileListView`·`PanelHeader`·`SearchBar`는 거의 구분하지 않는다.
- **전송 라우팅(`domain/rules/transferRoute.ts` 확장)**: 출발·도착 `location.kind` 조합을 확장한다 — **archive→local=추출(`archive:extract`)**, **local→archive=추가(`archive:add`)**, archive↔archive·archive↔remote=1차 범위 밖. 이 순수 함수에 조합을 추가해 D&D·클립보드·키보드(추출/추가)가 동일 규칙을 공유한다.
- **세션 모델**: 열린 zip은 `ArchiveSessionManager`(Main)가 `sessionId`로 관리한다(§M3 `RemoteSessionManager` 형태 모방). 패널이 zip을 벗어나거나 닫으면 세션·임시 추출물 정리. **한 zip 안에서의 폴더 진입·뒤로/위로는 같은 sessionId·innerPath만 바뀐다**(재오픈 없음).

> **RemoteService와 ArchiveService의 관계**: 둘 다 "비로컬 파일 소스를 `FileEntryDTO`로 정규화해 제공하고, 전송은 OperationManager로 진행률을 흘린다"는 동일 골격을 갖지만 **인터페이스는 공유하지 않고 패턴만 차용**한다(원격=네트워크 세션/인증, 압축=파일 핸들/엔트리 테이블로 의미가 달라 강제 통합 시 누수). 상위 라우팅(`location.kind`)·전송 라우팅(`transferRoute`)·진행률(OperationManager)·UI는 공유한다.

---

## 결정 ② — 압축 라이브러리: 읽기=`yauzl`(스트리밍) · 쓰기=`yazl`(또는 `archiver`)

### 후보 비교

| 라이브러리 | 역할 | 라이선스 | 네이티브 빌드 | 스트리밍 | Zip Slip 안전 | 비고 |
|---|---|---|---|---|---|---|
| **yauzl** | zip **읽기** | MIT | 없음(순수 JS·zlib 내장) | **엔트리 단위 스트리밍**(전체 메모리 적재 안 함) | 라이브러리가 추출 경로를 만들지 않음 → **앱이 직접 검증**(우리 책임) | 대용량·비차단에 최적. 엔트리 메타(이름·크기·압축여부) 먼저 열거 가능 |
| **yazl** | zip **쓰기** | MIT | 없음(순수 JS) | 스트리밍 쓰기 | 우리가 엔트리명을 통제 | yauzl 자매 라이브러리. 추가(append)는 재작성 방식 |
| **adm-zip** | 읽기+쓰기 | MIT | 없음 | **전체 버퍼 메모리 적재**(스트리밍 약함) | 과거 Zip Slip CVE 이력·경로 처리 주의 | 단순 API지만 대용량에서 메모리 폭주·보안 이력 → 비채택 |
| **archiver** | 쓰기(다포맷) | MIT | 없음 | 스트리밍 쓰기 | — | zip/tar 생성에 강함. 쓰기 라이브러리 대안 |
| **node-7z + 7za** | 다포맷 | LGPL/외부 바이너리 | **외부 실행파일 번들** | — | 외부 프로세스 spawn | 7z/rar 지원이나 **외부 바이너리 spawn = ADR-005 실행 표면 확대**·번들/서명 부담 → 1차 비채택(zip만이므로 불요) |

### 결정

- **읽기: `yauzl`**(MIT·순수 JS·**엔트리 단위 스트리밍**). 근거: 대용량 zip을 전체 메모리에 올리지 않고 ① 엔트리 테이블을 빠르게 열거(목록·탐색용), ② 추출할 엔트리만 읽기 스트림으로 꺼낸다 → 비차단·진행률·취소(features §Q1)에 직접 부합. adm-zip의 "전체 버퍼 적재"는 1만+ 엔트리·대용량에서 부적합하고 과거 보안 이력이 있어 배제.
- **쓰기(추가): `yazl`**(MIT·순수 JS·yauzl 자매). zip는 포맷 특성상 **항목 추가 = 기존 엔트리 + 신규 엔트리를 새 zip으로 재작성**(in-place append 미지원). 1차는 "원본 zip을 새 임시 zip으로 재작성 후 원자적 rename"으로 안전하게 처리(부분 실패 시 원본 보존). `archiver`도 동급 대안이나 yauzl과 짝을 이루는 `yazl`이 일관성·의존성 면에서 우선.
- **네이티브 빌드 0**: 두 라이브러리 모두 순수 JS(zlib는 Node 내장) → **코드서명·패키징·플랫폼 매트릭스 영향 0**(§M3 basic-ftp와 동일 정신).
- **외부 바이너리 금지**: 7z·rar 지원을 위한 외부 실행파일 spawn은 **ADR-005 "실행 표면 미추가" 위반**이라 1차 비채택. zip 외 포맷은 features §Q1 MVP 경계대로 1차 제외(후속 검토 시 별도 ADR).
- **암호 zip 1차 제외**: 암호 엔트리를 만나면 라이브러리 신호로 감지해 "지원하지 않음(암호 보호)" 안내(빈 화면·크래시 없음·features §Q1 수용기준). 복호화 미구현.

> **미해결(사용자 결정 필요)**: 압축 라이브러리 최종 픽스는 본 ADR이 **yauzl(읽기)+yazl(쓰기)**를 권고안으로 확정하되, 팀이 `adm-zip` 단순성을 우선하거나 향후 7z 필요 시 재평가할 수 있게 미해결 질문 UQ-Q1로 남긴다(아래).

---

## 결정 ③ — 프로세스 배치 & 진행률 (Main 스레드 + Worker 오프로딩 + OperationManager 재사용)

| 작업 | 실행 위치 | 근거 |
|---|---|---|
| 엔트리 **열거**(목록·탐색) | **Main 스레드**(yauzl로 central directory 읽기·CPU 가벼움) | 목록은 메타만·빠름. `archive:list`는 요청-응답(스트림 불요·1차 엔트리 수 상한) |
| **추출**(archive→local) | **Worker Thread**(압축 해제=CPU(inflate)+I/O) | 대용량 비차단·취소. 기존 `OperationManager`+워커 모델 재사용(`op:*` 진행률 스트림) |
| **추가**(local→archive·재작성) | **Worker Thread**(deflate + 재작성) | 동상 — 비차단·진행률·취소 |

- **진행률·취소·충돌**: 추출/추가는 신규 진행률 채널을 만들지 않고 **기존 `op:*` 스트림**(`op:progress`/`op:conflict`/`op:resolve`/`op:done`/`op:cancel`)을 재사용한다(§M3 `remote:download/upload`가 operationId만 반환하고 op:* 스트림을 재사용한 선례와 동일). `archive:extract`/`archive:add`는 `operationId`만 반환.
- **충돌**: 추출 시 로컬 도착지 동명 충돌은 **기존 D4 ConflictDialog 경로 그대로**(덮어쓰기/건너뛰기/둘다유지/병합/모두적용).

---

## 결정 ④ — Zip Slip(경로 traversal) 차단 (ADR-005 경로 검증 연장 · 필수 수용 기준)

압축 엔트리명은 **악의적일 수 있는 외부 입력**으로 취급한다(§M3 결정⑥ "원격 응답=불신"과 동일 정신). 추출 시 다음을 강제한다:

1. **정규화 후 경계 검증**: 각 엔트리의 도착 경로 = `path.win32.resolve(destDir, normalize(entryName))`. 이 결과가 **`destDir`의 하위(prefix 일치 + 경로 구분자 경계)** 가 아니면 **거부**(추출 안 함·실패 항목 보고). `../`·`..\\`·절대경로(`/etc/...`)·드라이브 프리픽스(`C:\\...`)·UNC(`\\\\...`)로 destDir를 탈출하는 엔트리를 모두 차단.
2. **드라이브/루트 프리픽스 제거**: 엔트리명이 절대경로/드라이브를 포함하면 루트 기준을 떼고 상대화한 뒤 1을 재적용(또는 거부) — 절대경로 엔트리가 시스템 경로에 쓰이지 못하게 한다.
3. **심볼릭링크 엔트리**: zip이 심볼릭링크 엔트리를 포함하면 **추출 시 추종/생성하지 않는다**(링크를 통한 destDir 탈출 차단). 1차는 링크 엔트리 건너뜀(실패 목록 보고).
4. **파일명 새니타이즈**: 엔트리명에 로컬 금지문자(`< > : " | ? *`)·예약명(CON/PRN…)·널바이트가 있으면 안전 치환/거부(로컬 FS 손상 방지·§M3 결정⑥-3과 동일).
5. **엔트리 수·총 크기 상한(zip bomb 완화)**: 엔트리 수·압축 해제 총 바이트에 상한을 두고 초과 시 중단·안내(과도한 압축비 폭탄 방어). 정확한 임계는 구현·런타임 튜닝.
6. **임시 추출 안전**: `.part` 임시명으로 추출 후 완료 시 원자적 rename(§M3 결정⑥-7 부분 전송 안전과 동일)·실패 시 정리.

> Zip Slip은 본 기능의 **유일한 신규 보안 임계 표면**이므로, 경계 검증 로직을 `domain/rules/archiveSafePath.ts`(순수 함수) + Main 추출 워커 양쪽에 두고 **헤드리스 verify로 "탈출 엔트리 거부" 불변식을 증명**(`../`·절대·드라이브·UNC·심볼릭 케이스)할 것을 강력 권고한다(§M3 traversal verify 선례).

---

## 결정 ⑤ — 신규 IPC 채널 (`archive:*`)

ADR-003 단일출처 규약(`shared/ipc` 채널상수+계약타입, invoke/이벤트, Result, sender·zod 검증)으로 추가. **동결 원칙 예외**(P1 채널 동결 이후 Should 신기능 신규채널)는 기존 선례(`preview:read`·`fs:watch:*`·`trash:*`·`analyze:scan:*`·`remote:*`)와 **동일 규약**이다.

```text
archive:open(req: { archivePath: string })
  -> Result<{ sessionId: string }, FileOpError>     # zip central directory 열기·세션 발급. 암호 zip이면 EUNSUPPORTED(암호) 안내
archive:list(req: { sessionId; innerPath: string })
  -> Result<{ entries: FileEntryDTO[] }, FileOpError>  # innerPath 디렉토리의 직속 엔트리(정규화 FileEntryDTO)
archive:close(req: { sessionId }) -> Result<void, FileOpError>   # 세션·임시물 정리(패널 이탈/탭 닫기)
archive:extract(req: { sessionId; innerPaths: string[]; destDir: string; conflictPolicy? })
  -> Result<{ operationId: string }, FileOpError>   # archive→local. op:* 스트림 재사용·Zip Slip 차단
archive:add(req: { sessionId; localPaths: string[]; innerDir: string; conflictPolicy? })
  -> Result<{ operationId: string }, FileOpError>   # local→archive(재작성). op:* 스트림 재사용
```
- 전송 진행률·충돌·완료·취소는 **신규 채널 없이 기존 `op:*` 재사용**(extract/add는 operationId만 반환).
- 모든 경로는 §3.3 보안 규칙(정규화·존재·권한·로컬 한정)으로 검증. 원격(`sftp://`·`ftp://`) archivePath·destDir는 거부(1차 로컬만).

---

## 근거 (종합)

- **기존 패턴 재사용으로 비용 통제**: §M3가 깐 `location.kind` 라우팅·`transferRoute` 순수 함수·OperationManager 진행률·UI 정규화를 그대로 활용 → 압축은 "어댑터 1종 + 라우팅 분기 1종 + 보안 함수 1개" 추가로 수렴.
- **신규 네이티브 의존 0·실행 표면 0**: yauzl/yazl 순수 JS·zlib 내장. 외부 바이너리(7z) 배제로 ADR-005 실행 표면 불변.
- **보안 우선**: Zip Slip을 순수 함수로 격리·헤드리스 검증 가능하게 설계(M3 traversal 선례).
- **단순성**: 1차 zip만·암호 제외·재작성식 추가로 범위를 좁혀 과설계 회피(features §Q1 MVP 경계 그대로).

## 트레이드오프

- **zip만**: 7z/rar 미지원(외부 바이너리 회피 대가). 후속 수요 시 별도 ADR.
- **추가=재작성**: 큰 zip에 작은 파일 1개 추가도 전체 재작성(in-place append 미지원). 1차 빈도·안전(원자 rename) 우선. 후속에 증분 추가 검토.
- **읽기/쓰기 라이브러리 2개(yauzl+yazl)**: 단일 adm-zip 대비 의존 2개지만 스트리밍·메모리·보안 이력 면에서 우위.

## 결과

- 신규 도메인 `ArchiveLocation`(entities 확장)·`domain/rules/archiveSafePath.ts`(Zip Slip 순수 함수)·`transferRoute.ts`에 archive 조합 추가.
- 신규 Main 디렉토리 `src/main/archive/`(`ArchiveService.ts`·`ZipReader.ts`(yauzl)·`ZipWriter.ts`(yazl)·`ArchiveSessionManager.ts`·추출/추가 워커 연동).
- 신규 IPC 채널군 `archive:*`(open/list/close/extract/add) + `op:*` 재사용.
- 신규 npm 의존성: `yauzl`(MIT)·`yazl`(MIT). 네이티브 빌드 0.
- ADR-000-index에 ADR-008 등록. 마일스톤 **M9**(안정화 후·압축 라이브러리·Zip Slip 설계가 무거움).

---

## 미해결 질문 (설계 deferral)

| # | 질문 | 1차 결정 | 후속 트리거 | 비차단 |
|---|---|---|---|---|
| **UQ-Q1** | 압축 라이브러리 최종 선정(yauzl+yazl vs adm-zip 단순성) | **yauzl(읽기)+yazl(쓰기) 권고** — 스트리밍·메모리·보안 이력 우위 | 팀이 단순 API(adm-zip)를 강하게 선호하거나 PoC에서 yazl 재작성 비용이 문제될 때 재평가 | 비차단 — 본 ADR 권고로 착수 가능 |
| **UQ-Q2** | zip 외 포맷(7z·rar·tar.gz) | 1차 **zip만**(외부 바이너리 회피) | 사용자 수요 확인 시 → 순수 JS tar/gz는 추가 검토, 7z/rar는 외부 바이너리 spawn 보안 재설계(ADR-005 영향) 동반 별도 ADR | 비차단 — features §Q1 MVP 경계 |
| **UQ-Q3** | zip bomb 임계(엔트리 수·총 해제 바이트·압축비) 구체값 | 상한 존재·초과 중단(결정④-5). 정확값은 런타임 튜닝 | 실측·악성 샘플 테스트 후 확정 | 비차단 — 상한 메커니즘은 1차 포함 |
| **UQ-Q4** | 중첩 압축(zip 안 zip) 재귀 진입 | 1차 제외(features §Q1). 내부 zip은 일반 파일로 표시 | 수요 시 재귀 세션 모델 설계 | 비차단 |
