/**
 * src/main/agent/provider/ssrfGuard.ts — 내부 엔드포인트 SSRF 방어(ADR-015 G4·D8).
 *
 * 내부 자체 모델 base URL 은 사용자 입력이다. **화이트리스트 등록(1~4단계) + 요청 직전
 * 재검증(1~6단계·DNS 포함)** 의 2중 게이트로 SSRF 를 통제한다. 렌더러는 검증에 관여하지
 * 않는다(우회 불가). 내부 provider 는 이 게이트를 거치는 fetch 만 SDK 에 주입한다.
 *
 * ── 정책 B(완화·사용자 결정 2026-06-14) ──────────────────────────────────────
 * 로컬 LLM 서버(LM Studio·Ollama 등 `127.0.0.1`)·사내 LAN 게이트웨이를 사용자가
 * **설정에서 직접 등록**할 수 있게 loopback·사설 LAN 을 **허용**한다. 이 정책은
 * **사용자가 명시 등록한 내부 엔드포인트(BYO base URL)에만** 적용되며 — base URL 은
 * 사용자가 고르는 값이지 LLM 이 자율로 정하는 값이 아니다. 화이트리스트 요구는 유지
 * (등록한 호스트만 통로). 단, **링크로컬/클라우드 메타데이터/unspecified 는 계속 차단**
 * (보안 핵심): IPv4 `169.254.0.0/16`(메타데이터 `169.254.169.254` 포함)·`0.0.0.0`,
 * IPv6 `fe80::/10`·`::`, 그리고 위 대역의 IPv4-매핑 IPv6(`::ffff:169.254.x` 등).
 *
 * 1~4단계는 **순수**(IP 판정·호스트 정규화·화이트리스트 매칭)이며, 5단계(DNS 리바인딩)만
 * `node:dns` lookup 1지점을 쓴다(주입 가능 — 헤드리스 verify 가 스텁 lookup 으로 검증).
 * `node:dns` import 는 `src/main/agent/` 화이트리스트 안에서만 허용된다(.eslintrc G8).
 */
import type { Result } from '@shared/ipc/contracts'
import { err, ok } from '@shared/ipc/contracts'
import { fileOpError } from '../../fs/errors'

/** DNS lookup 추상(주입 가능). 기본은 node:dns.promises.lookup(all:true). */
export interface DnsLookup {
  (hostname: string): Promise<ReadonlyArray<{ address: string; family: number }>>
}

/** 정규화된 호스트(소문자·trailing dot 제거)·포트. */
export interface NormalizedHost {
  readonly hostname: string
  readonly port: number
  readonly scheme: string
  /** `host:port`(화이트리스트 비교 키). */
  readonly key: string
}

// ── 1단계: 스킴 ─────────────────────────────────────────────────────────

const ALLOWED_SCHEMES = new Set(['https:', 'http:'])

// ── 2단계: 호스트 정규화 ──────────────────────────────────────────────────

/** URL 을 파싱·정규화한다(소문자·trailing dot 제거·기본 포트 결정). 실패 시 null. */
export function normalizeUrl(url: string): NormalizedHost | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (!ALLOWED_SCHEMES.has(u.protocol)) return null
  let hostname = u.hostname.toLowerCase()
  if (hostname.endsWith('.')) hostname = hostname.slice(0, -1)
  if (hostname === '') return null
  const port = u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null
  return { hostname, port, scheme: u.protocol, key: `${hostname}:${port}` }
}

// ── 4단계: IP 리터럴 차단 ──────────────────────────────────────────────────

/** IPv4 점표기 판정 + 옥텟. */
function parseIPv4(host: string): readonly number[] | null {
  const parts = host.split('.')
  if (parts.length !== 4) return null
  const nums: number[] = []
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null
    const n = Number(p)
    if (n < 0 || n > 255) return null
    nums.push(n)
  }
  return nums
}

/**
 * IPv4 가 차단 대상이면 true.
 *
 * 정책 B(2026-06-14): loopback(`127/8`)·사설 LAN(`10/8`·`172.16/12`·`192.168/16`)·
 * CGNAT(`100.64/10`)는 **허용**(사용자가 등록한 로컬 LLM·사내 게이트웨이용). 보안 핵심인
 * 링크로컬/클라우드 메타데이터/unspecified 와 비라우팅(멀티캐스트·예약)은 **계속 차단**.
 */
export function isBlockedIPv4(octets: readonly number[]): boolean {
  const [a, b] = octets
  if (a === 0) return true // 0.0.0.0/8 unspecified(차단 유지)
  if (a === 169 && b === 254) return true // 169.254/16 링크로컬(+169.254.169.254 메타데이터·차단 유지)
  if (a! >= 224 && a! <= 239) return true // 멀티캐스트 224-239(차단 유지)
  if (a! >= 240) return true // 예약/브로드캐스트(차단 유지)
  // ── 정책 B 로 허용(이전엔 차단) ──────────────────────────────────────────
  // 127/8 loopback·10/8·172.16/12·192.168/16 사설·100.64/10 CGNAT → 허용.
  return false
}

/**
 * IPv6 가 차단 대상이면 true.
 *
 * 정책 B(2026-06-14): loopback(`::1`)·ULA(`fc00::/7`)는 **허용**(IPv6 로컬/사내용).
 * 보안 핵심인 링크로컬(`fe80::/10`)·미지정(`::`)은 **계속 차단**. IPv4-매핑 IPv6 은
 * 매핑 IPv4 를 복원해 `isBlockedIPv4`(=정책 B)에 위임하므로, `::ffff:169.254.x` 등
 * 차단 대역은 계속 거부되고 `::ffff:127.x`·`::ffff:10.x` 등은 허용된다.
 */
export function isBlockedIPv6(host: string): boolean {
  let h = host.toLowerCase()
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1)
  if (h === '::' || h === '::0') return true // 미지정(차단 유지)
  if (h.startsWith('fe80:') || h.startsWith('fe80::')) return true // 링크로컬(차단 유지)
  // ── 정책 B 로 허용(이전엔 차단) ──────────────────────────────────────────
  // ::1 loopback·fc00::/7 ULA → 허용.
  // IPv4-매핑(::ffff:a.b.c.d 및 정규화 헥스텟형)은 매핑 IPv4 를 복원해 정책 B 판정에 위임.
  const mappedV4 = extractMappedIPv4(h)
  if (mappedV4 && isBlockedIPv4(mappedV4)) return true
  return false
}

/**
 * IPv4-매핑 IPv6(::ffff:0:0/96)에서 내장 IPv4 옥텟을 복원한다. 점표기뿐 아니라
 * `new URL()` 이 내놓는 **헥스텟 압축형 `::ffff:HHHH:HHHH`**·비압축형
 * `0:0:0:0:0:ffff:...`·`[]` 브래킷·대소문자를 전부 인식한다. 매핑 아니면 null.
 *
 * 배경: WHATWG URL 파서는 `[::ffff:169.254.169.254]` 를 `[::ffff:a9fe:a9fe]` 로
 * 정규화한다. 점표기만 매칭하던 기존 정규식은 실 요청 경로(new URL 거친 호스트)를
 * 통과시켜 SSRF 차단이 우회됐다.
 */
function extractMappedIPv4(host: string): readonly number[] | null {
  let h = host.toLowerCase()
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1)
  // 선두 압축 `::ffff:` 또는 비압축 `0:0:0:0:0:ffff:` 접두를 정규화해 떼어낸다.
  const prefixes = ['::ffff:', '0:0:0:0:0:ffff:']
  let rest: string | null = null
  for (const p of prefixes) {
    if (h.startsWith(p)) {
      rest = h.slice(p.length)
      break
    }
  }
  if (rest === null) return null
  // 형태 1: 내장 IPv4 가 점표기(::ffff:a.b.c.d).
  if (rest.includes('.')) return parseIPv4(rest)
  // 형태 2: 헥스텟 압축형(::ffff:HHHH:HHHH) — new URL() 정규화 산출물.
  const hextets = rest.split(':')
  if (hextets.length !== 2) return null
  const nums: number[] = []
  for (const hx of hextets) {
    if (!/^[0-9a-f]{1,4}$/.test(hx)) return null
    const word = parseInt(hx, 16)
    nums.push((word >> 8) & 0xff, word & 0xff)
  }
  return nums.length === 4 ? nums : null
}

/** 호스트(또는 IP 주소)가 차단 IP 리터럴이면 true. 도메인이면 false(여기선 통과·5단계 DNS). */
export function isBlockedIpLiteral(host: string): boolean {
  const v4 = parseIPv4(host)
  if (v4) return isBlockedIPv4(v4)
  if (host.includes(':')) return isBlockedIPv6(host) // IPv6 리터럴
  return false
}

// ── 등록 검증(1~4단계·순수) ────────────────────────────────────────────────

/**
 * 설정 등록 시 형식 검증(1~4단계). 화이트리스트 추가 전 호출.
 * - 스킴·정규화·IP 리터럴 차단 검사.
 * - 화이트리스트 매칭은 여기서 강제하지 않음(등록 자체가 화이트리스트에 추가하는 행위).
 */
export function validateRegister(url: string): Result<NormalizedHost> {
  const norm = normalizeUrl(url)
  if (!norm) {
    return err(fileOpError('EINVAL', '유효하지 않은 base URL(https/http·호스트 필요).', url))
  }
  if (isBlockedIpLiteral(norm.hostname)) {
    return err(
      fileOpError(
        'ESECURITY',
        '링크로컬/클라우드 메타데이터/미지정 IP 는 등록할 수 없습니다.',
        url
      )
    )
  }
  return ok(norm)
}

// ── 요청 직전 검증(1~6단계·DNS 포함) ──────────────────────────────────────

/** 화이트리스트 정확 일치(정규화 `host:port`). */
export function matchesAllowList(norm: NormalizedHost, allowList: readonly string[]): boolean {
  const set = new Set(allowList.map((s) => s.trim().toLowerCase()))
  if (set.has(norm.key)) return true
  // 기본 포트 생략 등록도 허용(host 만 등록 → host:기본포트 매칭).
  if (set.has(norm.hostname)) return true
  return false
}

/**
 * 요청 직전 전체 검증(1~6단계). InternalOpenAICompatProvider.createCompletion 진입에서 호출.
 * - 1~4: 형식·IP 리터럴.
 * - 3: 화이트리스트 정확 일치.
 * - 5: 도메인이면 DNS lookup(all) → 해석 IP 중 차단 IP 있으면 거부(리바인딩 방어).
 * - 6단계(리다이렉트 0)는 fetch 주입측에서 redirect:'error' 로 강제(여기선 URL 검증만).
 */
export async function assertRequestAllowed(
  url: string,
  allowList: readonly string[],
  lookup?: DnsLookup
): Promise<Result<void>> {
  const norm = normalizeUrl(url)
  if (!norm) return err(fileOpError('EINVAL', '유효하지 않은 요청 URL.', url))
  if (!matchesAllowList(norm, allowList)) {
    return err(fileOpError('ESECURITY', '화이트리스트에 없는 호스트로의 요청은 차단됩니다.', url))
  }
  if (isBlockedIpLiteral(norm.hostname)) {
    return err(fileOpError('ESECURITY', '링크로컬/메타데이터/미지정 IP 로의 요청은 차단됩니다.', url))
  }
  // 도메인이면 DNS 리바인딩 방어(5단계).
  const isIpLiteral = parseIPv4(norm.hostname) !== null || norm.hostname.includes(':')
  if (!isIpLiteral) {
    const resolver = lookup ?? defaultLookup
    let addrs: ReadonlyArray<{ address: string; family: number }>
    try {
      addrs = await resolver(norm.hostname)
    } catch {
      return err(fileOpError('EHOSTUNREACH', '호스트 DNS 해석에 실패했습니다.', url))
    }
    if (addrs.length === 0) {
      return err(fileOpError('EHOSTUNREACH', '호스트가 해석되지 않습니다.', url))
    }
    for (const a of addrs) {
      if (isBlockedIpLiteral(a.address)) {
        return err(
          fileOpError(
            'ESECURITY',
            '호스트가 링크로컬/메타데이터/미지정 IP 로 해석됩니다(DNS 리바인딩 차단).',
            url
          )
        )
      }
    }
  }
  return ok(undefined)
}

/** 기본 DNS lookup(node:dns.promises.lookup all:true). agent/ 화이트리스트 내에서만 import. */
const defaultLookup: DnsLookup = async (hostname) => {
  // 지연 import — verify 는 스텁 lookup 을 주입하므로 이 경로를 타지 않는다.
  const dns = await import('node:dns')
  const res = await dns.promises.lookup(hostname, { all: true })
  return res.map((r) => ({ address: r.address, family: r.family }))
}
