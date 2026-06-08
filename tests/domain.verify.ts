/* P2/P3 도메인 순수 로직 검증(임시 하니스). 정식 테스트는 P7 tests/ 로 이관. */
import { sortEntries, naturalCompare } from '../src/renderer/domain/rules/sort'
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
import type { FileEntryDTO } from '../src/shared/dto'

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

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
