import type {
  GitOperationFailureReason,
  GitOperationOutcome,
  GitRepositoryState
} from '@shared/git'
import { createLogger } from '../logger'
import { initializeRepository } from './gitCommands'
import { classifyGitOperationFailure, summarizeGitStderr } from './gitFailure'
import {
  finishGitOperation,
  toGitOperationOutcome,
  type GitOperationResult
} from './gitOperationResult'
import { runGitExclusively } from './gitQueue'
import { readGitRepositoryOutcome } from './gitRepository'
import { runGit } from './runGit'

/**
 * `git init`（Session 3-8-10）。
 *
 * 3-8-1 では**やらないこと**として置いていたものになる ── 当時の理由は
 * 「初期化 → 初回 Commit → リポジトリ作成 → remote → Push を途中まで自動で
 * やって止まると、利用者が自分で片付けられない中途半端なリポジトリが残る」
 * だった。3-8-10 の答えは「一続きにする」ではなく、**一続きにしない**の側になる。
 *
 * ## この操作は `git init` だけで終わる
 *
 * 初回 Commit を作らない。`.gitignore` を書かない。remote も設定しない。
 * GitHub への公開（main/github/publishRepository.ts）は**別の口・別の操作**で、
 * ここから続けて呼ぶことも、画面から促すこともしない。
 *
 * 理由は3つある。
 *
 *   - **最初の commit に何を含めるかは利用者の判断。** `.gitignore` を書く前に
 *     全部入りの commit が履歴の1つめとして永久に残るのは、後から直しにくい
 *     （`user.name` をアプリが決めないのと同じ判断。gitCommands.ts）
 *   - **Git は GitHub のためだけのものではない。** 初期化した時点で
 *     Commit / Branch / Diff / Stage / 破棄はすべて使えるようになる。
 *     公開しない人にとって、そこが終点にあたる
 *   - **止まったときに残るものが1つで済む。** 一続きにすると、どこまで進んだかを
 *     アプリが覚えることになる ── 覚えたものと実際が食い違ったとき、
 *     食い違ったまま次が走る（公開の側は「毎回実状態を読み直す」で解いてある）
 *
 * ## 部品の分担は他の操作とまったく同じ
 *
 *   順番待ち   … gitQueue.ts（走るのは常に1本）
 *   引数       … gitCommands.ts（組み立てられる場所はそこだけ）
 *   失敗の分類 … gitFailure.ts（純粋・テスト対象）
 *   状態の読み … gitRepository.ts（操作の前後で同じ関数を使う）
 *   応答の形   … gitOperationResult.ts（Stage / Commit / Push と共有）
 *
 * ## `.git` が現れたことは、監視が自分で気づく
 *
 * 初期化した後に何かを配ることはしない。リポジトリではない Workspace では
 * watcher が root を浅く見張って `.git` の出現を待っている（gitWatcher.ts）ため、
 * **アプリの外で `git init` された場合とまったく同じ経路**で追いつく ──
 * 応答に載る状態と合わせて、二重に配ることになるが、受け手は同じ1つの
 * 読み直しへ合流させてある（renderer/src/git/useGitRepository.ts）。
 */

const log = createLogger('git')

/**
 * 今の Workspace を Git リポジトリにする。
 *
 * ## 動かすのは「まだリポジトリではない」ときだけ
 *
 * 他の状態では git を1回も動かさずに断る。とくに `nested`（リポジトリの
 * 一部を開いている）で動かさないのが要点になる ── そこで `git init` すると
 * **入れ子のリポジトリ**ができ、外側から見ると中身が丸ごと消えたように見える
 * （submodule でも subtree でもない、どちらのツールも扱えない形になる）。
 *
 * 既に `ready` なら `nothing-to-do`。押した意味が無かったことは、
 * そう伝える（shared/git/operation.ts）── 画面にボタンが出るのは
 * `not-a-repository` のときだけなので、ここへ来るのは
 * 「押すまでの間に他の経路で初期化された」場合になる。
 */
export async function applyGitInit(): Promise<GitOperationResult> {
  return await runGitExclusively(async () => {
    const before = await readGitRepositoryOutcome()
    const blocked = findInitBlockingState(before.repository.status)

    if (blocked !== null) {
      return {
        workspaceId: before.workspaceId,
        repository: before.repository,
        outcome: { status: 'failed', reason: blocked }
      }
    }

    return await finishGitOperation(before.workspaceId, await runInit())
  })
}

/** 読んだ状態だけで分かる「初期化できない理由」。無ければ null。 */
function findInitBlockingState(
  status: GitRepositoryState['status']
): GitOperationFailureReason | null {
  switch (status) {
    case 'not-a-repository':
      return null

    /*
      既にリポジトリだった。押すまでの間に他の経路（端末・別のツール）で
      初期化されたことになる ── 応答に載る新しい状態で、画面はそのまま
      使える側へ切り替わる。
    */
    case 'ready':
      return 'nothing-to-do'

    /*
      Workspace が閉じられた・git が消えた・リポジトリの一部を開いている・
      調べられなかった。どれも「今この操作を始められる状態ではない」に
      落ちる（`nested` で初期化しない理由は上記）。
    */
    default:
      return 'not-ready'
  }
}

/**
 * `git init` を1回動かす。
 *
 * 分類の表は Stage / Unstage と同じもの（`classifyGitOperationFailure`）を使う。
 * 初期化に固有の断られ方は無く、起こりうるのは**書けない**（権限・読み取り専用の
 * フォルダ）だけで、それはあの表が既に持っている ── 表を新しく作ると、
 * 同じ stderr が2つの分類を持つことになる。
 */
async function runInit(): Promise<GitOperationOutcome> {
  const outcome = await runGit(initializeRepository())

  if (outcome.status === 'completed' && outcome.exitCode !== 0) {
    log.info(`git init exited ${outcome.exitCode}: ${summarizeGitStderr(outcome.stderr)}`)
  }

  return toGitOperationOutcome(outcome, classifyGitOperationFailure)
}
