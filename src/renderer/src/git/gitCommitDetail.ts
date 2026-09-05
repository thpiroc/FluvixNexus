import { splitRelativePath } from '@shared/files'
import type {
  GitCommitDetail,
  GitCommitDetailUnavailableReason,
  GitCommitFileChange,
  GitCommitSummary
} from '@shared/git'
import { createTranslator, type TFunction } from '../i18n/messages'

const DEFAULT_T = createTranslator('ja')

/**
 * commit 1件の詳細 → 画面に出す形（React / DOM 非依存・テスト対象・Session 3-8-12）。
 *
 * gitHistory.ts が「連なりの1行」を持つのに対し、こちらは**その1件を開いた面の
 * 中身**を持つ。GitCommitDetailView.tsx に残るのは配置だけになる、という分担は
 * gitChanges.ts / gitBranches.ts / gitHistory.ts と同じ。
 *
 * ## ここで決めているのは3つ
 *
 *   1. 開いた面に何と出すか（読み込み中・出せない理由・変更が1件も無い・切れている）
 *   2. 1行に何をどう並べるか（種類の記号・ファイル名・場所・移動元）
 *   3. どの行が押せるか（差分を出せるか）
 *
 * ## 押せる行が1種類だけある
 *
 * gitHistory.ts には押せるものが1つも無かったが、詳細の行は**押すと差分が出る。**
 * それでも `GitActionReadiness`（押せるか・その理由）は持たない ── 押せない行は
 * 「押せる形で出して断る」のではなく、**初めから押せない形**で出す
 * （変更ファイルの一覧で開けない行を `span` にしてあるのと同じ。GitView.tsx）。
 *
 * 何も書き換えないことは 3-8-11 のまま変わらない ── revert も cherry-pick も
 * reset も、この面から動かせるものは1つも無い（docs/ARCHITECTURE.md §14.20）。
 */

/**
 * 詳細の今の姿（フックが持つ形）。
 *
 * `commit` を**要求した行そのもの**として持つのは、差分の面（gitDiff.ts の
 * `GitDiffRequest`）と同じ理由になる ── 中身が届く前でも見出しを出せて、
 * 届かなかったときも「どの commit の話か」が面から消えない。
 *
 * 中身（`detail`）が null の間は取得中で、面は先に出しておく。
 */
export interface GitCommitDetailState {
  /** 開いた行（履歴の一覧が持っていた写し）。 */
  readonly commit: GitCommitSummary
  /** 届いた中身。取得中は null。 */
  readonly detail: GitCommitDetail | null
}

/**
 * 一覧の代わりに出す一言。行が出せるなら null。
 *
 * **行と一言を同時に出さない**（`describeGitCommitHistory` と同じ判断）──
 * 出すと、面の中に「読めているもの」と「読めない理由」が並ぶことになり、
 * どちらが今の状態なのかが読めなくなる（切れていることの断りだけは別枠）。
 */
export function describeGitCommitDetail(
  state: GitCommitDetailState,
  t: TFunction = DEFAULT_T
): string | null {
  if (state.detail === null) {
    return t('git.commitDetail.loading')
  }

  if (state.detail.status === 'unavailable') {
    return describeGitCommitDetailUnavailable(state.detail.reason, t)
  }

  /*
    変更が1件も無い commit（`--allow-empty` で作られたもの・空の tree を
    そのまま積んだもの）。**失敗ではない** ── その commit は実在し、
    ただ何も変えていない。
  */
  return state.detail.files.length === 0 ? t('git.commitDetail.empty') : null
}

/**
 * 出せない理由の文。
 *
 * 「表示できません」で丸めない ── **利用者の次の一手が理由ごとに違う**
 * （`describeGitDiffUnavailable` と同じ判断）。とくにマージは、
 * 「アプリの都合で出せない」のではなく**どちらの親と比べるかが決まらない**
 * ことをそのまま言う ── 理由が分かれば、端末の `git show` へ回るという
 * 次の一手が立つ。
 */
export function describeGitCommitDetailUnavailable(
  reason: GitCommitDetailUnavailableReason,
  t: TFunction | number = DEFAULT_T
): string {
  const translate = typeof t === 'function' ? t : DEFAULT_T

  switch (reason) {
    case 'not-ready':
      return translate('git.commitDetail.notReady')

    case 'not-found':
      return translate('git.commitDetail.notFound')

    case 'merge':
      return describeGitMergeCommitNoticeText(translate)

    case 'failed':
      return translate('git.commitDetail.failed')
  }
}

/**
 * マージ commit を対象外にしている理由（Session 3-8-12）。
 *
 * ## 同じ1文を、2つの場所で使う
 *
 * 履歴の一覧の下（マージの行が混ざっているとき）と、詳細の面の中
 * （マージを指す要求が届いたとき）の両方に出る。**言い方を2つ持たない**ため
 * 定数にしてあり、片方だけ直された日に「一覧では A と言い、面では B と言う」が
 * 起こらない。
 *
 * ## 「非対応」ではなく「決まらない」と書く
 *
 * 親が2つある commit で、どちらと比べた一覧を出しても、それは
 * 「この commit で変わったもの」とは違う意味を持つ ── git 自身も既定では
 * 答えを出さない（shared/git/commitDetail.ts）。アプリが手を抜いたのでは
 * ないことが伝わらないと、利用者は「そのうち直る」と読む。
 */
export const GIT_MERGE_COMMIT_NOTICE =
  'Merge Commit は変更ファイルを表示できません（親が2つ以上あり、どちらと比べるかが決まらないため）。'

export function describeGitMergeCommitNoticeText(t: TFunction = DEFAULT_T): string {
  return t('git.commitDetail.merge')
}

/**
 * 一覧が切れていることの断り。切れていなければ null。
 *
 * **黙って切らない**（履歴・ブランチの一覧と同じ）。ここでできることまで
 * 案内する ── 500 件より先を見るには、今のところ Terminal パネルで
 * `git show --stat` を使う（続きを読む欄は作っていない。
 * docs/ARCHITECTURE.md §14.20）。
 */
export function describeGitCommitDetailTruncation(
  state: GitCommitDetailState,
  t: TFunction = DEFAULT_T
): string | null {
  if (state.detail === null || state.detail.status !== 'ready' || !state.detail.truncated) {
    return null
  }

  return t('git.commitDetail.truncated', { count: state.detail.files.length.toLocaleString() })
}

/** 1行に出すもの（GitCommitDetailView.tsx はこれを並べるだけ）。 */
export interface GitCommitFileRow {
  /** ファイル名だけ（一覧の行と同じ切り方）。 */
  readonly name: string
  /**
   * 名前の後ろに小さく出すもの。無ければ null。
   *
   * rename / copy では**元の位置**を出す（`describeGitDiffTitle` と同じ形）──
   * 「どこから来たか」は、その1件が2行に見えないようにするための情報になる。
   */
  readonly location: string | null
}

/**
 * commit の中の1ファイルを、行に出す形へ直す。
 *
 * ファイル名と場所を分けるのは変更ファイルの一覧・差分の見出しとまったく同じ
 * （`describeGitChangeRow` / `describeGitDiffTitle`）── 同じファイルを
 * 指しているのに、面ごとに違う名前が出ることを避ける。
 */
export function describeGitCommitFileRow(
  file: GitCommitFileChange,
  t: TFunction = DEFAULT_T
): GitCommitFileRow {
  const split = splitRelativePath(file.relativePath)
  const name = split === null ? file.relativePath : split.name

  if (file.originalPath !== null) {
    return { name, location: t('git.commitDetail.from', { path: file.originalPath }) }
  }

  const parent = split === null ? '' : split.parent

  return { name, location: parent === '' ? null : parent }
}

/**
 * その commit を開けるか（履歴の行が押せるか）。
 *
 * 開けないのはマージ commit だけになる。**押せる形で出して断るのではなく、
 * 初めから押せない形で出す**（gitHistory.ts の行と同じ判断）── 押した後に
 * 断ると、利用者は「押し方が悪かったのか」を疑う。
 *
 * 判断が Main と Renderer の2箇所にあるように見えるが、決めているのは
 * どちらも `parentCount >= 2` という**git が答えた同じ事実**になる ──
 * Main 側は境界の外から来た要求を確かめるために持ち（gitCommitDetail.ts）、
 * こちらは押せる形にするかどうかのために持つ。
 */
export function canOpenGitCommitDetail(commit: GitCommitSummary): boolean {
  return commit.parentCount < 2
}

/**
 * 一覧の下に、マージの断りを出すか。
 *
 * **出ている行にマージが混ざっているときだけ**出す。常に出すと、マージを
 * 1つも使わないリポジトリで、押せない行の説明だけが毎回並ぶことになる。
 *
 * 行ごとに出さないのも同じ理由で、100 行のうち 30 行がマージなら
 * 同じ1文が 30 回並ぶ ── 出すのは一覧につき1つになる。
 */
export function describeGitMergeCommitNotice(
  commits: readonly GitCommitSummary[],
  t: TFunction = DEFAULT_T
): string | null {
  return commits.some((commit) => !canOpenGitCommitDetail(commit))
    ? describeGitMergeCommitNoticeText(t)
    : null
}
