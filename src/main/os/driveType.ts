/**
 * DriveTypeService — 매핑 네트워크 드라이브(DRIVE_REMOTE) 문자 감지·캐시 (J2 US-9.2③ / ADR-005).
 *
 * Node 에는 Win32 `GetDriveType` 네이티브 API 가 없으므로, PowerShell CIM
 * (`Win32_LogicalDisk` `DriveType=4` = `DRIVE_REMOTE`)을 execFile(셸 미경유·고정 인자)로
 * 1회 조회해 **네트워크 드라이브 문자 집합을 캐시**한다. `isNetworkDriveRoot`(paths.ts)가
 * 동기 시그니처여야 하므로 **집합 조회는 동기**, `refresh` 만 비동기다.
 *
 * 견고성:
 *   - 실패·타임아웃·비-Windows·PowerShell 부재·파싱 실패 → **빈 집합 폴백(또는 직전 캐시 유지)**.
 *     매핑 드라이브도 false → 기존 동작(UNC eager + reactive 폴백)과 바이트 동등(회귀 0).
 *   - 모든 메서드 **throw 0**(격리). queryFn 이 reject 해도 refresh 는 조용히 캐시를 유지한다.
 *   - **원자 교체**: 새 `Set` 을 만들어 참조를 1회 교체한다(clear+재삽입 금지 — 동기 조회 중
 *     빈 상태 노출 방지).
 *   - throttle(기본 30s) + 재진입 가드로 watchStart 폭주 시 PowerShell 남발을 막는다.
 *
 * 헤드리스 검증성:
 *   - 생성자 옵션 `queryFn` 으로 PowerShell 미경유 스텁 주입(raw stdout 문자열 반환).
 *   - `setNetworkDriveLetters` 로 캐시를 직접 주입(비동기 refresh 없이 동기 판정 검증).
 *
 * 보안(ADR-005 §3.3): execFile(셸 미경유)·고정 상수 스크립트(경로/사용자 입력 미주입)·
 * 출력 `^[A-Z]:` 화이트리스트 파싱·`windowsHide:true`·`timeout`.
 */
import { execFile } from 'node:child_process'

/** PowerShell CIM 조회 결과(raw stdout, 예 "Z:\r\nY:\r\n") 반환. 주입 가능(헤드리스). */
type DriveQueryFn = () => Promise<string>

export interface DriveTypeServiceOptions {
  /** 기본 = 실제 PowerShell CIM execFile 래퍼. verify 헤드리스가 스텁(raw stdout) 주입. */
  queryFn?: DriveQueryFn
  /** refresh throttle 최소 간격(ms). 기본 30_000. watchStart 폭주 시 PowerShell 남발 방지. */
  minRefreshIntervalMs?: number
}

/** PowerShell execFile timeout(ms). 콜드스타트 여유 + 무한 대기 방지. */
const QUERY_TIMEOUT_MS = 5000

/** 기본 refresh throttle 최소 간격(ms). */
const DEFAULT_MIN_REFRESH_INTERVAL_MS = 30_000

/**
 * 고정 상수 스크립트 — 경로/사용자 입력 미주입. `DriveType=4` = `DRIVE_REMOTE`.
 * DeviceID 는 로케일 무관(`Z:` 고정)이라 파싱이 안정적이다.
 */
const CIM_SCRIPT =
  "Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=4' | Select-Object -ExpandProperty DeviceID"

/** PowerShell execFile 인자(고정) — 셸 미경유·인자 배열·사용자 입력 0. */
const CIM_ARGS = ['-NoProfile', '-NonInteractive', '-Command', CIM_SCRIPT] as const

/** 출력 1줄이 드라이브 문자(`Z:`)인지 화이트리스트 검사 후 첫 글자(대문자) 추출. */
const DRIVE_LINE = /^[A-Z]:$/

/**
 * 실제 PowerShell CIM execFile 래퍼(모듈 비공개). raw stdout 문자열을 resolve 한다.
 * 비-Windows·실패·타임아웃 → 빈 문자열(파싱 결과 빈 집합 = 폴백). **throw 0**.
 */
function defaultQueryFn(): Promise<string> {
  if (process.platform !== 'win32') return Promise.resolve('') // 비-Windows: 빈 출력(회귀 0).
  return new Promise<string>((resolve) => {
    try {
      execFile(
        'powershell.exe',
        [...CIM_ARGS],
        { windowsHide: true, timeout: QUERY_TIMEOUT_MS },
        (error, stdout) => {
          // 실패/타임아웃 → 빈 출력(파싱 시 빈 집합 폴백). stdout 만 신뢰.
          resolve(error ? '' : String(stdout))
        }
      )
    } catch {
      // execFile 자체 동기 throw(예: spawn 환경 이상) 격리.
      resolve('')
    }
  })
}

/**
 * raw stdout(여러 줄)을 네트워크 드라이브 문자(대문자) 배열로 파싱한다.
 * 각 줄 trim 후 `^[A-Z]:$` 화이트리스트만 통과 → 첫 글자. 그 외 모든 출력 폐기(보안).
 */
function parseDriveLetters(stdout: string): string[] {
  if (typeof stdout !== 'string' || stdout.length === 0) return []
  const out: string[] = []
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim().toUpperCase()
    if (DRIVE_LINE.test(line)) out.push(line[0]!) // 'Z:' → 'Z'.
  }
  return out
}

export class DriveTypeService {
  /** 네트워크 드라이브 문자(대문자 단일 문자) 캐시. 원자 교체(참조 1회 교체)로만 갱신. */
  private letters: Set<string> = new Set()
  private readonly queryFn: DriveQueryFn
  private readonly minRefreshIntervalMs: number
  /** 마지막 성공 refresh 시각(throttle 기준). 0 = 미초기화. */
  private lastRefreshAt = 0
  /** 1회 이상 채워졌는지(lazy trigger 판단·throttle 게이트). */
  private initialized = false
  /** 진행 중 refresh(재진입 가드) — 동일 Promise 공유. */
  private inFlight: Promise<void> | null = null

  /**
   * @param opts.queryFn               PowerShell CIM 래퍼 대체(기본=실모듈). 헤드리스가 raw stdout 스텁 주입.
   * @param opts.minRefreshIntervalMs  refresh throttle 최소 간격(기본 30s).
   */
  constructor(opts: DriveTypeServiceOptions = {}) {
    this.queryFn = opts.queryFn ?? defaultQueryFn
    this.minRefreshIntervalMs = opts.minRefreshIntervalMs ?? DEFAULT_MIN_REFRESH_INTERVAL_MS
  }

  /**
   * 캐시 갱신(비동기·throttle·재진입 가드). 성공 시 새 `Set` 으로 **원자 교체**한다.
   * 실패/타임아웃/빈 출력 → 직전 캐시 유지(첫 호출은 빈 집합). **throw 0**(격리).
   *
   * - throttle: 마지막 성공 + minInterval 이내면 즉시 resolve(PowerShell 미호출).
   * - 재진입 가드: 진행 중이면 동일 Promise 를 공유(중복 PowerShell 0).
   */
  refresh(): Promise<void> {
    if (this.inFlight) return this.inFlight // 재진입 가드: 진행 중 호출은 공유.

    // throttle: 직전 성공 후 minInterval 이내면 스킵(이미 1회라도 초기화됐을 때만).
    if (this.initialized && Date.now() - this.lastRefreshAt < this.minRefreshIntervalMs) {
      return Promise.resolve()
    }

    this.inFlight = this.runRefresh()
    return this.inFlight
  }

  private async runRefresh(): Promise<void> {
    try {
      const stdout = await this.queryFn()
      const parsed = parseDriveLetters(stdout)
      // 원자 교체: 새 Set 생성 후 참조 1회 교체(동기 조회가 중간 빈 상태를 보지 않게).
      this.letters = new Set(parsed)
      this.lastRefreshAt = Date.now()
      this.initialized = true
    } catch {
      // queryFn reject(예: 헤드리스 스텁 throw)·예상외 오류 → 직전 캐시 유지(폴백). throw 0.
      // 첫 실패는 생성자에서 만든 빈 집합이 유지된다(회귀 0).
    } finally {
      this.inFlight = null
    }
  }

  /**
   * 드라이브 문자(`'Z'` 또는 `'Z:'`, 대소문자 무시)가 네트워크 드라이브인지 **동기** 판정.
   * 캐시 미초기화·미등록 → false. throw 0.
   */
  isNetworkDriveLetter(letter: string): boolean {
    if (typeof letter !== 'string' || letter.length === 0) return false
    const ch = letter.charAt(0).toUpperCase()
    if (ch < 'A' || ch > 'Z') return false
    return this.letters.has(ch)
  }

  /** 캐시가 1회 이상 채워졌는지(lazy trigger 판단용). */
  isInitialized(): boolean {
    return this.initialized
  }

  /**
   * 캐시 직접 주입(헤드리스 검증·강제). 대문자 단일 문자로 정규화해 **원자 교체**한다.
   * 호출 시 initialized=true 로 표시(테스트가 throttle/초기화 상태도 제어 가능).
   */
  setNetworkDriveLetters(letters: Iterable<string>): void {
    const next = new Set<string>()
    for (const l of letters) {
      if (typeof l !== 'string' || l.length === 0) continue
      const ch = l.charAt(0).toUpperCase()
      if (ch >= 'A' && ch <= 'Z') next.add(ch)
    }
    this.letters = next // 원자 교체.
    this.initialized = true
    this.lastRefreshAt = Date.now()
  }
}

/** 싱글턴(paths.ts·index.ts·WatchService 공유). 옵션 없이 = 실 PowerShell 쿼리. */
export const driveTypeService = new DriveTypeService()
