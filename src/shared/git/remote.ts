/**
 * remote の一覧（Session 3-8-16）。
 *
 * ## repository.ts / branch.ts / stash.ts との分担
 *
 * repository.ts が「始められるか」、branch.ts が「どこへ切り替えられるか」、
 * stash.ts が「今どこかへ避けてあるもの」を持つのに対し、こちらは
 * **「送り先 / 受け取り先として何が登録されているか」**だけを持つ。
 *
 * ## 3-8-10 で `hasRemote` に絞った判断を、撤回はしていない
 *
 * `GitRepositoryState.ready` が持っているのは今も**有無だけ**で、名前も URL も
 * 載っていない（shared/git/repository.ts）。そこは1文字も動かさない ──
 * あちらは**パネルが開いている間ずっと**画面を決めている値で、
 * ファイルを保存するたびに読み直されるためになる。
 *
 * こちらは branch.ts / stash.ts と同じ側にあたる ── 見られているのは
 * **remote の面を開いている間だけ**で、閉じている間は一度も取りに行かない。
 * `hasRemote` が「公開の入口を出すか」を決め、この一覧が「何が登録されて
 * いるか」を出す、という分担になる。
 *
 * ## Renderer へ渡すのは、URL ではなく**表示用のラベル**
 *
 * ここがこのファイルのいちばん大きな決めごとになる。remote の URL は
 * **リポジトリ root の絶対パスと同じ性質**を持つ（shared/git/repository.ts の
 * 冒頭）── 渡せば、Renderer がそれを指して何かを頼みたくなる。
 *
 *   URL を渡す  … 「この URL で clone して」「この URL に set-url して」の
 *                  欄が欲しくなる。そして URL は **git に任意のプログラムを
 *                  起動させうる値**にあたる（`ext::sh -c ...` は実在する形で、
 *                  git は今も受け取る。実物で確かめてある）
 *   ラベルを渡す … 「どこを指しているか」は読めるが、**それを送り返しても
 *                  URL にはならない**（`.git` も port も認証情報も落ちている）
 *
 * 作るのは Main（main/git/gitRemoteLabel.ts）で、shared にはその**結果の型**
 * しか置かない ── URL を組み立て直せる材料を、境界のこちら側に1つも置かない
 * ため。ラベルの作り方を shared に置くと、Renderer が同じ関数を持つことになり、
 * 「逆はできない」と言い切る根拠がその関数の中身に移ってしまう。
 *
 * ## 「今どれが使われているか」も載せない
 *
 * Push / Pull の送り先を決めるのはリポジトリの設定で、それを読むのは Main に
 * なる（shared/ipc/contracts/git.ts）── 一覧に「これが使われます」と出すと、
 * その隣に「これを使う」を置きたくなる。3-8-5 から引いている
 * 「送り先を名前で指せる欄を作らない」線を、一覧の側からも崩さない。
 *
 * shared 層のルールどおり、このファイルは型と定数だけを持つ。
 */

/**
 * remote 1件。
 *
 * ## 持っているのは名前とラベルだけ
 *
 * `GitLocalBranch` が名前と「今そこに居るか」だけを持つのと同じ考え方で、
 * **画面に出ないものは載せない。** fetch と push で URL が違う場合も、
 * 載せるのは fetch 側から作ったラベル1つになる（push 側だけを変える口を
 * 持っていない以上、2つ並べても読む人にできることが無い。
 * docs/ARCHITECTURE.md §14.24）。
 */
export interface GitRemote {
  /**
   * remote 名（`origin` など）。
   *
   * **これは境界を往復する唯一の値**にあたる ── 削除の要求に載るのは
   * この名前で、Main は受け取った後に同じ規則（shared/git/remoteName.ts）を
   * 通してから git の引数に置く。ブランチ名とまったく同じ扱いになる。
   */
  readonly name: string
  /**
   * どこを指しているかの**表示用のラベル**（URL ではない）。
   *
   * 例: `github.com/octocat/Hello-World`
   *
   * scheme も認証情報も port も `.git` も落ちている ── つまり
   * **この文字列から URL は組み立て直せない。** 作るのは Main で、
   * 作り方は main/git/gitRemoteLabel.ts にだけ在る。
   *
   * 読めない形の URL（Main が知らない scheme・壊れた行）でも、空欄には
   * しない ── 空の行は「読み込みに失敗した行」と見分けが付かない
   * （`GitStashEntry.subject` と同じ判断）。
   */
  readonly label: string
}

/**
 * 一覧に載せる remote の上限。
 *
 * remote は普通1つか2つ（`origin` と fork 元）で、10 を超える使い方は
 * 珍しい ── それでも上限を置くのは、ブランチ・履歴・退避とまったく同じ理由に
 * よる。**IPC を渡る配列の長さがリポジトリ次第で決まる形にしない。**
 *
 * 100 は履歴（`GIT_COMMIT_HISTORY_LIMIT`）・退避（`GIT_STASH_LIMIT`）と
 * 同じ数にしてある ── **別の数にする理由が無い**ものを別にすると、
 * どれがどれだったかを覚えることになる。
 *
 * 超えた分は**黙って捨てない** ── 切れていることを `truncated` として返し、
 * 画面にもそう出す（renderer/src/git/gitRemotes.ts）。
 */
export const GIT_REMOTE_LIMIT = 100

/**
 * 一覧を尋ねた結果。
 *
 * ## 失敗も「状態」として持つ（3-8-1 からの続き）
 *
 * 読めなかったことを `IpcResult` の失敗にしない。開いた面の中に
 * 「取得できませんでした」と出せばよいものであって、汎用のエラー文言に
 * 丸めると、利用者は**その面のどこを見ればよいか**を失う
 * （shared/git/repository.ts）。
 *
 * ## 1つも無いことは、`ready` の空になる
 *
 * `git remote --verbose` は remote が1つも無くても 0 で終わり、何も出さない
 * （実物で確かめてある）── したがってここに分岐は要らず、空はそのまま
 * 「まだ1つも登録していない」という正しい答えになる（退避と同じ側）。
 */
export type GitRemoteListing =
  | {
      readonly status: 'ready'
      /** git が返した順（remote 名の辞書順）のまま。 */
      readonly remotes: readonly GitRemote[]
      /** 上限（`GIT_REMOTE_LIMIT`）で切ったか。 */
      readonly truncated: boolean
    }
  /** もう一覧を出せる状態ではない（Workspace が閉じられた・リポジトリでなくなった）。 */
  | { readonly status: 'not-ready' }
  /** git を動かせた／動かせなかったに関わらず、一覧として読めなかった。 */
  | { readonly status: 'failed' }
