/**
 * Toasts — 사용자 안내(파일 실행 실패·미연결 형식 등) (roadmap P2 안내 메시지).
 *
 * uiSlice.toasts 를 구독해 우하단에 표시. 자동 사라짐(타이머).
 */
import { useEffect } from 'react'
import { useRootStore } from '@renderer/app/stores/rootStore'
import { tokens } from '@renderer/ui/theme/tokens'

export function Toasts(): JSX.Element {
  const toasts = useRootStore((s) => s.toasts)
  const dismiss = useRootStore((s) => s.dismissToast)

  return (
    <div
      style={{
        position: 'fixed',
        right: 16,
        bottom: 36,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        zIndex: 1000,
        pointerEvents: 'none'
      }}
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} id={t.id} kind={t.kind} message={t.message} onDismiss={dismiss} />
      ))}
    </div>
  )
}

function ToastItem({
  id,
  kind,
  message,
  onDismiss
}: {
  id: string
  kind: 'info' | 'error'
  message: string
  onDismiss: (id: string) => void
}): JSX.Element {
  useEffect(() => {
    const t = setTimeout(() => onDismiss(id), 4500)
    return () => clearTimeout(t)
  }, [id, onDismiss])

  return (
    <div
      role="status"
      style={{
        pointerEvents: 'auto',
        maxWidth: 360,
        padding: '8px 12px',
        borderRadius: 6,
        fontSize: 13,
        color: '#fff',
        background: kind === 'error' ? tokens.color.danger : '#334155',
        boxShadow: '0 4px 12px rgba(0,0,0,0.18)',
        cursor: 'pointer'
      }}
      onClick={() => onDismiss(id)}
    >
      {message}
    </div>
  )
}
