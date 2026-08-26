import type { JSX } from 'react'
import type { GitCommitFileChange } from '@shared/git'
import { describeGitChangeKind } from './gitChanges'
import {
  describeGitCommitDetail,
  describeGitCommitDetailTruncation,
  describeGitCommitFileRow,
  type GitCommitDetailState
} from './gitCommitDetail'
import { describeGitCommitRow } from './gitHistory'

/**
 * commit 1件の中身（変更ファイルの一覧）を、履歴の面の中に出す（Session 3-8-12）。
 *
 * ## 3枚目の面を作らず、履歴の面の中で入れ替える
 *
 * 差分（3-8-9）と履歴（3-8-11）は、どちらもパネルを覆う「面」だった。
 * 詳細をそこに**3枚目として重ねない**理由は2つある。
 *
 *   - 重なりが3枚になると、Esc が何を閉じるのかを利用者が数えることになる
 *   - 詳細は履歴の**中の1件**で、履歴と並ぶものではない ── 開いたのは
 *     「履歴のこの行」であって、別の場所ではない
 *
 * 代わりに履歴の面の中身を入れ替え、上のバーに戻る道（←）を置く。
 * 面ごと差し替えないという 3-8-9 からの決めごとは、**面と面の間**の話で、
 * 面の中で1段深く入ることはそこに触れない ── 閉じれば元の Git パネルが
 * そのまま在ることは変わらない。
 *
 * ## 一覧の行と同じ形にしてある
 *
 * 記号（A / M / D / R / C / T）も、その読み上げ名も、ファイル名と場所の
 * 切り方も、変更ファイルの一覧（GitView.tsx）と同じものを使う ──
 * 同じファイルが、面によって違う見た目で並ばない。
 *
 * ## 文言をここに書かない
 *
 * 何と出すかは gitCommitDetail.ts（React 非依存・テスト対象）が決める。
 * このファイルが持つのは配置だけ、という分担は GitView.tsx /
 * GitHistoryOverlay.tsx と同じ。
 */

interface GitCommitDetailViewProps {
  readonly state: GitCommitDetailState
  /** 変更ファイルの1行を押した（差分を出す）。 */
  readonly onOpenFile: (file: GitCommitFileChange) => void
}

export function GitCommitDetailView({ state, onOpenFile }: GitCommitDetailViewProps): JSX.Element {
  const notice = describeGitCommitDetail(state)
  const truncation = describeGitCommitDetailTruncation(state)
  const files = state.detail !== null && state.detail.status === 'ready' ? state.detail.files : []

  /*
    見出しは**届いた名乗り**を優先し、まだ届いていなければ押した行の写しを使う。

    Main は詳細を読んだのと同じ1回の中で名乗りを読み直している
    （main/git/gitCommitDetail.ts）── 届いた後はそちらを出す方が、
    画面に出ているものと git が答えたものが揃う。
  */
  const commit =
    state.detail !== null && state.detail.status === 'ready' ? state.detail.commit : state.commit
  const row = describeGitCommitRow(commit, Date.now())

  return (
    <>
      <div className="fx-git__commit-detail-head">
        <div className="fx-git__commit-detail-subject" data-empty={row.emptySubject}>
          {row.subject}
        </div>
        <div className="fx-git__commit-meta">
          <span className="fx-git__commit-author" title={row.authorName}>
            {row.authorName}
          </span>
          <time
            className="fx-git__commit-time"
            dateTime={new Date(commit.authoredAt).toISOString()}
            title={row.absoluteTime}
          >
            {row.absoluteTime}
          </time>
          <span className="fx-git__commit-hash">{row.shortHash}</span>
        </div>
      </div>
      <div className="fx-git__history-body">
        {notice === null ? (
          <ul className="fx-git__commit-files">
            {files.map((file) => (
              <GitCommitFileRowView
                key={`${file.originalPath ?? ''}:${file.relativePath}`}
                file={file}
                onOpen={onOpenFile}
              />
            ))}
          </ul>
        ) : (
          <p className="fx-git__history-notice" role="status">
            {notice}
          </p>
        )}
      </div>
      {truncation === null ? null : <p className="fx-git__history-truncated">{truncation}</p>}
    </>
  )
}

/**
 * 変更ファイル1件の行。
 *
 * ## こちらは button にする
 *
 * 履歴の行と違い、**押す先がある**（その1件の差分）。削除された行も押せる ──
 * Editor では開けないが、「何が消えたのか」は左側に出せる（3-8-9 と同じ判断。
 * gitDiff.ts）。
 *
 * 差分を出せないもの（submodule）も押せる形のままにしてある ── ここでは
 * mode が渡ってきておらず、押す前に見分けが付かない（shared/git/commitDetail.ts）。
 * 押した先で理由が出る形の方が、**行を消して件数を食い違わせる**より近い。
 */
function GitCommitFileRowView({
  file,
  onOpen
}: {
  readonly file: GitCommitFileChange
  readonly onOpen: (file: GitCommitFileChange) => void
}): JSX.Element {
  const kind = describeGitChangeKind(file.kind)
  const row = describeGitCommitFileRow(file)

  return (
    <li className="fx-git__commit-file">
      <button
        type="button"
        className="fx-git__commit-file-button"
        onClick={() => onOpen(file)}
        title={`${file.relativePath} の差分を見る`}
      >
        <span className="fx-git__symbol" data-kind={file.kind} aria-label={kind.label}>
          {kind.symbol}
        </span>
        <span className="fx-git__commit-file-name">{row.name}</span>
        {row.location === null ? null : (
          <span className="fx-git__commit-file-location">{row.location}</span>
        )}
      </button>
    </li>
  )
}
