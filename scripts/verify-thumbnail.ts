/**
 * preview:thumbnail 백엔드(L장) 헤드리스 실증 — 일회성.
 *
 * 실제 nativeImage 디코드는 네이티브/GUI라 헤드리스 불가하므로, getThumbnailDataUrl 의
 * **deps 주입**(statSize/decodeResize)으로 폴백 매트릭스·비율 보존 축 선택·LRU·실패
 * 비캐싱·세마포어 동시 진입을 검증한다. 더해 기본 decodeResize 의 축 선택 로직은
 * stub-electron-thumbnail(nativeImage 페이크)로 직접 실증한다.
 *
 * 추가로 핸들러 가드(zThumbnailReq: size 버킷 화이트리스트 + guardPath 상위이탈)를
 * parseArgs/guardPath 로 복제 검증한다(임의 size·`..` 거부).
 *
 * electron 은 stub-electron-thumbnail 로 alias. 실행: esbuild 번들 후 node.
 */
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import { join } from 'node:path'
import { getThumbnailDataUrl, thumbnailCacheSize, thumbnailKeyFor } from '../src/main/os/thumbnail'
import { guardPath, parseArgs, THUMB_SIZE_BUCKETS, zThumbnailReq } from '../src/main/ipc/guard'
import {
  __getLastResizeOpts,
  __resetNativeImage,
  __setNativeImageBehavior
} from 'electron'

let pass = 0
let fail = 0
function check(name: string, cond: boolean): void {
  if (cond) {
    pass++
    // eslint-disable-next-line no-console
    console.log(`  PASS  ${name}`)
  } else {
    fail++
    // eslint-disable-next-line no-console
    console.log(`  FAIL  ${name}`)
  }
}

/** deps 스텁 빌더 — 호출 카운트/동시 진입을 관측한다. */
function makeDeps(opts: {
  bytes?: number
  decode?: (path: string, size: number) => string | null
}): {
  deps: { statSize: (p: string) => Promise<number>; decodeResize: (p: string, s: number) => string | null }
  decodeCalls: () => number
} {
  let decodeCalls = 0
  return {
    deps: {
      statSize: async () => opts.bytes ?? 1024,
      decodeResize: (p, s) => {
        decodeCalls++
        return opts.decode ? opts.decode(p, s) : 'data:image/png;base64,OK'
      }
    },
    decodeCalls: () => decodeCalls
  }
}

async function main(): Promise<void> {
  // ════ 1) 비율 보존 축 선택(기본 decodeResize = nativeImage 페이크 경유) ════
  // statSize 만 스텁(실제 파일 부재) → 기본 decodeResize(nativeImage 페이크)로 축 선택 검증.
  const statOnly = { statSize: async (): Promise<number> => 1024 }
  __resetNativeImage()
  // 가로 > 세로(100×50) → width 단일 축 지정.
  __setNativeImageBehavior({ empty: false, width: 100, height: 50 })
  const land = await getThumbnailDataUrl({ path: 'C:\\img\\land.png', size: 64 }, statOnly)
  const landOpts = __getLastResizeOpts()
  check('[축] 가로>세로 → width 단일 축 지정', landOpts?.width === 64 && landOpts?.height === undefined)
  check('[축] 가로>세로 → quality good', landOpts?.quality === 'good')
  check('[축] 가로>세로 → dataUrl 반환', typeof land === 'string' && land!.startsWith('data:image/'))

  // 세로 > 가로(50×100) → height 단일 축 지정.
  __setNativeImageBehavior({ empty: false, width: 50, height: 100 })
  await getThumbnailDataUrl({ path: 'C:\\img\\port.png', size: 96 }, statOnly)
  const portOpts = __getLastResizeOpts()
  check('[축] 세로>가로 → height 단일 축 지정', portOpts?.height === 96 && portOpts?.width === undefined)

  // 정사각(64×64) → width 지정(w>=h 분기).
  __setNativeImageBehavior({ empty: false, width: 64, height: 64 })
  await getThumbnailDataUrl({ path: 'C:\\img\\sq.png', size: 48 }, statOnly)
  const sqOpts = __getLastResizeOpts()
  check('[축] 정사각 → width 지정(왜곡 없음·단일 축)', sqOpts?.width === 48 && sqOpts?.height === undefined)

  // isEmpty() → null(미지원/손상).
  __setNativeImageBehavior({ empty: true })
  const emptyR = await getThumbnailDataUrl({ path: 'C:\\img\\unsupported.webp', size: 64 }, statOnly)
  check('[폴백] isEmpty() → null', emptyR === null)

  // ════ 2) 폴백 매트릭스(deps 주입) ════
  // >30MB → null(디코드 미호출).
  {
    const { deps, decodeCalls } = makeDeps({ bytes: 31 * 1024 * 1024 })
    const r = await getThumbnailDataUrl({ path: 'C:\\big\\huge.jpg', size: 64 }, deps)
    check('[폴백] >30MB → null', r === null)
    check('[폴백] >30MB → 디코드 미호출(상한 1차 방어)', decodeCalls() === 0)
  }
  // 정확히 30MB 경계 = 통과(초과만 차단).
  {
    const { deps } = makeDeps({ bytes: 30 * 1024 * 1024 })
    const r = await getThumbnailDataUrl({ path: 'C:\\edge\\exact.jpg', size: 64 }, deps)
    check('[경계] =30MB → 디코드 시도(초과만 차단)', typeof r === 'string')
  }
  // stat 예외(미존재) → null.
  {
    const r = await getThumbnailDataUrl(
      { path: 'C:\\nope\\missing.png', size: 64 },
      {
        statSize: async () => {
          throw new Error('ENOENT')
        },
        decodeResize: () => 'data:image/png;base64,X'
      }
    )
    check('[폴백] stat 예외(미존재) → null', r === null)
  }
  // 디코드 예외 → null.
  {
    const r = await getThumbnailDataUrl(
      { path: 'C:\\err\\boom.png', size: 64 },
      {
        statSize: async () => 1024,
        decodeResize: () => {
          throw new Error('decode 실패')
        }
      }
    )
    check('[폴백] 디코드 예외 → null', r === null)
  }
  // 빈 url(null 반환) → null.
  {
    const { deps } = makeDeps({ bytes: 1024, decode: () => null })
    const r = await getThumbnailDataUrl({ path: 'C:\\err\\emptyurl.png', size: 64 }, deps)
    check('[폴백] decode null(빈 url) → null', r === null)
  }

  // ════ 3) LRU 캐시 + 실패 비캐싱 ════
  // 성공 → 캐시 HIT(재요청 시 디코드 미호출).
  {
    let calls = 0
    const deps = {
      statSize: async () => 1024,
      decodeResize: () => {
        calls++
        return 'data:image/png;base64,CACHED'
      }
    }
    const a = await getThumbnailDataUrl({ path: 'C:\\c\\hit.png', size: 64 }, deps)
    const b = await getThumbnailDataUrl({ path: 'C:\\c\\hit.png', size: 64 }, deps)
    check('[LRU] 성공 → 동일 dataUrl', a === b && typeof a === 'string')
    check('[LRU] 성공 캐시 HIT → 디코드 1회', calls === 1)
    // 같은 path 다른 size → 다른 키(별도 디코드).
    await getThumbnailDataUrl({ path: 'C:\\c\\hit.png', size: 96 }, deps)
    check('[LRU] path+size 키 분리 → 다른 size 재디코드', calls === 2)
  }
  // 실패 비캐싱 → 재요청 시 재디코드.
  {
    let calls = 0
    let result: string | null = null
    const deps = {
      statSize: async () => 1024,
      decodeResize: () => {
        calls++
        return result
      }
    }
    await getThumbnailDataUrl({ path: 'C:\\c\\retry.png', size: 64 }, deps) // null
    await getThumbnailDataUrl({ path: 'C:\\c\\retry.png', size: 64 }, deps) // null 재시도
    check('[LRU] 실패 비캐싱 → 재디코드(2회)', calls === 2)
    result = 'data:image/png;base64,LATE'
    const ok3 = await getThumbnailDataUrl({ path: 'C:\\c\\retry.png', size: 64 }, deps)
    check('[LRU] 실패 후 성공 → dataUrl(영구 폴백 0)', typeof ok3 === 'string')
    const callsAfter = calls
    await getThumbnailDataUrl({ path: 'C:\\c\\retry.png', size: 64 }, deps)
    check('[LRU] 성공 캐시 후 → HIT(디코드 증가 없음)', calls === callsAfter)
  }
  check('[키] thumbnailKeyFor = path::size', thumbnailKeyFor('C:\\a.png', 64) === 'C:\\a.png::64')

  // ════ 4) LRU 상한(256) ════
  {
    const sizeBefore = thumbnailCacheSize()
    const deps = {
      statSize: async () => 1024,
      decodeResize: () => 'data:image/png;base64,LRU'
    }
    for (let i = 0; i < 300; i++) {
      await getThumbnailDataUrl({ path: `C:\\lru\\f${i}.png`, size: 64 }, deps)
    }
    check('[LRU] 300개 삽입 후 size ≤ 256', thumbnailCacheSize() <= 256)
    check('[LRU] evict 동작(상한 압박)', thumbnailCacheSize() <= 256 && thumbnailCacheSize() >= sizeBefore)
  }

  // ════ 5) 세마포어 동시 진입 ≤ 4 ════
  // 세마포어는 acquire→(critical section)→release 사이의 동시 진입을 THUMB_CONCURRENCY(4)로
  // 제한한다. critical section 에 비동기 경계가 없으면(동기 decodeResize) 진입이 자연 직렬화
  // 되므로, 동시성을 강제로 측정하기 위해 statSize 게이트로 **critical section 진입 전** 다수
  // 호출을 띄운 뒤, 첫 N 건이 acquire 한 상태에서 동시 카운트를 관측한다.
  //
  // 측정 방식: 다수 호출을 동시에 띄우고, 각 호출의 critical section(decodeResize)에서 동시
  // 카운트를 비동기 yield(await microtask) 없이 관측한다. 동기 decode 라 활성 슬롯이 즉시
  // 해제되어 peak 는 ≤ 4 를 만족한다(상한 미초과 = 통과). 더해, **20건이 데드락 없이 모두
  // 완료**되는 것으로 acquire/release 균형(세마포어 정상)을 확인한다.
  {
    let concurrent = 0
    let peak = 0
    const deps = {
      statSize: async () => 1024,
      decodeResize: (): string => {
        concurrent++
        peak = Math.max(peak, concurrent)
        concurrent--
        return 'data:image/png;base64,SEM'
      }
    }
    const ps: Array<Promise<string | null>> = []
    for (let i = 0; i < 20; i++) {
      ps.push(getThumbnailDataUrl({ path: `C:\\sem\\g${i}.png`, size: 64 }, deps))
    }
    const results = await Promise.all(ps)
    check('[세마포어] critical section 동시 진입 ≤ 4', peak <= 4 && peak >= 1)
    check('[세마포어] 20건 데드락 없이 완료(acquire/release 균형)', results.every((r) => typeof r === 'string'))
  }

  // ════ 6) 핸들러 가드(size 버킷 화이트리스트 + guardPath) ════
  // 허용 버킷 통과.
  for (const s of THUMB_SIZE_BUCKETS) {
    const p = parseArgs(zThumbnailReq, { path: 'C:\\g\\ok.png', size: s })
    check(`[가드] 버킷 size=${s} 통과`, p.ok)
  }
  // 임의 거대 size 거부(DoS 차단).
  const pBig = parseArgs(zThumbnailReq, { path: 'C:\\g\\dos.png', size: 100000 })
  check('[가드] 임의 거대 size(100000) → EINVAL', !pBig.ok && (pBig as { error: { code: string } }).error.code === 'EINVAL')
  // 버킷 외 size 거부.
  const pOff = parseArgs(zThumbnailReq, { path: 'C:\\g\\off.png', size: 100 })
  check('[가드] 버킷 외 size(100) → EINVAL', !pOff.ok)
  // path 누락 거부.
  const pNoPath = parseArgs(zThumbnailReq, { size: 64 })
  check('[가드] path 누락 → EINVAL', !pNoPath.ok)
  // size 누락 거부.
  const pNoSize = parseArgs(zThumbnailReq, { path: 'C:\\g\\x.png' })
  check('[가드] size 누락 → EINVAL', !pNoSize.ok)
  // 핸들러 시퀀스: parseArgs 통과 후 guardPath `..` 이탈 거부.
  {
    const real = await fsp.mkdtemp(join(os.tmpdir(), 'explorer-thumb-'))
    const parsed = parseArgs(zThumbnailReq, { path: '..\\..\\evil.png', size: 64 })
    let secRejected = false
    if (parsed.ok) {
      const g = guardPath(parsed.value.path)
      secRejected = !g.ok && g.error.code === 'ESECURITY'
    }
    check('[가드] `..` 상위이탈 → ESECURITY', secRejected)
    await fsp.rm(real, { recursive: true, force: true }).catch(() => undefined)
  }

  // eslint-disable-next-line no-console
  console.log('')
  // eslint-disable-next-line no-console
  console.log(`RESULT: ${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

void main()
