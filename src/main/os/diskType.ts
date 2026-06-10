/**
 * DiskTypeService — 드라이브 문자 → 미디어 종류(SSD/HDD/Unknown) 감지·캐시.
 *
 * 목적: 파일 작업 동시성(copy/move/delete)을 **SSD 볼륨에서 상향**하기 위해 Main 에서
 * 드라이브별 미디어 종류를 1회 조회해 캐시한다. SSD 는 랜덤 I/O 비용이 낮아 같은 볼륨에서도
 * 병렬 이득이 있고, HDD/Unknown 은 시킹 악화 위험으로 보수적(=비-SSD) 처리한다.
 *
 * `driveType.ts`(DriveTypeService) 의 규약을 그대로 미러한다:
 *   - PowerShell 을 `execFile`(셸 미경유·고정 상수 스크립트·경로/사용자 입력 미주입)로 1회 조회.
 *   - 출력 줄을 `^([A-Z]):(.+)$` 화이트리스트로 파싱(그 외 모든 출력 폐기 — 보안).
 *   - 캐시는 `Map<letter,'ssd'|'hdd'|'unknown'>` 를 **원자 교체**(참조 1회 교체)로만 갱신.
 *   - throttle(기본 30s) + 재진입 가드로 PowerShell 남발 방지.
 *   - 실패·타임아웃·비-Windows·PowerShell 부재·파싱 실패 → **빈 맵 폴백(또는 직전 캐시 유지)**.
 *     미확정·미등록 → `isSsd` false(=비-SSD = 보수적). 기존 동시성 숫자와 회귀 0.
 *   - 모든 메서드 **throw 0**(격리). queryFn reject 해도 refresh 는 조용히 캐시를 유지한다.
 *
 * 헤드리스 검증성:
 *   - 생성자 옵션 `queryFn` 으로 PowerShell 미경유 스텁 주입(raw stdout 문자열 반환).
 *   - `setDiskTypes` 로 캐시를 직접 주입(비동기 refresh 없이 동기 판정 검증).
 *   - 라인 파서 `parseDiskTypeLines` 를 모듈 export 하여 단위 검증(verify:concurrency).
 *
 * 보안: execFile(셸 미경유)·고정 상수 스크립트·출력 화이트리스트 파싱·`windowsHide:true`·`timeout`.
 */
import { execFile } from 'node:child_process'

/** 미디어 종류 분류. unknown 은 보수적으로 비-SSD 취급. */
export type DiskMediaType = 'ssd' | 'hdd' | 'unknown'

/** PowerShell 조회 결과(raw stdout, 예 "C:SSD\r\nD:HDD\r\n") 반환. 주입 가능(헤드리스). */
type DiskQueryFn = () => Promise<string>

export interface DiskTypeServiceOptions {
  /** 기본 = 실제 PowerShell execFile 래퍼. verify 헤드리스가 스텁(raw stdout) 주입. */
  queryFn?: DiskQueryFn
  /** refresh throttle 최소 간격(ms). 기본 30_000. */
  minRefreshIntervalMs?: number
}

/** PowerShell execFile timeout(ms). 콜드스타트 여유 + 무한 대기 방지. */
const QUERY_TIMEOUT_MS = 5000

/** 기본 refresh throttle 최소 간격(ms). */
const DEFAULT_MIN_REFRESH_INTERVAL_MS = 30_000

/**
 * 고정 상수 스크립트 — 경로/사용자 입력 미주입.
 * 각 물리 디스크의 MediaType 을, 그 디스크의 드라이브 문자가 있는 파티션마다 "<letter>:<media>" 로
 * 출력한다. 예: `C:SSD`, `D:HDD`, `D:Unspecified`. MediaType 은 머신에 따라 텍스트(SSD/HDD/
 * Unspecified) 또는 숫자(4=SSD·3=HDD)로 나올 수 있어 파서가 둘 다 분류한다.
 */
const DISK_SCRIPT =
  'Get-PhysicalDisk | ForEach-Object { $m=$_.MediaType; ' +
  'Get-Partition -DiskNumber $_.DeviceId -ErrorAction SilentlyContinue | ' +
  'Where-Object DriveLetter | ForEach-Object { "$($_.DriveLetter):$m" } }'

/** PowerShell execFile 인자(고정) — 셸 미경유·인자 배열·사용자 입력 0. */
const DISK_ARGS = ['-NoProfile', '-NonInteractive', '-Command', DISK_SCRIPT] as const

/** 출력 1줄이 "<대문자>:<미디어>" 형태인지 화이트리스트 검사 후 캡처. */
const DISK_LINE = /^([A-Z]):(.+)$/

/**
 * 미디어 문자열/숫자를 분류한다. SSD(또는 숫자 4) → ssd, HDD(또는 숫자 3) → hdd, 그 외 unknown.
 * 대소문자 무시·앞뒤 공백 허용. `Unspecified`·빈 값·미상은 unknown(=보수적 비-SSD).
 */
function classifyMedia(raw: string): DiskMediaType {
  const v = raw.trim().toUpperCase()
  if (v === '') return 'unknown'
  // 숫자 MediaType(일부 머신): 4=SSD, 3=HDD.
  if (v === '4') return 'ssd'
  if (v === '3') return 'hdd'
  // 텍스트 MediaType: 'SSD' 포함 → ssd, 'HDD' 포함 → hdd. 'Unspecified' 등은 unknown.
  if (v.includes('SSD')) return 'ssd'
  if (v.includes('HDD')) return 'hdd'
  return 'unknown'
}

/**
 * 실제 PowerShell execFile 래퍼(모듈 비공개). raw stdout 문자열을 resolve 한다.
 * 비-Windows·실패·타임아웃 → 빈 문자열(파싱 결과 빈 맵 = 폴백). **throw 0**.
 */
function defaultQueryFn(): Promise<string> {
  if (process.platform !== 'win32') return Promise.resolve('') // 비-Windows: 빈 출력(회귀 0).
  return new Promise<string>((resolve) => {
    try {
      execFile(
        'powershell.exe',
        [...DISK_ARGS],
        { windowsHide: true, timeout: QUERY_TIMEOUT_MS },
        (error, stdout) => {
          // 실패/타임아웃 → 빈 출력(파싱 시 빈 맵 폴백). stdout 만 신뢰.
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
 * raw stdout(여러 줄)을 `{ letter, media }` 배열로 파싱한다(모듈 export — verify 단위검증).
 * 각 줄 trim 후 `^([A-Z]):(.+)$` 화이트리스트만 통과 → 첫 글자(대문자) + 미디어 분류.
 * 그 외 모든 출력(빈 줄·헤더·잡음)은 폐기(보안). 중복 문자는 마지막 줄이 우선(거의 없음).
 */
export function parseDiskTypeLines(stdout: string): Array<{ letter: string; media: DiskMediaType }> {
  if (typeof stdout !== 'string' || stdout.length === 0) return []
  const out: Array<{ letter: string; media: DiskMediaType }> = []
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim()
    const m = DISK_LINE.exec(line)
    if (!m) continue // 화이트리스트 미통과 → 폐기.
    out.push({ letter: m[1]!.toUpperCase(), media: classifyMedia(m[2]!) })
  }
  return out
}

/** 미디어 분류기 노출(헤드리스 단위 검증 전용 — verify:concurrency). 런타임 동작과 무관. */
export function classifyMediaForTest(raw: string): DiskMediaType {
  return classifyMedia(raw)
}

export class DiskTypeService {
  /** 드라이브 문자(대문자) → 미디어 종류 캐시. 원자 교체(참조 1회 교체)로만 갱신. */
  private types: Map<string, DiskMediaType> = new Map()
  private readonly queryFn: DiskQueryFn
  private readonly minRefreshIntervalMs: number
  /** 마지막 성공 refresh 시각(throttle 기준). 0 = 미초기화. */
  private lastRefreshAt = 0
  /** 1회 이상 채워졌는지(throttle 게이트). */
  private initialized = false
  /** 진행 중 refresh(재진입 가드) — 동일 Promise 공유. */
  private inFlight: Promise<void> | null = null

  /**
   * @param opts.queryFn               PowerShell 래퍼 대체(기본=실모듈). 헤드리스가 raw stdout 스텁 주입.
   * @param opts.minRefreshIntervalMs  refresh throttle 최소 간격(기본 30s).
   */
  constructor(opts: DiskTypeServiceOptions = {}) {
    this.queryFn = opts.queryFn ?? defaultQueryFn
    this.minRefreshIntervalMs = opts.minRefreshIntervalMs ?? DEFAULT_MIN_REFRESH_INTERVAL_MS
  }

  /**
   * 캐시 갱신(비동기·throttle·재진입 가드). 성공 시 새 `Map` 으로 **원자 교체**한다.
   * 실패/타임아웃/빈 출력 → 직전 캐시 유지(첫 호출은 빈 맵). **throw 0**(격리).
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
      const parsed = parseDiskTypeLines(stdout)
      // 빈 결과(쿼리 실패 추정)는 직전 캐시 유지(회귀 0) — 빈 맵으로 덮어쓰지 않는다.
      if (parsed.length === 0 && this.initialized) return
      // 원자 교체: 새 Map 생성 후 참조 1회 교체(동기 조회가 중간 빈 상태를 보지 않게).
      const next = new Map<string, DiskMediaType>()
      for (const { letter, media } of parsed) next.set(letter, media)
      this.types = next
      this.lastRefreshAt = Date.now()
      this.initialized = true
    } catch {
      // queryFn reject(예: 헤드리스 스텁 throw)·예상외 오류 → 직전 캐시 유지(폴백). throw 0.
    } finally {
      this.inFlight = null
    }
  }

  /**
   * 드라이브 문자(`'C'` 또는 `'C:'`, 대소문자 무시)의 미디어 종류를 **동기** 조회.
   * 미초기화·미등록 → 'unknown'. throw 0.
   */
  mediaTypeOf(letter: string): DiskMediaType {
    if (typeof letter !== 'string' || letter.length === 0) return 'unknown'
    const ch = letter.charAt(0).toUpperCase()
    if (ch < 'A' || ch > 'Z') return 'unknown'
    return this.types.get(ch) ?? 'unknown'
  }

  /**
   * 드라이브 문자가 **SSD 인지** 동기 판정. ssd 일 때만 true. hdd·unknown·미등록 → false
   * (보수적 — 불확실하면 SSD 아님). throw 0.
   */
  isSsd(letter: string): boolean {
    return this.mediaTypeOf(letter) === 'ssd'
  }

  /** 캐시가 1회 이상 채워졌는지. */
  isInitialized(): boolean {
    return this.initialized
  }

  /**
   * 캐시 직접 주입(헤드리스 검증·강제). 대문자 단일 문자로 정규화해 **원자 교체**한다.
   * 호출 시 initialized=true 로 표시(테스트가 throttle/초기화 상태도 제어 가능).
   */
  setDiskTypes(entries: Iterable<[string, DiskMediaType]>): void {
    const next = new Map<string, DiskMediaType>()
    for (const [l, media] of entries) {
      if (typeof l !== 'string' || l.length === 0) continue
      const ch = l.charAt(0).toUpperCase()
      if (ch >= 'A' && ch <= 'Z') next.set(ch, media)
    }
    this.types = next // 원자 교체.
    this.initialized = true
    this.lastRefreshAt = Date.now()
  }
}

/** 싱글턴(OperationManager·index.ts 공유). 옵션 없이 = 실 PowerShell 쿼리. */
export const diskTypeService = new DiskTypeService()
