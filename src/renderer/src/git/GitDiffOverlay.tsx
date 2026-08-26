import { lazy, Suspense, useEffect, type JSX } from 'react'
import type { GitCommitFileDiff, GitFileDiff } from '@shared/git'
import { describeGitChangeKind } from './gitChanges'
import {
  describeGitCommitDiffSides,
  describeGitDiffSides,
  describeGitDiffTitle,
  describeGitDiffUnavailable,
  toGitDiffSubject,
  type GitDiffRequest,
  type GitDiffSides
} from './gitDiff'

/**
 * 1行の差分を、Git パネルの上に重ねて見せる面（Session 3-8-9 / 3-8-12）。
 *
 * ## Editor のタブにしない
 *
 * 差分を Editor のタブとして開く形（VS Code の `Working Tree` タブ）へは
 * 寄せていない。理由は3つある。
 *
 *   - **タブは「編集して保存するもの」の置き場所**になっている。読み取り専用の
 *     ものが同じ列に混ざると、閉じるときの確認（§12.6）も未保存の印も
 *     「このタブには当てはまらない」という例外を1つずつ持つことになる
 *   - **Auto Save の相手が増える。** 保存が触るのは documentStore が持つ Model
 *     だけで（editor/autoSave.ts）、差分の Model はそこに登録されない ──
 *     タブにすると、その線を「タブなのに登録されないもの」として跨ぐ
 *   - 差分は**一覧の隣で見るもの**にあたる。行を押す → 見る → 隣の行を押す、
 *     という往復が、パネルを跨がずに済む
 *
 * ## 面ごと差し替えず、上に重ねる
 *
 * 一覧を差し替えると、閉じたときにどこを見ていたかが失われる（スクロール位置・
 * 開いていたグループ）。重ねておけば、閉じた瞬間に元の一覧がそのまま在る。
 *
 * ## 閉じ方を2つ用意する
 *
 * 右上の `×` と Esc の両方。押して開いたものは押して閉じられるべきで、
 * かつキーボードだけで一覧へ戻れる必要がある（Files の確認・Terminal の
 * 確認と同じ形）。
 *
 * ## Session 3-8-12 で、入口が2つになった
 *
 * 変更ファイルの一覧の1行（3-8-9）に加えて、**commit 1件の詳細の1行**からも
 * 開く。面は同じものを使い、変わるのは3つだけになる。
 *
 *   見出しの後ろ … commit から来たときだけ短い hash を出す
 *   左右のラベル … 「HEAD / index / 作業ツリー」ではなく「親のコミット / このコミット」
 *   中身の取り先 … `git:get-file-diff` か `git:get-commit-file-diff` か（フックの側）
 *
 * **面を2つに分けなかった**のは、閉じ方・重なり方・読み込み中の見え方まで
 * 二重に持つことになるためになる ── 出る場所が入口ごとに違うと、
 * 利用者は閉じ方も別々に覚える。
 *
 * ## この面が開いている間、下の面は Esc を受け取らない
 *
 * commit の詳細から開いた場合、履歴の面（GitHistoryOverlay.tsx）は
 * **下に重なったまま**になる。どちらも `window` で Esc を待っているので、
 * そのままだと1回の Esc で2枚とも閉じる ── 上に居るこの面だけが効くように、
 * 下の面には「今は上に何か重なっている」を渡してある（GitView.tsx）。
 * こちら側で `stopPropagation` しても意味が無い（同じ `window` に付いた
 * 2つの購読は、どちらも呼ばれる）。
 */

const MonacoDiffEditor = lazy(async () => {
  const module = await import('../editor/monaco/MonacoDiffEditor')

  return { default: module.MonacoDiffEditor }
})

interface GitDiffOverlayProps {
  readonly request: GitDiffRequest
  /** 取得中は null（面は先に出す。下記）。 */
  readonly diff: GitFileDiff | GitCommitFileDiff | null
  readonly onClose: () => void
}

export function GitDiffOverlay({ request, diff, onClose }: GitDiffOverlayProps): JSX.Element {
  /*
    Esc で閉じる。

    購読先を `window` にしてあるのは、面の中に focus が無くても効かせるため
    （Monaco の中に focus が入っている状態が普通にありうる）。
    Monaco は Esc を自分で使う場面があるが、握り潰さずに上がってくる。
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

  const subject = toGitDiffSubject(request)
  const title = describeGitDiffTitle(subject)
  const kind = describeGitChangeKind(subject.kind)

  return (
    <div
      className="fx-git__diff-overlay"
      data-testid="git-diff"
      data-source={request.source}
      data-group={request.source === 'worktree' ? request.group : undefined}
      data-relative-path={subject.relativePath}
      role="dialog"
      aria-modal="false"
      aria-label={`${subject.relativePath} の差分`}
    >
      <div className="fx-git__diff-bar">
        <span className="fx-git__symbol" data-kind={subject.kind} aria-label={kind.label}>
          {kind.symbol}
        </span>
        <span className="fx-git__diff-name">{title.name}</span>
        {title.location === null ? null : (
          <span className="fx-git__diff-location">{title.location}</span>
        )}
        {/*
          どの commit の中の差分かを、見出しの右に置く（Session 3-8-12）。

          面の中に commit の短い hash が出ていないと、履歴を何度か往復した後に
          「今どれを見ているか」が分からなくなる ── 履歴の行と同じ位置
          （いちばん右）に、同じ形で出す。
        */}
        {request.source === 'commit' ? (
          <span className="fx-git__diff-commit" title="このファイルを変えたコミット">
            {request.commit.shortHash}
          </span>
        ) : null}
        <button
          type="button"
          className="fx-git__diff-close"
          onClick={onClose}
          title="差分を閉じる（Esc）"
          aria-label="差分を閉じる"
        >
          ×
        </button>
      </div>
      <GitDiffBody request={request} diff={diff} />
    </div>
  )
}

/**
 * 面の中身。
 *
 * **取得中でも面は出しておく**（`diff === null`）。取れてから出す形にすると、
 * 押してから面が現れるまでの間、押したことが画面に1つも現れない ──
 * 大きなファイルほどその間が長くなる。
 *
 * `GitFileDiff` と `GitCommitFileDiff` は欄の名前を揃えてある
 * （shared/git/commitDetail.ts）ので、ここでは入口で分けずに読める ──
 * 分かれるのは左右のラベルだけになる。
 */
function GitDiffBody({
  request,
  diff
}: {
  readonly request: GitDiffRequest
  readonly diff: GitFileDiff | GitCommitFileDiff | null
}): JSX.Element {
  if (diff === null) {
    return (
      <p className="fx-git__diff-note" role="status">
        差分を読み込んでいます…
      </p>
    )
  }

  if (diff.status === 'unavailable') {
    return (
      <p className="fx-git__diff-note" data-variant="error" role="status">
        {describeGitDiffUnavailable(diff.reason)}
      </p>
    )
  }

  const sides: GitDiffSides =
    request.source === 'worktree'
      ? describeGitDiffSides(request.group, diff.kind)
      : describeGitCommitDiffSides(diff.kind)

  return (
    <div className="fx-git__diff-frame">
      {/*
        どちらの側を見ているかを、差分そのものの上に出す。

        Git の「変更前」は3通りある（HEAD / index / 何も無い）── どれを
        見ているかで次の一手が変わるため、色や位置ではなく言葉で出す
        （gitDiff.ts）。commit の中の差分では相手が1組しか無いが、
        同じ場所に同じ形で出す（読む場所を入口ごとに変えない）。
      */}
      <div className="fx-git__diff-legend">
        <span>左: {sides.original}</span>
        <span>右: {sides.modified}</span>
      </div>
      <Suspense fallback={<p className="fx-git__diff-note">差分を準備しています…</p>}>
        <MonacoDiffEditor
          relativePath={diff.relativePath}
          original={diff.original}
          modified={diff.modified}
        />
      </Suspense>
    </div>
  )
}
