/**
 * IPC 핸들러 부트스트랩 — 전 도메인 핸들러 등록 진입점.
 *
 * P1: fs:* 읽기 계열만 등록한다. 이후 Phase 에서 아래에 추가한다:
 *   - registerShellHandlers()  // P2/P4
 *   - registerOpHandlers()     // P4
 *   - registerClipboardHandlers() // P4
 *   - registerSessionHandlers()   // P5
 *   - registerWorkspaceHandlers() // P6
 */
import { registerAnalyzeHandlers } from './analyze.handlers'
import { registerClipboardHandlers } from './clipboard.handlers'
import { registerFsHandlers } from './fs.handlers'
import { registerOpHandlers } from './op.handlers'
import { registerPreviewHandlers } from './preview.handlers'
import { registerSessionHandlers } from './session.handlers'
import { registerShellHandlers } from './shell.handlers'
import { registerWorkspaceHandlers } from './workspace.handlers'

export function registerIpcHandlers(): void {
  registerFsHandlers()
  registerShellHandlers() // P2: shell:open · P4: shell:show-properties
  registerOpHandlers() // P4: op:* + fs:mkdir/create-file/rename + dialog:confirm-permanent-delete
  registerClipboardHandlers() // P4: clipboard:*
  registerSessionHandlers() // P5: session:* / settings:* / telemetry:set-opt-in/get-opt-in
  registerPreviewHandlers() // P6: preview:read
  registerWorkspaceHandlers() // P6: workspace:save/list/load/delete
  registerAnalyzeHandlers() // I장: analyze:scan:start/cancel (+ progress/done/error 푸시)
}
