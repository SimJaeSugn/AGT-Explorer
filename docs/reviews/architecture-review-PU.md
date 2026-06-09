# 아키텍처 설계 검증 — 파워 기능 14종(§P~§U) / ADR-008~012

> 검증: 독립 Reviewer · 2026-06-09 · 대상: chief-architect 산출물(ADR-008~012·system/software/directory/traceability 갱신)
> 기준 문서: PRD §P~§U·§6·§12 / features §P1~§U3 / user-stories US-15.1~US-20.3 / flows F20~F33
> 범위: 문서·설계 정합·근거·추적성·보안만(코드 동작 검증 제외)

## 판정: **FAIL** (반영 항목 2건 — 1건 중대[문서 모순], 1건 경미[ADR 내부 모순]. 둘 다 텍스트 정정으로 해소, 설계 골격은 건전)

## 요약
14개 기획 기능(US-15.1~US-20.3)이 ADR-008~012·시스템/소프트웨어/디렉토리/traceability에 **빠짐없이·유령 없이** 추적 반영됐고, 보안(Zip Slip·로컬 한정·외부 바이너리 비채택·throw0/Result·guard)·IPC 규약·모듈 배치·의존성 범위(yauzl/yazl만)는 모두 타당하다. 다만 **S1 grep의 마일스톤이 PRD §12(M7)와 설계(ADR-010/traceability/system = M8) 사이에서 충돌**하고(중대), **ADR-009 결정① 제목이 자신의 결정 본문과 모순**(경미)이다. 두 건 모두 정정하면 PASS 수준.

---

## 반영 항목

### [중대-1] S1 내용 검색(grep) 마일스톤 — PRD §12(M7) ↔ 설계(M8) 충돌
- **무엇**: S1(grep)의 단계 배정이 기준 문서와 설계 산출물에서 서로 다르다.
- **위치**:
  - PRD §12 `docs/PRD.md:451` — M7 묶음에 "**S1 내용 검색(grep)**"을 명시 포함.
  - ADR-010 `docs/architecture/adr/ADR-010-content-search-grep-engine.md:7,103` — "마일스톤 **M8**".
  - traceability `docs/architecture/traceability.md:215` — S1 행 마일스톤 칸 "**M8**", §224 의존성 서술도 "M8(…S1…)".
  - system-architecture `docs/architecture/system-architecture.md:513` — S1 근거 ADR-010(M8 함의).
  - ADR-000-index `ADR-000-index.md:17` — grep(ADR-010)=M8(본문 참조).
- **왜 문제**: 기획의 마일스톤 표(PRD §12)와 설계 4문서가 같은 기능을 다른 단계에 둔다. team-dev가 M7/M8 중 어디서 S1을 착수할지 결정 못 하고, doc-sync가 어느 쪽을 단일 출처로 삼아야 할지 모호해진다. PRD §12 머리말/말미(`PRD.md:446,455`)는 "실제 묶음·순서는 chief-architect 설계에서 확정"이라고 설계에 권위를 위임했으므로 **설계의 M8이 의도된 최종값으로 보이나, PRD §12 표가 갱신되지 않았고 변경 사유 주석도 없다**. 추적성 무결성 위반(같은 기능이 두 단계).
- **권고**(둘 중 택1, 설계 의도가 M8이면 ①):
  1. PRD §12 표(`PRD.md:451`)의 M7 묶음에서 **S1을 빼서 M8로 이동**하고(M8 묶음 `PRD.md:452`에 추가), "S1은 R3 전송 큐(M7)·grep 워커 인프라가 깔린 뒤 M8에서 착수 — chief-architect 재배치"라는 1줄 변경 주석을 단다. 동시에 traceability §224 의존성 서술의 "S1 진행률은 M7 전송 큐와 정합"은 "M8 grep이 M7 큐를 재사용"으로 표현을 일관화.
  2. (M7 유지가 의도라면) ADR-010·traceability §1-P~U(S1 행+§224)·system §5-PU의 S1 마일스톤을 **M8→M7**로 정정.
- **비고**: ADR-010 §224는 "S1 진행률은 M7 전송 큐(ADR-011)와 정합"이라 적어 M7 인프라 의존을 인정하면서도 단계는 M8에 둔다 — 이는 "인프라는 M7, 기능 착수는 M8"로 모순이 아니지만, PRD §12 표가 S1을 M7 묶음 안에 넣은 것과는 명백히 어긋난다. 단일 출처(PRD §12 vs 설계)를 일치시켜야 한다.

### [경미-2] ADR-009 결정① 제목이 자신의 결정 본문·인덱스·결과와 모순
- **무엇**: ADR-009 결정① 제목은 "BLAKE3 또는 xxHash **우선**, 폴백 SHA-256"이라 적었으나, 같은 결정의 비교 표·결정 본문·근거·결과·인덱스·system §5-PU는 모두 **SHA-256을 1차 기본값**으로, BLAKE3/xxHash를 "측정 후 조건부 후속 옵션"으로 확정한다.
- **위치**:
  - `docs/architecture/adr/ADR-009-hash-and-compare-engine.md:29` — 제목: "비암호용 고속 해시(BLAKE3 또는 xxHash) **우선**, 폴백 Node 내장 SHA-256".
  - 같은 파일 `:35`(표) "SHA-256 = **1차 기본값(안전 폴백)**", `:41` "**1차 기본: Node 내장 crypto SHA-256**", `:45`·`:104`·`:119`(근거/결과 "1차 Node 내장 SHA-256·의존 0"), `:129`(UQ-H1 "1차 SHA-256").
  - 상충 없는 다른 문서: `ADR-000-index.md:16`(SHA-256)·system `:507,510,512`(Worker 해시, SHA-256 함의)·traceability(SHA-256 기재) — 즉 제목만 어긋난다.
- **왜 문제**: ADR 제목은 결정의 요지를 한 줄로 표상하는데, 본문 결정(SHA-256 1차)과 정반대("고속 해시 우선")로 읽혀 구현자가 1차에 BLAKE3/xxHash wasm 의존을 도입(의존성·과설계)할 오독 위험. "의존 0·고속화는 측정 후 조건부"라는 본 ADR의 핵심 트레이드오프와 충돌.
- **권고**: `ADR-009-hash-and-compare-engine.md:29` 제목을 본문에 맞춰 정정 — 예: "결정 ① — 해시 알고리즘: **1차 Node 내장 SHA-256(의존 0)**, 고속화(xxHash/BLAKE3 wasm)는 측정 후 조건부 옵션". (본문은 이미 올바르므로 제목 한 줄만 수정.)

---

## 체크리스트 점검 결과 (PASS 항목 — 근거)

1. **추적성** — PASS. US-15.1~US-20.3 전 14건이 features §P1~§U3(`features.md:1097~1433`)·user-stories(`:561~789`)·flows F20~F33(22개 매치)·traceability §1-P~U 표(`traceability.md:209~222`, 14행)·system §5-PU.0(`:507~520`, 14행)·software §13/§14·directory §8에 일관 매핑. **유령 매핑 없음**: §1-P~U는 스스로 "유일하게 실재 코드를 가리키지 않는 설계(예정) 매핑"이라 정직하게 명시(`traceability.md:205,224`)하고 ADR/모듈은 신설 예정물로 구분. **누락 없음**: filter 합성 AND/OR "설계 인계분"(features `:1133,1344,1383`)도 ADR-012 결정②로 회수.

2. **ADR 타당성** — PASS(경미-2 제외). ① archive 라이브러리: yauzl/yazl vs adm-zip(전체버퍼·CVE 이력) vs node-7z(외부 바이너리) 비교표·선정 근거·스트리밍/메모리/보안 트레이드오프 명시(ADR-008 결정②). ② 해시 공용화: P1·R2·R4의 "내용 해시로 동일성 판정" 공통점→단일 엔진(DRY·드리프트 방지) 근거 타당(ADR-009 맥락·근거). ③ grep: 외부 ripgrep vs 내장 워커 비교, 인덱싱 Won't 유지 명시(ADR-010 결정①·근거). ④ 전송 큐: op:* 전면교체/병존/승격 3안 비교, "operationId 재사용·채널 의미 불변" 비파괴 확장 채택(ADR-011 결정①). ⑤ 태그/프리셋 영속·합성: J7/O1 세션 메타 패턴 재사용(신규 채널 0)·**합성=차원 간 AND·차원 내 OR 확정**(ADR-012 결정①②)으로 인계 미해결 종결. 각 ADR에 대안표·근거·트레이드오프·미해결(deferral)·마일스톤 구비.

3. **보안 정합(ADR-005/007)** — PASS. 렌더러 직접 FS/네트워크 금지·Main/Worker 경유(system §5-PU.0·software §13)·경로 §3.3 검증·로컬 한정(system §5-PU.3-12)·**Zip Slip 차단**(ADR-008 결정④ 6항: 경계검증/드라이브·UNC 제거/심볼릭 미추종/새니타이즈/zip bomb 상한/원자 rename + `archiveSafePath.ts` 순수+워커 양쪽·헤드리스 verify 권고)·grep 바이너리/크기/라인/결과 상한·ReDoS 완화(ADR-010 결정②③④·system §5-PU.3-13)·sender/zod/화이트리스트/throw0·Result(system §5-PU.3-15) 반영. **새 외부 네트워크/실행 표면 0**(압축=로컬 yauzl/yazl·grep=로컬 워커·해시=로컬·외부 7z/ripgrep 바이너리 비채택, ADR-008 결정②·ADR-010 결정①·system §5-PU.3-12). ESLint 경계: archive/hash/search는 일반 main 규칙, 네트워크 화이트리스트는 `src/main/remote/`만 유지(directory §8 `:341`).

4. **IPC 채널 규약** — PASS. archive:*·hash:*·search:content:*·queue:*가 기존 `preview:read`·`fs:watch:*`·`trash:*`·`analyze:scan:*`·`remote:*` 동결 예외 선례와 동일 규약(channels.ts 상수·contracts.ts·invoke/이벤트·Result·sender·zod·화이트리스트)으로 정의(system §5-PU.1·각 ADR 결정⑤/④). 채널 0 기능(R1·S2·T1·T2·T3·U1·U2·U3) 타당: R1=fs:rename 반복+K1 undo, S2=commandBus, T1/T3=세션 스냅샷 메타, T2=analyze:scan:* 재사용, U1=preview:read, U2=fs:tree-children, U3=세션 메타+BrowserWindow(채널 아님) — 모두 기존 채널/렌더러로 실현 가능함이 SW §14에 모듈 단위로 입증.

5. **디렉토리/모듈 구조** — PASS. `src/main/{archive,hash,search}/`·`workers/`(확장)·`ipc/{archive,hash,search,queue}.handlers.ts`·`domain/rules/{archiveSafePath,compare,filterComposition,tags,batchRename,paletteMatch}.ts`·`app/stores`·`ui/{compare,dedup,queue,search,tags,preset,quicklook,palette,rename}`(directory §8 `:262~341`)가 ADR-002 store 분할·§3.1 계층 import 규칙(도메인 순수·react/infra/shared-ipc 금지)과 정합. 도메인 순수 규칙 6종 헤드리스 verify 대상으로 격리.

6. **마일스톤 의존성** — PASS(중대-1 제외). M6(P1메타·R1·T3)→M7(공용 해시 워커·전송 큐·grep 패턴: R2·R3·R4·P1해시옵션 연결)→M8(경량 메타/표시)→M9(Q1 archive·U3 멀티윈도우)의 의존 순서가 ADR-009(M6→M7 해시)·ADR-011(M7 큐)·ADR-008(M9)·traceability §224·PRD §12와 정합하며 실행 가능. "P1 해시옵션·R2·R4는 M7 해시 엔진 선행 필수" 등 선후 의존 명시. **단, S1 단계만 PRD §12(M7)와 설계(M8) 불일치 → 중대-1.**

7. **기존 보존·번호 연속** — PASS. ADR-002~007 전부 보존(파일·제목 확인). 신규 ADR-008~012 번호 연속·ADR-000-index 등록(`:15~19`). system §5-PU(§5-M 다음)·software §13/§14(§12 다음)·directory §8(§7 다음)·traceability §1-P~U(§1-O 다음)로 번호 연속. **주의(비차단)**: software-architecture §10(미해결 질문)이 §14 뒤(`:513`)에 위치 — 이는 §M(§11)·§N(§12) 추가 시점부터의 기존 구조(§9→§11→§12→§13→§14→§10)로, 이번 변경이 새로 만든 결함은 아님. 다만 가독성상 §10을 §15로 재번호하거나 말미 유지 의도를 1줄 명기하면 깔끔(선택).

8. **실행 가능성** — PASS. 신규 의존성은 yauzl(MIT)+yazl(MIT)만, 네이티브 빌드 0(directory §8 `:339`). 해시(Node 내장 SHA-256)·grep(Node 내장 스트림/정규식)·큐·태그/프리셋은 의존성 0. 빠뜨린 핵심 결정 없음 — 세션 수명(ArchiveSessionManager)·추가=재작성+원자 rename·동시성/일시정지(SharedArrayBuffer+stream pause)·증분 결과 푸시·고아 메타 GC 등 핵심 결정 모두 포함. 미해결은 전부 비차단 deferral로 분류(UQ-Q1~Q4·H1~H3·S1~S3·R1~R3·T1~T3).

---

## 경미·관찰(비차단 — 정정 권장이나 착수 무방)
- **채널 보유 기능 수 표기**: traceability §224·system §5-PU.0(`:522`)이 "신규 채널 5개(P1·Q1·R2/R4·R3·S1)"로 적으나, 실제로 신규 채널을 갖는 **기능은 6개**(P1·Q1·R2·R3·R4·S1; R2/R4가 hash:* 네임스페이스를 공유할 뿐). 같은 문장이 이어서 6개를 모두 열거하므로 의미 충돌은 아니나 "5개"→"6개(채널 네임스페이스 기준 5종)"로 다듬으면 혼선 0.
- ADR-009 §95(R4 복사+검증 단일 작업 묶기)는 ADR-011 통합으로 deferral(UQ-H2) — 명시돼 있어 OK.

## 확인 필요(사용자/PM 판단)
- **중대-1의 해소 방향**: S1을 **M8로 확정(설계 의도)**하고 PRD §12를 정정할지, 아니면 **M7로 되돌릴지**는 우선순위/릴리스 묶음 판단이라 PM 결정이 필요할 수 있다(기본 권고는 설계대로 M8 — PRD §12가 chief-architect에 묶음 확정 권위를 위임했으므로).
- (참고) ADR-008 UQ-Q1(yauzl+yazl vs adm-zip 최종 픽스)·U3 멀티 윈도우 범위는 ADR/SW에 미해결로 정직 표기됨 — 비차단이나 구현 착수 전 PM 인지 권장.
