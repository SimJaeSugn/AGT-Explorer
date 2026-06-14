/**
 * verify:eslint-agent (§Z Z0) — agent/ LLM SDK·네트워크 import 격리 실증(verify-eslint-remote 동형).
 *
 * ADR-015 결정 G8(`src/main/agent/` 만 SDK·DNS import 허용)을 정적 구조 단언 + ESLint
 * lintText 행동 검증으로 증명한다:
 *
 *  (A) 정적 구조(.eslintrc.cjs 직접 require):
 *      1) main 광역 override(src/main/**)의 no-restricted-imports paths 에
 *         @anthropic-ai/sdk·openai·dns·node:dns 차단 추가(기존 remote 차단 유지).
 *      2) src/main/agent/** 예외 override 존재 + 네트워크/SDK paths 비움(allow).
 *
 *  (B) 행동 검증(ESLint lintText):
 *      3) agent/ 밖(src/main/foo.ts)에서 @anthropic-ai/sdk·openai·node:dns import → lint 에러.
 *      4) agent/ 안(src/main/agent/foo.ts)에서 동일 import → 에러 0(allow).
 *      5) agent/ 안에서도 renderer import 는 여전히 에러(역방향 의존 차단 유지).
 *      6) renderer 에서 openai import → 에러(불변).
 *
 * 실행: esbuild 번들(eslint·node external) 후 node. (verify-eslint-remote 패턴)
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
  // ── (A) 정적 구조 ──────────────────────────────────────────────────────
  line('== (A) .eslintrc.cjs 정적 구조 ==')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cfg = require_(resolve(PROJECT_ROOT, '.eslintrc.cjs')) as { overrides: any[] }
  check('.eslintrc.cjs overrides 배열 존재', Array.isArray(cfg.overrides))

  const mainBlock = cfg.overrides.find((o) => Array.isArray(o.files) && o.files.includes('src/main/**/*.ts'))
  const agentBlock = cfg.overrides.find((o) => Array.isArray(o.files) && o.files.includes('src/main/agent/**/*.ts'))
  check('main 광역 override 존재', !!mainBlock)
  check('agent 예외 override(src/main/agent/**/*.ts) 존재', !!agentBlock)

  const mainBlocked = blockedPathNames(mainBlock?.rules?.['no-restricted-imports'])
  const AGENT_LIBS = ['@anthropic-ai/sdk', 'openai', 'dns', 'node:dns']
  for (const n of AGENT_LIBS) {
    check(`신규 차단: main 차단에 '${n}' 존재`, mainBlocked.has(n))
  }
  // 회귀 가드: 기존 remote 차단(node:tls 등)도 유지.
  check("회귀 가드: main 차단에 'node:tls' 유지", mainBlocked.has('node:tls'))

  const agentBlocked = blockedPathNames(agentBlock?.rules?.['no-restricted-imports'])
  check('agent 예외: SDK/DNS paths 비움(allow)', AGENT_LIBS.every((n) => !agentBlocked.has(n)))
  const agentPatterns = (() => {
    const r = agentBlock?.rules?.['no-restricted-imports']
    if (!Array.isArray(r)) return [] as unknown[]
    const opts = r[1] as { patterns?: unknown[] } | undefined
    return Array.isArray(opts?.patterns) ? opts!.patterns! : []
  })()
  check('agent 예외: renderer 금지 patterns 유지(역방향 의존 차단)', agentPatterns.length > 0)

  // ── (B) ESLint lintText 행동 검증 ─────────────────────────────────────
  line('== (B) ESLint lintText 행동 검증 ==')
  const eslint = new ESLint({ cwd: PROJECT_ROOT, errorOnUnmatchedPattern: false })

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

  // 3) agent/ 밖에서 SDK·DNS import → 에러.
  for (const lib of AGENT_LIBS) {
    const errs = await restrictedErrorsAt('src/main/__probe__.ts', `import * as x from '${lib}'\nvoid x\n`)
    check(`agent/ 밖: import '${lib}' → no-restricted-imports 에러(${errs})`, errs >= 1)
  }

  // 4) agent/ 안에서 동일 import → 에러 0(allow).
  for (const lib of AGENT_LIBS) {
    const errs = await restrictedErrorsAt('src/main/agent/__probe__.ts', `import * as x from '${lib}'\nvoid x\n`)
    check(`agent/ 안: import '${lib}' → 에러 0(allow)(${errs})`, errs === 0)
  }

  // 5) agent/ 안에서도 renderer import 는 에러.
  {
    const errs = await restrictedErrorsAt('src/main/agent/__probe__.ts', `import * as x from '../../renderer/app/foo'\nvoid x\n`)
    check(`agent/ 안: renderer import → 에러 유지(${errs})`, errs >= 1)
  }

  // 6) renderer 에서 node:dns import → 에러(불변·renderer 는 node:* 전면 금지).
  //    (bare 'openai' 패키지는 renderer 차단 목록 밖이라 main 광역+agent-only allow 가 격리 핵심.)
  {
    const errs = await restrictedErrorsAt('src/renderer/__probe__.ts', `import * as x from 'node:dns'\nvoid x\n`)
    check(`renderer: import 'node:dns' → 에러 유지(${errs})`, errs >= 1)
  }

  line('')
  line(`RESULT: ${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

void main()
