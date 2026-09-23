/**
 * Renderer へ見せる「安全な Diff」の型（Security Core v1 の STEP7）。
 *
 * Main と Renderer の**両方**が読む。Renderer は承認の画面で変更の内容を出すため、
 * 行の並びの読み方だけを shared に置く。
 *
 * ## ここにあるのは表示用の Diff だけ
 *
 * この型に載るのは、Main が
 *
 *   1. 現在の中身（既存ファイル）と提案された中身から行の差分を作り
 *   2. 1行ずつ STEP3 の Mask を通して Secret を伏せ
 *   3. 制御文字を潰し、長さと行数で切った
 *
 * 後の文字列になる。**実際に書く中身は別で、こちらは1バイトも Write に使われない**
 * （書くのは Main が持つ exact な提案本文で、承認の binding もそちらから作る）。
 * Renderer から Diff を送り返して書かせる経路は無い（型にも無い）。
 *
 * ## Diff を Renderer / Agent が作らない
 *
 * Diff を Security の真実にしない、という線とは別に、**作る側も Main に寄せる。**
 * Agent や Renderer が作った Diff を見せると、「画面に出た変更」と「実際に書かれる
 * 変更」が別々の計算から生まれることになり、一致を確かめる術が無くなる。
 */

/** 行1つの種別。 */
export type SafeDiffLineKind = 'context' | 'added' | 'removed'

/** 表示する行1つ。**中身は Mask 済み・制御文字を潰した後の文字列。** */
export interface SafeDiffLine {
  readonly kind: SafeDiffLineKind
  /** 変更前の行番号（1 始まり）。追加された行は `null`。 */
  readonly oldLine: number | null
  /** 変更後の行番号（1 始まり）。消された行は `null`。 */
  readonly newLine: number | null
  /** 表示する文字列。 */
  readonly text: string
}

/** 表示用の Diff 1件。 */
export interface SafeFileWriteDiff {
  readonly lines: readonly SafeDiffLine[]
  /** 追加された行数（切る前の数）。 */
  readonly addedCount: number
  /** 消された行数（切る前の数）。 */
  readonly removedCount: number
  /** 行数の上限で後ろを落としたか。 */
  readonly truncated: boolean
  /** Secret を1つ以上伏せたか（利用者へ「一部を伏せている」と伝えるため）。 */
  readonly secretMasked: boolean
}
