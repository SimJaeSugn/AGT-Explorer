/**
 * DiskDonut — 드라이브별 사용/여유 도넛 차트 (I장 §3.3, recharts PieChart).
 *
 * 셀렉터 격리: props(DriveUsage[])로만 데이터를 받는다(스토어 직접 구독 X).
 * 색은 tokens.color.*(CSS 변수) → 테마(블루라이트 포함) 자동 연동.
 *
 * 접근성: 차트는 보조(시각). 동일 데이터의 표·인사이트는 DashboardModalBody 가 제공한다.
 * 차트 컨테이너에 role="img"+aria-label 로 요약을 노출한다.
 */
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import type { DriveUsage } from '@renderer/ui/dashboard/driveUsage'
import { formatBytes, formatPct } from '@renderer/ui/dashboard/format'
import { tokens } from '@renderer/ui/theme/tokens'

interface Props {
  /** 표시할 드라이브(사용량 정보 있는 것만 차트화). */
  readonly usages: readonly DriveUsage[]
}

/** 도넛 한 조각: 한 드라이브의 used/free 를 2-segment 로. */
export function DiskDonut({ usages }: Props): JSX.Element {
  const charted = usages.filter((u) => u.hasUsage && u.usedBytes !== null)

  if (charted.length === 0) {
    return (
      <div style={{ color: tokens.color.textMuted, fontSize: 13, padding: '20px 0' }}>
        용량 정보를 가진 드라이브가 없습니다.
      </div>
    )
  }

  // 드라이브가 1개면 used/free 2-segment 도넛, 여러 개면 드라이브별 used 합산 도넛.
  const single = charted.length === 1
  const data = single
    ? [
        { name: '사용', value: charted[0].usedBytes as number, kind: 'used' as const },
        { name: '여유', value: charted[0].freeBytes as number, kind: 'free' as const }
      ]
    : charted.map((u) => ({
        name: `${u.letter || u.label} 사용`,
        value: u.usedBytes as number,
        kind: 'drive' as const
      }))

  // 색: 사용=accent, 여유=border-strong, 멀티드라이브는 folder/file/accent 순환.
  const palette = [
    tokens.color.accent,
    tokens.color.folder,
    tokens.color.file,
    tokens.color.danger,
    tokens.color.borderStrong
  ]
  const colorOf = (i: number, kind: string): string => {
    if (kind === 'used') return tokens.color.accent
    if (kind === 'free') return tokens.color.borderStrong
    return palette[i % palette.length]
  }

  const ariaLabel = single
    ? `${charted[0].letter || charted[0].label} 드라이브 사용 ${formatPct(
        charted[0].usedRatio ?? 0
      )}, 여유 ${formatBytes(charted[0].freeBytes ?? 0)}`
    : `드라이브 ${charted.length}개 사용량 도넛 차트`

  return (
    <div role="img" aria-label={ariaLabel} style={{ width: '100%', height: 200 }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius={50}
            outerRadius={80}
            paddingAngle={1}
            stroke={tokens.color.bg}
            isAnimationActive={false}
          >
            {data.map((d, i) => (
              <Cell key={d.name} fill={colorOf(i, d.kind)} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value, name) => [formatBytes(Number(value)), String(name)]}
            contentStyle={{
              background: tokens.color.bgAlt,
              border: `1px solid ${tokens.color.border}`,
              borderRadius: 6,
              color: tokens.color.text,
              fontSize: 12
            }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}
