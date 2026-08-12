import { IPC_CHANNELS, type LoadWorkspaceLayoutResponse } from '@shared/ipc'
import {
  readWorkspaceLayoutDocument,
  saveWorkspaceLayoutDocument
} from '../../store/workspaceLayout'
import { parseWorkspaceLayoutDocument } from '../../store/workspaceLayoutDocument'
import { invalidRequest } from '../errors'
import { handleIpc } from '../registry'

/**
 * workspace ドメインのハンドラ。
 *
 * 公開するのは Workspace レイアウトの読み書きだけで、パスもファイル名も
 * Renderer からは指定できない（保存先は store/workspaceLayout.ts が決める）。
 * 「Renderer は OS に触れない」という前提を保つため、この API を
 * 汎用のファイル読み書きへ広げないこと。
 *
 * 読み込みは Renderer 側の復元処理（persistence/restoreLayout.ts）と対になっている。
 * ここでは中身を解釈せず、文書として妥当かどうかだけを見る。
 */
export function registerWorkspaceHandlers(): void {
  handleIpc(IPC_CHANNELS.WORKSPACE_LOAD_LAYOUT, (): LoadWorkspaceLayoutResponse => {
    // 破損・想定外の内容は store 側で null に落ちる（＝Renderer は Default Layout で起動する）。
    return { document: readWorkspaceLayoutDocument() }
  })

  handleIpc(IPC_CHANNELS.WORKSPACE_SAVE_LAYOUT, (request): void => {
    // Renderer から届いた値も境界の外から来たものとして検証する。
    // 検証を通した結果を書くことで、契約に無いキーや桁違いの内容がディスクに残らない。
    const document = parseWorkspaceLayoutDocument(request?.document)

    if (document === null) {
      throw invalidRequest('workspace layout document is malformed or too large.')
    }

    saveWorkspaceLayoutDocument(document)
  })
}
