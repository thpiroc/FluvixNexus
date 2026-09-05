import { findGitBranchNameProblem, prepareGitBranchName } from '@shared/git'
import type {
  GitBranchNameProblem,
  GitHead,
  GitInProgressOperation,
  GitLocalBranch
} from '@shared/git'
import type { GitActionReadiness } from './gitChanges'
import { describeGitInProgressBlock } from './gitInProgress'
import { createTranslator, type TFunction } from '../i18n/messages'

const DEFAULT_T = createTranslator('ja')

/**
 * ブランチの一覧と作成 → 画面に並べる形（React / DOM 非依存・テスト対象・Session 3-8-6）。
 *
 * gitChanges.ts が「変更の一覧」を、gitRepositoryMessage.ts が「使えない状態の
 * 文言」を持つのと同じ立ち位置で、こちらは**ブランチを選ぶ面の中身**を持つ。
 * GitBranchMenu.tsx に残るのは配置だけになる。
 *
 * ## ここで決めているのは5つ（Session 3-8-14 と 3-8-20 で1つずつ増えた）
 *
 *   1. 開いた面に何と出すか（読み込み中・失敗・1件も無い・切れている）
 *   2. 行を押せるか、押すと何が起きるか
 *   3. 打った名前でブランチを作れるか、作れないならなぜか
 *   4. その行を削除 / 改名できるか、できないならなぜか（3-8-14）
 *   5. その行を今のブランチへ取り込めるか、確認に何と書くか（3-8-20）
 *
 * 3 の判断は shared の関数（`findGitBranchNameProblem`）に委ねてある ──
 * Main が受け取った後に通すのと**同じ関数**で、ここが持つのは文言だけになる
 * （Commit メッセージで `describeGitCommitMessageProblem` が持っているのと同じ分担）。
 *
 * ## 「既にある名前か」はここで見ない
 *
 * 一覧は手元にあるので突き合わせることはできるが、しない。理由は2つ。
 *
 *   - 一覧は**切れていることがある**（`truncated`）。切れた先にある名前を
 *     「無い」と読むと、押せるのに作れないボタンになる
 *   - 大文字小文字だけが違う名前・`a` と `a/b` の衝突は、**git にしか分からない**
 *
 * 押した結果として Main が `branch-exists` を返す（shared/git/operation.ts）。
 * 条件を Main と二重に持たないのは Push / Pull と同じ判断になる（gitChanges.ts）。
 */

/**
 * ブランチ操作の目印（`toGitOperationKey` が作るものと同じ枠に入る）。
 *
 * Push / Commit と同じく関数ではなく定数にしてある ── 対象を1つしか
 * 持てない操作で、**同時に2つ走ってよいものが無い**ため。切り替え先の名前を
 * 目印に混ぜると「別のブランチへの切り替えなら並べて始めてよい」ことになり、
 * 押した順に2回切り替わるだけの動きになる。
 */
export const GIT_SWITCH_BRANCH_OPERATION_KEY = 'switch-branch'
export const GIT_CREATE_BRANCH_OPERATION_KEY = 'create-branch'
/**
 * 削除 / rename の目印（Session 3-8-14）。
 *
 * ここも対象を名前に含めない。含めると「別のブランチの削除なら並べて
 * 始めてよい」ことになるが、面の中で開ける欄は**一度に1つ**なので、
 * そもそも2つ目を押せる場面が無い ── 名前を混ぜると、目印が
 * 「押せるかどうか」の役に立たなくなるだけになる。
 */
export const GIT_DELETE_BRANCH_OPERATION_KEY = 'delete-branch'
export const GIT_RENAME_BRANCH_OPERATION_KEY = 'rename-branch'
/**
 * マージの開始 / 中止の目印（Session 3-8-20）。
 *
 * ここも対象を名前に含めない ── 含めると「別のブランチのマージなら並べて
 * 始めてよい」ことになるが、取り込み先は常に**1つの今のブランチ**で、
 * 2本同時に始めてよいものではない（削除 / rename と同じ判断）。
 *
 * 中止を別の目印にしてあるのは、**同時に走ってよいかではなく、
 * 押せる場所が別**だからになる ── 開始は面の中の行、中止はパネルの帯で、
 * 片方が動いている間にもう片方の押せなさを目印から読めるようにする
 * （どちらも `operating` で止まるので、実際に並ぶことは無い）。
 */
export const GIT_MERGE_BRANCH_OPERATION_KEY = 'merge-branch'
export const GIT_ABORT_MERGE_OPERATION_KEY = 'abort-merge'

/**
 * 一覧の今の姿（フックが持つ形）。
 *
 * `loading` を分けているのは、開いた瞬間に「ブランチがありません」と出さない
 * ため ── 一覧は開くたびに取り直す（`git:changed` には相乗りさせていない。
 * Session 3-8-8）ので、面が開いた直後は必ずこの状態を通る。
 */
export interface GitBranchListState {
  readonly status: 'loading' | 'ready' | 'not-ready' | 'failed'
  readonly branches: readonly GitLocalBranch[]
  /** 上限（`GIT_LOCAL_BRANCH_LIMIT`）で切られたか。 */
  readonly truncated: boolean
}

/** 開いた直後の姿（まだ何も届いていない）。 */
export const INITIAL_GIT_BRANCH_LIST: GitBranchListState = {
  status: 'loading',
  branches: [],
  truncated: false
}

/**
 * 一覧の代わりに出す一言。行が出せるなら null。
 *
 * **行と一言を同時に出さない。** 出すと、面の中に「選べるもの」と
 * 「選べない理由」が並ぶことになり、どちらが今の状態なのかが読めなくなる
 * （切れていることの断りだけは別枠。`describeGitBranchTruncation`）。
 */
export function describeGitBranchList(
  state: GitBranchListState,
  t: TFunction = DEFAULT_T
): string | null {
  switch (state.status) {
    case 'loading':
      return t('git.branch.list.loading')

    case 'not-ready':
      return t('git.branch.list.notReady')

    case 'failed':
      return t('git.branch.list.failed')

    case 'ready':
      break
  }

  /*
    まだ1つも commit が無いリポジトリ（`git init` の直後）。ブランチ名は
    出ているのに一覧が空になるのはこの場合だけで、**失敗ではない** ──
    次の一手は「最初の Commit を作る」で、それはこの面ではなく下の Commit 欄にある。
  */
  return state.branches.length === 0 ? t('git.branch.list.empty') : null
}

/**
 * 一覧が切れていることの断り。切れていなければ null。
 *
 * **黙って切らない。** 一覧に出ていないブランチがあることを言わずに済ませると、
 * 利用者は「消えた」と読む。ここでできることまで案内する ── 出ていない
 * ブランチへ切り替えるには、今のところ Terminal パネルで `git switch` を使う
 * （名前を打って切り替える欄は作っていない。docs/ARCHITECTURE.md §14.15）。
 */
export function describeGitBranchTruncation(
  state: GitBranchListState,
  t: TFunction = DEFAULT_T
): string | null {
  if (state.status !== 'ready' || !state.truncated) {
    return null
  }

  return t('git.branch.list.truncated', { count: state.branches.length.toLocaleString() })
}

/**
 * 一覧の行が押せるか。
 *
 * ## 今のブランチも押せる
 *
 * 印は付けるが、押せなくはしない。押すと git は動かず `nothing-to-do` として
 * 返る（main/git/gitBranches.ts）── 押せなくすると、「今どこに居るか」を
 * 確かめるために開いた面で、**いちばん見たい行だけが薄く**なる。
 *
 * ## 止めるのは、他の Git 操作が動いている間だけ
 *
 * 切り替えは「今のブランチ全体」を相手にする操作なので、Commit / Push と同じ扱いに
 * する（行の `＋` / `−` が押した対象だけを止めるのとは性質が違う。gitChanges.ts）。
 */
export function toGitBranchSwitchReadiness(
  branch: GitLocalBranch,
  operating: boolean,
  t: TFunction = DEFAULT_T
): GitActionReadiness {
  if (branch.current) {
    return { enabled: !operating, note: t('git.branch.switchCurrent', { name: branch.name }) }
  }

  return { enabled: !operating, note: t('git.branch.switchTo', { name: branch.name }) }
}

/**
 * 打った名前でブランチを作れるか、作れないならなぜか。
 *
 * `GitCommitReadiness` と同じ考え方で、**押せる / 押せないを決める場所に理由も
 * 一緒に持たせる**（gitChanges.ts）── 薄いボタンだけを置いて、なぜ押せないのかが
 * どこにも出ない状態を作らない。
 *
 * 空のときだけ理由を言わない（`note` は「何が起きるか」に留める）── 打つ前から
 * 「名前を入力してください」と赤く出るのは、まだ何も間違えていない人に
 * 間違いを知らせる形になる。
 */
export function toGitBranchCreateReadiness(
  name: string,
  operating: boolean,
  t: TFunction = DEFAULT_T
): GitActionReadiness {
  const prepared = prepareGitBranchName(name)
  const problem = findGitBranchNameProblem(prepared)

  if (problem === 'empty') {
    return { enabled: false, note: t('git.branch.createEmpty') }
  }

  if (problem !== null) {
    return { enabled: false, note: describeGitBranchNameProblem(problem, t) }
  }

  return { enabled: !operating, note: t('git.branch.createReady', { name: prepared }) }
}

/**
 * 履歴の1行から、その commit を始点にブランチを作れるか（Session 3-8-13）。
 *
 * ## `toGitBranchCreateReadiness` と別の関数にしてある
 *
 * 判断そのもの（名前の形・他の Git 操作）は同じで、違うのは**何が起きるかの
 * 言い方**だけになる ── バーの「＋」は「今の場所から」、こちらは
 * 「この commit から」で、そこは利用者にとってまったく別のことにあたる。
 * 1つの関数に始点を渡して分岐させる形にしなかったのは、3-8-6 の側の文言が
 * **始点が無いことを前提に書かれている**ためで、引数を足すと片方を直した日に
 * もう片方の文が静かに変わる。
 *
 * ## マージ commit も始点にできる
 *
 * 3-8-12 の差分は、親が2つ以上あると「どちらと比べるか」が決まらないため
 * 断っていた。始点にはその問いが無い ── 比べるのではなく**その1点から
 * 始める**だけで、親がいくつあっても指す先は1つに決まる。したがって
 * ここでマージを弾く条件は置いていない（gitCommitDetail.ts の
 * `canOpenGitCommitDetail` とは判断が違う）。
 *
 * ## 空のときだけ理由を言わない
 *
 * 3-8-6 と同じ形。打つ前から「名前を入力してください」と出るのは、
 * まだ何も間違えていない人に間違いを知らせることになる。
 */
export function toGitCommitBranchReadiness(
  name: string,
  shortHash: string,
  operating: boolean,
  t: TFunction = DEFAULT_T
): GitActionReadiness {
  const prepared = prepareGitBranchName(name)
  const problem = findGitBranchNameProblem(prepared)

  if (problem === 'empty') {
    return { enabled: false, note: t('git.branch.createFromCommitEmpty', { hash: shortHash }) }
  }

  if (problem !== null) {
    return { enabled: false, note: describeGitBranchNameProblem(problem, t) }
  }

  return {
    enabled: !operating,
    note: t('git.branch.createFromCommitReady', { hash: shortHash, name: prepared })
  }
}

/**
 * その行のブランチを削除できるか（Session 3-8-14）。
 *
 * ## 今そこに居るブランチだけは押せない
 *
 * 一覧の行そのもの（切り替え）は今のブランチでも押せるようにしてある
 * （§14.14 ── 押しても git は動かず `nothing-to-do` で返る）が、
 * **✕ はそうしない。** 違いは「押しても何も起きない」か
 * 「押しても**絶対に**通らない」かにあたる ── チェックアウト中のブランチは
 * git が必ず断るもので、待っても押せるようにはならない。
 *
 * 破棄で「止まっている場合は押せる場所を出さない」としたのと同じ判断だが、
 * こちらは**行そのものは押せる**（切り替えられる）ので、消すのではなく
 * 押せない状態にして理由を添える ── 消すと、行ごとにボタンの数が変わって
 * 一覧の見た目が揃わなくなる。
 *
 * ## マージ済みかは見ない
 *
 * 一覧に載っていない（shared/git/branch.ts）し、載せると開くたびに
 * git へ聞くことが増える。基準（HEAD か追跡先か）を持つのは git で、
 * 断られたら `branch-not-merged` として理由が返る。
 */
export function toGitBranchDeleteReadiness(
  branch: GitLocalBranch,
  operating: boolean,
  t: TFunction = DEFAULT_T
): GitActionReadiness {
  if (branch.current) {
    return {
      enabled: false,
      note: t('git.branch.deleteCurrent', { name: branch.name })
    }
  }

  return { enabled: !operating, note: t('git.branch.deleteReady', { name: branch.name }) }
}

/**
 * 削除の確認に出す文言（Session 3-8-14）。
 *
 * ## 何が失われるかを、盛らずに書く
 *
 * `git branch -d` が通るのは「HEAD か追跡先にマージ済み」のときだけなので、
 * **成功した削除で commit が到達不能になることは無い。** それを
 * 「コミットが失われます」と書くと、破棄（§14.16）と同じ重さの警告になり、
 * 本当に失われる場面（未追跡ファイルの破棄）の警告まで軽く読まれることになる。
 *
 * 実際に消えるのは**枝の名前とその reflog** で、書くのはそこまでにする。
 *
 * ## それでも確認は挟む
 *
 * 押す場所が一覧の行の上（切り替えるつもりで当たる距離）にあり、
 * 消えた名前を戻すには hash を探すことになるため ── Git で確認を挟む
 * 2つめがこれになる（1つめは破棄）。
 */
export function describeGitBranchDeleteWarning(
  branch: GitLocalBranch,
  t: TFunction = DEFAULT_T
): {
  readonly message: string
  readonly note: string
  readonly confirmLabel: string
} {
  return {
    message: t('git.branch.deleteWarning.message', { name: branch.name }),
    note: t('git.branch.deleteWarning.note'),
    confirmLabel: t('git.branch.deleteWarning.confirm')
  }
}

/**
 * その行のブランチを今のブランチへ取り込めるか（Session 3-8-20）。
 *
 * ## 今のブランチの行では**出さない**（薄くもしない）
 *
 * 削除（✕）は「押しても絶対に通らない」ので薄くして理由を添えたが、
 * マージは違う ── 自分自身を取り込むというのは**操作として意味を成さない**
 * （git は `Already up to date.` と言って何もしない）。薄いボタンを置くと、
 * 「条件が揃えば押せるもの」に見える。
 *
 * 消しても一覧の見た目は揃う ── ✕ と違い、マージの口は行の**左端側**
 * （名前のすぐ右）に付くので、無い行では右の ✎ / ✕ がそのまま
 * 左へ詰まるのではなく、場所だけが空く形にしてある
 * （renderer/src/git/GitBranchMenu.tsx が空の器を置く）。
 *
 * 呼ぶ側はこの関数の `enabled` を見て**出すかどうか**を決める
 * （`visible` を別に返さないのは、押せない理由が1つしか無いため）。
 *
 * ## 途中の操作があるあいだは押せない
 *
 * 3-8-20 では `merging` の真偽1つを受け取っていた。3-8-22A で、それが
 * 4つの状態（merge / rebase / cherry-pick / revert）へ広がる ──
 * **rebase の途中でも押せてしまっていた**のが、3-8-20 の形の穴になる
 * （`MERGE_HEAD` が無いので `merging` は偽だった）。
 *
 * 押せない理由の文言はここに書かず、`describeGitInProgressBlock` から借りる
 * （renderer/src/git/gitInProgress.ts）── 帯に出ている案内と同じ言葉に
 * しておかないと、同じ状態が2通りに呼ばれることになる。
 *
 * 通してよいかを決めるのも、この面では判断しない。shared の表を読む
 * （shared/git/inProgress.ts）── Main が届いた要求に対して見るのと
 * 同じものになる。
 *
 * ## 競合が残っているかは、ここでは見ない
 *
 * 一覧の面は `head` と行しか受け取っておらず、変更ファイルの一覧は
 * 持っていない ── 持たせると、面が開くたびに増える依存が1つできる。
 * 競合が残っていれば Main が `unresolved-conflicts` として断り、
 * その文言は「先に解決してください」と言う（gitChanges.ts）。
 * **押す前に分かることを全部先に出す**のは Main の側の構えで、
 * 画面の側は「意味を成さない押し方」だけを塞ぐ。
 */
export function toGitBranchMergeReadiness(
  branch: GitLocalBranch,
  head: GitHead,
  inProgress: GitInProgressOperation | null,
  operating: boolean,
  t: TFunction = DEFAULT_T
): GitActionReadiness {
  const into = head.kind === 'branch' ? head.name : null

  if (branch.current || into === null || into === branch.name) {
    return { enabled: false, note: t('git.branch.mergeCurrent', { name: branch.name }) }
  }

  const blocked = describeGitInProgressBlock(inProgress, 'merge-branch', t)

  if (blocked !== null) {
    return { enabled: false, note: blocked }
  }

  return { enabled: !operating, note: t('git.branch.mergeReady', { name: branch.name, into }) }
}

/**
 * マージの確認に出す文言（Session 3-8-20）。
 *
 * ## Git で確認を挟む、3つめ
 *
 * 1つめは破棄（§14.16）、2つめはブランチの削除（§14.22）── どちらも
 * 「消える」ことへの確認だった。こちらは**消えないのに確認を挟む**、
 * 初めての操作になる。
 *
 * 理由は2つある。
 *
 *   - **押す場所が切り替えの行の上**にある（1文字分の距離）。誤って押すと、
 *     切り替えるつもりで**履歴に merge commit が積まれる**
 *   - **戻す口をアプリが持たない。** merge commit を作った後の取り消し
 *     （`reset`）は 3-8-20 の範囲外で、行き先は Terminal パネルになる
 *
 * ## 何が起きるかを、盛らずに書く
 *
 * 「失われます」とは書かない ── マージで消えるものは無く、
 * 起きるのは「今のブランチに相手の変更が入る」ことだけになる。
 * 破棄や削除と同じ重さの言い方をすると、本当に失われる場面の警告まで
 * 軽く読まれる（`describeGitBranchDeleteWarning` と同じ判断）。
 *
 * 競合しうることは**先に言う** ── 押した後に競合の行が並ぶのは、
 * 知らされていなければ「壊れた」と読まれる形になる。
 */
export function describeGitBranchMergeWarning(
  branch: GitLocalBranch,
  head: GitHead,
  t: TFunction = DEFAULT_T
): {
  readonly message: string
  readonly note: string
  readonly confirmLabel: string
} {
  const into = head.kind === 'branch' ? head.name : ''

  return {
    message: t('git.branch.mergeWarning.message', { name: branch.name, into }),
    note: t('git.branch.mergeWarning.note'),
    confirmLabel: t('git.branch.mergeWarning.confirm')
  }
}

/**
 * マージの中止の確認に出す文言（Session 3-8-20）。
 *
 * ## ここは「消える」側の確認になる
 *
 * `git merge --abort` が戻すのは**マージを始める前の状態**で、
 * そのとき在った作業ツリーの変更は残る。一方、
 * **競合を解決するために書いた内容・その間に stage したものは消える**
 * （実物で確かめてある。main/git/gitMergeRepository.test.ts）。
 *
 * 2つを同じ文の中で並べて書く ── 「元に戻ります」とだけ書くと、
 * 30 分かけて解決した内容が消えることが伝わらない。逆に
 * 「変更が失われます」とだけ書くと、マージの前から書きかけていた人が
 * 中止できなくなる。
 */
export function describeGitAbortMergeWarning(t: TFunction = DEFAULT_T): {
  readonly message: string
  readonly note: string
  readonly confirmLabel: string
} {
  return {
    message: t('git.branch.abortWarning.message'),
    note: t('git.branch.abortWarning.note'),
    confirmLabel: t('git.branch.abortWarning.confirm')
  }
}

/**
 * 打った名前へ改名できるか（Session 3-8-14）。
 *
 * ## 作成の欄と同じ規則を通す
 *
 * 名前の形は `findGitBranchNameProblem`（shared）── Main が受け取った後に
 * 通すのとまったく同じ関数で、ここが持つのは文言だけになる。作成と別の
 * 関数にしてあるのは、**何が起きるかの言い方が違う**ためで、そこは
 * `toGitCommitBranchReadiness` を分けたのと同じ判断にあたる。
 *
 * ## 同じ名前は押せない
 *
 * 押しても git は動かず `nothing-to-do` で返る（Main 側でも見ている）。
 * 欄の初期値が今の名前なので、**開いた直後は必ずこの状態になる** ──
 * だから理由は「間違い」ではなく「新しい名前を入力してください」と書く。
 *
 * ## 大文字小文字だけの違いは、ここでは止めない
 *
 * `feature` → `Feature` は Git 側で通せる（main/git/gitBranches.ts が
 * 相手が自分自身であることを確かめたうえで通す）。ここで弾くと、
 * 通せる改名が画面の都合だけで押せなくなる。
 */
export function toGitBranchRenameReadiness(
  branch: GitLocalBranch,
  newName: string,
  operating: boolean,
  t: TFunction = DEFAULT_T
): GitActionReadiness {
  const prepared = prepareGitBranchName(newName)
  const problem = findGitBranchNameProblem(prepared)

  if (problem === 'empty') {
    return { enabled: false, note: t('git.branch.renameEmpty', { name: branch.name }) }
  }

  if (problem !== null) {
    return { enabled: false, note: describeGitBranchNameProblem(problem, t) }
  }

  if (prepared === branch.name) {
    return { enabled: false, note: t('git.branch.renameSame') }
  }

  return {
    enabled: !operating,
    note: t('git.branch.renameReady', { name: branch.name, newName: prepared })
  }
}

/**
 * 名前を受け付けられない理由の一言。
 *
 * 分類そのものは shared（`GitBranchNameProblem`）が持ち、ここは文言だけを持つ。
 * **何が使えないかを具体的に書く** ── 「使えない文字が含まれています」だけでは、
 * どれを消せばよいのかが分からない。
 */
export function describeGitBranchNameProblem(
  problem: GitBranchNameProblem,
  t: TFunction | number = DEFAULT_T
): string {
  const translate = typeof t === 'function' ? t : DEFAULT_T

  switch (problem) {
    case 'empty':
      return translate('git.branch.nameProblem.empty')

    case 'too-long':
      return translate('git.branch.nameProblem.tooLong')

    case 'invalid-characters':
      return translate('git.branch.nameProblem.invalidCharacters')

    case 'invalid-shape':
      return translate('git.branch.nameProblem.invalidShape')

    case 'reserved':
      return translate('git.branch.nameProblem.reserved')
  }
}
