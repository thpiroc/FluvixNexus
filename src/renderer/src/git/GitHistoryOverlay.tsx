import { useEffect, useMemo, type JSX } from 'react'
import type { GitCommitSummary } from '@shared/git'
import {
  describeGitCommitHistory,
  describeGitCommitRow,
  describeGitCommitTruncation,
  type GitCommitHistoryState
} from './gitHistory'

/**
 * commit の履歴を、Git パネルの上に重ねて見せる面（Session 3-8-11）。
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
 * ## 文言をここに書かない
 *
 * 何と出すかは gitHistory.ts（React 非依存・テスト対象）が決める。この
 * ファイルが持つのは配置だけ、という分担は GitView.tsx / GitBranchMenu.tsx と同じ。
 */

interface GitHistoryOverlayProps {
  readonly history: GitCommitHistoryState
  readonly onClose: () => void
}

export function GitHistoryOverlay({ history, onClose }: GitHistoryOverlayProps): JSX.Element {
  /*
    Esc で閉じる。

    購読先を `window` にしてあるのは、面の中に focus が無くても効かせるため
    （差分の面とまったく同じ形。GitDiffOverlay.tsx）。
  */
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') {
        return
      }

      event.preventDefault()
      onClose()
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  const notice = describeGitCommitHistory(history)
  const truncation = describeGitCommitTruncation(history)

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
      role="dialog"
      aria-modal="false"
      aria-label="コミット履歴"
    >
      <div className="fx-git__history-bar">
        <span className="fx-git__history-title">コミット履歴</span>
        {/*
          件数は見出しの一部（変更の一覧の見出しと同じ形。GitView.tsx）──
          「あと何件あるか」は、縦に読み始める前に知りたい。
        */}
        {history.status === 'ready' && history.commits.length > 0 ? (
          <span className="fx-git__history-count">{history.commits.length}</span>
        ) : null}
        <button
          type="button"
          className="fx-git__history-close"
          onClick={onClose}
          title="履歴を閉じる（Esc）"
          aria-label="履歴を閉じる"
        >
          ×
        </button>
      </div>
      <div className="fx-git__history-body">
        {notice === null ? (
          <ul className="fx-git__commits">
            {history.commits.map((commit) => (
              <GitCommitRowView key={commit.shortHash} commit={commit} now={now} />
            ))}
          </ul>
        ) : (
          <p className="fx-git__history-notice" role="status">
            {notice}
          </p>
        )}
      </div>
      {/*
        切れていることの断りは一覧の**下**に置く（ブランチの面と同じ）── 上に
        置くと、開くたびに一番上に現れて、読みたい行の位置が毎回ずれる。
      */}
      {truncation === null ? null : <p className="fx-git__history-truncated">{truncation}</p>}
    </div>
  )
}

/**
 * commit 1件の行。
 *
 * ## button にしない
 *
 * 変更の一覧の行は押せる（ファイルを開く）が、こちらは**押す先が無い。**
 * 押せる形のものを置いて何も起きないより、初めから押せない形で出す
 * （開けない行を `span` にしてあるのと同じ判断。GitView.tsx）。
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
  now
}: {
  readonly commit: GitCommitSummary
  readonly now: number
}): JSX.Element {
  const row = describeGitCommitRow(commit, now)

  return (
    <li className="fx-git__commit-entry" data-merge={row.merge}>
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
    </li>
  )
}
