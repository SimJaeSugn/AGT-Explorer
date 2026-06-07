/**
 * 프로세스 공통 DTO — 단일 출처 (directory-structure §2 shared/dto).
 *
 * 경량 직렬화 DTO. Main(FileSystemService) → IPC → Preload → Renderer 로
 * 구조화 복제(structured clone)되어 흐른다. 따라서 **순수 직렬화 가능 타입만**
 * 둔다(함수·클래스·Date 인스턴스 금지 → 타임스탬프는 number(epoch ms)).
 *
 * 경계 규칙(.eslintrc): `domain` 계층은 `shared/ipc` 는 import 하지 못하지만
 * 이 `shared/dto` 의 **타입**은 import 할 수 있다. 그러므로 contracts(IPC shape)
 * 와 dto(데이터 모델)를 분리 유지한다.
 *
 * 추적성: SA §3.2(채널 카탈로그), §5.1(SessionSnapshot), SW §3.1~3.2, F장.
 */

// ────────────────────────────────────────────────────────────────────────
// 파일 항목 / 드라이브
// ────────────────────────────────────────────────────────────────────────

/**
 * Windows 파일 속성 비트. node:fs 의 stat 만으로는 hidden/system 을
 * 정확히 얻을 수 없어 Main(FileSystemService)에서 win32 속성 비트를
 * 매핑해 채운다(features F장).
 */
export interface FileAttributesDTO {
  /** 숨김 파일(FILE_ATTRIBUTE_HIDDEN). 기본 목록에서 showHidden=false 면 제외. */
  readonly hidden: boolean
  /** 읽기 전용(FILE_ATTRIBUTE_READONLY). */
  readonly readonly: boolean
  /** 시스템 파일(FILE_ATTRIBUTE_SYSTEM). */
  readonly system: boolean
  /** 심볼릭 링크 / 정션(reparse point). 표시·순환 판정 참고용. */
  readonly symlink: boolean
}

/**
 * 디렉토리 항목 1개의 경량 표현. 가상 스크롤 행 1개 ↔ FileEntryDTO 1개.
 * IPC 직렬화 비용을 줄이기 위해 필요한 필드만 담는다(SA §7 SR4).
 */
export interface FileEntryDTO {
  /** 표시 이름(확장자 포함). 예: "report.png" */
  readonly name: string
  /** 정규화된 절대 경로. 예: "C:\\Users\\me\\report.png" */
  readonly path: string
  /** 디렉토리 여부(폴더 우선 정렬·트리 확장 판정). */
  readonly isDir: boolean
  /** 바이트 크기. 디렉토리는 0(또는 미집계). */
  readonly size: number
  /** 수정 시각 (epoch milliseconds, UTC). Date 대신 number 로 직렬화. */
  readonly mtime: number
  /** 생성 시각 (epoch milliseconds, UTC). */
  readonly ctime: number
  /**
   * 확장자(소문자, 선행 '.' 제외). 예: "png". 확장자 없으면 빈 문자열.
   * 폴더는 빈 문자열.
   */
  readonly ext: string
  /** Windows 파일 속성 매핑. */
  readonly attrs: FileAttributesDTO
}

/** 드라이브 종류(아이콘·정렬 힌트). features F장 네트워크 드라이브 예외. */
export type DriveKind = 'fixed' | 'removable' | 'network' | 'cdrom' | 'ram' | 'unknown'

/** "내 PC" 드라이브 목록 1개 항목 (fs:drives). */
export interface DriveDTO {
  /** 드라이브 루트 경로. 예: "C:\\" */
  readonly path: string
  /** 표시 라벨. 볼륨 라벨이 있으면 "로컬 디스크 (C:)" 형태, 없으면 "C:\\". */
  readonly label: string
  /** 드라이브 문자(대문자, ':' 제외). 예: "C". 네트워크 UNC 는 빈 문자열. */
  readonly letter: string
  /** 드라이브 종류. */
  readonly kind: DriveKind
  /** 총 용량(바이트). 조회 불가 시 null. */
  readonly totalBytes: number | null
  /** 사용 가능(바이트). 조회 불가 시 null. */
  readonly freeBytes: number | null
  /** 마운트/접근 가능 여부. false 면 빈/오류 표시. */
  readonly ready: boolean
}

// ────────────────────────────────────────────────────────────────────────
// 디렉토리 목록 결과 (단발 + 스트리밍 청크)
// ────────────────────────────────────────────────────────────────────────

/**
 * 단발 디렉토리 목록 결과(fs:list). 소형 폴더용.
 * 대형 폴더는 fs:list:start → chunk → done 스트림을 사용한다(SA §3.2 US-5.6).
 */
export interface DirListResult {
  /** 항목 목록(정렬은 Renderer 도메인 규칙에서 수행 — 자연정렬·폴더우선). */
  readonly entries: FileEntryDTO[]
  /** 상한 초과로 잘렸는지(매우 큰 폴더 안전장치). */
  readonly truncated: boolean
}

/** fs:list:start 응답 — 스트림 식별자 발급. */
export interface ListStreamStart {
  /** 이후 chunk/done/error/cancel 이벤트를 묶는 스트림 ID. */
  readonly streamId: string
}

/** fs:list:chunk 푸시 이벤트 페이로드(증분 항목 전달). */
export interface ListStreamChunk {
  readonly streamId: string
  /** 이 청크의 항목들(누적 아님 — Renderer 가 이어붙인다). */
  readonly entries: FileEntryDTO[]
}

/** fs:list:done 푸시 이벤트 페이로드(스캔 완료·총개수 확정). */
export interface ListStreamDone {
  readonly streamId: string
  /** 전달된 총 항목 수(showHidden 필터 적용 후). */
  readonly total: number
  /** 상한 초과로 잘렸는지. */
  readonly truncated: boolean
}

// ────────────────────────────────────────────────────────────────────────
// 경로 검증 / 트리
// ────────────────────────────────────────────────────────────────────────

/** fs:validate-path 결과 — 주소창 입력 검증용(US-3.1). */
export interface PathValidation {
  /** 대상이 실제 존재하는가. */
  readonly exists: boolean
  /** 존재한다면 디렉토리인가(파일이면 false). */
  readonly isDir: boolean
  /** 정규화된 절대 경로(존재 여부와 무관하게 형태 정규화 결과). */
  readonly normalized: string
}

// ────────────────────────────────────────────────────────────────────────
// 파일 작업 요약 (op:* — 계약만 동결, 구현 P4)
// ────────────────────────────────────────────────────────────────────────

/** 작업 종류. */
export type OpKind = 'copy' | 'move' | 'delete' | 'trash'

/** 충돌 해소 정책(사전 일괄 또는 개별 질의 응답). */
export type ConflictResolution = 'overwrite' | 'skip' | 'rename' | 'merge'

/** 사전 일괄 충돌 정책(없으면 충돌 시 op:conflict 로 질의). */
export type ConflictPolicy = ConflictResolution

/** 작업 중 개별 실패 항목 기록(부분 실패 보고). */
export interface OpFailure {
  readonly path: string
  /** 실패 원인 코드(FileOpError 와 동일 코드 체계). */
  readonly code: FileOpErrorCode
  readonly message: string
}

/** op:done 요약(성공/실패 목록·취소 여부). */
export interface OpSummary {
  readonly operationId: string
  readonly kind: OpKind
  readonly succeededItems: number
  readonly failedItems: number
  readonly canceled: boolean
  /** 실패 항목 상세(없으면 빈 배열). */
  readonly failures: OpFailure[]
}

// ────────────────────────────────────────────────────────────────────────
// 세션 / 설정 스냅샷 (session:* / settings:* — 계약만 동결, 구현 P5)
// ────────────────────────────────────────────────────────────────────────

export type LayoutKind = 'single' | 'split-2-h' | 'split-2-v' | 'grid-4'
export type SortKey = 'name' | 'size' | 'ext' | 'mtime'
export type SortDir = 'asc' | 'desc'
export type ViewMode = 'list' | 'details'
export type ThemeMode = 'light' | 'dark' | 'system'

/** 패널 1개의 직렬화 상태(SA §5.1). 선택·스트림 상태는 휘발 → 제외. */
export interface PanelSnapshot {
  readonly id: string
  readonly path: string
  readonly sortKey: SortKey
  readonly sortDir: SortDir
  readonly viewMode: ViewMode
  readonly history: { readonly back: string[]; readonly forward: string[] }
  readonly scrollTop: number
}

/** 분할 패널 크기 비율(첫째 패널/행 비중, 0.15~0.85). 2분할은 한 축만 사용. */
export interface SplitRatios {
  /** 가로 분할(좌/우) 첫째 열 비중. split-2-h·grid-4 사용. */
  readonly col: number
  /** 세로 분할(상/하) 첫째 행 비중. split-2-v·grid-4 사용. */
  readonly row: number
}

/** 탭 1개의 직렬화 상태. */
export interface TabSnapshot {
  readonly id: string
  readonly activePanelId: string
  readonly layout: LayoutKind
  readonly panels: PanelSnapshot[]
  /** 분할 패널 크기 비율(feat-H3). 없으면 균등(0.5/0.5)으로 폴백. */
  readonly splitRatios?: SplitRatios
}

/** 창 1개의 직렬화 상태. closedHistory(닫은 탭 복원 스택)는 휘발 → 제외(SA §5.1). */
export interface WindowSnapshot {
  readonly tabs: TabSnapshot[]
  readonly activeTabId: string
}

/** 사이드바 직렬화 상태(즐겨찾기·최근·폭·접힘). */
export interface SidebarSnapshot {
  readonly favorites: string[]
  readonly recent: string[]
  readonly width: number
  readonly collapsed: boolean
}

/** 전체 세션 스냅샷(SA §5.1). session:load/save. */
export interface SessionSnapshot {
  /** 스키마 버전(마이그레이션·손상 폴백 판정, SA §5.3). */
  readonly version: number
  readonly windows: WindowSnapshot[]
  readonly sidebar: SidebarSnapshot
  readonly ui: { readonly theme: ThemeMode; readonly previewOpen: boolean }
}

/** 앱 설정 스냅샷(settings:get/set). features E6·F장(숨김/확장자 토글). */
export interface SettingsSnapshot {
  readonly version: number
  readonly theme: ThemeMode
  /** 기본 시작 위치(빈 문자열이면 "내 PC"). */
  readonly startLocation: string
  /** 숨김/시스템 파일 표시(기본 false → fs:list showHidden 로 연동). */
  readonly showHidden: boolean
  /** 확장자 표시(기본 true → FileListView 이름 표기 토글). */
  readonly showExtensions: boolean
  /** 최근 목록 보관 개수. */
  readonly recentLimit: number
}

/** 워크스페이스 1개 메타(workspace:list — 계약만 동결, 구현 P6). */
export interface WorkspaceInfo {
  readonly name: string
  /** 저장 시각(epoch ms). */
  readonly savedAt: number
}

// ────────────────────────────────────────────────────────────────────────
// 미리보기 (preview:* — 신규 P6 Should, US-4.3)
// ────────────────────────────────────────────────────────────────────────

/** 미리보기 종류(렌더러 형식별 렌더러 선택 키). */
export type PreviewKind = 'image' | 'text' | 'meta' | 'unsupported'

/**
 * preview:read 결과. kind 에 따라 payload 필드가 채워진다(나머지는 undefined).
 * 직렬화 가능 타입만(이미지는 base64 data URL, 시각은 number).
 */
export interface PreviewData {
  readonly kind: PreviewKind
  /** 공통 메타(항상 채움). */
  readonly name: string
  readonly path: string
  readonly size: number
  /** 수정 시각 (epoch ms, UTC). */
  readonly mtime: number
  /** 확장자(소문자, 선행 '.' 제외). */
  readonly ext: string
  /** kind==='image': data URL(`data:image/png;base64,...`). 상한 초과 시 undefined+truncated. */
  readonly dataUrl?: string
  /** kind==='text': 앞부분 텍스트(상한까지). */
  readonly text?: string
  /** kind==='text'|'image': 상한 초과로 잘렸는지(전체 표시 아님 안내). */
  readonly truncated?: boolean
  /** kind==='unsupported': 사유 표시용 라벨(예: '바이너리','크기 초과'). */
  readonly reason?: string
}

// ────────────────────────────────────────────────────────────────────────
// 오류 코드 (FileOpError 와 contracts 가 공유)
// ────────────────────────────────────────────────────────────────────────

/**
 * 도메인 오류 코드. node `fs` errno 코드 + 도메인 추가 코드.
 * Result.err 로 1급 전파되어 UI 가 사유를 표시한다(throw 금지, ADR-003).
 */
export type FileOpErrorCode =
  | 'EEXIST' // 동명 항목 존재(이름 충돌)
  | 'EINVAL' // 금지문자·예약명·빈 이름 등 잘못된 입력
  | 'EACCES' // 권한 거부
  | 'ENOENT' // 경로 없음
  | 'EBUSY' // 사용 중(잠김)
  | 'EPERM' // 작업 불허(읽기전용·보호)
  | 'ENOTDIR' // 디렉토리가 아님
  | 'EISDIR' // 디렉토리임(파일 기대)
  | 'ELOOP' // 순환 링크
  | 'ENOSPC' // 디스크 공간 부족
  | 'ESECURITY' // guard 차단(상위 이탈·보호 경로·senderFrame 불일치)
  | 'ECANCELED' // 사용자 취소
  | 'EUNKNOWN' // 분류 불가
