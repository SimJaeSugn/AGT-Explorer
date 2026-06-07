# ADR-001 — 빌드 도구 선정

상태: 제안 · 2026-06-06

## 맥락
Electron + TypeScript + React 앱은 **Main / Preload / Renderer** 세 개의 빌드 타깃을 가진다. 각각 실행 환경(Node vs DOM)과 모듈 형식이 다르다. 개발 생산성(HMR)과 3-타깃 동시 빌드, 환경별(dev/prod) 분리가 필요하다. (PRD: Electron 전제 / directory-structure 3장)

## 선택지 비교

| 기준 | electron-vite | Electron Forge(+Vite plugin) | webpack(Forge 기본) |
|---|---|---|---|
| HMR/Dev 속도 | 매우 빠름(Vite) | 빠름(실험적) | 느림 |
| 3-엔트리(main/preload/renderer) | 단일 설정 1급 지원 | 부분(실험적) | 수동 다중 설정 |
| 안정성 | 안정 | **Vite 경로 experimental** | 안정 |
| TS/React DX | 우수 | 우수 | 보통(설정 장황) |
| 패키징 통합 | 별도(builder 결합) | 통합 | 통합 |

## 결정
**electron-vite를 개발/번들 도구로 채택**하고, 패키징은 electron-builder로 분리(ADR-006).

## 근거
- 본 프로젝트 구조가 정확히 main/preload/renderer 3-타깃이며 electron-vite가 이를 단일 설정으로 1급 지원한다.
- 반복 개발 속도(Vite HMR)가 webpack 대비 크게 우위 → 생산성·결함 회귀 속도 개선.
- Forge의 Vite 통합은 experimental이라 안정성 리스크. "성숙한 빌드 + 성숙한 패키징"을 각각 조합하는 편이 위험이 낮다.

## 트레이드오프
- 빌드와 패키징이 두 도구로 나뉘어 파이프라인 연결 작업이 필요(스크립트로 흡수).
- Forge의 올인원 스캐폴딩/퍼블리시 편의는 포기. 대신 구성 제어권을 얻는다.
