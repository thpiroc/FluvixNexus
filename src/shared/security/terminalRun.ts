/**
 * FN Agent の Terminal の提案と結果を、画面に出すための形（Security Core v1 の STEP8）。
 *
 * Main と Renderer の**両方**が読む。中身はすべて Main が Secret を伏せ、見えない
 * 文字を取り除き、切った後の**表示用の値**で、実行する exact な argv でも raw な
 * 出力でもない。**ここから実行へ戻る経路は無い**（実行するのは Main が持ち続けている
 * command / args / cwd）。
 */

/** 実行を提案されたコマンド（表示用）。 */
export interface SafeTerminalCommandDisplay {
  /** Mask 済みのコマンド名。 */
  readonly commandName: string
  /** Mask 済みの引数（数も並びも実行するものと同じ・切らない）。 */
  readonly commandArgs: readonly string[]
  /** Mask 済みの1行（承認の知らせの `commandSummary` と同じ文字列）。 */
  readonly commandSummary: string
  /** Workspace 相対の作業ディレクトリ（root は `null`）。 */
  readonly workspacePath: string | null
  /** .cmd / .bat（cmd.exe を通して起動する）か。 */
  readonly viaBatch: boolean
  /** Secret を1つ以上伏せたか。 */
  readonly secretMasked: boolean
}

/** 画面に出す出力（伏せた後の末尾）。 */
export interface SafeTerminalOutputDisplay {
  /** 表示する行（末尾から最大 200 行・1行 300 文字まで）。 */
  readonly lines: readonly string[]
  /** 行数・1行の長さ・集める上限のどれかで切ったか。 */
  readonly truncated: boolean
  /** Secret を1つ以上伏せたか。 */
  readonly secretMasked: boolean
  /** 検査できなかったため、出力を表示しないか。 */
  readonly withheld: boolean
}

/** 実行した結果の種類。 */
export type TerminalRunStatus = 'completed' | 'timed-out' | 'failed'

/** 実行した結果（表示用）。**実行しなかった場合は届かない**（`null`）。 */
export interface SafeTerminalRunResult {
  readonly status: TerminalRunStatus
  /** 終了コード（終了していない・取れなければ `null`）。 */
  readonly exitCode: number | null
  readonly output: SafeTerminalOutputDisplay
}
