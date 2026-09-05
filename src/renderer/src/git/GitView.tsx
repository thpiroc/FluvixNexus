import type { JSX, KeyboardEvent } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  GitCommitFileChange,
  GitDiscardTarget,
  GitFileChange,
  GitGuardedOperation
} from '@shared/git'
import { useEditorContext } from '../editor/context'
import { useI18n } from '../i18n/context'
import { useWorkspaceFolder } from '../workspaceFolder/context'
import { GitBranchMenu } from './GitBranchMenu'
import { GitDiffOverlay } from './GitDiffOverlay'
import { GitDiscardConfirm } from './GitDiscardConfirm'
import { GitHistoryOverlay } from './GitHistoryOverlay'
import { GitHubPublishForm } from './GitHubPublishForm'
import { GitInitConfirm } from './GitInitConfirm'
import { GitRemoteOverlay } from './GitRemoteOverlay'
import { GitStashOverlay } from './GitStashOverlay'
import { DiffIcon, DiscardIcon, ResolveIcon, StageIcon, UnstageIcon } from './GitIcons'
import {
  canDiscardGitChange,
  canOpenGitChange,
  countGitChanges,
  describeGitChangeKind,
  describeGitChangeRow,
  describeGitRowAction,
  describeGitOperationFailure,
  describeGitUpstream,
  findGitDiscardBlocker,
  GIT_COMMIT_AND_PUSH_OPERATION_KEY,
  GIT_COMMIT_OPERATION_KEY,
  GIT_FETCH_OPERATION_KEY,
  GIT_INIT_OPERATION_KEY,
  GIT_PULL_OPERATION_KEY,
  GIT_PUSH_OPERATION_KEY,
  toGitChangeGroups,
  toGitCommitAndPushReadiness,
  toGitCommitReadiness,
  toGitFetchReadiness,
  toGitDiscardGroup,
  toGitGroupStageTarget,
  toGitOperationKey,
  toGitPullReadiness,
  toGitPushReadiness,
  toGitRowAction,
  type GitActionReadiness,
  type GitChangeGroup,
  type GitCommitReadiness,
  type GitRowAction
} from './gitChanges'
import { describeGitAbortMergeWarning } from './gitBranches'
import {
  describeGitInProgressBlock,
  describeGitInProgressNotice,
  withGitInProgressBlock,
  withGitInProgressCommitBlock,
  type GitInProgressNotice
} from './gitInProgress'
import { canDiffGitChange, toGitDiffGroup } from './gitDiff'
import { GIT_ADD_REMOTE_OPERATION_KEY } from './gitRemotes'
import { GIT_STASH_PUSH_OPERATION_KEY, toGitStashPushReadiness } from './gitStash'
import { GITHUB_PUBLISH_OPERATION_KEY } from './githubPublish'
import { describeGitRepositoryNotice } from './gitRepositoryMessage'
import { useGitRepository } from './useGitRepository'
import type { TFunction } from '../i18n/messages'

/**
 * Git パネルの中身（Session 3-8-1 / 3-8-2 / 3-8-3 / 3-8-4 / 3-8-5 / 3-8-6 / 3-8-9 /
 * 3-8-10 / 3-8-11）。
 *
 * ## 出しているのは DESIGN.md §3 の「①変更確認 → ②コミットメッセージ → ③Commit & Push」
 *
 * §3 の GitHub パネルはこの順に並ぶ。Session 3-8-1 でその手前（そもそも使えるか）を、
 * 3-8-2 で①を、3-8-4 で②と③の前半（Commit）を置き、3-8-5 で③の残り
 * （Commit & Push / Push / Pull）をその下へ積んだ。**足すのは下へ**で、
 * VS Code のように入力欄を一覧の上へ持ってくる形へは寄せない（設計判断 2）。
 *
 * 画面は3つの形しか持たない。
 *
 *   使えない … 理由と、次の一手（gitRepositoryMessage.ts）
 *   変更なし … ブランチ名と「変更はありません」と、押せない Commit 欄
 *   変更あり … ブランチ名と、グループ分けされた一覧と、Commit 欄
 *
 * **Commit 欄は変更が無くても出したままにする。** 変更があるときだけ現れる形に
 * すると、ファイルを1つ保存した瞬間に画面の下半分が生えてきて、一覧の位置まで動く。
 * 押せないことは button の見た目と、その左の一言で伝わる。
 *
 * ## 押せるものを、押せる操作の数だけにする
 *
 * Session 3-8-2 の時点で押せたのは**再取得**と**行を押してファイルを開く**の2つだけで、
 * Stage / Unstage / Commit / 破棄のボタンは1つも置いていなかった ── 押しても何も
 * 起きないボタンや、半分だけ効く操作を先に並べると、利用者はそれを「壊れている」と
 * 受け取るため（3-8-1 で `git init` のボタンを出さなかったのと同じ判断）。
 *
 * Session 3-8-3 で足したのは、その原則どおり**本当に効く2つ**だけになる。
 *
 *   行の `＋` / `−` … その1件を Stage / Unstage する
 *   見出しの「すべて Stage」 … そのグループの全部を Stage する
 *
 * 競合の行には置かない（解決するまでどちらの操作も意味を持たない）。
 * ステージ済みの見出しに「すべて Unstage」も置かない ── どちらも
 * gitChanges.ts が1箇所で決めていて、行を描く側の if には散らさない。
 *
 * Session 3-8-4 で足したのは Commit の1つで、その押せる条件も
 * gitChanges.ts（`toGitCommitReadiness`）が決める。**押せない理由を
 * 一緒に返させている**のは、条件が3つあるため ── 薄いボタンだけを置くと、
 * なぜ押せないのかがどこにも出ない。
 *
 * Session 3-8-5 で足した3つ（Commit & Push / Push / Pull）も同じ形で、
 * 押せるかどうかと理由を gitChanges.ts が一緒に返す。**理由の置き場所だけが違う** ──
 * Commit の一言は入力欄の下に出せるが、横に並ぶ小さなボタンには文章を置く場所が
 * 無いため、そちらは hover と読み上げに渡している（`GitSyncButton`）。
 *
 * Session 3-8-6 で足したものは、**下ではなく上のバーの中**にある ──
 * それまで文字だけだったブランチ名を押せるようにし、その面の中で
 * 切り替えと作成を行う（GitBranchMenu.tsx）。新しい場所を作っていないのは、
 * 「今どこに居るか」と「どこへ行けるか」が同じ問いの表と裏だからで、
 * 押す前と押した後で目が動かずに済む。
 *
 * **未保存の変更があっても、アプリからは確認を出さない。** 切り替えてよいかを
 * 決めるのは git 自身で（`--force` も `--merge` も渡していない）、
 * 失われるものがあるときは git が断る（main/git/gitBranches.ts）。
 *
 * 破棄は引き続き置いていない（戻せない操作は確認の形と一緒に設計する）。
 * 強制 Push も同じ理由で置いていない ── 他人の commit を消しうる操作で、
 * 押し間違えたときに戻せない（shared/git/operation.ts）。
 *
 * ## 操作の失敗でパネルを壊さない
 *
 * Stage が通らなかったときも、出るのは一覧の上の1行だけになる。案内の画面へ
 * 差し替えないのは、**リポジトリは見えている**ため ── そこで一覧を消すと、
 * 利用者は「何が Stage されているのか」を確かめる手立てまで失う。
 * 一覧そのものは操作の応答に載って届いた**新しい状態**に差し替わっている
 * （useGitRepository.ts）。
 *
 * ## ファイルを開く経路を新しく作らない
 *
 * 行から開くのは `openFile({ relativePath, name })`（editor/context.ts）で、
 * Files のツリーの行・カラムの行・検索結果とまったく同じ入口になる。
 * Git 専用の経路を作ると、「タブが2枚できる」「未保存の確認が効かない」といった
 * 差が Git から開いたときだけ現れることになる。
 *
 * 同じ形にできるのは、Main から届く path が Workspace root からの相対位置で
 * あるため（shared/git/status.ts）── Workspace root ＝ リポジトリ root のときしか
 * 一覧を出さないので、git の path はそのまま Files の relativePath になる。
 *
 * ## 文言と分類をここに書かない
 *
 * 何を出すかは gitRepositoryMessage.ts（使えない状態）と gitChanges.ts（一覧）が
 * 決める。どちらも React 非依存でテストがあり、このコンポーネントが持つのは配置だけになる。
 */
export function GitView(): JSX.Element {
  const {
    status,
    repository,
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
    fetch,
    mergeMessage,
    commitAndPush,
    branches,
    refreshBranches,
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
    refreshGitHubStatus,
    publishToGitHub
  } = useGitRepository()
  const { t } = useI18n()
  const { openFile, unsavedTabs } = useEditorContext()
  /*
    Workspace の表示名（Session 3-8-10）。

    使うのは2箇所 ── 初期化の確認に出す名前と、公開する repository 名の
    初期値になる。**Main から取り直さない**（Files / Terminal と同じ写しを見る）
    ── Git の応答に名前を載せると、同じものの出どころが2つになる。
  */
  const { workspace } = useWorkspaceFolder()
  const workspaceName = workspace?.displayName ?? ''

  /*
    初期化の確認を出しているか（Session 3-8-10）。

    Commit メッセージや破棄の確認と同じくここが持つ ── フックが持っているのは
    「git に聞けば分かること」の写しで、これは**まだ何も起きていない、
    押すかどうかの途中**にあたる。
  */
  const [initializing, setInitializing] = useState(false)

  /*
    Commit メッセージ（Session 3-8-4）。

    フック（useGitRepository）ではなくここが持つ。あちらが持っているのは
    「git に聞けば分かること」の写しで、これは**まだどこにも渡していない
    書きかけの文章**にあたる ── 一覧を読み直すたびに触れる場所へ置くと、
    いつか読み直しの都合で消える。

    パネルを畳めば消える（＝ Editor の未保存の中身とは扱いが違う）。
    Commit メッセージは書き直せるもので、閉じるまでの間だけ持てば足りる。
  */
  const [message, setMessage] = useState('')

  /*
    マージに入ったら、git が用意した文章を**空の欄にだけ**入れる
    （Session 3-8-22A）。

    ## 上書きしない

    条件を「欄が空のとき」にしてあるので、既に書き始めていれば何も起きない。
    利用者が自分で消した場合も、この効果は**次に届いた既定値でしか
    走らない**（依存が `mergeMessage` だけ）── 消したそばから書き戻される、
    という形にはならない。

    ## マージが終われば `mergeMessage` は null に戻る（useGitRepository.ts）

    そのとき欄を空へ戻すことはしない ── Commit が通れば `clearIfUnchanged` が
    既に空にしており、通っていないなら**その文章はまだ必要**にあたる。
  */
  useEffect(() => {
    if (mergeMessage === null) {
      return
    }

    setMessage((current) => (current === '' ? mergeMessage : current))
  }, [mergeMessage])

  /*
    破棄の確認を出している対象（Session 3-8-9）。

    Commit メッセージと同じくここが持つ ── フック（useGitRepository）が
    持っているのは「git に聞けば分かること」の写しで、これは
    **まだ何も起きていない、押すかどうかの途中**にあたる。
  */
  const [discarding, setDiscarding] = useState<{
    readonly group: GitDiscardTarget['group']
    readonly change: GitFileChange
  } | null>(null)

  /*
    マージの中止の確認を出しているか（Session 3-8-20）。

    破棄・初期化の確認と同じくここが持つ ── フックが持っているのは
    「git に聞けば分かること」の写しで、これは**まだ何も起きていない、
    押すかどうかの途中**にあたる。

    マージが終われば帯ごと消えるので、閉じ忘れが残る余地は無い
    （帯が出ていないときは、この確認を出す場所そのものが無い）。
  */
  const [aborting, setAborting] = useState(false)

  /*
    Files の行を押したときとまったく同じ呼び出し（files/FilesView.tsx）。
    名前は relativePath から導く（gitChanges.ts）── Main から2つ受け取る形にすると、
    片方だけ食い違った値が渡る余地ができる。
  */
  const open = useCallback(
    (change: GitFileChange): void => {
      openFile({
        relativePath: change.relativePath,
        name: describeGitChangeRow(change, t).name
      })
    },
    [openFile, t]
  )

  /*
    行の操作。押した対象を目印にして、その行のボタンだけを押せなくする
    （useGitRepository.ts）── 一覧ごと止めると、続けて何件も Stage する
    という普通の使い方が1件ずつ待つ作業になる。
  */
  const act = useCallback(
    (action: Exclude<GitRowAction, null>, change: GitFileChange): void => {
      if (action === 'stage') {
        stage({ kind: 'file', relativePath: change.relativePath })
        return
      }

      /*
        競合の解決（Session 3-8-18）。**Stage とは別の口**へ行く ── 動かす
        git は同じ `git add` だが、index の3段を1段に畳む操作で意味が違う
        （main/git/gitConflict.ts）。確認は挟まない（利用者が書いた中身は
        1文字も動かない）が、マーカーが残っていれば Main が断る。
      */
      if (action === 'resolve') {
        resolveConflict(change.relativePath)
        return
      }

      unstage(change.relativePath)
    },
    [stage, unstage, resolveConflict]
  )

  /*
    差分を見る / 破棄する（Session 3-8-9）。

    どちらも押した行そのものを持ち回る（位置だけではない）── 見出しに出す
    ものが位置だけでは決まらず、一覧が読み直されても押した行を出し続けられる
    （gitDiff.ts）。
  */
  const showDiff = useCallback(
    (groupId: GitChangeGroup['id'], change: GitFileChange): void => {
      const group = toGitDiffGroup(groupId)

      /*
        競合の行は別のチャンネルへ行く（Session 3-8-21）。

        `toGitDiffGroup` が null を返すのは競合のときだけで、3-8-9 では
        そこで**何もせずに戻っていた**（そもそもボタンを置いていなかった）。
        3-8-21 でその行にもボタンが付いたので、戻る代わりに競合の要求を作る。

        `merging` を一緒に渡すのは、**左右のラベルの意味づけがそれで変わる**
        ため（gitDiff.ts の `describeGitConflictDiffSides`）── 開いた瞬間の
        値を渡すので、面が開いている間に中止されてもラベルは動かない。
      */
      if (group === null) {
        openDiff({
          source: 'conflict',
          change,
          /*
            左右のラベルを「現在のブランチ / 取り込み側」と断定してよいのは
            **マージの途中だけ**になる（Session 3-8-21）。3-8-22A で状態が
            4つに増えたが、断定してよい条件は1つのまま ── rebase /
            cherry-pick / revert では ours / theirs の意味が入れ替わったり
            当てはまらなかったりするので、中立の表現が受け皿になる。
          */
          merging: repository.status === 'ready' && repository.inProgress === 'merge'
        })
        return
      }

      openDiff({ source: 'worktree', group, change })
    },
    [openDiff, repository]
  )

  /*
    commit の中の1ファイルの差分（Session 3-8-12）。

    開く面は変更ファイルの一覧から開くものと**同じ**で、渡す要求の形だけが
    違う（gitDiff.ts の `GitDiffRequest`）── 開いている commit を一緒に
    持ち回るのは、見出しに短い hash を出すためと、中身を訊く先を決めるため
    になる。
  */
  const showCommitFileDiff = useCallback(
    (file: GitCommitFileChange): void => {
      if (commitDetail === null) {
        return
      }

      openDiff({ source: 'commit', commit: commitDetail.commit, file })
    },
    [commitDetail, openDiff]
  )

  const askDiscard = useCallback((groupId: GitChangeGroup['id'], change: GitFileChange): void => {
    const group = toGitDiscardGroup(groupId)

    if (group === null) {
      return
    }

    setDiscarding({ group, change })
  }, [])

  /**
   * 未保存の Editor タブがある位置。
   *
   * ここで作るのは**位置の集合**だけで、タブそのものは Git 側へ持ち込まない
   * （gitChanges.ts の `findGitDiscardBlocker` が受け取るのもこれになる）。
   * `unsavedTabs` は中身が変わらない限り同じ配列が返るため（useEditorTabs.ts）、
   * 数え直しは実際に未保存が増減したときにだけ走る。
   */
  const unsavedPaths = useMemo(
    () => new Set(unsavedTabs.map((tab) => tab.relativePath)),
    [unsavedTabs]
  )

  const runDiscard = useCallback((): void => {
    if (discarding === null) {
      return
    }

    discard({ group: discarding.group, relativePath: discarding.change.relativePath })
    setDiscarding(null)
  }, [discard, discarding])

  /*
    Commit（Session 3-8-4）。

    **通ったときだけ入力欄を空にする。** 失敗したときに消すと、書いた文章が
    失われたうえで「もう一度書いてやり直してください」と言うことになる ──
    名乗りが未設定・hook が止めた、はどれも文章とは無関係な理由で、
    直したうえで同じ文章のまま押し直せる必要がある。
  */
  const clearIfUnchanged = useCallback((committed: string): void => {
    /*
      消すのは、**Commit したその文章がまだ残っている**ときだけ。
      hook のあるリポジトリでは Commit に数秒かかることがあり、Push まで行えば
      さらに長くなる ── その間に次の文章を書き始められるため、
      無条件に消すと書きかけを奪うことになる。
    */
    setMessage((current) => (current === committed ? '' : current))
  }, [])

  const runCommit = useCallback((): void => {
    void commit(message).then((applied) => {
      if (applied) {
        clearIfUnchanged(message)
      }
    })
  }, [clearIfUnchanged, commit, message])

  /*
    Commit & Push（Session 3-8-5）。

    `commitAndPush` が返すのは **Commit が作られたか**で、Push まで通ったかでは
    ない（useGitRepository.ts）── Push だけが失敗した場合、その文章は既に
    履歴に記録されているため、欄に残すと同じ内容をもう一度 Commit しかねない。
    残った Push は、下の Push ボタンをそのまま押し直せばよい。
  */
  const runCommitAndPush = useCallback((): void => {
    void commitAndPush(message).then((committed) => {
      if (committed) {
        clearIfUnchanged(message)
      }
    })
  }, [clearIfUnchanged, commitAndPush, message])

  /*
    取得中は何も出さない。案内を先に出すと、リポジトリが開けている場合でも
    一瞬「リポジトリではありません」が見える（FilesPanel / TerminalPanel と同じ）。
  */
  if (status === 'loading') {
    return <div className="fx-git" />
  }

  const notice = describeGitRepositoryNotice(repository, t)

  if (notice !== null) {
    return (
      <div className="fx-git fx-git--notice">
        <p className="fx-git__title">{notice.title}</p>
        {notice.description === null ? null : (
          <p className="fx-git__description">{notice.description}</p>
        )}
        {/*
          その状態から抜け出す操作（Session 3-8-10）。

          出すかどうかを決めるのは gitRepositoryMessage.ts で、ここが持つのは
          押したときに何をするかだけになる ── 今のところ1つ（`git init`）で、
          **押しても即座には何も起きない**（確認が出る）。

          「もう一度確認する」の**左**に置く。左から右へ「進む → 調べ直す」で、
          いちばん右にいちばん押されないものが来る並びは一覧の行と同じ。
        */}
        {notice.action === null ? null : (
          <button
            type="button"
            className="fx-git__action"
            data-variant="primary"
            onClick={() => setInitializing(true)}
            disabled={busy || pending.has(GIT_INIT_OPERATION_KEY)}
          >
            {notice.action}
          </button>
        )}
        {notice.retryable ? (
          <button type="button" className="fx-git__action" onClick={refresh} disabled={busy}>
            {t('common.actions.retry')}
          </button>
        ) : null}
        {/*
          操作の失敗は、案内の画面でも出す（Session 3-8-10）── 初期化を
          押したのに何も起きなかった場合、理由を出せる場所がここしか無い
          （一覧はまだ存在しない）。
        */}
        {failure === null ? null : (
          <p className="fx-git__operation-error" role="status">
            {describeGitOperationFailure(failure, t)}
          </p>
        )}
        {initializing ? (
          <GitInitConfirm
            workspaceName={workspaceName}
            t={t}
            busy={pending.has(GIT_INIT_OPERATION_KEY)}
            onConfirm={() => {
              init()
              setInitializing(false)
            }}
            onCancel={() => setInitializing(false)}
          />
        ) : null}
      </div>
    )
  }

  // 案内が無い ＝ ready。型の上でも他の状態はここへ来ない。
  if (repository.status !== 'ready') {
    return <div className="fx-git" />
  }

  const groups = toGitChangeGroups(repository.changes, t)
  const total = countGitChanges(repository.changes)
  const upstream = describeGitUpstream(repository.upstream, t)

  /*
    Commit が押せるか（gitChanges.ts）。

    `pending.size > 0` を渡しているのは、Commit の中身が「ステージ済みの全体」
    だからになる ── 行の Stage が1件走っている間にも Commit できてしまうと、
    画面に出ている一覧とは違うものが commit に入りうる。行の操作どうしが
    互いを止めないのとは、そこが違う。
  */
  const operating = pending.size > 0
  const commitReady = toGitCommitReadiness(message, repository.changes.staged.length, operating, t)
  const committing = pending.has(GIT_COMMIT_OPERATION_KEY)

  /*
    Push / Pull / Commit & Push（Session 3-8-5）。

    Commit と同じく `operating`（何かしらの Git 操作が動いている）で止める ──
    どれも「今のブランチ全体」を相手にする操作で、走っている Stage / Commit は
    まさにその中身を変えている最中にあたる。行の `＋` / `−` が押した対象だけを
    止めるのとは性質が違う。
  */
  /*
    途中の Git 操作による禁止（Session 3-8-22A）。

    ## 被せる形にしてある

    既にある readiness の引数を1つずつ増やして回るのではなく、**上から被せる**
    （renderer/src/git/gitInProgress.ts の `withGitInProgressBlock`）── 引数を
    増やす形だと、渡し忘れた1つが静かに素通りする。被せる形なら、
    被せていない呼び出しは**ここに並んでいないこと**として見て分かる。

    ## 何を通さないかは、ここでは決めない

    決めるのは shared/git/inProgress.ts の表で、Main が届いた要求に対して
    見るのとまったく同じものになる ── 画面が押せなくするのは
    「できない操作を見せない」ためで、許可の根拠は Main の側に在る。
  */
  const guard = (operation: GitGuardedOperation): string | null =>
    describeGitInProgressBlock(repository.inProgress, operation, t)

  const pushReady = withGitInProgressBlock(
    toGitPushReadiness(repository.head, repository.upstream, operating, t),
    guard('push')
  )
  const pullReady = withGitInProgressBlock(
    toGitPullReadiness(repository.head, repository.upstream, operating, t),
    guard('pull')
  )
  const fetchReady = withGitInProgressBlock(toGitFetchReadiness(operating, t), guard('fetch'))
  const commitAndPushReady = withGitInProgressBlock(
    toGitCommitAndPushReadiness(commitReady, repository.head, t),
    guard('commit-and-push')
  )
  const guardedCommitReady = withGitInProgressCommitBlock(commitReady, guard('commit'))
  /*
    行の操作（Stage / Unstage / 解決 / 破棄）は readiness を持たない ──
    3-8-3 から「押せる操作の数だけボタンを置く」形で、押せないときは
    場所ごと作らない。したがって渡すのは**押せなくする理由が在るか**だけになる。

    4つを1つにまとめず別々に聞いているのは、表がそれぞれに答えを持つため
    （マージの途中では4つとも通り、rebase の途中では4つとも通らない ──
    今は同じ答えになるが、それを**ここで決め打ちしない**）。
  */
  const rowBlocked =
    guard('stage') ?? guard('unstage') ?? guard('resolve-conflict') ?? guard('discard')

  /*
    途中の操作の帯（Session 3-8-20 / 3-8-22A）。文言と、中止の口を出すかを
    決めるのは gitInProgress.ts で、ここが持つのは置き場所だけになる。
  */
  const inProgressNotice = describeGitInProgressNotice(repository.inProgress, t)

  return (
    <div className="fx-git">
      <div className="fx-git__bar">
        {/* 何の名前かが分かるようにする。ブランチ名だけだと、それが何なのか伝わらない。 */}
        <span className="fx-git__branch-label">{t('git.panel.branchPanelLabel')}</span>
        {/*
          ブランチ名を押せる場所にする（Session 3-8-6）。

          出す文字はそれまでと同じ（今どこに居るか）で、**押すと切り替え先を
          選べる**ようになっただけ ── 一覧を出すための場所を新しく作らず、
          既にそこに在ったものを押せるようにしてある。

          `operating` を渡しているのは Commit / Push と同じ理由で、
          切り替えは「今のブランチ全体」を相手にする操作にあたる。
        */}
        <GitBranchMenu
          head={repository.head}
          list={branches}
          /*
            remote-tracking branch の一覧（Session 3-8-19）。

            ローカルの一覧と**別の props** で渡す ── 届くのは別のチャンネルで、
            上限も `truncated` も別々に効く（shared/ipc/contracts/git.ts）。
            `onOpen` は 3-8-6 のまま1つで、2本を取り直すのはフックの側になる。
          */
          remoteList={remoteBranches}
          operating={operating}
          /*
            マージ中は行の ⤵ を押せなくする（Session 3-8-20）── 状態から
            そのまま渡す。面の側で「競合の行があるか」から推し量らせない
            （shared/git/repository.ts）。
          */
          inProgress={repository.inProgress}
          onOpen={refreshBranches}
          onSwitch={switchBranch}
          onCreate={createBranch}
          onDelete={deleteBranch}
          onRename={renameBranch}
          onMerge={mergeBranch}
          onCreateTracking={createTrackingBranch}
          t={t}
        />
        {upstream === null ? null : (
          <span className="fx-git__upstream" title={upstream.title}>
            {upstream.text}
          </span>
        )}
        {/*
          履歴（Session 3-8-11）。

          置き場所は**上のバー**にする。「足すのは下へ」（DESIGN.md 設計判断 2）が
          効くのは①〜③の一続き（変更 → メッセージ → Commit / Push）の上での話で、
          履歴はその流れの上に無い ── ブランチと同じく**その流れをどこで
          行っているか**の側にあたる（GitBranchMenu.tsx と同じ判断）。
          下に積むと、Commit 欄と Push の間に「読むだけのもの」が挟まる。

          **押せなくする条件を持たない。** 他の Git 操作が動いていても、
          何も書き換えない読み取りは邪魔にならない（差分ボタンと同じ）。
        */}
        <button
          type="button"
          className="fx-git__history-open"
          onClick={openHistory}
          title={t('git.panel.historyTitle')}
          aria-label={t('git.panel.historyTitle')}
        >
          {t('git.panel.historyLabel')}
        </button>
        {/*
          退避（Session 3-8-15）。

          置き場所は履歴の**隣**にする。どちらも「①〜③の一続きの上に無い
          もの」で、開くのは面になる ── 下に積むと、Commit 欄と Push の間に
          「今の作業ではないもの」が挟まる（DESIGN.md 設計判断 2 が効くのは
          ①変更 → ②メッセージ → ③Commit / Push の並びの上での話になる）。

          **押せなくする条件を持たない。** 一覧を開くこと自体は読み取りで、
          他の Git 操作が動いていても邪魔にならない（履歴と同じ）── 押せない
          のは面の中の「作業ツリーを退避」の側で、そちらは gitStash.ts が決める。
        */}
        <button
          type="button"
          className="fx-git__stash-open"
          onClick={openStash}
          title={t('git.panel.stashTitle')}
          aria-label={t('git.panel.stashTitle')}
        >
          {t('git.panel.stashLabel')}
        </button>
        {/*
          リモート（Session 3-8-16）。

          置き場所は履歴・退避の**隣**にする。3つとも「①変更 → ②メッセージ →
          ③Commit / Push の一続きの上に無いもの」で、開くのは面になる
          （DESIGN.md 設計判断 2 が効くのはその並びの上での話）。

          ## `hasRemote` に関わらず、常に同じ場所に在る

          remote が無いときだけ出す形にはしない ── そうすると、**押す場所が
          リポジトリの状態で動く**ことになる。remote が1つも無い人にとっても
          「ここが接続する場所」であることは変わらず、下の「GitHub に公開」の
          隣に置いた導線（後述）もここへ来る。

          **押せなくする条件を持たない。** 一覧を開くこと自体は読み取りで、
          他の Git 操作が動いていても邪魔にならない（履歴・退避と同じ）──
          押せないのは面の中の「追加」と ✕ の側で、そちらは gitRemotes.ts が決める。
        */}
        <button
          type="button"
          className="fx-git__remote-open"
          onClick={openRemotes}
          title={t('git.panel.remoteTitle')}
          aria-label={t('git.panel.remoteTitle')}
        >
          {t('git.panel.remoteLabel')}
        </button>
        <button
          type="button"
          className="fx-git__refresh"
          onClick={refresh}
          disabled={busy}
          // 記号だけのボタンなので、読み上げと hover の両方に名前を用意する。
          title={t('git.panel.refreshTitle')}
          aria-label={t('git.panel.refreshLabel')}
        >
          ⟳
        </button>
      </div>
      {/*
        操作の失敗は一覧の上に1行だけ。閉じるボタンを付けていないのは、
        次の操作が通れば消えるため ── 消し方を覚える必要のあるものを増やさない。
      */}
      {failure === null ? null : (
        <p className="fx-git__operation-error" role="status">
          {describeGitOperationFailure(failure, t)}
        </p>
      )}
      {/*
        マージの途中であることの帯（Session 3-8-20）。

        ## 置き場所は上のバーの**すぐ下**

        一覧より上に出す ── ここに出ている競合の行が「なぜ競合しているのか」
        を先に言うためになる（`stash pop` の競合と見分けが付かないと、
        利用者は `merge --abort` という出口があることに気づけない）。

        失敗の1行より下に置いてあるのは、あちらが**押した1回の結末**で、
        こちらが**今の状態**だからになる ── 競合したマージでは2つが同時に
        出るが、先に読むべきなのは「今どこで止まっているか」ではなく
        「押した結果どうなったか」の方にあたる。

        ## 出すのは途中の操作があるときだけ

        `inProgress` は Main が ref から読んだ値そのもの
        （shared/git/repository.ts）── 競合の行の有無からは導かない。
        解決し終えた後（競合の行が0件になった後）も Commit するまでは
        出続ける、というのがここで効く違いになる。

        ## 3-8-22A で、帯が4つの状態を出し分けるようになった

        3-8-20 の時点ではマージ1つだった。rebase / cherry-pick / revert では
        **中止の口を出さない** ── アプリはその3つを始められず、終わらせる口も
        持たないため、行き先は Terminal になる（文言がそれを言う。
        renderer/src/git/gitInProgress.ts）。押しても何も起きないボタンを
        置かない、という 3-8-2 からの線がそのまま効いている。
      */}
      {inProgressNotice === null ? null : (
        <GitInProgressBanner
          notice={inProgressNotice}
          operating={operating}
          aborting={aborting}
          onOpenAbort={() => setAborting(true)}
          onCancelAbort={() => setAborting(false)}
          onAbort={() => {
            void abortMerge().then((outcome) => {
              /*
                通ったら確認を畳む。通らなかったときに畳まないのは、
                理由（パネルの上の1行）を読んでからもう一度押せるように
                するため ── 畳むと、押す場所を開き直すことになる。
              */
              if (outcome !== null && outcome.status === 'applied') {
                setAborting(false)
              }
            })
          }}
          t={t}
        />
      )}
      <div className="fx-git__body">
        {total === 0 ? (
          <p className="fx-git__empty">{t('git.panel.clean')}</p>
        ) : (
          groups.map((group) => {
            const groupTarget = toGitGroupStageTarget(group.id)
            const action = toGitRowAction(group.id)

            return (
              <section key={group.id} className="fx-git__group" data-group={group.id}>
                <h3 className="fx-git__group-title">
                  <span className="fx-git__group-label">{group.label}</span>
                  {/* 件数は見出しの一部。畳めない一覧でも「あと何件あるか」が要る。 */}
                  <span className="fx-git__group-count">{group.changes.length}</span>
                  {groupTarget === null ? null : (
                    <button
                      type="button"
                      className="fx-git__group-action"
                      onClick={() => stage(groupTarget)}
                      disabled={pending.has(toGitOperationKey(groupTarget)) || rowBlocked !== null}
                      /*
                        押せない理由をここでも出す（Session 3-8-22A）── 行の
                        ボタンは「場所ごと作らない」形で消えるが、見出しの
                        ボタンは**そこに在り続ける**（グループの件数の隣に
                        空きができると、一覧の形が状態で変わる）。
                      */
                      title={rowBlocked ?? t('git.panel.stageAllTitle', { label: group.label })}
                    >
                      {t('git.panel.stageAllLabel')}
                    </button>
                  )}
                </h3>
                <ul className="fx-git__changes">
                  {group.changes.map((change) => (
                    <GitChangeRow
                      key={`${change.kind}:${change.relativePath}`}
                      groupId={group.id}
                      change={change}
                      action={action}
                      busy={pending.has(
                        toGitOperationKey({ kind: 'file', relativePath: change.relativePath })
                      )}
                      blocked={rowBlocked}
                      onOpen={open}
                      onAct={act}
                      onDiff={showDiff}
                      onDiscard={askDiscard}
                      t={t}
                    />
                  ))}
                </ul>
              </section>
            )
          })
        )}
      </div>
      {/*
        ②コミットメッセージ → ③Commit（DESIGN.md §3 の並び）。

        一覧の**下**に置く。上から順に「何が変わったか → 何と書くか → 押す」と
        読めるようにしてあり、VS Code のように入力欄を一覧の上へ置く形へは
        寄せていない（設計判断 2）。

        一覧が伸びても押し出されないよう、ここは縮まない（git.css）。
      */}
      <GitCommitForm
        message={message}
        onChange={setMessage}
        onCommit={runCommit}
        onCommitAndPush={runCommitAndPush}
        readiness={guardedCommitReady}
        pushReadiness={commitAndPushReady}
        committing={committing}
        pushing={pending.has(GIT_COMMIT_AND_PUSH_OPERATION_KEY)}
        t={t}
      />
      {/*
        Pull / Push（Session 3-8-5）。

        Commit 欄の**下**に置く。上から下へ「①何が変わったか → ②何と書くか →
        ③Commit → 送る / 受け取る」と読める並びのままで、DESIGN.md 設計判断 2
        （足すのは下へ）をここでも動かしていない。

        Pull を左に置いてあるのは、**Push が断られたときの次の一手が Pull** に
        なるため ── 「先に Pull してください」と出たときに、目が右から左へ
        戻らずに済む。
      */}
      <div className="fx-git__sync">
        {/*
          Fetch（Session 3-8-22A）。

          ## Pull の左に置く

          並びは左から「取ってくる → 取り込む → 送る」で、**手前の段ほど左**に
          なる（Pull を Push の左に置いたのと同じ理由 ── Push が断られたときの
          次の一手が Pull で、Pull が断られたときに何が来ているかを見る手が
          Fetch にあたる）。

          ## 上のバーではなく、ここに置く

          履歴 / 退避 / リモートの3つはバーに在るが、あれは「①変更 → ②メッセージ
          → ③Commit / Push の一続きの上に無いもの」で、**開くのは面**だった。
          Fetch は面を開かず、押すと git が動いて上のバーの `↓1` が変わる ──
          Push / Pull と同じ性質の操作なので、同じ並びに置く。
        */}
        <GitSyncButton
          label={t('git.sync.fetch')}
          readiness={fetchReady}
          running={pending.has(GIT_FETCH_OPERATION_KEY)}
          onClick={fetch}
          t={t}
        />
        <GitSyncButton
          label={t('git.sync.pull')}
          readiness={pullReady}
          running={pending.has(GIT_PULL_OPERATION_KEY)}
          onClick={pull}
          t={t}
        />
        <GitSyncButton
          label={t('git.sync.push')}
          readiness={pushReady}
          running={pending.has(GIT_PUSH_OPERATION_KEY)}
          onClick={push}
          t={t}
        />
      </div>
      {/*
        GitHub に公開（Session 3-8-10）。

        出るのは **remote がまだ1つも無いとき**だけになる（DESIGN.md §3 の
        「初回のみ」）── 公開が済めばこの場所ごと消え、上の Push / Pull が
        その先を担う。押す場所が2つ並ばないので、「どちらを押せばよいか」を
        利用者が判断する必要が無い。

        置き場所は Push / Pull の**下**（足すのは下へ）。
      */}
      {repository.hasRemote ? null : (
        <>
          <GitHubPublishForm
            workspaceName={workspaceName}
            status={githubStatus}
            operating={operating}
            publishing={pending.has(GITHUB_PUBLISH_OPERATION_KEY)}
            onRefreshStatus={refreshGitHubStatus}
            onPublish={publishToGitHub}
            t={t}
          />
          {/*
            既にあるリポジトリに接続する（Session 3-8-16）。

            ## 3-8-10 が開けたままにしていた穴を、ここで塞ぐ

            remote が1つも無いリポジトリでパネルの下に在ったのは
            「GitHub に公開」だけだった ── **新しく作る**側の入口しか無く、
            既にどこかに在る repository へ繋ぎたい人は、そこで
            アプリの外（端末の `git remote add`）へ出るしかなかった。
            `no-remote` の文言が「Terminal パネルで」と案内していたのは
            そのためになる。

            ## 公開のボタンと同じ場所に置く

            上のバーの「リモート」を押しても同じ面が開くが、それだけにはしない ──
            **remote が無い人がいちばん長く見ているのはこの位置**（Push / Pull の
            下）で、そこに「もう1つの選び方」が無いと、公開が唯一の道に見える。

            見た目は控えめにしてある（ボタンではなく1行の文）── 2つを同じ
            大きさで並べると、どちらを押すかを先に決めさせることになる。
            公開は「作る」、こちらは「繋ぐ」で、多くの人にとっては前者になる。
          */}
          <p className="fx-git__connect">
            {t('git.panel.existingRepositoryLead')}
            <button type="button" className="fx-git__connect-open" onClick={openRemotes}>
              {t('git.panel.existingRepositoryLink')}
            </button>
          </p>
        </>
      )}
      {/*
        履歴（Session 3-8-11 / 3-8-12）。

        差分と**同じ場所に、同じ閉じ方で**重ねる（GitHistoryOverlay.tsx）──
        出る場所が操作ごとに違うと、閉じ方も別々に覚えることになる。

        ## 3-8-12 で、2つが同時に開くようになった

        3-8-11 の時点では、履歴が出ている間に押せる行が1つも無かったため、
        差分と履歴が重なることは無かった。3-8-12 で履歴の中から差分を開けるように
        なり、**差分が履歴の上に重なる**。

        そのとき困るのが Esc で、どちらの面も `window` で待っているため、
        放っておくと1回の Esc で2枚とも閉じる（同じ `window` に付いた2つの購読は、
        `stopPropagation` を挟んでもどちらも呼ばれる）。上に居る方だけが効くよう、
        **下の面には「今は上に何か重なっている」を渡す**（`suspended`）──
        受け取った側は購読そのものを張らない（GitHistoryOverlay.tsx）。

        重なりの順は DOM の並びで決まるので、差分をこの後ろに置いてある。
      */}
      {historyOpen ? (
        <GitHistoryOverlay
          history={history}
          detail={commitDetail}
          suspended={diffRequest !== null}
          /*
            Session 3-8-13。この面から動かせる git に書き込みが1つ加わったので、
            他の Git 操作と同じ目印（`operating`）がここでも要る ──
            ブランチの面（GitBranchMenu）へ渡しているものとまったく同じ値になる。
          */
          operating={operating}
          onOpenCommit={openCommitDetail}
          onCloseCommit={closeCommitDetail}
          onOpenFile={showCommitFileDiff}
          onCreateBranch={createBranchFromCommit}
          onClose={closeHistory}
          t={t}
        />
      ) : null}
      {/*
        退避（Session 3-8-15）。

        履歴と**同じ場所に、同じ閉じ方で**重ねる（GitStashOverlay.tsx）。
        2つが同時に開くことは起こりえない ── 面はバーごと覆うので、
        どちらかが開いている間はもう一方のボタンを押せる場所が無い。
        したがって履歴が差分に対して持っている `suspended` は要らない。

        差分の**手前**に置いてあるのは、重なりの順を DOM の並びで決めるため
        （どちらも `z-index: 20`。git.css）── ただし退避の面からは差分を
        開けないので、実際に重なることは無い（退避の中身を見る口は
        置いていない。docs/ARCHITECTURE.md §14.23）。
      */}
      {/*
        リモート（Session 3-8-16）。

        履歴・退避と**同じ場所に、同じ閉じ方で**重ねる（GitRemoteOverlay.tsx）。
        3つが同時に開くことは起こりえない ── 面はバーごと覆うので、
        どれかが開いている間は他のボタンを押せる場所が無い。したがって
        履歴が差分に対して持っている `suspended` は要らない。

        退避と同じく差分の**手前**に置いてあるが、この面からは差分を
        開けないので、実際に重なることは無い。
      */}
      {remoteOpen ? (
        <GitRemoteOverlay
          list={remotes}
          operating={operating}
          adding={pending.has(GIT_ADD_REMOTE_OPERATION_KEY)}
          onAdd={addRemote}
          onSetUrl={setRemoteUrl}
          onRename={renameRemote}
          onRemove={removeRemote}
          onClose={closeRemotes}
          t={t}
        />
      ) : null}
      {stashOpen ? (
        <GitStashOverlay
          list={stashes}
          operating={operating}
          pushing={pending.has(GIT_STASH_PUSH_OPERATION_KEY)}
          /*
            退避の3つにも、途中の操作の禁止を被せる（Session 3-8-22B）。

            3-8-22A はこの表を作ったときに、上のバー・ブランチの面・行の操作・
            Commit 欄へは被せたが、**この面だけ渡し忘れていた** ── 実アプリで
            測って分かった（マージ中に「戻す」が押せ、競合を解決し終えた後は
            「作業ツリーを退避」も押せた）。Main は両方とも断っていたので
            退避が消えることは無かったが、**押しても必ず失敗するボタン**が
            残っていたことになる（3-8-2 の「押しても何も起きない操作を置かない」）。

            3つを別々に引いているのは GitView の他の箇所と同じ理由で、表が
            それぞれに答えを持つため ── マージ中は push / pop が通らず drop は
            通る。ここで1つにまとめると、その違いが消える。
          */
          pushReadiness={withGitInProgressBlock(
            toGitStashPushReadiness(repository.changes, operating, t),
            guard('stash-push')
          )}
          popBlocked={guard('stash-pop')}
          dropBlocked={guard('stash-drop')}
          onPush={stashPush}
          onPop={stashPop}
          onDrop={stashDrop}
          onClose={closeStash}
          t={t}
        />
      ) : null}
      {/*
        差分（Session 3-8-9 / 3-8-12）。

        一覧の**上に重ねる**。面ごと差し替えると、閉じたときにどこを見ていたか
        （スクロール位置・開いていたグループ）が失われる（GitDiffOverlay.tsx）。
        パネルの中に収まるので、他のパネルの上には出ない。

        履歴の**後ろ**に置いてあるのは、重なりの順を DOM の並びで決めるため
        （どちらも `z-index: 20`。git.css）── commit の中の差分は、
        履歴の面の上に出る必要がある。
      */}
      {diffRequest === null ? null : (
        <GitDiffOverlay request={diffRequest} diff={diff} onClose={closeDiff} t={t} />
      )}
      {/*
        破棄の確認（Session 3-8-9）。

        こちらはウィンドウ全体に掛かる（Files の削除確認と同じ）── 失われるものが
        ある操作で、答えるまで他のことをさせない形にしてある（§12.6）。
      */}
      {discarding === null ? null : (
        <GitDiscardConfirm
          group={discarding.group}
          change={discarding.change}
          blocker={findGitDiscardBlocker(discarding.change.relativePath, unsavedPaths, t)}
          busy={pending.has(
            toGitOperationKey({
              kind: 'discard',
              relativePath: discarding.change.relativePath
            })
          )}
          onConfirm={runDiscard}
          onCancel={() => setDiscarding(null)}
          t={t}
        />
      )}
    </div>
  )
}

/**
 * 途中の Git 操作の帯と、その中の中止（Session 3-8-20 / 3-8-22A）。
 *
 * ## 3-8-22A で、マージ専用ではなくなった
 *
 * 出す文言と「中止の口を出すか」（`notice.abortable`）を決めるのは
 * gitInProgress.ts で、ここが持つのは置き場所だけになる ── 3-8-20 の
 * 時点では文言がこのファイルに直接書かれていたが、状態が4つに増えた時点で
 * **判断も文言も React の外へ出してある**（gitChanges.ts /
 * gitRepositoryMessage.ts と同じ分担）。
 *
 * 中止の口が出るのはマージだけのまま。rebase / cherry-pick / revert では
 * 帯が「Terminal でこうしてください」と言うだけで、押せる場所を置かない
 * （`merge --abort` はその3つを中止しないため、置けば
 * **押しても何も終わらないボタン**になる）。
 *
 * ## 新しい画面を作らない
 *
 * 専用の Merge 画面も、重なる器（`GitDiffOverlay` のような面）も置かない ──
 * マージ中に利用者がすることは**既にこのパネルに在るもの**（競合の行を開いて
 * 直す → 解決済みにする → Commit）で、その上に別の画面を被せると、
 * いちばん見たい一覧が隠れる。帯が足すのは「なぜ今この状態なのか」の
 * 1行と、そこから出る道1つだけになる。
 *
 * ## 中止をここに置く（ブランチの面ではなく）
 *
 * 始めるのは面の中（一覧の行）だが、やめるのはパネルの本体に置く ──
 * マージ中に面を開くと、そこに並ぶのは**今は押せない行ばかり**で、
 * 出口がその奥にあることになる。3-8-15 の退避が「押せない理由」を
 * 面の中に置いたのとは逆で、これは**状態から抜ける口**にあたる。
 *
 * ## 確認は帯の中に開く
 *
 * 行の下に開く削除 / マージの確認と同じ形（`GitDiscardConfirm` のような
 * 重なる器にしない）── 帯のすぐ下なら、何について尋ねられているかが
 * そのまま真上に見えている。
 *
 * 既定の focus は「やめる」で、実行の側に `data-variant="danger"` を付ける ──
 * **解決中に書いた内容が消えうる**操作で、そこは破棄・削除と同じ重さになる
 * （gitBranches.ts の `describeGitAbortMergeWarning`）。
 */
function GitInProgressBanner({
  notice,
  operating,
  aborting,
  onOpenAbort,
  onCancelAbort,
  onAbort,
  t
}: {
  /** 何の途中で、次に何をすればよいか（gitInProgress.ts）。 */
  readonly notice: GitInProgressNotice
  readonly operating: boolean
  /** 中止の確認を出しているか。 */
  readonly aborting: boolean
  readonly onOpenAbort: () => void
  readonly onCancelAbort: () => void
  readonly onAbort: () => void
  readonly t: TFunction
}): JSX.Element {
  const warning = describeGitAbortMergeWarning(t)

  /*
    Esc で中止の確認を畳む（Session 3-8-22A）。

    3-8-20 では、この確認だけが Esc を持っていなかった ── 破棄の確認
    （GitDiscardConfirm）・初期化の確認（GitInitConfirm）・4つの面・
    ブランチの面の行の下は、いずれも 3-8-9 以降ずっと持っている。
    **1箇所だけ約束が違う**状態で、押した人は Esc を押して何も起きないのを
    見ることになる。

    購読を張るのは確認が出ている間だけ ── 帯そのものを閉じる Esc は無い
    （帯は状態であって、開いたり閉じたりするものではない）ので、
    ブランチの面のような段の重なりはここでは起きない。
  */
  useEffect(() => {
    if (!aborting) {
      return
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') {
        return
      }

      event.preventDefault()
      onCancelAbort()
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [aborting, onCancelAbort])

  return (
    <div className="fx-git__merge" data-testid="git-merge-banner">
      <div className="fx-git__merge-bar">
        {/*
          見出しと説明を分ける（Session 3-8-22A）。

          3-8-20 の帯は1文だった（「マージの途中です。競合を解決して Commit
          すると完了します。」）。4つの状態を出し分けるようになって説明が
          長くなり、とくにアプリに出口が無い3つでは**端末で打つコマンド**まで
          入る ── 1つの `<span>` に流し込むと、いちばん先に読ませたい
          「何の途中か」が文の中に埋もれる。

          読み上げは器（`role="status"`）に付けたまま1つにしてある ──
          2つに分けると、状態の変化が2回読み上げられることになる。
        */}
        <span className="fx-git__merge-label" role="status">
          <span className="fx-git__merge-title">{notice.title}</span>
          <span className="fx-git__merge-description">{notice.description}</span>
        </span>
        {/*
          中止の口はマージにしか出さない ── `merge --abort` は rebase /
          cherry-pick / revert を中止しないため、置けば押しても何も
          終わらないボタンになる（Session 3-8-22A）。
        */}
        {notice.abortable ? (
          <button
            type="button"
            className="fx-git__merge-abort"
            onClick={onOpenAbort}
            disabled={operating}
            aria-expanded={aborting}
            title={t('git.branch.abortWarning.title')}
          >
            {warning.confirmLabel}
          </button>
        ) : null}
      </div>
      {aborting ? (
        <div
          className="fx-git__branch-confirm"
          role="alertdialog"
          aria-label={t('git.branch.abortWarning.aria')}
          data-testid="git-merge-abort-confirm"
        >
          <p className="fx-git__branch-confirm-message">{warning.message}</p>
          <p className="fx-git__branch-confirm-note">{warning.note}</p>
          <div className="fx-git__branch-confirm-actions">
            <button
              type="button"
              className="fx-git__branch-confirm-button"
              onClick={onCancelAbort}
              // 確認を出す目的は誤操作を止めることなので、既定はこちらに置く。
              autoFocus
            >
              {t('git.common.stop')}
            </button>
            <button
              type="button"
              className="fx-git__branch-confirm-button"
              data-variant="danger"
              data-testid="git-merge-abort-apply"
              disabled={operating}
              onClick={onAbort}
            >
              {warning.confirmLabel}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/**
 * Pull / Push のボタン（Session 3-8-5）。
 *
 * ## 押せない理由は hover と読み上げに置く
 *
 * Commit の「押せない理由」は入力欄の下の1行に出せるが、こちらは横に並ぶ
 * 小さなボタンで、文章を置ける場所が無い。理由を決めるのは同じく
 * gitChanges.ts（純粋・テスト対象）で、ここが持つのは置き場所だけになる。
 *
 * **押せるときも `title` を空にしない。** 何が起きるか（どこへ何件送るか）は
 * 押す前に読めた方がよく、それは追跡先の名前を含むためボタンの文字には収まらない。
 */
function GitSyncButton({
  label,
  readiness,
  running,
  onClick,
  t
}: {
  readonly label: string
  readonly readiness: GitActionReadiness
  /** この操作が動いている最中か。 */
  readonly running: boolean
  readonly onClick: () => void
  readonly t: TFunction
}): JSX.Element {
  return (
    <button
      type="button"
      className="fx-git__sync-action"
      onClick={onClick}
      disabled={!readiness.enabled}
      title={readiness.note}
      aria-label={t('git.sync.aria', { label, note: readiness.note })}
    >
      {running ? t('git.common.runningSuffix', { label }) : label}
    </button>
  )
}

/**
 * ②コミットメッセージと③Commit（Session 3-8-4）。
 *
 * ## 押せない条件を、押せない見た目だけで伝えない
 *
 * 押せるかどうかを決めるのは `toGitCommitReadiness`（gitChanges.ts・純粋・
 * テスト対象）で、そこが理由の一言も一緒に返す ── 薄いボタンだけが並び、
 * なぜ押せないのかがどこにも出ない状態を作らない。
 *
 * ## 入力欄は複数行
 *
 * `<textarea>` にしてあるのは、Commit メッセージが「要約 + 空行 + 本文」という
 * 形を取りうるため。専用のエディタは持たない（Session 3-8-4 の範囲外）が、
 * **改行が打てないことで形を制限する**のは避ける ── 渡し方が標準入力なので、
 * 改行はそのまま git へ届く（main/git/gitCommands.ts）。
 *
 * `Ctrl + Enter` でも Commit できる。Enter だけを割り当てないのは、
 * それが本文の改行と衝突するため。
 *
 * ## 文字数は、上限に近づいてから出す
 *
 * 常に出していると、要約1行を書くだけの場面でも数字が目に入る。
 * 上限（shared/git/commitMessage.ts）に近づいたときにだけ出す形にして、
 * **出ていること自体が合図**になるようにしてある（gitChanges.ts）。
 */
function GitCommitForm({
  message,
  onChange,
  onCommit,
  onCommitAndPush,
  readiness,
  pushReadiness,
  committing,
  pushing,
  t
}: {
  readonly message: string
  readonly onChange: (message: string) => void
  readonly onCommit: () => void
  /** Commit してそのまま Push する（Session 3-8-5）。 */
  readonly onCommitAndPush: () => void
  /** 今 Commit できるか・その理由・残り文字数（gitChanges.ts が決める）。 */
  readonly readiness: GitCommitReadiness
  /** 今 Commit & Push できるか（Commit の条件をそのまま引き継ぐ。gitChanges.ts）。 */
  readonly pushReadiness: GitActionReadiness
  /** Commit が動いている最中か。 */
  readonly committing: boolean
  /** Commit & Push が動いている最中か。 */
  readonly pushing: boolean
  readonly t: TFunction
}): JSX.Element {
  const { enabled, note, remaining } = readiness

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>): void => {
      if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) {
        return
      }

      event.preventDefault()

      if (enabled) {
        onCommit()
      }
    },
    [enabled, onCommit]
  )

  return (
    <div className="fx-git__commit">
      <textarea
        className="fx-git__commit-message"
        value={message}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        // 入力そのものは止めない（止めると、貼り付けた文章を自分で削れなくなる）。
        placeholder={t('git.commit.placeholder')}
        aria-label={t('git.commit.aria')}
        rows={3}
        spellCheck={false}
      />
      <div className="fx-git__commit-bar">
        {note === null ? (
          <span className="fx-git__commit-count">
            {remaining === null
              ? ''
              : t('git.commit.remaining', { count: remaining.toLocaleString() })}
          </span>
        ) : (
          <span className="fx-git__commit-note" role="status">
            {note}
          </span>
        )}
        <button
          type="button"
          className="fx-git__commit-action"
          onClick={onCommit}
          disabled={!enabled}
          title={t('git.commit.title')}
        >
          {committing ? t('git.commit.committing') : t('git.commit.commit')}
        </button>
        {/*
          Commit & Push（Session 3-8-5）。

          Commit の**右**に置く。DESIGN.md §3 が「③Commit & Push」を一続きの
          最後に置いているのと同じ並びで、左から右へ進むほど遠くまで行く形になる。

          押せる条件は Commit と同じものを引き継いでいる（gitChanges.ts）──
          「Commit は押せないのに Commit & Push は押せる」を作らない。
        */}
        <button
          type="button"
          className="fx-git__commit-action fx-git__commit-action--push"
          onClick={onCommitAndPush}
          disabled={!pushReadiness.enabled}
          title={pushReadiness.note}
        >
          {pushing ? t('git.commit.commitAndPushing') : t('git.commit.commitAndPush')}
        </button>
      </div>
    </div>
  )
}

/**
 * 変更1件の行。
 *
 * **開けないものは button にしない。** disabled の button にすると、
 * 押せる形のまま押せないものが並ぶことになる ── 削除されたファイルと
 * 未追跡のフォルダは「今は押せない」のではなく「押す先が無い」にあたる
 * （gitChanges.ts）。
 */
function GitChangeRow({
  groupId,
  change,
  action,
  busy,
  blocked,
  onOpen,
  onAct,
  onDiff,
  onDiscard,
  t
}: {
  /** どのグループの行か（差分と破棄で、何が起きるかが変わる。Session 3-8-9）。 */
  readonly groupId: GitChangeGroup['id']
  readonly change: GitFileChange
  /** その行に置く操作（グループから決まる。gitChanges.ts）。無ければ null。 */
  readonly action: GitRowAction
  /** この行の操作が動いている最中か。 */
  readonly busy: boolean
  /**
   * 途中の Git 操作があるために、書き込みを通せない理由（Session 3-8-22A）。
   * 通せるなら null。
   *
   * **`busy` と別に受け取る。** あちらは「この行の操作が走っている最中」で
   * 待てば終わるが、こちらは**その途中の状態を終わらせるまで変わらない** ──
   * 同じ `disabled` でも次の一手が違うので、理由を出せるように分けてある。
   *
   * 読む側（差分・開く）は止めない ── 何が起きているのかを確かめる手立てを
   * 奪わない（shared/git/inProgress.ts）。
   */
  readonly blocked: string | null
  readonly onOpen: (change: GitFileChange) => void
  readonly onAct: (action: Exclude<GitRowAction, null>, change: GitFileChange) => void
  readonly onDiff: (groupId: GitChangeGroup['id'], change: GitFileChange) => void
  readonly onDiscard: (groupId: GitChangeGroup['id'], change: GitFileChange) => void
  readonly t: TFunction
}): JSX.Element {
  const kind = describeGitChangeKind(change.kind, t)
  const row = describeGitChangeRow(change, t)
  const label = t('git.changes.row.label', { path: change.relativePath, kind: kind.label })

  const content = (
    <>
      {/* 色だけに意味を持たせない。記号の意味は読み上げにも渡す。 */}
      <span className="fx-git__symbol" data-kind={change.kind} aria-label={kind.label}>
        {kind.symbol}
      </span>
      <span className="fx-git__change-name">{row.name}</span>
      {row.location === null ? null : (
        <span className="fx-git__change-location">{row.location}</span>
      )}
    </>
  )

  /*
    操作の名前は行ごとに作る。「Stage」だけだと、読み上げでは同じ名前のボタンが
    並ぶことになり、どのファイルのものか分からない。
  */
  const actionLabel = action === null ? '' : describeGitRowAction(action, change, t)

  /*
    差分と破棄（Session 3-8-9）。

    並びは左から「差分 → 破棄 → Stage / Unstage」。**いちばん右に
    いちばんよく押すものを置く**のは 3-8-3 のままで、そこへ足す2つは
    その左に、危ない順（見るだけ → 消す）に並べてある。

    出す行の条件が3つとも違う（gitDiff.ts / gitChanges.ts）。

      差分   … 未追跡のフォルダ以外。**削除された行にも、競合の行にも出す**
      破棄   … 「変更」と「未追跡のファイル」だけ
      Stage  … 競合以外（競合の行では「解決済みにする」に変わる）

    Session 3-8-21 で、競合の行が差分の側にも入った ── 行き先のチャンネルは
    違う（`git:get-conflict-diff`）が、**押す場所も絵も同じ**にしてある。
    別のボタンを競合の行にだけ置くと、一覧を縦に読む人にとって
    「左から2つめは差分」という並びがそこで崩れる。
  */
  const diffLabel = t('git.changes.row.diff', { path: change.relativePath })
  const discardLabel = t('git.changes.row.discard', { path: change.relativePath })

  return (
    <li className="fx-git__change" data-kind={change.kind}>
      {canOpenGitChange(change) ? (
        <button
          type="button"
          className="fx-git__change-open"
          title={label}
          onClick={() => onOpen(change)}
        >
          {content}
        </button>
      ) : (
        <span className="fx-git__change-static" title={label}>
          {content}
        </span>
      )}
      {canDiffGitChange(change) ? (
        <button
          type="button"
          className="fx-git__change-action"
          data-action="diff"
          onClick={() => onDiff(groupId, change)}
          title={diffLabel}
          aria-label={diffLabel}
        >
          <DiffIcon />
        </button>
      ) : null}
      {/*
        破棄は**押しても即座には何も起きない**（確認が出る）。それでも
        処理中は押せなくしてあるのは、確認を出し直せてしまうと
        「同じ行に2回目の確認」が積める形になるため。
      */}
      {canDiscardGitChange(groupId, change) ? (
        <button
          type="button"
          className="fx-git__change-action"
          data-action="discard"
          onClick={() => onDiscard(groupId, change)}
          disabled={busy || blocked !== null}
          title={blocked ?? discardLabel}
          aria-label={blocked ?? discardLabel}
        >
          <DiscardIcon />
        </button>
      ) : null}
      {/*
        操作の無い行（競合）では、場所そのものを作らない。disabled のボタンを
        置くと「今は押せない」に見えるが、競合は待っても押せるようにはならない
        （開けない行を button にしていないのと同じ判断）。
      */}
      {action === null ? null : (
        <button
          type="button"
          className="fx-git__change-action"
          data-action={action}
          onClick={() => onAct(action, change)}
          disabled={busy || blocked !== null}
          title={blocked ?? actionLabel}
          aria-label={blocked ?? actionLabel}
        >
          <GitRowActionIcon action={action} />
        </button>
      )}
    </li>
  )
}

/**
 * 行の操作の絵（Session 3-8-18）。
 *
 * 3つになったところで分けた ── `resolve` は `＋`（Stage）と**違う形**で
 * なければならず（意味が違う。renderer/src/git/gitChanges.ts）、
 * 三項演算子を重ねると「どちらでもない方」が既定になる形が残る。
 */
function GitRowActionIcon({
  action
}: {
  readonly action: Exclude<GitRowAction, null>
}): JSX.Element {
  switch (action) {
    case 'stage':
      return <StageIcon />

    case 'unstage':
      return <UnstageIcon />

    case 'resolve':
      return <ResolveIcon />
  }
}
