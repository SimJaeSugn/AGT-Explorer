/**
 * IPC 핸들러 가드 (ADR-005 §3.3 방어 심층).
 *
 * 모든 핸들러는 이 가드를 통과한다:
 *   1) senderFrame 출처 검증 — 우리 렌더러(로컬 번들/dev 서버)에서 온 호출만 수용.
 *   2) zod 스키마로 인자 형태 재검증(Preload 1차 + Main 2차).
 *   3) 경로 정규화·상위이탈(`..`) 차단(normalizePath).
 *
 * 검증 실패는 throw 가 아니라 Result.err(ESECURITY/EINVAL) 로 1급 전파한다(ADR-003).
 */
import type { IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import type { FileOpError, Result } from '@shared/ipc/contracts'
import { err } from '@shared/ipc/contracts'
import { fileOpError } from '../fs/errors'
import { normalizePath } from '../fs/paths'

/**
 * senderFrame 출처 검증.
 * - dev: ELECTRON_RENDERER_URL(예: http://localhost:xxxx) 출처 허용.
 * - prod: file:// 로컬 번들 출처 허용.
 * 그 외 출처(원격·iframe 주입)는 거부한다.
 */
export function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame
  if (!frame) return false
  const url = frame.url
  if (!url) return false

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl && url.startsWith(devUrl)) return true
  // prod: 로컬 파일 번들.
  if (url.startsWith('file://')) return true
  return false
}

/** zod 스키마 검증 + 결과를 Result 로 래핑하는 헬퍼. */
export function parseArgs<T>(schema: z.ZodType<T>, raw: unknown): Result<T> {
  const r = schema.safeParse(raw)
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    return err(fileOpError('EINVAL', `잘못된 요청 인자 — ${msg}`))
  }
  return { ok: true, value: r.data }
}

/**
 * 경로 1건을 정규화·검증한다. 상위이탈/상대경로/빈 경로는 ESECURITY/EINVAL.
 * 성공 시 정규화된 경로 문자열을 반환.
 */
export function guardPath(input: string): Result<string> {
  const r = normalizePath(input)
  if (!r.ok) {
    const code = r.reason?.includes('이탈') ? 'ESECURITY' : 'EINVAL'
    return err(fileOpError(code, `경로 거부: ${r.reason ?? '유효하지 않음'}`, input))
  }
  return { ok: true, value: r.path }
}

/** 신뢰되지 않은 sender 에 대한 표준 거부 에러. */
export const untrustedSenderError = (): FileOpError =>
  fileOpError('ESECURITY', '신뢰되지 않은 호출 출처')

// ── 공용 zod 스키마(핸들러가 재사용) ───────────────────────────────────
export const zPath = z.string().min(1)

export const zFsListReq = z.object({ path: zPath, showHidden: z.boolean() })
export const zFsStatReq = z.object({ path: zPath })
export const zFsTreeChildrenReq = z.object({ path: zPath })
export const zFsValidatePathReq = z.object({ path: zPath })
export const zFsListStartReq = z.object({
  path: zPath,
  showHidden: z.boolean(),
  chunkSize: z.number().int().positive().optional()
})
export const zFsListCancelReq = z.object({ streamId: z.string().min(1) })

// ── P4: fs 단발 / op:* / clipboard:* / dialog:* / shell:show-properties ──
export const zFsMkdirReq = z.object({ parentDir: zPath, name: z.string().min(1) })
export const zFsCreateFileReq = z.object({
  parentDir: zPath,
  name: z.string().min(1),
  template: z.string().optional()
})
export const zFsRenameReq = z.object({ path: zPath, newName: z.string().min(1) })

// ── V10: fs:link-finalize / dialog:pick-directory (자동링크) ───────────────
// backupName 은 경로 분리자·금지문자 없는 단일 폴더명(핸들러가 추가 검증). sourceDir/linkTarget
// 은 형태만 1차 검증 후 핸들러가 guardPath·존재·종류 재검증.
export const zFsLinkFinalizeReq = z.object({
  sourceDir: zPath,
  backupName: z.string().min(1).max(255),
  linkTarget: zPath
})
export const zDialogPickDirectoryReq = z.object({ defaultPath: zPath.optional() })

const zOpKind = z.enum(['copy', 'move', 'delete', 'trash'])
const zConflictResolution = z.enum(['overwrite', 'skip', 'rename', 'merge'])
export const zOpStartReq = z.object({
  kind: zOpKind,
  sources: z.array(zPath).min(1),
  destDir: zPath.optional(),
  conflictPolicy: zConflictResolution.optional(),
  baseDir: zPath.optional()
})
export const zOpResolveReq = z.object({
  operationId: z.string().min(1),
  conflictId: z.string().min(1),
  resolution: zConflictResolution,
  applyToAll: z.boolean()
})
export const zOpCancelReq = z.object({ operationId: z.string().min(1) })

// ── V3: op:robocopy:start (폴더 비교 고속 미러 — robocopy 복사) ────────────
// srcDir/dstDir 는 형태(min1)만 1차 검증, 핸들러가 guardPath 정규화·디렉토리 존재 재검증.
export const zOpRobocopyStartReq = z.object({
  srcDir: zPath,
  dstDir: zPath,
  expectedItems: z.number().int().nonnegative().optional()
})

export const zClipboardFilesReq = z.object({ paths: z.array(zPath).min(1) })
export const zClipboardPasteTargetReq = z.object({ destDir: zPath })
export const zDialogConfirmPermanentDeleteReq = z.object({ paths: z.array(zPath).min(1) })
export const zShellShowPropertiesReq = z.object({ path: zPath })
export const zShellOpenWithReq = z.object({ path: zPath })

// ── V1: shell:open-external (외부 브라우저 — http/https 만, 핸들러가 프로토콜 재검증) ──
// 형태(min1·상한)만 1차 검증하고, 프로토콜 화이트리스트(http/https)는 핸들러가 URL 파싱으로 강제.
export const zShellOpenExternalReq = z.object({ url: z.string().min(1).max(8192) })

// ── H4/H6: shell:open-terminal / shell:icon ──────────────────────────────
// open-terminal: cwd 는 항상 실존 디렉토리(핸들러가 stat 으로 추가 검증).
export const zShellOpenTerminalReq = z.object({ cwd: zPath })
// icon: 항상 실존 path 필수. ext 는 폴더/드라이브 합성키 전용 힌트(__dir__/__drive__)이며
// 일반 파일에는 오지 않는다(파일 키는 backend 가 win32.extname(path) 로 환원). 이로써
// "빈 요청"·"임의 ext 문자열"을 입구에서 거부한다(동결 contracts 보다 좁게 허용).
export const zShellIconReq = z.object({
  path: zPath,
  ext: z.enum(['__dir__', '__drive__']).optional()
})

// ── §Y1: shell:context-verbs / shell:invoke-verb ──────────────────────────
// paths 는 형태(각 min1)만 1차 검증, 핸들러가 guardPath·존재·로컬 한정(원격/archive
// prefix 거부) 재검증. 1개=단일·2개+=다중 선택(IContextMenu). 상한 1024(거대 입력 차단).
// verbId 는 "<index>:<정규화표시명>" 합성키(상한 512 — 거대 입력 차단).
const zShellPaths = z.array(zPath).min(1).max(1024)
export const zShellContextVerbsReq = z.object({ paths: zShellPaths })
export const zShellInvokeVerbReq = z.object({ paths: zShellPaths, verbId: z.string().min(1).max(512) })

// ── §Y2: shell:new:list / shell:new:create ("새로 만들기" ShellNew) ────────
// list 는 인자 없음(레지스트리 전역). create 의 id 는 확장자 키(".txt") — 레지스트리
// 경로 합성에 쓰이므로 확장자 형식만 허용(임의 키 주입 차단). dir 은 핸들러가 guardPath.
export const zShellNewListReq = z.object({})
export const zShellNewCreateReq = z.object({
  dir: zPath,
  id: z
    .string()
    .min(2)
    .max(64)
    .regex(/^\.[A-Za-z0-9_.+-]+$/),
  label: z.string().min(1).max(256)
})

// ── P5: session:* / settings:* / telemetry:set-opt-in ────────────────────
// SessionSnapshot 은 구조가 깊고 Renderer 가 생성한 직렬화 객체이므로,
// 형태 1차만 통과시키고(중첩 무효 필드는 Store 의 coerceSession 이 정규화),
// 본문 정규화는 persistence 계층에 위임한다(단일 책임).
const zThemeMode = z.enum(['light', 'dark', 'system', 'bluelight'])
export const zSessionSaveReq = z.object({
  snapshot: z.object({ version: z.number() }).passthrough()
})
export const zSettingsSetReq = z.object({
  patch: z
    .object({
      theme: zThemeMode.optional(),
      startLocation: z.string().optional(),
      showHidden: z.boolean().optional(),
      showExtensions: z.boolean().optional(),
      recentLimit: z.number().int().optional(),
      showDashboardOnStartup: z.boolean().optional(),
      verifyOnCopy: z.boolean().optional(),
      // 단축아이콘(상단 아이콘바 표시/순서). 항목 본문 정규화는 coerceSettings 에 위임.
      iconBarHidden: z.array(z.string()).optional(),
      iconBarOrder: z.array(z.string()).optional()
    })
    .strict()
})
export const zTelemetrySetOptInReq = z.object({ enabled: z.boolean() })

// ── U3: window:split-tab (탭 분리 → 새 창) ────────────────────────────────
// TabSnapshot 은 세션과 동형의 깊은 직렬화 객체이므로(zSessionSaveReq 정책 동일)
// 형태 1차만 통과시키고(id 존재·panels 배열), 본문 정규화·경로 검증은 분리 핸들러가
// coerceTab + restoreWindows 경로(렌더러)로 위임한다. 패널 경로는 새 창 렌더러가
// fs:list 로 다시 검증하므로 여기서 guardPath 까지 강제하지 않는다(세션 복원과 동일).
export const zWindowSplitTabReq = z.object({
  tab: z
    .object({
      id: z.string().min(1),
      panels: z.array(z.unknown()).min(1)
    })
    .passthrough(),
  // 분리 창 종류(미지정=full). z.object 는 미지정 키를 떨구므로 명시 필요.
  mode: z.enum(['full', 'compact']).optional()
})

// ── P6: preview:* / workspace:* ──────────────────────────────────────────
// preview:read 는 단일 경로만(가드가 guardPath 로 정규화·상위이탈 차단).
export const zPreviewReadReq = z.object({ path: zPath })

// ── L장: preview:thumbnail (그리드 이미지 썸네일 — nativeImage resize) ─────
// size 는 화이트리스트 버킷(셀 아이콘 px 64/48/32 × DPR≤2 = 32~128)만 허용한다.
// 임의 거대 size 로 nativeImage resize 메모리 폭주·DoS 를 입구에서 차단(방어 심층).
// 이 상수는 썸네일 서비스(os/thumbnail.ts)와 프런트 버킷 산출의 단일 출처가 되며,
// guard 통과가 곧 size 버킷 검증을 보장한다(getThumbnailDataUrl 은 검증 전제 동작).
export const THUMB_SIZE_BUCKETS = [32, 48, 64, 96, 128] as const
const THUMB_SIZE_BUCKET_SET: ReadonlySet<number> = new Set(THUMB_SIZE_BUCKETS)
export const zThumbnailReq = z.object({
  path: zPath,
  size: z.number().refine((v) => THUMB_SIZE_BUCKET_SET.has(v), '허용되지 않은 썸네일 크기'),
  mtime: z.number().optional()
})

// workspace:* — SessionSnapshot 은 깊은 직렬화 객체이므로 형태 1차(version)만
// 통과시키고 본문 정규화는 WorkspaceStore 의 coerceSession 에 위임한다
// (zSessionSaveReq 와 동일 정책). name 은 파일명으로 쓰이므로 Store 에서 추가
// 새니타이즈(경로 분리자·`..`·예약명 차단)한다.
export const zWorkspaceSaveReq = z.object({
  name: z.string().min(1).max(120),
  snapshot: z.object({ version: z.number() }).passthrough()
})
export const zWorkspaceLoadReq = z.object({ name: z.string().min(1).max(120) })
export const zWorkspaceDeleteReq = z.object({ name: z.string().min(1).max(120) })

// ── I장: analyze:scan:* (Top10 디스크 사용량 스캔) ────────────────────────
// root 는 guardPath 로 정규화·상위이탈 차단 후 핸들러가 stat 으로 디렉토리 검증.
export const zAnalyzeScanStartReq = z.object({ root: zPath })
export const zAnalyzeScanCancelReq = z.object({ scanId: z.string().min(1) })

// ── J장 J2: fs:watch:* (현재 디렉토리 non-recursive 실시간 감시) ────────────
// path 는 guardPath 로 정규화·상위이탈 차단 후 WatchService 가 stat 으로 디렉토리 검증.
export const zFsWatchStartReq = z.object({ path: zPath })
export const zFsWatchStopReq = z.object({ watchId: z.string().min(1) })

// ── K장 K2: trash:* (휴지통 열거·복원·비우기) ────────────────────────────────
// restore: ids = TrashItemDTO.id($R 실경로 토큰) 배열. 형태(min1·max1000)만 1차 검증,
//   핸들러가 각 id 의 $Recycle.Bin 화이트리스트를 재검증(임의 경로 실행 차단·방어 심층).
// empty: confirmed 가 literal true 가 아니면 핸들러가 EINVAL 거부(전체 비우기 게이트).
export const zTrashRestoreReq = z.object({ ids: z.array(z.string().min(1)).min(1).max(1000) })
export const zTrashEmptyReq = z.object({ confirmed: z.boolean() })

// ── §M M1: dnd:* (외부 드래그 — 로컬 경로만, 핸들러가 원격 prefix·존재 재검증) ──
// paths 는 zPath(min1) 배열. guardPath(정규화·상위이탈)·존재·원격 prefix 거부는 핸들러(MP3).
export const zDndStartDragReq = z.object({
  paths: z.array(zPath).min(1),
  iconHint: z.enum(['single', 'multi', 'folder']).optional()
})

// ── §M M2: clipboard:* CF_HDROP (write 만 인자, read/has 는 인자 없음 → sender 검증만) ──
export const zClipboardWriteFilesReq = z.object({
  paths: z.array(zPath).min(1),
  effect: z.enum(['copy', 'cut'])
})

// ── §M M3: remote:* (FTP/SFTP) ───────────────────────────────────────────
// 비밀(secret.value)은 zod 가 형태만 검증(min1·상한)하고 절대 로그/Error 에 싣지 않는다
// (parseArgs 의 EINVAL 메시지는 issue.path 만 노출 — value 미수록). 핸들러가 즉시 safeStorage.
export const zRemoteProtocol = z.enum(['ftp', 'ftps', 'sftp'])
export const zRemoteAuthMethod = z.enum(['password', 'privateKey'])

// 비밀 배제(strict): 미상의 키(예: password/passphrase/privateKey)를 거부해
// 영속·전송 DTO 에 비밀이 섞여 들어오는 경로를 입구에서 차단한다(ADR-007 ③).
export const zRemoteProfileDTO = z
  .object({
    id: z.string().min(1).max(255),
    name: z.string().min(1).max(120),
    protocol: zRemoteProtocol,
    host: z.string().min(1).max(255),
    port: z.number().int().min(1).max(65535),
    username: z.string().max(255),
    authMethod: zRemoteAuthMethod
  })
  .strict()

// 비밀 본문(요청 전용). privateKey 본문 여유 상한(100KB). 형태만 검증.
export const zRemoteSecret = z.object({
  kind: z.enum(['password', 'passphrase', 'privateKey']),
  value: z.string().min(1).max(100_000)
})

export const zRemoteCredSaveReq = z.object({
  profileId: z.string().min(1).max(255),
  secret: zRemoteSecret
})
export const zRemoteCredHasReq = z.object({ profileId: z.string().min(1).max(255) })
export const zRemoteCredDeleteReq = z.object({ profileId: z.string().min(1).max(255) })

export const zRemoteProfileUpsertReq = z.object({ profile: zRemoteProfileDTO })
export const zRemoteProfileDeleteReq = z.object({ profileId: z.string().min(1).max(255) })

export const zRemoteConnectReq = z.object({
  profile: zRemoteProfileDTO,
  secret: zRemoteSecret.optional(),
  hostKeyDecision: z.enum(['accept', 'reject']).optional()
})
export const zRemoteDisconnectReq = z.object({ sessionId: z.string().min(1) })

// 원격 path 는 POSIX 절대경로 — **로컬 guardPath(win32) 미적용**. zod 는 형태(min1)만 검증하고,
// 원격 경로 정규화·traversal 방어는 RemoteService/어댑터가 POSIX 기준으로 별도 수행한다(MP4 §보안).
export const zRemoteListReq = z.object({ sessionId: z.string().min(1), path: zPath })
export const zRemoteStatReq = z.object({ sessionId: z.string().min(1), path: zPath })
export const zRemoteMkdirReq = z.object({
  sessionId: z.string().min(1),
  path: zPath,
  name: z.string().min(1)
})
export const zRemoteRenameReq = z.object({
  sessionId: z.string().min(1),
  path: zPath,
  newName: z.string().min(1)
})
export const zRemoteDeleteReq = z.object({ sessionId: z.string().min(1), path: zPath })

const zConflictPolicy = z.enum(['overwrite', 'skip', 'rename', 'merge'])
// download: remotePaths 는 POSIX(형태만), destDir 는 **로컬** → 핸들러가 guardPath(MP4).
export const zRemoteDownloadReq = z.object({
  sessionId: z.string().min(1),
  remotePaths: z.array(zPath).min(1),
  destDir: zPath,
  conflictPolicy: zConflictPolicy.optional()
})
// upload: localPaths 는 **로컬** → 핸들러가 guardPath(MP4). remoteDir 는 POSIX(형태만).
export const zRemoteUploadReq = z.object({
  sessionId: z.string().min(1),
  localPaths: z.array(zPath).min(1),
  remoteDir: zPath,
  conflictPolicy: zConflictPolicy.optional()
})

// ── M7: hash:* (공용 해시·비교 엔진 — ADR-009) ────────────────────────────
// 경로(leftDir/rightDir/roots[]/pairs[].src/.dst)는 형태(min1)만 1차 검증하고,
// 핸들러가 각각 guardPath 정규화·상위이탈 차단·stat 종류 검증·원격 prefix 거부(로컬 한정).
const zHashAlgo = z.enum(['sha256'])
export const zHashCompareStartReq = z.object({
  leftDir: zPath,
  rightDir: zPath,
  useHash: z.boolean(),
  recursive: z.boolean(),
  algo: zHashAlgo.optional()
})
export const zHashDupStartReq = z.object({
  roots: z.array(zPath).min(1),
  minSize: z.number().int().nonnegative().optional(),
  algo: zHashAlgo.optional()
})
export const zHashVerifyStartReq = z.object({
  pairs: z.array(z.object({ src: zPath, dst: zPath })).min(1).max(100_000),
  algo: zHashAlgo.optional()
})
export const zHashCancelReq = z.object({ jobId: z.string().min(1) })

// ── M7: queue:* (전송 큐 — ADR-011, 큐 핸들러 impl: W2) ───────────────────
// W0 에서 zod 스키마만 동결한다(큐 핸들러는 W2 에서 이 스키마를 재사용). pause/resume/
// retry 는 operationId 동형이므로 단일 스키마를 공유한다.
export const zQueueOperationReq = z.object({ operationId: z.string().min(1) })
export const zQueueSetConcurrencyReq = z.object({
  maxConcurrent: z.number().int().min(1).max(16)
})

// ── M8: search:content:* (내용 검색 grep — ADR-010) ───────────────────────
// root 는 형태(min1)만 1차 검증하고, 핸들러가 guardPath 정규화·상위이탈 차단·디렉토리
// 검증·원격 prefix 거부(로컬 한정). query 는 비어 있지 않은 검색어(상한 4KB — 거대 정규식
// 폭주 입구 차단). isRegex 컴파일 실패는 GrepManager 가 Result.err(throw 0)로 격리한다.
// maxFileBytes 는 양의 정수(상한 미지정 시 엔진 기본). includeHidden 미지정=false.
export const zSearchContentStartReq = z.object({
  root: zPath,
  query: z.string().min(1).max(4096),
  isRegex: z.boolean(),
  recursive: z.boolean(),
  includeHidden: z.boolean().optional(),
  maxFileBytes: z.number().int().positive().optional()
})
export const zSearchContentCancelReq = z.object({ jobId: z.string().min(1) })

// ── archive:* 압축파일 어댑터 (M9 — ADR-008) ──────────────────────────────
export const zArchiveOpenReq = z.object({ archivePath: zPath })
export const zArchiveListReq = z.object({
  sessionId: z.string().min(1),
  innerPath: z.string().max(4096)
})
export const zArchiveCloseReq = z.object({ sessionId: z.string().min(1) })
export const zArchiveExtractReq = z.object({
  sessionId: z.string().min(1),
  innerPaths: z.array(z.string().min(1)).min(1).max(100_000),
  destDir: zPath,
  conflictPolicy: zConflictPolicy.optional()
})
export const zArchiveAddReq = z.object({
  sessionId: z.string().min(1),
  localPaths: z.array(zPath).min(1).max(100_000),
  innerDir: z.string().max(4096),
  conflictPolicy: zConflictPolicy.optional()
})

// ── agent:* 자연어 파일 에이전트 (신규 §Z — ADR-014·ADR-015) ───────────────
// 경로(cwd·selection·PlannedOp sources/destDir/path)는 핸들러가 guardPath + scope.assertInScope
// 로 재검증한다(여기서는 형태만). 키(apiKey)는 오류 메시지에 미수록(min1·max8192). baseUrl 은
// zod 형식 검증 후 핸들러가 ssrfGuard.validateRegister(1~4단계)로 추가 검증해야 등록된다.
const zProviderId = z.enum(['anthropic', 'openai', 'internal'])
const zHttpsUrl = z.string().url().max(2048).refine((u) => /^https?:\/\//.test(u), 'http(s) only')

export const zAgentKeySetReq = z.object({
  provider: zProviderId,
  apiKey: z.string().min(1).max(8192)
})
export const zAgentKeyHasReq = z.object({ provider: zProviderId })

export const zProviderConfig = z
  .object({
    id: zProviderId,
    planModel: z.string().max(128).optional(),
    lightModel: z.string().max(128).optional(),
    baseUrl: zHttpsUrl.optional(),
    modelId: z.string().max(128).optional(),
    supportsToolUse: z.boolean().optional()
  })
  .refine((c) => c.id !== 'internal' || (!!c.baseUrl && !!c.modelId), 'internal requires baseUrl+modelId')
export const zAgentProviderSetReq = z
  .object({
    config: zProviderConfig.optional(),
    hostOp: z
      .object({
        action: z.enum(['add', 'remove']),
        // host 는 URL(추가용·zHttpsUrl) 또는 정규화 키(삭제용·host[:port]) 둘 다 수용.
        host: z.string().min(1).max(2048)
      })
      .optional()
  })
  .refine((r) => !!r.config || !!r.hostOp, 'config 또는 hostOp 중 하나는 필요합니다.')
export const zAgentProviderModelsReq = z.object({ id: zProviderId })
export const zAgentProviderProbeReq = z.object({ id: zProviderId })

// 이름 있는 위치(§Z list_locations) — name/path 문자열 길이·항목수 상한(페이로드 폭주 방어).
// path 는 로컬·가상(remote/archive) 둘 다 허용(zPath 동형 문자열) — 가상 경로 스코프 제외는 scope.ts.
const zLocationItem = z.object({ name: z.string().max(512), path: z.string().min(1).max(4096) })
const zPanelLocation = z.object({
  index: z.number().int().min(1).max(64),
  path: z.string().min(1).max(4096),
  active: z.boolean()
})
const zAgentLocations = z.object({
  favorites: z.array(zLocationItem).max(1000).optional(),
  quickAccess: z.array(zLocationItem).max(64).optional(),
  recent: z.array(zLocationItem).max(1000).optional(),
  drives: z.array(zLocationItem).max(64).optional(),
  panels: z.array(zPanelLocation).max(16).optional()
})
export const zAgentRunReq = z.object({
  prompt: z.string().min(1).max(8192),
  context: z.object({
    cwd: zPath,
    selection: z.array(zPath).max(10_000),
    locations: zAgentLocations.optional()
  }),
  contentConsent: z.boolean().optional()
})
export const zPlannedOp = z.object({
  opId: z.string().min(1),
  kind: z.enum(['move', 'copy', 'rename', 'mkdir', 'trash']),
  sources: z.array(zPath).optional(),
  destDir: zPath.optional(),
  path: zPath.optional(),
  newName: z.string().min(1).max(255).optional(),
  reason: z.string().max(2048)
})
export const zAgentConfirmReq = z.object({
  runId: z.string().min(1),
  ops: z.array(zPlannedOp).min(1).max(50), // MAX_STAGED_OPS 상한
  conflictByOp: z.record(z.enum(['overwrite', 'skip', 'rename', 'merge'])).optional()
})
export const zAgentCancelReq = z.object({ runId: z.string().min(1) })
