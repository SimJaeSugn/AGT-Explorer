/**
 * QuickLookOverlay — Space 퀵룩 미리보기 오버레이 (U1 · US-20.1, Should).
 *
 * 목록 포커스에서 Space → 활성(앵커) 항목을 큰 중앙 오버레이로 미리본다.
 * 형식별 렌더는 J5 미리보기 뷰어 컴포넌트(PREVIEW_RENDERERS)를 그대로 재사용하고
 * 데이터는 기존 preview:read(=readPreview usecase)로 읽는다(신규 IPC 0·CSP/DOMPurify
 * 보안 모델 그대로 — PreviewPanel 과 동일 경로).
 *
 * 폴더/미지원 형식은 백엔드가 kind='meta'|'unsupported' 로 응답하므로 같은 렌더러가
 * 정보 카드를 그린다(별도 분기 불필요). 상단에 PreviewInfoCard 로 이름/크기/형식 표기.
 *
 * a11y: role="dialog" aria-modal·Esc/바깥 클릭 닫기·포커스 트랩·opener 복귀.
 * Space 재입력으로도 닫힌다(commandBus quicklook.toggle — 단, 오버레이가 떠 있는
 * 동안 inputContext='dialog' 라 전역 Space 가 차단되므로 오버레이 자체 keydown 으로 처리).
 * ←/→: 이전/다음 항목 이동(있을 때만·nice-to-have).
 */
import { useEffect, useRef, useState } from 'react'
import type { PreviewData } from '@shared/dto'
import { useRootStore } from '@renderer/app/stores/rootStore'
import { readPreview } from '@renderer/app/usecases/preview'
import { visibleEntries } from '@renderer/app/usecases/selectors'
import { useFocusTrap } from '@renderer/ui/keyboard/useFocusTrap'
import { overlayStyle } from '@renderer/ui/dialogs/dialogStyles'
import { tokens } from '@renderer/ui/theme/tokens'
import { PREVIEW_RENDERERS } from '@renderer/ui/preview/renderers'
import { PreviewInfoCard } from '@renderer/ui/preview/PreviewInfoCard'

export function QuickLookOverlay(): JSX.Element | null {
  const path = useRootStore((s) => s.quickLookPath)
  const close = useRootStore((s) => s.closeQuickLook)
  const openQuickLook = useRootStore((s) => s.openQuickLook)
  const open = path !== null

  const [data, setData] = useState<PreviewData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reqSeq = useRef(0)
  const panelRef = useRef<HTMLDivElement | null>(null)

  // 포커스 트랩(컨테이너=패널)·opener 복귀. 닫기 버튼이 첫 포커서블.
  useFocusTrap(open, panelRef)

  // 대상 경로 변경 시 미리보기 읽기(PreviewPanel 과 동일 디바운스·seq 가드).
  useEffect(() => {
    if (path === null) {
      setData(null)
      setError(null)
      setLoading(false)
      return undefined
    }
    const seq = ++reqSeq.current
    setLoading(true)
    setError(null)
    const timer = setTimeout(() => {
      void readPreview(path)
        .then((res) => {
          if (seq !== reqSeq.current) return
          if (res.ok) {
            setData(res.value)
            setError(null)
          } else {
            setData(null)
            setError(res.error.message || '미리보기를 불러올 수 없습니다.')
          }
          setLoading(false)
        })
        .catch(() => {
          if (seq !== reqSeq.current) return
          setData(null)
          setError('미리보기를 불러올 수 없습니다.')
          setLoading(false)
        })
    }, 120)
    return () => clearTimeout(timer)
  }, [path])

  if (!open) return null

  // ←/→: 활성 패널의 가시 항목 내에서 현재 경로 기준 이전/다음으로 이동.
  function step(delta: number): void {
    const s = useRootStore.getState()
    const pid = s.activePanelId()
    if (!pid) return
    const vis = visibleEntries(pid)
    const idx = vis.findIndex((e) => e.path === path)
    if (idx < 0) return
    const next = idx + delta
    if (next < 0 || next >= vis.length) return
    const target = vis[next]
    if (target) openQuickLook(target.path)
  }

  function onKeyDown(e: React.KeyboardEvent): void {
    if (e.key === 'Escape' || e.key === ' ') {
      // Esc 또는 Space 재입력 → 닫기(Space 토글 일관).
      e.preventDefault()
      e.stopPropagation()
      close()
      return
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      step(1)
      return
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      step(-1)
    }
  }

  return (
    <div style={overlayStyle} onClick={close} role="presentation">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="퀵룩 미리보기"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        style={{
          width: 'min(80vw, 920px)',
          height: 'min(82vh, 760px)',
          display: 'flex',
          flexDirection: 'column',
          background: tokens.color.bg,
          border: `1px solid ${tokens.color.borderStrong}`,
          borderRadius: 10,
          boxShadow: '0 16px 48px rgba(0,0,0,0.32)',
          overflow: 'hidden',
          color: tokens.color.text
        }}
      >
        {/* 헤더(제목 + 닫기) */}
        <div
          style={{
            flex: '0 0 auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 6,
            padding: '6px 8px 6px 14px',
            fontSize: 12,
            fontWeight: 600,
            color: tokens.color.textMuted,
            borderBottom: `1px solid ${tokens.color.border}`
          }}
        >
          <span>퀵룩</span>
          <button
            onClick={close}
            title="닫기 (Space·Esc)"
            aria-label="닫기"
            style={{
              flex: '0 0 auto',
              width: 24,
              height: 24,
              border: 'none',
              borderRadius: 4,
              background: 'transparent',
              color: tokens.color.text,
              cursor: 'pointer',
              fontSize: 16,
              lineHeight: 1
            }}
          >
            ✕
          </button>
        </div>
        {/* 정보 카드(이름/크기/형식/경로) */}
        <PreviewInfoCard data={data} path={path} />
        {/* 본문: 형식별 뷰어(J5 재사용) */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {renderBody({ path, loading, error, data })}
        </div>
      </div>
    </div>
  )
}

function renderBody(args: {
  path: string | null
  loading: boolean
  error: string | null
  data: PreviewData | null
}): JSX.Element {
  const { path, loading, error, data } = args
  if (path === null) return <Placeholder text="미리볼 항목이 없습니다." />
  if (loading) return <Placeholder text="불러오는 중…" />
  if (error) return <Placeholder text={error} />
  if (!data) return <Placeholder text="미리보기를 표시할 수 없습니다." />
  const Renderer = PREVIEW_RENDERERS[data.kind]
  return <Renderer data={data} />
}

function Placeholder({ text }: { text: string }): JSX.Element {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        textAlign: 'center',
        color: tokens.color.textMuted,
        fontSize: 13
      }}
    >
      {text}
    </div>
  )
}
