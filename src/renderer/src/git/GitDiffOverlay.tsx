import { lazy, Suspense, useEffect, type JSX } from 'react'
import type { GitFileDiff } from '@shared/git'
import { describeGitChangeKind } from './gitChanges'
import {
  describeGitDiffSides,
  describeGitDiffTitle,
  describeGitDiffUnavailable,
  type GitDiffRequest
} from './gitDiff'

/**
 * 1行の差分を、Git パネルの上に重ねて見せる面（Session 3-8-9）。
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
 */

const MonacoDiffEditor = lazy(async () => {
  const module = await import('../editor/monaco/MonacoDiffEditor')

  return { default: module.MonacoDiffEditor }
})

interface GitDiffOverlayProps {
  readonly request: GitDiffRequest
  /** 取得中は null（面は先に出す。下記）。 */
  readonly diff: GitFileDiff | null
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

  const { change, group } = request
  const title = describeGitDiffTitle(change)
  const kind = describeGitChangeKind(change.kind)

  return (
    <div
      className="fx-git__diff-overlay"
      data-testid="git-diff"
      data-group={group}
      data-relative-path={change.relativePath}
      role="dialog"
      aria-modal="false"
      aria-label={`${change.relativePath} の差分`}
    >
      <div className="fx-git__diff-bar">
        <span className="fx-git__symbol" data-kind={change.kind} aria-label={kind.label}>
          {kind.symbol}
        </span>
        <span className="fx-git__diff-name">{title.name}</span>
        {title.location === null ? null : (
          <span className="fx-git__diff-location">{title.location}</span>
        )}
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
 */
function GitDiffBody({
  request,
  diff
}: {
  readonly request: GitDiffRequest
  readonly diff: GitFileDiff | null
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

  const sides = describeGitDiffSides(diff.group, diff.kind)

  return (
    <div className="fx-git__diff-frame">
      {/*
        どちらの側を見ているかを、差分そのものの上に出す。

        Git の「変更前」は3通りある（HEAD / index / 何も無い）── どれを
        見ているかで次の一手が変わるため、色や位置ではなく言葉で出す
        （gitDiff.ts）。
      */}
      <div className="fx-git__diff-legend">
        <span>左: {sides.original}</span>
        <span>右: {sides.modified}</span>
      </div>
      <Suspense fallback={<p className="fx-git__diff-note">差分を準備しています…</p>}>
        <MonacoDiffEditor
          relativePath={request.change.relativePath}
          original={diff.original}
          modified={diff.modified}
        />
      </Suspense>
    </div>
  )
}
