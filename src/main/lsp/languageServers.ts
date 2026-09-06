import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { existsSync } from 'fs'
import { createLogger } from '../logger'
import { currentPlatform } from '../platform'
import {
  getCurrentWorkspaceFolder,
  onWorkspaceFolderChange
} from '../workspaceFolder/currentWorkspaceFolder'
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
 * Session 5-1 の時点で LSP の IPC チャンネルは1つも無く、preload にも口が無い。
 * 起動・停止・立て直しはすべて Main の中で完結する。Renderer から
 * 「このサーバを起動して」と頼める形は、Session 5-2 以降でも作らない予定にしてある
 * ── 起動のきっかけになるのは「開いた文書の言語」であって、
 * サーバそのものではないため（DESIGN.md の STEP 5 引き継ぎ）。
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
    stopping: false
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

  return { status: 'started' }
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
    待っている要求を先に片付ける（呼び出し側の Promise を宙に残さない）。
    Session 5-1 の時点で待っているものは無いが、順番はここで決めておく。

    LSP の作法どおりに `shutdown` を送って待つ形にはしていない ──
    `initialize` を済ませていないサーバは `shutdown` に応じられず
    （仕様上、初期化前の要求は `InvalidRequest` で断られる）、
    待つだけ終了が遅くなる。作法どおりの終わらせ方は、`initialize` を
    入れる Session 5-2 で対になる形で足す。
  */
  record.connection.dispose(reason)
  killChild(record.child)
  servers.delete(record.id)

  log.info(`${record.name} stopped: ${reason}`)
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
 * Session 5-1 の時点でサーバを立てる呼び出し元はまだ無いため、ここが実際に
 * するのは「立っていれば終わらせる」だけになる。立てる側（開いた文書の言語から
 * 必要なサーバを決める）は Session 5-2 で入る。
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
