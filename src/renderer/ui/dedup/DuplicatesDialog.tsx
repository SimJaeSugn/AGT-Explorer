/**
 * DuplicatesDialog — 중복 파일 찾기 화면 (§R2·US-17.2·F23).
 *
 * 모달 패턴(TrashDialog 동형: overlay 클릭 닫기·stopPropagation·role=dialog·
 * aria-modal·Esc·useFocusTrap). 백엔드 hash:dup:* 진행률·중복 그룹·선택(정리 대상)을
 * dedupSlice 에서 구독하고, IPC 는 usecases/dedup 경유.
 *
 * 흐름: (스캔 중) 진행률·취소 → (완료) 그룹 목록(그룹별 파일·체크박스·"원본 1개 보존")
 *   → 선택 정리(휴지통·확인 오버레이·전체삭제 경고) → K1 undo 자동.
 *
 * 셀렉터 격리: 이 컴포넌트만 dedupSlice 를 구독한다.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRootStore } from '@renderer/app/stores/rootStore'
import {
  cancelDedup,
  cleanupHasDataLossRisk,
  confirmCleanup,
  rescanDedup,
  selectedCleanupCount
} from '@renderer/app/usecases/dedup'
import {
  keepCandidate,
  selectAllButOne,
  sortGroupsByWaste,
  totalWastedBytes,
  wastedBytes
} from '@renderer/domain/rules/dupGroup'
import { useFocusTrap } from '@renderer/ui/keyboard/useFocusTrap'
import { formatBytes, formatCount } from '@renderer/ui/dashboard/format'
import { btn, overlayStyle, panelStyle, titleStyle } from '@renderer/ui/dialogs/dialogStyles'
import { tokens } from '@renderer/ui/theme/tokens'

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '3px 6px',
  fontSize: 12,
  borderBottom: `1px solid ${tokens.color.border}`
}

export function DuplicatesDialog(): JSX.Element | null {
  const open = useRootStore((s) => s.dedupOpen)
  const status = useRootStore((s) => s.dedupStatus)
  const groups = useRootStore((s) => s.dedupGroups)
  const selected = useRootStore((s) => s.dedupSelected)
  const scannedItems = useRootStore((s) => s.dedupScannedItems)
  const scannedBytes = useRootStore((s) => s.dedupScannedBytes)
  const currentPath = useRootStore((s) => s.dedupCurrentPath)
  const truncated = useRootStore((s) => s.dedupTruncated)
  const error = useRootStore((s) => s.dedupError)
  const roots = useRootStore((s) => s.dedupRoots)

  const panelRef = useRef<HTMLDivElement | null>(null)
  const closeBtnRef = useRef<HTMLButtonElement | null>(null)
  const confirmPanelRef = useRef<HTMLDivElement | null>(null)
  const [confirmClean, setConfirmClean] = useState(false)

  useFocusTrap(open, panelRef, { initialFocus: closeBtnRef })
  useFocusTrap(confirmClean, confirmPanelRef)

  useEffect(() => {
    if (open) setConfirmClean(false)
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        const s = useRootStore.getState()
        setConfirmClean((c) => {
          if (c) return false
          s.closeDedup()
          return c
        })
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open])

  // 회수 가능 용량 내림차순 정렬(가장 큰 낭비 먼저).
  const sorted = useMemo(() => sortGroupsByWaste(groups), [groups])
  const totalWaste = useMemo(() => totalWastedBytes(groups), [groups])
  const selCount = selectedCleanupCount()

  if (!open) return null

  function close(): void {
    useRootStore.getState().closeDedup()
  }

  const scanning = status === 'scanning'

  return (
    <div style={overlayStyle} onClick={close} role="dialog" aria-modal="true" aria-label="중복 파일 찾기">
      <div
        ref={panelRef}
        style={{
          ...panelStyle,
          width: 820,
          maxWidth: '94vw',
          maxHeight: '88vh',
          display: 'flex',
          flexDirection: 'column'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <h2 style={{ ...titleStyle, margin: 0 }}>⧉ 중복 파일 찾기</h2>
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

        {/* 범위 + 동작 버튼 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: tokens.color.textMuted }} title={roots[0] ?? ''}>
            범위: {roots[0] ?? '—'}
          </span>
          <span style={{ marginLeft: 'auto' }} />
          {scanning ? (
            <button style={btn('default')} onClick={() => void cancelDedup()}>
              탐지 취소
            </button>
          ) : (
            <button style={btn('default')} onClick={() => void rescanDedup()}>
              다시 찾기
            </button>
          )}
          <button
            style={btn('danger')}
            disabled={selCount === 0 || scanning}
            onClick={() => setConfirmClean(true)}
          >
            선택 정리{selCount > 0 ? ` (${selCount})` : ''}
          </button>
        </div>

        {/* 상태 */}
        {scanning && (
          <div style={{ color: tokens.color.textMuted, fontSize: 12, padding: '16px 0' }} role="status">
            중복을 찾는 중… {formatCount(scannedItems)}개 검사 · {formatBytes(scannedBytes)} 해시
            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 4 }}>
              {currentPath}
            </div>
          </div>
        )}
        {status === 'error' && (
          <div style={{ color: tokens.color.danger, fontSize: 12, padding: '12px 0' }} role="alert">
            {error ?? '중복 찾기 중 오류가 발생했습니다.'}
          </div>
        )}
        {status === 'canceled' && (
          <div style={{ color: tokens.color.textMuted, fontSize: 13, padding: '16px 0' }}>
            탐지를 취소했습니다.
          </div>
        )}
        {status === 'ready' && groups.length === 0 && (
          <div style={{ color: tokens.color.textMuted, fontSize: 13, padding: '24px 0' }}>
            중복 파일이 없습니다.
          </div>
        )}

        {/* 그룹 목록 */}
        {status === 'ready' && groups.length > 0 && (
          <>
            <div style={{ fontSize: 12, color: tokens.color.textMuted, marginBottom: 6 }}>
              중복 그룹 {formatCount(groups.length)}개 · 회수 가능 {formatBytes(totalWaste)}
              {truncated && (
                <span style={{ color: tokens.color.danger }}> · 결과가 많아 일부만 표시됩니다</span>
              )}
            </div>
            <div
              style={{
                overflowY: 'auto',
                flex: 1,
                border: `1px solid ${tokens.color.border}`,
                borderRadius: 6
              }}
            >
              {sorted.map((g) => {
                const keep = keepCandidate(g)
                const allButOne = selectAllButOne(g)
                const allSel = allButOne.length > 0 && allButOne.every((p) => selected.has(p))
                return (
                  <div key={g.hash} style={{ borderBottom: `2px solid ${tokens.color.borderStrong}` }}>
                    <div
                      style={{
                        ...rowStyle,
                        background: tokens.color.bgAlt,
                        fontWeight: 600,
                        position: 'sticky',
                        top: 0
                      }}
                    >
                      <span>
                        {formatCount(g.files.length)}개 동일 · {formatBytes(g.size)} · 낭비{' '}
                        {formatBytes(wastedBytes(g))}
                      </span>
                      <button
                        style={{ ...btn('default'), height: 22, padding: '0 8px', marginLeft: 'auto' }}
                        onClick={() =>
                          useRootStore.getState().setDedupSelection(allButOne, !allSel)
                        }
                      >
                        {allSel ? '그룹 선택 해제' : '원본 외 전체 선택'}
                      </button>
                    </div>
                    {g.files.map((f) => {
                      const isKeep = f.path === keep
                      const isSel = selected.has(f.path)
                      return (
                        <div
                          key={f.path}
                          style={{
                            ...rowStyle,
                            background: isSel ? tokens.color.bgSelected : 'transparent',
                            cursor: isKeep ? 'default' : 'pointer'
                          }}
                          onClick={() => {
                            if (!isKeep) useRootStore.getState().toggleDedupSelect(f.path)
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={isSel}
                            disabled={isKeep}
                            aria-label={`${f.name} 정리 선택`}
                            onClick={(e) => e.stopPropagation()}
                            onChange={() => useRootStore.getState().toggleDedupSelect(f.path)}
                          />
                          <span
                            style={{
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              flex: 1,
                              color: isKeep ? tokens.color.textMuted : tokens.color.text
                            }}
                            title={f.path}
                          >
                            {f.path}
                          </span>
                          {isKeep && (
                            <span style={{ color: tokens.color.accent, fontSize: 11 }}>보존(원본)</span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>

      {/* 정리 확인(휴지통·전체삭제 경고). dialogStyles 재사용. */}
      {confirmClean && (
        <div
          style={overlayStyle}
          onClick={(e) => {
            e.stopPropagation()
            setConfirmClean(false)
          }}
          role="dialog"
          aria-modal="true"
          aria-label="중복 정리 확인"
        >
          <div ref={confirmPanelRef} style={panelStyle} onClick={(e) => e.stopPropagation()}>
            <div style={titleStyle}>중복 정리</div>
            <p style={{ marginTop: 0 }}>
              선택한 <strong>{formatCount(selCount)}개 중복 파일</strong>을 휴지통으로 보낼까요?
            </p>
            {cleanupHasDataLossRisk() && (
              <p style={{ color: tokens.color.danger, fontSize: 12, marginTop: 4 }} role="alert">
                ⚠ 일부 그룹은 원본까지 모두 선택되어 있습니다(보존 파일 없음). 그래도 진행하면 해당 내용의
                파일이 하나도 남지 않습니다.
              </p>
            )}
            <p style={{ color: tokens.color.textMuted, fontSize: 12, marginTop: 4 }}>
              휴지통을 거치며 되돌리기(Ctrl+Z)로 복구할 수 있습니다.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
              <button style={btn('default')} onClick={() => setConfirmClean(false)}>
                취소
              </button>
              <button
                style={btn('danger')}
                onClick={() => {
                  setConfirmClean(false)
                  void confirmCleanup()
                }}
              >
                휴지통으로 정리
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
