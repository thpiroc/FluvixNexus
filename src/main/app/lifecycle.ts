import { app } from 'electron'
import { registerIpcHandlers } from '../ipc'
import { createLogger } from '../logger'
import { isMacOS } from '../platform'
import { applySessionSecurityPolicy, applyWebContentsSecurityPolicy } from '../security'
import { flushWorkspaceLayoutDocument } from '../store/workspaceLayout'
import { createMainWindow, focusMainWindow, getMainWindow } from '../windows/mainWindow'
import { applyApplicationMenu } from './menu'

/**
 * アプリのライフサイクル管理の責務を持つモジュール。
 *
 * 「いつウィンドウを開くか / いつアプリを終了するか」と、その前提となる
 * プロセス単位の設定（多重起動の抑止・セキュリティポリシー・メニュー）だけを扱う。
 * ウィンドウの生成条件そのものは windows/mainWindow.ts に委ねる。
 */

const log = createLogger('lifecycle')

export function bootstrapApp(): void {
  // 多重起動を禁止する。
  // ウィンドウ状態やレイアウトの保存ファイルを複数プロセスが同時に書くと内容が壊れるうえ、
  // 今後 Terminal / LSP / DAP が同じワークスペースに対してプロセスを立てるため、
  // インスタンスは常に1つだけという前提を先に固定しておく。
  if (!app.requestSingleInstanceLock()) {
    log.info('another instance is already running; exiting this one.')
    app.quit()
    return
  }

  // 2つ目の起動が試みられたら、既に開いているウィンドウを前面に出す。
  app.on('second-instance', () => {
    focusMainWindow()
  })

  // webContents 生成時のガードは、最初のウィンドウが作られる前に登録しておく必要がある。
  applyWebContentsSecurityPolicy()

  void app.whenReady().then(() => {
    // session を触れるのは ready 以降。
    applySessionSecurityPolicy()
    applyApplicationMenu()

    // Renderer が接続してくる前に、Main 側の受け口を先に用意しておく。
    registerIpcHandlers()

    createMainWindow()

    app.on('activate', () => {
      if (getMainWindow() === null) {
        createMainWindow()
      }
    })
  })

  // 間引き待ちのレイアウトを取りこぼさないための保険。
  // ウィンドウが閉じた後に発生する will-quit で行うのは、閉じる直前に Renderer が
  // 送った保存依頼まで受け取ってから書き込むため（before-quit ではまだ届いていない）。
  app.on('will-quit', () => {
    flushWorkspaceLayoutDocument()
  })

  app.on('window-all-closed', () => {
    // macOS ではウィンドウを閉じてもアプリを終了しないのが慣例。
    // v1 の対象は Windows だが、OS 依存の分岐は platform 層経由で表現しておく。
    if (!isMacOS) {
      app.quit()
    }
  })
}
