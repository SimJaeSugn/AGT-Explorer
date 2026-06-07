/**
 * 영속화 store 부트스트랩 — Main 프로세스 단일 출처.
 *
 * initPersistence(baseDir) 로 userData 경로를 주입해 SessionStore·SettingsStore 를
 * 초기화하고, 핸들러·종료 훅이 sessionStore()/settingsStore() 로 접근한다.
 *
 * electron `app` 을 여기서 import 하지 않는다 — 호출부(main/index.ts)가
 * app.getPath('userData') 를 넘긴다. 덕분에 헤드리스 검증 스크립트가
 * 임시 디렉토리로 동일 코드를 구동할 수 있다.
 */
import { persistencePaths } from './paths'
import { SessionStore } from './SessionStore'
import { SettingsStore } from './SettingsStore'
import { WorkspaceStore } from './WorkspaceStore'

let _settings: SettingsStore | null = null
let _session: SessionStore | null = null
let _workspace: WorkspaceStore | null = null

/**
 * 영속 store 를 초기화하고 설정·텔레메트리를 디스크에서 로드한다.
 * @param baseDir app.getPath('userData') (또는 테스트용 임시 디렉토리).
 * @param debounceMs 세션 자동 저장 디바운스(기본 1초).
 */
export async function initPersistence(baseDir: string, debounceMs?: number): Promise<void> {
  const paths = persistencePaths(baseDir)
  const settings = new SettingsStore(paths)
  await settings.load()
  const session = new SessionStore(paths, () => settings.get().recentLimit, debounceMs)
  const workspace = new WorkspaceStore(paths, () => settings.get().recentLimit)
  _settings = settings
  _session = session
  _workspace = workspace
}

export function settingsStore(): SettingsStore {
  if (!_settings) throw new Error('persistence not initialized — call initPersistence() first')
  return _settings
}

export function sessionStore(): SessionStore {
  if (!_session) throw new Error('persistence not initialized — call initPersistence() first')
  return _session
}

export function workspaceStore(): WorkspaceStore {
  if (!_workspace) throw new Error('persistence not initialized — call initPersistence() first')
  return _workspace
}

export { SessionStore } from './SessionStore'
export { SettingsStore } from './SettingsStore'
export { WorkspaceStore } from './WorkspaceStore'
export { persistencePaths } from './paths'
export type { PersistencePaths } from './paths'
