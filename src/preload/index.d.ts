import type { ExplorerApi } from './api'

declare global {
  interface Window {
    api: ExplorerApi
  }
}

export {}
