import { app } from 'electron'
import { startWorkspaceWatching, stopWorkspaceWatching } from '../files/workspaceWatcher'
import { startGitWatching, stopGitWatching } from '../git/gitWatcher'
import { registerIpcHandlers } from '../ipc'
import { startLanguageServerDocumentSync } from '../lsp/documentSync'
import { startLanguageServerHosting, stopLanguageServers } from '../lsp/languageServers'
import { createLogger } from '../logger'
import { isMacOS } from '../platform'
import { applySessionSecurityPolicy, applyWebContentsSecurityPolicy } from '../security'
import { flushSettingsDocument } from '../store/settings'
import { flushWorkspaceFolderDocument } from '../store/workspaceFolder'
import { flushWorkspaceLayoutDocument } from '../store/workspaceLayout'
import { stopTerminalSessions } from '../terminal/terminalSessions'
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

    // 開いている Workspace の外部変更を見張る（開く / 閉じるに追従する）。
    startWorkspaceWatching()

    /*
      同じ Workspace の `.git` を、別の watcher で見張る（Session 3-8-8）。
      作業ツリーの監視は `.git` を除外することで成り立っているため
      （main/files/ignoredDirectories.ts）、そこへ穴を開けずに1本足してある。
    */
    startGitWatching()

    /*
      Language Server は Workspace の切り替えで**終わらせる**（Session 5-1）。
      シェルと逆なのは、見ている対象が Workspace そのもの（`rootUri` は起動時に
      決まり動かせない）で、残すと前のフォルダを見ているサーバが新しいフォルダの
      答えを返すため（main/lsp/languageServers.ts）。
    */
    startLanguageServerHosting()

    /*
      開いている文書とサーバをつなぐ側（Session 5-2）。**サーバを立てるのはこちら**で、
      きっかけは常に「この拡張子のファイルが開かれた」になる
      ── Renderer からサーバを名指しできる口は無い（main/lsp/documentSync.ts）。
      ここで張るのは、サーバの状態と Workspace の切り替えへの購読2つ。
    */
    startLanguageServerDocumentSync()

    /*
      シェルのセッションは Workspace の切り替えに追従しない（Session 3-7-3）。
      作業ディレクトリは起動時に決まり、動いているプロセスを切り替えで
      終わらせることはしないため、起動時に用意するものが無い
      （main/terminal/terminalSessions.ts）。片付けは will-quit で行う。
    */

    createMainWindow()

    app.on('activate', () => {
      if (getMainWindow() === null) {
        createMainWindow()
      }
    })
  })

  // 間引き待ちの保存内容を取りこぼさないための保険。
  // ウィンドウが閉じた後に発生する will-quit で行うのは、閉じる直前に Renderer が
  // 送った保存依頼まで受け取ってから書き込むため（before-quit ではまだ届いていない）。
  app.on('will-quit', () => {
    // 監視のハンドルを閉じてから落とす（この時点でウィンドウはもう無い）。
    stopWorkspaceWatching()
    stopGitWatching()

    /*
      動いているシェルを終わらせる。ウィンドウが閉じても消えるのは Renderer だけで、
      プロセスは Main の持ち物のまま残る ── 片付けないと、ターミナルで立てた
      dev server がアプリの終了後もポートを掴み続ける。
    */
    stopTerminalSessions()

    /*
      Language Server も同じ理由で片付ける。残すと解析中のサーバが CPU を
      使い続けるうえ、次にアプリを開いたときに**同じ Workspace を見ているサーバが
      2本**になる（main/lsp/languageServers.ts）。
    */
    stopLanguageServers('the application is quitting.')

    flushWorkspaceLayoutDocument()
    flushWorkspaceFolderDocument()
    flushSettingsDocument()
  })

  app.on('window-all-closed', () => {
    // macOS ではウィンドウを閉じてもアプリを終了しないのが慣例。
    // v1 の対象は Windows だが、OS 依存の分岐は platform 層経由で表現しておく。
    if (!isMacOS) {
      app.quit()
    }
  })
}
