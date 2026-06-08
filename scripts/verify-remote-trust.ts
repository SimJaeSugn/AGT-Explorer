/**
 * verify:remote-trust (§M M3 · MP4 · SR5/SR6) — 원격 신뢰경계 헤드리스 검증.
 *
 * 원격 응답을 불신 입력으로 취급하는 ADR-007 결정⑥ 불변식을 단언한다:
 *   ① 원격 path traversal(POSIX `..`·상대경로·널바이트) 정규화 차단.
 *   ② 다운로드 도착지 하위 이탈 차단(Zip Slip 매트릭스 — safeLocalDestPath/isWithinLocalDir).
 *   ③ 원격 파일명 로컬 금지문자/예약명/경로구분자 새니타이즈.
 *   ④ `.part` 임시명 → 완료 시 원자 rename(불완전 파일 완료본 오인 방지).
 *   ⑤ host-key changed/unknown status 분류(known 대조).
 *   ⑥ RemoteError·로그 문자열에 비밀 패턴 부재(toRemoteError 가 비밀 미수록).
 *
 * 양식: 기존 verify-*(pass/fail·esbuild 번들→node). 순수함수 + 실 FS(.part rename)만.
 */
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import { join, win32 } from 'node:path'
import {
  normalizeRemotePath,
  joinRemote,
  sanitizeLocalFileName,
  isWithinLocalDir,
  safeLocalDestPath
} from '../src/main/remote/remotePath'
import { classifyRemoteError, toRemoteError } from '../src/main/remote/remoteErrors'
import { formatFingerprint } from '../src/main/remote/SftpAdapter'
import { createHash } from 'node:crypto'
import { startDownload, type OpRegistrar } from '../src/main/remote/remoteTransfer'
import type {
  CancelSignal,
  RemoteAdapter,
  RemoteError,
  TransferProgress
} from '../src/main/remote/RemoteService'
import type { FileEntryDTO, OpSummary } from '../src/shared/dto'
import type { Result } from '../src/shared/ipc/contracts'
import { err, ok } from '../src/shared/ipc/contracts'

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

async function main(): Promise<void> {
  // ════ ① 원격 path traversal 차단 ══════════════════════════════════════
  // 원격은 POSIX 절대경로(루트 /). 절대경로의 `..` 는 루트 아래로 clamp 되어 이탈 불가 →
  // 정규화 후 통과. **상대경로·널바이트·빈 경로는 거부**(불신 입력 방어). 로컬 도착지 이탈은
  // Zip Slip(아래 ②)으로 별도 차단한다.
  check('[traversal] `/a/../b` → 정규화 통과(/b)', normalizeRemotePath('/a/../b').ok)
  const clamp1 = normalizeRemotePath('/a/../../etc')
  check('[traversal] `/a/../../etc` → 루트 clamp(/etc) 통과', clamp1.ok && clamp1.path === '/etc')
  const clamp2 = normalizeRemotePath('/../etc/passwd')
  check('[traversal] `/../etc/passwd` → 루트 clamp(/etc/passwd)', clamp2.ok && clamp2.path === '/etc/passwd')
  check('[traversal] 상대경로 `etc/passwd` → 거부(절대 아님)', !normalizeRemotePath('etc/passwd').ok)
  check('[traversal] 빈 경로 → 거부', !normalizeRemotePath('').ok)
  check('[traversal] 널바이트 → 거부', !normalizeRemotePath('/a\0b').ok)
  check('[traversal] 정상 `/home/user` ok', normalizeRemotePath('/home/user').ok)

  // joinRemote: 자식명 경로구분자/`..` 거부.
  check('[join] 정상 join ok', joinRemote('/home', 'docs').ok)
  check('[join] 자식명 `/` 포함 → 거부', !joinRemote('/home', 'a/b').ok)
  check('[join] 자식명 `..` → 거부', !joinRemote('/home', '..').ok)

  // ════ ② Zip Slip — 도착지 하위 이탈 차단 ══════════════════════════════
  const dest = win32.resolve('C:\\Users\\me\\downloads')
  check('[zipslip] 정상 파일명 → 하위 OK', isWithinLocalDir(dest, win32.join(dest, 'a.txt')))
  check(
    '[zipslip] `..\\..\\evil` 절대 탈출 → 차단',
    !isWithinLocalDir(dest, win32.resolve(dest, '..', '..', 'evil.txt'))
  )
  check('[zipslip] 다른 드라이브 → 차단', !isWithinLocalDir(dest, 'D:\\evil.txt'))
  // safeLocalDestPath: 악성 원격 파일명도 하위로 강제.
  const sp1 = safeLocalDestPath(dest, '../../../../etc/passwd')
  check('[zipslip] safeLocalDestPath(`../../etc`) → 하위로 새니타이즈', sp1.ok && isWithinLocalDir(dest, sp1.path))
  const sp2 = safeLocalDestPath(dest, '/abs/evil.txt')
  check('[zipslip] safeLocalDestPath(절대경로명) → 하위 강제', sp2.ok && isWithinLocalDir(dest, sp2.path))

  // ════ ③ 파일명 새니타이즈(로컬 금지문자/예약명/구분자) ══════════════════
  check('[sanitize] `a<b>c` 금지문자 → 치환', !/[<>]/.test(sanitizeLocalFileName('a<b>c')))
  check('[sanitize] `a/b\\c` 경로구분자 제거(basename)', sanitizeLocalFileName('a/b\\c') === 'c')
  check('[sanitize] `CON` 예약명 → 안전 접두', sanitizeLocalFileName('CON').startsWith('_'))
  check('[sanitize] 빈/`..` → 안전 기본명', sanitizeLocalFileName('..') === '_remote_file')
  check('[sanitize] 정상명 보존', sanitizeLocalFileName('report.pdf') === 'report.pdf')
  check('[sanitize] 결과에 경로구분자 없음', !/[/\\]/.test(sanitizeLocalFileName('x/y:z*?.txt')))

  // ════ ④ `.part` 원자 rename — 다운로드 완료 시 .part 부재·최종본 존재 ════
  {
    const base = await fsp.mkdtemp(join(os.tmpdir(), 'remote-trust-'))
    const seen: { part: boolean; final: boolean } = { part: false, final: false }

    const adapter: RemoteAdapter = {
      connect: async () => ok({ encrypted: true }),
      disconnect: async () => ok(undefined),
      list: async () => ok({ entries: [] as FileEntryDTO[] }),
      stat: async () => err({ code: 'ENOENT', message: 'x' }) as Result<FileEntryDTO, RemoteError>,
      mkdir: async () => ok(undefined),
      rename: async () => ok(undefined),
      delete: async () => ok(undefined),
      async download(
        _r: string,
        localPath: string,
        onProgress: TransferProgress,
        _c: CancelSignal
      ): Promise<Result<void, RemoteError>> {
        // 다운로드 중에는 .part 로 받는다(최종명 아님) — 경로에 .part 확인.
        seen.part = localPath.endsWith('.part')
        onProgress(100)
        await fsp.writeFile(localPath, 'payload')
        return ok(undefined)
      },
      upload: async () => ok(undefined)
    }

    let finished: OpSummary | null = null
    const reg: OpRegistrar = {
      registerExternalOperation: () => ({
        operationId: 'op-1',
        reportProgress: () => undefined,
        finishOp: (s) => {
          finished = s
        }
      })
    }
    startDownload(adapter, ['/remote/report.pdf'], base, null as never, reg)
    await new Promise((res) => setTimeout(res, 60))

    check('[.part] 다운로드 중 임시명(.part) 사용', seen.part === true)
    // 완료 후: 최종본 존재·`.part` 부재(원자 rename).
    const finalExists = await fsp
      .access(join(base, 'report.pdf'))
      .then(() => true)
      .catch(() => false)
    const partExists = await fsp
      .access(join(base, 'report.pdf.part'))
      .then(() => true)
      .catch(() => false)
    check('[.part] 완료 후 최종본 존재', finalExists)
    check('[.part] 완료 후 .part 부재(원자 rename)', !partExists)
    check('[.part] 다운로드 성공 1건', finished !== null && (finished as OpSummary).succeededItems === 1)
    await fsp.rm(base, { recursive: true, force: true }).catch(() => undefined)
  }

  // 도착지 이탈 원격명 → 격리(skip·실패로 기록, 도착지 밖 파일 미생성).
  {
    const base = await fsp.mkdtemp(join(os.tmpdir(), 'remote-trust2-'))
    // safeLocalDestPath 가 새니타이즈로 하위 강제하므로 실제로는 ok 가 되어 다운로드된다 —
    // 여기서는 basename 이 경로구분자만 가진 위험 케이스를 startDownload 가 안전 처리함을 본다.
    const adapter: RemoteAdapter = {
      connect: async () => ok({ encrypted: true }),
      disconnect: async () => ok(undefined),
      list: async () => ok({ entries: [] as FileEntryDTO[] }),
      stat: async () => err({ code: 'ENOENT', message: 'x' }) as Result<FileEntryDTO, RemoteError>,
      mkdir: async () => ok(undefined),
      rename: async () => ok(undefined),
      delete: async () => ok(undefined),
      async download(_r, localPath, onProgress): Promise<Result<void, RemoteError>> {
        onProgress(1)
        await fsp.writeFile(localPath, 'x')
        return ok(undefined)
      },
      upload: async () => ok(undefined)
    }
    let finished: OpSummary | null = null
    const reg: OpRegistrar = {
      registerExternalOperation: () => ({
        operationId: 'op-2',
        reportProgress: () => undefined,
        finishOp: (s) => {
          finished = s
        }
      })
    }
    // 원격 파일명이 traversal 시도(`../../../evil`) → 새니타이즈되어 base 하위로만 떨어진다.
    startDownload(adapter, ['/x/../../../evil.txt'], base, null as never, reg)
    await new Promise((res) => setTimeout(res, 60))
    // base 의 부모에 evil.txt 가 생기지 않아야 한다(이탈 0).
    const escaped = await fsp
      .access(win32.resolve(base, '..', 'evil.txt'))
      .then(() => true)
      .catch(() => false)
    check('[zipslip] 다운로드 후 도착지 밖 파일 미생성', !escaped)
    check('[zipslip] 전송 완료(새니타이즈 하위로 안착)', finished !== null)
    await fsp.rm(base, { recursive: true, force: true }).catch(() => undefined)
  }

  // ════ ⑤ host-key status 분류(known 대조) — RemoteSessionManager 검증은 verify:remote.
  //   여기서는 errorClassify 가 host key 메시지를 EHOSTKEY 로 분류함을 본다.
  check(
    '[hostkey] "host key verification failed" → EHOSTKEY',
    classifyRemoteError({ message: 'Host key verification failed' }) === 'EHOSTKEY'
  )
  check('[errclass] timeout → ETIMEDOUT', classifyRemoteError({ code: 'ETIMEDOUT' }) === 'ETIMEDOUT')
  check('[errclass] ECONNRESET → ECONNRESET', classifyRemoteError({ code: 'ECONNRESET' }) === 'ECONNRESET')
  check(
    '[errclass] getaddrinfo ENOTFOUND → EHOSTUNREACH',
    classifyRemoteError({ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND' }) === 'EHOSTUNREACH'
  )
  check(
    '[errclass] authentication failed → EAUTH',
    classifyRemoteError({ message: 'All configured authentication methods failed' }) === 'EAUTH'
  )

  // ════ ⑤b host-key 지문 정규화 — hostVerifier 가 Buffer 를 받아 실지문으로 ════
  // ssh2 는 hostHash 옵션이 없으면 호스트키 raw bytes 를 **Buffer** 로 넘긴다.
  // formatFingerprint 는 그 Buffer 를 SHA256 해시해 `SHA256:<base64>` 표준 지문으로 만들고,
  // 절대 "unknown" 으로 떨어지지 않아야 한다(과거 버그: typeof!=='string' → 'unknown').
  {
    // ed25519 호스트키 raw bytes 모사(임의 32바이트 — 실서버는 ed25519 공개키 바이트).
    const fakeKey = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8')
    const fp = formatFingerprint(fakeKey)
    const expected = `SHA256:${createHash('sha256').update(fakeKey).digest('base64').replace(/=+$/, '')}`
    check('[hostkey] Buffer 입력 → SHA256:<base64> 정규화', fp === expected)
    check('[hostkey] Buffer 입력 지문이 "unknown" 아님(실지문)', fp !== 'unknown' && fp.startsWith('SHA256:'))
    check('[hostkey] 지문에 base64 패딩(=) 없음(OpenSSH 표준)', !fp.includes('='))
    // 결정성: 같은 키 → 같은 지문(known_hosts 재방문 매칭 보장).
    check('[hostkey] 같은 호스트키 → 동일 지문(결정적)', formatFingerprint(fakeKey) === fp)
    // 빈 Buffer 방어.
    check('[hostkey] 빈 Buffer → unknown(방어)', formatFingerprint(Buffer.alloc(0)) === 'unknown')
    // 문자열 방어 경로(이미 지문이면 보존, 아니면 접두).
    check('[hostkey] 문자열 SHA256: 지문 보존', formatFingerprint('SHA256:abc') === 'SHA256:abc')
    check('[hostkey] 문자열 hex 해시 → SHA256: 접두', formatFingerprint('deadbeef') === 'SHA256:deadbeef')
  }

  // ════ ⑥ 비밀 미수록 — Error 객체에 비밀 패턴 부재 ══════════════════════
  {
    const SECRET = 'my-passw0rd-VALUE'
    // 라이브러리가 메시지에 비밀을 흘려도(가정), toRemoteError 는 안전 메시지만 쓴다.
    const e = toRemoteError(new Error(`auth failed for password ${SECRET}`), 'EAUTH', '/home/user')
    const s = JSON.stringify(e)
    check('[비밀 0] toRemoteError 메시지에 secret 부재', !s.includes(SECRET))
    check('[비밀 0] toRemoteError 는 안전 메시지(EAUTH)', e.code === 'EAUTH' && !s.includes('password ' + SECRET))
    // path 는 비밀 아님(원격 경로) — 보존.
    check('[error] path(원격 경로) 보존', e.path === '/home/user')
  }

  // eslint-disable-next-line no-console
  console.log('')
  // eslint-disable-next-line no-console
  console.log(`RESULT: ${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

void main()
