/**
 * verify:credentials (§M M3 · MP4) — safeStorage 자격증명 store 헤드리스 검증.
 *
 * 실제 DPAPI·실 파일 없이(스텁 safeStorage + 인메모리 파일 IO) 다음을 단언한다:
 *   - save→load 라운드트립(복호화 일치).
 *   - **디스크 저장 객체에 평문 secret 부재**(암호문만 — CN-3·ADR-007 ③⑥).
 *   - isAvailable()=false 시 save 거부(EUNSUPPORTED·평문 폴백 금지).
 *   - delete·파일 미존재 폴백(load=null·has=false).
 *   - has(저장됨/미저장) 정확.
 *
 * 양식: 기존 verify-*(pass/fail·esbuild 번들→node). createCredentialStore 직접 호출(주입).
 */
import { createCredentialStore, type CredFileIo } from '../src/main/os/credentials'
import { safeStorageStub, __setAvailable } from './stub-safe-storage'

let pass = 0
let fail = 0
function check(name: string, cond: boolean): void {
  if (cond) {
    pass++
    // eslint-disable-next-line no-console
    console.log(`  PASS  ${name}`)
  } else {
    fail++
    // eslint-disable-next-line no-console
    console.log(`  FAIL  ${name}`)
  }
}

/** 인메모리 파일 IO(디스크 미경유). 저장된 raw 객체를 그대로 보관해 평문 검사에 노출한다. */
function makeMemIo(): { io: CredFileIo; dump(): Record<string, string> | undefined } {
  let stored: Record<string, string> | undefined
  return {
    io: {
      read: async () => (stored ? { ...stored } : undefined),
      write: async (_p, v) => {
        stored = { ...v }
        return true
      }
    },
    dump: () => stored
  }
}

const SECRET_PW = 'sup3r-s3cr3t-pa$$word'
const SECRET_KEY = '-----BEGIN OPENSSH PRIVATE KEY-----\nABCDEF\n-----END OPENSSH PRIVATE KEY-----'

async function main(): Promise<void> {
  // ════ 1) save→load 라운드트립 + 평문 미저장 ════════════════════════════
  {
    __setAvailable(true)
    const { io, dump } = makeMemIo()
    const store = createCredentialStore(safeStorageStub, '/base', io)

    check('[가용] isAvailable()=true', store.isAvailable() === true)

    const s = await store.save('profile-1', SECRET_PW)
    check('[저장] save ok', s.ok)

    const l = await store.load('profile-1')
    check('[복호화] load 값 == 원 secret', l.ok && l.value === SECRET_PW)

    // 디스크 저장 객체 직렬화에 평문 secret 부재(암호문만).
    const raw = JSON.stringify(dump() ?? {})
    check('[평문 0] 저장 JSON 에 password 평문 부재', !raw.includes(SECRET_PW))
    check('[암호문] 저장 JSON 은 비어있지 않음(암호문 보관)', raw.length > 5)
  }

  // ════ 2) privateKey 본문도 평문 미저장 ════════════════════════════════
  {
    __setAvailable(true)
    const { io, dump } = makeMemIo()
    const store = createCredentialStore(safeStorageStub, '/base', io)
    await store.save('key-profile', SECRET_KEY)
    const raw = JSON.stringify(dump() ?? {})
    check('[평문 0] privateKey 본문 평문 부재', !raw.includes('BEGIN OPENSSH PRIVATE KEY'))
    const l = await store.load('key-profile')
    check('[복호화] privateKey 라운드트립 일치', l.ok && l.value === SECRET_KEY)
  }

  // ════ 3) isAvailable=false → save 거부(EUNSUPPORTED·평문 폴백 금지) ════
  {
    __setAvailable(false)
    const { io, dump } = makeMemIo()
    const store = createCredentialStore(safeStorageStub, '/base', io)
    check('[가용] isAvailable()=false', store.isAvailable() === false)
    const s = await store.save('p', SECRET_PW)
    check('[게이트] save 거부 → EUNSUPPORTED', !s.ok && s.error.code === 'EUNSUPPORTED')
    check('[평문 0] 거부 시 디스크 미기록(평문 폴백 금지)', dump() === undefined)
    __setAvailable(true)
  }

  // ════ 4) has / delete / 미존재 폴백 ═══════════════════════════════════
  {
    __setAvailable(true)
    const { io } = makeMemIo()
    const store = createCredentialStore(safeStorageStub, '/base', io)

    const h0 = await store.has('nope')
    check('[has] 미저장 → has:false', h0.ok && h0.value.has === false)
    const l0 = await store.load('nope')
    check('[load] 미존재 → ok(null)', l0.ok && l0.value === null)

    await store.save('p2', SECRET_PW)
    const h1 = await store.has('p2')
    check('[has] 저장됨 → has:true', h1.ok && h1.value.has === true)

    const d = await store.delete('p2')
    check('[delete] ok', d.ok)
    const h2 = await store.has('p2')
    check('[delete] 삭제 후 has:false', h2.ok && h2.value.has === false)
    const l2 = await store.load('p2')
    check('[delete] 삭제 후 load:null', l2.ok && l2.value === null)
  }

  // ════ 5) Error 객체에 비밀 미수록(메시지 grep) ═══════════════════════════
  {
    __setAvailable(false)
    const { io } = makeMemIo()
    const store = createCredentialStore(safeStorageStub, '/base', io)
    const s = await store.save('p', SECRET_PW)
    const errStr = JSON.stringify(s)
    check('[비밀 0] save 거부 Error 에 secret 미수록', !errStr.includes(SECRET_PW))
    __setAvailable(true)
  }

  // eslint-disable-next-line no-console
  console.log('')
  // eslint-disable-next-line no-console
  console.log(`RESULT: ${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

void main()
