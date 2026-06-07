/**
 * OS 파일 아이콘 추출 + 키 단위 LRU 캐시 (shell:icon, H6 · ADR-005).
 *
 * 읽기 전용(dataUrl)만 노출 — 실행 표면 없음. 호출부(shell.handlers)는 항상
 * 검증된 실존 path 를 넘긴다. app.getFileIcon 은 실존 파일 경로를 요구하므로
 * ext-only 추출은 하지 않고, 캐시 키만 다음 규칙으로 환원한다(키 ≠ 추출 입력):
 *   · 폴더 합성요청('__dir__')      → 키 '__dir__'
 *   · 드라이브 합성요청('__drive__') → 키 '__drive__'
 *   · per-file 고유 아이콘(exe/lnk/ico/cur/ani/msc/scr) → 'path:<path>'
 *   · 그 외 일반 파일               → 'ext:<win32.extname(path) 소문자>'
 *
 * 추출/조회 실패(예외·빈 이미지·null)는 캐시에 저장하지 않는다(영구 폴백 방지 —
 * 같은 키의 다음 가시 항목 경로로 재시도 가능). LRU 상한 512(성공 항목만 카운트).
 */
import { win32 } from 'node:path'
import { app } from 'electron'

export interface IconResult {
  readonly dataUrl: string
}

/** per-file 고유 아이콘 확장자(파일마다 다른 아이콘 — path 키로 분리 캐시). */
const PER_FILE_EXT = new Set(['exe', 'lnk', 'ico', 'cur', 'ani', 'msc', 'scr'])

/** LRU 상한(엔트리 수). 초과 시 가장 오래된 키 evict. */
const MAX_ICON_CACHE = 512

/** key → dataUrl 캐시. Map 삽입순을 LRU 순서로 사용(get 시 재삽입으로 최신화). */
const cache = new Map<string, string>()

interface IconReq {
  readonly path: string
  readonly ext?: '__dir__' | '__drive__'
}

/**
 * 캐시 키 환원. 추출 입력(실존 path)과 분리된, 키 공유를 위한 정규화 규칙.
 *   __dir__/__drive__ 합성요청 → 해당 합성키
 *   per-file 확장자 → path:<path>, 그 외 → ext:<ext>(확장자 없으면 ext: 빈 키)
 */
export function cacheKeyFor(req: IconReq): string {
  if (req.ext === '__dir__') return '__dir__'
  if (req.ext === '__drive__') return '__drive__'
  const ext = win32.extname(req.path).slice(1).toLowerCase()
  if (PER_FILE_EXT.has(ext)) return `path:${req.path}`
  return `ext:${ext}`
}

/** LRU get — 존재 시 재삽입으로 최신화. */
function lruGet(key: string): string | undefined {
  const v = cache.get(key)
  if (v === undefined) return undefined
  cache.delete(key)
  cache.set(key, v)
  return v
}

/** LRU set — 상한 초과 시 가장 오래된(첫) 키 evict. 성공 dataUrl 만 저장. */
function lruSet(key: string, dataUrl: string): void {
  if (cache.has(key)) cache.delete(key)
  cache.set(key, dataUrl)
  if (cache.size > MAX_ICON_CACHE) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
}

/**
 * 검증된 실존 path(+선택 합성키 힌트)로 dataUrl 추출. throw 금지.
 * 캐시 HIT 시 즉시 반환. MISS 시 app.getFileIcon 으로 추출 →
 * 성공(비어있지 않은 NativeImage) → dataUrl 저장·반환,
 * 실패(예외·빈 이미지) → null(캐시 미저장 — 영구 폴백 방지).
 */
export async function getFileIconDataUrl(req: IconReq): Promise<string | null> {
  const key = cacheKeyFor(req)
  const cached = lruGet(key)
  if (cached !== undefined) return cached

  try {
    // 합성키/일반 모두 추출 입력은 요청의 실존 path. 폴더/드라이브는 첫 1회만
    // 추출 후 합성 키로 캐시 → 전 폴더/드라이브가 공유.
    const img = await app.getFileIcon(req.path, { size: 'small' })
    if (img.isEmpty()) return null
    const dataUrl = img.toDataURL()
    if (!dataUrl) return null
    lruSet(key, dataUrl)
    return dataUrl
  } catch {
    // 추출 실패(권한 일시 거부·경로 레이스 등): 캐시 미저장 → 다음 실존 경로로 재시도.
    return null
  }
}

/** 테스트/진단용 — 현재 캐시 엔트리 수(상한 검증). */
export function iconCacheSize(): number {
  return cache.size
}
