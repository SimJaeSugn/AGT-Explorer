/**
 * 충돌 해소 보조 — "둘 다 유지" 자동 명명("이름 (n)") (P4, features D4).
 *
 * 순수 함수 모음(fs 접근 없음, 단 nextAvailableName 은 존재 확인 콜백을 받음)
 * → 단위 검증 용이. Worker/Main 양쪽에서 재사용.
 */
import { win32 } from 'node:path'

/**
 * 베이스명/확장자 분리. "report.tar.gz" → { stem:"report.tar", ext:".gz" }.
 * 폴더(확장자 없음)·dotfile 은 ext 빈 문자열.
 */
export function splitName(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return { stem: name, ext: '' }
  return { stem: name.slice(0, dot), ext: name.slice(dot) }
}

/**
 * "둘 다 유지" 후보명 생성: "report.png" → "report (2).png" → "report (3).png" ...
 * n 은 2 부터 시작(원본이 (1) 격이므로 features 의 "복사본"/"(n)" 관례).
 */
export function candidateName(original: string, n: number): string {
  const { stem, ext } = splitName(original)
  return `${stem} (${n})${ext}`
}

/**
 * 대상 디렉토리에서 충돌하지 않는 이름을 찾는다.
 * @param destDir 대상 디렉토리(절대 경로)
 * @param original 원래 이름
 * @param exists 경로 존재 여부 판정 콜백(비동기 fs.access 래핑)
 * @returns 사용 가능한 절대 경로
 */
export async function nextAvailablePath(
  destDir: string,
  original: string,
  exists: (fullPath: string) => Promise<boolean>
): Promise<string> {
  const first = win32.join(destDir, original)
  if (!(await exists(first))) return first
  for (let n = 2; n < 10_000; n++) {
    const candidate = win32.join(destDir, candidateName(original, n))
    if (!(await exists(candidate))) return candidate
  }
  // 극단적: 타임스탬프 접미사로 강제 유일화.
  const { stem, ext } = splitName(original)
  return win32.join(destDir, `${stem} (${Date.now()})${ext}`)
}
