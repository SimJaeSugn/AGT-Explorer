/**
 * 설정 + 텔레메트리 옵트인 영속 store (settings:get/set, telemetry:set-opt-in).
 *
 * - settings.json: SettingsSnapshot(테마·시작위치·숨김·확장자·최근 개수).
 * - telemetry.json: 옵트인 플래그만(기본 false, D5). SettingsSnapshot 와 분리해
 *   Renderer 노출 표면(SettingsSnapshot)을 계약대로 유지하면서 플래그를 영속.
 * - 모든 쓰기는 원자적(temp→rename), 읽기는 손상 시 기본값 폴백(SA §5.2~5.3).
 *
 * 실제 텔레메트리 전송은 구현하지 않는다 — 플래그만 보관(P5 범위).
 */
import { readJsonSafe, writeJsonAtomic } from './atomic'
import { coerceSettings, defaultSettings, DEFAULT_TELEMETRY_OPT_IN } from './defaults'
import type { PersistencePaths } from './paths'
import type { SettingsSnapshot } from '@shared/dto'

interface TelemetryFile {
  readonly version: number
  readonly optIn: boolean
}

export class SettingsStore {
  private cache: SettingsSnapshot
  private telemetryOptIn: boolean
  private loaded = false

  constructor(private readonly paths: PersistencePaths) {
    this.cache = defaultSettings()
    this.telemetryOptIn = DEFAULT_TELEMETRY_OPT_IN
  }

  /** 디스크에서 설정·텔레메트리를 로드(최초 1회). 손상 시 기본값 폴백. */
  async load(): Promise<SettingsSnapshot> {
    const rawSettings = await readJsonSafe<unknown>(this.paths.settings)
    this.cache = coerceSettings(rawSettings)

    const rawTel = await readJsonSafe<Partial<TelemetryFile>>(this.paths.telemetry)
    this.telemetryOptIn =
      typeof rawTel?.optIn === 'boolean' ? rawTel.optIn : DEFAULT_TELEMETRY_OPT_IN

    this.loaded = true
    return this.cache
  }

  /** 현재 설정(로드 전이면 기본값). */
  get(): SettingsSnapshot {
    return this.cache
  }

  /** 텔레메트리 옵트인 현재값. */
  isTelemetryOptIn(): boolean {
    return this.telemetryOptIn
  }

  /**
   * 부분 패치를 적용하고 즉시 원자적으로 영속한다.
   * 정규화(coerce)로 무효 값은 무시되고, 갱신된 전체 스냅샷을 반환한다.
   */
  async set(patch: Partial<SettingsSnapshot>): Promise<SettingsSnapshot> {
    if (!this.loaded) await this.load()
    // version 은 사용자 패치로 바꾸지 못하게 현재 스키마 버전 고정.
    const merged = coerceSettings({ ...this.cache, ...patch })
    this.cache = merged
    await writeJsonAtomic(this.paths.settings, merged)
    return merged
  }

  /** 텔레메트리 옵트인 플래그를 설정·영속(기본 false). */
  async setTelemetryOptIn(enabled: boolean): Promise<void> {
    this.telemetryOptIn = enabled
    const file: TelemetryFile = { version: 1, optIn: enabled }
    await writeJsonAtomic(this.paths.telemetry, file)
  }
}
