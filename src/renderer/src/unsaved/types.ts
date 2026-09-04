/**
 * 失われるものがある操作に、確認を1本で挟むための型（React にも DOM にも依存しない）。
 *
 * ## なぜ1箇所にまとめるのか
 *
 * 続けると何かが失われる操作は、Session 3-5 の時点で4つあった。
 *
 *   - Editor のタブを閉じる
 *   - Workspace を閉じる（上部バー / Files の root 行の ×）
 *   - 別の Workspace へ切り替える
 *   - ウィンドウを閉じる / アプリを終了する
 *
 * 確認をそれぞれの入口に書くと、**入口が増えるたびに保護が抜ける**。
 * Session 3-3 で「閉じる入口が増えても後片付けは増えない」形にしたのと同じ考え方で、
 * 確認も「失われるものを持っている側」と「失わせる操作をする側」に分け、
 * 間を1つの器（UnsavedChangesProvider）でつなぐ。
 *
 * ```
 * 失われるものを持つ側（EditorProvider / TerminalProvider）
 *    ↓  registerSource：この操作で何が失われるか / 保存で救えるか
 * UnsavedChangesProvider   確認の器（ダイアログを出すのはここだけ）
 *    ↑  confirmDiscard：この操作を続けてよいか
 * 失わせる側（Workspace を閉じる・ウィンドウを閉じる）
 * ```
 *
 * Provider を**両方より外側**（App.tsx の一番外）に置くことで、
 * Workspace の切り替え（WorkspaceFolderProvider）からも Editor / Terminal からも
 * 同じ器を参照できる。
 *
 * ## 失われるものは、未保存の変更だけではない（Session 3-7-4）
 *
 * Session 3-5 の時点で失われうるものは未保存の変更だけだったが、Terminal が
 * 載ったことで**実行中のプロセス**が加わった。どちらも「続けると戻せないものが
 * 消える」という同じ性質を持ち、利用者にとっては同じ場面で同じ判断になる
 * （終了しようとして、止められる場所が要る）ので、器は増やさない。
 *
 * 型の側では、失われるものに**種別**を持たせて区別する。文面と選べる道が
 * 種別で変わるためで、混ぜてしまうと「実行中のターミナルを保存しますか」に
 * なってしまう（lossMessage.ts）。
 *
 * フォルダ名を `unsaved/` のままにしてあるのは、この器が何のために作られたかを
 * 追えるようにするため（docs/ARCHITECTURE.md §12.6 も git の履歴も
 * 「未保存の確認」として書かれている）。増えたのは**申告の種類**であって、
 * 器の役目ではない。
 */

/**
 * 何が失われるのか。
 *
 * 文面と、選べる道（保存して続けられるか）がこれで変わる。
 */
export type LossKind =
  /** 未保存の変更（Editor のタブ）。保存すれば失われない。 */
  | 'unsaved-file'
  /** 実行中のターミナル（Session 3-7-4）。保存にあたるものが無く、続ければ終わる。 */
  | 'running-terminal'

/** 何をしようとしているか（確認の文面を変える・申告する側の判断にも渡る）。 */
export type LossAction = 'close-workspace' | 'switch-workspace' | 'close-window'

/** 失われるもの1件（利用者に何が失われるかを見せるための最小限）。 */
export interface LossItem {
  /** 一覧の鍵。Editor では relativePath、Terminal ではタブの id。 */
  readonly id: string
  readonly kind: LossKind
  /** 表示名（ファイル名 / ターミナルの名前）。 */
  readonly name: string
  /** どれのことか（同じ名前のものを区別する）。 */
  readonly detail: string
  /**
   * 保存して救うことができないか。
   *
   * ディスクから消えたファイルと、実行中のターミナルがこれにあたる。
   * 理由は違う（片方は保存が必ず失敗し、もう片方は保存という概念が無い）が、
   * **確認の側でする判断は同じ**ものになる ── 「保存」を選べる形で出さない。
   * 押せるのに救えない選択肢は、「保存したのに失われた」と受け取られる。
   */
  readonly unsavable: boolean
}

/**
 * 失われるものを持っている側が申告するもの。
 *
 * ## なぜ操作の種類を受け取るのか（Session 3-7-4）
 *
 * 同じ操作でも、失われるかどうかは持ち主にしか分からない。実際 Terminal は
 * **Workspace を切り替えても閉じても終わらない**（Session 3-7-3）ので、
 * 申告するのはウィンドウを閉じるときだけになる。器の側にその事情を書くと、
 * 「どの操作で何が消えるか」の知識が持ち主と器に二重に置かれる。
 *
 * ## なぜ非同期なのか（Session 3-7-4）
 *
 * Editor は自分の状態を見れば答えられるが、Terminal は**OS に聞かないと
 * 分からない**（プロンプトで待っているだけのシェルは失われるものを持たない。
 * main/terminal/childProcesses.ts）。確認が出るのは操作の瞬間なので、
 * その場で聞いて、その場の答えで判断する。
 *
 * `saveAll` が真偽値を返すのは、**保存できたときだけ続行してよい**ため。
 * Conflict や書き込みの失敗で保存が成立しなかった場合に閉じてしまうと、
 * 「保存を選んだのに失われた」が起きる。保存にあたるものを持たない申告
 * （実行中のターミナル）は、**失敗ではないので true を返す** ── ここで
 * false を返すと、保存できるファイルまで巻き添えで進めなくなる。
 */
export interface LossSource {
  readonly listLosses: (action: LossAction) => Promise<readonly LossItem[]>
  readonly saveAll: () => Promise<boolean>
}

/** 利用者が選んだこと。 */
export type LossChoice = 'save' | 'discard' | 'cancel'

/**
 * 「すべて保存」が通らなかったときの結末（Session 4-5B）。
 *
 * 文言ではなく結末を持ち、言い表すのは描くとき ── 確認を出したまま言語を
 * 切り替えたときに、前の言語のまま取り残されないようにする。
 */
export type UnsavedSaveFailure = 'save-failed'
