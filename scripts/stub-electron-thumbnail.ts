/**
 * verify-thumbnail 전용 electron 스텁(헤드리스).
 *
 * os/thumbnail.ts 가 모듈 최상위에서 `import { nativeImage } from 'electron'` 하므로
 * 번들이 성립하도록 최소 표면만 제공한다. **단, verify 는 getThumbnailDataUrl 에
 * decodeResize/statSize 스텁(deps)을 주입**해 이 nativeImage 를 경유하지 않고 폴백
 * 매트릭스·비율 보존 축 선택·LRU·세마포어를 검증한다(네이티브 미경유).
 *
 * 그래도 기본 decodeResize 경로의 비율 보존 축 선택 로직을 직접 검증할 수 있도록
 * createFromPath 동작을 __setNativeImageBehavior 로 제어 가능하게 둔다.
 */
interface FakeImage {
  isEmpty(): boolean
  getSize(): { width: number; height: number }
  resize(opts: { width?: number; height?: number; quality?: string }): FakeImage
  toDataURL(): string
}

interface Behavior {
  empty: boolean
  width: number
  height: number
}

let behavior: Behavior = { empty: false, width: 100, height: 50 }
/** 마지막 resize 호출에 전달된 옵션(축 선택 검증용). */
let lastResizeOpts: { width?: number; height?: number; quality?: string } | null = null

export function __setNativeImageBehavior(b: Partial<Behavior>): void {
  behavior = { ...behavior, ...b }
}
export function __getLastResizeOpts(): { width?: number; height?: number; quality?: string } | null {
  return lastResizeOpts
}
export function __resetNativeImage(): void {
  behavior = { empty: false, width: 100, height: 50 }
  lastResizeOpts = null
}

function makeImage(): FakeImage {
  const img: FakeImage = {
    isEmpty: () => behavior.empty,
    getSize: () => ({ width: behavior.width, height: behavior.height }),
    resize: (opts) => {
      lastResizeOpts = opts
      return img
    },
    toDataURL: () => (behavior.empty ? '' : 'data:image/png;base64,FAKE_NATIVE')
  }
  return img
}

export const nativeImage = {
  createFromPath(_path: string): FakeImage {
    return makeImage()
  }
}
