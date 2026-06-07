/**
 * P6 backend 실증 스크립트(헤드리스, 일회성 검증).
 *
 * 임시 디렉토리/파일에서 다음을 실증한다(Electron·IPC 의존 없이 서비스/Store 직접):
 *  A) FileSystemService.readPreview:
 *     - 텍스트(.txt) → kind:'text', text 내용 포함.
 *     - 대용량 텍스트(>64KB) → text + truncated=true(앞부분만).
 *     - 이미지(.png, 작은 바이트) → kind:'image', dataUrl 'data:image/png;base64,...'.
 *     - 바이너리(NUL 포함 .bin) → kind:'unsupported', reason:'바이너리'.
 *     - 디렉토리 → kind:'meta'.
 *     - 미존재 경로 → kind:'meta' + reason(throw 금지).
 *     - 무확장자 텍스트 → kind:'text'.
 *  B) WorkspaceStore: save→list→load→delete 라운드트립 + 이름 sanitize + 손상 폴백.
 *
 * 실행: esbuild 번들 후 node (verify-persistence.ts 패턴, @shared 별칭·electron external).
 */
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import { join } from 'node:path'
import type { SessionSnapshot } from '@shared/dto'
import { fileSystemService } from '../src/main/fs/FileSystemService'
import { WorkspaceStore } from '../src/main/persistence/WorkspaceStore'
import { persistencePaths } from '../src/main/persistence/paths'

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

async function main(): Promise<void> {
  const base = await fsp.mkdtemp(join(os.tmpdir(), 'explorer-p6-'))

  line('== A) FileSystemService.readPreview ==')

  // 텍스트
  const txt = join(base, 'note.txt')
  await fsp.writeFile(txt, 'hello preview\nsecond line', 'utf8')
  const rTxt = await fileSystemService.readPreview(txt)
  check('text: kind=text', rTxt.kind === 'text')
  check('text: 내용 포함', (rTxt.text ?? '').includes('hello preview'))
  check('text: ext=txt', rTxt.ext === 'txt')
  check('text: truncated 미설정', rTxt.truncated !== true)
  check('text: mtime number>0', typeof rTxt.mtime === 'number' && rTxt.mtime > 0)

  // 대용량 텍스트(>64KB)
  const big = join(base, 'big.log')
  await fsp.writeFile(big, 'A'.repeat(100 * 1024), 'utf8')
  const rBig = await fileSystemService.readPreview(big)
  check('big text: kind=text', rBig.kind === 'text')
  check('big text: truncated=true', rBig.truncated === true)
  check('big text: 앞부분만(<=64KB)', (rBig.text ?? '').length <= 64 * 1024)

  // 이미지(작은 PNG 시그니처 바이트)
  const png = join(base, 'pix.png')
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03])
  await fsp.writeFile(png, pngBytes)
  const rPng = await fileSystemService.readPreview(png)
  check('image: kind=image', rPng.kind === 'image')
  check('image: dataUrl png base64', (rPng.dataUrl ?? '').startsWith('data:image/png;base64,'))

  // 바이너리(NUL 포함, 텍스트 확장자로 위장)
  const bin = join(base, 'data.csv')
  await fsp.writeFile(bin, Buffer.from([0x41, 0x00, 0x42, 0x00, 0x43]))
  const rBin = await fileSystemService.readPreview(bin)
  check('binary: kind=unsupported', rBin.kind === 'unsupported')
  check('binary: reason=바이너리', rBin.reason === '바이너리')

  // 디렉토리
  const rDir = await fileSystemService.readPreview(base)
  check('dir: kind=meta', rDir.kind === 'meta')

  // 미존재
  const rMissing = await fileSystemService.readPreview(join(base, 'nope.txt'))
  check('missing: kind=meta(throw 없음)', rMissing.kind === 'meta')

  // 무확장자 텍스트
  const noext = join(base, 'README')
  await fsp.writeFile(noext, 'no extension text', 'utf8')
  const rNoext = await fileSystemService.readPreview(noext)
  check('noext: kind=text', rNoext.kind === 'text')

  // 미지원 형식(.pdf 메타)
  const pdf = join(base, 'doc.pdf')
  await fsp.writeFile(pdf, 'PDF', 'utf8')
  const rPdf = await fileSystemService.readPreview(pdf)
  check('unsupported ext: kind=meta', rPdf.kind === 'meta')

  line('== B) WorkspaceStore save/list/load/delete ==')
  const paths = persistencePaths(base)
  const store = new WorkspaceStore(paths, () => 10)
  const snap: SessionSnapshot = {
    version: 1,
    windows: [
      {
        tabs: [
          {
            id: 't1',
            activePanelId: 'p1',
            layout: 'grid-4',
            panels: [
              { id: 'p1', path: 'C:\\', sortKey: 'name', sortDir: 'asc', viewMode: 'details', history: { back: [], forward: [] }, scrollTop: 0 }
            ]
          }
        ],
        activeTabId: 't1'
      }
    ],
    sidebar: { favorites: ['C:\\'], recent: [], width: 240, collapsed: false },
    ui: { theme: 'system', previewOpen: true }
  }

  await store.save('My Work: Layout?', snap) // 금지문자 포함 → sanitize
  const listed = await store.list()
  check('workspace list 1건', listed.length === 1)
  check('workspace name 원본 보존', listed[0]?.name === 'My Work: Layout?')
  check('workspace savedAt number>0', typeof listed[0]?.savedAt === 'number' && (listed[0]?.savedAt ?? 0) > 0)

  const loaded = await store.load('My Work: Layout?')
  check('workspace load 성공', loaded !== undefined)
  check('workspace load grid-4 보존', loaded?.windows[0]?.tabs[0]?.layout === 'grid-4')
  check('workspace load previewOpen 보존', loaded?.ui.previewOpen === true)

  // sanitize 로 경로 이탈 시도 차단(파일이 workspacesDir 내부에만 생성)
  await store.save('..\\..\\evil', snap)
  const files = await fsp.readdir(paths.workspacesDir)
  check('이름 sanitize: 모든 파일 workspacesDir 직속', files.every((f) => f.endsWith('.json') && !f.includes('..') && !f.includes('\\') && !f.includes('/')))

  // 손상 파일 폴백
  const corrupt = join(paths.workspacesDir, 'corrupt.json')
  await fsp.writeFile(corrupt, '{ not valid json', 'utf8')
  const listAfterCorrupt = await store.list()
  check('손상 파일 건너뜀(크래시 없음)', Array.isArray(listAfterCorrupt))

  const del = await store.delete('My Work: Layout?')
  check('workspace delete 성공', del === true)
  const afterDel = await store.load('My Work: Layout?')
  check('삭제 후 load undefined', afterDel === undefined)

  await fsp.rm(base, { recursive: true, force: true }).catch(() => undefined)

  line('')
  line(`== 결과: ${pass} PASS / ${fail} FAIL ==`)
  if (fail > 0) process.exitCode = 1
}

void main()
