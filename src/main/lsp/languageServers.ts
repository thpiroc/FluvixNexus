import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { existsSync } from 'fs'
import { app } from 'electron'
import { createLogger } from '../logger'
import { currentPlatform } from '../platform'
import {
  getCurrentWorkspaceFolder,
  onWorkspaceFolderChange
} from '../workspaceFolder/currentWorkspaceFolder'
import { toWorkspaceRootUri } from './documentUri'
import { createInitializeParams } from './initializeParams'
import { createJsonRpcConnection, type JsonRpcConnection } from './jsonRpcConnection'
import {
  resolveLanguageServerCommand,
  type LanguageServerCommand,
  type LanguageServerId
} from './languageServerCatalog'
import { createLanguageServerEnvironment } from './languageServerEnvironment'
import { decideLanguageServerRestart } from './restartPolicy'

/**
 * 動いている Language Server を持つ層（Session 5-1）。
 *
 * **`child_process` に触れてよいのはこのファイルだけ。** 表（何を起動するか）は
 * languageServerCatalog.ts、電文の組み立てと読み取りは jsonRpcMessage.ts、
 * 要求と返事の結び付けは jsonRpcConnection.ts、立て直しの判断は restartPolicy.ts に
 * 分けてあり、ここが持つのは**プロセスと、それらの繋ぎ方**だけになる
 * （main/terminal/terminalSessions.ts と同じ分担）。
 *
 * ## Main が持つ、2つめの長命な子プロセス
 *
 * Terminal（Session 3-7-1）が「Main が長命な子プロセスを持つ最初の機能」だった。
 * Language Server はその形をそのまま踏襲するが、違うところが3つある。
 *
 * ```
 *                  Terminal                    Language Server
 * 起動のきっかけ … 利用者がタブを開く          コードを開くと勝手に立つ（5-2 以降）
 * 落ちたとき     … 終わったことを画面に出す    黙って立て直す
 * 中身           … ただのテキスト              JSON-RPC（順序と対応に意味がある）
 * ```
 *
 * 1つめが、この層の設計に一番効いている。利用者が頼んでいないのに起動するため、
 * **何が起動されるかを利用者が指定していない**という前提が Terminal より強く働く
 * ── だから表と PATH の辿り方（languageServerCatalog.ts）が要点になる。
 *
 * ## Renderer は、この層に触れない
 *
 * Session 5-2 で LSP の IPC チャンネルが4つ増えたが、**サーバを名指しできる口は
 * 依然として無い**。起動・停止・立て直しはすべて Main の中で完結し、
 * 起動のきっかけになるのは「開いた文書の言語」であって、サーバそのものではない
 * （main/lsp/documentSync.ts が startLanguageServer を呼ぶ。DESIGN.md の STEP 5 引き継ぎ）。
 *
 * ## 立ってから、話せるようになるまでに間がある（Session 5-2）
 *
 * LSP は最初の1往復（`initialize` → 応答 → `initialized`）が済むまで、
 * 他の要求も通知も受け付けない。プロセスが在ることと、電文を送れることは別になる。
 *
 * ```
 * spawn → （initialize を送る）→ 応答 → initialized → ready
 *                ここまでの間に届いた didOpen は、送らずに保留される
 * ```
 *
 * そのため `ready` を状態として持ち、外へは `isLanguageServerReady` /
 * `onLanguageServerStateChange` で見せる。**保留した文書の中身をこの層が
 * 抱えることはしない** ── 中身の正本は Monaco の Model 1つに保つ、という
 * 判断がその外側（documentSync.ts）にある。
 *
 * ## Workspace が変わったら、全部終わらせる
 *
 * ここが Terminal と逆になる。シェルは切り替えでも終わらせない（Session 3-7-3
 * ── 動いているビルドや dev server を、フォルダを見に行く操作1つで殺さないため）。
 * Language Server にその性質は無い。
 *
 *   - 見ている対象が Workspace そのもの（`rootUri` は起動時に決まり、動かせない）
 *   - 失われるものが無い（利用者の作業ではなく、解析した結果でしかない）
 *   - 残すと、**前のフォルダを見ているサーバが新しいフォルダの答えを返す**
 *
 * 3つめが実害になる。だから切り替えの時点で終わらせ、必要になったら
 * 新しい Workspace で立て直す（立てるのは 5-2 以降）。
 *
 * ## 落ちたら立て直す。ただし際限なくは試さない
 *
 * 判断は restartPolicy.ts に分けてある。この層が持つのは
 * **「頼んで終わらせたのか、勝手に終わったのか」の区別**だけで、
 * それが立て直しの入口になる（頼んだ側は立て直さない）。
 */

const log = createLogger('lsp')

/**
 * `initialize` の応答を待つ上限（ミリ秒）。
 *
 * 待ち続ける形にしないのは、**返事が来ないサーバは立っていないのと同じ**であるため。
 * 上限を置かないと、そのプロセスは電文を1つも受け付けないまま残り続け、
 * 落ちてもいないので立て直しの判断（restartPolicy.ts）にも入らない。
 * 過ぎたら終わらせ、異常終了と同じ道（立て直し）へ流す。
 */
export const LANGUAGE_SERVER_INITIALIZE_TIMEOUT_MS = 60_000

interface LanguageServerRecord {
  readonly id: LanguageServerId
  readonly name: string
  /** どの Workspace のために立てたか。切り替えの行き違いを見分けるために持つ。 */
  readonly workspaceId: string
  readonly rootPath: string
  readonly child: ChildProcessWithoutNullStreams
  readonly connection: JsonRpcConnection
  /** こちらから終わらせたか（立て直しの対象から外す印）。 */
  stopping: boolean
  /** `initialized` まで済んだか。ここが true になるまで電文は送れない。 */
  ready: boolean
}

/** サーバの状態が変わったことの知らせ（documentSync.ts が受ける）。 */
export type LanguageServerState = 'ready' | 'stopped'

export type LanguageServerStateListener = (id: LanguageServerId, state: LanguageServerState) => void

const stateListeners = new Set<LanguageServerStateListener>()

/**
 * サーバが話せるようになった / 話せなくなったときに呼ばれる。
 *
 * 戻り値は購読の解除（onWorkspaceFolderChange と同じ形）。
 * **この層から個別の機能を呼ばない**のは、正本の側が受け手の都合を知る形にしないため
 * （main/workspaceFolder/currentWorkspaceFolder.ts と同じ理由）。
 */
export function onLanguageServerStateChange(listener: LanguageServerStateListener): () => void {
  stateListeners.add(listener)

  return () => {
    stateListeners.delete(listener)
  }
}

function notifyState(id: LanguageServerId, state: LanguageServerState): void {
  for (const listener of stateListeners) {
    try {
      listener(id, state)
    } catch (cause) {
      // 受け手の失敗で、プロセスの管理そのものを止めない。
      log.error('a language server state listener failed.', cause)
    }
  }
}

/** 立っているサーバ。1つの言語につき1本。 */
const servers = new Map<LanguageServerId, LanguageServerRecord>()

/**
 * 立て直し待ちのもの。
 *
 * プロセスはもう無いが「この id はまだ諦めていない」状態を表す。
 * `servers` と分けてあるのは、待っている間に立て直しを取り消せるようにするため
 * （Workspace が変わった・アプリが終わる）。
 */
const pendingRestarts = new Map<LanguageServerId, ReturnType<typeof setTimeout>>()

/**
 * 異常終了の時刻（id ごと）。
 *
 * 窓から出たものを落とすのは restartPolicy.ts の仕事で、ここは
 * 返ってきたものを控え直すだけになる。
 */
const crashHistory = new Map<LanguageServerId, readonly number[]>()

/* --------------------------------------------------------------------- 起動 */

/**
 * 起動の結末。
 *
 * IpcError を投げないのは、この層が IPC を知らないため
 * （main/terminal/terminalSessions.ts の CreateTerminalSessionOutcome と同じ形）。
 * Session 5-1 の時点で呼び出し元は Main の中だけにあり、IPC の口は無い。
 */
export type StartLanguageServerOutcome =
  | { readonly status: 'started' }
  /** 既に立っている（同じ Workspace で）。 */
  | { readonly status: 'already-running' }
  /** Workspace が開かれていない（`rootUri` の正本が無い）。 */
  | { readonly status: 'no-workspace' }
  /** 表にはあるが、この PC には入っていない。 */
  | { readonly status: 'server-unavailable' }
  /** 起動できなかった。 */
  | { readonly status: 'spawn-failed'; readonly detail: string }

/**
 * 1つの言語のサーバを立てる。
 *
 * 作業ディレクトリを引数に取らない ── 今の Workspace を自分で読む
 * （main/git/runGit.ts と同じ形）。受け取る形にすると、呼び出し側が増えるたびに
 * 「どこで起動するか」を決める場所が増え、いずれ境界の外から届いたパスがそこへ入る。
 */
export function startLanguageServer(id: LanguageServerId): StartLanguageServerOutcome {
  const workspace = getCurrentWorkspaceFolder()

  if (workspace === null) {
    return { status: 'no-workspace' }
  }

  const running = servers.get(id)

  if (running !== undefined) {
    /*
      切り替えの直後に、前の Workspace のサーバがまだ残っている場合。
      終わらせてから立て直す（このファイルの冒頭）。
    */
    if (running.workspaceId === workspace.id) {
      return { status: 'already-running' }
    }

    stopRecord(running, 'the workspace folder changed.')
  }

  // 立て直し待ちがあれば取り消す。今すぐ立てるので待つ理由が無い。
  cancelRestart(id)

  const command = resolveLanguageServerCommand(id, currentPlatform, process.env, existsSync)

  if (command === null) {
    return { status: 'server-unavailable' }
  }

  return spawnServer(id, command, workspace.id, workspace.rootPath)
}

function spawnServer(
  id: LanguageServerId,
  command: LanguageServerCommand,
  workspaceId: string,
  rootPath: string
): StartLanguageServerOutcome {
  let child: ChildProcessWithoutNullStreams

  try {
    child = spawn(command.file, [...command.args], {
      cwd: rootPath,
      env: createLanguageServerEnvironment(process.env),
      /*
        3本とも自分で持つ。stdin / stdout は LSP の経路そのもので、
        stderr はサーバのログになる（電文ではないので、こちらのログへ流す）。
      */
      stdio: ['pipe', 'pipe', 'pipe'],
      /*
        シェルを通さない。通すと引数が文字列として再解釈され、
        Workspace のパスに含まれる `&` や `^` が別の意味を持ちうる
        （main/git/runGit.ts と同じ理由）。`.cmd` を包む必要があるものは、
        表の側が `cmd.exe /c <絶対パス>` の形で持っている。
      */
      shell: false,
      // コンソールウィンドウを出さない（Windows で `cmd.exe` を包む行があるため）。
      windowsHide: true
    })
  } catch (cause) {
    const detail = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)
    log.error(`failed to start ${command.name}: ${command.file}`, cause)

    return { status: 'spawn-failed', detail }
  }

  const connection = createJsonRpcConnection({
    send: (data) => {
      /*
        書けないことがある（終了とほぼ同時に送った・相手が stdin を閉じた）。
        投げると通知を送っただけの呼び出し側が落ちるため、connection 側が
        受け止めて `onProtocolWarning` へ回す。
      */
      child.stdin.write(data)
    },
    onNotification: (method, params) => {
      handleServerNotification(id, command.name, method, params)
    },
    onBrokenStream: (reason) => {
      /*
        枠を見失った。この先に読めるものは無いので、プロセスごと終わらせる
        ── 落ちたのと同じ扱いになり、立て直しの判断へ入る。
      */
      log.warn(`${command.name}: ${reason}`)
      killChild(child)
    },
    onProtocolWarning: (reason) => {
      log.warn(`${command.name}: ${reason}`)
    }
  })

  const record: LanguageServerRecord = {
    id,
    name: command.name,
    workspaceId,
    rootPath,
    child,
    connection,
    stopping: false,
    ready: false
  }

  servers.set(id, record)

  child.stdout.on('data', (chunk: Buffer) => {
    connection.receive(chunk)
  })

  child.stderr.on('data', (chunk: Buffer) => {
    /*
      サーバのログ。電文ではないので JSON-RPC の経路には入れない。
      量が多いサーバがあるため debug に留め、1回ぶんの長さも切る。
    */
    log.debug(`${command.name} [stderr] ${trimForLog(chunk.toString('utf8'))}`)
  })

  /*
    stdin の 'error' を拾っておく。拾わないと、相手が先に閉じたときの EPIPE が
    捕捉されない例外になり、**Main Process ごと落ちる。**
  */
  child.stdin.on('error', (cause) => {
    log.warn(`${command.name}: writing to stdin failed.`, cause)
  })

  child.on('error', (cause) => {
    // 起動そのものに失敗した場合（実行ファイルが消えた・権限が無い）。
    log.error(`${command.name} could not be run.`, cause)
  })

  child.on('exit', (code, signal) => {
    handleExit(record, code, signal)
  })

  log.info(`${command.name} started: pid=${child.pid ?? -1} cwd=${rootPath}`)

  void initializeServer(record)

  return { status: 'started' }
}

/* ----------------------------------------------------------------- 初期化 */

/**
 * `initialize` → `initialized` を済ませ、電文を送れる状態にする（Session 5-2）。
 *
 * `startLanguageServer` から待たずに呼ぶ（`void`）。待つ形にすると、
 * ファイルを1つ開くだけの操作が**サーバの起動時間ぶん**止まることになる
 * ── 保留した文書は準備ができた時点で開き直される（documentSync.ts）。
 *
 * 失敗（応答が失敗・途中で切れた・時間切れ）はどれも「このプロセスとは
 * 話せない」という同じ結論になる。終わらせて、異常終了と同じ道
 * （restartPolicy.ts の判断）へ流す ── ここで独自に立て直すと、
 * 立て直しの上限を数える場所が2つになる。
 */
async function initializeServer(record: LanguageServerRecord): Promise<void> {
  const timer = setTimeout(() => {
    if (servers.get(record.id) !== record || record.ready) {
      return
    }

    log.warn(`${record.name} did not answer "initialize" in time; restarting it.`)
    killChild(record.child)
  }, LANGUAGE_SERVER_INITIALIZE_TIMEOUT_MS)

  // 起動待ちのタイマーでアプリの終了を引き延ばさない（立て直しのタイマーと同じ）。
  timer.unref?.()

  const outcome = await record.connection.request(
    'initialize',
    createInitializeParams({
      processId: process.pid,
      clientName: app.getName(),
      clientVersion: app.getVersion(),
      rootUri: toWorkspaceRootUri(record.rootPath),
      rootName: record.rootPath
    })
  )

  clearTimeout(timer)

  /*
    待っている間に差し替わった / 終わった。今さら `initialized` を送る相手は居ない
    （handleExit / stopRecord が既に片付けている）。
  */
  if (servers.get(record.id) !== record) {
    return
  }

  if (outcome.status !== 'result') {
    const detail = outcome.status === 'error' ? outcome.error.message : outcome.reason

    log.error(`${record.name} could not be initialized: ${detail}`)
    killChild(record.child)

    return
  }

  /*
    応答の `capabilities` は Session 5-2 では読まない。
    読む必要が出るのは、サーバが差分同期を断って全文だけを求める場合
    （`textDocumentSync` が `Full`）と、診断の受け取り（Session 5-3）になる。
    **読まないものを読んだふりをしない**ため、ここでは素通りさせる。
  */
  record.connection.notify('initialized', {})
  record.ready = true

  log.info(`${record.name} is ready.`)

  notifyState(record.id, 'ready')
}

/* --------------------------------------------------------------- 電文を送る */

/** そのサーバが電文を受け取れる状態か。 */
export function isLanguageServerReady(id: LanguageServerId): boolean {
  return servers.get(id)?.ready === true
}

/**
 * 立っているサーバへ通知を送る。送れなければ false。
 *
 * **要求（応答を待つもの）の口はまだ開けていない。** Session 5-2 で送るのは
 * 文書同期の4つの通知だけで、どれも応答を持たない
 * （main/lsp/textDocumentNotifications.ts）。応答を要る操作
 * ── 補完・定義へ移動・整形 ── は、受け取る器と一緒に後の Session で足す。
 */
export function notifyLanguageServer(
  id: LanguageServerId,
  method: string,
  params: unknown
): boolean {
  const record = servers.get(id)

  if (record === undefined || !record.ready) {
    return false
  }

  record.connection.notify(method, params)

  return true
}

/* ------------------------------------------------------------- サーバからの通知 */

/**
 * サーバからの通知。
 *
 * Session 5-1 で扱えるのはログだけになる。診断（`textDocument/publishDiagnostics`）は
 * 受け取る器（Renderer 側の表示と、そこへ届ける IPC イベント）がまだ無いため、
 * ここでは**捨てずに、知らない通知として1行残す**に留める
 * ── 黙って捨てると、5-2 で受け取り始めたときに「前から届いていたのか」が分からない。
 */
function handleServerNotification(
  id: LanguageServerId,
  name: string,
  method: string,
  params: unknown
): void {
  if (method === 'window/logMessage' || method === 'window/showMessage') {
    log.debug(`${name}: ${trimForLog(describeMessageParams(params))}`)
    return
  }

  log.debug(`${name}: unhandled notification "${method}" (${id})`)
}

/** `window/logMessage` の中身を1行にする（型は当てにせず、読めた場合だけ使う）。 */
function describeMessageParams(params: unknown): string {
  if (typeof params === 'object' && params !== null && 'message' in params) {
    const message = (params as { readonly message: unknown }).message

    if (typeof message === 'string') {
      return message
    }
  }

  return '(no message)'
}

/* ----------------------------------------------------------------- 終わらせる */

/**
 * 1つの言語のサーバを終わらせる。
 *
 * 知らない id でも失敗にしない。**片付けは何度呼ばれても同じ結果になるべき**で、
 * 「もう無い」は片付けの目的から見れば成功にほかならない
 * （main/terminal/terminalSessions.ts と同じ）。
 */
export function stopLanguageServer(id: LanguageServerId, reason: string): void {
  cancelRestart(id)

  const record = servers.get(id)

  if (record === undefined) {
    return
  }

  stopRecord(record, reason)
}

/**
 * すべて終わらせる（Workspace の切り替え・アプリの終了）。
 *
 * **これが無いと、サーバがアプリの終了後も残る。** 解析中のサーバは CPU を
 * 使い続けるうえ、次にアプリを開いたときには**同じ Workspace を見ている
 * サーバが2本**になる（ウィンドウを閉じただけでは Renderer が消えるだけで、
 * プロセスは Main の持ち物のまま）。
 */
export function stopLanguageServers(reason: string): void {
  for (const id of [...pendingRestarts.keys()]) {
    cancelRestart(id)
  }

  for (const record of [...servers.values()]) {
    stopRecord(record, reason)
  }

  servers.clear()
}

function stopRecord(record: LanguageServerRecord, reason: string): void {
  if (record.stopping) {
    return
  }

  /*
    先に印を付けてから終わらせる。`exit` は同期的に来ることがあり、
    後にすると「勝手に終わった」と見て立て直しに入る。
  */
  record.stopping = true

  /*
    作法どおりの順（`shutdown` → `exit`）で送る（Session 5-2）。ただし
    **応答は待たない。**

    待てないのは、この関数が `will-quit` から呼ばれるため ── Electron の
    終了は引き延ばせず、待つ形にすると「片付けが終わる前にプロセスが消える」
    ことになる。送るだけ送って、確実な片付けは kill が担う。

    初期化を済ませていないサーバへは送らない。仕様上、初期化前の要求は
    `InvalidRequest` で断られるだけで、意味を持たない。
  */
  if (record.ready) {
    void record.connection.request('shutdown')
    record.connection.notify('exit')
  }

  // 待っている要求を片付ける（呼び出し側の Promise を宙に残さない）。
  record.connection.dispose(reason)
  killChild(record.child)
  servers.delete(record.id)

  log.info(`${record.name} stopped: ${reason}`)

  /*
    知らせるのは片付けが済んでから。受け手（documentSync.ts）は
    「このサーバは開いている文書を知らなくなった」として控えを戻す。
  */
  notifyState(record.id, 'stopped')
}

function killChild(child: ChildProcessWithoutNullStreams): void {
  try {
    child.kill()
  } catch (cause) {
    // 既に終わっていた。片付けの目的から見れば成功。
    log.debug('a language server had already exited when it was killed.', cause)
  }
}

/* ------------------------------------------------------------------ 立て直し */

function handleExit(
  record: LanguageServerRecord,
  code: number | null,
  signal: NodeJS.Signals | null
): void {
  const known = servers.get(record.id)

  // 既に別のサーバに差し替わっている（切り替えの行き違い）。何もしない。
  if (known !== record) {
    return
  }

  servers.delete(record.id)
  record.connection.dispose('the language server exited.')

  /*
    このプロセスはもう文書を1つも知らない。控えを戻す側（documentSync.ts）へ
    伝えるのは、立て直しの判断より先 ── 立て直しが即座に走った場合でも、
    「落ちた」→「立った」の順で届く必要がある。
  */
  notifyState(record.id, 'stopped')

  if (record.stopping) {
    // こちらから終わらせた。立て直さない。
    return
  }

  const how = signal === null ? `code=${code ?? -1}` : `signal=${signal}`

  log.warn(`${record.name} exited unexpectedly (${how}).`)

  scheduleRestart(record, Date.now())
}

function scheduleRestart(record: LanguageServerRecord, now: number): void {
  const decision = decideLanguageServerRestart(crashHistory.get(record.id) ?? [], now)

  crashHistory.set(record.id, decision.history)

  if (decision.status === 'give-up') {
    /*
      諦める。その言語の機能だけが止まり、他は動き続ける
      （設計判断 6 ── Git が入っていない PC でも他は使えるのと同じ形）。
      次に立ち上がるのは、Workspace を開き直すか、アプリを起動し直したときになる。
    */
    log.error(
      `${record.name} keeps exiting (${decision.attempts} times); not restarting it any more.`
    )

    return
  }

  log.info(`${record.name} will restart in ${decision.delayMs}ms (attempt ${decision.attempt}).`)

  const timer = setTimeout(() => {
    pendingRestarts.delete(record.id)
    restartNow(record)
  }, decision.delayMs)

  /*
    アプリの終了を、立て直しのタイマーで引き延ばさない。Node のタイマーは
    既定でイベントループを起こし続ける（`will-quit` の後に残ると終了が遅れる）。
  */
  timer.unref?.()

  pendingRestarts.set(record.id, timer)
}

function restartNow(record: LanguageServerRecord): void {
  const workspace = getCurrentWorkspaceFolder()

  /*
    待っている間に Workspace が変わった / 閉じられた。前のフォルダを見る
    サーバを今さら立てる理由は無い（このファイルの冒頭）。
  */
  if (workspace === null || workspace.id !== record.workspaceId) {
    log.info(`${record.name} is not restarted: the workspace folder changed while waiting.`)
    return
  }

  const outcome = startLanguageServer(record.id)

  if (outcome.status !== 'started' && outcome.status !== 'already-running') {
    log.warn(`${record.name} could not be restarted: ${outcome.status}`)
  }
}

function cancelRestart(id: LanguageServerId): void {
  const timer = pendingRestarts.get(id)

  if (timer === undefined) {
    return
  }

  clearTimeout(timer)
  pendingRestarts.delete(id)
}

/* --------------------------------------------------------------------- 入口 */

/**
 * Workspace の切り替えに追従し始める（アプリの起動時に1度だけ）。
 *
 * ここで購読を張るのは、**切り替えで何をするかがこの層の判断**であるため
 * （正本の側から個別の機能を呼ぶ形にすると、正本がその機能の都合を知ることになる。
 * main/workspaceFolder/currentWorkspaceFolder.ts）。
 * 形は startGitWatching / startWorkspaceWatching と揃えてある。
 *
 * ここがするのは「立っていれば終わらせる」だけで、**立てる側はここに無い**。
 * 立てるのは文書が開かれたときで、その判断は documentSync.ts が持つ
 * （Session 5-2。startLanguageServerDocumentSync が対になる入口になる）。
 */
export function startLanguageServerHosting(): void {
  onWorkspaceFolderChange(() => {
    stopLanguageServers('the workspace folder changed.')
  })
}

/** ログ1行に載せる長さの上限。サーバの stderr は際限なく長い行を出すことがある。 */
function trimForLog(value: string): string {
  const line = value.replace(/\s+$/, '')

  return line.length <= 500 ? line : `${line.slice(0, 500)}…`
}
