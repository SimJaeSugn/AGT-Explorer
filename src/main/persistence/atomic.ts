/**
 * 원자적 JSON 파일 읽기/쓰기 (SA §5.2 영속화).
 *
 * - 쓰기: temp 파일(`<name>.tmp`)에 먼저 기록 → fsync → rename 으로 교체.
 *   rename 은 동일 볼륨에서 원자적이므로 쓰기 도중 크래시에도 대상 파일이
 *   "이전 완전본" 또는 "새 완전본" 중 하나로만 남는다(부분 손상 방지).
 * - 읽기: 파싱 실패/손상/미존재 시 throw 하지 않고 `undefined` 를 돌려준다.
 *   호출부(Store)가 기본값으로 폴백한다(SA §5.3 크래시 프리).
 *
 * Main 전용. 비밀정보 저장 금지(로컬 세션/설정만).
 */
import { constants as fsConstants } from 'node:fs'
import * as fsp from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * JSON 파일을 안전하게 읽어 파싱한다.
 * 미존재·읽기 오류·JSON 파싱 실패는 모두 `undefined` 로 정규화한다.
 */
export async function readJsonSafe<T>(filePath: string): Promise<T | undefined> {
  let raw: string
  try {
    raw = await fsp.readFile(filePath, 'utf8')
  } catch {
    // 미존재(ENOENT)·권한 등 → 폴백 신호.
    return undefined
  }
  if (raw.trim().length === 0) return undefined
  try {
    return JSON.parse(raw) as T
  } catch {
    // 손상(부분 쓰기·잘못된 JSON) → 폴백 신호.
    return undefined
  }
}

/**
 * 값을 JSON 으로 직렬화해 원자적으로 기록한다(temp → fsync → rename).
 * 디렉토리가 없으면 생성한다. 실패는 throw 하지 않고 false 를 반환한다.
 */
export async function writeJsonAtomic(filePath: string, value: unknown): Promise<boolean> {
  const dir = dirname(filePath)
  const tmp = `${filePath}.tmp`
  try {
    await fsp.mkdir(dir, { recursive: true })
    const json = JSON.stringify(value, null, 2)

    // temp 에 기록하고 fsync 로 디스크 반영을 보장한 뒤 rename.
    const handle = await fsp.open(tmp, 'w')
    try {
      await handle.writeFile(json, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await fsp.rename(tmp, filePath)
    return true
  } catch {
    // 정리: 남은 temp 제거(베스트 에포트).
    await fsp.rm(tmp, { force: true }).catch(() => undefined)
    return false
  }
}

/** 파일 존재 여부(테스트·진단용). */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fsp.access(filePath, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}
