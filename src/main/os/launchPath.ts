/**
 * 실행 인자 경로 추출 (V2 — 탐색기 "AGT-Finder로 열기").
 *
 * Windows 탐색기 컨텍스트 메뉴(Directory/Background/Drive/* )가 등록한 command
 * `"AGT-Finder.exe" "%1"`(배경은 "%V")으로 실행되면, argv 끝에 대상 경로가 붙는다.
 * 이 헬퍼는 argv 에서 플래그가 아니고 정규화(상위이탈 차단)를 통과하며 실제 존재하는
 * 경로 1건을 뒤에서부터 찾는다(없으면 null). 정규화는 기존 가드(normalizePath)를
 * 재사용해 임의/조작 인자를 입구에서 거른다(ADR-005 정합).
 */
import { existsSync } from 'node:fs'
import { normalizePath } from '../fs/paths'

export function extractPathArg(argv: readonly string[]): string | null {
  // argv[0]=실행 파일. 뒤에서부터: '-' 플래그·'.'(개발 cwd) 제외, 정규화·존재 확인.
  for (let i = argv.length - 1; i >= 1; i--) {
    const a = argv[i]
    if (!a || a.startsWith('-') || a === '.') continue
    const g = normalizePath(a)
    if (g.ok && existsSync(g.path)) return g.path
  }
  return null
}
