/**
 * shell:open-terminal(H4) · shell:icon(H6) 경로검증·캐시 로직 실증(헤드리스, 일회성).
 *
 * 실제 wt.exe/PowerShell 실행, app.getFileIcon 네이티브 추출은 GUI/네이티브라
 * 헤드리스로 검증 불가하므로:
 *   - open-terminal: 핸들러의 보안 게이트(sender 제외)만 복제 실증 —
 *       파일경로→ENOTDIR · 미존재→ENOENT · `..`이탈→ESECURITY · 정상디렉토리→openTerminal 호출.
 *   - icon: cacheKeyFor 키 환원(per-file vs ext vs 합성키) · LRU(512) ·
 *       실패(예외·빈 이미지) 비캐싱 · 키 공유로 추출 1회.
 *
 * electron 은 stub-electron-icon 으로 alias(app.getFileIcon 제어). 실행: esbuild 번들 후 node.
 */
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import { join } from 'node:path'
import type { Result } from '../src/shared/ipc/contracts'
import { err, ok } from '../src/shared/ipc/contracts'
import { fileOpError, toFileOpError } from '../src/main/fs/errors'
import { cacheKeyFor, getFileIconDataUrl, iconCacheSize } from '../src/main/os/icon'
import { guardPath, parseArgs, zShellOpenTerminalReq } from '../src/main/ipc/guard'
// electron alias → 페이크 app.getFileIcon 제어 헬퍼.
import { __getIconCalls, __resetIcon, __setIconBehavior } from 'electron'

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

/** 핸들러 shell:open-terminal 의 검증 시퀀스 그대로(IPC/sender 래퍼 제외). openTerminal 은 스파이. */
async function runOpenTerminal(
  raw: unknown,
  openTerminalSpy: (dir: string) => Promise<{ errorMessage: string }>
): Promise<Result<void>> {
  const parsed = parseArgs(zShellOpenTerminalReq, raw)
  if (!parsed.ok) return parsed as Result<void>

  const g = guardPath(parsed.value.cwd)
  if (!g.ok) return g as Result<void>
  const cwd = g.value

  try {
    const st = await fsp.stat(cwd)
    if (!st.isDirectory()) return err(fileOpError('ENOTDIR', '폴더가 아닙니다.', cwd))
  } catch (e) {
    const fe = toFileOpError(e, cwd)
    return err(fe.code === 'EUNKNOWN' ? fileOpError('ENOENT', '대상을 찾을 수 없습니다.', cwd) : fe)
  }

  const r = await openTerminalSpy(cwd)
  if (r.errorMessage) {
    return err(fileOpError('EUNKNOWN', `터미널을 열 수 없습니다: ${r.errorMessage}`, cwd))
  }
  return ok(undefined)
}

async function main(): Promise<void> {
  const base = await fsp.mkdtemp(join(os.tmpdir(), 'explorer-h4h6-'))
  const subdir = join(base, 'work')
  await fsp.mkdir(subdir)
  const file = join(base, 'doc.txt')
  await fsp.writeFile(file, 'hi', 'utf8')

  // ════ H4: open-terminal ════════════════════════════════════════════
  let called = 0
  let lastDir = ''
  const spy = async (dir: string): Promise<{ errorMessage: string }> => {
    called++
    lastDir = dir
    return { errorMessage: '' }
  }

  // 잘못된 인자 → EINVAL.
  const rBad = await runOpenTerminal({ cwd: 123 }, spy)
  check('[H4] cwd 비문자열 → EINVAL', !rBad.ok && rBad.error.code === 'EINVAL')
  const rEmpty = await runOpenTerminal({}, spy)
  check('[H4] cwd 누락 → EINVAL', !rEmpty.ok && rEmpty.error.code === 'EINVAL')

  // `..` 상위이탈 → ESECURITY.
  const rTraverse = await runOpenTerminal({ cwd: '..\\..\\evil' }, spy)
  check('[H4] `..` 상위이탈 → ESECURITY', !rTraverse.ok && rTraverse.error.code === 'ESECURITY')

  // 파일 경로 → ENOTDIR(stat 디렉토리 검증).
  const rFile = await runOpenTerminal({ cwd: file }, spy)
  check('[H4] 파일 경로 → ENOTDIR', !rFile.ok && rFile.error.code === 'ENOTDIR')

  // 미존재 경로 → ENOENT.
  const rMissing = await runOpenTerminal({ cwd: join(base, 'nope') }, spy)
  check('[H4] 미존재 경로 → ENOENT', !rMissing.ok && rMissing.error.code === 'ENOENT')

  check('[H4] 검증 실패는 openTerminal 미호출', called === 0)

  // 정상 디렉토리 → openTerminal 1회 호출 + ok.
  const rOk = await runOpenTerminal({ cwd: subdir }, spy)
  check('[H4] 정상 디렉토리 → ok=true', rOk.ok)
  check('[H4] 정상 디렉토리 → openTerminal 1회 + cwd 정확', called === 1 && lastDir === subdir)

  // OS 실행 실패 → EUNKNOWN 전파.
  const failSpy = async (): Promise<{ errorMessage: string }> => ({ errorMessage: 'spawn 실패' })
  const rFail = await runOpenTerminal({ cwd: subdir }, failSpy)
  check('[H4] OS 실행 실패 → EUNKNOWN', !rFail.ok && rFail.error.code === 'EUNKNOWN')

  // ════ H6: icon cacheKeyFor 키 환원 ════════════════════════════════
  check('[H6] __dir__ → __dir__ 키', cacheKeyFor({ path: 'C:\\any', ext: '__dir__' }) === '__dir__')
  check('[H6] __drive__ → __drive__ 키', cacheKeyFor({ path: 'C:\\', ext: '__drive__' }) === '__drive__')
  check('[H6] 일반 ext(.txt) → ext:txt', cacheKeyFor({ path: 'C:\\a\\b.TXT' }) === 'ext:txt')
  check('[H6] per-file(.exe) → path:<path>', cacheKeyFor({ path: 'C:\\a\\app.exe' }) === 'path:C:\\a\\app.exe')
  check('[H6] per-file(.lnk) → path:<path>', cacheKeyFor({ path: 'C:\\a\\s.lnk' }) === 'path:C:\\a\\s.lnk')
  check('[H6] 확장자 없음 → ext: 빈키', cacheKeyFor({ path: 'C:\\a\\README' }) === 'ext:')

  // ── 추출 성공 → dataUrl 반환 + 같은 ext 키 공유로 추출 1회만 ──────
  __resetIcon()
  __setIconBehavior('ok')
  const d1 = await getFileIconDataUrl({ path: 'C:\\dir\\a.txt' })
  const d2 = await getFileIconDataUrl({ path: 'C:\\dir\\b.txt' }) // 같은 ext:txt 키
  check('[H6] 추출 성공 → dataUrl 반환', typeof d1 === 'string' && d1!.startsWith('data:image/png'))
  check('[H6] 같은 ext 키 공유 → 캐시 HIT(추출 1회)', __getIconCalls() === 1)
  check('[H6] 같은 ext 키 → 동일 dataUrl 반환', d1 === d2)

  // ── 실패 비캐싱: 빈 이미지·예외는 캐시 미저장 → 재시도 시 다시 추출 ─
  __resetIcon()
  __setIconBehavior('empty')
  const e1 = await getFileIconDataUrl({ path: 'C:\\x\\fail.dat' }) // ext:dat
  check('[H6] 빈 이미지 → null', e1 === null)
  __setIconBehavior('empty')
  await getFileIconDataUrl({ path: 'C:\\x\\fail2.dat' }) // 같은 ext:dat — 캐시 없어 재추출
  check('[H6] 실패 비캐싱 → 재시도 시 재추출(2회)', __getIconCalls() === 2)
  // 이제 성공하면 캐시되어 다음은 HIT.
  __setIconBehavior('ok')
  const e2 = await getFileIconDataUrl({ path: 'C:\\x\\ok.dat' }) // ext:dat 성공
  check('[H6] 실패 후 성공 → 끝내 dataUrl(영구폴백 0)', typeof e2 === 'string' && e2!.length > 0)
  const callsBefore = __getIconCalls()
  await getFileIconDataUrl({ path: 'C:\\x\\ok2.dat' }) // 이제 ext:dat HIT
  check('[H6] 성공 캐시 후 → HIT(추출 증가 없음)', __getIconCalls() === callsBefore)

  __resetIcon()
  __setIconBehavior('throw')
  const t1 = await getFileIconDataUrl({ path: 'C:\\y\\boom.bin' })
  check('[H6] 추출 예외 → null(throw 흡수)', t1 === null)

  // ── LRU 상한(512): per-file 키로 600개 채우면 size ≤ 512 ───────────
  __resetIcon()
  __setIconBehavior('ok')
  const sizeBefore = iconCacheSize()
  for (let i = 0; i < 600; i++) {
    await getFileIconDataUrl({ path: `C:\\lru\\f${i}.exe` }) // per-file → path:<path> 고유 키
  }
  check('[H6] LRU 600개 삽입 후 size ≤ 512', iconCacheSize() <= 512)
  check('[H6] LRU evict 동작(상한 압박 반영)', iconCacheSize() <= 512 && iconCacheSize() >= sizeBefore)

  await fsp.rm(base, { recursive: true, force: true }).catch(() => undefined)

  // eslint-disable-next-line no-console
  console.log('')
  // eslint-disable-next-line no-console
  console.log(`RESULT: ${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

void main()
