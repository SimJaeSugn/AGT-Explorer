/**
 * TrashDialog — 휴지통 관리 화면 (K장 K2).
 *
 * 모달 패턴(DashboardModal 동형: overlay 클릭 닫기·stopPropagation·role=dialog·
 * aria-modal·Esc·useFocusTrap). 마운트 시 loadTrash(). 목록(이름·원래경로·삭제일·
 * 크기, 삭제일 내림차순 정렬), 행 체크박스 선택 + 헤더 전체선택, 선택 복원,
 * 전체 비우기(되돌릴 수 없음 확인 — 항목수/용량 표시 후 emptyTrash). 로딩/빈/에러 상태.
 *
 * 셀렉터 격리: 이 컴포넌트만 trashSlice 를 구독한다. IPC 는 usecases/trash 경유.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRootStore } from '@renderer/app/stores/rootStore'
import { emptyTrash, loadTrash, restoreSelected } from '@renderer/app/usecases/trash'
import { useFocusTrap } from '@renderer/ui/keyboard/useFocusTrap'
import { formatBytes, formatCount } from '@renderer/ui/dashboard/format'
import { btn, overlayStyle, panelStyle, titleStyle } from '@renderer/ui/dialogs/dialogStyles'
import { tokens } from '@renderer/ui/theme/tokens'

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 12
}
const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '4px 8px',
  borderBottom: `1px solid ${tokens.color.border}`,
  color: tokens.color.textMuted,
  fontWeight: 600,
  position: 'sticky',
  top: 0,
  background: tokens.color.bg
}
const tdStyle: React.CSSProperties = {
  padding: '4px 8px',
  borderBottom: `1px solid ${tokens.color.border}`,
  color: tokens.color.text,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  maxWidth: 0
}
const tdNum: React.CSSProperties = {
  ...tdStyle,
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap'
}

/** epoch ms → 표시 문자열(로컬). 0/유효하지 않으면 '—'. */
function formatDeletedAt(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—'
  try {
    return new Date(ms).toLocaleString()
  } catch {
    return '—'
  }
}

export function TrashDialog(): JSX.Element | null {
  const open = useRootStore((s) => s.trashOpen)
  const status = useRootStore((s) => s.trashStatus)
  const items = useRootStore((s) => s.trashItems)
  const selected = useRootStore((s) => s.trashSelected)
  const error = useRootStore((s) => s.trashError)

  const panelRef = useRef<HTMLDivElement | null>(null)
  const closeBtnRef = useRef<HTMLButtonElement | null>(null)
  const confirmPanelRef = useRef<HTMLDivElement | null>(null)
  const [confirmEmpty, setConfirmEmpty] = useState(false)

  useFocusTrap(open, panelRef, { initialFocus: closeBtnRef })
  // 중첩 비우기-확인 오버레이는 panelRef 밖 형제라 자체 포커스 트랩이 필요(접근성).
  // 확인 닫힐 때 opener(비우기 버튼)로 포커스 복귀.
  useFocusTrap(confirmEmpty, confirmPanelRef)

  // 모달 오픈 시 목록 로드(매 오픈마다 최신 반영).
  useEffect(() => {
    if (open) {
      setConfirmEmpty(false)
      void loadTrash()
    }
  }, [open])

  // Esc 닫기(모달 패턴). 비우기 확인이 열려 있으면 확인만 닫는다.
  useEffect(() => {
    if (!open) return undefined
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        const s = useRootStore.getState()
        setConfirmEmpty((c) => {
          if (c) return false
          s.closeTrash()
          return c
        })
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open])

  // 삭제일 내림차순 정렬(최근 삭제 우선).
  const sorted = useMemo(() => [...items].sort((a, b) => b.deletedAt - a.deletedAt), [items])
  const totalBytes = useMemo(() => items.reduce((a, i) => a + (i.size || 0), 0), [items])
  const allSelected = items.length > 0 && selected.size === items.length

  if (!open) return null

  function close(): void {
    useRootStore.getState().closeTrash()
  }

  return (
    <div
      style={overlayStyle}
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-label="휴지통"
    >
      <div
        ref={panelRef}
        style={{
          ...panelStyle,
          width: 760,
          maxWidth: '94vw',
          maxHeight: '86vh',
          display: 'flex',
          flexDirection: 'column'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <h2 style={{ ...titleStyle, margin: 0 }}>🗑 휴지통</h2>
          <button
            ref={closeBtnRef}
            onClick={close}
            aria-label="닫기"
            style={{
              marginLeft: 'auto',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              fontSize: 18,
              color: tokens.color.text
            }}
          >
            ✕
          </button>
        </div>

        {/* 요약 + 동작 버튼 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: tokens.color.textMuted }}>
            {formatCount(items.length)}개 항목 · {formatBytes(totalBytes)}
          </span>
          <span style={{ marginLeft: 'auto' }} />
          <button
            style={btn('default')}
            disabled={selected.size === 0 || status === 'loading'}
            onClick={() => void restoreSelected()}
          >
            선택 복원{selected.size > 0 ? ` (${selected.size})` : ''}
          </button>
          <button
            style={btn('danger')}
            disabled={items.length === 0 || status === 'loading'}
            onClick={() => setConfirmEmpty(true)}
          >
            전체 비우기
          </button>
        </div>

        {/* 본문 상태 */}
        {status === 'loading' && (
          <div style={{ color: tokens.color.textMuted, fontSize: 13, padding: '24px 0' }} role="status">
            휴지통을 불러오는 중…
          </div>
        )}
        {status === 'error' && (
          <div style={{ color: tokens.color.danger, fontSize: 12, padding: '12px 0' }} role="alert">
            {error ?? '휴지통을 불러오지 못했습니다.'}
          </div>
        )}
        {status === 'ready' && items.length === 0 && (
          <div style={{ color: tokens.color.textMuted, fontSize: 13, padding: '24px 0' }}>
            휴지통이 비어 있습니다.
          </div>
        )}

        {/* 목록 */}
        {status === 'ready' && items.length > 0 && (
          <div style={{ overflowY: 'auto', flex: 1, border: `1px solid ${tokens.color.border}`, borderRadius: 6 }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, width: 28 }} scope="col">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      aria-label="전체 선택"
                      onChange={(e) => useRootStore.getState().setAllTrashSelected(e.target.checked)}
                    />
                  </th>
                  <th style={thStyle} scope="col">이름</th>
                  <th style={thStyle} scope="col">원래 위치</th>
                  <th style={{ ...thStyle, textAlign: 'right', width: 150 }} scope="col">삭제일</th>
                  <th style={{ ...thStyle, textAlign: 'right', width: 90 }} scope="col">크기</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((i) => {
                  const isSel = selected.has(i.id)
                  return (
                    <tr
                      key={i.id}
                      onClick={() => useRootStore.getState().toggleTrashSelect(i.id)}
                      style={{ cursor: 'pointer', background: isSel ? tokens.color.bgSelected : 'transparent' }}
                    >
                      <td style={{ ...tdStyle, maxWidth: 'none' }}>
                        <input
                          type="checkbox"
                          checked={isSel}
                          aria-label={`${i.name} 선택`}
                          onClick={(e) => e.stopPropagation()}
                          onChange={() => useRootStore.getState().toggleTrashSelect(i.id)}
                        />
                      </td>
                      <th style={{ ...tdStyle, fontWeight: 500 }} scope="row" title={i.name}>
                        {i.name}
                      </th>
                      <td style={tdStyle} title={i.originalPath}>
                        {i.originalPath || '—'}
                      </td>
                      <td style={tdNum}>{formatDeletedAt(i.deletedAt)}</td>
                      <td style={tdNum}>{formatBytes(i.size)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 전체 비우기 확인(되돌릴 수 없음). dialogStyles 재사용. */}
      {confirmEmpty && (
        <div
          style={overlayStyle}
          onClick={(e) => {
            e.stopPropagation()
            setConfirmEmpty(false)
          }}
          role="dialog"
          aria-modal="true"
          aria-label="휴지통 비우기 확인"
        >
          <div ref={confirmPanelRef} style={panelStyle} onClick={(e) => e.stopPropagation()}>
            <div style={titleStyle}>휴지통 비우기</div>
            <p style={{ marginTop: 0 }}>
              휴지통의 <strong>{formatCount(items.length)}개 항목</strong>({formatBytes(totalBytes)})을
              모두 비울까요?
            </p>
            <p style={{ color: tokens.color.danger, fontSize: 12, marginTop: 4 }}>
              이 작업은 되돌릴 수 없습니다.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
              <button style={btn('default')} onClick={() => setConfirmEmpty(false)}>
                취소
              </button>
              <button
                style={btn('danger')}
                onClick={() => {
                  setConfirmEmpty(false)
                  void emptyTrash()
                }}
              >
                비우기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
