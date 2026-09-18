import type { DiagnosticsApi } from '@shared/api'
import { IPC_CHANNELS } from '@shared/ipc'
import { invokeIpc } from '../ipc/invoke'

/** diagnostics ドメインの Preload API（IPC を包むだけ）。 */
export const diagnosticsApi: DiagnosticsApi = {
  getReport: () => invokeIpc(IPC_CHANNELS.DIAGNOSTICS_GET_REPORT),
  copyReport: () => invokeIpc(IPC_CHANNELS.DIAGNOSTICS_COPY_REPORT),
  clearErrors: () => invokeIpc(IPC_CHANNELS.DIAGNOSTICS_CLEAR_ERRORS),
  reportRendererError: (request) =>
    invokeIpc(IPC_CHANNELS.DIAGNOSTICS_REPORT_RENDERER_ERROR, request)
}
