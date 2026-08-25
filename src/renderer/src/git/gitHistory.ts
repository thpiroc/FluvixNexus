import type { GitCommitSummary } from '@shared/git'

/**
 * commit の履歴 → 画面に並べる形（React / DOM 非依存・テスト対象・Session 3-8-11）。
 *
 * gitChanges.ts が「変更の一覧」を、gitBranches.ts が「ブランチを選ぶ面」を持つのと
 * 同じ立ち位置で、こちらは**履歴の面の中身**を持つ。GitHistoryOverlay.tsx に
 * 残るのは配置だけになる。
 *
 * ## ここで決めているのは3つ
 *
 *   1. 開いた面に何と出すか（読み込み中・失敗・1件も無い・切れている）
 *   2. 1行に何をどう並べるか（要約・名乗り・日時・マージの印）
 *   3. 日時をどう言うか（本文は相対・hover は絶対）
 *
 * ## 押せるものが1つも無い面になる
 *
 * gitChanges.ts / gitBranches.ts が `GitActionReadiness`（押せるか・その理由）を
 * 返しているのに対し、このファイルにはそれが1つも無い ── 履歴から動かせる git は
 * 無く（revert も cherry-pick も reset も持たない。docs/ARCHITECTURE.md §14.19）、
 * 行は**読むためだけ**に在る。押せる形のものを置かないので、押せない理由を
 * 言う必要もない。
 */

/**
 * 履歴の今の姿（フックが持つ形）。
 *
 * `loading` を分けているのは、開いた瞬間に「まだ commit がありません」と
 * 出さないため（`GitBranchListState` と同じ理由）。
 */
export interface GitCommitHistoryState {
  readonly status: 'loading' | 'ready' | 'not-ready' | 'failed'
  readonly commits: readonly GitCommitSummary[]
  /** 上限（`GIT_COMMIT_HISTORY_LIMIT`）で切られたか。 */
  readonly truncated: boolean
}

/** 開いた直後の姿（まだ何も届いていない）。 */
export const INITIAL_GIT_COMMIT_HISTORY: GitCommitHistoryState = {
  status: 'loading',
  commits: [],
  truncated: false
}

/**
 * 一覧の代わりに出す一言。行が出せるなら null。
 *
 * **行と一言を同時に出さない**（`describeGitBranchList` と同じ判断）── 出すと、
 * 面の中に「読めているもの」と「読めない理由」が並ぶことになり、どちらが
 * 今の状態なのかが読めなくなる（切れていることの断りだけは別枠）。
 */
export function describeGitCommitHistory(state: GitCommitHistoryState): string | null {
  switch (state.status) {
    case 'loading':
      return '履歴を取得しています…'

    case 'not-ready':
      return 'この Workspace では Git 操作を行えなくなりました。'

    case 'failed':
      return '履歴を取得できませんでした。'

    case 'ready':
      break
  }

  /*
    まだ1つも commit が無いリポジトリ（`git init` の直後）。**失敗ではない** ──
    次の一手は「最初の Commit を作る」で、それはこの面ではなく下の Commit 欄にある
    （ブランチの一覧が空のときとまったく同じ言い方にしてある。gitBranches.ts）。
  */
  return state.commits.length === 0
    ? 'まだ commit がありません。最初の Commit を作ると、ここに並びます。'
    : null
}

/**
 * 履歴が切れていることの断り。切れていなければ null。
 *
 * **黙って切らない**（`describeGitBranchTruncation` と同じ）。履歴では
 * さらに起こりやすく、100 件はよく使うリポジトリなら数週間ぶんでしかない ──
 * 言わずに済ませると、利用者は「それより前が消えた」と読む。
 *
 * ここでできることまで案内する ── 100 件より前を見るには、今のところ
 * Terminal パネルで `git log` を使う（続きを読む欄は作っていない。
 * docs/ARCHITECTURE.md §14.19）。
 */
export function describeGitCommitTruncation(state: GitCommitHistoryState): string | null {
  if (state.status !== 'ready' || !state.truncated) {
    return null
  }

  return `新しい方から ${state.commits.length.toLocaleString()} 件だけを表示しています。`
}

/** 1行に出すもの（GitHistoryOverlay.tsx はこれを並べるだけ）。 */
export interface GitCommitRow {
  /**
   * 要約（`%s`）。空の commit では代わりの一言が入る。
   *
   * **空欄のまま出さない。** 行の高さだけがあって何も無い行は、読み込みに
   * 失敗した行と見分けが付かない ── 空のメッセージで commit できるのは
   * git の側の事実なので、そう書く。
   */
  readonly subject: string
  /** 要約が空だったか（画面側で薄く出すために使う）。 */
  readonly emptySubject: boolean
  /** 短くした hash（そのまま出す）。 */
  readonly shortHash: string
  /** 書いた人の名前。空なら「（名前なし）」。 */
  readonly authorName: string
  /** 本文に出す日時（相対）。 */
  readonly relativeTime: string
  /** hover と読み上げに渡す日時（絶対）。 */
  readonly absoluteTime: string
  /**
   * 親が2つ以上か（マージ commit）。
   *
   * 判断をここで行うのは、`parentCount` が**git が答えた事実**であって
   * 「マージ」という言葉ではないため（shared/git/history.ts）。
   */
  readonly merge: boolean
}

/**
 * commit 1件を、行に出す形へ直す。
 *
 * `now` を引数で受け取るのは、相対表示が**呼んだ瞬間**に依るため ──
 * 中で `Date.now()` を読むと、この関数をテストで固定できなくなる
 * （`isSameRepositoryPath` が platform を受け取っているのと同じ形）。
 */
export function describeGitCommitRow(commit: GitCommitSummary, now: number): GitCommitRow {
  const subject = commit.subject.trim()
  const authorName = commit.authorName.trim()

  return {
    subject: subject.length === 0 ? '（メッセージなし）' : subject,
    emptySubject: subject.length === 0,
    shortHash: commit.shortHash,
    authorName: authorName.length === 0 ? '（名前なし）' : authorName,
    relativeTime: describeGitCommitRelativeTime(commit.authoredAt, now),
    absoluteTime: describeGitCommitAbsoluteTime(commit.authoredAt),
    merge: commit.parentCount >= 2
  }
}

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/**
 * 本文に出す日時（相対）。
 *
 * ## なぜ本文が相対で、hover が絶対なのか
 *
 * 履歴を開いた人がまず知りたいのは「**どれくらい前か**」で、`2026/08/25 20:04`
 * からその答えを出すには、今の日時を思い出して引き算することになる。
 * 逆に「いつだったか」を正確に知りたい場面もあり、そちらは hover（`title`）と
 * 読み上げに渡してある ── 1行に両方を並べると、100 行ぶんの日時が
 * 二重に並ぶことになる。
 *
 * ## 未来の日時を「前」と言わない
 *
 * commit の日時は**書いた人の PC の時計**で記録される。ずれた時計・
 * 別の timezone から来た commit は、こちらの「今」より後になりうる ──
 * それを「-3 分前」と出さず、「これから」と言う。
 *
 * ## 1年より前は、月ではなく年で言う
 *
 * 「14 か月前」は読みにくく、そこまでさかのぼると正確さも要らない。
 * 日 → 月 → 年 と粗くしていくのは、時間が経つほど「いつ」の解像度が
 * 要らなくなるためになる。
 */
export function describeGitCommitRelativeTime(timestamp: number, now: number): string {
  const elapsed = now - timestamp

  if (elapsed < 0) {
    return 'これから'
  }

  if (elapsed < MINUTE_MS) {
    return 'たった今'
  }

  if (elapsed < HOUR_MS) {
    return `${Math.floor(elapsed / MINUTE_MS)} 分前`
  }

  if (elapsed < DAY_MS) {
    return `${Math.floor(elapsed / HOUR_MS)} 時間前`
  }

  const days = Math.floor(elapsed / DAY_MS)

  if (days < 30) {
    return `${days} 日前`
  }

  if (days < 365) {
    return `${Math.floor(days / 30)} か月前`
  }

  return `${Math.floor(days / 365)} 年前`
}

/**
 * hover と読み上げに渡す日時（絶対）。
 *
 * ## `toLocaleString()` に任せない
 *
 * 出る形が実行環境（locale）で変わる ── 同じアプリの同じ画面で、PC ごとに
 * `8/25/2026` にも `25/08/2026` にもなる。ここは**桁の揃った1つの形**に
 * 固定する（並んだ 100 行を縦に読むときも、位置がずれない）。
 *
 * 出すのは**見ている人の時計での日時**で、書いた人の timezone は載せない
 * （shared/git/history.ts）。
 */
export function describeGitCommitAbsoluteTime(timestamp: number): string {
  const at = new Date(timestamp)
  const year = at.getFullYear()
  const month = pad(at.getMonth() + 1)
  const day = pad(at.getDate())
  const hours = pad(at.getHours())
  const minutes = pad(at.getMinutes())

  return `${year}/${month}/${day} ${hours}:${minutes}`
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}
