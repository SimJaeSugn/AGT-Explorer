# P7 성능 실측 절차 (런타임 측정 — GUI 환경 위임)

> 작성: QA · 2026-06-07 · 상태: **절차 완비 · 실측 미수행(헤드리스 환경 GUI 차단)**
> 입력: [P7-execution-plan.md §2.3·§4(C3)](./P7-execution-plan.md) · PRD §3(성능) · roadmap §3 P7 DoD
> 짝 문서: 헤드리스 불변식 증명은 `scripts/verify-perf.ts`(이 문서가 위임하는 "실측 숫자"의 구조적 전제).

본 문서는 P7 성능 3종 수용 기준의 **실측 숫자**를 사용자 런타임(앱 GUI 실행) 환경에서 측정하는
절차다. **헤드리스(이 환경)로는 측정 불가** — `verify-perf.ts` 가 증명하는 것은 "측정 숫자가 성립할
구조적 불변식"(가상 스크롤 윈도 상한·200ms 스로틀 코드 보장·필터 계산 비용 무시가능)이며, 아래 숫자
(≤1.5s / ≤200ms / ≤200ms)는 **실 GUI 렌더·IPC·페인트가 포함된 체감 지표**라 런타임에서만 측정된다.

## 0. 헤드리스 증명분 vs 런타임 실측분 (정직 분리)

| 수용 기준 | 헤드리스 증명(verify-perf.ts) | 런타임 실측(본 문서) |
|---|---|---|
| 1만 항목 첫 렌더 ≤1.5s | 윈도잉 불변식: 1만이어도 DOM 후보 수십~수백(전체 렌더 안 함)·`totalHeight`·경계 정확 | 폴더 진입→첫 청크 페인트 실시간(`performance.mark`/DevTools) |
| 진행률 갱신 ≤200ms | `PROGRESS_THROTTLE_MS=200` 상수·`setInterval(…,200)`·강제 push 코드 보장 + 스로틀 시뮬 간격 ≥200ms | 실 대용량 복사 중 `op:progress` 수신 간격 로그 |
| 검색 입력 후 ≤200ms | `filter.ts` 1만 항목 1회 필터 계산 ≪200ms(참고측정, 본 환경 ~4ms) | 입력→가시결과 페인트까지(디바운스+필터+렌더 합) |

## 1. 사전 준비

### 1.1 벤치 폴더(1만 항목) 생성
PowerShell 로 1만 개 파일을 가진 폴더를 만든다(선택: `scripts/make-bench-dir.ps1` 미존재 시 인라인).
```powershell
$dir = "$env:TEMP\agt-bench-10k"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
1..10000 | ForEach-Object {
  $ext = @('png','txt','md','json','log')[$_ % 5]
  Set-Content -Path (Join-Path $dir ("file_{0:D5}.$ext" -f $_)) -Value "x" -NoNewline
}
Write-Host "생성: $dir ($(Get-ChildItem $dir | Measure-Object | Select -Expand Count)개)"
```

### 1.2 dev 빌드 + 계측 훅
```powershell
npm run dev   # electron-vite dev --watch
```
dev 계측 훅(아래 §4)은 `import.meta.env.DEV` 가드로 prod 미포함. **계측 코드는 frontend 후속/선택**
(본 QA 트랙은 절차·불변식까지. 훅 미적용 시 DevTools Performance 수동 측정으로 대체 가능).

## 2. 측정 시나리오 & 합격 기준

### 2.1 첫 렌더 ≤1.5초
1. dev 앱 실행 → 빈 탭(또는 다른 폴더)에서 시작.
2. 주소창(`Ctrl+L`)에 `%TEMP%\agt-bench-10k` 입력 → Enter(진입 시점 = 측정 시작).
3. **측정**: 진입 시점부터 **첫 화면 청크가 페인트되어 스크롤 가능해질 때까지**.
   - DevTools(`Ctrl+Shift+I`) → Performance → Record → 진입 → Stop → 첫 `Layout`/`Paint` 까지.
   - 또는 §4 dev 훅 `performance.measure('list:first-paint')` 콘솔 값.
4. **합격**: ≤ 1500ms. (스트리밍이므로 전체 1만 로드가 아니라 **첫 가시 청크** 기준 — windowing
   불변식상 DOM 후보는 수십 개로 일정, 첫 페인트 비용은 항목 수와 무관해야 함.)

### 2.2 진행률 갱신 ≤200ms
1. 대용량 파일(수 GB 또는 다수 파일) 복사 시작 → ProgressDialog 표시.
2. **측정**: `op:progress` 수신 간격(연속 갱신 사이 ms). DevTools Console 에 §4 훅 로그 또는
   preload 이벤트 타임스탬프.
3. **합격**: 갱신 간격이 **≤200ms 를 의미 있게 초과하지 않음**(스로틀 상한 200ms ± 타이머 지터).
   verify-perf 가 코드상 `setInterval(200)` + 폭주 보고 합산을 이미 보증 → 런타임은 회귀 확인.

### 2.3 검색 입력 후 가시결과 ≤200ms
1. 1만 항목 폴더 진입 후 검색(`Ctrl+F`) 활성.
2. 검색어 1글자 입력(예: `report` 또는 `.png`).
3. **측정**: 마지막 키 입력 → 필터된 목록 페인트까지(디바운스 포함). §4 훅 `list:search`.
4. **합격**: ≤ 200ms. (filter.ts 계산 자체는 ~4ms로 무시가능 — 병목은 디바운스·렌더이므로
   디바운스 지연이 200ms 예산을 잠식하지 않는지 확인.)

## 3. 결과 기록 양식

| 항목 | 측정값(3회 중앙값) | 합격 기준 | 판정 | 환경(OS·해상도·빌드) |
|---|---|---|---|---|
| 첫 렌더 |  | ≤1.5s |  |  |
| 진행률 간격 |  | ≤200ms |  |  |
| 검색 가시결과 |  | ≤200ms |  |  |

> 미합격 시: windowing 청크 크기·디바운스 지연·아이콘 지연로딩을 조정 후 재측정. 구조적 불변식
> (verify-perf)이 PASS 인데 런타임만 미달이면 렌더/페인트 병목 → frontend 프로파일링.

## 4. dev 계측 훅 제안 (frontend 후속·선택, `import.meta.env.DEV` 가드)

> 본 QA 트랙은 **절차 + 헤드리스 불변식**까지. 아래는 frontend 가 채택할 수 있는 계측 코드 골격(권고).
> prod 번들 미포함을 위해 전부 `import.meta.env.DEV` 가드.

```ts
// 첫 렌더: 폴더 진입 usecase 에서 mark, FileListView 첫 청크 렌더 effect 에서 measure.
if (import.meta.env.DEV) performance.mark('list:enter')
// ...첫 청크 렌더 후:
if (import.meta.env.DEV) {
  performance.mark('list:first-paint')
  performance.measure('list:first-paint', 'list:enter', 'list:first-paint')
  // eslint-disable-next-line no-console
  console.log('[perf] first-paint', performance.getEntriesByName('list:first-paint').at(-1)?.duration)
}

// 진행률: op:progress 수신부에서 직전 수신과의 간격 로그.
if (import.meta.env.DEV) {
  const now = performance.now()
  console.log('[perf] progress-gap', now - lastProgressTs); lastProgressTs = now
}

// 검색: 입력 핸들러 mark → 필터결과 렌더 effect measure.
```

## 5. 한계·정직 표기
- **이 환경(헤드리스)에서 위 §2 숫자는 미측정** — roadmap/traceability 에 "성능 실측 = 런타임 필요
  (준비완료)"로 표기하고 ✅(충족)로 위장하지 않는다(P7 계획 §0·§8 정직성 게이트).
- 헤드리스로 보증된 것: **윈도잉 상한·200ms 스로틀 코드·필터 계산 비용 무시가능**(verify-perf PASS).
  이는 숫자가 성립할 **필요조건**이며 충분조건(실 페인트 시간)은 런타임 실측이 확정한다.
