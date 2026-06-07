/**
 * verify-perf — P7-C 성능 측정 하니스(헤드리스, 일회성 검증).
 *
 * **헤드리스로 증명 가능한 "구조적 불변식"만** 단언한다. 실측 숫자(1만 항목 첫 렌더 ≤1.5s ·
 * 진행률 갱신 ≤200ms · 검색 입력 후 ≤200ms)는 GUI 런타임에서만 측정 가능 → `docs/P7-perf-measurement.md`
 * 의 절차로 사용자 런타임에 위임한다(여기서 숫자 위장 금지).
 *
 * 검증 항목:
 *  1) 윈도잉 불변식(`windowing.ts#computeWindow`) — 1만 항목·다양한 scrollTop/viewportH/colCount 에서
 *     렌더 후보 수(endIdx-startIdx)가 (가시행+2·overscan)·colCount 상한 이내(수십~수백, 1만 전체 아님).
 *     경계(최상단/최하단/중간)·startIdx≤endIdx≤count·totalHeight=rowCount×cellH 검증.
 *  2) 진행률 스로틀 — `OperationManager` 의 200ms 스로틀 상수/동작을 검증(상수 소스 단언 + setInterval
 *     기반 스로틀 로직을 동일 패턴으로 시뮬해 push 간격 ≥200ms·완료 시 강제 push 보증).
 *  3) 검색 필터 — `domain/rules/filter.ts` 순수함수로 1만 항목 필터 계산 시간 참고 측정(헤드리스 node
 *     측정 — 실 UI 200ms 와 별개, 계산 비용이 무시 가능 수준임을 보임).
 *
 * 실행: esbuild 번들 → node.
 *   esbuild scripts/verify-perf.ts --bundle --platform=node --format=cjs \
 *     --alias:@shared=./src/shared --alias:@renderer=./src/renderer \
 *     --outfile=./out/verify-perf.cjs && node ./out/verify-perf.cjs
 */
import * as fsp from 'node:fs/promises'
import { join } from 'node:path'
import { computeWindow } from '../src/renderer/ui/panel/views/windowing'
import { filterEntries, matchesQuery } from '../src/renderer/domain/rules/filter'
import type { FileEntryDTO } from '../src/shared/dto'

function line(s: string): void {
  // eslint-disable-next-line no-console
  console.log(s)
}
let pass = 0
let fail = 0
function check(name: string, cond: boolean): void {
  if (cond) {
    pass++
    line(`  PASS  ${name}`)
  } else {
    fail++
    line(`  FAIL  ${name}`)
  }
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// ────────────────────────────────────────────────────────────────────────
// 1) 윈도잉 불변식 — "1만 항목이어도 렌더 노드 수십~수백 개" 헤드리스 증명
// ────────────────────────────────────────────────────────────────────────
function section1Windowing(): void {
  line('== 1) 윈도잉 불변식 (computeWindow, 1만 항목 가상 스크롤) ==')

  const COUNT = 10_000
  const OVERSCAN = 4

  // (a) list/details: colCount=1, cellH=28, viewportH=600 → 가시 ~22행.
  {
    const cellH = 28
    const viewportH = 600
    const colCount = 1
    const visibleRows = Math.ceil(viewportH / cellH) // 가시행 상한
    const cap = (visibleRows + 2 * OVERSCAN + 1) * colCount // 윈도 상한(여유 +1: floor/ceil 경계)

    const scrollTops = [0, cellH, viewportH, 50_000, 100_000, COUNT * cellH - viewportH, COUNT * cellH]
    let maxWin = 0
    let allWithinCap = true
    let invariantOk = true
    for (const scrollTop of scrollTops) {
      const r = computeWindow({ scrollTop, viewportH, cellH, colCount, count: COUNT, overscan: OVERSCAN })
      const win = r.endIdx - r.startIdx
      maxWin = Math.max(maxWin, win)
      if (win > cap) allWithinCap = false
      // 구조 불변식.
      if (!(r.startIdx >= 0 && r.startIdx <= r.endIdx && r.endIdx <= COUNT)) invariantOk = false
      if (r.totalHeight !== r.rowCount * cellH) invariantOk = false
      if (r.rowCount !== Math.ceil(COUNT / colCount)) invariantOk = false
    }
    line(`  list: count=${COUNT} cap=${cap} 관측 최대 윈도=${maxWin}`)
    check('list: 모든 scrollTop 에서 렌더 후보 ≤ (가시행+2·overscan)·colCount 상한', allWithinCap)
    check('list: 렌더 후보 수십 개 수준(< 1% of count)', maxWin < COUNT / 100)
    check('list: startIdx≤endIdx≤count·totalHeight=rowCount×cellH·rowCount=ceil(count/cols)', invariantOk)
  }

  // (b) grid: colCount=6, cellH=104(셀높이), viewportH=720 → 가시 ~7행 × 6열.
  {
    const cellH = 104
    const viewportH = 720
    const colCount = 6
    const visibleRows = Math.ceil(viewportH / cellH)
    const cap = (visibleRows + 2 * OVERSCAN + 1) * colCount
    const rowCount = Math.ceil(COUNT / colCount)

    const scrollTops = [0, cellH, viewportH, 30_000, rowCount * cellH - viewportH, rowCount * cellH]
    let maxWin = 0
    let allWithinCap = true
    let invariantOk = true
    let endIdxMultipleOrCount = true
    for (const scrollTop of scrollTops) {
      const r = computeWindow({ scrollTop, viewportH, cellH, colCount, count: COUNT, overscan: OVERSCAN })
      const win = r.endIdx - r.startIdx
      maxWin = Math.max(maxWin, win)
      if (win > cap) allWithinCap = false
      if (!(r.startIdx >= 0 && r.startIdx <= r.endIdx && r.endIdx <= COUNT)) invariantOk = false
      if (r.totalHeight !== r.rowCount * cellH) invariantOk = false
      // startIdx 는 항상 행 경계(colCount 배수).
      if (r.startIdx % colCount !== 0) invariantOk = false
      // endIdx 는 행 경계의 배수이거나 count 로 클램프됨.
      if (r.endIdx !== COUNT && r.endIdx % colCount !== 0) endIdxMultipleOrCount = false
    }
    line(`  grid: count=${COUNT} cols=${colCount} cap=${cap} 관측 최대 윈도=${maxWin}`)
    check('grid: 모든 scrollTop 에서 렌더 후보 ≤ (가시행+2·overscan)·colCount 상한', allWithinCap)
    check('grid: 렌더 후보 수백 개 이내(< 5% of count)', maxWin < COUNT / 20)
    check('grid: startIdx 행경계(콜수 배수)·구조 불변식', invariantOk)
    check('grid: endIdx 는 행경계 배수이거나 count 클램프', endIdxMultipleOrCount)
  }

  // (c) 경계 정확성: 최상단 startIdx=0, 최하단 endIdx=count.
  {
    const cellH = 28
    const viewportH = 600
    const colCount = 1
    const rowCount = Math.ceil(COUNT / colCount)
    const top = computeWindow({ scrollTop: 0, viewportH, cellH, colCount, count: COUNT, overscan: OVERSCAN })
    check('경계: 최상단 scrollTop=0 → startIdx=0', top.startIdx === 0)
    const bottom = computeWindow({
      scrollTop: rowCount * cellH - viewportH,
      viewportH,
      cellH,
      colCount,
      count: COUNT,
      overscan: OVERSCAN
    })
    check('경계: 최하단 → endIdx=count(마지막 항목 포함)', bottom.endIdx === COUNT)
    // 유효 스크롤 범위(브라우저가 [0, scrollHeight-clientHeight] 로 클램프하는 범위) 내에서는
    // 항상 startIdx≤endIdx 불변식이 성립함을 전수 표본으로 확인.
    const maxScroll = rowCount * cellH - viewportH
    let inRangeOk = true
    for (let s = 0; s <= maxScroll; s += 137) {
      const r = computeWindow({ scrollTop: s, viewportH, cellH, colCount, count: COUNT, overscan: OVERSCAN })
      if (r.startIdx > r.endIdx) inRangeOk = false
    }
    check('경계: 유효 스크롤 범위 전체에서 startIdx≤endIdx 불변식 성립', inRangeOk)
    // ⚠️ 알려진 엣지(런타임 무관·방어 권고): scrollTop 이 콘텐츠 높이를 초과하면(예: 큰 폴더에서
    // 저장된 scrollTop 을 작아진 count 에 복원) startRow 가 rowCount 를 넘어 startIdx>endIdx(음수
    // 윈도)가 된다. DOM scrollTop 은 브라우저가 자동 클램프하므로 일반 스크롤로는 도달 불가.
    // slice(startIdx,endIdx)는 빈 배열을 반환(크래시 아님). frontend 방어 권고로 분류.
    const over = computeWindow({
      scrollTop: rowCount * cellH + 5000,
      viewportH,
      cellH,
      colCount,
      count: COUNT,
      overscan: OVERSCAN
    })
    line(`  NOTE  scrollTop 초과 시 윈도=${over.endIdx - over.startIdx}(음수) — frontend computeWindow 또는 호출부에서 startIdx=min(startIdx,endIdx) 클램프 방어 권고(런타임 비차단).`)
  }

  // (d) count=0(빈 폴더) 안전성.
  {
    const r = computeWindow({ scrollTop: 0, viewportH: 600, cellH: 28, colCount: 1, count: 0, overscan: OVERSCAN })
    check('빈 폴더: count=0 → startIdx=endIdx=0·totalHeight=0', r.startIdx === 0 && r.endIdx === 0 && r.totalHeight === 0)
  }
}

// ────────────────────────────────────────────────────────────────────────
// 2) 진행률 스로틀 — OperationManager 200ms 스로틀 상수·동작 검증
// ────────────────────────────────────────────────────────────────────────
async function section2Throttle(): Promise<void> {
  line('== 2) 진행률 스로틀 (OperationManager PROGRESS_THROTTLE_MS=200) ==')

  // (a) 상수 소스 단언 — OperationManager 가 200ms 상수를 보유·setInterval(…, PROGRESS_THROTTLE_MS) 사용.
  //     (상수는 모듈 로컬 const 라 import 불가 → 소스 텍스트로 계약 동결 확인. 변경 시 회귀 감지.)
  const omPath = join(__dirname, '..', 'src', 'main', 'operations', 'OperationManager.ts')
  let src = ''
  try {
    src = await fsp.readFile(omPath, 'utf8')
  } catch {
    src = ''
  }
  check('소스: PROGRESS_THROTTLE_MS = 200 상수 정의 존재', /const\s+PROGRESS_THROTTLE_MS\s*=\s*200\b/.test(src))
  check('소스: startThrottle 가 setInterval(…, PROGRESS_THROTTLE_MS) 사용', /setInterval\([\s\S]*?PROGRESS_THROTTLE_MS\s*\)/.test(src))
  check('소스: finish 가 마지막 진행률 강제 push(100% 반영)', /마지막 진행률 1건 강제 푸시/.test(src) && /OP_PROGRESS/.test(src))
  check('소스: clearInterval(throttleTimer) 로 타이머 정리(좀비 0)', /clearInterval\(op\.throttleTimer\)/.test(src))

  // (b) 스로틀 동작 시뮬 — OperationManager.startThrottle/finish 와 동일 패턴(setInterval 200ms +
  //     lastProgress 최신값만 push + finish 시 강제 push 1건)을 재현해 push 간격 불변식을 검증한다.
  const THROTTLE_MS = 200
  type Push = { t: number; items: number }
  const pushes: Push[] = []
  let lastProgress: { items: number } | null = null
  const t0 = Date.now()

  // worker 가 매우 빠르게(매 5ms) 진행 보고를 쏟아붓는 상황을 모사.
  const fastReports = setInterval(() => {
    lastProgress = { items: (lastProgress?.items ?? 0) + 1 }
  }, 5)

  // 스로틀 타이머: 200ms 마다 최신 lastProgress 1건만 push.
  const throttleTimer = setInterval(() => {
    if (lastProgress) pushes.push({ t: Date.now() - t0, items: lastProgress.items })
  }, THROTTLE_MS)

  await sleep(1050) // ~5 스로틀 윈도.
  clearInterval(fastReports)
  clearInterval(throttleTimer)
  // finish: 마지막 강제 push(100% 반영).
  if (lastProgress) pushes.push({ t: Date.now() - t0, items: lastProgress.items })

  line(`  빠른 보고(5ms 간격) → 스로틀 push 수=${pushes.length}(약 1.05s/200ms≈6 예상)`)
  // 폭주 보고(~210건)에도 push 는 스로틀 윈도 수(약 6) 수준으로 합산되어야 한다.
  check('스로틀: 폭주 보고에도 push 수가 스로틀 윈도 수준(≤ 윈도+여유)', pushes.length <= 8)
  check('스로틀: push 발생(≥3, setInterval 동작)', pushes.length >= 3)

  // 연속 push 간격 ≥ ~200ms(타이머 지터 허용 -50ms). 마지막 강제 push 1건은 간격 예외 허용.
  let minGap = Infinity
  for (let i = 1; i < pushes.length - 1; i++) {
    const gap = pushes[i]!.t - pushes[i - 1]!.t
    minGap = Math.min(minGap, gap)
  }
  line(`  스로틀 push 간격 최소=${minGap === Infinity ? 'n/a' : minGap + 'ms'}(목표 ≥200±지터)`)
  check('스로틀: 인접 push 간격 ≥150ms(200ms 스로틀 ± 지터, 강제 push 제외)', minGap === Infinity || minGap >= 150)
  // 강제 push 는 마지막 보고값(최신 items)을 반영해야 한다(100% 반영 보증).
  check('스로틀: finish 강제 push 가 최신 진행값 반영', pushes.length >= 2 && pushes[pushes.length - 1]!.items >= pushes[pushes.length - 2]!.items)
}

// ────────────────────────────────────────────────────────────────────────
// 3) 검색 필터 — 1만 항목 순수 필터 계산 비용 참고 측정
// ────────────────────────────────────────────────────────────────────────
function makeEntries(n: number): FileEntryDTO[] {
  const out: FileEntryDTO[] = []
  for (let i = 0; i < n; i++) {
    const ext = i % 3 === 0 ? 'png' : i % 3 === 1 ? 'txt' : 'md'
    out.push({
      name: `report_${i.toString().padStart(5, '0')}.${ext}`,
      path: `C:\\bench\\report_${i}.${ext}`,
      isDir: false,
      size: i,
      mtime: 0,
      ctime: 0,
      ext,
      attrs: { hidden: false, readonly: false, system: false, symlink: false }
    })
  }
  return out
}

function section3Filter(): void {
  line('== 3) 검색 필터 (filter.ts 순수함수, 1만 항목 계산 비용 참고측정) ==')
  const N = 10_000
  const entries = makeEntries(N)

  // 정확성: 부분일치·글롭·확장자 필터.
  const sub = filterEntries(entries, 'report_00001') // 정확히 1건(정렬 padStart).
  check('필터 정확성: 부분일치 "report_00001" → 1건', sub.length === 1)
  const glob = filterEntries(entries, '*.png')
  check('필터 정확성: 글롭 "*.png" → png 만(약 1/3)', glob.every((e) => e.ext === 'png') && glob.length > N / 4)
  const extQ = filterEntries(entries, '.txt')
  check('필터 정확성: 확장자 ".txt" → txt 만', extQ.every((e) => e.ext === 'txt') && extQ.length > N / 4)
  check('필터 정확성: 빈 쿼리 → 동일 참조(전체)', filterEntries(entries, '') === entries)
  check('필터 정확성: matchesQuery 빈쿼리 항상 true', matchesQuery(entries[0]!, '   '))

  // 참고 측정: 1만 항목 필터를 여러 패턴으로 반복해 계산 시간 측정(헤드리스 — 실 UI 200ms 와 별개).
  const patterns = ['report', '*.png', '.md', 'report_0500', 'a?c', 'zzz_no_match']
  const ITER = 20
  const t0 = performance.now()
  let acc = 0
  for (let k = 0; k < ITER; k++) {
    for (const p of patterns) {
      acc += filterEntries(entries, p).length
    }
  }
  const elapsed = performance.now() - t0
  const perFilter = elapsed / (ITER * patterns.length)
  line(`  1만 항목 필터 ${ITER * patterns.length}회 총 ${elapsed.toFixed(1)}ms → 1회 평균 ${perFilter.toFixed(3)}ms (acc=${acc})`)
  // 계산 비용이 무시 가능 수준(1회 ≪ 200ms)임을 보임. 헤드리스 환경별 여유로 50ms 게이트.
  check('검색: 1만 항목 1회 필터 계산 ≪ 200ms(참고 — 계산비용 무시가능)', perFilter < 50)
  line('  NOTE  실 "검색 입력 후 ≤200ms 가시결과"는 디바운스+렌더 포함 런타임 체감 지표 → docs/P7-perf-measurement.md 절차로 실측.')
}

async function main(): Promise<void> {
  section1Windowing()
  await section2Throttle()
  section3Filter()

  line('')
  line('  NOTE  실측 숫자(첫 렌더 ≤1.5s · 진행률 ≤200ms · 검색 ≤200ms)는 GUI 런타임 측정 →')
  line('        docs/P7-perf-measurement.md 절차로 사용자 환경 실측(헤드리스는 불변식만 증명).')
  line('')
  line(`RESULT: ${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

void main()
