/**
 * 디스크 사용량 스캔 엔진 — root 부터 재귀로 총 바이트/항목을 집계하고
 * 상위 폴더/파일 Top10 을 산출한다 (I장, 계획서 §2.4).
 *
 * 환경 비의존(environment-agnostic): 진행/취소 보고를 콜백(ScanHooks)으로 받는다.
 * 그래서 (a) Worker Thread 안에서 실제 스캔으로, (b) 검증 스크립트에서 메인
 * 스레드 직접 호출로 동일하게 돌릴 수 있다(engine.ts 선례와 동형).
 *
 * 설계 포인트:
 *  - 1패스 O(전체) — 전체 파일 목록을 메모리에 보관하지 않는다. 파일은 size-10
 *    min-heap 으로 Top10 만 유지, 폴더는 직속 자식 단위로만 후보에 push 후 별도
 *    size-10 힙으로 Top10 추림(메모리 상한).
 *  - 순환 방지(F장 특수케이스): 심볼릭링크·정션(lstat().isSymbolicLink())은
 *    **따라가지 않는다**(디렉토리로 재귀 안 함, 링크 자체 크기 0·skipped++).
 *    추가로 방문 realpath Set(베스트에포트)로 동일 실디렉토리 재방문을 차단해
 *    ELOOP 무한루프를 격리한다.
 *  - 권한거부 격리: readdir/lstat 실패는 throw 금지 → skipped++ 후 계속
 *    (engine.ts aggregate 의 try/catch 무시 패턴과 동일).
 *  - 취소: shouldCancel() 협조 폴링 — 디렉토리/항목 경계에서 중단,
 *    canceled=true 부분결과 반환.
 *  - 항목 상한: ITEM_CAP 초과 시 truncated=true 로 중단(폭주 방어, STREAM_CAP 선례).
 *
 * throw 금지 — 항목 단위 오류는 skipped 로 흡수한다.
 */
import * as fsp from 'node:fs/promises'
import { win32 } from 'node:path'
import type { ScanEntry, ScanResult } from '@shared/dto'

/** 항목 상한(폭주 방어). 초과 시 truncated=true 로 중단. */
export const SCAN_ITEM_CAP = 2_000_000

/** Top10 — 상위 N 보관 크기. */
const TOP_N = 10

/** 엔진이 상위(Worker/검증)에 보고/질의하는 훅. */
export interface ScanHooks {
  /** 진행 보고(누적 항목/바이트 + 현재 경로). 상위에서 200ms 스로틀. */
  onProgress(scannedItems: number, scannedBytes: number, currentPath: string): void
  /** 협조적 취소 폴링. true 면 안전 지점에서 중단. */
  shouldCancel(): boolean
}

/**
 * 고정 크기 min-heap(루트=최솟값). size 초과 시 최솟값을 밀어내며 상위 N 만 유지.
 * bytes 기준 비교 — Top10(최대 N개) 산출에 O(전체·logN) 1패스.
 */
class TopNHeap {
  private readonly items: ScanEntry[] = []

  constructor(private readonly cap: number) {}

  offer(entry: ScanEntry): void {
    if (this.items.length < this.cap) {
      this.items.push(entry)
      this.siftUp(this.items.length - 1)
    } else if (this.items.length > 0 && entry.bytes > this.items[0]!.bytes) {
      this.items[0] = entry
      this.siftDown(0)
    }
  }

  /** bytes desc 로 정렬된 결과(최대 cap 개). */
  toSortedDesc(): ScanEntry[] {
    return [...this.items].sort((a, b) => b.bytes - a.bytes)
  }

  private siftUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (this.items[i]!.bytes >= this.items[parent]!.bytes) break
      this.swap(i, parent)
      i = parent
    }
  }

  private siftDown(i: number): void {
    const n = this.items.length
    for (;;) {
      const l = i * 2 + 1
      const r = i * 2 + 2
      let smallest = i
      if (l < n && this.items[l]!.bytes < this.items[smallest]!.bytes) smallest = l
      if (r < n && this.items[r]!.bytes < this.items[smallest]!.bytes) smallest = r
      if (smallest === i) break
      this.swap(i, smallest)
      i = smallest
    }
  }

  private swap(a: number, b: number): void {
    const t = this.items[a]!
    this.items[a] = this.items[b]!
    this.items[b] = t
  }
}

interface ScanState {
  totalBytes: number
  totalItems: number
  skipped: number
  canceled: boolean
  truncated: boolean
  readonly topFolders: TopNHeap
  readonly topFiles: TopNHeap
  /** 방문 realpath 집합(순환 차단). */
  readonly visited: Set<string>
  /** 항목 상한(초과 시 truncated). 기본 SCAN_ITEM_CAP, 검증에서 주입 가능. */
  readonly itemCap: number
  /** 진행 콜백용 — 마지막 보고 경로. */
  lastPath: string
}

/** runScan 옵션 — itemCap 은 검증 스크립트에서 truncated 동작을 재현하려 주입. */
export interface ScanOptions {
  /** 항목 상한. 기본 SCAN_ITEM_CAP. */
  readonly itemCap?: number
}

/**
 * 디렉토리를 재귀 스캔하며 자기 자신(서브트리)의 총 바이트를 반환한다.
 * - 반환값: dir 서브트리 바이트 합계(상위에서 폴더 후보 bytes 로 사용).
 * - 직속 자식 폴더는 각자 서브트리 합계를 구한 뒤 topFolders 후보로 offer.
 * - 모든 파일은 topFiles 후보로 offer.
 */
async function scanDir(dir: string, state: ScanState, hooks: ScanHooks): Promise<number> {
  if (state.canceled || state.truncated) return 0
  if (hooks.shouldCancel()) {
    state.canceled = true
    return 0
  }

  // 순환 차단: 동일 실디렉토리 재방문 거부(베스트에포트 realpath).
  let real: string
  try {
    real = await fsp.realpath(dir)
  } catch {
    real = win32.resolve(dir)
  }
  if (state.visited.has(real)) {
    state.skipped++
    return 0
  }
  state.visited.add(real)

  let dirents: import('node:fs').Dirent[]
  try {
    dirents = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    // 권한거부 등 — 디렉토리 자체를 건너뛴다.
    state.skipped++
    return 0
  }

  let subtreeBytes = 0
  for (const dirent of dirents) {
    if (state.canceled || state.truncated) break
    if (hooks.shouldCancel()) {
      state.canceled = true
      break
    }
    if (state.totalItems >= state.itemCap) {
      state.truncated = true
      break
    }

    const childPath = win32.join(dir, dirent.name)

    // lstat 으로 심볼릭/정션 판정(링크는 따라가지 않음).
    let st: import('node:fs').Stats
    try {
      st = await fsp.lstat(childPath)
    } catch {
      state.skipped++
      continue
    }

    state.totalItems++
    state.lastPath = childPath

    if (st.isSymbolicLink()) {
      // 링크는 추적 안 함 — 자체 크기 0 취급, 순환 회피. 격리 카운트.
      state.skipped++
      continue
    }

    if (st.isDirectory()) {
      const childBytes = await scanDir(childPath, state, hooks)
      subtreeBytes += childBytes
      // 직속 자식 폴더만 Top 후보로 등록(메모리 상한 — 깊은 폴더는 부모 합계에 포함).
      state.topFolders.offer({
        path: childPath,
        name: dirent.name,
        bytes: childBytes,
        isDir: true
      })
    } else if (st.isFile()) {
      const bytes = st.size
      subtreeBytes += bytes
      state.totalBytes += bytes
      state.topFiles.offer({
        path: childPath,
        name: dirent.name,
        bytes,
        isDir: false
      })
    }
    // 그 외(블록/소켓/FIFO 등)는 항목만 카운트하고 바이트 0.
  }

  return subtreeBytes
}

/**
 * root 부터 재귀 스캔해 Top10 폴더/파일 + 요약을 산출한다.
 * 진행률은 호출자(Worker/검증)가 onProgress 로 받아 스로틀·중계한다.
 */
export async function runScan(
  rootPath: string,
  hooks: ScanHooks,
  options?: ScanOptions
): Promise<ScanResult> {
  const root = win32.resolve(rootPath)
  const itemCap =
    options?.itemCap !== undefined && options.itemCap > 0 ? options.itemCap : SCAN_ITEM_CAP
  const state: ScanState = {
    totalBytes: 0,
    totalItems: 0,
    skipped: 0,
    canceled: false,
    truncated: false,
    topFolders: new TopNHeap(TOP_N),
    topFiles: new TopNHeap(TOP_N),
    visited: new Set<string>(),
    itemCap,
    lastPath: root
  }

  // 진행률 펌프: 엔진은 누적값을 상태에 쌓고, 항목 경계마다 onProgress 를 친다.
  // 호출자(ScanManager)가 200ms 스로틀로 1건씩 Renderer 에 중계하므로 폭주 무해.
  await scanDirWithProgress(root, state, hooks)

  return {
    root,
    totalBytes: state.totalBytes,
    totalItems: state.totalItems,
    topFolders: state.topFolders.toSortedDesc(),
    topFiles: state.topFiles.toSortedDesc(),
    skipped: state.skipped,
    canceled: state.canceled,
    truncated: state.truncated
  }
}

/**
 * scanDir 를 돌리되 항목 경계마다 진행 콜백을 친다(누적 항목/바이트/현재 경로).
 * 콜백 폭주는 호출자(ScanManager) 스로틀이 흡수하므로 여기선 매 항목 보고해도 무방.
 */
async function scanDirWithProgress(
  root: string,
  state: ScanState,
  hooks: ScanHooks
): Promise<void> {
  const onProgress = hooks.onProgress
  // 진행 보고를 끼워넣은 훅 — scanDir 가 totalItems 를 갱신한 직후 보고하도록
  // shouldCancel 폴링 지점에서 콜백을 친다.
  const reporting: ScanHooks = {
    shouldCancel: () => {
      onProgress(state.totalItems, state.totalBytes, state.lastPath)
      return hooks.shouldCancel()
    },
    onProgress
  }
  await scanDir(root, state, reporting)
  // 종료 시 마지막 1건 강제 보고(100% 반영).
  onProgress(state.totalItems, state.totalBytes, state.lastPath)
}
