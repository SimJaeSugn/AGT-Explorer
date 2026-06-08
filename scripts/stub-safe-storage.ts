/**
 * verify-credentials 전용 safeStorage 스텁(헤드리스).
 *
 * 실제 DPAPI 없이 라운드트립을 검증하기 위한 결정적 암호화 모사:
 *  - encryptString(plain): "ENC:" 접두사 + base64(plain) 바이트(평문 아닌 "암호문" 모사).
 *  - decryptString(buf): 접두사 검증 후 역변환.
 *  - isEncryptionAvailable(): 토글 가능(__setAvailable).
 *
 * 핵심: verify 가 디스크에 닿는 객체(파일 IO 스텁이 보관)에 **평문 secret 이 없음**을 단언할
 * 때, 이 스텁이 평문을 그대로 두지 않고 변환하므로 "평문 미저장"을 의미있게 검증한다.
 */
export interface SafeStorageStub {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(encrypted: Buffer): string
}

let available = true

export function __setAvailable(v: boolean): void {
  available = v
}

export const safeStorageStub: SafeStorageStub = {
  isEncryptionAvailable(): boolean {
    return available
  },
  encryptString(plain: string): Buffer {
    // "암호문" 모사 — 평문이 그대로 남지 않도록 변환(접두사 + base64).
    return Buffer.from(`ENC:${Buffer.from(plain, 'utf8').toString('base64')}`, 'utf8')
  },
  decryptString(encrypted: Buffer): string {
    const s = encrypted.toString('utf8')
    if (!s.startsWith('ENC:')) throw new Error('복호화 실패(잘못된 암호문)')
    return Buffer.from(s.slice(4), 'base64').toString('utf8')
  }
}
