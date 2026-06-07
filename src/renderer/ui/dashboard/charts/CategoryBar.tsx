/**
 * CategoryBar — 파일 유형(카테고리)별 용량 가로 막대 차트 (K장 K3, recharts BarChart).
 *
 * 셀렉터 격리: props(CategoryUsage[])로만 데이터를 받는다(TopBar 동형). 색은
 * tokens.color.*(CSS 변수). 접근성: 동일 데이터를 DashboardModalBody 가 표로 병행
 * 제공한다(차트는 보조). 0바이트 카테고리는 차트에서 제외한다.
 */
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import type { CategoryUsage, FileCategory } from '@shared/dto'
import { formatBytes } from '@renderer/ui/dashboard/format'
import { tokens } from '@renderer/ui/theme/tokens'

/** 카테고리 한글 라벨. */
export const CATEGORY_LABELS: Record<FileCategory, string> = {
  image: '이미지',
  video: '동영상',
  audio: '오디오',
  document: '문서',
  code: '코드',
  archive: '압축',
  other: '기타'
}

interface Props {
  readonly usages: readonly CategoryUsage[]
}

export function CategoryBar({ usages }: Props): JSX.Element {
  // 0바이트 제외 + 용량 내림차순.
  const charted = usages.filter((u) => u.bytes > 0).sort((a, b) => b.bytes - a.bytes)
  if (charted.length === 0) {
    return (
      <div style={{ color: tokens.color.textMuted, fontSize: 13, padding: '12px 0' }}>
        표시할 유형이 없습니다.
      </div>
    )
  }

  const palette = [
    tokens.color.accent,
    tokens.color.folder,
    tokens.color.file,
    tokens.color.danger,
    tokens.color.borderStrong
  ]
  const data = charted.map((u, i) => ({
    name: CATEGORY_LABELS[u.category],
    value: u.bytes,
    fill: palette[i % palette.length]
  }))
  const height = Math.max(160, data.length * 26 + 24)

  return (
    <div
      role="img"
      aria-label={`파일 유형별 용량 막대 차트(${charted.length}개 유형)`}
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
            width={70}
            tick={{ fill: tokens.color.text, fontSize: 11 }}
            stroke={tokens.color.border}
          />
          <Tooltip
            formatter={(value) => [formatBytes(Number(value)), '용량']}
            contentStyle={{
              background: tokens.color.bgAlt,
              border: `1px solid ${tokens.color.border}`,
              borderRadius: 6,
              color: tokens.color.text,
              fontSize: 12
            }}
            cursor={{ fill: tokens.color.bgHover }}
          />
          <Bar dataKey="value" isAnimationActive={false} radius={[0, 3, 3, 0]}>
            {data.map((d) => (
              <Cell key={d.name} fill={d.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
