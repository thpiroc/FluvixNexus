/**
 * アプリ更新の状態。
 *
 * Main が electron-updater から受け取った出来事を、Renderer へ渡してよい
 * 素の値だけに畳んだもの。更新処理の正本は Main にあり、Renderer はこの
 * snapshot を表示して、明示的な操作を依頼するだけに留める。
 */

export type UpdateStatusKind =
  | 'idle'
  | 'checking'
  | 'not-available'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | 'unsupported'

export interface UpdateDownloadProgress {
  readonly percent: number
  readonly transferred: number
  readonly total: number
  readonly bytesPerSecond: number
}

export interface UpdateStatusSnapshot {
  readonly status: UpdateStatusKind
  readonly currentVersion: string
  readonly updateVersion: string | null
  readonly releaseName: string | null
  readonly releaseDate: string | null
  readonly message: string | null
  readonly lastCheckedAt: number | null
  readonly progress: UpdateDownloadProgress | null
  readonly source: {
    readonly provider: 'github'
    readonly owner: 'thpiroc'
    readonly repo: 'FluvixNexus'
  }
}
