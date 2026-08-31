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
 * 新しいブランチを作って、そこへ切り替える（Session 3-8-6 / 3-8-13）。
 *
 * ## 作るのと切り替えるのを1回にする
 *
 * `git branch <name>` と `git switch <name>` の2回に分けない。分けると
 * 1つめが通って2つめが通らなかったとき、**作られたのに切り替わっていない**
 * 状態が残る ── 利用者はもう一度押すか、気づかないまま前のブランチに
 * Commit を積むことになる。`switch --create` は1回で両方を行い、
 * 切り替えられなければブランチも作られない。
 *
 * これは 3-8-13 で始点を渡せるようにした後も変わらない ── むしろそこで
 * いちばん効く。始点を渡した切り替えは**作業ツリーの中身を書き換える**ため、
 * 書きかけがあると git が断る（`local-changes-blocked`）。そのとき
 * ブランチだけが残ると、「押したのに切り替わっていないブランチ」が
 * 一覧に増える ── 実際に確かめてあり、`switch -c` は ref を作らずに終わる
 * （main/git/gitBranchRepository.test.ts）。
 *
 * ## 始点は「渡されなければ HEAD」
 *
 * `startPoint` が `null` なら位置引数を1つも足さない ＝ git は HEAD から作る。
 * これが 3-8-6 からの形で、バーの「＋」から作るときはこちらになる。
 *
 * **detached HEAD からでも作れる**のはこの形の効き目にあたる ── 今居る commit に
 * 名前が付くので、「どこにも属さない commit」から抜け出す手立てになる
 * （Push が detached で断るのとは対照的に、こちらは塞がない）。
 *
 * ## 始点は独立した1つの引数として、`--end-of-options` の後ろに置く（3-8-13）
 *
 * 履歴の行から作るときだけ、短い hash がここに載る。置き方は 3-8-12 の
 * `showCommitSummary` / `showCommitFileChanges` とまったく同じで、
 * **`<hash>^` や `<hash>:<path>` のような組み立ては1つも作らない。**
 *
 * 形の検証は `main/git/gitCommitHash.ts`（16進 4〜40 桁）が持ち、
 * ハンドラが通す ── ここへ届く時点で `HEAD~5` も `main@{1}` も存在しない。
 *
 * ## `--end-of-options` の位置は「名前の後ろ」でなければならない
 *
 * 切り替え（`switchBranch`）と違い、**名前は位置引数ではない** ── `--create` が
 * 自分の引数として受け取る値になる（`git switch -c <new> [<start-point>]`）。
 * したがって名前の**手前**に `--end-of-options` を挟むと、名前が `--create` の
 * 引数ではなく始点として読まれ、`invalid reference` で断られる（確かめた）。
 *
 * 名前の**後ろ**に置く分には、始点だけがその後ろの位置引数になる（これも
 * 一時リポジトリで確かめた）。3-8-6 の時点で「`--create` は必ず最後」と
 * 書いていたのは位置引数が1つも無かったためで、**その後ろに置けるのは
 * 始点だけ**、というのが 3-8-13 での言い直しになる。
 *
 * 名前の側は `--end-of-options` が無くてもオプションとして読まれない ──
 * オプションの引数はその次の1つを**そのまま**取るためで、`-weird` を渡すと git は
 * 「オプションが2つ並んでいる」ではなく「`-weird` はブランチ名として不正だ」と
 * 断る（これも確かめた）。名前の側でも先頭の `-` を弾いてあり
 * （shared/git/branchName.ts）、二重の備えはここでも保たれている。
 *
 * ## 付けていないもの
 *
 * `--force`（`-C`）は渡さない。既にある名前を別の commit へ**付け替える**操作で、
 * 元の枝がどこにあったかを見失わせる ── 同じ名前があれば `branch-exists` として
 * 断る（shared/git/operation.ts）。始点を渡せるようになった 3-8-13 では、
 * これを付けるといよいよ「押し間違いで枝が消える」形になる。
 *
 * `--track` / `--no-track` も渡さない。始点はどちらの場合もローカルの commit で、
 * 既定では追跡先が付かない ── 付けるかどうかはリポジトリの設定
 * （`branch.autoSetupMerge`）の領分になる。
 */
export function createBranch(name: string, startPoint: string | null): GitCommand {
  const args = ['switch', '--quiet', '--create', name]

  /*
    渡されたときだけ位置引数を足す。`null` のときに `HEAD` と**書かない**のは
    履歴（`listCommitHistory`）と同じ判断で、「ここに rev を置ける」という形
    そのものを残さないため ── 書かなければ git が HEAD から作る。
  */
  if (startPoint !== null) {
    args.push(END_OF_OPTIONS, startPoint)
  }

  return { label: 'switch --create', args }
}

/* ------------------------------------ 削除 / rename（Session 3-8-14） */

/**
 * ローカルブランチを1つ削除する（Session 3-8-14）。
 *
 * ## `switch` ではなく `branch` を動かす、最初のブランチ操作
 *
 * 3-8-6 と 3-8-13 のブランチ操作（切り替え・作成）は、どちらも `git switch` で
 * **作業ツリーを書き換える**ものだった。削除はそうではない ── 消えるのは
 * `refs/heads/<name>` という ref 1つとその reflog で、作業ツリーも index も
 * 1バイトも動かない（実物で確かめてある）。
 *
 * 待ち時間の上限が切り替えと違う（既定の 10 秒）のはこのためになる ──
 * `GIT_CHECKOUT_TIMEOUT_MS` が2分なのは「ファイル数・ウイルス対策・
 * ネットワークドライブ」が効くからで、ここにはそのどれも効かない
 * （`post-checkout` hook も走らない）。
 *
 * ## `--force`（`-D`）は渡さない
 *
 * `-d` が断るのは「HEAD にも追跡先にもマージされていない」ブランチで、
 * そこには**そのブランチからしか辿れない commit** がある。`-D` はそれを
 * 到達不能にする ── 戻すには reflog から hash を探すことになり、
 * 押し間違いの代償が釣り合わない。
 *
 * これは `--force` push（3-8-5）・`switch --force`（3-8-6）・
 * `branch --force`（3-8-13）と同じ線にあたる。**危ないものを弾くのではなく、
 * 渡せる欄そのものを作らない** ── この関数には引数が1つしか無い。
 *
 * ## 名前は `--end-of-options` の後ろの位置引数
 *
 * `switchBranch` とまったく同じ置き方になる（`--create` のような
 * 「オプション自身の引数」ではないため、3-8-13 の言い直しはここには効かない）。
 * `git branch -d --end-of-options <name>` が通ることは確かめてある。
 *
 * ## `--quiet` は渡さない
 *
 * 成功したときの `Deleted branch x (was <hash>)` は **stdout** に出る。
 * 分類には使わないが、消した ref がどの commit を指していたかは
 * ログに残しておきたい唯一の値になる（reflog を見に行く前の手掛かり）──
 * `runBranchRefCommand` がそれをログへ落とす（main/git/gitBranches.ts）。
 */
export function deleteBranch(name: string): GitCommand {
  return {
    label: 'branch --delete',
    args: ['branch', '--delete', END_OF_OPTIONS, name]
  }
}

/**
 * ローカルブランチの名前を変える（Session 3-8-14）。
 *
 * ## 常に2引数形にする
 *
 * git は `git branch -m <新名>` の1引数形も受け取る（今のブランチを改名する）が、
 * **その形は使わない。** 使うと「どの枝を改名するのか」がコマンドに書かれず、
 * 押してから git が動くまでの間に HEAD が変わっていた場合に
 * **画面で選んだのとは別のブランチが改名される** ── 一覧の行から押す操作である
 * 以上、対象は常に名指しする。今のブランチを改名するときも同じ形を通る。
 *
 * 位置引数が2つ並ぶのはこのアプリで初めてになるが、置き方は変わらない ──
 * `--end-of-options` の後ろに、独立した引数として2つ。どちらも
 * `normalizeGitBranchName` を通った形しか届かない（main/ipc/handlers/git.ts）。
 *
 * ## `--force`（`-M`）は「相手を消して名前を奪う」
 *
 * 既にある別のブランチの名前へ改名しようとしたときに、`-M` はその相手を
 * **黙って消す。** したがって既定では渡さず、行き先が実在すれば git が
 * `branch-exists` として断る（3-8-13 で `-C` を断ったのと同じ判断）。
 *
 * ## ただし、大文字小文字だけを変える改名は `-M` でしか通らない
 *
 * Windows（と既定の macOS）では `refs/heads/feature` と `refs/heads/Feature` が
 * **同じファイル**になるため、`-m feature Feature` は
 * `a branch named 'Feature' already exists` で断られる（確かめた）。
 * このとき「既にある」と指されているのは**改名しようとしているブランチ自身**で、
 * 別のブランチではない ── つまり `-M` が消す相手は自分自身になり、
 * 上の危うさが当てはまらない。
 *
 * `force` を立てるかどうかを決めるのは呼ぶ側で、そこには条件が2つ掛かる
 * （綴りが大文字小文字だけ違う・**完全に同じ綴りの ref が実在しない**）。
 * 2つめを `for-each-ref` の完全名で確かめてから渡す形にしてあり、
 * この関数が自分で判断することはしない（main/git/gitBranches.ts）。
 */
export function renameBranch(name: string, newName: string, force: boolean): GitCommand {
  return {
    label: force ? 'branch --move --force' : 'branch --move',
    args: [
      'branch',
      '--move',
      ...(force ? (['--force'] as const) : []),
      END_OF_OPTIONS,
      name,
      newName
    ]
  }
}

/**
 * その綴りちょうどのローカルブランチが実在するかを尋ねる（Session 3-8-14）。
 *
 * ## なぜ `show-ref --verify` ではないのか
 *
 * `git show-ref --verify refs/heads/Feature` は、`feature` しか無い Windows でも
 * **成功を返す**（確かめた）── ref の実体がファイルで、その参照が
 * ファイルシステム越しに行われるため。つまり「大文字小文字まで含めて
 * 同じものがあるか」の答えには使えない。
 *
 * ## なぜ `for-each-ref` ではなく `branch --list` なのか
 *
 * `for-each-ref` のパターンは**完全な refname**（`refs/heads/<name>`）で
 * 書く必要があり、外から来た名前に固定の接頭辞を**繋いだ1つの引数**を
 * 作ることになる。このアプリは境界を渡った値を他の文字と繋いで引数にしない
 * （3-8-12 で `<hash>^` や `<hash>:<path>` を作らないと決めたのと同じ線）──
 * `branch --list` のパターンは短い名前をそのまま取るので、名前は最後まで
 * **独立した1つの引数**のままでいられる。
 *
 * 一覧を読むのに `git branch` を使わない（§14.14）のは、あちらが人向けの出力で
 * 印と字下げが混ざるためだった。ここは `--format` で欄を自分で決めているので
 * その問題は起きない ── 読むのは「1行返ったか、空か」だけになる。
 *
 * 突き合わせの相手は**保管されている名前**で、loose ref（ディレクトリを
 * 列挙して得た正式な綴り）でも packed-refs（テキストの行）でも
 * 大文字小文字を区別する ── どちらの保管形でもそうなることを確かめてある。
 *
 * パターンは fnmatch として読まれるが、`*` `?` `[` `\` は名前の形の検証で
 * 弾いてある（shared/git/branchName.ts）ため、ここへ届く名前に
 * ワイルドカードは入らない。`--end-of-options` を挟むのも他と同じ。
 *
 * 出力が空なら「その綴りのブランチは無い」で、終了コードは 0 のまま
 * （見つからないことは失敗ではない）。
 *
 * 使うのは rename が**大文字小文字だけの違い**だったときの1回だけになる
 * （main/git/gitBranches.ts）── 毎回の rename で git を1回増やさない。
 */
export function listExactBranch(name: string): GitCommand {
  return {
    label: 'branch --list (exact)',
    args: ['branch', '--list', '--format=%(refname:short)', END_OF_OPTIONS, name]
  }
}

/* ------------------------------ マージ（Session 3-8-20） */

/**
 * ローカルブランチを今のブランチへ取り込む（Session 3-8-20）。
 *
 * ## `mergeUpstreamFastForwardOnly`（3-8-5）と別の関数にしてある
 *
 * 動かすのは同じ `git merge` だが、**引数が3つとも違う。**
 *
 *   相手      … `@{upstream}`（設定が指すもの）／ここは一覧から選ばれた名前
 *   早送り    … `--ff-only`（できなければ断る）／ここは `--ff`（できなければ作る）
 *   起こること … 取り込めるか断られるか／ここは競合しうる
 *
 * 1つの関数に引数で振らせると、**Pull の側にうっかり merge commit を
 * 作らせる道**が1つできる。この表は「何を実行するか」を数え上げる場所なので、
 * 数えられるものだけを置く（`listLocalBranches` と `listRemoteBranches` を
 * 分けてあるのと同じ判断）。
 *
 * ## 引数の1つ1つに理由がある
 *
 * | 引数              | なぜ                                                                       |
 * | ----------------- | -------------------------------------------------------------------------- |
 * | `--quiet`         | 進捗を出さない。結末は終了コードと出力の分類で決める（他の操作と同じ）     |
 * | `--no-edit`       | **エディタを開かせない。** 開くと git が待ち続け、上限まで返ってこない     |
 * | `--ff`            | PC ごとの `merge.ff` に振る舞いを左右させない（下記）                       |
 * | `--no-autostash`  | アプリが**見えない stash** を作らない（下記）                               |
 * | `--end-of-options`| `-x` で始まる名前をオプションとして読ませない（他の操作と同じ）             |
 *
 * ## `--ff` を明示する（既定と同じでも書く）
 *
 * git の既定は `--ff` だが、`merge.ff` を `false` / `only` にしている PC では
 * 変わる ── 前者では**早送りできる場面でも merge commit が作られ**、
 * 後者では**枝分かれしていると断られる**。どちらも「同じボタンが PC ごとに
 * 違うことをする」で、Pull で `git pull` を使わないと決めた理由
 * （`pull.rebase` 次第で merge にも rebase にもなる）とまったく同じにあたる。
 *
 * `--ff` はどちらの設定も上書きする（実物で確かめてある。
 * main/git/gitMergeRepository.test.ts）。
 *
 * 早送りできる場合はそのまま早送りし、**不要な merge commit を作らない** ──
 * `--no-ff` を渡す欄は作っていない（履歴の形を決める判断で、
 * リポジトリの流儀によって答えが違う）。
 *
 * ## `--no-autostash` を明示する
 *
 * `merge.autoStash=true` の PC では、git が作業ツリーの変更を**自動で退避して
 * から**マージし、終わったら戻す。通ってしまえば見た目は親切だが、
 * 途中で失敗すると退避が残り、**利用者が作った覚えのない stash** が
 * 一覧（Session 3-8-15）に並ぶことになる。
 *
 * 明示して切ると、作業ツリーが邪魔な場合は git が
 * `local-changes-blocked` として断る ── 次の一手（Commit するか退避する）は
 * どちらもアプリの中に在り、**利用者自身が押す**（実物で確かめてある）。
 *
 * ## 付けていないもの
 *
 * | 付けない                          | なぜ                                                         |
 * | --------------------------------- | ------------------------------------------------------------ |
 * | `--squash` / `--no-commit`        | 履歴の形を決める判断。アプリが黙って選ばない（3-8-20 の範囲外）|
 * | `-X ours` / `-X theirs`           | 競合を**自動で潰す**。書いた人の中身が黙って消えうる           |
 * | `--allow-unrelated-histories`     | 無関係な履歴を1つの枝に混ぜる。戻すには reset が要る          |
 * | `--no-verify`                     | リポジトリが置いた hook をアプリが黙って外さない（Commit と同じ）|
 * | `-m <メッセージ>`                 | merge commit の文面は git の既定（`Merge branch 'x'`）に任せる |
 */
export function mergeBranch(name: string): GitCommand {
  return {
    label: 'merge',
    args: ['merge', '--quiet', '--no-edit', '--ff', '--no-autostash', END_OF_OPTIONS, name]
  }
}

/**
 * 途中のマージをやめて、始める前の状態へ戻す（Session 3-8-20）。
 *
 * ## 引数が1つも無い
 *
 * 何を中止するかは渡さない ── 途中のマージは常に高々1つで、それは
 * `MERGE_HEAD` が指している。渡せる欄が無いということは、**境界を渡った値が
 * 混ざる余地がそもそも無い**ということにあたる（`fetchFromRemote` /
 * `pushToUpstream` と同じ形）。
 *
 * ## `--quiet` を渡さない
 *
 * `git merge --abort` に `--quiet` は無い（渡すと不明なオプションとして
 * 断られる）。成功したときは何も言わずに 0 で終わる。
 *
 * ## `reset --hard` を使わない
 *
 * 見た目の結果は近いが、あれは**指した1点まで作業ツリーごと巻き戻す**もので、
 * マージを始める前から在った変更まで消える。`--abort` はそこを残す
 * （実物で確かめてある）── 3-8-9 で `reset --hard` を使わないと決めたのと
 * 同じ線が、ここにも当てはまる。
 */
export function abortMerge(): GitCommand {
  return { label: 'merge --abort', args: ['merge', '--abort'] }
}

/**
 * マージの途中かを尋ねる（Session 3-8-20）。
 *
 * ## `.git/MERGE_HEAD` をファイルとして見に行かない
 *
 * `existsSync` で済みそうに見えるが、それは**`.git` の中の置き方を
 * アプリが知っていることにする**ことになる（`.git` がファイル1つの
 * worktree 形式・`GIT_DIR` が別の場所、のどちらでも外れる）。
 * リポジトリの中身を読むのは常に git を通す、という 3-8-1 からの構えを崩さない。
 *
 * ## 終了コードだけで読める
 *
 * `--verify --quiet` を付けると、**在れば 0（hash を1行出す）・無ければ 1**で
 * 終わり、標準エラーには何も出ない（実物で確かめてある。commit が1つも無い
 * リポジトリでも 1 になる）── 読むのは終了コードだけで、
 * 出力を解釈する必要が無い。
 */
export function verifyMergeHead(): GitCommand {
  return {
    label: 'rev-parse --verify MERGE_HEAD',
    args: ['rev-parse', '--verify', '--quiet', 'MERGE_HEAD']
  }
}

/* ------------------------ remote-tracking branch（Session 3-8-19） */

/**
 * remote-tracking branch を一覧する（Session 3-8-19）。
 *
 * ## `listLocalBranches` と別の関数にしてある
 *
 * 見る場所が違う（`refs/remotes/` と `refs/heads/`）だけでなく、
 * **欄が1つ多い。** ここでは `%(symref)` が要る（下記）── 引数に接頭辞を
 * 渡して1つの関数で兼ねる形にすると、`refs/` の下ならどこでも一覧できる
 * 関数が1つできることになる（tag も `refs/notes/` も含めて）。
 * この表は「何を実行するか」を数え上げる場所なので、**数えられるものだけ**を置く。
 *
 * ## `%(symref)` が symbolic HEAD を見分ける
 *
 * `refs/remotes/origin/HEAD` は、その remote の既定ブランチを指す**別名**に
 * あたる（`refs/remotes/origin/main` を指す symbolic ref）。一覧に載せると
 * 「`origin/HEAD` を手元に持ってくる」という、指した先が別の行と同じになる
 * 選択肢が並ぶことになる。
 *
 * 名前で弾く（`/HEAD` で終わる行を落とす）形にしないのは、**`HEAD` という
 * 名前のブランチが remote 側に実在しうる**ため ── ではなく（git は
 * それを禁じている）、名前の形での判定が
 * 「remote 名が `HEAD` で終わる場合」に巻き添えを出すためになる
 * （`refs/remotes/my/HEAD/main` のような ref は作れる）。`%(symref)` は
 * git 自身が持っている区別で、**そこに理由が書いてある**：空でなければ
 * それは別名で、指し先はこの一覧の別の行になる。
 *
 * `%(refname:short)` は symbolic HEAD に対して `origin`（！）を返す ──
 * これも名前で見分けようとすると足を取られるところで、実物で確かめてある。
 *
 * ## `%(refname:lstrip=3)` を使わない
 *
 * `refs/remotes/origin/feature/x` から `feature/x` を切り出す atom は在るが、
 * **remote 名に `/` が入ると間違える** ── `refs/remotes/up/stream/feature/x`
 * （remote 名が `up/stream`）に対して git は `stream/feature/x` を返す
 * （実物で確かめてある）。remote 名に `/` を禁じていない以上
 * （shared/git/remoteName.ts）、この atom は当てにできない。
 *
 * 切り出しは読む側が行う ── `git remote` で得た**名前の一覧**と
 * 突き合わせ、いちばん長い接頭辞で切る（main/git/gitOutput.ts の
 * `readRemoteBranches`）。
 *
 * ## 区切り・上限・並べ替えは `listLocalBranches` と同じ
 *
 * 区切りは NUL（ref 名に何が入っていても読み分けられる）、上限は
 * `--count` で git 自身に掛け、**1つ多く求めて切れたかを知る。**
 * 並べ替えは指定しない ＝ git の既定（refname 順）。
 */
export function listRemoteBranches(limit: number): GitCommand {
  return {
    label: 'for-each-ref refs/remotes',
    args: [
      'for-each-ref',
      '--format=%(refname:short)%00%(symref)',
      `--count=${limit + 1}`,
      'refs/remotes/'
    ]
  }
}

/**
 * その名前ちょうどの remote-tracking branch が実在するかを尋ねる（Session 3-8-19）。
 *
 * ## 何のために聞くのか
 *
 * 作成の要求に載る `startPoint` は、形としては
 * `normalizeGitBranchName` を通っただけの文字列にあたる（`origin/feature` も
 * `main` も同じように通る）。**形が通ることと、それが remote-tracking branch で
 * あることは別**になる ── 確かめずに `switch --create --track main` を動かすと、
 * git は `branch.<名前>.remote=.` を書いて**ローカルを追うローカルブランチ**を
 * 作る（実物で確かめてある）。押した人が一覧から選んだのは remote の枝なので、
 * それは指していないものにあたる。
 *
 * ## `--remotes` を付けた `branch --list` を使う
 *
 * `listExactBranch`（3-8-14）とまったく同じ形で、違うのは `--remotes` の1語だけ。
 * `for-each-ref` にしないのは 3-8-14 と同じ理由になる ── あちらのパターンは
 * **完全な refname** で書く必要があり、外から来た名前に `refs/remotes/` を
 * **繋いだ1つの引数**を作ることになる。このアプリは境界を渡った値を他の文字と
 * 繋いで引数にしない（3-8-12 で `<hash>^` を作らないと決めたのと同じ線）。
 *
 * `--remotes` を付けた `branch --list` のパターンは `origin/feature` のような
 * 短い形をそのまま取るので、名前は最後まで**独立した1つの引数**のままでいられる。
 * ローカルブランチ名を渡すと**何も返らない**（実物で確かめてある）── つまり
 * この1回が「remote-tracking branch であること」の答えになる。
 *
 * ## `%(symref)` も一緒に読む
 *
 * `origin/HEAD` を渡すとこのパターンは**一致する**（実物で確かめてある）──
 * 一覧から除いてあるものが、要求としては届きうる。したがってここでも
 * symbolic かどうかを読み、別名は始点として認めない
 * （main/git/gitRemoteBranches.ts）。
 *
 * パターンは fnmatch として読まれるが、`*` `?` `[` `\` は名前の形の検証で
 * 弾いてある（shared/git/branchName.ts）ため、ここへ届く名前に
 * ワイルドカードは入らない。出力が空なら「その名前の remote-tracking branch は
 * 無い」で、終了コードは 0 のまま（見つからないことは失敗ではない）。
 */
export function listExactRemoteBranch(name: string): GitCommand {
  return {
    label: 'branch --remotes --list (exact)',
    args: [
      'branch',
      '--remotes',
      '--list',
      '--format=%(refname:short)%00%(symref)',
      END_OF_OPTIONS,
      name
    ]
  }
}

/**
 * remote-tracking branch を追うローカルブランチを作って、そこへ切り替える
 * （Session 3-8-19）。
 *
 * ## `createBranch` と別の関数にしてある
 *
 * 動かす git は同じ `git switch --create` だが、**渡す引数が1つ増え、
 * その1つで起きることが変わる。**
 *
 *   `createBranch`         … 追跡先は付かない（`branch.autoSetupMerge` の領分）
 *   `createTrackingBranch` … `--track` で**必ず**付く（`.git/config` に2行）
 *
 * 1つの関数に `track` の真偽を渡す形にすると、**追跡先を付けるかどうかが
 * 呼び出し側の引数1つで裏返る**ことになる ── `addOriginRemote` と `addRemote` を
 * 書き分けた（3-8-16）のと同じ判断で、起きることが違うものは表の上でも分ける。
 *
 * ## `--track` を明示する（既定に任せない）
 *
 * 始点が remote-tracking branch のとき、git は既定で追跡先を設定する
 * （`branch.autoSetupMerge` の既定が `true`）。それでも明示するのは、
 * **その既定が利用者の設定で消えている PC がある**ため ── `false` に
 * してある環境では、押した人から見て「追跡先が付く操作」が黙って
 * 付けない操作になる。この口の意味は追跡先が付くことそのものなので、
 * リポジトリの設定に委ねない。
 *
 * 逆に `--no-track` は**渡す欄そのものを作らない** ── 追跡しない作成は
 * `createBranch` が既にその形で、ここに真偽の欄を作ると口が2つの意味を持つ。
 *
 * ## `--end-of-options` は名前の後ろ（3-8-13 の言い直しがそのまま効く）
 *
 * 名前は位置引数ではなく `--create` 自身の引数になるため、**手前に挟むと
 * 名前が始点として読まれる**（3-8-13 で確かめた）。`--track` はその後ろ、
 * 始点はさらに後ろの位置引数になる ── `switch --quiet --create <名前>
 * --track --end-of-options <始点>` の並びで通ることを実物で確かめてある。
 *
 * `--track` は値を取らないフラグ（値を渡すときは `--track=direct` の形）なので、
 * 次の引数（`--end-of-options`）を飲み込むことは無い。
 *
 * ## 1回で作って切り替える（`createBranch` と同じ）
 *
 * `git branch` と `git switch` の2回に分けない ── 分けると1つめが通って
 * 2つめが通らなかったときに「作られたのに切り替わっていない」状態が残る。
 * ここでは始点が**別の commit**（remote の枝の先端）なので、書きかけがあれば
 * git が断りうる（`local-changes-blocked`）── そのときブランチも作られない
 * ことが要る。
 *
 * ## 付けていないもの
 *
 * `--force`（`-C`）も `--detach` も `--orphan` も `--merge` も渡さない
 * （3-8-6 / 3-8-13 の表がそのまま効く）。同じ名前があれば git を動かす前に
 * `branch-exists` として断る（main/git/gitRemoteBranches.ts）。
 */
export function createTrackingBranch(name: string, startPoint: string): GitCommand {
  return {
    label: 'switch --create --track',
    args: ['switch', '--quiet', '--create', name, '--track', END_OF_OPTIONS, startPoint]
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

/* --------------------------------- commit 1件の詳細（Session 3-8-12） */

/*
 * ## ここで初めて、外から来た rev が引数に載る
 *
 * 3-8-11 まで、rev が引数に載ったことは一度も無かった（`listCommitHistory` は
 * rev を**書かない**ことで HEAD から辿らせている）。commit 1件を開くには
 * どれを開くかを言うしかないため、下の2本では短い hash が引数に載る。
 *
 * ブランチ名（3-8-6）で守った2つを、そのまま守る形にしてある。
 *
 *   1. 値は必ず**独立した1つの引数**（`<hash>:<path>` のような組み立てを作らない）
 *   2. `--end-of-options` の後ろに置く（オプションとして読ませない）
 *
 * さらに形そのものを 16進 4〜40 桁に限ってある（main/git/gitCommitHash.ts）──
 * 先頭が `-` になりようがないので、1 と 2 のどちらかが外れた日にも破れない
 * （pathspec に `--` と `--literal-pathspecs` を両方掛けているのと同じ構え）。
 *
 * ## どちらも読み取りしかしない
 *
 * `show --no-patch` と `diff-tree` の2本で、リポジトリは1バイトも変わらない。
 * revert も cherry-pick も reset も、この表に行そのものが無い。
 */

/**
 * commit 1件の名乗りを訊く（Session 3-8-12）。
 *
 * ## `--format` は `listCommitHistory` とまったく同じ
 *
 * 欄も並びも同じにしてあるので、読む関数も同じ1つになる
 * （main/git/gitOutput.ts の `readCommitRecord`）── 同じ commit が、
 * 一覧では読めて詳細では読めない、という食い違いが起こらない。
 *
 * `-c log.showSignature=false` と `--no-decorate` を付ける理由も同じで、
 * **リポジトリの設定から `git show` の動きを変えられる**2つを先に閉じておく
 * （前者は `gpg` の起動を促す）。
 *
 * ## `--no-patch` が要る
 *
 * `git show` は既定で patch まで出す。commit 1件が数万行あることは普通に
 * あり、その全文を受け取ってから捨てることになる ── 変更ファイルの一覧は
 * 下の `diff-tree` が別に答えるので、ここでは1行だけあればよい。
 *
 * ## 相手が commit でなければ、読めない出力が返る
 *
 * 16進の並びは blob にも tree にも当たりうる（`%h` から来る値しか
 * 画面には出ないが、境界の外から来た値として素直に信じない）。その場合
 * `git show` は**中身をそのまま出して 0 で終わる** ── `--format` は効かない。
 * 読む側は欄の数と hash の形を確かめるので、それは「読めなかった」として
 * `not-found` に落ちる（main/git/gitCommitDetail.ts）。
 */
export function showCommitSummary(hash: string): GitCommand {
  return {
    label: 'show --no-patch',
    args: [
      '-c',
      'log.showSignature=false',
      'show',
      '--no-patch',
      '--no-decorate',
      '--format=%h%x00%an%x00%at%x00%P%x00%s',
      END_OF_OPTIONS,
      hash,
      '--'
    ]
  }
}

/**
 * commit 1件で変わったファイルを訊く（Session 3-8-12）。
 *
 * ## `git show --name-status` ではなく `diff-tree --raw`
 *
 * `--name-status` が返すのは種類と位置だけで、**中身を取りに行くための
 * object 名が載らない。** 載らないと、差分の側で `<hash>^:<path>` を
 * 組み立てるか、`ls-tree` をもう2回動かすことになる ── 前者は
 * 3-8-9 で作らないと決めた形（位置が revision 表記の一部として読まれる余地）に
 * あたる。
 *
 * `--raw` は1行に**両側の mode と object 名**まで載せてくる。
 *
 * ```
 * :100644 100644 <前の object> <後の object> M<NUL>path<NUL>
 * :100644 100644 <前の object> <後の object> R100<NUL>元<NUL>先<NUL>
 * ```
 *
 * つまり差分の2段目に載る引数は、**git 自身がこの1回で答えた object 名**に
 * なる（3-8-9 の `ls-files --stage` / `ls-tree` と同じ性質）。位置は
 * 最後まで pathspec のままで、revision 表記に混ぜられることが無い。
 *
 * ## 付けている指定
 *
 * | 指定              | なぜ                                                                    |
 * | ----------------- | ----------------------------------------------------------------------- |
 * | `--no-commit-id`  | commit の hash の行を出さない（欲しいのは変更の行だけ）                 |
 * | `--no-abbrev`     | object 名を省略させない。**省略されると `cat-file` に渡せない**         |
 * | `-r`              | フォルダで畳まず、ファイル1件ずつ出す                                   |
 * | `-z`              | 位置に改行が入っていても1件を取り違えない（`status` と同じ理由）        |
 * | `--find-renames`  | rename を1件として出す。plumbing の既定は「消えた＋足された」の2件になる |
 * | `--root`          | 親を持たない commit（履歴の1つめ）を、全部が追加された差分として出す     |
 * | `--no-textconv`   | 設定に書かれた**任意のプログラム**を起こさせない（3-8-9 と同じ線）      |
 * | `--no-ext-diff`   | 同上（外部 diff プログラム）                                            |
 *
 * `--find-renames` を**明示している**のは、rename 検出の既定が設定
 * （`diff.renames`）で変わるためになる ── 付けておけば、PC ごとに
 * 「rename が1件に見えたり2件に見えたり」しない。
 *
 * ## マージ commit では何も出力しない
 *
 * `-m` も `-c` も `--cc` も渡していないので、親が2つ以上ある commit では
 * git は**何も出さずに 0 で終わる。** その空を「変更が無い commit」として
 * 出すと嘘になるため、呼ぶ側が先に親の数で分ける（main/git/gitCommitDetail.ts）。
 * 出させる指定を足さないのは、どちらの親と比べるかをアプリが決めない
 * という判断そのものになる（shared/git/commitDetail.ts）。
 */
export function showCommitFileChanges(hash: string): GitCommand {
  return {
    label: 'diff-tree --raw',
    args: [
      LITERAL_PATHSPECS,
      'diff-tree',
      '--no-commit-id',
      '--raw',
      '--no-abbrev',
      '-r',
      '-z',
      '--find-renames',
      '--root',
      '--no-textconv',
      '--no-ext-diff',
      END_OF_OPTIONS,
      hash,
      '--'
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
 * **衝突している位置では stage 1 / 2 / 3 の3行が返る。** どの段を採るかは
 * 読む側が決める（gitBlob.ts）── 3-8-9 の差分と破棄は stage 0 の行だけを
 * 採り、3-8-21 の競合の差分は 2 と 3 を採る。
 *
 * **競合のために別の引数（`ls-files -u`）を足していない。** 同じ出力から
 * 読み分けられるうえ、表に行が増えるほど「何を実行するか」の見通しが
 * 落ちる ── ここは数え上げる場所なので、数え直さずに済む形を採る。
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

/* ------------------------------------------- 退避（Session 3-8-15） */

/**
 * `stash@{N}` を組み立てる（Session 3-8-15）。
 *
 * ## ここだけは、値を他の文字と繋いで引数にする
 *
 * 3-8-12 で `<hash>^` も `<hash>:<path>` も作らないと決め、3-8-14 で
 * `refs/heads/<name>` を作らないために `for-each-ref` ではなく
 * `branch --list` を選んだ ── その線に対して、これは唯一の例外になる。
 *
 * 通してよいのは、**繋ぐ相手が文字列ではなく数**だからにあたる。
 * ハンドラを通った時点で `index` は「0 以上・上限未満の安全な整数」であり
 * （main/ipc/handlers/git.ts）、10進の数字以外の文字が入る余地が無い ──
 * つまり、この文字列に**引数として読み替えられる形が1つも作れない。**
 * 危ういのは「外から来た文字列を繋ぐこと」であって、繋ぐ操作そのものでは
 * なかった、という切り分けになる。
 *
 * git 側に「番号だけを渡す」形は無い（`stash@{N}` が唯一の指し方）ので、
 * 組み立てを避けるなら**退避を指す手立てそのものが無くなる。**
 *
 * それでも `--end-of-options` の後ろに置くのは他と同じ ── 形が固定でも、
 * 置き方の備えを1つだけ外す理由が無い。
 */
function stashReference(index: number): string {
  return `stash@{${index}}`
}

/**
 * 退避の一覧を尋ねる（Session 3-8-15）。
 *
 * ## 外から来た値が1つも無い（`listCommitHistory` と同じ）
 *
 * 変わるのは上限の数だけで、それは `GIT_STASH_LIMIT` から来る**アプリ自身の
 * 定数**になる。並べ替えも絞り込みも渡す欄がそもそも無い
 * （shared/ipc/contracts/git.ts）。
 *
 * ## `git stash list` は `git log` を着せ替えたもの
 *
 * したがって `--format` も `--max-count` もそのまま効く（実物で確かめてある）。
 * 上限より1つ多く求めるのは、**切ったかどうかを知る**ためで、
 * `listLocalBranches` / `listCommitHistory` と同じ形になる。
 *
 * ## 欄の並びは `%gd` → `%h` → `%at` → `%gs`
 *
 *   `%gd` … `stash@{0}`。**番号の出どころはここだけ**にする（読んだ行の
 *            並び順から数えると、読めない行を1つ落とした瞬間に全部ずれる）
 *   `%h`  … その退避そのものの短い hash（押した瞬間の突き合わせに使う）
 *   `%at` … epoch 秒（`%ad` は `log.date` で形が変わる。shared/git/history.ts）
 *   `%gs` … git が付けた名乗り。**何が入っているか分からない値なので最後**に置く
 *
 * 区切りが NUL なのも履歴と同じ理由で、`%gs` には空白も `|` も入りうる。
 * 行の区切りを改行のままにしてよいのは、`%gs` が1行だけを返すためになる。
 *
 * ## 設定で振る舞いが変わる余地を、先に閉じておく
 *
 * `log.showSignature` と `log.decorate` を打ち消すのは `listCommitHistory` と
 * まったく同じ構えで、**`git log` の着せ替えである以上そのまま当てはまる。**
 * 前者は署名の検証（`gpg` の起動）を促す。
 */
export function listStashEntries(limit: number): GitCommand {
  return {
    label: 'stash list --format',
    args: [
      '-c',
      'log.showSignature=false',
      'stash',
      'list',
      '--no-decorate',
      `--max-count=${limit + 1}`,
      '--format=%gd%x00%h%x00%at%x00%gs'
    ]
  }
}

/**
 * 作業ツリーと index の変更を退避する（Session 3-8-15）。
 *
 * ## 位置引数も、外から来た値も1つも無い
 *
 * 退避するのは常に「今の作業ツリーと index の全部」で、pathspec を渡せる欄が
 * 無い（部分退避は置いていない ── 行単位の Stage を置いていないのと同じ線）。
 *
 * ## 付けていないもの
 *
 * | 付けない                        | なぜ                                                                 |
 * | ------------------------------- | -------------------------------------------------------------------- |
 * | `-m <message>`                  | 名前を渡せる欄を作らない。名乗りは git が付ける（`WIP on <branch>: …`） |
 * | `-u` / `--include-untracked`    | 未追跡を作業ツリーから消すことになる（3-8-9 の判断と衝突する）        |
 * | `-a` / `--all`                  | `.gitignore` の対象まで巻き込む。`-u` よりさらに広い                  |
 * | `-k` / `--keep-index`           | 「避けたのに残っている」が段によって変わる。押した結果が読めなくなる  |
 * | `-p` / `--patch`                | 対話が始まる（端末の付いていない子プロセスでは答えられない）          |
 * | pathspec                        | 部分退避。渡せる欄そのものを作らない                                  |
 *
 * ## `--quiet` を渡す
 *
 * 成功したときの `Saved working directory and index state ...` は、**その後に
 * 読み直す一覧に同じことが出ている**（避けた1件が並ぶ）── 削除
 * （`deleteBranch`）で `--quiet` を渡さなかったのは、消えた ref が指していた
 * commit がそこにしか無かったためで、こちらにその事情は無い。
 *
 * ## 退避するものが無くても 0 で終わる
 *
 * `No local changes to save` と言って**成功として終わる**（実物で確かめてある）。
 * したがって「何も無い」を終了コードから知ることはできず、呼ぶ側が
 * 動かす前に分ける（main/git/gitStash.ts）。
 */
export function pushStashEntry(): GitCommand {
  return { label: 'stash push', args: ['stash', 'push', '--quiet'] }
}

/**
 * 指した退避を作業ツリーへ戻し、一覧から取り除く（Session 3-8-15）。
 *
 * ## `--quiet` を渡さない（この1本だけ）
 *
 * `stash pop` が競合したとき、git は**stderr に何も書かない** ── 競合の
 * 知らせ（`CONFLICT (content): Merge conflict in ...`）は stdout に出て、
 * 終了コードだけが 1 になる。そして `--quiet` を渡すと、**その行が消える**
 * （残るのは `The stash entry is kept in case you need it again.` だけ。
 * どちらも実物で確かめてある）。
 *
 * つまりここで `--quiet` を渡すと、「競合したのか、作業ツリーが上書きされる
 * ので何も起きなかったのか」を区別する手立てが無くなる ── その2つは
 * 利用者の次の一手がまったく違う（前者は解決する、後者は先に Commit する）。
 *
 * pop は `git stash` の中で唯一 merge を伴う操作で、**merge の結果は
 * 失敗ではないので stdout に出る**、というのがこの例外の中身になる。
 *
 * ## `--index` は渡さない
 *
 * 退避したときに index に載っていたものは unstaged として戻る（実物で
 * 確かめてある）。段まで復元すると競合時の振る舞いが増える一方、
 * Stage は一覧の `＋` で1回で戻せる。
 *
 * ## 番号は独立した1つの引数として、`--end-of-options` の後ろに置く
 *
 * 組み立てるのは `stashReference`（上記）で、繋ぐ相手が検証済みの整数で
 * あることがその安全の中身になる。
 */
export function popStashEntry(index: number): GitCommand {
  return { label: 'stash pop', args: ['stash', 'pop', END_OF_OPTIONS, stashReference(index)] }
}

/**
 * 指した退避を捨てる（Session 3-8-15）。
 *
 * ## `--quiet` は渡さない（`deleteBranch` と同じ理由）
 *
 * 成功したときの `Dropped stash@{0} (<完全な hash>)` は stdout に出る。
 * 分類には使わないが、**捨てた中身がどの commit だったか**は、後から
 * `git fsck --unreachable` で拾い直す前の唯一の手掛かりになる ──
 * Renderer へは渡さず（分類だけが境界を越える）、ログには残す
 * （main/git/gitStash.ts）。
 *
 * ## `clear`（全部捨てる）はこの表に置かない
 *
 * 渡せるのは1件で、複数を渡せる欄は作らない（ブランチの一括削除と同じ線）。
 */
export function dropStashEntry(index: number): GitCommand {
  return { label: 'stash drop', args: ['stash', 'drop', END_OF_OPTIONS, stashReference(index)] }
}

/**
 * その位置に居る退避の完全な hash を尋ねる（Session 3-8-15）。
 *
 * ## 押す直前に、もう一度だけ確かめるための1回
 *
 * `stash@{N}` は名前ではなく**上から数えた位置**で、退避を1つ作れば全部が
 * 1つずつ後ろへずれる（実物で確かめてある）。一覧を出してから押すまでの間に
 * 端末で `git stash` を1回打たれると、**画面で選んだのとは違う退避が
 * pop / drop される。**
 *
 * そこで、動かす前にその位置を解いて、一覧の行が持っていた短い hash と
 * 突き合わせる（main/git/gitStash.ts）。3-8-14 が `--force` を立てる前に
 * 「相手は自分自身か」を `branch --list` で確かめたのと同じ構えになる。
 *
 * ## `--short` ではなく完全な hash を取る
 *
 * 短縮の桁数はリポジトリの大きさで変わる（`core.abbrev` の既定は auto）──
 * 一覧を読んだ時点と押した時点で桁が変わりうるため、短い形どうしを
 * 等しさで比べると、変わっていないものを「変わった」と読む。完全な hash を
 * 取って**前方一致で見る**方が、短い hash の意味（先頭何桁か）そのものになる。
 *
 * 完全な hash は Main の中だけで使い、Renderer へは渡さない（§14.19）。
 *
 * ## 解けなければ非0で終わる
 *
 * 範囲外（`stash@{9}` で 1 件しか無い）は 128、退避が1件も無ければ 1 で
 * 終わり、`--quiet` のおかげでどちらも何も出力しない（実物で確かめてある）──
 * 呼ぶ側は「0 で終わって hash が読めたか」だけを見ればよい。
 */
export function showStashObject(index: number): GitCommand {
  return {
    label: 'rev-parse (stash)',
    args: ['rev-parse', '--verify', '--quiet', END_OF_OPTIONS, stashReference(index)]
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

/* ------------------------------------------- remote の管理（Session 3-8-16） */

/**
 * 設定されている remote を、URL 付きで尋ねる（Session 3-8-16）。
 *
 * ## `listRemotes`（名前だけ）と別の1本にしてある
 *
 * あちらは Push の前に「1つでも在るか」を確かめるためのもので、
 * **出力を捨てている**（有無だけを見る。main/git/gitRepository.ts の
 * `resolveHasRemote`）。こちらは一覧を作るために URL まで要る ──
 * 用途が違うものを1つにまとめると、状態を読むたびに使わない URL まで
 * 運ぶことになる（状態の読み直しは保存のたびに走る）。
 *
 * ## 出力の形
 *
 * 1件につき2行出る（実物で確かめてある）。
 *
 * ```
 * origin<TAB>https://github.com/o/r.git (fetch)
 * origin<TAB>https://github.com/o/r.git (push)
 * ```
 *
 * 名前と URL の区切りは **TAB** で、末尾に用途が括弧付きで付く。
 * remote 名に TAB は入らない（git が禁じ、こちらも弾いている。
 * shared/git/remoteName.ts）ので、名前の側に何が入っていても読み分けられる ──
 * `for-each-ref` の区切りを NUL にしたのと同じ考え方になる。
 *
 * `--verbose` を短縮形（`-v`）で書かないのは、この表の他の引数と同じ理由で、
 * 読んだときに何を頼んでいるかがそのまま分かる方を採るため。
 *
 * ## 上限を git に掛けられない
 *
 * `for-each-ref`（`--count`）や `log`（`--max-count`）と違い、
 * `git remote` に件数を切る指定は無い ── したがって上限は読む側で掛ける
 * （main/git/gitOutput.ts の `readRemoteEntries`）。remote は普通1つか2つで、
 * 数千行が返る形が現実には起こらないため、その差は問題にならない。
 */
export function listRemoteUrls(): GitCommand {
  return { label: 'remote --verbose', args: ['remote', '--verbose'] }
}

/**
 * remote を1つ追加する（Session 3-8-16）。
 *
 * ## `addOriginRemote` と書き分けてある
 *
 * 動かす git は同じ `git remote add` だが、**受け取る値の出どころが違う。**
 *
 *   `addOriginRemote` … 名前は固定の `origin`、URL は GitHub が返したもの。
 *                       **Renderer 由来の値が1つも入らない**（3-8-10）
 *   `addRemote`       … 名前も URL も Renderer から来る（3-8-16）
 *
 * 1つの関数にまとめると、3-8-10 の「公開の口には Renderer 由来の URL が
 * 入らない」という保証が、呼び出し側の使い分けの話に落ちる ──
 * 削除と rename の失敗の分類を書き写して分けた（3-8-14）のと同じ判断になる。
 *
 * ## `--end-of-options` を置くが、それだけでは足りない
 *
 * `git remote add --end-of-options -x <url>` は git が**受け取る** ── `-x` と
 * いう名前の remote が実際に作られ、その後 `git remote remove -x` は
 * オプションとして読まれるため**消せなくなる**（実物で確かめた）。
 * つまりこの引数が守るのは「引数として解釈されない」ことだけで、
 * **扱えない名前が生まれること**は止めない ── 先頭の `-` は名前の側の
 * 検証でも弾いてある（shared/git/remoteName.ts）。
 *
 * URL の側も同じで、`ext::sh -c whoami` のような値を git は受け取る
 * （追加した時点では何も起きず、以降の fetch / push でシェルが走る）。
 * したがって通す形は3つだけに絞ってある（shared/git/remoteUrl.ts）。
 * **ここは表で、値の良し悪しは呼び出し側が先に決める**（`stagePaths` と
 * 同じ分担）。
 *
 * ## 付けていないもの
 *
 * | 付けない   | なぜ                                                             |
 * | ---------- | ---------------------------------------------------------------- |
 * | `--fetch`  | 追加した直後にネットワークへ出ることになり、1回で起きることが増える |
 * | `--tags`   | 取ってくるものを増やす指定。取ってくる操作はここではない          |
 * | `--track`  | 特定のブランチだけを追う設定。渡せる欄そのものを作らない          |
 * | `--mirror` | **push すると remote 側の ref を消しうる。** 3-8-13 の `--force` と同じ線 |
 */
export function addRemote(name: string, url: string): GitCommand {
  return { label: 'remote add', args: ['remote', 'add', END_OF_OPTIONS, name, url] }
}

/**
 * remote を1つ削除する（Session 3-8-16）。
 *
 * `--end-of-options` が要るのはここがいちばんはっきりしている ── 先頭が `-` の
 * remote 名（端末から作られていることがある）に対して、これを置かないと
 * git は名前をオプションとして読む（実物で確かめた）。置いてあれば、
 * アプリからは消せる。
 *
 * 消えるのは3つで、**commit は1つも失われない**（実物で確かめてある。
 * main/git/gitRemoteRepository.test.ts）。
 *
 *   `remote.<名前>.*`            … URL と fetch の refspec
 *   `refs/remotes/<名前>/*`      … 手元の remote-tracking ref
 *   `branch.*.remote` / `.merge` … その remote を追っていたブランチの追跡先
 *
 * `remove` と `rm` は同じものだが、**綴りの長い方**を使う ── この表の
 * 他の引数（`--delete` / `--verbose` / `--set-upstream`）と揃える。
 */
export function removeRemote(name: string): GitCommand {
  return { label: 'remote remove', args: ['remote', 'remove', END_OF_OPTIONS, name] }
}

/* ------------------------------------- remote の URL / 名前（Session 3-8-17） */

/**
 * remote の URL を差し替える（Session 3-8-17）。
 *
 * ## `addRemote` と同じ2つの値を、同じ備えで渡す
 *
 * 名前も URL も Renderer から来る点は追加と同じで、通ってくる規則も同じ
 * （shared/git/remoteName.ts / remoteUrl.ts）。したがって `--end-of-options`
 * もそのまま置く ── 端末から作られた先頭が `-` の remote に対して、
 * これが無いと名前がオプションとして読まれる（`removeRemote` と同じ事情）。
 *
 * **URL の側の備えは、追加より1mm も緩めない。** `git remote set-url x
 * "ext::sh -c whoami"` も git はそのまま受け取る（実物で確かめてある。
 * main/git/gitRemoteRepository.test.ts）── 追加の口だけを固めても、
 * 変更の口が素通しなら**同じ穴が2つめとして開く**ことになる。
 *
 * ## 書き換えるのは設定の1行だけ
 *
 * `remote.<名前>.url` が変わり、次の3つは1つも動かない（実物で確かめてある）。
 *
 *   `remote.<名前>.fetch`        … refspec はそのまま
 *   `refs/remotes/<名前>/*`      … **前の送り先から取ってきた commit を指したまま**
 *   `branch.*.remote` / `.merge` … 追跡先はそのまま
 *
 * 古い remote-tracking ref を消す指定（`--prune` 相当）は**渡さない** ──
 * ref を消す操作がここに混ざることになり、削除（`removeRemote`）との
 * 境目が消える。残った ref は次の Pull で揃う。
 *
 * ## 付けていないもの
 *
 * | 付けない   | なぜ                                                                 |
 * | ---------- | -------------------------------------------------------------------- |
 * | `--push`   | push 側だけ別の URL にする指定。一覧が載せるのは fetch 側1つ（3-8-16） |
 * | `--add`    | 1つの remote に URL を複数持たせる。一覧がその形を表せない            |
 * | `--delete` | URL を減らす。持たせていないものを減らす欄は要らない                  |
 */
export function setRemoteUrl(name: string, url: string): GitCommand {
  return { label: 'remote set-url', args: ['remote', 'set-url', END_OF_OPTIONS, name, url] }
}

/**
 * remote の名前を変える（Session 3-8-17）。
 *
 * ## `renameBranch` と違い、`--force` に当たるものが無い
 *
 * `git branch --move` には `--force`（`-M`）があり、3-8-14 では
 * **相手が自分自身だと確かめられた1点**（大文字小文字だけの改名）で
 * それを立てて通した。`git remote rename` にその引数は無い。
 *
 * そして Windows では、大文字小文字だけの改名を渡すと git は
 * `cannot lock ref 'refs/remotes/Origin/main'` で落ちる ── しかも
 * **途中まで適用したまま**止まり、`remote.<新名>.url` だけが書かれて
 * refspec も remote-tracking ref も `branch.*.remote` も古い名前を
 * 指したままになる（実物で確かめてある。main/git/gitRemoteRepository.test.ts）。
 *
 * したがってその組み合わせは**ここへ来る前に断つ**（main/git/gitRemotes.ts）──
 * この表は渡された2つをそのまま並べるだけで、良し悪しは呼び出し側が決める
 * （`stagePaths` / `addRemote` と同じ分担）。
 *
 * ## `--end-of-options` は2つとも守る
 *
 * `git remote rename --end-of-options up2 -x` は git が**受け取ってしまう**
 * （実物で確かめた）── 追加のときと同じで、この引数は「引数として
 * 解釈されない」ことしか守らない。行き先の名前も
 * `normalizeGitRemoteName` を通してある（shared/ipc/contracts/git.ts）。
 *
 * ## 追随するものは git に任せる
 *
 * 設定・refspec・remote-tracking ref・`branch.*.remote`・`remote.pushDefault`
 * の5つを git 自身が書き換える（実物で確かめてある）── アプリが追加で
 * `git config` を動かすことは1回も無い。**追跡先を付け替える口を持たない**
 * という 3-8-5 からの線は、ここでも守られている（付け替えるのは git で、
 * こちらは rename を1回頼むだけになる）。
 */
export function renameRemote(name: string, newName: string): GitCommand {
  return { label: 'remote rename', args: ['remote', 'rename', END_OF_OPTIONS, name, newName] }
}

/* ------------------------------------------- 競合の解決（Session 3-8-18） */

/**
 * 競合マーカーが残っていないかを尋ねる（Session 3-8-18）。
 *
 * ## なぜ「押した後」ではなく「押す前」に確かめるのか
 *
 * git は**マーカーが残ったままの `git add` を通し、その後の Commit も通す**
 * （実物で確かめてある。main/git/gitConflictRepository.test.ts）── つまり
 * `<<<<<<< HEAD` の行がそのまま履歴に記録される。履歴に永久に残るものを
 * 押し間違いで作らせないため、確かめるのは動かす前になる。
 *
 * 確かめ方を git に任せているのがここの要点にあたる ── マーカーの形を
 * こちらで探すと、`<<<<<<<` で始まる行を持つ正当なファイル（差分の説明を
 * 書いた Markdown など）まで拾いうる。**何がマーカーかを決めるのは git**で、
 * こちらはその答えを読むだけになる。
 *
 * ## 終了コードだけでは足りない
 *
 * `--check` は競合マーカーと**空白の誤り**（行末の空白など）を同じ
 * 終了コード 2 で報告する（実物で確かめてある）── 終了コードだけを見ると、
 * 解決し終えたのに行末に空白があるだけのファイルが「まだ競合している」と
 * 断られることになる。したがって読むのは**出力の行**になる
 * （main/git/gitOutput.ts の `countLeftoverConflictMarkers`）。
 *
 * `-c core.whitespace=-...` で空白の検査を切る手もあり、実際そちらでも
 * 終了コードは分かれる ── だが `.gitattributes` の `whitespace=` は
 * **その `-c` より強い**（実物で確かめてある）ので、リポジトリ次第で
 * 誤検知が戻ってくる。出力を読む形なら、どちらの設定でも答えが変わらない。
 *
 * 読む文字列が英語であることは `LC_ALL=C`（main/git/gitEnvironment.ts）が
 * 担保している ── 3-8-1 から stderr の分類が英語を読んでいるのと同じ足場になる。
 *
 * ## 位置は pathspec として渡す
 *
 * `--` の後ろに置き、`LITERAL_PATHSPECS` も付ける（`stagePaths` と同じ）──
 * 確かめる相手を1件に絞るためで、絞らないと**別のファイルに残っている
 * マーカー**で押せなくなる。
 */
export function checkConflictMarkers(path: string): GitCommand {
  return { label: 'diff --check', args: [LITERAL_PATHSPECS, 'diff', '--check', '--', path] }
}

/**
 * 競合している1件を「解決済み」として記録する（Session 3-8-18）。
 *
 * ## `stagePaths` と書き分けてある
 *
 * 組み立てる引数は `git add -- <path>` で**まったく同じ**になる。それでも
 * 別の関数にしてあるのは、3-8-16 で `addOriginRemote` と `addRemote` を
 * 分けたのと同じ判断による ── **動かす git が同じでも、意味が違えば表も分ける。**
 *
 *   `stagePaths`            … 作業ツリーの姿を、次の Commit の中身へ写す
 *   `markConflictResolved`  … index の3段（base / ours / theirs）を1段に畳む
 *
 * ログに出る label が違うことにも意味がある ── 後から追うときに、
 * その `git add` が Stage だったのか解決だったのかが読み分けられる。
 *
 * ## 渡すのは常に1件
 *
 * `chunkGitPathspecs`（Stage の分割送り）が要らないのは、押した行1つしか
 * 渡ってこないため（`restoreWorktreePaths` と同じ形）。
 *
 * ## 作業ツリーには触らない
 *
 * 記録されるのは**そのとき作業ツリーに在る中身そのもの**で、利用者が
 * エディタで書いた解決内容は1文字も動かない。したがってこの操作で
 * 失われるのは index の3段だけになる。
 *
 * ## 付けていないもの
 *
 * | 付けない  | なぜ                                                                  |
 * | --------- | --------------------------------------------------------------------- |
 * | `-u` `-A` | 作業ツリー全体が対象になる。**競合していない行まで巻き込む**（3-8-3）  |
 * | `--force` | `.gitignore` を無視して足す。解決とは別の話                            |
 */
export function markConflictResolved(path: string): GitCommand {
  return { label: 'add (resolve)', args: [LITERAL_PATHSPECS, 'add', '--', path] }
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
