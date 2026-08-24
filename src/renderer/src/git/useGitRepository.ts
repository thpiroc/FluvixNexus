import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  GitDiscardTarget,
  GitFileDiff,
  GitOperationFailure,
  GitOperationOutcome,
  GitRepositoryState,
  GitStageTarget
} from '@shared/git'
import type { GitHubRepositoryVisibility } from '@shared/github'
import type { GitOperationResponse, IpcResult } from '@shared/ipc'
import { fluvix } from '../api/fluvix'
import { useWorkspaceFolder } from '../workspaceFolder/context'
import type { GitDiffRequest } from './gitDiff'
import {
  GIT_CREATE_BRANCH_OPERATION_KEY,
  GIT_SWITCH_BRANCH_OPERATION_KEY,
  INITIAL_GIT_BRANCH_LIST,
  type GitBranchListState
} from './gitBranches'
import {
  GIT_COMMIT_AND_PUSH_OPERATION_KEY,
  GIT_COMMIT_OPERATION_KEY,
  GIT_INIT_OPERATION_KEY,
  GIT_PULL_OPERATION_KEY,
  GIT_PUSH_OPERATION_KEY,
  toGitOperationKey
} from './gitChanges'
import {
  GITHUB_PUBLISH_OPERATION_KEY,
  INITIAL_GITHUB_STATUS,
  toGitHubStatusState,
  type GitHubStatusState
} from './githubPublish'

/**
 * Git リポジトリの状態を保持し、いつ調べ直すかを決める（Session 3-8-1 / 3-8-2 /
 * 3-8-3 / 3-8-4 / 3-8-5 / 3-8-6 / 3-8-8 / 3-8-9 / 3-8-10）。
 *
 * Renderer 側で git ドメインの IPC を呼ぶ唯一の場所になる
 * （WorkspaceFolderProvider が workspace-folder ドメインに対して果たしている役と同じ）。
 *
 * ## 調べる契機
 *
 * | 契機                     | このフックでの現れ方                       |
 * | ------------------------ | ------------------------------------------ |
 * | Git パネルを出した       | 最初の描画（このフックが動き出す時点）     |
 * | Workspace の切り替え     | `workspace.id` が変わったら調べ直す        |
 * | 利用者の手動更新         | `refresh()`                                |
 * | 作業ツリーのファイル変化 | `files:changed`（Session 3-8-2 で追加）    |
 * | `.git` の変化            | `git:changed`（Session 3-8-8 で追加）      |
 *
 * **`.git` は見張るようになった（Session 3-8-8）。** 3-8-7 までは見張っておらず、
 * 端末で `git add` / `git commit` / `git switch` した結果は手で更新するまで
 * 届かなかった ── 内蔵 Terminal がある以上、その「手で更新するまで」は
 * **同じアプリの中の操作に対して**起きることになる。見張るのは Main 側の
 * 専用の watcher（main/git/gitWatcher.ts）で、`files:changed` の除外規則
 * （main/files/ignoredDirectories.ts）には穴を開けていない。
 *
 * ## `files:changed` を購読するようになった理由
 *
 * Session 3-8-1 では購読していなかった。出していたのがブランチ名だけで、
 * それは作業ツリーのファイルが変わっても動かないためになる。
 *
 * Session 3-8-2 で変更ファイルの一覧が入ったことで事情が変わった ── 保存するたび、
 * ファイルを1つ作るたびに一覧は変わる。手で更新しない限り古いままの一覧は、
 * **変更したのに出てこない**という形で嘘をつくことになる。
 *
 * 拾えるのは作業ツリー側だけで、index 側（`git add`）とブランチの切り替えは
 * この経路には載らない ── そちらを運ぶのが Session 3-8-8 の `git:changed` になる。
 * **どちらも同じタイマーへ合流させる**（下の useEffect）。
 *
 * **手動の更新は残してある。** 監視は失敗しうる（再帰監視が使えない OS・
 * 権限が無い・ネットワークドライブ）し、失敗しても Git パネルは立っている
 * べきものにあたる ── 自動で追いつかない環境で、押す先が1つも無い形にしない。
 *
 * 束ねてから1回だけ調べるのは、保存1回で複数の変化が届くため。押し寄せるたびに
 * git を起動すると、プロセスの起動が変化の速さに追いつかなくなる。
 *
 * ## ブランチの一覧だけは、別の契機で取る（Session 3-8-6）
 *
 * 上の表に載っているのは**リポジトリの状態**の話で、ブランチの一覧はそこに
 * 入らない ── 取り直すのは「選ぶ面を開いたとき」だけになる。
 *
 * 状態に相乗りさせると、ファイルを保存するたびにブランチを数え直すことになる
 * （見えているのは面が開いている間だけなのに）。`.git` を見張るようになった
 * Session 3-8-8 でも同じで、`git:changed` からブランチを数え直すことはしない ──
 * **面を開いたときに必ず取り直す**方が、届く合図の数に依らず新しいものが出る。
 *
 * ## 状態をパネルの中で持つ
 *
 * Terminal（TerminalProvider）や Editor（EditorProvider）と違い、Shell の外側へ
 * 持ち上げていない。あちらが外に居るのは、**パネルより長く生きる必要のあるもの**
 * （OS のプロセス・未保存の Model）を抱えているためで、こちらが持っているのは
 * 調べ直せば済む写しでしかない。パネルを畳めば消え、開けば調べ直す ──
 * それがそのまま「パネルを出したときに調べる」という契機になっている。
 *
 * ## 行き違った答えを捨てる
 *
 * 問い合わせている間に Workspace が切り替わりうるため、応答に載っている
 * `workspaceId` を今のものと突き合わせる（shared/ipc/contracts/git.ts）。
 * 突き合わせずに書き込むと、切り替え直後に**前の Workspace のブランチ名**が
 * 一瞬出る。
 */

export interface GitRepositoryController {
  /** 最初の問い合わせが済んだか。'loading' の間は案内も中身も出さない。 */
  readonly status: 'loading' | 'ready'
  readonly repository: GitRepositoryState
  /** 調べ直している最中か（更新ボタンの二重押しを止める）。 */
  readonly busy: boolean
  /** 利用者による調べ直し。 */
  readonly refresh: () => void
  /**
   * 今動いている操作の目印（Session 3-8-3）。
   *
   * 中身は `toGitOperationKey` が作る文字列で、押した行・押したグループの
   * ボタンだけを押せなくするために使う（gitChanges.ts）。
   *
   * **パネル全体を止めない。** 1件の Stage で一覧ごと押せなくすると、
   * 複数のファイルを続けて Stage するという普通の使い方が、
   * 1件ずつ待たされる作業になる。
   *
   * **Commit だけは例外**（Session 3-8-4）。Commit ボタンは、この集合が
   * 空でない限り押せない ── Commit の中身は「ステージ済み」の全体で、
   * 走っている Stage / Unstage はまさにその中身を変えている最中にあたる
   * （GitView.tsx）。1行の操作が1行にしか効かないのとは性質が違う。
   */
  readonly pending: ReadonlySet<string>
  /**
   * 直近の操作が通り切らなかった結末（通ったら消える）。
   *
   * 分類だけでなく**結末ごと**持つ（Session 3-8-5）── Commit & Push が
   * 途中で止まった場合、先に伝えるべきなのは「Commit は済んでいる」で、
   * 同じ分類でも言うことが違う（gitChanges.ts）。
   */
  readonly failure: GitOperationFailure | null
  /**
   * 今の Workspace を Git リポジトリにする（Session 3-8-10）。
   *
   * 経路は Stage / Commit / Push とまったく同じ（`operate`）で、要求に載る値が
   * **1つも無い**ところだけが違う。初期化のための別の道は作っていない。
   *
   * **確認を挟むのはここではない。** 押してよいかを尋ねるのは面の側で
   * （GitInitConfirm.tsx）、ここへ来るのは既に尋ね終えたものになる ──
   * 破棄（`discard`）と同じ分担にしてある。
   *
   * 結末を返さない ── 通ったかどうかは**画面そのもの**に出る（案内が消え、
   * 変更の一覧と Commit 欄が現れる）。
   */
  readonly init: () => void
  /** index に載せる。 */
  readonly stage: (target: GitStageTarget) => void
  /** index から外す（作業ツリーには触らない）。 */
  readonly unstage: (relativePath: string) => void
  /**
   * 作業ツリーの変更を破棄する（Session 3-8-9）。
   *
   * 経路は Stage / Unstage とまったく同じ（`operate`）で、鍵も同じ
   * （`path:<位置>`。gitChanges.ts）── 同じ行に対する操作が2本同時に走らない。
   *
   * **確認を挟むのはここではない。** 押してよいかを尋ねるのは面の側で
   * （GitDiscardConfirm.tsx）、ここへ来るのは既に尋ね終えたものになる ──
   * 「確認を出す」と「git を動かす」を1つの関数に畳むと、確認を出さずに
   * 呼べる経路が後から生えたときに気づけない。
   */
  readonly discard: (target: GitDiscardTarget) => void
  /**
   * 1行の差分を取りに行く（Session 3-8-9）。
   *
   * ## 一覧の読み直し（`load`）と別の状態にしてある
   *
   * 差分は**利用者が1行を選んだ一瞬**しか見られないため、一覧のように
   * 変化のたびに読み直す形にはしない（相乗りさせると、保存のたびに
   * 誰も見ていない中身を読むことになる）。
   *
   * `diff` が null の間は取得中。面はその間も出しておく
   * （GitDiffOverlay.tsx）。
   */
  readonly diffRequest: GitDiffRequest | null
  readonly diff: GitFileDiff | null
  readonly openDiff: (request: GitDiffRequest) => void
  readonly closeDiff: () => void
  /**
   * ステージ済みの変更を Commit する（Session 3-8-4）。
   *
   * **通ったかどうかを返す**のがここだけ違う。Stage / Unstage の結末は
   * 一覧そのものに出るが、Commit の結末には**入力欄を空にするか**という
   * 画面側の判断がぶら下がっている（GitView.tsx）── 通ったら消す、
   * 通らなかったら残す。書いた文章を失敗のたびに消されるのは、
   * このパネルでいちばん起きてほしくないことにあたる。
   */
  readonly commit: (message: string) => Promise<boolean>
  /**
   * 今のブランチを追跡先へ送る（Session 3-8-5）。
   *
   * 引数が無い ── 送り先を決めるのはリポジトリの設定で、Renderer からは
   * remote 名もブランチ名も渡さない（shared/ipc/contracts/git.ts）。
   */
  readonly push: () => void
  /** 追跡先の変更を取り込む（Session 3-8-5）。 */
  readonly pull: () => void
  /**
   * Commit してから Push する（Session 3-8-5）。
   *
   * `commit` と同じく**入力欄を空にしてよいか**を返す。返すのは
   * 「Commit が作られたか」であって「Push まで通ったか」ではない ──
   * Push だけが失敗した場合（`partly-applied`）、その文章は既に履歴に
   * 記録されているため、欄に残すと同じ内容をもう一度 Commit しかねない。
   */
  readonly commitAndPush: (message: string) => Promise<boolean>
  /**
   * ローカルブランチの一覧（Session 3-8-6）。
   *
   * **リポジトリの状態とは別に持つ。** `repository` の中に入れると、
   * ファイルを保存するたび（`files:changed` からの読み直し）にブランチを
   * 数え直すことになる ── 見えているのは面を開いている間だけなので、
   * 取り直す契機もそこに合わせてある（shared/ipc/contracts/git.ts）。
   */
  readonly branches: GitBranchListState
  /** 一覧を取り直す（面を開いたときに呼ぶ）。 */
  readonly refreshBranches: () => void
  /**
   * 別のローカルブランチへ切り替える（Session 3-8-6）。
   *
   * 結末を返さない ── 通ったかどうかは**画面そのもの**に出る（バーの
   * ブランチ名が変わり、一覧が入れ替わる）。Commit のように
   * 「入力欄を空にしてよいか」がぶら下がっていない。
   */
  readonly switchBranch: (name: string) => void
  /**
   * 新しいブランチを作って、そこへ切り替える（Session 3-8-6）。
   *
   * `commit` と同じく**通ったかどうかを返す** ── 打った名前を消してよいか、
   * 面を閉じてよいかという画面側の判断がぶら下がっているため
   * （GitBranchMenu.tsx）。失敗のたびに名前を消されると、
   * 「同じ名前が既にあります」と言われた人が打ち直すことになる。
   */
  readonly createBranch: (name: string) => Promise<boolean>
  /**
   * GitHub CLI が使える状態か（Session 3-8-10）。
   *
   * **リポジトリの状態とは別に持つ。** `repository` の中に入れると、
   * ファイルを保存するたびに gh を1回起動することになる ── 見えているのは
   * 公開の面を開いている間だけなので、取り直す契機もそこに合わせてある
   * （ブランチの一覧とまったく同じ判断。shared/ipc/contracts/github.ts）。
   */
  readonly githubStatus: GitHubStatusState
  /** gh の状態を取り直す（面を開いたとき・「もう一度確認する」）。 */
  readonly refreshGitHubStatus: () => void
  /**
   * 今のリポジトリを GitHub へ公開する（Session 3-8-10）。
   *
   * 経路は Commit / Push とまったく同じ（`operate`）で、**外へ出る操作のための
   * 別の道は作っていない** ── 二重の要求を止める仕組みも、応答に載っている
   * 操作後の状態をそのまま使う決めごとも共通になる。
   *
   * `commit` と同じく**通ったかどうかを返す** ── 打った名前を消してよいか、
   * 面を閉じてよいかという画面側の判断がぶら下がっているため
   * （GitHubPublishForm.tsx）。`partly-applied`（repository は作られたが
   * Push が通らなかった）も「通った」側として返す ── 外に物ができている
   * 以上、同じ名前でもう一度押しても断られるだけになる。
   */
  readonly publishToGitHub: (
    name: string,
    visibility: GitHubRepositoryVisibility
  ) => Promise<boolean>
}

/**
 * 問い合わせる前の値。
 *
 * 'loading' の間はこれを見せないため、何であってもよい。`no-workspace` を
 * 置いているのは、**万一出てしまっても嘘にならない**もっとも無害な状態だから。
 */
const INITIAL_REPOSITORY: GitRepositoryState = { status: 'no-workspace' }

/**
 * ファイルの変化を束ねる時間。
 *
 * 保存1回でも変化は複数届き、フォルダをまとめて消せばその数だけ届く。
 * ここで束ねずに git を起動すると、プロセスの起動が変化に追いつかない。
 *
 * 0.4 秒にしてあるのは、**保存した直後に一覧を見に行っても間に合う**長さで、
 * かつ連続した保存を1回にまとめられる長さだから。
 */
const CHANGE_SETTLE_MS = 400

export function useGitRepository(): GitRepositoryController {
  const { status: workspaceStatus, workspace } = useWorkspaceFolder()
  const [state, setState] = useState<{
    readonly status: 'loading' | 'ready'
    readonly repository: GitRepositoryState
  }>({ status: 'loading', repository: INITIAL_REPOSITORY })
  const [busy, setBusy] = useState(false)

  /**
   * 今動いている操作の目印（Session 3-8-3）。
   *
   * state と ref の両方に持つ ── 描き直すために state が要り、
   * **描き直しを待たずに二重の要求を止める**ために ref が要る。
   * state だけだと、押した直後に届いた2つ目の要求が古い写しを見て通ってしまう。
   */
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set())
  const pendingRef = useRef<ReadonlySet<string>>(pending)

  /** 直近の操作が通り切らなかった結末。次の操作が通れば消える。 */
  const [failure, setFailure] = useState<GitOperationFailure | null>(null)

  /**
   * ローカルブランチの一覧（Session 3-8-6）。
   *
   * 面を開くたびに取り直すため、閉じている間の中身は使われない。
   * それでも**捨てずに持っている**のは、開いた瞬間に前の中身が一瞬見えるより、
   * 「取得しています…」から始まる方が読みやすいため（`refreshBranches` が
   * 最初に `loading` へ戻す）。
   */
  const [branches, setBranches] = useState<GitBranchListState>(INITIAL_GIT_BRANCH_LIST)

  /**
   * 一覧の問い合わせの通し番号。
   *
   * リポジトリの状態（`requestRef`）とは**別に持つ** ── 一覧は
   * 状態の読み直しとは違う契機（面を開く）で走り、片方の追い越しが
   * もう片方を捨てさせる形にはしない。
   */
  const branchRequestRef = useRef(0)

  /**
   * GitHub CLI の状態（Session 3-8-10）。
   *
   * ブランチの一覧とまったく同じ扱いで、**面を開くたびに取り直す。**
   * 覚えておいたものを出すと、「gh を入れた直後なのに『見つかりません』のまま」
   * が起きる ── そこがいちばん起こりやすい場面にあたる。
   */
  const [githubStatus, setGitHubStatus] = useState<GitHubStatusState>(INITIAL_GITHUB_STATUS)

  /** gh の問い合わせの通し番号（一覧・差分と同じ理由で別に持つ）。 */
  const githubRequestRef = useRef(0)

  /**
   * 今どの行の差分を見ているか（Session 3-8-9）。
   *
   * 閉じているときは null。**中身（`diff`）と別の状態にしてある**のは、
   * 面を先に出して「読み込んでいます…」から始めるため ── 取れてから
   * 出す形にすると、押してから面が現れるまで押したことが画面に出ない。
   */
  const [diffRequest, setDiffRequest] = useState<GitDiffRequest | null>(null)
  const [diff, setDiff] = useState<GitFileDiff | null>(null)

  /**
   * 差分の問い合わせの通し番号。
   *
   * ブランチの一覧（`branchRequestRef`）と同じ理由で**別に持つ** ── 差分は
   * 一覧の読み直しとは違う契機（行を押す）で走り、しかも大きなファイルでは
   * 遅い。追い越されたものが後から届いて、別の行の差分として出るのを止める。
   */
  const diffRequestRef = useRef(0)

  /** 今どの Workspace を見ているか。応答が行き違ったときの突き合わせに使う。 */
  const workspaceId = workspace?.id ?? null
  const workspaceIdRef = useRef(workspaceId)
  workspaceIdRef.current = workspaceId

  /**
   * 問い合わせの通し番号。
   *
   * 「実行中なら弾く」形にしないのは、**Workspace の切り替えが実行中に
   * 起きうる**ため。弾いてしまうと、切り替え後の問い合わせが始まらないまま
   * 'loading' で止まる。後から始めたものを常に勝たせる形にしておけば、
   * 追い越しも行き違いも同じ1つの規則で片が付く。
   */
  const requestRef = useRef(0)

  /**
   * 1回分の問い合わせ。
   *
   * 失敗しても画面は動く ── IPC そのものが失敗するのは経路の異常で、
   * その場合も Git パネルは「取得できませんでした」を出して立っていればよい。
   *
   * `quiet` はファイルの変化から始まった問い合わせに付ける。利用者が押したのでは
   * ないものまで更新ボタンを押せなくすると、**保存するたびにボタンが点滅する** ──
   * 押せない見た目は「今その操作を待っている」という意味に取っておきたい。
   */
  const load = useCallback(async (options?: { readonly quiet?: boolean }): Promise<void> => {
    const quiet = options?.quiet === true
    const requestId = requestRef.current + 1
    requestRef.current = requestId

    if (!quiet) {
      setBusy(true)
    }

    try {
      const result = await fluvix.git.getRepository()

      // 追い越された。新しい方の答えが来る。
      if (requestRef.current !== requestId) {
        return
      }

      if (!result.ok) {
        console.warn('[git] リポジトリの状態を取得できませんでした。', result.error)
        setState({ status: 'ready', repository: { status: 'failed', reason: 'unknown' } })
        return
      }

      // 問い合わせている間に Workspace が切り替わっていたら捨てる。
      if (result.data.workspaceId !== workspaceIdRef.current) {
        return
      }

      setState({ status: 'ready', repository: result.data.repository })
    } finally {
      if (!quiet && requestRef.current === requestId) {
        setBusy(false)
      }
    }
  }, [])

  /*
    最初の描画と、Workspace が変わったとき。
    `workspaceId` を依存に置いてあるので、切り替えのたびに調べ直す。
  */
  useEffect(() => {
    // Workspace の取得が済むまでは調べない（未選択と区別が付かないため）。
    if (workspaceStatus === 'loading') {
      return
    }

    setState({ status: 'loading', repository: INITIAL_REPOSITORY })
    // 前の Workspace で出ていた操作の理由を持ち越さない（指している一覧が別のものになる）。
    setFailure(null)
    // ブランチの一覧も同じ理由で捨てる（別のリポジトリのブランチが一瞬見える）。
    setBranches(INITIAL_GIT_BRANCH_LIST)
    /*
      開いていた差分も閉じる（Session 3-8-9）。

      同じ位置のファイルが切り替え先にも在ることは普通にあり、閉じないと
      **別のリポジトリの中身が、前のリポジトリの見出しのまま**残る。
      通し番号も進めて、飛んでいる問い合わせの答えを捨てる。
    */
    diffRequestRef.current += 1
    setDiffRequest(null)
    setDiff(null)
    void load()
  }, [workspaceStatus, workspaceId, load])

  /*
    作業ツリーのファイルが変わったとき（Session 3-8-2）と、
    `.git` の中が変わったとき（Session 3-8-8）。

    前者は Files のツリー（useFileTree.ts）や Editor（useEditorSession.ts）と同じ
    `files:changed` に相乗りし、後者は Git 専用の `git:changed` で届く
    （main/git/gitWatcher.ts）。変化の中身はどちらも見ない ── どのファイルが
    どう変わったかを Git の一覧へ翻訳するのは git の仕事で、こちらが
    先回りして「この変化なら一覧は変わらない」と決めると、その判断が
    git の判断と食い違ったときに一覧が古いまま止まる。

    **2つを同じタイマーへ合流させる。** 別々に持つと、`git commit` のように
    両方が同時に動く操作で読み直しが2回走る ── しかも1回目は
    「index は空になったが作業ツリーはまだ」という途中の写しになりうる。
    合わせておけば、押し寄せた変化がどちらの経路から来ても
    **最後の1回だけ**が `getRepository()` に化ける（ブランチ名と変更一覧は
    その1回の応答に揃って載る）。
  */
  useEffect(() => {
    if (workspaceId === null) {
      return
    }

    let settle: ReturnType<typeof setTimeout> | null = null

    const scheduleReload = (eventWorkspaceId: string): void => {
      // 切り替えと行き違った通知は捨てる（イベントには対応関係が無い）。
      if (eventWorkspaceId !== workspaceId) {
        return
      }

      if (settle !== null) {
        clearTimeout(settle)
      }

      settle = setTimeout(() => {
        settle = null
        void load({ quiet: true })
      }, CHANGE_SETTLE_MS)
    }

    const unsubscribeFiles = fluvix.files.onChanged((event) => {
      scheduleReload(event.workspaceId)
    })

    const unsubscribeGit = fluvix.git.onChanged((event) => {
      scheduleReload(event.workspaceId)
    })

    return () => {
      if (settle !== null) {
        clearTimeout(settle)
      }

      unsubscribeFiles()
      unsubscribeGit()
    }
  }, [workspaceId, load])

  const refresh = useCallback((): void => {
    setFailure(null)
    void load()
  }, [load])

  /**
   * ブランチの一覧を取り直す（Session 3-8-6）。
   *
   * 呼ばれるのは**面が開いた瞬間**だけになる（GitBranchMenu.tsx）。
   * `git:changed`（Session 3-8-8）には相乗りさせていない ── 見られているのは
   * 面が開いている一瞬だけで、覚えておいた一覧を出すと
   * 「さっき作ったブランチが無い」が起きる。
   *
   * 状態の読み直し（`load`）と混ぜていないのは、**取り直す理由が違う**ため。
   * こちらは開いている面のためだけに走り、Git パネル全体の見た目は動かさない。
   */
  const refreshBranches = useCallback(async (): Promise<void> => {
    const requestId = branchRequestRef.current + 1
    branchRequestRef.current = requestId
    setBranches(INITIAL_GIT_BRANCH_LIST)

    const result = await fluvix.git.listBranches()

    // 追い越された（面を開き直した）。新しい方の答えが来る。
    if (branchRequestRef.current !== requestId) {
      return
    }

    if (!result.ok) {
      console.warn('[git] ブランチの一覧を取得できませんでした。', result.error)
      setBranches({ status: 'failed', branches: [], truncated: false })
      return
    }

    // 問い合わせている間に Workspace が切り替わっていたら捨てる（`load` と同じ）。
    if (result.data.workspaceId !== workspaceIdRef.current) {
      return
    }

    const listing = result.data.listing

    setBranches(
      listing.status === 'ready'
        ? { status: 'ready', branches: listing.branches, truncated: listing.truncated }
        : { status: listing.status, branches: [], truncated: false }
    )
  }, [])

  /** 面を開いた側から呼ぶ形（結末は画面の中だけで完結する）。 */
  const requestBranches = useCallback((): void => {
    void refreshBranches()
  }, [refreshBranches])

  /**
   * 1回分の操作（Session 3-8-3）。
   *
   * ## 同じ対象への二重の要求を、ここで止める
   *
   * `pendingRef` に目印が残っている間、同じ対象の要求は始めない。
   * ボタンを disabled にするだけでは足りない ── 連打はボタンが
   * 押せなくなるより速く届きうるし、キーボードからの操作もある。
   *
   * **止めるのは「同じ対象」だけ。** 別のファイルの Stage は並べて始めてよく、
   * それらが git の上で衝突しないことは Main 側の順番待ちが担保する
   * （main/git/gitQueue.ts）── 押した順に、必ず1本ずつ走る。
   *
   * ## 応答に載っている状態をそのまま使う
   *
   * 操作の後にもう一度 `getRepository()` を呼ばない。応答には**操作後の状態**が
   * 入っていて（shared/ipc/contracts/git.ts）、それは操作と同じ順番待ちの中で
   * 読まれたものになる。ここで呼び直すと、その間に挟まった別の操作の結果を
   * 「押した操作の結果」として出すことになる。
   *
   * ## 失敗しても一覧は新しくする
   *
   * 失敗でも `repository` は取り直したものが入っている。理由だけを添えて、
   * **一覧は必ず新しい方に差し替える** ── 失敗の後に古い一覧を残すと、
   * 「押したのに何も変わらない」ように見えて、本当の状態が分からなくなる。
   */
  const operate = useCallback(
    async (
      key: string,
      invoke: () => Promise<IpcResult<GitOperationResponse>>
    ): Promise<GitOperationOutcome | null> => {
      if (pendingRef.current.has(key)) {
        return null
      }

      pendingRef.current = new Set(pendingRef.current).add(key)
      setPending(pendingRef.current)

      const requestId = requestRef.current + 1
      requestRef.current = requestId

      try {
        const result = await invoke()

        if (!result.ok) {
          console.warn('[git] Git 操作に失敗しました。', result.error)
          setFailure({ status: 'failed', reason: 'unknown' })
          // 応答が無い ＝ 何が起きたか分からない。実際の状態を読み直す。
          void load({ quiet: true })
          return null
        }

        /*
          Workspace が切り替わっていたら、結末ごと捨てる。前の Workspace の
          操作の理由を、別のリポジトリの一覧の上に出しても意味を持たない。

          **通らなかった扱いにする。** 捨てたのはこちらの都合で、Commit なら
          入力欄はそのまま残る ── 消してしまうと、書いた文章が
          「Commit されたのかどうかも分からないまま」失われる。
        */
        if (result.data.workspaceId !== workspaceIdRef.current) {
          return null
        }

        /*
          理由は追い越されていても出す。**押したのは利用者**で、その結末は
          その後に読み直しが挟まったかどうかとは関係が無い（挟まるのは
          `files:changed` からの自動の読み直しで、利用者には見えない）。

          `partly-applied`（Commit & Push が途中で止まった）も出す ──
          通り切っていないという意味では失敗と同じで、しかも
          **次に何をすればよいかがいちばん要る**結末にあたる。
        */
        const outcome = result.data.outcome

        setFailure(outcome.status === 'applied' ? null : outcome)

        // 追い越された。一覧は新しい方の答えで差し替わる（結末そのものは変わらない）。
        if (requestRef.current === requestId) {
          setState({ status: 'ready', repository: result.data.repository })
        }

        return outcome
      } finally {
        const next = new Set(pendingRef.current)
        next.delete(key)
        pendingRef.current = next
        setPending(next)
      }
    },
    [load]
  )

  const stage = useCallback(
    (target: GitStageTarget): void => {
      void operate(toGitOperationKey(target), () => fluvix.git.stage({ target }))
    },
    [operate]
  )

  const unstage = useCallback(
    (relativePath: string): void => {
      void operate(toGitOperationKey({ kind: 'unstage', relativePath }), () =>
        fluvix.git.unstage({ target: { relativePath } })
      )
    },
    [operate]
  )

  /*
    破棄（Session 3-8-9）。

    経路は Stage / Unstage とまったく同じ（`operate`）で、**失われるものが
    ある操作のための別の道は作っていない。** 分かれているのは押す前の側だけ
    ── 確認を出すのは面（GitDiscardConfirm.tsx）で、ここへ来るのは
    既に尋ね終えたものになる。

    鍵も同じ（`path:<位置>`）── 破棄している最中に、その同じ行を
    Stage できる形にしない（gitChanges.ts）。

    破棄した後の一覧は、その応答に載って届く。Files と Editor は
    作業ツリーの監視（`files:changed`）で追いつくため、ここから何かを
    配ることもしない（ブランチの切り替えと同じ形）。
  */
  const discard = useCallback(
    (target: GitDiscardTarget): void => {
      void operate(toGitOperationKey({ kind: 'discard', relativePath: target.relativePath }), () =>
        fluvix.git.discard({ target })
      )
    },
    [operate]
  )

  /*
    差分（Session 3-8-9）。

    `operate` を通さない ── 何も書き換えないため、失敗の行にも
    「操作中」の印にも関係が無い。理由は面の中に出す（GitDiffOverlay.tsx）。
  */
  const openDiff = useCallback((request: GitDiffRequest): void => {
    const requestId = diffRequestRef.current + 1
    diffRequestRef.current = requestId

    // 先に面を出す。中身が来るまでは「読み込んでいます…」になる。
    setDiffRequest(request)
    setDiff(null)

    void (async () => {
      const result = await fluvix.git.getFileDiff({
        group: request.group,
        relativePath: request.change.relativePath
      })

      // 追い越された（別の行を押した / 閉じた）。新しい方の答えが来る。
      if (diffRequestRef.current !== requestId) {
        return
      }

      if (!result.ok) {
        console.warn('[git] 差分を取得できませんでした。', result.error)
        setDiff({ status: 'unavailable', reason: 'failed' })
        return
      }

      // 問い合わせている間に Workspace が切り替わっていたら捨てる（`load` と同じ）。
      if (result.data.workspaceId !== workspaceIdRef.current) {
        return
      }

      setDiff(result.data.diff)
    })()
  }, [])

  const closeDiff = useCallback((): void => {
    // 飛んでいる問い合わせの答えを捨てる（閉じた後に面が戻ってこないように）。
    diffRequestRef.current += 1
    setDiffRequest(null)
    setDiff(null)
  }, [])

  /**
   * Commit（Session 3-8-4）。
   *
   * 経路は Stage / Unstage とまったく同じ（`operate`）で、違うのは
   * **結末を呼び出し側へ返す**ことだけになる。二重の要求を止める仕組みも、
   * 応答に載っている操作後の状態をそのまま使うところも共通で、
   * Commit のためだけの別の道は作っていない。
   */
  const commit = useCallback(
    async (message: string): Promise<boolean> => {
      const outcome = await operate(GIT_COMMIT_OPERATION_KEY, () => fluvix.git.commit({ message }))

      return outcome?.status === 'applied'
    },
    [operate]
  )

  /*
    Push / Pull（Session 3-8-5）。

    経路は Stage / Unstage / Commit とまったく同じ（`operate`）で、
    **要求に載せる値が1つも無い**ところだけが違う。二重の要求を止める仕組みも、
    応答に載っている操作後の状態をそのまま使うところも共通で、
    ネットワークへ出る操作のための別の道は作っていない。
  */
  const push = useCallback((): void => {
    void operate(GIT_PUSH_OPERATION_KEY, () => fluvix.git.push())
  }, [operate])

  const pull = useCallback((): void => {
    void operate(GIT_PULL_OPERATION_KEY, () => fluvix.git.pull())
  }, [operate])

  /**
   * Commit & Push（Session 3-8-5）。
   *
   * **`partly-applied` を「通った」側として返す。** 返しているのは
   * 「入力欄を空にしてよいか」であり、Push が失敗していても Commit が
   * 作られている以上、その文章は既に履歴に記録されている ── 欄に残すと、
   * 利用者は同じ内容をもう一度 Commit しかねない。
   *
   * Push を押し直すのに Commit メッセージは要らない（隣の Push ボタンで足りる）。
   */
  const commitAndPush = useCallback(
    async (message: string): Promise<boolean> => {
      const outcome = await operate(GIT_COMMIT_AND_PUSH_OPERATION_KEY, () =>
        fluvix.git.commitAndPush({ message })
      )

      return outcome !== null && outcome.status !== 'failed'
    },
    [operate]
  )

  /*
    ブランチの切り替え / 作成（Session 3-8-6）。

    経路は Stage / Commit / Push とまったく同じ（`operate`）で、要求に載るのが
    **名前1つ**であるところだけが違う。二重の要求を止める仕組みも、応答に
    載っている操作後の状態をそのまま使うところも共通で、作業ツリーが
    まるごと入れ替わる操作のための別の道は作っていない。

    切り替えた後の一覧・ブランチ名・追跡先は、その応答に載って届く ──
    Files と Editor は `files:changed` で追いつくため、ここから何かを
    配ることもしない（main/git/gitBranches.ts）。
  */
  const switchBranch = useCallback(
    (name: string): void => {
      void operate(GIT_SWITCH_BRANCH_OPERATION_KEY, () => fluvix.git.switchBranch({ name }))
    },
    [operate]
  )

  const createBranch = useCallback(
    async (name: string): Promise<boolean> => {
      const outcome = await operate(GIT_CREATE_BRANCH_OPERATION_KEY, () =>
        fluvix.git.createBranch({ name })
      )

      return outcome?.status === 'applied'
    },
    [operate]
  )

  /*
    初期化（Session 3-8-10）。

    経路は他の書き込み操作とまったく同じ（`operate`）で、要求に載せる値が
    1つも無いところだけが違う。**初期化の後に何かを続けて呼ばない** ──
    Commit も公開も、利用者が別に選ぶことになる（main/git/gitInit.ts）。

    `.git` が現れたことは watcher も拾う（gitWatcher.ts）が、二重に
    読み直すことにはならない ── 変化から始まる読み直しは同じタイマーへ
    合流し、応答で差し替わった状態と同じものに落ち着く。
  */
  const init = useCallback((): void => {
    void operate(GIT_INIT_OPERATION_KEY, () => fluvix.git.init())
  }, [operate])

  /**
   * GitHub CLI の状態を取り直す（Session 3-8-10）。
   *
   * 呼ばれるのは**面が開いた瞬間**と、案内の「もう一度確認する」を押したとき
   * だけになる（GitHubPublishForm.tsx）。`git:changed` にも `files:changed` にも
   * 相乗りさせていない ── gh の状態はリポジトリの中身とは無関係で、
   * ファイルを保存するたびに確かめるものではない。
   *
   * 状態の読み直し（`load`）と混ぜていないのも同じ理由で、こちらは
   * 開いている面のためだけに走り、Git パネル全体の見た目は動かさない。
   */
  const refreshGitHubStatus = useCallback(async (): Promise<void> => {
    const requestId = githubRequestRef.current + 1
    githubRequestRef.current = requestId
    setGitHubStatus(INITIAL_GITHUB_STATUS)

    const result = await fluvix.github.getStatus()

    // 追い越された（面を開き直した / もう一度押した）。新しい方の答えが来る。
    if (githubRequestRef.current !== requestId) {
      return
    }

    if (!result.ok) {
      console.warn('[github] GitHub CLI の状態を取得できませんでした。', result.error)
      setGitHubStatus({ status: 'failed' })
      return
    }

    /*
      Workspace が切り替わっていても捨てない ── gh の状態は Workspace に
      依らないため（応答に `workspaceId` そのものが載っていない。
      shared/ipc/contracts/github.ts）。
    */
    setGitHubStatus(toGitHubStatusState(result.data.availability))
  }, [])

  /** 面の側から呼ぶ形（結末は画面の中だけで完結する）。 */
  const requestGitHubStatus = useCallback((): void => {
    void refreshGitHubStatus()
  }, [refreshGitHubStatus])

  /**
   * GitHub へ公開する（Session 3-8-10）。
   *
   * 経路は Commit / Push とまったく同じ（`operate`）── 外へ出る操作のための
   * 別の道は作っていない。`partly-applied` を「通った」側として返すのは
   * Commit & Push と同じ理由で、**外に物ができている**以上、同じ名前で
   * もう一度押しても断られるだけになる。
   */
  const publishToGitHub = useCallback(
    async (name: string, visibility: GitHubRepositoryVisibility): Promise<boolean> => {
      const outcome = await operate(GITHUB_PUBLISH_OPERATION_KEY, () =>
        fluvix.github.publish({ name, visibility })
      )

      return outcome !== null && outcome.status !== 'failed'
    },
    [operate]
  )

  return {
    status: state.status,
    repository: state.repository,
    busy,
    refresh,
    pending,
    failure,
    init,
    stage,
    unstage,
    discard,
    diffRequest,
    diff,
    openDiff,
    closeDiff,
    commit,
    push,
    pull,
    commitAndPush,
    branches,
    refreshBranches: requestBranches,
    switchBranch,
    createBranch,
    githubStatus,
    refreshGitHubStatus: requestGitHubStatus,
    publishToGitHub
  }
}
