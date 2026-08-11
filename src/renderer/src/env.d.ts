/// <reference types="vite/client" />

import type { FluvixApi } from '@shared/api'

declare global {
  interface Window {
    /** Preload が contextBridge 経由で公開する API。実体は src/preload/api.ts。 */
    readonly fluvix: FluvixApi
  }
}

export {}
