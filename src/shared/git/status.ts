/**
 * 作業ツリーの「今どこが変わっているか」（Session 3-8-2）。
 *
 * ## repository.ts との分担
 *
 * repository.ts が答えるのは「Git 操作を**始められるか**」で、こちらが答えるのは
 * 「始められるとして、**何が変わっているか**」になる。前者が `ready` に
 * ならない限り後者は存在しないため、状態としても `ready` の中に入れてある
 * （2つを別々に問い合わせる形にしない ── ブランチ名と変更一覧が別の瞬間の
 * 写しになると、画面の上下で食い違ったものが並ぶ）。
 *
 * ## ここに git の言葉を持ち込まない
 *
 * Main が読むのは `git status --porcelain=v2` の出力だが、その記法
 * （`XY` の2文字・`1` / `2` / `u` / `?` のレコード種別・スコア付きの `R100`）は
 * ここには出てこない。**Renderer へ渡すのは分類だけ**で、生の出力も、
 * それを組み立てたコマンド文字列も渡らない（shared/git/repository.ts と同じ線）。
 *
 * 読み替えを Main に閉じてあるので、porcelain の版が変わっても直すのは
 * main/git/gitStatusOutput.ts だけになる。
 *
 * ## path は Workspace root からの相対位置
 *
 * git は区切りを常に `/` で返し、Workspace root ＝ リポジトリ root でなければ
 * `ready` にならない（ARCHITECTURE.md §14.4）。したがってここに載る path は
 * そのまま Files / Editor が使う relativePath（shared/files/entry.ts）と同じ形になり、
 * **Git 専用のファイルの開き方を作らずに済む。**
 *
 * shared 層のルールどおり、このファイルは型だけを持つ。
 */

import type { GitConflictShape } from './conflictDiff'

/**
 * 変更1件の種類。
 *
 * git の `XY` は2文字で「index 側」と「作業ツリー側」を同時に表すが、ここでは
 * **1件 ＝ 1つの種類**にしてある。同じファイルが index でも作業ツリーでも
 * 変わっている（`MM`）場合は、staged と unstaged に1件ずつ並ぶ ── 利用者から見て
 * それは「2箇所で別々に扱えるもの」であり、1行に畳むと片方だけを戻す判断
 * （Session 3-8-3 の Unstage）が行の上で表せなくなる。
 */
export type GitChangeKind =
  /** 新しく index に載った。 */
  | 'added'
  /** 中身が変わった。 */
  | 'modified'
  /** 消えた。 */
  | 'deleted'
  /** 位置が変わった（`originalPath` に元の位置が入る）。 */
  | 'renamed'
  /** 複製された（同上）。 */
  | 'copied'
  /** ファイルと symlink の入れ替わりなど、中身ではなく種別が変わった。 */
  | 'type-changed'
  /** まだ Git が知らない（`.gitignore` で除外されているものはここにも出ない）。 */
  | 'untracked'
  /**
   * 併合で衝突していて、まだ解決されていない。
   *
   * staged / unstaged のどちらにも入れていないのは、**その2つの操作が
   * 成立しない**ため。解決するまで Stage も Unstage も意味を持たない
   * （解決の UI そのものは Session 3-8-2 の範囲外）。
   */
  | 'conflicted'

/** 変更されたファイル1件。 */
export interface GitFileChange {
  /**
   * Workspace root からの相対位置（区切りは `/`）。
   *
   * rename / copy では**変更後**の位置が入る。利用者が今開けるのはそちらで、
   * 元の位置はもう存在しない。
   */
  readonly relativePath: string
  readonly kind: GitChangeKind
  /**
   * rename / copy の元の位置。それ以外は null。
   *
   * 行に「どこから来たか」を出すためだけに持つ。**別の1行として並べない** ──
   * 1つの変更が2行に見えると、件数と実際の変更の数が食い違う。
   */
  readonly originalPath: string | null
  /**
   * その位置がフォルダそのものを指すか。
   *
   * `--untracked-files=normal` は、中身がすべて未追跡のフォルダを
   * **1件のフォルダとして**返す（`node_modules/` を1行で済ませるための挙動で、
   * 数万件の行を作らないためにこの mode を選んでいる）。
   * フォルダは Editor で開けないため、行の側がそれを知る必要がある。
   */
  readonly directory: boolean
  /**
   * 競合の形（`kind` が `conflicted` のときだけ。それ以外は null。
   * Session 3-8-22A）。
   *
   * ## 3-8-2 が「内訳では分けない」と書いたところへ、後から足している
   *
   * 3-8-2 の判断は「どの形であっても利用者が次に取る行動は同じ（解決してから
   * Stage する）」だった。その前提が崩れたのが **`both-deleted`（`DD`）**に
   * なる ── 左にも右にも中身が無い形で、**作業ツリーにファイルそのものが
   * 存在しない**（実物で確かめてある。rename / rename の競合で作れる）。
   *
   * 行に出していた「エディタで開く」は、そこだけ**押しても開けない**
   * ことになる。3-8-2 から「押しても何も起きないボタンを置かない」と
   * 書いてきた線が、この1つの形でだけ破れていた。
   *
   * ## `git status` の `XY` から読む
   *
   * porcelain v2 の unmerged レコードは形を `XY` の2文字で持っている
   * （`DD` / `AU` / `UD` / `UA` / `DU` / `AA` / `UU`）── 3-8-2 の時点でも
   * 読めていた値を、捨てずに持ち帰るだけになる（git を1回も増やさない）。
   *
   * ## 3-8-21 の `GitConflictFileDiff.shape` と同じ型を使う
   *
   * あちらは index の段（`ls-files -u` の 1 / 2 / 3）から導いており、
   * こちらは `XY` から導く。**出どころは違うが、答えは同じもの**にあたる
   * （どちらも「どの段が在るか」の言い換えで、git が両方を同じ index から
   * 作っている。7 通りすべてで一致することを実物で確かめてある）。
   *
   * 別の型を作ると、同じ競合が一覧と差分の面で違う名前で呼ばれることになる。
   *
   * ## 作業ツリーのファイルの有無を、モードからは読まない
   *
   * porcelain v2 の unmerged レコードには作業ツリー側のモード（`mW`）が
   * 載っているが、**ファイルが無くても 100644 が入る**（rename / delete の
   * 競合で確かめてある）── 「開けるか」の判断には使えない。
   * 開けないのは `both-deleted` だけ、という形の側で決める。
   */
  readonly conflictShape: GitConflictShape | null
}

/**
 * 変更ファイルの一覧を、利用者が取れる操作ごとに分けたもの。
 *
 * 並びは git が返した順（＝ path 順）をそのまま保つ。並べ替えを足さないのは、
 * **更新のたびに行が動くと、押そうとしていた行が入れ替わる**ため。
 */
export interface GitWorkingTreeChanges {
  /** Commit すれば入るもの。 */
  readonly staged: readonly GitFileChange[]
  /** 作業ツリーにあるが、まだ Stage されていないもの。 */
  readonly unstaged: readonly GitFileChange[]
  /** Git がまだ知らないもの。 */
  readonly untracked: readonly GitFileChange[]
  /** 併合の衝突が残っているもの。 */
  readonly conflicted: readonly GitFileChange[]
}

/**
 * upstream（追跡先）との進み具合。
 *
 * upstream が設定されていなければ、そもそもこの値を持たない（`null`）──
 * 「0 / 0」で表すと、**同期済み**と**比べる相手が無い**が同じ表示に潰れる。
 */
export interface GitUpstreamStatus {
  /** 追跡先の名前（`origin/main`）。 */
  readonly name: string
  /**
   * upstream より進んでいる commit の数。
   *
   * upstream が設定されているのにその ref が手元に無い（clone 直後の一部・
   * remote 側で消された）場合、git は差を答えない。**0 に倒さず null**にする ──
   * 「送るものは無い」と「分からない」は利用者にとって別の意味になる。
   */
  readonly ahead: number | null
  /** upstream より遅れている commit の数（同上）。 */
  readonly behind: number | null
}
