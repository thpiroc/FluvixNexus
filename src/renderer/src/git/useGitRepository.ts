import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  GitCommitFileDiff,
  GitCommitSummary,
  GitConflictFileDiff,
  GitDiscardTarget,
  GitFileDiff,
  GitOperationFailure,
  GitOperationOutcome,
  GitRemote,
  GitRemoteBranch,
  GitRepositoryState,
  GitStageTarget,
  GitStashEntry
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
  GIT_DELETE_BRANCH_OPERATION_KEY,
  GIT_RENAME_BRANCH_OPERATION_KEY,
  GIT_MERGE_BRANCH_OPERATION_KEY,
  GIT_ABORT_MERGE_OPERATION_KEY,
  type GitBranchListState
} from './gitBranches'
import type { GitCommitDetailState } from './gitCommitDetail'
import { INITIAL_GIT_COMMIT_HISTORY, type GitCommitHistoryState } from './gitHistory'
import {
  GIT_CREATE_TRACKING_BRANCH_OPERATION_KEY,
  INITIAL_GIT_REMOTE_BRANCH_LIST,
  type GitRemoteBranchListState
} from './gitRemoteBranches'
import {
  GIT_ADD_REMOTE_OPERATION_KEY,
  GIT_REMOVE_REMOTE_OPERATION_KEY,
  GIT_RENAME_REMOTE_OPERATION_KEY,
  GIT_SET_REMOTE_URL_OPERATION_KEY,
  INITIAL_GIT_REMOTE_LIST,
  type GitRemoteListState
} from './gitRemotes'
import {
  GIT_STASH_DROP_OPERATION_KEY,
  GIT_STASH_POP_OPERATION_KEY,
  GIT_STASH_PUSH_OPERATION_KEY,
  INITIAL_GIT_STASH_LIST,
  type GitStashListState
} from './gitStash'
import {
  GIT_COMMIT_AND_PUSH_OPERATION_KEY,
  GIT_COMMIT_OPERATION_KEY,
  GIT_INIT_OPERATION_KEY,
  GIT_FETCH_OPERATION_KEY,
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
 * 3-8-3 / 3-8-4 / 3-8-5 / 3-8-6 / 3-8-8 / 3-8-9 / 3-8-10 / 3-8-11）。
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
 * ## 履歴は「開いている間だけ」追いつく（Session 3-8-11）
 *
 * 履歴も `repository` には入れない（保存のたびに `git log` で 100 件を読む
 * ことになる）。ただしブランチの一覧とは契機が1つ違い、**開いている間は
 * `git:changed` を購読する** ── ブランチを選ぶ面は開いて選んで閉じるまでが
 * 一瞬だが、履歴は開いたまま端末で `git commit` することがあり、そのとき
 * 出たままの一覧は「さっき積んだ commit が無い」という形で嘘をつく。
 *
 * 購読するのは `git:changed` だけで、`files:changed` には乗らない ──
 * 作業ツリーをいくら書き換えても、履歴は1行も変わらない。
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
   * 競合している1件を「解決済み」として記録する（Session 3-8-18）。
   *
   * `stage` とは**別の口**へ行く ── 動く git は同じ `git add` だが、
   * index の3段（base / ours / theirs）を1段に畳む操作で意味が違う
   * （main/git/gitConflict.ts）。
   *
   * **確認は挟まない**（利用者が書いた中身は1文字も動かない）。ただし
   * 競合マーカーが残っていれば Main が断る ── それは Renderer からは
   * 分からない（作業ツリーの中身を持っていない）ので、押した後に
   * `failure` として出る。
   */
  readonly resolveConflict: (relativePath: string) => void
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
  readonly diff: GitFileDiff | GitCommitFileDiff | GitConflictFileDiff | null
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
   * remote から取ってくるだけ（Session 3-8-22A）。
   *
   * Pull と違って**取り込まない** ── 動くのは remote-tracking ref だけで、
   * 追跡先が無いブランチでも押せる。3-8-19 の remote の枝の一覧を
   * 新しくする唯一の口にあたる（shared/api.ts）。
   */
  readonly fetch: () => void
  /**
   * git が用意したマージ commit の既定メッセージ（Session 3-8-22A）。
   *
   * マージの途中でなければ null。**入力欄の中身そのものではない** ──
   * 欄を持つのは GitView で、ここが渡すのは「最初に入れてよい文章」に
   * なる（空の欄にだけ入る。GitView.tsx）。
   */
  readonly mergeMessage: string | null
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
   * remote-tracking branch の一覧（Session 3-8-19）。
   *
   * ローカルの一覧と**別に持つ。** 1つの状態にまとめると、片方だけが
   * 届いている間の姿を表せない（2本のチャンネルは別々に返る）── そして
   * 上限も `truncated` も別々に効くので、まとめると「何について切れたのか」を
   * 言えなくなる（shared/ipc/contracts/git.ts）。
   *
   * 取り直す契機はローカルの一覧とまったく同じ（面が開いた瞬間だけ）で、
   * `git:changed` には相乗りさせていない。
   */
  readonly remoteBranches: GitRemoteBranchListState
  /**
   * commit の履歴（Session 3-8-11）。
   *
   * ブランチの一覧と同じく**リポジトリの状態とは別に持つ** ── `repository` の
   * 中に入れると、ファイルを保存するたびに `git log` で 100 件を読み直すことに
   * なる（shared/git/history.ts）。
   *
   * 閉じている間は `historyOpen` が false で、その間は一度も取りに行かない。
   */
  readonly history: GitCommitHistoryState
  /** 履歴の面が開いているか（開いている間だけ `git:changed` で追いつく）。 */
  readonly historyOpen: boolean
  /** 履歴を開く（開いた瞬間に取りに行く）。 */
  readonly openHistory: () => void
  /** 履歴を閉じる（飛んでいる問い合わせの答えは捨てる）。 */
  readonly closeHistory: () => void
  /**
   * 開いている commit の詳細（Session 3-8-12）。
   *
   * 一覧を見ているときは null。**履歴とは別の状態**にしてあるのは、
   * 開いている間の追いつき方が違うため ── 履歴は `.git` が変わるたびに
   * 読み直すが、詳細は**一度読んだら読み直さない**（記録された commit の
   * 中身は変わらない。`openCommitDetail`）。
   */
  readonly commitDetail: GitCommitDetailState | null
  /** 履歴の行を押した（その commit の変更ファイルを取りに行く）。 */
  readonly openCommitDetail: (commit: GitCommitSummary) => void
  /** 詳細から履歴の一覧へ戻る。 */
  readonly closeCommitDetail: () => void
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
   * 履歴の commit を始点に、ブランチを作って切り替える（Session 3-8-13）。
   *
   * ## `createBranch` と別の口にしてある
   *
   * 動かすチャンネルも目印も同じ（要求に始点が1つ載るだけ）だが、
   * **呼ぶ側が要るものが違う。** バーの「＋」は「通ったか」だけで足りるのに対し、
   * 履歴の面は**通らなかった理由をその場に出す**必要がある ── 面が
   * パネルを覆っているため、下に出ている `failure` は読めない
   * （GitHistoryOverlay.tsx）。
   *
   * したがって返すのは `GitOperationOutcome`（`operate` が返すそのもの）で、
   * 押した1回の結末だけがそこに入る。`failure` にも同じものが載るが、
   * あちらは**面を閉じた後**に読まれるものになる。
   *
   * ## 通ったら履歴の面を閉じる
   *
   * 作った先へ切り替わるため、開いたままの履歴は**もう別のブランチのもの**に
   * なる（新しいブランチは始点の commit を指しており、そこから先の行は
   * 一覧から消える）。閉じずに取り直すと、押した行より新しい行が黙って
   * 消えることになり、「作れたのか」と「何かが失われたのか」が
   * 同じ動きに見える。
   */
  readonly createBranchFromCommit: (
    shortHash: string,
    name: string
  ) => Promise<GitOperationOutcome | null>
  /**
   * ローカルブランチを削除する（Session 3-8-14）。
   *
   * ## 結末を返す（`switchBranch` とは違う）
   *
   * 理由は `createBranchFromCommit` と同じで、**押した場所の近くに理由を
   * 出す必要がある**ため ── ブランチの面はパネルを覆っており、下に出ている
   * `failure` は読めない（GitBranchMenu.tsx）。切り替えが結末を返さないのは、
   * 通ったことが画面そのもの（バーの名前）に出るからだった。
   *
   * ## 通ったら一覧を取り直す
   *
   * 削除は**面を閉じない**（溜まった枝を続けて片付けられるようにするため）。
   * したがって、消えた行が一覧から消えるところまでをここで行う ──
   * 応答に載るのは操作後の**リポジトリの状態**で、ブランチの一覧はそこに
   * 含まれない（3-8-6 からの分担。shared/git/branch.ts）。
   *
   * §14.14 の「開いた瞬間だけ取り直す」に、ここで
   * 「**通った操作の後にも取り直す**」が1つ足される ── `git:changed` に
   * 相乗りさせない（誰も見ていない一覧を数え直さない）という判断は
   * そのままで、取り直すのは自分が変えたと分かっている1回だけになる。
   */
  readonly deleteBranch: (name: string) => Promise<GitOperationOutcome | null>
  /**
   * ローカルブランチの名前を変える（Session 3-8-14）。
   *
   * 削除と同じく結末を返し、通ったら一覧を取り直す。**面は閉じない** ──
   * 改名した行がその場で新しい名前になるところまでを見せる。
   *
   * 今そこに居るブランチを改名した場合は、応答に載る状態で
   * 上のバーの表示も一緒に変わる（HEAD は git が追随させる）。
   */
  readonly renameBranch: (name: string, newName: string) => Promise<GitOperationOutcome | null>
  /**
   * ローカルブランチを今のブランチへ取り込む（Session 3-8-20）。
   *
   * ## 結末を返す（削除 / rename と同じ）
   *
   * 押した場所（一覧の行の下の確認）に理由を出すため ── パネル全体の
   * `failure` にも同じものが載るが、面が開いている間はそちらが見えない。
   *
   * ## 通ったら面を閉じる（削除 / rename とは違う）
   *
   * 取り込みが済めば、その面でやることはもう無い ── 続けて別の枝を
   * 取り込む、という使い方は無い（溜まった枝を続けて消す削除とはそこが違う）。
   * **競合した場合も閉じる** ── 次にすることは面の中ではなく、
   * パネル本体の競合のグループにあるためになる（Session 3-8-18）。
   *
   * ## 一覧を取り直さない
   *
   * 面が閉じるので、取り直すのは誰も見ていない一覧のために git を1回
   * 起動することになる（3-8-19 の `createTrackingBranch` と同じ判断）。
   * 上のバーのブランチ名・`↑ ↓`・変更ファイルの一覧は、
   * どれも応答に載っている操作後の状態から変わる。
   */
  readonly mergeBranch: (name: string) => Promise<GitOperationOutcome | null>
  /**
   * 途中のマージをやめる（Session 3-8-20）。
   *
   * 押す場所は面の中ではなくパネルの帯（`repository.inProgress` が `merge` の
   * ときだけ出る）になる ── 結末を返すのは、確認を出しているその場に理由を
   * 出すためで、削除 / rename と同じ形にあたる。
   */
  readonly abortMerge: () => Promise<GitOperationOutcome | null>
  /**
   * remote-tracking branch を追うローカルブランチを作って、切り替える
   * （Session 3-8-19）。
   *
   * ## 結末を返す（`createBranch` は真偽だった）
   *
   * 理由は `createBranchFromCommit` / `deleteBranch` と同じで、**押した場所の
   * 近くに理由を出す必要がある**ため ── ブランチの面はパネルを覆っており、
   * 下に出ている `failure` は読めない（GitBranchMenu.tsx）。
   *
   * とくにここでは、いちばん出やすい失敗が `branch-exists`（同じ名前の
   * ローカルブランチが既にある）になる ── その理由は**打ち直す欄の
   * すぐ隣**に出ないと意味が無い。
   *
   * ## 通ったら面を閉じる（切り替わるため）
   *
   * 作った先へ移るので、開いたままの一覧は**もう別のブランチのもの**になる
   * （ローカルの一覧の印が全部ずれる）── 3-8-6 の作成と同じ扱いで、
   * 削除 / rename が閉じないのとは逆側にあたる。
   *
   * 閉じる判断は面の側が持つ（通ったかどうかを結末から読む）。
   */
  readonly createTrackingBranch: (
    startPoint: string,
    name: string
  ) => Promise<GitOperationOutcome | null>
  /**
   * 退避の一覧（Session 3-8-15）。
   *
   * ブランチ・履歴と同じく**リポジトリの状態とは別に持つ** ── `repository` の
   * 中に入れると、ファイルを保存するたびに `git stash list` を1回起動する
   * ことになる（shared/git/stash.ts）。
   *
   * 閉じている間は `stashOpen` が false で、その間は一度も取りに行かない。
   */
  readonly stashes: GitStashListState
  /**
   * remote の一覧（Session 3-8-16）。
   *
   * ブランチ・履歴・退避と同じく**リポジトリの状態とは別に持つ** ──
   * `repository` が持っているのは今も `hasRemote`（有無だけ）で、そこは
   * 3-8-10 から動かしていない（shared/git/repository.ts）。一覧を相乗り
   * させると、ファイルを保存するたびに `git remote --verbose` を1回
   * 起動することになる。
   *
   * 閉じている間は `remoteOpen` が false で、その間は一度も取りに行かない。
   */
  readonly remotes: GitRemoteListState
  /** remote の面が開いているか（開いている間だけ `git:changed` で追いつく）。 */
  readonly remoteOpen: boolean
  /** remote を開く（開いた瞬間に取りに行く）。 */
  readonly openRemotes: () => void
  /** remote を閉じる（飛んでいる問い合わせの答えは捨てる）。 */
  readonly closeRemotes: () => void
  /**
   * remote を1つ追加する（Session 3-8-16）。
   *
   * **結末を返す**のは 3-8-14 の削除 / rename・3-8-15 の退避と同じ理由で、
   * 押した場所の近くに理由を出す必要があるため ── remote の面はパネルを
   * 覆っており、下に出ている `failure` は読めない（GitRemoteOverlay.tsx）。
   *
   * 通ると `repository.hasRemote` が true に変わるため、面を閉じたときに
   * 「GitHub に公開」の入口が消えている ── その差し替えは応答に載っている
   * 操作後の状態がそのまま行う（`operate`）。
   */
  readonly addRemote: (name: string, url: string) => Promise<GitOperationOutcome | null>
  /**
   * remote を1つ削除する（Session 3-8-16）。
   *
   * 渡すのは一覧の行そのもの ── 名前だけでも足りるが、行を渡す形に
   * 揃えてある（`stashPop` / `stashDrop` と同じ）。**確認を挟むのは
   * ここではない** ── 押してよいかを尋ねるのは面の側で
   * （GitRemoteOverlay.tsx）、ここへ来るのは既に尋ね終えたものになる。
   */
  readonly removeRemote: (remote: GitRemote) => Promise<GitOperationOutcome | null>
  /**
   * remote の送り先（URL）を変える（Session 3-8-17）。
   *
   * 渡すのは一覧の行と、利用者が打った URL の2つ ── **今の URL は
   * どこにも無い**（一覧に載るのはラベルだけ。shared/git/remote.ts）ので、
   * 打つのは常に新しい URL の全体になる。
   *
   * **確認を挟むのはここではない**（面の側。GitRemoteOverlay.tsx）──
   * ここへ来るのは既に尋ね終えたものになる。削除と同じ分担にしてある。
   */
  readonly setRemoteUrl: (remote: GitRemote, url: string) => Promise<GitOperationOutcome | null>
  /**
   * remote の名前を変える（Session 3-8-17）。
   *
   * 確認は挟まない ── `git remote rename` は remote-tracking ref も
   * 追跡先も `remote.pushDefault` も全部追随させるため、**失われるものが
   * 1つも無い**（3-8-14 のブランチの rename と同じ）。
   *
   * 大文字小文字だけを変える改名は、押せない状態にしてある
   * （renderer/src/git/gitRemotes.ts の `toGitRemoteRenameReadiness`）──
   * 通すと git が途中まで適用したまま止まるため。
   */
  readonly renameRemote: (remote: GitRemote, newName: string) => Promise<GitOperationOutcome | null>
  /** 退避の面が開いているか（開いている間だけ `git:changed` で追いつく）。 */
  readonly stashOpen: boolean
  /** 退避を開く（開いた瞬間に取りに行く）。 */
  readonly openStash: () => void
  /** 退避を閉じる（飛んでいる問い合わせの答えは捨てる）。 */
  readonly closeStash: () => void
  /**
   * 作業ツリーの変更を退避する（Session 3-8-15）。
   *
   * 引数が無い ── 名前も、未追跡を含めるかも、対象の位置も渡せない
   * （shared/ipc/contracts/git.ts）。
   *
   * **結末を返す**のは 3-8-14 の削除 / rename と同じ理由で、押した場所の
   * 近くに理由を出す必要があるため ── 退避の面はパネルを覆っており、
   * 下に出ている `failure` は読めない（GitStashOverlay.tsx）。
   */
  readonly stashPush: () => Promise<GitOperationOutcome | null>
  /**
   * 退避を作業ツリーへ戻し、一覧から取り除く（Session 3-8-15）。
   *
   * 渡すのは一覧の行そのもの ── **位置と hash の2つが対で要る**ためになる
   * （番号だけでは、押すまでの間にずれていたときに別の退避を戻す。
   * shared/git/stash.ts）。行を丸ごと渡せば、2つが食い違う形が作れない。
   *
   * 通っても**面は閉じない** ── 3-8-13 の「履歴からブランチを作る」が
   * 閉じたのは、作った先へ切り替わって開いたままの履歴が別のブランチのものに
   * なるためだった。退避を戻してもどこへも移らず、一覧は1件減るだけで
   * 正しいままになる（3-8-14 の削除と同じ側）。
   */
  readonly stashPop: (entry: GitStashEntry) => Promise<GitOperationOutcome | null>
  /**
   * 退避を捨てる（Session 3-8-15）。
   *
   * `stashPop` とまったく同じものを渡し、同じように結末を返す。
   *
   * **確認を挟むのはここではない。** 押してよいかを尋ねるのは面の側で
   * （GitStashOverlay.tsx）、ここへ来るのは既に尋ね終えたものになる ──
   * 破棄（3-8-9）・ブランチの削除（3-8-14）と同じ分担にしてある。
   */
  readonly stashDrop: (entry: GitStashEntry) => Promise<GitOperationOutcome | null>
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

/**
 * 差分の中身を、入口に合ったチャンネルへ訊きに行く（Session 3-8-12 / 3-8-21）。
 *
 * `openDiff` の中から**この1箇所だけ**が分岐する ── 面を出す手順も、
 * 追い越しの捨て方も、Workspace の突き合わせも入口によらず同じで、
 * 変わるのは「どのチャンネルへ、何を渡すか」に限られる。
 *
 * 3本とも応答の形が揃っている（`workspaceId` と `diff`）ため、呼んだ側は
 * union のまま読める ── 3-8-21 で3本目が増えても、`openDiff` の中の
 * 分岐は1つも増えていない。
 */
async function requestDiff(request: GitDiffRequest): Promise<
  IpcResult<{
    readonly workspaceId: string | null
    readonly diff: GitFileDiff | GitCommitFileDiff | GitConflictFileDiff
  }>
> {
  switch (request.source) {
    case 'worktree':
      return await fluvix.git.getFileDiff({
        group: request.group,
        relativePath: request.change.relativePath
      })

    case 'commit':
      return await fluvix.git.getCommitFileDiff({
        shortHash: request.commit.shortHash,
        relativePath: request.file.relativePath
      })

    case 'conflict':
      return await fluvix.git.getConflictDiff({ relativePath: request.change.relativePath })
  }
}

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
   * git が用意したマージ commit の既定メッセージ（Session 3-8-22A）。
   *
   * ## 状態（`repository`）に載せず、別に持つ
   *
   * `.git` が変わるたびに運ばれると、**利用者が書き換えている最中の欄を
   * 上書きする理由**が生まれる（3-8-12 の commit の詳細と同じ形で、
   * 開いた瞬間に1回だけ尋ねる）。
   *
   * ## null は「既定値が無い」であって、失敗ではない
   *
   * マージの途中でない・git が用意していない・読めなかった、はどれも
   * ここでは同じ null になる。Commit そのものは今までどおり打てば通るので、
   * 理由を出す場所を持たない（main/git/gitMergeMessage.ts）。
   */
  const [mergeMessage, setMergeMessage] = useState<string | null>(null)

  /**
   * この「マージの途中」について、既定メッセージを既に尋ねたか。
   *
   * state と別に ref で持つのは、尋ねる契機が useEffect の中にあり、
   * **描き直しを待たずに二重の問い合わせを止める**必要があるため
   * （`pendingRef` と同じ理由）。マージが終われば false へ戻る ── 次の
   * マージでは、また1回だけ尋ねる。
   */
  const mergeMessageAskedRef = useRef(false)

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
   * remote-tracking branch の一覧（Session 3-8-19）。
   *
   * ローカルの一覧と同じ面の中に出るが、**別の状態として持つ** ── 届くのは
   * 別のチャンネルからで、片方だけが先に届いている間の姿がある。
   */
  const [remoteBranches, setRemoteBranches] = useState<GitRemoteBranchListState>(
    INITIAL_GIT_REMOTE_BRANCH_LIST
  )

  /**
   * remote-tracking の一覧の通し番号。
   *
   * ローカルの一覧（`branchRequestRef`）と**別に持つ。** 同じ面から同時に
   * 2本走るので、1つの番号を共有すると**後から始まった方が先の答えを
   * 捨てさせる**ことになる（2本のうち片方だけが必ず消える）。
   */
  const remoteBranchRequestRef = useRef(0)

  /**
   * commit の履歴（Session 3-8-11）。
   *
   * ブランチの一覧と同じく**閉じている間は誰も見ていない**が、そちらと違って
   * 開いている間は追いつく必要がある（下の useEffect）── 履歴を出したまま
   * 端末で `git commit` することがあり、そのとき出たままの一覧は
   * 「さっき積んだ commit が無い」という形で嘘をつく。
   */
  const [history, setHistory] = useState<GitCommitHistoryState>(INITIAL_GIT_COMMIT_HISTORY)

  /**
   * 履歴の面が開いているか。
   *
   * state と ref の両方に持つ ── 描き直すために state が要り、
   * **イベントの購読の中から今の値を読む**ために ref が要る（購読を
   * 開閉のたびに張り直さずに済む）。
   */
  const [historyOpen, setHistoryOpen] = useState(false)
  const historyOpenRef = useRef(historyOpen)
  historyOpenRef.current = historyOpen

  /** 履歴の問い合わせの通し番号（一覧・差分と同じ理由で別に持つ）。 */
  const historyRequestRef = useRef(0)

  /**
   * 開いている commit の詳細（Session 3-8-12）。
   *
   * 履歴の一覧（`history`）と**別に持つ。** 相乗りさせると、`.git` が変わって
   * 一覧を読み直すたびに、開いていた詳細まで作り直すことになる ── 記録された
   * commit の中身は変わらないので、読み直す理由がそこには無い。
   *
   * 閉じているときは null。中身（`detail.detail`）が null の間は取得中で、
   * 面は先に出しておく（差分と同じ形。GitCommitDetailView.tsx）。
   */
  const [commitDetail, setCommitDetail] = useState<GitCommitDetailState | null>(null)

  /** 詳細の問い合わせの通し番号（一覧・履歴・差分と同じ理由で別に持つ）。 */
  const commitDetailRequestRef = useRef(0)

  /**
   * 退避の一覧（Session 3-8-15）。
   *
   * 履歴とまったく同じ扱いで、**閉じている間は誰も見ていない**が開いている間は
   * 追いつく必要がある（下の useEffect）── 端末で `git stash` を打つことがあり、
   * そのとき出たままの一覧は「さっき避けたものが無い」という形で嘘をつく。
   *
   * しかも退避では**その嘘が押し間違いに直結する** ── 番号は上から数えた位置で、
   * 1つ増えれば全部がずれる（shared/git/stash.ts）。Main も押された瞬間に
   * hash で確かめるが（二重の備え）、そもそも古い一覧を出さないことが先になる。
   */
  const [stashes, setStashes] = useState<GitStashListState>(INITIAL_GIT_STASH_LIST)

  /**
   * 退避の面が開いているか。
   *
   * state と ref の両方に持つ ── 描き直すために state が要り、
   * **イベントの購読の中から今の値を読む**ために ref が要る（履歴と同じ形）。
   */
  const [stashOpen, setStashOpen] = useState(false)
  const stashOpenRef = useRef(stashOpen)
  stashOpenRef.current = stashOpen

  /** 退避の問い合わせの通し番号（一覧・履歴・差分と同じ理由で別に持つ）。 */
  const stashRequestRef = useRef(0)

  /**
   * remote の一覧（Session 3-8-16）。
   *
   * 退避とまったく同じ扱いで、**閉じている間は誰も見ていない**が開いている間は
   * 追いつく必要がある（下の useEffect）── 端末で `git remote add` を打つ
   * ことがあり、そのとき出たままの一覧は「さっき足したものが無い」という形で
   * 嘘をつく。
   *
   * 退避と違い、**古い一覧が押し間違いにはならない** ── remote は位置ではなく
   * 名前で指すため、名前が在ればそれは同じ remote になる（shared/git/remote.ts）。
   * それでも追いつくのは、公開の入口（`hasRemote`）と一覧が食い違って見える
   * ことを避けるためになる。
   */
  const [remotes, setRemotes] = useState<GitRemoteListState>(INITIAL_GIT_REMOTE_LIST)

  /**
   * remote の面が開いているか。
   *
   * state と ref の両方に持つ ── 描き直すために state が要り、
   * **イベントの購読の中から今の値を読む**ために ref が要る（履歴・退避と同じ形）。
   */
  const [remoteOpen, setRemoteOpen] = useState(false)
  const remoteOpenRef = useRef(remoteOpen)
  remoteOpenRef.current = remoteOpen

  /** remote の問い合わせの通し番号（一覧・履歴・退避・差分と同じ理由で別に持つ）。 */
  const remoteRequestRef = useRef(0)

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
  const [diff, setDiff] = useState<GitFileDiff | GitCommitFileDiff | GitConflictFileDiff | null>(
    null
  )

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
      remote-tracking branch の一覧も同じ理由で捨てる（Session 3-8-19）。
      通し番号も進めて、飛んでいる問い合わせの答えを捨てる ── ローカルの
      一覧が `workspaceId` の突き合わせだけで足りているのに対し、こちらは
      2本が同じ面から走るぶん、番号の側でも切っておく。
    */
    remoteBranchRequestRef.current += 1
    setRemoteBranches(INITIAL_GIT_REMOTE_BRANCH_LIST)
    /*
      開いていた差分も閉じる（Session 3-8-9）。

      同じ位置のファイルが切り替え先にも在ることは普通にあり、閉じないと
      **別のリポジトリの中身が、前のリポジトリの見出しのまま**残る。
      通し番号も進めて、飛んでいる問い合わせの答えを捨てる。
    */
    diffRequestRef.current += 1
    setDiffRequest(null)
    setDiff(null)
    /*
      履歴も閉じる（Session 3-8-11）。

      差分と同じ理由で、閉じないと**別のリポジトリの commit が、前の
      リポジトリの面に出たまま**残る。通し番号も進めて、飛んでいる
      問い合わせの答えを捨てる。
    */
    historyRequestRef.current += 1
    setHistoryOpen(false)
    setHistory(INITIAL_GIT_COMMIT_HISTORY)
    /*
      開いていた commit の詳細も閉じる（Session 3-8-12）。

      履歴と同じ理由になる ── 短い hash は**リポジトリごとの値**で、
      切り替え先に同じ 7 桁が実在することもありうる。閉じないと、
      別のリポジトリの commit をその hash のまま読みに行く形が残る。
    */
    commitDetailRequestRef.current += 1
    setCommitDetail(null)
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

  /**
   * remote-tracking branch の一覧を取り直す（Session 3-8-19）。
   *
   * 経路はローカルの一覧（`refreshBranches`）とまったく同じ ── 通し番号で
   * 追い越しを捨て、`workspaceId` で行き違いを捨てる。**fetch はしない**
   * （この面はネットワークへ出ない。shared/git/remoteBranch.ts）。
   *
   * 呼ばれるのはローカルの一覧と同じ瞬間（面が開いたとき）で、2本が
   * 並んで走る ── 順番に待たせないのは、片方が遅れるともう片方の行まで
   * 出てこなくなるためになる（Main 側では順番待ちに入るので、git は
   * 1本ずつ走る）。
   */
  const refreshRemoteBranches = useCallback(async (): Promise<void> => {
    const requestId = remoteBranchRequestRef.current + 1
    remoteBranchRequestRef.current = requestId
    setRemoteBranches(INITIAL_GIT_REMOTE_BRANCH_LIST)

    const result = await fluvix.git.listRemoteBranches()

    // 追い越された（面を開き直した）。新しい方の答えが来る。
    if (remoteBranchRequestRef.current !== requestId) {
      return
    }

    if (!result.ok) {
      console.warn('[git] リモートのブランチの一覧を取得できませんでした。', result.error)
      setRemoteBranches({ status: 'failed', branches: [], truncated: false, hasRemote: false })
      return
    }

    // 問い合わせている間に Workspace が切り替わっていたら捨てる（`load` と同じ）。
    if (result.data.workspaceId !== workspaceIdRef.current) {
      return
    }

    const listing = result.data.listing
    const hasRemote = result.data.hasRemote

    setRemoteBranches(
      listing.status === 'ready'
        ? {
            status: 'ready',
            branches: listing.branches,
            truncated: listing.truncated,
            hasRemote
          }
        : { status: listing.status, branches: [], truncated: false, hasRemote }
    )
  }, [])

  /**
   * 面を開いた側から呼ぶ形（結末は画面の中だけで完結する）。
   *
   * Session 3-8-19 で、**1回の「開いた」で2本走る**ようになった ── ローカルと
   * remote-tracking の一覧で、チャンネルも上限も別になる
   * （shared/ipc/contracts/git.ts）。面の側から2回呼ばせないのは、
   * 「開いたら何を取り直すか」を決めるのがフックの側だからにあたる。
   */
  const requestBranches = useCallback((): void => {
    void refreshBranches()
    void refreshRemoteBranches()
  }, [refreshBranches, refreshRemoteBranches])

  /**
   * commit の履歴を取り直す（Session 3-8-11）。
   *
   * 経路はブランチの一覧（`refreshBranches`）とまったく同じ ── 通し番号で
   * 追い越しを捨て、`workspaceId` で行き違いを捨てる。
   *
   * `quiet` が付くのは、開いている間に `.git` が変わって取り直すときになる。
   * そのとき `loading` へ戻さないのは、**出ている一覧が一瞬消える**ため ──
   * 端末で `git commit` するたびに面が白くなると、読んでいた場所を見失う。
   * 開いた瞬間の1回だけは `loading` から始める（前の中身が一瞬見えるより
   * 「取得しています…」の方が読みやすい）。
   */
  const refreshHistory = useCallback(
    async (options?: { readonly quiet?: boolean }): Promise<void> => {
      const requestId = historyRequestRef.current + 1
      historyRequestRef.current = requestId

      if (options?.quiet !== true) {
        setHistory(INITIAL_GIT_COMMIT_HISTORY)
      }

      const result = await fluvix.git.listCommits()

      // 追い越された（開き直した／閉じた）。新しい方の答えが来る。
      if (historyRequestRef.current !== requestId) {
        return
      }

      if (!result.ok) {
        console.warn('[git] 履歴を取得できませんでした。', result.error)
        setHistory({ status: 'failed', commits: [], truncated: false })
        return
      }

      // 問い合わせている間に Workspace が切り替わっていたら捨てる（`load` と同じ）。
      if (result.data.workspaceId !== workspaceIdRef.current) {
        return
      }

      const listing = result.data.history

      setHistory(
        listing.status === 'ready'
          ? { status: 'ready', commits: listing.commits, truncated: listing.truncated }
          : { status: listing.status, commits: [], truncated: false }
      )
    },
    []
  )

  const openHistory = useCallback((): void => {
    setHistoryOpen(true)
    void refreshHistory()
  }, [refreshHistory])

  const closeHistory = useCallback((): void => {
    // 飛んでいる問い合わせの答えを捨てる（閉じた後に中身が入れ替わらないように）。
    historyRequestRef.current += 1
    setHistoryOpen(false)
    // 面ごと閉じるので、中で開いていた commit の詳細も一緒に畳む。
    commitDetailRequestRef.current += 1
    setCommitDetail(null)
  }, [])

  /**
   * commit 1件の変更ファイルを取りに行く（Session 3-8-12）。
   *
   * ## 差分（`openDiff`）とまったく同じ形にしてある
   *
   * 面（ここでは履歴の面の中身）を**先に**入れ替えてから取りに行く ──
   * 取れてから入れ替える形にすると、押してから何も起きない時間ができる。
   * 通し番号で追い越しを捨て、`workspaceId` で行き違いを捨てるのも同じ。
   *
   * ## 一度読んだら読み直さない
   *
   * `.git` が変わっても取り直さない（履歴の一覧はそこで取り直す）──
   * **記録された commit の中身は変わらない。** 変わりうるのは
   * 「その commit がまだ在るか」だけで、消えていれば次に開いたときに
   * `not-found` が出る。開いている間ずっと `diff-tree` を動かし続ける形には
   * しない。
   *
   * ## `operate` を通さない
   *
   * 何も書き換えないため、失敗の行にも「操作中」の印にも関係が無い
   * （差分・履歴と同じ）。理由は面の中に出す（gitCommitDetail.ts）。
   */
  const openCommitDetail = useCallback((commit: GitCommitSummary): void => {
    const requestId = commitDetailRequestRef.current + 1
    commitDetailRequestRef.current = requestId

    // 先に面を入れ替える。中身が来るまでは「取得しています…」になる。
    setCommitDetail({ commit, detail: null })

    void (async () => {
      const result = await fluvix.git.getCommitDetail({ shortHash: commit.shortHash })

      // 追い越された（別の行を押した／戻った／閉じた）。新しい方の答えが来る。
      if (commitDetailRequestRef.current !== requestId) {
        return
      }

      if (!result.ok) {
        console.warn('[git] コミットの変更ファイルを取得できませんでした。', result.error)
        setCommitDetail({ commit, detail: { status: 'unavailable', reason: 'failed' } })
        return
      }

      // 問い合わせている間に Workspace が切り替わっていたら捨てる（`load` と同じ）。
      if (result.data.workspaceId !== workspaceIdRef.current) {
        return
      }

      setCommitDetail({ commit, detail: result.data.detail })
    })()
  }, [])

  const closeCommitDetail = useCallback((): void => {
    // 飛んでいる問い合わせの答えを捨てる（戻った後に中身が入れ替わらないように）。
    commitDetailRequestRef.current += 1
    setCommitDetail(null)
  }, [])

  /**
   * 退避の一覧を取り直す（Session 3-8-15）。
   *
   * 経路は履歴（`refreshHistory`）とまったく同じ ── 通し番号で追い越しを捨て、
   * `workspaceId` で行き違いを捨てる。
   *
   * `quiet` が付くのは、開いている間に `.git` が変わって取り直すときと、
   * 自分が変えたと分かっている1回（退避 / 戻す / 捨てるが通った直後）になる。
   * そのとき `loading` へ戻さないのは、**出ている一覧が一瞬消える**ため ──
   * 続けて片付けているときに、押すたびに面が白くなると押す場所を見失う。
   */
  const refreshStashes = useCallback(
    async (options?: { readonly quiet?: boolean }): Promise<void> => {
      const requestId = stashRequestRef.current + 1
      stashRequestRef.current = requestId

      if (options?.quiet !== true) {
        setStashes(INITIAL_GIT_STASH_LIST)
      }

      const result = await fluvix.git.listStashes()

      // 追い越された（開き直した／閉じた）。新しい方の答えが来る。
      if (stashRequestRef.current !== requestId) {
        return
      }

      if (!result.ok) {
        console.warn('[git] 退避の一覧を取得できませんでした。', result.error)
        setStashes({ status: 'failed', entries: [], truncated: false })
        return
      }

      // 問い合わせている間に Workspace が切り替わっていたら捨てる（`load` と同じ）。
      if (result.data.workspaceId !== workspaceIdRef.current) {
        return
      }

      const listing = result.data.listing

      setStashes(
        listing.status === 'ready'
          ? { status: 'ready', entries: listing.entries, truncated: listing.truncated }
          : { status: listing.status, entries: [], truncated: false }
      )
    },
    []
  )

  const openStash = useCallback((): void => {
    setStashOpen(true)
    void refreshStashes()
  }, [refreshStashes])

  const closeStash = useCallback((): void => {
    // 飛んでいる問い合わせの答えを捨てる（閉じた後に中身が入れ替わらないように）。
    stashRequestRef.current += 1
    setStashOpen(false)
  }, [])

  /**
   * remote の一覧を取り直す（Session 3-8-16）。
   *
   * 経路は退避（`refreshStashes`）とまったく同じ ── 通し番号で追い越しを捨て、
   * `workspaceId` で行き違いを捨てる。
   *
   * `quiet` が付くのは、開いている間に `.git` が変わって取り直すときと、
   * 自分が変えたと分かっている1回（追加 / 削除が通った直後）になる。
   */
  const refreshRemotes = useCallback(
    async (options?: { readonly quiet?: boolean }): Promise<void> => {
      const requestId = remoteRequestRef.current + 1
      remoteRequestRef.current = requestId

      if (options?.quiet !== true) {
        setRemotes(INITIAL_GIT_REMOTE_LIST)
      }

      const result = await fluvix.git.listRemotes()

      // 追い越された（開き直した／閉じた）。新しい方の答えが来る。
      if (remoteRequestRef.current !== requestId) {
        return
      }

      if (!result.ok) {
        console.warn('[git] リモートの一覧を取得できませんでした。', result.error)
        setRemotes({ status: 'failed', remotes: [], truncated: false })
        return
      }

      // 問い合わせている間に Workspace が切り替わっていたら捨てる（`load` と同じ）。
      if (result.data.workspaceId !== workspaceIdRef.current) {
        return
      }

      const listing = result.data.listing

      setRemotes(
        listing.status === 'ready'
          ? { status: 'ready', remotes: listing.remotes, truncated: listing.truncated }
          : { status: listing.status, remotes: [], truncated: false }
      )
    },
    []
  )

  const openRemotes = useCallback((): void => {
    setRemoteOpen(true)
    void refreshRemotes()
  }, [refreshRemotes])

  const closeRemotes = useCallback((): void => {
    // 飛んでいる問い合わせの答えを捨てる（閉じた後に中身が入れ替わらないように）。
    remoteRequestRef.current += 1
    setRemoteOpen(false)
  }, [])

  /*
    履歴が開いている間だけ、`.git` の変化に追いつく（Session 3-8-11）。

    ## `git:changed` だけを購読する

    `files:changed` には乗らない ── 作業ツリーのファイルをいくら書き換えても、
    履歴は1行も変わらない。上のリポジトリ状態の読み直しが2つを合流させて
    いるのとは、そこが違う。

    ## 開いている間だけ

    閉じている間は購読そのものを張らない（この useEffect が `historyOpen` を
    依存に持つ）── ブランチの一覧が「開いた瞬間に1回だけ」なのに対し、
    履歴は開いたまま端末で `git commit` することがある。かといって
    閉じている間まで追い続けると、誰も見ていない一覧のために
    `git log` を動かし続けることになる。

    ## 束ねてから1回だけ

    間（`CHANGE_SETTLE_MS`）も上と同じにしてある。`git commit` 1回で
    `.git` の中は複数回変わり、押し寄せるたびに `git log` を起動すると
    プロセスの起動が変化に追いつかない。
  */
  useEffect(() => {
    if (!historyOpen || workspaceId === null) {
      return
    }

    let settle: ReturnType<typeof setTimeout> | null = null

    const unsubscribe = fluvix.git.onChanged((event) => {
      // 切り替えと行き違った通知は捨てる（イベントには対応関係が無い）。
      if (event.workspaceId !== workspaceId) {
        return
      }

      if (settle !== null) {
        clearTimeout(settle)
      }

      settle = setTimeout(() => {
        settle = null

        // 閉じた直後に発火した最後の1回を捨てる。
        if (historyOpenRef.current) {
          void refreshHistory({ quiet: true })
        }
      }, CHANGE_SETTLE_MS)
    })

    return () => {
      if (settle !== null) {
        clearTimeout(settle)
      }

      unsubscribe()
    }
  }, [historyOpen, workspaceId, refreshHistory])

  /*
    マージの途中に入ったら、既定のメッセージを1回だけ尋ねる（Session 3-8-22A）。

    ## 追いつく形（`.git` の変化を購読する）にしていない

    履歴・退避・remote の3つは開いている間ずっと `git:changed` を購読して
    いるが、これはその仲間ではない ── **取り直すたびに入力欄を上書きする
    理由が生まれる**（解決の途中で保存するたびに `.git` は変わる）。
    尋ねるのは「マージの途中でなかったものが、途中になった」1点だけになる。

    ## マージが終わったら捨てる

    捨てないと、次のマージで前回の文章が既定値として出る。ref も一緒に
    戻すので、次のマージではまた1回だけ尋ねる。
  */
  useEffect(() => {
    const merging = state.repository.status === 'ready' && state.repository.inProgress === 'merge'

    if (!merging) {
      mergeMessageAskedRef.current = false
      setMergeMessage(null)
      return
    }

    if (mergeMessageAskedRef.current) {
      return
    }

    mergeMessageAskedRef.current = true

    void fluvix.git.getMergeMessage().then((result) => {
      if (!result.ok) {
        /*
          読めなかったことを画面に出さない ── 既定値が出ないだけで、
          Commit そのものは今までどおり打てば通る（main/git/gitMergeMessage.ts）。
        */
        console.warn('[git] マージ commit の既定メッセージを取得できませんでした。', result.error)
        return
      }

      // 切り替えと行き違った答えは捨てる（他の問い合わせと同じ）。
      if (result.data.workspaceId !== workspaceIdRef.current) {
        return
      }

      setMergeMessage(result.data.message)
    })
  }, [state.repository])

  /*
    退避の面が開いている間だけ、`.git` の変化に追いつく（Session 3-8-15）。

    形は履歴（上）とまったく同じで、購読するのは `git:changed` だけになる ──
    作業ツリーのファイルをいくら書き換えても、退避の一覧は1行も変わらない。

    履歴より追いつく必要が強いのは、**古い一覧が押し間違いになる**ため ──
    退避を指す番号は上から数えた位置で、端末で `git stash` を1回打たれると
    全部が1つずつ後ろへずれる（shared/git/stash.ts）。

    束ねる間（`CHANGE_SETTLE_MS`）も同じにしてある。
  */
  useEffect(() => {
    if (!stashOpen || workspaceId === null) {
      return
    }

    let settle: ReturnType<typeof setTimeout> | null = null

    const unsubscribe = fluvix.git.onChanged((event) => {
      // 切り替えと行き違った通知は捨てる（イベントには対応関係が無い）。
      if (event.workspaceId !== workspaceId) {
        return
      }

      if (settle !== null) {
        clearTimeout(settle)
      }

      settle = setTimeout(() => {
        settle = null

        // 閉じた直後に発火した最後の1回を捨てる。
        if (stashOpenRef.current) {
          void refreshStashes({ quiet: true })
        }
      }, CHANGE_SETTLE_MS)
    })

    return () => {
      if (settle !== null) {
        clearTimeout(settle)
      }

      unsubscribe()
    }
  }, [stashOpen, workspaceId, refreshStashes])

  /*
    remote の面が開いている間だけ、`.git` の変化に追いつく（Session 3-8-16）。

    形は履歴・退避とまったく同じで、購読するのは `git:changed` だけになる ──
    作業ツリーのファイルをいくら書き換えても、remote の一覧は1行も変わらない。

    拾いたいのは端末での `git remote add` / `git remote remove` で、
    どちらも `.git/config` を書き換える ── その変化を watcher が運ぶ
    （main/git/gitWatcher.ts）。

    束ねる間（`CHANGE_SETTLE_MS`）も同じにしてある。
  */
  useEffect(() => {
    if (!remoteOpen || workspaceId === null) {
      return
    }

    let settle: ReturnType<typeof setTimeout> | null = null

    const unsubscribe = fluvix.git.onChanged((event) => {
      // 切り替えと行き違った通知は捨てる（イベントには対応関係が無い）。
      if (event.workspaceId !== workspaceId) {
        return
      }

      if (settle !== null) {
        clearTimeout(settle)
      }

      settle = setTimeout(() => {
        settle = null

        // 閉じた直後に発火した最後の1回を捨てる。
        if (remoteOpenRef.current) {
          void refreshRemotes({ quiet: true })
        }
      }, CHANGE_SETTLE_MS)
    })

    return () => {
      if (settle !== null) {
        clearTimeout(settle)
      }

      unsubscribe()
    }
  }, [remoteOpen, workspaceId, refreshRemotes])

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
    競合の解決（Session 3-8-18）。

    経路は Stage / Unstage / 破棄とまったく同じ（`operate`）で、
    **別の道は作っていない** ── 分かれているのは呼ぶ先だけになる
    （`git:resolve-conflict`。動く git は同じ `git add` だが意味が違う。
    main/git/gitConflict.ts）。

    鍵も同じ（`path:<位置>`）── 解決している最中に、その同じ行へ
    別の操作が飛ぶ形にしない。

    結末を返さない（Stage / Unstage / 破棄と同じ）── 通れば行が競合の
    グループから消えてステージ済みへ移り、断られた理由は一覧の上の
    1行として出る（`failure`）。**マーカーが残っていた**という断りは
    そこに出る唯一の押せない理由で、押す前には分からない
    （作業ツリーの中身を Renderer が持っていないため）。
  */
  const resolveConflict = useCallback(
    (relativePath: string): void => {
      void operate(toGitOperationKey({ kind: 'resolve', relativePath }), () =>
        fluvix.git.resolveConflict({ relativePath })
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
      /*
        どの入口から来たかで、訊く先が変わる（Session 3-8-12 / 3-8-21）。

        面も、面を出す手順も、追い越しの捨て方も同じで、**別れるのはここ1箇所**に
        なる ── 作業ツリーの1行なら group を、commit の中の1ファイルなら
        短い hash を、競合の1行なら位置だけを渡す
        （shared/ipc/contracts/git.ts）。

        3-8-21 で3本目のチャンネルが増えたが、`request.source` の union が
        そのまま3つに増えただけで、追い越しの判定も Workspace の突き合わせも
        1つのままになる。
      */
      const result = await requestDiff(request)

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
   * 取ってくるだけ（Session 3-8-22A）。
   *
   * Push / Pull とまったく同じ経路（`operate`）に載る ── 動かした後に
   * 状態を読み直すところまで含めて共通で、**この操作のためだけの経路を
   * 1つも作っていない。**
   *
   * 取ってきた結果は2箇所に出る ── 上のバーの `↓1`（状態に載る）と、
   * ブランチの面の remote の段（次に開いたときに取り直される）。
   * どちらも**既にある経路がそのまま運ぶ**ので、ここから一覧を
   * 取り直しに行かない（面が開いていなければ、取り直す相手も居ない）。
   */
  const fetchFromRemote = useCallback((): void => {
    void operate(GIT_FETCH_OPERATION_KEY, () => fluvix.git.fetch())
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
        fluvix.git.createBranch({ name, startPoint: null })
      )

      return outcome?.status === 'applied'
    },
    [operate]
  )

  /*
    履歴の commit を始点に作る（Session 3-8-13）。

    ## 目印は `createBranch` と同じ

    同じ操作（作って切り替える）で、**同時に2つ走ってよいものが無い** ──
    別の目印にすると、バーの「＋」と履歴の欄から同時に始められる形になる。

    ## 通ったときだけ閉じる

    失敗のときに閉じると、理由（面の中に出るもの）を読む前に消える ──
    Commit 欄・ブランチの作成欄と同じ判断になる（GitBranchMenu.tsx）。
  */
  const createBranchFromCommit = useCallback(
    async (shortHash: string, name: string): Promise<GitOperationOutcome | null> => {
      const outcome = await operate(GIT_CREATE_BRANCH_OPERATION_KEY, () =>
        fluvix.git.createBranch({ name, startPoint: shortHash })
      )

      if (outcome?.status === 'applied') {
        closeHistory()
      }

      return outcome
    },
    [closeHistory, operate]
  )

  /*
    削除 / rename（Session 3-8-14）。

    ## 経路は他の書き込み操作とまったく同じ

    `operate` を通り、二重の要求は目印で止まり、応答に載っている操作後の状態を
    そのまま使う。`git branch` を動かす初めての操作だが、**Renderer から見ると
    そこは何も変わらない** ── どの git が動くかは Main の中の話になる。

    ## 通ったときだけ一覧を取り直す

    どちらも面を閉じないため、ここで取り直さないと消えた行・古い名前が
    残ったままになる。失敗のときに取り直さないのは、**理由を読む前に
    一覧が入れ替わらないようにする**ため ── 押した行がその場に残っていないと、
    出ている理由がどれについてのものか分からなくなる。

    `refreshBranches` は通し番号で追い越しを弾く（一覧の取得と同じ仕組み）ので、
    ここから呼んでも面を開いた側の取得と混ざらない。
  */
  const deleteBranch = useCallback(
    async (name: string): Promise<GitOperationOutcome | null> => {
      const outcome = await operate(GIT_DELETE_BRANCH_OPERATION_KEY, () =>
        fluvix.git.deleteBranch({ name })
      )

      if (outcome?.status === 'applied') {
        void refreshBranches()
      }

      return outcome
    },
    [operate, refreshBranches]
  )

  const renameBranch = useCallback(
    async (name: string, newName: string): Promise<GitOperationOutcome | null> => {
      const outcome = await operate(GIT_RENAME_BRANCH_OPERATION_KEY, () =>
        fluvix.git.renameBranch({ name, newName })
      )

      if (outcome?.status === 'applied') {
        void refreshBranches()
      }

      return outcome
    },
    [operate, refreshBranches]
  )

  /*
    マージの開始 / 中止（Session 3-8-20）。

    ## 経路は他の書き込み操作とまったく同じ

    `operate` を通り、二重の要求は目印で止まり、応答に載っている操作後の
    状態をそのまま使う。**`partly-applied`（競合した）でも同じ経路**を
    通る ── `operate` は `applied` 以外を `failure` に入れるので、
    「マージを開始し、自動でマージできた変更は取り込みました。競合した
    ファイルがあります…」がパネルの上に1行出る（gitChanges.ts）。

    ## 一覧を取り直さない

    どちらも面を閉じる／面の外から押すので、取り直す先が無い
    （3-8-19 の `createTrackingBranch` と同じ判断）── ブランチの一覧は
    マージで1行も増減しない、という点でも取り直す理由が無い。

    ## 中止が通った後も、取り直すのは状態だけ

    `merging` は応答に載っている（shared/git/repository.ts）ので、
    帯はその1回の応答で消える ── 別に確かめ直す経路を作らない。
  */
  const mergeBranch = useCallback(
    async (name: string): Promise<GitOperationOutcome | null> => {
      return await operate(GIT_MERGE_BRANCH_OPERATION_KEY, () => fluvix.git.mergeBranch({ name }))
    },
    [operate]
  )

  const abortMerge = useCallback(async (): Promise<GitOperationOutcome | null> => {
    return await operate(GIT_ABORT_MERGE_OPERATION_KEY, () => fluvix.git.abortMerge())
  }, [operate])

  /*
    remote-tracking branch を追うブランチを作って切り替える（Session 3-8-19）。

    ## 経路は他の書き込み操作とまったく同じ

    `operate` を通り、二重の要求は目印で止まり、応答に載っている操作後の
    状態をそのまま使う。**目印だけが 3-8-6 の作成と別**になる ── 動かす
    チャンネルが別で、押せる場所も別になる（gitRemoteBranches.ts）。

    ## 通った後に一覧を取り直さない

    削除 / rename（3-8-14）は面を開いたままにするので取り直していたが、
    こちらは**面が閉じる**（切り替わったため。GitBranchMenu.tsx）── 閉じる面の
    一覧を取り直すのは、誰も見ないもののために git を1回起動することになる。
    次に開いたときは、そのときに取り直される（§14.14 の決めごとのまま）。

    バーのブランチ名も `↑ ↓` も、応答に載っている操作後の状態から変わる ──
    **追跡先がここで設定される**ので、`↑ ↓` は作った直後から出る。
  */
  const createTrackingBranch = useCallback(
    async (startPoint: string, name: string): Promise<GitOperationOutcome | null> => {
      return await operate(GIT_CREATE_TRACKING_BRANCH_OPERATION_KEY, () =>
        fluvix.git.createTrackingBranch({ startPoint, name })
      )
    },
    [operate]
  )

  /*
    退避（Session 3-8-15）。

    ## 経路は他の書き込み操作とまったく同じ

    `operate` を通り、二重の要求は目印で止まり、応答に載っている操作後の状態を
    そのまま使う。3種類の git（`stash push` / `pop` / `drop`）が動くが、
    **Renderer から見るとそこは何も変わらない** ── どの git が動くかは
    Main の中の話になる（3-8-14 で `git branch` が増えたときと同じ）。

    ## 通ったときだけ一覧を取り直す

    どれも面を閉じないため、ここで取り直さないと消えた行・増えた行が
    合わなくなる。失敗のときに取り直さないのは、**理由を読む前に一覧が
    入れ替わらないようにする**ため（3-8-14 の削除 / rename と同じ判断）。

    `quiet` を付けるのは、取り直しの間だけ面が「取得しています…」に
    戻らないようにするため ── 続けて片付けているときに、押すたびに
    一覧が消えると押す場所を見失う。

    ## `partly-applied`（競合した pop）でも取り直す

    退避は一覧に残っているが、**作業ツリーの側は変わっている** ── 取り直さない
    理由が無く、しかも一覧をそのまま出しておく方が「残っている」ことが
    画面で分かる（shared/git/operation.ts の `stash-apply`）。
  */
  const stashPush = useCallback(async (): Promise<GitOperationOutcome | null> => {
    const outcome = await operate(GIT_STASH_PUSH_OPERATION_KEY, () => fluvix.git.stashPush())

    if (outcome !== null && outcome.status !== 'failed') {
      void refreshStashes({ quiet: true })
    }

    return outcome
  }, [operate, refreshStashes])

  const stashPop = useCallback(
    async (entry: GitStashEntry): Promise<GitOperationOutcome | null> => {
      const outcome = await operate(GIT_STASH_POP_OPERATION_KEY, () =>
        fluvix.git.stashPop({ index: entry.index, shortHash: entry.shortHash })
      )

      if (outcome !== null && outcome.status !== 'failed') {
        void refreshStashes({ quiet: true })
      }

      return outcome
    },
    [operate, refreshStashes]
  )

  const stashDrop = useCallback(
    async (entry: GitStashEntry): Promise<GitOperationOutcome | null> => {
      const outcome = await operate(GIT_STASH_DROP_OPERATION_KEY, () =>
        fluvix.git.stashDrop({ index: entry.index, shortHash: entry.shortHash })
      )

      if (outcome !== null && outcome.status !== 'failed') {
        void refreshStashes({ quiet: true })
      }

      return outcome
    },
    [operate, refreshStashes]
  )

  /*
    remote の追加 / 削除（Session 3-8-16）。

    ## 経路は他の書き込み操作とまったく同じ

    `operate` を通り、二重の要求は目印で止まり、応答に載っている操作後の状態を
    そのまま使う。`git remote` を動かす初めての操作だが、**Renderer から見ると
    そこは何も変わらない** ── どの git が動くかは Main の中の話になる
    （3-8-14 で `git branch` が、3-8-15 で `git stash` が増えたときと同じ）。

    ## 通ったときだけ一覧を取り直す

    面を閉じないため、ここで取り直さないと消えた行・増えた行が合わなくなる。
    失敗のときに取り直さないのは、**理由を読む前に一覧が入れ替わらないように
    する**ため（3-8-14 / 3-8-15 と同じ判断）。

    `quiet` を付けるのは、取り直しの間だけ面が「取得しています…」に
    戻らないようにするため。

    ## `repository` の側は、応答が勝手に新しくしている

    追加が通ると `hasRemote` が false から true に変わり、パネルの下の
    「GitHub に公開」が消える ── そのために別の読み直しを足す必要は無い
    （`operate` が応答に載っている操作後の状態をそのまま使う）。
  */
  const addRemote = useCallback(
    async (name: string, url: string): Promise<GitOperationOutcome | null> => {
      const outcome = await operate(GIT_ADD_REMOTE_OPERATION_KEY, () =>
        fluvix.git.addRemote({ name, url })
      )

      if (outcome?.status === 'applied') {
        void refreshRemotes({ quiet: true })
      }

      return outcome
    },
    [operate, refreshRemotes]
  )

  const removeRemote = useCallback(
    async (remote: GitRemote): Promise<GitOperationOutcome | null> => {
      const outcome = await operate(GIT_REMOVE_REMOTE_OPERATION_KEY, () =>
        fluvix.git.removeRemote({ name: remote.name })
      )

      if (outcome?.status === 'applied') {
        void refreshRemotes({ quiet: true })
      }

      return outcome
    },
    [operate, refreshRemotes]
  )

  /*
    remote の URL の変更 / rename（Session 3-8-17）。

    経路は追加 / 削除とまったく同じで、**目印だけが別**になる ──
    走っている操作の名前がそのままボタンの文字を決めるため
    （renderer/src/git/gitRemotes.ts）。

    通ったときだけ一覧を取り直すのも同じ ── URL の変更では行の**ラベル**が、
    rename では行の**名前**が入れ替わる。どちらも一覧を取り直さないと、
    面に古い値が出たままになる。

    `repository` の側は応答が新しくしている ── ただしどちらの操作でも
    `hasRemote` は変わらない（remote の数は増えも減りもしない）。
    rename では追跡先が追随するため上のバーの `↑ ↓` はそのまま残り、
    URL の変更では `↑ ↓` の数そのものが変わらない（比べる相手が
    手元の remote-tracking ref のままのため。main/git/gitRemotes.ts）。
  */
  const setRemoteUrl = useCallback(
    async (remote: GitRemote, url: string): Promise<GitOperationOutcome | null> => {
      const outcome = await operate(GIT_SET_REMOTE_URL_OPERATION_KEY, () =>
        fluvix.git.setRemoteUrl({ name: remote.name, url })
      )

      if (outcome?.status === 'applied') {
        void refreshRemotes({ quiet: true })
      }

      return outcome
    },
    [operate, refreshRemotes]
  )

  const renameRemote = useCallback(
    async (remote: GitRemote, newName: string): Promise<GitOperationOutcome | null> => {
      const outcome = await operate(GIT_RENAME_REMOTE_OPERATION_KEY, () =>
        fluvix.git.renameRemote({ name: remote.name, newName })
      )

      if (outcome?.status === 'applied') {
        void refreshRemotes({ quiet: true })
      }

      return outcome
    },
    [operate, refreshRemotes]
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
    resolveConflict,
    discard,
    diffRequest,
    diff,
    openDiff,
    closeDiff,
    commit,
    push,
    pull,
    fetch: fetchFromRemote,
    mergeMessage,
    commitAndPush,
    branches,
    refreshBranches: requestBranches,
    remoteBranches,
    history,
    historyOpen,
    openHistory,
    closeHistory,
    commitDetail,
    openCommitDetail,
    closeCommitDetail,
    switchBranch,
    createBranch,
    createBranchFromCommit,
    deleteBranch,
    renameBranch,
    mergeBranch,
    abortMerge,
    createTrackingBranch,
    remotes,
    remoteOpen,
    openRemotes,
    closeRemotes,
    addRemote,
    setRemoteUrl,
    renameRemote,
    removeRemote,
    stashes,
    stashOpen,
    openStash,
    closeStash,
    stashPush,
    stashPop,
    stashDrop,
    githubStatus,
    refreshGitHubStatus: requestGitHubStatus,
    publishToGitHub
  }
}
