/**
 * 영속화 파일 위치 (SA §5.2): app.getPath('userData') 하위.
 *   %APPDATA%/Explorer/session.json · settings.json · telemetry.json · workspaces/
 *
 * baseDir 은 Store 초기화 시 주입한다(테스트는 임시 디렉토리, 앱은 userData).
 * electron `app` 을 직접 import 하지 않아 헤드리스 검증이 가능하다.
 */
import { join } from 'node:path'

export interface PersistencePaths {
  readonly session: string
  readonly settings: string
  readonly telemetry: string
  readonly workspacesDir: string
}

export function persistencePaths(baseDir: string): PersistencePaths {
  return {
    session: join(baseDir, 'session.json'),
    settings: join(baseDir, 'settings.json'),
    telemetry: join(baseDir, 'telemetry.json'),
    workspacesDir: join(baseDir, 'workspaces')
  }
}
