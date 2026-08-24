/**
 * GitHub への公開（Session 3-8-10）で、Renderer と Main が共有する型。
 *
 * ## git ドメインと分けてある理由
 *
 * ここまでの Git 機能（shared/git/）が相手にしていたのは、**この PC の中に
 * ある1つのフォルダ**だけだった。公開はそこから初めて外へ出る ──
 * 相手はネットワークの向こうのサービスで、別のコマンド（`gh`）と、
 * 別の認証（GitHub のログイン）を持つ。
 *
 * 混ぜると、Git パネルが立つかどうかの判断（shared/git/repository.ts）に
 * 「GitHub にログインしているか」が混ざり込む ── **GitHub を使わなくても
 * Commit / Branch / Diff / Stage / 破棄は使えなければならない**（設計判断）。
 * 型もチャンネルも別にしておけば、その線は形の上で保たれる。
 *
 * shared 層のルールどおり、このファイルは型だけを持つ。
 */

/**
 * 作る repository を誰が見られるか。
 *
 * **既定は `private`。** 公開の入口が「押したら世界中から見える」だと、
 * 押し間違いが取り返しのつかない結末（書きかけの鍵・社内のコードの流出）に
 * なりうる ── 後から公開へ変えるのは GitHub 側でいつでもできるが、
 * 一度出たものを無かったことにはできない。
 *
 * `internal`（Organization 内だけ）を並べていないのは、それが
 * **Organization を持っている人にしか意味を持たない**選択肢で、
 * 最初の1回の画面に3つ目として並べる理由が無いため。
 */
export type GitHubRepositoryVisibility = 'private' | 'public'

/**
 * GitHub CLI が今どういう状態か。
 *
 * ## 失敗ではなく状態として返す（3-8-1 からの線）
 *
 * gh が入っていない・ログインしていない、はどちらも
 * **公開の面が平常時に出す表示**にあたる。`IpcResult` の失敗にすると
 * 汎用のエラー文言に丸められ、「次に何をすればよいか」を出せなくなる
 * （shared/git/repository.ts と同じ判断）。
 *
 * ## 出す場所は2つある
 *
 * 面を開いた時点（`github:get-status`）と、公開を押した結果
 * （`GitOperationFailureReason` の `github-cli-missing` / `github-signed-out`）。
 * 同じことを2箇所で言うのは、**開いた後に状態が変わりうる**ため ──
 * 面を開いたまま `gh auth login` を済ませた人が、そのまま押せる必要がある。
 */
export type GitHubAvailability =
  /** gh があり、GitHub にログインできている。 */
  | { readonly status: 'ready' }
  /** この PC で `gh` を見つけられなかった。 */
  | { readonly status: 'cli-missing' }
  /** gh はあるが、GitHub アカウントが結び付いていない。 */
  | { readonly status: 'signed-out' }
  /**
   * gh を動かせたが、答えが得られなかった。
   *
   * 分類を細かくしない ── 利用者が取れる手は「もう一度試す」しか無く、
   * 理由で次の一手が変わらない（分類の粒度の基準は main/git/gitFailure.ts）。
   */
  | { readonly status: 'failed' }
