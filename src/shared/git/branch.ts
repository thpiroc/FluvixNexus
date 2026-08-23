/**
 * ローカルブランチの一覧（Session 3-8-6）。
 *
 * ## repository.ts / status.ts / operation.ts との分担
 *
 * repository.ts が「始められるか」、status.ts が「何が変わっているか」、
 * operation.ts が「それを動かす」を持つのに対し、こちらは
 * **「どこへ切り替えられるか」**だけを持つ。
 *
 * `GitRepositoryState` の `ready` に**入れていない**のが、このファイルを
 * 分けている理由になる。変更ファイルの一覧は `ready` の中に入れた
 * （Session 3-8-2）が、それは**画面に出したままにするもの**で、
 * 一覧とブランチ名が別の瞬間の写しになると上下で食い違うためだった。
 *
 * ブランチの一覧はそうではない ── 出るのは利用者がブランチの一覧を
 * 開いた瞬間だけで、閉じている間は誰も見ていない。`ready` に入れると
 * **状態を読むたびに（保存のたびに）ブランチを数え直す**ことになり、
 * ブランチが数百あるリポジトリでは、誰も見ていない一覧のために
 * git を1回多く起動し続けることになる。
 *
 * ## 対象はローカルブランチだけ
 *
 * remote-tracking branch（`origin/main`）は載せない。載せると
 * 「選んだら手元にブランチが作られる」という、**一覧を見ただけでは
 * 分からない副作用**が1行おきに混ざることになる（git の `switch` は
 * 既定でそれを行う。Main はその推測を止めてある。main/git/gitCommands.ts）。
 *
 * remote のブランチから始める形は、remote を指せる欄と一緒に別途設計する
 * （docs/ARCHITECTURE.md §14.15）。
 *
 * shared 層のルールどおり、このファイルは型と定数だけを持つ。
 */

/**
 * ローカルブランチ1件。
 *
 * **持っているのは名前と、今そこに居るかだけ。** commit のハッシュも、
 * 最終更新の日時も、追跡先も載せていない ── どれも「切り替える先を選ぶ」
 * ために要らないもので、載せれば git へ聞くことが増える（一覧を開くたびに
 * その回数だけ待たされる）。
 *
 * `current` を Renderer 側で `repository.head` と突き合わせて求めさせないのは、
 * その2つが**別の瞬間の写し**になりうるため。一覧は git に1回聞いた結果で、
 * 印もその同じ1回から出す。
 */
export interface GitLocalBranch {
  /** ブランチ名（`refs/heads/` を外した短い形）。 */
  readonly name: string
  /** HEAD が今このブランチを指しているか。 */
  readonly current: boolean
}

/**
 * 一覧に載せるローカルブランチの上限。
 *
 * ブランチが数千あるリポジトリは実在する（作業ブランチを消さない運用・
 * 自動生成されたブランチ）。上限を置かないと、選ぶための一覧が
 * **選べない長さ**になるだけでなく、IPC を渡る配列と Renderer が抱える
 * 要素の数がリポジトリ次第で決まることになる。
 *
 * 500 は「人が選ぶために眺める一覧」としては十分に多く、Main から Renderer へ
 * 渡すには十分に小さい。超えた分は**黙って捨てない** ── 一覧が切れていることを
 * `truncated` として返し、画面にもそう出す（renderer/src/git/gitBranches.ts）。
 * 黙って切ると、「あるはずのブランチが無い」を利用者が
 * 「消えた」と読むことになる。
 */
export const GIT_LOCAL_BRANCH_LIMIT = 500

/**
 * 一覧を尋ねた結果。
 *
 * ## 失敗も「状態」として持つ（3-8-1 からの続き）
 *
 * 一覧を読めなかったことを `IpcResult` の失敗にしない。開いた面の中に
 * 「取得できませんでした」と出せばよいものであって、汎用のエラー文言に
 * 丸めると、利用者は**その面のどこを見ればよいか**を失う
 * （shared/git/repository.ts）。
 *
 * `not-ready` を分けているのは、そこで言うことがまったく違うため ──
 * Workspace が閉じられた・リポジトリでなくなった場合、次に出るのは
 * 一覧ではなく Git パネルそのものの案内になる。
 */
export type GitBranchListing =
  | {
      readonly status: 'ready'
      /** git が返した順（refname 順）のまま。 */
      readonly branches: readonly GitLocalBranch[]
      /** 上限（`GIT_LOCAL_BRANCH_LIMIT`）で切ったか。 */
      readonly truncated: boolean
    }
  /** もう一覧を出せる状態ではない（Workspace が閉じられた・リポジトリでなくなった）。 */
  | { readonly status: 'not-ready' }
  /** git を動かせた／動かせなかったに関わらず、一覧として読めなかった。 */
  | { readonly status: 'failed' }
