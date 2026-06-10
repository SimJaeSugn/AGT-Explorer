/* V(일괄) 자동링크 순수 로직 검증(임시 하니스).
 * contentsearch.verify.ts 와 동일한 eq()/summary 구조. esbuild 번들 가능.
 *
 * 격리 가능한 순수 헬퍼만 검증한다(실 FS/op/IPC 미접근):
 *  - composeBackupName: 백업 이름 합성(baseName + suffix)
 *  - emptyTally / tallyResult: 상태별 누적 카운트
 *  - summarizeBatch: 누적값 → 요약 문구
 */
import {
  composeBackupName,
  emptyTally,
  tallyResult,
  summarizeBatch,
  DEFAULT_BACKUP_SUFFIX,
  type BatchTally
} from '../src/renderer/app/usecases/autoLink'

let pass = 0
let fail = 0
function eq(label: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got)
  const w = JSON.stringify(want)
  if (g === w) pass++
  else {
    fail++
    console.log('FAIL', label, '| got', g, '| want', w)
  }
}

// ── composeBackupName: baseName + suffix ───────────────────────────────────
eq('AL 기본접미사 상수', DEFAULT_BACKUP_SUFFIX, '.원본')
eq('AL backup 윈도경로', composeBackupName('D:\\work\\proj', '.원본'), 'proj.원본')
eq('AL backup 끝슬래시', composeBackupName('D:\\work\\proj\\', '.원본'), 'proj.원본')
eq('AL backup 슬래시', composeBackupName('C:/a/b/data', '.bak'), 'data.bak')
eq('AL backup 드라이브루트직속', composeBackupName('E:\\folder', '.원본'), 'folder.원본')
eq('AL backup 커스텀접미사', composeBackupName('D:\\x\\node_modules', '_old'), 'node_modules_old')

// ── emptyTally: 초기값 ─────────────────────────────────────────────────────
eq('AL emptyTally', emptyTally(), { ok: 0, locked: 0, conflict: 0, failed: 0, remaining: 0 })

// ── tallyResult: 상태별 누적 ───────────────────────────────────────────────
{
  const t = emptyTally()
  tallyResult(t, 'ok')
  tallyResult(t, 'ok')
  tallyResult(t, 'skipped', 'locked')
  tallyResult(t, 'skipped', 'conflict')
  tallyResult(t, 'skipped', 'conflict')
  tallyResult(t, 'failed')
  eq('AL tally 누적', t, { ok: 2, locked: 1, conflict: 2, failed: 1, remaining: 0 })
}
{
  // skipped 인데 reason 미지정 → conflict 로 집계(보수적 분류).
  const t = emptyTally()
  tallyResult(t, 'skipped')
  eq('AL tally skip 사유없음→conflict', t, { ok: 0, locked: 0, conflict: 1, failed: 0, remaining: 0 })
}
{
  // canceled 는 누적하지 않음(중단 신호 — remaining 은 호출부가 별도 설정).
  const t = emptyTally()
  tallyResult(t, 'canceled')
  eq('AL tally canceled 무집계', t, { ok: 0, locked: 0, conflict: 0, failed: 0, remaining: 0 })
}

// ── summarizeBatch: 요약 문구 ──────────────────────────────────────────────
{
  const t: BatchTally = { ok: 3, locked: 2, conflict: 1, failed: 0, remaining: 0 }
  eq(
    'AL summary 정상완료',
    summarizeBatch(t),
    '일괄 자동링크 완료 — 성공 3 · 제외(잠김/권한) 2 · 충돌 1 · 실패 0'
  )
}
{
  const t: BatchTally = { ok: 0, locked: 0, conflict: 0, failed: 0, remaining: 0 }
  eq(
    'AL summary 전부0',
    summarizeBatch(t),
    '일괄 자동링크 완료 — 성공 0 · 제외(잠김/권한) 0 · 충돌 0 · 실패 0'
  )
}
{
  // remaining>0(사용자 중단) → "중단" 문구 + 미처리 카운트.
  const t: BatchTally = { ok: 1, locked: 1, conflict: 0, failed: 1, remaining: 2 }
  eq(
    'AL summary 중단',
    summarizeBatch(t),
    '일괄 자동링크 중단 — 성공 1 · 제외(잠김/권한) 1 · 충돌 0 · 실패 1 · 미처리 2'
  )
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
