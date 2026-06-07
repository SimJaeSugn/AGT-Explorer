/**
 * verify-fmatrix — P7-D F장 Windows 특수케이스 헤드리스 verify(일회성 검증).
 *
 * `docs/P7-qa-matrix.md` 의 매트릭스 중 **헤드리스로 검증 가능한 로직**만 단언한다.
 * 실 네트워크 드라이브·실 심볼릭 링크(개발자모드/관리자 필요)·실 ACL 거부 폴더는
 * "런타임 필요"로 매트릭스에 분류(여기서 검증 불가 — 위장 금지).
 *
 * 검증 항목:
 *  1) 롱패스(>260) — paths.normalizePath 가 `\\?\` 프리픽스·롱패스 보존, 깊은 중첩(>260자)
 *     실폴더에서 fs:list/fs:stat 가 Result 정상(throw 0).
 *  2) 정션 링크(junction) — fs.symlink(...,'junction')(권한 불요) 생성 후:
 *     · FileSystemService.list 가 링크를 symlink 속성으로 표기.
 *     · scanEngine.runScan 이 링크를 따라가지 않고 skipped++ (재귀 안 함).
 *     · 정션이 조상을 가리키는 순환 구성에서도 realpath 방문 Set 으로 무한루프 없이 종료.
 *  3) UNC/매핑 네트워크 드라이브 판정 — isUncPath / isNetworkDriveRoot / isLikelyRemotePath
 *     (driveTypeService 캐시 동기 주입)로 원격 경로 분류 로직.
 *  4) 권한/미존재 1급 전파 — fs:list/fs:stat 가 ENOENT(존재X)·denied 경로에서 throw 0,
 *     FileOpError 로 전파(실 ACL deny 폴더는 런타임 — 여기선 코드경로만).
 *
 * 실행: esbuild 번들 → node.
 *   esbuild scripts/verify-fmatrix.ts --bundle --platform=node --format=cjs --external:electron \
 *     --alias:@shared=./src/shared --outfile=./out/verify-fmatrix.cjs && node ./out/verify-fmatrix.cjs
 */
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import { join } from 'node:path'
import { fileSystemService } from '../src/main/fs/FileSystemService'
import { normalizePath, isUncPath, isNetworkDriveRoot, isLikelyRemotePath } from '../src/main/fs/paths'
import { runScan } from '../src/main/operations/scanEngine'
import type { ScanHooks } from '../src/main/operations/scanEngine'
import { driveTypeService } from '../src/main/os/driveType'

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

const noopHooks: ScanHooks = {
  onProgress: () => undefined,
  shouldCancel: () => false
}

async function main(): Promise<void> {
  const base = await fsp.mkdtemp(join(os.tmpdir(), 'explorer-fmatrix-'))
  line(`임시 루트: ${base}`)

  // ── 1) 롱패스(>260자) ────────────────────────────────────────────────
  line('== 1) 롱패스(>260자, \\\\?\\ 보존·throw 0) ==')

  // (a) normalizePath 가 \\?\ 롱패스 프리픽스를 보존.
  const longPrefixed = normalizePath('\\\\?\\C:\\very\\deep\\path')
  check('normalizePath: \\\\?\\ 롱패스 프리픽스 보존(ok)', longPrefixed.ok)
  check('normalizePath: \\\\?\\ 경로 절대로 인식(차단 안 함)', longPrefixed.ok && longPrefixed.path.startsWith('\\\\?\\'))
  // (b) \\?\UNC\ 롱패스 UNC 도 보존.
  const longUnc = normalizePath('\\\\?\\UNC\\server\\share\\dir')
  check('normalizePath: \\\\?\\UNC\\ 롱패스 UNC 보존(ok)', longUnc.ok)

  // (c) 실제 >260자 중첩 디렉토리에서 list/stat throw 0(롱패스 지원 환경 가정).
  let deep = base
  const seg = 'segment_0123456789abcdef'
  while (deep.length < 300) deep = join(deep, seg)
  let longPathCreated = false
  try {
    await fsp.mkdir(deep, { recursive: true })
    await fsp.writeFile(join(deep, 'leaf.txt'), 'long path leaf')
    longPathCreated = true
  } catch (e) {
    line(`  NOTE  롱패스 폴더 생성 실패(${(e as { code?: string }).code}) — OS 롱패스 미지원 환경. 코드경로(normalizePath) 만 검증.`)
  }
  line(`  롱패스 길이=${deep.length} 생성=${longPathCreated}`)
  if (longPathCreated) {
    let threw = false
    let listRes
    try {
      listRes = await fileSystemService.list(deep, true)
    } catch {
      threw = true
    }
    check('롱패스 list throw 0(격리)', !threw)
    check('롱패스 list Result.ok & leaf.txt 포함', !!listRes && listRes.ok && listRes.value.entries.some((e) => e.name === 'leaf.txt'))
    let statThrew = false
    let statRes
    try {
      statRes = await fileSystemService.stat(join(deep, 'leaf.txt'))
    } catch {
      statThrew = true
    }
    check('롱패스 stat throw 0', !statThrew)
    check('롱패스 stat Result.ok & isDir=false', !!statRes && statRes.ok && !statRes.value.isDir)
  }

  // ── 2) 정션 링크(junction) — 권한 불요, 추적 안 함·순환 격리 ──────────────
  line('== 2) 정션 링크(junction, 추적 안 함·순환 realpath Set 격리) ==')
  const realDir = join(base, 'realtarget')
  await fsp.mkdir(realDir, { recursive: true })
  await fsp.writeFile(join(realDir, 'inside.bin'), Buffer.alloc(2048, 7))

  const jxHost = join(base, 'jxhost')
  await fsp.mkdir(jxHost, { recursive: true })
  const jxLink = join(jxHost, 'link_to_real')
  let junctionMade = false
  try {
    await fsp.symlink(realDir, jxLink, 'junction')
    junctionMade = true
  } catch (e) {
    line(`  NOTE  정션 생성 실패(${(e as { code?: string }).code}) — 권한/환경. 정션 케이스 스킵(런타임 분류).`)
  }

  if (junctionMade) {
    // (a) FileSystemService.list 가 정션을 symlink 속성으로 표기.
    const hostList = await fileSystemService.list(jxHost, true)
    check('정션: list(host) Result.ok', hostList.ok)
    if (hostList.ok) {
      const linkEntry = hostList.value.entries.find((e) => e.name === 'link_to_real')
      check('정션: 링크 항목 발견', !!linkEntry)
      check('정션: 링크 attrs.symlink=true(추적 대상 표기)', !!linkEntry && linkEntry.attrs.symlink === true)
    }

    // (b) scanEngine: 링크 추적 안 함 → 정션 내부(inside.bin)는 합계 미포함·skipped++.
    //     host 스캔 시 link_to_real 은 symlink 라 재귀 안 함 → totalBytes 에 inside.bin(2048) 미포함.
    const scanHost = await runScan(jxHost, noopHooks)
    check('정션: scan(host) 링크 미추적 → skipped≥1', scanHost.skipped >= 1)
    check('정션: scan(host) totalBytes 에 링크 내부 미포함(추적 안 함)', scanHost.totalBytes < 2048)

    // (c) 순환: 정션이 자신을 담은 조상을 가리키는 구성 → realpath 방문 Set 으로 무한루프 없이 종료.
    const cycleRoot = join(base, 'cycleroot')
    await fsp.mkdir(join(cycleRoot, 'sub'), { recursive: true })
    await fsp.writeFile(join(cycleRoot, 'sub', 'data.bin'), Buffer.alloc(512, 3))
    // cycleRoot/sub/loop → cycleRoot (조상 가리킴). 단 링크라 scanEngine 은 따라가지 않으나,
    // realpath 방문 Set 은 동일 실디렉토리 재방문(예: 다른 경로로 같은 폴더)도 격리한다.
    let cycleMade = false
    try {
      await fsp.symlink(cycleRoot, join(cycleRoot, 'sub', 'loop'), 'junction')
      cycleMade = true
    } catch {
      /* 권한 실패 시 스킵 */
    }
    if (cycleMade) {
      let scanThrew = false
      let scanCycle
      const t0 = Date.now()
      try {
        scanCycle = await runScan(cycleRoot, noopHooks)
      } catch {
        scanThrew = true
      }
      const dt = Date.now() - t0
      check('순환 정션: scan throw 0(무한루프 없이 종료)', !scanThrew)
      check('순환 정션: 합리적 시간 내 종료(<5s, 무한루프 아님)', dt < 5000)
      check('순환 정션: 링크 미추적으로 skipped≥1', !!scanCycle && scanCycle.skipped >= 1)
      check('순환 정션: 정상 항목(data.bin 512) 합계 반영', !!scanCycle && scanCycle.totalBytes >= 512)
    }
  }

  // ── 3) UNC / 매핑 네트워크 드라이브 판정(원격 분류) ────────────────────────
  line('== 3) UNC / 매핑 네트워크 드라이브 판정(isUncPath·isNetworkDriveRoot·isLikelyRemotePath) ==')
  check('UNC \\\\server\\share → isUncPath true', isUncPath('\\\\server\\share\\dir'))
  check('롱패스 UNC \\\\?\\UNC\\srv\\sh → isUncPath true', isUncPath('\\\\?\\UNC\\srv\\sh'))
  check('롱패스 디바이스 \\\\?\\C:\\ → isUncPath false(원격 아님)', !isUncPath('\\\\?\\C:\\dir'))
  check('로컬 C:\\ → isUncPath false', !isUncPath('C:\\Users'))
  check('UNC → isLikelyRemotePath true(eager 폴링 대상)', isLikelyRemotePath('\\\\nas\\media'))

  // 매핑 드라이브: driveTypeService 캐시 동기 주입(PowerShell 미경유) → 동기 판정.
  driveTypeService.setNetworkDriveLetters(['Z'])
  check('매핑 Z:\\ (캐시 주입) → isNetworkDriveRoot true', isNetworkDriveRoot('Z:\\share'))
  check('매핑 z:\\(소문자) → true(대소문자 무시)', isNetworkDriveRoot('z:\\share'))
  check('로컬 C:\\ → isNetworkDriveRoot false(미등록)', !isNetworkDriveRoot('C:\\Users'))
  check('매핑 Z:\\ → isLikelyRemotePath true(eager)', isLikelyRemotePath('Z:\\share'))
  // 폴백(빈 캐시): 매핑은 false(회귀 0: UNC 만 eager), UNC 는 유지.
  driveTypeService.setNetworkDriveLetters([])
  check('빈 캐시(폴백): 매핑 Z:\\ → false(reactive 의존)', !isNetworkDriveRoot('Z:\\share'))
  check('빈 캐시에도 UNC eager 유지(이중 안전)', isLikelyRemotePath('\\\\nas\\m'))
  line('  NOTE  실 UNC 공유·실 매핑 드라이브 동작(폴링 전환·감시)은 환경 의존 → 런타임 매트릭스(P7-qa-matrix.md).')

  // ── 4) 권한거부 / 미존재 1급 전파(throw 0) ───────────────────────────────
  line('== 4) 권한거부/미존재 1급 전파(throw 0, FileOpError) ==')
  // (a) 미존재 경로 → ENOENT Result(throw 0).
  let mThrew = false
  let mRes
  try {
    mRes = await fileSystemService.list(join(base, '__no_such_dir_zzz__'), false)
  } catch {
    mThrew = true
  }
  check('미존재 list throw 0', !mThrew)
  check('미존재 list Result.err(ENOENT)', !!mRes && !mRes.ok && mRes.error.code === 'ENOENT')
  // (b) 파일을 디렉토리로 list → ENOTDIR Result(throw 0).
  const aFile = join(base, 'file.txt')
  await fsp.writeFile(aFile, 'x')
  let nThrew = false
  let nRes
  try {
    nRes = await fileSystemService.list(aFile, false)
  } catch {
    nThrew = true
  }
  check('파일을 list → throw 0', !nThrew)
  check('파일을 list → Result.err(ENOTDIR)', !!nRes && !nRes.ok && nRes.error.code === 'ENOTDIR')
  // (c) stat 미존재 → ENOENT Result.
  const sRes = await fileSystemService.stat(join(base, '__missing__'))
  check('미존재 stat → Result.err(ENOENT)', !sRes.ok && sRes.error.code === 'ENOENT')
  line('  NOTE  실 ACL deny 폴더(EACCES)는 ACL 조작 권한 필요 → 런타임 매트릭스. 여기선 ENOENT/ENOTDIR 코드경로로 1급 전파 패턴 검증.')

  // ── 정리 ────────────────────────────────────────────────────────────────
  await fsp.rm(base, { recursive: true, force: true }).catch(() => undefined)
  driveTypeService.setNetworkDriveLetters([])
  line('')
  line(`RESULT: ${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

void main()
