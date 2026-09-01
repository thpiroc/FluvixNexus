/**
 * 途中の Git 操作と、その間に通してよい操作の表（Session 3-8-22A）。
 *
 * ## なぜ shared に置くか
 *
 * 同じ答えを **Main と Renderer の両方が見る必要がある**ため。Renderer は
 * 「押せないボタンを出す / 出さない」を決めるためにこの表を読み、Main は
 * 「届いた要求を通すかどうか」を決めるために同じ表を読む。
 *
 * 2箇所に書くと、**画面では押せないのに IPC は通る**（あるいはその逆）が
 * 生まれる。Files の移動可否（shared/files/move.ts）や名前の規則
 * （shared/files/fileName.ts）を shared へ置いたのとまったく同じ理由になる。
 *
 * **正本は Main のまま。** Renderer 側の判定は「できない操作を見せない」ための
 * もので、許可の根拠ではない（Files のドラッグ&ドロップと同じ線）── だから
 * Main は届いた要求を、自分が読み直した状態に対してもう一度この表へ通す。
 *
 * ## 3-8-20 が `merging` を足したときに置かなかったもの
 *
 * 3-8-20 で `MERGE_HEAD` を読むようになったが、それを使って止めていたのは
 * **もう1度マージすること**（`toGitBranchMergeReadiness`）だけだった。
 * 切り替え・作成・退避は素通りしていて、競合が残っている間は git が断るので
 * 実害が出ていなかった。
 *
 * 実害が出るのは**その次の一瞬**にあたる ── 競合を全部解決して `git add` まで
 * 済ませ、まだ Commit していない状態では index がきれいなので、
 * `git stash push` を **git が通してしまう**（実物で確かめてある。
 * main/git/gitInProgressRepository.test.ts）。通ると `MERGE_HEAD` は黙って消え、
 * 解決に費やした作業ごとマージが無かったことになる ── しかも 3-8-20 が
 * merge commit を作った後の取り消しを持たないのと同じで、これを戻す口も無い。
 *
 * ## git が断るものも、手前で断つ
 *
 * 切り替え（`git switch`）は、解決し終えた後でも git が断る
 * （`cannot switch branch while merging`。実物で確かめてある ── 退避とは
 * 振る舞いが違う）。それでもこの表に入れてあるのは3つの理由による。
 *
 *   - **断り方が揃わない。** git の文言は状態ごとにばらばらで、
 *     `operation-in-progress` という1つの理由には集約されない
 *     （3-8-1 からの「生の stderr を Renderer へ渡さない」）
 *   - **押せてしまうボタンが残る。** 押した先で必ず失敗するボタンは、
 *     3-8-2 からの「押しても何も起きない操作を置かない」に反する
 *   - **git の版に寄りかからない。** どちらを通すかを決めているのは git で、
 *     版が変われば変わりうる ── 寄りかかると、変わった日に黙って穴が開く
 *
 * ## rebase / cherry-pick / revert は「アプリが扱えない状態」
 *
 * この3つを**始める**機能は持たない（Session 3-8-22A の範囲外。DESIGN.md）。
 * 持たないということは、**終わらせる口も無い**ということになる ── `--continue`
 * も `--abort` もアプリの中に無く、出口は Terminal だけにあたる。
 *
 * したがって、この3つの途中では**書き込みを1つも通さない。** マージのように
 * 「解決して Commit すれば終わる」道がアプリの中に無いのに、Stage や Commit
 * だけを通すと、**終わらない道の途中まで案内する**ことになる。とくに rebase
 * では HEAD が detached になっており（実物で確かめてある）、そこで Commit を
 * 通すと、どのブランチにも属さない commit が積まれたうえで rebase の状態が
 * 壊れる。
 *
 * 読み取り（状態の取得・差分・履歴・一覧）はどれも止めない ── 何が起きて
 * いるのかを確かめる手立てまで奪うことになる。
 *
 * shared 層のルールどおり、このファイルは型と純粋な関数だけを持つ。
 */

/**
 * 途中で止まっている Git 操作。
 *
 * ## 4つとも git 自身の ref から読む
 *
 * `.git` の中のファイルを直接見に行かない（main/git/gitCommands.ts の
 * `verifyMergeHead` に書いたのと同じ理由）。4つとも
 * `rev-parse --verify --quiet <REF>` の終了コードだけで読める
 * （実物で確かめてある）。
 *
 *   merge       … `MERGE_HEAD`
 *   rebase      … `REBASE_HEAD`
 *   cherry-pick … `CHERRY_PICK_HEAD`
 *   revert      … `REVERT_HEAD`
 *
 * **同時に2つ在ることは無い。** git は途中の操作があるうちに別の操作を
 * 始めさせないため、状態は高々1つになる（だから `GitRepositoryState` が
 * 持つのも配列ではなく1つ）。
 *
 * ## 「競合しているファイルがあるか」からは導けない
 *
 * 3-8-20 が `merging` について書いたことが、そのまま4つに広がる ──
 * 解決し終えた後も ref は残り（Commit / `--continue` するまで）、逆に
 * `stash pop` の競合ではどの ref も無いまま競合の行が並ぶ。
 */
export type GitInProgressOperation =
  /** `git merge` の途中（`MERGE_HEAD`）。アプリが始められ、アプリで終われる唯一のもの。 */
  | 'merge'
  /** `git rebase` の途中（`REBASE_HEAD`）。HEAD は detached になっている。 */
  | 'rebase'
  /** `git cherry-pick` の途中（`CHERRY_PICK_HEAD`）。 */
  | 'cherry-pick'
  /** `git revert` の途中（`REVERT_HEAD`）。 */
  | 'revert'

/**
 * この表が答えを持つ操作。
 *
 * **読み取りは1つも入っていない。** 状態の取得・差分・履歴・ブランチ / remote /
 * 退避の一覧は、途中の操作があっても止めない ── 何が起きているのかを
 * 確かめる手立てを奪わない。
 *
 * remote の登録簿の編集（`add-remote` / `set-remote-url` / `rename-remote` /
 * `remove-remote`）も入れていない。書き換えるのは `.git/config` の行だけで、
 * index も作業ツリーも HEAD も1つも動かない ── 途中の操作の状態に対して
 * 何も起こさない。
 *
 * `git init` も入っていない（リポジトリが無い状態にしか出ない口で、
 * 途中の操作があるということはリポジトリが在るということにあたる）。
 */
export type GitGuardedOperation =
  | 'stage'
  | 'unstage'
  | 'resolve-conflict'
  | 'discard'
  | 'commit'
  | 'commit-and-push'
  | 'push'
  | 'pull'
  | 'fetch'
  | 'switch-branch'
  | 'create-branch'
  | 'create-tracking-branch'
  | 'delete-branch'
  | 'rename-branch'
  | 'merge-branch'
  | 'stash-push'
  | 'stash-pop'
  | 'stash-drop'

/**
 * マージの途中で**通さない**操作。
 *
 * 選び方の基準は1つだけ ──「`MERGE_HEAD` を消しうるか、消えたことに
 * 気づけなくするか」になる。
 *
 *   切り替え / 作成 / 追跡ブランチの作成 … HEAD を動かす（`MERGE_HEAD` が落ちる）
 *   もう1度マージ                       … 3-8-20 から止めている
 *   退避する / 戻す                     … index と作業ツリーを丸ごと入れ替える
 *   Pull                                … `merge --ff-only` が必ず断られる
 *
 * **ここに入れていないものは、マージを終わらせるために要る。**
 * Stage / Unstage / 解決 / 破棄 / Commit / Commit & Push がそれにあたる
 * （利用者が競合を直して Commit するまでが、この状態の出口になる）。
 *
 * Push と fetch も通す ── どちらも index にも作業ツリーにも HEAD にも触らない。
 * Push はまだ merge commit が無いので送るものが増えておらず、fetch が書くのは
 * remote-tracking ref だけになる。
 *
 * ブランチの削除 / 改名も通す ── ref を1つ動かすだけで `MERGE_HEAD` には
 * 触らない。しかも `git branch -d` は未マージなら git 自身が断る（3-8-14）。
 *
 * 退避を**捨てる**（`stash-drop`）も通す。作業ツリーにも index にも触らない
 * （3-8-15）── 戻す（`pop`）だけが入れ替える側になる。
 */
const BLOCKED_WHILE_MERGING: ReadonlySet<GitGuardedOperation> = new Set([
  'switch-branch',
  'create-branch',
  'create-tracking-branch',
  'merge-branch',
  'stash-push',
  'stash-pop',
  'pull'
])

/**
 * その操作を、今の状態で通してよいか。
 *
 * `inProgress` が null（途中の操作が無い）なら、この表は何も止めない ──
 * 押せるかどうかを決めるそれ以外の条件（追跡先があるか・ステージ済みが
 * あるか・他の git が動いていないか）は、これまでどおり呼び出し側が持つ。
 *
 * @returns 通してはいけないなら true
 */
export function isGitOperationBlockedWhileInProgress(
  inProgress: GitInProgressOperation | null,
  operation: GitGuardedOperation
): boolean {
  if (inProgress === null) {
    return false
  }

  /*
    マージだけは「アプリの中に出口がある」状態にあたる（解決 → Commit）。
    通す / 通さないを表で分けるのはここだけになる。
  */
  if (inProgress === 'merge') {
    return BLOCKED_WHILE_MERGING.has(operation)
  }

  /*
    rebase / cherry-pick / revert。アプリはこの3つを始められず、
    終わらせる口も持たない ── 書き込みは1つも通さない
    （このファイルの冒頭）。
  */
  return true
}
