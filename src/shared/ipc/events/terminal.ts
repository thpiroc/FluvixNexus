/**
 * terminal ドメインの Main → Renderer イベント（Session 3-7-1）。
 *
 * 要求と応答（contracts/terminal.ts）と対になる、シェルから出てくる側。
 *
 * ## `files:changed` と性質が違う点
 *
 * この経路にこれまで載っていたのは、**取りこぼしても次で埋められる**通知だった
 * （ファイルが変わった → 読み直せばよい）。ターミナルの出力はそうではない。
 * 1回きりで、順番に意味があり、落とすと画面が壊れる（消えた分だけ表示がずれ、
 * 読み直す手段は無い）。
 *
 * そこで Main 側の扱いを2つ変えてある（main/terminal/outputCoalescer.ts）。
 *
 *   束ねる … 1回の `ls` でも onData は何度も呼ばれる。そのまま1回ずつ送ると
 *            IPC の往復回数が出力の細かさに比例する
 *   捨てない … 束ねはするが間引かない。`files:changed` の
 *              MAX_CHANGES_PER_BATCH に当たるものを置いていない
 *
 * ## 誰に届くか
 *
 * イベントは全ウィンドウへ配られる（main/ipc/events.ts）。今は1つしか無いので
 * 実害は無いが、**パネルの独立ウィンドウ化（DESIGN.md §3）を入れた時点で、
 * 出力が要らないウィンドウにも届く**ことになる。payload に sessionId を載せてあるので
 * 受け手は捨てられるが、宛先を絞るべき最初の相手はこのイベントになる（継ぎ目）。
 */

export interface TerminalOutputEvent {
  readonly sessionId: string
  /**
   * シェルからの出力（エスケープシーケンスを含む生のまま）。
   *
   * Main は中身を読まない。色も改行もカーソル移動もすべてこの文字列の中にあり、
   * 解釈するのは xterm.js だけになる ── Main が少しでも解釈すると、
   * 「端末エミュレータが2つある」状態になって必ず食い違う。
   */
  readonly data: string
}

export interface TerminalExitEvent {
  readonly sessionId: string
  /**
   * シェルの終了コード。
   *
   * **利用者が `exit` と打った場合も、アプリが片付けた場合もここへ来る。**
   * 区別を載せていないのは、Session 3-7-1 の受け手にとってどちらも
   * 「もうこのセッションは無い」という同じ結論になるため。
   * 実行中プロセスの確認（Session 3-7-4）で区別が要るようになったら足す。
   */
  readonly exitCode: number
}

export interface TerminalIpcEventContract {
  'terminal:data': TerminalOutputEvent
  'terminal:exit': TerminalExitEvent
}
