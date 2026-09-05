import type { GitStashEntry, GitWorkingTreeChanges } from '@shared/git'
import type { GitActionReadiness } from './gitChanges'
import { describeGitCommitAbsoluteTime, describeGitCommitRelativeTime } from './gitHistory'
import { createTranslator, type TFunction } from '../i18n/messages'

const DEFAULT_T = createTranslator('ja')

/**
 * 退避の一覧 → 画面に並べる形（React / DOM 非依存・テスト対象・Session 3-8-15）。
 *
 * gitChanges.ts が「変更の一覧」、gitBranches.ts が「ブランチを選ぶ面」、
 * gitHistory.ts が「履歴の面」を持つのと同じ立ち位置で、こちらは
 * **退避の面の中身**を持つ。GitStashOverlay.tsx に残るのは配置だけになる。
 *
 * ## ここで決めているのは4つ
 *
 *   1. 開いた面に何と出すか（読み込み中・失敗・1件も無い・切れている）
 *   2. 1行に何をどう並べるか（名乗り・日時）
 *   3. 今「退避する」を押せるか、押せないならなぜか
 *   4. 捨てる前に何と尋ねるか
 *
 * ## 日時の言い方は履歴から借りる
 *
 * `describeGitCommitRelativeTime` / `describeGitCommitAbsoluteTime` を
 * そのまま使う（gitHistory.ts）── **同じパネルの中で「3分前」の書き方が
 * 2つに割れない**ようにするため。退避も commit なので、借りているのは
 * 見た目だけでなく相手の性質も同じになる。
 *
 * ## 番号は画面に出さない
 *
 * `stash@{0}` の 0 は**上から数えた位置**で、並び順そのものにあたる
 * （shared/git/stash.ts）── 一覧に出せば読む人はそれを「その退避の名前」と
 * 受け取るが、次に1つ避けた瞬間に全部が別の数になる。出さずに、
 * 押した瞬間に hash と一緒に渡すだけにしてある。
 */

/**
 * 退避の操作の目印（`toGitOperationKey` が作るものと同じ枠に入る）。
 *
 * ブランチの削除 / rename と同じく、**対象を目印に含めない**（3-8-14）──
 * 面の中で開ける確認は一度に1つで、2件目を押せる場面がそもそも無い。
 * 番号を混ぜると、目印が「押せるかどうか」の役に立たなくなるだけになる。
 */
export const GIT_STASH_PUSH_OPERATION_KEY = 'stash-push'
export const GIT_STASH_POP_OPERATION_KEY = 'stash-pop'
export const GIT_STASH_DROP_OPERATION_KEY = 'stash-drop'

/**
 * 一覧の今の姿（フックが持つ形）。
 *
 * `loading` を分けているのは、開いた瞬間に「退避はありません」と出さないため
 * （`GitBranchListState` / `GitCommitHistoryState` と同じ理由）。
 */
export interface GitStashListState {
  readonly status: 'loading' | 'ready' | 'not-ready' | 'failed'
  readonly entries: readonly GitStashEntry[]
  /** 上限（`GIT_STASH_LIMIT`）で切られたか。 */
  readonly truncated: boolean
}

/** 開いた直後の姿（まだ何も届いていない）。 */
export const INITIAL_GIT_STASH_LIST: GitStashListState = {
  status: 'loading',
  entries: [],
  truncated: false
}

/**
 * 一覧の代わりに出す一言。行が出せるなら null。
 *
 * **行と一言を同時に出さない**（ブランチ・履歴と同じ判断）── 出すと、
 * 面の中に「戻せるもの」と「戻せない理由」が並ぶことになり、どちらが今の
 * 状態なのかが読めなくなる（切れていることの断りだけは別枠）。
 *
 * 1件も無いときの文は**次の一手を含める** ── この面には下に「退避する」が
 * 在るので、行き先はその場にある（ブランチや履歴で「下の Commit 欄で」と
 * 案内したのとは違い、目を動かす先が同じ面の中になる）。
 */
export function describeGitStashList(
  state: GitStashListState,
  t: TFunction = DEFAULT_T
): string | null {
  switch (state.status) {
    case 'loading':
      return t('git.stash.list.loading')

    case 'not-ready':
      return t('git.stash.list.notReady')

    case 'failed':
      return t('git.stash.list.failed')

    case 'ready':
      break
  }

  return state.entries.length === 0 ? t('git.stash.list.empty') : null
}

/**
 * 一覧が切れていることの断り。切れていなければ null。
 *
 * **黙って切らない**（ブランチ・履歴と同じ）。退避で切れるのは溜め続けた
 * 場合だけだが、言わずに済ませると利用者は「消えた」と読む ── しかも
 * ここでの「消えた」は、避けた中身が失われたという意味になる。
 *
 * ここでできることまで案内する ── それより先は Terminal パネルの
 * `git stash list` になる（続きを読む欄は作っていない）。
 */
export function describeGitStashTruncation(
  state: GitStashListState,
  t: TFunction = DEFAULT_T
): string | null {
  if (state.status !== 'ready' || !state.truncated) {
    return null
  }

  return t('git.stash.list.truncated', { count: state.entries.length.toLocaleString() })
}

/** 1行に出すもの（GitStashOverlay.tsx はこれを並べるだけ）。 */
export interface GitStashRow {
  /**
   * git が付けた名乗り（`%gs`）。空なら代わりの一言が入る。
   *
   * **空欄のまま出さない**（履歴の要約と同じ判断）── 行の高さだけがあって
   * 何も無い行は、読み込みに失敗した行と見分けが付かない。
   */
  readonly subject: string
  /** 名乗りが空だったか（画面側で薄く出すために使う）。 */
  readonly emptySubject: boolean
  /** 本文に出す日時（相対）。 */
  readonly relativeTime: string
  /** hover と読み上げに渡す日時（絶対）。 */
  readonly absoluteTime: string
}

/**
 * 退避1件を、行に出す形へ直す。
 *
 * `now` を引数で受け取るのは、相対表示が**呼んだ瞬間**に依るため ──
 * 中で `Date.now()` を読むと、この関数をテストで固定できなくなる
 * （`describeGitCommitRow` と同じ形）。
 */
export function describeGitStashRow(
  entry: GitStashEntry,
  now: number,
  t: TFunction = DEFAULT_T
): GitStashRow {
  const subject = entry.subject.trim()

  return {
    subject: subject.length === 0 ? t('git.stash.row.emptySubject') : subject,
    emptySubject: subject.length === 0,
    relativeTime: describeGitCommitRelativeTime(entry.stashedAt, now, t),
    absoluteTime: describeGitCommitAbsoluteTime(entry.stashedAt)
  }
}

/**
 * 今「退避する」を押せるか、押せないならなぜか。
 *
 * ## 未追跡だけの状態では押せない
 *
 * `-u` を渡していない（main/git/gitCommands.ts）ので、未追跡のファイルは
 * 退避されない ── そこで押せるようにすると、押しても一覧に何も増えず、
 * 作業ツリーも1文字も変わらないことになる。**押しても何も起きないボタンを
 * 置かない**のは 3-8-1 からの線そのものにあたる。
 *
 * 数えるのは Main が動かす前に見るものと同じ2つ（staged と unstaged）で、
 * 判断が2箇所で食い違わないようにしてある（main/git/gitStash.ts の
 * `findStashPushBlockingState`）── ここは押せるかどうかを決めるだけで、
 * 断るのは Main の側になる（二重の備え）。
 *
 * ## 競合が残っている間は押せない
 *
 * merge の途中で退避しようとすると git が断る。押す前に分かることなので、
 * ここでも見る ── 理由は「解決してから」で、次の一手がまるごと違う。
 *
 * ## 「押せない理由」が状態で変わる
 *
 * `GitCommitReadiness` と同じ考え方で、**押せる / 押せないを決める場所に
 * 理由も一緒に持たせる**（gitChanges.ts）── 薄いボタンだけを置いて、
 * なぜ押せないのかがどこにも出ない状態を作らない。
 */
export function toGitStashPushReadiness(
  changes: GitWorkingTreeChanges,
  operating: boolean,
  t: TFunction = DEFAULT_T
): GitActionReadiness {
  if (changes.conflicted.length > 0) {
    return {
      enabled: false,
      note: t('git.stash.readiness.unresolvedConflicts')
    }
  }

  const count = changes.staged.length + changes.unstaged.length

  if (count === 0) {
    return {
      enabled: false,
      note:
        changes.untracked.length > 0
          ? t('git.stash.readiness.noStashableChangesUntrackedOnly')
          : t('git.stash.readiness.noStashableChanges')
    }
  }

  return {
    enabled: !operating,
    note: t('git.stash.readiness.push', { count: count.toLocaleString() })
  }
}

/**
 * その行を戻せるか（Session 3-8-15）。
 *
 * ## 止めるのは、他の Git 操作が動いている間だけ
 *
 * 戻す先は「今の作業ツリー」全体なので、Commit / Push / 切り替えと同じ扱いに
 * する（行の `＋` / `−` が押した対象だけを止めるのとは性質が違う）。
 *
 * ## 戻せるかどうかを、ここで先に判断しない
 *
 * 「作業ツリーに変更があるから戻せない」とはしない ── 触るファイルが
 * 重ならなければ git は通すし、重なっても中身が同じなら通る。**その判断を
 * 持っているのは git** で、通らなければ `local-changes-blocked` として返る
 * （切り替えで確認を挟まないと決めたのと、まったく同じ判断。§14.14）。
 */
export function toGitStashPopReadiness(
  operating: boolean,
  t: TFunction = DEFAULT_T
): GitActionReadiness {
  return {
    enabled: !operating,
    note: t('git.stash.readiness.pop')
  }
}

/**
 * その行を捨てられるか（Session 3-8-15）。
 *
 * 戻すのと同じ条件になる ── 押す前に分かる「絶対に通らない理由」が
 * 1つも無い（ブランチの削除で「今チェックアウト中」だけを押せなくしたような
 * 事情が、退避には無い）。
 */
export function toGitStashDropReadiness(
  operating: boolean,
  t: TFunction = DEFAULT_T
): GitActionReadiness {
  return { enabled: !operating, note: t('git.stash.readiness.drop') }
}

/**
 * 捨てる前に出す文言（Session 3-8-15）。
 *
 * ## Git で確認を挟む、3つめ
 *
 * 1つめは破棄（§14.16）、2つめはブランチの削除（§14.22）。**この3つの中で
 * いちばん重いのがここ**になる ── 破棄が消すのは「書いたばかりの変更」、
 * 削除が消すのは「マージ済みの枝の名前」で commit は残るが、捨てた退避の
 * 中身はどのブランチからも辿れなくなる。
 *
 * ## それでも盛らずに書く
 *
 * 「完全に失われます」とは書かない ── 捨てた退避は `git fsck --unreachable`
 * で拾える間は残っており、「絶対に取り返せない」は正確ではない。一方で
 * その手順をここに書くのは、押す前の1行としては重すぎる（アプリの中に
 * その画面は無い）。**アプリの中では戻せない**、と書けるところまでを書く。
 *
 * ## 何を捨てるのかを名乗りで出す
 *
 * ブランチの削除が名前を出したのと同じで、対象が確認の文の中に居ないと、
 * 一覧のどれについて尋ねられているのかが分からない。
 */
export function describeGitStashDropWarning(
  entry: GitStashEntry,
  now: number,
  t: TFunction = DEFAULT_T
): {
  readonly message: string
  readonly note: string
  readonly confirmLabel: string
} {
  const row = describeGitStashRow(entry, now, t)

  return {
    message: t('git.stash.warning.message', { subject: row.subject }),
    note: t('git.stash.warning.note'),
    confirmLabel: t('git.stash.warning.confirm')
  }
}
