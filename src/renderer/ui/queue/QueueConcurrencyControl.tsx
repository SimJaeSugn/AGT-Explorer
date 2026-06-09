/**
 * QueueConcurrencyControl — 전송 큐 동시성 한도 설정 (§R3·US-17.3·F24).
 *
 * operationsSlice.maxConcurrent(queue:set-concurrency 미러)를 표시하고 1~16 범위에서
 * 조절한다. 변경은 usecases/queue.setConcurrency(queueApi 호출 + 성공 시 미러)로 수렴.
 * maxConcurrent=0(미수신)이면 기본 표시값 2를 보인다(정직 — 서버 확정 전 추정).
 */
import { useRootStore } from '@renderer/app/stores/rootStore'
import { setConcurrency } from '@renderer/app/usecases/queue'
import { tokens } from '@renderer/ui/theme/tokens'

const DEFAULT_DISPLAY = 2

export function QueueConcurrencyControl(): JSX.Element {
  const max = useRootStore((s) => s.maxConcurrent)
  const value = max > 0 ? max : DEFAULT_DISPLAY

  return (
    <label
      style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: tokens.color.textMuted }}
    >
      동시 작업
      <select
        value={value}
        aria-label="동시 작업 수"
        onChange={(e) => void setConcurrency(Number(e.target.value))}
        style={{
          height: 26,
          borderRadius: 6,
          border: `1px solid ${tokens.color.border}`,
          background: tokens.color.bg,
          color: tokens.color.text,
          fontSize: 12,
          padding: '0 6px'
        }}
      >
        {[1, 2, 3, 4, 6, 8].map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </label>
  )
}
