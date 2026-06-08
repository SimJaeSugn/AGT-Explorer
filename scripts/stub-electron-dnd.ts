/**
 * verify-dnd 전용 electron 스텁(헤드리스).
 *
 * os/dragdrop.ts 가 닿는 `nativeImage`(createFromDataURL/createFromPath)와 dnd.handlers.ts 의
 * `app.getFileIcon`만 제어 가능한 페이크로 제공한다. 실제 네이티브/네트워크/GUI 미경유.
 *
 * - nativeImage: dataUrl/path 의 "비어있음" 여부만 모델링(빈 문자열·존재하지 않는 표식 → isEmpty()).
 * - app.getFileIcon: 본 verify 는 handlers 의 기본 추출을 쓰지 않고 주입(getIconDataUrl)으로 제어하므로
 *   여기서는 안전한 빈 이미지 기본 동작만 둔다(폴백 경로 검증용).
 */
interface FakeNativeImage {
  isEmpty(): boolean
  toDataURL(): string
  __src: string
}

function makeImage(src: string): FakeNativeImage {
  // 빈 문자열·'__EMPTY__' 표식 → 빈 이미지로 간주. 그 외(유효 dataUrl/존재 경로) → 비어있지 않음.
  const empty = src === '' || src === '__EMPTY__'
  return {
    __src: src,
    isEmpty: () => empty,
    toDataURL: () => (empty ? '' : src)
  }
}

export const nativeImage = {
  createFromDataURL(dataUrl: string): FakeNativeImage {
    return makeImage(dataUrl)
  },
  createFromPath(p: string): FakeNativeImage {
    // verify 는 실 리소스 미주입(존재하지 않는 경로) → 빈 이미지 → 내장 base64 폴백 경로 검증.
    if (p.includes('__MISSING__')) return makeImage('__EMPTY__')
    return makeImage(`file-icon:${p}`)
  }
}

export const app = {
  async getFileIcon(_p: string, _o: { size: string }): Promise<FakeNativeImage> {
    return makeImage('') // 기본은 빈 이미지(폴백). verify 는 getIconDataUrl 주입으로 별도 제어.
  }
}

/** dnd.handlers.ts 가 모듈 로드 시 import 하지만 registerDndHandlers 미호출 → no-op. */
export const ipcMain = {
  handle(_channel: string, _fn: (...args: unknown[]) => unknown): void {
    /* no-op (verify 는 핸들러 등록 미사용) */
  }
}
