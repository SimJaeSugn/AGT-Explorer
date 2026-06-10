/* Q1 압축 archive:// 렌더러 보조 로직 검증(임시 하니스).
 * contentsearch.verify.ts / domain.verify.ts 와 동일한 eq() 구조. esbuild 번들 가능.
 * 대상: 순수 세션/라우팅 헬퍼(archiveSession) + 압축 URI 경로 연산(paths) + transferRoute(archive). */
import {
  sessionToCloseOnLeave,
  sessionToCloseOnRemove,
  existingSessionFor,
  isZipFile,
  toExtractArgs,
  toAddTarget,
  type ArchivePanelSession
} from '../src/renderer/domain/rules/archiveSession'
import { baseName, parentOf, breadcrumbs, normalizeDisplay } from '../src/renderer/domain/paths'
import { resolveTransfer } from '../src/renderer/domain/rules/transferRoute'
import { makeArchivePath } from '../src/shared/archive/archivePath'

let pass = 0
let fail = 0
function eq(label: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got)
  const w = JSON.stringify(want)
  if (g === w) pass++
  else {
    fail++
    console.log('FAIL', label, '| got', g, '| want', w)
  }
}

const ZIP = 'C:\\d\\a.zip'
const ZIP2 = 'C:\\d\\b.zip'
function sess(map: Record<string, ArchivePanelSession>): Map<string, ArchivePanelSession> {
  return new Map(Object.entries(map))
}

// ── isZipFile ───────────────────────────────────────────────────────────────
eq('zip 소문자', isZipFile('a.zip'), true)
eq('zip 대문자', isZipFile('A.ZIP'), true)
eq('zip 혼합', isZipFile('Archive.Zip'), true)
eq('zip 아님(7z)', isZipFile('a.7z'), false)
eq('zip 아님(폴더명)', isZipFile('zipfolder'), false)
eq('zip 아님(중간)', isZipFile('a.zip.txt'), false)

// ── existingSessionFor: 같은 zip 재사용 ───────────────────────────────────────
{
  const m = sess({ p1: { sessionId: 's1', archivePath: ZIP } })
  eq('재사용 같은 zip', existingSessionFor(m, ZIP), 's1')
  eq('재사용 다른 zip 없음', existingSessionFor(m, ZIP2), null)
  eq('재사용 빈맵', existingSessionFor(new Map(), ZIP), null)
}

// ── sessionToCloseOnLeave: zip 안 이동=유지 / 벗어남=close / 공유=유지 ──────────
{
  const m = sess({ p1: { sessionId: 's1', archivePath: ZIP } })
  // 같은 zip 안 다른 inner → 유지(null)
  eq('이탈 같은 zip 폴더진입', sessionToCloseOnLeave(m, 'p1', makeArchivePath(ZIP, 'sub')), null)
  eq('이탈 같은 zip 루트', sessionToCloseOnLeave(m, 'p1', makeArchivePath(ZIP, '')), null)
  // 로컬로 벗어남 → close
  eq('이탈 로컬로 벗어남', sessionToCloseOnLeave(m, 'p1', 'C:\\d'), 's1')
  // 다른 zip 으로 → 옛 세션 close
  eq('이탈 다른 zip', sessionToCloseOnLeave(m, 'p1', makeArchivePath(ZIP2, '')), 's1')
  // 세션 없는 패널 → null
  eq('이탈 세션없음', sessionToCloseOnLeave(m, 'pX', 'C:\\d'), null)
}
{
  // 공유 세션(두 패널이 같은 sessionId) → 한쪽이 떠나도 close 안 함
  const m = sess({
    p1: { sessionId: 's1', archivePath: ZIP },
    p2: { sessionId: 's1', archivePath: ZIP }
  })
  eq('이탈 공유세션 유지', sessionToCloseOnLeave(m, 'p1', 'C:\\d'), null)
}

// ── sessionToCloseOnRemove ───────────────────────────────────────────────────
{
  const solo = sess({ p1: { sessionId: 's1', archivePath: ZIP } })
  eq('제거 단독 close', sessionToCloseOnRemove(solo, 'p1'), 's1')
  const shared = sess({
    p1: { sessionId: 's1', archivePath: ZIP },
    p2: { sessionId: 's1', archivePath: ZIP }
  })
  eq('제거 공유 유지', sessionToCloseOnRemove(shared, 'p1'), null)
  eq('제거 세션없음', sessionToCloseOnRemove(solo, 'pX'), null)
}

// ── toExtractArgs: 압축 항목 URI → {archivePath, innerPaths} ───────────────────
{
  const uris = [makeArchivePath(ZIP, 'sub/x.txt'), makeArchivePath(ZIP, 'y.txt')]
  eq('추출인자 단일 zip', toExtractArgs(uris), { archivePath: ZIP, innerPaths: ['sub/x.txt', 'y.txt'] })
  // 루트 항목(inner='') 포함
  eq('추출인자 루트포함', toExtractArgs([makeArchivePath(ZIP, '')]), {
    archivePath: ZIP,
    innerPaths: ['']
  })
  // 다른 zip 혼합 → 첫 zip 만
  const mixed = [makeArchivePath(ZIP, 'a.txt'), makeArchivePath(ZIP2, 'b.txt')]
  eq('추출인자 혼합 첫zip만', toExtractArgs(mixed), { archivePath: ZIP, innerPaths: ['a.txt'] })
  // 비압축/빈 → null
  eq('추출인자 비압축', toExtractArgs(['C:\\d\\a.txt']), null)
  eq('추출인자 빈', toExtractArgs([]), null)
}

// ── toAddTarget: 압축 도착 URI → {archivePath, innerDir} ───────────────────────
eq('추가대상 폴더', toAddTarget(makeArchivePath(ZIP, 'sub')), { archivePath: ZIP, innerDir: 'sub' })
eq('추가대상 루트', toAddTarget(makeArchivePath(ZIP, '')), { archivePath: ZIP, innerDir: '' })
eq('추가대상 비압축', toAddTarget('C:\\d'), null)

// ── resolveTransfer: 압축 조합(D&D 라우팅 — extract/add/unsupported) ───────────
const noMods = { ctrl: false, shift: false }
eq('라우팅 압축→로컬=extract', resolveTransfer({ kind: 'archive' }, { kind: 'local' }, noMods), 'extract')
eq('라우팅 로컬→압축=add', resolveTransfer({ kind: 'local' }, { kind: 'archive' }, noMods), 'add')
eq(
  '라우팅 압축↔압축=unsupported',
  resolveTransfer({ kind: 'archive' }, { kind: 'archive' }, noMods),
  'unsupported'
)
eq(
  '라우팅 압축↔원격=unsupported',
  resolveTransfer({ kind: 'archive' }, { kind: 'remote' }, noMods),
  'unsupported'
)
// 회귀: 로컬↔로컬·로컬↔원격은 영향 없음(드라이브 동일=move).
eq(
  '회귀 로컬→로컬 같은드라이브=move',
  resolveTransfer({ kind: 'local' }, { kind: 'local' }, noMods, 'C:\\a', 'C:\\b'),
  'move'
)
eq('회귀 로컬→원격=upload', resolveTransfer({ kind: 'local' }, { kind: 'remote' }, noMods), 'upload')

// ── paths: 압축 URI baseName/parentOf/breadcrumbs/normalizeDisplay ─────────────
// baseName: 루트=zip 파일명, 내부=마지막 세그먼트
eq('baseName 압축루트', baseName(makeArchivePath(ZIP, '')), 'a.zip')
eq('baseName 압축내부', baseName(makeArchivePath(ZIP, 'sub/x.txt')), 'x.txt')
eq('baseName 압축내부폴더', baseName(makeArchivePath(ZIP, 'sub')), 'sub')

// parentOf: 내부 위로 = 상위 inner; 루트 위로 = zip 의 로컬 폴더(압축 벗어남)
eq('parentOf 압축내부', parentOf(makeArchivePath(ZIP, 'sub/x.txt')), makeArchivePath(ZIP, 'sub'))
eq('parentOf 압축 1단', parentOf(makeArchivePath(ZIP, 'sub')), makeArchivePath(ZIP, ''))
eq('parentOf 압축루트→로컬', parentOf(makeArchivePath(ZIP, '')), 'C:\\d')

// normalizeDisplay: 압축 URI 보존(백슬래시 변환 안 함)
eq(
  'normalizeDisplay 압축 보존',
  normalizeDisplay(makeArchivePath(ZIP, 'sub/x.txt')),
  makeArchivePath(ZIP, 'sub/x.txt')
)

// breadcrumbs: 로컬 폴더 크럼 + zip 루트 + 내부 세그먼트(마지막=현재)
{
  const cr = breadcrumbs(makeArchivePath(ZIP, 'sub/x'))
  // 마지막 크럼 = 현재 inner
  eq('breadcrumbs 마지막 path', cr[cr.length - 1]?.path, makeArchivePath(ZIP, 'sub/x'))
  eq('breadcrumbs 마지막 label', cr[cr.length - 1]?.label, 'x')
  // zip 루트 크럼 존재(파일명 라벨 + inner='' path)
  const zipCrumb = cr.find((c) => c.path === makeArchivePath(ZIP, ''))
  eq('breadcrumbs zip루트 라벨', zipCrumb?.label, 'a.zip')
  // 첫 크럼은 내 PC(로컬 폴더 체인 시작)
  eq('breadcrumbs 첫=내PC', cr[0]?.label, '내 PC')
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
