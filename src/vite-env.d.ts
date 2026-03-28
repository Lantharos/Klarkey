/// <reference types="vite/client" />

import type { KlarkeyApi } from '@/shared/ipc'

declare global {
  interface Window {
    klarkey?: KlarkeyApi
  }
}

export {}
