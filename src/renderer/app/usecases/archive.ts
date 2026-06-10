/**
 * archive 유스케이스 (app/usecases/archive) — §Q1 ADR-008 압축파일 archive:// 어댑터(렌더러).
 *
 * 책임:
 *   - .zip 을 "폴더처럼 열기"(archive:open → 세션 발급 → 패널을 archive://zip!/ 로 이동).
 *   - 압축 내부 디렉토리 탐색(archive:list → 각 항목 path 를 archive:// URI 로 재구성해 패널 주입).
 *   - 세션 수명: 패널 → sessionId 맵을 보유. 한 zip 안의 폴더 진입/위로/뒤로는 같은 세션 재사용,
 *     zip 을 벗어나거나(상위로 탈출) 패널이 닫히면 archive:close(누수 방지). 같은 zip 을 보는
 *     다른 패널이 있으면 닫지 않는다(세션 공유).
 *   - 전송 라우팅(transferRoute): archive→local=추출(archive:extract), local→archive=추가
 *     (archive:add). 진행률·충돌·완료·취소는 신규 채널 없이 기존 op:* 브리지 재사용(operationId).
 *
 * 1차 범위(ADR-008): zip 만 · 암호 zip 미지원(EUNSUPPORTED → 안내) · 내부 이름변경/삭제 없음 ·
 * 중첩 zip 재귀 진입 없음(내부 .zip 은 일반 파일로 표시).
 *
 * 경계: app → infra/api(archiveApi) 직접 호출(.eslintrc 허용). 순수 규칙은 domain 위임.
 */
import type { ConflictPolicy } from '@shared/dto'
import { archiveApi } from '@renderer/infra/api'
import { store } from '@renderer/app/stores/rootStore'
import { makeArchivePath, parseArchivePath } from '@renderer/domain/rules/archiveLocation'
import {
  existingSessionFor,
  sessionToCloseOnLeave,
  sessionToCloseOnRemove,
  toAddTarget,
  toExtractArgs,
  type ArchivePanelSession,
  type ArchiveSessionMap
} from '@renderer/domain/rules/archiveSession'
import { resolveTransfer } from '@renderer/domain/rules/transferRoute'

// ── 패널 → 열린 zip 세션 맵(슬라이스 외부 — 비직렬화 자원, streamDisposers 동형) ──
// 한 zip(archivePath) 1세션. 여러 패널이 같은 zip 안을 보면 sessionId 를 공유한다.
const panelSessions = new Map<string, ArchivePanelSession>()

/** 현재 세션 맵의 읽기 전용 스냅샷(순수 결정 함수 입력용). */
function snapshot(): ArchiveSessionMap {
  return panelSessions
}

/** archivePath 로 sessionId 조회(세션 상관 — list/extract/add 공통). 없으면 null. */
function sessionIdForArchive(archivePath: string): string | null {
  return existingSessionFor(panelSessions, archivePath)
}

// ── 폴더처럼 열기(.zip 더블클릭/컨텍스트 "폴더처럼 열기") ────────────────────

/**
 * zip 을 폴더처럼 연다. 이미 같은 zip 세션이 있으면 재사용(재오픈 없음), 없으면 archive:open
 * 으로 세션 발급. 성공 시 패널을 archive://<zip>!/ 루트로 이동(navigate → load 가 archive:list).
 * 암호 zip(EUNSUPPORTED)·기타 오류는 토스트로 안내한다.
 */
export async function openArchiveAsFolder(panelId: string, archivePath: string): Promise<void> {
  const s = store.getState()
  let sessionId = sessionIdForArchive(archivePath)
  if (!sessionId) {
    const res = await archiveApi.open(archivePath)
    if (!res.ok) {
      s.pushToast('error', archiveErrorMessage(res.error.code, res.error.message))
      return
    }
    sessionId = res.value.sessionId
  }
  panelSessions.set(panelId, { sessionId, archivePath })
  // archive:// 루트로 이동 → panelsSlice.load 가 'archive' 분기로 listArchiveDir 호출.
  s.navigate(panelId, makeArchivePath(archivePath, ''), true)
}

// ── 압축 내부 탐색(panelsSlice.load 가 archive 경로일 때 호출) ────────────────

/**
 * 압축 내부 디렉토리 탐색. archive:list 결과(FileEntryDTO)의 각 path(zip 내부 POSIX 경로)를
 * archive://<zip>!/<inner> URI 로 재구성해 패널에 주입한다 — 이래야 디렉토리 더블클릭·위로/뒤로
 * 가 다시 'archive' 로 라우팅된다(원격 listRemoteDir 의 URI 재구성과 동형 · isArchivePath 보장).
 *
 * 세션이 없으면(직접 archive:// 주소 입력 등) archive:open 으로 세션을 발급해 본다(자기치유).
 */
export async function listArchiveDir(panelId: string, archiveUri: string): Promise<void> {
  const s = store.getState()
  const loc = parseArchivePath(archiveUri)
  if (!loc) {
    s._setRemoteError(panelId, archiveUri, 'EINVAL', '잘못된 압축 경로입니다.')
    return
  }
  let sessionId = sessionIdForArchive(loc.archivePath)
  if (!sessionId) {
    // 세션 없이 archive:// 경로로 진입(주소창 직접 입력·세션 시점이 어긋남) → 열어 본다.
    const opened = await archiveApi.open(loc.archivePath)
    if (!opened.ok) {
      s._setRemoteError(panelId, archiveUri, opened.error.code, archiveErrorMessage(opened.error.code, opened.error.message))
      return
    }
    sessionId = opened.value.sessionId
    panelSessions.set(panelId, { sessionId, archivePath: loc.archivePath })
  } else {
    // 기존 세션을 이 패널에도 연결(공유 — 같은 zip 을 다른 패널에서 열었을 때).
    panelSessions.set(panelId, { sessionId, archivePath: loc.archivePath })
  }
  s._remoteLoading(panelId, archiveUri)
  const res = await archiveApi.list(sessionId, loc.innerPath)
  if (res.ok) {
    const entries = res.value.entries.map((e) => ({
      ...e,
      path: makeArchivePath(loc.archivePath, e.path)
    }))
    store.getState()._setRemoteEntries(panelId, archiveUri, entries)
  } else {
    store
      .getState()
      ._setRemoteError(panelId, archiveUri, res.error.code, archiveErrorMessage(res.error.code, res.error.message))
  }
}

// ── 세션 수명(이탈/제거 시 close — 누수 방지) ───────────────────────────────

/**
 * 패널이 newPath 로 이동할 때 호출(panelsSlice.load 가 비압축 경로로 갈 때 + archive→다른 zip).
 * 같은 zip 안 이동이면 유지, zip 을 벗어나면 옛 세션을 close 후보로(다른 패널이 같은 세션을
 * 공유하면 닫지 않음). 세션 맵에서 이 패널의 엔트리도 정리한다.
 */
export function leaveArchiveIfNeeded(panelId: string, newPath: string): void {
  const closeId = sessionToCloseOnLeave(snapshot(), panelId, newPath)
  // 같은 zip 안 이동(closeId=null이고 여전히 archive)은 맵 유지. zip 을 벗어났으면 맵에서 제거.
  const loc = parseArchivePath(newPath)
  const cur = panelSessions.get(panelId)
  const stayingSameZip = !!(cur && loc && loc.archivePath === cur.archivePath)
  if (!stayingSameZip) panelSessions.delete(panelId)
  if (closeId) void archiveApi.close(closeId)
}

/** 패널 제거(탭/분할 닫기) 시 호출. 공유 세션이 아니면 close. */
export function closeArchiveOnRemove(panelId: string): void {
  const closeId = sessionToCloseOnRemove(snapshot(), panelId)
  panelSessions.delete(panelId)
  if (closeId) void archiveApi.close(closeId)
}

// ── 전송 라우팅(extract/add — 진행률은 op:* 재사용) ──────────────────────────

/**
 * 전송 1건의 결과를 operationsSlice 에 등록(진행률/충돌/완료를 op:* 브리지로 추적).
 * 추출/추가는 원본 보존 의미(undo 미생성 — kind 'copy'). refreshDirs 폴더를 보는 패널 새로고침.
 */
function registerTransfer(operationId: string, refreshDirs: string[]): void {
  const s = store.getState()
  const refreshPaths = new Set<string>()
  for (const dir of refreshDirs) {
    for (const [id, p] of Object.entries(s.panels)) {
      if (p.path === dir) refreshPaths.add(id)
    }
  }
  s.registerOperation(operationId, 'copy', [...refreshPaths])
}

/**
 * 압축→로컬 추출(archive:extract). archiveItemUris(압축 항목 URI)·로컬 destDir.
 * 모두 같은 zip 가정(첫 항목 기준). 진행률은 op:* 재사용·Zip Slip 은 main 이 차단.
 */
export async function extractToLocal(
  archiveItemUris: string[],
  localDestDir: string,
  conflictPolicy?: ConflictPolicy
): Promise<boolean> {
  const s = store.getState()
  const args = toExtractArgs(archiveItemUris)
  if (!args) {
    s.pushToast('info', '추출할 압축 항목이 없습니다.')
    return false
  }
  const sessionId = sessionIdForArchive(args.archivePath)
  if (!sessionId) {
    s.pushToast('error', '압축 세션이 없습니다. 압축을 다시 여세요.')
    return false
  }
  const res = await archiveApi.extract(sessionId, args.innerPaths, localDestDir, conflictPolicy)
  if (!res.ok) {
    s.pushToast('error', `추출 실패: ${archiveErrorMessage(res.error.code, res.error.message)}`)
    return false
  }
  registerTransfer(res.value.operationId, [localDestDir])
  return true
}

/**
 * 로컬→압축 추가(archive:add). localPaths(로컬 절대경로)·압축 도착 URI(폴더). 재작성 방식.
 * 진행률은 op:* 재사용. 추가 후 같은 zip 을 보는 패널이 새로고침된다(registerTransfer + 도착 URI).
 */
export async function addToArchive(
  localPaths: string[],
  archiveDestUri: string,
  conflictPolicy?: ConflictPolicy
): Promise<boolean> {
  const s = store.getState()
  if (localPaths.length === 0) return false
  const target = toAddTarget(archiveDestUri)
  if (!target) {
    s.pushToast('error', '잘못된 압축 대상입니다.')
    return false
  }
  const sessionId = sessionIdForArchive(target.archivePath)
  if (!sessionId) {
    s.pushToast('error', '압축 세션이 없습니다. 압축을 다시 여세요.')
    return false
  }
  const res = await archiveApi.add(sessionId, localPaths, target.innerDir, conflictPolicy)
  if (!res.ok) {
    s.pushToast('error', `추가 실패: ${archiveErrorMessage(res.error.code, res.error.message)}`)
    return false
  }
  registerTransfer(res.value.operationId, [archiveDestUri])
  return true
}

/**
 * D&D 전송 라우팅 진입점(압축 관련 조합만). 출발/도착 경로(로컬 또는 archive:// URI)와 수정키로
 * extract/add/unsupported 를 결정해 실행한다. local↔local·로컬↔원격은 호출측(performDrop·remote)이
 * 처리하므로 여기서는 압축 관련 전송만 담당한다.
 *
 * @returns 압축 전송을 시작했으면 true(호출측이 다른 경로로 폴백하지 않도록).
 */
export async function routeArchiveTransfer(
  sources: string[],
  sourceDir: string,
  destDir: string,
  mods: { ctrl: boolean; shift: boolean }
): Promise<boolean> {
  const s = store.getState()
  const srcKind = parseArchivePath(sourceDir) ? 'archive' : 'local'
  const dstKind = parseArchivePath(destDir) ? 'archive' : 'local'
  const kind = resolveTransfer({ kind: srcKind }, { kind: dstKind }, mods, sourceDir, destDir)
  switch (kind) {
    case 'extract':
      return extractToLocal(sources, destDir)
    case 'add':
      return addToArchive(sources, destDir)
    case 'unsupported':
      s.pushToast('info', '압축↔압축·압축↔원격 전송은 아직 지원하지 않습니다.')
      return false
    default:
      // copy/move/upload/download — 압축 무관. 호출측 경로가 처리.
      return false
  }
}

// ── 오류 메시지 매핑(FileOpError code → 사용자 안내) ────────────────────────

/** archive 오류 코드 → 사용자 안내. 암호 zip(EUNSUPPORTED)은 명시 안내. */
export function archiveErrorMessage(code: string, fallback: string): string {
  switch (code) {
    case 'EUNSUPPORTED':
      return '암호 보호 zip은 지원하지 않습니다.'
    case 'ENOENT':
      return '압축 파일을 찾을 수 없습니다.'
    case 'EACCES':
    case 'EPERM':
      return '압축 파일에 접근할 권한이 없습니다.'
    case 'ESECURITY':
      return '안전하지 않은 압축 항목이 차단되었습니다(경로 이탈/링크).'
    case 'EINVAL':
      return '손상되었거나 올바르지 않은 압축 파일입니다.'
    default:
      return fallback || '압축 작업에 실패했습니다.'
  }
}
