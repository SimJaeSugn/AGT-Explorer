/**
 * 세션/설정 스키마 버전 (renderer/domain/session) — 순수 상수.
 *
 * Main(persistence/defaults.SESSION_SCHEMA_VERSION)와 **값이 일치**해야 한다.
 * Renderer 는 main 을 import 할 수 없으므로(.eslintrc) 같은 값을 domain 에 둔다.
 * 구조 변경 시 양쪽을 함께 +1 한다(SA §5.3 마이그레이션).
 */
export const SESSION_SCHEMA_VERSION = 1
export const SETTINGS_SCHEMA_VERSION = 1
