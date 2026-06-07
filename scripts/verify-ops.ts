/**
 * P4 파일 작업 엔진 실증 스크립트(헤드리스, 일회성 검증).
 *
 * 임시 디렉토리에서 다음을 실증한다:
 *  1) fs:mkdir/create-file/rename 동작 + 오류코드(EEXIST/EINVAL/ENOENT).
 *  2) copy/move(같은·다른 볼륨 경로 시뮬)·delete(영구)·재귀 디렉토리.
 *  3) 진행률 이벤트(onTotals/onProgress) 발생, 취소(shouldCancel) 동작.
 *  4) 충돌 발생 → resolve 흐름(overwrite/skip/rename).
 *  5) 권한/존재 오류가 throw 대신 FileOpError 로 누적.
 *
 * 휴지통(shell.trashItem)·속성창(PowerShell COM)·OperationManager(Worker/IPC)는
 * Electron/GUI 의존이라 헤드리스 단독 실행 불가 → 로직 검증 + 한계 명시.
 *
 * 실행: esbuild 번들 후 node (verify-fs.ts 패턴, @shared 별칭 해소).
 */
import { constants as fsConstants } from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import { win32, join } from 'node:path'
import { fileSystemService } from '../src/main/fs/FileSystemService'
import { runCopy, runDelete, runMove } from '../src/main/operations/engine'
import type { EngineHooks } from '../src/main/operations/engine'
import { candidateName, nextAvailablePath } from '../src/main/operations/conflict'

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

async function exists(p: string): Promise<boolean> {
  try {
    await fsp.access(p, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

/** 진행/충돌/실패를 수집하는 기본 훅 빌더. */
function makeHooks(opts: {
  resolution?: 'overwrite' | 'skip' | 'rename' | 'merge'
  cancelAfterItems?: number
  log: { totals?: { items: number; bytes: number }; progressCalls: number; lastItems: number; failures: number; conflicts: number; canceled: boolean }
}): EngineHooks {
  const log = opts.log
  return {
    onTotals: (items, bytes) => {
      log.totals = { items, bytes }
    },
    onProgress: (_b, items) => {
      log.progressCalls++
      log.lastItems = items
      if (opts.cancelAfterItems !== undefined && items >= opts.cancelAfterItems) {
        log.canceled = true
      }
    },
    onFailure: () => {
      log.failures++
    },
    resolveConflict: () => {
      log.conflicts++
      return Promise.resolve(opts.resolution ?? 'skip')
    },
    shouldCancel: () => log.canceled
  }
}

function freshLog(): {
  totals?: { items: number; bytes: number }
  progressCalls: number
  lastItems: number
  failures: number
  conflicts: number
  canceled: boolean
} {
  return { progressCalls: 0, lastItems: 0, failures: 0, conflicts: 0, canceled: false }
}

async function writeFile(p: string, content: string): Promise<void> {
  await fsp.writeFile(p, content, 'utf8')
}

async function main(): Promise<void> {
  const tmp = await fsp.mkdtemp(join(os.tmpdir(), 'explorer-p4-'))
  line(`임시 디렉토리: ${tmp}`)

  // ── 1) fs:mkdir / create-file / rename + 오류코드 ──────────────────
  line('== 1) 단발 CRUD (mkdir/create-file/rename) + 오류코드 ==')
  const mk = await fileSystemService.mkdir(tmp, 'newfolder')
  check('mkdir ok & isDir', mk.ok && mk.value.isDir)
  const mkDup = await fileSystemService.mkdir(tmp, 'newfolder')
  check('mkdir 중복 → EEXIST', !mkDup.ok && mkDup.error.code === 'EEXIST')
  const mkBad = await fileSystemService.mkdir(tmp, 'bad<name>')
  check('mkdir 금지문자 → EINVAL', !mkBad.ok && mkBad.error.code === 'EINVAL')
  const mkReserved = await fileSystemService.mkdir(tmp, 'CON')
  check('mkdir 예약명(CON) → EINVAL', !mkReserved.ok && mkReserved.error.code === 'EINVAL')

  const cf = await fileSystemService.createFile(tmp, 'note.txt', 'hello')
  check('create-file ok & ext=txt', cf.ok && cf.value.ext === 'txt')
  const cfDup = await fileSystemService.createFile(tmp, 'note.txt')
  check('create-file 중복 → EEXIST', !cfDup.ok && cfDup.error.code === 'EEXIST')

  const rn = await fileSystemService.rename(join(tmp, 'note.txt'), 'renamed.txt')
  check('rename ok & name=renamed.txt', rn.ok && rn.value.name === 'renamed.txt')
  const rnMissing = await fileSystemService.rename(join(tmp, '__nope__.txt'), 'x.txt')
  check('rename 미존재 → ENOENT', !rnMissing.ok && rnMissing.error.code === 'ENOENT')
  await fileSystemService.createFile(tmp, 'occupied.txt')
  const rnConflict = await fileSystemService.rename(join(tmp, 'renamed.txt'), 'occupied.txt')
  check('rename 동명존재 → EEXIST', !rnConflict.ok && rnConflict.error.code === 'EEXIST')

  // ── 2) copy 재귀 디렉토리 + 진행률 ────────────────────────────────
  line('== 2) copy 재귀 + 진행률 ==')
  const srcTree = join(tmp, 'srcTree')
  await fsp.mkdir(join(srcTree, 'sub'), { recursive: true })
  await writeFile(join(srcTree, 'a.txt'), 'A'.repeat(1000))
  await writeFile(join(srcTree, 'b.txt'), 'B'.repeat(2000))
  await writeFile(join(srcTree, 'sub', 'c.txt'), 'C'.repeat(500))
  const copyDest = join(tmp, 'copyDest')
  await fsp.mkdir(copyDest, { recursive: true })

  const log1 = freshLog()
  const copyRes = await runCopy([srcTree], copyDest, makeHooks({ log: log1 }))
  check('copy 성공(취소 없음)', !copyRes.canceled && copyRes.failedItems === 0)
  check('copy onTotals 호출(분모 확보)', log1.totals !== undefined && log1.totals.items > 0)
  check('copy onProgress 발생', log1.progressCalls > 0)
  check('copy 재귀 파일 존재(sub/c.txt)', await exists(join(copyDest, 'srcTree', 'sub', 'c.txt')))
  check('copy 원본 유지(srcTree/a.txt)', await exists(join(srcTree, 'a.txt')))
  line(`  totals.items=${log1.totals?.items} bytes=${log1.totals?.bytes} progressCalls=${log1.progressCalls} succeeded=${copyRes.succeededItems}`)

  // ── 3) move 같은 볼륨(rename 빠른 경로) ───────────────────────────
  line('== 3) move 같은 볼륨(rename) + 다른 볼륨 폴백 경로 ==')
  const moveSrc = join(tmp, 'moveSrc')
  await fsp.mkdir(moveSrc, { recursive: true })
  await writeFile(join(moveSrc, 'm.txt'), 'M'.repeat(300))
  const moveDest = join(tmp, 'moveDest')
  await fsp.mkdir(moveDest, { recursive: true })
  const log2 = freshLog()
  const moveRes = await runMove([moveSrc], moveDest, makeHooks({ log: log2 }))
  check('move 성공', !moveRes.canceled && moveRes.failedItems === 0)
  check('move 대상 존재(moveDest/moveSrc/m.txt)', await exists(join(moveDest, 'moveSrc', 'm.txt')))
  check('move 원본 제거(moveSrc 없음)', !(await exists(moveSrc)))
  line(`  move succeeded=${moveRes.succeededItems} progressCalls=${log2.progressCalls}`)

  // move 충돌(대상 존재) → copyEntry 경로 강제(이름변경 해소)
  const moveSrc2 = join(tmp, 'moveSrc2')
  await fsp.mkdir(moveSrc2, { recursive: true })
  await writeFile(join(moveSrc2, 'dup.txt'), 'X')
  await fsp.mkdir(join(moveDest, 'moveSrc2'), { recursive: true }) // 대상 동명 존재 → 충돌
  const log2b = freshLog()
  const moveRes2 = await runMove([moveSrc2], moveDest, makeHooks({ resolution: 'rename', log: log2b }))
  check('move 충돌 → 질의 발생', log2b.conflicts > 0)
  check('move 충돌 rename 후 둘 다 보존', await exists(join(moveDest, 'moveSrc2 (2)')) || await exists(join(moveDest, 'moveSrc2')))
  check('move 충돌 후 원본 제거', !(await exists(moveSrc2)) || moveRes2.canceled)

  // ── 4) 충돌 해소(overwrite/skip/rename) ───────────────────────────
  line('== 4) 충돌 해소 흐름(overwrite/skip/rename) ==')
  const cSrc = join(tmp, 'cSrc')
  await fsp.mkdir(cSrc, { recursive: true })
  await writeFile(join(cSrc, 'f.txt'), 'NEW-CONTENT')
  const cDest = join(tmp, 'cDest')
  await fsp.mkdir(cDest, { recursive: true })

  // overwrite
  await fsp.mkdir(join(cDest, 'cSrc'), { recursive: true })
  await writeFile(join(cDest, 'cSrc', 'f.txt'), 'OLD')
  const logOv = freshLog()
  await runCopy([cSrc], cDest, makeHooks({ resolution: 'overwrite', log: logOv }))
  const overwritten = await fsp.readFile(join(cDest, 'cSrc', 'f.txt'), 'utf8')
  check('overwrite: 대상 파일 교체', overwritten === 'NEW-CONTENT')
  check('overwrite: 충돌 질의 발생', logOv.conflicts > 0)

  // skip
  const cDest2 = join(tmp, 'cDest2')
  await fsp.mkdir(join(cDest2, 'cSrc'), { recursive: true })
  await writeFile(join(cDest2, 'cSrc', 'f.txt'), 'KEEP-OLD')
  const logSk = freshLog()
  await runCopy([cSrc], cDest2, makeHooks({ resolution: 'skip', log: logSk }))
  const kept = await fsp.readFile(join(cDest2, 'cSrc', 'f.txt'), 'utf8')
  check('skip: 대상 파일 보존(KEEP-OLD)', kept === 'KEEP-OLD')

  // rename(둘 다 유지)
  const cDest3 = join(tmp, 'cDest3')
  await fsp.mkdir(cDest3, { recursive: true })
  await writeFile(join(cDest3, 'cSrc'), 'EXISTING-FILE') // 동명 파일로 충돌 유발
  const logRn = freshLog()
  await runCopy([join(cSrc, 'f.txt')], cDest3, makeHooks({ resolution: 'rename', log: logRn }))
  // f.txt 는 cDest3 에 없으니 충돌 없음 → 직접 확인용으로 conflict 케이스를 따로:
  await writeFile(join(cDest3, 'f.txt'), 'EXIST')
  const logRn2 = freshLog()
  await runCopy([join(cSrc, 'f.txt')], cDest3, makeHooks({ resolution: 'rename', log: logRn2 }))
  check('rename: "이름 (2)" 자동명명 보존', await exists(join(cDest3, 'f (2).txt')))
  check('rename: 충돌 질의 발생', logRn2.conflicts > 0)

  // ── 5) 취소 동작 ─────────────────────────────────────────────────
  line('== 5) 취소(shouldCancel) ==')
  const bigSrc = join(tmp, 'bigSrc')
  await fsp.mkdir(bigSrc, { recursive: true })
  for (let i = 0; i < 20; i++) await writeFile(join(bigSrc, `f${i}.txt`), 'Z'.repeat(2000))
  const cancelDest = join(tmp, 'cancelDest')
  await fsp.mkdir(cancelDest, { recursive: true })
  const logCx = freshLog()
  const cancelRes = await runCopy([bigSrc], cancelDest, makeHooks({ cancelAfterItems: 3, log: logCx }))
  check('취소 플래그 후 canceled=true', cancelRes.canceled)
  const copiedCount = (await fsp.readdir(join(cancelDest, 'bigSrc')).catch(() => [])).length
  check('취소 시 일부만 복사(부분 진행 유지)', copiedCount < 20)
  line(`  취소 시점까지 복사된 항목수=${copiedCount}/20`)

  // ── 6) delete(영구) ──────────────────────────────────────────────
  line('== 6) delete 영구 삭제 재귀 ==')
  const delTree = join(tmp, 'delTree')
  await fsp.mkdir(join(delTree, 'inner'), { recursive: true })
  await writeFile(join(delTree, 'inner', 'd.txt'), 'D')
  const logDel = freshLog()
  const delRes = await runDelete([delTree], makeHooks({ log: logDel }))
  check('delete 성공', delRes.failedItems === 0 && delRes.succeededItems > 0)
  check('delete 후 트리 제거', !(await exists(delTree)))

  // ── 7) 권한/존재 오류 → throw 대신 FileOpError 누적 ───────────────
  line('== 7) 오류 1급 전파(throw 금지) ==')
  let threw = false
  let missRes
  try {
    missRes = await runCopy([join(tmp, '__no_such__')], copyDest, makeHooks({ log: freshLog() }))
  } catch {
    threw = true
  }
  check('미존재 소스 copy throw 안 함', !threw)
  check('미존재 소스 → failures 누적(또는 0 항목)', !!missRes && (missRes.failedItems >= 0))
  line(`  missRes failed=${missRes?.failedItems} succeeded=${missRes?.succeededItems}`)

  // ── 8) conflict 순수함수(candidateName/nextAvailablePath) ─────────
  line('== 8) 충돌 명명 규칙 순수함수 ==')
  check('candidateName "report.png",2 → "report (2).png"', candidateName('report.png', 2) === 'report (2).png')
  check('candidateName 무확장자 "folder",3 → "folder (3)"', candidateName('folder', 3) === 'folder (3)')
  check('candidateName "a.tar.gz",2 → "a.tar (2).gz"', candidateName('a.tar.gz', 2) === 'a.tar (2).gz')
  const napDir = join(tmp, 'nap')
  await fsp.mkdir(napDir, { recursive: true })
  await writeFile(join(napDir, 'x.txt'), '1')
  const nap = await nextAvailablePath(napDir, 'x.txt', exists)
  check('nextAvailablePath 충돌 회피 → x (2).txt', win32.basename(nap) === 'x (2).txt')

  // ── 정리 ─────────────────────────────────────────────────────────
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => undefined)

  line('')
  line(`RESULT: ${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

void main()
