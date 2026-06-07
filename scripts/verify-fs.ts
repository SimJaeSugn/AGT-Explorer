/**
 * P1 FS 읽기 계층 실증 스크립트(일회성 검증).
 * - 실제 디렉토리(프로젝트 루트·C:\) 목록·드라이브를 조회해 결과를 출력한다.
 * - 미존재/상위이탈/상대경로가 throw 가 아닌 FileOpError 로 전파되는지 확인한다.
 * - 스트리밍(start→chunk→done)·취소 동작을 확인한다.
 *
 * 실행: esbuild 로 번들 후 node 로 실행(@shared 별칭 해소 위함).
 */
import { fileSystemService } from '../src/main/fs/FileSystemService'
import { normalizePath } from '../src/main/fs/paths'

const ROOT = process.cwd()

function line(s: string): void {
  // eslint-disable-next-line no-console
  console.log(s)
}

async function main(): Promise<void> {
  let pass = 0
  let fail = 0
  const check = (name: string, cond: boolean): void => {
    if (cond) {
      pass++
      line(`  PASS  ${name}`)
    } else {
      fail++
      line(`  FAIL  ${name}`)
    }
  }

  line('== 1) fs:list 실제 디렉토리 ==')
  const listRes = await fileSystemService.list(ROOT, false)
  check('list(root).ok', listRes.ok)
  if (listRes.ok) {
    line(`  entries=${listRes.value.entries.length} truncated=${listRes.value.truncated}`)
    const sample = listRes.value.entries.slice(0, 3)
    for (const e of sample) {
      line(`   - ${e.isDir ? 'D' : 'F'} ${e.name} ext=${e.ext} size=${e.size} mtime=${e.mtime} hidden=${e.attrs.hidden}`)
    }
    check('entries 비어있지 않음', listRes.value.entries.length > 0)
    check('각 entry path 절대경로', listRes.value.entries.every((e) => e.path.includes(ROOT)))
    check('각 entry mtime number', listRes.value.entries.every((e) => typeof e.mtime === 'number'))
  }

  line('== 2) fs:stat ==')
  const statRes = await fileSystemService.stat(ROOT)
  check('stat(root).ok && isDir', statRes.ok && statRes.value.isDir)

  line('== 3) fs:drives (Windows) ==')
  const drivesRes = await fileSystemService.drives()
  check('drives().ok', drivesRes.ok)
  if (drivesRes.ok) {
    line(`  drives=${drivesRes.value.map((d) => d.path).join(', ')}`)
    for (const d of drivesRes.value) {
      line(`   - ${d.path} kind=${d.kind} total=${d.totalBytes} free=${d.freeBytes} ready=${d.ready}`)
    }
    check('C:\\ 포함', drivesRes.value.some((d) => d.path === 'C:\\'))
  }

  line('== 4) fs:validate-path ==')
  const vOk = await fileSystemService.validatePath(ROOT)
  check('validate(root) exists&isDir', vOk.ok && vOk.value.exists && vOk.value.isDir)
  const vMissing = await fileSystemService.validatePath('C:\\__no_such_dir_zzz__')
  check('validate(missing) exists=false (throw 아님)', vMissing.ok && !vMissing.value.exists)

  line('== 5) 오류 1급 전파 (throw 금지) ==')
  let threw = false
  let missingRes
  try {
    missingRes = await fileSystemService.list('C:\\__no_such_dir_zzz__', false)
  } catch {
    threw = true
  }
  check('list(missing) throw 안 함', !threw)
  check('list(missing) Result.err(ENOENT)', !!missingRes && !missingRes.ok && missingRes.error.code === 'ENOENT')
  if (missingRes && !missingRes.ok) line(`  -> code=${missingRes.error.code} msg=${missingRes.error.message}`)

  line('== 6) guard 경로 정규화/이탈 차단 ==')
  // win32 는 드라이브 루트 위 `..` 를 루트로 클램프하므로 절대경로는 이탈 불가.
  const clamped = normalizePath('C:\\Users\\..\\..\\..\\Windows')
  check('절대경로 .. 는 루트로 클램프(C:\\Windows)', clamped.ok && clamped.path === 'C:\\Windows')
  line(`  normalizePath(clamped) -> ok=${clamped.ok} path=${clamped.path}`)
  // 상대 `..` 이탈은 절대경로가 아니므로 차단.
  const relEscape = normalizePath('..\\..\\..\\Windows')
  check('상대 .. 이탈 차단', !relEscape.ok)
  line(`  normalizePath(relEscape) ok=${relEscape.ok} reason=${relEscape.reason ?? '-'}`)
  const rel = normalizePath('some\\relative\\path')
  check('상대경로 차단', !rel.ok)
  const good = normalizePath('C:\\Users\\me\\..\\me\\docs')
  check('정상 정규화', good.ok && good.path === 'C:\\Users\\me\\docs')
  line(`  normalizePath(good) -> ${good.path}`)

  line('== 7) 스트리밍 start→chunk→done ==')
  await new Promise<void>((resolve) => {
    let chunks = 0
    let totalEntries = 0
    let done = false
    const streamId = fileSystemService.startListStream(ROOT, false, 2, {
      onChunk: (entries) => {
        chunks++
        totalEntries += entries.length
      },
      onDone: (total, truncated) => {
        done = true
        check('stream done 도착', true)
        check('stream total>0', total > 0)
        check('chunk 누적 == done total', totalEntries === total)
        line(`  streamId=${streamId.slice(0, 8)} chunks=${chunks} total=${total} truncated=${truncated}`)
        resolve()
      },
      onError: () => {
        check('stream error 없음', false)
        resolve()
      }
    })
    setTimeout(() => {
      if (!done) {
        check('stream done 타임아웃 전 완료', false)
        resolve()
      }
    }, 8000)
  })

  line('== 8) 스트리밍 취소 후 무유입 ==')
  await new Promise<void>((resolve) => {
    let afterCancelChunks = 0
    let canceled = false
    const streamId = fileSystemService.startListStream(ROOT, false, 1, {
      onChunk: () => {
        if (canceled) afterCancelChunks++
        if (!canceled) {
          canceled = true
          fileSystemService.cancelStream(streamId)
        }
      },
      onDone: () => {
        check('취소 후 done 미발생', false)
        resolve()
      },
      onError: () => resolve()
    })
    setTimeout(() => {
      check('취소 후 추가 청크 없음(또는 즉시 중단)', afterCancelChunks === 0)
      line(`  afterCancelChunks=${afterCancelChunks}`)
      resolve()
    }, 1500)
  })

  line('')
  line(`RESULT: ${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

void main()
