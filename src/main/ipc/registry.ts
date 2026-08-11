import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import {
  ipcFailure,
  ipcSuccess,
  type IpcChannel,
  type IpcRequest,
  type IpcResponse,
  type IpcResult
} from '@shared/ipc'
import { createLogger } from '../logger'
import { toIpcErrorPayload } from './errors'

/**
 * ipcMain.handle の登録基盤。
 *
 * Main 側で IPC を受け付ける口はこの handleIpc に一本化する。
 * ipcMain.handle を各所で直接呼ぶと、以下がハンドラごとにバラバラになってしまうため。
 *  - 型の一致（チャンネルとリクエスト / レスポンスの対応）
 *  - 例外が Renderer へ漏れないこと
 *  - 送信元の検証
 *  - 失敗時のログ
 *
 * これらを基盤側で一度だけ担保し、各ドメインのハンドラは処理内容だけに集中させる。
 */

/** ハンドラへ渡す呼び出し文脈。将来ウィンドウ単位の処理（ダイアログ表示など）で使う。 */
export interface IpcContext {
  /** 呼び出し元のウィンドウ。送信元検証を通っているため必ず存在する。 */
  readonly window: BrowserWindow
}

/**
 * ドメインごとのハンドラ実装。
 * 成功時は素の値を return し、想定内の失敗は IpcError を throw する（errors.ts 参照）。
 */
export type IpcHandler<C extends IpcChannel> = (
  request: IpcRequest<C>,
  context: IpcContext
) => IpcResponse<C> | Promise<IpcResponse<C>>

const log = createLogger('ipc')

/** 二重登録の検出用。electron-vite の dev では Main が丸ごと再起動するため、実質は実装ミスの検出。 */
const registeredChannels = new Set<IpcChannel>()

/**
 * 送信元の検証。
 *
 * アプリ自身のウィンドウ以外（将来の webview など想定外の webContents）からの
 * 呼び出しを Main の機能に到達させない。契約に載っていないチャンネルは
 * そもそもハンドラが無いので、ここではウィンドウの正当性だけを見る。
 */
function resolveSenderWindow(event: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender)
}

export function handleIpc<C extends IpcChannel>(channel: C, handler: IpcHandler<C>): void {
  if (registeredChannels.has(channel)) {
    throw new Error(`IPC channel "${channel}" is already registered.`)
  }
  registeredChannels.add(channel)

  ipcMain.handle(channel, async (event, rawRequest): Promise<IpcResult<IpcResponse<C>>> => {
    const window = resolveSenderWindow(event)

    if (window === null) {
      log.error(`rejected "${channel}": sender is not an application window.`)
      return ipcFailure({
        code: 'PERMISSION_DENIED',
        message: 'IPC calls are only accepted from application windows.'
      })
    }

    try {
      const data = await handler(rawRequest as IpcRequest<C>, { window })
      return ipcSuccess(data)
    } catch (cause) {
      const error = toIpcErrorPayload(cause)
      // 失敗の詳細は Main のログに残す。Renderer には正規化した payload だけを返す。
      log.error(`"${channel}" failed: ${error.code} ${error.message}`, cause)
      return ipcFailure(error)
    }
  })
}

/** テスト・再初期化用。登録済みハンドラをすべて解除する。 */
export function resetIpcHandlers(): void {
  for (const channel of registeredChannels) {
    ipcMain.removeHandler(channel)
  }
  registeredChannels.clear()
}
