import { IPC_CHANNELS, type UpdateStatusChangedEvent } from '@shared/ipc'
import { handleIpc } from '../registry'
import {
  checkForUpdates,
  downloadUpdate,
  getUpdateStatus,
  installDownloadedUpdate
} from '../../updates/updateService'

export function registerUpdatesHandlers(): void {
  handleIpc(IPC_CHANNELS.UPDATES_GET_STATUS, (): UpdateStatusChangedEvent => {
    return getUpdateStatus()
  })

  handleIpc(IPC_CHANNELS.UPDATES_CHECK, () => {
    return checkForUpdates()
  })

  handleIpc(IPC_CHANNELS.UPDATES_DOWNLOAD, () => {
    return downloadUpdate()
  })

  handleIpc(IPC_CHANNELS.UPDATES_INSTALL, (): void => {
    installDownloadedUpdate()
  })
}
