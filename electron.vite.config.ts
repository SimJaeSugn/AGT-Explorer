import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// main/preload/renderer 3-엔트리 빌드 설정 (ADR-001, directory-structure §3)
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      // 멀티 엔트리: main 진입점 + Worker Thread 엔트리(P4, SPK-Worker).
      // Worker 는 별도 청크(out/main/fileOpWorker.js)로 산출되어 new Worker(...) 로 로드된다.
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          fileOpWorker: resolve('src/main/workers/fileOpWorker.ts'),
          // I장: Top10 디스크 사용량 스캔 Worker(별도 청크 out/main/scanWorker.js).
          scanWorker: resolve('src/main/workers/scanWorker.ts')
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
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html')
        }
      }
    }
  }
})
