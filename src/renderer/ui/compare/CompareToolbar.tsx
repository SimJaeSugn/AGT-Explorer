/**
 * CompareToolbar — 폴더 비교 모드 컨트롤바 (§P1·F20).
 *
 * 비교 종료·"차이만 보기"·동기 스크롤 토글·미러 방향 버튼·4상태 요약을 제공한다.
 * 미러는 파괴적이므로 requestMirror → 확인 모달(CompareMirrorDialog) 경유로만 실행.
 * 모든 동작은 usecases/compare 경유(ui→infra 직접 import 금지).
 */
import { useRootStore } from '@renderer/app/stores/rootStore'
import {
  cancelHashCompare,
  requestMirror,
  stopCompare,
  toggleCompareRecursive,
  toggleCompareUseHash
} from '@renderer/app/usecases/compare'
import { tokens } from '@renderer/ui/theme/tokens'

const barBtn: React.CSSProperties = {
  border: `1px solid ${tokens.color.border}`,
  background: tokens.color.bg,
  borderRadius: 4,
  height: 24,
  padding: '0 8px',
  cursor: 'pointer',
  fontSize: 12,
  color: tokens.color.text,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4
}

function toggleStyle(active: boolean): React.CSSProperties {
  return {
    ...barBtn,
    background: active ? tokens.color.bgSelected : tokens.color.bg,
    borderColor: active ? tokens.color.accentBorder : tokens.color.border
  }
}

export function CompareToolbar(): JSX.Element {
  const summary = useRootStore((s) => s.compareSummary)
  const diffOnly = useRootStore((s) => s.compareDiffOnly)
  const syncScroll = useRootStore((s) => s.syncScroll)
  const toggleDiffOnly = useRootStore((s) => s.toggleDiffOnly)
  const toggleSyncScroll = useRootStore((s) => s.toggleSyncScroll)
  // §P1 해시/재귀 옵션·진행 상태.
  const useHash = useRootStore((s) => s.compareOptions.useHash === true)
  const recursive = useRootStore((s) => s.compareOptions.recursive === true)
  const hashStatus = useRootStore((s) => s.compareHashStatus)
  const scannedItems = useRootStore((s) => s.compareScannedItems)
  const truncated = useRootStore((s) => s.compareTruncated)
  const running = hashStatus === 'running'

  return (
    <div
      style={{
        flex: '0 0 auto',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 8px',
        borderBottom: `1px solid ${tokens.color.borderStrong}`,
        background: tokens.color.bgAlt,
        flexWrap: 'wrap'
      }}
    >
      <strong style={{ fontSize: 12 }}>폴더 비교</strong>

      {/* 4상태 요약 */}
      {summary && (
        <span style={{ display: 'inline-flex', gap: 8, fontSize: 11, color: tokens.color.textMuted }}>
          <SummaryChip color="rgba(56,142,60,0.9)" label="좌만" n={summary.leftOnly} />
          <SummaryChip color="rgba(25,118,210,0.9)" label="우만" n={summary.rightOnly} />
          <SummaryChip color="rgba(245,124,0,0.95)" label="다름" n={summary.diff} />
          <SummaryChip color={tokens.color.textMuted} label="같음" n={summary.same} />
        </span>
      )}

      <span style={{ flex: 1 }} />

      <button
        type="button"
        style={toggleStyle(diffOnly)}
        aria-pressed={diffOnly}
        onClick={() => toggleDiffOnly()}
        title="같음 항목을 숨기고 차이만 표시"
      >
        차이만 보기
      </button>
      <button
        type="button"
        style={toggleStyle(syncScroll)}
        aria-pressed={syncScroll}
        onClick={() => toggleSyncScroll()}
        title="좌/우 패널 스크롤 연동"
      >
        동기 스크롤
      </button>

      <span style={{ width: 1, height: 18, background: tokens.color.border }} />

      {/* §P1 해시(내용) 비교 · 재귀 토글 — 켜면 백엔드 hash:compare 잡 사용. */}
      <button
        type="button"
        style={toggleStyle(useHash)}
        aria-pressed={useHash}
        onClick={() => toggleCompareUseHash()}
        title="같은 이름·같은 크기 항목의 내용(SHA-256 해시)을 비교합니다(로컬 폴더)"
      >
        내용 비교(해시)
      </button>
      <button
        type="button"
        style={toggleStyle(recursive)}
        aria-pressed={recursive}
        onClick={() => toggleCompareRecursive()}
        title="하위 폴더까지 재귀적으로 비교합니다(로컬 폴더)"
      >
        하위 폴더 포함
      </button>

      {/* 해시/재귀 잡 진행률·취소(running 일 때만). */}
      {running && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: tokens.color.textMuted }}>
          <span aria-live="polite">비교 중… {scannedItems.toLocaleString()}개</span>
          <button
            type="button"
            style={barBtn}
            onClick={() => void cancelHashCompare()}
            title="해시/재귀 비교 취소"
          >
            취소
          </button>
        </span>
      )}
      {!running && truncated && (
        <span style={{ fontSize: 11, color: 'rgba(245,124,0,0.95)' }} title="항목 상한에 도달해 일부만 비교했습니다.">
          ⚠ 일부만 비교됨
        </span>
      )}

      <span style={{ width: 1, height: 18, background: tokens.color.border }} />

      <button
        type="button"
        style={barBtn}
        onClick={() => requestMirror('l2r', false)}
        title="왼쪽 기준으로 오른쪽에 없는/다른 항목을 복사(확인 후 실행)"
      >
        왼쪽 → 오른쪽 미러
      </button>
      <button
        type="button"
        style={barBtn}
        onClick={() => requestMirror('r2l', false)}
        title="오른쪽 기준으로 왼쪽에 없는/다른 항목을 복사(확인 후 실행)"
      >
        오른쪽 → 왼쪽 미러
      </button>

      <span style={{ width: 1, height: 18, background: tokens.color.border }} />

      <button type="button" style={barBtn} onClick={() => stopCompare()} title="비교 모드 종료">
        ✕ 비교 종료
      </button>
    </div>
  )
}

function SummaryChip({ color, label, n }: { color: string; label: string; n: number }): JSX.Element {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      <span style={{ width: 8, height: 8, borderRadius: 2, background: color, display: 'inline-block' }} />
      {label} {n}
    </span>
  )
}
