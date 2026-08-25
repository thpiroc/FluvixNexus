/**
 * Main が組み立てる git の引数の表（Electron / fs / child_process 非依存）。
 *
 * ## この表があることが、境界そのものになっている
 *
 * Terminal で「何を起動するか」を表にした（main/terminal/shellCommand.ts）のと
 * 同じ形で、Git では「**何を実行するか**」をここへ集める。
 * `runGit` はここが作った `GitCommand` しか受け取らないため、
 * 引数を組み立てられる場所はこのファイルだけになる。
 *
 * **Renderer から届いた値がそのまま引数になることは無い。** Session 3-8-2 までに
 * 置いた4つはどれも固定の引数で、外から来た値を1つも含まなかった。
 *
 * Session 3-8-3 で初めて外から来た値（Stage / Unstage の対象）が引数に入るが、
 * 入るのは**独立した1つの引数としての pathspec** だけで、しかも下の3つを通った後になる。
 *
 *   1. `main/git/gitPathspec.ts` … Workspace の中の相対位置として通してよい形か
 *   2. `--` の後ろに置く          … 値が**オプション**として読まれないようにする
 *   3. `--literal-pathspecs`      … 値が**魔法や glob**として読まれないようにする
 *
 * 2 と 3 は役割が違い、片方だけでは足りない（下記）。コマンド名・サブコマンド・
 * 実行ファイル・作業ディレクトリは今までどおり Renderer からは1文字も来ない。
 *
 * ## なぜ git の引数を外から渡させてはいけないか
 *
 * `git` は引数だけで任意のプログラムを起動できる。
 *
 * ```
 * git -c core.pager=<任意のコマンド> log
 * git -c alias.x='!<任意のコマンド>' x
 * git --exec-path=<任意のフォルダ> ...
 * ```
 *
 * つまり「git の引数を渡せる API」は、実質「任意のコマンドを実行できる API」に
 * なる。Files が絶対パスを受け取らないのと同じく、危ないものを弾くのではなく
 * **渡せる欄そのものを作らない**（shared/ipc/contracts/git.ts）。
 *
 * ## 利用者が「書いた」値は、引数に載せない（Session 3-8-4）
 *
 * Commit メッセージで初めて、**位置ではなく文章**が git へ渡る。これは引数に
 * 載せず、標準入力から読ませる（`commitStagedChanges`）── 長さ・改行・
 * 先頭の `-`・ログへの写り込みという4つの配慮が、渡し方を変えるだけで
 * まとめて要らなくなるため。理由はその関数の冒頭に書いてある。
 *
 * ## Push / Pull で増えた引数は、外から来ない（Session 3-8-5）
 *
 * ネットワークへ出る4つ（`fetch` / `merge --ff-only` / `push` の2種）でも、
 * **外から来た値は1つも引数に入らない。** remote 名もブランチ名も refspec も
 * 組み立てず、相手を決めるのは git 自身に解かせる記法にしてある。
 *
 *   `@{upstream}`          … 追跡先（設定が指しているものを git が解く）
 *   `push.default=upstream` … そのブランチの追跡先へ送る
 *   `push.default=current`  … 今のブランチと同じ名前で作る（初回）
 *
 * 名前を文字列として作らない限り、`-` で始まるブランチ名も、空白や日本語を
 * 含む名前も、引数として解釈される経路そのものが無い ── pathspec で
 * 「値が値でしかない状態を作る」としたのと同じ形になる。
 *
 * 代わりに固定で足すのが `credential.interactive=false` で、これは
 * **渡せる欄ではなく、こちらが必ず付ける引数**にあたる
 * （`NON_INTERACTIVE_CREDENTIALS`）。
 *
 * ## ブランチ名は、初めて「引数に載る外来の名前」になる（Session 3-8-6）
 *
 * 3-8-5 まで、外から来た値で引数に載ったのは pathspec だけだった。切り替えと
 * 作成では**利用者が選んだ／打ったブランチ名**が載る ── ただし、上の
 * 「この先で足すとき」に書いてあった2つをそのまま守る形になっている。
 *
 *   1. 値は必ず**独立した1つの引数**（文字列を連結して作らない）
 *   2. `--end-of-options` の後ろに置く（`-` で始まる名前をオプションと読ませない）
 *
 * 名前の形そのものは shared/git/branchName.ts が決め、Renderer と Main が
 * 同じ関数を通す。**先頭の `-` は名前の側でも弾いてある** ── 1 と 2 の
 * どちらかが外れた日に破れる形にしない（`--` と `--literal-pathspecs` を
 * 両方掛けているのと同じ構え）。
 *
 * ## この先で足すとき
 *
 * 引数に載せざるを得ない値（ブランチ名・ファイルの相対位置）については、
 * 足すのもこのファイルで、次の2つを守る。
 *
 *   - 値は必ず**独立した1つの引数**として渡す（文字列を連結して作らない）
 *   - `--` の後ろに置く / `--end-of-options` を使い、値がオプションとして
 *     読まれないようにする（`-` で始まるブランチ名・ファイル名が実在する）
 *
 * 値そのものの検証（pathspec として通せるか・Commit メッセージとして
 * 成立しているか・ブランチ名として成立しているか）は IPC ハンドラ側で行う。
 */

/**
 * 実行する git のコマンド1つ分。
 *
 * `label` はログに出す短い名前で、`args` が実際に渡るもの。
 * 実行ファイルのパスも作業ディレクトリもここには入らない ── どちらも
 * `runGit` が Main の正本から自分で決める（main/git/runGit.ts）。
 */
export interface GitCommand {
  readonly label: string
  readonly args: readonly string[]
}

/**
 * 作業ツリーの root を尋ねる。
 *
 * リポジトリでなければ 128 で終わり、stderr に "not a git repository" が出る。
 * つまりこの1回で「リポジトリか」と「その root はどこか」の両方が分かる。
 */
export function showRepositoryRoot(): GitCommand {
  return { label: 'rev-parse --show-toplevel', args: ['rev-parse', '--show-toplevel'] }
}

/**
 * 今のブランチ名を尋ねる。
 *
 * `rev-parse --abbrev-ref HEAD` ではなく `symbolic-ref` を使うのは、
 * **1つも commit が無いリポジトリ（`git init` 直後）でも答えが返る**ため。
 * HEAD は最初から `refs/heads/main` を指していて、その先がまだ無いだけになる。
 *
 * `--quiet` を付けているので、detached HEAD では**何も言わずに 1 で終わる**。
 * これは失敗ではなく「ブランチの上に居ない」という答えにあたる。
 */
export function showCurrentBranch(): GitCommand {
  return {
    label: 'symbolic-ref --quiet --short HEAD',
    args: ['symbolic-ref', '--quiet', '--short', 'HEAD']
  }
}

/**
 * HEAD が指している commit を短い形で尋ねる。
 *
 * detached HEAD のときにだけ使う。detached であるということは commit が
 * 実在するということなので、ここが失敗するのは壊れたリポジトリだけになる。
 */
export function showHeadCommit(): GitCommand {
  return { label: 'rev-parse --short HEAD', args: ['rev-parse', '--short', 'HEAD'] }
}

/**
 * 作業ツリーの変更を尋ねる（Session 3-8-2）。
 *
 * 引数の1つ1つに理由がある。
 *
 * | 引数                       | なぜ                                                                       |
 * | -------------------------- | -------------------------------------------------------------------------- |
 * | `--no-optional-locks`      | 読むだけで `.git/index.lock` を取らない（利用者自身の git を邪魔しない）   |
 * | `--porcelain=v2`           | 機械が読むための形。人向けの出力と違い、git の版で文言が変わらない          |
 * | `--branch`                 | ブランチ・upstream・ahead / behind の見出し行が付く                        |
 * | `-z`                       | 区切りを NUL にする。**名前が引用符で包まれなくなる**（下記）              |
 * | `--untracked-files=normal` | 未追跡はフォルダ単位でまとめる。`all` だと数万行になりうる                  |
 *
 * **`-z` が効いているのは、区切りだけの話ではない。** これが無いと git は
 * 「変わった名前」を引用符で包んで `\303\251` のようにエスケープして返す
 * （`core.quotepath`）。つまり日本語のファイル名は必ず化け、それを解くコードを
 * こちら側に持つことになる。`-z` なら**生のバイト列がそのまま**返り、
 * 解く処理そのものが要らなくなる ── 空白・引用符・改行を含む名前も同じ理由で通る。
 *
 * `--no-optional-locks` は**サブコマンドより前**に置く必要がある（git 本体の引数）。
 * 環境変数の `GIT_OPTIONAL_LOCKS=0`（gitEnvironment.ts）と同じ効き目だが、
 * どちらか片方が外れても読み取りがロックを取らないよう、両方から掛けてある。
 *
 * ## Session 3-8-8 で、この指定の意味が1つ増えた
 *
 * `git status` は既定で、読んだついでに index の stat キャッシュを**書き戻す**。
 * `.git/index` を見張るようになった今（main/git/gitWatcher.ts）、それを許すと
 *
 *   index が変わった → git:changed → git status → index が変わった → …
 *
 * という輪ができ、**アプリが自分の読み取りで自分を呼び戻し続ける。**
 * この2つが効いている間、読み取りは index を読むだけで終わる ──
 * ここへ手を入れるときは、監視がその上に載っていることを先に思い出すこと。
 */
export function showWorkingTreeStatus(): GitCommand {
  return {
    label: 'status --porcelain=v2 --branch',
    args: [
      '--no-optional-locks',
      'status',
      '--porcelain=v2',
      '--branch',
      '-z',
      '--untracked-files=normal'
    ]
  }
}

/* --------------------------------------------------- 書き込み（Session 3-8-3） */

/**
 * pathspec を渡すコマンドの前に必ず置く、git 本体の引数。
 *
 * `--literal-pathspecs` は pathspec の**魔法と glob をまとめて止める**。
 * これが無いと、`--` の後ろに置いた値でも次のように読まれる。
 *
 *   `:(exclude)x` `:/` `:!x` … path ではなく「選び方」の指定
 *   `a*.txt` `x?.md` `[ab].txt` … glob として、他のファイルまで巻き込む
 *
 * 値そのものは `main/git/gitPathspec.ts` でも確かめているが、あちらが弾くのは
 * 「渡す理由が無い形」だけになる。`*` を含むファイル名は POSIX では実在しうるため、
 * 弾くと一覧に出ているのに Stage できないファイルが生まれる ──
 * **弾くのではなく、glob として読まれない状態にする**方で対処する。
 *
 * `--` と二重になっているのは意図してのこと。`--` は「ここから先は pathspec」を
 * 決めるだけで、その先が**魔法として読まれること自体は止めない**。
 * 片方だけでは足りず、両方でようやく「値は値でしかない」と言える。
 */
const LITERAL_PATHSPECS = '--literal-pathspecs'

/**
 * index に載せる（Stage）。
 *
 * `git add` は「作業ツリーの今の姿を index へ写す」操作で、**消えたファイルにも効く**
 * （削除が index に載る）。未追跡のフォルダを渡せば、その下がまとめて載る ──
 * 一覧が未追跡をフォルダ1件にまとめている（`--untracked-files=normal`）のと対になっている。
 *
 * `paths` は必ず `normalizeGitPathspec` を通ったもの。**ここで検証はしない** ──
 * この表は「何を実行するか」だけを持ち、値の良し悪しは呼び出し側が先に決める
 * （files ドメインで `workspacePath.ts` と `readWorkspaceDirectory.ts` を
 * 分けてあるのと同じ分担）。
 */
export function stagePaths(paths: readonly string[]): GitCommand {
  return { label: 'add', args: [LITERAL_PATHSPECS, 'add', '--', ...paths] }
}

/**
 * index から外す（Unstage）── HEAD がある通常のリポジトリ。
 *
 * `git reset <commit> -- <path>` は **index だけ**を HEAD の中身へ戻す。
 * `--hard` を付けない限り作業ツリーには触れないため、書きかけの中身が消えることは無い
 * （それが `git:unstage` を discard と別のチャンネルにしてある理由でもある。
 * shared/ipc/contracts/git.ts）。
 *
 * `git restore --staged` ではなく `reset` を選んでいるのは、`restore` が
 * git 2.23 以降にしか無いため。Fluvix Nexus は PC に入っている git をそのまま使う
 * （§14.1）ので、**古い git の入った PC で Unstage だけが使えない**という形を作らない。
 *
 * `--quiet` は出力を減らすためだけのもの。`reset` は「戻した結果まだ変更が残っている
 * ファイル」を一覧で出すが、こちらはその後に status を読み直すので要らない。
 */
export function unstagePathsFromHead(paths: readonly string[]): GitCommand {
  return {
    label: 'reset HEAD',
    args: [LITERAL_PATHSPECS, 'reset', '--quiet', 'HEAD', '--', ...paths]
  }
}

/**
 * index から外す（Unstage）── **まだ1つも commit が無いリポジトリ**。
 *
 * HEAD が指す先がまだ無いため、「HEAD の中身へ戻す」という操作が成り立たない。
 * git の版によっては `reset` が空のツリーを相手に動くが、**版によっては
 * `fatal: could not resolve 'HEAD'` で断られる**（`restore --staged` は
 * 今でも断る）。初回 commit の直前という、いちばん人が触る場面で
 * git の版に結果を委ねない。
 *
 * 代わりに `git rm --cached` で index から取り除く ── 初回 commit 前の
 * 「Stage を外す」は、そのまま「まだ Git が知らない状態へ戻す」ことにあたるため、
 * 未追跡へ戻るのが利用者の期待とも合う。
 *
 * **`--force` を付けても作業ツリーのファイルは消えない。** `--cached` が付いている
 * 限り git が触るのは index だけで、`--force` が外すのは
 * 「index の中身が作業ツリーとも HEAD とも違うときは念のため断る」という
 * 安全弁の方になる。ここではその安全弁こそが邪魔になる ── Stage した後に
 * もう一度書き換えたファイルで、Unstage だけが断られることになる。
 */
export function unstagePathsWithoutHead(paths: readonly string[]): GitCommand {
  return {
    label: 'rm --cached',
    args: [LITERAL_PATHSPECS, 'rm', '--cached', '--force', '--quiet', '--', ...paths]
  }
}

/**
 * HEAD が実在する commit を指しているか尋ねる。
 *
 * 指していれば 0、まだ1つも commit が無ければ（`--quiet` により何も言わずに）1。
 * Unstage の経路を選ぶためだけに使う。
 *
 * `showCurrentBranch` の結果から判断しない ── あちらは commit がまだ無くても
 * ブランチ名を答える（それがあの引数を選んだ理由にあたる）ため、
 * 「ブランチの上に居る」と「commit がある」は別の問いになる。
 */
export function verifyHeadCommit(): GitCommand {
  return { label: 'rev-parse --verify HEAD', args: ['rev-parse', '--verify', '--quiet', 'HEAD'] }
}

/* ------------------------------------------------------- Commit（Session 3-8-4） */

/**
 * index の中身を Commit する（Session 3-8-4）。
 *
 * ## メッセージは引数に載せず、標準入力から読ませる
 *
 * `--file=-` は「Commit メッセージを標準入力から読む」の指定で、`-m <message>` の
 * 代わりになる。**利用者が書いた文章がコマンドラインに1文字も並ばない**のが
 * このコマンドで一番大事なところにあたる。
 *
 * 引数に載せる形（`-m`）でも `execFile` はシェルを通さないため、それ自体で
 * 別のコマンドが走ることは無い。それでも標準入力を選ぶのは、引数に載せると
 * **別々の配慮が4つ同時に要る**ためになる。
 *
 *   長さ    … Windows のコマンドライン全体の上限（32767 文字）に収まるか
 *   改行    … 複数行のメッセージが1つの引数として渡るか
 *   先頭の `-` … `-x` で始まるメッセージがオプションとして読まれないか
 *   ログ    … プロセスの一覧や監査ログに文章がそのまま載らないか
 *
 * 標準入力なら、そのどれもが**問い自体として消える**。pathspec で
 * 「値が値でしかない状態を作る」（`--literal-pathspecs`）としたのと同じ形で、
 * 危ない使われ方を弾くのではなく、使われる経路そのものを無くす。
 *
 * ## `--cleanup=whitespace` を明示する
 *
 * git は「編集させるかどうか」で既定の後始末が変わる（編集させるなら `strip`、
 * させないなら `whitespace`）。**版や設定（`commit.cleanup`）で変わるものを
 * 既定に任せない** ── `strip` が効くと `#` で始まる行が黙って消え、
 * `#123 の修正` のようなメッセージが**空になって Commit が失敗する。**
 *
 * `whitespace` が落とすのは前後の空行と行末の空白だけで、それは
 * `normalizeGitCommitMessage` が渡す前に落としている分と重なる
 * （shared/git/commitMessage.ts）── つまり入力した文字列がそのまま記録される。
 *
 * ## 付けていないもの
 *
 * | 付けない        | なぜ                                                                     |
 * | --------------- | ------------------------------------------------------------------------ |
 * | `--all` / `-a`  | 作業ツリーの変更まで巻き込む。**画面の「ステージ済み」だけが対象**       |
 * | pathspec        | 同上。何を Commit するかは index が持つ（shared/ipc/contracts/git.ts）   |
 * | `--no-verify`   | リポジトリが置いた hook をアプリが黙って外すことになる                   |
 * | `--amend`       | 履歴を書き換える操作。確認の形と一緒に別の口として設計する               |
 * | `--allow-empty` | 空の Commit は「押したのに何も起きない」の別の形                         |
 * | `--author` / `--date` | 履歴に永久に残るものを Renderer から書き換えられる形にしない       |
 * | `--gpg-sign`    | 鍵の扱いが絡む。設定 UI ごと別の設計になる                               |
 *
 * `--quiet` は出力を減らすためだけのもの。作られた commit の要約は使わず、
 * この後に status を読み直す（main/git/gitCommit.ts）。
 */
export function commitStagedChanges(): GitCommand {
  return {
    label: 'commit',
    args: ['commit', '--quiet', '--cleanup=whitespace', '--file=-']
  }
}

/**
 * Commit に使う名乗り（author）が決まっているかを尋ねる（Session 3-8-4）。
 *
 * `git var GIT_AUTHOR_IDENT` は `user.name` / `user.email` から author の行を
 * 組み立てて返し、**組み立てられなければ 128 で終わる**（`user.email` が無く
 * 自動検出もできない、`user.name` が空、など）。
 *
 * ## なぜ commit の失敗から分類せず、先に尋ねるのか
 *
 * commit が失敗した後に stderr の文言から当てることもできるが、
 * **hook の出力と混ざる**（hook は任意のプログラムで、何を書くか分からない）。
 * 名乗りだけは commit を動かす前に確かめられるので、確かめてから動かす ──
 * 「Commit できなかった理由」がこの2つのどちらなのかを、当てずに決められる。
 *
 * 先に尋ねることには、もう1つ意味がある。名乗りが無いまま commit を走らせると
 * **hook だけが先に走って（重いこともある）から失敗する。** 走らせる意味の無い
 * ものを走らせない。
 *
 * 設定されていなければ失敗として案内するだけで、**アプリが代わりに決めることはしない**
 * （shared/git/operation.ts の `identity-missing`）。
 */
export function verifyCommitIdentity(): GitCommand {
  return { label: 'var GIT_AUTHOR_IDENT', args: ['var', 'GIT_AUTHOR_IDENT'] }
}

/* --------------------------------------------- Push / Pull（Session 3-8-5） */

/**
 * ネットワーク越しに動く git に必ず付ける、git 本体の引数（Session 3-8-5）。
 *
 * ## 見えない場所で入力を待たせない ── その2つめ
 *
 * `GIT_TERMINAL_PROMPT=0`（gitEnvironment.ts）は**端末からの**入力を止めるが、
 * それだけでは足りない。Windows の既定の credential helper（Git Credential
 * Manager）は端末ではなく**自前のウィンドウ**を出すため、環境変数では止まらない。
 *
 * `credential.interactive=false` は helper に「対話してよいか」を伝える設定で、
 * これを渡すと **helper は覚えている資格情報だけを答え、無ければ黙って諦める。**
 * つまり Fluvix Nexus からの Push / Pull は
 *
 *   覚えている  … そのまま通る（利用者は何もしなくてよい）
 *   覚えていない … **即座に**認証の失敗として返る
 *
 * のどちらかに必ず落ちる。アプリの裏で出た認証ウィンドウを利用者が
 * 見つけられないまま、Git パネルが数分固まる形を作らない。
 *
 * ## アプリは認証情報を持たない（設計判断 7）
 *
 * 覚えていなかった場合に、こちらから利用者へ ID とパスワードを尋ねることはしない。
 * 尋ねれば、それを**どこかへ持つ**ことになる ── 保管の設計（暗号化・失効・
 * 複数ホスト）はアプリ1つ分の話で、しかも OS と Git が既に持っている仕組みと
 * 二重になる。案内するのは「Terminal パネルで一度 push / pull して、
 * credential helper に覚えさせる」で、その後はアプリからも通るようになる。
 *
 * この2つは**渡せる欄ではなく、こちらが必ず足す固定の引数**にあたる。
 * Renderer から `-c` を渡せる形は無い（それは任意のコマンドを起動できる形になる。
 * このファイルの冒頭）。
 */
const NON_INTERACTIVE_CREDENTIALS: readonly string[] = ['-c', 'credential.interactive=false']

/**
 * 設定されている remote の名前を尋ねる（Session 3-8-5）。
 *
 * 1つも無ければ 0 で終わって**何も出力しない**（失敗ではない）。
 *
 * Push の前にこれを聞くのは、`git push` の断り方が分かりにくいため ──
 * remote が無いときの `fatal: No configured push destination` は、
 * 認証やネットワークの失敗と同じ「Push できなかった」の中に埋もれる。
 * ネットワークへ出る前に分かることは、出る前に分けておく
 * （Commit で名乗りを先に確かめているのと同じ形。`verifyCommitIdentity`）。
 */
export function listRemotes(): GitCommand {
  return { label: 'remote', args: ['remote'] }
}

/**
 * 追跡先の remote から取ってくる（Session 3-8-5）。
 *
 * **remote 名を引数に取らない。** 引数を省いた `git fetch` は
 * 「今のブランチの remote（`branch.<name>.remote`、無ければ既定）」を相手にする ──
 * つまり相手を決めるのはリポジトリの設定で、こちらは名前を1文字も組み立てない
 * （Renderer から remote 名が届く経路が無いのと同じ理由が、Main 側にも効いている）。
 *
 * `--prune` は付けない。手元の remote-tracking ref を**消す**操作が混ざることになり、
 * 「取ってくる」ボタンが何かを消すのは、押した人の予想から外れる。
 */
export function fetchFromRemote(): GitCommand {
  return {
    label: 'fetch',
    args: [...NON_INTERACTIVE_CREDENTIALS, 'fetch', '--quiet']
  }
}

/**
 * 取ってきたものを早送りで取り込む（Session 3-8-5）。
 *
 * ## `git pull` を使わない
 *
 * `pull` は `fetch` + `merge`（または `rebase`）で、どちらになるかは
 * **PC ごとの設定**（`pull.rebase` / `branch.<name>.rebase`）で変わる。
 * 同じボタンが PC ごとに違う履歴を作るのは、いちばん説明しにくい振る舞いにあたる。
 * `fetch` と `merge` に分けておけば、こちらが渡した引数がそのまま結果になる。
 *
 * 分けることには、もう1つ意味がある。**どちらで失敗したかが分かる** ──
 * ネットワークで届かなかったのか、届いたが取り込めなかったのかで、
 * 次の一手はまったく違う（shared/git/operation.ts）。
 *
 * ## `--ff-only` に固定する
 *
 * 早送りできない（枝分かれしている）ときは、**取り込まずに断る。**
 * merge commit を作るか rebase するかは履歴の形を決める判断で、
 * リポジトリの流儀によって答えが違う ── アプリが黙って選ぶと、
 * 利用者が意図していない形の履歴が残り、後から直すのは難しい。
 *
 * 相手は `@{upstream}`（追跡先）で、これは**設定が指しているものを git 自身が
 * 解く記法**にあたる。remote 名やブランチ名を文字列として組み立てないため、
 * ここに外から来た値が混ざる余地が無い。
 */
export function mergeUpstreamFastForwardOnly(): GitCommand {
  return {
    label: 'merge --ff-only',
    args: ['merge', '--ff-only', '--quiet', '@{upstream}']
  }
}

/**
 * 追跡先へ送る（Session 3-8-5）── 既に追跡先があるブランチ。
 *
 * ## `push.default=upstream` を明示する
 *
 * 引数を省いた `git push` の相手は `push.default` の設定で変わり、既定の
 * `simple` は「upstream と**同じ名前**のときだけ送る」という条件付きになる。
 * 手元の `feature` が `origin/main` を追っているような設定では、
 * `simple` は送らずに断る ── 追跡先があるのに Push だけできない、という形になる。
 *
 * `upstream` に固定すると、送り先は常に**そのブランチの追跡先そのもの**になる。
 * 画面の `↑2` が指しているのはまさにその差なので、**出ている数字と送るものが
 * 一致する。**
 *
 * ## 付けていないもの
 *
 * | 付けない                    | なぜ                                                       |
 * | --------------------------- | ---------------------------------------------------------- |
 * | `--force` / `--force-with-lease` | 他人の commit を消しうる。押し間違えたときに戻せない  |
 * | `--all` / `--tags` / refspec | 画面に出ているブランチ以外のものが混ざる                  |
 * | `--delete`                  | 送る操作の口で消せるようにしない                           |
 * | `--no-verify`               | リポジトリが置いた `pre-push` hook をアプリが黙って外さない |
 *
 * `--porcelain` も付けていない。結末は終了コードと stderr の分類で決めており
 * （main/git/gitFailure.ts）、送れた件数を画面に出すことはしない ──
 * 送った後の状態は、この後の読み直しで `↑0` として出る。
 */
export function pushToUpstream(): GitCommand {
  return {
    label: 'push',
    args: [...NON_INTERACTIVE_CREDENTIALS, '-c', 'push.default=upstream', 'push', '--quiet']
  }
}

/**
 * 追跡先へ送る（Session 3-8-5）── **まだ追跡先が無いブランチ。**
 *
 * `push.default=upstream` はこの状態では成り立たない（相手が無い）。ここだけ
 * `current` を使う ── 「今のブランチと**同じ名前**で、既定の remote へ作る」で、
 * `git push -u origin <branch>` を利用者が打つときの形にそのまま重なる。
 *
 * **ブランチ名を引数として組み立てていない**のが要点になる。`current` は
 * 「今のブランチ」を git 自身に解かせる指定で、こちらは名前に触らない ──
 * `-` で始まるブランチ名も、空白や日本語を含む名前も、そもそも引数に載らない。
 *
 * `--set-upstream` を同じ1回で行うのは、**送れたのに次から送れない**を作らないため。
 * 追跡先が付かないまま送ると、画面の `↑ ↓` は次も出ないままになる。
 *
 * 送り先の remote を選ぶのはこちらではない（`remote.pushDefault`、
 * 無ければ `origin`）。remote が1つも無い場合は、ここへ来る前に分けてある
 * （`listRemotes`）。
 */
export function pushSettingUpstream(): GitCommand {
  return {
    label: 'push --set-upstream',
    args: [
      ...NON_INTERACTIVE_CREDENTIALS,
      '-c',
      'push.default=current',
      'push',
      '--quiet',
      '--set-upstream'
    ]
  }
}

/* ------------------------------------------------ ブランチ（Session 3-8-6） */

/**
 * 値をオプションとして読ませないための、git 本体の引数（Session 3-8-6）。
 *
 * ここから後ろは**すべて値**になる。pathspec で `--` を置いているのと同じ役で、
 * 違うのは置ける記号の方 ── `git switch` は pathspec を取らないため `--` の
 * 意味がコマンド側にあり、代わりに parse-options 共通の
 * `--end-of-options` を使う。
 *
 * これがあると、`-x` で始まる名前が渡ってもオプションとして解釈されない。
 * 名前の側でも先頭の `-` を弾いてある（shared/git/branchName.ts）── pathspec で
 * `--` と `--literal-pathspecs` を両方掛けているのと同じで、**片方だけでは
 * 足りない**という構えを、ここでも崩さない。
 */
const END_OF_OPTIONS = '--end-of-options'

/**
 * ローカルブランチの一覧を尋ねる（Session 3-8-6）。
 *
 * ## `git branch` ではなく `for-each-ref`
 *
 * `git branch` の出力は**人向け**で、印（`* `）と字下げが混ざり、detached HEAD では
 * `* (HEAD detached at abc1234)` という**ブランチではない行**まで並ぶ。それを
 * 読み分けるのは、`status` で `--porcelain=v2` を選んだのと逆の方向にあたる。
 *
 * `for-each-ref` は機械向けの口で、**出す欄をこちらが決められる。**
 * `refs/heads/` に絞ってあるので、remote-tracking branch も tag も混ざらない
 * （一覧はローカルブランチだけ、という決めごとがここで担保される。
 * shared/git/branch.ts）。
 *
 * ## 区切りを NUL にする
 *
 * `%(HEAD)` は今居るブランチに `*`、それ以外に空白1つを出す。行の形は
 * `*<NUL>main` になり、**名前の側に何が入っていても読み分けられる。**
 * 空白区切りにしないのは、`%(HEAD)` 自身が空白を出すため ── 区切りと値の
 * 区別が消える（`status` に `-z` を渡しているのと同じ考え方）。
 *
 * ブランチ名に改行は入らない（git が禁じている）ので、行の区切りは改行のままでよい。
 *
 * ## 上限は git 自身に掛ける
 *
 * `--count` を渡すと、git はその数で**出力を打ち切る。** 数千行を受け取ってから
 * こちらで捨てる形にしないのは、捨てる分の文字列を IPC の手前まで運ぶ意味が
 * 無いため。上限より1つ多く求めるのは、**切ったかどうかを知る**ためになる
 * （`GIT_LOCAL_BRANCH_LIMIT` の1つ上が返ってきたら、まだ先がある）。
 *
 * 並べ替えは指定しない ＝ git の既定（refname 順）。押そうとした行が
 * 開くたびに入れ替わらないことの方が、新しい順に並ぶことより効く
 * （変更ファイルの一覧に並べ替えを持たせていないのと同じ判断）。
 */
export function listLocalBranches(limit: number): GitCommand {
  return {
    label: 'for-each-ref refs/heads',
    args: [
      'for-each-ref',
      '--format=%(HEAD)%00%(refname:short)',
      `--count=${limit + 1}`,
      'refs/heads/'
    ]
  }
}

/**
 * 別のローカルブランチへ切り替える（Session 3-8-6）。
 *
 * ## `git checkout` ではなく `git switch`
 *
 * `checkout` は**1つのコマンドが2つの仕事**を持つ ── ブランチの切り替えと、
 * ファイルの取り戻し（`git checkout <path>`）にあたる。どちらとして読むかは
 * 渡した名前が何に当たるかで決まるため、`main` という名前のファイルが
 * ある状態で `git checkout main` を動かすと、**切り替えたつもりで作業ツリーの
 * 書きかけが消える**ことが起こりうる。
 *
 * `switch` はブランチだけを相手にする（pathspec を取らない）ので、その取り違えが
 * 起こる余地そのものが無い。Unstage で `restore` を避けて `reset` を選んだ
 * （古い git でも動くように）のとは逆の判断に見えるが、理由は同じ「起こしては
 * いけないことから決める」で、**あちらは代わりの手段が同じくらい安全だった**のに対し、
 * こちらは代わりの手段（`checkout`）が上記の危うさを持つ。
 *
 * `switch` は git 2.23 以降にある（`--end-of-options` は 2.24 以降）。それより
 * 古い git では、ブランチの操作だけが「使えない」として断られる ── その場合も
 * 分類は返るので（main/git/gitFailure.ts）、パネルが黙って壊れることは無い。
 *
 * ## `--no-guess` が「ローカルだけ」を担保する
 *
 * 既定の `git switch <name>` は、その名前のローカルブランチが無いときに
 * **remote-tracking branch を探して、手元にブランチを作る**（DWIM）。
 * 一覧に出していないもの（`origin/x`）が、名前を打っただけで手元に生えることになり、
 * しかも追跡先まで設定される ── 一覧に出したものだけが切り替え先になる、という
 * 決めごと（shared/git/branch.ts）はここで止めてある。
 *
 * ## 付けていないもの
 *
 * | 付けない                     | なぜ                                                             |
 * | ---------------------------- | ---------------------------------------------------------------- |
 * | `--force` / `--discard-changes` | 作業ツリーの書きかけを黙って捨てる                            |
 * | `--merge`                    | 書きかけを切り替え先へ持ち込み、**競合を作りうる**               |
 * | `--detach`                   | ブランチから降りる操作。切り替えの口で起こしてよいことではない   |
 * | `--orphan`                   | 履歴を持たないブランチ。作成の口とも意味が違う                   |
 * | start point                  | 「切り替え」と「別の場所から作る」が1つの口に混ざる              |
 *
 * つまり**切り替えてよいかを決めるのは git 自身**になる。書きかけがあって
 * 切り替えられないときは断られ、そのとき失われるものは無い
 * （shared/git/operation.ts の `local-changes-blocked`）。
 */
export function switchBranch(name: string): GitCommand {
  return {
    label: 'switch',
    args: ['switch', '--no-guess', '--quiet', END_OF_OPTIONS, name]
  }
}

/**
 * 今の場所から新しいブランチを作って、そこへ切り替える（Session 3-8-6）。
 *
 * ## 作るのと切り替えるのを1回にする
 *
 * `git branch <name>` と `git switch <name>` の2回に分けない。分けると
 * 1つめが通って2つめが通らなかったとき、**作られたのに切り替わっていない**
 * 状態が残る ── 利用者はもう一度押すか、気づかないまま前のブランチに
 * Commit を積むことになる。`switch --create` は1回で両方を行い、
 * 切り替えられなければブランチも作られない。
 *
 * ## 始点は HEAD（今居る場所）
 *
 * start point を渡さないので、新しいブランチは今の HEAD から始まる。
 * **detached HEAD からでも作れる**のはこの形の効き目にあたる ── 今居る commit に
 * 名前が付くので、「どこにも属さない commit」から抜け出す手立てになる
 * （Push が detached で断るのとは対照的に、こちらは塞がない）。
 *
 * `--force`（`-C`）は渡さない。既にある名前を別の commit へ**付け替える**操作で、
 * 元の枝がどこにあったかを見失わせる ── 同じ名前があれば `branch-exists` として
 * 断る（shared/git/operation.ts）。
 *
 * `--track` / `--no-track` も渡さない。始点が HEAD（ローカル）なので既定では
 * 追跡先が付かず、付けるかどうかはリポジトリの設定（`branch.autoSetupMerge`）の
 * 領分になる ── アプリが上書きすると、その PC の決めごとを黙って外すことになる。
 *
 * ## ここだけ `--end-of-options` を使わない
 *
 * 切り替え（`switchBranch`）と違い、**名前は位置引数ではない** ── `--create` が
 * 自分の引数として受け取る値になる（`git switch -c <new> [<start-point>]`）。
 * したがって `--end-of-options` を挟むと、名前が `--create` の引数ではなく
 * **始点**として読まれ、`invalid reference` で断られる（実際に確かめた）。
 *
 * 挟まなくても、値がオプションとして読まれることは無い。オプションの引数は
 * その次の1つを**そのまま**取るためで、`-weird` を渡すと git は
 * 「オプションが2つ並んでいる」ではなく「`-weird` はブランチ名として不正だ」と
 * 断る（これも確かめた）。名前の側でも先頭の `-` を弾いてあり
 * （shared/git/branchName.ts）、二重の備えはここでも保たれている。
 *
 * **`--create` は必ず最後に置く。** 間に別のオプションを挟むと、そちらが
 * 名前として読まれる。
 */
export function createBranch(name: string): GitCommand {
  return {
    label: 'switch --create',
    args: ['switch', '--quiet', '--create', name]
  }
}

/* --------------------------------------- 履歴（Session 3-8-11） */

/**
 * commit の履歴を尋ねる（Session 3-8-11）。
 *
 * ## 外から来た値が1つも無い
 *
 * ブランチ名（3-8-6）と pathspec（3-8-3）でようやく外来の値を引数に載せたが、
 * ここでは**また1つも載らない。** rev も pathspec も `--author` も渡す欄が
 * そもそも無く（shared/ipc/contracts/git.ts）、変わるのは上限の数だけになる。
 *
 * 上限は `GIT_COMMIT_HISTORY_LIMIT` から来る**アプリ自身の定数**で、
 * `--max-count=` に埋め込む唯一の値にあたる（`listLocalBranches` の
 * `--count=` と同じ形）。
 *
 * ## rev を渡さない ＝ HEAD からさかのぼる
 *
 * 引数に rev を書かなければ、git は HEAD から辿る。`HEAD` と書いても同じだが、
 * **書かない**方を選んでいる ── 「ここに rev を置ける」という形そのものを
 * 残さないためになる（差分で rev を渡せる欄を作らなかったのと同じ線。
 * docs/ARCHITECTURE.md §14.16）。
 *
 * commit が1つも無いリポジトリでは、このコマンドは非0で終わる ── 呼ぶ側が
 * 先に `verifyHeadCommit` で分けておく（main/git/gitHistory.ts）。
 *
 * ## 区切りを NUL にする（`for-each-ref` と同じ理由）
 *
 * 1行が1件で、欄の区切りは NUL。`%s`（要約）には空白も `|` もタブも入りうるので、
 * 目に見える文字を区切りにすると**その文字を含む要約で列がずれる。**
 * 行の区切りを改行のままにしてよいのは、`%s` が commit メッセージの
 * **1行目だけ**を返すためになる（本文は載せない。shared/git/history.ts）。
 *
 * 欄の並びは `%h`（短い hash）→ `%an`（名乗り）→ `%at`（epoch 秒）→
 * `%P`（親の hash の並び）→ `%s`（要約）。**要約を最後に置く**のは、
 * そこだけが「何が入っているか分からない値」だからで、後ろに欄を足さない限り
 * 区切りの数え間違いが起こらない（main/git/gitOutput.ts）。
 *
 * ## `%at` を使い、`%ad` を使わない
 *
 * `%ad` の形はリポジトリの設定（`log.date`）で変わる ── PC ごとに違う形の
 * 文字列が画面に出ることになる。`%at` は epoch 秒そのもので、設定に
 * 左右されない（shared/git/history.ts）。
 *
 * ## 設定で振る舞いが変わる余地を、先に閉じておく
 *
 * `log.showSignature` と `log.decorate` は、**リポジトリの設定から `git log` の
 * 動きを変えられる**2つになる。前者は署名の検証（つまり `gpg` の起動）を、
 * 後者は ref 名の付加を促す。
 *
 * この `--format` に `%G?` も `%d` も入れていないため、**今のところどちらも
 * 出力を変えない**（確かめた）。それでも打ち消してあるのは、欄を1つ足した日に
 * 「設定次第で別のプログラムが動く」形へ静かに変わりうるためになる ──
 * 差分で `--textconv` / `--ext-diff` を**付けない**と決めたのと同じ線で、
 * こちらは既定ではなく設定から効くものなので**打ち消す**側になる。
 */
export function listCommitHistory(limit: number): GitCommand {
  return {
    label: 'log --format',
    args: [
      '-c',
      'log.showSignature=false',
      'log',
      '--no-decorate',
      `--max-count=${limit + 1}`,
      '--format=%h%x00%an%x00%at%x00%P%x00%s'
    ]
  }
}

/* ------------------------------------- 差分と破棄（Session 3-8-9） */

/*
 * ## `git diff` を呼ばない
 *
 * 差分の表示は「patch を渡さず、中身2つを渡す」形にしてある
 * （shared/git/diff.ts）。したがってここに `diff` の行は無く、代わりに置くのが
 * 下の4つ ── **どの blob か**を訊く2つと、**その blob の大きさと中身**を
 * 訊く2つになる。
 *
 * ## 位置は最後まで pathspec のまま、object 名は git が作ったものだけ
 *
 * `git show HEAD:<path>` / `git cat-file blob :<path>` のような**組み合わせた
 * 1つの引数**は作らない。作ると、Renderer から来た位置が `:` や `^` を含む
 * revision 表記の一部として読まれる余地が生まれ、3-8-3 で
 * 「値が値でしかない状態」にしたところが崩れる。
 *
 * 代わりに2段にしてある。
 *
 *   1. 位置を **pathspec のまま**渡して（`--` の後ろ + `--literal-pathspecs`）、
 *      git に object 名（40桁の16進）を答えさせる
 *   2. その object 名で中身を取りに行く
 *
 * 2段目の引数に載るのは **git 自身が作った文字列**だけで、外から来た値は
 * 1文字も入らない。往復が1回増えるが、差分は「1行を選んだ一瞬」にしか
 * 走らないため、その代償は一覧の側には出ない。
 */

/**
 * index に載っている blob の object 名を訊く。
 *
 * `-z` を付けるのは、位置に改行を含むファイル名でも1件を切り出せるようにするため
 * （`git status` と同じ理由）。出力の読み取りは main/git/gitBlob.ts。
 *
 * **衝突している位置では stage 1 / 2 / 3 の3行が返る。** 破棄も差分も衝突を
 * 対象にしていないため、読む側は stage 0 の行だけを採る（gitBlob.ts）。
 */
export function showIndexBlob(paths: readonly string[]): GitCommand {
  return {
    label: 'ls-files --stage',
    args: [LITERAL_PATHSPECS, 'ls-files', '--stage', '-z', '--', ...paths]
  }
}

/**
 * HEAD の tree に載っている blob の object 名を訊く。
 *
 * `HEAD` は**固定の文字列**で、Renderer から来た値ではない（rev を渡せる欄は
 * 作っていない。shared/ipc/contracts/git.ts）。初回 commit 前は HEAD そのものが
 * 無く、git は非0で終わる ── 呼ぶ側が先に `verifyHeadCommit` で分けておく。
 */
export function showHeadBlob(paths: readonly string[]): GitCommand {
  return {
    label: 'ls-tree HEAD',
    args: [LITERAL_PATHSPECS, 'ls-tree', '-r', '-z', 'HEAD', '--', ...paths]
  }
}

/**
 * object の大きさ（バイト数）を訊く。
 *
 * **中身を読む前に必ずこれを通る。** 上限（`FILES_FILE_MAX_BYTES`）を超えるものを
 * そのまま `cat-file blob` で読むと、読み切ってから捨てることになる ──
 * files ドメインが「大きさを先に見る」（main/files/readWorkspaceFile.ts）と
 * している判断を、git 側の中身にも同じ形で当てている。
 *
 * `object` は前の1回で git 自身が答えた object 名。外から来た値は入らない。
 */
export function showBlobSize(object: string): GitCommand {
  return { label: 'cat-file -s', args: ['cat-file', '-s', object] }
}

/**
 * object の中身を読む。
 *
 * `--textconv` / `--filters` は付けない。どちらもリポジトリの設定に書かれた
 * **任意のプログラムを起動する**指定で、3-8-1 で引いた線（Renderer からの操作で
 * 任意の実行ファイルが動く形を作らない）の内側にある ── 差分のために
 * `.gitattributes` の中の実行ファイルが走る形にはしない。
 *
 * その代わり、改行の食い違い（`core.autocrlf`）は読み取った後に均す
 * （main/git/gitDiff.ts）。
 */
export function showBlobContent(object: string): GitCommand {
  return { label: 'cat-file blob', args: ['cat-file', 'blob', object] }
}

/**
 * 作業ツリーの中身を index の中身へ戻す（破棄）。
 *
 * ## `--worktree` だけを渡す（`--staged` は渡さない）
 *
 * `git restore` は `--source` を省くと **index を写し元**にする。つまりこの1回で
 * 起きるのは「作業ツリーが index の中身になる」だけで、**index そのものは
 * 1バイトも動かない** ── ステージ済みの内容を、破棄で巻き添えにしない。
 *
 * ステージ済みを戻したい場合は先に `git:unstage` を通る形にしてあり
 * （shared/git/operation.ts）、この1本が2段の意味を持つことは無い。
 *
 * ## `git checkout --` ではなく `git restore`
 *
 * `git checkout` は同じ書き方で「ブランチを切り替える」にも「ファイルを戻す」にも
 * なる（ブランチの切り替えで `switch` を選んだのと同じ理由。§14.14）。
 * 消える側の操作でこそ、コマンド名で意味が1つに決まる方を選ぶ。
 *
 * ## `git clean` / `reset --hard` はここに無い
 *
 * `clean` は未追跡を消す操作だが、**ごみ箱を経由しない**（戻せない）。
 * `reset --hard` は指した1件ではなく作業ツリー全体を戻す。どちらも
 * 「押した行1つ」より広く、しかも取り返しがつかない ── 未追跡は
 * files ドメインのごみ箱へ送る形にしてある（main/git/gitDiscard.ts）。
 */
export function restoreWorktreePaths(paths: readonly string[]): GitCommand {
  return {
    label: 'restore --worktree',
    args: [LITERAL_PATHSPECS, 'restore', '--worktree', '--quiet', '--', ...paths]
  }
}

/* --------------------------------- 初期化と公開（Session 3-8-10） */

/**
 * 今の Workspace を Git リポジトリにする（Session 3-8-10）。
 *
 * ## 素の `git init` にする
 *
 * 初期ブランチ名を渡さない（`-b main` も `-c init.defaultBranch=main` も
 * 付けない）。**その PC の git が既定にしている名前がそのまま使われる。**
 *
 * アプリが `main` を指定すると、次の2つが起きる。
 *
 *   - 利用者が `init.defaultBranch` を設定していても、**アプリからだけ
 *     別の名前になる。** 設定した本人から見て説明の付かない振る舞いになる
 *   - 古い git（2.28 未満）は `-b` を知らない ── 初期化そのものが失敗する
 *
 * ブランチ名は履歴に長く残るもので、`user.name` / `user.email` をアプリが
 * 決めない（`verifyCommitIdentity`）のと同じ理由で、ここでも決めない。
 *
 * ## 付けていないもの
 *
 * | 付けない            | なぜ                                                             |
 * | ------------------- | ---------------------------------------------------------------- |
 * | 対象のパス          | 場所は作業ディレクトリ（＝今の Workspace）。渡せる欄を作らない   |
 * | `--bare`            | 作業ツリーの無いリポジトリ。Git パネルが扱えない形（`no-work-tree`） |
 * | `--template`        | **任意のフォルダの hook がそのまま入る**（3-8-1 で引いた線の内側） |
 * | `--separate-git-dir`| `.git` の場所が動く。監視（gitWatcher.ts）の前提から外れる       |
 * | `--shared`          | 権限の設定。Windows では意味を持たず、他の OS では副作用になる    |
 *
 * `--quiet` は出力を減らすためだけのもの（作られた場所を1行で報告する）。
 * 初期化そのものの結果は、この後に状態を読み直して確かめる
 * （main/git/gitInit.ts）── リポジトリになったかどうかは、git の言葉ではなく
 * `rev-parse` の答えで決める。
 */
export function initializeRepository(): GitCommand {
  return { label: 'init', args: ['init', '--quiet'] }
}

/**
 * `origin` を設定する（Session 3-8-10）。
 *
 * ## 名前は固定、URL は Main が受け取ったものだけ
 *
 * remote の名前は `origin` という**固定の文字列**で、Renderer から来た値では
 * ない（remote 名を渡せる欄はどこにも無い。shared/ipc/contracts/git.ts）。
 *
 * `url` は GitHub 側で repository を作った結果として返ってきた文字列で、
 * これも Renderer からは来ない（main/github/publishRepository.ts）。形の検証は
 * 渡す側が済ませている ── この表は「何を実行するか」だけを持ち、値の良し悪しは
 * 呼び出し側が先に決める（`stagePaths` と同じ分担）。
 *
 * ## `set-url` ではなく `add`
 *
 * `git remote add` は、その名前が**既にあれば失敗する**。それがここで
 * 欲しい振る舞いになる ── `set-url` は黙って上書きするため、既に別の
 * remote を設定しているリポジトリで公開を押すと、**送り先が入れ替わる。**
 *
 * 呼ぶ側でも先に「remote が1つも無いこと」を確かめてあり（publishRepository.ts）、
 * 二重の備えになっている（pathspec に `--` と `--literal-pathspecs` を
 * 両方掛けているのと同じ構え）。
 *
 * `--fetch` は付けない ── 追加した直後にネットワークへ出ることになり、
 * この1回で何が起きるかが増える。
 */
export function addOriginRemote(url: string): GitCommand {
  return { label: 'remote add origin', args: ['remote', 'add', 'origin', url] }
}

/**
 * 公開の初回 Push（Session 3-8-10）。
 *
 * ## ここだけ `credential.interactive=false` を外す
 *
 * 引数の中身は `pushSettingUpstream` と同じ（`push.default=current` +
 * `--set-upstream`）で、違いは **`NON_INTERACTIVE_CREDENTIALS` を渡さない**
 * ことだけになる。
 *
 * 3-8-5 で対話を止めたのは、**利用者が頼んでいない場面**（保存のたびに走る
 * 読み取りの延長や、Push ボタン1つ）でアプリの裏に認証ウィンドウが出て、
 * 見つけられないまま数分固まるのを避けるためだった。
 *
 * 公開の初回 Push はそこが違う ── 利用者は今まさに
 * 「GitHub に公開する」と押したところで、**認証を求められることを予期できる
 * 唯一の場面**にあたる。ここで helper を黙らせると、GitHub CLI で
 * ログインを済ませた人が、初回 Push だけ `auth-required` で断られ、
 * 「Terminal で1度 push してください」と案内されることになる ──
 * アプリの中で完結すると言った手順が、最後の1歩だけ外に出る。
 *
 * **外すのはこの1回だけ。** 以降の Push / Pull は `pushToUpstream` /
 * `fetchFromRemote` を通り、対話は止まったままになる。
 *
 * `GIT_TERMINAL_PROMPT=0`（gitEnvironment.ts）は外していない ── 端末が
 * 付いていない子プロセスに**文字入力を待たせる**ことには、この場面でも
 * 意味が無い（待っているものが誰にも見えない）。出てよいのは
 * helper 自身のウィンドウだけになる。
 *
 * 待ち時間の上限も別に持たせてある（人が答える時間が要る。
 * runGit.ts の `GIT_INTERACTIVE_PUSH_TIMEOUT_MS`）。
 */
export function pushSettingUpstreamInteractively(): GitCommand {
  return {
    label: 'push --set-upstream (interactive credentials)',
    args: ['-c', 'push.default=current', 'push', '--quiet', '--set-upstream']
  }
}
