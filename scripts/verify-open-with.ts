/**
 * shell:open-with 경로검증 실증(헤드리스, 일회성).
 *
 * 실제 rundll32(OpenAs_RunDLL)은 Windows GUI 대화상자라 헤드리스로 검증 불가하므로,
 * 핸들러의 보안 게이트(ADR-005 — shell:open 과 동일 3중 검증)만 실증한다:
 *   (a) 인자 형태(zShellOpenWithReq) → 잘못된 형태 EINVAL
 *   (b) 경로 정규화·상위이탈(`..`) 차단 → guardPath(ESECURITY/EINVAL)
 *   (c) 대상 존재 확인 → 미존재 ENOENT
 *   (d) 읽기 권한 확인 → EACCES(여기선 정상 경로만 검증)
 * 모든 게이트 통과 시에만 openWith(OS 위임)가 호출됨을 스파이로 확인한다.
 *
 * 핸들러의 검증 시퀀스를 그대로 복제(verify-paste 패턴) — electron(ipcMain) 미의존.
 * 실행: esbuild 번들 후 node.
 */
import { constants as fsConstants } from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import { join } from 'node:path'
import type { Result } from '../src/shared/ipc/contracts'
import { err, ok } from '../src/shared/ipc/contracts'
import { fileOpError, toFileOpError } from '../src/main/fs/errors'
import { guardPath, parseArgs, zShellOpenWithReq } from '../src/main/ipc/guard'

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

/** 핸들러 shell:open-with 의 검증 시퀀스 그대로(IPC/sender 래퍼 제외). openWith 는 스파이. */
async function runOpenWith(
  raw: unknown,
  openWithSpy: (path: string) => Promise<{ errorMessage: string }>
): Promise<Result<void>> {
  const parsed = parseArgs(zShellOpenWithReq, raw)
  if (!parsed.ok) return parsed as Result<void>

  const g = guardPath(parsed.value.path)
  if (!g.ok) return g as Result<void>
  const path = g.value

  try {
    await fsp.access(path, fsConstants.F_OK)
  } catch (e) {
    const fe = toFileOpError(e, path)
    return err(fe.code === 'EUNKNOWN' ? fileOpError('ENOENT', '대상을 찾을 수 없습니다.', path) : fe)
  }

  try {
    await fsp.access(path, fsConstants.R_OK)
  } catch (e) {
    const fe = toFileOpError(e, path)
    return err(fe.code === 'EUNKNOWN' ? fileOpError('EACCES', '접근 권한이 없습니다.', path) : fe)
  }

  const r = await openWithSpy(path)
  if (r.errorMessage) {
    return err(fileOpError('EUNKNOWN', `연결 프로그램을 열 수 없습니다: ${r.errorMessage}`, path))
  }
  return ok(undefined)
}

async function main(): Promise<void> {
  const base = await fsp.mkdtemp(join(os.tmpdir(), 'explorer-openwith-'))
  const real = join(base, 'doc.txt')
  await fsp.writeFile(real, 'hi', 'utf8')

  // ── 1) 잘못된 인자 형태 → EINVAL, openWith 미호출 ──────────────────
  let called = 0
  const spy = async (): Promise<{ errorMessage: string }> => {
    called++
    return { errorMessage: '' }
  }

  const rBad = await runOpenWith({ path: 123 }, spy)
  check('잘못된 인자(path 비문자열) → ok=false', !rBad.ok)
  check('잘못된 인자 → EINVAL', !rBad.ok && rBad.error.code === 'EINVAL')

  const rEmpty = await runOpenWith({}, spy)
  check('path 누락 → ok=false(EINVAL)', !rEmpty.ok && rEmpty.error.code === 'EINVAL')

  // ── 2) `..` 상위이탈(정규화 후에도 `..` 잔존) → ESECURITY ──────────
  // 주의: win32.normalize 는 드라이브 루트 기준 `..` 를 흡수하므로
  // (C:\a\..\..\b → C:\b) 진짜 이탈은 선행 `..` 가 남는 상대경로다.
  const rTraverse = await runOpenWith({ path: '..\\..\\evil.txt' }, spy)
  check('.. 상위이탈(잔존) → ok=false', !rTraverse.ok)
  check('.. 상위이탈(잔존) → ESECURITY', !rTraverse.ok && rTraverse.error.code === 'ESECURITY')

  // ── 3) 상대경로(`..` 없음) → EINVAL(절대경로 아님) ────────────────
  const rRel = await runOpenWith({ path: 'relative\\path.txt' }, spy)
  check('상대경로 → ok=false(EINVAL)', !rRel.ok && rRel.error.code === 'EINVAL')

  // ── 4) 미존재 절대경로 → ENOENT, openWith 미호출 ──────────────────
  const missing = join(base, 'nope.txt')
  const rMissing = await runOpenWith({ path: missing }, spy)
  check('미존재 경로 → ok=false', !rMissing.ok)
  check('미존재 경로 → ENOENT', !rMissing.ok && rMissing.error.code === 'ENOENT')

  check('여기까지 openWith 미호출(검증 실패는 실행 없음)', called === 0)

  // ── 5) 정상 절대경로(존재·읽기 가능) → openWith 1회 호출 + ok ──────
  const rOk = await runOpenWith({ path: real }, spy)
  check('정상 경로 → ok=true', rOk.ok)
  check('정상 경로 → openWith 정확히 1회 호출', called === 1)

  // ── 6) OS 실행 실패(errorMessage) → EUNKNOWN 으로 전파 ────────────
  const failSpy = async (): Promise<{ errorMessage: string }> => ({ errorMessage: 'spawn rundll32 실패' })
  const rFail = await runOpenWith({ path: real }, failSpy)
  check('OS 실행 실패 → ok=false(EUNKNOWN)', !rFail.ok && rFail.error.code === 'EUNKNOWN')

  await fsp.rm(base, { recursive: true, force: true }).catch(() => undefined)

  // eslint-disable-next-line no-console
  console.log('')
  // eslint-disable-next-line no-console
  console.log(`RESULT: ${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

void main()
