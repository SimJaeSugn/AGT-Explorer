/* P2/P3 도메인 순수 로직 검증(임시 하니스). 정식 테스트는 P7 tests/ 로 이관. */
import { sortEntries, naturalCompare } from '../src/renderer/domain/rules/sort'
import {
  applySelect,
  emptySelection,
  modeFromModifiers,
  selectAll
} from '../src/renderer/domain/rules/selection'
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

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
