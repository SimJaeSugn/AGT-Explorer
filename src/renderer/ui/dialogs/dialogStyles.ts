/**
 * 다이얼로그 공용 스타일 (ui/dialogs) — 오버레이·패널·버튼 토큰.
 */
import type { CSSProperties } from 'react'
import { tokens } from '@renderer/ui/theme/tokens'

export const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(15,23,42,0.32)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1100
}

export const panelStyle: CSSProperties = {
  minWidth: 420,
  maxWidth: 560,
  background: tokens.color.bg,
  border: `1px solid ${tokens.color.borderStrong}`,
  borderRadius: 10,
  boxShadow: '0 12px 40px rgba(0,0,0,0.24)',
  padding: 20,
  fontSize: 13,
  color: tokens.color.text
}

export const titleStyle: CSSProperties = {
  fontSize: 15,
  fontWeight: 600,
  marginBottom: 12
}

export const buttonRowStyle: CSSProperties = {
  display: 'flex',
  gap: 8,
  justifyContent: 'flex-end',
  marginTop: 18,
  flexWrap: 'wrap'
}

export function btn(variant: 'primary' | 'danger' | 'default'): CSSProperties {
  const base: CSSProperties = {
    height: 30,
    padding: '0 14px',
    borderRadius: 6,
    fontSize: 13,
    cursor: 'pointer',
    border: `1px solid ${tokens.color.border}`,
    background: tokens.color.bg,
    color: tokens.color.text
  }
  if (variant === 'primary') {
    return { ...base, background: tokens.color.accent, borderColor: tokens.color.accent, color: '#fff' }
  }
  if (variant === 'danger') {
    return { ...base, background: tokens.color.danger, borderColor: tokens.color.danger, color: '#fff' }
  }
  return base
}
