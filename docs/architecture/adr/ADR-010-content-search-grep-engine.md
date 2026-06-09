# ADR-010 — 내용 검색(grep) 엔진 (스트리밍 스캔·바이너리 판별·취소)

상태: 제안 · 2026-06-09
관련 기획: PRD §S(S1)·§6 MoSCoW·§6 Won't("내용 전문 인덱싱" 유지) · features §S1 · user-stories 에픽18(US-18.1) · flows F20~F33(S1)
관련 설계: [ADR-005 프로세스/보안 모델](./ADR-005-process-security-model.md)(Worker 모델 준수) · [ADR-003 IPC 계약 스타일](./ADR-003-ipc-contract-style.md) · `scanEngine.ts`/`ScanManager.ts`(워커·취소·진행률 선례) · [ADR-009 해시 엔진](./ADR-009-hash-and-compare-engine.md)(같은 워커/취소 패턴) · [system-architecture §5-S](../system-architecture.md)

> **이 ADR이 다루는 것**: §S1(현재 폴더 파일 **내부 텍스트** grep 검색)의 스트리밍 스캔·바이너리 자동 판별·파일 크기 상한·취소·결과 모델을 정의한다. **전 디스크 인덱싱은 PRD §6 Won't("내용 전문 인덱싱")로 유지** — 본 기능은 현재 폴더(+하위 토글) 온디맨드 grep만. 마일스톤 **M8**.

---

## 맥락

§S1은 현재 이름 필터(D1/D2)만 가능한 한계를 메워 **파일 내부 텍스트**를 검색한다(개발자·파워유저 핵심 가치·Should). features §S1 MVP 경계:

- **1차 포함**: 현재 폴더(+하위 토글) 텍스트/정규식 검색·바이너리 자동 제외·크기 상한·결과 목록(파일별 일치 줄·라인 번호·발췌·하이라이트)·미리보기 점프·진행률/취소·대량 결과 가상 스크롤.
- **1차 제외**: **전 디스크 풀텍스트 인덱싱(PRD Won't 유지)**·결과에서 직접 일괄 치환(편집)·인코딩 자동 감지 고급·원격(M3) 내용 검색.

제약(features §S1·PRD §7·ADR-005): grep은 워커/별도 처리·바이너리 제외·크기 상한·경로 검증·throw0/Result·IPC guard. 외부 네트워크 전송 없음.

핵심 결정: ① 검색 실행 모델(외부 ripgrep 바이너리 vs 내장 워커 스캔), ② 스트리밍 라인 스캔·정규식, ③ 바이너리 판별, ④ 크기 상한·취소, ⑤ 결과 모델·채널.

---

## 결정 ① — 실행 모델: 내장 Worker Threads 스트리밍 스캔 (외부 ripgrep 바이너리 비채택)

| 옵션 | 장점 | 단점 | 판정 |
|---|---|---|---|
| **내장 Worker Threads 스트리밍 스캔(채택)** | **외부 바이너리·spawn 없음(ADR-005 실행 표면 불변)**·번들/서명 영향 0·취소/진행률을 scanEngine 패턴으로 통일·바이너리 판별/크기 상한을 직접 통제 | 매우 큰 트리에선 ripgrep만큼 빠르진 않음(현재 폴더 범위라 충분) | **채택** |
| 외부 ripgrep 바이너리 번들 + spawn | 최고 속도·정규식 강력 | **외부 실행파일 번들·`child_process` spawn = ADR-005 "실행 표면 미추가" 위반**·플랫폼 바이너리 매트릭스·서명 부담·인자 주입 표면 | 비채택 |
| Renderer에서 직접 파일 읽기 | — | **ADR-005 위반**(렌더러 직접 FS 금지) | 비채택 |

- **근거**: §S1은 **현재 폴더(+하위) 온디맨드** 범위라 전 디스크 인덱서급 속도가 불필요하다. 외부 ripgrep은 ADR-005 실행 표면을 깨고 번들/서명/플랫폼 부담을 더한다. **내장 워커 스트리밍 스캔**이 보안·번들·일관성(scanEngine/hashEngine과 같은 취소/진행률 패턴)에서 우월하다.
- **scanEngine/hashEngine 패턴 차용**: 환경 비의존 엔진(`grepEngine`) + `GrepManager`(jobId·취소 플래그·200ms 스로틀·세션 격리) + `src/main/workers/`의 grep 워커. 순환·권한 격리도 scanEngine 원칙 재사용.

---

## 결정 ② — 스트리밍 라인 스캔 + 정규식 (전체 파일 메모리 적재 금지)

- **라인 스트리밍**: 파일을 read stream으로 흘리며 라인 경계로 분할·매칭한다(전체를 메모리에 올리지 않음·대용량 안전). 긴 줄(거대 1줄 파일)은 라인 길이 상한으로 잘라 폭주 방지.
- **검색어**: 문자열(부분 일치) 또는 **정규식 옵션**(features §S1). 정규식은 **사용자 입력 = 신뢰 못 함**으로 취급 — ReDoS(파국적 백트래킹) 완화를 위해 ① 컴파일 실패 안전 처리(throw0→ 오류 안내), ② 라인 단위 매칭(전체 버퍼 아님)으로 백트래킹 범위 제한, ③ 매칭 타임아웃/취소로 폭주 차단.
- **인코딩**: 1차는 UTF-8/ASCII 가정(BOM 처리). 고급 인코딩 자동 감지는 1차 제외(features §S1).
- **결과 발췌**: 일치 줄의 라인 번호 + 해당 줄 발췌(앞뒤 컨텍스트 컬럼 상한) + 일치 구간 오프셋(하이라이트용). 파일별 일치 수 상한·전체 결과 수 상한으로 대량 결과 메모리 통제(가상 스크롤이 표시 흡수).

---

## 결정 ③ — 바이너리 자동 판별 (확장자 + 내용 휴리스틱)

features §S1 "바이너리 파일 자동 제외"를 2단계로 구현:
1. **확장자 1차 필터**: 알려진 바이너리 확장자(`exe`·`dll`·`png`·`jpg`·`zip`·`pdf` 등 — 기존 `categorize.ts` 카테고리 활용)는 스캔 후보에서 제외.
2. **내용 휴리스틱(샘플링)**: 확장자로 불명확한 파일은 앞부분 N바이트(예: 8KB)를 읽어 **NUL 바이트 존재·비텍스트 바이트 비율**로 바이너리 판정 → 바이너리면 즉시 스킵(전체 안 읽음).
- 숨김/시스템 제외 토글(features §S1)도 적용.

---

## 결정 ④ — 파일 크기 상한 + 취소 (비차단)

- **크기 상한**: 설정값(기본 상한 — 예: 수십 MB) 초과 파일은 **스캔 건너뜀**(features §S1). 거대 파일이 grep을 막지 않게 한다(상한은 설정·런타임 튜닝).
- **취소**: scanEngine/hashEngine과 동일한 SharedArrayBuffer 취소 플래그(또는 협조적 `shouldCancel()`). 파일/라인 경계에서 즉시 중단·부분 결과 반환. 사용자가 다른 폴더로 이동하면 진행 잡 정리.
- **진행률**: 200ms 스로틀로 스캔 파일 수·일치 수·현재 경로 푸시(scanEngine 선례).
- **순환·권한**: scanEngine F장 원칙(심볼릭 미추종·realpath 방문 Set·readdir/lstat 실패 skip).

---

## 결정 ⑤ — 결과 모델 & 채널 (`search:content:*`)

scanEngine `analyze:scan:*`·hash `hash:*`와 동형의 스트림 채널. ADR-003 단일출처 규약(channels.ts·contracts.ts·Result·sender·zod·경로 화이트리스트). 동결 예외는 선례와 동일.

```text
search:content:start(req: {
    root: string; query: string; isRegex: boolean; recursive: boolean;
    includeHidden?: boolean; maxFileBytes?: number;
  }) -> Result<{ jobId }, FileOpError>
search:content:progress(evt: { jobId; scannedFiles; matchedFiles; currentPath })   # 푸시·200ms
search:content:match(evt: { jobId; file: string; lines: { lineNo; text; ranges: [start,end][] }[] })  # 파일 단위 증분 결과(가상 스크롤 적재)
search:content:done(evt: { jobId; totalMatches; truncated: boolean })
search:content:cancel(req: { jobId }) -> Result<void, FileOpError>
```
- **증분 결과 푸시**(`:match`)로 첫 결과를 빨리 보여주고(scanEngine 증분 정신), 렌더러는 결과 목록을 가상 스크롤로 흡수.
- **점프 연계**: 결과 클릭 → 해당 파일로 목록 점프 + 미리보기 패널(D3/J5) 해당 위치 스크롤. 미리보기는 기존 `preview:read` 재사용(신규 채널 0)·미리보기 안전 모델(CSP·DOMPurify·렌더러 직접 파일 접근 없음) 그대로.

---

## 근거 (종합)

- **보안·번들 우선**: 외부 ripgrep을 배제해 ADR-005 실행 표면을 불변으로 유지하고 번들/서명/플랫폼 매트릭스 영향 0.
- **기존 패턴 정합**: scanEngine/hashEngine과 동일한 환경 비의존 엔진·jobId·취소 플래그·200ms 스로틀·증분 푸시 → 학습 비용 0·헤드리스 verify 가능.
- **Won't 경계 준수**: 현재 폴더 온디맨드 grep만(전 디스크 인덱싱 미도입) → PRD §6 Won't "내용 전문 인덱싱" 정직 유지.
- **폭주 방어**: 바이너리 판별·크기 상한·라인 길이 상한·결과 수 상한·정규식 타임아웃으로 대용량/악성 입력에 안전.

## 트레이드오프

- **속도**: 내장 워커 스캔은 ripgrep보다 느릴 수 있으나 현재 폴더 범위라 실용 충분. 전 디스크 검색은 애초 범위 밖(Won't).
- **정규식 ReDoS**: 사용자 정규식 위험은 라인 단위 매칭·타임아웃·취소로 완화(완전 차단은 아님 — 1차 합리적).
- **인코딩**: 1차 UTF-8/ASCII 가정. 비UTF 인코딩은 후속.

## 결과

- 신규 Main 모듈 `src/main/search/`(`grepEngine.ts` 환경 비의존 코어·`binaryDetect.ts` 바이너리 휴리스틱·`GrepManager.ts` 오케스트레이터) + `src/main/workers/` grep 워커.
- 신규 IPC 채널군 `search:content:*`(start/progress/match/done/cancel).
- 신규 npm 의존성: **0**(Node 내장 스트림·정규식·`categorize.ts` 재사용).
- 신규 DTO: `GrepMatchDTO` 등(shared/dto).
- 미리보기 점프는 기존 `preview:read` 재사용(신규 채널 0).
- ADR-000-index에 ADR-010 등록. 마일스톤 **M8**.

---

## 미해결 질문 (설계 deferral)

| # | 질문 | 1차 결정 | 후속 트리거 | 비차단 |
|---|---|---|---|---|
| **UQ-S1** | 비UTF-8 인코딩 자동 감지 | 1차 **UTF-8/ASCII(BOM)** 가정 | EUC-KR 등 레거시 인코딩 수요 확인 시 인코딩 감지 라이브러리 도입 검토 | 비차단 — features §S1 1차 제외 |
| **UQ-S2** | 검색 결과 직접 일괄 치환(편집) | 1차 **제외**(읽기 전용 결과) | 코드 편집 워크플로 수요 시 별도 설계(쓰기·undo 연계) | 비차단 — features §S1 1차 제외 |
| **UQ-S3** | 크기 상한·라인/결과 상한 구체값 | 상한 존재(결정④). 정확값 런타임 튜닝 | 실측 후 확정 | 비차단 — 상한 메커니즘 1차 포함 |
