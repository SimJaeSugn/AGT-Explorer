/**
 * DragOverlay — 드래그 중 커서 추종 의도 툴팁 (US-1.3: 복사/이동 의도 상시 표시).
 *
 * dragState 를 구독해 active 인 동안 커서 옆에 의도(복사/이동)와 항목 수,
 * 차단 사유(순환 이동 등)를 표시한다. 수정키 변경 시 즉시 반영(useDrag 가 갱신).
 * 드롭 불가 상태는 금지(no-drop) 시각으로 구분한다.
 */
import { useDragState } from './useDrag'
import { tokens } from '@renderer/ui/theme/tokens'

export function DragOverlay(): JSX.Element | null {
  const drag = useDragState()
  if (!drag.active) return null

  const count = drag.sources.length
  const onTarget = drag.target !== null
  const blocked = onTarget && !drag.allowed

  const label = !onTarget
    ? '여기에 드롭'
    : blocked
      ? drag.hint || '여기에 놓을 수 없습니다'
      : drag.intent === 'copy'
        ? `복사 — ${count}개 항목`
        : `이동 — ${count}개 항목`

  const icon = !onTarget ? '↦' : blocked ? '⨯' : drag.intent === 'copy' ? '＋' : '→'

  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        left: drag.cursor.x + 14,
        top: drag.cursor.y + 16,
        zIndex: 1200,
        pointerEvents: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        borderRadius: 6,
        fontSize: 12,
        color: '#fff',
        background: blocked ? tokens.color.danger : onTarget ? tokens.color.accent : '#475569',
        boxShadow: '0 4px 14px rgba(0,0,0,0.28)',
        whiteSpace: 'nowrap'
      }}
    >
      <span style={{ fontWeight: 700 }}>{icon}</span>
      <span>{label}</span>
    </div>
  )
}
