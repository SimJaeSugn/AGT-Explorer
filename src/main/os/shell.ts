/**
 * OS 쉘 통합 (Main os 어댑터, ADR-005).
 *
 * shell.openPath 를 한 곳으로 모아 다중 OS 확장 시 교체 가능하게 한다(SW §9).
 * 호출부(shell.handlers)는 이미 경로 검증을 통과한 경로만 전달한다.
 */
import { execFile } from 'node:child_process'
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
 * 검증된 디렉토리 경로에서 터미널을 연다(shell:open-terminal, H4 · ADR-005).
 *
 * Windows Terminal(`wt.exe -d <dir>`)을 우선 시도하고, 미설치(ENOENT)·spawn 실패
 * 시 `powershell.exe -NoExit`(cwd=경로) 로 폴백한다. 둘 다 셸(cmd)을 경유하지 않는
 * execFile + 인자 배열/cwd 옵션으로만 경로를 전달한다(명령행 문자열 합성 0 — ADR-005
 * §3.3-4, 공백·한글·`&` 포함 경로도 주입 무해). 터미널은 보여야 하므로
 * windowsHide:false. 비-Windows 는 미지원 안내 반환(개발/CI 폴백, openWith 스타일).
 *
 * 호출부(shell.handlers)는 이미 정규화·존재·디렉토리(stat) 검증을 통과한 경로만 전달.
 */
export async function openTerminal(normalizedDir: string): Promise<OpenResult> {
  if (process.platform !== 'win32') {
    return { errorMessage: '터미널 열기는 Windows 에서만 지원됩니다.' }
  }

  // 1차: Windows Terminal. wt 는 런처라 즉시 반환(detach) — error 없으면 성공.
  const wt = await new Promise<OpenResult | null>((resolve) => {
    execFile('wt.exe', ['-d', normalizedDir], { windowsHide: false }, (error) => {
      // wt.exe 부재(미설치/Server)는 ENOENT 등 → 폴백 신호로 null 반환.
      if (error) resolve(null)
      else resolve({ errorMessage: '' })
    })
  })
  if (wt) return wt

  // 2차(폴백): PowerShell. -NoExit 로 창 유지, cwd 옵션으로 작업 디렉토리 지정
  // (경로를 명령행 문자열로 합성하지 않음 — 주입 차단).
  return new Promise<OpenResult>((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoExit'],
      { cwd: normalizedDir, windowsHide: false },
      (error) => {
        resolve({ errorMessage: error ? error.message : '' })
      }
    )
  })
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
