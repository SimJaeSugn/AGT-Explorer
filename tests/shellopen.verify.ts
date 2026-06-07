/* shell:open 보안 검증(경로 정규화·상위이탈 차단) 하니스. Main paths 로직 검증. */
import { normalizePath } from '../src/main/fs/paths'

let pass = 0
let fail = 0
function ok(label: string, cond: boolean): void {
  if (cond) pass++
  else {
    fail++
    console.log('FAIL', label)
  }
}

// (a) 정규화: 정상 절대경로는 통과.
ok('절대경로 통과', normalizePath('C:\\Users\\me\\report.png').ok)
ok('드라이브 루트 통과', normalizePath('C:\\').ok)
ok('UNC 통과', normalizePath('\\\\server\\share\\f.txt').ok)
ok('롱패스 통과', normalizePath('\\\\?\\C:\\a\\b.txt').ok)

// (a) 상위이탈(..)은 정규화 후 흡수되거나 차단.
const up = normalizePath('C:\\a\\..\\b')
ok('C:\\a\\..\\b 흡수되어 C:\\b', up.ok && up.path === 'C:\\b')
ok('상위 이탈 차단 ..\\..\\..\\Windows', !normalizePath('..\\..\\..\\Windows\\System32').ok)
ok('상대경로 차단', !normalizePath('relative\\path').ok)
ok('빈 경로 차단', !normalizePath('   ').ok)
// 드라이브 루트의 ..는 루트에서 클램프되어 드라이브를 벗어나지 못함(C:\secret).
// → 정규화는 통과하지만 존재(b)/권한(c) 단계에서 차단된다. 드라이브 이탈 불가 자체가 안전.
const drvUp = normalizePath('C:\\..\\..\\secret')
ok('드라이브 위 ..는 루트 클램프(C:\\secret)', drvUp.ok && drvUp.path === 'C:\\secret')
// 정규화로도 해소되지 않는 선행 상위 이탈은 차단.
ok('선행 .. 잔여 차단', !normalizePath('..\\sensitive').ok)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
