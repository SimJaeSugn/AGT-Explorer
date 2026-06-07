/// <reference types="vite/client" />
import type { ExplorerApi } from '../preload/api'

declare global {
  interface Window {
    api: ExplorerApi
  }
}

export {}
