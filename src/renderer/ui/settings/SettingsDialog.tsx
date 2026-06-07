/**
 * SettingsDialog — 설정 화면 (P5a, features E6 / F장).
 *
 * 항목: 테마(라이트/다크/시스템) · 기본 시작 위치 · 숨김 파일 표시 ·
 *       확장자 표시 · 최근 개수 · 텔레메트리 옵트인(기본 꺼짐) · 단축키 목록.
 *
 * 각 변경은 app/usecases/settings 의 change* 가 즉시 반영 + 영속(settings:set,
 * 텔레메트리는 telemetry:set-opt-in)한다. 숨김 토글은 패널 재스캔, 테마는 즉시
 * 적용, 확장자는 즉시 표기. 단축키 섹션은 KeyBindingRegistry.listBindings() 를
 * 읽어 PRD §8 표를 표시(P3 DoD "설정에서 단축키 표시"의 실제 호스트).
 */
import { useEffect, useRef } from 'react'
import type { ThemeMode } from '@shared/dto'
import { useRootStore } from '@renderer/app/stores/rootStore'
import {
  changeRecentLimit,
  changeShowDashboardOnStartup,
  changeShowExtensions,
  changeShowHidden,
  changeStartLocation,
  changeTelemetryOptIn,
  changeTheme
} from '@renderer/app/usecases/settings'
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

export function SettingsDialog(): JSX.Element | null {
  const open = useRootStore((s) => s.settingsOpen)
  const theme = useRootStore((s) => s.theme)
  const showHidden = useRootStore((s) => s.showHidden)
  const showExtensions = useRootStore((s) => s.showExtensions)
  const startLocation = useRootStore((s) => s.startLocation)
  const recentLimit = useRootStore((s) => s.recentLimit)
  const showDashboardOnStartup = useRootStore((s) => s.showDashboardOnStartup)
  const telemetryOptIn = useRootStore((s) => s.telemetryOptIn)
  const close = useRootStore((s) => s.closeSettings)
  const openWorkspace = useRootStore((s) => s.openWorkspace)
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

  const groups = listShortcutGroups()

  return (
    <div style={overlayStyle} onClick={close} role="dialog" aria-modal="true" aria-label="설정">
      <div
        ref={panelRef}
        style={{ ...panelStyle, width: 600, maxWidth: '92vw', maxHeight: '86vh', overflowY: 'auto' }}
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
          </select>
        </div>

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

        {/* 텔레메트리 옵트인 */}
        <label style={labelStyle}>
          <span style={fieldLabel}>익명 사용 통계</span>
          <input
            type="checkbox"
            checked={telemetryOptIn}
            onChange={(e) => void changeTelemetryOptIn(e.target.checked)}
            aria-label="텔레메트리 옵트인"
          />
          <span style={{ color: tokens.color.textMuted, fontSize: 12 }}>
            기본 꺼짐. 동의 시에만 익명 통계를 수집합니다.
          </span>
        </label>

        {/* 워크스페이스 관리(US-5.8) */}
        <div style={labelStyle}>
          <span style={fieldLabel}>워크스페이스</span>
          <button
            onClick={() => {
              close()
              openWorkspace()
            }}
            style={{
              height: 28,
              padding: '0 12px',
              border: `1px solid ${tokens.color.border}`,
              borderRadius: 5,
              fontSize: 13,
              background: tokens.color.bg,
              color: tokens.color.text,
              cursor: 'pointer'
            }}
          >
            워크스페이스 관리…
          </button>
          <span style={{ color: tokens.color.textMuted, fontSize: 12 }}>
            현재 탭 구성을 이름 붙여 저장하고 불러옵니다.
          </span>
        </div>

        {/* 단축키 목록(KeyBindingRegistry → PRD §8) */}
        <div style={{ marginTop: 16 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 8px' }}>단축키</h3>
          {groups.map((g) => (
            <div key={g.group} style={{ marginBottom: 12 }}>
              <div style={{ fontWeight: 600, color: tokens.color.textMuted, marginBottom: 4, fontSize: 12 }}>
                {g.group}
              </div>
              {g.items.map((b) => (
                <div key={`${b.context}-${b.chord}`} style={{ display: 'flex', padding: '2px 0', alignItems: 'center' }}>
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
      </div>
    </div>
  )
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
