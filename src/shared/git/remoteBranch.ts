/**
 * remote-tracking branch の一覧（Session 3-8-19）。
 *
 * ## branch.ts と別のファイルにしてある
 *
 * branch.ts が持つのは**「どこへ切り替えられるか」**（手元に既にあるもの）で、
 * こちらが持つのは**「どこから手元に持ってこられるか」**になる。3-8-6 の
 * branch.ts は、remote-tracking branch を載せない理由をこう書いていた ──
 *
 * > 載せると「選んだら手元にブランチが作られる」という、**一覧を見ただけでは
 * > 分からない副作用**が1行おきに混ざることになる
 *
 * その判断は 3-8-19 でも1文字も動かない。**混ぜないまま、別の一覧として足す** ──
 * こちらの一覧では、行を押しても切り替わらない（ローカル名を確かめる欄が開く）。
 * 1つの配列に両方を入れて種別の欄で見分ける形にしなかったのは、
 * まさにその「押したら何が起きるか」が行ごとに変わるためになる。
 *
 * ## 「一覧を取り直す」と「remote から取ってくる」は別のこと
 *
 * ここで返るのは、**手元の `refs/remotes/` に既にあるもの**だけになる。
 * 一覧を出す前に `git fetch` は動かさない（Session 3-8-19 の範囲外）──
 * 一覧を開く操作がネットワークへ出ると、開くたびに認証を求められうるうえ、
 * 「見るだけ」のつもりの1回が数十秒かかることになる（3-8-16 で remote の
 * 追加に `--fetch` を渡さなかったのと同じ線）。
 *
 * したがって、ここに出るのは**最後に fetch / pull した時点の写し**になる。
 * それを画面にそのまま書く（renderer/src/git/gitRemoteBranches.ts）──
 * 黙って古い一覧を出すと、「remote にあるはずのブランチが無い」を
 * 利用者が「消えた」と読む（3-8-6 で `truncated` を黙って切らなかったのと
 * 同じ判断）。
 *
 * shared 層のルールどおり、このファイルは型と定数だけを持つ。
 */

/**
 * remote-tracking branch 1件。
 *
 * ## 欄が2つあるのは、片方を Renderer で作れないから
 *
 * `GitLocalBranch` は名前1つ（と印）で足りたが、こちらは
 * **`origin/feature/x` から `feature/x` を切り出す**必要がある。
 * その切り出しは、**remote の名前の一覧を知っている側にしかできない** ──
 * remote 名には `/` を入れられる（shared/git/remoteName.ts が禁じていない）ため、
 * `up/stream/feature/x` の remote は `up/stream` かもしれず `up` かもしれない
 * （実物で確かめてある。git は `%(refname:lstrip=3)` で後者に切る）。
 *
 * したがって切り出すのは Main で、Renderer へは**切り出した後の2つ**が渡る。
 * Renderer に文字列を割らせる形にすると、remote 名に `/` を入れた1人の環境で
 * だけ既定値が壊れることになる（そして本人はそれを打ち直すしかない）。
 *
 * ## `remote` そのものは載せない
 *
 * `name` に既に入っている（`origin/feature/x` の前半がそれになる）。
 * 別の欄として渡すと、画面のどこにも出ないものが IPC を渡ることになり、
 * 「これで絞り込みたい」「これを指して fetch したい」という欄が
 * 欲しくなる ── 3-8-5 からの「remote を指せる欄を作らない」線は、
 * 3-8-16 が**登録簿を編集する口**でだけ緩めたもので、ここでは緩めない。
 */
export interface GitRemoteBranch {
  /**
   * remote-tracking branch の名前（`refs/remotes/` を外した短い形）。
   *
   * 例: `origin/feature/x`
   *
   * **これが境界を往復する値**にあたる ── 作成の要求に載るのはこの名前で、
   * Main は受け取った後に「本当に `refs/remotes/` の下に在るか」を
   * 確かめてから git の引数に置く（main/git/gitRemoteBranches.ts）。
   */
  readonly name: string
  /**
   * 手元に作るローカルブランチ名の**既定値**（`origin/` を外した形）。
   *
   * 例: `feature/x`
   *
   * 既定値であって、決まった名前ではない ── 利用者は開いた欄で変えられる
   * （renderer/src/git/GitBranchMenu.tsx）。**変えられることが要る**のは、
   * 同じ名前のローカルブランチが既にある場合に、打ち直す以外の道が
   * 無いためになる（アプリは上書きも削除も自動切替もしない。
   * shared/git/operation.ts の `branch-exists`）。
   */
  readonly branch: string
}

/**
 * 一覧に載せる remote-tracking branch の上限。
 *
 * ローカルブランチ（`GIT_LOCAL_BRANCH_LIMIT`）と**同じ 500** にしてある ──
 * 別の数にする理由が無いものを別にすると、どれがどれだったかを覚えることになる
 * （`GIT_REMOTE_LIMIT` を履歴・退避と同じ 100 に揃えたのと同じ判断）。
 *
 * remote-tracking branch はローカルより**多くなりやすい**（他の人が作った枝も
 * 全部並ぶ）が、それでも上限を上げていない ── 上げても「人が選ぶために眺める
 * 一覧」として選べる長さにはならず、IPC を渡る配列だけが長くなる。
 * 超えた分は黙って捨てず、切れていることを `truncated` として返す。
 */
export const GIT_REMOTE_BRANCH_LIMIT = 500

/**
 * 一覧を尋ねた結果。
 *
 * ## 形は `GitBranchListing` と同じにしてある
 *
 * 状態の分け方（`ready` / `not-ready` / `failed`）も、失敗を `IpcResult` の
 * 失敗にしない判断も、3-8-6 からそのまま引いている ── 一覧を出せなかった
 * ときに利用者が取れる手は「開き直す」しか無く、理由で次の一手が変わらない。
 *
 * ## 1つも無いことは `ready` の空になる
 *
 * remote が1つも設定されていない場合も、fetch を一度もしていない場合も、
 * `for-each-ref refs/remotes/` は 0 で終わって何も出さない（実物で確かめてある）──
 * どちらも失敗ではなく、正しい答えの1つにあたる。**その2つを型で分けない**のは、
 * 次の一手を画面の側が `hasRemote` から決められるためになる
 * （renderer/src/git/gitRemoteBranches.ts）。
 */
export type GitRemoteBranchListing =
  | {
      readonly status: 'ready'
      /** git が返した順（refname 順）のまま。symbolic HEAD は含まない。 */
      readonly branches: readonly GitRemoteBranch[]
      /** 上限（`GIT_REMOTE_BRANCH_LIMIT`）で切ったか。 */
      readonly truncated: boolean
    }
  /** もう一覧を出せる状態ではない（Workspace が閉じられた・リポジトリでなくなった）。 */
  | { readonly status: 'not-ready' }
  /** git を動かせた／動かせなかったに関わらず、一覧として読めなかった。 */
  | { readonly status: 'failed' }
