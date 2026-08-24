import type { JSX, KeyboardEvent } from 'react'
import { useCallback, useMemo, useState } from 'react'
import type { GitDiscardTarget, GitFileChange } from '@shared/git'
import { useEditorContext } from '../editor/context'
import { useWorkspaceFolder } from '../workspaceFolder/context'
import { GitBranchMenu } from './GitBranchMenu'
import { GitDiffOverlay } from './GitDiffOverlay'
import { GitDiscardConfirm } from './GitDiscardConfirm'
import { GitHubPublishForm } from './GitHubPublishForm'
import { GitInitConfirm } from './GitInitConfirm'
import { DiffIcon, DiscardIcon, StageIcon, UnstageIcon } from './GitIcons'
import {
  canDiscardGitChange,
  canOpenGitChange,
  countGitChanges,
  describeGitChangeKind,
  describeGitChangeRow,
  describeGitOperationFailure,
  describeGitUpstream,
  findGitDiscardBlocker,
  GIT_COMMIT_AND_PUSH_OPERATION_KEY,
  GIT_COMMIT_OPERATION_KEY,
  GIT_INIT_OPERATION_KEY,
  GIT_PULL_OPERATION_KEY,
  GIT_PUSH_OPERATION_KEY,
  toGitChangeGroups,
  toGitCommitAndPushReadiness,
  toGitCommitReadiness,
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
import { canDiffGitChange, toGitDiffGroup } from './gitDiff'
import { GITHUB_PUBLISH_OPERATION_KEY } from './githubPublish'
import { describeGitRepositoryNotice } from './gitRepositoryMessage'
import { useGitRepository } from './useGitRepository'

/**
 * Git パネルの中身（Session 3-8-1 / 3-8-2 / 3-8-3 / 3-8-4 / 3-8-5 / 3-8-6 / 3-8-9 / 3-8-10）。
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
    refreshBranches,
    switchBranch,
    createBranch,
    githubStatus,
    refreshGitHubStatus,
    publishToGitHub
  } = useGitRepository()
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
    Files の行を押したときとまったく同じ呼び出し（files/FilesView.tsx）。
    名前は relativePath から導く（gitChanges.ts）── Main から2つ受け取る形にすると、
    片方だけ食い違った値が渡る余地ができる。
  */
  const open = useCallback(
    (change: GitFileChange): void => {
      openFile({
        relativePath: change.relativePath,
        name: describeGitChangeRow(change).name
      })
    },
    [openFile]
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

      unstage(change.relativePath)
    },
    [stage, unstage]
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

      if (group === null) {
        return
      }

      openDiff({ group, change })
    },
    [openDiff]
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

  const notice = describeGitRepositoryNotice(repository)

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
            もう一度確認する
          </button>
        ) : null}
        {/*
          操作の失敗は、案内の画面でも出す（Session 3-8-10）── 初期化を
          押したのに何も起きなかった場合、理由を出せる場所がここしか無い
          （一覧はまだ存在しない）。
        */}
        {failure === null ? null : (
          <p className="fx-git__operation-error" role="status">
            {describeGitOperationFailure(failure)}
          </p>
        )}
        {initializing ? (
          <GitInitConfirm
            workspaceName={workspaceName}
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

  const groups = toGitChangeGroups(repository.changes)
  const total = countGitChanges(repository.changes)
  const upstream = describeGitUpstream(repository.upstream)

  /*
    Commit が押せるか（gitChanges.ts）。

    `pending.size > 0` を渡しているのは、Commit の中身が「ステージ済みの全体」
    だからになる ── 行の Stage が1件走っている間にも Commit できてしまうと、
    画面に出ている一覧とは違うものが commit に入りうる。行の操作どうしが
    互いを止めないのとは、そこが違う。
  */
  const operating = pending.size > 0
  const commitReady = toGitCommitReadiness(message, repository.changes.staged.length, operating)
  const committing = pending.has(GIT_COMMIT_OPERATION_KEY)

  /*
    Push / Pull / Commit & Push（Session 3-8-5）。

    Commit と同じく `operating`（何かしらの Git 操作が動いている）で止める ──
    どれも「今のブランチ全体」を相手にする操作で、走っている Stage / Commit は
    まさにその中身を変えている最中にあたる。行の `＋` / `−` が押した対象だけを
    止めるのとは性質が違う。
  */
  const pushReady = toGitPushReadiness(repository.head, repository.upstream, operating)
  const pullReady = toGitPullReadiness(repository.head, repository.upstream, operating)
  const commitAndPushReady = toGitCommitAndPushReadiness(commitReady, repository.head)

  return (
    <div className="fx-git">
      <div className="fx-git__bar">
        {/* 何の名前かが分かるようにする。ブランチ名だけだと、それが何なのか伝わらない。 */}
        <span className="fx-git__branch-label">ブランチ</span>
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
          operating={operating}
          onOpen={refreshBranches}
          onSwitch={switchBranch}
          onCreate={createBranch}
        />
        {upstream === null ? null : (
          <span className="fx-git__upstream" title={upstream.title}>
            {upstream.text}
          </span>
        )}
        <button
          type="button"
          className="fx-git__refresh"
          onClick={refresh}
          disabled={busy}
          // 記号だけのボタンなので、読み上げと hover の両方に名前を用意する。
          title="Git の状態を再取得"
          aria-label="Git の状態を再取得"
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
          {describeGitOperationFailure(failure)}
        </p>
      )}
      <div className="fx-git__body">
        {total === 0 ? (
          <p className="fx-git__empty">変更はありません。</p>
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
                      disabled={pending.has(toGitOperationKey(groupTarget))}
                      title={`${group.label}をすべて Stage`}
                    >
                      すべて Stage
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
                      onOpen={open}
                      onAct={act}
                      onDiff={showDiff}
                      onDiscard={askDiscard}
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
        readiness={commitReady}
        pushReadiness={commitAndPushReady}
        committing={committing}
        pushing={pending.has(GIT_COMMIT_AND_PUSH_OPERATION_KEY)}
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
        <GitSyncButton
          label="Pull"
          readiness={pullReady}
          running={pending.has(GIT_PULL_OPERATION_KEY)}
          onClick={pull}
        />
        <GitSyncButton
          label="Push"
          readiness={pushReady}
          running={pending.has(GIT_PUSH_OPERATION_KEY)}
          onClick={push}
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
        <GitHubPublishForm
          workspaceName={workspaceName}
          status={githubStatus}
          operating={operating}
          publishing={pending.has(GITHUB_PUBLISH_OPERATION_KEY)}
          onRefreshStatus={refreshGitHubStatus}
          onPublish={publishToGitHub}
        />
      )}
      {/*
        差分（Session 3-8-9）。

        一覧の**上に重ねる**。面ごと差し替えると、閉じたときにどこを見ていたか
        （スクロール位置・開いていたグループ）が失われる（GitDiffOverlay.tsx）。
        パネルの中に収まるので、他のパネルの上には出ない。
      */}
      {diffRequest === null ? null : (
        <GitDiffOverlay request={diffRequest} diff={diff} onClose={closeDiff} />
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
          blocker={findGitDiscardBlocker(discarding.change.relativePath, unsavedPaths)}
          busy={pending.has(
            toGitOperationKey({
              kind: 'discard',
              relativePath: discarding.change.relativePath
            })
          )}
          onConfirm={runDiscard}
          onCancel={() => setDiscarding(null)}
        />
      )}
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
  onClick
}: {
  readonly label: string
  readonly readiness: GitActionReadiness
  /** この操作が動いている最中か。 */
  readonly running: boolean
  readonly onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      className="fx-git__sync-action"
      onClick={onClick}
      disabled={!readiness.enabled}
      title={readiness.note}
      aria-label={`${label} ── ${readiness.note}`}
    >
      {running ? `${label} 中…` : label}
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
  pushing
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
        placeholder="Commit メッセージ（Ctrl + Enter で Commit）"
        aria-label="Commit メッセージ"
        rows={3}
        spellCheck={false}
      />
      <div className="fx-git__commit-bar">
        {note === null ? (
          <span className="fx-git__commit-count">
            {remaining === null ? '' : `残り ${remaining.toLocaleString()} 文字`}
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
          title="ステージ済みの変更を Commit"
        >
          {committing ? 'Commit 中…' : 'Commit'}
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
          {pushing ? 'Commit & Push 中…' : 'Commit & Push'}
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
  onOpen,
  onAct,
  onDiff,
  onDiscard
}: {
  /** どのグループの行か（差分と破棄で、何が起きるかが変わる。Session 3-8-9）。 */
  readonly groupId: GitChangeGroup['id']
  readonly change: GitFileChange
  /** その行に置く操作（グループから決まる。gitChanges.ts）。無ければ null。 */
  readonly action: GitRowAction
  /** この行の操作が動いている最中か。 */
  readonly busy: boolean
  readonly onOpen: (change: GitFileChange) => void
  readonly onAct: (action: Exclude<GitRowAction, null>, change: GitFileChange) => void
  readonly onDiff: (groupId: GitChangeGroup['id'], change: GitFileChange) => void
  readonly onDiscard: (groupId: GitChangeGroup['id'], change: GitFileChange) => void
}): JSX.Element {
  const kind = describeGitChangeKind(change.kind)
  const row = describeGitChangeRow(change)
  const label = `${change.relativePath}（${kind.label}）`

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
  const actionLabel =
    action === 'stage'
      ? `${change.relativePath} を Stage`
      : `${change.relativePath} の Stage を解除`

  /*
    差分と破棄（Session 3-8-9）。

    並びは左から「差分 → 破棄 → Stage / Unstage」。**いちばん右に
    いちばんよく押すものを置く**のは 3-8-3 のままで、そこへ足す2つは
    その左に、危ない順（見るだけ → 消す）に並べてある。

    出す行の条件が3つとも違う（gitDiff.ts / gitChanges.ts）。

      差分   … 競合と未追跡のフォルダ以外。**削除された行にも出す**
      破棄   … 「変更」と「未追跡のファイル」だけ
      Stage  … 競合以外
  */
  const diffLabel = `${change.relativePath} の差分を見る`
  const discardLabel = `${change.relativePath} の変更を破棄`

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
      {canDiffGitChange(groupId, change) ? (
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
          disabled={busy}
          title={discardLabel}
          aria-label={discardLabel}
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
          disabled={busy}
          title={actionLabel}
          aria-label={actionLabel}
        >
          {action === 'stage' ? <StageIcon /> : <UnstageIcon />}
        </button>
      )}
    </li>
  )
}
