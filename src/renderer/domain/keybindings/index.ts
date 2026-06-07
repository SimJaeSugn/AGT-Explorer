/**
 * 단축키 표 단일 출처 (renderer/domain/keybindings) — PRD §8 표를 코드로 1회 선언.
 *
 * 순수 TS(부수효과 없음). UI 의 KeyBindingRegistry/Dispatcher 가 이 맵을 읽어
 * keydown → commandId 로 변환한다. 설정 화면(P5)도 이 맵을 읽어 표시한다 →
 * 표와 코드 불일치 방지(SA §7.1 단일 출처).
 *
 * commandId 는 SA §7.2 명명을 따른다(tab.* / panel.* / nav.* / file.* ...).
 */

/** 단축키가 활성화되는 컨텍스트(SA §7.1 컨텍스트 스코프). */
export type KeyContext =
  | 'global' // 항상(텍스트 입력 컨텍스트 제외)
  | 'list' // 파일 목록에 포커스가 있을 때
  | 'addressEdit' // 주소 표시줄 편집 중(텍스트 입력 우선)
  | 'search' // 검색창 입력 중
  | 'rename' // 인라인 이름편집 중
  | 'dialog' // 다이얼로그 열림(전역 단축키 차단)

/** 정규화된 키 조합 토큰. 예: "ctrl+t", "alt+arrowleft", "f5". */
export type KeyChord = string

/** 단축키 1개의 선언. */
export interface KeyBinding {
  /** 정규화된 키 조합(소문자). modifiers 는 ctrl→alt→shift→meta 순. */
  readonly chord: KeyChord
  /** 실행할 명령 식별자. */
  readonly commandId: string
  /** 이 바인딩이 활성화되는 컨텍스트(기본 'global'). */
  readonly context: KeyContext
  /** 설정 화면 표시명(PRD §8 동작 설명). */
  readonly label: string
  /** PRD §8 영역(그룹 표시용). */
  readonly group: string
}

/**
 * PRD §8 단축키 표 전체 — 단일 출처.
 * 동일 컨텍스트 내 중복 chord 는 Registry 부팅 시 assert 한다.
 *
 * 참고: Ctrl+1~9 는 9개를 펼쳐 등록한다(아래 generator).
 */
const baseBindings: KeyBinding[] = [
  // ── 탭 ──────────────────────────────────────────────────────────────
  { chord: 'ctrl+t', commandId: 'tab.new', context: 'global', label: '새 탭', group: '탭' },
  { chord: 'ctrl+w', commandId: 'tab.close', context: 'global', label: '탭 닫기', group: '탭' },
  {
    chord: 'ctrl+shift+t',
    commandId: 'tab.reopen',
    context: 'global',
    label: '닫은 탭 복원',
    group: '탭'
  },
  {
    chord: 'ctrl+d',
    commandId: 'tab.duplicate',
    context: 'global',
    label: '탭 복제(동일 경로)',
    group: '탭'
  },
  { chord: 'ctrl+tab', commandId: 'tab.next', context: 'global', label: '다음 탭', group: '탭' },
  {
    chord: 'ctrl+shift+tab',
    commandId: 'tab.prev',
    context: 'global',
    label: '이전 탭',
    group: '탭'
  },

  // ── 패널 포커스 / 분할 ──────────────────────────────────────────────
  {
    chord: 'tab',
    commandId: 'panel.focusNext',
    context: 'list',
    label: '다른 패널로 포커스 이동(순환)',
    group: '패널 포커스'
  },
  {
    chord: 'ctrl+arrowleft',
    commandId: 'panel.focusDir.left',
    context: 'global',
    label: '왼쪽 패널로 포커스',
    group: '패널 포커스'
  },
  {
    chord: 'ctrl+arrowright',
    commandId: 'panel.focusDir.right',
    context: 'global',
    label: '오른쪽 패널로 포커스',
    group: '패널 포커스'
  },
  {
    chord: 'ctrl+\\',
    commandId: 'layout.toggleSplit2',
    context: 'global',
    label: '2분할 토글(좌우)',
    group: '패널 분할'
  },
  {
    chord: 'ctrl+shift+\\',
    commandId: 'layout.toggleGrid4',
    context: 'global',
    label: '4분할 토글(2x2)',
    group: '패널 분할'
  },

  // ── 탐색 ────────────────────────────────────────────────────────────
  {
    chord: 'alt+arrowleft',
    commandId: 'nav.back',
    context: 'global',
    label: '뒤로',
    group: '탐색'
  },
  {
    chord: 'alt+arrowright',
    commandId: 'nav.forward',
    context: 'global',
    label: '앞으로',
    group: '탐색'
  },
  {
    chord: 'alt+arrowup',
    commandId: 'nav.up',
    context: 'global',
    label: '위로(상위 폴더)',
    group: '탐색'
  },
  {
    chord: 'backspace',
    commandId: 'nav.up',
    context: 'list',
    label: '위로(상위 폴더)',
    group: '탐색'
  },
  {
    chord: 'ctrl+l',
    commandId: 'address.edit',
    context: 'global',
    label: '주소 표시줄 편집',
    group: '탐색'
  },

  // ── 보기 ────────────────────────────────────────────────────────────
  {
    chord: 'ctrl+r',
    commandId: 'panel.refresh',
    context: 'global',
    label: '새로고침',
    group: '보기'
  },
  {
    chord: 'ctrl+f',
    commandId: 'search.open',
    context: 'global',
    label: '현재 폴더 검색',
    group: '보기'
  },
  {
    chord: 'ctrl+b',
    commandId: 'sidebar.toggle',
    context: 'global',
    label: '사이드바 토글',
    group: '보기'
  },

  // ── 파일(일부는 P4 동작 연결) ───────────────────────────────────────
  { chord: 'ctrl+c', commandId: 'file.copy', context: 'list', label: '복사', group: '파일' },
  { chord: 'ctrl+x', commandId: 'file.cut', context: 'list', label: '잘라내기', group: '파일' },
  { chord: 'ctrl+v', commandId: 'file.paste', context: 'list', label: '붙여넣기', group: '파일' },
  { chord: 'f2', commandId: 'file.rename', context: 'list', label: '이름변경', group: '파일' },
  {
    chord: 'ctrl+shift+n',
    commandId: 'file.newFolder',
    context: 'global',
    label: '새 폴더',
    group: '파일'
  },
  {
    chord: 'delete',
    commandId: 'file.trash',
    context: 'list',
    label: '휴지통으로 삭제',
    group: '파일'
  },
  {
    chord: 'shift+delete',
    commandId: 'file.deletePermanent',
    context: 'list',
    label: '영구 삭제',
    group: '파일'
  },
  {
    chord: 'ctrl+z',
    commandId: 'file.undo',
    context: 'global',
    label: '되돌리기',
    group: '파일'
  },

  // ── 선택 ────────────────────────────────────────────────────────────
  {
    chord: 'ctrl+a',
    commandId: 'select.all',
    context: 'list',
    label: '전체 선택',
    group: '선택'
  },
  {
    chord: 'enter',
    commandId: 'panel.activate',
    context: 'list',
    label: '항목 열기/진입',
    group: '선택'
  },

  // ── 설정 / 도움말 ───────────────────────────────────────────────────
  {
    chord: 'ctrl+,',
    commandId: 'app.settings',
    context: 'global',
    label: '설정 열기',
    group: '설정'
  },

  // ── 미리보기(Should, P6) ────────────────────────────────────────────
  {
    chord: 'ctrl+p',
    commandId: 'preview.toggle',
    context: 'global',
    label: '미리보기 패널 토글(Should)',
    group: '미리보기'
  }
]

/** Ctrl+1~9 (N번째 탭) 9개 펼침. */
function tabNumberBindings(): KeyBinding[] {
  const out: KeyBinding[] = []
  for (let n = 1; n <= 9; n++) {
    out.push({
      chord: `ctrl+${n}`,
      commandId: `tab.select.${n}`,
      context: 'global',
      label: `${n}번째 탭`,
      group: '탭'
    })
  }
  return out
}

/** PRD §8 전체 바인딩(단일 출처). */
export const KEYBINDINGS: readonly KeyBinding[] = [...baseBindings, ...tabNumberBindings()]
