// 빌드 산출물 정리 스크립트.
//
// 배경(통합 블로커 진단 결과):
//   Node v24.x + Windows 환경에서 동기 재귀 삭제 `fs.rmSync(dir, { recursive: true })`
//   가 네이티브 abort(0xC0000409 STATUS_STACK_BUFFER_OVERRUN, exit 127)를 일으킨다.
//   electron-vite/vite 의 emptyOutDir 처리(`emptyDir` -> `fs.rmSync(..., recursive)`)
//   가 기존 out/ 내용을 지우려다 이 버그를 밟아 "main 번들 write 단계" 직후 크래시했다.
//   (clean build 는 지울 내용이 없어 통과, 재빌드만 깨지던 증상의 원인.)
//
// 해결: 동기 rmSync 대신 비동기 `fs.promises.rm` 으로 out/ 을 먼저 정리한다.
//   비동기 rm 은 동일 환경에서 정상 동작함을 검증했다(exit 0).
//   build 전에 out/ 이 비어 있으면 vite 의 emptyDir 가 크래시 경로를 타지 않는다.
import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'

const targets = process.argv.slice(2)
const dirs = targets.length > 0 ? targets : ['out']

for (const d of dirs) {
  const p = resolve(process.cwd(), d)
  await rm(p, { recursive: true, force: true })
  console.log(`[clean] removed ${p}`)
}
