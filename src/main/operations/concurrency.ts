/**
 * 파일 작업 동시성 결정(순수 함수 · 단위 검증 가능 · verify:concurrency).
 *
 * Main 에서 SSD 감지(DiskTypeService) 결과를 주입(`isSsd`)받아 copy/move/delete 의 워커 동시성을
 * 계산한다. SSD 볼륨은 랜덤 I/O 비용이 낮아 같은 볼륨에서도 병렬 이득이 있어 동시성을 상향하고,
 * HDD/Unknown 은 시킹 악화 위험으로 기존(보수적) 숫자를 유지한다(회귀 0).
 *
 * 동시성 매트릭스:
 *   - delete: 모든 소스 볼륨 SSD → 8, 그 외 → 4. (삭제는 메타데이터 위주라 HDD 도 4 병렬 유지.)
 *   - copy/move:
 *       · cross-volume(소스 문자 ≠ 대상 문자가 하나라도 있음) → 4(읽기/쓰기 장치 분리 병렬 이득).
 *       · same-volume → 대상 볼륨 SSD ? 4 : 1. (HDD-안전 same-volume=1 보존, SSD 만 4 로 상향.)
 *   - 드라이브 문자 해석 불가/unknown 미디어 → 보수적(비-SSD 취급). 기존 비-SSD 숫자 그대로(무회귀).
 *
 * 순수성: 외부 상태(캐시·I/O) 미참조. `isSsd` 주입으로 헤드리스 단위 검증 가능.
 */

/** "C:\\..." → "C"(대문자). UNC/원격/상대 등 드라이브 문자가 없으면 빈 문자열. */
export function driveLetterOf(p: string): string {
  return typeof p === 'string' && /^[A-Za-z]:/.test(p) ? p[0]!.toUpperCase() : ''
}

export type OpConcurrencyKind = 'copy' | 'move' | 'delete'

/**
 * 작업 종류·소스·대상·SSD 판정으로 워커 동시성을 산출한다(순수).
 *
 * @param kind     'copy' | 'move' | 'delete'.
 * @param sources  소스 절대 경로 목록(드라이브 문자 추출용).
 * @param destDir  copy/move 대상 디렉토리(delete 는 undefined).
 * @param isSsd    드라이브 문자('C' 또는 'C:')가 SSD 인지 판정(주입 — DiskTypeService.isSsd).
 *                 ssd 일 때만 true(보수적: unknown/hdd → false).
 */
export function pickOpConcurrency(
  kind: OpConcurrencyKind,
  sources: string[],
  destDir: string | undefined,
  isSsd: (letter: string) => boolean
): number {
  if (kind === 'delete') {
    // 모든 소스 볼륨이 SSD 일 때만 8. 하나라도 비-SSD·미상·해석 불가(UNC 등) 이면 보수적으로 4.
    // 해석 불가 문자('')는 SSD 단정 불가 → not-SSD 취급(보수적).
    const allSsd =
      sources.length > 0 &&
      sources.every((s) => {
        const l = driveLetterOf(s)
        return l !== '' && isSsd(l)
      })
    return allSsd ? 8 : 4
  }

  // copy / move.
  if (!destDir) return 1 // 대상 없음(비정상) → 보수적 순차.
  const dest = driveLetterOf(destDir)
  if (!dest) return 1 // 대상 드라이브 문자 해석 불가 → 보수적 순차(기존 동치).

  const crossVolume = sources.some((s) => {
    const d = driveLetterOf(s)
    return d !== '' && d !== dest
  })
  if (crossVolume) return 4 // 읽기/쓰기 장치 분리 → 병렬 이득(기존 숫자 유지).

  // same-volume: 대상 SSD 면 4 로 상향, 아니면(HDD/unknown) 기존 보수적 순차 1.
  return isSsd(dest) ? 4 : 1
}
