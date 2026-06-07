/**
 * 명시적 워크스페이스 영속 store (workspace:save/list/load/delete, SA §5.2).
 *
 * - workspaces/ 디렉토리에 워크스페이스별 JSON 을 원자적으로 기록한다.
 *   파일 형식: { version, name, savedAt, snapshot }(SessionSnapshot 래퍼).
 * - SessionStore 와 동일한 원자적 쓰기(writeJsonAtomic)·손상 폴백(readJsonSafe)·
 *   정규화(coerceSession) 패턴을 재사용한다(크래시 프리, SA §5.2~5.3).
 * - 사용자 입력 이름을 파일명으로 쓰므로 sanitize(경로 분리자·`..`·예약명·금지문자
 *   차단)로 경로 이탈을 막는다(ADR-005 §3.3). 정규화된 안전 이름이 파일명이 된다.
 *
 * 실제 텔레메트리/네트워크 전송은 없다 — 로컬 디스크 영속만.
 */
import * as fsp from 'node:fs/promises'
import { join } from 'node:path'
import type { SessionSnapshot, WorkspaceInfo } from '@shared/dto'
import { readJsonSafe, writeJsonAtomic } from './atomic'
import { coerceSession } from './defaults'
import type { PersistencePaths } from './paths'

/** 현재 워크스페이스 파일 스키마 버전. */
const WORKSPACE_SCHEMA_VERSION = 1

/** 워크스페이스 파일 래퍼(메타 + 스냅샷). */
interface WorkspaceFile {
  readonly version: number
  readonly name: string
  readonly savedAt: number
  readonly snapshot: SessionSnapshot
}

/** Windows 예약 파일명(대소문자 무시). */
const RESERVED_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
])

/**
 * 사용자 이름 → 파일시스템 안전한 베이스명으로 새니타이즈한다.
 * - 금지문자/경로 분리자/제어문자를 '_' 로 치환.
 * - 선행 '.'·끝 공백/마침표 제거(`..` 이탈·Windows 제약 방어).
 * - 예약명은 접두사로 회피. 빈 결과는 'workspace' 로 폴백.
 * 반환값은 확장자 없는 베이스명(호출부가 .json 을 붙인다).
 */
function sanitizeName(name: string): string {
  // 금지문자 집합: 경로 분리자·드라이브 콜론·와일드카드·제어문자·공백.
  // 문자 단위로 판정해 번들러의 정규식 재작성에 의존하지 않는다.
  const isForbidden = (ch: string): boolean => {
    const code = ch.charCodeAt(0)
    if (code <= 0x1f) return true // 제어문자
    return '<>:"/\\|?*'.includes(ch) || ch === ' '
  }
  let s = ''
  for (const ch of name.normalize('NFC')) s += isForbidden(ch) ? '_' : ch
  // 모든 '.' 을 '_' 로(`..` 상위이탈·선행 점 숨김 일괄 무력화).
  s = s.replace(/\./g, '_')
  // 끝의 '_'(치환된 공백/점) 정리.
  s = s.replace(/_+$/, '').replace(/^_+/, '')
  if (s.length === 0) return 'workspace'
  if (RESERVED_NAMES.has(s.toUpperCase())) s = `_${s}`
  // 파일명 길이 안전 상한(확장자 여유 포함).
  return s.slice(0, 100)
}

export class WorkspaceStore {
  /**
   * @param paths 영속 파일 위치(workspacesDir 사용).
   * @param getRecentLimit settings 의 recentLimit 공급자(coerceSession 슬라이스).
   */
  constructor(
    private readonly paths: PersistencePaths,
    private readonly getRecentLimit: () => number
  ) {}

  /** 워크스페이스별 JSON 파일 경로(이름 새니타이즈 + .json). */
  private fileOf(name: string): string {
    return join(this.paths.workspacesDir, `${sanitizeName(name)}.json`)
  }

  /**
   * workspaces/ 의 *.json 을 열거해 WorkspaceInfo[](name·savedAt) 를 돌려준다.
   * 디렉토리 미존재/손상 파일은 안전하게 건너뛴다(크래시 프리). savedAt 내림차순.
   */
  async list(): Promise<WorkspaceInfo[]> {
    let names: string[]
    try {
      names = await fsp.readdir(this.paths.workspacesDir)
    } catch {
      // 디렉토리 미존재 → 빈 목록.
      return []
    }
    const out: WorkspaceInfo[] = []
    for (const file of names) {
      if (!file.toLowerCase().endsWith('.json')) continue
      const full = join(this.paths.workspacesDir, file)
      const raw = await readJsonSafe<Partial<WorkspaceFile>>(full)
      if (!raw) continue // 손상/빈 파일 → 건너뜀.
      const name = typeof raw.name === 'string' && raw.name.length > 0 ? raw.name : file.replace(/\.json$/i, '')
      let savedAt = typeof raw.savedAt === 'number' && Number.isFinite(raw.savedAt) ? raw.savedAt : 0
      if (savedAt === 0) {
        // savedAt 누락 시 파일 mtime 으로 폴백.
        try {
          savedAt = Math.trunc((await fsp.stat(full)).mtimeMs)
        } catch {
          savedAt = 0
        }
      }
      out.push({ name, savedAt })
    }
    out.sort((a, b) => b.savedAt - a.savedAt)
    return out
  }

  /**
   * 이름을 붙여 현재 스냅샷을 원자적으로 저장한다(동명은 덮어쓰기).
   * snapshot 본문은 coerceSession 으로 정규화해 무효/구버전 필드를 흡수한다.
   */
  async save(name: string, snapshot: SessionSnapshot): Promise<void> {
    const normalized = coerceSession(snapshot, this.getRecentLimit())
    const file: WorkspaceFile = {
      version: WORKSPACE_SCHEMA_VERSION,
      name,
      savedAt: Date.now(),
      snapshot: normalized
    }
    await writeJsonAtomic(this.fileOf(name), file)
  }

  /**
   * 이름으로 로드해 SessionSnapshot 으로 정규화한다(손상/구버전 안전 폴백).
   * 미존재/손상 → undefined(핸들러가 ENOENT err 로 전파).
   */
  async load(name: string): Promise<SessionSnapshot | undefined> {
    const raw = await readJsonSafe<Partial<WorkspaceFile>>(this.fileOf(name))
    if (!raw || typeof raw !== 'object') return undefined
    // 래퍼의 snapshot 을 정규화. snapshot 누락 시 폴백(빈 세션).
    return coerceSession(raw.snapshot, this.getRecentLimit())
  }

  /** 워크스페이스 파일을 삭제한다. 미존재여도 true(멱등). */
  async delete(name: string): Promise<boolean> {
    try {
      await fsp.rm(this.fileOf(name), { force: true })
      return true
    } catch {
      return false
    }
  }
}
