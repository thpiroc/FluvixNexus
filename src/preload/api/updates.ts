import type { UpdatesApi } from '@shared/api'
import { IPC_CHANNELS, IPC_EVENT_CHANNELS } from '@shared/ipc'
import { invokeIpc } from '../ipc/invoke'
import { subscribeIpcEvent } from '../ipc/subscribe'

export const updatesApi: UpdatesApi = {
  getStatus: () => invokeIpc(IPC_CHANNELS.UPDATES_GET_STATUS),
  check: () => invokeIpc(IPC_CHANNELS.UPDATES_CHECK),
  download: () => invokeIpc(IPC_CHANNELS.UPDATES_DOWNLOAD),
  install: () => invokeIpc(IPC_CHANNELS.UPDATES_INSTALL),
  onStatusChanged: (listener) =>
    subscribeIpcEvent(IPC_EVENT_CHANNELS.UPDATES_STATUS_CHANGED, listener)
}
