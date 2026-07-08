/**
 * OS 쉘 통합 (Main os 어댑터, ADR-005).
 *
 * shell.openPath 를 한 곳으로 모아 다중 OS 확장 시 교체 가능하게 한다(SW §9).
 * 호출부(shell.handlers)는 이미 경로 검증을 통과한 경로만 전달한다.
 */
import { execFile, spawn } from 'node:child_process'
import { win32 } from 'node:path'
import { shell } from 'electron'

export interface OpenResult {
  /** electron shell.openPath 는 실패 시 오류 문자열, 성공 시 빈 문자열을 반환. */
  readonly errorMessage: string
}

/** 검증된 경로를 OS 연결 프로그램으로 연다. */
export async function openPath(normalizedPath: string): Promise<OpenResult> {
  const errorMessage = await shell.openPath(normalizedPath)
  return { errorMessage }
}

/**
 * 검증된 http/https URL 을 OS 기본 브라우저로 연다(shell:open-external, V1 · ADR-005).
 *
 * 호출부(shell.handlers)가 프로토콜 화이트리스트(http/https)를 강제한 뒤에만 위임한다
 * (file:/커스텀 스킴/임의 경로 실행 차단 — ADR-005 §3.3-4). shell.openExternal 의
 * rejection(미지원 스킴·OS 실패)은 Result.err 로 전파되도록 errorMessage 로 흡수한다.
 */
export async function openExternalUrl(url: string): Promise<OpenResult> {
  try {
    await shell.openExternal(url)
    return { errorMessage: '' }
  } catch (e) {
    return { errorMessage: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Windows "연결 프로그램" 대화상자 호출(shell:open-with, ADR-005).
 *
 * Electron 은 "Open With" 동사를 직접 노출하지 않으므로, Windows 표준 셸 동사
 * `OpenAs_RunDLL`(shell32.dll)을 rundll32 로 호출한다. 호출부(shell.handlers)는
 * 이미 정규화·존재·권한 검증을 통과한 절대경로만 전달한다.
 *
 * 인자 주입 방지: 셸(cmd)을 경유하지 않는 execFile 로 검증된 단일 경로만 인자
 * 배열로 전달한다(명령행 문자열 합성 없음 — ADR-005 §3.3-4). 비-Windows 에서는
 * 미지원이므로 안내 메시지를 반환(개발/CI 폴백).
 */
export async function openWith(normalizedPath: string): Promise<OpenResult> {
  if (process.platform !== 'win32') {
    return { errorMessage: '연결 프로그램 선택은 Windows 에서만 지원됩니다.' }
  }

  return new Promise<OpenResult>((resolve) => {
    execFile(
      'rundll32.exe',
      ['shell32.dll,OpenAs_RunDLL', normalizedPath],
      { windowsHide: true },
      (error) => {
        // OpenAs_RunDLL 은 대화상자를 띄우고 즉시 반환(GUI). spawn/실행 실패만 오류.
        resolve({ errorMessage: error ? error.message : '' })
      }
    )
  })
}

/**
 * 동기 throw 를 흡수하는 detached spawn (터미널 실행용).
 *
 * Node 22+(libuv 1.48+)는 스토어 앱 실행 별칭(APPEXECLINK reparse point — 예:
 * `%LOCALAPPDATA%\Microsoft\WindowsApps\wt.exe`)을 spawn 하면 콜백 오류(ENOENT)가
 * 아니라 **동기적으로 EINVAL 을 throw** 한다. Promise executor 밖으로 새면 IPC
 * 핸들러 오류(throw 금지 위반)가 되므로 try/catch 로 흡수해 폴백 신호(Error)로
 * 변환한다. 'spawn' 이벤트(실행 성공) 시 즉시 unref·resolve — 터미널 프로세스
 * 종료를 기다리지 않는다(기존 execFile 은 터미널을 닫을 때까지 invoke 가 대기).
 */
function spawnDetached(
  file: string,
  args: readonly string[],
  options: { cwd?: string } = {}
): Promise<Error | null> {
  return new Promise((resolve) => {
    try {
      const child = spawn(file, [...args], {
        ...options,
        detached: true,
        stdio: 'ignore',
        windowsHide: false
      })
      child.once('error', (e) => resolve(e))
      child.once('spawn', () => {
        child.unref()
        resolve(null)
      })
    } catch (e) {
      resolve(e instanceof Error ? e : new Error(String(e)))
    }
  })
}

/** execFile 의 동기 throw 까지 콜백 오류로 흡수하는 래퍼 (spawnDetached 와 동일 사유). */
function execFileNoThrow(
  file: string,
  args: readonly string[],
  options: Parameters<typeof execFile>[2]
): Promise<Error | null> {
  return new Promise((resolve) => {
    try {
      execFile(file, [...args], options, (error) => resolve(error ?? null))
    } catch (e) {
      resolve(e instanceof Error ? e : new Error(String(e)))
    }
  })
}

/**
 * 검증된 디렉토리 경로에서 터미널을 연다(shell:open-terminal, H4 · ADR-005).
 *
 * 3단 폴백: ① `wt.exe -d <dir>` 직접 spawn(비-스토어 설치본) → ② 스토어 별칭이면
 * EINVAL 이므로 PowerShell `Start-Process` 릴레이로 wt 실행(ShellExecute 계열은
 * 별칭을 정상 실행) → ③ wt 미설치면 `powershell.exe -NoExit`(cwd=경로) 창.
 * 경로는 인자 배열/cwd/환경변수로만 전달한다(명령행 문자열 합성 0 — ADR-005
 * §3.3-4, 공백·한글·`&` 포함 경로도 주입 무해). 터미널은 보여야 하므로
 * windowsHide:false. 비-Windows 는 미지원 안내 반환(개발/CI 폴백, openWith 스타일).
 *
 * launch='claude' 면 터미널 기동 직후 `claude`(Claude Code CLI)를 실행한다. 실행 셸은
 * `powershell.exe -NoExit -Command claude` — claude 종료 후에도 창을 유지한다. launch 는
 * **고정 리터럴**('claude')만 받으므로 명령은 코드 상수이고 사용자 입력 보간이 없다(주입 무해).
 *
 * admin=true 면 UAC 승격 경로(openTerminalElevated)로 위임한다 — 직접 spawn 으로는
 * 프로세스 승격이 불가하므로 PowerShell `Start-Process -Verb RunAs` 릴레이를 쓴다.
 *
 * 호출부(shell.handlers)는 이미 정규화·존재·디렉토리(stat) 검증을 통과한 경로만 전달.
 */
export async function openTerminal(
  normalizedDir: string,
  launch?: 'claude',
  admin?: boolean
): Promise<OpenResult> {
  if (process.platform !== 'win32') {
    return { errorMessage: '터미널 열기는 Windows 에서만 지원됩니다.' }
  }

  // 관리자 권한: spawn 은 승격 불가 → PowerShell Start-Process -Verb RunAs 릴레이(UAC).
  if (admin) {
    return openTerminalElevated(normalizedDir, launch)
  }

  // launch 지정 시 터미널 안에서 실행할 셸(고정 명령 — 사용자 입력 없음). claude 종료 후
  // 창을 유지하도록 -NoExit. wt 에는 `-d <dir>` 뒤 commandline 으로, 단독 PS 폴백에는 그대로.
  const innerShell = launch === 'claude' ? ['powershell.exe', '-NoExit', '-Command', 'claude'] : []
  const finalPsArgs = launch === 'claude' ? ['-NoExit', '-Command', 'claude'] : ['-NoExit']

  // 1차: Windows Terminal 직접 spawn. 스토어 별칭이면 동기 EINVAL → 폴백.
  if ((await spawnDetached('wt.exe', ['-d', normalizedDir, ...innerShell])) === null) {
    return { errorMessage: '' }
  }

  // 2차: PowerShell 릴레이(스토어 별칭 폴백) — 터미널에서 `wt`를 직접 치는 것과
  // 동일한 경로(PS→CreateProcess 는 별칭을 정상 실행). 경로는 env 로 전달해 보간
  // 회피(showProperties 선례), 인자는 PS 가 배열로 전달(문자열 합성 0). 드라이브
  // 루트(`E:\`) 등 후행 \ 는 PS 인용 시 `"...\"` 파손을 막기 위해 \\ 로 이스케이프.
  // launch 명령은 고정 리터럴이라 스크립트에 직접 박는다(사용자 입력 보간 없음).
  // wt 미설치/실행 불가면 PS 가 비0 종료 → 3차.
  const relayWt = launch === 'claude' ? 'wt.exe -d $d powershell.exe -NoExit -Command claude;' : 'wt.exe -d $d;'
  const relayScript = [
    "$ErrorActionPreference = 'Stop';",
    '$d = $env:EXPLORER_TERMINAL_DIR;',
    "if ($d.EndsWith('\\')) { $d += '\\' }",
    relayWt
  ].join(' ')
  const relayError = await execFileNoThrow(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', relayScript],
    {
      windowsHide: true,
      timeout: 8000,
      env: { ...process.env, EXPLORER_TERMINAL_DIR: normalizedDir }
    }
  )
  if (relayError === null) return { errorMessage: '' }

  // 3차(최종 폴백): PowerShell 창. -NoExit 로 창 유지, cwd 옵션으로 작업 디렉토리
  // 지정(경로를 명령행 문자열로 합성하지 않음 — 주입 차단). launch 면 -Command claude 추가.
  const psError = await spawnDetached('powershell.exe', finalPsArgs, { cwd: normalizedDir })
  return { errorMessage: psError ? psError.message : '' }
}

/**
 * 관리자 권한(UAC 승격)으로 터미널을 연다(shell:open-terminal admin=true, ADR-005).
 *
 * 프로세스 승격은 ShellExecute "runas" 동사로만 가능하므로 비승격 PowerShell 릴레이가
 * `Start-Process -Verb RunAs` 를 호출해 UAC 를 띄운다(사용자 승인 시 승격 기동). 대상은
 * wt 설치 시 Windows Terminal, 없으면 PowerShell 창 — 릴레이 스크립트 안에서 `Get-Command
 * wt.exe` 로 한 번만 판정해 **UAC 프롬프트가 한 번만** 뜨게 한다. 경로는 env(EXPLORER_TERMINAL_DIR)
 * 로만 전달하고 인자는 PowerShell 배열 리터럴로 넘겨 명령행 문자열 합성이 없다(주입 무해 — 공백·
 * 한글·`&` 경로 안전). launch 명령은 고정 리터럴('claude')이라 스크립트에 직접 박는다.
 * 사용자가 UAC 를 취소하면 Start-Process 가 throw → 릴레이 비0 종료 → 오류 메시지 반환(호출부 토스트).
 */
async function openTerminalElevated(dir: string, launch?: 'claude'): Promise<OpenResult> {
  // 승격 후 터미널 안에서 실행할 셸(고정 명령). wt 는 -d <dir> 뒤 commandline, PS 폴백은 인자 배열.
  const wtArgs =
    launch === 'claude'
      ? "@('-d', $d, 'powershell.exe', '-NoExit', '-Command', 'claude')"
      : "@('-d', $d)"
  const psArgs = launch === 'claude' ? "@('-NoExit', '-Command', 'claude')" : "@('-NoExit')"

  // 드라이브 루트(`E:\`) 등 후행 \ 는 인용 시 파손을 막기 위해 \\ 로 이스케이프(비승격 릴레이 선례).
  const script = [
    "$ErrorActionPreference = 'Stop';",
    '$d = $env:EXPLORER_TERMINAL_DIR;',
    "if ($d.EndsWith('\\')) { $d += '\\' }",
    '$wt = Get-Command wt.exe -ErrorAction SilentlyContinue;',
    `if ($wt) { Start-Process -FilePath 'wt.exe' -ArgumentList ${wtArgs} -Verb RunAs }`,
    `else { Start-Process -FilePath 'powershell.exe' -ArgumentList ${psArgs} -WorkingDirectory $d -Verb RunAs }`
  ].join(' ')

  const relayError = await execFileNoThrow(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    {
      windowsHide: true,
      timeout: 120000, // UAC 응답 대기 여유(사용자가 프롬프트에 응답할 때까지).
      env: { ...process.env, EXPLORER_TERMINAL_DIR: dir }
    }
  )
  return { errorMessage: relayError ? relayError.message : '' }
}

/**
 * Windows OS 속성 대화상자 호출(shell:show-properties, ADR-005).
 *
 * Electron 은 SHObjectProperties/ShellExecuteEx("properties") 를 직접 노출하지
 * 않으므로, Windows 에서는 COM Shell.Application 의 항목 컨텍스트 동사("properties"
 / "속성")를 PowerShell 로 호출한다(검증된 단일 경로만 인자로 전달 — 명령행 조립
 * 없음, ADR-005 §3.3-4). 실패 시 shell.showItemInFolder 로 폴백한다.
 *
 * 인자 주입 방지: 경로를 PowerShell 명령 문자열로 합성하지 않고 execFile 의 인자
 * 배열로 전달하며, 스크립트 내부에서는 환경변수(EXPLORER_PROP_PATH)로 경로를
 * 읽어 문자열 보간 자체를 피한다.
 */
export async function showProperties(normalizedPath: string): Promise<OpenResult> {
  if (process.platform !== 'win32') {
    // 비-Windows: 폴더에서 항목 선택 표시로 폴백(개발/CI).
    shell.showItemInFolder(normalizedPath)
    return { errorMessage: '' }
  }

  const dir = win32.dirname(normalizedPath)
  const leaf = win32.basename(normalizedPath)
  // PowerShell 스크립트: 경로는 $env 로 받아 보간 회피. 'properties'/'속성' 동사 탐색.
  const script = [
    '$ErrorActionPreference = "Stop";',
    '$p = $env:EXPLORER_PROP_DIR;',
    '$leaf = $env:EXPLORER_PROP_LEAF;',
    '$sh = New-Object -ComObject Shell.Application;',
    '$folder = $sh.Namespace($p);',
    'if ($null -eq $folder) { exit 2 }',
    '$item = $folder.ParseName($leaf);',
    'if ($null -eq $item) { exit 3 }',
    '$verb = $item.Verbs() | Where-Object { $_.Name -replace "&","" -match "^(Properties|속성)$" } | Select-Object -First 1;',
    'if ($null -eq $verb) { exit 4 }',
    '$verb.DoIt();'
  ].join(' ')

  return new Promise<OpenResult>((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      {
        windowsHide: true,
        timeout: 8000,
        env: { ...process.env, EXPLORER_PROP_DIR: dir, EXPLORER_PROP_LEAF: leaf }
      },
      (error) => {
        if (error) {
          // 폴백: 적어도 항목을 탐색기에서 선택 표시.
          try {
            shell.showItemInFolder(normalizedPath)
            resolve({ errorMessage: '' })
          } catch {
            resolve({ errorMessage: error.message })
          }
        } else {
          resolve({ errorMessage: '' })
        }
      }
    )
  })
}
