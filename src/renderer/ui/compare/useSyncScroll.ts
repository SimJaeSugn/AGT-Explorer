/**
 * useSyncScroll — 좌/우 비교 패널 스크롤 동기 컨트롤러 (§P1·F20).
 *
 * 비교 뷰는 좌/우를 **같은 행 인덱스로 짝지어** 렌더하므로(짝 없는 쪽은
 * placeholder 행), 두 스크롤 컨테이너의 scrollTop 을 그대로 미러하면 행이 정렬된다.
 * syncScroll=false 면 각자 독립 스크롤.
 *
 * 재진입(피드백 루프) 방지: 한쪽 onScroll 이 다른쪽 scrollTop 을 세팅하면 그쪽
 * onScroll 이 다시 발화하므로, 직전 프로그램적 설정을 플래그로 1틱 무시한다.
 */
import { useCallback, useRef } from 'react'

export interface SyncScrollControl {
  /** 좌 컨테이너 ref 콜백. */
  readonly leftRef: (el: HTMLDivElement | null) => void
  /** 우 컨테이너 ref 콜백. */
  readonly rightRef: (el: HTMLDivElement | null) => void
  /** 좌 컨테이너 onScroll 핸들러. */
  readonly onLeftScroll: () => void
  /** 우 컨테이너 onScroll 핸들러. */
  readonly onRightScroll: () => void
}

export function useSyncScroll(enabled: boolean): SyncScrollControl {
  const leftEl = useRef<HTMLDivElement | null>(null)
  const rightEl = useRef<HTMLDivElement | null>(null)
  // 프로그램적 스크롤 적용 중 플래그(상대측 onScroll 무시).
  const suppress = useRef(false)

  const leftRef = useCallback((el: HTMLDivElement | null) => {
    leftEl.current = el
  }, [])
  const rightRef = useCallback((el: HTMLDivElement | null) => {
    rightEl.current = el
  }, [])

  const mirror = useCallback(
    (from: HTMLDivElement | null, to: HTMLDivElement | null) => {
      if (!enabled || !from || !to) return
      if (suppress.current) {
        suppress.current = false
        return
      }
      if (to.scrollTop === from.scrollTop) return
      suppress.current = true
      to.scrollTop = from.scrollTop
    },
    [enabled]
  )

  const onLeftScroll = useCallback(() => mirror(leftEl.current, rightEl.current), [mirror])
  const onRightScroll = useCallback(() => mirror(rightEl.current, leftEl.current), [mirror])

  return { leftRef, rightRef, onLeftScroll, onRightScroll }
}
