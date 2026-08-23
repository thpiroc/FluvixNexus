import type {
  GitBranchListing,
  GitDiffGroup,
  GitDiscardTarget,
  GitFileDiff,
  GitOperationOutcome,
  GitRepositoryState,
  GitStageTarget,
  GitUnstageTarget
} from '../../git'

/**
 * git ドメインの IPC 契約（Session 3-8-1）。
 *
 * ## この契約の要点も「渡せないもの」にある
 *
 * チャンネルは1本で、要求は `void`。**コマンド名も引数も作業ディレクトリも
 * 渡す欄が無い。**
 *
 *   何を実行するか … main/git/gitCommands.ts（Main が組み立てる引数）
 *   どこで実行するか … main/workspaceFolder/currentWorkspaceFolder.ts（今の Workspace）
 *   git 本体はどこか … main/git/gitExecutable.ts（PATH を辿って実体を確かめる）
 *
 * Terminal では「表のどの行か」を渡せるようにしたが（shared/terminal/shell.ts）、
 * Git ではその必要すら無い ── Renderer が言えるのは
 * 「**今の Workspace について調べて**」だけになる。
 *
 * ## 汎用の Git 実行 API を作らない
 *
 * `git:run` のような「コマンド文字列 / 引数の配列を受け取って実行する」形は
 * 作らない。作った瞬間、Renderer から任意の実行ファイルを起動できるのと
 * ほぼ同じことになる（`git` は `-c core.pager=...` / `-c alias.x=!sh` で
 * 任意のコマンドを呼び出せる）。Files が絶対パスを受け取らないのと同じく、
 * **危ないものを弾くのではなく、渡せる欄そのものを作らない。**
 *
 * Session 3-8-2 以降で操作（Stage / Commit / Push / Pull / ブランチ切り替え）を
 * 足すときも、チャンネルは**操作ごとに1本ずつ**切る。要求に載るのは
 * その操作に固有の値（commit メッセージ・Workspace root からの相対位置・
 * ブランチ名）だけで、git の引数そのものは載せない。
 *
 * ## 失敗ではなく状態として返る
 *
 * Git が入っていない・リポジトリではない・root が食い違う ── どれも
 * `IpcResult` の失敗にはしない。Git パネルが平常時に出す表示であり、
 * 汎用のエラー文言に丸めると「何をすればよいか」を出せなくなる
 * （shared/git/repository.ts）。
 *
 * この応答が失敗で返るのは、Renderer の要求そのものが壊れている場合に限られる。
 */

export interface GetGitRepositoryResponse {
  /**
   * どの Workspace について答えたか。未選択なら null。
   *
   * 他のドメインの応答・イベントと同じ理由で載せている
   * （shared/ipc/events/files.ts）── 問い合わせている間に Workspace が
   * 切り替わりうるため、受け手は自分が今見ているものと突き合わせて、
   * 行き違った答えを捨てられる必要がある。
   */
  readonly workspaceId: string | null
  /** Workspace と Git リポジトリの関係。 */
  readonly repository: GitRepositoryState
}

/**
 * 書き込み操作（Stage / Unstage）の応答（Session 3-8-3）。
 *
 * ## 操作の結末と、操作の後の状態を1回で返す
 *
 * 「Stage して、それから状態を取り直す」を Renderer に2回呼ばせない。理由は2つ。
 *
 *   - **その2回の間に他の変化が挟まりうる。** 挟まると、押した操作の結果として
 *     出ている一覧が、実際には別の瞬間の写しになる
 *   - **失敗したときこそ取り直したい。** 失敗の後に古い一覧を残すと、
 *     利用者から見て「押したのに何も変わらない」ことになり、
 *     何が本当の状態なのか分からなくなる
 *
 * したがって `repository` は**成功でも失敗でも**操作後の状態が入る。
 * `outcome` が失敗でも、パネルは新しい一覧を出したまま理由だけを添えられる。
 *
 * ## 失敗を IpcResult の失敗にしない（3-8-1 からの続き）
 *
 * ファイルが消えていた・index が他のプロセスに握られていた ── どれも
 * Git パネルが平常時に出す表示で、汎用のエラー文言に丸めると
 * 「次に何をすればよいか」を出せなくなる（shared/git/repository.ts）。
 *
 * この応答が `IpcResult` の失敗で返るのは、**要求そのものが壊れている**場合だけ
 * （path の形が pathspec として通せない・グループの名前が知らない値）。
 * それは利用者に起こることではなく、Renderer 側の不具合にあたる。
 */
export interface GitOperationResponse {
  /** どの Workspace について答えたか。未選択なら null（`GetGitRepositoryResponse` と同じ理由）。 */
  readonly workspaceId: string | null
  /** **操作後**のリポジトリの状態（失敗時も取り直したもの）。 */
  readonly repository: GitRepositoryState
  /** その1回の操作がどうなったか。 */
  readonly outcome: GitOperationOutcome
}

export interface StageGitChangesRequest {
  readonly target: GitStageTarget
}

export interface UnstageGitChangesRequest {
  readonly target: GitUnstageTarget
}

/**
 * Commit の要求（Session 3-8-4）。
 *
 * ## 載っているのはメッセージ1つだけ
 *
 * Stage / Unstage で「渡せるのは値1つ」にしたのと同じ形で、Commit も
 * **利用者が書いた文章1つ**しか載せない。git の `commit` が受け取れる
 * 他のものは、どれも欄そのものを作っていない。
 *
 *   載せない … `--amend` / `--no-verify` / `--allow-empty` / `--author` /
 *              `--date` / `--gpg-sign` / `-c` / pathspec / 作業ディレクトリ
 *
 * とくに `--author` / `--date` を欄にしないのは、**履歴に残るものを Renderer から
 * 書き換えられる形にしない**ため。`--no-verify` を欄にしないのは、リポジトリが
 * 用意した hook をアプリの側から迂回できる形にしないためになる。
 * どれも「必要になったら操作ごとに1本ずつチャンネルを切る」という 3-8-1 の
 * 決めごとのとおり、後から別の口として設計する。
 *
 * ## メッセージは引数にならない
 *
 * ここへ載った文字列が `-m <message>` としてコマンドラインに並ぶことは無い。
 * Main は `git commit --file=-` の**標準入力**として渡す
 * （main/git/gitCommands.ts）── 引数に載せる形にすると、値の長さ・改行・
 * 先頭の `-` のそれぞれに別の配慮が要り、そのどれか1つを忘れた日に破れる。
 *
 * 形そのものは shared/git/commitMessage.ts が決めていて、Renderer は
 * 送る前に、Main は受け取った後に、**同じ関数**を通す。
 */
export interface CommitGitChangesRequest {
  /** 利用者が入力した Commit メッセージ（複数行可）。 */
  readonly message: string
}

/**
 * Commit & Push の要求（Session 3-8-5）。
 *
 * 中身は `CommitGitChangesRequest` と同じ（メッセージ1つ）で、**Push の側に
 * 足せる欄は1つも無い** ── remote 名もブランチ名も refspec も `--force` も
 * 載らない。別の型として書いてあるのは、片方に欄を足したときに
 * もう片方まで黙って広がらないようにするためになる。
 */
export interface CommitAndPushGitChangesRequest {
  /** 利用者が入力した Commit メッセージ（複数行可）。 */
  readonly message: string
}

/**
 * ローカルブランチの一覧の応答（Session 3-8-6）。
 *
 * ## 一覧を `git:get-repository` に相乗りさせていない
 *
 * 変更ファイルの一覧は `ready` の中に入れた（Session 3-8-2）が、ブランチの
 * 一覧は別のチャンネルにしてある。理由は**見られている時間が違う**ことになる。
 *
 *   変更ファイル … パネルが開いている間ずっと出ている
 *   ブランチ     … 選ぶ面を開いた、その一瞬だけ
 *
 * 相乗りさせると、ファイルを保存するたび（`files:changed` からの読み直し）に
 * ブランチを数え直すことになる ── 誰も見ていない一覧のために、git を1回多く
 * 起動し続ける形になる。
 *
 * 逆に、**開くたびに必ず取り直す**のはこちらの側の決めごとになる
 * （renderer/src/git/GitBranchMenu.tsx）。`.git` の監視（Session 3-8-8）が
 * 配るのは「状態が変わった」という合図までで、ブランチの一覧はそこにも
 * 相乗りさせていないため、覚えておいた一覧を出すと
 * 「さっき作ったブランチが無い」が起きる。
 */
export interface ListGitBranchesResponse {
  /** どの Workspace について答えたか。未選択なら null（他の応答と同じ理由）。 */
  readonly workspaceId: string | null
  /** ローカルブランチの一覧、またはそれを出せない理由（shared/git/branch.ts）。 */
  readonly listing: GitBranchListing
}

/**
 * ブランチを切り替える要求（Session 3-8-6）。
 *
 * ## 載るのは名前1つだけ
 *
 * Push / Pull では**ブランチ名を渡す欄そのものを作らなかった**（相手を決めるのは
 * リポジトリの設定で、名前で指せると「画面に出ているものとは別のところへ送れる」
 * ことになるため）。切り替えでは名前が載る ── ここでは名前が
 * **利用者が選んだそのもの**で、他に指しようが無いからになる。
 *
 * それでも載るのは名前だけで、git の `switch` が受け取れる他のものは
 * 欄そのものを作っていない。
 *
 *   載せない … `--force` / `--merge` / `--detach` / `--orphan` /
 *              `--track` / start point（どの commit から始めるか） / pathspec
 *
 * とくに `--force`（`--discard-changes`）と `--merge` を欄にしないのは、
 * **どちらも作業ツリーの書きかけを失わせうる**ため。切り替えられるかどうかの
 * 判断は git 自身に委ねてあり（docs/ARCHITECTURE.md §14.14）、
 * アプリはその判断を上書きする手段を持たない。
 *
 * start point を欄にしないのは、「切り替える」と「別の場所から作る」が
 * 1つのチャンネルに混ざるため ── 混ざると、いつか片方の意味でもう片方が動く
 * （`git:stage` と `git:unstage` を分けてあるのと同じ判断）。
 *
 * ## 名前は引数として git へ渡る
 *
 * Commit メッセージ（標準入力）とは違い、この値は**独立した1つの引数**として
 * コマンドラインに載る。載る側の備え（`--end-of-options` の後ろに単独で置く）は
 * main/git/gitCommands.ts が、名前の形の検証（`normalizeGitBranchName`）は
 * shared/git/branchName.ts が持ち、Renderer と Main が**同じ関数**を通す。
 */
export interface SwitchGitBranchRequest {
  /** 切り替え先のローカルブランチ名。 */
  readonly name: string
}

/**
 * ブランチを作って、そこへ切り替える要求（Session 3-8-6）。
 *
 * 中身は `SwitchGitBranchRequest` と同じ（名前1つ）だが、**別の型にしてある** ──
 * 片方に欄を足したときに、もう片方まで黙って広がらないようにするため
 * （`CommitGitChangesRequest` と `CommitAndPushGitChangesRequest` を
 * 分けてあるのと同じ理由）。
 *
 * どこから作るかは載らない。始点は常に **HEAD**（今居る場所）になる ──
 * 別の commit から始める形は、選ぶための画面（履歴）と一緒でなければ
 * 意味を持たない。
 */
export interface CreateGitBranchRequest {
  /** 新しく作るローカルブランチ名。 */
  readonly name: string
}

/**
 * 1行の差分を尋ねる要求（Session 3-8-9）。
 *
 * ## 載るのは「どの行か」だけ
 *
 * 位置1つと、閉じた集合であるグループ1つ。git の `diff` が受け取れる他のものは
 * 欄そのものを作っていない。
 *
 *   載せない … `--cached` / `--staged` / rev（`HEAD~1` などの指定） /
 *              `--unified=<n>` / `--word-diff` / `--diff-filter` /
 *              `--textconv` / `--ext-diff` / 作業ディレクトリ
 *
 * とくに **rev を載せない**のは、載せた瞬間に「今の作業ツリーの状態を見る」から
 * 「履歴の任意の2点を比べる」へ意味が変わるため ── それは走査の入口が別のもの
 * （commit の連なり）になる話で、履歴の画面と一緒に設計する。
 * `--ext-diff` / `--textconv` を載せないのは、どちらもリポジトリの設定にある
 * **任意のプログラムを起動させる**指定にあたるため（3-8-1 の線そのもの）。
 *
 * ## グループが要る理由
 *
 * 同じファイルが staged と unstaged の2つに並ぶことがある（`git add` した後に
 * もう一度書き換えた状態）。位置だけを渡すと、**どちらの行を押したのかが
 * 決まらない** ── 一覧では別々の行として出しているのに、差分では片方に
 * 寄せることになる。
 */
export interface GetGitFileDiffRequest {
  readonly group: GitDiffGroup
  readonly relativePath: string
}

/**
 * 差分の応答（Session 3-8-9）。
 *
 * バイナリ・大きすぎる・見つからない、はどれも `IpcResult` の失敗にしない ──
 * 3-8-1 からの線どおり、**利用者の次の一手が変わるもの**は分類として返す
 * （shared/git/diff.ts）。汎用のエラー文言に丸めると「なぜ出せないのか」を
 * 出せなくなる。
 */
export interface GetGitFileDiffResponse {
  /** どの Workspace について答えたか。未選択なら null（他の応答と同じ理由）。 */
  readonly workspaceId: string | null
  readonly diff: GitFileDiff
}

/**
 * 破棄の要求（Session 3-8-9）。
 *
 * 載るのは `GitDiscardTarget` 1つだけで、そこに入るのは位置1つとグループ1つ
 * （shared/git/operation.ts）。**グループの「すべて」は無く、
 * `staged` も `conflicted` も渡せない。**
 *
 * ## `git clean` / `reset --hard` は、この口の先にも無い
 *
 * Main が組み立てるのは `git restore --worktree`（unstaged）と、
 * files ドメインのごみ箱（untracked）の2つだけになる。
 * `git clean` は `.gitignore` の対象まで巻き込みうえに**ごみ箱を経由しない**、
 * `reset --hard` は指した1件ではなく作業ツリー全体を戻す ── どちらも
 * 「押した行1つ」より広い範囲を消す（ARCHITECTURE.md §14.17）。
 */
export interface DiscardGitChangesRequest {
  readonly target: GitDiscardTarget
}

export interface GitIpcContract {
  'git:get-repository': {
    request: void
    response: GetGitRepositoryResponse
  }
  /**
   * index に載せる（Session 3-8-3）。
   *
   * `git:run` のような汎用の口を作らず、**操作ごとに1本ずつ**切るという 3-8-1 の
   * 決めごとのとおり、Stage 専用のチャンネルにしてある。ここを通って Main へ届くのは
   * 「どの1件か」または「どのグループか」だけで、git の引数は1つも載らない。
   */
  'git:stage': {
    request: StageGitChangesRequest
    response: GitOperationResponse
  }
  /**
   * index から外す（Session 3-8-3）。
   *
   * **作業ツリーには触らない操作**であることが、この1本を Stage と分けている理由に
   * なっている。「戻す」と名の付く操作には、作業ツリーごと戻すもの（discard / reset --hard）も
   * あり、そちらは失われるものがある ── 同じチャンネルで区別を引数に持たせると、
   * いつか片方の意味でもう片方が動く。
   */
  'git:unstage': {
    request: UnstageGitChangesRequest
    response: GitOperationResponse
  }
  /**
   * ステージ済みの変更を Commit する（Session 3-8-4）。
   *
   * Stage / Unstage と同じく専用の1本で、要求に載るのはメッセージだけになる
   * （`CommitGitChangesRequest`）。**何を Commit するかは要求に載らない** ──
   * 対象は index の中身そのもので、それを決めるのは直前までの Stage / Unstage に
   * なる。pathspec を受け取る形（`git commit -- <path>`）にすると、
   * 画面に「ステージ済み」として出ているものと、実際に Commit されるものが
   * 別々に決まりうる。
   */
  'git:commit': {
    request: CommitGitChangesRequest
    response: GitOperationResponse
  }
  /**
   * 今のブランチを追跡先へ送る（Session 3-8-5）。
   *
   * ## 要求が `void` に戻る
   *
   * Stage / Commit では値が1つずつ載ったが、Push で載るものは**1つも無い。**
   * remote 名・ブランチ名・refspec・`--force` のどれも欄が無く、
   * Renderer が言えるのは「今のブランチを送って」だけになる。
   *
   * 送り先を決めるのはリポジトリの設定（upstream、無ければ既定の remote）で、
   * それを Main がその場で読む。名前で指せる形にすると、**画面に出ている
   * ブランチとは別のものへ送れる欄**になり、押した人から見て何が起きたのか
   * 分からなくなる。
   *
   * 初回（追跡先がまだ無い）は同じ1本の中で `--set-upstream` まで行う ──
   * 「初回だけ別の口」にすると、利用者はどちらを押すかを先に判断することになる。
   */
  'git:push': {
    request: void
    response: GitOperationResponse
  }
  /**
   * 追跡先の変更を取り込む（Session 3-8-5）。
   *
   * 中身は `git fetch` と `git merge --ff-only` の2つで、**`git pull` は
   * 使わない**（main/git/gitSync.ts）。`pull` は設定（`pull.rebase`）で
   * merge にも rebase にもなり、同じボタンが PC ごとに違う履歴を作る。
   *
   * 早送りできないときは取り込まずに `diverged` として返る ── merge と
   * rebase のどちらを選ぶかは、アプリが黙って決めてよいことではない。
   *
   * Push と同じく要求は `void` で、どこから受け取るかは upstream が持つ。
   */
  'git:pull': {
    request: void
    response: GitOperationResponse
  }
  /**
   * Commit してから Push する（Session 3-8-5）。
   *
   * ## なぜ2本を Renderer から続けて呼ばせないか
   *
   * `git:commit` の後に `git:push` を呼ぶ形にすると、**その2回の間に別の
   * 操作が挟まりうる**（順番待ちは1回の要求ごとに枠を取る。main/git/gitQueue.ts）。
   * 挟まると「Commit したものを送った」と言えなくなる。1本にすれば、
   * Commit・Push・状態の読み直しがまるごと1つの枠に入る。
   *
   * ## 途中で止まった場合は `partly-applied`
   *
   * Commit は作られたのに Push が通らなかった、は普通に起こる（認証・
   * ネットワーク・remote 側の拒否）。これを失敗に丸めると、利用者は
   * 同じ内容をもう一度 Commit する ── 履歴に同じ commit が2つ積まれる
   * （shared/git/operation.ts の `partly-applied`）。
   *
   * **Commit を取り消して失敗に揃えることもしない。** 頼まれていない
   * 取り消しになり、しかも戻す操作そのものが失敗しうる。
   */
  'git:commit-and-push': {
    request: CommitAndPushGitChangesRequest
    response: GitOperationResponse
  }
  /**
   * ローカルブランチの一覧を尋ねる（Session 3-8-6）。
   *
   * 要求は `void` ── どのリポジトリのどの ref を、という指定は1つも載らない。
   * 出てくるのは常に「今の Workspace のローカルブランチ」だけになる
   * （remote-tracking branch は載らない。shared/git/branch.ts）。
   *
   * 読み取りだが `git:get-repository` とは別の1本にしてある。理由は
   * `ListGitBranchesResponse` に書いたとおりで、**見られている時間が違う**ため。
   */
  'git:list-branches': {
    request: void
    response: ListGitBranchesResponse
  }
  /**
   * 別のローカルブランチへ切り替える（Session 3-8-6）。
   *
   * 「操作ごとに1本ずつ」の決めごとどおり、作成（`git:create-branch`）とも
   * 分けてある。**1本にして「無ければ作る」にしない** ── 名前を打ち間違えた
   * ときに、切り替えたつもりで新しいブランチが増えることになる。
   *
   * 応答は他の書き込み操作と同じ `GitOperationResponse` で、**切り替えた後の
   * 状態が丸ごと載る**（ブランチ名・変更ファイルの一覧・追跡先）── Files と
   * Editor は既存の追従の仕組みでそれぞれ追いつく（§14.14）。
   */
  'git:switch-branch': {
    request: SwitchGitBranchRequest
    response: GitOperationResponse
  }
  /**
   * 今の場所から新しいブランチを作って、そこへ切り替える（Session 3-8-6）。
   *
   * 作るだけ（切り替えない）の口は持たない。**1回の git（`switch --create`）で
   * 作って切り替える**のは、2つに分けると「作ったのに切り替わっていない」
   * 状態が生まれ、そこから先の Commit が意図しないブランチに積まれるため
   * （main/git/gitCommands.ts）。
   */
  'git:create-branch': {
    request: CreateGitBranchRequest
    response: GitOperationResponse
  }
  /**
   * 1行の差分を尋ねる（Session 3-8-9）。
   *
   * 読み取りだが `git:get-repository` とは別の1本にしてある。理由は
   * `git:list-branches` と同じで、**見られている時間が違う**ため ──
   * 変更ファイルの一覧はパネルが開いている間ずっと出ているが、差分は
   * 利用者が1行を選んだ一瞬しか見られない。相乗りさせると、ファイルを
   * 保存するたびに全件の中身を読むことになる。
   *
   * 返るのは patch ではなく**中身2つ**（shared/git/diff.ts）。
   */
  'git:get-file-diff': {
    request: GetGitFileDiffRequest
    response: GetGitFileDiffResponse
  }
  /**
   * 作業ツリーの変更を破棄する（Session 3-8-9）。
   *
   * `git:unstage` の説明に書いてあった「作業ツリーごと戻すもの」が、ここで
   * **別の1本**として立つ。同じチャンネルで区別を引数に持たせなかったのは、
   * いつか片方の意味でもう片方が動くため ── 分けてあれば、Unstage の要求が
   * 作業ツリーを消すことは形の上で起こらない。
   *
   * 応答は他の書き込み操作と同じ `GitOperationResponse` で、**破棄した後の
   * 状態が丸ごと載る。** Files と Editor は既存の追従の仕組み
   * （`files:changed`）でそれぞれ追いつく。
   */
  'git:discard': {
    request: DiscardGitChangesRequest
    response: GitOperationResponse
  }
}
