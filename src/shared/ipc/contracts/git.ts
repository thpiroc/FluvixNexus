import type {
  GitBranchListing,
  GitCommitDetail,
  GitCommitFileDiff,
  GitCommitHistory,
  GitDiffGroup,
  GitDiscardTarget,
  GitFileDiff,
  GitOperationOutcome,
  GitRemoteBranchListing,
  GitRemoteListing,
  GitRepositoryState,
  GitStageTarget,
  GitStashListing,
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
 * commit の履歴の応答（Session 3-8-11）。
 *
 * ## 一覧を `git:get-repository` に相乗りさせていない
 *
 * 理由は `ListGitBranchesResponse` とまったく同じで、**見られている時間が違う。**
 * 変更ファイルの一覧はパネルが開いている間ずっと出ているが、履歴は
 * 利用者が履歴を開いている間だけになる ── 相乗りさせると、ファイルを
 * 保存するたびに `git log` で 100 件を読み直すことになる。
 *
 * ## ブランチの一覧と違い、開いている間は追いつく
 *
 * ブランチの一覧は「開いた瞬間に取り直して、閉じるまでそのまま」だった
 * （面が開いているのは一瞬のため）。履歴は開いたまま端末で `git commit` する
 * ことがあり、そのとき出たままの一覧は**さっき積んだ commit が無い**という
 * 形で嘘をつく。したがって履歴は `git:changed`（Session 3-8-8）を
 * **開いている間だけ**購読する（renderer/src/git/useGitRepository.ts）。
 *
 * 購読するのは `git:changed` だけで、`files:changed` には乗らない ──
 * 作業ツリーのファイルをいくら書き換えても、履歴は1行も変わらない。
 */
export interface ListGitCommitsResponse {
  /** どの Workspace について答えたか。未選択なら null（他の応答と同じ理由）。 */
  readonly workspaceId: string | null
  /** commit の一覧、またはそれを出せない理由（shared/git/history.ts）。 */
  readonly history: GitCommitHistory
}

/**
 * commit 1件の詳細を尋ねる要求（Session 3-8-12）。
 *
 * ## 3-8-11 まで無かった「rev の欄」が、ここで初めて1つだけ開く
 *
 * 履歴（`git:list-commits`）は要求が `void` で、rev を渡せる欄そのものが
 * 無かった。詳細では**どの commit かを言わなければ始まらない**ため、
 * 欄が1つ開く ── ただし開くのはここまでで、次の3つは変えていない。
 *
 *   1. 載るのは**短い hash（`%h`）だけ**。`HEAD~5` も `main@{1}` も
 *      `:/要約` も通らない（形は 16進 4〜40 桁に限る。main/git/gitCommitHash.ts）
 *   2. その値は `--end-of-options` の後ろの**独立した1つの引数**として渡る。
 *      `<hash>:<path>` のような組み立ては1つも作らない（main/git/gitCommands.ts）
 *   3. 動かす git は `show --no-patch` と `diff-tree` の2本だけで、
 *      **どちらも読み取り**にあたる。revert も reset も cherry-pick も無い
 *
 * つまり「rev を渡せる欄」ではなく、**履歴に出した行を指すための欄**になる。
 * 履歴に出ていない commit を指す手立ては、この欄からは作れない ── 打ち込む
 * 場所が無く、渡せるのは一覧の行が持っていた文字列だけになる。
 */
export interface GetGitCommitDetailRequest {
  /** 履歴の行が持っている短い hash（`GitCommitSummary.shortHash`）。 */
  readonly shortHash: string
}

export interface GetGitCommitDetailResponse {
  /** どの Workspace について答えたか。未選択なら null（他の応答と同じ理由）。 */
  readonly workspaceId: string | null
  /** 変更ファイルの一覧、またはそれを出せない理由（shared/git/commitDetail.ts）。 */
  readonly detail: GitCommitDetail
}

/**
 * commit の中の1ファイルの差分を尋ねる要求（Session 3-8-12）。
 *
 * 載る値は2つ（短い hash と位置1つ）で、どちらも**既に画面に出ているもの**に
 * なる ── hash は履歴の行が、位置は詳細の行が持っていた文字列にあたる。
 *
 * `group` が無いのが `GetGitFileDiffRequest` との違いになる。commit の差分で
 * 比べる相手は常に1組（親の tree と、この commit の tree）で、
 * 「どの段を見るか」という選択がそもそも存在しない（shared/git/commitDetail.ts）。
 *
 * 位置は最後まで **pathspec のまま**渡る。`<hash>:<path>` という1つの引数に
 * 組み立てないのは 3-8-9 と同じ判断で、組み立てると位置が revision 表記の
 * 一部として読まれる余地が生まれる（main/git/gitCommands.ts）。
 */
export interface GetGitCommitFileDiffRequest {
  readonly shortHash: string
  readonly relativePath: string
}

export interface GetGitCommitFileDiffResponse {
  /** どの Workspace について答えたか。未選択なら null（他の応答と同じ理由）。 */
  readonly workspaceId: string | null
  /** 中身2つ、またはそれを出せない理由（shared/git/commitDetail.ts）。 */
  readonly diff: GitCommitFileDiff
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
 * ブランチを作って、そこへ切り替える要求（Session 3-8-6 / 3-8-13）。
 *
 * `SwitchGitBranchRequest` と**別の型にしてある** ── 片方に欄を足したときに、
 * もう片方まで黙って広がらないようにするため（`CommitGitChangesRequest` と
 * `CommitAndPushGitChangesRequest` を分けてあるのと同じ理由）。実際、
 * 3-8-13 で欄が増えたのはこちらだけになる。
 *
 * ## 3-8-6 では「どこから作るか」が載らなかった
 *
 * 始点は常に HEAD（今居る場所）で、それは**選ぶための画面が無かった**ため
 * だった ── rev を打ち込める欄を作れば「画面に出ていないものを指せる」ことに
 * なり、3-8-1 からの線（渡せる欄そのものを作らない）に触れる。
 *
 * ## 3-8-13 で、選ぶ画面の側が先に出来上がった
 *
 * 履歴（3-8-11）と commit 1件の詳細（3-8-12）で、**画面に出ている行を指す**
 * 形が確立した ── 渡るのは行が持っていた短い hash で、通る形は16進 4〜40 桁
 * （main/git/gitCommitHash.ts）。打ち込む欄はどこにも無い。
 *
 * したがってここに載るのも「rev を渡せる欄」ではなく、**履歴に出した行を
 * 指すための欄**になる。`GetGitCommitDetailRequest` / `GetGitCommitFileDiffRequest`
 * が載せているのとまったく同じ値で、確かめる関数も同じものになる。
 *
 * ## 増えたのは始点だけ
 *
 * `git switch` が受け取れる他のものは、3-8-6 のときと同じく欄そのものを
 * 作っていない。
 *
 *   載せない … `--force`（`-C`。既にある名前を別の commit へ付け替える） /
 *              `--track` / `--detach` / `--orphan` / `--merge` / pathspec
 *
 * とくに `--force` を欄にしないのは、**元の枝がどこにあったかを見失わせる**ため
 * になる ── 同じ名前があれば `branch-exists` として断り、別の名前を打ち直して
 * もらう（shared/git/operation.ts）。
 */
export interface CreateGitBranchRequest {
  /** 新しく作るローカルブランチ名。 */
  readonly name: string
  /**
   * どの commit から始めるか。**`null` なら HEAD**（今居る場所）になる。
   *
   * 値が入るのは履歴の行から作ったときだけで、入るのはその行が持っていた
   * 短い hash（`GitCommitSummary.shortHash`）にあたる。
   *
   * `string | null` にしてあり、省略可（`?`）にしていない ── **どちらの
   * 意味で呼んだのかを、呼ぶ側に必ず書かせる**ため。省略できる形にすると、
   * 始点を渡し忘れた要求が「今の場所から作る」として静かに通り、
   * 押した行とは違う場所にブランチが生える。
   */
  readonly startPoint: string | null
}

/**
 * ローカルブランチを削除する要求（Session 3-8-14）。
 *
 * ## 載るのは名前1つだけ
 *
 * `SwitchGitBranchRequest` と形は同じだが、**別の型にしてある** ── 3-8-6 で
 * 切り替えと作成を分けたのと同じ理由で、片方に欄を足した日にもう片方まで
 * 黙って広がらないようにするため。
 *
 * ## `--force`（`-D`）の欄は無い
 *
 * 動かすのは `git branch --delete` の1本だけで、強制削除に落ちる道が
 * **要求の形として存在しない。** 未マージのブランチは git が断り
 * （`branch-not-merged`）、アプリはその判断を上書きする手段を持たない ──
 * `--force` push（3-8-5）・`switch --force`（3-8-6）・`branch --force`（3-8-13）で
 * 通してきた線をそのまま延ばしたものになる。
 *
 * 削除は Git 機能で2つめの「戻せない操作」にあたるため、押す前に確認を挟む
 * （§12.6 / renderer/src/git/GitBranchMenu.tsx）。ただし確認は Renderer の
 * 中の話で、**この要求には「確認したか」の欄は無い** ── 確認を通した証を
 * 引数に載せると、載せなければ確認を飛ばせる形になる。
 */
export interface DeleteGitBranchRequest {
  /** 削除するローカルブランチ名。 */
  readonly name: string
}

/**
 * ローカルブランチの名前を変える要求（Session 3-8-14）。
 *
 * ## 1つの要求に外来の値が2つ載る、初めての形
 *
 * ここまで境界を渡ってきた値は、必ず1要求に1つだった（pathspec 1つ・
 * メッセージ1つ・ブランチ名1つ・hash 1つ）。rename だけは
 * **「どれを」と「何に」**の2つが同時に要る ── どちらも
 * `normalizeGitBranchName` を通し、`--end-of-options` の後ろに
 * 独立した引数として並ぶ（main/git/gitCommands.ts）。
 *
 * 2つに同じ規則を掛けるのは、入口を分けると「元の名前としては通るが
 * 新しい名前としては通らない」形が生まれるため ── `commitHashField` と
 * `branchStartPointField` が同じ関数を通しているのと同じ判断になる。
 *
 * ## 元の名前も要求に載せる（「今のブランチ」に頼らない）
 *
 * git は `git branch -m <新名>` の1引数形も受け取る（今のブランチを改名する）が、
 * **その形は使わない。** 使うと「どの枝を改名するのか」が要求に書かれず、
 * 押してから git が動くまでの間に HEAD が変わっていた場合、
 * **画面で選んだのとは別のブランチが改名される。**
 * 一覧の行から押す操作である以上、対象は要求が名指しする。
 *
 * ## remote 側は動かない
 *
 * 変わるのは手元の ref だけで、追跡先（`branch.<名前>.merge`）は
 * **古い remote 側の名前を指したまま残る** ── つまり rename の後に Push すると、
 * 送り先は改名前の名前の remote branch になる。追跡先を付け替える欄は
 * 作っていない（remote を指せる欄を作らない、という 3-8-5 からの線）。
 * remote branch の削除・改名も対象外で、そちらは端末で行う（§14.18）。
 */
export interface RenameGitBranchRequest {
  /** 改名するローカルブランチ名（一覧の行が持っていたもの）。 */
  readonly name: string
  /** 新しい名前。 */
  readonly newName: string
}

/**
 * remote-tracking branch の一覧の応答（Session 3-8-19）。
 *
 * ## ローカルブランチの一覧と、別のチャンネルにしてある
 *
 * `ListGitBranchesResponse` に種別の欄を足して1本にまとめない。理由は3つある。
 *
 *   - **動かす git の引数が違う。** `refs/heads/` と `refs/remotes/` で
 *     `for-each-ref` を2回動かすことになり、1本にすると**面を開くたびに
 *     必ず2回**動く ── ローカルの一覧だけを見たい人（3-8-6 からの利用者）に、
 *     見ていないものの代金を払わせることになる
 *   - **上限が別々に効く。** 1つの配列に混ぜると、remote 側が 500 件あるだけで
 *     ローカルの行が押し出される（`truncated` が何について切れたのかも
 *     言えなくなる）
 *   - **押したときに起きることが違う。** ローカルの行は切り替え、こちらの行は
 *     「ローカル名を確かめる欄が開く」になる。同じ配列に入れると、行ごとに
 *     押した結果が変わるものを種別の欄で見分けることになる
 *     （shared/git/remoteBranch.ts）
 *
 * ## 取り直す契機はローカルの一覧と同じ
 *
 * 面（ブランチの Popover）を**開いた瞬間だけ**取り直し、`git:changed` には
 * 相乗りさせない（§14.14 と同じ判断）── 見られているのは面が開いている
 * 一瞬だけで、閉じている間に数え直すのは誰も見ていない一覧のために
 * git を1回多く起動することになる。
 *
 * ## fetch はしない
 *
 * 返るのは**手元の `refs/remotes/` に既にあるもの**だけで、一覧を出す前に
 * `git fetch` は動かさない（Session 3-8-19 の範囲外。shared/git/remoteBranch.ts）。
 */
export interface ListGitRemoteBranchesResponse {
  /** どの Workspace について答えたか。未選択なら null（他の応答と同じ理由）。 */
  readonly workspaceId: string | null
  /** remote-tracking branch の一覧、またはそれを出せない理由。 */
  readonly listing: GitRemoteBranchListing
  /**
   * remote が1つでも登録されているか。
   *
   * ## 一覧が空だったときに、言うことが2つに分かれる
   *
   * `refs/remotes/` が空になる理由は2つあり、**次の一手がまったく違う。**
   *
   *   remote が無い   … 先に「リモート」から登録する
   *   remote はあるが未 fetch … Terminal で `git fetch` するか、一度 Pull する
   *
   * git の出力からは見分けられない（どちらも 0 で終わって何も出さない）ため、
   * Main が同じ1回の問い合わせの中で確かめて載せる ── Renderer に
   * `repository.hasRemote` と突き合わせさせないのは、その2つが**別の瞬間の
   * 写し**になりうるためになる（`GitLocalBranch.current` を同じ読み取りから
   * 出しているのと同じ判断。shared/git/branch.ts）。
   *
   * 一覧が `ready` で空のときにだけ読まれる値で、それ以外では見ない。
   */
  readonly hasRemote: boolean
}

/**
 * remote-tracking branch から、それを追うローカルブランチを作って切り替える要求
 * （Session 3-8-19）。
 *
 * ## `CreateGitBranchRequest` と別の型・別のチャンネルにしてある
 *
 * `startPoint` に `origin/feature` を渡せるようにする、という形は取らない。
 * 3-8-13 で開けた `startPoint` の欄は**履歴の行が持っていた短い hash**だけを
 * 通すもので（`normalizeGitCommitHash`。16進 4〜40 桁）、そこに ref 名を
 * 通せるようにすると、**あの欄の意味そのものが変わる** ── 「画面に出ている
 * commit を指す」から「rev を渡せる」へ広がることになり、3-8-12 から
 * 引いてきた線がそこで切れる。
 *
 * 起きることも違う。
 *
 *   `git:create-branch`          … 追跡先は付かない（始点はローカルの commit）
 *   `git:create-tracking-branch` … **追跡先が必ず付く**（`--track`）
 *
 * 後者は `.git/config` に `branch.<名前>.remote` / `.merge` の2行を書く ──
 * つまり**この操作の後、Push / Pull の相手が決まる。** 送り先が決まる操作を、
 * 決まらない操作と同じチャンネルに乗せない。
 *
 * ## 載るのは2つだけ
 *
 * | 載せない        | なぜ                                                                  |
 * | --------------- | --------------------------------------------------------------------- |
 * | `--no-track`    | 追跡しない作成は `git:create-branch` が既にその形（この口の意味が消える） |
 * | `--force`（`-C`） | 3-8-13 と同じ。元の枝がどこにあったかを見失わせる                     |
 * | `--detach`      | remote-tracking branch へ detached で移る形。名前を付けずに移らない    |
 * | remote 名の欄   | `name` の中に既に入っている。別に渡せる欄は作らない                    |
 * | fetch するか    | 欄そのものが無い。この操作はネットワークへ出ない                       |
 *
 * ## ローカル名は「既定値を変えられる」形にしてある
 *
 * `origin/feature` から `feature` を作るのは Main で（`GitRemoteBranch.branch`）、
 * ここに載るのは**利用者が確かめた後の名前**になる。既定値のまま送ることも、
 * 打ち替えて送ることもできる ── 打ち替えられることが要るのは、同じ名前の
 * ローカルブランチが既にある場合に、それ以外の道が無いためにあたる
 * （アプリは上書きも削除も自動切替もしない）。
 *
 * 2つとも `normalizeGitBranchName` を通る（main/ipc/handlers/git.ts）──
 * `RenameGitBranchRequest` が2つの名前に同じ規則を掛けているのと同じ形で、
 * 入口を分けると「始点としては通るがローカル名としては通らない」形が生まれる。
 */
export interface CreateGitTrackingBranchRequest {
  /**
   * 追う相手の remote-tracking branch 名（一覧の行が持っていたもの）。
   *
   * 例: `origin/feature/x`
   *
   * **形が通ることと、それが remote-tracking branch であることは別**になる ──
   * 前者は `normalizeGitBranchName`、後者は Main が git に確かめる
   * （`refs/remotes/` の下に在るか。main/git/gitRemoteBranches.ts）。
   * 後者を確かめないと、ローカルブランチ名を渡して
   * 「ローカルを追うローカルブランチ」を作れてしまう（実物で確かめてある ──
   * git は `branch.<名前>.remote=.` を書いて通す）。
   */
  readonly startPoint: string
  /** 手元に作るローカルブランチ名（既定値は `GitRemoteBranch.branch`）。 */
  readonly name: string
}

/**
 * remote の一覧の応答（Session 3-8-16）。
 *
 * ## 相乗りさせていないのは、これで4つめ
 *
 * ブランチ・履歴・退避とまったく同じ理由で、`git:get-repository` に載せない ──
 * **見られている時間が違う。** リポジトリの状態が持っているのは今も
 * `hasRemote`（有無だけ）で、そこは 3-8-10 から1文字も動かしていない
 * （shared/git/repository.ts）── あちらはパネルが開いている間ずっと
 * 「公開の入口を出すか」を決めており、一覧は面を開いている間だけになる。
 *
 * 相乗りさせると、ファイルを保存するたびに `git remote --verbose` を
 * 1回起動することになる。
 *
 * ## 開いている間は追いつく（退避と同じ側）
 *
 * 端末で `git remote add` を打つことがあり、そのとき出たままの一覧は
 * 「さっき足したものが無い」という形で嘘をつく。ブランチの一覧が
 * 「開いた瞬間に取り直して、閉じるまでそのまま」なのとは違う側になる。
 *
 * ## 載るのは名前と**表示用ラベル**だけ
 *
 * URL は載らない（shared/git/remote.ts）── 渡すと、Renderer がそれを
 * 指して何かを頼みたくなるだけでなく、URL そのものが git に任意の
 * プログラムを起動させうる値にあたる（shared/git/remoteUrl.ts）。
 */
export interface ListGitRemotesResponse {
  /** どの Workspace について答えたか。未選択なら null（他の応答と同じ理由）。 */
  readonly workspaceId: string | null
  /** remote の一覧、またはそれを出せない理由（shared/git/remote.ts）。 */
  readonly listing: GitRemoteListing
}

/**
 * remote を1つ追加する要求（Session 3-8-16）。
 *
 * ## 3-8-1 で「作らない」と決めた欄を、初めて作る
 *
 * 3-8-5 から 3-8-15 まで、remote を指せる欄はどこにも無かった ── 送り先を
 * 決めるのはリポジトリの設定で、Renderer が名前で指せる形にすると
 * 「画面に出ているブランチとは別のものへ送れる欄」になるためだった。
 *
 * **その判断は今も動いていない。** ここで作るのは
 * 「**登録簿に1行足す**」欄であって、「送り先を選ぶ」欄ではない ──
 * Push / Pull の要求は今も `void` のままで、どこへ送るかは
 * リポジトリの設定が持つ（`git:push` / `git:pull`）。
 *
 * ## 1つの要求に外来の値が2つ載る、2つめの形
 *
 * 1つめは rename（`RenameGitBranchRequest`）だった。あちらは
 * 「どれを」と「何に」で、どちらも同じ規則を通ったが、こちらの2つは
 * **性質そのものが違う。**
 *
 *   `name` … 境界を往復する値（一覧の行に載り、削除の要求に載る）
 *   `url`  … Renderer → Main へ**1回だけ流れる値**（一覧には載らない）
 *
 * したがって規則も別のファイルになる（shared/git/remoteName.ts /
 * shared/git/remoteUrl.ts）── とくに URL の側は、Git 機能で唯一
 * **git に任意のプログラムを起動させうる値**にあたる。
 *
 * ## `--fetch` の欄は無い
 *
 * 追加した直後にネットワークへ出る形にしない（`addOriginRemote` で
 * 同じ判断をしている。main/git/gitCommands.ts）── この1回で起きることを
 * 「設定に1行増える」だけに保つ。届く相手かどうかは、次の Pull で分かる。
 *
 * ## 追跡先（upstream）は付けない
 *
 * remote を足しても、今のブランチの `branch.<名前>.remote` は変わらない ──
 * 追跡先が付くのは Push が通ったときだけになる（`pushSettingUpstream`）。
 * 足した瞬間に付ける形にすると、**まだ届くかも分からない相手**が
 * 画面の `↑ ↓` の基準になる。
 */
export interface AddGitRemoteRequest {
  /** remote 名（`origin` など）。`normalizeGitRemoteName` を通る。 */
  readonly name: string
  /** 送り先の URL。`normalizeGitRemoteUrl` を通る（通す形は3つだけ）。 */
  readonly url: string
}

/**
 * remote の URL を変える要求（Session 3-8-17）。
 *
 * ## 3-8-16 が断ったのは「上書きできること」ではなく「黙って上書きされること」
 *
 * `git:add-remote` は名前が既にあれば `remote-exists` で断る ── その判断は
 * 1文字も動かない。3-8-17 が足すのは**別の口**で、押す前に
 * 「今どこを指していて、これからどこを指すか」を見せてから適用する
 * （renderer/src/git/GitRemoteOverlay.tsx）。危険だったのは上書きそのもの
 * ではなく、**送り先が入れ替わったことに誰も気づかないまま Push が別の
 * ところへ飛ぶ**ことだった（docs/ARCHITECTURE.md §14.25）。
 *
 * ## 載るのは `AddGitRemoteRequest` と同じ2つで、規則も同じ
 *
 * `name` は境界を往復する値（一覧の行が持っていたもの）、`url` は
 * Renderer → Main へ**1回だけ流れる値**になる。通す関数も追加と同じ
 * （`normalizeGitRemoteName` / `normalizeGitRemoteUrl`）── 入口を分けると
 * 「追加では通らないが変更では通る URL」が生まれ、`ext::sh -c …` を
 * 断っている根拠がその日に半分になる。
 *
 * ## 「確認したか」の欄は無い
 *
 * 3-8-14 / 3-8-15 / 3-8-16 とまったく同じ判断で、確認を通した証を引数に
 * 載せると、載せなければ確認を飛ばせる形になる。
 *
 * ## 変わるのは1行だけ ── だからこそ確認が要る
 *
 * `git remote set-url` が書き換えるのは `remote.<名前>.url` **1行だけ**で、
 * 次の3つは1つも動かない（実物で確かめてある。
 * main/git/gitRemoteRepository.test.ts）。
 *
 *   `remote.<名前>.fetch`        … refspec はそのまま
 *   `refs/remotes/<名前>/*`      … **前の送り先から取ってきた commit を指したまま**
 *   `branch.*.remote` / `.merge` … 追跡先はそのまま
 *
 * つまり削除（`RemoveGitRemoteRequest`）とは正反対で、**失われるものが
 * 1つも無い代わりに、古いものが残る。** 画面の `↑2 ↓1` は変更後も
 * そのままで、それは**もう別の相手と比べた数**になる ── 確認の文言が
 * 言うのはそこになる（renderer/src/git/gitRemotes.ts）。
 *
 * ## 同じ URL を渡しても、`nothing-to-do` にしない
 *
 * Renderer は今の URL を持たない（一覧に載るのはラベルだけ）ので、
 * 押す前には判定できない。Main で判定するには `git remote get-url` を
 * 1回増やすことになり、**得られるのは文言だけ**になる ── 変わらない値で
 * 上書きしても、壊れるものも失われるものも無い。git へそのまま渡して
 * 成功として返す（3-8-6 の「今のブランチを選んだ」＝ `nothing-to-do` とは
 * 事情が違う。あちらは Renderer が持っている値で判定できた）。
 */
export interface SetGitRemoteUrlRequest {
  /** URL を変える remote 名（一覧の行が持っていたもの）。`normalizeGitRemoteName` を通る。 */
  readonly name: string
  /** 新しい URL。`normalizeGitRemoteUrl` を通る（追加とまったく同じ3つの形）。 */
  readonly url: string
}

/**
 * remote の名前を変える要求（Session 3-8-17）。
 *
 * ## 1つの要求に外来の値が2つ載る、3つめの形
 *
 * 1つめはブランチの rename（`RenameGitBranchRequest`）、2つめは remote の
 * 追加（`AddGitRemoteRequest`）だった。こちらは1つめと同じ側にあたる ──
 * 「どれを」と「何に」で、**2つとも同じ規則**（`normalizeGitRemoteName`）を
 * 通る。入口を分けると「元の名前としては通るが、新しい名前としては
 * 通らない」形が生まれる。
 *
 * 行き先にも同じ規則を掛けるのは形の話だけではない ──
 * `git remote rename --end-of-options up2 -x` は git が**受け取ってしまい**、
 * `-x` という名前の remote が生まれる（実物で確かめてある）。追加のときと
 * まったく同じ穴が、行き先の側にも開いている。
 *
 * ## 元の名前も要求に載せる
 *
 * `git remote rename` に1引数形は無いので git 側の事情ではないが、
 * `RenameGitBranchRequest` と同じ形に揃えてある ── 対象は要求が名指しする。
 *
 * ## 削除と違い、確認を挟まない
 *
 * `git remote rename` は**必要なものを全部追随させる**（実物で確かめてある。
 * main/git/gitRemoteRepository.test.ts）。
 *
 *   `remote.<新名>.url` / `.fetch`   … 設定ごと移り、refspec の行き先も書き換わる
 *   `refs/remotes/<新名>/*`          … remote-tracking ref も改名される
 *   `branch.*.remote`                … **追っていたブランチの追跡先も追随する**
 *   `remote.pushDefault`             … 指していれば、それも追随する
 *
 * つまり `↑2 ↓1` は消えず、rename の後の Push もそのまま通る ──
 * **失われるものが1つも無い。** 3-8-14 でブランチの rename に確認を
 * 置かなかったのとまったく同じ判断になる（削除にだけ確認がある）。
 *
 * 3-8-16 が「消して足し直すのとは別の設計が要る」と書いたのは正しかったが、
 * 難しい側ではなく**易しい側**に別だった ── remove + add は追跡先を失うが、
 * rename は失わない。
 *
 * ## 大文字小文字だけの改名は、ここへ来ない
 *
 * Windows では `refs/remotes/origin/…` と `refs/remotes/Origin/…` が同じ
 * ファイルになるため、`git remote rename origin Origin` は
 * `cannot lock ref` で落ちる ── しかも**途中まで適用したまま**止まり、
 * `remote.Origin.url` だけが書かれて refspec も remote-tracking ref も
 * `branch.*.remote` も古い名前を指したままになる（実物で確かめてある）。
 *
 * ブランチ（3-8-14）ではそこを `--force` で通したが、
 * **`git remote rename` に force は無い。** したがって git を動かす前に
 * 断る ── Renderer は押せない状態にし（renderer/src/git/gitRemotes.ts）、
 * Main も届いた値を確かめて `unsupported-target` を返す
 * （main/git/gitRemotes.ts）。同じ問いに対して 3-8-14 と逆の答えになるのは、
 * git が用意している逃げ道の有無がそこで分かれるためになる。
 */
export interface RenameGitRemoteRequest {
  /** 改名する remote 名（一覧の行が持っていたもの）。 */
  readonly name: string
  /** 新しい名前。元と同じ規則（`normalizeGitRemoteName`）を通る。 */
  readonly newName: string
}

/**
 * remote を1つ削除する要求（Session 3-8-16）。
 *
 * ## 載るのは名前だけ
 *
 * URL も「確認したか」も欄が無い。後者は 3-8-14 / 3-8-15 と同じ判断で、
 * 確認を通した証を引数に載せると、載せなければ確認を飛ばせる形になる。
 *
 * ## 何が失われるか
 *
 * `git remote remove` が消すのは3つになる（実物で確かめてある。
 * main/git/gitRemoteRepository.test.ts）。
 *
 *   `remote.<名前>.*`            … URL と fetch の refspec
 *   `refs/remotes/<名前>/*`      … 手元に持っていた remote-tracking ref
 *   `branch.*.remote` / `.merge` … **その remote を追っていたブランチの追跡先**
 *
 * commit は1つも失われない（到達できなくなる ref は remote-tracking だけで、
 * それは次の fetch で戻る）。それでも確認を挟むのは、3つめのため ──
 * 追跡先が消えると、画面の `↑2 ↓1` が消え、Push が
 * 「初回の Push」（`--set-upstream`）に戻る。
 */
export interface RemoveGitRemoteRequest {
  /** 削除する remote 名（一覧の行が持っていたもの）。 */
  readonly name: string
}

/**
 * 退避の一覧の応答（Session 3-8-15）。
 *
 * ## 相乗りさせていないのは、これで3つめ
 *
 * ブランチ（`ListGitBranchesResponse`）・履歴（`ListGitCommitsResponse`）と
 * まったく同じ理由で、`git:get-repository` に載せない ── **見られている時間が
 * 違う。** 変更ファイルの一覧はパネルが開いている間ずっと出ているが、
 * 退避の一覧は面を開いている間だけになる。相乗りさせると、ファイルを
 * 保存するたびに `git stash list` を1回起動することになる。
 *
 * ## 開いている間は追いつく（履歴と同じ側）
 *
 * ブランチの一覧は「開いた瞬間に取り直して、閉じるまでそのまま」だったが、
 * 退避はそうしない ── 端末で `git stash` を打つことがあり、そのとき
 * 出たままの一覧は「さっき避けたものが無い」という形で嘘をつく。
 * しかも退避では**その嘘が押し間違いに直結する**（番号がずれる。
 * shared/git/stash.ts）ため、履歴よりさらに追いつく必要が強い。
 */
export interface ListGitStashesResponse {
  /** どの Workspace について答えたか。未選択なら null（他の応答と同じ理由）。 */
  readonly workspaceId: string | null
  /** 退避の一覧、またはそれを出せない理由（shared/git/stash.ts）。 */
  readonly listing: GitStashListing
}

/**
 * 指した退避を1件だけ相手にする要求（Session 3-8-15）。
 *
 * ## 1つの要求で「位置」と「同一性」を運ぶ、初めての形
 *
 * 3-8-14 の rename は1要求に2つの値（元の名前と新しい名前）を運んだが、
 * どちらも**指す先が違うもの**だった。こちらの2つは**同じ1件を指している** ──
 * `index` が「どこに居るか」、`shortHash` が「それは何か」になる。
 *
 * 分けているのは、`index` が動くためになる（shared/git/stash.ts）。一覧を
 * 出してから押すまでの間に端末で `git stash` を1回打たれると、`stash@{1}` は
 * 別の退避を指す ── **番号だけの要求は、その瞬間に嘘になる。**
 *
 * Main は git を動かす前に `stash@{index}` を解いて `shortHash` と
 * 突き合わせ、違えば `stash-not-found` として断る（main/git/gitStash.ts）。
 * 3-8-14 が `--force` を立てる前に「相手は自分自身か」を確かめたのと同じ構えで、
 * **戻せない操作の直前にもう一度だけ確かめる**ことになる。
 *
 * ## pop と drop で同じ型を使う
 *
 * 指し方がまったく同じで、片方にだけ足したくなる欄が無いため
 * （`--index` も `-q` も欄そのものを作っていない）。チャンネルは
 * 「操作ごとに1本ずつ」の決めごとどおり分けてある ── 1本にして
 * 「捨てるかどうか」を引数に持たせると、いつか片方の意味でもう片方が動く。
 */
export interface GitStashEntryRequest {
  /**
   * `stash@{N}` の N。
   *
   * 数で渡す ── 文字列（`stash@{1}`）で渡すと、境界を越えた文字列を
   * そのまま git の ref として読ませることになる。整数なら、ハンドラが
   * 「0 以上・上限未満の安全な整数か」だけを見れば済み、`stash@{...}` の形を
   * 組み立てるのは Main の表（main/git/gitCommands.ts）に閉じる。
   */
  readonly index: number
  /**
   * その位置に居るはずの退避の短い hash（一覧の行が持っていたもの）。
   *
   * 通る形は commit の詳細・ブランチの始点とまったく同じ 16進 4〜40 桁で、
   * 確かめる関数も同じ `normalizeGitCommitHash` になる ── **退避も commit** で、
   * 「画面に出ている行を指すための欄」という性格も変わらない（§14.20）。
   */
  readonly shortHash: string
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
 * 「押した行1つ」より広い範囲を消す（ARCHITECTURE.md §14.16）。
 */
export interface DiscardGitChangesRequest {
  readonly target: GitDiscardTarget
}

/**
 * 競合している1件を「解決済み」として記録する要求（Session 3-8-18）。
 *
 * ## 3-8-2 から在った競合のグループに、初めて操作が付く
 *
 * それまで競合の行にできたのは**エディタで開くこと**だけだった
 * （renderer/src/git/gitChanges.ts の `canOpenGitChange` は競合を通す）──
 * つまり利用者はアプリの中で競合を直せるのに、**直したと Git へ伝える
 * 手段が無かった。** その間、アプリ自身は3箇所で「解決してください」と
 * 言っていた（Commit の失敗・退避が押せない理由・pop の結末）。
 * 3-8-18 で埋めるのはそこになる（docs/ARCHITECTURE.md §14.26）。
 *
 * ## 載るのは位置1つだけ
 *
 * `DiscardGitChangesRequest` と違い、グループは載らない ── 対象は必ず
 * 競合のグループの行で、他のグループから押せる場所がそもそも無い。
 * 「すべて解決済みにする」も無い（渡せるのは1件で、複数を渡せる欄は
 * 作らない ── Stage の「任意の複数」と同じ線）。
 *
 * ## Stage とは別の口にしてある
 *
 * 動く git は同じ `git add` だが、**意味が違う。**
 *
 *   `git:stage`            … 作業ツリーの姿を、次の Commit の中身へ写す
 *   `git:resolve-conflict` … **競合が解けたことを Git に伝える**（index の
 *                            3段（base / ours / theirs）が1段に畳まれる）
 *
 * 1本にまとめると、競合の行に出したボタンが「Stage」と名乗ることになり、
 * **押した後に何が起きたのかが説明できない** ── `git remote add` を動かす
 * 口を `github:publish` と `git:add-remote` に分けてあるのと同じ判断で、
 * **動かす git が同じでも、意味が違えば口を分ける**（§14.24）。
 *
 * ## 取り消す口は持たない（3-8-18 の範囲外）
 *
 * `git reset HEAD -- <path>` は**競合を復元しない** ── 3段が畳まれた
 * ただの変更として残る（実物で確かめてある）。復元できるのは
 * `git checkout --merge` だが、それは**利用者が書いた解決内容を
 * 上書きする。** どちらも「取り消し」として出せる振る舞いではないため、
 * 口そのものを作っていない（docs/ARCHITECTURE.md §14.26）。
 *
 * ## 「確認したか」の欄は無い
 *
 * 3-8-14 以降と同じ判断。ただしこの操作に確認は挟まない ── 失われるのは
 * index の3段だけで、**利用者が書いた中身は1文字も動かない**（作業ツリーに
 * 触らない）。
 */
export interface ResolveGitConflictRequest {
  /** 競合しているファイルの、Workspace root からの相対位置（区切りは `/`）。 */
  readonly relativePath: string
}

export interface GitIpcContract {
  'git:get-repository': {
    request: void
    response: GetGitRepositoryResponse
  }
  /**
   * 今の Workspace を Git リポジトリにする（Session 3-8-10）。
   *
   * ## 要求は `void`
   *
   * どこを初期化するかは載らない ── 対象は常に「今の Workspace」で、
   * それを持っているのは Main（main/workspaceFolder/currentWorkspaceFolder.ts）に
   * なる。初期ブランチ名も、テンプレートも、`--bare` も欄そのものが無い
   * （main/git/gitCommands.ts）。
   *
   * ## ここで終わる操作にしてある
   *
   * `git init` は**それだけで完結する1つの操作**で、初回 Commit も
   * `.gitignore` の生成も remote の設定も続けて行わない。3-8-1 で
   * 「途中まで自動でやって止まると、利用者が自分で片付けられない中途半端な
   * リポジトリが残る」として初期化そのものを見送ったが、答えは
   * 「一続きにする」ではなく**「一続きにしない」**の側になった ──
   * 初期化した後に何を最初の commit に含めるかは利用者の判断で、
   * アプリが決めてよいことではない（shared/git/operation.ts の `no-commit`）。
   *
   * GitHub への公開（`github:publish`）とも**完全に別の操作**にしてある。
   * 初期化した後に公開を促すことはしない ── Git は GitHub のためだけの
   * ものではなく、ここで Commit / Branch / Diff / 破棄はすべて使えるようになる。
   *
   * 応答は他の書き込み操作と同じ `GitOperationResponse` で、**初期化後の状態が
   * 丸ごと載る**（`not-a-repository` から `ready` へ変わる）。
   */
  'git:init': {
    request: void
    response: GitOperationResponse
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
   * commit の履歴を尋ねる（Session 3-8-11）。
   *
   * ## 要求は `void` のまま
   *
   * **rev も件数も並べ替えも絞り込みも、渡す欄そのものが無い。**
   * 出てくるのは常に「今の HEAD からさかのぼった 100 件」だけになる
   * （shared/git/history.ts）。
   *
   * ここは欄を作りたくなる場所にあたる ── 別のブランチの履歴を見る・
   * 特定のファイルの履歴だけを見る・作者で絞る。どれも `git log` に
   * 値を渡す形になり、その値は rev（`HEAD~5`）でも pathspec でも
   * `--author=<正規表現>` でもありうる。3-8-1 で決めたとおり、
   * **危ないものを弾くのではなく渡せる欄そのものを作らない。**
   *
   * 見ているブランチを変える手立ては既にある（上のバーで切り替える）──
   * 切り替えれば、履歴もそのブランチのものになる。
   *
   * ## 読み取りだが、別の1本にしてある
   *
   * `git:list-branches` と同じ理由で、`git:get-repository` に相乗りさせない
   * （`ListGitCommitsResponse`）。書き込みの口も持たない ── revert も
   * cherry-pick も reset も amend も、この面から動かせるものは1つも無い。
   */
  'git:list-commits': {
    request: void
    response: ListGitCommitsResponse
  }
  /**
   * commit 1件の変更ファイルを尋ねる（Session 3-8-12）。
   *
   * ## 履歴と別の1本にしてある
   *
   * `git:list-commits` に相乗りさせると、100 件ぶんの変更ファイルを
   * 毎回読むことになる ── 開かれるのはそのうち1件で、しかも開くかどうかは
   * 利用者が決める。`git:list-branches` を `git:get-repository` から
   * 分けたのとまったく同じ判断で、**見られている時間が違う。**
   *
   * ## マージ commit は「失敗」ではなく「答え」として返る
   *
   * 親が2つ以上ある commit では、どちらの親と比べるかが決まらない
   * （shared/git/commitDetail.ts）。応答の `detail.reason` に `merge` が載り、
   * 画面はその理由をそのまま出す ── `IpcResult` の失敗に丸めると、
   * 「取得できませんでした」という別の意味になる。
   */
  'git:get-commit-detail': {
    request: GetGitCommitDetailRequest
    response: GetGitCommitDetailResponse
  }
  /**
   * commit の中の1ファイルの差分を尋ねる（Session 3-8-12）。
   *
   * `git:get-file-diff` と別の1本にしてある。**同じチャンネルに
   * 「作業ツリーの差分」と「commit の差分」を同居させない** ── 前者は
   * `group`（今の作業ツリーのどの段か）で相手が決まり、後者は rev で決まる。
   * 1本にすると、要求の中で片方だけが意味を持つ欄が2つ並び、
   * いつか group を付けたまま rev が効く（あるいはその逆）が起こる。
   *
   * 返るのは patch ではなく**中身2つ**で、そこは 3-8-9 と同じになる
   * （shared/git/commitDetail.ts）。
   */
  'git:get-commit-file-diff': {
    request: GetGitCommitFileDiffRequest
    response: GetGitCommitFileDiffResponse
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
   * ローカルブランチを削除する（Session 3-8-14）。
   *
   * ## 切り替え / 作成と別の1本にしてある
   *
   * 「操作ごとに1本ずつ」の決めごとどおりだが、ここでは理由がもう1つある ──
   * 動かす git が違う。切り替えも作成も `git switch` で**作業ツリーを
   * 書き換える**操作だったが、削除は `git branch --delete` で
   * **ref を1つ消すだけ**にあたる。押した人の書きかけには何も起こらない。
   *
   * ## 失われるのは名前と reflog
   *
   * `-d` が通るのは「HEAD か追跡先にマージ済み」のときだけなので、
   * 成功した削除で commit が到達不能になることは無い。それでも確認を挟むのは、
   * **枝の名前とその reflog が消える**ためと、押す場所が一覧の行の上
   * （切り替えるつもりで当たる距離）にあるためになる（§12.6）。
   *
   * 応答は他の書き込み操作と同じ `GitOperationResponse` で、削除後の状態が
   * 丸ごと載る ── ただし**ブランチの一覧はそこに載らない**（3-8-6 からの分担）。
   * 面は開いたままなので、Renderer が通った後に取り直す
   * （renderer/src/git/useGitRepository.ts）。
   */
  'git:delete-branch': {
    request: DeleteGitBranchRequest
    response: GitOperationResponse
  }
  /**
   * ローカルブランチの名前を変える（Session 3-8-14）。
   *
   * 削除と同じ `git branch` だが、**別の1本**にしてある。1本にして
   * 「新しい名前があれば改名、無ければ削除」のような区別を引数に持たせると、
   * いつか片方の意味でもう片方が動く ── `git:stage` と `git:unstage` を
   * 分けてあるのと同じ判断になる。
   *
   * 削除と違い、**失われるものが1つも無い**（ref の名前が変わるだけで、
   * commit も作業ツリーも index も動かない）。したがって確認は挟まず、
   * 入力欄から直接動く ── 確認を出すこと自体が目的ではない（§12.6）。
   *
   * 今そこに居るブランチも改名できる。git は HEAD を追随させ、
   * 未コミットの変更もそのまま残る（実物で確かめてある。
   * main/git/gitBranchRepository.test.ts）── 応答に載る状態で
   * 上のバーの表示がそのまま新しい名前に変わる。
   */
  'git:rename-branch': {
    request: RenameGitBranchRequest
    response: GitOperationResponse
  }
  /**
   * remote-tracking branch の一覧を尋ねる（Session 3-8-19）。
   *
   * 要求は `void` ── remote 名で絞る欄も、並べ替えも、件数も、
   * **fetch するかどうか**も指定できない（`git:list-branches` と同じ形）。
   * 返るのは常に「今の Workspace の `refs/remotes/` に在るものを、上限まで」になる。
   *
   * `git:list-branches` と**別の1本**にしてある理由は3つ
   * （`ListGitRemoteBranchesResponse`）── 動かす git が違う・上限が別々に効く・
   * 押したときに起きることが違う。
   */
  'git:list-remote-branches': {
    request: void
    response: ListGitRemoteBranchesResponse
  }
  /**
   * remote-tracking branch を追うローカルブランチを作って、そこへ切り替える
   * （Session 3-8-19）。
   *
   * ## `git:create-branch` と別の1本にしてある
   *
   * 「操作ごとに1本ずつ」の決めごとどおりだが、ここでは理由がもう2つある。
   *
   *   - **始点に通る値の形が違う。** あちらは短い hash（16進 4〜40 桁）だけで、
   *     こちらは ref 名になる。1本にすると、3-8-12 から引いてきた
   *     「渡せるのは画面に出ている commit を指す hash だけ」が広がる
   *   - **追跡先が付く。** `.git/config` に2行書かれ、この操作の後は
   *     Push / Pull の相手が決まる。送り先が決まる操作を、決まらない操作と
   *     同じ口に乗せない
   *
   * ## 名前が埋まっていたら、git を動かす前に断る
   *
   * 同じ名前のローカルブランチが既にある場合、Main は
   * **`git switch` を1度も動かさずに** `branch-exists` を返す
   * （main/git/gitRemoteBranches.ts）。上書きも（`--force` を渡さない）、
   * 削除も、既にあるブランチへの自動切替も行わない ── どれも
   * 「押した人が指していないもの」を相手にすることになる（3-8-13 /
   * 3-8-16 と同じ線）。次の一手は「別の名前を打つ」で、それは同じ欄に在る。
   *
   * 応答は他の書き込み操作と同じ `GitOperationResponse` で、作成 → 切り替えの
   * 後の状態が丸ごと載る（バーのブランチ名も `↑ ↓` も一緒に変わる）──
   * ただし**一覧はそこに載らない**（3-8-6 からの分担）。
   */
  'git:create-tracking-branch': {
    request: CreateGitTrackingBranchRequest
    response: GitOperationResponse
  }
  /**
   * remote の一覧を尋ねる（Session 3-8-16）。
   *
   * 要求は `void` ── 並べ替えも絞り込みも件数も指定できない
   * （`git:list-branches` / `git:list-commits` / `git:list-stashes` と同じ形）。
   * 返るのは常に「今の Workspace に登録されている remote を、上限まで」になる。
   *
   * 読み取りだが `git:get-repository` とは別の1本にしてある ──
   * リポジトリの状態が持つのは今も `hasRemote`（有無だけ）で、
   * 見られている時間が違う（`ListGitRemotesResponse`）。
   */
  'git:list-remotes': {
    request: void
    response: ListGitRemotesResponse
  }
  /**
   * remote を1つ追加する（Session 3-8-16）。
   *
   * ## `github:publish` と**別の口**にしてある
   *
   * どちらも最終的には `git remote add` を動かすが、混ぜない。
   *
   *   `github:publish` … GitHub に repository を**作り**、その URL を
   *                      `origin` として設定し、初回 Push まで行う。
   *                      名前は固定（`origin`）で、URL は GitHub が返した
   *                      ものになる ── **Renderer から URL は来ない**
   *   `git:add-remote` … 既にどこかに在るものを、名前と URL で**登録する**。
   *                      ネットワークへは出ない
   *
   * 1本にすると、「公開」の口から任意の URL を渡せることになる ──
   * `addOriginRemote` が Renderer 由来の値を1つも受け取らない、という
   * 3-8-10 の保証がそこで消える（main/git/gitCommands.ts）。
   *
   * ## `set-url`（URL の変更）は、この口の先には無い
   *
   * `git remote add` は名前が既にあれば**失敗する。** それがここで欲しい
   * 振る舞いになる ── 足すつもりで押したら送り先が入れ替わっていた、
   * という形を作らない。URL を変える口は 3-8-17 で**別の1本**として足した
   * （`git:set-remote-url`）── あちらは押す前に「今どこを指していて、
   * これからどこを指すか」を見せる（docs/ARCHITECTURE.md §14.25）。
   *
   * 応答は他の書き込み操作と同じ `GitOperationResponse` で、追加後の状態が
   * 丸ごと載る（`hasRemote` が false から true へ変わり、公開の入口が消える）──
   * ただし**remote の一覧はそこに載らない**。面は開いたままなので、
   * Renderer が通った後に取り直す（renderer/src/git/useGitRepository.ts）。
   */
  'git:add-remote': {
    request: AddGitRemoteRequest
    response: GitOperationResponse
  }
  /**
   * remote の URL を変える（Session 3-8-17）。
   *
   * ## `git:add-remote` と**別の1本**にしてある
   *
   * 動かす git は同じ `git remote` だが、混ぜない ── 1本にして
   * 「既にあれば上書き」にすると、3-8-16 が `remote-exists` で断ると
   * 決めた振る舞いがそこで消え、**足すつもりで押したら送り先が
   * 入れ替わっていた**が生まれる。`git:stage` と `git:unstage`、
   * `git:delete-branch` と `git:rename-branch` を分けてあるのと同じ判断になる。
   *
   * ## 押す前に見せてから適用する
   *
   * Git で確認を挟む**5つめ**で、この5つの中でいちばん軽い ── 破棄
   * （§14.16）→ ブランチの削除（§14.22）→ 退避を捨てる（§14.23）→
   * remote の削除（§14.24）→ ここ。**失われるものが1つも無い**唯一の確認に
   * あたる（`SetGitRemoteUrlRequest`）。それでも挟むのは、変更が
   * **見えないところで効く**ため ── 変わるのは設定の1行だけで、画面の
   * `↑2 ↓1` は前の相手と比べた数のまま残る。
   *
   * 確認に出すのは、一覧の行が持っているラベル（今どこを指しているか）と、
   * 利用者がその欄に打った URL の2つになる ── **どちらも新しく境界を
   * 渡る値ではない**（URL は Renderer が今その場で打った文字列で、
   * Main から返ってきたものではない）。3-8-16 の
   * 「URL は Renderer へ渡さない」は1文字も動いていない。
   *
   * 応答は他の書き込み操作と同じ `GitOperationResponse` で、変更後の状態が
   * 丸ごと載る ── ただし `hasRemote` は変わらない（remote の数は増えも
   * 減りもしない）。一覧はそこに載らないので、面が開いたままの Renderer が
   * 通った後に取り直す（renderer/src/git/useGitRepository.ts）。
   */
  'git:set-remote-url': {
    request: SetGitRemoteUrlRequest
    response: GitOperationResponse
  }
  /**
   * remote の名前を変える（Session 3-8-17）。
   *
   * ## 削除 + 追加ではない
   *
   * 結果だけ見れば同じに見えるが、**残るものが違う。**
   * `git remote remove` は追っていたブランチの追跡先まで消すのに対し、
   * `git remote rename` は追跡先も remote-tracking ref も
   * `remote.pushDefault` も全部追随させる（`RenameGitRemoteRequest`）──
   * したがって rename の後も `↑2 ↓1` は消えず、Push は
   * 「初回の Push」に戻らない。
   *
   * 2つの口でできることをアプリの中で組み合わせない、という線でもある ──
   * remove → add の2段を代わりに動かすと、途中で止まったときに
   * **remote が1つも無いリポジトリ**が残る（3-8-10 の `git init` で
   * 「一続きにしない」と決めたのと同じ事情）。
   *
   * ## 確認は挟まない
   *
   * 失われるものが1つも無いため（3-8-14 のブランチの rename と同じ）。
   * 削除にだけ確認がある、という並びは remote でも変わらない。
   *
   * ## 一括の rename は無い
   *
   * 渡せるのは1件で、複数を渡せる欄は作らない（Stage の「任意の複数」・
   * ブランチの一括削除・`stash clear`・remote の一括削除と同じ線）。
   */
  'git:rename-remote': {
    request: RenameGitRemoteRequest
    response: GitOperationResponse
  }
  /**
   * remote を1つ削除する（Session 3-8-16）。
   *
   * 追加と同じ `git remote` だが、**別の1本**にしてある。1本にして
   * 「URL があれば追加、無ければ削除」のような区別を引数に持たせると、
   * いつか片方の意味でもう片方が動く ── `git:stage` と `git:unstage`、
   * `git:delete-branch` と `git:rename-branch` を分けてあるのと同じ判断になる。
   *
   * 消えるのは設定と remote-tracking ref だけで、commit は1つも失われない
   * （`RemoveGitRemoteRequest`）。それでも確認を挟むのは、**その remote を
   * 追っていたブランチの追跡先まで消える**ためになる。
   *
   * 一括で消す口（`git remote prune` / 複数指定）は無い ── 渡せるのは
   * 1件で、複数を渡せる欄は作らない（Stage の「任意の複数」・ブランチの
   * 一括削除・`stash clear` と同じ線）。
   */
  'git:remove-remote': {
    request: RemoveGitRemoteRequest
    response: GitOperationResponse
  }
  /**
   * 退避の一覧を尋ねる（Session 3-8-15）。
   *
   * 要求は `void` ── どのブランチのものを、いくつ、という指定は1つも載らない
   * （`git:list-branches` / `git:list-commits` と同じ形）。返るのは常に
   * 「今の Workspace の退避を、新しい方から上限まで」になる。
   *
   * **退避はブランチに属さない。** `refs/stash` は1つで、どのブランチで
   * 避けたものも同じ列に並ぶ ── したがって「このブランチの退避だけ」という
   * 欄は、作らないのではなく**在りようが無い**ことになる。
   */
  'git:list-stashes': {
    request: void
    response: ListGitStashesResponse
  }
  /**
   * 作業ツリーの変更を退避する（Session 3-8-15）。
   *
   * ## 要求は `void`
   *
   * **名前（`-m`）も、何を含めるか（`-u` / `-a`）も、対象の位置（pathspec）も
   * 渡す欄が無い。** 退避するのは常に「今の作業ツリーと index の全部」で、
   * 名乗りは git が付ける（`WIP on <branch>: ...`）── 3-8-10 で初期ブランチ名を
   * 素の `git init` に任せたのと同じ線になる。
   *
   * とくに `-u`（未追跡も含める）を渡さないのは、3-8-9 の判断と繋がっている ──
   * あちらは「未追跡のフォルダ1件の破棄」を、1行に見えて中身が数万件に
   * なりうるとして断った。退避も同じ形で作業ツリーから消す操作にあたる。
   *
   * ## 確認を挟まない
   *
   * 破棄（3-8-9）とブランチの削除（3-8-14）に確認が要るのは、**戻す先が
   * 無い**ためだった。退避は戻す先そのもの ── 押した内容は一覧に残り、
   * その場で pop できる（§12.6 の「確認を出すこと自体が目的ではない」）。
   */
  'git:stash-push': {
    request: void
    response: GitOperationResponse
  }
  /**
   * 指した退避を作業ツリーへ戻し、一覧から取り除く（Session 3-8-15）。
   *
   * ## `apply`（残したまま戻す）の口は持たない
   *
   * 「戻す」の入口を2つにしない ── 押した後に一覧へ残るかどうかが
   * ボタン次第で変わると、**どちらを押したかを覚えていないと今の状態が
   * 分からない。** 戻さずに残しておきたいなら、そもそも押さなければよい。
   *
   * ## `--index` は渡さない
   *
   * 退避したときに index に載っていたものは、戻ると **unstaged** として並ぶ
   * （実物で確かめてある）。段まで復元する `--index` は競合したときの
   * 振る舞いが増えるだけで、Stage は一覧の `＋` を押せば1回で戻せる。
   *
   * ## 競合したら `partly-applied` で返る
   *
   * `pop` は merge なので、中身が作業ツリーへ**書き込まれたうえで**競合しうる。
   * そのとき git は退避を捨てず、一覧に残す ── 結末は `failed` ではなく
   * `partly-applied`（`completed: 'stash-apply'`）になる
   * （shared/git/operation.ts）。
   */
  'git:stash-pop': {
    request: GitStashEntryRequest
    response: GitOperationResponse
  }
  /**
   * 指した退避を捨てる（Session 3-8-15）。
   *
   * ## Git で確認を挟む、3つめ
   *
   * 1つめは破棄（3-8-9）、2つめはブランチの削除（3-8-14）。ここで消えるのは
   * **作業ツリーに戻していない中身**そのもので、3つの中でいちばん重い ──
   * 削除は「マージ済みのブランチ」しか通らないので commit は残るが、
   * 捨てた退避の中身はどのブランチからも辿れない。
   *
   * それでも `IpcResult` の失敗にせず結末として返すのは他と同じで、
   * 確認は Renderer の中の話になる ── **要求に「確認したか」の欄は無い**
   * （3-8-14 と同じ判断。載せると、載せなければ確認を飛ばせる形になる）。
   *
   * ## 一括で捨てる口（`clear`）は無い
   *
   * 渡せるのは1件で、複数を渡せる欄は作らない（Stage の「任意の複数」・
   * ブランチの一括削除と同じ線）。
   */
  'git:stash-drop': {
    request: GitStashEntryRequest
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
  /**
   * 競合している1件を「解決済み」として記録する（Session 3-8-18）。
   *
   * ## `git:stage` と別の1本にしてある
   *
   * 動かす git は同じ `git add` だが混ぜない ── 1本にすると、競合の行に
   * 出したボタンが「Stage」と名乗ることになり、押した後に index の3段が
   * 畳まれたことを説明できなくなる（`ResolveGitConflictRequest`）。
   * `git:stage` / `git:unstage`、`github:publish` / `git:add-remote`、
   * `git:add-remote` / `git:set-remote-url` を分けてあるのと同じ判断になる。
   *
   * ## Main は git を2回動かす
   *
   * 1回目は**押せるかを確かめるため**で、`git diff --check` になる ──
   * git は競合マーカーが残ったままの `add` も、その後の Commit も通して
   * しまい、**マーカーがそのまま履歴に残る**（実物で確かめてある）。
   * 履歴に永久に残るものを、押し間違いで作らせない。
   * 残っていれば `conflict-markers-present` を返し、**2回目は動かさない**
   * （shared/git/operation.ts）。
   *
   * ## 応答は他の書き込み操作と同じ
   *
   * `GitOperationResponse` に操作後の状態が丸ごと載る ── 通れば競合の
   * グループからその行が消え、ステージ済みへ移る。**競合が最後の1件
   * だったなら、その時点で Commit が押せるようになる**（3-8-4 の
   * `unresolved-conflicts` が解ける）。
   */
  'git:resolve-conflict': {
    request: ResolveGitConflictRequest
    response: GitOperationResponse
  }
}
