// 계층/프로세스 import 경계 규칙 (directory-structure §5, software-architecture §3.1)
// 의존 방향 규칙을 빌드 타임에 검증해 아키텍처 침식을 막는다.
module.exports = {
  root: true,
  env: { node: true, browser: true, es2022: true },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true }
  },
  plugins: ['@typescript-eslint', 'import'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:import/recommended',
    'plugin:import/typescript'
  ],
  settings: {
    'import/resolver': {
      typescript: { project: ['./tsconfig.node.json', './tsconfig.web.json'] }
    }
  },
  ignorePatterns: ['out/**', 'dist/**', 'node_modules/**', '**/*.cjs'],
  rules: {
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/explicit-function-return-type': 'off'
  },
  overrides: [
    // ── Renderer: node:* / electron / fs / child_process 금지 → window.api(infra/api)만 ──
    {
      files: ['src/renderer/**/*.{ts,tsx}'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: [
              { name: 'electron', message: 'renderer 는 electron 직접 import 금지 — infra/api(window.api) 경유.' },
              { name: 'fs', message: 'renderer 는 fs import 금지 — Main 전용. infra/api 경유.' },
              { name: 'child_process', message: 'renderer 는 child_process import 금지.' }
            ],
            patterns: [
              { group: ['node:*'], message: 'renderer 는 node:* import 금지 — DOM 환경 전용. infra/api 경유.' }
            ]
          }
        ]
      }
    },
    // ── domain: react/zustand/infra/shared-ipc 금지 (순수 TS, DTO 타입만) ──
    {
      files: ['src/renderer/domain/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: [
              { name: 'react', message: 'domain 은 순수 TS — react import 금지.' },
              { name: 'react-dom', message: 'domain 은 순수 TS — react-dom import 금지.' },
              { name: 'zustand', message: 'domain 은 zustand import 금지.' }
            ],
            patterns: [
              { group: ['**/infra/**'], message: 'domain 은 infra import 금지.' },
              { group: ['**/shared/ipc/**', '@shared/ipc/*'], message: 'domain 은 shared/ipc import 금지 — DTO 타입만 허용.' },
              { group: ['**/ui/**', '**/app/**'], message: 'domain 은 ui/app import 금지(역방향 의존).' }
            ]
          }
        ]
      }
    },
    // ── ui: infra 직접 import 금지 → app(스토어·유스케이스) 경유 ──
    {
      files: ['src/renderer/ui/**/*.{ts,tsx}'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              { group: ['**/infra/**', '@renderer/infra/*'], message: 'ui 는 infra 직접 import 금지 — app(스토어/유스케이스) 경유.' }
            ]
          }
        ]
      }
    },
    // ── main/preload: renderer import 금지 + 네트워크 송신 모듈 정적 금지 ──
    // 텔레메트리/외부 전송 전무(D5·ADR-005 §3.3-6)를 정적으로 강제한다.
    // 향후 누구도 http(s)/소켓 송신 모듈을 import 할 수 없다(회귀 가드).
    {
      files: ['src/main/**/*.ts', 'src/preload/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: [
              { name: 'node:http', message: '텔레메트리/네트워크 전송 금지(D5·ADR-005 §3.3-6) — 외부 송신 코드 도입 차단.' },
              { name: 'http', message: '동일 — 네트워크 송신 금지.' },
              { name: 'node:https', message: '동일 — 네트워크 송신 금지.' },
              { name: 'https', message: '동일 — 네트워크 송신 금지.' },
              { name: 'net', message: '동일 — TCP 소켓 금지.' },
              { name: 'node:net', message: '동일 — TCP 소켓 금지.' },
              { name: 'dgram', message: '동일 — UDP 소켓 금지.' },
              { name: 'node:dgram', message: '동일 — UDP 소켓 금지.' }
            ],
            patterns: [
              { group: ['**/renderer/**', '@renderer/*'], message: 'main/preload 는 renderer import 금지.' }
            ]
          }
        ]
      }
    }
  ]
}
