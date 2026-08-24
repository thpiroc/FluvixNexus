/**
 * Git の**書き込み操作**（Session 3-8-3 の Stage / Unstage、Session 3-8-4 の Commit、
 * Session 3-8-5 の Push / Pull / Commit & Push、Session 3-8-6 のブランチの
 * 切り替え / 作成、Session 3-8-9 の破棄、Session 3-8-10 の初期化と公開）。
 *
 * ## repository.ts / status.ts との分担
 *
 * repository.ts が「始められるか」、status.ts が「何が変わっているか」を答えるのに対し、
 * こちらは**それを動かす**側になる。Git 機能で Renderer からの要求が
 * リポジトリを書き換えるのは、これが最初の1つにあたる。
 *
 * ## Renderer が言えることを、操作の意味の分だけに絞る
 *
 * 3-8-1 で引いた線（shared/ipc/contracts/git.ts）は「git の引数を渡せる欄を作らない」
 * だった。書き込みが入っても、その線は1mm も動かさない。
 *
 *   渡せる   … Workspace root からの相対位置1つ / グループの区別（閉じた集合）
 *   渡せない … git のコマンド名・引数・作業ディレクトリ・実行ファイル・シェル
 *
 * Session 3-8-5 の Push / Pull で**渡せるものはさらに減る**（要求が `void` に戻る）。
 * remote 名もブランチ名も refspec も載せない ── どれを相手にするかは
 * リポジトリの設定（`branch.<name>.remote` / upstream）が既に持っていて、
 * Renderer から名前で指せる形にすると「画面に出ているブランチとは別のものへ
 * 送れる欄」を作ることになる。
 *
 * `git add -- <path>` の `--` より後ろに入る**値だけ**が Renderer から来て、
 * それ以外はすべて Main の表（main/git/gitCommands.ts）が持つ。値は Main 側で
 * pathspec として通してよい形かを確かめてから使う（main/git/gitPathspec.ts）。
 *
 * ## グループの「すべて」は path の配列にしない
 *
 * 「変更のすべてを Stage」を **path の配列**で表すと、Renderer が任意の複数 path を
 * 一度に渡せる形になる ── それは Session 3-8-3 の範囲外（複数ファイルの任意選択）で
 * あるだけでなく、**渡せる欄を広げる**ことになる。代わりに渡すのは
 * 「どのグループか」という閉じた値1つで、そこに何が入っているかは
 * Main が自分で読んだ status から決める（main/git/gitStage.ts）。
 *
 * こうすると画面に出ている一覧と、実際に Stage されるものが**同じ読み取りから
 * 出てくる**ことも保証できる。Renderer が抱えていた古い一覧を送り返す形にすると、
 * 消えたファイルや、その間に競合に変わったファイルまで対象になりうる。
 *
 * shared 層のルールどおり、このファイルは型だけを持つ。
 */

/**
 * 何を Stage するか。
 *
 * ファイル単位と、グループ単位の「すべて」。**任意の複数選択は無い**
 * （Session 3-8-3 の範囲外。上記のとおり渡せる欄を広げないため）。
 */
export type GitStageTarget =
  /** その1件だけ（unstaged の行・untracked の行の `+`）。 */
  | { readonly kind: 'file'; readonly relativePath: string }
  /**
   * 「変更」グループのすべて。
   *
   * `git add -u`（作業ツリー全体）にしないのは、**衝突しているファイルまで
   * 巻き込む**ため ── `git add` は衝突を「解決済み」として index に載せてしまう。
   * 画面では競合を別のグループに分けてある（shared/git/status.ts）のに、
   * 「変更のすべて」を押したら競合まで解決されたことになる、という食い違いを作らない。
   */
  | { readonly kind: 'unstaged' }
  /** 「未追跡のファイル」グループのすべて（フォルダ1件も含む）。 */
  | { readonly kind: 'untracked' }

/**
 * 何を Unstage するか。
 *
 * **ファイル単位だけ**にしてある。Stage と対称にしていないのは、
 * 「ステージ済みのすべてを戻す」が Commit の中身を丸ごと空にする操作で、
 * 押し間違えたときに取り返しにくいため（戻せない操作の確認の形は
 * discard / reset と一緒に設計する。DESIGN.md）。
 */
export interface GitUnstageTarget {
  readonly relativePath: string
}

/**
 * 何を破棄するか（Session 3-8-9）。
 *
 * ## ここだけは、失われるものが戻ってこない
 *
 * Stage / Unstage は index を動かすだけで、作業ツリーの中身は残る。Commit は
 * 履歴に足す。Push / Pull / 切り替えは git が「失われるなら断る」を自分で決める。
 * **破棄はその外側にある** ── 書いたものを消すことが目的の操作にあたる。
 * したがって渡せる欄は、他のどの操作よりも狭くしてある。
 *
 * ## `staged` を渡せない
 *
 * 「ステージ済みの変更を破棄」は、実際には**2つの操作**（index を戻す ＋
 * 作業ツリーを戻す）で、押した人から見て失われるものが1回で2段になる。
 * ここでは受け取らず、**先に Unstage してもらう** ── そうすれば
 * 「index を戻した」と「作業ツリーを戻した」が別々の1回として画面に出る
 * （`git:unstage` と `git:discard` を1本にしない理由でもある）。
 *
 * ## `conflicted` を渡せない
 *
 * 衝突は Stage / Unstage が成立しないのと同じ理由で、破棄も成立しない
 * （何に戻すのかが ours / theirs / merge base の3つに分かれる）。
 * 解決の UI と一緒に設計する。
 *
 * ## グループの「すべて」が無い
 *
 * Stage には「変更のすべて」があるが、破棄には置いていない。**押し間違いの
 * 代償が釣り合わない** ── Stage の押し間違いは Unstage で戻せるが、
 * こちらは戻せる先が無い。渡せるのは常に1件だけになる。
 */
export interface GitDiscardTarget {
  /**
   * どちらのグループの1行か。
   *
   * **グループごとに、行うことがまるごと違う**（ARCHITECTURE.md §14.16）。
   *
   *   unstaged  … `git restore --worktree`（index には触らない）
   *   untracked … OS のごみ箱へ送る（`git clean` は使わない）
   *
   * 位置だけを渡す形にすると、同じファイルが2つのグループに並んでいるときに
   * どちらを指しているのかが決まらない。
   */
  readonly group: 'unstaged' | 'untracked'
  /** Workspace root からの相対位置（区切りは `/`）。 */
  readonly relativePath: string
}

/**
 * 操作が通らなかった理由。
 *
 * `GitFailureReason`（repository.ts）と別の型にしてある。あちらは
 * 「リポジトリを調べられなかった」の分類で、Git パネル全体の見た目を決めるもの。
 * こちらは**リポジトリは見えているのに、その1回の操作が通らなかった**で、
 * 一覧はそのまま出したまま、行の近くに理由だけを出したい。
 *
 * 分ける基準は repository.ts と同じ ──「利用者の次の一手が変わるか」。
 * 生の stderr は渡らない（分類するのは Main。main/git/gitFailure.ts）。
 */
export type GitOperationFailureReason =
  /**
   * もう操作できる状態ではない。
   *
   * Workspace が閉じられた・リポジトリでなくなった・root が食い違うようになった。
   * 一緒に返る `repository` が新しい状態を持っているので、画面はそちらへ切り替わる。
   */
  | 'not-ready'
  /**
   * 対象が1件も無かった。
   *
   * グループの「すべて」を押すまでの間に、他の経路（端末での `git add`）で
   * 空になっていた場合に出る。失敗として扱うのは、**押したのに何も起きない**を
   * 黙って通すと「壊れている」と読まれるため。
   *
   * Commit（Session 3-8-4）では「ステージ済みの変更が1件も無い」がこれにあたる。
   * 空の Commit を作る経路（`--allow-empty`）は持たない。
   *
   * ブランチの切り替え（Session 3-8-6）では「**今そこに居るブランチを選んだ**」が
   * これにあたる。一覧では今のブランチも選べるようにしてあり（印は付く）、
   * 押しても git は動かさずにここへ落ちる ── 選べなくすると、
   * 「今どこに居るか」を確かめるために開いた面で、いちばん見たい行だけが
   * 押せない形になる。**失敗として出すが、何も壊れていない。**
   */
  | 'nothing-to-do'
  /**
   * Git の名乗り（`user.name` / `user.email`）が決まっていない（Session 3-8-4）。
   *
   * Commit は「誰が」を記録する操作なので、名乗りが無ければ git は commit を
   * 作らない。**Fluvix Nexus が代わりに決めることはしない** ── 名乗りは
   * リポジトリの履歴に永久に残るもので、アプリが推測した値を黙って刻むのは
   * 利用者が後から直せない（`git config --global user.name` / `user.email` を
   * 設定するのは利用者の判断にあたる）。
   *
   * 他のどれとも次の一手が違う（**待っても・やり直しても直らない**）ため分けている。
   */
  | 'identity-missing'
  /**
   * リポジトリが用意している hook が Commit を止めた（Session 3-8-4）。
   *
   * `pre-commit` / `commit-msg` などは利用者（あるいはそのプロジェクト）が
   * 置いたプログラムで、止めた理由はその hook しか知らない。**アプリが
   * 迂回しない**（`--no-verify` は使わない）ため、次の一手は
   * 「hook が言っていることを端末で確かめる」になる。
   *
   * hook の出力そのものは Renderer へ渡さない ── 任意のプログラムの任意の出力で、
   * 生の stderr を渡さない方針（Session 3-8-1）の中でもっとも当てにならないものにあたる。
   * 詳細は Main のログに残る。
   */
  | 'hook-rejected'
  /**
   * 未解決の競合が残っている（Session 3-8-4）。
   *
   * git は競合が残っている間 commit を作らない。一覧では競合を別のグループとして
   * 出してある（shared/git/status.ts）ため、次の一手は画面の上の方にそのまま見えている。
   */
  | 'unresolved-conflicts'
  /** 指した path が git の知らないものになっていた（消えた・既に Stage が外れていた）。 */
  | 'path-not-found'
  /**
   * ブランチの上に居ない（Session 3-8-5）。
   *
   * detached HEAD、または HEAD が読めない状態にあたる。Push は
   * 「今のブランチを、その追跡先へ送る」操作なので、送り先を決める土台が無い。
   * **アプリが代わりにブランチを作ることはしない** ── どこへ積むかは
   * 利用者の判断で、勝手に作ったブランチは後から気づきにくい。
   *
   * 待っても・やり直しても直らない点で `nothing-to-do` とは違う。
   */
  | 'not-on-branch'
  /**
   * remote が1つも設定されていない（Session 3-8-5）。
   *
   * `git init` しただけのリポジトリがこれにあたる。次の一手は
   * 「GitHub に公開」（Session 3-8-10）か、端末での `git remote add` になる。
   */
  | 'no-remote'
  /**
   * commit がまだ1つも無い（Session 3-8-10）。
   *
   * `git init` の直後がこれにあたる。GitHub への公開でだけ起こる ──
   * **中身の無いリポジトリを公開しない**（DESIGN.md §3 の「初期化 → 初回
   * Commit → 公開」の順を、アプリが飛び越えない）。
   *
   * **アプリが代わりに Commit を作ることはしない。** 何を最初の commit に
   * 含めるかは利用者の判断で、`.gitignore` を書く前に全部入りの commit が
   * 履歴の1つめとして永久に残るのは、後から直しにくい
   * （`identity-missing` でアプリが名乗りを決めないのと同じ判断）。
   *
   * `nothing-to-do` と分けてあるのは、次の一手がはっきり別だから ──
   * あちらは「押した意味が無かった」で、こちらは「先にすることがある」になる。
   */
  | 'no-commit'
  /**
   * 追跡先（upstream）が決まっていない（Session 3-8-5）。
   *
   * Pull にだけ起こる。**Push では起こらない** ── 初回の Push は
   * `--set-upstream` で追跡先そのものを作る側なので、無いことが理由にならない。
   * 逆に Pull は「どこから受け取るか」が無いと始まらず、アプリが
   * 推測で remote を選ぶと、意図しない相手から取り込むことになる。
   */
  | 'no-upstream'
  /**
   * 認証が必要だった（Session 3-8-5）。
   *
   * アプリが呼ぶ git には端末が付いておらず、対話も止めてある
   * （`GIT_TERMINAL_PROMPT=0` と `credential.interactive=false`）。
   * つまり**尋ねられずに即座に失敗する**のが正しい振る舞いで、
   * 見えない場所で入力を待って固まることは無い。
   *
   * **Fluvix Nexus は認証情報を持たない**（設計判断 7）。次の一手は
   * 「Terminal パネルで一度 push / pull し、credential helper に覚えさせる」になる。
   */
  | 'auth-required'
  /**
   * 相手へ届かなかった（Session 3-8-5）。
   *
   * 名前を解決できない・接続を拒まれた・証明書が通らない。どれも
   * 「アプリの外の事情」で、次の一手は待つか、ネットワーク / プロキシを見る。
   * 認証と分けてあるのは、**直す場所がまったく違う**ため。
   */
  | 'network-unavailable'
  /**
   * Push が non-fast-forward で断られた（Session 3-8-5）。
   *
   * remote 側に手元が持っていない commit がある。次の一手は **Pull** で、
   * それは同じパネルの隣のボタンにそのまま在る ── 他のどの失敗とも違い、
   * 「押す先」が画面の中にあるものにあたる。
   *
   * **強制 Push（`--force` / `--force-with-lease`）の口は作らない。**
   * 他人の commit を消しうる操作で、押し間違えたときに戻せない。
   */
  | 'push-rejected'
  /**
   * remote 側が受け取りを断った（Session 3-8-5）。
   *
   * 保護ブランチ・`pre-receive` hook など、**断ったのは相手のサーバー**にあたる。
   * `push-rejected` と分けているのは次の一手が逆だから ── あちらは
   * Pull すれば送れるようになるが、こちらは何度 Pull しても送れない。
   */
  | 'remote-rejected'
  /**
   * GitHub CLI（`gh`）がこの PC で見つからなかった（Session 3-8-10）。
   *
   * 公開でだけ起こる。**アプリが代わりに入れることはしない**（設計判断）──
   * 次の一手は「winget で入れる」で、その1行は Renderer が文字として出す
   * （renderer/src/git/githubPublish.ts）。入れれば、アプリを開き直さずに
   * そのまま使える（実行ファイルの解決を覚えていないため。
   * main/github/githubExecutable.ts）。
   *
   * `git-unavailable`（リポジトリの状態の側）と別なのは、こちらが
   * **Git パネル全体を止める理由にならない**ため ── gh が無くても
   * Commit も Push もそのまま使える。
   */
  | 'github-cli-missing'
  /**
   * GitHub CLI に GitHub アカウントが結び付いていない（Session 3-8-10）。
   *
   * `gh auth status` が断った状態にあたる。次の一手は
   * 「Terminal パネルで `gh auth login`」で、**Fluvix Nexus は認証情報を
   * 持たない**（設計判断 7）── これは Push / Pull で
   * credential helper に任せているのとまったく同じ分担になる
   * （`auth-required`）。
   *
   * 分けてあるのは、直す場所が違うため ── あちらは git の資格情報、
   * こちらは gh のログインになる。
   */
  | 'github-signed-out'
  /**
   * 同じ名前の repository が GitHub 側に既にある（Session 3-8-10）。
   *
   * **別の名前で作り直すことも、上書きすることもしない**（設計判断）──
   * どちらも「押した人が指していないもの」を相手にすることになる。
   * 次の一手は「別の名前を打つ」で、それは同じ面の中にそのまま在る。
   */
  | 'github-repository-exists'
  /**
   * 追跡先と枝分かれしていて、早送りできない（Session 3-8-5）。
   *
   * Pull は `merge --ff-only` に固定してある（DESIGN.md §3 / ARCHITECTURE.md §14.13）。
   * 手元にも remote にも別々の commit があると、統合には merge か rebase の
   * **判断**が要る ── どちらを選ぶかはリポジトリの流儀で決まることで、
   * アプリが黙って選ぶと、履歴の形が利用者の意図と違うものになる。
   */
  | 'diverged'
  /**
   * 作業ツリーの変更が取り込み／切り替えを妨げた（Session 3-8-5 / 3-8-6）。
   *
   * 受け取る commit（切り替え先のブランチ）が触るファイルを、手元でも
   * 書き換えている状態にあたる。git は**上書きせずに断る**ので、
   * 失われたものは無い。次の一手は「その変更を Commit するか、退避する」になる。
   *
   * ブランチの切り替え（Session 3-8-6）でこれが出るのは、**アプリが
   * 判断を足していない**ことの現れでもある ── `--merge` も `--force` も
   * 渡さないため、失われるものがあるかどうかを決めるのは git 自身になる
   * （docs/ARCHITECTURE.md §14.14）。
   */
  | 'local-changes-blocked'
  /**
   * その名前のブランチが既にある（Session 3-8-6）。
   *
   * 新規作成でだけ起こる。**上書きしない**（`--force` は渡さない）── 同じ名前の
   * ブランチを別の commit へ付け替える操作で、元の枝がどこにあったかを
   * 見失わせる。次の一手は「別の名前にする」か「そのブランチへ切り替える」で、
   * どちらも同じ面の中にそのまま在る（renderer/src/git/GitBranchMenu.tsx）。
   *
   * 大文字小文字だけが違う名前もここへ来る（Windows では ref の実体が
   * 同じファイルになる）── 名前の形の問題ではないため、
   * `shared/git/branchName.ts` ではなく git が答える。
   */
  | 'branch-exists'
  /**
   * 切り替え先が見つからなかった（Session 3-8-6）。
   *
   * 一覧を開いてから押すまでの間に、他の経路（端末での `git branch -d`）で
   * 消えた場合にあたる。**アプリが代わりに作ることはしない** ── 押したのは
   * 「切り替える」であって「作る」ではない（作る側は同じ面の別の欄にある）。
   *
   * remote-tracking branch の名前を渡した場合もここへ来る。Main は git の
   * 推測（同名の remote から手元のブランチを作る）を止めてあるため
   * （main/git/gitCommands.ts）、**一覧に無いものは切り替え先にならない。**
   */
  | 'branch-not-found'
  /**
   * その行は、その操作の対象にならない（Session 3-8-9）。
   *
   * 未追跡の**フォルダ1件**（`node_modules/` のように中身ごと1行で出るもの）を
   * 破棄しようとした場合が当たる。行の側に操作を出していないため利用者には
   * 起こらないが、Main は届いた対象を**自分が読み直した状態**で必ず確かめ直す
   * （main/git/gitDiscard.ts）── 画面が古いまま押された場合に、
   * 数万件を巻き込む1回にならないようにするため。
   *
   * `path-not-found`（消えた・グループが変わった）と分けているのは、
   * こちらが**待っても変わらない**ため。
   */
  | 'unsupported-target'
  /**
   * 対象が他のプログラムに使われていて手が出せなかった（Session 3-8-9）。
   *
   * 未追跡のファイルをごみ箱へ送るときにだけ起こる（`shell.trashItem`）。
   * `permission-denied` と分けているのは、利用者の次の一手が違うため ──
   * こちらは**使っているアプリを閉じれば同じ操作が通る**
   * （files ドメインの `busy` と同じ分け方。main/files/mutateWorkspaceEntry.ts）。
   *
   * `index-locked` とも分けている。あちらの相手は git で、こちらの相手は
   * そのファイルを開いている別のアプリになる。
   */
  | 'target-busy'
  /**
   * `.git/index.lock` が取れなかった。
   *
   * 端末で `git commit` を開いたままにしている・他のツールが触っている、など
   * **アプリの外に相手が居る**失敗にあたる。次の一手は「相手を終えてやり直す」で、
   * 他のどれとも違う（IpcErrorCode の BUSY と同じ性質）。
   */
  | 'index-locked'
  /** OS の権限で書けなかった。 */
  | 'permission-denied'
  /** 待ち時間の上限を過ぎた。 */
  | 'timeout'
  /** 上記のいずれにも当てはまらない。 */
  | 'unknown'

/**
 * 途中まで通った操作で、**どこまでが済んでいるか**（Session 3-8-10）。
 *
 * 3-8-5 の時点では `partly-applied` を返しうるのが Commit & Push だけだったため、
 * 文言の側が「Commit は完了しましたが」を決め打ちできた。3-8-10 で
 * GitHub への公開が2つめの利用者になり、そこでは**済んでいるものが違う**
 * （repository が作られ、remote が設定された）── 決め打ちのまま流用すると、
 * 公開の失敗が「Commit は完了しました」と名乗ることになる。
 *
 * 閉じた集合にしてあるのは、文言を持つ側（renderer/src/git/gitChanges.ts）が
 * **どれにも文を用意したことを型で確かめられる**ようにするため。
 */
export type GitPartialOperationStep =
  /** commit は作られた（Commit & Push の Push だけが通らなかった）。 */
  | 'commit'
  /** GitHub の repository を作り、remote を設定した（初回 Push だけが通らなかった）。 */
  | 'github-repository'

/**
 * 1回の操作の結末。
 *
 * **何が変わったかは載せない。** Commit（Session 3-8-4）で作られた commit の
 * ハッシュも、Stage された件数も返していない ── 操作の後の状態は
 * 同じ応答の `repository` に丸ごと入っており（shared/ipc/contracts/git.ts）、
 * 2つの経路で同じことを伝えると、片方だけが古い形が生まれる。
 *
 * 例外は `partly-applied` の `completed` だけになる（Session 3-8-10）。あれは
 * 「今どうなっているか」ではなく**その1回がどこで止まったか**で、状態を
 * 読み直しても分からない（repository が作られたのか、commit が積まれたのかは、
 * 止まった後の状態からは区別が付かない）。
 */
export type GitOperationOutcome =
  /** 要求どおりに変わった（index が変わった / commit が作られた / 送れた）。 */
  | { readonly status: 'applied' }
  /**
   * **途中まで通った**（Session 3-8-5 / 3-8-10）。
   *
   * 返しうるのは Commit & Push と、GitHub への公開の2つ ── どちらも
   * 「手元は変わった／外に物ができたのに、Push だけが通らなかった」状態にあたる。
   *
   * ## なぜ `failed` に丸めないか
   *
   * 丸めると、利用者は「Commit も失敗した」と読む。すると次にすることは
   * **同じ内容をもう一度 Commit する**で、履歴に同じ commit が2つ積まれる ──
   * このパネルでいちばん起こしてはいけないことにあたる。
   *
   * ## なぜ Commit を取り消さないか
   *
   * 「Push が通らなかったから Commit も戻す」（`reset --soft`）は行わない。
   * Push が通らない理由のほとんどは手元と無関係（認証・ネットワーク・
   * remote 側の拒否）で、そのたびに履歴を巻き戻すのは、**利用者が頼んでいない
   * 取り消し**にほかならない。Commit はそのまま残し、Push だけを押し直せばよい。
   *
   * `reason` は **Push が通らなかった理由**が入る（Commit の理由ではない）。
   *
   * ## 公開でも同じ形にする（Session 3-8-10）
   *
   * GitHub の repository は作られ、remote も設定されたのに初回 Push が
   * 通らなかった、も同じく普通に起こる（認証）。**作った repository を
   * 消して失敗に揃えることはしない** ── 頼まれていない取り消しであり、
   * しかも消す操作そのものが失敗しうる（Commit を戻さないのと同じ理由）。
   *
   * 残った Push は、そのまま Push ボタンで送り直せる ── remote が付いた
   * 時点で `hasRemote` が真になり、画面は「公開の入口」から
   * 「Push / Pull の並び」へ切り替わっている（shared/git/repository.ts）。
   */
  | {
      readonly status: 'partly-applied'
      /** どこまでが済んでいるか（文言の前半を決める）。 */
      readonly completed: GitPartialOperationStep
      readonly reason: GitOperationFailureReason
    }
  | { readonly status: 'failed'; readonly reason: GitOperationFailureReason }

/**
 * 通り切らなかった結末（Session 3-8-5）。
 *
 * 画面に理由を出す側（renderer/src/git/）が扱うのはこの2つだけになる。
 * `reason` だけを持ち回さないのは、**同じ理由でも言うことが違う**ため ──
 * `partly-applied` では「Commit は済んでいる」を先に伝える必要がある。
 */
export type GitOperationFailure = Exclude<GitOperationOutcome, { readonly status: 'applied' }>
