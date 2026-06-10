/* P2/P3 도메인 순수 로직 검증(임시 하니스). 정식 테스트는 P7 tests/ 로 이관. */
import { sortEntries, naturalCompare, applyPins } from '../src/renderer/domain/rules/sort'
import {
  applySelect,
  emptySelection,
  modeFromModifiers,
  selectAll,
  selectIndices,
  unionIndices,
  toggleIndices
} from '../src/renderer/domain/rules/selection'
import {
  normalizeRect,
  intersectsCell,
  indicesInRect
} from '../src/renderer/domain/rules/boxSelect'
import {
  parentOf,
  breadcrumbs,
  baseName,
  isMyPc,
  joinPath,
  normalizeDisplay
} from '../src/renderer/domain/paths'
import { resolveFavoriteWatermark } from '../src/renderer/domain/rules/favoriteWatermark'
import { resolveDropTarget } from '../src/renderer/ui/sidebar/useFavoriteReorder'
import {
  computeBatchRename,
  isApplicable,
  splitName
} from '../src/renderer/domain/rules/batchRename'
import {
  compareEntries,
  summarize,
  diffOnlyPairs,
  planMirror,
  fromCompareResult,
  DEFAULT_COMPARE_OPTIONS
} from '../src/renderer/domain/rules/compare'
import { summarizeVerify, verifyMessage } from '../src/renderer/domain/rules/checksumVerdict'
import { shapeBreadcrumbSiblings } from '../src/renderer/domain/rules/breadcrumbSiblings'
import {
  keepCandidate,
  selectAllButOne,
  selectAllButOneForAll,
  hasFullSelection,
  anyFullySelected,
  sortGroupsByWaste,
  wastedBytes,
  totalWastedBytes,
  countSelected
} from '../src/renderer/domain/rules/dupGroup'
import {
  clampColumnWidth,
  coerceDetailsColumnWidths,
  COLUMN_MIN_WIDTH,
  COLUMN_MAX_WIDTH,
  DEFAULT_DETAILS_COLUMN_WIDTHS
} from '../src/renderer/domain/rules/columnWidths'
import type { ComparePairDTO, DupGroupDTO, FileEntryDTO, VerifyMismatchDTO } from '../src/shared/dto'
// M8 T1/T2: 태그 순수 규칙 + folderSize 키 헬퍼 + 세션 coerce(coerceTagsByPath).
import {
  TAG_PALETTE,
  isTagKey,
  tagColorOf,
  tagDisplayName,
  normalizeTags,
  matchesTags,
  type TagKey
} from '../src/renderer/domain/rules/tags'
import { folderSizeKeyFor } from '../src/renderer/app/usecases/folderSize'
import { coerceTagsByPath } from '../src/main/persistence/defaults'

/**
 * T2 폴더 용량 표기 미러(FileListView.formatBytes 와 동일 단위 규칙 — 사적 함수라
 * 헤드리스 verify 가 직접 import 불가하므로 동일 로직을 재현해 표기 규칙만 검증).
 */
function formatBytesT2(b: number): string {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`
  return `${(b / 1024 / 1024 / 1024).toFixed(1)} GB`
}

const mk = (name: string, isDir: boolean, size = 0, mtime = 0): FileEntryDTO => ({
  name,
  path: 'C:\\x\\' + name,
  isDir,
  size,
  mtime,
  ctime: 0,
  ext: isDir ? '' : name.includes('.') ? (name.split('.').pop() as string).toLowerCase() : '',
  attrs: { hidden: false, readonly: false, system: false, symlink: false }
})

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

eq('natural file2<file10', naturalCompare('file2', 'file10') < 0, true)

const list = [
  mk('b.txt', false),
  mk('Apple', true),
  mk('a.txt', false),
  mk('zeta', true),
  mk('file10', false),
  mk('file2', false)
]
eq(
  'folderFirst name asc',
  sortEntries(list, 'name', 'asc', true).map((e) => e.name),
  ['Apple', 'zeta', 'a.txt', 'b.txt', 'file2', 'file10']
)
eq(
  'folderFirst name desc folders top',
  sortEntries(list, 'name', 'desc', true)
    .map((e) => e.name)
    .slice(0, 2),
  ['zeta', 'Apple']
)
eq(
  'size asc',
  sortEntries([mk('a', false, 30), mk('b', false, 10), mk('c', false, 20)], 'size', 'asc', false).map(
    (e) => e.name
  ),
  ['b', 'c', 'a']
)

const vis = ['p0', 'p1', 'p2', 'p3', 'p4']
let s = applySelect(emptySelection, vis, 2, 'single')
eq('single select', [...s.selectedPaths], ['p2'])
s = applySelect(s, vis, 4, 'range')
eq('shift range 2..4', [...s.selectedPaths], ['p2', 'p3', 'p4'])
s = applySelect(emptySelection, vis, 1, 'single')
s = applySelect(s, vis, 3, 'toggle')
eq('ctrl toggle adds', [...s.selectedPaths].sort(), ['p1', 'p3'])
s = applySelect(s, vis, 1, 'toggle')
eq('ctrl toggle removes', [...s.selectedPaths], ['p3'])
eq('selectAll', [...selectAll(vis).selectedPaths], vis)
eq('mode ctrl', modeFromModifiers(true, false), 'toggle')
eq('mode shift', modeFromModifiers(false, true), 'range')
eq('mode ctrl+shift', modeFromModifiers(true, true), 'addRange')

eq('parentOf C:\\a\\b', parentOf('C:\\a\\b'), 'C:\\a')
eq('parentOf C:\\', parentOf('C:\\'), '')
eq('parentOf myPC', parentOf(''), null)
eq('isMyPc', isMyPc(''), true)
eq('baseName', baseName('C:\\a\\b'), 'b')
eq('joinPath', joinPath('C:\\a', 'b'), 'C:\\a\\b')
eq('joinPath from myPC', joinPath('', 'C:\\'), 'C:\\')
eq('normalizeDisplay drive', normalizeDisplay('C:'), 'C:\\')
eq(
  'breadcrumbs',
  breadcrumbs('C:\\a\\b').map((c) => c.path),
  ['', 'C:\\', 'C:\\a', 'C:\\a\\b']
)

// ── 원격 URI 경로 인식(§M M3 버그 수정: 더블클릭 ENOENT) ──────────────────
eq('parentOf remote child', parentOf('sftp://h/mnt/sub'), 'sftp://h/mnt')
eq('parentOf remote one-level', parentOf('sftp://h/mnt'), 'sftp://h/')
eq('parentOf remote root = null', parentOf('sftp://h/'), null)
eq('baseName remote child', baseName('sftp://h/mnt/sub'), 'sub')
eq('baseName remote root', baseName('sftp://h/'), 'sftp://h')
eq('normalizeDisplay remote keeps slashes', normalizeDisplay('sftp://h/mnt/sub'), 'sftp://h/mnt/sub')
eq(
  'breadcrumbs remote',
  breadcrumbs('sftp://h/mnt/sub').map((c) => c.path),
  ['sftp://h/', 'sftp://h/mnt', 'sftp://h/mnt/sub']
)
eq(
  'breadcrumbs remote labels',
  breadcrumbs('sftp://h/mnt/sub').map((c) => c.label),
  ['sftp://h', 'mnt', 'sub']
)

// ── 상단 고정(applyPins) ─────────────────────────────────────────────────
const pinList = [mk('a.txt', false), mk('b.txt', false), mk('c.txt', false), mk('d.txt', false)]
eq('applyPins empty = unchanged order', applyPins(pinList, new Set()).map((e) => e.name), [
  'a.txt',
  'b.txt',
  'c.txt',
  'd.txt'
])
eq(
  'applyPins hoists pinned to top (sorted order preserved within group)',
  applyPins(pinList, new Set(['C:\\x\\c.txt', 'C:\\x\\a.txt'])).map((e) => e.name),
  ['a.txt', 'c.txt', 'b.txt', 'd.txt']
)
eq('applyPins does not mutate input', pinList.map((e) => e.name), [
  'a.txt',
  'b.txt',
  'c.txt',
  'd.txt'
])

// ── 박스 선택(러버밴드, J1) ────────────────────────────────────────────
eq('normalizeRect swaps', normalizeRect(30, 40, 10, 20), {
  top: 20,
  bottom: 40,
  left: 10,
  right: 30
})
eq(
  'intersectsCell overlap',
  intersectsCell({ top: 10, left: 10, bottom: 30, right: 30 }, 20, 20, 26, 100),
  true
)
eq(
  'intersectsCell no-overlap',
  intersectsCell({ top: 0, left: 0, bottom: 5, right: 5 }, 20, 20, 26, 100),
  false
)
// list(colCount=1, cellH=26): rect 가 0..60 세로면 row0(0..26),row1(26..52),row2(52..78) 교차.
eq(
  'indicesInRect list rows 0..2',
  indicesInRect({ top: 0, left: 0, bottom: 60, right: 600 }, {
    colCount: 1,
    cellH: 26,
    cellW: 600,
    count: 10
  }),
  [0, 1, 2]
)
// grid(colCount=3, cell 100x96): rect 가 첫 행 0..1열만 덮으면 인덱스 0,1.
eq(
  'indicesInRect grid 2 cells',
  indicesInRect({ top: 0, left: 0, bottom: 90, right: 150 }, {
    colCount: 3,
    cellH: 96,
    cellW: 100,
    count: 9
  }),
  [0, 1]
)
// count 경계: 마지막 행 일부만 채워진 경우 count 초과 인덱스 미포함.
eq(
  'indicesInRect respects count',
  indicesInRect({ top: 0, left: 0, bottom: 200, right: 300 }, {
    colCount: 3,
    cellH: 96,
    cellW: 100,
    count: 4
  }),
  [0, 1, 2, 3]
)
const vp = ['a', 'b', 'c', 'd', 'e']
eq('selectIndices', [...selectIndices(vp, [1, 3]).selectedPaths], ['b', 'd'])
eq(
  'unionIndices keeps base',
  [...unionIndices({ anchorIndex: 0, selectedPaths: new Set(['a']) }, vp, [2]).selectedPaths].sort(),
  ['a', 'c']
)
eq(
  'toggleIndices removes existing',
  [...toggleIndices({ anchorIndex: 0, selectedPaths: new Set(['a', 'c']) }, vp, [2]).selectedPaths],
  ['a']
)

// ── N1: resolveFavoriteWatermark(정확일치·별칭폴백·내PC/원격 비매치·다중일치 1개) ──
{
  const favs = ['C:\\Projects', 'D:\\work', 'C:\\Projects'] // 마지막은 중복(방어적).
  const labels: Record<string, string> = { 'D:\\work': '업무' }

  // 정확 일치 → basename(별칭 없음).
  eq('N1 정확일치 basename', resolveFavoriteWatermark('C:\\Projects', favs, labels), {
    match: true,
    text: 'Projects'
  })
  // 별칭 우선.
  eq('N1 별칭 우선', resolveFavoriteWatermark('D:\\work', favs, labels), { match: true, text: '업무' })
  // 끝 슬래시/슬래시 방향 정규화 후 일치.
  eq('N1 정규화 일치(끝슬래시)', resolveFavoriteWatermark('C:\\Projects\\', favs, labels), {
    match: true,
    text: 'Projects'
  })
  eq('N1 정규화 일치(슬래시방향)', resolveFavoriteWatermark('C:/Projects', favs, labels), {
    match: true,
    text: 'Projects'
  })
  // 하위/부분 경로는 비매치(과표시 방지).
  eq('N1 하위경로 비매치', resolveFavoriteWatermark('C:\\Projects\\sub', favs, labels), { match: false })
  // 비-즐겨찾기 비매치.
  eq('N1 비즐겨찾기 비매치', resolveFavoriteWatermark('E:\\other', favs, labels), { match: false })
  // "내 PC"('') 비매치.
  eq('N1 내PC 비매치', resolveFavoriteWatermark('', favs, labels), { match: false })
  // 원격 경로 비매치(즐겨찾기에 들어있어도).
  eq(
    'N1 원격 비매치',
    resolveFavoriteWatermark('sftp://h.com/var', ['sftp://h.com/var'], {}),
    { match: false }
  )
  // 빈 별칭(공백)은 basename 폴백.
  eq('N1 빈별칭 basename 폴백', resolveFavoriteWatermark('C:\\a\\b', ['C:\\a\\b'], { 'C:\\a\\b': '   ' }), {
    match: true,
    text: 'b'
  })
  // 다중 일치: 첫 일치 1개만(여기선 둘 다 라벨 없음 → basename 동일·결정론).
  eq('N1 다중일치 첫1개', resolveFavoriteWatermark('C:\\Projects', favs, labels), {
    match: true,
    text: 'Projects'
  })
}

// ── N2: resolveDropTarget(insert 위치 → reorderFavorite to 인덱스 환산) ────────
{
  // length=4 가정. from=0.
  eq('N2 drop from0 insert0 무동작', resolveDropTarget(0, 0, 4), null)
  eq('N2 drop from0 insert1 무동작(자기뒤)', resolveDropTarget(0, 1, 4), null) // 0→0(제거후보정)
  eq('N2 drop from0 insert2 → to1', resolveDropTarget(0, 2, 4), 1)
  eq('N2 drop from0 insert4(맨끝) → to3', resolveDropTarget(0, 4, 4), 3)
  // from=3(끝) 앞으로.
  eq('N2 drop from3 insert0 → to0', resolveDropTarget(3, 0, 4), 0)
  eq('N2 drop from3 insert3 무동작', resolveDropTarget(3, 3, 4), null) // 3→3
  eq('N2 drop from3 insert4 무동작', resolveDropTarget(3, 4, 4), null) // 3→3
  // 범위밖 가드.
  eq('N2 drop from 범위밖 null', resolveDropTarget(-1, 0, 4), null)
  eq('N2 drop insert 범위밖 null', resolveDropTarget(0, 5, 4), null)
}

// ── R1: batchRename(패턴/정규식/연번/대소문자/충돌검출/안전폴백) ─────────────
{
  const tg = (name: string, isDir = false): { path: string; name: string; isDir: boolean } => ({
    path: `C:\\d\\${name}`,
    name,
    isDir
  })

  // splitName: 베이스/확장자 분리(선행점·점없음 경계).
  eq('R1 splitName 일반', splitName('report.png'), { base: 'report', ext: 'png' })
  eq('R1 splitName 점없음', splitName('README'), { base: 'README', ext: '' })
  eq('R1 splitName 선행점(.gitignore)', splitName('.gitignore'), { base: '.gitignore', ext: '' })
  eq('R1 splitName 다중점', splitName('a.b.c'), { base: 'a.b', ext: 'c' })
  eq('R1 splitName 끝점', splitName('name.'), { base: 'name.', ext: '' })

  // 패턴 치환(문자열·베이스명만·확장자 보존).
  {
    const r = computeBatchRename([tg('IMG_001.jpg'), tg('IMG_002.jpg')], { find: 'IMG', replace: 'Photo' }, new Set())
    eq('R1 문자열 치환', r.rows.map((x) => x.newName), ['Photo_001.jpg', 'Photo_002.jpg'])
    eq('R1 치환 changed', r.rows.map((x) => x.changed), [true, true])
    eq('R1 치환 적용가능', isApplicable(r), true)
  }

  // 정규식 치환(캡처 그룹).
  {
    const r = computeBatchRename([tg('file12.txt')], { find: '(\\d+)', replace: '#$1', useRegex: true }, new Set())
    eq('R1 정규식 캡처 치환', r.rows[0]!.newName, 'file#12.txt')
    eq('R1 정규식 invalidRegex false', r.invalidRegex, false)
  }

  // 잘못된 정규식 → throw 금지·invalidRegex·원본 유지·isApplicable false.
  {
    const r = computeBatchRename([tg('a.txt')], { find: '(', replace: 'x', useRegex: true }, new Set())
    eq('R1 잘못된 정규식 invalidRegex', r.invalidRegex, true)
    eq('R1 잘못된 정규식 원본 유지', r.rows[0]!.newName, 'a.txt')
    eq('R1 잘못된 정규식 isApplicable false', isApplicable(r), false)
  }

  // 연번(자릿수/시작/증가/위치) — 접미·pad3.
  {
    const r = computeBatchRename(
      [tg('a.txt'), tg('b.txt'), tg('c.txt')],
      { seq: { enabled: true, start: 5, step: 2, pad: 3, position: 'suffix' } },
      new Set()
    )
    eq('R1 연번 접미 pad3', r.rows.map((x) => x.newName), ['a005.txt', 'b007.txt', 'c009.txt'])
  }
  // 연번 접두.
  {
    const r = computeBatchRename(
      [tg('a.txt'), tg('b.txt')],
      { seq: { enabled: true, start: 1, step: 1, pad: 2, position: 'prefix' } },
      new Set()
    )
    eq('R1 연번 접두 pad2', r.rows.map((x) => x.newName), ['01a.txt', '02b.txt'])
  }

  // 대소문자(upper/lower/title) — 베이스명만.
  eq(
    'R1 대문자',
    computeBatchRename([tg('hello.txt')], { caseMode: 'upper' }, new Set()).rows[0]!.newName,
    'HELLO.txt'
  )
  eq(
    'R1 소문자',
    computeBatchRename([tg('HELLO.TXT')], { caseMode: 'lower' }, new Set()).rows[0]!.newName,
    'hello.TXT'
  )
  eq(
    'R1 타이틀',
    computeBatchRename([tg('my report file.txt')], { caseMode: 'title' }, new Set()).rows[0]!.newName,
    'My Report File.txt'
  )

  // 접두/접미.
  eq(
    'R1 접두접미',
    computeBatchRename([tg('x.txt')], { prefix: 'pre_', suffix: '_post' }, new Set()).rows[0]!.newName,
    'pre_x_post.txt'
  )

  // 확장자 포함 적용 토글: applyToExt=true 면 대문자가 확장자까지.
  eq(
    'R1 확장자 포함 적용',
    computeBatchRename([tg('img.png')], { caseMode: 'upper', applyToExt: true }, new Set()).rows[0]!.newName,
    'IMG.PNG'
  )

  // 충돌: dup-internal(변경 후 이름끼리).
  {
    const r = computeBatchRename(
      [tg('a.txt'), tg('b.txt')],
      { find: 'a', replace: 'b', useRegex: false }, // a.txt → b.txt (b.txt 와 충돌)
      new Set()
    )
    const errs = r.rows.map((x) => x.error)
    eq('R1 dup-internal 검출', errs.includes('dup-internal'), true)
    eq('R1 충돌 시 isApplicable false', isApplicable(r), false)
  }

  // 충돌: dup-existing(폴더 내 비대상 기존과 충돌).
  {
    const r = computeBatchRename([tg('a.txt')], { find: 'a', replace: 'keep' }, new Set(['keep.txt']))
    eq('R1 dup-existing 검출', r.rows[0]!.error, 'dup-existing')
  }
  // 비변경 행은 기존 동명이어도 dup-existing 아님(자기 자신 충돌 방지: 대상은 existing 에서 제외하므로 N/A).
  {
    const r = computeBatchRename([tg('a.txt')], {}, new Set())
    eq('R1 규칙 없으면 changed false·에러 없음', { changed: r.rows[0]!.changed, error: r.rows[0]!.error }, {
      changed: false,
      error: null
    })
    eq('R1 변경 0이면 isApplicable false', isApplicable(r), false)
  }

  // 금지문자·예약명·빈 이름.
  eq(
    'R1 금지문자 차단',
    computeBatchRename([tg('a.txt')], { find: 'a', replace: 'b/c' }, new Set()).rows[0]!.error,
    'invalid-char'
  )
  eq(
    'R1 예약명 차단(CON)',
    computeBatchRename([tg('x.txt')], { find: 'x', replace: 'con' }, new Set()).rows[0]!.error,
    'reserved'
  )
  eq(
    'R1 빈 이름 차단',
    computeBatchRename([tg('a')], { find: 'a', replace: '' }, new Set()).rows[0]!.error,
    'empty'
  )

  // 순서 보존: 연번이 입력 순서대로.
  {
    const r = computeBatchRename(
      [tg('z.txt'), tg('a.txt'), tg('m.txt')],
      { seq: { enabled: true, start: 1, step: 1, pad: 1, position: 'prefix' } },
      new Set()
    )
    eq('R1 연번 입력순서 보존', r.rows.map((x) => x.newName), ['1z.txt', '2a.txt', '3m.txt'])
  }
}

// ── P1: compare.compareEntries(4상태·크기/수정일 차·대소문자 무시·정렬무관) ──
{
  // 헬퍼: 이름·크기·수정일 지정 entry.
  const f = (name: string, size = 100, mtime = 1000, isDir = false): FileEntryDTO => ({
    ...mk(name, isDir, size, mtime)
  })

  // 4상태 분류: left-only / right-only / diff / same.
  {
    const left = [f('a.txt', 10, 1000), f('both.txt', 50, 2000), f('diffsize.txt', 10, 1000)]
    const right = [f('b.txt', 20, 1000), f('both.txt', 50, 2000), f('diffsize.txt', 99, 1000)]
    const pairs = compareEntries(left, right, DEFAULT_COMPARE_OPTIONS)
    const byName = new Map(pairs.map((p) => [p.name, p.status]))
    eq('P1 left-only', byName.get('a.txt'), 'left-only')
    eq('P1 right-only', byName.get('b.txt'), 'right-only')
    eq('P1 same(같은 크기·수정일)', byName.get('both.txt'), 'same')
    eq('P1 diff(크기차)', byName.get('diffsize.txt'), 'diff')
  }

  // 수정일 허용오차 경계: tol 이내=same, 초과=diff.
  {
    const left = [f('m.txt', 10, 10000)]
    const right = [f('m.txt', 10, 11500)] // 1500ms 차
    const within = compareEntries(left, right, { bySize: true, byMtime: true, mtimeToleranceMs: 2000 })
    eq('P1 mtime 허용오차 이내 same', within[0]!.status, 'same')
    const right2 = [f('m.txt', 10, 13000)] // 3000ms 차 > 2000
    const beyond = compareEntries(left, right2, { bySize: true, byMtime: true, mtimeToleranceMs: 2000 })
    eq('P1 mtime 허용오차 초과 diff', beyond[0]!.status, 'diff')
  }

  // 대소문자 무시 매칭(기본 Windows): "Report.txt" ↔ "report.txt" 짝지음.
  {
    const left = [f('Report.txt', 10, 1000)]
    const right = [f('report.txt', 10, 1000)]
    const insensitive = compareEntries(left, right, DEFAULT_COMPARE_OPTIONS)
    eq('P1 대소문자무시 1쌍·same', { len: insensitive.length, st: insensitive[0]!.status }, { len: 1, st: 'same' })
    const sensitive = compareEntries(left, right, { ...DEFAULT_COMPARE_OPTIONS, caseSensitive: true })
    eq('P1 대소문자구분 2개(left/right-only)', sensitive.length, 2)
  }

  // 폴더 vs 파일 동명 → diff.
  {
    const left = [f('node', 0, 1000, true)]
    const right = [f('node', 0, 1000, false)]
    const pairs = compareEntries(left, right, DEFAULT_COMPARE_OPTIONS)
    eq('P1 폴더vs파일 동명 diff', pairs[0]!.status, 'diff')
  }

  // 폴더끼리 동명(메타 0) → same(단일 깊이·내부 차이는 M7).
  {
    const left = [f('sub', 0, 1000, true)]
    const right = [f('sub', 0, 9999, true)] // 폴더 mtime 다름이어도 same
    const pairs = compareEntries(left, right, DEFAULT_COMPARE_OPTIONS)
    eq('P1 폴더끼리 동명 same(메타 비교 제외)', pairs[0]!.status, 'same')
  }

  // 정렬무관 키매칭: 입력 순서를 섞어도 동일 결과.
  {
    const a = [f('a', 1, 1), f('b', 2, 2), f('c', 3, 3)]
    const b = [f('c', 3, 3), f('a', 1, 1), f('b', 2, 2)]
    const p1 = compareEntries(a, b, DEFAULT_COMPARE_OPTIONS).map((p) => `${p.name}:${p.status}`)
    const p2 = compareEntries(b, a, DEFAULT_COMPARE_OPTIONS).map((p) => `${p.name}:${p.status}`)
    eq('P1 정렬무관 결과 동일', p1, p2)
    eq('P1 키 정렬됨', p1, ['a:same', 'b:same', 'c:same'])
  }

  // summarize 카운트 합 = total + 빈 입력.
  {
    const pairs = compareEntries(
      [f('a'), f('same'), f('d', 10)],
      [f('b'), f('same'), f('d', 20)],
      DEFAULT_COMPARE_OPTIONS
    )
    const sum = summarize(pairs)
    eq('P1 summarize 합=total', sum.leftOnly + sum.rightOnly + sum.diff + sum.same, sum.total)
    eq('P1 summarize 카운트', { l: sum.leftOnly, r: sum.rightOnly, d: sum.diff, s: sum.same }, { l: 1, r: 1, d: 1, s: 1 })
    eq('P1 빈 입력 total 0', summarize(compareEntries([], [], DEFAULT_COMPARE_OPTIONS)).total, 0)
  }

  // diffOnlyPairs: same 제외.
  {
    const pairs = compareEntries([f('a'), f('same')], [f('b'), f('same')], DEFAULT_COMPARE_OPTIONS)
    eq('P1 diffOnly same 제외', diffOnlyPairs(pairs).every((p) => p.status !== 'same'), true)
    eq('P1 diffOnly 개수', diffOnlyPairs(pairs).length, 2)
  }

  // planMirror: 복사(없는것+다른것)·덮어쓰기 카운트·삭제(includeDeletes).
  {
    const left = [f('only-l', 10), f('diff', 10, 1000), f('same', 5, 1000)]
    const right = [f('only-r', 10), f('diff', 99, 1000), f('same', 5, 1000)]
    const pairs = compareEntries(left, right, DEFAULT_COMPARE_OPTIONS)
    // l2r dest=오른쪽 폴더. 복사 대상 = only-l(없는것) + diff(다른것). 삭제 미포함.
    const planCopy = planMirror(pairs, 'l2r', 'C:\\right', false)
    eq('P1 mirror l2r 복사 2건', planCopy.copyPaths.length, 2)
    eq('P1 mirror l2r 덮어쓰기 1건(diff)', planCopy.overwriteCount, 1)
    eq('P1 mirror 삭제 미포함', planCopy.deletePaths.length, 0)
    // includeDeletes=true → only-r(우측에만 있음·기준에 없음)이 삭제 대상.
    const planDel = planMirror(pairs, 'l2r', 'C:\\right', true)
    eq('P1 mirror 삭제 동기화 1건(only-r)', planDel.deletePaths.length, 1)
  }
}

// ── §P1 M7: fromCompareResult(백엔드 hash:compare DTO → ComparePair·relPath·status 신뢰) ──
{
  const fe = (name: string, size = 10, mtime = 1000): FileEntryDTO => ({ ...mk(name, false, size, mtime) })
  // 단일깊이(relPath 없음) — status 는 백엔드 값 그대로 신뢰, key=name 정규화.
  const dtos: ComparePairDTO[] = [
    { name: 'a.txt', left: fe('a.txt'), right: null, status: 'left-only' },
    { name: 'same.txt', left: fe('same.txt'), right: fe('same.txt'), status: 'same' },
    { name: 'hashdiff.txt', left: fe('hashdiff.txt'), right: fe('hashdiff.txt'), status: 'diff' }
  ]
  const pairs = fromCompareResult(dtos, DEFAULT_COMPARE_OPTIONS)
  eq('P1H fromCompareResult 개수', pairs.length, 3)
  eq('P1H status 백엔드 신뢰(해시 diff 보존)', pairs.map((p) => p.status), ['left-only', 'same', 'diff'])
  eq('P1H 단일깊이 relPath undefined', pairs.every((p) => p.relPath === undefined), true)
  eq('P1H key 대소문자 정규화(기본)', fromCompareResult([{ name: 'A.TXT', left: fe('A.TXT'), right: null, status: 'left-only' }])[0]!.key, 'a.txt')
  // summarize 동치(메타 경로와 같은 요약 함수).
  const sum = summarize(pairs)
  eq('P1H summarize 합=total', sum.leftOnly + sum.rightOnly + sum.diff + sum.same, sum.total)

  // 재귀(relPath 있음) — key 는 relPath 기준(동명 충돌 회피).
  const recDtos: ComparePairDTO[] = [
    { name: 'a.txt', left: fe('a.txt'), right: fe('a.txt'), status: 'same', relPath: 'a.txt' },
    { name: 'a.txt', left: fe('a.txt'), right: null, status: 'left-only', relPath: 'sub\\a.txt' }
  ]
  const recPairs = fromCompareResult(recDtos, DEFAULT_COMPARE_OPTIONS)
  eq('P1H 재귀 relPath 보존', recPairs.map((p) => p.relPath), ['a.txt', 'sub\\a.txt'])
  eq('P1H 재귀 동명 다른 key', recPairs[0]!.key !== recPairs[1]!.key, true)
  eq('P1H 재귀 key=relPath정규화', recPairs[1]!.key, 'sub\\a.txt')
  // 빈 입력 안전.
  eq('P1H 빈 입력 0', fromCompareResult([]).length, 0)
}

// ── §R4 M7: checksumVerdict(일치/불일치/사유 집계·요약·메시지) ──────────────
{
  const mm = (src: string, dst: string, reason: VerifyMismatchDTO['reason']): VerifyMismatchDTO => ({ src, dst, reason })
  // 전부 일치(불일치 0·verified 5).
  const okV = summarizeVerify([], 5)
  eq('R4 verdict ok kind', okV.kind, 'ok')
  eq('R4 verdict ok total=matched', { t: okV.total, m: okV.matched, x: okV.mismatched }, { t: 5, m: 5, x: 0 })
  eq('R4 verdict ok 메시지(전부 일치)', verifyMessage(okV).includes('모두 일치'), true)
  // total 0(검증 대상 없음) 안내.
  eq('R4 verdict 빈(0) 메시지', verifyMessage(summarizeVerify([], 0)).includes('검증할 파일이 없습니다'), true)

  // 불일치 혼합(hash·size·read-error) + verified 2.
  const mis = summarizeVerify(
    [mm('a', 'a2', 'hash-mismatch'), mm('b', 'b2', 'size-mismatch'), mm('c', 'c2', 'read-error'), mm('d', 'd2', 'hash-mismatch')],
    2
  )
  eq('R4 verdict mismatch kind', mis.kind, 'mismatch')
  eq('R4 verdict 집계', { t: mis.total, m: mis.matched, x: mis.mismatched }, { t: 6, m: 2, x: 4 })
  eq('R4 verdict 사유별', mis.byReason, { 'hash-mismatch': 2, 'size-mismatch': 1, 'read-error': 1 })
  const msg = verifyMessage(mis)
  eq('R4 verdict 메시지 불일치 표기', msg.includes('2개 일치') && msg.includes('4개 불일치'), true)
  eq('R4 verdict 메시지 사유 표기', msg.includes('내용 다름 2') && msg.includes('크기 다름 1') && msg.includes('읽기 실패 1'), true)

  // 방어: 음수 verified → 0 클램프, 손상 reason 무시.
  const def = summarizeVerify([{ src: 'x', dst: 'y', reason: 'bogus' as VerifyMismatchDTO['reason'] }], -3)
  eq('R4 verdict 음수 verified 0클램프', def.matched, 0)
  eq('R4 verdict 손상 reason 집계 0', def.byReason, { 'hash-mismatch': 0, 'size-mismatch': 0, 'read-error': 0 })
}

// ── §R2: 중복 그룹 보조 규칙(dupGroup) ─────────────────────────────────────
{
  const dupFile = (path: string, mtime: number): { path: string; name: string; mtime: number } => ({
    path,
    name: path.split('\\').pop() ?? path,
    mtime
  })
  // 그룹 A: 3개(원본=가장 오래된 mtime). 그룹 B: 2개(같은 mtime → path 사전순 보존).
  const gA: DupGroupDTO = {
    hash: 'hA',
    size: 100,
    files: [dupFile('C:\\x\\c.txt', 300), dupFile('C:\\x\\a.txt', 100), dupFile('C:\\x\\b.txt', 200)]
  }
  const gB: DupGroupDTO = {
    hash: 'hB',
    size: 2000,
    files: [dupFile('C:\\y\\z.txt', 500), dupFile('C:\\y\\m.txt', 500)]
  }
  const groups = [gA, gB]

  eq('R2 keepCandidate 가장오래된', keepCandidate(gA), 'C:\\x\\a.txt')
  eq('R2 keepCandidate 동률 path사전순', keepCandidate(gB), 'C:\\y\\m.txt')
  eq('R2 keepCandidate 빈그룹 null', keepCandidate({ hash: 'e', size: 0, files: [] }), null)

  const abo = selectAllButOne(gA)
  eq('R2 selectAllButOne 보존1개 제외', abo.sort(), ['C:\\x\\b.txt', 'C:\\x\\c.txt'])
  eq('R2 selectAllButOne 보존미포함', abo.includes('C:\\x\\a.txt'), false)
  eq('R2 selectAllButOne 1개그룹 빈배열', selectAllButOne({ hash: 'h', size: 1, files: [dupFile('C:\\p', 1)] }), [])

  eq('R2 selectAllButOneForAll 합산', selectAllButOneForAll(groups).length, 3)

  // hasFullSelection: 그룹 전부 선택(보존 0) 감지.
  const fullA = new Set(['C:\\x\\a.txt', 'C:\\x\\b.txt', 'C:\\x\\c.txt'])
  eq('R2 hasFullSelection 전부선택 true', hasFullSelection(gA, fullA), true)
  eq('R2 hasFullSelection 추천선택 false(보존1)', hasFullSelection(gA, new Set(abo)), false)
  eq('R2 anyFullySelected 위험감지', anyFullySelected(groups, fullA), true)
  eq('R2 anyFullySelected 추천선택 안전', anyFullySelected(groups, new Set(selectAllButOneForAll(groups))), false)

  // wastedBytes / 정렬: gB(2000*1=2000) > gA(100*2=200) → gB 먼저.
  eq('R2 wastedBytes gA', wastedBytes(gA), 200)
  eq('R2 wastedBytes gB', wastedBytes(gB), 2000)
  eq('R2 totalWastedBytes', totalWastedBytes(groups), 2200)
  eq('R2 sortGroupsByWaste 큰낭비먼저', sortGroupsByWaste(groups).map((g) => g.hash), ['hB', 'hA'])

  eq('R2 countSelected', countSelected(groups, new Set(['C:\\x\\b.txt', 'C:\\y\\z.txt'])), 2)
}

// ── U2 브레드크럼 드롭다운 형제 형상화 ─────────────────────────────────────
{
  // mk 는 path='C:\\x\\'+name 으로 만든다 → currentChildPath 도 그 규칙으로.
  const raw = [
    mk('zeta', true),
    mk('readme.txt', false), // 파일 → 제외
    mk('alpha', true),
    mk('item10', true),
    mk('item2', true)
  ]
  // 폴더만 + 자연 정렬(item2 < item10).
  const shaped = shapeBreadcrumbSiblings(raw, 'C:\\x\\alpha')
  eq('U2 폴더만통과·파일제외', shaped.map((s) => s.name), ['alpha', 'item2', 'item10', 'zeta'])
  eq('U2 current 표식(거쳐온 자식)', shaped.find((s) => s.name === 'alpha')?.current, true)
  eq('U2 비현재 자식 current=false', shaped.find((s) => s.name === 'zeta')?.current, false)
  // current 비교는 대소문자 무시 + 끝 슬래시 정규화(Windows FS).
  const shaped2 = shapeBreadcrumbSiblings([mk('Alpha', true)], 'c:\\x\\alpha\\')
  eq('U2 current 대소문자/슬래시 정규화', shaped2[0]?.current, true)
  // currentChildPath=null 이면 아무 것도 current 아님.
  eq('U2 current 없음', shapeBreadcrumbSiblings(raw, null).some((s) => s.current), false)
  // 빈 입력 → 빈 결과.
  eq('U2 빈입력', shapeBreadcrumbSiblings([], 'C:\\x').length, 0)
}

// ── 자세히 보기 열 너비(columnWidths) — clampColumnWidth + coerce 검증 ──────
{
  // clampColumnWidth: 정상값은 반올림, 범위밖은 클램프, 비유한수는 min 폴백.
  eq('COL clamp 정상 반올림', clampColumnWidth(90.4), 90)
  eq('COL clamp 정상 반올림 up', clampColumnWidth(90.6), 91)
  eq('COL clamp 하한', clampColumnWidth(10), COLUMN_MIN_WIDTH)
  eq('COL clamp 하한 경계', clampColumnWidth(COLUMN_MIN_WIDTH), COLUMN_MIN_WIDTH)
  eq('COL clamp 상한', clampColumnWidth(9999), COLUMN_MAX_WIDTH)
  eq('COL clamp 상한 경계', clampColumnWidth(COLUMN_MAX_WIDTH), COLUMN_MAX_WIDTH)
  eq('COL clamp NaN→min', clampColumnWidth(NaN), COLUMN_MIN_WIDTH)
  eq('COL clamp Infinity→min', clampColumnWidth(Infinity), COLUMN_MIN_WIDTH)
  eq('COL clamp 음수→min', clampColumnWidth(-50), COLUMN_MIN_WIDTH)
  // 커스텀 min/max 인자.
  eq('COL clamp 커스텀 min', clampColumnWidth(30, 40, 200), 40)
  eq('COL clamp 커스텀 max', clampColumnWidth(300, 40, 200), 200)

  // coerceDetailsColumnWidths: 누락/손상/배열/null 은 전부 기본값.
  eq('COL coerce null→기본', coerceDetailsColumnWidths(null), DEFAULT_DETAILS_COLUMN_WIDTHS)
  eq('COL coerce 배열→기본', coerceDetailsColumnWidths([1, 2, 3]), DEFAULT_DETAILS_COLUMN_WIDTHS)
  eq('COL coerce 원시값→기본', coerceDetailsColumnWidths(42), DEFAULT_DETAILS_COLUMN_WIDTHS)
  eq('COL coerce 빈객체→기본', coerceDetailsColumnWidths({}), DEFAULT_DETAILS_COLUMN_WIDTHS)
  // 정상 객체는 그대로(클램프 통과).
  eq('COL coerce 정상', coerceDetailsColumnWidths({ size: 120, type: 80, mtime: 160 }), {
    size: 120,
    type: 80,
    mtime: 160
  })
  // 일부 키 누락 → 해당 키만 기본값.
  eq('COL coerce 부분누락', coerceDetailsColumnWidths({ size: 200 }), {
    size: 200,
    type: DEFAULT_DETAILS_COLUMN_WIDTHS.type,
    mtime: DEFAULT_DETAILS_COLUMN_WIDTHS.mtime
  })
  // 범위밖·비유한수·비숫자 값은 클램프/기본 폴백.
  eq('COL coerce 범위밖 클램프', coerceDetailsColumnWidths({ size: 5, type: 9999, mtime: 140 }), {
    size: COLUMN_MIN_WIDTH,
    type: COLUMN_MAX_WIDTH,
    mtime: 140
  })
  eq('COL coerce NaN→기본', coerceDetailsColumnWidths({ size: NaN, type: 60, mtime: 140 }), {
    size: DEFAULT_DETAILS_COLUMN_WIDTHS.size,
    type: 60,
    mtime: 140
  })
  eq('COL coerce 문자열→기본', coerceDetailsColumnWidths({ size: '90', type: 60, mtime: 140 }), {
    size: DEFAULT_DETAILS_COLUMN_WIDTHS.size,
    type: 60,
    mtime: 140
  })
  // 소수 입력은 반올림.
  eq('COL coerce 소수 반올림', coerceDetailsColumnWidths({ size: 90.7, type: 60.2, mtime: 140 }), {
    size: 91,
    type: 60,
    mtime: 140
  })
  // 기본값 자체는 round-trip 동등(비파괴).
  eq(
    'COL coerce 기본값 round-trip',
    coerceDetailsColumnWidths(DEFAULT_DETAILS_COLUMN_WIDTHS),
    DEFAULT_DETAILS_COLUMN_WIDTHS
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// M8 T1/T2 추가 블록 — 태그 순수 규칙(domain/rules/tags) + 폴더용량 헬퍼(folderSize)
//   + 세션 coerce(coerceTagsByPath). 신규 채널 0·스키마 미상향(비파괴).
// ═══════════════════════════════════════════════════════════════════════════
{
  // T1: 태그 팔레트·키 검증·정규화·필터 술어(순수).
  eq('TAG 팔레트 7색', TAG_PALETTE.length, 7)
  eq(
    'TAG 팔레트 키 순서',
    TAG_PALETTE.map((c) => c.key),
    ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray']
  )
  eq('TAG isTagKey 유효', isTagKey('blue'), true)
  eq('TAG isTagKey 무효', isTagKey('cyan'), false)
  eq('TAG isTagKey 비문자열', isTagKey(3), false)
  eq('TAG tagColorOf red', tagColorOf('red')?.name, '빨강')
  eq('TAG tagDisplayName', tagDisplayName('purple'), '보라')

  // normalizeTags: 무효 제거·중복 제거·팔레트 순서.
  eq('TAG normalize 무효제거', normalizeTags(['blue', 'cyan', 'red']), ['red', 'blue'])
  eq('TAG normalize 중복제거', normalizeTags(['red', 'red', 'green']), ['red', 'green'])
  eq('TAG normalize 빈', normalizeTags([]), [])
  eq('TAG normalize 순서정렬', normalizeTags(['gray', 'red', 'yellow']), ['red', 'yellow', 'gray'])

  // matchesTags: 활성 비면 항상 true(항등), OR 매칭, 태그 없는 항목은 활성 시 제외.
  eq('TAG match 활성0 항등', matchesTags(['red'], new Set()), true)
  eq('TAG match 활성0 빈항목 항등', matchesTags(undefined, new Set()), true)
  eq('TAG match OR 적중', matchesTags(['red', 'green'], new Set<TagKey>(['green'])), true)
  eq('TAG match OR 미적중', matchesTags(['red'], new Set<TagKey>(['blue'])), false)
  eq('TAG match 빈항목 활성시 제외', matchesTags(undefined, new Set<TagKey>(['red'])), false)
  eq('TAG match 빈배열 활성시 제외', matchesTags([], new Set<TagKey>(['red'])), false)

  // T2: folderSize 키 헬퍼 + 바이트 포맷.
  eq('FSIZE key 항등(경로 그대로)', folderSizeKeyFor('C:\\a\\b'), 'C:\\a\\b')
  eq('FSIZE format B', formatBytesT2(512), '512 B')
  eq('FSIZE format KB', formatBytesT2(2048), '2.0 KB')
  eq('FSIZE format MB', formatBytesT2(5 * 1024 * 1024), '5.0 MB')
  eq('FSIZE format GB', formatBytesT2(3 * 1024 * 1024 * 1024), '3.0 GB')
  eq('FSIZE format 0', formatBytesT2(0), '0 B')

  // coerceTagsByPath(세션 영속 정규화 미러): 무효키·빈배열·비배열 제거, 유효키만 팔레트순.
  eq('TAG coerce null→빈', coerceTagsByPath(null), {})
  eq('TAG coerce 배열→빈', coerceTagsByPath([1, 2]), {})
  eq('TAG coerce 정상', coerceTagsByPath({ 'C:\\a': ['blue', 'red'] }), { 'C:\\a': ['red', 'blue'] })
  eq('TAG coerce 무효키 제거', coerceTagsByPath({ 'C:\\a': ['red', 'cyan'] }), { 'C:\\a': ['red'] })
  eq('TAG coerce 빈배열 키 제외', coerceTagsByPath({ 'C:\\a': [], 'C:\\b': ['green'] }), {
    'C:\\b': ['green']
  })
  eq('TAG coerce 비배열 값 제외', coerceTagsByPath({ 'C:\\a': 'red', 'C:\\b': ['gray'] }), {
    'C:\\b': ['gray']
  })
  eq('TAG coerce 전무효→빈맵', coerceTagsByPath({ 'C:\\a': ['cyan', 1] }), {})
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
