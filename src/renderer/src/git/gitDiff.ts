import { splitRelativePath } from '@shared/files'
import type {
  GitChangeKind,
  GitCommitFileChange,
  GitCommitSummary,
  GitConflictShape,
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
  | {
      /**
       * 競合している1行の ours / theirs（Session 3-8-21）。
       *
       * `group` を持たないのが `worktree` との違いになる ── 競合の行は
       * 競合のグループにしか無く、比べる相手も常に1組（stage 2 と stage 3）に
       * 固定される。
       *
       * `merging` を一緒に持ち回るのは、**左右のラベルの意味づけがそれで
       * 変わる**ため（`describeGitConflictDiffSides`）。開いた瞬間の値を
       * 持つのは、押した行そのものを持つのと同じ理由になる ── 面が開いて
       * いる間に一覧が読み直されても、**開いた瞬間の説明を出し続ける**
       * （途中で `merge --abort` が走ってラベルの意味だけが入れ替わる、
       * という見え方を作らない）。
       */
      readonly source: 'conflict'
      readonly change: GitFileChange
      /** 開いた瞬間、マージの途中だったか（`GitRepositoryState.ready.merging`）。 */
      readonly merging: boolean
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
  return request.source === 'commit' ? request.file : request.change
}

/* --------------------------------------------------- どの行の差分を見られるか */

/**
 * その行の差分を出せるか。
 *
 * 出せないのは**未追跡のフォルダ1件**だけになる（開くファイルが決まらない）。
 *
 * **削除された行は出せる。** 開く（Editor で）ことはできない（`canOpenGitChange`）が、
 * 「何が消えたのか」は左側に出せる ── むしろ、開けない行でこそ中身を確かめたい。
 *
 * ## Session 3-8-21 で、競合の行も通るようになった
 *
 * 3-8-9 は競合を弾いていた ── 理由は「前」と「後」が2組（ours / theirs）
 * あり、2つの中身を並べる形が当てはまらないため。3-8-21 でその答えが出た
 * （**組を1つに決める**。shared/git/conflictDiff.ts）ので、条件から外して
 * ある。行き先のチャンネルは違う（`git:get-conflict-diff`）が、それを
 * 決めるのは押した側になる（GitView.tsx の `showDiff`）── ここが答えるのは
 * 「**ボタンを置くか**」だけにあたる。
 *
 * **片側に中身が無い競合（`DD` / `AU` / `UA` / `UD` / `DU`）でも通す。**
 * 押しても何も起きないボタンを作らないためではなく、その逆で、
 * **どちらに無いのかを開いた先で読める**ようにするため ── 一覧の行は
 * 「競合」としか言わないので、形はそこには出ていない。
 *
 * **グループを受け取らなくなった。** 3-8-9 では競合を弾くためだけに要って
 * いたもので、通す条件がグループに依らなくなった以上、渡し続けると
 * 「見ていない値を渡す呼び出し」がそのぶん残る。
 */
export function canDiffGitChange(change: GitFileChange): boolean {
  return !change.directory
}

/**
 * グループの id を、`git:get-file-diff` に渡せるグループへ。競合は渡せない。
 *
 * 3-8-21 で競合にも差分の口が付いたが、**この関数は 3-8-9 のままにしてある**
 * ── 競合が行くのは別のチャンネル（`git:get-conflict-diff`）で、
 * ここを通らない。`conflicted` を通す形に広げると、`GitDiffGroup` に
 * 競合が混ざり、左右のラベルを決める `describeGitDiffSides` が
 * 「このグループのときは別の話」を1つ抱えることになる。
 */
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

/* ------------------------------------------- 競合の左右（Session 3-8-21） */

/** 競合の左右。ラベルに加えて「その側にファイルが無い」を持つ。 */
export interface GitConflictDiffSides extends GitDiffSides {
  /** 左（ours / stage 2）にファイルが存在しないか。 */
  readonly originalMissing: boolean
  /** 右（theirs / stage 3）にファイルが存在しないか。 */
  readonly modifiedMissing: boolean
}

/**
 * 競合の左右に何を出しているかを言葉にする（Session 3-8-21）。
 *
 * ## `merging` が真のときだけ、意味を補う
 *
 * ours / theirs が何を指すかは、**その競合がどうやってできたかで変わる。**
 *
 *   マージ中          … ours ＝ 今居るブランチ、theirs ＝ 取り込む側
 *   rebase 中         … **逆になる**（ours ＝ 積み直す土台、theirs ＝ 自分の commit）
 *   cherry-pick 中    … 同上
 *   `stash pop` の競合 … どちらも「自分の変更」で、枝の話ではない
 *
 * アプリが真だと言い切れるのは1つめだけになる ── `merging` は
 * `MERGE_HEAD` が在るかそのもので（shared/git/repository.ts）、Main が
 * git に訊いた値にあたる。したがってそこでだけ
 * 「現在のブランチ」「取り込み側」と補い、それ以外では **ours / theirs を
 * 訳さない。**
 *
 * **`REBASE_HEAD` / `CHERRY_PICK_HEAD` は読んでいない**（Session 3-8-21 の
 * 範囲外）── 読めば rebase / cherry-pick の意味づけも出せるが、それは
 * 状態の読み取りに git を2本足す話で、そこまで足しても「どれでもない競合」
 * （`stash pop`）は残る。中立の表現がその受け皿になる。
 *
 * ## 段の番号は隠さない
 *
 * `stage 2` / `stage 3` を括弧で添えてある。3-8-2 からの線（git の記法を
 * Renderer へ渡さない）に触れるように見えるが、**ここでは段そのものが
 * 見せているものの正体**にあたる ── 訳語だけを出すと、端末で
 * `git checkout --ours` を打つ人が、画面のどちらを見ていたのか照合できない。
 */
export function describeGitConflictDiffSides(
  shape: GitConflictShape,
  merging: boolean
): GitConflictDiffSides {
  return {
    original: merging ? '現在のブランチ（ours / stage 2）' : 'ours（stage 2）',
    modified: merging ? '取り込み側（theirs / stage 3）' : 'theirs（stage 3）',
    originalMissing: !hasOursSide(shape),
    modifiedMissing: !hasTheirsSide(shape)
  }
}

/**
 * 文の中で使う ours / theirs の呼び名。
 *
 * ラベル（上）と別に持つのは、**括弧の中まで文へ持ち込まない**ため ──
 * 「ours（stage 2）だけで追加されています。」は読みにくい。決め方は
 * ラベルとまったく同じで、マージ中だけ言い切り、それ以外では git の語を
 * そのまま置く。
 */
function describeGitConflictSideNames(merging: boolean): {
  readonly ours: string
  readonly theirs: string
} {
  return merging
    ? { ours: '現在のブランチ', theirs: '取り込み側' }
    : { ours: 'ours', theirs: 'theirs' }
}

/**
 * その形で、左（ours / stage 2）に中身が在るか。
 *
 * **Main から boolean を2つ受け取らない。** どちらに中身が在るかは `shape`
 * から一意に決まるので、応答に載せると `shape` と食い違う組み合わせが
 * 型の上で作れてしまう（`GitFileDiff` が左右のラベルを載せていないのと
 * 同じ判断。shared/git/conflictDiff.ts）。
 */
function hasOursSide(shape: GitConflictShape): boolean {
  switch (shape) {
    case 'both-modified':
    case 'both-added':
    case 'deleted-by-them':
    case 'added-by-us':
      return true

    case 'deleted-by-us':
    case 'added-by-them':
    case 'both-deleted':
      return false
  }
}

/** その形で、右（theirs / stage 3）に中身が在るか。 */
function hasTheirsSide(shape: GitConflictShape): boolean {
  switch (shape) {
    case 'both-modified':
    case 'both-added':
    case 'deleted-by-us':
    case 'added-by-them':
      return true

    case 'deleted-by-them':
    case 'added-by-us':
    case 'both-deleted':
      return false
  }
}

/**
 * 片側（または両側）にファイルが無いことを、そのまま書く（Session 3-8-21）。
 *
 * どちらにも在れば null（何も出さない）。
 *
 * ## 空の欄を黙って見せない
 *
 * 3-8-9 が追加・削除で「まだ Git にありません」「削除されています」と
 * 書いたのと同じ判断になる ── 空の欄を見せておいてラベルだけを出すと、
 * **中身が空のファイル**と見分けが付かない。競合ではそれがより効く：
 * `AU` / `UA` は「片方だけが作った」で、そこで空に見えている側は
 * 「空のファイルを作った」ではなく「まだ無い」にあたる。
 *
 * ## 呼び名は短い方を使う
 *
 * 帯のラベル（`sides.original`）をそのまま挟むと
 * 「右（取り込み側（theirs / stage 3））には…」と括弧が二重になる ──
 * 段の番号はすぐ上の帯に出ているので、文の側は短い呼び名で足りる
 * （形の説明と同じ規則。`describeGitConflictSideNames`）。
 */
export function describeGitConflictMissingSides(
  sides: GitConflictDiffSides,
  merging: boolean
): string | null {
  const names = describeGitConflictSideNames(merging)
  const notes: string[] = []

  if (sides.originalMissing) {
    notes.push(`左（${names.ours}）にはファイルが存在しません。`)
  }

  if (sides.modifiedMissing) {
    notes.push(`右（${names.theirs}）にはファイルが存在しません。`)
  }

  return notes.length === 0 ? null : notes.join(' ')
}

/**
 * 競合の形を1行で言う（Session 3-8-21）。
 *
 * 一覧の行は「競合」としか言わない（`GitChangeKind` に形を載せていない。
 * shared/git/conflictDiff.ts）ため、**どういう競合なのかを読めるのは
 * この面だけ**になる。とくに片側が消えている形では、Diff の片方が
 * 空に見える理由がここに出ていないと読み取れない。
 *
 * `UU` / `AA` のような git の2文字は出さない（3-8-2 からの線）── 出すのは
 * 段の番号だけで、それは左右のラベルの側にある。
 */
export function describeGitConflictShape(shape: GitConflictShape, merging: boolean): string {
  const names = describeGitConflictSideNames(merging)

  switch (shape) {
    case 'both-modified':
      return `${names.ours}と${names.theirs}の両方で変更されています。`

    case 'both-added':
      return `${names.ours}と${names.theirs}の両方で追加されています（共通の元がありません）。`

    case 'deleted-by-them':
      return `${names.ours}では変更され、${names.theirs}では削除されています。`

    case 'deleted-by-us':
      return `${names.ours}では削除され、${names.theirs}では変更されています。`

    case 'both-deleted':
      return `${names.ours}と${names.theirs}の両方で削除されています。`

    case 'added-by-us':
      return `${names.ours}だけで追加されています。`

    case 'added-by-them':
      return `${names.theirs}だけで追加されています。`
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
