/**
 * verify:remote-route (§M MP5) — 전송 라우팅·외부 드래그 필터·클립보드 effect·
 * 원격 URI 파싱·remoteSlice 상태 전이를 순수 로직으로 헤드리스 검증.
 *
 * 실제 GUI 원격 연결·드래그·클립보드 왕복은 런타임 스모크 영역(🟡). 본 하니스는
 * domain 순수함수(transferRoute·remoteLocation)와 store 전이의 정합만 단언한다.
 *
 * 양식: 기존 verify:store/verify:domain(esbuild esm·@renderer 별칭). window.api 모킹.
 */

// ── window.api 모킹(infra/api bridge 가 참조 — rootStore import 전에 주입) ──
const fakeApi = {
  version: 'test',
  fs: {
    list: async () => ({ ok: true, value: { entries: [], truncated: false } }),
    drives: async () => ({ ok: true, value: [] }),
    listStart: async () => ({ ok: true, value: { streamId: 'sid' } }),
    listCancel: async () => ({ ok: true, value: undefined }),
    onListChunk: () => () => undefined,
    onListDone: () => () => undefined,
    onListError: () => () => undefined
  },
  remote: {
    onHostKey: () => () => undefined,
    onSessionError: () => () => undefined
  }
}
;(globalThis as unknown as { api: unknown }).api = fakeApi
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
  observe(): void {}
  disconnect(): void {}
}

import {
  resolveTransfer,
  transferToExternal,
  isExternalDragAllowed,
  clipboardEffectToOpKind
} from '../src/renderer/domain/rules/transferRoute'
import {
  isRemotePath,
  locationKindOf,
  parseRemotePath,
  makeRemotePath,
  joinRemotePath,
  remoteParentOf,
  remoteBadge
} from '../src/renderer/domain/rules/remoteLocation'
import { useRootStore } from '../src/renderer/app/stores/rootStore'
import type { RemoteProfileDTO } from '../src/shared/dto'

let pass = 0
let fail = 0
function eq(label: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got)
  const w = JSON.stringify(want)
  if (g === w) pass++
  else {
    fail++
    // eslint-disable-next-line no-console
    console.log('FAIL', label, '| got', g, '| want', w)
  }
}
function ok(label: string, cond: boolean): void {
  if (cond) pass++
  else {
    fail++
    // eslint-disable-next-line no-console
    console.log('FAIL', label)
  }
}

const L = { kind: 'local' } as const
const R = { kind: 'remote' } as const
const noMods = { ctrl: false, shift: false }

// ── 1. transferRoute 진리표(라우팅 결정) ──────────────────────────────────
// local → remote = upload, remote → local = download, remote → remote = unsupported.
eq('local→remote = upload', resolveTransfer(L, R, noMods, 'C:\\a', 'sftp://h/x'), 'upload')
eq('remote→local = download', resolveTransfer(R, L, noMods, 'sftp://h/x', 'C:\\a'), 'download')
eq('remote→remote = unsupported', resolveTransfer(R, R, noMods, 'sftp://h/x', 'sftp://h/y'), 'unsupported')
// local↔local 은 dragIntent 재사용: 같은 드라이브=move, 다른 드라이브=copy.
eq('local→local 같은 드라이브 = move', resolveTransfer(L, L, noMods, 'C:\\a', 'C:\\b'), 'move')
eq('local→local 다른 드라이브 = copy', resolveTransfer(L, L, noMods, 'C:\\a', 'D:\\b'), 'copy')
eq('local→local Ctrl = copy', resolveTransfer(L, L, { ctrl: true, shift: false }, 'C:\\a', 'C:\\b'), 'copy')
eq('local→local Shift = move', resolveTransfer(L, L, { ctrl: false, shift: true }, 'C:\\a', 'D:\\b'), 'move')
// 외부(M1) 도착 = 복사 고정.
eq('외부 도착 = copy 고정', transferToExternal(), 'copy')

// ── 2. 외부 드래그 로컬 한정 필터(M1) ──────────────────────────────────────
ok('모두 로컬 → 외부 드래그 허용', isExternalDragAllowed(['local', 'local']))
ok('원격 포함 → 외부 드래그 불가', !isExternalDragAllowed(['local', 'remote']))
ok('빈 선택 → 외부 드래그 불가', !isExternalDragAllowed([]))

// ── 3. 클립보드 effect → op kind(M2) ──────────────────────────────────────
eq('clip move → move', clipboardEffectToOpKind('move'), 'move')
eq('clip copy → copy', clipboardEffectToOpKind('copy'), 'copy')
eq('clip none → copy(폴백)', clipboardEffectToOpKind('none'), 'copy')

// ── 4. 원격 URI 파싱/구성(software-arch §11 네임스페이스) ───────────────────
ok('sftp:// 는 원격', isRemotePath('sftp://h/x'))
ok('ftp:// 는 원격', isRemotePath('ftp://h/x'))
ok('ftps:// 는 원격', isRemotePath('ftps://h/x'))
ok('C:\\ 는 원격 아님', !isRemotePath('C:\\Users'))
eq('locationKindOf 원격', locationKindOf('sftp://h/x'), 'remote')
eq('locationKindOf 로컬', locationKindOf('C:\\Users'), 'local')
eq('parseRemotePath 분해', parseRemotePath('sftp://example.com/var/log'), {
  protocol: 'sftp',
  host: 'example.com',
  remotePath: '/var/log'
})
eq('parseRemotePath 루트', parseRemotePath('ftp://h.com/'), {
  protocol: 'ftp',
  host: 'h.com',
  remotePath: '/'
})
eq('parseRemotePath 호스트만', parseRemotePath('sftp://h.com'), {
  protocol: 'sftp',
  host: 'h.com',
  remotePath: '/'
})
eq('parseRemotePath 비원격 null', parseRemotePath('C:\\x'), null)
eq('makeRemotePath 구성', makeRemotePath('sftp', 'h.com', '/a/b'), 'sftp://h.com/a/b')
eq('makeRemotePath 루트', makeRemotePath('ftp', 'h.com', '/'), 'ftp://h.com/')
eq('joinRemotePath', joinRemotePath('/a', 'b'), '/a/b')
eq('joinRemotePath 루트', joinRemotePath('/', 'b'), '/b')
eq('remoteParentOf', remoteParentOf('/a/b/c'), '/a/b')
eq('remoteParentOf 1단계', remoteParentOf('/a'), '/')
eq('remoteParentOf 루트', remoteParentOf('/'), '/')
eq('remoteBadge', remoteBadge('sftp', 'me', 'h.com', '/var'), 'sftp://me@h.com/var')

// ── 5. remoteSlice 상태 전이(연결/끊김/호스트키 경고) ───────────────────────
const profile: RemoteProfileDTO = {
  id: 'p1',
  name: '테스트',
  protocol: 'sftp',
  host: 'h.com',
  port: 22,
  username: 'me',
  authMethod: 'password'
}
const st = useRootStore.getState()

st._remoteConnecting()
eq('connecting 상태', useRootStore.getState().remoteConnectStatus, 'connecting')

st._remoteConnected({ sessionId: 's1', profile, encrypted: true })
const afterConnect = useRootStore.getState()
eq('connected 상태', afterConnect.remoteConnectStatus, 'connected')
ok('세션 등록됨', afterConnect.remoteSessions['s1']?.sessionId === 's1')
ok('host 상관 등록', afterConnect.remoteSessionByHost['h.com:22'] === 's1')

// 호스트키 경고 전이.
st._setHostKeyPrompt({ connectId: 'c1', fingerprint: 'SHA256:abc', algo: 'ssh-ed25519', status: 'changed' })
const afterHk = useRootStore.getState()
ok('호스트키 프롬프트 표시', afterHk.hostKeyPrompt?.status === 'changed')
st._clearHostKeyPrompt()
ok('호스트키 프롬프트 해제', useRootStore.getState().hostKeyPrompt === null)

// 세션 제거(끊김/오류).
st._removeSession('s1')
const afterRemove = useRootStore.getState()
ok('세션 제거됨', afterRemove.remoteSessions['s1'] === undefined)
ok('host 상관 정리됨', afterRemove.remoteSessionByHost['h.com:22'] === undefined)

// 연결 오류 전이.
st._remoteConnectError('인증 실패')
eq('error 상태', useRootStore.getState().remoteConnectStatus, 'error')
eq('error 메시지', useRootStore.getState().remoteConnectError, '인증 실패')
st._resetRemoteConnect()
eq('초기화 후 idle', useRootStore.getState().remoteConnectStatus, 'idle')

// 프로필 목록 반영.
st._setRemoteProfiles([profile])
ok('프로필 목록 반영', useRootStore.getState().remoteProfiles.length === 1)

// ── 6. 비밀 비보관 불변식(remoteSlice 직렬화에 비밀 패턴 부재) ──────────────
const snapshot = JSON.stringify({
  remoteProfiles: useRootStore.getState().remoteProfiles,
  remoteSessions: useRootStore.getState().remoteSessions,
  hostKeyPrompt: useRootStore.getState().hostKeyPrompt
})
ok('store 직렬화에 password 키 부재', !/"password"\s*:/.test(snapshot))
ok('store 직렬화에 privateKey 키 부재', !/"privateKey"\s*:/.test(snapshot))
ok('store 직렬화에 secret 키 부재', !/"secret"\s*:/.test(snapshot))

// eslint-disable-next-line no-console
console.log(`\nverify:remote-route — ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
