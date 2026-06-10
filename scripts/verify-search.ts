/**
 * M8 S1 내용 검색(grep) 엔진 실증 스크립트(헤드리스, 일회성 검증 — ADR-010).
 *
 * 환경 비의존 순수 엔진(grepEngine·binaryDetect)을 메인 스레드에서 직접 호출(워커 없이)
 * 하여 검증한다. fs 결합은 메모리 스텁 deps(파일 내용을 Map 으로) 로 주입한다.
 *
 *   binaryDetect : 확장자 1차 필터(exe/png/pdf/zip vs txt/ts/md)·NUL 휴리스틱·비텍스트 비율·BOM
 *   grepFile     : 스트리밍 라인 분할·리터럴/정규식 매치 ranges·다중 일치·CRLF·라인 길이 상한·perFileCap
 *   regex        : 컴파일 실패 안전(null)·zero-width 무한루프 차단
 *   runGrep      : 재귀 on/off·바이너리 스킵·크기 상한 스킵·숨김 토글·총 결과 상한 truncated·취소·순환차단
 *
 * 실행: esbuild 번들(--external:electron) 후 node.
 */
import {
  compileMatcher,
  grepFile,
  literalMatcher,
  regexMatcher,
  runGrep,
  GREP_MAX_LINE_LEN
} from '../src/main/search/grepEngine'
import type {
  GrepDirent,
  GrepEngineDeps,
  GrepFileReader,
  GrepHooks,
  GrepLineHit,
  LineMatcher
} from '../src/main/search/grepEngine'
import {
  isBinaryByExt,
  isBinaryBySample,
  BINARY_NONTEXT_RATIO
} from '../src/main/search/binaryDetect'

function out(s: string): void {
  // eslint-disable-next-line no-console
  console.log(s)
}
let pass = 0
let fail = 0
function check(name: string, cond: boolean): void {
  if (cond) {
    pass++
    out(`  PASS  ${name}`)
  } else {
    fail++
    out(`  FAIL  ${name}`)
  }
}

const enc = new TextEncoder()

const noMatch: GrepHooks = {
  onProgress: () => undefined,
  onMatch: () => undefined,
  shouldCancel: () => false
}

/** 문자열 → 청크 read 리더(chunkSize 로 분할 — 라인 경계가 청크를 가로지르는 경우 검증). */
function stringReader(content: Uint8Array, chunkSize: number): GrepFileReader {
  let pos = 0
  return {
    async read(buf: Uint8Array): Promise<number> {
      if (pos >= content.length) return 0
      const n = Math.min(buf.length, chunkSize, content.length - pos)
      buf.set(content.subarray(pos, pos + n), 0)
      pos += n
      return n
    },
    async close(): Promise<void> {
      /* noop */
    }
  }
}

async function collect(
  text: string,
  matcher: LineMatcher,
  chunkSize = 64 * 1024,
  perFileCap = 1000,
  hooks: GrepHooks = noMatch
): Promise<{ lines: GrepLineHit[]; truncated: boolean }> {
  const reader = stringReader(enc.encode(text), chunkSize)
  return grepFile(reader, matcher, perFileCap, hooks)
}

// ── 메모리 fs deps (runGrep 통합) ─────────────────────────────────────────
interface MemFile {
  content: Uint8Array
}
interface MemTree {
  /** dir path → 직속 GrepDirent[]. */
  dirs: Record<string, GrepDirent[]>
  files: Map<string, MemFile>
  /** realpath 매핑(순환 재현 — 미지정 시 자기 자신). */
  real?: Record<string, string>
}

function memDeps(tree: MemTree): GrepEngineDeps {
  return {
    async readDir(dir: string): Promise<GrepDirent[]> {
      const d = tree.dirs[dir]
      if (!d) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      return d
    },
    async openReader(path: string): Promise<GrepFileReader> {
      const f = tree.files.get(path)
      if (!f) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      return stringReader(f.content, 64 * 1024)
    },
    async realpath(dir: string): Promise<string> {
      return tree.real?.[dir] ?? dir
    }
  }
}

function fileEnt(path: string, name: string, size: number, hidden = false): GrepDirent {
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : ''
  return { name, path, isDir: false, isFile: true, isSymlink: false, size, hidden, ext }
}
function dirEnt(path: string, name: string, hidden = false): GrepDirent {
  return { name, path, isDir: true, isFile: false, isSymlink: false, size: 0, hidden, ext: '' }
}
function linkEnt(path: string, name: string): GrepDirent {
  return { name, path, isDir: false, isFile: false, isSymlink: true, size: 0, hidden: false, ext: '' }
}

async function main(): Promise<void> {
  // ════ 1) binaryDetect ════════════════════════════════════════════════
  out('== 1) binaryDetect ==')
  check('확장자: exe=바이너리', isBinaryByExt('exe'))
  check('확장자: png=바이너리', isBinaryByExt('png'))
  check('확장자: zip=바이너리', isBinaryByExt('zip'))
  check('확장자: pdf=바이너리(BINARY_EXTS)', isBinaryByExt('pdf'))
  check('확장자: mp4=바이너리(video 카테고리)', isBinaryByExt('mp4'))
  check('확장자: .DLL 대소문자·선행점 정규화', isBinaryByExt('.DLL'))
  check('확장자: txt=텍스트(non-binary)', !isBinaryByExt('txt'))
  check('확장자: ts=텍스트', !isBinaryByExt('ts'))
  check('확장자: md=텍스트', !isBinaryByExt('md'))
  check('확장자: 빈 확장자=텍스트(non-binary)', !isBinaryByExt(''))

  // NUL 휴리스틱.
  const withNul = new Uint8Array([0x61, 0x62, 0x00, 0x63])
  check('샘플: NUL 포함=바이너리', isBinaryBySample(withNul))
  const pureText = enc.encode('hello\nworld\tindent\r\n안녕하세요 utf8')
  check('샘플: 순수 텍스트(UTF-8 멀티바이트 포함)=텍스트', !isBinaryBySample(pureText))
  // 비텍스트 비율 초과(제어문자 다수).
  const ctrlHeavy = new Uint8Array(20).fill(0x01)
  check('샘플: 제어문자 비율 초과=바이너리', isBinaryBySample(ctrlHeavy))
  // BOM 은 텍스트 신호.
  const bomText = new Uint8Array([0xef, 0xbb, 0xbf, 0x61, 0x62, 0x63])
  check('샘플: UTF-8 BOM+텍스트=텍스트', !isBinaryBySample(bomText))
  check('샘플: 빈 버퍼=텍스트', !isBinaryBySample(new Uint8Array(0)))
  // 임계 경계 — 허용 제어문자(TAB/LF/CR)는 비텍스트 카운트 제외.
  const tabsOnly = enc.encode('a\tb\tc\td\n'.repeat(5))
  check('샘플: TAB/LF 다수=텍스트(허용 제어문자)', !isBinaryBySample(tabsOnly))
  check('상수: 비텍스트 임계 0<r<1', BINARY_NONTEXT_RATIO > 0 && BINARY_NONTEXT_RATIO < 1)

  // ════ 2) grepFile — 스트리밍 라인 분할 + ranges ════════════════════════
  out('== 2) grepFile 라인 스캔 ==')
  const lit = literalMatcher('foo')
  const r1 = await collect('foo bar\nbaz\nfoo foo\nqux', lit)
  check('리터럴: 일치 줄 2개(line1·line3)', r1.lines.length === 2)
  check('리터럴: line1 번호=1', r1.lines[0]?.lineNo === 1)
  check('리터럴: line3 번호=3', r1.lines[1]?.lineNo === 3)
  check('리터럴: line1 range=[0,3]', JSON.stringify(r1.lines[0]?.ranges) === JSON.stringify([[0, 3]]))
  check(
    '리터럴: line3 다중 일치 range=[0,3],[4,7]',
    JSON.stringify(r1.lines[1]?.ranges) === JSON.stringify([[0, 3], [4, 7]])
  )
  check('리터럴: 발췌 text 보존', r1.lines[1]?.text === 'foo foo')

  // 라인 경계가 청크를 가로지름(chunkSize=3) — 동일 결과여야 함.
  const r1b = await collect('foo bar\nbaz\nfoo foo\nqux', literalMatcher('foo'), 3)
  check('스트리밍: 작은 청크(3B)에서도 라인 분할 동일(2줄)', r1b.lines.length === 2)
  check('스트리밍: 작은 청크에서 다중 range 동일', JSON.stringify(r1b.lines[1]?.ranges) === JSON.stringify([[0, 3], [4, 7]]))

  // CRLF 처리 — CR 제거.
  const rcrlf = await collect('foo\r\nbar\r\nfoo\r\n', literalMatcher('foo'))
  check('CRLF: CR 제거된 발췌(text="foo")', rcrlf.lines[0]?.text === 'foo')
  check('CRLF: range 정확([0,3])', JSON.stringify(rcrlf.lines[0]?.ranges) === JSON.stringify([[0, 3]]))

  // LF 로 끝나지 않는 마지막 줄.
  const rnoeol = await collect('alpha\nfoobar', literalMatcher('foo'))
  check('마지막 줄(LF 없음) 매치(foobar line2)', rnoeol.lines.length === 1 && rnoeol.lines[0]?.lineNo === 2)

  // 라인 길이 상한 — 거대 1줄. 일치는 상한 범위 내만, 발췌도 상한까지.
  const huge = 'x'.repeat(GREP_MAX_LINE_LEN + 5000) + 'foo'
  const rhuge = await collect(huge, literalMatcher('foo'))
  // 'foo' 가 상한 밖이라 발췌 텍스트에 없으면 무일치(폭주 방지). 상한 동작 확인.
  check('라인 길이 상한: 발췌 길이 ≤ 상한', (rhuge.lines[0]?.text.length ?? 0) <= GREP_MAX_LINE_LEN)
  const inLimit = 'abc' + 'y'.repeat(GREP_MAX_LINE_LEN - 100) + '\nfoo'
  const rlimit = await collect(inLimit, literalMatcher('abc'))
  check('라인 길이 상한: 상한 내 일치는 보존', rlimit.lines.some((l) => l.lineNo === 1))

  // perFileCap — 일치 줄 상한 도달 시 truncated.
  const many = Array.from({ length: 10 }, () => 'foo').join('\n')
  const rcap = await collect(many, literalMatcher('foo'), 64 * 1024, 3)
  check('perFileCap=3: 줄 3개만', rcap.lines.length === 3)
  check('perFileCap=3: truncated=true', rcap.truncated === true)

  // ════ 3) 정규식 매처 ════════════════════════════════════════════════
  out('== 3) regex matcher ==')
  const re1 = regexMatcher('f.o')
  check('정규식 컴파일 성공', re1 !== null)
  if (re1) {
    const rr = await collect('fao\nfxo zzz fyo\nbar', re1)
    check('정규식: line1 fao 일치', rr.lines[0]?.lineNo === 1)
    check('정규식: line2 다중 일치(fxo,fyo)', rr.lines[1]?.ranges.length === 2)
  }
  // 컴파일 실패 안전(null) — 미닫힘 그룹/클래스.
  check('정규식 컴파일 실패 → null(미닫힘 그룹·throw 0)', regexMatcher('(unclosed') === null)
  check('정규식 컴파일 실패 → null(미닫힘 클래스)', regexMatcher('[a-') === null)
  check('compileMatcher(isRegex=true) 실패 → null', compileMatcher('*invalid(', true) === null)
  check('compileMatcher(isRegex=false) 리터럴 항상 성공', compileMatcher('*invalid(', false) !== null)
  // zero-width 무한루프 차단(빈 매치 정규식).
  const reZero = regexMatcher('x*')
  check('정규식 zero-width 컴파일', reZero !== null)
  if (reZero) {
    const rz = await collect('abcabc', reZero) // 'x*' 는 모든 위치서 빈 매치 가능.
    check('정규식 zero-width: 무한루프 없이 종료', Array.isArray(rz.lines))
  }

  // ════ 4) runGrep — 디렉토리 순회 통합 ══════════════════════════════════
  out('== 4) runGrep 디렉토리 순회 ==')
  // 트리: /root { a.txt("foo"), sub/{ b.txt("foo foo"), pic.png(binary), big.txt(초과) }, .hidden.txt }
  const files = new Map<string, MemFile>()
  files.set('/root/a.txt', { content: enc.encode('foo here\nno match') })
  files.set('/root/sub/b.txt', { content: enc.encode('foo foo\nfoo') })
  files.set('/root/sub/pic.png', { content: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]) })
  files.set('/root/sub/big.txt', { content: enc.encode('foo in huge file') })
  files.set('/root/.hidden.txt', { content: enc.encode('foo secret') })
  const tree: MemTree = {
    dirs: {
      '/root': [
        fileEnt('/root/a.txt', 'a.txt', 18),
        dirEnt('/root/sub', 'sub'),
        fileEnt('/root/.hidden.txt', '.hidden.txt', 10, true)
      ],
      '/root/sub': [
        fileEnt('/root/sub/b.txt', 'b.txt', 11),
        fileEnt('/root/sub/pic.png', 'pic.png', 6),
        fileEnt('/root/sub/big.txt', 'big.txt', 99_999_999)
      ]
    },
    files
  }
  const deps = memDeps(tree)
  const matchedFilesList: string[] = []
  const collectHooks = (): GrepHooks => ({
    onProgress: () => undefined,
    onMatch: (file) => matchedFilesList.push(file),
    shouldCancel: () => false
  })

  // 4a) non-recursive — /root 1단계만(a.txt). sub 진입 안 함, 숨김 제외.
  matchedFilesList.length = 0
  const g1 = await runGrep(
    literalMatcher('foo'),
    { root: '/root', query: 'foo', isRegex: false, recursive: false, includeHidden: false, maxFileBytes: 10_000_000 },
    collectHooks(),
    deps
  )
  check('non-recursive: a.txt만 일치', matchedFilesList.length === 1 && matchedFilesList[0] === '/root/a.txt')
  check('non-recursive: 숨김(.hidden.txt) 제외', !matchedFilesList.includes('/root/.hidden.txt'))
  check('non-recursive: totalMatches=1', g1.totalMatches === 1)

  // 4b) recursive — sub 진입. b.txt 2줄 일치, pic.png 바이너리 스킵, big.txt 크기 초과 스킵.
  matchedFilesList.length = 0
  const g2 = await runGrep(
    literalMatcher('foo'),
    { root: '/root', query: 'foo', isRegex: false, recursive: true, includeHidden: false, maxFileBytes: 10_000_000 },
    collectHooks(),
    deps
  )
  check('recursive: a.txt + sub/b.txt 일치(2파일)', matchedFilesList.length === 2)
  check('recursive: png 바이너리 스킵', !matchedFilesList.includes('/root/sub/pic.png'))
  check('recursive: big.txt 크기 상한 스킵', !matchedFilesList.includes('/root/sub/big.txt'))
  check('recursive: matchedFiles=2', g2.matchedFiles === 2)
  check('recursive: totalMatches=3(a:1 + b:2)', g2.totalMatches === 3)

  // 4c) includeHidden=true — .hidden.txt 포함.
  matchedFilesList.length = 0
  await runGrep(
    literalMatcher('foo'),
    { root: '/root', query: 'foo', isRegex: false, recursive: true, includeHidden: true, maxFileBytes: 10_000_000 },
    collectHooks(),
    deps
  )
  check('includeHidden: .hidden.txt 포함', matchedFilesList.includes('/root/.hidden.txt'))

  // 4d) 총 결과 상한 truncated — totalCap=2.
  const g4 = await runGrep(
    literalMatcher('foo'),
    {
      root: '/root',
      query: 'foo',
      isRegex: false,
      recursive: true,
      includeHidden: false,
      maxFileBytes: 10_000_000,
      totalCap: 2
    },
    collectHooks(),
    deps
  )
  check('총 상한: totalCap=2 도달 시 truncated', g4.truncated === true)

  // 4e) 취소 — shouldCancel 즉시 true → 부분/빈 결과·throw 0.
  let cancelThrew = false
  let g5: Awaited<ReturnType<typeof runGrep>> | null = null
  try {
    g5 = await runGrep(
      literalMatcher('foo'),
      { root: '/root', query: 'foo', isRegex: false, recursive: true, includeHidden: false, maxFileBytes: 10_000_000 },
      { onProgress: () => undefined, onMatch: () => undefined, shouldCancel: () => true },
      deps
    )
  } catch {
    cancelThrew = true
  }
  check('취소: throw 0', !cancelThrew)
  check('취소: canceled=true', g5?.canceled === true)
  check('취소: 결과 없음(즉시 중단)', g5?.totalMatches === 0)

  // 4f) 순환 차단 — realpath 동일값으로 재방문 거부(무한루프 없음).
  const loopTree: MemTree = {
    dirs: {
      '/loop': [dirEnt('/loop/self', 'self')],
      '/loop/self': [dirEnt('/loop/self', 'self')] // self 가 자기 자신 가리킴(순환).
    },
    files: new Map(),
    real: { '/loop': '/real', '/loop/self': '/real' } // 둘 다 동일 realpath → 재방문 차단.
  }
  let loopThrew = false
  try {
    await runGrep(
      literalMatcher('foo'),
      { root: '/loop', query: 'foo', isRegex: false, recursive: true, includeHidden: false, maxFileBytes: 10_000_000 },
      noMatch,
      memDeps(loopTree)
    )
  } catch {
    loopThrew = true
  }
  check('순환: 무한루프 없이 throw 0 종료', !loopThrew)

  // 4g) 심볼릭 미추종 — 링크는 파일/디렉토리로 진입 안 함.
  const linkTree: MemTree = {
    dirs: { '/lk': [linkEnt('/lk/ln', 'ln'), fileEnt('/lk/real.txt', 'real.txt', 8)] },
    files: new Map([['/lk/real.txt', { content: enc.encode('foo ok') }]])
  }
  matchedFilesList.length = 0
  await runGrep(
    literalMatcher('foo'),
    { root: '/lk', query: 'foo', isRegex: false, recursive: true, includeHidden: false, maxFileBytes: 10_000_000 },
    collectHooks(),
    memDeps(linkTree)
  )
  check('심볼릭: 링크 미추종(real.txt만 일치)', matchedFilesList.length === 1 && matchedFilesList[0] === '/lk/real.txt')

  // 4h) readdir 실패 격리 — 존재하지 않는 루트 → throw 0·빈 결과.
  let missThrew = false
  let gMiss: Awaited<ReturnType<typeof runGrep>> | null = null
  try {
    gMiss = await runGrep(
      literalMatcher('foo'),
      { root: '/nope', query: 'foo', isRegex: false, recursive: false, includeHidden: false, maxFileBytes: 10_000_000 },
      noMatch,
      deps
    )
  } catch {
    missThrew = true
  }
  check('readdir 실패: throw 0', !missThrew)
  check('readdir 실패: 빈 결과', gMiss?.totalMatches === 0)

  out('')
  out(`RESULT: ${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

void main()
