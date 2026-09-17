import { IPC_CHANNELS, type LoadKeybindingsResponse } from '@shared/ipc'
import { readKeybindings, saveKeybindings } from '../../store/keybindings'
import { parseSaveKeybindingsRequest } from '../../store/keybindingsDocument'
import { invalidRequest } from '../errors'
import { handleIpc } from '../registry'

/**
 * keybindings ドメインのハンドラ（Shortcuts S3）。
 *
 * settings ドメインと同じく、持つのは2つだけ。
 *   - 保存先を Main 側で決める（Renderer からはパスもファイル名も指定できない）
 *   - 届いた要求が**後で読める形か**を確かめてから書く
 *
 * 見るのは形だけで、command 名や打鍵の意味は見ない（store/keybindingsDocument.ts）。
 *
 * ## 読めなくても失敗にしない
 *
 * ファイルが無い / 壊れている場合も成功として返し、`status` で区別させる。
 * 割り当てが読めないことはアプリを使えない理由にならず、Renderer は既定の割り当てで動く。
 */
export function registerKeybindingsHandlers(): void {
  handleIpc(IPC_CHANNELS.KEYBINDINGS_LOAD, (): LoadKeybindingsResponse => {
    return readKeybindings()
  })

  handleIpc(IPC_CHANNELS.KEYBINDINGS_SAVE, (request): void => {
    const parsed = parseSaveKeybindingsRequest(request)

    if (parsed === null) {
      throw invalidRequest('the keybindings are not in a storable shape.')
    }

    saveKeybindings(parsed.entries)
  })
}
