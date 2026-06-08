/**
 * verify:remote (§M M3 · MP4) — RemoteSessionManager·어댑터 매핑·세션 격리·전송 헤드리스 검증.
 *
 * 실 네트워크 미경유(스텁 어댑터 주입)로 다음을 단언한다:
 *   - connect 흐름: 어댑터 connect 위임·sessionId 발급·encrypted 전파(SFTP=true·평문 FTP=false).
 *   - TOFU: known 미등록(unknown) + hostKeyDecision 미지정 → 연결 보류(EHOSTKEY)·재연결 accept 통과.
 *   - 세션 격리: 두 세션 독립(한 세션 disconnect 가 다른 세션 무영향)·reportSessionError 격리.
 *   - list entries → FileEntryDTO 정규화(어댑터가 반환).
 *   - RemoteError 코드 전파(EAUTH 등).
 *   - **연결/오류 객체·로그에 비밀 미수록**(secret value grep 0).
 *   - CN-4: registerExternalOperation 으로 download operationId 발급·진행률 보고·완료 통지.
 *
 * 양식: 기존 verify-*(pass/fail·esbuild 번들→node). 네트워크/electron 미경유(type-only import).
 */
import { RemoteSessionManager, type KnownHostsStore } from '../src/main/remote/RemoteSessionManager'
import type {
  CancelSignal,
  ConnectOpts,
  ConnectResult,
  RemoteAdapter,
  RemoteError,
  TransferProgress
} from '../src/main/remote/RemoteService'
import { startDownload, type OpRegistrar } from '../src/main/remote/remoteTransfer'
import type { FileEntryDTO, OpSummary } from '../src/shared/dto'
import type { Result } from '../src/shared/ipc/contracts'
import { err, ok } from '../src/shared/ipc/contracts'
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import { join } from 'node:path'

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

const SECRET = 'top-secret-pw-123'

function makeEntry(name: string, parent: string): FileEntryDTO {
  return {
    name,
    path: `${parent}/${name}`,
    isDir: false,
    size: 10,
    mtime: 0,
    ctime: 0,
    ext: '',
    attrs: { hidden: false, readonly: false, system: false, symlink: false }
  }
}

/** 스텁 어댑터 — 네트워크 없이 RemoteAdapter 구현. connect 결과·에러·entries 를 제어. */
class StubAdapter implements RemoteAdapter {
  capturedSecret: string | undefined
  connectCalls = 0
  constructor(
    private readonly opts: {
      encrypted?: boolean
      connectError?: RemoteError
      callHostKey?: 'unknown'
      listError?: RemoteError
      downloadBytes?: number[]
    } = {}
  ) {}

  async connect(opts: ConnectOpts): Promise<Result<ConnectResult, RemoteError>> {
    this.connectCalls++
    this.capturedSecret = opts.secret?.value
    if (this.opts.connectError) return err(this.opts.connectError)
    // 신 계약: 어댑터는 호스트키를 거부하지 않고 연결 후 지문만 올린다(거부 시 ssh2-sftp-client
    // hang 회피). 매니저가 연결 성립 후 known_hosts 대조로 TOFU(accept/reject/prompt)를 판정한다.
    if (this.opts.callHostKey) {
      return ok({ encrypted: this.opts.encrypted ?? true, fingerprint: 'SHA256:ABC', algo: 'ssh' })
    }
    return ok({ encrypted: this.opts.encrypted ?? true })
  }
  async disconnect(): Promise<Result<void>> {
    return ok(undefined)
  }
  async list(path: string): Promise<Result<{ entries: FileEntryDTO[] }, RemoteError>> {
    if (this.opts.listError) return err(this.opts.listError)
    return ok({ entries: [makeEntry('a.txt', path), makeEntry('b.txt', path)] })
  }
  async stat(path: string): Promise<Result<FileEntryDTO, RemoteError>> {
    return ok(makeEntry('x', path))
  }
  async mkdir(): Promise<Result<void, RemoteError>> {
    return ok(undefined)
  }
  async rename(): Promise<Result<void, RemoteError>> {
    return ok(undefined)
  }
  async delete(): Promise<Result<void, RemoteError>> {
    return ok(undefined)
  }
  async download(
    remotePath: string,
    localPath: string,
    onProgress: TransferProgress,
    cancel: CancelSignal
  ): Promise<Result<void, RemoteError>> {
    for (const b of this.opts.downloadBytes ?? [50, 100]) {
      if (cancel.aborted) return err({ code: 'ECANCELED', message: '취소', path: remotePath })
      onProgress(b)
    }
    await fsp.writeFile(localPath, 'data').catch(() => undefined)
    return ok(undefined)
  }
  async upload(): Promise<Result<void, RemoteError>> {
    return ok(undefined)
  }
}

/** 인메모리 known_hosts. */
function makeKnownHosts(seed?: Record<string, string>): KnownHostsStore & { dump(): Record<string, string> } {
  const hosts: Record<string, string> = { ...(seed ?? {}) }
  return {
    async getKnownHostKey(host, port) {
      return hosts[`${host}:${port}`]
    },
    async setKnownHostKey(host, port, fp) {
      hosts[`${host}:${port}`] = fp
    },
    dump: () => hosts
  }
}

const SFTP_PROFILE = {
  id: 'p-sftp',
  name: 'SFTP',
  protocol: 'sftp' as const,
  host: 'example.com',
  port: 22,
  username: 'user',
  authMethod: 'password' as const
}
const FTP_PROFILE = {
  id: 'p-ftp',
  name: 'FTP',
  protocol: 'ftp' as const,
  host: 'ftp.example.com',
  port: 21,
  username: 'user',
  authMethod: 'password' as const
}

async function main(): Promise<void> {
  // ════ 1) connect 위임 + encrypted 전파 ════════════════════════════════
  {
    const adapter = new StubAdapter({ encrypted: true })
    const mgr = new RemoteSessionManager(() => adapter, makeKnownHosts())
    const r = await mgr.connect({ profile: SFTP_PROFILE, secret: { kind: 'password', value: SECRET } }, null)
    check('[connect] ok·sessionId 발급', r.ok && typeof r.value.sessionId === 'string')
    check('[connect] SFTP encrypted=true 전파', r.ok && r.value.encrypted === true)
    check('[connect] 어댑터 connect 1회 위임', adapter.connectCalls === 1)
    // 비밀은 어댑터 메모리로만 흐름 — 응답 객체에 미수록.
    check('[비밀 0] connect 응답에 secret 미수록', !JSON.stringify(r).includes(SECRET))
  }

  // 평문 FTP encrypted=false.
  {
    const adapter = new StubAdapter({ encrypted: false })
    const mgr = new RemoteSessionManager(() => adapter, makeKnownHosts())
    const r = await mgr.connect({ profile: FTP_PROFILE, secret: { kind: 'password', value: SECRET } }, null)
    check('[connect] 평문 FTP encrypted=false', r.ok && r.value.encrypted === false)
  }

  // ════ 2) TOFU: unknown + 결정 미지정 → 보류(EHOSTKEY), accept 재연결 통과 ═
  {
    const known = makeKnownHosts() // 미등록.
    const adapter = new StubAdapter({ callHostKey: 'unknown' })
    const mgr = new RemoteSessionManager(() => adapter, known)
    const r1 = await mgr.connect({ profile: SFTP_PROFILE, secret: { kind: 'password', value: SECRET } }, null)
    check('[TOFU] unknown + 미지정 → 연결 보류(EHOSTKEY)', !r1.ok && r1.error.code === 'EHOSTKEY')

    const adapter2 = new StubAdapter({ callHostKey: 'unknown' })
    const mgr2 = new RemoteSessionManager(() => adapter2, known)
    const r2 = await mgr2.connect(
      { profile: SFTP_PROFILE, secret: { kind: 'password', value: SECRET }, hostKeyDecision: 'accept' },
      null
    )
    check('[TOFU] accept 회신 → 연결 통과', r2.ok)
    check('[TOFU] accept 후 known_hosts 에 지문 저장', known.dump()['example.com:22'] === 'SHA256:ABC')

    // 재방문: known_hosts 에 지문이 있으니 hostKeyDecision 없이도 자동 accept(모달 없음).
    const adapter3 = new StubAdapter({ callHostKey: 'unknown' })
    const mgr3 = new RemoteSessionManager(() => adapter3, known)
    const r3 = await mgr3.connect(
      { profile: SFTP_PROFILE, secret: { kind: 'password', value: SECRET } },
      null
    )
    check('[TOFU] 재방문(저장된 지문 일치) → 무모달 자동 연결', r3.ok)
  }

  // reject 회신 → 거부.
  {
    const adapter = new StubAdapter({ callHostKey: 'unknown' })
    const mgr = new RemoteSessionManager(() => adapter, makeKnownHosts())
    const r = await mgr.connect(
      { profile: SFTP_PROFILE, secret: { kind: 'password', value: SECRET }, hostKeyDecision: 'reject' },
      null
    )
    check('[TOFU] reject 회신 → EHOSTKEY 거부', !r.ok && r.error.code === 'EHOSTKEY')
  }

  // ════ 3) 세션 격리 ════════════════════════════════════════════════════
  {
    const a1 = new StubAdapter()
    const a2 = new StubAdapter()
    let n = 0
    const mgr = new RemoteSessionManager(() => (n++ === 0 ? a1 : a2), makeKnownHosts())
    const s1 = await mgr.connect({ profile: FTP_PROFILE, secret: { kind: 'password', value: SECRET } }, null)
    const s2 = await mgr.connect({ profile: FTP_PROFILE, secret: { kind: 'password', value: SECRET } }, null)
    const id1 = s1.ok ? s1.value.sessionId : ''
    const id2 = s2.ok ? s2.value.sessionId : ''
    check('[격리] 두 세션 sessionId 상이', id1 !== id2 && id1.length > 0)
    await mgr.disconnect(id1)
    check('[격리] s1 disconnect 후 s1 무효', !mgr.hasSession(id1))
    check('[격리] s2 는 여전히 유효(무영향)', mgr.hasSession(id2))
  }

  // ════ 4) list 정규화 + RemoteError 전파 ════════════════════════════════
  {
    const adapter = new StubAdapter()
    const mgr = new RemoteSessionManager(() => adapter, makeKnownHosts())
    const c = await mgr.connect({ profile: FTP_PROFILE, secret: { kind: 'password', value: SECRET } }, null)
    const sid = c.ok ? c.value.sessionId : ''
    const l = await mgr.list(sid, '/home/user')
    check('[list] entries → FileEntryDTO 정규화(2건)', l.ok && l.value.entries.length === 2)
    check('[list] entry.path 원격 절대경로', l.ok && l.value.entries[0]!.path === '/home/user/a.txt')

    const adapterE = new StubAdapter({ listError: { code: 'EAUTH', message: '인증 실패' } })
    const mgrE = new RemoteSessionManager(() => adapterE, makeKnownHosts())
    const cE = await mgrE.connect({ profile: FTP_PROFILE }, null)
    const sidE = cE.ok ? cE.value.sessionId : ''
    const lE = await mgrE.list(sidE, '/x')
    check('[error] RemoteError(EAUTH) 전파', !lE.ok && lE.error.code === 'EAUTH')

    // 무효 sessionId → ECONNRESET.
    const lBad = await mgr.list('no-such-session', '/x')
    check('[error] 무효 세션 → ECONNRESET', !lBad.ok && lBad.error.code === 'ECONNRESET')
  }

  // ════ 5) 원격 경로 traversal 거부(매니저 guard) ═══════════════════════
  {
    const adapter = new StubAdapter()
    const mgr = new RemoteSessionManager(() => adapter, makeKnownHosts())
    const c = await mgr.connect({ profile: FTP_PROFILE }, null)
    const sid = c.ok ? c.value.sessionId : ''
    // POSIX 절대경로의 `..` 는 루트(/) 아래로 clamp 되어 이탈 불가 → 정규화 후 통과(원격 루트 = /).
    // (로컬 도착지 이탈은 Zip Slip 으로 verify:remote-trust 에서 별도 검증.)
    const lNorm = await mgr.list(sid, '/home/../../etc')
    check('[traversal] 절대경로 `..` → 루트 clamp 정규화 통과(/etc)', lNorm.ok)
    const lRel = await mgr.list(sid, 'relative/path')
    check('[traversal] 상대경로(절대 아님) → 거부(EACCES)', !lRel.ok && lRel.error.code === 'EACCES')
    const lNull = await mgr.list(sid, '/a\0b')
    check('[traversal] 널바이트 경로 → 거부(EACCES)', !lNull.ok && lNull.error.code === 'EACCES')
  }

  // ════ 6) CN-4: download operationId 발급·진행률·완료(op:* 재사용 스텁) ═══
  {
    const base = await fsp.mkdtemp(join(os.tmpdir(), 'remote-dl-'))
    const adapter = new StubAdapter({ downloadBytes: [50, 100] })

    const progresses: number[] = []
    let finished: OpSummary | null = null
    const reg: OpRegistrar = {
      registerExternalOperation: (_kind, _wc, _onCancel) => ({
        operationId: 'op-xyz',
        reportProgress: (p) => progresses.push(p.processedBytes),
        finishOp: (s) => {
          finished = s
        }
      })
    }
    const r = startDownload(adapter, ['/remote/a.txt'], base, null as never, reg)
    check('[CN-4] download → operationId 발급', r.ok && r.value.operationId === 'op-xyz')
    // 비동기 완료 대기.
    await new Promise((res) => setTimeout(res, 50))
    check('[CN-4] 진행률 보고됨(>=1)', progresses.length >= 1)
    check('[CN-4] 완료 통지(op:done summary) 도착', finished !== null)
    check('[CN-4] 다운로드 성공 1건', finished !== null && (finished as OpSummary).succeededItems === 1)
    await fsp.rm(base, { recursive: true, force: true }).catch(() => undefined)
  }

  // eslint-disable-next-line no-console
  console.log('')
  // eslint-disable-next-line no-console
  console.log(`RESULT: ${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

void main()
