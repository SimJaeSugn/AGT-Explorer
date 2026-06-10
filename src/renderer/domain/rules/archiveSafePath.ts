/**
 * 압축 엔트리 경로 안전 규칙 (renderer/domain/rules/archiveSafePath) — 순수 함수 re-export.
 *
 * §Q1(ADR-008 결정④)의 Zip Slip 차단 순수규칙. 구현 단일 출처는 `@shared/archive/safePath`
 * 이며(main 추출/추가 워커와 코드 공유 — ESLint 경계상 main 은 renderer 를 import 할 수 없고
 * renderer/domain 은 node:* 를 쓸 수 없어, node 비의존 순수 로직을 shared 에 둔다), 본 파일은
 * 렌더러 도메인 계층의 정식 진입점으로 재노출한다(domain/rules 호출부 일관성).
 *
 * 부수효과 없음. react/zustand/infra/shared-ipc import 금지(.eslintrc · @shared/archive 는
 * shared/ipc 가 아니므로 허용). DTO/순수규칙만 — UI 무관.
 */
export {
  ARCHIVE_CAPS,
  isInsideDir,
  stripRootPrefix,
  sanitizeSegment,
  safeExtractPath,
  isSymlinkEntry,
  isDirEntry,
  safeArchiveEntryName,
  isSuspiciousRatio
} from '@shared/archive/safePath'
export type { ArchiveSafePathResult } from '@shared/archive/safePath'
