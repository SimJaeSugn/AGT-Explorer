/**
 * PreviewPanel — 활성 패널 단일 선택 항목의 미리보기 (US-4.3, P6b).
 *
 * - previewOpen 이 false 면 null(폭 미차지 — App flex 에서 격리).
 * - 미리보기 대상 = 활성 패널의 selection 이 정확히 1개일 때 그 경로.
 *   0개/다중이면 placeholder.
 * - 선택 경로 변경 시 previewApi.read(path) 호출(디바운스 150ms). 로딩/에러는
 *   로컬 상태(전역 슬라이스 불필요 — 단일 패널 국소 상태).
 * - PreviewData.kind 로 형식별 렌더러 디스패치(renderers 레지스트리).
 *
 * 셀렉터 격리: 활성 패널 id·해당 패널 selectedPaths 만 구독 → 무관 영역
 * (다른 패널 스트리밍/선택)이 미리보기를 리렌더하지 않는다.
 */
import { useEffect, useRef, useState } from 'react'
import type { PreviewData } from '@shared/dto'
import { useRootStore } from '@renderer/app/stores/rootStore'
import { readPreview } from '@renderer/app/usecases/preview'
import { tokens } from '@renderer/ui/theme/tokens'
import { PREVIEW_RENDERERS } from './renderers'

const PANEL_WIDTH = 320

/** 활성 패널의 단일 선택 경로(정확히 1개일 때만). 아니면 null. */
function useSingleSelectedPath(): string | null {
  const activePanelId = useRootStore((s) => s.activeTab()?.activePanelId)
  // selectedPaths(Set)는 통째 교체되므로 참조 동일성으로 격리됨.
  const sel = useRootStore((s) => (activePanelId ? s.selection[activePanelId] : undefined))
  if (!sel || sel.selectedPaths.size !== 1) return null
  const [only] = sel.selectedPaths
  return only ?? null
}

export function PreviewPanel(): JSX.Element | null {
  const open = useRootStore((s) => s.previewOpen)
  const path = useSingleSelectedPath()

  const [data, setData] = useState<PreviewData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reqSeq = useRef(0)

  useEffect(() => {
    if (!open || path === null) {
      setData(null)
      setError(null)
      setLoading(false)
      return
    }
    const seq = ++reqSeq.current
    setLoading(true)
    setError(null)
    // 빠른 키보드 이동 시 과호출 방지(디바운스 150ms).
    const timer = setTimeout(() => {
      void readPreview(path)
        .then((res) => {
          if (seq !== reqSeq.current) return // 더 최신 요청이 있으면 폐기.
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
    }, 150)
    return () => clearTimeout(timer)
  }, [open, path])

  if (!open) return null

  return (
    <div
      style={{
        flex: `0 0 ${PANEL_WIDTH}px`,
        width: PANEL_WIDTH,
        minWidth: PANEL_WIDTH,
        display: 'flex',
        flexDirection: 'column',
        borderLeft: `1px solid ${tokens.color.borderStrong}`,
        background: tokens.color.bg,
        overflow: 'hidden'
      }}
      aria-label="미리보기"
    >
      <div
        style={{
          flex: '0 0 auto',
          padding: '6px 12px',
          fontSize: 12,
          fontWeight: 600,
          color: tokens.color.textMuted,
          borderBottom: `1px solid ${tokens.color.border}`
        }}
      >
        미리보기
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {renderBody({ path, loading, error, data })}
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
  if (path === null) {
    return <Placeholder text="미리보기할 항목을 하나 선택하세요." />
  }
  if (loading) {
    return <Placeholder text="불러오는 중…" />
  }
  if (error) {
    return <Placeholder text={error} />
  }
  if (!data) {
    return <Placeholder text="미리보기를 표시할 수 없습니다." />
  }
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
