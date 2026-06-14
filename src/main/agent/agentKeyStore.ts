/**
 * src/main/agent/agentKeyStore.ts — 제공자별 키 safeStorage 슬롯(ADR-015 G5·ADR-014 결정②).
 *
 * `ProviderId → 암호문` 맵을 safeStorage(DPAPI)로 암호화해 `userData/agent/keys.enc` 에 보관한다.
 * **평문은 디스크·설정·세션·로그·오류·IPC DTO 어디에도 0**(DTO 에 apiKey 필드 부재). 복호는
 * provider 팩토리가 createCompletion 직전에만 수행(SDK 클라이언트 주입 시점). credentials.ts
 * (createCredentialStore) 동형 — safeStorage·fileIo 를 주입받아 헤드리스 verify 가 실 DPAPI·실
 * 파일 없이 라운드트립을 검증한다. safeStorage 미가용 시 평문 폴백 금지(EUNSUPPORTED).
 */
import { join } from 'node:path'
import type { ProviderId, Result } from '@shared/ipc/contracts'
import { err, ok } from '@shared/ipc/contracts'
import { fileOpError } from '../fs/errors'
import type { CredFileIo, SafeStorageLike } from '../os/credentials'
import { readJsonSafe, writeJsonAtomic } from '../persistence/atomic'

const defaultFileIo: CredFileIo = {
  read: (p) => readJsonSafe<Record<string, string>>(p),
  write: (p, v) => writeJsonAtomic(p, v)
}

/** 제공자별 키 store 공개 인터페이스(핸들러·provider 팩토리가 의존). */
export interface AgentKeyStore {
  isAvailable(): boolean
  /** DPAPI 암호화 저장(사용자 "키 설정" 게이트). 응답에 키 미수록. */
  set(provider: ProviderId, apiKey: string): Promise<Result<void>>
  /** 복호 조회(createCompletion 직전). 없으면 ok(null). 호출부 즉시 폐기. */
  get(provider: ProviderId): Promise<Result<string | null>>
  /** 보유 여부만(키 미노출). */
  has(provider: ProviderId): Promise<Result<{ has: boolean }>>
  /** 삭제. */
  delete(provider: ProviderId): Promise<Result<void>>
}

/**
 * AgentKeyStore 구현. safeStorage·fileIo·baseDir 주입(헤드리스 검증 가능).
 * 파일: `<baseDir>/agent/keys.enc` = `{ [providerId]: base64(encryptedBytes) }`.
 */
export function createAgentKeyStore(
  safeStorage: SafeStorageLike,
  baseDir: string,
  fileIo: CredFileIo = defaultFileIo
): AgentKeyStore {
  const filePath = join(baseDir, 'agent', 'keys.enc')

  async function readMap(): Promise<Record<string, string>> {
    const raw = await fileIo.read(filePath)
    return raw && typeof raw === 'object' ? raw : {}
  }

  function available(): boolean {
    try {
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  return {
    isAvailable: available,

    async set(provider, apiKey): Promise<Result<void>> {
      if (!provider) return err(fileOpError('EINVAL', '제공자 식별자가 비어 있습니다.'))
      if (!apiKey) return err(fileOpError('EINVAL', 'API 키가 비어 있습니다.'))
      if (!available()) {
        return err(
          fileOpError('EUNSUPPORTED', '이 환경에서는 API 키 암호화 저장을 사용할 수 없습니다.')
        )
      }
      let encryptedB64: string
      try {
        const enc = safeStorage.encryptString(apiKey)
        encryptedB64 = Buffer.from(enc).toString('base64')
      } catch {
        // 키 값 메시지에 미수록.
        return err(fileOpError('EUNKNOWN', 'API 키 암호화에 실패했습니다.'))
      }
      const map = await readMap()
      map[provider] = encryptedB64
      const wrote = await fileIo.write(filePath, map)
      if (!wrote) return err(fileOpError('EUNKNOWN', 'API 키 저장에 실패했습니다.'))
      return ok(undefined)
    },

    async get(provider): Promise<Result<string | null>> {
      if (!provider) return err(fileOpError('EINVAL', '제공자 식별자가 비어 있습니다.'))
      const map = await readMap()
      const b64 = map[provider]
      if (typeof b64 !== 'string' || b64.length === 0) return ok(null)
      try {
        return ok(safeStorage.decryptString(Buffer.from(b64, 'base64')))
      } catch {
        return err(fileOpError('EUNKNOWN', 'API 키 복호화에 실패했습니다.'))
      }
    },

    async has(provider): Promise<Result<{ has: boolean }>> {
      if (!provider) return ok({ has: false })
      const map = await readMap()
      return ok({ has: typeof map[provider] === 'string' && map[provider]!.length > 0 })
    },

    async delete(provider): Promise<Result<void>> {
      if (!provider) return ok(undefined)
      const map = await readMap()
      if (!(provider in map)) return ok(undefined)
      delete map[provider]
      const wrote = await fileIo.write(filePath, map)
      if (!wrote) return err(fileOpError('EUNKNOWN', 'API 키 삭제에 실패했습니다.'))
      return ok(undefined)
    }
  }
}

// ── 앱 런타임 싱글턴(electron safeStorage 주입) ────────────────────────────

let _store: AgentKeyStore | null = null

/** 앱 부팅 시 1회. baseDir = app.getPath('userData'). */
export function initAgentKeyStore(baseDir: string): AgentKeyStore {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { safeStorage } = require('electron') as { safeStorage: SafeStorageLike }
  _store = createAgentKeyStore(safeStorage, baseDir)
  return _store
}

/** 초기화된 싱글턴 접근(핸들러·팩토리용). */
export function agentKeyStore(): AgentKeyStore {
  if (!_store) throw new Error('agentKeyStore not initialized — call initAgentKeyStore() first')
  return _store
}
