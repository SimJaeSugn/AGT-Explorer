# ADR-012 — 태그/메타 영속 · 정렬/필터 프리셋 · 복수 필터 합성 규칙

> **상태 주석(2026-06-09 사용자 결정):** **T3 정렬/필터 프리셋 및 filterComposition(복수 필터 합성 AND/OR) 부분은 폐기(코드 제거)됨.** M6에서 구현 완료(코드)됐던 프리셋(`presetsSlice`·`usecases/presets`·`ui/preset/*`·`FilterPreset` DTO)과 합성 순수함수(`domain/rules/filterComposition.ts`)가 2026-06-09 사용자 결정으로 전면 제거되고 `selectors.computeVisible`이 기존 `filterEntries`(이름 필터)로 환원됐다(`SESSION_SCHEMA_VERSION` 2→1 환원). 따라서 **결정②(복수 필터 합성)·결정③의 프리셋 영속 부분·"결과"의 `filterPresets`/`filterComposition.ts`/`PresetSort`/`PresetFilter` 항목은 무효(폐기)** 다. **반면 결정①·결정③의 태그(T1) per-경로 메타 영속 결정(`tagsByPath`·`coerceTagsByPath`·J7/O1 패턴)·결정④(T2 scanEngine 재사용)는 M8 T1·T2용으로 여전히 유효**하다. 단, T1 합성 규칙(태그 필터 AND/OR)은 `filterComposition.ts`가 폐기됐으므로 T1 구현 시 재설계가 필요하다. 본문 결정은 이력으로 보존하며 본 주석이 상태를 정정한다.

상태: 제안(부분 폐기 — T3 프리셋·필터합성 부분 2026-06-09 폐기 / 태그 T1 부분 유효) · 2026-06-09
관련 기획: PRD §T(T1·T3)·§P(P1 "차이만 보기" 합성 미해결)·§6 MoSCoW · features §T1·§T3·§P1 · user-stories 에픽19(US-19.1·US-19.3)·에픽15(US-15.1) · flows F20~F33
관련 설계: [ADR-002 상태관리(Zustand·세션 영속)](./ADR-002-state-management.md) · `SidebarSnapshot`(J7 `favoriteLabels`·O1 `pinnedByDir` per-위치 메타 선례) · [system-architecture §5(세션 영속)·§5-T](../system-architecture.md) · [software-architecture §14](../software-architecture.md)

> **이 ADR이 다루는 것**: ① §T1 파일 태그/색상 라벨의 **per-경로/전역 메타 스키마와 세션 영속**(기존 `favoriteLabels`/`pinnedByDir` 패턴 확장), ② §T3 정렬/필터 프리셋의 영속, ③ [반영-3 설계 인계분] **복수 필터 합성 규칙(AND/OR)** — 기존 검색/필터(D1·D2)·"차이만 보기"(P1)·태그 필터(T1)·프리셋 필터(T3)가 동시 적용될 때의 결합 규칙을 확정한다. features §P1·§T1·§T3 수용기준이 "chief-architect 설계에서 확정"으로 인계한 항목이다. 마일스톤 **M6(T3)** · **M8(T1)**.

---

## 맥락

세 가지 메타/표시 요구가 기존 세션 영속·필터 파이프라인을 확장한다:

- **T1 태그/색상 라벨(Should)**: 항목에 고정 팔레트 색 라벨을 부여(다중 허용 여부 설계)·표시·필터. **앱 내부 메타**(파일 자체·NTFS ADS 미변경·데이터 비파괴). per-경로 세션 영속.
- **T3 정렬/필터 프리셋(Should)**: 현재 정렬(기준·방향·폴더 우선)+필터(검색어·확장자 패턴·태그 필터) 조합을 이름 붙여 저장·적용·이름변경/삭제. 전역 프리셋. 세션 영속.
- **필터 합성(설계 인계)**: features §P1·§T1·§T3 수용기준이 공통으로 남긴 미해결 — "차이만 보기(P1)·이름/확장자 필터(D1/D2)·태그 필터(T1)·프리셋(T3)이 **동시 적용될 때 AND/OR 합성 규칙**을 chief-architect가 확정"한다.

기존 자산(재사용):
- `SidebarSnapshot`은 이미 **per-위치 메타 2종**을 영속한다 — `favoriteLabels`(J7 별칭·경로→문자열 맵), `pinnedByDir`(O1 고정·dirPath→항목경로[]). `persistence/defaults.ts`의 `coerce*`가 손상 입력을 안전 복원하고, `session.ts`가 직렬화한다. **T1/T3는 이 패턴을 그대로 확장**하면 신규 채널·신규 영속 파일 없이 완결된다.
- 필터는 `domain/rules/filter.ts`(순수)·`panelsSlice.filter`·`selectors.ts#computeVisible`(파생 메모이즈)로 흐른다.

---

## 결정 ① — 태그(T1)·프리셋(T3)은 세션 스냅샷의 신규 per-위치/전역 메타 필드 (신규 채널 0)

| 옵션 | 장점 | 단점 | 판정 |
|---|---|---|---|
| **`SessionSnapshot`/`SidebarSnapshot` 메타 필드 확장(채택)** | J7 `favoriteLabels`·O1 `pinnedByDir`와 **동일 패턴** — 신규 IPC 채널 0·신규 영속 파일 0·`coerce*` 안전 복원 재사용·디바운스 `session:save` 자동 영속 | 세션 파일 크기 증가(태그 多時) | **채택** |
| 별도 메타 저장소(`tags.json`·`presets.json` + 신규 채널) | 관심사 분리·세션 파일 비대화 회피 | 신규 채널·신규 영속 파일·`coerce`·동기화 부담. J7/O1 선례와 불일치 | 비채택(1차) |
| NTFS 대체데이터스트림(ADS)/OS 태그 연동 | OS 통합 | **파일 자체 변경(데이터 비파괴 위반·features §T1 명시 1차 제외)**·이식성·권한 | 비채택(features §T1 1차 제외) |

### 스키마 (개념 — shared/dto)
```text
# T1 태그 — per-경로 메타 (favoriteLabels와 동형: 경로 키 맵)
SessionSnapshot.tagsByPath: Record<string /*항목 절대경로*/, TagColor[]>
  TagColor = 'red'|'orange'|'yellow'|'green'|'blue'|'purple'|'gray'   # 고정 팔레트(1차)
  # 다중 라벨 허용(배열) — features §T1 "다중 라벨 허용 여부는 설계, 최소 1색": 배열로 다중 허용·UI는 1차 단일/다중 모두 수용
  # 앱 내부 메타 — 파일 미변경(데이터 비파괴). 경로 이동/삭제 시 정합은 결정③.

# T3 프리셋 — 전역 메타 (배열·순서 보존, favorites 배열 선례)
SessionSnapshot.filterPresets: FilterPreset[]
  FilterPreset = {
    id; name;
    sort: { key; dir; folderFirst };
    filter: { query?; extPattern?; tagColors?: TagColor[]; diffOnly?: boolean };
  }
```
- **`coerce` 재사용**: `persistence/defaults.ts`에 `coerceTagsByPath`·`coerceFilterPresets`를 추가(기존 `coerceSidebar`/`coercePinnedByDir`/`coerceSplitRatios` 패턴) — 손상·미지 색·빈 이름 안전 폴백. **스키마 version +1**(구조 추가이므로 마이그레이션은 "없으면 빈 기본값").
- **영속 경로**: 기존 `session:save/load`(디바운스·원자적 쓰기) 그대로 → **신규 IPC 채널 0**.

---

## 결정 ② — 복수 필터 합성 규칙 (확정 — 서로 다른 차원=AND, 같은 차원 내 다중 값=OR)

[반영-3 인계분] features §P1·§T1·§T3 수용기준의 미해결을 다음으로 **확정**한다.

**원칙: "서로 다른 필터 차원은 AND로 누적(좁힘), 같은 차원 내 복수 값은 OR(넓힘)."** 즉 사용자가 거는 조건이 많을수록 결과는 좁아지되, 한 차원 안에서 여러 색/패턴을 고르면 그 안에서는 합집합이다.

| 필터 차원 | 차원 내 결합 | 차원 간 결합 |
|---|---|---|
| **이름 검색(D1·query)** | 단일 문자열(부분 일치) | **AND** |
| **확장자/이름 패턴(D2·extPattern)** | 복수 패턴 시 **OR**(`*.png`,`*.jpg` = 둘 중 하나) | **AND** |
| **태그 필터(T1·tagColors)** | 복수 색 선택 시 **OR**(빨강 또는 파랑) | **AND** |
| **차이만 보기(P1·diffOnly)** | 불리언(같음 항목 숨김) | **AND** |

- **합성 파이프라인**: 한 항목이 **모든 활성 차원을 통과(AND)** 해야 표시된다. 각 차원 내부에서 다중 값은 OR. 예: `query="report"` **AND** (`ext∈{png,jpg}`) **AND** (`tag∈{red,blue}`) **AND** `diffOnly` → 네 조건을 모두 만족하는 항목만.
- **프리셋(T3)과의 관계**: 프리셋은 "필터 차원 값들의 묶음을 한 번에 적용"하는 것이지 **새로운 결합 연산자가 아니다**. 프리셋 적용 = 그 프리셋이 지정한 query/extPattern/tagColors/diffOnly를 활성 필터로 세팅 → 동일한 AND/OR 규칙으로 평가. **프리셋끼리 동시 적용은 1차 미지원**(프리셋 선택 = 활성 필터 교체, features §T3 "프리셋 선택 시 일괄 적용").
- **순수 함수로 격리**: 합성 규칙을 `domain/rules/filterComposition.ts`(순수)에 두어 `matches(entry, activeFilters): boolean` 1곳에서 평가 → D1/D2/T1/P1/T3가 동일 규칙 공유·헤드리스 verify 가능(`filter.ts` 선례). `selectors.ts#computeVisible`가 이 함수로 가시 목록 파생(메모이즈).
- **근거(AND 기본)**: 파일 정리 맥락에서 사용자는 조건을 더할수록 "더 좁히려는" 의도가 일반적(탐색기·메일 필터 관례)이며, P1 "차이만 보기"는 본질적으로 다른 조건과 교집합이어야 의미가 있다(차이 + 그 중 png만 등). 같은 차원 다중 값을 OR로 둔 것은 "png 또는 jpg" 같은 자연스러운 묶음 선택을 위해서다.

---

## 결정 ③ — 메타 정합(경로 이동/삭제) & 비파괴 보장

- **앱 내부 메타·파일 비변경**: 태그는 세션 스냅샷에만 산다 → 파일/폴더 자체·NTFS ADS 무변경(features §T1 데이터 비파괴 필수).
- **경로 키 정합(고아 메타)**: 항목이 외부에서 이동/삭제되면 `tagsByPath`의 해당 키는 고아가 된다. 1차는 **lazy 정리** — 표시는 현재 디렉토리 항목 경로로 조회하므로 고아 키는 단순 미표시(부작용 0). 누적 방지를 위해 `coerceTagsByPath`/세션 로드 시 또는 주기적으로 **존재하지 않는 경로 키 GC**(베스트에포트·throw0). 앱 내 이동/이름변경은 후속에 메타 따라가기 검토(미해결 UQ-T1).
- **per-경로 메타 일관성**: J7 `favoriteLabels`·O1 `pinnedByDir`와 동일하게 절대경로 정규화(`normalizeDisplay`) 키 사용 → 키 충돌·드리프트 방지.

---

## 결정 ④ — T2(폴더 용량 인라인)는 본 ADR 비대상 (scanEngine 재사용·신규 ADR 불요)

§T2(상세 보기 폴더 용량 인라인)는 메타 영속이 아니라 **온디맨드 계산**이다. 기존 **`scanEngine.ts`(I1 사용량 대시보드 엔진·순환차단·권한 skip·취소·진행률)를 재사용**해 폴더 1개의 재귀 합계를 백그라운드 계산하면 되며, **신규 ADR이 불필요**하다(software-architecture §14에 모듈 설계로 기록). 결과 영속 캐시는 1차 제외(features §T2). 채널은 `analyze:scan:*` 재사용 또는 단일 폴더용 경량 호출(설계는 SW §14).

---

## 근거 (종합)

- **기존 패턴 재사용**: T1/T3는 J7 `favoriteLabels`·O1 `pinnedByDir`·E 워크스페이스와 동격의 세션 메타 → 신규 채널 0·신규 영속 파일 0·`coerce`/디바운스 영속 재사용.
- **데이터 비파괴**: 앱 내부 메타로 파일 자체·ADS 미변경(features §T1 필수).
- **합성 규칙 확정**: 인계된 미해결(AND/OR)을 "차원 간 AND·차원 내 OR"로 명확화하고 순수 함수 1곳에 격리 → D1/D2/T1/P1/T3 일관·테스트 가능.
- **단순성**: 고정 팔레트·전역 프리셋·lazy 메타 정리로 과설계 회피(사용자 정의 색·폴더별 자동 프리셋·ADS 연동은 features 1차 제외 그대로).

## 트레이드오프

- **세션 파일 비대화**: 태그가 많아지면 session.json 증가. 1차 빈도엔 무시 가능, 임계 시 별도 저장소로 분리(미해결 UQ-T2).
- **고아 메타**: 외부 이동/삭제 시 태그 키 고아(미표시·lazy GC). 앱 내 이동 따라가기는 후속.
- **프리셋 동시 적용 미지원**: 프리셋은 교체식(동시 합성 아님). features §T3 의도와 일치.

## 결과

- `SessionSnapshot`/`SidebarSnapshot` 확장: `tagsByPath`(T1)·`filterPresets`(T3). 스키마 version +1.
- `persistence/defaults.ts`에 `coerceTagsByPath`·`coerceFilterPresets` 추가.
- 신규 도메인 `domain/rules/filterComposition.ts`(AND/OR 합성 순수 함수)·`domain/rules/tags.ts`(팔레트·키 정규화).
- `panelsSlice.filter` 확장(tagColors·diffOnly)·`uiSlice` 또는 신규 `presetsSlice`(filterPresets·active)·`selectors.ts#computeVisible` 합성 함수 연결.
- 신규 UI: `ui/tags/`(태그 부여·표시·필터)·`ui/preset/`(프리셋 저장/적용/관리).
- 신규 IPC 채널: **0**(세션 영속 재사용). 신규 npm 의존성: **0**.
- T2는 본 ADR 비대상(scanEngine 재사용·SW §14).
- ADR-000-index에 ADR-012 등록. 마일스톤 **M6(T3)·M8(T1)**.

---

## 미해결 질문 (설계 deferral)

| # | 질문 | 1차 결정 | 후속 트리거 | 비차단 |
|---|---|---|---|---|
| **UQ-T1** | 앱 내 이동/이름변경 시 태그 메타 따라가기 | 1차 **lazy**(고아 키 미표시·GC) | 사용자가 이동 후 태그 유지를 기대할 때 → 이동/이름변경 작업에 메타 키 갱신 훅 추가 | 비차단 — 1차 데이터 비파괴·부작용 0 |
| **UQ-T2** | 태그 많을 때 세션 파일 비대화 → 별도 저장소 분리 | 1차 **세션 스냅샷 내**(J7/O1 패턴) | session.json 크기/저장 지연 임계 시 `tags.json` 분리(+신규 채널) | 비차단 |
| **UQ-T3** | 사용자 정의 태그명/색·폴더별 자동 프리셋 | 1차 **고정 팔레트·전역 프리셋**(features §T1/§T3 1차 제외) | 수요 시 커스텀 팔레트·폴더↔프리셋 자동 연결 | 비차단 |
