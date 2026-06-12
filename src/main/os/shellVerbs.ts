/**
 * ShellVerbsService — 상주 PowerShell 셸 verb 워커 서비스 (§Y1 · ADR-013 · ADR-005).
 *
 * COM `Shell.Application` `Verbs()` 를 호출하는 PowerShell 1개를 **lazy 상주**시키고,
 * stdin/stdout JSON 라인 프로토콜로 verb 조회(list)/실행(invoke)을 보낸다(매 우클릭
 * spawn 비용을 1회 상환 — ADR-013 결정②). 우클릭 비차단을 위해 FIFO 직렬 큐·짧은
 * 타임아웃·stale-cancel·crash 재기동·연속 실패 쿨다운으로 흡수한다.
 *
 * 정직 한계(empty 포괄 — 권고③): list 의 빈 목록·실패·타임아웃·spawn 불가는 **모두**
 * 빈 verbs 로 수렴한다(섹션 비노출 = 크래시 없는 정상). 핸들러가 ok({verbs:[]}) 로 흡수.
 *
 * 보안(ADR-005): 경로·verbId 는 stdin JSON 본문으로만 워커에 전달(명령행 합성 0).
 * ps1 은 고정 텍스트. 로컬 한정(원격/archive prefix 거부)은 핸들러에서.
 *
 * 헤드리스 검증성: 생성자 옵션 `transport` 로 PowerShell 미경유 페이크 주입
 * (driveType.ts `queryFn` 선례). electron import 0 → node 단독 구동 가능
 * (verify·실 노드 스모크가 실제 ps1 워커를 child_process 로 직접 구동).
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Result, ShellContextVerbsRes } from '@shared/ipc/contracts'
import { err, ok } from '@shared/ipc/contracts'
import { fileOpError } from '../fs/errors'
import { filterVerbs, type RawShellVerb } from './shellVerbsBlacklist'

/** 워커 응답 JSON 라인의 형태(ps1 출력). */
interface WorkerResponse {
  readonly id?: string
  readonly ok?: boolean
  readonly verbs?: RawShellVerb[]
  readonly code?: string
  readonly message?: string
}

/**
 * 워커 트랜스포트(child_process 추상화). verify 가 PowerShell 미경유 페이크를 주입한다.
 *   - send(line): stdin 에 JSON 1줄(+개행) 전송.
 *   - onLine(cb): stdout 1줄(개행 분리) 수신 콜백 등록.
 *   - onExit(cb): 프로세스 종료/오류 콜백 등록(crash 재기동 트리거).
 *   - kill(): 프로세스 종료(dispose).
 */
export interface ShellVerbsTransport {
  send(line: string): void
  onLine(cb: (line: string) => void): void
  onExit(cb: () => void): void
  kill(): void
}

/** 트랜스포트 팩토리(매 (재)기동마다 새 인스턴스 생성). 기본 = 실제 PowerShell child_process. */
export type ShellVerbsTransportFactory = () => ShellVerbsTransport

export interface ShellVerbsServiceOptions {
  /** 헤드리스 검증용 트랜스포트 팩토리(기본=실제 PowerShell child_process). */
  transportFactory?: ShellVerbsTransportFactory
  /** 조회/실행 타임아웃 ms(기본 1500). */
  requestTimeoutMs?: number
  /** 연속 기동 실패 쿨다운 임계(기본 3 — UQ-Y5). */
  maxConsecutiveSpawnFailures?: number
}

const DEFAULT_TIMEOUT_MS = 1500
const DEFAULT_MAX_SPAWN_FAILURES = 3

/** in-flight 요청 1개(id 상관). */
interface Pending {
  readonly id: string
  resolve(res: WorkerResponse): void
  reject(): void
  timer: ReturnType<typeof setTimeout> | null
  /** 'list' 요청은 stale-cancel 대상(새 경로 list 가 이전 list 를 폐기). */
  readonly op: 'list' | 'invoke'
}

/**
 * 실제 PowerShell child_process 트랜스포트. `-File <ps1>` + ExecutionPolicy Bypass
 * (권고④). stdout 은 라인 버퍼링(개행 분리). 동기 spawn throw 는 onExit 로 흡수.
 */
function createPowerShellTransport(scriptPath: string): ShellVerbsTransport {
  let exitCbs: Array<() => void> = []
  let lineCbs: Array<(line: string) => void> = []
  let buf = ''
  let dead = false

  const fireExit = (): void => {
    if (dead) return
    dead = true
    for (const cb of exitCbs) cb()
  }

  let child: ReturnType<typeof spawn> | null = null
  try {
    child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] }
    )
  } catch {
    // 동기 throw(스토어 별칭·환경 이상 등) → 즉시 죽은 트랜스포트.
    child = null
  }

  if (child) {
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      buf += chunk
      let nl = buf.indexOf('\n')
      while (nl >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, '')
        buf = buf.slice(nl + 1)
        if (line.length > 0) for (const cb of lineCbs) cb(line)
        nl = buf.indexOf('\n')
      }
    })
    child.once('error', fireExit)
    child.once('exit', fireExit)
  }

  return {
    send(line: string): void {
      try {
        child?.stdin?.write(line + '\n')
      } catch {
        fireExit()
      }
    },
    onLine(cb): void {
      lineCbs.push(cb)
    },
    onExit(cb): void {
      // child 가 애초에 없으면(동기 throw) 다음 틱에 즉시 exit 통지.
      exitCbs.push(cb)
      if (!child) setImmediate(fireExit)
    },
    kill(): void {
      lineCbs = []
      exitCbs = []
      try {
        child?.stdin?.end()
      } catch {
        /* ignore */
      }
      try {
        child?.kill()
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * 패키지(asar) 환경에서 ps1 경로를 해석한다. dev 는 `__dirname`(out/main) 그대로,
 * 패키지(`app.asar`)는 `app.asar.unpacked` 로 보정(asarUnpack — HashManager 선례).
 * 존재하지 않으면 보정 전 경로를 그대로 반환(spawn 실패 → 섹션 비노출 폴백).
 */
function resolveWorkerScriptPath(): string {
  const direct = join(__dirname, 'shellVerbsWorker.ps1')
  if (direct.includes('app.asar') && !direct.includes('app.asar.unpacked')) {
    const unpacked = direct.replace('app.asar', 'app.asar.unpacked')
    if (existsSync(unpacked)) return unpacked
  }
  return direct
}

export class ShellVerbsService {
  private readonly transportFactory: ShellVerbsTransportFactory
  private readonly requestTimeoutMs: number
  private readonly maxSpawnFailures: number

  private transport: ShellVerbsTransport | null = null
  private readonly pending = new Map<string, Pending>()
  /** FIFO 직렬 큐: 송신 대기 요청(이전 응답 수신 후 1건씩 송신). */
  private readonly queue: Array<{ payload: object; p: Pending }> = []
  private inFlight: Pending | null = null
  private seq = 0
  private consecutiveSpawnFailures = 0
  /** 연속 실패 쿨다운(세션 비활성). */
  private cooledDown = false
  private disposed = false

  constructor(opts: ShellVerbsServiceOptions = {}) {
    this.transportFactory =
      opts.transportFactory ?? (() => createPowerShellTransport(resolveWorkerScriptPath()))
    this.requestTimeoutMs = opts.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS
    this.maxSpawnFailures = opts.maxConsecutiveSpawnFailures ?? DEFAULT_MAX_SPAWN_FAILURES
  }

  /**
   * 단일 항목 verb 조회. 블랙리스트 필터 후 verbs 반환. 실패/타임아웃/spawn 불가/빈
   * 목록은 **모두 ok({verbs:[]})** 로 수렴한다(empty 포괄 — 핸들러가 섹션 비노출).
   * stale-cancel: 새 경로 list 요청이 오면 미완 list 요청을 폐기(빈 목록 resolve).
   */
  async listVerbs(normalizedPath: string): Promise<Result<ShellContextVerbsRes>> {
    if (this.cooledDown || process.platform !== 'win32') {
      return ok({ verbs: [] })
    }
    // stale-cancel: 이전 미완 list 요청(큐 대기 + in-flight)을 빈 목록으로 폐기.
    this.cancelPendingLists()

    const res = await this.request('list', { op: 'list', path: normalizedPath })
    if (!res.ok || res.value.ok !== true || !Array.isArray(res.value.verbs)) {
      return ok({ verbs: [] })
    }
    const filtered = filterVerbs(res.value.verbs)
    return ok({ verbs: filtered })
  }

  /**
   * verb 실행(fire-and-forget·DoIt). 성공=ok, 스테일/미존재=EVERB, 경로 소실=ENOENT,
   * 그 외=EUNKNOWN. 타임아웃/spawn 불가도 EUNKNOWN(실행 결과 미추적).
   */
  async invokeVerb(normalizedPath: string, verbId: string): Promise<Result<void>> {
    if (this.cooledDown || process.platform !== 'win32') {
      return err(fileOpError('EUNKNOWN', '셸 메뉴를 사용할 수 없습니다.', normalizedPath))
    }
    const res = await this.request('invoke', { op: 'invoke', path: normalizedPath, verbId })
    if (!res.ok) {
      return err(fileOpError('EUNKNOWN', '메뉴 동작을 실행할 수 없습니다.', normalizedPath))
    }
    const r = res.value
    if (r.ok === true) return ok(undefined)
    const code =
      r.code === 'EVERB' ? 'EVERB' : r.code === 'ENOENT' ? 'ENOENT' : 'EUNKNOWN'
    return err(fileOpError(code, '메뉴 동작을 실행할 수 없습니다.', normalizedPath))
  }

  /** before-quit 정리(child.kill·큐/in-flight 전부 reject). 멱등. */
  dispose(): void {
    this.disposed = true
    this.cooledDown = true
    this.failAll()
    try {
      this.transport?.kill()
    } catch {
      /* ignore */
    }
    this.transport = null
  }

  // ── 내부 ────────────────────────────────────────────────────────────────

  /** 미완 list 요청(큐 + in-flight)을 빈 목록으로 폐기(stale-cancel). */
  private cancelPendingLists(): void {
    // 큐의 list 제거.
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const q = this.queue[i]!
      if (q.p.op === 'list') {
        this.queue.splice(i, 1)
        this.pending.delete(q.p.id)
        q.p.resolve({ ok: true, verbs: [] })
      }
    }
    // in-flight 가 list 면 폐기(워커는 죽이지 않음 — 늦은 응답은 id drop).
    if (this.inFlight && this.inFlight.op === 'list') {
      const p = this.inFlight
      this.clearPending(p, true)
      p.resolve({ ok: true, verbs: [] })
    }
  }

  /** 요청 1건을 큐에 넣고 응답을 Promise 로 받는다(워커 미기동 시 lazy 기동). */
  private request(
    op: 'list' | 'invoke',
    payload: { op: string; path: string; verbId?: string }
  ): Promise<Result<WorkerResponse>> {
    return new Promise<Result<WorkerResponse>>((resolve) => {
      const id = `v${++this.seq}`
      const p: Pending = {
        id,
        op,
        timer: null,
        resolve: (res) => resolve(ok(res)),
        reject: () => resolve(err(fileOpError('EUNKNOWN', '셸 워커 응답 실패')))
      }
      this.pending.set(id, p)
      this.queue.push({ payload: { id, ...payload }, p })
      this.pump()
    })
  }

  /** 큐를 1건씩 송신(FIFO 직렬). 송신 직전 워커 lazy 기동. */
  private pump(): void {
    if (this.disposed || this.cooledDown) {
      this.failAll()
      return
    }
    if (this.inFlight) return // 직렬: 이전 응답 수신까지 대기.
    const next = this.queue.shift()
    if (!next) return

    if (!this.ensureWorker()) {
      // 기동 실패 → 이 요청 reject + (쿨다운 아니면) 다음 요청은 재기동 시도.
      this.pending.delete(next.p.id)
      next.p.reject()
      // 쿨다운 진입 시 잔여 큐도 정리.
      if (this.cooledDown) this.failAll()
      else this.pump()
      return
    }

    this.inFlight = next.p
    next.p.timer = setTimeout(() => {
      // 타임아웃: 해당 요청만 reject(워커 미종료). 늦은 응답은 id drop.
      const p = this.inFlight
      if (p && p.id === next.p.id) {
        this.clearPending(p, true)
        p.reject()
      }
    }, this.requestTimeoutMs)

    try {
      this.transport!.send(JSON.stringify(next.payload))
    } catch {
      // 송신 동기 실패 → crash 경로로 흡수.
      this.handleExit()
    }
  }

  /** 워커가 없으면 (재)기동한다. 성공=true. 연속 실패 임계 도달 시 쿨다운. */
  private ensureWorker(): boolean {
    if (this.transport) return true
    let t: ShellVerbsTransport
    try {
      t = this.transportFactory()
    } catch {
      this.onSpawnFailure()
      return false
    }
    this.transport = t
    t.onLine((line) => this.handleLine(line))
    t.onExit(() => this.handleExit())
    // 성공적으로 인스턴스 생성됨(실 spawn 실패는 onExit 로 비동기 통지).
    this.consecutiveSpawnFailures = 0
    return true
  }

  private onSpawnFailure(): void {
    this.consecutiveSpawnFailures++
    if (this.consecutiveSpawnFailures >= this.maxSpawnFailures) {
      this.cooledDown = true
    }
  }

  /** 워커 stdout 1줄 처리. id 상관 — in-flight 맵에 없는 id 는 폐기(권고②). */
  private handleLine(line: string): void {
    let res: WorkerResponse
    try {
      res = JSON.parse(line) as WorkerResponse
    } catch {
      return // 비-JSON 라인 무시.
    }
    const id = typeof res.id === 'string' ? res.id : ''
    const p = id ? this.pending.get(id) : undefined
    if (!p) return // 타임아웃·stale-cancel 로 이미 사라진 id 응답 → drop(권고②).
    this.clearPending(p, false)
    p.resolve(res)
    this.pump() // 다음 큐 항목 송신(FIFO).
  }

  /** 워커 종료/오류(crash). in-flight·큐 전부 reject. 다음 요청 때 1회 재기동. */
  private handleExit(): void {
    this.transport = null
    this.failAll()
    // 다음 요청이 ensureWorker 로 1회 재기동을 시도(즉시 무한 재기동 금지).
  }

  /** in-flight + 큐 전부 reject(빈 결과). pending 맵 정리. */
  private failAll(): void {
    if (this.inFlight) {
      const p = this.inFlight
      this.clearPending(p, true)
      p.reject()
    }
    while (this.queue.length > 0) {
      const q = this.queue.shift()!
      this.pending.delete(q.p.id)
      q.p.reject()
    }
  }

  /** 타이머 해제 + pending/in-flight 정리. resetInFlight=true 면 inFlight 비움. */
  private clearPending(p: Pending, resetInFlight: boolean): void {
    if (p.timer) {
      clearTimeout(p.timer)
      p.timer = null
    }
    this.pending.delete(p.id)
    if (resetInFlight && this.inFlight && this.inFlight.id === p.id) {
      this.inFlight = null
    } else if (!resetInFlight && this.inFlight && this.inFlight.id === p.id) {
      this.inFlight = null
    }
  }
}

/** 싱글톤(핸들러·before-quit 공유). 옵션 없이 = 실제 PowerShell 워커. */
export const shellVerbsService = new ShellVerbsService()
