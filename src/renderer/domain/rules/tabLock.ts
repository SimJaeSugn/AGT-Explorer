/**
 * tabLock — 잠긴 탭의 "루트 잠금" 경계 판정 규칙 (백로그 ①·US-20.3 확장).
 *
 * 탭을 잠그면 그 시점 **각 분할 패널이 자신의 경로**를 루트로 고정한다(`Tab.lockedRoots[panelId]`).
 * 잠긴 동안 각 패널은 자기 루트 자신 또는 그 하위로만 이동할 수 있고(상위·뒤로/앞으로/주소입력으로
 * 루트 밖 이탈 차단), 툴바의 "루트로" 버튼으로 자기 루트에 즉시 복귀한다.
 *
 * 순수 함수(부수효과 0). 경로 종류(로컬/원격/압축/내 PC)는 paths.parentOf 규칙을 재사용한다.
 */
import { parentOf } from '@renderer/domain/paths'

/**
 * 경로 비교용 정규화. 로컬은 대소문자 무시·백슬래시·후행 구분자 제거(Windows 동치),
 * 원격(`sftp://`)/압축(`!/`)은 후행 슬래시만 제거(경로 대소문자 구분).
 */
function normForCompare(p: string): string {
  const remoteOrArchive = p.includes('://') || p.includes('!/')
  if (remoteOrArchive) return p.replace(/\/+$/, '')
  return p.replace(/[\\/]+$/, '').replace(/\//g, '\\').toLowerCase()
}

/**
 * `target` 이 잠긴 루트 `root` 자신이거나 그 하위인가. parentOf 로 조상 사슬을 거슬러
 * 올라가며 비교한다(루트보다 상위면 false → 이동 차단 신호). 내 PC 루트('')는 전부 허용.
 */
export function isWithinLockedRoot(target: string, root: string): boolean {
  const r = normForCompare(root)
  let p: string | null = target
  for (let i = 0; p !== null && i < 256; i++) {
    if (normForCompare(p) === r) return true
    p = parentOf(p)
  }
  return false
}
