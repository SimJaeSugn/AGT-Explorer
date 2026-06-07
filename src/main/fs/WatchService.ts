/**
 * WatchService — Main 측 파일시스템 실시간 감시 계층 (J장 J2).
 *
 * 책임:
 *   - 패널이 보는 **현재 디렉토리 1개**를 `fs.watch(path, { recursive: false })` 로 감시.
 *   - 디렉토리 안의 외부 변경(생성·삭제·이름변경·이동) 신호를 디바운스·병합해 onEvent 1회.
 *   - 권한·네트워크(UNC)·미지원 FS 실패는 throw 0(격리) → onError(EACCES/EPERM/ENOENT/EUNKNOWN).
 *   - watchId(randomUUID) 상관(streamId 동형). 경로 이동 = stop 후 start(watchId 독립).
 *
 * **폴링 폴백(J2 §2)**: fs.watch 가 동작하지 않는 네트워크/미지원 드라이브를 위해 backend 내부에서
 * 폴링 모드로 전환한다. 소비측(watch.handlers·watchBridge)은 동일한 onEvent/onError 만 받으므로
 * **투명**(신규 채널 0). 전환은 두 갈래:
 *   - eager: 경로가 UNC(또는 보강 시 매핑 네트워크 드라이브)면 처음부터 폴링.
 *   - reactive: 로컬 경로라도 fs.watch 가 throw(ENOSYS/ENOTSUP/EPERM) 또는 워처 error 이벤트 →
 *     폴링으로 전환.
 * 폴링은 현재 디렉토리 1개만(비재귀) readdir + stat(name/size/mtime) 스냅샷을 직전과 diff 해
 * 변경 시 기존 디바운스(schedule)를 경유해 onEvent 1회를 통지한다. 초기 스냅샷은 발화하지 않는다.
 *
 * 증분은 전송하지 않는다 — "변경됨" 신호만(렌더러가 해당 패널 re-list). 비재귀(하위 트리 미감시).
 * 모든 메서드는 throw 하지 않는다(start 는 실패해도 onError 후 watchId 발급, 수동 새로고침 유지).
 */
import { watch as fsWatch, statSync, type FSWatcher } from 'node:fs'
import * as fsp from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { FileOpError } from '@shared/ipc/contracts'
import { fileOpError, toFileOpError } from './errors'
import { isLikelyRemotePath as defaultIsRemote } from './paths'
import { driveTypeService } from '../os/driveType'

/** 드라이브 루트(`X:\…`) 형태 판정 — lazy refresh trigger 게이트(UNC·상대경로 제외). */
const DRIVE_ROOT_PATH = /^[A-Za-z]:/

/** 디바운스 윈도(ms). 연속/대량 변경(예: 1000개 일괄 복사)을 1~수회로 병합. */
const DEBOUNCE_MS = 250

/** 폴링 주기(ms). 3~5s 권장 중앙값 — 네트워크 readdir 비용과 반응성의 균형. */
const POLL_INTERVAL_MS = 4000

/** 대량 디렉토리 가드: 초과 시 폴링 비활성 + onError 1회 안내(수동 새로고침 유지, 변경 누락 회피). */
const POLL_MAX_ENTRIES = 20_000

export interface WatchCallbacks {
  /** 디바운스·병합 후 1회(현재 디렉토리 변경 신호). path = 감시 대상 경로. */
  onEvent: (path: string) => void
  /** 감시 불가(권한·네트워크·미지원). 격리 — 렌더러는 수동 새로고침 유지. */
  onError: (error: FileOpError) => void
}

/** fs.watch 시그니처(주입용). non-recursive 리스너만 사용. */
type WatchFn = (
  path: string,
  opts: { recursive: boolean },
  listener: () => void
) => FSWatcher

/** 원격(폴링 eager) 경로 판정(주입용). */
type IsRemoteFn = (path: string) => boolean

export interface WatchServiceOptions {
  /** 기본 = node:fs.watch(실모듈). verify 헤드리스가 throw 스텁 주입에 사용. */
  watchFn?: WatchFn
  /** 기본 = paths.isLikelyRemotePath(실모듈). verify 헤드리스가 eager 강제에 사용. */
  isRemoteFn?: IsRemoteFn
}

/** 폴링 스냅샷 1항목 식별 키: `${size}:${mtimeMs}`. name → 키. */
type PollSnapshot = Map<string, string>

interface ActiveWatch {
  watchId: string
  path: string
  /** 정상 시작된 fs.watch 핸들. 폴링 모드거나 start 가 실패(격리)했으면 null(stop 멱등). */
  watcher: FSWatcher | null
  /** 디바운스 타이머(병합). watch·poll 공용. */
  debounceTimer: NodeJS.Timeout | null
  /** 폴링 인터벌(폴링 모드일 때만). watch 모드는 null. */
  pollTimer: NodeJS.Timeout | null
  /** 직전 폴링 스냅샷(diff 기준). 초기 스냅샷 전엔 null. */
  pollSnapshot: PollSnapshot | null
  /** readdir 진행 중 재진입 가드(느린 네트워크 readdir 겹침/중복 발화 방지). */
  pollBusy: boolean
  /** 현재 모드. 진단·검증용. */
  mode: 'watch' | 'poll'
  cb: WatchCallbacks
}

export class WatchService {
  private readonly watches = new Map<string, ActiveWatch>()
  private readonly watchFn: WatchFn
  private readonly isRemoteFn: IsRemoteFn

  /**
   * @param opts.watchFn   fs.watch 대체(기본=실모듈). 헤드리스 검증에서 throw 스텁 주입.
   * @param opts.isRemoteFn 원격(eager 폴링) 판정 대체(기본=isLikelyRemotePath). 헤드리스 강제용.
   */
  constructor(opts: WatchServiceOptions = {}) {
    this.watchFn = opts.watchFn ?? fsWatch
    this.isRemoteFn = opts.isRemoteFn ?? defaultIsRemote
  }

  /**
   * 감시 시작. 경로가 디렉토리여야 하며(파일·미존재·빈 경로 거부), fs.watch 실패(권한·
   * 네트워크·미지원)는 throw 0 으로 격리한다 — 폴링으로 폴백하거나 onError 후 watchId 만 발급한다.
   * @param path 핸들러에서 정규화·상위이탈 차단 완료된 절대 경로.
   * @returns watchId(randomUUID). 격리된 실패·폴링 폴백에서도 watchId 는 발급(stop 멱등).
   */
  start(path: string, cb: WatchCallbacks): string {
    const watchId = randomUUID()
    const entry: ActiveWatch = {
      watchId,
      path,
      watcher: null,
      debounceTimer: null,
      pollTimer: null,
      pollSnapshot: null,
      pollBusy: false,
      mode: 'watch',
      cb
    }
    this.watches.set(watchId, entry)

    // 빈 경로("내 PC")·미존재·파일 경로는 감시 거부 — start 시 stat 으로 디렉토리 검증.
    if (path.length === 0) {
      cb.onError(fileOpError('EINVAL', '감시할 경로가 비어 있습니다.', path))
      return watchId
    }
    try {
      const st = statSync(path)
      if (!st.isDirectory()) {
        cb.onError(fileOpError('ENOTDIR', '감시 대상이 폴더가 아닙니다.', path))
        return watchId
      }
    } catch (e) {
      cb.onError(toFileOpError(e, path))
      return watchId
    }

    // lazy refresh trigger(J2): 드라이브 루트(X:\) 경로인데 아직 원격으로 안 잡혔으면(캐시 미확정
    // /미등록), 다음 진입의 정확성을 위해 driveTypeService 캐시 갱신을 fire-and-forget 트리거한다.
    // throttle·재진입 가드는 서비스 내부 — 남발 무해. 현재 start 판정은 캐시 현재값으로 동기 유지
    // (첫 진입 reactive, refresh 반영 후 차순 eager — 점진적 정확성).
    if (DRIVE_ROOT_PATH.test(path) && !this.isRemoteFn(path)) {
      void driveTypeService.refresh()
    }

    // eager 폴링: UNC·매핑 네트워크 드라이브는 fs.watch 를 시도하지 않고 처음부터 폴링.
    if (this.isRemoteFn(path)) {
      this.startPolling(entry)
      return watchId
    }

    // 로컬 경로: fs.watch 시도 → throw 또는 워처 error 시 폴링으로 폴백(reactive).
    try {
      const watcher = this.watchFn(path, { recursive: false }, () => {
        this.schedule(entry)
      })
      // 워처 자체 error 이벤트(런타임 실패: 네트워크 끊김·미지원 FS) → 폴링 폴백.
      watcher.on('error', (e) => {
        this.fallbackToPolling(entry, e)
      })
      entry.watcher = watcher
      entry.mode = 'watch'
    } catch (e) {
      // start 자체 throw(예: ENOSYS·ENOTSUP·EPERM) — 격리 후 폴링 폴백.
      this.fallbackToPolling(entry, e)
    }
    return watchId
  }

  /** 디바운스·병합: 윈도 내 연속 change/rename(또는 폴링 diff)을 1회 onEvent 로 모은다. */
  private schedule(entry: ActiveWatch): void {
    if (entry.debounceTimer) clearTimeout(entry.debounceTimer)
    entry.debounceTimer = setTimeout(() => {
      entry.debounceTimer = null
      // 디바운스 만료 사이 stop 됐으면(맵에서 제거) 발화하지 않는다.
      if (this.watches.has(entry.watchId)) entry.cb.onEvent(entry.path)
    }, DEBOUNCE_MS)
  }

  /**
   * fs.watch 실패(throw/error)를 폴링으로 폴백 전환한다. 투명 — onEvent/onError 시그니처 동일.
   * 이미 stop 된 entry 는 무시(비동기 error 가 stop 이후 도착 가능).
   */
  private fallbackToPolling(entry: ActiveWatch, _cause: unknown): void {
    if (!this.watches.has(entry.watchId)) return
    if (entry.watcher) {
      try {
        entry.watcher.close()
      } catch {
        // close 실패는 무시(이미 닫힌/끊긴 핸들).
      }
      entry.watcher = null
    }
    // 이미 폴링 중이면 중복 시작 방지.
    if (entry.pollTimer) return
    this.startPolling(entry)
  }

  /** 폴링 시작: 초기 스냅샷 1회(이벤트 미발화 — 현재 상태 = 기준선) 후 인터벌 diff. */
  private startPolling(entry: ActiveWatch): void {
    entry.mode = 'poll'
    // 초기 스냅샷은 통지하지 않는다(start 직후 가짜 이벤트 0).
    void this.pollOnce(entry, /* notify */ false)
    entry.pollTimer = setInterval(() => {
      void this.pollOnce(entry, true)
    }, POLL_INTERVAL_MS)
  }

  /**
   * readdir(name+size+mtime) 스냅샷 → 직전과 diff. 변경 시 schedule(디바운스) 경유 onEvent 1회.
   * - 초기 호출(notify=false): 기준선만 설정.
   * - 재진입 가드(pollBusy): 느린 readdir 겹침/중복 발화 방지.
   * - 대량 디렉토리(>POLL_MAX_ENTRIES): 폴링 비활성 + onError 1회(부분 스냅샷의 변경 누락 회피).
   * - stat 간헐 실패: 이전 스냅샷 값 승계(없으면 '?') — 글리치가 가짜 diff 를 내지 않게.
   */
  private async pollOnce(entry: ActiveWatch, notify: boolean): Promise<void> {
    if (entry.pollBusy) return
    if (!this.watches.has(entry.watchId)) return
    entry.pollBusy = true
    try {
      const dirents = await fsp.readdir(entry.path, { withFileTypes: true })
      if (!this.watches.has(entry.watchId)) return // 비동기 readdir 중 stop 됐으면 중단.

      // 대량 디렉토리: 부분 스냅샷으로 "변경 누락"을 내느니 폴링을 끄고 1회 안내(수동 새로고침 유지).
      if (dirents.length > POLL_MAX_ENTRIES) {
        this.stopPolling(entry)
        // FileOpErrorCode 에 대용량 전용 코드가 없어 EUNKNOWN(일반)으로 안내 메시지만 명확히.
        entry.cb.onError(
          fileOpError(
            'EUNKNOWN',
            `항목이 너무 많아(${dirents.length}) 자동 갱신을 끕니다. 수동 새로고침을 사용하세요.`,
            entry.path
          )
        )
        return
      }

      const prev = entry.pollSnapshot
      const snap: PollSnapshot = new Map()
      for (const d of dirents) {
        try {
          const st = await fsp.stat(join(entry.path, d.name))
          snap.set(d.name, `${st.size}:${Math.trunc(st.mtimeMs)}`)
        } catch {
          // stat 간헐 실패(네트워크 글리치 등): 이전 값 승계(내용 변화 없음으로 간주),
          // 이전 값 없으면 '?'(신규 항목 표시). 다음 사이클 stat 성공 시 실제 값으로 갱신.
          snap.set(d.name, prev?.get(d.name) ?? '?')
        }
      }
      if (!this.watches.has(entry.watchId)) return // stat 루프(비동기) 중 stop.
      entry.pollSnapshot = snap

      if (notify && prev && this.diff(prev, snap)) {
        // watch 경로와 동일하게 디바운스 경유(중복·연속 변경 병합).
        this.schedule(entry)
      }
    } catch (e) {
      // readdir 실패(경로 사라짐·권한) → 폴링 중단 + onError 격리(수동 새로고침 유지).
      this.stopPolling(entry)
      entry.cb.onError(toFileOpError(e, entry.path))
    } finally {
      entry.pollBusy = false
    }
  }

  /** 스냅샷 diff: 키 집합(추가/삭제/rename) 또는 값(size/mtime) 변경 여부. */
  private diff(a: PollSnapshot, b: PollSnapshot): boolean {
    if (a.size !== b.size) return true
    for (const [k, v] of b) if (a.get(k) !== v) return true
    return false
  }

  /** 폴링 인터벌 정리(멱등). 모드와 무관 — pollTimer 가 있으면 해제. */
  private stopPolling(entry: ActiveWatch): void {
    if (entry.pollTimer) {
      clearInterval(entry.pollTimer)
      entry.pollTimer = null
    }
  }

  /** 감시 중지(멱등). 모르는/이미 중지된 watchId 도 무해. watch·poll 모두 동일 정리 경로. */
  stop(watchId: string): void {
    const entry = this.watches.get(watchId)
    if (!entry) return
    this.watches.delete(watchId)
    if (entry.debounceTimer) {
      clearTimeout(entry.debounceTimer)
      entry.debounceTimer = null
    }
    this.stopPolling(entry) // 폴링 인터벌 정리(좀비 인터벌 0).
    if (entry.watcher) {
      try {
        entry.watcher.close()
      } catch {
        // close 실패는 무시(이미 닫힘/끊긴 핸들).
      }
      entry.watcher = null
    }
  }

  /** 특정 sender(WebContents)의 watchId 일괄 중지 — wc 파괴/렌더 프로세스 종료 시 누수 방지. */
  stopAllForSender(watchIds: Iterable<string>): void {
    for (const id of watchIds) this.stop(id)
  }

  /** 전체 중지(창 종료/before-quit). 좀비 핸들·인터벌 0 보장. */
  stopAll(): void {
    for (const id of [...this.watches.keys()]) this.stop(id)
  }

  /** 현재 활성 감시 수(검증·누수 점검용). */
  activeCount(): number {
    return this.watches.size
  }
}

/** 싱글턴(핸들러가 공유). 옵션 없이 생성 = 실모듈(fs.watch · isLikelyRemotePath). */
export const watchService = new WatchService()
