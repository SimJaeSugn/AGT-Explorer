/**
 * remote 유스케이스 (app/usecases/remote) — §M M3 원격 연결·탐색·전송·이벤트 브리지.
 *
 * 책임:
 *   - 프로필 CRUD(remote:profile:*)·자격증명(remote:cred:*) 게이트(비밀은 요청 본문 전용).
 *   - 연결(remote:connect)·끊김(remote:disconnect)·호스트키 TOFU 회신.
 *   - 원격 디렉토리 탐색(remote:list)을 패널에 주입(panelsSlice._setRemoteEntries).
 *   - 원격 mkdir/rename/delete.
 *   - 전송 라우팅: 로컬↔원격 드롭/붙여넣기를 download/upload 로(transferRoute).
 *     진행률·충돌·완료·취소는 기존 op:* 브리지(operationsBridge) 재사용(MP4 operationId).
 *   - remote:host-key·remote:session-error 푸시 → remoteSlice 브리지.
 *
 * ⚠ 비밀(password/passphrase/privateKey 본문)은 store/로그에 절대 보관하지 않는다
 *   (ADR-007 ③⑥). connect/credSave 요청 본문으로만 전달하고 즉시 폐기한다.
 *
 * 경계: app → infra/api(remoteApi) 직접 호출(.eslintrc 허용). 순수 규칙은 domain 위임.
 */
import type { ConflictPolicy, RemoteProfileDTO } from '@shared/dto'
import type { RemoteSecretInput } from '@renderer/domain/entities'
import { remoteApi, subscribeRemoteEvents } from '@renderer/infra/api'
import { store } from '@renderer/app/stores/rootStore'
import {
  isRemotePath,
  makeRemotePath,
  parseRemotePath,
  type RemoteLocation
} from '@renderer/domain/rules/remoteLocation'
import { resolveTransfer } from '@renderer/domain/rules/transferRoute'
import { selectedPaths } from './fileOps'

// ── 호스트키 TOFU 회신 보류 처리 ──────────────────────────────────────────
// remote:connect 가 hostKeyDecision 없이 호출되면 main 이 remote:host-key 를 푸시한다.
// 사용자가 모달에서 결정하면 acceptHostKey/rejectHostKey 가 보류된 연결 요청을
// hostKeyDecision 과 함께 재호출한다. 비밀은 보류 요청 본문에 1회만 보관(메모리·휘발).
interface PendingConnect {
  readonly profile: RemoteProfileDTO
  readonly secret?: RemoteSecretInput
}
let pendingConnect: PendingConnect | null = null

// ── 프로필 / 자격증명 ─────────────────────────────────────────────────────

/** remote:profile:list → 슬라이스 반영. */
export async function loadProfiles(): Promise<void> {
  const res = await remoteApi.profileList()
  if (res.ok) store.getState()._setRemoteProfiles(res.value)
  else store.getState().pushToast('error', `프로필 목록 실패: ${res.error.message}`)
}

/**
 * 프로필 저장/갱신(remote:profile:upsert). saveSecret 가 주어지면 자격증명도 저장
 * (remote:cred:save). 비밀은 인자로만 받아 즉시 요청에 실어 보내고 보관하지 않는다.
 */
export async function upsertProfile(
  profile: RemoteProfileDTO,
  saveSecret?: RemoteSecretInput
): Promise<RemoteProfileDTO | null> {
  const s = store.getState()
  const res = await remoteApi.profileUpsert({ profile })
  if (!res.ok) {
    s.pushToast('error', `프로필 저장 실패: ${res.error.message}`)
    return null
  }
  if (saveSecret) {
    const credRes = await remoteApi.credSave({ profileId: res.value.id, secret: saveSecret })
    if (!credRes.ok) s.pushToast('error', `자격증명 저장 실패: ${credRes.error.message}`)
  }
  await loadProfiles()
  return res.value
}

/** 프로필 삭제(remote:profile:delete — main 이 자격증명·known_hosts 연동 정리). */
export async function deleteProfile(profileId: string): Promise<void> {
  const s = store.getState()
  const res = await remoteApi.profileDelete(profileId)
  if (!res.ok) {
    s.pushToast('error', `프로필 삭제 실패: ${res.error.message}`)
    return
  }
  await loadProfiles()
}

// ── 연결 / 끊김 / 호스트키 ─────────────────────────────────────────────────

/**
 * 원격 연결. 미저장 1회용 비밀(secret)은 요청 본문으로만 전달(영속 안 함). 연결 성공
 * 시 세션 등록 + 활성 패널을 원격 루트로 이동(탐색 진입). 호스트키 미신뢰/변경이면
 * main 이 remote:host-key 를 푸시 → hostKeyPrompt 모달 → accept/reject 후 재연결.
 */
export async function connectRemote(profile: RemoteProfileDTO, secret?: RemoteSecretInput): Promise<void> {
  const s = store.getState()
  s._remoteConnecting()
  // 호스트키 푸시가 올 수 있으니 보류 컨텍스트에 1회용 비밀 포함 보관(휘발).
  pendingConnect = secret ? { profile, secret } : { profile }
  const res = await remoteApi.connect(secret ? { profile, secret } : { profile })
  await handleConnectResult(profile, res)
}

/** 호스트키 모달 "신뢰" → 보류 연결을 hostKeyDecision:'accept' 로 재요청. */
export async function acceptHostKey(): Promise<void> {
  const s = store.getState()
  const pending = pendingConnect
  s._clearHostKeyPrompt()
  if (!pending) return
  s._remoteConnecting()
  const res = await remoteApi.connect({
    profile: pending.profile,
    ...(pending.secret ? { secret: pending.secret } : {}),
    hostKeyDecision: 'accept'
  })
  await handleConnectResult(pending.profile, res)
}

/** 호스트키 모달 "거부" → 연결 취소(보류·비밀 폐기). */
export function rejectHostKey(): void {
  const s = store.getState()
  pendingConnect = null
  s._clearHostKeyPrompt()
  s._resetRemoteConnect()
  s.pushToast('info', '호스트 키를 신뢰하지 않아 연결을 취소했습니다.')
}

/** connect 응답 공통 처리(성공 등록·실패 안내·호스트키는 푸시 이벤트에서 모달). */
async function handleConnectResult(
  profile: RemoteProfileDTO,
  res: Awaited<ReturnType<typeof remoteApi.connect>>
): Promise<void> {
  const s = store.getState()
  if (res.ok) {
    pendingConnect = null
    s._remoteConnected({ sessionId: res.value.sessionId, profile, encrypted: res.value.encrypted })
    if (!res.value.encrypted) {
      s.pushToast('info', `${profile.host} 는 평문(비암호화) 연결입니다. 자격증명이 보호되지 않습니다.`)
    }
    s.closeRemoteDialog()
    // 활성 패널을 원격 진입 폴더로 이동(탐색 진입). 원격 URI 로 navigate → load 가 remote:list.
    // 서버가 초기 작업 디렉토리(홈)를 보고하면 그곳으로, 아니면 루트('/')로 폴백한다.
    const tab = s.activeTab()
    const panelId = tab?.activePanelId
    const initial = res.value.initialPath
    const startPath = initial && initial.startsWith('/') ? initial : '/'
    const startUri = makeRemotePath(profile.protocol, profile.host, startPath)
    if (panelId) s.navigate(panelId, startUri, true)
    return
  }
  // 호스트키 미신뢰/변경은 remote:host-key 푸시로 모달이 뜬다 → 여기선 상태만 유지.
  if (res.error.code === 'EHOSTKEY') {
    // 모달이 _setHostKeyPrompt 로 표시됨(브리지). 진행 상태는 connecting 유지.
    return
  }
  pendingConnect = null
  s._remoteConnectError(remoteErrorMessage(res.error.code, res.error.message))
}

/** 세션 종료(remote:disconnect). 해당 호스트를 보던 패널은 호출측에서 로컬로 이동 권장. */
export async function disconnectRemote(sessionId: string): Promise<void> {
  const s = store.getState()
  await remoteApi.disconnect(sessionId)
  s._removeSession(sessionId)
}

// ── 원격 탐색(remote:list 결과를 패널에 주입) ──────────────────────────────

/** 원격 URI 경로(sftp://host/path)를 해석해 세션 id 와 RemoteLocation 을 찾는다. */
function resolveSession(remoteUri: string): { sessionId: string; loc: RemoteLocation } | null {
  const loc = parseRemotePath(remoteUri)
  if (!loc) return null
  const s = store.getState()
  // host 매칭(포트 무시 — 한 호스트 1세션 가정). 정확 매칭 우선.
  for (const sess of Object.values(s.remoteSessions)) {
    if (sess.profile.host === loc.host && sess.profile.protocol === loc.protocol) {
      return { sessionId: sess.sessionId, loc }
    }
  }
  return null
}

/**
 * 원격 디렉토리 탐색(panelsSlice.load 가 원격 경로일 때 호출). remote:list 결과를
 * FileEntryDTO 그대로 패널에 주입(정렬/필터/선택/가상스크롤 재사용). 세션 없으면 오류.
 */
export async function listRemoteDir(panelId: string, remoteUri: string): Promise<void> {
  const s = store.getState()
  const resolved = resolveSession(remoteUri)
  if (!resolved) {
    s._setRemoteError(panelId, remoteUri, 'ECONNRESET', '원격 세션이 없습니다. 다시 연결하세요.')
    return
  }
  s._remoteLoading(panelId, remoteUri)
  const res = await remoteApi.list(resolved.sessionId, resolved.loc.remotePath)
  if (res.ok) {
    // main(remote:list)은 POSIX 절대경로(/mnt 등)만 담아 보낸다. 패널 라우팅
    // (panelsSlice.load)·항목 활성화(activateEntry)·원격 rename/delete/download 는
    // 모두 원격 URI(sftp://host/path)를 기대하므로, 여기서 각 항목 path 를 URI 로
    // 재구성해 주입한다. (이 재구성이 없으면 디렉토리 더블클릭 시 isRemotePath(/mnt)
    // 가 false → 로컬 fs:list 로 잘못 라우팅돼 ENOENT(opendir 'D\\mnt')가 난다.)
    const { protocol, host } = resolved.loc
    const entries = res.value.entries.map((e) => ({
      ...e,
      path: makeRemotePath(protocol, host, e.path)
    }))
    store.getState()._setRemoteEntries(panelId, remoteUri, entries)
  } else {
    store
      .getState()
      ._setRemoteError(panelId, remoteUri, res.error.code, remoteErrorMessage(res.error.code, res.error.message))
  }
}

/** 원격 새 폴더(remote:mkdir) → 성공 시 패널 새로고침. */
export async function remoteMkdir(panelId: string, remoteUri: string, name: string): Promise<void> {
  const s = store.getState()
  const resolved = resolveSession(remoteUri)
  if (!resolved) return
  const res = await remoteApi.mkdir(resolved.sessionId, resolved.loc.remotePath, name)
  if (!res.ok) {
    s.pushToast('error', `폴더 생성 실패: ${remoteErrorMessage(res.error.code, res.error.message)}`)
    return
  }
  s.refresh(panelId)
}

/** 원격 이름변경(remote:rename) → 성공 시 패널 새로고침. */
export async function remoteRename(
  panelId: string,
  itemRemoteUri: string,
  newName: string
): Promise<void> {
  const s = store.getState()
  const resolved = resolveSession(itemRemoteUri)
  if (!resolved) return
  const res = await remoteApi.rename(resolved.sessionId, resolved.loc.remotePath, newName)
  if (!res.ok) {
    s.pushToast('error', `이름변경 실패: ${remoteErrorMessage(res.error.code, res.error.message)}`)
    return
  }
  s.refresh(panelId)
}

/** 원격 삭제(remote:delete) → 성공 시 패널 새로고침. */
export async function remoteDelete(panelId: string, itemRemoteUri: string): Promise<void> {
  const s = store.getState()
  const resolved = resolveSession(itemRemoteUri)
  if (!resolved) return
  const res = await remoteApi.delete(resolved.sessionId, resolved.loc.remotePath)
  if (!res.ok) {
    s.pushToast('error', `삭제 실패: ${remoteErrorMessage(res.error.code, res.error.message)}`)
    return
  }
  s.refresh(panelId)
}

// ── 전송 라우팅(download/upload — 진행률은 op:* 재사용) ─────────────────────

/**
 * 전송 1건의 결과를 operationsSlice 에 등록(진행률/충돌/완료를 op:* 브리지로 추적).
 * 원격 전송은 undo 대상 아님(undoMeta 미부여). refreshDir 폴더를 보는 패널 새로고침.
 */
function registerTransfer(operationId: string, refreshDirs: string[]): void {
  const s = store.getState()
  const refreshPaths = new Set<string>()
  for (const dir of refreshDirs) {
    for (const [id, p] of Object.entries(s.panels)) {
      if (p.path === dir) refreshPaths.add(id)
    }
  }
  // 원격 다운로드/업로드는 copy 의미(원본 보존) → kind 'copy' 로 등록(undo 미생성).
  s.registerOperation(operationId, 'copy', [...refreshPaths])
}

/**
 * 원격→로컬 다운로드(remote:download). remotePaths(원격 URI 목록)·로컬 destDir.
 * 진행률은 op:* 재사용(operationId 상관).
 */
export async function downloadToLocal(
  remoteItemUris: string[],
  localDestDir: string,
  conflictPolicy?: ConflictPolicy
): Promise<boolean> {
  const s = store.getState()
  if (remoteItemUris.length === 0) return false
  const first = parseRemotePath(remoteItemUris[0] as string)
  const resolved = first ? resolveSession(remoteItemUris[0] as string) : null
  if (!resolved) {
    s.pushToast('error', '원격 세션이 없습니다.')
    return false
  }
  // 같은 세션 가정 — 각 항목의 원격 절대경로만 추출.
  const remotePaths: string[] = []
  for (const uri of remoteItemUris) {
    const loc = parseRemotePath(uri)
    if (loc) remotePaths.push(loc.remotePath)
  }
  const res = await remoteApi.download({
    sessionId: resolved.sessionId,
    remotePaths,
    destDir: localDestDir,
    ...(conflictPolicy ? { conflictPolicy } : {})
  })
  if (!res.ok) {
    s.pushToast('error', `다운로드 실패: ${remoteErrorMessage(res.error.code, res.error.message)}`)
    return false
  }
  registerTransfer(res.value.operationId, [localDestDir])
  return true
}

/**
 * 로컬→원격 업로드(remote:upload). localPaths(로컬 절대경로)·원격 도착 URI(폴더).
 * 진행률은 op:* 재사용.
 */
export async function uploadToRemote(
  localPaths: string[],
  remoteDestUri: string,
  conflictPolicy?: ConflictPolicy
): Promise<boolean> {
  const s = store.getState()
  if (localPaths.length === 0) return false
  const resolved = resolveSession(remoteDestUri)
  if (!resolved) {
    s.pushToast('error', '원격 세션이 없습니다.')
    return false
  }
  const res = await remoteApi.upload({
    sessionId: resolved.sessionId,
    localPaths,
    remoteDir: resolved.loc.remotePath,
    ...(conflictPolicy ? { conflictPolicy } : {})
  })
  if (!res.ok) {
    s.pushToast('error', `업로드 실패: ${remoteErrorMessage(res.error.code, res.error.message)}`)
    return false
  }
  registerTransfer(res.value.operationId, [remoteDestUri])
  return true
}

/**
 * 시스템 클립보드(로컬 파일) → 원격 패널 붙여넣기 = 업로드(clipboardExternal 위임).
 * 원격 패널에서 Ctrl+V 시 호출. 시스템 클립보드의 로컬 파일을 원격으로 업로드한다.
 */
export async function pasteIntoRemote(_panelId: string, remoteDestUri: string): Promise<void> {
  const { clipboardApi } = await import('@renderer/infra/api')
  const s = store.getState()
  const clip = await clipboardApi.readFiles()
  if (!clip.ok || clip.value.paths.length === 0) {
    s.pushToast('info', '붙여넣을 항목이 없습니다.')
    return
  }
  await uploadToRemote([...clip.value.paths], remoteDestUri)
}

/**
 * D&D/복사 전송 라우팅 진입점. 출발/도착 경로(로컬 또는 원격 URI)와 수정키로
 * upload/download/local copy·move/unsupported 를 결정해 실행한다. local↔local 은
 * 호출측(performDrop)이 처리하므로 여기서는 원격 관련 전송만 담당한다.
 */
export async function routeTransfer(
  sources: string[],
  sourceDir: string,
  destDir: string,
  mods: { ctrl: boolean; shift: boolean }
): Promise<boolean> {
  const s = store.getState()
  const srcKind = isRemotePath(sourceDir) ? 'remote' : 'local'
  const dstKind = isRemotePath(destDir) ? 'remote' : 'local'
  const kind = resolveTransfer({ kind: srcKind }, { kind: dstKind }, mods, sourceDir, destDir)
  switch (kind) {
    case 'upload':
      return uploadToRemote(sources, destDir)
    case 'download':
      return downloadToLocal(sources, destDir)
    case 'unsupported':
      s.pushToast('info', '원격↔원격 직접 전송은 아직 지원하지 않습니다.')
      return false
    default:
      // copy/move(local↔local)는 이 함수가 처리하지 않음(performDrop 경로).
      return false
  }
}

// ── 오류 메시지 매핑(RemoteError code → 사용자 안내) ───────────────────────

/** RemoteError/FileOpError code → 사용자 안내(비밀 미수록). 미지 코드는 generic 폴백. */
export function remoteErrorMessage(code: string, fallback: string): string {
  switch (code) {
    case 'EAUTH':
      return '인증에 실패했습니다. 사용자명/비밀번호 또는 키를 확인하세요.'
    case 'ETIMEDOUT':
      return '연결 시간이 초과되었습니다.'
    case 'ECONNRESET':
      return '연결이 끊어졌습니다.'
    case 'EHOSTUNREACH':
      return '호스트에 연결할 수 없습니다.'
    case 'EHOSTKEY':
      return '호스트 키를 신뢰할 수 없습니다.'
    case 'EUNSUPPORTED':
      return '지원하지 않는 동작입니다.'
    case 'EACCES':
    case 'EPERM':
      return '권한이 없습니다.'
    case 'ENOENT':
      return '경로를 찾을 수 없습니다.'
    default:
      return fallback || '원격 작업에 실패했습니다.'
  }
}

// ── 푸시 이벤트 브리지(호스트키·세션 오류) ──────────────────────────────────

let disposer: (() => void) | null = null

/** remote:* 푸시 이벤트 전역 구독 시작(App 부팅 1회). 중복 호출 무시. */
export function initRemoteBridge(): void {
  if (disposer) return
  disposer = subscribeRemoteEvents({
    onHostKey: (evt) => {
      store.getState()._setHostKeyPrompt(evt)
    },
    onSessionError: (evt) => {
      const s = store.getState()
      s._removeSession(evt.sessionId)
      s.pushToast('error', `원격 세션 오류: ${remoteErrorMessage(evt.error.code, evt.error.message)}`)
    }
  })
}

/** 구독 해제(테스트·HMR). */
export function disposeRemoteBridge(): void {
  if (disposer) {
    disposer()
    disposer = null
  }
}

/** 현재 활성 패널 선택 항목(원격 URI 목록 또는 로컬 경로) — 전송 트리거 보조. */
export function activeSelection(panelId: string): string[] {
  return selectedPaths(panelId)
}
