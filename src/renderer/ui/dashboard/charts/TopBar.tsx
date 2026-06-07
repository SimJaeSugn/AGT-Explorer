/**
 * TopBar — Top10 폴더/파일 가로 막대 차트 (I장 §3.3, recharts BarChart).
 *
 * 셀렉터 격리: props(ScanEntry[])로만 데이터를 받는다. 색은 tokens.color.*(CSS 변수).
 * 접근성: 동일 데이터를 DashboardModalBody 가 표로 병행 제공한다(차트는 보조).
 */
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import type { ScanEntry } from '@shared/dto'
import { formatBytes } from '@renderer/ui/dashboard/format'
import { tokens } from '@renderer/ui/theme/tokens'

interface Props {
  readonly entries: readonly ScanEntry[]
  /** 막대 색(folder/file 구분). */
  readonly kind: 'folder' | 'file'
}

/** 긴 이름은 축약(축 라벨 가독). */
function shortName(name: string, max = 18): string {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name
}

export function TopBar({ entries, kind }: Props): JSX.Element {
  if (entries.length === 0) {
    return (
      <div style={{ color: tokens.color.textMuted, fontSize: 13, padding: '12px 0' }}>
        표시할 항목이 없습니다.
      </div>
    )
  }
  const data = entries.map((e) => ({ name: shortName(e.name), full: e.name, value: e.bytes }))
  const fill = kind === 'folder' ? tokens.color.folder : tokens.color.file
  const height = Math.max(160, data.length * 26 + 24)

  return (
    <div
      role="img"
      aria-label={`상위 ${kind === 'folder' ? '폴더' : '파일'} ${entries.length}개 크기 막대 차트`}
      style={{ width: '100%', height }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={tokens.color.border} horizontal={false} />
          <XAxis
            type="number"
            tickFormatter={(v: number) => formatBytes(v)}
            tick={{ fill: tokens.color.textMuted, fontSize: 11 }}
            stroke={tokens.color.border}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={130}
            tick={{ fill: tokens.color.text, fontSize: 11 }}
            stroke={tokens.color.border}
          />
          <Tooltip
            formatter={(value) => [formatBytes(Number(value)), '크기']}
            labelFormatter={(_label, payload) =>
              (payload?.[0]?.payload as { full?: string } | undefined)?.full ?? ''
            }
            contentStyle={{
              background: tokens.color.bgAlt,
              border: `1px solid ${tokens.color.border}`,
              borderRadius: 6,
              color: tokens.color.text,
              fontSize: 12
            }}
            cursor={{ fill: tokens.color.bgHover }}
          />
          <Bar dataKey="value" fill={fill} isAnimationActive={false} radius={[0, 3, 3, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
