import { lazy, Suspense, useEffect, type JSX } from 'react'
import type { GitCommitFileDiff, GitConflictFileDiff, GitFileDiff } from '@shared/git'
import { describeGitChangeKind } from './gitChanges'
import {
  describeGitCommitDiffSides,
  describeGitConflictDiffSides,
  describeGitConflictMissingSides,
  describeGitConflictShape,
  describeGitDiffSides,
  describeGitDiffTitle,
  describeGitDiffUnavailable,
  toGitDiffSubject,
  type GitDiffRequest,
  type GitDiffSides
} from './gitDiff'
import type { TFunction } from '../i18n/messages'

/**
 * 1行の差分を、Git パネルの上に重ねて見せる面（Session 3-8-9 / 3-8-12 / 3-8-21）。
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
 * ## Session 3-8-21 で、3つめの入口が付いた
 *
 * **競合の行**（3-8-2 からの「競合」グループ）から開く。ここでも面は
 * 同じもので、変わるのは 3-8-12 と同じ3つになる。
 *
 *   見出しの後ろ … 何も足さない（commit の hash に当たるものが無い）
 *   左右のラベル … 「ours（stage 2）/ theirs（stage 3）」── マージ中だけ意味を補う
 *   中身の取り先 … `git:get-conflict-diff`（3本目のチャンネル）
 *
 * 帯の下に**2行だけ**足してある（競合の形と、片側にファイルが無いこと）──
 * 一覧の行が「競合」としか言わないため、その2つはここでしか読めない。
 *
 * 面そのものは**読み取り専用のまま**で、「解決済みにする」も
 * `ours` / `theirs` の採用もここには置いていない（`GitConflictDiffFrame`）。
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
  readonly diff: GitFileDiff | GitCommitFileDiff | GitConflictFileDiff | null
  readonly onClose: () => void
  readonly t: TFunction
}

export function GitDiffOverlay({ request, diff, onClose, t }: GitDiffOverlayProps): JSX.Element {
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
  const title = describeGitDiffTitle(subject, t)
  const kind = describeGitChangeKind(subject.kind, t)

  return (
    <div
      className="fx-git__diff-overlay"
      data-testid="git-diff"
      data-source={request.source}
      data-group={request.source === 'worktree' ? request.group : undefined}
      data-relative-path={subject.relativePath}
      role="dialog"
      aria-modal="false"
      aria-label={t('git.diff.aria', { path: subject.relativePath })}
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
          <span className="fx-git__diff-commit" title={t('git.diff.changedByCommitTitle')}>
            {request.commit.shortHash}
          </span>
        ) : null}
        <button
          type="button"
          className="fx-git__diff-close"
          onClick={onClose}
          title={t('git.diff.closeTitle')}
          aria-label={t('git.diff.closeLabel')}
        >
          ×
        </button>
      </div>
      <GitDiffBody request={request} diff={diff} t={t} />
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
  diff,
  t
}: {
  readonly request: GitDiffRequest
  readonly diff: GitFileDiff | GitCommitFileDiff | GitConflictFileDiff | null
  readonly t: TFunction
}): JSX.Element {
  if (diff === null) {
    return (
      <p className="fx-git__diff-note" role="status">
        {t('git.diff.loading')}
      </p>
    )
  }

  if (diff.status === 'unavailable') {
    return (
      <p className="fx-git__diff-note" data-variant="error" role="status">
        {describeGitDiffUnavailable(diff.reason, t)}
      </p>
    )
  }

  /*
    競合（Session 3-8-21）。

    見分けているのは**中身の側**（`shape` を持つのは競合の応答だけ）になる ──
    要求と応答は必ず対で入れ替わる（useGitRepository.ts が同じ1回で両方を
    置く）ので、要求の `source` で分けても同じところに着くが、
    その場合 `diff.kind` が在ることを型の外側で信じることになる。
  */
  if ('shape' in diff) {
    return (
      <GitConflictDiffFrame
        diff={diff}
        merging={request.source === 'conflict' && request.merging}
        t={t}
      />
    )
  }

  const sides: GitDiffSides =
    request.source === 'worktree'
      ? describeGitDiffSides(request.group, diff.kind, t)
      : describeGitCommitDiffSides(diff.kind, t)

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
        <span>{t('git.diff.legendLeft', { label: sides.original })}</span>
        <span>{t('git.diff.legendRight', { label: sides.modified })}</span>
      </div>
      <Suspense fallback={<p className="fx-git__diff-note">{t('git.diff.preparing')}</p>}>
        <MonacoDiffEditor
          relativePath={diff.relativePath}
          original={diff.original}
          modified={diff.modified}
        />
      </Suspense>
    </div>
  )
}

/**
 * 競合の中身2つ（Session 3-8-21）。
 *
 * ## 器は 3-8-9 のまま
 *
 * 帯（`fx-git__diff-legend`）も枠（`fx-git__diff-frame`）も Diff Editor も、
 * 作業ツリーの差分・commit の差分とまったく同じものを使う ── 別の面を
 * 作らないのは、閉じ方・重なり方・読み込み中の見え方を二重に持たない
 * ためになる（3-8-12 で入口が2つになったときと同じ判断）。
 *
 * 足したのは帯の下の2行だけで、どちらも**言葉**にあたる。
 *
 *   競合の形     … 一覧の行は「競合」としか言わない（gitDiff.ts）
 *   片側の不在   … 空の欄を、空のファイルと見分けられるようにする
 *
 * ## 「解決済みにする」はここに置かない
 *
 * この面は読み取り専用のまま保つ（3-8-9 からの線）。解決し終えたと
 * 伝える口は一覧の行にある（3-8-18）── 面の中にもう1つ置くと、
 * **同じ操作の入口が2つ**になり、押せる条件（競合マーカーが残っていないか）
 * を2箇所で説明することになる。`ours` / `theirs` を作業ツリーへ採る口も
 * 置いていない（docs/ARCHITECTURE.md §14.29）。
 */
function GitConflictDiffFrame({
  diff,
  merging,
  t
}: {
  readonly diff: Extract<GitConflictFileDiff, { readonly status: 'ready' }>
  readonly merging: boolean
  readonly t: TFunction
}): JSX.Element {
  const sides = describeGitConflictDiffSides(diff.shape, merging, t)
  const missing = describeGitConflictMissingSides(sides, merging, t)

  return (
    <div className="fx-git__diff-frame">
      {/*
        左右のラベル。マージ中だけ「現在のブランチ / 取り込み側」と補い、
        それ以外では ours / theirs を訳さない（gitDiff.ts）── rebase や
        cherry-pick では意味が逆になり、`stash pop` の競合ではどちらも
        自分の変更になる。
      */}
      <div className="fx-git__diff-legend">
        <span>{t('git.diff.legendLeft', { label: sides.original })}</span>
        <span>{t('git.diff.legendRight', { label: sides.modified })}</span>
      </div>
      <p className="fx-git__diff-shape" role="status">
        {describeGitConflictShape(diff.shape, merging, t)}
        {missing === null ? null : <span className="fx-git__diff-missing"> {missing}</span>}
      </p>
      {/*
        両側とも無い（両方で削除された）ときは、Diff Editor を出さない ──
        空の欄を2つ並べても読めるものが1つも無く、上の2行が答えのすべてに
        なる。片側だけ無いときは出す（残っている側の中身が読める）。
      */}
      {sides.originalMissing && sides.modifiedMissing ? null : (
        <Suspense fallback={<p className="fx-git__diff-note">{t('git.diff.preparing')}</p>}>
          <MonacoDiffEditor
            relativePath={diff.relativePath}
            original={diff.original}
            modified={diff.modified}
          />
        </Suspense>
      )}
    </div>
  )
}
