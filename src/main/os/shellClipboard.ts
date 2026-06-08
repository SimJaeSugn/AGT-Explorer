/**
 * Windows 셸 클립보드 파일 포맷(CF_HDROP) 양방향 — §M M2(MP2 구현, 버그수정 재구현).
 *
 * 기존 `fileClipboard.ts`(앱 내부 상태 + 텍스트 경로 폴백)와 **병존**한다(비파괴).
 *
 * ── 왜 Electron clipboard 가 아니라 PowerShell + .NET 인가 ───────────────────
 * 이전 구현은 `electron` 의 `clipboard.writeBuffer('CF_HDROP', ...)`/`readBuffer` 를
 * 썼는데 실 Windows 에서 두 가지로 깨졌다(헤드리스 verify 는 electron 을 인메모리
 * 스텁으로 대체해 이를 못 잡았다):
 *   1. `writeBuffer('CF_HDROP', ...)` 는 표준 셸 CF_HDROP(predefined format 15)가
 *      아니라 "CF_HDROP" 이라는 **이름의 커스텀 포맷**을 `RegisterClipboardFormat`
 *      으로 등록한다. 탐색기는 진짜 CF_HDROP(15)을 읽으므로 양방향 연동이 불가.
 *   2. Windows 에서 `clear()`→`writeBuffer(A)`→`writeBuffer(B)`→`writeText(C)` 를
 *      연속 호출하면 각 호출이 **독립 클립보드 세션**으로 클립보드를 비우고 자기
 *      포맷만 써, 마지막 `writeText` 만 남고 CF_HDROP 버퍼가 사라진다 → 앱 내부
 *      copy→paste 조차 빈 결과.
 * 즉 Electron public clipboard API 로는 실 CF_HDROP 셸 연동이 불가능하다.
 *
 * ── 재구현(확정) ──────────────────────────────────────────────────────────
 * recycleBin.ts·driveType.ts 의 OS 통합 패턴(execFile + 고정 스크립트 + 동적값
 * env/임시파일 주입 + windowsHide + timeout + throw 0 + 헤드리스 execFn 주입)을
 * 그대로 따라 PowerShell `System.Windows.Forms.Clipboard` 로 재구현한다.
 *
 *   - 쓰기: 하나의 `DataObject` 에 **FileDrop**(SetFileDropList)과 **"Preferred
 *     DropEffect"**(4바이트 LE DWORD MemoryStream)를 함께 담아
 *     `[Clipboard]::SetDataObject($dobj, $true)` 로 **원자 적재**(개별 호출 클로버
 *     회피). $true = persist(프로세스 종료 후에도 클립보드 유지).
 *   - 읽기: `GetDataObject().GetData(DataFormats::FileDrop)` 로 경로 배열,
 *     `GetData('Preferred DropEffect')` MemoryStream 에서 DropEffect DWORD 판정.
 *     ※ `GetFileDropList()` 는 실측에서 일부 환경에 AccessViolation 을 일으켜
 *       `GetData(FileDrop)` 를 사용한다(실 PowerShell 왕복으로 확인).
 *     결과는 JSON 으로 stdout 출력 → Node 파싱.
 *   - 존재: `[Clipboard]::ContainsFileDropList()` → boolean.
 *
 * ── 보안/인젝션 차단 ──────────────────────────────────────────────────────
 * 경로 등 동적 값을 스크립트 문자열에 직접 연결하지 않는다(SR8·ADR-007). 경로 목록은
 * UTF-8(BOM) **임시파일**에 쓰고 PowerShell 이 `[IO.File]::ReadAllLines(path, UTF8)`
 * 로 읽는다(파일 경로만 env 로 주입). DropEffect 정수도 env 로 주입. 스크립트는
 * 고정 상수. execFile(셸 미경유)·인자 배열·windowsHide·timeout(5s)·실패 시 throw 0.
 *
 * ── 방어적 파싱 ────────────────────────────────────────────────────────────
 * 외부(탐색기·타 앱)에서 온 경로는 **불신 입력**이다. PowerShell 이 JSON 으로 준 결과를
 * 형태 검증(배열·문자열·effect enum)하고, 정규화·존재 검증은 상위 핸들러
 * (clipboard.handlers)에서 수행한다. 손상·비파일·실패는 빈 결과로 안전 폴백(throw 0).
 *
 * 헤드리스 검증성: `setClipboardExecFn` 으로 PowerShell 미경유 스텁(write/read/has)을
 * 주입해 verify-clipboard-hdrop 가 핸들러 IO 경로(DROPFILES 조립/파싱 포함)를
 * 검증한다. 단 실 PowerShell 왕복은 별도 실측으로 확인(verify 가 못 잡는 영역).
 */
import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** DROPFILES 헤더 크기(고정 20바이트). */
const DROPFILES_HEADER_SIZE = 20

/** DROPEFFECT 상수(shellapi). copy 는 탐색기 호환을 위해 COPY(1) 사용. */
const DROPEFFECT_COPY = 1
const DROPEFFECT_MOVE = 2

/** PowerShell execFile timeout(ms) — 클립보드 GUI/콜드스타트 여유. */
const CLIP_TIMEOUT_MS = 5000

/** PowerShell 기본 인자 — 셸 미경유·STA(클립보드 OLE 요구)·프로필 미로드. */
const PS_BASE_ARGS = ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File'] as const

export type ReadEffect = 'copy' | 'move' | 'none'

// ── 순수 직렬화/파싱(DROPFILES) — 헤드리스 verify 라운드트립 대상 ───────────────
//
// 실 IO 는 PowerShell .NET 이 담당하지만, 아래 순수 함수는 DROPFILES 바이트 레이아웃의
// 진실 소스로 유지한다(verify 가 조립↔파싱 라운드트립·방어적 파싱 매트릭스를 검증).
// CF_HDROP = DROPFILES(20B 헤더) + UTF-16LE 더블널 종단 경로 리스트.

/**
 * DROPFILES(CF_HDROP) buffer 조립: 20바이트 헤더 + UTF-16LE 더블널 종단 경로 리스트.
 * 헤더(20B): pFiles=20, pt(0,0), fNC=0, fWide=1(Unicode).
 */
export function buildDropfiles(paths: string[]): Buffer {
  const header = Buffer.alloc(DROPFILES_HEADER_SIZE)
  header.writeUInt32LE(DROPFILES_HEADER_SIZE, 0) // pFiles
  header.writeInt32LE(0, 4) // pt.x
  header.writeInt32LE(0, 8) // pt.y
  header.writeInt32LE(0, 12) // fNC
  header.writeInt32LE(1, 16) // fWide (Unicode)

  const NUL = Buffer.from([0x00, 0x00]) // UTF-16LE NUL
  const parts: Buffer[] = []
  for (const p of paths) {
    parts.push(Buffer.from(p, 'utf16le'))
    parts.push(NUL)
  }
  parts.push(NUL) // 리스트 전체 종단(더블널)

  return Buffer.concat([header, ...parts])
}

/** "Preferred DropEffect" 4바이트 LE DWORD 조립(copy=COPY, cut=MOVE). */
export function buildPreferredDropEffect(effect: 'copy' | 'cut'): Buffer {
  const buf = Buffer.alloc(4)
  buf.writeUInt32LE(effect === 'cut' ? DROPEFFECT_MOVE : DROPEFFECT_COPY, 0)
  return buf
}

/**
 * DROPFILES(CF_HDROP) buffer 방어적 파싱 → 경로 배열.
 * 손상·비-wide(ANSI)·더블널 미발견·오프셋 초과·홀수 정렬 깨짐 시 **빈 배열**(throw 0).
 */
export function parseDropfiles(buf: Buffer | null | undefined): string[] {
  if (!buf || buf.length < DROPFILES_HEADER_SIZE) return []

  const pFiles = buf.readUInt32LE(0)
  if (pFiles < DROPFILES_HEADER_SIZE || pFiles >= buf.length) return []

  const fWide = buf.readUInt32LE(16)
  if (fWide !== 1) return [] // ANSI(0)는 본 구현 범위 밖 → 안전 폴백.

  const listLen = buf.length - pFiles
  if (listLen < 2 || listLen % 2 !== 0) return [] // wide 영역은 2바이트 정렬.

  const paths: string[] = []
  let cur: number[] = []
  let sawTerminator = false
  for (let off = pFiles; off + 1 < buf.length; off += 2) {
    const unit = buf.readUInt16LE(off)
    if (unit === 0) {
      if (cur.length === 0) {
        sawTerminator = true // 연속 NUL = 더블널 종단(리스트 끝).
        break
      }
      paths.push(String.fromCharCode(...cur))
      cur = []
    } else {
      cur.push(unit)
    }
  }

  if (!sawTerminator) return [] // 잘린/손상 buffer 안전 폴백.
  return paths
}

/** "Preferred DropEffect" buffer 해석 → 'copy'|'move'|'none'. */
export function parsePreferredDropEffect(buf: Buffer | null | undefined): ReadEffect {
  if (!buf || buf.length < 4) return 'none'
  const v = buf.readUInt32LE(0)
  if ((v & DROPEFFECT_MOVE) !== 0) return 'move' // MOVE(2) 비트만 'move'.
  return 'copy' // COPY(1)·기타(예: 탐색기 5=COPY|LINK)는 'copy'.
}

// ── PowerShell 고정 스크립트(사용자 입력 미주입) ─────────────────────────────
//
// 동적 값(경로·effect)은 절대 스크립트에 연결하지 않는다. 경로는 UTF-8(BOM) 임시파일
// (env CLIP_PATHS_FILE 경로만 주입)에서 ReadAllLines, effect 는 env CLIP_EFFECT 정수.

/**
 * 쓰기 스크립트: FileDrop + Preferred DropEffect 를 하나의 DataObject 로 원자 적재.
 * SetDataObject($dobj, $true) — persist=true(프로세스 종료 후에도 유지).
 */
const WRITE_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  'Add-Type -AssemblyName System.Windows.Forms',
  '$lines = [System.IO.File]::ReadAllLines($env:CLIP_PATHS_FILE, [System.Text.Encoding]::UTF8)',
  '$col = New-Object System.Collections.Specialized.StringCollection',
  'foreach ($p in $lines) { if ($p -ne "") { [void]$col.Add($p) } }',
  'if ($col.Count -eq 0) { exit 0 }',
  '$dobj = New-Object System.Windows.Forms.DataObject',
  '$dobj.SetFileDropList($col)',
  '$ms = New-Object System.IO.MemoryStream',
  '$ms.Write([System.BitConverter]::GetBytes([int]$env:CLIP_EFFECT), 0, 4)',
  "$dobj.SetData('Preferred DropEffect', $ms)",
  '[System.Windows.Forms.Clipboard]::SetDataObject($dobj, $true)'
].join('\n')

/**
 * 읽기 스크립트: GetDataObject().GetData(FileDrop) + Preferred DropEffect → JSON.
 * GetFileDropList() 는 일부 환경 AccessViolation → GetData(FileDrop) 사용(실측 확인).
 * 파일 없음/비파일 → {"paths":[],"effect":"none"}.
 */
const READ_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  'Add-Type -AssemblyName System.Windows.Forms',
  '$dobj = [System.Windows.Forms.Clipboard]::GetDataObject()',
  'if ($null -eq $dobj -or -not $dobj.GetDataPresent([System.Windows.Forms.DataFormats]::FileDrop)) { Write-Output \'{"paths":[],"effect":"none"}\'; exit 0 }',
  '$data = $dobj.GetData([System.Windows.Forms.DataFormats]::FileDrop)',
  '$paths = @(); foreach ($p in $data) { $paths += [string]$p }',
  "$effect = 'copy'",
  "try { if ($dobj.GetDataPresent('Preferred DropEffect')) { $ems = $dobj.GetData('Preferred DropEffect'); $b = New-Object byte[] 4; [void]$ems.Read($b,0,4); if (([System.BitConverter]::ToInt32($b,0) -band 2) -ne 0) { $effect = 'move' } } } catch {}",
  'if ($paths.Count -eq 0) { Write-Output \'{"paths":[],"effect":"none"}\'; exit 0 }',
  'ConvertTo-Json -InputObject ([pscustomobject]@{ paths=@($paths); effect=$effect }) -Compress'
].join('\n')

/** 존재 스크립트: ContainsFileDropList → "true"/"false". */
const HAS_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  'Add-Type -AssemblyName System.Windows.Forms',
  'if ([System.Windows.Forms.Clipboard]::ContainsFileDropList()) { Write-Output "true" } else { Write-Output "false" }'
].join('\n')

// ── 헤드리스 주입 가능한 PowerShell 실행 추상화 ──────────────────────────────

/** PowerShell 클립보드 실행 결과(raw stdout). 실패·타임아웃·비-Win 은 throw 0 으로 빈 신호. */
export interface ClipboardExecFn {
  /** 경로 목록·effect 를 클립보드에 적재(부수효과). */
  write(paths: string[], effect: 'copy' | 'cut'): Promise<void>
  /** 클립보드 → JSON raw stdout({paths,effect}). 비파일/실패 → none JSON. */
  read(): Promise<string>
  /** ContainsFileDropList → boolean. */
  has(): Promise<boolean>
}

/**
 * 경로 목록을 UTF-8(BOM) 임시파일에 쓰고 그 경로(만)를 env 로 주입하는 헬퍼.
 * BOM 으로 PowerShell ReadAllLines(UTF8) 가 유니코드 경로명을 안정적으로 읽게 한다.
 * 호출부가 정리(rmSync) 책임. 실패는 throw(상위에서 격리).
 */
function writePathsTempFile(paths: string[]): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'agt-clip-'))
  const file = join(dir, 'paths.txt')
  // U+FEFF BOM + 개행 join. 빈 줄은 PowerShell 측에서 제외.
  writeFileSync(file, '﻿' + paths.join('\n'), 'utf8')
  return { dir, file }
}

/** 실제 PowerShell write execFile 래퍼. 비-Win/실패/타임아웃 → throw 0(조용히 resolve). */
function defaultWrite(paths: string[], effect: 'copy' | 'cut'): Promise<void> {
  if (process.platform !== 'win32' || paths.length === 0) return Promise.resolve()
  const effectVal = effect === 'cut' ? DROPEFFECT_MOVE : DROPEFFECT_COPY
  return new Promise<void>((resolve) => {
    let tmp: { dir: string; file: string } | null = null
    try {
      tmp = writePathsTempFile(paths)
    } catch {
      resolve()
      return
    }
    const cleanup = (): void => {
      try {
        if (tmp) rmSync(tmp.dir, { recursive: true, force: true })
      } catch {
        /* best-effort */
      }
    }
    try {
      execFile(
        'powershell.exe',
        [...PS_BASE_ARGS, scriptArg(WRITE_SCRIPT)],
        {
          windowsHide: true,
          timeout: CLIP_TIMEOUT_MS,
          env: { ...process.env, CLIP_PATHS_FILE: tmp.file, CLIP_EFFECT: String(effectVal) }
        },
        () => {
          cleanup()
          resolve() // 성공/실패 무관 resolve(throw 0). 실패는 read 가 빈 결과로 드러냄.
        }
      )
    } catch {
      cleanup()
      resolve()
    }
  })
}

/** 실제 PowerShell read execFile 래퍼. raw stdout(JSON) resolve. 실패 → none JSON. */
function defaultRead(): Promise<string> {
  const NONE = '{"paths":[],"effect":"none"}'
  if (process.platform !== 'win32') return Promise.resolve(NONE)
  return new Promise<string>((resolve) => {
    try {
      execFile(
        'powershell.exe',
        [...PS_BASE_ARGS, scriptArg(READ_SCRIPT)],
        { windowsHide: true, timeout: CLIP_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 },
        (error, stdout) => {
          if (error) {
            resolve(NONE)
            return
          }
          resolve(stripBom(Buffer.isBuffer(stdout) ? stdout.toString('utf8') : String(stdout)))
        }
      )
    } catch {
      resolve(NONE)
    }
  })
}

/** 실제 PowerShell has execFile 래퍼. "true"→true, 그 외/실패 → false(throw 0). */
function defaultHas(): Promise<boolean> {
  if (process.platform !== 'win32') return Promise.resolve(false)
  return new Promise<boolean>((resolve) => {
    try {
      execFile(
        'powershell.exe',
        [...PS_BASE_ARGS, scriptArg(HAS_SCRIPT)],
        { windowsHide: true, timeout: CLIP_TIMEOUT_MS },
        (error, stdout) => {
          if (error) {
            resolve(false)
            return
          }
          resolve(String(stdout).trim().toLowerCase() === 'true')
        }
      )
    } catch {
      resolve(false)
    }
  })
}

/**
 * 고정 스크립트를 임시 .ps1 파일로 떨어뜨려 그 경로를 -File 인자로 돌려준다.
 * (-Command 인라인은 PS 의 백슬래시/인코딩 처리로 경로가 손상될 수 있어 -File 채택 —
 *  실측에서 -Command 인라인은 backslash 손실, -File 은 무손실 확인.)
 * 스크립트 자체는 고정 상수라 인젝션 면역. 파일은 OS tmp 에 1회성 생성(프로세스 종료 시
 * tmp 정리 — 단명). 호출 직후 동기 생성 후 인자로 반환한다.
 */
function scriptArg(script: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'agt-clip-ps-'))
  const file = join(dir, 's.ps1')
  // BOM 으로 PowerShell 이 UTF-8 스크립트(유니코드 리터럴 포함)를 정확히 해석.
  writeFileSync(file, '﻿' + script, 'utf8')
  return file
}

/** stdout 선두 UTF-8 BOM 제거(ConvertTo-Json/Console 출력 호환). */
function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s
}

/** 기본 실행기 = 실 PowerShell. verify 가 setClipboardExecFn 으로 스텁 교체. */
let execImpl: ClipboardExecFn = {
  write: defaultWrite,
  read: defaultRead,
  has: defaultHas
}

/**
 * 클립보드 PowerShell 실행기 주입(헤드리스 검증·테스트). undefined 전달 시 실 PowerShell 복원.
 */
export function setClipboardExecFn(fn: ClipboardExecFn | undefined): void {
  execImpl = fn ?? { write: defaultWrite, read: defaultRead, has: defaultHas }
}

// ── 공개 IO (PowerShell .NET Clipboard 경유, 비동기) ─────────────────────────

/**
 * 파일 경로 목록을 CF_HDROP + Preferred DropEffect 로 시스템 클립보드에 쓴다(원자).
 * paths 는 호출부(핸들러)에서 guardPath 로 정규화·검증된 로컬 경로여야 한다.
 * 실패/비-Win 은 throw 0(조용한 no-op) — 상위는 빈 클립보드로 관찰.
 */
export async function writeFilesToClipboard(paths: string[], effect: 'copy' | 'cut'): Promise<void> {
  if (!Array.isArray(paths) || paths.length === 0) return
  await execImpl.write(paths, effect)
}

/**
 * 시스템 클립보드에서 CF_HDROP·Preferred DropEffect 를 읽어 경로·효과를 복원한다.
 * 파일 포맷이 없으면 { paths:[], effect:'none' }(에러 아님 — 정상 빈 결과).
 * PowerShell 이 준 JSON 을 형태 검증한다. 경로 신뢰 검증(정규화·존재)은 상위 핸들러에서.
 */
export async function readFilesFromClipboard(): Promise<{ paths: string[]; effect: ReadEffect }> {
  let raw: string
  try {
    raw = await execImpl.read()
  } catch {
    return { paths: [], effect: 'none' }
  }
  return parseReadJson(raw)
}

/**
 * PowerShell read JSON(raw stdout)을 방어적으로 파싱 → {paths,effect}.
 * 파싱 실패·타입 불일치·빈 경로 → {paths:[],effect:'none'}(throw 0).
 * 외부 입력 불신: 비-문자열 경로는 폐기, effect 는 copy/move 만 허용(그 외 copy 폴백).
 */
export function parseReadJson(raw: string): { paths: string[]; effect: ReadEffect } {
  if (typeof raw !== 'string') return { paths: [], effect: 'none' }
  const trimmed = stripBom(raw).trim()
  if (trimmed.length === 0) return { paths: [], effect: 'none' }
  let data: unknown
  try {
    data = JSON.parse(trimmed)
  } catch {
    return { paths: [], effect: 'none' }
  }
  if (data === null || typeof data !== 'object') return { paths: [], effect: 'none' }
  const o = data as Record<string, unknown>
  const rawPaths = o['paths']
  // PowerShell ConvertTo-Json 은 단일 항목을 문자열로 직렬화할 수 있음 → 배열 정규화.
  const arr: unknown[] = Array.isArray(rawPaths) ? rawPaths : rawPaths != null ? [rawPaths] : []
  const paths: string[] = []
  for (const p of arr) {
    if (typeof p === 'string' && p.length > 0) paths.push(p)
  }
  if (paths.length === 0) return { paths: [], effect: 'none' }
  const eff = o['effect']
  const effect: ReadEffect = eff === 'move' ? 'move' : 'copy' // none 은 위에서 걸러짐.
  return { paths, effect }
}

/** 시스템 클립보드에 파일 목록(CF_HDROP)이 있는지 여부만 반환(붙여넣기 활성 판정). */
export async function hasFilesOnClipboard(): Promise<boolean> {
  try {
    return await execImpl.has()
  } catch {
    return false
  }
}
