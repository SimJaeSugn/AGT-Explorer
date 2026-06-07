# ADR-006 — 패키징 / 배포

상태: 제안 · 2026-06-06

## 맥락
1차 타깃은 **Windows 10/11 x64**. 인스톨러, (향후) 코드 서명·자동 업데이트, 단일 인스턴스 실행이 필요(PRD 7장). 빌드는 electron-vite로 결정(ADR-001)했고, 패키징 도구를 별도로 정해야 한다.

## 선택지 비교

| 도구 | 인스톨러(NSIS) | 코드서명 | 자동업데이트 | electron-vite 결합 | Vite 안정성 |
|---|---|---|---|---|---|
| **electron-builder(채택)** | 성숙 | 성숙 | 성숙(builder/updater) | 템플릿 기본 결합 | 무관(분리) |
| Electron Forge makers | 지원 | 지원 | 지원 | Vite 경로 experimental | 리스크 |

## 결정
**electron-builder**로 Windows **NSIS 인스톨러**를 생성한다. 설정은 `electron-builder.yml`. 단일 인스턴스 락은 앱 코드(Main)에서 처리.

## 근거
- ADR-001에서 빌드를 electron-vite로 택했고, electron-vite 표준 템플릿이 electron-builder와 결합되어 있어 마찰이 적다.
- NSIS·코드서명·자동 업데이트 경로가 Windows에서 성숙해 향후 배포 요구를 모두 흡수.
- Forge makers는 본 빌드 선택(experimental Vite)과 충돌 → 보류.

## 트레이드오프
- 빌드(electron-vite)+패키징(electron-builder) 2단 파이프라인을 스크립트로 연결해야 함.
- 멀티 OS(C, macOS/Linux) 확장 시 builder 타깃 추가는 가능하나 코드서명·공증 등 OS별 작업이 별도로 필요(이번 사이클 범위 밖).
