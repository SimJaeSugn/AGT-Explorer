/**
 * domain/image — 그리드 썸네일 대상 판정 + size 버킷 산출(feat-L1, 계획서 §5.1·§5.2).
 *
 * 순수 상수/함수(부수효과·IPC 없음). FileListView(ThumbnailIcon)가 (a) 어떤 entry 가
 * 썸네일 시도 대상인지, (b) 셀 아이콘 px·DPR 로부터 어떤 size 버킷을 요청할지 결정한다.
 *
 * 버킷은 backend guard(`zThumbnailReq`)의 `THUMB_SIZE_BUCKETS = [32,48,64,96,128]` 와
 * **동일 출처**여야 한다(임의 size 는 zod refine 에서 거부됨). 이 값을 벗어나면 요청이
 * 입구에서 err 로 폴백 → OSIcon 으로 떨어지므로, 셀 아이콘(64/48/32)×DPR(≤2) 결과가
 * 항상 버킷에 스냅되도록 thumbSizeFor 가 보장한다.
 */

/** nativeImage 시도 대상 래스터 확장자(소문자, 선행 '.' 제외). webp/ico 는 시도하되 실패 시 폴백. */
const THUMBNAIL_EXTS: ReadonlySet<string> = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'bmp',
  'ico',
  'webp'
])

/** 썸네일 size 화이트리스트 버킷(backend guard THUMB_SIZE_BUCKETS 와 단일 출처). 오름차순. */
export const THUMB_SIZE_BUCKETS: readonly number[] = [32, 48, 64, 96, 128]

/** 확장자(소문자, '.' 제외)가 썸네일 시도 대상 래스터 형식인지. */
export function isThumbnailableExt(ext: string): boolean {
  return THUMBNAIL_EXTS.has(ext)
}

/**
 * 셀 아이콘 px × DPR → 요청 size 버킷 스냅.
 * 목표(iconPx × dpr) 이상인 최소 버킷을 선택해 선명도 확보(과대 버킷 회피 = 메모리/디코드 절약).
 * 목표가 최대 버킷을 넘으면 최대 버킷으로 클램프(임의 거대 size 방지 = guard 통과 보장).
 * dpr 은 호출측에서 Math.min(2, devicePixelRatio) 로 상한을 둔다.
 */
export function thumbSizeFor(iconPx: number, dpr: number): number {
  const target = iconPx * dpr
  for (const bucket of THUMB_SIZE_BUCKETS) {
    if (bucket >= target) return bucket
  }
  return THUMB_SIZE_BUCKETS[THUMB_SIZE_BUCKETS.length - 1]
}
