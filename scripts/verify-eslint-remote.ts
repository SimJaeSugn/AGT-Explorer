/**
 * MP0 ESLint 네트워크 화이트리스트 실증 스크립트(헤드리스, 일회성 검증).
 *
 * ADR-007 결정②(네트워크 화이트리스트)·M-implementation-plan MP0 ④ 검증 포인트를
 * 정적 구조 단언 + ESLint Node API(`lintText`) 행동 검증으로 증명한다:
 *
 *  (A) 정적 구조(.eslintrc.cjs 직접 require):
 *      1) main 광역 override(`src/main/**`)의 no-restricted-imports paths 에
 *         기존 8개(node:http/http·node:https/https·net/node:net·dgram/node:dgram) **유지**.
 *      2) 동일 블록에 신규 차단 `node:tls`·`ssh2`·`ssh2-sftp-client`·`basic-ftp` **추가**.
 *      3) `src/main/remote/**` 예외 override 가 존재하고 네트워크 paths 를 **비움**(allow).
 *
 *  (B) 행동 검증(ESLint lintText — 가상 파일 경로로 override 매칭):
 *      4) remote/ **밖**(src/main/foo.ts)에서 node:tls·ssh2·ssh2-sftp-client·basic-ftp·
 *         기존 8개 import → **lint 에러**.
 *      5) remote/ **안**(src/main/remote/foo.ts)에서 동일 import → **에러 0**(allow).
 *      6) remote/ **안**에서도 renderer import 는 여전히 **에러**(역방향 의존 차단 유지).
 *      7) renderer 네트워크 금지 불변(src/renderer/foo.ts 에서 node:net import → 에러).
 *
 * 실행: esbuild 번들(eslint·node 모듈 external) 후 node. (verify-persistence 패턴)
 */
import { ESLint } from 'eslint'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const require_ = createRequire(import.meta.url)

function line(s: string): void {
  // eslint-disable-next-line no-console
  console.log(s)
}
let pass = 0
let fail = 0
function check(name: string, cond: boolean): void {
  if (cond) {
    pass++
    line(`  PASS  ${name}`)
  } else {
    fail++
    line(`  FAIL  ${name}`)
  }
}

const PROJECT_ROOT = resolve(__dirname, '..')

/** no-restricted-imports 옵션에서 차단된 path name 집합을 뽑는다. */
function blockedPathNames(rule: unknown): Set<string> {
  const names = new Set<string>()
  if (!Array.isArray(rule)) return names
  const opts = rule[1]
  if (opts && typeof opts === 'object' && Array.isArray((opts as { paths?: unknown[] }).paths)) {
    for (const p of (opts as { paths: unknown[] }).paths) {
      if (p && typeof p === 'object' && typeof (p as { name?: unknown }).name === 'string') {
        names.add((p as { name: string }).name)
      }
    }
  }
  return names
}

async function main(): Promise<void> {
  // ── (A) 정적 구조 검증 ────────────────────────────────────────────────
  line('== (A) .eslintrc.cjs 정적 구조 ==')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cfg = require_(resolve(PROJECT_ROOT, '.eslintrc.cjs')) as { overrides: any[] }
  check('.eslintrc.cjs overrides 배열 존재', Array.isArray(cfg.overrides))

  const mainBlock = cfg.overrides.find(
    (o) => Array.isArray(o.files) && o.files.includes('src/main/**/*.ts')
  )
  const remoteBlock = cfg.overrides.find(
    (o) => Array.isArray(o.files) && o.files.includes('src/main/remote/**/*.ts')
  )
  check('main 광역 override(src/main/**/*.ts) 존재', !!mainBlock)
  check('remote 예외 override(src/main/remote/**/*.ts) 존재', !!remoteBlock)

  const mainBlocked = blockedPathNames(mainBlock?.rules?.['no-restricted-imports'])
  const EXISTING_8 = [
    'node:http', 'http', 'node:https', 'https', 'net', 'node:net', 'dgram', 'node:dgram'
  ]
  for (const n of EXISTING_8) {
    check(`기존 8 유지: main 차단에 '${n}' 존재`, mainBlocked.has(n))
  }
  const NEW_4 = ['node:tls', 'ssh2', 'ssh2-sftp-client', 'basic-ftp']
  for (const n of NEW_4) {
    check(`신규 차단 추가: main 차단에 '${n}' 존재`, mainBlocked.has(n))
  }

  const remoteBlocked = blockedPathNames(remoteBlock?.rules?.['no-restricted-imports'])
  check(
    'remote 예외: 네트워크 paths 비움(8+신규 모두 allow)',
    [...EXISTING_8, ...NEW_4].every((n) => !remoteBlocked.has(n))
  )
  // remote/ 안에서도 renderer 금지 patterns 는 유지되어야 한다.
  const remotePatterns = (() => {
    const r = remoteBlock?.rules?.['no-restricted-imports']
    if (!Array.isArray(r)) return [] as unknown[]
    const opts = r[1] as { patterns?: unknown[] } | undefined
    return Array.isArray(opts?.patterns) ? opts!.patterns! : []
  })()
  check('remote 예외: renderer 금지 patterns 유지(역방향 의존 차단)', remotePatterns.length > 0)

  // ── (B) ESLint 행동 검증(lintText·override 경로 매칭) ──────────────────
  line('== (B) ESLint lintText 행동 검증 ==')
  const eslint = new ESLint({ cwd: PROJECT_ROOT, errorOnUnmatchedPattern: false })

  /** 주어진 가상 파일 경로에서 소스의 no-restricted-imports 에러 개수. */
  async function restrictedErrorsAt(virtualPath: string, source: string): Promise<number> {
    const results = await eslint.lintText(source, { filePath: resolve(PROJECT_ROOT, virtualPath) })
    let n = 0
    for (const r of results) {
      for (const m of r.messages) {
        if (m.ruleId === 'no-restricted-imports') n++
      }
    }
    return n
  }

  // 4) remote/ 밖(src/main/foo.ts) 에서 원격 라이브러리·node:tls import → 에러.
  for (const lib of NEW_4) {
    const errs = await restrictedErrorsAt('src/main/__probe__.ts', `import * as x from '${lib}'\nvoid x\n`)
    check(`remote/ 밖: import '${lib}' → no-restricted-imports 에러(${errs})`, errs >= 1)
  }
  // 기존 8개도 remote/ 밖에서 여전히 에러(회귀 가드).
  {
    const errs = await restrictedErrorsAt('src/main/__probe__.ts', `import * as x from 'node:net'\nvoid x\n`)
    check(`remote/ 밖: import 'node:net'(기존8) → 에러(${errs})`, errs >= 1)
  }

  // 5) remote/ 안(src/main/remote/foo.ts) 에서 동일 import → 에러 0(allow).
  for (const lib of NEW_4) {
    const errs = await restrictedErrorsAt('src/main/remote/__probe__.ts', `import * as x from '${lib}'\nvoid x\n`)
    check(`remote/ 안: import '${lib}' → 에러 0(allow)(${errs})`, errs === 0)
  }
  {
    const errs = await restrictedErrorsAt('src/main/remote/__probe__.ts', `import * as x from 'node:net'\nvoid x\n`)
    check(`remote/ 안: import 'node:net' → 에러 0(allow)(${errs})`, errs === 0)
  }

  // 6) remote/ 안에서도 renderer import 는 여전히 에러(역방향 의존 차단 유지).
  {
    const errs = await restrictedErrorsAt(
      'src/main/remote/__probe__.ts',
      `import * as x from '../../renderer/app/foo'\nvoid x\n`
    )
    check(`remote/ 안: renderer import → 에러 유지(${errs})`, errs >= 1)
  }

  // 7) renderer 네트워크 금지 불변(node:net import → 에러).
  {
    const errs = await restrictedErrorsAt('src/renderer/__probe__.ts', `import * as x from 'node:net'\nvoid x\n`)
    check(`renderer: import 'node:net' → 에러 유지(${errs})`, errs >= 1)
  }

  line('')
  line(`RESULT: ${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

void main()
