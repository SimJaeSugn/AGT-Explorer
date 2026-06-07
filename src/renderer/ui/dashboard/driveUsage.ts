/**
 * 드라이브 사용량 파생(I장 §1.3). DriveDTO(원본) → 표시용 used·freePct 파생.
 * 순수 함수 — 도넛 차트·표·인사이트 카드가 공유한다.
 */
import type { DriveDTO } from '@shared/dto'

/** 표시용 드라이브 사용량(파생값 포함). */
export interface DriveUsage {
  readonly path: string
  readonly label: string
  readonly letter: string
  readonly ready: boolean
  /** 총 용량(바이트). 정보 없음이면 null. */
  readonly totalBytes: number | null
  /** 여유(바이트). 정보 없음이면 null. */
  readonly freeBytes: number | null
  /** 사용량(바이트) = total - free. 정보 없으면 null. */
  readonly usedBytes: number | null
  /** 여유 비율(0~1). 정보 없으면 null. */
  readonly freeRatio: number | null
  /** 사용 비율(0~1). 정보 없으면 null. */
  readonly usedRatio: number | null
  /** total/free 둘 다 유효한지(차트·집계 포함 가능). */
  readonly hasUsage: boolean
}

/** DriveDTO 1개 → DriveUsage 파생. */
export function toDriveUsage(d: DriveDTO): DriveUsage {
  const hasUsage =
    d.totalBytes !== null && d.freeBytes !== null && d.totalBytes > 0 && d.freeBytes >= 0
  const usedBytes =
    d.totalBytes !== null && d.freeBytes !== null
      ? Math.max(0, d.totalBytes - d.freeBytes)
      : null
  const freeRatio = hasUsage ? (d.freeBytes as number) / (d.totalBytes as number) : null
  const usedRatio = freeRatio !== null ? 1 - freeRatio : null
  return {
    path: d.path,
    label: d.label,
    letter: d.letter,
    ready: d.ready,
    totalBytes: d.totalBytes,
    freeBytes: d.freeBytes,
    usedBytes,
    freeRatio,
    usedRatio,
    hasUsage
  }
}

/** 드라이브 목록 → 사용량 파생 목록. */
export function deriveDriveUsages(drives: readonly DriveDTO[]): DriveUsage[] {
  return drives.map(toDriveUsage)
}

/** 여유 비율이 가장 낮은(가장 꽉 찬) 드라이브(인사이트 카드용). 유효 데이터 없으면 undefined. */
export function tightestDrive(usages: readonly DriveUsage[]): DriveUsage | undefined {
  let best: DriveUsage | undefined
  for (const u of usages) {
    if (u.freeRatio === null) continue
    if (!best || (best.freeRatio !== null && u.freeRatio < best.freeRatio)) best = u
  }
  return best
}
