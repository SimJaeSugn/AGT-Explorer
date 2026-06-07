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
import type { Result } from '@shared/ipc/contracts'
import { err, ok } from '@shared/ipc/contracts'
import { fileOpError, toFileOpError } from '../fs/errors'
import { openPath, openWith, showProperties } from '../os/shell'
import {
  guardPath,
  isTrustedSender,
  parseArgs,
  untrustedSenderError,
  zPath,
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
}
