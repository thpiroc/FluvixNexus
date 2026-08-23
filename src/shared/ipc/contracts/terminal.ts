import type {
  TerminalSession,
  TerminalShellChoice,
  TerminalShellId,
  TerminalSize
} from '../../terminal'

/**
 * terminal ドメインの IPC 契約（Session 3-7-1 / 3-7-2）。
 *
 * ## この契約の要点は「渡せないもの」にある
 *
 * `terminal:create` の要求に入っているのは**大きさと、表のどの行か**だけで、
 * 実行ファイルのパスも引数も作業ディレクトリも入っていない。
 *
 *   何を起動するか … main/terminal/shellCommand.ts の表（%SystemRoot% / PATH から解決する）
 *   どこで起動するか … main/workspaceFolder/currentWorkspaceFolder.ts（今の Workspace）
 *
 * `workspace-folder:open` が「ダイアログを出して」としか言えない（＝開く対象の
 * パスを渡せない）のと同じ形で、ここも「この行のターミナルを1つ」としか言えない。
 *
 * ## Session 3-7-2 で足した shellId は、境界を緩めていない
 *
 * シェルを選ばせる入口を作るには「どれを」を伝える必要があるが、伝わるのは
 * **閉じた集合の値1つ**（shared/terminal/shell.ts）で、知らない値は Main が断る。
 * 表の中身（実行ファイル・引数・解決の仕方）は今までどおり Main だけが持つため、
 * 「Renderer からの要求で任意の実行ファイルが動く」という形は依然として作られない。
 *
 * これは Terminal というドメインの性質から来ている。Files は
 * 「Workspace の外へ出られないこと」を相対位置だけを受け取ることで担保しているが、
 * **Terminal は定義上その外へ出られる** ── 起動したシェルの中で `cd ..` を
 * 止めることに意味は無いし、止めれば道具として使えない。
 * したがって守る場所を1つ内側へずらし、**起動の入口**を境界にする。
 * 入口さえ Renderer から指定できなければ、「Renderer からの要求で任意の場所の
 * 任意の実行ファイルが動く」という形は作られない。
 *
 * ## セッションを指すのは Main が発番した id
 *
 * write / resize / dispose はどれも id を1つ受け取る。id を知らないセッションには
 * 手が出せず、知らない id は NOT_FOUND で返る。
 * 発番するのは Main で（randomUUID）、Renderer が決めた文字列は受け付けない。
 *
 * ## 出力はここには居ない
 *
 * シェルからの出力は要求と応答の形にならない（誰も要求していないのに届き、
 * いつ終わるとも決まっていない）。片道の経路に載せる ── events/terminal.ts。
 */

export interface ListTerminalShellsResponse {
  /**
   * 起動できるシェルの選択肢（表の並びのまま）。
   *
   * **UI に出す前に必ずここを見る。** Node も Claude Code も入っていない PC は
   * ふつうにあり、入っているかどうかを知っているのは Main だけになる
   * （PATH を辿って実体を確かめる。main/terminal/shellCommand.ts）。
   *
   * 応答が要求と応答の形になっているのは、**環境は起動中に変わりうる**ため
   * （利用者が Node を入れてから開き直すことがある）。定数として持たせず、
   * タブを開こうとするたびに Main へ聞く形にしてある。
   */
  readonly shells: readonly TerminalShellChoice[]
}

export interface ListBusyTerminalSessionsResponse {
  /**
   * 今なにかを実行しているセッションの id（Session 3-7-4）。
   *
   * 「実行中」の定義は Main が持つ ── そのシェルが子プロセスを持っているか
   * （main/terminal/childProcesses.ts）。プロンプトで待っているだけのシェルは
   * 含まれない。**閉じる前に確認を出すかどうか**を決めるためだけの答えで、
   * 何が動いているか（実行ファイル名・pid）は載らない。
   *
   * 分からなかった場合は、動いているセッションが**全部**返る。空を返すと
   * それが「何も動いていない」として伝わり、確認なしで殺すことになる。
   *
   * 要求に欄が無いのは、**どのセッションについて聞くかを Renderer に言わせない**
   * ため。Main は自分が持っている表を見て答えるだけで、Renderer が知らない
   * セッションについて尋ねる余地も、知らない id を混ぜる余地も無い。
   */
  readonly busySessionIds: readonly string[]
}

export interface CreateTerminalSessionRequest {
  /**
   * どの行のシェルを起動するか（shared/terminal/shell.ts）。
   *
   * 実行ファイルではなく**表の行**を指す。知らない値・この環境に無いものは
   * Main が断る（UNSUPPORTED）── UI は `terminal:list-shells` で
   * `available` なものだけを出すが、**UI は迂回されうる**ので確かめるのは Main の側。
   */
  readonly shellId: TerminalShellId
  /**
   * 最初の大きさ。
   *
   * 起動時に渡すのは、シェルが最初のプロンプトを描く時点で桁数を知っている
   * 必要があるため。後から `terminal:resize` で直すと、起動直後の1画面だけが
   * 違う幅で折り返されたまま残る（ConPTY は描き終わった行を折り返し直さない）。
   */
  readonly size: TerminalSize
}

export interface CreateTerminalSessionResponse {
  readonly session: TerminalSession
}

export interface WriteTerminalInputRequest {
  readonly sessionId: string
  /**
   * シェルへ流す文字列（打鍵・貼り付け・制御文字）。
   *
   * **加工しない。** Ctrl+C（`\x03`）も Enter（`\r`）も、xterm が組み立てた
   * バイト列をそのまま運ぶ。ここで解釈すると、端末が端末でなくなる。
   * 長さの上限だけは Main が確かめる（shared/terminal/session.ts）。
   */
  readonly data: string
}

export interface ResizeTerminalRequest {
  readonly sessionId: string
  readonly size: TerminalSize
}

export interface DisposeTerminalSessionRequest {
  readonly sessionId: string
}

export interface TerminalIpcContract {
  'terminal:list-shells': {
    request: void
    response: ListTerminalShellsResponse
  }
  'terminal:list-busy': {
    request: void
    response: ListBusyTerminalSessionsResponse
  }
  'terminal:create': {
    request: CreateTerminalSessionRequest
    response: CreateTerminalSessionResponse
  }
  'terminal:write': {
    request: WriteTerminalInputRequest
    response: void
  }
  'terminal:resize': {
    request: ResizeTerminalRequest
    response: void
  }
  'terminal:dispose': {
    request: DisposeTerminalSessionRequest
    response: void
  }
}
