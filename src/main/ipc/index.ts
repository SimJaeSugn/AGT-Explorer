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
import { registerAgentHandlers } from './agent.handlers'
import { registerAnalyzeHandlers } from './analyze.handlers'
import { registerAppHandlers } from './app.handlers'
import { registerUpdateHandlers } from './update.handlers'
import { registerArchiveHandlers } from './archive.handlers'
import { registerClipboardHandlers } from './clipboard.handlers'
import { registerDndHandlers } from './dnd.handlers'
import { registerFsHandlers } from './fs.handlers'
import { registerHashHandlers } from './hash.handlers'
import { registerOpHandlers } from './op.handlers'
import { registerPreviewHandlers } from './preview.handlers'
import { registerQueueHandlers } from './queue.handlers'
import { registerRemoteHandlers } from './remote.handlers'
import { registerSearchHandlers } from './search.handlers'
import { registerSessionHandlers } from './session.handlers'
import { registerShellHandlers } from './shell.handlers'
import { registerTrashHandlers } from './trash.handlers'
import { registerWatchHandlers } from './watch.handlers'
import { registerWindowHandlers } from './window.handlers'
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
  registerWatchHandlers() // J장 J2: fs:watch:start/stop (+ event/error 푸시)
  registerTrashHandlers() // K장 K2: trash:list/restore/empty (휴지통 COM)
  registerHashHandlers() // M7 W1: hash:compare/dup/verify:start + cancel (+ progress/done/error 푸시)
  registerQueueHandlers() // M7 W2: queue:list/pause/resume/retry/set-concurrency (+ queue:state 푸시)
  registerSearchHandlers() // M8 S1: search:content:start/cancel (+ progress/match/done 푸시 — ADR-010)
  registerWindowHandlers() // U3: window:split-tab/get-init (멀티 윈도우 — 탭 분리, US-20.3)
  registerArchiveHandlers() // M9 Q1: archive:open/list/close/extract/add (압축 어댑터 — ADR-008)
  registerAgentHandlers() // §Z Z0: agent:* + agent:provider:*/key:* (계약+키/제공자 store·루프 골격 — ADR-014·ADR-015)
  registerAppHandlers() // app:get-info (앱 기본 정보 — 설정 "소프트웨어 정보")
  registerUpdateHandlers() // update:check/download/install (사용자 주도 자동 업데이트 — 설정 "소프트웨어 정보")
  registerClipboardHdropAndDndRemote()
}

/**
 * §M 외부 연계 핸들러 등록(계약만 동결 — MP1).
 *   - dnd:start-drag (M1, impl: MP3)
 *   - remote:* (M3, impl: MP4)
 * clipboard:write-files/read-files/has-files (M2, impl: MP2)는 기존
 * registerClipboardHandlers() 안에서 기존 4채널과 병존 등록된다(비파괴 확장).
 */
function registerClipboardHdropAndDndRemote(): void {
  registerDndHandlers() // §M M1: dnd:start-drag (impl: MP3)
  registerRemoteHandlers() // §M M3: remote:* (impl: MP4)
}
