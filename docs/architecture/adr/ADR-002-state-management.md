# ADR-002 — 상태관리 라이브러리 선정

상태: 제안 · 2026-06-06

## 맥락
Renderer는 **창→탭(N)→레이아웃→패널(N)→목록**의 트리형 상태와, 패널별 선택/내비게이션, 200ms 단위 진행률 푸시, 다중 패널 동시 스트리밍을 다룬다. 핵심 비기능 요구는 **고빈도 국소 갱신에서 리렌더를 격리**해 가상 스크롤·다중 패널 성능을 지키는 것(US-5.6, US-5.2). 또 일부 상태는 직렬화해 세션 복원(US-5.5)에 써야 한다.

## 선택지 비교

| 기준 | Zustand(+Immer) | Redux Toolkit | Jotai/Recoil(atom) | Context + useReducer |
|---|---|---|---|---|
| 셀렉터 기반 부분 구독(리렌더 격리) | 강함 | 강함(reselect) | 강함(atom 단위) | **약함(트리 리렌더 위험)** |
| 보일러플레이트 | 적음 | 많음 | 보통 | 적음 |
| 트리형 + 고빈도 갱신 적합성 | 좋음(슬라이스+set) | 좋으나 무거움 | 원자 폭증 관리 부담 | 대형 트리 부적합 |
| 직렬화/영속 연동 | 쉬움(plain state) | 쉬움 | 보통 | 쉬움 |
| 외부 스토어(React 외 IPC 브리지에서 갱신) | 쉬움 | 쉬움 | 보통 | 어려움 |
| 학습/유지비 | 낮음 | 중 | 중 | 낮음 |

## 결정
**Zustand + Immer**를 채택하고, software-architecture 5.2의 슬라이스(tabs/panels/selection/operations/sidebar/ui)로 분할한다.

## 근거
- **셀렉터 부분 구독**으로 "바뀐 패널/다이얼로그만" 리렌더 → 다중 패널·가상 스크롤·진행률 고빈도 갱신에 핵심.
- IPC 이벤트 브리지(infra/api)가 **React 밖에서** 스토어를 갱신하기 쉽다(스트림 청크·진행률 푸시).
- plain object 상태라 SessionSnapshot 직렬화가 자연스럽다.
- Redux보다 보일러플레이트가 적어 MVP 속도에 유리. Context+useReducer는 대형 트리 리렌더 위험으로 탈락.

## 트레이드오프
- Redux 대비 devtools/미들웨어 생태계가 작다(Zustand devtools/persist 미들웨어로 보완 가능).
- 규약(슬라이스 경계·셀렉터 사용)을 팀이 지켜야 함 → 컨벤션/리뷰로 강제.
- Immer 사용으로 약간의 런타임 비용 발생. **적용 기준을 다음과 같이 명시한다**:
  - **Immer 적용(기본값)**: 트리형·중첩 구조 갱신이 잦은 슬라이스 — `tabsSlice`(windows/tabs/panels 중첩), `panelsSlice`(navHistory/view 중첩), `sidebarSlice`, `uiSlice`. 중첩 불변 갱신의 가독성 이득이 비용보다 크다.
  - **Immer 제외(수동 set)**: 초고빈도·얕은 갱신 경로 — `selectionSlice`의 선택 토글/범위(Set 직접 조작), `operationsSlice`의 진행률 머지(200ms마다 operationId별 progress 필드만 교체). 이들은 평탄한 구조라 수동 불변 업데이트로 Immer 프록시 비용을 제거한다.
  - 판단 규칙 한 줄: **"중첩 깊은 갱신=Immer, 평탄·초고빈도 갱신=수동 set"**. 슬라이스별 적용 여부는 software-architecture §5.2 표에 표기.
