/**
 * shell:* IPC 핸들러 (P2 구현 = shell:open). ADR-005 쉘 실행 검증.
 *
 * shell:open 은 임의/조작 경로 실행을 막기 위해 3중 검증을 통과한 경로만
 * shell.openPath 에 위임한다:
 *   (a) 경로 정규화·`..` 상위이탈 차단        → guardPath(ESECURITY/EINVAL)
 *   (b) 대상 존재 확인                          → fs.access(F_OK) 실패 시 ENOENT
 *   (c) 접근(읽기) 권한 확인                    → fs.access(R_OK) 실패 시 EACCES
 * 모두 통과한 경로만 OS 실행. 검증 실패는 실행 없이 Result.err 로 1급 전파.
 *
 * shell:show-properties(P4)·shell:open-with(P6, OpenAs_RunDLL)도 동일 3중 검증
 * 후 OS 동사에 위임한다. shell:icon 은 별도 Phase.
 */
import { ipcMain } from 'electron'
import { constants as fsConstants } from 'node:fs'
import * as fsp from 'node:fs/promises'
import { z } from 'zod'
import { CHANNELS } from '@shared/ipc/channels'
import type { Result, ShellIconRes } from '@shared/ipc/contracts'
import { err, ok } from '@shared/ipc/contracts'
import { fileOpError, toFileOpError } from '../fs/errors'
import { getFileIconDataUrl } from '../os/icon'
import { openExternalUrl, openPath, openTerminal, openWith, showProperties } from '../os/shell'
import {
  guardPath,
  isTrustedSender,
  parseArgs,
  untrustedSenderError,
  zPath,
  zShellIconReq,
  zShellOpenExternalReq,
  zShellOpenTerminalReq,
  zShellOpenWithReq,
  zShellShowPropertiesReq
} from './guard'

const zShellOpenReq = z.object({ path: zPath })

export function registerShellHandlers(): void {
  // ── shell:open (OS 연결 프로그램 실행) ──────────────────────────────
  ipcMain.handle(CHANNELS.SHELL_OPEN, async (event, raw): Promise<Result<void>> => {
    // sender 검증.
    if (!isTrustedSender(event)) return err(untrustedSenderError())

    // 인자 형태 검증.
    const parsed = parseArgs(zShellOpenReq, raw)
    if (!parsed.ok) return parsed as Result<void>

    // (a) 경로 정규화·상위이탈 차단.
    const g = guardPath(parsed.value.path)
    if (!g.ok) return g as Result<void>
    const path = g.value

    // (b) 대상 존재 확인.
    try {
      await fsp.access(path, fsConstants.F_OK)
    } catch (e) {
      const fe = toFileOpError(e, path)
      // 존재하지 않음은 ENOENT 로 명확히.
      return err(fe.code === 'EUNKNOWN' ? fileOpError('ENOENT', '대상을 찾을 수 없습니다.', path) : fe)
    }

    // (c) 접근(읽기) 권한 확인.
    try {
      await fsp.access(path, fsConstants.R_OK)
    } catch (e) {
      const fe = toFileOpError(e, path)
      return err(fe.code === 'EUNKNOWN' ? fileOpError('EACCES', '접근 권한이 없습니다.', path) : fe)
    }

    // 3중 검증 통과 → OS 실행 위임.
    const r = await openPath(path)
    if (r.errorMessage) {
      // 연결 프로그램 없음·실행 실패: OS 가 처리하지 못함 → 안내용 오류.
      return err(fileOpError('EUNKNOWN', `실행할 수 없습니다: ${r.errorMessage}`, path))
    }
    return ok(undefined)
  })

  // ── shell:open-with (Windows 연결 프로그램 선택, P6 · ADR-005) ──────
  // shell:open 과 동일 보안 수준: (a) 정규화·상위이탈 차단 → (b) 존재 확인
  // → (c) 읽기 권한 확인. 3중 검증 통과 경로만 OpenAs_RunDLL 에 위임.
  ipcMain.handle(CHANNELS.SHELL_OPEN_WITH, async (event, raw): Promise<Result<void>> => {
    // sender 검증.
    if (!isTrustedSender(event)) return err(untrustedSenderError())

    // 인자 형태 검증.
    const parsed = parseArgs(zShellOpenWithReq, raw)
    if (!parsed.ok) return parsed as Result<void>

    // (a) 경로 정규화·상위이탈 차단.
    const g = guardPath(parsed.value.path)
    if (!g.ok) return g as Result<void>
    const path = g.value

    // (b) 대상 존재 확인.
    try {
      await fsp.access(path, fsConstants.F_OK)
    } catch (e) {
      const fe = toFileOpError(e, path)
      return err(fe.code === 'EUNKNOWN' ? fileOpError('ENOENT', '대상을 찾을 수 없습니다.', path) : fe)
    }

    // (c) 접근(읽기) 권한 확인.
    try {
      await fsp.access(path, fsConstants.R_OK)
    } catch (e) {
      const fe = toFileOpError(e, path)
      return err(fe.code === 'EUNKNOWN' ? fileOpError('EACCES', '접근 권한이 없습니다.', path) : fe)
    }

    // 3중 검증 통과 → 셸 미경유 execFile 로 연결 프로그램 대화상자 호출.
    const r = await openWith(path)
    if (r.errorMessage) {
      return err(fileOpError('EUNKNOWN', `연결 프로그램을 열 수 없습니다: ${r.errorMessage}`, path))
    }
    return ok(undefined)
  })

  // ── shell:show-properties (OS 속성 대화상자, P4 · ADR-005) ──────────
  ipcMain.handle(CHANNELS.SHELL_SHOW_PROPERTIES, async (event, raw): Promise<Result<void>> => {
    if (!isTrustedSender(event)) return err(untrustedSenderError())
    const parsed = parseArgs(zShellShowPropertiesReq, raw)
    if (!parsed.ok) return parsed as Result<void>

    // (a) 경로 정규화·상위이탈 차단.
    const g = guardPath(parsed.value.path)
    if (!g.ok) return g as Result<void>
    const path = g.value

    // (b) 대상 존재 확인 — 미존재면 ENOENT, 실행 없이 거부.
    try {
      await fsp.access(path, fsConstants.F_OK)
    } catch (e) {
      const fe = toFileOpError(e, path)
      return err(fe.code === 'EUNKNOWN' ? fileOpError('ENOENT', '대상을 찾을 수 없습니다.', path) : fe)
    }

    // 검증된 단일 경로만 OS 속성 다이얼로그에 위임(명령행 조립 없음, ADR-005).
    const r = await showProperties(path)
    if (r.errorMessage) {
      return err(fileOpError('EUNKNOWN', `속성창을 열 수 없습니다: ${r.errorMessage}`, path))
    }
    return ok(undefined)
  })

  // ── shell:open-terminal (터미널 열기, H4 · ADR-005) ─────────────────
  // shell:open 패턴 + 디렉토리 검증 추가: 파일 경로로 터미널 cwd 를 열 수 없게
  // fsp.stat 로 !isDirectory() 면 ENOTDIR 거부(미존재는 ENOENT). 검증 통과 경로만
  // openTerminal(wt→PowerShell 폴백)에 위임. throw 금지 — 전부 Result.err 전파.
  ipcMain.handle(CHANNELS.SHELL_OPEN_TERMINAL, async (event, raw): Promise<Result<void>> => {
    if (!isTrustedSender(event)) return err(untrustedSenderError())

    const parsed = parseArgs(zShellOpenTerminalReq, raw)
    if (!parsed.ok) return parsed as Result<void>

    // (a) 경로 정규화·상위이탈 차단.
    const g = guardPath(parsed.value.cwd)
    if (!g.ok) return g as Result<void>
    const cwd = g.value

    // (b) 디렉토리 검증 — stat 으로 존재(ENOENT)·디렉토리(ENOTDIR) 동시 확인.
    //     파일 경로면 ENOTDIR, 미존재면 ENOENT 로 실행 없이 거부.
    try {
      const st = await fsp.stat(cwd)
      if (!st.isDirectory()) {
        return err(fileOpError('ENOTDIR', '폴더가 아닙니다.', cwd))
      }
    } catch (e) {
      const fe = toFileOpError(e, cwd)
      return err(fe.code === 'EUNKNOWN' ? fileOpError('ENOENT', '대상을 찾을 수 없습니다.', cwd) : fe)
    }

    // 검증 통과 → 터미널 실행 위임. 실패만 EUNKNOWN 으로 전파.
    const r = await openTerminal(cwd)
    if (r.errorMessage) {
      return err(fileOpError('EUNKNOWN', `터미널을 열 수 없습니다: ${r.errorMessage}`, cwd))
    }
    return ok(undefined)
  })

  // ── shell:open-external (외부 브라우저, V1 · ADR-005) ───────────────
  // URL 프로토콜 화이트리스트(http/https)만 허용 — file:/커스텀 스킴/임의 경로 실행은
  // 차단(ADR-005 §3.3-4). URL 파싱 실패는 EINVAL, 비허용 스킴은 ESECURITY 로 실행 없이
  // 거부하고, 검증 통과 URL 만 shell.openExternal 에 위임한다(사용량 대시보드 "AI 질의").
  ipcMain.handle(CHANNELS.SHELL_OPEN_EXTERNAL, async (event, raw): Promise<Result<void>> => {
    if (!isTrustedSender(event)) return err(untrustedSenderError())

    const parsed = parseArgs(zShellOpenExternalReq, raw)
    if (!parsed.ok) return parsed as Result<void>
    const { url } = parsed.value

    // 프로토콜 화이트리스트: http/https 만. URL 파싱 실패·기타 스킴은 실행 없이 거부.
    let protocol = ''
    try {
      protocol = new URL(url).protocol
    } catch {
      return err(fileOpError('EINVAL', '유효하지 않은 URL 입니다.', url))
    }
    if (protocol !== 'http:' && protocol !== 'https:') {
      return err(fileOpError('ESECURITY', '허용되지 않은 URL 프로토콜입니다.', url))
    }

    const r = await openExternalUrl(url)
    if (r.errorMessage) {
      return err(fileOpError('EUNKNOWN', `링크를 열 수 없습니다: ${r.errorMessage}`, url))
    }
    return ok(undefined)
  })

  // ── shell:icon (OS 파일 아이콘 dataUrl, H6 · ADR-005) ───────────────
  // 읽기 전용: dataUrl 외 실행 표면 없음. sender·zod·guardPath(상위이탈 차단) 후
  // 추출. 실패해도 UI 폴백(이모지)이 있으므로 ok({dataUrl:''})로 부드럽게 반환
  // (토스트 폭주 방지). 실패(미존재·추출 null)는 캐시에 저장하지 않음.
  ipcMain.handle(CHANNELS.SHELL_ICON, async (event, raw): Promise<Result<ShellIconRes>> => {
    if (!isTrustedSender(event)) return err(untrustedSenderError())

    const parsed = parseArgs(zShellIconReq, raw)
    if (!parsed.ok) return parsed as Result<ShellIconRes>

    const g = guardPath(parsed.value.path)
    if (!g.ok) return g as Result<ShellIconRes>
    const path = g.value

    // 미존재 경로도 폴백(빈 dataUrl) — getFileIconDataUrl 이 추출 예외를 null 로 흡수.
    const { ext } = parsed.value
    const dataUrl = await getFileIconDataUrl(ext === undefined ? { path } : { path, ext })
    return ok({ dataUrl: dataUrl ?? '' })
  })
}
