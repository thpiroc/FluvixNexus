import { clipboard } from 'electron'
import { IPC_CHANNELS, type CopyDiagnosticsReportResponse } from '@shared/ipc'
import {
  clearDiagnosticsErrors,
  getDiagnosticsReport,
  getDiagnosticsReportText,
  recordRendererError
} from '../../diagnostics'
import { handleIpc } from '../registry'

/**
 * diagnostics ドメインのハンドラ（shared/ipc/contracts/diagnostics.ts）。
 *
 * 中身は main/diagnostics/ が持ち、ここは繋ぐだけ。コピーは Main が作り直した
 * 文字列を書く ── Renderer から渡された文字列をクリップボードへ書く口にはしない。
 */
export function registerDiagnosticsHandlers(): void {
  handleIpc(IPC_CHANNELS.DIAGNOSTICS_GET_REPORT, () => getDiagnosticsReport())

  handleIpc(IPC_CHANNELS.DIAGNOSTICS_COPY_REPORT, (): CopyDiagnosticsReportResponse => {
    const text = getDiagnosticsReportText()

    clipboard.writeText(text)

    return { characters: text.length }
  })

  handleIpc(IPC_CHANNELS.DIAGNOSTICS_CLEAR_ERRORS, () => {
    clearDiagnosticsErrors()
  })

  handleIpc(IPC_CHANNELS.DIAGNOSTICS_REPORT_RENDERER_ERROR, (request) => {
    // 形の合わない報告は黙って捨てる（失敗を返すと、Renderer 側でまた報告の種になる）。
    recordRendererError(request)
  })
}
