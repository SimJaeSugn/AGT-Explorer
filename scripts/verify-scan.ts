/**
 * I장 스캔 엔진 실증 스크립트(헤드리스, 일회성 검증).
 *
 * scanEngine.runScan 을 메인 스레드에서 직접 호출(env 비의존)하여 다음을 검증한다:
 *  1) 합계 정확성 — totalBytes/totalItems 가 실제 픽스처와 일치.
 *  2) Top10 정렬 — topFolders/topFiles 가 bytes desc, 최대 10개.
 *  3) skipped — 권한거부(읽을 수 없는 디렉토리 모의: realpath/ readdir 실패)·링크.
 *  4) 순환 — 정션(symlink 'junction')·realpath 방문 Set 으로 무한루프 없이 종료.
 *  5) 취소 — shouldCancel 협조 폴링 → canceled=true 부분결과 반환.
 *  6) truncated — ITEM_CAP 초과 시 truncated=true(소형 CAP 모의).
 *
 * 실행: esbuild 번들 후 node (verify-ops.ts 패턴, @shared 별칭 해소).
 */
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import { join } from 'node:path'
import { runScan, SCAN_ITEM_CAP } from '../src/main/operations/scanEngine'
import type { ScanHooks } from '../src/main/operations/scanEngine'

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

/** 진행 콜백 무시 + 취소 안 함(기본 훅). */
const noopHooks: ScanHooks = {
  onProgress: () => undefined,
  shouldCancel: () => false
}

async function main(): Promise<void> {
  const base = await fsp.mkdtemp(join(os.tmpdir(), 'explorer-scan-'))
  line(`임시 루트: ${base}`)

  // ── 1) 합계 정확성 + Top10 정렬 ────────────────────────────────────────
  line('== 1) 합계 정확성 + Top10 정렬 ==')
  // 구조:
  //   root/
  //     big/      (파일 합계 3000)
  //       a.bin   2000
  //       b.bin   1000
  //     small/    (파일 합계 100)
  //       c.bin   100
  //     d.bin     500   (루트 직속 파일)
  // 총 바이트 = 3600, 총 항목 = big, a, b, small, c, d = 6
  const big = join(base, 'big')
  const small = join(base, 'small')
  await fsp.mkdir(big, { recursive: true })
  await fsp.mkdir(small, { recursive: true })
  await fsp.writeFile(join(big, 'a.bin'), Buffer.alloc(2000, 1))
  await fsp.writeFile(join(big, 'b.bin'), Buffer.alloc(1000, 1))
  await fsp.writeFile(join(small, 'c.bin'), Buffer.alloc(100, 1))
  await fsp.writeFile(join(base, 'd.bin'), Buffer.alloc(500, 1))

  const r1 = await runScan(base, noopHooks)
  check('totalBytes=3600', r1.totalBytes === 3600)
  check('totalItems=6', r1.totalItems === 6)
  check('canceled=false', r1.canceled === false)
  check('truncated=false', r1.truncated === false)

  // Top 폴더: big(3000) > small(100), 직속 자식 폴더만.
  check('topFolders[0]=big(3000)', r1.topFolders[0]?.name === 'big' && r1.topFolders[0]?.bytes === 3000)
  check('topFolders[1]=small(100)', r1.topFolders[1]?.name === 'small' && r1.topFolders[1]?.bytes === 100)
  check('topFolders 정렬 desc', r1.topFolders.every((e, i, a) => i === 0 || a[i - 1]!.bytes >= e.bytes))
  check('topFolders 전부 isDir', r1.topFolders.every((e) => e.isDir))

  // Top 파일: a.bin(2000) > b.bin(1000) > d.bin(500) > c.bin(100).
  check('topFiles[0]=a.bin(2000)', r1.topFiles[0]?.name === 'a.bin' && r1.topFiles[0]?.bytes === 2000)
  check('topFiles[1]=b.bin(1000)', r1.topFiles[1]?.name === 'b.bin')
  check('topFiles 정렬 desc', r1.topFiles.every((e, i, a) => i === 0 || a[i - 1]!.bytes >= e.bytes))
  check('topFiles 전부 file', r1.topFiles.every((e) => !e.isDir))

  // ── 2) Top10 상한(11개 폴더 → 최대 10개, 가장 작은 1개 탈락) ──────────────
  line('== 2) Top10 상한(11개 → 10개 보관) ==')
  const capRoot = await fsp.mkdtemp(join(os.tmpdir(), 'explorer-scan-cap-'))
  for (let i = 0; i < 11; i++) {
    const d = join(capRoot, `dir${String(i).padStart(2, '0')}`)
    await fsp.mkdir(d, { recursive: true })
    // dir{i} 안에 (i+1)*100 바이트 파일 1개 — 크기 단조 증가.
    await fsp.writeFile(join(d, 'f.bin'), Buffer.alloc((i + 1) * 100, 1))
  }
  const r2 = await runScan(capRoot, noopHooks)
  check('topFolders 최대 10개', r2.topFolders.length === 10)
  check('topFiles 최대 10개', r2.topFiles.length === 10)
  // 가장 큰 폴더 dir10(1100), 가장 작은 보관 폴더는 dir01(200) — dir00(100) 탈락.
  check('최대 폴더 dir10 보관', r2.topFolders[0]?.name === 'dir10' && r2.topFolders[0]?.bytes === 1100)
  check('최소 폴더 dir00(100) 탈락', !r2.topFolders.some((e) => e.name === 'dir00'))

  // ── 3) skipped — 읽을 수 없는 디렉토리(접근 거부 모의) ─────────────────────
  line('== 3) skipped(접근 거부 디렉토리 격리, throw 0) ==')
  // chmod 0 은 Windows 에서 권한거부를 완전히 재현하진 않지만, 엔진은 readdir/lstat
  // 실패를 throw 없이 skipped 로 흡수해야 한다. 여기선 "존재하지만 lstat 실패"를
  // 직접 재현하기 어려우므로, 링크(아래 4)·순환에서 skipped 격리를 검증하고
  // 본 항목은 "정상 디렉토리 + 손상 항목 없이 throw 0 종료"를 확인한다.
  let threw = false
  try {
    await runScan(base, noopHooks)
  } catch {
    threw = true
  }
  check('정상 스캔 throw 0', !threw)

  // ── 4) 순환 — 정션(symlink junction) 자기참조 → 무한루프 없이 종료 ─────────
  line('== 4) 순환 차단(정션/심볼릭 + 방문 realpath Set) ==')
  const cycleRoot = await fsp.mkdtemp(join(os.tmpdir(), 'explorer-scan-cyc-'))
  const realDir = join(cycleRoot, 'real')
  await fsp.mkdir(realDir, { recursive: true })
  await fsp.writeFile(join(realDir, 'x.bin'), Buffer.alloc(50, 1))
  let linkMade = false
  try {
    // real 안에 자기 부모(cycleRoot)를 가리키는 정션 → 따라가면 무한루프.
    await fsp.symlink(cycleRoot, join(realDir, 'loop'), 'junction')
    linkMade = true
  } catch {
    // 권한/플랫폼 제약으로 링크 생성 실패 시 이 케이스는 스킵(아래 check 로 명시).
    linkMade = false
  }
  if (linkMade) {
    const r4 = await runScan(cycleRoot, noopHooks)
    check('순환 스캔 정상 종료(무한루프 없음)', true)
    check('순환 링크 skipped 격리(>=1)', r4.skipped >= 1)
    check('순환 스캔 canceled=false', r4.canceled === false)
    // x.bin 50바이트는 정확히 1회만 집계(중복 방문 없음).
    check('순환에도 x.bin 1회만 집계(totalBytes=50)', r4.totalBytes === 50)
  } else {
    line('  SKIP  정션 생성 불가(권한/플랫폼) — 순환 케이스 건너뜀')
    // 방문 Set 자체는 동일 경로 2회 스캔 호출이 아니라 단일 스캔 내 재방문 차단이므로
    // 링크 없이는 직접 재현 불가. 엔진 코드의 visited Set 로직으로 보장.
  }

  // ── 5) 취소 — shouldCancel → canceled 부분결과 ────────────────────────────
  line('== 5) 취소(협조 폴링 → canceled 부분결과) ==')
  const cancelRoot = await fsp.mkdtemp(join(os.tmpdir(), 'explorer-scan-cxl-'))
  for (let i = 0; i < 50; i++) {
    await fsp.writeFile(join(cancelRoot, `f${i}.bin`), Buffer.alloc(100, 1))
  }
  let progressCount = 0
  const cancelHooks: ScanHooks = {
    onProgress: () => {
      progressCount++
    },
    // 진행 보고가 3회 이상 누적되면 취소 신호.
    shouldCancel: () => progressCount >= 3
  }
  const r5 = await runScan(cancelRoot, cancelHooks)
  check('취소 시 canceled=true', r5.canceled === true)
  check('취소 시 부분결과(totalItems<50)', r5.totalItems < 50)

  // ── 6) truncated — itemCap 초과 → 중단(소형 CAP 주입) ────────────────────
  line('== 6) truncated(itemCap 초과 → 중단) ==')
  check('SCAN_ITEM_CAP 양수 상한 존재', SCAN_ITEM_CAP > 0 && Number.isFinite(SCAN_ITEM_CAP))
  // 50개 항목 트리에 itemCap=10 주입 → truncated=true, totalItems 가 cap 부근에서 멈춤.
  const truncRoot = await fsp.mkdtemp(join(os.tmpdir(), 'explorer-scan-trunc-'))
  for (let i = 0; i < 50; i++) {
    await fsp.writeFile(join(truncRoot, `t${i}.bin`), Buffer.alloc(100, 1))
  }
  const r6 = await runScan(truncRoot, noopHooks, { itemCap: 10 })
  check('itemCap 초과 → truncated=true', r6.truncated === true)
  check('truncated 시 totalItems<50(부분 집계)', r6.totalItems < 50)
  check('truncated 시 canceled=false', r6.canceled === false)
  // CAP 미만 트리(itemCap=1000)는 truncated=false.
  const r6b = await runScan(truncRoot, noopHooks, { itemCap: 1000 })
  check('CAP 여유 → truncated=false, 전부 집계(50)', r6b.truncated === false && r6b.totalItems === 50)
  await fsp.rm(truncRoot, { recursive: true, force: true }).catch(() => undefined)

  // ── 7) byCategory — 파일 유형별 집계(K3) ────────────────────────────────
  line('== 7) byCategory(유형별 bytes/count 집계) ==')
  // 알려진 확장자 분포 트리:
  //   img1.png 100, img2.jpg 200       → image (2건, 300)
  //   clip.mp4 1000                    → video (1건, 1000)
  //   song.mp3 50                      → audio (1건, 50)
  //   doc.pdf 300, notes.md 20         → document (2건, 320)
  //   app.ts 10, page.html 40          → code (2건, 50)
  //   pack.zip 500                     → archive (1건, 500)
  //   mystery.xyz 5, noext 5           → other (2건, 10)  (미지 확장자/확장자 없음)
  const catRoot = await fsp.mkdtemp(join(os.tmpdir(), 'explorer-scan-cat-'))
  const files: [string, number][] = [
    ['img1.png', 100],
    ['img2.jpg', 200],
    ['clip.mp4', 1000],
    ['song.mp3', 50],
    ['doc.pdf', 300],
    ['notes.md', 20],
    ['app.ts', 10],
    ['page.html', 40],
    ['pack.zip', 500],
    ['mystery.xyz', 5],
    ['noext', 5]
  ]
  for (const [n, sz] of files) await fsp.writeFile(join(catRoot, n), Buffer.alloc(sz, 1))
  const r7 = await runScan(catRoot, noopHooks)
  const bc = r7.byCategory ?? []
  const find = (c: string): { bytes: number; count: number } =>
    bc.find((e) => e.category === c) ?? { bytes: 0, count: 0 }
  check('byCategory 항상 7개(0 포함)', bc.length === 7)
  check('image=2건/300B', find('image').count === 2 && find('image').bytes === 300)
  check('video=1건/1000B', find('video').count === 1 && find('video').bytes === 1000)
  check('audio=1건/50B', find('audio').count === 1 && find('audio').bytes === 50)
  check('document=2건/320B', find('document').count === 2 && find('document').bytes === 320)
  check('code=2건/50B', find('code').count === 2 && find('code').bytes === 50)
  check('archive=1건/500B', find('archive').count === 1 && find('archive').bytes === 500)
  // 미지 확장자(.xyz) + 확장자 없음(noext) → other.
  check('other=2건/10B(미지·무확장자)', find('other').count === 2 && find('other').bytes === 10)
  // 카테고리 합 = 전체 파일 bytes/count(폴더 제외, 이 트리는 폴더 0개).
  const catBytesSum = bc.reduce((s, e) => s + e.bytes, 0)
  const catCountSum = bc.reduce((s, e) => s + e.count, 0)
  check('카테고리 bytes 합 = totalBytes', catBytesSum === r7.totalBytes)
  check('카테고리 count 합 = 파일 총수(11)', catCountSum === 11 && catCountSum === r7.totalItems)
  // bytes desc 정렬(상위 카테고리 우선).
  check('byCategory bytes desc 정렬', bc.every((e, i, a) => i === 0 || a[i - 1]!.bytes >= e.bytes))
  await fsp.rm(catRoot, { recursive: true, force: true }).catch(() => undefined)

  // ── 정리 ──────────────────────────────────────────────────────────────────
  await fsp.rm(base, { recursive: true, force: true }).catch(() => undefined)
  await fsp.rm(capRoot, { recursive: true, force: true }).catch(() => undefined)
  await fsp.rm(cycleRoot, { recursive: true, force: true }).catch(() => undefined)
  await fsp.rm(cancelRoot, { recursive: true, force: true }).catch(() => undefined)

  line('')
  line(`RESULT: ${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

void main()
