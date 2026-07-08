/**
 * SettingsDialog — 설정 화면 (P5a, features E6 / F장). 좌(카테고리)·우(항목) 2단 구성.
 *
 * 카테고리:
 *  - 레이아웃: 테마 · 단축아이콘(상단 아이콘바 표시/숨김 토글).
 *  - 시스템:   기본 시작 위치 · 숨김/시스템 파일 · 확장자 · 최근 개수 ·
 *              시작 시 대시보드 · 복사 후 체크섬 검증.
 *  - 워크스페이스: 워크스페이스 관리(기존 다이얼로그 진입).
 *  - 단축키:   PRD §8 단축키 목록(KeyBindingRegistry 읽기 API 재사용).
 *
 * 각 변경은 app/usecases/settings 의 change·toggle 액션이 즉시 반영 + 영속한다.
 * 단축아이콘 토글/재배열은 settings:set 의 iconBarHidden/iconBarOrder 로 영속한다.
 */
import { useEffect, useRef, useState } from 'react'
import type { ThemeMode } from '@shared/dto'
import type { AppInfoDTO, UpdateStatusEvt } from '@shared/ipc/contracts'
import { getAppInfo } from '@renderer/app/usecases/appInfo'
import {
  checkForUpdate,
  downloadUpdate,
  installUpdate,
  subscribeUpdateStatus
} from '@renderer/app/usecases/update'
import { useRootStore } from '@renderer/app/stores/rootStore'
import type { SettingsCategory } from '@renderer/app/stores/uiSlice'
import { WorkspacePanel } from '@renderer/ui/workspace/WorkspacePanel'
import { AgentSettings } from '@renderer/ui/settings/AgentSettings'
import {
  changeRecentLimit,
  changeShowDashboardOnStartup,
  changeShowExtensions,
  changeShowHidden,
  changeShowPromoSplash,
  changeStartLocation,
  changeTheme,
  changeVerifyOnCopy,
  resetIconBar,
  toggleIconBarItem
} from '@renderer/app/usecases/settings'
import { ICON_BAR_ITEMS, iconBarItemTitle, type IconBarItem } from '@renderer/ui/toolbar/iconBarItems'
import { listShortcutGroups, prettyChord } from '@renderer/ui/keyboard/shortcuts'
import { useFocusTrap } from '@renderer/ui/keyboard/useFocusTrap'
import { overlayStyle, panelStyle, titleStyle } from '@renderer/ui/dialogs/dialogStyles'
import { tokens } from '@renderer/ui/theme/tokens'

const labelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '7px 0',
  borderBottom: `1px solid ${tokens.color.border}`
}

const fieldLabel: React.CSSProperties = { flex: '0 0 140px', fontWeight: 500 }

const CATEGORIES: ReadonlyArray<{ id: SettingsCategory; label: string; icon: string }> = [
  { id: 'layout', label: '레이아웃', icon: '🎨' },
  { id: 'system', label: '시스템', icon: '⚙' },
  { id: 'workspace', label: '워크스페이스', icon: '🗂' },
  { id: 'shortcuts', label: '단축키', icon: '⌨' },
  { id: 'agent', label: 'AI 에이전트', icon: '✨' },
  { id: 'about', label: '소프트웨어 정보', icon: 'ℹ' }
]

/** 단축아이콘 패널의 그룹 표시명(iconBarItems 의 group 키 → 한글 라벨). */
const ICON_GROUP_LABEL: Record<IconBarItem['group'], string> = {
  layout: '레이아웃 / 뷰',
  file: '파일 작업',
  nav: '탐색',
  tool: '도구'
}

export function SettingsDialog(): JSX.Element | null {
  const open = useRootStore((s) => s.settingsOpen)
  const close = useRootStore((s) => s.closeSettings)
  // 카테고리는 스토어 단일 출처 — 딥링크(openSettings('workspace'))와 좌측 네비가 공유.
  const category = useRootStore((s) => s.settingsCategory)
  const setCategory = useRootStore((s) => s.setSettingsCategory)
  // 자동 업데이트 새 버전 가용 시 "소프트웨어 정보" 카테고리에 배지 표시.
  const updateAvailable = useRootStore((s) => s.updateAvailable)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const closeBtnRef = useRef<HTMLButtonElement | null>(null)

  // 포커스 트랩: 컨테이너는 **내부 패널 div** 만(오버레이 onClick 닫기 보존).
  // 첫 포커스(닫기 ✕)·Tab 순환·opener 복귀(P7-A).
  useFocusTrap(open, panelRef, { initialFocus: closeBtnRef })

  // Esc = 닫기(신규, 오버레이 클릭 닫기와 공존). 다이얼로그 컨텍스트 단축키 차단 상태.
  useEffect(() => {
    if (!open) return undefined
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        close()
      }
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [open, close])

  if (!open) return null

  return (
    <div style={overlayStyle} onClick={close} role="dialog" aria-modal="true" aria-label="설정">
      <div
        ref={panelRef}
        style={{
          ...panelStyle,
          width: 720,
          maxWidth: '94vw',
          maxHeight: '86vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <h2 style={{ ...titleStyle, margin: 0 }}>설정</h2>
          <button
            ref={closeBtnRef}
            onClick={close}
            aria-label="닫기"
            style={{ marginLeft: 'auto', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 18, color: tokens.color.text }}
          >
            ✕
          </button>
        </div>

        <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0 }}>
          {/* 좌측: 카테고리 목록 */}
          <nav
            aria-label="설정 카테고리"
            style={{
              flex: '0 0 160px',
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              borderRight: `1px solid ${tokens.color.border}`,
              paddingRight: 8
            }}
          >
            {CATEGORIES.map((c) => {
              const selected = category === c.id
              // "소프트웨어 정보"에 새 업데이트가 있으면 라벨 뒤에 배지를 붙인다.
              const showBadge = c.id === 'about' && updateAvailable
              return (
                <button
                  key={c.id}
                  onClick={() => setCategory(c.id)}
                  aria-current={selected ? 'page' : undefined}
                  aria-label={showBadge ? `${c.label} (새 업데이트 있음)` : undefined}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    textAlign: 'left',
                    padding: '8px 10px',
                    border: 'none',
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontSize: 13,
                    fontWeight: selected ? 600 : 500,
                    background: selected ? tokens.color.bgSelected : 'transparent',
                    color: tokens.color.text
                  }}
                >
                  <span aria-hidden style={{ width: 18, textAlign: 'center' }}>{c.icon}</span>
                  <span>{c.label}</span>
                  {showBadge && (
                    <span
                      aria-hidden
                      title="새 버전이 있습니다"
                      style={{
                        marginLeft: 'auto',
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: tokens.color.danger,
                        flex: '0 0 auto'
                      }}
                    />
                  )}
                </button>
              )
            })}
          </nav>

          {/* 우측: 선택 카테고리 내용 */}
          <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', paddingRight: 4 }}>
            {category === 'layout' && <LayoutCategory />}
            {category === 'system' && <SystemCategory />}
            {category === 'workspace' && <WorkspaceCategory onClose={close} />}
            {category === 'shortcuts' && <ShortcutsCategory />}
            {category === 'agent' && <AgentSettings />}
            {category === 'about' && <AboutCategory />}
          </div>
        </div>
      </div>
    </div>
  )
}

/** 레이아웃: 테마 + 단축아이콘(아이콘바 표시/숨김). */
function LayoutCategory(): JSX.Element {
  const theme = useRootStore((s) => s.theme)
  const hidden = useRootStore((s) => s.iconBarHidden)
  const hiddenSet = new Set(hidden)
  const groups: IconBarItem['group'][] = ['layout', 'file', 'nav', 'tool']

  return (
    <div>
      <CategoryHeading>레이아웃</CategoryHeading>

      {/* 테마 */}
      <div style={labelStyle}>
        <span style={fieldLabel}>테마</span>
        <select
          value={theme}
          onChange={(e) => void changeTheme(e.target.value as ThemeMode)}
          aria-label="테마"
          style={selectStyle}
        >
          <option value="light">라이트</option>
          <option value="dark">다크</option>
          <option value="system">시스템</option>
          <option value="bluelight">블루라이트(청색광 차단)</option>
          <option value="agt-dark">AGT 다크(그린)</option>
        </select>
      </div>

      {/* 단축아이콘(상단 아이콘바 구성) */}
      <div style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>단축아이콘</h3>
          <button
            onClick={() => void resetIconBar()}
            title="단축아이콘 표시/순서를 기본값으로 되돌립니다."
            style={{
              marginLeft: 'auto',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              color: tokens.color.textMuted,
              fontSize: 11,
              textDecoration: 'underline'
            }}
          >
            기본값으로 초기화
          </button>
        </div>
        <span style={{ color: tokens.color.textMuted, fontSize: 12 }}>
          상단 아이콘바에 표시할 기능을 선택합니다. 표시 순서는 아이콘을 드래그해 바꿀 수 있습니다.
        </span>

        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {groups.map((g) => {
            const items = ICON_BAR_ITEMS.filter((it) => it.group === g)
            if (items.length === 0) return null
            return (
              <div key={g}>
                <div style={{ fontWeight: 600, color: tokens.color.textMuted, fontSize: 11, marginBottom: 4 }}>
                  {ICON_GROUP_LABEL[g]}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {items.map((it) => {
                    const visible = !hiddenSet.has(it.id)
                    return (
                      <label
                        key={it.id}
                        title={iconBarItemTitle(it)}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '4px 8px',
                          border: `1px solid ${visible ? tokens.color.accentBorder : tokens.color.border}`,
                          borderRadius: 6,
                          cursor: 'pointer',
                          fontSize: 12,
                          background: visible ? tokens.color.bgSelected : tokens.color.bg,
                          opacity: visible ? 1 : 0.6
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={visible}
                          onChange={() => void toggleIconBarItem(it.id)}
                          aria-label={`${it.label} 아이콘 표시`}
                        />
                        <span aria-hidden style={{ width: 16, textAlign: 'center' }}>{it.icon}</span>
                        <span>{it.label}</span>
                      </label>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/** 시스템: 시작 위치·표시·개수·시작 동작·검증. */
function SystemCategory(): JSX.Element {
  const showHidden = useRootStore((s) => s.showHidden)
  const showExtensions = useRootStore((s) => s.showExtensions)
  const startLocation = useRootStore((s) => s.startLocation)
  const recentLimit = useRootStore((s) => s.recentLimit)
  const showDashboardOnStartup = useRootStore((s) => s.showDashboardOnStartup)
  const showPromoSplash = useRootStore((s) => s.showPromoSplash)
  const verifyOnCopy = useRootStore((s) => s.verifyOnCopy)

  return (
    <div>
      <CategoryHeading>시스템</CategoryHeading>

      {/* 기본 시작 위치 */}
      <div style={labelStyle}>
        <span style={fieldLabel}>기본 시작 위치</span>
        <input
          value={startLocation}
          onChange={(e) => void changeStartLocation(e.target.value)}
          placeholder="비우면 내 PC"
          aria-label="기본 시작 위치"
          style={inputStyle}
        />
      </div>

      {/* 숨김 파일 표시 */}
      <label style={labelStyle}>
        <span style={fieldLabel}>숨김/시스템 파일 표시</span>
        <input
          type="checkbox"
          checked={showHidden}
          onChange={(e) => void changeShowHidden(e.target.checked)}
          aria-label="숨김 파일 표시"
        />
        <span style={{ color: tokens.color.textMuted, fontSize: 12 }}>
          끄면 숨김/시스템 파일이 목록에서 제외됩니다(기본).
        </span>
      </label>

      {/* 확장자 표시 */}
      <label style={labelStyle}>
        <span style={fieldLabel}>확장자 표시</span>
        <input
          type="checkbox"
          checked={showExtensions}
          onChange={(e) => void changeShowExtensions(e.target.checked)}
          aria-label="확장자 표시"
        />
        <span style={{ color: tokens.color.textMuted, fontSize: 12 }}>
          끄면 파일 이름에서 확장자를 숨깁니다.
        </span>
      </label>

      {/* 최근 개수 */}
      <div style={labelStyle}>
        <span style={fieldLabel}>최근 목록 개수</span>
        <input
          type="number"
          min={1}
          max={1000}
          value={recentLimit}
          onChange={(e) => void changeRecentLimit(Number(e.target.value))}
          aria-label="최근 목록 개수"
          style={{ ...inputStyle, width: 90, flex: '0 0 auto' }}
        />
      </div>

      {/* 시작 시 대시보드 표시(I장) */}
      <label style={labelStyle}>
        <span style={fieldLabel}>시작 시 대시보드 표시</span>
        <input
          type="checkbox"
          checked={showDashboardOnStartup}
          onChange={(e) => void changeShowDashboardOnStartup(e.target.checked)}
          aria-label="시작 시 용량 대시보드 표시"
        />
        <span style={{ color: tokens.color.textMuted, fontSize: 12 }}>
          프로그램 시작 시 용량 대시보드를 자동으로 엽니다(기본 켜짐).
        </span>
      </label>

      {/* 시작 시 홍보영상 표시 */}
      <label style={labelStyle}>
        <span style={fieldLabel}>시작 시 홍보영상 표시</span>
        <input
          type="checkbox"
          checked={showPromoSplash}
          onChange={(e) => void changeShowPromoSplash(e.target.checked)}
          aria-label="시작 시 홍보영상 표시"
        />
        <span style={{ color: tokens.color.textMuted, fontSize: 12 }}>
          켜면 프로그램 시작 시 홍보영상을 먼저 보여주고 뒤에서 초기화합니다. 초기화가
          끝나면 영상을 닫고 들어갈 수 있습니다(다음 실행부터 적용·기본 켜짐).
        </span>
      </label>

      {/* 복사 후 체크섬 검증(§R4) */}
      <label style={labelStyle}>
        <span style={fieldLabel}>복사 후 체크섬 검증</span>
        <input
          type="checkbox"
          checked={verifyOnCopy}
          onChange={(e) => void changeVerifyOnCopy(e.target.checked)}
          aria-label="복사 후 체크섬 검증"
        />
        <span style={{ color: tokens.color.textMuted, fontSize: 12 }}>
          켜면 복사 완료 후 원본과 사본의 해시(SHA-256)를 비교해 무결성을 검증합니다(기본 꺼짐).
        </span>
      </label>
    </div>
  )
}

/** 워크스페이스: 관리 본문 임베드(기존 워크스페이스 팝업과 동일 기능). */
function WorkspaceCategory({ onClose }: { onClose: () => void }): JSX.Element {
  return (
    <div>
      <CategoryHeading>워크스페이스</CategoryHeading>
      <span style={{ color: tokens.color.textMuted, fontSize: 12 }}>
        현재 탭 구성을 이름 붙여 저장하고 불러옵니다. 선택한 워크스페이스는 이후 변경이 자동 저장됩니다.
      </span>
      <div style={{ marginTop: 10 }}>
        {/* 불러오기 성공 시 설정 화면을 닫아 복원된 구성을 바로 확인하게 한다. */}
        <WorkspacePanel onLoaded={onClose} />
      </div>
    </div>
  )
}

/** 단축키: PRD §8 목록(KeyBindingRegistry 읽기 API 재사용). */
function ShortcutsCategory(): JSX.Element {
  const groups = listShortcutGroups()
  return (
    <div>
      <CategoryHeading>단축키</CategoryHeading>
      {groups.map(({ group, items }) => (
        <div key={group} style={{ marginBottom: 14 }}>
          <div style={{ fontWeight: 600, color: tokens.color.textMuted, fontSize: 11, marginBottom: 4 }}>{group}</div>
          {items.map((b) => (
            <div key={`${b.context}-${b.chord}`} style={{ display: 'flex', padding: '2px 0', alignItems: 'center', fontSize: 13 }}>
              <span style={{ flex: 1 }}>{b.label}</span>
              <kbd
                style={{
                  fontFamily: 'monospace',
                  fontSize: 12,
                  background: tokens.color.bgAlt,
                  border: `1px solid ${tokens.color.border}`,
                  borderRadius: 4,
                  padding: '1px 6px'
                }}
              >
                {prettyChord(b.chord)}
              </kbd>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

/** 소프트웨어 정보: 버전·런타임 기본 정보(app:get-info). 읽기 전용. */
function AboutCategory(): JSX.Element {
  const [info, setInfo] = useState<AppInfoDTO | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    void getAppInfo().then((v) => {
      if (!alive) return
      if (v) setInfo(v)
      else setFailed(true)
    })
    return () => {
      alive = false
    }
  }, [])

  const rows: ReadonlyArray<[string, string]> = info
    ? [
        ['제품명', info.name],
        ['버전', info.version],
        ['Electron', info.electron],
        ['Chromium', info.chrome],
        ['Node.js', info.node],
        ['V8', info.v8],
        ['플랫폼', `${info.platform} (${info.arch})`],
        ['패키징', info.packaged ? '설치본(자동 업데이트 가능)' : '개발 빌드(자동 업데이트 비활성)']
      ]
    : []

  return (
    <div>
      <CategoryHeading>소프트웨어 정보</CategoryHeading>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '4px 0 14px' }}>
        <span aria-hidden style={{ fontSize: 40, lineHeight: 1 }}>
          🗂
        </span>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>AGT-Finder</div>
          <div style={{ color: tokens.color.textMuted, fontSize: 12 }}>멀티 디렉토리 파일탐색기</div>
          {info && (
            <div style={{ fontSize: 13, marginTop: 2 }}>
              버전 <strong>{info.version}</strong>
            </div>
          )}
        </div>
      </div>

      {failed && (
        <div style={{ color: tokens.color.textMuted, fontSize: 13 }}>정보를 불러오지 못했습니다.</div>
      )}
      {!info && !failed && (
        <div style={{ color: tokens.color.textMuted, fontSize: 13 }}>불러오는 중…</div>
      )}

      {info && (
        <>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {rows.map(([k, v]) => (
              <div key={k} style={labelStyle}>
                <span style={fieldLabel}>{k}</span>
                <span style={{ fontSize: 13, userSelect: 'text', wordBreak: 'break-all' }}>{v}</span>
              </div>
            ))}
          </div>

          <button
            onClick={() => {
              void navigator.clipboard?.writeText(
                rows.map(([k, v]) => `${k}: ${v}`).join('\n')
              )
            }}
            style={{
              marginTop: 12,
              border: `1px solid ${tokens.color.border}`,
              borderRadius: 6,
              background: tokens.color.bg,
              color: tokens.color.text,
              cursor: 'pointer',
              fontSize: 12,
              padding: '5px 12px'
            }}
          >
            정보 복사
          </button>

          <UpdateSection packaged={info.packaged} />
        </>
      )}
    </div>
  )
}

/** 사용자 주도 업데이트: 확인 → 다운로드 → 재시작 설치. 진행률 표시. */
function UpdateSection({ packaged }: { packaged: boolean }): JSX.Element {
  // 시작 시 확인으로 이미 새 버전을 발견했으면(전역 배지 상태) 초기 상태를 'available' 로 seed —
  // About 페이지 진입 즉시 "다운로드" 버튼이 보이도록(배지 클릭 후 곧바로 조치 가능).
  const updateAvailable = useRootStore((s) => s.updateAvailable)
  const updateLatestVersion = useRootStore((s) => s.updateLatestVersion)
  const [status, setStatus] = useState<UpdateStatusEvt | null>(
    updateAvailable && updateLatestVersion
      ? { phase: 'available', version: updateLatestVersion }
      : null
  )
  const [busy, setBusy] = useState(false)
  const [actionMsg, setActionMsg] = useState('')

  // update:status 푸시 구독(확인/다운로드 진행/완료/오류). 패키징 빌드만 의미 있음.
  useEffect(() => {
    const off = subscribeUpdateStatus((evt) => {
      setStatus(evt)
      // 진행/결과 이벤트가 오면 in-flight 표시 해제(다운로드 중은 유지).
      if (evt.phase !== 'downloading') setBusy(false)
    })
    return off
  }, [])

  if (!packaged) {
    return (
      <p style={{ color: tokens.color.textMuted, fontSize: 12, marginTop: 16, lineHeight: 1.6 }}>
        개발 빌드에서는 업데이트를 확인할 수 없습니다. 설치본에서 사용하세요.
      </p>
    )
  }

  const phase = status?.phase
  const btnStyle: React.CSSProperties = {
    border: `1px solid ${tokens.color.accentBorder}`,
    borderRadius: 6,
    background: tokens.color.bgSelected,
    color: tokens.color.text,
    cursor: busy ? 'default' : 'pointer',
    fontSize: 13,
    fontWeight: 600,
    padding: '6px 14px',
    opacity: busy ? 0.6 : 1
  }

  async function onCheck(): Promise<void> {
    setActionMsg('')
    setBusy(true)
    setStatus({ phase: 'checking' })
    const r = await checkForUpdate()
    if (!r.ok) {
      setBusy(false)
      setActionMsg(r.message)
      setStatus({ phase: 'error', message: r.message })
    }
    // 성공 시 available/not-available 이벤트가 status 를 채운다.
  }

  async function onDownload(): Promise<void> {
    setActionMsg('')
    setBusy(true)
    const r = await downloadUpdate()
    if (!r.ok) {
      setBusy(false)
      setActionMsg(r.message)
    }
  }

  async function onInstall(): Promise<void> {
    setActionMsg('')
    const r = await installUpdate()
    if (!r.ok) setActionMsg(r.message)
    // 성공 시 앱이 곧 종료·재시작된다.
  }

  return (
    <div style={{ marginTop: 18, borderTop: `1px solid ${tokens.color.border}`, paddingTop: 14 }}>
      <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 8px' }}>업데이트</h3>

      {/* 상태 텍스트 */}
      <div style={{ fontSize: 13, minHeight: 20, marginBottom: 10 }}>
        {!phase && <span style={{ color: tokens.color.textMuted }}>업데이트를 확인할 수 있습니다.</span>}
        {phase === 'checking' && <span>새 버전을 확인하는 중…</span>}
        {phase === 'not-available' && (
          <span>현재 최신 버전입니다 ({status?.phase === 'not-available' ? status.version : ''}).</span>
        )}
        {phase === 'available' && (
          <span>
            새 버전 <strong>{status?.phase === 'available' ? status.version : ''}</strong> 이(가) 있습니다.
          </span>
        )}
        {phase === 'downloading' && status?.phase === 'downloading' && (
          <span>내려받는 중… {Math.round(status.percent)}%</span>
        )}
        {phase === 'downloaded' && (
          <span>
            새 버전 <strong>{status?.phase === 'downloaded' ? status.version : ''}</strong> 다운로드 완료.
            재시작하면 적용됩니다.
          </span>
        )}
        {phase === 'error' && (
          <span style={{ color: tokens.color.danger }}>
            오류: {status?.phase === 'error' ? status.message : ''}
          </span>
        )}
      </div>

      {/* 진행률 바 */}
      {phase === 'downloading' && status?.phase === 'downloading' && (
        <div
          style={{
            height: 8,
            borderRadius: 4,
            background: tokens.color.bgAlt,
            overflow: 'hidden',
            marginBottom: 10
          }}
          role="progressbar"
          aria-valuenow={Math.round(status.percent)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            style={{
              width: `${Math.max(2, Math.min(100, status.percent))}%`,
              height: '100%',
              background: tokens.color.accentBorder,
              transition: 'width 0.2s'
            }}
          />
        </div>
      )}

      {/* 액션 버튼 */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {(!phase || phase === 'not-available' || phase === 'error') && (
          <button onClick={() => void onCheck()} disabled={busy} style={btnStyle}>
            업데이트 확인
          </button>
        )}
        {phase === 'available' && (
          <button onClick={() => void onDownload()} disabled={busy} style={btnStyle}>
            다운로드
          </button>
        )}
        {phase === 'downloading' && (
          <button disabled style={btnStyle}>
            내려받는 중…
          </button>
        )}
        {phase === 'downloaded' && (
          <button onClick={() => void onInstall()} style={btnStyle}>
            재시작하여 설치
          </button>
        )}
      </div>

      {actionMsg && (
        <div style={{ color: tokens.color.danger, fontSize: 12, marginTop: 8 }}>{actionMsg}</div>
      )}
    </div>
  )
}

/** 카테고리 우측 영역 제목. */
function CategoryHeading({ children }: { children: React.ReactNode }): JSX.Element {
  return <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 8px' }}>{children}</h3>
}

const selectStyle: React.CSSProperties = {
  height: 28,
  border: `1px solid ${tokens.color.border}`,
  borderRadius: 5,
  fontSize: 13,
  background: tokens.color.bg,
  color: tokens.color.text,
  padding: '0 6px'
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  height: 28,
  border: `1px solid ${tokens.color.border}`,
  borderRadius: 5,
  fontSize: 13,
  padding: '0 8px',
  background: tokens.color.bg,
  color: tokens.color.text,
  // 키보드 포커스 가시성은 전역 :focus-visible(a11y CSS)에 위임.
  boxSizing: 'border-box'
}
