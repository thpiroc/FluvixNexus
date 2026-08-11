import type { EnvApi, PlatformId } from '@shared/api'

/**
 * 実行環境の情報。
 * Preload の時点で同期的に確定するため IPC を経由しない、数少ない例外にあたる。
 */
export const envApi: EnvApi = {
  platform: process.platform as PlatformId,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  }
}
