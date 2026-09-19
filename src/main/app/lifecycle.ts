import { app } from 'electron'
import { startWorkspaceWatching, stopWorkspaceWatching } from '../files/workspaceWatcher'
import { startGitWatching, stopGitWatching } from '../git/gitWatcher'
import { registerIpcHandlers } from '../ipc'
import { startDebugBreakpointHosting } from '../debug/breakpoints'
import { startDebugCallStackHosting } from '../debug/callStack'
import { startDebugConsoleHosting } from '../debug/console'
import { disposeDebugSession, startDebugSessionHosting } from '../debug/debugSessionManager'
import { startDebugSessionStatusReporting } from '../debug/sessionStatus'
import { startDebugVariablesHosting } from '../debug/variables'
import { startLanguageServerDiagnostics } from '../lsp/diagnostics'
import { startLanguageServerDocumentSync } from '../lsp/documentSync'
import { startLanguageServerSettings } from '../lsp/languageServerSettings'
import { startLanguageServerHosting, stopLanguageServers } from '../lsp/languageServers'
import { startLanguageServerStatusReporting } from '../lsp/serverStatus'
import { createLogger } from '../logger'
import { stopMcpConnections } from '../mcp/mcpService'
import { isMacOS } from '../platform'
import { applySessionSecurityPolicy, applyWebContentsSecurityPolicy } from '../security'
import { flushDebugBreakpointsDocument } from '../store/debugBreakpoints'
import { flushDebugProfilesDocument } from '../store/debugProfiles'
import { flushSettingsDocument, startSettingsScopeTracking } from '../store/settings'
import { flushWorkspaceFolderDocument } from '../store/workspaceFolder'
import { flushWorkspaceLayoutDocument } from '../store/workspaceLayout'
import { stopTerminalSessions } from '../terminal/terminalSessions'
import { createMainWindow, focusMainWindow, getMainWindow } from '../windows/mainWindow'
import { onWorkspaceFolderChange } from '../workspaceFolder/currentWorkspaceFolder'
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
      ワークスペース設定の切り替えへの追従（feature/settings-scope）。Language Server の
      設定より先に張る ── 受け手がそこで Workspace ごとの値へ切り替われるように。
    */
    startSettingsScopeTracking()

    /*
      Language Server を使うかどうか（Session 5-4）。**文書同期より先に読む** ──
      Renderer が最初の文書を開くより前に、立ててよい言語が決まっている必要がある
      （main/lsp/languageServerSettings.ts）。

      設定を Main が読み返すのはこれが初めてで、`lsp` section だけが持つ性格に
      なる ── 他の設定はどれも Renderer の中で効くが、これはプロセスを
      立てる / 終わらせる Main の側で効く。
    */
    startLanguageServerSettings()

    /*
      開いている文書とサーバをつなぐ側（Session 5-2）。**サーバを立てるのはこちら**で、
      きっかけは常に「この拡張子のファイルが開かれた」になる
      ── Renderer からサーバを名指しできる口は無い（main/lsp/documentSync.ts）。
      ここで張るのは、サーバの状態と Workspace の切り替えへの購読2つ。
    */
    startLanguageServerDocumentSync()

    /*
      サーバが出した指摘を Renderer へ届ける側（Session 5-3）。
      **文書同期の後に張る** ── サーバが落ちたことは両方が受け取るが、
      「もう伝えていない」へ控えを戻す（documentSync）のが先で、
      「その指摘はもう有効でない」と配る（diagnostics）のが後になる。
    */
    startLanguageServerDiagnostics()

    /*
      サーバの状態を画面へ配る側（Session 5-4）。**新しい状態は持たない** ──
      プロセスの状態（languageServers.ts）と設定（languageServerSettings.ts）を
      重ねて配るだけで、そのどちらの購読よりも後に張る必要は無いが、
      **設定より後**である必要はある（重ねる相手が要る）。
    */
    startLanguageServerStatusReporting()

    /*
      Debug Session は Main が1本だけ持つ（Session 6-2）。Workspace が変わると
      adapter / handles / pending requests は前の Workspace に属するため、LSP と同じく
      切り替えの時点で必ず片付ける。
    */
    startDebugSessionHosting(onWorkspaceFolderChange)

    /*
      Breakpoint も Workspace ごとのもの（Session 6-3）。**Debug Session より後に
      張る**のが要点で、こちらは切り替えのときに「控えを捨てて保存内容から
      読み直す」を行う ── 先に張ると、前の Workspace の印を新しい Workspace の
      adapter へ送りうる順序になる。

      ここは Debug Session の仕込み（initialized → configurationDone の間に
      setBreakpoints を送る）を登録する唯一の場所でもある。
    */
    startDebugBreakpointHosting(onWorkspaceFolderChange)

    /*
      Call Stack は Main-owned の stopped snapshot（Session 6-5）。`source.path` を
      Workspace-relative へ落とし、外側の frame は開けない表示だけにして Renderer へ送る。
    */
    startDebugCallStackHosting(onWorkspaceFolderChange)

    /*
      Variables / Scopes（Session 6-6）。DAP の `variablesReference` は Main の表に控え、
      Renderer へは Main が発行した handle だけを渡す。**Call Stack より後に張る** ──
      snapshot の差し替えを合図に表を捨てるため、購読する相手が先に立っている必要がある。
    */
    startDebugVariablesHosting(onWorkspaceFolderChange)

    /*
      Debug Console（Session 6-8）。DAP output event を Main で safe entry に畳み、
      Renderer へは Debug Console 専用の通知として届ける。
    */
    startDebugConsoleHosting(onWorkspaceFolderChange)

    /*
      Debug の状態を画面へ配る側（Session 6-9）。startLanguageServerStatusReporting と
      同じく**新しい状態は持たない** ── セッションの状態と catalog の事実を重ねて配るだけ。
      Workspace の切り替えは購読しない（切り替えでセッションが終わり、それが状態の変化として届く）。
    */
    startDebugSessionStatusReporting()

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

    /*
      Debug Adapter も Main の長命な子プロセスなので、アプリ終了時に確実に閉じる。
      Renderer へ adapter executable / args / cwd を露出する口はまだ無い。
    */
    disposeDebugSession('the application is quitting.')

    /*
      MCP サーバー（接続テストの途中など）も Main の子プロセスなので終わらせる
      （main/mcp/mcpService.ts）。
    */
    stopMcpConnections()

    flushWorkspaceLayoutDocument()
    flushWorkspaceFolderDocument()
    flushSettingsDocument()
    // 印を付けた直後に終了しても、次回起動で戻ってくるようにする（Session 6-3）。
    flushDebugBreakpointsDocument()
    // Debug Profile を作った直後に終了しても残るようにする（Session 6-10）。
    flushDebugProfilesDocument()
  })

  app.on('window-all-closed', () => {
    // macOS ではウィンドウを閉じてもアプリを終了しないのが慣例。
    // v1 の対象は Windows だが、OS 依存の分岐は platform 層経由で表現しておく。
    if (!isMacOS) {
      app.quit()
    }
  })
}
