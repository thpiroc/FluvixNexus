import { splitRelativePath } from '@shared/files'
import type {
  GitChangeKind,
  GitCommitFileChange,
  GitCommitSummary,
  GitDiffGroup,
  GitDiffUnavailableReason,
  GitFileChange
} from '@shared/git'
import type { GitChangeGroup } from './gitChanges'

/**
 * 差分の面に出す言葉と、開ける行かどうかの判断（Session 3-8-9）。
 *
 * gitChanges.ts と同じ立ち位置（描画を持たない純粋な判断）で、Git の状態から
 * 「画面に出す形」を決める。分けてあるのは**見ている時間が違う**ため ──
 * あちらはパネルが開いている間ずっと効いていて、こちらは1行を選んだ一瞬にしか
 * 効かない。
 *
 * ## 左右のラベルは Main から渡ってこない
 *
 * 何を左に出しているか（HEAD / index / 作業ツリー）は `group` と `kind` から
 * 決まるので、Main が言葉にして送る必要が無い（shared/git/diff.ts）。
 * 2つの経路で同じことを伝えると、片方だけが古い形が生まれる。
 */

/**
 * 今どの行の差分を見ているか。
 *
 * 位置だけでなく**その行そのもの**を持つ。理由は2つ。
 *
 *   - 見出しに出すもの（種類の記号・rename の元の位置）が、位置だけでは決まらない
 *   - 一覧が読み直されても、**開いた瞬間に押した行**を出し続けられる ──
 *     位置だけを持って毎回引き直すと、その行が消えた瞬間に見出しが消える
 *     （差分の中身の側は「見つかりませんでした」と言えばよく、
 *     見出しまで一緒に消える必要は無い）
 *
 * ## Session 3-8-12 で、押される場所が2つになった
 *
 * 3-8-9 まで、差分を開く行は変更ファイルの一覧にしか無かった。3-8-12 で
 * **commit 1件の詳細**が2つめの入口になる ── 面（GitDiffOverlay.tsx）は
 * 同じものを使い、要求の方を union にしてある。
 *
 * `group` を optional にして1つの形に畳まないのは、畳んだ日から
 * 「group が無い差分」を面の側が毎回確かめることになるため。`source` で
 * 分けてあれば、**どちらの入口から来たかで見出しも左右のラベルも一度に決まる。**
 */
export type GitDiffRequest =
  | {
      /** 作業ツリー / index の1行（Session 3-8-9）。 */
      readonly source: 'worktree'
      readonly group: GitDiffGroup
      readonly change: GitFileChange
    }
  | {
      /** commit 1件の中の1ファイル（Session 3-8-12）。 */
      readonly source: 'commit'
      /** 開いている commit（見出しに短い hash を出す）。 */
      readonly commit: GitCommitSummary
      readonly file: GitCommitFileChange
    }

/** 面の見出しと本文が使う、入口によらない形。 */
export interface GitDiffSubject {
  readonly relativePath: string
  readonly originalPath: string | null
  readonly kind: GitChangeKind
}

/**
 * 要求から「どのファイルの、どんな変更か」を取り出す。
 *
 * 面の側で `source` を見分ける場所を**1つに集める**ためにある ── 見出し・
 * 記号・Monaco へ渡す位置は、どちらの入口でも同じ3つで決まる。
 */
export function toGitDiffSubject(request: GitDiffRequest): GitDiffSubject {
  return request.source === 'worktree' ? request.change : request.file
}

/* --------------------------------------------------- どの行の差分を見られるか */

/**
 * その行の差分を出せるか。
 *
 * 出せないのは2つ。
 *
 *   競合（`conflicted`）  … 「前」と「後」が2組（ours / theirs）あり、
 *                           2つの中身を並べる形そのものが当てはまらない
 *   未追跡のフォルダ1件   … 開くファイルが決まらない
 *
 * **削除された行は出せる。** 開く（Editor で）ことはできない（`canOpenGitChange`）が、
 * 「何が消えたのか」は左側に出せる ── むしろ、開けない行でこそ中身を確かめたい。
 */
export function canDiffGitChange(groupId: GitChangeGroup['id'], change: GitFileChange): boolean {
  return groupId !== 'conflicted' && !change.directory
}

/** グループの id を、差分のチャンネルに渡せるグループへ。競合は渡せない。 */
export function toGitDiffGroup(groupId: GitChangeGroup['id']): GitDiffGroup | null {
  return groupId === 'conflicted' ? null : groupId
}

/* ------------------------------------------------------------ 左右のラベル */

export interface GitDiffSides {
  /** 左（変更の前）の見出し。 */
  readonly original: string
  /** 右（変更の後）の見出し。 */
  readonly modified: string
}

/**
 * 左右に何を出しているかを言葉にする。
 *
 * **「変更前 / 変更後」で済ませない。** Git では「前」が3通りあり
 * （HEAD / index / 何も無い）、どれを見ているかで次の一手が変わる ──
 * ステージ済みの差分を見ながら作業ツリーを直しても、その差分は変わらない。
 *
 * 追加・未追跡・削除では、片側が「無い」ことをそのまま書く ── 空の欄を
 * 見せておいて「変更前」と名乗ると、中身が空のファイルと見分けが付かない。
 */
export function describeGitDiffSides(group: GitDiffGroup, kind: GitChangeKind): GitDiffSides {
  if (group === 'untracked') {
    return { original: 'まだ Git にありません', modified: '作業ツリー' }
  }

  if (group === 'unstaged') {
    return {
      original: 'ステージ済み（index）',
      modified: kind === 'deleted' ? '削除されています' : '作業ツリー'
    }
  }

  return {
    original: kind === 'added' ? 'まだ Git にありません' : 'HEAD（最後の Commit）',
    modified: kind === 'deleted' ? '削除されています' : 'ステージ済み（index）'
  }
}

/**
 * commit の中の差分で、左右に何を出しているかを言葉にする（Session 3-8-12）。
 *
 * 作業ツリーの側（上）と違い、**選ぶ余地が無い** ── 比べる相手は常に
 * 「親の commit」と「このコミット」の1組になる（shared/git/commitDetail.ts）。
 * それでも言葉にして出すのは、上と同じ場所に同じ形の帯があることで
 * 「今どちらとどちらを見ているか」を毎回読めるようにするため。
 *
 * 追加と削除では片側が「無い」ことをそのまま書く ── 空の欄を見せておいて
 * 「親のコミット」と名乗ると、中身が空のファイルと見分けが付かない。
 *
 * 履歴のいちばん最初の commit では親が居ないが、そこでは全ファイルが
 * `added` として返るため（`--root`。main/git/gitCommands.ts）、
 * 左は「まだありません」になり、親を名乗らずに済む。
 */
export function describeGitCommitDiffSides(kind: GitChangeKind): GitDiffSides {
  return {
    original: kind === 'added' ? 'まだありません' : '親のコミット',
    modified: kind === 'deleted' ? '削除されています' : 'このコミット'
  }
}

/**
 * 面の見出し（どのファイルの、どの側の差分か）。
 *
 * ファイル名と場所を分けるのは一覧の行とまったく同じ（gitChanges.ts の
 * `describeGitChangeRow`）── 同じファイルを指しているのに、面と行で
 * 違う名前が出ることを避ける。
 *
 * 受け取るのが `GitDiffSubject`（gitDiff.ts の上）なので、作業ツリーの1行でも
 * commit の中の1ファイルでも**同じ関数が同じ名前を出す。**
 */
export function describeGitDiffTitle(change: GitDiffSubject): {
  readonly name: string
  readonly location: string | null
} {
  const split = splitRelativePath(change.relativePath)
  const name = split === null ? change.relativePath : split.name

  if (change.originalPath !== null) {
    return { name, location: `${change.originalPath} から` }
  }

  const parent = split === null ? '' : split.parent

  return { name, location: parent === '' ? null : parent }
}

/* ---------------------------------------------------------- 出せなかった理由 */

/**
 * 差分を出せない理由の文。
 *
 * 「表示できません」で丸めない ── **利用者の次の一手が理由ごとに違う。**
 * バイナリなら別のアプリで開く、大きすぎるなら端末で見る、消えているなら
 * 一覧を見直す。生の英文を出さない方針は 3-8-1 のまま。
 */
export function describeGitDiffUnavailable(reason: GitDiffUnavailableReason): string {
  switch (reason) {
    case 'not-ready':
      return 'この Workspace では Git 操作を行えなくなりました。'

    case 'not-found':
      return 'この変更は見つかりませんでした。一覧が新しくなっている可能性があります。'

    case 'unsupported-target':
      return 'この行は差分を出せません（フォルダや submodule にはファイルの差分がありません）。'

    case 'binary':
      return 'バイナリのため差分を表示できません。'

    case 'too-large':
      return 'ファイルが大きいため差分を表示できません（2 MB まで）。'

    case 'unreadable':
      return '差分の内容を読み取れませんでした。'

    case 'failed':
      return '差分を取得できませんでした。'
  }
}
