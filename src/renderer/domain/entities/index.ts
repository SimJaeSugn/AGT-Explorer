/**
 * 도메인 엔티티 타입 (renderer/domain/entities, SA §2).
 *
 * 순수 TS 타입만. React·IPC·zustand 를 import 하지 않는다(.eslintrc 경계).
 * shared/dto 의 직렬화 타입은 import 가능(타입 전용).
 *
 * Renderer 내부 상태 모델은 dto(직렬화 DTO)를 기반으로 하되,
 * 휘발 런타임 상태(스트림/선택/포커스)를 추가로 보유한다.
 */
import type {
  FileEntryDTO,
  LayoutKind,
  SortDir,
  SortKey,
  ViewMode
} from '@shared/dto'

export type { FileEntryDTO, LayoutKind, SortDir, SortKey, ViewMode }

/** 디렉토리 목록 로딩 상태머신(SA §2.3). */
export type DirectoryStatus =
  | 'idle'
  | 'loading'
  | 'streaming'
  | 'ready'
  | 'error'
  | 'empty'
  | 'denied'

/** 패널 1개의 현재 경로 목록 상태(휘발). */
export interface DirectoryView {
  readonly status: DirectoryStatus
  /** 정렬·필터 적용 전 원본 엔트리. */
  readonly entries: FileEntryDTO[]
  /** 진행 중 스트림 식별자(취소·라우팅용). 없으면 null. */
  readonly streamId: string | null
  /** 확정된 총 개수(done 수신 후). 진행 중이면 entries.length. */
  readonly total: number
  /** 상한 초과로 잘렸는지. */
  readonly truncated: boolean
  /** error/denied 상태일 때의 사유 코드·메시지. */
  readonly error: { readonly code: string; readonly message: string } | null
}

/** 패널 뷰 설정(보기 모드·정렬·폴더 우선). */
export interface ViewState {
  readonly viewMode: ViewMode
  readonly sortKey: SortKey
  readonly sortDir: SortDir
  /** 폴더를 항상 위로(파일보다 먼저) 정렬. */
  readonly folderFirst: boolean
}

/** 패널별 내비게이션 히스토리(뒤로/앞으로 스택). */
export interface NavHistory {
  readonly back: string[]
  readonly forward: string[]
}

/** 패널 1개의 검색/필터 상태(P5 에서 본격 사용, P2 는 자리만). */
export interface FilterState {
  /** 검색어(파일명 부분 일치). 빈 문자열이면 비활성. */
  readonly query: string
  /** 검색창 열림 여부. */
  readonly open: boolean
}

/**
 * 패널(독립 탐색 뷰). selection 은 selectionSlice 로 분리(초고빈도 갱신).
 * directoryView 의 entries 도 panelsSlice 에 두되 셀렉터로 격리 구독한다.
 */
export interface Panel {
  readonly id: string
  readonly path: string
  readonly nav: NavHistory
  readonly view: ViewState
  readonly directory: DirectoryView
  readonly filter: FilterState
  readonly scrollTop: number
  /**
   * 워처발 갱신(softRefresh) 시 1회성 스크롤 복원 값(휘발 — 세션 직렬화 제외).
   * `_applyPreserve` 가 set, FileListView 가 status==='ready'+높이 확정 시 1회 소비 후 null.
   * null 이면 복원 안 함(평상시·navigate·세션복원). buildSessionSnapshot 허용목록 추가 금지.
   */
  readonly pendingScrollRestore: number | null
}

/**
 * 분할 패널 크기 비율(feat-H3). 첫째 열/행 비중(0.15~0.85).
 * - col: 좌/우 분할의 좌측 비율. split-2-h·grid-4 가로축 공용.
 * - row: 상/하 분할의 상단 비율. split-2-v·grid-4 세로축 공용.
 * 미사용 축은 0.5 기본 유지.
 */
export interface SplitRatios {
  readonly col: number
  readonly row: number
}

/** 분할 비율 최소(반대편도 동일 보장 → 클램프 0.15~0.85). */
export const SPLIT_MIN_RATIO = 0.15

/** 분할 비율 기본(균등). */
export const SPLIT_DEFAULT: SplitRatios = { col: 0.5, row: 0.5 }

/** 탭(레이아웃 + 패널 N). */
export interface Tab {
  readonly id: string
  readonly layout: LayoutKind
  readonly panelIds: string[]
  readonly activePanelId: string
  /** 분할 비율(미설정 시 균등 0.5/0.5 로 간주). */
  readonly splitRatios?: SplitRatios
}

/** 닫은 탭 복원 스택 항목(휘발 — 세션 비직렬화). */
export interface ClosedTabRecord {
  readonly layout: LayoutKind
  /** 닫힐 당시 패널들의 경로·뷰 스냅샷. */
  readonly panels: Array<{
    readonly path: string
    readonly view: ViewState
  }>
  readonly activePanelIndex: number
}

/**
 * 원격 자격증명 비밀 입력(§M M3) — **UI→usecase 전달 전용**(영속·store 보관 금지).
 * shared/ipc 의 RemoteSecret 과 구조 동일(직렬화 호환)이나, ui 가 shared/ipc 를 import 할
 * 수 없어(.eslintrc) domain 에 ui-importable 한 입력 타입으로 둔다. 컴포넌트 로컬 state →
 * usecase → infra(connect/credSave 요청 본문)로만 흐르고 어디에도 영구 보관되지 않는다.
 */
export interface RemoteSecretInput {
  readonly kind: 'password' | 'passphrase' | 'privateKey'
  readonly value: string
}

/** 사이드바 트리 노드(드라이브→폴더 lazy 확장). */
export interface TreeNode {
  readonly path: string
  readonly label: string
  /** 드라이브 루트면 'drive', 일반 폴더면 'dir'. */
  readonly kind: 'drive' | 'dir'
  /** 펼쳐졌는지. */
  readonly expanded: boolean
  /** 자식 로드 상태. */
  readonly loading: boolean
  /** 자식 경로 목록(로드 전이면 null = 미확장). */
  readonly childPaths: string[] | null
}
