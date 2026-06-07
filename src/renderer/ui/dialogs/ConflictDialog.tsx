/**
 * ConflictDialog — 복사/이동 충돌 해소 (US-2.4, features D4, roadmap P4).
 *
 * operationsSlice.conflictQueue 의 head 충돌을 표시한다. source/target 의
 * 이름·크기·수정일·폴더여부를 나란히 비교하고, 선택지를 제공한다:
 *   덮어쓰기(overwrite) / 건너뛰기(skip) / 둘 다 유지(rename) / 병합(merge, 폴더만)
 * "모두 적용"(applyToAll) 체크 시 이후 동일 op 충돌에 일괄 적용 → op:resolve.
 *
 * 다이얼로그 열림 동안 전역 단축키 차단(uiSlice.inputContext='dialog').
 */
import { useEffect, useState } from 'react'
import type { ConflictResolution } from '@shared/dto'
import { useRootStore } from '@renderer/app/stores/rootStore'
import type { ConflictItem } from '@renderer/app/stores/operationsSlice'
import { resolveConflict } from '@renderer/app/usecases/fileOps'
import { tokens } from '@renderer/ui/theme/tokens'
import { btn, overlayStyle, panelStyle, titleStyle } from './dialogStyles'

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function formatMtime(ms: number): string {
  if (!ms) return '—'
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function ConflictDialog(): JSX.Element | null {
  const conflict = useRootStore((s) => s.conflictQueue[0])
  const queueLen = useRootStore((s) => s.conflictQueue.length)
  const setInputContext = useRootStore((s) => s.setInputContext)

  // 충돌이 큐에 있는 동안 다이얼로그 컨텍스트로 전역 단축키 차단.
  useEffect(() => {
    if (conflict) {
      setInputContext('dialog')
      return () => setInputContext('list')
    }
    return undefined
  }, [conflict, setInputContext])

  if (!conflict) return null
  return <ConflictBody conflict={conflict} queueLen={queueLen} />
}

function ConflictBody({
  conflict,
  queueLen
}: {
  conflict: ConflictItem
  queueLen: number
}): JSX.Element {
  const [applyToAll, setApplyToAll] = useState(false)
  const isFolder = conflict.source.isDir && conflict.target.isDir

  function choose(resolution: ConflictResolution): void {
    void resolveConflict(conflict.operationId, conflict.conflictId, resolution, applyToAll)
  }

  return (
    <div style={overlayStyle} role="dialog" aria-modal="true" aria-label="이름 충돌 해결">
      <div style={{ ...panelStyle, minWidth: 520 }}>
        <div style={titleStyle}>
          이름 충돌 {queueLen > 1 ? `(남은 충돌 ${queueLen}건)` : ''}
        </div>
        <p style={{ color: tokens.color.textMuted, marginTop: 0 }}>
          대상 위치에 같은 이름의 항목이 이미 있습니다. 어떻게 처리할까요?
        </p>

        <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
          <CompareCard title="원본(이동/복사할 항목)" entry={conflict.source} />
          <CompareCard title="대상(이미 있는 항목)" entry={conflict.target} />
        </div>

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginTop: 14,
            color: tokens.color.text
          }}
        >
          <input
            type="checkbox"
            checked={applyToAll}
            onChange={(e) => setApplyToAll(e.target.checked)}
          />
          이후 동일한 충돌에 모두 적용
        </label>

        <div
          style={{
            display: 'flex',
            gap: 8,
            justifyContent: 'flex-end',
            marginTop: 16,
            flexWrap: 'wrap'
          }}
        >
          <button style={btn('default')} onClick={() => choose('skip')}>
            건너뛰기
          </button>
          <button style={btn('default')} onClick={() => choose('rename')}>
            둘 다 유지
          </button>
          {isFolder && (
            <button style={btn('default')} onClick={() => choose('merge')}>
              폴더 병합
            </button>
          )}
          <button style={btn('danger')} onClick={() => choose('overwrite')}>
            덮어쓰기
          </button>
        </div>
      </div>
    </div>
  )
}

function CompareCard({
  title,
  entry
}: {
  title: string
  entry: ConflictItem['source']
}): JSX.Element {
  return (
    <div
      style={{
        flex: 1,
        border: `1px solid ${tokens.color.border}`,
        borderRadius: 8,
        padding: 12,
        minWidth: 0
      }}
    >
      <div style={{ fontSize: 12, color: tokens.color.textMuted, marginBottom: 6 }}>{title}</div>
      <div
        style={{
          fontWeight: 600,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}
        title={entry.name}
      >
        {entry.isDir ? '📁 ' : '📄 '}
        {entry.name}
      </div>
      <div style={{ fontSize: 12, color: tokens.color.textMuted, marginTop: 8, lineHeight: 1.7 }}>
        <div>종류: {entry.isDir ? '폴더' : entry.ext ? entry.ext.toUpperCase() : '파일'}</div>
        <div>크기: {entry.isDir ? '—' : formatBytes(entry.size)}</div>
        <div>수정일: {formatMtime(entry.mtime)}</div>
      </div>
    </div>
  )
}
