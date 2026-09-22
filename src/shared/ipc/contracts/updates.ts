import type { UpdateStatusSnapshot } from '../../updates'

export type GetUpdateStatusResponse = UpdateStatusSnapshot
export type CheckForUpdatesResponse = UpdateStatusSnapshot
export type DownloadUpdateResponse = UpdateStatusSnapshot
export type InstallUpdateResponse = void

export interface UpdatesIpcContract {
  'updates:get-status': {
    request: void
    response: GetUpdateStatusResponse
  }
  'updates:check': {
    request: void
    response: CheckForUpdatesResponse
  }
  'updates:download': {
    request: void
    response: DownloadUpdateResponse
  }
  'updates:install': {
    request: void
    response: InstallUpdateResponse
  }
}
