import type { GitGuardedOperation, GitInProgressOperation } from '@shared/git'
import { isGitOperationBlockedWhileInProgress } from '@shared/git'
import type { GitActionReadiness, GitCommitReadiness } from './gitChanges'
import { createTranslator, type TFunction } from '../i18n/messages'

const DEFAULT_T = createTranslator('ja')

/**
 * 途中の Git 操作の見せ方（Session 3-8-22A・React 非依存・テスト対象）。
 *
 * ## 判断は持たない。持つのは文言だけ
 *
 * 「何を通さないか」を決めるのは shared/git/inProgress.ts の表で、**Main も
 * Renderer も同じものを読む。** ここが足すのは、その答えを画面に出すための
 * 言葉と、既にある readiness へそれを被せる形だけになる。
 *
 * 判断をこちらへ写すと、押せないボタンの根拠が Renderer 側にもう1つ生まれる
 * （Files の移動可否を shared に置いた理由と同じ。gitRepositoryMessage.ts が
 * 「何を出すか」だけを持ち、状態そのものは持たないのとも同じ形）。
 *
 * ## 3-8-20 の帯を、4つの状態へ広げる
 *
 * 3-8-20 が出していたのは「マージの途中です」の1つで、そこにだけ中止の口が
 * 在った。3-8-22A で帯は4つの状態を出し分ける ── **中止の口が在るのは
 * マージだけ**のままで、残り3つは行き先が Terminal になる
 * （アプリはその3つを始められず、終わらせる口も持たない）。
 */

/** 帯に出す1件。 */
export interface GitInProgressNotice {
  /** 何の途中か（帯の見出し）。 */
  readonly title: string
  /** 次に何をすればよいか。 */
  readonly description: string
  /**
   * アプリの中に出口があるか。
   *
   * 真ならマージで、帯の中に中止の口を出す（renderer/src/git/GitView.tsx）。
   * 偽なら行き先は Terminal で、押せる場所を帯に置かない ── **押しても
   * 何も起きないボタンを置かない**という 3-8-2 からの線のまま。
   */
  readonly abortable: boolean
}

/**
 * 帯に出す内容。途中の操作が無ければ null（帯そのものを出さない）。
 *
 * ## 4つを1つの文にまとめない
 *
 * 「Git 操作の途中です」だけでは、利用者は**次に何をすればよいか**が分からない。
 * マージなら解決して Commit するか中止する、rebase なら端末で `--continue` か
 * `--abort`、と行き先がそれぞれ違う ── 分類の粒度を「利用者の次の一手が
 * 変わるか」で決める、という 3-8-1 からの基準がそのまま当てはまる。
 *
 * ## 端末で打つコマンドを文の中に書く
 *
 * アプリに口が無い3つでは、**そのコマンドまで出す。** 出さないと
 * 「アプリでは扱えません」で終わり、利用者は自分で調べることになる ──
 * `dubious-ownership` で `git config --global --add safe.directory` を
 * 出しているのと同じ判断（gitRepositoryMessage.ts）。
 */
export function describeGitInProgressNotice(
  inProgress: GitInProgressOperation | null,
  t: TFunction = DEFAULT_T
): GitInProgressNotice | null {
  switch (inProgress) {
    case null:
      return null

    case 'merge':
      return {
        title: t('git.inProgress.mergeTitle'),
        description: t('git.inProgress.mergeDescription'),
        abortable: true
      }

    case 'rebase':
      return {
        title: t('git.inProgress.rebaseTitle'),
        description: t('git.inProgress.rebaseDescription'),
        abortable: false
      }

    case 'cherry-pick':
      return {
        title: t('git.inProgress.cherryPickTitle'),
        description: t('git.inProgress.cherryPickDescription'),
        abortable: false
      }

    case 'revert':
      return {
        title: t('git.inProgress.revertTitle'),
        description: t('git.inProgress.revertDescription'),
        abortable: false
      }
  }
}

/**
 * その操作が今は通らない理由。通るなら null。
 *
 * ## 「なぜ」だけでなく「次に何をすればよいか」まで書く
 *
 * 3-8-20 が `toGitBranchMergeReadiness` の中で
 * 「解決して Commit するか、中止する」と書いていたのを、そのまま引き継ぐ ──
 * 押せないボタンに理由しか無いと、利用者は**待てば押せるようになる**と読む。
 * 実際には先にすることが決まっていて、待っても変わらない。
 *
 * 帯（`describeGitInProgressNotice`）と同じ文を使うのはそのためになる ──
 * 同じ状態が2通りの言葉で呼ばれると、どちらかが古くなる。
 *
 * ## 操作ごとに文言を変えない
 *
 * 次の一手はどの操作でも同じ（「まずこの途中の状態を終わらせる」）で、
 * 操作ごとに書き分けても増えるのは文字だけになる。
 */
export function describeGitInProgressBlock(
  inProgress: GitInProgressOperation | null,
  operation: GitGuardedOperation,
  t: TFunction = DEFAULT_T
): string | null {
  if (!isGitOperationBlockedWhileInProgress(inProgress, operation)) {
    return null
  }

  const notice = describeGitInProgressNotice(inProgress, t)

  if (notice === null) {
    // 表が「通さない」と言った以上ここへは来ないが、来ても押せない側へ倒す。
    return t('git.inProgress.fallback')
  }

  return t('git.inProgress.block', {
    title: notice.title,
    description: notice.description
  })
}

/**
 * 既にある readiness に、途中の操作による禁止を被せる。
 *
 * ## 押せない理由は、いちばん手前のものを出す
 *
 * 元の readiness が別の理由で押せない場合でも、**こちらの理由で上書きする** ──
 * 途中の操作は「直せば押せるようになる」ものの手前に在り、それを終わらせない
 * 限りどの理由も解消しない。2つを並べて出さないのは、
 * 押せない理由の欄が1行しか無いため（`GitActionReadiness.note`）。
 *
 * ## 既存の readiness の引数を1つも増やしていない
 *
 * `toGitPushReadiness` などに `inProgress` を足して回る形にはしていない ──
 * 足すと、**呼び出し側が渡し忘れた1つ**が静かに素通りする。被せる形なら、
 * 被せていない呼び出しは「そこに `withGitInProgressBlock` が無い」として
 * 見て分かる（GitView.tsx の1箇所に並ぶ）。
 */
export function withGitInProgressBlock(
  readiness: GitActionReadiness,
  block: string | null
): GitActionReadiness {
  return block === null ? readiness : { enabled: false, note: block }
}

/**
 * Commit 欄の readiness に、途中の操作による禁止を被せる。
 *
 * ## `GitActionReadiness` と別の関数になる理由
 *
 * Commit 欄だけは型が違う（`GitCommitReadiness`）── `note` が null を取り
 * （何も書いていない欄の下に文を出さないため）、文字数の残り（`remaining`）を
 * 一緒に返す。同じ関数で兼ねようとすると、被せた側で `remaining` を
 * **捨てるか作り直すか**になり、どちらも「上限が近い」の合図を壊す。
 *
 * ## `remaining` は残す
 *
 * 押せなくなっても、書いた文章はそのまま欄に在る ── 上限に近いことは
 * 依然として本当で、そこだけ消えると**マージ中に文字数の合図が出ない**
 * ことになる。変えるのは「押せるか」と「その理由」の2つだけにしてある。
 */
export function withGitInProgressCommitBlock(
  readiness: GitCommitReadiness,
  block: string | null
): GitCommitReadiness {
  return block === null ? readiness : { ...readiness, enabled: false, note: block }
}
