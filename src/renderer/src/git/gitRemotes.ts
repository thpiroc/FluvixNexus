import {
  findGitRemoteNameProblem,
  findGitRemoteUrlProblem,
  prepareGitRemoteName,
  prepareGitRemoteUrl
} from '@shared/git'
import type { GitRemote, GitRemoteNameProblem, GitRemoteUrlProblem } from '@shared/git'
import type { GitActionReadiness } from './gitChanges'
import { createTranslator, type TFunction } from '../i18n/messages'

const DEFAULT_T = createTranslator('ja')

/**
 * remote の一覧・追加・削除（Session 3-8-16）と、URL の変更・rename
 * （Session 3-8-17）→ 画面に並べる形（React / DOM 非依存・テスト対象）。
 *
 * gitChanges.ts が「変更の一覧」、gitBranches.ts が「ブランチを選ぶ面」、
 * gitStash.ts が「退避の面」を持つのと同じ立ち位置で、こちらは
 * **remote の面の中身**を持つ。GitRemoteOverlay.tsx に残るのは配置だけになる。
 *
 * ## ここで決めているのは6つ
 *
 *   1. 開いた面に何と出すか（読み込み中・失敗・1件も無い・切れている）
 *   2. 打った名前と URL で追加できるか、できないならなぜか
 *   3. その行を消せるか
 *   4. 消す前に何と尋ねるか
 *   5. 打った URL / 名前でその行を変えられるか、できないならなぜか（3-8-17）
 *   6. 送り先を変える前に何と尋ねるか（3-8-17）
 *
 * ## URL は今も片道のまま
 *
 * 3-8-17 で URL を打つ欄が2つめ（変更）できても、**一覧から URL が
 * 返ってくることは無い** ── 送り先を変える確認に出るのは、行が持っている
 * ラベルと、利用者が今その欄に打った文字列の2つになる
 * （`describeGitRemoteSetUrlWarning`）。したがってこのファイルには今も
 * 「URL を出す」関数が無い。
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
 *
 * 3-8-17 で2つ増えて4つになる。**操作ごとに別の目印にしてある**のは
 * ブランチ（切り替え / 作成 / 削除 / rename）と同じ形で、走っている操作の
 * 名前がそのままボタンの文字（「変更しています…」）を決めるためになる。
 */
export const GIT_ADD_REMOTE_OPERATION_KEY = 'add-remote'
export const GIT_REMOVE_REMOTE_OPERATION_KEY = 'remove-remote'
export const GIT_SET_REMOTE_URL_OPERATION_KEY = 'set-remote-url'
export const GIT_RENAME_REMOTE_OPERATION_KEY = 'rename-remote'

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
export function describeGitRemoteList(
  state: GitRemoteListState,
  t: TFunction = DEFAULT_T
): string | null {
  switch (state.status) {
    case 'loading':
      return t('git.remote.list.loading')

    case 'not-ready':
      return t('git.remote.list.notReady')

    case 'failed':
      return t('git.remote.list.failed')

    case 'ready':
      break
  }

  return state.remotes.length === 0 ? t('git.remote.list.empty') : null
}

/**
 * 一覧が切れていることの断り。切れていなければ null。
 *
 * **黙って切らない**（ブランチ・履歴・退避と同じ）。remote が上限を超える
 * ことは現実にはほぼ無いが、言わずに切ると利用者は「消えた」と読む ──
 * しかもここでの「消えた」は、Push の送り先が無くなったという意味に読まれる。
 */
export function describeGitRemoteTruncation(
  state: GitRemoteListState,
  t: TFunction = DEFAULT_T
): string | null {
  if (state.status !== 'ready' || !state.truncated) {
    return null
  }

  return t('git.remote.list.truncated', { count: state.remotes.length.toLocaleString() })
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
  operating: boolean,
  t: TFunction = DEFAULT_T
): GitActionReadiness {
  const preparedName = prepareGitRemoteName(name)
  const preparedUrl = prepareGitRemoteUrl(url)
  const nameProblem = findGitRemoteNameProblem(preparedName)
  const urlProblem = findGitRemoteUrlProblem(preparedUrl)

  if (nameProblem === 'empty' && urlProblem === 'empty') {
    return { enabled: false, note: t('git.remote.readiness.addEmpty') }
  }

  if (nameProblem !== null) {
    return { enabled: false, note: describeGitRemoteNameProblem(nameProblem, t) }
  }

  if (urlProblem !== null) {
    return { enabled: false, note: describeGitRemoteUrlProblem(urlProblem, t) }
  }

  /*
    何が起きるかを、**起きないことも含めて**言う ── 押した直後に
    ネットワークへ出ないこと（`--fetch` を渡していない）と、追跡先が
    付かないことは、押す前に読めた方がよい。どちらも「押したのに
    何も繋がらない」と読まれうるためになる（shared/ipc/contracts/git.ts）。
  */
  return {
    enabled: !operating,
    note: t('git.remote.readiness.addReady', { name: preparedName })
  }
}

/**
 * 打った URL で、その行の remote の送り先を変えられるか（Session 3-8-17）。
 *
 * ## 追加の欄とまったく同じ関数を通す
 *
 * `findGitRemoteUrlProblem` は追加の側と共有する（shared/git/remoteUrl.ts）──
 * 分けると「追加では通らないが変更では通る URL」が生まれ、`ext::sh -c …` を
 * 断っている根拠がその日に半分になる。Main 側も同じ関数を通す
 * （main/ipc/handlers/git.ts）。
 *
 * ## 名前は見ない
 *
 * 変えるのは URL だけで、対象は行が名指ししている ── 追加の欄が
 * 名前 → URL の順に見るのとは、そこが違う（打つ欄が1つしかない）。
 *
 * ## 「今と同じ URL か」は分からない
 *
 * 一覧に載るのはラベルだけで、**Renderer は今の URL を持っていない**
 * （shared/git/remote.ts）── したがって「変わりません」を出す手立ては
 * そもそも無い。同じ URL を渡しても git は成功として終わり、壊れるものも
 * 失われるものも無い（shared/ipc/contracts/git.ts）。
 *
 * ブランチの rename が「同じ名前は押せない」を出せたのは、比べる相手
 * （今の名前）が一覧の行に載っていたためになる ── 出せるものと出せない
 * ものの違いは、その1点で決まる。
 *
 * ## 空欄では理由を言わない
 *
 * 追加の欄と同じ形（`toGitRemoteAddReadiness`）── 打つ前から
 * 「入力してください」と出るのは、まだ何も間違えていない人に間違いを
 * 知らせる形になる。ただし**何をする欄なのかは言う**（開いた直後に
 * 空の欄だけが出ると、何を打つ場所か分からない）。
 */
export function toGitRemoteSetUrlReadiness(
  remote: GitRemote,
  url: string,
  operating: boolean,
  t: TFunction = DEFAULT_T
): GitActionReadiness {
  const preparedUrl = prepareGitRemoteUrl(url)
  const problem = findGitRemoteUrlProblem(preparedUrl)

  if (problem === 'empty') {
    return { enabled: false, note: t('git.remote.readiness.setUrlEmpty', { name: remote.name }) }
  }

  if (problem !== null) {
    return { enabled: false, note: describeGitRemoteUrlProblem(problem, t) }
  }

  /*
    押した後に**何が起きないか**まで言う ── 通信しないことと、手元の
    remote-tracking が前の送り先のまま残ることは、追加の欄と同じく
    押す前に読めた方がよい。詳しくは確認の面が言う
    （`describeGitRemoteSetUrlWarning`）。
  */
  return {
    enabled: !operating,
    note: t('git.remote.readiness.setUrlReady', { name: remote.name })
  }
}

/**
 * 打った名前で、その行の remote を改名できるか（Session 3-8-17）。
 *
 * ## 同じ名前は押せない
 *
 * ブランチの rename とまったく同じ形（`toGitBranchRenameReadiness`）──
 * 欄の初期値が今の名前なので、**開いた直後は必ずこの状態になる。**
 * だから理由は「間違い」ではなく「新しい名前を入力してください」と書く。
 *
 * ## 大文字小文字だけの違いも押せない ── ブランチとはここが逆になる
 *
 * `origin` → `Origin` は、ブランチ（3-8-14）では通せた（git に `--force` が
 * あり、相手が自分自身だと確かめたうえで立てている）。**`git remote rename`
 * にその引数は無い。**
 *
 * そして Windows で渡すと、git は `cannot lock ref` で落ちたうえに
 * **途中まで適用したまま**止まる ── 設定だけが新しい名前になり、refspec も
 * remote-tracking ref も追跡先も古い名前を指したまま残る（実物で確かめて
 * ある。main/git/gitRemoteRepository.test.ts）。つまり「押しても通らない」
 * ではなく「押すと壊れる」で、3-8-14 でチェックアウト中のブランチの削除を
 * 押せなくしたのより強い理由になる。
 *
 * 理由の文には**なぜ通らないか**まで書く ── 「使えません」だけだと、
 * 打ち直せば通ると読まれて同じところを何度も試すことになる。
 *
 * Main 側でも同じ判断をする（main/git/gitRemotes.ts）── 画面が古いまま
 * 押された1回で壊れないようにするための二重の備えで、3-8-14 の
 * 「同じ名前を打った」と同じ形になる。
 */
export function toGitRemoteRenameReadiness(
  remote: GitRemote,
  newName: string,
  operating: boolean,
  t: TFunction = DEFAULT_T
): GitActionReadiness {
  const prepared = prepareGitRemoteName(newName)
  const problem = findGitRemoteNameProblem(prepared)

  if (problem === 'empty') {
    return { enabled: false, note: t('git.remote.readiness.renameEmpty', { name: remote.name }) }
  }

  if (problem !== null) {
    return { enabled: false, note: describeGitRemoteNameProblem(problem, t) }
  }

  if (prepared === remote.name) {
    return { enabled: false, note: t('git.remote.readiness.renameSame') }
  }

  if (prepared.toLowerCase() === remote.name.toLowerCase()) {
    return {
      enabled: false,
      note: t('git.remote.readiness.renameCaseOnly')
    }
  }

  return {
    enabled: !operating,
    note: t('git.remote.readiness.renameReady', { name: remote.name, newName: prepared })
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
  operating: boolean,
  t: TFunction = DEFAULT_T
): GitActionReadiness {
  return { enabled: !operating, note: t('git.remote.readiness.removeReady', { name: remote.name }) }
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
export function describeGitRemoteRemoveWarning(
  remote: GitRemote,
  t: TFunction = DEFAULT_T
): {
  readonly message: string
  readonly note: string
  readonly confirmLabel: string
} {
  return {
    message: t('git.remote.warning.removeMessage', { name: remote.name }),
    note: t('git.remote.warning.removeNote'),
    confirmLabel: t('git.remote.warning.removeConfirm')
  }
}

/**
 * 送り先を変える前に出す文言（Session 3-8-17）。
 *
 * ## Git で確認を挟む、5つめ
 *
 * 1つめは破棄、2つめはブランチの削除、3つめは退避を捨てる、4つめは
 * remote の削除。**この5つの中で、失われるものが1つも無いのはここだけ**に
 * なる ── `git remote set-url` が書き換えるのは `remote.<名前>.url` の
 * 1行だけで、commit も ref も設定も何一つ消えない。
 *
 * ## それでも確認するのは、変更が「見えないところ」で効くため
 *
 * 3-8-16 が set-url を置かなかった理由は「上書きできること」ではなく
 * **「黙って上書きされること」**だった ── 送り先が入れ替わったことに
 * 誰も気づかないまま、次の Push が別のところへ飛ぶ。押す前に
 * 「今どこを指していて、これからどこを指すか」を並べれば、その理由は
 * そのまま解ける（docs/ARCHITECTURE.md §14.25）。
 *
 * ## 出すのは、ラベルと**利用者が今その欄に打った URL**
 *
 * 前者は一覧の行が持っているもの、後者は Renderer が手元に持っている
 * 文字列で、**どちらも新しく境界を渡ってきた値ではない** ──
 * 3-8-16 の「URL は Renderer へ渡さない」は1文字も動いていない。
 *
 * ## 手元に残るものを言う
 *
 * 削除の確認が「何が消えるか」を言うのに対し、こちらは**何が残るか**を
 * 言う ── `refs/remotes/<名前>/*` は前の送り先から取ってきたままで、
 * 画面の `↑2 ↓1` はしばらく**もう別の相手と比べた数**になる
 * （実物で確かめてある。main/git/gitRemoteRepository.test.ts）。
 * これがこの操作でいちばん読まれにくいことにあたる。
 *
 * 「危険です」とは書かない ── 打ち直せば元へ戻せる（削除と違い、
 * 戻すのに URL を覚えている必要すらない場面が多い）。**盛ると、本当に
 * 戻せない場面の警告まで軽く読まれる**（§14.23 / §14.24 と同じ判断）。
 */
export function describeGitRemoteSetUrlWarning(
  remote: GitRemote,
  url: string,
  t: TFunction = DEFAULT_T
): {
  readonly message: string
  readonly currentLabel: string
  readonly nextUrl: string
  readonly note: string
  readonly confirmLabel: string
} {
  return {
    message: t('git.remote.warning.setUrlMessage', { name: remote.name }),
    currentLabel: remote.label,
    nextUrl: prepareGitRemoteUrl(url),
    note: t('git.remote.warning.setUrlNote'),
    confirmLabel: t('git.remote.warning.setUrlConfirm')
  }
}

/**
 * 名前を受け付けられない理由の一言。
 *
 * 分類そのものは shared（`GitRemoteNameProblem`）が持ち、ここは文言だけを持つ。
 * **何が使えないかを具体的に書く** ── 「使えない文字が含まれています」だけでは、
 * どれを消せばよいのかが分からない（`describeGitBranchNameProblem` と同じ分担）。
 */
export function describeGitRemoteNameProblem(
  problem: GitRemoteNameProblem,
  t: TFunction = DEFAULT_T
): string {
  switch (problem) {
    case 'empty':
      return t('git.remote.nameProblem.empty')

    case 'too-long':
      return t('git.remote.nameProblem.tooLong')

    /*
      `.` を挙げてあるのはブランチ名との違いそのもの ── remote 名は
      `remote.<名前>.url` という設定のキーの真ん中に入るため、`.` が入ると
      後から扱えない名前になる（shared/git/remoteName.ts）。
    */
    case 'invalid-characters':
      return t('git.remote.nameProblem.invalidCharacters')

    case 'invalid-shape':
      return t('git.remote.nameProblem.invalidShape')

    case 'reserved':
      return t('git.remote.nameProblem.reserved')
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
export function describeGitRemoteUrlProblem(
  problem: GitRemoteUrlProblem,
  t: TFunction = DEFAULT_T
): string {
  switch (problem) {
    case 'empty':
      return t('git.remote.urlProblem.empty')

    case 'too-long':
      return t('git.remote.urlProblem.tooLong')

    case 'invalid-characters':
      return t('git.remote.urlProblem.invalidCharacters')

    case 'unsupported-scheme':
      return t('git.remote.urlProblem.unsupportedScheme')

    case 'credentials':
      return t('git.remote.urlProblem.credentials')

    case 'invalid-shape':
      return t('git.remote.urlProblem.invalidShape')
  }
}
