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
export function toGitChangeGroups(changes: GitWorkingTreeChanges): readonly GitChangeGroup[] {
  const groups: readonly GitChangeGroup[] = [
    { id: 'conflicted', label: '競合', changes: changes.conflicted },
    { id: 'staged', label: 'ステージ済みの変更', changes: changes.staged },
    { id: 'unstaged', label: '変更', changes: changes.unstaged },
    { id: 'untracked', label: '未追跡のファイル', changes: changes.untracked }
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
export function describeGitChangeKind(kind: GitChangeKind): {
  readonly symbol: string
  readonly label: string
} {
  switch (kind) {
    case 'added':
      return { symbol: 'A', label: '追加' }

    case 'modified':
      return { symbol: 'M', label: '変更' }

    case 'deleted':
      return { symbol: 'D', label: '削除' }

    case 'renamed':
      return { symbol: 'R', label: '名前変更' }

    case 'copied':
      return { symbol: 'C', label: 'コピー' }

    case 'type-changed':
      return { symbol: 'T', label: '種類変更' }

    case 'untracked':
      return { symbol: '?', label: '未追跡' }

    case 'conflicted':
      return { symbol: '!', label: '競合' }
  }
}

/**
 * その行から Editor でファイルを開けるか。
 *
 * 開けないのは2つだけになる。
 *
 *   フォルダ … 中身がすべて未追跡のフォルダは1件にまとまっている（shared/git/status.ts）
 *   削除     … もうそこに無い。押せるように見せても開ける先が無い
 *
 * 消えたものを**別の見せ方で救う**のは Diff Viewer（Session 3-8-3 以降）の担当で、
 * ここで中途半端に開こうとすると、Editor に「読めませんでした」のタブが増えるだけになる。
 */
export function canOpenGitChange(change: GitFileChange): boolean {
  return !change.directory && change.kind !== 'deleted'
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
export function describeGitChangeRow(change: GitFileChange): {
  readonly name: string
  readonly location: string | null
} {
  const split = splitRelativePath(change.relativePath)
  // 正規化を通った相対位置なので分けられないことは無いが、分けられない形が
  // 来ても行そのものは出す（一覧から黙って1件消える方が危ない）。
  const name = split === null ? change.relativePath : split.name
  const parent = split === null ? '' : split.parent

  if (change.originalPath !== null) {
    return { name, location: `${change.originalPath} から` }
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
 * 競合しているファイルには操作を置かない。解決するまで Stage も Unstage も
 * 意味を持たず（shared/git/status.ts）、押せる形にすれば
 * **成立しない操作を勧める**ことになる。
 */
export type GitRowAction = 'stage' | 'unstage' | null

export function toGitRowAction(groupId: GitChangeGroup['id']): GitRowAction {
  switch (groupId) {
    case 'staged':
      return 'unstage'

    case 'unstaged':
    case 'untracked':
      return 'stage'

    case 'conflicted':
      return null
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
): string {
  switch (target.kind) {
    /*
      破棄を Stage / Unstage と**同じ鍵**にしてある（Session 3-8-9）。

      どれもその1行を相手にする操作で、同時に走ってよいものが1つも無い ──
      鍵を分けると「破棄している最中に、その同じ行を Stage できる」形になり、
      走っている git 2本がどちらの順で当たるかで結果が変わる。
      `operate` は同じ鍵の要求を弾く（useGitRepository.ts）。
    */
    case 'file':
    case 'unstage':
    case 'discard':
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
  change: GitFileChange
): GitDiscardWarning {
  const { name } = describeGitChangeRow(change)

  if (group === 'untracked') {
    return {
      message: `「${name}」をごみ箱に移動します。`,
      // Files パネルの削除とまったく同じ結末なので、同じことを同じ言い方で言う。
      note: 'ごみ箱から元に戻せます。',
      confirmLabel: 'ごみ箱に移動'
    }
  }

  return {
    message:
      change.kind === 'deleted'
        ? `「${name}」を、ステージ済みの内容から復元します。`
        : `「${name}」の変更を、ステージ済みの内容に戻します。`,
    note: 'この変更は元に戻せません。ステージ済みの内容は変わりません。',
    confirmLabel: '変更を破棄'
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
  unsavedPaths: ReadonlySet<string>
): string | null {
  if (!unsavedPaths.has(relativePath)) {
    return null
  }

  return 'このファイルは Editor に未保存の変更があります。保存するかタブを閉じてから破棄してください。'
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
export function describeGitOperationFailure(failure: GitOperationFailure): string {
  const reason = describeGitOperationFailureReason(failure.reason)

  if (failure.status === 'partly-applied') {
    return `${describeGitPartialStep(failure.completed)}${reason}`
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
function describeGitPartialStep(step: GitPartialOperationStep): string {
  switch (step) {
    case 'commit':
      return 'Commit は完了しましたが、Push できませんでした。'

    /*
      remote の設定まで済んでいるとは限らない（`no-remote` が理由として
      来るのがその場合にあたる）ため、ここでは**作られたことだけ**を言う。
      続きに何をすればよいかは、後半の理由が言う。
    */
    case 'github-repository':
      return 'GitHub の repository は作成されました。'
  }
}

/** 分類ごとの一言（`partly-applied` でも同じものを後半に使う）。 */
function describeGitOperationFailureReason(reason: GitOperationFailureReason): string {
  switch (reason) {
    case 'not-ready':
      return 'この Workspace では Git 操作を行えなくなりました。'

    case 'nothing-to-do':
      return '対象がありませんでした。最新の状態に更新しました。'

    case 'identity-missing':
      return 'Git の user.name / user.email が設定されていないため Commit できません。'

    case 'hook-rejected':
      return 'このリポジトリの Git hook が Commit を中止しました。内容はターミナルの git commit でご確認ください。'

    case 'unresolved-conflicts':
      return '競合が解決されていないため Commit できません。'

    case 'path-not-found':
      return '対象のファイルが見つかりませんでした。一覧を更新しました。'

    case 'not-on-branch':
      return 'ブランチの上に居ないため Push / Pull できません。ブランチに切り替えてからお試しください。'

    /*
      Session 3-8-10 で次の一手が変わった ── 端末で `git remote add` を
      打つ以外に、「GitHub に公開」がパネルの中に在る。
    */
    case 'no-remote':
      return 'このリポジトリには remote が設定されていません。「GitHub に公開」から作成するか、Terminal パネルで git remote add を実行してください。'

    case 'no-commit':
      return 'まだ Commit が1つもありません。先に Commit してから公開してください。'

    case 'github-cli-missing':
      return 'GitHub CLI が見つかりませんでした。インストールしてから、もう一度お試しください。'

    case 'github-signed-out':
      return 'GitHub にログインしていません。Terminal パネルで gh auth login を実行してください。'

    case 'github-repository-exists':
      return '同じ名前の repository が GitHub に既にあります。別の名前をお試しください。'

    case 'no-upstream':
      return '追跡先が設定されていないため Pull できません。先に Push すると追跡先が設定されます。'

    case 'auth-required':
      return 'Git の認証が必要です。Terminal パネルで一度 git push / git pull を実行して認証を済ませてください。'

    case 'network-unavailable':
      return 'remote に接続できませんでした。ネットワークの状態をご確認ください。'

    /*
      「Push できませんでした」と書かないのは、`partly-applied` の前半
      （「Commit は完了しましたが、Push できませんでした。」）と重なるため。
      理由の文は**理由だけ**を言い、結末は前半が言う。
    */
    case 'push-rejected':
      return 'remote 側に新しい変更があります。先に Pull してからお試しください。'

    case 'remote-rejected':
      return 'remote 側が受け取りを拒否しました。保護されたブランチか、サーバー側の設定によるものです。'

    case 'diverged':
      return '手元と remote が枝分かれしているため、早送りで取り込めませんでした。Terminal パネルで内容をご確認ください。'

    case 'local-changes-blocked':
      return '作業ツリーの変更が上書きされるため実行できませんでした。Commit するか退避してからお試しください。'

    case 'branch-exists':
      return '同じ名前のブランチが既にあります。別の名前をお試しください。'

    case 'branch-not-found':
      return '切り替え先のブランチが見つかりませんでした。一覧を開き直してご確認ください。'

    /*
      始点にした commit が解けなかった（Session 3-8-13）。

      「ブランチが見つかりません」と**同じ文にしない** ── 探しに行った相手が
      違い、開き直す先も違う（あちらはブランチの一覧、こちらは履歴）。
    */
    case 'commit-not-found':
      return '指定したコミットが見つかりませんでした。履歴を開き直してご確認ください。'

    case 'unsupported-target':
      return 'この行はその操作の対象になりません。一覧を更新しました。'

    case 'target-busy':
      return '対象のファイルが他のプログラムに使われています。閉じてからもう一度お試しください。'

    case 'index-locked':
      return '他の Git 操作が実行中です。終わってからもう一度お試しください。'

    case 'permission-denied':
      return 'アクセスが拒否されました。フォルダのアクセス許可をご確認ください。'

    case 'timeout':
      return '時間内に完了しませんでした。もう一度お試しください。'

    case 'unknown':
      return 'Git 操作に失敗しました。'
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
export function describeGitCommitMessageProblem(problem: GitCommitMessageProblem): string {
  switch (problem) {
    case 'empty':
      return 'Commit メッセージを入力してください。'

    case 'too-long':
      return `Commit メッセージは ${GIT_COMMIT_MESSAGE_MAX_LENGTH.toLocaleString()} 文字までです。`

    case 'invalid-characters':
      return 'Commit メッセージに使用できない文字が含まれています。'
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
  operating: boolean
): GitCommitReadiness {
  const prepared = prepareGitCommitMessage(message)
  const left = GIT_COMMIT_MESSAGE_MAX_LENGTH - prepared.length
  const remaining = left <= COMMIT_MESSAGE_COUNTER_THRESHOLD ? left : null

  if (stagedCount === 0) {
    return { enabled: false, note: 'Commit するには、変更をステージしてください。', remaining }
  }

  const problem = findGitCommitMessageProblem(prepared)

  if (problem !== null) {
    return {
      enabled: false,
      // 空欄は「まだ書いていない」であって、直すべき間違いではない。
      note: problem === 'empty' ? null : describeGitCommitMessageProblem(problem),
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
  operating: boolean
): GitActionReadiness {
  if (head.kind !== 'branch') {
    return { enabled: false, note: 'ブランチの上に居ないため Push できません。' }
  }

  if (upstream === null) {
    return { enabled: !operating, note: '追跡先を作って、このブランチを送ります。' }
  }

  if (upstream.ahead === 0) {
    return { enabled: false, note: `${upstream.name} へ送る Commit はありません。` }
  }

  const count = upstream.ahead === null ? '' : `${upstream.ahead} 件の `

  return { enabled: !operating, note: `${count}Commit を ${upstream.name} へ送ります。` }
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
  operating: boolean
): GitActionReadiness {
  if (head.kind !== 'branch') {
    return { enabled: false, note: 'ブランチの上に居ないため Pull できません。' }
  }

  if (upstream === null) {
    return { enabled: false, note: '追跡先が設定されていないため Pull できません。' }
  }

  const count = upstream.behind === null || upstream.behind === 0 ? '' : `（${upstream.behind} 件）`

  return { enabled: !operating, note: `${upstream.name} の変更を取り込みます${count}。` }
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
  head: GitHead
): GitActionReadiness {
  if (head.kind !== 'branch') {
    return { enabled: false, note: 'ブランチの上に居ないため Push できません。' }
  }

  return {
    enabled: commit.enabled,
    note: 'ステージ済みの変更を Commit して、そのまま Push します。'
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
export function describeGitUpstream(upstream: GitUpstreamStatus | null): {
  readonly text: string
  readonly title: string
} | null {
  if (upstream === null) {
    return null
  }

  if (upstream.ahead === null || upstream.behind === null) {
    return {
      text: upstream.name,
      title: `追跡先は ${upstream.name}（進み具合は取得できませんでした）`
    }
  }

  return {
    text: `↑${upstream.ahead} ↓${upstream.behind}`,
    title: `${upstream.name} より ${upstream.ahead} 件進み、${upstream.behind} 件遅れています`
  }
}
