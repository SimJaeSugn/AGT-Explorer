import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '@renderer/ui/App'
import { applyTheme } from '@renderer/ui/theme/applyTheme'

// 첫 페인트 전 시스템 테마로 CSS 변수를 주입(FOUC 방지). 저장된 설정은
// 부팅 시 loadSettings 가 다시 적용한다.
applyTheme('system')

const container = document.getElementById('root')
if (!container) {
  throw new Error('#root 엘리먼트를 찾을 수 없습니다.')
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
)
