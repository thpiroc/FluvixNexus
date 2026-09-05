import { findGitBranchNameProblem, prepareGitBranchName } from '@shared/git'
import type { GitRemoteBranch } from '@shared/git'
import type { GitActionReadiness } from './gitChanges'
import { describeGitBranchNameProblem } from './gitBranches'
import { createTranslator, type TFunction } from '../i18n/messages'

const DEFAULT_T = createTranslator('ja')

/**
 * remote-tracking branch の一覧 → 面に並べる形（React / DOM 非依存・テスト対象・
 * Session 3-8-19）。
 *
 * gitBranches.ts が「ローカルのブランチを選ぶ / 作る」を持つのと**並びの違う
 * もの**を持つ ── こちらは「remote の枝から、手元に1つ作る」になる。
 * GitBranchMenu.tsx に残るのは配置だけ、という分担は 3-8-6 から変わらない。
 *
 * ## ここで決めているのは4つ
 *
 *   1. 開いた面に何と出すか（読み込み中・失敗・1件も無い・切れている）
 *   2. **一覧が空だったときに、何を次の一手として言うか**（remote の有無で変わる）
 *   3. 行を押せるか、押すと何が起きるか
 *   4. 打ったローカル名で作れるか、作れないならなぜか
 *
 * 4 の判断は shared の関数（`findGitBranchNameProblem`）に委ねてあり、
 * 文言も gitBranches.ts の `describeGitBranchNameProblem` をそのまま使う ──
 * **同じ規則に2つの言い方を持たせない。** ローカル名として通る形は、
 * どの欄から打っても同じにあたる（Main も同じ `normalizeGitBranchName` を通す）。
 *
 * ## 2 が、このファイルがある理由のいちばん大きいところ
 *
 * 一覧が空になる理由は2つあり、**次の一手がまったく違う。**
 *
 *   remote が1つも無い       … 先に「リモート」から登録する（同じパネルの上のバー）
 *   remote はあるが未 fetch  … Terminal で `git fetch` するか、一度 Pull する
 *
 * git の出力からはこの2つを見分けられないため、Main が同じ問い合わせの中で
 * `hasRemote` を確かめて載せている（shared/ipc/contracts/git.ts）。
 * ここはそれを読んで言い分けるだけになる ── **`repository.hasRemote` と
 * 突き合わせない**のは、その2つが別の瞬間の写しになりうるためにあたる。
 *
 * ## 「一覧は最後に fetch した時点の写し」と書く
 *
 * この面は**ネットワークへ出ない**（Session 3-8-19 の範囲外。
 * shared/git/remoteBranch.ts）。黙って古い一覧を出すと、利用者は
 * 「remote にあるはずのブランチが無い ＝ 消えた」と読む ── 一覧が切れている
 * ことを `truncated` として必ず言う（3-8-6）のと同じ判断で、
 * **いつの写しなのかも黙らない。**
 *
 * ## 「既にある名前か」はここで見ない
 *
 * ローカルブランチの一覧は同じ面の上半分に出ているので突き合わせることは
 * できるが、しない ── gitBranches.ts の作成欄とまったく同じ判断で、
 * 一覧は切れていることがあり、大文字小文字だけが違う名前は git にしか
 * 分からない。押した結果として Main が `branch-exists` を返す
 * （しかも git を動かす前に。main/git/gitRemoteBranches.ts）。
 */

/**
 * remote-tracking branch からの作成の目印（`toGitOperationKey` が作るものと
 * 同じ枠に入る）。
 *
 * 3-8-6 の作成（`GIT_CREATE_BRANCH_OPERATION_KEY`）と**別の目印**にしてある ──
 * 動かすチャンネルが別で、押せる場所も別（面の下半分の行）になる。
 * 同じ目印にすると、片方が動いている間にもう片方が押せなくなる理由が
 * 「同じ操作だから」に見えるが、実際には別の操作にあたる。
 *
 * 対象（どの remote-tracking branch か）は目印に含めない ── 面の中で開ける
 * 欄は一度に1つで、2件目を押せる場面がそもそも無い（3-8-14 と同じ）。
 */
export const GIT_CREATE_TRACKING_BRANCH_OPERATION_KEY = 'create-tracking-branch'

/**
 * 一覧の今の姿（フックが持つ形）。
 *
 * `GitBranchListState` と**同じ形にしてある**（`hasRemote` が1つ多いだけ）──
 * 取り直す契機も、追い越しの捨て方も、面が開いた瞬間から始まることも
 * 3-8-6 と同じなので、状態の形まで違えると読む側が2つ覚えることになる。
 */
export interface GitRemoteBranchListState {
  readonly status: 'loading' | 'ready' | 'not-ready' | 'failed'
  readonly branches: readonly GitRemoteBranch[]
  /** 上限（`GIT_REMOTE_BRANCH_LIMIT`）で切られたか。 */
  readonly truncated: boolean
  /**
   * remote が1つでも登録されているか（一覧が空のときだけ読む）。
   *
   * 既定を `false` にしてあるのは、まだ答えが届いていない間
   * （`loading`）に読まれないためになる ── 読まれるのは `ready` で
   * 空のときだけで、そのときは必ず Main の答えが入っている。
   */
  readonly hasRemote: boolean
}

/** 開いた直後の姿（まだ何も届いていない）。 */
export const INITIAL_GIT_REMOTE_BRANCH_LIST: GitRemoteBranchListState = {
  status: 'loading',
  branches: [],
  truncated: false,
  hasRemote: false
}

/**
 * 一覧の代わりに出す一言。行が出せるなら null。
 *
 * **行と一言を同時に出さない**（3-8-6 と同じ）── 出すと、面の中に
 * 「選べるもの」と「選べない理由」が並ぶことになる。
 *
 * ## 空のときだけ、言うことが2つに分かれる
 *
 * どちらも「まだ手元に remote の枝が無い」だが、次の一手が違う ──
 * 片方はこのパネルの上のバー（「リモート」）を押すことで、もう片方は
 * Terminal パネルへ出ることになる。**同じ文にまとめない。**
 *
 * `git fetch` を案内するのは、アプリがその口を持たないため（Session 3-8-19 の
 * 範囲外）── 持っていないものを勧めることになるが、`-D` を案内しない
 * （gitChanges.ts）のとは事情が逆にあたる。あちらは**あえて持たないと
 * 決めたもの**で、こちらは**まだ足していないもの**になる。Pull を先に書くのは、
 * それがこのパネルの中に既に在るためで、そちらで済む人を端末へ出さない。
 */
export function describeGitRemoteBranchList(
  state: GitRemoteBranchListState,
  t: TFunction = DEFAULT_T
): string | null {
  switch (state.status) {
    case 'loading':
      return t('git.remoteBranch.list.loading')

    case 'not-ready':
      return t('git.remoteBranch.list.notReady')

    case 'failed':
      return t('git.remoteBranch.list.failed')

    case 'ready':
      break
  }

  if (state.branches.length > 0) {
    return null
  }

  return state.hasRemote
    ? t('git.remoteBranch.list.emptyWithRemote')
    : t('git.remoteBranch.list.emptyWithoutRemote')
}

/**
 * 一覧が切れていることの断り。切れていなければ null。
 *
 * **黙って切らない**（3-8-6 と同じ）── 一覧に出ていないものがあることを
 * 言わずに済ませると、利用者は「無い」と読む。
 *
 * ここでできることまで案内するのも同じ形になる ── 出ていない枝から始めるには、
 * 今のところ Terminal パネルで `git switch --track` を使う（名前を打って
 * 指す欄は作っていない。docs/ARCHITECTURE.md §14.27）。
 */
export function describeGitRemoteBranchTruncation(
  state: GitRemoteBranchListState,
  t: TFunction = DEFAULT_T
): string | null {
  if (state.status !== 'ready' || !state.truncated) {
    return null
  }

  return t('git.remoteBranch.list.truncated', {
    count: state.branches.length.toLocaleString()
  })
}

/**
 * 一覧が「いつの写しか」の断り。行が1つも無ければ null。
 *
 * ## 出すのは行があるときだけ
 *
 * 空のときは `describeGitRemoteBranchList` が既に「Pull するか fetch する」と
 * 言っている ── そこへ重ねると、同じことを2行で言うことになる。
 *
 * ## 「古いかもしれない」ではなく「いつの写しか」を書く
 *
 * この面は fetch しない（Session 3-8-19 の範囲外）。それを黙っていると、
 * 開いた人は**今の remote の状態**として読む ── remote 側で消された枝が
 * 残って見え、増えた枝は出てこない。どちらも「アプリが壊れている」と
 * 読まれる形になる。
 *
 * 日時は書かない ── 最後に fetch した時刻を知るには `.git/FETCH_HEAD` を
 * 読むことになり、一覧を開くたびに読むもの（と、それを運ぶ欄）が1つ増える。
 * **「取得済みのもの」と言えば、次の一手（Pull / fetch）は上の案内と同じ**になる。
 */
export function describeGitRemoteBranchFreshness(
  state: GitRemoteBranchListState,
  t: TFunction = DEFAULT_T
): string | null {
  if (state.status !== 'ready' || state.branches.length === 0) {
    return null
  }

  return t('git.remoteBranch.list.freshness')
}

/**
 * 一覧の行が押せるか。
 *
 * ## 押しても git は動かない
 *
 * ローカルの一覧（`toGitBranchSwitchReadiness`）は押すと切り替わるが、
 * こちらは**行の下にローカル名の欄が開くだけ**になる ── 押した瞬間に
 * 手元にブランチが増える形にしないのが 3-8-6 からの決めごとで
 * （shared/git/branch.ts）、その決めごとがここで守られる。
 *
 * ## それでも他の Git 操作の最中は押せなくする
 *
 * 開くだけなら邪魔にならない（履歴・退避のボタンは押せなくしていない）が、
 * ここは**開いた先の「作成」がすぐ押せる**場所になる ── 動いている最中に
 * 開けると、欄は開くのにボタンだけが薄い状態が生まれる。
 * 押せない理由は行の側で言う方が、押した後に気づくより早い。
 */
export function toGitRemoteBranchSelectReadiness(
  branch: GitRemoteBranch,
  operating: boolean,
  t: TFunction = DEFAULT_T
): GitActionReadiness {
  return {
    enabled: !operating,
    note: t('git.remoteBranch.select', { name: branch.name })
  }
}

/**
 * 打ったローカル名で、その remote-tracking branch を追うブランチを作れるか。
 *
 * ## `toGitBranchCreateReadiness` と別の関数にしてある
 *
 * 判断そのもの（名前の形・他の Git 操作）は同じで、違うのは**何が起きるかの
 * 言い方**だけになる ── バーの「＋」は「今の場所から」、こちらは
 * 「`origin/feature` を追って」で、そこは利用者にとってまったく別のことに
 * あたる。1つの関数に引数を足して分岐させると、片方を直した日に
 * もう片方の文が静かに変わる（3-8-13 で `toGitCommitBranchReadiness` を
 * 分けたのとまったく同じ判断）。
 *
 * ## 空のときも理由を言う（3-8-6 / 3-8-13 とは逆）
 *
 * あちらは「打つ前から赤く出るのは、まだ何も間違えていない人に間違いを
 * 知らせる形になる」として空を黙らせていた。ここは**既定値が最初から
 * 入っている**（`GitRemoteBranch.branch`）ので、空になるのは
 * **利用者が自分で消したとき**だけになる ── そのとき何も言わないと、
 * 押せないボタンの理由がどこにも出ない。
 *
 * ## 「既にある名前か」は見ない
 *
 * 同じ面の上半分にローカルの一覧が出ているが、突き合わせない
 * （このファイルの冒頭）── Main が git を動かす前に断り、
 * その理由は `branch-exists` として返る。
 */
export function toGitTrackingBranchCreateReadiness(
  branch: GitRemoteBranch,
  name: string,
  operating: boolean,
  t: TFunction = DEFAULT_T
): GitActionReadiness {
  const prepared = prepareGitBranchName(name)
  const problem = findGitBranchNameProblem(prepared)

  if (problem !== null) {
    return { enabled: false, note: describeGitBranchNameProblem(problem, t) }
  }

  return {
    enabled: !operating,
    note: t('git.remoteBranch.create', { remote: branch.name, local: prepared })
  }
}
