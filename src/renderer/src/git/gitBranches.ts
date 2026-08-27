import { findGitBranchNameProblem, prepareGitBranchName } from '@shared/git'
import type { GitBranchNameProblem, GitLocalBranch } from '@shared/git'
import type { GitActionReadiness } from './gitChanges'

/**
 * ブランチの一覧と作成 → 画面に並べる形（React / DOM 非依存・テスト対象・Session 3-8-6）。
 *
 * gitChanges.ts が「変更の一覧」を、gitRepositoryMessage.ts が「使えない状態の
 * 文言」を持つのと同じ立ち位置で、こちらは**ブランチを選ぶ面の中身**を持つ。
 * GitBranchMenu.tsx に残るのは配置だけになる。
 *
 * ## ここで決めているのは4つ（Session 3-8-14 で1つ増えた）
 *
 *   1. 開いた面に何と出すか（読み込み中・失敗・1件も無い・切れている）
 *   2. 行を押せるか、押すと何が起きるか
 *   3. 打った名前でブランチを作れるか、作れないならなぜか
 *   4. その行を削除 / 改名できるか、できないならなぜか（3-8-14）
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
export function describeGitBranchList(state: GitBranchListState): string | null {
  switch (state.status) {
    case 'loading':
      return 'ブランチを取得しています…'

    case 'not-ready':
      return 'この Workspace では Git 操作を行えなくなりました。'

    case 'failed':
      return 'ブランチの一覧を取得できませんでした。'

    case 'ready':
      break
  }

  /*
    まだ1つも commit が無いリポジトリ（`git init` の直後）。ブランチ名は
    出ているのに一覧が空になるのはこの場合だけで、**失敗ではない** ──
    次の一手は「最初の Commit を作る」で、それはこの面ではなく下の Commit 欄にある。
  */
  return state.branches.length === 0
    ? 'まだブランチがありません。最初の Commit を作ると、このブランチが記録されます。'
    : null
}

/**
 * 一覧が切れていることの断り。切れていなければ null。
 *
 * **黙って切らない。** 一覧に出ていないブランチがあることを言わずに済ませると、
 * 利用者は「消えた」と読む。ここでできることまで案内する ── 出ていない
 * ブランチへ切り替えるには、今のところ Terminal パネルで `git switch` を使う
 * （名前を打って切り替える欄は作っていない。docs/ARCHITECTURE.md §14.15）。
 */
export function describeGitBranchTruncation(state: GitBranchListState): string | null {
  if (state.status !== 'ready' || !state.truncated) {
    return null
  }

  return `ブランチが多いため、先頭の ${state.branches.length.toLocaleString()} 件だけを表示しています。`
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
  operating: boolean
): GitActionReadiness {
  if (branch.current) {
    return { enabled: !operating, note: `${branch.name}（今このブランチに居ます）` }
  }

  return { enabled: !operating, note: `${branch.name} へ切り替えます。` }
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
export function toGitBranchCreateReadiness(name: string, operating: boolean): GitActionReadiness {
  const prepared = prepareGitBranchName(name)
  const problem = findGitBranchNameProblem(prepared)

  if (problem === 'empty') {
    return { enabled: false, note: '今の場所から新しいブランチを作って切り替えます。' }
  }

  if (problem !== null) {
    return { enabled: false, note: describeGitBranchNameProblem(problem) }
  }

  return { enabled: !operating, note: `${prepared} を作って切り替えます。` }
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
  operating: boolean
): GitActionReadiness {
  const prepared = prepareGitBranchName(name)
  const problem = findGitBranchNameProblem(prepared)

  if (problem === 'empty') {
    return { enabled: false, note: `${shortHash} から新しいブランチを作って切り替えます。` }
  }

  if (problem !== null) {
    return { enabled: false, note: describeGitBranchNameProblem(problem) }
  }

  return { enabled: !operating, note: `${shortHash} から ${prepared} を作って切り替えます。` }
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
  operating: boolean
): GitActionReadiness {
  if (branch.current) {
    return {
      enabled: false,
      note: `${branch.name} は現在チェックアウトされているため削除できません。`
    }
  }

  return { enabled: !operating, note: `${branch.name} を削除します。` }
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
export function describeGitBranchDeleteWarning(branch: GitLocalBranch): {
  readonly message: string
  readonly note: string
  readonly confirmLabel: string
} {
  return {
    message: `ブランチ「${branch.name}」を削除しますか？`,
    note: 'このブランチにしか無いコミットがある場合、Git が削除を中止します。取り消しはできません。',
    confirmLabel: '削除'
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
  operating: boolean
): GitActionReadiness {
  const prepared = prepareGitBranchName(newName)
  const problem = findGitBranchNameProblem(prepared)

  if (problem === 'empty') {
    return { enabled: false, note: `${branch.name} の新しい名前を入力してください。` }
  }

  if (problem !== null) {
    return { enabled: false, note: describeGitBranchNameProblem(problem) }
  }

  if (prepared === branch.name) {
    return { enabled: false, note: '新しい名前を入力してください。' }
  }

  return { enabled: !operating, note: `${branch.name} を ${prepared} に変更します。` }
}

/**
 * 名前を受け付けられない理由の一言。
 *
 * 分類そのものは shared（`GitBranchNameProblem`）が持ち、ここは文言だけを持つ。
 * **何が使えないかを具体的に書く** ── 「使えない文字が含まれています」だけでは、
 * どれを消せばよいのかが分からない。
 */
export function describeGitBranchNameProblem(problem: GitBranchNameProblem): string {
  switch (problem) {
    case 'empty':
      return 'ブランチ名を入力してください。'

    case 'too-long':
      return 'ブランチ名が長すぎます。'

    case 'invalid-characters':
      return 'ブランチ名に空白や ~ ^ : ? * [ \\ " < > | は使えません。'

    case 'invalid-shape':
      return 'この形のブランチ名は使えません（.. や / の位置、先頭の - や . をご確認ください）。'

    case 'reserved':
      return 'この名前は Git が別の意味で使うため、ブランチ名にできません。'
  }
}
