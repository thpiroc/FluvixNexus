/**
 * 競合している1件を「ours の中身」と「theirs の中身」として見せるための型（Session 3-8-21）。
 *
 * ## diff.ts と別の型にしてある
 *
 * 3-8-9 の `GitFileDiff` が答えるのは「**その1行が、前と後でどう違うか**」で、
 * こちらが答えるのは「**2つの側が、互いにどう違うか**」になる。前者には
 * 時間の向き（前 → 後）があり、後者には無い ── 左が古くて右が新しい、では
 * ない。同じ型に畳むと、`group` も `kind` も意味を持たない値として
 * 載ることになる。
 *
 * `shared/git/diff.ts` は「衝突は今回の対象外」と書き、その理由を
 * **「前」と「後」が2組（ours / theirs）あるから**としていた。3-8-21 は
 * その診断をそのまま受けて、**組を1つ選ぶ**形にしてある ── 並べるのは
 * stage 2（ours）と stage 3（theirs）の2つで、stage 1（merge base）は
 * 載せない（下記）。
 *
 * ## base（stage 1）は載せない
 *
 * 競合の index には3段ある。それを3面で見せる形（3-way diff）は、
 * 器そのものが違う ── Monaco の Diff Editor が受け取るのは2つの中身で、
 * 3つを並べるには面も部品も別に要る。3-8-21 が使うのは 3-8-9 から在る
 * 2ペインの器そのままで、**base を持たないことを型で言い切ってある。**
 *
 * 3-way は後続のセッションへ回す ── そのとき増えるのはこの型の欄ではなく、
 * 別のチャンネルと別の面になる（`git:get-file-diff` に競合を混ぜなかったのと
 * 同じ判断。shared/ipc/contracts/git.ts）。
 *
 * ## 左右のラベルも、片側が無いことも、ここには載せない
 *
 * `GitFileDiff` が左右のラベルを載せていないのと同じ理由になる ── 何を左に
 * 出しているかは `shape` から決まり、それを言葉にするのは画面の側の仕事に
 * あたる（renderer/src/git/gitDiff.ts の `describeGitConflictDiffSides`）。
 * 2つの経路で同じことを伝えると、片方だけが古い形が生まれる。
 *
 * とくに**片側にファイルが無いこと**（`DD` / `AU` / `UA` / `UD` / `DU`）は、
 * `shape` から一意に決まる ── 別の boolean を2つ足すと、`shape` と食い違う
 * 組み合わせが型の上で作れてしまう。
 *
 * ## 改行は LF に均してある
 *
 * 両側とも index の object から読むため `core.autocrlf` は効かないが、
 * 通す関数は 3-8-9 と同じ（main/git/gitDiffSide.ts の `normalizeGitLineEndings`）
 * にしてある ── **中身を作る道が1本しか無い**ことを保つため。
 *
 * shared 層のルールどおり、このファイルは型だけを持つ。
 */

import type { GitDiffUnavailableReason } from './diff'

/**
 * 競合の形。
 *
 * git の `git status --short` が `XY` の2文字で表しているもの（`UU` / `AA` /
 * `UD` / `DU` / `DD` / `AU` / `UA`）を、**分類として**持つ。3-8-2 からの線
 * どおり git の記法そのものは Renderer へ渡さない（shared/git/status.ts）。
 *
 * ## `GitFileChange` にも `GitChangeKind` にも載せない
 *
 * 一覧（`git:get-repository`）が答えるのは「**何が**競合しているか」までで、
 * 「**どういう形で**競合しているか」はここでしか答えない。理由は 3-8-9 が
 * 差分を状態に相乗りさせなかったのとまったく同じ**「見られている時間」**に
 * なる ── 形が要るのは、利用者が1行の競合差分を開いた一瞬だけにあたる。
 *
 * 一覧に載せると、競合が1件でもある間は**状態を読み直すたびに全件ぶんの
 * stage を読む**ことになる（`.git` が動くたびに走る。§14.15）。
 *
 * ## 判定は index の段の在り方だけで決まる
 *
 * `git status` の `XY` を読み直しているのではなく、`ls-files --stage` に
 * どの段が返ったかで決める（main/git/gitBlob.ts）── 段の組み合わせと
 * `XY` は1対1に対応する。段は**中身を読むためにどのみち要る**ので、
 * 形のために git を1回増やしていない。
 */
export type GitConflictShape =
  /** 両方で中身が変わった（`UU`）。段は 1 / 2 / 3 が揃う。 */
  | 'both-modified'
  /** 両方で新しく追加された（`AA`）。共通の元（base）が無い。 */
  | 'both-added'
  /** ours では変わり、theirs では消えた（`UD`）。右にファイルが無い。 */
  | 'deleted-by-them'
  /** ours では消え、theirs では変わった（`DU`）。左にファイルが無い。 */
  | 'deleted-by-us'
  /**
   * 両方で消えた（`DD`）。**左にも右にもファイルが無い。**
   *
   * 中身が1つも無いのに競合として残るのは、消し方が食い違った場合
   * （片方が rename、片方が削除）に起こる。**それでも差分の口は開ける** ──
   * 開いた先で「どちらにも無い」と読めることが、押しても何も起きない
   * ボタンより手掛かりになる（docs/ARCHITECTURE.md §14.29）。
   */
  | 'both-deleted'
  /** ours だけが追加した（`AU`）。右にファイルが無い。 */
  | 'added-by-us'
  /** theirs だけが追加した（`UA`）。左にファイルが無い。 */
  | 'added-by-them'

/**
 * 競合1件の中身2つ。
 *
 * 欄の名前を `GitFileDiff` / `GitCommitFileDiff` と揃えてある（`original` /
 * `modified`）── 面の側（GitDiffOverlay.tsx）が3つの入口を同じ形で読める
 * ようにするため。**中身の意味は違う**（前と後ではなく、ours と theirs）が、
 * それを言葉にするのは `shape` を受け取った画面の側になる。
 *
 * 出せなかった理由の表は 3-8-9 のものをそのまま使う
 * （`GitDiffUnavailableReason`）── バイナリ・2MB 超・見つからない・
 * submodule のどれも、利用者の次の一手は差分のときと同じにあたる。
 * 競合のためだけの理由は増やしていない。
 */
export type GitConflictFileDiff =
  | {
      readonly status: 'ready'
      /** どの行の競合か（要求した位置がそのまま返る）。 */
      readonly relativePath: string
      /** 競合の形。左右に何が入っているかは、これだけで決まる。 */
      readonly shape: GitConflictShape
      /**
       * 左に出す中身（stage 2 ＝ ours）。
       *
       * その側にファイルが無い形（`deleted-by-us` / `added-by-them` /
       * `both-deleted`）では空文字になる。**空のファイルと区別する必要は
       * `shape` が引き受ける** ── 3-8-9 が「比べる相手が無い」を null で
       * 表さなかったのと同じ判断で、Monaco へ渡すときにどのみち空文字へ倒す。
       */
      readonly original: string
      /**
       * 右に出す中身（stage 3 ＝ theirs）。
       *
       * その側にファイルが無い形（`deleted-by-them` / `added-by-us` /
       * `both-deleted`）では空文字になる。
       */
      readonly modified: string
    }
  | { readonly status: 'unavailable'; readonly reason: GitDiffUnavailableReason }
