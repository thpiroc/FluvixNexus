import { BrowserWindow } from 'electron'
import type { IpcEventChannel, IpcEventPayload } from '@shared/ipc'
import { createLogger } from '../logger'

/**
 * Main → Renderer へイベントを送る唯一の経路。
 *
 * registry.ts が要求と応答（ipcMain.handle）に対して果たしている役どころの、
 * イベント側の相手。`webContents.send` を各所で直接呼ぶと、以下がバラバラになる。
 *   - チャンネル名と payload の型の対応
 *   - 誰に送るか（ウィンドウが増えたときの送り漏れ）
 *   - 閉じかけのウィンドウへ送ったときの扱い
 *
 * ## 誰に送るか
 *
 * アプリのウィンドウすべてに送る。イベントは「Workspace で起きた出来事」であって
 * 特定のウィンドウ宛ての返事ではないため、受け取る側が増えても送る側は変わらない形にする
 * （GitHub パネルを独立ウィンドウ化した時点で、そのウィンドウにも同じ通知が要る）。
 *
 * windows/mainWindow.ts が「もう開いているか」の判定に getAllWindows() を使わない
 * のとは別の話。あちらは**どれがメインウィンドウか**という同一性の問題で、
 * ここは**アプリのウィンドウ全部**という集合の問題になる。
 * アプリ以外の webContents（webview / 新規ウィンドウ）は security/ が作らせないため、
 * この集合に混ざることは無い。
 *
 * ## 届かなくても失敗にしない
 *
 * ウィンドウがまだ無い（起動直後）・もう閉じている場合は、送らずに黙って戻る。
 * イベントは受け手が居ることを前提にしない片道の通知で、
 * 送れなかったことが Main 側の処理を止める理由にならない。
 */

const log = createLogger('ipc-event')

export function emitIpcEvent<C extends IpcEventChannel>(
  channel: C,
  payload: IpcEventPayload<C>
): void {
  const windows = BrowserWindow.getAllWindows()

  if (windows.length === 0) {
    return
  }

  for (const window of windows) {
    if (window.isDestroyed() || window.webContents.isDestroyed()) {
      continue
    }

    try {
      window.webContents.send(channel, payload)
    } catch (cause) {
      // 送信の途中でウィンドウが閉じた場合など。他のウィンドウへの送信は続ける。
      log.warn(`failed to deliver "${channel}" to a window.`, cause)
    }
  }
}
