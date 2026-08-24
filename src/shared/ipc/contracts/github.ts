import type { GitOperationOutcome, GitRepositoryState } from '../../git'
import type { GitHubAvailability, GitHubRepositoryVisibility } from '../../github'

/**
 * github ドメインの IPC 契約（Session 3-8-10）。
 *
 * ## なぜ `git:*` に足さず、別のドメインを立てるか
 *
 * ここまでの `git:*` が相手にしていたのは、**この PC の中にある1つのフォルダ**
 * だけだった。公開はそこから初めて外へ出る ── 相手はネットワークの向こうの
 * サービスで、動かす実行ファイル（`gh`）も、認証の仕組み（GitHub のログイン）も
 * 別のものになる。
 *
 * 同じドメインに混ぜると、次の2つが起きる。
 *
 *   - **git ドメインの前提が変わる。** 「git が入っていれば使える」だったものが
 *     「gh のログイン状態も見る」になり、GitHub を使わない人の Commit / Branch /
 *     Diff にまで別の失敗が混ざりうる
 *   - **差し替えの単位が消える。** repository を作る相手は将来 GitHub 以外にも
 *     なりうる（設計判断 12）。ドメインが分かれていれば、その境界は
 *     チャンネル1本とその実装の差し替えで済む
 *
 * ## 3-8-1 の線は1mm も動かさない
 *
 * `gh` のコマンド名も引数も作業ディレクトリも、**要求に欄そのものが無い。**
 * 載るのは利用者が打った repository 名1つと、閉じた集合である公開範囲だけになる
 * （shared/ipc/contracts/git.ts の Stage / Commit とまったく同じ形）。
 *
 * `gh` は `--template` / `gh alias` / `GH_*` の設定で任意の振る舞いを持ちうるため、
 * 「gh の引数を渡せる API」は git のとき（`-c core.pager=...`）と同じく
 * **実質「任意のコマンドを実行できる API」**になる。危ないものを弾くのではなく、
 * 渡せる欄そのものを作らない。
 *
 * ## remote の URL は Renderer へ渡らない
 *
 * 作った repository の URL は Main の中だけに留まる（main/github/publishRepository.ts）。
 * リポジトリ root の絶対パスを渡していない（shared/git/repository.ts）のと同じ線で、
 * **渡せば Renderer がそれを指して何かを頼みたくなる** ── 名前は利用者が
 * 自分で打ったものなので、画面にはそれがそのまま在る。
 */

/**
 * GitHub CLI の状態を尋ねた答え（Session 3-8-10）。
 *
 * ## `workspaceId` が載らない
 *
 * 他のドメインの応答には必ず載せている（問い合わせている間に Workspace が
 * 切り替わりうるため）が、この答えは**Workspace に依らない** ── gh が
 * 入っているか、GitHub にログインしているかは PC の話で、どのフォルダを
 * 開いていても同じ答えになる。
 *
 * 載せない方を選んだのは、載せると受け手が「切り替わっていたら捨てる」を
 * 書くことになり、**捨てる意味の無い答えを捨てる**からになる。
 */
export interface GetGitHubStatusResponse {
  readonly availability: GitHubAvailability
}

/**
 * GitHub へ公開する要求（Session 3-8-10）。
 *
 * ## 載るのは2つだけ
 *
 *   名前     … 利用者が打った repository 名（shared/github/repositoryName.ts）
 *   公開範囲 … `private` / `public` の閉じた集合（既定は `private`）
 *
 * 載せない … 所有者（Organization）/ 説明文 / README / .gitignore / LICENSE /
 *            テンプレート / remote 名 / ブランチ名 / URL / 作業ディレクトリ
 *
 * **所有者を欄にしていない**のは、gh がログインしているアカウントを相手に
 * するのがこの操作の意味そのものだからになる。Organization を選ばせる形は、
 * 「どこに作られたか」を押す前に確かめる画面と一緒でなければ意味を持たない。
 *
 * **README / .gitignore / LICENSE を GitHub 側で作らせない**のも欄が無い
 * 理由の1つで、作らせると**手元に無い commit が remote に1つ載る** ──
 * その直後の初回 Push が必ず non-fast-forward で断られる（`push-rejected`）。
 * 公開の1回目でいちばん起こしてはいけない結末にあたる。
 */
export interface PublishGitHubRepositoryRequest {
  /** 作る repository の名前。 */
  readonly name: string
  /** 誰が見られるか。 */
  readonly visibility: GitHubRepositoryVisibility
}

/**
 * 公開の応答（Session 3-8-10）。
 *
 * ## 形は `GitOperationResponse` と同じにしてある
 *
 * 中身が同じ（どの Workspace か・操作後のリポジトリの状態・その1回の結末）で
 * あるだけでなく、**Renderer 側で同じ経路に載せる**ため
 * （renderer/src/git/useGitRepository.ts の `operate`）── 公開のためだけの
 * 別の道を作ると、二重の要求を止める仕組みも、応答に載っている状態を
 * そのまま使う決めごとも、そこだけ別に書くことになる。
 *
 * それでも**別の型として書いてある**のは、片方に欄を足したときに
 * もう片方まで黙って広がらないようにするため（`CommitGitChangesRequest` と
 * `CommitAndPushGitChangesRequest` を分けてあるのと同じ理由）。
 *
 * ## 作った repository の URL は載らない
 *
 * 載せない理由はこのファイルの冒頭のとおり。**成功したことは
 * `repository.hasRemote` が真になることで画面に出る** ── 公開の入口が消え、
 * Push / Pull の並びに変わる（shared/git/repository.ts）。
 */
export interface PublishGitHubRepositoryResponse {
  /** どの Workspace について答えたか。未選択なら null（他の応答と同じ理由）。 */
  readonly workspaceId: string | null
  /** **公開の後**のリポジトリの状態（失敗時も取り直したもの）。 */
  readonly repository: GitRepositoryState
  /** その1回の公開がどうなったか。 */
  readonly outcome: GitOperationOutcome
}

export interface GitHubIpcContract {
  /**
   * GitHub CLI が使える状態かを尋ねる（Session 3-8-10）。
   *
   * 要求は `void` ── どのホストを、どのアカウントで、という指定は1つも無い。
   * 見るのは常に github.com への1つのログインだけになる
   * （main/github/githubCommands.ts）。
   *
   * 呼ぶのは**公開の面を開いたとき**で、`git:list-branches` と同じ扱いになる
   * （見られているのは面が開いている一瞬だけ）。リポジトリの状態
   * （`git:get-repository`）に相乗りさせると、**ファイルを保存するたびに
   * gh を1回起動する**ことになる ── しかも gh はネットワークへ出ることがある。
   */
  'github:get-status': {
    request: void
    response: GetGitHubStatusResponse
  }
  /**
   * 今のリポジトリを GitHub へ公開する（Session 3-8-10）。
   *
   * 中身は3つで、**どれも既に在るものは作り直さない。**
   *
   *   1. GitHub に空の repository を作る（差し替え可能な境界。設計判断 12）
   *   2. `origin` を設定する（**既にあれば触らない**）
   *   3. 初回 Push（`--set-upstream` まで）
   *
   * ## 途中から再開できる
   *
   * 押すたびに**実際の状態を読み直して**、済んでいるところは飛ばす ──
   * `origin` が既にあれば 1 と 2 を行わず、3 だけを行う。公開の途中経過を
   * アプリ側に覚えさせない（Git と GitHub の実状態から毎回組み立て直す）のは、
   * 覚えたものと実際が食い違ったときに、**食い違ったまま次の操作が走る**ため。
   *
   * ## 通らない土台は、外へ出る前に断る
   *
   * ブランチの上に居ない（detached HEAD）・commit がまだ1つも無い、はどちらも
   * 手元だけで分かる。分かるものを相手に聞きにいかないのは Push と同じ形で
   * （main/git/gitSync.ts）、ここでは**外に repository を作ってから断る**ことに
   * なるため、より効く。
   */
  'github:publish': {
    request: PublishGitHubRepositoryRequest
    response: PublishGitHubRepositoryResponse
  }
}
