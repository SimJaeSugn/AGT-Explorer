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

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
