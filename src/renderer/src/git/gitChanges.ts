import { splitRelativePath } from '@shared/files'
import {
  GIT_COMMIT_MESSAGE_MAX_LENGTH,
  findGitCommitMessageProblem,
  prepareGitCommitMessage
} from '@shared/git'
import type {
  GitChangeKind,
  GitCommitMessageProblem,
  GitDiscardTarget,
  GitFileChange,
  GitHead,
  GitOperationFailure,
  GitOperationFailureReason,
  GitPartialOperationStep,
  GitStageTarget,
  GitUpstreamStatus,
  GitWorkingTreeChanges
} from '@shared/git'
import { createTranslator, type TFunction } from '../i18n/messages'

/**
 * 変更ファイルの一覧 → 画面に並べる形（React / DOM 非依存・テスト対象・Session 3-8-2）。
 *
 * gitRepositoryMessage.ts が「使えない状態の文言」を持つのと同じ立ち位置で、
 * こちらは「使える状態の中身」を持つ。GitView.tsx に残るのは配置だけになる。
 *
 * ## ここで決めているのは3つ
 *
 *   1. どのグループを、どの順で出すか
 *   2. 1件の変更をどう読ませるか（記号・名前・どこから来たか）
 *   3. その行を押してファイルを開けるか
 *
 * 3 をここに置いてあるのが要点にあたる。**開けないものを押せるように見せない**
 * ためには「開ける条件」が1箇所に無ければならず、行を描く側の if に散らすと、
 * 削除されたファイルの行だけ押せてしまう、といった食い違いが生まれる。
 *
 * ## 並べ替えを持たない
 *
 * git が返した順（path 順）をそのまま使う。更新のたびに行が動くと、
 * 押そうとしていた行が入れ替わる ── 一覧は数秒ごとに読み直されうるため、
 * 並びが安定していることの方が、種類ごとにまとまっていることより効く。
 */

/** 変更のグループ1つ分。 */
export interface GitChangeGroup {
  readonly id: 'conflicted' | 'staged' | 'unstaged' | 'untracked'
  readonly label: string
  readonly changes: readonly GitFileChange[]
}

const DEFAULT_T = createTranslator('ja')

/**
 * 出すグループを、出す順に並べる。**空のグループは含めない。**
 *
 * 順番は「利用者が次に触るもの」から並べてある。
 *
 *   競合         … 解決しないと Commit すらできない（最優先）
 *   ステージ済み … 次の Commit に入るもの
 *   変更         … 入れるかどうかを選ぶもの
 *   未追跡       … Git がまだ知らないもの
 *
 * DESIGN.md §3 の「①変更確認 → ②コミットメッセージ → ③Commit & Push」の
 * ①にあたる部分で、上から下へ読むと Commit に近い順になる。
 */
export function toGitChangeGroups(
  changes: GitWorkingTreeChanges,
  t: TFunction = DEFAULT_T
): readonly GitChangeGroup[] {
  const groups: readonly GitChangeGroup[] = [
    { id: 'conflicted', label: t('git.changes.groups.conflicted'), changes: changes.conflicted },
    { id: 'staged', label: t('git.changes.groups.staged'), changes: changes.staged },
    { id: 'unstaged', label: t('git.changes.groups.unstaged'), changes: changes.unstaged },
    { id: 'untracked', label: t('git.changes.groups.untracked'), changes: changes.untracked }
  ]

  return groups.filter((group) => group.changes.length > 0)
}

/** 変更の総数（0 なら「変更はありません」を出す）。 */
export function countGitChanges(changes: GitWorkingTreeChanges): number {
  return (
    changes.conflicted.length +
    changes.staged.length +
    changes.unstaged.length +
    changes.untracked.length
  )
}

/**
 * 種類の見せ方。
 *
 * 記号は `git status` の短い形と同じ字を使う。**言い換えないのは、利用者が
 * 端末で見ている字と揃うため** ── 独自の記号にすると、同じリポジトリの
 * 同じ状態が2つの呼び名を持つことになる。
 *
 * `label` は記号だけに意味を預けないために要る（読み上げと hover の両方に出す）。
 */
export function describeGitChangeKind(
  kind: GitChangeKind,
  t: TFunction = DEFAULT_T
): {
  readonly symbol: string
  readonly label: string
} {
  switch (kind) {
    case 'added':
      return { symbol: 'A', label: t('git.changes.kinds.added') }

    case 'modified':
      return { symbol: 'M', label: t('git.changes.kinds.modified') }

    case 'deleted':
      return { symbol: 'D', label: t('git.changes.kinds.deleted') }

    case 'renamed':
      return { symbol: 'R', label: t('git.changes.kinds.renamed') }

    case 'copied':
      return { symbol: 'C', label: t('git.changes.kinds.copied') }

    case 'type-changed':
      return { symbol: 'T', label: t('git.changes.kinds.typeChanged') }

    case 'untracked':
      return { symbol: '?', label: t('git.changes.kinds.untracked') }

    case 'conflicted':
      return { symbol: '!', label: t('git.changes.kinds.conflicted') }
  }
}

/**
 * その行から Editor でファイルを開けるか。
 *
 * 開けないのは3つになる。
 *
 *   フォルダ            … 中身がすべて未追跡のフォルダは1件にまとまっている（shared/git/status.ts）
 *   削除                … もうそこに無い。押せるように見せても開ける先が無い
 *   両方で消えた競合    … 競合しているのに作業ツリーにファイルが無い（Session 3-8-22A）
 *
 * 3つめが 3-8-22A で足したものになる。競合の行は 3-8-2 から
 * 「フォルダでも削除でもない」ので素通りしていたが、**`both-deleted`（`DD`）
 * だけは作業ツリーにファイルが無い**（実物で確かめてある。rename / rename の
 * 競合で作れる）── 押すと Editor に「読めませんでした」のタブが増えるだけで、
 * 「押しても何も起きないボタンを置かない」という 3-8-2 からの線が、
 * この1つの形でだけ破れていた。
 *
 * 他の6つの形（`UU` / `AA` / `UD` / `DU` / `AU` / `UA`）では、
 * どちらかの側の中身が作業ツリーに在る（実物で7通りすべて確かめてある）──
 * 「片方が削除された」形でも開けるのはそのためになる。
 *
 * 何と何が食い違っているのかは、その隣の差分の口が出す（Session 3-8-21）──
 * **そちらは `both-deleted` でも開ける**（「どちらにも無い」と読めることが、
 * 押せないボタンより手掛かりになる。shared/git/conflictDiff.ts）。
 * 開く先が違うので、押せる条件も別々に決まる。
 *
 * 消えたものを**別の見せ方で救う**のは Diff Viewer（Session 3-8-3 以降）の担当で、
 * ここで中途半端に開こうとすると、Editor に「読めませんでした」のタブが増えるだけになる。
 */
export function canOpenGitChange(change: GitFileChange): boolean {
  if (change.directory || change.kind === 'deleted') {
    return false
  }

  return change.conflictShape !== 'both-deleted'
}

/**
 * 1行の見せ方（名前と、それがどこにあるか）。
 *
 * 名前を先に、場所を薄く後ろに置く形は Files の検索結果と同じにしてある ──
 * 一覧の中で目が追うのはファイル名で、フォルダは見分けが要るときだけ読む。
 *
 * rename では**元の位置**を場所の代わりに出す。移動そのものが変更の中身なので、
 * 「どこにあるか」より「どこから来たか」の方が先に知りたいことにあたる。
 */
export function describeGitChangeRow(
  change: GitFileChange,
  t: TFunction = DEFAULT_T
): {
  readonly name: string
  readonly location: string | null
} {
  const split = splitRelativePath(change.relativePath)
  // 正規化を通った相対位置なので分けられないことは無いが、分けられない形が
  // 来ても行そのものは出す（一覧から黙って1件消える方が危ない）。
  const name = split === null ? change.relativePath : split.name
  const parent = split === null ? '' : split.parent

  if (change.originalPath !== null) {
    return { name, location: t('git.changes.row.from', { path: change.originalPath }) }
  }

  return { name, location: parent === '' ? null : parent }
}

/* ------------------------------------------------- 行の操作（Session 3-8-3） */

/**
 * その行に置く操作。
 *
 * グループから決まり、行の種類からは決めない ── **同じ `modified` でも、
 * staged なら外す側、unstaged なら載せる側**になる。行の `kind` から決めようとすると、
 * 「どちらのグループに居るか」をもう一度どこかで見ることになる。
 *
 * 競合の行には、Session 3-8-18 で**3つめの操作**が付いた（`resolve`）。
 * Stage / Unstage ではないのは、動かす git が同じ `git add` でも
 * **意味が違う**ため ── あちらは作業ツリーの姿を次の Commit の中身へ写す
 * 操作で、こちらは index の3段（base / ours / theirs）を1段に畳む操作になる
 * （main/git/gitConflict.ts）。同じ名前で出すと、押した後に何が起きたのかを
 * 説明できない。
 *
 * 3-8-17 まで競合の行に操作が無かったのは「解決するまで Stage も Unstage も
 * 意味を持たない」ためで、その判断は動いていない ── **足したのは
 * 「解決し終えた」と伝える operation で、Stage ではない。**
 */
export type GitRowAction = 'stage' | 'unstage' | 'resolve' | null

export function toGitRowAction(groupId: GitChangeGroup['id']): GitRowAction {
  switch (groupId) {
    case 'staged':
      return 'unstage'

    case 'unstaged':
    case 'untracked':
      return 'stage'

    case 'conflicted':
      return 'resolve'
  }
}

/**
 * その操作を押したときに何が起きるかの一言（Session 3-8-18）。
 *
 * 3-8-3 から GitView.tsx の中に直に書いてあったものを、`resolve` が
 * 増えたところでこちらへ移した ── 3つに増えると、**それぞれが違う言葉で
 * なければならない**ことが文言そのものの決めごとになるためで、
 * React 非依存の側で固定できる形にしておく。
 *
 * ## 「Stage」と言わない
 *
 * 解決の行だけは、動く git が同じでも別の言葉にする ── index の3段を
 * 1段に畳む操作を「Stage」と名乗ると、押した人は
 * **後で Unstage で戻せる**と読む。戻せない（`git reset` は競合を復元しない。
 * main/git/gitConflict.ts）。
 *
 * 読み上げのために位置を含めるのは 3-8-3 のまま ── 「Stage」だけだと、
 * 同じ名前のボタンが一覧の数だけ並ぶ。
 */
export function describeGitRowAction(
  action: Exclude<GitRowAction, null>,
  change: GitFileChange,
  t: TFunction = DEFAULT_T
): string {
  switch (action) {
    case 'stage':
      return t('git.changes.row.stage', { path: change.relativePath })

    case 'unstage':
      return t('git.changes.row.unstage', { path: change.relativePath })

    case 'resolve':
      return t('git.changes.row.resolve', { path: change.relativePath })
  }
}

/**
 * そのグループに「すべて Stage」を置けるか。
 *
 * 置くのは変更と未追跡の2つだけ。ステージ済みに対の操作（すべて Unstage）を
 * 置いていないのは、それが**次の Commit の中身を丸ごと空にする**操作で、
 * 押し間違いの代償が釣り合わないため（shared/git/operation.ts）。
 */
export function toGitGroupStageTarget(groupId: GitChangeGroup['id']): GitStageTarget | null {
  if (groupId === 'unstaged' || groupId === 'untracked') {
    return { kind: groupId }
  }

  return null
}

/**
 * 動いている操作を見分けるための目印。
 *
 * 同じファイルに対する Stage と Unstage を**別の目印にしない**（`relativePath` だけで
 * 引く）。同じファイルが staged と unstaged の両方に並ぶことはあるが、
 * その2つを同時に動かすと、後から届いた方が前の結果を上書きする ──
 * 利用者から見て、押した2つのうちどちらが効いたのか分からなくなる。
 *
 * グループの「すべて」は別枠にする。押している間もその中の1件は押せてよい
 * （どちらも Main 側で順番に走る。main/git/gitQueue.ts）。
 */
export function toGitOperationKey(
  target:
    | GitStageTarget
    | { readonly kind: 'unstage'; readonly relativePath: string }
    | { readonly kind: 'discard'; readonly relativePath: string }
    | { readonly kind: 'resolve'; readonly relativePath: string }
): string {
  switch (target.kind) {
    /*
      破棄を Stage / Unstage と**同じ鍵**にしてある（Session 3-8-9）。

      どれもその1行を相手にする操作で、同時に走ってよいものが1つも無い ──
      鍵を分けると「破棄している最中に、その同じ行を Stage できる」形になり、
      走っている git 2本がどちらの順で当たるかで結果が変わる。
      `operate` は同じ鍵の要求を弾く（useGitRepository.ts）。

      競合の解決（Session 3-8-18）も同じ鍵に入れる ── 押した瞬間に
      その行は競合のグループから消えてステージ済みへ移るので、
      **同じ位置に対する2回目**が飛ぶ余地を残さない。
    */
    case 'file':
    case 'unstage':
    case 'discard':
    case 'resolve':
      return `path:${target.relativePath}`

    case 'unstaged':
    case 'untracked':
      return `group:${target.kind}`
  }
}

/* --------------------------------------------------- 行の破棄（Session 3-8-9） */

/**
 * その行を破棄できるか。
 *
 * 出すのは「変更」と「未追跡のファイル」の2つだけになる。
 *
 *   ステージ済み … 出さない。**先に Unstage** してもらう ── 1回で
 *                  index と作業ツリーの両方が戻ると、押した人から見て
 *                  失われるものが1度に2段になる（shared/git/operation.ts）
 *   競合         … 出さない。何に戻すのかが ours / theirs / merge base の
 *                  3つに分かれる。解決の UI と一緒に設計する
 *   未追跡のフォルダ … 出さない。1行に見えて中身は数万件になりうる
 *
 * `canDiffGitChange`（gitDiff.ts）が削除された行にも `true` を返すのと違い、
 * こちらはグループで先に絞る ── 見るのは安全だが、消すのはそうではない。
 */
export function canDiscardGitChange(groupId: GitChangeGroup['id'], change: GitFileChange): boolean {
  if (groupId !== 'unstaged' && groupId !== 'untracked') {
    return false
  }

  return !change.directory
}

/** グループの id を、破棄のチャンネルに渡せるグループへ。それ以外は null。 */
export function toGitDiscardGroup(groupId: GitChangeGroup['id']): GitDiscardTarget['group'] | null {
  return groupId === 'unstaged' || groupId === 'untracked' ? groupId : null
}

/**
 * 破棄で何が起きるかを、押す前に言う。
 *
 * **グループごとに、失われ方がまるごと違う**（ARCHITECTURE.md §14.16）。
 * 同じ文言で済ませると、片方に嘘をつくことになる ── 未追跡は
 * ごみ箱から戻せるのに「元に戻せません」と出すのは、要らない怖さを作る。
 * 逆に変更の側で「戻せます」と出すのは、取り返しのつかない誤りにあたる。
 */
export interface GitDiscardWarning {
  /** 何が起きるか（1文目）。 */
  readonly message: string
  /** 戻せるかどうか（2文目）。 */
  readonly note: string
  /** 押すボタンの文字。 */
  readonly confirmLabel: string
}

export function describeGitDiscardWarning(
  group: GitDiscardTarget['group'],
  change: GitFileChange,
  t: TFunction = DEFAULT_T
): GitDiscardWarning {
  const { name } = describeGitChangeRow(change, t)

  if (group === 'untracked') {
    return {
      message: t('git.changes.discard.untrackedMessage', { name }),
      // Files パネルの削除とまったく同じ結末なので、同じことを同じ言い方で言う。
      note: t('git.changes.discard.untrackedNote'),
      confirmLabel: t('git.common.moveToTrash')
    }
  }

  return {
    message:
      change.kind === 'deleted'
        ? t('git.changes.discard.deletedMessage', { name })
        : t('git.changes.discard.modifiedMessage', { name }),
    note: t('git.changes.discard.modifiedNote'),
    confirmLabel: t('git.common.discard')
  }
}

/**
 * 未保存の Editor タブがあるファイルは破棄させない。
 *
 * ## なぜ Renderer で止めるのか
 *
 * Main は「どのファイルが開かれているか」を持たない ── タブを知っているのは
 * Renderer だけで、その一覧を IPC で Main へ配ると、**Git の操作のためだけに
 * Editor の状態を Main が持つ**ことになる（main/git/gitDiscard.ts）。
 * 押せる場所の側で止める方が層が増えない。
 *
 * ## なぜ「保存してから破棄」にしないのか
 *
 * 保存してから破棄すると、**書きかけをディスクへ書いてから消す**ことになり、
 * 何も救われない。逆に黙って破棄すると、Editor 側は未保存のまま残り、
 * 次に保存した瞬間に破棄したはずの中身が書き戻る ── どちらも
 * 「押したのと違うことが起きる」にあたる。
 *
 * 止めたうえで次の一手（保存する / タブを閉じる）を出す。
 */
export function findGitDiscardBlocker(
  relativePath: string,
  unsavedPaths: ReadonlySet<string>,
  t: TFunction = DEFAULT_T
): string | null {
  if (!unsavedPaths.has(relativePath)) {
    return null
  }

  return t('git.changes.discard.blocked')
}

/**
 * 操作が通らなかったときの1行。
 *
 * gitRepositoryMessage.ts が「パネル全体を差し替える案内」を持つのに対し、
 * こちらは**一覧を出したまま、その上に1行だけ**添えるためのものになる。
 * 一覧が残っているので、状態そのものは利用者が目で確かめられる ──
 * ここに書くのは「なぜ通らなかったか」と「次に何をすればよいか」だけでよい。
 *
 * ## 分類ではなく結末を受け取る（Session 3-8-5）
 *
 * `reason` だけでは足りなくなった。Commit & Push が途中で止まった場合
 * （`partly-applied`）、**先に伝えるべきなのは「Commit は済んでいる」**に
 * なるためで、同じ `auth-required` でも言うことが違う ── そこを取り違えると、
 * 利用者は同じ内容をもう一度 Commit することになる。
 *
 * ## 済んでいるものは、結末が自分で名乗る（Session 3-8-10）
 *
 * 途中まで通る操作が2つになった（Commit & Push と、GitHub への公開）。
 * 前半の1文を決め打ちにしたままだと、**公開の失敗が「Commit は完了しました」と
 * 名乗る**ことになる ── どこまで済んでいるかは `completed` として
 * 結末に載っている（shared/git/operation.ts）。
 */
export function describeGitOperationFailure(
  failure: GitOperationFailure,
  t: TFunction = DEFAULT_T
): string {
  const reason = describeGitOperationFailureReason(failure.reason, t)

  if (failure.status === 'partly-applied') {
    return `${describeGitPartialStep(failure.completed, t)}${reason}`
  }

  return reason
}

/**
 * どこまで済んでいるかの一言（`partly-applied` の前半・Session 3-8-10）。
 *
 * **「済んでいること」を先に言う。** 後半に来る理由（認証・ネットワーク）は
 * どちらの操作でも同じ文になるため、前半が違わないと
 * 「もう一度最初から押す」を招く ── Commit なら同じ commit が2つ積まれ、
 * 公開なら同じ名前で作ろうとして断られる。
 */
function describeGitPartialStep(step: GitPartialOperationStep, t: TFunction): string {
  switch (step) {
    case 'commit':
      return t('git.operationFailure.partial.commit')

    /*
      remote の設定まで済んでいるとは限らない（`no-remote` が理由として
      来るのがその場合にあたる）ため、ここでは**作られたことだけ**を言う。
      続きに何をすればよいかは、後半の理由が言う。
    */
    case 'github-repository':
      return t('git.operationFailure.partial.githubRepository')

    /*
      退避を戻したら競合した（Session 3-8-15）。

      **退避が残っていることを先に言う。** ここを言わないと、利用者は
      「戻せなかった」と読んで押し直す ── 中身は既に作業ツリーへ
      書き込まれているので、2回目は「上書きされる」として断られるだけになる
      （shared/git/operation.ts の `stash-apply`）。
    */
    case 'stash-apply':
      return t('git.operationFailure.partial.stashApply')

    /*
      マージは始まった（Session 3-8-20）。

      **「失敗しました」と読ませない。** ここを言わないと、利用者は
      もう一度マージを押す ── だが MERGE_HEAD は既に在るので、git は
      「未解決のファイルがあります」としか言わず、先へ進む手立てが
      画面のどこにも見えなくなる（shared/git/operation.ts の `merge`）。

      自動でマージできた分が既に入っていることを先に言い、
      残りをどうするかは後半の理由（`merge-conflict`）が言う。
    */
    case 'merge':
      return t('git.operationFailure.partial.merge')
  }
}

/** 分類ごとの一言（`partly-applied` でも同じものを後半に使う）。 */
function describeGitOperationFailureReason(
  reason: GitOperationFailureReason,
  t: TFunction
): string {
  switch (reason) {
    case 'not-ready':
      return t('git.operationFailure.reasons.notReady')

    case 'nothing-to-do':
      return t('git.operationFailure.reasons.nothingToDo')

    case 'identity-missing':
      return t('git.operationFailure.reasons.identityMissing')

    case 'hook-rejected':
      return t('git.operationFailure.reasons.hookRejected')

    /*
      Session 3-8-18 で、この文の**行き先がアプリの中に出来た。**

      3-8-4 から出ていた文だが、それまで「解決する」手立てはアプリの中に
      無かった（競合の行に操作が1つも無かった）── 3-8-18 で競合の行に
      「解決済みにする」が付いたので、次の一手をその場所として書ける。
    */
    case 'unresolved-conflicts':
      return t('git.operationFailure.reasons.unresolvedConflicts')

    /*
      途中の Git 操作があるあいだは通さない操作だった（Session 3-8-22A）。

      画面の側でも押せないようにしてあるので（`withGitInProgressBlock`）、
      ここへ来るのは**押した瞬間に状態が変わっていた**場合になる ──
      端末でマージが始まった直後・rebase が始まった直後がそれにあたる。

      次の一手は帯（`describeGitInProgressNotice`）が出しているので、
      ここでは**そちらを見てもらう**ところまでを言う ── 同じ手順を2箇所に
      書くと、片方だけ直された日に食い違う。
    */
    case 'operation-in-progress':
      return t('git.operationFailure.reasons.operationInProgress')

    /*
      「解決済みにする」を押したが、マーカーが残っていた（Session 3-8-18）。

      `unresolved-conflicts` と**別の文にしてある** ── あちらの次の一手は
      「この操作を押すこと」で、こちらの次の一手は「エディタでマーカーを
      消すこと」になる。同じ言葉に潰すと、押した人はどちらを直せばよいか
      分からないまま同じボタンを押し直す。

      git はマーカーが残ったままでも通してしまう（そして履歴に残る）ので、
      **断っているのはアプリ**だと分かるように書く。
    */
    case 'conflict-markers-present':
      return t('git.operationFailure.reasons.conflictMarkersPresent')

    case 'path-not-found':
      return t('git.operationFailure.reasons.pathNotFound')

    case 'not-on-branch':
      return t('git.operationFailure.reasons.notOnBranch')

    /*
      Session 3-8-16 で、次の一手が**アプリの中だけで揃った。**

      3-8-10 の時点では2つ書いていた ── 「GitHub に公開」と、端末での
      `git remote add`。前者は**新しく作る**側の入口で、既にどこかに在る
      repository へ繋ぎたい人は、そこでアプリの外へ出るしかなかった。

      3-8-16 で上のバーに「リモート」が付き、その道もパネルの中に在る。
      **端末への案内はここから落とす** ── 出せる行き先が2つになった以上、
      3つ並べると「どれを押せばよいか」を先に判断させることになる
      （§14.24）。落とした後も端末で打てなくなるわけではない。

      並びは「繋ぐ → 作る」にしてある。この文が出るのは Push / Pull を
      押した後で、**送り先があるつもりだった人**が読む ── その人にとって
      近いのは、既に在るものへ繋ぐ側になる。
    */
    case 'no-remote':
      return t('git.operationFailure.reasons.noRemote')

    /*
      Session 3-8-15 で、この分類を返す操作が2つになった（公開と、退避）。

      3-8-10 では公開しか返さなかったため「先に Commit してから**公開して**
      ください」と書けたが、退避も最初の commit の上にしか積めない
      （main/git/gitStash.ts）── どちらでも次の一手は同じ「先に Commit する」
      なので、そこだけを言う形へ直してある。`branch-not-found` を3つの操作に
      当たる文へ直した（3-8-14）のと同じ判断になる。
    */
    case 'no-commit':
      return t('git.operationFailure.reasons.noCommit')

    case 'github-cli-missing':
      return t('git.operationFailure.reasons.githubCliMissing')

    case 'github-signed-out':
      return t('git.operationFailure.reasons.githubSignedOut')

    case 'github-repository-exists':
      return t('git.operationFailure.reasons.githubRepositoryExists')

    case 'no-upstream':
      return t('git.operationFailure.reasons.noUpstream')

    case 'auth-required':
      return t('git.operationFailure.reasons.authRequired')

    case 'network-unavailable':
      return t('git.operationFailure.reasons.networkUnavailable')

    /*
      「Push できませんでした」と書かないのは、`partly-applied` の前半
      （「Commit は完了しましたが、Push できませんでした。」）と重なるため。
      理由の文は**理由だけ**を言い、結末は前半が言う。
    */
    case 'push-rejected':
      return t('git.operationFailure.reasons.pushRejected')

    case 'remote-rejected':
      return t('git.operationFailure.reasons.remoteRejected')

    /*
      早送りできなかった（Session 3-8-5 の Pull / Session 3-8-20 のマージ）。

      3-8-19 まで「手元と remote が枝分かれしているため」と書いていた ──
      Pull からしか出ない分類だったのでそれで通っていたが、3-8-20 で
      **相手が remote とは限らなくなった**（一覧から選んだローカルブランチ）。
      そのままだと、ブランチのマージで断られた人に
      「remote と枝分かれしています」という**関係の無い相手の話**が出る。

      どちらから来ても通る形にするために、相手を名指しせず
      「枝分かれしている」とだけ言う ── 次の一手（端末で内容を確かめる）は
      2つとも同じなので、そこは分けなくてよい（`branch-not-found` を
      3-8-14 で3つの操作に当たる形へ直したのと同じ判断）。
    */
    case 'diverged':
      return t('git.operationFailure.reasons.diverged')

    /*
      共通の祖先が無い（Session 3-8-20）。

      `diverged` と**同じ文にしない** ── あちらは「どう統合するかを決める」
      だが、こちらの大半は「そもそも相手を間違えている」にあたる。
      `--allow-unrelated-histories` は案内しない（アプリはその欄を持たず、
      持っていないものを勧めると探させることになる ── `branch -D` と同じ形）。
    */
    case 'unrelated-histories':
      return t('git.operationFailure.reasons.unrelatedHistories')

    /*
      競合した（Session 3-8-20）。**必ず `partly-applied` の後半に出る。**

      前半（`describeGitPartialStep('merge')`）が「マージは始まった」と
      言っているので、ここが言うのは**残りをどうするか**だけになる ──
      その行き先（競合のグループと「解決済みにする」）は、この文が出ている
      すぐ下に開いている（Session 3-8-18）。
    */
    case 'merge-conflict':
      return t('git.operationFailure.reasons.mergeConflict')

    case 'local-changes-blocked':
      return t('git.operationFailure.reasons.localChangesBlocked')

    case 'branch-exists':
      return t('git.operationFailure.reasons.branchExists')

    /*
      削除できなかった（Session 3-8-14）。

      **`-D` を案内しない。** アプリはその欄を持たず（shared/git/operation.ts）、
      持っていないものを勧めると「どこにあるのか」を探させることになる ──
      hook に断られたときと同じ形で、行き先は Terminal パネルになる。
    */
    case 'branch-not-merged':
      return t('git.operationFailure.reasons.branchNotMerged')

    case 'branch-checked-out':
      return t('git.operationFailure.reasons.branchCheckedOut')

    /*
      Session 3-8-14 で、この分類を返す操作が3つになった（切り替え・削除・rename）。
      「切り替え先の」と書いていた文をここで**その3つに当たる形へ直してある** ──
      次の一手はどれも同じ「一覧を開き直す」で、そこは分けなくてよい。

      分類そのものは Main 側で3つの表に分けたまま（gitFailure.ts）。同じ結末に
      なることと、同じ言い方から読み取ることは別の話にあたる。
    */
    case 'branch-not-found':
      return t('git.operationFailure.reasons.branchNotFound')

    /*
      始点にした commit が解けなかった（Session 3-8-13）。

      「ブランチが見つかりません」と**同じ文にしない** ── 探しに行った相手が
      違い、開き直す先も違う（あちらはブランチの一覧、こちらは履歴）。
    */
    case 'commit-not-found':
      return t('git.operationFailure.reasons.commitNotFound')

    /*
      指した退避がそこに無かった（Session 3-8-15）。

      「見つかりません」だけにしないのは、**ほとんどの場合そこに何かは在る**
      ためになる ── 退避を1つ増やせば番号が1つずつずれ、押した位置には
      別の退避が居る（shared/git/stash.ts）。Main はそれを hash で見分けて
      git を動かさずに断っており、そのことが伝わる文にしてある。
    */
    case 'stash-not-found':
      return t('git.operationFailure.reasons.stashNotFound')

    /*
      同じ名前の remote が既にある（Session 3-8-16）。

      `branch-exists` と**同じ言い回しで揃えてある** ── どちらも
      「名前が埋まっている」で、次の一手も同じ「別の名前を打つ」になる。
      **URL を変える案内はしない** ── アプリはその口を持たない
      （docs/ARCHITECTURE.md §14.24）。持っていないものを勧めると、
      「どこにあるのか」を探させることになる（`-D` を案内しないのと同じ判断）。
    */
    case 'remote-exists':
      return t('git.operationFailure.reasons.remoteExists')

    /*
      消そうとした remote が無い（Session 3-8-16）。

      `stash-not-found` と違って「ずれた」は含まない ── remote は位置では
      なく名前で指すため、在れば必ず同じものになる（shared/git/operation.ts）。
      したがって文も「見つかりません」だけで足りる。
    */
    case 'remote-not-found':
      return t('git.operationFailure.reasons.remoteNotFound')

    case 'unsupported-target':
      return t('git.operationFailure.reasons.unsupportedTarget')

    case 'target-busy':
      return t('git.operationFailure.reasons.targetBusy')

    case 'index-locked':
      return t('git.operationFailure.reasons.indexLocked')

    case 'permission-denied':
      return t('git.operationFailure.reasons.permissionDenied')

    case 'timeout':
      return t('git.operationFailure.reasons.timeout')

    case 'unknown':
      return t('git.operationFailure.reasons.unknown')
  }
}

/* --------------------------------------------------- Commit（Session 3-8-4） */

/**
 * Commit の目印（`toGitOperationKey` が作るものと同じ枠に入る）。
 *
 * 関数ではなく定数なのは、**対象が無い**ため ── Commit する中身は index が
 * 持っていて、Renderer が指せるものが1つも無い（shared/ipc/contracts/git.ts）。
 * `path:` / `group:` と衝突しない綴りにしてある。
 */
export const GIT_COMMIT_OPERATION_KEY = 'commit'

/**
 * Commit ボタンの状態と、その理由。
 *
 * **押せる / 押せないを1箇所で決める。** 条件が3つ（ステージ済み・メッセージ・
 * 他の Git 操作）あるため、`disabled` の式を JSX に直接書くと、そこに理由を
 * 添えるすべが無くなる ── 押せないボタンだけが並び、なぜ押せないのかは
 * どこにも出ない状態になる。
 */
export interface GitCommitReadiness {
  /** 押せるか。 */
  readonly enabled: boolean
  /**
   * 入力欄の下に添える一言。無ければ null。
   *
   * **空のメッセージには何も出さない。** 何も書いていない欄の下に
   * 「入力してください」と出しても、増えるのは文字だけになる。
   * 出すのは「書いたのに押せない」場合だけにしてある。
   */
  readonly note: string | null
  /**
   * 上限まであと何文字か。まだ遠ければ null（数字を出さない）。
   *
   * 常に出していると、要約1行を書くだけの場面でも数字が目に入る。
   * **出ていること自体が「上限が近い」の合図**になるようにしてある。
   *
   * 数えるのは前後の空白を落とした後の長さ ── 記録されるのはその形なので
   * （shared/git/commitMessage.ts）、末尾の改行で数字が減ると嘘になる。
   */
  readonly remaining: number | null
}

/**
 * 残り文字数を出し始める境目。
 *
 * 上限の1割にしてある ── これより手前で出しても、書いている人にとっては
 * まだ関係の無い数字が増えるだけになる。
 */
const COMMIT_MESSAGE_COUNTER_THRESHOLD = GIT_COMMIT_MESSAGE_MAX_LENGTH / 10

/**
 * Commit メッセージが受け付けられない理由の文言。
 *
 * 規則そのものは shared（shared/git/commitMessage.ts）で、文言はこちら ──
 * files ドメイン（filesError.ts）と同じ分担にしてある。
 */
export function describeGitCommitMessageProblem(
  problem: GitCommitMessageProblem,
  t: TFunction = DEFAULT_T
): string {
  switch (problem) {
    case 'empty':
      return t('git.commit.problem.empty')

    case 'too-long':
      return t('git.commit.problem.tooLong', {
        max: GIT_COMMIT_MESSAGE_MAX_LENGTH.toLocaleString()
      })

    case 'invalid-characters':
      return t('git.commit.problem.invalidCharacters')
  }
}

/**
 * 今 Commit できるか。
 *
 * 3つの条件はどれも**押した後に分かることではない。**
 *
 *   ステージ済みが無い … Commit する中身が無い（空の Commit は作らない）
 *   メッセージが通らない … shared の規則（Main も同じ関数で確かめる）
 *   他の Git 操作が動いている … その操作が「ステージ済み」を変えている最中
 *
 * 3つめだけは他のボタンと扱いが違う。行の `＋` / `−` は**押した対象だけ**を
 * 止めるが（useGitRepository.ts）、Commit の中身はステージ済みの**全体**で、
 * 走っている Stage / Unstage はまさにその全体を書き換えている ──
 * 「画面に出ている一覧を Commit した」と言えなくなる。
 *
 * **競合が残っているかは見ない。** 競合の間 git は commit を作らないが、
 * その判断は git の側にあり、こちらで先回りして真似ると2箇所に規則が生まれる。
 * 押した結果は `unresolved-conflicts` として一覧の上に出る（Main が返す分類）。
 */
export function toGitCommitReadiness(
  message: string,
  stagedCount: number,
  operating: boolean,
  t: TFunction = DEFAULT_T
): GitCommitReadiness {
  const prepared = prepareGitCommitMessage(message)
  const left = GIT_COMMIT_MESSAGE_MAX_LENGTH - prepared.length
  const remaining = left <= COMMIT_MESSAGE_COUNTER_THRESHOLD ? left : null

  if (stagedCount === 0) {
    return { enabled: false, note: t('git.commit.readiness.stageFirst'), remaining }
  }

  const problem = findGitCommitMessageProblem(prepared)

  if (problem !== null) {
    return {
      enabled: false,
      // 空欄は「まだ書いていない」であって、直すべき間違いではない。
      note: problem === 'empty' ? null : describeGitCommitMessageProblem(problem, t),
      remaining
    }
  }

  return { enabled: !operating, note: null, remaining }
}

/* --------------------------------------- Push / Pull（Session 3-8-5） */

/**
 * Push / Pull / Commit & Push の目印。
 *
 * `toGitOperationKey` が作る `path:` / `group:` とも、Commit の `commit` とも
 * 衝突しない綴りにしてある。3つとも「対象を指せない」操作なので、
 * Commit と同じく関数ではなく定数になる。
 */
/**
 * 初期化の目印（Session 3-8-10）。
 *
 * `git init` も対象を指せない操作なので、Commit / Push と同じく定数になる。
 * **押せる場所が1つしか無い**（まだリポジトリではないときの案内の中）ため、
 * ここが押されている間に他の Git 操作が並ぶことはそもそも無い ── それでも
 * 目印を持つのは、同じ経路（`operate`）に載せて二重の要求を止めるためになる
 * （useGitRepository.ts）。
 */
export const GIT_INIT_OPERATION_KEY = 'init'

export const GIT_PUSH_OPERATION_KEY = 'push'
export const GIT_PULL_OPERATION_KEY = 'pull'
export const GIT_FETCH_OPERATION_KEY = 'fetch'
export const GIT_COMMIT_AND_PUSH_OPERATION_KEY = 'commit-and-push'

/**
 * ボタン1つ分の状態と、その理由（Session 3-8-5）。
 *
 * `GitCommitReadiness` と同じ考え方で、**押せる / 押せないを決める場所に
 * 理由も一緒に持たせる。** ただし出し方が違う ── Commit の一言は入力欄の
 * 下に出るが、Push / Pull は横に並ぶ小さなボタンで、そこに文章を置く場所が無い。
 * したがって `note` は **hover と読み上げに渡すもの**になる（GitView.tsx）。
 *
 * 押せるときも `note` を持つのは、`title` を空にしないため ── 記号ではなく
 * 言葉のボタンだが、「何が起きるか」は押す前に読めた方がよい。
 */
export interface GitActionReadiness {
  readonly enabled: boolean
  /** hover / 読み上げに出す一言（押せる理由・押せない理由）。 */
  readonly note: string
}

/**
 * Push が押せるか。
 *
 * ## 条件を Main と二重に持たない
 *
 * ここで見るのは**画面に出ているものだけ**（ブランチか / 追跡先との差 / 他の操作）で、
 * remote があるか・commit が1つでもあるかは見ない ── それは押した後に
 * Main が答えることで（main/git/gitSync.ts）、こちらで先回りして真似ると
 * 2箇所に規則が生まれる。Commit で「競合が残っているかは見ない」としたのと同じ判断。
 *
 * ## 追跡先が無いときは押せる
 *
 * それが**初回の Push**（`--set-upstream`）にあたる。「まだ送ったことが無いから
 * 押せない」は、いちばん押したい場面で押せない形になる。
 *
 * ## 差が 0 のときだけ止める
 *
 * `ahead === 0` は「送るものが無い」と分かっている状態で、押しても
 * `nothing-to-do` が返るだけになる。`ahead === null`（差が分からない）では
 * 止めない ── 分からないことを「無い」として扱わない（shared/git/status.ts）。
 */
export function toGitPushReadiness(
  head: GitHead,
  upstream: GitUpstreamStatus | null,
  operating: boolean,
  t: TFunction = DEFAULT_T
): GitActionReadiness {
  if (head.kind !== 'branch') {
    return { enabled: false, note: t('git.sync.pushNotOnBranch') }
  }

  if (upstream === null) {
    return { enabled: !operating, note: t('git.sync.pushCreateUpstream') }
  }

  if (upstream.ahead === 0) {
    return { enabled: false, note: t('git.sync.pushNothing', { upstream: upstream.name }) }
  }

  const count = upstream.ahead === null ? '' : `${upstream.ahead.toLocaleString()} `

  return {
    enabled: !operating,
    note: t('git.sync.pushCommits', { count, upstream: upstream.name })
  }
}

/**
 * Pull が押せるか。
 *
 * **`behind` の値では止めない。** それは前回 fetch した時点の写しでしかなく、
 * 「0 だから押させない」は**新しい変更を取りに行く手段そのもの**を塞ぐことになる
 * （Pull の半分は fetch で、それは押してみないと分からない）。
 *
 * 追跡先が無ければ押せない ── どこから受け取るかが決まっていない
 * （Push と対称でないのはそのため。あちらは追跡先を作る側にあたる）。
 */
export function toGitPullReadiness(
  head: GitHead,
  upstream: GitUpstreamStatus | null,
  operating: boolean,
  t: TFunction = DEFAULT_T
): GitActionReadiness {
  if (head.kind !== 'branch') {
    return { enabled: false, note: t('git.sync.pullNotOnBranch') }
  }

  if (upstream === null) {
    return { enabled: false, note: t('git.sync.pullNoUpstream') }
  }

  const count =
    upstream.behind === null || upstream.behind === 0
      ? ''
      : t('git.sync.pullCount', { count: upstream.behind.toLocaleString() })

  return {
    enabled: !operating,
    note: t('git.sync.pullChanges', { upstream: upstream.name, count })
  }
}

/**
 * Fetch が押せるか（Session 3-8-22A）。
 *
 * ## 押せない条件が「他の操作が動いている」しか無い
 *
 * Push / Pull と並ぶボタンなのに、readiness の中身がいちばん薄い ──
 * ブランチの上に居るかも、追跡先があるかも、送るものがあるかも見ない。
 * どれもこの操作には当てはまらないため（動くのは `refs/remotes/` の ref だけで、
 * HEAD も index も作業ツリーも変わらない。main/git/gitFetch.ts）。
 *
 * **remote が1つも無い場合も押せる。** `git fetch` は取ってくるものが無いだけで
 * 0 で終わる（失敗ではない）── ここで先回りして塞ぐと、`hasRemote` を
 * 見る条件が Push と2箇所に生まれる。ただし remote がまだ無い状態では
 * そもそも「GitHub に公開」の並びが出ているので、押す人はほとんど居ない。
 *
 * ## 何が起きるかを、押す前に書く
 *
 * `--prune` が付いていることは**押した後の見た目に出る**（一覧から枝が消える）。
 * hover と読み上げでそれを先に言う ── 3-8-17 が「URL を変えると追跡情報が
 * 古いまま残る」を確認の文に書いたのと同じで、**消える側を先に言う**。
 */
export function toGitFetchReadiness(
  operating: boolean,
  t: TFunction = DEFAULT_T
): GitActionReadiness {
  return {
    enabled: !operating,
    note: t('git.sync.fetchNote')
  }
}

/**
 * Commit & Push が押せるか。
 *
 * **Commit の条件をそのまま引き継ぐ**（`toGitCommitReadiness` の結果を渡させる）──
 * 同じ条件を2箇所で組み立てると、片方だけ直された日に「Commit は押せないのに
 * Commit & Push は押せる」が生まれる。
 *
 * 足すのは Push の**土台**（ブランチの上に居るか）だけで、`ahead` は見ない ──
 * これから作る Commit が必ず1件増えるため、「送るものが無い」は成り立たない。
 */
export function toGitCommitAndPushReadiness(
  commit: GitCommitReadiness,
  head: GitHead,
  t: TFunction = DEFAULT_T
): GitActionReadiness {
  if (head.kind !== 'branch') {
    return { enabled: false, note: t('git.commit.readiness.notOnBranchPush') }
  }

  return {
    enabled: commit.enabled,
    note: t('git.commit.readiness.commitAndPush')
  }
}

/**
 * 追跡先との進み具合の見せ方。upstream が無ければ null（欄そのものを出さない）。
 *
 * **0 / 0 を「差が無い」として出す。** 追跡先があって同期している状態は、
 * 追跡先が無い状態とは別のことで、それが分かるのは押す前に知りたいことにあたる
 * （Session 3-8-4 の Push / Pull で効いてくる）。
 *
 * 差が分からない場合（upstream の ref が手元に無い）は名前だけを出す ──
 * 0 と書くと「送るものは無い」と読まれる。
 */
export function describeGitUpstream(
  upstream: GitUpstreamStatus | null,
  t: TFunction = DEFAULT_T
): {
  readonly text: string
  readonly title: string
} | null {
  if (upstream === null) {
    return null
  }

  if (upstream.ahead === null || upstream.behind === null) {
    return {
      text: upstream.name,
      title: t('git.sync.upstreamUnknown', { name: upstream.name })
    }
  }

  return {
    text: `↑${upstream.ahead} ↓${upstream.behind}`,
    title: t('git.sync.upstreamAheadBehind', {
      name: upstream.name,
      ahead: upstream.ahead.toLocaleString(),
      behind: upstream.behind.toLocaleString()
    })
  }
}
