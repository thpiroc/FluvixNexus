import { spawn, type IPty } from '@lydell/node-pty'
import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import {
  TERMINAL_MAX_SESSIONS,
  type TerminalSession,
  type TerminalShellChoice,
  type TerminalShellId,
  type TerminalSize
} from '@shared/terminal'
import { IPC_EVENT_CHANNELS } from '@shared/ipc'
import { emitIpcEvent } from '../ipc/events'
import { createLogger } from '../logger'
import { currentPlatform } from '../platform'
import { getCurrentWorkspaceFolder } from '../workspaceFolder/currentWorkspaceFolder'
import { queryPidsWithChildren } from './childProcesses'
import { createOutputCoalescer, type OutputCoalescer } from './outputCoalescer'
import { listShellChoices, resolveShellCommand } from './shellCommand'
import { createTerminalEnvironment } from './terminalEnvironment'

/**
 * 動いているシェルのセッションを持つ層（Session 3-7-1）。
 *
 * **node-pty に触れてよいのはこのファイルだけ。** IPC のハンドラ
 * （ipc/handlers/terminal.ts）が持つのは、結末を IPC の失敗分類へ翻訳することだけで、
 * プロセスの話はここに閉じる（workspaceFolder/currentWorkspaceFolder.ts と
 * その handler の分け方と同じ）。
 *
 * ## Main が長命な子プロセスを持つ、最初の機能
 *
 * Files も Editor も、要求のたびに始まって応答で終わる処理だった。
 * ターミナルは違う ── 一度立てたら利用者が終わらせるまで生き続け、
 * その間ずっと出力を出し、アプリが終わるときには**確実に片付ける必要がある。**
 * この形は LSP（サーバ1本）と DAP（デバッグ対象）がそのまま踏襲する。
 *
 * ```
 * createTerminalSession   … 起動して id を返す
 *   ↓ onData   → outputCoalescer → emitIpcEvent('terminal:data')
 *   ↓ onExit   → 片付けて         emitIpcEvent('terminal:exit')
 * disposeTerminalSession  … 利用者が閉じた
 * stopTerminalSessions    … アプリが終わる（app/lifecycle.ts の will-quit）
 * ```
 *
 * ## 表として持つ（1本しか使わない時点から）
 *
 * Session 3-7-1 の UI が作るのは1本だけだったが、ここは最初から Map にしてあった。
 * **1本だけを前提にした構造は「今動いているものを1つ」という暗黙の前提を
 * あちこちに作る**（id を持たない write、片付け忘れが起きない dispose）ためで、
 * 実際 Session 3-7-2 で複数タブが載ったときに、このファイルで増えたのは
 * 「どの行のシェルか」を受け取って表へ引くところだけになっている。
 *
 * ## Workspace が変わっても終わらせない（Session 3-7-3）
 *
 * シェルの作業ディレクトリは**起動時に決まり、後から動かす手段は無い**
 * （中で `cd` するのは利用者であってアプリではない）。ここまでは Session 3-7-1 と
 * 同じで、変えたのはそこから導く結論になる。
 *
 * ```
 * 既に動いているセッション … そのまま。cwd は起動したフォルダのまま
 * これから立てるセッション … getCurrentWorkspaceFolder() ＝ 今のフォルダ
 * ```
 *
 * Session 3-7-1 / 3-7-2 では切り替えのたびに全部片付けていた（Editor が
 * タブを捨てるのに揃えていた）。**Editor のタブと違い、ここで捨てるのは
 * 動いている OS のプロセスにほかならない** ── ビルド・dev server・
 * Claude Code の対話は、フォルダを見に行く操作1つで消えてよいものではないし、
 * 捨てたものは開き直しても戻らない。
 *
 * この層は「今のフォルダ」を**起動のときにだけ**読むので、追従のための購読は
 * 持たない（files/workspaceWatcher.ts と違い、切り替えでする仕事が無い）。
 *
 * 片付けるのは2つの場合だけになる。
 *
 *   利用者がタブを閉じた   … disposeTerminalSession
 *   アプリが終わる         … stopTerminalSessions（app/lifecycle.ts）
 *
 * ## 終わらせる前に「実行中か」を答えられるようにした（Session 3-7-4）
 *
 * 片付けそのものは上の2つのままで、変わっていない。足したのは
 * **どのセッションが今なにかを実行しているか**を答える口
 * （`listBusyTerminalSessions`）で、それを見て確認を出すかどうかを決めるのは
 * Renderer 側の器になる（renderer/src/unsaved/ ── docs/ARCHITECTURE.md §12.6）。
 *
 * 判断そのものは childProcesses.ts に置いてある（子プロセスが居るかを OS に聞く）。
 * ここが持つのは、**pid をこの層から外へ出さないこと**だけになる。
 */

const log = createLogger('terminal')

interface TerminalSessionRecord {
  readonly id: string
  readonly workspaceId: string
  readonly shellId: TerminalShellId
  readonly shellName: string
  readonly pty: IPty
  readonly output: OutputCoalescer
  /** 片付け済みか（onExit と dispose の二重処理を防ぐ）。 */
  closed: boolean
}

const sessions = new Map<string, TerminalSessionRecord>()

/* ----------------------------------------------------------------- 選択肢 */

/**
 * この環境で起動できるシェルの一覧（Session 3-7-2）。
 *
 * 表そのものは shellCommand.ts が持ち、ここは `process.env` と
 * 「実体が在るか」を渡すだけ。**呼ばれるたびに調べ直す** ── 利用者が
 * アプリを開いたまま Node を入れることがあり、その場合に開き直しを
 * 強いる理由が無い（調べるのは PATH の項目ぶんの existsSync だけで、
 * タブを開く操作の頻度に対して十分に軽い）。
 */
export function listAvailableShells(): readonly TerminalShellChoice[] {
  return listShellChoices(currentPlatform, process.env, existsSync)
}

/* --------------------------------------------------------------------- 起動 */

/**
 * 起動の結末。
 *
 * IpcError をここで投げないのは、この層が IPC を知らないため
 * （workspaceFolder/currentWorkspaceFolder.ts の OpenWorkspaceFolderOutcome と同じ形）。
 */
export type CreateTerminalSessionOutcome =
  | { readonly status: 'created'; readonly session: TerminalSession }
  /** Workspace が開かれていない（作業ディレクトリの正本が無い）。 */
  | { readonly status: 'no-workspace' }
  /** 同時に開ける上限に達している。 */
  | { readonly status: 'too-many' }
  /** 表にはあるが、この環境には入っていない（Node / Claude Code）。 */
  | { readonly status: 'shell-unavailable' }
  /** シェルを起動できなかった（ConPTY が使えない・実行ファイルが無い）。 */
  | { readonly status: 'spawn-failed'; readonly detail: string }

export function createTerminalSession(
  shellId: TerminalShellId,
  size: TerminalSize
): CreateTerminalSessionOutcome {
  const workspace = getCurrentWorkspaceFolder()

  /*
    作業ディレクトリを Renderer から受け取らないので、Workspace が無いときに
    代わりに使ってよい場所というものが無い。ホームで開くこともしない ──
    そうすると DESIGN.md §3 の「4つのパネルは今開いているフォルダを共通の対象にする」
    から Terminal だけが外れ、「Files に見えているものと違う場所」で
    コマンドが走ることになる。
  */
  if (workspace === null) {
    return { status: 'no-workspace' }
  }

  if (sessions.size >= TERMINAL_MAX_SESSIONS) {
    return { status: 'too-many' }
  }

  /*
    表のどの行かは Renderer が指せるが、行の中身は Main だけが持つ
    （shellCommand.ts）。ここで null になるのは「表にはあるが、この PC には
    入っていない」場合で、断るのは Main の側にしてある ── UI は
    `terminal:list-shells` で起動できるものだけを出すが、UI は迂回されうる。
  */
  const shell = resolveShellCommand(shellId, currentPlatform, process.env, existsSync)

  if (shell === null) {
    return { status: 'shell-unavailable' }
  }

  const id = randomUUID()

  let pty: IPty

  try {
    pty = spawn(shell.file, [...shell.args], {
      name: 'xterm-256color',
      cols: size.columns,
      rows: size.rows,
      cwd: workspace.rootPath,
      env: createTerminalEnvironment(process.env)
    })
  } catch (cause) {
    /*
      ConPTY が使えない（Windows 10 1809 より前）・実行ファイルが無い・
      作業ディレクトリが起動の直前に消えた。**どれもアプリを止める理由にはしない。**
      ターミナルが開けないだけで、Files も Editor もそのまま使える。
    */
    const detail = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)
    log.error(`failed to start a shell: ${shell.file}`, cause)

    return { status: 'spawn-failed', detail }
  }

  const record: TerminalSessionRecord = {
    id,
    workspaceId: workspace.id,
    shellId,
    shellName: shell.name,
    pty,
    output: createOutputCoalescer((data) => {
      emitIpcEvent(IPC_EVENT_CHANNELS.TERMINAL_DATA, { sessionId: id, data })
    }),
    closed: false
  }

  sessions.set(id, record)

  pty.onData((chunk) => {
    record.output.push(chunk)
  })

  pty.onExit(({ exitCode }) => {
    /*
      溜まっているものを先に送る。終了の直前の出力（エラーメッセージ・
      終了コードを出す行）は、まさに利用者が読みたいものになる。
    */
    record.output.flush()
    finalize(record, exitCode)
  })

  log.info(`shell started: ${shell.name} (${shellId}) pid=${pty.pid} cwd=${workspace.rootPath}`)

  return {
    status: 'created',
    session: { id, shellName: shell.name, shellId, workspaceId: workspace.id }
  }
}

/* ------------------------------------------------------------------ 入力と大きさ */

/** 入力を流す。知らない id なら false（呼び出し側が NOT_FOUND へ翻訳する）。 */
export function writeTerminalInput(sessionId: string, data: string): boolean {
  const record = sessions.get(sessionId)

  if (record === undefined || record.closed) {
    return false
  }

  try {
    record.pty.write(data)
  } catch (cause) {
    /*
      終了とほぼ同時に書いた場合（onExit がまだ届いていない）。
      利用者にとっては「もう終わっていた」でしかないので、失敗にはしない。
    */
    log.warn(`failed to write to a shell that is no longer accepting input.`, cause)
    return true
  }

  return true
}

/** 画面の大きさを伝える。知らない id なら false。 */
export function resizeTerminalSession(sessionId: string, size: TerminalSize): boolean {
  const record = sessions.get(sessionId)

  if (record === undefined || record.closed) {
    return false
  }

  try {
    record.pty.resize(size.columns, size.rows)
  } catch (cause) {
    log.warn('failed to resize a shell that is no longer running.', cause)
  }

  return true
}

/* --------------------------------------------------------------- 実行中かどうか */

/**
 * 今なにかを実行しているセッションの id（Session 3-7-4）。
 *
 * 何を実行中と見なすかは childProcesses.ts ── **そのシェルが子プロセスを
 * 持っているか**で決める。プロンプトで待っているだけのシェルは含まれない
 * （閉じても失われるものが無く、確認を出す理由が無い）。
 *
 * ## 分からなければ、全部を実行中として返す
 *
 * OS へ聞けなかった場合に空を返すと、それは「何も動いていない」として
 * 利用者に伝わり、**動いているビルドが確認なしで死ぬ。** 逆に倒しておけば、
 * 起きるのは確認が1回余分に出ることだけになる。
 *
 * ## pid はここから外へ出ない
 *
 * 外へ返るのはセッションの id だけ。node-pty の pid を知っているのはこの層で、
 * Renderer が受け取るものに OS のものを混ぜない
 * （shared/terminal/session.ts）という線をここでも守る。
 */
export async function listBusyTerminalSessions(): Promise<readonly string[]> {
  const live = [...sessions.values()].filter((record) => !record.closed)

  if (live.length === 0) {
    return []
  }

  const outcome = await queryPidsWithChildren(
    live.map((record) => record.pty.pid),
    currentPlatform,
    process.env
  )

  if (outcome.status === 'unknown') {
    log.warn(`could not tell which shells are busy: ${outcome.reason}`)

    // 分からない。動いているかもしれないものとして返す（上記）。
    return live.map((record) => record.id)
  }

  const busy = new Set(outcome.pidsWithChildren)

  return live.filter((record) => busy.has(record.pty.pid)).map((record) => record.id)
}

/* ----------------------------------------------------------------- 終わらせる */

/**
 * セッションを1本終わらせる（利用者がタブを閉じた）。
 *
 * Workspace の切り替えでは呼ばれない（このファイルの冒頭。Session 3-7-3）。
 *
 * 知らない id でも失敗にしない。**片付けは何度呼ばれても同じ結果になるべき**で、
 * 「もう無い」は片付けの目的から見れば成功にほかならない。
 */
export function disposeTerminalSession(sessionId: string): void {
  const record = sessions.get(sessionId)

  if (record === undefined) {
    return
  }

  killPty(record)
}

/**
 * アプリが終わるときの片付け（app/lifecycle.ts の `will-quit`）。
 *
 * **これが無いと、シェルとその子プロセスがアプリの終了後も残る。** ターミナルで
 * 立てた dev server がアプリを閉じてもポートを掴んだまま、という形で表に出る。
 * ウィンドウを閉じただけでは Renderer が消えるだけで、プロセスは Main の持ち物。
 *
 * Session 3-7-2 まではここで Workspace の切り替えの購読も外していたが、
 * **切り替えでは何もしなくなった**ため（このファイルの冒頭）、残るのは
 * セッションを全部終わらせることだけになる。
 */
export function stopTerminalSessions(): void {
  for (const record of [...sessions.values()]) {
    killPty(record)
  }

  sessions.clear()
}

/* --------------------------------------------------------------------- 内部 */

function killPty(record: TerminalSessionRecord): void {
  if (record.closed) {
    return
  }

  /*
    先に印を付けてから殺す。`kill()` は同期的に onExit を呼びうるため、
    後にすると finalize が「まだ生きている」と見て二重に走る。
  */
  record.closed = true

  try {
    record.pty.kill()
  } catch (cause) {
    // 既に終わっていた。片付けの目的から見れば成功。
    log.debug('a shell had already exited when it was killed.', cause)
  }

  /*
    捨てる（flush しない）。利用者が閉じた画面へ最後の出力を送っても、
    受け取る器がもう無い。プロセスが自分から終わった場合だけは、
    その直前の出力に意味があるので onExit 側で flush してある。
  */
  record.output.dispose()
  sessions.delete(record.id)
}

/** シェルが自分から終わったときの片付けと通知。 */
function finalize(record: TerminalSessionRecord, exitCode: number): void {
  if (record.closed) {
    return
  }

  record.closed = true
  record.output.dispose()
  sessions.delete(record.id)

  log.info(`shell exited: id=${record.id} code=${exitCode}`)

  emitIpcEvent(IPC_EVENT_CHANNELS.TERMINAL_EXIT, { sessionId: record.id, exitCode })
}
