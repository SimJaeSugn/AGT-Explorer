/**
 * AutoLinkDialog — 자동링크 설정 모달 (V10).
 *
 * 대상 폴더를 다른 위치로 복사하고, 원본을 백업명으로 바꾼 뒤 원본 자리에 정션(junction)을
 * 건다. 사용자는 ① 목표 디렉토리(네이티브 폴더 선택 또는 직접 입력) ② 원본 백업 이름을
 * 지정한다. 실행은 usecases/autoLink.runAutoLink(복사 op + fs:link-finalize)에 위임한다.
 *
 * 자체 모달·focus trap·Esc 취소(ConfirmDialog 패턴 재사용).
 */
import { useEffect, useRef, useState } from 'react'
import { useRootStore } from '@renderer/app/stores/rootStore'
import { pickAutoLinkTarget, runAutoLink } from '@renderer/app/usecases/autoLink'
import { baseName } from '@renderer/domain/paths'
import { tokens } from '@renderer/ui/theme/tokens'
import { useFocusTrap } from '@renderer/ui/keyboard/useFocusTrap'
import { btn, overlayStyle, panelStyle, titleStyle } from './dialogStyles'

const inputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  height: 28,
  boxSizing: 'border-box',
  border: `1px solid ${tokens.color.border}`,
  borderRadius: 4,
  padding: '0 8px',
  fontSize: 13,
  fontFamily: tokens.font,
  background: tokens.color.bg,
  color: tokens.color.text
}
const labelText: React.CSSProperties = { fontSize: 12, color: tokens.color.textMuted, marginBottom: 4 }

export function AutoLinkDialog(): JSX.Element | null {
  const source = useRootStore((s) => s.autoLinkSource)
  const close = useRootStore((s) => s.closeAutoLink)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const targetRef = useRef<HTMLInputElement | null>(null)
  const [target, setTarget] = useState('')
  const [backup, setBackup] = useState('')

  useFocusTrap(!!source, panelRef, { initialFocus: targetRef })

  // 열릴 때 기본 백업명("<이름>.원본") 채우고 목표 비움.
  useEffect(() => {
    if (source) {
      setBackup(`${baseName(source)}.원본`)
      setTarget('')
    }
  }, [source])

  useEffect(() => {
    if (!source) return undefined
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
      }
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [source, close])

  if (!source) return null

  const name = baseName(source)
  const canRun = target.trim() !== '' && backup.trim() !== ''

  async function onPick(): Promise<void> {
    const picked = await pickAutoLinkTarget(target.trim() || undefined)
    if (picked) setTarget(picked)
  }

  function onConfirm(): void {
    const t = target.trim()
    const b = backup.trim()
    if (!source || !t || !b) return
    const src = source
    close()
    void runAutoLink(src, t, b)
  }

  return (
    <div style={overlayStyle} role="dialog" aria-modal="true" aria-label="자동링크">
      <div ref={panelRef} style={{ ...panelStyle, width: 520, maxWidth: '94vw' }}>
        <div style={titleStyle}>자동링크 — {name}</div>

        <div style={{ marginBottom: 10 }}>
          <div style={labelText}>원본 폴더</div>
          <div
            style={{ ...inputStyle, display: 'flex', alignItems: 'center', background: tokens.color.bgAlt }}
            title={source}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {source}
            </span>
          </div>
        </div>

        <div style={{ marginBottom: 10 }}>
          <div style={labelText}>목표 디렉토리(복사·링크 대상)</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              ref={targetRef}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="예: D:\\Storage"
              spellCheck={false}
              aria-label="목표 디렉토리"
              style={inputStyle}
            />
            <button style={btn('default')} onClick={() => void onPick()}>
              찾아보기…
            </button>
          </div>
        </div>

        <div style={{ marginBottom: 10 }}>
          <div style={labelText}>원본 백업 이름(원본은 삭제하지 않고 이 이름으로 보존)</div>
          <input
            value={backup}
            onChange={(e) => setBackup(e.target.value)}
            spellCheck={false}
            aria-label="원본 백업 이름"
            style={inputStyle}
          />
        </div>

        <ol style={{ margin: '8px 0', paddingLeft: 18, fontSize: 12, color: tokens.color.textMuted, lineHeight: 1.7 }}>
          <li>
            <strong>{name}</strong> 의 내용을 <strong>{target.trim() || '목표'}\{name}</strong> 로 모두 복사
          </li>
          <li>
            원본 <strong>{name}</strong> → <strong>{backup.trim() || '백업이름'}</strong> 로 이름 변경(보존)
          </li>
          <li>
            원본 자리 <strong>{name}</strong> 에 정션(링크) 생성 → 복사본을 가리킴
          </li>
        </ol>

        <p style={{ fontSize: 12, color: 'rgba(245,124,0,0.95)', marginTop: 4 }}>
          ⚠ 정션은 관리자 권한이 필요 없습니다. 다만 원본이 다른 프로그램에서 사용 중이거나
          보호된 위치면 복사·이름 변경 단계에서 실패할 수 있으며, 그 경우 원본은 그대로 보존됩니다.
        </p>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button style={btn('default')} onClick={() => close()}>
            취소
          </button>
          <button style={btn('primary')} disabled={!canRun} onClick={() => onConfirm()}>
            자동링크 실행
          </button>
        </div>
      </div>
    </div>
  )
}
