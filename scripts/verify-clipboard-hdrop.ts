/**
 * §M M2 CF_HDROP 양방향(MP2, PowerShell .NET 재구현) 백엔드 헤드리스 실증 — 일회성.
 *
 * 실 Windows 클립보드는 네이티브/GUI(STA OLE)라 헤드리스 불가하므로, os/shellClipboard 의
 * PowerShell 실행기(ClipboardExecFn)를 **인메모리 스텁**으로 주입(setClipboardExecFn)해
 * 핸들러 IO 경로(write/read/has·JSON 직렬화/파싱·effect 보존)를 검증한다. 스텁은 실
 * PowerShell .NET 의 계약(SetFileDropList + Preferred DropEffect + ContainsFileDropList,
 * ConvertTo-Json {paths,effect})을 그대로 모사한다.
 *
 * 추가로 DROPFILES 순수 직렬화/파싱(조립↔파싱 라운드트립·방어적 파싱 매트릭스·외부
 * 합성 CF_HDROP)을 검증한다 — 바이트 레이아웃의 진실 소스 유지.
 *
 * ※ 실 PowerShell 왕복(이 버그의 핵심)은 헤드리스가 못 잡으므로 별도 실측으로 확인
 *   (작업 보고의 "실 PowerShell 왕복 실측" 참조). 실행: esbuild 번들 후 node.
 */
import {
  buildDropfiles,
  buildPreferredDropEffect,
  hasFilesOnClipboard,
  parseDropfiles,
  parsePreferredDropEffect,
  parseReadJson,
  readFilesFromClipboard,
  setClipboardExecFn,
  writeFilesToClipboard,
  type ClipboardExecFn
} from '../src/main/os/shellClipboard'

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

/**
 * 실 PowerShell .NET Clipboard 의 계약을 모사하는 인메모리 ClipboardExecFn 스텁.
 *  - write: FileDrop 경로 + Preferred DropEffect(copy/cut) 저장.
 *  - read: 저장 경로가 있으면 ConvertTo-Json {paths,effect} 모사, 없으면 none JSON.
 *  - has: ContainsFileDropList 모사(파일 목록 존재 여부).
 *  - injectExternal: 외부 앱(탐색기)이 올린 것처럼 임의 경로/effect 주입.
 *  - clear: 비파일 클립보드(텍스트 등)로 덮인 상태 모사.
 */
function makeStub(): ClipboardExecFn & {
  injectExternal(paths: string[], effect: 'copy' | 'move'): void
  clear(): void
} {
  let state: { paths: string[]; effect: 'copy' | 'move' } | null = null
  return {
    write(paths, effect): Promise<void> {
      state = { paths: [...paths], effect: effect === 'cut' ? 'move' : 'copy' }
      return Promise.resolve()
    },
    read(): Promise<string> {
      if (!state || state.paths.length === 0) {
        return Promise.resolve('{"paths":[],"effect":"none"}')
      }
      // PowerShell ConvertTo-Json 모사(단일 항목도 배열로 — JSON.stringify 가 동일).
      return Promise.resolve(JSON.stringify({ paths: state.paths, effect: state.effect }))
    },
    has(): Promise<boolean> {
      return Promise.resolve(state !== null && state.paths.length > 0)
    },
    injectExternal(paths, effect): void {
      state = { paths: [...paths], effect }
    },
    clear(): void {
      state = null
    }
  }
}

async function main(): Promise<void> {
  // ════ 1) DROPFILES 조립→파싱 라운드트립(순수) ════
  {
    const single = ['C:\\Users\\me\\report.png']
    check('[조립] 단일 경로 라운드트립', JSON.stringify(parseDropfiles(buildDropfiles(single))) === JSON.stringify(single))

    const multi = ['C:\\a\\one.txt', 'C:\\b\\two.docx', 'D:\\사진\\세번째.jpg']
    check('[조립] 다중 경로 라운드트립', JSON.stringify(parseDropfiles(buildDropfiles(multi))) === JSON.stringify(multi))

    const uni = ['C:\\사용자\\문서\\보고서_2026.xlsx', 'C:\\emoji\\🚀_rocket.png']
    check('[조립] 유니코드 경로명 보존', JSON.stringify(parseDropfiles(buildDropfiles(uni))) === JSON.stringify(uni))

    const buf = buildDropfiles(single)
    check('[조립] pFiles=20(헤더 크기)', buf.readUInt32LE(0) === 20)
    check('[조립] fWide=1(UTF-16LE)', buf.readUInt32LE(16) === 1)
    check('[조립] 더블널 종단', buf.readUInt16LE(buf.length - 2) === 0 && buf.readUInt16LE(buf.length - 4) === 0)
  }

  // ════ 2) Preferred DropEffect 매핑·역해석(순수) ════
  {
    const copyBuf = buildPreferredDropEffect('copy')
    const cutBuf = buildPreferredDropEffect('cut')
    check('[effect] copy → DROPEFFECT_COPY(1)', copyBuf.length === 4 && copyBuf.readUInt32LE(0) === 1)
    check('[effect] cut → DROPEFFECT_MOVE(2)', cutBuf.readUInt32LE(0) === 2)
    check('[effect] parse COPY(1) → copy', parsePreferredDropEffect(copyBuf) === 'copy')
    check('[effect] parse MOVE(2) → move', parsePreferredDropEffect(cutBuf) === 'move')
    const five = Buffer.alloc(4)
    five.writeUInt32LE(5, 0)
    check('[effect] parse 5(COPY|LINK) → copy', parsePreferredDropEffect(five) === 'copy')
    check('[effect] parse null → none', parsePreferredDropEffect(null) === 'none')
    check('[effect] parse 2바이트(짧음) → none', parsePreferredDropEffect(Buffer.alloc(2)) === 'none')
  }

  // ════ 3) 방어적 파싱 매트릭스(손상/외부 불신 입력 → 빈 배열 throw 0) ════
  {
    const makeHeader = (fWide: number, pFiles = 20): Buffer => {
      const h = Buffer.alloc(20)
      h.writeUInt32LE(pFiles, 0)
      h.writeInt32LE(0, 4)
      h.writeInt32LE(0, 8)
      h.writeInt32LE(0, 12)
      h.writeInt32LE(fWide, 16)
      return h
    }
    check('[방어] null buffer → []', parseDropfiles(null).length === 0)
    check('[방어] 짧은 buffer(<20) → []', parseDropfiles(Buffer.alloc(10)).length === 0)
    check('[방어] pFiles offset 초과 → []', parseDropfiles(Buffer.concat([makeHeader(1, 9999), Buffer.from('X  ', 'utf16le')])).length === 0)
    check('[방어] pFiles < 20(헤더 침범) → []', parseDropfiles(Buffer.concat([makeHeader(1, 4), Buffer.from('X  ', 'utf16le')])).length === 0)
    check('[방어] ANSI(fWide=0) → []', parseDropfiles(Buffer.concat([makeHeader(0), Buffer.from([0x41, 0x00, 0x00])])).length === 0)
    check('[방어] 홀수 정렬 깨짐 → []', parseDropfiles(Buffer.concat([makeHeader(1), Buffer.from([0x41, 0x00, 0x00])])).length === 0)
    check('[방어] 더블널 종단 누락 → []', parseDropfiles(Buffer.concat([makeHeader(1), Buffer.from('abc', 'utf16le'), Buffer.from([0x00, 0x00])])).length === 0)
    check('[방어] 빈 리스트(즉시 종단) → []', parseDropfiles(Buffer.concat([makeHeader(1), Buffer.from([0x00, 0x00])])).length === 0)
  }

  // ════ 4) parseReadJson 방어적 파싱(PowerShell read JSON 불신 입력) ════
  {
    check('[JSON] 정상 copy', JSON.stringify(parseReadJson('{"paths":["C:\\\\a.txt"],"effect":"copy"}')) === JSON.stringify({ paths: ['C:\\a.txt'], effect: 'copy' }))
    check('[JSON] 정상 move', parseReadJson('{"paths":["C:\\\\a.txt"],"effect":"move"}').effect === 'move')
    check('[JSON] none', JSON.stringify(parseReadJson('{"paths":[],"effect":"none"}')) === JSON.stringify({ paths: [], effect: 'none' }))
    check('[JSON] BOM 선두 제거', parseReadJson('﻿{"paths":["C:\\\\a.txt"],"effect":"copy"}').paths.length === 1)
    check('[JSON] 단일 경로 문자열 → 배열 정규화', JSON.stringify(parseReadJson('{"paths":"C:\\\\a.txt","effect":"copy"}').paths) === JSON.stringify(['C:\\a.txt']))
    check('[JSON] 깨진 JSON → none', JSON.stringify(parseReadJson('not json')) === JSON.stringify({ paths: [], effect: 'none' }))
    check('[JSON] 빈 문자열 → none', parseReadJson('').effect === 'none')
    check('[JSON] 비문자열 경로 폐기', parseReadJson('{"paths":[123,"C:\\\\b.txt"],"effect":"copy"}').paths.length === 1)
    check('[JSON] 알 수 없는 effect → copy 폴백', parseReadJson('{"paths":["C:\\\\a.txt"],"effect":"weird"}').effect === 'copy')
  }

  // ════ 5) write→read 왕복(인메모리 ClipboardExecFn 스텁) effect 보존 ════
  {
    const stub = makeStub()
    setClipboardExecFn(stub)
    try {
      const paths = ['C:\\round\\copy1.txt', 'C:\\round\\copy2.png']
      await writeFilesToClipboard(paths, 'copy')
      check('[왕복] write 후 has-files = true', await hasFilesOnClipboard())
      const rc = await readFilesFromClipboard()
      check('[왕복] copy 경로 보존', JSON.stringify(rc.paths) === JSON.stringify(paths))
      check('[왕복] copy → effect=copy', rc.effect === 'copy')

      stub.clear()
      await writeFilesToClipboard(['C:\\round\\moved.bin'], 'cut')
      const rm = await readFilesFromClipboard()
      check('[왕복] cut → effect=move(이동)', rm.effect === 'move')
      check('[왕복] cut 경로 보존', JSON.stringify(rm.paths) === JSON.stringify(['C:\\round\\moved.bin']))

      // 유니코드 경로 왕복.
      stub.clear()
      const uni = ['C:\\사진\\한글.jpg', 'C:\\folder\\日本語.txt']
      await writeFilesToClipboard(uni, 'copy')
      check('[왕복] 유니코드 경로 보존', JSON.stringify((await readFilesFromClipboard()).paths) === JSON.stringify(uni))
    } finally {
      setClipboardExecFn(undefined) // 실 PowerShell 복원.
    }
  }

  // ════ 6) 비파일 클립보드 read → none ════
  {
    const stub = makeStub()
    setClipboardExecFn(stub)
    try {
      stub.clear()
      check('[비파일] has-files = false', !(await hasFilesOnClipboard()))
      const r = await readFilesFromClipboard()
      check('[비파일] read → paths 빈 배열', r.paths.length === 0)
      check('[비파일] read → effect=none', r.effect === 'none')
    } finally {
      setClipboardExecFn(undefined)
    }
  }

  // ════ 7) 외부(탐색기) 합성 CF_HDROP 파싱(순수) + 외부 주입 read 존중 ════
  {
    // 7-a) 순수 DROPFILES 파싱(외부 표준 wide 버퍼).
    const synthHdrop = (paths: string[]): Buffer => {
      const NUL = Buffer.from([0x00, 0x00])
      const h = Buffer.alloc(20)
      h.writeUInt32LE(20, 0)
      h.writeInt32LE(1, 16)
      const parts: Buffer[] = []
      for (const p of paths) {
        parts.push(Buffer.from(p, 'utf16le'))
        parts.push(NUL)
      }
      parts.push(NUL)
      return Buffer.concat([h, ...parts])
    }
    const ext = ['C:\\탐색기\\외부복사.txt', 'C:\\탐색기\\sub\\nested.log']
    check('[외부] 합성 CF_HDROP 경로 파싱', JSON.stringify(parseDropfiles(synthHdrop(ext))) === JSON.stringify(ext))

    // 7-b) 외부 앱이 올린 것처럼 주입한 클립보드 read(effect 존중).
    const stub = makeStub()
    setClipboardExecFn(stub)
    try {
      stub.injectExternal(ext, 'move')
      const r = await readFilesFromClipboard()
      check('[외부] 주입 경로 read', JSON.stringify(r.paths) === JSON.stringify(ext))
      check('[외부] DropEffect=Move 존중 → move', r.effect === 'move')

      stub.injectExternal(['C:\\noeffect\\a.dat'], 'copy')
      check('[외부] copy 효과 → copy', (await readFilesFromClipboard()).effect === 'copy')
    } finally {
      setClipboardExecFn(undefined)
    }
  }

  // eslint-disable-next-line no-console
  console.log('')
  // eslint-disable-next-line no-console
  console.log(`RESULT: ${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

void main()
