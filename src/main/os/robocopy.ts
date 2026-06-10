/**
 * robocopy 고속 미러 복사 실행기 (V3 — 폴더 비교 "고속 미러", ADR-005).
 *
 * Windows 내장 robocopy(멀티스레드)로 srcDir 내용을 dstDir 로 복사한다. **`/PURGE` 없음**
 * → 대상에만 있는 항목을 삭제하지 않는다(삭제는 앱이 휴지통 op 로 별도 수행 — undo 보존).
 * 즉 robocopy 는 미러의 "복사" 측만 담당한다.
 *
 * 보안(ADR-005): 셸 미경유 spawn + 인자 배열(경로 문자열 합성 0 — 공백·한글·`&` 무해).
 * 호출부(op.handlers/OperationManager)가 경로 정규화·디렉토리 존재·win32 플랫폼을 사전 검증한다.
 *
 * 진행률: robocopy stdout 의 파일 라인(/FP 전체경로·/BYTES)을 파싱해 복사 항목/바이트를
 * 누적 보고한다. 라인 포맷은 로케일/버전 영향이 있어 best-effort(정직: 런타임 스모크 필요).
 * 취소: 반환된 cancel() 이 자식 프로세스를 종료한다.
 */
import { spawn } from 'node:child_process'
import { win32 } from 'node:path'

export interface RobocopyProgress {
  readonly copiedItems: number
  readonly copiedBytes: number
  readonly currentName: string
}

export interface RobocopyResult {
  readonly copied: number
  readonly canceled: boolean
  readonly failed: boolean
  readonly errorMessage?: string
}

export interface RobocopyHandle {
  readonly promise: Promise<RobocopyResult>
  readonly cancel: () => void
}

/**
 * robocopy 출력 1줄에서 복사된 파일을 추출한다. 파일 라인은 마지막 필드가 전체 경로(/FP)이고
 * 어딘가에 바이트 크기(/BYTES) 숫자 필드가 있다. 디렉토리 라인은 /NDL 로 억제된다.
 * 경로처럼 보이지 않으면(요약·빈 줄 등) null.
 */
function parseFileLine(line: string): { path: string; bytes: number } | null {
  const parts = line
    .split('\t')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  if (parts.length === 0) return null
  const last = parts[parts.length - 1] as string
  const isLocal = /^[A-Za-z]:\\/.test(last)
  const isUnc = last.startsWith('\\\\')
  if ((!isLocal && !isUnc) || last.endsWith('\\')) return null // 디렉토리/비경로 제외
  let bytes = 0
  for (const p of parts) {
    if (/^\d+$/.test(p)) {
      bytes = Number(p)
      break
    }
  }
  return { path: last, bytes }
}

/**
 * robocopy 복사-전용 미러 실행. 호출부가 win32·경로 검증을 마친 뒤 호출한다.
 * @param threads /MT 동시 스레드 수(기본 16).
 */
export function runRobocopyCopy(
  srcDir: string,
  dstDir: string,
  onProgress: (p: RobocopyProgress) => void,
  threads = 16
): RobocopyHandle {
  // 복사 전용(/E 하위폴더 포함, /PURGE 없음) + 멀티스레드 + 짧은 재시도 + 파싱용 출력 옵션.
  const args = [
    srcDir,
    dstDir,
    '/E',
    '/COPY:DAT',
    '/DCOPY:DAT',
    '/R:1',
    '/W:1',
    `/MT:${threads}`,
    '/NP', // 퍼센트 진행 줄 억제(CR 폭주 방지)
    '/NDL', // 디렉토리 목록 억제(파일 라인만 파싱)
    '/NJH', // 작업 헤더 억제
    '/NJS', // 작업 요약 억제
    '/BYTES', // 크기를 바이트로
    '/FP' // 전체 경로 출력(파싱용)
  ]
  let canceled = false
  let copiedItems = 0
  let copiedBytes = 0
  let buf = ''

  const child = spawn('robocopy.exe', args, { windowsHide: true })

  const onData = (chunk: Buffer): void => {
    buf += chunk.toString('utf8')
    let idx: number
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).replace(/\r$/, '')
      buf = buf.slice(idx + 1)
      const f = parseFileLine(line)
      if (f) {
        copiedItems++
        copiedBytes += f.bytes
        onProgress({ copiedItems, copiedBytes, currentName: win32.basename(f.path) })
      }
    }
  }
  child.stdout.on('data', onData)

  const promise = new Promise<RobocopyResult>((resolve) => {
    child.on('error', (e) => {
      resolve({ copied: copiedItems, canceled, failed: true, errorMessage: e.message })
    })
    child.on('close', (code) => {
      if (canceled) {
        resolve({ copied: copiedItems, canceled: true, failed: false })
        return
      }
      // robocopy 종료 코드: 0~7 성공(0=변경없음,1=복사됨,2=추가,4=불일치 …), 8 이상 실패.
      const failed = code === null || code >= 8
      resolve({
        copied: copiedItems,
        canceled: false,
        failed,
        ...(failed ? { errorMessage: `robocopy 종료 코드 ${code ?? '없음'}` } : {})
      })
    })
  })

  return {
    promise,
    cancel: (): void => {
      canceled = true
      child.kill()
    }
  }
}
