/**
 * 자격증명 저장소 — Electron safeStorage(DPAPI) 전용 (§M M3 · ADR-007 결정③·D6).
 *
 * 비밀(FTP 비밀번호·SSH 패스프레이즈·개인키 본문)은 **safeStorage 로 암호화한 바이트만**
 * `userData/remote/credentials.enc` 에 보관한다. **평문은 디스크·DTO·로그·Error 에 절대 닿지
 * 않는다.** 복호화된 비밀은 연결 수립 시점에만 메모리에 존재하고 호출부가 즉시 폐기한다.
 *
 * 저장 포맷(CN-3): `credentials.enc` = `{ [profileId]: base64(encryptedBytes) }` JSON.
 * **암호문만** 담기므로 atomic.ts 의 "비밀(평문) 저장 금지" 규약과 모순되지 않는다 —
 * 평문이 아닌 DPAPI 암호문 저장은 허용(atomic.ts 헤더에 메모 보강). 단, 본 store 는 secret
 * 을 메모리에서 즉시 암호화한 뒤에만 디스크 경로(writeJsonAtomic)에 넘긴다.
 *
 * safeStorage 미가용(`isEncryptionAvailable()===false`) 환경에서는 save 가 EUNSUPPORTED 로
 * 거부한다 — **평문 폴백 금지**(메모리 전용 모드 안내는 상위 UI). 헤드리스 verify 는
 * encrypt/decrypt 래퍼와 파일 IO 를 주입해 실제 DPAPI·실 파일 없이 라운드트립을 검증한다.
 */
import { join } from 'node:path'
import type { Result } from '@shared/ipc/contracts'
import { err, ok } from '@shared/ipc/contracts'
import { fileOpError } from '../fs/errors'
import { readJsonSafe, writeJsonAtomic } from '../persistence/atomic'

/** safeStorage 추상(주입 가능 — verify 가 스텁). 실제는 electron safeStorage 를 감싼다. */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  /** 평문 → 암호문 바이트. */
  encryptString(plain: string): Buffer
  /** 암호문 바이트 → 평문. */
  decryptString(encrypted: Buffer): string
}

/** 파일 IO 추상(주입 가능). 기본은 persistence/atomic 의 원자적 JSON. */
export interface CredFileIo {
  read(path: string): Promise<Record<string, string> | undefined>
  write(path: string, value: Record<string, string>): Promise<boolean>
}

const defaultFileIo: CredFileIo = {
  read: (p) => readJsonSafe<Record<string, string>>(p),
  write: (p, v) => writeJsonAtomic(p, v)
}

/** 자격증명 store 공개 인터페이스(핸들러가 의존). 비밀은 save/load 인자/반환으로만 흐른다. */
export interface CredentialStore {
  /** safeStorage 암호화 가용 여부(false 면 save 거부 — 메모리 전용 모드). */
  isAvailable(): boolean
  /** DPAPI 암호화 저장(사용자 "저장" 게이트 통과 시에만 호출). 응답에 secret 미수록. */
  save(profileId: string, secret: string): Promise<Result<void>>
  /** 복호화 조회(연결 수립 시점에만). 없으면 ok(null). 호출부가 즉시 폐기. */
  load(profileId: string): Promise<Result<string | null>>
  /** 저장 여부만(비밀 미노출). */
  has(profileId: string): Promise<Result<{ has: boolean }>>
  /** 삭제(프로필 삭제 연동). */
  delete(profileId: string): Promise<Result<void>>
}

/**
 * CredentialStore 구현. safeStorage·fileIo·파일경로를 주입받아 헤드리스 검증을 가능케 한다.
 * baseDir = userData. 실제 파일은 `<baseDir>/remote/credentials.enc`.
 */
export function createCredentialStore(
  safeStorage: SafeStorageLike,
  baseDir: string,
  fileIo: CredFileIo = defaultFileIo
): CredentialStore {
  const filePath = join(baseDir, 'remote', 'credentials.enc')

  async function readMap(): Promise<Record<string, string>> {
    const raw = await fileIo.read(filePath)
    return raw && typeof raw === 'object' ? raw : {}
  }

  return {
    isAvailable(): boolean {
      try {
        return safeStorage.isEncryptionAvailable()
      } catch {
        return false
      }
    },

    async save(profileId, secret): Promise<Result<void>> {
      if (!profileId) return err(fileOpError('EINVAL', '프로필 식별자가 비어 있습니다.'))
      let available = false
      try {
        available = safeStorage.isEncryptionAvailable()
      } catch {
        available = false
      }
      if (!available) {
        // 평문 폴백 금지 — 저장 비활성(메모리 전용 모드 안내는 상위).
        return err(
          fileOpError('EUNSUPPORTED', '이 환경에서는 자격증명 암호화 저장을 사용할 수 없습니다.')
        )
      }
      let encryptedB64: string
      try {
        const enc = safeStorage.encryptString(secret)
        encryptedB64 = Buffer.from(enc).toString('base64')
      } catch {
        // 암호화 실패 메시지에 secret 미수록.
        return err(fileOpError('EUNKNOWN', '자격증명 암호화에 실패했습니다.'))
      }
      const map = await readMap()
      map[profileId] = encryptedB64
      const wrote = await fileIo.write(filePath, map)
      if (!wrote) return err(fileOpError('EUNKNOWN', '자격증명 저장에 실패했습니다.'))
      return ok(undefined)
    },

    async load(profileId): Promise<Result<string | null>> {
      if (!profileId) return err(fileOpError('EINVAL', '프로필 식별자가 비어 있습니다.'))
      const map = await readMap()
      const b64 = map[profileId]
      if (typeof b64 !== 'string' || b64.length === 0) return ok(null)
      try {
        const plain = safeStorage.decryptString(Buffer.from(b64, 'base64'))
        return ok(plain)
      } catch {
        // 복호화 실패(키 손상·다른 사용자) → 비밀 미노출, null 폴백 아닌 명시 오류.
        return err(fileOpError('EUNKNOWN', '자격증명 복호화에 실패했습니다.'))
      }
    },

    async has(profileId): Promise<Result<{ has: boolean }>> {
      if (!profileId) return ok({ has: false })
      const map = await readMap()
      return ok({ has: typeof map[profileId] === 'string' && map[profileId]!.length > 0 })
    },

    async delete(profileId): Promise<Result<void>> {
      if (!profileId) return ok(undefined)
      const map = await readMap()
      if (!(profileId in map)) return ok(undefined)
      delete map[profileId]
      const wrote = await fileIo.write(filePath, map)
      if (!wrote) return err(fileOpError('EUNKNOWN', '자격증명 삭제에 실패했습니다.'))
      return ok(undefined)
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// 앱 런타임 싱글턴(electron safeStorage 주입). 헤드리스 verify 는 createCredentialStore
// 를 직접 호출하므로 아래 init 은 electron 의존을 런타임에만 끌어온다(번들 분리 불요 —
// os/ 디렉토리는 electron import 허용).
// ──────────────────────────────────────────────────────────────────────────

let _store: CredentialStore | null = null

/** 앱 부팅 시 1회. baseDir = app.getPath('userData'). */
export function initCredentialStore(baseDir: string): CredentialStore {
  // electron safeStorage 를 지연 require 로 감싼다(테스트 격리·번들 영향 0).
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { safeStorage } = require('electron') as { safeStorage: SafeStorageLike }
  _store = createCredentialStore(safeStorage, baseDir)
  return _store
}

/** 초기화된 싱글턴 접근(핸들러용). */
export function credentialStore(): CredentialStore {
  if (!_store) throw new Error('credentialStore not initialized — call initCredentialStore() first')
  return _store
}
