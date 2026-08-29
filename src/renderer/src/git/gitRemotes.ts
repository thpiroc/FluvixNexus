import {
  findGitRemoteNameProblem,
  findGitRemoteUrlProblem,
  prepareGitRemoteName,
  prepareGitRemoteUrl
} from '@shared/git'
import type { GitRemote, GitRemoteNameProblem, GitRemoteUrlProblem } from '@shared/git'
import type { GitActionReadiness } from './gitChanges'

/**
 * remote の一覧と追加 → 画面に並べる形（React / DOM 非依存・テスト対象・
 * Session 3-8-16）。
 *
 * gitChanges.ts が「変更の一覧」、gitBranches.ts が「ブランチを選ぶ面」、
 * gitStash.ts が「退避の面」を持つのと同じ立ち位置で、こちらは
 * **remote の面の中身**を持つ。GitRemoteOverlay.tsx に残るのは配置だけになる。
 *
 * ## ここで決めているのは4つ
 *
 *   1. 開いた面に何と出すか（読み込み中・失敗・1件も無い・切れている）
 *   2. 打った名前と URL で追加できるか、できないならなぜか
 *   3. その行を消せるか
 *   4. 消す前に何と尋ねるか
 *
 * 2 の判断は shared の関数（`findGitRemoteNameProblem` /
 * `findGitRemoteUrlProblem`）に委ねてある ── Main が受け取った後に通すのと
 * **同じ関数**で、ここが持つのは文言だけになる（ブランチ名で
 * `describeGitBranchNameProblem` が持っているのと同じ分担）。
 *
 * ## 「既にある名前か」はここで見ない
 *
 * 一覧は手元にあるので突き合わせることはできるが、しない ── ブランチの
 * 作成欄とまったく同じ判断で、一覧は**切れていることがある**（`truncated`）。
 * 押した結果として Main が `remote-exists` を返す（shared/git/operation.ts）。
 *
 * ## URL は画面に出ない
 *
 * 一覧の行に出るのは名前と**表示用のラベル**だけで、URL はそもそも
 * Renderer へ届かない（shared/git/remote.ts）── したがってこのファイルにも
 * 「URL を出す」関数が無い。打ち込んだ URL は追加のときに1度渡って、
 * 戻ってこない。
 */

/**
 * remote の操作の目印（`toGitOperationKey` が作るものと同じ枠に入る）。
 *
 * ブランチの削除 / rename・退避と同じく、**対象を目印に含めない**（3-8-14）──
 * 面の中で開ける確認は一度に1つで、2件目を押せる場面がそもそも無い。
 * 名前を混ぜると、目印が「押せるかどうか」の役に立たなくなるだけになる。
 */
export const GIT_ADD_REMOTE_OPERATION_KEY = 'add-remote'
export const GIT_REMOVE_REMOTE_OPERATION_KEY = 'remove-remote'

/**
 * 追加の欄に最初から入れておく名前。
 *
 * `origin` は「1つめの remote」の慣習の名前で、**予約語ではない**
 * （shared/git/remoteName.ts）── 消して別の名前を打てる。初期値を
 * 置いてあるのは、1つめを足す人にとってここが考えるところではないため
 * （GitHub の公開で repository 名の初期値を入れてあるのと同じ形）。
 */
export const GIT_DEFAULT_REMOTE_NAME = 'origin'

/**
 * 一覧の今の姿（フックが持つ形）。
 *
 * `loading` を分けているのは、開いた瞬間に「remote はありません」と
 * 出さないため（`GitBranchListState` / `GitStashListState` と同じ理由）。
 */
export interface GitRemoteListState {
  readonly status: 'loading' | 'ready' | 'not-ready' | 'failed'
  readonly remotes: readonly GitRemote[]
  /** 上限（`GIT_REMOTE_LIMIT`）で切られたか。 */
  readonly truncated: boolean
}

/** 開いた直後の姿（まだ何も届いていない）。 */
export const INITIAL_GIT_REMOTE_LIST: GitRemoteListState = {
  status: 'loading',
  remotes: [],
  truncated: false
}

/**
 * 一覧の代わりに出す一言。行が出せるなら null。
 *
 * **行と一言を同時に出さない**（ブランチ・履歴・退避と同じ判断）。
 *
 * 1件も無いときの文は**次の一手を含める** ── この面には下に追加の欄が
 * 在るので、行き先はその場にある（退避の面と同じ形）。
 */
export function describeGitRemoteList(state: GitRemoteListState): string | null {
  switch (state.status) {
    case 'loading':
      return 'リモートを取得しています…'

    case 'not-ready':
      return 'この Workspace では Git 操作を行えなくなりました。'

    case 'failed':
      return 'リモートの一覧を取得できませんでした。'

    case 'ready':
      break
  }

  return state.remotes.length === 0
    ? 'まだリモートがありません。下の欄に名前と URL を入れると、既にあるリポジトリに接続できます。'
    : null
}

/**
 * 一覧が切れていることの断り。切れていなければ null。
 *
 * **黙って切らない**（ブランチ・履歴・退避と同じ）。remote が上限を超える
 * ことは現実にはほぼ無いが、言わずに切ると利用者は「消えた」と読む ──
 * しかもここでの「消えた」は、Push の送り先が無くなったという意味に読まれる。
 */
export function describeGitRemoteTruncation(state: GitRemoteListState): string | null {
  if (state.status !== 'ready' || !state.truncated) {
    return null
  }

  return `リモートが多いため、先頭の ${state.remotes.length.toLocaleString()} 件だけを表示しています。`
}

/**
 * 打った名前と URL で remote を追加できるか、できないならなぜか。
 *
 * ## 見る順番に意味がある
 *
 * 名前 → URL の順に見る。**上の欄から順に直せる**ようにするためで、
 * 打っている人の目は上から下へ動く ── URL の問題を先に出すと、
 * 名前を直した後にもう一度同じ場所を読み直すことになる。
 *
 * ## 両方が空のときだけ理由を言わない
 *
 * ブランチの作成欄と同じ形（`toGitBranchCreateReadiness`）── 打つ前から
 * 「入力してください」と出るのは、まだ何も間違えていない人に間違いを
 * 知らせる形になる。片方だけ打たれている場合は、もう片方を促す。
 *
 * ## 通る URL の形は3つだけ
 *
 * `https://…` / `ssh://…` / `user@host:path`（shared/git/remoteUrl.ts）。
 * ここで断る形の中には危なくないもの（`git://`・ローカルのパス）も
 * 含まれるので、**文言では「使える形」を先に言う** ── 断られた人が
 * 次に打つべきものが、断り文の中に居るようにする。
 */
export function toGitRemoteAddReadiness(
  name: string,
  url: string,
  operating: boolean
): GitActionReadiness {
  const preparedName = prepareGitRemoteName(name)
  const preparedUrl = prepareGitRemoteUrl(url)
  const nameProblem = findGitRemoteNameProblem(preparedName)
  const urlProblem = findGitRemoteUrlProblem(preparedUrl)

  if (nameProblem === 'empty' && urlProblem === 'empty') {
    return { enabled: false, note: '名前と URL を入れると、リモートを1つ登録します。' }
  }

  if (nameProblem !== null) {
    return { enabled: false, note: describeGitRemoteNameProblem(nameProblem) }
  }

  if (urlProblem !== null) {
    return { enabled: false, note: describeGitRemoteUrlProblem(urlProblem) }
  }

  /*
    何が起きるかを、**起きないことも含めて**言う ── 押した直後に
    ネットワークへ出ないこと（`--fetch` を渡していない）と、追跡先が
    付かないことは、押す前に読めた方がよい。どちらも「押したのに
    何も繋がらない」と読まれうるためになる（shared/ipc/contracts/git.ts）。
  */
  return {
    enabled: !operating,
    note: `${preparedName} として登録します（この時点では通信しません）。`
  }
}

/**
 * その行の remote を消せるか。
 *
 * ## 押す前に分かる「絶対に通らない理由」が1つも無い
 *
 * ブランチの削除で「今チェックアウト中」だけを押せなくしたような事情が、
 * remote には無い ── 追っているブランチが在っても git は消すし、
 * それを止めると**消したいのに消せない remote** が生まれる
 * （main/git/gitRemotes.ts）。退避の drop と同じ側になる。
 *
 * ## 止めるのは、他の Git 操作が動いている間だけ
 *
 * 消えるのは設定と remote-tracking ref で、**今まさに走っている Push /
 * Pull の送り先**でもありうる。行の `＋` / `−` が押した対象だけを止めるのとは
 * 性質が違う（Commit / Push と同じ扱いにする）。
 */
export function toGitRemoteRemoveReadiness(
  remote: GitRemote,
  operating: boolean
): GitActionReadiness {
  return { enabled: !operating, note: `${remote.name} を削除します。` }
}

/**
 * 消す前に出す文言（Session 3-8-16）。
 *
 * ## Git で確認を挟む、4つめ
 *
 * 1つめは破棄（§14.16）、2つめはブランチの削除（§14.22）、3つめは
 * 退避を捨てる（§14.23）。**この4つの中でいちばん軽いのがここ**になる ──
 * 消えるのは設定と、手元に持っていた remote-tracking ref だけで、
 * **commit は1つも失われない。**
 *
 * ## それでも確認するのは、追跡先が消えるため
 *
 * `git remote remove` は `branch.<名前>.remote` / `.merge` まで消す
 * （実物で確かめてある。main/git/gitRemoteRepository.test.ts）── つまり
 * 押した後、画面の `↑2 ↓1` が消え、Push は「初回の Push」に戻る。
 * それは押した人が予想していないことになる。
 *
 * ## 盛らずに書く
 *
 * 「失われます」とは書かない ── 同じ URL でもう一度足せば、次の fetch で
 * remote-tracking ref は戻る。**戻せるものを戻せないと書くと、本当に
 * 戻せない場面（退避を捨てる）の警告まで軽く読まれる**（§14.23 と同じ判断）。
 */
export function describeGitRemoteRemoveWarning(remote: GitRemote): {
  readonly message: string
  readonly note: string
  readonly confirmLabel: string
} {
  return {
    message: `リモート「${remote.name}」を削除しますか？`,
    note: 'このリモートを追跡していたブランチの追跡先も外れます。コミットは失われません。同じ URL で登録し直せます。',
    confirmLabel: '削除'
  }
}

/**
 * 名前を受け付けられない理由の一言。
 *
 * 分類そのものは shared（`GitRemoteNameProblem`）が持ち、ここは文言だけを持つ。
 * **何が使えないかを具体的に書く** ── 「使えない文字が含まれています」だけでは、
 * どれを消せばよいのかが分からない（`describeGitBranchNameProblem` と同じ分担）。
 */
export function describeGitRemoteNameProblem(problem: GitRemoteNameProblem): string {
  switch (problem) {
    case 'empty':
      return 'リモート名を入力してください。'

    case 'too-long':
      return 'リモート名が長すぎます。'

    /*
      `.` を挙げてあるのはブランチ名との違いそのもの ── remote 名は
      `remote.<名前>.url` という設定のキーの真ん中に入るため、`.` が入ると
      後から扱えない名前になる（shared/git/remoteName.ts）。
    */
    case 'invalid-characters':
      return 'リモート名に空白や . ~ ^ : ? * [ \\ " < > | は使えません。'

    case 'invalid-shape':
      return 'この形のリモート名は使えません（先頭の - や / の位置をご確認ください）。'

    case 'reserved':
      return 'この名前は Git が別の意味で使うため、リモート名にできません。'
  }
}

/**
 * URL を受け付けられない理由の一言。
 *
 * ## `unsupported-scheme` の文言に、使える形を全部書く
 *
 * ここで断られる形には**危なくないものも含まれる**（`git://`・`http://`・
 * ローカルのパス）── 「危険です」とは書けないし、書くべきでもない。
 * 書くのは「このアプリが受け付ける形」で、断られた人が次に打つものが
 * その文の中に居るようにする。
 *
 * ## `credentials` を別の文にする
 *
 * 次の一手がまったく違うため ── こちらは「打ち直す」ではなく
 * 「認証の部分を消す」になる。アプリが token を `.git/config` へ書かない
 * という判断（設計判断 7）が、利用者から見える形になるのはここだけにあたる。
 */
export function describeGitRemoteUrlProblem(problem: GitRemoteUrlProblem): string {
  switch (problem) {
    case 'empty':
      return 'リモートの URL を入力してください。'

    case 'too-long':
      return 'URL が長すぎます。'

    case 'invalid-characters':
      return 'URL に空白や制御文字は使えません。'

    case 'unsupported-scheme':
      return 'この形の URL は登録できません。https://… / ssh://… / user@host:path のいずれかで入力してください。'

    case 'credentials':
      return 'URL に認証情報を含めることはできません。ユーザー名やトークンを除いた URL を入力してください（認証は Git の credential helper が扱います）。'

    case 'invalid-shape':
      return 'URL にホストかリポジトリの場所が足りません（例: https://github.com/owner/repo.git）。'
  }
}
