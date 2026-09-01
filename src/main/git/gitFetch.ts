import { createLogger } from '../logger'
import { fetchAndPruneFromRemote } from './gitCommands'
import { classifyGitFetchFailure } from './gitFailure'
import {
  finishGitOperation,
  guardGitInProgress,
  notReadyGitOperation,
  toGitOperationOutcome,
  type GitOperationResult
} from './gitOperationResult'
import { runGitExclusively } from './gitQueue'
import { readGitRepositoryOutcome } from './gitRepository'
import { GIT_NETWORK_TIMEOUT_MS, runGit } from './runGit'

/**
 * remote から取ってくるだけ（Session 3-8-22A）。
 *
 * ## 3-8-5 が閉じた道の先を、後から用意する
 *
 * `git fetch` そのものは 3-8-5 から在った。ただし走るのは Pull の中だけで、
 * Pull は**追跡先が無ければ押せない**（`no-upstream`。main/git/gitSync.ts）。
 * つまり追跡先の無いブランチに居るあいだ、remote-tracking ref を新しくする
 * 手立てがアプリの中に1つも無かったことになる。
 *
 * これは 3-8-19 でいちばん効く穴になる ── あちらの一覧は
 * 「`refs/remotes/` に**既に**在るもの」で、面にも「最後に取得した時点の写し」と
 * 書いてある。書いておきながら、取得する口だけが無かった
 * （3-8-15 / 3-8-16 / 3-8-18 / 3-8-20 / 3-8-21 と同じ「自分が閉じた道の先を、
 * 後から用意する」形）。
 *
 * ## Pull との違いは、取り込まないこと
 *
 * 動くのは `refs/remotes/` の ref だけで、HEAD も index も作業ツリーも
 * 1つも変わらない。だから追跡先が無くても・ブランチの上に居なくても押せる
 * （Pull が断る2つの理由が、こちらには当てはまらない）。
 *
 * **早送りもしない。** 取ってきた結果が「1件 behind」として上のバーに出るところ
 * までがこの口の仕事で、そこから先は Pull を押す ── 1つのボタンが
 * 「取ってくる」と「取り込む」を兼ねると、押した人から見て履歴が動いたのか
 * どうかが分からなくなる（`git pull` を使わない 3-8-5 の判断と同じ線）。
 *
 * ## `--prune` を付ける
 *
 * この口の用途は一覧を今の remote に合わせることで、そこには
 * 「もう相手に無い枝が消えること」まで含まれる（main/git/gitCommands.ts の
 * `fetchAndPruneFromRemote`）。**消えるのは remote-tracking ref だけ**で、
 * ローカルブランチも commit も1つも失われない ── 3-8-19 が
 * 「一覧を開く操作に消す働きを混ぜない」と書いたのは、`prune` そのものを
 * 否定したのではなく、**開く操作に混ぜること**を否定したものにあたる。
 * 押したときだけ消える形なら、その線とは矛盾しない。
 *
 * ## 部品の分担は他のネットワーク操作と同じ
 *
 *   順番待ち   … gitQueue.ts（走るのは常に1本）
 *   引数       … gitCommands.ts（組み立てられる場所はそこだけ）
 *   失敗の分類 … gitFailure.ts（Pull の fetch と同じ表を使う）
 *   状態の読み … gitRepository.ts（操作の前後で同じ関数を使う）
 *   応答の形   … gitOperationResult.ts（Stage / Commit / Push と共有）
 */

const log = createLogger('git')

/**
 * `git fetch --prune` を1回動かす。
 *
 * ## 押す前に分かる理由が1つも無い
 *
 * Push / Pull はネットワークへ出る前に手元だけで分かる理由（ブランチの上に
 * 居ない・追跡先が無い・送るものが無い）を先に分けていた。こちらには
 * それが1つも無い ── remote が1つも無い場合でも `git fetch` は 0 で終わる
 * （取ってくるものが無いだけで、失敗ではない）。
 *
 * 唯一の手前の判断が、途中の操作の表になる（shared/git/inProgress.ts）──
 * rebase / cherry-pick / revert の途中では通さない。マージの途中では通す
 * （remote-tracking ref はマージの状態に触らない）。
 *
 * ## `nothing-to-do` を返さない
 *
 * 「新しいものが1件も無かった」を失敗として出さない。Push の
 * `Everything up-to-date` を `nothing-to-do` にしたのとは逆の判断になる ──
 * あちらは**送るものが無い**ことが押す前に分かるが、こちらは
 * **相手に聞くまで分からない**ことで、聞いたこと自体がこの操作の目的にあたる
 * （Pull の `Already up to date.` を成功のままにしているのと同じ）。
 */
export async function applyGitFetch(): Promise<GitOperationResult> {
  return await runGitExclusively(async () => {
    const before = await readGitRepositoryOutcome()

    if (before.repository.status !== 'ready') {
      return notReadyGitOperation(before)
    }

    const guarded = guardGitInProgress(before, 'fetch')

    if (guarded !== null) {
      return guarded
    }

    const outcome = await runGit(fetchAndPruneFromRemote(), {
      timeoutMs: GIT_NETWORK_TIMEOUT_MS
    })

    const result = toGitOperationOutcome(outcome, classifyGitFetchFailure)

    if (result.status !== 'applied') {
      log.info(`git fetch --prune did not complete: ${result.reason}`)
    }

    return await finishGitOperation(before.workspaceId, result)
  })
}
