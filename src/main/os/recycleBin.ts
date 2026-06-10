/**
 * RecycleBinService — Windows 휴지통 열거·복원·비우기 (K장 K2, K1 공유 · ADR-005).
 *
 * Node/Electron 에는 휴지통 **열거·복원** 네이티브 API 가 없다(`shell.trashItem` 은
 * 보내기 전용). driveType.ts·shell.ts(showProperties)에서 확립된
 * **execFile + 고정 스크립트 + 환경변수 주입 + headless 함수 주입** 패턴을 결합해
 * PowerShell Shell.Application COM(`NameSpace(0xA)` = 휴지통 가상 폴더)을 호출한다.
 *
 * 보안(ADR-005 §3.3 / driveType·shell 선례):
 *  - 스크립트는 **고정 상수**. 가변 데이터(복원할 $R id 목록)는 **명령행 보간 금지** →
 *    환경변수(EXPLORER_TRASH_IDS, 개행 join)로 전달하고 스크립트가 `$env:` 로 읽는다
 *    (showProperties 의 EXPLORER_PROP_* 패턴).
 *  - id 는 `$Recycle.Bin` 하위 경로 화이트리스트만 통과(임의 경로 실행 차단) — 서비스·
 *    핸들러 양쪽에서 재검증.
 *  - empty 는 호출측(핸들러)이 confirmed 게이트를 통과시킨 뒤에만 호출.
 *
 * 견고성(throw 0):
 *  - 모든 메서드 격리 — 실패·타임아웃·비-Windows·파싱오류 → 빈 목록/실패 Result 신호
 *    반환(throw 금지). 핸들러가 Result.err 로 변환.
 *  - 복원 동사명은 로케일 의존('복원' vs 'Restore') → 정규식 탐색. 동사 부재 시
 *    `Move-Item` 폴백, 원위치 동명 충돌 시 **덮어쓰기 금지**(존재 검사 후 실패 격리).
 *
 * 헤드리스 검증성:
 *  - 생성자 옵션 `listFn`(raw stdout JSON)·`restoreFn`·`emptyFn` 주입으로 PowerShell
 *    미경유 스텁 주입(verify-recyclebin.ts).
 */
import { execFile } from 'node:child_process'
import type { TrashItemDTO } from '@shared/dto'

/** PowerShell execFile timeout(ms) — 휴지통 대용량/콜드스타트 여유. */
const QUERY_TIMEOUT_MS = 15_000

/**
 * 복원/비우기 1회 실행 결과 신호. throw 대신 ok 플래그로 격리(핸들러가 Result 변환).
 * message 는 진단·로그용(부분 실패 사유).
 */
export interface RecycleInvokeResult {
  readonly ok: boolean
  readonly message?: string
}

/** list 스크립트 raw stdout(JSON) 반환. headless 주입(PowerShell 미경유 스텁). */
export type TrashListFn = () => Promise<string>
/** restore 실행 래퍼(부수효과). ids = $R 실경로 토큰 배열. headless 주입. */
export type TrashRestoreFn = (ids: string[]) => Promise<RecycleInvokeResult>
/** empty 실행 래퍼(부수효과). headless 주입. */
export type TrashEmptyFn = () => Promise<RecycleInvokeResult>

export interface RecycleBinServiceOptions {
  /** 기본 = 실제 PowerShell COM execFile 래퍼. verify 가 raw stdout(JSON) 스텁 주입. */
  listFn?: TrashListFn
  /** 기본 = 실제 PowerShell COM 복원 래퍼. verify 가 부수효과 스텁 주입. */
  restoreFn?: TrashRestoreFn
  /** 기본 = 실제 Clear-RecycleBin 래퍼. verify 가 부수효과 스텁 주입. */
  emptyFn?: TrashEmptyFn
}

/**
 * 휴지통 항목 id($R 실경로)가 `$Recycle.Bin` 하위 경로인지 화이트리스트 검사.
 * 대소문자 무시. 임의 경로(예: `C:\Windows\system32\...`) 실행 차단의 1차 방어.
 * 핸들러도 동일 검사를 재수행(방어 심층).
 */
export function isRecycleBinPath(id: string): boolean {
  if (typeof id !== 'string' || id.length === 0) return false
  // "...\$Recycle.Bin\..." 또는 "...\RECYCLER\..." (구버전) — '$Recycle.Bin' 만 허용.
  return /\\\$Recycle\.Bin\\/i.test(id)
}

// ── list: PowerShell COM 열거 스크립트(고정 상수) ─────────────────────────────
/**
 * 고정 상수 스크립트 — 사용자 입력 미주입. NameSpace(0xA)=휴지통.
 * 각 item: Name·Path($R 실경로=id)·원래경로(DeletedFrom\Name)·삭제일(DateDeleted)·Size.
 * 단일 항목도 배열로(@()), `ConvertTo-Json -Compress -Depth 3`.
 *
 * 원래경로: ExtendedProperty('System.Recycle.DeletedFrom') 가 가용하면 우선,
 * 폴백으로 GetDetailsOf 의 'Original Location'/'원래 위치' 열을 탐색.
 * 삭제일: ExtendedProperty('System.Recycle.DateDeleted') → DateTime → epoch ms.
 */
const LIST_SCRIPT = [
  // 한글(비-ASCII) 파일명·경로가 깨지지 않도록 stdout 을 UTF-8 로 출력(Node 가 utf8 로 디코드).
  // 미설정 시 OEM 코드페이지(cp949 등)로 출력돼 ConvertTo-Json 한글이 깨진다(드라이브 볼륨명 스크립트 동형).
  '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;',
  '$ErrorActionPreference = "Stop";',
  '$sh = New-Object -ComObject Shell.Application;',
  '$bin = $sh.NameSpace(0xA);',
  'if ($null -eq $bin) { "[]"; exit 0 }',
  '$out = @();',
  'foreach ($it in $bin.Items()) {',
  '  $deletedFrom = "";',
  '  try { $deletedFrom = [string]$it.ExtendedProperty("System.Recycle.DeletedFrom") } catch {}',
  '  if ([string]::IsNullOrEmpty($deletedFrom)) {',
  '    for ($c = 0; $c -lt 320; $c++) {',
  '      $h = $bin.GetDetailsOf($null, $c);',
  '      if ($h -match "^(Original Location|원래 위치)$") {',
  '        $deletedFrom = $bin.GetDetailsOf($it, $c); break;',
  '      }',
  '    }',
  '  }',
  '  $delMs = 0;',
  '  try {',
  '    $dt = $it.ExtendedProperty("System.Recycle.DateDeleted");',
  '    if ($dt -is [datetime]) { $delMs = [int64](($dt.ToUniversalTime() - (Get-Date "1970-01-01 00:00:00Z").ToUniversalTime()).TotalMilliseconds) }',
  '  } catch {}',
  '  $orig = "";',
  '  if (-not [string]::IsNullOrEmpty($deletedFrom)) { $orig = (Join-Path $deletedFrom $it.Name) }',
  '  $size = 0;',
  '  try { if (-not $it.IsFolder) { $size = [int64]$it.Size } } catch {}',
  '  $out += [pscustomobject]@{ id = [string]$it.Path; name = [string]$it.Name; originalPath = [string]$orig; deletedAt = $delMs; size = $size };',
  '}',
  'ConvertTo-Json -InputObject @($out) -Compress -Depth 3'
].join(' ')

const PS_BASE_ARGS = ['-NoProfile', '-NonInteractive', '-Command'] as const

/** stderr 첫 비어있지 않은 줄(실제 PowerShell 오류 메시지). 없으면 null. */
function firstLine(stderr: unknown): string | null {
  if (typeof stderr !== 'string') return null
  const line = stderr
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0)
  return line ?? null
}

/**
 * 실제 PowerShell COM 열거 execFile 래퍼(모듈 비공개). raw stdout(JSON) resolve.
 * 비-Windows·실패·타임아웃 → '[]'(빈 목록 폴백). **throw 0**.
 */
function defaultListFn(): Promise<string> {
  if (process.platform !== 'win32') return Promise.resolve('[]')
  return new Promise<string>((resolve) => {
    try {
      execFile(
        'powershell.exe',
        [...PS_BASE_ARGS, LIST_SCRIPT],
        { windowsHide: true, timeout: QUERY_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 },
        (error, stdout) => {
          resolve(error ? '[]' : String(stdout))
        }
      )
    } catch {
      resolve('[]')
    }
  })
}

// ── restore: PowerShell COM 복원 스크립트(고정 상수, id 는 env 주입) ──────────
/**
 * 고정 상수 스크립트 — id 목록은 EXPLORER_TRASH_IDS(개행 join) env 로 주입(보간 0).
 * NameSpace(0xA) 항목 중 Path 가 주입 id 와 일치하는 항목을 찾아:
 *  - '복원|Restore' 동사를 정규식 탐색해 InvokeVerb. 동사 부재 시 Move-Item 폴백.
 *  - 폴백 이동 전 원위치 존재 검사 → **동명 충돌 시 덮어쓰기 금지**(해당 항목 실패 격리).
 * 결과: 실패가 1건이라도 있으면 비0 exit(핸들러가 부분 실패로 Result.err 변환).
 */
const RESTORE_SCRIPT = [
  // 전역 Stop 미사용: try 밖의 COM 호출(Verbs 등) 오류가 스크립트 전체를 중단시키지 않도록
  // 항목 단위 try/catch 로 격리하고 실패만 $failed 로 집계한다.
  '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;', // 한글 오류 메시지 깨짐 방지.
  '$raw = $env:EXPLORER_TRASH_IDS;',
  'if ([string]::IsNullOrEmpty($raw)) { exit 0 }',
  '$ids = $raw -split "`n" | Where-Object { $_ -ne "" };',
  '$sh = New-Object -ComObject Shell.Application;',
  '$bin = $sh.NameSpace(0xA);',
  'if ($null -eq $bin) { exit 2 }',
  '$failed = 0;',
  'foreach ($id in $ids) {',
  '  try {',
  '    $item = $null;',
  '    foreach ($it in $bin.Items()) { if ([string]$it.Path -eq $id) { $item = $it; break } }',
  '    if ($null -eq $item) { $failed++; continue }',
  '    $verb = $null;',
  '    try { $verb = $item.Verbs() | Where-Object { ($_.Name -replace "&","") -match "(복원|restore)" } | Select-Object -First 1 } catch {}',
  '    if ($null -ne $verb) { try { $verb.DoIt(); Start-Sleep -Milliseconds 150 } catch {} }',
  '    if (-not (Test-Path -LiteralPath $id)) { continue }', // $R 사라짐 = 복원 성공.
  '    $deletedFrom = "";',
  '    try { $deletedFrom = [string]$item.ExtendedProperty("System.Recycle.DeletedFrom") } catch {}',
  '    if ([string]::IsNullOrEmpty($deletedFrom)) { $failed++; continue }',
  '    $dest = Join-Path $deletedFrom $item.Name;',
  '    if (Test-Path -LiteralPath $dest) { $failed++; continue }',
  '    if (-not (Test-Path -LiteralPath $deletedFrom)) { try { New-Item -ItemType Directory -Path $deletedFrom -Force | Out-Null } catch {} }',
  '    try { Move-Item -LiteralPath $id -Destination $dest -ErrorAction Stop } catch { $failed++ }',
  '  } catch { $failed++ }',
  '}',
  'if ($failed -gt 0) { exit (10 + $failed) }'
].join(' ')

/**
 * 실제 PowerShell COM 복원 execFile 래퍼(모듈 비공개). id 는 env 주입(보간 0).
 * 비-Windows → 실패 신호(복원 불가). **throw 0**.
 */
function defaultRestoreFn(ids: string[]): Promise<RecycleInvokeResult> {
  if (process.platform !== 'win32') {
    return Promise.resolve({ ok: false, message: '복원은 Windows 에서만 지원됩니다.' })
  }
  return new Promise<RecycleInvokeResult>((resolve) => {
    try {
      execFile(
        'powershell.exe',
        [...PS_BASE_ARGS, RESTORE_SCRIPT],
        {
          windowsHide: true,
          timeout: QUERY_TIMEOUT_MS,
          env: { ...process.env, EXPLORER_TRASH_IDS: ids.join('\n') }
        },
        (error, _stdout, stderr) => {
          if (!error) {
            resolve({ ok: true })
            return
          }
          // execFile 은 비0 종료 시 error.code = 종료코드. 스크립트 규약으로 사유 안내.
          const code = typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : undefined
          if (code === 2) resolve({ ok: false, message: '휴지통에 접근할 수 없습니다.' })
          else if (code !== undefined && code >= 10)
            resolve({
              ok: false,
              message: `${code - 10}개 항목을 복원하지 못했습니다(원래 위치에 같은 이름이 있거나 사용 중·권한 없음).`
            })
          else resolve({ ok: false, message: firstLine(stderr) ?? '복원에 실패했습니다.' })
        }
      )
    } catch (e) {
      resolve({ ok: false, message: e instanceof Error ? e.message : '복원 실행 실패' })
    }
  })
}

// ── empty: Clear-RecycleBin → COM 폴백(고정 상수) ─────────────────────────────
/**
 * 고정 상수 스크립트 — 사용자 입력 0. PS5+ Clear-RecycleBin -Force 우선,
 * 실패 시 COM(NameSpace(0xA) 각 항목 InvokeVerb 'Delete'|'삭제')로 폴백.
 */
const EMPTY_SCRIPT = [
  // 전역 Stop 미사용: COM 호출 오류가 스크립트를 중단시키지 않게 단계별 try/catch 로 격리.
  '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;', // 한글 오류 메시지 깨짐 방지.
  '$sh = New-Object -ComObject Shell.Application;',
  '$bin = $sh.NameSpace(0xA);',
  'if ($null -eq $bin) { exit 0 }',
  'try { if (@($bin.Items()).Count -eq 0) { exit 0 } } catch {}', // 이미 비어 있음 = 성공.
  'try { Clear-RecycleBin -Force -Confirm:$false -ErrorAction Stop; exit 0 } catch {}',
  // 폴백: COM 삭제 동사(로케일 — "삭제(&D)"/"Delete" 부분 매칭). 비운 뒤 재확인.
  'try {',
  '  foreach ($it in @($bin.Items())) {',
  '    try { $v = $it.Verbs() | Where-Object { ($_.Name -replace "&","") -match "(삭제|delete)" } | Select-Object -First 1; if ($null -ne $v) { $v.DoIt() } } catch {}',
  '  }',
  '  Start-Sleep -Milliseconds 150;',
  '  if (@($sh.NameSpace(0xA).Items()).Count -gt 0) { exit 3 }',
  '  exit 0',
  '} catch { exit 3 }'
].join(' ')

/**
 * 실제 비우기 execFile 래퍼(모듈 비공개). Clear-RecycleBin → COM 폴백.
 * 비-Windows → 실패 신호. **throw 0**.
 */
function defaultEmptyFn(): Promise<RecycleInvokeResult> {
  if (process.platform !== 'win32') {
    return Promise.resolve({ ok: false, message: '비우기는 Windows 에서만 지원됩니다.' })
  }
  return new Promise<RecycleInvokeResult>((resolve) => {
    try {
      execFile(
        'powershell.exe',
        [...PS_BASE_ARGS, EMPTY_SCRIPT],
        { windowsHide: true, timeout: QUERY_TIMEOUT_MS },
        (error, _stdout, stderr) => {
          if (!error) {
            resolve({ ok: true })
            return
          }
          const code = typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : undefined
          if (code === 3)
            resolve({
              ok: false,
              message: '일부 항목이 사용 중이거나 접근할 수 없어 휴지통을 완전히 비우지 못했습니다.'
            })
          else resolve({ ok: false, message: firstLine(stderr) ?? '휴지통 비우기에 실패했습니다.' })
        }
      )
    } catch (e) {
      resolve({ ok: false, message: e instanceof Error ? e.message : '비우기 실행 실패' })
    }
  })
}

/**
 * list raw JSON 1건을 TrashItemDTO 로 정규화한다(필드 결손·타입 불일치 방어).
 * id 화이트리스트(`$Recycle.Bin`) 미통과 항목은 폐기(임의 경로 노출 차단).
 */
function normalizeItem(raw: unknown): TrashItemDTO | null {
  if (raw === null || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = typeof o['id'] === 'string' ? o['id'] : ''
  if (!isRecycleBinPath(id)) return null
  const name = typeof o['name'] === 'string' ? o['name'] : ''
  const originalPath = typeof o['originalPath'] === 'string' ? o['originalPath'] : ''
  const deletedAtNum = Number(o['deletedAt'])
  const deletedAt = Number.isFinite(deletedAtNum) && deletedAtNum > 0 ? Math.floor(deletedAtNum) : 0
  const sizeNum = Number(o['size'])
  const size = Number.isFinite(sizeNum) && sizeNum > 0 ? Math.floor(sizeNum) : 0
  return { id, name, originalPath, deletedAt, size }
}

/**
 * ConvertTo-Json 결과(stdout)를 TrashItemDTO[] 로 파싱한다.
 * - PowerShell 단일 항목은 객체로 직렬화될 수 있어 배열로 정규화.
 * - 파싱/타입 오류·빈 출력 → 빈 배열(폴백). **throw 0**.
 */
export function parseTrashList(stdout: string): TrashItemDTO[] {
  if (typeof stdout !== 'string') return []
  const trimmed = stdout.trim()
  if (trimmed.length === 0) return []
  let data: unknown
  try {
    data = JSON.parse(trimmed)
  } catch {
    return []
  }
  const arr: unknown[] = Array.isArray(data) ? data : [data]
  const out: TrashItemDTO[] = []
  for (const raw of arr) {
    const item = normalizeItem(raw)
    if (item) out.push(item)
  }
  return out
}

export class RecycleBinService {
  private readonly listFn: TrashListFn
  private readonly restoreFn: TrashRestoreFn
  private readonly emptyFn: TrashEmptyFn

  /**
   * @param opts.listFn/restoreFn/emptyFn  PowerShell COM 래퍼 대체(기본=실모듈).
   *                                        헤드리스가 raw stdout(JSON)·부수효과 스텁 주입.
   */
  constructor(opts: RecycleBinServiceOptions = {}) {
    this.listFn = opts.listFn ?? defaultListFn
    this.restoreFn = opts.restoreFn ?? defaultRestoreFn
    this.emptyFn = opts.emptyFn ?? defaultEmptyFn
  }

  /**
   * 휴지통 열거 → 정규화된 TrashItemDTO[]. 실패/비-Win/파싱오류 → []. **throw 0**.
   * id 화이트리스트(`$Recycle.Bin`) 미통과 항목은 제외(보안).
   */
  async list(): Promise<TrashItemDTO[]> {
    try {
      const stdout = await this.listFn()
      return parseTrashList(stdout)
    } catch {
      return []
    }
  }

  /**
   * 선택 항목($R 실경로 id 배열) 원위치 복원. id 는 env 주입(명령행 보간 0).
   * 비-$Recycle.Bin id 는 서비스에서도 제거(핸들러 화이트리스트와 이중 방어).
   * 결과 ok=false 면 핸들러가 Result.err 로 변환. **throw 0**.
   */
  async restore(ids: string[]): Promise<RecycleInvokeResult> {
    const safe = Array.isArray(ids) ? ids.filter((id) => isRecycleBinPath(id)) : []
    if (safe.length === 0) {
      return { ok: false, message: '복원 가능한 항목이 없습니다.' }
    }
    try {
      return await this.restoreFn(safe)
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : '복원 실패' }
    }
  }

  /**
   * 전체 비우기(Clear-RecycleBin → COM 폴백). confirmed 게이트는 호출측(핸들러) 책임.
   * 결과 ok=false 면 핸들러가 Result.err 로 변환. **throw 0**.
   */
  async empty(): Promise<RecycleInvokeResult> {
    try {
      return await this.emptyFn()
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : '비우기 실패' }
    }
  }
}

/** 싱글턴(trash.handlers 공유). 옵션 없이 = 실 PowerShell COM. */
export const recycleBinService = new RecycleBinService()
