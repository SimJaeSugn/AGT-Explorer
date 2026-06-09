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
import { SplitDivider } from '@renderer/ui/layout/SplitDivider'
import { PREVIEW_RENDERERS } from './renderers'
import { PreviewInfoCard } from './PreviewInfoCard'

/** 미리보기 기본 폭(더블클릭 복귀값). uiSlice.previewWidth 초기값과 일치. */
const DEFAULT_PREVIEW_WIDTH = 320

/** 활성 패널의 단일 선택 경로(정확히 1개일 때만). 아니면 null. */
function useSingleSelectedPath(): string | null {
  const activePanelId = useRootStore((s) => s.activeTab()?.activePanelId)
  // selectedPaths(Set)는 통째 교체되므로 참조 동일성으로 격리됨.
  const sel = useRootStore((s) => (activePanelId ? s.selection[activePanelId] : undefined))
  if (!sel || sel.selectedPaths.size !== 1) return null
  const [only] = sel.selectedPaths
  return only ?? null
}

interface Props {
  /** J7: SplitDivider 의 비율→px 환산 기준(App 본문 row 컨테이너). */
  readonly containerRef: React.RefObject<HTMLElement>
}

export function PreviewPanel({ containerRef }: Props): JSX.Element | null {
  const open = useRootStore((s) => s.previewOpen)
  const width = useRootStore((s) => s.previewWidth)
  const setPreviewWidth = useRootStore((s) => s.setPreviewWidth)
  const setPreviewOpen = useRootStore((s) => s.setPreviewOpen)
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

  // 접힘 상태: 우측 가장자리에 얇은 세로 스트립(펼치기 핸들)을 남겨 패널 자체에서
  // 다시 펼 수 있게 한다(Ctrl+P·아이콘바 외에 발견 가능한 토글 제공).
  if (!open) {
    return (
      <div
        style={{
          flex: '0 0 auto',
          width: 26,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          borderLeft: `1px solid ${tokens.color.borderStrong}`,
          background: tokens.color.bgAlt
        }}
        aria-label="미리보기(접힘)"
      >
        <button
          onClick={() => setPreviewOpen(true)}
          title="미리보기 펼치기 (Ctrl+P)"
          aria-label="미리보기 펼치기"
          aria-expanded={false}
          style={{
            width: '100%',
            height: 28,
            border: 'none',
            borderBottom: `1px solid ${tokens.color.border}`,
            background: 'transparent',
            color: tokens.color.text,
            cursor: 'pointer',
            fontSize: 13
          }}
        >
          ‹
        </button>
        <span
          style={{
            marginTop: 8,
            writingMode: 'vertical-rl',
            fontSize: 12,
            color: tokens.color.textMuted,
            userSelect: 'none'
          }}
        >
          미리보기
        </span>
      </div>
    )
  }

  // J7: 좌측 경계 divider 드래그 → 컨테이너 폭 기준 비율(ratio)을 px 폭으로 환산.
  // 미리보기는 컨테이너 우측에 붙으므로 우측 폭 = (1-ratio) * containerWidth.
  function onDividerDrag(ratio: number): void {
    const el = containerRef.current
    const cw = el ? el.getBoundingClientRect().width : 0
    if (cw <= 0) return
    setPreviewWidth((1 - ratio) * cw)
  }

  return (
    <>
      <SplitDivider
        orientation="vertical"
        containerRef={containerRef}
        onDrag={onDividerDrag}
        onReset={() => setPreviewWidth(DEFAULT_PREVIEW_WIDTH)}
      />
      <div
        style={{
          flex: `0 0 ${width}px`,
          width,
          minWidth: width,
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
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 6,
            padding: '4px 6px 4px 12px',
            fontSize: 12,
            fontWeight: 600,
            color: tokens.color.textMuted,
            borderBottom: `1px solid ${tokens.color.border}`
          }}
        >
          <span>미리보기</span>
          <button
            onClick={() => setPreviewOpen(false)}
            title="미리보기 접기 (Ctrl+P)"
            aria-label="미리보기 접기"
            aria-expanded={true}
            style={{
              flex: '0 0 auto',
              width: 22,
              height: 22,
              border: 'none',
              borderRadius: 4,
              background: 'transparent',
              color: tokens.color.text,
              cursor: 'pointer',
              fontSize: 14,
              lineHeight: 1
            }}
          >
            ›
          </button>
        </div>
        {/* 상단: 파일 정보 카드 (J6) */}
        <PreviewInfoCard data={data} path={path} />
        {/* 하단: 형식별 뷰어 */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {renderBody({ path, loading, error, data })}
        </div>
      </div>
    </>
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
