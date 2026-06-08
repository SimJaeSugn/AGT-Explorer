/**
 * `ssh2-sftp-client` 로컬 ambient 선언 (§M M3).
 *
 * 이 라이브러리·내부 `ssh2` 는 타입 선언을 동봉하지 않고 `@types/*` 도 설치돼 있지 않다.
 * `src/main/remote/` 안에서만 import 되므로(ESLint 화이트리스트), 본 디렉토리 한정 ambient
 * 선언으로 **사용하는 API 표면만** 타입화한다. 런타임은 실제 JS 모듈을 쓰고 TS 는 이 선언을
 * 참조한다(skipLibCheck=true·exactOptionalPropertyTypes 정합 위해 필요한 필드만 선언).
 */
declare module 'ssh2-sftp-client' {
  import type { Writable, Readable } from 'node:stream'

  /** SFTP 디렉토리 항목(ls 결과). type: 'd'|'-'|'l' (dir/file/symlink). */
  export interface FileInfo {
    type: 'd' | '-' | 'l' | 'b' | 'c' | 'p' | 's'
    name: string
    size: number
    modifyTime: number
    accessTime: number
    rights: { user: string; group: string; other: string }
    owner: number
    group: number
    longname?: string
  }

  /** stat 결과(부분). */
  export interface SftpStats {
    mode: number
    uid: number
    gid: number
    size: number
    accessTime: number
    modifyTime: number
    isDirectory: boolean
    isFile: boolean
    isSymbolicLink: boolean
  }

  /** hostVerifier 콜백 — 호스트키 raw(Buffer) 또는 hash 문자열을 받고 신뢰 여부 반환. */
  export type HostVerifier =
    | ((keyHash: string) => boolean)
    | ((key: Buffer, callback: (trusted: boolean) => void) => void)

  export interface ConnectOptions {
    host: string
    port?: number
    username?: string
    password?: string
    privateKey?: string | Buffer
    passphrase?: string
    readyTimeout?: number
    /** ssh2 호스트키 검증 훅(TOFU). */
    hostVerifier?: HostVerifier
    /** 디버그 로깅(미사용). */
    debug?: (msg: string) => void
  }

  export interface TransferOptions {
    /** 진행률 step 콜백(전송 바이트 누적). */
    step?: (transferred: number, chunk: number, total: number) => void
    /** 쓰기 스트림 옵션 등. */
    readStreamOptions?: Record<string, unknown>
    writeStreamOptions?: Record<string, unknown>
  }

  export default class SftpClient {
    constructor(name?: string)
    connect(options: ConnectOptions): Promise<unknown>
    end(): Promise<boolean>
    list(remotePath: string): Promise<FileInfo[]>
    stat(remotePath: string): Promise<SftpStats>
    exists(remotePath: string): Promise<false | 'd' | '-' | 'l'>
    mkdir(remotePath: string, recursive?: boolean): Promise<string>
    rename(fromPath: string, toPath: string): Promise<string>
    delete(remotePath: string, noErrorOK?: boolean): Promise<string>
    rmdir(remotePath: string, recursive?: boolean): Promise<string>
    /** 다운로드: 원격 → 로컬 경로 또는 Writable. */
    get(
      remotePath: string,
      dst?: string | Writable,
      options?: TransferOptions
    ): Promise<string | Buffer | Writable>
    fastGet(remotePath: string, localPath: string, options?: TransferOptions): Promise<string>
    /** 업로드: 로컬 경로/Readable → 원격. */
    put(
      src: string | Buffer | Readable,
      remotePath: string,
      options?: TransferOptions
    ): Promise<string>
    fastPut(localPath: string, remotePath: string, options?: TransferOptions): Promise<string>
  }
}
