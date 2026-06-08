/**
 * RemoteService — 원격(FTP/FTPS/SFTP) 추상 인터페이스 (§M M3, MP4 실구현).
 *
 * ⚠ `src/main/remote/` 는 **유일한 네트워크 특권 디렉토리**다(ADR-007 결정②·DS §5-M).
 *    이 디렉토리 안에서만 `node:tls`·`ssh2`·`ssh2-sftp-client`·`basic-ftp` import 가
 *    ESLint `no-restricted-imports` 예외(allow)로 허용된다. 그 외 main 전 경로에서는
 *    네트워크/TLS/원격 라이브러리 import 가 lint 에러다(화이트리스트 격리 모델).
 *
 * 어댑터(SftpAdapter·FtpAdapter)는 본 인터페이스를 구현해 프로토콜 차이를 흡수한다.
 * 상위 계층(RemoteSessionManager·remoteTransfer·ipc/remote.handlers.ts)은 본 인터페이스와
 * 어댑터가 노출하는 connect/list/stat/mkdir/rename/delete/download/upload 만 의존한다.
 * 네트워크 표면은 이 디렉토리 경계 뒤로 캡슐화된다(ADR-007 결정②-3).
 *
 * 비밀(password/passphrase/privateKey)은 ConnectOpts.secret 으로 **연결 수립 시점에만** 흘러
 * 어댑터 메모리에 머물며, 응답 DTO·로그·Error 에 절대 싣지 않는다(ADR-007 결정⑥-6).
 */
import type { FileEntryDTO } from '@shared/dto'
import type { FileOpError, Result } from '@shared/ipc/contracts'

/**
 * 원격 오류 = `FileOpError`(code 유니온 확장). 별도 타입·판별 kind 없음.
 * 직렬화 규약 동일이며 **비밀 필드를 절대 싣지 않는다**(ADR-007 결정⑥).
 */
export type RemoteError = FileOpError

/** 비밀 종류·본문(연결 수립 1회용 — 어떤 영속·응답에도 두지 않는다). */
export interface RemoteSecretInput {
  readonly kind: 'password' | 'passphrase' | 'privateKey'
  readonly value: string
}

/**
 * 호스트키 검증 콜백 결과. SFTP 어댑터가 TOFU 판정을 위해 호출한다.
 *  - 'accept': 신뢰(연결 진행)
 *  - 'reject': 거부(연결 중단 — EHOSTKEY)
 *  - 'prompt': 사용자 확인 필요(상위가 remote:host-key 푸시 후 재연결)
 */
export type HostKeyDecision = 'accept' | 'reject' | 'prompt'

/** 호스트키 정보(지문·알고리즘·TOFU 상태). 비밀 아님(지문만). */
export interface HostKeyInfo {
  readonly fingerprint: string
  readonly algo: string
  readonly status: 'unknown' | 'changed' | 'known'
}

/** 원격 연결 옵션. secret 은 1회용(저장 안 함은 상위 결정). */
export interface ConnectOpts {
  readonly protocol: 'ftp' | 'ftps' | 'sftp'
  readonly host: string
  readonly port: number
  readonly username: string
  readonly authMethod: 'password' | 'privateKey'
  /** 연결 수립용 비밀(없으면 익명/키 없음). 어댑터 메모리 한정. */
  readonly secret?: RemoteSecretInput
}

/**
 * 원격 연결 결과. `encrypted=false` 는 평문 FTP(비암호화 경고 대상).
 *
 * **호스트키 TOFU 설계(중요)**: SFTP 어댑터는 호스트키를 **거부하지 않고**(거부 시
 * ssh2-sftp-client `connect()` 가 Electron 런타임에서 settle 되지 않고 hang — 실측 확인),
 * 항상 신뢰해 연결을 수립한 뒤 서버 호스트키 **지문(fingerprint)** 을 여기에 담아 반환한다.
 * 신뢰 여부(known 대조·prompt·저장)는 상위 `RemoteSessionManager` 가 **연결 성립 후** 판정해
 * 미승인 호스트면 세션을 즉시 끊고 `remote:host-key` 푸시 + EHOSTKEY 를 돌려준다.
 * FTP/FTPS 는 호스트키가 없어 `fingerprint` 가 없다.
 */
export interface ConnectResult {
  readonly encrypted: boolean
  /** SFTP 서버 호스트키 지문(`SHA256:<base64>`). 매니저 TOFU 판정용. FTP/FTPS 는 미존재. */
  readonly fingerprint?: string
  /** 호스트키 알고리즘(표시용). */
  readonly algo?: string
}

/** 전송 진행률 콜백(누적 바이트). remoteTransfer 가 op:progress 로 중계한다. */
export type TransferProgress = (transferredBytes: number) => void

/** 취소 신호(AbortSignal 류). 전송 중 주기적으로 확인해 스트림 파기. */
export interface CancelSignal {
  readonly aborted: boolean
}

/**
 * 어댑터 공통 인터페이스 — 상위 계층은 이것만 본다(SFTP/FTP 차이를 어댑터가 흡수).
 * 각 어댑터 인스턴스는 **단일 연결 세션 1개**를 표현한다(SessionManager 가 sessionId 매핑).
 * 모든 반환은 Result(throw 0) — 끊김/타임아웃/에러는 RemoteError 코드로 정규화.
 */
export interface RemoteAdapter {
  /** 연결 수립. 실패 시 RemoteError(EAUTH/ETIMEDOUT/ECONNRESET/EHOSTUNREACH/EHOSTKEY). */
  connect(opts: ConnectOpts): Promise<Result<ConnectResult, RemoteError>>
  /** 연결 종료(idempotent). */
  disconnect(): Promise<Result<void>>
  /** 디렉토리 목록(원격 POSIX 절대경로). entries 는 FileEntryDTO 로 정규화. */
  list(path: string): Promise<Result<{ entries: FileEntryDTO[] }, RemoteError>>
  /** 단일 항목 stat. */
  stat(path: string): Promise<Result<FileEntryDTO, RemoteError>>
  /** 디렉토리 생성(parentPath/name). */
  mkdir(parentPath: string, name: string): Promise<Result<void, RemoteError>>
  /** 이름 변경(path → 같은 디렉토리의 newName). */
  rename(path: string, newName: string): Promise<Result<void, RemoteError>>
  /** 삭제(파일/디렉토리). */
  delete(path: string): Promise<Result<void, RemoteError>>
  /** 다운로드: 원격 파일 → 로컬 경로. .part 임시명·원자 rename 은 remoteTransfer 가 관리. */
  download(
    remotePath: string,
    localPath: string,
    onProgress: TransferProgress,
    cancel: CancelSignal
  ): Promise<Result<void, RemoteError>>
  /** 업로드: 로컬 파일 → 원격 경로. */
  upload(
    localPath: string,
    remotePath: string,
    onProgress: TransferProgress,
    cancel: CancelSignal
  ): Promise<Result<void, RemoteError>>
}

/**
 * RemoteService — 세션 단위 외부 표면(SessionManager 가 구현). 상위(핸들러)는 sessionId 로
 * 작업을 지시한다. 어댑터(RemoteAdapter)는 세션 내부에 캡슐화된다.
 */
export interface RemoteService {
  list(sessionId: string, path: string): Promise<Result<{ entries: FileEntryDTO[] }, RemoteError>>
  stat(sessionId: string, path: string): Promise<Result<FileEntryDTO, RemoteError>>
  mkdir(sessionId: string, path: string, name: string): Promise<Result<void, RemoteError>>
  rename(sessionId: string, path: string, newName: string): Promise<Result<void, RemoteError>>
  delete(sessionId: string, path: string): Promise<Result<void, RemoteError>>
}
