import type { GitFailureReason, GitOperationFailureReason } from '@shared/git'

/**
 * git の stderr を「利用者の次の一手」へ翻訳する（Electron / fs 非依存・テスト対象）。
 *
 * ## 生の stderr は Renderer へ渡らない（設計判断 3）
 *
 * git の失敗の説明は開発者向けの英文で、複数行にわたり、`hint:` の付いた
 * 助言まで混ざる。そのまま UI に出すと、利用者が読むのは
 * 「何かに失敗した英語の文章」でしかない。
 *
 * そこで**分類するのは Main**。ここへ来るのは stderr の文字列で、出ていくのは
 * 分類（shared/git/repository.ts の `GitFailureReason`）だけになる。
 * 元の文章は捨てず、Main のログへ残す（呼び出し側の責務。IpcErrorPayload の
 * `detail` と同じ分担）── 開発中に原因を追う手段まで失う理由は無い。
 *
 * ## 分ける基準は「次の一手が変わるか」
 *
 * 文言の種類を増やしても、UI に同じ案内が2つ並ぶだけになる。分けているのは、
 * 利用者が取る行動がはっきり違うものだけ。
 *
 *   dubious ownership … `safe.directory` に足す（直し方が1つに決まっている）
 *   作業ツリーが無い  … bare リポジトリ。開くフォルダを変える
 *   権限が無い        … 管理者権限・フォルダの権限を見る
 *   それ以外          … もう一度試す / ログを見る
 *
 * ## 読む相手の言語は固定してある
 *
 * ここが英文を当てにできるのは、アプリが呼ぶ git にだけ `LC_ALL=C` を渡している
 * ため（main/git/gitEnvironment.ts）。この2つは対になっていて、
 * 片方だけ変えると分類が環境ごとに割れる。
 *
 * ## 分からないものは `unknown` に倒す
 *
 * 当てにいって外すより、分からないままの方がよい。`unknown` の文言は
 * 「Git 操作に失敗しました」に留め、詳細はログにある、と伝える形にする
 * （renderer/src/git/gitRepositoryMessage.ts）。
 */

/** 分類1つ分。stderr にこの文字列が含まれていれば、その分類として扱う。 */
interface FailurePattern {
  readonly reason: GitFailureReason
  readonly needle: string
}

/**
 * 分類の表。上から順に見て、最初に当たったものを採る。
 *
 * 探すのは**文章の一部**であって全文一致ではない。git は同じ失敗でも
 * 前後に `hint:` や `fatal:` を付けたり付けなかったりするため。
 *
 * 並びの意味:
 *   dubious ownership … Windows で最も多い。別のユーザーや管理者権限で
 *                       作られたフォルダ・ネットワークドライブで出る
 *   work tree が無い  … `.git` だけのフォルダ（bare）を Workspace にした場合
 *   権限              … 「読めない」も直し方は同じなので同じ分類に寄せている
 */
const FAILURE_PATTERNS: readonly FailurePattern[] = [
  { reason: 'dubious-ownership', needle: 'dubious ownership' },
  { reason: 'dubious-ownership', needle: 'safe.directory' },
  { reason: 'no-work-tree', needle: 'must be run in a work tree' },
  { reason: 'permission-denied', needle: 'permission denied' },
  { reason: 'permission-denied', needle: 'access is denied' },
  { reason: 'permission-denied', needle: 'unable to read' }
]

/**
 * git の stderr から失敗の分類を決める。
 *
 * 当たらなければ `unknown`。**当てにいかない**のがこの関数の要点で、
 * 知らない文章を近そうな分類へ寄せると、間違った案内を出すことになる。
 */
export function classifyGitFailure(stderr: string): GitFailureReason {
  const text = stderr.toLowerCase()

  for (const pattern of FAILURE_PATTERNS) {
    if (text.includes(pattern.needle)) {
      return pattern.reason
    }
  }

  return 'unknown'
}

/**
 * 書き込み操作（Stage / Unstage）の失敗の分類（Session 3-8-3）。
 *
 * `classifyGitFailure` と**別の関数にしてある。** 分類の型が違うのは、
 * 出す場所が違うため ── あちらは Git パネル全体を案内の画面に差し替えるための
 * 分類で、こちらは一覧を出したまま、行の近くに1行だけ添えるための分類になる
 * （shared/git/operation.ts）。
 *
 * 同じ関数から両方を出そうとすると、`no-work-tree` のように
 * 「操作の失敗としては起こりえないもの」まで操作側の型に混ざる。
 *
 * ## 分けているのは、次の一手が本当に違うものだけ
 *
 *   index.lock       … アプリの外に相手が居る。相手を終えてやり直す
 *   did not match    … 対象が消えた / 既に外れていた。一覧を見直す
 *   permission       … フォルダの権限を見る（待っても直らない）
 *   それ以外         … もう一度試す / ログを見る
 *
 * `LC_ALL=C` を渡しているから英文を当てにできるのは、こちらも同じ
 * （main/git/gitEnvironment.ts）。
 */
export function classifyGitOperationFailure(stderr: string): GitOperationFailureReason {
  const text = stderr.toLowerCase()

  /*
    index.lock は「他の git が動いている」ことの現れ方が2通りある ──
    ロックを作れなかった場合と、既にあると言われる場合。文言はどちらも
    `index.lock` を含むので、そこだけを見る。
  */
  if (text.includes('index.lock')) {
    return 'index-locked'
  }

  /*
    pathspec が何にも当たらなかった。**要求が壊れているのではなく**、
    押すまでの間にファイルが消えた / 他の経路で既に Stage が外れた、という
    状態の食い違いにあたる（要求そのものの不正は IPC の INVALID_REQUEST で返る）。
  */
  if (text.includes('did not match any files') || text.includes('pathspec')) {
    return 'path-not-found'
  }

  if (text.includes('permission denied') || text.includes('access is denied')) {
    return 'permission-denied'
  }

  return 'unknown'
}

/**
 * Commit の失敗の分類（Session 3-8-4）。
 *
 * `classifyGitOperationFailure` と分けてあるのは、**同じ stderr でも読み方が
 * 違う**ため。Stage / Unstage の stderr は git 自身の文章だけだが、Commit の
 * stderr には**利用者が置いた hook の出力が混ざる** ── 任意のプログラムの
 * 任意の文章なので、そこに `permission denied` や `pathspec` という語が
 * 出てきても、それは git がそう言ったこととは違う。
 *
 * ## 「当てられないもの」を先に潰しておく
 *
 * ここへ来る前に、呼び出し側（main/git/gitCommit.ts）が次を確かめている。
 *
 *   ステージ済みが1件もあるか … `nothing-to-do`
 *   競合が残っていないか       … `unresolved-conflicts`
 *   名乗りが決まっているか     … `identity-missing`（`git var GIT_AUTHOR_IDENT`）
 *
 * どれも commit を動かす前に分かることで、動かす前に分けておけば
 * **hook の出力と混ざらない。** 残った失敗をここで読む。
 *
 * ## hook は文言ではなく、終了コードの形から見分ける
 *
 * hook が Commit を止めたとき、**git 自身は何も言わない**（実際に確かめた ──
 * 出るのは hook 自身の出力だけで、黙って落ちる hook なら stderr も空になる）。
 * つまり文言の表で当てにいく相手が居ない。
 *
 * 代わりに終わり方を見る。git が自分の理由で断るときは `fatal:` を書いて
 * **128** で終わる（`unable to auto-detect email address` も
 * `Exiting because of an unresolved conflict` もそうだった）。hook に止められた
 * ときは `fatal:` を書かずに **1** で終わる。
 *
 * 上で先に潰してあるものを除けば、この形に当てはまる失敗は hook 以外に
 * ほとんど残らない。**外れても害が小さい**方に倒してあり、文言は
 * 「hook が止めた可能性」を伝えつつ端末で確かめるよう促す形にする
 * （renderer/src/git/gitChanges.ts）。
 */
export function classifyGitCommitFailure(
  exitCode: number,
  stderr: string
): GitOperationFailureReason {
  const text = stderr.toLowerCase()

  // git 自身の理由。hook より先に見る（hook の出力に同じ語が混ざりうるため）。
  if (text.includes('index.lock')) {
    return 'index-locked'
  }

  if (COMMIT_IDENTITY_NEEDLES.some((needle) => text.includes(needle))) {
    return 'identity-missing'
  }

  if (text.includes('unmerged files') || text.includes('unresolved conflict')) {
    return 'unresolved-conflicts'
  }

  /*
    権限は git の言い方（`fatal:` 付き）に限って読む。`fatal:` の付かない
    `permission denied` は hook（の中で走った別のプログラム）が言ったもので、
    「フォルダのアクセス許可を見てください」と案内すると的を外す。
  */
  if (
    hasFatalLine(stderr) &&
    (text.includes('permission denied') || text.includes('access is denied'))
  ) {
    return 'permission-denied'
  }

  // git が自分の理由を言っていない ＝ 止めたのは hook（上記）。
  if (exitCode === 1 && !hasFatalLine(stderr)) {
    return 'hook-rejected'
  }

  return 'unknown'
}

/**
 * 名乗りが決まっていないときに git が書く文言。
 *
 * 3通りある ── 何も設定されていない（`Author identity unknown`）、
 * メールを自動検出できない、名前が空文字。**どれも次の一手は同じ**
 * （`user.name` / `user.email` を設定する）なので1つの分類に寄せている。
 */
const COMMIT_IDENTITY_NEEDLES: readonly string[] = [
  'author identity unknown',
  'unable to auto-detect email address',
  'empty ident name',
  'no email was given'
]

/**
 * git 自身が `fatal:` として断ったか。
 *
 * **行頭で見る。** hook の出力の途中に `fatal:` という語が現れることはありうるが、
 * git が書くときは必ずその行の先頭に来る。
 */
function hasFatalLine(stderr: string): boolean {
  return stderr.split('\n').some((line) => line.trimStart().toLowerCase().startsWith('fatal:'))
}

/* ------------------------------------------- Push / Pull（Session 3-8-5） */

/**
 * 相手へ届くまでの間に起きた失敗（認証 / ネットワーク / 送り先）。当たらなければ null。
 *
 * `fetch` と `push` で**同じ文言が出る**部分をここへ寄せてある ── どちらも
 * 同じ transport（https / ssh）を通り、認証も同じ helper が答える。
 * 2箇所に書くと、片方だけ知っている文言が生まれる。
 *
 * ## 順番に意味がある
 *
 * 認証を先に見る。認証の失敗は `unable to access '<URL>': The requested URL
 * returned error: 403` のように**ネットワークの言い回しに包まれて**出るため、
 * 先にネットワーク側で当たると、直す場所が違う案内（「回線を確認してください」）に
 * なってしまう。
 *
 * @param text 小文字に落とした stderr。
 */
function classifyGitTransportFailure(text: string): GitOperationFailureReason | null {
  if (AUTH_NEEDLES.some((needle) => text.includes(needle))) {
    return 'auth-required'
  }

  if (NETWORK_NEEDLES.some((needle) => text.includes(needle))) {
    return 'network-unavailable'
  }

  if (NO_REMOTE_NEEDLES.some((needle) => text.includes(needle))) {
    return 'no-remote'
  }

  return null
}

/**
 * 認証が要ると分かる文言。
 *
 * `credential.interactive=false` を渡しているため（main/git/gitCommands.ts）、
 * helper が覚えていなければ**尋ねずに即座に**ここへ落ちる。
 * `terminal prompts disabled` は `GIT_TERMINAL_PROMPT=0` が効いた形にあたる。
 *
 * `permission denied (publickey)` は ssh 側の言い方で、直し方（鍵を用意する）は
 * https の認証と同じ「Terminal で一度通す」に落ちるため同じ分類にしてある。
 * **ファイルの権限（`permission-denied`）とは別物**なので、こちらを先に見る。
 */
const AUTH_NEEDLES: readonly string[] = [
  'authentication failed',
  'could not read username',
  'could not read password',
  'terminal prompts disabled',
  'no supported authentication methods',
  'permission denied (publickey)',
  'invalid username or password',
  'returned error: 403',
  'returned error: 401'
]

/**
 * 相手へ届かなかったと分かる文言。
 *
 * `unable to access` を**最後**に置いてある ── これは「URL に届かなかった」の
 * もっとも広い言い回しで、認証の失敗もこの語に包まれて出る。認証を先に見る
 * （`classifyGitTransportFailure`）ことで、広い方が先に当たらないようにしている。
 */
const NETWORK_NEEDLES: readonly string[] = [
  'could not resolve host',
  'could not resolve hostname',
  'connection refused',
  'connection timed out',
  'connection was reset',
  'network is unreachable',
  'failed to connect',
  'operation timed out',
  'ssl certificate problem',
  'unable to access'
]

/**
 * 送り先そのものが無いと分かる文言。
 *
 * `listRemotes` で先に確かめてあるが（main/git/gitSync.ts）、remote はあっても
 * **送り先として選べない**ことがある（`origin` が無く `remote.pushDefault` も
 * 未設定）。次の一手は同じ「remote を用意する」なので1つの分類に寄せている。
 */
const NO_REMOTE_NEEDLES: readonly string[] = [
  'no configured push destination',
  'does not appear to be a git repository',
  'no such remote'
]

/**
 * Push の失敗の分類（Session 3-8-5）。
 *
 * ## 断られ方を2つに分ける
 *
 * git はどちらも `! [rejected]` / `! [remote rejected]` の形で書くが、
 * **次の一手が正反対**になる。
 *
 *   non-fast-forward … remote に手元が持っていない commit がある → **Pull すれば送れる**
 *   remote が断った   … 保護ブランチ・`pre-receive` hook          → **何度 Pull しても送れない**
 *
 * 後者を先に見る。`[remote rejected]` は「rejected」を含むため、
 * 順番を逆にすると保護ブランチの失敗が「Pull してください」と案内されることになる
 * （押しても何も変わらず、利用者は同じところを回り続ける）。
 *
 * ## remote が言ったことは、そのまま出さない
 *
 * `remote:` で始まる行はサーバーが書いた任意の文章にあたる（GitHub の
 * `GH006: Protected branch update failed` など）。生の stderr を渡さない方針は
 * 3-8-1 のままで、Renderer へ行くのは分類だけになる ── 詳細は Main のログに残る。
 */
export function classifyGitPushFailure(stderr: string): GitOperationFailureReason {
  const text = stderr.toLowerCase()

  if (REMOTE_REJECTED_NEEDLES.some((needle) => text.includes(needle))) {
    return 'remote-rejected'
  }

  if (PUSH_REJECTED_NEEDLES.some((needle) => text.includes(needle))) {
    return 'push-rejected'
  }

  const transport = classifyGitTransportFailure(text)

  if (transport !== null) {
    return transport
  }

  return 'unknown'
}

/** remote 側が受け取りを断った（保護ブランチ・サーバー側の hook）。 */
const REMOTE_REJECTED_NEEDLES: readonly string[] = [
  'remote rejected',
  'pre-receive hook declined',
  'protected branch'
]

/**
 * 手元が遅れているために断られた。
 *
 * `fetch first` と `updates were rejected` は git が同じ場面で書く2つの言い方で、
 * 版によってどちらが出るかが変わる。どちらも次の一手は Pull になる。
 */
const PUSH_REJECTED_NEEDLES: readonly string[] = [
  'non-fast-forward',
  'fetch first',
  'updates were rejected'
]

/**
 * Fetch の失敗の分類（Session 3-8-5）。
 *
 * Push と別の関数にしてあるのは、**起こりうる結末の集合が違う**ため ──
 * 取ってくるだけの操作に「断られた」は無い（相手のサーバーが受け取りを
 * 拒む場面が無い）。同じ関数から両方を出すと、fetch の失敗が
 * `push-rejected` として案内されうる。
 */
export function classifyGitFetchFailure(stderr: string): GitOperationFailureReason {
  return classifyGitTransportFailure(stderr.toLowerCase()) ?? 'unknown'
}

/**
 * `merge --ff-only` の失敗の分類（Session 3-8-5）。
 *
 * **ネットワークは通らない**（取ってくるのは終わっている）。ここで起こるのは
 * 手元の事情だけで、しかもそのほとんどは「取り込まなかった」であって
 * 「壊した」ではない ── git は上書きせずに断るため、失われたものは無い。
 *
 * | 断り方                       | 分類                    | 次の一手                     |
 * | ---------------------------- | ----------------------- | ---------------------------- |
 * | 早送りできない               | `diverged`              | 端末で merge / rebase を選ぶ |
 * | 作業ツリーの変更が邪魔       | `local-changes-blocked` | Commit するか退避する        |
 * | 競合が残っている / merge 中  | `unresolved-conflicts`  | 先に解決する                 |
 *
 * 作業ツリーの側を先に見る。両方に当てはまる状態（枝分かれしていて、かつ
 * 書きかけがある）では **git は作業ツリーの方を先に言う**ため、
 * 「まず何を片付けるか」の順番と揃う。
 */
export function classifyGitMergeFailure(stderr: string): GitOperationFailureReason {
  const text = stderr.toLowerCase()

  if (text.includes('index.lock')) {
    return 'index-locked'
  }

  if (LOCAL_CHANGES_NEEDLES.some((needle) => text.includes(needle))) {
    return 'local-changes-blocked'
  }

  if (UNRESOLVED_MERGE_NEEDLES.some((needle) => text.includes(needle))) {
    return 'unresolved-conflicts'
  }

  if (DIVERGED_NEEDLES.some((needle) => text.includes(needle))) {
    return 'diverged'
  }

  if (text.includes('permission denied') || text.includes('access is denied')) {
    return 'permission-denied'
  }

  return 'unknown'
}

/** 作業ツリー / 未追跡のファイルが上書きされるため断った。 */
const LOCAL_CHANGES_NEEDLES: readonly string[] = [
  'would be overwritten by merge',
  'local changes to the following files',
  'please commit your changes or stash them'
]

/** 前の merge が終わっていない / 競合が残っている。 */
const UNRESOLVED_MERGE_NEEDLES: readonly string[] = [
  'unmerged files',
  'you have not concluded your merge',
  'merge_head exists',
  'exiting because of unfinished merge',
  'is not possible because you have unmerged files'
]

/**
 * 早送りできない。
 *
 * `not something we can merge` は追跡先の ref が解けなかった場合に出る
 * （設定は残っているが remote 側で消された、など）── 取り込めないという
 * 結論は同じで、次の一手も「端末で確かめる」になるためここに寄せている。
 */
const DIVERGED_NEEDLES: readonly string[] = [
  'not possible to fast-forward',
  'divergent branches',
  'refusing to merge unrelated histories',
  'not something we can merge'
]

/* ------------------------------------------- ブランチ（Session 3-8-6） */

/**
 * ブランチの切り替え / 作成の失敗の分類（Session 3-8-6）。
 *
 * 切り替えと作成で1つの関数にしてあるのは、**動かしているコマンドが同じ**
 * （`git switch`）で、断り方の文言も同じ表から出てくるため。Push と Fetch を
 * 分けたのは起こりうる結末の集合が違ったからだが、こちらは片方にしか
 * 起こらない結末（`branch-exists` は作成だけ、`branch-not-found` は切り替えだけ）が
 * **文言として重ならない** ── 同じ表に置いても取り違えようが無い。
 *
 * ## 順番に意味がある
 *
 * | 見る順 | 断り方                                   | 分類                    | 次の一手                     |
 * | ------ | ---------------------------------------- | ----------------------- | ---------------------------- |
 * | 1      | `index.lock`                             | `index-locked`          | 相手を終えてやり直す         |
 * | 2      | already exists                           | `branch-exists`         | 別の名前にする               |
 * | 3      | 作業ツリーが上書きされる                 | `local-changes-blocked` | Commit するか退避する        |
 * | 4      | merge の途中 / 競合が残っている          | `unresolved-conflicts`  | 先に解決する                 |
 * | 5      | そんな ref は無い                        | `branch-not-found`      | 一覧を開き直す               |
 *
 * **3 を 5 より先に見る。** 切り替えられない理由が作業ツリーにある場合でも、
 * git は「`<name>` へ切り替えられない」という形で名前に触れて断ることがあり、
 * 順番を逆にすると「ブランチが見つからない」と案内してしまう ── 直す場所が
 * まったく違う（`remote rejected` を `rejected` より先に見ているのと同じ形）。
 *
 * `LC_ALL=C` を渡しているから英文を当てにできるのは、他の分類と同じ
 * （main/git/gitEnvironment.ts）。
 */
export function classifyGitBranchFailure(stderr: string): GitOperationFailureReason {
  const text = stderr.toLowerCase()

  if (text.includes('index.lock')) {
    return 'index-locked'
  }

  if (BRANCH_EXISTS_NEEDLES.some((needle) => text.includes(needle))) {
    return 'branch-exists'
  }

  if (
    LOCAL_CHANGES_NEEDLES.some((needle) => text.includes(needle)) ||
    SWITCH_LOCAL_CHANGES_NEEDLES.some((needle) => text.includes(needle))
  ) {
    return 'local-changes-blocked'
  }

  if (UNRESOLVED_MERGE_NEEDLES.some((needle) => text.includes(needle))) {
    return 'unresolved-conflicts'
  }

  if (BRANCH_NOT_FOUND_NEEDLES.some((needle) => text.includes(needle))) {
    return 'branch-not-found'
  }

  if (text.includes('permission denied') || text.includes('access is denied')) {
    return 'permission-denied'
  }

  return 'unknown'
}

/**
 * その名前のブランチが既にある。
 *
 * 大文字小文字だけが違う名前でもここへ来る（Windows では ref の実体が
 * 同じファイルになる）。**worktree で使われている場合の言い方
 * （`is already checked out at ...`）は入れていない** ── あれは
 * 「同じ名前がある」ではなく「そのブランチへは切り替えられない」で、
 * 次の一手が違う（worktree は §14.15 のとおり対象外なので `unknown` に落ちる）。
 */
const BRANCH_EXISTS_NEEDLES: readonly string[] = ['already exists']

/**
 * 切り替えで作業ツリーが上書きされるため断った。
 *
 * `merge --ff-only` と同じ文言（`LOCAL_CHANGES_NEEDLES`）に加えて、
 * `switch` 特有の言い方をここに置いてある ── 断り方が違うだけで、
 * 次の一手（Commit するか退避する）は同じになる。
 */
const SWITCH_LOCAL_CHANGES_NEEDLES: readonly string[] = [
  'would be overwritten by checkout',
  'would be overwritten by switch'
]

/**
 * 切り替え先が見つからなかった。
 *
 * `--no-guess` を渡してあるため、remote-tracking branch と同じ名前を渡しても
 * ここへ落ちる（手元にブランチを作る推測は止めてある。main/git/gitCommands.ts）──
 * 一覧に出していないものは切り替え先にならない、という決めごとが
 * 文言としてもここに現れる。
 */
const BRANCH_NOT_FOUND_NEEDLES: readonly string[] = [
  'invalid reference',
  'did not match any file(s) known to git',
  'unknown revision or path not in the working tree',
  'no branch named',
  'not a valid ref'
]

/**
 * 始点を渡した「作って切り替える」の失敗（Session 3-8-13）。
 *
 * ## 同じ文言でも、指しているものが違う
 *
 * `git switch <name>` が `invalid reference: x` と言うとき、見つからなかったのは
 * **切り替え先のブランチ**になる。`git switch -c <new> <start>` が同じことを
 * 言うとき、見つからなかったのは**始点の commit** で、次の一手が変わる
 * （前者は「ブランチの一覧を開き直す」、後者は「履歴を開き直す」）。
 *
 * git の側に区別が無い以上、**どちらのコマンドを動かしたかを知っている側**が
 * 分けるしかない ── Commit と Push と merge で分類の関数を分けてあるのと
 * 同じ形になる。
 *
 * ## `unable to read tree` も同じ相手を指す
 *
 * 40 桁の hash を渡したときだけ、git は `invalid reference` ではなく
 * `unable to read tree (<hash>)` と言う（確かめた）── 4〜40 桁を通す契約
 * （main/git/gitCommitHash.ts）である以上、その言い方も届きうる。
 * `classifyGitFailure` 側の `unable to read` は**権限**として読んでいるが、
 * こちらは始点が解けなかった側になる ── 表を共有しないのはそのため。
 *
 * ## 始点を渡さなかったときは、この関数を通さない
 *
 * バーの「＋」から作るときは位置引数が1つも無く、`invalid reference` が
 * 出る余地そのものが無い（main/git/gitBranches.ts）。通してしまうと、
 * 起こりえない分類が結果に混ざる形を残すことになる。
 */
export function classifyGitCreateBranchFailure(stderr: string): GitOperationFailureReason {
  const text = stderr.toLowerCase()

  if (START_POINT_NOT_FOUND_NEEDLES.some((needle) => text.includes(needle))) {
    return 'commit-not-found'
  }

  return classifyGitBranchFailure(stderr)
}

/**
 * 始点が解けなかったときの言い方。
 *
 * `BRANCH_NOT_FOUND_NEEDLES` と重なるものを**書き写してある**（そちらを
 * 参照しない）── 片方が指すのはブランチ、こちらが指すのは commit で、
 * 同じ表から読むと「ブランチ用の言い方が増えた日に、commit 側の分類まで
 * 黙って動く」ことになる。
 */
const START_POINT_NOT_FOUND_NEEDLES: readonly string[] = [
  'invalid reference',
  'unable to read tree',
  'unknown revision or path not in the working tree',
  'not a valid object name'
]

/**
 * ブランチの削除（`git branch --delete`）の失敗（Session 3-8-14）。
 *
 * ## 切り替え / 作成と表を分ける
 *
 * 動かしているコマンドが違う（`switch` ではなく `branch`）以上、返ってくる
 * 言い方も違う ── `classifyGitBranchFailure` を通すと、削除では起こりえない
 * 分類（`local-changes-blocked` など）が結果に混ざる形を残すことになる。
 * Commit / Push / fetch / merge / 始点つきの作成で表を分けてあるのと同じ形。
 *
 * ## `not fully merged` を先に見る
 *
 * ここがこの関数の要点で、**`-D` を持たないという判断が文言として現れる
 * ところ**にあたる（shared/git/operation.ts の `branch-not-merged`）。
 */
export function classifyGitDeleteBranchFailure(stderr: string): GitOperationFailureReason {
  const text = stderr.toLowerCase()

  if (text.includes('index.lock')) {
    return 'index-locked'
  }

  if (BRANCH_NOT_MERGED_NEEDLES.some((needle) => text.includes(needle))) {
    return 'branch-not-merged'
  }

  if (BRANCH_CHECKED_OUT_NEEDLES.some((needle) => text.includes(needle))) {
    return 'branch-checked-out'
  }

  if (DELETE_BRANCH_NOT_FOUND_NEEDLES.some((needle) => text.includes(needle))) {
    return 'branch-not-found'
  }

  if (text.includes('permission denied') || text.includes('access is denied')) {
    return 'permission-denied'
  }

  return 'unknown'
}

/**
 * そのブランチにしか無い commit がある。
 *
 * git は続けて `hint:` の行で `-D` を案内するが、**その案内は Renderer へ
 * 渡らない**（生の stderr は境界を越えない。§14.6）── アプリが `-D` を
 * 持たない以上、画面に出すのは「マージするか、端末で行う」になる
 * （renderer/src/git/gitChanges.ts）。
 */
const BRANCH_NOT_MERGED_NEEDLES: readonly string[] = ['not fully merged']

/**
 * 今チェックアウトされているので消せない。
 *
 * 大半は**ここへ来る前に**事前判定で分かれる（main/git/gitBranches.ts）──
 * ここへ落ちるのは別の worktree で使われている場合になる（§14.15 のとおり
 * 対象外の構成だが、**そこで断られたことは正しく伝える**）。
 *
 * git は絶対パスを添えて断る（`used by worktree at 'C:/...'`）が、
 * 渡るのは分類だけなので、その道筋が画面に出ることは無い。
 */
const BRANCH_CHECKED_OUT_NEEDLES: readonly string[] = [
  'used by worktree',
  'checked out at',
  'cannot delete branch'
]

/**
 * 消そうとしたブランチが無い。
 *
 * 一覧を開いてから ✕ を押すまでの間に、他の経路（端末・別のウィンドウ）で
 * 消えた場合にあたる。`BRANCH_NOT_FOUND_NEEDLES`（切り替え側）と
 * **書き写して分けてある** ── あちらが読むのは `switch` の言い方で、
 * こちらは `branch` の言い方になる。片方に言い方が増えた日に、
 * もう片方の分類まで黙って動く形にしない（3-8-13 と同じ判断）。
 */
const DELETE_BRANCH_NOT_FOUND_NEEDLES: readonly string[] = ['not found', 'no branch named']

/**
 * ブランチの rename（`git branch --move`）の失敗（Session 3-8-14）。
 *
 * ## 削除と表を分ける
 *
 * 同じ `git branch` だが、起こりうることが重ならない ── rename に
 * 「マージ済みか」は関係が無く、削除に「行き先の名前が既にある」は無い。
 * 1つの表にまとめると、どちらでも起こりえない分類を互いに持ち込むことになる。
 *
 * ## `already exists` が指すのは「別の既にあるブランチ」だけ
 *
 * 大文字小文字だけを変える改名でも git は同じ文言で断るが、**その1件は
 * ここへ来ない** ── 呼ぶ側が先に「完全に同じ綴りの ref があるか」を
 * 確かめ、無ければ `--force` を立てて通すため（main/git/gitBranches.ts）。
 * つまりここへ落ちる `already exists` は、必ず本物の衝突になる。
 */
export function classifyGitRenameBranchFailure(stderr: string): GitOperationFailureReason {
  const text = stderr.toLowerCase()

  if (text.includes('index.lock')) {
    return 'index-locked'
  }

  if (BRANCH_EXISTS_NEEDLES.some((needle) => text.includes(needle))) {
    return 'branch-exists'
  }

  if (RENAME_BRANCH_NOT_FOUND_NEEDLES.some((needle) => text.includes(needle))) {
    return 'branch-not-found'
  }

  if (text.includes('permission denied') || text.includes('access is denied')) {
    return 'permission-denied'
  }

  return 'unknown'
}

/**
 * 改名しようとしたブランチが無い。
 *
 * `git branch -m` の言い方は `fatal: no branch named 'x'` で、削除
 * （`error: branch 'x' not found`）とも切り替え（`invalid reference`）とも違う。
 * 3つとも表を分けてあるのは、**同じ言葉が別のものを指す余地**を
 * 作らないためになる。
 */
const RENAME_BRANCH_NOT_FOUND_NEEDLES: readonly string[] = ['no branch named', 'not found']

/* ------------------------------------------- 退避（Session 3-8-15） */

/**
 * 退避（`git stash push`）の失敗の分類（Session 3-8-15）。
 *
 * ## 表を分ける理由は 3-8-14 と同じ
 *
 * 動かしているコマンドが違う以上、返ってくる言い方も違う ── ブランチ用の表を
 * 通すと、退避では起こりえない分類（`branch-exists` など）が結果に混ざる
 * 形を残すことになる。
 *
 * ## ここへ落ちるものは、ほとんど残っていない
 *
 * 退避できない理由の大半は**動かす前に分かる**（競合が残っている・
 * 退避するものが無い・commit が1つも無い）ので、呼ぶ側が先に分けてある
 * （main/git/gitStash.ts）。それでも `no-commit` を見るのは、
 * `hasGitHeadCommit` が答えを出せなかった（null）ときにここへ来るためで、
 * pathspec に `--` と `--literal-pathspecs` を両方掛けているのと同じ
 * 二重の備えにあたる。
 */
export function classifyGitStashPushFailure(stderr: string): GitOperationFailureReason {
  const text = stderr.toLowerCase()

  if (text.includes('index.lock')) {
    return 'index-locked'
  }

  if (NO_INITIAL_COMMIT_NEEDLES.some((needle) => text.includes(needle))) {
    return 'no-commit'
  }

  if (text.includes('permission denied') || text.includes('access is denied')) {
    return 'permission-denied'
  }

  return 'unknown'
}

/**
 * まだ1つも commit が無い。
 *
 * `git stash push` の言い方は `You do not have the initial commit yet` で、
 * 公開（`publishRepository.ts`）が同じ分類を返すときとは経路が違う ──
 * 同じ結末に落ちることと、同じ表から読むことは別の話になる（3-8-14 で
 * 「見つからない」の表を3つに分けたのと同じ判断）。
 */
const NO_INITIAL_COMMIT_NEEDLES: readonly string[] = ['do not have the initial commit']

/**
 * 退避を戻す（`git stash pop`）の失敗の分類（Session 3-8-15）。
 *
 * ## 競合はここへ来ない
 *
 * pop が競合したときの知らせは **stdout に出て、stderr は空になる**
 * （実物で確かめてある。main/git/gitOutput.ts の `readStashPopConflict`）。
 * しかもそれは失敗ではなく**途中まで通った**結末にあたるため、
 * 分類ではなく `partly-applied` として組み立てる ── 呼ぶ側が
 * 「stderr の分類が当たらず、stdout が競合と言っている」ときだけ
 * そちらへ倒す（main/git/gitStash.ts）。
 *
 * ## 順番に意味がある
 *
 * | 見る順 | 断り方                                   | 分類                    | 次の一手                 |
 * | ------ | ---------------------------------------- | ----------------------- | ------------------------ |
 * | 1      | `index.lock`                             | `index-locked`          | 相手を終えてやり直す     |
 * | 2      | 作業ツリーが上書きされる                 | `local-changes-blocked` | Commit するか避けておく  |
 * | 3      | その退避が無い / 範囲外                  | `stash-not-found`       | 一覧を開き直す           |
 *
 * **2 を 3 より先に見る。** git は上書きを断るときにも退避の名前に触れる
 * ことがあり、順番を逆にすると「退避が見つからない」と案内してしまう ──
 * 直す場所がまったく違う（3-8-6 が `local-changes-blocked` を
 * `branch-not-found` より先に見ているのと同じ形）。
 */
export function classifyGitStashPopFailure(stderr: string): GitOperationFailureReason {
  const text = stderr.toLowerCase()

  if (text.includes('index.lock')) {
    return 'index-locked'
  }

  if (LOCAL_CHANGES_NEEDLES.some((needle) => text.includes(needle))) {
    return 'local-changes-blocked'
  }

  if (STASH_NOT_FOUND_NEEDLES.some((needle) => text.includes(needle))) {
    return 'stash-not-found'
  }

  if (text.includes('permission denied') || text.includes('access is denied')) {
    return 'permission-denied'
  }

  return 'unknown'
}

/**
 * 退避を捨てる（`git stash drop`）の失敗の分類（Session 3-8-15）。
 *
 * pop と表を分けてあるのは、**起こりうることが重ならない**ため ──
 * drop は作業ツリーに1文字も触らないので、`local-changes-blocked` は
 * 起こりえない（削除と rename で表を分けたのと同じ判断。§14.22）。
 *
 * 大半は**ここへ来る前に**分かれる ── 押した瞬間に位置を解いて hash と
 * 突き合わせてあり（main/git/gitStash.ts）、そこで合わなければ git は
 * 動かない。ここへ落ちるのは、その突き合わせと drop の間に消えた場合になる。
 */
export function classifyGitStashDropFailure(stderr: string): GitOperationFailureReason {
  const text = stderr.toLowerCase()

  if (text.includes('index.lock')) {
    return 'index-locked'
  }

  if (STASH_NOT_FOUND_NEEDLES.some((needle) => text.includes(needle))) {
    return 'stash-not-found'
  }

  if (text.includes('permission denied') || text.includes('access is denied')) {
    return 'permission-denied'
  }

  return 'unknown'
}

/**
 * 指した退避が、もうそこに無い。
 *
 * git の言い方は2通りあり、**どちらも実物で確かめてある。**
 *
 *   退避が1件も無い … `error: stash@{0} is not a valid reference`（終了コード 1）
 *   範囲を超えた    … `fatal: log for 'stash' only has 1 entries`（終了コード 128）
 *
 * ブランチや commit の「見つからない」の表と**書き写して分けてある** ──
 * 片方に言い方が増えた日に、もう片方の分類まで黙って動く形にしない
 * （3-8-13 / 3-8-14 と同じ判断）。
 */
const STASH_NOT_FOUND_NEEDLES: readonly string[] = [
  'is not a valid reference',
  "log for 'stash' only has",
  'no stash entries found'
]

/**
 * stderr が「ここはリポジトリではない」と言っているか。
 *
 * 失敗の分類とは別の関数にしてある ── これは失敗ではなく、
 * **`rev-parse` に対する正常な答えの1つ**だから（未初期化のフォルダを開いている、
 * という状態にあたる。shared/git/repository.ts の `not-a-repository`）。
 * 同じ表に混ぜると、状態と失敗の区別がこのファイルの中で溶ける。
 */
export function isNotARepositoryMessage(stderr: string): boolean {
  return stderr.toLowerCase().includes('not a git repository')
}

/**
 * Main のログへ残すために、stderr を1行へ畳む。
 *
 * 複数行のまま出すと、他のログの間に挟まって読みにくくなる。
 * 長さを切るのは、フックが大量に出力した場合にログを埋めないため。
 */
export function summarizeGitStderr(stderr: string): string {
  const collapsed = stderr.replace(/\s+/g, ' ').trim()

  return collapsed.length > 500 ? `${collapsed.slice(0, 500)}…` : collapsed
}
