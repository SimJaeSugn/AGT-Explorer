/**
 * BatchAutoLinkDialog — 자동링크 일괄 설정 모달 (V 일괄).
 *
 * 복수의 선택된 폴더를 한 번에 자동링크한다(각 폴더를 목표 디렉토리 아래 같은 이름으로 복사 →
 * 원본을 백업명으로 보존 → 원본 자리에 정션). 사용자는 ① 목표 디렉토리(네이티브 폴더 선택
 * 또는 직접 입력) ② 원본 백업 접미사(기본 ".원본")를 지정한다. 실행은
 * usecases/autoLink.runAutoLinkBatch(폴더별 복사 op + fs:link-finalize)에 위임한다.
 *
 * **잠겨있거나 권한이 없는 폴더는 자동으로 제외(스킵)되고 결과에 보고된다**(원본 무손상).
 *
 * 자체 모달·focus trap·Esc 취소(AutoLinkDialog 패턴 재사용·dialogStyles 공유).
 */
import { useEffect, useRef, useState } from 'react'
import { useRootStore } from '@renderer/app/stores/rootStore'
import {
  pickAutoLinkTarget,
  runAutoLinkBatch,
  DEFAULT_BACKUP_SUFFIX
} from '@renderer/app/usecases/autoLink'
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

export function BatchAutoLinkDialog(): JSX.Element | null {
  const sources = useRootStore((s) => s.autoLinkBatchSources)
  const close = useRootStore((s) => s.closeAutoLinkBatch)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const targetRef = useRef<HTMLInputElement | null>(null)
  const [target, setTarget] = useState('')
  const [suffix, setSuffix] = useState(DEFAULT_BACKUP_SUFFIX)

  useFocusTrap(!!sources, panelRef, { initialFocus: targetRef })

  // 열릴 때 기본 접미사 채우고 목표 비움.
  useEffect(() => {
    if (sources) {
      setSuffix(DEFAULT_BACKUP_SUFFIX)
      setTarget('')
    }
  }, [sources])

  useEffect(() => {
    if (!sources) return undefined
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
      }
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [sources, close])

  if (!sources) return null

  const count = sources.length
  const canRun = target.trim() !== '' && suffix.trim() !== ''

  async function onPick(): Promise<void> {
    const picked = await pickAutoLinkTarget(target.trim() || undefined)
    if (picked) setTarget(picked)
  }

  function onConfirm(): void {
    const t = target.trim()
    const sfx = suffix.trim()
    if (!sources || sources.length === 0 || !t || !sfx) return
    const list = [...sources]
    close()
    void runAutoLinkBatch(list, t, sfx)
  }

  return (
    <div style={overlayStyle} role="dialog" aria-modal="true" aria-label="자동링크(일괄)">
      <div ref={panelRef} style={{ ...panelStyle, width: 560, maxWidth: '94vw' }}>
        <div style={titleStyle}>자동링크(일괄) — {count}개 폴더</div>

        <div style={{ marginBottom: 10 }}>
          <div style={labelText}>대상 폴더 ({count}개)</div>
          <ul
            aria-label="대상 폴더 목록"
            style={{
              margin: 0,
              padding: '6px 8px',
              listStyle: 'none',
              maxHeight: 140,
              overflowY: 'auto',
              border: `1px solid ${tokens.color.border}`,
              borderRadius: 4,
              background: tokens.color.bgAlt,
              fontSize: 12,
              lineHeight: 1.6
            }}
          >
            {sources.map((p) => (
              <li
                key={p}
                title={p}
                style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              >
                <strong>{baseName(p)}</strong>{' '}
                <span style={{ color: tokens.color.textMuted }}>— {p}</span>
              </li>
            ))}
          </ul>
        </div>

        <div style={{ marginBottom: 10 }}>
          <div style={labelText}>목표 디렉토리(복사·링크 대상 — 모든 폴더 공통)</div>
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
          <div style={labelText}>원본 백업 접미사(원본은 삭제하지 않고 "이름+접미사" 로 보존)</div>
          <input
            value={suffix}
            onChange={(e) => setSuffix(e.target.value)}
            spellCheck={false}
            aria-label="원본 백업 접미사"
            style={inputStyle}
          />
        </div>

        <ol style={{ margin: '8px 0', paddingLeft: 18, fontSize: 12, color: tokens.color.textMuted, lineHeight: 1.7 }}>
          <li>
            각 폴더를 <strong>{target.trim() || '목표'}</strong> 아래 <strong>같은 이름</strong> 으로 모두 복사
          </li>
          <li>
            원본 <strong>이름</strong> → <strong>이름{suffix.trim() || DEFAULT_BACKUP_SUFFIX}</strong> 로 이름 변경(보존)
          </li>
          <li>원본 자리에 정션(링크) 생성 → 복사본을 가리킴</li>
        </ol>

        <p style={{ fontSize: 12, color: 'rgba(245,124,0,0.95)', marginTop: 4 }}>
          ⚠ 잠겨있거나 권한이 없는(사용 중) 폴더는 <strong>자동으로 제외(스킵)</strong> 되고 결과에 보고됩니다.
          목표에 같은 이름이 이미 있거나 백업 이름이 충돌하는 폴더도 제외됩니다. 제외·실패한 폴더의 원본은
          그대로 보존됩니다(손대지 않음).
        </p>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button style={btn('default')} onClick={() => close()}>
            취소
          </button>
          <button style={btn('primary')} disabled={!canRun} onClick={() => onConfirm()}>
            일괄 자동링크 실행
          </button>
        </div>
      </div>
    </div>
  )
}
