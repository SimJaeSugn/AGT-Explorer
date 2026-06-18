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

/** 빠른 위치(알려진 폴더) 경로 (fs:known-folders). 조회 불가 항목은 빈 문자열. */
export interface KnownFoldersDTO {
  /** 다운로드 폴더 절대경로. */
  readonly downloads: string
  /** 바탕화면. */
  readonly desktop: string
  /** 문서. */
  readonly documents: string
  /** 홈(사용자 프로필). */
  readonly home: string
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
  /**
   * 사용 중(잠긴) 등으로 **건너뛴** 항목(오류 아님 — 삭제/이동에서 EPERM/EBUSY). failedItems 에
   * 포함되지 않으며 작업은 실패로 취급하지 않는다. 없으면 생략/빈 배열.
   */
  readonly inUse?: OpFailure[]
}

// ────────────────────────────────────────────────────────────────────────
// 디렉토리 사용량 Top10 스캔 (analyze:scan:* — 신규 I장, 계약만 동결)
// ────────────────────────────────────────────────────────────────────────

/** 스캔 상위 항목(폴더 또는 파일) 1개. */
export interface ScanEntry {
  /** 정규화된 절대 경로. */
  readonly path: string
  /** 표시 이름. */
  readonly name: string
  /** 바이트 크기. 폴더는 재귀 합계, 파일은 자기 크기. */
  readonly bytes: number
  /** 디렉토리 여부. */
  readonly isDir: boolean
}

/**
 * 파일 확장자 카테고리(K3 유형별 비중). 확장자→카테고리 분류의 키 집합.
 * scanEngine 의 byCategory 집계·대시보드 라벨이 공유한다.
 * 미등록/빈 확장자는 'other'.
 */
export type FileCategory =
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'code'
  | 'archive'
  | 'other'

/** 확장자 카테고리별 용량/개수 집계 1건(K3). */
export interface CategoryUsage {
  /** 카테고리 키. */
  readonly category: FileCategory
  /** 해당 카테고리 파일들의 바이트 합계. */
  readonly bytes: number
  /** 해당 카테고리 파일 개수(폴더 제외). */
  readonly count: number
}

/** analyze:scan:done 결과 — 상위 N 폴더/파일 + 요약(계획서 §2.3). */
export interface ScanResult {
  /** 스캔 루트 경로(폴더 또는 드라이브). */
  readonly root: string
  /** 트리 전체 바이트 합계. */
  readonly totalBytes: number
  /** 스캔한 항목 총 개수. */
  readonly totalItems: number
  /** 상위 폴더(bytes desc, 최대 10). */
  readonly topFolders: ScanEntry[]
  /** 상위 파일(bytes desc, 최대 10). */
  readonly topFiles: ScanEntry[]
  /** 권한거부·순환으로 건너뛴 항목 수(격리 카운트). */
  readonly skipped: number
  /** 사용자 취소로 중단되었는지. */
  readonly canceled: boolean
  /** 항목 상한 초과로 잘렸는지. */
  readonly truncated: boolean
  /**
   * 파일 유형(카테고리)별 용량/개수 집계(K3). **비파괴 추가(optional)** —
   * 기존 소비측은 무시, 신규 대시보드 섹션만 사용. scanEngine byCategory
   * 집계 impl 은 K장 다음 단계(현재 미산출 → 소비측은 없으면 폴백).
   */
  readonly byCategory?: CategoryUsage[]
}

// ────────────────────────────────────────────────────────────────────────
// 휴지통 (trash:* — 신규 K장 K2, 계약만 동결)
// ────────────────────────────────────────────────────────────────────────

/**
 * 휴지통 항목 1개(trash:list). Windows 휴지통 COM 열거 결과의 경량 표현.
 * 직렬화 가능 타입만(시각은 number).
 */
export interface TrashItemDTO {
  /**
   * 복원 토큰 = 휴지통 내부 실경로($Recycle.Bin\...\$R...). 복원/식별 키이며
   * 이름 동명 다수에도 안전(restore 가 이 id 로 매칭). 핸들러는 $Recycle.Bin
   * 화이트리스트만 통과시킨다(임의 경로 실행 차단).
   */
  readonly id: string
  /** 표시 이름(원래 파일명). */
  readonly name: string
  /** 원래 전체 경로(DeletedFrom\Name). 조회 불가 시 빈 문자열. */
  readonly originalPath: string
  /** 삭제 시각(epoch ms, UTC). 파싱 실패 시 0. */
  readonly deletedAt: number
  /** 바이트 크기. 폴더는 0 또는 집계불가. */
  readonly size: number
}

// ────────────────────────────────────────────────────────────────────────
// 세션 / 설정 스냅샷 (session:* / settings:* — 계약만 동결, 구현 P5)
// ────────────────────────────────────────────────────────────────────────

export type LayoutKind = 'single' | 'split-2-h' | 'split-2-v' | 'grid-4'
export type SortKey = 'name' | 'size' | 'ext' | 'mtime'
export type SortDir = 'asc' | 'desc'
/**
 * 보기 모드(J4 — Windows "보기" 5종). `icons-*` 3종은 아이콘 그리드(대/중/소),
 * `list`·`details` 는 기존 행 기반. 그리드 판정은 `viewMode.startsWith('icons-')`.
 * 구버전/미지 값은 coerce 가 'details' 로 폴백한다(defaults.ts VIEW_MODES).
 */
export type ViewMode = 'icons-large' | 'icons-medium' | 'icons-small' | 'list' | 'details'
/** 테마 모드. 'bluelight' = 블루라이트 차단(저청색광 크림 톤, I장). */
export type ThemeMode = 'light' | 'dark' | 'system' | 'bluelight'

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
  /**
   * 사용자 지정 탭 이름(Feature A). 비파괴-optional — 없으면 자동 제목(폴더명) 복귀.
   * 스키마 미상향(splitRatios 선례). coerce 가 빈/비문자열을 생략한다.
   */
  readonly customName?: string
  /** 탭 색상 라벨 키(US-20.3·TAG_PALETTE 키). 미설정이면 생략. */
  readonly color?: string
  /** 탭 잠금(US-20.3). true 일 때만 직렬화(false/누락은 미잠금). */
  readonly locked?: boolean
  /**
   * 루트 잠금 맵(백로그 ①). 잠금 시점 **각 분할 패널이 자신의 경로**로 고정된 루트를
   * 패널 id(PanelSnapshot.id) 별로 보관한다. 잠금 동반·비-빈 항목만 직렬화.
   */
  readonly lockedRoots?: Readonly<Record<string, string>>
}

/** 창 1개의 직렬화 상태. closedHistory(닫은 탭 복원 스택)는 휘발 → 제외(SA §5.1). */
export interface WindowSnapshot {
  readonly tabs: TabSnapshot[]
  readonly activeTabId: string
}

/** 사이드바 직렬화 상태(즐겨찾기·최근·폭·접힘). */
export interface SidebarSnapshot {
  readonly favorites: string[]
  /**
   * 즐겨찾기 별칭 맵(J8 — path→label). 비파괴 추가: 없으면 UI 가 basename 폴백.
   * 키는 favorites 에 존재하는 경로만 보존(coerce 가 고아 라벨 제거). 스키마 버전 미상향.
   */
  readonly favoriteLabels?: Record<string, string>
  /**
   * 디렉토리별 "상단 고정" 항목 맵(dirPath → 고정 항목 경로 배열). 비파괴 추가:
   * 없으면 빈 맵(고정 없음). coerce 가 빈 배열 키·비문자열 항목을 정리. 스키마 버전 미상향.
   */
  readonly pinnedByDir?: Record<string, string[]>
  /**
   * 파일 태그/색상 라벨 맵(T1·US-19.1 — path → 태그 키 배열). 비파괴 추가: 없으면
   * 빈 맵(태그 없음). coerce(coerceTagsByPath)가 유효 팔레트 키만·빈 배열 키는 정리한다.
   * 한 경로에 다중 태그 가능. 스키마 버전 미상향(구버전 세션 호환). 정규화 단일 출처는
   * renderer domain/rules/tags(normalizeTags·isTagKey)와 defaults.ts 미러.
   */
  readonly tagsByPath?: Record<string, string[]>
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
  readonly ui: {
    readonly theme: ThemeMode
    readonly previewOpen: boolean
    /** 미리보기 패널 폭(px, J7). 미지정 시 복원 측 320 폴백. coerce 클램프 240~720. */
    readonly previewWidth?: number
    /**
     * 자세히(details) 보기 고정폭 열 너비(px·전역 설정). 비파괴 추가: 없으면 복원 측
     * 기본값(size 90/type 60/mtime 140) 폴백. coerce 가 각 열을 48~600 클램프. 이름 열은
     * flex 라 저장 폭 없음. 스키마 버전 미상향(구버전 세션 호환).
     */
    readonly detailsColumnWidths?: DetailsColumnWidthsDTO
  }
  /**
   * 현재 선택된 워크스페이스 이름(US-5.8 확장). 선택 중이면 세션 자동저장이
   * 같은 스냅샷을 해당 워크스페이스 파일에도 기록한다(자동 저장).
   * 비파괴 추가: 미선택/구버전 세션은 키 생략 → 복원 측 null 폴백. 스키마 버전 미상향.
   */
  readonly currentWorkspace?: string
}

/**
 * 자세히 보기 고정폭 열 너비 DTO(px). 세션 ui 에 optional 로 직렬화된다.
 * 이름(name) 열은 남은 공간을 flex 로 채우므로 저장 폭이 없다. 정규화/클램프 단일
 * 출처는 renderer domain/rules/columnWidths(coerceDetailsColumnWidths·48~600).
 */
export interface DetailsColumnWidthsDTO {
  readonly size: number
  readonly type: number
  readonly mtime: number
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
  /** 프로그램 시작 시 용량 대시보드 자동 표시(기본 true, I장 §4.4·§6.5). */
  readonly showDashboardOnStartup: boolean
  /**
   * 복사 후 체크섬 검증(§R4·US-17.4·F25·Could). 켜면 복사 op 완료(op:done) 후
   * 원본↔사본 SHA-256 해시 비교(hash:verify)로 무결성을 검증한다. 기본 off(비파괴 —
   * 끄면 복사 동작 무변경·신규 채널 0). 비파괴 추가(optional) — 구버전 설정은
   * coerce 가 false 폴백(defaults.ts). 신규 채널 0(hash:verify 재사용·ADR-009).
   */
  readonly verifyOnCopy?: boolean
  /**
   * 상단 아이콘바에서 숨길 명령 id 목록(단축아이콘 설정). 비면 전부 표시(기본).
   * 비파괴 추가(optional) — 구버전 설정(키 누락)은 빈 배열 폴백. 신규 채널 0
   * (settings:set 재사용). 설정 화면 레이아웃>단축아이콘에서 토글한다.
   */
  readonly iconBarHidden?: readonly string[]
  /**
   * 상단 아이콘바 명령 id 표시 순서(드래그 재배열 결과). 비면 기본 정의 순서
   * (iconBarItems 의 ICON_BAR_ITEMS). 알 수 없는/누락 id 는 복원 시 무시·신규
   * 항목은 기본 순서로 뒤에 덧붙인다. 비파괴 추가(optional)·신규 채널 0.
   */
  readonly iconBarOrder?: readonly string[]
}

/** 워크스페이스 1개 메타(workspace:list — 계약만 동결, 구현 P6). */
export interface WorkspaceInfo {
  readonly name: string
  /** 저장 시각(epoch ms). */
  readonly savedAt: number
}

// ────────────────────────────────────────────────────────────────────────
// 듀얼 패널 폴더 비교 (§P1 — US-15.1 · F20 · ADR-009 · M6 메타 비교만)
// ────────────────────────────────────────────────────────────────────────

/**
 * 폴더 비교 4상태(§P1). 좌/우 패널 항목을 이름 기준으로 짝지어 분류한다.
 *   - left-only  : 좌측에만 존재
 *   - right-only : 우측에만 존재
 *   - diff       : 양쪽 존재·메타(크기/수정일/종류) 다름
 *   - same       : 양쪽 존재·메타 동일
 *
 * **M6 스코프: 단일 깊이 메타 비교만**. 해시(내용) 비교·재귀 하위폴더 비교는
 * M7(ADR-009 `hash:compare:*`)로 연기. 분류는 렌더러 도메인 순수규칙
 * (domain/rules/compare.ts)이 이미 로드된 양 패널 entries 로 수행한다(신규 채널 0).
 */
export type CompareStatus = 'left-only' | 'right-only' | 'diff' | 'same'

/**
 * 비교 페어 1건의 직렬화 표현(추적성·M7 `hash:compare:done` 결과 호환용 등록).
 * M6는 렌더러 내부 도메인 타입(ComparePair)으로 충분하나, 계약 단일출처(추적성
 * §1-P)를 위해 DTO 에 선등록한다. left/right 는 FileEntryDTO(없으면 null).
 */
export interface ComparePairDTO {
  readonly name: string
  readonly left: FileEntryDTO | null
  readonly right: FileEntryDTO | null
  readonly status: CompareStatus
  /**
   * 재귀 비교(P1·recursive=true) 시 좌/우 루트 기준 상대경로(예: "sub\\a.txt").
   * 재귀에서 다른 하위 폴더의 동명 항목 충돌을 피하는 짝지음 키이며, 표시 들여쓰기·
   * 깊이 산출에 쓰인다. **M6 단일깊이 메타 비교는 미사용(undefined)·동치**(비파괴 추가).
   */
  readonly relPath?: string
}

/** 비교 4상태 카운트 요약(합 = total). */
export interface CompareSummary {
  readonly leftOnly: number
  readonly rightOnly: number
  readonly diff: number
  readonly same: number
  readonly total: number
}

// ────────────────────────────────────────────────────────────────────────
// 공용 해시·비교 엔진 (hash:* — 신규 M7, ADR-009)
//   P1 해시/재귀 비교 · R2 중복 찾기 · R4 체크섬 검증이 공유하는 DTO.
//   기존 §P1 메타 비교(ComparePairDTO·CompareSummary)는 비파괴 — append 만.
// ────────────────────────────────────────────────────────────────────────

/**
 * 해시 알고리즘(ADR-009 결정①). 1차 'sha256' 1종(Node 내장·의존 0).
 * algo 파라미터화로 후속 고속화(xxHash/BLAKE3 wasm — UQ-H1) 교체 여지를 둔다.
 */
export type HashAlgo = 'sha256'

/**
 * R2 중복 그룹 1건 — 내용 동일(같은 크기 + 같은 해시) 파일 묶음.
 * files 는 항상 2개 이상(중복만 그룹화). 유일 크기는 해시 0(비용 통제·ADR-009 결정③).
 */
export interface DupGroupDTO {
  /** 그룹 식별 해시(표시·중복판정). */
  readonly hash: string
  /** 그룹 공통 바이트(같은 크기). */
  readonly size: number
  /** 동일 내용 파일(2개 이상). */
  readonly files: DupFileDTO[]
}

/** 중복 그룹에 속한 파일 1개의 경량 표현. */
export interface DupFileDTO {
  readonly path: string
  readonly name: string
  /** 수정 시각(epoch ms, UTC). 원본 선택 보조(가장 오래된 것 보존 등). */
  readonly mtime: number
}

/**
 * R4 체크섬 불일치 1건. 일치 수(verified)는 hash:verify:done evt 에 합산된다.
 * reason: hash-mismatch=내용 다름, size-mismatch=크기 다름(해시 회피), read-error=읽기 실패.
 */
export interface VerifyMismatchDTO {
  readonly src: string
  readonly dst: string
  readonly reason: 'hash-mismatch' | 'size-mismatch' | 'read-error'
}

/**
 * P1 해시/재귀 비교 결과(Main compareEngine → 렌더러). 짝지음·4상태 분류 단일출처는
 * ComparePairDTO(M6 재사용·relPath 옵셔널 추가는 P1해시 단계). usedHash/recursive 는
 * 실제 적용된 옵션(정직 표기), truncated 는 항목 상한 도달.
 */
export interface CompareResultDTO {
  /** 4상태(left-only/right-only/diff/same)·재귀면 상대경로(relPath) 포함. */
  readonly pairs: ComparePairDTO[]
  readonly summary: CompareSummary
  readonly usedHash: boolean
  readonly recursive: boolean
  /** 항목 상한 도달로 잘렸는지(정직 표기). */
  readonly truncated: boolean
}

// ────────────────────────────────────────────────────────────────────────
// 전송 큐 (queue:* — 신규 M7, ADR-011) — W0 타입 동결, 큐 핸들러 impl: W2
//   큐 항목 = 기존 operationId(op:* 재사용). 단발 작업도 "큐 길이 1"로 흡수.
// ────────────────────────────────────────────────────────────────────────

/** 큐 항목 작업 종류(로컬 op + 원격 download/upload 통합). */
export type QueueItemKind = 'copy' | 'move' | 'delete' | 'trash' | 'remote-download' | 'remote-upload'

/** 큐 항목 상태 머신. pending→running→(done|failed|canceled), running↔paused. */
export type QueueItemStatus = 'pending' | 'running' | 'paused' | 'done' | 'failed' | 'canceled'

/**
 * 큐 항목 1건(queue:list / queue:state). operationId 로 식별(기존 op 재사용).
 * 진행률·속도·ETA 는 op:progress 와 동형 누계. sources/destSummary 는 표시용 요약
 * (경로 전체 미수록 — 프라이버시·전송비용). 큐 스케줄러 impl: W2.
 */
export interface QueueItemDTO {
  readonly operationId: string
  readonly kind: QueueItemKind
  readonly status: QueueItemStatus
  /** "3개 항목" 등 소스 요약(표시용). */
  readonly sourcesSummary: string
  /** 대상 디렉토리 요약(표시용). */
  readonly destSummary: string
  readonly processedBytes: number
  readonly totalBytes: number
  readonly processedItems: number
  readonly totalItems: number
  readonly bytesPerSec: number
  /** 남은 예상 시간(초). 산출 불가 시 null. */
  readonly etaSec: number | null
  /** 큐 진입 시각(epoch ms, FIFO 정렬). */
  readonly enqueuedAt: number
}

// ────────────────────────────────────────────────────────────────────────
// 내용 검색 grep (search:content:* — 신규 M8 Should, US-18.1·ADR-010)
// ────────────────────────────────────────────────────────────────────────

/** 한 파일 내 일치 줄(라인 번호·발췌·하이라이트 구간). ranges 는 [start,end) end-exclusive. */
export interface GrepLineDTO {
  readonly lineNo: number
  readonly text: string
  readonly ranges: ReadonlyArray<readonly [number, number]>
}

/** 파일 단위 grep 결과(증분 푸시 단위). */
export interface GrepMatchDTO {
  readonly file: string
  readonly lines: GrepLineDTO[]
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
  /** kind==='text': 구문강조 언어 힌트(확장자→언어, backend 가 매핑·미상이면 undefined). J6. */
  readonly lang?: string
  /** kind==='text': 마크다운 원문 여부(ext∈{md,markdown}). 렌더러가 마크다운 렌더 선택. J6. */
  readonly isMarkdown?: boolean
}

// ────────────────────────────────────────────────────────────────────────
// 외부 연계 §M — 클립보드 CF_HDROP · 원격(FTP/SFTP) (신규, 계약만 동결 MP1)
// ────────────────────────────────────────────────────────────────────────

/**
 * 시스템 클립보드 파일 효과(M2 CF_HDROP). write 는 copy/cut 의도를,
 * read 는 Preferred DropEffect(DROPEFFECT_COPY/MOVE) 해석 결과를 표현한다.
 * 'none' = 클립보드에 파일이 없음(에러 아님 — 정상 빈 결과).
 */
export type ClipboardEffectKind = 'copy' | 'move' | 'none'

/**
 * 원격 프로토콜(M3). ftp=평문(비암호화·encrypted=false 신호), ftps=암시적/명시적
 * TLS, sftp=SSH 위 파일전송.
 */
export type RemoteProtocol = 'ftp' | 'ftps' | 'sftp'

/**
 * 원격 인증 방식. privateKey 는 SFTP 전용(FTP/FTPS 는 password 만).
 * ⚠ 본 타입은 "방식"만 식별한다 — 비밀 본문(password/passphrase/privateKey)은
 * 어떤 영속·전송 DTO 에도 두지 않는다(구조적 배제·ADR-007 ③).
 */
export type RemoteAuthMethod = 'password' | 'privateKey'

/**
 * 원격 접속 프로필(M3) — **비밀 제외 메타만**(ADR-007 ③).
 * profiles.json 에 영속되며 IPC 로 전송된다. 비밀(password/passphrase/privateKey
 * 본문)은 이 DTO 에 **필드 자체가 없다**(컴파일 타임 구조적 배제). 비밀은 별도
 * remote:cred:save / remote:connect 요청 본문으로만 main 에 전달되어 즉시 safeStorage
 * 로 가며, 응답·로그·Error 에는 절대 포함되지 않는다(ADR-007 ⑥).
 */
export interface RemoteProfileDTO {
  /** 안정 키. 자격증명 키 = `remote:<id>`. */
  readonly id: string
  /** 표시 라벨. */
  readonly name: string
  readonly protocol: RemoteProtocol
  readonly host: string
  /** 포트(ftp 21 / sftp 22 기본 — 제안·검증은 backend). */
  readonly port: number
  readonly username: string
  readonly authMethod: RemoteAuthMethod
  // ⚠ 비밀(password/passphrase/privateKey 본문) 필드 없음 — 구조적 배제(ADR-007 ③).
}

/**
 * 원격 오류 코드(M3). RemoteError = FileOpError(별도 타입 아님·직렬화 동일)이며
 * code 유니온만 아래로 확장한다(ADR-007 결정⑥). 기존 FileOpError 소비측은 unknown
 * code 를 generic 폴백 처리한다(하위호환). 메시지에 비밀 절대 미수록.
 */
export type RemoteErrorCode =
  | 'EAUTH' // 인증 실패(재입력 유도)
  | 'ETIMEDOUT' // 연결/응답 타임아웃
  | 'ECONNRESET' // 연결 끊김
  | 'EHOSTUNREACH' // 호스트 도달 불가
  | 'EHOSTKEY' // 호스트키 미신뢰/변경(TOFU)
  | 'EUNSUPPORTED' // 프로토콜 미지원 동작/환경

// ────────────────────────────────────────────────────────────────────────
// 셸 컨텍스트 verb (shell:context-verbs / shell:invoke-verb — 신규 §Y1)
// ────────────────────────────────────────────────────────────────────────

/**
 * 셸 컨텍스트 verb 1개(§Y1). Main 이 COM `Shell.Application` `Verbs()` 열거 →
 * 블랙리스트 필터 후 렌더러로 전달한다(렌더러는 표시만).
 * verbId = `"<index>:<정규화표시명>"` 안정 합성키(React key·실행 시 재열거 교차검증).
 */
export interface ShellVerbDTO {
  readonly verbId: string
  /** 사용자 표시 라벨(정규화된 표시명 — `&` 가속기 제거). */
  readonly display: string
}

/**
 * "새로 만들기" 하위 메뉴 항목 1개 — Windows 레지스트리 ShellNew 핸들러 1종.
 * Main 이 `HKEY_CLASSES_ROOT\.확장자\ShellNew` 를 열거(안전 3종: NullFile·FileName·Data)해
 * 렌더러로 전달한다. id(확장자 키)는 생성 시 레지스트리 재조회용 안정 식별자.
 */
export interface ShellNewItemDTO {
  /** 확장자 키(예: ".txt") — 생성 시 레지스트리 재조회 식별자(React key). */
  readonly id: string
  /** 확장자(예: ".txt"). */
  readonly ext: string
  /** 친숙한 형식명(예: "텍스트 문서") — 메뉴 표시 라벨. */
  readonly label: string
}

// ────────────────────────────────────────────────────────────────────────
// agent:* 자연어 파일 에이전트 DTO (신규 §Z — ADR-014·ADR-015)
// 비밀(API 키) 필드는 어떤 DTO 에도 구조적으로 부재(평문 0·렌더러 미노출·G5).
// ────────────────────────────────────────────────────────────────────────

/** LLM 제공자 식별자(ADR-015 G1). */
export type ProviderId = 'anthropic' | 'openai' | 'internal'

/** 제공자 비-비밀 설정(키 필드 없음). */
export interface ProviderConfig {
  readonly id: ProviderId
  /** anthropic/openai 티어=plan 실모델 ID(선택·기본 상수). */
  readonly planModel?: string
  /** 티어=light 실모델 ID. */
  readonly lightModel?: string
  /** internal 만 — 화이트리스트 등록된 호스트 base URL. */
  readonly baseUrl?: string
  /** internal 단일 모델 ID. */
  readonly modelId?: string
  /** internal capability 플래그(degradation·G3). */
  readonly supportsToolUse?: boolean
}

/** 모델 메타(목록·UI 표시). */
export interface ModelInfo {
  readonly id: string
  readonly label: string
  readonly tier?: 'plan' | 'light'
}

/**
 * 이름 있는 위치 1건(§Z list_locations — 좌측 사이드바·패널 → 실경로 매핑).
 * 렌더러가 store 상태에서 모아 `AgentRunReq.context.locations` 로 전달하고,
 * `list_locations` 읽기 도구가 이를 **순수 패스스루**(fs 접근 0)로 모델에 반환한다.
 * 에이전트는 name 매칭으로 path 를 획득해 list_directory 등에 넘긴다.
 */
export interface AgentLocationItem {
  /** 표시 이름(즐겨찾기=별칭??폴더명, 빠른위치=라벨, 최근/드라이브=라벨, 패널=번호 라벨). */
  readonly name: string
  /** 실제 경로(로컬 절대경로 또는 원격/archive 가상경로). */
  readonly path: string
}

/** 패널 위치 1건(§Z — index=패널 번호 1~4, active=활성 탭의 활성 패널 여부). */
export interface AgentPanelLocation {
  /** 패널 번호(1~4, 활성 탭 panelIds 순서). */
  readonly index: number
  readonly path: string
  readonly active: boolean
}

/**
 * 이름 있는 위치 모음(§Z — `AgentRunReq.context.locations`, 비파괴 옵셔널).
 * 값은 렌더러(store)에서 모아 전달받는다(main 은 fs 미접근 패스스루). 각 카테고리는
 * 옵셔널 — 없으면 list_locations 가 해당 항목을 비워 반환한다. 경로는 스코프 확장 시
 * isSystemPath(시스템 폴더) / isVirtualPath(원격·archive)로 추가 필터된다(scope.ts).
 */
export interface AgentLocations {
  /** 즐겨찾기(name=favoriteLabels 별칭 또는 폴더명). */
  readonly favorites?: readonly AgentLocationItem[]
  /** 빠른 위치(다운로드/바탕화면/문서/홈 — knownFolders). */
  readonly quickAccess?: readonly AgentLocationItem[]
  /** 최근 방문(name=폴더명). */
  readonly recent?: readonly AgentLocationItem[]
  /** 드라이브(name=드라이브 라벨). */
  readonly drives?: readonly AgentLocationItem[]
  /** 패널 1~4(활성 탭). */
  readonly panels?: readonly AgentPanelLocation[]
}

/** 스테이징된 변경안 종류(쓰기 도구 — Z2 에서 적재·실행은 Z3 op:* 재사용). */
export type PlannedOpKind = 'move' | 'copy' | 'rename' | 'mkdir' | 'trash'

/** 변경안 1건(LLM 이 staged·사용자 diff 게이트·즉시 실행 0). */
export interface PlannedOp {
  readonly opId: string
  readonly kind: PlannedOpKind
  /** move/copy/trash 대상. */
  readonly sources?: readonly string[]
  /** move/copy/mkdir(parent). */
  readonly destDir?: string
  /** rename 대상. */
  readonly path?: string
  /** rename/mkdir 새 이름. */
  readonly newName?: string
  /** 사용자 diff 용 근거(LLM 설명). */
  readonly reason: string
}

/** confirm 재검증을 통과해 op:start 로 정규화된 실행 단위(렌더러가 startOperation 호출). */
export interface ConfirmedOpDTO {
  readonly opId: string
  /** 'copy'|'move'|'trash' op:start, 또는 fs:mkdir/fs:rename 경로. */
  readonly kind: OpKind | 'mkdir' | 'rename'
  readonly sources: readonly string[]
  readonly destDir?: string
  readonly newName?: string
  readonly conflictPolicy?: ConflictResolution
}

// ────────────────────────────────────────────────────────────────────────
// 오류 코드 (FileOpError 와 contracts 가 공유)
// ────────────────────────────────────────────────────────────────────────

/**
 * 도메인 오류 코드. node `fs` errno 코드 + 도메인 추가 코드.
 * Result.err 로 1급 전파되어 UI 가 사유를 표시한다(throw 금지, ADR-003).
 *
 * §M(원격) 코드는 RemoteErrorCode 로 별도 정의 후 여기에 합류한다 —
 * RemoteError 가 별도 타입이 아니라 FileOpError 의 code 유니온 확장이라는
 * ADR-007 결정⑥ 직렬화 규약을 타입으로 보장한다.
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
  | 'EVERB' // §Y1 셸 verb 미존재/스테일(재열거 교차검증 불일치 — 실행 거부)
  | 'EUNKNOWN' // 분류 불가
  | RemoteErrorCode // §M 원격 코드 확장(EAUTH/ETIMEDOUT/ECONNRESET/EHOSTUNREACH/EHOSTKEY/EUNSUPPORTED)
