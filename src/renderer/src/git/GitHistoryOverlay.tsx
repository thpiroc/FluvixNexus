import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import type { GitCommitFileChange, GitCommitSummary, GitOperationOutcome } from '@shared/git'
import { GitCommitBranchForm } from './GitCommitBranchForm'
import { GitCommitDetailView } from './GitCommitDetailView'
import { BranchIcon } from './GitIcons'
import {
  canOpenGitCommitDetail,
  describeGitMergeCommitNotice,
  type GitCommitDetailState
} from './gitCommitDetail'
import {
  describeGitCommitHistory,
  describeGitCommitRow,
  describeGitCommitTruncation,
  type GitCommitHistoryState
} from './gitHistory'

/**
 * commit の履歴を、Git パネルの上に重ねて見せる面（Session 3-8-11 / 3-8-12 / 3-8-13）。
 *
 * ## 差分の面（GitDiffOverlay.tsx）と同じ器にしてある
 *
 * 重ねる・Esc と `×` で閉じる・面の中にだけ理由を出す ── どれも 3-8-9 で
 * 差分に対して決めたことで、履歴でも変える理由が無い。**同じ場所に出て
 * 同じ閉じ方をする**方が、覚えることが増えない。
 *
 * 面ごと差し替えないのも同じ理由になる ── 一覧を差し替えると、閉じたときに
 * どこを見ていたか（スクロール位置・書きかけの Commit メッセージ）が失われる。
 *
 * ## Editor のタブにしない
 *
 * 差分と同じ判断（GitDiffOverlay.tsx）。タブは「編集して保存するもの」の
 * 置き場所で、履歴はその列に混ざらない。加えて履歴は**開いている間だけ
 * 追いつく**必要があり（下記）、タブとして残ると誰も見ていない一覧のために
 * `git log` を動かし続けることになる。
 *
 * ## 開いている間は追いつく
 *
 * 取り直す契機を持っているのはフックの側で（useGitRepository.ts）、この面は
 * 開いたことと閉じたことを伝えるだけになる。ブランチの一覧が「開いた瞬間に
 * 1回だけ」なのに対し、履歴は開いたまま端末で `git commit` することがあり、
 * そのとき出たままの一覧は**さっき積んだ commit が無い**という形で嘘をつく。
 *
 * ## Session 3-8-12 で、面の中に1段深い場所ができた
 *
 * 行を押すと、この面の中身が**commit 1件の中身**（変更ファイルの一覧）へ
 * 入れ替わる（GitCommitDetailView.tsx）。3枚目の面を重ねないのはそちらに
 * 書いたとおりで、ここでは**戻る道と Esc の順番**を持つ。
 *
 *   Esc（詳細を見ている） … 一覧へ戻る
 *   Esc（一覧を見ている） … 面を閉じる
 *
 * つまり Esc は、開いた順を1つずつほどく ── 詳細から一気に閉じると、
 * 「どの行を見ていたか」ごと画面から消える。
 *
 * ## 上に差分が重なっている間、この面の Esc は効かない
 *
 * 詳細の行を押すと、差分の面（GitDiffOverlay.tsx）が**この面の上に**出る。
 * どちらも `window` で Esc を待つため、そのままだと1回の Esc で2枚が同時に
 * 動く（同じ `window` に付いた2つの購読は、`stopPropagation` を挟んでも
 * どちらも呼ばれる）。したがって、上に何か重なっている間は
 * **この面が購読そのものを張らない**形にしてある（`suspended`）。
 *
 * ## Session 3-8-13 で、この面から初めて git が「書き込み」で動く
 *
 * 3-8-11 / 3-8-12 の間、この面が動かす git は `log` / `show --no-patch` /
 * `diff-tree` / `cat-file` の4つで**全部読み取り**だった。3-8-13 で
 * 「この commit からブランチを作る」が1つだけ加わる。
 *
 * 足したのが**非破壊の1つ**なのは意図してのことになる ── ref を1つ増やす
 * だけで、失われるものが無い（revert / reset / cherry-pick はどれも
 * 別の問いを連れてくる。docs/ARCHITECTURE.md §14.21）。
 *
 * それでも、この面は初めて次の3つを持つことになる。
 *
 *   押せない理由 … 他の Git 操作が動いている間は押せない（gitBranches.ts）
 *   通らなかった理由 … 面の中に出す（GitCommitBranchForm.tsx）
 *   Esc の3段目 … 欄 → 詳細 → 面（下記）
 *
 * ## マージの行は、押せないのに操作は持つ
 *
 * 3-8-12 でマージ commit を**押せない行**にしたのは、差分の相手（どちらの親か）が
 * 決まらないためだった。始点にはその問いが無い ── 比べるのではなく
 * その1点から始めるだけなので、**マージの行にもブランチの操作は出る。**
 *
 * 結果として、同じ行の中に「押せないもの（行そのもの）」と「押せるもの
 * （⑂）」が並ぶ。並んでよいのは、押せない理由が一覧につき1つ下に出ていて
 * （`describeGitMergeCommitNotice`）、そこに書いてあるのが
 * 「**変更ファイルを出せない**」という限られた話だからになる。
 *
 * ## 文言をここに書かない
 *
 * 何と出すかは gitHistory.ts / gitCommitDetail.ts / gitBranches.ts
 * （React 非依存・テスト対象）が決める。このファイルが持つのは配置だけ、
 * という分担は GitView.tsx / GitBranchMenu.tsx と同じ。
 */

interface GitHistoryOverlayProps {
  readonly history: GitCommitHistoryState
  /** 開いている commit の詳細（一覧を見ているときは null）。 */
  readonly detail: GitCommitDetailState | null
  /**
   * 上に差分が重なっているか。
   *
   * true の間、この面は Esc を受け取らない（上記）。見た目は変えない ──
   * 差分の面がこの面を覆うので、下は見えていない。
   */
  readonly suspended: boolean
  /**
   * 何かしらの Git 操作が動いている最中か（Session 3-8-13）。
   *
   * 渡す先はブランチを作る欄だけになる ── 読み取り（詳細・差分）は
   * `operate` を通らないため、この値と関係が無い。
   */
  readonly operating: boolean
  readonly onOpenCommit: (commit: GitCommitSummary) => void
  readonly onCloseCommit: () => void
  readonly onOpenFile: (file: GitCommitFileChange) => void
  /** その commit を始点にブランチを作る（Session 3-8-13）。 */
  readonly onCreateBranch: (shortHash: string, name: string) => Promise<GitOperationOutcome | null>
  readonly onClose: () => void
}

export function GitHistoryOverlay({
  history,
  detail,
  suspended,
  operating,
  onOpenCommit,
  onCloseCommit,
  onOpenFile,
  onCreateBranch,
  onClose
}: GitHistoryOverlayProps): JSX.Element {
  /*
    どの行の下に、ブランチを作る欄が開いているか（Session 3-8-13）。

    ## フックではなくこの面が持つ

    書き換えるものが1つも無い**画面の状態**にあたる ── 面を閉じれば
    一緒に消えてよく、フックに置くと閉じるたびに畳む手順が1つ増える
    （差分と詳細がフックに在るのは、中身を IPC で取りに行くためになる）。

    ## 一度に1つだけ

    行ごとに欄を開けるようにすると、打ちかけの名前が複数残る ── どれを
    作ろうとしていたのかが、押す瞬間まで決まらない。
  */
  const [branching, setBranching] = useState<string | null>(null)

  /*
    詳細へ入るときは畳む。一覧が消えるので、開いたままにすると
    「見えないところに打ちかけの名前が残る」ことになる。
  */
  const openCommit = useCallback(
    (commit: GitCommitSummary): void => {
      setBranching(null)
      onOpenCommit(commit)
    },
    [onOpenCommit]
  )

  const closeBranching = useCallback((): void => {
    setBranching(null)
  }, [])
  /*
    Esc で1段戻る。

    購読先を `window` にしてあるのは、面の中に focus が無くても効かせるため
    （差分の面とまったく同じ形。GitDiffOverlay.tsx）。

    `suspended` の間は購読そのものを張らない ── 上に重なった差分の面だけが
    Esc を受け取る（この面が「無視する」のではなく、居ないのと同じにする）。
  */
  useEffect(() => {
    if (suspended) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') {
        return
      }

      event.preventDefault()

      /*
        開いた順を1つずつほどく（Session 3-8-13 で3段目が増えた）。

          ブランチを作る欄 … 欄だけを畳む
          commit の詳細    … 一覧へ戻る
          一覧             … 面を閉じる

        欄をいちばん先に見るのは、それがいちばん後に開いたものだからになる
        （欄は一覧の上でしか開かず、詳細と同時に立つことは無い）。
      */
      if (branching !== null) {
        setBranching(null)
        return
      }

      if (detail === null) {
        onClose()
      } else {
        onCloseCommit()
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [suspended, branching, detail, onClose, onCloseCommit])

  const notice = describeGitCommitHistory(history)
  const truncation = describeGitCommitTruncation(history)
  const mergeNotice = describeGitMergeCommitNotice(history.commits)

  /*
    「今」は、届いた一覧ごとに1つだけ決める。

    行を描くたびに `Date.now()` を読むと、同じ画面の中で行ごとに違う「今」を
    見ることになる（1行目と 100 行目で基準がずれる）。取り直すたびに
    新しくなるので、開いたまま放っておいても、次に届いた時点で数え直される。
  */
  const now = useMemo(() => Date.now(), [history])

  return (
    <div
      className="fx-git__history-overlay"
      data-testid="git-history"
      data-view={detail === null ? 'list' : 'detail'}
      role="dialog"
      aria-modal="false"
      aria-label={detail === null ? 'コミット履歴' : 'コミットの変更ファイル'}
    >
      <div className="fx-git__history-bar">
        {/*
          戻る道は、閉じるボタンとは反対の端（左）に置く（Session 3-8-12）。

          同じ側に並べると、1段戻るつもりで面ごと閉じることが起きる ──
          消えるものの大きさが違う2つを、隣に並べない。
        */}
        {detail === null ? null : (
          <button
            type="button"
            className="fx-git__history-back"
            onClick={onCloseCommit}
            title="履歴へ戻る（Esc）"
            aria-label="履歴へ戻る"
          >
            ←
          </button>
        )}
        <span className="fx-git__history-title">
          {detail === null ? 'コミット履歴' : '変更ファイル'}
        </span>
        {/*
          件数は見出しの一部（変更の一覧の見出しと同じ形。GitView.tsx）──
          「あと何件あるか」は、縦に読み始める前に知りたい。
        */}
        {detail === null ? (
          history.status === 'ready' && history.commits.length > 0 ? (
            <span className="fx-git__history-count">{history.commits.length}</span>
          ) : null
        ) : detail.detail !== null && detail.detail.status === 'ready' ? (
          <span className="fx-git__history-count">{detail.detail.files.length}</span>
        ) : null}
        <button
          type="button"
          className="fx-git__history-close"
          onClick={onClose}
          title="履歴を閉じる"
          aria-label="履歴を閉じる"
        >
          ×
        </button>
      </div>
      {detail === null ? (
        <>
          <div className="fx-git__history-body">
            {notice === null ? (
              <ul className="fx-git__commits">
                {history.commits.map((commit) => (
                  <GitCommitRowView
                    key={commit.shortHash}
                    commit={commit}
                    now={now}
                    branching={branching === commit.shortHash}
                    operating={operating}
                    onOpen={openCommit}
                    onStartBranch={setBranching}
                    onCreateBranch={onCreateBranch}
                    onCancelBranch={closeBranching}
                  />
                ))}
              </ul>
            ) : (
              <p className="fx-git__history-notice" role="status">
                {notice}
              </p>
            )}
          </div>
          {/*
            断りは一覧の**下**に置く（ブランチの面と同じ）── 上に置くと、
            開くたびに一番上に現れて、読みたい行の位置が毎回ずれる。

            マージの断りは、一覧にマージの行が混ざっているときだけ出る
            （gitCommitDetail.ts）── 押せない行がなぜ押せないかを、
            行ごとに 30 回並べずに1回だけ言う。
          */}
          {mergeNotice === null ? null : <p className="fx-git__history-note">{mergeNotice}</p>}
          {truncation === null ? null : <p className="fx-git__history-truncated">{truncation}</p>}
        </>
      ) : (
        <GitCommitDetailView state={detail} onOpenFile={onOpenFile} />
      )}
    </div>
  )
}

/**
 * commit 1件の行。
 *
 * ## 行の中に、押せるものが2つある（Session 3-8-13）
 *
 * 3-8-12 までは行そのものが1つの `button` で、押す先も1つだった。3-8-13 で
 * 「この commit からブランチを作る」が加わり、**行の中にボタンが2つ**になる ──
 * `button` の中に `button` は置けないので、`li` の中を「本体（開く）」と
 * 「⑂（ブランチ）」の2つに分けてある。
 *
 * 開く方が伸び、⑂ は右端で幅を持たない ── 縦に読むときに目に入るのは
 * 本体の方で、⑂ はそこを狙ったときにだけ在ればよい。
 *
 * ## ⑂ はマージの行にも出る
 *
 * 開く方（変更ファイル）はマージだと押せないが、⑂ は押せる ── 始点には
 * 「どちらの親と比べるか」という問いが無い（GitCommitBranchForm.tsx の
 * 上に書いたとおり）。したがって `data-openable="false"` の行でも
 * ⑂ だけは普通のボタンとして立つ。
 *
 * ## 欄は、押した行の下に開く
 *
 * 開いている間、その行は `data-branching="true"` になる。行そのものは
 * 押せるままにしてある ── 欄を開いた後で「やっぱり中身を見たい」と
 * 思った人の前で、行だけが薄くなる形にしない（開けば欄は畳まれる）。
 *
 * ## 押せる行と、押せない行がある（Session 3-8-12）
 *
 * 3-8-11 では**押す先が無かった**ため、行は `li` の中の文字だけだった。
 * 3-8-12 で押す先（その commit の変更ファイル）ができたので `button` にする ──
 * ただしマージ commit は**初めから押せない形**のまま置く。押せる形のものを
 * 置いて何も起きない（あるいは断る）より、押せないことが見えている方がよい
 * （開けない行を `span` にしてあるのと同じ判断。GitView.tsx）。
 *
 * 押せない理由は、行ごとではなく一覧につき1つだけ下に出す
 * （gitCommitDetail.ts の `describeGitMergeCommitNotice`）。
 *
 * ## 並びは「要約 → 名乗り → 日時 → hash」
 *
 * 左から、読む頻度の高い順に置いてある。要約がいちばん幅を取り、
 * 短い hash がいちばん右に来る ── hash は「他の人に伝える」ときにだけ
 * 要るもので、縦に読むときには目に入らない方がよい。
 *
 * 日時は `time` 要素にしてある（`dateTime` は機械が読む形）。本文は相対で、
 * hover と読み上げに絶対の日時が渡る（gitHistory.ts）。
 *
 * ## 行の class は `fx-git__commit-entry`
 *
 * `fx-git__commit` は Commit メッセージの欄（`GitCommitForm`）が既に使っている ──
 * 同じ名前にすると、履歴の行に付けた見た目がパネルの下の入力欄にも掛かる。
 */
function GitCommitRowView({
  commit,
  now,
  branching,
  operating,
  onOpen,
  onStartBranch,
  onCreateBranch,
  onCancelBranch
}: {
  readonly commit: GitCommitSummary
  readonly now: number
  /** この行の下に、ブランチを作る欄が開いているか（Session 3-8-13）。 */
  readonly branching: boolean
  readonly operating: boolean
  readonly onOpen: (commit: GitCommitSummary) => void
  readonly onStartBranch: (shortHash: string) => void
  readonly onCreateBranch: (shortHash: string, name: string) => Promise<GitOperationOutcome | null>
  readonly onCancelBranch: () => void
}): JSX.Element {
  const row = describeGitCommitRow(commit, now)
  const openable = canOpenGitCommitDetail(commit)

  const body = (
    <>
      <div className="fx-git__commit-line">
        {/*
          マージであることは**言葉で**出す。色や記号だけに意味を持たせない
          （変更の記号に読み上げ用の名前を付けてあるのと同じ。GitView.tsx）。
        */}
        {row.merge ? (
          <span className="fx-git__commit-merge" title="2つ以上の親を持つ commit">
            マージ
          </span>
        ) : null}
        <span className="fx-git__commit-subject" data-empty={row.emptySubject} title={row.subject}>
          {row.subject}
        </span>
      </div>
      <div className="fx-git__commit-meta">
        <span className="fx-git__commit-author" title={row.authorName}>
          {row.authorName}
        </span>
        <time
          className="fx-git__commit-time"
          dateTime={new Date(commit.authoredAt).toISOString()}
          title={row.absoluteTime}
          aria-label={row.absoluteTime}
        >
          {row.relativeTime}
        </time>
        <span className="fx-git__commit-hash">{row.shortHash}</span>
      </div>
    </>
  )

  return (
    <li
      className="fx-git__commit-entry"
      data-merge={row.merge}
      data-openable={openable}
      data-branching={branching}
    >
      <div className="fx-git__commit-row">
        {openable ? (
          <button
            type="button"
            className="fx-git__commit-button"
            onClick={() => onOpen(commit)}
            title="このコミットの変更ファイルを見る"
          >
            {body}
          </button>
        ) : (
          <div className="fx-git__commit-body">{body}</div>
        )}
        {/*
          ブランチを作る入口（Session 3-8-13）。

          `title` と `aria-label` に短い hash を入れてあるのは、行の中に
          ⑂ が 100 個並ぶため ── 読み上げでは「ブランチ」だけが 100 回
          続くことになり、どれを押しているのかが分からない。

          押せなくするのは、この欄が既に開いているときだけになる
          （他の Git 操作が動いている間に押せないのは**作成のボタン**の側で、
          そちらは欄を開いてから gitBranches.ts が決める）── 開くことまで
          止めると、名前を打ち始めることすらできない待ち時間が生まれる。
        */}
        <button
          type="button"
          className="fx-git__commit-branch"
          onClick={() => onStartBranch(commit.shortHash)}
          disabled={branching}
          title={`${row.shortHash} からブランチを作る`}
          aria-label={`${row.shortHash} からブランチを作る`}
        >
          <BranchIcon />
        </button>
      </div>
      {branching ? (
        <GitCommitBranchForm
          shortHash={commit.shortHash}
          operating={operating}
          onCreate={onCreateBranch}
          onCancel={onCancelBranch}
        />
      ) : null}
    </li>
  )
}
