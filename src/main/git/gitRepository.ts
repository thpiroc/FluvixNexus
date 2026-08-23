import { realpathSync } from 'fs'
import type { GitHead, GitRepositoryState } from '@shared/git'
import { createLogger } from '../logger'
import { currentPlatform } from '../platform'
import { getCurrentWorkspaceFolder } from '../workspaceFolder/currentWorkspaceFolder'
import { deriveWorkspaceDisplayName } from '../workspaceFolder/folderPath'
import {
  showCurrentBranch,
  showHeadCommit,
  showRepositoryRoot,
  showWorkingTreeStatus,
  verifyHeadCommit
} from './gitCommands'
import { classifyGitFailure, isNotARepositoryMessage } from './gitFailure'
import {
  isSameRepositoryPath,
  readBranchName,
  readRepositoryRoot,
  readShortCommit
} from './gitOutput'
import { runGitExclusively } from './gitQueue'
import { parseGitStatus } from './gitStatusOutput'
import { runGit } from './runGit'

/**
 * 「今の Workspace で Git 操作を始められるか」を組み立てる層（Session 3-8-1 / 3-8-2）。
 *
 * 部品はそれぞれ別のファイルに分かれていて、ここはその噛み合わせだけを持つ
 * （workspaceFolder ドメインで currentWorkspaceFolder.ts が果たしているのと同じ役）。
 *
 *   実行           … runGit.ts（git を動かす唯一の場所）
 *   引数           … gitCommands.ts（組み立てられる場所はそこだけ）
 *   出力の読み取り … gitOutput.ts / gitStatusOutput.ts（純粋・テスト対象）
 *   失敗の分類     … gitFailure.ts（純粋・テスト対象）
 *
 * ## 順番に意味がある
 *
 * ```
 * 1. Workspace はあるか            → 無ければ調べる先が無い
 * 2. rev-parse --show-toplevel     → リポジトリか / その root はどこか
 * 3. root は Workspace root と同じか → 違えば操作しない（設計判断 10）
 * 4. HEAD はどこを指しているか      → ブランチ / detached
 * 5. 作業ツリーはどう変わっているか → 変更ファイルの一覧（Session 3-8-2）
 * ```
 *
 * 3 を 4 / 5 より先に置いているのが要点になる。root が食い違う状態で一覧を出すと、
 * **画面には Git が使えるように見えて、実際には見えていないファイルまで
 * 対象に含まれる**。「使えるかどうか」を先に確定させてから中身を聞く。
 *
 * 5 が 3 の後ろにあることで、一覧に並ぶ path は必ず Workspace root からの
 * 相対位置になる ── Files / Editor がそのまま受け取れる形（shared/files/entry.ts）で、
 * Git 専用のファイルの開き方を作らずに済む。
 *
 * ## 失敗を状態として返す
 *
 * この関数は例外を投げず、どの結末も `GitRepositoryState` として返る。
 * Git が入っていない・リポジトリではない・root が食い違う ── どれも
 * Git パネルが平常時に出す表示であって、例外的な結末ではない
 * （shared/git/repository.ts）。
 *
 * ## ここは「呼ばれたら調べる」だけ
 *
 * 状態を覚えることも、自分から配ることもしない。呼ぶ契機（パネルを出したとき・
 * Workspace の切り替え・利用者の更新・作業ツリーの変化）を決めるのは
 * Renderer 側になる（renderer/src/git/useGitRepository.ts）。
 *
 * Session 3-8-8 で `.git` の監視（main/git/gitWatcher.ts）が入っても、
 * **この関数は変わっていない** ── 監視が配るのは「調べ直して」という合図1つで、
 * 状態そのものは相変わらず要求と応答で運ばれる。監視側がここを呼んで
 * 状態を押し出す形にすると、答えの出どころが2つになり、
 * どちらが新しいかを受け手が決めることになる。
 */

const log = createLogger('git')

/** 問い合わせの答え（IPC の応答がそのまま持つ形）。 */
export interface GitRepositoryOutcome {
  readonly workspaceId: string | null
  readonly repository: GitRepositoryState
}

/**
 * 今の状態を1回調べる（Renderer から呼ばれる入口）。
 *
 * 順番待ちを通す（Session 3-8-3）── Stage / Unstage と同時に走ると、
 * **操作の途中の index** を読んだ写しが返りうる。読むだけなら壊れないが、
 * 出てくる一覧は「どちらでもない一瞬」のもので、利用者はそれを
 * 操作の結果として読むことになる（main/git/gitQueue.ts）。
 */
export async function describeGitRepository(): Promise<GitRepositoryOutcome> {
  return await runGitExclusively(readGitRepositoryOutcome)
}

/**
 * 順番待ちを**通さずに**調べる（Main の中だけで使う）。
 *
 * 既に自分の番の中に居る仕事（`gitStage.ts` の Stage / Unstage）が、
 * 対象を決めるためと、終わった後に取り直すために呼ぶ。ここで
 * `describeGitRepository` を呼ぶと自分の番が終わるのを待ち続けることになる。
 */
export async function readGitRepositoryOutcome(): Promise<GitRepositoryOutcome> {
  const workspace = getCurrentWorkspaceFolder()

  if (workspace === null) {
    return { workspaceId: null, repository: { status: 'no-workspace' } }
  }

  const repository = await resolveRepositoryState(workspace.rootPath)

  return { workspaceId: workspace.id, repository }
}

/**
 * HEAD が実在する commit を指しているか。分からなければ null。
 *
 * 「ブランチの上に居る」（`resolveHead`）とは**別の問い**にあたる ──
 * `git init` の直後は、ブランチ名は答えられるのに commit が1つも無い。
 *
 * 分からないまま**どちらかへ倒さない。** 倒した先で起こることが、
 * 呼び出し側ごとに違う形で表に出る。
 *
 *   Unstage（gitStage.ts）… 無い側へ倒すと `rm --cached` が追跡済みを未追跡に変える
 *   Push（gitSync.ts）    … 有る側へ倒すと、空のブランチを送ろうとして分類できない失敗になる
 *
 * 順番待ちの枠の中から呼ぶ（この関数自身は枠を取らない）。
 */
export async function hasGitHeadCommit(): Promise<boolean | null> {
  const outcome = await runGit(verifyHeadCommit())

  if (outcome.status !== 'completed') {
    return null
  }

  if (outcome.exitCode === 0) {
    return true
  }

  // `--quiet` を付けているので、commit がまだ無い場合は何も言わずに 1 で終わる。
  return outcome.exitCode === 1 ? false : null
}

/* ------------------------------------------------------------------ リポジトリの判定 */

async function resolveRepositoryState(workspaceRoot: string): Promise<GitRepositoryState> {
  const outcome = await runGit(showRepositoryRoot())

  switch (outcome.status) {
    case 'no-workspace':
      // 問い合わせている間に閉じられた。
      return { status: 'no-workspace' }

    case 'git-unavailable':
      return { status: 'git-unavailable' }

    case 'failed':
      return { status: 'failed', reason: outcome.reason }

    case 'completed':
      break
  }

  if (outcome.exitCode !== 0) {
    /*
      「ここはリポジトリではない」は失敗ではなく答えの1つ。未初期化のフォルダを
      開いているだけで、Session 3-8-1 は検出と案内までを行う（設計判断 1）。
    */
    if (isNotARepositoryMessage(outcome.stderr)) {
      return { status: 'not-a-repository' }
    }

    return { status: 'failed', reason: classifyGitFailure(outcome.stderr) }
  }

  const repositoryRoot = readRepositoryRoot(outcome.stdout)

  if (repositoryRoot === null) {
    log.warn('git returned no repository root for a successful rev-parse.')
    return { status: 'failed', reason: 'unreadable-output' }
  }

  if (!isSameDirectory(repositoryRoot, workspaceRoot)) {
    /*
      リポジトリの一部だけを開いている。ここで Git 操作を許すと、Files に
      出ていないファイルまで Commit / Push の対象になる（設計判断 10）。

      Renderer へ渡すのは root の**名前**だけで、パスは渡さない
      （shared/git/repository.ts）── 渡せば、それを指して開き直させる API を
      足したくなる。開き直すのは利用者がフォルダ選択ダイアログで行う。
    */
    return { status: 'nested', repositoryName: deriveWorkspaceDisplayName(repositoryRoot) }
  }

  return await resolveReadyState()
}

/**
 * ここまで来たら Git 操作を始められる。残りは「今どうなっているか」を読むだけ。
 *
 * HEAD と作業ツリーを**別々の問い合わせに分けていない**（1つの `ready` に入れる）。
 * 分けると、Renderer が2回呼ぶことになり、ブランチ名と変更一覧が別の瞬間の
 * 写しになる ── ブランチを切り替えた直後に、前のブランチの変更一覧が
 * 新しいブランチ名の下に並びうる。
 *
 * 変更一覧を読めなかった場合は `failed` に倒す。ブランチ名だけを出して
 * 一覧の場所を空にすると、**変更が無いのと区別が付かない** ── Git パネルで
 * それは「Commit するものが無い」と読まれるため、いちばん起こしてはいけない
 * 見え方にあたる。
 */
async function resolveReadyState(): Promise<GitRepositoryState> {
  const head = await resolveHead()
  const status = await runGit(showWorkingTreeStatus())

  switch (status.status) {
    case 'no-workspace':
      return { status: 'no-workspace' }

    case 'git-unavailable':
      return { status: 'git-unavailable' }

    case 'failed':
      return { status: 'failed', reason: status.reason }

    case 'completed':
      break
  }

  if (status.exitCode !== 0) {
    return { status: 'failed', reason: classifyGitFailure(status.stderr) }
  }

  const reading = parseGitStatus(status.stdout)

  if (reading === null) {
    log.warn('git status returned output that could not be read.')
    return { status: 'failed', reason: 'unreadable-output' }
  }

  return { status: 'ready', head, changes: reading.changes, upstream: reading.upstream }
}

/* ------------------------------------------------------------------------ HEAD の判定 */

/**
 * HEAD がブランチの上に居るか、特定の commit を指しているか。
 *
 * ここまで来ている時点でリポジトリとしては開けているため、**読めなかったことを
 * 失敗にしない**（`unknown` として返す）。ブランチ名が出ないだけで、
 * リポジトリが使えないわけではない。
 */
async function resolveHead(): Promise<GitHead> {
  const branch = await runGit(showCurrentBranch())

  if (branch.status !== 'completed') {
    return { kind: 'unknown' }
  }

  if (branch.exitCode === 0) {
    const name = readBranchName(branch.stdout)

    return name === null ? { kind: 'unknown' } : { kind: 'branch', name }
  }

  /*
    `symbolic-ref --quiet` は detached HEAD で何も言わずに 1 で終わる。
    それ以外の終了コードは想定していない ── 壊れたリポジトリとして unknown に倒す。
  */
  if (branch.exitCode !== 1) {
    return { kind: 'unknown' }
  }

  const head = await runGit(showHeadCommit())

  if (head.status !== 'completed' || head.exitCode !== 0) {
    return { kind: 'unknown' }
  }

  const commit = readShortCommit(head.stdout)

  return commit === null ? { kind: 'unknown' } : { kind: 'detached', commit }
}

/* -------------------------------------------------------------------------- パスの比較 */

/**
 * 2つのパスが同じフォルダを指しているか（実体まで辿る）。
 *
 * 文字列としての比較は gitOutput.ts が持つ（純粋・テスト対象）。ここが足しているのは
 * **symlink / ジャンクションを解いた上での比較**で、これが要るのは
 * Workspace root がリンク越しに開かれている場合に、git の返す root（実体側）と
 * 文字列が一致しなくなるため。
 *
 * 見落とすと「リポジトリ root を開いているのに `nested` として扱われ、
 * Git パネルが何もできない」という形で表に出る。
 */
function isSameDirectory(repositoryRoot: string, workspaceRoot: string): boolean {
  if (isSameRepositoryPath(repositoryRoot, workspaceRoot, currentPlatform)) {
    return true
  }

  return isSameRepositoryPath(
    toRealPath(repositoryRoot),
    toRealPath(workspaceRoot),
    currentPlatform
  )
}

/**
 * リンクを解いた実体のパス。解けなければ元の値をそのまま返す。
 *
 * 解けないのは消えた直後・権限が無い場合で、どちらも「同じ場所とは言えない」
 * という結論に落ちる。ここで例外を投げると、判定の失敗が Git パネル全体の
 * 失敗として表に出てしまう。
 */
function toRealPath(value: string): string {
  try {
    return realpathSync.native(value)
  } catch {
    return value
  }
}
