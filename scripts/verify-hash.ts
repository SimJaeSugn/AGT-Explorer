/**
 * M7 W1 해시 엔진 실증 스크립트(헤드리스, 일회성 검증).
 *
 * 환경 비의존 순수 엔진을 메인 스레드에서 직접 호출(워커 없이)하여 검증한다.
 * fs/crypto 결합은 (a) 실 임시파일 + node:crypto, (b) 메모리 스텁 deps 두 방식으로 주입.
 *
 *   hashEngine  : 동일내용=같은해시·다른내용=다른해시·청크경계(>1MB)·취소(null)·읽기실패(null·throw0)
 *   dupEngine   : 유일크기 해시0(호출카운트)·같은크기 다른내용 분리·2+만 그룹·minSize·item cap truncated
 *   compareEngine: 메타 4상태(M6 동치)·useHash 같은크기만 해시·다른크기 해시회피·재귀 relPath·순환차단·취소
 *   verifyEngine: 일치/hash-mismatch/size-mismatch/read-error·verified 합·취소
 *
 * 실행: esbuild 번들(--external:electron — 엔진은 electron 미의존이나 형식 통일) 후 node.
 */
import { createHash } from 'node:crypto'
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import { join } from 'node:path'
import type { FileEntryDTO, HashAlgo } from '../src/shared/dto'
import {
  hashFile,
  HASH_CHUNK_BYTES
} from '../src/main/hash/hashEngine'
import type { ChunkReader, HashDigest, HashEngineDeps, HashHooks } from '../src/main/hash/hashEngine'
import { findDuplicates } from '../src/main/hash/dupEngine'
import type { DupEngineDeps, DupFileMeta } from '../src/main/hash/dupEngine'
import { runCompare } from '../src/main/hash/compareEngine'
import type { CompareEngineDeps } from '../src/main/hash/compareEngine'
import { verifyPairs } from '../src/main/hash/verifyEngine'
import type { VerifyEngineDeps } from '../src/main/hash/verifyEngine'

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

const noopHooks: HashHooks = { onProgress: () => undefined, shouldCancel: () => false }

// ── 메모리 스텁 deps (파일 내용을 Map 으로 주입) ──────────────────────────
function memHashDeps(files: Map<string, Uint8Array>): HashEngineDeps {
  return {
    async openReader(path: string): Promise<ChunkReader> {
      const data = files.get(path)
      if (!data) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      let pos = 0
      return {
        async read(buf: Uint8Array): Promise<number> {
          if (pos >= data.length) return 0
          const n = Math.min(buf.length, data.length - pos)
          buf.set(data.subarray(pos, pos + n), 0)
          pos += n
          return n
        },
        async close(): Promise<void> {
          /* noop */
        }
      }
    },
    createDigest(algo: HashAlgo): HashDigest {
      const h = createHash(algo)
      return { update: (c) => h.update(c), digestHex: () => h.digest('hex') }
    }
  }
}

const memHashFile =
  (files: Map<string, Uint8Array>) =>
  (path: string, algo: HashAlgo, hooks: HashHooks): Promise<string | null> =>
    hashFile(path, algo, hooks, memHashDeps(files))

// ── 실 임시파일 deps (node:fs + node:crypto) ──────────────────────────────
function realHashDeps(): HashEngineDeps {
  return {
    async openReader(path: string): Promise<ChunkReader> {
      const handle = await fsp.open(path, 'r')
      return {
        async read(buf: Uint8Array): Promise<number> {
          const { bytesRead } = await handle.read(buf, 0, buf.length, null)
          return bytesRead
        },
        async close(): Promise<void> {
          await handle.close()
        }
      }
    },
    createDigest(algo: HashAlgo): HashDigest {
      const h = createHash(algo)
      return { update: (c) => h.update(c), digestHex: () => h.digest('hex') }
    }
  }
}

function entry(name: string, isDir: boolean, size: number, mtime: number, path: string): FileEntryDTO {
  return {
    name,
    path,
    isDir,
    size,
    mtime,
    ctime: mtime,
    ext: isDir ? '' : name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '',
    attrs: { hidden: false, readonly: false, system: false, symlink: false }
  }
}

async function main(): Promise<void> {
  const algo: HashAlgo = 'sha256'

  // ════ 1) hashEngine ════════════════════════════════════════════════════
  line('== 1) hashEngine ==')
  const files = new Map<string, Uint8Array>()
  files.set('/a', new Uint8Array([1, 2, 3, 4]))
  files.set('/b', new Uint8Array([1, 2, 3, 4])) // a 와 동일 내용
  files.set('/c', new Uint8Array([9, 9, 9, 9])) // 다른 내용
  const hd = memHashDeps(files)
  const ha = await hashFile('/a', algo, noopHooks, hd)
  const hb = await hashFile('/b', algo, noopHooks, hd)
  const hc = await hashFile('/c', algo, noopHooks, hd)
  // 정답값(node:crypto 직접 계산).
  const expectA = createHash('sha256').update(Buffer.from([1, 2, 3, 4])).digest('hex')
  check('동일내용 같은해시', ha === hb)
  check('다른내용 다른해시', ha !== hc)
  check('해시값 결정성(node:crypto 일치)', ha === expectA)

  // 청크 경계(>1MB) — 실 임시파일.
  const base = await fsp.mkdtemp(join(os.tmpdir(), 'explorer-hash-'))
  const bigPath = join(base, 'big.bin')
  const bigBuf = Buffer.alloc(HASH_CHUNK_BYTES * 2 + 123, 7) // 2청크 + 잔여
  await fsp.writeFile(bigPath, bigBuf)
  const realDeps = realHashDeps()
  const bigHash = await hashFile(bigPath, algo, noopHooks, realDeps)
  const expectBig = createHash('sha256').update(bigBuf).digest('hex')
  check('청크 경계(>1MB) 스트리밍 해시 정확', bigHash === expectBig)

  // 취소 → null.
  const cancelHooks: HashHooks = { onProgress: () => undefined, shouldCancel: () => true }
  const canceled = await hashFile('/a', algo, cancelHooks, hd)
  check('취소 시 null(부분 다이제스트 폐기)', canceled === null)

  // 읽기 실패 → null(throw 0).
  let threw = false
  let missing: string | null = 'x'
  try {
    missing = await hashFile('/does-not-exist', algo, noopHooks, hd)
  } catch {
    threw = true
  }
  check('읽기 실패 throw 0', !threw)
  check('읽기 실패 null', missing === null)

  // ════ 2) dupEngine ════════════════════════════════════════════════════
  line('== 2) dupEngine ==')
  // 파일: 같은 크기(4) 동일 내용 a/b(중복), 같은 크기(4) 다른 내용 c(분리),
  //       유일 크기(5) d(해시 0 검증), 작은 0바이트 e(minSize 필터).
  const dupFiles = new Map<string, Uint8Array>()
  dupFiles.set('/d1/a', new Uint8Array([1, 1, 1, 1]))
  dupFiles.set('/d1/b', new Uint8Array([1, 1, 1, 1])) // a 와 동일(중복)
  dupFiles.set('/d1/c', new Uint8Array([2, 2, 2, 2])) // 같은 크기, 다른 내용
  dupFiles.set('/d1/d', new Uint8Array([3, 3, 3, 3, 3])) // 유일 크기 5
  dupFiles.set('/d1/e', new Uint8Array([])) // 0바이트
  const dupMetas: DupFileMeta[] = [
    { path: '/d1/a', name: 'a', size: 4, mtime: 100 },
    { path: '/d1/b', name: 'b', size: 4, mtime: 200 },
    { path: '/d1/c', name: 'c', size: 4, mtime: 300 },
    { path: '/d1/d', name: 'd', size: 5, mtime: 400 },
    { path: '/d1/e', name: 'e', size: 0, mtime: 500 }
  ]
  let hashCallCount = 0
  const dupDeps: DupEngineDeps = {
    async enumerate(_roots, minSize) {
      return { files: dupMetas.filter((m) => m.size >= minSize), truncated: false }
    },
    hashFile: (path, a, hooks) => {
      hashCallCount++
      return memHashFile(dupFiles)(path, a, hooks)
    }
  }
  const dupRes = await findDuplicates(['/d1'], 1, algo, noopHooks, dupDeps)
  check('중복 그룹 1개(a,b)', dupRes.groups.length === 1)
  check('그룹 파일 2개', dupRes.groups[0]?.files.length === 2)
  check('그룹 크기 4', dupRes.groups[0]?.size === 4)
  check('그룹 파일 a,b 포함', !!dupRes.groups[0]?.files.some((f) => f.name === 'a') && !!dupRes.groups[0]?.files.some((f) => f.name === 'b'))
  // 유일 크기(d,5)는 해시 0 — minSize=1 로 e 제외(0바이트). 같은크기(4) a/b/c 3개만 해시.
  check('유일 크기 해시 회피(해시 호출=같은크기 3건만)', hashCallCount === 3)
  check('minSize=1 → 0바이트 e 제외', dupMetas.filter((m) => m.size >= 1).length === 4)

  // minSize 필터 — minSize=5 면 a/b/c(4) 제외 → 중복 0.
  hashCallCount = 0
  const dupRes2 = await findDuplicates(['/d1'], 5, algo, noopHooks, dupDeps)
  check('minSize=5 → 중복 그룹 0', dupRes2.groups.length === 0)
  check('minSize=5 → 유일크기 d만 남아 해시 0', hashCallCount === 0)

  // item cap truncated 전파.
  const dupDepsTrunc: DupEngineDeps = {
    async enumerate() {
      return { files: dupMetas, truncated: true }
    },
    hashFile: memHashFile(dupFiles)
  }
  const dupRes3 = await findDuplicates(['/d1'], 0, algo, noopHooks, dupDepsTrunc)
  check('enumerate truncated 전파', dupRes3.truncated === true)

  // dup 취소(enumerate 후 취소) → 빈 그룹.
  const dupCancel = await findDuplicates(['/d1'], 1, algo, cancelHooks, dupDeps)
  check('dup 취소 시 빈 그룹', dupCancel.groups.length === 0)

  // ════ 3) compareEngine ═════════════════════════════════════════════════
  line('== 3) compareEngine ==')
  // 좌: same.txt(4,t100), diffsize.txt(4,t100), onlyL.txt; sub/(폴더)
  // 우: same.txt(4,t100), diffsize.txt(8,t100), onlyR.txt; sub/(폴더)
  const cmpFiles = new Map<string, Uint8Array>()
  cmpFiles.set('/L/same.txt', new Uint8Array([1, 2, 3, 4]))
  cmpFiles.set('/R/same.txt', new Uint8Array([1, 2, 3, 4])) // 같은 크기·같은 내용
  cmpFiles.set('/L/hashdiff.txt', new Uint8Array([1, 2, 3, 4]))
  cmpFiles.set('/R/hashdiff.txt', new Uint8Array([9, 9, 9, 9])) // 같은 크기·다른 내용
  cmpFiles.set('/L/diffsize.txt', new Uint8Array([1, 2, 3, 4]))
  cmpFiles.set('/R/diffsize.txt', new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])) // 다른 크기
  cmpFiles.set('/L/onlyL.txt', new Uint8Array([0]))
  cmpFiles.set('/R/onlyR.txt', new Uint8Array([0]))
  cmpFiles.set('/L/sub/x.txt', new Uint8Array([1, 1]))
  cmpFiles.set('/R/sub/x.txt', new Uint8Array([2, 2])) // 재귀 내부 같은크기 다른내용

  const dirContents: Record<string, FileEntryDTO[]> = {
    '/L': [
      entry('same.txt', false, 4, 100, '/L/same.txt'),
      entry('hashdiff.txt', false, 4, 100, '/L/hashdiff.txt'),
      entry('diffsize.txt', false, 4, 100, '/L/diffsize.txt'),
      entry('onlyL.txt', false, 1, 100, '/L/onlyL.txt'),
      entry('sub', true, 0, 100, '/L/sub')
    ],
    '/R': [
      entry('same.txt', false, 4, 100, '/R/same.txt'),
      entry('hashdiff.txt', false, 4, 100, '/R/hashdiff.txt'),
      entry('diffsize.txt', false, 8, 100, '/R/diffsize.txt'),
      entry('onlyR.txt', false, 1, 100, '/R/onlyR.txt'),
      entry('sub', true, 0, 100, '/R/sub')
    ],
    '/L/sub': [entry('x.txt', false, 2, 100, '/L/sub/x.txt')],
    '/R/sub': [entry('x.txt', false, 2, 100, '/R/sub/x.txt')]
  }
  let cmpHashCalls = 0
  const cmpDeps: CompareEngineDeps = {
    async listDir(dir) {
      return dirContents[dir] ?? []
    },
    hashFile: (path, a, hooks) => {
      cmpHashCalls++
      return memHashFile(cmpFiles)(path, a, hooks)
    },
    async realpath(dir) {
      return dir
    }
  }

  // 3a) 메타 전용(useHash=false, recursive=false) — M6 동치.
  const cmpMeta = await runCompare(
    { leftDir: '/L', rightDir: '/R', useHash: false, recursive: false, algo },
    noopHooks,
    cmpDeps
  )
  const byName = (n: string): string | undefined => cmpMeta.pairs.find((p) => p.name === n)?.status
  check('메타: same.txt = same', byName('same.txt') === 'same')
  check('메타: hashdiff.txt = same(메타동일·해시 안봄)', byName('hashdiff.txt') === 'same')
  check('메타: diffsize.txt = diff(크기 다름)', byName('diffsize.txt') === 'diff')
  check('메타: onlyL.txt = left-only', byName('onlyL.txt') === 'left-only')
  check('메타: onlyR.txt = right-only', byName('onlyR.txt') === 'right-only')
  check('메타: sub 폴더 = same(단일깊이)', byName('sub') === 'same')
  check('메타: 해시 호출 0(해시 회피)', cmpHashCalls === 0)
  check('메타: usedHash=false·recursive=false', cmpMeta.usedHash === false && cmpMeta.recursive === false)
  check('메타: summary 합 = total', cmpMeta.summary.total === cmpMeta.pairs.length)

  // 3b) 해시 옵션(useHash=true) — 같은 크기만 해시, 다른 크기는 해시 회피.
  cmpHashCalls = 0
  const cmpHash = await runCompare(
    { leftDir: '/L', rightDir: '/R', useHash: true, recursive: false, algo },
    noopHooks,
    cmpDeps
  )
  const byNameH = (n: string): string | undefined => cmpHash.pairs.find((p) => p.name === n)?.status
  check('해시: same.txt = same(내용동일)', byNameH('same.txt') === 'same')
  check('해시: hashdiff.txt = diff(같은크기 다른내용)', byNameH('hashdiff.txt') === 'diff')
  check('해시: diffsize.txt = diff(크기 다름·해시회피)', byNameH('diffsize.txt') === 'diff')
  // same.txt(2개) + hashdiff.txt(2개) = 4회. diffsize 는 크기 달라 회피.
  check('해시: 같은크기 쌍만 해시(4회)', cmpHashCalls === 4)
  check('해시: usedHash=true', cmpHash.usedHash === true)

  // 3c) 재귀(recursive=true) — sub/ 내부 진입·relPath 누적.
  cmpHashCalls = 0
  const cmpRec = await runCompare(
    { leftDir: '/L', rightDir: '/R', useHash: true, recursive: true, algo },
    noopHooks,
    cmpDeps
  )
  const subPair = cmpRec.pairs.find((p) => p.name === 'sub/x.txt')
  check('재귀: sub/x.txt 페어 존재(relPath 누적)', !!subPair)
  check('재귀: sub/x.txt = diff(같은크기 다른내용)', subPair?.status === 'diff')
  check('재귀: recursive=true', cmpRec.recursive === true)

  // 3d) 순환차단 — realpath 가 동일값 반환하면 재방문 skip(무한루프 없음).
  const loopDeps: CompareEngineDeps = {
    async listDir(dir) {
      // /L, /R 둘 다 자기 자신을 포함하는 sub 디렉토리(순환).
      if (dir === '/L') return [entry('loop', true, 0, 100, '/L')]
      if (dir === '/R') return [entry('loop', true, 0, 100, '/R')]
      return []
    },
    hashFile: memHashFile(cmpFiles),
    async realpath(dir) {
      return dir // loop 의 path 가 /L, /R 로 동일 → 재방문 차단.
    }
  }
  let loopThrew = false
  try {
    await runCompare(
      { leftDir: '/L', rightDir: '/R', useHash: false, recursive: true, algo },
      noopHooks,
      loopDeps
    )
    check('순환: 무한루프 없이 종료', true)
  } catch {
    loopThrew = true
  }
  check('순환: throw 0', !loopThrew)

  // 3e) 취소 — 부분 결과(취소면 pairs 가 전체보다 적거나 같음, throw 0).
  let cmpCancelThrew = false
  try {
    const cmpCancel = await runCompare(
      { leftDir: '/L', rightDir: '/R', useHash: false, recursive: false, algo },
      cancelHooks,
      cmpDeps
    )
    check('취소: 부분결과(전체 페어 미만)', cmpCancel.pairs.length < cmpMeta.pairs.length)
  } catch {
    cmpCancelThrew = true
  }
  check('취소: throw 0', !cmpCancelThrew)

  // ════ 4) verifyEngine ═════════════════════════════════════════════════
  line('== 4) verifyEngine ==')
  const vFiles = new Map<string, Uint8Array>()
  vFiles.set('/v/src1', new Uint8Array([1, 2, 3]))
  vFiles.set('/v/dst1', new Uint8Array([1, 2, 3])) // 일치
  vFiles.set('/v/src2', new Uint8Array([1, 2, 3]))
  vFiles.set('/v/dst2', new Uint8Array([9, 2, 3])) // 같은 크기 다른 내용(hash-mismatch)
  vFiles.set('/v/src3', new Uint8Array([1, 2, 3]))
  vFiles.set('/v/dst3', new Uint8Array([1, 2])) // 크기 다름(size-mismatch)
  vFiles.set('/v/src4', new Uint8Array([1, 2, 3]))
  // dst4 없음 → read-error
  const sizes: Record<string, number> = {
    '/v/src1': 3,
    '/v/dst1': 3,
    '/v/src2': 3,
    '/v/dst2': 3,
    '/v/src3': 3,
    '/v/dst3': 2,
    '/v/src4': 3
  }
  const vDeps: VerifyEngineDeps = {
    async statSize(path) {
      return sizes[path] ?? null
    },
    hashFile: memHashFile(vFiles)
  }
  const vRes = await verifyPairs(
    [
      { src: '/v/src1', dst: '/v/dst1' },
      { src: '/v/src2', dst: '/v/dst2' },
      { src: '/v/src3', dst: '/v/dst3' },
      { src: '/v/src4', dst: '/v/dst4' }
    ],
    algo,
    noopHooks,
    vDeps
  )
  check('verify: verified=1(일치 1건)', vRes.verified === 1)
  check('verify: 불일치 3건', vRes.mismatches.length === 3)
  check('verify: hash-mismatch 1건', vRes.mismatches.filter((m) => m.reason === 'hash-mismatch').length === 1)
  check('verify: size-mismatch 1건', vRes.mismatches.filter((m) => m.reason === 'size-mismatch').length === 1)
  check('verify: read-error 1건', vRes.mismatches.filter((m) => m.reason === 'read-error').length === 1)
  check('verify: canceled=false', vRes.canceled === false)

  // verify 취소.
  const vCancel = await verifyPairs([{ src: '/v/src1', dst: '/v/dst1' }], algo, cancelHooks, vDeps)
  check('verify: 취소 시 canceled=true', vCancel.canceled === true)
  check('verify: 취소 시 verified=0', vCancel.verified === 0)

  // ── 정리 ──────────────────────────────────────────────────────────────
  await fsp.rm(base, { recursive: true, force: true }).catch(() => undefined)

  line('')
  line(`RESULT: ${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

void main()
