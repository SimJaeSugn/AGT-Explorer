/**
 * 원격 위치 식별·파싱 규칙 (renderer/domain/rules/remoteLocation) — 순수 함수.
 *
 * §M M3 원격 탐색은 기존 패널 탐색 모델(`Panel.path: string`)에 통합한다.
 * 원격 경로는 software-architecture §11 의 `sftp://host/path` ·
 * `ftp(s)://host/path` 네임스페이스 URI 로 인코딩해 로컬 경로(Windows `C:\...`)와
 * 한 string 필드에서 명확히 구분한다(별도 엔티티 분기 없이 location.kind 판정).
 *
 * 부수효과 없음. react/zustand/infra/shared-ipc import 금지(.eslintrc).
 * shared/dto 의 타입(RemoteProtocol)만 import 한다.
 */
import type { RemoteProtocol } from '@shared/dto'
import { isArchivePath } from './archiveLocation'

/**
 * 위치 종류(전송 라우팅 판정 입력).
 *  - 'local'   : 로컬 Windows FS(`C:\...`)·내 PC.
 *  - 'remote'  : 원격 URI(`sftp://`·`ftp(s)://` · §M M3).
 *  - 'archive' : 압축 URI(`archive://...!/...` · §Q1 ADR-008). 압축↔로컬 전송만 1차 지원.
 */
export type LocationKind = 'local' | 'remote' | 'archive'

/** 원격 URI 스킴 prefix(software-architecture §11). */
const REMOTE_SCHEMES: readonly RemoteProtocol[] = ['sftp', 'ftp', 'ftps']

/** 원격 위치 분해 결과. */
export interface RemoteLocation {
  readonly protocol: RemoteProtocol
  /** 호스트(표시·세션 상관용). */
  readonly host: string
  /** 원격 절대경로(POSIX, 항상 '/' 시작). 루트면 '/'. */
  readonly remotePath: string
}

/** 경로가 원격 URI(sftp://·ftp://·ftps://)인가. */
export function isRemotePath(path: string): boolean {
  return REMOTE_SCHEMES.some((s) => path.startsWith(`${s}://`))
}

/**
 * 경로의 위치 종류. 압축 URI(`archive://`)면 'archive', 원격 URI 면 'remote', 그 외
 * (로컬·내 PC)는 'local'. 압축이 원격보다 먼저 판정된다(스킴 prefix 비중첩 — 상호배타).
 */
export function locationKindOf(path: string): LocationKind {
  if (isArchivePath(path)) return 'archive'
  return isRemotePath(path) ? 'remote' : 'local'
}

/**
 * 원격 URI 를 구성한다. remotePath 는 POSIX 절대경로로 정규화(앞에 '/' 보장).
 * 예: makeRemotePath('sftp','h.com','/var/log') → 'sftp://h.com/var/log'
 *     루트는 'sftp://h.com/'.
 */
export function makeRemotePath(protocol: RemoteProtocol, host: string, remotePath: string): string {
  const p = remotePath.startsWith('/') ? remotePath : `/${remotePath}`
  return `${protocol}://${host}${p}`
}

/**
 * 원격 URI 를 protocol/host/remotePath 로 분해한다. 비원격이면 null.
 * 방어적: scheme 매칭·host 비어있지 않음 확인. remotePath 는 POSIX(항상 '/' 시작).
 */
export function parseRemotePath(path: string): RemoteLocation | null {
  for (const protocol of REMOTE_SCHEMES) {
    const prefix = `${protocol}://`
    if (!path.startsWith(prefix)) continue
    const rest = path.slice(prefix.length)
    const slash = rest.indexOf('/')
    const host = slash >= 0 ? rest.slice(0, slash) : rest
    if (host === '') return null
    const remotePath = slash >= 0 ? rest.slice(slash) : '/'
    return { protocol, host, remotePath: remotePath === '' ? '/' : remotePath }
  }
  return null
}

/** 원격 자식 경로 결합(POSIX). parent='/a', name='b' → '/a/b'. 루트 처리. */
export function joinRemotePath(parentRemotePath: string, name: string): string {
  const base = parentRemotePath.replace(/\/+$/, '')
  return base === '' ? `/${name}` : `${base}/${name}`
}

/** 원격 상위 경로(POSIX). '/a/b' → '/a', '/a' → '/', '/' → '/'. */
export function remoteParentOf(remotePath: string): string {
  const norm = remotePath.replace(/\/+$/, '')
  if (norm === '' ) return '/'
  const idx = norm.lastIndexOf('/')
  if (idx <= 0) return '/'
  return norm.slice(0, idx)
}

/**
 * 원격 패널 표시 라벨(PanelHeader 배지). 예: 'sftp://user@host/var/log'.
 * 비밀 없음(username 은 비밀 아님 — RemoteProfileDTO 공개 메타).
 */
export function remoteBadge(protocol: RemoteProtocol, username: string, host: string, remotePath: string): string {
  const userPart = username ? `${username}@` : ''
  return `${protocol}://${userPart}${host}${remotePath}`
}
