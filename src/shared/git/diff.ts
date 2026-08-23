/**
 * 変更1件の中身を「前」と「後」の2つの文字列として見せるための型（Session 3-8-9）。
 *
 * ## status.ts との分担
 *
 * status.ts が答えるのは「**何が**変わっているか」（位置と種類）で、
 * こちらが答えるのは「**どう**変わっているか」になる。前者は Git パネルが
 * 開いている間ずっと出ているが、後者は利用者が1行を選んだ一瞬しか見られない ──
 * だから `ready` の中に相乗りさせず、別のチャンネルで取りに行く
 * （ブランチの一覧を `git:get-repository` に載せていないのと同じ理由）。
 *
 * ## patch（unified diff）の文字列を渡さない
 *
 * `git diff` の出力をそのまま Renderer へ渡す形にはしない。理由は3つある。
 *
 *   - **生の git の出力を渡さない**という 3-8-1 からの線に触れる。patch には
 *     ヘッダ（`diff --git a/... b/...`）・モード・スコア・index 行と、
 *     git の記法がそのまま載る
 *   - 渡した先で**もう一度解析が要る。** Monaco の Diff Editor が受け取るのは
 *     2つの中身であって patch ではない。patch を渡すと、Renderer 側に
 *     「patch を当てて元の中身を復元する」という2つ目の実装が生まれる
 *   - patch は**差分アルゴリズムの結果**で、`diff.algorithm` / `diff.context` /
 *     `textconv` などリポジトリの設定で形が変わる。中身2つを渡せば、
 *     どう並べて見せるかは Monaco が一貫して決める
 *
 * したがって Main が渡すのは「左に出す中身」と「右に出す中身」の2つだけで、
 * どこが変わったかを決めるのは Renderer（Monaco）になる。
 *
 * ## 改行は LF に均してある
 *
 * Windows の git は checkout のときに改行を CRLF へ直す（`core.autocrlf`）。
 * index の中身（LF）と作業ツリーの中身（CRLF）をそのまま並べると、
 * **1行も書き換えていないファイルが全行変更として出る。**
 *
 * git 自身は正規化した後の中身で変わったかどうかを決めているため、
 * 一覧に出ている「変わっている」と揃えるには、こちらも均した中身で
 * 見せる必要がある。代わりに**改行だけの違いは差分として出ない**
 * ── その1点は失うが、全行が真っ赤になるより実態に近い。
 *
 * shared 層のルールどおり、このファイルは型だけを持つ。
 */

import type { GitChangeKind } from './status'

/**
 * どのグループの1行を見ているか。
 *
 * `conflicted` が無いのは、**衝突は今回の対象外**だから（DESIGN.md）。
 * 衝突しているファイルには「前」と「後」が2組（ours / theirs）あり、
 * 2つの中身を並べる形そのものが当てはまらない。解決の UI と一緒に設計する。
 *
 * グループが要るのは、**同じファイルが2つのグループに並びうる**ため
 * （`git add` した後にもう一度書き換えた状態）。位置だけを渡すと、
 * どちらの差分を見たいのかが決まらない。
 */
export type GitDiffGroup = 'staged' | 'unstaged' | 'untracked'

/**
 * 差分を出せなかった理由。
 *
 * `GitOperationFailureReason`（operation.ts）と別の型にしてある ── あちらは
 * **リポジトリを書き換えようとして通らなかった**の分類で、こちらは
 * 何も書き換えていない読み取りの結末になる。混ぜると「破棄が失敗した」と
 * 「差分が出せない」が同じ文言の表に並ぶ。
 */
export type GitDiffUnavailableReason =
  /**
   * もう調べられる状態ではない。
   *
   * Workspace が閉じられた・リポジトリでなくなった・root が食い違うように
   * なった。Git パネル自体が案内へ切り替わるため、差分の側は黙って閉じてよい。
   */
  | 'not-ready'
  /**
   * 開いてから取りに行くまでの間に、その行がそのグループから消えた。
   *
   * 端末で `git add` / `git restore` した・ファイルが消えた、が当たる。
   * **他のグループへ移っていても not-found** にする ── 押したのは
   * 「この行の差分」であって「このファイルのどこかの差分」ではない。
   */
  | 'not-found'
  /**
   * その行が差分の対象にならない。
   *
   * 未追跡のフォルダ1件（`node_modules/` のように中身ごと1行で出るもの）が
   * これにあたる。開くファイルが決まらないため、中身を2つ用意できない。
   */
  | 'unsupported-target'
  /** どちらかの側がバイナリだった（`shared/files/content.ts` と同じ判断）。 */
  | 'binary'
  /** どちらかの側が大きすぎた（Editor で開ける上限と同じ値）。 */
  | 'too-large'
  /** git の出力を読み取れなかった。 */
  | 'unreadable'
  /** 上記のいずれにも当てはまらない（git が動かなかった・権限など）。 */
  | 'failed'

/**
 * 1件の差分。
 *
 * **左右のラベルは載せない。** 何を左に出しているか（HEAD / index / 作業ツリー）は
 * `group` と `kind` から決まり、それを言葉にするのは画面の側の仕事になる
 * （renderer/src/git/gitDiff.ts）── 2つの経路で同じことを伝えると、
 * 片方だけが古い形が生まれる（`GitOperationOutcome` と同じ判断）。
 */
export type GitFileDiff =
  | {
      readonly status: 'ready'
      /** どの行の差分か（要求した位置がそのまま返る）。 */
      readonly relativePath: string
      /** rename / copy の元の位置。それ以外は null。 */
      readonly originalPath: string | null
      readonly group: GitDiffGroup
      readonly kind: GitChangeKind
      /**
       * 左に出す中身（変更の**前**）。
       *
       * 追加・未追跡・初回 commit 前のステージ済みでは空文字になる ──
       * 「比べる相手が無い」を null で表さないのは、Monaco へ渡すときに
       * どのみち空文字へ倒すことになり、**空のファイル**と区別する意味も
       * ここには無いため（種類は `kind` が別に持っている）。
       */
      readonly original: string
      /** 右に出す中身（変更の**後**）。削除では空文字になる。 */
      readonly modified: string
    }
  | { readonly status: 'unavailable'; readonly reason: GitDiffUnavailableReason }
