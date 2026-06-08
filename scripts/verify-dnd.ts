/**
 * dnd:start-drag(§M M1 — 외부 D&D 복사) 경로검증·아이콘 폴백·startDrag 위임 실증(헤드리스).
 *
 * 실제 OS 드롭·고스트 이미지는 GUI 라 헤드리스로 불가하므로(런타임 🟡 스모크 권장):
 *   - 경로 화이트리스트: 원격 prefix 거부(ESECURITY) · 미존재 거부(ENOENT) · `..` 이탈(ESECURITY)
 *       · 빈 paths(zod 상위) · 유효 로컬 경로 통과(정규화 반환).
 *   - 아이콘 폴백: getFileIcon dataUrl 유효 → 그 아이콘 / 빈·실패 → fallback(빈 이미지 금지 보장).
 *   - startDrag 위임: 유효 경로 통과 시 wc.startDrag 가 정확한 인자(files=절대경로·icon 비어있지않음)로
 *       1회 호출(스파이) · wc destroyed → started:false(미호출) · 빈 paths → EINVAL.
 *
 * electron 은 stub-electron-dnd 로 alias(nativeImage/app 제어). 실행: esbuild 번들 후 node.
 */
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import { join } from 'node:path'
import type { NativeImage, WebContents } from 'electron'
import type { Result } from '../src/shared/ipc/contracts'
import {
  resolveRepresentativeIcon,
  runStartDrag,
  validateDragPaths
} from '../src/main/ipc/dnd.handlers'
import { getFallbackDragIcon, resolveDragIcon, startExternalDrag } from '../src/main/os/dragdrop'

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

/** startDrag 스파이가 달린 페이크 WebContents. */
interface DragCall {
  files: string[]
  iconEmpty: boolean
}
function makeWc(destroyed = false): { wc: WebContents; calls: DragCall[] } {
  const calls: DragCall[] = []
  const wc = {
    isDestroyed: () => destroyed,
    startDrag(item: { file?: string; files?: string[]; icon: NativeImage }): void {
      calls.push({ files: item.files ?? (item.file ? [item.file] : []), iconEmpty: item.icon.isEmpty() })
    }
  } as unknown as WebContents
  return { wc, calls }
}

async function main(): Promise<void> {
  const base = await fsp.mkdtemp(join(os.tmpdir(), 'explorer-dnd-'))
  const fileA = join(base, 'a.txt')
  const fileB = join(base, 'b.txt')
  await fsp.writeFile(fileA, 'a', 'utf8')
  await fsp.writeFile(fileB, 'b', 'utf8')
  const missing = join(base, 'nope.txt')

  // ════ 1) validateDragPaths — 경로 화이트리스트 ════════════════════════
  const rRemoteSftp = await validateDragPaths(['sftp://host/x'])
  check('[검증] sftp:// → ESECURITY', !rRemoteSftp.ok && rRemoteSftp.error.code === 'ESECURITY')
  const rRemoteFtp = await validateDragPaths(['FTP://host/x']) // 대소문자 무시
  check('[검증] FTP:// (대문자) → ESECURITY', !rRemoteFtp.ok && rRemoteFtp.error.code === 'ESECURITY')
  const rRemoteFtps = await validateDragPaths(['ftps://host/x'])
  check('[검증] ftps:// → ESECURITY', !rRemoteFtps.ok && rRemoteFtps.error.code === 'ESECURITY')

  const rTraverse = await validateDragPaths(['..\\..\\evil.txt'])
  check('[검증] `..` 상위이탈 → ESECURITY', !rTraverse.ok && rTraverse.error.code === 'ESECURITY')

  const rMissing = await validateDragPaths([missing])
  check('[검증] 미존재 경로 → ENOENT', !rMissing.ok && rMissing.error.code === 'ENOENT')

  // 하나라도 실패하면 전체 거부(부분 시작 금지) — 유효+미존재 혼합.
  const rMixed = await validateDragPaths([fileA, missing])
  check('[검증] 유효+미존재 혼합 → 전체 거부(ENOENT)', !rMixed.ok && rMixed.error.code === 'ENOENT')

  // 유효 로컬 경로(단일/다중) → 정규화된 절대경로 반환.
  const rOkSingle = await validateDragPaths([fileA])
  check('[검증] 유효 단일 → ok·정규화 경로', rOkSingle.ok && rOkSingle.value.length === 1)
  const rOkMulti = await validateDragPaths([fileA, fileB])
  check('[검증] 유효 다중 → ok·2개 보존', rOkMulti.ok && rOkMulti.value.length === 2)

  // ════ 2) 아이콘 폴백 ══════════════════════════════════════════════════
  // getFileIcon dataUrl 유효 → 그 아이콘(비어있지 않음).
  const iconFromExtract = await resolveRepresentativeIcon([fileA], undefined, async () => 'data:image/png;base64,VALID')
  check('[아이콘] 유효 dataUrl → 비어있지 않은 아이콘', !iconFromExtract.isEmpty())

  // 추출 빈 문자열 → fallback(비어있지 않음 보장).
  const iconEmptyExtract = await resolveRepresentativeIcon([fileA], undefined, async () => '')
  check('[아이콘] 빈 dataUrl → fallback(비어있지 않음)', !iconEmptyExtract.isEmpty())

  // 추출 null → fallback.
  const iconNull = await resolveRepresentativeIcon([fileA], undefined, async () => null)
  check('[아이콘] null dataUrl → fallback(비어있지 않음)', !iconNull.isEmpty())

  // 추출 예외 → fallback(throw 흡수).
  const iconThrow = await resolveRepresentativeIcon([fileA], undefined, async () => {
    throw new Error('boom')
  })
  check('[아이콘] 추출 예외 → fallback(throw 흡수)', !iconThrow.isEmpty())

  // resolveDragIcon 직접: null·빈·잘못된 입력 모두 비어있지 않은 fallback.
  check('[아이콘] resolveDragIcon(null) → fallback', !resolveDragIcon(null).isEmpty())
  check('[아이콘] resolveDragIcon("") → fallback', !resolveDragIcon('').isEmpty())
  // 리소스 경로 누락(__MISSING__) → 내장 base64 폴백(빈 이미지 금지).
  check('[아이콘] 리소스 누락 → 내장 base64 fallback', !getFallbackDragIcon('__MISSING__dir').isEmpty())

  // ════ 3) startExternalDrag — startDrag 위임 인자 정합 ══════════════════
  const okIcon = resolveDragIcon('data:image/png;base64,VALID')

  // 유효 경로 통과 → startDrag 1회, files=절대경로, icon 비어있지 않음.
  {
    const { wc, calls } = makeWc()
    const r = startExternalDrag(wc, [fileA, fileB], okIcon)
    check('[위임] 유효 경로 → started:true', r.ok && r.value.started === true)
    check('[위임] startDrag 1회 호출', calls.length === 1)
    check('[위임] files = 절대경로 목록 정확', calls[0]?.files.join('|') === [fileA, fileB].join('|'))
    check('[위임] icon 비어있지 않음(startDrag 제약)', calls[0]?.iconEmpty === false)
  }

  // wc destroyed → started:false, startDrag 미호출.
  {
    const { wc, calls } = makeWc(true)
    const r = startExternalDrag(wc, [fileA], okIcon)
    check('[위임] wc destroyed → started:false', r.ok && r.value.started === false)
    check('[위임] wc destroyed → startDrag 미호출', calls.length === 0)
  }

  // 빈 paths → EINVAL, startDrag 미호출.
  {
    const { wc, calls } = makeWc()
    const r = startExternalDrag(wc, [], okIcon)
    check('[위임] 빈 paths → EINVAL', !r.ok && r.error.code === 'EINVAL')
    check('[위임] 빈 paths → startDrag 미호출', calls.length === 0)
  }

  // 빈 아이콘 → EUNKNOWN(startDrag 사전 차단). resolveDragIcon 은 항상 fallback 으로
  // 비어있지 않은 이미지를 주므로, 사전 차단 분기는 빈 이미지를 직접 만들어 단언한다.
  {
    const { wc, calls } = makeWc()
    // stub 의 createFromDataURL('') → isEmpty()=true 인 이미지를 fallback 없이 직접 전달.
    const emptyIcon = (await import('electron')).nativeImage.createFromDataURL('') as NativeImage
    const r = startExternalDrag(wc, [fileA], emptyIcon)
    check('[위임] 빈 아이콘 → EUNKNOWN(사전 차단)', !r.ok && r.error.code === 'EUNKNOWN')
    check('[위임] 빈 아이콘 → startDrag 미호출', calls.length === 0)
  }

  // ════ 4) runStartDrag — 핸들러 본체 통합(검증→아이콘→위임) ════════════
  {
    const { wc, calls } = makeWc()
    const r: Result<{ started: boolean }> = await runStartDrag({ paths: [fileA] }, wc)
    check('[본체] 유효 경로 → started:true', r.ok && r.value.started === true)
    check('[본체] startDrag 1회 + icon 비어있지 않음', calls.length === 1 && calls[0]?.iconEmpty === false)
  }
  {
    const { wc, calls } = makeWc()
    const r = await runStartDrag({ paths: ['sftp://h/x'] }, wc)
    check('[본체] 원격 경로 → ESECURITY·미위임', !r.ok && r.error.code === 'ESECURITY' && calls.length === 0)
  }
  {
    const { wc, calls } = makeWc()
    const r = await runStartDrag({ paths: [missing] }, wc)
    check('[본체] 미존재 경로 → ENOENT·미위임', !r.ok && r.error.code === 'ENOENT' && calls.length === 0)
  }

  await fsp.rm(base, { recursive: true, force: true }).catch(() => undefined)

  // eslint-disable-next-line no-console
  console.log('')
  // eslint-disable-next-line no-console
  console.log(`RESULT: ${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

void main()
