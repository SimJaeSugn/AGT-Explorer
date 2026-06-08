/**
 * verify-clipboard-hdrop 전용 electron 스텁(헤드리스).
 *
 * `os/shellClipboard.ts` 가 모듈 최상위에서 `import { clipboard } from 'electron'`
 * 하므로 번들이 성립하도록 clipboard 표면(writeBuffer/readBuffer/has/clear/writeText)을
 * 인메모리 포맷 맵으로 구현한다. 이로써 write→read 왕복(왕복 effect 보존)을 실제
 * clipboard IO 경로로 검증할 수 있다(네이티브 미경유).
 *
 * 더해 __injectBuffer 로 **외부 앱(탐색기)이 올린 것처럼** 임의 포맷 buffer 를 직접
 * 주입해, 표준/손상 CF_HDROP 의 파싱·방어적 폴백을 헤드리스로 검증한다.
 */
const store = new Map<string, Buffer>()
let lastText = ''

export const clipboard = {
  clear(): void {
    store.clear()
    lastText = ''
  },
  has(format: string): boolean {
    return store.has(format)
  },
  writeBuffer(format: string, buffer: Buffer): void {
    store.set(format, Buffer.from(buffer))
  },
  readBuffer(format: string): Buffer {
    const b = store.get(format)
    // Electron 은 미존재 포맷에 빈 Buffer 를 반환 — 동작 모사.
    return b ? Buffer.from(b) : Buffer.alloc(0)
  },
  writeText(text: string): void {
    lastText = text
  },
  readText(): string {
    return lastText
  }
}

// ── 테스트 주입 헬퍼 ──────────────────────────────────────────────────────
/** 외부 앱이 올린 것처럼 임의 포맷 buffer 를 클립보드에 주입한다. */
export function __injectBuffer(format: string, buffer: Buffer): void {
  store.set(format, Buffer.from(buffer))
}
/** 클립보드 전체 비우기(테스트 격리). */
export function __resetClipboard(): void {
  store.clear()
  lastText = ''
}
