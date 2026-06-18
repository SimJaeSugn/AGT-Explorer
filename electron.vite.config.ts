import { copyFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

/**
 * §Y1·§Y2: PowerShell 워커 .ps1 들을 out/main/ 으로 복사한다(rollup 은 .ps1 비-JS 를
 * 번들하지 않음). 신규 의존성 0(node:fs) · 빌드/패키지 모두 커버. 패키징 시 asarUnpack 으로
 * app.asar.unpacked 에 풀린다(electron-builder.yml). 각 서비스는 join(__dirname,'*.ps1') 로
 * 참조한다(shellVerbs §Y1·shellNew §Y2 — HashManager workerPath 선례).
 */
function copyShellWorkers(): { name: string; closeBundle(): void } {
  const workers = ['shellVerbsWorker.ps1', 'shellNewWorker.ps1']
  return {
    name: 'copy-shell-ps1',
    closeBundle(): void {
      const outDir = resolve('out/main')
      mkdirSync(outDir, { recursive: true })
      for (const w of workers) {
        copyFileSync(resolve(`src/main/os/${w}`), resolve(`out/main/${w}`))
      }
    }
  }
}

// main/preload/renderer 3-엔트리 빌드 설정 (ADR-001, directory-structure §3)
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), copyShellWorkers()],
    build: {
      // P7: 별도 sourcemap(.map) 생성 — 디버깅용. NSIS 패키지에는 미포함
      // (electron-builder.yml files 의 `!out/**/*.map` 제외 규칙으로 배포 제외).
      sourcemap: true,
      // 멀티 엔트리: main 진입점 + Worker Thread 엔트리(P4, SPK-Worker).
      // Worker 는 별도 청크(out/main/fileOpWorker.js)로 산출되어 new Worker(...) 로 로드된다.
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          fileOpWorker: resolve('src/main/workers/fileOpWorker.ts'),
          // I장: Top10 디스크 사용량 스캔 Worker(별도 청크 out/main/scanWorker.js).
          scanWorker: resolve('src/main/workers/scanWorker.ts'),
          // M7 W1: 공용 해시·비교 Worker(별도 청크 out/main/hashWorker.js).
          hashWorker: resolve('src/main/workers/hashWorker.ts'),
          // M8 S1: 내용 검색 grep Worker(별도 청크 out/main/grepWorker.js — ADR-010).
          grepWorker: resolve('src/main/workers/grepWorker.ts'),
          // M9 Q1: 압축 추출/추가 Worker(별도 청크 out/main/archiveWorker.js — ADR-008).
          archiveWorker: resolve('src/main/workers/archiveWorker.ts')
        },
        output: {
          entryFileNames: '[name].js'
        }
      }
    },
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      sourcemap: true, // P7: 별도 .map 생성(배포 제외)
      // sandbox:true 렌더러의 preload 는 CommonJS 여야 한다 → .cjs 강제 (ADR-005)
      rollupOptions: {
        input: resolve('src/preload/index.ts'),
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    },
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  renderer: {
    root: resolve('src/renderer'),
    plugins: [react()],
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer'),
        '@shared': resolve('src/shared')
      }
    },
    build: {
      // P7: 렌더러는 hidden sourcemap(번들에 //# 참조 미삽입, .map 만 별도 생성)
      // → 사용자에게 노출 안 되나 디버깅용 맵은 out/ 에 존재. NSIS 패키지엔 미포함.
      sourcemap: 'hidden',
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html')
        }
      }
    }
  }
})
