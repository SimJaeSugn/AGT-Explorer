/**
 * 세션 스냅샷 영속 store (session:load/save, SA §5.1~5.3).
 *
 * - session.json 에 SessionSnapshot 저장(열린 창/탭/레이아웃/패널 경로/정렬·보기·
 *   히스토리·사이드바 즐겨찾기·최근). 휘발 상태(선택·진행작업·closedHistory·
 *   드래그·rename)는 SessionSnapshot 구조에 애초에 없으므로 직렬화되지 않는다.
 * - 저장은 디바운스(기본 1초)로 합쳐 쓰고, before-quit 등에서 flush() 로 즉시 기록.
 *   변경 시점마다 직전 스냅샷이 디스크에 남으므로 정상·비정상 종료 모두 복원.
 * - 모든 쓰기 원자적(temp→rename) → 쓰기 중 크래시에도 파일 무손상(SA §5.2).
 * - 로드 시 손상/구버전 → 안전 폴백("내 PC" 빈 windows) 부팅(SA §5.3).
 */
import { readJsonSafe, writeJsonAtomic } from './atomic'
import { coerceSession } from './defaults'
import type { PersistencePaths } from './paths'
import type { SessionSnapshot } from '@shared/dto'

const DEFAULT_DEBOUNCE_MS = 1000

export class SessionStore {
  private pending: SessionSnapshot | null = null
  private timer: ReturnType<typeof setTimeout> | null = null

  /**
   * @param paths 영속 파일 위치.
   * @param getRecentLimit settings 의 recentLimit 공급자(최근 목록 슬라이스).
   * @param debounceMs 자동 저장 디바운스(테스트는 0 으로 즉시 flush 가능).
   */
  constructor(
    private readonly paths: PersistencePaths,
    private readonly getRecentLimit: () => number,
    private readonly debounceMs: number = DEFAULT_DEBOUNCE_MS
  ) {}

  /** 디스크에서 세션을 로드·정규화(손상/구버전 → 안전 폴백). */
  async load(): Promise<SessionSnapshot> {
    const raw = await readJsonSafe<unknown>(this.paths.session)
    return coerceSession(raw, this.getRecentLimit())
  }

  /**
   * 스냅샷 저장을 디바운스 예약한다. 연속 변경은 마지막 1건으로 합쳐진다.
   * debounceMs=0 이면 즉시 기록한다.
   */
  async save(snapshot: SessionSnapshot): Promise<void> {
    this.pending = snapshot
    if (this.debounceMs <= 0) {
      await this.flush()
      return
    }
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      void this.flush()
    }, this.debounceMs)
  }

  /**
   * 보류 중인 스냅샷을 즉시 원자적으로 기록한다(before-quit·종료 직전).
   * 보류분이 없으면 무시한다. 반환: 실제로 기록했는지.
   */
  async flush(): Promise<boolean> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const snapshot = this.pending
    if (!snapshot) return false
    this.pending = null
    return writeJsonAtomic(this.paths.session, snapshot)
  }

  /** 보류 중인 저장이 있는지(종료 훅에서 flush 필요 판정). */
  hasPending(): boolean {
    return this.pending !== null
  }
}
