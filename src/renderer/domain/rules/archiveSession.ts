/**
 * 압축 세션 추적·전송 라우팅 보조 순수 함수 (renderer/domain/rules/archiveSession) — §Q1 ADR-008.
 *
 * usecases/archive 가 보유하는 "패널 → 열린 zip 세션" 맵을 다루는 결정 로직을 순수 함수로
 * 분리한다(헤드리스 verify 가능 · store/infra 비의존). 부수효과 없음 — 실제 맵 변경·IPC 호출은
 * 호출측(usecases/archive)이 이 함수들의 결과를 보고 수행한다.
 *
 *  - 세션 키: 한 zip(archivePath) 1세션. 여러 패널이 같은 zip 안을 보면 sessionId 를 공유한다
 *    (재오픈 없음 · ADR-008 결정① 세션 모델). 마지막 패널이 zip 을 벗어나면 close 대상.
 *  - 라우팅: archive→local=extract, local→archive=add(transferRoute 위임). 본 모듈은 D&D 출발/
 *    도착 경로(URI/로컬)로부터 추출/추가에 필요한 인자(sessionId·innerPaths/localPaths·dest)를
 *    뽑아내는 순수 변환만 담당한다.
 *
 * react/zustand/infra/shared-ipc import 금지(.eslintrc · @shared/archive 는 shared/ipc 아님 → 허용).
 */
import { isArchivePath, parseArchivePath } from './archiveLocation'

/** 패널이 현재 보고 있는 압축 세션(usecases/archive 의 panel→session 맵 1행). */
export interface ArchivePanelSession {
  /** Main ArchiveSessionManager 가 발급한 세션 id. */
  readonly sessionId: string
  /** 이 세션이 연 zip 의 로컬 절대경로(archive:// URI 의 archivePath). */
  readonly archivePath: string
}

/** 패널 id → 압축 세션(읽기 전용 스냅샷). */
export type ArchiveSessionMap = ReadonlyMap<string, ArchivePanelSession>

/**
 * panelId 가 새 경로(newPath)로 이동할 때, 더 이상 아무 패널도 쓰지 않게 되는 sessionId 를
 * 산출한다(close 대상). newPath 가 같은 zip 안이면(archivePath 동일) 유지, zip 을 벗어나거나
 * 다른 zip 이면 옛 세션을 후보로 보되, **다른 패널이 같은 sessionId 를 쓰면 닫지 않는다**.
 *
 * @returns 닫아야 할 sessionId. 없으면 null.
 */
export function sessionToCloseOnLeave(
  sessions: ArchiveSessionMap,
  panelId: string,
  newPath: string
): string | null {
  const cur = sessions.get(panelId)
  if (!cur) return null
  // 같은 zip 안에서의 이동(폴더 진입/위로/뒤로)이면 세션 유지.
  if (isArchivePath(newPath)) {
    const loc = parseArchivePath(newPath)
    if (loc && loc.archivePath === cur.archivePath) return null
  }
  // 이 패널이 옛 세션을 떠난다 — 다른 패널이 같은 sessionId 를 쓰면 닫지 않는다(공유 세션 보존).
  for (const [pid, sess] of sessions) {
    if (pid !== panelId && sess.sessionId === cur.sessionId) return null
  }
  return cur.sessionId
}

/**
 * panelId 가 제거(탭/분할 닫기)될 때 닫아야 할 sessionId. 다른 패널이 같은 세션을 공유하면 null.
 */
export function sessionToCloseOnRemove(
  sessions: ArchiveSessionMap,
  panelId: string
): string | null {
  const cur = sessions.get(panelId)
  if (!cur) return null
  for (const [pid, sess] of sessions) {
    if (pid !== panelId && sess.sessionId === cur.sessionId) return null
  }
  return cur.sessionId
}

/**
 * 이미 열린 세션 재사용 판정: 같은 zip(archivePath)을 연 세션이 있으면 그 sessionId 를 반환한다
 * (재오픈 없이 list 만). 없으면 null → 호출측이 archive:open 한다.
 */
export function existingSessionFor(
  sessions: ArchiveSessionMap,
  archivePath: string
): string | null {
  for (const sess of sessions.values()) {
    if (sess.archivePath === archivePath) return sess.sessionId
  }
  return null
}

/** 경로가 .zip 파일인가(대소문자 무시). 더블클릭/메뉴 "폴더처럼 열기" 노출 판정. */
export function isZipFile(name: string): boolean {
  return /\.zip$/i.test(name)
}

/**
 * 추출 대상 변환: 압축 항목 URI 묶음(archive://zip!/inner) → { sessionId 후보 archivePath, innerPaths }.
 * 모두 같은 zip 가정(서로 다른 zip 혼합은 호출측이 거른다 — 첫 항목 기준). 비압축 URI 는 제외한다.
 *
 * @returns archivePath(세션 상관용)·innerPaths. 유효 항목이 없으면 null.
 */
export function toExtractArgs(
  archiveItemUris: readonly string[]
): { archivePath: string; innerPaths: string[] } | null {
  let archivePath: string | null = null
  const innerPaths: string[] = []
  for (const uri of archiveItemUris) {
    const loc = parseArchivePath(uri)
    if (!loc) continue
    if (archivePath === null) archivePath = loc.archivePath
    else if (loc.archivePath !== archivePath) continue // 다른 zip 항목은 무시(단일 세션 보장).
    innerPaths.push(loc.innerPath)
  }
  if (archivePath === null || innerPaths.length === 0) return null
  return { archivePath, innerPaths }
}

/**
 * 추가 대상 변환: 압축 도착 URI(archive://zip!/innerDir) → { archivePath(세션 상관), innerDir }.
 * 비압축이면 null.
 */
export function toAddTarget(
  archiveDestUri: string
): { archivePath: string; innerDir: string } | null {
  const loc = parseArchivePath(archiveDestUri)
  if (!loc) return null
  return { archivePath: loc.archivePath, innerDir: loc.innerPath }
}
