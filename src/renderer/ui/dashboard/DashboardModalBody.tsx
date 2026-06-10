/**
 * DashboardModalBody — 대시보드 본문 (I장 §4.3). React.lazy 동적 import 대상.
 *
 * recharts(차트)와 분석 데이터 구독을 이 모듈로 격리한다 → 메인 청크 미오염
 * (DashboardModal 이 Suspense 로 감싸 미오픈 시 미로드). CSP 통과(인라인 SVG).
 *
 * 3섹션: (1) 디스크 요약(도넛+표+인사이트) (2) 스캔 대상 선택·진행률·취소
 *        (3) 스캔 결과(Top10 차트+표+인사이트). 차트와 **동일 데이터를 표로 병행**
 *        제공한다(US-8.1 접근성·정밀 수치·스크린리더).
 *
 * 셀렉터 격리: 이 본문만 analyzeSlice/드라이브를 구독한다(차트는 props로만 받음).
 */
import { useEffect, useMemo, useState } from 'react'
import type { CategoryUsage, ScanEntry } from '@shared/dto'
import { useRootStore } from '@renderer/app/stores/rootStore'
import {
  askGoogleAiAboutEntry,
  cancelScan,
  jumpToScanEntry,
  loadDriveUsage,
  startScan
} from '@renderer/app/usecases/dashboard'
import { isMyPc } from '@renderer/domain/paths'
import { DiskDonut } from '@renderer/ui/dashboard/charts/DiskDonut'
import { TopBar } from '@renderer/ui/dashboard/charts/TopBar'
import { CategoryBar, CATEGORY_LABELS } from '@renderer/ui/dashboard/charts/CategoryBar'
import {
  deriveDriveUsages,
  tightestDrive,
  type DriveUsage
} from '@renderer/ui/dashboard/driveUsage'
import { formatBytes, formatCount, formatPct } from '@renderer/ui/dashboard/format'
import { tokens } from '@renderer/ui/theme/tokens'

// ── 공용 스타일 ───────────────────────────────────────────────────────────
const sectionTitle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  margin: '0 0 8px',
  color: tokens.color.text
}
const card: React.CSSProperties = {
  border: `1px solid ${tokens.color.border}`,
  borderRadius: 8,
  padding: 12,
  background: tokens.color.bgAlt
}
const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 12
}
const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '4px 8px',
  borderBottom: `1px solid ${tokens.color.border}`,
  color: tokens.color.textMuted,
  fontWeight: 600
}
const tdStyle: React.CSSProperties = {
  padding: '4px 8px',
  borderBottom: `1px solid ${tokens.color.border}`,
  color: tokens.color.text
}
const tdNum: React.CSSProperties = { ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }
// 스캔결과 표 행별 동작 버튼(위치 이동·AI 질의). 표 안에 들어가는 컴팩트 아이콘 버튼.
const rowActionBtn: React.CSSProperties = {
  height: 22,
  minWidth: 26,
  padding: '0 5px',
  marginLeft: 4,
  borderRadius: 4,
  border: `1px solid ${tokens.color.border}`,
  background: tokens.color.bg,
  color: tokens.color.text,
  cursor: 'pointer',
  fontSize: 12,
  lineHeight: '20px'
}

function insightChip(label: string, value: string): JSX.Element {
  return (
    <div
      style={{
        ...card,
        flex: '1 1 140px',
        minWidth: 140,
        background: tokens.color.bg
      }}
    >
      <div style={{ fontSize: 11, color: tokens.color.textMuted, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 600, color: tokens.color.text }}>{value}</div>
    </div>
  )
}

// ── 디스크 요약 섹션 ───────────────────────────────────────────────────────
function DiskSection({ usages }: { usages: DriveUsage[] }): JSX.Element {
  const totalCapacity = usages.reduce((a, u) => a + (u.totalBytes ?? 0), 0)
  const totalFree = usages.reduce((a, u) => a + (u.freeBytes ?? 0), 0)
  const tightest = tightestDrive(usages)

  return (
    <section aria-label="디스크 사용량 요약">
      <h3 style={sectionTitle}>디스크 사용량</h3>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 240px', minWidth: 240, ...card }}>
          <DiskDonut usages={usages} />
        </div>
        <div style={{ flex: '2 1 320px', minWidth: 280 }}>
          {/* 인사이트 카드 */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            {insightChip('총 용량', formatBytes(totalCapacity))}
            {insightChip('총 여유', formatBytes(totalFree))}
            {insightChip(
              '가장 꽉 찬 드라이브',
              tightest
                ? `${tightest.letter || tightest.label} (여유 ${formatPct(tightest.freeRatio ?? 0)})`
                : '—'
            )}
          </div>
          {/* 접근성: 차트와 동일 데이터를 표로 병행 */}
          <table style={tableStyle}>
            <caption style={{ textAlign: 'left', fontSize: 11, color: tokens.color.textMuted, paddingBottom: 4 }}>
              드라이브별 용량(표)
            </caption>
            <thead>
              <tr>
                <th style={thStyle} scope="col">드라이브</th>
                <th style={{ ...thStyle, textAlign: 'right' }} scope="col">사용</th>
                <th style={{ ...thStyle, textAlign: 'right' }} scope="col">여유</th>
                <th style={{ ...thStyle, textAlign: 'right' }} scope="col">총</th>
                <th style={{ ...thStyle, textAlign: 'right' }} scope="col">여유 %</th>
              </tr>
            </thead>
            <tbody>
              {usages.map((u) => (
                <tr key={u.path}>
                  <th style={{ ...tdStyle, fontWeight: 500 }} scope="row">
                    {u.label}
                  </th>
                  <td style={tdNum}>{u.usedBytes !== null ? formatBytes(u.usedBytes) : '정보없음'}</td>
                  <td style={tdNum}>{u.freeBytes !== null ? formatBytes(u.freeBytes) : '정보없음'}</td>
                  <td style={tdNum}>{u.totalBytes !== null ? formatBytes(u.totalBytes) : '정보없음'}</td>
                  <td style={tdNum}>{u.freeRatio !== null ? formatPct(u.freeRatio) : '—'}</td>
                </tr>
              ))}
              {usages.length === 0 && (
                <tr>
                  <td style={tdStyle} colSpan={5}>
                    드라이브 정보가 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

// ── Top10 표 ───────────────────────────────────────────────────────────────
function TopTable({
  title,
  entries
}: {
  title: string
  entries: readonly ScanEntry[]
}): JSX.Element {
  return (
    <table style={tableStyle}>
      <caption style={{ textAlign: 'left', fontSize: 11, color: tokens.color.textMuted, paddingBottom: 4 }}>
        {title}(표)
      </caption>
      <thead>
        <tr>
          <th style={{ ...thStyle, width: 28 }} scope="col">#</th>
          <th style={thStyle} scope="col">이름</th>
          <th style={{ ...thStyle, textAlign: 'right' }} scope="col">크기</th>
          <th style={{ ...thStyle, textAlign: 'center', width: 86 }} scope="col">동작</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((e, i) => (
          <tr key={e.path}>
            <td style={tdNum}>{i + 1}</td>
            <th style={{ ...tdStyle, fontWeight: 500 }} scope="row" title={e.path}>
              {e.name}
            </th>
            <td style={tdNum}>{formatBytes(e.bytes)}</td>
            <td style={{ ...tdStyle, textAlign: 'center', whiteSpace: 'nowrap' }}>
              <button
                type="button"
                onClick={() => jumpToScanEntry(e)}
                title={`${e.isDir ? '이 폴더' : '상위 폴더'}로 이동`}
                aria-label={`${e.name} 위치로 이동`}
                style={rowActionBtn}
              >
                📂
              </button>
              <button
                type="button"
                onClick={() => void askGoogleAiAboutEntry(e)}
                title="Google AI 모드로 질의"
                aria-label={`${e.name} Google AI 모드로 질의`}
                style={rowActionBtn}
              >
                ✨
              </button>
            </td>
          </tr>
        ))}
        {entries.length === 0 && (
          <tr>
            <td style={tdStyle} colSpan={4}>
              항목이 없습니다.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  )
}

// ── 유형별 비중 섹션 (K3) ───────────────────────────────────────────────────
function CategorySection({ byCategory }: { byCategory: readonly CategoryUsage[] }): JSX.Element {
  // 용량 내림차순 정렬(표시·인사이트 공유). 전체 합으로 비중% 산출.
  const sorted = useMemo(
    () => [...byCategory].sort((a, b) => b.bytes - a.bytes),
    [byCategory]
  )
  const totalBytes = sorted.reduce((a, c) => a + c.bytes, 0)
  const largest = sorted.find((c) => c.bytes > 0)

  return (
    <section aria-label="파일 유형별 비중" style={{ marginTop: 16 }}>
      <h4 style={sectionTitle}>파일 유형별 비중</h4>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        {insightChip(
          '가장 큰 유형',
          largest
            ? `${CATEGORY_LABELS[largest.category]} (${formatBytes(largest.bytes)})`
            : '—'
        )}
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 320px', minWidth: 300 }}>
          <CategoryBar usages={sorted} />
        </div>
        <div style={{ flex: '1 1 320px', minWidth: 300 }}>
          <table style={tableStyle}>
            <caption
              style={{ textAlign: 'left', fontSize: 11, color: tokens.color.textMuted, paddingBottom: 4 }}
            >
              유형별 용량(표)
            </caption>
            <thead>
              <tr>
                <th style={thStyle} scope="col">유형</th>
                <th style={{ ...thStyle, textAlign: 'right' }} scope="col">용량</th>
                <th style={{ ...thStyle, textAlign: 'right' }} scope="col">개수</th>
                <th style={{ ...thStyle, textAlign: 'right' }} scope="col">비중</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((c) => (
                <tr key={c.category}>
                  <th style={{ ...tdStyle, fontWeight: 500 }} scope="row">
                    {CATEGORY_LABELS[c.category]}
                  </th>
                  <td style={tdNum}>{formatBytes(c.bytes)}</td>
                  <td style={tdNum}>{formatCount(c.count)}</td>
                  <td style={tdNum}>{totalBytes > 0 ? formatPct(c.bytes / totalBytes) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

// ── 스캔 섹션 ──────────────────────────────────────────────────────────────
function ScanSection(): JSX.Element {
  const drives = useRootStore((s) => s.drives)
  const scanStatus = useRootStore((s) => s.scanStatus)
  const scanRoot = useRootStore((s) => s.scanRoot)
  const scanProgress = useRootStore((s) => s.scanProgress)
  const scanResult = useRootStore((s) => s.scanResult)
  const scanError = useRootStore((s) => s.scanError)
  const activePanelId = useRootStore((s) => s.activePanelId())
  const activePanelPath = useRootStore((s) =>
    activePanelId ? s.panels[activePanelId]?.path ?? '' : ''
  )

  // 스캔 대상 후보: 현재 활성 폴더(내 PC 아님) + 드라이브 루트들.
  const targets = useMemo(() => {
    const list: { value: string; label: string }[] = []
    if (activePanelPath && !isMyPc(activePanelPath)) {
      list.push({ value: activePanelPath, label: `현재 폴더 — ${activePanelPath}` })
    }
    for (const d of drives) {
      if (d.ready) list.push({ value: d.path, label: `${d.label}` })
    }
    return list
  }, [activePanelPath, drives])

  // 기본 선택: 현재 폴더가 있으면 그것, 없으면 첫 드라이브.
  const defaultTarget = targets[0]?.value ?? ''
  const scanning = scanStatus === 'scanning'

  // 선택된 스캔 대상(제어 상태). 후보가 바뀌어 현재 선택이 사라지면 기본값으로 보정.
  const [selected, setSelected] = useState(defaultTarget)
  const effectiveTarget = targets.some((t) => t.value === selected) ? selected : defaultTarget

  return (
    <section aria-label="디렉토리 사용량 스캔" style={{ marginTop: 20 }}>
      <h3 style={sectionTitle}>상위 폴더/파일 스캔(Top 10)</h3>
      <div style={{ ...card }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <label htmlFor="scan-target" style={{ fontSize: 12, color: tokens.color.textMuted }}>
            대상
          </label>
          <select
            id="scan-target"
            value={effectiveTarget}
            disabled={scanning || targets.length === 0}
            aria-label="스캔 대상"
            style={{
              flex: '1 1 240px',
              height: 28,
              border: `1px solid ${tokens.color.border}`,
              borderRadius: 5,
              background: tokens.color.bg,
              color: tokens.color.text,
              padding: '0 6px',
              fontSize: 12
            }}
            onChange={(e) => setSelected(e.target.value)}
          >
            {targets.length === 0 && <option value="">스캔할 위치가 없습니다</option>}
            {targets.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          {!scanning ? (
            <button
              disabled={targets.length === 0 || !effectiveTarget}
              onClick={() => {
                if (effectiveTarget) void startScan(effectiveTarget)
              }}
              style={btnStyle('primary')}
            >
              스캔 시작
            </button>
          ) : (
            <button onClick={() => void cancelScan()} style={btnStyle('danger')}>
              취소
            </button>
          )}
        </div>

        {/* 진행률 */}
        {scanning && (
          <div style={{ marginTop: 12 }} role="status" aria-live="polite">
            <div
              style={{
                height: 6,
                borderRadius: 3,
                background: tokens.color.bgHover,
                overflow: 'hidden',
                marginBottom: 6
              }}
            >
              {/* 총량 불명 → 인디터미네이트 느낌의 채움(accent). */}
              <div
                style={{
                  height: '100%',
                  width: '40%',
                  background: tokens.color.accent,
                  animation: 'none'
                }}
              />
            </div>
            <div style={{ fontSize: 12, color: tokens.color.textMuted }}>
              {formatCount(scanProgress.scannedItems)}개 항목 ·{' '}
              {formatBytes(scanProgress.scannedBytes)} 스캔 중
            </div>
            <div
              style={{
                fontSize: 11,
                color: tokens.color.textMuted,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}
              title={scanProgress.currentPath}
            >
              {scanProgress.currentPath || '…'}
            </div>
          </div>
        )}

        {scanStatus === 'error' && (
          <div style={{ marginTop: 10, color: tokens.color.danger, fontSize: 12 }} role="alert">
            스캔 오류: {scanError}
          </div>
        )}
        {scanStatus === 'canceled' && (
          <div style={{ marginTop: 10, color: tokens.color.textMuted, fontSize: 12 }}>
            스캔이 취소되었습니다.
          </div>
        )}
      </div>

      {/* 결과 */}
      {scanResult && (scanStatus === 'done' || scanStatus === 'canceled') && (
        <div style={{ marginTop: 12 }}>
          {/* 결과 인사이트 */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            {insightChip('루트', scanResult.root)}
            {insightChip('총 크기', formatBytes(scanResult.totalBytes))}
            {insightChip('항목 수', formatCount(scanResult.totalItems))}
            {insightChip(
              '최대 폴더',
              scanResult.topFolders[0]
                ? `${scanResult.topFolders[0].name} (${formatBytes(scanResult.topFolders[0].bytes)})`
                : '—'
            )}
          </div>
          {(scanResult.skipped > 0 || scanResult.truncated) && (
            <div style={{ fontSize: 11, color: tokens.color.textMuted, marginBottom: 10 }}>
              {scanResult.skipped > 0 && `건너뜀 ${formatCount(scanResult.skipped)}개(권한·순환). `}
              {scanResult.truncated && '항목 상한 초과로 일부만 집계됨.'}
            </div>
          )}

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 320px', minWidth: 300 }}>
              <h4 style={sectionTitle}>상위 폴더{scanRoot ? '' : ''}</h4>
              <TopBar entries={scanResult.topFolders} kind="folder" />
              <TopTable title="상위 폴더" entries={scanResult.topFolders} />
            </div>
            <div style={{ flex: '1 1 320px', minWidth: 300 }}>
              <h4 style={sectionTitle}>상위 파일</h4>
              <TopBar entries={scanResult.topFiles} kind="file" />
              <TopTable title="상위 파일" entries={scanResult.topFiles} />
            </div>
          </div>

          {/* K3: 파일 유형별 비중(byCategory 가 있을 때만). */}
          {scanResult.byCategory && scanResult.byCategory.length > 0 && (
            <CategorySection byCategory={scanResult.byCategory} />
          )}
        </div>
      )}
    </section>
  )
}

function btnStyle(variant: 'primary' | 'danger'): React.CSSProperties {
  const base: React.CSSProperties = {
    height: 28,
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
  return { ...base, background: tokens.color.danger, borderColor: tokens.color.danger, color: '#fff' }
}

/** 대시보드 본문(lazy default export). 마운트 시 드라이브 사용량을 로드한다. */
export default function DashboardModalBody(): JSX.Element {
  const drives = useRootStore((s) => s.drives)
  const drivesLoading = useRootStore((s) => s.drivesLoading)
  const drivesError = useRootStore((s) => s.drivesError)

  // 모달 오픈(본문 마운트) 즉시 드라이브 로드.
  useEffect(() => {
    void loadDriveUsage()
  }, [])

  const usages = useMemo(() => deriveDriveUsages(drives), [drives])

  return (
    <div>
      {drivesLoading && drives.length === 0 ? (
        <div style={{ color: tokens.color.textMuted, fontSize: 13, padding: '12px 0' }}>
          드라이브 정보를 불러오는 중…
        </div>
      ) : (
        <DiskSection usages={usages} />
      )}
      {drivesError && (
        <div style={{ color: tokens.color.danger, fontSize: 12, marginTop: 8 }} role="alert">
          {drivesError}
        </div>
      )}
      <ScanSection />
    </div>
  )
}
