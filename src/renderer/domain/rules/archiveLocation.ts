/**
 * 압축(archive) 위치 식별·파싱 규칙 (renderer/domain/rules/archiveLocation) — 순수 함수 re-export.
 *
 * §Q1(ADR-008 결정①): §M3 원격이 확립한 "별도 경로 네임스페이스 + 공통 도메인 인터페이스"를
 * 압축에 재사용한다. 압축 경로는 `archive://<archivePath>!/<innerPath>` URI 로 인코딩해 로컬
 * (Windows `C:\...`)·원격(`sftp://...`)과 한 string 필드(`Panel.path`)에서 구분한다.
 *
 * 구현 단일 출처는 `@shared/archive/archivePath`(Main ArchiveSessionManager 와 코드 공유 —
 * ESLint 경계상 main 은 renderer 를 import 할 수 없어 shared 에 둔다). 본 파일은 렌더러 도메인
 * 계층의 정식 진입점으로 재노출한다(domain/rules 호출부 일관성).
 *
 * 라우팅(usecases/navigation)은 `location.kind`(remoteLocation.locationKindOf)로 분기 —
 * 'archive'=`archive:list`. 세션(열린 zip 핸들)은 Main ArchiveSessionManager 가 sessionId 로
 * 관리하며, 한 zip 안의 폴더 진입/뒤로/위로는 같은 sessionId·innerPath 만 바뀐다(재오픈 없음).
 *
 * 부수효과 없음. react/zustand/infra/shared-ipc import 금지(.eslintrc · @shared/archive 는
 * shared/ipc 가 아니므로 허용).
 */
export {
  ARCHIVE_SCHEME,
  ARCHIVE_BOUNDARY,
  isArchivePath,
  makeArchivePath,
  parseArchivePath,
  joinInnerPath,
  innerParentOf
} from '@shared/archive/archivePath'
export type { ArchiveLocation } from '@shared/archive/archivePath'
