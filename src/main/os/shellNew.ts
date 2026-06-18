/**
 * ShellNew 서비스 (§Y2) — Windows 탐색기 "새로 만들기" 그룹을 레지스트리에서 재현한다.
 *
 * Windows 는 "새로 만들기" 항목을 `HKEY_CLASSES_ROOT\.확장자\ShellNew` 핸들러에서 동적으로
 * 채운다(설치된 프로그램마다 다름). 이 서비스는 PowerShell 워커(`shellNewWorker.ps1`)를
 * 단발(one-shot) 실행해 그 목록을 열거하고(list), 선택 형식의 파일을 생성한다(create).
 *
 * 지원 범위(사용자 결정): **안전 3종만** — NullFile(빈 파일)·FileName(템플릿 복사)·
 * Data(바이너리 기록). Command 타입(바로 가기 등 임의 명령 실행)은 제외한다.
 *
 * 경계: main → child_process(powershell.exe). 비-win32·spawn 실패·타임아웃·파싱 실패는
 * 모두 빈 목록/err 로 안전 수렴한다(throw 0 — 셸 verb 서비스와 동일 견고성 규약).
 * ps1 경로는 패키지(asar)에서 app.asar.unpacked 로 보정한다(shellVerbs 선례).
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Result, ShellNewCreateRes } from '@shared/ipc/contracts'
import { err, ok } from '@shared/ipc/contracts'
import type { ShellNewItemDTO } from '@shared/dto'
import { fileOpError } from '../fs/errors'

const LIST_TIMEOUT_MS = 8000
const CREATE_TIMEOUT_MS = 6000

/** 워커 응답(느슨한 형태 — JS 측에서 정규화). */
interface WorkerResponse {
  readonly ok?: boolean
  readonly items?: unknown
  readonly name?: unknown
  readonly code?: unknown
}

/**
 * 패키지(asar) 환경에서 ps1 경로를 해석한다(shellVerbs.resolveWorkerScriptPath 선례).
 * dev 는 `__dirname`(out/main) 그대로, 패키지는 app.asar.unpacked 로 보정.
 */
function resolveWorkerScriptPath(): string {
  const direct = join(__dirname, 'shellNewWorker.ps1')
  if (direct.includes('app.asar') && !direct.includes('app.asar.unpacked')) {
    const unpacked = direct.replace('app.asar', 'app.asar.unpacked')
    if (existsSync(unpacked)) return unpacked
  }
  return direct
}

/**
 * PowerShell 워커를 단발 실행한다: request JSON 1줄을 stdin 으로 보내고 stdout 첫 JSON
 * 줄을 파싱해 반환한다. spawn 동기 throw·error·exit·타임아웃·파싱 실패는 모두 null.
 */
function runWorker(request: object, timeoutMs: number): Promise<WorkerResponse | null> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn> | null = null
    try {
      child = spawn(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          resolveWorkerScriptPath()
        ],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] }
      )
    } catch {
      resolve(null)
      return
    }

    let out = ''
    let done = false
    const finish = (v: WorkerResponse | null): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      try {
        child?.kill()
      } catch {
        /* ignore */
      }
      resolve(v)
    }
    const timer = setTimeout(() => finish(null), timeoutMs)

    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      out += chunk
    })
    child.once('error', () => finish(null))
    child.once('exit', () => {
      const line = out
        .split('\n')
        .map((s) => s.trim())
        .find((s) => s.length > 0)
      if (!line) {
        finish(null)
        return
      }
      try {
        finish(JSON.parse(line) as WorkerResponse)
      } catch {
        finish(null)
      }
    })

    try {
      child.stdin?.write(JSON.stringify(request) + '\n')
      child.stdin?.end()
    } catch {
      finish(null)
    }
  })
}

/** 워커 응답 1건이 유효한 ShellNewItemDTO 인지 검사 + 정규화. */
function normalizeItem(raw: unknown): ShellNewItemDTO | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || typeof r.ext !== 'string' || typeof r.label !== 'string') {
    return null
  }
  const id = r.id.trim()
  const ext = r.ext.trim()
  const label = r.label.trim()
  if (id === '' || ext === '' || label === '') return null
  return { id, ext, label }
}

/** 세션 캐시(레지스트리 ShellNew 는 거의 불변 — 프로세스 수명 동안 1회 조회). */
let cached: ShellNewItemDTO[] | null = null

/**
 * ShellNew 형식 목록 조회(안전 3종). 비-win32·실패·타임아웃은 모두 빈 배열로 수렴.
 * ConvertTo-Json(PS 5.1)은 항목 1개일 때 배열이 아닌 객체를, 0개일 때 null 을 낼 수
 * 있으므로 배열/객체/null 을 모두 흡수한다.
 */
export async function listShellNewTypes(): Promise<ShellNewItemDTO[]> {
  if (process.platform !== 'win32') return []
  if (cached) return cached
  const res = await runWorker({ op: 'list' }, LIST_TIMEOUT_MS)
  if (!res || res.ok !== true) return []
  const rawItems = res.items
  const list: unknown[] = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : []
  const items = list.map(normalizeItem).filter((i): i is ShellNewItemDTO => i !== null)
  cached = items
  return items
}

/**
 * ShellNew 형식 파일 생성. 워커가 레지스트리 재조회(id=확장자)로 생성 방식을 판정하고
 * 중복명 "(n)" 부여 후 최종 파일명을 반환한다. dir 은 핸들러가 이미 guardPath·존재 검증.
 */
export async function createShellNewFile(
  dir: string,
  id: string,
  label: string
): Promise<Result<ShellNewCreateRes>> {
  if (process.platform !== 'win32') {
    return err(fileOpError('EUNKNOWN', '이 기능은 Windows 에서만 지원합니다.', dir))
  }
  const res = await runWorker({ op: 'create', dir, id, label }, CREATE_TIMEOUT_MS)
  if (!res) return err(fileOpError('EUNKNOWN', '새로 만들기에 실패했습니다.', dir))
  if (res.ok === true && typeof res.name === 'string' && res.name.length > 0) {
    return ok({ name: res.name })
  }
  const code = res.code === 'ENOENT' ? 'ENOENT' : 'EUNKNOWN'
  return err(fileOpError(code, '새로 만들기에 실패했습니다.', dir))
}
