/**
 * verify-shell-h4h6 전용 electron 스텁(헤드리스).
 *
 * src/main/os/icon.ts 가 닿는 `app.getFileIcon` 만 제어 가능한 페이크로 제공한다.
 * 테스트가 __setIconBehavior 로 다음 호출의 결과(정상/빈/예외)를 지정하고,
 * __getIconCalls 로 추출 호출 횟수를 단언한다(키 공유·디듀프 검증).
 */
interface FakeNativeImage {
  isEmpty(): boolean
  toDataURL(): string
}

type Behavior = 'ok' | 'empty' | 'throw'
let behavior: Behavior = 'ok'
let dataUrlSeq = 0
let calls = 0

export function __setIconBehavior(b: Behavior): void {
  behavior = b
}
export function __getIconCalls(): number {
  return calls
}
export function __resetIcon(): void {
  behavior = 'ok'
  dataUrlSeq = 0
  calls = 0
}

export const app = {
  async getFileIcon(_path: string, _opts: { size: string }): Promise<FakeNativeImage> {
    calls++
    if (behavior === 'throw') throw new Error('getFileIcon 실패(헤드리스 페이크)')
    const empty = behavior === 'empty'
    const url = empty ? '' : `data:image/png;base64,FAKE${dataUrlSeq++}`
    return {
      isEmpty: () => empty,
      toDataURL: () => url
    }
  }
}
