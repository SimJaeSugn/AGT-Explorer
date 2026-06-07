/**
 * 그리드 이미지 썸네일 서비스 (feat-L1 · preview:thumbnail).
 *
 * 검증된 실존 path + size 버킷 → 실제 이미지 내용을 축소한 dataUrl(또는 폴백 null).
 * icon.ts(LRU·실패 비캐싱)·driveType.ts(헤드리스 주입) 패턴을 모사한다. 읽기 전용
 * dataUrl 만 노출 — 파일 바이트/blob URL 미노출(CSP `data:` 허용 범위, readPreview/icon 선례).
 *
 * 정책:
 *   · 크기 상한: fs.stat size > THUMB_MAX_BYTES(30MB) → null(생성 스킵·폴백). 단일 대용량
 *     디코드가 main 이벤트루프를 길게 점유하는 것을 막는 1차 방어선이다.
 *   · 디코드: nativeImage.createFromPath(path)(동기) → isEmpty()/예외 → null. 미지원 형식
 *     (webp 는 Electron/Chromium 버전 따라 가변·svg/tiff)·손상은 isEmpty/예외로 자연 폴백.
 *   · 비율 보존 resize: getSize() 종횡비로 **긴 변 = size 단일 축**만 지정한다
 *     (w>=h ? {width:size} : {height:size}). 정사각 {width,height} 동시 지정은 **왜곡**되므로
 *     쓰지 않는다 — 짧은 변은 nativeImage 가 비율 유지로 산출한다. quality 'good'.
 *   · LRU(256): `${path}::${size}` 키. **실패(null/예외)는 캐시 미저장**(icon.ts 정책 —
 *     영구 폴백 방지, 같은 셀 재요청 시 재시도 가능). frontend 의 negCache(실패 path 재요청
 *     억제)와 역할 분리: backend 는 실패 비캐싱이 정책이다.
 *   · 세마포어(4): createFromPath/resize 가 동기이므로 **병렬이 아니라** 연속 폭주 디코드의
 *     동시 진입을 4로 제한해 **직렬화·시간분산**한다(이벤트루프 점유를 토막낸다). 단일 대용량
 *     블로킹의 1차 방어는 위 30MB 상한이다 — 세마포어가 단일 호출을 비차단으로 만들진 않는다.
 *
 * 헤드리스 검증성: deps(statSize/decodeResize) 주입으로 nativeImage 미경유 스텁이 가능하다
 * (PowerShell/네이티브 없이 verify). gif=첫 프레임·ico=대표 사이즈 1장으로 nativeImage 가
 * 정상 처리한다(애니메이션/멀티사이즈 선택은 비스코프).
 */
import * as fsp from 'node:fs/promises'
import { nativeImage } from 'electron'

export interface ThumbnailResult {
  readonly dataUrl: string | null
}

/** 파일 크기 상한(byte). 초과 → 폴백(생성 스킵). 단일 대용량 디코드 블로킹 1차 방어. */
const THUMB_MAX_BYTES = 30 * 1024 * 1024

/** LRU 상한(엔트리 수). 초과 시 가장 오래된 키 evict. 성공 dataUrl 만 카운트. */
const MAX_THUMB_CACHE = 256

/** main 동시 디코드 상한(세마포어). 연속 폭주 시 직렬화·시간분산(병렬 아님 — 동기 디코드). */
const THUMB_CONCURRENCY = 4

/**
 * 헤드리스 주입 의존성. 기본은 실제 fs.stat / nativeImage 경로.
 * verify 가 스텁을 주입해 nativeImage 미경유로 폴백 매트릭스·LRU·세마포어를 검증한다.
 */
export interface ThumbnailServiceDeps {
  /** 파일 크기(byte). 기본 = fsp.stat().size. 실패 시 throw → getThumbnailDataUrl 이 null 흡수. */
  readonly statSize: (path: string) => Promise<number>
  /** path → 비율 보존 축소 dataUrl|null. 기본 = nativeImage 경로. throw 가능(null 흡수). */
  readonly decodeResize: (path: string, size: number) => string | null
}

/** 캐시 키 = `${path}::${size}` (path 별 고유 — ext 공유 불가). */
export function thumbnailKeyFor(path: string, size: number): string {
  return `${path}::${size}`
}

// ── LRU(icon.ts lruGet/lruSet 복제 — Map 삽입순 = LRU 순서) ───────────────
const cache = new Map<string, string>()

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
  if (cache.size > MAX_THUMB_CACHE) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
}

// ── 경량 세마포어(외부 의존 0) — 동시 진입 ≤ THUMB_CONCURRENCY ──────────────
let active = 0
const waiters: Array<() => void> = []

function acquire(): Promise<void> {
  if (active < THUMB_CONCURRENCY) {
    active++
    return Promise.resolve()
  }
  return new Promise<void>((resolve) => {
    waiters.push(() => {
      active++
      resolve()
    })
  })
}

function release(): void {
  active--
  const next = waiters.shift()
  if (next) next()
}

/**
 * 기본 디코드: nativeImage 로 path 를 읽어 **비율 보존(긴 변=size 단일 축)** 으로 축소한 dataUrl.
 * isEmpty()(미지원/손상)·빈 url → null. 동기(createFromPath/resize/toDataURL 모두 동기).
 *
 * 비율 보존 근거: getSize() 종횡비로 긴 변만 지정하면 nativeImage 가 짧은 변을 비율 유지로
 * 산출한다. {width,height} 동시 지정은 정사각 강제 = **왜곡**이므로 쓰지 않는다.
 */
function defaultDecodeResize(path: string, size: number): string | null {
  const img = nativeImage.createFromPath(path) // 동기
  if (img.isEmpty()) return null // 미지원/손상 → 폴백
  const { width, height } = img.getSize()
  // 종횡비 보존: 긴 변을 size 로 맞추고 짧은 변은 nativeImage 가 비율 유지.
  const resized =
    width >= height
      ? img.resize({ width: size, quality: 'good' })
      : img.resize({ height: size, quality: 'good' })
  const url = resized.toDataURL()
  return url || null
}

const defaultStatSize = async (path: string): Promise<number> => (await fsp.stat(path)).size

/**
 * 검증된 실존 path + **size 버킷(핸들러 zThumbnailReq 가 보장)** → dataUrl|null. throw 금지.
 *   1) 캐시 HIT → 즉시 반환
 *   2) statSize > THUMB_MAX_BYTES → null(캐시 안 함)
 *   3) 세마포어 acquire → decodeResize → isEmpty/예외/빈 url → null(캐시 안 함)
 *   4) 성공 dataUrl → lruSet 후 반환
 *
 * size 는 호출 전 핸들러 가드(THUMB_SIZE_BUCKETS 화이트리스트)를 통과한 값을 전제로 한다.
 */
export async function getThumbnailDataUrl(
  req: { path: string; size: number },
  deps?: Partial<ThumbnailServiceDeps>
): Promise<string | null> {
  const statSize = deps?.statSize ?? defaultStatSize
  const decodeResize = deps?.decodeResize ?? defaultDecodeResize

  const key = thumbnailKeyFor(req.path, req.size)
  const cached = lruGet(key)
  if (cached !== undefined) return cached

  // 크기 상한 — 디코드 전에 차단(대용량 블로킹 1차 방어). stat 실패는 폴백(null).
  try {
    const bytes = await statSize(req.path)
    if (bytes > THUMB_MAX_BYTES) return null // 대용량 → 캐시 안 함
  } catch {
    return null // 미존재·권한·레이스 → 폴백(캐시 안 함)
  }

  await acquire()
  try {
    const url = decodeResize(req.path, req.size)
    if (!url) return null // isEmpty/빈 url → 폴백(캐시 안 함)
    lruSet(key, url) // 성공만 캐시
    return url
  } catch {
    return null // 디코드 예외(권한·레이스·미지원) → 폴백(캐시 안 함)
  } finally {
    release()
  }
}

/** 테스트/진단용 — 현재 캐시 엔트리 수(LRU 상한 검증). */
export function thumbnailCacheSize(): number {
  return cache.size
}
